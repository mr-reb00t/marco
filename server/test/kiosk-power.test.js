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
import { POWER_PER_MINUTE, powerLimiter, powerUnitPresent, requestKioskExit, requestPoweroff, runDir } from '../power.js';
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
    assert.equal(powerUnitPresent({ MARCO_POWER_UNIT: path.join(dir, 'marco-power.path') }), false);

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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('powerLimiter: six tries a minute per action, one accepted every 30 s, a power-off for good', () => {
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
  assert.equal(l.already('off', 10_000_000), true);
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
  const call = async (method, url, { body, headers = {}, raw } = {}) => {
    const r = await realFetch(`http://${host}${url}`, {
      method,
      headers: { ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json', origin: `http://${host}` } : {}), ...headers },
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
    await fn({ call, calls, host, runFolder, keyOf, login, tick: (ms) => { clock += ms; } });
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

test('route: the power-off asks once, for good; without the unit or a runtime folder it says why', async () => {
  await withServer(async ({ call, calls, runFolder, tick }) => {
    const ask = () => call('POST', '/api/display/power', { body: { item: 'cv_power001', action: 'off' } });
    assert.equal((await ask()).status, 202);
    await wait(30);
    assert.deepEqual(calls, [['off', runFolder]]);
    assert.deepEqual(listActivity({ type: 'display.poweroff' }).items[0].data, { screen: 'living-room', item: 'cv_power001' });
    tick(600_000);
    const later = await ask();
    assert.equal(later.status, 202);
    assert.equal(later.json.already, true);
    await wait(30);
    assert.equal(calls.length, 1);
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
  assert.match(src, /const remote = !fake && !loopbackHost\(location\.hostname\);/);
  assert.match(src, /if \(fake \|\| remote \|\| busy \|\| gone \|\| hidden\(\)\) return;/);
  assert.match(src, /set\('working'\);\n\s+if \(fake\) return;/);
});

// ---- deploy/kiosk.sh -------------------------------------------------------------------------------------------

const has = (cmd) => spawnSync('bash', ['-c', `command -v ${cmd}`]).status === 0;
const shellOk = has('bash') && has('flock') && has('pkill') && has('pgrep');

/** kiosk.sh with a fake Chromium (a bash loop that keeps its flags), no server wait, temp folders. */
function kioskRun(t) {
  const fake = path.join(t, 'bin');
  fs.mkdirSync(fake, { recursive: true });
  fs.writeFileSync(path.join(fake, 'chromium-browser'), `#!/usr/bin/env bash\necho $$ >> "${t}/browser.pids"\nwhile :; do sleep 0.2; done\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(fake, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const d of ['run', 'xdg', 'home']) fs.mkdirSync(path.join(t, d), { recursive: true });
  const env = {
    PATH: `${fake}:/usr/bin:/bin`, HOME: path.join(t, 'home'), XDG_RUNTIME_DIR: path.join(t, 'xdg'), MARCO_RUN_DIR: path.join(t, 'run'),
    KIOSK_URL: 'http://127.0.0.1:9/', KIOSK_WAIT_SEC: '0', KIOSK_LOG: path.join(t, 'kiosk.log'), PORT: '9', MARCO_DATA_DIR: path.join(t, 'nodata'), KIOSK_CLIENT: 'test',
  };
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
    assert.equal(fs.readFileSync(path.join(t, 'xdg', 'marco-kiosk.closed'), 'utf8'), '2000');
    assert.equal(fs.statSync(path.join(t, 'xdg', 'marco-kiosk.closed')).mode & 0o077, 0);
    assert.ok(!fs.existsSync(path.join(t, 'pwned')) && !fs.existsSync(path.join(ROOT, 'pwned')));
    assert.match(fs.readFileSync(path.join(t, 'kiosk.log'), 'utf8'), /Exit asked from the screen/);
    // the desktop starts it again (LXDE-pi's @): it exits at once, no browser
    const b = kioskRun(t);
    runs.push(b.p);
    assert.equal(await Promise.race([b.done, wait(5000).then(() => 'timeout')]), 0);
    assert.equal(pidsOf(t).length, 1, 'no second browser');
    // the next request, after a login (marker gone): it opens again
    fs.rmSync(path.join(t, 'xdg', 'marco-kiosk.closed'));
    const c = kioskRun(t);
    runs.push(c.p);
    assert.ok(await until(() => pidsOf(t).length === 2), 'opens again after a new login');
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

// ---- the installer -------------------------------------------------------------------------------------------

test('installer: the power-off units only with --power-button, and nothing in them is read from the request', () => {
  const src = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
  assert.match(src, /PathExists=\/run\/marco\/poweroff/);
  assert.match(src, /ExecStartPre=\/bin\/rm -f \/run\/marco\/poweroff\nExecStart=\/usr\/bin\/systemctl --no-block poweroff/);
  assert.match(src, /--power-button\) POWER=1; POWER_FLAG=1 ;;/);
  // off unless the owner says so: no flag and no terminal (curl | bash --yes, marco update) leaves it off
  assert.match(src, /choose_power\(\) \{\n {2}\[ -z "\$POWER" \] \|\| return 0\n {2}POWER=0\n {2}if \[ "\$MODE" = all \] && interactive; then/);
  assert.match(src, /remove_update_units\n {2}remove_power_units\n {2}remove_kiosk/);
  const unit = fs.readFileSync(path.join(ROOT, 'deploy/marco.service'), 'utf8');
  assert.match(unit, /^RuntimeDirectory=marco$/m);
  assert.match(unit, /^RuntimeDirectoryMode=0755$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m, 'the service never gains privileges');
  const cli = fs.readFileSync(path.join(ROOT, 'deploy/marco'), 'utf8');
  assert.match(cli, /on\|off\) installer --power-units "\$1" ;;/);
});
