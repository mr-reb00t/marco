// "Salir del kiosko" and "Apagar" (Personalizado navigation cards, feature kioskPower): the kinds (core/canvasCore.js),
// the same-machine checks (lib/net.js), the request files (server/power.js), the route (routes/power.js, on the real
// app with the requests faked: nothing is closed or powered off here), the card's states on screen
// (web/display/power.ts, on a fake clock) and deploy/kiosk.sh with a fake browser (skipped without bash, flock or pkill).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CANVAS_KINDS, CLOUD_CANVAS_KINDS, NAV_ICONS, NAV_TAP_KINDS, POWER_KINDS, canvasDefaults, defaultCanvas, defaultItemStyle, powerCardOf, projectCanvas, sanitizeCanvas,
} from '../core/canvasCore.js';
import { FEATURE_KEYS, selfHostedFeatures } from '../capabilities.js';
import { sameMachineDirect, sameOrigin } from '../lib/net.js';
import { KIOSK_KEY_RE, POWEROFF_STALE_MS, POWER_PER_MINUTE, kioskKeyMatches, newKioskKey, poweroffStale, powerLimiter, powerUnitPresent, requestKioskExit, requestPoweroff, runDir } from '../power.js';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetActivityThrottle, listActivity } from '../activity.js';
import { _resetPrivacy } from '../privacy.js';
import { _resetDisplayAccess, listDisplayLinks, syncDisplayKeys } from '../displayAccess.js';
import { loadWebModules } from './webModules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const realFetch = globalThis.fetch;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const collector = () => {
  const errors = [];
  return { errors, err: (p, m) => errors.push(`${p}: ${m}`) };
};

// ---- the kinds ------------------------------------------------------------------------------------------------

test('kinds: self-hosted only, touch cards, one of each per screen, the new icons', () => {
  assert.deepEqual(POWER_KINDS, { exit: 'nav.kiosk', off: 'nav.poweroff' });
  for (const k of ['nav.kiosk', 'nav.poweroff']) {
    const d = CANVAS_KINDS[k];
    assert.equal(d.edition, 'local', k);
    assert.equal(d.feature, 'kioskPower', k);
    assert.equal(d.cat, 'nav', k);
    assert.equal(d.taps, true, k);
    assert.equal(d.perScreen, 1, k);
    assert.ok(NAV_TAP_KINDS.includes(k), k);
    assert.equal(CLOUD_CANVAS_KINDS.includes(k), false, `${k} is not in Marco Cloud`);
    assert.deepEqual(canvasDefaults(k), { label: '', icon: '', show: 'both' });
    const c = collector();
    assert.deepEqual(d.props(c, 'p', { label: 'Bye', icon: 'i:power', show: 'icon', junk: 1 }, {}, {}), { label: 'Bye', icon: 'i:power', show: 'icon' });
    assert.deepEqual(d.props(c, 'p', { icon: 'i:nope', show: 'x' }, {}, {}).icon, '');
  }
  assert.ok(NAV_ICONS.includes('exit') && NAV_ICONS.includes('power'));
  // a second card of the same kind on a screen is refused
  const two = { ...defaultCanvas(), items: [0, 1].map((i) => ({ id: `cv_kiosk00${i}0`, kind: 'nav.kiosk', pos: { zone: 'main', x: i * 6, y: 0, w: 2, h: 1 }, style: defaultItemStyle(), props: {} })) };
  const c = collector();
  sanitizeCanvas(c, 'canvas', two, {}, {});
  assert.ok(c.errors.some((e) => /too many nav\.kiosk/.test(e)), JSON.stringify(c.errors));
});

test('health: kioskPower is a feature key, on for a self-hosted server', () => {
  assert.ok(FEATURE_KEYS.includes('kioskPower'));
  assert.equal(selfHostedFeatures().kioskPower, true);
});

const card = (id, kind, extra = {}) => ({ id, kind, pos: { zone: 'main', x: 0, y: 0, w: 2, h: 1 }, style: defaultItemStyle(), props: canvasDefaults(kind), ...extra });
const screenWith = (items, touch = true) => ({ layout: { preset: 'canvas' }, screen: { orientation: 'auto' }, canvas: { ...defaultCanvas(), touch, items } });

test('powerCardOf: only a shown card of that kind on a Personalizado screen', () => {
  const s = screenWith([card('cv_kiosk001', 'nav.kiosk'), card('cv_power001', 'nav.poweroff', { pos: { zone: 'main', x: 4, y: 0, w: 2, h: 1 } })]);
  assert.equal(powerCardOf(s, 'cv_kiosk001', 'nav.kiosk')?.id, 'cv_kiosk001');
  assert.equal(powerCardOf(s, 'cv_power001', 'nav.poweroff')?.id, 'cv_power001');
  assert.equal(powerCardOf(s, 'cv_kiosk001', 'nav.poweroff'), null, 'the wrong kind');
  assert.equal(powerCardOf(s, 'cv_power001', 'nav.button'), null, 'not a power kind');
  assert.equal(powerCardOf(s, 'cv_nothere1', 'nav.kiosk'), null);
  assert.equal(powerCardOf(s, '../etc', 'nav.kiosk'), null);
  assert.equal(powerCardOf(screenWith([card('cv_kiosk001', 'nav.kiosk', { hidden: true })]), 'cv_kiosk001', 'nav.kiosk'), null, 'hidden by hand');
  // its schedule is off now
  const night = [{ id: 'p_1', enabled: true, days: [], from: '00:00', to: '00:01' }];
  const off = screenWith([card('cv_kiosk001', 'nav.kiosk', { schedule: night })]);
  assert.equal(powerCardOf(off, 'cv_kiosk001', 'nav.kiosk', { now: new Date('2026-05-05T12:00:00Z'), tz: 'UTC' }), null, 'its schedule is off');
  assert.equal(powerCardOf({ ...s, layout: { preset: 'classic' } }, 'cv_kiosk001', 'nav.kiosk'), null, 'not a Personalizado screen');
  // the display gets them like the other buttons: only with touch, not private, a trusted display
  assert.equal(projectCanvas(s, {}).taps, true);
  assert.equal(projectCanvas(s, { isPrivate: true }).taps, false);
  assert.equal(projectCanvas(s, { trusted: false }).taps, false);
  // Marco Cloud's kinds: a placeholder
  assert.equal(projectCanvas(s, { canvasKinds: CLOUD_CANVAS_KINDS }).items.find((i) => i.id === 'cv_kiosk001').disabled, 'feature');
});

// ---- same machine, no proxy -----------------------------------------------------------------------------------

const req = (remoteAddress, headers = {}, extra = {}) => ({ socket: { remoteAddress }, headers: { host: 'localhost:3000', ...headers }, ...extra });

