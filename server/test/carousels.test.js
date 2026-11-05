// Carousels: validation and pruning, the epoch slot clock, schedules (overnight windows, off-schedule screen, night
// hold), and the display side of the server: a key or device bound to a carousel reads its screens and only those,
// live events for any of its screens reach it, and a display bound to a plain screen answers exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import {
  carouselSlot, carouselPhase, carouselBlock, carouselMembers, findTarget, isTargetId, offScreenOf, pruneCarousels, cycleMs,
  targetInfo, CAROUSEL_DOTS, DEFAULT_DOTS, dotsOf,
} from '../core/carousels.js';
import { matches } from '../sse.js';
import { alertsFilter } from '../core/announceCore.js';
import { mergeImport, importPreview } from '../core/backupsCore.js';
import { screenTemplate } from '../routes/screens.js';
import { hashPassword, ensurePassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll, broadcast } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetAnnouncements } from '../announce.js';
import { _resetActivityThrottle } from '../activity.js';
import { syncDisplayKeys, onDisplayAccessConfig, listDisplayLinks, _resetDisplayAccess, createDevice, requestScreen } from '../displayAccess.js';
import { _resetPairing } from '../pairing.js';

const TZ = 'Europe/Lisbon';

/** A config with three screens and the given carousels (validated). */
function config(carousels = [], mutate = () => {}) {
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  c.screens.push(defaultScreenProfile({ id: 's_photos', slug: 'photos', name: 'Photos' }));
  c.carousels = { items: carousels };
  mutate(c);
  return c;
}

const LOOP = { id: 'v_loop', name: 'Loop', slug: 'loop', steps: [{ screenId: 's_main', seconds: 60 }, { screenId: 's_kitchen', seconds: 20 }, { screenId: 's_photos', seconds: 20 }] };

test('validation: defaults, limits, seconds bounds, unknown screens pruned, empty carousel turned off', () => {
  const r = validateConfig(config([
    { name: 'Loop', steps: [{ screenId: 's_main' }, { screenId: 's_kitchen', seconds: 5 }, { screenId: 's_gone', seconds: 30 }], offScreenId: 's_gone' },
    { name: 'Empty', steps: [{ screenId: 's_gone' }] },
  ]));
  assert.deepEqual(r.errors.map((e) => e.path), ['carousels.items[0].steps[1].seconds']);
  const [a, b] = r.value.carousels.items;
  assert.match(a.id, /^v_/);
  assert.equal(a.slug, 'loop');
  assert.equal(a.enabled, true);
  assert.equal(a.transition, 'fade');
  assert.equal(a.holdOnAlert, true);
  assert.equal(a.nightRotate, false);
  assert.deepEqual(a.schedule, []);
  assert.deepEqual(a.steps, [{ screenId: 's_main', seconds: 30 }, { screenId: 's_kitchen', seconds: 30 }]);
  assert.equal(a.offScreenId, null, 'a deleted off-schedule screen falls back to the first step');
  assert.equal(b.enabled, false);
  assert.deepEqual(b.steps, []);
  // too many carousels, too many steps
  const many = validateConfig(config(Array.from({ length: 7 }, (_, i) => ({ name: `C${i}`, steps: [{ screenId: 's_main' }] }))));
  assert.ok(many.errors.some((e) => e.path === 'carousels.items' && /max 6/.test(e.message)));
  const long = validateConfig(config([{ name: 'Long', steps: Array.from({ length: 13 }, () => ({ screenId: 's_main', seconds: 10 })) }]));
  assert.ok(long.errors.some((e) => e.path === 'carousels.items[0].steps'));
  // schedule rules use the privacy rule shape
  const sch = validateConfig(config([{ name: 'S', steps: [{ screenId: 's_main' }], schedule: [{ days: [1, 2], from: '08:00', to: '08:00' }] }]));
  assert.deepEqual(sch.errors.map((e) => e.path), ['carousels.items[0].schedule[0].to']);
});

