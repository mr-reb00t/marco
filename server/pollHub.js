// Poll command channel for displays that do not keep /api/stream open (GET /api/display/poll, docs/API.md).
// Every live event that reaches SSE clients is also written to a ring buffer here, so a display that polls gets the
// same events with the same names and payloads. Cursors are "<epoch>:<seq>"; the epoch changes on every server start,
// so a cursor from before a restart (or one older than the buffer) gets a reset: the active announcements again,
// never old commands, which matches a stream that reconnects.
import crypto from 'node:crypto';
import { broadcast, listClients, matches } from './sse.js';

export const RING_SIZE = 500;
/** A display that polled this recently counts as connected (and as reached by a command). */
export const POLL_CONNECTED_MS = 4 * 60_000;
/** `next` values the server hands out: normal, while an admin is active, and for a hidden page. */
export const POLL_NEXT_MS = 30_000;
export const POLL_FAST_MS = 5_000;
export const POLL_HIDDEN_MS = 180_000;
const MAX_POLLERS = 200;
/** Same cap as open streams per ip (sse.js MAX_STREAMS_PER_IP): more client ids from one address are not listed. */
export const MAX_POLLERS_PER_IP = 24;

/** How long a command stays deliverable. `announce` and `doorbell` live until their own expiresAt. */
const TTL_MS = { reload: 600_000, night: 600_000, identify: 60_000, 'announce-clear': 600_000, photos: 600_000, events: 600_000, privacy: 600_000, 'doorbell-end': 600_000, family: 600_000, todo: 600_000 };
export const POLL_EVENTS = Object.freeze(['reload', 'night', 'identify', 'announce', 'announce-clear', 'photos', 'events', 'privacy', 'doorbell', 'doorbell-end', 'family', 'todo']);

let epoch = crypto.randomBytes(4).toString('hex');
let seq = 0;
let ring = [];
let fastUntil = 0;
/** clientId → { clientId, screenId, screenKey, anonymous, preview, ip, access, at } of displays that poll. */
const pollers = new Map();

export const pollEpoch = () => epoch;
export const currentCursor = () => `${epoch}:${seq}`;

/** Keep polls short for a while (an admin is looking at the displays or just sent something). */
export function markFast(ms = 3 * 60_000, now = Date.now()) {
  fastUntil = Math.max(fastUntil, now + ms);
}

/** Server-chosen delay before the next poll. */
export function nextDelay(hidden, now = Date.now()) {
  if (now < fastUntil) return POLL_FAST_MS;
  return hidden ? POLL_HIDDEN_MS : POLL_NEXT_MS;
}

const live = (p, now) => now - p.at < POLL_CONNECTED_MS;

function prunePollers(now = Date.now()) {
  for (const [id, p] of pollers) if (!live(p, now)) pollers.delete(id);
}

/** Pollers that count as connected right now. */
export function listPollers(now = Date.now()) {
  prunePollers(now);
  return [...pollers.values()];
}

/** True while `clientId` counts as a connected poller. */
export function isPolling(clientId, now = Date.now()) {
  const p = pollers.get(clientId);
  return Boolean(p && live(p, now));
}

/**
 * Remember a display that polled (preview and anonymous polls are not tracked). Returns false when it was not
 * tracked: the list is full, or its ip already has MAX_POLLERS_PER_IP other client ids.
 */
export function trackPoller(p, now = Date.now()) {
  if (p.preview || p.anonymous || !p.clientId) return false;
  if (!pollers.has(p.clientId)) {
    prunePollers(now);
    if (pollers.size >= MAX_POLLERS) return false;
    let fromIp = 0;
    for (const x of pollers.values()) if (x.ip === p.ip) fromIp++;
    if (fromIp >= MAX_POLLERS_PER_IP) return false;
  }
  pollers.set(p.clientId, { ...p, at: now });
  return true;
}

/**
 * Forget the pollers that match `filter` (their credential was revoked or no longer applies): they stop counting as
 * connected right away instead of after 4 minutes, and their next poll gets 401 / 403. Returns how many.
 */