test('sameMachineDirect: a loopback socket, no proxy header, a loopback Host', () => {
  assert.equal(sameMachineDirect(req('127.0.0.1')), true);
  assert.equal(sameMachineDirect(req('::1', { host: '[::1]:3000' })), true);
  assert.equal(sameMachineDirect(req('::ffff:127.0.0.1', { host: '127.0.0.1:3000' })), true);
  assert.equal(sameMachineDirect(req('127.0.0.1', { host: 'localhost' })), true);
  assert.equal(sameMachineDirect(req('192.168.1.20')), false, 'another device');
  assert.equal(sameMachineDirect(req('::ffff:192.168.1.20')), false);
  for (const h of ['x-forwarded-for', 'forwarded', 'x-real-ip', 'via', 'x-forwarded-proto', 'x-forwarded-host', 'cf-connecting-ip', 'true-client-ip']) {
    assert.equal(sameMachineDirect(req('127.0.0.1', { [h]: '127.0.0.1' })), false, `a proxy on this machine (${h})`);
  }
  assert.equal(sameMachineDirect(req('127.0.0.1', { host: 'evil.example' })), false, 'DNS rebinding');
  assert.equal(sameMachineDirect(req('127.0.0.1', { host: 'raspberrypi.local:3000' })), false, 'the Pi by its network name');
  assert.equal(sameMachineDirect(req('127.0.0.1', { host: '' })), false);
  // req.ip (trust proxy) does not count: the socket's own address does
  assert.equal(sameMachineDirect(req('192.168.1.20', {}, { ip: '127.0.0.1' })), false);
  assert.equal(sameMachineDirect({ headers: { host: 'localhost' } }), false);
});

