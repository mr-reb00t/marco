// Types for the parts of commuteCore.js the browser uses (display 'commute' widget, admin Widgets).
import type { CommuteDirection, CommuteMode, CommuteRoute, CommuteTrafficLevel, CommuteWidgetOptions, DisplayCommuteOptions } from '../../web/shared/types';

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
