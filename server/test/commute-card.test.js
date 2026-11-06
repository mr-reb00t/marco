// Trayectos card of a Personalizado screen (canvas kind 'commute'): its routes validated as the commute widget's
// (shared sanitizer, a card may be saved before its addresses are written), never sent to a display (only ids, names,
// modes, the display options and a sig), the travel times asked by item id only for a card the requesting screen
// shows now (GET /api/display/commute?item=&v=), the same Google cache and limits as the widget, the addresses left
// out of a screen file, and no such card on Marco Cloud. Google is never called: setCommuteFetch counts the requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { COMMUTE_LOOKS, commuteSig, sanitizeCommuteOptions } from '../core/commuteCore.js';
import {
  CANVAS_KINDS, CLOUD_CANVAS_KINDS, canvasDefaults, commuteCardOf, defaultCanvas, defaultItemStyle, exportCanvasFile, readCanvasFile, sanitizeCanvas,
} from '../core/canvasCore.js';
import { setCommuteFetch } from '../commute.js';
import { _resetPrivacy, applyPrivacy } from '../privacy.js';
import { validateConfig } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';
import * as store from '../store.js';
import { ensurePassword, hashPassword, sessionMiddleware } from '../auth.js';
import { publicRouter } from '../routes/public.js';

const ORIGIN = 'Calle de Alcalá 101, Madrid';
const DEST = 'Paseo de la Castellana 200, Madrid';
const route = (over = {}) => ({
  id: 'cr_card1', name: 'Trabajo', origin: ORIGIN, destination: DEST, mode: 'driving',
  direction: 'to', reverseAfter: '12:00', days: [], from: '', to: '', ...over,
});
const cardProps = (routes = [route()], over = {}) => ({ ...canvasDefaults('commute'), units: 'metric', routes, ...over });
const item = (id, props = cardProps(), over = {}) => ({
  id, kind: 'commute', pos: { zone: 'main', x: 0, y: 0, size: 'w' }, style: defaultItemStyle(), props, ...over,
});
const rotator = (id, cards, over = {}) => ({
  id, kind: 'rotator', pos: { zone: 'main', x: 0, y: 8, size: 'l' }, style: defaultItemStyle(),
  props: { cards, everySec: 10, dots: true, transition: 'fade' }, ...over,
});
const clockCard = (id) => ({ id, kind: 'clock.digital', props: canvasDefaults('clock.digital') });
const collector = () => {
  const errors = [];
  return { errors, err: (p, m) => errors.push({ path: p, msg: m }), warn() {} };
};

