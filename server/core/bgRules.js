// Special backgrounds ("Fondos especiales", #14): per screen, an ordered list of rules that swap the screen's photos
// for others on some days. A rule is a "when" (an event today whose title has a word, a yearly date range, one yearly
// date, someone's birthday) and the photos to show (gallery files or one Immich album). The first rule that matches
// wins; with none, the screen's normal background. Pure: the validator, server/photoRules.js and Marco Cloud use it.
import { addDays, localDate } from './lib/tz.js';
import { fold, hash, randomId } from './lib/text.js';
import { isGalleryFile } from './imageInfo.js';
import { IMMICH_ID_RE } from './immichCore.js';
import { privatizeEvents, sourcePrivacyMode } from './privacy.js';
import { BIRTHDAYS_SOURCE_ID } from './defaults.js';

export const BG_RULE_TYPES = ['event', 'range', 'date', 'birthday'];
export const BG_RULE_SOURCES = ['gallery', 'immich'];
export const MAX_BG_RULES = 30;
export const MAX_BG_RULE_PHOTOS = 50;
export const MAX_BG_RULE_TEXT = 60;
const MAX_RULE_CALENDARS = 60;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** "MM-DD" of a real day in some year (29 February included). */
export function isMonthDay(s) {
  const m = typeof s === 'string' && MONTH_DAY.exec(s);
  if (!m) return false;
  const mo = +m[1], d = +m[2];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= DAYS_IN_MONTH[mo - 1];
}

function newId(seen) {
  let s;
  do s = randomId('bg_'); while (seen.has(s));
  return s;
}

/**
 * The `background.rules` of one screen, cleaned. `err(path, message)` records what blocks the save (an empty word, a
 * rule without photos, a bad date); file names that cannot be gallery files and calendars that no longer exist are
 * dropped quietly. `sourceIds` = calendar ids a rule may name (null = any); `immichAvailable` false refuses Immich
 * rules (Marco Cloud has no Immich).
 */
export function sanitizeBackgroundRules(raw, { err = () => {}, path = 'background.rules', sourceIds = null, immichAvailable = true } = {}) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) { err(path, 'expected array'); return []; }
  let list = raw;
  if (list.length > MAX_BG_RULES) { err(path, `too many items (max ${MAX_BG_RULES})`); list = list.slice(0, MAX_BG_RULES); }
  const known = Array.isArray(sourceIds) ? new Set(sourceIds) : null;
  const seen = new Set();
  const out = [];
  list.forEach((r, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(r)) { err(p, 'expected object'); return; }
    const id = typeof r.id === 'string' && ID.test(r.id) && !seen.has(r.id) ? r.id : newId(seen);
    seen.add(id);
    const w = isObj(r.when) ? r.when : {};
    if (r.when !== undefined && !isObj(r.when)) err(`${p}.when`, 'expected object');
    let type = w.type;
    if (!BG_RULE_TYPES.includes(type)) { err(`${p}.when.type`, `must be one of ${BG_RULE_TYPES.join(', ')}`); type = 'event'; }
    let when;
    if (type === 'event') {
      let text = typeof w.text === 'string' ? w.text.replace(/\s+/g, ' ').trim() : '';
      if (text.length > MAX_BG_RULE_TEXT) { err(`${p}.when.text`, `too long (max ${MAX_BG_RULE_TEXT})`); text = text.slice(0, MAX_BG_RULE_TEXT); }
      if (!text) err(`${p}.when.text`, 'required');
      const cals = Array.isArray(w.calendars) ? w.calendars : [];
      if (w.calendars !== undefined && !Array.isArray(w.calendars)) err(`${p}.when.calendars`, 'expected array');
      const calendars = [...new Set(cals.filter((c) => typeof c === 'string' && ID.test(c) && (!known || known.has(c))))].slice(0, MAX_RULE_CALENDARS);
      when = { type, text, calendars };
    } else if (type === 'range') {
      const from = isMonthDay(w.from) ? w.from : '01-01';
      const to = isMonthDay(w.to) ? w.to : from;
      if (!isMonthDay(w.from)) err(`${p}.when.from`, 'invalid date (MM-DD)');
      if (!isMonthDay(w.to)) err(`${p}.when.to`, 'invalid date (MM-DD)');
      when = { type, from, to };
    } else if (type === 'date') {
      if (!isMonthDay(w.on)) err(`${p}.when.on`, 'invalid date (MM-DD)');
      when = { type, on: isMonthDay(w.on) ? w.on : '01-01' };
    } else {
      when = { type };
    }
    const ph = isObj(r.photos) ? r.photos : {};
    let source = ph.source === undefined ? 'gallery' : ph.source;
    if (!BG_RULE_SOURCES.includes(source)) { err(`${p}.photos.source`, `must be one of ${BG_RULE_SOURCES.join(', ')}`); source = 'gallery'; }
    let photos;
    if (source === 'immich') {
      const albumId = typeof ph.albumId === 'string' && IMMICH_ID_RE.test(ph.albumId) ? ph.albumId.toLowerCase() : '';
      if (!albumId) err(`${p}.photos.albumId`, 'invalid album id');
      if (immichAvailable === false) err(`${p}.photos.source`, 'Immich is not available');
      photos = { source, albumId };
    } else {
      const raw = Array.isArray(ph.files) ? ph.files : [];
      let files = [...new Set(raw.filter(isGalleryFile))];
      if (files.length > MAX_BG_RULE_PHOTOS) { err(`${p}.photos.files`, `too many items (max ${MAX_BG_RULE_PHOTOS})`); files = files.slice(0, MAX_BG_RULE_PHOTOS); }
      if (!files.length) err(`${p}.photos.files`, 'at least one photo');
      photos = { source, files };
    }
    out.push({ id, when, photos });
  });
  return out;
}

