// Mealie (self-hosted recipes and meal planner) as the source of the week's meals (#50). Only this server talks to
// Mealie: the API token (secrets.json `mealie: { token, url }`) travels in the Authorization header, only to the
// address it was saved for, and never reaches a display, a URL, the admin or a log. Displays get the meals inside
// their family data (familyCore.js mealsForDate with the overlay from here) and the dinner's photo through
// GET /media/mealie/<recipeId> (mealieMedia below), served only for recipes in the cached plan.
//
// The plan of a window around today (6 days back, 13 ahead: this week and the next for any week start) is read at
// most every 15 minutes and kept in memory; a failed read keeps the last good meals and is retried after a minute.
// When the meals change, displays are told to fetch their family data again (`family` live event).
import { requestBuffer } from './lib/http.js';
import { events, getConfig, getSecrets } from './store.js';
import { publish } from './pollHub.js';
import { mediaScreens } from './displayAccess.js';
import { addDays, zonedParts } from './core/lib/tz.js';
import {
  MEALIE_ID_RE, MEALPLAN_PATH, mealieOverlay, mealieTokenStatus, mealieUrlOk, normalizeMealieUrl, overlayMealCount,
  overlayPhotoIds, parseMealieVersion,
} from './core/mealieCore.js';

export const TTL = 15 * 60_000;
export const FAIL_TTL = 60_000;
export const TIMEOUT = 10_000;
export const PER_PAGE = 100;
/** Pages of the plan read at most (500 entries for three weeks is far more than a household plans). */
export const MAX_PAGES = 5;
const PLAN_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_CACHE_MAX = 40;
const IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/avif']);

export class MealieError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const pad = (n) => String(n).padStart(2, '0');

/** Today (YYYY-MM-DD) in the configured zone. */
function todayOf(cfg = getConfig(), now = new Date()) {
  const p = zonedParts(now, cfg.datetime.timezone);
  return `${String(p.y).padStart(4, '0')}-${pad(p.m)}-${pad(p.d)}`;
}

/** Dates read from Mealie: from the earliest week start before today to the end of next week. */
export function planWindow(cfg = getConfig(), now = new Date()) {
  const today = todayOf(cfg, now);
  return { from: addDays(today, -6), to: addDays(today, 13), today };
}

/**
 * Saved settings, optionally with unsaved values from the admin (test button). The saved token is only used for the
 * address it was saved with: an unsaved or changed URL gets no token unless one is typed with it.
 */
export function mealieSettings(override = {}) {
  const cfg = getConfig();
  const url = normalizeMealieUrl(override.url ?? cfg?.family?.meals?.mealie?.url ?? '');
  const sec = getSecrets()?.mealie || {};
  const saved = typeof sec.token === 'string' ? sec.token : '';
  const token = override.token || (saved && normalizeMealieUrl(sec.url) === url ? saved : '');
  return { url, token };
}

/** Familia and its menus on, with a valid URL and a token for it. */
export function mealieUsable(s = mealieSettings(), cfg = getConfig()) {
  return Boolean(cfg?.family?.enabled && cfg.family.meals?.enabled && s.url && mealieUrlOk(s.url) && s.token);
}