test('validation: the card shares the widget\'s rules; it may be saved without its routes or addresses, a widget not', () => {
  // draft (the card): nothing written yet is no error
  const c1 = collector();
  const empty = sanitizeCommuteOptions({ routes: [] }, c1.err, 'p', { draft: true });
  assert.deepEqual(c1.errors, []);
  assert.deepEqual(empty.routes, []);
  const c2 = collector();
  const blank = sanitizeCommuteOptions({ routes: [route({ origin: '', destination: '  ' })] }, c2.err, 'p', { draft: true });
  assert.deepEqual(c2.errors, []);
  assert.equal(blank.routes[0].origin, '');
  // strict (the widget): both are errors, with the widget's paths and words
  const c3 = collector();
  sanitizeCommuteOptions({ routes: [route({ origin: '', destination: '' })] }, c3.err, 'p');
  assert.deepEqual(c3.errors.map((e) => `${e.path} ${e.msg}`), ['p.routes[0].origin required', 'p.routes[0].destination required']);
  const c4 = collector();
  sanitizeCommuteOptions({ routes: [] }, c4.err, 'p');
  assert.deepEqual(c4.errors, [{ path: 'p.routes', msg: 'at least one route' }]);
  // the same limits in both: eight routes at the most, ten minutes at the least (5 becomes 10), modes, times, days
  const c5 = collector();
  const many = sanitizeCommuteOptions({ routes: Array.from({ length: 9 }, (_x, i) => route({ id: `cr_n${i}` })), refreshMin: 7 }, c5.err, 'p', { draft: true });
  assert.equal(many.routes.length, 8);
  assert.deepEqual(c5.errors.map((e) => e.path), ['p.routes', 'p.refreshMin']);
  assert.equal(sanitizeCommuteOptions({ refreshMin: 5 }, () => {}, 'p', { draft: true }).refreshMin, 10);
  const c6 = collector();
  sanitizeCommuteOptions({ routes: [route({ mode: 'plane', from: '25:00', days: [1, 9] })] }, c6.err, 'p', { draft: true });
  assert.deepEqual(c6.errors.map((e) => e.path), ['p.routes[0].from', 'p.routes[0].mode', 'p.routes[0].days']);

  // in a screen: the card's props, the same paths under the item as under the widget's options
  const cv = collector();
  const canvas = sanitizeCanvas(cv, 'canvas', { ...defaultCanvas(), items: [item('cv_comm0001', cardProps([route({ mode: 'plane' })], { look: 'huge' }))] });
  assert.deepEqual(cv.errors.map((e) => `${e.path} ${e.msg}`), [
    'canvas.items[0].props.look must be one of auto, focus, list, line, pill',
    'canvas.items[0].props.routes[0].mode must be one of driving, transit, bicycling, walking',
  ]);
  assert.equal(canvas.items[0].props.look, 'auto');
  const w = validateConfig({ ...defaultConfig(), widgets: [{ id: 'w_c', type: 'commute', name: 'T', options: { commute: { routes: [route({ mode: 'plane' })] } } }] });
  assert.ok(w.errors.some((e) => e.path === 'widgets[0].options.commute.routes[0].mode' && e.message === 'must be one of driving, transit, bicycling, walking'));
  // a card with no route and a route without addresses is saved as it is (the screen file of another household)
  const ok = collector();
  const draft = sanitizeCanvas(ok, 'canvas', { ...defaultCanvas(), items: [item('cv_comm0001', cardProps([route({ origin: '', destination: '' })])), item('cv_comm0002', cardProps([]), { pos: { zone: 'main', x: 12, y: 0, size: 'w' } })] });
  assert.deepEqual(ok.errors, []);
  assert.equal(draft.items.length, 2);
  // every design is a look; at most four cards a screen
  assert.deepEqual([...COMMUTE_LOOKS], ['auto', 'focus', 'list', 'line', 'pill']);
  assert.equal(CANVAS_KINDS.commute.perScreen, 4);
});

