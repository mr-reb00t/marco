// Commute times for the 'commute' widget on a self-hosted server: queries Google Routes / Directions API
// and caches each (origin, destination, mode) leg in memory so multiple screens never duplicate API calls.
import {
  COMMUTE_KEY_RE, COMMUTE_MODES, CommuteError, commuteKeyStatus as keyStatus, delayMinutes,
  googleRoutesTravelMode, MAX_COMMUTE_ROUTES, parseGoogleDirections, parseGoogleRoutesV2,
  resolveRouteLeg, trafficLevel,
} from './core/commuteCore.js';
import { getConfig, getSecrets } from './store.js';

export { CommuteError, COMMUTE_KEY_RE } from './core/commuteCore.js';

const TIMEOUT = 15_000;
const MIN_CACHE_MS = 5 * 60_000;
const STALE_AFTER_MS = 45 * 60_000;
const FORGET_AFTER_MS = 24 * 3600_000;
const MAX_CACHE_ENTRIES = 200;

async function realFetch(url, init = {}) {
  const signal = AbortSignal.timeout(TIMEOUT);
  return fetch(url, { ...init, signal, redirect: 'manual' });
}

let outbound = realFetch;
let clock = () => Date.now();

/** Tests replace the network and clock; null restores them and clears the cache. */
export function setCommuteFetch(f, now = null) {
  outbound = f || realFetch;
  clock = now || (() => Date.now());
  cache.clear();
  inflight.clear();
}

/** The household's Google Maps API key (secrets.json or GOOGLE_MAPS_API_KEY env). */
export const commuteKey = () => String(getSecrets()?.commute?.apiKey || process.env.GOOGLE_MAPS_API_KEY || '').trim();

/** Whether a Google Maps API key is saved and its last 4 characters, never the key itself. */
export const commuteKeyStatus = (k = commuteKey()) => keyStatus(k);

/** Clear refresh timestamps when the API key changes. */
export function commuteKeyChanged() {
  for (const e of cache.values()) e.nextAt = 0;
}

/** legKey -> { durationSec, normalDurationSec, distanceMeters, summary, provider, fetchedAt, nextAt, usedAt, error } */
const cache = new Map();
const inflight = new Map();

function legCacheKey(origin, destination, mode) {
  const o = origin.trim().slice(0, 200).toLowerCase();
  const d = destination.trim().slice(0, 200).toLowerCase();
  return `${mode}|${o}|${d}`;
}

function forgetUnused(now) {
  for (const [k, e] of cache) {
    if (now - e.usedAt > FORGET_AFTER_MS) cache.delete(k);
  }
  if (cache.size > MAX_CACHE_ENTRIES) {
    // Drop the oldest-used entries when exceeding maximum capacity
    const sorted = [...cache.entries()].sort((a, b) => (a[1].usedAt || 0) - (b[1].usedAt || 0));
    for (let i = 0; i < sorted.length - MAX_CACHE_ENTRIES; i++) {
      cache.delete(sorted[i][0]);
    }
  }
}

/**
 * Queries Google Directions API (`maps.googleapis.com/maps/api/directions/json`), and if that API is not enabled
 * on the Google Cloud project (`REQUEST_DENIED`), falls back to Google Routes API v2 (`routes.googleapis.com`).
 */