test('touch settings (#40): off for carousels saved before them, kept when valid, junk is an error and off', () => {
  const old = validateConfig(config([LOOP]));
  assert.deepEqual(old.errors, []);
  const o = old.value.carousels.items[0];
  assert.equal(o.swipe, false);
  assert.equal(o.holdPause, false);
  assert.equal(o.dots, 'off');
  assert.deepEqual(CAROUSEL_DOTS, ['off', 'touch', 'always']);
  assert.equal(DEFAULT_DOTS, 'off');
  for (const dots of CAROUSEL_DOTS) {
    const r = validateConfig(config([{ ...LOOP, swipe: true, holdPause: true, dots }]));
    assert.deepEqual(r.errors, []);
    assert.deepEqual([r.value.carousels.items[0].swipe, r.value.carousels.items[0].holdPause, r.value.carousels.items[0].dots], [true, true, dots]);
  }
  const bad = validateConfig(config([{ ...LOOP, swipe: 'yes', holdPause: 1, dots: 'sparkle' }]));
  assert.deepEqual(bad.errors.map((e) => e.path).sort(), ['carousels.items[0].dots', 'carousels.items[0].holdPause', 'carousels.items[0].swipe']);
  assert.deepEqual([bad.value.carousels.items[0].swipe, bad.value.carousels.items[0].holdPause, bad.value.carousels.items[0].dots], [false, false, 'off']);
  // the display block: strict true, dots normalized, defaults for a raw item with no keys
  const cfg = config();
  const raw = carouselBlock(cfg, LOOP);
  assert.deepEqual([raw.swipe, raw.holdPause, raw.dots], [false, false, 'off']);
  const on = carouselBlock(cfg, { ...LOOP, swipe: true, holdPause: true, dots: 'touch' });
  assert.deepEqual([on.swipe, on.holdPause, on.dots], [true, true, 'touch']);
  const junk = carouselBlock(cfg, { ...LOOP, swipe: 'true', holdPause: 1, dots: 'sparkle' });
  assert.deepEqual([junk.swipe, junk.holdPause, junk.dots], [false, false, 'off']);
  assert.equal(dotsOf(undefined), 'off');
});

test('slugs: a clash with a screen is an error, never a silent suffix; carousel clashes get -2', () => {
  const r = validateConfig(config([{ name: 'Kitchen', steps: [{ screenId: 's_main' }] }]));
  assert.deepEqual(r.errors.map((e) => e.path), ['carousels.items[0].slug']);
  const two = validateConfig(config([{ name: 'Loop', steps: [{ screenId: 's_main' }] }, { name: 'Loop', steps: [{ screenId: 's_main' }] }]));
  assert.equal(two.ok, true);
  assert.deepEqual(two.value.carousels.items.map((c) => c.slug), ['loop', 'loop-2']);
});

test('older configs: mergeDefaults back-fills an empty list, and saving keeps the section', () => {
  const old = defaultConfig();
  delete old.carousels;
  assert.deepEqual(mergeDefaults(old).carousels, { items: [] });
  const r = validateConfig(config([LOOP]));
  assert.equal(r.ok, true);
  assert.equal(r.value.carousels.items[0].id, 'v_loop');
  assert.equal(validateConfig(r.value).value.carousels.items.length, 1);
});

test('pruning: deleting a screen drops its steps; members and the off screen follow', () => {
  const cfg = validateConfig(config([{ ...LOOP, offScreenId: 's_photos' }])).value;
  assert.deepEqual(carouselMembers(cfg, cfg.carousels.items[0]), ['s_main', 's_kitchen', 's_photos']);
  const pruned = pruneCarousels(cfg.carousels.items, ['s_main', 's_kitchen']);
  assert.deepEqual(pruned[0].steps.map((s) => s.screenId), ['s_main', 's_kitchen']);
  assert.equal(pruned[0].offScreenId, null);
  assert.equal(pruned[0].enabled, true);
  assert.equal(pruneCarousels(cfg.carousels.items, [])[0].enabled, false);
  const after = validateConfig({ ...cfg, screens: cfg.screens.filter((s) => s.id !== 's_photos') }).value;
  assert.equal(offScreenOf(after, after.carousels.items[0]), 's_main');
});