/** A config with a Personalizado first screen holding `items`, validated. */
function canvasConfig(items, extra = (c) => c) {
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.screens[0].layout = { ...c.screens[0].layout, preset: 'canvas' };
  c.screens[0].canvas = { ...defaultCanvas(), items };
  extra(c);
  const v = validateConfig(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return v.value;
}

test('projection: a display gets route ids, names, modes, the look and a sig, never an address (on the screen, in a Rotativa, in a group)', () => {
  const cfg = canvasConfig([
    item('cv_comm0001'),
    rotator('cv_rot00001', [{ ...item('cv_comm0002'), pos: undefined, style: undefined }, clockCard('cv_clk00001')].map(({ pos: _p, style: _s, ...x }) => x)),
    rotator('cv_rot00002', [
      { id: 'cv_grp00001', kind: 'group', props: { dir: 'rows', cards: [{ id: 'cv_comm0003', kind: 'commute', props: cardProps([route({ id: 'cr_grp' })]) }, clockCard('cv_clk00002')] } },
      clockCard('cv_clk00003'),
    ], { pos: { zone: 'main', x: 12, y: 8, size: 'l' } }),
  ]);
  const screen = cfg.screens[0];
  const out = displayConfig(cfg, screen);
  const json = JSON.stringify(out);
  for (const secret of [ORIGIN, DEST, 'Alcalá', 'Castellana', 'reverseAfter', '"days"']) assert.ok(!json.includes(secret), secret);
  const top = out.canvas.items.find((x) => x.id === 'cv_comm0001');
  assert.deepEqual(Object.keys(top.props).sort(), ['look', 'refreshMin', 'routes', 'showArrival', 'showRouteSummary', 'sig', 'units']);
  assert.deepEqual(top.props.routes, [{ id: 'cr_card1', name: 'Trabajo', mode: 'driving' }]);
  assert.match(top.props.sig, /^[0-9a-f]{8}$/);
  assert.equal(top.props.sig, commuteSig(screen.canvas.items[0].props));
  const inRot = out.canvas.items.find((x) => x.id === 'cv_rot00001').props.cards.find((x) => x.id === 'cv_comm0002');
  assert.deepEqual(inRot.props.routes, [{ id: 'cr_card1', name: 'Trabajo', mode: 'driving' }]);
  const inGroup = out.canvas.items.find((x) => x.id === 'cv_rot00002').props.cards[0].props.cards[0];
  assert.deepEqual(inGroup.props.routes, [{ id: 'cr_grp', name: 'Trabajo', mode: 'driving' }]);

  // a new address: a new sig and a new item hash (the card asks again), still no address
  const cfg2 = structuredClone(cfg);
  cfg2.screens[0].canvas.items[0].props.routes[0].destination = 'Aeropuerto de Barajas T4';
  const out2 = displayConfig(cfg2, cfg2.screens[0]);
  const top2 = out2.canvas.items.find((x) => x.id === 'cv_comm0001');
  assert.notEqual(top2.props.sig, top.props.sig);
  assert.notEqual(top2.v, top.v);
  assert.ok(!JSON.stringify(out2).includes('Barajas'));

  // a private screen: a placeholder, no props at all
  const priv = displayConfig(cfg, screen, { privacy: { status: { active: true, mode: 'on' } } });
  const p = priv.canvas.items.find((x) => x.id === 'cv_comm0001');
  assert.equal(p.disabled, 'privacy');
  assert.deepEqual(p.props, {});
});

test('commuteCardOf: only a shown Trayectos card of a Personalizado screen', () => {
  const cfg = canvasConfig([
    item('cv_comm0001'),
    item('cv_comm0002', cardProps(), { pos: { zone: 'main', x: 12, y: 0, size: 'w' }, hidden: true }),
    { ...item('cv_clk00009'), kind: 'clock.digital', props: canvasDefaults('clock.digital'), pos: { zone: 'main', x: 0, y: 4, size: 'm' } },
    item('cv_comm0003', cardProps(), { pos: { zone: 'main', x: 12, y: 4, size: 'w' }, schedule: [{ id: 's1', enabled: true, days: [], from: '22:00', to: '23:00' }] }),
  ]);
  const s = cfg.screens[0];
  const at = new Date('2026-10-12T08:30:00Z');
  assert.equal(commuteCardOf(s, 'cv_comm0001', { now: at, tz: 'UTC' })?.id, 'cv_comm0001');
  assert.equal(commuteCardOf(s, 'cv_comm0002', { now: at, tz: 'UTC' }), null);
  assert.equal(commuteCardOf(s, 'cv_clk00009', { now: at, tz: 'UTC' }), null);
  assert.equal(commuteCardOf(s, 'cv_comm0003', { now: at, tz: 'UTC' }), null);
  assert.equal(commuteCardOf(s, 'cv_comm0003', { now: new Date('2026-10-12T22:30:00Z'), tz: 'UTC' })?.id, 'cv_comm0003');
  assert.equal(commuteCardOf(s, 'cv_nope0000', { now: at, tz: 'UTC' }), null);
  assert.equal(commuteCardOf(s, '../etc', { now: at, tz: 'UTC' }), null);
  assert.equal(commuteCardOf({ ...s, layout: { ...s.layout, preset: 'modern' } }, 'cv_comm0001', { now: at, tz: 'UTC' }), null);
});

const GOOGLE_OK = JSON.stringify({
  status: 'OK',
  routes: [{ summary: 'A-6', legs: [{ distance: { value: 18400 }, duration: { value: 1140 }, duration_in_traffic: { value: 1440 } }] }],
});
const KEY = 'AIzaSyTestKey1234567890';

/** A server with `cfg`, a fake Google that counts its requests, and a fixed clock (Monday 08:30 UTC). */
async function server(cfg, { key = KEY } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-commute-card-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret123'), passwordIsDefault: false, ...(key ? { commute: { apiKey: key } } : {}) }));
  _resetPrivacy();
  store.initStore(dir);
  await ensurePassword();
  const clock = { now: Date.parse('2026-10-12T08:30:00Z') };
  const calls = [];
  setCommuteFetch(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return { status: 200, text: async () => GOOGLE_OK };
  }, () => clock.now);
  const app = express();
  app.use(sessionMiddleware());
  app.use('/api', publicRouter({ version: 'test' }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: String(err?.message) }));
  const call = (url) => new Promise((resolve, reject) => {
    const u = new URL(url, 'http://127.0.0.1');
    const req = Object.assign(new EventEmitter(), {
      method: 'GET', url: u.pathname + u.search, originalUrl: u.pathname + u.search, path: u.pathname,
      query: Object.fromEntries(u.searchParams.entries()), headers: { host: '127.0.0.1' }, body: {}, ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' }, connection: { remoteAddress: '127.0.0.1' },
      get(h) { return this.headers[String(h).toLowerCase()]; },
    });
    const headers = new Map();
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader(k, v) { headers.set(String(k).toLowerCase(), v); },
      getHeader(k) { return headers.get(String(k).toLowerCase()); },
      removeHeader(k) { headers.delete(String(k).toLowerCase()); },
      set(k, v) { this.setHeader(k, v); return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, json: payload, cache: headers.get('cache-control') }); return this; },
      end(chunk) { resolve({ status: this.statusCode, json: chunk ? JSON.parse(String(chunk)) : null }); return this; },
    });
    app.handle(req, res, reject);
  });
  return { call, calls, clock };
}

