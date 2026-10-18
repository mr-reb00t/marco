// Divisas (the exchange rates card, kind 'currency') and the Currency widget, and Bolsa's symbols with no data. The
// readers of Frankfurter's answers (core/dataCore.js), the pair maths through the euro, the shared cache (one call for
// every pair of every screen, a year only for a 1 year curve, refreshed a few times a day and every half hour while
// the day's rates are due), stale while error, what one item gets, the validation of the kind and of the widget, and
// the routes on the real app with a made-up upstream (core/dataFake.js): the screen's own items, the widget's route,
// nothing while private, the picker behind the session, and no source address in any answer. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDataHub, DATA_HOST_LIST, DATA_HOSTS, DATA_TTL, DataError, dataForItem, FX_CURRENCIES, fxPairOf, fxRate, fxTtl, parseFxCurrencies,
  parseFxSeries, parseQuote, statusError,
} from '../core/dataCore.js';
import { FAKE_FX, fakeDataCall, FAKE_STOCKS_KEY } from '../core/dataFake.js';
import { CANVAS_KINDS, CLOUD_CANVAS_KINDS, canvasDefaults, currencyProps, defaultCanvas, defaultItemStyle, sanitizeCanvas } from '../core/canvasCore.js';
import { defaultConfig, WIDGET_TYPES } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { displayWidgets } from '../core/screens.js';
import * as store from '../store.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetDisplayAccess, listDisplayLinks, syncDisplayKeys } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { _resetActivityThrottle } from '../activity.js';
import { setDataFetch } from '../dataFeeds.js';
import { currencyQuery } from '../routes/data.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const collector = () => {
  const errors = [];
  return { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
};

// ---- readers -----------------------------------------------------------------------------------------------------

test('parseFxSeries: v2 lists, v1 time series and v1 latest; odd codes, other bases and bad rates left out', () => {
  const v2 = parseFxSeries(JSON.stringify([
    { date: '2026-10-15', base: 'EUR', quote: 'HUF', rate: 364 },
    { date: '2026-10-16', base: 'EUR', quote: 'HUF', rate: 363.08 },
    { date: '2026-10-16', base: 'EUR', quote: 'USD', rate: 1.1298 },
    { date: '2026-10-16', base: 'USD', quote: 'JPY', rate: 157 },
    { date: '2026-10-16', base: 'EUR', quote: 'usd', rate: 2 },
    { date: '2026-10-16', base: 'EUR', quote: 'GBP', rate: -1 },
    { date: '16/10/2026', base: 'EUR', quote: 'CHF', rate: 0.93 },
    { date: '2026-10-16', base: 'EUR', quote: 'EUR', rate: 1 },
    'junk',
  ]));
  assert.deepEqual(v2.dates, ['2026-10-15', '2026-10-16']);
  assert.deepEqual(v2.rates, { HUF: [364, 363.08], USD: [null, 1.1298] });
  const v1 = parseFxSeries(JSON.stringify({ amount: 1, base: 'EUR', start_date: '2026-10-15', end_date: '2026-10-16', rates: { '2026-10-16': { HUF: 363.08 }, '2026-10-15': { HUF: 364, USD: 1.12 } } }));
  assert.deepEqual(v1, { dates: ['2026-10-15', '2026-10-16'], rates: { HUF: [364, 363.08], USD: [1.12, null] } });
  const latest = parseFxSeries(JSON.stringify({ amount: 1, base: 'EUR', date: '2026-10-16', rates: { HUF: 363.08 } }));
  assert.deepEqual(latest, { dates: ['2026-10-16'], rates: { HUF: [363.08] } });
  for (const bad of ['<html>', '{}', '[]', JSON.stringify({ base: 'USD', rates: { '2026-10-16': { EUR: 0.9 } } })]) assert.throws(() => parseFxSeries(bad), DataError, bad);
});

