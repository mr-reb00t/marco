// Electricity prices: the source parsers (fixtures saved from real answers, trimmed; the ENTSO-E one is made up in
// the documented shape), DST days, 15-minute to hourly averages, the price math, the refresh plan, the cache with its
// fallbacks and rate limits, the config validation, the display projection and the admin routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  parseSource, normalizeSlots, hourly, pricedSlots, finalPrice, cheapestWindows, levelLimits, levelOf, trend, priceUnit, withLocal,
  zoneSources, sourceRequests, fetchWindow, nextRefreshAt, localMidnight, localHM, retryAfterMs, failureBackoff, PRICE_ZONES, priceZone,
  zoneForTimeZone, DKK_PER_EUR, PriceParseError, priceLabelPicks, axisStep, PRICE_AXES, PRICE_SHAPES,
} from '../core/pricesCore.js';
import { mergeImport } from '../core/backupsCore.js';
import { getPrices, setPricesFetch, testPrices, PricesError } from '../prices.js';
import { fakePricesFetch } from '../core/pricesFake.js';
import { validateConfig } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { displayWidgets } from '../core/screens.js';
import * as store from '../store.js';
import { sessionMiddleware, csrfGuard, ensurePassword, loginHandler, hashPassword } from '../auth.js';
import { adminRouter } from '../routes/admin.js';
import { publicRouter } from '../routes/public.js';
import { fixture } from './helpers.js';

const fx = (name) => fixture(`prices/${name}`);
const iso = (ms) => new Date(ms).toISOString();
const unique = (slots) => new Set(slots.map((s) => s.t)).size === slots.length;
/** Lets background refreshes (fake sources, no gaps) finish. */
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
};

// ------------------------------------------------------------------------------------------- parsers

test('Energi Data Service: UTC times, 15 minutes, euros and kroner', () => {
  const s = parseSource('eds', fx('eds_dk2.json'), 'DK2');
  assert.equal(s.length, 12);
  assert.equal(iso(s[0].t), '2026-10-11T22:00:00.000Z');
  assert.equal(s[0].m, 15);
  assert.equal(s[0].eur, 176.720001);
  assert.equal(s[0].loc, 1320.999679);
  // Sweden has no kroner from this source: euros only
  assert.equal(parseSource('eds', fx('eds_dk2.json'), 'SE3')[0].loc, undefined);
  assert.throws(() => parseSource('eds', '{"nope":1}', 'DK2'), PriceParseError);
  assert.throws(() => parseSource('eds', '<html>', 'DK2'), PriceParseError);
});

test('DST: the autumn day has 100 quarter hours (25 hours), the spring day 92 (23 hours), keyed on UTC', () => {
  const fall = parseSource('eds', fx('eds_dk2_dst_fall_2025-10-26.json'), 'DK2');
  assert.equal(fall.length, 100);
  assert.ok(unique(fall));
  assert.equal(iso(fall[0].t), '2025-10-25T22:00:00.000Z');
  const hFall = hourly(pricedSlots(fall));
  assert.equal(hFall.length, 25);
  // local labels: 02:00 twice
  const labels = hFall.map((h) => localHM(h.t, 'Europe/Copenhagen'));
  assert.deepEqual(labels.slice(0, 5), ['00:00', '01:00', '02:00', '02:00', '03:00']);
  const spring = parseSource('eds', fx('eds_dk2_dst_spring_2026-03-29.json'), 'DK2');
  assert.equal(spring.length, 92);
  const hSpring = hourly(pricedSlots(spring));
  assert.equal(hSpring.length, 23);
  assert.deepEqual(hSpring.slice(0, 3).map((h) => localHM(h.t, 'Europe/Copenhagen')), ['00:00', '01:00', '03:00']);
  // local midnights around the change
  assert.equal(localMidnight(Date.parse('2025-10-26T12:00Z'), 'Europe/Copenhagen', 1) - localMidnight(Date.parse('2025-10-26T12:00Z'), 'Europe/Copenhagen'), 25 * 3600_000);
  assert.equal(localMidnight(Date.parse('2026-03-29T12:00Z'), 'Europe/Copenhagen', 1) - localMidnight(Date.parse('2026-03-29T12:00Z'), 'Europe/Copenhagen'), 23 * 3600_000);
});

test('Energy-Charts, aWATTar (hourly) and spot-hinta.fi (EUR/kWh)', () => {
  const ec = parseSource('energycharts', fx('energycharts_dk2.json'), 'DK2');
  assert.equal(ec.length, 8);
  assert.equal(ec[0].m, 15);
  assert.equal(ec[0].eur, 176.72);
  const aw = parseSource('awattar', fx('awattar_de.json'), 'DE-LU');
  assert.equal(aw.length, 6);
  assert.ok(aw.every((s) => s.m === 60));
  assert.equal(aw[0].eur, 177.03);
  assert.equal(parseSource('awattar', fx('awattar_at.json'), 'AT').length, 6);
  const sh = parseSource('spothinta', fx('spothinta_fi.json'), 'FI');
  assert.equal(iso(sh[0].t), '2026-10-11T21:00:00.000Z');
  assert.ok(Math.abs(sh[0].eur - 39.24) < 1e-9);
});

