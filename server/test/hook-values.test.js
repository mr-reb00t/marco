// Pushed values for the Valor card on the real app (server/app.js): POST/GET/DELETE /api/hooks/values (body checks,
// caps, the 2 s last-wins window, data/values.json written later and read back), GET /api/display/values (only the
// keys the requesting screen shows, nothing while it is private), the SSE `values` event (to the screens that show a
// key, coalesced, with a snapshot when a stream opens), and the admin's list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle } from '../core/canvasCore.js';
import { parseValues, screenValueKeys, VALUES_LIMITS } from '../core/valuesCore.js';
import { validateConfig } from '../core/validate.js';
import { displayWidgets } from '../core/screens.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetAnnouncements } from '../announce.js';
import { _resetActivityThrottle } from '../activity.js';
import { _resetPairing } from '../pairing.js';
import { syncDisplayKeys, listDisplayLinks, _resetDisplayAccess } from '../displayAccess.js';
import { _resetPoll } from '../pollHub.js';
import { _resetPrivacy } from '../privacy.js';
import { createToken, _resetTokenState } from '../tokens.js';
import { _resetValues, flushValues, putValues, VALUES_TIMING } from '../values.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await wait(15);
  }
}

const M = (x, y, size) => ({ zone: 'main', x, y, size });
const item = (id, kind, pos, props = {}, extra = {}) => ({ id, kind, pos, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra });

