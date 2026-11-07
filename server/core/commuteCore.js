// Commute time widget ('commute'): pure helpers shared by the server, the admin and the display.
// No Node built-ins (checked by server/test/core-lint.test.js).
import { zonedParts } from './lib/tz.js';
import { randomId } from './lib/text.js';

export const COMMUTE_MODES = Object.freeze(['driving', 'transit', 'bicycling', 'walking']);
export const COMMUTE_DIRECTIONS = Object.freeze(['to', 'from', 'auto']);
export const COMMUTE_UNITS = Object.freeze(['auto', 'metric', 'imperial']);
/** Refresh choices in minutes. Ten is the floor: each refresh of a route is one paid Google request. */
export const COMMUTE_REFRESH_MIN = Object.freeze([10, 15, 30, 60]);
export const MIN_COMMUTE_REFRESH_MIN = 10;
export const MAX_COMMUTE_ROUTES = 8;
export const COMMUTE_ROUTE_PREFIX = 'cr_';
export const COMMUTE_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
/**
 * The designs of the Trayectos card of a Personalizado screen (canvasCore CANVAS_KINDS.commute): 'auto' picks one from
 * the card's box and its number of routes, 'focus' one route large, 'list' rows, 'line' one line each, 'pill' the time
 * and a dot.
 */
export const COMMUTE_LOOKS = Object.freeze(['auto', 'focus', 'list', 'line', 'pill']);

