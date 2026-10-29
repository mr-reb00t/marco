// Default display config (mirrors server/core/defaults.js) + a defensive deep merge so a partial / older
// config from the server never breaks the screen.
import type { AgendaDays, DisplayConfig } from '../shared/types';
import { DEFAULT_ICON_RULES } from '../shared/emoji';
import { CALENDAR_BLUR_DEFAULT, CALENDAR_OPACITY_DEFAULT, GLASS_DEFAULTS, normalizeGlass } from '../shared/glass';

export const DEFAULT_CONFIG: DisplayConfig = {
  revision: 0,
  screen: {
    name: 'Living room', language: 'en', fontScale: 1, theme: 'dark', style: 'classic', accent: '#ff5a4e', orientation: 'auto', customCss: '',
    nightMode: { enabled: false, from: '23:00', to: '07:00', dim: 0.35 },
    glass: { ...GLASS_DEFAULTS },
    highlights: true,
  },
  layout: { preset: 'bigCalendar', sidePanel: 'left', sideWidth: 0.36, people: null, corner: 'br', plannerBar: 'side' },
  background: {
    enabled: true, source: 'stock', stockTopic: 'nature', order: 'random', intervalSec: 120, brightness: 0.85, showMeta: false,
    cover: true, transition: 'webgl', ambient: 'aurora', weatherFx: 'simple', portraitFit: 'auto', scope: 'side', calendarOpacity: CALENDAR_OPACITY_DEFAULT, calendarBlur: CALENDAR_BLUR_DEFAULT,
  },
  calendar: {
    enabled: true, view: 'month', weeks: 5, weekStart: 1, startOn: 'week', showLocation: false, showEndTime: false, showDayXofY: true,
    showLegend: true, hidePast: false, maxEventsPerDay: 4, marquee: true, rotateBusyDays: true, compactBusyDays: false, eventStyle: 'lines', gridLines: 'soft', gridColor: null, agendaDays: 'auto', sources: [], iconRules: DEFAULT_ICON_RULES,
  },
  datetime: {
    enabled: true, timezone: 'Europe/Lisbon', clock: 'digital', format24: true, showSeconds: true, showAmPm: false,
    dateFormat: 'weekday_d_month',
    dateCustom: '{dddd}, {d} {mmmm} {yyyy}',
  },
  weather: {
    enabled: true, provider: 'open-meteo', model: 'best_match', locationName: 'Lisbon, Portugal', lat: 38.7223, lon: -9.1393, units: 'metric',
    forecastDays: 5, showHourly: true, showPrecipChance: true, haWeatherEntity: '', haIndoorTempEntity: '',
    haIndoorHumidityEntity: '',
  },
  news: { enabled: true, rotateSec: 15 },
  todo: { enabled: false, items: [] },
  message: { enabled: false, text: '', emoji: '💬' },
  // v2 (docs/ARCHITECTURE.md): per-screen widgets
  countdowns: { enabled: true, max: 4 },
  alerts: { enabled: true, sound: true, volume: 0.6 },
  schedules: [],
  widgets: [],
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep merge `src` onto `base` (arrays replaced, type mismatches ignored). */
export function deepMerge<T>(base: T, src: unknown): T {
  if (!isObj(src) || !isObj(base)) return (src === undefined ? base : (src as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(src)) {
    const b = (base as Record<string, unknown>)[k];
    if (v === undefined || v === null) {
      if (b === undefined) out[k] = v;
      continue;
    }
    if (isObj(b) && isObj(v)) out[k] = deepMerge(b, v);
    else if (b === undefined || typeof b === typeof v || (Array.isArray(b) && Array.isArray(v))) out[k] = v;
  }
  return out as T;
}

/** calendar.agendaDays: 7, 14 or 30, anything else (missing, older servers) is 'auto'. */
export function normalizeAgendaDays(v: unknown): AgendaDays {
  return v === 7 || v === 14 || v === 30 ? v : 'auto';
}

export function normalizeConfig(raw: unknown): DisplayConfig {
  const c = deepMerge(DEFAULT_CONFIG, raw);
  // weeks: a number of rows, or 'auto' (deepMerge keeps only values of the default's type, so look at the raw one)
  const rawCal = isObj(raw) && isObj(raw.calendar) ? raw.calendar : null;
  c.calendar.weeks = rawCal?.weeks === 'auto' || c.calendar.weeks === 'auto' ? 'auto' : clampInt(c.calendar.weeks, 1, 8, 5);
  c.calendar.eventStyle = c.calendar.eventStyle === 'cards' ? 'cards' : 'lines';
  c.calendar.gridLines = c.calendar.gridLines === 'clear' || c.calendar.gridLines === 'strong' ? c.calendar.gridLines : 'soft';
  c.calendar.gridColor = typeof rawCal?.gridColor === 'string' && /^#[0-9a-f]{6}$/i.test(rawCal.gridColor) ? rawCal.gridColor : null;
  c.calendar.agendaDays = normalizeAgendaDays(rawCal?.agendaDays);
  c.calendar.maxEventsPerDay = clampInt(c.calendar.maxEventsPerDay, 1, 12, 4);
  c.calendar.weekStart = clampInt(c.calendar.weekStart, 0, 6, 1);
  c.calendar.startOn = c.calendar.startOn === 'today' ? 'today' : 'week';
  c.layout.sideWidth = Math.min(0.6, Math.max(0.2, Number(c.layout.sideWidth) || 0.36));
  if (!['tl', 'tr', 'bl', 'br'].includes(c.layout.corner as string)) c.layout.corner = 'br';
  if (!['side', 'top', 'bottom'].includes(c.layout.plannerBar as string)) c.layout.plannerBar = 'side';
  c.layout.people = Array.isArray(c.layout.people) ? c.layout.people.filter((x) => typeof x === 'string').slice(0, 5) : null;
  c.screen.fontScale = Math.min(2, Math.max(0.5, Number(c.screen.fontScale) || 1));
  c.background.intervalSec = Math.max(10, Number(c.background.intervalSec) || 120);
  c.background.brightness = Math.min(1.2, Math.max(0.1, Number(c.background.brightness) || 0.85));
  if (c.background.scope !== 'screen') c.background.scope = 'side';
  c.background.calendarOpacity = Math.min(1, Math.max(0, Number.isFinite(Number(c.background.calendarOpacity)) ? Number(c.background.calendarOpacity) : CALENDAR_OPACITY_DEFAULT));
  c.background.calendarBlur = Math.round(Math.min(40, Math.max(0, Number.isFinite(Number(c.background.calendarBlur)) ? Number(c.background.calendarBlur) : CALENDAR_BLUR_DEFAULT)));
  c.news.rotateSec = Math.max(5, Number(c.news.rotateSec) || 15);
  c.weather.forecastDays = clampInt(c.weather.forecastDays, 1, 7, 5);
  if (c.screen.style !== 'modern') c.screen.style = 'classic';
  c.screen.glass = normalizeGlass(c.screen.glass);
  if (!/^#[0-9a-f]{3,8}$/i.test(c.screen.accent)) c.screen.accent = '#ff5a4e';
  if (c.countdowns) c.countdowns.max = clampInt(c.countdowns.max, 1, 12, 4);
  if (c.alerts) c.alerts.volume = Math.min(1, Math.max(0, Number(c.alerts.volume) || 0));
  if (!Array.isArray(c.schedules)) c.schedules = [];
  if (!Array.isArray(c.widgets)) c.widgets = [];
  return c;
}

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
