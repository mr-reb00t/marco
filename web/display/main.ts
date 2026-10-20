// Wall display entry point: wires config, data polling, SSE, the ticker, widgets and WebGL layers.
// Self-hosted fonts (bundled by Vite): the display must render with no Internet.
import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import '../shared/emoji-font.css';
import './styles.css';
import './styles-views.css';
import './styles-modern.css';
import './styles-planner.css';
import './styles-kids.css';
import './styles-canvas.css';
import './styles-ha.css';
import './styles-data.css';
import './styles-canvas-room.css';
import './styles-canvas-mini.css';
import type {
  Announcement, CountdownsResponse, DisplayConfig, EventsResponse, FamilyDisplayState, Lang, NewsResponse, NightCommand, Photo, PhotosResponse, PlannerBar, StreamHello, WeatherResponse,
} from '../shared/types';
import { LANGS } from '../shared/i18n';
import { api, ApiError, paths, prefetchJSON } from './api';
import { initTodoTaps, isListTask } from './todoTaps';
import { parseColor, toHex } from './color';
import { ctx, setCtxConfig } from './ctx';
import { normalizeAgendaDays, normalizeConfig } from './defaults';
import { Heartbeat, noteError } from './heartbeat';
import {
  authHeaders, clearDeviceToken, clientId, credential, credentialKind, getActiveScreen, isPreview, isWidgetOnly, screenKey, screenNs, setActiveScreen, storedDeviceToken, withScreen,
} from './identity';
import { CarouselController, emptyBundle, type Bundle, type BundlePart } from './carousel';
import { NavIdle, planNav, swipeDir, type NavMemo } from './nav';
import type { NavProgress, NavSource } from './widgets/canvas/types';
import { ScreenSwitcher, type SwitchGL } from './screenSwitch';
import { isArmDesktop, isArmLinuxUA, isLowPower, isLowPowerGPU, planSwitch, type SwitchInfo, type SwitchPlan } from './switchPlan';
import { $ } from './dom';
import { type NEvent, normalizeEvents } from './eventModel';
import type { AmbientLayer } from './gl/ambientLayer';
import type { DissolveLayer } from './gl/dissolveLayer';
import type { Engine } from './gl/engine';
import type { PhotoLayer } from './gl/photoLayer';
import type { PrecipLayer } from './gl/precipLayer';
import type { WeatherFxLayer } from './gl/weatherFxLayer';
import { weatherFxOf } from './icons';
import {
  mockAnnouncements, mockCarouselConfigs, mockConfig, mockCountdowns, mockEvents, mockFamily, mockNavScreens, mockNews, mockPhotos, mockWeather, mockPlaceWeather,
} from './mock';
import { loadCache, loadScreenCache, on, saveCache, saveScreenCache, set, setConfigOverlay, state } from './store';
import { detectLiveMode, startConfigPoll, startPoll, type StreamHandlers } from './live';
import { connectStream, pollUrl } from './stream';
import { current, freezeClock, onTick, setClockOffset, setTimezone, startTicker, type Tick } from './time';
import { Agenda } from './widgets/agenda';
import { Announcements, IdentifyOverlay, ScheduleBanners, serverNow, setServerNow } from './widgets/alerts';
import { Countdowns } from './widgets/countdowns';
import { DoorbellOverlay, type FrameSource } from './widgets/doorbell';
import { mockDoorbellFrame, mockDoorbellRing } from './mockDoorbell';
import { MonthCalendar } from './widgets/calendar';
import { AUTO_WEEKS_MAX } from './cards';
import { Clock } from './widgets/clock';
import { renderMessage, renderTodo } from './widgets/extras';
import { Highlights } from './widgets/highlights';
import { News } from './widgets/news';
import { Photos, photoStats, type SlideshowPosition } from './widgets/photos';
import { calendarSheetAlpha, effectiveBackground, glassVars, normalizeGlass, photoOnWholeScreen } from '../shared/glass';
import { Weather } from './widgets/weather';
import { screenWeather, weatherSig } from './weatherPlaces';
import { weatherPlacesOf } from '../../server/core/weatherPlaces.js';
import { VIEW_PRESETS, Views } from './widgets/views';
import { checkSetup, showWelcome, waitForSetup } from './widgets/welcome';
import { afterPairUrl, pairHealth, pairingLang, showPairing } from './widgets/pairing';
import { showScreenMissing } from './widgets/screenMissing';
import { healthOnce, loadEmojiWebFont } from './health';
import { loadBoot, peekBoot } from './boot';
import { armBootShell, hideBootShell } from './bootShell';
import { isKidsPreset, Kids, withToggle } from './widgets/kids';
import { refreshMarquee } from './marquee';
import { CustomWidgets } from './widgets/custom';
import { Canvas, sidebarSide } from './widgets/canvas';
import { HaFeed } from './haFeed';
import { ValuesFeed } from './valuesFeed';
import { DataFeed } from './dataFeed';
import { demoData } from './mockData';
import { demoValues } from './mockCanvas';
import { HaTouch } from './widgets/canvas/touch';
import { CANVAS_KINDS, canvasCards, SIDEBAR_SHARE } from '../../server/core/canvasCore.js';
import { eventsWindow } from '../../server/core/bootstrap.js';
import { rotatorPins } from './widgets/canvas/rotator';

const params = ctx.params;
if (isWidgetOnly) document.documentElement.classList.add('widget-only');
const forceDemo = params.get('demo') === '1';
const lite = ctx.lite;
if (lite) document.documentElement.classList.add('lite');

// ?now=2026-10-09T10:43 → fixed clock offset (for screenshots / testing)
const nowParam = params.get('now');
if (nowParam) {
  const target = Date.parse(nowParam);
  if (Number.isFinite(target)) setClockOffset(target - Date.now());
  // &shot=1 (or &shot=<fixture> of a demo layout): the clock stands still there (screenshots, golden fixtures)
  if (Number.isFinite(target) && params.has('shot') && params.get('shot') !== '0') freezeClock(target);
}

// ---------------------------------------------------------------------------------------------
// DOM + widgets
// ---------------------------------------------------------------------------------------------
const app = $('#app');
const photoArea = $('.photo-area');
const sideEl = $('.side');
const mainEl = $('.main');
const clock = new Clock($('#clock'));
// the pills under the date: screen.highlights off ("Avisos bajo la fecha") hides them
const highlights = new Highlights($('#highlights'), { shown: () => ctx.cfg.screen.highlights !== false });
const weather = new Weather($('#weather'));
const calendar = new MonthCalendar($('#calendar'));
const agenda = new Agenda($('#agenda'), {}); // days: calendar.agendaDays
const sideAgenda = new Agenda($('#side-agenda'), { days: 3, compact: true, maxPerDay: 4 });
const news = new News($('#news'));
const photos = new Photos(photoArea, $('.photo-meta'));
const countdowns = new Countdowns($('#countdowns'), $('#cd-strip'));
const schedules = new ScheduleBanners($('#sched'), $('#sched-strip'));
const announcements = new Announcements($('#alerts'));
const identify = new IdentifyOverlay($('#identify'));
/** Doorbell frames: GET /api/display/doorbell/frame (a counter keeps every answer fresh), drawn ones in the demo.
 *  404 and lost access mean there is nothing more to show for this ring. */
/** Screen that rings (a display on a carousel asks for that screen's frames, whichever screen is on display). */
let doorbellScreen = '';
const doorbellFrames: FrameSource = async (n, signal) => {
  if (state.demo) return mockDoorbellFrame(n);
  const r = await fetch(withScreen(`/api/display/doorbell/frame?n=${n}`, doorbellScreen || undefined), { headers: authHeaders(), cache: 'no-store', signal });
  if (r.status === 404 || r.status === 401 || r.status === 403) return null;
  if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) throw new Error(`frame: HTTP ${r.status}`);
  return r.blob();
};
// a ring that ends lets a carousel held by it move on right away
const doorbell = new DoorbellOverlay($('#doorbell'), doorbellFrames, (on) => {
  if (!on) carousel?.tick();
});
const views = new Views($('#view'));
const kids = new Kids($('#kids'), (id, done) => toggleChore(id, done));
const custom = new CustomWidgets();
// Home Assistant states of the Personalizado cards (haFeed.ts): pushed as the SSE `ha` event, asked for on changes
const haFeed = new HaFeed(() => {
  syncHaTouch();
  canvasView.onData('ha');
});
// values pushed by POST /api/hooks/values for the Valor cards (valuesFeed.ts): the SSE `values` event, asked for on
// changes and every 30 s on the poll channel
const valuesFeed = new ValuesFeed(() => canvasView.onData('values'));
// numbers of the data cards (market, sports, stocks; dataFeed.ts): asked of this server every minute while one shows
const dataFeed = new DataFeed(() => canvasView.onData('data'));
// taps on the Home Assistant controls (widgets/canvas/touch.ts): only on a screen that allows them, online, not
// private, never in the admin's preview (a click there would switch a real light)
haFeed.gate = () => (state.online || state.demo) && !state.config?.privacy?.active && !isPreview;
const haTouch = new HaTouch([$('#canvas'), $('#canvas-side')], haFeed, {
  dimmed: () => nightNow,
  wake: wakeFromTap,
});
function syncHaTouch(): void {
  haTouch.set(canvasView.active && haFeed.touch());
}
// Personalizado (layout 'canvas'): the owner's widgets on a grid (widgets/canvas.ts)
const canvasView = new Canvas($('#canvas'), $('#canvas-side'), {
  events: () => eventsNormalized(),
  low: () => canvasLow(),
  photoArea: () => photoArea,
  media: (boxes) => custom.setCanvasBoxes(boxes),
  // the family cards get what the kids layouts get, with the same rules (familyShown, toggleChore)
  family: () => familyShown(current()),
  toggleChore: (id, done) => toggleChore(id, done),
  announcement: () => announcements.newest(),
  ha: haFeed,
  values: valuesFeed,
  data: dataFeed,
  nav: {
    shows: () => isPreview || !!ctx.cfg?.canvas?.taps,
    live: () => navLive(),
    carousel: () => !!carousel,
    go: (target, returnMin) => void navGo(target, returnMin),
    pause: (returnMin) => navPause(returnMin),
    paused: () => !!carousel?.paused,
    current: () => getActiveScreen() || state.config?.screenId || '',
    progress: () => navProgress(),
  } satisfies NavSource,
});
announcements.onChange = () => canvasView.onData('announcements');
let sideFitT: ReturnType<typeof setTimeout> | null = null;
custom.onSideChange = () => {
  if (sideFitT) clearTimeout(sideFitT);
  sideFitT = setTimeout(() => fitSide(), 50);
};
const statusDot = $('#status');
const night = $('#night');
let customStyle: HTMLStyleElement | null = null;

let nEvents: NEvent[] = [];
let nEventsKey = '';

// ---------------------------------------------------------------------------------------------
// WebGL (optional, never fatal)
// ---------------------------------------------------------------------------------------------
let engine: Engine | null = null;
let photoLayer: PhotoLayer | null = null;
let ambient: AmbientLayer | null = null;
let precip: PrecipLayer | null = null;
let wxfx: WeatherFxLayer | null = null;
let dissolve: DissolveLayer | null = null;

let glLoading: Promise<void> | null = null;
/** initGL is loading three.js or starting the engine (the CSS backdrop waits for it, so it does not flash first). */
let glStarting = false;
/** three.js is loaded lazily so ?lite=1 / no-WebGL screens never download or parse it. */
function initGL(): Promise<void> {
  if (engine || lite) return Promise.resolve();
  if (glLoading) return glLoading;
  glStarting = true;
  glLoading = (async () => {
  try {
    const [{ Engine }, { PhotoLayer }, { PrecipLayer }, { AmbientLayer }, { WeatherFxLayer }, { DissolveLayer }] = await Promise.all([
      import('./gl/engine'), import('./gl/photoLayer'), import('./gl/precipLayer'), import('./gl/ambientLayer'), import('./gl/weatherFxLayer'),
      import('./gl/dissolveLayer'),
    ]);
    engine = Engine.create($('#gl') as HTMLCanvasElement);
    if (!engine) throw new Error('no webgl2');
    photoLayer = new PhotoLayer(() => photoArea);
    precip = new PrecipLayer(() => photoArea);
    wxfx = new WeatherFxLayer(() => photoArea);
    wxfx.night = nightNow;
    // a Personalizado screen's animated background is the whole page (its sidebar too); the other layouts keep it
    // behind the calendar
    ambient = new AmbientLayer(() => (app.classList.contains('preset-canvas') ? app : mainEl));
    engine.add(ambient);
    engine.add(photoLayer);
    engine.add(precip);
    engine.add(wxfx);
    // last: the carousel dissolve draws over everything else on the canvas
    dissolve = new DissolveLayer(() => engine?.canvas ?? null);
    engine.add(dissolve);
    engine.onLost = () => {
      disableGL();
      scheduleGLRetry();
    };
    photos.setGL(photoLayer);
    document.documentElement.classList.add('gl');
    engine.start();
  } catch (e) {
    console.warn('[gl] disabled', e);
    disableGL();
  } finally {
    glStarting = false;
  }
  })();
  return glLoading;
}

// Context loss / frame failure after long uptime: retry with backoff on a fresh canvas instead of staying
// in DOM-only mode until a manual reload.
let glRetries = 0;
let glRetryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleGLRetry(): void {
  if (glRetryTimer || glRetries >= 6) return;
  const delay = Math.min(30_000 * 2 ** glRetries, 30 * 60_000);
  glRetries++;
  glRetryTimer = setTimeout(() => {
    glRetryTimer = null;
    const old = document.getElementById('gl');
    if (old) old.replaceWith(old.cloneNode(false)); // a lost context stays bound to its canvas
    glLoading = null;
    glFailed = false;
    if (state.config) applyConfig(state.config);
  }, delay);
}

function disableGL(): void {
  try {
    engine?.dispose();
  } catch { /* ignore */ }
  engine = null;
  photoLayer = null;
  ambient = null;
  precip = null;
  wxfx = null;
  dissolve = null;
  document.documentElement.classList.remove('gl', 'gl-ambient');
  photos.setGL(null);
  photos.applyConfig();
  syncAmbientCss();
}

/** The ambient effect the screen shows, drawn by WebGL or not ('none': no animated backdrop here). */
let ambientWanted: 'aurora' | 'particles' | 'none' = 'none';
/**
 * The backdrop drawn in CSS (styles.css, .amb-css): the ambient effect is on but WebGL does not draw it (lite, a
 * browser that draws in software, no WebGL, WebGL failed or its context was lost). Not while WebGL is still starting.
 */
