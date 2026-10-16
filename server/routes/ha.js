// Home Assistant for Personalizado screens (docs/API.md):
//   haDisplayRouter() mounted at /api (displayAuth already ran for /api/display):
//     GET /display/ha                 → HaSnapshot of the requesting screen (aliases only, never entity ids)
//     GET /display/ha/history/:item   → { period, series: [{ label, unit, points }] } for a chart (or a sensor's curve)
//     GET /display/ha/statistic/:item → { stat, period, value, unit } for a Estadística card (recorder statistics)
//     GET /display/ha/art/:item       → the cover art of a media item (image bytes; home network only by default)
//     GET /display/ha/camera/:item    → one picture of a Cámara card (image bytes; home network only by default)
//     GET /display/ha/camera/:item/live → its live picture (multipart/x-mixed-replace, Marco's own boundary)
//     POST /display/ha/action         → a tap on a control (the checks of displayAction(), in order)
//   haAdminRouter() mounted at /api/admin (session):
//     POST /homeassistant/action      → the builder's Probar button (the same allowlist, no touch switch)
//     GET  /homeassistant/status      → the mirror's status
//     POST /homeassistant/slim        → { conn, states: { entity: HaSlim & { at, st } } } for unsaved builder items
//     GET  /homeassistant/history     → ?entity=a,b&period= preview history
//     GET  /homeassistant/statistic   → ?entity=sensor.x&stat=&period= preview of a Estadística card
//     GET  /homeassistant/camera      → ?entity=camera.x one picture for the builder's preview
// Displays never get an entity id, a Home Assistant URL or an entity_picture; private screens get no states.
import { Router } from 'express';
import { requireAuth, foreignOrigin } from '../auth.js';
import { logActivity, logActivityThrottled } from '../activity.js';
import { getConfig, getSecrets } from '../store.js';
import { requestScreen } from '../displayAccess.js';
import { screenPrivacy } from '../privacy.js';
import * as ha from '../homeassistant.js';
import { requestBuffer } from '../lib/http.js';
import { isLanClient } from '../lib/net.js';
import { cameraFrame, watchLive, LIVE_BOUNDARY } from '../haCamera.js';
import { CAMERA_RE } from '../core/doorbellCore.js';
import { redactSecrets } from '../core/activityCore.js';
import { sniffImage } from '../core/imageInfo.js';
import { CANVAS_ID_RE, CANVAS_KINDS, canvasCards } from '../core/canvasCore.js';
import {
  ENTITY_RE, CHART_PERIODS, CONTROL_TABLE, aliasesFor, aliasControls, aliasFlagged, clampValue, controlsFor, downsample, isGasValve, isHighRisk,
  pickAttrs, periodRange, roundPoints, serviceCall, slim as slimOf, MAX_POINTS,
} from '../core/haCore.js';
import { haConn, haLive, haStatus, mirroredState, screenSnapshot } from '../haLive.js';
import { hasConditions, hiddenItems } from '../canvasConditions.js';
import { STAT_PERIODS, STAT_TYPES } from '../core/canvasCore.js';
import { send } from '../sse.js';

const HISTORY_SHORT_TTL = 2 * 60_000;
const HISTORY_LONG_TTL = 15 * 60_000;
const ART_TTL = 5 * 60_000;
const ART_MAX = 1024 * 1024;
const HISTORY_CACHE_MAX = 64;
/** A failed history or art fetch is answered from memory for this long. */
const FAILURE_TTL = 15_000;

const historyCache = new Map(); // key → { at, ttl, value } | { promise }
const artCache = new Map(); // entity|picture → { at, type, buf }

/** A live picture is opened again by the display after this long (the server ends it). */
export const LIVE_CONN_MS = 10 * 60_000;
/** How often a live picture checks that its card is still on a screen that may show it. */
const LIVE_CHECK_MS = 5000;

/** Live pictures one display credential may hold open at once (a screen shows one; one more for a reconnect). */
export const LIVE_PER_CREDENTIAL = 2;
const liveByCred = new Map(); // credential (or open-mode address) → open live pictures

const actionsByScreen = new Map(); // screen id → ms[]
const actionsByCred = new Map(); // credential hash → ms[]
const SCREEN_RATE = { n: 20, ms: 10_000 };
const CRED_RATE = { n: 5, ms: 1000 };

