// Calendar sources: fetching (ICS / Google / Microsoft), per-source cache (refreshMin, stale-on-error, disk cache),
// merging into CalEvent[] with icon rules, kind normalisation and a stable hash.
// v2 (docs/ARCHITECTURE.md): built-in pseudo-sources `local` / `birthdays` (localEvents.js), event rules
// hide → rename → style (eventRules.js), per-screen source selection, admin preview and source error logging.
import fs from 'node:fs';
import path from 'node:path';
import { request } from './lib/http.js';
import { addDays, isoWithOffset, localDate, zonedMidnight, daysBetween } from './core/lib/tz.js';
import { fold, hash } from './lib/text.js';
import { t } from './core/lib/i18n.js';
import { parseIcsText, expandEvents } from './ics.js';
import { matchRule, normalizeAirbnbTitle, tidyTitleWhy, translateHoliday, KIND_EMOJI } from './rules.js';
import { applyEventRules } from './eventRules.js';
import { expandLocalEvents, expandBirthdays, localSource, birthdaysSource } from './localEvents.js';
import * as google from './google.js';
import * as microsoft from './microsoft.js';
import { getConfig, paths } from './store.js';
import { defaultScreen, screenSourceIds } from './core/screens.js';
import { logActivity } from './activity.js';
import { LOCAL_SOURCE_ID, BIRTHDAYS_SOURCE_ID } from './core/defaults.js';
import { sourcePrivacyMode } from './core/privacy.js';

const DAY = 86_400_000;
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const ICS_HEADERS = {
  'user-agent': `Mozilla/5.0 (X11; Linux x86_64) Marco/${VERSION} (+https://github.com/mr-reb00t/marco)`,
  accept: 'text/calendar, text/plain, */*',
};

/** sourceId → { key, fetchedAt, lastSuccess, ok, error, count, version, vevents | items, window } */
const cache = new Map();
const inflight = new Map();
/**
 * Moved up by invalidateIcsParsing: a parse made under an older value is never reused, even for the same text. A
 * refresh that was downloading or parsing when the time zone changed holds a copy made before it (#46).
 */
let parseEpoch = 0;

const sourceKey = (s) =>
  s.type === 'google' ? `google|${s.googleAccount}|${s.googleCalendarId}`
    : s.type === 'microsoft' ? `microsoft|${s.microsoftAccount}|${s.microsoftCalendarId}`
      : `ics|${s.url}|${s.insecureTls ? 1 : 0}`;

/** Change signature of a Google or Microsoft event list. */
const itemsSig = (source, items) => (source.type === 'microsoft' ? hash(items) : hash(items.map((i) => [i.id, i.etag, i.updated])));

