// Familia: members, routines (chores) with stars, rewards and the week's meals. Pure functions: no fs, no express,
// no store, so Marco Cloud runs the same code. The caller passes `today` (YYYY-MM-DD in the configured zone), `hhmm`
// and `at` (ISO time), stores the state (data/family.json in server/family.js) and broadcasts changes. See
// docs/ARCHITECTURE.md (Familia) and docs/API.md (Familia).
//
// Config (config.json `family`, validated by sanitizeFamily) says who is in the family and what they do; the state
// says what was done: completions by local date, redemptions, admin adjustments and `base` (points of entries older
// than RETENTION_DAYS, folded in so balances never change when old entries are dropped). Points are never stored
// as a balance: pointsOf() adds them up from the entries.
import { addDays } from './lib/tz.js';
import { PHOTO_ID_RE, photoPath } from './familyPhotoCore.js';
import { mealiePhotoPath, mealieUrlOk, normalizeMealieUrl } from './mealieCore.js';

export const MAX_MEMBERS = 6;
export const MAX_CHORES = 80;
export const MAX_REWARDS = 20;
export const MAX_MEAL_WEEKS = 26;
export const RETENTION_DAYS = 90;
export const CHORE_SLOTS = Object.freeze(['morning', 'afternoon', 'evening', 'any']);
export const MEAL_SLOTS = Object.freeze(['breakfast', 'lunch', 'snack', 'dinner']);
/** When the afternoon and the evening start (the morning runs from midnight). */
export const SLOT_STARTS = Object.freeze({ afternoon: '12:00', evening: '18:00' });
/** Default member colours, in order. */
export const PASTELS = Object.freeze(['#ff8fab', '#7cc6fe', '#9be3a0', '#ffc46b', '#c3a6ff', '#7fe0d6']);
/** Layouts made for families (Modern style only; the display falls back to bigCalendar with Classic). */
export const KIDS_PRESETS = Object.freeze(['kidsRoutines', 'kidsFamily', 'kidsMeals']);
/** Only the kids layouts draw the family page's QR (with the Modern style; Classic shows the big calendar). */
export const showsFamilyQr = (screen) => KIDS_PRESETS.includes(screen?.layout?.preset) && (screen?.screen?.style ?? 'modern') === 'modern';
/** Family link key: fk_ + base64url(24 random bytes). */
export const FAMILY_KEY_RE = /^fk_[A-Za-z0-9_-]{32}$/;
export const WEEK_KEY_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
export const MAX_MEAL_TEXT = 120;
export const MAX_NOTE = 80;
export const MAX_DELTA = 500;
/** State caps (a hand-edited or imported file never grows without limit). */
const MAX_DATES = 120;
const MAX_PER_DATE = 200;
const MAX_REDEMPTIONS = 500;
const MAX_ADJUSTMENTS = 500;
const BY = ['phone', 'display', 'admin'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX6 = /^#[0-9a-f]{6}$/i;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

/** Random hex id with a prefix (Web Crypto: works in Node, browsers and Workers). */
export function newId(prefix, bytes = 6) {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return prefix + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- config

export const defaultFamily = () => ({
  enabled: false,
  members: [],
  chores: [],
  rewards: [],
  showPoints: true,
  allowRedeemFromPhone: false,
  privacy: 'initials',
  meals: { enabled: false, slots: ['breakfast', 'lunch', 'dinner'], useTemplate: true, template: {}, weeks: {} },
});

/** Per-screen part (config.screens[].family): who appears, touch on the TV, the QR card. */
export const defaultScreenFamily = () => ({ memberIds: null, touch: false, showQr: true });

// Tiny coercers (the same rules as validate.js, kept here so this file ports alone). `err(path, message)`.
const cleanText = (s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ''); // eslint-disable-line no-control-regex
function bool(err, path, v, d) {
  if (v === undefined) return d;
  if (typeof v === 'boolean') return v;
  err(path, 'expected boolean');
  return d;
}
function text(err, path, v, d, max) {
  if (v === undefined || v === null) return d;
  if (typeof v !== 'string') { err(path, 'expected string'); return d; }
  const s = cleanText(v).trim();
  if (s.length > max) { err(path, `too long (max ${max})`); return s.slice(0, max).trim(); }
  return s;
}
function required(err, path, v, max) {
  const s = text(err, path, v, '', max);
  if (!s) err(path, 'required');
  return s;
}
function int(err, path, v, d, min, max) {
  if (v === undefined || v === null || v === '') return d;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) { err(path, 'expected number'); return d; }
  if (n < min || n > max) { err(path, `must be between ${min} and ${max}`); return d; }
  return Math.round(n);
}
function oneOf(err, path, v, d, list) {
  if (v === undefined) return d;
  if (list.includes(v)) return v;
  err(path, `must be one of ${list.join(', ')}`);
  return d;
}
function list(err, path, v, max) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) { err(path, 'expected array'); return []; }
  if (v.length > max) { err(path, `too many items (max ${max})`); return v.slice(0, max); }
  return v;
}
/** A profile photo id (familyPhotoCore.js) or null: the emoji avatar. */
function photoId(err, path, v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string' && PHOTO_ID_RE.test(v)) return v;
  err(path, 'invalid photo id');
  return null;
}