test('sameOrigin: Origin is http://<Host>, and the browser says same-origin', () => {
  assert.equal(sameOrigin(req('127.0.0.1', { origin: 'http://localhost:3000' })), true);
  assert.equal(sameOrigin(req('127.0.0.1', { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(sameOrigin(req('127.0.0.1')), false, 'no Origin');
  assert.equal(sameOrigin(req('127.0.0.1', { origin: 'null' })), false, 'a sandboxed web widget');
  assert.equal(sameOrigin(req('127.0.0.1', { origin: 'http://evil.example' })), false);
  assert.equal(sameOrigin(req('127.0.0.1', { origin: 'https://localhost:3000' })), false);
  assert.equal(sameOrigin(req('127.0.0.1', { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(sameOrigin(req('127.0.0.1', { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-site' })), false);
});

// ---- the request files ----------------------------------------------------------------------------------------

test('power.js: the runtime folder, the kiosk token and the power-off file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-power-'));
  try {
    assert.equal(runDir({}), '');
    assert.equal(runDir({ RUNTIME_DIRECTORY: 'relative/dir' }), '');
    assert.equal(runDir({ RUNTIME_DIRECTORY: path.join(dir, 'missing') }), '');
    assert.equal(runDir({ RUNTIME_DIRECTORY: dir }), dir);
    assert.equal(runDir({ RUNTIME_DIRECTORY: `${dir}:/run/other` }), dir);
    assert.equal(runDir({ MARCO_RUN_DIR: dir, RUNTIME_DIRECTORY: '/nonexistent' }), dir);
    const unit = path.join(dir, 'marco-power.path');
    assert.equal(powerUnitPresent({ MARCO_POWER_UNIT: unit }), false);
    fs.writeFileSync(unit, '[Path]\n');
    assert.equal(powerUnitPresent({ MARCO_POWER_UNIT: unit }), false, 'installed but not enabled');
    fs.mkdirSync(path.join(dir, 'multi-user.target.wants'));
    fs.symlinkSync(unit, path.join(dir, 'multi-user.target.wants', 'marco-power.path'));
    assert.equal(powerUnitPresent({ MARCO_POWER_UNIT: unit }), true);

    requestKioskExit(dir, 1_700_000_000_123);
    const file = path.join(dir, 'kiosk-exit');
    assert.equal(fs.readFileSync(file, 'utf8'), '1700000000123');
    assert.equal(fs.statSync(file).mode & 0o777, 0o644);
    requestKioskExit(dir, 1_700_000_000_999);
    assert.equal(fs.readFileSync(file, 'utf8'), '1700000000999');
    assert.ok(!fs.existsSync(path.join(dir, '.kiosk-exit.tmp')));

    assert.deepEqual(requestPoweroff(dir), { already: false });
    assert.equal(fs.readFileSync(path.join(dir, 'poweroff'), 'utf8'), '');
    assert.deepEqual(requestPoweroff(dir), { already: true });
    // a request nothing took (the unit is stopped): stale after a while, and removed
    const off = path.join(dir, 'poweroff');
    const made = fs.statSync(off).mtimeMs;
    assert.equal(poweroffStale(dir, made + POWEROFF_STALE_MS - 100), false);
    assert.ok(fs.existsSync(off));
    assert.equal(poweroffStale(dir, made + POWEROFF_STALE_MS + 100), true);
    assert.ok(!fs.existsSync(off), 'a later `marco power on` does not power off at once');
    assert.equal(poweroffStale(dir, made + 10 ** 9), false, 'no request: not stale');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the kiosk key: 32 random bytes, compared whole', () => {
  const k = newKioskKey();
  assert.match(k, KIOSK_KEY_RE);
  assert.notEqual(newKioskKey(), k);
  assert.equal(kioskKeyMatches(k, k), true);
  assert.equal(kioskKeyMatches(`${k}x`, k), false);
  assert.equal(kioskKeyMatches(k.slice(0, -1), k), false);
  assert.equal(kioskKeyMatches(undefined, k), false);
  assert.equal(kioskKeyMatches('', ''), false, 'no key kept: nothing matches');
  assert.equal(kioskKeyMatches('short', 'short'), false);
});

test('powerLimiter: six tries a minute per action, one accepted every 30 s', () => {
  const l = powerLimiter();
  for (let i = 0; i < POWER_PER_MINUTE; i++) assert.deepEqual(l.try('exit', 1000 + i), { ok: true });
  const r = l.try('exit', 2000);
  assert.ok(r.retryAfter >= 58 && r.retryAfter <= 60, JSON.stringify(r));
  assert.deepEqual(l.try('off', 2000), { ok: true }, 'each action counts on its own');
  assert.deepEqual(l.try('exit', 62_000), { ok: true }, 'a minute later');
  l.accepted('exit', 70_000);
  assert.equal(l.already('exit', 99_000), true);
  assert.equal(l.already('exit', 100_001), false);
  l.accepted('off', 70_000);
  assert.equal(l.already('off', 99_000), true);
  assert.equal(l.already('off', 100_001), false, 'a power-off that nothing took is caught by poweroffStale, not kept for good');
});

// ---- the route -------------------------------------------------------------------------------------------------

async function withServer(fn, { mut = () => {}, unit = true, run = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-power-route-'));
  const runFolder = path.join(dir, 'run');
  fs.mkdirSync(runFolder);
  globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'open';
  const s = c.screens[0];
  s.layout = { ...s.layout, preset: 'canvas' };
  s.canvas = {
    ...defaultCanvas(), touch: true,
    items: [card('cv_kiosk001', 'nav.kiosk'), card('cv_power001', 'nav.poweroff', { pos: { zone: 'main', x: 4, y: 0, w: 2, h: 1 } })],
  };
  const other = structuredClone(s);
  Object.assign(other, { id: 's_other', slug: 'other', name: 'Other' });
  other.canvas = { ...defaultCanvas(), touch: true, items: [] };
  c.screens.push(other);
  mut(c);
  const v = validateConfig(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(v.value));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>display</title>');
  store.initStore(dir);
  _resetDisplays();
  _resetActivityThrottle();
  _resetPrivacy();
  _resetDisplayAccess();
  setServerVersion('test');
  await ensurePassword();
  syncDisplayKeys();
  let clock = 1_800_000_000_000;
  const calls = [];
  const power = {
    requestKioskExit: (d, now) => calls.push(['exit', d, now]),
    requestPoweroff: (d) => calls.push(['off', d]),
    unitPresent: () => unit,
    runDir: () => (run ? runFolder : ''),
    now: () => clock,
    delayMs: 0,
  };
  const app = createApp({ version: 'test', dist, power });
  const server = await new Promise((resolve) => { const sv = app.listen(0, '127.0.0.1', () => resolve(sv)); });
  const host = `127.0.0.1:${server.address().port}`;
  const kioskKey = store.getSecrets().kioskToken;
  assert.match(kioskKey, KIOSK_KEY_RE, 'made at start');
  // the kiosk browser sends its key; `kiosk: false` is any other client on this machine
  const call = async (method, url, { body, headers = {}, raw, kiosk = true } = {}) => {
    const r = await realFetch(`http://${host}${url}`, {
      method,
      headers: { ...(kiosk ? { 'x-marco-kiosk': kioskKey } : {}), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json', origin: `http://${host}` } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  const keyOf = (slug) => listDisplayLinks().find((l) => l.slug === slug)?.key;
  const login = async () => {
    const r = await realFetch(`http://${host}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret-pass-123' }) });
    assert.equal(r.status, 200);
    return (r.headers.getSetCookie?.() || []).map((x) => x.split(';')[0]).join('; ');
  };
  try {
    await fn({ call, calls, host, runFolder, keyOf, login, kioskKey, tick: (ms) => { clock += ms; } });
  } finally {
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    globalThis.fetch = realFetch;
    _resetPrivacy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('route: the status of each card, and what refuses it', async () => {
  await withServer(async ({ call }) => {
    let r = await call('GET', '/api/display/power?item=cv_kiosk001');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { action: 'exit', ready: true });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    r = await call('GET', '/api/display/power?item=cv_power001');
    assert.deepEqual(r.json, { action: 'off', ready: true });
    assert.equal((await call('GET', '/api/display/power?item=cv_nothere1')).status, 404);
    assert.equal((await call('GET', '/api/display/power?item=x')).status, 404);
    assert.equal((await call('GET', '/api/display/power')).status, 404);
    assert.equal((await call('GET', '/api/display/power?item=cv_kiosk001&screen=other')).status, 404, 'a card of another screen');
    // through a proxy on this machine (a client on the network: the display access lets it in, this route does not; one
    // from the Internet does not even get that far)
    const proxied = await call('GET', '/api/display/power?item=cv_kiosk001&screen=living-room', { headers: { 'x-forwarded-for': '192.168.1.40' } });
    assert.equal(proxied.status, 403);
    assert.equal(proxied.json.error, 'not_local');
    assert.equal((await call('GET', '/api/display/power?item=cv_kiosk001&screen=living-room', { headers: { via: '1.1 caddy' } })).status, 403);
    assert.equal((await call('GET', '/api/display/power?item=cv_kiosk001', { headers: { 'x-forwarded-for': '203.0.113.9' } })).status, 404);
  });
  await withServer(async ({ call }) => {
    assert.deepEqual((await call('GET', '/api/display/power?item=cv_power001')).json, { action: 'off', ready: false, reason: 'not_enabled' });
    assert.deepEqual((await call('GET', '/api/display/power?item=cv_kiosk001')).json, { action: 'exit', ready: true });
  }, { unit: false });
  await withServer(async ({ call }) => {
    assert.deepEqual((await call('GET', '/api/display/power?item=cv_kiosk001')).json, { action: 'exit', ready: false, reason: 'no_runtime' });
    assert.deepEqual((await call('GET', '/api/display/power?item=cv_power001')).json, { action: 'off', ready: false, reason: 'no_runtime' });
  }, { run: false });
});

test('route: a second tap closes the kiosk once, logs it, and a burst is refused', async () => {
  await withServer(async ({ call, calls, runFolder, tick }) => {
    const ask = (body, opts) => call('POST', '/api/display/power', { body, ...opts });
    const r = await ask({ item: 'cv_kiosk001', action: 'exit' });
    assert.equal(r.status, 202, r.text);
    assert.deepEqual(r.json, { ok: true });
    await wait(30);
    assert.deepEqual(calls, [['exit', runFolder, 1_800_000_000_000]]);
    const entry = listActivity({ type: 'display.kiosk_exit' }).items[0];
    assert.deepEqual(entry.data, { screen: 'living-room', item: 'cv_kiosk001' });
    assert.equal(entry.actor, 'display:living-room');
    // again soon after: nothing more
    const again = await ask({ item: 'cv_kiosk001', action: 'exit' });
    assert.equal(again.status, 202);
    assert.equal(again.json.already, true);
    await wait(30);
    assert.equal(calls.length, 1);
    assert.equal(listActivity({ type: 'display.kiosk_exit' }).items.length, 1);
    // half a minute later it asks again
    tick(31_000);
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'exit' })).status, 202);
    await wait(30);
    assert.equal(calls.length, 2);
    // the third, fourth... sixth try of the minute: then 429
    for (let i = 0; i < 3; i++) assert.equal((await ask({ item: 'cv_kiosk001', action: 'exit' })).status, 202);
    const many = await ask({ item: 'cv_kiosk001', action: 'exit' });
    assert.equal(many.status, 429);
    assert.equal(many.json.error, 'rate_limited');
    assert.ok(Number(many.headers.get('retry-after')) > 0);
    assert.equal(calls.length, 2);
  });
});

test('route: the power-off asks once; a request nothing took, no unit or no runtime folder: it says why', async () => {
  await withServer(async ({ call, calls, runFolder, tick }) => {
    const ask = () => call('POST', '/api/display/power', { body: { item: 'cv_power001', action: 'off' } });
    assert.equal((await ask()).status, 202);
    await wait(30);
    assert.deepEqual(calls, [['off', runFolder]]);
    assert.deepEqual(listActivity({ type: 'display.poweroff' }).items[0].data, { screen: 'living-room', item: 'cv_power001' });
    tick(10_000);
    const later = await ask();
    assert.equal(later.status, 202);
    assert.equal(later.json.already, true);
    await wait(30);
    assert.equal(calls.length, 1);
    // the unit is installed but stopped: the request file is still there long after (the test clock is ahead of its
    // mtime). The card says it is not on, and the file goes, so a later `marco power on` does not power off at once.
    const off = path.join(runFolder, 'poweroff');
    fs.writeFileSync(off, '');
    tick(30_000);
    const stale = await ask();
    assert.equal(stale.status, 409, stale.text);
    assert.equal(stale.json.error, 'not_enabled');
    assert.ok(!fs.existsSync(off));
    fs.writeFileSync(off, '');
    assert.deepEqual((await call('GET', '/api/display/power?item=cv_power001')).json, { action: 'off', ready: false, reason: 'not_enabled' });
    assert.ok(!fs.existsSync(off));
    // nothing left: it asks again
    assert.equal((await ask()).status, 202);
    await wait(30);
    assert.equal(calls.length, 2);
  });
  await withServer(async ({ call, calls }) => {
    const r = await call('POST', '/api/display/power', { body: { item: 'cv_power001', action: 'off' } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'not_enabled');
    // the kiosk card needs no unit
    assert.equal((await call('POST', '/api/display/power', { body: { item: 'cv_kiosk001', action: 'exit' } })).status, 202);
    await wait(30);
    assert.deepEqual(calls.map((x) => x[0]), ['exit']);
    assert.equal(listActivity({ type: 'display.poweroff' }).items.length, 0, 'a refused request is not logged');
  }, { unit: false });
  await withServer(async ({ call, calls }) => {
    const r = await call('POST', '/api/display/power', { body: { item: 'cv_kiosk001', action: 'exit' } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'no_runtime');
    await wait(30);
    assert.equal(calls.length, 0);
  }, { run: false });
});

test('route: what a POST needs (JSON, the same origin, this machine, the card on this screen)', async () => {
  await withServer(async ({ call, calls, host }) => {
    const ask = (body, opts = {}) => call('POST', '/api/display/power?screen=living-room', { body, ...opts });
    const form = await call('POST', '/api/display/power', { raw: 'item=cv_kiosk001&action=exit', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    const plain = await call('POST', '/api/display/power', { raw: JSON.stringify({ item: 'cv_kiosk001', action: 'exit' }), headers: { 'content-type': 'text/plain' } });
    assert.equal(plain.status, 415, 'a simple request with no preflight');
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'reboot' })).status, 400);
    assert.equal((await ask({ item: 'cv_kiosk001' })).status, 400);
    assert.equal((await ask({ action: 'exit' })).status, 400);
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'exit' }, { headers: { origin: 'null' } })).status, 403, 'a sandboxed web widget');
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'exit' }, { headers: { origin: 'http://evil.example' } })).status, 403);
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'exit' }, { headers: { origin: `http://${host}`, 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'exit' }, { headers: { 'x-forwarded-for': '127.0.0.1' } })).status, 403, 'a proxy on this machine');
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'exit' }, { headers: { 'x-forwarded-for': '192.168.1.40' } })).status, 403);
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'exit' }, { headers: { via: '1.1 nginx' } })).status, 403);
    // relayed with no X-Forwarded-For (Forwarded or X-Real-IP alone), even claiming this machine
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'exit' }, { headers: { forwarded: 'for=127.0.0.1' } })).status, 403);
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'exit' }, { headers: { 'x-real-ip': '127.0.0.1' } })).status, 403);
    // the card of the other kind, an unknown card, a card of another screen
    assert.equal((await ask({ item: 'cv_kiosk001', action: 'off' })).status, 404);
    assert.equal((await ask({ item: 'cv_nothere1', action: 'exit' })).status, 404);
    assert.equal((await call('POST', '/api/display/power?screen=other', { body: { item: 'cv_kiosk001', action: 'exit' } })).status, 404);
    await wait(30);
    assert.equal(calls.length, 0);
    assert.equal(listActivity({ type: 'display.kiosk_exit' }).items.length, 0);
  });
});