test('parseFxCurrencies: the ones still published (not the kuna or the franc), the euro always, v1 too', () => {
  const v2 = parseFxCurrencies(JSON.stringify([
    { iso_code: 'HUF', name: 'Hungarian Forint', end_date: '2026-10-16' },
    { iso_code: 'HRK', name: 'Croatian Kuna', end_date: '2022-12-30' },
    { iso_code: 'USD', name: 'United States Dollar', end_date: '2026-10-15' },
    { iso_code: 'x', name: 'bad' },
    { iso_code: 'ZAR', name: 'South African Rand\u0000 <b>', end_date: '2026-10-16' },
  ]));
  assert.deepEqual(v2.map((c) => c.code), ['EUR', 'HUF', 'USD', 'ZAR']);
  assert.equal(v2.find((c) => c.code === 'ZAR').name, 'South African Rand <b>', 'control characters out (the admin writes it as text)');
  assert.deepEqual(parseFxCurrencies(JSON.stringify({ EUR: 'Euro', HUF: 'Hungarian Forint', bad: 'x' })).map((c) => c.code), ['EUR', 'HUF']);
  assert.throws(() => parseFxCurrencies('[]'), DataError);
});

test('pair maths through the euro: QUOTE per BASE = QUOTE per euro / BASE per euro', () => {
  const s = { dates: ['2026-10-16'], rates: { HUF: [363.08], USD: [1.1298], MXN: [20.6871], GBP: [0.84385] } };
  assert.equal(fxRate(s, 'EUR', 'HUF', 0), 363.08);
  assert.equal(fxRate(s, 'HUF', 'EUR', 0), 1 / 363.08);
  assert.ok(Math.abs(fxRate(s, 'USD', 'MXN', 0) - 20.6871 / 1.1298) < 1e-12);
  assert.ok(Math.abs(fxRate(s, 'GBP', 'EUR', 0) - 1 / 0.84385) < 1e-12);
  assert.equal(fxRate(s, 'EUR', 'XAU', 0), null);
  assert.equal(fxRate(s, 'EUR', 'HUF', 3), null);
});

test('fxPairOf: a symbol that looks like a currency pair of the ECB set (what Bolsa points to Divisas for)', () => {
  for (const [sym, want] of [['EURHUF', 'EUR/HUF'], ['EUR/HUF', 'EUR/HUF'], ['OANDA:EUR_HUF', 'EUR/HUF'], ['FX:gbpusd', 'GBP/USD'], ['usd-mxn', 'USD/MXN']]) {
    const p = fxPairOf(sym);
    assert.equal(p && `${p.base}/${p.quote}`, want, sym);
  }
  for (const sym of ['AAPL', 'EUREUR', 'BINANCE:BTCUSDT', 'ABCDEF', 'EURXAU', 'MSFT.DE', '']) assert.equal(fxPairOf(sym), null, sym);
  assert.ok(FX_CURRENCIES.includes('EUR') && FX_CURRENCIES.includes('HUF') && FX_CURRENCIES.every((c) => /^[A-Z]{3}$/.test(c)));
});

test('fxTtl: a few times a day; every half hour on a working afternoon while the day\'s rates are not in', () => {
  const s = (last) => ({ dates: [last], rates: {} });
  // Friday 2026-10-16
  assert.equal(fxTtl(s('2026-10-15'), Date.parse('2026-10-16T14:30:00Z')), DATA_TTL.fxDue);
  assert.equal(fxTtl(s('2026-10-16'), Date.parse('2026-10-16T15:30:00Z')), DATA_TTL.fx, 'in already');
  assert.equal(fxTtl(s('2026-10-15'), Date.parse('2026-10-16T08:00:00Z')), DATA_TTL.fx, 'the morning');
  assert.equal(fxTtl(s('2026-10-16'), Date.parse('2026-10-17T15:00:00Z')), DATA_TTL.fx, 'Saturday: nothing comes');
  assert.ok(DATA_TTL.fx >= 3 * HOUR && DATA_TTL.fx <= 6 * HOUR);
});

test('Frankfurter is an allowed host; Finnhub: 401 is a refused key, 403 a symbol the plan does not cover', () => {
  assert.equal(DATA_HOSTS.frankfurter, 'api.frankfurter.dev');
  assert.ok(DATA_HOST_LIST.includes('api.frankfurter.dev'));
  assert.equal(statusError('finnhub.io', 401).code, 'key_refused');
  assert.equal(statusError('finnhub.io', 403).code, 'no_access');
  assert.equal(statusError('api.frankfurter.dev', 403).code, 'bad_response');
  assert.equal(statusError('api.frankfurter.dev', 404).code, 'not_found');
  assert.equal(statusError('api.frankfurter.dev', 200), null);
  assert.equal(parseQuote(JSON.stringify({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 })), null, 'all zeros: Finnhub does not know it');
});