function id(v, prefix, seen) {
  let s = typeof v === 'string' && ID.test(v) ? v : newId(prefix);
  while (seen.has(s)) s = newId(prefix);
  seen.add(s);
  return s;
}
function weekdays(err, path, v) {
  const l = list(err, path, v, 7);
  const out = [...new Set(l.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  if (out.length !== l.length) err(path, 'weekdays must be unique integers 0..6 (0 = Sunday)');
  return out;
}

/** { '0'..'6': { slot: text } } with empty texts, days and unknown slots removed. */
function mealDays(err, path, v) {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) { err(path, 'expected object'); return {}; }
  const out = {};
  for (const [day, slots] of Object.entries(v)) {
    if (!/^[0-6]$/.test(day)) { err(`${path}.${day}`, 'day must be 0..6 (0 = Sunday)'); continue; }
    if (!isObj(slots)) { err(`${path}.${day}`, 'expected object'); continue; }
    const d = {};
    for (const slot of MEAL_SLOTS) {
      const s = text(err, `${path}.${day}.${slot}`, slots[slot], '', MAX_MEAL_TEXT);
      if (s) d[slot] = s;
    }
    if (Object.keys(d).length) out[day] = d;
  }
  return out;
}

/**
 * The global `family` block. `sourceIds` = calendar ids a member may be linked to (sources + local + birthdays);
 * an unknown one becomes null without an error (deleting a calendar is legit). Undefined = any id-shaped value.
 */
export function sanitizeFamily(raw, err = () => {}, sourceIds) {
  const D = defaultFamily();
  let x = raw;
  if (x === undefined) x = {};
  if (!isObj(x)) { err('family', 'expected object'); x = {}; }
  const known = Array.isArray(sourceIds) ? new Set(sourceIds) : null;

  const memberSeen = new Set();
  const members = list(err, 'family.members', x.members, MAX_MEMBERS).map((m, i) => {
    const p = `family.members[${i}]`;
    if (!isObj(m)) { err(p, 'expected object'); return null; }
    let color = PASTELS[i % PASTELS.length];
    if (m.color !== undefined && m.color !== null && m.color !== '') {
      if (typeof m.color === 'string' && HEX6.test(m.color.trim())) color = m.color.trim().toLowerCase();
      else err(`${p}.color`, 'invalid color (#rrggbb)');
    }
    const cal = typeof m.calendarId === 'string' && ID.test(m.calendarId) && (!known || known.has(m.calendarId)) ? m.calendarId : null;
    return {
      id: id(m.id, 'm_', memberSeen),
      name: required(err, `${p}.name`, m.name, 30),
      color,
      avatar: text(err, `${p}.avatar`, m.avatar, '', 16) || '🙂',
      photo: photoId(err, `${p}.photo`, m.photo),
      kid: bool(err, `${p}.kid`, m.kid, true),
      calendarId: cal,
    };
  }).filter(Boolean);
  const memberIds = new Set(members.map((m) => m.id));

  const choreSeen = new Set();
  const chores = list(err, 'family.chores', x.chores, MAX_CHORES).map((c, i) => {
    const p = `family.chores[${i}]`;
    if (!isObj(c)) { err(p, 'expected object'); return null; }
    // a routine of a member that is gone goes with them (the admin deletes both; this is the safety net)
    if (typeof c.memberId !== 'string' || !memberIds.has(c.memberId)) { err(`${p}.memberId`, 'unknown member'); return null; }
    return {
      id: id(c.id, 'h_', choreSeen),
      memberId: c.memberId,
      title: required(err, `${p}.title`, c.title, 60),
      emoji: text(err, `${p}.emoji`, c.emoji, '', 16) || '⭐',
      days: weekdays(err, `${p}.days`, c.days),
      slot: oneOf(err, `${p}.slot`, c.slot, 'any', CHORE_SLOTS),
      points: int(err, `${p}.points`, c.points, 1, 0, 20),
      enabled: bool(err, `${p}.enabled`, c.enabled, true),
    };
  }).filter(Boolean);

  const rewardSeen = new Set();
  const rewards = list(err, 'family.rewards', x.rewards, MAX_REWARDS).map((w, i) => {
    const p = `family.rewards[${i}]`;
    if (!isObj(w)) { err(p, 'expected object'); return null; }
    return {
      id: id(w.id, 'w_', rewardSeen),
      title: required(err, `${p}.title`, w.title, 60),
      emoji: text(err, `${p}.emoji`, w.emoji, '', 16) || '🎁',
      cost: int(err, `${p}.cost`, w.cost, 10, 1, MAX_DELTA),
    };
  }).filter(Boolean);

  let me = x.meals;
  if (me === undefined) me = {};
  if (!isObj(me)) { err('family.meals', 'expected object'); me = {}; }
  const slotList = me.slots === undefined ? D.meals.slots : list(err, 'family.meals.slots', me.slots, MEAL_SLOTS.length);
  if (slotList.some((s) => !MEAL_SLOTS.includes(s))) err('family.meals.slots', `must be some of ${MEAL_SLOTS.join(', ')}`);
  const weeks = {};
  let rawWeeks = me.weeks;
  if (rawWeeks === undefined || rawWeeks === null) rawWeeks = {};
  if (!isObj(rawWeeks)) { err('family.meals.weeks', 'expected object'); rawWeeks = {}; }
  for (const [k, v] of Object.entries(rawWeeks)) {
    if (!WEEK_KEY_RE.test(k)) { err(`family.meals.weeks.${k}`, 'week must be YYYY-Www'); continue; }
    const days = mealDays(err, `family.meals.weeks.${k}`, v);
    if (Object.keys(days).length) weeks[k] = days;
  }
  // Only the newest weeks are kept: older ones go quietly (a family that plans every week would otherwise hit the
  // limit after half a year and could not save). The keys sort as dates.
  const keep = Object.keys(weeks).sort().slice(-MAX_MEAL_WEEKS);
  const meals = {
    enabled: bool(err, 'family.meals.enabled', me.enabled, D.meals.enabled),
    slots: MEAL_SLOTS.filter((s) => slotList.includes(s)),
    useTemplate: bool(err, 'family.meals.useTemplate', me.useTemplate, D.meals.useTemplate),
    template: mealDays(err, 'family.meals.template', me.template),
    weeks: Object.fromEntries(keep.map((k) => [k, weeks[k]])),
  };
  // Mealie (core/mealieCore.js, server/mealie.js): { url, photo? }, written only when a URL is set or the photo is
  // off, so configs without Mealie stay as they were. The API token is in secrets.json, never here.
  const mm = me.mealie;
  if (mm !== undefined && mm !== null) {
    if (!isObj(mm)) err('family.meals.mealie', 'expected object');
    else {
      const url = normalizeMealieUrl(text(err, 'family.meals.mealie.url', mm.url, '', 512));
      if (url && !mealieUrlOk(url)) err('family.meals.mealie.url', 'invalid URL');
      const photo = bool(err, 'family.meals.mealie.photo', mm.photo, true);
      if (url || !photo) meals.mealie = { url, ...(photo ? {} : { photo: false }) };
    }
  }

  return {
    enabled: bool(err, 'family.enabled', x.enabled, D.enabled),
    members, chores, rewards,
    showPoints: bool(err, 'family.showPoints', x.showPoints, D.showPoints),
    allowRedeemFromPhone: bool(err, 'family.allowRedeemFromPhone', x.allowRedeemFromPhone, D.allowRedeemFromPhone),
    privacy: oneOf(err, 'family.privacy', x.privacy, D.privacy, ['initials', 'hide']),
    meals,
  };
}

/** A screen's `family` block. `memberIds` = ids of the current members (unknown ones are dropped quietly). */
export function sanitizeScreenFamily(raw, err = () => {}, path = 'family', memberIds = null) {
  const D = defaultScreenFamily();
  let x = raw;
  if (x === undefined) x = {};
  if (!isObj(x)) { err(path, 'expected object'); x = {}; }
  let ids = null;
  if (x.memberIds !== undefined && x.memberIds !== null) {
    const known = memberIds ? new Set(memberIds) : null;
    ids = [...new Set(list(err, `${path}.memberIds`, x.memberIds, MAX_MEMBERS)
      .filter((v) => typeof v === 'string' && ID.test(v) && (!known || known.has(v))))];
  }
  return {
    memberIds: ids,
    touch: bool(err, `${path}.touch`, x.touch, D.touch),
    showQr: bool(err, `${path}.showQr`, x.showQr, D.showQr),
  };
}

// ---------------------------------------------------------------- dates, slots, meals

const utc = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** 0..6, 0 = Sunday. */
export const dayOfWeek = (date) => utc(date).getUTCDay();

/** ISO 8601 week of a date ('2026-W42'): the week belongs to the year of its Thursday. */
export function isoWeekKey(date) {
  const d = utc(date);
  const mon0 = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thu = new Date(d.getTime() + (3 - mon0) * 86400000);
  const y = thu.getUTCFullYear();
  const week = 1 + Math.floor((thu.getTime() - Date.UTC(y, 0, 1)) / 86400000 / 7);
  return `${y}-W${pad(week)}`;
}

/** First day of the week that holds `date`, weeks starting on `weekStart` (0 = Sunday, 1 = Monday…). */
export function weekStartOf(date, weekStart = 1) {
  return addDays(date, -((dayOfWeek(date) - weekStart + 7) % 7));
}

/** 'morning' before 12:00, 'afternoon' before 18:00, else 'evening'. */
export function slotAt(hhmm) {
  if (hhmm < SLOT_STARTS.afternoon) return 'morning';
  if (hhmm < SLOT_STARTS.evening) return 'afternoon';
  return 'evening';
}

/**
 * Meals of one date for the enabled slots ({ breakfast: 'Tostadas' }). A week with its own plan only uses its own
 * days (an empty day there stays empty); a week without one shows the template when `useTemplate` is on.
 * `overlay` (optional): meals from outside, { 'YYYY-MM-DD': { slot: text } } (Mealie, core/mealieCore.js); per meal
 * its text wins, and the meals it has nothing for keep the plan above.
 */
export function mealsForDate(meals, date, overlay = null) {
  if (!meals) return {};
  const dow = String(dayOfWeek(date));
  const wk = meals.weeks?.[isoWeekKey(date)];
  const day = wk ? wk[dow] || {} : meals.useTemplate ? meals.template?.[dow] || {} : {};
  const ext = overlay?.[date];
  const out = {};
  for (const s of meals.slots || []) {
    const v = (typeof ext?.[s] === 'string' && ext[s]) || day[s];
    if (v) out[s] = v;
  }
  return out;
}

/** 7 days from `startDate`: [{ date, dow, meals }]. `overlay` as in mealsForDate(). */
export function mealsOfWeek(meals, startDate, overlay = null) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startDate, i);
    return { date, dow: dayOfWeek(date), meals: mealsForDate(meals, date, overlay) };
  });
}

