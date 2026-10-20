// Weather sources (server/core/weather.js): each provider's normalizer on recorded answers, the symbol and icon
// tables, sunrise and sunset, request keys, MET Norway's caching rules, the API key check, validation, and the
// self-hosted cache in server/weather.js.
//
// Fixtures (server/test/fixtures/weather/), recorded on 2026-10-10:
//   open-meteo-lisbon.json               api.open-meteo.com, Lisbon, default model, 8 days
//   open-meteo-madrid-meteofrance.json   the same for Madrid with models=meteofrance_seamless (no precipitation
//                                        probability, 4 days of temperatures)
//   met-norway-new-york.json             api.met.no Locationforecast 2.0 complete, New York (no probability)
//   met-norway-oslo.json                 the same for Oslo (with probability_of_precipitation)
//   pirate-weather-docs-sample.json      built from the response example in the Pirate Weather docs
//                                        (docs.pirateweather.net, API → Response Examples), units=ca
// MET Norway fixtures keep only the fields Marco reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './helpers.js';
import {
  baseFromOpenMeteo, baseFromMetNorway, basePirateWeather, localizeWeather, mapOpenMeteo, metSymbolToWmo, pirateIconToWmo,
  sunTimes, isDayAt, weatherRequest, weatherCacheKey, fetchWeather, openMeteoUrl, metNorwayUrl, pirateWeatherUrl, weatherSource,
  WeatherError, tryWeatherKey, weatherKeyStatus, roundCoord, fetchDays, OPEN_METEO_MODEL_IDS, WEATHER_PROVIDERS,
} from '../core/weather.js';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { exportSecrets, sanitizeImportedSecrets } from '../core/backupsCore.js';
import { wmoDescription } from '../core/lib/i18n.js';

const json = (name) => JSON.parse(fixture(`weather/${name}`));

/** A fake fetch: `answer(url, init)` returns { status, body, headers }; every call is recorded. */
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), headers: { ...(init.headers || {}) } });
    const a = await answer(String(url), init);
    const headers = new Headers(a.headers || {});
    return new Response(a.status === 304 ? null : JSON.stringify(a.body ?? {}), { status: a.status ?? 200, headers });
  };
  f.calls = calls;
  return f;
}

// --------------------------------------------------------------------------------------------- Open-Meteo

test('open-meteo: Lisbon answer → current, today, days and the next 8 hours', () => {
  const j = json('open-meteo-lisbon.json');
  const base = baseFromOpenMeteo(j, { tz: 'Europe/Lisbon' });
  assert.equal(base.provider, 'open-meteo');
  assert.equal(base.days.length, 8);
  const now = new Date(`${j.current.time}:00+01:00`);
  const w = localizeWeather(base, { lang: 'es', locationName: 'Lisboa', forecastDays: 5, now });
  assert.equal(w.current.temp, Math.round(j.current.temperature_2m * 10) / 10);
  assert.equal(w.current.humidity, j.current.relative_humidity_2m);
  assert.equal(w.current.description, wmoDescription(j.current.weather_code, 'es'));
  assert.equal(w.daily.length, 5);
  assert.equal(w.daily[0].date, j.daily.time[0]);
  assert.match(w.today.sunrise, /^2026-10-10T07:4\d:00\+01:00$/);
  assert.equal(w.hourly.length, 8);
  assert.ok(Date.parse(w.hourly[0].time) <= now.getTime() && Date.parse(w.hourly[0].time) + 3600_000 > now.getTime());
  assert.deepEqual(w.source, weatherSource('open-meteo'));
  assert.equal(w.source.licence, 'CC BY 4.0');
  assert.equal(w.indoor, null);
});

