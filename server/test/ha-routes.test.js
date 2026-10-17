// Home Assistant routes on the real app (server/app.js) with a fake Home Assistant (fakeHa.js): GET /api/display/ha
// and the SSE `ha` event (aliases only: no entity id, URL, picture or token ever reaches a display), private
// screens, chart history (history up to 24 h, statistics for 7 days, at most 200 points), media art (only HA's own
// proxy path, never an absolute entity_picture), redirects refused on every Home Assistant call (no request reaches
// the other host), "Probar conexión" with a new URL never carries the stored token, the admin routes (status, slim,
// history, entities by area), the token in no response and no log line, and the controls: the refusal ladder of
// POST /api/display/ha/action (each refusal with its own error and no service call), clamped service calls, two taps
// for door-like entities, the rate limit, and the builder's Probar route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle } from '../core/canvasCore.js';
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
import { startHomeAssistantLive, stopHomeAssistantLive } from '../haService.js';
import { _resetHaRoutes } from '../routes/ha.js';
import { invalidateEntityCache } from '../homeassistant.js';
import { request } from '../lib/http.js';
import { fakeHa, FAKE_HA_TOKEN, FAKE_JPEG } from './fakeHa.js';
import { hasWebSocket } from '../haWs.js';

// the live mirror needs Node's global WebSocket (Node 22 and later); on Node 20 the server polls over REST instead
// ("no global WebSocket" in ha-live.test.js), and these tests are skipped
const NEEDS_WS = { skip: hasWebSocket() ? false : 'needs a global WebSocket (Node 22 or later)' };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await wait(20);
  }
}

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));

