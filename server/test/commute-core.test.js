// The commute helpers shared by every server that asks Google (server/core/commuteCore.js): the requests, the waiting
// rules and the answer to the screens. server/commute.js keeps its legs in memory; Marco Cloud keeps them elsewhere
// with the same rules, so these are tested on their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMUTE_BACKOFF_MIN, COMMUTE_STALE_AFTER_MS, commuteBusyLeg, commuteFailed, commuteFetched, commuteLegKey, commuteProviderOrder,
  commuteResponse, commuteRouteResult, googleCommuteRequest, googleDirectionsRequest, googleRoutesRequest, planCommuteRoutes,
  testCommuteInput, testCommuteResult,
} from '../core/commuteCore.js';

const KEY = 'AIzaTESTkeyTESTkeyTESTkey123456';
const leg = { origin: 'Calle Inventada 1, Villaejemplo', destination: 'Plaza Ficticia 9', mode: 'driving', apiKey: KEY };

test('the requests: Directions with the key in its URL only, Routes with the key in a header only', () => {
  const d = googleDirectionsRequest(leg);
  const u = new URL(d.url);
  assert.equal(u.origin + u.pathname, 'https://maps.googleapis.com/maps/api/directions/json');
  assert.equal(u.searchParams.get('key'), KEY);
  assert.equal(u.searchParams.get('mode'), 'driving');
  assert.equal(u.searchParams.get('departure_time'), 'now');
  assert.ok(!JSON.stringify(d.init).includes(KEY), 'Directions: the key only in the URL');
  assert.equal(googleDirectionsRequest({ ...leg, mode: 'skate' }).url.includes('mode=driving'), true);

  const r = googleRoutesRequest({ ...leg, mode: 'transit' });
  assert.equal(r.url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
  assert.ok(!r.url.includes(KEY), 'Routes: never the key in the URL');
  assert.equal(r.init.method, 'POST');
  assert.equal(r.init.headers['x-goog-api-key'], KEY);
  assert.ok(!r.init.body.includes(KEY), 'Routes: never the key in the body');
  const body = JSON.parse(r.init.body);
  assert.equal(body.travelMode, 'TRANSIT');
  assert.equal(body.routingPreference, undefined, 'traffic only for a car');
  assert.equal(JSON.parse(googleRoutesRequest(leg).init.body).routingPreference, 'TRAFFIC_AWARE');
  assert.match(r.init.headers['x-goog-fieldmask'], /routes\.duration/);

  assert.equal(googleCommuteRequest('routes', leg).provider, 'google_routes');
  assert.equal(googleCommuteRequest('directions', leg).provider, 'google_directions');
  assert.equal(typeof googleCommuteRequest('routes', leg).parse, 'function');
  assert.deepEqual(commuteProviderOrder(null), ['directions', 'routes']);
  assert.deepEqual(commuteProviderOrder('directions'), ['directions', 'routes']);
  assert.deepEqual(commuteProviderOrder('routes'), ['routes', 'directions']);
});

test('a leg: its key, a good answer, failures waiting longer each time, a refused key an hour', () => {
  assert.equal(commuteLegKey('  Calle A  ', 'PLAZA b', 'walking'), 'walking|calle a|plaza b');
  assert.equal(commuteLegKey('x'.repeat(300), 'y', 'driving').length, 'driving|'.length + 200 + 2);

  const t = 1_000_000;
  const data = { durationSec: 1200, normalDurationSec: 1000, distanceMeters: 9000, summary: 'A-6', provider: 'google_routes' };
  const ok = commuteFetched(data, t, 15);
  assert.deepEqual(ok, { ...data, fetchedAt: t, at: t, nextAt: t + 15 * 60_000, usedAt: t, error: null, failures: 0 });
  assert.equal(commuteFetched(data, t, 5).nextAt, t + 10 * 60_000, 'never sooner than the 10 minute floor');
  assert.equal(commuteFetched(data, t, undefined).nextAt, t + 10 * 60_000);

  let e = ok;
  const waits = [];
  for (let i = 0; i < 6; i++) {
    e = commuteFailed(e, 'timeout', t);
    waits.push((e.nextAt - t) / 60_000);
  }
  assert.deepEqual(waits, [...COMMUTE_BACKOFF_MIN, 60]);
  assert.equal(e.durationSec, 1200, 'the last good answer is kept');
  assert.equal(e.error, 'timeout');
  assert.equal((commuteFailed(null, 'key_invalid', t).nextAt - t) / 60_000, 60);
  assert.equal((commuteFailed(null, 'http_denied', t).nextAt - t) / 60_000, 60);
  assert.equal(commuteFailed(null, 'no_route', t).durationSec, 0);
  assert.equal(commuteBusyLeg(t).error, 'busy');
});

test('the answer to the screens: the plan of the saved routes, never an address', () => {
  const routes = [
    { id: 'cr_a', name: 'Trabajo', origin: 'Calle Inventada 1', destination: 'Plaza Ficticia 9', mode: 'driving', direction: 'to', days: [], from: '', to: '' },
    { id: 'cr_b', name: '', origin: 'Calle Inventada 1', destination: 'Plaza Ficticia 9', mode: 'bus', direction: 'from' },
    { id: 'cr_c', name: 'Night', origin: 'A', destination: 'B', mode: 'walking', from: '22:00', to: '23:00' },
    { id: 'cr_d', name: 'Not set up', origin: '', destination: 'B' },
  ];
  const now = Date.parse('2026-10-12T08:30:00Z');
  const plan = planCommuteRoutes(routes, now, 'UTC');
  assert.equal(plan.length, 3, 'a route without both addresses is left out');
  assert.deepEqual(plan[0], { base: { id: 'cr_a', name: 'Trabajo', mode: 'driving', reversed: false }, active: true, leg: { origin: 'Calle Inventada 1', destination: 'Plaza Ficticia 9', mode: 'driving' } });
  assert.deepEqual(plan[1].leg, { origin: 'Plaza Ficticia 9', destination: 'Calle Inventada 1', mode: 'driving' }, 'the way back, an unknown mode is a car');
  assert.equal(plan[1].base.reversed, true);
  assert.deepEqual(plan[2], { base: { id: 'cr_c', name: 'Night', mode: 'walking', reversed: false }, active: false });
  assert.equal(planCommuteRoutes(Array.from({ length: 12 }, () => routes[0]), now).length, 8);
  assert.deepEqual(planCommuteRoutes(null, now), []);

  const good = commuteFetched({ durationSec: 1500, normalDurationSec: 1200, distanceMeters: 18000, summary: 'A-6', provider: 'google_routes' }, now - 60_000);
  const failed = commuteFailed(null, 'no_route', now);
  const out = commuteResponse(plan, [good, failed, undefined], now, { showRouteSummary: false });
  assert.equal(out.keySet, true);
  assert.equal(out.fetchedAt, new Date(now - 60_000).toISOString());
  assert.deepEqual(out.routes[0], {
    id: 'cr_a', name: 'Trabajo', mode: 'driving', reversed: false, active: true, ok: true, durationSec: 1500, normalDurationSec: 1200,
    delaySec: 300, delayMin: 5, distanceMeters: 18000, summary: '', provider: 'google_routes', fetchedAt: new Date(now - 60_000).toISOString(),
    stale: false, traffic: 'moderate', error: null,
  });
  assert.deepEqual(out.routes[1], { id: 'cr_b', name: '', mode: 'driving', reversed: true, active: true, ok: false, traffic: 'clear', error: 'no_route' });
  assert.deepEqual(out.routes[2], { id: 'cr_c', name: 'Night', mode: 'walking', reversed: false, active: false, ok: false });
  assert.doesNotMatch(JSON.stringify(out), /Inventada|Ficticia/);
  // an old answer, or a good one followed by a failure, is stale
  assert.equal(commuteRouteResult(plan[0].base, good, now + COMMUTE_STALE_AFTER_MS + 60_001).stale, true);
  assert.equal(commuteRouteResult(plan[0].base, commuteFailed(good, 'timeout', now), now).stale, true);
  assert.equal(commuteRouteResult(plan[0].base, good, now, {}).summary, 'A-6');
  // nothing kept yet: the time of the answer is now
  assert.equal(commuteResponse([], [], now).fetchedAt, new Date(now).toISOString());
});

test('the test button: its input and its answer', () => {
  assert.equal(testCommuteInput({ origin: ' ', destination: 'B' }), null);
  assert.equal(testCommuteInput({ origin: 1, destination: 'B' }), null);
  assert.equal(testCommuteInput(), null);
  assert.deepEqual(testCommuteInput({ origin: ' A ', destination: 'B', mode: 'rocket' }), { origin: 'A', destination: 'B', mode: 'driving' });
  assert.equal(testCommuteInput({ origin: 'x'.repeat(300), destination: 'B' }).origin.length, 200);
  const t = 5_000_000;
  assert.deepEqual(testCommuteResult(commuteFailed(null, 'http_denied', t), 'driving'), { ok: false, error: 'key_invalid' });
  assert.deepEqual(testCommuteResult(commuteFailed(null, 'no_route', t), 'driving'), { ok: false, error: 'not_found' });
  assert.deepEqual(testCommuteResult(commuteBusyLeg(t), 'driving'), { ok: false, error: 'busy' });
  assert.deepEqual(testCommuteResult(null, 'driving'), { ok: false, error: 'fetch_failed' });
  const good = commuteFetched({ durationSec: 900, normalDurationSec: 900, distanceMeters: 5000, summary: '', provider: '' }, t);
  assert.deepEqual(testCommuteResult(good, 'transit'), {
    ok: true, durationSec: 900, normalDurationSec: 900, delaySec: 0, traffic: 'clear', distanceMeters: 5000, summary: '', provider: 'google_directions',
  });
});
