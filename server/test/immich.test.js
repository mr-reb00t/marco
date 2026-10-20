// Immich as a background source: the pure rules (core/immichCore.js), the validator, the client against a fake
// Immich in three release shapes (server/test/fakeImmich.js), the rotation, the media proxy with its cache and
// limits, privacy mode, the admin endpoints, backups, and the display's blurred fill and caption rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { exportSecrets, sanitizeImportedSecrets } from '../core/backupsCore.js';
import { displayConfig } from '../core/screens.js';
import {
  normalizeImmichUrl, missingScopes, showableAsset, compactAsset, sniffImageType, mapAlbum, usesSearch, parseVersion,
} from '../core/immichCore.js';
import * as immich from '../immich.js';
import { hashPassword, ensurePassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPrivacy } from '../privacy.js';
import { syncDisplayKeys, displayKeyFor } from '../displayAccess.js';
import { _setPicsumList, resetPhotoHistory } from '../photos.js';
import { fakeImmich, asset, assetId, albumId, JPEG } from './fakeImmich.js';
import { loadWebModules } from './webModules.js';

const KEY = 'test-key-0123456789';
const realFetch = globalThis.fetch;

// ---------------------------------------------------------------------------------------------------------------
// pure rules

test('immichCore: URL, scopes, filters, compact items, sniffing, versions', () => {
  assert.equal(normalizeImmichUrl(' https://photos.example.com/api/ '), 'https://photos.example.com');
  assert.equal(normalizeImmichUrl('http://immich.local:2283//'), 'http://immich.local:2283');
  assert.deepEqual(missingScopes(['all']), []);
  assert.deepEqual(missingScopes(['album.read']), ['asset.read', 'asset.view']);
  assert.deepEqual(missingScopes(undefined), []);
  assert.equal(showableAsset(asset(1)), true);
  assert.equal(showableAsset(asset(1, { type: 'VIDEO' })), false);
  assert.equal(showableAsset(asset(1, { isTrashed: true })), false);
  assert.equal(showableAsset(asset(1, { visibility: 'hidden' })), false);
  assert.equal(showableAsset(asset(1, { visibility: 'locked' })), false);
  assert.equal(showableAsset(asset(1, { visibility: 'archive' })), true, 'archived photos stay');
  assert.equal(showableAsset(asset(1, { isFavorite: false }), { favoritesOnly: true }), false);
  assert.equal(showableAsset({ ...asset(1), id: '../etc' }), false);
  const c = compactAsset(asset(3));
  assert.deepEqual(Object.keys(c).sort(), ['city', 'country', 'id', 'name', 't', 'v']);
  assert.equal(c.t, '2019-08-04T12:00:00', 'date and time: the sort key for newest');
  assert.equal(compactAsset(asset(3, { localDateTime: '2019-08-04', exifInfo: {} })).t, '2019-08-04');
  assert.equal(sniffImageType(JPEG), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('<html>not an image</html>')), null);
  assert.equal(mapAlbum({ id: 'nope' }), null);
  assert.equal(usesSearch(parseVersion({ major: 1, minor: 134, patch: 0 })), false);
  assert.equal(usesSearch(parseVersion({ major: 2, minor: 5, patch: 0 })), true);
});