test('route: only the kiosk browser (its key), whatever is in front of the server on this machine', async () => {
  await withServer(async ({ call, calls, host, kioskKey }) => {
    // a bare proxy_pass, ssh -L or socat on this machine: loopback, no proxy header, a localhost Host, a forged Origin
    const g = await call('GET', '/api/display/power?item=cv_kiosk001', { kiosk: false });
    assert.equal(g.status, 403);
    assert.equal(g.json.error, 'not_kiosk');
    const p = await call('POST', '/api/display/power', { body: { item: 'cv_power001', action: 'off' }, kiosk: false, headers: { origin: `http://${host}` } });
    assert.equal(p.status, 403);
    assert.equal(p.json.error, 'not_kiosk');
    for (const bad of ['', 'x'.repeat(43), `${kioskKey}=`, kioskKey.toLowerCase() === kioskKey ? kioskKey.toUpperCase() : kioskKey.toLowerCase()]) {
      assert.equal((await call('POST', '/api/display/power', { body: { item: 'cv_kiosk001', action: 'exit' }, kiosk: false, headers: { 'x-marco-kiosk': bad } })).status, 403, bad);
    }
    await wait(30);
    assert.equal(calls.length, 0);
    assert.equal(listActivity({ type: 'display.poweroff' }).items.length, 0);
    assert.equal((await call('POST', '/api/display/power', { body: { item: 'cv_kiosk001', action: 'exit' } })).status, 202, 'with the key');
  });
});