/** A second server that records every request: the "other host" a redirect or a typed URL points at. */
async function recorder() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, auth: req.headers.authorization ?? null });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"message":"API running."}');
  });
  server.on('upgrade', (req, socket) => {
    hits.push({ url: req.url, auth: req.headers.authorization ?? null, ws: true });
    socket.destroy();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

const NOW = Date.now();
const HISTORY = { 'sensor.living_temp': Array.from({ length: 600 }, (_, i) => [NOW - 20 * 3600_000 + i * 120_000, 20 + Math.sin(i / 30)]) };
const STATS = { 'sensor.outdoor_temp': Array.from({ length: 168 }, (_, i) => [NOW - 7 * 24 * 3600_000 + i * 3600_000, 10 + (i % 24) / 3]) };
const STATES = [
  { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen', brightness: 200, supported_color_modes: ['brightness'] } },
  { entity_id: 'sensor.living_temp', state: '21.4', attributes: { friendly_name: 'Living room', unit_of_measurement: '°C', device_class: 'temperature' } },
  { entity_id: 'sensor.outdoor_temp', state: '12.1', attributes: { friendly_name: 'Outdoor', unit_of_measurement: '°C' } },
  { entity_id: 'binary_sensor.front_door', state: 'off', attributes: { device_class: 'door', friendly_name: 'Front door' } },
  { entity_id: 'media_player.living', state: 'playing', attributes: { friendly_name: 'Speaker', media_title: 'Song', media_artist: 'Band', volume_level: 0.4, entity_picture: '/api/media_player_proxy/media_player.living?token=entitytoken123&cache=9' } },
  { entity_id: 'media_player.cdn', state: 'playing', attributes: { media_title: 'Other', entity_picture: 'PLACEHOLDER' } },
  { entity_id: 'switch.hall', state: 'off', attributes: {} },
  { entity_id: 'light.desk', state: 'off', attributes: { friendly_name: 'Desk', supported_color_modes: ['color_temp'], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 } },
  { entity_id: 'cover.garage', state: 'closed', attributes: { device_class: 'garage', supported_features: 15 } },
  { entity_id: 'cover.blind', state: 'open', attributes: { device_class: 'shutter', supported_features: 15, current_position: 40 } },
  { entity_id: 'switch.garage_door', state: 'off', attributes: { friendly_name: 'Garage door' } },
  { entity_id: 'switch.relay', state: 'off', attributes: { friendly_name: 'Puerta del jardín' } },
  { entity_id: 'climate.living', state: 'heat', attributes: { hvac_modes: ['off', 'heat', 'cool'], min_temp: 16, max_temp: 28, target_temp_step: 0.5, temperature: 21, current_temperature: 20 } },
  { entity_id: 'lock.front', state: 'locked', attributes: {} },
  // the domains of the Entidad card's rows, the Indicador and the Estadística
  { entity_id: 'valve.main_water', state: 'open', attributes: { device_class: 'water', supported_features: 3, friendly_name: 'Llave general' } },
  { entity_id: 'valve.garden', state: 'closed', attributes: { supported_features: 15, current_position: 0, friendly_name: 'Riego' } },
  { entity_id: 'valve.gas', state: 'open', attributes: { device_class: 'gas', supported_features: 3 } },
  { entity_id: 'select.dishwasher', state: 'Eco', attributes: { options: ['Eco', 'Normal', 'Intensive'], friendly_name: 'Lavavajillas' } },
  { entity_id: 'number.timer', state: '45', attributes: { min: 0, max: 120, step: 5, unit_of_measurement: 'min', mode: 'slider' } },
  { entity_id: 'input_number.boiler', state: '22', attributes: { min: 16, max: 30, step: 0.5, mode: 'box', unit_of_measurement: '°C' } },
  { entity_id: 'vacuum.robot', state: 'docked', attributes: { supported_features: 8212, battery_level: 92 } },
  { entity_id: 'update.core', state: 'on', attributes: { installed_version: '2026.9.3', latest_version: '2026.10.1', in_progress: false } },
  { entity_id: 'sensor.energy', state: '1234.5', attributes: { unit_of_measurement: 'kWh', device_class: 'energy', state_class: 'total_increasing' } },
  { entity_id: 'cover.front_gate', state: 'closed', attributes: { device_class: 'door', supported_features: 3 } },
];
const ALL_IDS = STATES.map((s) => s.entity_id);

const M = (x, y, size) => ({ zone: 'main', x, y, size });
const item = (id, kind, pos, props = {}) => ({ id, kind, pos, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props } });

async function withApp(fn, { mutate = () => {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-ha-'));
  globalThis.fetch = offlineFetch;
  const other = await recorder();
  const states = structuredClone(STATES);
  states.find((s) => s.entity_id === 'media_player.cdn').attributes.entity_picture = `${other.url}/evil.jpg`;
  const ha = await fakeHa({
    states, history: HISTORY, statistics: STATS, statValues: { 'sensor.energy': { change: 7.42, mean: 0.31, min: 0, max: 1.2 } },
    areas: [{ area_id: 'kitchen', name: 'Kitchen' }, { area_id: 'living', name: 'Living room' }],
    entityRegistry: [{ entity_id: 'light.kitchen', area_id: 'kitchen' }, { entity_id: 'sensor.living_temp', device_id: 'd1' }],
    deviceRegistry: [{ id: 'd1', area_id: 'living' }],
  });
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'private';
  const main = c.screens[0];
  main.layout.preset = 'canvas';
  main.canvas = {
    ...defaultCanvas(),
    items: [
      item('cv_tile0001', 'ha.tile', M(0, 0, 'xs'), { entity: 'light.kitchen' }),
      item('cv_sens0001', 'ha.sensor', M(4, 0, 'xs'), { entity: 'sensor.living_temp', sparkline: true }),
      item('cv_sens0002', 'ha.sensor', M(8, 0, 'xs'), { entity: 'sensor.outdoor_temp' }),
      item('cv_room0001', 'ha.room', M(12, 0, 'm'), { title: 'Hall', rows: [{ entity: 'binary_sensor.front_door', name: '', interactive: true }] }),
      item('cv_chrt0001', 'ha.chart', M(0, 6, 'm'), { series: [{ entity: 'sensor.living_temp', label: '', color: null }], period: '24h' }),
      item('cv_chrt0002', 'ha.chart', M(8, 6, 'm'), { series: [{ entity: 'sensor.outdoor_temp', label: 'Fuera', color: null }], period: '7d' }),
      item('cv_medi0001', 'ha.media', M(0, 12, 'w'), { entity: 'media_player.living' }),
      item('cv_medi0002', 'ha.media', M(12, 12, 'w'), { entity: 'media_player.cdn' }),
    ],
  };
  const hall = defaultScreenProfile({ id: 's_hall', slug: 'hall', name: 'Hall' });
  hall.layout.preset = 'canvas';
  hall.canvas = { ...defaultCanvas(), items: [item('cv_hall0001', 'ha.tile', M(0, 0, 'xs'), { entity: 'switch.hall' })] };
  c.screens.push(hall);
  c.homeassistant = { enabled: true, url: ha.url, doorbell: { camera: '', seconds: 60, screenIds: [], sound: true } };
  mutate(c);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({
    passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false, homeassistant: { token: FAKE_HA_TOKEN },
  }));
  store.initStore(dir);
  _resetDisplays();
  _resetAnnouncements();
  _resetPairing();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetPoll();
  _resetPrivacy?.();
  _resetHaRoutes();
  invalidateEntityCache();
  setServerVersion('0.5.0');
  await ensurePassword();
  syncDisplayKeys();
  // every console line of the run: the token must never be in one
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  startHomeAssistantLive({ timing: { backoffMin: 30, backoffMax: 100, pollMs: 80, failuresBeforePoll: 3, pingMs: 60_000 }, coalesceMs: 50 });
  const app = createApp({ version: '0.5.0', dist: path.join(dir, 'dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bodies = [];
  const call = async (method, url, { body, headers = {} } = {}) => {
    const r = await realFetch(base + url, {
      method,
      headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
    bodies.push(buf.toString('latin1') + JSON.stringify([...r.headers.entries()]));
    return { status: r.status, json, buf, text: buf.toString('utf8'), headers: r.headers, setCookie: r.headers.getSetCookie?.() || [] };
  };
  // 'main': the first screen, whatever its slug
  const key = (slug) => listDisplayLinks().find((l) => l.slug === (slug === 'main' ? store.getConfig().screens[0].slug : slug)).key;
  const display = (url, slug = 'main', headers = {}) => call('GET', url, { headers: { 'x-marco-key': key(slug), ...headers } });
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  /** An SSE stream: { events: [{ event, data }], close() }. */
  const stream = async (slug) => {
    const ctl = new AbortController();
    const r = await realFetch(`${base}/api/stream?client=test-${slug}&k=${encodeURIComponent(key(slug))}`, { signal: ctl.signal });
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
            bodies.push(chunk);
            const ev = /^event: (.*)$/m.exec(chunk)?.[1];
            const data = /^data: (.*)$/m.exec(chunk)?.[1];
            if (ev) events.push({ event: ev, data: data ? JSON.parse(data) : null });
          }
        }
      } catch { /* aborted */ }
    })();
    return { events, close: () => ctl.abort() };
  };
  try {
    await until(() => ha.connections().some((x) => x.subs.length), 4000, 'mirror subscribed');
    // the connection change of the start has gone out
    await wait(120);
    await fn({ call, display, key, login, stream, ha, other, lines, bodies, base });
    // the Home Assistant token: in no response, no stream event and no log line of the whole run
    for (const b of bodies) assert.equal(b.includes(FAKE_HA_TOKEN), false, 'token in a response');
    for (const l of lines) assert.equal(l.includes(FAKE_HA_TOKEN), false, `token in a log line: ${l.slice(0, 200)}`);
  } finally {
    for (const [k, f] of Object.entries(orig)) console[k] = f;
    stopHomeAssistantLive();
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await ha.close();
    await other.close();
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
}

/** Nothing a display may not see: entity ids, HA URLs, pictures, tokens. */
function clean(text, ha) {
  for (const id of ALL_IDS) assert.equal(text.includes(id), false, `${id} reached a display`);
  for (const bad of [ha.url, 'entity_picture', 'media_player_proxy', 'entitytoken123', FAKE_HA_TOKEN, 'access_token']) assert.equal(text.includes(bad), false, bad);
}

test('GET /api/display/ha: the states of this screen by alias, nothing else; a key is needed', NEEDS_WS, async () => {
  await withApp(async ({ display, call, ha }) => {
    assert.equal((await call('GET', '/api/display/ha')).status, 401);
    const r = await until(async () => {
      const x = await display('/api/display/ha');
      return Object.keys(x.json.states).length >= 8 ? x : null;
    }, 4000, 'states');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.equal(r.json.conn, 'ok');
    assert.equal(r.json.full, true);
    assert.deepEqual(Object.keys(r.json.states).sort(), ['cv_chrt0001:0', 'cv_chrt0002:0', 'cv_medi0001:0', 'cv_medi0002:0', 'cv_room0001:0', 'cv_sens0001:0', 'cv_sens0002:0', 'cv_tile0001:0']);
    // an Entidad card's rows come with its state (drawn read-only here: no touch)
    assert.deepEqual(r.json.states['cv_tile0001:0'], { d: 'light', on: true, bri: 78, ct: null, rgb: null, n: 'Kitchen', at: r.json.states['cv_tile0001:0'].at, c: [] }, 'a dimmable white light: no row unless chosen');
    assert.equal(r.json.states['cv_medi0001:0'].art, true);
    assert.equal(r.json.states['cv_medi0002:0'].art, false, 'a picture on another host is never offered');
    clean(r.text, ha);
    // the other screen's key: only its own alias
    const h = await display('/api/display/ha', 'hall');
    assert.deepEqual(Object.keys(h.json.states), ['cv_hall0001:0']);
    // the display config carries aliases too, and no entity id
    clean((await display('/api/display/config')).text, ha);
  });
});

test('SSE: a full snapshot when the stream opens, then only the aliases that changed; the other screen hears nothing', NEEDS_WS, async () => {
  await withApp(async ({ stream, ha }) => {
    const s = await stream('main');
    const h = await stream('hall');
    try {
      const first = await until(() => s.events.find((e) => e.event === 'ha'), 4000, 'hello snapshot');
      assert.equal(first.data.full, true);
      assert.ok(Object.keys(first.data.states).length >= 7);
      await until(() => h.events.find((e) => e.event === 'ha'));
      const n = s.events.length;
      const nh = h.events.filter((e) => e.event === 'ha').length;
      ha.set('sensor.outdoor_temp', '9.5');
      const ev = await until(() => s.events.slice(n).find((e) => e.event === 'ha' && !e.data.full), 4000, 'diff');
      assert.equal(ev.data.full, false);
      assert.deepEqual(Object.keys(ev.data.states).sort(), ['cv_chrt0002:0', 'cv_sens0002:0']);
      assert.equal(ev.data.states['cv_sens0002:0'].num, 9.5);
      await wait(150);
      assert.equal(h.events.filter((e) => e.event === 'ha').length, nh, 'not the hall screen');
      for (const e of s.events) if (e.event === 'ha') clean(JSON.stringify(e.data), ha);
    } finally {
      s.close();
      h.close();
    }
  });
});

test('a private screen gets no Home Assistant states, no history and no art', NEEDS_WS, async () => {
  await withApp(async ({ display, call, login }) => {
    await until(async () => Object.keys((await display('/api/display/ha')).json.states).length);
    const cookie = await login();
    const p = await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: [store.getConfig().screens[0].id] }, headers: { cookie } });
    assert.equal(p.status, 200, p.text);
    assert.deepEqual((await display('/api/display/ha')).json.states, {});
    assert.equal((await display('/api/display/ha/history/cv_chrt0001')).status, 403);
    assert.equal((await display('/api/display/ha/art/cv_medi0001')).status, 403);
    // the config sends placeholders for the cards
    const cfg = (await display('/api/display/config')).json;
    assert.ok(cfg.canvas.items.filter((i) => i.kind.startsWith('ha.')).every((i) => i.disabled === 'privacy'));
  });
});

test('history: up to 24 h from the recorder history, 7 days from hourly statistics, at most 200 points, labels', NEEDS_WS, async () => {
  await withApp(async ({ display, ha }) => {
    const r = await display('/api/display/ha/history/cv_chrt0001');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.period, '24h');
    assert.equal(r.json.series.length, 1);
    const s = r.json.series[0];
    assert.equal(s.label, 'Living room');
    assert.equal(s.unit, '°C');
    assert.ok(s.points.length <= 200 && s.points.length > 100, String(s.points.length));
    assert.ok(ha.hits.some((h) => h.url.startsWith('/api/history/period/') && h.url.includes('minimal_response') && h.url.includes('no_attributes') && h.url.includes('significant_changes_only')));
    clean(r.text, ha);
    const w = await display('/api/display/ha/history/cv_chrt0002');
    assert.equal(w.json.period, '7d');
    assert.equal(w.json.series[0].label, 'Fuera');
    assert.equal(w.json.series[0].points.length, 168);
    assert.ok(ha.wsLog.some((m) => m.type === 'recorder/statistics_during_period' && m.period === 'hour'));
    // a sensor with its curve, a sensor without, an item of another screen, nonsense
    assert.equal((await display('/api/display/ha/history/cv_sens0001')).status, 200);
    assert.equal((await display('/api/display/ha/history/cv_sens0002')).status, 404);
    assert.equal((await display('/api/display/ha/history/cv_hall0001')).status, 404);
    assert.equal((await display('/api/display/ha/history/cv_tile0001')).status, 404);
    assert.equal((await display('/api/display/ha/history/..%2F..%2Fetc')).status, 404);
    // cached: a second ask does not reach Home Assistant
    const n = ha.hits.length;
    await display('/api/display/ha/history/cv_chrt0001');
    assert.equal(ha.hits.length, n);
  });
});

