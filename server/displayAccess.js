// Private display links + paired devices: who may read the display API. See SECURITY.md, docs/API.md and
// docs/ARCHITECTURE.md ("Display access").
//
// config.security.displayAccess:
//   'private' (default for fresh installs): every display-facing endpoint needs one of:
//       - a screen's display key   (UUIDv4, the private link /d/<key>; secrets.displayKeys[screenId].key)
//       - a paired-device token    (md_ + 43 base64url chars; only sha256 stored in secrets.devices[])
//       - a valid admin session    (admin preview iframe, "View screen" links)
//   'open' (installs from before 0.3): legacy LAN mode: / and /?screen=<slug> work without a key. Keys and device
//       tokens still work (and still bind the screen); an invalid one is still refused.
//
// Credentials travel in the X-Marco-Key header (fetch) or ?k= (EventSource and <img>/WebGL photo URLs, where
// headers are impossible). A credential always decides the screen, so a key for the kitchen never reads the living
// room. A key or device bound to a carousel may read the carousel's screens, and only those; any binding may also
// read the screens its own "Ir a pantalla" cards lead to (core/carousels.js reachableScreens), never others.
// Comparisons are constant-time (sha256 digests + timingSafeEqual over every entry).
import crypto from 'node:crypto';
import { getConfig, getSecrets, updateSecrets, flushSecrets } from './store.js';
import { sessionValid, isLanClient, authEvents, SESSION_MAX_AGE } from './auth.js';
import { listClients, dropClient } from './sse.js';
import { listPollers, dropPollers } from './pollHub.js';
import { logActivity } from './activity.js';
import { resolveScreen } from './core/screens.js';
import { ruleGalleryFiles } from './core/bgRules.js';
import { untrustedProxy } from './lib/net.js';
import { screenPrivacy } from './privacy.js';
import {
  carouselList, carouselMembers, emptyCarouselScreen, carouselScreenNow, findCarousel, findTarget, isTargetId, targetInfo,
  reachableScreens, readableScreens,
} from './core/carousels.js';

export const KEY_HEADER = 'x-marco-key';
/** Display key: a random UUIDv4 (122 random bits), lower-case. Upper-case input is accepted. */
export const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Paired-device token: md_ + base64url(32 random bytes). */
export const DEVICE_TOKEN_RE = /^md_[A-Za-z0-9_-]{43}$/;
export const MAX_DEVICES = 50;
const LAST_SEEN_FLUSH_MS = 5 * 60_000;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export const displayAccessMode = (cfg = getConfig()) => (cfg?.security?.displayAccess === 'open' ? 'open' : 'private');

function keys() {
  const s = getSecrets();
  if (!s.displayKeys || typeof s.displayKeys !== 'object' || Array.isArray(s.displayKeys)) s.displayKeys = {};
  return s.displayKeys;
}
function devices() {
  const s = getSecrets();
  if (!Array.isArray(s.devices)) s.devices = [];
  return s.devices;
}

const newKey = () => ({ key: crypto.randomUUID(), createdAt: new Date().toISOString() });

/** Ids a link or a device may be bound to: every screen and every carousel. */
const targetIds = (cfg) => new Set([...cfg.screens.map((s) => s.id), ...carouselList(cfg).map((c) => c.id)]);

/**
 * Keep secrets in step with the screens and carousels: each one has a key, keys of deleted ones are dropped (their
 * links stop working) and devices paired with deleted ones are revoked (never moved to another screen: a TV paired
 * with a guest screen must not start showing the family's). Returns true when secrets changed.
 */
