// Page bootstrap of a display (server/core/bootstrap.js): the block written into /d/<key>, the event windows the
// server guesses (the display's own eventsRange uses the same function), and the real app: the block carries what
// the display API answers for that key (the same privacy filtering), and nothing for an unknown key or before setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetActivityThrottle } from '../activity.js';
import { _resetPrivacy } from '../privacy.js';
import { syncDisplayKeys, listDisplayLinks, _resetDisplayAccess } from '../displayAccess.js';
import { addDays, localDate } from '../core/lib/tz.js';
import { loadWebModules } from './webModules.js';
import {
  AGENDA_AUTO_MAX_DAYS, AUTO_WEEKS_MAX, BOOT_ID, bootBlock, bootDataPaths, bootEventWindows, eventsPath, eventsWindow, injectBoot,
} from '../core/bootstrap.js';

const readBlock = (html) => {
  const m = new RegExp(`<script type="application/json" id="${BOOT_ID}">([\\s\\S]*?)</script>`).exec(html);
  return m ? JSON.parse(m[1]) : null;
};

test('the block is a JSON data block that cannot end the script element early', () => {
  const evil = { '/api/display/config': { screen: { name: '</script><script>alert(1)</script>' }, note: 'a b c' } };
  const block = bootBlock(evil);
  assert.match(block, /^<script type="application\/json" id="marco-boot">/);
  assert.equal(block.indexOf('</script>'), block.length - '</script>'.length);
  assert.ok(!block.includes(' ') && !block.includes(' '));
  assert.deepEqual(readBlock(block), { v: 1, data: evil });
  const html = injectBoot('<html><body><p>x</p></body></html>', { a: 1 });
  assert.match(html, /<p>x<\/p><script type="application\/json" id="marco-boot">.*<\/script><\/body><\/html>$/);
  assert.ok(injectBoot('<p>no body</p>', {}).startsWith('<p>no body</p><script'));
});

// The window the display asked for before it moved to core (web/display/main.ts eventsRange, 0.16).
function oldWindow(today, { weekStart = 1, startOn = 'week', weeks = 5, agenda = false, agendaDays = 14, canvasDays = 0 }) {
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  const from = startOn === 'today' ? today : addDays(today, -((wd - weekStart + 7) % 7));
  let to = addDays(from, Math.max((weeks === 'auto' ? 6 : weeks) * 7, 21) + 1);
  if (agenda) {
    const t = addDays(today, (agendaDays === 'auto' ? 60 : agendaDays) + 1);
    if (t > to) to = t;
  }
  if (canvasDays) {
    const t = addDays(today, canvasDays);
    if (t > to) to = t;
  }
  return [from, to];
}

test('eventsWindow is the window the display always asked for', () => {
  assert.equal(AUTO_WEEKS_MAX, 6);
  assert.equal(AGENDA_AUTO_MAX_DAYS, 60);
  for (const today of ['2026-10-18', '2026-10-19', '2026-12-31', '2027-02-27']) {
    for (const weekStart of [0, 1, 6]) {
      for (const startOn of ['week', 'today']) {
        for (const weeks of [1, 2, 3, 4, 5, 8, 'auto']) {
          for (const [agenda, agendaDays] of [[false, 14], [true, 7], [true, 30], [true, 'auto']]) {
            const o = { weekStart, startOn, weeks, agenda, agendaDays };
            assert.deepEqual(eventsWindow(today, o), oldWindow(today, o), JSON.stringify({ today, ...o }));
          }
        }
      }
    }
  }
  const canvas = { items: [{ id: 'a', kind: 'calendar.month', x: 0, y: 0, w: 8, h: 8, props: { weeks: 'auto' } }] };
  assert.deepEqual(eventsWindow('2026-10-18', { weeks: 2, canvas }), oldWindow('2026-10-18', { weeks: 2, canvasDays: 42 }));
});