test('slot clock: anchored at the epoch, exact boundaries, same answer for two displays, large epochs', () => {
  const steps = [{ screenId: 'a', seconds: 60 }, { screenId: 'b', seconds: 20 }, { screenId: 'c', seconds: 20 }];
  assert.equal(cycleMs(steps), 100_000);
  assert.deepEqual(carouselSlot(steps, 0), { index: 0, screenId: 'a', startsAt: 0, endsAt: 60_000, cycleMs: 100_000 });
  assert.equal(carouselSlot(steps, 59_999).screenId, 'a');
  assert.equal(carouselSlot(steps, 60_000).screenId, 'b');
  assert.equal(carouselSlot(steps, 80_000).screenId, 'c');
  assert.equal(carouselSlot(steps, 100_000).screenId, 'a');
  const t = Date.parse('2026-10-11T10:00:07.123Z');
  const s1 = carouselSlot(steps, t);
  const s2 = carouselSlot(steps, t);
  assert.deepEqual(s1, s2);
  assert.ok(s1.startsAt <= t && t < s1.endsAt);
  assert.equal(carouselSlot(steps, s1.endsAt).index, (s1.index + 1) % 3);
  assert.equal(carouselSlot([], t), null);
});

test('phase: schedule windows (overnight too), off screen outside them, night hold, disabled', () => {
  const cfg = validateConfig(config([{ ...LOOP, offScreenId: 's_photos', schedule: [{ days: [], from: '22:00', to: '07:00' }] }])).value;
  const block = carouselBlock(cfg, cfg.carousels.items[0]);
  assert.equal(block.offScreenId, 's_photos');
  // 12:00 Lisbon (summer, +01:00) is outside 22:00-07:00
  const noon = Date.parse('2026-07-01T11:00:00Z');
  const off = carouselPhase(block, noon, { tz: TZ });
  assert.equal(off.mode, 'off');
  assert.equal(off.screenId, 's_photos');
  assert.equal(off.endsAt, Date.parse('2026-07-01T22:00:00+01:00'), 'switches exactly when the window starts');
  // 23:30 is inside: rotating, and a slot never runs past 07:00
  const late = Date.parse('2026-07-01T22:30:00Z');
  const on = carouselPhase(block, late, { tz: TZ });
  assert.equal(on.mode, 'rotate');
  assert.ok(on.endsAt <= Date.parse('2026-07-02T07:00:00+01:00'));
  const lastSlot = carouselPhase(block, Date.parse('2026-07-02T05:59:59Z'), { tz: TZ });
  assert.equal(lastSlot.endsAt, Date.parse('2026-07-02T07:00:00+01:00'));
  assert.equal(carouselPhase(block, Date.parse('2026-07-02T06:00:00Z'), { tz: TZ }).mode, 'off');
  // night mode holds the off screen unless nightRotate
  assert.equal(carouselPhase(block, late, { tz: TZ, night: true }).mode, 'night');
  assert.equal(carouselPhase(block, late, { tz: TZ, night: true }).screenId, 's_photos');
  assert.equal(carouselPhase({ ...block, nightRotate: true }, late, { tz: TZ, night: true }).mode, 'rotate');
  // no schedule: always rotating, the slot decides
  const always = { ...block, schedule: [] };
  assert.equal(carouselPhase(always, noon, { tz: TZ }).mode, 'rotate');
  assert.equal(carouselPhase(always, noon, { tz: TZ }).endsAt, carouselSlot(always.steps, noon).endsAt);
  assert.equal(carouselPhase({ ...always, enabled: false }, noon, { tz: TZ }).mode, 'paused');
  assert.equal(carouselPhase({ ...always, enabled: false }, noon, { tz: TZ }).screenId, 's_main');
});

test('targets: screens first, then carousels; live matching and the alerts filter use the carousel screens', () => {
  const cfg = validateConfig(config([LOOP], (c) => { c.screens[2].alerts.enabled = false; })).value;
  assert.equal(findTarget(cfg, 'kitchen').kind, 'screen');
  assert.equal(findTarget(cfg, 'LOOP').kind, 'carousel');
  assert.equal(findTarget(cfg, 'v_loop').id, 'v_loop');
  assert.equal(findTarget(cfg, 'nope'), null);
  assert.equal(isTargetId(cfg, 'v_loop'), true);
  assert.equal(isTargetId(cfg, 'v_nope'), false);
  const client = { clientId: 'tv-1', screenId: 'v_loop', memberIds: ['s_main', 's_kitchen', 's_photos'] };
  assert.equal(matches(client, { screenIds: ['s_kitchen'] }), true);
  assert.equal(matches(client, { screenIds: ['v_loop'] }), true);
  assert.equal(matches(client, { screenIds: ['s_other'] }), false);
  assert.equal(matches({ clientId: 'tv-2', screenId: 's_main' }, { screenIds: ['s_kitchen'] }), false);
  assert.equal(alertsFilter(cfg)({ screenId: 's_photos' }), false);
  assert.equal(alertsFilter(cfg)(client), true);
});