test('open-meteo: a model without probability or UV leaves them null and drops days it does not cover', () => {
  const j = json('open-meteo-madrid-meteofrance.json');
  const base = baseFromOpenMeteo(j, { model: 'meteofrance_seamless', tz: 'Europe/Madrid' });
  assert.ok(base.days.length >= 3 && base.days.length < 8, `days: ${base.days.length}`);
  assert.ok(base.days.every((d) => d.min != null && d.max != null));
  assert.ok(base.days.every((d) => d.precipChance === null));
  assert.equal(base.current.uv, null);
  const w = localizeWeather(base, { lang: 'en', forecastDays: 7, now: new Date(`${j.current.time}:00+02:00`) });
  assert.equal(w.today.precipChance, null);
  assert.equal(w.source.modelName, 'Météo-France');
  assert.ok(w.hourly.every((h) => h.temp !== null));
});

test('open-meteo: URL asks for a model only when one is chosen; mapOpenMeteo keeps its 0.4 shape', () => {
  const w = { lat: 38.72, lon: -9.14, units: 'metric', forecastDays: 5 };
  assert.ok(!openMeteoUrl(w, 'Europe/Lisbon').includes('models='));
  assert.ok(openMeteoUrl({ ...w, model: 'best_match' }, 'Europe/Lisbon').indexOf('models=') === -1);
  assert.match(openMeteoUrl({ ...w, model: 'icon_seamless' }, 'Europe/Lisbon'), /models=icon_seamless/);
  assert.match(openMeteoUrl({ ...w, units: 'imperial' }, 'Europe/Lisbon'), /temperature_unit=fahrenheit/);
  const j = json('open-meteo-lisbon.json');
  const out = mapOpenMeteo(j, { lang: 'pt', locationName: 'Lisboa', forecastDays: 3, now: new Date(`${j.current.time}:00+01:00`) });
  assert.equal(out.locationName, 'Lisboa');
  assert.equal(out.daily.length, 3);
  assert.equal(out.source.provider, 'open-meteo');
});

// --------------------------------------------------------------------------------------------- MET Norway

test('met-norway: New York answer → local days, computed sun times, no probability', () => {
  const j = json('met-norway-new-york.json');
  const ts = j.properties.timeseries;
  const now = new Date(Date.parse(ts[0].time) + 20 * 60_000);
  const base = baseFromMetNorway(j, { tz: 'America/New_York', units: 'metric', lat: 40.71, lon: -74.01, now });
  const first = ts[0].data.instant.details;
  assert.equal(base.current.temp, first.air_temperature);
  assert.equal(base.current.windKmh, Math.round(first.wind_speed * 3.6));
  assert.equal(base.current.humidity, Math.round(first.relative_humidity));
  assert.equal(base.current.code, metSymbolToWmo(ts[0].data.next_1_hours.summary.symbol_code));
  assert.equal(base.days[0].date, '2026-10-10');
  assert.ok(base.days.length >= 8, `days: ${base.days.length}`);
  for (const d of base.days) {
    assert.ok(d.min <= d.max);
    assert.equal(d.precipChance, null);
    assert.match(d.sunrise, /^\d{4}-\d\d-\d\dT0[67]:\d\d:\d\d-0[45]:00$/);
    assert.ok(Number.isInteger(d.code));
  }
  const w = localizeWeather(base, { lang: 'en', locationName: 'New York', forecastDays: 5, now });
  assert.equal(w.hourly.length, 8);
  assert.match(w.hourly[0].time, /-04:00$/);
  assert.equal(w.daily.length, 5);
  assert.equal(w.source.name, 'MET Norway');
  assert.equal(w.source.licence, 'CC BY 4.0');
});

test('met-norway: Oslo answer has precipitation probability; imperial converts °C to °F', () => {
  const j = json('met-norway-oslo.json');
  const ts = j.properties.timeseries;
  const now = new Date(Date.parse(ts[0].time));
  const metric = baseFromMetNorway(j, { tz: 'Europe/Oslo', lat: 59.91, lon: 10.75, now });
  assert.ok(metric.hourly.some((h) => h.precipChance > 0));
  assert.ok(metric.days[0].precipChance != null);
  const imperial = baseFromMetNorway(j, { tz: 'Europe/Oslo', units: 'imperial', lat: 59.91, lon: 10.75, now });
  assert.equal(imperial.current.temp, Math.round((ts[0].data.instant.details.air_temperature * 9 / 5 + 32) * 10) / 10);
  assert.equal(imperial.current.windKmh, metric.current.windKmh); // wind stays km/h, the display converts it
});

