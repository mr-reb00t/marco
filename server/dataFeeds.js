// Data cards on a self-hosted server (Personalizado, palette "Datos": market, sports, stocks, currency; and the Currency
// widget). What to ask, how to read
// it, how long to keep it and what a screen gets are in core/dataCore.js (Marco Cloud runs the same hub); this file
// does the network part and ties it to the saved screens.
//
// - Only the hosts in core/dataCore.js DATA_HOSTS, over https, with paths built from validated ids: no address ever
//   comes from a screen's config or a request. Redirects are refused, answers are capped (1 MB, crests 256 KB) and
//   every call times out after 10 s.
// - One cache for every screen and the builder: one upstream call per key per interval (60 s at the least), the last
//   good answer kept when a call fails, a 429 left alone for its Retry-After.
// - Screens never ask the sources: they get the numbers of their own items from GET /api/display/data and crests from
//   GET /api/display/data/crest/:token (routes/data.js).
// - The Finnhub key (stocks) lives in secrets.json (data.stocksKey), is never sent back and never reaches a display.
//
// MARCO_DATA_FAKE=1: made-up answers (core/dataFake.js), nothing leaves the machine.
import fs from 'node:fs';
import { createDataHub, CREST_MAX_BYTES, DATA_HOST_LIST, DATA_HOSTS, DATA_MAX_BYTES, DATA_TIMEOUT_MS, DataError, dataForItem, stocksKeyStatus } from './core/dataCore.js';
import { fakeDataCall, FAKE_STOCKS_KEY } from './core/dataFake.js';
import { retryAfterMs } from './core/pricesCore.js';
import { sniffImage } from './core/imageInfo.js';
import { getSecrets } from './store.js';

const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0';
  }
})();
const USER_AGENT = `Marco/${VERSION} (+https://github.com/mr-reb00t/marco)`;

/** Data kinds of a Personalizado screen. */
export const DATA_KINDS = ['market', 'sports', 'stocks', 'currency'];