export function syncDisplayKeys(cfg = getConfig()) {
  const ids = targetIds(cfg);
  const k = keys();
  let changed = false;
  for (const id of ids) {
    if (!k[id] || typeof k[id].key !== 'string' || !KEY_RE.test(k[id].key)) { k[id] = newKey(); changed = true; }
  }
  for (const id of Object.keys(k)) if (!ids.has(id)) { delete k[id]; changed = true; }
  const gone = devices().filter((d) => !ids.has(d.screenId));
  if (gone.length) {
    getSecrets().devices = devices().filter((d) => ids.has(d.screenId));
    changed = true;
    for (const d of gone) logActivity('display.device_revoked', { actor: 'system', level: 'warn', data: { id: d.id, name: d.name, reason: 'screen_deleted' } });
  }
  if (changed) flushSecrets();
  if (gone.length) {
    const ids2 = new Set(gone.map((d) => d.id));
    kickClients((c) => ids2.has(c.access?.deviceId), 'invalid_key');
  }
  return changed;
}

/** The private-link key of a screen or carousel (created on demand). */
export function displayKeyFor(screenId) {
  const cfg = getConfig();
  if (!isTargetId(cfg, screenId)) return null;
  if (!keys()[screenId]) syncDisplayKeys(cfg);
  return keys()[screenId]?.key || null;
}

/** DisplayLink[] for the admin: one private link per saved screen, then one per carousel (`screenId` = its id). */
export function listDisplayLinks() {
  const cfg = getConfig();
  syncDisplayKeys(cfg);
  const k = keys();
  const row = (x, kind) => ({ screenId: x.id, kind, slug: x.slug, name: x.name, key: k[x.id].key, path: `/d/${k[x.id].key}`, createdAt: k[x.id].createdAt });
  return [...cfg.screens.map((s) => row(s, 'screen')), ...carouselList(cfg).map((c) => row(c, 'carousel'))];
}

/** Screen id for a presented key, or null. Constant-time over every stored key. */
export function screenForKey(key) {
  const given = typeof key === 'string' ? key.trim().toLowerCase() : '';
  if (!KEY_RE.test(given)) return null;
  const h = sha(given);
  let hit = null;
  for (const [screenId, v] of Object.entries(keys())) {
    if (typeof v?.key === 'string' && crypto.timingSafeEqual(sha(v.key), h)) hit = screenId;
  }
  return hit;
}

/** Stored device for a presented device token, or null. Constant-time over every stored hash. */
export function deviceForToken(token) {
  if (typeof token !== 'string' || !DEVICE_TOKEN_RE.test(token)) return null;
  const h = sha(token);
  let hit = null;
  for (const d of devices()) {
    const stored = /^[a-f0-9]{64}$/.test(d.hash || '') ? Buffer.from(d.hash, 'hex') : null;
    if (stored && crypto.timingSafeEqual(stored, h)) hit = d;
  }
  return hit;
}

/** The credential a request carries: X-Marco-Key header, or ?k= when `allowQuery` (SSE, media). */
export function credentialOf(req, { allowQuery = false } = {}) {
  const h = req.get?.(KEY_HEADER) ?? req.headers?.[KEY_HEADER];
  if (typeof h === 'string' && h.trim()) return h.trim();
  if (allowQuery && typeof req.query?.k === 'string' && req.query.k.trim()) return req.query.k.trim();
  return '';
}

/**
 * Who is this display? Returns
 *   { ok: true, via: 'key', screenId } | { ok: true, via: 'device', screenId, device }
 *   { ok: true, via: 'session' } | { ok: true, via: 'open' }
 *   { ok: false, status: 401, code: 'key_required' } | { ok: false, status: 403, code: 'invalid_key' }
 * A presented credential is always checked first: a wrong/revoked one is refused even in open mode or with a
 * session, so a display opened with a revoked link shows "link no longer valid" instead of silently falling back.
 */
export function resolveDisplayAccess(req, { allowQuery = false } = {}) {
  const cred = credentialOf(req, { allowQuery });
  if (cred) {
    if (cred.startsWith('md_')) {
      const d = deviceForToken(cred);
      if (d) {
        touchDevice(d, req);
        return { ok: true, via: 'device', screenId: d.screenId, device: d, credHash: d.hash };
      }
    } else {
      const screenId = screenForKey(cred);
      if (screenId) return { ok: true, via: 'key', screenId, credHash: sha(cred.trim().toLowerCase()).toString('hex') };
    }
    return { ok: false, status: 403, code: 'invalid_key' };
  }
  if (sessionValid(req)) return { ok: true, via: 'session' };
  if (displayAccessMode() === 'open') return { ok: true, via: 'open' };
  return { ok: false, status: 401, code: 'key_required' };
}

