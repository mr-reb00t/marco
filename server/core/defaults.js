import ICON_RULES from './iconRules.js';
import { defaultFamily, defaultScreenFamily } from './familyCore.js';
import { defaultCanvas } from './canvasCore.js';

// Default configuration (created on first run, and used to back-fill missing keys on load).
// Icon rules are shared with the admin and display (server/core/iconRules.js).
export const DEFAULT_ICON_RULES = ICON_RULES.map((r) => ({ id: r.id, match: [...r.match], emoji: r.emoji, color: null }));

export const DEFAULT_SOURCES = [
  // A public example feed only. Add your own calendars (Google, iCal, vacation-rental feeds…) in the admin panel.
  {
    id: 'c_holidays', type: 'ics', name: 'Public holidays',
    url: 'https://calendar.google.com/calendar/ical/en.portuguese%23holiday%40group.v.calendar.google.com/public/basic.ics',
    color: '#f4a261', emoji: '🎉', kind: 'holidays', enabled: true, refreshMin: 360, insecureTls: false, privacy: 'keep',
  },
];

// ---- Config schema v2 (multi-screen). See docs/ARCHITECTURE.md. ----
export const CONFIG_VERSION = 2;

/** Built-in pseudo-source ids (F2). User sources can never take these ids. */
export const LOCAL_SOURCE_ID = 'local';
export const BIRTHDAYS_SOURCE_ID = 'birthdays';
export const RESERVED_SOURCE_IDS = [LOCAL_SOURCE_ID, BIRTHDAYS_SOURCE_ID];

/** Per-screen part of the keys that are split between global and per-screen ("merged sections"). */
export const SCREEN_SPLIT_KEYS = {
  calendar: ['enabled', 'view', 'weeks', 'weekStart', 'startOn', 'showLocation', 'showEndTime', 'showDayXofY', 'showLegend', 'hidePast', 'maxEventsPerDay', 'marquee', 'rotateBusyDays', 'compactBusyDays', 'eventStyle', 'agendaDays', 'sourceIds'],
  datetime: ['enabled', 'clock', 'format24', 'showSeconds', 'showAmPm', 'dateFormat', 'dateCustom'],
  weather: ['enabled', 'forecastDays', 'showHourly', 'showPrecipChance', 'place'],
  news: ['enabled', 'rotateSec'],
  todo: ['enabled'],
  countdowns: ['enabled', 'max'],
  // who appears on this screen (null = everyone), checking routines off by touching it, the QR of the family page
  family: ['memberIds', 'touch', 'showQr'],
};
/** Calendar settings the 'planner' layout comes with (the admin and the setup wizard apply them when it is picked). */
export const PLANNER_CALENDAR = { weeks: 'auto', eventStyle: 'cards' };
/** Keys that only exist per screen (whole object lives in the screen profile). */
export const SCREEN_ONLY_KEYS = ['screen', 'layout', 'background', 'message', 'alerts', 'privacy', 'widgets', 'canvas'];

// ---- Widgets: images and web pages the owner adds (config.widgets), placed per screen (screen.widgets) ----
export const WIDGET_TYPES = ['image', 'web', 'prices', 'currency'];
/** Refresh choices in seconds. Web pages also have 0 (never reload: many dashboards update themselves). */
export const WIDGET_REFRESH_SEC = [1, 10, 30, 60, 300, 900, 3600, 21600, 86400];
export const WEB_WIDGET_REFRESH_SEC = [0, 30, 60, 300, 900, 3600, 21600, 86400];
export const MAX_WIDGETS = 20;
/** Placements per screen (the full-screen layout's widget is not one of them). */
export const MAX_SCREEN_WIDGETS = 6;
export const WIDGET_PLACES = ['corner', 'side'];
export const WIDGET_SIZES = ['s', 'm', 'l'];
export const WIDGET_FITS = ['contain', 'cover'];
export const WIDGET_PREFIX = 'w_';

