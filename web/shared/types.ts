// Shared JSON contracts, see docs/API.md and docs/ARCHITECTURE.md. Imported by both the display and the admin panel.
// Keep in sync with the server (server/core/validate.js, server/core/defaults.js).
import type { PhotoFrame } from './focus';

export type Lang = 'es' | 'en' | 'pt' | 'nl' | 'da' | 'pl';
export type LayoutPreset =
  | 'bigCalendar' | 'leftRight' | 'topBottom' | 'bigTime' | 'agenda'
  | 'today' | 'people' | 'photoFrame' | 'twoWeeks' | 'board' | 'bedside' | 'planner'
  // one widget fills the screen (layout.widgetId)
  | 'widget'
  // kids layouts (Modern style only; with Classic the display shows bigCalendar)
  | 'kidsRoutines' | 'kidsFamily' | 'kidsMeals'
  // Personalizado: widgets placed on a grid (screen.canvas, server/core/canvasCore.js); Modern style only
  | 'canvas';
/** Corner of the clock card in the 'photoFrame' layout: top-left, top-right, bottom-left, bottom-right. */
export type FrameCorner = 'tl' | 'tr' | 'bl' | 'br';
export type SourceKind = 'generic' | 'airbnb' | 'birthdays' | 'holidays';
export type SourceType = 'ics' | 'google' | 'microsoft';
export type DateFormat = 'weekday_month_d' | 'weekday_d_month' | 'weekday_d_dot_month' | 'weekday_month_d_y' | 'weekday_mdy' | 'weekday_dmy' | 'weekday_iso' | 'custom';
/** Every date format, in the order the admin offers them. */
export const DATE_FORMATS: DateFormat[] = ['weekday_d_month', 'weekday_month_d', 'weekday_d_dot_month', 'weekday_month_d_y', 'weekday_mdy', 'weekday_dmy', 'weekday_iso', 'custom'];

export interface NightMode {
  enabled: boolean;
  from: string; // "HH:MM"
  to: string; // "HH:MM"
  dim: number; // 0..1 (brightness multiplier applied at night)
}

export type DisplayStyle = 'classic' | 'modern';

/** Glass material of the Modern style (like iOS Liquid Glass): ignored by Classic. */
export interface GlassConfig {
  /** 'auto' follows the photo (clearer over dark photos, more tinted over bright ones); 'clear' or 'tinted' fix it. */
  appearance: 'auto' | 'clear' | 'tinted';
  /** 0 = most see-through, 1 = most solid (0.5 = the default Modern look). */
  opacity: number;
  /** Background blur, 0..40 (0 = none). */
  blur: number;
  /** Tint colour: dark, light, or taken from the current photo. */
  tint: 'dark' | 'light' | 'photo';
  /** Thin light ring along the card edge. */
  edge: boolean;
}

export interface ScreenConfig {
  name: string;
  language: Lang;
  fontScale: number;
  theme: 'dark' | 'light' | string;
  /** Display style, independent of the layout: 'classic' (default) or 'modern' (glass cards, Apple-like). */
  style?: DisplayStyle;
  /** Glass options for the Modern style. Missing = defaults (GLASS_DEFAULTS). */
  glass?: GlassConfig;
  accent: string;
  orientation: 'auto' | 'landscape' | 'portrait' | string;
  customCss: string;
  nightMode: NightMode;
  /** The pills under the date of the usual designs: next event, happening now, birthdays, check-in/out (default true).
   *  Not the Personalizado "highlights" card. Older servers: absent (= shown). */
  highlights?: boolean;
  /** "Sonando ahora bajo el reloj": the opaque id of a linked Spotify account whose track shows on one line under the
   *  clock of the usual designs ('' or absent = off). Not used by Personalizado (it has its own card). */
  nowPlaying?: string;
}

export interface LayoutConfig {
  preset: LayoutPreset;
  sidePanel: 'left' | 'right';
  sideWidth: number; // 0..1 fraction of the screen width
  /** 'people' layout: calendar ids shown as columns (max 5); null / missing = automatic. */
  people?: string[] | null;
  /** 'photoFrame' layout: corner of the clock card (default 'br'). */
  corner?: FrameCorner;
  /** 'widget' layout: the widget shown full screen (null / missing = none chosen). */
  widgetId?: string | null;
  /** 'planner' layout on a landscape screen: clock and weather in the side column (default), or a strip above / below the month. */
  plannerBar?: PlannerBar;
}

export type PlannerBar = 'side' | 'top' | 'bottom';

// ---- Widgets (server/validate.js sanitizeWidget, server/screens.js displayWidgets) ----

export type WidgetType = 'image' | 'web' | 'prices' | 'currency';
export type WidgetPlace = 'corner' | 'side';
export type WidgetSize = 's' | 'm' | 'l';
export type WidgetFit = 'contain' | 'cover';
export interface WidgetOptions {
  /** http(s) address of the image or page (<= 2048 chars, no user:password) */
  url: string;
  /** seconds between reloads; image: 1 .. 86400, web: 0 (never) or 30 .. 86400 */
  refreshSec: number;
  fit: WidgetFit;
  /** image: add _marco=<time> to the address on every reload (off for addresses that change by themselves) */
  bust: boolean;
  /** type 'prices' only (its url is empty) */
  prices?: PriceWidgetOptions;
  /** type 'currency' only (its url is empty) */
  currency?: CurrencyOptions;
}
/** Exchange rates (the Divisas card's props and the Currency widget's options; server/core/canvasCore.js currencyProps). */
export interface CurrencyOptions {
  /** 1 to 6 pairs of ISO 4217 codes, worked out through the euro (ECB reference rates) */
  pairs: { base: string; quote: string }[];
  layout: 'list' | 'big';
  range: '7d' | '30d' | '1y';
  chart: 'area' | 'line' | 'none';
  chartStyle: 'below' | 'background';
}
export type PriceView = 'auto' | 'chart' | 'now' | 'cheap' | 'next';
export type PriceAxis = 'simple' | '3h' | '1h';
export type PriceShape = 'columns' | 'rows';
/** Time bands a household pays on top of the market price (server/core/tariffsCore.js). */
export interface PriceBands {
  /** '' (custom), 'es-20td' (Spain 2.0TD), 'es-20td-cm' (Ceuta and Melilla): only fills the hours */
  preset: string;
  /** 1 .. 4 bands: a name and a price per kWh in the main unit, before VAT */
  list: { name: string; price: number }[];
  /** band index of each hour 0..23 on working days */
  weekday: number[];
  /** band index of each hour on Saturdays, Sundays and holidays; null = as on working days */
  weekend: number[] | null;
  /** holidays that take the weekend hours: 'none' | 'ES' (Spain's national fixed-date holidays) */
  holidays: string;
}
/** Electricity price widget (server/core/pricesCore.js, server/core/validate.js sanitizePriceOptions). */
export interface PriceWidgetOptions {
  /** bidding zone id (PRICE_ZONES), e.g. 'DK2', 'ES-PVPC', 'DE-LU' */
  zone: string;
  /** auto: by placement (corner: price now; side: now + chart; full screen: chart, now and cheap stretches) */
  view: PriceView;
  /** main: €/kWh, kr/kWh; sub: c/kWh, øre/kWh */
  unit: 'main' | 'sub';
  /** auto: the zone's own currency where the source gives it (DKK), else EUR */
  currency: 'auto' | 'EUR';
  /** fixed amount per kWh added before VAT (grid fees, taxes, supplier), main unit; -10 .. 100 */
  surcharge: number;
  /** VAT percent on the whole, 0 .. 50 */
  vat: number;
  /** length of the cheap stretches in hours, 1 .. 6 */
  windowHours: number;
  /** chart bars: hourly averages or quarter hours */
  resolution: 'hour' | 'quarter';
  /** hour labels under the chart: 00 06 12 18 ('simple'), every 3 hours, every hour (fewer when they would touch); older widgets: none = simple */
  axis?: PriceAxis;
  /** 'columns': the wide card with bars (the default, also for older widgets); 'rows': the tall card, one row per hour */
  chartShape?: PriceShape;
  /** what is added per hour before VAT: a Danish grid company's tariffs ('grid'), time bands, or nothing */
  tariff?: 'none' | 'grid' | 'bands';
  /** grid company id (server/tariffsCore.js DK_GRID_COMPANIES), of the widget's zone */
  grid?: string;
  bands?: PriceBands;
}
/** GET /api/display/prices?zone= (server/prices.js getPrices) */
export interface PricesResponse {
  zone: string;
  /** the zone's own currency ('DKK', 'EUR') */
  currency: string;
  /** the local prices were converted from euros (the source gave none) */
  converted: boolean;
  source: string | null;
  /** who to credit on screen, e.g. 'Energinet' */
  credit: string;
  fetchedAt: string;
  /** the prices no longer cover now, or the last refreshes failed for a while */
  stale: boolean;
  error: string | null;
  /** [start (unix s), minutes, EUR/MWh, local/MWh?] in time order */
  slots: [number, number, number, number?][];
  /** with &grid=: the grid company's tariffs per hour (server/tariffs.js) */
  grid?: GridTariffs;
}
/** Danish grid tariffs per hour, DKK/kWh before VAT: [start (unix s), company tariff, Energinet tariffs, electricity tax, estimated 0|1] */
export interface GridTariffs {
  id: string;
  name: string;
  credit: string;
  fetchedAt: string | null;
  error: string | null;
  hours: [number, number, number, number, number][];
}
/** POST /api/admin/test/prices { zone } */
export type TestPricesResponse = ({ ok: true } & PricesResponse) | { ok: false; error: string };
/** config.widgets[]: what a widget shows. Where it shows is chosen per screen. */
export interface WidgetDef {
  id: string; // "w_xxx"
  type: WidgetType;
  name: string;
  options: WidgetOptions;
}
/** screen.widgets[]: a widget on one screen, in stacking order. */
export interface WidgetPlacement {
  widgetId: string;
  place: WidgetPlace;
  /** where it goes (also for 'side' on layouts without a side column) */
  corner: FrameCorner;
  size: WidgetSize;
}
/** DisplayConfig.widgets[]: one widget as the display loads it. */
export interface DisplayWidget {
  id: string;
  type: WidgetType;
  name: string;
  place: 'corner' | 'side' | 'full' | 'canvas';
  corner: FrameCorner;
  size: WidgetSize;
  refreshSec: number;
  fit: WidgetFit;
  bust: boolean;
  /** what the display loads: the URL itself (self-hosted) or /api/display/widget/<id> (Marco Cloud) */
  src: string;
  /** 'direct' (img/iframe src = the URL) or 'proxy' (fetched with the display credential, shown as a blob) */
  via: 'direct' | 'proxy';
  /** short hash of type + url + refreshSec + bust: changes when the saved widget changes */
  v: string;
  /** type 'prices': what to draw (the display fetches /api/display/prices?zone=) */
  prices?: PriceWidgetOptions;
  /** type 'currency': what to draw (the display fetches /api/display/currency?pairs=) */
  currency?: CurrencyOptions;
}
/** POST /api/admin/test/widget { type, url } */
export interface TestWidgetResponse {
  ok: boolean;
  /** invalid_url, timeout, fetch_failed, http_not_found, http_denied, http_error, too_many_redirects, too_large, not_image… */
  error?: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
  /** 'http_on_https', 'refuses_framing', 'large_image', 'same_origin' */
  warnings?: string[];
  /** Marco Cloud: admin-only address of the copy the screens get */
  previewUrl?: string;
}

/** Albums a screen plays when its background source is 'immich'. */
export interface ImmichBackground {
  /** Immich album ids (UUIDs), at most 20; [] = stock photos */
  albumIds: string[];
  /** only photos marked as favourite in Immich */
  favoritesOnly: boolean;
}

/** Photos whose orientation differs from the screen: blurred copy behind the whole photo, or the usual crop.
 *  'auto' = blurred fill for Immich photos, crop for the gallery and stock (the look screens had before). */
export type PortraitFit = 'auto' | 'blur' | 'crop';

/** Where the background photo goes: the side area of the layout (the original look) or the whole screen, with the
 *  calendar and the other panels drawn over it as glass (web/shared/glass.ts). */
export type BackgroundScope = 'side' | 'screen';

export interface BackgroundConfig {
  enabled: boolean;
  source: 'stock' | 'gallery' | 'mixed' | 'immich';
  stockTopic: string;
  /** gallery rotation order: shuffled (no immediate repeats), newest upload first, or by file name */
  order?: 'random' | 'newest' | 'name';
  intervalSec: number;
  brightness: number;
  showMeta: boolean;
  cover: boolean;
  transition: 'webgl' | 'fade' | 'none';
  ambient: 'aurora' | 'particles' | 'none';
  /** frosted weather card: backdrop blur (px at 1080p, 0 = off) and darkness (0..1, 0.5 = default) */
  panelBlur?: number;
  panelShade?: number;
  /** effect over the photo for the current weather: none, light rain/snow particles, or drops on the glass with sun rays */
  weatherFx?: 'off' | 'simple' | 'rich';
  portraitFit?: PortraitFit;
  immich?: ImmichBackground;
  /** 'side' (default) or 'screen': one photo behind the whole screen */
  scope?: BackgroundScope;
  /** with scope 'screen': how solid the calendar glass is, 0 = most see-through, 1 = almost opaque (default 0.5) */
  calendarOpacity?: number;
  /** Blur of the photo behind that calendar glass, 0..40 (0 = none). */
  calendarBlur?: number;
  /** "Fondos especiales" (#14): other photos on some days, the first rule that matches wins (server/core/bgRules.js).
   *  Admin only: the display config never carries them, /api/photos applies them. */
  rules?: BackgroundRule[];
  /** Display config only: the screen has special background rules (never the rules themselves), so the display asks for
   *  its photos again when the events, the config or the day change (Marco Cloud pushes no `photos` event for them). */
  special?: boolean;
}

/** When a special background rule holds: an event today whose title has `text` (accents and case ignored; in
 *  `calendars`, [] = the calendars the screen shows), a yearly range of days (MM-DD to MM-DD, `to < from` wraps the
 *  year end), one yearly day, or someone's birthday today (the Cumpleaños list). */
export type BackgroundRuleWhen =
  | { type: 'event'; text: string; calendars: string[] }
  | { type: 'range'; from: string; to: string }
  | { type: 'date'; on: string }
  | { type: 'birthday' };

/** The photos of a special background rule: gallery files (at most 50) or one Immich album. */
export type BackgroundRulePhotos = { source: 'gallery'; files: string[] } | { source: 'immich'; albumId: string };

