// GET /api/photos?for= (#41): the photos of one Personalizado photo card or of the sidebar's photo with photos of its
// own, read from that card's saved settings. Real server, offline. The living room shows stock photos; its photo card
// A has its own (the gallery by name), card B (in a Rotativa) the same own settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle } from '../core/canvasCore.js';
import { localDate } from '../core/lib/tz.js';
import { ensurePassword, hashPassword, _resetLoginLimits } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPoll } from '../pollHub.js';
import { _resetActivityThrottle } from '../activity.js';
import { syncDisplayKeys, listDisplayLinks, _resetDisplayAccess } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { syncPhotoRules, _resetPhotoRules } from '../photoRules.js';
import { _setPicsumList, resetPhotoHistory } from '../photos.js';

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
const PASSWORD = 'secret-pass-123';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 100, 0, 150, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const FILES = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'];
const OWN = { mode: 'own', source: 'gallery', stockTopic: 'nature', order: 'name', immich: { albumIds: [], favoritesOnly: false }, rules: [], weatherFx: 'simple' };
const card = (id, x, photoSource) => ({ id, kind: 'photo', pos: { zone: 'main', x, y: 0, size: 'm', w: 6, h: 6 }, style: defaultItemStyle(), props: { ...canvasDefaults('photo'), ...(photoSource ? { photoSource } : {}) } });

async function withServer(fn, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-photosource-'));
  globalThis.fetch = offlineFetch;
  _setPicsumList([{ id: 7, author: 'Stock Person', width: 1920, height: 1080 }]);
  resetPhotoHistory();
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  const s = c.screens[0];
  s.background.source = 'stock';
  s.privacy = { ...(s.privacy || {}), hidePhotos: true };
  s.layout.preset = 'canvas';
  s.canvas = {
    ...defaultCanvas(), background: 'ambient',
    items: [
      card('cv_carda001', 0, OWN),
      // B, inside a Rotativa: the same own settings as A
      { id: 'cv_rot00001', kind: 'rotator', pos: { zone: 'main', x: 6, y: 0, size: 'm', w: 6, h: 6 }, style: defaultItemStyle(), props: { everySec: 10, dots: false, cards: [{ id: 'cv_cardb001', kind: 'photo', props: { ...canvasDefaults('photo'), photoSource: { ...OWN, weatherFx: 'off' } } }, { id: 'cv_clk00001', kind: 'clock.digital', props: canvasDefaults('clock.digital') }] } },
    ],
  };
  c.screens.push(defaultScreenProfile({ id: 's_guest', slug: 'guest', name: 'Guest' }));
  mutate?.(c);
  const v = validateConfig(c);
  assert.deepEqual(v.errors, []);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(v.value));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword(PASSWORD), passwordIsDefault: false }));
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  for (const f of [...FILES, 'xmas.jpg']) fs.writeFileSync(path.join(dir, 'photos', f), JPEG);
  store.initStore(dir);
  _resetDisplays();
  _resetPoll();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetLoginLimits();
  _resetPrivacy();
  _resetPhotoRules();
  setServerVersion('0.36.0');
  await ensurePassword();
  syncDisplayKeys();
  const app = createApp({ version: '0.36.0', dist: path.join(dir, 'no-dist') });
  const server = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
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
    return { status: r.status, json };
  };
  const login = async () => {
    const r = await realFetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
    assert.equal(r.status, 200);
    return (r.headers.getSetCookie?.() || []).map((x) => x.split(';')[0]).join('; ');
  };
  const keyOf = (slug) => listDisplayLinks().find((l) => l.slug === slug).key;
  const photos = (q, slug = 'living-room') => call('GET', `/api/photos?count=2${q}`, { headers: { 'x-marco-key': keyOf(slug) } });
  try {
    await fn({ call, login, keyOf, photos });
  } finally {
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
    _resetLoginLimits();
    _resetPrivacy();
    _resetPhotoRules();
    _setPicsumList(null);
  }
}

