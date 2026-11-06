// Commute time widget ('commute'): pure helpers shared by the server, the admin and the display.
// No Node built-ins (checked by server/test/core-lint.test.js).
import { zonedParts } from './lib/tz.js';

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