/** GET /api/admin/mealie/token: { set, hint, otherUrl }. */
export function tokenStatus() {
  const sec = getSecrets()?.mealie || {};
  const st = mealieTokenStatus(sec.token);
  const url = normalizeMealieUrl(getConfig()?.family?.meals?.mealie?.url);
  return { ...st, otherUrl: Boolean(st.set && url && normalizeMealieUrl(sec.url) !== url) };
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP

async function call(s, p, { accept = 'application/json', maxBytes = PLAN_MAX_BYTES, auth = true } = {}) {
  if (!s.url || !mealieUrlOk(s.url)) throw new MealieError('not_configured');
  const headers = { accept, ...(auth && s.token ? { authorization: `Bearer ${s.token}` } : {}) };
  let res;
  try {
    // node:http, no redirects followed: a redirect would carry the token to another address
    res = await requestBuffer(`${s.url}${p}`, { headers, maxBytes, timeout: TIMEOUT });
  } catch (err) {
    throw new MealieError(/too large/i.test(err.message) ? 'too_large' : 'unreachable');
  }
  if (res.status >= 300 && res.status < 400) throw new MealieError('redirect', res.status);
  if (res.status === 401 || res.status === 403) throw new MealieError('invalid_token', res.status);
  if (res.status === 404) throw new MealieError('not_found', res.status);
  if (res.status < 200 || res.status >= 300) throw new MealieError('unreachable', res.status);
  return res;
}

async function callJson(s, p, opts) {
  const res = await call(s, p, opts);
  try {
    return JSON.parse(res.buffer.toString('utf8'));
  } catch {
    throw new MealieError('bad_response');
  }
}

/** Meal plan entries from `from` to `to` (YYYY-MM-DD), every page up to MAX_PAGES. */
export async function fetchPlan(s, from, to) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let j;
    try {
      j = await callJson(s, `${MEALPLAN_PATH}?start_date=${from}&end_date=${to}&perPage=${PER_PAGE}&page=${page}`);
    } catch (err) {
      // Mealie 1.x has the plan under /api/groups
      if (err.code === 'not_found') throw new MealieError('old_version', 404);
      throw err;
    }
    if (!Array.isArray(j?.items)) throw new MealieError('bad_response');
    items.push(...j.items);
    const pages = Number(j.total_pages);
    if (!Number.isInteger(pages) || page >= pages) break;
    if (page === MAX_PAGES) console.warn(`[mealie] the meal plan has ${pages} pages; only the first ${MAX_PAGES} are read`);
  }
  return items;
}

/**
 * Admin test: Mealie's version (no token needed), then the token, then the meals of the next two weeks.
 * Returns { ok, version?, count?, error? }; `error` is a code, never Mealie's text.
 */
