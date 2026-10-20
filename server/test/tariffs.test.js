// Grid tariffs and time bands for the price widget: DataHub records (trimmed real answers, 2026-10), the tariff of
// every Danish grid company hour by hour (a snapshot checked against a second public source), the tester's DK2
// numbers for 2026-10-13 (Radius C with Altid Energi, which adds no margin), DST
// days, season changes, records carried forward, Spain 2.0TD bands with weekends and holidays, the price math, the
// config validation, the cache and the routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { hourly, localHM, localMidnight, pricedSlots, parseSource } from '../core/pricesCore.js';
import {
  bandIndexAt, bandPriceAt, chargeAt, datahubRequests, DK_GRID_COMPANIES, emptyBands, ENERGINET_GLN, gridCompany, gridHours, isHoliday,
  parseDatahub, presetBands, priceParts, tariffAdder, tariffMode, TariffParseError,
} from '../core/tariffsCore.js';
import { getPrices, setPricesFetch } from '../prices.js';
import { getGridTariffs } from '../tariffs.js';
import { fakePricesFetch } from '../core/pricesFake.js';
import { loadFakeFixtures } from '../pricesFixtures.js';
import { validateConfig } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { displayWidgets } from '../core/screens.js';
import * as store from '../store.js';
import { sessionMiddleware, csrfGuard, ensurePassword, loginHandler, hashPassword } from '../auth.js';
import { adminRouter } from '../routes/admin.js';
import { publicRouter } from '../routes/public.js';
import { fixture } from './helpers.js';

loadFakeFixtures();
const fx = (name) => fixture(`tariffs/${name}`);
const CPH = 'Europe/Copenhagen';
const records = parseDatahub(fx('datahub-households-2026-10.json'));
const energinet = records.filter((r) => r.gln === ENERGINET_GLN);
const day = (iso, tz = CPH) => localMidnight(Date.parse(`${iso}T12:00:00Z`), tz);
const hoursOf = (company, iso) => {
  const from = day(iso);
  return gridHours(company, records, energinet, from, localMidnight(from + 12 * 3600_000, CPH, 1));
};

// ------------------------------------------------------------------------------------------- DataHub