test('?for=<card>: its own list in its own order; a card on the screen photos gets the screen list', async () => {
  await withServer(async ({ photos }) => {
    const a = (await photos('&for=cv_carda001')).json;
    assert.deepEqual(a.photos.map((p) => p.file), ['a.jpg', 'b.jpg']);
    assert.ok(a.photos.every((p) => p.url.startsWith('/media/photos/')));
    assert.equal(a.rule, '');
    // by name, it goes on after the photo shown last
    assert.deepEqual((await photos('&for=cv_carda001&after=b.jpg')).json.photos.map((p) => p.file), ['c.jpg', 'd.jpg']);
    // the screen itself: stock
    assert.ok((await photos('')).json.photos.every((p) => p.source === 'stock'));
  });
  // card B back on the screen's photos ('screen', its own settings kept): the screen's list
  await withServer(async ({ photos }) => {
    assert.ok((await photos('&for=cv_cardb001')).json.photos.every((p) => p.source === 'stock'));
  }, (c) => void (c.screens[0].canvas.items[1].props.cards[0].props.photoSource.mode = 'screen'));
});

test('?for=: a card that is not there is a 404, a bad id a 400; the display never names a source or a path', async () => {
  await withServer(async ({ photos, call, keyOf }) => {
    assert.deepEqual(await photos('&for=cv_nope'), { status: 404, json: { error: 'photo_card_not_found' } });
    assert.deepEqual(await photos('&for=cv_clk00001'), { status: 404, json: { error: 'photo_card_not_found' } }, 'not a photo card');
    assert.deepEqual(await photos('&for=cv_carda001', 'guest'), { status: 404, json: { error: 'photo_card_not_found' } }, 'a card of another screen');
    for (const bad of ['..%2Fx', '%2Fetc%2Fpasswd', 'a.jpg', '']) assert.deepEqual(await photos(`&for=${bad}`), { status: 400, json: { error: 'invalid_for' } }, bad);
    assert.equal((await call('GET', '/api/photos?for=cv_carda001&for=cv_cardb001', { headers: { 'x-marco-key': keyOf('living-room') } })).status, 400);
    // a source or a file in the query changes nothing: the card's saved settings decide
    assert.ok((await photos('&source=gallery&file=a.jpg')).json.photos.every((p) => p.source === 'stock'));
    assert.ok((await photos('&for=cv_carda001&source=stock')).json.photos.every((p) => p.source === 'gallery'));
  });
});

test('two cards with the same settings share the rotation; the sidebar photo with photos of its own', async () => {
  await withServer(async ({ photos }) => {
    assert.deepEqual((await photos('&for=cv_carda001')).json.photos.map((p) => p.file), ['a.jpg', 'b.jpg']);
    // card B (inside a Rotativa) has the same source and order: it goes on where A left off
    assert.deepEqual((await photos('&for=cv_cardb001')).json.photos.map((p) => p.file), ['c.jpg', 'd.jpg']);
    // the sidebar on glass: the screen's photos
    assert.ok((await photos('&for=sidebar')).json.photos.every((p) => p.source === 'stock'));
  });
  // the sidebar's photo with photos of its own (fill 'photo'): its list; the screen's slideshow stays on stock
  await withServer(async ({ photos }) => {
    assert.deepEqual((await photos('&for=sidebar')).json.photos.map((p) => p.file), ['a.jpg', 'b.jpg']);
    assert.ok((await photos('')).json.photos.every((p) => p.source === 'stock'));
  }, (c) => {
    c.screens[0].canvas.sidebar = { side: 'left', size: 'wide', fill: 'photo', photoSource: { ...OWN, weatherFx: 'rich' } };
  });
});