test('validator: album ids, cap, dedupe, URL normalised, immichAvailable false refuses the source', () => {
  const c = defaultConfig();
  c.immich = { enabled: true, url: 'http://immich.local:2283/api/', insecureTls: true };
  c.screens[0].background.source = 'immich';
  c.screens[0].background.immich = { albumIds: [albumId(1).toUpperCase(), albumId(1), albumId(2)], favoritesOnly: true };
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.immich.url, 'http://immich.local:2283');
  assert.deepEqual(r.value.screens[0].background.immich, { albumIds: [albumId(1), albumId(2)], favoritesOnly: true });
  assert.equal(r.value.screens[0].background.portraitFit, 'auto');

  const bad = structuredClone(c);
  bad.screens[0].background.immich.albumIds = ['not-a-uuid'];
  assert.ok(validateConfig(bad).errors.some((e) => e.path === 'screens[0].background.immich.albumIds'));
  const many = structuredClone(c);
  many.screens[0].background.immich.albumIds = Array.from({ length: 21 }, (_, i) => albumId(i + 1));
  assert.ok(validateConfig(many).errors.some((e) => /too many/.test(e.message)));
  const url = structuredClone(c);
  url.immich.url = 'ftp://x';
  assert.ok(validateConfig(url).errors.some((e) => e.path === 'immich.url'));
  const fit = structuredClone(c);
  fit.screens[0].background.portraitFit = 'stretch';
  assert.ok(validateConfig(fit).errors.some((e) => e.path === 'screens[0].background.portraitFit'));

  const cloud = validateConfig(c, { immichAvailable: false });
  assert.deepEqual(cloud.errors.map((e) => e.path), ['screens[0].background.source']);
  // empty selection is valid (the display shows stock); a screen on another source is fine without Immich
  const other = structuredClone(c);
  other.screens[0].background.source = 'gallery';
  assert.equal(validateConfig(other, { immichAvailable: false }).ok, true);
});

test('backups: the Immich key is exported only when set and imported only when well formed', () => {
  assert.deepEqual(exportSecrets({ immich: { apiKey: KEY } }).immich, { apiKey: KEY });
  assert.equal(exportSecrets({ immich: {} }).immich, undefined);
  assert.equal(sanitizeImportedSecrets({ immich: { apiKey: KEY } }).immichKey, KEY);
  assert.equal(sanitizeImportedSecrets({ immich: { apiKey: 'bad key with spaces' } }).immichKey, undefined);
});

// ---------------------------------------------------------------------------------------------------------------
// app with a fake Immich

const ALBUM_A = albumId(1);
const ALBUM_B = albumId(2);

/** Album A: 12 photos plus a video, a trashed, a hidden and a locked asset. Album B: 4 photos, 2 shared with A. */
function libraryAlbums() {
  const a = [...Array.from({ length: 12 }, (_, i) => asset(i + 1)),
    asset(90, { type: 'VIDEO' }), asset(91, { isTrashed: true }), asset(92, { visibility: 'hidden' }), asset(93, { visibility: 'locked' })];
  const b = [asset(11), asset(12), asset(20), asset(21)];
  return [{ id: ALBUM_A, albumName: 'Summer', assets: a }, { id: ALBUM_B, albumName: 'Beach', assets: b }];
}

async function withApp(fn, { version = '3.3.0', albums = libraryAlbums(), selection = [ALBUM_A], fake: fakeOpts = {}, mutate } = {}) {
  const fake = await fakeImmich({ version, albums, key: KEY, ...fakeOpts });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-immich-'));
  globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
  _setPicsumList([{ id: 7, author: 'Stock Person', width: 1920, height: 1080 }]);
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'private';
  c.immich = { enabled: true, url: fake.url, insecureTls: false };
  c.screens[0].background.source = 'immich';
  c.screens[0].background.immich = { albumIds: selection, favoritesOnly: false };
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  mutate?.(c);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false, immich: { apiKey: KEY } }));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dist, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>display</title>');
  fs.writeFileSync(path.join(dist, 'admin', 'index.html'), '<!doctype html><title>admin</title>');
  store.initStore(dir);
  immich._reset();
  resetPhotoHistory();
  _resetDisplays();
  _resetPrivacy();
  syncDisplayKeys();
  setServerVersion('0.6.1');
  await ensurePassword();
  const app = createApp({ version: '0.6.1', dist });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const k = displayKeyFor(c.screens[0].id);
  const kitchenKey = displayKeyFor('s_kitchen');
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
  const photos = async (q = '', key = k) => (await call('GET', `/api/photos?count=50${q}`, { key })).json.photos;
  try {
    await fn({ call, login, photos, fake, dir, k, kitchenKey, base });
  } finally {
    closeAll();
    _resetPrivacy();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await fake.stop();
    immich._reset();
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
}