test('bootEventWindows: the screen as saved, and the four-row window of small landscape screens', () => {
  const now = new Date('2026-10-18T10:00:00Z');
  const base = (cal, layout = { preset: 'bigCalendar' }, screen = { style: 'modern' }) =>
    ({ datetime: { timezone: 'Europe/Madrid' }, screen, layout, calendar: { weekStart: 1, startOn: 'week', view: 'month', agendaDays: 14, ...cal } });
  assert.deepEqual(bootEventWindows(base({ weeks: 5 }), now), [eventsWindow('2026-10-18', { weeks: 5 }), eventsWindow('2026-10-18', { weeks: 4 })]);
  assert.deepEqual(bootEventWindows(base({ weeks: 'auto' }), now), [eventsWindow('2026-10-18', { weeks: 'auto' })]);
  assert.deepEqual(bootEventWindows(base({ weeks: 3 }), now), [eventsWindow('2026-10-18', { weeks: 3 })]);
  // two weeks: two rows, the month view
  assert.deepEqual(bootEventWindows(base({ weeks: 6, view: 'agenda' }, { preset: 'twoWeeks' }), now), [eventsWindow('2026-10-18', { weeks: 2 })]);
  // the agenda layout or view looks further ahead
  assert.deepEqual(bootEventWindows(base({ weeks: 'auto', agendaDays: 'auto' }, { preset: 'agenda' }), now)[0],
    eventsWindow('2026-10-18', { weeks: 'auto', agenda: true, agendaDays: 'auto' }));
  // Personalizado only with the Modern style and a canvas; otherwise the big calendar
  const canvas = { items: [{ id: 'b', kind: 'birthdays', x: 0, y: 0, w: 4, h: 4, props: {} }] };
  assert.deepEqual(bootEventWindows({ ...base({ weeks: 'auto' }, { preset: 'canvas' }), canvas }, now)[0], eventsWindow('2026-10-18', { weeks: 'auto', canvas }));
  assert.deepEqual(bootEventWindows({ ...base({ weeks: 'auto' }, { preset: 'canvas' }, { style: 'classic' }), canvas }, now)[0], eventsWindow('2026-10-18', { weeks: 'auto' }));
  // the screen's day, in its time zone
  assert.equal(bootEventWindows(base({ weeks: 'auto', startOn: 'today' }), new Date('2026-10-18T23:30:00Z'))[0][0], '2026-10-19');
  assert.deepEqual(bootEventWindows(null), []);
});

test('bootDataPaths: the paths the display sends, a carousel screen named on each', () => {
  const now = new Date('2026-10-18T10:00:00Z');
  const cfg = { datetime: { timezone: 'Europe/Lisbon' }, screen: { style: 'modern' }, layout: { preset: 'bigCalendar' }, calendar: { weeks: 'auto' } };
  const w = eventsWindow('2026-10-18', { weeks: 'auto' });
  assert.deepEqual(bootDataPaths(cfg, now), ['/api/weather', '/api/countdowns', '/api/photos?count=20', '/api/news', eventsPath(w)]);
  assert.equal(eventsPath(w), `/api/events?from=${w[0]}&to=${w[1]}`);
  const car = { ...cfg, screenId: 's_a b', target: { kind: 'carousel', id: 'v_1' } };
  assert.deepEqual(bootDataPaths(car, now), [
    '/api/weather?screen=s_a%20b', '/api/countdowns?screen=s_a%20b', '/api/photos?count=20&screen=s_a%20b', '/api/news', `${eventsPath(w)}&screen=s_a%20b`,
  ]);
});

// ---------------------------------------------------------------- the real app

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
const PAGE = '<!doctype html><html><head><title>display</title></head><body><div id="app" class="booting"></div></body></html>';

