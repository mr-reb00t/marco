// Config validation & sanitisation. Unknown keys are dropped, missing keys take defaults,
// invalid values produce errors (PUT /api/admin/config answers 400 with the list).
import {
  defaultConfig, defaultScreenProfile, CONFIG_VERSION, RESERVED_SOURCE_IDS, SCREEN_SPLIT_KEYS, SCREEN_ONLY_KEYS,
  WIDGET_TYPES, WIDGET_REFRESH_SEC, WEB_WIDGET_REFRESH_SEC, MAX_WIDGETS, MAX_SCREEN_WIDGETS, WIDGET_PLACES, WIDGET_SIZES, WIDGET_FITS, WIDGET_PREFIX,
} from './defaults.js';
import { isValidTimeZone } from './lib/tz.js';
import { randomId, fold } from './lib/text.js';
import { LANGS } from './lib/i18n.js';
import { WEATHER_PROVIDER_IDS, OPEN_METEO_MODEL_IDS, KEY_PROVIDERS } from './weather.js';
import { cleanPlace, configWeatherPlaces, countScreenPlaces, MAX_SCREEN_WEATHER_PLACES, MAX_WEATHER_PLACES } from './weatherPlaces.js';
import { PRIVACY_MODES, MAX_PRIVACY_RULES, defaultSourcePrivacy } from './privacy.js';
import { CAMERA_RE, DOORBELL_MIN_SEC, DOORBELL_MAX_SEC } from './doorbellCore.js';
import {
  CAROUSEL_PREFIX, MAX_CAROUSELS, MAX_CAROUSEL_STEPS, MIN_STEP_SEC, MAX_STEP_SEC, DEFAULT_STEP_SEC, CAROUSEL_TRANSITIONS, CAROUSEL_SPEEDS, DEFAULT_TRANSITION, DEFAULT_SPEED, pruneCarousels,
} from './carousels.js';
import { IMMICH_ID_RE, MAX_IMMICH_ALBUMS, PORTRAIT_FITS, normalizeImmichUrl } from './immichCore.js';
import {
  BAND_NAME_MAX, BAND_PRESET_IDS, GRID_IDS, gridCompany, HOLIDAY_SETS, MAX_BAND_PRICE, MAX_BANDS, MIN_BAND_PRICE, TARIFF_MODES,
} from './tariffsCore.js';
import { sanitizeFamily, sanitizeScreenFamily, KIDS_PRESETS } from './familyCore.js';
import { currencyProps, sanitizeCanvas } from './canvasCore.js';
import { sanitizeBackgroundRules } from './bgRules.js';
import {
  PRICE_ZONE_IDS, PRICE_VIEWS, PRICE_UNITS, PRICE_RESOLUTIONS, PRICE_AXES, PRICE_SHAPES, MAX_VAT, MIN_SURCHARGE, MAX_SURCHARGE,
} from './pricesCore.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Screen layouts (docs/ARCHITECTURE.md); the display, the admin and server/setup.js use the same ids. */
export const LAYOUT_PRESETS = [
  'bigCalendar', 'leftRight', 'topBottom', 'bigTime', 'agenda', 'today', 'people', 'photoFrame', 'twoWeeks', 'board', 'bedside', 'planner',
  // one widget fills the screen (layout.widgetId)
  'widget',
  // kids layouts (Familia): the display shows them with the Modern style only
  ...KIDS_PRESETS,
  // Personalizado: widgets placed on a grid (screen.canvas, core/canvasCore.js); Modern style only
  'canvas',
];
/** calendar.eventStyle: 'lines' (one-line chips, the original look) or 'cards' (time on top, title below). */
export const EVENT_STYLES = ['lines', 'cards'];
/** calendar.startOn: the month / week grid starts on the first day of this week (weekStart) or on today. */
export const CALENDAR_START_ON = ['week', 'today'];
/** layout.plannerBar: where the 'planner' layout puts the clock and the weather on a landscape screen. */
export const PLANNER_BARS = ['side', 'top', 'bottom'];
/** calendar.agendaDays: days the agenda view looks ahead, or 'auto' (fills the agenda with the next days that have events). */
export const AGENDA_DAYS = ['auto', 7, 14, 30];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export function isHttpUrl(s, protocols = ['http:', 'https:']) {
  try {
    const u = new URL(String(s).trim().replace(/^webcals?:\/\//i, 'https://'));
    return protocols.includes(u.protocol);
  } catch {
    return false;
  }
}

class Ctx {
  constructor() { this.errors = []; this.warnings = []; }
  err(path, msg) { this.errors.push({ path, message: msg }); }
  /** Something fixed on the way (the save goes on): a canvas widget moved to a free spot, an unknown time zone. */
  warn(path, msg) { this.warnings.push({ path, message: msg }); }
}

// --- primitive coercers: return sanitized value or the default (recording an error when invalid) ---
function bool(ctx, path, v, d) {
  if (v === undefined) return d;
  if (typeof v === 'boolean') return v;
  ctx.err(path, 'expected boolean');
  return d;
}
function num(ctx, path, v, d, min, max, int = false) {
  if (v === undefined || v === null || v === '') return d;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) { ctx.err(path, 'expected number'); return d; }
  if (n < min || n > max) { ctx.err(path, `must be between ${min} and ${max}`); return d; }
  return int ? Math.round(n) : n;
}
function str(ctx, path, v, d, max = 200) {
  if (v === undefined || v === null) return d;
  if (typeof v !== 'string') { ctx.err(path, 'expected string'); return d; }
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (s.length > max) { ctx.err(path, `too long (max ${max})`); return s.slice(0, max); }
  return s;
}
function oneOf(ctx, path, v, d, list) {
  if (v === undefined) return d;
  if (list.includes(v)) return v;
  ctx.err(path, `must be one of ${list.join(', ')}`);
  return d;
}
function color(ctx, path, v, d, nullable = false) {
  if (v === undefined) return d;
  if (v === null || v === '') {
    if (nullable) return null;
    ctx.err(path, 'color required');
    return d;
  }
  if (typeof v === 'string' && HEX.test(v.trim())) return v.trim().toLowerCase();
  ctx.err(path, 'invalid color (#rrggbb)');
  return d;
}
function emoji(ctx, path, v, d) {
  if (v === undefined || v === null) return d;
  const s = str(ctx, path, v, d, 16).trim();
  return s;
}
/** The emoji field rule on its own (announcements): `{ value, errors }`, errors as { path, message }. */
export function validateEmoji(v, path = 'emoji', d = '') {
  const ctx = new Ctx();
  const value = emoji(ctx, path, v, d);
  return { value, errors: ctx.errors };
}
function id(ctx, path, v, prefix, seen) {
  let s = typeof v === 'string' && ID.test(v) ? v : randomId(prefix);
  while (seen.has(s)) s = randomId(prefix);
  seen.add(s);
  return s;
}
function arr(ctx, path, v, d, max) {
  if (v === undefined) return d;
  if (!Array.isArray(v)) { ctx.err(path, 'expected array'); return d; }
  if (v.length > max) { ctx.err(path, `too many items (max ${max})`); return v.slice(0, max); }
  return v;
}
function obj(ctx, path, v) {
  if (v === undefined) return {};
  if (!isObj(v)) { ctx.err(path, 'expected object'); return {}; }
  return v;
}

function sanitizeSource(ctx, path, s, seen) {
  if (!isObj(s)) { ctx.err(path, 'expected object'); return null; }
  const type = oneOf(ctx, `${path}.type`, s.type, 'ics', ['ics', 'google', 'microsoft']);
  const out = {
    id: id(ctx, `${path}.id`, s.id, 'c_', seen),
    type,
    name: str(ctx, `${path}.name`, s.name, 'Calendar', 80).trim() || 'Calendar',
    color: color(ctx, `${path}.color`, s.color, '#4ea8de'),
    emoji: emoji(ctx, `${path}.emoji`, s.emoji, ''),
    kind: oneOf(ctx, `${path}.kind`, s.kind, 'generic', ['generic', 'airbnb', 'birthdays', 'holidays']),
    enabled: bool(ctx, `${path}.enabled`, s.enabled, true),
    refreshMin: num(ctx, `${path}.refreshMin`, s.refreshMin, 5, 1, 1440, true),
  };
  // what privacy mode does to its events: 'busy' (default), 'hide', 'keep' (holidays and birthdays default to keep)
  out.privacy = oneOf(ctx, `${path}.privacy`, s.privacy, defaultSourcePrivacy(out.kind), PRIVACY_MODES);
  if (type === 'ics') {
    const url = str(ctx, `${path}.url`, s.url, '', 2048).trim();
    if (!isHttpUrl(url, ['http:', 'https:', 'webcal:', 'webcals:'])) ctx.err(`${path}.url`, 'invalid URL');
    out.url = url;
    out.insecureTls = bool(ctx, `${path}.insecureTls`, s.insecureTls, false);
  } else if (type === 'google') {
    out.googleCalendarId = str(ctx, `${path}.googleCalendarId`, s.googleCalendarId, 'primary', 512).trim() || 'primary';
    const acct = str(ctx, `${path}.googleAccount`, s.googleAccount, '', 320).trim().toLowerCase();
    if (!EMAIL.test(acct)) ctx.err(`${path}.googleAccount`, 'Google account email required');
    out.googleAccount = acct;
  } else {
    // Microsoft (Outlook.com, Hotmail, Microsoft 365) calendars, read through Microsoft Graph (server/microsoft.js, or
    // Marco Cloud). A server without a Microsoft app keeps them in the config and reports them as not available.
    const calId = str(ctx, `${path}.microsoftCalendarId`, s.microsoftCalendarId, '', 512).trim();
    if (!calId) ctx.err(`${path}.microsoftCalendarId`, 'Microsoft calendar id required');
    out.microsoftCalendarId = calId;
    const acct = str(ctx, `${path}.microsoftAccount`, s.microsoftAccount, '', 320).trim().toLowerCase();
    if (!EMAIL.test(acct)) ctx.err(`${path}.microsoftAccount`, 'Microsoft account email required');
    out.microsoftAccount = acct;
  }
  return out;
}

function sanitizeRule(ctx, path, r, seen) {
  if (!isObj(r)) { ctx.err(path, 'expected object'); return null; }
  const match = arr(ctx, `${path}.match`, r.match, [], 100)
    .filter((m) => typeof m === 'string')
    .map((m) => m.trim().slice(0, 80))
    .filter(Boolean);
  if (!match.length) ctx.err(`${path}.match`, 'at least one keyword');
  return {
    id: id(ctx, `${path}.id`, r.id, 'r_', seen),
    match,
    emoji: emoji(ctx, `${path}.emoji`, r.emoji, ''),
    color: color(ctx, `${path}.color`, r.color, null, true),
  };
}

// ------------------------------------------------------------------------------------------------
// Schema v2 helpers (docs/ARCHITECTURE.md)
// ------------------------------------------------------------------------------------------------
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const ALERT_STYLES = ['info', 'success', 'warning', 'urgent'];
export const MAX_SCREENS = 12;

/** Strict YYYY-MM-DD (real calendar date). */
export function isValidDate(s) {
  const m = typeof s === 'string' && DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** "Salón principal" → "salon-principal" (lowercase ascii, dashes, ≤ 32 chars). */
export function slugify(s) {
  return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
}

function date(ctx, path, v, d, nullable = false) {
  if (v === undefined) return d;
  if ((v === null || v === '') && nullable) return null;
  if (isValidDate(v)) return v;
  ctx.err(path, 'invalid date (YYYY-MM-DD)');
  return d;
}
function hhmm(ctx, path, v, d) {
  if (v === undefined) return d;
  if (typeof v === 'string' && HHMM.test(v)) return v;
  ctx.err(path, 'HH:MM');
  return d;
}
function idList(ctx, path, v, max = 60) {
  return arr(ctx, path, v, [], max).filter((x) => typeof x === 'string' && ID.test(x));
}
function weekdays(ctx, path, v) {
  const list = arr(ctx, path, v, [], 7);
  const out = [...new Set(list.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  if (out.length !== list.length) ctx.err(path, 'weekdays must be unique integers 0..6 (0 = Sunday)');
  return out;
}
function requiredStr(ctx, path, v, d, max) {
  const s = str(ctx, path, v, d, max).trim();
  if (!s) ctx.err(path, 'required');
  return s;
}

function sanitizeScreenProfile(ctx, p, raw, seenIds, seenSlugs, familyMemberIds = [], widgetIds = new Set(), canvasRefs = {}, opts = {}) {
  const D = defaultScreenProfile();
  const x = obj(ctx, p, raw);
  const name = str(ctx, `${p}.name`, x.name, '', 60).trim() || 'Screen';
  let slug = typeof x.slug === 'string' ? x.slug.trim().toLowerCase() : '';
  if (slug && !SLUG_RE.test(slug)) { ctx.err(`${p}.slug`, 'invalid slug (a-z, 0-9, -)'); slug = ''; }
  if (!slug) slug = slugify(name) || 'screen';
  for (let i = 2, base = slug; seenSlugs.has(slug); i++) slug = `${base.slice(0, 29)}-${i}`;
  seenSlugs.add(slug);

  const sc = obj(ctx, `${p}.screen`, x.screen);
  const nm = obj(ctx, `${p}.screen.nightMode`, sc.nightMode);
  const gl = obj(ctx, `${p}.screen.glass`, sc.glass);
  const GD = D.screen.glass;
  const screen = {
    language: oneOf(ctx, `${p}.screen.language`, sc.language, D.screen.language, LANGS),
    fontScale: num(ctx, `${p}.screen.fontScale`, sc.fontScale, D.screen.fontScale, 0.5, 3),
    theme: oneOf(ctx, `${p}.screen.theme`, sc.theme, D.screen.theme, ['dark', 'light', 'auto']),
    // display style: 'classic' (the original look) or 'modern' (glass cards, Apple-like); independent of the layout.
    // New configs start Modern (defaults.js); a config saved before styles existed keeps the look it always had.
    style: oneOf(ctx, `${p}.screen.style`, sc.style, 'classic', ['classic', 'modern']),
    accent: color(ctx, `${p}.screen.accent`, sc.accent, D.screen.accent),
    orientation: oneOf(ctx, `${p}.screen.orientation`, sc.orientation, D.screen.orientation, ['auto', 'landscape', 'portrait']),
    customCss: str(ctx, `${p}.screen.customCss`, sc.customCss, '', 20000).replace(/<\/style/gi, ''),
    nightMode: {
      enabled: bool(ctx, `${p}.screen.nightMode.enabled`, nm.enabled, D.screen.nightMode.enabled),
      from: hhmm(ctx, `${p}.screen.nightMode.from`, nm.from, D.screen.nightMode.from),
      to: hhmm(ctx, `${p}.screen.nightMode.to`, nm.to, D.screen.nightMode.to),
      dim: num(ctx, `${p}.screen.nightMode.dim`, nm.dim, D.screen.nightMode.dim, 0, 1),
    },
    // glass material of the Modern style: appearance, transparency (0 = see-through, 1 = solid), blur, tint, light edge
    glass: {
      appearance: oneOf(ctx, `${p}.screen.glass.appearance`, gl.appearance, GD.appearance, ['auto', 'clear', 'tinted']),
      opacity: num(ctx, `${p}.screen.glass.opacity`, gl.opacity, GD.opacity, 0, 1),
      blur: num(ctx, `${p}.screen.glass.blur`, gl.blur, GD.blur, 0, 40, true),
      tint: oneOf(ctx, `${p}.screen.glass.tint`, gl.tint, GD.tint, ['dark', 'light', 'photo']),
      edge: bool(ctx, `${p}.screen.glass.edge`, gl.edge, GD.edge),
    },
    // the pills under the date of the usual designs (next event, happening now, birthdays, check-in/out)
    highlights: bool(ctx, `${p}.screen.highlights`, sc.highlights, D.screen.highlights),
  };

  const ly = obj(ctx, `${p}.layout`, x.layout);
  const layout = {
    preset: oneOf(ctx, `${p}.layout.preset`, ly.preset, D.layout.preset, LAYOUT_PRESETS),
    sidePanel: oneOf(ctx, `${p}.layout.sidePanel`, ly.sidePanel, D.layout.sidePanel, ['left', 'right']),
    sideWidth: num(ctx, `${p}.layout.sideWidth`, ly.sideWidth, D.layout.sideWidth, 0.2, 0.6),
    // 'people' layout: the calendars shown as columns (null = automatic, at most 5, no duplicates)
    people: ly.people === null || ly.people === undefined ? null : [...new Set(idList(ctx, `${p}.layout.people`, ly.people, 5))],
    // 'photoFrame' layout: corner of the clock card
    corner: oneOf(ctx, `${p}.layout.corner`, ly.corner, D.layout.corner, ['tl', 'tr', 'bl', 'br']),
    // 'planner' layout on a landscape screen: clock and weather in the side column, or in a strip above / below the month
    plannerBar: oneOf(ctx, `${p}.layout.plannerBar`, ly.plannerBar, D.layout.plannerBar, PLANNER_BARS),
    // 'widget' layout: the widget shown full screen (a deleted one is dropped quietly)
    widgetId: typeof ly.widgetId === 'string' && widgetIds.has(ly.widgetId) ? ly.widgetId : null,
  };

  const bg = obj(ctx, `${p}.background`, x.background);
  const im = obj(ctx, `${p}.background.immich`, bg.immich);
  const albumIds = arr(ctx, `${p}.background.immich.albumIds`, im.albumIds, [], MAX_IMMICH_ALBUMS);
  if (albumIds.some((a) => typeof a !== 'string' || !IMMICH_ID_RE.test(a))) ctx.err(`${p}.background.immich.albumIds`, 'invalid album id');
  const background = {
    enabled: bool(ctx, `${p}.background.enabled`, bg.enabled, D.background.enabled),
    source: oneOf(ctx, `${p}.background.source`, bg.source, D.background.source, ['stock', 'gallery', 'mixed', 'immich']),
    stockTopic: str(ctx, `${p}.background.stockTopic`, bg.stockTopic, D.background.stockTopic, 60),
    order: oneOf(ctx, `${p}.background.order`, bg.order, D.background.order, ['random', 'newest', 'name']),
    intervalSec: num(ctx, `${p}.background.intervalSec`, bg.intervalSec, D.background.intervalSec, 10, 86400, true),
    brightness: num(ctx, `${p}.background.brightness`, bg.brightness, D.background.brightness, 0.1, 1),
    showMeta: bool(ctx, `${p}.background.showMeta`, bg.showMeta, D.background.showMeta),
    cover: bool(ctx, `${p}.background.cover`, bg.cover, D.background.cover),
    transition: oneOf(ctx, `${p}.background.transition`, bg.transition, D.background.transition, ['webgl', 'fade', 'none']),
    ambient: oneOf(ctx, `${p}.background.ambient`, bg.ambient, D.background.ambient, ['aurora', 'particles', 'none']),
    panelBlur: num(ctx, `${p}.background.panelBlur`, bg.panelBlur, D.background.panelBlur, 0, 40, true),
    panelShade: num(ctx, `${p}.background.panelShade`, bg.panelShade, D.background.panelShade, 0, 1),
    weatherFx: oneOf(ctx, `${p}.background.weatherFx`, bg.weatherFx, D.background.weatherFx, ['off', 'simple', 'rich']),
    portraitFit: oneOf(ctx, `${p}.background.portraitFit`, bg.portraitFit, D.background.portraitFit, PORTRAIT_FITS),
    immich: {
      albumIds: [...new Set(albumIds.filter((a) => typeof a === 'string' && IMMICH_ID_RE.test(a)).map((a) => a.toLowerCase()))],
      favoritesOnly: bool(ctx, `${p}.background.immich.favoritesOnly`, im.favoritesOnly, D.background.immich.favoritesOnly),
    },
    // the photo in the side area or behind the whole screen (the calendar then drawn over it as glass)
    scope: oneOf(ctx, `${p}.background.scope`, bg.scope, D.background.scope, ['side', 'screen']),
    calendarOpacity: num(ctx, `${p}.background.calendarOpacity`, bg.calendarOpacity, D.background.calendarOpacity, 0, 1),
    calendarBlur: num(ctx, `${p}.background.calendarBlur`, bg.calendarBlur, D.background.calendarBlur, 0, 40, true),
    // "Fondos especiales" (#14, core/bgRules.js): other photos on some days; the first rule that matches wins
    rules: sanitizeBackgroundRules(bg.rules, {
      err: (path, m) => ctx.err(path, m), path: `${p}.background.rules`, sourceIds: canvasRefs.sourceIds ? [...canvasRefs.sourceIds] : null,
      immichAvailable: opts.immichAvailable !== false,
    }),
  };

  const ca = obj(ctx, `${p}.calendar`, x.calendar);
  const calendar = {
    enabled: bool(ctx, `${p}.calendar.enabled`, ca.enabled, D.calendar.enabled),
    view: oneOf(ctx, `${p}.calendar.view`, ca.view, D.calendar.view, ['month', 'agenda', 'week']),
    // a number of week rows, or 'auto': the display picks 2 to 6 rows so each day fits maxEventsPerDay events
    weeks: ca.weeks === 'auto' ? 'auto' : num(ctx, `${p}.calendar.weeks`, ca.weeks, D.calendar.weeks, 1, 8, true),
    weekStart: num(ctx, `${p}.calendar.weekStart`, ca.weekStart, D.calendar.weekStart, 0, 6, true),
    // 'today': the grid has no past days, its first cell is today and the rows run on 7 days at a time (screens saved
    // before the option keep 'week')
    startOn: oneOf(ctx, `${p}.calendar.startOn`, ca.startOn, D.calendar.startOn, CALENDAR_START_ON),
    showLocation: bool(ctx, `${p}.calendar.showLocation`, ca.showLocation, D.calendar.showLocation),
    showEndTime: bool(ctx, `${p}.calendar.showEndTime`, ca.showEndTime, D.calendar.showEndTime),
    showDayXofY: bool(ctx, `${p}.calendar.showDayXofY`, ca.showDayXofY, D.calendar.showDayXofY),
    showLegend: bool(ctx, `${p}.calendar.showLegend`, ca.showLegend, D.calendar.showLegend),
    hidePast: bool(ctx, `${p}.calendar.hidePast`, ca.hidePast, D.calendar.hidePast),
    maxEventsPerDay: num(ctx, `${p}.calendar.maxEventsPerDay`, ca.maxEventsPerDay, D.calendar.maxEventsPerDay, 1, 20, true),
    marquee: bool(ctx, `${p}.calendar.marquee`, ca.marquee, D.calendar.marquee),
    rotateBusyDays: bool(ctx, `${p}.calendar.rotateBusyDays`, ca.rotateBusyDays, D.calendar.rotateBusyDays),
    // screens saved before the option keep the look they had (new screens get it on from defaultConfig)
    compactBusyDays: bool(ctx, `${p}.calendar.compactBusyDays`, ca.compactBusyDays, false),
    // how events look in the month / week grid: one-line chips (default, what every screen had) or stacked cards
    eventStyle: oneOf(ctx, `${p}.calendar.eventStyle`, ca.eventStyle, D.calendar.eventStyle, EVENT_STYLES),
    // how far the agenda view looks ahead: 7, 14 or 30 days, or 'auto' (the default for every screen: it only adds
    // days with events where the agenda had empty room)
    agendaDays: oneOf(ctx, `${p}.calendar.agendaDays`, ca.agendaDays, D.calendar.agendaDays, AGENDA_DAYS),
    sourceIds: ca.sourceIds === null || ca.sourceIds === undefined ? null : idList(ctx, `${p}.calendar.sourceIds`, ca.sourceIds),
  };

  const dt = obj(ctx, `${p}.datetime`, x.datetime);
  const datetime = {
    enabled: bool(ctx, `${p}.datetime.enabled`, dt.enabled, D.datetime.enabled),
    clock: oneOf(ctx, `${p}.datetime.clock`, dt.clock, D.datetime.clock, ['digital', 'analog']),
    format24: bool(ctx, `${p}.datetime.format24`, dt.format24, D.datetime.format24),
    showSeconds: bool(ctx, `${p}.datetime.showSeconds`, dt.showSeconds, D.datetime.showSeconds),
    showAmPm: bool(ctx, `${p}.datetime.showAmPm`, dt.showAmPm, D.datetime.showAmPm),
    dateFormat: oneOf(ctx, `${p}.datetime.dateFormat`, dt.dateFormat, D.datetime.dateFormat, ['weekday_month_d', 'weekday_d_month', 'weekday_d_dot_month', 'weekday_month_d_y', 'weekday_mdy', 'weekday_dmy', 'weekday_iso', 'custom']),
    dateCustom: str(ctx, `${p}.datetime.dateCustom`, dt.dateCustom, D.datetime.dateCustom, 60).replace(/[<>]/g, ''),
  };

  const we = obj(ctx, `${p}.weather`, x.weather);
  const weather = {
    enabled: bool(ctx, `${p}.weather.enabled`, we.enabled, D.weather.enabled),
    forecastDays: num(ctx, `${p}.weather.forecastDays`, we.forecastDays, D.weather.forecastDays, 1, 14, true),
    showHourly: bool(ctx, `${p}.weather.showHourly`, we.showHourly, D.weather.showHourly),
    showPrecipChance: bool(ctx, `${p}.weather.showPrecipChance`, we.showPrecipChance, D.weather.showPrecipChance),
    // "Ubicación de esta pantalla": null = the household's place
    place: cleanPlace(ctx, `${p}.weather.place`, we.place),
  };

  const ne = obj(ctx, `${p}.news`, x.news);
  const news = {
    enabled: bool(ctx, `${p}.news.enabled`, ne.enabled, D.news.enabled),
    rotateSec: num(ctx, `${p}.news.rotateSec`, ne.rotateSec, D.news.rotateSec, 3, 600, true),
  };
  const td = obj(ctx, `${p}.todo`, x.todo);
  const todo = { enabled: bool(ctx, `${p}.todo.enabled`, td.enabled, D.todo.enabled) };
  const ms = obj(ctx, `${p}.message`, x.message);
  const message = {
    enabled: bool(ctx, `${p}.message.enabled`, ms.enabled, D.message.enabled),
    text: str(ctx, `${p}.message.text`, ms.text, '', 500),
    emoji: emoji(ctx, `${p}.message.emoji`, ms.emoji, D.message.emoji),
  };
  const cd = obj(ctx, `${p}.countdowns`, x.countdowns);
  const countdowns = {
    enabled: bool(ctx, `${p}.countdowns.enabled`, cd.enabled, D.countdowns.enabled),
    max: num(ctx, `${p}.countdowns.max`, cd.max, D.countdowns.max, 1, 12, true),
  };
  const al = obj(ctx, `${p}.alerts`, x.alerts);
  const alerts = {
    enabled: bool(ctx, `${p}.alerts.enabled`, al.enabled, D.alerts.enabled),
    sound: bool(ctx, `${p}.alerts.sound`, al.sound, D.alerts.sound),
    volume: num(ctx, `${p}.alerts.volume`, al.volume, D.alerts.volume, 0, 1),
  };

  const pv = obj(ctx, `${p}.privacy`, x.privacy);
  const privacy = {
    hidePhotos: bool(ctx, `${p}.privacy.hidePhotos`, pv.hidePhotos, D.privacy.hidePhotos),
    showLock: bool(ctx, `${p}.privacy.showLock`, pv.showLock, D.privacy.showLock),
    schedule: list(ctx, `${p}.privacy.schedule`, pv.schedule, [], MAX_PRIVACY_RULES, sanitizePrivacyRule),
  };
  // Familia on this screen: who appears (unknown members dropped quietly), touch, QR card (familyCore.js)
  const family = sanitizeScreenFamily(x.family, (path, m) => ctx.err(path, m), `${p}.family`, familyMemberIds);
  const widgets = sanitizeWidgetPlacements(ctx, `${p}.widgets`, x.widgets, widgetIds);
  // Personalizado: the screen's calendars are the pool its calendar widgets pick from
  const known = canvasRefs.sourceIds ?? null;
  const pool = calendar.sourceIds ? calendar.sourceIds.filter((s) => !known || known.has(s)) : known ? [...known] : null;
  const canvas = sanitizeCanvas(ctx, `${p}.canvas`, x.canvas, {
    sourceIds: pool ? new Set(pool) : null, widgets: canvasRefs.widgets ?? new Map(), memberIds: new Set(familyMemberIds),
  }, opts);
  // the Personalizado layout is a Modern design (there is no Classic one)
  if (layout.preset === 'canvas') screen.style = 'modern';

  return {
    // "v_" belongs to carousels (isCarouselId); a screen id with it gets a new one
    id: id(ctx, `${p}.id`, typeof x.id === 'string' && x.id.startsWith(CAROUSEL_PREFIX) ? undefined : x.id, 's_', seenIds), slug, name,
    screen, layout, background, calendar, datetime, weather, news, todo, message, countdowns, alerts, privacy, family, widgets, canvas,
  };
}

/** Characters a widget URL may not carry, even where the URL parser would quietly drop or encode them. */
const WIDGET_URL_BAD = /[\s"'<>\\\u0000-\u001f\u007f]/;

/**
 * Why a widget URL is refused, or null: written out as scheme://host (http(s) only, `protocols`), no user:password
 * or a bare @ before the host, no spaces, quotes, angle brackets, backslashes or control characters.
 * Exported for the test endpoint (server/widgets.js).
 */
export function widgetUrlError(url, protocols = ['http:', 'https:']) {
  if (typeof url !== 'string' || WIDGET_URL_BAD.test(url)) return 'invalid URL';
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url);
  if (!m || !m[1]) return 'invalid URL';
  let u;
  try { u = new URL(url); } catch { return 'invalid URL'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'invalid URL';
  if (!u.hostname) return 'invalid URL';
  if (!protocols.includes(u.protocol)) return 'https required';
  if (m[1].includes('@') || u.username || u.password) return 'credentials not allowed in URL';
  return null;
}

/** The stored form of a widget URL that widgetUrlError accepted: the URL parser's own (normalised) text. */
export function widgetUrlHref(url) {
  try { return new URL(url).href; } catch { return url; }
}

/**
 * One widget of config.widgets. `opts` (validateConfig): widgetTypes (types this server offers), widgetProtocols
 * (URL schemes it accepts), minWidgetRefreshSec (shortest refresh; 0 = never reload stays allowed for web pages).
 */
function sanitizeWidget(ctx, p, x, seen, opts) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  if (!WIDGET_TYPES.includes(x.type)) { ctx.err(`${p}.type`, `must be one of ${WIDGET_TYPES.join(', ')}`); return null; }
  const type = x.type;
  if (!(opts.widgetTypes ?? WIDGET_TYPES).includes(type)) ctx.err(`${p}.type`, 'not available on this server');
  const o = obj(ctx, `${p}.options`, x.options);
  if (type === 'prices') {
    return {
      id: id(ctx, `${p}.id`, typeof x.id === 'string' && x.id.startsWith(WIDGET_PREFIX) ? x.id : undefined, WIDGET_PREFIX, seen),
      type,
      name: str(ctx, `${p}.name`, x.name, '', 60).trim() || 'Widget',
      // the screens ask this server for the prices: no address, no reload interval of their own
      options: { url: '', refreshSec: 900, fit: 'contain', bust: false, prices: sanitizePriceOptions(ctx, `${p}.options.prices`, o.prices) },
    };
  }
  if (type === 'currency') {
    // exchange rates (the Divisas card's options): the screens ask this server for them (GET /api/display/currency)
    const cur = currencyProps(ctx, `${p}.options.currency`, obj(ctx, `${p}.options.currency`, o.currency));
    if (!cur.pairs.length) ctx.err(`${p}.options.currency.pairs`, 'at least one pair');
    return {
      id: id(ctx, `${p}.id`, typeof x.id === 'string' && x.id.startsWith(WIDGET_PREFIX) ? x.id : undefined, WIDGET_PREFIX, seen),
      type,
      name: str(ctx, `${p}.name`, x.name, '', 60).trim() || 'Widget',
      options: { url: '', refreshSec: 0, fit: 'contain', bust: false, currency: cur },
    };
  }
  let url = str(ctx, `${p}.options.url`, o.url, '', 2048).trim();
  if (!url) ctx.err(`${p}.options.url`, 'URL required');
  else {
    const bad = widgetUrlError(url, opts.widgetProtocols ?? ['http:', 'https:']);
    if (bad) ctx.err(`${p}.options.url`, bad);
    else url = widgetUrlHref(url);
  }
  const web = type === 'web';
  const refreshSec = oneOf(ctx, `${p}.options.refreshSec`, o.refreshSec, web ? 0 : 900, web ? WEB_WIDGET_REFRESH_SEC : WIDGET_REFRESH_SEC);
  const min = Number(opts.minWidgetRefreshSec) || 0;
  if (min && refreshSec < min && !(web && refreshSec === 0)) ctx.err(`${p}.options.refreshSec`, `must be at least ${min} seconds`);
  return {
    // only "w_" ids: an id carried from another list gets a new one
    id: id(ctx, `${p}.id`, typeof x.id === 'string' && x.id.startsWith(WIDGET_PREFIX) ? x.id : undefined, WIDGET_PREFIX, seen),
    type,
    name: str(ctx, `${p}.name`, x.name, '', 60).trim() || 'Widget',
    options: {
      url,
      refreshSec,
      fit: oneOf(ctx, `${p}.options.fit`, o.fit, 'contain', WIDGET_FITS),
      // add _marco=<time> to the image URL on every refresh (off for addresses that change by themselves, e.g. signed)
      bust: bool(ctx, `${p}.options.bust`, o.bust, true),
    },
  };
}

/** Options of an electricity price widget (server/core/pricesCore.js). */
function sanitizePriceOptions(ctx, p, v) {
  const o = obj(ctx, p, v);
  if (o.zone === undefined || o.zone === '') ctx.err(`${p}.zone`, 'zone required');
  const round = (n, k) => Math.round(n * 10 ** k) / 10 ** k;
  return {
    zone: oneOf(ctx, `${p}.zone`, o.zone === '' ? undefined : o.zone, 'DK2', PRICE_ZONE_IDS),
    view: oneOf(ctx, `${p}.view`, o.view, 'auto', PRICE_VIEWS),
    unit: oneOf(ctx, `${p}.unit`, o.unit, 'main', PRICE_UNITS),
    currency: oneOf(ctx, `${p}.currency`, o.currency, 'auto', ['auto', 'EUR']),
    // what the household pays on top, per kWh in the main unit (before VAT), and the VAT in percent
    surcharge: round(num(ctx, `${p}.surcharge`, o.surcharge, 0, MIN_SURCHARGE, MAX_SURCHARGE), 5),
    vat: round(num(ctx, `${p}.vat`, o.vat, 0, 0, MAX_VAT), 2),
    // length of the cheap stretches the widget looks for, in hours
    windowHours: num(ctx, `${p}.windowHours`, o.windowHours, 3, 1, 6, true),
    resolution: oneOf(ctx, `${p}.resolution`, o.resolution, 'hour', PRICE_RESOLUTIONS),
    // the chart's hour labels and its shape (wide with bars, or tall with a row per hour); older widgets: simple, wide
    axis: oneOf(ctx, `${p}.axis`, o.axis, 'simple', PRICE_AXES),
    chartShape: oneOf(ctx, `${p}.chartShape`, o.chartShape, 'columns', PRICE_SHAPES),
    ...sanitizeTariff(ctx, p, o),
  };
}

/**
 * The tariff a price widget adds (tariffsCore.js): none, a Danish grid company (of the widget's zone) or time bands.
 * The company and the bands are kept whichever is chosen, so switching back and forth loses nothing.
 */
function sanitizeTariff(ctx, p, o) {
  const zone = typeof o.zone === 'string' ? o.zone : 'DK2';
  const tariff = oneOf(ctx, `${p}.tariff`, o.tariff, 'none', TARIFF_MODES);
  const grid = o.grid === undefined || o.grid === '' ? '' : oneOf(ctx, `${p}.grid`, o.grid, '', GRID_IDS);
  if (tariff === 'grid') {
    if (!grid) ctx.err(`${p}.grid`, 'grid company required');
    else if (gridCompany(grid).zone !== zone) ctx.err(`${p}.grid`, `grid company is not in ${zone}`);
  }
  const out = { tariff, grid };
  if (o.bands !== undefined && o.bands !== null) out.bands = sanitizeBands(ctx, `${p}.bands`, o.bands);
  else if (tariff === 'bands') ctx.err(`${p}.bands`, 'time bands required');
  return out;
}

function sanitizeBands(ctx, p, v) {
  const o = obj(ctx, p, v);
  const listIn = Array.isArray(o.list) ? o.list : [];
  if (!Array.isArray(o.list)) ctx.err(`${p}.list`, 'expected array');
  if (listIn.length < 1 || listIn.length > MAX_BANDS) ctx.err(`${p}.list`, `between 1 and ${MAX_BANDS} bands`);
  const list = listIn.slice(0, MAX_BANDS).map((b, i) => {
    const q = `${p}.list[${i}]`;
    const x = obj(ctx, q, b);
    return {
      name: str(ctx, `${q}.name`, x.name, '', BAND_NAME_MAX).trim(),
      price: Math.round(num(ctx, `${q}.price`, x.price, 0, MIN_BAND_PRICE, MAX_BAND_PRICE) * 1e5) / 1e5,
    };
  });
  if (!list.length) list.push({ name: '', price: 0 });
  const hours = (k, v2, required) => {
    if (v2 === null || v2 === undefined) {
      if (required) ctx.err(`${p}.${k}`, 'required');
      return required ? new Array(24).fill(0) : null;
    }
    if (!Array.isArray(v2) || v2.length !== 24 || !v2.every((i) => Number.isInteger(i) && i >= 0 && i < list.length)) {
      ctx.err(`${p}.${k}`, `24 band numbers from 0 to ${list.length - 1}`);
      return required ? new Array(24).fill(0) : null;
    }
    return [...v2];
  };
  return {
    preset: oneOf(ctx, `${p}.preset`, o.preset, '', BAND_PRESET_IDS),
    list,
    weekday: hours('weekday', o.weekday, true),
    weekend: hours('weekend', o.weekend, false),
    holidays: oneOf(ctx, `${p}.holidays`, o.holidays, 'none', HOLIDAY_SETS),
  };
}

/**
 * The widgets placed on one screen, in stacking order. Placements of widgets that no longer exist are dropped
 * quietly (deleting a widget is legit), a widget placed twice keeps its first placement.
 */
function sanitizeWidgetPlacements(ctx, p, v, widgetIds) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) { ctx.err(p, 'expected array'); return []; }
  const out = [];
  const seen = new Set();
  v.forEach((x, i) => {
    const q = `${p}[${i}]`;
    if (!isObj(x)) { ctx.err(q, 'expected object'); return; }
    if (typeof x.widgetId !== 'string' || !widgetIds.has(x.widgetId) || seen.has(x.widgetId)) return;
    seen.add(x.widgetId);
    out.push({
      widgetId: x.widgetId,
      place: oneOf(ctx, `${q}.place`, x.place, 'corner', WIDGET_PLACES),
      // kept for side placements too: where it goes on layouts without a side column
      corner: oneOf(ctx, `${q}.corner`, x.corner, 'br', ['tl', 'tr', 'bl', 'br']),
      size: oneOf(ctx, `${q}.size`, x.size, 'm', WIDGET_SIZES),
    });
  });
  if (out.length > MAX_SCREEN_WIDGETS) { ctx.err(p, `too many items (max ${MAX_SCREEN_WIDGETS})`); out.length = MAX_SCREEN_WIDGETS; }
  return out;
}

/** A privacy schedule rule: days (0 = Sunday, [] = every day) and a from/to window (`to < from` crosses midnight). */
function sanitizePrivacyRule(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const out = {
    id: id(ctx, `${p}.id`, x.id, 'p_', seen),
    enabled: bool(ctx, `${p}.enabled`, x.enabled, true),
    days: weekdays(ctx, `${p}.days`, x.days),
    from: hhmm(ctx, `${p}.from`, x.from, '22:00'),
    to: hhmm(ctx, `${p}.to`, x.to, '07:00'),
  };
  if (out.from === out.to) ctx.err(`${p}.to`, 'must differ from `from`');
  return out;
}

function sanitizeLocalEvent(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const allDay = bool(ctx, `${p}.allDay`, x.allDay, true);
  const start = date(ctx, `${p}.date`, x.date, null);
  if (!start) { if (x.date === undefined) ctx.err(`${p}.date`, 'required'); return null; }
  let endDate = date(ctx, `${p}.endDate`, x.endDate, start, true) || start;
  if (endDate < start) { ctx.err(`${p}.endDate`, 'must be >= date'); endDate = start; }
  const rp = obj(ctx, `${p}.repeat`, x.repeat);
  const freq = oneOf(ctx, `${p}.repeat.freq`, rp.freq, 'none', ['none', 'weekly', 'monthly', 'yearly']);
  let until = date(ctx, `${p}.repeat.until`, rp.until, null, true);
  if (until && until < start) { ctx.err(`${p}.repeat.until`, 'must be >= date'); until = null; }
  const out = {
    id: id(ctx, `${p}.id`, x.id, 'l_', seen),
    title: requiredStr(ctx, `${p}.title`, x.title, '', 120),
    emoji: emoji(ctx, `${p}.emoji`, x.emoji, ''),
    color: color(ctx, `${p}.color`, x.color, null, true),
    location: str(ctx, `${p}.location`, x.location, '', 120).trim(),
    notes: str(ctx, `${p}.notes`, x.notes, '', 1000),
    allDay,
    date: start,
    endDate,
    startTime: allDay ? '' : hhmm(ctx, `${p}.startTime`, x.startTime ?? '', '09:00'),
    endTime: allDay ? '' : hhmm(ctx, `${p}.endTime`, x.endTime ?? '', '10:00'),
    repeat: {
      freq,
      interval: num(ctx, `${p}.repeat.interval`, rp.interval, 1, 1, 99, true),
      until,
      weekdays: freq === 'weekly' ? weekdays(ctx, `${p}.repeat.weekdays`, rp.weekdays) : [],
    },
    exceptions: arr(ctx, `${p}.exceptions`, x.exceptions, [], 200).filter(isValidDate),
    countdown: bool(ctx, `${p}.countdown`, x.countdown, false),
  };
  if (!allDay && endDate === start && out.endTime <= out.startTime) ctx.err(`${p}.endTime`, 'must be after startTime');
  return out;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function sanitizeBirthday(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const month = num(ctx, `${p}.month`, x.month, 1, 1, 12, true);
  let day = num(ctx, `${p}.day`, x.day, 1, 1, 31, true);
  if (day > DAYS_IN_MONTH[month - 1]) { ctx.err(`${p}.day`, 'invalid day for month'); day = DAYS_IN_MONTH[month - 1]; }
  const year = x.year === null || x.year === undefined || x.year === '' ? null : num(ctx, `${p}.year`, x.year, null, 1900, 2100, true);
  return {
    id: id(ctx, `${p}.id`, x.id, 'b_', seen),
    name: requiredStr(ctx, `${p}.name`, x.name, '', 80),
    month, day, year,
    emoji: emoji(ctx, `${p}.emoji`, x.emoji, ''),
  };
}

function sanitizeEventRule(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const out = {
    id: id(ctx, `${p}.id`, x.id, 'f_', seen),
    enabled: bool(ctx, `${p}.enabled`, x.enabled, true),
    action: oneOf(ctx, `${p}.action`, x.action, 'hide', ['hide', 'rename', 'style']),
    match: requiredStr(ctx, `${p}.match`, x.match, '', 120),
    matchMode: oneOf(ctx, `${p}.matchMode`, x.matchMode, 'contains', ['contains', 'exact', 'startsWith']),
    field: oneOf(ctx, `${p}.field`, x.field, 'title', ['title', 'any']),
    sourceIds: idList(ctx, `${p}.sourceIds`, x.sourceIds),
    replaceWith: str(ctx, `${p}.replaceWith`, x.replaceWith, '', 120),
    emoji: emoji(ctx, `${p}.emoji`, x.emoji, ''),
    color: color(ctx, `${p}.color`, x.color, null, true),
    countdown: bool(ctx, `${p}.countdown`, x.countdown, false),
    note: str(ctx, `${p}.note`, x.note, '', 200),
  };
  if (out.action === 'style' && !out.emoji && !out.color && !out.countdown) ctx.err(`${p}.emoji`, 'style rule needs an emoji, a color or countdown');
  return out;
}

function sanitizeCountdown(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const d = date(ctx, `${p}.date`, x.date, null);
  if (!d) { if (x.date === undefined) ctx.err(`${p}.date`, 'required'); return null; }
  return {
    id: id(ctx, `${p}.id`, x.id, 'k_', seen),
    title: requiredStr(ctx, `${p}.title`, x.title, '', 80),
    emoji: emoji(ctx, `${p}.emoji`, x.emoji, ''),
    color: color(ctx, `${p}.color`, x.color, null, true),
    date: d,
    yearly: bool(ctx, `${p}.yearly`, x.yearly, false),
  };
}

function sanitizeSchedule(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const out = {
    id: id(ctx, `${p}.id`, x.id, 'm_', seen),
    enabled: bool(ctx, `${p}.enabled`, x.enabled, true),
    title: requiredStr(ctx, `${p}.title`, x.title, '', 80),
    body: str(ctx, `${p}.body`, x.body, '', 300),
    emoji: emoji(ctx, `${p}.emoji`, x.emoji, ''),
    style: oneOf(ctx, `${p}.style`, x.style, 'info', ALERT_STYLES),
    days: weekdays(ctx, `${p}.days`, x.days),
    from: hhmm(ctx, `${p}.from`, x.from, '20:00'),
    to: hhmm(ctx, `${p}.to`, x.to, '22:00'),
    startDate: date(ctx, `${p}.startDate`, x.startDate, null, true),
    endDate: date(ctx, `${p}.endDate`, x.endDate, null, true),
    screenIds: idList(ctx, `${p}.screenIds`, x.screenIds, MAX_SCREENS),
    sound: bool(ctx, `${p}.sound`, x.sound, false),
  };
  if (out.from === out.to) ctx.err(`${p}.to`, 'must differ from `from`');
  if (out.startDate && out.endDate && out.endDate < out.startDate) ctx.err(`${p}.endDate`, 'must be >= startDate');
  return out;
}

/**
 * A carousel (core/carousels.js). `screenSlugs` = slugs taken by screens (a carousel never takes one: the URL of a
 * TV must not change by itself), `seenSlugs` = slugs of the carousels before this one (a clash gets "-2").
 * Steps that point at unknown screens are pruned later (pruneCarousels), like every other screen reference.
 */
function sanitizeCarousel(ctx, p, x, seen, screenSlugs, seenSlugs) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const name = requiredStr(ctx, `${p}.name`, x.name, '', 40);
  let slug = typeof x.slug === 'string' ? x.slug.trim().toLowerCase() : '';
  if (slug && !SLUG_RE.test(slug)) { ctx.err(`${p}.slug`, 'invalid slug (a-z, 0-9, -)'); slug = ''; }
  if (!slug) slug = slugify(name) || 'carousel';
  if (screenSlugs.has(slug)) ctx.err(`${p}.slug`, 'a screen already uses this address');
  for (let i = 2, base = slug; seenSlugs.has(slug) || screenSlugs.has(slug); i++) slug = `${base.slice(0, 29)}-${i}`;
  seenSlugs.add(slug);
  const steps = arr(ctx, `${p}.steps`, x.steps, [], MAX_CAROUSEL_STEPS).map((st, i) => {
    const q = `${p}.steps[${i}]`;
    if (!isObj(st)) { ctx.err(q, 'expected object'); return null; }
    if (typeof st.screenId !== 'string' || !ID.test(st.screenId)) { ctx.err(`${q}.screenId`, 'invalid screen id'); return null; }
    return { screenId: st.screenId, seconds: num(ctx, `${q}.seconds`, st.seconds, DEFAULT_STEP_SEC, MIN_STEP_SEC, MAX_STEP_SEC, true) };
  }).filter(Boolean);
  const off = x.offScreenId === undefined || x.offScreenId === null || x.offScreenId === '' ? null : x.offScreenId;
  if (off !== null && (typeof off !== 'string' || !ID.test(off))) ctx.err(`${p}.offScreenId`, 'invalid screen id');
  return {
    // only "v_" ids (isCarouselId); `seen` already holds the screen ids, so a carousel never shares one with a screen
    id: id(ctx, `${p}.id`, typeof x.id === 'string' && x.id.startsWith(CAROUSEL_PREFIX) ? x.id : undefined, CAROUSEL_PREFIX, seen),
    enabled: bool(ctx, `${p}.enabled`, x.enabled, true),
    name, slug,
    transition: oneOf(ctx, `${p}.transition`, x.transition, DEFAULT_TRANSITION, CAROUSEL_TRANSITIONS),
    transitionSpeed: oneOf(ctx, `${p}.transitionSpeed`, x.transitionSpeed, DEFAULT_SPEED, Object.keys(CAROUSEL_SPEEDS)),
    // a doorbell ring or an announcement on screen keeps the current step until it is gone
    holdOnAlert: bool(ctx, `${p}.holdOnAlert`, x.holdOnAlert, true),
    // night mode: keep rotating (true) or hold the off-schedule screen so the dimming does not change (false)
    nightRotate: bool(ctx, `${p}.nightRotate`, x.nightRotate, false),
    offScreenId: typeof off === 'string' && ID.test(off) ? off : null,
    // when it rotates (the rule shape of privacy schedules); [] = always
    schedule: list(ctx, `${p}.schedule`, x.schedule, [], MAX_PRIVACY_RULES, sanitizePrivacyRule),
    steps,
  };
}

const list = (ctx, path, v, d, max, fn) => {
  const seen = new Set();
  return arr(ctx, path, v, d, max).map((x, i) => fn(ctx, `${path}[${i}]`, x, seen)).filter(Boolean);
};

/** True when `c` has the v1 single-screen shape. */
export const isV1 = (c) => isObj(c) && !Array.isArray(c.screens) && !(Number(c.version) >= 2);

/**
 * v1 (single screen) → v2 (screens[]). Pure; never loses data: every v1 key lands in the global part or in
 * screens[0]. Already-v2 input is returned unchanged. See docs/ARCHITECTURE.md
 */
export function migrateConfig(raw) {
  if (!isV1(raw)) return raw;
  const c = raw;
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => isObj(o) && k in o).map((k) => [k, o[k]]));
  const omit = (o, keys) => (isObj(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) : undefined);
  const name = (isObj(c.screen) && typeof c.screen.name === 'string' && c.screen.name.trim()) || 'Living room';
  const slug = slugify(name) || 'main';
  const sid = `s_${slug.replace(/-/g, '_')}`.slice(0, 64);
  const screenProfile = { id: sid, slug, name };
  if (isObj(c.screen)) screenProfile.screen = omit(c.screen, ['name']);
  for (const k of ['layout', 'background', 'message']) if (isObj(c[k])) screenProfile[k] = c[k];
  for (const [k, keys] of Object.entries(SCREEN_SPLIT_KEYS)) if (isObj(c[k])) screenProfile[k] = pick(c[k], keys);
  const out = {
    version: CONFIG_VERSION,
    revision: c.revision,
    defaultScreen: sid,
    screens: [screenProfile],
  };
  for (const k of Object.keys(SCREEN_SPLIT_KEYS)) if (isObj(c[k])) out[k] = omit(c[k], SCREEN_SPLIT_KEYS[k]);
  for (const k of ['homeassistant', 'auth', 'security']) if (k in c) out[k] = c[k];
  return out;
}