// ---- validation (a commute widget's options, core/validate.js, and the Trayectos card's props, core/canvasCore.js) --
// Tiny coercers of their own, with the same messages as validate.js: `err(path, msg)` records a problem, the default
// is kept.
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const C = {
  bool: (err, path, v, d) => {
    if (v === undefined) return d;
    if (typeof v === 'boolean') return v;
    err(path, 'expected boolean');
    return d;
  },
  str: (err, path, v, d, max) => {
    if (v === undefined || v === null) return d;
    if (typeof v !== 'string') {
      err(path, 'expected string');
      return d;
    }
    // eslint-disable-next-line no-control-regex
    const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    if (s.length > max) {
      err(path, `too long (max ${max})`);
      return s.slice(0, max);
    }
    return s;
  },
  oneOf: (err, path, v, d, list) => {
    if (v === undefined) return d;
    if (list.includes(v)) return v;
    err(path, `must be one of ${list.join(', ')}`);
    return d;
  },
  arr: (err, path, v, d, max) => {
    if (v === undefined) return d;
    if (!Array.isArray(v)) {
      err(path, 'expected array');
      return d;
    }
    if (v.length > max) {
      err(path, `too many items (max ${max})`);
      return v.slice(0, max);
    }
    return v;
  },
  hhmm: (err, path, v, d) => {
    if (v === undefined) return d;
    if (typeof v === 'string' && HHMM.test(v)) return v;
    err(path, 'HH:MM');
    return d;
  },
  weekdays: (err, path, v) => {
    const list = C.arr(err, path, v, [], 7);
    const out = [...new Set(list.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
    if (out.length !== list.length) err(path, 'weekdays must be unique integers 0..6 (0 = Sunday)');
    return out;
  },
};

/** A new route id (cr_ and 12 hex digits). */
export const randomRouteId = () => randomId(COMMUTE_ROUTE_PREFIX);

/**
 * The options of a commute widget, or the routes and display options of a Trayectos card: at most MAX_COMMUTE_ROUTES
 * routes, each with its name, addresses, mode, direction and schedule; the refresh one of COMMUTE_REFRESH_MIN.
 * `err(path, msg)` records each problem (the default is kept), `p` is the path of the options.
 * `draft`: a card may be saved before its routes are written (no routes, or a route without an address, is "not set
 * up yet", as a Valor card without its key; GET /api/display/commute leaves such a route out), and a screen file
 * blanks the addresses on export. A widget needs every address.
 * `newId(prefix)`: the id of a route that has none (or a repeated one).
 */
export function sanitizeCommuteOptions(raw, err = () => {}, p = 'commute', { draft = false, newId = randomId } = {}) {
  let o = raw;
  if (o === undefined) o = {};
  else if (!isObj(o)) {
    err(p, 'expected object');
    o = {};
  }
  const seenRoutes = new Set();
  const routeId = (v) => {
    let s = typeof v === 'string' && v.startsWith(COMMUTE_ROUTE_PREFIX) && ID.test(v) ? v : newId(COMMUTE_ROUTE_PREFIX);
    while (seenRoutes.has(s)) s = newId(COMMUTE_ROUTE_PREFIX);
    seenRoutes.add(s);
    return s;
  };
  const address = (path, v) => {
    const s = C.str(err, path, v, '', 200).trim();
    if (!s && !draft) err(path, 'required');
    return s;
  };
  const routesIn = C.arr(err, `${p}.routes`, o.routes, [], MAX_COMMUTE_ROUTES);
  if (!routesIn.length && !draft) err(`${p}.routes`, 'at least one route');
  const routes = routesIn.map((r, i) => {
    const q = `${p}.routes[${i}]`;
    if (!isObj(r)) {
      err(q, 'expected object');
      return null;
    }
    const fromVal = r.from === '' || r.from === undefined || r.from === null ? '' : C.hhmm(err, `${q}.from`, r.from, '');
    const toVal = r.to === '' || r.to === undefined || r.to === null ? '' : C.hhmm(err, `${q}.to`, r.to, '');
    return {
      id: routeId(r.id),
      // '' = unnamed: the display shows "Route 1", never the addresses
      name: C.str(err, `${q}.name`, r.name, '', 60).trim(),
      origin: address(`${q}.origin`, r.origin),
      destination: address(`${q}.destination`, r.destination),
      mode: C.oneOf(err, `${q}.mode`, r.mode, 'driving', COMMUTE_MODES),
      direction: C.oneOf(err, `${q}.direction`, r.direction, 'to', COMMUTE_DIRECTIONS),
      reverseAfter: C.hhmm(err, `${q}.reverseAfter`, r.reverseAfter, '12:00'),
      days: C.weekdays(err, `${q}.days`, r.days),
      from: fromVal,
      to: toVal,
    };
  }).filter(Boolean);
  return {
    units: C.oneOf(err, `${p}.units`, o.units, 'auto', COMMUTE_UNITS),
    // 5 minutes was offered before 0.38 (never released): it becomes 10, the floor
    refreshMin: C.oneOf(err, `${p}.refreshMin`, o.refreshMin === 5 ? 10 : o.refreshMin, 10, COMMUTE_REFRESH_MIN),
    showRouteSummary: C.bool(err, `${p}.showRouteSummary`, o.showRouteSummary, true),
    showArrival: C.bool(err, `${p}.showArrival`, o.showArrival, true),
    routes,
  };
}

/**
 * What the times of a set of commute options depend on, as 8 hex digits (FNV-1a): the routes with their addresses
 * and schedules, the refresh, the units and what the card shows. A Trayectos card sends it as its `sig` (never the
 * addresses), so a changed address reloads the card, and the admin preview of an unsaved change gets 409.
 */
export function commuteSig(o) {
  const routes = (Array.isArray(o?.routes) ? o.routes : []).map((r) => [
    r?.id ?? '', r?.name ?? '', r?.origin ?? '', r?.destination ?? '', r?.mode ?? '', r?.direction ?? '', r?.reverseAfter ?? '', r?.days ?? [], r?.from ?? '', r?.to ?? '',
  ]);
  const s = JSON.stringify([o?.units ?? 'auto', o?.refreshMin ?? 10, o?.showRouteSummary !== false, o?.showArrival !== false, routes]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A failed Google request, by code only. The message is always the code: Google's own error text is never kept, so
 * nothing it sends back (or the request, which carries the API key) can reach a log, a response or the admin.
 */
export class CommuteError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Google said the key itself is wrong (not that an API is disabled for it). */
const BAD_KEY_RE = /api key (?:is )?(?:not valid|invalid)|provided api key is invalid|api_key_invalid/i;

/**
 * What a display gets of a commute widget's options (core/screens.js displayWidgets): what the card draws, never the
 * addresses or the schedule. A route keeps its id, name ('' = the display shows "Route 1") and travel mode.
 */
export function displayCommuteOptions(o) {
  return {
    units: o?.units ?? 'auto',
    refreshMin: Math.max(MIN_COMMUTE_REFRESH_MIN, Number(o?.refreshMin) || MIN_COMMUTE_REFRESH_MIN),
    showRouteSummary: o?.showRouteSummary !== false,
    showArrival: o?.showArrival !== false,
    routes: (Array.isArray(o?.routes) ? o.routes : []).map((r) => ({ id: String(r?.id || ''), name: String(r?.name || ''), mode: r?.mode || 'driving' })),
  };
}

/** Whether a Google Maps API key is stored and its last 4 characters, never the key itself. */
export function commuteKeyStatus(key = '') {
  const k = typeof key === 'string' ? key.trim() : '';
  return { set: Boolean(k), hint: k ? k.slice(-4) : '' };
}

function parseMinutes(hhmm, fallback = 720) {
  if (typeof hhmm !== 'string') return fallback;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Day of week 0..6 (0 = Sunday) and minute of day 0..1439 in `tz` at `nowMs`. */
export function localDayAndMinutes(nowMs, tz = 'UTC') {
  const p = zonedParts(new Date(nowMs), tz);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return { dow, minutes: p.h * 60 + p.mi, h: p.h, mi: p.mi };
}

/**
 * Resolves a saved route at `nowMs` in `tz`:
 * - `origin` and `destination` after applying `direction` ('to' | 'from' | 'auto' with `reverseAfter`)
 * - `reversed`: true when showing destination -> origin
 * - `active`: true when today's weekday and current time fall inside the route's schedule (`days`, `from`, `to`)
 */
export function resolveRouteLeg(route, nowMs = Date.now(), tz = 'UTC') {
  const { dow, minutes } = localDayAndMinutes(nowMs, tz);
  const dir = route?.direction || 'to';
  const revAt = parseMinutes(route?.reverseAfter, 12 * 60);
  const reversed = dir === 'from' || (dir === 'auto' && minutes >= revAt);
  const rawOrigin = String(route?.origin || '').trim();
  const rawDest = String(route?.destination || '').trim();
  const origin = reversed ? rawDest : rawOrigin;
  const destination = reversed ? rawOrigin : rawDest;

  const days = Array.isArray(route?.days) ? route.days : [];
  const fStr = typeof route?.from === 'string' ? route.from.trim() : '';
  const tStr = typeof route?.to === 'string' ? route.to.trim() : '';
  let active = true;
  if (fStr && tStr && fStr !== tStr) {
    const fMin = parseMinutes(fStr, 0);
    const tMin = parseMinutes(tStr, 0);
    if (fMin < tMin) {
      active = (!days.length || days.includes(dow)) && minutes >= fMin && minutes < tMin;
    } else {
      // Window crosses midnight: after fMin belongs to today, before tMin belongs to yesterday
      if (minutes >= fMin) active = !days.length || days.includes(dow);
      else if (minutes < tMin) active = !days.length || days.includes((dow + 6) % 7);
      else active = false;
    }
  } else if (days.length) {
    active = days.includes(dow);
  }

  return { origin, destination, reversed, active };
}

/**
 * Traffic condition level ('clear' | 'moderate' | 'heavy') comparing live duration against normal duration.
 */
export function trafficLevel(durationSec, normalDurationSec, mode = 'driving') {
  if (mode !== 'driving' || !(durationSec > 0) || !(normalDurationSec > 0)) return 'clear';
  const delaySec = durationSec - normalDurationSec;
  const ratio = durationSec / normalDurationSec;
  if (delaySec >= 180 && ratio >= 1.3) return 'heavy';
  if (delaySec >= 60 && ratio >= 1.1) return 'moderate';
  return 'clear';
}

/** Delay in whole minutes when live traffic is slower than normal (0 when on time or faster). */
export function delayMinutes(durationSec, normalDurationSec) {
  if (!(durationSec > 0) || !(normalDurationSec > 0)) return 0;
  const d = Math.round((durationSec - normalDurationSec) / 60);
  return d > 0 ? d : 0;
}

/** Formats duration in seconds into `{ main, unit }` or a compact string (e.g. "24 min", "1 h 12 min"). */
export function formatDurationParts(durationSec) {
  const totalMin = Math.max(1, Math.round((Number(durationSec) || 0) / 60));
  if (totalMin < 60) return { hours: 0, minutes: totalMin, text: `${totalMin} min` };
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return { hours, minutes, text: minutes ? `${hours} h ${minutes} min` : `${hours} h` };
}

/** Formats distance in meters into metric ("18.4 km", "650 m") or imperial ("11.4 mi"). */
export function formatDistance(meters, units = 'metric', locale = 'en-GB') {
  const m = Number(meters) || 0;
  if (m <= 0) return '';
  if (units === 'imperial') {
    const miles = m / 1609.344;
    const dec = miles < 10 ? 1 : 0;
    const fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return `${fmt.format(miles)} mi`;
  }
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  const km = m / 1000;
  const dec = km < 10 ? 1 : 0;
  const fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return `${fmt.format(km)} km`;
}

/** Google Routes API v2 travelMode for a Marco commute mode. */
export function googleRoutesTravelMode(mode) {
  if (mode === 'transit') return 'TRANSIT';
  if (mode === 'bicycling') return 'BICYCLE';
  if (mode === 'walking') return 'WALK';
  return 'DRIVE';
}

/** Parses Google Routes API v2 (`directions/v2:computeRoutes`) response body. */
export function parseGoogleRoutesV2(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new CommuteError('bad_response');
  }
  if (j?.error) {
    const status = String(j.error.status || '');
    const msg = String(j.error.message || '');
    const reasons = JSON.stringify(j.error.details || []);
    if (BAD_KEY_RE.test(msg) || BAD_KEY_RE.test(reasons)) throw new CommuteError('key_invalid');
    if (status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') throw new CommuteError('http_denied');
    if (status === 'RESOURCE_EXHAUSTED') throw new CommuteError('rate_limited');
    if (status === 'INVALID_ARGUMENT') throw new CommuteError('not_found');
    throw new CommuteError('http_error');
  }
  const route = Array.isArray(j?.routes) ? j.routes[0] : null;
  if (!route) throw new CommuteError('no_route');
  const parseSec = (s) => {
    if (typeof s === 'number') return Math.round(s);
    const m = /^(\d+(?:\.\d+)?)s$/.exec(String(s || '').trim());
    return m ? Math.round(Number(m[1])) : 0;
  };
  const durationSec = parseSec(route.duration);
  const normalDurationSec = parseSec(route.staticDuration) || durationSec;
  const distanceMeters = Number(route.distanceMeters) || 0;
  const summary = String(route.description || '').trim();
  if (!(durationSec > 0)) throw new CommuteError('no_route');
  return { durationSec, normalDurationSec, distanceMeters, summary };
}

/** Parses Google Directions API (`maps/api/directions/json`) response body. */
export function parseGoogleDirections(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new CommuteError('bad_response');
  }
  const status = String(j?.status || '');
  if (status === 'OK') {
    const route = Array.isArray(j.routes) ? j.routes[0] : null;
    const leg = Array.isArray(route?.legs) ? route.legs[0] : null;
    if (!leg) throw new CommuteError('no_route');
    const normalDurationSec = Number(leg.duration?.value) || 0;
    const durationSec = Number(leg.duration_in_traffic?.value) || normalDurationSec;
    const distanceMeters = Number(leg.distance?.value) || 0;
    let summary = String(route.summary || '').trim();
    if (!summary && Array.isArray(leg.steps)) {
      const transitNames = leg.steps
        .map((st) => st?.transit_details?.line?.short_name || st?.transit_details?.line?.name || '')
        .filter(Boolean);
      if (transitNames.length) summary = transitNames.slice(0, 3).join(' → ');
    }
    if (!(durationSec > 0)) throw new CommuteError('no_route');
    return { durationSec, normalDurationSec: normalDurationSec || durationSec, distanceMeters, summary };
  }
  if (status === 'ZERO_RESULTS' || status === 'NOT_FOUND') throw new CommuteError('no_route');
  // REQUEST_DENIED is a wrong key or an API not enabled for it: only the first is 'key_invalid'
  if (status === 'REQUEST_DENIED') throw new CommuteError(BAD_KEY_RE.test(String(j?.error_message || '')) ? 'key_invalid' : 'http_denied');
  if (status === 'OVER_DAILY_LIMIT' || status === 'OVER_QUERY_LIMIT') throw new CommuteError('rate_limited');
  if (status === 'INVALID_REQUEST') throw new CommuteError('not_found');
  throw new CommuteError('http_error');
}

// ---- shared by every server that asks Google (server/commute.js here, Marco Cloud's own): the cost rules, the
// requests and the answer to the displays. Fetching, timeouts and where the legs are kept stay with each server.

/** A good answer older than this is drawn as stale (the screens show when it was fetched). */
export const COMMUTE_STALE_AFTER_MS = 45 * 60_000;
/** A leg nobody asked for in this time is forgotten. */
export const COMMUTE_FORGET_AFTER_MS = 24 * 3600_000;
/** The admin's test button: a route already asked within this time is answered from what is kept. */
export const COMMUTE_TEST_MIN_MS = 60_000;
/** Wait before trying a failed leg again, by number of failures in a row (minutes). */
export const COMMUTE_BACKOFF_MIN = Object.freeze([2, 5, 15, 30, 60]);
/** A key Google refuses is not asked again for an hour (or until the key changes). */
export const COMMUTE_KEY_ERRORS = new Set(['key_invalid', 'http_denied']);

const modeOf = (mode) => (COMMUTE_MODES.includes(mode) ? mode : 'driving');

/** What identifies a leg: the mode and both addresses, trimmed, cut at 200 characters and lower-cased. */
export function commuteLegKey(origin, destination, mode) {
  const o = String(origin || '').trim().slice(0, 200).toLowerCase();
  const d = String(destination || '').trim().slice(0, 200).toLowerCase();
  return `${mode}|${o}|${d}`;
}

/** The Directions API request of a leg as `{ url, init }` (the key goes in the URL, as that API wants it). */
export function googleDirectionsRequest({ origin, destination, mode, apiKey }) {
  const u = new URL('https://maps.googleapis.com/maps/api/directions/json');
  u.searchParams.set('origin', origin);
  u.searchParams.set('destination', destination);
  u.searchParams.set('mode', modeOf(mode));
  u.searchParams.set('departure_time', 'now');
  u.searchParams.set('key', apiKey);
  return { url: u.href, init: { method: 'GET', headers: { accept: 'application/json' } } };
}

/** The Routes API (v2 computeRoutes) request of a leg as `{ url, init }` (the key goes in a header). */
export function googleRoutesRequest({ origin, destination, mode, apiKey }) {
  const body = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: googleRoutesTravelMode(mode),
    ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
  };
  return {
    url: 'https://routes.googleapis.com/directions/v2:computeRoutes',
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
        'x-goog-fieldmask': 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description',
      },
      body: JSON.stringify(body),
    },
  };
}

/** The request of a leg for one API ('routes' | 'directions'), and how to read its answer. */
export function googleCommuteRequest(api, leg) {
  return api === 'routes'
    ? { ...googleRoutesRequest(leg), parse: parseGoogleRoutesV2, provider: 'google_routes' }
    : { ...googleDirectionsRequest(leg), parse: parseGoogleDirections, provider: 'google_directions' };
}

/** The order to try the two APIs in: the one that answered last first, else Directions then Routes. */
export function commuteProviderOrder(provider) {
  return provider === 'routes' ? ['routes', 'directions'] : ['directions', 'routes'];
}

/** A leg after a good answer at `t`: asked again after the refresh, never sooner than the floor. */
export function commuteFetched(data, t, refreshMin = MIN_COMMUTE_REFRESH_MIN) {
  const ttl = Math.max(MIN_COMMUTE_REFRESH_MIN, Number(refreshMin) || MIN_COMMUTE_REFRESH_MIN) * 60_000;
  return { ...data, fetchedAt: t, at: t, nextAt: t + ttl, usedAt: t, error: null, failures: 0 };
}

/** A leg after a failed ask at `t` (code only): keeps the last good answer, waits longer after each failure. */
export function commuteFailed(prev, code, t) {
  const failures = (prev?.failures || 0) + 1;
  const waitMin = COMMUTE_KEY_ERRORS.has(code) || code === 'key_missing' ? 60 : COMMUTE_BACKOFF_MIN[Math.min(failures, COMMUTE_BACKOFF_MIN.length) - 1];
  return {
    durationSec: 0, normalDurationSec: 0, distanceMeters: 0, summary: '', provider: '', fetchedAt: 0,
    ...prev,
    at: t, nextAt: t + waitMin * 60_000, usedAt: t, error: code, failures,
  };
}

/** A leg not asked because there is no room for it (nothing is pushed out that would be asked again). */
export const commuteBusyLeg = (t) => ({
  durationSec: 0, normalDurationSec: 0, distanceMeters: 0, summary: '', provider: '', fetchedAt: 0, at: t, nextAt: t, usedAt: t, error: 'busy', failures: 0,
});

/**
 * The saved routes of a widget or card at `now` in `tz`: the valid ones (both addresses), at most MAX_COMMUTE_ROUTES,
 * each as `{ base, active, leg }`. `base` is what the screens get about the route (never the addresses); `leg`
 * ({ origin, destination, mode }) is what to ask Google, only for a route inside its schedule.
 */
export function planCommuteRoutes(routes, now, tz = 'UTC') {
  return (Array.isArray(routes) ? routes : [])
    .filter((r) => r && typeof r.origin === 'string' && r.origin.trim() && typeof r.destination === 'string' && r.destination.trim())
    .slice(0, MAX_COMMUTE_ROUTES)
    .map((route) => {
      const leg = resolveRouteLeg(route, now, tz);
      const mode = modeOf(route.mode);
      const base = { id: String(route.id || ''), name: String(route.name || '').trim(), mode, reversed: leg.reversed };
      return leg.active ? { base, active: true, leg: { origin: leg.origin, destination: leg.destination, mode } } : { base, active: false };
    });
}

/** One route of the answer to the screens (CommuteRouteResult), from its plan `base` and its kept leg `entry`. */
export function commuteRouteResult(base, entry, now, { showRouteSummary = true } = {}) {
  if (!entry) return { ...base, active: false, ok: false };
  if (!(entry.durationSec > 0)) return { ...base, active: true, ok: false, traffic: 'clear', error: entry.error || 'fetch_failed' };
  return {
    ...base,
    active: true,
    ok: true,
    durationSec: entry.durationSec,
    normalDurationSec: entry.normalDurationSec,
    delaySec: Math.max(0, entry.durationSec - entry.normalDurationSec),
    delayMin: delayMinutes(entry.durationSec, entry.normalDurationSec),
    distanceMeters: entry.distanceMeters,
    // only what the card draws: no road or line names when the owner turned the summary off
    summary: showRouteSummary ? entry.summary || '' : '',
    provider: entry.provider || 'google_directions',
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    stale: Boolean(entry.error) || now - entry.fetchedAt > COMMUTE_STALE_AFTER_MS,
    traffic: trafficLevel(entry.durationSec, entry.normalDurationSec, base.mode),
    error: entry.error || null,
  };
}

/**
 * The answer to the screens (CommuteResponse) from the plan and the kept legs: `entries[i]` is the leg of `plan[i]`
 * (undefined for a route outside its schedule). Never carries an address.
 */
export function commuteResponse(plan, entries, now, opts = {}) {
  let latest = 0;
  const routes = plan.map((p, i) => {
    const e = p.active ? entries[i] : undefined;
    if (e?.durationSec > 0) latest = Math.max(latest, e.fetchedAt);
    return commuteRouteResult(p.base, e, now, opts);
  });
  return { fetchedAt: new Date(latest || now).toISOString(), keySet: true, routes };
}

/** The checked input of the admin's test button: `{ origin, destination, mode }`, or null when an address is missing. */
export function testCommuteInput({ origin, destination, mode } = {}) {
  const o = typeof origin === 'string' ? origin.trim().slice(0, 200) : '';
  const d = typeof destination === 'string' ? destination.trim().slice(0, 200) : '';
  return o && d ? { origin: o, destination: d, mode: modeOf(mode) } : null;
}

/** The admin's test button answer from the leg it got: the time, or an error code the admin can explain. */
export function testCommuteResult(leg, mode) {
  if (!(leg?.durationSec > 0) || leg.error) {
    const code = leg?.error || 'fetch_failed';
    return { ok: false, error: COMMUTE_KEY_ERRORS.has(code) ? 'key_invalid' : code === 'no_route' ? 'not_found' : code };
  }
  return {
    ok: true,
    durationSec: leg.durationSec,
    normalDurationSec: leg.normalDurationSec,
    delaySec: Math.max(0, leg.durationSec - leg.normalDurationSec),
    traffic: trafficLevel(leg.durationSec, leg.normalDurationSec, mode),
    distanceMeters: leg.distanceMeters,
    summary: leg.summary || '',
    provider: leg.provider || 'google_directions',
  };
}