test('Elering: one answer for four zones; the autumn day in Helsinki has 100 quarter hours', () => {
  const fi = parseSource('elering', fx('elering.json'), 'FI');
  const ee = parseSource('elering', fx('elering.json'), 'EE');
  assert.equal(fi.length, 6);
  assert.equal(ee[0].eur, 39.25);
  assert.equal(fi[0].eur, 39.24);
  const fall = parseSource('elering', fx('elering_fi_dst_fall_2025-10-26.json'), 'FI');
  assert.equal(fall.length, 100);
  assert.equal(iso(fall[0].t), '2025-10-25T21:00:00.000Z');
  assert.equal(hourly(pricedSlots(fall)).length, 25);
  assert.throws(() => parseSource('elering', fx('elering.json'), 'DK2'), PriceParseError);
});

test('Red Eléctrica: spot (15 min) and PVPC (hourly) from one answer, offsets kept on DST days', () => {
  const spot = parseSource('ree', fx('ree_es_trim.json'), 'ES');
  const pvpc = parseSource('ree', fx('ree_es_trim.json'), 'ES-PVPC');
  assert.equal(spot[0].m, 15);
  assert.equal(spot[0].eur, 216.54);
  assert.equal(pvpc[0].m, 60);
  assert.equal(pvpc[0].eur, 221.08);
  assert.equal(iso(pvpc[0].t), '2026-10-11T22:00:00.000Z');
  const fallSpot = parseSource('ree', fx('ree_es_dst_fall_2025-10-26.json'), 'ES');
  const fallPvpc = parseSource('ree', fx('ree_es_dst_fall_2025-10-26.json'), 'ES-PVPC');
  assert.equal(fallSpot.length, 100);
  assert.equal(fallPvpc.length, 25);
  assert.ok(unique(fallPvpc));
});

test('OMIE: periods from local midnight in Madrid, the PT or ES column', () => {
  const pt = parseSource('omie', fx('omie_marginalpdbc_trim.txt'), 'PT');
  assert.equal(iso(pt[0].t), '2026-10-11T22:00:00.000Z');
  assert.equal(pt[0].m, 15);
  assert.equal(pt[0].eur, 216.54);
  const fall = parseSource('omie', fx('omie_marginalpdbc_dst_fall_2025-10-26.txt'), 'ES');
  assert.equal(fall.length, 100);
  assert.equal(iso(fall[0].t), '2025-10-25T22:00:00.000Z');
  assert.equal(iso(fall[99].t), '2025-10-26T22:45:00.000Z');
  assert.throws(() => parseSource('omie', 'Not found', 'ES'), PriceParseError);
});

test('ENTSO-E: A03 curves fill the positions left out, mixed resolutions, "no data" is empty', () => {
  const s = parseSource('entsoe', fx('entsoe_a44_a03.xml'), 'NO1');
  assert.deepEqual(s.map((x) => [iso(x.t).slice(11, 16), x.m, x.eur]), [
    ['22:00', 15, 100.5], ['22:15', 15, 100.5], ['22:30', 15, 90], ['22:45', 15, 90], ['23:00', 60, -5.25], ['00:00', 60, -5.25],
  ]);
  // the same day at 60 and 15 minutes: the quarter hours win where both exist; the intraday auction (A07) is left out
  const mixed = parseSource('entsoe', fx('entsoe_a44_mixed.xml'), 'DE-LU');
  assert.deepEqual(mixed.map((x) => [iso(x.t).slice(11, 16), x.m, x.eur]), [
    ['22:00', 15, 70], ['22:15', 15, 90], ['22:30', 15, 80], ['22:45', 15, 80], ['23:00', 60, 60],
  ]);
  assert.deepEqual(hourly(mixed.map((x) => ({ t: x.t, m: x.m, p: x.eur }))).map((h) => h.p), [80, 60]);
  assert.deepEqual(parseSource('entsoe', '<Acknowledgement_MarketDocument><Reason><code>999</code><text>No matching data found for Data item</text></Reason></Acknowledgement_MarketDocument>', 'NO1'), []);
  assert.throws(() => parseSource('entsoe', '<Acknowledgement_MarketDocument><Reason><text>Invalid query</text></Reason></Acknowledgement_MarketDocument>', 'NO1'), PriceParseError);
});

test('normalizeSlots: sorted, de-duplicated, implausible prices dropped, minutes from the spacing', () => {
  const s = normalizeSlots([{ t: 3600_000, eur: 2 }, { t: 0, eur: 1 }, { t: 0, eur: 9 }, { t: 7200_000, eur: NaN }, { t: 7200_000, eur: 99999 }]);
  assert.deepEqual(s, [{ t: 0, m: 60, eur: 1 }, { t: 3600_000, m: 60, eur: 2 }]);
});

// ------------------------------------------------------------------------------------------- math

