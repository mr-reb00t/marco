import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';

test('defaults are valid, ship no personal sources, only a public example + rules', () => {
  const { ok, errors, value } = validateConfig(defaultConfig());
  assert.equal(ok, true, JSON.stringify(errors));
  assert.equal(value.calendar.sources.length, 1);
  assert.ok(value.calendar.sources.find((s) => s.kind === 'holidays' && s.enabled && s.url.startsWith('https://calendar.google.com/')));
  assert.ok(!value.calendar.sources.some((s) => s.kind === 'airbnb'));
  assert.ok(value.calendar.iconRules.length >= 18);
  assert.equal(value.news.feeds[0].url, 'https://feeds.bbci.co.uk/news/world/rss.xml');
  assert.equal(value.weather.locationName, 'Lisbon, Portugal');
  assert.equal(value.screens[0].screen.language, 'en');
  assert.equal(value.version, 2);
  assert.equal(value.screens.length, 1);
  assert.equal(value.defaultScreen, value.screens[0].id);
  assert.deepEqual(value, defaultConfig());
});

test('invalid values are reported', () => {
  const c = defaultConfig();
  c.screens[0].screen.language = 'fr';
  c.screens[0].screen.accent = 'red';
  c.calendar.sources.push({ type: 'ics', name: 'Bad', url: 'javascript:alert(1)', color: '#fff' });
  c.calendar.sources.push({ type: 'google', name: 'G', color: '#abc' });
  c.weather.lat = 200;
  c.datetime.timezone = 'Mars/Olympus';
  c.calendar.iconRules.push({ match: [], emoji: '❓' });
  const badRule = `calendar.iconRules[${c.calendar.iconRules.length - 1}].match`;
  const { ok, errors } = validateConfig(c);
  assert.equal(ok, false);
  const p = errors.map((e) => e.path);
  for (const want of ['screens[0].screen.language', 'screens[0].screen.accent', 'calendar.sources[1].url', 'calendar.sources[2].googleAccount', 'weather.lat', 'datetime.timezone', badRule]) {
    assert.ok(p.includes(want), `missing error for ${want}: ${p}`);
  }
});

test('sanitisation: unknown keys dropped, ids generated & deduped, colors lowercased, strings coerced', () => {
  const c = defaultConfig();
  c.hacker = { x: 1 };
  c.calendar.sources = [
    { id: 'dup', type: 'ics', name: 'A', url: 'webcal://example.com/a.ics', color: '#ABCDEF', secret: 'x' },
    { id: 'dup', type: 'ics', name: 'B', url: 'https://example.com/b.ics', color: '#123' },
    { type: 'google', name: 'G', googleAccount: 'Me@Example.com', color: '#111111' },
  ];
  c.weather.lat = '38.5';
  const { ok, errors, value } = validateConfig(c);
  assert.equal(ok, true, JSON.stringify(errors));
  assert.equal(value.hacker, undefined);
  const [a, b, g] = value.calendar.sources;
  assert.equal(a.color, '#abcdef');
  assert.equal(a.secret, undefined);
  assert.equal(a.refreshMin, 5);
  assert.equal(a.insecureTls, false);
  assert.notEqual(a.id, b.id);
  assert.match(g.id, /^c_/);
  assert.equal(g.googleAccount, 'me@example.com');
  assert.equal(g.googleCalendarId, 'primary');
  assert.equal(value.weather.lat, 38.5);
});

test('microsoft sources: account and calendar id required, nothing else kept', () => {
  const c = defaultConfig();
  c.calendar.sources = [
    { type: 'microsoft', name: 'Outlook', microsoftAccount: ' Ana@Outlook.com ', microsoftCalendarId: 'AQMkADAwATM0MDAAMS1iZ', googleAccount: 'x@y.z', url: 'https://x', color: '#111111' },
  ];
  const { ok, errors, value } = validateConfig(c);
  assert.equal(ok, true, JSON.stringify(errors));
  const [m] = value.calendar.sources;
  assert.equal(m.type, 'microsoft');
  assert.equal(m.microsoftAccount, 'ana@outlook.com');
  assert.equal(m.microsoftCalendarId, 'AQMkADAwATM0MDAAMS1iZ');
  assert.equal(m.googleAccount, undefined);
  assert.equal(m.url, undefined);
  c.calendar.sources = [{ type: 'microsoft', name: 'Outlook', microsoftAccount: 'not-an-email', color: '#111111' }];
  const bad = validateConfig(c);
  assert.equal(bad.ok, false);
  const paths = bad.errors.map((e) => e.path);
  assert.ok(paths.includes('calendar.sources[0].microsoftAccount'), paths.join());
  assert.ok(paths.includes('calendar.sources[0].microsoftCalendarId'), paths.join());
});