test('route: touch off, a hidden card, a private screen, private access without the key', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('GET', '/api/display/power?item=cv_kiosk001')).status, 404);
    assert.equal((await call('POST', '/api/display/power', { body: { item: 'cv_kiosk001', action: 'exit' } })).status, 404);
  }, { mut: (c) => { c.screens[0].canvas.touch = false; } });
  await withServer(async ({ call }) => {
    assert.equal((await call('GET', '/api/display/power?item=cv_kiosk001')).status, 404);
    assert.equal((await call('GET', '/api/display/power?item=cv_power001')).status, 200);
  }, { mut: (c) => { c.screens[0].canvas.items[0].hidden = true; } });
  await withServer(async ({ call, login }) => {
    assert.equal((await call('GET', '/api/display/power?item=cv_kiosk001')).status, 200);
    const cookie = await login();
    const priv = await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: ['living-room'] }, headers: { cookie } });
    assert.equal(priv.status, 200, priv.text);
    assert.equal((await call('GET', '/api/display/power?item=cv_kiosk001')).status, 404);
    assert.equal((await call('POST', '/api/display/power', { body: { item: 'cv_kiosk001', action: 'exit' } })).status, 404);
  });
  await withServer(async ({ call, calls, keyOf }) => {
    assert.equal((await call('GET', '/api/display/power?item=cv_kiosk001')).status, 401);
    assert.equal((await call('POST', '/api/display/power', { body: { item: 'cv_kiosk001', action: 'exit' } })).status, 401);
    const key = keyOf('living-room');
    assert.ok(key);
    assert.equal((await call('GET', '/api/display/power?item=cv_kiosk001', { headers: { 'x-marco-key': key } })).status, 200);
    assert.equal((await call('POST', '/api/display/power', { body: { item: 'cv_kiosk001', action: 'exit' }, headers: { 'x-marco-key': key } })).status, 202);
    // the key of another screen does not reach this one's card
    assert.equal((await call('POST', '/api/display/power', { body: { item: 'cv_power001', action: 'off' }, headers: { 'x-marco-key': keyOf('other') } })).status, 404);
    await wait(30);
    assert.equal(calls.length, 1);
  }, { mut: (c) => { c.security.displayAccess = 'private'; } });
});

// ---- the card on screen ----------------------------------------------------------------------------------------

test('display: a first tap arms the card, a second one within the time asks, the time running out disarms it', async () => {
  const [pw] = await loadWebModules('/web/display/power.ts');
  const { planTap, settle, uiOfStatus, uiOfAnswer, loopbackHost, CONFIRM_MS, ERROR_MS } = pw;
  let st = 'idle';
  let armed = 0;
  let p = planTap(st, 1000, armed);
  assert.deepEqual(p, { state: 'confirm', send: false, armedAt: 1000 });
  st = p.state;
  armed = p.armedAt;
  assert.equal(settle(st, 1000 + CONFIRM_MS - 1, armed), 'confirm');
  assert.equal(settle(st, 1000 + CONFIRM_MS + 1, armed), 'idle', 'not tapped again: back to idle');
  p = planTap(st, 1000 + CONFIRM_MS - 10, armed);
  assert.deepEqual(p, { state: 'working', send: true, armedAt: 1000 });
  // a second tap too late arms it again
  assert.deepEqual(planTap('confirm', 1000 + CONFIRM_MS + 50, 1000), { state: 'confirm', send: false, armedAt: 1000 + CONFIRM_MS + 50 });
  for (const s of ['remote', 'checking', 'unavailable', 'disabled', 'working', 'error']) assert.equal(planTap(s, 5000, 0).send, false, s);
  assert.equal(settle('error', ERROR_MS + 1, 0), 'idle');
  assert.equal(settle('working', 10 ** 9, 0), 'working');
  assert.equal(uiOfStatus({ ready: true }), 'idle');
  assert.equal(uiOfStatus({ ready: false, reason: 'not_enabled' }), 'disabled');
  assert.equal(uiOfStatus({ ready: false, reason: 'no_runtime' }), 'unavailable');
  assert.equal(uiOfStatus(403), 'unavailable');
  assert.equal(uiOfStatus(404), 'unavailable');
  assert.equal(uiOfStatus(500), 'error');
  assert.equal(uiOfAnswer(202), 'working');
  assert.equal(uiOfAnswer(409, 'not_enabled'), 'disabled');
  assert.equal(uiOfAnswer(409, 'no_runtime'), 'unavailable');
  assert.equal(uiOfAnswer(429, 'rate_limited'), 'error');
  assert.equal(uiOfAnswer(0), 'error');
  for (const h of ['localhost', '127.0.0.1', '[::1]', '::1']) assert.equal(loopbackHost(h), true, h);
  for (const h of ['raspberrypi.local', '192.168.1.5', 'marco.example', '']) assert.equal(loopbackHost(h), false, h);
});

test('display: the preview and the demo never ask the server; a page not at localhost never does either', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web/display/widgets/canvas/nav.ts'), 'utf8');
  assert.match(src, /const fake = isPreview \|\| ctx\.params\.get\('demo'\) === '1';/);
  assert.match(src, /const remote = !fake && \(!loopbackHost\(location\.hostname\) \|\| !kioskKey\);/);
  assert.match(src, /if \(fake \|\| remote \|\| busy \|\| gone \|\| hidden\(\)\) return;/);
  assert.match(src, /set\('working'\);\n\s+if \(fake\) return;/);
});

// ---- deploy/kiosk.sh -------------------------------------------------------------------------------------------

const has = (cmd) => spawnSync('bash', ['-c', `command -v ${cmd}`]).status === 0;
const shellOk = has('bash') && has('flock') && has('pkill') && has('pgrep');