function syncAmbientCss(): void {
  const root = document.documentElement;
  const glOn = !!engine && !!ambient && root.classList.contains('gl-ambient');
  const css = ambientWanted !== 'none' && !glOn && !glStarting;
  root.classList.toggle('amb-css', css);
  root.classList.toggle('amb-aurora', css && ambientWanted === 'aurora');
  root.classList.toggle('amb-particles', css && ambientWanted === 'particles');
}

// ---------------------------------------------------------------------------------------------
// Config application
// ---------------------------------------------------------------------------------------------
function hueShift(hex: string, deg: number): string {
  const [r, g, b] = parseColor(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + deg + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
}

const PRESETS = [
  'bigCalendar', 'leftRight', 'topBottom', 'bigTime', 'agenda', 'today', 'people', 'photoFrame', 'twoWeeks', 'board', 'bedside', 'planner',
  // one widget fills the screen (widgets/custom.ts)
  'widget',
  // kids layouts (widgets/kids.ts): Modern style only
  'kidsRoutines', 'kidsFamily', 'kidsMeals',
  // Personalizado (widgets/canvas.ts): Modern style only
  'canvas',
];
/** Newer layouts built on an older one's frame: they also get its class, so its rules (and the Modern ones) apply. */
const PRESET_BASE: Record<string, string> = { today: 'bigCalendar', twoWeeks: 'bigCalendar', people: 'topBottom', board: 'topBottom' };

/**
 * Planner: the top / bottom frame on a portrait screen. On a landscape one, the big calendar frame (side column), or
 * the top / bottom frame with a low strip when layout.plannerBar is 'top' or 'bottom'.
 */
function presetBase(preset: string, portrait: boolean, bar: PlannerBar = 'side'): string {
  if (preset === 'planner') return portrait || bar !== 'side' ? 'topBottom' : 'bigCalendar';
  return PRESET_BASE[preset] ?? '';
}

/** Where the planner puts the clock and the weather on this screen ('side' anywhere else, and on portrait screens). */
function plannerBar(cfg: DisplayConfig, preset: string, portrait: boolean): PlannerBar {
  if (preset !== 'planner' || portrait) return 'side';
  const q = params.get('bar') || cfg.layout.plannerBar;
  return q === 'top' || q === 'bottom' ? q : 'side';
}

function effectivePreset(cfg: DisplayConfig): string {
  const p = params.get('preset') || cfg.layout.preset;
  if (!PRESETS.includes(p)) return 'bigCalendar';
  // the kids layouts are drawn with the Modern style only: Classic shows the big calendar
  if (isKidsPreset(p) && cfg.screen.style !== 'modern') return 'bigCalendar';
  // Personalizado is a Modern design; a server that sends no canvas (older, or ?preset=canvas on another screen) has
  // nothing to lay out
  if (p === 'canvas' && (cfg.screen.style !== 'modern' || !cfg.canvas)) return 'bigCalendar';
  return p;
}

function isPortrait(cfg: DisplayConfig): boolean {
  const o = cfg.screen.orientation;
  if (o === 'portrait') return true;
  if (o === 'landscape') return false;
  return window.innerHeight > window.innerWidth * 1.05;
}

function applyLayout(): void {
  const cfg = ctx.cfg;
  const preset = effectivePreset(cfg);
  const portrait = isPortrait(cfg);
  const side = params.get('side') || cfg.layout.sidePanel;
  const corner = params.get('corner') || cfg.layout.corner || 'br';
  const bar = plannerBar(cfg, preset, portrait);
  app.className = [
    // kept until revealApp() fades the screen in (with the Modern style over a photo, once the photo is there)
    app.classList.contains('booting') ? 'booting' : '',
    `preset-${preset}`,
    // Personalizado lays its own frame out: the orientation and side rules of the other layouts must not reach its cards
    ...(preset === 'canvas' ? [portrait ? 'cv-portrait' : 'cv-landscape'] : [`side-${side === 'right' ? 'right' : 'left'}`, portrait ? 'portrait' : 'landscape']),
    cfg.background.enabled ? 'has-photo' : 'no-photo',
    // background.scope 'screen': the photo behind the whole screen, the calendar over it as glass
    photoOnWholeScreen(cfg.background, preset) ? 'bg-screen' : '',
    presetBase(preset, portrait, bar) ? `preset-${presetBase(preset, portrait, bar)}` : '',
    // planner on a landscape screen with the clock and the weather in a strip (styles-planner.css)
    bar !== 'side' ? `pbar pbar-${bar}` : '',
    preset === 'photoFrame' ? `corner-${['tl', 'tr', 'bl', 'br'].includes(corner) ? corner : 'br'}` : '',
    // Personalizado: where its sidebar is on this orientation, how it is filled, and the background
    ...(preset === 'canvas' && cfg.canvas
      ? [
          `cv-side-${sidebarSide(cfg.canvas, portrait)}`, `cv-fill-${cfg.canvas.sidebar.fill}`, `cv-bg-${cfg.canvas.background}`, `cv-scrim-${cfg.canvas.scrim ?? 'uniform'}`,
          // "Densidad compacta" (styles-canvas.css)
          cfg.canvas.density === 'compact' ? 'cv-dense' : '',
        ]
      : []),
  ].filter(Boolean).join(' ');
  if (preset === 'canvas' && cfg.canvas) {
    const share = SIDEBAR_SHARE[cfg.canvas.sidebar.size] ?? SIDEBAR_SHARE.normal;
    app.style.setProperty('--cv-side', `${(share * 100).toFixed(2)}%`);
    app.style.setProperty('--cv-dim', String(cfg.canvas.dim ?? 0.15));
    if (cfg.canvas.background === 'solid' && cfg.canvas.color) app.style.setProperty('--cv-bg', cfg.canvas.color);
    else app.style.removeProperty('--cv-bg');
  } else for (const k of ['--cv-side', '--cv-dim', '--cv-bg']) app.style.removeProperty(k);
  app.classList.toggle('has-view', VIEW_PRESETS.includes(preset));
  app.classList.toggle('is-kids', isKidsPreset(preset));
  views.setPreset(preset);
  kids.setPreset(preset);
  const view = params.get('view') || cfg.calendar.view;
  const showAgendaMain = preset === 'agenda' || view === 'agenda';
  app.classList.toggle('view-agenda', showAgendaMain);
  app.classList.toggle('cal-off', !cfg.calendar.enabled);
  engine?.invalidate();
}

/**
 * Modern style glass: settings + current photo → a few custom properties on <html> (no extra layers).
 * Re-run on every new photo, since Auto and "from the photo" depend on it.
 */
const GLASS_VARS = ['--g-rgb', '--g-solid', '--g-a', '--g-a-wx', '--g-filter', '--g-sheet-rgb', '--g-sheet-a', '--g-sheet-filter', '--g-edge'];
function applyGlass(): void {
  const cfg = ctx.cfg;
  const root = document.documentElement;
  if (cfg.screen.style !== 'modern') {
    for (const k of GLASS_VARS) root.style.removeProperty(k);
    root.classList.remove('glass-ink-dark', 'glass-no-edge', 'glass-thin');
    return;
  }
  const g = glassVars(cfg.screen.glass, cfg.background.enabled ? photoStats : null, { lite, hasPhoto: cfg.background.enabled });
  for (const [k, v] of Object.entries(g.vars)) root.style.setProperty(k, v);
  // Personalizado: each card works out its own ink (widgets/canvas.ts look()), so the screen's would only leak into
  // the rows inside the cards
  const canvas = effectivePreset(cfg) === 'canvas';
  root.classList.toggle('glass-ink-dark', g.inkDark && !canvas);
  root.classList.toggle('glass-no-edge', !g.edge);
  root.classList.toggle('glass-thin', g.thin && !canvas);
}
window.addEventListener('marco:photo-tone', () => applyGlass());

/** The shape of the screen as far as the week-row caps in applyConfig go (portrait or not, small landscape or not). */
let lastFrameKey = '';
function frameKey(): string {
  const small = window.innerWidth > window.innerHeight && window.innerHeight <= 820;
  return `${isPortrait(ctx.cfg) ? 'p' : 'l'}|${small ? 's' : 'n'}`;
}

function applyConfig(raw: DisplayConfig): void {
  const cfg = normalizeConfig(raw);
  const v = params.get('view');
  if (v === 'month' || v === 'agenda' || v === 'week') cfg.calendar.view = v;
  // URL overrides (handy for testing a screen without touching the saved config)
  const pc = params.get('clock');
  if (pc === 'analog' || pc === 'digital') cfg.datetime.clock = pc;
  const pt = params.get('theme');
  if (pt === 'light' || pt === 'dark') cfg.screen.theme = pt;
  const ps = params.get('style');
  if (ps === 'classic' || ps === 'modern') cfg.screen.style = ps;
  // ?highlights=0|1 (the pills under the date: next event, happening now, birthdays, check-in/out)
  const phl = params.get('highlights');
  if (phl === '0' || phl === '1') cfg.screen.highlights = phl === '1';
  // glass previews: ?glass=clear|tinted|auto &glassOpacity=0..1 &glassBlur=0..40 &glassTint=dark|light|photo &glassEdge=0|1
  const gq = (k: string) => params.get(k);
  if (gq('glass') || gq('glassOpacity') || gq('glassBlur') || gq('glassTint') || gq('glassEdge')) {
    const g = { ...cfg.screen.glass } as Record<string, unknown>;
    if (gq('glass')) g.appearance = gq('glass');
    if (gq('glassOpacity')) g.opacity = gq('glassOpacity');
    if (gq('glassBlur')) g.blur = gq('glassBlur');
    if (gq('glassTint')) g.tint = gq('glassTint');
    if (gq('glassEdge')) g.edge = gq('glassEdge') !== '0';
    cfg.screen.glass = normalizeGlass(g);
  }
  // ?marquee=0|1 (titles that slide) and ?rotate=0|1 (busy days that page through their events)
  const pm = params.get('marquee');
  if (pm === '0' || pm === '1') cfg.calendar.marquee = pm === '1';
  const pr = params.get('rotate');
  if (pr === '0' || pr === '1') cfg.calendar.rotateBusyDays = pr === '1';
  // ?compact=0|1 (busy days as small one-line entries, rows sized by their events), ?weeks=1..8|auto and ?cards=0|1
  // (calendar.eventStyle: cards or one-line chips)
  const pcp = params.get('compact');
  if (pcp === '0' || pcp === '1') cfg.calendar.compactBusyDays = pcp === '1';
  const pw = Number(params.get('weeks'));
  if (Number.isInteger(pw) && pw >= 1 && pw <= 8) cfg.calendar.weeks = pw;
  if (params.get('weeks') === 'auto') cfg.calendar.weeks = 'auto';
  // ?agendaDays=auto|7|14|30 (how far the agenda view looks ahead)
  if (params.has('agendaDays')) {
    const pad = params.get('agendaDays');
    cfg.calendar.agendaDays = normalizeAgendaDays(pad === 'auto' ? 'auto' : Number(pad));
  }
  // ?startOn=week|today (the grid starts on the first day of this week, or on today with no past days)
  const pso = params.get('startOn');
  if (pso === 'week' || pso === 'today') cfg.calendar.startOn = pso;
  const pcd = params.get('cards');
  if (pcd === '0' || pcd === '1') cfg.calendar.eventStyle = pcd === '1' ? 'cards' : 'lines';
  // automatic weeks: at most 6 rows, fewer where a layout caps the rows below
  let autoMax = AUTO_WEEKS_MAX;
  const capWeeks = (n: number) => {
    if (cfg.calendar.weeks === 'auto') autoMax = Math.min(autoMax, n);
    else cfg.calendar.weeks = Math.min(cfg.calendar.weeks, n);
  };
  const pa = params.get('ambient');
  if (pa === 'aurora' || pa === 'particles' || pa === 'none') cfg.background.ambient = pa;
  const ptr = params.get('transition');
  if (ptr === 'webgl' || ptr === 'fade' || ptr === 'none') cfg.background.transition = ptr;
  // ?bgScope=side|screen (the photo behind the whole screen) and ?calOpacity=0..1 (how solid the calendar glass is)
  const pbs = params.get('bgScope');
  if (pbs === 'side' || pbs === 'screen') cfg.background.scope = pbs;
  const pco = Number(params.get('calOpacity') ?? NaN);
  if (params.has('calOpacity') && Number.isFinite(pco)) cfg.background.calendarOpacity = Math.min(1, Math.max(0, pco));
  const pcb = Number(params.get('calBlur') ?? NaN);
  if (params.has('calBlur') && Number.isFinite(pcb)) cfg.background.calendarBlur = Math.min(40, Math.max(0, Math.round(pcb)));
  const pfx = params.get('wxfx');
  if (pfx === 'off' || pfx === 'simple' || pfx === 'rich') cfg.background.weatherFx = pfx;
  // the top-bottom preset has a shorter calendar: cap the number of week rows so chips stay readable
  if (effectivePreset(cfg) === 'topBottom') capWeeks(4);
  // so has the planner with its clock and weather in a strip above or below the month (landscape)
  if (plannerBar(cfg, effectivePreset(cfg), isPortrait(cfg)) !== 'side') capWeeks(4);
  // Two weeks: the month grid with two roomy rows (more events per day)
  if (effectivePreset(cfg) === 'twoWeeks') {
    cfg.calendar.view = 'month';
    cfg.calendar.weeks = 2;
    cfg.calendar.maxEventsPerDay = Math.max(cfg.calendar.maxEventsPerDay, 8);
  }
  // Personalizado: its own background (canvas.background): the photo behind the whole screen or in the sidebar only,
  // the animated backdrop, or a plain colour. The saved screen.background (source, interval, ...) still applies.
  if (effectivePreset(cfg) === 'canvas' && cfg.canvas) {
    cfg.background = effectiveBackground(cfg.background, cfg.canvas);
    if (cfg.canvas.background !== 'ambient') cfg.background.ambient = 'none';
    // "Animado" with the screen's ambient effect off would be a plain black page: it shows the aurora
    else if (cfg.background.ambient === 'none') cfg.background.ambient = 'aurora';
  }
  // Bedside: a dark room, no photo and no animated background. The kids layouts: the same pastel page everywhere,
  // unless the photo goes behind the whole screen (background.scope 'screen'), with the page over it as glass.
  if (effectivePreset(cfg) === 'bedside' || (isKidsPreset(effectivePreset(cfg)) && !photoOnWholeScreen(cfg.background, effectivePreset(cfg)))) {
    cfg.background.enabled = false;
    cfg.background.ambient = 'none';
  }
  // Small landscape screens (e.g. 1280×720 on the Pi): one week fewer so text can be bigger.
  if (window.innerWidth > window.innerHeight && window.innerHeight <= 820 && effectivePreset(cfg) !== 'twoWeeks') capWeeks(4);
  calendar.maxAutoWeeks = autoMax;
  setCtxConfig(cfg);
  lastFrameKey = frameKey();
  setTimezone(ctx.tz);
  const root = document.documentElement;
  root.lang = ctx.lang;
  const accent = cfg.screen.accent;
  const light = cfg.screen.theme === 'light';
  root.classList.toggle('theme-light', light);
  // Display style (independent of the layout): 'modern' scopes every rule in styles-modern.css; classic adds nothing.
  root.classList.toggle('style-modern', cfg.screen.style === 'modern');
  applyGlass();
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-rgb', parseColor(accent).join(' '));
  root.style.setProperty('--fs', String(cfg.screen.fontScale));
  root.style.setProperty('--panel-blur', String(cfg.background.panelBlur ?? 18));
  root.style.setProperty('--panel-shade', String((cfg.background.panelShade ?? 0.5) * 2));
  root.style.setProperty('--side-w', `${(cfg.layout.sideWidth * 100).toFixed(2)}%`);
  // the calendar glass over a full-screen photo (styles.css, .bg-screen); a thin one gives its text a soft shadow
  const sheetA = calendarSheetAlpha(cfg.background.calendarOpacity, { light, lite });
  root.style.setProperty('--sheet-a', String(sheetA));
  root.classList.toggle('sheet-thin', !light && sheetA < 0.5);
  const sheetBlur = Math.min(40, Math.max(0, Number(cfg.background.calendarBlur ?? 18) || 0));
  root.style.setProperty('--sheet-blur', String(sheetBlur));
  root.classList.toggle('sheet-noblur', sheetBlur === 0);

  if (cfg.screen.customCss) {
    if (!customStyle) {
      customStyle = document.createElement('style');
      customStyle.id = 'custom-css';
      document.head.appendChild(customStyle);
    }
    if (customStyle.textContent !== cfg.screen.customCss) customStyle.textContent = cfg.screen.customCss;
  } else if (customStyle) customStyle.textContent = '';

  applyLayout();

  // WebGL needs
  const preset = effectivePreset(cfg);
  // a photo behind the whole screen leaves no room for the animated backdrop
  const ambientHere = !photoOnWholeScreen(cfg.background, preset) && cfg.background.ambient !== 'none' && ['bigCalendar', 'agenda', 'topBottom', 'today', 'twoWeeks', 'people', 'planner', 'widget', 'canvas'].includes(preset);
  ambientWanted = ambientHere ? cfg.background.ambient : 'none';
  const wantAmbient = !lite && ambientHere;
  const wantGLPhoto = !lite && cfg.background.enabled && cfg.background.transition === 'webgl';
  if ((wantAmbient || wantGLPhoto) && !engine && !glFailed) {
    void initGL().then(() => {
      if (engine) applyGL(wantAmbient, accent, light);
      else {
        glFailed = true;
        syncAmbientCss();
      }
      photos.applyConfig();
      renderWeather(current());
    });
  }
  applyGL(wantAmbient, accent, light);
  photos.applyConfig();

  announcements.applyConfig(cfg);
  renderAll();
  // after the layout and the side content: a side widget goes to its corner when there is no side column
  custom.render(cfg, preset);
  revealApp(cfg);
}

/**
 * First paint: with the Modern style over a photo, wait for the photo (or 1.8 s at most) before fading the screen
 * in, so the glass cards appear already blurring the photo instead of a black background that changes a second later.
 */
let revealArmed = false;
function revealApp(cfg: DisplayConfig): void {
  if (!app.classList.contains('booting') || revealArmed) return;
  const waitPhoto = cfg.screen.style === 'modern' && cfg.background.enabled && !lite;
  if (!waitPhoto) return void app.classList.remove('booting');
  revealArmed = true;
  const show = () => app.classList.remove('booting');
  window.addEventListener('marco:photo-tone', show, { once: true });
  setTimeout(show, 1800);
}

let glFailed = false;
function applyGL(wantAmbient: boolean, accent: string, light: boolean): void {
  const cfg = ctx.cfg;
  const root = document.documentElement;
  if (engine) {
    const bg = light ? (cfg.screen.style === 'modern' ? '#f2f2f7' : '#f4f2ee') : '#000000';
    engine.setClearColor(bg);
    if (ambient) {
      ambient.mode = wantAmbient ? cfg.background.ambient : 'none';
      ambient.setColors(accent, hueShift(accent, 165), bg, light);
    }
    root.classList.toggle('gl-ambient', wantAmbient);
    const fx = cfg.background.weatherFx ?? 'simple';
    if (precip) precip.enabled = cfg.background.enabled && fx === 'simple';
    // the drops refract the GL photo, so only with the WebGL transition (a DOM photo would cover the canvas)
    if (wxfx) wxfx.enabled = cfg.background.enabled && fx === 'rich' && cfg.background.transition === 'webgl';
  }
  syncAmbientCss();
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------
function eventsNormalized(): NEvent[] {
  const ev = state.events;
  const key = `${ev?.hash}|${ev?.generatedAt}|${ctx.tz}`;
  if (key !== nEventsKey) {
    nEventsKey = key;
    nEvents = normalizeEvents(ev?.events ?? [], ctx.tz);
  }
  return nEvents;
}

function renderCalendar(tick: Tick): void {
  // not before the config (the first tick, the resize observer, cached events): the default number of weeks would
  // be drawn first and its extra rows would still be fading out while the screen fades in
  if (!state.config) return;
  const evs = eventsNormalized();
  const cfg = ctx.cfg;
  const preset = effectivePreset(cfg);
  renderView(tick);
  renderKids(tick);
  // Personalizado draws its own calendars (widgets/canvas.ts)
  if (preset === 'canvas') return;
  if (!cfg.calendar.enabled) return;
  // layouts with their own view (today, people, …) do not show the month grid / agenda
  if (VIEW_PRESETS.includes(preset)) {
    if (preset === 'today') highlights.render(evs, tick);
    return;
  }
  if (app.classList.contains('view-agenda')) agenda.render(evs, tick);
  else {
    calendar.roomy = preset === 'twoWeeks';
    calendar.render(evs, tick);
  }
  if (preset === 'leftRight' || preset === 'bigTime') sideAgenda.render(evs, tick);
  highlights.render(evs, tick);
  refreshMarquee();
}

/** Personalizado: lay its widgets out (nothing, and its cards removed, on any other layout). */
function renderCanvas(): void {
  const cfg = ctx.cfg;
  const on = effectivePreset(cfg) === 'canvas';
  syncLowPower();
  if (on) {
    probeGPU();
    canvasView.render(cfg, isPortrait(cfg));
  }
  else if (canvasView.active) canvasView.destroy();
  syncHaTouch();
  // an announcement card shows the announcement once it settles: no corner toast as well
  // (only when that card is laid out in this orientation)
  announcements.setDocked(on && canvasView.shows('announcement'));
}

/** Content of the layouts with their own view (no-op for the others). */
function renderView(tick: Tick): void {
  views.render({ events: ctx.cfg.calendar.enabled ? eventsNormalized() : [], weather: screenWeather(), countdowns: state.countdowns }, tick);
}

/**
 * Taps check routines off: the screen allows it, the server answers and the screen is not private. Never in the
 * admin's preview (a click there would tick a real routine).
 */
function kidsTouch(): boolean {
  return !!state.family?.touch && !!ctx.cfg.family?.touch && (state.online || state.demo) && !state.config?.privacy?.active && !isPreview;
}

// Taps on Microsoft To Do tasks (todoTaps.ts): sent for the screen on display, the config asked for again after each
// one (the server also tells every display), the side card and the Personalizado to-do cards drawn again.
initTodoTaps({
  allowed: () => state.online && !state.demo && !isPreview && !state.config?.privacy?.active,
  redraw: () => {
    renderTodo($('#todo'));
    canvasView.onData('config');
  },
  send: async (id, done) => {
    await api.todoToggle(id, done);
    void fetchConfig();
  },
});

/** Last time the family data was asked for again because it was from another day. */
let staleFamilyAsk = 0;

/**
 * The family data as the kids layouts and the Personalizado family cards show it, and whether taps check routines
 * off now. Data of another day (offline boot from the cache, a missed fetch at midnight): yesterday's ticks must not
 * show as today's. Nothing is done yet, taps wait for today's data, which is asked for (at most once a minute).
 */
function familyShown(tick: Tick): { state: FamilyDisplayState | null; touch: boolean } {
  let fam = ctx.cfg.family?.enabled ? state.family : null;
  const stale = !!fam && !state.demo && fam.today !== tick.dayKey;
  if (stale && fam) {
    fam = { ...fam, touch: false, chores: fam.chores.map((c) => ({ ...c, done: false })), members: fam.members.map((m) => ({ ...m, done: 0 })) };
    if (Date.now() - staleFamilyAsk > 60_000) {
      staleFamilyAsk = Date.now();
      void fetchFamily();
    }
  }
  return { state: fam, touch: kidsTouch() && !stale && !!fam?.touch };
}

/** The kids layouts (no-op for the others). */
function renderKids(tick: Tick): void {
  if (!kids.active) return;
  const { state: fam, touch } = familyShown(tick);
  kids.render({ family: fam, events: ctx.cfg.calendar.enabled ? eventsNormalized() : [], weather: screenWeather(), touch }, tick);
}

function renderCountdowns(tick: Tick): void {
  // birthdays already shown today as a highlight pill are not repeated as a "¡Hoy!" countdown chip
  const today = tick.dayKey;
  const shown = new Set(
    eventsNormalized()
      .filter((e) => e.allDay && e.ev.kind === 'birthdays' && e.startKey <= today && e.lastKey >= today)
      .map((e) => e.title),
  );
  countdowns.render(state.countdowns, today, shown);
  if (effectivePreset(ctx.cfg) === 'board') renderView(tick);
}

function renderWeather(tick: Tick): void {
  if (effectivePreset(ctx.cfg) !== 'canvas') weather.render(screenWeather(), tick.dayKey);
  const p = effectivePreset(ctx.cfg);
  if (p === 'photoFrame' || p === 'bedside') renderView(tick);
  renderKids(tick);
  const cur = ctx.cfg.weather.enabled ? screenWeather()?.current : undefined;
  const plan = cur ? weatherFxOf(cur.code, cur.isDay) : { mode: null, level: 0, storm: false };
  if (precip) {
    precip.mode = plan.mode === 'rain' || plan.mode === 'snow' ? plan.mode : null;
    precip.level = plan.level;
  }
  if (wxfx) wxfx.set(plan.mode, plan.level, plan.storm);
}

function renderAll(): void {
  const tick = current();
  clock.update(tick);
  renderCanvas();
  renderCalendar(tick);
  renderWeather(tick);
  // the side ticker of the other layouts stops on a Personalizado screen (its own news cards rotate)
  news.setData(effectivePreset(ctx.cfg) === 'canvas' ? null : state.news);
  renderMessage($('#message'));
  renderTodo($('#todo'));
  renderCountdowns(tick);
  schedules.render(tick);
  updateNight(tick);
  fitSide();
}

/**
 * Progressively drop secondary side-panel content until everything fits without clipping:
 * hourly strip → countdown chips one by one (keeps the nearest) → extra pills / done to-dos → whole mid area.
 */
const FIT_STEPS = ['fit-1', 'fit-2', 'fit-3'];
function fitSide(): void {
  fitSideContent();
  custom.relayout(); // side widgets take the room the rest leaves; the photo frame card may have moved
  fitMidRows();
  views.fit();
  kids.fit();
  photos.reframe(); // what's left uncovered of the photo may have changed
  refreshMarquee(); // titles are measured once everything that does not fit is gone
}
function fitSideContent(): void {
  const mid = sideEl.querySelector('.side-mid') as HTMLElement;
  const cdChips = Array.from(document.querySelectorAll<HTMLElement>('#countdowns > .cd'));
  // the planner strip centres its content: a few px into its padding is still fully visible, only more than that counts
  const slack = app.classList.contains('pbar') ? parseFloat(getComputedStyle(sideEl).paddingBottom) || 0 : 0;
  const overflowing = () => {
    const midHasContent = Array.from(mid.children).some((c) => (c as HTMLElement).style.display !== 'none' && (c as HTMLElement).offsetHeight > 0);
    // bigTime fades its mid column out with a mask: overflowing there is by design (agenda simply fades out)
    const midMasked = app.classList.contains('preset-bigTime');
    return sideEl.scrollHeight > sideEl.clientHeight + 2 + slack || (!midMasked && midHasContent && mid.scrollHeight > mid.clientHeight + 2);
  };
  app.classList.remove(...FIT_STEPS);
  for (const c of cdChips) c.classList.remove('fit-hide');
  fitStrip();
  fitPlannerBar();
  if (!overflowing()) return;
  // Today: the forecast for the next hours matters more than the countdowns
  if (app.classList.contains('preset-today')) {
    for (let i = cdChips.length - 1; i >= 0 && overflowing(); i--) cdChips[i].classList.add('fit-hide');
    if (!overflowing()) return;
  }
  app.classList.add('fit-1');
  for (let i = cdChips.length - 1; i >= 1 && overflowing(); i--) cdChips[i].classList.add('fit-hide');
  if (!overflowing()) return;
  for (const step of FIT_STEPS.slice(1)) {
    app.classList.add(step);
    if (!overflowing()) break;
  }
}

/**
 * Modern big time (landscape; portrait shows a chip strip): no fade-out mask, so the side agenda shows whole rows only. Drop rows from the end (and days
 * left empty), then countdowns, until the mid column fits. Classic keeps its masked fade and is not touched.
 */
function fitMidRows(): void {
  const mid = sideEl.querySelector('.side-mid') as HTMLElement;
  const rows = Array.from(document.querySelectorAll<HTMLElement>('#side-agenda .ag-ev, #side-agenda .ag-more, #side-agenda .ag-day'));
  for (const r of rows) r.classList.remove('fit-hide');
  const agendaEl = document.getElementById('side-agenda');
  agendaEl?.classList.remove('fit-hide');
  if (!document.documentElement.classList.contains('style-modern') || !app.classList.contains('preset-bigTime') || app.classList.contains('portrait') || !mid) return;
  const over = () => mid.scrollHeight > mid.clientHeight + 1;
  if (!over()) return;
  const days = Array.from(document.querySelectorAll<HTMLElement>('#side-agenda .ag-day')).reverse();
  for (const day of days) {
    const items = Array.from(day.querySelectorAll<HTMLElement>('.ag-ev, .ag-more')).reverse();
    for (const it of items) {
      it.classList.add('fit-hide');
      if (!over()) break;
    }
    // a day header with no rows left goes too
    if (!day.querySelector('.ag-ev:not(.fit-hide)')) day.classList.add('fit-hide');
    if (!over()) return;
  }
  agendaEl?.classList.add('fit-hide');
  if (!over()) return;
  // still too tall (message, to-do and banners take the room): countdowns from the furthest one
  const cds = Array.from(document.querySelectorAll<HTMLElement>('#countdowns > .cd:not(.fit-hide)')).reverse();
  for (const c of cds) {
    c.classList.add('fit-hide');
    if (!over()) return;
  }
}

/**
 * Planner strip (#app.pbar, a landscape screen with layout.plannerBar top / bottom): the weather is one row after the
 * clock. It keeps the current weather and as many whole hours and days as fit: the hours go first, then the days, each
 * from the furthest, and a group left with one column goes with its line.
 */
function fitPlannerBar(): void {
  const wx = document.getElementById('weather');
  if (!wx) return;
  const groups = Array.from(wx.querySelectorAll<HTMLElement>(':scope > .wx-hourly, :scope > .wx-days'));
  const hours = Array.from(wx.querySelectorAll<HTMLElement>(':scope > .wx-hourly > *'));
  const days = Array.from(wx.querySelectorAll<HTMLElement>(':scope > .wx-days > *'));
  for (const el of [...groups, ...hours, ...days]) el.classList.remove('fit-hide');
  if (!app.classList.contains('pbar') || !sideEl.offsetWidth) return;
  const over = () => sideEl.scrollWidth > sideEl.clientWidth + 1;
  for (const el of [...hours.reverse(), ...days.reverse()]) {
    if (!over()) return;
    el.classList.add('fit-hide');
    // a group down to one column says little next to the current weather: it goes with its line
    const g = el.parentElement;
    if (g && g.querySelectorAll(':scope > :not(.fit-hide)').length < 2) g.classList.add('fit-hide');
  }
}

/** One-line strip of scheduled banners + countdown chips (topBottom): drop what does not fit entirely. */
function fitStrip(): void {
  const strip = document.querySelector('.main-strip') as HTMLElement | null;
  if (!strip || !strip.offsetWidth) return;
  const chips = Array.from(strip.querySelectorAll<HTMLElement>('.sched, .cd'));
  for (const c of chips) c.classList.remove('fit-hide');
  const maxRight = strip.getBoundingClientRect().right + 1;
  let hide = false;
  for (const c of chips) {
    if (!hide && c.getBoundingClientRect().right > maxRight) hide = true;
    if (hide) c.classList.add('fit-hide');
  }
}

function hmToMin(s: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
  return m ? +m[1] * 60 + +m[2] : -1;
}

// Night command (§5.6): 'on'/'off' override the automatic state until it next changes by itself (or 'auto').
let nightOverride: NightCommand = 'auto';
let overrideBase: boolean | null = null;
let nightNow = false;
// a tap on a dimmed Personalizado screen with controls lifts the dimming for a minute (each tap while lifted starts the
// minute again); the first tap only wakes it (widgets/canvas/touch.ts)
const WAKE_MS = 60_000;
let wakeUntil = 0;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

function wakeFromTap(): void {
  // a tap on a screen that is not dimmed and was not woken: nothing to do
  if (!nightNow && Date.now() >= wakeUntil) return;
  wakeUntil = Date.now() + WAKE_MS;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    updateNight(current());
  }, WAKE_MS + 50);
  updateNight(current());
}

