// Commute times for the 'commute' widget on a self-hosted server: asks Google (Directions API, or Routes API v2 when
// Directions is not enabled for the key) and keeps each (origin, destination, mode) leg in memory, so several screens
// showing the same route never cost more than one request per refresh.
//
// Cost rules (every request is billed by Google past its free monthly allowance):
// - only saved routes of a widget a screen shows reach this file from the displays (routes/public.js), and the admin's
//   test button (one request per route and minute at the most)
// - a leg is fetched again after its widget's refresh, never sooner than MIN_COMMUTE_REFRESH_MIN minutes
// - a route outside its schedule (days, from, to) is not fetched at all
// - a failure is remembered and retried later and later (BACKOFF_MIN), whoever asks in between
// - the cache holds MAX_CACHE_ENTRIES legs at the most, more than a saved config can use at once (20 widgets and
//   12 screens of 4 Trayectos cards, 8 routes each: 544 legs). A leg not due again yet is never pushed out: when the
//   cache is full of those, a new leg answers 'busy' and Google is not asked (else every ask would push out another
//   leg and be asked again, whatever the refresh)
//
// The API key never leaves this file: errors carry a code only (core/commuteCore.js CommuteError).
import {
  COMMUTE_MODES, CommuteError, commuteKeyStatus as keyStatus, delayMinutes, googleRoutesTravelMode,
  MAX_COMMUTE_ROUTES, MIN_COMMUTE_REFRESH_MIN, parseGoogleDirections, parseGoogleRoutesV2, resolveRouteLeg, trafficLevel,
} from './core/commuteCore.js';
import { getConfig, getSecrets } from './store.js';

export { CommuteError, COMMUTE_KEY_RE } from './core/commuteCore.js';

const TIMEOUT = 15_000;
const STALE_AFTER_MS = 45 * 60_000;
const FORGET_AFTER_MS = 24 * 3600_000;
const MAX_CACHE_ENTRIES = 1000;
/** The admin's test button: a route already asked within this time is answered from memory. */
const TEST_MIN_MS = 60_000;
/** Wait before trying a failed leg again, by number of failures in a row (minutes). */
const BACKOFF_MIN = [2, 5, 15, 30, 60];
/** A key Google refuses is not asked again for an hour (or until the key changes). */
const KEY_ERRORS = new Set(['key_invalid', 'http_denied']);

async function realFetch(url, init = {}) {
  const signal = AbortSignal.timeout(TIMEOUT);
  return fetch(url, { ...init, signal, redirect: 'manual' });
}

let outbound = realFetch;
let clock = () => Date.now();
/** The Google API that answered last: 'directions' | 'routes', null = not known yet (Directions first). */
let provider = null;

/** legKey -> { durationSec, normalDurationSec, distanceMeters, summary, provider, fetchedAt, at, nextAt, usedAt, error, failures } */
const cache = new Map();
const inflight = new Map();

/** Tests replace the network and clock; null restores them. Either way the cache is cleared. */
export function setCommuteFetch(f, now = null) {
  outbound = f || realFetch;
  clock = now || (() => Date.now());
  provider = null;
  cache.clear();
  inflight.clear();
}

/** Number of legs in memory (tests). */
export const commuteCacheSize = () => cache.size;

/** The household's Google Maps API key (secrets.json or GOOGLE_MAPS_API_KEY env). */
export const commuteKey = () => String(getSecrets()?.commute?.apiKey || process.env.GOOGLE_MAPS_API_KEY || '').trim();

/** Whether a Google Maps API key is saved and its last 4 characters, never the key itself. */
export const commuteKeyStatus = (k = commuteKey()) => keyStatus(k);
/** What the admin sees about the key in use: the saved one, or GOOGLE_MAPS_API_KEY when nothing is saved
 *  (fromEnv: removing that one means changing the server's environment). */
export function commuteKeyInUse() {
  const k = commuteKey();
  const saved = String(getSecrets()?.commute?.apiKey || '').trim();
  return k && !saved ? { ...keyStatus(k), fromEnv: true } : keyStatus(k);
}

/** The key changed: every leg may be asked again now, and the API to use is found again. */
export function commuteKeyChanged() {
  provider = null;
  for (const e of cache.values()) {
    e.nextAt = 0;
    e.failures = 0;
  }
}

function legCacheKey(origin, destination, mode) {
  const o = origin.trim().slice(0, 200).toLowerCase();
  const d = destination.trim().slice(0, 200).toLowerCase();
  return `${mode}|${o}|${d}`;
}