test('mergeDefaults back-fills new keys but keeps stored arrays', () => {
  const stored = { revision: 7, screen: { name: 'Cocina' }, calendar: { sources: [] } };
  const m = mergeDefaults(stored);
  assert.equal(m.screens[0].name, 'Cocina');
  assert.equal(m.screens[0].screen.language, 'en');
  assert.deepEqual(m.calendar.sources, []);
  assert.ok(m.calendar.iconRules.length > 0);
  assert.equal(validateConfig(m).value.revision, 7);
});

test('store: first run writes defaults, save bumps revision atomically, secrets created', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-store-'));
  const store = await import('../store.js');
  store.initStore(dir);
  assert.ok(fs.existsSync(path.join(dir, 'config.json')));
  const secrets = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
  assert.ok(secrets.sessionSecret.length >= 32);
  const rev = store.getConfig().revision;
  const next = structuredClone(store.getConfig());
  next.screens[0].name = 'Entrada';
  const r = store.saveConfig(next);
  assert.equal(r.ok, true);
  assert.equal(store.getConfig().revision, rev + 1);
  const bad = structuredClone(store.getConfig());
  bad.screens[0].screen.theme = 'neon';
  assert.equal(store.saveConfig(bad).ok, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).screens[0].name, 'Entrada');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- v1 → v2 migration (docs/ARCHITECTURE.md)
const V1 = {
  version: 1, revision: 42,
  screen: { name: 'Cocina', language: 'pt', fontScale: 1.2, theme: 'light', accent: '#123456', orientation: 'portrait', customCss: 'a{}',
    nightMode: { enabled: true, from: '22:00', to: '06:30', dim: 0.2 } },
  layout: { preset: 'leftRight', sidePanel: 'right', sideWidth: 0.4 },
  background: { enabled: false, source: 'gallery', stockTopic: 'sea', intervalSec: 60, brightness: 0.5, showMeta: true, cover: false, transition: 'fade', ambient: 'none' },
  calendar: { enabled: true, view: 'week', weeks: 3, weekStart: 0, showLocation: true, showEndTime: true, showDayXofY: false, showLegend: false,
    hidePast: true, maxEventsPerDay: 6,
    sources: [{ id: 'c_x', type: 'ics', name: 'X', url: 'https://e.com/x.ics', color: '#111111', emoji: '', kind: 'generic', enabled: true, refreshMin: 10, insecureTls: true }],
    iconRules: [{ id: 'r1', match: ['foo'], emoji: '🦊', color: null }] },
  datetime: { enabled: false, timezone: 'Europe/Madrid', clock: 'analog', format24: false, showSeconds: false, showAmPm: true, dateFormat: 'weekday_month_d' },
  weather: { enabled: false, provider: 'open-meteo', locationName: 'Madrid', lat: 40.4, lon: -3.7, units: 'imperial', forecastDays: 3,
    showHourly: false, showPrecipChance: false, haWeatherEntity: '', haIndoorTempEntity: 'sensor.t', haIndoorHumidityEntity: '' },
  news: { enabled: false, feeds: [{ id: 'n9', name: 'F', url: 'https://e.com/rss', enabled: false }], rotateSec: 30, maxItems: 10 },
  todo: { enabled: true, items: [{ id: 't1', text: 'Pan', done: true }] },
  message: { enabled: true, text: 'Hola', emoji: '👋' },
  homeassistant: { enabled: true, url: 'http://ha:8123' },
  auth: { allowedGoogleEmails: ['a@b.co'], passwordLoginEnabled: false },
};