test('GET /api/display/commute?item=: a shown card answers from the saved routes; the widget and the card share one request', async () => {
  const cfg = canvasConfig([item('cv_comm0001')], (c) => {
    c.widgets = [{ id: 'w_comm', type: 'commute', name: 'T', options: { url: '', refreshSec: 900, fit: 'contain', bust: false, commute: { units: 'metric', refreshMin: 10, showRouteSummary: true, showArrival: true, routes: [route()] } } }];
    c.screens[0].widgets = [{ widgetId: 'w_comm', place: 'side', corner: 'br', size: 'm' }];
  });
  const { call, calls } = await server(cfg);
  try {
    const sig = commuteSig(store.getConfig().screens[0].canvas.items[0].props);
    const r = await call(`/api/display/commute?item=cv_comm0001&v=${sig}`);
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'no-store');
    assert.equal(calls.length, 1);
    assert.deepEqual(r.json.routes.map((x) => [x.id, x.name, x.ok, x.durationSec, x.traffic, x.delayMin]), [['cr_card1', 'Trabajo', true, 1440, 'moderate', 5]]);
    assert.ok(!JSON.stringify(r.json).includes('Alcalá'));
    // the same route on the widget: the leg the card asked for, no second request
    const w = await call('/api/display/commute?id=w_comm');
    assert.equal(w.status, 200);
    assert.equal(calls.length, 1);
    // without v (an older display): the saved card still answers, from the cache
    assert.equal((await call('/api/display/commute?item=cv_comm0001')).status, 200);
    assert.equal(calls.length, 1);
    // routes or a refresh in the query are never read
    assert.equal((await call(`/api/display/commute?item=cv_comm0001&refreshMin=1&routes=${encodeURIComponent(JSON.stringify([route({ origin: 'Elsewhere' })]))}`)).status, 200);
    assert.equal(calls.length, 1);
    // a wrong sig is an unsaved card in the preview: 409 and nothing asked
    assert.deepEqual((await call('/api/display/commute?item=cv_comm0001&v=00000000')).json, { error: 'unsaved' });
    assert.equal(calls.length, 1);
  } finally {
    setCommuteFetch(null);
  }
});

