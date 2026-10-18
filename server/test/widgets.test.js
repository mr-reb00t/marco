// Widgets: validation of the global list and the per-screen placements, the display projection, the test endpoint
// against a local HTTP server, the image helpers and the wiring of the display module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { validateConfig, mergeDefaults, LAYOUT_PRESETS } from '../core/validate.js';
import { defaultConfig, defaultScreenProfile, MAX_WIDGETS, SCREEN_ONLY_KEYS } from '../core/defaults.js';
import { displayConfig, displayWidgets, flatView } from '../core/screens.js';
import { testWidget, refusesFraming } from '../widgets.js';
import { sniffWidgetImage, widgetImageInfo, looksLikeSvg } from '../core/imageInfo.js';
import * as store from '../store.js';
import { sessionMiddleware, csrfGuard, ensurePassword, loginHandler, hashPassword } from '../auth.js';
import { adminRouter } from '../routes/admin.js';
import { mergeImport, IMPORT_SECTIONS } from '../core/backupsCore.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** A PNG header of w x h (enough for the sniffing and size helpers). */
function pngHead(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
const gifHead = (w, h) => {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
};
/** A JPEG with an APP0 segment and a SOF0 of w x h. */
function jpegHead(w, h) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
}
function webpHead(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(22, 4);
  b.write('WEBPVP8X', 8, 'latin1');
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}

const img = (over = {}) => ({ id: 'w_precios', type: 'image', name: 'Precios', options: { url: 'http://192.168.0.20/card.png', refreshSec: 900, fit: 'contain', bust: true }, ...over });
const web = (over = {}) => ({ id: 'w_ha', type: 'web', name: 'Panel', options: { url: 'https://example.com/panel', refreshSec: 0, fit: 'contain', bust: true }, ...over });
const withWidgets = (widgets, placements = [], layout = {}) => {
  const c = defaultConfig();
  c.widgets = widgets;
  c.screens[0].widgets = placements;
  Object.assign(c.screens[0].layout, layout);
  return c;
};

test('defaults: an empty widget list, no placements, no full-screen widget', () => {
  const c = defaultConfig();
  assert.deepEqual(c.widgets, []);
  assert.deepEqual(defaultScreenProfile().widgets, []);
  assert.equal(defaultScreenProfile().layout.widgetId, null);
  assert.ok(SCREEN_ONLY_KEYS.includes('widgets'));
  assert.ok(LAYOUT_PRESETS.includes('widget'));
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.widgets, []);
  assert.deepEqual(Object.keys(r.value).slice(Object.keys(r.value).indexOf('carousels'), Object.keys(r.value).indexOf('carousels') + 2), ['carousels', 'widgets']);
});

test('validate: image and web widgets round-trip', () => {
  const r = validateConfig(withWidgets([img(), web()]));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.widgets, [img(), web()]);
  const again = validateConfig(r.value);
  assert.deepEqual(again.value.widgets, r.value.widgets);
});

test('validate: bad URLs, schemes, credentials, unknown types and refresh values are errors', () => {
  const cases = [
    [img({ options: { url: 'not a url', refreshSec: 900 } }), 'widgets[0].options.url', 'invalid URL'],
    [img({ options: { url: 'ftp://host/x.png', refreshSec: 900 } }), 'widgets[0].options.url', 'invalid URL'],
    [img({ options: { url: 'https://user:pass@host/x.png', refreshSec: 900 } }), 'widgets[0].options.url', 'credentials not allowed in URL'],
    [img({ options: { url: '', refreshSec: 900 } }), 'widgets[0].options.url', 'URL required'],
    [img({ options: { url: 'https://host/x.png', refreshSec: 7 } }), 'widgets[0].options.refreshSec', null],
    [web({ options: { url: 'https://host/', refreshSec: 1 } }), 'widgets[0].options.refreshSec', null],
    [img({ options: { url: 'https://host/x.png', fit: 'stretch' } }), 'widgets[0].options.fit', null],
  ];
  for (const [w, p, msg] of cases) {
    const r = validateConfig(withWidgets([w]));
    assert.equal(r.ok, false, JSON.stringify(w));
    const e = r.errors.find((x) => x.path === p);
    assert.ok(e, `${p}: ${JSON.stringify(r.errors)}`);
    if (msg) assert.equal(e.message, msg);
  }
  const unknown = validateConfig(withWidgets([{ ...img(), type: 'clock' }]));
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some((e) => e.path === 'widgets[0].type'));
  assert.deepEqual(unknown.value.widgets, []);
  // web pages: 0 (never reload) is fine, images have no 0
  assert.equal(validateConfig(withWidgets([web({ options: { url: 'https://h/', refreshSec: 0 } })])).ok, true);
  assert.equal(validateConfig(withWidgets([img({ options: { url: 'https://h/x.png', refreshSec: 0 } })])).ok, false);
  assert.equal(validateConfig(withWidgets([img({ options: { url: 'https://h/x.png', refreshSec: 1 } })])).ok, true);
});

