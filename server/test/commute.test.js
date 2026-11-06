// Commute time widget ('commute'): core helpers (route leg resolution, auto-reverse, traffic levels, Google Directions
// and Routes v2 parsers), config validation, display widget projection, caching, and HTTP routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  CommuteError,
  commuteKeyStatus,
  delayMinutes,
  formatDistance,
  formatDurationParts,
  googleRoutesTravelMode,
  parseGoogleDirections,
  parseGoogleRoutesV2,
  resolveRouteLeg,
  trafficLevel,
} from '../core/commuteCore.js';
import { COMMUTE_CACHE_MAX, commuteCacheSize, setCommuteFetch, testCommute } from '../commute.js';
import { _resetPrivacy, applyPrivacy } from '../privacy.js';
import { validateConfig } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { displayWidgets } from '../core/screens.js';
import * as store from '../store.js';
import { ensurePassword, hashPassword, sessionMiddleware, startSession } from '../auth.js';
import { adminRouter } from '../routes/admin.js';
import { publicRouter } from '../routes/public.js';

test('resolveRouteLeg: direction to, from, auto-reverse after reverseAfter, and weekday/time schedule', () => {
  const route = {
    id: 'cr_1',
    name: 'Work',
    origin: 'Home',
    destination: 'Office',
    mode: 'driving',
    direction: 'auto',
    reverseAfter: '12:30',
    days: [1, 2, 3, 4, 5],
    from: '06:00',
    to: '20:00',
  };
  // Monday 2026-10-12 08:15 UTC
  const morning = Date.parse('2026-10-12T08:15:00Z');
  const legMorning = resolveRouteLeg(route, morning, 'UTC');
  assert.equal(legMorning.origin, 'Home');
  assert.equal(legMorning.destination, 'Office');
  assert.equal(legMorning.reversed, false);
  assert.equal(legMorning.active, true);

  // Monday 2026-10-12 17:45 UTC (after 12:30 -> reversed)
  const afternoon = Date.parse('2026-10-12T17:45:00Z');
  const legAfternoon = resolveRouteLeg(route, afternoon, 'UTC');
  assert.equal(legAfternoon.origin, 'Office');
  assert.equal(legAfternoon.destination, 'Home');
  assert.equal(legAfternoon.reversed, true);
  assert.equal(legAfternoon.active, true);

  // Sunday 2026-10-11 09:00 UTC (not in Mon-Fri -> inactive)
  const sunday = Date.parse('2026-10-11T09:00:00Z');
  assert.equal(resolveRouteLeg(route, sunday, 'UTC').active, false);

  // Monday 2026-10-12 22:00 UTC (outside 06:00-20:00 -> inactive)
  const night = Date.parse('2026-10-12T22:00:00Z');
  assert.equal(resolveRouteLeg(route, night, 'UTC').active, false);

  // Fixed 'from' always reverses
  assert.equal(resolveRouteLeg({ ...route, direction: 'from' }, morning, 'UTC').reversed, true);
  // Fixed 'to' never reverses
  assert.equal(resolveRouteLeg({ ...route, direction: 'to' }, afternoon, 'UTC').reversed, false);
});

test('trafficLevel, delayMinutes, formatDurationParts, formatDistance, googleRoutesTravelMode', () => {
  assert.equal(trafficLevel(1200, 1200, 'driving'), 'clear');
  assert.equal(trafficLevel(1400, 1200, 'driving'), 'moderate');
  assert.equal(trafficLevel(1800, 1200, 'driving'), 'heavy');
  assert.equal(trafficLevel(1800, 1200, 'transit'), 'clear');

  assert.equal(delayMinutes(1200, 1200), 0);
  assert.equal(delayMinutes(1500, 1200), 5);
  assert.equal(delayMinutes(1100, 1200), 0);

  assert.deepEqual(formatDurationParts(1440), { hours: 0, minutes: 24, text: '24 min' });
  assert.deepEqual(formatDurationParts(4500), { hours: 1, minutes: 15, text: '1 h 15 min' });

  assert.equal(formatDistance(640, 'metric', 'en-GB'), '650 m');
  assert.equal(formatDistance(18400, 'metric', 'en-GB'), '18 km');
  assert.equal(formatDistance(16100, 'imperial', 'en-GB'), '10 mi');

  assert.equal(googleRoutesTravelMode('driving'), 'DRIVE');
  assert.equal(googleRoutesTravelMode('transit'), 'TRANSIT');
  assert.equal(googleRoutesTravelMode('bicycling'), 'BICYCLE');
  assert.equal(googleRoutesTravelMode('walking'), 'WALK');
  assert.deepEqual(commuteKeyStatus('AIzaSy0123456789abcdef'), { set: true, hint: 'cdef' });
  assert.deepEqual(commuteKeyStatus(''), { set: false, hint: '' });
});

