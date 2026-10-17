// Weather places (#11): a screen may show the weather of another place than the household's ("Ubicación de esta
// pantalla"), each weather card of a Personalizado screen may have a place of its own, and the "Tiempo en varias
// ciudades" card (weather.cities) shows a few places at once. Pure: used by validation, both servers (self-hosted
// server/weather.js, Marco Cloud) and the display (which places a screen needs, keyed the same way as the cache).
//
// A place is { name, lat, lon }. Two places at the same rounded spot (2 decimals, about 1 km, the precision of the
// weather cache key, core/weather.js roundCoord) are the same place: they share one forecast, whatever their names.

/**
 * Most distinct places one screen may show besides its own (its cards' places and every city of its cities cards), so a
 * cities card of 8 places fits on any screen.
 */
export const MAX_SCREEN_WEATHER_PLACES = 8;
/** Most distinct places a whole config may use (every screen together): a sanity cap on what the server fetches. */
export const MAX_WEATHER_PLACES = 32;
/** "Tiempo en varias ciudades": how many places one card shows. */
export const CITIES_MIN = 2;
export const CITIES_MAX = 8;
/** The weather cards that may have a place of their own ("Igual que la pantalla" when they do not). */
export const WEATHER_PLACE_KINDS = ['weather.now', 'weather.hourly', 'weather.forecast'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

/** The key of a place: its rounded coordinates ("38.72,-9.14"), the same rounding as the weather cache. */
export function placeKey(p) {
  return `${r2(p.lat).toFixed(2)},${r2(p.lon).toFixed(2)}`;
}

/** The household's place (config.weather): the place of every screen that has none of its own. */
export function homePlace(weather) {
  return { name: String(weather?.locationName ?? ''), lat: Number(weather?.lat) || 0, lon: Number(weather?.lon) || 0 };
}

/**
 * Validates a place: null (none: the screen's or the household's) or { name, lat, lon }. `c.err(path, message)`
 * reports a problem; a place that cannot be read is null.
 */
export function cleanPlace(c, path, v) {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) {
    c.err(path, 'expected object or null');
    return null;
  }
  const lat = typeof v.lat === 'string' ? Number(v.lat) : v.lat;
  const lon = typeof v.lon === 'string' ? Number(v.lon) : v.lon;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    c.err(`${path}.lat`, 'expected a latitude (-90 to 90)');
    return null;
  }
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    c.err(`${path}.lon`, 'expected a longitude (-180 to 180)');
    return null;
  }
  let name = typeof v.name === 'string' ? v.name : '';
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (name.length > 80) {
    c.err(`${path}.name`, 'too long (max 80)');
    name = name.slice(0, 80);
  }
  return { name, lat: r3(lat), lon: r3(lon) };
}

/** The cards of a list of canvas items, a Rotativa's cards included (as canvasCore canvasCards, kept apart here). */
function cardsOf(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || it.hidden) continue;
    out.push(it);
    if (it.kind === 'rotator' && Array.isArray(it.props?.cards)) for (const cd of it.props.cards) if (cd && typeof cd.kind === 'string') out.push(cd);
  }
  return out;
}

/** The places the cards of a Personalizado screen ask for of their own, in order (repeats included). */
export function cardPlaces(items) {
  const out = [];
  for (const it of cardsOf(items)) {
    if (WEATHER_PLACE_KINDS.includes(it.kind) && isObj(it.props?.place)) out.push(it.props.place);
    else if (it.kind === 'weather.cities' && Array.isArray(it.props?.places)) for (const p of it.props.places) if (isObj(p)) out.push(p);
  }
  return out;
}

/**
 * Every place a screen shows, without repeats, its own first: [{ key, name, lat, lon, home }] (home = the household's
 * place, which gets the Home Assistant extras). `weather` = the screen's weather block merged with the global one (the
 * display config's, or flatView's), `items` = its Personalizado items (null on other layouts). Its own place and at
 * most MAX_SCREEN_WEATHER_PLACES others (validation refuses more; anything past that is left out).
 */
export function weatherPlacesOf(weather, items = null) {
  const home = homePlace(weather);
  const homeKey = placeKey(home);
  const own = isObj(weather?.place) ? weather.place : null;
  const out = [];
  const seen = new Set();
  const add = (p, name) => {
    const key = placeKey(p);
    if (seen.has(key) || out.length > MAX_SCREEN_WEATHER_PLACES) return;
    seen.add(key);
    out.push({ key, name: name ?? String(p.name ?? ''), lat: Number(p.lat), lon: Number(p.lon), home: key === homeKey });
  };
  add(own ?? home, own ? undefined : home.name);
  for (const p of cardPlaces(items)) add(p);
  return out;
}

/** The places of one screen of a config (screen profile + the global weather block). */
export function screenWeatherPlaces(cfg, screen) {
  const weather = { ...(cfg?.weather ?? {}), ...(screen?.weather ?? {}) };
  return weatherPlacesOf(weather, screen?.layout?.preset === 'canvas' ? screen?.canvas?.items : null);
}

/**
 * Distinct places a screen shows besides its own, before the cap (validation: more than MAX_SCREEN_WEATHER_PLACES is
 * refused).
 */
export function countScreenPlaces(cfg, screen) {
  const keys = new Set();
  const own = placeKey(isObj(screen?.weather?.place) ? screen.weather.place : homePlace(cfg?.weather));
  for (const p of cardPlaces(screen?.layout?.preset === 'canvas' ? screen?.canvas?.items : null)) if (placeKey(p) !== own) keys.add(placeKey(p));
  return keys.size;
}

/** Every distinct place a config uses (each screen's), keyed: the places the weather cache may keep. */
export function configWeatherPlaces(cfg) {
  const out = new Map();
  for (const s of cfg?.screens ?? []) for (const p of screenWeatherPlaces(cfg, s)) if (!out.has(p.key)) out.set(p.key, p);
  if (!out.size) {
    const h = homePlace(cfg?.weather);
    out.set(placeKey(h), { key: placeKey(h), ...h, home: true });
  }
  return [...out.values()];
}

/** The short name a card shows for a place: "Porto, Portugal" → "Porto". */
export function placeLabel(p) {
  return String(p?.name ?? '').split(',')[0].trim();
}

/**
 * The places of POST /api/admin/weather/preview ({ places: [{ name, lat, lon }] }, at most
 * MAX_SCREEN_WEATHER_PLACES, repeats dropped), or null when the body is not that.
 */
export function previewPlacesOf(body) {
  const raw = isObj(body) ? body.places : null;
  if (!Array.isArray(raw) || raw.length > MAX_SCREEN_WEATHER_PLACES) return null;
  let bad = false;
  const c = { err: () => (bad = true) };
  const out = [];
  const seen = new Set();
  raw.forEach((v, i) => {
    const p = cleanPlace(c, `places[${i}]`, v);
    if (!p) bad = true;
    else if (!seen.has(placeKey(p))) {
      seen.add(placeKey(p));
      out.push(p);
    }
  });
  return bad ? null : out;
}