test('validate: ids (w_ kept, others replaced, duplicates renamed), name default, too many widgets', () => {
  const r = validateConfig(withWidgets([img({ id: 'w_a' }), img({ id: 'v_x' }), img({ id: 'w_a' }), img({ id: undefined, name: '  ' })]));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const ids = r.value.widgets.map((w) => w.id);
  assert.equal(ids[0], 'w_a');
  assert.ok(ids.every((x) => /^w_[A-Za-z0-9_-]+$/.test(x)), ids.join());
  assert.equal(new Set(ids).size, 4);
  assert.equal(r.value.widgets[3].name, 'Widget');
  const many = validateConfig(withWidgets(Array.from({ length: MAX_WIDGETS + 1 }, (_, i) => img({ id: `w_${i}` }))));
  assert.equal(many.ok, false);
  assert.ok(many.errors.some((e) => e.path === 'widgets'));
});

test('validate opts: types, protocols and the shortest refresh a server offers', () => {
  const c = withWidgets([img(), web()]);
  let r = validateConfig(c, { widgetTypes: ['image'] });
  assert.ok(r.errors.some((e) => e.path === 'widgets[1].type' && e.message === 'not available on this server'));
  r = validateConfig(c, { widgetProtocols: ['https:'] });
  assert.ok(r.errors.some((e) => e.path === 'widgets[0].options.url' && e.message === 'https required'));
  assert.ok(!r.errors.some((e) => e.path === 'widgets[1].options.url'));
  for (const sec of [1, 10]) {
    r = validateConfig(withWidgets([img({ options: { url: 'https://h/x.png', refreshSec: sec } })]), { minWidgetRefreshSec: 30 });
    assert.ok(r.errors.some((e) => e.path === 'widgets[0].options.refreshSec' && e.message === 'must be at least 30 seconds'), String(sec));
  }
  assert.equal(validateConfig(withWidgets([img({ options: { url: 'https://h/x.png', refreshSec: 30 } })]), { minWidgetRefreshSec: 30 }).ok, true);
  assert.equal(validateConfig(withWidgets([web({ options: { url: 'https://h/', refreshSec: 0 } })]), { minWidgetRefreshSec: 30 }).ok, true);
});

test('placements: unknown widgets dropped quietly, duplicates removed, defaults, at most six', () => {
  const ws = Array.from({ length: 8 }, (_, i) => img({ id: `w_${i}` }));
  let r = validateConfig(withWidgets(ws, [{ widgetId: 'w_gone' }, { widgetId: 'w_1' }, { widgetId: 'w_1', place: 'side' }, { widgetId: 'w_2', place: 'side', corner: 'tl', size: 'l' }]));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.screens[0].widgets, [
    { widgetId: 'w_1', place: 'corner', corner: 'br', size: 'm' },
    { widgetId: 'w_2', place: 'side', corner: 'tl', size: 'l' },
  ]);
  r = validateConfig(withWidgets(ws, ws.slice(0, 7).map((w) => ({ widgetId: w.id }))));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'screens[0].widgets'));
  assert.equal(r.value.screens[0].widgets.length, 6);
  r = validateConfig(withWidgets(ws, [{ widgetId: 'w_1', place: 'top', size: 'xl' }]));
  assert.ok(r.errors.some((e) => e.path === 'screens[0].widgets[0].place'));
  assert.ok(r.errors.some((e) => e.path === 'screens[0].widgets[0].size'));
  // the full-screen widget: unknown ids become null, the layout itself is valid without one
  r = validateConfig(withWidgets(ws, [], { preset: 'widget', widgetId: 'w_gone' }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.screens[0].layout.preset, 'widget');
  assert.equal(r.value.screens[0].layout.widgetId, null);
  r = validateConfig(withWidgets(ws, [], { preset: 'widget', widgetId: 'w_3' }));
  assert.equal(r.value.screens[0].layout.widgetId, 'w_3');
});