test('price math: surcharge before VAT, per kWh, in the zone currency or euros', () => {
  assert.equal(finalPrice(100), 0.1);
  assert.ok(Math.abs(finalPrice(100, { surcharge: 0.05, vat: 21 }) - 0.1815) < 1e-12);
  assert.ok(Math.abs(finalPrice(-20, { surcharge: 1.2, vat: 25 }) - 1.475) < 1e-12);
  const slots = [{ t: 0, m: 60, eur: 100, loc: 746 }];
  assert.ok(Math.abs(pricedSlots(slots, { currency: 'DKK', vat: 25 })[0].p - 0.9325) < 1e-12);
  assert.ok(Math.abs(pricedSlots(slots, { currency: 'EUR', vat: 25 })[0].p - 0.125) < 1e-12);
  assert.deepEqual(priceUnit('DKK', 'sub'), { label: 'øre/kWh', factor: 100, decimals: 0 });
  assert.deepEqual(priceUnit('EUR'), { label: '€/kWh', factor: 1, decimals: 3 });
});

test('15-minute prices: time-weighted hourly averages; hourly sources pass through', () => {
  const q = [10, 20, 30, 40, 50].map((p, i) => ({ t: i * 900_000, m: 15, p }));
  assert.deepEqual(hourly(q), [{ t: 0, m: 60, p: 25 }, { t: 3600_000, m: 60, p: 50 }]);
  const h = [{ t: 0, m: 60, p: 7 }];
  assert.deepEqual(hourly(h), h);
});

test('levels, trend and the cheapest windows still ahead', () => {
  const day = [5, 4, 1, 1, 2, 6, 9, 9, 8, 3, 2, 2].map((p, i) => ({ t: i * 3600_000, m: 60, p }));
  const lim = levelLimits(day.map((d) => d.p));
  assert.equal(levelOf(1, lim), 'cheap');
  assert.equal(levelOf(9, lim), 'high');
  assert.equal(levelOf(4, lim), 'mid');
  // a flat day is all normal
  assert.equal(levelOf(5, levelLimits([5, 5.01, 5.02])), 'mid');
  assert.equal(trend(1, 2), 'up');
  assert.equal(trend(2, 1), 'down');
  assert.equal(trend(1, 1.001), 'flat');
  // from 01:30 on: 2 h windows, the best one (02-04) and the next that does not overlap (10-12)
  const w = cheapestWindows(day, 1.5 * 3600_000, 2, 2);
  assert.deepEqual(w.map((x) => [x.t / 3600_000, x.end / 3600_000, x.p]), [[2, 4, 1], [10, 12, 2]]);
  // a gap breaks a window
  const gap = [{ t: 0, m: 60, p: 1 }, { t: 2 * 3600_000, m: 60, p: 1 }];
  assert.deepEqual(cheapestWindows(gap, 0, 2, 3), []);
});

test('local currency: kept from the source, else converted at the rate seen (or the peg)', () => {
  const eurOnly = [{ t: 0, m: 15, eur: 100 }];
  const a = withLocal(eurOnly, 'DK2');
  assert.equal(a.converted, true);
  assert.equal(a.slots[0].loc, Math.round(100 * DKK_PER_EUR * 1000) / 1000);
  const b = withLocal(eurOnly, 'DK2', [{ t: 0, m: 15, eur: 100, loc: 750 }]);
  assert.equal(b.slots[0].loc, 750);
  assert.equal(withLocal([{ t: 0, m: 15, eur: 1, loc: 7 }], 'DK2').converted, false);
  assert.equal(withLocal([{ t: 0, m: 15, eur: 1, loc: 7 }], 'DE-LU').slots[0].loc, undefined);
});

// ------------------------------------------------------------------------------------------- zones and requests

test('zones: free sources first, private-use ones only on a self-hosted server, ENTSO-E with a token', () => {
  assert.deepEqual(zoneSources('DK2'), ['eds', 'energycharts']);
  assert.deepEqual(zoneSources('DK2', { token: true }), ['eds', 'energycharts', 'entsoe']);
  assert.deepEqual(zoneSources('DE-LU'), ['energycharts', 'awattar', 'eds']);
  assert.deepEqual(zoneSources('ES'), ['ree', 'omie']);
  assert.deepEqual(zoneSources('ES-PVPC', { token: true }), ['ree']);
  assert.deepEqual(zoneSources('PT'), ['omie']);
  assert.deepEqual(zoneSources('FI'), ['elering']);
  // NO1: nothing free to republish; at home Energy-Charts (private use) and spot-hinta.fi
  assert.deepEqual(zoneSources('NO1'), []);
  assert.deepEqual(zoneSources('NO1', { token: true }), ['entsoe']);
  assert.deepEqual(zoneSources('NO1', { privateUse: true }), ['energycharts', 'spothinta']);
  for (const z of PRICE_ZONES) assert.ok(zoneSources(z, { privateUse: true, token: true }).length, z.id);
  assert.equal(new Set(PRICE_ZONES.map((z) => z.id)).size, PRICE_ZONES.length);
  assert.equal(zoneForTimeZone('Europe/Copenhagen'), 'DK2');
  assert.equal(zoneForTimeZone('Europe/Paris'), 'FR');
  assert.equal(priceZone('XX'), null);
});

