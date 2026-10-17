// Weather for the screens: one of the free sources in server/core/weather.js (Open-Meteo, MET Norway, Pirate Weather
// with the household's own key), plus the optional Home Assistant overlay (current conditions from a weather
// entity, indoor sensors). The provider answer is cached per place (one entry for every language) for at least the
// provider's minimum interval (MET Norway's Expires header when longer); a failed refresh keeps showing the last
// answer for up to 6 hours. A screen may show other places too (core/weatherPlaces.js, #11): each place is its own
// cache entry, shared by every screen and card showing it, and entries of places no screen shows any more are dropped.
import fs from 'node:fs';
import { fetchWeather, localizeWeather, tryWeatherKey, weatherCacheKey, weatherRequest, WEATHER_STALE_MS } from './core/weather.js';
import { wmoDescription, windDirLabel } from './core/lib/i18n.js';
import { defaultScreen } from './core/screens.js';
import { configWeatherPlaces, homePlace, placeKey, screenWeatherPlaces, MAX_WEATHER_PLACES } from './core/weatherPlaces.js';
import { getConfig, getSecrets } from './store.js';
import * as ha from './homeassistant.js';
import { mirroredState } from './haLive.js';

const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0';
  }
})();
/** MET Norway asks for an identifying User-Agent with a way to reach the app. */
export const USER_AGENT = `Marco/${VERSION} (+https://github.com/mr-reb00t/marco)`;

const cache = new Map(); // weatherCacheKey → { base, fetchedAt, expiresAt, lastModified }
const inflight = new Map(); // weatherCacheKey → Promise<entry>
export const status = { ok: null, updatedAt: null, error: null, errorCode: null, provider: null };

/** Tests replace the network. */
let outbound = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
export function setWeatherFetch(f) {
  outbound = f || ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }));
  cache.clear();
}

/** The household's key for a key provider (secrets.json, never in the config). */
export const weatherKey = () => String(getSecrets()?.weather?.apiKey || '');

// HA weather condition → WMO code (approximate)
const HA_TO_WMO = {
  'clear-night': 0, sunny: 0, partlycloudy: 2, cloudy: 3, fog: 45, rainy: 63, pouring: 65, lightning: 95,
  'lightning-rainy': 95, hail: 96, snowy: 73, 'snowy-rainy': 66, windy: 3, 'windy-variant': 3, exceptional: 3,
};

const round1 = (n) => (n == null || Number.isNaN(+n) ? null : Math.round(+n * 10) / 10);
const round0 = (n) => (n == null || Number.isNaN(+n) ? null : Math.round(+n));

/** A Home Assistant state: from the live mirror when it has it (haLive.js), else one REST call. */
const haState = (id) => {
  const m = mirroredState(id);
  return m ? Promise.resolve(m) : ha.getState(id);
};

async function applyHomeAssistant(data, w, lang) {
  if (!ha.haUsable()) return data;
  const num = (s) => {
    const n = parseFloat(s?.state);
    return Number.isFinite(n) ? n : null;
  };
  const tasks = [];
  if (w.provider === 'homeassistant' && w.haWeatherEntity) {
    tasks.push(haState(w.haWeatherEntity).then((s) => {
      const a = s.attributes || {};
      const code = HA_TO_WMO[s.state];
      const cur = data.current;
      data.source = { ...data.source, also: 'Home Assistant' };
      if (a.temperature != null) cur.temp = round1(a.temperature);
      if (a.apparent_temperature != null) cur.feelsLike = round1(a.apparent_temperature);
      if (a.humidity != null) cur.humidity = round0(a.humidity);
      if (a.wind_speed != null) {
        const unit = String(a.wind_speed_unit || 'km/h').toLowerCase();
        const k = unit === 'm/s' ? 3.6 : unit === 'mph' ? 1.609 : unit === 'kn' ? 1.852 : 1;
        cur.windKmh = round0(a.wind_speed * k);
      }
      if (a.wind_bearing != null && !Number.isNaN(+a.wind_bearing)) {
        cur.windDir = round0(a.wind_bearing);
        cur.windDirLabel = windDirLabel(a.wind_bearing, lang);
      }
      if (a.pressure != null) cur.pressure = round0(a.pressure);
      if (a.uv_index != null) cur.uv = round1(a.uv_index);
      if (code !== undefined) {
        cur.code = code;
        cur.description = wmoDescription(code, lang);
        if (s.state === 'clear-night') cur.isDay = false;
      }
    }).catch((err) => console.warn('[weather] HA weather entity:', err.message)));
  }
  let indoor = null;
  if (w.haIndoorTempEntity) {
    tasks.push(haState(w.haIndoorTempEntity).then((s) => { indoor = { ...(indoor || {}), temp: round1(num(s)) }; })
      .catch((err) => console.warn('[weather] HA indoor temp:', err.message)));
  }
  if (w.haIndoorHumidityEntity) {
    tasks.push(haState(w.haIndoorHumidityEntity).then((s) => { indoor = { ...(indoor || {}), humidity: round0(num(s)) }; })
      .catch((err) => console.warn('[weather] HA indoor humidity:', err.message)));
  }
  await Promise.all(tasks);
  if (indoor) data.indoor = { temp: indoor.temp ?? null, humidity: indoor.humidity ?? null };
  return data;
}