export function _resetHaRoutes() {
  historyCache.clear();
  statCache.clear();
  artCache.clear();
  artPending.clear();
  restReads.clear();
  actionsByScreen.clear();
  actionsByCred.clear();
  liveByCred.clear();
}

/** A sliding-window limit: true (and counted) when `key` has room in `map`. */
function allow(map, key, { n, ms }, now = Date.now()) {
  const list = (map.get(key) ?? []).filter((t) => now - t < ms);
  if (list.length >= n) {
    map.set(key, list);
    return false;
  }
  list.push(now);
  map.set(key, list);
  if (map.size > 500) for (const [k, v] of map) if (!v.length || now - v[v.length - 1] > ms) map.delete(k);
  return true;
}

const restReads = new Map(); // entity → { at, promise } of the last REST read for a check
const REST_READ_MS = 1000;

/**
 * The live state of an entity for a check: the mirror's, else one REST read, shared by every check of that entity
 * for a second (refused taps are not rate limited, so they must not each cost Home Assistant a request).
 * { slim, attrs } or null.
 */
function liveEntity(entity) {
  const m = haLive()?.get(entity);
  if (m) return Promise.resolve(m);
  const now = Date.now();
  const hit = restReads.get(entity);
  if (hit && now - hit.at < REST_READ_MS) return hit.promise;
  const promise = (async () => {
    try {
      const st = await ha.getState(entity);
      const attrs = pickAttrs(st?.attributes);
      return { slim: slimOf(entity.split('.')[0], st?.state, attrs), attrs };
    } catch (err) {
      if (err?.status === 404) return { slim: { d: 'unavailable' }, attrs: {} };
      return null;
    }
  })();
  restReads.set(entity, { at: now, promise });
  // kept from the moment it ends, so a slow Home Assistant is not asked again while it still answers
  promise.then(() => {
    if (restReads.get(entity)?.promise === promise) restReads.set(entity, { at: Date.now(), promise });
    if (restReads.size > 200) for (const [k, v] of restReads) if (Date.now() - v.at >= REST_READ_MS) restReads.delete(k);
  });
  return promise;
}

/** Call the service of a control on Home Assistant. { ok: true } or { ok: false, error: 'ha_down' | 'ha_error' }. */
async function callService(entity, call) {
  try {
    await ha.haPost(`/api/services/${call.domain}/${call.service}`, { entity_id: entity, ...call.data });
    return { ok: true };
  } catch (err) {
    console.warn('[ha] action:', redactSecrets(err.message));
    return { ok: false, error: err?.status ? 'ha_error' : 'ha_down' };
  }
}

const ERROR_STATUS = {
  json_required: 415, cross_origin: 403, bad_request: 400, not_found: 404, untrusted: 403, private: 403, touch_off: 403,
  not_allowed: 403, out_of_range: 400, rate: 429, confirm_needed: 409, ha_down: 503, ha_error: 502,
};

/**
 * A tap on a Home Assistant control of a Personalizado screen. Every check, in order (docs/API.md):
 *  0. JSON, and a same-origin request when the browser says where it comes from (Sec-Fetch-Site, Origin);
 *  1. the screen of the credential (any screen of its carousel) is a Personalizado one with that item and slot, of
 *     a kind with controls, and no condition hides that item now;
 *  2. a display key or a paired device: never open access (no credential at all) nor an admin session;
 *  3. the screen is not private right now;
 *  4. the screen allows touch, the item (and a room's row) is interactive;
 *  5. the control is one the card offers for this entity now (CONTROL_TABLE, never a lock, an alarm, a garage door,
 *     a gate or a gas valve; an entity that looks like a door, or a water valve, only once the owner ticked it);
 *  6. the value is within range (clamped);
 *  7. at most 20 actions per 10 s per screen and 5 a second per credential; two taps when the item needs them;
 *  8. the service call, without following redirects;
 *  9. an activity entry (throttled), never with the token.
 */