export interface BackgroundRule {
  id: string;
  when: BackgroundRuleWhen;
  photos: BackgroundRulePhotos;
}

export interface CalendarSource {
  id: string;
  type: SourceType;
  name: string;
  url?: string; // ics only
  /** Sent by multi-tenant servers instead of the URL when the session has not signed in recently. The URL comes back
   *  empty, and saving a known calendar with an empty URL keeps the stored one. Never stored. */
  urlHidden?: boolean;
  googleCalendarId?: string; // google only
  googleAccount?: string; // google only
  /** Microsoft Graph calendar id (Outlook.com, Hotmail, Microsoft 365). Marco Cloud only for now. */
  microsoftCalendarId?: string; // microsoft only
  microsoftAccount?: string; // microsoft only
  color: string;
  emoji?: string;
  kind: SourceKind;
  enabled: boolean;
  refreshMin: number;
  /** what privacy mode does to its events (missing = 'busy', or 'keep' for holidays and birthdays) */
  privacy?: PrivacyMode;
}

/** Per calendar, while a screen is private: 'busy' = shown as "Busy" (time and colour only), 'hide' = left out,
 *  'keep' = shown as it is. */
export type PrivacyMode = 'busy' | 'hide' | 'keep';

/** A rule that turns privacy mode on by itself (same days / from / to rules as scheduled messages). */
export interface PrivacyRule {
  id: string; // "p_xxx"
  enabled: boolean;
  /** 0 = Sunday … 6; [] = every day. A window that crosses midnight belongs to the day it starts. */
  days: number[];
  from: string; // HH:MM
  to: string; // HH:MM; `to < from` crosses midnight
}

/** One step of a carousel: a screen and how long it stays (10..3600 s). The same screen may come back later. */
export interface CarouselStep {
  screenId: string;
  seconds: number;
}

/** Animation between two screens of a carousel; 'random' picks another one at each switch, the same on every TV. */
export type CarouselTransition = 'fade' | 'slide' | 'zoom' | 'wipe' | 'dissolve' | 'random' | 'none';
/** How long that animation lasts: fast 400 ms, normal 800 ms, slow 1400 ms. */
export type CarouselSpeed = 'fast' | 'normal' | 'slow';

/**
 * A carousel (StoredConfig.carousels.items, server/core/carousels.js): screens shown one after another on the same
 * TV, in a loop. Displays point at it like at a screen (slug, private link, paired device). Every TV on the same
 * carousel changes screen at the same moment.
 */
export interface Carousel {
  id: string; // "v_xxx"
  enabled: boolean;
  name: string; // ≤ 40
  /** URL address (/?screen=<slug>); never the slug of a screen */
  slug: string;
  transition: CarouselTransition;
  /** absent in configs saved before speeds existed (= 'normal') */
  transitionSpeed?: CarouselSpeed;
  /** a doorbell ring or an announcement on screen keeps the current step until it is gone */
  holdOnAlert: boolean;
  /** night mode: keep rotating (each screen with its own night settings) or hold `offScreenId` (false) */
  nightRotate: boolean;
  /** shown outside the schedule and held at night; null = the first step's screen */
  offScreenId: string | null;
  /** when it rotates (same rule shape as privacy schedules); [] = always */
  schedule: PrivacyRule[];
  steps: CarouselStep[]; // ≤ 12
}

/** `carousel` of GET /api/display/config: valid steps only (with slug and name), off screen resolved. */
export interface CarouselBlock {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  transition: CarouselTransition;
  /** absent from servers older than 0.7 (= 'normal') */
  transitionSpeed?: CarouselSpeed;
  holdOnAlert: boolean;
  nightRotate: boolean;
  offScreenId: string;
  schedule: PrivacyRule[];
  steps: (CarouselStep & { slug: string; name: string })[];
}

export type DisplayTargetKind = 'screen' | 'carousel';

/** What a display is bound to (DisplayConfig.target). */
export interface DisplayTarget {
  id: string;
  kind: DisplayTargetKind;
  slug: string;
  name: string;
}

/** Per-screen privacy settings (ScreenProfile.privacy). */
export interface ScreenPrivacyConfig {
  /** while private, the background and photo frame use stock photos only */
  hidePhotos: boolean;
  /** small lock on the display while private */
  showLock: boolean;
  schedule: PrivacyRule[];
}

/** `privacy` of GET /api/display/config. */
export interface DisplayPrivacy {
  active: boolean;
  /** when it ends (ISO); null while active = until someone turns it off */
  until: string | null;
  /** show the lock */
  lock: boolean;
  /** ask again at this time even without a live event (a period ends, a rule starts); null = nothing planned */
  next: string | null;
}

/** One screen in GET /api/admin/privacy (and /api/hooks/privacy). */
export interface PrivacyScreenState {
  screenId: string;
  slug: string;
  name: string;
  active: boolean;
  until: string | null;
  /** who turned it on (or paused the schedule): 'admin', 'hook', 'schedule'; null when off and nothing set */
  by: 'admin' | 'hook' | 'schedule' | null;
  /** a manual "off" pauses the schedule until then */
  resumesAt: string | null;
  /** the screen has schedule rules */
  scheduled: boolean;
}

export interface PrivacyResponse {
  screens: PrivacyScreenState[];
}

/** POST /api/admin/privacy and /api/hooks/privacy. Use at most one of hours, until and untilTime; none = until
 *  turned off. */
export interface PrivacyRequest {
  mode: 'on' | 'off' | 'toggle';
  hours?: number;
  /** ISO date and time */
  until?: string;
  /** HH:MM: the next time it comes round in the configured time zone */
  untilTime?: string;
  /** slugs or ids; omitted or [] = every screen */
  screens?: string[];
}

export interface PrivacyChangeResponse {
  ok: boolean;
  /** screens whose privacy turned on or off */
  changed: string[];
  screens: PrivacyScreenState[];
}

/** Public projection of a source sent to the display (no urls / account info). */
export interface PublicCalendarSource {
  id: string;
  name: string;
  color: string;
  emoji?: string;
  kind: SourceKind;
}

export interface IconRule {
  id: string;
  match: string[];
  emoji: string;
  color: string | null;
}

export type CalendarWeeks = number | 'auto';
export type EventStyle = 'lines' | 'cards';
/** calendar.startOn: the grid starts on the first day of this week (weekStart) or on today. */
export type CalendarStartOn = 'week' | 'today';
/** Days the agenda view looks ahead, or 'auto': Today and Tomorrow, then the next days with events until it is full. */
export type AgendaDays = 'auto' | 7 | 14 | 30;

export interface CalendarConfig<S = CalendarSource> {
  enabled: boolean;
  view: 'month' | 'agenda' | 'week';
  /** Week rows of the month view, or 'auto': 2 to 6 rows, as many as fit maxEventsPerDay events per day. */
  weeks: CalendarWeeks;
  weekStart: number; // 0 = Sunday, 1 = Monday
  /**
   * Month / week grid: 'week' (default) starts on the first day of this week (weekStart); 'today' shows no past days,
   * the first cell is today and the rows run on 7 days at a time (the column headers follow).
   */
  startOn: CalendarStartOn;
  showLocation: boolean;
  showEndTime: boolean;
  showDayXofY: boolean;
  showLegend: boolean;
  hidePast: boolean;
  maxEventsPerDay: number;
  /** Titles cut short in bars and lists slide slowly to show the rest (default true). */
  marquee: boolean;
  /** A day with more events than fit in the month grid pages through them every few seconds (default true). */
  rotateBusyDays: boolean;
  /**
   * Month / week grid: a day that cannot fit its events at normal size shows them as small one-line entries, and week
   * rows share the height by how many events they have (on for new screens, off for screens saved before it).
   */
  compactBusyDays: boolean;
  /**
   * Month / week grid: 'lines' (one-line chips, the original look) or 'cards' (time on top, title below on up to two
   * lines, stacked in the day; multi-day events stay bars). Cards take precedence over compactBusyDays inside a day.
   */
  eventStyle: EventStyle;
  /**
   * Agenda view: how many days ahead it looks (7, 14 or 30), or 'auto' (default): Today and Tomorrow, then the next days
   * with events, as many as fit (never fewer than 14 days would show). The compact side agenda always shows 3 days.
   */
  agendaDays: AgendaDays;
  /** v2, per screen: null = every enabled source (incl. 'local' + 'birthdays'); array = only these ids. */
  sourceIds?: string[] | null;
  sources: S[];
  iconRules: IconRule[];
}

export interface DateTimeConfig {
  enabled: boolean;
  timezone: string;
  clock: 'digital' | 'analog';
  format24: boolean;
  showSeconds: boolean;
  showAmPm: boolean;
  dateFormat: DateFormat;
  /** pattern for dateFormat 'custom': {dddd} {ddd} {d} {dd} {mmmm} {mmm} {m} {mm} {yyyy} {yy} plus any text */
  dateCustom?: string;
}

/** Weather data sources (server/core/weather.js). 'homeassistant' = Open-Meteo plus a Home Assistant entity (self-hosted). */
export type WeatherProvider = 'open-meteo' | 'met-norway' | 'pirate-weather' | 'homeassistant';
/** Open-Meteo forecast models offered in the admin ('best_match' = Open-Meteo picks). */
export type OpenMeteoModel = 'best_match' | 'ecmwf_ifs' | 'icon_seamless' | 'gfs_seamless' | 'meteofrance_seamless' | 'ukmo_seamless' | 'gem_seamless' | 'jma_seamless';

export interface WeatherConfig {
  enabled: boolean;
  provider: WeatherProvider;
  /** forecast model when the data comes from Open-Meteo (open-meteo, homeassistant) */
  model: OpenMeteoModel;
  locationName: string;
  lat: number;
  lon: number;
  units: 'metric' | 'imperial';
  forecastDays: number;
  showHourly: boolean;
  showPrecipChance: boolean;
  /**
   * Per screen ("Ubicación de esta pantalla", #11): null = the household's place (locationName, lat, lon), or another
   * place for every layout of this screen. Since 0.17; missing = null.
   */
  place?: WeatherPlace | null;
  haWeatherEntity: string;
  haIndoorTempEntity: string;
  haIndoorHumidityEntity: string;
}

/** A place for the weather: a name as the screen shows it and its coordinates (server/core/weatherPlaces.js). */
export interface WeatherPlace {
  name: string;
  lat: number;
  lon: number;
}