test('parseGoogleDirections and parseGoogleRoutesV2', () => {
  const dirOk = JSON.stringify({
    status: 'OK',
    routes: [
      {
        summary: 'I-280 N',
        legs: [
          {
            distance: { value: 24500 },
            duration: { value: 1200 },
            duration_in_traffic: { value: 1620 },
          },
        ],
      },
    ],
  });
  assert.deepEqual(parseGoogleDirections(dirOk), {
    durationSec: 1620,
    normalDurationSec: 1200,
    distanceMeters: 24500,
    summary: 'I-280 N',
  });

  assert.throws(() => parseGoogleDirections(JSON.stringify({ status: 'ZERO_RESULTS' })), (e) => e instanceof CommuteError && e.code === 'no_route');
  assert.throws(() => parseGoogleDirections(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'bad key' })), (e) => e instanceof CommuteError && e.code === 'http_denied');
  assert.throws(() => parseGoogleDirections(JSON.stringify({ status: 'OVER_QUERY_LIMIT' })), (e) => e instanceof CommuteError && e.code === 'rate_limited');

  const v2Ok = JSON.stringify({
    routes: [
      {
        duration: '1500s',
        staticDuration: '1260s',
        distanceMeters: 19200,
        description: 'US-101 N',
      },
    ],
  });
  assert.deepEqual(parseGoogleRoutesV2(v2Ok), {
    durationSec: 1500,
    normalDurationSec: 1260,
    distanceMeters: 19200,
    summary: 'US-101 N',
  });
  assert.throws(
    () => parseGoogleRoutesV2(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } })),
    (e) => e instanceof CommuteError && e.code === 'key_invalid',
  );
  assert.throws(
    () => parseGoogleRoutesV2(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Routes API has not been used in project 1 before or it is disabled.' } })),
    (e) => e instanceof CommuteError && e.code === 'http_denied',
  );
  assert.throws(
    () => parseGoogleDirections(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.' })),
    (e) => e instanceof CommuteError && e.code === 'key_invalid',
  );
  // Google's own error text is never kept: the message is the code, whatever Google echoes back
  const leaky = JSON.stringify({ status: 'INVALID_REQUEST', error_message: 'bad request for key=AIzaSySecretSecret123' });
  assert.throws(() => parseGoogleDirections(leaky), (e) => e.message === 'not_found' && !String(e.stack).includes('AIzaSy'));
  const leakyV2 = JSON.stringify({ error: { status: 'INTERNAL', message: 'oops key AIzaSySecretSecret123' } });
  assert.throws(() => parseGoogleRoutesV2(leakyV2), (e) => e.message === 'http_error');
});