async function displayAction(req) {
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  const seq = Number.isSafeInteger(b?.seq) ? b.seq : null;
  const no = (error) => ({ error, seq });
  if (!String(req.get('content-type') || '').toLowerCase().startsWith('application/json')) return no('json_required');
  if (foreignOrigin(req)) return no('cross_origin');
  if (!b || typeof b.item !== 'string' || !Number.isInteger(b.slot) || typeof b.control !== 'string') return no('bad_request');
  const cfg = getConfig();
  const { screen, empty } = requestScreen(cfg, req);
  const item = !empty && CANVAS_ID_RE.test(b.item) && screen.layout?.preset === 'canvas' ? screen.canvas?.items?.find((x) => x.id === b.item && !x.hidden) : null;
  const a = item && CANVAS_KINDS[item.kind]?.controls ? aliasesFor(screen).get(`${item.id}:${b.slot}`) : null;
  // a card its condition hides now is not on the screen
  if (!a || hiddenItems(cfg, screen).has(item.id)) return no('not_found');
  const via = req.displayAccess?.via;
  if (via !== 'key' && via !== 'device') return no('untrusted');
  if (screenPrivacy(cfg, screen).active) return no('private');
  if (!screen.canvas?.touch) return no('touch_off');
  if (!a.interactive) return no('not_allowed');
  const domain = a.entity.split('.')[0];
  if (!CONTROL_TABLE[b.control] || isHighRisk(domain, {}, a.entity, a.name)) return no('not_allowed');
  if (!ha.haUsable()) return no('ha_down');
  const m = await liveEntity(a.entity);
  if (!m) return no('ha_down');
  const { c, cf } = aliasControls(a, m, true);
  if (!c.includes(b.control)) return no('not_allowed');
  const v = clampValue(b.control, b.value, domain, m.attrs, a.props);
  if (!v) return no('out_of_range');
  if (!allow(actionsByScreen, screen.id, SCREEN_RATE) || !allow(actionsByCred, req.displayAccess.credHash || `${via}:${screen.id}`, CRED_RATE)) return no('rate');
  if (cf && b.confirm !== true) return no('confirm_needed');
  const call = serviceCall(b.control, domain, v.value);
  if (!call) return no('not_allowed');
  const r = await callService(a.entity, call);
  if (!r.ok) return no(r.error);
  const flagged = aliasFlagged(a, m.attrs);
  logActivityThrottled('ha.action', `${screen.id}|${a.entity}|${call.service}`, { everyMs: 60_000, perMinute: 20 }, {
    req, actor: `display:${screen.slug || screen.id}`,
    data: { item: item.id, domain, service: call.service, entity: a.entity, via: 'display', screen: screen.name || screen.slug, ...(flagged ? { flagged: true } : {}) },
  });
  return { ok: true, seq };
}

/** Points per entity for a chart period, cached (2 min up to 24 h, 15 min beyond) and shared by every screen. */
export function chartPoints(entities, period) {
  const key = `${period}|${[...entities].sort().join(',')}`;
  const hit = historyCache.get(key);
  const now = Date.now();
  if (hit?.value && now - hit.at < hit.ttl) return Promise.resolve(hit.value);
  if (hit?.error && now - hit.at < FAILURE_TTL) return Promise.reject(hit.error);
  if (hit?.promise) return hit.promise;
  const { start, end, source } = periodRange(period, now);
  const promise = (async () => {
    let byEntity = new Map();
    if (source === 'statistics') {
      try {
        byEntity = await ha.statistics(entities, start, end);
      } catch { /* no statistics: history below */ }
    }
    const missing = entities.filter((e) => !(byEntity.get(e)?.length > 1));
    if (missing.length) {
      const h = await ha.history(missing, start, end);
      for (const e of missing) byEntity.set(e, h.get(e) ?? []);
    }
    const value = new Map(entities.map((e) => [e, roundPoints(downsample((byEntity.get(e) ?? []).filter(([t]) => t >= start - 3600_000), MAX_POINTS))]));
    historyCache.set(key, { at: Date.now(), ttl: source === 'statistics' || CHART_PERIODS[period] > CHART_PERIODS['24h'] ? HISTORY_LONG_TTL : HISTORY_SHORT_TTL, value });
    while (historyCache.size > HISTORY_CACHE_MAX) historyCache.delete(historyCache.keys().next().value);
    return value;
  })();
  historyCache.set(key, { promise });
  // a failure is kept for a moment too, so screens asking again and again do not each send Home Assistant a history
  // or statistics query
  promise.catch((error) => {
    if (historyCache.get(key)?.promise === promise) historyCache.set(key, { at: Date.now(), error });
  });
  return promise;
}