test('migration v1 → v2 keeps every value (global vs screens[0])', async () => {
  const { migrateConfig, isV1 } = await import('../core/validate.js');
  assert.equal(isV1(V1), true);
  const { ok, errors, value: v } = validateConfig(mergeDefaults(migrateConfig(structuredClone(V1))));
  assert.equal(ok, true, JSON.stringify(errors));
  assert.equal(v.version, 2);
  assert.equal(v.revision, 42);
  assert.equal(v.screens.length, 1);
  const s = v.screens[0];
  assert.equal(v.defaultScreen, s.id);
  assert.equal(s.name, 'Cocina');
  assert.equal(s.slug, 'cocina');
  const { name, ...scr } = V1.screen;
  // the display style is back-filled as classic, the Modern glass options and the pills under the date with their defaults
  assert.deepEqual(s.screen, { ...scr, style: 'classic', glass: { appearance: 'auto', opacity: 0.5, blur: 18, tint: 'dark', edge: true }, highlights: true });
  // v1 had no options for the newer layouts: they are back-filled with their defaults
  assert.deepEqual(s.layout, { ...V1.layout, people: null, corner: 'br', widgetId: null, plannerBar: 'side' });
  assert.deepEqual(s.background, { ...V1.background, order: 'random', panelBlur: 18, panelShade: 0.5, weatherFx: 'simple', portraitFit: 'auto', immich: { albumIds: [], favoritesOnly: false }, scope: 'side', calendarOpacity: 0.5, calendarBlur: 18 }); // new keys back-filled with defaults
  assert.deepEqual(s.message, V1.message);
  const { sources, iconRules, ...calView } = V1.calendar;
  // the motion options did not exist yet: both are back-filled on
  // compact busy days neither: it stays off for screens saved before it; events keep the one-line chips and the grid
  // keeps starting on the first day of the week
  assert.deepEqual(s.calendar, { ...calView, startOn: 'week', marquee: true, rotateBusyDays: true, compactBusyDays: false, eventStyle: 'lines', agendaDays: 'auto', sourceIds: null });
  // privacy mode did not exist yet: every source gets the default for its kind
  assert.deepEqual(v.calendar, { sources: sources.map((x) => ({ ...x, privacy: 'busy' })), iconRules });
  const { timezone, ...dtView } = V1.datetime;
  // v1 had no custom date pattern: it is back-filled with the default
  assert.deepEqual(s.datetime, { ...dtView, dateCustom: '{dddd}, {d} {mmmm} {yyyy}' });
  assert.deepEqual(v.datetime, { timezone });
  assert.deepEqual(s.weather, { enabled: false, forecastDays: 3, showHourly: false, showPrecipChance: false, place: null });
  assert.equal(v.weather.locationName, 'Madrid');
  assert.equal(v.weather.units, 'imperial');
  assert.equal(v.weather.haIndoorTempEntity, 'sensor.t');
  assert.deepEqual(s.news, { enabled: false, rotateSec: 30 });
  assert.deepEqual(v.news, { feeds: V1.news.feeds, maxItems: 10 });
  assert.deepEqual(s.todo, { enabled: true });
  assert.deepEqual(v.todo, { items: V1.todo.items });
  assert.deepEqual(v.homeassistant, { ...V1.homeassistant, doorbell: { camera: '', seconds: 60, screenIds: [], sound: true } });
  assert.deepEqual(v.auth, V1.auth);
  // validateConfig also accepts v1 directly (old clients / imports)
  assert.deepEqual(validateConfig(structuredClone(V1)).value.screens[0].layout, { ...V1.layout, people: null, corner: 'br', widgetId: null, plannerBar: 'side' });
  // already-v2 input is untouched
  assert.equal(migrateConfig(v), v);
});

test('store migrates a v1 file on load and keeps a pre-migration copy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-mig-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(V1));
  const store = await import('../store.js');
  store.initStore(dir);
  assert.equal(store.getConfig().screens[0].name, 'Cocina');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.equal(onDisk.version, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'backups', 'config-v1-premigration.json'), 'utf8')), V1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('screens: ids/slugs unique, unknown sourceIds dropped, defaultScreen fixed, flat view', async () => {
  const { flatView, resolveScreen, displayConfig } = await import('../core/screens.js');
  const c = defaultConfig();
  c.screens.push({ ...structuredClone(c.screens[0]), name: 'Living room 2' }); // same id + slug
  c.screens[1].calendar.sourceIds = ['c_holidays', 'nope', 'birthdays'];
  c.screens.push({ name: 'Entrada Principal' });
  c.defaultScreen = 'missing';
  const { value: v, errors } = validateConfig(c);
  assert.ok(errors.some((e) => e.path === 'defaultScreen'));
  assert.equal(new Set(v.screens.map((s) => s.id)).size, 3);
  assert.deepEqual(v.screens.map((s) => s.slug), ['living-room', 'living-room-2', 'entrada-principal']);
  assert.deepEqual(v.screens[1].calendar.sourceIds, ['c_holidays', 'birthdays']);
  assert.equal(v.defaultScreen, v.screens[0].id);
  assert.equal(resolveScreen(v, 'LIVING-ROOM-2').screen.id, v.screens[1].id);
  assert.equal(resolveScreen(v, 'zzz').fallback, true);
  const f = flatView(v, v.screens[2]);
  assert.equal(f.screen.name, 'Entrada Principal');
  assert.equal(f.datetime.timezone, 'Europe/Lisbon');
  assert.ok(Array.isArray(f.calendar.sources));
  const d = displayConfig(v, v.screens[1]);
  assert.deepEqual(d.calendar.sources.map((s) => s.id), ['c_holidays']); // birthdays has no items yet
  assert.equal(d.slug, 'living-room-2');
});