/** Wait for background work (fire-and-forget prefetch) to settle. */
const settle = () => new Promise((r) => setTimeout(r, 80));

for (const version of ['1.120.0', '2.5.0', '3.3.0']) {
  test(`Immich ${version}: connection test, albums, photos of one album (only showable images)`, async () => {
    await withApp(async ({ call, login, photos, fake }) => {
      const cookie = await login();
      const t = await call('POST', '/api/admin/test/immich', { body: {}, cookie });
      assert.deepEqual(t.json, { ok: true, version, missingScopes: [] });
      const albums = await call('GET', '/api/admin/immich/albums', { cookie });
      assert.equal(albums.status, 200);
      assert.deepEqual(albums.json.map((a) => [a.name, a.count]), [['Beach', 4], ['Summer', 16]]);
      const list = await photos();
      assert.equal(list.length, 12, 'video, trashed, hidden and locked assets are left out');
      assert.ok(list.every((p) => p.source === 'immich' && /^\/media\/immich\/[0-9a-f-]{36}\?v=[0-9a-z]+$/.test(p.url)));
      assert.ok(list.every((p) => p.place === 'Valencia, Spain' && /^2019-08-\d\d$/.test(p.takenAt) && !('title' in p)), 'no file name on screen');
      if (version === '1.120.0') assert.equal(fake.count(/\/search\/metadata/), 0);
      else assert.ok(fake.count(/\/search\/metadata/) > 0);
      if (version === '3.3.0') assert.equal(fake.count(/^\/api\/albums\/[^/]+$/), 0);
      // the key only travels in the header
      assert.ok(fake.hits.every((h) => !h.path.includes(KEY)));
    }, { version });
  });
}

test('connection test: bad key, missing scopes, unsaved values, legacy server-info, unreachable', async () => {
  await withApp(async ({ call, login, fake }) => {
    const cookie = await login();
    assert.deepEqual((await call('POST', '/api/admin/test/immich', { body: { key: 'wrong-key-0123456789' }, cookie })).json, { ok: false, version: '3.3.0', error: 'invalid_key' });
    fake.state.permissions = ['album.read'];
    assert.deepEqual((await call('POST', '/api/admin/test/immich', { body: {}, cookie })).json.missingScopes, ['asset.read', 'asset.view']);
    assert.equal((await call('POST', '/api/admin/test/immich', { body: { url: 'javascript:x' }, cookie })).json.error, 'invalid_url');
    assert.equal((await call('POST', '/api/admin/test/immich', { body: { url: 'http://127.0.0.1:9' }, cookie })).json.error, 'unreachable');
  });
  await withApp(async ({ call, login }) => {
    const cookie = await login();
    assert.deepEqual((await call('POST', '/api/admin/test/immich', { body: {}, cookie })).json, { ok: true, version: '1.110.0', missingScopes: [] });
  }, { version: '1.110.0', fake: { legacy: true } });
});

test('v3: an album of 2500 photos is read in pages of 1000', async () => {
  const big = [{ id: ALBUM_A, albumName: 'Big', assets: Array.from({ length: 2500 }, (_, i) => asset(i + 1)) }];
  await withApp(async ({ photos, fake }) => {
    assert.equal((await photos()).length, 50);
    assert.equal(fake.count(/\/search\/metadata/), 3);
    const status = immich.immichStatus();
    assert.equal(status.albums[0].count, 2500);
  }, { albums: big });
});