test('art: only Home Assistant\'s own proxy path, built from the entity id; an absolute entity_picture is never fetched', NEEDS_WS, async () => {
  await withApp(async ({ display, ha, other }) => {
    // home network only by default, like the camera pictures: through a proxy, nothing is fetched
    const out = await display('/api/display/ha/art/cv_medi0001', 'main', { 'x-forwarded-for': '203.0.113.9' });
    assert.equal(out.status, 403);
    assert.equal(out.json.error, 'lan_only');
    assert.equal(ha.hits.filter((h) => h.url.startsWith('/api/media_player_proxy/')).length, 0);
    const r = await display('/api/display/ha/art/cv_medi0001');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual([...r.buf], [...FAKE_JPEG]);
    assert.equal(r.headers.get('x-ha-secret'), null, 'Home Assistant headers are not passed through');
    assert.match(r.headers.get('cache-control'), /no-store/);
    const art = ha.hits.filter((h) => h.url.startsWith('/api/media_player_proxy/'));
    assert.deepEqual(art.map((h) => h.url), ['/api/media_player_proxy/media_player.living'], 'no token query from the attribute');
    // the other player's picture lives on another host: refused, and that host never hears from Marco
    assert.equal((await display('/api/display/ha/art/cv_medi0002')).status, 404);
    assert.equal(other.hits.length, 0);
    // something that is not an image is not served
    ha.state.picture = Buffer.from('<script>alert(1)</script>');
    // a new track: Home Assistant gives the picture a new cache key
    ha.set('media_player.living', 'playing', { ...ha.states.get('media_player.living').attributes, media_title: 'Next song', entity_picture: '/api/media_player_proxy/media_player.living?token=entitytoken123&cache=10' });
    await wait(150);
    const bad = await display('/api/display/ha/art/cv_medi0001');
    assert.equal(bad.status, 502);
    assert.equal(bad.text.includes('<script>'), false);
    assert.equal((await display('/api/display/ha/art/cv_tile0001')).status, 404);
  });
});

test('art and history: many screens at once, or one display asking in a loop, never fan out to Home Assistant', NEEDS_WS, async () => {
  await withApp(async ({ display, ha }) => {
    const artHits = () => ha.hits.filter((h) => h.url.startsWith('/api/media_player_proxy/')).length;
    const histHits = () => ha.hits.filter((h) => h.url.startsWith('/api/history/')).length;
    // 30 requests at the same moment: one fetch of the picture
    const all = await Promise.all(Array.from({ length: 30 }, () => display('/api/display/ha/art/cv_medi0001')));
    assert.ok(all.every((r) => r.status === 200));
    assert.equal(artHits(), 1);
    // a picture that fails is not asked for again at every request
    ha.state.picture = Buffer.from('not a picture');
    ha.set('media_player.living', 'playing', { ...ha.states.get('media_player.living').attributes, entity_picture: '/api/media_player_proxy/media_player.living?cache=11' });
    await wait(150);
    for (let i = 0; i < 10; i++) assert.equal((await display('/api/display/ha/art/cv_medi0001')).status, 502);
    assert.equal(artHits(), 2);
    // history: a failing Home Assistant is asked once, not once per request
    ha.state.restDown = true;
    const h0 = histHits();
    for (let i = 0; i < 10; i++) assert.equal((await display('/api/display/ha/history/cv_chrt0001')).status, 502);
    assert.ok(histHits() - h0 <= 1, `history asked ${histHits() - h0} times`);
  });
});

test('redirects are refused on every Home Assistant call: no request ever reaches the other host', NEEDS_WS, async () => {
  await withApp(async ({ display, call, login, ha, other }) => {
    const cookie = await login();
    ha.state.redirectTo = other.url;
    const t = await call('POST', '/api/admin/test/homeassistant', { body: { url: ha.url }, headers: { cookie } });
    assert.deepEqual(t.json, { ok: false, error: 'redirect_refused' });
    invalidateEntityCache();
    assert.equal((await call('GET', '/api/admin/homeassistant/entities?domain=light', { headers: { cookie } })).status, 502);
    assert.equal((await display('/api/display/ha/history/cv_chrt0001')).status, 502);
    assert.equal((await display('/api/display/ha/art/cv_medi0001')).status, 502);
    const slim = await call('POST', '/api/admin/homeassistant/slim', { body: { entities: ['sensor.unknown_one'] }, headers: { cookie } });
    assert.equal(slim.status, 200);
    // the mirror reconnects through the redirect: refused too
    ha.dropAll();
    await wait(400);
    assert.deepEqual(other.hits, [], 'nothing reached the other host');
  });
});

