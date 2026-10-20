// instant announcements: create, expire, clear, replay. Persisted in data/announcements.json
// ({ active, history }). See docs/API.md and docs/ARCHITECTURE.md.
import fs from 'node:fs';
import { getConfig, paths, writeFileAtomic } from './store.js';
import { publish } from './pollHub.js';
import {
  HISTORY_MAX, makeAnnouncement, retireFor, splitExpired, activeFor as activeIn, alertsFilter as alertsFilterFor,
} from './core/announceCore.js';

export { ACTIVE_MAX, FAMILY_ACTIVE_MAX, HISTORY_MAX, sanitizeAnnounce } from './core/announceCore.js';

let state = null; // { active: Announcement[], history: Announcement[] }, history newest first
let loadedFrom = null;
let timer = null;

function load() {
  if (state && loadedFrom === paths.announcements) return;
  loadedFrom = paths.announcements;
  state = { active: [], history: [] };
  try {
    const j = JSON.parse(fs.readFileSync(paths.announcements, 'utf8'));
    if (Array.isArray(j.active)) state.active = j.active.filter((a) => a && typeof a.id === 'string');
    if (Array.isArray(j.history)) state.history = j.history.filter((a) => a && typeof a.id === 'string').slice(0, HISTORY_MAX);
  } catch { /* no file yet */ }
  expire();
}

function save() {
  try { writeFileAtomic(paths.announcements, JSON.stringify(state, null, 2)); } catch (err) { console.warn('[announce] save failed:', err.message); }
}

/** Move expired announcements to the history. Returns true when something changed. */
function expire(now = Date.now()) {
  const { keep, expired } = splitExpired(state.active, now);
  for (const a of expired) state.history.unshift(a);
  const changed = expired.length > 0;
  if (changed) {
    state.active = keep;
    state.history = state.history.slice(0, HISTORY_MAX);
    save();
  }
  scheduleExpiry();
  return changed;
}

function scheduleExpiry() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!state.active.length) return;
  const next = Math.min(...state.active.map((a) => Date.parse(a.expiresAt)));
  timer = setTimeout(() => expire(), Math.max(1000, Math.min(next - Date.now() + 50, 2 ** 31 - 1)));
  timer.unref?.();
}

/** Clients of screens with alerts disabled never get `announce` (`screenIds` = the announcement's targets). */
export const alertsFilter = (client, screenIds = []) => alertsFilterFor(getConfig(), screenIds)(client);

/**
 * Create + broadcast an announcement. `value` = sanitised request. Returns { announcement, delivered }, or
 * { error: 'announcements_full' } for a family message that would have to retire someone else's announcements.
 * @param {object} value
 * @param {{ via: 'admin'|'hook'|'family', by: string, now?: Date }} meta
 */
export function createAnnouncement(value, { via, by, now = new Date() }) {
  load();
  expire(now.getTime());
  const a = makeAnnouncement(value, { via, by, now });
  // Hard cap: the oldest active ones are retired (a family message only retires the same person's).
  const retire = retireFor(state.active, a);
  if (!retire) return { error: 'announcements_full' };
  state.active = state.active.filter((x) => !retire.includes(x));
  state.active.push(a);
  for (const old of retire) {
    old.clearedAt = now.toISOString();
    state.history.unshift(old);
    publish('announce-clear', { id: old.id });
  }
  state.history = state.history.slice(0, HISTORY_MAX);
  save();
  scheduleExpiry();
  const delivered = publish('announce', a, a.screenIds.length ? { screenIds: a.screenIds } : null, (c) => alertsFilter(c, a.screenIds));
  return { announcement: a, delivered };
}

/** Active (not expired) announcements that target `screenId` (for SSE replay on connect). */
export function activeFor(screenId) {
  load();
  return activeIn(state.active, screenId);
}

/** AnnouncementsResponse. */
export function listAnnouncements() {
  load();
  expire();
  return { active: [...state.active].reverse(), history: [...state.history] };
}

/** Clear one announcement (id) or all (id = null). Returns the cleared announcements. */
export function clearAnnouncements(id = null) {
  load();
  expire();
  const nowIso = new Date().toISOString();
  const cleared = state.active.filter((a) => id === null || a.id === id);
  if (!cleared.length) return [];
  state.active = state.active.filter((a) => !cleared.includes(a));
  for (const a of cleared) { a.clearedAt = nowIso; state.history.unshift(a); }
  state.history = state.history.slice(0, HISTORY_MAX);
  save();
  scheduleExpiry();
  publish('announce-clear', { id: id === null ? null : id });
  return cleared;
}

/** Drop deleted screen ids from active announcements (config saved). */
export function pruneScreens(cfg) {
  load();
  const ids = new Set(cfg.screens.map((s) => s.id));
  let changed = false;
  for (const a of state.active) {
    const keep = a.screenIds.filter((x) => ids.has(x));
    if (keep.length !== a.screenIds.length) {
      changed = true;
      // An announcement whose every target screen is gone is retired instead of becoming "all screens".
      if (!keep.length) a.expiresAt = new Date().toISOString();
      else a.screenIds = keep;
    }
  }
  if (changed) { save(); expire(); }
}

export function _resetAnnouncements() {
  if (timer) clearTimeout(timer);
  timer = null;
  state = null;
  loadedFrom = null;
}