export function dropPollers(filter) {
  let n = 0;
  for (const [id, p] of pollers) {
    if (!filter(p)) continue;
    pollers.delete(id);
    n++;
  }
  return n;
}

/** Displays reached by a live event: open streams (not previews) plus pollers without a stream of their own. */
export function connectedCount(now = Date.now()) {
  const streams = listClients().filter((c) => !c.preview);
  const ids = new Set(streams.map((c) => c.clientId));
  return streams.length + listPollers(now).filter((p) => !ids.has(p.clientId)).length;
}

function pollersReached(target, filter, sseIds, now) {
  let n = 0;
  for (const p of listPollers(now)) {
    if (sseIds.has(p.clientId) || !matches(p, target)) continue;
    if (filter && !filter(p)) continue;
    n++;
  }
  return n;
}

/** Write one event to the ring buffer. */
export function record(event, data, target = null, filter = null, now = Date.now()) {
  if (!POLL_EVENTS.includes(event)) return;
  seq++;
  ring.push({ seq, event, data: data ?? {}, target, filter, at: now });
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
}

/**
 * Send a live event to every display: SSE clients right away, pollers on their next poll. Returns the number of
 * displays reached, counting pollers seen in the last 4 minutes.
 */
export function publish(event, data, target = null, filter = null) {
  const now = Date.now();
  const reachedIds = new Set(listClients().filter((c) => matches(c, target) && (!filter || filter(c))).map((c) => c.clientId));
  const n = broadcast(event, data, target, filter);
  record(event, data, target, filter, now);
  if (event !== 'events' && event !== 'photos' && event !== 'todo') markFast(3 * 60_000, now);
  return n + pollersReached(target, filter, reachedIds, now);
}

/** Identify is filled in per display (screen name, clientId), so the ring keeps only the target. */
export function recordIdentify(target, now = Date.now()) {
  const reachedIds = new Set(listClients().filter((c) => matches(c, target)).map((c) => c.clientId));
  record('identify', { durationSec: 10 }, target, null, now);
  markFast(3 * 60_000, now);
  return pollersReached(target, null, reachedIds, now);
}

const CURSOR_RE = /^([0-9a-f]{1,16}):(\d{1,15})$/;

/**
 * Commands for one poller after `cursor`, or `{ reset: true }` when the cursor is missing, from another server run,
 * ahead of the server or older than the ring buffer.
 * @param {string} cursor
 * @param {{ clientId: string, screenId: string, anonymous: boolean }} client
 * @param {(screenId: string) => { name: string, slug: string } | null} screenOf
 */
export function readSince(cursor, client, screenOf, now = Date.now()) {
  const m = CURSOR_RE.exec(String(cursor || ''));
  const first = ring.length ? ring[0].seq : seq + 1;
  const c = m ? Number(m[2]) : -1;
  if (!m || m[1] !== epoch || c > seq || c < first - 1) return { reset: true, cursor: currentCursor(), commands: [] };
  const commands = [];
  for (const e of ring) {
    if (e.seq <= c || !matches(client, e.target)) continue;
    if (e.filter && !e.filter(client)) continue;
    if (e.event === 'announce' || e.event === 'doorbell') {
      if (!(Date.parse(e.data.expiresAt) > now) || e.data.clearedAt) continue;
    } else if (now - e.at > (TTL_MS[e.event] ?? 0)) continue;
    if (e.event === 'identify') {
      const s = screenOf(client.screenId);
      commands.push({ type: 'identify', name: s?.name || '', slug: s?.slug || '', clientId: client.anonymous ? null : client.clientId, durationSec: e.data.durationSec ?? 10 });
    } else {
      commands.push({ ...e.data, type: e.event });
    }
  }
  return { reset: false, cursor: currentCursor(), commands };
}

/** Testing helper: a new epoch and an empty buffer, as after a restart. */
export function _resetPoll() {
  epoch = crypto.randomBytes(4).toString('hex');
  seq = 0;
  ring = [];
  fastUntil = 0;
  pollers.clear();
}