const ERRORS = {
  key_required: 'display key required: open this screen\'s private link (/d/<key>) or pair it from the admin',
  invalid_key: 'this display link or device is no longer valid',
};

/**
 * The screen a display request is for: the one bound to its key / device token, else ?screen= (admin session,
 * open mode). Same shape as resolveScreen() plus `carousel` (the carousel the display runs, or null):
 *   - bound to a screen: that screen, or ?screen= when the screen's "Ir a pantalla" cards lead there
 *     (core/carousels.js reachableScreens); any other ?screen= is ignored
 *   - bound to a carousel: ?screen= when it is one of the carousel's screens (or one their "Ir a pantalla" cards lead
 *     to), else the screen it shows now; never any other screen
 *   - not bound, ?screen=<carousel>: the screen it shows now; ?screen=<screen>&via=<carousel>: that screen, with
 *     the carousel when the screen belongs to it
 *   - a carousel with no screens left: a blank screen (core/carousels.js emptyCarouselScreen), `empty: true`
 * An unknown ?screen= never reaches here over HTTP, nor (open mode) a request with no screen from another machine:
 * displayAuth answers 404 screen_not_found first.
 * @returns {{ screen: object, fallback: boolean, carousel: object | null, empty?: boolean }}
 */
export function requestScreen(cfg, req) {
  const q = req.query || {};
  const id = req.displayAccess?.screenId;
  if (id) {
    const bound = cfg.screens.find((s) => s.id === id);
    if (bound) {
      // a screen its "Ir a pantalla" cards lead to (core/carousels.js reachableScreens), else the bound one
      const hit = findTarget(cfg, q.screen);
      if (hit?.kind === 'screen' && hit.id !== bound.id && reachableScreens(cfg, [bound.id]).includes(hit.id)) return { screen: hit.screen, fallback: false, carousel: null };
      return { screen: bound, fallback: false, carousel: null };
    }
    const c = carouselList(cfg).find((x) => x.id === id);
    if (c) return carouselRequest(cfg, c, q.screen);
  }
  const t = findTarget(cfg, q.screen);
  if (t?.kind === 'carousel') return carouselRequest(cfg, t.carousel, '');
  if (t?.kind === 'screen') {
    const via = findCarousel(cfg, q.via);
    return { screen: t.screen, fallback: false, carousel: via && reachableScreens(cfg, carouselMembers(cfg, via)).includes(t.id) ? via : null };
  }
  return { ...resolveScreen(cfg, q.screen), carousel: null };
}

/**
 * A request for carousel `c`: the member `key` names, else the screen the carousel shows now. A carousel with no
 * screens left answers with a blank screen under its own id (`empty: true`), never with the default screen.
 */
function carouselRequest(cfg, c, key) {
  const members = carouselMembers(cfg, c);
  if (!members.length) return { screen: emptyCarouselScreen(cfg, c), fallback: false, carousel: c, empty: true };
  const hit = findTarget(cfg, key);
  const id = hit?.kind === 'screen' && reachableScreens(cfg, members).includes(hit.id) ? hit.id : carouselScreenNow(cfg, c);
  return { screen: cfg.screens.find((s) => s.id === id) || cfg.screens.find((s) => s.id === members[0]), fallback: false, carousel: c };
}

/**
 * True when the request asks for a screen or carousel that does not exist: ?screen= is given (not empty) and names
 * nothing, and no credential binds the request to a saved screen or carousel (a binding always wins over ?screen=).
 * Such a request gets 404 screen_not_found, never the default screen's data. No ?screen= (or an empty one): see
 * bareScreenRequest.
 */
