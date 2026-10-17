// Weather of several places (#11): place keys, the places a screen shows (its own, its cards', the cities card),
// validation and caps, the cities card, and the self-hosted cache: one forecast per place shared by every screen and
// card, a screen's own place, the admin preview route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './helpers.js';
import {
  placeKey, cleanPlace, weatherPlacesOf, screenWeatherPlaces, configWeatherPlaces, previewPlacesOf, placeLabel, countScreenPlaces,
  MAX_SCREEN_WEATHER_PLACES, MAX_WEATHER_PLACES,
} from '../core/weatherPlaces.js';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { CANVAS_KINDS, canvasDefaults, CITIES_DEFAULT } from '../core/canvasCore.js';
import { displayConfig } from '../core/screens.js';
import { roundCoord } from '../core/weather.js';

const PORTO = { name: 'Porto, Portugal', lat: 41.1496, lon: -8.611 };
const TOKYO = { name: 'Tokyo', lat: 35.6762, lon: 139.6503 };
const LONDON = { name: 'London', lat: 51.507, lon: -0.128 };
const errs = () => {
  const list = [];
  return { err: (p, m) => list.push(`${p}: ${m}`), list };
};

/** A Personalizado screen with these items (validated later). */
function canvasScreen(id, slug, items) {
  const s = defaultScreenProfile({ id, slug, name: slug });
  s.layout.preset = 'canvas';
  s.canvas.items = items.map((it, i) => ({ id: `i${i}`, kind: it.kind, pos: it.pos ?? { zone: 'main', x: (i % 3) * 4, y: Math.floor(i / 3) * 2, w: 4, h: 2 }, props: { ...canvasDefaults(it.kind), ...(it.props ?? {}) } }));
  return s;
}

test('place keys: rounded like the weather cache, so nearby spellings of one place share a forecast', () => {
  assert.equal(placeKey(PORTO), '41.15,-8.61');
  assert.equal(placeKey({ lat: 41.1504, lon: -8.6099 }), '41.15,-8.61');
  assert.notEqual(placeKey(PORTO), placeKey(TOKYO));
  // the same rounding as core/weather.js (the cache key)
  assert.equal(placeKey(PORTO), `${roundCoord(PORTO.lat).toFixed(2)},${roundCoord(PORTO.lon).toFixed(2)}`);
  assert.equal(placeLabel(PORTO), 'Porto');
});

test('cleanPlace: null stays null, coordinates in range, names trimmed and capped', () => {
  const c = errs();
  assert.equal(cleanPlace(c, 'p', null), null);
  assert.equal(cleanPlace(c, 'p', undefined), null);
  assert.deepEqual(cleanPlace(c, 'p', { name: '  Porto ', lat: 41.14961, lon: '-8.61099' }), { name: 'Porto', lat: 41.15, lon: -8.611 });
  assert.deepEqual(c.list, []);
  assert.equal(cleanPlace(c, 'p', { name: 'x', lat: 91, lon: 0 }), null);
  assert.equal(cleanPlace(c, 'p', { name: 'x', lat: 0, lon: 'east' }), null);
  assert.equal(cleanPlace(c, 'p', 'Porto'), null);
  assert.equal(c.list.length, 3);
  assert.equal(cleanPlace(errs(), 'p', { name: 'n'.repeat(120), lat: 1, lon: 1 }).name.length, 80);
});

test('weatherPlacesOf: the screen place first, then its cards and cities, once each, Rotativa cards too, at most 8', () => {
  const home = { locationName: 'Lisbon', lat: 38.72, lon: -9.14 };
  // no place of its own: the household's
  assert.deepEqual(weatherPlacesOf(home).map((p) => [p.key, p.name, p.home]), [['38.72,-9.14', 'Lisbon', true]]);
  // a place of its own replaces it
  const own = weatherPlacesOf({ ...home, place: PORTO });
  assert.deepEqual(own.map((p) => [p.key, p.home]), [['41.15,-8.61', false]]);
  const items = [
    { kind: 'weather.now', props: { place: null } },
    { kind: 'weather.hourly', props: { place: TOKYO } },
    { kind: 'weather.forecast', props: { place: { ...TOKYO, name: 'Tōkyō' } } },
    { kind: 'weather.cities', props: { places: [LONDON, PORTO, { name: 'Home again', lat: 38.721, lon: -9.139 }] } },
    { kind: 'weather.now', props: { place: { name: 'Hidden', lat: 10, lon: 10 } }, hidden: true },
    { kind: 'rotator', props: { cards: [{ kind: 'weather.now', props: { place: { name: 'Oslo', lat: 59.91, lon: 10.75 } } }] } },
  ];
  const all = weatherPlacesOf(home, items);
  assert.deepEqual(all.map((p) => p.name), ['Lisbon', 'Tokyo', 'London', 'Porto, Portugal', 'Oslo']);
  assert.equal(all.filter((p) => p.home).length, 1);
  // more than 8 other places: its own and the first 8 others only
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, lat: i, lon: i }));
  assert.equal(weatherPlacesOf(home, [{ kind: 'weather.cities', props: { places: many } }]).length, MAX_SCREEN_WEATHER_PLACES + 1);
});