/** kiosk.sh with a fake Chromium (a bash loop that keeps its flags), no server wait, temp folders. */
function kioskRun(t, { env: more = {}, curl = 'exit 0' } = {}) {
  const fake = path.join(t, 'bin');
  fs.mkdirSync(fake, { recursive: true });
  // the fake browser keeps its pid and its last argument (the URL)
  fs.writeFileSync(path.join(fake, 'chromium-browser'), `#!/usr/bin/env bash\necho $$ >> "${t}/browser.pids"\nprintf '%s\\n' "\${@: -1}" >> "${t}/browser.urls"\nwhile :; do sleep 0.2; done\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(fake, 'curl'), `#!/bin/sh\n${curl}\n`, { mode: 0o755 });
  for (const d of ['run', 'xdg', 'home']) fs.mkdirSync(path.join(t, d), { recursive: true });
  const env = {
    PATH: `${fake}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(t, 'home'), XDG_RUNTIME_DIR: path.join(t, 'xdg'), MARCO_RUN_DIR: path.join(t, 'run'),
    KIOSK_URL: 'http://127.0.0.1:9/', KIOSK_WAIT_SEC: '0', KIOSK_LOG: path.join(t, 'kiosk.log'), PORT: '9', MARCO_DATA_DIR: path.join(t, 'nodata'), KIOSK_CLIENT: 'test',
    ...more,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  const p = spawn('bash', [path.join(ROOT, 'deploy/kiosk.sh')], { env, stdio: 'ignore' });
  const done = new Promise((resolve) => p.on('exit', (code) => resolve(code)));
  return { p, done };
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pidsOf = (t) => (fs.existsSync(path.join(t, 'browser.pids')) ? fs.readFileSync(path.join(t, 'browser.pids'), 'utf8').trim().split('\n').map(Number) : []);
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(100);
  }
  return false;
}

test('kiosk.sh: a new token closes the browser for good; an old one does not; started again it stays closed', { skip: !shellOk && 'needs bash, flock, pkill', timeout: 60_000 }, async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-kiosk-'));
  const runs = [];
  try {
    // a request from before this start: it does not count
    fs.mkdirSync(path.join(t, 'run'), { recursive: true });
    fs.writeFileSync(path.join(t, 'run', 'kiosk-exit'), '1000');
    const a = kioskRun(t);
    runs.push(a.p);
    assert.ok(await until(() => pidsOf(t).length === 1), 'the browser starts');
    const [pid] = pidsOf(t);
    await wait(2500);
    assert.equal(alive(pid), true, 'an old token leaves it open');
    assert.equal(a.p.exitCode, null);
    // the server asks: a new number (only digits are read)
    fs.writeFileSync(path.join(t, 'run', 'kiosk-exit'), '2000\n$(touch pwned)');
    const code = await Promise.race([a.done, wait(10_000).then(() => 'timeout')]);
    assert.equal(code, 0);
    assert.ok(await until(() => !alive(pid), 3000), 'the browser is gone');
    assert.equal(fs.readFileSync(path.join(t, 'xdg', 'marco-kiosk.closed'), 'utf8'), '2000 ', 'the number and the (here empty) login session');
    assert.equal(fs.statSync(path.join(t, 'xdg', 'marco-kiosk.closed')).mode & 0o077, 0);
    assert.ok(!fs.existsSync(path.join(t, 'pwned')) && !fs.existsSync(path.join(ROOT, 'pwned')));
    assert.match(fs.readFileSync(path.join(t, 'kiosk.log'), 'utf8'), /Exit asked from the screen/);
    // the desktop starts it again (LXDE-pi's @): it exits at once, no browser
    const b = kioskRun(t);
    runs.push(b.p);
    assert.equal(await Promise.race([b.done, wait(5000).then(() => 'timeout')]), 0);
    assert.equal(pidsOf(t).length, 1, 'no second browser');
    // another login session while the runtime folder stayed (an SSH session kept it): it opens again
    const c = kioskRun(t, { env: { XDG_SESSION_ID: 'c7' } });
    runs.push(c.p);
    assert.ok(await until(() => pidsOf(t).length === 2), 'opens again in a new login session');
    c.p.kill('SIGTERM');
    await Promise.race([c.done, wait(5000)]);
  } finally {
    for (const p of runs) if (p.exitCode === null) p.kill('SIGKILL');
    for (const pid of pidsOf(t)) if (alive(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(t, { recursive: true, force: true });
  }
});

test('kiosk.sh --open (the menu entry) opens it again after a close from the screen', { skip: !shellOk && 'needs bash, flock, pkill', timeout: 30_000 }, async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-kiosk-open-'));
  let p = null;
  try {
    fs.mkdirSync(path.join(t, 'run'), { recursive: true });
    fs.mkdirSync(path.join(t, 'xdg'), { recursive: true });
    fs.writeFileSync(path.join(t, 'run', 'kiosk-exit'), '3000');
    fs.writeFileSync(path.join(t, 'xdg', 'marco-kiosk.closed'), '3000');
    const fake = path.join(t, 'bin');
    fs.mkdirSync(fake, { recursive: true });
    fs.writeFileSync(path.join(fake, 'chromium-browser'), `#!/usr/bin/env bash\necho $$ >> "${t}/browser.pids"\nwhile :; do sleep 0.2; done\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(fake, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.mkdirSync(path.join(t, 'home'), { recursive: true });
    const env = {
      PATH: `${fake}:/usr/bin:/bin`, HOME: path.join(t, 'home'), XDG_RUNTIME_DIR: path.join(t, 'xdg'), MARCO_RUN_DIR: path.join(t, 'run'),
      KIOSK_URL: 'http://127.0.0.1:9/', KIOSK_WAIT_SEC: '0', KIOSK_LOG: path.join(t, 'kiosk.log'), PORT: '9', MARCO_DATA_DIR: path.join(t, 'nodata'), KIOSK_CLIENT: 'test',
    };
    p = spawn('bash', [path.join(ROOT, 'deploy/kiosk.sh'), '--open'], { env, stdio: 'ignore' });
    assert.ok(await until(() => pidsOf(t).length === 1), 'the browser starts');
    assert.equal(fs.existsSync(path.join(t, 'xdg', 'marco-kiosk.closed')), false);
    await wait(2500);
    assert.equal(alive(pidsOf(t)[0]), true, 'the token of the earlier close does not close it again');
  } finally {
    if (p && p.exitCode === null) p.kill('SIGTERM');
    await wait(300);
    if (p && p.exitCode === null) p.kill('SIGKILL');
    for (const pid of pidsOf(t)) if (alive(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(t, { recursive: true, force: true });
  }
});

test('kiosk.sh: a request while it waits for the server keeps Chromium closed; no runtime folder: the marker in ~/.cache', { skip: !shellOk && 'needs bash, flock, pkill', timeout: 30_000 }, async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-kiosk-wait-'));
  let a = null;
  try {
    fs.mkdirSync(path.join(t, 'run'), { recursive: true });
    fs.writeFileSync(path.join(t, 'run', 'kiosk-exit'), '1000');
    // the health check is where the request lands: the server answers once it wrote a new number
    a = kioskRun(t, { env: { XDG_RUNTIME_DIR: undefined, KIOSK_WAIT_SEC: '5' }, curl: `printf 4000 > "${t}/run/kiosk-exit"; exit 0` });
    assert.equal(await Promise.race([a.done, wait(10_000).then(() => 'timeout')]), 0);
    assert.equal(pidsOf(t).length, 0, 'Chromium never opened');
    assert.equal(fs.readFileSync(path.join(t, 'home', '.cache', 'marco-kiosk.closed'), 'utf8'), '4000 ');
  } finally {
    if (a && a.p.exitCode === null) a.p.kill('SIGKILL');
    for (const pid of pidsOf(t)) if (alive(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(t, { recursive: true, force: true });
  }
});

test('kiosk.sh: the kiosk key goes to the page in the URL fragment, never in the log', { skip: !shellOk && 'needs bash, flock, pkill', timeout: 30_000 }, async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-kiosk-key-'));
  let a = null;
  try {
    const key = newKioskKey();
    fs.mkdirSync(path.join(t, 'data'), { recursive: true });
    fs.writeFileSync(path.join(t, 'data', 'secrets.json'), JSON.stringify({ kioskToken: key }));
    fs.writeFileSync(path.join(t, 'data', 'config.json'), JSON.stringify({ security: { displayAccess: 'open' } }));
    a = kioskRun(t, { env: { MARCO_DATA_DIR: path.join(t, 'data') } });
    assert.ok(await until(() => pidsOf(t).length === 1), 'the browser starts');
    assert.equal(fs.readFileSync(path.join(t, 'browser.urls'), 'utf8').trim(), `http://127.0.0.1:9/?client=test#kp=${key}`);
    const log = fs.readFileSync(path.join(t, 'kiosk.log'), 'utf8');
    assert.ok(!log.includes(key), log);
    assert.match(log, /#kp=<kiosk-key>/);
    a.p.kill('SIGTERM');
    await Promise.race([a.done, wait(5000)]);
    // a server on another machine never gets it
    fs.rmSync(path.join(t, 'browser.urls'));
    fs.rmSync(path.join(t, 'browser.pids'));
    a = kioskRun(t, { env: { MARCO_DATA_DIR: path.join(t, 'data'), KIOSK_URL: 'http://192.0.2.10:9/' } });
    assert.ok(await until(() => fs.existsSync(path.join(t, 'browser.urls'))), 'the browser starts');
    assert.equal(fs.readFileSync(path.join(t, 'browser.urls'), 'utf8').trim(), 'http://192.0.2.10:9/?client=test');
  } finally {
    if (a && a.p.exitCode === null) a.p.kill('SIGTERM');
    await wait(300);
    if (a && a.p.exitCode === null) a.p.kill('SIGKILL');
    for (const pid of pidsOf(t)) if (alive(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(t, { recursive: true, force: true });
  }
});

// The menu entry text: kiosk.sh writes the one install.sh writes (kiosk_menu_entry)
const MENU_FMT_RE = /printf '(\[Desktop Entry\]\\nType=Application\\nName=Marco\\n[^']*)'/;
const menuFmt = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').match(MENU_FMT_RE)?.[1];

test('kiosk.sh: writes the menu entry Marco when it is missing, in a desktop session only, never over one that is there', { skip: !shellOk && 'needs bash, flock, pkill', timeout: 30_000 }, async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-kiosk-menu-'));
  const entry = path.join(t, 'home', '.local', 'share', 'applications', 'marco-kiosk.desktop');
  let a = null;
  const stop = async () => {
    if (a && a.p.exitCode === null) a.p.kill('SIGTERM');
    await Promise.race([a.done, wait(5000)]);
  };
  try {
    a = kioskRun(t);
    assert.ok(await until(() => pidsOf(t).length === 1), 'the browser starts');
    assert.equal(fs.existsSync(entry), false, 'no display: no desktop session to show a menu');
    await stop();
    a = kioskRun(t, { env: { WAYLAND_DISPLAY: 'wayland-9' } });
    assert.ok(await until(() => pidsOf(t).length === 2), 'the browser starts');
    const text = fs.readFileSync(entry, 'utf8');
    assert.match(text, /^\[Desktop Entry\]\nType=Application\nName=Marco\n/);
    assert.match(text, new RegExp(`^Exec=${path.join(ROOT, 'deploy/kiosk.sh').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --open$`, 'm'));
    assert.equal(fs.statSync(entry).mode & 0o777, 0o644);
    assert.match(fs.readFileSync(path.join(t, 'kiosk.log'), 'utf8'), /Added the menu entry Marco/);
    await stop();
    fs.writeFileSync(entry, 'mine');
    a = kioskRun(t, { env: { DISPLAY: ':0' } });
    assert.ok(await until(() => pidsOf(t).length === 3), 'the browser starts');
    assert.equal(fs.readFileSync(entry, 'utf8'), 'mine', 'one that is there is kept');
    await stop();
    assert.ok(menuFmt('install.sh') && menuFmt('install.sh') === menuFmt('deploy/kiosk.sh'), 'the same entry as the installer');
  } finally {
    if (a && a.p.exitCode === null) a.p.kill('SIGKILL');
    for (const pid of pidsOf(t)) if (alive(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(t, { recursive: true, force: true });
  }
});

// ---- deploy/marco kiosk ------------------------------------------------------------------------------------------

const cliOk = shellOk && has('setsid');
/** An all-in-one install of this user in <t>/marco (current/deploy/kiosk.sh is the repo's), its conf, the env of kioskRun. */
function cliSetup(t, more = {}) {
  const fake = path.join(t, 'bin');
  fs.mkdirSync(fake, { recursive: true });
  fs.writeFileSync(path.join(fake, 'chromium-browser'), `#!/usr/bin/env bash\necho $$ >> "${t}/browser.pids"\nwhile :; do sleep 0.2; done\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(fake, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const d of ['run', 'xdg', 'home', 'marco/current/deploy']) fs.mkdirSync(path.join(t, d), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'deploy/kiosk.sh'), path.join(t, 'marco/current/deploy/kiosk.sh'));
  fs.writeFileSync(path.join(t, 'marco.conf'), `MARCO_MODE=all\nMARCO_LAYOUT=release\nMARCO_DIR=${t}/marco\nMARCO_USER=${os.userInfo().username}\n`);
  const env = {
    PATH: `${fake}:${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: path.join(t, 'home'), XDG_RUNTIME_DIR: path.join(t, 'xdg'), MARCO_RUN_DIR: path.join(t, 'run'),
    MARCO_CONF: path.join(t, 'marco.conf'), KIOSK_URL: 'http://127.0.0.1:9/', KIOSK_WAIT_SEC: '0', KIOSK_LOG: path.join(t, 'kiosk.log'), PORT: '9', MARCO_DATA_DIR: path.join(t, 'nodata'), KIOSK_CLIENT: 'test',
    ...more,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return (...args) => spawnSync('bash', [path.join(ROOT, 'deploy/marco'), ...args], { env, encoding: 'utf8', timeout: 30_000 });
}
const killUnder = (t) => spawnSync('pkill', ['-KILL', '-f', `${t}/`]);

test('marco kiosk: starts it in the desktop session (closed marker gone), once; stop closes it like the card', { skip: !cliOk && 'needs bash, flock, pkill, setsid', timeout: 60_000 }, async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-cli-kiosk-'));
  try {
    const marco = cliSetup(t, { WAYLAND_DISPLAY: 'wayland-9', XDG_SESSION_ID: 'c9' });
    // closed from the screen earlier in this session
    fs.writeFileSync(path.join(t, 'run', 'kiosk-exit'), '5000');
    fs.writeFileSync(path.join(t, 'xdg', 'marco-kiosk.closed'), '5000 c9');
    let r = marco('kiosk');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Kiosk started on wayland-9/);
    assert.ok(await until(() => pidsOf(t).length === 1), 'the browser starts');
    assert.equal(fs.existsSync(path.join(t, 'xdg', 'marco-kiosk.closed')), false, 'the close from the screen no longer holds');
    r = marco('kiosk', 'start');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /already running/);
    await wait(1500);
    assert.equal(pidsOf(t).length, 1, 'no second browser');
    const [pid] = pidsOf(t);
    r = marco('kiosk', 'stop');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Kiosk closed\. Open it again: marco kiosk/);
    assert.notEqual(fs.readFileSync(path.join(t, 'run', 'kiosk-exit'), 'utf8').trim(), '5000', 'a new number, as the card writes');
    assert.ok(await until(() => !alive(pid), 3000), 'the browser is gone');
    // kept closed for the desktop session it runs in, so an autostart line the desktop runs again stays closed
    assert.match(fs.readFileSync(path.join(t, 'xdg', 'marco-kiosk.closed'), 'utf8'), /^\d+ c9$/);
    r = marco('kiosk', 'stop');
    assert.match(r.stdout, /not running/);
    assert.equal(marco('kiosk', 'restart').status, 1);
  } finally {
    killUnder(t);
    fs.rmSync(t, { recursive: true, force: true });
  }
});

test('marco kiosk: no desktop session says what to do; a server-only install has no kiosk', { skip: !cliOk && 'needs bash, flock, pkill, setsid', timeout: 30_000 }, () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-cli-nosess-'));
  try {
    const stubs = path.join(t, 'stubs');
    fs.mkdirSync(stubs);
    fs.writeFileSync(path.join(stubs, 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(stubs, 'loginctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const marco = cliSetup(t, { WAYLAND_DISPLAY: undefined, DISPLAY: 'localhost:10.0' });
    const r = spawnSync('bash', ['-c', `PATH="${stubs}:$PATH" exec bash "$0" kiosk`, path.join(ROOT, 'deploy/marco')], {
      env: { ...process.env, PATH: `${path.join(t, 'bin')}:/usr/bin:/bin`, HOME: path.join(t, 'home'), XDG_RUNTIME_DIR: path.join(t, 'xdg'), MARCO_CONF: path.join(t, 'marco.conf'), DISPLAY: 'localhost:10.0', WAYLAND_DISPLAY: '' },
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No desktop session of .+ is running, so the kiosk has nowhere to open\. Log in to the desktop/);
    assert.equal(pidsOf(t).length, 0);
    fs.writeFileSync(path.join(t, 'marco.conf'), `MARCO_MODE=server\nMARCO_DIR=${t}/marco\nMARCO_USER=${os.userInfo().username}\n`);
    const s = marco('kiosk');
    assert.equal(s.status, 1);
    assert.match(s.stderr, /no kiosk \(server only\)/);
  } finally {
    killUnder(t);
    fs.rmSync(t, { recursive: true, force: true });
  }
});

test('marco status and the installer point to marco kiosk; an update sets up the kiosk with the new installer', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'deploy/marco'), 'utf8');
  assert.match(cli, /Kiosk: {4}not running \(start it: marco kiosk\)/);
  assert.match(cli, /^ {2}kiosk\) shift; cmd_kiosk "\$@" ;;$/m);
  assert.match(cli, /^# {3}marco kiosk \[start\|stop\]/m);
  const src = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
  // the menu entry: from setup_kiosk, and on an install that is up to date but never got it
  assert.match(src, /setup_kiosk\(\) \{[\s\S]*?\n {2}kiosk_menu_entry "\$kiosk_cmd"\n[\s\S]*?\n\}/);
  assert.match(src, /is installed and up to date\."\n[\s\S]*?marco-kiosk\.desktop" \][^\n]*\n {6}kiosk_menu_entry "\$DIR\/current\/deploy\/kiosk\.sh"/);
  // the new version's installer does the kiosk setup, this one when it cannot
  assert.match(src, /grep -q '\^ \*--kiosk-setup\)' "\$LIBDIR\/install\.sh"/);
  assert.match(src, /run bash "\$LIBDIR\/install\.sh" "\$\{args\[@\]\}" && return 0\n[^\n]*\n {2}fi\n {2}setup_kiosk "\$kiosk_cmd"/);
  assert.equal((src.match(/setup_kiosk_current "\$(?:DIR\/current|app)\/deploy\/kiosk\.sh"/g) || []).length, 2);
  assert.match(src, /--kiosk-setup\) ACTION=kiosk-setup;/);
  assert.match(src, /marco url \| marco kiosk \| marco uninstall/);
});