export function unknownScreenRequest(cfg, req) {
  if (boundToTarget(cfg, req)) return false;
  const v = req.query?.screen;
  if (v === undefined) return false;
  if (typeof v !== 'string') return true; // ?screen=a&screen=b names no single screen
  return Boolean(v.trim()) && !findTarget(cfg, v);
}

const boundToTarget = (cfg, req) => {
  const id = req.displayAccess?.screenId;
  return Boolean(id && isTargetId(cfg, id));
};

/**
 * Is the client this machine itself (127.0.0.0/8, ::1)? `req.ip` after `trust proxy`: a reverse proxy on this
 * machine passes the real client in X-Forwarded-For (trusted by default), and a proxy that is not trusted
 * (forwarding headers from an address outside TRUST_PROXY) never counts as local.
 */
export function isLoopbackClient(req) {
  const ip = String(req.ip || '').replace(/^::ffff:/i, '');
  if (ip !== '::1' && !/^127\./.test(ip)) return false;
  return !untrustedProxy(req);
}

/**
 * True when an open-mode request names no screen at all (the bare address, "/" or "/?screen=") and nothing else
 * decides one: no credential bound to a saved screen or carousel, and the client is not this machine. Such a
 * request gets 404 screen_not_found like an unknown slug, so the bare address shows nothing on the network. An
 * all-in-one kiosk (browser on the server itself, http://localhost:PORT/) still gets the default screen. Private
 * mode is left as it was: there every request already carries a key, a device token or an admin session.
 */
export function bareScreenRequest(cfg, req, key = req.query?.screen) {
  if (displayAccessMode(cfg) === 'private') return false;
  if (boundToTarget(cfg, req)) return false;
  if (key !== undefined && (typeof key !== 'string' || key.trim())) return false;
  return !isLoopbackClient(req);
}

/**
 * Display API paths that do not depend on a screen (no ?screen= is ever sent): exempt from bareScreenRequest. The
 * electricity prices are one zone's market prices, the same for every screen (the price widget asks by zone).
 */
const UNSCOPED_PATHS = new Set(['/api/news', '/api/display/heartbeat', '/api/display/prices']);

/** Unknown ?screen=, or no screen at all where one is needed (see unknownScreenRequest, bareScreenRequest). */
function noScreen(req, { bare = true } = {}) {
  const cfg = getConfig();
  if (unknownScreenRequest(cfg, req)) return true;
  return bare && bareScreenRequest(cfg, req);
}

export const SCREEN_NOT_FOUND = { error: 'screen_not_found', code: 'screen_not_found' };

/**
 * Express middleware for the display JSON API: sets req.displayAccess or answers 401/403 (no data), and 404
 * screen_not_found for an unknown ?screen=, or for no screen at all from another machine in open mode
 * (unknownScreenRequest, bareScreenRequest; /api/news and the heartbeat are not about one screen).
 */
export function displayAuth({ allowQuery = false } = {}) {
  return (req, res, next) => {
    const a = resolveDisplayAccess(req, { allowQuery });
    // Keyed responses are per-display data: never stored by shared caches, never cached on disk.
    res.set('cache-control', 'private, no-store');
    if (!a.ok) return res.status(a.status).json({ error: ERRORS[a.code], code: a.code });
    req.displayAccess = a;
    const p = `${req.baseUrl || ''}${req.path || ''}`.replace(/\/+$/, '');
    if (noScreen(req, { bare: !UNSCOPED_PATHS.has(p) })) return res.status(404).json(SCREEN_NOT_FOUND);
    next();
  };
}

/**
 * /media/* (family photos, thumbnails). Private mode: key, device token (?k=) or admin session. Open mode: as
 * before (LAN clients or an admin session; Internet clients get 404) plus valid keys / device tokens.
 */
