// Types for bootstrap.js (the display API answers written into the display page), used by the display.
export const BOOT_ID: string;
export const BOOT_VERSION: number;
export const AUTO_WEEKS_MAX: number;
export const AGENDA_AUTO_MAX_DAYS: number;
export function eventsWindow(
  today: string,
  o?: { weekStart?: number; startOn?: string; weeks?: number | 'auto'; agenda?: boolean; agendaDays?: number | 'auto'; canvas?: unknown },
): [string, string];
export function bootEventWindows(config: unknown, now?: Date): [string, string][];
export function eventsPath(range: [string, string]): string;
export function bootDataPaths(config: unknown, now?: Date): string[];
export function bootBlock(data: Record<string, unknown>): string;
export function injectBoot(html: string, data: Record<string, unknown>): string;
