// Types for decorCore.js (imported by the display and the admin).
import type { DecorMode, DecorSeasons, OverlayWhen, ScreenDecoration, ScreenOverlay } from '../../web/shared/types';

type Err = (path: string, message: string) => void;
export type Season = 'christmas' | 'halloween' | 'newyear';

export declare const OVERLAY_MAX: number;
export declare const OVERLAYS_MAX: number;
export declare const OVERLAY_NAME_MAX: number;
export declare const OVERLAY_WHEN: readonly OverlayWhen['type'][];
export declare const DECOR_MODES: readonly DecorMode[];
export declare const SEASONS: Readonly<Record<Season, readonly [string, string]>>;
export declare function defaultOverlay(): ScreenOverlay;
export declare function defaultDecoration(): ScreenDecoration;
export declare function defaultSeasons(): DecorSeasons;
export declare function isMonthDay(s: unknown): boolean;
export declare function inYearlyRange(today: string, from: string, to: string): boolean;
export declare function sanitizeOverlay(raw: unknown, err?: Err, path?: string): ScreenOverlay;
export declare function sanitizeOverlays(raw: unknown, err?: Err, path?: string, legacy?: unknown): ScreenOverlay[];
export declare function migrateOverlay(legacy: unknown): ScreenOverlay[];
export declare function overlaysBytes(list: readonly ScreenOverlay[] | null | undefined): number;
export declare function sanitizeDecoration(raw: unknown, err?: Err, path?: string): ScreenDecoration;
export declare function overlayShown(overlay: ScreenOverlay | null | undefined, today: string): boolean;
export declare function seasonOn(today: string, seasons?: Partial<DecorSeasons> | null): Season | null;
export declare function decorationOn(d: ScreenDecoration | null | undefined, today: string): Season | null;
