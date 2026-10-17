// v2 config ⇄ flat per-screen view (docs/ARCHITECTURE.md). Mirror of server/core/screens.js + server/core/defaults.js key
// lists; keep in sync. Used by the admin panel: sections keep editing the flat `AppConfig` view of the
// selected screen; `applyScreen` writes the edited view back into the stored config.
import type { AppConfig, ScreenProfile, StoredConfig } from './types';

/** Per-screen part of the sections that are split between global and per-screen. */
export const SCREEN_SPLIT_KEYS = {
  calendar: ['enabled', 'view', 'weeks', 'weekStart', 'startOn', 'showLocation', 'showEndTime', 'showDayXofY', 'showLegend', 'hidePast', 'maxEventsPerDay', 'marquee', 'rotateBusyDays', 'compactBusyDays', 'eventStyle', 'agendaDays', 'sourceIds'],
  datetime: ['enabled', 'clock', 'format24', 'showSeconds', 'showAmPm', 'dateFormat'],
  weather: ['enabled', 'forecastDays', 'showHourly', 'showPrecipChance', 'place'],
  news: ['enabled', 'rotateSec'],
  todo: ['enabled'],
  countdowns: ['enabled', 'max'],
  family: ['memberIds', 'touch', 'showQr'],
} as const;
/** Sections that live entirely in the screen profile. */
export const SCREEN_ONLY_KEYS = ['screen', 'layout', 'background', 'message', 'alerts', 'privacy', 'widgets', 'canvas'] as const;

type AnyObj = Record<string, any>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function defaultScreenOf(cfg: StoredConfig): ScreenProfile {
  return cfg.screens.find((s) => s.id === cfg.defaultScreen) ?? cfg.screens[0];
}

/** Flat view of one screen (unknown id → default screen). Returns a fresh deep copy. */
export function projectScreen(cfg: StoredConfig, screenId?: string | null): AppConfig {
  const scr = cfg.screens.find((s) => s.id === screenId) ?? defaultScreenOf(cfg);
  const out: AnyObj = {};
  for (const [k, v] of Object.entries(cfg)) if (k !== 'screens') out[k] = v;
  for (const k of SCREEN_ONLY_KEYS) out[k] = (scr as AnyObj)[k];
  out.screen = { name: scr.name, ...scr.screen };
  for (const k of Object.keys(SCREEN_SPLIT_KEYS)) out[k] = { ...(cfg as AnyObj)[k], ...(scr as AnyObj)[k] };
  out.screenId = scr.id;
  out.slug = scr.slug;
  return clone(out) as AppConfig;
}

/**
 * Write an edited flat view back into a copy of `cfg` (the screen is `view.screenId`).
 * Global keys come from the view; per-screen keys go to that screen; `screens` and `defaultScreen` are taken
 * from `cfg` (edit those directly on the StoredConfig).
 */
export function applyScreen(cfg: StoredConfig, view: AppConfig): StoredConfig {
  const next = clone(cfg) as AnyObj;
  const v = clone(view) as AnyObj;
  const idx = next.screens.findIndex((s: ScreenProfile) => s.id === v.screenId);
  if (idx < 0) throw new Error(`unknown screen ${v.screenId}`);
  const scr = next.screens[idx] as AnyObj;
  for (const k of SCREEN_ONLY_KEYS) scr[k] = v[k];
  const { name, ...screenRest } = v.screen;
  scr.name = name;
  scr.screen = screenRest;
  for (const [k, keys] of Object.entries(SCREEN_SPLIT_KEYS)) {
    const merged = v[k] ?? {};
    const global: AnyObj = {};
    const local: AnyObj = {};
    for (const [kk, vv] of Object.entries(merged)) ((keys as readonly string[]).includes(kk) ? local : global)[kk] = vv;
    scr[k] = local;
    next[k] = global;
  }
  const skip = new Set(['screens', 'defaultScreen', 'screenId', 'slug', 'version', 'revision', ...SCREEN_ONLY_KEYS, ...Object.keys(SCREEN_SPLIT_KEYS)]);
  for (const [k, vv] of Object.entries(v)) if (!skip.has(k)) next[k] = vv;
  return next as StoredConfig;
}

/** "Salón principal" → "salon-principal" (same rule as the server). */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