test('DataHub records: tariffs only, codes trimmed, daily prices, open ends, bad answers refused', () => {
  assert.ok(records.length > 150);
  assert.ok(records.every((r) => r.code === r.code.trim()));
  // the stale Elektrus record had leading spaces
  assert.ok(records.some((r) => r.code === '6000091' && r.from === Date.parse('2018-10-01T00:00:00Z')));
  const tax = records.find((r) => r.code === 'EA-001' && r.from === Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(tax.daily, true);
  assert.deepEqual(tax.prices, [0.008]);
  const open = parseDatahub({ records: [{ GLN_Number: '1', ChargeType: 'D03', ChargeTypeCode: 'X', ValidFrom: '2026-01-01T00:00:00', ValidTo: null, ResolutionDuration: 'P1D', Price1: 0.5 }] });
  assert.equal(open[0].to, Infinity);
  // subscriptions (D01) and nonsense prices are left out, an unknown resolution is kept as unknown
  assert.deepEqual(parseDatahub({ records: [
    { GLN_Number: '1', ChargeType: 'D01', ChargeTypeCode: 'X', ValidFrom: '2026-01-01T00:00:00', ValidTo: null, Price1: 3 },
    { GLN_Number: '1', ChargeType: 'D03', ChargeTypeCode: 'X', ValidFrom: '2026-01-01T00:00:00', ValidTo: null, ResolutionDuration: 'PT15M', Price1: 3 },
    { GLN_Number: '1', ChargeType: 'D03', ChargeTypeCode: 'X', ValidFrom: '2026-01-01T00:00:00', ValidTo: null, ResolutionDuration: 'P1D', Price1: 900 },
  ] }).map((r) => r.unknown), [true]);
  assert.throws(() => parseDatahub('<html>'), TariffParseError);
  assert.throws(() => parseDatahub('{"nope":1}'), TariffParseError);
  // the real answer to the per-company query reads the same
  const q = parseDatahub(fx('datahub-radius-energinet-query.json'));
  assert.equal(q.length, 12);
});

test('requests: one per tariff code, ValidFrom before the day after tomorrow, never a start date', () => {
  const now = Date.parse('2026-10-13T15:00:00+02:00');
  const r = datahubRequests('cerius', now);
  assert.equal(r.company.length, 2);
  const u = new URL(r.company[0].url);
  assert.equal(u.searchParams.get('end'), '2026-10-16');
  assert.equal(u.searchParams.get('start'), null);
  assert.deepEqual(JSON.parse(u.searchParams.get('filter')), { GLN_Number: ['5790000705184'], ChargeTypeCode: ['30TR_C_ET'] });
  assert.equal(u.searchParams.get('sort'), 'ValidFrom desc');
  assert.deepEqual(JSON.parse(new URL(r.energinet.url).searchParams.get('filter')).ChargeTypeCode, ['40000', '41000', 'EA-001']);
});

test('every grid company: its household tariff hour by hour (2026-10-13)', () => {
  const snap = JSON.parse(fx('household-tariffs-2026-10-13.json')).companies;
  assert.equal(DK_GRID_COMPANIES.length, 35);
  for (const c of DK_GRID_COMPANIES) {
    const ours = hoursOf(c, '2026-10-13');
    const theirs = snap[c.id];
    assert.ok(theirs, c.id);
    assert.equal(ours.length, 24, c.id);
    ours.forEach((h, i) => assert.ok(Math.abs(h.grid - theirs[i]) < 1e-6, `${c.id} ${i}: ${h.grid} vs ${theirs[i]}`));
    assert.ok(ours.every((h) => !h.est), c.id);
  }
});

test('DK2, Radius C: the tester\'s 2,78 / 2,92 / 2,99 / 1,52 kr, VAT 25 %', () => {
  const zone = 'DK2';
  const slots = parseSource('eds', fx('dayahead-dk2-2026-10-13.json'), zone);
  assert.equal(slots.length, 96);
  const g = hoursOf('radius', '2026-10-13').map((h) => [h.t / 1000, h.grid, h.net, h.tax, 0]);
  const o = { zone, tariff: 'grid', grid: 'radius' };
  const add = tariffAdder(o, { gridList: g, tz: CPH, currency: 'DKK' });
  const hours = hourly(pricedSlots(slots, { currency: 'DKK', surcharge: 0, vat: 25, add }));
  const at = (hm) => hours.find((h) => localHM(h.t, CPH) === hm).p;
  const tester = { '08:00': '2.78', '17:00': '2.92', '18:00': '2.99', '23:00': '1.52' };
  for (const [hm, v] of Object.entries(tester)) assert.equal(at(hm).toFixed(2), v, hm);
  assert.equal(hours.length, 24);
  assert.equal(at('17:00').toFixed(4), '2.9233');
  // the parts of 17:00: market, grid, Energinet, tax, then VAT on the whole
  const p = priceParts(1.2601, { grid: 0.955573, net: 0.115, tax: 0.008, vat: 25 });
  assert.equal(p.total.toFixed(3), '2.923');
  assert.equal((p.vat / (p.total - p.vat)).toFixed(2), '0.25');
});

test('DST: the autumn day has 25 hours and both 02:00 take Price3; the spring day skips it', () => {
  const fall = hoursOf('radius', '2026-10-25');
  assert.equal(fall.length, 25);
  const labels = fall.map((h) => localHM(h.t, CPH));
  assert.deepEqual(labels.slice(0, 5), ['00:00', '01:00', '02:00', '02:00', '03:00']);
  assert.equal(fall[2].grid, fall[3].grid);
  const spring = hoursOf('radius', '2027-03-28');
  assert.equal(spring.length, 23);
  assert.ok(!spring.some((h) => localHM(h.t, CPH) === '02:00'));
  // the evening peak is still at 17:00 local on both days
  const peak = (list) => localHM(list.reduce((a, h) => (h.grid > a.grid ? h : a)).t, CPH);
  assert.equal(peak(fall), '17:00');
  assert.equal(peak(spring), '17:00');
});

test('season changes: resolved per hour, so tomorrow can differ from today; N1 changes on the DST Sunday', () => {
  const sep30 = hoursOf('radius', '2026-09-30');
  const oct1 = hoursOf('radius', '2026-10-01');
  // the winter peak is more than twice the summer one
  const peak = (l) => Math.max(...l.map((h) => h.grid));
  assert.ok(peak(oct1) > 2 * peak(sep30));
  // one fetch window across midnight: the hours after it take the new season
  const from = day('2026-09-30') + 20 * 3600_000;
  const across = gridHours('radius', records, energinet, from, from + 6 * 3600_000);
  assert.equal(across[1].grid, sep30[21].grid);
  assert.equal(across[5].grid, oct1[1].grid);
  assert.notEqual(across[1].grid, across[5].grid);
  const n1Before = hoursOf('n1-131', '2027-03-27');
  const n1Day = hoursOf('n1-131', '2027-03-28');
  const n1After = hoursOf('n1-131', '2027-03-29');
  assert.equal(n1Day.length, 23);
  assert.ok(n1Before.every((h) => h.grid != null) && n1After.every((h) => h.grid != null));
  // the record from 29 March on is another one (its hours differ from the winter record's)
  assert.notDeepEqual(n1After.map((h) => h.grid), n1Before.map((h) => h.grid));
});

test('the latest record wins where two overlap; past the last published one it is carried forward, marked estimated', () => {
  // Elektrus: a stale record from 2018 runs to 2026-11-30 under the new ones
  const at = Date.parse('2026-10-13T17:00:00Z');
  const v = chargeAt(records, '5790000836239', '6000091', at);
  const stale = records.find((r) => r.code === '6000091' && r.from === Date.parse('2018-10-01T00:00:00Z'));
  assert.notEqual(v.value, stale.prices[17]);
  // most companies have published until New Year only
  const jan = hoursOf('dinel', '2027-01-05');
  assert.equal(jan.length, 24);
  assert.ok(jan.every((h) => h.est && h.grid != null));
  assert.deepEqual(jan.map((h) => h.grid), hoursOf('dinel', '2026-12-31').map((h) => h.grid));
  // Energinet's 2027 tariffs are published: not estimated
  assert.equal(hoursOf('radius', '2027-01-05').some((h) => h.est), false);
  assert.equal(hoursOf('radius', '2027-01-05')[0].net.toFixed(3), '0.105');
  // nothing known at all: null, never a made-up zero
  assert.equal(gridHours('radius', [], [], at, at + 3600_000)[0].grid, null);
});

test('carried forward for 31 days at most, never an ended discount; any unknown part leaves the hour out', () => {
  const rec = (code, from, to, price) => ({ gln: 'G', code, from: Date.parse(`${from}T00:00:00Z`), to: to ? Date.parse(`${to}T00:00:00Z`) : Infinity, daily: true, prices: [price] });
  const list = [rec('MAIN', '2026-01-01', '2027-01-01', 0.5), rec('DISC', '2026-01-01', '2027-01-01', -0.1)];
  const at = (iso) => Date.parse(`${iso}T17:00:00Z`);
  assert.deepEqual(chargeAt(list, 'G', 'MAIN', at('2026-12-31')), { value: 0.5, estimated: false });
  assert.deepEqual(chargeAt(list, 'G', 'MAIN', at('2027-01-20')), { value: 0.5, estimated: true });
  // an ended discount is not assumed to go on
  assert.deepEqual(chargeAt(list, 'G', 'DISC', at('2027-01-20')), { value: 0, estimated: true });
  // more than 31 days past the end: unknown
  assert.equal(chargeAt(list, 'G', 'MAIN', at('2027-02-05')), null);
  // a resolution Marco cannot read covers the hours it is in force: unknown, not the older record
  const q = parseDatahub({ records: [{ GLN_Number: 'G', ChargeType: 'D03', ChargeTypeCode: 'MAIN', ValidFrom: '2026-11-01T00:00:00', ValidTo: null, ResolutionDuration: 'PT15M', Price1: 0.4 }] });
  assert.equal(q[0].unknown, true);
  assert.equal(chargeAt([...list, ...q], 'G', 'MAIN', at('2026-11-02')), null);
  assert.equal(chargeAt([...list, ...q], 'G', 'MAIN', at('2026-10-31')).value, 0.5);
  // one of a company's codes unknown: no company tariff that hour (Cerius: 30TR_C_ET + 30RE_C_ET)
  const t = day('2026-10-13') + 17 * 3600_000;
  const noRe = records.filter((r) => r.code !== '30RE_C_ET');
  assert.equal(gridHours('cerius', noRe, energinet, t, t + 3600_000)[0].grid, null);
  assert.notEqual(gridHours('cerius', records, energinet, t, t + 3600_000)[0].grid, null);
  // one of Energinet's charges unknown: no net and no tax, never a zero
  const noTax = energinet.filter((r) => r.code !== 'EA-001');
  const h = gridHours('radius', records, noTax, t, t + 3600_000)[0];
  assert.equal(h.net, null);
  assert.equal(h.tax, null);
  assert.ok(h.grid > 0);
});

// ------------------------------------------------------------------------------------------- time bands

test('Spain 2.0TD: punta, llano and valle by the hour; weekends and national holidays all valle', () => {
  const MAD = 'Europe/Madrid';
  const b = { ...presetBands('es-20td'), list: [{ name: 'Punta', price: 0.1 }, { name: 'Llano', price: 0.05 }, { name: 'Valle', price: 0.01 }] };
  const at = (iso) => bandIndexAt(b, Date.parse(iso), MAD);
  // Tuesday 13 October 2026
  assert.equal(at('2026-10-13T07:59:00+02:00'), 2);
  assert.equal(at('2026-10-13T08:00:00+02:00'), 1);
  assert.equal(at('2026-10-13T10:00:00+02:00'), 0);
  assert.equal(at('2026-10-13T14:30:00+02:00'), 1);
  assert.equal(at('2026-10-13T18:00:00+02:00'), 0);
  assert.equal(at('2026-10-13T21:59:00+02:00'), 0);
  assert.equal(at('2026-10-13T22:00:00+02:00'), 1);
  assert.equal(at('2026-10-13T23:59:00+02:00'), 1);
  // Saturday, Sunday, 12 October (a Monday) and 8 December: valle all day
  for (const iso of ['2026-10-17T11:00:00+02:00', '2026-10-18T19:00:00+02:00', '2026-10-12T11:00:00+02:00', '2026-12-08T19:00:00+01:00', '2027-01-06T12:00:00+01:00']) assert.equal(at(iso), 2, iso);
  // Good Friday has no fixed date: a working day for the tolls
  assert.equal(at('2027-03-26T11:00:00+01:00'), 0);
  assert.equal(isHoliday('ES', 12, 25), true);
  assert.equal(isHoliday('ES', 3, 19), false);
  assert.equal(isHoliday('none', 12, 25), false);
  assert.equal(bandPriceAt(b, Date.parse('2026-10-13T19:00:00+02:00'), MAD), 0.1);
  // the household's own time zone: 10:30 in the Canaries is punta there
  assert.equal(bandIndexAt(b, Date.parse('2026-10-13T10:30:00+01:00'), 'Atlantic/Canary'), 0);
  // Ceuta and Melilla: one hour later
  const cm = presetBands('es-20td-cm');
  assert.equal(bandIndexAt(cm, Date.parse('2026-10-13T10:30:00+02:00'), MAD), 1);
  assert.equal(bandIndexAt(cm, Date.parse('2026-10-13T22:30:00+02:00'), MAD), 0);
});

test('custom bands: weekday hours every day unless weekend hours are set; a preset keeps the prices typed', () => {
  const b = emptyBands();
  b.list.push({ name: 'Night', price: -0.02 });
  for (let h = 0; h < 6; h++) b.weekday[h] = 1;
  assert.equal(bandIndexAt(b, Date.parse('2026-10-18T03:00:00Z'), 'UTC'), 1);
  b.weekend = new Array(24).fill(0);
  assert.equal(bandIndexAt(b, Date.parse('2026-10-18T03:00:00Z'), 'UTC'), 0);
  const kept = presetBands('es-20td', { ...b, list: [{ name: 'a', price: 0.2 }, { name: 'b', price: 0.1 }] });
  assert.deepEqual(kept.list.map((x) => x.price), [0.2, 0.1, 0]);
  assert.deepEqual(kept.list.map((x) => x.name), ['Punta', 'Llano', 'Valle']);
  // the bands add before VAT: (market 0.1 + band + extra 0.02) * 1.21
  const add = tariffAdder({ zone: 'ES', tariff: 'bands', bands: { ...presetBands('es-20td'), list: [{ name: 'P', price: 0.1 }, { name: 'L', price: 0.05 }, { name: 'V', price: 0.01 }] } }, { tz: 'Europe/Madrid' });
  const [s] = pricedSlots([{ t: Date.parse('2026-10-13T19:00:00+02:00'), m: 60, eur: 100 }], { surcharge: 0.02, vat: 21, add });
  assert.equal(s.p.toFixed(4), ((0.1 + 0.1 + 0.02) * 1.21).toFixed(4));
});

test('tariff mode: grid only with a company of the zone, no bands on PVPC; Danish tariffs in euros at the peg', () => {
  assert.equal(tariffMode({ zone: 'DK2', tariff: 'grid', grid: 'radius' }), 'grid');
  assert.equal(tariffMode({ zone: 'DK1', tariff: 'grid', grid: 'radius' }), 'none');
  assert.equal(tariffMode({ zone: 'ES-PVPC', tariff: 'bands', bands: presetBands('es-20td') }), 'none');
  assert.equal(tariffMode({ zone: 'ES', tariff: 'bands', bands: presetBands('es-20td') }), 'bands');
  assert.equal(tariffMode({ zone: 'DE-LU' }), 'none');
  const t = Date.parse('2026-10-13T15:00:00Z');
  const add = tariffAdder({ zone: 'DK2', tariff: 'grid', grid: 'radius' }, { gridList: [[t / 1000, 0.7460, 0.1, 0.008, 1]], tz: CPH, currency: 'EUR', dkkPerEur: 7.46 });
  const a = add(t + 15 * 60_000);
  assert.equal(a.grid.toFixed(3), '0.100');
  assert.equal(a.est, true);
  assert.equal(add(t + 3600_000), null);
  assert.equal(tariffAdder({ zone: 'DK2', tariff: 'grid', grid: 'radius' }, { gridList: [], tz: CPH }), null);
  assert.equal(gridCompany('cerius').codes[0], '30TR_C_ET');
});

// ------------------------------------------------------------------------------------------- config

const priceWidget = (prices = {}) => ({ id: 'w_luz', type: 'prices', name: 'Luz', options: { prices: { zone: 'DK2', ...prices } } });
function withWidget(w) {
  const c = defaultConfig();
  c.widgets = [w];
  c.screens[0].widgets = [{ widgetId: w.id, place: 'side', corner: 'br', size: 'm' }];
  return c;
}

test('validate: grid company of the zone, bands with 1 to 4 prices and 24 hours, the next 24 h view', () => {
  const ok = validateConfig(withWidget(priceWidget({ view: 'next', tariff: 'grid', grid: 'radius', vat: 25 })));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.value.widgets[0].options.prices.grid, 'radius');
  assert.equal(ok.value.widgets[0].options.prices.view, 'next');
  const wrongZone = validateConfig(withWidget(priceWidget({ zone: 'DK1', tariff: 'grid', grid: 'radius' })));
  assert.ok(wrongZone.errors.some((e) => e.path === 'widgets[0].options.prices.grid'));
  assert.ok(validateConfig(withWidget(priceWidget({ tariff: 'grid' }))).errors.some((e) => e.message === 'grid company required'));
  assert.ok(validateConfig(withWidget(priceWidget({ grid: 'nope' }))).errors.some((e) => e.path === 'widgets[0].options.prices.grid'));
  const bands = { ...presetBands('es-20td'), list: [{ name: 'Punta', price: 0.123456789 }, { name: 'Llano', price: 0.05 }, { name: 'Valle', price: 0 }] };
  const es = validateConfig(withWidget(priceWidget({ zone: 'ES', tariff: 'bands', bands })));
  assert.equal(es.ok, true, JSON.stringify(es.errors));
  assert.equal(es.value.widgets[0].options.prices.bands.list[0].price, 0.12346);
  assert.equal(es.value.widgets[0].options.prices.bands.holidays, 'ES');
  const bad = validateConfig(withWidget(priceWidget({ zone: 'ES', tariff: 'bands', bands: { ...bands, weekday: [0, 1, 7], list: [...bands.list, ...bands.list] } })));
  const paths = bad.errors.map((e) => e.path);
  assert.ok(paths.includes('widgets[0].options.prices.bands.list'));
  assert.ok(paths.includes('widgets[0].options.prices.bands.weekday'));
  assert.ok(validateConfig(withWidget(priceWidget({ tariff: 'bands' }))).errors.some((e) => e.message === 'time bands required'));
  // an old widget (0.10.0) reads as no tariff
  const old = validateConfig(withWidget(priceWidget()));
  assert.equal(old.value.widgets[0].options.prices.tariff, 'none');
  assert.equal(old.value.widgets[0].options.prices.bands, undefined);
});