test('met-norway: symbol codes map to WMO codes the icons know', () => {
  assert.equal(metSymbolToWmo('clearsky_day'), 0);
  assert.equal(metSymbolToWmo('fair_night'), 1);
  assert.equal(metSymbolToWmo('partlycloudy_polartwilight'), 2);
  assert.equal(metSymbolToWmo('cloudy'), 3);
  assert.equal(metSymbolToWmo('fog'), 45);
  assert.equal(metSymbolToWmo('lightrain'), 61);
  assert.equal(metSymbolToWmo('heavyrainshowers_day'), 82);
  assert.equal(metSymbolToWmo('sleet'), 68);
  assert.equal(metSymbolToWmo('heavysleetshowers_night'), 69);
  assert.equal(metSymbolToWmo('snow'), 73);
  assert.equal(metSymbolToWmo('rainshowersandthunder_day'), 95);
  assert.equal(metSymbolToWmo('heavysnowandthunder'), 95);
  assert.equal(metSymbolToWmo('unknownsymbol'), null);
  assert.equal(metSymbolToWmo(undefined), null);
  assert.equal(wmoDescription(68, 'es'), 'Aguanieve');
});

test('met-norway: URL keeps at most 4 decimals', () => {
  assert.equal(metNorwayUrl(38.722345678, -9.139312), 'https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=38.7223&lon=-9.1393');
});

test('met-norway fetch: identifying User-Agent, Expires honoured, If-Modified-Since and 304', async () => {
  const body = json('met-norway-oslo.json');
  const now = new Date(Date.parse(body.properties.timeseries[0].time) + 5 * 60_000);
  const expires = new Date(now.getTime() + 31 * 60_000).toUTCString();
  const lastModified = 'Sat, 10 Oct 2026 13:47:21 GMT';
  const f = fakeFetch((url, init) => (init.headers['If-Modified-Since'] ? { status: 304, headers: { expires } } : { body, headers: { expires, 'last-modified': lastModified } }));
  const r = weatherRequest({ provider: 'met-norway', lat: 59.9139, lon: 10.7522, units: 'metric' }, { tz: 'Europe/Oslo', forecastDays: 5 });
  const e = await fetchWeather(r, { fetch: f, userAgent: 'Marco/test (+https://github.com/mr-reb00t/marco)', now: () => now });
  assert.match(f.calls[0].headers['User-Agent'], /^Marco\/test/);
  assert.equal(f.calls[0].url, 'https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=59.91&lon=10.75');
  assert.equal(e.lastModified, lastModified);
  assert.equal(e.expiresAt, Date.parse(expires) - (Date.parse(expires) % 1000)); // Expires is longer than the 10 min minimum
  const again = await fetchWeather(r, { fetch: f, prev: e, now: () => new Date(now.getTime() + 40 * 60_000) });
  assert.equal(f.calls[1].headers['If-Modified-Since'], lastModified);
  assert.deepEqual(again.base.current, e.base.current);
  assert.equal(again.lastModified, lastModified);
});

// --------------------------------------------------------------------------------------------- Pirate Weather