// ---- the installer -------------------------------------------------------------------------------------------

test('installer: the power-off units only with --power-button, and nothing in them is read from the request', () => {
  const src = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
  assert.match(src, /PathExists=\/run\/marco\/poweroff/);
  assert.match(src, /ExecStartPre=\/bin\/rm -f \/run\/marco\/poweroff\nExecStart=\/usr\/bin\/systemctl --no-block poweroff/);
  assert.match(src, /--power-button\) POWER=1; POWER_FLAG=1 ;;/);
  // off unless the owner says so: no flag and no terminal (curl | bash --yes, marco update) leaves it off
  assert.match(src, /choose_power\(\) \{\n {2}\[ -z "\$POWER" \] \|\| return 0\n {2}POWER=0\n {2}if \[ "\$MODE" = all \] && interactive; then/);
  assert.match(src, /remove_update_units\n {2}remove_power_units\n {2}remove_kiosk/);
  // a request left from a tap while the unit was stopped never powers off at `marco power on`
  assert.match(src, /run rm -f \/run\/marco\/poweroff\n {2}if \[ "\$SYSTEMD" = 1 \]; then\n {4}run systemctl daemon-reload\n {4}run systemctl enable --now "\$POWER_UNIT.path"/);
  assert.match(src, /run rm -f "\/etc\/systemd\/system\/\$POWER_UNIT.path" "\/etc\/systemd\/system\/\$POWER_UNIT.service" \/run\/marco\/poweroff/);
  // the answer to the question is applied like a flag, also on an install that is up to date
  assert.match(src, /confirm_no "Allow that card to power off this device\?"; then POWER=1; fi\n(?: {4}#.*\n)* {4}POWER_FLAG=1/);
  const unit = fs.readFileSync(path.join(ROOT, 'deploy/marco.service'), 'utf8');
  assert.match(unit, /^RuntimeDirectory=marco$/m);
  assert.match(unit, /^RuntimeDirectoryMode=0755$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m, 'the service never gains privileges');
  const cli = fs.readFileSync(path.join(ROOT, 'deploy/marco'), 'utf8');
  assert.match(cli, /on\|off\) installer --power-units "\$1" ;;/);
});