const artPending = new Map(); // entity|picture → the fetch running now

/**
 * The cover art of a media player: cached 5 min, one fetch at a time per picture shared by every screen that asks,
 * a failure kept for FAILURE_TTL (so many screens, or one display asking in a loop, never fan out to Home Assistant).
 * Resolves { type, buf }; rejects with { code: 'ha_error' | 'not_an_image' }.
 */
function mediaArt(entity, pic) {
  const key = `${entity}|${pic}`;
  const hit = artCache.get(key);
  const now = Date.now();
  if (hit?.buf && now - hit.at <= ART_TTL) return Promise.resolve(hit);
  if (hit?.error && now - hit.at < FAILURE_TTL) return Promise.reject(hit.error);
  if (artPending.has(key)) return artPending.get(key);
  const p = (async () => {
    const s = ha.haSettings();
    let up;
    try {
      // requestBuffer never follows a redirect
      up = await requestBuffer(`${s.url}/api/media_player_proxy/${encodeURIComponent(entity)}`, {
        headers: { authorization: `Bearer ${s.token}` }, maxBytes: ART_MAX, timeout: 8000,
      });
    } catch (err) {
      console.warn('[ha] art:', redactSecrets(err.message));
      throw Object.assign(new Error('ha_error'), { code: 'ha_error' });
    }
    if (up.status !== 200) throw Object.assign(new Error('ha_error'), { code: 'ha_error' });
    const type = sniffImage(up.buffer) || (up.buffer.subarray(0, 4).toString('latin1') === 'GIF8' ? 'image/gif' : '');
    if (!type) throw Object.assign(new Error('not_an_image'), { code: 'not_an_image' });
    return { at: Date.now(), type, buf: up.buffer };
  })();
  artPending.set(key, p);
  p.then((entry) => artCache.set(key, entry), (error) => artCache.set(key, { at: Date.now(), error }))
    .finally(() => {
      artPending.delete(key);
      while (artCache.size > 16) artCache.delete(artCache.keys().next().value);
    });
  return p;
}

/** The friendly name and unit of an entity, from the mirror (no request). */
function describe(entity) {
  const m = haLive()?.get(entity);
  return { name: typeof m?.attrs?.friendly_name === 'string' ? m.attrs.friendly_name : '', unit: typeof m?.attrs?.unit_of_measurement === 'string' ? m.attrs.unit_of_measurement : '' };
}

/** The Personalizado item `id` of the requesting screen, when it may be read now. */
function screenItem(req, res, kinds) {
  const cfg = getConfig();
  const { screen } = requestScreen(cfg, req);
  const id = String(req.params.item || '');
  // a card inside a Rotativa reads its own history, statistic and pictures too
  const item = CANVAS_ID_RE.test(id) && screen.layout?.preset === 'canvas' ? canvasCards(screen.canvas?.items).find((x) => x.id === id && !x.hidden) : null;
  if (!item || !kinds.includes(item.kind)) {
    res.status(404).json({ error: 'not found' });
    return null;
  }
  if (screenPrivacy(cfg, screen).active) {
    res.status(403).json({ error: 'private' });
    return null;
  }
  if (hiddenItems(cfg, screen).has(item.id)) {
    res.status(404).json({ error: 'hidden' });
    return null;
  }
  if (!ha.haUsable()) {
    res.status(503).json({ error: 'ha_off' });
    return null;
  }
  return item;
}

const STAT_TTL = 5 * 60_000;
const statCache = new Map(); // entity|stat|period → { at, value } | { at, error } | { promise }

/**
 * One value of a Estadística card, cached 5 minutes and shared by every screen (a failure is kept FAILURE_TTL), so
 * many screens never fan out to Home Assistant's recorder. Resolves a number or null.
 */