export interface NewsFeed {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface NewsConfig {
  enabled: boolean;
  feeds: NewsFeed[];
  rotateSec: number;
  maxItems: number;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  /** Display config only, tasks of a Microsoft To Do list (id ms_..., opaque): the due day, YYYY-MM-DD */
  due?: string;
  /** Display config only: the task is marked important in Microsoft To Do (a star) */
  important?: boolean;
  /** Display config only: a touch screen may tick it (POST /api/display/todo/toggle) */
  tick?: boolean;
  /** Display config only: the list it comes from, 'local' (typed in Marco) or a todo.lists id (tl_...) */
  list?: string;
}

/** Which tasks a to-do surface shows (server/core/todoCore.js): all, the starred ones, the ones due today or before. */
export type TodoFilter = 'all' | 'important' | 'due';

/**
 * What one to-do surface shows (#15): the to-do part of a screen (screen.todo) or a to-do card on a Personalizado
 * screen (its props). server/core/todoCore.js validates and applies it.
 */
export interface TodoView {
  /** 'local' (the typed tasks) and todo.lists ids; null = every list */
  listIds: string[] | null;
  /** '' = "Tareas", or the list's name when there is one list */
  title: string;
  /** an emoji before the title ('' = the usual one) */
  icon: string;
  filter: TodoFilter;
}

/** A Microsoft To Do list shown on the to-do list (config todo.lists). Its tasks are read by the server. */
export interface TodoList {
  id: string; // tl_...
  type: 'microsoft';
  microsoftAccount: string;
  microsoftListId: string;
  name: string;
  enabled: boolean;
}

export interface TodoConfig extends Partial<TodoView> {
  enabled: boolean;
  items: TodoItem[];
  /** Microsoft To Do lists (admin config; never in the display config, which gets their tasks in `items`) */
  lists?: TodoList[];
  /** Display config only: tasks with `tick` may be ticked by touching this screen */
  touch?: boolean;
  /** Display config only: the names of the lists this screen's headings use (todo.lists id → name) */
  listNames?: Record<string, string>;
}

export interface MessageConfig {
  enabled: boolean;
  text: string;
  emoji: string;
}

/** Immich photo library (one server per install). The API key is stored on the server only. */
export interface ImmichConfig {
  enabled: boolean;
  /** e.g. http://immich.local:2283 (no trailing /api) */
  url: string;
  /** accept a self-signed HTTPS certificate */
  insecureTls: boolean;
}

/** POST /api/admin/test/immich. `error`: not_configured, key_missing, invalid_url, invalid_key, missing_scope,
 *  not_found, unreachable, bad_response, http. */
export interface TestImmichResponse {
  ok: boolean;
  version?: string;
  /** required scopes the key lacks (album.read, asset.read, asset.view) */
  missingScopes?: string[];
  error?: string;
}

/** GET /api/admin/immich/albums item. */
export interface ImmichAlbum {
  id: string;
  name: string;
  count: number;
  /** cover asset id (thumbnail at /media/immich/<cover>?s=thumb, admin session only) */
  cover: string | null;
  shared: boolean;
  start: string | null;
  end: string | null;
}

/** GET /api/admin/immich/status (also the answer of POST /api/admin/immich/refresh). */
export interface ImmichStatus {
  usable: boolean;
  /** albums some screen plays: photos cached (null = not fetched yet), last fetch, last error code, deleted / unshared */
  albums: { id: string; favoritesOnly: boolean; count: number | null; updatedAt: string | null; error: string | null; missing: boolean }[];
  cache: { files: number; bytes: number };
}

/** GET/PUT /api/admin/immich/key: the key itself is never sent back. */
export interface ImmichKeyStatus {
  set: boolean;
  hint: string;
  /** PUT only: Immich accepted the key on a test call */
  checked?: boolean;
}

export interface HomeAssistantConfig {
  enabled: boolean;
  url: string;
  /** Doorbell camera settings (POST /api/hooks/doorbell). */
  doorbell: DoorbellSettings;
  /**
   * Cámara cards of Personalizado screens answer only displays on the home network (default, absent = true). false:
   * a display opened through PUBLIC_URL or a tunnel shows them too.
   */
  cameraLanOnly?: boolean;
}

export interface DoorbellSettings {
  /** camera.* entity whose picture is shown; '' = no picture, only the label and the chime */
  camera: string;
  /** how long a ring stays on screen, 10..300 */
  seconds: number;
  /** screens that show it; [] = every screen */
  screenIds: string[];
  /** door chime on the displays */
  sound: boolean;
}

export interface AuthConfig {
  allowedGoogleEmails: string[];
  passwordLoginEnabled: boolean;
}

// ---- display access: private links + paired devices (docs/API.md "Display access") ----

/** 'private': displays need their private link (/d/<key>) or a paired-device token. 'open': legacy LAN mode. */
export type DisplayAccessMode = 'private' | 'open';
export type DisplayAccessVia = 'key' | 'device' | 'session' | 'open';

export interface SecurityConfig {
  displayAccess: DisplayAccessMode;
}

/** GET /api/admin/display-links item: one private link per saved screen, then one per carousel. */
export interface DisplayLink {
  /** the screen's id, or the carousel's id for a carousel link */
  screenId: string;
  /** absent on servers without carousels (= 'screen') */
  kind?: DisplayTargetKind;
  slug: string;
  name: string;
  /** UUIDv4 */
  key: string;
  /** "/d/<key>" */
  path: string;
  createdAt: string;
}

export interface DisplayLinksResponse {
  mode: DisplayAccessMode;
  links: DisplayLink[];
  /** this server's LAN IPv4 addresses (LAN_ADDRESS overrides; empty inside a container) */
  lanAddresses?: string[];
  /** PUBLIC_URL origin when set to something else than localhost */
  publicUrl?: string | null;
  /** Absolute origin that serves /d/<key> when it is not the admin's own (Marco Cloud) */
  displayOrigin?: string;
}

export interface PairedDevice {
  id: string;
  name: string;
  /** first characters of the token ("md_abcd"), for recognising it */
  prefix: string;
  /** screen or carousel id */
  screenId: string;
  /** absent on servers without carousels (= 'screen') */
  screenKind?: DisplayTargetKind;
  screenSlug: string;
  screenName: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastIp: string | null;
  userAgent: string;
  connected: boolean;
  clientIds: string[];
}

export interface DevicesResponse {
  mode: DisplayAccessMode;
  devices: PairedDevice[];
}

/** POST /api/pair/start */
export interface PairStartResponse {
  /** secret: only this display knows it; the token is handed out to it alone */
  sessionId: string;
  /** 6 characters, shown on the screen and typed in the admin */
  code: string;
  expiresAt: string;
  pollMs: number;
}

/** POST /api/pair/status { sessionId } */
export type PairStatusResponse =
  | { status: 'waiting'; code: string; expiresAt: string }
  | { status: 'paired'; token: string; screen: { id: string; slug: string; name: string }; device: { id: string; name: string } }
  | { status: 'expired' };

export interface PairClaimRequest {
  code: string;
  screenId: string;
  name?: string;
  /** Second step: pair now. Without it the server only answers `confirm` (which display is waiting). */
  confirm?: boolean;
}

/** First step of POST /api/admin/pair/claim: the display that shows this code, for the owner to confirm. */
export interface PairConfirm {
  /** Where the waiting display is: its LAN address (self-hosted) or "City, Country" (Marco Cloud); '' = unknown. */
  where: string;
  screenId: string;
  screenName: string;
}

/** POST /api/admin/pair/claim: `confirm` without `confirm: true` in the request, else `device`. */
export interface PairClaimResponse {
  confirm?: PairConfirm;
  device?: PairedDevice;
}

/** GET /api/admin/geocode?q=&lang= (Open-Meteo geocoding through the server). */
export interface GeocodeResult {
  name: string;
  /** region / state; '' when unknown */
  admin1: string;
  country: string;
  /** ISO 3166-1 alpha-2, upper case; '' when unknown */
  countryCode: string;
  lat: number;
  lon: number;
  /** IANA time zone; '' when unknown */
  timezone: string;
}

export interface GeocodeResponse {
  results: GeocodeResult[];
}

/**
 * FLAT per-screen VIEW of the v2 config (docs/ARCHITECTURE.md): global sections merged with ONE screen's sections,
 * in the historical v1 shape (+ the new global keys). This is what admin sections edit (`SectionProps.cfg`);
 * build it with `projectScreen()` and write it back with `applyScreen()` from web/shared/screens.ts.
 * NOT the stored/wire format any more: GET/PUT /api/admin/config use `StoredConfig`.
 */
export interface AppConfig {
  version: number;
  revision: number;
  /** id of the screen this view was projected from */
  screenId: string;
  slug: string;
  defaultScreen: string;
  screen: ScreenConfig;
  layout: LayoutConfig;
  background: BackgroundConfig;
  calendar: CalendarConfig<CalendarSource>;
  datetime: DateTimeConfig;
  weather: WeatherConfig;
  news: NewsConfig;
  todo: TodoConfig;
  message: MessageConfig;
  countdowns: CountdownsConfig & ScreenCountdownsConfig;
  alerts: ScreenAlertsConfig;
  localEvents: LocalEventsConfig;
  birthdays: BirthdaysConfig;
  eventRules: { items: EventRule[] };
  schedules: { items: ScheduledMessage[] };
  homeassistant: HomeAssistantConfig;
  immich: ImmichConfig;
  auth: AuthConfig;
  security: SecurityConfig;
  privacy: ScreenPrivacyConfig;
  /** global (servers without carousels leave it out) */
  carousels?: { items: Carousel[] };
  /** global family block + this screen's part */
  family: FamilyConfig & ScreenFamilyConfig;
  /** the widgets placed on this screen (the global list is StoredConfig.widgets) */
  widgets?: WidgetPlacement[];
  /** this screen's Personalizado layout (older servers: absent) */
  canvas?: CanvasConfig;
}

// ---- Personalizado (layout 'canvas', server/core/canvasCore.js; docs/CANVAS.md) ----

export type CanvasSize = 'xs' | 's' | 'm' | 'w' | 't' | 'l' | 'xl' | 'band' | 'full' | 'row' | 'sq';
export type SideSpan = 2 | 3 | 4 | 'fill';
export type CanvasSurface = 'glass' | 'solid' | 'none';
export type CanvasCategory = 'time' | 'calendar' | 'weather' | 'content' | 'nav' | 'family' | 'home' | 'data' | 'adv';

export type CanvasKind =
  | 'clock.digital' | 'clock.analog' | 'clock.flip' | 'clock.world' | 'date'
  | 'calendar.month' | 'calendar.week' | 'calendar.agenda' | 'calendar.today' | 'calendar.next' | 'calendar.people' | 'countdowns'
  | 'weather.now' | 'weather.hourly' | 'weather.forecast' | 'weather.cities'
  | 'message' | 'todo' | 'news' | 'photo' | 'widget' | 'value' | 'spacer' | 'heading'
  // Rotativa: one slot that shows its cards one after another (RotatorProps)
  | 'rotator'
  // Navegación: touch screens go to another screen, pause the carousel or show where it is
  | 'nav.button' | 'nav.pause' | 'nav.progress'
  // Familia y hogar: the family data the display already has (GET /api/display/family)
  | 'family.members' | 'family.routines' | 'family.points' | 'family.rewards' | 'family.chores'
  | 'meals.today' | 'meals.week' | 'birthdays' | 'highlights' | 'announcement'
  | 'ha.tile' | 'ha.light' | 'ha.switch' | 'ha.climate' | 'ha.cover' | 'ha.sensor'
  | 'ha.room' | 'ha.chart' | 'ha.camera' | 'ha.media' | 'ha.scene' | 'ha.gauge' | 'ha.statistic'
  // Datos: numbers the server fetches from public sources (server/core/dataCore.js)
  | 'market' | 'sports' | 'stocks' | 'currency'
  // Sonando ahora: what a linked Spotify account plays (server/core/nowPlayingCore.js, NowPlayingData)
  | 'nowplaying'
  | 'html'
  // reserved for a later version (a declarative card), refused today
  | 'card';

/** Where an item sits: a cell origin and a size name on the main grid, or a place in the sidebar stack. */
export type CanvasPos =
  /** w, h: a box of its own in whole cells (within the kind's range); without them the named size's cells */
  | { zone: 'main'; x: number; y: number; size: CanvasSize; w?: number; h?: number }
  | { zone: 'side'; order: number; span: SideSpan };

/** A card's own glass: the screen's material plus 'auto', a light or dark tint after the photo right behind the card. */
export interface CanvasGlass extends Omit<GlassConfig, 'tint'> {
  tint: GlassConfig['tint'] | 'auto';
}

export interface CanvasItemStyle {
  surface: CanvasSurface | 'inherit';
  /** null = the screen's glass (screen.glass) */
  glass: CanvasGlass | null;
  /** custom tint '#rrggbb' (wins over glass.tint; the card colour of a solid card) */
  color: string | null;
  accent: string | null;
  radius: 'inherit' | 'sq' | 'm' | 'l' | 'xl';
  title: string;
  icon: string;
  showTitle: boolean;
  /** text size, 0.7..1.5 */
  scale: number;
}

export interface CanvasItem {
  id: string; // "cv_" + 8 [a-z0-9]
  kind: CanvasKind;
  /** landscape position (or the only one when the screen has a fixed orientation) */
  pos: CanvasPos;
  /** portrait position when canvas.portraitAuto is false; null = left out of the portrait arrangement */
  portrait?: CanvasPos | null;
  style: CanvasItemStyle;
  /** control kinds only (default true) */
  interactive?: boolean;
  /** two taps on the TV (always on for an entity that looks like a door, a gate or a lock) */
  confirm?: boolean;
  /** the owner ticked that anyone in the room may use an entity that looks like a door (without it, no controls) */
  ack?: boolean;
  /** "Ocultar sin borrar": keeps its place, not drawn on the screen */
  hidden?: boolean;
  /** "Mostrar solo si": drawn only while a Home Assistant state or a Valor value matches (worked out on the server) */
  when?: CanvasCondition;
  /** "Horario": drawn only while one of these windows runs (the rule shape of privacy schedules; none = always) */
  schedule?: PrivacyRule[];
  /** validated per kind (canvasCore.js CANVAS_KINDS[kind].props) */
  props: Record<string, unknown>;
}

/** How a condition compares: equals, not equals, above, below. */
export type CanvasConditionOp = 'eq' | 'ne' | 'gt' | 'lt';
/** An item's condition (an entity or a key '' = not chosen yet: the item shows). */
export type CanvasCondition =
  | { src: 'ha'; entity: string; op: CanvasConditionOp; value: string }
  | { src: 'value'; key: string; op: CanvasConditionOp; value: string };
/** The rows an Entidad card can have under it (haCore tileFeatures). */
export type TileFeature = 'brightness' | 'colorTemp' | 'color' | 'cover' | 'position' | 'hvacModes' | 'target' | 'valve' | 'select' | 'number' | 'vacuum' | 'update' | 'gauge';

export interface CanvasConfig {
  v: 1;
  background: 'photo' | 'ambient' | 'solid';
  /** darkens the photo, 0..0.6 */
  dim: number;
  /** where: all over, at the top and bottom, or towards the edges */
  scrim: 'uniform' | 'topBottom' | 'edges';
  /** solid background colour (null = the theme background) */
  color: string | null;
  sidebar: { side: 'none' | 'left' | 'right' | 'top' | 'bottom'; size: 'narrow' | 'normal' | 'wide'; fill: 'glass' | 'solid' | 'photo' };
  defaults: { surface: CanvasSurface; radius: 'sq' | 'm' | 'l' | 'xl' };
  /** "Permitir tocar en la pantalla" (Home Assistant controls, the navigation cards) */
  touch: boolean;
  /** "Deslizar para cambiar de pantalla": with touch on, a swipe goes to the carousel's next or previous screen */
  swipe?: boolean;
  /** 'low' forces the low-power look on this screen */
  perf: 'auto' | 'low';
  /** the portrait arrangement is derived from the landscape one */
  portraitAuto: boolean;
  /**
   * Always 'fine' (24×16, 16×24) once saved. Deprecated: absent or 'normal' marks a screen saved before 0.17 on the
   * legacy 12×8 grid, which the server converts when it reads it (positions and boxes doubled, the same look).
   */
  grid?: CanvasGridId;
  /** "Densidad": 'compact' has tighter gaps, less padding and smaller titles; absent = 'normal' */
  density?: 'normal' | 'compact';
  items: CanvasItem[];
}

/** 'normal': the legacy grid, only in screens saved before 0.17 (read and converted). */
export type CanvasGridId = 'normal' | 'fine';

/** One card of a Rotativa: a kind of its own with its own props (validated by that kind). */
export interface RotatorCard {
  id: string;
  kind: CanvasKind;
  props: Record<string, unknown>;
}
/** A Rotativa's props: its cards (2 to 6), "Cambiar cada" in seconds (5 to 120) and the dots. */
export interface RotatorProps {
  cards: RotatorCard[];
  everySec: number;
  dots: boolean;
}
/** A Rotativa card as the display gets it (props projected like an item's; a placeholder where it may not show). */
export interface DisplayRotatorCard {
  id: string;
  kind: CanvasKind;
  props: Record<string, unknown>;
  v: string;
  disabled?: 'feature' | 'privacy' | 'setup';
}

/** One item as the display gets it (entity ids replaced by aliases, privacy and edition applied). */
export interface DisplayCanvasItem {
  id: string;
  kind: CanvasKind;
  pos: CanvasPos;
  /** portrait position (derived on the server when portraitAuto); null = not shown in portrait */
  portrait: CanvasPos | null;
  style: CanvasItemStyle;
  /** already ANDed with the screen's touch switch */
  interactive: boolean;
  confirm?: boolean;
  /** it has a condition: the feed of that source (haFeed, valuesFeed) says whether it is hidden now */
  when?: { src: 'ha' | 'value' };
  props: Record<string, unknown>;
  /** hash of what the item draws: reconcile key */
  v: string;
  /** drawn as a placeholder card: not allowed on this server, the screen is private, or not set up yet */
  disabled?: 'feature' | 'privacy' | 'setup';
}

/** DisplayConfig.canvas (null unless the screen's layout is 'canvas'). */
export interface DisplayCanvas extends Omit<CanvasConfig, 'items' | 'touch'> {
  orientation: 'landscape' | 'portrait' | 'auto';
  /** canvas.touch, with controls allowed on this server and the screen not private */
  touch: boolean;
  /** canvas.touch for the navigation cards and the swipe: not private, and a display the server trusts (absent: older servers) */
  taps?: boolean;
  /** canvas.swipe, only while `taps` */
  swipe?: boolean;
  items: DisplayCanvasItem[];
  /** when a visibility schedule of an item starts or ends next (ISO): the display asks for its config again then */
  next?: string;
  /** the screen has Home Assistant cards but Home Assistant is switched off: they show a note instead */
  haOff?: boolean;
}

// ---- Home Assistant on Personalizado screens (server/core/haCore.js, server/haLive.js) ----

/** A control a Home Assistant card may offer on a touch screen (haCore.CONTROL_TABLE). */
export type HaControl = 'toggle' | 'on' | 'off' | 'brightness' | 'colorTemp' | 'rgb' | 'fanPct' | 'setpoint' | 'setpointRange'
  | 'hvacMode' | 'fanMode' | 'open' | 'close' | 'stop' | 'position' | 'playPause' | 'next' | 'prev' | 'volume' | 'run'
  | 'selectOption' | 'numberSet' | 'start' | 'pause' | 'dock';

/** The slim state of one entity, all a display gets (never the entity id, URLs or pictures). `n`: its friendly name. */
export type HaSlim = { n?: string } & (
  | { d: 'light'; on: boolean; bri: number | null; ct: number | null; ctMin?: number; ctMax?: number; rgb: [number, number, number] | null; onoff?: boolean; col?: boolean }
  | { d: 'switch'; on: boolean; pct?: number; dc?: string | null }
  | { d: 'climate'; mode: string; modes: string[]; action: string | null; cur: number | null; target: number | null;
      lo: number | null; hi: number | null; min: number; max: number; step: number; fan?: string; fans?: string[]; hum?: number; unit: 'C' | 'F' }
  | { d: 'cover'; state: string; pos: number | null; readOnly: boolean; dc?: string | null; /** supported_features (open 1, close 2, set position 4, stop 8) when not all four */ sf?: number }
  | { d: 'media'; state: string; title: string | null; artist: string | null; vol: number | null; art: boolean; source?: string;
      /** the track's position and length in seconds, and when Home Assistant read the position (ms since the epoch) */
      pos?: number; dur?: number; posAt?: number }
  | { d: 'sensor'; v: string; num: number | null; unit: string; dc: string | null; min?: number; max?: number; step?: number; box?: boolean }
  | { d: 'valve'; state: string; pos: number | null; dc: string | null; readOnly: boolean }
  | { d: 'select'; v: string; opts: string[] }
  | { d: 'vacuum'; state: string; bat?: number }
  | { d: 'update'; on: boolean; cur: string | null; next: string | null; busy?: boolean }
  | { d: 'binary'; on: boolean; dc: string | null }
  | { d: 'scene' }
  | { d: 'lock' | 'alarm'; state: string }
  | { d: 'other'; v: string; dom?: string }
  | { d: 'unavailable' }
);
/**
 * One alias's state: the slim state, when it last changed (ms) and the controls it offers (empty unless touch). `cf`:
 * the controls need a second tap (the item asks for it, or the entity looks like a door).
 */
export type HaState = HaSlim & { at: number; c: HaControl[]; cf?: boolean; f?: TileFeature[] };
/** POST /api/display/ha/action (`confirm`: the second tap of an item that needs two). */
export interface HaActionRequest {
  item: string;
  slot: number;
  control: HaControl;
  value?: number | string | [number, number];
  seq: number;
  confirm?: boolean;
}
/** The answer of POST /api/display/ha/action. */
export type HaActionResponse = { ok: true; seq: number } | { ok: false; error: HaActionError; seq: number | null };
export type HaActionError =
  | 'json_required' | 'cross_origin' | 'bad_request' | 'not_found' | 'untrusted' | 'private' | 'touch_off' | 'not_allowed'
  | 'out_of_range' | 'rate' | 'confirm_needed' | 'ha_down' | 'ha_error';
/** POST /api/admin/homeassistant/action: the builder's Probar button. */
export interface HaAdminActionRequest {
  entity: string;
  kind: string;
  control: HaControl;
  value?: number | string | [number, number];
  props?: Record<string, unknown>;
}
/** GET /api/display/ha and the SSE `ha` event (`full:false`: only the aliases that changed). */
export interface HaSnapshot {
  rev: number;
  conn: 'ok' | 'down';
  /** Home Assistant is not set up on this server (switched off, or no URL or token) */
  off?: boolean;
  full: boolean;
  /** the screen these aliases belong to (a display on a carousel gets the events of every screen of it) */
  screenId?: string;
  states: Record<string, HaState>;
  /** screens with "Mostrar solo si": the items a condition hides now (they get no states) */
  hide?: string[];
}
/** GET /api/display/ha/statistic/:item (and the builder's /api/admin/homeassistant/statistic) */
// ---- data cards (Personalizado, palette "Datos"; server/core/dataCore.js dataForItem)

/** What every data item gets: seconds since the oldest answer used, whether to say how old it is, and why. */
interface DataItemBase {
  /** seconds since the answer was read upstream (null: nothing yet) */
  age: number | null;
  /** old or the last call failed: the card says "updated X ago" */
  stale: boolean;
  error?: string;
}
export interface MarketCoinData {
  id: string;
  sym: string;
  name: string;
  /** currency (CoinGecko vs_currency, lower case) */
  cur: string;
  price: number | null;
  /** change in % over the item's range */
  ch: number | null;
  /** [time ms, price] of the item's range ([] without a chart) */
  pts: [number, number][];
}
export interface MarketData extends DataItemBase {
  kind: 'market';
  range: '1d' | '7d' | '30d';
  coins: MarketCoinData[];
}
export interface SportsSide {
  /** short name, abbreviation, score ('' before the start), won, colour (#rrggbb or null), crest token ('' none) */
  n: string;
  ab: string;
  sc: string;
  w: boolean;
  c: string | null;
  cr: string;
}
export interface SportsGame {
  id: string;
  /** start, ms */
  t: number;
  st: 'pre' | 'in' | 'post';
  /** the minute or the clock while on, ESPN's short status once over ('FT', 'Final', 'AET') */
  clk: string;
  half?: boolean;
  note?: 'postponed' | 'canceled' | 'suspended' | 'delayed';
  home: SportsSide;
  away: SportsSide;
}
export interface SportsData extends DataItemBase {
  kind: 'sports';
  groups: { label: string; lg: string; sport: string; games: SportsGame[] }[];
}
export interface StockQuoteData {
  sym: string;
  name: string;
  price: number | null;
  ch: number | null;
  pts: [number, number][];
  /** Finnhub has nothing for this symbol (unknown, all zeros, or not on the key's plan, like forex on the free one) */
  noData?: boolean;
}
export interface StocksData extends DataItemBase {
  kind: 'stocks';
  quotes: StockQuoteData[];
  /** no Finnhub key saved, or it was refused */
  needsKey?: boolean;
}
export interface CurrencyPairData {
  base: string;
  quote: string;
  /** units of `quote` per one `base`, on the latest ECB day */
  rate: number | null;
  /** change in % since the working day before */
  ch: number | null;
  /** [day ms, rate] over the item's range ([] without a chart) */
  pts: [number, number][];
  /** the ECB has no rate for one of the two currencies */
  noData?: boolean;
}
export interface CurrencyData extends DataItemBase {
  kind: 'currency';
  range: '7d' | '30d' | '1y';
  /** the ECB day of the rates (YYYY-MM-DD), '' when none */
  date: string;
  pairs: CurrencyPairData[];
}
export type DataItemData = MarketData | SportsData | StocksData | CurrencyData;
/** GET /api/display/data: the data items of the requesting screen, by item id. */
export interface DisplayDataResponse {
  items: Record<string, DataItemData>;
}
/**
 * What a "now playing" account plays now (GET /api/display/nowplaying, server/core/nowPlayingCore.js displayItem).
 * Paused, stopped, an ad or nothing at all is null: the card and the line under the clock vanish.
 */
export interface NowPlayingData {
  provider: 'spotify';
  /** a song, or a podcast episode (`title` the episode, `artist` the show) */
  kind: 'track' | 'episode';
  title: string;
  artist: string;
  album: string;
  /** the cover's token for GET /api/display/nowplaying/art/:token ('' = no cover) */
  art: string;
  playing: true;
  /** seconds into the track when the answer was made, and its length (null: not known) */
  progress: number | null;
  duration: number | null;
}
/** GET /api/display/nowplaying?accounts=: the accounts asked for that this display may read; `next` = seconds until it asks again. */
export interface DisplayNowPlayingResponse {
  items: Record<string, NowPlayingData | null>;
  next: number;
}
/** POST /api/admin/data/preview */
export interface DataPreviewRequest {
  items: { id: string; kind: string; props: Record<string, unknown> }[];
}
export interface DataPreviewResponse {
  items: Record<string, DataItemData>;
}
export interface CoinSearchResult {
  coins: { id: string; sym: string; name: string; rank: number | null }[];
}
export interface SportsTeamsResult {
  teams: { id: string; name: string; abbr: string }[];
}
export interface SportsLeaguesResult {
  leagues: { id: string; sport: string; name: string; short: string }[];
}
export interface SymbolSearchResult {
  symbols: { sym: string; name: string; type: string }[];
}
/** GET /api/admin/data/currency/currencies */
export interface CurrencyListResult {
  currencies: { code: string; name: string }[];
}
export interface StocksKeyStatus {
  set: boolean;
  last4: string;
  checked?: boolean;
}

export interface HaStatistic {
  stat: 'change' | 'mean' | 'min' | 'max';
  period: 'today' | 'week' | 'month';
  value: number | null;
  unit: string;
}
/** GET /api/display/ha/history/:item */
export interface HaHistory {
  period: '1h' | '6h' | '24h' | '7d';
  series: { label: string; unit: string; points: [number, number][] }[];
}
/** GET /api/admin/homeassistant/history?entity=a,b&period= (the builder's preview): each series names its entity */
export interface HaAdminHistory {
  period: HaHistory['period'];
  series: { entity: string; label: string; unit: string; points: [number, number][] }[];
}
/** GET /api/admin/homeassistant/status */
export interface HaLiveStatus {
  state: 'connected' | 'polling' | 'error' | 'off';
  /** why it is polling or in error: no_websocket, old_version, auth, unreachable */
  reason?: string;
  lastEventAt: number | null;
  /** entities mirrored now */
  count: number;
  /** entities the saved screens watch */
  watched: number;
  /** a token is saved on the server (the token itself is never sent) */
  tokenSaved?: boolean;
  /** the saved token belongs to another Home Assistant address than the saved one: it is not used until saved again */
  tokenForOtherUrl?: boolean;
}

/** GET /api/display/config[?screen=<slug|id>] */
export interface DisplayConfig {
  revision: number;
  /** v2 fields below are always sent by the server; optional only because older cached payloads lack them. */
  screenId?: string;
  slug?: string;
  countdowns?: ScreenCountdownsConfig;
  alerts?: ScreenAlertsConfig;
  /** enabled scheduled messages targeting this screen (screenIds stripped) */
  schedules?: Omit<ScheduledMessage, 'screenIds'>[];
  screen: ScreenConfig;
  layout: LayoutConfig;
  background: BackgroundConfig;
  calendar: CalendarConfig<PublicCalendarSource>;
  datetime: DateTimeConfig;
  weather: WeatherConfig;
  news: { enabled: boolean; rotateSec: number };
  todo: TodoConfig;
  message: MessageConfig;
  /** privacy mode of this screen (servers without it leave it out) */
  privacy?: DisplayPrivacy;
  /** what the display is bound to: this screen, or a carousel this screen belongs to (older servers: absent) */
  target?: DisplayTarget;
  /** the carousel the display runs (null or absent: a plain screen) */
  carousel?: CarouselBlock | null;
  /** Familia on this screen (older servers: absent) */
  family?: DisplayFamilyBlock;
  /** widgets on this screen, the full-screen one first (older servers: absent; none while private) */
  widgets?: DisplayWidget[];
  /** the Personalizado layout's widgets (null on other layouts; older servers: absent) */
  canvas?: DisplayCanvas | null;
}

// ---- Familia (server/core/familyCore.js, server/family.js) ----

export type ChoreSlot = 'morning' | 'afternoon' | 'evening' | 'any';
export type MealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner';
/** Meals of one week or of the template: { '0'..'6' (0 = Sunday): { slot: text } }. */
export type MealDays = Record<string, Partial<Record<MealSlot, string>>>;

export interface FamilyMember {
  id: string; // "m_xxx"
  name: string;
  color: string; // '#rrggbb'
  avatar: string; // emoji
  /** profile photo id (POST /api/admin/family/photos; GET /media/avatars/<id>), shown instead of the emoji */
  photo?: string | null;
  /** only kids earn stars and redeem rewards */
  kid: boolean;
  /** calendar source id of this person (their events get the avatar on the Familia layout) */
  calendarId: string | null;
}

export interface FamilyChore {
  id: string; // "h_xxx"
  memberId: string;
  title: string;
  emoji: string;
  /** 0 = Sunday … 6; [] = every day */
  days: number[];
  slot: ChoreSlot;
  /** stars, 0..20 */
  points: number;
  enabled: boolean;
}

export interface FamilyReward {
  id: string; // "w_xxx"
  title: string;
  emoji: string;
  /** stars, 1..500 */
  cost: number;
}

export interface MealsConfig {
  enabled: boolean;
  /** ordered subset of breakfast, lunch, snack, dinner */
  slots: MealSlot[];
  /** a week without its own plan shows the template */
  useTemplate: boolean;
  template: MealDays;
  /** ISO week ('2026-W42') → its plan; the newest 26 are kept */
  weeks: Record<string, MealDays>;
}

/** Global `family` block (StoredConfig.family). */
export interface FamilyConfig {
  enabled: boolean;
  members: FamilyMember[];
  chores: FamilyChore[];
  rewards: FamilyReward[];
  showPoints: boolean;
  allowRedeemFromPhone: boolean;
  /** what privacy mode does on the TV */
  privacy: 'initials' | 'hide';
  meals: MealsConfig;
}

/** Per-screen part (ScreenProfile.family). */
export interface ScreenFamilyConfig {
  /** null = every member */
  memberIds: string[] | null;
  /** check routines off by touching this screen */
  touch: boolean;
  /** QR card of the family page on the kids layouts */
  showQr: boolean;
}

/** `family` of GET /api/display/config. */
export interface DisplayFamilyBlock {
  enabled: boolean;
  mealsEnabled: boolean;
  showPoints: boolean;
  touch: boolean;
  qrUrl: string | null;
  privacy: 'initials' | 'hide';
}

export interface FamilyCompletionRow {
  date: string;
  choreId: string;
  memberId: string;
  title: string;
  emoji: string;
  points: number;
  by: 'phone' | 'display' | 'admin';
  at: string;
}

export interface FamilyRedemption {
  id: string;
  rewardId: string;
  memberId: string;
  title: string;
  emoji: string;
  cost: number;
  by: 'phone' | 'admin';
  at: string;
}

export interface FamilyAdjustment {
  id: string;
  memberId: string;
  delta: number;
  note: string;
  at: string;
}

/** GET /api/admin/family */
export interface FamilyAdminState {
  today: string;
  rev: number;
  points: Record<string, number>;
  progress: Record<string, { done: number; total: number }>;
  /** last 14 days, newest first */
  completions: FamilyCompletionRow[];
  /** newest first */
  redemptions: FamilyRedemption[];
  adjustments: FamilyAdjustment[];
  link: { exists: boolean; path: string | null; createdAt: string | null };
  lanAddresses?: string[];
  publicUrl?: string | null;
}

/** What a person of the household may do from their own phone dashboard (/my). messageScreens [] = every screen. */
export interface FamilyAccessPerms {
  message: boolean;
  messageScreens: string[];
  privacy: boolean;
  night: boolean;
  todo: boolean;
  events: boolean;
}

/** A phone authorised for a person (opened the private link, or typed a code shown on a screen). */
export interface FamilyAccessDevice {
  id: string;
  name: string;
  via: 'link' | 'code';
  createdAt: string;
  lastSeenAt: string | null;
}

/** One person with their own dashboard, as the admin sees it (no token, no hash). */
export interface FamilyAccessPerson {
  id: string;
  name: string;
  /** a Familia member this person is (avatar and colour on the phone), or null */
  memberId: string | null;
  perms: FamilyAccessPerms;
  createdAt: string;
  lastUsedAt: string | null;
  /** the private link: only whether there is one; its address is shown once, when it is made */
  link: { exists: boolean; createdAt: string | null };
  devices: FamilyAccessDevice[];
  /** a code on a screen right now */
  code: { screenId: string; expiresAt: string } | null;
}

/** GET /api/admin/family-access */
export interface FamilyAccessListResponse {
  people: FamilyAccessPerson[];
  max: number;
  lanAddresses?: string[];
  publicUrl?: string | null;
}

/** POST /api/admin/family-access, POST /api/admin/family-access/:id/link: the link path is in this answer only. */
export interface FamilyAccessLinkResponse {
  person: FamilyAccessPerson;
  link: { path: string };
}

export interface FamilyAccessPersonRequest {
  name?: string;
  memberId?: string | null;
  perms?: Partial<FamilyAccessPerms>;
}

/** POST /api/admin/family-access/:id/code { screenId } */
export interface FamilyAccessCodeResponse {
  code: string;
  expiresAt: string;
  screenId: string;
  /** displays of that screen that got it now */
  delivered: number;
}

/** Live event / poll command `access-code`: a code for the phone, drawn on the screen for two minutes. */
export interface AccessCodePayload {
  /** this showing of the code, so a later { clear: true, id } takes down only this one ('' from older servers) */
  id: string;
  /** '' once the code was used, replaced or withdrawn */
  code: string;
  name: string;
  expiresAt: string;
  /** where the phone opens its dashboard (the QR code adds the code in the fragment); '' = unknown */
  url: string;
}

/** GET /api/member/state (header X-Member-Token): the person's dashboard. Nothing secret. */
export interface MemberState {
  name: string;
  lang: Lang;
  avatar: string;
  color: string;
  can: { message: boolean; privacy: boolean; night: boolean; todo: boolean; events: boolean };
  /** the screens a message may go to (messages on) */
  screens: { id: string; name: string }[];
  /** screens private now, out of all of them (privacy allowed), else null */
  privacy: { on: number; total: number } | null;
  /** the local calendar is on (events are shown) */
  calendarOn: boolean;
  /** seconds a message may stay on the screens */
  durations: number[];
}

/** POST /api/member/redeem { link, token? } and POST /api/member/pair { code } */
export interface MemberAuthResponse {
  token: string;
  state: MemberState;
}

export interface FamilyMemberView {
  id: string;
  name: string;
  initials?: string;
  color: string;
  avatar: string;
  /** address of the profile photo (/media/avatars/<id>) or null: the emoji. Null on a private screen. */
  photo?: string | null;
  kid: boolean;
  /** TV only: this person's calendar source (FamilyMember.calendarId) */
  calendarId?: string | null;
  points: number | null;
  done: number;
  total: number;
}

export interface FamilyChoreView {
  id: string;
  memberId: string;
  title: string;
  emoji: string;
  slot: ChoreSlot;
  points: number;
  done: boolean;
}

/** GET /api/display/family */
export interface FamilyDisplayState {
  today: string;
  slotNow: Exclude<ChoreSlot, 'any'>;
  rev: number;
  private: boolean;
  hidden: boolean;
  showPoints: boolean;
  touch: boolean;
  qrUrl?: string | null;
  members: FamilyMemberView[];
  chores: FamilyChoreView[];
  meals: { slots: MealSlot[]; days: { date: string; dow: number; meals: Partial<Record<MealSlot, string>> }[] } | null;
  nextReward?: Record<string, { title: string; emoji: string; cost: number; missing: number }>;
  generatedAt: string | null;
}

/** GET /api/family/state (the family page on a phone). */
export interface FamilyPhoneState {
  today: string;
  slotNow: Exclude<ChoreSlot, 'any'>;
  lang: Lang;
  rev: number;
  showPoints: boolean;
  allowRedeem: boolean;
  members: FamilyMemberView[];
  chores: FamilyChoreView[];
  rewards: { id: string; title: string; emoji: string; cost: number }[];
  meals: { slots: MealSlot[]; today: Partial<Record<MealSlot, string>> } | null;
}

/** CalEvent from GET /api/events */
export interface CalEvent {
  id: string;
  sourceId: string;
  title: string;
  /** ISO with offset, or YYYY-MM-DD for allDay */
  start: string;
  /** exclusive end; ISO with offset, or YYYY-MM-DD for allDay */
  end: string;
  allDay: boolean;
  location?: string | null;
  color: string;
  emoji?: string | null;
  kind: SourceKind;
  multiDay: boolean;
  description?: string | null;
  /** F2: birthdays with a known birth year (and birthdays.showAge) → age turned on that day. Display: "🎂 María (34)" */
  age?: number | null;
  /** privacy mode: a "Busy" block (title already in the screen's language, no location, emoji or description) */
  busy?: boolean;
}

export interface EventsResponse {
  generatedAt: string;
  hash: string;
  events: CalEvent[];
  errors: { sourceId: string; message: string }[];
}

export interface WeatherCurrent {
  temp: number;
  feelsLike: number | null;
  humidity: number | null;
  windKmh: number | null;
  windDir: number | null; // degrees
  windDirLabel: string;
  code: number; // WMO
  isDay: boolean;
  description: string;
  pressure?: number | null;
  uv?: number | null;
}

export interface WeatherToday {
  sunrise: string | null;
  sunset: string | null;
  min: number;
  max: number;
  precipChance: number | null;
}

export interface WeatherDaily {
  date: string; // YYYY-MM-DD
  code: number;
  min: number;
  max: number;
  precipChance: number | null;
  windKmh: number | null;
}

export interface WeatherHourly {
  time: string;
  temp: number;
  code: number;
  precipChance: number | null;
  isDay: boolean;
}

/** Where the weather comes from: the display shows `name` (and `modelName`) small, as the licences ask. */
export interface WeatherSource {
  provider: Exclude<WeatherProvider, 'homeassistant'>;
  name: string;
  model: OpenMeteoModel | null;
  modelName: string | null;
  url: string;
  /** e.g. 'CC BY 4.0'; empty when the provider names none */
  licence: string;
  licenceUrl: string;
  /** another source on top (current conditions from Home Assistant) */
  also?: string;
}

/**
 * Fields a source does not have are null (MET Norway has no precipitation probability outside the Nordics,
 * some Open-Meteo models have no UV index): the display leaves them out.
 */
export interface WeatherResponse {
  updatedAt: string;
  locationName: string;
  current: WeatherCurrent;
  today: WeatherToday;
  daily: WeatherDaily[];
  hourly: WeatherHourly[];
  indoor: { temp: number | null; humidity: number | null } | null;
  /** since 0.5; missing from older servers (then it is Open-Meteo) */
  source?: WeatherSource;
  /** the place this answer is for (weatherPlaces.js placeKey); since 0.17 */
  placeKey?: string;
  /**
   * The other places the screen shows (its weather cards with a place of their own, its cities cards), by placeKey.
   * A place whose source failed is left out. Since 0.17.
   */
  places?: Record<string, WeatherResponse>;
}

/** POST /api/admin/weather/preview: at most 8 places and the language of the answer. */
export interface WeatherPreviewRequest {
  places: WeatherPlace[];
  lang: Lang;
}

/** POST /api/admin/weather/preview: the weather of unsaved places (the admin preview), by placeKey. */
export interface WeatherPreviewResponse {
  places: Record<string, WeatherResponse>;
}

/** GET /api/admin/weather/key: the key itself is never sent back. */
export interface WeatherKeyStatus {
  set: boolean;
  /** last 4 characters of the stored key, to recognise it */
  hint: string;
  /** PUT only: the provider accepted the key on a test call (false when that could not be tried) */
  checked?: boolean;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  date: string;
  image?: string;
}

export interface NewsResponse {
  updatedAt: string;
  items: NewsItem[];
}

export interface Photo {
  url: string;
  author?: string;
  title?: string;
  source: 'stock' | 'gallery' | 'immich';
  /** gallery file name (gallery photos only) */
  file?: string;
  /** Immich asset id (Immich photos only) */
  id?: string;
  /** Immich: local date taken (YYYY-MM-DD) and place ("City, Country") for the caption */
  takenAt?: string;
  place?: string;
  /** Focal point (0..1 of width / height, from the top-left) the cover crop is kept around. Gallery only. */
  focusX?: number;
  focusY?: number;
}

export interface PhotosResponse {
  photos: Photo[];
  /** Signature of the special background rule that holds on the screen ('' or absent = none). It changes when another
   *  rule takes over or the rule is edited, so the display replaces the photo on screen at once. Never the rule itself. */
  rule?: string;
}

/** Feature flags in GET /api/health. A self-hosted server turns them all on except googleCalendar and googleLogin
 *  (on when Google credentials are set), accountMenu and microsoftCalendar. No `features` field at all (older servers) means every
 *  feature is on except accountMenu; a missing key counts as off only when `edition` is not 'self-hosted'. */
export interface Features {
  homeassistant: boolean;
  news: boolean;
  customCss: boolean;
  gallery: boolean;
  schedules: boolean;
  announcements: boolean;
  displayCommands: boolean;
  openDisplayAccess: boolean;
  insecureTls: boolean;
  googleCalendar: boolean;
  googleLogin: boolean;
  passwordLogin: boolean;
  apiTokens: boolean;
  webhooks: boolean;
  backups: boolean;
  importExport: boolean;
  includeSecrets: boolean;
  activity: boolean;
  setupWizard: boolean;
  status: boolean;
  accountMenu: boolean;
  /** Outlook.com, Hotmail and Microsoft 365 calendars (read only, Microsoft Graph). Off unless the server says so. */
  microsoftCalendar: boolean;
  /** Update banner, settings and the update button (self-hosted only; absent on older servers = off). */
  updates: boolean;
  /** Help and feedback form that reaches the people who run the server (Marco Cloud only; absent = off). */
  feedback: boolean;
  /** Privacy mode per screen (/api/admin/privacy, /api/hooks/privacy). Absent = off. */
  privacy: boolean;
  /** Doorbell ring overlay, POST /api/hooks/doorbell and the admin card (absent = off). */
  doorbell: boolean;
  /** Doorbell frames are a live camera picture proxied from Home Assistant (self-hosted). Off: the frame URL returns
   *  the latest uploaded snapshot (absent = off). */
  doorbellLive: boolean;
  /** Carousels: several screens in a loop on one TV (StoredConfig.carousels; absent = off). */
  carousels: boolean;
  /** Immich albums as a background source, proxied by this server (self-hosted; absent = off). */
  immich: boolean;
  /** Familia: members, routines with stars, rewards, meals, the kids layouts and the family page (absent = off). */
  family: boolean;
  /** Widgets: images the owner places on screens (config.widgets, the 'widget' layout; absent = off). */
  widgets: boolean;
  /** Web page widgets (a sandboxed iframe on the TV). Self-hosted only; absent = off. */
  webWidgets: boolean;
  /** Electricity price widgets (type 'prices': GET /api/display/prices, POST /api/admin/test/prices); absent = off. */
  priceWidgets: boolean;
  /** Profile photos of the family members (POST /api/admin/family/photos and where the photos are served); absent = off. */
  familyPhotos: boolean;
  /** Two-step sign-in with an authenticator app for the admin (/api/admin/2fa*, POST /api/auth/2fa); absent = off. */
  twoFactor: boolean;
  /** Account settings inside the admin's account page (Marco Cloud): language, password, two-step verification,
   *  Google sign-in, sessions, data export and deleting the account (/api/account/*, /api/auth/sessions*). Absent = off:
   *  the account page links out to the server's own account pages instead. */
  accountSettings: boolean;
  /** Personalizado: the screen builder (layout 'canvas'). */
  screenBuilder: boolean;
  /** POST /api/hooks/values, GET /api/display/values and the Valor card; absent = off (not self-hosted). */
  valueHooks: boolean;
  /** API tokens with scopes (ApiTokenInfo.scopes, PATCH /api/admin/tokens/:id); absent = off (not self-hosted). */
  tokenScopes: boolean;
  /** The Bolsa card can get quotes (a self-hosted server: the owner's own Finnhub key; Marco Cloud: only when the
   *  service has a key). Absent = on self-hosted, off elsewhere. */
  stockQuotes: boolean;
  /** Family access: each person's own phone dashboard (/my) with the controls the admin allows
   *  (/api/admin/family-access, /api/member/*). Absent = off. */
  familyAccess: boolean;
  /** "Sonando ahora": Spotify accounts linked with the household's own Spotify app, the Sonando ahora card and the
   *  line under the clock (/api/admin/spotify*, GET /api/display/nowplaying). Absent = off. */
  spotify: boolean;
}

export type FeatureName = keyof Features;

/** Plan limits in GET /api/health. Absent (self-hosted) = no limit. */
export interface Limits {
  screens?: number;
  sources?: number;
  devices?: number;
  photos?: number;
  /** bytes per photo */
  photoBytes?: number;
  /** bytes for all photos together */
  totalPhotoBytes?: number;
  newsFeeds?: number;
  apiTokens?: number;
  backups?: number;
  /** webhook commands per day */
  hookCommandsPerDay?: number;
  /** bytes of custom CSS per screen */
  customCssBytes?: number;
  /** list caps; absent = the config validator's own caps (web/admin/caps.ts BUILTIN_LIMITS) */
  localEvents?: number;
  birthdays?: number;
  countdowns?: number;
  carousels?: number;
  widgets?: number;
  /** shortest widget refresh this server allows, in seconds (absent = every choice) */
  widgetMinRefreshSec?: number;
  /** Personalizado: items per screen, cameras and custom HTML cards per screen (absent = the validator's caps) */
  canvasItems?: number;
  canvasCameras?: number;
  canvasHtml?: number;
  /** keys of POST /api/hooks/values kept at once, and stored values per day (absent = no daily cap) */
  valueKeys?: number;
  valuePushesPerDay?: number;
}

export interface HealthResponse {
  ok: boolean;
  /** seconds since the server started; null where there is no long-running process */
  uptime: number | null;
  version: string;
  /**
   * How displays get live updates: 'sse' = /api/stream, 'poll' = GET /api/display/poll (the display falls back to a
   * config revision poll when that answers 404). Absent (old servers) = 'sse'.
   */
  live?: 'sse' | 'poll';
  /** Absent on servers older than 0.5.0. */
  edition?: 'self-hosted' | 'cloud';
  tenancy?: 'single' | 'multi';
  runtime?: 'node' | 'workers';
  /** Characters in a pairing code shown on a TV (6 when absent). */
  pairCodeLength?: number;
  features?: Partial<Features>;
  limits?: Limits;
  /** Absolute origin that serves the display pages (/d/<key>, /pair). Absent = same origin as the admin. */
  displayOrigin?: string;
  /** Absolute origin of the admin, for a display served from another origin. Absent = same origin as the display. */
  adminOrigin?: string;
  /** This server's LAN addresses; only sent to a client on the server itself (a kiosk on http://localhost). */
  lanAddresses?: string[];
}

// ---- Feedback (Marco Cloud, features.feedback) ----

export type FeedbackKind = 'problem' | 'idea' | 'other';

/** Technical details the person chose to send with a message (every field optional, all shown before sending). */
export interface FeedbackMeta {
  version?: string;
  /** admin page the form was opened from, e.g. 'calendars' */
  page?: string;
  screens?: number;
  userAgent?: string;
  lang?: string;
  timeZone?: string;
}

/** POST /api/admin/feedback */
export interface FeedbackRequest {
  kind: FeedbackKind;
  message: string;
  /** null or absent: no technical details */
  meta?: FeedbackMeta | null;
}

export interface FeedbackResponse {
  ok: true;
  id: string;
}

// ---- Updates (self-hosted, features.updates) ----

/** How the server was installed: what the admin offers to update it (server/updates.js detectInstall). */
export interface UpdateInstall {
  kind: 'release' | 'checkout' | 'docker' | 'manual';
  /** The update button works (install.sh release install with the marco-update units). */
  canApply: boolean;
  /** The `marco` command manages this install. */
  cli: boolean;
}

export interface UpdateRelease {
  version: string;
  name: string;
  /** Markdown from the CHANGELOG section of that version */
  notes: string;
  url: string | null;
  publishedAt: string | null;
}

export interface UpdateSettings {
  /** Check for a new version once a day */
  check: boolean;
  /** Install it on its own inside the window (release installs) */
  auto: boolean;
  /** HH:MM, server time zone (Date & time) */
  from: string;
  to: string;
}

export interface UpdateStatus {
  state: 'requested' | 'running' | 'done' | 'current' | 'failed';
  from: string;
  to: string;
  target: string;
  by: 'admin' | 'auto';
  at: string | null;
  rolledBack: boolean;
  /** Requested, but no update service picked it up */
  stalled: boolean;
}

/** GET /api/admin/update */
export interface UpdateInfo {
  current: string;
  latest: UpdateRelease | null;
  available: boolean;
  checkedAt: string | null;
  error: 'network' | 'http' | 'rate_limited' | 'bad_response' | null;
  /** 'env-off' = MARCO_UPDATE_CHECK=0 on the server */
  checks: 'on' | 'off' | 'env-off';
  install: UpdateInstall;
  settings: UpdateSettings;
  status: UpdateStatus | null;
  /** Last lines of the installer's output for the last update */
  log: string[];
}

/** SSE /api/stream?screen=&client= event payloads (docs/ARCHITECTURE.md) */
export type StreamEvent =
  | ({ type: 'hello' } & StreamHello)
  | { type: 'config'; revision: number }
  | { type: 'reload' }
  | { type: 'events'; hash: string }
  | ({ type: 'announce' } & Announcement)
  | { type: 'announce-clear'; id: string | null }
  | ({ type: 'identify' } & IdentifyPayload)
  | { type: 'night'; mode: NightCommand }
  | { type: 'privacy'; active: boolean; screenId?: string }
  | ({ type: 'doorbell' } & DoorbellRing)
  | { type: 'doorbell-end'; id: string }
  | { type: 'family'; rev: number }
  /** the tasks of the Microsoft To Do lists changed: refetch the config */
  | { type: 'todo' }
  /** a code for a person's phone (family access), on this screen for two minutes */
  | ({ type: 'access-code' } & AccessCodePayload)
  | { type: 'access-code'; clear: true; id: string; expiresAt: string }
  | { type: 'ping'; t: number };

// ---- Admin API ----

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
  method: 'password' | 'google' | 'account';
  /** Marco Cloud accounts: the account's language (emails), whether it has a password, and when it was made (epoch ms) */
  lang?: Lang;
  hasPassword?: boolean;
  createdAt?: number;
}