/**
 * Tries a Pirate Weather key at the configured place (one call, kept in the cache when it works): true, false
 * (refused) or null (could not tell).
 */
export async function checkWeatherKey(key) {
  const cfg = getConfig();
  const forecastDays = Math.max(1, ...cfg.screens.map((s) => s.weather.forecastDays));
  const r = weatherRequest({ ...cfg.weather, provider: 'pirate-weather' }, { tz: cfg.datetime.timezone, forecastDays, apiKey: key });
  const { ok, entry } = await tryWeatherKey(r, { fetch: outbound, userAgent: USER_AGENT });
  if (entry) cache.set(weatherCacheKey(r), entry);
  return ok;
}

/** The keys of the places the config shows (the cache keeps only these). */
function liveKeys(cfg, forecastDays, apiKey) {
  // the household's place always (the admin's status line and dashboard read it)
  const places = [homePlace(cfg.weather), ...configWeatherPlaces(cfg).slice(0, MAX_WEATHER_PLACES)];
  const out = new Set(places.map((p) => weatherCacheKey(requestAt(cfg, p, forecastDays, apiKey))));
  // places the admin tried in the last half hour (previewWeather), so its preview does not fetch them again each time
  const now = Date.now();
  for (const [k, until] of tried) {
    if (until < now) tried.delete(k);
    else out.add(k);
  }
  return out;
}

/** Cache keys of the places the admin preview asked for → until when they are kept (at most 16). */
const tried = new Map();
const TRIED_MS = 30 * 60_000;

/** Drop the entries of places and providers no screen uses any more. */
function prune(cfg, forecastDays, apiKey, keep) {
  const live = liveKeys(cfg, forecastDays, apiKey);
  live.add(keep);
  for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
}

/** The provider request for a place (the household's provider, units, zone and days). */
function requestAt(cfg, place, forecastDays, apiKey) {
  return weatherRequest({ ...cfg.weather, lat: place.lat, lon: place.lon }, { tz: cfg.datetime.timezone, forecastDays, apiKey });
}