// ---- the hub -----------------------------------------------------------------------------------------------------

function hubWith(opts = {}) {
  // Friday 2026-10-16, after the ECB published
  let t = Date.parse(opts.at ?? '2026-10-16T17:00:00Z');
  const calls = [];
  const fail = {};
  const fake = fakeDataCall({ calls, now: () => t, fail });
  const hub = createDataHub({ call: opts.wrap ? opts.wrap(fake) : fake, now: () => t, stocksKey: () => opts.key ?? FAKE_STOCKS_KEY });
  return { hub, calls, fail, now: () => t, step: (ms) => { t += ms; } };
}
const settle = () => new Promise((r) => setTimeout(r, 5));
const P = (...xs) => xs.map((x) => ({ base: x.slice(0, 3), quote: x.slice(4) }));

test('currency: the rate of each pair through the euro, its change since the working day before, the curve', async () => {
  const { hub } = hubWith();
  const d = await dataForItem(hub, { kind: 'currency', props: { pairs: P('EUR/HUF', 'USD/MXN', 'GBP/EUR', 'EUR/XAU'), range: '30d', chart: 'area' } });
  assert.equal(d.kind, 'currency');
  assert.equal(d.range, '30d');
  assert.equal(d.date, '2026-10-16');
  assert.equal(d.stale, false);
  const [huf, mxn, gbp, xau] = d.pairs;
  assert.equal(huf.rate, FAKE_FX.HUF[0]);
  assert.ok(Math.abs(mxn.rate - FAKE_FX.MXN[0] / FAKE_FX.USD[0]) < 1e-9);
  assert.ok(Math.abs(gbp.rate - 1 / FAKE_FX.GBP[0]) < 1e-9);
  // the change: against the working day before (Thursday), from the same series
  const prev = huf.pts[huf.pts.length - 2][1];
  assert.ok(Math.abs(huf.ch - (huf.rate / prev - 1) * 100) < 0.01);
  assert.equal(huf.pts[huf.pts.length - 1][0], Date.parse('2026-10-16T00:00:00Z'));
  assert.ok(huf.pts.length >= 20 && huf.pts.length <= 23, `a month of working days: ${huf.pts.length}`);
  assert.ok(huf.pts.every(([at]) => at >= Date.parse('2026-09-16T00:00:00Z')));
  assert.deepEqual([xau.rate, xau.noData, xau.pts], [null, true, []], 'a currency the ECB does not publish: no data, said so');
  // 7 days and no curve
  const w = await dataForItem(hub, { kind: 'currency', props: { pairs: P('EUR/HUF'), range: '7d', chart: 'area' } });
  assert.ok(w.pairs[0].pts.length >= 5 && w.pairs[0].pts.length <= 6);
  const none = await dataForItem(hub, { kind: 'currency', props: { pairs: P('EUR/HUF'), range: '1y', chart: 'none' } });
  assert.deepEqual(none.pairs[0].pts, []);
  // only what the card draws: no address, no host
  assert.equal(/frankfurter|https?:/.test(JSON.stringify(d)), false);
});

test('one call with every currency serves every pair of every screen; the year only for a 1 year curve', async () => {
  const { hub, calls, step } = hubWith();
  const items = [
    { kind: 'currency', props: { pairs: P('EUR/HUF', 'EUR/USD'), range: '30d' } },
    { kind: 'currency', props: { pairs: P('USD/MXN'), range: '7d' } },
    { kind: 'currency', props: { pairs: P('GBP/EUR', 'CHF/JPY'), range: '30d', chart: 'line' } },
  ];
  await Promise.all(Array.from({ length: 20 }, (_, i) => dataForItem(hub, items[i % 3])));
  assert.equal(calls.length, 1, 'twenty screens, five pairs: one call');
  assert.equal(calls[0].host, 'api.frankfurter.dev');
  assert.match(calls[0].path, /^\/v2\/rates\?providers=ECB&base=EUR&from=2026-09-10$/);
  const y = await dataForItem(hub, { kind: 'currency', props: { pairs: P('EUR/HUF'), range: '1y' } });
  assert.equal(calls.length, 2, 'a year, once');
  assert.match(calls[1].path, /from=2025-10-15&group=week$/);
  assert.ok(y.pairs[0].pts.length >= 50 && y.pairs[0].pts.length <= 54, `weekly points: ${y.pairs[0].pts.length}`);
  assert.equal(y.pairs[0].pts.at(-1)[1], Number(FAKE_FX.HUF[0].toPrecision(5)), 'the year ends at the latest rate');
  await dataForItem(hub, { kind: 'currency', props: { pairs: P('USD/JPY'), range: '1y' } });
  assert.equal(calls.length, 2);
  // a few hours later, once each
  step(3 * HOUR);
  await dataForItem(hub, items[0]);
  await settle();
  assert.equal(calls.length, 2, 'inside the interval: from the cache');
  step(1.1 * HOUR);
  await dataForItem(hub, items[0]);
  await dataForItem(hub, items[1]);
  await settle();
  assert.equal(calls.length, 3, 'due: one call behind, whoever asks');
  assert.deepEqual(Object.keys(hub.status()).sort(), ['fx:EUR:month', 'fx:EUR:year']);
});