/** Marco Cloud: where the account pages live and which household the admin edits. */
export interface AccountInfo {
  loginUrl: string;
  accountUrl: string;
  sessionsUrl: string;
  deleteUrl: string;
  household: HouseholdInfo;
}

export interface HouseholdInfo {
  name: string;
  role: 'owner' | 'member';
}

export interface AuthMeResponse {
  user: AuthUser | null;
  googleConfigured: boolean;
  /** Sign in with Google is offered (self-hosted: off unless the server relies on it or MARCO_GOOGLE_LOGIN=1). */
  googleLoginEnabled?: boolean;
  passwordLoginEnabled: boolean;
  /** Logged in with the initial/default password: it must be changed (only accepted from the LAN until then). */
  mustChangePassword?: boolean;
  /** Fresh install: no admin password yet → the admin shows the setup wizard. */
  needsSetup?: boolean;
  /** The initial password came from ADMIN_PASSWORD (headless install): the panel offers to change it. */
  passwordFromEnv?: boolean;
  /** Only when user.method is 'account' (Marco Cloud). */
  account?: AccountInfo;
  /** Marco Cloud: the admin shows the Microsoft accounts card when it is true (Microsoft calendars on for this account). */
  microsoftConfigured?: boolean;
  /** Two-step sign-in: the password (or Google) was right and this browser still has to send the code (POST /api/auth/2fa). */
  twoFactorPending?: boolean;
}