test('rotation: two albums merged without duplicates, newest resumes after `after`, random does not repeat', async () => {
  await withApp(async ({ photos }) => {
    const all = await photos();
    assert.equal(all.length, 14, '12 + 4 with 2 shared');
    assert.equal(new Set(all.map((p) => p.id)).size, 14);
  }, { selection: [ALBUM_A, ALBUM_B] });
  await withApp(async ({ photos }) => {
    const first = await photos('&count=3');
    const ids = first.slice(0, 3).map((p) => p.id);
    const next = (await photos(`&after=${ids[2]}`)).map((p) => p.id);
    const full = (await photos()).map((p) => p.id);
    assert.equal(next[0], full[full.indexOf(ids[2]) + 1] ?? full[0], 'continues after the last shown');
    assert.ok(full.every((id, i) => i === 0 || full[i - 1] !== id));
  }, { mutate: (c) => { c.screens[0].background.order = 'newest'; } });
  await withApp(async ({ photos }) => {
    const batch = (await photos('&count=12')).map((p) => p.id);
    assert.equal(new Set(batch).size, 12, 'no repeats inside a batch');
  });
});

test('favorites only, empty selection and unusable settings fall back to stock', async () => {
  await withApp(async ({ photos }) => {
    const list = await photos();
    assert.equal(list.length, 6);
  }, { mutate: (c) => { c.screens[0].background.immich.favoritesOnly = true; } });
  await withApp(async ({ photos, fake }) => {
    const list = await photos();
    assert.ok(list.every((p) => p.source === 'stock'));
    assert.equal(fake.count(/^\/api\/(albums|search)/), 0);
  }, { selection: [] });
  await withApp(async ({ photos }) => {
    assert.ok((await photos()).every((p) => p.source === 'stock'));
  }, { mutate: (c) => { c.immich.enabled = false; } });
});