const cacheFile = (id) => path.join(paths.cache, `src_${id.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

function loadDiskCache(source) {
  try {
    const j = JSON.parse(fs.readFileSync(cacheFile(source.id), 'utf8'));
    if (j.key !== sourceKey(source)) return null;
    return j;
  } catch {
    return null;
  }
}

function saveDiskCache(source, payload) {
  try {
    fs.writeFileSync(cacheFile(source.id), JSON.stringify({ key: sourceKey(source), ...payload }));
    return true;
  } catch (err) {
    console.warn('[calendars] disk cache write failed:', err.message);
    return false;
  }
}

/** Fetch raw ICS text (used by sources and by the admin "test" endpoint). */
export async function fetchIcsText(url, insecureTls = false, { guard = false } = {}) {
  const res = await request(url, { headers: ICS_HEADERS, insecureTls, guard });
  return res.text;
}

function defaultGoogleWindow(tz) {
  const today = localDate(new Date(), tz);
  return { from: addDays(today, -62), to: addDays(today, 400) };
}

async function doRefresh(source, needWindow) {
  const prev = cache.get(source.id);
  const key = sourceKey(source);
  const entry = prev && prev.key === key ? { ...prev } : { key, version: 0, count: 0 };
  entry.fetchedAt = Date.now();
  try {
    if (source.type === 'ics') {
      const text = await fetchIcsText(source.url, source.insecureTls);
      const sig = hash(text);
      // An unchanged download keeps its parse (#46), unless the time zone changed since it was made (parseEpoch).
      const epoch = parseEpoch;
      const reuse = sig === entry.sig && entry.vevents && entry.epoch === epoch;
      const vevents = reuse ? entry.vevents : await parseIcsText(text);
      if (!reuse) entry.version = (entry.version || 0) + 1;
      Object.assign(entry, { vevents, sig, epoch, count: vevents.length });
      // the same text is already on disk: not written again (an SD card on a Pi); its fetchedAt there only decides
      // whether the first refresh after a restart downloads at once
      if (entry.diskSig !== sig && saveDiskCache(source, { fetchedAt: entry.fetchedAt, text })) entry.diskSig = sig;
    } else {
      const tz = getConfig().datetime.timezone;
      const w = defaultGoogleWindow(tz);
      // Grow monotonically (keep what was already covered) so alternating requests do not refetch.
      if (entry.window) {
        if (entry.window.from < w.from) w.from = entry.window.from;
        if (entry.window.to > w.to) w.to = entry.window.to;
      }
      if (needWindow) {
        if (needWindow.from < w.from) w.from = needWindow.from;
        if (needWindow.to > w.to) w.to = needWindow.to;
      }
      const from = zonedMidnight(w.from, tz);
      const to = zonedMidnight(addDays(w.to, 1), tz);
      let items;
      if (source.type === 'microsoft') {
        // Needs the server's own Entra app (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET, server/microsoft.js).
        if (!microsoft.microsoftConfigured()) throw new Error('Microsoft is not configured on this server (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET)');
        items = await microsoft.listEvents(source.microsoftAccount, source.microsoftCalendarId, from, to);
      } else {
        items = await google.listEvents(source.googleAccount, source.googleCalendarId, from, to);
      }
      const sig = itemsSig(source, items);
      if (sig !== entry.sig) entry.version = (entry.version || 0) + 1;
      Object.assign(entry, { items, sig, window: w, count: items.length });
      saveDiskCache(source, { fetchedAt: entry.fetchedAt, items, window: w });
    }
    entry.ok = true;
    entry.error = null;
    entry.lastSuccess = entry.fetchedAt;
    // the time zone changed while it parsed: parsed again at the next refresh, which is due now
    if (entry.epoch !== undefined && entry.epoch !== parseEpoch) entry.fetchedAt = 0;
  } catch (err) {
    entry.ok = false;
    entry.error = err.message || String(err);
    entry.errorCode = err.code === 'auth_failed' || /Google account|Google token|refresh token|invalid_grant|HTTP 401|HTTP 403/.test(entry.error)
      ? 'auth_failed' : err.code === 'parse_failed' || /parse|ical/i.test(entry.error) ? 'parse_failed' : 'fetch_failed';
    console.warn(`[calendars] ${source.name} (${source.id}): ${entry.error}`);
  }
  logTransition(source, prev && prev.key === key ? prev.ok : undefined, entry);
  cache.set(source.id, entry);
  // A failed refresh or an unchanged feed keeps the same generation, and with it the built event lists.
  if (genOf(prev) !== genOf(entry)) dropMemo(source.id);
  return entry;
}

/** Activity log on ok/unknown → error and error → ok transitions only (docs/ARCHITECTURE.md). Never logs URLs. */
function logTransition(source, prevOk, entry) {
  if (entry.ok === false && prevOk !== false) {
    const error = String(entry.error || '').replace(/(?:https?|webcals?):\/\/\S+/gi, '<url>').slice(0, 200);
    logActivity('source.error', { actor: 'system', level: 'warn', data: { sourceId: source.id, name: source.name, error, code: entry.errorCode } });
  } else if (entry.ok === true && prevOk === false) {
    logActivity('source.recovered', { actor: 'system', level: 'info', data: { sourceId: source.id, name: source.name } });
  }
}

function primeFromDisk(source) {
  if (cache.has(source.id)) return;
  const disk = loadDiskCache(source);
  if (!disk) return;
  try {
    const entry = { key: sourceKey(source), fetchedAt: disk.fetchedAt, lastSuccess: disk.fetchedAt, ok: true, error: null, version: 1, fromDisk: true };
    if (source.type === 'ics') {
      // parse synchronously-ish: stash text, parsed lazily by refresh path below
      entry.pendingText = disk.text;
    } else {
      Object.assign(entry, { items: disk.items, window: disk.window, count: disk.items.length, sig: itemsSig(source, disk.items) });
    }
    cache.set(source.id, entry);
  } catch { /* ignore */ }
}

const isFresh = (source, entry) => entry && entry.key === sourceKey(source) && entry.fetchedAt && Date.now() - entry.fetchedAt < source.refreshMin * 60_000;
const hasData = (entry) => Boolean(entry && (entry.vevents || entry.items));
const covers = (entry, w) => !w || !entry.window || (entry.window.from <= w.from && entry.window.to >= w.to);

/** Refresh a source if stale (or forced). Concurrent callers share one fetch. */
export function refreshSource(source, { force = false, window = null } = {}) {
  primeFromDisk(source);
  const entry = cache.get(source.id);
  if (entry?.pendingText) {
    const text = entry.pendingText;
    delete entry.pendingText;
    const epoch = parseEpoch;
    const p = parseIcsText(text).then((vevents) => {
      const sig = hash(text);
      Object.assign(entry, { vevents, count: vevents.length, sig, epoch, diskSig: sig });
      if (epoch !== parseEpoch) entry.fetchedAt = 0;
      dropMemo(source.id);
    }).catch(() => {});
    inflight.set(source.id, p);
    p.finally(() => inflight.delete(source.id));
  }
  if (inflight.has(source.id)) return inflight.get(source.id).then(() => cache.get(source.id));
  if (!force && isFresh(source, entry) && (source.type === 'ics' || covers(entry, window))) return Promise.resolve(entry);
  const p = doRefresh(source, window).finally(() => inflight.delete(source.id));
  inflight.set(source.id, p);
  return p;
}

export function sourceStatus() {
  const cfg = getConfig();
  return cfg.calendar.sources.map((s) => {
    const e = cache.get(s.id);
    const valid = e && e.key === sourceKey(s);
    return {
      id: s.id, name: s.name, enabled: s.enabled,
      lastFetch: valid && e.fetchedAt ? new Date(e.fetchedAt).toISOString() : null,
      lastSuccess: valid && e.lastSuccess ? new Date(e.lastSuccess).toISOString() : null,
      ok: valid ? e.ok !== false : null,
      count: valid ? e.count || 0 : 0,
      error: valid ? e.error || null : null,
    };
  }).concat([
    // Built-in pseudo-sources (F2): always "ok", count = configured items.
    { id: LOCAL_SOURCE_ID, name: cfg.localEvents.name, enabled: cfg.localEvents.enabled, lastFetch: null, lastSuccess: null, ok: true, count: cfg.localEvents.items.length, error: null },
    { id: BIRTHDAYS_SOURCE_ID, name: cfg.birthdays.name, enabled: cfg.birthdays.enabled, lastFetch: null, lastSuccess: null, ok: true, count: cfg.birthdays.items.length, error: null },
  ]);
}

/**
 * Google Contacts birthdays come as eventType 'birthday' in the primary calendar (#43). Google stores anniversaries and
 * custom dates the same way; only birthdays get the birthday look.
 */
const isGoogleBirthday = (it) => it.eventType === 'birthday' && [undefined, 'birthday', 'self'].includes(it.birthdayProperties?.type);

/** Google event → raw instance (`kind: 'birthdays'` for a Google Contacts birthday). Exported for tests. */
export function googleToRaw(it) {
  if (it.status === 'cancelled') return null;
  const allDay = Boolean(it.start?.date);
  const raw = { uid: it.id, title: it.summary || '', description: it.description || '', location: it.location || '', allDay };
  if (isGoogleBirthday(it)) raw.kind = 'birthdays';
  if (allDay) {
    raw.start = it.start.date;
    raw.end = it.end?.date && it.end.date > it.start.date ? it.end.date : addDays(it.start.date, 1);
  } else {
    raw.start = new Date(it.start?.dateTime);
    raw.end = it.end?.dateTime ? new Date(it.end.dateTime) : new Date(raw.start);
    if (Number.isNaN(raw.start.getTime())) return null;
  }
  return raw;
}

/** Fields of a CalEvent sent on the wire (internal detail fields are stripped). */
function toWire(e) {
  const out = {
    id: e.id, sourceId: e.sourceId, title: e.title, start: e.start, end: e.end, allDay: e.allDay,
    location: e.location, color: e.color, emoji: e.emoji, kind: e.kind, multiDay: e.multiDay,
  };
  if (e.description) out.description = e.description;
  if (e.age !== undefined) out.age = e.age; // birthdays pseudo-source only (number | null)
  return out;
}

/**
 * Convert raw instances of one source into CalEvents clipped to [from, to] (inclusive local dates).
 * Pipeline per event: kind normalisation → event rules (hide → rename → style) → decoration.
 * Pure apart from config-free args; exported for tests.
 *
 * Emoji: raw item emoji (local/birthday) > style rule > icon rule > source/section emoji > kind default. A raw item
 * with a kind of its own (a Google Contacts birthday) takes that kind and `birthdayEmoji` instead of the source's.
 * Color: raw item color > style rule > icon rule > source/section color.
 *
 * With `detail: true` hidden events are kept and every event carries `hidden`, `originalTitle`, `applied`,
 * `iconRuleId`, `countdown`, `itemId` (used by the admin preview and countdowns); otherwise wire CalEvents.
 */
export function buildSourceEvents(raws, source, { rules, eventRules = [], from, to, tz, lang, detail = false, tidyBirthdays = true, birthdayEmoji = '' }) {
  const fromMs = zonedMidnight(from, tz).getTime();
  const toExclDate = addDays(to, 1);
  const toMs = zonedMidnight(toExclDate, tz).getTime();
  const out = [];
  const seen = new Set();
  for (const r of raws) {
    let { title, description } = r;
    if (r.allDay) {
      // Airbnb stays are drawn up to their (exclusive) checkout day, so a stay ending on `from` still shows.
      const endOk = source.kind === 'airbnb' ? r.end >= from : r.end > from;
      if (!(r.start < toExclDate && endOk)) continue;
    } else {
      const s = r.start.getTime();
      const e = Math.max(r.end.getTime(), s + 1);
      if (!(s < toMs && e > fromMs)) continue;
    }
    title = String(title || '').trim();
    let titleEmoji = '';
    if (source.kind === 'airbnb') ({ title, emoji: titleEmoji } = normalizeAirbnbTitle(title, description, lang));
    else if (source.kind === 'holidays') title = translateHoliday(title, lang);
    if (!title) title = t('untitled', lang);
    const location = String(r.location || '').trim();

    const ruled = applyEventRules(eventRules, { title, description, location, sourceId: source.id });
    if (ruled.hidden && !detail) continue;
    const originalTitle = title;
    title = ruled.title;
    const style = ruled.style;
    const icon = matchRule(rules, `${r.title} ${title}`, description);
    // An emoji already present in the feed's own title (e.g. a property-management tool's "🏠 Guest") beats keyword rules.
    const kind = r.kind || source.kind;
    const ownKind = kind !== source.kind;
    const emoji = r.emoji || style?.emoji || titleEmoji || icon?.emoji || (ownKind ? birthdayEmoji || KIND_EMOJI[kind] : source.emoji || KIND_EMOJI[source.kind]) || '';
    const color = r.color || style?.color || icon?.color || source.color;
    const iconUsed = icon && ((!r.emoji && !style?.emoji && !titleEmoji && icon.emoji) || (!r.color && !style?.color && icon.color));
    // Un-shout ALL CAPS and drop "Cumple de…" when 🎂 already says it (unless birthdays.tidyTitles is off), unless the
    // user renamed it explicitly. `titleWhy` tells the admin preview why the title changed.
    let titleWhy = title !== originalTitle ? 'rule' : null;
    if (!titleWhy) {
      const tidy = tidyTitleWhy(title, { rule: icon, source: ownKind ? { ...source, kind } : source, emoji, birthdayNames: tidyBirthdays });
      if (tidy.title) {
        title = tidy.title;
        titleWhy = tidy.why;
      }
    }

    let start, end, multiDay;
    if (r.allDay) {
      start = r.start;
      end = r.end;
      multiDay = daysBetween(start, end) > 1;
    } else {
      start = isoWithOffset(r.start, tz);
      end = isoWithOffset(r.end, tz);
      const lastMoment = new Date(Math.max(r.start.getTime(), r.end.getTime() - 1));
      multiDay = localDate(r.start, tz) !== localDate(lastMoment, tz);
    }
    const id = hash(r.idKey || `${source.id}|${r.uid}|${start}`, 12);
    if (seen.has(id)) continue;
    seen.add(id);
    const ev = {
      id, sourceId: source.id, title, start, end, allDay: r.allDay,
      location, color, emoji, kind, multiDay,
    };
    if (source.type === 'local' && description) ev.description = String(description).slice(0, 1000);
    if (r.age !== undefined) ev.age = r.age;
    if (detail) {
      Object.assign(ev, {
        hidden: ruled.hidden, originalTitle, titleWhy, applied: ruled.applied, iconRuleId: iconUsed ? icon.id : null,
        countdown: Boolean(r.countdown || style?.countdown), itemId: r.uid,
      });
    }
    out.push(ev);
  }
  return out;
}

export function sortEvents(events, tz) {
  const dayOf = (e) => (e.allDay ? e.start : localDate(new Date(e.start), tz));
  const msOf = (e) => (e.allDay ? 0 : Date.parse(e.start));
  return events.sort((a, b) =>
    dayOf(a) < dayOf(b) ? -1 : dayOf(a) > dayOf(b) ? 1
      : a.allDay !== b.allDay ? (a.allDay ? -1 : 1)
        : msOf(a) - msOf(b) || (b.multiDay - a.multiDay) || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
}

export function eventsHash(events) {
  return hash(events);
}

function rawForSource(source, entry, fromDate, toDate) {
  if (source.type === 'ics') return entry.vevents ? expandEvents(entry.vevents, fromDate, toDate) : [];
  if (source.type === 'microsoft') return (entry.items || []).map(microsoft.graphToRaw).filter(Boolean);
  return (entry.items || []).map(googleToRaw).filter(Boolean);
}

/**
 * Sources (remote + pseudo) visible for `screen` (null = all enabled), optionally restricted to `onlyIds`.
 * Returns { remote: CalendarSource[], local: bool, birthdays: bool }.
 */
function pickSources(cfg, screen, onlyIds = null) {
  let ids = screenSourceIds(cfg, screen);
  if (onlyIds) ids = ids.filter((id) => onlyIds.includes(id));
  const set = new Set(ids);
  return {
    remote: cfg.calendar.sources.filter((s) => s.enabled && set.has(s.id)),
    local: set.has(LOCAL_SOURCE_ID),
    birthdays: set.has(BIRTHDAYS_SOURCE_ID),
  };
}

/** Make sure remote sources have data: await first loads, refresh stale ones in the background. */
async function ensureSources(sources, window) {
  await Promise.all(sources.map(async (s) => {
    primeFromDisk(s);
    const e = cache.get(s.id);
    const valid = e && e.key === sourceKey(s);
    const mustAwait = !valid || e.pendingText || (!hasData(e) && !e.error)
      || (s.type !== 'ics' && hasData(e) && !covers(e, window));
    if (mustAwait) await refreshSource(s, { window });
    else if (!isFresh(s, e)) refreshSource(s).catch(() => {});
  }));
}

/** Name and day of a birthday, for telling the same person apart from another (the title as tidied for 🎂). */
const birthdayKey = (name, day) => `${fold(tidyTitleWhy(name, { source: { kind: 'birthdays' } }).title).trim()}|${day}`;

/** Keys of a Marco birthday instance. A 29 February birthday also matches 1 March in other years (Google does not say
 * which of 28 February and 1 March it uses). */
function ownBirthdayKeys(r, leap) {
  const keys = [birthdayKey(r.title, r.start)];
  if (leap.has(r.uid) && r.start.endsWith('-02-28')) keys.push(birthdayKey(r.title, addDays(r.start, 1)));
  return keys;
}
const leapIds = (items) => new Set(items.filter((b) => b.month === 2 && b.day === 29).map((b) => b.id));

/**
 * Google Contacts birthdays (kind 'birthdays' in a Google source) of a person and day already in Marco's own birthday
 * list are left out: Marco's entry stays, with the age (#43). Exported for tests.
 */
export function dropOwnBirthdays(events, items, { from, to }) {
  if (!items?.length) return events;
  const own = new Set();
  const leap = leapIds(items);
  for (const r of expandBirthdays(items, { from, to, showAge: false })) for (const k of ownBirthdayKeys(r, leap)) own.add(k);
  return events.filter((e) => !(e.kind === 'birthdays' && e.allDay && own.has(birthdayKey(e.originalTitle ?? e.title, e.start))));
}

/** How much of a calendar private mode shows, for picking which copy of a birthday stays. */
const SHOWN = { hide: 0, busy: 1, keep: 2 };

/** Build detailed (see buildSourceEvents `detail`) sorted events for the picked sources. */
function computeDetailed(cfg, picked, { from, to, lang }) {
  const tz = cfg.datetime.timezone;
  const opts = {
    rules: cfg.calendar.iconRules, eventRules: cfg.eventRules.items, from, to, tz, lang, detail: true,
    tidyBirthdays: cfg.birthdays.tidyTitles !== false, birthdayEmoji: cfg.birthdays.emoji || KIND_EMOJI.birthdays,
  };
  const fromDate = new Date(zonedMidnight(from, tz).getTime() - DAY);
  const toDate = new Date(zonedMidnight(addDays(to, 1), tz).getTime() + DAY);
  const events = [];
  const errors = [];
  // Marco's own entry of a birthday Google also has wins, unless private mode shows that Google calendar more than
  // the birthday list: then the Google one stays and Marco's is left out, so private mode cannot hide the person.
  const bdayWindow = { from: addDays(from, -1), to: addDays(to, 1) };
  const ownShown = SHOWN[sourcePrivacyMode(cfg, BIRTHDAYS_SOURCE_ID)];
  const fromGoogle = new Set();
  for (const s of picked.remote) {
    const e = cache.get(s.id);
    if (!e || e.key !== sourceKey(s)) continue;
    try {
      let evs = buildSourceEvents(rawForSource(s, e, fromDate, toDate), s, opts);
      if (picked.birthdays && s.type === 'google') {
        if (SHOWN[sourcePrivacyMode(cfg, s.id)] <= ownShown) evs = dropOwnBirthdays(evs, cfg.birthdays.items, bdayWindow);
        else for (const ev of evs) if (ev.kind === 'birthdays' && ev.allDay) fromGoogle.add(birthdayKey(ev.originalTitle ?? ev.title, ev.start));
      }
      events.push(...evs);
    } catch (err) {
      console.warn(`[calendars] ${s.name} (${s.id}) build failed: ${err.message}`);
      errors.push({ sourceId: s.id, message: 'parse_failed' });
    }
  }
  if (picked.local) {
    events.push(...buildSourceEvents(expandLocalEvents(cfg.localEvents.items, { from, to, tz }), localSource(cfg), opts));
  }
  if (picked.birthdays) {
    let raws = expandBirthdays(cfg.birthdays.items, { ...bdayWindow, showAge: cfg.birthdays.showAge });
    if (fromGoogle.size) {
      const leap = leapIds(cfg.birthdays.items);
      raws = raws.filter((r) => !ownBirthdayKeys(r, leap).some((k) => fromGoogle.has(k)));
    }
    events.push(...buildSourceEvents(raws, birthdaysSource(cfg), opts));
  }
  return { events: sortEvents(events, tz), errors };
}

const memo = new Map();
/** Memo entries of a source are dropped as soon as its data changes (#46): an old list can never be served again
 * and its titles can keep the whole downloaded ICS text alive. */
function dropMemo(sourceId) {
  for (const [k, hit] of memo) if (hit.sourceIds.includes(sourceId)) memo.delete(k);
}
const genOf = (e) => (e ? `${e.key}|${e.version}|${e.sig}` : '');
const memoKeyOf = (cfg, picked, from, to, lang) => [
  from, to, cfg.datetime.timezone, lang, cfg.revision, picked.local ? 'L' : '', picked.birthdays ? 'B' : '',
  ...picked.remote.map((s) => `${s.id}:${cache.get(s.id)?.version}:${cache.get(s.id)?.sig}`),
].join('|');

/**
 * Detailed events (internal; hidden ones included) with memoisation. Used by getEvents and countdowns.
 * `onlyIds` restricts the screen's sources further (countdowns scan only what can be flagged).
 */
export async function getDetailedEvents({ from, to, screen = null, onlyIds = null, cfg = getConfig() }) {
  const lang = (screen || defaultScreen(cfg)).screen.language;
  const picked = pickSources(cfg, screen, onlyIds);
  await ensureSources(picked.remote, { from, to });
  const key = memoKeyOf(cfg, picked, from, to, lang);
  let hit = memo.get(key);
  if (!hit) {
    const { events, errors } = computeDetailed(cfg, picked, { from, to, lang });
    const wire = events.filter((e) => !e.hidden).map(toWire);
    hit = {
      detailed: events, wire, buildErrors: errors, hash: eventsHash(wire), generatedAt: new Date().toISOString(),
      sourceIds: picked.remote.map((s) => s.id),
    };
    memo.set(key, hit);
    if (memo.size > 30) memo.delete(memo.keys().next().value);
  }
  return { ...hit, errors: [...collectErrors(picked.remote), ...hit.buildErrors] };
}

/**
 * Merged events for a local-date window. Sources without any data are awaited (first load);
 * stale sources are refreshed in the background and served from cache meanwhile.
 * `screen` (ScreenProfile) selects language + visible sources; null = every enabled source incl. local/birthdays.
 */
export async function getEvents({ from, to, screen = null }) {
  const r = await getDetailedEvents({ from, to, screen });
  return { generatedAt: r.generatedAt, hash: r.hash, events: r.wire, errors: r.errors };
}

/**
 * Admin preview (docs/ARCHITECTURE.md): every event in [from, to] incl. hidden ones, with rule details.
 * `overrides` = sanitised draft { eventRules?, iconRules?, localEvents?, birthdays? } replacing the saved ones.
 * Reuses cached source data (first loads are awaited like getEvents, nothing is force-refetched).
 */
export async function previewEvents({ from, to, screen = null, overrides = {} }) {
  const base = getConfig();
  const cfg = {
    ...base,
    calendar: { ...base.calendar, ...(overrides.iconRules ? { iconRules: overrides.iconRules } : {}) },
    eventRules: overrides.eventRules ? { items: overrides.eventRules } : base.eventRules,
    localEvents: overrides.localEvents || base.localEvents,
    birthdays: overrides.birthdays || base.birthdays,
  };
  const lang = (screen || defaultScreen(cfg)).screen.language;
  const picked = pickSources(cfg, screen);
  await ensureSources(picked.remote, { from, to });
  const { events, errors } = computeDetailed(cfg, picked, { from, to, lang });
  const names = new Map([
    ...cfg.calendar.sources.map((s) => [s.id, s.name]),
    [LOCAL_SOURCE_ID, cfg.localEvents.name],
    [BIRTHDAYS_SOURCE_ID, cfg.birthdays.name],
  ]);
  const ruleHits = {};
  for (const r of cfg.eventRules.items) ruleHits[r.id] = 0;
  const out = events.map((e) => {
    for (const a of e.applied) ruleHits[a.ruleId] = (ruleHits[a.ruleId] || 0) + 1;
    return {
      ...toWire(e),
      hidden: e.hidden, originalTitle: e.originalTitle, titleWhy: e.titleWhy ?? null, sourceName: names.get(e.sourceId) || e.sourceId,
      applied: e.applied, iconRuleId: e.iconRuleId,
    };
  });
  return { from, to, events: out, ruleHits, errors: [...collectErrors(picked.remote), ...errors] };
}

function collectErrors(sources) {
  const errs = [];
  for (const s of sources) {
    const e = cache.get(s.id);
    // Public endpoint: generic codes only (raw messages may contain hostnames/emails; see sourceStatus for details).
    if (e && e.key === sourceKey(s) && e.error) errs.push({ sourceId: s.id, message: e.errorCode || 'fetch_failed' });
  }
  return errs;
}

// Safety net: one hung source must never stall the whole refresher (or a manual refresh request).
const capRefresh = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('refresh timeout')), 90_000).unref())]);

/** Refresh every stale enabled source (used by the background refresher). */
export async function refreshAll({ force = false } = {}) {
  const cfg = getConfig();
  const sources = cfg.calendar.sources.filter((s) => s.enabled);
  await Promise.allSettled(sources.map((s) => capRefresh(refreshSource(s, { force }))));
  // drop cache entries of removed sources
  const ids = new Set(cfg.calendar.sources.map((s) => s.id));
  for (const id of cache.keys()) {
    if (ids.has(id)) continue;
    cache.delete(id);
    dropMemo(id);
  }
  try {
    for (const f of fs.readdirSync(paths.cache)) {
      const m = /^src_(.+)\.json$/.exec(f);
      if (m && !cfg.calendar.sources.some((s) => cacheFile(s.id).endsWith(f))) fs.unlinkSync(path.join(paths.cache, f));
    }
  } catch { /* ignore */ }
}

// Manual refreshes from Admin > Estado (#37): the owner may fetch a calendar now, but never often enough to
// hammer its server. In memory only: a restart forgets them, which is fine for a 1-2 minute wait.
export const MANUAL_SOURCE_COOLDOWN_MS = 60_000;
export const MANUAL_ALL_COOLDOWN_MS = 120_000;
const manualAt = new Map(); // sourceId -> ms of the last manual fetch (single or "all")
let manualAllAt = 0;
const secsLeft = (at, ms, now) => (at ? Math.max(0, Math.ceil((at + ms - now) / 1000)) : 0);
const isRemote = (s) => s.id !== LOCAL_SOURCE_ID && s.id !== BIRTHDAYS_SOURCE_ID;

/** Forget cooldowns of sources that no longer exist, so the map cannot grow with removed ids. */
function pruneManual(cfg) {
  const ids = new Set(cfg.calendar.sources.map((s) => s.id));
  for (const id of manualAt.keys()) if (!ids.has(id)) manualAt.delete(id);
}

/**
 * When the next manual refresh is allowed, only for ones still cooling: { sources: { id: { at: ISO, secs } },
 * all: { at: ISO, secs } | null }. `secs` is what the admin counts down from, so a device whose clock differs
 * from the server's still waits the right time.
 */
export function manualRefreshCooldowns(now = Date.now()) {
  const sources = {};
  for (const [id, at] of manualAt) {
    const secs = secsLeft(at, MANUAL_SOURCE_COOLDOWN_MS, now);
    if (secs > 0) sources[id] = { at: new Date(at + MANUAL_SOURCE_COOLDOWN_MS).toISOString(), secs };
  }
  const allSecs = secsLeft(manualAllAt, MANUAL_ALL_COOLDOWN_MS, now);
  const all = allSecs > 0 ? { at: new Date(manualAllAt + MANUAL_ALL_COOLDOWN_MS).toISOString(), secs: allSecs } : null;
  return { sources, all };
}

const resultOf = (id, settled) => {
  if (settled.status === 'rejected') return { id, result: 'error', error: settled.reason?.message || String(settled.reason) };
  const entry = settled.value;
  return { id, result: entry && entry.ok === false ? 'error' : 'ok', error: entry?.error || null };
};

/**
 * Force-fetch one source (`sourceId`) or every enabled remote source (null). Returns
 * { retryAfter } (seconds) when refused by a cooldown, else { results: [{ id, result, error?, retryAfter? }] }.
 * Cooldowns are stamped before fetching, so a double click cannot start two fetches. A forced call while the
 * background refresher is already fetching that source shares its in-flight request (refreshSource).
 */
export async function refreshNow({ sourceId = null, now = Date.now() } = {}) {
  const cfg = getConfig();
  pruneManual(cfg);
  if (sourceId != null) {
    const s = cfg.calendar.sources.find((x) => x.id === sourceId);
    // The route checks these first; kept here so a direct caller cannot fetch a disabled or missing source.
    if (!s || s.enabled === false) return { results: [] };
    const left = secsLeft(manualAt.get(s.id), MANUAL_SOURCE_COOLDOWN_MS, now);
    if (left > 0) return { retryAfter: left };
    manualAt.set(s.id, now);
    const [settled] = await Promise.allSettled([capRefresh(refreshSource(s, { force: true }))]);
    return { results: [resultOf(s.id, settled)] };
  }
  const leftAll = secsLeft(manualAllAt, MANUAL_ALL_COOLDOWN_MS, now);
  if (leftAll > 0) return { retryAfter: leftAll };
  const sources = cfg.calendar.sources.filter((s) => s.enabled !== false && isRemote(s));
  const lefts = sources.map((s) => secsLeft(manualAt.get(s.id), MANUAL_SOURCE_COOLDOWN_MS, now));
  // Every source still in its own wait: nothing would be fetched, so refuse like a cooldown (the soonest one)
  // instead of answering an empty run and locking "all" for 120 s.
  if (lefts.length && lefts.every((l) => l > 0)) return { retryAfter: Math.min(...lefts) };
  manualAllAt = now;
  const results = await Promise.all(sources.map(async (s, i) => {
    const left = lefts[i];
    if (left > 0) return { id: s.id, result: 'cooldown', retryAfter: left };
    manualAt.set(s.id, now);
    const [settled] = await Promise.allSettled([capRefresh(refreshSource(s, { force: true }))]);
    return resultOf(s.id, settled);
  }));
  return { results };
}

/** Tests only: forget every manual refresh cooldown. */
export function _resetManualRefresh() {
  manualAt.clear();
  manualAllAt = 0;
}

/** Default window used for change detection: a bit before the current month to ~4 months ahead. */
export function defaultWindow(tz) {
  const today = localDate(new Date(), tz);
  return { from: addDays(today.slice(0, 8) + '01', -7), to: addDays(today, 120) };
}

/**
 * Quick ICS check for the admin panel. `guard` (unauthenticated setup wizard): no loopback/link-local/metadata
 * destinations and generic error messages (no network details: the endpoint must not work as a port scanner).
 */
export async function testIcs(url, insecureTls = false, { guard = false } = {}) {
  try {
    const text = await fetchIcsText(url, insecureTls, { guard });
    const vevents = await parseIcsText(text);
    const now = Date.now();
    const raws = expandEvents(vevents, new Date(now - DAY), new Date(now + 180 * DAY))
      .sort((a, b) => (a.allDay ? Date.parse(a.start) : a.start) - (b.allDay ? Date.parse(b.start) : b.start));
    const sample = [...new Set(raws.map((r) => r.title).filter(Boolean))].slice(0, 5);
    return { ok: true, count: vevents.length, sample };
  } catch (err) {
    if (!guard) return { ok: false, count: 0, sample: [], error: err.message };
    const error = err.blocked ? 'address not allowed' : /^Not an iCalendar/.test(err.message) ? err.message
      : err.status >= 400 ? `HTTP ${err.status}` : 'could not load the calendar';
    return { ok: false, count: 0, sample: [], error };
  }
}

/**
 * The process time zone changed (Admin → Date & time or the setup wizard): floating ICS times (no TZID) were
 * parsed in the old zone. Mark every ICS source stale and bump its version so the next refresh re-parses it and
 * cached event lists are rebuilt.
 */
export function invalidateIcsParsing() {
  parseEpoch++;
  for (const entry of cache.values()) {
    if (!entry.vevents && !entry.pendingText) continue;
    entry.fetchedAt = 0;
    entry.version = (entry.version || 0) + 1;
    // The re-parse must bump the version again even though the text is the same: an event list built in between
    // from the old parse would otherwise stay cached.
    entry.sig = null;
  }
  memo.clear();
}