/** GET /api/admin/2fa */
export interface TwoFactorStatus {
  enabled: boolean;
  /** when it was turned on (ISO time; Marco Cloud: epoch ms), or null */
  enabledAt: string | number | null;
  /** unused recovery codes */
  recoveryLeft: number;
  /** Marco Cloud (GET /api/account/two-factor): the account has a password, so changes can be confirmed with it */
  hasPassword?: boolean;
}

/** GET /api/auth/sessions (features.accountSettings): where the account is signed in. Times are epoch ms. */
export interface AccountSession {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  /** browser and system, e.g. "Firefox on Linux"; null when unknown */
  label: string | null;
  /** two-letter country code, or null */
  country: string | null;
  current: boolean;
}

export interface AccountSessionsResponse {
  sessions: AccountSession[];
}

/** GET /api/account/google (features.accountSettings): Sign in with Google for this account. */
export interface AccountGoogleStatus {
  /** the server offers Sign in with Google */
  enabled: boolean;
  hasPassword: boolean;
  /** the Google account that signs in to this one, or null */
  linked: { email: string; linkedAt: number; lastUsedAt: number | null } | null;
}

/** POST /api/admin/2fa/setup: the new secret (base32) and its otpauth:// URI for the QR code. */
export interface TwoFactorSetup {
  secret: string;
  uri: string;
}