async function withApp(fn, { timing = {}, mutate = () => {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-values-'));
  const saved = { ...VALUES_TIMING };
  Object.assign(VALUES_TIMING, { saveMs: 60, coalesceMs: 40, windowMs: 300 }, timing);
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'private';
  const main = c.screens[0];
  main.layout.preset = 'canvas';
  main.canvas = {
    ...defaultCanvas(),
    items: [
      item('cv_valu0001', 'value', M(0, 0, 's'), { key: 'solar.today', unit: 'kWh' }),
      item('cv_valu0002', 'value', M(3, 0, 's'), { key: 'washer' }),
      item('cv_valu0003', 'value', M(6, 0, 's'), { key: 'hidden.key' }, { hidden: true }),
      item('cv_html0001', 'html', M(0, 3, 'm'), { html: '<b>{{w}}</b>', css: '', bind: [{ name: 'w', value: 'wind' }] }),
    ],
  };
  const hall = defaultScreenProfile({ id: 's_hall', slug: 'hall', name: 'Hall' });
  hall.layout.preset = 'canvas';
  hall.canvas = { ...defaultCanvas(), items: [item('cv_hall0001', 'value', M(0, 0, 's'), { key: 'garage' })] };
  c.screens.push(hall);
  mutate(c);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  store.initStore(dir);
  _resetDisplays();
  _resetAnnouncements();
  _resetPairing();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetPoll();
  _resetPrivacy?.();
  _resetTokenState();
  _resetValues();
  setServerVersion('0.5.0');
  await ensurePassword();
  syncDisplayKeys();
  const app = createApp({ version: '0.5.0', dist: path.join(dir, 'dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {}, raw, type = 'application/json' } = {}) => {
    const r = await fetch(base + url, {
      method,
      headers: { ...headers, ...(body !== undefined || raw !== undefined ? { 'content-type': type } : {}) },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text };
  };
  const { token } = createToken('Home Assistant');
  const hook = (method, url, opts = {}) => call(method, `/api/hooks${url}`, { ...opts, headers: { authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });
  const key = (slug) => listDisplayLinks().find((l) => l.slug === (slug === 'main' ? store.getConfig().screens[0].slug : slug)).key;
  const display = (url, slug = 'main') => call('GET', url, { headers: { 'x-marco-key': key(slug) } });
  const login = async () => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret-pass-123' }) });
    assert.equal(r.status, 200);
    return r.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  };
  const stream = async (slug) => {
    const ctl = new AbortController();
    const r = await fetch(`${base}/api/stream?client=test-${slug}&k=${encodeURIComponent(key(slug))}`, { signal: ctl.signal });
    assert.equal(r.status, 200);
    const events = [];
    const reader = r.body.getReader();
    let buf = '';
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += Buffer.from(value).toString('utf8');
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(chunk)?.[1];
            const data = /^data: (.*)$/m.exec(chunk)?.[1];
            if (ev) events.push({ event: ev, data: data ? JSON.parse(data) : null });
          }
        }
      } catch { /* aborted */ }
    })();
    return { events, values: () => events.filter((e) => e.event === 'values').map((e) => e.data), close: () => ctl.abort() };
  };
  try {
    await fn({ dir, call, hook, display, login, stream, token });
  } finally {
    closeAll();
    await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
    _resetValues();
    Object.assign(VALUES_TIMING, saved);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('parseValues: keys, types, lengths, caps, duplicates (the last one wins), a single entry', () => {
  assert.deepEqual(parseValues({ values: [{ key: 'a', value: 1 }, { key: 'b', value: 'x', unit: 'kWh', label: 'Solar' }, { key: 'a', value: true }] }).values, [
    { key: 'b', value: 'x', unit: 'kWh', label: 'Solar' }, { key: 'a', value: true },
  ]);
  assert.deepEqual(parseValues({ key: 'one', value: 2.5 }).values, [{ key: 'one', value: 2.5 }]);
  for (const bad of [
    null, [], 'x', {}, { values: [] }, { values: 'x' },
    { values: [{ key: 'Upper', value: 1 }] }, { values: [{ key: '__proto__', value: 1 }] }, { values: [{ key: 'constructor', value: 1 }] },
    { values: [{ key: 'prototype', value: 1 }] }, { values: [{ key: 'a b', value: 1 }] }, { values: [{ key: 'x'.repeat(41), value: 1 }] },
    { values: [{ key: 'a', value: null }] }, { values: [{ key: 'a', value: {} }] }, { values: [{ key: 'a', value: [1] }] },
    { values: [{ key: 'a', value: 'x'.repeat(121) }] }, { values: [{ key: 'a', value: 1, unit: 3 }] }, { values: [{ key: 'a', value: 1, label: {} }] },
    { values: Array.from({ length: VALUES_LIMITS.perRequest + 1 }, (_, i) => ({ key: `k${i}`, value: i })) },
  ]) assert.ok(parseValues(bad).error, JSON.stringify(bad)?.slice(0, 80));
  // NaN and Infinity never come from JSON, but a caller may pass them
  assert.ok(parseValues({ values: [{ key: 'a', value: Number.NaN }] }).error);
  // control characters and line breaks are spaces; long units and labels are cut
  assert.deepEqual(parseValues({ values: [{ key: 'a', value: 'one\ntwo\u0000', unit: 'u'.repeat(30), label: 'l'.repeat(60) }] }).values[0], {
    key: 'a', value: 'one two', unit: 'u'.repeat(VALUES_LIMITS.unitChars), label: 'l'.repeat(VALUES_LIMITS.labelChars),
  });
});

test('screenValueKeys: Valor cards and custom cards bound to a key, not hidden ones, only on Personalizado', () => {
  const s = { layout: { preset: 'canvas' }, canvas: { items: [
    { kind: 'value', props: { key: 'a' } }, { kind: 'value', props: { key: 'b' }, hidden: true }, { kind: 'value', props: { key: '' } },
    { kind: 'html', props: { bind: [{ name: 'x', value: 'c' }, { name: 'y', entity: 'sensor.x' }] } },
  ] } };
  assert.deepEqual([...screenValueKeys(s)].sort(), ['a', 'c']);
  assert.equal(screenValueKeys({ ...s, layout: { preset: 'bigCalendar' } }).size, 0);
});

test('POST /api/hooks/values stores, GET lists, the display gets only its own keys, DELETE clears', async () => {
  await withApp(async ({ hook, display, login, call }) => {
    let r = await hook('POST', '/values', { body: { values: [{ key: 'solar.today', value: 12.34, unit: 'kWh', label: 'Solar' }, { key: 'wind', value: 'NE' }, { key: 'garage', value: true }, { key: 'nobody', value: 1 }, { key: 'hidden.key', value: 5 }] } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { ok: true, stored: 5, waiting: 0 });
    r = await hook('GET', '/values');
    assert.deepEqual(r.json.values.map((v) => v.key), ['garage', 'hidden.key', 'nobody', 'solar.today', 'wind']);
    const solar = r.json.values.find((v) => v.key === 'solar.today');
    assert.equal(solar.unit, 'kWh');
    assert.equal(solar.label, 'Solar');
    assert.deepEqual(solar.screens, [store.getConfig().screens[0].slug]);
    assert.ok(!Number.isNaN(Date.parse(solar.updatedAt)));

    // the main screen: its two Valor keys and the custom card's key; not the hidden card's, not the hall's, not others
    r = await display('/api/display/values');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json.values).sort(), ['solar.today', 'washer', 'wind']);
    assert.equal(r.json.values.washer, null, 'a key with no value yet is null');
    assert.deepEqual({ ...r.json.values['solar.today'], at: 0 }, { v: 12.34, u: 'kWh', l: 'Solar', at: 0 });
    assert.equal(r.json.full, true);
    r = await display('/api/display/values', 'hall');
    assert.deepEqual(Object.keys(r.json.values), ['garage']);
    assert.equal(r.json.values.garage.v, true);
    // no credential: refused by displayAuth like every display route
    assert.equal((await call('GET', '/api/display/values')).status, 401);

    // a later push without unit or label keeps them
    VALUES_TIMING.windowMs = 0;
    await hook('POST', '/values', { body: { values: [{ key: 'solar.today', value: 13 }] } });
    r = await display('/api/display/values');
    assert.deepEqual({ ...r.json.values['solar.today'], at: 0 }, { v: 13, u: 'kWh', l: 'Solar', at: 0 });

    r = await hook('DELETE', '/values/solar.today');
    assert.deepEqual(r.json, { ok: true });
    assert.equal((await hook('DELETE', '/values/solar.today')).status, 404);
    assert.equal((await hook('DELETE', '/values/Bad%20Key')).status, 400);
    assert.equal((await display('/api/display/values')).json.values['solar.today'], null);

    // the admin's list (session only) and its delete
    assert.equal((await call('GET', '/api/admin/values')).status, 401);
    const cookie = await login();
    r = await call('GET', '/api/admin/values', { headers: { cookie } });
    assert.equal(r.status, 200);
    assert.ok(r.json.values.some((v) => v.key === 'wind'));
    r = await call('DELETE', '/api/admin/values/wind', { headers: { cookie } });
    assert.equal(r.status, 200);
    assert.ok(!(await hook('GET', '/values')).json.values.some((v) => v.key === 'wind'));
  });
});

test('POST /api/hooks/values: bad bodies, JSON only, 8 KB, the limit of keys', async () => {
  await withApp(async ({ hook }) => {
    let r = await hook('POST', '/values', { body: { values: [{ key: 'BAD', value: 1 }] } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /key/);
    r = await hook('POST', '/values', { raw: '{"values":[', headers: {} });
    assert.equal(r.status, 400);
    r = await hook('POST', '/values', { raw: 'key=a', type: 'text/plain' });
    assert.equal(r.status, 415);
    const big = JSON.stringify({ values: [{ key: 'a', value: 'x'.repeat(100) }], pad: 'y'.repeat(9000) });
    r = await hook('POST', '/values', { raw: big });
    assert.equal(r.status, 413);
    // 50 keys at most: a request that would go over stores nothing
    for (let i = 0; i < 50; i += 20) {
      r = await hook('POST', '/values', { body: { values: Array.from({ length: Math.min(20, 50 - i) }, (_, j) => ({ key: `k${i + j}`, value: j })) } });
      assert.equal(r.status, 200, r.text);
    }
    r = await hook('POST', '/values', { body: { values: [{ key: 'k1', value: 9 }, { key: 'one.more', value: 1 }] } });
    assert.equal(r.status, 409);
    assert.equal((await hook('GET', '/values')).json.values.find((v) => v.key === 'k1').value, 1, 'nothing stored');
    // known keys still update
    VALUES_TIMING.windowMs = 0;
    r = await hook('POST', '/values', { body: { values: [{ key: 'k1', value: 9 }] } });
    assert.equal(r.status, 200);
  });
});

test('one stored update per key every 2 s: later ones wait and the last value wins, never a 429', async () => {
  await withApp(async ({ hook, display }) => {
    const v = async () => (await display('/api/display/values')).json.values.washer?.v;
    let r = await hook('POST', '/values', { body: { key: 'washer', value: 'idle' } });
    assert.deepEqual(r.json, { ok: true, stored: 1, waiting: 0 });
    r = await hook('POST', '/values', { body: { key: 'washer', value: 'running' } });
    assert.deepEqual(r.json, { ok: true, stored: 0, waiting: 1 });
    r = await hook('POST', '/values', { body: { values: [{ key: 'washer', value: 'done' }, { key: 'wind', value: 3 }] } });
    assert.deepEqual(r.json, { ok: true, stored: 1, waiting: 1 });
    assert.equal(await v(), 'idle');
    await until(async () => (await v()) === 'done', 2000, 'the waiting value');
    // nothing else comes after the window: 'running' was replaced while it waited
    await wait(400);
    assert.equal(await v(), 'done');
  });
});

test('data/values.json is written later and read back after a restart', async () => {
  await withApp(async ({ dir, hook }) => {
    await hook('POST', '/values', { body: { values: [{ key: 'solar.today', value: 4.2, unit: 'kWh' }] } });
    assert.ok(!fs.existsSync(path.join(dir, 'values.json')), 'not written at once');
    await until(() => fs.existsSync(path.join(dir, 'values.json')), 2000, 'values.json');
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'values.json'), 'utf8'));
    assert.equal(disk.values['solar.today'].value, 4.2);
    assert.equal(disk.values['solar.today'].by, 'token:Home Assistant');
    // a restart (the module forgets its memory) reads the file again
    _resetValues();
    assert.equal((await hook('GET', '/values')).json.values[0].value, 4.2);
    // a broken file is ignored
    fs.writeFileSync(path.join(dir, 'values.json'), '{nope');
    _resetValues();
    assert.deepEqual((await hook('GET', '/values')).json.values, []);
    putValues([{ key: 'x', value: 1 }]);
    flushValues();
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'values.json'), 'utf8')).values.x.value, 1);
  });
});

