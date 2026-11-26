// Mealie as the source of the week's meals (#50): the pure mapping (core/mealieCore.js), the overlay on Marco's own
// plan (familyCore.js), the validator (configs without Mealie stay byte-identical), and the client, the cache, the
// photo proxy and the admin endpoints through the real app against a fake Mealie (server/test/fakeMealie.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { exportSecrets, sanitizeImportedSecrets } from '../core/backupsCore.js';
import { defaultFamily, displayFamily, mealsForDate, mealsOfWeek, phoneFamily, sanitizeFamily, sanitizeState } from '../core/familyCore.js';
import {
  clampText, entryText, mealieOverlay, mealieTokenStatus, normalizeMealieUrl, overlayMealCount, parseMealieVersion,
} from '../core/mealieCore.js';
import * as mealie from '../mealie.js';
import { hashPassword, ensurePassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPrivacy } from '../privacy.js';
import { _resetFamily, familyClock } from '../family.js';
import { syncDisplayKeys, displayKeyFor } from '../displayAccess.js';
import { addDays } from '../core/lib/tz.js';
import { FEATURE_KEYS, selfHostedFeatures } from '../capabilities.js';
import { fakeMealie, entry, recipeId, WEBP } from './fakeMealie.js';

const TOKEN = 'tok.en-0123456789abcdef';
const realFetch = globalThis.fetch;

// ---------------------------------------------------------------------------------------------------------------
// pure rules

test('mealieCore: URL, version, token status, entry text and clamp', () => {
  assert.equal(normalizeMealieUrl(' http://mealie.local:9925/api/ '), 'http://mealie.local:9925');
  assert.equal(normalizeMealieUrl('https://m.example.com//'), 'https://m.example.com');
  assert.deepEqual(parseMealieVersion('v3.31.0'), { major: 3, text: '3.31.0' });
  assert.deepEqual(parseMealieVersion('1.12'), { major: 1, text: '1.12.0' });
  assert.equal(parseMealieVersion('nightly'), null);
  assert.deepEqual(mealieTokenStatus(''), { set: false, hint: '' });
  assert.deepEqual(mealieTokenStatus(TOKEN), { set: true, hint: 'cdef' });
  assert.equal(entryText({ title: ' Pizza night ', recipe: null }), 'Pizza night');
  assert.equal(entryText({ title: 'ignored', recipe: { name: '  Tacos\n' } }), 'Tacos');
  assert.equal(entryText({ title: '   ', recipe: { name: '' } }), '');
  assert.equal(clampText('x'.repeat(130)).length, 120);
  assert.ok(clampText('x'.repeat(130)).endsWith('…'));
});