/** POST /api/admin/2fa/enable and /api/admin/2fa/recovery-codes: the codes, shown once. */
export interface RecoveryCodesResponse {
  ok: true;
  recoveryCodes: string[];
}

/** POST /api/auth/login: { user } when signed in, { twoFactor: true } when the code comes next. */
export interface LoginResponse {
  user?: AuthUser;
  twoFactor?: boolean;
}

/** POST /api/auth/2fa */
export interface TwoFactorLoginResponse {
  user: AuthUser;
  /** only when a recovery code was used: how many are left */
  recoveryLeft?: number;
}

/** GET /api/setup/status */
export interface SetupStatus {
  needsSetup: boolean;
  googleConfigured: boolean;
  version: string;
  suggestedLanguage: Lang;
  /** only while needsSetup: a setup token is needed (SETUP_TOKEN set, or the browser is not on the LAN) */
  tokenRequired?: boolean;
  /** only while needsSetup and when a token was sent (x-setup-token): whether it is right */
  tokenValid?: boolean | null;
  defaults?: { timezone: string; location: string };
  /** only while needsSetup, for LAN clients: this machine's LAN IPv4 addresses (kiosk / wizard opened on localhost → QR code).
   *  Empty in a container unless LAN_ADDRESS is set. */
  lanAddresses?: string[];
}

/** POST /api/setup/complete */
export interface SetupRequest {
  token?: string;
  password: string;
  passwordConfirm: string;
  language: Lang;
  screenName: string;
  location?: { name: string; lat: number; lon: number; timezone: string | null };
  /** time zone without a location (location skipped) */
  timezone?: string;
  units?: 'metric' | 'imperial';
  format24?: boolean;
  calendars?: { name: string; url: string; kind: 'holidays' | 'generic'; color?: string }[];
  photos?: { source: 'stock' | 'gallery' | 'mixed' };
  layout?: { preset: LayoutPreset };
  accent?: string;
  ambient?: 'aurora' | 'particles' | 'none';
  theme?: 'dark' | 'light';
}

export interface SetupCompleteResponse {
  ok: true;
  user: AuthUser;
  /** displayPath: the screen's private link ("/d/<key>") */
  screen: { id?: string; slug: string; name: string; displayPath?: string | null };
  displayAccess?: DisplayAccessMode;
}

export interface GoogleAccount {
  email: string;
  name?: string;
  picture?: string;
}

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
}

export interface MicrosoftAccount {
  email: string;
  /** the account lets Marco read its Microsoft To Do lists (false: linked before Marco asked; connect it again) */
  tasks?: boolean;
  /** the account lets Marco tick its To Do tasks from a touch screen (Tasks.ReadWrite) */
  tasksWrite?: boolean;
}

/** One Spotify account linked for "now playing" (GET /api/admin/spotify). No email, no token: a name and an opaque id. */
export interface SpotifyAccount {
  id: string;
  /** the account's display name on Spotify (else its user id) */
  name: string;
  connectedAt: string;
  /** 'reconnect': Spotify refused its refresh token (access was removed at spotify.com or it expired); connect it again */
  status: 'ok' | 'reconnect';
}
/** GET /api/admin/spotify: the household's own Spotify app (the secret is never sent back) and its linked accounts. */
export interface SpotifyStatus {
  clientId: string;
  secretSet: boolean;
  /**
   * Spotify refused the app's keys on the last token refresh (a rotated or mistyped Client Secret). The accounts keep
   * their own tokens: saving the right secret is enough.
   */
  appRefused: boolean;
  /** the exact Redirect URI to add to the app in Spotify's developer dashboard */
  redirectUri: string;
  /**
   * Spotify only sends people back to an https address or to http://127.0.0.1 (never "localhost"). A server reached
   * over plain http on the home network gets a loopback Redirect URI instead: after allowing access the browser shows
   * an error page, and its address is pasted into the admin (POST /api/admin/spotify/finish).
   */
  paste: boolean;
  accounts: SpotifyAccount[];
  /** most accounts per household */
  max: number;
}
/** PUT /api/admin/spotify/app: the Client ID and, when changed, the Client Secret ('' clientId removes the app and its accounts). */
export interface SpotifyAppRequest {
  clientId: string;
  clientSecret?: string;
}
/** POST /api/admin/spotify/finish: the address the browser landed on after allowing access (paste mode). */
export interface SpotifyFinishRequest {
  url: string;
}
/** POST /api/admin/spotify/finish: the account linked, and the status after it. */
export interface SpotifyFinishResponse extends SpotifyStatus {
  ok: true;
  id: string;
}
/** DELETE /api/admin/spotify/accounts/:id: Spotify has no revoke call, so where the owner removes Marco's access. */
export interface SpotifyRemoveResponse {
  ok: true;
  manageAccess: string;
}
/** GET /api/admin/spotify/accounts/:id/now: what the account plays now (the admin's test). */
export interface SpotifyNowResponse {
  ok: boolean;
  item: NowPlayingData | null;
  error?: string;
}

/** GET /api/admin/microsoft/todo-lists?account= */
export interface MicrosoftTodoListItem {
  id: string;
  name: string;
  /** the account's default list ("Tasks") */
  isDefault?: boolean;
  /** shared with other people */
  shared?: boolean;
}

export interface MicrosoftCalendarListItem {
  id: string;
  name: string;
  /** #rrggbb, when the calendar has a colour */
  color?: string;
  /** the account's default calendar */
  isDefault?: boolean;
  /** owner address when the calendar is shared with the account by someone else */
  owner?: string;
}

export interface TestIcsResponse {
  ok: boolean;
  count?: number;
  sample?: string[];
  error?: string;
}

export interface TestRssResponse {
  ok: boolean;
  title?: string;
  count?: number;
  error?: string;
}