test('requestScreen: a carousel binding serves its screens and only those', () => {
  const cfg = validateConfig(config([{ ...LOOP, steps: LOOP.steps.slice(0, 2) }])).value;
  const bound = (screen) => requestScreen(cfg, { displayAccess: { screenId: 'v_loop' }, query: { screen } });
  assert.equal(bound('s_kitchen').screen.id, 's_kitchen');
  assert.equal(bound('kitchen').carousel.id, 'v_loop');
  assert.ok(['s_main', 's_kitchen'].includes(bound('photos').screen.id), 'a screen outside the carousel is never served');
  assert.ok(['s_main', 's_kitchen'].includes(bound('').screen.id));
  // open mode: the carousel slug, or a screen with via=
  assert.equal(requestScreen(cfg, { query: { screen: 'loop' } }).carousel.id, 'v_loop');
  assert.equal(requestScreen(cfg, { query: { screen: 's_kitchen', via: 'loop' } }).carousel.id, 'v_loop');
  assert.equal(requestScreen(cfg, { query: { screen: 'photos', via: 'loop' } }).carousel, null);
  // a screen binding is unchanged
  const plain = requestScreen(cfg, { displayAccess: { screenId: 's_main' }, query: { screen: 'kitchen' } });
  assert.equal(plain.screen.id, 's_main');
  assert.equal(plain.carousel, null);
});

test('import: carousels travel with the screens', () => {
  const cur = validateConfig(config([])).value;
  const imp = validateConfig(config([LOOP])).value;
  assert.equal(mergeImport(cur, imp, ['screens']).carousels.items.length, 1);
  assert.equal(mergeImport(cur, imp, ['calendar']).carousels.items.length, 0);
  assert.equal(mergeImport(cur, imp, ['screens'], new Set(['carousels'])).carousels.items.length, 0);
});

test('ids: a carousel id is always "v_" and never a screen id; a screen never takes "v_"', () => {
  const r = validateConfig(config([{ ...LOOP, id: 's_main' }, { ...LOOP, id: 'plain', slug: 'loop2' }], (c) => {
    c.screens[2].id = 'v_photos';
  }));
  const [a, b] = r.value.carousels.items;
  const screenIds = r.value.screens.map((s) => s.id);
  assert.match(a.id, /^v_/);
  assert.match(b.id, /^v_/);
  assert.ok(!screenIds.includes(a.id));
  assert.ok(screenIds.every((id) => !id.startsWith('v_')), 'a screen with a v_ id gets a new one');
  assert.equal(targetInfo(r.value, a.id).kind, 'carousel');
  // ids that already follow the rules are kept
  assert.equal(validateConfig(config([LOOP])).value.carousels.items[0].id, 'v_loop');
});