export function mediaAuth(req, res, next) {
  const a = resolveDisplayAccess(req, { allowQuery: true });
  if (a.ok && (a.via !== 'open' || isLanClient(req))) {
    req.displayAccess = a; // the Immich proxy reads which screen the credential belongs to
    // Media URLs (gallery photos, Immich) never name a screen: only an unknown ?screen= is refused here. The display
    // learns them from /api/photos, which needs a screen.
    if (noScreen(req, { bare: false })) return res.status(404).set('cache-control', 'private, no-store').json(SCREEN_NOT_FOUND);
    return next();
  }
  if (a.ok) return res.status(404).type('text/plain').send('not found');
  res.set('cache-control', 'private, no-store');
  res.status(a.status).type('text/plain').send(ERRORS[a.code]);
}

/**
 * The screens whose photos a display credential may load (gallery files, Immich assets): the screen it is bound to,
 * or the screens of its carousel, with the screens their "Ir a pantalla" cards lead to; in open mode (no credential) the screen it asks for, else every screen. A screen
 * that is private with "hide photos" right now is left out. null = no limit (an admin session).
 */
export function mediaScreens(cfg, access, screenId = '') {
  if (!access || access.via === 'session') return null;
  const id = access.screenId || screenId;
  let list = cfg.screens;
  if (id) {
    const bound = cfg.screens.find((s) => s.id === id);
    const c = bound ? null : carouselList(cfg).find((x) => x.id === id);
    list = bound || c ? readableScreens(cfg, id).map((sid) => cfg.screens.find((s) => s.id === sid)).filter(Boolean) : [];
  }
  return list.filter((sc) => !(sc.privacy?.hidePhotos && screenPrivacy(cfg, sc).active));
}

/** True when one of `screens` (mediaScreens) shows gallery photos (source gallery or mixed). */
export const showsGallery = (screens) => screens === null || screens.some((s) => s.background?.source === 'gallery' || s.background?.source === 'mixed');

/**
 * True when one of `screens` (mediaScreens) may show the gallery file `file`: it shows the gallery, or one of its
 * special background rules (core/bgRules.js) picks that very file. Hidden photos are refused by the caller.
 */
export const galleryFileAllowed = (screens, file) => showsGallery(screens) || screens.some((s) => ruleGalleryFiles(s).has(file));

// ---------------------------------------------------------------------------------------------------------------
// Admin operations

/** Replace a screen's or carousel's key (the old private link stops working at once). Returns the new key or null. */
export function regenerateKey(screenId, { req } = {}) {
  const cfg = getConfig();
  const screen = targetInfo(cfg, screenId);
  if (!screen) return null;
  const k = newKey();
  updateSecrets((s) => {
    if (!s.displayKeys || typeof s.displayKeys !== 'object') s.displayKeys = {};
    s.displayKeys[screenId] = k;
  });
  const n = kickClients((c) => c.access?.via === 'key' && c.access.screenId === screenId, 'invalid_key');
  logActivity('display.link_regenerated', { req, level: 'warn', data: { screen: screen.slug, disconnected: n } });
  return k.key;
}

const deviceInfo = (d, cfg = getConfig()) => {
  const s = targetInfo(cfg, d.screenId);
  const live = [...listClients(), ...listPollers()].filter((c) => c.access?.deviceId === d.id && !c.preview);
  return {
    id: d.id, name: d.name, prefix: d.prefix, screenId: d.screenId, screenKind: s?.kind || 'screen', screenSlug: s?.slug || '', screenName: s?.name || '',
    createdAt: d.createdAt, lastSeenAt: d.lastSeenAt ?? null, lastIp: d.lastIp ?? null, userAgent: d.userAgent ?? '',
    connected: live.length > 0, clientIds: [...new Set(live.filter((c) => !c.anonymous).map((c) => c.clientId))],
  };
};

/** Name of a paired device (null when revoked). */
export const deviceName = (id) => devices().find((d) => d.id === id)?.name ?? null;