export function statValue(entity, stat, period) {
  const key = `${entity}|${stat}|${period}`;
  const hit = statCache.get(key);
  const now = Date.now();
  if (hit && 'value' in hit && now - hit.at < STAT_TTL) return Promise.resolve(hit.value);
  if (hit?.error && now - hit.at < FAILURE_TTL) return Promise.reject(hit.error);
  if (hit?.promise) return hit.promise;
  const promise = ha.statisticValue(entity, stat, period);
  statCache.set(key, { promise });
  promise.then(
    (value) => statCache.set(key, { at: Date.now(), value }),
    (error) => statCache.set(key, { at: Date.now(), error }),
  ).finally(() => {
    while (statCache.size > HISTORY_CACHE_MAX) statCache.delete(statCache.keys().next().value);
  });
  return promise;
}

/**
 * A stream just opened: the full Home Assistant snapshot of its screen (each screen of its carousel), so a display
 * that reconnects never keeps states it missed.
 */
export function haStreamHello(client) {
  if (!haLive() || client.notFound) return;
  const cfg = getConfig();
  const ids = client.memberIds?.length ? client.memberIds : [client.screenId];
  for (const id of ids) {
    const screen = cfg.screens.find((x) => x.id === id);
    if (screen && (aliasesFor(screen).size || hasConditions(screen))) send(client, 'ha', screenSnapshot(cfg, screen));
  }
}

