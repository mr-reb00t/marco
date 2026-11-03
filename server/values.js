// Values pushed by POST /api/hooks/values for the Valor card (docs/API.md). Kept in memory and in data/values.json
// (written at most every 5 s), sent to the screens that show them as the SSE `values` event (coalesced over 1 s,
// only the keys each screen uses, nothing while a screen is private) and read by GET /api/display/values.
// One stored update per key every 2 s: a value that comes sooner waits for the end of that window, and a newer one
// replaces it while it waits (the last value wins, nothing is refused). Never a config write, never a poll command.
import fs from 'node:fs';
import { getConfig, paths, writeFileAtomic } from './store.js';
import { broadcast, send } from './sse.js';
import { screenPrivacy } from './privacy.js';
import { VALUES_LIMITS, displayValue, screenValueKeys } from './core/valuesCore.js';
import { VALUE_KEY_RE, conditionKeys } from './core/canvasCore.js';
import { conditionChanged, hasConditions, hiddenItems, hideChanged, onConditionChange, setConditionSource } from './canvasConditions.js';

export const VALUES_TIMING = { saveMs: 5000, coalesceMs: 1000, windowMs: VALUES_LIMITS.windowMs };

/** key → { value, unit?, label?, at (ms), by? } */
let values = null;
let loadedFrom = null;
/** key → ms of its last stored update */
const lastAt = new Map();
/** key → the update waiting for the end of its window, with its timer */
const waiting = new Map();
let saveTimer = null;
let dirty = false;
/** keys changed since the last `values` event (null in the set: deleted) */
const changed = new Set();
let flushTimer = null;
let rev = 0;

function load() {
  if (values && loadedFrom === paths.values) return;
  loadedFrom = paths.values;
  values = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(paths.values, 'utf8'));
    for (const [k, r] of Object.entries(raw?.values ?? {})) {
      if (!VALUE_KEY_RE.test(k) || !r || typeof r !== 'object') continue;
      const v = r.value;
      if (!(typeof v === 'number' && Number.isFinite(v)) && typeof v !== 'string' && typeof v !== 'boolean') continue;
      const rec = { value: typeof v === 'string' ? v.slice(0, VALUES_LIMITS.valueChars) : v, at: Number(r.at) || 0 };
      if (typeof r.unit === 'string' && r.unit) rec.unit = r.unit.slice(0, VALUES_LIMITS.unitChars);
      if (typeof r.label === 'string' && r.label) rec.label = r.label.slice(0, VALUES_LIMITS.labelChars);
      if (typeof r.by === 'string') rec.by = r.by.slice(0, 60);
      values.set(k, rec);
      if (values.size >= VALUES_LIMITS.keys) break;
    }
  } catch { /* no file yet */ }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushValues();
  }, VALUES_TIMING.saveMs);
  saveTimer.unref?.();
}

/** Write data/values.json now if something changed (shutdown, tests). */
export function flushValues() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty || !values) return;
  dirty = false;
  try {
    writeFileAtomic(paths.values, JSON.stringify({ values: Object.fromEntries(values) }, null, 2));
  } catch (err) {
    console.warn('[values] save failed:', err.message);
  }
}

// ---- the `values` event ----------------------------------------------------------------------------------------

/** The values of a screen's keys as a display may see them: none while the screen is private, none for an item its condition hides. */
export function screenValues(cfg, screen, only = null, hidden = hiddenItems(cfg, screen)) {
  load();
  const out = {};
  if (!screen || screenPrivacy(cfg, screen).active) return out;
  for (const k of screenValueKeys(screen, hidden, cfg.widgets)) {
    if (only && !only.has(k)) continue;
    const rec = values.get(k);
    out[k] = rec ? displayValue(rec) : null;
  }
  return out;
}

/** GET /api/display/values, and a stream that just opened (`hide`: the items its conditions hide now). */
export function valuesSnapshot(cfg, screen) {
  const hidden = hiddenItems(cfg, screen);
  const snap = { rev, full: true, screenId: screen.id, values: screenValues(cfg, screen, null, hidden) };
  return hasConditions(screen) ? { ...snap, hide: [...hidden] } : snap;
}

// conditions read the stored value; a Home Assistant condition that changed sends its screens' values again
setConditionSource({ value: (k) => (load(), values.get(k)?.value ?? null) });
onConditionChange((ids, src) => {
  if (src !== 'ha') return;
  const cfg = getConfig();
  for (const id of ids) {
    const screen = cfg.screens?.find((s) => s.id === id);
    if (screen && (screenValueKeys(screen, null, cfg.widgets).size || conditionKeys(screen).size)) broadcast('values', valuesSnapshot(cfg, screen), { screenIds: [screen.id] });
  }
});

function queue(key) {
  changed.add(key);
  if (flushTimer) return;
  flushTimer = setTimeout(flushEvents, VALUES_TIMING.coalesceMs);
  flushTimer.unref?.();
}