test('mealieOverlay: slots, sides and desserts after the dinner, " · ", photo of the first dinner with a picture', () => {
  const D1 = '2026-11-26', D2 = '2026-11-27', D3 = '2026-11-28', D4 = '2026-11-29';
  const items = [
    entry(D1, 'dinner', { id: 5, recipe: { n: 1, name: 'Spaghetti Bolognese', image: 'Atup' } }),
    entry(D1, 'side', { id: 6, title: 'Green salad' }),
    entry(D1, 'breakfast', { id: 7, recipe: { n: 2, name: 'Pancakes', image: null } }),
    entry(D2, 'dessert', { id: 8, title: 'Apple pie' }),
    entry(D2, 'dinner', { id: 9, recipe: { n: 3, name: 'Chicken Tacos', image: '' } }),
    entry(D2, 'drink', { id: 10, title: 'Lemonade' }),
    entry(D3, 'lunch', { id: 11, title: 'Leftovers', text: 'from Friday' }),
    entry(D3, 'lunch', { id: 12, title: 'Bread' }),
    entry(D3, 'snack', { id: 13, title: 'Fruit' }),
    entry(D3, 'dessert', { id: 14, title: 'Ice cream' }),
    entry(D4, 'dinner', { id: 15, title: 'Pizza night' }),
    entry(D4, 'dinner', { id: 16, recipe: { n: 4, name: 'Soup', image: 'Xy9z' } }),
    entry(D4, 'brunch', { id: 17, title: 'Unknown type' }),
    entry(D4, 'lunch', { id: 18, title: '   ' }),
    entry('2026-12-30', 'dinner', { id: 19, title: 'Outside the window' }),
    { nonsense: true }, null, 'x',
  ];
  const { overlay, count } = mealieOverlay(items.reverse(), { from: D1, to: '2026-12-10' });
  assert.deepEqual(overlay[D1], {
    breakfast: 'Pancakes',
    dinner: 'Spaghetti Bolognese · Green salad',
    photo: { id: recipeId(1), v: 'Atup' },
  });
  assert.deepEqual(overlay[D2], { dinner: 'Chicken Tacos · Lemonade · Apple pie' }, 'no picture, no photo; drinks before desserts');
  assert.deepEqual(overlay[D3], { lunch: 'Leftovers · Bread', snack: 'Fruit', dinner: 'Ice cream' }, 'a dessert without a dinner is the dinner');
  assert.deepEqual(overlay[D4], { dinner: 'Pizza night · Soup', photo: { id: recipeId(4), v: 'Xy9z' } }, 'the first dinner with a picture');
  assert.equal(overlay['2026-12-30'], undefined);
  assert.equal(count, 12);
  assert.equal(overlayMealCount(overlay), 7);
  assert.equal(overlayMealCount(overlay, { from: D3, to: D3 }), 3);
  // a long day is cut at 120 characters
  const long = mealieOverlay([entry(D1, 'dinner', { title: 'a'.repeat(80) }), entry(D1, 'side', { title: 'b'.repeat(80) })]).overlay;
  assert.equal(long[D1].dinner.length, 120);
  // endDate: every day through it
  const span = mealieOverlay([entry(D1, 'lunch', { title: 'Camp food', endDate: D3 })]).overlay;
  assert.deepEqual(Object.keys(span), [D1, D2, D3]);
  // odd photo keys and recipe ids are left out
  assert.equal(mealieOverlay([{ date: D1, entryType: 'dinner', recipe: { id: '../../etc', name: 'X', image: 'k' } }]).overlay[D1].photo, undefined);
  assert.equal(mealieOverlay([entry(D1, 'dinner', { recipe: { n: 9, name: 'Y', image: 'a/b' } })]).overlay[D1].photo, undefined);
});

test('mealsForDate / mealsOfWeek: Mealie wins per meal, the rest is Marco\'s plan, only enabled slots', () => {
  const meals = {
    enabled: true, slots: ['breakfast', 'lunch', 'dinner'], useTemplate: true,
    template: { 4: { breakfast: 'Tostadas', lunch: 'Lentejas', dinner: 'Tortilla', snack: 'Yogur' } }, weeks: {},
  };
  const thu = '2026-11-26';
  assert.deepEqual(mealsForDate(meals, thu), { breakfast: 'Tostadas', lunch: 'Lentejas', dinner: 'Tortilla' });
  assert.deepEqual(mealsForDate(meals, thu, null), mealsForDate(meals, thu));
  const overlay = { [thu]: { dinner: 'Spaghetti', snack: 'Cookies', photo: { id: recipeId(1), v: 'k' } } };
  assert.deepEqual(mealsForDate(meals, thu, overlay), { breakfast: 'Tostadas', lunch: 'Lentejas', dinner: 'Spaghetti' }, 'snack is off');
  // a week with its own (empty) day: Mealie still fills it
  const own = { ...meals, weeks: { '2026-W48': { 4: { lunch: 'Paella' } } } };
  assert.deepEqual(mealsForDate(own, thu, overlay), { lunch: 'Paella', dinner: 'Spaghetti' });
  const week = mealsOfWeek(meals, '2026-11-23', overlay);
  assert.equal(week.length, 7);
  assert.deepEqual(week[3].meals.dinner, 'Spaghetti');
  assert.deepEqual(mealsOfWeek(meals, '2026-11-23'), mealsOfWeek(meals, '2026-11-23', {}));
});