function autoNight(tick: Tick, nm = ctx.cfg.screen.nightMode): boolean {
  let on = false;
  if (nm.enabled) {
    const f = hmToMin(nm.from), t = hmToMin(nm.to);
    const n = tick.parts.hour * 60 + tick.parts.minute;
    if (f >= 0 && t >= 0 && f !== t) on = f < t ? n >= f && n < t : n >= f || n < t;
  }
  if (params.get('night') === '1') on = true;
  return on;
}

/** Night mode as it would be with the night settings of `cfg` (a carousel holds its off screen by these). */
function nightWith(cfg: DisplayConfig | null): boolean {
  if (!cfg?.screen?.nightMode) return false;
  if (nightOverride === 'on') return true;
  if (nightOverride === 'off') return false;
  return autoNight(current(), cfg.screen.nightMode);
}

function setNightCommand(mode: NightCommand): void {
  nightOverride = mode;
  overrideBase = mode === 'auto' ? null : autoNight(current());
  updateNight(current());
  carousel?.tick();
}

function updateNight(tick: Tick): void {
  const nm = ctx.cfg.screen.nightMode;
  const auto = autoNight(tick);
  if (nightOverride !== 'auto' && overrideBase !== null && auto !== overrideBase) {
    nightOverride = 'auto'; // the schedule moved on: hand control back to it
    overrideBase = null;
    heartbeat.soon();
  }
  const on = (nightOverride === 'on' ? true : nightOverride === 'off' ? false : auto) && Date.now() >= wakeUntil;
  nightNow = on;
  const dim = Number.isFinite(nm.dim) ? nm.dim : 0.35;
  night.style.opacity = on ? String(Math.min(0.95, Math.max(0, 1 - dim))) : '0';
  document.documentElement.classList.toggle('night', on);
  if (engine) engine.fps = on ? 15 : 30;
  if (wxfx) wxfx.night = on;
}