/** Makes room for one more leg: false when every leg in memory is still waiting for its next ask (nothing goes). */
function forgetUnused(now) {
  for (const [k, e] of cache) {
    if (now - e.usedAt > FORGET_AFTER_MS) cache.delete(k);
  }
  if (cache.size < MAX_CACHE_ENTRIES) return true;
  // the least recently used legs that are due again go first, leaving room for one more
  const due = [...cache.entries()].filter(([k, e]) => now >= e.nextAt && !inflight.has(k)).sort((a, b) => (a[1].usedAt || 0) - (b[1].usedAt || 0));
  for (let i = 0; i < due.length && cache.size >= MAX_CACHE_ENTRIES; i++) cache.delete(due[i][0]);
  return cache.size < MAX_CACHE_ENTRIES;
}

/** Room for this many legs (tests). */
export const COMMUTE_CACHE_MAX = MAX_CACHE_ENTRIES;

/** One request to Google's network; a network failure becomes a code (the error would carry the URL). */
async function ask(url, init) {
  try {
    const res = await outbound(url, init);
    return await res.text();
  } catch (err) {
    throw new CommuteError(err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'fetch_failed');
  }
}

async function askDirections({ origin, destination, mode, apiKey }) {
  const u = new URL('https://maps.googleapis.com/maps/api/directions/json');
  u.searchParams.set('origin', origin);
  u.searchParams.set('destination', destination);
  u.searchParams.set('mode', COMMUTE_MODES.includes(mode) ? mode : 'driving');
  u.searchParams.set('departure_time', 'now');
  u.searchParams.set('key', apiKey);
  const text = await ask(u.href, { method: 'GET', headers: { accept: 'application/json' } });
  return { ...parseGoogleDirections(text), provider: 'google_directions' };
}

async function askRoutes({ origin, destination, mode, apiKey }) {
  const body = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: googleRoutesTravelMode(mode),
    ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
  };
  const text = await ask('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
      'x-goog-fieldmask': 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description',
    },
    body: JSON.stringify(body),
  });
  return { ...parseGoogleRoutesV2(text), provider: 'google_routes' };
}

/**
 * One leg from Google: the API that answered last, else Directions first. When that API is not enabled for the key
 * ('http_denied'), the other one is tried once and remembered. `single`: one request at the most, nothing remembered
 * (the key check).
 */
async function fetchGoogleLeg({ origin, destination, mode, apiKey, single = false }) {
  if (!apiKey) throw new CommuteError('key_missing');
  const order = provider === 'routes' ? ['routes', 'directions'] : ['directions', 'routes'];
  const call = (p) => (p === 'routes' ? askRoutes : askDirections)({ origin, destination, mode, apiKey });
  try {
    const out = await call(order[0]);
    if (!single) provider = order[0];
    return out;
  } catch (err) {
    if (single || !(err instanceof CommuteError) || err.code !== 'http_denied') throw err;
    const out = await call(order[1]);
    provider = order[1];
    return out;
  }
}

function failed(prev, code, t) {
  const failures = (prev?.failures || 0) + 1;
  const waitMin = KEY_ERRORS.has(code) || code === 'key_missing' ? 60 : BACKOFF_MIN[Math.min(failures, BACKOFF_MIN.length) - 1];
  return {
    durationSec: 0, normalDurationSec: 0, distanceMeters: 0, summary: '', provider: '', fetchedAt: 0,
    ...prev,
    at: t, nextAt: t + waitMin * 60_000, usedAt: t, error: code, failures,
  };
}

/**
 * The leg from memory, or from Google when it is due (`test`: the admin's button, due a minute after the last ask).
 * Never throws: a leg that never answered has durationSec 0 and `error`.
 */
async function getLeg({ origin, destination, mode, refreshMin = MIN_COMMUTE_REFRESH_MIN, test = false }) {
  const now = clock();
  const key = legCacheKey(origin, destination, mode);
  // (a full cache of legs not due yet: the new one is not asked, rather than pushing out one that would be asked again)
  if (!cache.has(key) && !inflight.has(key) && !forgetUnused(now)) {
    return { durationSec: 0, normalDurationSec: 0, distanceMeters: 0, summary: '', provider: '', fetchedAt: 0, at: now, nextAt: now, usedAt: now, error: 'busy', failures: 0 };
  }
  const ttl = Math.max(MIN_COMMUTE_REFRESH_MIN, Number(refreshMin) || MIN_COMMUTE_REFRESH_MIN) * 60_000;
  let entry = cache.get(key);
  const due = !entry || (test ? now - entry.at >= TEST_MIN_MS : now >= entry.nextAt);
  if (due) {
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        const prev = cache.get(key);
        let next;
        try {
          const data = await fetchGoogleLeg({ origin, destination, mode, apiKey: commuteKey() });
          const t = clock();
          next = { ...data, fetchedAt: t, at: t, nextAt: t + ttl, usedAt: t, error: null, failures: 0 };
        } catch (err) {
          next = failed(prev, err instanceof CommuteError ? err.code : 'fetch_failed', clock());
        }
        cache.set(key, next);
        return next;
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    // with a good answer in memory the screens get it now and the new one on their next ask
    if (test || !(entry?.durationSec > 0)) entry = await p;
  }
  entry.usedAt = now;
  return entry;
}