/**
 * The week for a screen, with the dinner's photo (`photo`, an address) on the days whose Mealie dinner has one, when
 * the photo setting is on, dinner is shown and `photoUrl` is given (the caller leaves it out while the screen hides
 * photos).
 */
function mealsWeekView(meals, startDate, overlay, photoUrl) {
  const days = mealsOfWeek(meals, startDate, overlay);
  if (!overlay || !photoUrl || meals.mealie?.photo === false || !(meals.slots || []).includes('dinner')) return days;
  return days.map((d) => {
    const p = overlay[d.date]?.photo;
    const url = p && d.meals.dinner ? photoUrl(p) : null;
    return url ? { ...d, photo: url } : d;
  });
}

// ---------------------------------------------------------------- routines and points

/**
 * Enabled routines scheduled on `date` (days [] = every day) for the members in `memberIds` (null = everyone),
 * ordered by member, then slot (morning, afternoon, evening, any), then config order.
 */
export function choresForDay(family, date, memberIds = null) {
  const dow = dayOfWeek(date);
  const order = new Map(family.members.map((m, i) => [m.id, i]));
  const only = memberIds ? new Set(memberIds) : null;
  return family.chores
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.enabled && order.has(c.memberId) && (!only || only.has(c.memberId)) && (!c.days.length || c.days.includes(dow)))
    .sort((a, b) => order.get(a.c.memberId) - order.get(b.c.memberId)
      || CHORE_SLOTS.indexOf(a.c.slot) - CHORE_SLOTS.indexOf(b.c.slot) || a.i - b.i)
    .map(({ c }) => c);
}