export function haDisplayRouter() {
  const r = Router();
  r.get('/display/ha', (req, res) => {
    res.set('cache-control', 'no-store');
    const cfg = getConfig();
    const { screen } = requestScreen(cfg, req);
    res.json(screenSnapshot(cfg, screen));
  });

  r.post('/display/ha/action', async (req, res) => {
    res.set('cache-control', 'no-store');
    const out = await displayAction(req);
    if (out.ok) return res.json(out);
    res.status(ERROR_STATUS[out.error] ?? 400).json({ ok: false, error: out.error, code: out.error, seq: out.seq });
  });

  r.get('/display/ha/history/:item', async (req, res) => {
    res.set('cache-control', 'no-store');
    const item = screenItem(req, res, ['ha.chart', 'ha.sensor']);
    if (!item) return;
    const isChart = item.kind === 'ha.chart';
    if (!isChart && !item.props?.sparkline) return res.status(404).json({ error: 'not found' });
    const list = isChart ? (item.props.series ?? []).filter((s) => s.entity) : item.props.entity ? [{ entity: item.props.entity, label: item.props.name || '' }] : [];
    const period = isChart && CHART_PERIODS[item.props.period] ? item.props.period : '24h';
    if (!list.length) return res.json({ period, series: [] });
    try {
      const pts = await chartPoints([...new Set(list.map((s) => s.entity))], period);
      res.json({
        period,
        series: list.map((s) => {
          const d = describe(s.entity);
          return { label: s.label || d.name, unit: d.unit, points: pts.get(s.entity) ?? [] };
        }),
      });
    } catch (err) {
      console.warn('[ha] history:', redactSecrets(err.message));
      res.status(502).json({ error: 'ha_error' });
    }
  });

  // a Estadística card's value: the change, mean, minimum or maximum of its sensor over today, this week or this month
  r.get('/display/ha/statistic/:item', async (req, res) => {
    res.set('cache-control', 'no-store');
    const item = screenItem(req, res, ['ha.statistic']);
    if (!item) return;
    const entity = item.props?.entity;
    const stat = STAT_TYPES.includes(item.props?.stat) ? item.props.stat : 'change';
    const period = STAT_PERIODS.includes(item.props?.period) ? item.props.period : 'today';
    if (!entity || !ENTITY_RE.test(entity)) return res.json({ stat, period, value: null, unit: '' });
    try {
      res.json({ stat, period, value: await statValue(entity, stat, period), unit: describe(entity).unit });
    } catch (err) {
      console.warn('[ha] statistic:', redactSecrets(err.message));
      res.status(502).json({ error: 'ha_error' });
    }
  });

  r.get('/display/ha/art/:item', async (req, res) => {
    // the same home network rule as the camera pictures (what plays in the house is not for outside either)
    if (cameraLanBlocked(req)) return res.status(403).json({ error: 'lan_only' });
    const item = screenItem(req, res, ['ha.media']);
    if (!item) return;
    const entity = item.props?.entity;
    if (!entity || !ENTITY_RE.test(entity) || !entity.startsWith('media_player.')) return res.status(404).json({ error: 'not found' });
    // only a picture Home Assistant serves itself, through its own proxy path built from the entity id: an absolute
    // entity_picture (some integrations point it at a CDN) is never fetched
    let st = mirroredState(entity);
    if (!st) {
      try { st = await ha.getState(entity); } catch { st = null; }
    }
    const pic = st?.attributes?.entity_picture;
    if (typeof pic !== 'string' || !pic.startsWith('/api/media_player_proxy/')) return res.status(404).json({ error: 'no_art' });
    let hit;
    try {
      hit = await mediaArt(entity, pic);
    } catch (err) {
      return res.status(502).json({ error: err.code || 'ha_error' });
    }
    res.set('cache-control', 'private, no-store');
    res.set('content-type', hit.type);
    res.set('x-content-type-options', 'nosniff');
    res.send(hit.buf);
  });

  // a Cámara card's picture: only the camera of that item, through Home Assistant's own proxy path built from the
  // validated entity id; home network only unless the owner turned that off
  r.get('/display/ha/camera/:item', async (req, res) => {
    res.set('cache-control', 'private, no-store, max-age=0');
    if (cameraLanBlocked(req)) return res.status(403).json({ error: 'lan_only' });
    const item = screenItem(req, res, ['ha.camera']);
    if (!item) return;
    const entity = cameraOf(item);
    if (!entity) return res.status(404).json({ error: 'not found' });
    if (gatedOff(item)) return res.status(404).json({ error: 'hidden' });
    try {
      const f = await cameraFrame(entity);
      res.set('content-type', f.type);
      res.set('content-length', String(f.body.length));
      res.set('x-content-type-options', 'nosniff');
      res.end(f.body);
    } catch (err) {
      res.status(err.status || 502).json({ error: err.code || 'camera_unavailable' });
    }
  });

  // the live picture of a Cámara card set to "Directo": one upstream per camera shared by every screen, at most 4
  // cameras and 8 viewers per server, never for the admin's preview, ended after 10 minutes (the display opens it
  // again) or as soon as the card may not show it any more
  r.get('/display/ha/camera/:item/live', (req, res) => {
    res.set('cache-control', 'private, no-store, max-age=0');
    if (cameraLanBlocked(req)) return res.status(403).json({ error: 'lan_only' });
    if (req.displayAccess?.via === 'session') return res.status(403).json({ error: 'preview' });
    const item = screenItem(req, res, ['ha.camera']);
    if (!item) return;
    const entity = cameraOf(item);
    if (!entity || item.props?.mode !== 'live') return res.status(404).json({ error: 'not_live' });
    if (gatedOff(item)) return res.status(404).json({ error: 'hidden' });
    const screenId = requestScreen(getConfig(), req).screen.id;
    // one display (or one leaked link) cannot take every live slot of the house for itself
    const cred = req.displayAccess?.credHash || `${req.displayAccess?.via}:${req.ip}`;
    if ((liveByCred.get(cred) ?? 0) >= LIVE_PER_CREDENTIAL) return res.status(503).json({ error: 'busy' });
    let ended = false;
    let w = null;
    let counted = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(maxTimer);
      clearInterval(checkTimer);
      w?.leave();
      if (counted) {
        counted = false;
        const n = (liveByCred.get(cred) ?? 1) - 1;
        if (n > 0) liveByCred.set(cred, n);
        else liveByCred.delete(cred);
      }
      if (!res.writableEnded) res.end();
    };
    const sink = {
      frame(bytes) {
        // a viewer that cannot keep up skips pictures instead of piling them up in memory
        if (ended || res.writableNeedDrain) return;
        res.write(bytes);
      },
      end,
    };
    w = watchLive(entity, sink);
    if (!w.ok) {
      ended = true;
      return res.status(503).json({ error: w.error });
    }
    liveByCred.set(cred, (liveByCred.get(cred) ?? 0) + 1);
    counted = true;
    res.status(200);
    res.set('content-type', `multipart/x-mixed-replace; boundary=${LIVE_BOUNDARY}`);
    res.set('x-content-type-options', 'nosniff');
    res.set('x-accel-buffering', 'no');
    res.flushHeaders();
    const maxTimer = setTimeout(end, LIVE_CONN_MS);
    const checkTimer = setInterval(() => {
      if (!liveStillAllowed(screenId, item.id, entity)) end();
    }, LIVE_CHECK_MS);
    res.on('close', end);
  });
  return r;
}

