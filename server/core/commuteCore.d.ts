// Types for commuteCore.js: the browser's parts (display 'commute' widget, admin Widgets) and the servers' parts.
import type { CommuteDirection, CommuteLook, CommuteMode, CommuteResponse, CommuteRoute, CommuteRouteResult, CommuteTrafficLevel, CommuteWidgetOptions, DisplayCommuteOptions } from '../../web/shared/types';

export const COMMUTE_MODES: readonly CommuteMode[];
export const COMMUTE_DIRECTIONS: readonly CommuteDirection[];
export const COMMUTE_UNITS: readonly ('auto' | 'metric' | 'imperial')[];
export const COMMUTE_REFRESH_MIN: readonly number[];
export const MIN_COMMUTE_REFRESH_MIN: number;
export const MAX_COMMUTE_ROUTES: number;
export const COMMUTE_ROUTE_PREFIX: string;
export const COMMUTE_KEY_RE: RegExp;

export function displayCommuteOptions(o: Partial<CommuteWidgetOptions> | undefined): DisplayCommuteOptions;
export function commuteKeyStatus(key?: string): { set: boolean; hint: string };
export function localDayAndMinutes(nowMs: number, tz?: string): { dow: number; minutes: number; h: number; mi: number };
export function resolveRouteLeg(route: Partial<CommuteRoute>, nowMs?: number, tz?: string): {
  origin: string;
  destination: string;
  reversed: boolean;
  active: boolean;
};
export function trafficLevel(durationSec: number, normalDurationSec: number, mode?: CommuteMode): CommuteTrafficLevel;
export function delayMinutes(durationSec: number, normalDurationSec: number): number;
export function formatDurationParts(durationSec: number): { hours: number; minutes: number; text: string };
export function formatDistance(meters: number, units?: 'metric' | 'imperial', locale?: string): string;
export const COMMUTE_LOOKS: readonly CommuteLook[];
export function randomRouteId(): string;
export function sanitizeCommuteOptions(
  raw: unknown,
  err?: (path: string, msg: string) => void,
  p?: string,
  opts?: { draft?: boolean; newId?: (prefix: string) => string },
): CommuteWidgetOptions;
export function commuteSig(o: Partial<CommuteWidgetOptions> | undefined): string;

// ---- the servers' side (server/commute.js, Marco Cloud)
export class CommuteError extends Error {
  code: string;
  constructor(code: string);
}
export type CommuteApi = 'routes' | 'directions';
export interface CommuteLegAsk { origin: string; destination: string; mode: CommuteMode }
export interface CommuteLegData { durationSec: number; normalDurationSec: number; distanceMeters: number; summary: string }
/** A kept leg: Google's last answer and when to ask again. */
export interface CommuteLegEntry extends CommuteLegData {
  provider: string;
  fetchedAt: number;
  at: number;
  nextAt: number;
  usedAt: number;
  error: string | null;
  failures: number;
}
export interface CommuteRequest { url: string; init: { method: string; headers: Record<string, string>; body?: string } }
export interface CommutePlanItem {
  base: { id: string; name: string; mode: CommuteMode; reversed: boolean };
  active: boolean;
  leg?: CommuteLegAsk;
}
export const COMMUTE_STALE_AFTER_MS: number;
export const COMMUTE_FORGET_AFTER_MS: number;
export const COMMUTE_TEST_MIN_MS: number;
export const COMMUTE_BACKOFF_MIN: readonly number[];
export const COMMUTE_KEY_ERRORS: ReadonlySet<string>;
export function googleRoutesTravelMode(mode: string): 'DRIVE' | 'TRANSIT' | 'BICYCLE' | 'WALK';
export function parseGoogleRoutesV2(text: string): CommuteLegData;
export function parseGoogleDirections(text: string): CommuteLegData;
export function commuteLegKey(origin: string, destination: string, mode: string): string;
export function googleDirectionsRequest(leg: CommuteLegAsk & { apiKey: string }): CommuteRequest;
export function googleRoutesRequest(leg: CommuteLegAsk & { apiKey: string }): CommuteRequest;
export function googleCommuteRequest(
  api: CommuteApi,
  leg: CommuteLegAsk & { apiKey: string },
): CommuteRequest & { parse: (text: string) => CommuteLegData; provider: 'google_routes' | 'google_directions' };
export function commuteProviderOrder(provider: string | null | undefined): [CommuteApi, CommuteApi];
export function commuteFetched(data: CommuteLegData & { provider: string }, t: number, refreshMin?: number): CommuteLegEntry;
export function commuteFailed(prev: Partial<CommuteLegEntry> | null | undefined, code: string, t: number): CommuteLegEntry;
export function commuteBusyLeg(t: number): CommuteLegEntry;
export function planCommuteRoutes(routes: unknown, now: number, tz?: string): CommutePlanItem[];
export function commuteRouteResult(
  base: CommutePlanItem['base'],
  entry: Partial<CommuteLegEntry> | null | undefined,
  now: number,
  opts?: { showRouteSummary?: boolean },
): CommuteRouteResult;
export function commuteResponse(
  plan: CommutePlanItem[],
  entries: (Partial<CommuteLegEntry> | null | undefined)[],
  now: number,
  opts?: { showRouteSummary?: boolean },
): CommuteResponse;
export function testCommuteInput(body?: { origin?: unknown; destination?: unknown; mode?: unknown }): CommuteLegAsk | null;
export function testCommuteResult(
  leg: Partial<CommuteLegEntry> | null | undefined,
  mode: CommuteMode,
): { ok: true; durationSec: number; normalDurationSec: number; delaySec: number; traffic: CommuteTrafficLevel; distanceMeters: number; summary: string; provider: string } | { ok: false; error: string };