function flushEvents() {
  flushTimer = null;
  if (!changed.size) return;
  const keys = new Set(changed);
  changed.clear();
  rev++;
  const cfg = getConfig();
  const condScreens = [];
  for (const screen of cfg.screens ?? []) {
    // a key a condition reads: everything again (an item may show or hide, and its values with it)
    // (only when an item shows or hides: a new reading that changes nothing goes as a plain update, or not at all)
    const cond = conditionKeys(screen);
    if ([...keys].some((k) => cond.has(k)) && hideChanged(cfg, screen)) {
      condScreens.push(screen.id);
      broadcast('values', valuesSnapshot(cfg, screen), { screenIds: [screen.id] });
      continue;
    }
    const used = screenValueKeys(screen, null, cfg.widgets);
    if (![...keys].some((k) => used.has(k))) continue;
    const vals = screenValues(cfg, screen, keys);
    if (!Object.keys(vals).length) continue;
    // carousel-aware: sse.js matches a carousel's displays by its screens
    broadcast('values', { rev, full: false, screenId: screen.id, values: vals }, { screenIds: [screen.id] });
  }
  conditionChanged(condScreens, 'value');
}

/** A stream just opened: the values of its screen (each screen of its carousel) that use any. */
export function valuesStreamHello(client) {
  if (client.notFound) return;
  const cfg = getConfig();
  const ids = client.memberIds?.length ? client.memberIds : [client.screenId];
  for (const id of ids) {
    const screen = cfg.screens.find((x) => x.id === id);
    if (screen && (screenValueKeys(screen, null, cfg.widgets).size || hasConditions(screen))) send(client, 'values', valuesSnapshot(cfg, screen));
  }
}

// ---- writes ---------------------------------------------------------------------------------------------------

function store(key, rec) {
  values.set(key, rec);
  lastAt.set(key, rec.at);
  scheduleSave();
  queue(key);
}

/**
 * Store parsed values (core/valuesCore.js parseValues). Returns { ok, stored, waiting } or { error, status } when a
 * new key would go over the limit of keys (nothing is stored then).
 */
export function putValues(list, { by = '', now = Date.now(), maxKeys = VALUES_LIMITS.keys } = {}) {
  load();
  const known = new Set([...values.keys(), ...waiting.keys()]);
  const fresh = list.filter((x) => !known.has(x.key)).length;
  if (known.size + fresh > maxKeys) {
    return { error: `at most ${maxKeys} keys; delete some with DELETE /api/hooks/values/:key`, status: 409 };
  }
  let stored = 0;
  let held = 0;
  for (const x of list) {
    const rec = { value: x.value, at: now };
    // unit and label are kept from the last update when this one does not send them
    const old = values.get(x.key);
    const unit = x.unit !== undefined ? x.unit : old?.unit;
    const label = x.label !== undefined ? x.label : old?.label;
    if (unit) rec.unit = unit;
    if (label) rec.label = label;
    if (by) rec.by = by.slice(0, 60);
    const since = now - (lastAt.get(x.key) ?? -Infinity);
    if (since >= VALUES_TIMING.windowMs && !waiting.has(x.key)) {
      store(x.key, rec);
      stored++;
      continue;
    }
    held++;
    const w = waiting.get(x.key);
    if (w) {
      w.rec = rec;
      continue;
    }
    const entry = { rec, timer: null };
    entry.timer = setTimeout(() => {
      waiting.delete(x.key);
      // the time is when it was stored: "hace 1 min" counts from the value shown
      store(x.key, { ...entry.rec, at: Math.max(entry.rec.at, Date.now()) });
    }, Math.max(0, VALUES_TIMING.windowMs - since));
    entry.timer.unref?.();
    waiting.set(x.key, entry);
  }
  return { ok: true, stored, waiting: held };
}

/** Clear a key (DELETE /api/hooks/values/:key): its cards show "Sin datos". True when it existed. */
export function deleteValue(key) {
  load();
  const w = waiting.get(key);
  if (w) {
    clearTimeout(w.timer);
    waiting.delete(key);
  }
  const had = values.delete(key) || !!w;
  lastAt.delete(key);
  if (had) {
    scheduleSave();
    queue(key);
  }
  return had;
}

/** Every stored value (GET /api/hooks/values, the admin): [{ key, value, unit?, label?, updatedAt, screens }]. */
export function listValues(cfg = getConfig()) {
  load();
  const used = new Map();
  for (const s of cfg.screens ?? []) for (const k of screenValueKeys(s, null, cfg.widgets)) used.set(k, [...(used.get(k) ?? []), s.slug || s.id]);
  return [...values.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, r]) => ({
    key, value: r.value, ...(r.unit ? { unit: r.unit } : {}), ...(r.label ? { label: r.label } : {}),
    updatedAt: new Date(r.at).toISOString(), screens: used.get(key) ?? [],
  }));
}

export function _resetValues() {
  for (const w of waiting.values()) clearTimeout(w.timer);
  waiting.clear();
  lastAt.clear();
  changed.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  dirty = false;
  values = null;
  loadedFrom = null;
  rev = 0;
}