test('display projection: the version changes with the grid company, not with the bands', () => {
  const c = validateConfig(withWidget(priceWidget())).value;
  const v0 = displayWidgets(c, c.screens[0])[0].v;
  const c2 = structuredClone(c);
  Object.assign(c2.widgets[0].options.prices, { tariff: 'grid', grid: 'radius' });
  const v1 = displayWidgets(c2, c2.screens[0])[0].v;
  assert.notEqual(v1, v0);
  assert.equal(displayWidgets(c2, c2.screens[0])[0].prices.grid, 'radius');
  const c3 = structuredClone(c);
  Object.assign(c3.widgets[0].options.prices, { tariff: 'bands', bands: presetBands('es-20td') });
  assert.equal(displayWidgets(c3, c3.screens[0])[0].v, v0);
});

// ------------------------------------------------------------------------------------------- cache and routes

test('cache: one DataHub call per code and one for Energinet, shared; a failure keeps the last records', async () => {
  let now = Date.parse('2026-10-13T15:00:00+02:00');
  const fake = fakePricesFetch('1', () => now);
  const calls = [];
  let down = false;
  setPricesFetch(async (url) => {
    if (url.includes('DatahubPricelist')) {
      calls.push(url);
      if (down) return { status: 503, headers: { get: () => null }, text: async () => 'down' };
    }
    return fake(url);
  }, () => now);
  try {
    const a = await getGridTariffs('cerius', 'DK2');
    assert.equal(a.error, null);
    assert.equal(a.credit, 'Energinet DataHub');
    assert.equal(calls.length, 3);
    // the fetch window: today and tomorrow, with the zone's margin
    assert.ok(a.hours.length >= 48);
    const first = a.hours.find(([t]) => localHM(t * 1000, CPH) === '17:00');
    assert.equal(first[1].toFixed(4), '1.0380');
    await getGridTariffs('cerius', 'DK2');
    assert.equal(calls.length, 3);
    // a day later the source is down: the records are kept
    now += 13 * 3600_000;
    down = true;
    const b = await getGridTariffs('cerius', 'DK2');
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(b.hours.length >= 48);
    const c = await getGridTariffs('cerius', 'DK2');
    assert.equal(c.error, null);
    // a company never fetched answers its error and no hours
    const d = await getGridTariffs('radius', 'DK2');
    assert.deepEqual(d.hours, []);
    assert.equal(d.error, 'http_error');
  } finally {
    setPricesFetch(null);
  }
});