test('GET /api/display/commute?item=: 404 and no Google request for a card the requesting screen does not show now', async () => {
  const cards = [
    item('cv_comm0001'),
    item('cv_hide0001', cardProps([route({ id: 'cr_h', origin: 'Hidden 1' })]), { hidden: true, pos: { zone: 'main', x: 12, y: 0, size: 'w' } }),
    item('cv_sche0001', cardProps([route({ id: 'cr_s', origin: 'Night 1' })]), { pos: { zone: 'main', x: 0, y: 4, size: 'w' }, schedule: [{ id: 's1', enabled: true, days: [], from: '22:00', to: '23:00' }] }),
    item('cv_cond0001', cardProps([route({ id: 'cr_c', origin: 'Cond 1' })]), { pos: { zone: 'main', x: 12, y: 4, size: 'w' }, when: { src: 'value', key: 'away', op: 'eq', value: 'yes' } }),
  ];
  // (four cards a screen at the most: the Rotativas are on a second screen)
  const cfg = canvasConfig(cards, (c) => {
    const second = structuredClone(c.screens[0]);
    Object.assign(second, { id: 's_second', slug: 'segunda', name: 'Segunda' });
    second.canvas.items = [
      rotator('cv_rot00001', [{ id: 'cv_inro0001', kind: 'commute', props: cardProps([route({ id: 'cr_r', origin: 'Rot 1' })]) }, clockCard('cv_clk00001')], { pos: { zone: 'main', x: 0, y: 0, size: 'l' } }),
      rotator('cv_rot00002', [{ id: 'cv_inhd0001', kind: 'commute', props: cardProps([route({ id: 'cr_rh', origin: 'RotHidden 1' })]) }, clockCard('cv_clk00002')], { hidden: true, pos: { zone: 'main', x: 12, y: 0, size: 'l' } }),
    ];
    const other = structuredClone(c.screens[0]);
    Object.assign(other, { id: 's_other', slug: 'agenda', name: 'Agenda', layout: { ...c.screens[0].layout, preset: 'bigCalendar' } });
    c.screens.push(second, other);
  });
  assert.equal(cfg.screens[0].canvas.items.length, 4);
  const { call, calls } = await server(cfg);
  try {
    const notFound = async (url) => {
      const before = calls.length;
      assert.deepEqual(await call(url), { status: 404, json: { error: 'not_found' }, cache: 'no-store' }, url);
      assert.equal(calls.length, before, url);
    };
    await notFound('/api/display/commute?item=cv_zzzz9999');
    await notFound('/api/display/commute?item=..%2Fcv_comm0001');
    await notFound('/api/display/commute?item=');
    await notFound('/api/display/commute?item=cv_hide0001');
    await notFound('/api/display/commute?item=cv_sche0001');
    await notFound('/api/display/commute?item=cv_cond0001');
    // in a Rotativa hidden by hand
    await notFound('/api/display/commute?item=cv_inhd0001&screen=segunda');
    // another screen's card, asked from this one (and this one's from there); a screen that is not Personalizado
    await notFound('/api/display/commute?item=cv_inro0001');
    await notFound('/api/display/commute?item=cv_comm0001&screen=segunda');
    await notFound('/api/display/commute?item=cv_comm0001&screen=agenda');
    assert.equal(calls.length, 0);
    // a card inside a Rotativa is shown like any other, from its own screen
    assert.equal((await call('/api/display/commute?item=cv_inro0001&screen=segunda')).status, 200);
    assert.equal((await call('/api/display/commute?item=cv_comm0001')).status, 200);
    assert.equal(calls.length, 2);
    // a private screen: nothing, for any card
    applyPrivacy({ mode: 'on', screenIds: [store.getConfig().screens[0].id, 's_second'] });
    await notFound('/api/display/commute?item=cv_comm0001');
    await notFound('/api/display/commute?item=cv_inro0001&screen=segunda');
  } finally {
    _resetPrivacy();
    setCommuteFetch(null);
  }
});