async function readCapped(res, max) {
  const len = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(len) && len > max) throw new DataError('too_large');
  if (!res.body?.getReader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > max) throw new DataError('too_large');
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      void reader.cancel().catch(() => {});
      throw new DataError('too_large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

/** One GET to an allowed host: { status, text | bytes, type, retryAfterMs }. */
async function realGet(req, { binary = false } = {}) {
  if (!DATA_HOST_LIST.includes(req.host) || !String(req.path).startsWith('/')) throw new DataError('host', req.host);
  const res = await fetch(`https://${req.host}${req.path}`, {
    headers: { 'user-agent': USER_AGENT, accept: binary ? 'image/png,image/*' : 'application/json', ...(req.headers ?? {}) },
    redirect: 'manual',
    signal: AbortSignal.timeout(DATA_TIMEOUT_MS),
  });
  const ra = retryAfterMs(res.headers.get('retry-after'));
  if (res.status >= 300 && res.status < 400) {
    void res.body?.cancel?.().catch(() => {});
    return { status: 502, text: '', retryAfterMs: ra ?? undefined };
  }
  const bytes = res.status === 200 ? await readCapped(res, binary ? CREST_MAX_BYTES : DATA_MAX_BYTES) : (void res.body?.cancel?.().catch(() => {}), new Uint8Array());
  return binary
    ? { status: res.status, bytes, retryAfterMs: ra ?? undefined }
    : { status: res.status, text: new TextDecoder().decode(bytes), retryAfterMs: ra ?? undefined };
}

const fake = !!process.env.MARCO_DATA_FAKE;
let outbound = fake ? fakeDataCall() : (req) => realGet(req);
let crestGet = fake ? async () => ({ status: 404, bytes: new Uint8Array() }) : (req) => realGet(req, { binary: true });
let clock = () => Date.now();
let realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sleep = realSleep;

/** The household's Finnhub key (secrets.json); the fake mode has its own. */
export const stocksKey = () => String(getSecrets()?.data?.stocksKey || '') || (fake ? FAKE_STOCKS_KEY : '');

let hub = makeHub();
function makeHub() {
  // crests (req.binary) go through the same gate as everything else: one call at a time, spaced, a capped queue
  return createDataHub({ call: (req) => (req.binary ? crestGet(req) : outbound(req)), now: () => clock(), sleep: (ms) => sleep(ms), stocksKey, log: (m) => console.warn(`[data] ${m}`) });
}

/**
 * Tests replace the network (`f(req)` → { status, text }), the crest fetch, the clock and the gaps between calls; no
 * argument restores them. Clears every cache.
 */
export function setDataFetch(f = null, { now = null, crest = null, gaps = false } = {}) {
  outbound = f || (fake ? fakeDataCall() : (req) => realGet(req));
  crestGet = crest || (fake ? async () => ({ status: 404, bytes: new Uint8Array() }) : (req) => realGet(req, { binary: true }));
  clock = now || (() => Date.now());
  sleep = f && !gaps ? () => Promise.resolve() : realSleep;
  hub = makeHub();
  crestCache.clear();
  crestBytes = 0;
}

/** The numbers one data item shows (core/dataCore.js dataForItem; `preview`: the builder's, not a saved screen). */
export const itemData = (item, { preview = false } = {}) => dataForItem(hub, item, clock(), { preview });

/** Coin search for the builder's picker (CoinGecko, cached a day per text). */
export const searchCoins = (text) => hub.searchCoins(text);
/** The teams of a competition for the picker (cached a day). */
export const leagueTeams = (league) => hub.teams(league);
/** The ECB's currencies for the exchange rates picker (Frankfurter, cached a day). */
export const fxCurrencies = () => hub.fxCurrencies();
/** Symbol search for the stocks picker (Finnhub, needs the key). */
export const searchSymbols = (text) => hub.searchSymbols(text);

export const stocksStatus = () => stocksKeyStatus(stocksKey());
/** A new key: quotes are asked again. */
export const stocksKeyChanged = () => hub.keyChanged();

/** Tries a Finnhub key once with one quote: true (it works), false (refused) or null (could not tell). */
export async function checkStocksKey(key) {
  try {
    const r = await outbound({ host: DATA_HOSTS.finnhub, path: '/api/v1/quote?symbol=AAPL', headers: { 'x-finnhub-token': key } });
    if (r.status === 200) return true;
    if (r.status === 401 || r.status === 403) return false;
    return null;
  } catch {
    return null;
  }
}

const CREST_TTL = 24 * 3600_000;
const CREST_FAIL_TTL = 10 * 60_000;
/** A crest refused because the host's queue was full is asked again sooner. */
const CREST_BUSY_TTL = 30_000;
/** Pictures kept at most: as many as the tokens the hub knows (core/dataCore.js), and 16 MB in all. */
const CREST_CACHE_MAX = 400;
const CREST_CACHE_BYTES = 16 * 1024 * 1024;
const crestCache = new Map(); // token → { at, type, buf } | { at, error, ttl } | { promise }
let crestBytes = 0;

function crestSet(token, v) {
  const old = crestCache.get(token);
  if (old?.buf) crestBytes -= old.buf.length;
  crestCache.delete(token);
  crestCache.set(token, v);
  if (v.buf) crestBytes += v.buf.length;
  for (const [k, e] of crestCache) {
    if (crestCache.size <= CREST_CACHE_MAX && crestBytes <= CREST_CACHE_BYTES) break;
    if (e.promise || k === token) continue;
    if (e.buf) crestBytes -= e.buf.length;
    crestCache.delete(k);
  }
}

/** A crest's picture (PNG, JPEG or WebP, at most 256 KB) for a token a parsed answer handed out, cached a day. */
export async function crestImage(token) {
  const path = hub.crest(token);
  if (!path) throw new DataError('not_found');
  const hit = crestCache.get(token);
  const t = Date.now();
  if (hit?.buf && t - hit.at < CREST_TTL) return hit;
  if (hit?.error && t - hit.at < hit.ttl) throw new DataError(hit.error);
  if (hit?.promise) return hit.promise;
  const promise = (async () => {
    const r = await hub.get({ host: DATA_HOSTS.espnImg, path, binary: true }, { raw: true });
    const type = sniffImage(r.bytes);
    if (!type) throw new DataError('bad_response', 'not an image');
    return { at: Date.now(), type, buf: Buffer.from(r.bytes) };
  })();
  crestSet(token, { promise });
  promise.then(
    (v) => crestSet(token, v),
    (err) => {
      const code = err instanceof DataError ? err.code : 'fetch_failed';
      crestSet(token, { at: Date.now(), error: code, ttl: code === 'rate_limited' ? CREST_BUSY_TTL : CREST_FAIL_TTL });
    },
  );
  return promise;
}

/** Cache state for the admin (key → { at, error }); never a value or a key. */
export const dataStatus = () => hub.status();