test('the SSE values event: a snapshot when the stream opens, then only the screens that show a key, coalesced', async () => {
  await withApp(async ({ hook, stream }) => {
    await hook('POST', '/values', { body: { values: [{ key: 'wind', value: 1 }] } });
    await wait(120); // its own event goes out before the streams open
    const main = await stream('main');
    const hall = await stream('hall');
    try {
      await until(() => main.values().length, 2000, 'snapshot');
      const snap = main.values()[0];
      assert.equal(snap.full, true);
      assert.deepEqual(Object.keys(snap.values).sort(), ['solar.today', 'washer', 'wind']);
      await until(() => hall.values().length, 2000, 'hall snapshot');
      VALUES_TIMING.windowMs = 0;
      await hook('POST', '/values', { body: { values: [{ key: 'solar.today', value: 1 }, { key: 'nobody', value: 2 }] } });
      await hook('POST', '/values', { body: { values: [{ key: 'washer', value: 'done' }] } });
      await until(() => main.values().length >= 2, 2000, 'event');
      await wait(150);
      const evs = main.values().slice(1);
      assert.equal(evs.length, 1, 'two pushes in one second are one event');
      assert.equal(evs[0].full, false);
      assert.deepEqual(Object.keys(evs[0].values).sort(), ['solar.today', 'washer']);
      assert.equal(hall.values().length, 1, 'the hall shows none of those keys');
      await hook('POST', '/values', { body: { values: [{ key: 'garage', value: false }] } });
      await until(() => hall.values().length === 2, 2000, 'hall event');
      assert.deepEqual(hall.values()[1].values, { garage: { ...hall.values()[1].values.garage, v: false } });
      await wait(100);
      assert.equal(main.values().length, 2);
      // a delete reaches the screen as null
      await hook('DELETE', '/values/washer');
      await until(() => main.values().length === 3, 2000, 'delete event');
      assert.deepEqual(main.values()[2].values, { washer: null });
    } finally {
      main.close();
      hall.close();
    }
  });
});