test('while the day\'s rates are due, every half hour; then a few times a day', async () => {
  // Friday before the ECB publishes
  const { hub, calls, step } = hubWith({ at: '2026-10-16T13:30:00Z' });
  const item = { kind: 'currency', props: { pairs: P('EUR/HUF') } };
  const a = await dataForItem(hub, item);
  assert.equal(a.date, '2026-10-15', 'Thursday\'s rates for now');
  step(31 * MIN);
  await dataForItem(hub, item);
  await settle();
  assert.equal(calls.length, 2, 'asked again after half an hour');
  step(70 * MIN); // 15:11: in now
  await dataForItem(hub, item);
  await settle();
  const b = await dataForItem(hub, item);
  assert.equal(b.date, '2026-10-16');
  const n = calls.length;
  step(2 * HOUR);
  await dataForItem(hub, item);
  await settle();
  assert.equal(calls.length, n, 'in: a few hours before the next call');
});

test('stale while error: the last rates stay with their age, and the source is backed off', async () => {
  const { hub, calls, fail, step } = hubWith();
  const item = { kind: 'currency', props: { pairs: P('EUR/HUF') } };
  const ok = await dataForItem(hub, item);
  fail[DATA_HOSTS.frankfurter] = 503;
  step(4 * HOUR + MIN);
  await dataForItem(hub, item);
  await settle();
  const after = await dataForItem(hub, item);
  assert.equal(after.pairs[0].rate, ok.pairs[0].rate, 'kept');
  assert.equal(after.stale, true);
  assert.equal(after.error, 'bad_response');
  assert.ok(after.age >= 4 * 3600);
  const n = calls.length;
  step(MIN);
  await dataForItem(hub, item);
  await settle();
  assert.equal(calls.length, n, 'backed off');
  // nothing ever read and the source down: no rate, and no "no data" either (it is not the pair's fault)
  const down = hubWith();
  down.fail[DATA_HOSTS.frankfurter] = 500;
  const d = await dataForItem(down.hub, item);
  assert.deepEqual([d.pairs[0].rate, d.pairs[0].noData, d.stale, d.age], [null, undefined, true, null]);
});

test('the picker\'s currencies: the source\'s list, cached a day, a failure said once', async () => {
  const { hub, calls, step, fail } = hubWith();
  const list = await hub.fxCurrencies();
  assert.ok(list.some((c) => c.code === 'HUF' && c.name === 'Hungarian Forint'));
  assert.equal(list.some((c) => c.code === 'HRK'), false);
  await hub.fxCurrencies();
  step(23 * HOUR);
  await hub.fxCurrencies();
  assert.equal(calls.length, 1);
  const off = hubWith();
  off.fail[DATA_HOSTS.frankfurter] = 500;
  await assert.rejects(off.hub.fxCurrencies(), (e) => e instanceof DataError && e.code === 'bad_response');
  void fail;
});

// ---- Bolsa: a symbol with no data -------------------------------------------------------------------------------