test('validateConfig and displayWidgets for commute widget', () => {
  const c = defaultConfig();
  c.widgets = [
    {
      id: 'w_comm',
      type: 'commute',
      name: 'Morning Commute',
      options: {
        commute: {
          units: 'metric',
          refreshMin: 10,
          showRouteSummary: true,
          showArrival: true,
          routes: [
            {
              id: 'cr_1',
              name: 'Office',
              origin: 'Madrid',
              destination: 'Alcendas',
              mode: 'driving',
              direction: 'auto',
              reverseAfter: '13:00',
              days: [1, 2, 3, 4, 5],
              from: '',
              to: '',
            },
          ],
        },
      },
    },
  ];
  c.screens[0].widgets = [{ widgetId: 'w_comm', position: 'side', size: 'm' }];
  const v = validateConfig(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));

  const dw = displayWidgets(v.value, v.value.screens[0]);
  assert.equal(dw.length, 1);
  assert.equal(dw[0].type, 'commute');
  assert.equal(dw[0].commute.routes.length, 1);
  assert.equal(dw[0].commute.routes[0].name, 'Office');
  // what the card draws, never the addresses or the schedule
  assert.deepEqual(dw[0].commute, {
    units: 'metric', refreshMin: 10, showRouteSummary: true, showArrival: true, routes: [{ id: 'cr_1', name: 'Office', mode: 'driving' }],
  });
  const sent = JSON.stringify(dw);
  for (const word of ['Madrid', 'Alcendas', 'origin', 'destination', 'reverseAfter', 'days']) assert.ok(!sent.includes(word), word);
  assert.match(dw[0].v, /^[0-9a-f]{8}$/);

  // an unnamed route stays unnamed (the display shows "Route 1"), and 5 minutes becomes the 10-minute floor
  const c3 = structuredClone(c);
  c3.widgets[0].options.commute.routes[0].name = '';
  c3.widgets[0].options.commute.refreshMin = 5;
  const v3 = validateConfig(c3);
  assert.equal(v3.ok, true, JSON.stringify(v3.errors));
  assert.equal(v3.value.widgets[0].options.commute.routes[0].name, '');
  assert.equal(v3.value.widgets[0].options.commute.refreshMin, 10);

  // Marco Cloud's validator options (CLOUD_VALIDATE_OPTS widgetTypes) leave 'commute' out: the widget is refused
  const cloud = validateConfig(c, { widgetTypes: ['image', 'prices', 'currency', 'value'], widgetProtocols: ['https:'], immichAvailable: false });
  assert.equal(cloud.ok, false);
  assert.ok(cloud.errors.some((e) => e.path === 'widgets[0].type' && e.message === 'not available on this server'));

  // Changing route destination changes version hash
  const c2 = structuredClone(v.value);
  c2.widgets[0].options.commute.routes[0].destination = 'Getafe';
  assert.notEqual(displayWidgets(c2, c2.screens[0])[0].v, dw[0].v);

  // Empty routes fails validation
  const cBad = structuredClone(v.value);
  cBad.widgets[0].options.commute.routes = [];
  const vBad = validateConfig(cBad);
  assert.equal(vBad.ok, false);
  assert.ok(vBad.errors.some((e) => e.path === 'widgets[0].options.commute.routes'));
});

const route = (over = {}) => ({
  id: 'cr_1', name: 'Trabajo', origin: 'Puerta del Sol, Madrid', destination: 'Chamartín, Madrid', mode: 'driving',
  direction: 'to', reverseAfter: '12:00', days: [], from: '', to: '', ...over,
});
const commuteWidget = (id, routes, refreshMin = 10) => ({
  id, type: 'commute', name: 'Trayectos',
  options: { commute: { units: 'metric', refreshMin, showRouteSummary: true, showArrival: true, routes } },
});
const GOOGLE_OK = JSON.stringify({
  status: 'OK',
  routes: [{ summary: 'Paseo de la Castellana', legs: [{ distance: { value: 8200 }, duration: { value: 900 }, duration_in_traffic: { value: 1260 } }] }],
});
const KEY = 'AIzaSyTestKey1234567890';

