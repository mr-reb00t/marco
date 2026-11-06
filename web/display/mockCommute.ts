// Made-up travel times for the Trayectos cards when there is no server: the demo (?demo=1, screenshots and tests) and
// the admin preview of a card not saved yet ("Ejemplo"). Deterministic, by the route's place in the card, so every
// screenshot is the same. Nothing here talks to a server or to Google.
import type { CommuteMode, CommuteResponse, CommuteRouteResult } from '../shared/types';
import { trafficLevel } from '../../server/core/commuteCore.js';

/** Route ids that give a fixed state in the demo (mockCanvas.ts fixtures). */
export const DEMO_COMMUTE = { stale: 'cr_demo_stale', noRoute: 'cr_demo_noroute', noKey: 'cr_demo_nokey' } as const;

/** By place: minutes now, minutes on a normal day, metres, the road or the line. */
const TIMES: { min: number; normal: number; m: number; via: string; viaTransit: string }[] = [
  { min: 24, normal: 19, m: 18400, via: 'A-6', viaTransit: 'L10' },
  { min: 38, normal: 38, m: 14900, via: 'M-30', viaTransit: 'L10 → C4' },
  { min: 47, normal: 31, m: 32600, via: 'M-40', viaTransit: 'C5' },
  { min: 17, normal: 17, m: 5200, via: 'Anillo Verde', viaTransit: 'L6' },
  { min: 12, normal: 12, m: 950, via: 'Calle Mayor', viaTransit: 'L2' },
  { min: 72, normal: 64, m: 61000, via: 'A-3', viaTransit: 'AVE' },
];

/**
 * The answer GET /api/display/commute would give for these routes (the card's ids, names and modes) at `nowMs`: the
 * fifth route (or cr_demo4) shows the way back; DEMO_COMMUTE ids a route with old times, no route, or a server with no
 * key.
 */
export function demoCommute(routes: { id: string; name: string; mode: CommuteMode }[], nowMs = Date.now()): CommuteResponse {
  const at = new Date(nowMs - 3 * 60_000).toISOString();
  if (routes.some((r) => r.id === DEMO_COMMUTE.noKey)) return { fetchedAt: at, keySet: false, routes: [] };
  return {
    fetchedAt: at,
    keySet: true,
    routes: routes.map((r, i): CommuteRouteResult => {
      // (a demo route's own times: cr_demo<n> takes the n-th, so a fixture picks the traffic it shows)
      const own = /^cr_demo(\d)/.exec(r.id);
      const k = own ? Number(own[1]) : i;
      const base = { id: r.id, name: r.name, mode: r.mode, reversed: k === 4, active: true };
      if (r.id === DEMO_COMMUTE.noRoute) return { ...base, ok: false, traffic: 'clear', error: 'no_route' };
      const x = TIMES[k % TIMES.length];
      const driving = r.mode === 'driving';
      const durationSec = x.min * 60;
      const normalDurationSec = (driving ? x.normal : x.min) * 60;
      const stale = r.id === DEMO_COMMUTE.stale;
      return {
        ...base,
        ok: true,
        durationSec,
        normalDurationSec,
        delaySec: Math.max(0, durationSec - normalDurationSec),
        delayMin: Math.max(0, Math.round((durationSec - normalDurationSec) / 60)),
        distanceMeters: r.mode === 'walking' ? Math.min(x.m, 1400) : r.mode === 'bicycling' ? Math.min(x.m, 9000) : x.m,
        summary: r.mode === 'transit' ? x.viaTransit : x.via,
        provider: 'demo',
        fetchedAt: stale ? new Date(nowMs - 52 * 60_000).toISOString() : at,
        stale,
        traffic: trafficLevel(durationSec, normalDurationSec, r.mode),
        error: null,
      };
    }),
  };
}