export interface TestHomeAssistantResponse {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface HaEntity {
  entity_id: string;
  name: string;
  state: string;
  unit?: string;
  domain?: string;
  device_class?: string | null;
  /** area name from the area registry (null: none, or the token is not an admin's) */
  area?: string | null;
  icon?: string | null;
  supported_features?: number;
  /** the attributes the builder uses (hvac_modes, min_temp, supported_color_modes…) */
  attrs?: Record<string, unknown>;
}

export interface AdminPhoto {
  file: string;
  /** includes a ?v=<mtime> cache-busting version */
  url: string;
  /** small JPEG preview for the grid (falls back to `url` until one exists) */
  thumbUrl?: string;
  hasThumb?: boolean;
  size: number;
  mtime: string | number;
  /** pixel size as displayed (EXIF orientation applied) */
  w?: number;
  h?: number;
  focusX?: number;
  focusY?: number;
  uploadedAt?: string;
  /** excluded from the background rotation */
  hidden?: boolean;
}

export type PhotoConflictPolicy = 'replace' | 'rename' | 'skip';

export interface PhotoNameCheck {
  name: string;
  /** the name the server will store it under */
  sanitized: string;
  exists: boolean;
  /** name it would get with "keep both" */
  renamed?: string;
}

export interface PhotoUploadResult {
  ok: true;
  files: (AdminPhoto & { status: 'created' | 'replaced' | 'renamed'; requested: string })[];
  skipped: string[];
}

export interface SourceStatus {
  id: string;
  name: string;
  enabled?: boolean;
  lastFetch: string | null;
  lastSuccess?: string | null;
  ok: boolean;
  count: number;
  error?: string | null;
}

export type WeatherErrorCode = 'key_missing' | 'key_invalid' | 'rate_limited' | 'http' | 'bad_response';

export interface AdminStatus {
  sources: SourceStatus[];
  weather: { ok: boolean; updatedAt: string | null; error?: string | null; errorCode?: WeatherErrorCode | null; provider?: WeatherProvider | null };
  news: { ok: boolean; updatedAt: string | null; count?: number; error?: string | null };
  displays: number;
  /** seconds; null where there is no long-running process (Marco Cloud) */
  uptime: number | null;
}

// =================================================================================================
// v2 admin management (docs/ARCHITECTURE.md). 
// =================================================================================================

/** Built-in pseudo-source ids (F2). */
export const LOCAL_SOURCE_ID = 'local';
export const BIRTHDAYS_SOURCE_ID = 'birthdays';

export type AlertStyle = 'info' | 'success' | 'warning' | 'urgent';
export type NightCommand = 'on' | 'off' | 'auto';

// ---- §2 stored config (data/config.json, GET/PUT /api/admin/config) ----

export interface ScreenCountdownsConfig {
  enabled: boolean;
  /** max chips shown (display may show fewer if space is short) 1..12 */
  max: number;
}

export interface ScreenAlertsConfig {
  /** show announcements + scheduled messages on this screen */
  enabled: boolean;
  /** play the WebAudio chime when an alert asks for it */
  sound: boolean;
  /** 0..1 */
  volume: number;
}

/** One screen profile (F1). `screen.name` lives in `name`. */
export interface ScreenProfile {
  id: string; // "s_xxx", stable, never changes
  slug: string; // URL key for ?screen=, unique, ^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$
  name: string;
  screen: Omit<ScreenConfig, 'name'>;
  layout: LayoutConfig;
  background: BackgroundConfig;
  calendar: Pick<CalendarConfig, 'enabled' | 'view' | 'weeks' | 'weekStart' | 'startOn' | 'showLocation' | 'showEndTime' | 'showDayXofY' | 'showLegend' | 'hidePast' | 'maxEventsPerDay' | 'marquee' | 'rotateBusyDays' | 'compactBusyDays' | 'eventStyle' | 'agendaDays'> & { sourceIds: string[] | null };
  datetime: Omit<DateTimeConfig, 'timezone'>;
  weather: Pick<WeatherConfig, 'enabled' | 'forecastDays' | 'showHourly' | 'showPrecipChance' | 'place'>;
  news: { enabled: boolean; rotateSec: number };
  /** older servers: only `enabled` */
  todo: { enabled: boolean } & Partial<TodoView>;
  message: MessageConfig;
  countdowns: ScreenCountdownsConfig;
  alerts: ScreenAlertsConfig;
  privacy: ScreenPrivacyConfig;
  family: ScreenFamilyConfig;
  /** widgets on this screen (older servers: absent) */
  widgets?: WidgetPlacement[];
  /** the Personalizado layout (older servers: absent) */
  canvas?: CanvasConfig;
}

export type RepeatFreq = 'none' | 'weekly' | 'monthly' | 'yearly';

/** F2 local event (dates/times are local to datetime.timezone). */
export interface LocalEvent {
  id: string; // "l_xxx"
  title: string;
  emoji: string; // '' → icon rules / localEvents.emoji
  color: string | null; // null → localEvents.color
  location: string;
  notes: string;
  allDay: boolean;
  date: string; // YYYY-MM-DD first day
  endDate: string; // YYYY-MM-DD last day, INCLUSIVE (= date for single-day)
  startTime: string; // 'HH:MM' when !allDay, else ''
  endTime: string; // 'HH:MM' when !allDay (on endDate), else ''
  repeat: {
    freq: RepeatFreq;
    interval: number; // every N weeks/months/years, 1..99
    until: string | null; // YYYY-MM-DD inclusive (last occurrence start), null = forever
    weekdays: number[]; // weekly only, 0 = Sunday … 6; [] = weekday of `date`
  };
  /** occurrence start dates (YYYY-MM-DD) that are skipped */
  exceptions: string[];
  /** also show as a countdown chip (F4) */
  countdown: boolean;
}

export interface LocalEventsConfig {
  enabled: boolean;
  name: string; // legend name of the 'local' source
  color: string;
  emoji: string;
  /** privacy mode for local events (default 'busy') */
  privacy?: PrivacyMode;
  items: LocalEvent[];
}

/** F2 birthday → yearly all-day event of kind 'birthdays' on source 'birthdays'. */
export interface Birthday {
  id: string; // "b_xxx"
  name: string;
  month: number; // 1..12
  day: number; // 1..31 (29/02 → 28/02 on non-leap years)
  year: number | null; // birth year → age
  emoji: string; // '' → birthdays.emoji
}

export interface BirthdaysConfig {
  enabled: boolean;
  name: string;
  color: string;
  emoji: string;
  showAge: boolean;
  /**
   * Birthday titles from any calendar ("Astrid's Birthday") show only the name next to the 🎂 (default true). Off: the
   * calendar's own title stays (ALL CAPS titles are still written in normal case). Since 0.17; missing = true.
   */
  tidyTitles?: boolean;
  /** privacy mode for birthdays (default 'keep') */
  privacy?: PrivacyMode;
  items: Birthday[];
}

export type EventRuleAction = 'hide' | 'rename' | 'style';

/** F3 filter / override rule. Evaluated: hide → rename (in order, chained) → style (first match). */
export interface EventRule {
  id: string; // "f_xxx"
  enabled: boolean;
  action: EventRuleAction;
  /** accent/case-insensitive text */
  match: string;
  matchMode: 'contains' | 'exact' | 'startsWith';
  /** 'title' or 'any' (title + description + location) */
  field: 'title' | 'any';
  /** [] = every source (ids may include 'local' / 'birthdays') */
  sourceIds: string[];
  /** rename: replacement for the matched text (contains/startsWith) or the whole title (exact) */
  replaceWith: string;
  /** style: '' = unchanged */
  emoji: string;
  /** style: null = unchanged */
  color: string | null;
  /** style: also show matching events as countdown chips (F4) */
  countdown: boolean;
  note: string;
}

/** F4 manual countdown. */
export interface Countdown {
  id: string; // "k_xxx"
  title: string;
  emoji: string;
  color: string | null;
  date: string; // YYYY-MM-DD
  yearly: boolean; // repeats every year on the same month/day
}

/** Global countdown settings (per-screen enabled/max live in ScreenCountdownsConfig). */
export interface CountdownsConfig {
  items: Countdown[];
  includeBirthdays: boolean;
  /** birthdays are included when they are ≤ N days away */
  birthdayDays: number;
  /** include events flagged `countdown` (local events, style rules) */
  includeFlagged: boolean;
  /** ignore anything further than N days */
  horizonDays: number;
}

/** F5 scheduled message (recurring time window). */
export interface ScheduledMessage {
  id: string; // "m_xxx"
  enabled: boolean;
  title: string;
  body: string;
  emoji: string;
  style: AlertStyle;
  /** 0 = Sunday … 6; [] = every day. The day refers to the START of the window. */
  days: number[];
  from: string; // HH:MM
  to: string; // HH:MM; to < from → window crosses midnight
  startDate: string | null; // YYYY-MM-DD inclusive
  endDate: string | null;
  /** screen ids; [] = all screens */
  screenIds: string[];
  /** chime when the window starts */
  sound: boolean;
}

/** v2 stored config: GET/PUT /api/admin/config, backups, export. */
export interface StoredConfig {
  version: 2;
  revision: number;
  defaultScreen: string;
  screens: ScreenProfile[];
  calendar: { sources: CalendarSource[]; iconRules: IconRule[] };
  datetime: { timezone: string };
  weather: Omit<WeatherConfig, 'enabled' | 'forecastDays' | 'showHourly' | 'showPrecipChance' | 'place'>;
  news: { feeds: NewsFeed[]; maxItems: number };
  todo: { items: TodoItem[]; lists: TodoList[] };
  localEvents: LocalEventsConfig;
  birthdays: BirthdaysConfig;
  eventRules: { items: EventRule[] };
  countdowns: CountdownsConfig;
  schedules: { items: ScheduledMessage[] };
  /** servers without carousels leave it out */
  carousels?: { items: Carousel[] };
  /** images and web pages shown on screens (older servers leave it out) */
  widgets?: WidgetDef[];
  homeassistant: HomeAssistantConfig;
  immich: ImmichConfig;
  auth: AuthConfig;
  security: SecurityConfig;
  family: FamilyConfig;
}

/** PUT /api/admin/config body: the whole config plus the revision the admin loaded it at. A stale `baseRevision`
 *  gets 409 {error:'conflict', revision}; without it the last write wins. */
export type SaveConfigRequest = StoredConfig & { baseRevision?: number };

export interface ValidationError {
  path: string;
  message: string;
}

// ---- §3 events: preview, CSV, countdowns ----

export interface EventsPreviewRequest {
  /** default today (server tz) */
  from?: string;
  /** 1..60, default 14 */
  days?: number;
  /** screen id/slug to filter sources; omitted → all enabled sources */
  screen?: string;
  /** draft calendar settings of that screen (which sources it shows) instead of the saved ones */
  screenCalendar?: { enabled: boolean; sourceIds: string[] | null };
  /** draft values to preview instead of the saved ones (all optional) */
  eventRules?: EventRule[];
  iconRules?: IconRule[];
  localEvents?: LocalEventsConfig;
  birthdays?: BirthdaysConfig;
}

export interface PreviewEvent extends CalEvent {
  hidden: boolean;
  /** title before rename rules (after kind normalisation, e.g. Airbnb) */
  originalTitle: string;
  /**
   * Why the title on screen differs from originalTitle: 'rule' (a rename rule), 'birthday' (a recognised birthday:
   * only the name is kept, birthdays.tidyTitles), 'caps' (an ALL CAPS title in normal case), null (it does not).
   * Since 0.17; older servers leave it out.
   */
  titleWhy?: 'rule' | 'birthday' | 'caps' | null;
  sourceName: string;
  /** rules that changed this event, in evaluation order */
  applied: { ruleId: string; action: EventRuleAction }[];
  /** icon rule that set emoji/color (null = none / overridden) */
  iconRuleId: string | null;
}

export interface EventsPreviewResponse {
  from: string;
  to: string;
  events: PreviewEvent[];
  /** ruleId → number of events affected in the window */
  ruleHits: Record<string, number>;
  errors: { sourceId: string; message: string }[];
}

export interface BirthdayCsvResult {
  items: Birthday[]; // parsed, with fresh ids (not saved)
  errors: { line: number; text: string; message: string }[];
  duplicates: number; // lines matching an existing birthday (same name + day + month), skipped
}

export interface CountdownItem {
  id: string;
  title: string;
  emoji: string;
  color: string | null;
  date: string; // YYYY-MM-DD (next occurrence)
  /** days from server "today" at generation time (0 = today); display recomputes at midnight from `date` */
  days: number;
  origin: 'manual' | 'birthday' | 'event';
  age?: number | null;
}

export interface CountdownsResponse {
  generatedAt: string;
  today: string; // YYYY-MM-DD server tz
  hash: string;
  items: CountdownItem[];
}

// ---- §4 displays ----

/** Sent by the display: POST /api/display/heartbeat (on SSE open, every 60 s, after a command). */
export interface DisplayHeartbeat {
  clientId: string; // [A-Za-z0-9_-]{8,64}, persisted in localStorage
  screen: string; // ?screen= value as requested ('' = default)
  screenId: string; // resolved screen id from DisplayConfig
  version: string; // __APP_VERSION__
  build: string; // __APP_BUILD__ (ISO build time)
  viewport: { w: number; h: number }; // innerWidth/innerHeight
  screenRes: { w: number; h: number }; // screen.width/height
  dpr: number;
  webgl: boolean; // three.js layers actually running
  lite: boolean;
  night: boolean; // dimmed right now
  nightOverride: NightCommand; // 'auto' = following the schedule
  uptimeSec: number; // since page load
  lastError: string | null; // last uncaught error message (≤ 200 chars)
  /** photo panel geometry and the part not covered by text (focal-point editor preview) */
  photoFrame?: PhotoFrame | null;
}

export interface HeartbeatResponse {
  ok: true;
  now: string; // server ISO time
  revision: number;
}

export interface DisplayInfo {
  clientId: string;
  /** screen id, or the carousel id for a display on a carousel */
  screenId: string;
  /** absent on servers without carousels (= 'screen') */
  targetKind?: DisplayTargetKind;
  /** a display on a carousel: the screen it reported last in its heartbeat */
  showingScreenId?: string | null;
  showingScreenName?: string | null;
  screenSlug: string;
  screenName: string;
  connected: boolean; // SSE stream open now
  ip: string;
  userAgent: string;
  uaShort: string; // "Chromium 128 · Linux aarch64"
  connectedAt: string | null; // current SSE connection start
  firstSeen: string;
  lastSeen: string; // last heartbeat or SSE activity
  viewport: { w: number; h: number } | null;
  screenRes: { w: number; h: number } | null;
  dpr: number | null;
  webgl: boolean | null;
  lite: boolean | null;
  version: string | null;
  build: string | null;
  /** version !== server version → display runs an old build */
  outdated: boolean;
  night: boolean | null;
  nightOverride: NightCommand | null;
  uptimeSec: number | null;
  lastError: string | null;
  photoFrame?: PhotoFrame | null;
  /** how the display got in: private link, paired device, admin session or open mode (no key) */
  access?: DisplayAccessVia;
  deviceId?: string | null;
  deviceName?: string | null;
}

export interface DisplaysResponse {
  displays: DisplayInfo[];
  serverVersion: string;
}

export interface DisplayCommandRequest {
  action: 'reload' | 'identify' | 'night';
  mode?: NightCommand; // required for 'night'
  clientIds?: string[];
  /** screen ids or slugs */
  screens?: string[];
}

export interface StreamHello {
  revision: number;
  /** the screen, or the carousel id for a display on a carousel */
  screenId: string;
  targetKind?: DisplayTargetKind;
  slug: string;
  clientId: string | null;
  serverVersion: string;
  now: string; // server ISO time (clock-offset for announcement expiry)
  /** announcements still active for this screen; the display drops any other it is showing (missed clears) */
  activeAnnouncementIds: string[];
  /** doorbell ring on this screen right now, null = none (older servers: absent) */
  doorbellId?: string | null;
}

/**
 * A live command for one display, as GET /api/display/poll returns it. Names and payloads are the SSE event names
 * and payloads (StreamEvent), so one dispatcher (web/display/live.ts) serves both transports.
 */
export type DisplayCommand =
  | { type: 'reload' }
  | { type: 'night'; mode: NightCommand }
  | ({ type: 'identify' } & IdentifyPayload)
  | ({ type: 'announce' } & Announcement)
  | { type: 'announce-clear'; id: string | null }
  | { type: 'photos'; hidden?: string[] }
  /** self-hosted only: calendar data changed */
  | { type: 'events'; hash: string }
  /** privacy mode turned on or off for `screenId`: refetch config, events, countdowns and photos */
  | { type: 'privacy'; active: boolean; screenId?: string }
  | ({ type: 'doorbell' } & DoorbellRing)
  | { type: 'doorbell-end'; id: string }
  /** Familia changed (a routine ticked, stars, the family link): fetch the family state again */
  | { type: 'family'; rev?: number }
  /** the tasks of the Microsoft To Do lists changed: fetch the config again */
  | { type: 'todo' }
  /** a code for a person's phone (family access), on this screen for two minutes */
  | ({ type: 'access-code' } & AccessCodePayload)
  | { type: 'access-code'; clear: true; id: string; expiresAt: string };

/** GET /api/display/poll?client=&cursor=&rev=&hidden=&preview= (docs/API.md) */
export interface PollResponse {
  /** config revision; a different one makes the display refetch its config, events and countdowns */
  revision: number;
  /** screen (or carousel) bound to this display now; a different one (device moved) reloads the page */
  screenId: string;
  /** absent on servers without carousels (= 'screen') */
  targetKind?: DisplayTargetKind;
  /** server ISO time (clock offset for announcement expiry) */
  now: string;
  serverVersion: string;
  /** opaque; send it back on the next poll */
  cursor: string;
  /** true on the first poll or after an unknown cursor: `commands` only replays the active announcements */
  reset: boolean;
  /** in order, already filtered to this display */
  commands: DisplayCommand[];
  /** present on a reset and whenever `commands` holds announce or announce-clear */
  activeAnnouncementIds?: string[];
  /** present on a reset: the doorbell ring on this screen, null = none */
  doorbellId?: string | null;
  /** ms until the next poll, chosen by the server */
  next: number;
}

/** SSE `doorbell` / poll command: a ring on this screen (a later one with the same id extends it). */
export interface DoorbellRing {
  id: string;
  startedAt: string;
  updatedAt: string;
  expiresAt: string;
  /** play the door chime */
  sound: boolean;
  /** false: no camera picture (no camera chosen), only the label and the time */
  frames: boolean;
  /** ms between two frame requests to GET /api/display/doorbell/frame */
  refreshMs: number;
  /** the screen that rings (a display on a carousel asks for that screen's frames); older servers: absent */
  screenId?: string;
}

/** POST /api/hooks/doorbell, POST /api/admin/doorbell. Omitted fields take homeassistant.doorbell. */
export interface DoorbellRequest {
  action?: 'ring' | 'dismiss';
  /** 10..300 (clamped) */
  seconds?: number;
  /** slugs or ids; omitted = the configured screens (ring) or every ringing screen (dismiss) */
  screens?: string[];
  /** camera.* entity for this ring only */
  camera?: string;
  sound?: boolean;
}

export interface DoorbellResponse {
  ok: true;
  action: 'ring' | 'dismiss';
  delivered: number;
  /** slugs of the screens it reached */
  screens: string[];
  /** ring only: when the last of the rings ends */
  expiresAt?: string | null;
  /** servers that show uploaded snapshots (features.doorbellLive off): the ring has a picture */
  picture?: boolean;
}

export interface IdentifyPayload {
  name: string;
  slug: string;
  clientId: string | null;
  durationSec: number; // 10
}

// ---- §5 announcements, tokens ----

export interface AnnounceRequest {
  title?: string; // ≤120; title or body required
  body?: string; // ≤500
  emoji?: string;
  style?: AlertStyle; // default 'info'
  durationSec?: number; // 5..86400, default 30
  sound?: boolean; // default false
  /** screen ids or slugs; omitted/[] = all */
  screens?: string[];
}

export interface Announcement {
  id: string; // "a_xxx"
  title: string;
  body: string;
  emoji: string;
  style: AlertStyle;
  durationSec: number;
  sound: boolean;
  /** screen ids; [] = all */
  screenIds: string[];
  createdAt: string;
  expiresAt: string;
  via: 'admin' | 'hook' | 'family';
  by: string; // admin email, "token:<name>" or "family:<name>" (a person's phone dashboard)
  /** set when removed before expiry */
  clearedAt?: string | null;
}

export interface AnnounceResponse {
  ok: true;
  announcement: Announcement;
  delivered: number; // SSE clients that received it
}

export interface AnnouncementsResponse {
  active: Announcement[];
  history: Announcement[]; // newest first, ≤ 50
}

export interface ApiTokenInfo {
  id: string; // "tk_xxx"
  name: string;
  prefix: string; // first 8 chars of the token, e.g. "cs_Ab3x"
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  useCount: number;
  /** what it may do: '*' (everything but 'screen') and/or single scopes; absent on servers without tokenScopes */
  scopes?: TokenScope[];
}

export type TokenScope = '*' | 'announce' | 'commands' | 'privacy' | 'doorbell' | 'values' | 'screen';

/** A value pushed by POST /api/hooks/values (GET /api/hooks/values, GET /api/admin/values). */
export interface HookValueInfo {
  key: string;
  value: number | string | boolean;
  unit?: string;
  label?: string;
  updatedAt: string;
  /** slugs of the screens that show it */
  screens: string[];
}

/** A pushed value as a display gets it (GET /api/display/values, the SSE `values` event). `at` in ms. */
export interface DisplayValue {
  v: number | string | boolean;
  u?: string;
  l?: string;
  at: number;
}

/** GET /api/display/values and the SSE `values` event: only the keys the screen shows (null: no value now). */
export interface ValuesSnapshot {
  rev: number;
  full: boolean;
  screenId?: string;
  values: Record<string, DisplayValue | null>;
  /** screens with "Mostrar solo si": the items a condition hides now */
  hide?: string[];
}

export interface ApiTokenCreated {
  token: string; // shown ONCE
  info: ApiTokenInfo;
}

// ---- §6 backups, export/import, activity ----

export type BackupReason = 'save' | 'manual' | 'restore' | 'import' | 'migration';

export interface BackupInfo {
  id: string; // file name
  createdAt: string;
  revision: number;
  reason: BackupReason;
  size: number;
  screens: number;
  sources: number;
}

export interface ExportSecrets {
  passwordHash?: string;
  homeassistant?: { token?: string };
  /** API key of a weather source that needs one (Pirate Weather) */
  weather?: { apiKey?: string };
  immich?: { apiKey?: string };
  google?: { accounts: Record<string, unknown> };
  apiTokens?: unknown[];
}

export interface ExportBundle {
  format: 'marco-backup';
  formatVersion: 1;
  exportedAt: string;
  appVersion: string;
  config: StoredConfig;
  secrets?: ExportSecrets;
}

export interface ImportPreview {
  ok: boolean;
  errors: ValidationError[];
  fromVersion: number; // config version found (1 or 2)
  appVersion: string | null;
  exportedAt: string | null;
  hasSecrets: boolean;
  /** what importing the secrets would change in display access (null: the bundle has no links / devices) */
  secretsImpact?: { linksChanged: string[]; devicesRemoved: string[]; devicesAdded: number } | null;
  /** current display access mode: imports and restores always keep it */
  displayAccess?: 'private' | 'open';
  sections: { key: string; changed: boolean; summary: string }[];
  screens: { added: string[]; removed: string[]; changed: string[] };
  sources: { added: string[]; removed: string[]; changed: string[] };
  /** enabled scheduled messages that a partial import would leave without target screens (they get disabled) */
  orphanSchedules: { screensOnly: string[]; schedulesOnly: string[] };
  counts: { localEvents: number; birthdays: number; eventRules: number; countdowns: number; schedules: number };
  /** Marco Cloud: settings this server does not offer, left out of the import (absent on self-hosted servers). */
  notes?: ImportNote[];
  /** Marco Cloud: sections that go over a plan limit; importing one of them is refused (400 limit_exceeded). */
  overLimit?: { section: string; path: string; max: number }[];
}

/**
 * Something an import leaves out on this server, and why:
 *   secrets            the file has secrets (they are not imported here)
 *   homeassistant      Home Assistant (and its weather) cannot be reached
 *   signIn             admin password and Google sign-in (the account signs in instead)
 *   openDisplayAccess  open display access (screens use private links and pairing)
 *   insecureTls        calendars imported with certificate checks on (items)
 *   google             Google calendars of accounts not connected here (items)
 *   microsoft          Microsoft calendars of accounts not connected here, or on a server without them (items)
 *   blockedUrl         calendars, feeds and image widgets on an address this server cannot fetch (items)
 *   refreshMin         calendars refreshed every 30 minutes at most (items)
 *   news               news feeds, while this server offers no news
 *   photos             screens show the gallery: photos are not in the file
 *   webWidgets         web page widgets (this server shows images only; their placements go too) (items)
 *   widgetHttps        image widgets on a plain http address (items)
 *   widgetRefresh      image widgets refreshed more often than this server allows, now at its shortest (items)
 *   haWidgets          Home Assistant cards and cameras on Personalizado screens, left out (items: the screens)
 *   customWidgets      custom HTML cards on Personalizado screens, left out (items: the screens)
 */
export interface ImportNote {
  code:
    | 'secrets' | 'homeassistant' | 'signIn' | 'openDisplayAccess' | 'insecureTls' | 'google' | 'microsoft' | 'blockedUrl' | 'refreshMin' | 'news' | 'photos'
    | 'webWidgets' | 'widgetHttps' | 'widgetRefresh' | 'haWidgets' | 'customWidgets';
  items?: string[];
}

export interface ImportApplyRequest {
  bundle: unknown;
  includeSecrets: boolean;
  /** the admin password, when the session did not sign in within the last 10 minutes (with includeSecrets) */
  password?: string;
  /** top-level config keys to take from the bundle; omitted = all */
  sections?: string[];
}

export type ActivityType =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.password_changed'
  | 'auth.setup_completed'
  | 'auth.setup_rejected'
  | 'auth.2fa_enabled'
  | 'auth.2fa_disabled'
  | 'auth.2fa_failed'
  | 'auth.2fa_codes_renewed'
  | 'google.connected'
  | 'google.removed'
  | 'microsoft.connected'
  | 'microsoft.removed'
  | 'spotify.connected'
  | 'spotify.removed'
  | 'spotify.app_saved'
  | 'spotify.app_removed'
  | 'config.saved'
  | 'config.restored'
  | 'config.imported'
  | 'config.exported'
  | 'config.migrated'
  | 'backup.created'
  | 'backup.deleted'
  | 'source.error'
  | 'source.recovered'
  | 'announce.sent'
  | 'announce.cleared'
  | 'token.created'
  | 'token.revoked'
  | 'token.scopes'
  | 'token.used'
  | 'token.rejected'
  | 'display.connected'
  | 'display.command'
  | 'privacy.changed'
  | 'display.link_regenerated'
  | 'display.paired'
  | 'display.pair_failed'
  | 'display.device_updated'
  | 'display.device_revoked'
  | 'display.doorbell'
  | 'family.chore'
  | 'family.redeemed'
  | 'family.points'
  | 'family.undone'
  | 'family.link'
  | 'family.key_rejected'
  | 'family.access'
  | 'family.device'
  | 'family.code'
  | 'family.access_rejected'
  | 'family.message'
  | 'family.privacy'
  | 'family.night'
  | 'family.todo'
  | 'family.event'
  | 'todo.task'
  | 'ha.action'
  | 'activity.cleared'
  | 'update.requested'
  | 'update.finished'
  | 'update.failed'
  | 'update.settings';

export interface ActivityEntry {
  id: string; // sortable (time-based)
  ts: string;
  type: ActivityType;
  level: 'info' | 'warn' | 'error';
  actor: string; // email | "password" | "token:<name>" | "system" | "anonymous"
  ip: string | null;
  data?: Record<string, unknown>;
}

export interface ActivityResponse {
  items: ActivityEntry[]; // newest first
  hasMore: boolean;
}

// ---- §7 dashboard ----

export interface DashboardResponse {
  version: string;
  /** seconds; null where there is no long-running process (Marco Cloud) */
  uptime: number | null;
  revision: number;
  screens: { id: string; slug: string; name: string; isDefault: boolean; displaysOnline: number }[];
  displays: DisplayInfo[];
  nextEvents: CalEvent[];
  sources: SourceStatus[];
  /** `source` since 0.5 (Marco Cloud copies the dashboard shape, so it may be missing) */
  weather: (WeatherCurrent & { locationName: string; updatedAt: string; min: number; max: number; source?: WeatherSource }) | null;
  announcements: Announcement[];
  schedulesNow: { id: string; title: string; emoji: string; screenIds: string[]; until: string }[];
  activity: ActivityEntry[];
  /**
   * codes: default_password | source_errors | no_displays | outdated_displays | google_auth_failed | microsoft_auth_failed
   * | spotify_auth_failed | spotify_app_refused
   */
  warnings: string[];
}