/** The owner keeps Cámara cards to the home network (the default) and this request does not come from it. */
function cameraLanBlocked(req) {
  if (getConfig().homeassistant?.cameraLanOnly === false) return false;
  return !isLanClient(req, { strict: true });
}

/** The camera entity of a Cámara item, when it is one. */
function cameraOf(item) {
  const e = item?.props?.entity;
  return typeof e === 'string' && CAMERA_RE.test(e) ? e : '';
}

/**
 * The card is shown only while a binary sensor is on (showWhen) and that sensor is not on now: off, unavailable or
 * not known yet (the screen hides the card then too, so no picture is served for it).
 */
function gatedOff(item) {
  const sw = item?.props?.showWhen;
  if (typeof sw !== 'string' || !sw) return false;
  const st = mirroredState(sw);
  return !st || st.state !== 'on';
}

/** A live picture may go on: the item is still a live camera of that screen, not private, Home Assistant set up. */
function liveStillAllowed(screenId, itemId, entity) {
  const cfg = getConfig();
  const screen = cfg.screens.find((x) => x.id === screenId);
  if (!screen || screen.layout?.preset !== 'canvas' || !ha.haUsable()) return false;
  const it = screen.canvas?.items?.find((x) => x.id === itemId && !x.hidden);
  if (!it || it.kind !== 'ha.camera' || it.props?.mode !== 'live' || it.props?.entity !== entity) return false;
  if (gatedOff(it) || hiddenItems(cfg, screen).has(it.id)) return false;
  return !screenPrivacy(cfg, screen).active;
}

/** A slim state for the builder: `st` the raw state (the "Mostrar solo si" badge), a gas valve by its id read-only. */
function builderSlim(e, m) {
  const out = { ...m.slim, at: m.at, st: m.state.slice(0, 60) };
  if (out.d === 'valve' && isGasValve('valve', m.attrs, e)) out.readOnly = true;
  return out;
}

const entityList = (v, max) => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out = [...new Set(raw.filter((x) => typeof x === 'string').map((x) => x.trim()).filter((x) => ENTITY_RE.test(x)))];
  return out.length <= max ? out : null;
};