/**
 * Travel times of a saved commute widget's routes now: `routes` from the saved config only (routes/public.js), never
 * from a request. Returns CommuteResponse: { fetchedAt, keySet, routes: CommuteRouteResult[] }, without addresses.
 */
export async function getCommute(routes = [], { tz, refreshMin = MIN_COMMUTE_REFRESH_MIN, showRouteSummary = true } = {}) {
  const zone = tz || getConfig()?.datetime?.timezone || 'UTC';
  const now = clock();
  if (!commuteKey()) return { fetchedAt: new Date(now).toISOString(), keySet: false, routes: [] };
  const valid = (Array.isArray(routes) ? routes : [])
    .filter((r) => r && typeof r.origin === 'string' && r.origin.trim() && typeof r.destination === 'string' && r.destination.trim())
    .slice(0, MAX_COMMUTE_ROUTES);

  const out = [];
  let latestFetch = 0;
  for (const route of valid) {
    const leg = resolveRouteLeg(route, now, zone);
    const mode = COMMUTE_MODES.includes(route.mode) ? route.mode : 'driving';
    const base = { id: String(route.id || ''), name: String(route.name || '').trim(), mode, reversed: leg.reversed };
    // outside its schedule: shown as inactive, and Google is not asked
    if (!leg.active) {
      out.push({ ...base, active: false, ok: false });
      continue;
    }
    const e = await getLeg({ origin: leg.origin, destination: leg.destination, mode, refreshMin });
    if (!(e.durationSec > 0)) {
      out.push({ ...base, active: true, ok: false, traffic: 'clear', error: e.error || 'fetch_failed' });
      continue;
    }
    latestFetch = Math.max(latestFetch, e.fetchedAt);
    out.push({
      ...base,
      active: true,
      ok: true,
      durationSec: e.durationSec,
      normalDurationSec: e.normalDurationSec,
      delaySec: Math.max(0, e.durationSec - e.normalDurationSec),
      delayMin: delayMinutes(e.durationSec, e.normalDurationSec),
      distanceMeters: e.distanceMeters,
      // only what the card draws: no road or line names when the owner turned the summary off
      summary: showRouteSummary ? e.summary || '' : '',
      provider: e.provider || 'google_directions',
      fetchedAt: new Date(e.fetchedAt).toISOString(),
      stale: Boolean(e.error) || now - e.fetchedAt > STALE_AFTER_MS,
      traffic: trafficLevel(e.durationSec, e.normalDurationSec, mode),
      error: e.error || null,
    });
  }
  return { fetchedAt: new Date(latestFetch || now).toISOString(), keySet: true, routes: out };
}

/** POST /api/admin/test/commute: tests a single route leg `{ origin, destination, mode }` now (admin session). */
export async function testCommute({ origin, destination, mode = 'driving' } = {}) {
  const o = typeof origin === 'string' ? origin.trim().slice(0, 200) : '';
  const d = typeof destination === 'string' ? destination.trim().slice(0, 200) : '';
  const m = COMMUTE_MODES.includes(mode) ? mode : 'driving';
  if (!o || !d) return { ok: false, error: 'invalid_route' };
  if (!commuteKey()) return { ok: false, error: 'key_missing' };
  const leg = await getLeg({ origin: o, destination: d, mode: m, test: true });
  if (!(leg.durationSec > 0) || leg.error) {
    const code = leg.error || 'fetch_failed';
    return { ok: false, error: KEY_ERRORS.has(code) ? 'key_invalid' : code === 'no_route' ? 'not_found' : code };
  }
  return {
    ok: true,
    durationSec: leg.durationSec,
    normalDurationSec: leg.normalDurationSec,
    delaySec: Math.max(0, leg.durationSec - leg.normalDurationSec),
    traffic: trafficLevel(leg.durationSec, leg.normalDurationSec, m),
    distanceMeters: leg.distanceMeters,
    summary: leg.summary || '',
    provider: leg.provider || 'google_directions',
  };
}

/**
 * Checks a Google Maps API key with one request at the most: true (it answered), false (Google says the key itself
 * is wrong) or null (anything else, such as an API not enabled yet or no network: the key is saved unchecked).
 */
export async function checkCommuteKey(key) {
  try {
    await fetchGoogleLeg({ origin: 'Lisbon, Portugal', destination: 'Porto, Portugal', mode: 'driving', apiKey: key, single: true });
    return true;
  } catch (err) {
    if (err instanceof CommuteError && err.code === 'key_invalid') return false;
    return null;
  }
}