test('slugs: a new screen and an import never take a carousel address', () => {
  const cfg = validateConfig(config([{ ...LOOP, name: 'Cocina', slug: 'cocina' }])).value;
  const p = screenTemplate(cfg, 'Cocina');
  assert.equal(p.slug, 'cocina-2');
  cfg.screens.push(p);
  assert.equal(validateConfig(cfg).ok, true);
  // an older file without carousels: the current carousel keeps working under a free address
  const imp = validateConfig(config([], (c) => { c.screens[1].slug = 'cocina'; })).value;
  const out = mergeImport(cfg, imp, ['screens'], new Set(['carousels']));
  assert.equal(out.carousels.items[0].slug, 'cocina-2');
  const v = validateConfig(out);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('import preview: a carousel whose private link changes is listed', () => {
  const cur = validateConfig(config([LOOP])).value;
  const key = (k) => ({ key: k, createdAt: '2026-01-01T00:00:00.000Z' });
  const bundle = {
    format: 'marco-backup', config: cur,
    secrets: { displayKeys: { v_loop: key('0b6c1f9e-3d2a-4c8b-9e7f-1a2b3c4d5e6f') } },
  };
  const pv = importPreview(bundle, cur, 'en', { displayKeys: { v_loop: key('1b6c1f9e-3d2a-4c8b-9e7f-1a2b3c4d5e6f') } });
  assert.deepEqual(pv.secretsImpact.linksChanged, ['Loop']);
});

test('alerts filter: only the carousel screens the announcement targets count (same as the replay)', () => {
  const cfg = validateConfig(config([], (c) => { c.screens[0].alerts.enabled = false; })).value;
  const client = { clientId: 'tv-1', screenId: 'v_loop', memberIds: ['s_main', 's_kitchen'] };
  assert.equal(alertsFilter(cfg, ['s_main'])(client), false, 'aimed at a screen with alerts off');
  assert.equal(alertsFilter(cfg, ['s_kitchen'])(client), true);
  assert.equal(alertsFilter(cfg, [])(client), true, 'every screen');
  assert.equal(alertsFilter(cfg, ['v_loop'])(client), true, 'the carousel itself');
});

test('empty carousel: its link reads a blank screen, never the default one', () => {
  const cfg = validateConfig(config([{ ...LOOP, steps: [{ screenId: 's_photos', seconds: 30 }] }], (c) => {
    c.screens = c.screens.filter((s) => s.id !== 's_photos');
  })).value;
  const c = cfg.carousels.items[0];
  assert.deepEqual(c.steps, []);
  assert.equal(offScreenOf(cfg, c), '');
  assert.deepEqual(carouselMembers(cfg, c), []);
  const r = requestScreen(cfg, { displayAccess: { screenId: 'v_loop' }, query: { screen: 'living-room' } });
  assert.equal(r.empty, true);
  assert.equal(r.screen.id, 'v_loop');
  assert.ok(!cfg.screens.some((s) => s.id === r.screen.id));
  assert.equal(r.screen.calendar.enabled, false);
  assert.equal(r.screen.background.source, 'stock');
});

// ---------------------------------------------------------------- over HTTP

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));