test('GET /api/display/commute?item=: no key on the server says so, and asks nothing', async () => {
  const { call, calls } = await server(canvasConfig([item('cv_comm0001')]), { key: '' });
  const env = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  try {
    const r = await call('/api/display/commute?item=cv_comm0001');
    assert.equal(r.status, 200);
    assert.equal(r.json.keySet, false);
    assert.deepEqual(r.json.routes, []);
    assert.equal(calls.length, 0);
  } finally {
    if (env !== undefined) process.env.GOOGLE_MAPS_API_KEY = env;
    setCommuteFetch(null);
  }
});

test('GET /api/display/commute?item=: a route with no address yet is not asked', async () => {
  const { call, calls } = await server(canvasConfig([item('cv_comm0001', cardProps([route({ origin: '' }), route({ id: 'cr_card2' })]))]));
  try {
    const r = await call('/api/display/commute?item=cv_comm0001');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.routes.map((x) => x.id), ['cr_card2']);
    assert.equal(calls.length, 1);
  } finally {
    setCommuteFetch(null);
  }
});

test('screen file: the addresses stay home (export and import blank them, the card asks for them again)', () => {
  const cfg = canvasConfig([
    item('cv_comm0001'),
    rotator('cv_rot00001', [{ id: 'cv_inro0001', kind: 'commute', props: cardProps([route({ id: 'cr_r' })]) }, clockCard('cv_clk00001')]),
  ]);
  const file = exportCanvasFile(cfg.screens[0].canvas, {});
  const json = JSON.stringify(file);
  assert.ok(!json.includes('Alcalá') && !json.includes('Castellana'));
  assert.deepEqual(file.picks.cv_comm0001, ['routes']);
  assert.deepEqual(file.picks.cv_rot00001, ['routes']);
  // the names, modes and schedules stay: only the addresses are written again
  assert.deepEqual(file.canvas.items[0].props.routes[0], { ...route(), origin: '', destination: '' });
  // a file written by hand with addresses: blanked on import, marked to write them again
  const raw = structuredClone(file);
  raw.canvas.items[0].props.routes[0].origin = 'Somewhere 1';
  raw.picks = {};
  const r = readCanvasFile(raw);
  assert.equal(r.ok, true, r.error);
  const card = r.canvas.items.find((x) => x.kind === 'commute');
  assert.equal(card.props.routes[0].origin, '');
  assert.deepEqual(r.picks[card.id], ['routes']);
  assert.ok(!JSON.stringify(r).includes('Somewhere'));
});

test('Marco Cloud: no Trayectos card (refused, left out of a screen file)', () => {
  assert.equal(CANVAS_KINDS.commute.edition, 'local');
  assert.ok(!CLOUD_CANVAS_KINDS.includes('commute'));
  const c = collector();
  const out = sanitizeCanvas(c, 'canvas', { ...defaultCanvas(), items: [item('cv_comm0001')] }, {}, { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.equal(out.items.length, 0);
  assert.ok(c.errors.some((e) => e.path === 'canvas.items[0].kind' && e.msg === 'not available on this server'));
  const r = readCanvasFile(exportCanvasFile({ ...defaultCanvas(), items: [item('cv_comm0001')] }), {}, { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.equal(r.ok, true);
  assert.equal(r.canvas.items.length, 0);
  assert.equal(r.dropped, 1);
});