/** PairedDevice[] (no hashes), newest first. */
export function listDevices() {
  const cfg = getConfig();
  return devices().map((d) => deviceInfo(d, cfg)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const cleanName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '');

/** Create a paired device bound to `screenId` (a screen or a carousel). Returns { token, device } or { error, status }. */
export function createDevice({ name, screenId, ip, userAgent }, { req } = {}) {
  const cfg = getConfig();
  const screen = targetInfo(cfg, screenId);
  if (!screen) return { error: 'unknown screen', status: 400 };
  if (devices().length >= MAX_DEVICES) return { error: `max ${MAX_DEVICES} paired devices: revoke one first`, status: 409 };
  const token = `md_${crypto.randomBytes(32).toString('base64url')}`;
  const d = {
    id: `dv_${crypto.randomBytes(6).toString('hex')}`,
    name: cleanName(name) || screen.name,
    screenId,
    hash: sha(token).toString('hex'),
    prefix: token.slice(0, 7),
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
    lastIp: ip ? String(ip).slice(0, 64) : null,
    userAgent: String(userAgent || '').slice(0, 300),
  };
  updateSecrets((s) => {
    if (!Array.isArray(s.devices)) s.devices = [];
    s.devices.push(d);
  });
  logActivity('display.paired', { req, level: 'warn', data: { id: d.id, name: d.name, screen: screen.slug } });
  return { token, device: deviceInfo(d, cfg) };
}

/** Rename / move a device. Returns the device info or { error, status }. */
export function updateDevice(id, body, { req } = {}) {
  const d = devices().find((x) => x.id === id);
  if (!d) return { error: 'not found', status: 404 };
  const patch = {};
  if (body?.name !== undefined) {
    const n = cleanName(body.name);
    if (!n) return { error: 'name must be 1-60 characters', status: 400 };
    patch.name = n;
  }
  if (body?.screenId !== undefined) {
    if (!isTargetId(getConfig(), body.screenId)) return { error: 'unknown screen', status: 400 };
    patch.screenId = body.screenId;
  }
  const before = { name: d.name, screenId: d.screenId };
  updateSecrets(() => Object.assign(d, patch));
  if (patch.screenId && patch.screenId !== before.screenId) {
    // A stream is bound to the screen it opened with: close this device's streams ('reload' first) so they
    // reconnect with the new binding: a client that ignores 'reload' must not keep the old screen's events.
    for (const c of listClients()) if (c.access?.deviceId === d.id) dropClient(c, { event: 'reload', data: {} });
  }
  logActivity('display.device_updated', { req, data: { id: d.id, name: d.name, ...(patch.name && patch.name !== before.name ? { from: before.name } : {}) } });
  return { device: deviceInfo(d) };
}

/** Revoke a device (its token stops working; connected streams switch to the "no longer valid" screen). */
export function revokeDevice(id, { req } = {}) {
  const d = devices().find((x) => x.id === id);
  if (!d) return false;
  updateSecrets((s) => { s.devices = s.devices.filter((x) => x.id !== id); });
  const n = kickClients((c) => c.access?.deviceId === id, 'invalid_key');
  logActivity('display.device_revoked', { req, level: 'warn', data: { id: d.id, name: d.name, disconnected: n } });
  return true;
}

/**
 * Send `revoked` to matching SSE clients and close their streams. Matching pollers stop counting as connected (their
 * next poll gets 401 / 403). Returns how many streams were closed.
 */
export function kickClients(filter, code) {
  dropPollers(filter);
  let n = 0;
  for (const c of listClients()) {
    if (!filter(c)) continue;
    // Removed from the registry before ending, so a broadcast in the same tick never writes to an ended stream.
    dropClient(c, { event: 'revoked', data: { code } });
    n++;
  }
  return n;
}

const sameHash = (hex, buf) => /^[a-f0-9]{64}$/.test(hex || '') && crypto.timingSafeEqual(Buffer.from(hex, 'hex'), buf);

/**
 * Re-check the credential of every open stream against the current config + secrets, and close the ones that no
 * longer resolve to the same screen. Called after config saves, imports, session revocation and every heartbeat,
 * so no path that changes keys, devices, sessions or the access mode can leave a stream reading:
 *   key:     the screen's current key must still be the one the stream opened with ('invalid_key')
 *   device:  the device must still exist ('invalid_key'); moved to another screen → 'reload' + close
 *   session: the admin session must still be valid (epoch, login method) ('key_required')
 *   open:    only while display access is 'open' ('key_required')
 *   no screen asked for (open mode, not from this machine, not bound): 'reload' (see bareScreenRequest)
 * Returns how many streams were closed.
 */
export function revalidateStreams(cfg = getConfig()) {
  const ids = targetIds(cfg);
  const k = keys();
  const devs = new Map(devices().map((d) => [d.id, d]));
  const mode = displayAccessMode(cfg);
  /** null (still valid), 'reload' (device moved to another screen) or the `revoked` code. */
  const check = (a, since, screenKey) => {
    if (a.via === 'key') {
      const cur = k[a.screenId]?.key;
      if (!ids.has(a.screenId) || typeof cur !== 'string' || !sameHash(a.credHash, sha(cur))) return 'invalid_key';
    } else if (a.via === 'device') {
      const d = devs.get(a.deviceId);
      if (!d || !sameHash(a.credHash, Buffer.from(String(d.hash || ''), 'hex'))) return 'invalid_key';
      if (d.screenId !== a.screenId) return 'reload';
    } else if (a.via === 'session') {
      let ok = false;
      // The cookie expires after SESSION_MAX_AGE: a stream opened with it does not outlive it either.
      try { ok = Boolean(a.authReq) && sessionValid(a.authReq) && Date.now() - since < SESSION_MAX_AGE; } catch { ok = false; }
      if (!ok) return 'key_required';
    } else if (a.via === 'open') {
      if (mode !== 'open') return 'key_required';
    }
    // Open mode, no screen asked for, from another machine (an admin session opened while private): the default
    // screen is only for this machine, so the display reloads into "Screen not found".
    if (mode === 'open' && !a.screenId && !a.local && !screenKey) return 'reload';
    return null;
  };
  let n = 0;
  for (const c of listClients()) {
    if (!c.access) continue;
    const code = check(c.access, c.since, c.screenKey);
    if (code === 'reload') { dropClient(c, { event: 'reload', data: {} }); n++; }
    else if (code) { dropClient(c, { event: 'revoked', data: { code } }); n++; }
  }
  // Pollers re-check on every poll; a moved device finds its new screen there. The others stop counting as connected.
  dropPollers((p) => {
    if (!p.access) return false;
    const code = check(p.access, p.at);
    return code !== null && code !== 'reload';
  });
  return n;
}

// Logging out everywhere / changing the password closes admin-session streams at once; a plain logout closes the
// streams opened by that browser login.
authEvents.on('revoked', () => { try { revalidateStreams(); } catch (err) { console.warn('[displays] revalidate:', err.message); } });
authEvents.on('logout', (sid) => {
  kickClients((c) => c.access?.via === 'session' && c.access.sid && c.access.sid === sid, 'key_required');
});

/**
 * Config saved: keep keys in step with the screens, then re-check every stream: switching to private disconnects
 * the displays that were reading without a key (they show the pairing screen); deleted screens drop their links'
 * streams; a disabled login method closes its admin-session streams.
 */
export function onDisplayAccessConfig(cfg) {
  try {
    syncDisplayKeys(cfg);
    revalidateStreams(cfg);
  } catch (err) {
    console.warn('[displays] access sync failed:', err.message);
  }
}

// last-seen bookkeeping for devices (memory; secrets.json written at most every 5 minutes per device)
const lastFlush = new Map(); // device id → ms
function touchDevice(d, req) {
  const now = Date.now();
  d.lastSeenAt = new Date(now).toISOString();
  if (req?.ip) d.lastIp = String(req.ip).slice(0, 64);
  const ua = req?.get?.('user-agent');
  if (ua) d.userAgent = String(ua).slice(0, 300);
  if (now - (lastFlush.get(d.id) || 0) > LAST_SEEN_FLUSH_MS) {
    lastFlush.set(d.id, now);
    try { flushSecrets(); } catch { /* ignore */ }
  }
}

/** Tests only. */
export const _resetDisplayAccess = () => lastFlush.clear();