function setOnline(ok: boolean): void {
  const was = state.online;
  set('online', ok);
  // offline: routines are plain rows (a tap could not reach the server)
  if (was !== ok) {
    if (kids.active) renderKids(current());
    // the Personalizado family cards too (their taps follow the same rule), and the Home Assistant controls
    canvasView.onData('family');
    syncHaTouch();
    canvasView.onData('ha');
  }
  statusDot.classList.toggle('show', !ok && !state.demo);
}

// ---------------------------------------------------------------------------------------------
// Display access (private links / paired devices): 401 → pairing screen, 403 → "link no longer valid"
// ---------------------------------------------------------------------------------------------
let accessDenied = false;
let liveStream: { close(): void; tick?(): Promise<void> } | null = null;

/** Stop everything, forget cached data and show the pairing / invalid-link screen (no family data). */
function denyAccess(status: number): void {
  if (accessDenied || state.demo) return;
  accessDenied = true;
  // A dead private link (kiosk URL) but this browser was paired since: use the device token instead.
  // Marco Cloud continues at /pair, where "/" is not the display (pairing.ts afterPairUrl).
  if (status === 403 && credentialKind === 'key' && storedDeviceToken()) {
    void pairHealth().then((h) => location.replace(afterPairUrl(h)));
    return;
  }
  if (status === 403 && credentialKind === 'device') clearDeviceToken();
  // keep the language the screen was showing; the browser's language may differ
  const deniedLang = stopDisplay();
  showPairing(status === 403 ? 'invalid' : 'pair', deniedLang);
}

/** Stop timers, live channel, carousel and heartbeat and forget the data on screen. Returns the language to use next. */
function stopDisplay(): Lang {
  intervals.forEach(clearInterval);
  intervals.length = 0;
  liveStream?.close();
  carousel?.stop();
  heartbeat.stop();
  const lang = state.config ? ctx.lang : pairingLang(params);
  hideBootShell();
  for (const k of ['config', 'events', 'weather', 'news', 'photos', 'countdowns', 'family'] as const) state[k] = null;
  return lang;
}

/**
 * ?screen= names no screen or carousel (404 screen_not_found): a neutral "Screen not found" page, never the default
 * screen. Opened with no screen at all from another machine (the bare address, open mode): the same page, asking for
 * a screen's link. It checks again every minute and starts normally once the screen exists (widgets/screenMissing.ts).
 */
function screenMissing(): void {
  if (accessDenied || state.demo) return;
  accessDenied = true;
  showScreenMissing(stopDisplay(), async () => {
    try {
      // the carousel itself (or the screen in the URL), never one of its screens
      await api.config('');
      return true;
    } catch (e) {
      // access changed meanwhile: reload so the pairing / invalid-link screen takes over
      return e instanceof ApiError && (e.status === 401 || e.status === 403);
    }
  }, { bare: !screenKey && !credential });
}

/** True (and the access screen shown) when `e` is a 401 / 403, or a 404 screen_not_found, from the display API. */
function deniedBy(e: unknown): boolean {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
    denyAccess(e.status);
    return true;
  }
  // On a carousel a 404 is about one of its screens (deleted meanwhile), not about what this display opened: the
  // carousel goes on without it.
  if (isScreenNotFound(e) && !getActiveScreen()) {
    screenMissing();
    return true;
  }
  return false;
}

const isScreenNotFound = (e: unknown) => e instanceof ApiError && e.status === 404 && e.code === 'screen_not_found';

/**
 * True (and the "Screen not found" page shown) when `e` is a 404 screen_not_found for what the display opened: the
 * live channels and `api.config('')` always ask for that, so on a carousel this means the carousel itself is gone.
 */
function targetMissing(e: unknown): boolean {
  if (!isScreenNotFound(e)) return false;
  screenMissing();
  return true;
}

/**
 * The SSE stream failed while a carousel rotates. EventSource never tells the status, so a carousel deleted while
 * the display was offline (the `reload` event missed) would keep it retrying a 404 forever: ask for the carousel
 * itself, at most once a minute.
 */