test('stocks: an all-zero quote, a 403 and an unknown symbol are "no data" on their row, never a refused key', async () => {
  const forex = (fake) => async (req) => (req.path.includes('OANDA') ? { status: 403, text: '{"error":"You don\'t have access to this resource."}' } : fake(req));
  const { hub } = hubWith({ wrap: forex });
  const d = await dataForItem(hub, { kind: 'stocks', props: { symbols: [{ sym: 'AAPL' }, { sym: 'EURHUF' }, { sym: 'OANDA:EUR_HUF' }] } });
  assert.equal(d.needsKey, undefined, 'the key works');
  assert.equal(d.error, undefined);
  assert.equal(d.stale, false, 'AAPL is fresh: the card is not old because of the others');
  assert.ok(d.quotes[0].price > 0 && !d.quotes[0].noData);
  assert.deepEqual(d.quotes.slice(1).map((q) => [q.sym, q.price, q.noData]), [['EURHUF', null, true], ['OANDA:EUR_HUF', null, true]]);
  // only symbols with no data: nothing to show, nothing old
  const only = await dataForItem(hub, { kind: 'stocks', props: { symbols: [{ sym: 'EURHUF' }] } });
  assert.deepEqual([only.quotes[0].noData, only.stale, only.needsKey], [true, false, undefined]);
  // a refused key is still one
  const bad = hubWith({ key: 'wrongwrongwrong' });
  const k = await dataForItem(bad.hub, { kind: 'stocks', props: { symbols: [{ sym: 'AAPL' }] } });
  assert.deepEqual([k.needsKey, k.error, k.quotes[0].noData], [true, 'key_refused', undefined]);
  // a source that is down: stale, not "no data"
  const down = hubWith();
  down.fail[DATA_HOSTS.finnhub] = 500;
  const x = await dataForItem(down.hub, { kind: 'stocks', props: { symbols: [{ sym: 'AAPL' }] } });
  assert.deepEqual([x.quotes[0].noData, x.stale, x.error], [undefined, true, 'bad_response']);
});

// ---- the kind and the widget -------------------------------------------------------------------------------------