test('media proxy: credentials, unknown ids, cache hits, type checks, size cap', async () => {
  let mode = 'jpeg';
  const thumb = (req, res) => {
    if (mode === 'jpeg') return false;
    if (mode === 'octet') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(JPEG); return true; }
    if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>'); return true; }
    if (mode === 'big') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(Buffer.alloc(9 * 1024 * 1024, 1)); return true; }
    return false;
  };
  await withApp(async ({ call, photos, fake, k, kitchenKey, login }) => {
    const [p] = await photos();
    await settle();
    // private mode: no key → 401, wrong key → 403
    assert.equal((await call('GET', p.url)).status, 401);
    assert.equal((await call('GET', `${p.url}&k=nope`)).status, 403);
    // not a uuid, or not in a selected album: 404 without asking Immich
    const before = fake.stats.thumbs;
    assert.equal((await call('GET', `/media/immich/../../etc?k=${k}`)).status, 404);
    assert.equal((await call('GET', `/media/immich/${assetId(500)}?k=${k}`)).status, 404);
    assert.equal((await call('GET', `/media/immich/${assetId(90)}?k=${k}`)).status, 404, 'the video is not served');
    // another screen's key does not open this screen's albums
    assert.equal((await call('GET', `${p.url}&k=${kitchenKey}`)).status, 404);
    assert.equal(fake.stats.thumbs, before);
    const ok = await call('GET', `${p.url}&k=${k}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/jpeg');
    assert.match(ok.headers.get('cache-control'), /private, max-age=2592000/);
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(ok.buf, JPEG);
    const n = fake.stats.thumbs;
    assert.equal((await call('GET', `${p.url}&k=${k}`)).status, 200);
    assert.equal(fake.stats.thumbs, n, 'served from the disk cache');
    // octet-stream is sniffed, html refused, a body over 8 MB refused
    const list = await photos();
    await settle();
    const fresh = list.filter((x) => !fs.existsSync(path.join(store.paths.data, 'immich', 'cache', `${x.id}-${x.url.split('v=')[1]}.jpg`)));
    mode = 'octet';
    assert.equal((await call('GET', `${fresh[0].url}&k=${k}`)).headers.get('content-type'), 'image/jpeg');
    mode = 'html';
    assert.equal((await call('GET', `${fresh[1].url}&k=${k}`)).status, 502);
    mode = 'big';
    assert.equal((await call('GET', `${fresh[2].url}&k=${k}`)).status, 502);
    // admin thumbnails of album covers need a session
    const albums = (await call('GET', '/api/admin/immich/albums', { cookie: await login() })).json;
    mode = 'jpeg';
    assert.equal((await call('GET', `/media/immich/${albums[0].cover}?s=thumb&k=${k}`)).status, 404);
    assert.equal((await call('GET', `/media/immich/${albums[0].cover}?s=thumb`, { cookie: await login() })).status, 200);
    // the key never shows up in what displays get
    const cfg = await call('GET', '/api/display/config', { key: k });
    assert.ok(!cfg.text.includes(KEY) && !cfg.text.includes(fake.url));
    assert.equal(cfg.json.background.source, 'immich');
  }, { fake: { thumb } });
});

test('media proxy: at most 3 fetches to Immich at once, one per image', async () => {
  await withApp(async ({ photos, fake }) => {
    await photos();
    await settle();
    const status = immich.immichStatus();
    assert.equal(status.albums.length, 1);
    const ids = Array.from({ length: 10 }, (_, i) => assetId(i + 1));
    await Promise.all([...ids, ...ids].map((id) => immich.cachedImage(id, 'x1')));
    assert.ok(fake.stats.maxActive <= 3, `max ${fake.stats.maxActive}`);
    assert.ok(fake.stats.thumbs <= 10 + 3, 'the same image is fetched once');
  }, { fake: { thumbDelayMs: 40 } });
});

test('privacy mode with hide photos: stock in /api/photos and the display config, the proxy refuses', async () => {
  await withApp(async ({ call, photos, login, k }) => {
    const [p] = await photos();
    const cookie = await login();
    assert.equal((await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: ['s_main'] }, cookie })).status, 200);
    assert.ok((await photos()).every((x) => x.source === 'stock'));
    const cfg = await call('GET', '/api/display/config', { key: k });
    assert.equal(cfg.json.background.source, 'stock');
    assert.equal((await call('GET', `${p.url}&k=${k}`)).status, 404);
    const c = store.getConfig();
    assert.equal(displayConfig(c, c.screens[0], { privacy: { status: { active: true }, next: null } }).background.source, 'stock');
  }, { mutate: (c) => { c.screens[0].privacy = { hidePhotos: true, showLock: true, schedule: [] }; } });
});

test('Immich down: a warm list keeps serving, a cold one falls back to stock, failures are not retried at once', async () => {
  await withApp(async ({ photos, fake }) => {
    assert.ok((await photos()).every((p) => p.source === 'immich'));
    // restart while Immich is down: the list comes back from disk
    immich._reset();
    fake.state.down = true;
    assert.ok((await photos()).every((p) => p.source === 'immich'));
    // nothing cached at all: stock, and the next request within a minute does not ask Immich again
    immich.clearLists();
    const before = fake.hits.length;
    assert.ok((await photos()).every((p) => p.source === 'stock'));
    const after = fake.hits.length;
    assert.ok(after > before);
    assert.ok((await photos()).every((p) => p.source === 'stock'));
    assert.equal(fake.hits.length, after, 'failure cached');
  });
});

for (const version of ['1.120.0', '2.5.0', '3.3.0']) {
  test(`Immich ${version}: an album that is gone is skipped and flagged, the others still play`, async () => {
    await withApp(async ({ photos, call, login }) => {
      const list = await photos();
      assert.equal(list.length, 12);
      const cookie = await login();
      const st = (await call('GET', '/api/admin/immich/status', { cookie })).json;
      const gone = st.albums.find((a) => a.id === albumId(9));
      assert.equal(gone.missing, true);
      assert.equal(gone.error, 'not_found');
      assert.equal(st.usable, true);
    }, { selection: [ALBUM_A, albumId(9)], version });
  });
}

test('an album deleted after it was cached stops playing at the next refresh', async () => {
  await withApp(async ({ photos, fake }) => {
    assert.equal((await photos()).length, 12);
    fake.state.albums = fake.state.albums.filter((a) => a.id !== ALBUM_A);
    await immich.refreshAll();
    assert.equal(immich.immichStatus().albums[0].missing, true);
    assert.ok((await photos()).every((p) => p.source === 'stock'));
  }, { version: '2.5.0' });
});

test('after a restart the media route knows the photos of the lists saved on disk', async () => {
  await withApp(async ({ photos, call, k }) => {
    const [p] = await photos();
    immich._reset();
    assert.equal((await call('GET', `${p.url}&k=${k}`)).status, 200);
  });
});

test('newest keeps the time order inside a day', async () => {
  const sameDay = Array.from({ length: 6 }, (_, i) => asset(i + 1, { localDateTime: `2019-08-04T${String(10 + ((i * 5) % 6)).padStart(2, '0')}:00:00.000Z` }));
  await withApp(async ({ photos }) => {
    const list = await photos();
    const want = [...sameDay].sort((a, b) => b.localDateTime.localeCompare(a.localDateTime)).map((a) => a.id);
    assert.deepEqual(list.map((p) => p.id), want);
    assert.ok(list.every((p) => p.takenAt === '2019-08-04'), 'the caption gets the date only');
  }, { albums: [{ id: ALBUM_A, albumName: 'Trip', assets: sameDay }], mutate: (c) => { c.screens[0].background.order = 'newest'; } });
});

test('a fetch still running when the lists are cleared is dropped', async () => {
  await withApp(async () => {
    const dir = path.join(store.paths.data, 'immich', 'albums');
    const running = immich.refreshAll();
    immich.clearLists();
    await running;
    assert.equal(fs.existsSync(dir) && fs.readdirSync(dir).length > 0, false, 'nothing written for the old server');
    assert.equal(immich.immichStatus().albums[0].count, null);
  });
});

test('a fetched image is not written into a cache emptied meanwhile', async () => {
  await withApp(async () => {
    const dir = path.join(store.paths.data, 'immich', 'cache');
    const p = immich.cachedImage(assetId(1), 'x1');
    immich.clearCache();
    await assert.rejects(p);
    assert.equal(fs.existsSync(dir) && fs.readdirSync(dir).length > 0, false);
  }, { fake: { thumbDelayMs: 40 } });
});

test('admin: key is write-only, checked before it is stored; refresh and cache clear', async () => {
  await withApp(async ({ call, login, fake, photos, k }) => {
    const cookie = await login();
    const st = await call('GET', '/api/admin/immich/key', { cookie });
    assert.deepEqual(st.json, { set: true, hint: KEY.slice(-4) });
    assert.ok(!st.text.includes(KEY));
    assert.equal((await call('PUT', '/api/admin/immich/key', { body: { key: 'has spaces in it' }, cookie })).status, 400);
    const wrong = await call('PUT', '/api/admin/immich/key', { body: { key: 'wrong-key-0123456789' }, cookie });
    assert.deepEqual([wrong.status, wrong.json.error], [400, 'invalid_key']);
    assert.equal(store.getSecrets().immich.apiKey, KEY, 'a refused key is not stored');
    fake.state.key = 'new-key-abcdefghij';
    const ok = await call('PUT', '/api/admin/immich/key', { body: { key: 'new-key-abcdefghij' }, cookie });
    assert.deepEqual(ok.json, { set: true, hint: 'ghij', checked: true });
    assert.equal(JSON.parse(fs.readFileSync(store.paths.secrets, 'utf8')).immich.apiKey, 'new-key-abcdefghij');
    assert.equal(immich.immichStatus().albums[0].count, null, 'lists read with the old key are forgotten');
    // the config never carries the key
    assert.ok(!(await call('GET', '/api/admin/config', { cookie })).text.includes('new-key-abcdefghij'));

    const [p] = await photos();
    assert.equal((await call('GET', `${p.url}&k=${k}`)).status, 200);
    const before = fake.count(/\/search\/metadata/);
    const r = await call('POST', '/api/admin/immich/refresh', { cookie });
    assert.equal(r.status, 200);
    assert.ok(fake.count(/\/search\/metadata/) > before);
    assert.ok(r.json.cache.files >= 1);
    const cleared = await call('DELETE', '/api/admin/immich/cache', { cookie });
    assert.ok(cleared.json.freed > 0);
    assert.equal((await call('GET', '/api/admin/immich/status', { cookie })).json.cache.files, 0);
    // removing the key: the source falls back to stock
    assert.deepEqual((await call('PUT', '/api/admin/immich/key', { body: { key: '' }, cookie })).json, { set: false, hint: '', checked: false });
    immich._reset();
    assert.ok((await photos()).every((x) => x.source === 'stock'));
  });
});

test('cache prune keeps the newest images under the limit', async () => {
  await withApp(async () => {
    const dir = path.join(store.paths.data, 'immich', 'cache');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 5; i++) {
      const f = path.join(dir, `${assetId(i + 1)}-1.jpg`);
      fs.writeFileSync(f, Buffer.alloc(1000));
      const t = new Date(Date.now() - (10 - i) * 60_000);
      fs.utimesSync(f, t, t);
    }
    assert.equal(immich.pruneCache(2500), 3000);
    assert.deepEqual(fs.readdirSync(dir).sort(), [`${assetId(4)}-1.jpg`, `${assetId(5)}-1.jpg`]);
    assert.equal(immich.cacheLimitBytes({ MARCO_IMMICH_CACHE_MB: '10' }), 10 * 1024 * 1024);
  });
});

test('insecureTls: a self-signed HTTPS Immich works only with the option', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-immich-tls-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'),
      '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    return; // openssl unavailable: skip
  }
  const tls = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
  try {
    await withApp(async ({ call, login }) => {
      const cookie = await login();
      assert.equal((await call('POST', '/api/admin/test/immich', { body: { insecureTls: false }, cookie })).json.error, 'unreachable');
      assert.equal((await call('POST', '/api/admin/test/immich', { body: { insecureTls: true }, cookie })).json.ok, true);
    }, { fake: { tls } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// display rules

test('display: blurred fill only for photos in the other orientation, caption with date and place', async () => {
  const [fit] = await loadWebModules('/web/display/photoFit.ts');
  const b = (portraitFit, cover = true) => ({ cover, portraitFit });
  const imm = { source: 'immich' }, gal = { source: 'gallery' };
  assert.equal(fit.wantsBlurFill(b('auto'), imm, 3000, 4000, 1920, 1080), true, 'portrait Immich photo on a landscape screen');
  assert.equal(fit.wantsBlurFill(b('auto'), gal, 3000, 4000, 1920, 1080), false, 'gallery keeps the crop by default');
  assert.equal(fit.wantsBlurFill(b(undefined), gal, 3000, 4000, 1920, 1080), false, 'screens saved before the option keep their look');
  assert.equal(fit.wantsBlurFill(b('blur'), gal, 3000, 4000, 1920, 1080), true);
  assert.equal(fit.wantsBlurFill(b('crop'), imm, 3000, 4000, 1920, 1080), false);
  assert.equal(fit.wantsBlurFill(b('auto'), imm, 4000, 3000, 1920, 1080), false, 'landscape on landscape');
  assert.equal(fit.wantsBlurFill(b('auto'), imm, 4000, 3000, 1080, 1920), true, 'landscape on a portrait screen');
  assert.equal(fit.wantsBlurFill(b('blur', false), imm, 3000, 4000, 1920, 1080), false, 'whole photo with bands: nothing to fill');
  assert.equal(fit.immichCaption({ takenAt: '2019-08-12', place: 'Valencia, España' }, 'es'), 'Valencia, España · 12 de agosto de 2019');
  assert.equal(fit.immichCaption({ takenAt: '2019-08-12' }, 'en'), 'August 12, 2019');
  assert.equal(fit.immichCaption({}, 'en'), '');
});

test('carousel: a step screen with Immich photos, the carousel link reads only its screens\' albums', async () => {
  await withApp(async ({ call, photos, k }) => {
    const ck = displayKeyFor('v_loop');
    assert.ok(ck);
    // the carousel credential asks for its Immich step by address
    const list = await photos('&screen=living-room', ck);
    assert.ok(list.length > 0 && list.every((x) => x.source === 'immich'));
    await settle();
    const ok = await call('GET', `${list[0].url}&k=${ck}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.buf, JPEG);
    // the kitchen step plays stock photos
    assert.ok((await photos('&screen=kitchen', ck)).every((x) => x.source === 'stock'));
    // a screen outside the carousel: its album stays closed to the carousel link
    const den = await photos('', displayKeyFor('s_den'));
    const onlyB = den.find((x) => x.id === assetId(20));
    assert.ok(onlyB, 'album B photo in the den batch');
    await settle();
    assert.equal((await call('GET', `${onlyB.url}&k=${ck}`)).status, 404);
    assert.equal((await call('GET', `${onlyB.url}&k=${k}`)).status, 404);
    assert.equal((await call('GET', `${onlyB.url}&k=${displayKeyFor('s_den')}`)).status, 200);
  }, {
    mutate: (c) => {
      const den = defaultScreenProfile({ id: 's_den', slug: 'den', name: 'Den' });
      den.background.source = 'immich';
      den.background.immich = { albumIds: [ALBUM_B], favoritesOnly: false };
      c.screens.push(den);
      c.carousels = { items: [{ id: 'v_loop', slug: 'loop', name: 'Loop', enabled: true, transition: 'fade', holdOnAlert: true, nightRotate: false,
        steps: [{ screenId: 's_kitchen', seconds: 20 }, { screenId: 's_main', seconds: 20 }] }] };
    },
  });
});