/**
 * Validate a full (v2) config object. v1 input is migrated first. Returns { ok, errors, value }.
 * `value` is always a complete, sanitised config (defaults fill gaps); callers decide whether to persist it on errors.
 * `opts.weatherKeySet` (the admin save only): false when no weather API key is stored, so choosing a source that
 * needs one is refused (weather.apiKey 'API key required'). Left out, keys are not checked (imports, restores).
 * Widgets: `opts.widgetTypes` (default every type) refuses other types with 'not available on this server',
 * `opts.widgetProtocols` (default ['http:', 'https:']) refuses other URL schemes with 'https required', and
 * `opts.minWidgetRefreshSec` (default none) refuses shorter refreshes. Marco Cloud passes ['image'], ['https:'], 30.
 * `opts.immichAvailable` false (servers without Immich, such as Marco Cloud): a screen with the Immich source is refused.
 * Personalizado screens (core/canvasCore.js sanitizeCanvas): `opts.canvasKinds` (default every kind but the reserved
 * ones) refuses other kinds with 'not available on this server', `opts.haControls` false turns every touch control off
 * and `opts.cameraLive` false turns live cameras into snapshots. Marco Cloud passes CLOUD_CANVAS_KINDS, false, false.
 * `warnings` lists what was fixed on the way without refusing the save (a widget moved to a free spot).
 */