test('the Divisas kind: on both editions, private, a data kind, its pairs validated', () => {
  const k = CANVAS_KINDS.currency;
  assert.equal(k.cat, 'data');
  assert.equal(k.private, true);
  assert.equal(k.edition, 'all');
  assert.ok(CLOUD_CANVAS_KINDS.includes('currency'));
  assert.deepEqual(k.fine, [4, 1], 'one line on the fine grid, like the other data cards');
  assert.deepEqual(canvasDefaults('currency'), { pairs: [{ base: 'EUR', quote: 'USD' }], layout: 'list', range: '30d', chart: 'area', chartStyle: 'below' });
  const c = collector();
  const p = currencyProps(c, 'p', {
    pairs: [{ base: 'eur', quote: 'huf' }, { base: 'EUR', quote: 'HUF' }, { base: 'USD', quote: 'USD' }, { base: 'EURO', quote: 'USD' }, { base: '../', quote: 'x' }, ...P('A/B', 'GBP/EUR', 'USD/MXN', 'CHF/JPY', 'SEK/NOK', 'PLN/CZK')],
    layout: 'grid', range: '5y', chart: 'area', chartStyle: 'background',
  });
  assert.deepEqual(p.pairs.map((x) => `${x.base}/${x.quote}`), ['EUR/HUF'], 'six entries at most, the bad ones out, no repeats');
  assert.equal(p.layout, 'list');
  assert.equal(p.range, '30d');
  assert.equal(p.chartStyle, 'background');
  assert.ok(c.errors.some((e) => e.startsWith('p.pairs: too many')));
  assert.ok(c.errors.some((e) => e.includes('invalid currency code')));
  const full = currencyProps(collector(), 'p', { pairs: P('EUR/HUF', 'GBP/EUR', 'USD/MXN', 'CHF/JPY', 'SEK/NOK', 'PLN/CZK') });
  assert.equal(full.pairs.length, 6);
  // on a screen
  const item = { id: 'cv_curr0001', kind: 'currency', pos: { zone: 'main', x: 0, y: 0, size: 's' }, style: defaultItemStyle(), props: { pairs: P('EUR/HUF') } };
  const cv = sanitizeCanvas(collector(), 'canvas', { ...defaultCanvas(), items: [item] }, {}, { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.equal(cv.items[0].kind, 'currency');
});

test('the Currency widget: a widget type, validated like the card, drawn by the display from this server', () => {
  assert.ok(WIDGET_TYPES.includes('currency'));
  const c = defaultConfig();
  c.widgets = [{ id: 'w_fx000001', type: 'currency', name: 'Cambio', options: { url: 'javascript:alert(1)', currency: { pairs: P('EUR/HUF', 'USD/MXN'), layout: 'big', range: '1y', chart: 'line', chartStyle: 'background' } } }];
  c.screens[0].widgets = [{ widgetId: 'w_fx000001', place: 'corner', corner: 'br', size: 'm' }];
  const v = validateConfig(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const w = v.value.widgets[0];
  assert.deepEqual(w.options, { url: '', refreshSec: 0, fit: 'contain', bust: false, currency: { pairs: P('EUR/HUF', 'USD/MXN'), layout: 'big', range: '1y', chart: 'line', chartStyle: 'background' } }, 'no address of its own');
  const shown = displayWidgets(v.value, v.value.screens[0]);
  assert.equal(shown.length, 1);
  assert.deepEqual([shown[0].type, shown[0].src, shown[0].place], ['currency', '', 'corner']);
  assert.deepEqual(shown[0].currency.pairs, P('EUR/HUF', 'USD/MXN'));
  assert.deepEqual(displayWidgets(v.value, v.value.screens[0], { isPrivate: true }), []);
  // the 'widget' layout (full screen) and a Personalizado card take it too
  const s2 = structuredClone(v.value.screens[0]);
  s2.layout.preset = 'widget';
  s2.layout.widgetId = 'w_fx000001';
  assert.equal(displayWidgets(v.value, s2)[0].place, 'full');
  // no pair, bad codes: refused with their path
  const bad = defaultConfig();
  bad.widgets = [{ id: 'w_fx000002', type: 'currency', name: '', options: { currency: { pairs: [{ base: 'EURO', quote: 'X' }] } } }];
  const r = validateConfig(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'widgets[0].options.currency.pairs'), JSON.stringify(r.errors));
  // a server that does not offer the type says so
  const off = validateConfig(c, { widgetTypes: ['image', 'prices'] });
  assert.ok(off.errors.some((e) => e.path === 'widgets[0].type'));
});

test('currencyQuery: the widget route reads pairs=EUR-HUF,USD-MXN, at most six, and nothing else', () => {
  assert.deepEqual(currencyQuery({ pairs: 'EUR-HUF,usd-mxn', range: '7d', chart: 'none' }), { pairs: P('EUR/HUF', 'USD/MXN'), layout: 'list', range: '7d', chart: 'none', chartStyle: 'below' });
  assert.equal(currencyQuery({ pairs: '../../etc,EUR-EUR' }), null);
  assert.equal(currencyQuery({}), null);
  assert.equal(currencyQuery({ pairs: ['EUR-HUF'] }), null, 'one value only');
  assert.equal(currencyQuery({ pairs: Array.from({ length: 20 }, () => 'EUR-HUF').join(',') }).pairs.length, 1);
  assert.equal(currencyQuery({ pairs: 'EUR-HUF', range: 'x' }).range, '30d');
});

// ---- routes ------------------------------------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const offline = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error(`offline test: ${url}`)));

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-fx-'));
  globalThis.fetch = offline;
  const calls = [];
  setDataFetch(fakeDataCall({ calls }));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'private';
  const main = c.screens[0];
  main.layout.preset = 'canvas';
  const it = (id, kind, x, y, props = {}, extra = {}) => ({ id, kind, pos: { zone: 'main', x, y, size: CANVAS_KINDS[kind].def }, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra });
  main.canvas = {
    ...defaultCanvas(),
    items: [
      it('cv_curr0001', 'currency', 0, 0, { pairs: P('EUR/HUF', 'USD/MXN') }),
      it('cv_curr0002', 'currency', 4, 0, { pairs: P('GBP/EUR') }, { hidden: true }),
    ],
  };
  c.widgets = [{ id: 'w_fx000001', type: 'currency', name: 'Cambio', options: { url: '', refreshSec: 0, fit: 'contain', bust: false, currency: { pairs: P('EUR/USD'), layout: 'list', range: '30d', chart: 'area', chartStyle: 'below' } } }];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  store.initStore(dir);
  _resetDisplays();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetPrivacy?.();
  setServerVersion('0.5.0');
  await ensurePassword();
  syncDisplayKeys();
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = () => {};
  const app = createApp({ version: '0.5.0', dist: path.join(dir, 'dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {} } = {}) => {
    const r = await realFetch(base + url, { method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const key = () => listDisplayLinks().find((l) => l.slug === store.getConfig().screens[0].slug).key;
  const display = (url) => call('GET', url, { headers: { 'x-marco-key': key() } });
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  try {
    await fn({ call, display, login, calls });
  } finally {
    for (const [k, f] of Object.entries(orig)) console[k] = f;
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
    setDataFetch();
  }
}

test('GET /api/display/data and /api/display/currency: the screen\'s own rates, one shared call, nothing while private', async () => {
  await withApp(async ({ call, display, login, calls }) => {
    assert.equal((await call('GET', '/api/display/data')).status, 401, 'a key is needed');
    assert.equal((await call('GET', '/api/display/currency?pairs=EUR-HUF')).status, 401);
    const r = await display('/api/display/data');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.json.items), ['cv_curr0001'], 'the hidden card gets nothing');
    const d = r.json.items.cv_curr0001;
    assert.deepEqual(d.pairs.map((x) => `${x.base}/${x.quote}`), ['EUR/HUF', 'USD/MXN']);
    assert.ok(d.pairs[0].rate > 300);
    // the widget's route: any pairs, from the same entry
    const w = await display('/api/display/currency?pairs=EUR-USD,GBP-EUR&range=7d');
    assert.equal(w.status, 200, w.text);
    assert.equal(w.json.kind, 'currency');
    assert.equal(w.json.range, '7d');
    assert.deepEqual(w.json.pairs.map((x) => x.base + x.quote), ['EURUSD', 'GBPEUR']);
    assert.equal((await display('/api/display/currency?pairs=nope')).status, 400);
    assert.equal(calls.length, 1, 'one call for both');
    assert.equal(/frankfurter|https?:\/\//.test(r.text + w.text), false, 'no source address reaches a screen');
    // private
    const cookie = await login();
    const p = await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: [store.getConfig().screens[0].id] }, headers: { cookie } });
    assert.equal(p.status, 200, p.text);
    assert.equal((await display('/api/display/data')).status, 403);
    assert.equal((await display('/api/display/currency?pairs=EUR-HUF')).status, 403);
  });
});

test('the picker\'s currencies and the builder\'s preview: session only, through the same cache', async () => {
  await withApp(async ({ call, login, calls }) => {
    assert.equal((await call('GET', '/api/admin/data/currency/currencies')).status, 401);
    const cookie = await login();
    const list = await call('GET', '/api/admin/data/currency/currencies', { headers: { cookie } });
    assert.equal(list.status, 200, list.text);
    assert.ok(list.json.currencies.some((c) => c.code === 'MXN'));
    const pv = await call('POST', '/api/admin/data/preview', { headers: { cookie }, body: { items: [{ id: 'cv_new00001', kind: 'currency', props: { pairs: [...P('EUR/HUF'), { base: 'x', quote: '../' }] } }] } });
    assert.equal(pv.status, 200, pv.text);
    assert.deepEqual(pv.json.items.cv_new00001.pairs.map((x) => x.quote), ['HUF']);
    assert.ok(calls.every((c) => c.host === 'api.frankfurter.dev'));
    assert.equal(calls.filter((c) => c.path.startsWith('/v2/currencies')).length, 1);
  });
});

test('display config: the Currency widget reaches the screen with its options and no address', async () => {
  await withApp(async ({ call, display, login }) => {
    const cookie = await login();
    const cfg = (await call('GET', '/api/admin/config', { headers: { cookie } })).json;
    cfg.screens[0].layout.preset = 'agenda';
    cfg.screens[0].widgets = [{ widgetId: 'w_fx000001', place: 'side', corner: 'br', size: 'm' }];
    const put = await call('PUT', '/api/admin/config', { headers: { cookie }, body: cfg });
    assert.equal(put.status, 200, put.text);
    const d = (await display('/api/display/config')).json;
    const w = d.widgets.find((x) => x.id === 'w_fx000001');
    assert.ok(w, JSON.stringify(d.widgets));
    assert.deepEqual([w.type, w.place, w.src], ['currency', 'side', '']);
    assert.deepEqual(w.currency.pairs, P('EUR/USD'));
  });
});