/**
 * Is routine `c` done in `day` (one date of state.completions)? Only when it was done by the person it belongs to
 * now: a routine moved to someone else on the same day starts undone for them.
 */
const doneBy = (day, c) => day?.[c.id]?.memberId === c.memberId;

/** { [memberId]: { done, total } } for `date` (members in `memberIds`, null = everyone). */
export function todayProgress(family, state, date, memberIds = null) {
  const done = state?.completions?.[date] || {};
  const only = memberIds ? new Set(memberIds) : null;
  const out = {};
  for (const m of family.members) if (!only || only.has(m.id)) out[m.id] = { done: 0, total: 0 };
  for (const c of choresForDay(family, date, memberIds)) {
    out[c.memberId].total++;
    if (doneBy(done, c)) out[c.memberId].done++;
  }
  return out;
}

/**
 * Star balance of every kid: base + completions + adjustments − redemptions. The raw value can go below zero
 * (an undo, an admin redeem with force); screens show max(0, n).
 */
export function pointsOf(family, state) {
  const out = {};
  for (const m of family.members) if (m.kid) out[m.id] = Number(state?.base?.[m.id]) || 0;
  const add = (mid, n) => { if (mid in out) out[mid] += n; };
  for (const day of Object.values(state?.completions || {})) for (const c of Object.values(day)) add(c.memberId, c.points);
  for (const a of state?.adjustments || []) add(a.memberId, a.delta);
  for (const r of state?.redemptions || []) add(r.memberId, -r.cost);
  return out;
}