async function withServer(fn, { mode = 'private' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-carousel-'));
  globalThis.fetch = offlineFetch;
  const c = config([{ ...LOOP, steps: LOOP.steps.slice(0, 2) }]);
  c.security.displayAccess = mode;
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  fs.mkdirSync(path.join(dir, 'photos', '.thumbs'), { recursive: true });
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dist, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>display</title>');
  fs.writeFileSync(path.join(dist, 'admin', 'index.html'), '<!doctype html><title>admin</title>');
  store.initStore(dir);
  _resetDisplays();
  _resetAnnouncements();
  _resetPairing();
  _resetActivityThrottle();
  _resetDisplayAccess();
  setServerVersion('0.3.0');
  await ensurePassword();
  syncDisplayKeys();
  const onConfig = (cfg, prev) => { onDisplayAccessConfig(cfg, prev); broadcast('config', { revision: cfg.revision }); };
  store.events.on('config', onConfig);
  const app = createApp({ version: '0.3.0', dist });
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
    return { status: r.status, json, text, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  try {
    await fn({ call, login });
  } finally {
    store.events.off('config', onConfig);
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
}

const keyOf = (slug) => listDisplayLinks().find((l) => l.slug === slug).key;

test('private link of a carousel: config of its screens with the carousel block; never another screen', async () => {
  await withServer(async ({ call }) => {
    const links = listDisplayLinks();
    assert.deepEqual(links.map((l) => [l.slug, l.kind]), [['living-room', 'screen'], ['kitchen', 'screen'], ['photos', 'screen'], ['loop', 'carousel']]);
    const k = { 'x-marco-key': keyOf('loop') };
    const now = await call('GET', '/api/display/config', { headers: k });
    assert.equal(now.status, 200);
    assert.deepEqual(now.json.target, { id: 'v_loop', kind: 'carousel', slug: 'loop', name: 'Loop' });
    assert.deepEqual(now.json.carousel.steps.map((s) => [s.screenId, s.slug, s.seconds]), [['s_main', 'living-room', 60], ['s_kitchen', 'kitchen', 20]]);
    assert.ok(['s_main', 's_kitchen'].includes(now.json.screenId));
    assert.equal((await call('GET', '/api/display/config?screen=s_kitchen', { headers: k })).json.screenId, 's_kitchen');
    const other = await call('GET', '/api/display/config?screen=photos', { headers: k });
    assert.notEqual(other.json.screenId, 's_photos');
    assert.equal((await call('GET', '/api/events?screen=s_kitchen', { headers: k })).status, 200);
    // a plain screen link answers as before, with target = itself and no carousel
    const plain = await call('GET', '/api/display/config?screen=s_kitchen', { headers: { 'x-marco-key': keyOf('living-room') } });
    assert.equal(plain.json.screenId, 's_main');
    assert.deepEqual(plain.json.target, { id: 's_main', kind: 'screen', slug: 'living-room', name: 'Living room' });
    assert.equal(plain.json.carousel, null);
  });
});

test('poll: a carousel display is bound to the carousel and gets announcements for each of its screens', async () => {
  await withServer(async ({ call, login }) => {
    const cookie = await login();
    const k = { 'x-marco-key': keyOf('loop') };
    const first = await call('GET', '/api/display/poll?client=kiosk-loop-1', { headers: k });
    assert.equal(first.json.screenId, 'v_loop');
    assert.equal(first.json.targetKind, 'carousel');
    const a = await call('POST', '/api/admin/announce', { cookie, body: { title: 'Kitchen only', screens: ['kitchen'] } });
    assert.equal(a.status, 200, a.text);
    const p = await call('GET', `/api/display/poll?client=kiosk-loop-1&cursor=${first.json.cursor}`, { headers: k });
    assert.deepEqual(p.json.commands.filter((c) => c.type === 'announce').map((c) => c.title), ['Kitchen only']);
    const photos = await call('GET', `/api/display/poll?client=kiosk-photos-1&cursor=${first.json.cursor}`, { headers: { 'x-marco-key': keyOf('photos') } });
    assert.equal(photos.json.screenId, 's_photos');
    assert.equal(photos.json.targetKind, 'screen');
    // displays list: registered under the carousel; the heartbeat says which screen it shows
    const hb = await call('POST', '/api/display/heartbeat', { headers: k, body: { clientId: 'kiosk-loop-1', screenId: 's_kitchen' } });
    assert.equal(hb.status, 200, hb.text);
    const list = (await call('GET', '/api/admin/displays', { cookie })).json.displays;
    const d = list.find((x) => x.clientId === 'kiosk-loop-1');
    assert.equal(d.screenId, 'v_loop');
    assert.equal(d.screenName, 'Loop');
    assert.equal(d.targetKind, 'carousel');
    assert.equal(d.showingScreenId, 's_kitchen');
  });
});

test('devices and pairing take a carousel; deleting it revokes its devices and drops its link', async () => {
  await withServer(async ({ call, login }) => {
    const cookie = await login();
    const dev = createDevice({ name: 'Hall tablet', screenId: 'v_loop' });
    assert.ok(dev.token, JSON.stringify(dev));
    assert.equal(dev.device.screenName, 'Loop');
    assert.equal(dev.device.screenKind, 'carousel');
    const loopKey = keyOf('loop');
    assert.equal((await call('GET', '/api/display/config', { headers: { 'x-marco-key': dev.token } })).json.target.kind, 'carousel');
    const cfg = (await call('GET', '/api/admin/config', { cookie })).json;
    assert.equal(cfg.carousels.items.length, 1);
    cfg.carousels.items = [];
    assert.equal((await call('PUT', '/api/admin/config', { cookie, body: cfg })).status, 200);
    assert.equal((await call('GET', '/api/display/config', { headers: { 'x-marco-key': loopKey } })).status, 403);
    // the device is revoked with it, never moved to the default screen
    const after = await call('GET', '/api/display/config', { headers: { 'x-marco-key': dev.token } });
    assert.equal(after.status, 403);
  });
});

test('open mode: /?screen=<carousel> and ?screen=<screen>&via=<carousel>', async () => {
  await withServer(async ({ call }) => {
    const c = await call('GET', '/api/display/config?screen=loop');
    assert.equal(c.json.target.kind, 'carousel');
    assert.equal('screenFallback' in c.json, false);
    const m = await call('GET', '/api/display/config?screen=s_kitchen&via=loop');
    assert.equal(m.json.screenId, 's_kitchen');
    assert.equal(m.json.carousel.id, 'v_loop');
    const plain = await call('GET', '/api/display/config?screen=kitchen');
    assert.equal(plain.json.carousel, null);
  }, { mode: 'open' });
});