test('pirate-weather: docs sample → fractions to %, local dates, sun times from the answer', () => {
  const j = json('pirate-weather-docs-sample.json');
  const now = new Date(j.currently.time * 1000);
  const base = basePirateWeather(j, { tz: 'America/Toronto', units: 'metric', now });
  assert.equal(base.current.temp, -0.9);
  assert.equal(base.current.feelsLike, -6.8);
  assert.equal(base.current.humidity, 82);
  assert.equal(base.current.windKmh, 18);
  assert.equal(base.current.code, 73);
  assert.equal(base.current.uv, 0.4);
  assert.deepEqual(base.days.map((d) => d.date), ['2025-11-09', '2025-11-10', '2025-11-11']);
  assert.deepEqual(base.days.map((d) => d.code), [68, 45, 0]);
  assert.equal(base.days[0].precipChance, 100);
  assert.equal(base.days[0].sunrise, '2025-11-09T06:48:23-05:00');
  assert.equal(base.hourly[0].precipChance, 47);
  assert.equal(base.hourly[9].code, 0); // "breezy" with a clear sky
  const w = localizeWeather(base, { lang: 'es', forecastDays: 7, now });
  assert.equal(w.current.description, 'Nevada');
  assert.equal(w.source.name, 'Pirate Weather');
});

test('pirate-weather: imperial answers carry mph, stored as km/h', () => {
  const j = json('pirate-weather-docs-sample.json');
  const base = basePirateWeather(j, { tz: 'America/Toronto', units: 'imperial', now: new Date(j.currently.time * 1000) });
  assert.equal(base.current.windKmh, Math.round(17.73 * 1.609344));
  assert.match(pirateWeatherUrl('abc', 40.71, -74.01, 'imperial'), /units=us/);
  assert.match(pirateWeatherUrl('abc', 40.71, -74.01, 'metric'), /units=ca.*icon=pirate/);
});

test('pirate-weather: icon table', () => {
  assert.equal(pirateIconToWmo('clear-day'), 0);
  assert.equal(pirateIconToWmo('mostly-clear-night'), 1);
  assert.equal(pirateIconToWmo('partly-cloudy-day'), 2);
  assert.equal(pirateIconToWmo('cloudy'), 3);
  assert.equal(pirateIconToWmo('light-rain'), 61);
  assert.equal(pirateIconToWmo('heavy-rain'), 65);
  assert.equal(pirateIconToWmo('possible-rain-day'), 80);
  assert.equal(pirateIconToWmo('heavy-sleet'), 69);
  assert.equal(pirateIconToWmo('thunderstorm'), 95);
  assert.equal(pirateIconToWmo('wind', 0.9), 3);
  assert.equal(pirateIconToWmo('dangerous-wind', 0.05), 0);
  assert.equal(pirateIconToWmo('none'), null);
});

test('pirate-weather fetch: no key, refused key, rate limit', async () => {
  const r = weatherRequest({ provider: 'pirate-weather', lat: 40.7128, lon: -74.006, units: 'metric' }, { tz: 'America/New_York', forecastDays: 5 });
  await assert.rejects(fetchWeather(r, { fetch: fakeFetch(() => ({ body: {} })) }), (e) => e instanceof WeatherError && e.code === 'key_missing');
  const withKey = { ...r, apiKey: 'abcdefgh1234' };
  const refused = fakeFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }));
  await assert.rejects(fetchWeather(withKey, { fetch: refused }), (e) => e.code === 'key_invalid');
  assert.match(refused.calls[0].url, /^https:\/\/api\.pirateweather\.net\/forecast\/abcdefgh1234\/40\.71,-74\.01\?/);
  await assert.rejects(fetchWeather(withKey, { fetch: fakeFetch(() => ({ status: 429 })) }), (e) => e.code === 'rate_limited');
  assert.deepEqual(await tryWeatherKey(withKey, { fetch: refused }), { ok: false, entry: null });
  assert.equal((await tryWeatherKey(withKey, { fetch: fakeFetch(() => ({ status: 503 })) })).ok, null);
  const good = await tryWeatherKey(withKey, { fetch: fakeFetch(() => ({ body: json('pirate-weather-docs-sample.json') })) });
  assert.equal(good.ok, true);
  assert.equal(good.entry.base.provider, 'pirate-weather');
  // the key never appears in an error message
  try {
    await fetchWeather(withKey, { fetch: async () => { throw new TypeError('fetch failed'); } });
  } catch (err) {
    assert.ok(!err.message.includes('abcdefgh1234'));
  }
  assert.deepEqual(weatherKeyStatus('abcdefgh1234'), { set: true, hint: '1234' });
  assert.deepEqual(weatherKeyStatus(''), { set: false, hint: '' });
});