async function withServer(fn, { setup = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-boot-'));
  globalThis.fetch = offlineFetch;
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'private';
  c.revision = 9000 + Math.floor(Math.random() * 1000);
  c.screens[0].privacy = { hidePhotos: true, showLock: true, schedule: [] };
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify(setup ? { passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false } : {}));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), PAGE);
  store.initStore(dir);
  _resetDisplays();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetPrivacy();
  setServerVersion('0.16.6');
  if (setup) await ensurePassword();
  syncDisplayKeys();
  const app = createApp({ version: '0.16.6', dist });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {}, cookie = '' } = {}) => {
    const r = await realFetch(base + url, {
      method,
      headers: { ...headers, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, headers: r.headers, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  const key = (slug) => listDisplayLinks().find((l) => l.slug === slug).key;
  try {
    await fn({ call, login, key });
  } finally {
    _resetPrivacy();
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
}

test('app: /d/<key> carries the API answers for that key, private, and only for a valid key', async () => {
  await withServer(async ({ call, login, key }) => {
    const k = key('kitchen');
    const page = await call('GET', `/d/${k}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'private, no-store');
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    const block = readBlock(page.text);
    assert.ok(block, 'the page has a block');
    const api = await call('GET', '/api/display/config', { headers: { 'x-marco-key': k } });
    assert.deepEqual(block.data['/api/display/config'], api.json);
    assert.equal(block.data['/api/display/config'].screenId, 's_kitchen');
    const health = await call('GET', '/api/health');
    assert.equal(block.data['/api/health'].version, health.json.version);
    // the page holds no credential and no secret
    assert.ok(!page.text.includes(k));
    assert.ok(!/passwordHash|displayKeys|sessionEpoch/.test(page.text));
    // the block sits in the page as it was, before </body>
    assert.ok(page.text.startsWith('<!doctype html><html><head><title>display</title></head><body><div id="app" class="booting"></div><script'));

    // unknown, malformed or revoked keys: the plain page (the display asks and shows "no longer valid")
    for (const bad of ['00000000-0000-4000-8000-000000000000', 'nope', 'md_' + 'a'.repeat(43)]) {
      const r = await call('GET', `/d/${bad}`);
      assert.equal(r.status, 200);
      assert.equal(r.text, PAGE, bad);
    }

    // private mode: the block says what the API says (lock on, gallery replaced by stock photos)
    const cookie = await login();
    const on = await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'on', screens: ['living-room'] }, });
    assert.equal(on.status, 200, on.text);
    const main = key('living-room');
    const priv = readBlock((await call('GET', `/d/${main}`)).text).data['/api/display/config'];
    assert.equal(priv.privacy.active, true);
    assert.deepEqual(priv, (await call('GET', '/api/display/config', { headers: { 'x-marco-key': main } })).json);
    // the other screen is not private
    assert.equal(readBlock((await call('GET', `/d/${k}`)).text).data['/api/display/config'].privacy.active, false);
  });
});

test('app: no block while the server needs setup', async () => {
  await withServer(async ({ call, key }) => {
    const r = await call('GET', `/d/${key('living-room')}`);
    assert.equal(r.status, 200);
    assert.equal(r.text, PAGE);
  }, { setup: false });
});

test('the event windows of a saved screen as the display works them out', () => {
  // a default screen, today in its time zone: the first window is the one the display asks for on a big screen
  const cfg = defaultConfig();
  const sc = cfg.screens[0];
  const proj = { datetime: cfg.datetime, screen: sc.screen, layout: sc.layout, calendar: sc.calendar };
  const today = localDate(new Date(), cfg.datetime.timezone);
  const [first] = bootEventWindows(proj);
  assert.deepEqual(first, eventsWindow(today, { weekStart: sc.calendar.weekStart, startOn: sc.calendar.startOn, weeks: sc.calendar.weeks, agenda: sc.calendar.view === 'agenda', agendaDays: sc.calendar.agendaDays }));
});

test('display side (web/display/boot.ts): each answer once, for its exact path, while fresh; early requests', async () => {
  const [boot] = await loadWebModules('/web/display/boot.ts');
  const fakeDoc = (text, type = 'application/json') => {
    let removed = false;
    const el = { textContent: text, getAttribute: (k) => (k === 'type' ? type : null), remove: () => { removed = true; } };
    return { doc: { getElementById: (id) => (id === BOOT_ID && !removed ? el : null) }, removed: () => removed };
  };
  const cfg = { revision: 1 };
  const page = fakeDoc(bootBlock({ '/api/display/config': cfg, '/api/weather': { t: 1 }, 'not-api': { x: 1 }, '/api/news': 'text' }).replace(/^<script[^>]*>|<\/script>$/g, ''));
  const data = boot.readBoot(page.doc);
  assert.ok(page.removed(), 'the block leaves the page once read');
  assert.equal(boot.readBoot(page.doc), null);
  boot.resetBoot();
  assert.equal(boot.loadBoot(data), true);
  assert.deepEqual(boot.peekBoot('/api/display/config'), cfg);
  assert.deepEqual(await boot.takeSeed('/api/display/config'), cfg);
  assert.equal(boot.takeSeed('/api/display/config'), undefined, 'used once');
  assert.equal(boot.takeSeed('/api/weather?screen=x'), undefined, 'exact path only');
  assert.equal(boot.takeSeed('not-api'), undefined);
  assert.equal(boot.takeSeed('/api/news'), undefined, 'answers are objects');
  // other versions and broken blocks are ignored
  for (const bad of ['{"v":2,"data":{"/api/display/config":{}}}', '{nope', '{"v":1,"data":[1]}']) assert.equal(boot.readBoot(fakeDoc(bad).doc), null);
  assert.equal(boot.readBoot(fakeDoc('{"v":1,"data":{}}', 'text/javascript').doc), null);
  // a bootstrapped answer is only taken within a minute of the page load
  boot.resetBoot();
  boot.loadBoot({ '/api/weather': { t: 2 } });
  const realNow = performance.now;
  try {
    performance.now = () => 61_000;
    assert.equal(boot.takeSeed('/api/weather'), undefined);
  } finally {
    performance.now = realNow;
  }
  // early requests: started once, handed to the first request for that path, not kept after a failure is taken
  boot.resetBoot();
  let runs = 0;
  boot.early('/api/news', async () => { runs++; return { items: [] }; });
  boot.early('/api/news', async () => { runs++; return { items: [1] }; });
  assert.equal(runs, 1);
  assert.deepEqual(await boot.takeSeed('/api/news'), { items: [] });
  assert.equal(boot.takeSeed('/api/news'), undefined);
  boot.early('/api/photos?count=20', async () => { throw new Error('offline'); });
  await assert.rejects(boot.takeSeed('/api/photos?count=20'), /offline/);
});