let targetCheckedAt = 0;
async function checkTarget(): Promise<void> {
  if (accessDenied || state.demo || !getActiveScreen()) return;
  const now = Date.now();
  if (now - targetCheckedAt < 60_000) return;
  targetCheckedAt = now;
  try {
    await api.config('');
  } catch (e) {
    if (!deniedBy(e)) targetMissing(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------
function eventsRange(cfg: DisplayConfig = ctx.cfg): [string, string] {
  // the agenda view looks further ahead than the grid (calendar.agendaDays; 'auto' up to AGENDA_AUTO_MAX_DAYS), and
  // Personalizado as far as its calendars look ahead (canvasCore.js canvasEventsNeed, at most 6 weeks). The window is
  // worked out in server/core/bootstrap.js, so the page bootstrap asks for the same one.
  const view = params.get('view') || cfg.calendar.view;
  const preset = effectivePreset(cfg);
  return eventsWindow(current().dayKey, {
    weekStart: cfg.calendar.weekStart ?? 1, startOn: cfg.calendar.startOn, weeks: cfg.calendar.weeks ?? 5,
    agenda: preset === 'agenda' || view === 'agenda', agendaDays: cfg.calendar.agendaDays,
    canvas: preset === 'canvas' && cfg.canvas ? cfg.canvas : null,
  });
}

/** The range the last events request asked for (the admin preview asks again when a draft changes it). */
let fetchedRange = '';

async function fetchEvents(): Promise<void> {
  if (state.demo) {
    const m = mockEvents(current().now);
    if (state.events?.hash !== m.hash) set('events', m);
    return;
  }
  try {
    const [from, to] = eventsRange();
    fetchedRange = `${from}/${to}`;
    const sid = getActiveScreen();
    const r = await api.events(from, to);
    setOnline(true);
    if (r.errors?.length) console.warn('[events] source errors', r.errors);
    if (sid) carousel?.put(sid, 'events', r);
    if (sid !== getActiveScreen()) return; // the carousel moved on: the answer is kept for that screen
    if (!state.events || state.events.hash !== r.hash) {
      set('events', r);
      saveCache('events', r);
    }
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[events]', (e as Error).message);
    setOnline(false);
  }
}

/** The demo's weather (?demo=1): the screen's place and every other place it shows, made up (mock.ts). */
function demoWeather(cfg: DisplayConfig | null): WeatherResponse {
  const [own, ...others] = cfg?.weather ? weatherPlacesOf(cfg.weather, cfg.canvas?.items ?? null) : [];
  const w = own?.home === false ? mockPlaceWeather(current().now, own, own.key) : mockWeather(current().now, params.get('wx'));
  if (own) w.placeKey = own.key;
  if (others.length) w.places = Object.fromEntries(others.map((p) => [p.key, mockPlaceWeather(current().now, p, p.key)]));
  return w;
}

async function fetchWeather(): Promise<void> {
  if (state.demo) return set('weather', demoWeather(state.config));
  try {
    const sig = weatherSig(state.config);
    const r = await api.weather();
    weatherByLang.set(sig, { w: r, at: Date.now() });
    if (sig !== weatherSig(state.config)) return;
    set('weather', r);
    saveCache('weather', r);
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[weather]', (e as Error).message);
  }
}

async function fetchNews(): Promise<void> {
  if (state.demo) return set('news', mockNews());
  try {
    const r = await api.news();
    set('news', r);
    saveCache('news', r);
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[news]', (e as Error).message);
  }
}

/** When the last photo list came (0 = none yet). */
let photosAt = 0;
let ruleDay = '';
let ruleRev: number | null = null;

/**
 * A screen with special backgrounds (#14, `background.special`): the rule that holds may change with the events, the
 * config or the day. A server that pushes a live `photos` event says so itself; Marco Cloud does not, so the display
 * asks for its photos again then (at most every 10 s, and never before its first list), and fetchPhotos changes the
 * photo at once when the rule changed.
 */
function checkBgRule(): void {
  if (state.demo || !ctx.cfg?.background?.special || !photosAt || Date.now() - photosAt < 10_000) return;
  void fetchPhotos();
}

async function fetchPhotos(): Promise<void> {
  if (state.demo) return set('photos', mockPhotos(ctx.cfg.background.stockTopic));
  try {
    const sid = getActiveScreen();
    const r = await api.photos(20, photos.lastKey);
    photosAt = Date.now();
    if (sid) carousel?.put(sid, 'photos', r);
    if (sid !== getActiveScreen()) return;
    // another special background took over (or ended): the new photos show at once, not at the next change
    const ruleChanged = !!state.photos && (state.photos.rule ?? '') !== (r.rule ?? '');
    if (photoSig) photoSig = photoSigOf(ctx.cfg.background, r.rule);
    set('photos', r);
    if (ruleChanged) void photos.next();
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[photos]', (e as Error).message);
    if (!state.photos) set('photos', mockPhotos());
  }
}

async function fetchCountdowns(): Promise<void> {
  if (state.demo) return set('countdowns', mockCountdowns(current().now));
  try {
    const sid = getActiveScreen();
    const r = await api.countdowns();
    if (sid) carousel?.put(sid, 'countdowns', r);
    if (sid !== getActiveScreen()) return;
    if (!state.countdowns || state.countdowns.hash !== r.hash || state.countdowns.today !== r.today) {
      set('countdowns', r);
      saveCache('countdowns', r);
    }
  } catch (e) {
    if (deniedBy(e)) return;
    // older server without /api/countdowns (404) or offline: keep what we have
    console.warn('[countdowns]', (e as Error).message);
  }
}

// ---------------------------------------------------------------------------------------------
// Familia (kids layouts): today's routines, stars and the meals of the week of the screen on display. Asked for only
// when a kids layout is on and Familia is on; a carousel keeps the last answer of each screen for when it is back.
// ---------------------------------------------------------------------------------------------
const familyOf = new Map<string, FamilyDisplayState>();
let familyScreen = '';
let familySig = '';
/** Requests are numbered when they leave; an answer to a request older than the one shown last is dropped. */
let familySeq = 0;
let familyTaken = 0;
/** Taps still on their way (routine → done, and which tap): laid over every answer, so a tick never jumps back. */
const familyPending = new Map<string, { done: boolean; n: number }>();
let familyTaps = 0;

/** A kids layout, or a Personalizado screen with a family card (canvasCore: kinds with `family`), and Familia on. */
const wantsFamily = () => {
  if (!state.config || !ctx.cfg.family?.enabled) return false;
  const p = effectivePreset(ctx.cfg);
  return isKidsPreset(p) || (p === 'canvas' && canvasCards(ctx.cfg.canvas?.items).some((it) => !it.disabled && CANVAS_KINDS[it.kind]?.family));
};

/** The answer to request `seq` for screen `sid`: kept unless a newer request was answered first, with the taps on top. */
function takeFamily(sid: string, seq: number, r: FamilyDisplayState): void {
  if (sid !== familyScreen || seq < familyTaken) return;
  familyTaken = seq;
  familyOf.set(sid, r);
  saveScreenCache(sid, 'family', r);
  let shown = r;
  for (const [id, p] of familyPending) shown = withToggle(shown, id, p.done);
  set('family', shown);
}

async function fetchFamily(): Promise<void> {
  if (!wantsFamily()) return;
  if (state.demo) return set('family', mockFamily(current().now, ctx.cfg));
  const sid = familyScreen;
  const seq = ++familySeq;
  try {
    takeFamily(sid, seq, await api.family());
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.code === 'family_off') return set('family', null);
    if (deniedBy(e)) return;
    console.warn('[family]', (e as Error).message);
  }
}

/**
 * A new config: another carousel screen shows its own family data at once (the last one seen), and the family data is
 * asked for again when what decides it changed (screen, saved settings, layout, privacy).
 */
function syncFamily(c: DisplayConfig): void {
  const id = c.screenId || '';
  if (id !== familyScreen) {
    // the first config keeps what came from this browser's cache (offline boot)
    if (familyScreen) state.family = familyOf.get(id) ?? null;
    familyScreen = id;
    familyTaken = 0;
    familyPending.clear();
  }
  const sig = `${id}|${c.revision}|${effectivePreset(ctx.cfg)}|${wantsFamily() ? 1 : 0}|${c.privacy?.active ? 1 : 0}|${JSON.stringify(c.family ?? null)}`;
  if (sig === familySig) return;
  familySig = sig;
  void fetchFamily();
}

/** A tap on a routine: shown at once, sent to the server, put back if it says no. */
function toggleChore(choreId: string, done: boolean): void {
  const fam = state.family;
  if (!fam || !kidsTouch()) return;
  kids.pop(choreId);
  set('family', withToggle(fam, choreId, done));
  if (state.demo) return;
  const sid = familyScreen;
  const seq = ++familySeq;
  const n = ++familyTaps;
  familyPending.set(choreId, { done, n });
  // this tap is settled (a later tap on the same routine keeps its own)
  const settle = () => {
    if (familyPending.get(choreId)?.n === n) familyPending.delete(choreId);
  };
  api.familyToggle(choreId, done).then(
    (r) => {
      settle();
      takeFamily(sid, seq, r.state);
    },
    (e: unknown) => {
      settle();
      // 403 touch_off: taps were turned off (or the screen went private) meanwhile; other 401 / 403: access is gone
      if (e instanceof ApiError && (e.status === 401 || e.status === 403) && e.code !== 'touch_off' && deniedBy(e)) return;
      console.warn('[family] toggle', (e as Error).message);
      const base = familyOf.get(sid);
      if (sid === familyScreen && state.family && !familyPending.has(choreId)) {
        set('family', withToggle(state.family, choreId, base?.chores.find((c) => c.id === choreId)?.done ?? !done));
      }
      void fetchFamily();
    },
  );
}

async function fetchConfig(): Promise<boolean> {
  try {
    const sid = getActiveScreen();
    let c: DisplayConfig;
    try {
      c = await api.config();
    } catch (e) {
      // a carousel screen deleted meanwhile: ask for the carousel itself (the screen it shows now)
      if (!sid || !isScreenNotFound(e)) throw e;
      try {
        c = await api.config('');
      } catch (e2) {
        if (targetMissing(e2)) return false; // the carousel itself is gone
        throw e2;
      }
    }
    setOnline(true);
    if (sid && c.target?.kind === 'carousel' && c.screenId === sid) carousel?.put(sid, 'config', c);
    if (sid && sid !== getActiveScreen()) return true; // kept for that screen; the one on display is not touched
    saveCache('config', c);
    set('config', c);
    return true;
  } catch (e) {
    if (deniedBy(e)) return false;
    console.warn('[config]', (e as Error).message);
    setOnline(false);
    return false;
  }
}

let photoSig = '';
let privateSig = '';
/**
 * What decides the photo list of a screen (a carousel keeps the list when the next screen has the same): its photo
 * settings and the special background that holds on it (`rule`, the signature /api/photos answers with).
 */
const photoSigOf = (b: { enabled: boolean; source: string; stockTopic: string; order?: string; immich?: { albumIds?: string[]; favoritesOnly?: boolean } }, rule = '') =>
  `${b.enabled}|${b.source}|${b.stockTopic}|${b.order ?? 'random'}|${(b.immich?.albumIds ?? []).join(',')}|${b.immich?.favoritesOnly ? 1 : 0}|${rule}`;
on('config', (s) => {
  if (!s.config) return;
  // before the cards are drawn, so a new Home Assistant card asks for its states with this screen's config
  haFeed.config(s.config);
  valuesFeed.config(s.config);
  dataFeed.config(s.config);
  applyConfig(s.config);
  const priv = s.config.privacy;
  const privSig = priv?.active ? 'on' : 'off';
  const privChanged = privateSig !== '' && privSig !== privateSig;
  privateSig = privSig;
  applyPrivacy(priv);
  armCanvasSchedule(s.config.canvas?.next);
  // photo source changed in the admin → fetch a fresh list right away; privacy mode with "hide photos" also
  // replaces the photo on screen at once
  const sig = photoSigOf(ctx.cfg.background, state.photos?.rule);
  // a saved change (another revision) may change which special background holds
  if (photoSig && sig === photoSig && ruleRev !== null && s.config.revision !== ruleRev) checkBgRule();
  ruleRev = s.config.revision;
  if (photoSig && sig !== photoSig) void fetchPhotos().then(() => (privChanged ? photos.next() : undefined));
  photoSig = sig;
  syncCarousel(s.config);
  syncNav(s.config);
  syncFamily(s.config);
  // an unsaved draft in the admin preview may show other days (weeks, weekStart, startOn): fetch the events they need
  if (isPreview && fetchedRange && eventsRange().join('/') !== fetchedRange) void fetchEvents();
  // other places to show (the screen's place or a card's changed): their weather at once (the demo makes it up); not
  // in the preview, where unsaved places come from the admin (weatherPlaces.ts)
  const wsig = weatherSig(s.config);
  if (wsig !== weatherShownSig && (state.demo || (weatherShownSig && !isPreview && !weatherByLang.has(wsig)))) void fetchWeather();
  weatherShownSig = wsig;
});
/** weatherSig of the config the weather was last asked for. */
let weatherShownSig = '';

// ---------------------------------------------------------------------------------------------
// Carousel (web/display/carousel.ts): a display bound to a carousel shows its screens one after another. A display
// bound to a plain screen never creates one, so nothing here runs for it.
// ---------------------------------------------------------------------------------------------
let carousel: CarouselController | null = null;
/** Booted from this browser's cache (server unreachable): what the carousel starts with is old, not fresh. */
let offlineBoot = false;
/** ?step=<slug> shows one step only, ?carousel=0 stays on the first step (testing, the admin preview). */
const stepParam = (params.get('step') || '').trim().toLowerCase() || null;
const carouselFrozen = params.get('carousel') === '0';
/**
 * Weather per language and places (weatherPlaces.ts weatherSig): screens of a carousel may speak different languages
 * and show other places.
 */
const weatherByLang = new Map<string, { w: WeatherResponse; at: number }>();

function syncCarousel(c: DisplayConfig): void {
  const block = c.carousel;
  if (!block || c.target?.kind !== 'carousel' || !c.screenId) {
    // the carousel was deleted or this display was moved: start again with what it is bound to now
    if (carousel && !state.demo) location.reload();
    return;
  }
  if (carousel) {
    // the server answered with another screen (the one on display left the carousel): that one is on display now
    if (c.screenId !== carousel.current) {
      carousel.adopt(c.screenId);
      setActiveScreen(c.screenId);
    }
    carousel.revisionSeen(c.revision);
    carousel.update(block, c.datetime.timezone);
    return;
  }
  carousel = new CarouselController(block, c.datetime.timezone, c.screenId, {
    now: () => serverNow(),
    night: (cfg) => nightWith(cfg),
    // a ring, or an announcement shown big (a corner one stays on every screen anyway)
    alertOn: () => doorbell.active || announcements.expandedCount > 0,
    fetch: fetchBundle,
    show: showScreen,
    // the next screen starts other photos: load its first one now, so the switch shows it at once
    upcoming: (_id, b) => {
      const s = photoStart(b);
      if (s && b.config) void photos.prepare(s.list, s.idx, b.config.background);
    },
    refreshed: (id, b, parts) => {
      if (id !== getActiveScreen()) return;
      if (parts.includes('config') && b.config && b.config !== state.config) set('config', b.config);
      if (parts.includes('events') && b.events && b.events !== state.events) set('events', b.events);
      if (parts.includes('countdowns') && b.countdowns && b.countdowns !== state.countdowns) set('countdowns', b.countdowns);
      saveShown(b);
    },
    pin: stepParam,
    frozen: carouselFrozen,
    save: state.demo ? undefined : (id, part, v) => saveScreenCache(id, part, v),
  });
  carousel.onChange = () => canvasView.onData('nav');
  setActiveScreen(c.screenId);
  document.documentElement.classList.add('has-carousel');
  // offline: what came from the cache is marked old (at = 0), so it is fetched again as soon as the server answers
  const at = offlineBoot ? 0 : undefined;
  carousel.put(c.screenId, 'config', c, at);
  if (state.events) carousel.put(c.screenId, 'events', state.events, at);
  if (state.countdowns) carousel.put(c.screenId, 'countdowns', state.countdowns, at);
  if (state.photos) carousel.put(c.screenId, 'photos', state.photos, at);
  // offline boot: what this browser kept of the other screens (they are refreshed before they show)
  if (!state.demo) {
    for (const st of [...block.steps, { screenId: block.offScreenId }]) {
      if (!st.screenId || st.screenId === c.screenId || carousel.bundles.has(st.screenId)) continue;
      const cfg = loadScreenCache<DisplayConfig>(st.screenId, 'config');
      if (!cfg) continue;
      carousel.put(st.screenId, 'config', cfg, 0);
      const ev = loadScreenCache<EventsResponse>(st.screenId, 'events');
      if (ev) carousel.put(st.screenId, 'events', ev, 0);
      const cd = loadScreenCache<CountdownsResponse>(st.screenId, 'countdowns');
      if (cd) carousel.put(st.screenId, 'countdowns', cd, 0);
    }
  }
  carousel.start();
  // the demo of the navigation cards (&carousel=1&nav=1) starts on its first step, the screen with the cards
  if (state.demo && params.get('nav') === '1') carousel.jumpTo(0);
  // ?try=1 (the admin's "Probar" in the preview): a switch every few seconds, so the animation can be seen
  if (params.get('try') === '1' && !tryTimer) {
    tryTimer = setInterval(() => {
      if (!app.classList.contains('booting')) carousel?.tryNext();
    }, TRY_EVERY_MS);
  }
}
const TRY_EVERY_MS = 4000;
let tryTimer: ReturnType<typeof setInterval> | null = null;

/** Fetch parts of one carousel screen's data (a prefetch, or a screen shown without data yet). */
async function fetchBundle(id: string, parts: BundlePart[], known: DisplayConfig | null): Promise<Partial<Pick<Bundle, BundlePart>>> {
  if (state.demo) {
    // a demo with no carousel (&preset=canvas&shot=nav) goes to the carousel's screens as plain screens
    const found = mockCarouselConfigs().find((x) => x.screenId === id) ?? mockNavScreens().find((x) => x.screenId === id) ?? null;
    const plain = mockConfig();
    const cfg = carousel || !found ? found : id === plain.screenId ? plain : { ...found, target: undefined, carousel: null };
    const t = current().now;
    return { config: cfg, events: mockEvents(t), countdowns: mockCountdowns(t), photos: mockPhotos(cfg?.background.stockTopic) };
  }
  const out: Partial<Pick<Bundle, BundlePart>> = {};
  const one = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      if (deniedBy(e)) throw e;
      return null;
    }
  };
  const cfg = parts.includes('config') ? await one(() => api.config(id)) : known;
  // the server answers with another screen when this one left the carousel: keep nothing
  if (!cfg || cfg.screenId !== id) return {};
  if (parts.includes('config')) out.config = cfg;
  const [from, to] = eventsRange(cfg);
  const [events, countdowns, ph] = await Promise.all([
    parts.includes('events') ? one(() => api.events(from, to, id)) : null,
    parts.includes('countdowns') ? one(() => api.countdowns(id)) : null,
    parts.includes('photos') ? one(() => api.photos(20, '', id)) : null,
  ]);
  if (events) out.events = events;
  if (countdowns) out.countdowns = countdowns;
  if (ph) out.photos = ph;
  const sig = weatherSig(cfg);
  if (sig !== weatherSig(state.config) && !(Date.now() - (weatherByLang.get(sig)?.at ?? 0) < 10 * 60_000)) {
    const w = await one(() => api.weather(id));
    if (w) weatherByLang.set(sig, { w, at: Date.now() });
  }
  return out;
}

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * The plain caches (config, events, countdowns) always hold the screen on display, all three from the same one:
 * an offline boot reads them together. Each screen also keeps its own copy (saveScreenCache).
 */