// --------------------------------------------------------------------------------------------- shared

test('sun times: within 2 minutes of Open-Meteo, polar day and night', () => {
  const j = json('open-meteo-lisbon.json');
  const s = sunTimes(j.daily.time[0], 38.72, -9.14);
  const om = Date.parse(`${j.daily.sunrise[0]}:00+01:00`);
  assert.ok(Math.abs(s.sunrise.getTime() - om) < 2 * 60_000, `${s.sunrise.toISOString()} vs ${new Date(om).toISOString()}`);
  assert.ok(Math.abs(s.sunset.getTime() - Date.parse(`${j.daily.sunset[0]}:00+01:00`)) < 2 * 60_000);
  assert.equal(sunTimes('2026-06-21', 78.22, 15.65).polar, 'day'); // Longyearbyen
  assert.equal(sunTimes('2026-12-21', 78.22, 15.65).polar, 'night');
  assert.equal(isDayAt(new Date('2026-06-21T23:00:00Z'), 78.22, 15.65, 'Arctic/Longyearbyen'), true);
  assert.equal(isDayAt(new Date('2026-10-10T02:00:00Z'), 38.72, -9.14, 'Europe/Lisbon'), false);
});

test('requests: rounded places share one cache key; a key provider is keyed by its key', () => {
  const a = weatherRequest({ provider: 'open-meteo', model: 'best_match', lat: 38.7223, lon: -9.1393, units: 'metric' }, { tz: 'Europe/Lisbon', forecastDays: 5 });
  const b = weatherRequest({ provider: 'open-meteo', model: 'best_match', lat: 38.7189, lon: -9.1411, units: 'metric' }, { tz: 'Europe/Lisbon', forecastDays: 3 });
  assert.equal(a.lat, 38.72);
  assert.equal(weatherCacheKey(a), weatherCacheKey(b));
  assert.equal(fetchDays(1), 8);
  assert.equal(fetchDays(14), 15);
  const ha = weatherRequest({ provider: 'homeassistant', model: 'icon_seamless', lat: 1, lon: 2, units: 'metric' }, { tz: 'UTC', forecastDays: 5 });
  assert.equal(ha.provider, 'open-meteo');
  assert.equal(ha.model, 'icon_seamless');
  const met = weatherRequest({ provider: 'met-norway', model: 'icon_seamless', lat: 1, lon: 2, units: 'metric' }, { tz: 'UTC', forecastDays: 5, apiKey: 'x' });
  assert.equal(met.model, null);
  assert.equal(met.apiKey, '');
  const p1 = weatherRequest({ provider: 'pirate-weather', lat: 1, lon: 2, units: 'metric' }, { tz: 'UTC', forecastDays: 5, apiKey: 'key-one-123' });
  const p2 = weatherRequest({ provider: 'pirate-weather', lat: 1, lon: 2, units: 'metric' }, { tz: 'UTC', forecastDays: 5, apiKey: 'key-two-456' });
  assert.notEqual(weatherCacheKey(p1), weatherCacheKey(p2));
  assert.ok(!weatherCacheKey(p1).includes('key-one-123'));
  assert.equal(roundCoord(-9.1393), -9.14);
});