// ---------------------------------------------------------------- state

export const emptyState = () => ({ version: 1, rev: 0, completions: {}, redemptions: [], adjustments: [], base: {} });

const isoAt = (v) => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);
const smallInt = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
const str = (v, max) => (typeof v === 'string' ? cleanText(v).slice(0, max) : '');

/** Fold entries that are dropped into `base`, so the balances stay the same. */
function fold(base, memberId, n) {
  if (!n) return;
  base[memberId] = (Number(base[memberId]) || 0) + n;
}

/** A stored or imported state with malformed entries dropped and the caps applied (dropped entries fold into base). */
export function sanitizeState(raw) {
  const out = emptyState();
  if (!isObj(raw)) return out;
  out.rev = smallInt(raw.rev, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  if (isObj(raw.base)) {
    for (const [mid, n] of Object.entries(raw.base)) if (ID.test(mid) && Number.isInteger(n) && Math.abs(n) < 1e9) out.base[mid] = n;
  }
  const dates = isObj(raw.completions) ? Object.keys(raw.completions).filter((d) => DATE.test(d) && isObj(raw.completions[d])).sort() : [];
  const cut = dates.length > MAX_DATES ? dates.length - MAX_DATES : 0;
  dates.forEach((date, i) => {
    const day = {};
    for (const [cid, c] of Object.entries(raw.completions[date])) {
      if (!ID.test(cid) || !isObj(c) || typeof c.memberId !== 'string' || !ID.test(c.memberId)) continue;
      const points = smallInt(c.points, 0, 20);
      const at = isoAt(c.at);
      if (points === null || !at) continue;
      if (i < cut || Object.keys(day).length >= MAX_PER_DATE) { fold(out.base, c.memberId, points); continue; }
      day[cid] = { memberId: c.memberId, points, title: str(c.title, 60), emoji: str(c.emoji, 16), by: BY.includes(c.by) ? c.by : 'admin', at };
    }
    if (Object.keys(day).length) out.completions[date] = day;
  });
  const entries = (v, ok, max, sign) => {
    const l = (Array.isArray(v) ? v : []).filter(ok).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const drop = l.length > max ? l.splice(0, l.length - max) : [];
    for (const e of drop) fold(out.base, e.memberId, sign(e));
    return l;
  };
  out.redemptions = entries(raw.redemptions, (r) => isObj(r) && typeof r.id === 'string' && ID.test(r.id) && typeof r.memberId === 'string'
    && ID.test(r.memberId) && smallInt(r.cost, 0, MAX_DELTA) !== null && isoAt(r.at), MAX_REDEMPTIONS, (r) => -r.cost)
    .map((r) => ({
      id: r.id, rewardId: typeof r.rewardId === 'string' ? r.rewardId.slice(0, 64) : '', memberId: r.memberId,
      title: str(r.title, 60), emoji: str(r.emoji, 16), cost: r.cost, by: r.by === 'phone' ? 'phone' : 'admin', at: r.at,
    }));
  out.adjustments = entries(raw.adjustments, (a) => isObj(a) && typeof a.id === 'string' && ID.test(a.id) && typeof a.memberId === 'string'
    && ID.test(a.memberId) && smallInt(a.delta, -MAX_DELTA, MAX_DELTA) && isoAt(a.at), MAX_ADJUSTMENTS, (a) => a.delta)
    .map((a) => ({ id: a.id, memberId: a.memberId, delta: a.delta, note: str(a.note, MAX_NOTE), at: a.at }));
  return out;
}

/**
 * Drop completions of dates before `today − RETENTION_DAYS`, and redemptions / adjustments made before that day,
 * after adding their points to `base`. Totals stay equal. Returns a new state (the same object when nothing went).
 */
export function pruneState(state, today) {
  const cutoff = addDays(today, -RETENTION_DAYS);
  const old = (e) => String(e.at).slice(0, 10) < cutoff;
  const oldDates = Object.keys(state.completions).filter((d) => d < cutoff);
  if (!oldDates.length && !state.redemptions.some(old) && !state.adjustments.some(old)) return state;
  const base = { ...state.base };
  const completions = { ...state.completions };
  for (const d of oldDates) {
    for (const c of Object.values(completions[d])) fold(base, c.memberId, c.points);
    delete completions[d];
  }
  for (const r of state.redemptions) if (old(r)) fold(base, r.memberId, -r.cost);
  for (const a of state.adjustments) if (old(a)) fold(base, a.memberId, a.delta);
  return {
    ...state, base, completions,
    redemptions: state.redemptions.filter((r) => !old(r)),
    adjustments: state.adjustments.filter((a) => !old(a)),
  };
}

/** Keep the newest `max` entries of a list, folding the others into base. */
function capped(list, max, base, sign) {
  if (list.length <= max) return list;
  for (const e of list.slice(0, list.length - max)) fold(base, e.memberId, sign(e));
  return list.slice(list.length - max);
}

/**
 * Tick or untick a routine on `date`. The completion keeps a copy of the routine's points (kids only; adults earn
 * none), title and emoji, so editing the routine later never rewrites history. Idempotent.
 * @returns {{ state, changed: boolean, chore, member } | { error: 'unknown_chore' | 'not_today' }}
 */
export function applyToggle(family, state, { choreId, date, done, by = 'admin', at }) {
  const chore = family.chores.find((c) => c.id === choreId && c.enabled);
  const member = chore && family.members.find((m) => m.id === chore.memberId);
  if (!chore || !member) return { error: 'unknown_chore' };
  if (chore.days.length && !chore.days.includes(dayOfWeek(date))) return { error: 'not_today' };
  const day = state.completions[date] || {};
  // a completion of the person the routine had before does not count (ticking replaces it)
  const has = doneBy(day, chore);
  if (has === Boolean(done)) return { state, changed: false, chore, member };
  const nextDay = { ...day };
  if (done) {
    nextDay[choreId] = {
      memberId: member.id, points: member.kid ? chore.points : 0, title: chore.title, emoji: chore.emoji,
      by: BY.includes(by) ? by : 'admin', at,
    };
  } else delete nextDay[choreId];
  const completions = { ...state.completions, [date]: nextDay };
  if (!Object.keys(nextDay).length) delete completions[date];
  return { state: { ...state, rev: state.rev + 1, completions }, changed: true, chore, member };
}

/**
 * Redeem a reward for a kid. `force` (admin only) allows going below zero.
 * @returns {{ state, entry, member } | { error: 'unknown_reward' | 'unknown_member' | 'not_kid' | 'not_enough' }}
 */
export function applyRedeem(family, state, { rewardId, memberId, by = 'admin', at, id = newId('rd_'), force = false }) {
  const reward = family.rewards.find((w) => w.id === rewardId);
  if (!reward) return { error: 'unknown_reward' };
  const member = family.members.find((m) => m.id === memberId);
  if (!member) return { error: 'unknown_member' };
  if (!member.kid) return { error: 'not_kid' };
  if (!force && (pointsOf(family, state)[member.id] || 0) < reward.cost) return { error: 'not_enough' };
  const entry = { id, rewardId: reward.id, memberId: member.id, title: reward.title, emoji: reward.emoji, cost: reward.cost, by: by === 'phone' ? 'phone' : 'admin', at };
  const base = { ...state.base };
  const redemptions = capped([...state.redemptions, entry], MAX_REDEMPTIONS, base, (r) => -r.cost);
  return { state: { ...state, rev: state.rev + 1, base, redemptions }, entry, member };
}

/**
 * Add or take stars by hand (admin).
 * @returns {{ state, entry, member } | { error: 'unknown_member' | 'not_kid' | 'bad_delta' }}
 */
export function applyAdjust(family, state, { memberId, delta, note = '', at, id = newId('ad_') }) {
  const member = family.members.find((m) => m.id === memberId);
  if (!member) return { error: 'unknown_member' };
  if (!member.kid) return { error: 'not_kid' };
  const n = typeof delta === 'string' && delta.trim() ? Number(delta) : delta;
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > MAX_DELTA) return { error: 'bad_delta' };
  const entry = { id, memberId: member.id, delta: n, note: typeof note === 'string' ? cleanText(note).trim().slice(0, MAX_NOTE) : '', at };
  const base = { ...state.base };
  const adjustments = capped([...state.adjustments, entry], MAX_ADJUSTMENTS, base, (a) => a.delta);
  return { state: { ...state, rev: state.rev + 1, base, adjustments }, entry, member };
}