function saveShown(b: Bundle): void {
  if (state.demo || !b.config) return;
  saveCache('config', b.config);
  if (b.events) saveCache('events', b.events);
  if (b.countdowns) saveCache('countdowns', b.countdowns);
}

/** The GL side of a carousel switch (null without WebGL). */
const switchGL = (): SwitchGL | null => {
  const e = engine;
  if (!e) return null;
  return {
    canvas: e.canvas,
    snapshot: () => e.snapshot(),
    dissolve: (from, ms) => {
      if (!dissolve || engine !== e) return false;
      dissolve.run(from, ms);
      return true;
    },
    stopDissolve: () => dissolve?.stop(),
    holdRects: (on) => e.holdRects(on),
  };
};
const switcher = new ScreenSwitcher(app, switchGL);
// the new screen sits still now: measure its titles again (they were off screen or moving during the switch)
switcher.onDone = refreshMarquee;
/**
 * ?lite=1, ?lowpower=1 or very little memory: every carousel switch is a short fade of #app. A Raspberry Pi gets the
 * real animation (it copes), so this does not ask the board or the GPU.
 */
const switchLight = lite || params.get('lowpower') === '1'
  || isLowPower((navigator as { deviceMemory?: number }).deviceMemory, navigator.hardwareConcurrency);
/** The Personalizado low-power look (no blur, no flip): the above, or a Raspberry Pi and the like. */
let lowPower = switchLight || isArmLinuxUA(navigator.userAgent);
/** Recent Chromium says "Linux x86_64" on ARM too: ask the client hints and the GPU name. */
function detectLowPower(): void {
  if (lowPower) return;
  const uad = (navigator as { userAgentData?: { mobile?: boolean; platform?: string; getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
  void uad?.getHighEntropyValues?.(['architecture']).then(
    (v) => {
      if (isArmDesktop(v.architecture, uad.platform, uad.mobile)) setLowPower();
    },
    () => undefined,
  );
}
detectLowPower();
/** The GL renderer name, read once the engine runs (no extra context just for this). */
let gpuChecked = false;
function checkGPU(): void {
  if (lowPower || gpuChecked || !engine) return;
  gpuChecked = true;
  try {
    const gl = engine.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    if (isLowPowerGPU(String(name ?? ''))) setLowPower();
  } catch { /* no name: keep what we know */ }
}

/** Detection found a slow device after the screen was drawn: the Personalizado look follows at once. */
function setLowPower(): void {
  if (lowPower) return;
  lowPower = true;
  syncLowPower();
}

/**
 * Personalizado's low-power look: lite, a slow device, or canvas.perf 'low' on this screen (no blur, no flip, no
 * seconds hand). ?blur=1 lifts it (not lite).
 */
function canvasLow(): boolean {
  if (lite) return true;
  if (params.get('blur') === '1') return false;
  return lowPower || ctx.cfg?.canvas?.perf === 'low';
}

/** .low-power on <html> while a Personalizado screen is on and canvasLow(); applied again whenever either changes. */
function syncLowPower(): void {
  const on = !!ctx.cfg && effectivePreset(ctx.cfg) === 'canvas' && !!ctx.cfg.canvas && canvasLow();
  const root = document.documentElement;
  if (root.classList.contains('low-power') === on) return;
  root.classList.toggle('low-power', on);
  canvasView.lowChanged();
}

/**
 * A Personalizado screen with a plain or animated background starts no GL engine, so the GPU name would never be
 * read (and over plain http:// on a Pi or a Fire TV the client hints are missing too): ask a throwaway 1×1 WebGL
 * context once, then let it go.
 */
function probeGPU(): void {
  if (lowPower || gpuChecked || lite) return;
  if (engine) return checkGPU();
  gpuChecked = true;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const gl = (c.getContext('webgl') ?? c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (isLowPowerGPU(String(name ?? ''))) setLowPower();
  } catch { /* no WebGL: keep what we know */ }
}

/** Carousel screens with other photos: where each slideshow was when its screen left (by photo settings). */
const photoSpots = new Map<string, { photos: PhotosResponse; at: SlideshowPosition }>();

/** Longest wait for the next screen's first photo before a switch goes on without it (ms). */
const PHOTO_WAIT_MS = 1500;

/**
 * The photo a carousel screen starts with when it comes on, when it has other photo settings than the screen on
 * display: the one after where its slideshow was left, or the first of its list. Null when the slideshow just goes
 * on (same settings), or at the end of a batch (the slideshow fetches the next one first).
 */
function photoStart(b: Bundle): { list: Photo[]; idx: number } | null {
  const bg = b.config?.background;
  if (!bg?.enabled || !photoSig) return null;
  const sig = photoSigOf(bg, b.photos?.rule);
  if (sig === photoSig) return null;
  const spot = photoSpots.get(sig);
  const list = spot ? spot.at.list : b.photos?.photos ?? [];
  const idx = spot ? spot.at.idx + 1 : 0;
  return idx >= 0 && idx < list.length ? { list, idx } : null;
}

/**
 * Put one carousel screen on display from its bundle: no request, animated as the carousel says (switchPlan.ts).
 * When the new screen has other photos, its first photo is loaded before the switch (a few seconds ahead through
 * the carousel's `upcoming`, or here for PHOTO_WAIT_MS at most) and goes in with the screen, so the switch is the
 * only animation; when it is not ready in time the slideshow changes the photo after the switch as before.
 */
function showScreen(id: string, b: Bundle, sw: SwitchInfo): void {
  // from now on, answers for the screen that leaves are kept for it and never shown
  setActiveScreen(id);
  const booting = app.classList.contains('booting');
  const start = booting ? null : photoStart(b);
  let plan: SwitchPlan | null = null;
  const apply = () => {
    if (!b.config || accessDenied || getActiveScreen() !== id) return;
    state.events = b.events;
    state.countdowns = b.countdowns;
    // the photo list only changes when the photo settings differ (same source: the slideshow just goes on)
    const sig = photoSigOf(b.config.background, b.photos?.rule);
    const newPhotos = !!photoSig && sig !== photoSig;
    // the slideshow of the screen that leaves is kept where it is, so it goes on from there when that screen is back
    if (newPhotos && state.photos) photoSpots.set(photoSig, { photos: state.photos, at: photos.position() });
    photoSig = sig;
    const wsig = weatherSig(b.config);
    if (wsig !== weatherSig(state.config)) {
      const w = weatherByLang.get(wsig);
      state.weather = w ? w.w : state.demo ? demoWeather(b.config) : state.weather;
    }
    // the new screen goes in with its own number of weeks at once (no rows of the old one fading out)
    calendar.still = true;
    try {
      set('config', b.config);
    } finally {
      calendar.still = false;
    }
    saveShown(b);
    const spot = newPhotos ? photoSpots.get(sig) : undefined;
    // the light switch (lite mode, reduced motion) is a short fade of #app only: the photo keeps the slideshow's own crossfade
    const takeover = () => !!start && photos.takeover(start.list, start.idx, !!plan?.light);
    // a photo of the screen that left, still loading, is not shown on this one
    if (newPhotos) photos.restart();
    if (spot) {
      set('photos', spot.photos);
      if (!takeover()) photos.resume(spot.at);
    } else if (newPhotos) {
      if (b.photos) {
        set('photos', b.photos as PhotosResponse);
        if (!takeover()) void photos.next();
      } else void fetchPhotos();
    }
    if (!weatherByLang.has(weatherSig(b.config))) void fetchWeather();
  };
  if (booting) {
    switcher.finish();
    return apply();
  }
  const go = () => {
    if (getActiveScreen() !== id) return; // another switch came meanwhile
    // ?tr=<name> forces one animation and ?trSpeed= its speed (filming, the admin's "Probar")
    plan = planSwitch(sw, { reduced: reducedMotion(), lowPower: switchLight, gl: !!dissolve && !!engine, force: params.get('tr'), forceSpeed: params.get('trSpeed') });
    switcher.switch(plan, apply);
  };
  if (!start || !b.config) return go();
  const ready = photos.prepare(start.list, start.idx, b.config.background);
  void Promise.race([ready, new Promise((r) => setTimeout(r, PHOTO_WAIT_MS))]).then(go);
}

// ---------------------------------------------------------------------------------------------
// Navigation on touch screens (web/display/nav.ts, the "Navegación" cards of widgets/canvas/nav.ts): "Ir a pantalla",
// "Pausar carrusel", the progress card and the swipe. Taps need the screen's canvas.taps (touch on, not private, a
// display the server trusts) and never act in the admin's preview. All of it stays on this device: a carousel jump is
// an offset of this display's own rotation, a screen outside it is fetched like a carousel bundle (the server lets a
// display read the screens its own buttons lead to), and the visit or the pause is kept in localStorage only.
// ---------------------------------------------------------------------------------------------
/** What this display is bound to: its carousel's id or its screen's id (set by the first config). */
let navHomeId = '';
/** The screen a display with no carousel is bound to ('' on a carousel). */
let navHomeScreen = '';
let navIdle: NavIdle | null = null;
const NAV_LS = `marco.nav.${screenNs}`;
/** A switch made by touch: a short fade, whatever the carousel uses. */
const NAV_SWITCH: SwitchInfo = { transition: 'fade', speed: 'fast', n: 0, seed: 'nav' };
/** Bundles of screens shown by touch on a display with no carousel (a carousel keeps its own). */
const navBundles = new Map<string, { b: Bundle; at: number }>();
let navHomeRetry: ReturnType<typeof setTimeout> | null = null;

/** Taps of the navigation cards and the swipe do something now. */
function navLive(): boolean {
  return !isPreview && !!ctx.cfg?.canvas?.taps && !accessDenied;
}

function syncNav(c: DisplayConfig): void {
  // the swipe: only with touch on, on a carousel, never in the preview (styles: touch-action for the gesture)
  document.documentElement.classList.toggle('nav-swipe', !isPreview && !!carousel && !!c.canvas?.swipe && !!c.canvas?.taps);
  // (a config with no `target` comes from a server older than carousels: the screen itself)
  const kind = c.target?.kind ?? 'screen';
  if (navIdle || isPreview || !(c.target?.id || c.screenId)) return;
  navHomeId = c.target?.id || c.screenId || '';
  navHomeScreen = kind === 'screen' ? c.screenId || '' : '';
  navIdle = new NavIdle(navHomeId, {
    now: () => Date.now(),
    load: () => {
      if (state.demo) return null;
      try {
        return JSON.parse(localStorage.getItem(NAV_LS) || 'null');
      } catch {
        return null;
      }
    },
    save: (m: NavMemo | null) => {
      if (state.demo) return;
      try {
        if (m) localStorage.setItem(NAV_LS, JSON.stringify(m));
        else localStorage.removeItem(NAV_LS);
      } catch { /* storage off: the visit ends with the page */ }
    },
    // "Volver solo tras X min sin tocar": the display's own screen or carousel again
    expire: () => void navGoHome(),
  });
  const m = navIdle.restore();
  if (m?.mode === 'visit') void navVisit(m.screenId, m.returnMin, true);
  else if (m?.mode === 'pause' && carousel) carousel.pause(true);
  else if (m) navIdle.clear();
}

/** A short line at the bottom of the screen (a tap that could not go anywhere). Text as text. */
let navToastTimer: ReturnType<typeof setTimeout> | null = null;
function navToast(text: string): void {
  let el = document.getElementById('nav-toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'nav-toast' });
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  if (navToastTimer) clearTimeout(navToastTimer);
  navToastTimer = setTimeout(() => el!.classList.remove('show'), 2600);
}

/** The bundle of a screen for a display with no carousel (fresh for a minute), or null when it cannot be read. */
async function navBundle(id: string): Promise<Bundle | null> {
  const hit = navBundles.get(id);
  if (hit && Date.now() - hit.at < 60_000 && hit.b.config) return hit.b;
  try {
    const got = await fetchBundle(id, ['config', 'events', 'countdowns', 'photos'], null);
    if (!got.config || !got.events) return null;
    const b = { ...emptyBundle(), ...got, configAt: Date.now(), eventsAt: Date.now(), countdownsAt: Date.now(), photosAt: Date.now() };
    navBundles.set(id, { b, at: Date.now() });
    return b;
  } catch {
    return null;
  }
}

/** True when this tap only wakes a dimmed screen (night mode), as the Home Assistant controls do. */
function navWakes(): boolean {
  const dimmed = nightNow && Date.now() >= wakeUntil;
  wakeFromTap();
  return dimmed;
}

/** "Ir a pantalla" with `target` (a screen id or 'home'). */
async function navGo(target: string, returnMin: number): Promise<void> {
  if (!navLive() || !navIdle || navWakes()) return;
  const w = carousel?.where();
  const plan = planNav(target, {
    homeScreen: navHomeScreen,
    steps: carousel ? carousel.carousel.steps.map((st) => st.screenId) : null,
    rotating: !!carousel?.rotates(),
    current: getActiveScreen() || state.config?.screenId || '',
    index: w?.index ?? -1,
  });
  if (plan.do === 'home') return navGoHome();
  if (plan.do === 'jump') {
    navIdle.clear();
    carousel!.jumpTo(plan.index);
    return;
  }
  if (plan.do === 'visit') return navVisit(plan.screenId, returnMin);
}

/** Show a screen that is not this display's own (or not in its carousel) and stay there, until the idle rule. */
async function navVisit(id: string, returnMin: number, restoring = false): Promise<void> {
  if (!navIdle) return;
  if (carousel) {
    const b = await carousel.ensure(id);
    if (!b?.config || !b.events) {
      if (restoring) navIdle.clear();
      else navToast(ctx.t('navUnavailable'));
      return;
    }
    navIdle.start('visit', id, returnMin);
    carousel.visitScreen(id);
    return;
  }
  const b = await navBundle(id);
  if (!b) {
    if (restoring) navIdle.clear();
    else navToast(ctx.t('navUnavailable'));
    return;
  }
  navIdle.start('visit', id, returnMin);
  showScreen(id, b, NAV_SWITCH);
  canvasView.onData('nav');
}

/** Back to this display's own screen or carousel (Inicio, or the idle time passed). */
async function navGoHome(): Promise<void> {
  navIdle?.clear();
  if (navHomeRetry) clearTimeout(navHomeRetry);
  navHomeRetry = null;
  if (carousel) return carousel.home();
  const on = getActiveScreen();
  if (!navHomeScreen || !on || on === navHomeScreen) return;
  navBundles.delete(navHomeScreen);
  const b = await navBundle(navHomeScreen);
  // offline: try again in a while (the screen shown by touch stays meanwhile)
  if (!b) {
    navHomeRetry = setTimeout(() => void navGoHome(), 30_000);
    return;
  }
  showScreen(navHomeScreen, b, NAV_SWITCH);
  canvasView.onData('nav');
}

/** "Pausar carrusel": pause the rotation on this display, or go on. */
function navPause(returnMin: number): void {
  if (!navLive() || !navIdle || !carousel || navWakes()) return;
  // on a screen shown by touch, the button takes the display back into its carousel, paused
  if (carousel.visit) carousel.home();
  const on = !carousel.paused;
  carousel.pause(on);
  if (on) navIdle.start('pause', '', returnMin);
  else navIdle.clear();
}

/** The carousel's steps and where it is now (the progress card), or null on a display with no carousel. */
function navProgress(): NavProgress | null {
  if (!carousel) return null;
  const w = carousel.where();
  return {
    steps: carousel.carousel.steps.map((st) => ({ name: st.name })),
    index: w.index,
    startsAt: w.startsAt,
    endsAt: w.endsAt,
    paused: w.paused,
    visiting: !!w.visiting,
    now: serverNow(),
  };
}

// every touch pushes the "Volver solo tras" time forward
document.addEventListener('pointerdown', () => navIdle?.touched(), { capture: true, passive: true });
// the swipe: a quick sideways stroke of a finger (or a pen) that did not start on a control
let swipeFrom: { x: number; y: number; t: number; id: number } | null = null;
const SWIPE_SKIP = '[data-ctl], [data-slide], .cv-nav-btn, .k-chore, .kf-chore, input, select, textarea, button';
document.addEventListener('pointerdown', (e) => {
  swipeFrom = null;
  if (e.pointerType === 'mouse' || !document.documentElement.classList.contains('nav-swipe')) return;
  if ((e.target as Element | null)?.closest?.(SWIPE_SKIP)) return;
  swipeFrom = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
}, { capture: true, passive: true });
document.addEventListener('pointercancel', () => (swipeFrom = null), { capture: true, passive: true });
document.addEventListener('pointerup', (e) => {
  const f = swipeFrom;
  swipeFrom = null;
  if (!f || f.id !== e.pointerId || !carousel || !navLive() || !ctx.cfg?.canvas?.swipe) return;
  const dir = swipeDir(e.clientX - f.x, e.clientY - f.y, Date.now() - f.t, window.innerWidth);
  if (!dir || navWakes()) return;
  navIdle?.clear();
  // to the left: the next screen; to the right: the one before
  carousel.stepBy(dir === -1 ? 1 : -1);
}, { capture: true, passive: true });

// ---------------------------------------------------------------------------------------------
// Privacy mode: the server already filtered the events; the display shows a small lock and asks again when the
// period ends (or a schedule rule starts) in case the live event is missed (offline, poll delay).
// ---------------------------------------------------------------------------------------------
const privacyLock = $('#privacy-lock');
let privacyTimer: ReturnType<typeof setTimeout> | null = null;
function applyPrivacy(p: DisplayConfig['privacy']): void {
  const on = !!p?.active;
  document.documentElement.classList.toggle('is-private', on);
  privacyLock.classList.toggle('show', on && p?.lock !== false);
  privacyLock.title = on ? ctx.t('privateMode') : '';
  if (privacyTimer) clearTimeout(privacyTimer);
  privacyTimer = null;
  if (state.demo) return;
  const at = [p?.next, on ? p?.until : null].map((x) => (x ? Date.parse(x) : NaN)).filter((x) => Number.isFinite(x));
  if (!at.length) return;
  // a few seconds after the boundary, at most a day ahead (setTimeout limits, clock changes)
  const ms = Math.min(Math.max(Math.min(...at) - Date.now() + 3000, 3000), 24 * 3600_000);
  privacyTimer = setTimeout(() => refreshForPrivacy(), ms);
}
// Personalizado: a card with a schedule ("Horario") appears or goes when its window starts or ends. The server sends
// only the cards shown now and when that changes next; the display asks for its config again a few seconds after.
let canvasTimer: ReturnType<typeof setTimeout> | null = null;
function armCanvasSchedule(next: string | undefined): void {
  if (canvasTimer) clearTimeout(canvasTimer);
  canvasTimer = null;
  const at = next ? Date.parse(next) : NaN;
  if (state.demo || isPreview || !Number.isFinite(at)) return;
  const ms = Math.min(Math.max(at - Date.now() + 3000, 3000), 24 * 3600_000);
  canvasTimer = setTimeout(() => void fetchConfig(), ms);
}
function refreshForPrivacy(): void {
  void fetchConfig().then((ok) => (ok ? Promise.all([fetchEvents(), fetchCountdowns(), fetchFamily()]) : undefined));
}
on('events', () => {
  canvasView.onData('events');
  checkBgRule();
  renderCalendar(current());
  renderCountdowns(current());
  fitSide();
});
on('weather', () => {
  canvasView.onData('weather');
  renderWeather(current());
  fitSide();
});
on('news', (s) => {
  canvasView.onData('news');
  news.setData(effectivePreset(ctx.cfg) === 'canvas' ? null : s.news);
});
on('countdowns', () => {
  canvasView.onData('countdowns');
  renderCountdowns(current());
  fitSide();
});
on('photos', (s) => {
  canvasView.onData('photos');
  if (s.photos) photos.setList(s.photos.photos || []);
});
on('family', () => {
  canvasView.onData('family');
  renderKids(current());
});
photos.onExhausted = () => fetchPhotos();
// a carousel switch and a new photo at the same moment look like a glitch: the slideshow steps around switches
photos.switchAt = () => {
  const at = carousel?.nextSwitchAt() ?? null;
  return at === null ? null : at - serverNow() + Date.now();
};

// ---------------------------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------------------------
const intervals: ReturnType<typeof setInterval>[] = [];
function startPolling(): void {
  intervals.forEach(clearInterval);
  intervals.length = 0;
  intervals.push(setInterval(fetchEvents, 60_000));
  intervals.push(setInterval(fetchWeather, 10 * 60_000));
  intervals.push(setInterval(fetchNews, 15 * 60_000));
  intervals.push(setInterval(fetchPhotos, 60 * 60_000));
  intervals.push(setInterval(fetchCountdowns, 30 * 60_000));
  intervals.push(setInterval(fetchFamily, 5 * 60_000));
}

onTick((tick) => {
  clock.update(tick);
  views.tick(tick);
  canvasView.tick(tick);
  if (tick.minuteChanged) {
    // a new day may bring another special background: a few seconds after midnight, so the server sees the new day too
    if (ruleDay && ruleDay !== tick.dayKey) setTimeout(checkBgRule, 5_000 + Math.random() * 20_000);
    ruleDay = tick.dayKey;
    renderCalendar(tick);
    renderWeather(tick);
    renderCountdowns(tick);
    schedules.render(tick);
    updateNight(tick);
    fitSide();
    carousel?.tick(); // night mode may have started or ended
  }
  if (tick.dayChanged) {
    void fetchFamily();
    void fetchEvents();
    void fetchWeather();
    void fetchCountdowns();
    renderAll();
  }
});

// Chip line-wrapping measures text on a canvas: re-plan once the bundled fonts are really available.
try {
  void document.fonts?.ready.then(() => {
    if (state.config) {
      renderCalendar(current());
      fitSide();
      // Personalizado cards fit their content to the real text sizes too
      canvasView.relayout();
    }
  });
} catch { /* old browser */ }

// Re-layout the grid when the calendar's available height changes (news appearing, fonts loading, …)
let lastWeeksH = 0;
let roT: ReturnType<typeof setTimeout> | null = null;
try {
  const weeksEl = document.querySelector('#calendar .cal-weeks');
  if (weeksEl && 'ResizeObserver' in window) {
    new ResizeObserver((entries) => {
      const h = Math.round(entries[0].contentRect.height);
      if (Math.abs(h - lastWeeksH) < 2) return;
      lastWeeksH = h;
      if (roT) clearTimeout(roT);
      roT = setTimeout(() => renderCalendar(current()), 60);
    }).observe(weeksEl);
  }
} catch { /* ignore */ }

// The agenda's automatic days fill the room it has: lay it out again when its size changes (news appearing, …).
// Rendering never changes the agenda's own size, so this cannot loop.
let lastAgendaSize = '';
let agT: ReturnType<typeof setTimeout> | null = null;
try {
  const agendaEl = document.getElementById('agenda');
  if (agendaEl && 'ResizeObserver' in window) {
    new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      const size = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (size === lastAgendaSize) return;
      lastAgendaSize = size;
      if (!r.width || !r.height || !state.config || !app.classList.contains('view-agenda')) return;
      if (agT) clearTimeout(agT);
      agT = setTimeout(() => {
        renderCalendar(current());
        fitSide();
      }, 80);
    }).observe(agendaEl);
  }
} catch { /* ignore */ }

let resizeT: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
  if (resizeT) clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    // the week-row caps depend on the shape of the screen: when it turns (or a landscape window gets small or big), start again from the saved config
    if (state.config && frameKey() !== lastFrameKey) {
      applyConfig(state.config);
      photos.reframe();
      return;
    }
    applyLayout();
    renderAll();
    photos.reframe();
  }, 150);
});

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------
function enterDemo(): void {
  state.demo = true;
  haFeed.demo = true;
  valuesFeed.demo = () => demoValues(state.config);
  dataFeed.demo = (cfg) => demoData(cfg);
  statusDot.classList.remove('show');
  // &carousel=1: the demo screens in a loop (web/display/mock.ts mockCarouselConfigs)
  set('config', params.get('carousel') === '1' ? mockCarouselConfigs()[0] : mockConfig());
  void fetchEvents();
  void fetchWeather();
  void fetchNews();
  void fetchPhotos();
  void fetchCountdowns();
  void fetchFamily();
  // ?demo=1&announce=1|info|success|warning|urgent|all → sample announcements; &identify=1 → identify overlay
  const an = params.get('announce');
  if (an) setTimeout(() => mockAnnouncements(an).forEach((a: Announcement) => announcements.show(a)), 900);
  if (params.get('identify') === '1') {
    setTimeout(() => identify.show({ durationSec: 600 }, { name: ctx.cfg.screen.name, slug: ctx.cfg.slug || 'living-room', clientId }), 900);
  }
  // &doorbell=1 → doorbell ring with a drawn camera picture; &doorbell=nocam → a ring without a picture
  const db = params.get('doorbell');
  if (db) setTimeout(() => doorbell.show(mockDoorbellRing(db)), 900);
}