test('cache: without Energinet\'s charges no hours at all; a slow first fetch answers pending; the test click waits a minute between tries', async () => {
  let now = Date.parse('2026-10-13T15:00:00+02:00');
  const fake = fakePricesFetch('1', () => now);
  let enDown = true;
  let slow = 0;
  const calls = [];
  setPricesFetch(async (url) => {
    if (url.includes('DatahubPricelist')) {
      calls.push(url);
      if (slow) await new Promise((r) => setTimeout(r, slow));
      if (enDown && url.includes(ENERGINET_GLN)) return { status: 503, headers: { get: () => null }, text: async () => 'down' };
    }
    return fake(url);
  }, () => now);
  try {
    const a = await getGridTariffs('radius', 'DK2');
    assert.deepEqual(a.hours, []);
    assert.equal(a.error, 'http_error');
    // the admin's test: no new try within a minute of the last one, although nothing ever loaded
    const n = calls.length;
    await getGridTariffs('radius', 'DK2', { force: true });
    await getGridTariffs('radius', 'DK2', { force: true });
    assert.equal(calls.length, n);
    now += 61_000;
    enDown = false;
    const b = await getGridTariffs('radius', 'DK2', { force: true });
    assert.equal(b.error, null);
    assert.ok(b.hours.length >= 48);
    // a company never fetched, its source slow: pending at once, the hours on the next ask
    slow = 80;
    const c = await getGridTariffs('cerius', 'DK2', { wait: 10 });
    assert.equal(c.error, 'pending');
    assert.deepEqual(c.hours, []);
    await new Promise((r) => setTimeout(r, 400));
    const d = await getGridTariffs('cerius', 'DK2', { wait: 10 });
    assert.equal(d.error, null);
    assert.ok(d.hours.length >= 48);
  } finally {
    setPricesFetch(null);
  }
});