test('requests: windows in UTC around the zone\'s day, OMIE one file per day, the token never without one', () => {
  const now = Date.parse('2026-10-12T10:00Z');
  const win = fetchWindow('DK2', now);
  assert.equal(iso(win.from), '2026-10-11T19:00:00.000Z');
  // 3 hours past the end of tomorrow: a household a time zone away still gets its whole days
  assert.equal(iso(win.to), '2026-10-14T01:00:00.000Z');
  const [eds] = sourceRequests('eds', 'DK2', win);
  assert.match(eds.url, /DayAheadPrices\?start=2026-10-11T19:00&end=2026-10-14T01:00&timezone=UTC&filter=%7B%22PriceArea%22%3A%5B%22DK2%22%5D%7D/);
  const omie = sourceRequests('omie', 'PT', fetchWindow('PT', now));
  assert.deepEqual(omie.map((r) => r.url.slice(-23)), ['marginalpdbc_20261012.1', 'marginalpdbc_20261013.1']);
  assert.equal(omie[1].optional, true);
  assert.deepEqual(sourceRequests('entsoe', 'NO1', win), []);
  // the day-ahead auction only (A01), never the intraday ones
  assert.match(sourceRequests('entsoe', 'NO1', win, { token: 'abc' })[0].url, /in_Domain=10YNO-1--------2&out_Domain=10YNO-1--------2&contract_MarketAgreement\.type=A01&periodStart=202610111900&periodEnd=202610140100/);
  // Red Eléctrica: Madrid's today and tomorrow, nothing further
  assert.match(sourceRequests('ree', 'ES', fetchWindow('ES', now))[0].url, /start_date=2026-10-12T00:00&end_date=2026-10-13T23:59/);
});