/**
 * Without a page bootstrap, the answers that do not depend on the config are asked for together with it (api.ts
 * prefetchJSON): goLive takes them when it asks for the same paths. Nothing is drawn before the config came.
 */
function prefetchFirstData(): void {
  prefetchJSON(paths.weather());
  prefetchJSON(paths.news());
  prefetchJSON(paths.countdowns());
  prefetchJSON(paths.photos(20, photos.lastKey));
}

async function boot(): Promise<void> {
  // The page bootstrap (boot.ts): the server wrote the config and the first answers of this screen into the page.
  const booted = !forceDemo && loadBoot();
  startTicker();
  void healthOnce().then((h) => loadEmojiWebFont(h));
  // ?demo=1&pair=1|invalid (&pairLen=6|8) → preview of the pairing / invalid-link screen with a sample code
  const demoPair = forceDemo ? params.get('pair') : null;
  if (demoPair) {
    heartbeat.stop();
    showPairing(demoPair === 'invalid' ? 'invalid' : 'pair', pairingLang(params), { length: Number(params.get('pairLen')) || 6 });
    return;
  }
  if (forceDemo) {
    enterDemo();
    startPolling();
    return;
  }
  const pairing = location.pathname === '/pair' && !credential;
  // A display with a credential is on its way to its screen: the clock and the date meanwhile (bootShell.ts), in the
  // settings of the config it has (bootstrap) or of the last visit. Nothing of the family's is drawn from storage.
  if ((booted || credential) && !isWidgetOnly) armBootShell(peekBoot<DisplayConfig>('/api/display/config') ?? loadCache<DisplayConfig>('config'));
  // The setup check, the config and (with a credential) the first data go out together. A bootstrapped page needs
  // no setup check: the server only writes one for a screen of a set up server.
  if (!booted && credential) prefetchFirstData();
  const setupAsked = booted ? Promise.resolve(null) : checkSetup();
  const firstAsked = pairing ? null : api.configQuick().then((c) => ({ c }), (e: unknown) => ({ e }));
  // Fresh install: welcome screen with the admin URL + QR until the setup wizard is completed.
  const setup = await setupAsked;
  if (setup) {
    const pl = params.get('lang');
    heartbeat.stop();
    hideBootShell();
    showWelcome(setup, LANGS.includes(pl as Lang) ? (pl as Lang) : setup.suggestedLanguage);
    waitForSetup();
    return;
  }
  // /pair always shows the pairing screen for a browser without a key (also in open mode).
  if (!firstAsked) {
    heartbeat.stop();
    showPairing('pair', pairingLang(params));
    return;
  }
  // Ask the server first (short timeout): a revoked link or a private install without a key must never flash
  // cached family data. Offline → last known data (offline tolerance), then go live.
  let first: DisplayConfig | null = null;
  const answer = await firstAsked;
  if ('e' in answer) {
    if (deniedBy(answer.e)) return;
  } else first = answer.c;
  if (first) {
    setOnline(true);
    saveCache('config', first);
    set('config', first);
    void goLive();
    return;
  }
  const cached = loadCache<DisplayConfig>('config');
  if (cached) {
    offlineBoot = true;
    // on a carousel, take the copy kept for that screen, so its events never come from another step
    const own = cached.target?.kind === 'carousel' && cached.screenId ? cached.screenId : '';
    set('events', own ? loadScreenCache<EventsResponse>(own, 'events') : loadCache<EventsResponse>('events'));
    set('weather', loadCache<WeatherResponse>('weather'));
    set('news', loadCache<NewsResponse>('news'));
    set('countdowns', own ? loadScreenCache<CountdownsResponse>(own, 'countdowns') : loadCache<CountdownsResponse>('countdowns'));
    set('family', cached.screenId ? loadScreenCache<FamilyDisplayState>(cached.screenId, 'family') : null);
    set('config', cached);
  }
  const ok = await fetchConfig();
  if (accessDenied) return;
  if (!ok && !cached) {
    if (import.meta.env.DEV) {
      console.info('[display] /api unreachable, running with the built-in demo dataset');
      enterDemo();
      startPolling();
      // keep probing the real API; switch over without a reload when it appears
      const probe = setInterval(async () => {
        try {
          const c = await api.config();
          clearInterval(probe);
          state.demo = false;
          set('config', c);
          state.events = null;
          void goLive();
        } catch { /* still down */ }
      }, 30_000);
      return;
    }
    // Production without any data yet: defaults + keep retrying.
    set('config', normalizeConfig({}) as DisplayConfig);
    const retry = setInterval(async () => {
      if (accessDenied) return clearInterval(retry);
      if (await fetchConfig()) {
        clearInterval(retry);
        void goLive();
      }
    }, 10_000);
  }
  void goLive();
}