test('reserved source ids are never used by user sources', () => {
  const c = defaultConfig();
  c.calendar.sources[0].id = 'local';
  const { value } = validateConfig(c);
  assert.notEqual(value.calendar.sources[0].id, 'local');
});

test('background.order: default random, back-filled into stored screens, validated', () => {
  assert.equal(defaultConfig().screens[0].background.order, 'random');
  const stored = defaultConfig();
  delete stored.screens[0].background.order;
  const v = validateConfig(stored);
  assert.equal(v.ok, true);
  assert.equal(v.value.screens[0].background.order, 'random');
  stored.screens[0].background.order = 'name';
  assert.equal(validateConfig(stored).value.screens[0].background.order, 'name');
  stored.screens[0].background.order = 'oldest';
  const bad = validateConfig(stored);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /background\.order/.test(e.path)));
  // v1 / merged configs get it too
  assert.equal(validateConfig(mergeDefaults({ revision: 1, background: { source: 'gallery' } })).value.screens[0].background.order, 'random');
});

test('background.weatherFx: default simple, back-filled into stored screens, validated', () => {
  assert.equal(defaultConfig().screens[0].background.weatherFx, 'simple');
  const stored = defaultConfig();
  delete stored.screens[0].background.weatherFx;
  const v = validateConfig(stored);
  assert.equal(v.ok, true);
  assert.equal(v.value.screens[0].background.weatherFx, 'simple');
  for (const fx of ['off', 'simple', 'rich']) {
    stored.screens[0].background.weatherFx = fx;
    assert.equal(validateConfig(stored).value.screens[0].background.weatherFx, fx);
  }
  stored.screens[0].background.weatherFx = 'storm';
  const bad = validateConfig(stored);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /background\.weatherFx/.test(e.path)));
  assert.equal(validateConfig(mergeDefaults({ revision: 1, background: { source: 'gallery' } })).value.screens[0].background.weatherFx, 'simple');
});

test('icon rules merge stays within the validation limits (200 rules, 100 keywords per rule)', async () => {
  const store = await import('../store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-iconcap-'));
  try {
    const old = defaultConfig();
    const birthday = { id: 'r_birthday', match: Array.from({ length: 99 }, (_, i) => `kw${i}`), emoji: '🎈', color: null };
    const mine = Array.from({ length: 199 }, (_, i) => ({ id: `r_mine${i}`, match: [`word${i}`], emoji: '⭐', color: null }));
    old.calendar.iconRules = [birthday, ...mine];
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(old));
    store.initStore(dir);
    const rules = store.getConfig().calendar.iconRules;
    assert.equal(rules.length, 200); // no default rule appended past the limit
    assert.equal(rules[0].match.length, 100); // one keyword added, then the per-rule limit
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    const v = validateConfig(saved);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(v.value.calendar.iconRules.length, 200);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('icon rules v3: one-time additive merge into an existing config', async () => {
  const store = await import('../store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-iconrules-'));
  try {
    const old = defaultConfig();
    old.calendar.iconRules = [
      { id: 'r_mine', match: ['piano'], emoji: '🎻', color: '#112233' },
      { id: 'r_birthday', match: ['cumple'], emoji: '🎈', color: null },
    ];
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(old));
    store.initStore(dir);
    const rules = store.getConfig().calendar.iconRules;
    // the user's own rule keeps its place and content
    assert.deepEqual(rules[0], { id: 'r_mine', match: ['piano'], emoji: '🎻', color: '#112233' });
    // a kept default gains keywords but keeps the user's emoji
    assert.equal(rules[1].emoji, '🎈');
    assert.ok(rules[1].match.includes('birthday') && rules[1].match[0] === 'cumple');
    // new categories appended once
    assert.ok(rules.some((r) => r.id === 'r_swim'));
    assert.equal(rules.filter((r) => r.id === 'r_birthday').length, 1);
    assert.ok(fs.existsSync(path.join(dir, '.iconrules-v3')));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(saved.calendar.iconRules.length, rules.length);
    // the merge runs once: rules removed afterwards stay removed
    saved.calendar.iconRules = saved.calendar.iconRules.filter((r) => r.id !== 'r_swim');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(saved));
    store.initStore(dir);
    assert.ok(!store.getConfig().calendar.iconRules.some((r) => r.id === 'r_swim'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