test('refresh plan: after the auction every 20 minutes until tomorrow is in, then the next day', () => {
  const zone = priceZone('DK2');
  const day = (h, m = 0) => Date.parse(`2026-10-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`);
  const slotsTo = (endMs) => {
    const out = [];
    for (let t = localMidnight(day(12), zone.tz); t < endMs; t += 900_000) out.push({ t, m: 15, eur: 1 });
    return out;
  };
  const todayOnly = slotsTo(localMidnight(day(12), zone.tz, 1));
  const withTomorrow = slotsTo(localMidnight(day(12), zone.tz, 2));
  assert.equal(nextRefreshAt(todayOnly, zone, day(9)), day(12, 50));
  assert.equal(nextRefreshAt(todayOnly, zone, day(13)), day(13, 20));
  assert.equal(nextRefreshAt(todayOnly, zone, day(18)), day(19));
  assert.equal(nextRefreshAt(withTomorrow, zone, day(14)), day(20));
  // at least every 6 hours (late corrections), never later than the next auction
  assert.equal(nextRefreshAt(withTomorrow, zone, day(23)), day(23) + 6 * 3600_000);
  assert.equal(nextRefreshAt(withTomorrow, zone, day(23) + 9 * 3600_000), day(12, 50) + 86400_000);
  assert.equal(nextRefreshAt([], zone, day(9)), day(9, 30));
  // the auction runs on Brussels time: Helsinki (an hour ahead) waits until 13:50 local
  const fi = priceZone('FI');
  const fiDay = (h, m = 0) => Date.parse(`2026-10-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
  const fiToday = [];
  for (let t = localMidnight(fiDay(12), fi.tz); t < localMidnight(fiDay(12), fi.tz, 1); t += 900_000) fiToday.push({ t, m: 15, eur: 1 });
  assert.equal(nextRefreshAt(fiToday, fi, fiDay(9)), fiDay(13, 50));
  // PVPC is published in the evening, Madrid time
  const pvpc = priceZone('ES-PVPC');
  const esDay = (h, m = 0) => Date.parse(`2026-10-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`);
  const esToday = [];
  for (let t = localMidnight(esDay(12), pvpc.tz); t < localMidnight(esDay(12), pvpc.tz, 1); t += 3600_000) esToday.push({ t, m: 60, eur: 1 });
  assert.equal(nextRefreshAt(esToday, pvpc, esDay(15)), esDay(20, 30));
  assert.equal(retryAfterMs('14'), 14_000);
  assert.equal(retryAfterMs(null), null);
  assert.equal(failureBackoff(1), 120_000);
  assert.equal(failureBackoff(9), 3600_000);
});

// ------------------------------------------------------------------------------------------- cache

test('cache: one fetch per zone for every screen, fallback to the next source, stale data kept on outages', async () => {
  let now = Date.parse('2026-10-12T09:00:00+02:00');
  const clock = () => now;
  const calls = [];
  const fake = fakePricesFetch('1', clock);
  let down = new Set();
  setPricesFetch(async (url) => {
    const host = new URL(url).hostname;
    calls.push(host);
    if (down.has(host)) return { status: 503, headers: { get: () => null }, text: async () => 'down' };
    return fake(url);
  }, clock);
  try {
    const a = await getPrices('DK2');
    assert.equal(a.source, 'eds');
    assert.equal(a.credit, 'Energinet');
    assert.equal(a.currency, 'DKK');
    assert.equal(a.stale, false);
    assert.ok(a.slots.every((s) => s.length === 4));
    await getPrices('DK2');
    await Promise.all([getPrices('DK2'), getPrices('DK2')]);
    assert.equal(calls.length, 1, 'cached');
    // the refresh time comes: Energi Data Service is down, Energy-Charts answers (kroner converted). The screen asking
    // gets the cached prices at once, the refresh runs behind it
    now = Date.parse('2026-10-12T13:00:00+02:00');
    down = new Set(['api.energidataservice.dk']);
    assert.equal((await getPrices('DK2')).source, 'eds');
    await settle();
    const b = await getPrices('DK2');
    assert.equal(b.source, 'energycharts');
    assert.equal(b.converted, true);
    // every source down: the last prices stay, stale once they are old
    down = new Set(['api.energidataservice.dk', 'api.energy-charts.info', 'api.spot-hinta.fi']);
    now += 30 * 60_000;
    const c = await getPrices('DK2', { force: true });
    assert.equal(c.source, 'energycharts');
    assert.equal(c.error, 'http_error');
    assert.equal(c.stale, false);
    now += 4 * 3600_000;
    const d = await getPrices('DK2');
    assert.equal(d.stale, true);
    // a zone never fetched, every source down: an error
    down = new Set(['dashboard.elering.ee', 'api.energy-charts.info', 'api.spot-hinta.fi']);
    await assert.rejects(getPrices('FI'), (e) => e instanceof PricesError && e.code === 'http_error');
    await assert.rejects(getPrices('XX'), (e) => e.code === 'invalid_zone');
  } finally {
    setPricesFetch(null);
  }
});

test('cache: a 429 leaves the source alone for its Retry-After', async () => {
  let now = Date.parse('2026-10-12T09:00:00+01:00');
  const clock = () => now;
  const fake = fakePricesFetch('1', clock);
  let n = 0;
  setPricesFetch(async (url) => {
    if (new URL(url).hostname === 'api.energy-charts.info') {
      n++;
      return { status: 429, headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? '120' : null) }, text: async () => '' };
    }
    return fake(url);
  }, clock);
  try {
    // France: Energy-Charts only (no token, no private-use source)
    await assert.rejects(getPrices('FR'), (e) => e.code === 'rate_limited');
    assert.equal(n, 1);
    now += 3 * 60_000; // past the 2-minute backoff and the 120 s Retry-After: asked again
    await assert.rejects(getPrices('FR'), (e) => e.code === 'rate_limited');
    assert.equal(n, 2);
    now += 60_000; // inside this Retry-After and the backoff: no call at all
    await assert.rejects(getPrices('FR'));
    assert.equal(n, 2);
    // the admin test answers without throwing
    const t = await testPrices('FR');
    assert.equal(t.ok, false);
  } finally {
    setPricesFetch(null);
  }
});

test('cache: a slow source never holds a screen up while prices are cached; answers over 2 MB are refused', async () => {
  let now = Date.parse('2026-10-12T09:00:00+02:00');
  const clock = () => now;
  const fake = fakePricesFetch('1', clock);
  let hang = null;
  let huge = false;
  setPricesFetch(async (url) => {
    if (hang) await hang;
    if (huge) return { status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-length' ? String(3 * 1024 * 1024) : null) }, text: async () => 'x' };
    return fake(url);
  }, clock);
  try {
    assert.equal((await getPrices('DK2')).source, 'eds');
    let release;
    hang = new Promise((r) => (release = r));
    now = Date.parse('2026-10-12T13:30:00+02:00');
    const quick = await Promise.race([getPrices('DK2'), new Promise((r) => setTimeout(() => r('waited'), 200))]);
    assert.notEqual(quick, 'waited');
    assert.equal(quick.stale, false);
    release();
    hang = null;
    await settle();
    // too large: refused before it is read, the next source answers
    huge = true;
    await assert.rejects(getPrices('FI'), (e) => e.code === 'bad_response');
  } finally {
    setPricesFetch(null);
  }
});

test('fake sources: every zone reads through its real parser (test servers and screenshots)', async () => {
  const now = Date.parse('2026-10-12T15:00:00+02:00');
  setPricesFetch(fakePricesFetch('1', () => now), () => now);
  try {
    for (const z of ['DK1', 'DK2', 'SE3', 'NO2', 'DE-LU', 'AT', 'FR', 'FI', 'EE', 'ES', 'ES-PVPC', 'PT', 'NO1', 'IT-South']) {
      const r = await getPrices(z);
      assert.ok(r.slots.length >= 24, z);
      assert.equal(r.stale, false, z);
    }
  } finally {
    setPricesFetch(null);
  }
});

// ------------------------------------------------------------------------------------------- config

const priceWidget = (prices = {}) => ({ id: 'w_luz', type: 'prices', name: 'Luz', options: { prices: { zone: 'DK2', ...prices } } });
function withWidget(w) {
  const c = defaultConfig();
  c.widgets = [w];
  c.screens[0].widgets = [{ widgetId: w.id, place: 'side', corner: 'br', size: 'm' }];
  return c;
}

test('validate: price widget options, defaults and limits; no address needed', () => {
  const ok = validateConfig(withWidget(priceWidget({ surcharge: 1.234567, vat: 25 })));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.value.widgets[0].options, {
    url: '', refreshSec: 900, fit: 'contain', bust: false,
    prices: { zone: 'DK2', view: 'auto', unit: 'main', currency: 'auto', surcharge: 1.23457, vat: 25, windowHours: 3, resolution: 'hour', axis: 'simple', chartShape: 'columns', tariff: 'none', grid: '' },
  });
  const bad = validateConfig(withWidget(priceWidget({ zone: 'XX', vat: 80, surcharge: 500, view: 'pie', windowHours: 9, unit: 'mwh' })));
  const paths = bad.errors.map((e) => e.path);
  for (const k of ['zone', 'vat', 'surcharge', 'view', 'windowHours', 'unit']) assert.ok(paths.includes(`widgets[0].options.prices.${k}`), k);
  const none = validateConfig(withWidget({ id: 'w_luz', type: 'prices', name: '', options: {} }));
  assert.ok(none.errors.some((e) => e.path === 'widgets[0].options.prices.zone' && e.message === 'zone required'));
  // a server can refuse the type
  assert.ok(validateConfig(withWidget(priceWidget()), { widgetTypes: ['image'] }).errors.some((e) => e.message === 'not available on this server'));
});

test('validate: the chart hour labels and shape; older widgets get simple labels and the wide chart', () => {
  assert.deepEqual([...PRICE_AXES], ['simple', '3h', '1h']);
  assert.deepEqual([...PRICE_SHAPES], ['columns', 'rows']);
  // a widget saved before these options
  const old = validateConfig(withWidget(priceWidget({ view: 'chart' })));
  assert.equal(old.ok, true, JSON.stringify(old.errors));
  assert.equal(old.value.widgets[0].options.prices.axis, 'simple');
  assert.equal(old.value.widgets[0].options.prices.chartShape, 'columns');
  for (const axis of PRICE_AXES) {
    for (const chartShape of PRICE_SHAPES) {
      const r = validateConfig(withWidget(priceWidget({ view: 'chart', axis, chartShape })));
      assert.equal(r.ok, true, JSON.stringify(r.errors));
      assert.equal(r.value.widgets[0].options.prices.axis, axis);
      assert.equal(r.value.widgets[0].options.prices.chartShape, chartShape);
    }
  }
  const bad = validateConfig(withWidget(priceWidget({ axis: '2h', chartShape: 'auto' })));
  const paths = bad.errors.map((e) => e.path);
  assert.ok(paths.includes('widgets[0].options.prices.axis'));
  assert.ok(paths.includes('widgets[0].options.prices.chartShape'));
  assert.equal(validateConfig(withWidget(priceWidget({ axis: null }))).ok, false);
});

test('backup import: price widgets keep their chart options; older backups get the defaults', () => {
  const backup = (prices) => {
    const c = withWidget(priceWidget(prices));
    c.screens[0].widgets = [{ widgetId: 'w_luz', place: 'corner', corner: 'br', size: 'l' }];
    return c;
  };
  const merged = (prices) => validateConfig(mergeImport(defaultConfig(), backup(prices), ['screens']));
  const old = merged({ view: 'chart', vat: 25 });
  assert.equal(old.ok, true, JSON.stringify(old.errors));
  assert.deepEqual([old.value.widgets[0].options.prices.axis, old.value.widgets[0].options.prices.chartShape], ['simple', 'columns']);
  const recent = merged({ view: 'auto', axis: '1h', chartShape: 'rows' });
  assert.equal(recent.ok, true, JSON.stringify(recent.errors));
  assert.deepEqual([recent.value.widgets[0].options.prices.axis, recent.value.widgets[0].options.prices.chartShape], ['1h', 'rows']);
  // a file with a value this version does not know is refused, not changed behind the owner's back
  assert.equal(merged({ axis: 'every' }).ok, false);
});

test('chart labels: every n-th coming hour, always the cheapest and the dearest, never two touching', () => {
  const day = [5, 4, 3, 2, 1, 2, 3, 6, 9, 8, 7, 5, 4, 3, 2, 3, 5, 8, 12, 11, 9, 7, 6, 5];
  // room for all of them
  assert.deepEqual(priceLabelPicks(day, 40, 30, 6), { picks: day.map((_, i) => i), step: 1, min: 4, max: 18 });
  // no room for all: each label needs 36 px, an hour is 14 px wide, so one hour in three
  const r = priceLabelPicks(day, 14, 30, 6);
  assert.equal(r.step, 3);
  assert.ok(r.picks.includes(r.min) && r.picks.includes(r.max));
  assert.deepEqual([r.min, r.max], [4, 18]);
  for (let i = 1; i < r.picks.length; i++) assert.ok((r.picks[i] - r.picks[i - 1]) * 14 >= 36 || [r.min, r.max].includes(r.picks[i]) && [r.min, r.max].includes(r.picks[i - 1]), `${r.picks}`);
  // a regular label next to the cheapest or the dearest gives way to it
  assert.ok(!r.picks.includes(3) && !r.picks.includes(5) && !r.picks.includes(17) && !r.picks.includes(19));
  // the first coming hour (the current one) is labelled unless it is next to the cheapest or dearest
  assert.ok(r.picks.includes(0));
  // every 2nd hour
  assert.equal(priceLabelPicks(day, 20, 30, 6).step, 2);
  // a tiny chart: only the two that always show
  const tiny = priceLabelPicks(day, 2, 30, 6);
  assert.deepEqual([tiny.step, tiny.picks], [0, [4, 18]]);
  // cheapest and dearest side by side are both kept
  const two = priceLabelPicks([1, 9, 5, 5, 5], 10, 30, 6);
  assert.ok(two.picks.includes(0) && two.picks.includes(1));
  // a flat list, a single hour, none
  assert.deepEqual(priceLabelPicks([3, 3, 3], 50, 30).picks, [0, 1, 2]);
  assert.deepEqual(priceLabelPicks([7], 5, 30).picks, [0]);
  assert.deepEqual(priceLabelPicks([], 5, 30), { picks: [], step: 0, min: -1, max: -1 });
  // property: whatever the sizes, min and max are in and the picks are in order without repeats
  for (let k = 0; k < 200; k++) {
    const ps = Array.from({ length: 1 + (k % 40) }, (_, i) => Math.sin(i * 1.3 + k) * 10 + (k % 7));
    const p = priceLabelPicks(ps, 1 + (k % 30), 10 + (k % 25), k % 5);
    assert.ok(p.picks.includes(p.min) && p.picks.includes(p.max));
    assert.equal(ps[p.min], Math.min(...ps));
    assert.equal(ps[p.max], Math.max(...ps));
    assert.deepEqual(p.picks, [...new Set(p.picks)].sort((a, b) => a - b));
  }
});

test('chart hour labels: simple, every 3 hours, every hour, fewer when they would touch', () => {
  assert.equal(axisStep('simple', 30, 20), 6);
  assert.equal(axisStep('simple', 30, 20, { wide: true }), 3);
  assert.equal(axisStep('3h', 30, 20), 3);
  assert.equal(axisStep('1h', 30, 20, { gap: 6 }), 1);
  // every hour does not fit: every 3 hours
  assert.equal(axisStep('1h', 20, 20, { gap: 6 }), 3);
  // nor every 3: every 6, then 12
  assert.equal(axisStep('1h', 5, 20, { gap: 6 }), 6);
  assert.equal(axisStep('3h', 2, 20, { gap: 6 }), 12);
  // an unknown value reads as simple
  assert.equal(axisStep(undefined, 30, 20), 6);
});

test('display projection: the options, no address, a version that changes with the zone only', () => {
  const c = validateConfig(withWidget(priceWidget({ vat: 25 }))).value;
  const [w] = displayWidgets(c, c.screens[0], { widgetSrc: () => '/api/display/widget/x' });
  assert.equal(w.type, 'prices');
  assert.equal(w.src, '');
  assert.equal(w.via, 'direct');
  assert.equal(w.prices.vat, 25);
  const c2 = structuredClone(c);
  c2.widgets[0].options.prices.vat = 21;
  assert.equal(displayWidgets(c2, c2.screens[0])[0].v, w.v);
  c2.widgets[0].options.prices.zone = 'DK1';
  assert.notEqual(displayWidgets(c2, c2.screens[0])[0].v, w.v);
  assert.deepEqual(displayWidgets(c, c.screens[0], { isPrivate: true }), []);
});

test('routes: GET /api/display/prices and POST /api/admin/test/prices (admin only)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-prices-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret123'), passwordIsDefault: false }));
  store.initStore(dir);
  await ensurePassword();
  const now = Date.parse('2026-10-12T15:00:00+02:00');
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
    const d = await call('GET', '/api/display/prices?zone=ES-PVPC');
    assert.equal(d.status, 200);
    assert.equal(d.json.credit, 'Red Eléctrica');
    assert.ok(d.json.slots.every(([, m]) => m === 60));
    assert.equal((await call('GET', '/api/display/prices?zone=nope')).status, 400);
    assert.equal((await call('POST', '/api/admin/test/prices', { zone: 'DK2' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { password: 'secret123' })).status, 200);
    const t = await call('POST', '/api/admin/test/prices', { zone: 'DK2' });
    assert.equal(t.json.ok, true);
    assert.equal(t.json.source, 'eds');
    assert.deepEqual((await call('POST', '/api/admin/test/prices', { zone: 'XX' })).json, { ok: false, error: 'invalid_zone' });
    // the ENTSO-E token: write-only, refused when malformed
    assert.deepEqual((await call('GET', '/api/admin/prices/token')).json, { set: false, hint: '' });
    assert.equal((await call('PUT', '/api/admin/prices/token', { token: 'bad token!' })).status, 400);
    const put = await call('PUT', '/api/admin/prices/token', { token: '0123abcd-4567-89ef-0123-456789abcdef' });
    assert.equal(put.status, 200);
    assert.deepEqual((await call('GET', '/api/admin/prices/token')).json, { set: true, hint: 'cdef' });
    assert.equal(store.getSecrets().prices.entsoeToken, '0123abcd-4567-89ef-0123-456789abcdef');
    assert.equal((await call('PUT', '/api/admin/prices/token', { token: '' })).status, 200);
    assert.equal(store.getSecrets().prices.entsoeToken, '');
  } finally {
    server.close();
    setPricesFetch(null);
  }
});

test('display wiring: price cards in custom widgets, corner halves, styles for every look, strings in every language', () => {
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const custom = read('web/display/widgets/custom.ts');
  assert.match(custom, /if \(w\?\.type === 'prices'\) return/);
  assert.match(custom, /new PriceCard\(w\)/);
  assert.match(custom, /e\.card\?\.stop\(\)/);
  assert.match(custom, /\[\['tl', 'bl'\], \['tr', 'br'\]\]/);
  const css = read('web/display/styles.css');
  assert.match(css, /\.uw-c\.uw-half \{ max-height: 50%; \}/);
  assert.match(css, /\.lite \.pw \{[^}]*backdrop-filter: none/);
  assert.match(css, /\.theme-light \.pw:not\(\.pw--side\)/);
  const modern = read('web/display/styles-modern.css');
  assert.match(modern, /\.style-modern \.pw \{/);
  assert.match(modern, /\.lite\.style-modern \.pw \{[^}]*backdrop-filter: none/);
  assert.match(modern, /#app\.is-kids \.pw/);
  const i18n = read('web/shared/i18n.ts');
  for (const k of ['priceTitle', 'priceCheap', 'priceMid', 'priceHigh', 'priceNextHour', 'priceCheapestHours', 'priceCheapestStretches', 'priceNoneLeft', 'priceRange', 'priceMinMax']) {
    assert.equal(i18n.split(`  ${k}: '`).length, 7, k);
  }
  const prices = read('web/display/widgets/prices.ts');
  // the screens only ever ask this server
  assert.match(prices, /getJSON<PricesResponse>\(`\/api\/display\/prices\?zone=/);
  assert.doesNotMatch(prices, /energidataservice|energy-charts|elering|ree\.es|omie|entsoe/i);
  for (const f of ['web/display/widgets/prices.ts', 'web/admin/sections/PriceWidget.tsx', 'web/admin/i18n-dict-prices.ts', 'server/prices.js', 'server/core/pricesCore.js']) {
    assert.doesNotMatch(read(f), /—/, `no em dashes in ${f}`);
  }
});

test('core refresh round (shared with Marco Cloud): sources in order through the caller\'s call, entry and answer', async () => {
  const { refreshZone, pricesResponse, refreshDue, PricesError: CoreError } = await import('../core/pricesCore.js');
  const now = Date.parse('2026-10-12T09:00:00+02:00');
  const fake = fakePricesFetch('1', () => now);
  const seen = [];
  const call = async (source, req) => {
    seen.push(source);
    if (source === 'eds') return { status: 503, text: 'down' };
    const r = await fake(req.url);
    return { status: r.status, text: await r.text() };
  };
  const logs = [];
  const e = await refreshZone('DK2', null, { now, call, privateUse: false, log: (m) => logs.push(m) });
  assert.deepEqual(seen, ['eds', 'energycharts']);
  assert.equal(e.source, 'energycharts');
  assert.equal(e.converted, true);
  assert.match(logs[0], /DK2 from eds: http_error/);
  const a = pricesResponse('DK2', e, now);
  assert.equal(a.currency, 'DKK');
  assert.equal(a.stale, false);
  assert.equal(refreshDue(e, now), false);
  assert.equal(refreshDue(e, now + 61_000, true), true);
  // nothing answers and nothing kept: an error entry, a backoff, and no answer for the screens
  const bad = await refreshZone('NO1', null, { now, call, privateUse: false });
  assert.equal(bad.error, 'no_source');
  assert.equal(bad.nextAt, now + 120_000);
  assert.throws(() => pricesResponse('NO1', bad, now), (err) => err instanceof CoreError && err.code === 'no_source');
});

test('display wiring: prices over the bars, the tall chart, the loading card', () => {
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const css = read('web/display/styles.css');
  // the prices over the bars read from across the room: never under 1.3rem, tabular figures
  assert.match(css, /\.pw-pv \{[^}]*font-size: max\([\d.]+em, 1\.3rem\)[^}]*font-variant-numeric: tabular-nums/);
  // the loading bars breathe, but not on lite screens nor with reduced motion
  assert.match(css, /\.lite \.pw-skel i \{ animation: none; \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.pw-skel i \{ animation: none; \}/);
  const prices = read('web/display/widgets/prices.ts');
  // the Vertical shape turns every chart into rows; other views stay
  assert.match(prices, /return rows && \(m === 'chart' \|\| m === 'nowchart' \|\| m === 'full'\) \? 'rows' : m;/);
  assert.match(prices, /o\?\.chartShape === 'rows'/);
  // labels: the pure picker, past hours never labelled (from the current hour on)
  assert.match(prices, /priceLabelPicks\(coming\.map\(\(h\) => h\.p\), pitch, lab\.w, gap\)/);
  assert.match(prices, /const coming = m\.hours\.filter\(\(h\) => h\.t >= from/);
  // grid tariffs still on their way: a note, not "without grid tariff"
  assert.match(prices, /m\.gridPending\) f\.appendChild\(el\('span', 'pw-incl pw-incl--wait', ctx\.t\('priceLoadingGrid'/);
  const i18n = read('web/shared/i18n.ts');
  for (const k of ['priceLoading', 'priceLoadingGrid']) assert.equal(i18n.split(`  ${k}: '`).length, 7, k);
  const admin = read('web/admin/sections/PriceWidget.tsx');
  assert.match(admin, /axis: 'simple', chartShape: 'columns'/);
  assert.match(admin, /\{test\.loading \? t\('Cargando…'\) : t\('Probar'\)\}/);
  for (const f of ['web/admin/sections/PriceTariff.tsx', 'web/admin/Preview.tsx']) assert.doesNotMatch(read(f), /—/, f);
});