export async function testMealie(override = {}) {
  const s = mealieSettings(override);
  if (!s.url) return { ok: false, error: 'not_configured' };
  if (!mealieUrlOk(s.url)) return { ok: false, error: 'invalid_url' };
  let version = '';
  try {
    const about = await callJson(s, '/api/app/about', { auth: false });
    const v = parseMealieVersion(about?.version);
    if (!v) throw new MealieError('bad_response');
    version = v.text;
    if (v.major < 2) return { ok: false, version, error: 'old_version' };
    if (!s.token) return { ok: false, version, error: 'token_missing' };
    await callJson(s, '/api/users/self');
    const today = todayOf();
    const to = addDays(today, 13);
    const { overlay } = mealieOverlay(await fetchPlan(s, today, to), { from: today, to });
    return { ok: true, version, count: overlayMealCount(overlay) };
  } catch (err) {
    const code = err instanceof MealieError ? (err.code === 'not_found' ? 'bad_response' : err.code) : 'unreachable';
    return { ok: false, ...(version ? { version } : {}), error: code };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The plan in memory

const cache = { overlay: null, count: null, from: null, to: null, at: 0, error: null, errorAt: 0, inflight: null, gen: 0, sig: '' };

/** Read the plan again now (one read at a time). Resolves when it is done; never rejects. */
export function refreshMealie() {
  if (cache.inflight) return cache.inflight;
  const cfg = getConfig();
  const s = mealieSettings();
  if (!mealieUsable(s, cfg)) return Promise.resolve();
  const gen = cache.gen;
  const w = planWindow(cfg);
  // one catch for the read and the mapping: an answer Mealie should never send still counts as a failed read (the
  // one-minute pause applies and the promise never rejects)
  const p = fetchPlan(s, w.from, w.to).then((items) => {
    if (gen !== cache.gen) return;
    const { overlay, count } = mealieOverlay(items, w);
    const sig = JSON.stringify(overlay);
    const changed = sig !== cache.sig;
    Object.assign(cache, { overlay, count, from: w.from, to: w.to, at: Date.now(), error: null, errorAt: 0, sig });
    if (changed) publish('family', {});
  }).catch((err) => {
    if (gen !== cache.gen) return;
    cache.error = err instanceof MealieError ? err.code : 'unreachable';
    cache.errorAt = Date.now();
    console.warn(`[mealie] meal plan not read: ${cache.error}`);
  }).finally(() => {
    if (cache.inflight === p) cache.inflight = null;
  });
  cache.inflight = p;
  return p;
}

/**
 * The meals from Mealie for familyCore.js (`mealOverlay`), or null when Mealie is not in use. Old or missing data
 * starts a read in the background (the displays are told when it brings something new).
 */
export function mealieMeals(now = Date.now()) {
  const cfg = getConfig();
  if (!mealieUsable(mealieSettings(), cfg)) return null;
  const fresh = cache.at && now - cache.at < TTL && cache.from === planWindow(cfg).from;
  const failedRecently = cache.errorAt && now - cache.errorAt < FAIL_TTL;
  if (!fresh && !failedRecently) refreshMealie();
  return cache.overlay;
}

/** Admin status (MealieStatus). */
export function mealieStatus() {
  return {
    usable: mealieUsable(),
    updatedAt: cache.at ? new Date(cache.at).toISOString() : null,
    error: cache.error,
    errorAt: cache.errorAt ? new Date(cache.errorAt).toISOString() : null,
    count: cache.count,
    from: cache.from,
    to: cache.to,
  };
}

/** Forget the plan and the photos (another server, another token, Mealie turned off). */
export function clearMealie() {
  const had = cache.overlay !== null;
  Object.assign(cache, { overlay: null, count: null, from: null, to: null, at: 0, error: null, errorAt: 0, inflight: null, sig: '' });
  cache.gen++;
  images.clear();
  imageInflight.clear();
  return had;
}

/** The stored token changed (admin, import): read again with it. */
export function mealieTokenChanged() {
  if (clearMealie()) publish('family', {});
  refreshMealie();
}

const settingsSig = (c) => `${c?.family?.enabled === true}|${c?.family?.meals?.enabled === true}|${normalizeMealieUrl(c?.family?.meals?.mealie?.url)}`;
events.on('config', (cfg, prev) => {
  if (!prev || settingsSig(cfg) === settingsSig(prev)) return;
  if (clearMealie()) publish('family', {});
  refreshMealie();
});

let timer = null;
/** Read the plan now and every TTL while the server runs (so changes in Mealie reach the screens). */
export function startMealie() {
  refreshMealie();
  if (timer) return;
  timer = setInterval(() => refreshMealie(), TTL);
  timer.unref?.();
}

export function stopMealie() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---------------------------------------------------------------------------------------------------------------
// Recipe photos

const images = new Map(); // `${id}|${v}` → { type, buf }
const imageInflight = new Map();

async function recipeImage(id, v) {
  const k = `${id}|${v}`;
  const hit = images.get(k);
  if (hit) {
    images.delete(k);
    images.set(k, hit);
    return hit;
  }
  if (imageInflight.has(k)) return imageInflight.get(k);
  const gen = cache.gen;
  const p = (async () => {
    const res = await call(mealieSettings(), `/api/media/recipes/${id}/images/min-original.webp`, { accept: 'image/*', maxBytes: IMAGE_MAX_BYTES });
    const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) throw new MealieError('bad_type');
    const img = { type, buf: res.buffer };
    if (gen === cache.gen) {
      images.set(k, img);
      while (images.size > IMAGE_CACHE_MAX) images.delete(images.keys().next().value);
    }
    return img;
  })().finally(() => { if (imageInflight.get(k) === p) imageInflight.delete(k); });
  imageInflight.set(k, p);
  return p;
}

/**
 * GET /media/mealie/:id (after mediaAuth). Only the photos of recipes in the cached plan are served, so this is
 * never an open door into Mealie; none while the dinner photo is turned off, and none to a display whose screens are
 * all private with "hide photos" (displayAccess.js mediaScreens). ?v= (the recipe's image key) only busts caches.
 */
export async function mealieMedia(req, res) {
  const id = String(req.params.id || '').toLowerCase();
  res.set('x-content-type-options', 'nosniff');
  const fail = (status, msg) => res.status(status).set('cache-control', 'no-store').type('text/plain').send(msg);
  if (!MEALIE_ID_RE.test(id)) return fail(404, 'not found');
  const cfg = getConfig();
  if (!mealieUsable(mealieSettings(), cfg) || cfg.family.meals.mealie?.photo === false) return fail(404, 'not found');
  const v = overlayPhotoIds(cache.overlay).get(id);
  if (!v) return fail(404, 'not found');
  const screens = mediaScreens(cfg, req.displayAccess || {});
  if (screens && !screens.length) return fail(404, 'not found');
  try {
    const img = await recipeImage(id, v);
    res.set('cache-control', 'private, max-age=86400');
    res.type(img.type);
    res.send(img.buf);
  } catch (err) {
    if (!(err instanceof MealieError)) console.warn('[mealie] photo failed:', err.message);
    fail(502, 'mealie unavailable');
  }
}

/** Tests: forget everything in memory. */
export function _resetMealie() {
  stopMealie();
  clearMealie();
}
