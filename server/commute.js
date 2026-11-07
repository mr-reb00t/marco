// Commute times for the 'commute' widget on a self-hosted server: asks Google (Directions API, or Routes API v2 when
// Directions is not enabled for the key) and keeps each (origin, destination, mode) leg in memory, so several screens
// showing the same route never cost more than one request per refresh.
//
// Cost rules (every request is billed by Google past its free monthly allowance):
// - only saved routes of a widget a screen shows reach this file from the displays (routes/public.js), and the admin's
//   test button (one request per route and minute at the most)
// - a leg is fetched again after its widget's refresh, never sooner than MIN_COMMUTE_REFRESH_MIN minutes
// - a route outside its schedule (days, from, to) is not fetched at all
// - a failure is remembered and retried later and later (COMMUTE_BACKOFF_MIN), whoever asks in between
// - the cache holds MAX_CACHE_ENTRIES legs at the most, more than a saved config can use at once (20 widgets and
//   12 screens of 4 Trayectos cards, 8 routes each: 544 legs). A leg not due again yet is never pushed out: when the
//   cache is full of those, a new leg answers 'busy' and Google is not asked (else every ask would push out another
//   leg and be asked again, whatever the refresh)
//
// The requests, the waiting rules and the answer to the screens are in core/commuteCore.js (Marco Cloud uses them
// too); this file asks Google and keeps the legs. The API key never leaves it: errors carry a code only (CommuteError).
import {
  COMMUTE_FORGET_AFTER_MS, COMMUTE_TEST_MIN_MS, CommuteError, commuteBusyLeg, commuteFailed, commuteFetched,
  commuteKeyStatus as keyStatus, commuteLegKey, commuteProviderOrder, commuteResponse, googleCommuteRequest,
  MIN_COMMUTE_REFRESH_MIN, planCommuteRoutes, testCommuteInput, testCommuteResult,
} from './core/commuteCore.js';
import { getConfig, getSecrets } from './store.js';

export { CommuteError, COMMUTE_KEY_RE } from './core/commuteCore.js';

const TIMEOUT = 15_000;
const MAX_CACHE_ENTRIES = 1000;

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

/** Makes room for one more leg: false when every leg in memory is still waiting for its next ask (nothing goes). */
function forgetUnused(now) {
  for (const [k, e] of cache) {
    if (now - e.usedAt > COMMUTE_FORGET_AFTER_MS) cache.delete(k);
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

/**
 * One leg from Google: the API that answered last, else Directions first. When that API is not enabled for the key
 * ('http_denied'), the other one is tried once and remembered. `single`: one request at the most, nothing remembered
 * (the key check).
 */
async function fetchGoogleLeg({ origin, destination, mode, apiKey, single = false }) {
  if (!apiKey) throw new CommuteError('key_missing');
  const order = commuteProviderOrder(provider);
  const call = async (p) => {
    const req = googleCommuteRequest(p, { origin, destination, mode, apiKey });
    const text = await ask(req.url, req.init);
    return { ...req.parse(text), provider: req.provider };
  };
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

/**
 * The leg from memory, or from Google when it is due (`test`: the admin's button, due a minute after the last ask).
 * Never throws: a leg that never answered has durationSec 0 and `error`.
 */
async function getLeg({ origin, destination, mode, refreshMin = MIN_COMMUTE_REFRESH_MIN, test = false }) {
  const now = clock();
  const key = commuteLegKey(origin, destination, mode);
  // (a full cache of legs not due yet: the new one is not asked, rather than pushing out one that would be asked again)
  if (!cache.has(key) && !inflight.has(key) && !forgetUnused(now)) {
    return commuteBusyLeg(now);
  }
  let entry = cache.get(key);
  const due = !entry || (test ? now - entry.at >= COMMUTE_TEST_MIN_MS : now >= entry.nextAt);
  if (due) {
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        const prev = cache.get(key);
        let next;
        try {
          const data = await fetchGoogleLeg({ origin, destination, mode, apiKey: commuteKey() });
          next = commuteFetched(data, clock(), refreshMin);
        } catch (err) {
          next = commuteFailed(prev, err instanceof CommuteError ? err.code : 'fetch_failed', clock());
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
  const plan = planCommuteRoutes(routes, now, zone);
  const entries = [];
  // one at a time, as before: a route outside its schedule is not asked
  for (const p of plan) entries.push(p.active ? await getLeg({ ...p.leg, refreshMin }) : undefined);
  return commuteResponse(plan, entries, now, { showRouteSummary });
}

/** POST /api/admin/test/commute: tests a single route leg `{ origin, destination, mode }` now (admin session). */
export async function testCommute(body = {}) {
  const input = testCommuteInput(body);
  if (!input) return { ok: false, error: 'invalid_route' };
  if (!commuteKey()) return { ok: false, error: 'key_missing' };
  return testCommuteResult(await getLeg({ ...input, test: true }), input.mode);
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