/** Provider entry for a request: cached while fresh, else fetched (one request at a time per key). */
async function entryFor(r, force, onFetched) {
  const key = weatherCacheKey(r);
  const hit = cache.get(key);
  const now = Date.now();
  // `force` (admin refresh) still waits for MET Norway's Expires: its terms ask not to call before it.
  if (hit && hit.expiresAt > now && (!force || r.provider === 'met-norway')) return { e: hit, error: null };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const e = await fetchWeather(r, { fetch: outbound, userAgent: USER_AGENT, prev: hit || null });
      cache.set(key, e);
      // Entries for places and providers no screen shows any more are useless now.
      onFetched?.(key);
      return { e, error: null };
    } catch (err) {
      if (hit && now - Date.parse(hit.fetchedAt) < WEATHER_STALE_MS) return { e: hit, error: err }; // stale on error
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

const forecastDaysOf = (cfg) => Math.max(1, ...cfg.screens.map((s) => s.weather.forecastDays));

/** The weather at one place in a language (Home Assistant's extras at the household's place only). */
async function weatherAt(cfg, place, { lang, force = false, forecastDays, apiKey, track = false }) {
  const w = cfg.weather;
  const r = requestAt(cfg, place, forecastDays, apiKey);
  const fail = (err) => Object.assign(status, { ok: false, error: err.message, errorCode: err.code || 'http', provider: r.provider });
  let got;
  try {
    got = await entryFor(r, force, (key) => prune(cfg, forecastDays, apiKey, key));
  } catch (err) {
    if (track) fail(err);
    throw err;
  }
  if (track) {
    if (got.error) fail(got.error);
    else Object.assign(status, { ok: true, updatedAt: got.e.fetchedAt, error: null, errorCode: null, provider: r.provider });
  }
  const data = localizeWeather(got.e.base, { lang, locationName: place.name, forecastDays });
  data.placeKey = placeKey(place);
  return place.home ? applyHomeAssistant(data, w, lang) : data;
}

/**
 * The weather of a screen (default: the default screen) in `lang` (default: its language): its own place (the
 * household's unless the screen has one), with `places` = the other places its cards show, by placeKey (a place that
 * fails is left out). Throws when the screen's own place fails with nothing cached.
 */
export async function getWeather({ force = false, lang = null, screen = null } = {}) {
  const cfg = getConfig();
  // v2: provider and units are global; forecastDays is per screen → fetch the max any screen shows.
  const forecastDays = forecastDaysOf(cfg);
  const scr = screen || defaultScreen(cfg);
  lang ||= scr.screen.language;
  const apiKey = weatherKey();
  const [own, ...others] = screenWeatherPlaces(cfg, scr);
  const opts = { lang, force, forecastDays, apiKey };
  const [data, rest] = await Promise.all([
    weatherAt(cfg, own, { ...opts, track: own.home }),
    Promise.allSettled(others.map((p) => weatherAt(cfg, p, opts))),
  ]);
  // the household's place keeps the status line of the admin up to date even when this screen shows another one
  if (!own.home) weatherAt(cfg, { ...homePlace(cfg.weather), home: true }, { ...opts, track: true }).catch(() => {});
  const places = {};
  rest.forEach((x) => {
    if (x.status === 'fulfilled') places[x.value.placeKey] = x.value;
  });
  if (others.length) data.places = places;
  return data;
}

/**
 * Weather of places the admin is trying out (POST /api/admin/weather/preview: a draft's cards, a screen's place not
 * saved yet), by placeKey. At most 8; each one goes through the same cache as the screens.
 */
export async function previewWeather(places, lang) {
  const cfg = getConfig();
  const forecastDays = forecastDaysOf(cfg);
  const apiKey = weatherKey();
  const homeKey = placeKey(homePlace(cfg.weather));
  const out = {};
  const list = places.slice(0, 8);
  for (const p of list) {
    tried.set(weatherCacheKey(requestAt(cfg, p, forecastDays, apiKey)), Date.now() + TRIED_MS);
    while (tried.size > 16) tried.delete(tried.keys().next().value);
  }
  const got = await Promise.allSettled(list.map((p) => weatherAt(cfg, { ...p, home: placeKey(p) === homeKey }, { lang, forecastDays, apiKey })));
  for (const x of got) if (x.status === 'fulfilled') out[x.value.placeKey] = x.value;
  return out;
}

/**
 * Cached weather without fetching (dashboard): the household's place in `lang` (default screen language), or
 * null. May be stale.
 */
export function cachedWeather(lang = null) {
  const cfg = getConfig();
  lang ||= defaultScreen(cfg).screen.language;
  const forecastDays = forecastDaysOf(cfg);
  const e = cache.get(weatherCacheKey(requestAt(cfg, homePlace(cfg.weather), forecastDays, weatherKey())));
  return e ? localizeWeather(e.base, { lang, locationName: cfg.weather.locationName, forecastDays }) : null;
}

/** Tests: how many forecasts the cache holds. */
export const cacheSize = () => cache.size;