async function fetchGoogleLeg({ origin, destination, mode, apiKey }) {
  if (!apiKey) throw new CommuteError('key_missing', 'Google Maps API key not configured');
  const u = new URL('https://maps.googleapis.com/maps/api/directions/json');
  u.searchParams.set('origin', origin);
  u.searchParams.set('destination', destination);
  u.searchParams.set('mode', COMMUTE_MODES.includes(mode) ? mode : 'driving');
  u.searchParams.set('departure_time', 'now');
  u.searchParams.set('key', apiKey);

  let res;
  try {
    res = await outbound(u.href, { method: 'GET', headers: { accept: 'application/json' } });
  } catch (err) {
    throw new CommuteError(err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'fetch_failed');
  }
  const text = await res.text();
  try {
    return { ...parseGoogleDirections(text), provider: 'google_directions' };
  } catch (dirErr) {
    // If Directions API v1 is disabled on the project, try Routes API v2 (`computeRoutes`) before failing
    if (!(dirErr instanceof CommuteError) || dirErr.code !== 'http_denied') throw dirErr;
    const body = {
      origin: { address: origin },
      destination: { address: destination },
      travelMode: googleRoutesTravelMode(mode),
      ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
    };
    let v2Res;
    try {
      v2Res = await outbound('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
          'x-goog-fieldmask': 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw dirErr;
    }
    return { ...parseGoogleRoutesV2(await v2Res.text()), provider: 'google_routes' };
  }
}

async function getLeg({ origin, destination, mode, refreshMin = 10, force = false }) {
  const now = clock();
  forgetUnused(now);
  const key = legCacheKey(origin, destination, mode);
  const ttl = Math.max(MIN_CACHE_MS, (Number(refreshMin) || 10) * 60_000);
  let entry = cache.get(key);
  const due = !entry || (force ? now - entry.fetchedAt > 30_000 : now >= entry.nextAt);
  if (due) {
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        try {
          const data = await fetchGoogleLeg({ origin, destination, mode, apiKey: commuteKey() });
          const next = {
            ...data,
            fetchedAt: clock(),
            nextAt: clock() + ttl,
            usedAt: clock(),
            error: null,
          };
          cache.set(key, next);
          return next;
        } catch (err) {
          const code = err instanceof CommuteError ? err.code : 'fetch_failed';
          if (entry && entry.durationSec > 0) {
            entry.error = code;
            entry.nextAt = clock() + 2 * 60_000;
            return entry;
          }
          throw err instanceof CommuteError ? err : new CommuteError(code);
        }
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    if (force || !entry?.durationSec) entry = await p;
    else p.catch(() => {});
  }
  entry.usedAt = now;
  return entry;
}

/**
 * Evaluates a list of routes for a commute widget at the current time.
 * Accepts `getCommute(routes, { tz, refreshMin, force })` or `getCommute({ routes, tz, refreshMin, force })`.
 * Returns CommuteResponse: { fetchedAt, keySet, routes: CommuteRouteResult[] }.
 */
export async function getCommute(routesOrOpts = [], opts = {}) {
  const isArr = Array.isArray(routesOrOpts);
  const routes = isArr ? routesOrOpts : routesOrOpts?.routes || [];
  const options = isArr ? opts : routesOrOpts || {};
  const refreshMin = options.refreshMin ?? 10;
  const tz = options.tz || getConfig()?.datetime?.timezone || 'UTC';
  const force = Boolean(options.force);

  const now = clock();
  const apiKey = commuteKey();
  if (!apiKey) {
    return {
      fetchedAt: new Date(now).toISOString(),
      keySet: false,
      routes: [],
    };
  }
  const validRoutes = (Array.isArray(routes) ? routes : [])
    .filter((r) => r && typeof r.origin === 'string' && r.origin.trim() && typeof r.destination === 'string' && r.destination.trim())
    .slice(0, MAX_COMMUTE_ROUTES);

  const resolved = validRoutes.map((r) => {
    const leg = resolveRouteLeg(r, now, tz);
    return { route: r, ...leg };
  });

  const outRoutes = [];
  let latestFetch = 0;

  for (const item of resolved) {
    const mode = COMMUTE_MODES.includes(item.route.mode) ? item.route.mode : 'driving';
    if (!item.active) {
      outRoutes.push({
        id: String(item.route.id || ''),
        name: String(item.route.name || '').trim() || `${item.origin} → ${item.destination}`,
        origin: item.origin,
        destination: item.destination,
        mode,
        reversed: item.reversed,
        active: false,
        ok: false,
      });
      continue;
    }
    try {
      const leg = await getLeg({
        origin: item.origin,
        destination: item.destination,
        mode,
        refreshMin,
        force,
      });
      latestFetch = Math.max(latestFetch, leg.fetchedAt);
      const stale = Boolean(leg.error) || now - leg.fetchedAt > STALE_AFTER_MS;
      outRoutes.push({
        id: String(item.route.id || ''),
        name: String(item.route.name || '').trim() || `${item.origin} → ${item.destination}`,
        origin: item.origin,
        destination: item.destination,
        mode,
        reversed: item.reversed,
        active: true,
        ok: true,
        durationSec: leg.durationSec,
        normalDurationSec: leg.normalDurationSec,
        delaySec: Math.max(0, leg.durationSec - leg.normalDurationSec),
        delayMin: delayMinutes(leg.durationSec, leg.normalDurationSec),
        distanceMeters: leg.distanceMeters,
        summary: leg.summary || '',
        provider: leg.provider || 'google_directions',
        fetchedAt: new Date(leg.fetchedAt).toISOString(),
        stale,
        traffic: trafficLevel(leg.durationSec, leg.normalDurationSec, mode),
        error: leg.error || null,
      });
    } catch (err) {
      const code = err instanceof CommuteError ? err.code : 'fetch_failed';
      outRoutes.push({
        id: String(item.route.id || ''),
        name: String(item.route.name || '').trim() || `${item.origin} → ${item.destination}`,
        origin: item.origin,
        destination: item.destination,
        mode,
        reversed: item.reversed,
        active: true,
        ok: false,
        durationSec: 0,
        normalDurationSec: 0,
        delaySec: 0,
        delayMin: 0,
        distanceMeters: 0,
        summary: '',
        traffic: 'clear',
        error: code,
      });
    }
  }

  return {
    fetchedAt: new Date(latestFetch || now).toISOString(),
    keySet: true,
    routes: outRoutes,
  };
}

/** POST /api/admin/test/commute: tests a single route leg `{ origin, destination, mode }` now. */
export async function testCommute({ origin, destination, mode = 'driving' } = {}) {
  const o = typeof origin === 'string' ? origin.trim().slice(0, 200) : '';
  const d = typeof destination === 'string' ? destination.trim().slice(0, 200) : '';
  const m = COMMUTE_MODES.includes(mode) ? mode : 'driving';
  if (!o || !d) return { ok: false, error: 'invalid_route' };
  const apiKey = commuteKey();
  if (!apiKey) return { ok: false, error: 'key_missing' };
  try {
    const leg = await getLeg({ origin: o, destination: d, mode: m, force: true });
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
  } catch (err) {
    const code = err instanceof CommuteError ? err.code : 'fetch_failed';
    const mapped = code === 'http_denied' ? 'key_invalid' : code === 'no_route' ? 'not_found' : code;
    return { ok: false, error: mapped };
  }
}

/** Validates a Google Maps API key once; returns true, false (explicitly denied), or null (network/other error). */
export async function checkCommuteKey(key) {
  try {
    await fetchGoogleLeg({
      origin: 'Lisbon, Portugal',
      destination: 'Porto, Portugal',
      mode: 'driving',
      apiKey: key,
    });
    return true;
  } catch (err) {
    if (err instanceof CommuteError && err.code === 'http_denied') return false;
    return null;
  }
}