/**
 * Undo a redemption (the stars come back) or an adjustment.
 * @returns {{ state, entry } | { error: 'not_found' }}
 */
export function undoEntry(state, { kind, id }) {
  const key = kind === 'redemption' ? 'redemptions' : kind === 'adjustment' ? 'adjustments' : null;
  const entry = key && state[key].find((e) => e.id === id);
  if (!entry) return { error: 'not_found' };
  return { state: { ...state, rev: state.rev + 1, [key]: state[key].filter((e) => e.id !== id) }, entry };
}

// ---------------------------------------------------------------- projections

/** 'L' for "Lucía", 'MJ' for "María José": first letters of the first two words, upper case. */
export function initials(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => Array.from(w)[0].toLocaleUpperCase()).join('');
}

/**
 * The next reward of each kid: the cheapest one they cannot afford yet, else the most expensive they can.
 * { [memberId]: { title, emoji, cost, missing } }
 */
export function nextRewards(family, points) {
  const out = {};
  const byCost = [...family.rewards].sort((a, b) => a.cost - b.cost);
  if (!byCost.length) return out;
  for (const [mid, raw] of Object.entries(points)) {
    const p = Math.max(0, raw);
    const w = byCost.find((x) => x.cost > p) || byCost[byCost.length - 1];
    out[mid] = { title: w.title, emoji: w.emoji, cost: w.cost, missing: Math.max(0, w.cost - p) };
  }
  return out;
}