test('displayFamily: the dinner photo only with the setting on, dinner shown and photos not hidden; phone gets the meals', () => {
  const cfg = { family: { ...defaultFamily(), enabled: true, meals: { ...defaultFamily().meals, enabled: true } } };
  const screen = { id: 's', calendar: { weekStart: 1 }, privacy: { hidePhotos: true } };
  const state = sanitizeState(null);
  const today = '2026-11-26';
  const overlay = { [today]: { dinner: 'Spaghetti', photo: { id: recipeId(1), v: 'Atup' } } };
  const day = (o) => displayFamily(cfg, screen, state, { today, mealOverlay: overlay, ...o }).meals.days.find((d) => d.date === today);
  assert.deepEqual(day({}), { date: today, dow: 4, meals: { dinner: 'Spaghetti' }, photo: `/media/mealie/${recipeId(1)}?v=Atup` });
  assert.equal(day({ private: true }).photo, undefined, 'private with hide photos');
  assert.equal(displayFamily(cfg, { ...screen, privacy: { hidePhotos: false } }, state, { today, mealOverlay: overlay, private: true }).meals.days[3].photo, `/media/mealie/${recipeId(1)}?v=Atup`);
  cfg.family.meals.mealie = { url: 'http://m', photo: false };
  assert.equal(day({}).photo, undefined, 'photo turned off');
  delete cfg.family.meals.mealie;
  cfg.family.meals.slots = ['breakfast', 'lunch'];
  assert.equal(day({}).photo, undefined, 'dinner not shown');
  assert.deepEqual(day({}).meals, {});
  cfg.family.meals.slots = ['dinner'];
  assert.equal(displayFamily(cfg, screen, state, { today }).meals.days[3].photo, undefined, 'no overlay, no photo');
  assert.deepEqual(phoneFamily(cfg, state, { today, mealOverlay: overlay }).meals.today, { dinner: 'Spaghetti' });
});

test('validator: Mealie settings are written only when set, old configs validate byte-identical', () => {
  const c = defaultConfig();
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal('mealie' in r.value.family.meals, false);
  const again = validateConfig(JSON.parse(JSON.stringify(r.value)));
  assert.equal(JSON.stringify(again.value), JSON.stringify(r.value));
  const fam = { ...defaultFamily(), meals: { enabled: true, slots: ['dinner'], useTemplate: false, template: {}, weeks: { '2026-W48': { 4: { dinner: 'Sopa' } } } } };
  const errs = [];
  const out = sanitizeFamily(fam, (p, m) => errs.push([p, m]));
  assert.deepEqual(errs, []);
  assert.equal(JSON.stringify(out.meals), JSON.stringify(fam.meals), 'a meal plan without Mealie stays as it was');

  const set = (mm) => {
    const x = defaultConfig();
    x.family.meals.mealie = mm;
    return validateConfig(x);
  };
  assert.deepEqual(set({ url: 'http://mealie.local:9925/api/' }).value.family.meals.mealie, { url: 'http://mealie.local:9925' });
  assert.deepEqual(set({ url: 'http://m.local', photo: false }).value.family.meals.mealie, { url: 'http://m.local', photo: false });
  assert.deepEqual(set({ url: '', photo: false }).value.family.meals.mealie, { url: '', photo: false });
  assert.equal('mealie' in set({ url: '', photo: true }).value.family.meals, false);
  assert.equal('mealie' in set({ url: '  ' }).value.family.meals, false);
  assert.ok(set({ url: 'ftp://m.local' }).errors.some((e) => e.path === 'family.meals.mealie.url'));
  assert.ok(set({ url: 'http://user:pw@m.local' }).errors.some((e) => e.path === 'family.meals.mealie.url'));
  assert.ok(set('nope').errors.some((e) => e.path === 'family.meals.mealie'));
  assert.ok(set({ url: 'http://m', photo: 'no' }).errors.some((e) => e.path === 'family.meals.mealie.photo'));
});