/** A complete screen profile with default values (screen.name lives in profile.name). */
export function defaultScreenProfile({ id = 's_main', slug = 'living-room', name = 'Living room' } = {}) {
  return structuredClone({
    id, slug, name,
    screen: {
      language: 'en', fontScale: 1.0, theme: 'dark', style: 'modern', accent: '#ff5a4e', orientation: 'auto', customCss: '',
      nightMode: { enabled: false, from: '23:00', to: '07:00', dim: 0.35 },
      // Modern style glass material (ignored by Classic). The defaults reproduce the original Modern look.
      glass: { appearance: 'auto', opacity: 0.5, blur: 18, tint: 'dark', edge: true },
      // the pills under the date of the usual designs (next event, happening now, birthdays, check-in/out)
      highlights: true,
    },
    // people: calendar ids shown as columns by the 'people' layout (null = automatic); corner: where the
    // 'photoFrame' layout puts its small clock card (tl, tr, bl, br)
    // widgetId: the widget the 'widget' layout shows full screen (null = none chosen yet)
    // plannerBar: where the 'planner' layout puts the clock and the weather on a landscape screen: 'side' (the side
    // column), 'top' or 'bottom' (a low strip above or below the month). Portrait screens always have it on top.
    layout: { preset: 'bigCalendar', sidePanel: 'left', sideWidth: 0.36, people: null, corner: 'br', widgetId: null, plannerBar: 'side' },
    background: {
      enabled: true, source: 'stock', stockTopic: 'nature', order: 'random', intervalSec: 120, brightness: 0.85, showMeta: false,
      cover: true, transition: 'webgl', ambient: 'aurora',
      panelBlur: 18, panelShade: 0.5, weatherFx: 'simple',
      // portraitFit: photos whose orientation differs from the screen ('auto' = blurred fill for Immich photos only);
      // immich: the albums played when source is 'immich' (server/immich.js)
      portraitFit: 'auto',
      immich: { albumIds: [], favoritesOnly: false },
      // scope: the photo in the side area of the layout ('side') or behind the whole screen ('screen'), with the
      // calendar over it as glass; calendarOpacity: how solid that glass is (0 = most see-through, 1 = almost opaque);
      // calendarBlur: how much the photo behind it is blurred (0 = sharp, 40 = most)
      scope: 'side', calendarOpacity: 0.5, calendarBlur: 18,
      // rules: "Fondos especiales" (core/bgRules.js), other photos on some days ({ id, when, photos }; first match wins)
      rules: [],
    },
    calendar: {
      enabled: true, view: 'month', weeks: 5, weekStart: 1, showLocation: false, showEndTime: false,
      // startOn: 'week' (the grid starts on the first day of this week, weekStart) or 'today' (no past days: the first
      // cell is today and the rows run on from there)
      startOn: 'week',
      showDayXofY: true, showLegend: true, hidePast: false, maxEventsPerDay: 4,
      // marquee: titles cut short slide to show the rest; rotateBusyDays: a day with more events than fit pages through them
      marquee: true, rotateBusyDays: true,
      // compactBusyDays: a month-grid day that cannot fit its events shows them as small one-line entries, and week
      // rows share the height by how many events they have (on for new screens, off for screens saved before it)
      compactBusyDays: true,
      // eventStyle: 'lines' (one-line chips) or 'cards' (time on top, title below on up to 2 lines, stacked in the day);
      // weeks may also be 'auto' (rows picked so each day fits maxEventsPerDay events). The planner layout sets both.
      eventStyle: 'lines',
      // agendaDays: how far the agenda view looks ahead, 7, 14 or 30 days, or 'auto' (Today and Tomorrow, then the
      // next days with events until the agenda is full)
      agendaDays: 'auto',
      sourceIds: null, // null = every enabled source (incl. local + birthdays); array = only these ids
    },
    datetime: { enabled: true, clock: 'digital', format24: true, showSeconds: true, showAmPm: false, dateFormat: 'weekday_d_month', dateCustom: '{dddd}, {d} {mmmm} {yyyy}' },
    // place: null = the household's place (config.weather), or { name, lat, lon } for this screen only
    // (core/weatherPlaces.js): every layout of the screen and its carousel steps show the weather of that place
    weather: { enabled: true, forecastDays: 5, showHourly: true, showPrecipChance: true, place: null },
    news: { enabled: true, rotateSec: 15 },
    todo: { enabled: false },
    message: { enabled: false, text: '', emoji: '💬' },
    countdowns: { enabled: true, max: 4 },
    alerts: { enabled: true, sound: true, volume: 0.6 },
    // privacy mode (server/core/privacy.js): photos replaced by stock ones while private, a small lock on screen,
    // and rules that turn it on by themselves ({ id, enabled, days, from, to }, `to < from` crosses midnight)
    privacy: { hidePhotos: false, showLock: true, schedule: [] },
    // Familia on this screen (server/core/familyCore.js): memberIds null = every member, touch off, QR card on
    family: defaultScreenFamily(),
    // widgets on this screen, in stacking order: { widgetId, place: 'corner' | 'side', corner, size: 's' | 'm' | 'l' }
    widgets: [],
    // the Personalizado layout ('canvas', server/core/canvasCore.js): its widgets, background and sidebar; inert on
    // every other layout
    canvas: defaultCanvas(),
  });
}