test('carousel: a step screen private with hide photos closes its photos to the carousel link', async () => {
  await withApp(async ({ call, photos, login }) => {
    const ck = displayKeyFor('v_loop');
    const [p] = await photos('&screen=living-room', ck);
    assert.equal(p.source, 'immich');
    await settle();
    assert.equal((await call('GET', `${p.url}&k=${ck}`)).status, 200);
    const cookie = await login();
    assert.equal((await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: ['s_main'] }, cookie })).status, 200);
    assert.equal((await call('GET', `${p.url}&k=${ck}`)).status, 404);
    assert.ok((await photos('&screen=living-room', ck)).every((x) => x.source === 'stock'));
  }, {
    mutate: (c) => {
      c.screens[0].privacy = { hidePhotos: true, showLock: true, schedule: [] };
      c.carousels = { items: [{ id: 'v_loop', slug: 'loop', name: 'Loop', enabled: true, transition: 'fade', holdOnAlert: true, nightRotate: false,
        steps: [{ screenId: 's_kitchen', seconds: 20 }, { screenId: 's_main', seconds: 20 }] }] };
    },
  });
});

test('special background rule with an Immich album: its photos on that screen only, the proxy serves them to it', async () => {
  await withApp(async ({ call, photos, k, kitchenKey }) => {
    // the kitchen shows stock photos; its rule (every day) plays album B
    const r = (await call('GET', '/api/photos?count=50', { key: kitchenKey })).json;
    assert.deepEqual(r.photos.map((p) => p.id).sort(), [assetId(11), assetId(12), assetId(20), assetId(21)].sort());
    assert.match(r.rule, /^[0-9a-f]{12}$/);
    await settle();
    const only = r.photos.find((p) => p.id === assetId(20));
    assert.equal((await call('GET', `${only.url}&k=${kitchenKey}`)).status, 200);
    // the main screen plays album A only: album B's own photos stay closed to it
    assert.equal((await call('GET', `${only.url}&k=${k}`)).status, 404);
    assert.ok((await photos()).every((p) => p.source === 'immich'));
  }, {
    mutate: (c) => {
      c.screens[1].background.rules = [{ id: 'r_all', when: { type: 'range', from: '01-01', to: '12-31' }, photos: { source: 'immich', albumId: ALBUM_B } }];
    },
  });
});