test('privacy with "hide photos": stock for a card too; its special background and its gallery files only for its screen', async () => {
  const today = new Date();
  await withServer(async ({ photos, call, login, keyOf }) => {
    const r = (await photos('&for=cv_carda001')).json;
    assert.deepEqual(r.photos.map((p) => p.file), ['xmas.jpg']);
    assert.match(r.rule, /^[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(r).includes('navidad'));
    // the screen itself has no rule
    assert.equal((await photos('')).json.rule, '');
    // a display of the living room may load the gallery files card A shows (the screen itself shows stock)
    const media = (file, slug) => call('GET', `/media/photos/${file}?k=${keyOf(slug)}`);
    assert.equal((await media('c.jpg', 'living-room')).status, 200);
    assert.equal((await media('xmas.jpg', 'living-room')).status, 200);
    assert.equal((await media('c.jpg', 'guest')).status, 404);
    // privacy mode with "hide photos": stock, no rule, no gallery files
    const cookie = await login();
    assert.equal((await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'on', hours: 2, screens: ['living-room'] } })).status, 200);
    const p = (await photos('&for=cv_carda001')).json;
    assert.ok(p.photos.every((x) => x.source === 'stock'));
    assert.equal(p.rule, '');
    assert.equal((await media('c.jpg', 'living-room')).status, 404);
  }, (c) => {
    c.localEvents.items = [{ id: 'l_xmas', title: 'Cena de Navidad', allDay: true, date: localDate(today, c.datetime.timezone), endDate: localDate(today, c.datetime.timezone) }];
    c.screens[0].canvas.items[0].props.photoSource.rules = [{ id: 'bg_x', when: { type: 'event', text: 'navidad', calendars: [] }, photos: { source: 'gallery', files: ['xmas.jpg'] } }];
  });
});

test('?for=<card>: the pace of its own special background while its photos show (#45)', async () => {
  const today = new Date();
  await withServer(async ({ photos }) => {
    const r = (await photos('&for=cv_carda001')).json;
    assert.deepEqual(r.photos.map((p) => p.file), ['xmas.jpg']);
    assert.equal(r.intervalSec, 3600);
    // card B has no rules, the screen neither
    assert.equal('intervalSec' in (await photos('&for=cv_cardb001')).json, false);
    assert.equal('intervalSec' in (await photos('')).json, false);
  }, (c) => {
    c.localEvents.items = [{ id: 'l_xmas', title: 'Cena de Navidad', allDay: true, date: localDate(today, c.datetime.timezone), endDate: localDate(today, c.datetime.timezone) }];
    c.screens[0].canvas.items[0].props.photoSource.rules = [{ id: 'bg_x', when: { type: 'event', text: 'navidad', calendars: [] }, photos: { source: 'gallery', files: ['xmas.jpg'] }, intervalSec: 3600 }];
  });
});

test('displays of a screen get a photos event when the special background of one of its cards changes', async () => {
  const today = new Date();
  await withServer(async ({ call, login, keyOf }) => {
    const poll = async (client, cursor = '') => (await call('GET', `/api/display/poll?client=${client}&cursor=${encodeURIComponent(cursor)}`, { headers: { 'x-marco-key': keyOf('living-room') } })).json;
    assert.deepEqual(await syncPhotoRules(), []);
    const m0 = await poll('tv');
    assert.deepEqual(await syncPhotoRules(), [], 'nothing changed');
    // the event goes: card A's rule no longer holds (the screen's Fondo has no rules at all)
    const cookie = await login();
    const cfg = (await call('GET', '/api/admin/config', { cookie })).json;
    cfg.localEvents.items = [];
    assert.equal((await call('PUT', '/api/admin/config', { cookie, body: cfg })).status, 200);
    assert.deepEqual(await syncPhotoRules(), ['s_main']);
    const m1 = await poll('tv', m0.cursor);
    assert.ok(m1.commands.some((x) => x.type === 'photos'), JSON.stringify(m1.commands));
  }, (c) => {
    c.localEvents.items = [{ id: 'l_xmas', title: 'Cena de Navidad', allDay: true, date: localDate(today, c.datetime.timezone), endDate: localDate(today, c.datetime.timezone) }];
    c.screens[0].canvas.items[0].props.photoSource.rules = [{ id: 'bg_x', when: { type: 'event', text: 'navidad', calendars: [] }, photos: { source: 'gallery', files: ['xmas.jpg'] } }];
  });
});