test('validation: provider and model enums, defaults for old configs, the key check on admin saves', () => {
  const c = defaultConfig();
  assert.equal(c.weather.provider, 'open-meteo');
  assert.equal(c.weather.model, 'best_match');
  for (const p of [...WEATHER_PROVIDERS, 'homeassistant']) {
    const r = validateConfig({ ...c, weather: { ...c.weather, provider: p } });
    assert.equal(r.ok, true, `${p}: ${JSON.stringify(r.errors)}`);
  }
  for (const m of OPEN_METEO_MODEL_IDS) assert.equal(validateConfig({ ...c, weather: { ...c.weather, model: m } }).ok, true);
  const bad = validateConfig({ ...c, weather: { ...c.weather, provider: 'accuweather', model: 'ecmwf_ifs_025' } });
  assert.deepEqual(bad.errors.map((e) => e.path).sort(), ['weather.model', 'weather.provider']);
  // a config saved before 0.5 has no model
  const old = structuredClone(c);
  delete old.weather.model;
  assert.equal(validateConfig(mergeDefaults(old)).value.weather.model, 'best_match');
  // Pirate Weather without a stored key: refused on an admin save, accepted where keys are not checked (imports)
  const pirate = { ...c, weather: { ...c.weather, provider: 'pirate-weather' } };
  assert.deepEqual(validateConfig(pirate, { weatherKeySet: false }).errors.map((e) => e.path), ['weather.apiKey']);
  assert.equal(validateConfig(pirate, { weatherKeySet: true }).ok, true);
  assert.equal(validateConfig(pirate).ok, true);
  assert.equal(validateConfig(c, { weatherKeySet: false }).ok, true);
});

test('backups: the weather key travels only with secrets and only when well formed', () => {
  assert.deepEqual(exportSecrets({ weather: { apiKey: 'abc123XYZ' } }).weather, { apiKey: 'abc123XYZ' });
  assert.equal(exportSecrets({}).weather, undefined);
  assert.equal(sanitizeImportedSecrets({ weather: { apiKey: 'abc123XYZ' } }).weatherKey, 'abc123XYZ');
  assert.equal(sanitizeImportedSecrets({ weather: { apiKey: 'bad key; rm -rf' } }).weatherKey, undefined);
});

// --------------------------------------------------------------------------------------------- self-hosted cache