test('routes: &grid= on the display prices, refused for another zone; the admin test with the breakdown data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-tariffs-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret123'), passwordIsDefault: false }));
  store.initStore(dir);
  await ensurePassword();
  const now = Date.parse('2026-10-13T15:00:00+02:00');
  setPricesFetch(fakePricesFetch('1', () => now), () => now);
  const app = express();
  app.use(sessionMiddleware());
  app.use(express.json());
  app.use(['/api/admin', '/api/auth'], csrfGuard());
  app.post('/api/auth/login', (req, res, next) => loginHandler(req, res).catch(next));
  app.use('/api/admin', adminRouter());
  app.use('/api', publicRouter({ version: 'test' }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((x) => x.split(';')[0]).join('; ');
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    const d = await call('GET', '/api/display/prices?zone=DK2&grid=radius');
    assert.equal(d.status, 200);
    assert.equal(d.json.grid.id, 'radius');
    assert.ok(d.json.grid.hours.length >= 48);
    // the real DK2 prices of the day (fixture) plus the tariff: the tester's 17:00
    const slots = d.json.slots.map(([t, m, eur, loc]) => ({ t: t * 1000, m, eur, loc }));
    const add = tariffAdder({ zone: 'DK2', tariff: 'grid', grid: 'radius' }, { gridList: d.json.grid.hours, tz: CPH, currency: 'DKK' });
    const h = hourly(pricedSlots(slots, { currency: 'DKK', vat: 25, add })).find((x) => x.t === Date.parse('2026-10-13T17:00:00+02:00'));
    assert.equal(h.p.toFixed(2), '2.92');
    assert.equal((await call('GET', '/api/display/prices?zone=DK1&grid=radius')).status, 400);
    assert.equal((await call('GET', '/api/display/prices?zone=DK2')).json.grid, undefined);
    assert.equal((await call('POST', '/api/auth/login', { password: 'secret123' })).status, 200);
    const t = await call('POST', '/api/admin/test/prices', { zone: 'DK2', grid: 'cerius' });
    assert.equal(t.json.ok, true);
    assert.equal(t.json.grid.id, 'cerius');
    assert.deepEqual((await call('POST', '/api/admin/test/prices', { zone: 'DE-LU', grid: 'cerius' })).json, { ok: false, error: 'invalid_grid' });
    // prices of a zone without a grid still answer
    assert.equal((await getPrices('DK1')).zone, 'DK1');
  } finally {
    server.close();
    setPricesFetch(null);
  }
});