/** A server with the commute widgets `widgets` (the first placed on the first screen), a fake Google and a clock. */
async function commuteServer(widgets, { key = KEY, google = () => GOOGLE_OK } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-commute-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.widgets = widgets;
  c.screens[0].widgets = [{ widgetId: widgets[0].id, place: 'side', corner: 'br', size: 'm' }];
  const v = validateConfig(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(v.value));
  fs.writeFileSync(
    path.join(dir, 'secrets.json'),
    JSON.stringify({ passwordHash: await hashPassword('secret123'), passwordIsDefault: false, ...(key ? { commute: { apiKey: key } } : {}) }),
  );
  _resetPrivacy();
  store.initStore(dir);
  await ensurePassword();

  const clock = { now: Date.parse('2026-10-12T08:30:00Z') };
  const calls = [];
  setCommuteFetch(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return { status: 200, text: async () => google(String(url), init) };
  }, () => clock.now);

  const app = express();
  app.use(sessionMiddleware());
  app.use((req, _res, next) => {
    if (req.headers['x-test-authed'] === '1') startSession(req, { method: 'password', email: null });
    next();
  });
  app.use('/api/admin', adminRouter());
  app.use('/api', publicRouter({ version: 'test' }));
  const errors = [];
  app.use((err, _req, res, _next) => {
    errors.push(err);
    res.status(500).json({ error: 'internal' });
  });

  const call = (method, url, body, authed = false) =>
    new Promise((resolve, reject) => {
      const u = new URL(url, 'http://127.0.0.1');
      const req = Object.assign(new EventEmitter(), {
        method,
        url: u.pathname + u.search,
        originalUrl: u.pathname + u.search,
        path: u.pathname,
        query: Object.fromEntries(u.searchParams.entries()),
        headers: { host: '127.0.0.1', 'content-type': 'application/json', ...(authed ? { 'x-test-authed': '1' } : {}) },
        body: body ?? {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        connection: { remoteAddress: '127.0.0.1' },
        get(h) {
          return this.headers[String(h).toLowerCase()];
        },
      });
      const headers = new Map();
      const res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        setHeader(k, v) { headers.set(String(k).toLowerCase(), v); },
        getHeader(k) { return headers.get(String(k).toLowerCase()); },
        removeHeader(k) { headers.delete(String(k).toLowerCase()); },
        set(k, v) { this.setHeader(k, v); return this; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { resolve({ status: this.statusCode, json: payload }); return this; },
        end(chunk) { resolve({ status: this.statusCode, json: chunk ? JSON.parse(String(chunk)) : null }); return this; },
      });
      app.handle(req, res, reject);
    });
  return { call, calls, clock, errors, dir };
}

test('GET /api/display/commute: a saved widget the screen shows, no addresses in the answer', async () => {
  const { call, calls } = await commuteServer([commuteWidget('w_comm', [route()])]);
  try {
    const v = displayWidgets(store.getConfig(), store.getConfig().screens[0])[0].v;
    const d = await call('GET', `/api/display/commute?id=w_comm&v=${v}`);
    assert.equal(d.status, 200);
    assert.equal(d.json.keySet, true);
    assert.equal(d.json.routes.length, 1);
    const r = d.json.routes[0];
    assert.equal(r.ok, true);
    assert.equal(r.name, 'Trabajo');
    assert.equal(r.durationSec, 1260);
    assert.equal(r.normalDurationSec, 900);
    assert.equal(r.traffic, 'heavy');
    assert.equal(r.summary, 'Paseo de la Castellana');
    assert.equal(r.reversed, false);
    const body = JSON.stringify(d.json);
    for (const word of ['Puerta del Sol', 'Chamartín', 'origin', 'destination', KEY]) assert.ok(!body.includes(word), word);
    assert.equal(calls.length, 1);
    // a second screen asking within the refresh is answered from memory
    assert.equal((await call('GET', '/api/display/commute?id=w_comm')).status, 200);
    assert.equal(calls.length, 1);
    // a changed widget (the admin preview of unsaved settings) gets 409, without asking Google
    assert.deepEqual(await call('GET', '/api/display/commute?id=w_comm&v=00000000'), { status: 409, json: { error: 'unsaved' } });
    assert.equal((await call('GET', '/api/display/commute?id=nonexistent')).status, 404);
    assert.equal(calls.length, 1);
  } finally {
    setCommuteFetch(null);
  }
});

test('GET /api/display/commute: no road or line names when the summary is turned off', async () => {
  const w = commuteWidget('w_comm', [route()]);
  w.options.commute.showRouteSummary = false;
  const { call, calls } = await commuteServer([w]);
  try {
    const d = await call('GET', '/api/display/commute?id=w_comm');
    assert.equal(d.status, 200);
    assert.equal(d.json.routes[0].ok, true);
    assert.equal(d.json.routes[0].summary, '');
    assert.ok(!JSON.stringify(d.json).includes('Castellana'));
    assert.ok(calls.length <= 1);
  } finally {
    setCommuteFetch(null);
  }
});