test('validation: a screen place, card places and the cities card are kept; old configs get null; caps refuse more', () => {
  const c = defaultConfig();
  c.screens[0].weather.place = PORTO;
  c.screens.push(canvasScreen('s_two', 'two', [
    { kind: 'weather.now', props: { place: TOKYO } },
    { kind: 'weather.cities', props: { places: [LONDON, PORTO], layout: 'grid', highLow: false } },
    { kind: 'weather.forecast' },
  ]));
  const v = validateConfig(c);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.value.screens[0].weather.place, { name: 'Porto, Portugal', lat: 41.15, lon: -8.611 });
  const items = v.value.screens[1].canvas.items;
  assert.equal(items[0].props.place.name, 'Tokyo');
  assert.deepEqual(items[1].props, { places: [LONDON, { name: 'Porto, Portugal', lat: 41.15, lon: -8.611 }], highLow: false, layout: 'grid' });
  assert.equal(items[2].props.place, null);
  assert.equal(countScreenPlaces(v.value, v.value.screens[1]), 3); // Tokyo, London and Porto besides home
  assert.deepEqual(configWeatherPlaces(v.value).map((p) => p.name), ['Porto, Portugal', 'Lisbon, Portugal', 'Tokyo', 'London']);

  // a screen saved before 0.17 has no place: the household's
  const old = structuredClone(c);
  delete old.screens[0].weather.place;
  assert.equal(mergeDefaults(old).screens[0].weather.place, null);
  assert.equal(validateConfig(mergeDefaults(old)).value.screens[0].weather.place, null);

  // a bad place is refused with its path
  const bad = structuredClone(c);
  bad.screens[0].weather.place = { name: 'x', lat: 200, lon: 0 };
  assert.deepEqual(validateConfig(bad).errors.map((e) => e.path), ['screens[0].weather.place.lat']);

  // a cities card of 8 places fits on any screen; more than 8 places besides the screen's own do not
  const eight = Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, lat: i, lon: i }));
  const full = defaultConfig();
  full.screens[0] = canvasScreen('s_main', 'living-room', [{ kind: 'weather.cities', props: { places: eight } }]);
  assert.deepEqual(validateConfig(full).errors, []);
  const crowded = defaultConfig();
  crowded.screens[0] = canvasScreen('s_main', 'living-room', [
    { kind: 'weather.cities', props: { places: eight } },
    { kind: 'weather.now', props: { place: TOKYO } },
  ]);
  assert.deepEqual(validateConfig(crowded).errors.map((e) => e.path), ['screens[0].weather.place']);

  // more than MAX_WEATHER_PLACES in the whole config
  const wide = defaultConfig();
  wide.screens = Array.from({ length: 6 }, (_, s) => canvasScreen(`s_${s}`, `scr-${s}`, [
    { kind: 'weather.cities', props: { places: Array.from({ length: 7 }, (_, i) => ({ name: `P${s}-${i}`, lat: s * 10 + i, lon: i })) } },
  ]));
  wide.defaultScreen = 's_0';
  assert.ok(6 * 8 > MAX_WEATHER_PLACES);
  assert.ok(validateConfig(wide).errors.some((e) => e.path === 'weather.places'));
});