const choreRow = (c, done, member, showPoints) => ({
  id: c.id, memberId: c.memberId, title: c.title, emoji: c.emoji, slot: c.slot,
  points: showPoints && member?.kid ? c.points : 0, done: doneBy(done, c),
});

/**
 * FamilyDisplayState for one screen. `private` = the screen's privacy mode is on: with family.privacy 'initials'
 * names become initials and stars, rewards, touch and the QR go; with 'hide' routines and members go too
 * (`hidden`). Meals always stay. `qrUrl` = the family link, or null; it is only passed on by a kids layout.
 */
/**
 * `photoUrl(id)` turns a member's photo id into the address the screen loads (default /media/avatars/<id>; the
 * server can answer null when the file is gone, Marco Cloud gives a signed address). Not called in privacy mode.
 */
/**
 * `mealOverlay`: meals from Mealie for mealsForDate(); `mealPhotoUrl(photo)` the address of a dinner's photo (default
 * /media/mealie/<id>?v=<key>). The photo stays away while the screen is private with "hide photos".
 */
export function displayFamily(cfg, screen, state, { today, hhmm = '00:00', private: priv = false, qrUrl = null, generatedAt = null, photoUrl = photoPath, mealOverlay = null, mealPhotoUrl = mealiePhotoPath }) {
  const fam = cfg.family;
  const sf = screen.family || defaultScreenFamily();
  const hidden = Boolean(priv && fam.privacy === 'hide');
  const showPoints = Boolean(fam.showPoints && !priv);
  const shown = fam.members.filter((m) => !sf.memberIds || sf.memberIds.includes(m.id));
  if (sf.memberIds) shown.sort((a, b) => sf.memberIds.indexOf(a.id) - sf.memberIds.indexOf(b.id));
  const ids = shown.map((m) => m.id);
  const progress = todayProgress(fam, state, today, ids);
  const points = pointsOf(fam, state);
  const done = state.completions[today] || {};
  const byId = new Map(shown.map((m) => [m.id, m]));
  const order = new Map(ids.map((x, i) => [x, i]));
  const chores = hidden ? [] : choresForDay(fam, today, ids)
    .sort((a, b) => order.get(a.memberId) - order.get(b.memberId))
    .map((c) => choreRow(c, done, byId.get(c.memberId), showPoints));
  const members = hidden ? [] : shown.map((m) => ({
    id: m.id, name: priv ? initials(m.name) : m.name, initials: initials(m.name), color: m.color, avatar: m.avatar, kid: m.kid,
    // a photo says more than a name: in privacy mode the emoji stays and the photo goes (the photo address answers
    // 404 for a private screen too, routes/family.js)
    photo: priv || !m.photo ? null : photoUrl(m.photo) ?? null,
    // the Familia layout puts the avatar on this person's calendar events
    calendarId: m.calendarId ?? null,
    points: showPoints && m.kid ? Math.max(0, points[m.id] || 0) : null,
    done: progress[m.id].done, total: progress[m.id].total,
  }));
  const weekStart = Number.isInteger(screen.calendar?.weekStart) ? screen.calendar.weekStart : 1;
  const kidsShown = Object.fromEntries(Object.entries(points).filter(([mid]) => byId.has(mid)));
  const rewards = showPoints && !hidden ? nextRewards(fam, kidsShown) : {};
  return {
    today,
    slotNow: slotAt(hhmm),
    rev: state.rev,
    private: Boolean(priv),
    hidden,
    showPoints,
    touch: Boolean(sf.touch && !priv),
    qrUrl: fam.enabled && sf.showQr !== false && !priv && showsFamilyQr(screen) ? qrUrl : null,
    members,
    chores,
    meals: fam.meals.enabled
      ? { slots: [...fam.meals.slots], days: mealsWeekView(fam.meals, weekStartOf(today, weekStart), mealOverlay, priv && screen.privacy?.hidePhotos ? null : mealPhotoUrl) }
      : null,
    ...(Object.keys(rewards).length ? { nextReward: rewards } : {}),
    generatedAt,
  };
}