test('display and admin wiring: next 24 h view in every look, strings in every language, no em dashes', () => {
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const prices = read('web/display/widgets/prices.ts');
  assert.match(prices, /&grid=\$\{encodeURIComponent\(grid\)\}/);
  assert.match(prices, /private nextList\(/);
  assert.doesNotMatch(prices, /DatahubPricelist|energidataservice/);
  const css = read('web/display/styles.css');
  for (const k of ['.pw-nx {', '.pw-row {', '.pw-badge {', '.pw-nx-stats {', ".theme-light .pw:not(.pw--side) {\n  --pw-track"]) assert.ok(css.includes(k), k);
  const modern = read('web/display/styles-modern.css');
  assert.match(modern, /\.style-modern \.pw-stat \{/);
  assert.match(modern, /#app\.is-kids \.pw-stat/);
  const i18n = read('web/shared/i18n.ts');
  for (const k of ['priceNowIs', 'priceLowest', 'priceAverage', 'priceHighest', 'priceNextHours', 'priceInclGrid', 'priceInclGridEst', 'priceInclBands', 'priceNoGrid']) {
    assert.equal(i18n.split(`  ${k}: '`).length, 7, k);
  }
  for (const f of ['server/core/tariffsCore.js', 'server/tariffs.js', 'web/admin/sections/PriceTariff.tsx', 'web/admin/sections/PriceWidget.tsx', 'web/admin/i18n-dict-prices.ts', 'web/display/widgets/prices.ts']) {
    assert.doesNotMatch(read(f), /—/, `no em dashes in ${f}`);
  }
});
