// Immich photo library as a background source (one server per install). Only this server talks to Immich: the
// API key (secrets.json) travels in the x-api-key header and never reaches a display, a URL or a log. Displays get
// the photos through GET /media/immich/<assetId> (immichMedia below), served from a disk cache in data/immich/.
//
// Album lists: cached per album for 30 minutes (stale while revalidating, one fetch at a time), failures for
// 60 seconds, and kept on disk so a restart while Immich is down still has photos (for up to 24 hours).
import fs from 'node:fs';
import path from 'node:path';
import { requestBuffer } from './lib/http.js';
import { events, getConfig, getSecrets, paths, writeFileAtomic } from './store.js';
import { publish } from './pollHub.js';
import { mediaScreens } from './displayAccess.js';
import { ruleAlbumIds } from './core/bgRules.js';
import {
  IMMICH_ID_RE, IMMICH_IMAGE_TYPES, MAX_IMMICH_ALBUMS, compactAsset, errorCodeFor, mapAlbum, mergeItems, missingScopes,
  normalizeImmichUrl, parseVersion, showableAsset, sniffImageType, usesSearch, versionText,
} from './core/immichCore.js';

const LIST_TTL = 30 * 60_000;
const FAIL_TTL = 60_000;
const STALE_MAX = 24 * 3600_000;
const VERSION_TTL = 10 * 60_000;
const PAGE_SIZE = 1000;
/** Assets kept per album (about 150 bytes each in memory). */
export const MAX_ALBUM_ASSETS = 20_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT = 20_000;
const MAX_CONCURRENT = 3;
const PRUNE_EVERY = 10 * 60_000;