test('deleting a widget prunes its placements and the full-screen layout on save', () => {
  const c = withWidgets([img({ id: 'w_a' }), img({ id: 'w_b' })], [{ widgetId: 'w_a' }, { widgetId: 'w_b' }], { preset: 'widget', widgetId: 'w_a' });
  c.widgets = c.widgets.filter((w) => w.id !== 'w_a');
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.screens[0].widgets.map((p) => p.widgetId), ['w_b']);
  assert.equal(r.value.screens[0].layout.widgetId, null);
});

test('displayConfig: widgets in order, the full-screen one first, direct by default, proxied with widgetSrc, none while private', () => {
  const c = withWidgets([img({ id: 'w_a' }), web({ id: 'w_b' }), img({ id: 'w_c', options: { url: 'https://h/c.png', refreshSec: 10, fit: 'cover', bust: false } })],
    [{ widgetId: 'w_b', place: 'side', corner: 'tl', size: 's' }, { widgetId: 'w_a', place: 'corner', corner: 'br', size: 'l' }], { preset: 'widget', widgetId: 'w_c' });
  const { value } = validateConfig(c);
  const s = value.screens[0];
  const d = displayConfig(value, s);
  assert.deepEqual(d.widgets.map((w) => [w.id, w.place, w.corner, w.size]), [['w_c', 'full', 'br', 'l'], ['w_b', 'side', 'tl', 's'], ['w_a', 'corner', 'br', 'l']]);
  assert.deepEqual(d.widgets[0], { id: 'w_c', type: 'image', name: 'Precios', place: 'full', corner: 'br', size: 'l', refreshSec: 10, fit: 'cover', bust: false, src: 'https://h/c.png', via: 'direct', v: d.widgets[0].v });
  assert.match(d.widgets[0].v, /^[0-9a-f]{8}$/);
  assert.equal(d.widgets[2].src, 'http://192.168.0.20/card.png');
  // not the 'widget' layout: no full entry
  const other = displayConfig(value, { ...s, layout: { ...s.layout, preset: 'bigCalendar' } });
  assert.deepEqual(other.widgets.map((w) => w.id), ['w_b', 'w_a']);
  // proxied (Marco Cloud)
  const px = displayWidgets(value, s, { widgetSrc: (w) => `/api/display/widget/${w.id}` });
  assert.deepEqual(px.map((w) => [w.src, w.via]), [['/api/display/widget/w_c', 'proxy'], ['/api/display/widget/w_b', 'proxy'], ['/api/display/widget/w_a', 'proxy']]);
  // v changes with what the display must load again, not with the name or the fit
  const v = (w) => displayWidgets({ widgets: [w] }, { layout: {}, widgets: [{ widgetId: w.id, place: 'corner', corner: 'br', size: 'm' }] })[0].v;
  const base = img();
  assert.notEqual(v(base), v({ ...base, options: { ...base.options, url: 'http://192.168.0.20/other.png' } }));
  assert.notEqual(v(base), v({ ...base, options: { ...base.options, refreshSec: 60 } }));
  assert.notEqual(v(base), v({ ...base, options: { ...base.options, bust: false } }));
  assert.equal(v(base), v({ ...base, name: 'Otro', options: { ...base.options, fit: 'cover' } }));
  // private: nothing at all
  const priv = displayConfig(value, s, { privacy: { status: { active: true, until: null, source: 'manual' } } });
  assert.equal(priv.privacy.active, true);
  assert.deepEqual(priv.widgets, []);
  assert.deepEqual(displayWidgets(value, s, { isPrivate: true }), []);
  // the flat view carries the screen's placements under `widgets`
  assert.deepEqual(flatView(value, s).widgets, s.widgets);
});

test('mergeDefaults: a config stored before widgets gets them back-filled', () => {
  const old = defaultConfig();
  delete old.widgets;
  delete old.screens[0].widgets;
  delete old.screens[0].layout.widgetId;
  const m = mergeDefaults(old);
  assert.deepEqual(m.widgets, []);
  assert.deepEqual(m.screens[0].widgets, []);
  assert.equal(m.screens[0].layout.widgetId, null);
  assert.equal(validateConfig(m).ok, true);
  // a stored list is kept as is (arrays are replaced, not merged)
  const kept = mergeDefaults(withWidgets([img()], [{ widgetId: 'w_precios', place: 'corner', corner: 'tl', size: 's' }]));
  assert.deepEqual(kept.widgets, [img()]);
  assert.equal(kept.screens[0].widgets[0].corner, 'tl');
});