test('cities card: two places by default, list layout, 8 at most, an empty list goes back to the defaults', () => {
  const k = CANVAS_KINDS['weather.cities'];
  assert.equal(k.cat, 'weather');
  assert.equal(k.edition, 'all');
  assert.deepEqual(k.fine, [4, 1]);
  assert.deepEqual(canvasDefaults('weather.cities'), { places: CITIES_DEFAULT, highLow: true, layout: 'list' });
  const c = errs();
  assert.deepEqual(k.props(c, 'p', { places: [] }).places, CITIES_DEFAULT);
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, lat: i, lon: i }));
  assert.equal(k.props(c, 'p', { places: nine }).places.length, 8);
  assert.ok(c.list.some((m) => m.startsWith('p.places')));
  // every weather card takes an optional place
  for (const kind of ['weather.now', 'weather.hourly', 'weather.forecast']) {
    assert.equal(canvasDefaults(kind).place, null);
    assert.equal(CANVAS_KINDS[kind].props(errs(), 'p', { place: TOKYO }).place.name, 'Tokyo');
  }
});

test('display config: the screen place goes to the display; the HA entities do not', () => {
  const c = defaultConfig();
  c.screens[0].weather.place = PORTO;
  c.weather.haWeatherEntity = 'weather.home';
  const v = validateConfig(c).value;
  const d = displayConfig(v, v.screens[0]);
  assert.equal(d.weather.place.name, 'Porto, Portugal');
  assert.equal(d.weather.haWeatherEntity, undefined);
  assert.deepEqual(screenWeatherPlaces(v, v.screens[0]).map((p) => p.key), ['41.15,-8.61']);
});

test('preview places: at most 8, all valid, repeats dropped', () => {
  assert.deepEqual(previewPlacesOf({ places: [PORTO, { ...PORTO, name: 'Again' }, TOKYO] }).map((p) => p.name), ['Porto, Portugal', 'Tokyo']);
  assert.equal(previewPlacesOf({ places: [PORTO, { lat: 'x' }] }), null);
  assert.equal(previewPlacesOf({ places: Array.from({ length: 9 }, (_, i) => ({ name: '', lat: i, lon: i })) }), null);
  assert.equal(previewPlacesOf({}), null);
  assert.equal(previewPlacesOf(null), null);
});

/** Open-Meteo answers for any place; every call is recorded with its place. */
function fakeOpenMeteo() {
  const body = fixture('weather/open-meteo-lisbon.json');
  const calls = [];
  const f = async (url) => {
    const u = new URL(String(url));
    calls.push(`${Number(u.searchParams.get('latitude')).toFixed(2)},${Number(u.searchParams.get('longitude')).toFixed(2)}`);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}

test('server/weather.js: one forecast per place, shared by screens and cards; a screen place; old places dropped', async () => {
  const store = await import('../store.js');
  const weather = await import('../weather.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-wxplaces-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  // home (Lisbon) · a screen in Porto · a Personalizado screen at home with a Porto card and a cities card
  const porto = defaultScreenProfile({ id: 's_porto', slug: 'porto', name: 'Porto' });
  porto.weather.place = PORTO;
  const cv = canvasScreen('s_cv', 'canvas', [
    { kind: 'weather.now' },
    { kind: 'weather.forecast', props: { place: PORTO } },
    { kind: 'weather.cities', props: { places: [LONDON, PORTO, TOKYO] } },
  ]);
  c.screens.push(porto, cv);
  const v = validateConfig(c);
  assert.deepEqual(v.errors, []);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(v.value));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({}));
  store.initStore(dir);
  const f = fakeOpenMeteo();
  weather.setWeatherFetch(f);
  try {
    const cfg = store.getConfig();
    const scr = (id) => cfg.screens.find((s) => s.id === id);
    const home = await weather.getWeather({ screen: scr('s_main'), lang: 'en' });
    assert.equal(home.placeKey, '38.72,-9.14');
    assert.equal(home.places, undefined);
    const p = await weather.getWeather({ screen: scr('s_porto'), lang: 'es' });
    assert.equal(p.placeKey, '41.15,-8.61');
    assert.equal(p.locationName, 'Porto, Portugal');
    const all = await weather.getWeather({ screen: scr('s_cv'), lang: 'pt' });
    assert.equal(all.placeKey, '38.72,-9.14');
    assert.deepEqual(Object.keys(all.places).sort(), ['35.68,139.65', '41.15,-8.61', '51.51,-0.13']);
    assert.equal(all.places['51.51,-0.13'].locationName, 'London');
    // one upstream call per distinct place, whatever the screens, cards and languages
    assert.deepEqual([...f.calls].sort(), ['35.68,139.65', '38.72,-9.14', '41.15,-8.61', '51.51,-0.13']);
    await weather.getWeather({ screen: scr('s_cv'), lang: 'da' });
    await weather.getWeather({ screen: scr('s_porto'), lang: 'nl' });
    assert.equal(f.calls.length, 4);
    assert.equal(weather.cacheSize(), 4);

    // the cities card goes: Tokyo and London are dropped from the cache at the next fetch
    const next = structuredClone(store.getConfig());
    next.screens.find((s) => s.id === 's_cv').canvas.items.splice(2, 1);
    store.saveConfig(validateConfig(next).value);
    await weather.getWeather({ screen: store.getConfig().screens.find((s) => s.id === 's_cv'), lang: 'en', force: true });
    assert.equal(weather.cacheSize(), 2);
    // the household's place stays in the cache even when no screen shows it (the admin's status line reads it)
    const away = structuredClone(store.getConfig());
    away.screens = away.screens.filter((s) => s.id === 's_porto');
    away.defaultScreen = 's_porto';
    store.saveConfig(validateConfig(away).value);
    await weather.getWeather({ lang: 'en', force: true });
    assert.equal(weather.cacheSize(), 2);
    assert.ok(weather.cachedWeather('en'));
    const before = f.calls.length;
    await weather.getWeather({ lang: 'en' });
    await weather.getWeather({ lang: 'es' });
    assert.equal(f.calls.length, before);

    // admin preview of unsaved places: through the same cache
    const pv = await weather.previewWeather([PORTO, TOKYO], 'en');
    assert.deepEqual(Object.keys(pv).sort(), ['35.68,139.65', '41.15,-8.61']);
    assert.equal(f.calls.length, before + 1); // Tokyo only
  } finally {
    weather.setWeatherFetch(null);
  }
});