export class ImmichError extends Error {
  constructor(code, message = code, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Saved settings, optionally overridden by unsaved values from the admin (test button). */
export function immichSettings(override = {}) {
  const cfg = getConfig()?.immich || {};
  return {
    enabled: cfg.enabled === true,
    url: normalizeImmichUrl(override.url ?? cfg.url ?? ''),
    key: override.key || getSecrets()?.immich?.apiKey || '',
    insecureTls: typeof override.insecureTls === 'boolean' ? override.insecureTls : cfg.insecureTls === true,
  };
}

/** Enabled, with a URL and a key. */
export const immichUsable = (s = immichSettings()) => Boolean(s.enabled && s.url && s.key);

// ---------------------------------------------------------------------------------------------------------------
// HTTP

async function call(s, p, { method = 'GET', json, accept = 'application/json', maxBytes = 64 * 1024 * 1024, timeout = 15_000 } = {}) {
  if (!s.url) throw new ImmichError('not_configured');
  const headers = { accept, ...(s.key ? { 'x-api-key': s.key } : {}), ...(json ? { 'content-type': 'application/json' } : {}) };
  let res;
  try {
    res = await requestBuffer(`${s.url}${p}`, { method, headers, body: json ? JSON.stringify(json) : undefined, insecureTls: s.insecureTls, maxBytes, timeout });
  } catch (err) {
    throw new ImmichError(/too large/i.test(err.message) ? 'too_large' : 'unreachable', err.message);
  }
  if (res.status < 200 || res.status >= 300) {
    // Only `message` is read from an error body.
    let message = '';
    try {
      const j = JSON.parse(res.buffer.toString('utf8'));
      if (typeof j?.message === 'string') message = j.message;
      else if (Array.isArray(j?.message)) message = j.message.filter((m) => typeof m === 'string').join('; ');
    } catch { /* not JSON */ }
    throw new ImmichError(errorCodeFor(res.status), (message || `HTTP ${res.status}`).slice(0, 200), res.status);
  }
  return res;
}

async function callJson(s, p, opts) {
  const res = await call(s, p, opts);
  try {
    return JSON.parse(res.buffer.toString('utf8'));
  } catch {
    throw new ImmichError('bad_response', 'Invalid JSON');
  }
}

const versions = new Map(); // url → { at, v }

/** Server version: /api/server/version, or /api/server-info/version on servers older than 1.118. Cached 10 min. */
export async function serverVersion(s = immichSettings(), { fresh = false } = {}) {
  const hit = versions.get(s.url);
  if (!fresh && hit && Date.now() - hit.at < VERSION_TTL) return hit.v;
  let j;
  try {
    j = await callJson(s, '/api/server/version');
  } catch (err) {
    if (err.code !== 'not_found') throw err;
    j = await callJson(s, '/api/server-info/version');
  }
  const v = parseVersion(j);
  if (!v) throw new ImmichError('bad_response', 'Unknown version');
  versions.set(s.url, { at: Date.now(), v });
  return v;
}

/**
 * Admin test: version, then the key (`/api/api-keys/me` lists its permissions; servers without it are checked with
 * the album list). Returns { ok, version?, missingScopes?, error? }; `error` is a code, never Immich's text.
 */
export async function testConnection(override = {}) {
  const s = immichSettings(override);
  if (!s.url) return { ok: false, error: 'not_configured' };
  let version = '';
  try {
    version = versionText(await serverVersion(s, { fresh: true }));
    if (!s.key) return { ok: false, version, error: 'key_missing' };
    let missing = [];
    try {
      const me = await callJson(s, '/api/api-keys/me');
      missing = missingScopes(me?.permissions);
    } catch (err) {
      if (err.code !== 'not_found' && err.code !== 'missing_scope') throw err;
      await callJson(s, '/api/albums');
    }
    return { ok: true, version, missingScopes: missing };
  } catch (err) {
    return { ok: false, ...(version ? { version } : {}), error: err instanceof ImmichError ? err.code : 'unreachable' };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Albums and their assets

const coverIds = new Set();

/** Albums for the admin picker (owned and shared with the key's user), by name. */
export async function listAlbums() {
  const s = immichSettings();
  if (!immichUsable(s)) throw new ImmichError('not_configured');
  const j = await callJson(s, '/api/albums');
  if (!Array.isArray(j)) throw new ImmichError('bad_response');
  const out = j.map(mapAlbum).filter(Boolean);
  for (const a of out) if (a.cover) coverIds.add(a.cover);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** One page loop over POST /api/search/metadata. The request shape lives only here (Immich 3.2 added a newer form). */
async function searchAssets(s, albumId, favoritesOnly) {
  const out = [];
  let page = 1;
  for (let i = 0; i < Math.ceil(MAX_ALBUM_ASSETS / PAGE_SIZE) + 1; i++) {
    const j = await callJson(s, '/api/search/metadata', {
      method: 'POST',
      json: { albumIds: [albumId], type: 'IMAGE', withExif: true, size: PAGE_SIZE, page, ...(favoritesOnly ? { isFavorite: true } : {}) },
    });
    const items = j?.assets?.items;
    if (!Array.isArray(items)) throw new ImmichError('bad_response');
    out.push(...items);
    const next = Number(j.assets.nextPage);
    if (out.length >= MAX_ALBUM_ASSETS || !j.assets.nextPage || !Number.isInteger(next) || next <= page) break;
    page = next;
  }
  return out;
}

async function albumRouteAssets(s, albumId) {
  let j;
  try {
    j = await callJson(s, `/api/albums/${albumId}?withoutAssets=false`);
  } catch (err) {
    // Immich answers 400 "Not found or no album.read access" for a deleted album or one the key cannot read
    if (err.status === 400 || err.status === 404) throw new ImmichError('not_found', err.message, err.status);
    throw err;
  }
  if (!Array.isArray(j?.assets)) throw new ImmichError('bad_response');
  return j.assets;
}

async function fetchAlbum(s, albumId, favoritesOnly) {
  const v = await serverVersion(s);
  let raw;
  if (usesSearch(v)) {
    try {
      raw = await searchAssets(s, albumId, favoritesOnly);
    } catch (err) {
      // 400: the search refused the album (no access, or a server without albumIds): ask the album itself
      if (err.status !== 400) throw err;
      raw = await albumRouteAssets(s, albumId);
    }
  } else raw = await albumRouteAssets(s, albumId);
  if (raw.length > MAX_ALBUM_ASSETS) console.warn(`[immich] album ${albumId} has ${raw.length} assets; only the first ${MAX_ALBUM_ASSETS} are used`);
  return raw.slice(0, MAX_ALBUM_ASSETS).filter((a) => showableAsset(a, { favoritesOnly })).map(compactAsset);
}

/** albumId|fav → { items, byId, at, failAt, error, missing, inflight } */
const lists = new Map();
/** Bumped by clearLists: a fetch that started before it is dropped (it belongs to the old server or key). */
let listsGen = 0;
const listKey = (albumId, fav) => `${albumId}|${fav ? 1 : 0}`;
const albumsDir = () => path.join(paths.data, 'immich', 'albums');
const albumFile = (albumId, fav) => path.join(albumsDir(), `${albumId}${fav ? '-fav' : ''}.json`);

function setItems(e, items, at) {
  e.items = items;
  e.byId = new Map(items.map((it) => [it.id, it.v]));
  e.at = at;
}

function listEntry(albumId, fav) {
  const k = listKey(albumId, fav);
  let e = lists.get(k);
  if (e) return e;
  e = { items: null, byId: new Map(), at: 0, failAt: 0, error: null, missing: false, inflight: null };
  try {
    const d = JSON.parse(fs.readFileSync(albumFile(albumId, fav), 'utf8'));
    if (Array.isArray(d?.items) && Number.isFinite(d.at) && Date.now() - d.at < STALE_MAX) {
      setItems(e, d.items.filter((it) => it && typeof it.id === 'string' && IMMICH_ID_RE.test(it.id)), d.at);
    }
  } catch { /* nothing on disk yet */ }
  lists.set(k, e);
  return e;
}

function refreshList(s, e, albumId, fav) {
  if (e.inflight) return e.inflight;
  const gen = listsGen;
  e.inflight = fetchAlbum(s, albumId, fav)
    .then((items) => {
      if (gen !== listsGen) return [];
      setItems(e, items, Date.now());
      Object.assign(e, { failAt: 0, error: null, missing: false });
      try {
        fs.mkdirSync(albumsDir(), { recursive: true });
        writeFileAtomic(albumFile(albumId, fav), JSON.stringify({ at: e.at, items }));
      } catch (err) {
        console.warn('[immich] album list not saved:', err.message);
      }
      return items;
    }, (err) => {
      if (gen !== listsGen) throw err;
      e.failAt = Date.now();
      e.error = err instanceof ImmichError ? err.code : 'unreachable';
      if (e.error === 'not_found') {
        // deleted or no longer shared: skipped (the other albums still play), flagged in the admin
        e.missing = true;
        setItems(e, [], Date.now());
      }
      console.warn(`[immich] album ${albumId}: ${e.error}`);
      throw err;
    })
    .finally(() => { e.inflight = null; });
  return e.inflight;
}

async function albumItems(s, albumId, fav) {
  const e = listEntry(albumId, fav);
  const age = Date.now() - e.at;
  if (e.items && age < LIST_TTL) return e.items;
  const failedRecently = e.failAt && Date.now() - e.failAt < FAIL_TTL;
  if (e.items && age < STALE_MAX) {
    if (!failedRecently) refreshList(s, e, albumId, fav).catch(() => {});
    return e.items;
  }
  if (failedRecently) return [];
  try {
    return await refreshList(s, e, albumId, fav);
  } catch {
    return [];
  }
}

/** Photos of a screen's selection ({ albumIds, favoritesOnly }), merged, duplicates removed. [] when unusable. */
export async function immichItems(sel) {
  const s = immichSettings();
  const ids = Array.isArray(sel?.albumIds) ? sel.albumIds.slice(0, MAX_IMMICH_ALBUMS) : [];
  if (!immichUsable(s) || !ids.length) return [];
  const fav = sel.favoritesOnly === true;
  return mergeItems(await Promise.all(ids.map((id) => albumItems(s, id, fav))));
}

/** Selections in use: [{ albumId, fav, screenId }]; the albums of special background rules count too (all photos). */
function selections(cfg = getConfig()) {
  const out = [];
  for (const sc of cfg?.screens || []) {
    const b = sc.background;
    for (const albumId of ruleAlbumIds(sc)) out.push({ albumId, fav: false, screenId: sc.id });
    if (b?.source !== 'immich') continue;
    for (const albumId of b.immich?.albumIds || []) out.push({ albumId, fav: b.immich.favoritesOnly === true, screenId: sc.id });
  }
  return out;
}

/** Version of an asset that belongs to a selection in use (of the screens in `screens` only, when given), or null. */
function assetVersion(id, screens = null) {
  for (const sel of selections()) {
    if (screens && !screens.some((sc) => sc.id === sel.screenId)) continue;
    // listEntry: after a restart the list comes back from disk (no fetch), so displays keep their current batch
    const v = listEntry(sel.albumId, sel.fav).byId.get(id);
    if (v !== undefined) return v;
  }
  return null;
}

/** Fetch again every album in use now (admin "Refresh now"). */
export async function refreshAll() {
  const s = immichSettings();
  if (!immichUsable(s)) return;
  const seen = new Set();
  await Promise.all(selections().map(({ albumId, fav }) => {
    const k = listKey(albumId, fav);
    if (seen.has(k)) return null;
    seen.add(k);
    return refreshList(s, listEntry(albumId, fav), albumId, fav).catch(() => {});
  }));
}

/** Forget every album list (memory and disk), e.g. when the server URL or the key changes. */
export function clearLists() {
  listsGen++;
  lists.clear();
  coverIds.clear();
  versions.clear();
  try { fs.rmSync(albumsDir(), { recursive: true, force: true }); } catch { /* ignore */ }
}

// another Immich server: its album lists and images are not this one's. Any change to the connection settings
// tells the displays to ask for a new batch, so they do not keep asking for photos that are gone.
events.on('config', (cfg, prev) => {
  if (!prev) return;
  const a = prev.immich || {}, b = cfg.immich || {};
  const urlChanged = normalizeImmichUrl(a.url) !== normalizeImmichUrl(b.url);
  if (urlChanged) {
    clearLists();
    clearCache();
  }
  if (urlChanged || (a.enabled === true) !== (b.enabled === true) || (a.insecureTls === true) !== (b.insecureTls === true)) {
    publish('photos', {});
  }
});

/** The stored key changed (admin): the lists were read with the old key, which may see other albums. */
export function keyChanged() {
  clearLists();
  publish('photos', {});
}

/** Admin status: albums in use with their state, and the image cache size. */
export function immichStatus() {
  const albums = [];
  const seen = new Set();
  for (const { albumId, fav } of selections()) {
    const k = listKey(albumId, fav);
    if (seen.has(k)) continue;
    seen.add(k);
    const e = lists.get(k);
    albums.push({
      id: albumId,
      favoritesOnly: fav,
      count: e?.items ? e.items.length : null,
      updatedAt: e?.at ? new Date(e.at).toISOString() : null,
      error: e?.error || null,
      missing: e?.missing === true,
    });
  }
  return { usable: immichUsable(), albums, cache: cacheStats() };
}

// ---------------------------------------------------------------------------------------------------------------
// Image cache and the media route

const cacheDir = () => path.join(paths.data, 'immich', 'cache');
export const cacheLimitBytes = (env = process.env) => {
  const mb = Number(env.MARCO_IMMICH_CACHE_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 500) * 1024 * 1024;
};

const imageInflight = new Map();
/** Bumped by clearCache: an image fetch that started before it is not written into the new cache. */
let cacheGen = 0;
let active = 0;
const waiting = [];
async function limited(fn) {
  while (active >= MAX_CONCURRENT) await new Promise((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function cachedFile(base) {
  for (const [type, ext] of Object.entries(IMMICH_IMAGE_TYPES)) {
    const file = path.join(cacheDir(), `${base}.${ext}`);
    if (fs.existsSync(file)) return { file, type };
  }
  return null;
}

let pruneTimer = null;
function schedulePrune() {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => { try { pruneCache(); } catch { /* ignore */ } }, PRUNE_EVERY);
  pruneTimer.unref?.();
}

/** Image of an asset (`size` preview or thumbnail) from the disk cache, fetched from Immich on a miss. */
export async function cachedImage(id, v, size = 'preview') {
  const base = `${id}-${v}${size === 'thumbnail' ? '-t' : ''}`;
  const hit = cachedFile(base);
  if (hit) {
    const now = new Date();
    try { fs.utimesSync(hit.file, now, now); } catch { /* LRU only */ }
    return hit;
  }
  if (imageInflight.has(base)) return imageInflight.get(base);
  const gen = cacheGen;
  const p = limited(async () => {
    const res = await call(immichSettings(), `/api/assets/${id}/thumbnail?size=${size}`, { accept: 'image/*', maxBytes: IMAGE_MAX_BYTES, timeout: IMAGE_TIMEOUT });
    let type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!IMMICH_IMAGE_TYPES[type]) {
      const sniffed = type === '' || type === 'application/octet-stream' ? sniffImageType(res.buffer) : null;
      if (!sniffed) throw new ImmichError('bad_type');
      type = sniffed;
    }
    if (gen !== cacheGen) throw new ImmichError('stale');
    fs.mkdirSync(cacheDir(), { recursive: true });
    const file = path.join(cacheDir(), `${base}.${IMMICH_IMAGE_TYPES[type]}`);
    writeFileAtomic(file, res.buffer);
    schedulePrune();
    return { file, type };
  }).finally(() => { if (imageInflight.get(base) === p) imageInflight.delete(base); });
  imageInflight.set(base, p);
  return p;
}

/** Fetch the first photos of a batch into the cache ahead of the display (fire and forget). */
export function warm(items, n = 3) {
  if (!immichUsable()) return;
  for (const it of items.slice(0, n)) cachedImage(it.id, it.v).catch(() => {});
}

function cacheFiles() {
  let names = [];
  try { names = fs.readdirSync(cacheDir()); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (name.includes('.tmp')) continue;
    try {
      const st = fs.statSync(path.join(cacheDir(), name));
      if (st.isFile()) out.push({ name, size: st.size, mtime: st.mtimeMs });
    } catch { /* removed meanwhile */ }
  }
  return out;
}

export function cacheStats() {
  const f = cacheFiles();
  return { files: f.length, bytes: f.reduce((n, x) => n + x.size, 0) };
}

/** Remove the least recently used images until the cache fits `max` bytes. Returns the bytes removed. */
export function pruneCache(max = cacheLimitBytes()) {
  const files = cacheFiles().sort((a, b) => a.mtime - b.mtime);
  let total = files.reduce((n, x) => n + x.size, 0);
  let freed = 0;
  for (const f of files) {
    if (total <= max) break;
    try {
      fs.rmSync(path.join(cacheDir(), f.name), { force: true });
      total -= f.size;
      freed += f.size;
    } catch { /* ignore */ }
  }
  return freed;
}

export function clearCache() {
  cacheGen++;
  imageInflight.clear();
  const { bytes } = cacheStats();
  try { fs.rmSync(cacheDir(), { recursive: true, force: true }); } catch { /* ignore */ }
  return bytes;
}

/**
 * GET /media/immich/:id (after mediaAuth). Only assets of an album some screen plays are served, so this is never
 * an open door into the library; a display bound to a screen only gets that screen's photos (bound to a carousel:
 * the photos of the carousel's screens), and none of a screen while it is private with "hide photos". ?s=thumb = small album covers for the admin picker (admin session only).
 */
export async function immichMedia(req, res) {
  const id = String(req.params.id || '').toLowerCase();
  res.set('x-content-type-options', 'nosniff');
  const fail = (status, msg) => res.status(status).set('cache-control', 'no-store').type('text/plain').send(msg);
  if (!IMMICH_ID_RE.test(id)) return fail(404, 'not found');
  const access = req.displayAccess || {};
  const thumb = req.query.s === 'thumb';
  let v;
  if (thumb) {
    if (access.via !== 'session') return fail(404, 'not found');
    v = coverIds.has(id) ? 'c' : assetVersion(id);
  } else {
    // a credential reads the photos of its screen (or its carousel's screens); open mode, every screen; a screen
    // that is private with "hide photos" serves none of its photos (displayAccess.js mediaScreens)
    const screens = mediaScreens(getConfig(), access);
    if (screens && !screens.length) return fail(404, 'not found');
    v = assetVersion(id, screens);
  }
  if (v === null || v === undefined) return fail(404, 'not found');
  if (!immichUsable()) return fail(503, 'immich not configured');
  try {
    const { file, type } = await cachedImage(id, v, thumb ? 'thumbnail' : 'preview');
    res.set('cache-control', 'private, max-age=2592000');
    res.type(type);
    res.sendFile(file, (err) => { if (err && !res.headersSent) fail(502, 'immich unavailable'); });
  } catch (err) {
    if (!(err instanceof ImmichError)) console.warn('[immich] image failed:', err.message);
    fail(502, 'immich unavailable');
  }
}

/** Tests: forget every cache in memory. */
export function _reset() {
  lists.clear();
  coverIds.clear();
  versions.clear();
  imageInflight.clear();
}