// ---------------------------------------------------------------- matching

/** True when the yearly range `from`..`to` (MM-DD, inclusive) holds the day `today` (YYYY-MM-DD). `to < from` wraps the year end. */
export function inYearlyRange(today, from, to) {
  const md = today.slice(5);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/** 29 February falls on the 28th in other years (as the birthdays calendar does). */
function yearlyMatch(today, md) {
  if (md === '02-29') {
    const y = +today.slice(0, 4);
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return today.slice(5) === (leap ? '02-29' : '02-28');
  }
  return today.slice(5) === md;
}

/** An event (wire shape) that takes place on `today` in `tz`: all-day ones by their dates, timed ones by their local times. */
export function eventOnDay(e, today, tz) {
  if (!e || typeof e.start !== 'string') return false;
  if (e.allDay) {
    const end = typeof e.end === 'string' && e.end > e.start ? e.end : addDays(e.start, 1);
    return e.start <= today && today < end;
  }
  const s = Date.parse(e.start);
  if (!Number.isFinite(s)) return false;
  const en = Date.parse(e.end);
  const last = new Date(Math.max(s, (Number.isFinite(en) ? en : s) - 1));
  return localDate(new Date(s), tz) <= today && localDate(last, tz) >= today;
}

/** Some rule of the list needs today's events (the server only asks for them then). */
export const rulesNeedEvents = (rules) => Array.isArray(rules) && rules.some((r) => r.when?.type === 'event');

/** Calendar ids the event rules look at: their own, or `screenIds` (the calendars the screen shows) when they name none. */
export function ruleEventSources(rules, screenIds) {
  const out = new Set();
  for (const r of rules || []) {
    if (r.when?.type !== 'event') continue;
    for (const id of r.when.calendars?.length ? r.when.calendars : screenIds) out.add(id);
  }
  return [...out];
}

/**
 * The first rule of `rules` that holds right now, or null.
 * `today` = YYYY-MM-DD in `tz`; `events` = wire events (at least those of today) of the calendars the rules may read;
 * `screenSources` = the calendar ids the screen shows (an event rule without calendars of its own reads those);
 * `birthdays` = the birthdays list (config.birthdays.items) when that calendar is on. While the screen is private
 * the events go through privacy mode first (a "busy" calendar has no titles to match) and birthdays only count when
 * that calendar keeps its names.
 * @param {any[]} rules
 * @param {{ today: string, tz: string, events?: any[], screenSources?: string[], birthdays?: any[], cfg?: any, isPrivate?: boolean, lang?: string }} opts
 * @returns {any | null}
 */
export function matchBackgroundRule(rules, { today, tz, events = [], screenSources = [], birthdays = [], cfg = null, isPrivate = false, lang = 'en' }) {
  if (!Array.isArray(rules) || !rules.length) return null;
  let evs = (events || []).filter((e) => eventOnDay(e, today, tz));
  if (isPrivate && cfg) evs = privatizeEvents(evs, cfg, lang);
  const bdays = isPrivate && cfg && sourcePrivacyMode(cfg, BIRTHDAYS_SOURCE_ID) !== 'keep' ? [] : birthdays || [];
  const md = (b) => `${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`;
  for (const r of rules) {
    const w = r?.when;
    if (!w) continue;
    if (w.type === 'event') {
      const word = fold(w.text).trim();
      if (!word) continue;
      const ids = new Set(w.calendars?.length ? w.calendars : screenSources);
      if (evs.some((e) => ids.has(e.sourceId) && fold(e.title).includes(word))) return r;
    } else if (w.type === 'range') {
      if (inYearlyRange(today, w.from, w.to)) return r;
    } else if (w.type === 'date') {
      if (yearlyMatch(today, w.on)) return r;
    } else if (w.type === 'birthday') {
      if (bdays.some((b) => b && Number.isInteger(b.month) && Number.isInteger(b.day) && yearlyMatch(today, md(b)))) return r;
    }
  }
  return null;
}

/**
 * What a display learns about the active rule: an opaque signature ('' = none) that changes when another rule wins
 * or the winning rule is edited, so it knows to replace the photo on screen. Never the rule itself.
 */
export const backgroundRuleSig = (rule) => (rule ? hash({ id: rule.id, when: rule.when, photos: rule.photos }, 12) : '');

/** Gallery files the rules of `screen` may show (displays of that screen may load exactly these). */
export function ruleGalleryFiles(screen) {
  const out = new Set();
  for (const r of screen?.background?.rules || []) if (r.photos?.source === 'gallery') for (const f of r.photos.files || []) out.add(f);
  return out;
}

/** Immich albums the rules of `screen` play. */
export function ruleAlbumIds(screen) {
  const out = new Set();
  for (const r of screen?.background?.rules || []) if (r.photos?.source === 'immich' && r.photos.albumId) out.add(r.photos.albumId);
  return [...out];
}