test('import: widgets are a section of their own and travel with the screens that place them', () => {
  assert.ok(IMPORT_SECTIONS.includes('widgets'));
  const cur = defaultConfig();
  const imp = withWidgets([img()], [{ widgetId: 'w_precios', place: 'corner', corner: 'br', size: 'm' }]);
  const out = mergeImport(cur, imp, ['screens']);
  assert.deepEqual(out.widgets, [img()]);
  assert.equal(validateConfig(out).value.screens[0].widgets.length, 1);
  // a file without widgets keeps the current ones
  const cur2 = withWidgets([img()]);
  const out2 = mergeImport(cur2, defaultConfig(), ['screens'], new Set(['widgets']));
  assert.deepEqual(out2.widgets, [img()]);
});

test('image helpers: magic bytes, sizes, SVG never an image', () => {
  assert.equal(sniffWidgetImage(pngHead(10, 20)), 'image/png');
  assert.equal(sniffWidgetImage(gifHead(10, 20)), 'image/gif');
  assert.equal(sniffWidgetImage(jpegHead(10, 20)), 'image/jpeg');
  assert.equal(sniffWidgetImage(webpHead(10, 20)), 'image/webp');
  assert.equal(sniffWidgetImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffWidgetImage(Buffer.from('<html></html>')), null);
  assert.equal(sniffWidgetImage(null), null);
  const still = (w, h) => ({ w, h, frames: 1, area: w * h });
  assert.deepEqual(widgetImageInfo(pngHead(640, 480)), still(640, 480));
  assert.deepEqual(widgetImageInfo(gifHead(320, 200)), still(320, 200));
  assert.deepEqual(widgetImageInfo(jpegHead(1024, 768)), still(1024, 768));
  assert.deepEqual(widgetImageInfo(webpHead(300, 150)), still(300, 150));
  assert.equal(widgetImageInfo(pngHead(1, 1).subarray(0, 18)), null);
  assert.equal(looksLikeSvg(Buffer.from('  <svg viewBox="0 0 1 1"/>')), true);
  assert.equal(looksLikeSvg(Buffer.from('<?xml version="1.0"?><svg/>')), true);
  assert.equal(looksLikeSvg(Buffer.from('<?xml version="1.0"?><rss/>')), false);
});

test('framing headers: X-Frame-Options and frame-ancestors', () => {
  assert.equal(refusesFraming({ 'x-frame-options': 'DENY' }), true);
  assert.equal(refusesFraming({ 'x-frame-options': 'SAMEORIGIN' }), true);
  assert.equal(refusesFraming({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }), true);
  assert.equal(refusesFraming({ 'content-security-policy': 'frame-ancestors *' }), false);
  assert.equal(refusesFraming({ 'content-security-policy': "default-src 'self'" }), false);
  assert.equal(refusesFraming({}), false);
});

