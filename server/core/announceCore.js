// Pure announcement logic, shared with Marco Cloud: request validation, the announcement record, expiry, and which
// screens get one. server/announce.js keeps the state in data/announcements.json and broadcasts over SSE.
import { ALERT_STYLES, validateEmoji } from './validate.js';
import { randomId } from './lib/text.js';

/** Announcements kept in the history. */
export const HISTORY_MAX = 50;
/** Active announcements at most; past this the oldest are retired. */
export const ACTIVE_MAX = 50;
/** Active family messages (via 'family') one person may have at once; past this their oldest is retired. */
export const FAMILY_ACTIVE_MAX = 3;

/**
 * Validate an AnnounceRequest. `resolveScreens(keys)` → { ids } | { error, unknown }.
 * Returns { ok: true, value } or { ok: false, error, details }.
 */
export function sanitizeAnnounce(body, resolveScreens) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid body' };
  const details = [];
  const s = (k, max) => {
    const v = body[k];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') { details.push({ path: k, message: 'expected string' }); return ''; }
    // eslint-disable-next-line no-control-regex
    const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (t.length > max) { details.push({ path: k, message: `too long (max ${max})` }); return t.slice(0, max); }
    return t;
  };
  const title = s('title', 120);
  const text = s('body', 500);
  const em = validateEmoji(body.emoji);
  details.push(...em.errors);
  const emoji = em.value;
  if (!title && !text) details.push({ path: 'title', message: 'title or body required' });
  let style = 'info';
  if (body.style !== undefined) {
    if (ALERT_STYLES.includes(body.style)) style = body.style;
    else details.push({ path: 'style', message: `must be one of ${ALERT_STYLES.join(', ')}` });
  }
  let durationSec = 30;
  if (body.durationSec !== undefined && body.durationSec !== null) {
    const n = Number(body.durationSec);
    if (!Number.isFinite(n) || n < 5 || n > 86400) details.push({ path: 'durationSec', message: 'must be between 5 and 86400' });
    else durationSec = Math.round(n);
  }
  let sound = false;
  if (body.sound !== undefined) {
    if (typeof body.sound === 'boolean') sound = body.sound;
    else details.push({ path: 'sound', message: 'expected boolean' });
  }
  const scr = resolveScreens(body.screens);
  if (scr.error) details.push({ path: 'screens', message: scr.unknown?.length ? `unknown screen: ${scr.unknown.join(', ')}` : scr.error });
  if (details.length) return { ok: false, error: 'invalid', details };
  return { ok: true, value: { title, body: text, emoji, style, durationSec, sound, screenIds: scr.ids } };
}

/**
 * The stored announcement for a sanitised request.
 * @param {object} value  sanitizeAnnounce(...).value
 * @param {{ via: 'admin'|'hook'|'family', by: string, now?: Date, id?: string }} meta
 */
export function makeAnnouncement(value, { via, by, now = new Date(), id = randomId('a_', 6) }) {
  return {
    id,
    ...value,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + value.durationSec * 1000).toISOString(),
    via,
    by: String(by || '').slice(0, 120),
    clearedAt: null,
  };
}

/**
 * The active announcements to retire so that `next` fits (`active` oldest first), or null when it does not fit.
 * An admin or webhook announcement retires the oldest ones past ACTIVE_MAX, whoever sent them. A family message only
 * ever retires messages of the same person (same `by`): their oldest past FAMILY_ACTIVE_MAX, and more of them while
 * the household is at ACTIVE_MAX. It never takes down an announcement the person could not have sent, so it gets
 * null when the household is full of other ones.
 */
export function retireFor(active, next) {
  if (next.via !== 'family') return active.slice(0, Math.max(0, active.length + 1 - ACTIVE_MAX));
  const own = active.filter((a) => a.via === 'family' && a.by === next.by);
  const n = Math.max(0, own.length + 1 - FAMILY_ACTIVE_MAX, active.length + 1 - ACTIVE_MAX);
  return n > own.length ? null : own.slice(0, n);
}

/** Splits `active` into the ones still running and the ones that expired at `now` (ms). */
export function splitExpired(active, now = Date.now()) {
  const keep = [];
  const expired = [];
  for (const a of active) (Date.parse(a.expiresAt) <= now ? expired : keep).push(a);
  return { keep, expired };
}

/** Active (not expired) announcements that target `screenId` (replayed when a display connects). */
export function activeFor(active, screenId, now = Date.now()) {
  return active.filter((a) => Date.parse(a.expiresAt) > now && (!a.screenIds.length || a.screenIds.includes(screenId)));
}

/** False when the screen turned alerts off. Unknown screens get them (the screen list may be newer than `cfg`). */
export function alertsEnabled(cfg, screenId) {
  const s = cfg?.screens?.find((x) => x.id === screenId);
  return s ? s.alerts?.enabled !== false : true;
}

/**
 * Delivery filter for `announce`: clients of screens with alerts disabled never get it. A display on a carousel
 * (`memberIds`) gets it when one of the carousel's screens that the announcement targets (`screenIds`, [] = all)
 * has alerts on: the same rule as the replay on connect, so live and reconnect agree.
 */
export const alertsFilter = (cfg, screenIds = []) => (client) => {
  const members = Array.isArray(client.memberIds) && client.memberIds.length ? client.memberIds : [client.screenId];
  const all = !screenIds?.length || screenIds.includes(client.screenId);
  return members.some((id) => (all || screenIds.includes(id)) && alertsEnabled(cfg, id));
};