test('capabilities: mealie is on for self-hosted servers', () => {
  assert.ok(FEATURE_KEYS.includes('mealie'));
  assert.equal(selfHostedFeatures().mealie, true);
});

test('backups: the Mealie token goes with its address, only when well formed', () => {
  assert.equal(exportSecrets({}).mealie, undefined);
  assert.deepEqual(exportSecrets({ mealie: { token: TOKEN, url: 'http://m.local' } }).mealie, { token: TOKEN, url: 'http://m.local' });
  assert.deepEqual(sanitizeImportedSecrets({ mealie: { token: TOKEN, url: 'http://m.local/' } }).mealie, { token: TOKEN, url: 'http://m.local' });
  assert.equal(sanitizeImportedSecrets({ mealie: { token: 'bad token!', url: 'http://m.local' } }).mealie, undefined);
  assert.equal(sanitizeImportedSecrets({ mealie: { token: TOKEN, url: 'javascript:alert(1)' } }).mealie, undefined);
});

// ---------------------------------------------------------------------------------------------------------------
// through the real app

/** The plan around `today`: a dinner with a photo and a side today, a breakfast, tacos and a dessert tomorrow. */
function plan(today) {
  const tmr = addDays(today, 1);
  return [
    entry(today, 'dinner', { recipe: { n: 1, name: 'Spaghetti Bolognese', image: 'Atup' } }),
    entry(today, 'side', { title: 'Green salad' }),
    entry(today, 'breakfast', { recipe: { n: 2, name: 'Pancakes' } }),
    entry(tmr, 'dinner', { recipe: { n: 3, name: 'Chicken Tacos' } }),
    entry(tmr, 'dessert', { title: 'Apple pie' }),
  ];
}