test('server/weather.js: one call for every language, cached until expiry, stale on error, key from secrets', async () => {
  const store = await import('../store.js');
  const weather = await import('../weather.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-weather-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.weather.provider = 'met-norway';
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({}));
  store.initStore(dir);
  let fail = false;
  // the fixture's forecast moved to start at this hour: getWeather reads "now" from the clock, and a forecast that
  // ended days ago has no current conditions
  const body = json('met-norway-oslo.json');
  const ts = body.properties.timeseries;
  const shift = Math.floor(Date.now() / 3_600_000) * 3_600_000 - Date.parse(ts[0].time);
  for (const t of ts) t.time = new Date(Date.parse(t.time) + shift).toISOString().replace('.000Z', 'Z');
  const f = fakeFetch(() => (fail ? { status: 500 } : { body, headers: { expires: new Date(Date.now() + 30 * 60_000).toUTCString(), 'last-modified': 'Sat, 10 Oct 2026 13:47:21 GMT' } }));
  weather.setWeatherFetch(f);
  try {
    const es = await weather.getWeather({ lang: 'es' });
    const en = await weather.getWeather({ lang: 'en' });
    assert.equal(f.calls.length, 1);
    assert.equal(es.source.provider, 'met-norway');
    assert.notEqual(es.current.description, en.current.description);
    assert.match(f.calls[0].headers['User-Agent'], /^Marco\/\d/);
    // force (the admin) still waits for MET Norway's Expires
    await weather.getWeather({ lang: 'es', force: true });
    assert.equal(f.calls.length, 1);
    assert.equal(weather.status.ok, true);
    assert.equal(weather.cachedWeather('pt').source.name, 'MET Norway');

    // Open-Meteo: a new place and provider, then a failure keeps the last answer
    store.saveConfig({ ...store.getConfig(), weather: { ...store.getConfig().weather, provider: 'open-meteo', model: 'gfs_seamless' } });
    const om = json('open-meteo-lisbon.json');
    const f2 = fakeFetch(() => (fail ? { status: 502 } : { body: om }));
    weather.setWeatherFetch(f2);
    const first = await weather.getWeather({ lang: 'en' });
    assert.match(f2.calls[0].url, /models=gfs_seamless/);
    assert.equal(first.source.modelName, 'NOAA GFS');
    fail = true;
    const again = await weather.getWeather({ lang: 'en', force: true });
    assert.equal(f2.calls.length, 2);
    assert.equal(again.current.temp, first.current.temp);
    assert.equal(weather.status.ok, false);
    assert.equal(weather.status.errorCode, 'http');
    fail = false;

    // Pirate Weather reads the key from secrets.json
    store.updateSecrets((s) => { s.weather = { apiKey: 'secretkey123' }; });
    store.saveConfig({ ...store.getConfig(), weather: { ...store.getConfig().weather, provider: 'pirate-weather' } });
    const f3 = fakeFetch(() => ({ body: json('pirate-weather-docs-sample.json') }));
    weather.setWeatherFetch(f3);
    const pw = await weather.getWeather({ lang: 'en' });
    assert.equal(pw.source.provider, 'pirate-weather');
    assert.match(f3.calls[0].url, /\/forecast\/secretkey123\//);
    assert.equal(weather.weatherKey(), 'secretkey123');
  } finally {
    weather.setWeatherFetch(null);
  }
});

test('admin API: weather key is stored, never sent back, checked once, and required to save Pirate Weather', async () => {
  const store = await import('../store.js');
  const weather = await import('../weather.js');
  const { ensurePassword, hashPassword } = await import('../auth.js');
  const { createApp } = await import('../app.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-weather-api-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dist, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>display</title>');
  fs.writeFileSync(path.join(dist, 'admin', 'index.html'), '<!doctype html><title>admin</title>');
  store.initStore(dir);
  await ensurePassword();
  const pirate = json('pirate-weather-docs-sample.json');
  const f = fakeFetch((url) => (url.includes('/forecast/goodkey1234/') ? { body: pirate } : { status: 401, body: { message: 'Unauthorized' } }));
  weather.setWeatherFetch(f);
  const app = createApp({ version: '0.5.0', dist });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json: j, text, setCookie: r.headers.getSetCookie?.() || [] };
  };
  try {
    const login = await call('POST', '/api/auth/login', { password: 'secret-pass-123' });
    assert.equal(login.status, 200);
    cookie = login.setCookie.map((x) => x.split(';')[0]).join('; ');
    assert.deepEqual((await call('GET', '/api/admin/weather/key')).json, { set: false, hint: '' });

    // choosing Pirate Weather without a key is refused
    const cfg = (await call('GET', '/api/admin/config')).json;
    const withPirate = { ...cfg, weather: { ...cfg.weather, provider: 'pirate-weather' } };
    const refused = await call('PUT', '/api/admin/config', withPirate);
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.json.details.map((d) => d.path), ['weather.apiKey']);

    // a key the provider refuses is not stored; a malformed one is not even tried
    assert.equal((await call('PUT', '/api/admin/weather/key', { key: 'badkey9876' })).status, 400);
    assert.equal((await call('PUT', '/api/admin/weather/key', { key: 'no spaces allowed' })).status, 400);
    const calls = f.calls.length;
    assert.equal(calls, 1);
    const ok = await call('PUT', '/api/admin/weather/key', { key: ' goodkey1234 ' });
    assert.deepEqual(ok.json, { set: true, hint: '1234', checked: true });
    assert.equal(store.getSecrets().weather.apiKey, 'goodkey1234');
    const got = await call('GET', '/api/admin/weather/key');
    assert.deepEqual(got.json, { set: true, hint: '1234' });
    assert.ok(!got.text.includes('goodkey1234'));
    assert.ok(!(await call('GET', '/api/admin/config')).text.includes('goodkey1234'));

    // now it saves, and the display weather comes from Pirate Weather (the check's answer is reused)
    assert.equal((await call('PUT', '/api/admin/config', withPirate)).status, 200);
    const status = (await call('GET', '/api/admin/status')).json;
    assert.equal(typeof status.weather, 'object');
    assert.equal((await call('PUT', '/api/admin/weather/key', { key: '' })).json.set, false);
  } finally {
    weather.setWeatherFetch(null);
    await new Promise((resolve) => server.close(resolve));
  }
});