test('a private screen gets no values (display route and events)', async () => {
  await withApp(async ({ hook, display, call, login, stream }) => {
    await hook('POST', '/values', { body: { values: [{ key: 'wind', value: 1 }] } });
    const cookie = await login();
    const p = await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: [store.getConfig().screens[0].id] }, headers: { cookie } });
    assert.equal(p.status, 200, p.text);
    assert.deepEqual((await display('/api/display/values')).json.values, {});
    const cfg = (await display('/api/display/config')).json;
    assert.ok(cfg.canvas.items.filter((i) => i.kind === 'value').every((i) => i.disabled === 'privacy'));
    const s = await stream('main');
    try {
      await wait(200);
      VALUES_TIMING.windowMs = 0;
      await hook('POST', '/values', { body: { values: [{ key: 'wind', value: 2 }] } });
      await wait(200);
      assert.ok(s.values().every((e) => !Object.keys(e.values).length), JSON.stringify(s.values()));
    } finally {
      s.close();
    }
  });
});

test('Mostrar solo si on a value: the server says which items to leave out, sends no value for them, and tells the screen when it changes', async () => {
  const mutate = (c) => {
    c.screens[0].canvas.items.push(
      item('cv_head0001', 'heading', M(0, 6, 'w'), { title: 'Lavadora' }, { when: { src: 'value', key: 'washer', op: 'eq', value: 'Terminado' } }),
      item('cv_valu0005', 'value', M(6, 6, 's'), { key: 'garage' }, { when: { src: 'value', key: 'solar.today', op: 'gt', value: '5' } }),
    );
  };
  await withApp(async ({ hook, display, stream }) => {
    // nothing came yet: both wait, and the hidden Valor card's key is not sent
    let r = await display('/api/display/values');
    assert.deepEqual(r.json.hide.sort(), ['cv_head0001', 'cv_valu0005']);
    assert.equal('garage' in r.json.values, false, 'no value for a hidden card');
    // the projection says only which feed decides
    const cfg = await display('/api/display/config');
    assert.deepEqual(cfg.json.canvas.items.find((x) => x.id === 'cv_head0001').when, { src: 'value' });
    assert.equal(JSON.stringify(cfg.json.canvas.items.find((x) => x.id === 'cv_head0001')).includes('Terminado'), false);
    const st = await stream('main');
    try {
      await until(() => st.values().length, 3000, 'hello');
      assert.deepEqual(st.values()[0].hide.sort(), ['cv_head0001', 'cv_valu0005']);
      assert.equal((await hook('POST', '/values', { body: { values: [{ key: 'washer', value: 'terminado' }, { key: 'solar.today', value: 12.6 }, { key: 'garage', value: 'open' }] } })).status, 200);
      const ev = await until(() => st.values().find((x) => Array.isArray(x.hide) && !x.hide.length), 3000, 'condition event');
      assert.equal(ev.full, true);
      assert.equal(ev.values.garage.v, 'open', 'the card shows now, with its value');
    } finally {
      st.close();
    }
    r = await display('/api/display/values');
    assert.deepEqual(r.json.hide, []);
    // another screen without conditions: no list at all
    assert.equal('hide' in (await display('/api/display/values', 'hall')).json, false);
  }, { mutate });
});