test('Probar conexión: a new URL without a new token never gets the stored token; with its own token it gets only that', NEEDS_WS, async () => {
  await withApp(async ({ call, login, other, ha }) => {
    const cookie = await login();
    const a = await call('POST', '/api/admin/test/homeassistant', { body: { url: other.url }, headers: { cookie } });
    assert.deepEqual(a.json, { ok: false, error: 'new_url_needs_token' });
    assert.equal(other.hits.length, 0, 'no request at all');
    const b = await call('POST', '/api/admin/test/homeassistant', { body: { url: other.url, token: 'typed-token-for-the-new-url' }, headers: { cookie } });
    assert.equal(b.json.ok, true);
    assert.ok(other.hits.length > 0);
    assert.ok(other.hits.every((h) => h.auth === 'Bearer typed-token-for-the-new-url'));
    // the saved URL with no token typed: the stored token, to the saved URL only
    const c = await call('POST', '/api/admin/test/homeassistant', { body: { url: `${ha.url}/` }, headers: { cookie } });
    assert.equal(c.json.ok, true);
    assert.equal(c.json.version, '2026.10.0');
  });
});

test('a new Home Assistant URL saved in the admin (or imported) never gets the stored token until it is saved for it', NEEDS_WS, async () => {
  await withApp(async ({ call, login, other, ha }) => {
    const cookie = await login();
    const save = async (url) => {
      const cfg = structuredClone(store.getConfig());
      cfg.homeassistant.url = url;
      const r = await call('PUT', '/api/admin/config', { body: cfg, headers: { cookie } });
      assert.equal(r.status, 200, r.text);
    };
    // a token saved before tokens were tied to a URL (no secrets.homeassistant.url): it stays with the old URL
    await save(other.url);
    await wait(400);
    assert.ok(other.hits.every((h) => !h.auth), 'no request to the new URL carried a token');
    const st0 = (await call('GET', '/api/admin/homeassistant/status', { headers: { cookie } })).json;
    assert.equal(st0.state, 'off');
    // the admin knows a token is saved, for another address, and never sees it
    assert.equal(st0.tokenSaved, true);
    assert.equal(st0.tokenForOtherUrl, true);
    assert.equal(JSON.stringify(st0).includes(FAKE_HA_TOKEN), false);
    const t = await call('POST', '/api/admin/test/homeassistant', { body: { url: other.url }, headers: { cookie } });
    assert.deepEqual(t.json, { ok: false, error: 'token_other_url' });
    assert.equal((await call('GET', `/api/admin/homeassistant/camera?entity=camera.front`, { headers: { cookie } })).status, 503);
    // back to the first URL: the token works there again
    await save(ha.url);
    assert.equal((await call('POST', '/api/admin/test/homeassistant', { body: { url: ha.url }, headers: { cookie } })).json.ok, true);
    const st1 = (await call('GET', '/api/admin/homeassistant/status', { headers: { cookie } })).json;
    assert.deepEqual([st1.tokenSaved, st1.tokenForOtherUrl], [true, false]);
    // a token saved now is tied to the saved URL too: the next URL change does not take it along
    assert.equal((await call('PUT', '/api/admin/homeassistant/token', { body: { token: FAKE_HA_TOKEN }, headers: { cookie } })).status, 200);
    assert.equal(store.getSecrets().homeassistant.url, ha.url);
    other.hits.length = 0;
    await save(`${other.url}/`);
    await wait(300);
    assert.ok(other.hits.every((h) => !h.auth));
    // the owner types the new URL and its token: only that token, only there
    const p = await call('PUT', '/api/admin/homeassistant/token', { body: { token: 'token-of-the-new-url', url: other.url }, headers: { cookie } });
    assert.equal(p.status, 200);
    await until(() => other.hits.some((h) => h.auth), 3000, 'the new token in use');
    assert.ok(other.hits.filter((h) => h.auth).every((h) => h.auth === 'Bearer token-of-the-new-url'));
    assert.equal((await call('PUT', '/api/admin/homeassistant/token', { body: { token: 'x', url: 'javascript:alert(1)' }, headers: { cookie } })).status, 400);
  });
});

test('admin: status, slim states for unsaved items, preview history, entities grouped by area (and without areas)', NEEDS_WS, async () => {
  await withApp(async ({ call, login, ha }) => {
    const cookie = await login();
    assert.equal((await call('GET', '/api/admin/homeassistant/status')).status, 401);
    const st = await call('GET', '/api/admin/homeassistant/status', { headers: { cookie } });
    assert.equal(st.json.state, 'connected');
    assert.equal(st.json.watched, 7);
    assert.ok(st.json.count >= 7);
    const slim = await call('POST', '/api/admin/homeassistant/slim', { body: { entities: ['light.kitchen', 'switch.hall', 'sensor.nope', 'not an id'] }, headers: { cookie } });
    assert.equal(slim.status, 200);
    assert.deepEqual(Object.keys(slim.json.states).sort(), ['light.kitchen', 'sensor.nope', 'switch.hall']);
    assert.equal(slim.json.states['sensor.nope'].d, 'unavailable');
    // (up to 80: a screen on the fine grid shows that many)
    assert.equal((await call('POST', '/api/admin/homeassistant/slim', { body: { entities: Array.from({ length: 81 }, (_, i) => `sensor.s${i}`) }, headers: { cookie } })).status, 400);
    const h = await call('GET', '/api/admin/homeassistant/history?entity=sensor.living_temp&period=6h', { headers: { cookie } });
    assert.equal(h.status, 200);
    assert.equal(h.json.series[0].entity, 'sensor.living_temp');
    const e0 = await call('GET', '/api/admin/homeassistant/entities?domain=light,sensor', { headers: { cookie } });
    assert.equal(e0.status, 200);
    // (the desk light belongs to the control tests, the energy sensor to the Estadística ones)
    const e = { json: e0.json.filter((x) => x.entity_id !== 'light.desk' && x.entity_id !== 'sensor.energy') };
    assert.deepEqual(e.json.map((x) => x.entity_id), ['light.kitchen', 'sensor.living_temp', 'sensor.outdoor_temp']);
    assert.equal(e.json[0].area, 'Kitchen');
    assert.equal(e.json[1].area, 'Living room', 'through its device');
    assert.equal(e.json[2].area, null);
    assert.deepEqual(e.json[0].attrs, { brightness: 200, supported_color_modes: ['brightness'] });
    // a token of a user who is not an administrator: no areas, no error
    ha.state.nonAdmin = true;
    invalidateEntityCache();
    const e2 = await call('GET', '/api/admin/homeassistant/entities?domain=light', { headers: { cookie } });
    assert.equal(e2.status, 200);
    assert.ok(e2.json.every((x) => x.area === null));
    // the old single-domain form still works
    assert.equal((await call('GET', '/api/admin/homeassistant/entities?domain=sensor', { headers: { cookie } })).json.length, 3);
  });
});