test('GET /api/display/commute: routes from the request are never used (no Google request)', async () => {
  const { call, calls } = await commuteServer([commuteWidget('w_comm', [route()])]);
  try {
    const evil = encodeURIComponent(JSON.stringify([{ id: 'cr_x', origin: 'Paris, France', destination: 'Berlin, Germany', mode: 'driving' }]));
    // the old mode (routes in the query, no id) is gone
    const r = await call('GET', `/api/display/commute?routes=${evil}&refreshMin=5`);
    assert.equal(r.status, 404);
    assert.equal(calls.length, 0, 'no outbound call for routes from the query');
    // with a valid id the saved routes are used, not the query's
    const ok = await call('GET', `/api/display/commute?id=w_comm&routes=${evil}`);
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].url.includes('Paris') && !calls[0].url.includes('Berlin'));
    assert.ok(calls[0].url.includes('Puerta+del+Sol') || calls[0].url.includes('Puerta%20del%20Sol'));
  } finally {
    setCommuteFetch(null);
  }
});

test('GET /api/display/commute: a widget the requesting screen does not show, or a private screen, gets nothing', async () => {
  const { call, calls } = await commuteServer([
    commuteWidget('w_comm', [route()]),
    commuteWidget('w_other', [route({ id: 'cr_2', origin: 'Valencia', destination: 'Sevilla' })]),
  ]);
  try {
    // saved, but placed on no screen
    assert.deepEqual(await call('GET', '/api/display/commute?id=w_other'), { status: 404, json: { error: 'not_found' } });
    // a second screen that does not show w_comm
    await store.updateConfig((c) => {
      const second = structuredClone(c.screens[0]);
      Object.assign(second, { id: 's_second', slug: 'segunda', name: 'Segunda', widgets: [] });
      c.screens.push(second);
    });
    assert.equal(store.getConfig().screens.length, 2);
    assert.equal((await call('GET', '/api/display/commute?id=w_comm&screen=segunda')).status, 404);
    // the 'widget' layout (full screen) of that screen shows it: then it answers
    await store.updateConfig((c) => {
      const s = c.screens.find((x) => x.id === 's_second');
      s.layout = { ...s.layout, preset: 'widget', widgetId: 'w_other' };
    });
    assert.equal((await call('GET', '/api/display/commute?id=w_other&screen=segunda')).status, 200);
    const before = calls.length;
    // private screen: nothing, and no request to Google
    applyPrivacy({ mode: 'on', screenIds: [store.getConfig().screens[0].id] });
    assert.equal((await call('GET', '/api/display/commute?id=w_comm')).status, 404);
    assert.equal(calls.length, before);
  } finally {
    _resetPrivacy();
    setCommuteFetch(null);
  }
});

test('GET /api/display/commute: the saved refresh only (refreshMin in the query is ignored), 10 minutes at the least', async () => {
  const { call, calls, clock } = await commuteServer([commuteWidget('w_comm', [route()], 15)]);
  try {
    assert.equal((await call('GET', '/api/display/commute?id=w_comm&refreshMin=5')).status, 200);
    assert.equal(calls.length, 1);
    clock.now += 6 * 60_000;
    await call('GET', '/api/display/commute?id=w_comm&refreshMin=5');
    clock.now += 6 * 60_000; // 12 min: still within the saved 15
    await call('GET', '/api/display/commute?id=w_comm&refreshMin=5');
    assert.equal(calls.length, 1, 'refreshMin from the query is ignored');
    clock.now += 4 * 60_000; // 16 min
    await call('GET', '/api/display/commute?id=w_comm');
    assert.equal(calls.length, 2);
  } finally {
    setCommuteFetch(null);
  }
});