export function haAdminRouter() {
  const r = Router();
  r.use('/homeassistant', requireAuth);
  r.get('/homeassistant/status', (req, res) => {
    res.set('cache-control', 'no-store');
    // whether a token is saved, and for another address than the saved one (never the token or any part of it)
    const tokenSaved = !!getSecrets().homeassistant?.token;
    res.json({ ...haStatus(), tokenSaved, tokenForOtherUrl: tokenSaved && ha.tokenForOtherUrl() });
  });

  // the builder's preview of items not saved yet: their entities' slim states, from the mirror or over REST
  r.post('/homeassistant/slim', async (req, res) => {
    const list = entityList(req.body?.entities, 40);
    if (!list) return res.status(400).json({ error: 'entities: up to 40 entity ids' });
    if (!ha.haUsable()) return res.json({ conn: 'down', states: {} });
    const states = {};
    const live = haLive();
    const todo = [];
    for (const e of list) {
      const m = live?.get(e);
      // `st`: the raw state, for the builder's "Mostrar solo si" badge (the admin only)
      if (m) states[e] = builderSlim(e, m);
      else todo.push(e);
    }
    let failed = 0;
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(todo.slice(i, i + 4).map(async (e) => {
        try {
          const m = await ha.fetchSlimState(e);
          states[e] = builderSlim(e, m);
        } catch (err) {
          if (err?.status === 404) states[e] = { d: 'unavailable', at: 0 };
          else failed++;
        }
      }));
    }
    res.set('cache-control', 'no-store');
    res.json({ conn: failed && failed === todo.length && !Object.keys(states).length ? 'down' : live ? haConn() : 'ok', states });
  });

  // the builder's Probar button: the same allowlist and clamping as a screen, for an entity of an item that may not
  // be saved yet (the screen's touch switch does not apply: the owner is the one pressing)
  r.post('/homeassistant/action', async (req, res) => {
    res.set('cache-control', 'no-store');
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const fail = (error, status = ERROR_STATUS[error] ?? 400) => res.status(status).json({ ok: false, error });
    const k = CANVAS_KINDS[b.kind];
    const entity = typeof b.entity === 'string' ? b.entity : '';
    const domain = entity.split('.')[0];
    if (!k?.controls || !ENTITY_RE.test(entity) || !k.ha?.domains.includes(domain) || typeof b.control !== 'string') return fail('bad_request');
    if (!CONTROL_TABLE[b.control] || isHighRisk(domain, {})) return fail('not_allowed');
    if (!ha.haUsable()) return fail('ha_down');
    const m = await liveEntity(entity);
    if (!m) return fail('ha_down');
    const props = b.props && typeof b.props === 'object' && !Array.isArray(b.props) ? b.props : {};
    if (m.slim.d === 'unavailable' || isHighRisk(domain, m.attrs, entity, typeof b.name === 'string' ? b.name : '') || !controlsFor(b.kind, domain, m.attrs, props).includes(b.control)) return fail('not_allowed');
    const v = clampValue(b.control, b.value, domain, m.attrs, props);
    if (!v) return fail('out_of_range');
    if (!allow(actionsByCred, 'admin', { n: 10, ms: 10_000 })) return fail('rate');
    const call = serviceCall(b.control, domain, v.value);
    const r = call ? await callService(entity, call) : { ok: false, error: 'not_allowed' };
    if (!r.ok) return fail(r.error);
    logActivity('ha.action', { req, data: { domain, service: call.service, entity, via: 'admin' } });
    res.json({ ok: true });
  });

  // one picture of a camera for the builder's preview (the preview never opens a live picture)
  r.get('/homeassistant/camera', async (req, res) => {
    res.set('cache-control', 'private, no-store, max-age=0');
    const entity = typeof req.query.entity === 'string' ? req.query.entity.trim() : '';
    if (!CAMERA_RE.test(entity)) return res.status(400).json({ error: 'entity: a camera entity id' });
    try {
      const f = await cameraFrame(entity);
      res.set('content-type', f.type);
      res.set('content-length', String(f.body.length));
      res.set('x-content-type-options', 'nosniff');
      res.end(f.body);
    } catch (err) {
      res.status(err.status || 502).json({ error: err.code || 'camera_unavailable' });
    }
  });

  // the builder's preview of a Estadística card (the same cache as the screens)
  r.get('/homeassistant/statistic', async (req, res) => {
    res.set('cache-control', 'no-store');
    const entity = typeof req.query.entity === 'string' ? req.query.entity.trim() : '';
    const stat = STAT_TYPES.includes(req.query.stat) ? String(req.query.stat) : 'change';
    const period = STAT_PERIODS.includes(req.query.period) ? String(req.query.period) : 'today';
    if (!ENTITY_RE.test(entity) || !entity.startsWith('sensor.')) return res.status(400).json({ error: 'entity: a sensor entity id' });
    if (!ha.haUsable()) return res.status(503).json({ error: 'ha_off' });
    try {
      res.json({ stat, period, value: await statValue(entity, stat, period), unit: describe(entity).unit });
    } catch (err) {
      res.status(502).json({ error: String(redactSecrets(err.message)).slice(0, 200) });
    }
  });

  r.get('/homeassistant/history', async (req, res) => {
    res.set('cache-control', 'no-store');
    const list = entityList(req.query.entity, 4);
    const period = CHART_PERIODS[req.query.period] ? String(req.query.period) : '24h';
    if (!list?.length) return res.status(400).json({ error: 'entity: 1 to 4 entity ids' });
    if (!ha.haUsable()) return res.status(503).json({ error: 'ha_off' });
    try {
      const pts = await chartPoints(list, period);
      res.json({ period, series: list.map((e) => ({ entity: e, label: describe(e).name, unit: describe(e).unit, points: pts.get(e) ?? [] })) });
    } catch (err) {
      res.status(502).json({ error: String(redactSecrets(err.message)).slice(0, 200) });
    }
  });
  return r;
}