/** A local "LAN" server with the cases the test endpoint must tell apart. */
async function withOrigin(fn) {
  const png = Buffer.concat([pngHead(400, 300), Buffer.alloc(100)]);
  const srv = http.createServer((req, res) => {
    const u = req.url;
    if (u === '/card.png') return res.writeHead(200, { 'content-type': 'text/plain' }).end(png); // the type is ignored
    if (u === '/anim.gif') return res.writeHead(200, { 'content-type': 'image/gif' }).end(Buffer.concat([gifHead(64, 32), Buffer.alloc(20)]));
    if (u === '/logo.svg') return res.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    if (u === '/page.html') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>hi</body></html>');
    if (u === '/deny.html') return res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' }).end('<html></html>');
    if (u === '/big.html') return res.writeHead(200, { 'content-type': 'text/html' }).end('x'.repeat(400 * 1024));
    if (u === '/private') return res.writeHead(403).end();
    if (u === '/broken') return res.writeHead(500).end();
    if (u === '/r1') return res.writeHead(302, { location: '/card.png' }).end();
    if (u.startsWith('/loop')) return res.writeHead(302, { location: `/loop${u.length}` }).end();
    if (u === '/to-ftp') return res.writeHead(302, { location: 'ftp://example.com/x' }).end();
    if (u === '/slow') return setTimeout(() => res.writeHead(200).end(png), 2000);
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    await fn(base);
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
}

test('testWidget: images, pages, HTTP errors, redirects, timeouts, warnings', async () => {
  await withOrigin(async (base) => {
    assert.deepEqual(await testWidget({ type: 'image', url: `${base}/card.png` }), { ok: true, format: 'png', width: 400, height: 300, bytes: 133, warnings: [] });
    assert.deepEqual(await testWidget({ type: 'image', url: `${base}/r1` }), { ok: true, format: 'png', width: 400, height: 300, bytes: 133, warnings: [] });
    const gif = await testWidget({ type: 'image', url: `${base}/anim.gif` });
    assert.equal(gif.ok, true);
    assert.equal(gif.format, 'gif');
    assert.equal(gif.width, 64);
    const svg = await testWidget({ type: 'image', url: `${base}/logo.svg` });
    assert.equal(svg.ok, true, 'a TV loads an SVG in an <img>: allowed on a self-hosted server');
    assert.equal(svg.format, 'svg');
    assert.equal((await testWidget({ type: 'image', url: `${base}/page.html` })).error, 'not_image');
    assert.equal((await testWidget({ type: 'image', url: `${base}/nope.png` })).error, 'http_not_found');
    assert.equal((await testWidget({ type: 'image', url: `${base}/private` })).error, 'http_denied');
    assert.equal((await testWidget({ type: 'image', url: `${base}/broken` })).error, 'http_error');
    assert.equal((await testWidget({ type: 'image', url: `${base}/loop` })).error, 'too_many_redirects');
    assert.equal((await testWidget({ type: 'image', url: `${base}/to-ftp` })).error, 'invalid_url');
    assert.equal((await testWidget({ type: 'image', url: `${base}/slow`, timeoutMs: 300 })).error, 'timeout');
    assert.equal((await testWidget({ type: 'image', url: 'http://127.0.0.1:1/x.png' })).error, 'fetch_failed');
    assert.equal((await testWidget({ type: 'image', url: 'ftp://x/y' })).error, 'invalid_url');
    assert.equal((await testWidget({ type: 'image', url: 'http://u:p@x/y' })).error, 'invalid_url');
    assert.equal((await testWidget({ type: 'clock', url: `${base}/card.png` })).error, 'invalid_type');
    // pages: framing refused, a long page read in part, same origin and http on an https panel
    assert.deepEqual(await testWidget({ type: 'web', url: `${base}/page.html` }), { ok: true, warnings: [] });
    assert.deepEqual((await testWidget({ type: 'web', url: `${base}/deny.html` })).warnings, ['refuses_framing']);
    assert.equal((await testWidget({ type: 'web', url: `${base}/big.html` })).ok, true);
    const host = new URL(base).host;
    assert.deepEqual((await testWidget({ type: 'web', url: `${base}/page.html`, host, secure: true })).warnings, ['http_on_https', 'same_origin']);
  });
});

test('POST /api/admin/test/widget: admin session and CSRF guard required', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-widgets-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret123'), passwordIsDefault: false }));
  store.initStore(dir);
  await ensurePassword();
  const app = express();
  app.use(sessionMiddleware());
  app.use(express.json());
  app.use(['/api/admin', '/api/auth'], csrfGuard());
  app.post('/api/auth/login', (req, res, next) => loginHandler(req, res).catch(next));
  app.use('/api/admin', adminRouter());
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((x) => x.split(';')[0]).join('; ');
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    await withOrigin(async (origin) => {
      assert.equal((await call('POST', '/api/admin/test/widget', { type: 'image', url: `${origin}/card.png` })).status, 401);
      assert.equal((await call('POST', '/api/auth/login', { password: 'secret123' })).status, 200);
      const ok = await call('POST', '/api/admin/test/widget', { type: 'image', url: `${origin}/card.png` });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.ok, true);
      assert.equal(ok.json.width, 400);
      // a bad address is an answer, not a 4xx
      const bad = await call('POST', '/api/admin/test/widget', { type: 'image', url: 'nope' });
      assert.equal(bad.status, 200);
      assert.deepEqual(bad.json, { ok: false, error: 'invalid_url' });
      assert.equal((await call('POST', '/api/admin/test/widget', { type: 'image', url: `${origin}/card.png` }, { 'sec-fetch-site': 'cross-site' })).status, 403);
      // the saved config takes widgets
      const cfg = (await call('GET', '/api/admin/config')).json;
      cfg.widgets = [img({ options: { url: `${origin}/card.png`, refreshSec: 1, fit: 'contain', bust: true } })];
      cfg.screens[0].widgets = [{ widgetId: 'w_precios', place: 'corner', corner: 'tr', size: 's' }];
      const saved = await call('PUT', '/api/admin/config', cfg);
      assert.equal(saved.status, 200, JSON.stringify(saved.json));
      assert.equal(saved.json.screens[0].widgets[0].corner, 'tr');
    });
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('display: containers, z-order, sandbox, same-origin refusal, privacy, preset and i18n', () => {
  const html = read('web/index.html');
  assert.match(html, /<div id="uw-side"><\/div>/);
  assert.match(html, /<div id="uw-full"><\/div>/);
  // the corners live inside #app: night dimming, alerts and the doorbell (after #app) cover them
  assert.ok(html.indexOf('id="uw-corners"') < html.indexOf('id="night"'));
  const mod = read('web/display/widgets/custom.ts');
  assert.match(mod, /setAttribute\('sandbox', 'allow-scripts allow-same-origin'\)/);
  assert.doesNotMatch(mod, /allow-top-navigation|allow-popups|allow-forms|allow-modals|allow-downloads/);
  assert.match(mod, /referrerPolicy = 'no-referrer'/);
  assert.match(mod, /if \(!webUrl\(e\.w\.src\) \|\| e\.w\.via !== 'direct' \|\| sameOrigin\(e\.w\.src\)\)/);
  // only http(s) addresses are ever loaded (a javascript: one in the unsaved preview would run on this origin)
  assert.match(mod, /if \(!w \|\| typeof w\.id !== 'string' \|\| !webUrl\(w\.src\)\) return false;/);
  // price and currency widgets carry no address (the display asks this server for the prices and the rates)
  assert.match(read('web/admin/livePreview.ts'), /cfg\.widgets\.filter\(\(w\) => w\.type === 'prices' \|\| w\.type === 'currency' \|\| w\.via !== 'direct' \|\| !widgetUrlProblem\(w\.src\)\)/);
  assert.match(mod, /cfg\.privacy\?\.active/);
  const main = read('web/display/main.ts');
  assert.match(main, /custom\.render\(cfg, preset\)/);
  assert.match(main, /'widget',/);
  const css = read('web/display/styles.css');
  assert.match(css, /#uw-corners \{[^}]*pointer-events: none/);
  assert.match(css, /\.preset-widget \.main > :not\(#uw-full\)/);
  const i18n = read('web/shared/i18n.ts');
  for (const s of ["widgetStale: 'sin actualizar'", "widgetStale: 'not updated'", "widgetStale: 'sem atualização'", "widgetNone: 'Elige un widget en Diseño'", "widgetSaveToSee: 'Se verá al guardar'"]) assert.ok(i18n.includes(s), s);
  // the carousel's still copy never loads a widget page again
  assert.match(read('web/display/screenSwitch.ts'), /HTMLIFrameElement\) d\.removeAttribute\('src'\)/);
});

test('admin: section, nav entry, Diseño card, contract mirrors and every string translated', () => {
  assert.match(read('web/admin/App.tsx'), /\n {2}widgets: WidgetsSection,/);
  const nav = read('web/admin/navFilter.ts');
  assert.match(nav, /\{ id: 'widgets', label: 'Widgets', icon: 'widget', group: 'Contenido', feature: 'widgets'/);
  assert.ok(nav.indexOf("id: 'news'") < nav.indexOf("id: 'widgets'") && nav.indexOf("id: 'widgets'") < nav.indexOf("id: 'todo'"));
  // Marco Cloud: no web pages, no refresh below its minimum, https only, its own image route in the preview
  const sec = read('web/admin/sections/Widgets.tsx');
  assert.match(sec, /has\('webWidgets'\)/);
  assert.match(sec, /limit\('widgetMinRefreshSec'\)/);
  assert.match(sec, /widgetUrlProblem\(w\.options\.url, cloud\)/);
  assert.match(read('web/admin/livePreview.ts'), /cloud \? \(w: WidgetDef\) => `\/api\/display\/widget\/\$\{encodeURIComponent\(w\.id\)\}`/);
  assert.match(read('web/admin/Preview.tsx'), /type: 'marco:preview-widget', id: pv\.id, v: pv\.v, blob/);
  assert.match(read('web/admin/sections/Layout.tsx'), /has\('widgets'\) && <ScreenWidgetsCard/);
  assert.match(read('web/admin/components/icons.tsx'), /\n {2}widget: '/);
  assert.match(read('web/admin/api.ts'), /testWidget: \(type: WidgetType, url: string\) => request<TestWidgetResponse>\('POST', '\/api\/admin\/test\/widget'/);
  const layout = read('web/admin/sections/Layout.tsx');
  assert.match(layout, /id="layout-widgets"/);
  assert.match(layout, /id === 'widget'/);
  assert.match(read('web/shared/screens.ts'), /SCREEN_ONLY_KEYS = \['screen', 'layout', 'background', 'message', 'alerts', 'privacy', 'widgets', 'canvas'\]/);
  const dict = read('web/admin/i18n-dict-widgets.ts');
  assert.match(read('web/admin/i18n-dict.ts'), /\.\.\.ROWS_WIDGETS/);
  const all = fs.readdirSync(new URL('../../web/admin/', import.meta.url)).filter((f) => f.startsWith('i18n-dict')).map((f) => read(`web/admin/${f}`)).join('\n');
  const src = read('web/admin/sections/Widgets.tsx') + read('web/admin/sections/Layout.tsx').slice(read('web/admin/sections/Layout.tsx').indexOf('const SIZES'));
  for (const m of src.matchAll(/\bt\('([^']+)'/g)) {
    if (m[1].length < 3 || /^\d/.test(m[1])) continue;
    assert.ok(all.includes(`['${m[1]}',`) || all.includes(`'${m[1]}',`), `no en/pt for "${m[1]}"`);
  }
  assert.doesNotMatch(dict, /\u2014/, 'no em dashes');
});

test('validate: widget URLs must be written out plainly and are stored normalised', () => {
  const bad = [
    'javascript:alert(1)', ' javascript:alert(1)', 'JavaScript:alert(1)', '\njavascript:alert(1)', 'java\tscript:alert(1)',
    'data:image/png;base64,AAAA', 'vbscript:x', 'file:///etc/passwd', 'blob:https://h/x', 'about:blank', '//host/x.png',
    'ftp://host/x', 'ws://host/x', 'https:evil.com', 'http:\\\\evil.com', 'https://evil.com/\r\nSet-Cookie: x=1',
    "https://evil.com/'; script-src *", 'https://evil.com/"><img src=x onerror=alert(1)>', 'https://h/a b', 'https://h/a\tb',
    'https://h/a\\b', 'http:///x', 'https://',
  ];
  for (const url of bad) {
    const r = validateConfig(withWidgets([img({ options: { url, refreshSec: 900 } })]));
    assert.ok(r.errors.some((e) => e.path === 'widgets[0].options.url' && e.message === 'invalid URL'), JSON.stringify(url));
  }
  for (const url of ['http://@evil.com/x.png', 'https://user@host/x.png', 'https://u:p@host/x.png']) {
    const r = validateConfig(withWidgets([img({ options: { url, refreshSec: 900 } })]));
    assert.ok(r.errors.some((e) => e.message === 'credentials not allowed in URL'), url);
  }
  const r = validateConfig(withWidgets([img({ options: { url: 'HTTPS://Example.COM:443/a/../tarjeta ok.png'.replace(' ', '%20'), refreshSec: 900 } })]));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.widgets[0].options.url, 'https://example.com/tarjeta%20ok.png');
  assert.equal(validateConfig(withWidgets([img({ options: { url: 'https://h/x.png', refreshSec: 900 } })], [], {}), { widgetProtocols: ['https:'] }).ok, true);
});

/** A GIF: logical screen w x h, then image descriptors of the given sizes (each with one empty data block). */
function gifFrames(w, h, frames) {
  const parts = [gifHead(w, h)];
  for (const [fw, fh, left = 0, top = 0] of frames) {
    const d = Buffer.alloc(10);
    d[0] = 0x2c;
    d.writeUInt16LE(left, 1);
    d.writeUInt16LE(top, 3);
    d.writeUInt16LE(fw, 5);
    d.writeUInt16LE(fh, 7);
    // a comment extension between frames, an LZW code size and one tiny data block
    parts.push(Buffer.from([0x21, 0xfe, 0x02, 0x68, 0x69, 0x00]), d, Buffer.from([0x02, 0x01, 0x00, 0x00]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

test('image helpers: a GIF frame larger than its header, animations and 0-pixel images', () => {
  // a 1x1 header hiding an 8000x8000 frame (browsers decode it at the frame's size)
  assert.deepEqual(widgetImageInfo(gifFrames(1, 1, [[8000, 8000]])), { w: 8000, h: 8000, frames: 1, area: 64_000_000 });
  assert.deepEqual(widgetImageInfo(gifFrames(10, 10, [[4, 4, 9000, 0]])), { w: 9004, h: 10, frames: 1, area: 90040 });
  const anim = widgetImageInfo(gifFrames(100, 100, Array.from({ length: 300 }, () => [100, 100])));
  assert.equal(anim.frames, 300);
  assert.equal(anim.area, 3_000_000);
  // a global colour table is skipped
  const g = gifFrames(2, 2, [[2, 2]]);
  const withTable = Buffer.concat([g.subarray(0, 13), Buffer.alloc(6), g.subarray(13)]);
  withTable[10] = 0x80;
  assert.deepEqual(widgetImageInfo(withTable), { w: 2, h: 2, frames: 1, area: 4 });
  // 0 wide or high: not an image a screen can show
  assert.equal(widgetImageInfo(jpegHead(1920, 0)), null);
  assert.equal(widgetImageInfo(pngHead(0, 1)), null);
  assert.equal(widgetImageInfo(gifHead(0, 5)), null);
  // animated WebP: the canvas and every ANMF frame (offset + size)
  const anmf = (x, y, w, h) => {
    const c = Buffer.alloc(8 + 16);
    c.write('ANMF', 0, 'latin1');
    c.writeUInt32LE(16, 4);
    c.writeUIntLE(x / 2, 8, 3);
    c.writeUIntLE(y / 2, 11, 3);
    c.writeUIntLE(w - 1, 14, 3);
    c.writeUIntLE(h - 1, 17, 3);
    return c;
  };
  const awebp = Buffer.concat([webpHead(10, 10), anmf(0, 0, 10, 10), anmf(2, 0, 8000, 6000)]);
  awebp.writeUInt32LE(10, 16); // VP8X chunk size
  awebp[20] = 0x02; // VP8X: animation
  assert.deepEqual(widgetImageInfo(awebp), { w: 8002, h: 6000, frames: 2, area: 8002 * 6000 });
  // APNG: the frame count from acTL
  const actl = Buffer.alloc(20);
  actl.writeUInt32BE(8, 0);
  actl.write('acTL', 4, 'latin1');
  actl.writeUInt32BE(50, 8);
  const apng = Buffer.concat([pngHead(100, 100), actl]);
  assert.deepEqual(widgetImageInfo(apng), { w: 100, h: 100, frames: 50, area: 500_000 });
});

test('frame guard: pages of this server load in a frame only as the admin preview of a display', async () => {
  const { frameGuard } = await import('../app.js');
  const app = express();
  app.use(frameGuard);
  app.get(['/', '/admin', '/d/:key'], (req, res) => res.send('page'));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async (p, h = {}) => (await fetch(base + p, { headers: h })).status;
    const iframe = (site) => ({ 'sec-fetch-dest': 'iframe', 'sec-fetch-site': site });
    assert.equal(await get('/?preview=1&screen=living-room', iframe('same-origin')), 200);
    assert.equal(await get('/d/abc?preview=1', iframe('same-origin')), 200);
    // a widget page that redirects or navigates its frame here: cross-site initiator
    assert.equal(await get('/?preview=1', iframe('cross-site')), 403);
    assert.equal(await get('/admin', iframe('same-origin')), 403);
    assert.equal(await get('/?screen=living-room', iframe('same-origin')), 403);
    assert.equal(await get('/d/abc', iframe('cross-site')), 403);
    assert.equal(await get('/admin', { 'sec-fetch-dest': 'object', 'sec-fetch-site': 'same-origin' }), 403);
    const refused = await fetch(base + '/admin', { headers: iframe('cross-site') });
    assert.match(refused.headers.get('content-security-policy'), /sandbox/);
    // top-level loads and browsers without Sec-Fetch-* are unaffected
    assert.equal(await get('/admin', { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' }), 200);
    assert.equal(await get('/admin'), 200);
  } finally {
    server.close();
  }
});