test('lib/http request: redirect "error" refuses a redirect; the default still follows (calendars, feeds)', async () => {
  const other = await recorder();
  const hop = http.createServer((req, res) => {
    res.writeHead(302, { location: `${other.url}/landed` });
    res.end();
  });
  await new Promise((r) => hop.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${hop.address().port}/x`;
  try {
    await assert.rejects(request(url, { redirect: 'error', headers: { authorization: 'Bearer secret' } }), (e) => e.redirect === true && e.status === 302);
    assert.equal(other.hits.length, 0);
    const ok = await request(url);
    assert.equal(ok.status, 200);
    assert.equal(other.hits.length, 1);
  } finally {
    hop.closeAllConnections?.();
    await new Promise((r) => hop.close(r));
    await other.close();
  }
});

// ---- controls -------------------------------------------------------------------------------------------------------

/** A screen whose cards may be touched: a light, a garage door, a blind, a door-like switch (ticked and not), a climate. */
function touchScreen(c) {
  const main = c.screens[0];
  main.canvas.touch = true;
  // room for them: the charts and the second player go
  main.canvas.items = main.canvas.items.filter((x) => !['cv_chrt0001', 'cv_chrt0002', 'cv_medi0002'].includes(x.id));
  main.canvas.items.push(
    item('cv_ligh0001', 'ha.light', M(0, 6, 's'), { entity: 'light.desk' }),
    item('cv_gara0001', 'ha.cover', M(6, 6, 'xs'), { entity: 'cover.garage' }),
    item('cv_blnd0001', 'ha.cover', M(10, 6, 'xs'), { entity: 'cover.blind' }),
    { ...item('cv_door0001', 'ha.switch', M(16, 6, 'xs'), { entity: 'switch.garage_door' }), ack: true },
    item('cv_door0002', 'ha.switch', M(20, 6, 'xs'), { entity: 'switch.relay' }),
    item('cv_clim0001', 'ha.climate', M(12, 12, 's'), { entity: 'climate.living' }),
    { ...item('cv_noto0001', 'ha.switch', M(20, 0, 'xs'), { entity: 'switch.hall' }), interactive: false },
  );
  // the room's only row may not be touched
  main.canvas.items.find((x) => x.id === 'cv_room0001').props.rows = [{ entity: 'switch.hall', name: '', interactive: false }];
}

const services = (ha) => ha.hits.filter((h) => h.method === 'POST' && h.url.startsWith('/api/services/'));

test('action: the refusal ladder, each refusal with its own error and no call to Home Assistant', NEEDS_WS, async () => {
  await withApp(async ({ call, key, login, ha, base }) => {
    const k = key('main');
    const act = (body, headers = {}) => call('POST', '/api/display/ha/action', { body: { seq: 7, slot: 0, ...body }, headers: { 'x-marco-key': k, ...headers } });
    const expect = async (r, status, error) => {
      const x = await r;
      assert.equal(x.status, status, `${error}: ${x.text}`);
      assert.equal(x.json?.error, error, x.text);
      assert.equal(x.json?.ok, false);
    };
    await until(async () => (await call('GET', '/api/display/ha', { headers: { 'x-marco-key': k } })).json.states['cv_ligh0001:0']?.c?.length, 4000, 'mirrored');
    const before = services(ha).length;
    // 0. JSON only, same origin only
    const plain = await realFetch(`${base}/api/display/ha/action`, { method: 'POST', headers: { 'x-marco-key': k, 'content-type': 'text/plain' }, body: JSON.stringify({ item: 'cv_ligh0001', slot: 0, control: 'toggle', seq: 1 }) });
    assert.equal(plain.status, 415);
    assert.equal((await plain.json()).error, 'json_required');
    await expect(act({ item: 'cv_ligh0001', control: 'toggle' }, { origin: 'http://evil.example' }), 403, 'cross_origin');
    await expect(act({ item: 'cv_ligh0001', control: 'toggle' }, { 'sec-fetch-site': 'cross-site' }), 403, 'cross_origin');
    await expect(act({ item: 'cv_ligh0001', control: 'toggle' }, { origin: 'null' }), 403, 'cross_origin');
    await expect(act({ item: 'cv_ligh0001' }), 400, 'bad_request');
    // a body over 2 KB never gets that far
    const big = await act({ item: 'cv_ligh0001', control: 'toggle', pad: 'x'.repeat(3000) });
    assert.equal(big.status, 413);
    // 1. the item, on this screen, with that slot and controls
    await expect(act({ item: 'cv_hall0001', control: 'toggle' }), 404, 'not_found');
    await expect(act({ item: 'cv_ligh0001', slot: 1, control: 'toggle' }), 404, 'not_found');
    await expect(act({ item: 'cv_sens0001', control: 'toggle' }), 404, 'not_found');
    await expect(act({ item: 'cv_nope0001', control: 'toggle' }), 404, 'not_found');
    // 2. an admin session is not a display credential
    const cookie = await login();
    const slug = store.getConfig().screens[0].slug;
    await expect(call('POST', `/api/display/ha/action?screen=${slug}`, { body: { item: 'cv_ligh0001', slot: 0, control: 'toggle', seq: 1 }, headers: { cookie } }), 403, 'untrusted');
    // 4. touch: the other screen does not allow it; an item and a room row that may not be touched
    const hall = await call('POST', '/api/display/ha/action', { body: { item: 'cv_hall0001', slot: 0, control: 'toggle', seq: 1 }, headers: { 'x-marco-key': key('hall') } });
    assert.equal(hall.status, 403);
    assert.equal(hall.json.error, 'touch_off');
    await expect(act({ item: 'cv_noto0001', control: 'toggle' }), 403, 'not_allowed');
    await expect(act({ item: 'cv_room0001', control: 'toggle' }), 403, 'not_allowed');
    // 5. not in the allowlist for this card and entity: a garage door, a control of another kind, an unknown control,
    // a door-like switch the owner never ticked
    await expect(act({ item: 'cv_gara0001', control: 'open' }), 403, 'not_allowed');
    await expect(act({ item: 'cv_ligh0001', control: 'fanPct', value: 30 }), 403, 'not_allowed');
    await expect(act({ item: 'cv_ligh0001', control: 'unlock' }), 403, 'not_allowed');
    await expect(act({ item: 'cv_door0002', control: 'toggle', confirm: true }), 403, 'not_allowed');
    // 6. values
    await expect(act({ item: 'cv_clim0001', control: 'hvacMode', value: 'turbo' }), 400, 'out_of_range');
    await expect(act({ item: 'cv_ligh0001', control: 'brightness', value: 'max' }), 400, 'out_of_range');
    await expect(act({ item: 'cv_ligh0001', control: 'toggle', value: 3 }), 400, 'out_of_range');
    // 7. two taps for a door-like entity, even ticked
    await expect(act({ item: 'cv_door0001', control: 'toggle' }), 409, 'confirm_needed');
    assert.equal(services(ha).length, before, 'no refused action reached Home Assistant');
    // 3. a private screen
    const p = await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: [store.getConfig().screens[0].id] }, headers: { cookie } });
    assert.equal(p.status, 200, p.text);
    await expect(act({ item: 'cv_ligh0001', control: 'toggle' }), 403, 'private');
    assert.equal(services(ha).length, before);
  }, { mutate: touchScreen });
});

test('action: open access (no credential) may not drive the house', NEEDS_WS, async () => {
  await withApp(async ({ call, ha }) => {
    const slug = store.getConfig().screens[0].slug;
    const r = await call('POST', `/api/display/ha/action?screen=${slug}`, { body: { item: 'cv_ligh0001', slot: 0, control: 'toggle', seq: 1 } });
    assert.equal(r.status, 403, r.text);
    assert.equal(r.json.error, 'untrusted');
    assert.equal(services(ha).length, 0);
  }, { mutate: (c) => { c.security.displayAccess = 'open'; touchScreen(c); } });
});

test('action: allowed controls become clamped service calls; two taps; the rate limit; Home Assistant failing', NEEDS_WS, async () => {
  await withApp(async ({ call, key, ha }) => {
    const k = key('main');
    let seq = 0;
    const act = (body) => call('POST', '/api/display/ha/action', { body: { slot: 0, seq: ++seq, ...body }, headers: { 'x-marco-key': k } });
    const last = () => services(ha).at(-1);
    await until(async () => (await act({ item: 'cv_ligh0001', control: 'toggle' })).status === 200, 4000, 'first action');
    assert.equal(last().url, '/api/services/light/toggle');
    assert.deepEqual(JSON.parse(last().body), { entity_id: 'light.desk' });
    assert.equal(last().auth, `Bearer ${FAKE_HA_TOKEN}`);
    const ok = await act({ item: 'cv_ligh0001', control: 'brightness', value: 140 });
    assert.deepEqual(ok.json, { ok: true, seq });
    assert.deepEqual([last().url, JSON.parse(last().body)], ['/api/services/light/turn_on', { entity_id: 'light.desk', brightness_pct: 100 }]);
    _resetHaRoutes(); // a new second for the rate limit
    assert.equal((await act({ item: 'cv_ligh0001', control: 'colorTemp', value: 9000 })).status, 200);
    assert.deepEqual(JSON.parse(last().body), { entity_id: 'light.desk', color_temp_kelvin: 6500 });
    assert.equal((await act({ item: 'cv_clim0001', control: 'setpoint', value: 21.3 })).status, 200);
    assert.deepEqual([last().url, JSON.parse(last().body)], ['/api/services/climate/set_temperature', { entity_id: 'climate.living', temperature: 21.5 }]);
    assert.equal((await act({ item: 'cv_blnd0001', control: 'close' })).status, 200);
    assert.equal(last().url, '/api/services/cover/close_cover');
    _resetHaRoutes(); // a new second for the rate limit
    // a door-like switch the owner ticked: the second tap goes through, and the log says it looked like a door
    assert.equal((await act({ item: 'cv_door0001', control: 'toggle', confirm: true })).status, 200);
    assert.equal(last().url, '/api/services/switch/toggle');
    // 7. five a second per credential
    _resetHaRoutes(); // a new second for the rate limit
    const burst = [];
    for (let i = 0; i < 6; i++) burst.push(await act({ item: 'cv_ligh0001', control: 'toggle' }));
    assert.deepEqual(burst.map((r) => r.status), [200, 200, 200, 200, 200, 429]);
    assert.equal(burst[5].json.error, 'rate');
    // 8. Home Assistant says no
    _resetHaRoutes(); // a new second for the rate limit
    ha.state.restDown = true;
    const down = await act({ item: 'cv_ligh0001', control: 'toggle' });
    ha.state.restDown = false;
    assert.equal(down.status, 502);
    assert.equal(down.json.error, 'ha_error');
    // the display's state says which controls each card offers, and which need two taps
    const snap = (await call('GET', '/api/display/ha', { headers: { 'x-marco-key': k } })).json.states;
    assert.deepEqual(snap['cv_ligh0001:0'].c, ['toggle', 'on', 'off', 'brightness', 'colorTemp']);
    assert.deepEqual(snap['cv_gara0001:0'].c, [], 'a garage door is only shown');
    assert.deepEqual(snap['cv_blnd0001:0'].c, ['open', 'close', 'stop', 'position']);
    assert.equal(snap['cv_door0001:0'].cf, true);
    assert.deepEqual(snap['cv_door0002:0'].c, [], 'not ticked: nothing to press');
    assert.deepEqual(snap['cv_noto0001:0'].c, []);
  }, { mutate: touchScreen });
});

test('action: the activity log names the screen and flags door-like entities, never the token', NEEDS_WS, async () => {
  await withApp(async ({ call, key, login, ha }) => {
    const k = key('main');
    await until(async () => (await call('POST', '/api/display/ha/action', { body: { item: 'cv_door0001', slot: 0, control: 'toggle', seq: 1, confirm: true }, headers: { 'x-marco-key': k } })).status === 200, 4000, 'action');
    const cookie = await login();
    const a = await call('GET', '/api/admin/activity?type=ha', { headers: { cookie } });
    assert.equal(a.status, 200, a.text);
    const e = a.json.items.find((x) => x.type === 'ha.action');
    assert.ok(e, a.text);
    assert.equal(e.data.entity, 'switch.garage_door');
    assert.equal(e.data.service, 'toggle');
    assert.equal(e.data.via, 'display');
    assert.equal(e.data.flagged, true);
    assert.equal(services(ha).length, 1);
  }, { mutate: touchScreen });
});

test('Probar (admin): the same allowlist and clamping, for items not saved yet; a display key cannot use it', NEEDS_WS, async () => {
  await withApp(async ({ call, login, key, ha }) => {
    const cookie = await login();
    const probe = (body) => call('POST', '/api/admin/homeassistant/action', { body, headers: { cookie } });
    await until(async () => (await probe({ entity: 'light.desk', kind: 'ha.light', control: 'toggle' })).status === 200, 4000, 'probe');
    assert.equal(services(ha).at(-1).url, '/api/services/light/toggle');
    const b = await probe({ entity: 'light.desk', kind: 'ha.light', control: 'brightness', value: 0 });
    assert.equal(b.status, 200, b.text);
    assert.deepEqual(JSON.parse(services(ha).at(-1).body), { entity_id: 'light.desk', brightness_pct: 1 });
    const n = services(ha).length;
    const refused = [
      [{ entity: 'cover.garage', kind: 'ha.cover', control: 'open' }, 403, 'not_allowed'],
      [{ entity: 'lock.front', kind: 'ha.tile', control: 'toggle' }, 403, 'not_allowed'],
      [{ entity: 'lock.front', kind: 'ha.cover', control: 'open' }, 400, 'bad_request'],
      [{ entity: 'light.desk', kind: 'ha.sensor', control: 'toggle' }, 400, 'bad_request'],
      [{ entity: 'light.desk', kind: 'ha.light', control: 'brightness', props: { brightness: false }, value: 20 }, 403, 'not_allowed'],
      [{ entity: 'climate.living', kind: 'ha.climate', control: 'hvacMode', value: 'turbo' }, 400, 'out_of_range'],
    ];
    for (const [body, status, error] of refused) {
      const r = await probe(body);
      assert.equal(r.status, status, `${JSON.stringify(body)} ${r.text}`);
      assert.equal(r.json.error, error);
    }
    assert.equal(services(ha).length, n);
    // refused taps are not rate limited, so the REST read of an entity the mirror does not hold is shared for a second
    const reads = () => ha.hits.filter((h) => h.url === '/api/states/climate.living').length;
    const r0 = reads();
    await Promise.all(Array.from({ length: 20 }, () => probe({ entity: 'climate.living', kind: 'ha.climate', control: 'hvacMode', value: 'turbo' })));
    assert.ok(reads() - r0 <= 1, `asked ${reads() - r0} times`);
    // without a session: refused (a display key is not an admin)
    const r = await call('POST', '/api/admin/homeassistant/action', { body: { entity: 'light.desk', kind: 'ha.light', control: 'toggle' }, headers: { 'x-marco-key': key('main') } });
    assert.equal(r.status, 401);
    assert.equal(services(ha).length, n);
  }, { mutate: touchScreen });
});

// ---- the Entidad card's rows, the new domains, Estadística and "Mostrar solo si" ------------------------------------

/** A touch screen of Entidad cards for the new domains, a Estadística and a card shown only while the front door is open. */
function featureScreen(c) {
  const main = c.screens[0];
  main.canvas.touch = true;
  main.canvas.items = [
    item('cv_valv0001', 'ha.tile', M(0, 0, 's'), { entity: 'valve.garden' }),
    item('cv_watr0001', 'ha.tile', M(6, 0, 's'), { entity: 'valve.main_water' }),
    { ...item('cv_watr0002', 'ha.tile', M(12, 0, 's'), { entity: 'valve.main_water' }), ack: true },
    item('cv_gasv0001', 'ha.tile', M(18, 0, 's'), { entity: 'valve.gas' }),
    item('cv_sele0001', 'ha.tile', M(0, 4, 's'), { entity: 'select.dishwasher' }),
    item('cv_numb0001', 'ha.tile', M(6, 4, 's'), { entity: 'number.timer' }),
    item('cv_numb0002', 'ha.tile', M(12, 4, 's'), { entity: 'input_number.boiler' }),
    item('cv_vacu0001', 'ha.tile', M(18, 4, 's'), { entity: 'vacuum.robot' }),
    item('cv_updt0001', 'ha.tile', M(0, 8, 's'), { entity: 'update.core' }),
    item('cv_ligh0002', 'ha.tile', M(6, 8, 's'), { entity: 'light.desk', features: ['toggle', 'colorTemp'] }),
    item('cv_gate0001', 'ha.tile', M(12, 8, 's'), { entity: 'cover.front_gate' }),
    item('cv_stat0001', 'ha.statistic', M(18, 8, 's'), { entity: 'sensor.energy', stat: 'change', period: 'today' }),
    item('cv_stat0002', 'ha.statistic', M(0, 12, 's'), { entity: 'sensor.energy', stat: 'max', period: 'week' }),
    item('cv_gaug0001', 'ha.gauge', M(6, 12, 's'), { entity: 'number.timer', min: 0, max: 120 }),
    { ...item('cv_cond0001', 'ha.tile', M(12, 12, 's'), { entity: 'switch.hall' }), when: { src: 'ha', entity: 'binary_sensor.front_door', op: 'eq', value: 'on' } },
    { ...item('cv_cond0002', 'heading', M(18, 12, 's'), { title: 'Puerta' }), when: { src: 'ha', entity: 'binary_sensor.front_door', op: 'ne', value: 'on' } },
  ];
}

test('Entidad rows: the rows each entity gets, the new services clamped, a water valve only once ticked, a gas valve never', NEEDS_WS, async () => {
  await withApp(async ({ call, key, ha }) => {
    const k = key('main');
    let seq = 0;
    const act = (body) => call('POST', '/api/display/ha/action', { body: { slot: 0, seq: ++seq, ...body }, headers: { 'x-marco-key': k } });
    const last = () => services(ha).at(-1);
    const snap = async () => (await call('GET', '/api/display/ha', { headers: { 'x-marco-key': k } })).json;
    const s = (await until(async () => {
      const x = await snap();
      return x.states['cv_valv0001:0']?.c?.length ? x : null;
    }, 4000, 'mirrored')).states;
    // the rows (f) and the controls (c) the server works out from the live attributes
    assert.deepEqual([s['cv_valv0001:0'].f, s['cv_valv0001:0'].c], [['valve', 'position'], ['open', 'close', 'stop', 'position']]);
    assert.deepEqual(s['cv_valv0001:0'], { d: 'valve', state: 'closed', pos: 0, dc: null, readOnly: false, n: 'Riego', at: s['cv_valv0001:0'].at, c: ['open', 'close', 'stop', 'position'], f: ['valve', 'position'] });
    assert.deepEqual(s['cv_watr0001:0'].c, [], 'the water valve is only shown until the owner ticks it');
    assert.deepEqual([s['cv_watr0002:0'].c, s['cv_watr0002:0'].cf], [['open', 'close'], true]);
    assert.deepEqual([s['cv_gasv0001:0'].c, s['cv_gasv0001:0'].d, s['cv_gasv0001:0'].readOnly], [[], 'valve', true], 'a gas valve: never');
    assert.deepEqual([s['cv_sele0001:0'].f, s['cv_sele0001:0'].c, s['cv_sele0001:0'].opts], [['select'], ['selectOption'], ['Eco', 'Normal', 'Intensive']]);
    assert.deepEqual([s['cv_numb0001:0'].f, s['cv_numb0001:0'].c, s['cv_numb0001:0'].min, s['cv_numb0001:0'].max, s['cv_numb0001:0'].step], [['number'], ['numberSet'], 0, 120, 5]);
    assert.equal(s['cv_numb0002:0'].box, true);
    assert.deepEqual([s['cv_vacu0001:0'].f, s['cv_vacu0001:0'].c, s['cv_vacu0001:0'].bat], [['vacuum'], ['pause', 'dock', 'start'], 92]);
    assert.deepEqual([s['cv_updt0001:0'].d, s['cv_updt0001:0'].on, s['cv_updt0001:0'].next, s['cv_updt0001:0'].f, s['cv_updt0001:0'].c], ['update', true, '2026.10.1', ['update'], []]);
    // the owner's own rows: a toggle and the colour temperature, and no brightness slider
    assert.deepEqual([s['cv_ligh0002:0'].f, s['cv_ligh0002:0'].c], [['colorTemp'], ['toggle', 'on', 'off', 'colorTemp']], 'a saved on/off row is dropped, the icon still switches it');
    // a cover that is a door: two taps and the owner's tick
    assert.deepEqual(s['cv_gate0001:0'].c, []);
    assert.equal(s['cv_gaug0001:0'].c.length, 0, 'an Indicador only shows');

    const expectCall = async (body, url, data) => {
      _resetHaRoutes(); // a new second for the rate limit
      const r = await act(body);
      assert.equal(r.status, 200, `${body.control}: ${r.text}`);
      assert.deepEqual([last().url, JSON.parse(last().body)], [url, data]);
    };
    await expectCall({ item: 'cv_valv0001', control: 'open' }, '/api/services/valve/open_valve', { entity_id: 'valve.garden' });
    await expectCall({ item: 'cv_valv0001', control: 'close' }, '/api/services/valve/close_valve', { entity_id: 'valve.garden' });
    await expectCall({ item: 'cv_valv0001', control: 'stop' }, '/api/services/valve/stop_valve', { entity_id: 'valve.garden' });
    await expectCall({ item: 'cv_valv0001', control: 'position', value: 140 }, '/api/services/valve/set_valve_position', { entity_id: 'valve.garden', position: 100 });
    await expectCall({ item: 'cv_sele0001', control: 'selectOption', value: 'Normal' }, '/api/services/select/select_option', { entity_id: 'select.dishwasher', option: 'Normal' });
    await expectCall({ item: 'cv_numb0001', control: 'numberSet', value: 47 }, '/api/services/number/set_value', { entity_id: 'number.timer', value: 45 });
    await expectCall({ item: 'cv_numb0001', control: 'numberSet', value: 500 }, '/api/services/number/set_value', { entity_id: 'number.timer', value: 120 });
    await expectCall({ item: 'cv_numb0002', control: 'numberSet', value: 22.3 }, '/api/services/input_number/set_value', { entity_id: 'input_number.boiler', value: 22.5 });
    await expectCall({ item: 'cv_vacu0001', control: 'start' }, '/api/services/vacuum/start', { entity_id: 'vacuum.robot' });
    await expectCall({ item: 'cv_vacu0001', control: 'pause' }, '/api/services/vacuum/pause', { entity_id: 'vacuum.robot' });
    await expectCall({ item: 'cv_vacu0001', control: 'dock' }, '/api/services/vacuum/return_to_base', { entity_id: 'vacuum.robot' });
    await expectCall({ item: 'cv_watr0002', control: 'close', confirm: true }, '/api/services/valve/close_valve', { entity_id: 'valve.main_water' });
    await expectCall({ item: 'cv_ligh0002', control: 'colorTemp', value: 1000 }, '/api/services/light/turn_on', { entity_id: 'light.desk', color_temp_kelvin: 2200 });

    // refused: nothing reaches Home Assistant
    const before = services(ha).length;
    const no = async (body, status, error) => {
      _resetHaRoutes();
      const r = await act(body);
      assert.equal(r.status, status, `${body.item} ${body.control}: ${r.text}`);
      assert.equal(r.json.error, error);
    };
    await no({ item: 'cv_sele0001', control: 'selectOption', value: 'Turbo' }, 400, 'out_of_range');
    await no({ item: 'cv_sele0001', control: 'selectOption', value: 3 }, 400, 'out_of_range');
    await no({ item: 'cv_numb0001', control: 'numberSet', value: '50' }, 400, 'out_of_range');
    await no({ item: 'cv_watr0001', control: 'close', confirm: true }, 403, 'not_allowed');
    await no({ item: 'cv_watr0002', control: 'close' }, 409, 'confirm_needed');
    await no({ item: 'cv_gasv0001', control: 'close', confirm: true }, 403, 'not_allowed');
    await no({ item: 'cv_gate0001', control: 'open', confirm: true }, 403, 'not_allowed');
    await no({ item: 'cv_updt0001', control: 'run' }, 403, 'not_allowed');
    await no({ item: 'cv_ligh0002', control: 'brightness', value: 50 }, 403, 'not_allowed');
    await no({ item: 'cv_vacu0001', control: 'toggle' }, 403, 'not_allowed');
    await no({ item: 'cv_gaug0001', control: 'numberSet', value: 10 }, 404, 'not_found');
    assert.equal(services(ha).length, before);
    // only the watched set: never the whole list of states, over REST or the WebSocket
    assert.equal(ha.hits.some((h) => h.method === 'GET' && h.url.split('?')[0] === '/api/states'), false);
    assert.equal(ha.wsLog.some((m) => m.type === 'get_states'), false);
  }, { mutate: featureScreen });
});

test('Estadística: one value from the recorder over the mirror connection, cached and shared; failures kept; private', NEEDS_WS, async () => {
  await withApp(async ({ call, key, login, ha }) => {
    const k = key('main');
    const get = (id) => call('GET', `/api/display/ha/statistic/${id}`, { headers: { 'x-marco-key': k } });
    const asked = () => ha.wsLog.filter((m) => m.type === 'recorder/statistic_during_period');
    const r = await get('cv_stat0001');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { stat: 'change', period: 'today', value: 7.42, unit: 'kWh' });
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.deepEqual(asked().map((m) => ({ id: m.statistic_id, calendar: m.calendar, types: m.types })), [{ id: 'sensor.energy', calendar: { period: 'day' }, types: ['change'] }]);
    // over the mirror's own connection: no second WebSocket opened for it
    assert.equal(ha.hits.filter((h) => h.method === 'WS').length, 1);
    // cached: many screens asking get the same answer and Home Assistant is asked once
    await Promise.all([get('cv_stat0001'), get('cv_stat0001'), get('cv_stat0001')]);
    assert.equal(asked().length, 1);
    const w = await get('cv_stat0002');
    assert.deepEqual(w.json, { stat: 'max', period: 'week', value: 1.2, unit: 'kWh' });
    assert.deepEqual(asked().at(-1).calendar, { period: 'week' });
    // not a Estadística card, or not on this screen
    assert.equal((await get('cv_gaug0001')).status, 404);
    assert.equal((await get('cv_nope0001')).status, 404);
    // the builder's preview: the same cache, a sensor only
    const cookie = await login();
    const pv = await call('GET', '/api/admin/homeassistant/statistic?entity=sensor.energy&stat=change&period=today', { headers: { cookie } });
    assert.deepEqual(pv.json, { stat: 'change', period: 'today', value: 7.42, unit: 'kWh' });
    assert.equal(asked().length, 2);
    assert.equal((await call('GET', '/api/admin/homeassistant/statistic?entity=light.desk', { headers: { cookie } })).status, 400);
    assert.equal((await call('GET', '/api/admin/homeassistant/statistic?entity=sensor.energy', { headers: { 'x-marco-key': k } })).status, 401);
    // Home Assistant before 2023.2: an error, kept for a moment (no request per screen)
    _resetHaRoutes();
    ha.state.noStatistic = true;
    const n = asked().length;
    assert.equal((await get('cv_stat0001')).status, 502);
    assert.equal((await get('cv_stat0001')).status, 502);
    assert.equal(asked().length, n + 1);
    ha.state.noStatistic = false;
    // a private screen: nothing
    const p = await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: [store.getConfig().screens[0].id] }, headers: { cookie } });
    assert.equal(p.status, 200);
    assert.equal((await get('cv_stat0001')).status, 403);
  }, { mutate: featureScreen });
});

test('Mostrar solo si: the server hides the item (no states, no actions), tells the screen which ids, and shows it when the door opens', NEEDS_WS, async () => {
  await withApp(async ({ call, key, stream, ha }) => {
    const k = key('main');
    const snap = async () => (await call('GET', '/api/display/ha', { headers: { 'x-marco-key': k } })).json;
    const s0 = await until(async () => {
      const x = await snap();
      return x.states['cv_valv0001:0'] ? x : null;
    }, 4000, 'mirrored');
    // the front door is closed: the tile waits, the heading shows
    assert.deepEqual(s0.hide, ['cv_cond0001']);
    assert.equal('cv_cond0001:0' in s0.states, false, 'a hidden item gets no state');
    // the condition's entity is mirrored (the watched set) but never reaches a display: only { src }
    assert.ok(ha.connections().some((x) => x.subs.some((ids) => ids?.includes('binary_sensor.front_door'))));
    const cfg = await call('GET', '/api/display/config', { headers: { 'x-marco-key': k } });
    const items = cfg.json.canvas.items;
    assert.deepEqual(items.find((x) => x.id === 'cv_cond0001').when, { src: 'ha' });
    assert.deepEqual(items.find((x) => x.id === 'cv_cond0002').when, { src: 'ha' });
    assert.equal(cfg.text.includes('front_door'), false);
    // no action on a hidden card
    const r = await call('POST', '/api/display/ha/action', { body: { item: 'cv_cond0001', slot: 0, control: 'toggle', seq: 1 }, headers: { 'x-marco-key': k } });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'not_found');
    // the door opens: the screen hears it at once, with the tile's state
    const st = await stream('main');
    try {
      await until(() => st.events.find((e) => e.event === 'ha'), 4000, 'hello');
      ha.set('binary_sensor.front_door', 'on');
      const ev = await until(() => st.events.find((e) => e.event === 'ha' && Array.isArray(e.data.hide) && e.data.hide.includes('cv_cond0002')), 4000, 'condition event');
      assert.deepEqual(ev.data.hide, ['cv_cond0002']);
      assert.equal(ev.data.full, true);
      assert.ok(ev.data.states['cv_cond0001:0'], 'the tile comes with its state');
    } finally {
      st.close();
    }
    const s1 = await snap();
    assert.deepEqual(s1.hide, ['cv_cond0002']);
    _resetHaRoutes();
    const ok = await call('POST', '/api/display/ha/action', { body: { item: 'cv_cond0001', slot: 0, control: 'toggle', seq: 2 }, headers: { 'x-marco-key': k } });
    assert.equal(ok.status, 200, ok.text);
    // a screen without conditions gets no hide list at all
    assert.equal('hide' in (await call('GET', '/api/display/ha', { headers: { 'x-marco-key': key('hall') } })).json, false);
  }, { mutate: featureScreen });
});