test('commute: a route outside its schedule is not asked; failures back off; no key, no request', async () => {
  // Monday 08:30 UTC: the first route runs on Sundays only, the second from 17:00 to 19:00
  let answer = GOOGLE_OK;
  const { call, calls, clock } = await commuteServer([
    commuteWidget('w_comm', [route({ days: [0] }), route({ id: 'cr_2', origin: 'A', destination: 'B', from: '17:00', to: '19:00' }), route({ id: 'cr_3', name: '', origin: 'C', destination: 'D' })]),
  ], { google: () => answer });
  try {
    answer = JSON.stringify({ status: 'OVER_QUERY_LIMIT', error_message: `quota for ${KEY}` });
    const d = await call('GET', '/api/display/commute?id=w_comm');
    assert.equal(d.status, 200);
    assert.deepEqual(d.json.routes.map((r) => [r.id, r.active, r.ok]), [['cr_1', false, false], ['cr_2', false, false], ['cr_3', true, false]]);
    assert.equal(d.json.routes[2].error, 'rate_limited');
    assert.equal(d.json.routes[2].name, '', 'unnamed: the display labels it');
    assert.ok(!JSON.stringify(d.json).includes(KEY), 'the key is never echoed');
    assert.equal(calls.length, 1, 'only the active route is asked');
    // the failure is remembered: asking again soon makes no request
    clock.now += 60_000;
    await call('GET', '/api/display/commute?id=w_comm');
    assert.equal(calls.length, 1);
    // after the first wait (2 min) one more try, then a longer wait (5 min)
    clock.now += 61_000;
    await call('GET', '/api/display/commute?id=w_comm');
    assert.equal(calls.length, 2);
    clock.now += 3 * 60_000;
    await call('GET', '/api/display/commute?id=w_comm');
    assert.equal(calls.length, 2);
    answer = GOOGLE_OK;
    clock.now += 2 * 60_000 + 1000;
    const ok = await call('GET', '/api/display/commute?id=w_comm');
    assert.equal(calls.length, 3);
    assert.equal(ok.json.routes[2].ok, true);
  } finally {
    setCommuteFetch(null);
  }

  const noKey = await commuteServer([commuteWidget('w_comm', [route()])], { key: '' });
  const saved = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  try {
    const d = await noKey.call('GET', '/api/display/commute?id=w_comm');
    assert.deepEqual([d.status, d.json.keySet, d.json.routes.length], [200, false, 0]);
    assert.equal(noKey.calls.length, 0);
  } finally {
    if (saved !== undefined) process.env.GOOGLE_MAPS_API_KEY = saved;
    setCommuteFetch(null);
  }
});

test('commute cache: bounded (COMMUTE_CACHE_MAX legs; a leg not due yet is never pushed out, a new one is busy)', async () => {
  const { calls } = await commuteServer([commuteWidget('w_comm', [route()])]);
  try {
    for (let i = 0; i < COMMUTE_CACHE_MAX + 30; i++) await testCommute({ origin: `Street ${i}`, destination: 'Plaza', mode: 'driving' });
    assert.equal(calls.length, COMMUTE_CACHE_MAX);
    assert.ok(commuteCacheSize() <= COMMUTE_CACHE_MAX, String(commuteCacheSize()));
    assert.deepEqual(await testCommute({ origin: 'Street 9999', destination: 'Plaza', mode: 'driving' }), { ok: false, error: 'busy' });
  } finally {
    setCommuteFetch(null);
  }
});