export function defaultConfig() {
  return structuredClone({
    version: CONFIG_VERSION,
    revision: 1,
    defaultScreen: 's_main',
    screens: [defaultScreenProfile()],
    // ---- global sections ----
    calendar: { sources: DEFAULT_SOURCES, iconRules: DEFAULT_ICON_RULES },
    datetime: { timezone: 'Europe/Lisbon' },
    weather: {
      // provider: a source of server/core/weather.js (or 'homeassistant'); model: an Open-Meteo forecast model
      provider: 'open-meteo', model: 'best_match', locationName: 'Lisbon, Portugal', lat: 38.7223, lon: -9.1393, units: 'metric',
      haWeatherEntity: '', haIndoorTempEntity: '', haIndoorHumidityEntity: '',
    },
    news: {
      feeds: [{ id: 'n1', name: 'BBC News – World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', enabled: true }],
      maxItems: 30,
    },
    // lists: Microsoft To Do lists shown with the typed items ({ id, type: 'microsoft', microsoftAccount,
    // microsoftListId, name, enabled }); their open tasks are read by the server, never stored here
    todo: { items: [], lists: [] },
    localEvents: { enabled: true, name: 'Family', color: '#e76f51', emoji: '', privacy: 'busy', items: [] },
    // tidyTitles: birthday titles from any calendar ("Astrid's Birthday", "Cumple de Ana") show only the name next
    // to the 🎂 (server/rules.js tidyTitleWhy); off keeps the calendar's own title
    birthdays: { enabled: true, name: 'Birthdays', color: '#ff6f91', emoji: '🎂', showAge: true, tidyTitles: true, privacy: 'keep', items: [] },
    eventRules: { items: [] },
    countdowns: { items: [], includeBirthdays: true, birthdayDays: 30, includeFlagged: true, horizonDays: 365 },
    schedules: { items: [] },
    // carousels: screens shown one after another on the same TV (server/core/carousels.js). Each item:
    // { id: 'v_…', enabled, name, slug, transition: 'fade' | 'slide' | 'zoom' | 'wipe' | 'dissolve' | 'random' | 'none',
    //   transitionSpeed: 'fast' | 'normal' | 'slow', holdOnAlert, nightRotate, offScreenId,
    //   schedule: [{ id, enabled, days, from, to }], steps: [{ screenId, seconds }] }
    carousels: { items: [] },
    // widgets: { id: 'w_…', type: 'image' | 'web' | 'prices' | 'currency', name, options: { url, refreshSec, fit, bust,
    // prices?, currency? } } (prices: electricity price widget, server/core/pricesCore.js; currency: exchange rates,
    // server/core/dataCore.js, the Divisas card's options; no url). Where each one
    // shows is chosen per screen (screen.widgets, layout.widgetId).
    widgets: [],
    // doorbell: camera entity (camera.*), seconds on screen (10..300), screenIds ([] = all), door chime on/off
    homeassistant: {
      enabled: false, url: 'http://homeassistant.local:8123',
      doorbell: { camera: '', seconds: 60, screenIds: [], sound: true },
    },
    // Immich photo library (server/immich.js): the API key is in secrets.json, never in the config
    immich: { enabled: false, url: '', insecureTls: false },
    auth: { allowedGoogleEmails: [], passwordLoginEnabled: true },
    // 'private': every display needs its private link (/d/<key>) or a paired-device token (server/displayAccess.js).
    // 'open': legacy LAN mode (/ and /?screen= work without a key). Configs saved before 0.3 load as 'open'.
    security: { displayAccess: 'private' },
    // Familia (core/familyCore.js): members, routines with stars, rewards and the week's meals. What was done
    // lives in data/family.json (server/family.js), not here.
    family: defaultFamily(),
  });
}