let streamStarted = false;
async function goLive(): Promise<void> {
  if (accessDenied) return;
  startPolling();
  void fetchEvents();
  void fetchWeather();
  void fetchNews();
  void fetchPhotos();
  void fetchCountdowns();
  void fetchFamily();
  if (streamStarted) return;
  streamStarted = true;
  // A server without SSE (live: 'poll' in /api/health) gets the poll channel instead of the stream.
  const mode = await detectLiveMode({
    health: () => api.health(),
    answered: (e) => e instanceof ApiError && e.status > 0,
    cancelled: () => accessDenied,
  });
  if (!mode || accessDenied) return;
  if (mode === 'poll') {
    haFeed.setPollMode(true);
    valuesFeed.setPollMode(true);
    // The poll answer carries the server time and revision, so the heartbeat only reports what the screen runs.
    heartbeat.start(10 * 60_000);
    liveStream = startPoll({
      poll: (cursor, rev, hidden) => api.poll(pollUrl(cursor, rev, hidden)),
      revision: () => state.config?.revision,
      // what the display is bound to: the carousel itself while it rotates through its screens
      screenId: () => state.config?.target?.id ?? state.config?.screenId,
      handlers: {
        ...liveHandlers,
        first: onHello,
        screenChanged: () => location.reload(),
        now: (iso) => setServerNow(iso),
        sync: (ids) => announcements.sync(ids),
      },
      // the poll always asks for what the display opened (withTarget): a 404 screen_not_found there is never one
      // screen of a carousel, so it is the "Screen not found" page and not the 90 s fallback below
      denied: (e) => deniedBy(e) || targetMissing(e),
      status: (e) => (e instanceof ApiError ? e.status : 0),
      hidden: () => document.hidden,
      // A server that says 'poll' but has no /api/display/poll: check the config revision every 90 s.
      fallback: () => {
        liveStream = startConfigPoll({
          revision: () => state.config?.revision,
          fetchConfig,
          changed: () => {
            void fetchEvents();
            void fetchCountdowns();
          },
        });
      },
    });
    heartbeat.soon();
    return;
  }
  heartbeat.start();
  liveStream = connectStream({
    ...liveHandlers,
    hello: onHello,
    down: () => {
      setOnline(false);
      void checkTarget();
    },
  });
}

/** SSE `hello`, and the first answer (or a reset) of the poll channel. */
function onHello(d: Partial<StreamHello>): void {
  setOnline(true);
  setServerNow(d.now);
  if (Array.isArray(d.activeAnnouncementIds)) announcements.sync(d.activeAnnouncementIds);
  doorbell.sync(d.doorbellId);
  if (typeof d.revision === 'number' && d.revision !== state.config?.revision) void fetchConfig();
  void fetchEvents();
  void fetchCountdowns();
  void fetchFamily();
  haFeed.refresh();
  valuesFeed.refresh();
  dataFeed.refresh();
  heartbeat.soon();
  if (d.serverVersion) void maybeReloadForVersion(d.serverVersion);
}

/** What each live event does, whichever transport brought it (live.ts dispatch). */
const liveHandlers: StreamHandlers = {
  // Config can change the event range (weeks/weekStart), colours, icons and countdowns → refetch them too.
  config: (d) => {
    if (typeof d?.revision === 'number') carousel?.revisionSeen(d.revision);
    void fetchConfig().then((ok) => (ok ? Promise.all([fetchEvents(), fetchCountdowns()]) : undefined));
  },
  // gallery changed in the admin (upload, replace, delete, focal point, shown / hidden) → fresh list;
  // a photo taken out of the rotation while on screen is replaced right away
  photos: (d) =>
    void (carousel?.invalidate(null, ['photos']), fetchPhotos()).then(() => {
      if (photos.currentFile && d.hidden?.includes(photos.currentFile)) void photos.next();
    }),
  events: (d) => {
    carousel?.invalidate(null, ['events', 'countdowns']);
    if (!state.events || d.hash !== state.events.hash) void fetchEvents();
    void fetchCountdowns();
  },
  // a routine ticked (here, on a phone or in the admin), stars, a new family link
  family: () => void fetchFamily(),
  // the tasks of the Microsoft To Do lists changed (they come in the config's to-do items)
  todo: () => {
    carousel?.invalidate(null, ['config']);
    void fetchConfig();
  },
  // Home Assistant states of a Personalizado screen (aliases only)
  ha: (d) => haFeed.apply(d),
  // pushed values of a Personalizado screen (only the keys it shows)
  values: (d) => valuesFeed.apply(d),
  reload: () => location.reload(),
  announce: (a) => announcements.show(a),
  announceClear: (d) => announcements.clear(d.id),
  identify: (d) => {
    const car = carousel?.carousel;
    // on a carousel: "Kitchen loop · now: Photos"
    const shown = car ? { ...d, name: ctx.t('carouselShowing', { name: d.name || car.name, screen: ctx.cfg.screen.name }), slug: car.slug } : d;
    identify.show(shown, { name: ctx.cfg.screen.name, slug: state.config?.slug || screenKey, clientId });
    heartbeat.soon();
  },
  night: (d) => {
    setNightCommand(d.mode);
    heartbeat.soon();
  },
  // privacy mode turned on or off: new config (lock, photo source), filtered events and countdowns
  // (a carousel only refetches now when it is the screen on display; the others before they show)
  privacy: (d) => {
    if (carousel && d.screenId && d.screenId !== getActiveScreen()) return carousel.invalidate(d.screenId);
    refreshForPrivacy();
  },
  // Doorbell: full screen above the night layer while it lasts (it wakes a dimmed screen, see widgets/doorbell.ts).
  doorbell: (d) => {
    doorbellScreen = typeof d.screenId === 'string' ? d.screenId : '';
    doorbell.show(d);
  },
  doorbellEnd: (d) => doorbell.end(d.id),
  // Link regenerated / device revoked → "no longer valid"; switched to private without a key → pairing.
  revoked: (d) => denyAccess(d.code === 'key_required' ? 401 : 403),
  open: () => setOnline(true),
  down: () => setOnline(false),
};

// Back on screen after being hidden: poll right away instead of waiting for the hidden-page delay.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void liveStream?.tick?.();
  // Personalizado: its clocks and slideshows rest while the page is hidden
  if (document.hidden) canvasView.pause();
  else canvasView.resume();
});

/**
 * The server runs a newer build than this page (hello.serverVersion ≠ __APP_VERSION__): reload once, but never
 * more than once per 10 min (sessionStorage guard) and only when /api/health answers.
 */
async function maybeReloadForVersion(serverVersion: string): Promise<void> {
  if (!serverVersion || serverVersion === __APP_VERSION__ || import.meta.env.DEV) return;
  const KEY = 'cs.versionReloadAt';
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10 * 60_000) return;
    const h = await api.health();
    if (!h?.ok) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return;
  }
  console.info(`[display] server ${serverVersion} ≠ page ${__APP_VERSION__} → reloading`);
  location.reload();
}

const heartbeat = new Heartbeat(
  {
    screenId: () => state.config?.screenId || '',
    webgl: () => !!engine,
    lite: () => lite,
    night: () => nightNow,
    nightOverride: () => nightOverride,
    demo: () => state.demo,
    photoFrame: () => photos.frame,
  },
  (now) => setServerNow(now),
);
// The admin preview shows unsaved settings: the admin posts this screen's config as it would be once saved, and it is
// laid over what the server sends until the admin takes it back (null) or reloads the preview after a save. Only the
// page that frames this preview (frame-ancestors keeps that to the admin) is listened to. What only the server knows
// (privacy right now, the carousel) stays as the server says.
if (isPreview) {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.data?.type !== 'marco:preview-draft') return;
    // the Widgets page previews one widget: where it is on screen goes back to the admin, which zooms in on it
    previewFocus(typeof e.data.focus === 'string' ? e.data.focus : null);
    const draft = e.data.config as DisplayConfig | null;
    if (!draft || typeof draft !== 'object') return setConfigOverlay(null);
    // the tasks of the Microsoft To Do lists only come from the server: they stay after the draft's typed items
    const tasks = (c: DisplayConfig) => (c.todo?.items ?? []).filter((i) => isListTask(i.id));
    setConfigOverlay((c) =>
      c.screenId !== draft.screenId
        ? c
        : {
            ...draft, revision: c.revision, privacy: c.privacy, target: c.target, carousel: c.carousel,
            todo: { ...draft.todo, items: [...(draft.todo?.items ?? []).filter((i) => !isListTask(i.id)), ...tasks(c)], touch: false },
          },
    );
  });
}

/**
 * Admin preview of one widget (Widgets page): its box on this page, sent to the admin whenever it changes
 * ({ type: 'marco:preview-focus', rect: { x, y, w, h } | null }; null while it shows nothing). Checked a few times a
 * second: images load, cards grow and the layout settles on their own time.
 */
let focusId: string | null = null;
let focusTimer: ReturnType<typeof setInterval> | null = null;
let focusSent = '';
function previewFocus(id: string | null): void {
  if (id === focusId) return;
  focusId = id;
  focusSent = '';
  if (focusTimer) clearInterval(focusTimer);
  focusTimer = null;
  if (!id) return;
  const report = () => {
    const el = [...document.querySelectorAll<HTMLElement>('[data-widget]')].find((x) => x.dataset.widget === focusId);
    const r = el && !el.classList.contains('uw-wait') ? el.getBoundingClientRect() : null;
    const rect = r && r.width > 4 && r.height > 4 ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
    // a price card: the view it draws there (a list or a chart falls back to the price now in too little room)
    const card = el?.querySelector<HTMLElement>('.pw');
    const mode = card?.dataset.mode ?? null;
    const cramped = !!card?.classList.contains('pw-cramped');
    // the room it has there: the whole side column, or the box of its corner (its size and the corner's margin)
    let room: typeof rect = null;
    const parent = el?.parentElement;
    if (rect && parent) {
      if (parent.id === 'uw-side') {
        const c = (parent.closest('.side') ?? parent).getBoundingClientRect();
        room = { x: Math.round(c.left), y: Math.round(c.top), w: Math.round(c.width), h: Math.round(c.height) };
      } else if (parent.classList.contains('uw-c')) {
        const [rw, rh] = (el!.dataset.room ?? '').split('x').map(Number);
        if (rw > 0 && rh > 0) {
          const p = parent.getBoundingClientRect();
          const pad = parseFloat(getComputedStyle(parent).paddingLeft) || 0;
          const right = parent.classList.contains('tr') || parent.classList.contains('br');
          const bottom = parent.classList.contains('bl') || parent.classList.contains('br');
          const w = Math.min(rw, innerWidth - 2 * pad);
          const h = Math.min(rh, innerHeight - 2 * pad);
          room = { x: Math.round(right ? p.right - pad - w : p.left + pad), y: Math.round(bottom ? p.bottom - pad - h : p.top + pad), w: Math.round(w), h: Math.round(h) };
        }
      }
    }
    const key = JSON.stringify([rect, mode, cramped, room]);
    if (key === focusSent) return;
    focusSent = key;
    // only a box on this page and a view name go out: nothing in them is private
    window.parent.postMessage({ type: 'marco:preview-focus', id: focusId, rect, mode, cramped, room, screen: { w: innerWidth, h: innerHeight } }, '*');
  };
  report();
  focusTimer = setInterval(report, 250);
}

// The admin's screen builder (Personalizado, web/admin/builder/) frames this page with builder=1 and draws its own
// cells, handles and badges over it: where the grids and the cards are, and which cards do not fit, go back to it
// ({ type: 'marco:canvas-rects', ... }) whenever they change. Only boxes and item ids: nothing private.
if (isPreview && params.get('builder') === '1') {
  document.documentElement.classList.add('cv-builder');
  let sent = '';
  setInterval(() => {
    const info = canvasView.layoutInfo();
    const msg = { type: 'marco:canvas-rects', screen: { w: innerWidth, h: innerHeight }, ...(info ?? { portrait: false, main: null, side: null, row: false, items: [] }) };
    const key = JSON.stringify(msg);
    if (key === sent) return;
    sent = key;
    window.parent.postMessage(msg, '*');
  }, 250);
  // while a card is dragged or sized in the editor, the animated backdrop (the photo's slow zoom, the aurora) holds
  // still: each frame it draws makes every glass card above it blur again, which the drag would wait for
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.data?.type !== 'marco:builder-busy') return;
    if (e.data.on === true) engine?.stop();
    else engine?.start();
  });
  // the editor is changing one card of a Rotativa: that card shows and stays until it is done (null: it turns again)
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.data?.type !== 'marco:rotator-pin') return;
    rotatorPins.clear();
    const { item, card } = e.data;
    if (typeof item === 'string' && typeof card === 'string') rotatorPins.set(item, card);
  });
}

// The admin's focal-point editor previews the photo with this display's real free band.
// On a carousel the frame changes with every layout: report it at most every 5 minutes there.
let frameSentAt = 0;
photos.onFrameChange = () => {
  if (carousel && Date.now() - frameSentAt < 5 * 60_000) return;
  frameSentAt = Date.now();
  heartbeat.soon(3000);
};

// Nightly soft reload (~04:00 local, page older than 12 h) to reclaim leaked renderer/browser memory on
// long-running kiosks. Only when the server answers, so an offline display never reloads into a blank page.
const bootAt = Date.now();
setInterval(async () => {
  if (state.demo || Date.now() - bootAt < 12 * 3600_000) return;
  const t = current();
  if (t.parts.hour !== 4 || t.parts.minute > 10) return;
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (r.ok) location.reload();
  } catch { /* offline: try again later */ }
}, 5 * 60_000);

// Never let an unexpected error blank the screen.
window.addEventListener('error', (e) => {
  console.error('[display] error', e.error || e.message);
  noteError(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[display] rejection', e.reason);
  noteError(e.reason);
});

void boot();