async function withApp(fn, { mutate, secrets = (url) => ({ mealie: { token: TOKEN, url } }), items = plan } = {}) {
  const fake = await fakeMealie({ token: TOKEN, images: { [recipeId(1)]: WEBP } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-mealie-'));
  globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'private';
  c.family = {
    ...defaultFamily(),
    enabled: true,
    members: [{ id: 'm_lucia', name: 'Lucía', avatar: '🦊', kid: true }],
    meals: { enabled: true, slots: ['breakfast', 'lunch', 'dinner'], useTemplate: true, template: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { lunch: 'Lentejas', dinner: 'Tortilla' }])), weeks: {}, mealie: { url: `${fake.url}/` } },
  };
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  mutate?.(c, fake);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false, ...secrets(fake.url) }));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dist, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>display</title>');
  fs.writeFileSync(path.join(dist, 'admin', 'index.html'), '<!doctype html><title>admin</title>');
  store.initStore(dir);
  mealie._resetMealie();
  _resetFamily();
  _resetDisplays();
  _resetPrivacy();
  syncDisplayKeys();
  setServerVersion('0.6.1');
  await ensurePassword();
  const today = familyClock().today;
  fake.state.items = items(today);
  const app = createApp({ version: '0.6.1', dist });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const k = displayKeyFor(c.screens[0].id);
  const call = async (method, url, { body, cookie = '', key = '' } = {}) => {
    const r = await realFetch(base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(key ? { 'x-marco-key': key } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
    return { status: r.status, json, buf, text: buf.toString('utf8'), headers: r.headers };
  };
  const login = async () => {
    const r = await realFetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret-pass-123' }) });
    assert.equal(r.status, 200);
    return (r.headers.getSetCookie?.() || []).map((x) => x.split(';')[0]).join('; ');
  };
  const family = async (key = k) => (await call('GET', '/api/display/family', { key })).json;
  const todayOf = (st) => st.meals.days.find((d) => d.date === today);
  try {
    await fn({ call, login, family, todayOf, fake, dir, k, today, base });
  } finally {
    closeAll();
    _resetPrivacy();
    mealie._resetMealie();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await fake.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
}

test('display: Mealie meals replace Marco\'s per meal, the photo is served, the token never leaves the server', async () => {
  await withApp(async ({ call, login, family, todayOf, fake, k, today }) => {
    // the first ask starts the read; the screen gets Marco's plan meanwhile
    assert.deepEqual(todayOf(await family()).meals, { lunch: 'Lentejas', dinner: 'Tortilla' });
    await mealie.refreshMealie();
    const st = await family();
    const day = todayOf(st);
    assert.deepEqual(day.meals, { breakfast: 'Pancakes', lunch: 'Lentejas', dinner: 'Spaghetti Bolognese · Green salad' });
    assert.equal(day.photo, `/media/mealie/${recipeId(1)}?v=Atup`);
    const tmr = st.meals.days.find((d) => d.date === addDays(today, 1));
    if (tmr) assert.deepEqual(tmr.meals, { lunch: 'Lentejas', dinner: 'Chicken Tacos · Apple pie' });
    // the window read: 6 days back, 13 ahead, with the token in the header only
    const h = fake.hits.find((x) => x.path === '/api/households/mealplans');
    assert.deepEqual([h.query.start_date, h.query.end_date, h.query.perPage, h.auth], [addDays(today, -6), addDays(today, 13), '100', `Bearer ${TOKEN}`]);
    // the photo: through the proxy with the display key, cached
    const img = await call('GET', `${day.photo}&k=${k}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/webp');
    assert.match(img.headers.get('cache-control'), /private, max-age=86400/);
    assert.ok(img.buf.equals(WEBP));
    const before = fake.count(/\/images\//);
    assert.equal((await call('GET', `${day.photo}&k=${k}`)).status, 200);
    assert.equal(fake.count(/\/images\//), before, 'served from memory');
    // never an open proxy: unknown recipes, odd ids, no credential
    assert.equal((await call('GET', `/media/mealie/${recipeId(3)}?k=${k}`)).status, 404, 'a recipe in the plan without a photo');
    assert.equal((await call('GET', `/media/mealie/${recipeId(77)}?k=${k}`)).status, 404);
    assert.equal((await call('GET', `/media/mealie/..%2f..%2fapi%2fusers%2fself?k=${k}`)).status, 404);
    assert.equal((await call('GET', `/media/mealie/${recipeId(1)}`)).status, 401);
    assert.equal(fake.count(/\/images\//), before);
    // the token is nowhere a display or the admin can read
    for (const r of [await call('GET', '/api/display/family', { key: k }), await call('GET', '/api/display/config', { key: k })]) assert.ok(!r.text.includes(TOKEN));
    const cookie = await login();
    const adminCfg = await call('GET', '/api/admin/config', { cookie });
    assert.ok(!adminCfg.text.includes(TOKEN));
    assert.equal(adminCfg.json.family.meals.mealie.url, fake.url, 'the URL is saved without the trailing slash');
    const tok = await call('GET', '/api/admin/mealie/token', { cookie });
    assert.deepEqual(tok.json, { set: true, hint: 'cdef', otherUrl: false });
    const status = await call('GET', '/api/admin/mealie/status', { cookie });
    assert.equal(status.json.usable, true);
    assert.equal(status.json.error, null);
    assert.ok(status.json.count >= 3);
    assert.ok(!status.text.includes(TOKEN));
  });
});

test('photo off, private with hide photos: no photo in the data and the proxy refuses', async () => {
  await withApp(async ({ call, login, family, todayOf, k }) => {
    await mealie.refreshMealie();
    const url = `/media/mealie/${recipeId(1)}?v=Atup&k=${k}`;
    assert.equal((await call('GET', url)).status, 200);
    const cookie = await login();
    assert.equal((await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: ['s_main', 's_kitchen'] }, cookie })).status, 200);
    assert.equal(todayOf(await family()).photo, undefined);
    assert.equal(todayOf(await family()).meals.dinner, 'Spaghetti Bolognese · Green salad', 'the meals stay');
    assert.equal((await call('GET', url)).status, 404);
    assert.equal((await call('POST', '/api/admin/privacy', { body: { mode: 'off', screens: ['s_main', 's_kitchen'] }, cookie })).status, 200);
    assert.equal((await call('GET', url)).status, 200);
    const cfg = structuredClone(store.getConfig());
    cfg.family.meals.mealie.photo = false;
    assert.equal(store.saveConfig(cfg).ok, true);
    await mealie.refreshMealie();
    assert.equal(todayOf(await family()).photo, undefined);
    assert.equal((await call('GET', url)).status, 404);
  }, { mutate: (c) => { for (const s of c.screens) s.privacy = { hidePhotos: true, showLock: true, schedule: [] }; } });
});

test('errors keep the last good meals: Mealie down, malformed JSON, a redirect (never followed)', async () => {
  await withApp(async ({ family, todayOf, fake }) => {
    await mealie.refreshMealie();
    const good = todayOf(await family()).meals;
    assert.equal(good.dinner, 'Spaghetti Bolognese · Green salad');
    for (const [flag, code] of [['down', 'unreachable'], ['malformed', 'bad_response'], ['redirect', 'redirect']]) {
      fake.state[flag] = true;
      await mealie.refreshMealie();
      fake.state[flag] = false;
      const st = mealie.mealieStatus();
      assert.equal(st.error, code, flag);
      assert.ok(st.updatedAt, 'the last good read stays');
      assert.deepEqual(todayOf(await family()).meals, good, flag);
    }
    assert.ok(!fake.hits.some((h) => h.path === '/steal'), 'the redirect is not followed');
    // failures are not retried at once by the displays' asks
    const n = fake.count(/mealplans/);
    mealie.mealieMeals();
    mealie.mealieMeals(Date.now() + mealie.TTL + 1);
    assert.equal(fake.count(/mealplans/), n);
    await mealie.refreshMealie();
    assert.equal(mealie.mealieStatus().error, null);
  });
});

test('pagination: every page up to the cap', async () => {
  await withApp(async ({ fake, today }) => {
    fake.state.items = Array.from({ length: 250 }, (_, i) => entry(addDays(today, i % 10), 'lunch', { title: `Dish ${i}` }));
    await mealie.refreshMealie();
    assert.equal(fake.count(/mealplans/), 3);
    assert.equal(mealie.mealieStatus().count, 250);
    fake.state.pages = 50;
    await mealie.refreshMealie();
    assert.equal(fake.count(/mealplans/), 3 + mealie.MAX_PAGES, 'capped');
  });
});

test('admin: test button, the token is write-only, checked and tied to its address', async () => {
  await withApp(async ({ call, login, fake, today }) => {
    const cookie = await login();
    const ok = await call('POST', '/api/admin/test/mealie', { body: { url: fake.url }, cookie });
    assert.deepEqual(ok.json, { ok: true, version: '3.31.0', count: 3 });
    // only the next two weeks count
    fake.state.items.push(entry(addDays(today, 20), 'dinner', { title: 'Later' }));
    assert.equal((await call('POST', '/api/admin/test/mealie', { body: {}, cookie })).json.count, 3);
    assert.deepEqual((await call('POST', '/api/admin/test/mealie', { body: { url: fake.url, token: 'wrong-token-0123456789' }, cookie })).json, { ok: false, version: '3.31.0', error: 'invalid_token' });
    assert.deepEqual((await call('POST', '/api/admin/test/mealie', { body: { url: 'ftp://x' }, cookie })).json, { ok: false, error: 'invalid_url' });
    // another address, no token typed: the saved token is not sent there
    const other = await fakeMealie({ token: TOKEN });
    try {
      const r = await call('POST', '/api/admin/test/mealie', { body: { url: other.url }, cookie });
      assert.deepEqual(r.json, { ok: false, version: '3.31.0', error: 'token_missing' });
      assert.ok(other.hits.every((h) => h.auth === ''));
    } finally {
      await other.stop();
    }
    // Mealie 1.x
    fake.state.version = 'v1.12.0';
    assert.equal((await call('POST', '/api/admin/test/mealie', { body: {}, cookie })).json.error, 'old_version');
    fake.state.version = 'v3.31.0';
    fake.state.households = false;
    assert.equal((await call('POST', '/api/admin/test/mealie', { body: {}, cookie })).json.error, 'old_version');
    fake.state.households = true;

    // PUT: a token Mealie refuses is not stored; the right one is, with the address
    assert.equal((await call('PUT', '/api/admin/mealie/token', { body: { token: 'has spaces in it' }, cookie })).status, 400);
    const wrong = await call('PUT', '/api/admin/mealie/token', { body: { token: 'wrong-token-0123456789' }, cookie });
    assert.deepEqual([wrong.status, wrong.json.error], [400, 'invalid_token']);
    assert.equal(store.getSecrets().mealie.token, TOKEN);
    fake.state.token = 'new.token-abcdefghijkl';
    const saved = await call('PUT', '/api/admin/mealie/token', { body: { token: 'new.token-abcdefghijkl', url: `${fake.url}/api` }, cookie });
    assert.deepEqual(saved.json, { set: true, hint: 'ijkl', otherUrl: false, checked: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(store.paths.secrets, 'utf8')).mealie, { token: 'new.token-abcdefghijkl', url: fake.url });
    await mealie.refreshMealie();
    assert.equal(fake.hits.at(-1).auth, 'Bearer new.token-abcdefghijkl');
    // the saved URL changes: the token stays for its own address and is not sent to the new one
    const cfg = structuredClone(store.getConfig());
    cfg.family.meals.mealie.url = 'http://127.0.0.1:9';
    assert.equal(store.saveConfig(cfg).ok, true);
    assert.equal((await call('GET', '/api/admin/mealie/token', { cookie })).json.otherUrl, true);
    assert.equal(mealie.mealieStatus().usable, false);
    assert.equal(mealie.mealieMeals(), null);
    // removing it
    assert.deepEqual((await call('PUT', '/api/admin/mealie/token', { body: { token: '' }, cookie })).json, { set: false, hint: '', otherUrl: false, checked: false });
    assert.equal(store.getSecrets().mealie, undefined);
  });
});

test('Mealie off: Familia, the menus or the token missing means no reads and Marco\'s own plan', async () => {
  await withApp(async ({ family, todayOf, fake, call, k }) => {
    await mealie.refreshMealie();
    assert.equal(fake.count(/mealplans/), 0);
    assert.deepEqual(todayOf(await family()).meals, { lunch: 'Lentejas', dinner: 'Tortilla' });
    assert.equal((await call('GET', `/media/mealie/${recipeId(1)}?k=${k}`)).status, 404);
  }, { secrets: () => ({}) });
});

test('an answer Mealie should never send is ignored: impossible dates, prototype names as meal types', () => {
  const items = [
    { id: 1, date: '2026-13-01', endDate: '2026-13-05', entryType: 'dinner', title: 'Nope' },
    { id: 2, date: '2026-00-01', entryType: 'lunch', title: 'Nope' },
    { id: 3, date: '2026-11-26', entryType: 'constructor', title: 'Nope' },
    { id: 4, date: '2026-11-26', entryType: '__proto__', title: 'Nope' },
    { id: 5, date: '2026-11-26', entryType: 'dinner', title: 'Soup' },
  ];
  const { overlay, count } = mealieOverlay(items, {});
  assert.equal(count, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(overlay)), { '2026-11-26': { dinner: 'Soup' } });
  assert.equal(Object.prototype.polluted, undefined);
});