export function validateConfig(input, opts = {}) {
  const ctx = new Ctx();
  const D = defaultConfig();
  const c = obj(ctx, '', migrateConfig(input));

  // ---- global: calendar sources + icon rules
  const ca = obj(ctx, 'calendar', c.calendar);
  const srcSeen = new Set(RESERVED_SOURCE_IDS);
  const ruleSeen = new Set();
  const calendar = {
    sources: arr(ctx, 'calendar.sources', ca.sources, D.calendar.sources, 50)
      .map((s, i) => sanitizeSource(ctx, `calendar.sources[${i}]`, s, srcSeen)).filter(Boolean),
    iconRules: arr(ctx, 'calendar.iconRules', ca.iconRules, D.calendar.iconRules, 200)
      .map((r, i) => sanitizeRule(ctx, `calendar.iconRules[${i}]`, r, ruleSeen)).filter(Boolean),
  };

  const dt = obj(ctx, 'datetime', c.datetime);
  let tz = str(ctx, 'datetime.timezone', dt.timezone, D.datetime.timezone, 64);
  if (!isValidTimeZone(tz)) { ctx.err('datetime.timezone', 'unknown timezone'); tz = D.datetime.timezone; }
  const datetime = { timezone: tz };

  const we = obj(ctx, 'weather', c.weather);
  const entity = (p, v) => {
    const s = str(ctx, p, v, '', 255).trim();
    if (s && !/^[a-z_]+\.[a-z0-9_]+$/i.test(s)) { ctx.err(p, 'invalid entity id'); return ''; }
    return s;
  };
  const weather = {
    provider: oneOf(ctx, 'weather.provider', we.provider, D.weather.provider, WEATHER_PROVIDER_IDS),
    model: oneOf(ctx, 'weather.model', we.model, D.weather.model, OPEN_METEO_MODEL_IDS),
    locationName: str(ctx, 'weather.locationName', we.locationName, D.weather.locationName, 80),
    lat: num(ctx, 'weather.lat', we.lat, D.weather.lat, -90, 90),
    lon: num(ctx, 'weather.lon', we.lon, D.weather.lon, -180, 180),
    units: oneOf(ctx, 'weather.units', we.units, D.weather.units, ['metric', 'imperial']),
    haWeatherEntity: entity('weather.haWeatherEntity', we.haWeatherEntity),
    haIndoorTempEntity: entity('weather.haIndoorTempEntity', we.haIndoorTempEntity),
    haIndoorHumidityEntity: entity('weather.haIndoorHumidityEntity', we.haIndoorHumidityEntity),
  };
  if (opts.weatherKeySet === false && KEY_PROVIDERS.includes(weather.provider)) ctx.err('weather.apiKey', 'API key required');

  const ne = obj(ctx, 'news', c.news);
  const feedSeen = new Set();
  const news = {
    feeds: arr(ctx, 'news.feeds', ne.feeds, D.news.feeds, 20).map((f, i) => {
      const p = `news.feeds[${i}]`;
      if (!isObj(f)) { ctx.err(p, 'expected object'); return null; }
      const url = str(ctx, `${p}.url`, f.url, '', 2048).trim();
      if (!isHttpUrl(url)) ctx.err(`${p}.url`, 'invalid URL');
      return {
        id: id(ctx, `${p}.id`, f.id, 'n_', feedSeen),
        name: str(ctx, `${p}.name`, f.name, '', 80),
        url,
        enabled: bool(ctx, `${p}.enabled`, f.enabled, true),
      };
    }).filter(Boolean),
    maxItems: num(ctx, 'news.maxItems', ne.maxItems, D.news.maxItems, 1, 200, true),
  };

  const td = obj(ctx, 'todo', c.todo);
  const todo = {
    items: list(ctx, 'todo.items', td.items, [], 100, (cx, p, it, seen) => {
      if (!isObj(it)) { cx.err(p, 'expected object'); return null; }
      return { id: id(cx, `${p}.id`, it.id, 't_', seen), text: str(cx, `${p}.text`, it.text, '', 200), done: bool(cx, `${p}.done`, it.done, false) };
    }),
  };

  // ---- F2 local events + birthdays
  const le = obj(ctx, 'localEvents', c.localEvents);
  const localEvents = {
    enabled: bool(ctx, 'localEvents.enabled', le.enabled, D.localEvents.enabled),
    name: str(ctx, 'localEvents.name', le.name, D.localEvents.name, 80).trim() || D.localEvents.name,
    color: color(ctx, 'localEvents.color', le.color, D.localEvents.color),
    emoji: emoji(ctx, 'localEvents.emoji', le.emoji, D.localEvents.emoji),
    privacy: oneOf(ctx, 'localEvents.privacy', le.privacy, D.localEvents.privacy, PRIVACY_MODES),
    items: list(ctx, 'localEvents.items', le.items, [], 1000, sanitizeLocalEvent),
  };
  const bd = obj(ctx, 'birthdays', c.birthdays);
  const birthdays = {
    enabled: bool(ctx, 'birthdays.enabled', bd.enabled, D.birthdays.enabled),
    name: str(ctx, 'birthdays.name', bd.name, D.birthdays.name, 80).trim() || D.birthdays.name,
    color: color(ctx, 'birthdays.color', bd.color, D.birthdays.color),
    emoji: emoji(ctx, 'birthdays.emoji', bd.emoji, D.birthdays.emoji),
    showAge: bool(ctx, 'birthdays.showAge', bd.showAge, D.birthdays.showAge),
    tidyTitles: bool(ctx, 'birthdays.tidyTitles', bd.tidyTitles, D.birthdays.tidyTitles),
    privacy: oneOf(ctx, 'birthdays.privacy', bd.privacy, D.birthdays.privacy, PRIVACY_MODES),
    items: list(ctx, 'birthdays.items', bd.items, [], 500, sanitizeBirthday),
  };

  // ---- F3 event rules (filters / overrides)
  const er = obj(ctx, 'eventRules', c.eventRules);
  const eventRules = { items: list(ctx, 'eventRules.items', er.items, [], 200, sanitizeEventRule) };

  // ---- F4 countdowns (global list)
  const cd = obj(ctx, 'countdowns', c.countdowns);
  const countdowns = {
    items: list(ctx, 'countdowns.items', cd.items, [], 100, sanitizeCountdown),
    includeBirthdays: bool(ctx, 'countdowns.includeBirthdays', cd.includeBirthdays, D.countdowns.includeBirthdays),
    birthdayDays: num(ctx, 'countdowns.birthdayDays', cd.birthdayDays, D.countdowns.birthdayDays, 1, 366, true),
    includeFlagged: bool(ctx, 'countdowns.includeFlagged', cd.includeFlagged, D.countdowns.includeFlagged),
    horizonDays: num(ctx, 'countdowns.horizonDays', cd.horizonDays, D.countdowns.horizonDays, 1, 1000, true),
  };

  // ---- F5 scheduled messages
  const sm = obj(ctx, 'schedules', c.schedules);
  const schedules = { items: list(ctx, 'schedules.items', sm.items, [], 100, sanitizeSchedule) };

  const ha = obj(ctx, 'homeassistant', c.homeassistant);
  const haUrl = str(ctx, 'homeassistant.url', ha.url, D.homeassistant.url, 512).trim().replace(/\/+$/, '');
  if (haUrl && !isHttpUrl(haUrl)) ctx.err('homeassistant.url', 'invalid URL');
  // Doorbell camera (POST /api/hooks/doorbell): one camera entity, how long the picture stays, which screens, sound.
  const db = obj(ctx, 'homeassistant.doorbell', ha.doorbell);
  const DD = D.homeassistant.doorbell;
  let camera = str(ctx, 'homeassistant.doorbell.camera', db.camera, DD.camera, 255).trim();
  if (camera && !CAMERA_RE.test(camera)) { ctx.err('homeassistant.doorbell.camera', 'must be a camera entity id (camera.…)'); camera = ''; }
  const homeassistant = {
    enabled: bool(ctx, 'homeassistant.enabled', ha.enabled, D.homeassistant.enabled),
    url: haUrl,
    doorbell: {
      camera,
      seconds: num(ctx, 'homeassistant.doorbell.seconds', db.seconds, DD.seconds, DOORBELL_MIN_SEC, DOORBELL_MAX_SEC, true),
      screenIds: idList(ctx, 'homeassistant.doorbell.screenIds', db.screenIds, MAX_SCREENS),
      sound: bool(ctx, 'homeassistant.doorbell.sound', db.sound, DD.sound),
    },
  };
  // Cámara cards answer only displays on the home network unless the owner turns that off ("Cámaras solo en la red de
  // casa"). Kept only when off, so configs that never touched it stay exactly as they were.
  if (!bool(ctx, 'homeassistant.cameraLanOnly', ha.cameraLanOnly, true)) homeassistant.cameraLanOnly = false;

  // Immich photo library: one server per install. The API key lives in secrets.json.
  const imm = obj(ctx, 'immich', c.immich);
  const immUrl = normalizeImmichUrl(str(ctx, 'immich.url', imm.url, D.immich.url, 512));
  if (immUrl && !isHttpUrl(immUrl)) ctx.err('immich.url', 'invalid URL');
  const immich = {
    enabled: bool(ctx, 'immich.enabled', imm.enabled, D.immich.enabled),
    url: immUrl,
    insecureTls: bool(ctx, 'immich.insecureTls', imm.insecureTls, D.immich.insecureTls),
  };

  const au = obj(ctx, 'auth', c.auth);
  const emails = arr(ctx, 'auth.allowedGoogleEmails', au.allowedGoogleEmails, [], 50)
    .filter((e) => typeof e === 'string').map((e) => e.trim().toLowerCase()).filter(Boolean);
  emails.forEach((e, i) => { if (!EMAIL.test(e)) ctx.err(`auth.allowedGoogleEmails[${i}]`, 'invalid email'); });
  const auth = {
    allowedGoogleEmails: [...new Set(emails.filter((e) => EMAIL.test(e)))],
    passwordLoginEnabled: bool(ctx, 'auth.passwordLoginEnabled', au.passwordLoginEnabled, D.auth.passwordLoginEnabled),
  };

  const se = obj(ctx, 'security', c.security);
  const security = {
    displayAccess: oneOf(ctx, 'security.displayAccess', se.displayAccess, D.security.displayAccess, ['private', 'open']),
  };

  // ---- Familia (familyCore.js): members may be linked to any calendar, built-in ones included
  const family = sanitizeFamily(c.family, (path, m) => ctx.err(path, m), [...RESERVED_SOURCE_IDS, ...calendar.sources.map((s) => s.id)]);
  const familyMemberIds = family.members.map((m) => m.id);

  // ---- widgets (global definitions; screens place them, so they come first)
  const widgetSeen = new Set();
  const widgets = arr(ctx, 'widgets', c.widgets, [], MAX_WIDGETS)
    .map((x, i) => sanitizeWidget(ctx, `widgets[${i}]`, x, widgetSeen, opts)).filter(Boolean);
  const widgetIds = new Set(widgets.map((w) => w.id));
  const canvasRefs = {
    sourceIds: new Set([...RESERVED_SOURCE_IDS, ...calendar.sources.map((s) => s.id)]),
    widgets: new Map(widgets.map((w) => [w.id, w])),
  };

  // ---- F1 screens
  let rawScreens = arr(ctx, 'screens', c.screens, D.screens, MAX_SCREENS);
  if (!rawScreens.length) { ctx.err('screens', 'at least one screen'); rawScreens = D.screens; }
  const seenIds = new Set();
  const seenSlugs = new Set();
  const screens = rawScreens.map((s, i) => sanitizeScreenProfile(ctx, `screens[${i}]`, s, seenIds, seenSlugs, familyMemberIds, widgetIds, canvasRefs, opts));
  if (opts.immichAvailable === false) {
    screens.forEach((s, i) => { if (s.background.source === 'immich') ctx.err(`screens[${i}].background.source`, 'Immich is not available'); });
  }
  // Drop references to sources / screens that no longer exist (silently: deleting a source is legit).
  const knownSources = new Set([...RESERVED_SOURCE_IDS, ...calendar.sources.map((s) => s.id)]);
  for (const s of screens) if (s.calendar.sourceIds) s.calendar.sourceIds = s.calendar.sourceIds.filter((x) => knownSources.has(x));
  const screenIds = new Set(screens.map((s) => s.id));
  // "Ir a pantalla" cards that point at a deleted screen: not chosen any more (the card says so in the editor)
  for (const s of screens) {
    for (const it of s.canvas?.items ?? []) if (it.kind === 'nav.button' && it.props.target && it.props.target !== 'home' && !screenIds.has(it.props.target)) it.props.target = '';
  }
  for (const m of schedules.items) {
    const keep = m.screenIds.filter((x) => screenIds.has(x));
    // Every target screen is gone: an empty list would mean "all screens", so retire it instead
    // (same rule as announce.js pruneScreens). The admin shows it disabled with "todas".
    if (m.screenIds.length && !keep.length) m.enabled = false;
    m.screenIds = keep;
  }
  // Doorbell screens that were deleted are dropped; when none is left the ring goes to the default screen only
  // (an empty list would mean every screen, and a camera picture should not spread to screens nobody chose).
  const dbKeep = homeassistant.doorbell.screenIds.filter((x) => screenIds.has(x));
  const dbLost = homeassistant.doorbell.screenIds.length && !dbKeep.length;
  homeassistant.doorbell.screenIds = dbKeep;
  let defaultScreen = typeof c.defaultScreen === 'string' ? c.defaultScreen : screens[0].id;
  if (!screenIds.has(defaultScreen)) {
    if (c.defaultScreen !== undefined) ctx.err('defaultScreen', 'unknown screen id');
    defaultScreen = screens[0].id;
  }

  if (dbLost) homeassistant.doorbell.screenIds = [defaultScreen];

  // ---- carousels (global; steps that point at deleted screens are dropped, an empty carousel is turned off)
  const ca2 = obj(ctx, 'carousels', c.carousels);
  const carSeen = new Set(screenIds);
  const carSlugs = new Set();
  const screenSlugs = new Set(screens.map((s) => s.slug));
  const carousels = {
    items: pruneCarousels(
      arr(ctx, 'carousels.items', ca2.items, [], MAX_CAROUSELS)
        .map((x, i) => sanitizeCarousel(ctx, `carousels.items[${i}]`, x, carSeen, screenSlugs, carSlugs)).filter(Boolean),
      screenIds,
    ),
  };
  // weather places (#11): at most MAX_SCREEN_WEATHER_PLACES per screen, MAX_WEATHER_PLACES in the whole config
  screens.forEach((s, i) => {
    if (countScreenPlaces({ weather }, s) > MAX_SCREEN_WEATHER_PLACES) ctx.err(`screens[${i}].weather.place`, `too many weather places on this screen (max ${MAX_SCREEN_WEATHER_PLACES})`);
  });
  if (configWeatherPlaces({ weather, screens }).length > MAX_WEATHER_PLACES) ctx.err('weather.places', `too many weather places (max ${MAX_WEATHER_PLACES})`);
  const revision = Number.isInteger(c.revision) && c.revision > 0 ? c.revision : 1;
  const value = {
    version: CONFIG_VERSION, revision, defaultScreen, screens,
    calendar, datetime, weather, news, todo, localEvents, birthdays, eventRules, countdowns, schedules, carousels, widgets, homeassistant, immich, auth, security, family,
  };
  return { ok: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings, value };
}