/**
 * FamilyPhoneState: what the family page (/f/<key>) needs and nothing else (no calendars, screens or config).
 * `photoUrl` and `mealOverlay` as in displayFamily().
 */
export function phoneFamily(cfg, state, { today, hhmm = '00:00', lang = 'en', photoUrl = photoPath, mealOverlay = null }) {
  const fam = cfg.family;
  const progress = todayProgress(fam, state, today);
  const points = pointsOf(fam, state);
  const done = state.completions[today] || {};
  const byId = new Map(fam.members.map((m) => [m.id, m]));
  return {
    today,
    slotNow: slotAt(hhmm),
    lang,
    rev: state.rev,
    showPoints: fam.showPoints,
    allowRedeem: fam.allowRedeemFromPhone,
    members: fam.members.map((m) => ({
      id: m.id, name: m.name, color: m.color, avatar: m.avatar, photo: m.photo ? photoUrl(m.photo) ?? null : null, kid: m.kid,
      points: fam.showPoints && m.kid ? Math.max(0, points[m.id] || 0) : null,
      done: progress[m.id].done, total: progress[m.id].total,
    })),
    chores: choresForDay(fam, today).map((c) => choreRow(c, done, byId.get(c.memberId), fam.showPoints)),
    rewards: fam.rewards.map(({ id: rid, title, emoji, cost }) => ({ id: rid, title, emoji, cost })),
    meals: fam.meals.enabled ? { slots: [...fam.meals.slots], today: mealsForDate(fam.meals, today, mealOverlay) } : null,
  };
}

/**
 * The state part of FamilyAdminState: raw balances (may be below zero), today's progress, the last 14 days of
 * completions and the last 50 redemptions and adjustments, newest first.
 */
export function adminFamily(family, state, { today }) {
  const from = addDays(today, -13);
  const completions = [];
  for (const date of Object.keys(state.completions).filter((d) => d >= from && d <= today)) {
    for (const [choreId, c] of Object.entries(state.completions[date])) {
      completions.push({ date, choreId, memberId: c.memberId, title: c.title, emoji: c.emoji, points: c.points, by: c.by, at: c.at });
    }
  }
  completions.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const last = (l) => l.slice(-50).reverse();
  return {
    today,
    rev: state.rev,
    points: pointsOf(family, state),
    progress: todayProgress(family, state, today),
    completions,
    redemptions: last(state.redemptions),
    adjustments: last(state.adjustments),
  };
}

/** HH:MM of a zoned-parts object ({ h, mi }). */
export const hhmmOf = (p) => `${pad(p.h)}:${pad(p.mi)}`;
