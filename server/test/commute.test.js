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
import { getCommute, setCommuteFetch, testCommute } from '../commute.js';
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
    () => parseGoogleRoutesV2(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'API key not valid' } })),
    (e) => e instanceof CommuteError && e.code === 'http_denied',
  );
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

test('routes: GET /api/display/commute, POST /api/admin/test/commute, and GET/PUT /api/admin/commute/key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-commute-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.widgets = [
    {
      id: 'w_comm',
      type: 'commute',
      name: 'Trayectos',
      options: {
        commute: {
          units: 'metric',
          refreshMin: 10,
          showRouteSummary: true,
          showArrival: true,
          routes: [
            {
              id: 'cr_1',
              name: 'Trabajo',
              origin: 'Puerta del Sol, Madrid',
              destination: 'Chamartín, Madrid',
              mode: 'driving',
              direction: 'to',
              reverseAfter: '12:00',
              days: [],
              from: '',
              to: '',
            },
          ],
        },
      },
    },
  ];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(
    path.join(dir, 'secrets.json'),
    JSON.stringify({
      passwordHash: await hashPassword('secret123'),
      passwordIsDefault: false,
      commute: { apiKey: 'AIzaSyTestKey1234567890' },
    }),
  );
  store.initStore(dir);
  await ensurePassword();

  const now = Date.parse('2026-10-12T08:30:00Z');
  setCommuteFetch(async (url) => {
    const u = String(url);
    if (u.includes('badkey')) {
      return {
        status: 200,
        text: async () => JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.' }),
      };
    }
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          status: 'OK',
          routes: [
            {
              summary: 'Paseo de la Castellana',
              legs: [
                {
                  distance: { value: 8200 },
                  duration: { value: 900 },
                  duration_in_traffic: { value: 1260 },
                },
              ],
            },
          ],
        }),
    };
  }, () => now);

  const app = express();
  app.use(sessionMiddleware());
  app.use((req, _res, next) => {
    if (req.headers['x-test-authed'] === '1') startSession(req, { method: 'password', email: null });
    next();
  });
  app.use('/api/admin', adminRouter());
  app.use('/api', publicRouter({ version: 'test' }));

  const call = (method, url, body, authed = false) =>
    new Promise((resolve, reject) => {
      const u = new URL(url, 'http://127.0.0.1');
      const req = Object.assign(new EventEmitter(), {
        method,
        url: u.pathname + u.search,
        originalUrl: u.pathname + u.search,
        path: u.pathname,
        query: Object.fromEntries(u.searchParams.entries()),
        headers: {
          host: '127.0.0.1',
          'content-type': 'application/json',
          ...(authed ? { 'x-test-authed': '1' } : {}),
        },
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
        setHeader(k, v) {
          headers.set(String(k).toLowerCase(), v);
        },
        getHeader(k) {
          return headers.get(String(k).toLowerCase());
        },
        removeHeader(k) {
          headers.delete(String(k).toLowerCase());
        },
        set(k, v) {
          this.setHeader(k, v);
          return this;
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          resolve({ status: this.statusCode, json: payload });
          return this;
        },
        end(chunk) {
          resolve({ status: this.statusCode, json: chunk ? JSON.parse(String(chunk)) : null });
          return this;
        },
      });
      app.handle(req, res, reject);
    });

  try {
    const d = await call('GET', '/api/display/commute?id=w_comm');
    assert.equal(d.status, 200);
    assert.equal(d.json.keySet, true);
    assert.equal(d.json.routes.length, 1);
    assert.equal(d.json.routes[0].ok, true);
    assert.equal(d.json.routes[0].durationSec, 1260);
    assert.equal(d.json.routes[0].normalDurationSec, 900);
    assert.equal(d.json.routes[0].traffic, 'heavy');
    assert.equal(d.json.routes[0].summary, 'Paseo de la Castellana');

    assert.equal((await call('GET', '/api/display/commute?id=nonexistent')).status, 404);
    assert.equal((await call('POST', '/api/admin/test/commute', { origin: 'A', destination: 'B', mode: 'driving' }, false)).status, 401);

    const t = await call('POST', '/api/admin/test/commute', { origin: 'Sol', destination: 'Chamartín', mode: 'driving' }, true);
    assert.equal(t.status, 200);
    assert.equal(t.json.ok, true);
    assert.equal(t.json.durationSec, 1260);

    const keyGet = await call('GET', '/api/admin/commute/key', null, true);
    assert.deepEqual(keyGet.json, { set: true, hint: '7890' });

    const keyPut = await call('PUT', '/api/admin/commute/key', { key: 'AIzaSyNewValidKey987654321' }, true);
    assert.equal(keyPut.status, 200);
    assert.deepEqual(keyPut.json, { set: true, hint: '4321', checked: true });
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
    assert.doesNotMatch(read(f), /—/, `no em dashes in ${f}`);
  }
  const custom = read('web/display/widgets/custom.ts');
  assert.match(custom, /new CommuteCard\(w/);
});