test('admin: POST /test/commute, GET/PUT /commute/key (one Google request at the most, the key never echoed)', async () => {
  const { call, calls, errors } = await commuteServer([commuteWidget('w_comm', [route()])], {
    google: (url, init) => {
      const key = init.headers?.['x-goog-api-key'] || new URL(url).searchParams.get('key');
      if (key?.includes('Bad')) return JSON.stringify({ status: 'REQUEST_DENIED', error_message: `The provided API key is invalid. ${key}` });
      if (key?.includes('Off')) return JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'This API project is not authorized to use this API.' });
      return GOOGLE_OK;
    },
  });
  try {
    assert.equal((await call('POST', '/api/admin/test/commute', { origin: 'A', destination: 'B', mode: 'driving' }, false)).status, 401);
    const t = await call('POST', '/api/admin/test/commute', { origin: 'Sol', destination: 'Chamartín', mode: 'driving' }, true);
    assert.equal(t.status, 200);
    assert.equal(t.json.ok, true);
    assert.equal(t.json.durationSec, 1260);
    // the same route again within a minute: from memory
    await call('POST', '/api/admin/test/commute', { origin: 'Sol', destination: 'Chamartín', mode: 'driving' }, true);
    assert.equal(calls.length, 1);

    assert.deepEqual((await call('GET', '/api/admin/commute/key', null, true)).json, { set: true, hint: '7890' });

    calls.length = 0;
    const good = await call('PUT', '/api/admin/commute/key', { key: 'AIzaSyNewValidKey987654321' }, true);
    assert.deepEqual([good.status, good.json], [200, { set: true, hint: '4321', checked: true }]);
    assert.equal(calls.length, 1);

    calls.length = 0;
    const bad = await call('PUT', '/api/admin/commute/key', { key: 'AIzaSyBadBadBadBad12345678' }, true);
    assert.deepEqual([bad.status, bad.json], [400, { error: 'key_invalid' }]);
    assert.equal(calls.length, 1);

    // Directions not enabled for the key: still one request (no Routes fallback for the check), saved unchecked
    calls.length = 0;
    const off = await call('PUT', '/api/admin/commute/key', { key: 'AIzaSyOffOffOffOff12345678' }, true);
    assert.deepEqual([off.status, off.json], [200, { set: true, hint: '5678', checked: false }]);
    assert.equal(calls.length, 1);
    assert.equal(errors.length, 0);
  } finally {
    setCommuteFetch(null);
  }
});

test('admin: /commute/key reports the GOOGLE_MAPS_API_KEY in use after the saved key is removed', async () => {
  const saved = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'AIzaSyFromTheEnvironment0000';
  const { call, calls } = await commuteServer([commuteWidget('w_comm', [route()])]);
  try {
    assert.deepEqual((await call('GET', '/api/admin/commute/key', null, true)).json, { set: true, hint: '7890' });
    calls.length = 0;
    const cleared = await call('PUT', '/api/admin/commute/key', { key: '' }, true);
    assert.deepEqual([cleared.status, cleared.json], [200, { set: true, hint: '0000', fromEnv: true, checked: false }]);
    assert.equal(calls.length, 0);
    assert.deepEqual((await call('GET', '/api/admin/commute/key', null, true)).json, { set: true, hint: '0000', fromEnv: true });
    assert.ok(!JSON.stringify(cleared.json).includes('AIzaSyFromTheEnvironment'));
  } finally {
    if (saved === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = saved;
    setCommuteFetch(null);
  }
});

test('commute: Directions not enabled falls back to Routes v2 once, then asks Routes directly', async () => {
  const { call, calls, clock } = await commuteServer([commuteWidget('w_comm', [route()])], {
    google: (url) => (url.includes('maps.googleapis.com')
      ? JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'This API project is not authorized to use this API.' })
      : JSON.stringify({ routes: [{ duration: '1500s', staticDuration: '1260s', distanceMeters: 19200, description: 'M-30' }] })),
  });
  try {
    const d = await call('GET', '/api/display/commute?id=w_comm');
    assert.equal(d.json.routes[0].durationSec, 1500);
    assert.equal(calls.length, 2);
    clock.now += 11 * 60_000;
    await call('GET', '/api/display/commute?id=w_comm');
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 3);
    assert.ok(calls[2].url.startsWith('https://routes.googleapis.com/'));
  } finally {
    setCommuteFetch(null);
  }
});

test('commute files: no em dashes and display wiring present', () => {
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  for (const f of [
    'server/core/commuteCore.js',
    'server/commute.js',
    'web/display/widgets/commute.ts',
    'web/admin/sections/CommuteWidget.tsx',
  ]) {
    assert.doesNotMatch(read(f), /\u2014/, `no em dashes in ${f}`);
  }
  const custom = read('web/display/widgets/custom.ts');
  assert.match(custom, /new CommuteCard\(w/);
  // a restored backup with the Google Maps key lets failed routes try the restored key at once
  assert.match(read('server/routes/system.js'), /applied\.includes\('commute'\)\) commuteKeyChanged\(\)/);
});