// ---- the Value widget (#34): pushed values on the Modern and Classic layouts, in a corner, the side column, the
// whole screen or a Personalizado widget card

const valueWidget = (id, keys, extra = {}) => ({
  id, type: 'value', name: 'Cars',
  options: { url: '', refreshSec: 0, fit: 'contain', bust: false, value: { items: keys.map((key) => ({ key, label: '', unit: '', decimals: 0, icon: '' })), staleAfterMin: 60, ...extra } },
});

test('Value widget: checked like the Valor card, 1 to 6 keys, only where the server offers it', () => {
  const withWidget = (w, opts) => {
    const c = defaultConfig();
    c.widgets = [w];
    return validateConfig(c, opts);
  };
  let r = withWidget({ ...valueWidget('w_vals0001', ['tesla.mayalicious', 'tesla.topper']), options: { value: { items: [
    { key: 'tesla.mayalicious', label: 'Car 1', unit: '%', decimals: 9, icon: '🚗', extra: '<b>' }, { key: 'tesla.topper' },
  ], staleAfterMin: 30 } } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.widgets[0].options.value, { items: [
    { key: 'tesla.mayalicious', label: 'Car 1', unit: '%', decimals: 3, icon: '🚗' },
    { key: 'tesla.topper', label: '', unit: '', decimals: 1, icon: '' },
  ], staleAfterMin: 30 });
  assert.equal(r.value.widgets[0].options.url, '');
  for (const [bad, path] of [
    [{ items: [] }, 'items'],
    [{ items: [{ key: 'Bad Key' }] }, 'items.0.key'],
    [{ items: [{ key: '' }] }, 'items.0.key'],
    [{ items: [{ key: '__proto__' }] }, 'items.0.key'],
    [{ items: Array.from({ length: 7 }, (_, i) => ({ key: `k${i}` })) }, 'items'],
    [{ items: 'x' }, 'items'],
  ]) {
    r = withWidget({ id: 'w_vals0001', type: 'value', name: '', options: { value: bad } });
    assert.ok(r.errors.some((e) => e.path === `widgets[0].options.value.${path}`), `${JSON.stringify(bad).slice(0, 60)}: ${JSON.stringify(r.errors)}`);
  }
  // a server without it (widgetTypes) refuses it
  r = withWidget(valueWidget('w_vals0001', ['a']), { widgetTypes: ['image', 'prices', 'currency'] });
  assert.ok(r.errors.some((e) => e.path === 'widgets[0].type'), JSON.stringify(r.errors));
});

test('Value widget: a screen gets the keys of the widgets placed on it, wherever they are, and no others', () => {
  const widgets = [valueWidget('w_vals0001', ['car.one', 'car.two']), valueWidget('w_vals0002', ['solar']), valueWidget('w_vals0003', ['secret'])];
  const side = { layout: { preset: 'bigCalendar' }, widgets: [{ widgetId: 'w_vals0001', place: 'side', corner: 'br', size: 'm' }] };
  assert.deepEqual([...screenValueKeys(side, null, widgets)].sort(), ['car.one', 'car.two']);
  // without the widgets list (an older caller): none
  assert.equal(screenValueKeys(side).size, 0);
  // the whole screen (the Widget layout), and a Personalizado widget card next to its Valor cards
  assert.deepEqual([...screenValueKeys({ layout: { preset: 'widget', widgetId: 'w_vals0002' } }, null, widgets)], ['solar']);
  const canvas = { layout: { preset: 'canvas' }, canvas: { items: [
    { id: 'a', kind: 'value', props: { key: 'washer' } }, { id: 'b', kind: 'widget', props: { widgetId: 'w_vals0002' } },
    { id: 'c', kind: 'widget', props: { widgetId: 'w_vals0003' }, hidden: true },
  ] } };
  assert.deepEqual([...screenValueKeys(canvas, null, widgets)].sort(), ['solar', 'washer']);
  // what the display gets: the widget's keys and options, no address
  const out = displayWidgets({ widgets }, side);
  assert.deepEqual(out.map((w) => [w.type, w.place, w.src]), [['value', 'side', '']]);
  assert.deepEqual(out[0].value.items.map((x) => x.key), ['car.one', 'car.two']);
});

test('Value widget: GET /api/display/values sends a Modern screen the keys of its widget, the admin lists where they show', async () => {
  const mutate = (c) => {
    c.widgets = [valueWidget('w_vals0001', ['car.one', 'car.two']), valueWidget('w_vals0002', ['secret.key'])];
    const hall = c.screens.find((s) => s.id === 's_hall');
    hall.layout.preset = 'bigCalendar';
    hall.widgets = [{ widgetId: 'w_vals0001', place: 'side', corner: 'br', size: 'm' }];
  };
  await withApp(async ({ hook, display }) => {
    VALUES_TIMING.windowMs = 0;
    let r = await hook('POST', '/values', { body: { values: [{ key: 'car.one', value: 43, unit: '%' }, { key: 'secret.key', value: 'x' }, { key: 'garage', value: true }] } });
    assert.equal(r.status, 200, r.text);
    r = await display('/api/display/values', 'hall');
    // the hall is no longer Personalizado: its Valor card's key goes, the widget's come; never the unplaced widget's
    assert.deepEqual(Object.keys(r.json.values).sort(), ['car.one', 'car.two']);
    assert.deepEqual({ ...r.json.values['car.one'], at: 0 }, { v: 43, u: '%', at: 0 });
    assert.equal(r.json.values['car.two'], null);
    assert.ok(!('car.one' in (await display('/api/display/values')).json.values), 'not on the main screen');
    // the display config carries the widget (its keys and options)
    r = await display('/api/display/config', 'hall');
    const w = r.json.widgets.find((x) => x.id === 'w_vals0001');
    assert.equal(w.type, 'value');
    assert.deepEqual(w.value.items.map((x) => x.key), ['car.one', 'car.two']);
    r = await hook('GET', '/values');
    assert.deepEqual(r.json.values.find((v) => v.key === 'car.one').screens, ['hall']);
    assert.deepEqual(r.json.values.find((v) => v.key === 'secret.key').screens, []);
  }, { mutate });
});
