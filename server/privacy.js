// Privacy mode state per screen: data/privacy.json ({ screens: { [screenId]: { on, until, by, at } } }), the
// timer that tells displays when a period ends or a schedule rule starts, and the request handler shared by the
// admin route and the webhook. The rules themselves are in core/privacy.js. See docs/ARCHITECTURE.md.
import fs from 'node:fs';
import { getConfig, paths, writeFileAtomic } from './store.js';
import { publish } from './pollHub.js';
import { logActivity } from './activity.js';
import { resolveScreenList } from './displays.js';
import {
  applyPrivacyRequest, pruneStates, privacyStatus, privacyNextChange, privacyOverview, sanitizePrivacyRequest,
} from './core/privacy.js';

let states = null;
let loadedFrom = null;
let timer = null;
/** screenId → active, as displays were last told */
let told = new Map();

const file = () => paths.privacy;

function load(cfg = getConfig()) {
  if (states && loadedFrom === file()) return;
  // no config loaded yet (unit tests that call the display helpers directly): nothing stored, try again later
  if (!cfg) { states = {}; return; }
  loadedFrom = file();
  states = {};
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (j && typeof j.screens === 'object') states = j.screens;
  } catch { /* no file yet */ }
  states = pruneStates(cfg, states);
  told = new Map(cfg.screens.map((s) => [s.id, privacyStatus(cfg, s, states[s.id]).active]));
}

function save() {
  try { writeFileAtomic(file(), JSON.stringify({ screens: states }, null, 2)); } catch (err) { console.warn('[privacy] save failed:', err.message); }
}

/** Stored manual state of one screen (undefined when none). */
export function privacyStateOf(screenId) {
  load();
  return states[screenId];
}

/** privacyStatus() of a screen profile with the stored state. */
export function screenPrivacy(cfg, screen, now = new Date()) {
  load(cfg);
  return privacyStatus(cfg, screen, states[screen.id], now);
}

/** Next instant (ms) the privacy of `screen` may change on its own. */
export function screenPrivacyNext(cfg, screen, now = new Date()) {
  load(cfg);
  return privacyNextChange(cfg, screen, states[screen.id], now);
}

/** PrivacyResponse. */
export function privacyResponse(now = new Date()) {
  load();
  return { screens: privacyOverview(getConfig(), states, now) };
}

/**
 * Tell the displays of every screen whose privacy changed since they were last told (`privacy` live event: they
 * refetch config, events, countdowns and photos), then arm the timer for the next change.
 */
export function syncPrivacy(now = new Date()) {
  load();
  const cfg = getConfig();
  const pruned = pruneStates(cfg, states, now);
  if (Object.keys(pruned).length !== Object.keys(states).length) { states = pruned; save(); }
  const changed = [];
  for (const s of cfg.screens) {
    const active = privacyStatus(cfg, s, states[s.id], now).active;
    if (told.get(s.id) !== active) changed.push({ id: s.id, active });
    told.set(s.id, active);
  }
  for (const id of told.keys()) if (!cfg.screens.some((s) => s.id === id)) told.delete(id);
  for (const c of changed) publish('privacy', { active: c.active, screenId: c.id }, { screenIds: [c.id] });
  arm(now);
  return changed;
}

function arm(now = new Date()) {
  if (timer) clearTimeout(timer);
  timer = null;
  const cfg = getConfig();
  let next = null;
  for (const s of cfg.screens) {
    const n = privacyNextChange(cfg, s, states[s.id], now);
    if (n !== null && (next === null || n < next)) next = n;
  }
  if (next === null) return;
  // Wake up a little after the boundary; never sleep longer than an hour (clock changes, long timers).
  const ms = Math.max(1000, Math.min(next - now.getTime() + 500, 3600_000));
  timer = setTimeout(() => syncPrivacy(), ms);
  timer.unref?.();
}

/**
 * Apply a validated change (`mode` on, off or toggle, `end` ISO or null, `screenIds` [] = every screen), store it and
 * tell the displays. Shared by handlePrivacy and the family dashboards (familyAccess.js), which log it themselves.
 * @returns {{ changed: string[], rows: object[], targets: object[] }}
 */
export function applyPrivacy({ mode, end = null, screenIds = [], by = 'admin' }, now = new Date()) {
  load();
  const cfg = getConfig();
  const out = applyPrivacyRequest(cfg, states, { mode, end, screenIds, by }, now);
  states = out.states;
  save();
  syncPrivacy(now);
  const rows = privacyOverview(cfg, states, now);
  const targets = screenIds.length ? rows.filter((x) => screenIds.includes(x.screenId)) : rows;
  return { changed: out.changed, rows, targets };
}

/**
 * Handle POST /api/admin/privacy and POST /api/hooks/privacy. Returns [status, body].
 * @param {any} req Express request (body, activity actor)
 * @param {'admin' | 'hook'} via
 */
export function handlePrivacy(req, via, now = new Date()) {
  load();
  const cfg = getConfig();
  const r = sanitizePrivacyRequest(req.body, cfg, now);
  if (r.error) return [400, { error: r.error }];
  const scr = resolveScreenList(cfg, r.value.screens);
  if (scr.error) return [400, { error: scr.error, ...(scr.unknown ? { unknown: scr.unknown } : {}) }];
  const { changed, rows, targets } = applyPrivacy({ mode: r.value.mode, end: r.value.end, screenIds: scr.ids, by: via }, now);
  logActivity('privacy.changed', {
    req,
    data: {
      mode: r.value.mode, via,
      ...(scr.ids.length ? { screens: targets.map((x) => x.slug) } : {}),
      active: targets.filter((x) => x.active).map((x) => x.slug),
      ...(r.value.mode !== 'off' && r.value.end ? { until: r.value.end } : {}),
    },
  });
  return [200, { ok: true, changed, screens: rows }];
}

/** Config saved: deleted screens lose their state, new rules or sources may change what displays show. */
export function onPrivacyConfig() {
  load();
  syncPrivacy();
}

export function stopPrivacy() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Testing helper: forget the in-memory state (next call reloads from disk). */
export function _resetPrivacy() {
  stopPrivacy();
  states = null;
  loadedFrom = null;
  told = new Map();
}