/**
 * Deep-merge stored config over defaults (missing keys → defaults; arrays replaced wholesale).
 * v1 input is migrated first; every screen profile is merged over defaultScreenProfile().
 */
export function mergeDefaults(stored) {
  const D = defaultConfig();
  const merge = (d, s) => {
    if (!isObj(d) || !isObj(s)) return s === undefined ? d : s;
    const out = { ...d };
    for (const k of Object.keys(s)) out[k] = k in d ? merge(d[k], s[k]) : s[k];
    return out;
  };
  const src = migrateConfig(isObj(stored) ? stored : {});
  const out = merge(D, src);
  if (Array.isArray(src.screens) && src.screens.length) {
    // a screen saved before display styles existed keeps the Classic look; only new screens start Modern
    const keepStyle = (s) => (isObj(s.screen) && 'style' in s.screen ? s : { ...s, screen: { ...(isObj(s.screen) ? s.screen : {}), style: 'classic' } });
    // the same for compact busy days: screens saved before the option keep the month grid they had
    const keepGrid = (s) => (isObj(s.calendar) && 'compactBusyDays' in s.calendar ? s : { ...s, calendar: { ...(isObj(s.calendar) ? s.calendar : {}), compactBusyDays: false } });
    // a Personalizado screen saved before 0.17 has no canvas.grid: it must stay without one (the 'fine' of the
    // defaults would read its 12×8 positions as cells of the 24×16 grid), so sanitizeCanvas converts it
    const legacyCanvas = (s, m) => {
      if (isObj(s.canvas) && !('grid' in s.canvas) && isObj(m.canvas)) delete m.canvas.grid;
      return m;
    };
    out.screens = src.screens.map((s) => (isObj(s) ? legacyCanvas(s, merge(defaultScreenProfile({ id: s.id, slug: s.slug, name: s.name }), keepGrid(keepStyle(s)))) : s));
  }
  return out;
}

export { SCREEN_ONLY_KEYS, SCREEN_SPLIT_KEYS };