test('HTTP: /api/weather?screen= answers with that screen place; POST /api/admin/weather/preview needs a session', async () => {
  const store = await import('../store.js');
  const weather = await import('../weather.js');
  const { ensurePassword, hashPassword } = await import('../auth.js');
  const { createApp } = await import('../app.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-wxplaces-api-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'open';
  const porto = defaultScreenProfile({ id: 's_porto', slug: 'porto', name: 'Porto' });
  porto.weather.place = PORTO;
  c.screens.push(porto);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(validateConfig(c).value));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dist, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>display</title>');
  fs.writeFileSync(path.join(dist, 'admin', 'index.html'), '<!doctype html><title>admin</title>');
  store.initStore(dir);
  await ensurePassword();
  const f = fakeOpenMeteo();
  weather.setWeatherFetch(f);
  const app = createApp({ version: '0.17.0', dist });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch { /* not json */ }
    return { status: r.status, json: j, setCookie: r.headers.getSetCookie?.() || [] };
  };
  try {
    const home = await call('GET', '/api/weather');
    assert.equal(home.status, 200);
    assert.equal(home.json.placeKey, '38.72,-9.14');
    const p = await call('GET', '/api/weather?screen=porto');
    assert.equal(p.json.placeKey, '41.15,-8.61');
    assert.equal(p.json.locationName, 'Porto, Portugal');

    assert.equal((await call('POST', '/api/admin/weather/preview', { places: [TOKYO], lang: 'en' })).status, 401);
    const login = await call('POST', '/api/auth/login', { password: 'secret-pass-123' });
    cookie = login.setCookie.map((x) => x.split(';')[0]).join('; ');
    const pv = await call('POST', '/api/admin/weather/preview', { places: [TOKYO], lang: 'es' });
    assert.equal(pv.status, 200);
    assert.equal(pv.json.places['35.68,139.65'].locationName, 'Tokyo');
    assert.equal((await call('POST', '/api/admin/weather/preview', { places: [{ lat: 'x' }] })).status, 400);
    assert.equal((await call('POST', '/api/admin/weather/preview', { places: Array.from({ length: 9 }, (_, i) => ({ name: '', lat: i, lon: i })) })).status, 400);
  } finally {
    weather.setWeatherFetch(null);
    await new Promise((r) => server.close(r));
  }
});
