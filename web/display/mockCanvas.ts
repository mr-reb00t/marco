// Demo layouts of the Personalizado screen (?demo=1&preset=canvas). &shot=<fixture> picks one (the screenshots and
// the welcome flow use them): starter (default), todos, kinds, sidebar, portrait, flex, dense, home, ha, controls, features, tiles, smallest, binary, words, lights, data, confirm, cameras, clocks, calendars, media, html, family, nowplaying,
// household, look, values, ink, places, motion, motion-group, motion-nest, groups, empty. Each goes through the same validation and projection as a saved screen (server/core/canvasCore.js),
// so the demo shows what a server sends. Positions are in cells of the grid (24×16, 16×24).
import type { CanvasConfig, CanvasItem, DisplayCanvas, DisplayConfig, DisplayValue } from '../shared/types';
import { CANVAS_KINDS, gridDims, boxAllowed, kindFor, canvasDefaults, defaultCanvas, defaultItemStyle, itemAliases, lookSize, projectCanvas, sanitizeCanvas, sizeCells, canvasCards } from '../../server/core/canvasCore.js';
import { cardSnippets } from '../shared/cardSnippets';
import { SHOWCASES } from './showcase';
import { DEMO_NOW_PLAYING_ACCOUNT } from './nowPlayingFeed';

/**
 * The demo screen as it was saved, before the projection takes the entity ids out: the entity of each alias and the
 * canvas with its conditions, so the demo can work out what a server would (mockHa.ts demoHaStates, demoHaHidden).
 */
export const DEMO_SAVED: { entities: Map<string, string>; canvas: CanvasConfig | null } = { entities: new Map(), canvas: null };

/** The saved widget the demo's widget items show (mock.ts adds its definition). */
export const DEMO_WIDGET = 'w_demo_prices';

type Raw = { kind: CanvasItem['kind']; pos: CanvasItem['pos']; portrait?: CanvasItem['pos']; props?: Record<string, unknown>; style?: Partial<CanvasItem['style']> };
const M = (x: number, y: number, size: string) => ({ zone: 'main' as const, x, y, size: size as never });
/** A box of its own: w×h cells (the named size is worked out by the validation). */
const B = (x: number, y: number, w: number, h: number) => ({ zone: 'main' as const, x, y, size: 'm' as never, w, h });
const S = (order: number, span: 2 | 3 | 4 | 'fill') => ({ zone: 'side' as const, order, span });

// Showcase screens for the website and the video (made up, in English with &lang=en): web/display/showcase/, one file
// per screen and their registry (index.ts) with the states and data each one needs. &shot=show.<key> (the clock stands
// still at &now=):
//   show.home  show.family  show.data  show.everyday  show.bento  show.cinematic  show.light  show.portrait (1080x1920)
// Only these screens give the demo player its cover art and the family demo in English (mockHa.ts, mock.ts).
const SHOWCASE: typeof CANVAS_FIXTURES = Object.fromEntries(Object.entries(SHOWCASES).map(([k, v]) => [k, v.fixture]));

export const CANVAS_FIXTURES: Record<string, { canvas: Partial<CanvasConfig>; items: Raw[]; orientation?: 'portrait' | 'landscape' }> = {
  // the navigation cards (&carousel=1&nav=1 puts this screen first in the demo carousel): buttons to the carousel's
  // screens, one to a screen outside it, Inicio, the pause and the progress card, touch and swipe on
  nav: {
    canvas: { background: 'ambient', touch: true, swipe: true },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 'm') },
      { kind: 'nav.progress', pos: M(8, 0, 'w'), props: { style: 'dots' } },
      { kind: 'nav.pause', pos: M(20, 0, 'xs') },
      { kind: 'nav.button', pos: M(8, 4, 's'), props: { target: 's_photos', icon: 'i:photo' } },
      { kind: 'nav.button', pos: M(14, 4, 's'), props: { target: 's_agenda', icon: 'i:calendar' } },
      { kind: 'nav.button', pos: M(20, 4, 'xs'), props: { target: 'home', show: 'icon' } },
      { kind: 'calendar.agenda', pos: M(0, 6, 't'), props: { days: 4 } },
      { kind: 'nav.button', pos: M(6, 8, 'w'), props: { target: 's_kitchen', icon: '🍳' } },
      { kind: 'nav.button', pos: M(18, 8, 'row'), props: { target: 's_today', show: 'text' } },
      { kind: 'nav.button', pos: M(18, 10, 'row'), props: { target: 's_photos', icon: '🖼️' } },
      { kind: 'nav.progress', pos: M(6, 12, 'w'), props: { style: 'bar' } },
      { kind: 'nav.button', pos: B(18, 12, 6, 4), props: { target: 's_agenda', label: 'Agenda', icon: '📅', show: 'both' } },
    ],
  },
  // four to-do cards, each with its own lists, title, icon and filter (core todoCore.js; mock.ts adds the demo To Do
  // lists): one list with its name as the title, the typed tasks and a second list under a title of its own, the
  // tasks due today or before, the starred ones
  todos: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'clock.digital', pos: B(0, 0, 8, 4) },
      { kind: 'todo', pos: B(0, 4, 8, 12), props: { listIds: ['tl_demo_shop'], icon: '🛒', maxRows: 8 } },
      { kind: 'todo', pos: B(8, 0, 8, 16), props: { listIds: ['local', 'tl_demo_home'], title: 'Home', icon: '🧹', maxRows: 10 } },
      { kind: 'todo', pos: B(16, 0, 8, 8), props: { filter: 'due', icon: '📌' } },
      { kind: 'todo', pos: B(16, 8, 8, 8), props: { filter: 'important', showDone: false } },
    ],
  },
  starter: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 'm') },
      { kind: 'calendar.month', pos: M(8, 0, 'xl') },
      { kind: 'weather.now', pos: M(0, 6, 'm') },
      { kind: 'weather.forecast', pos: M(0, 12, 'w') },
      { kind: 'countdowns', pos: M(12, 12, 'w') },
    ],
  },
  kinds: {
    canvas: { background: 'photo', dim: 0.2 },
    items: [
      { kind: 'clock.analog', pos: M(0, 0, 'm'), props: { face: 'numbers' } },
      { kind: 'clock.flip', pos: M(8, 0, 'm'), props: { showDate: true } },
      { kind: 'clock.world', pos: M(16, 0, 'm'), props: { zones: [{ tz: 'America/New_York', label: 'New York' }, { tz: 'Asia/Tokyo', label: 'Tokyo' }, { tz: 'Pacific/Auckland', label: 'Auckland' }] } },
      { kind: 'calendar.agenda', pos: M(0, 6, 't'), props: { days: 5 } },
      { kind: 'calendar.today', pos: M(6, 6, 't') },
      { kind: 'photo', pos: M(12, 6, 'm'), props: { caption: true } },
      { kind: 'date', pos: M(20, 6, 'xs'), props: { isoWeek: true } },
      { kind: 'weather.hourly', pos: M(12, 12, 'w') },
    ],
  },
  sidebar: {
    canvas: { background: 'ambient', sidebar: { side: 'left', size: 'wide', fill: 'photo' } },
    items: [
      { kind: 'clock.digital', pos: S(0, 3), style: { surface: 'none' } },
      { kind: 'weather.now', pos: S(1, 2), style: { surface: 'none' } },
      { kind: 'calendar.next', pos: S(2, 'fill'), props: { count: 3 } },
      { kind: 'calendar.month', pos: M(0, 0, 'xl'), props: { weeks: 4 } },
      { kind: 'countdowns', pos: M(16, 0, 't') },
      { kind: 'todo', pos: M(16, 8, 't') },
      { kind: 'message', pos: M(0, 12, 'w') },
      { kind: 'value', pos: M(12, 12, 'xs'), props: { key: 'solar.today', label: 'Solar', unit: 'kWh' } },
    ],
  },
  portrait: {
    orientation: 'portrait',
    canvas: { background: 'ambient', sidebar: { side: 'top', size: 'narrow', fill: 'glass' } },
    items: [
      { kind: 'clock.digital', pos: S(0, 4) },
      { kind: 'weather.now', pos: S(1, 4) },
      { kind: 'calendar.month', pos: M(0, 0, 'xl') },
      { kind: 'calendar.agenda', pos: M(0, 12, 'w') },
      { kind: 'countdowns', pos: M(16, 0, 't') },
    ],
  },
  dense: {
    canvas: { background: 'solid' },
    items: [
      ...[0, 2, 4, 6, 8, 10].flatMap((x) => [
        { kind: 'clock.digital' as const, pos: M(x * 2, 0, 'xs') },
        { kind: 'weather.now' as const, pos: M(x * 2, 4, 'xs') },
        { kind: 'date' as const, pos: M(x * 2, 8, 'xs') },
        { kind: 'calendar.next' as const, pos: M(x * 2, 12, 'xs') },
      ]),
    ],
  },
  home: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 'm') },
      { kind: 'ha.climate', pos: M(8, 0, 'm') },
      { kind: 'ha.light', pos: M(16, 0, 'xs') },
      { kind: 'ha.light', pos: M(20, 0, 'xs') },
      { kind: 'ha.light', pos: M(16, 4, 'xs') },
      { kind: 'ha.chart', pos: M(0, 6, 'w') },
      { kind: 'ha.camera', pos: M(12, 8, 'l'), props: { entity: 'camera.front_door' } },
      { kind: 'family.routines', pos: M(0, 10, 'm') },
    ],
  },
  // the Casa cards that read Home Assistant (states from mockHa.ts in the demo): tiles, sensors, a room, a chart, media
  ha: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 's') },
      { kind: 'ha.tile', pos: M(6, 0, 'xs'), props: { entity: 'light.living_room' } },
      { kind: 'ha.tile', pos: M(10, 0, 'xs'), props: { entity: 'switch.coffee_maker' } },
      { kind: 'ha.sensor', pos: M(14, 0, 's'), props: { entity: 'sensor.living_temperature', sparkline: true, decimals: 1 } },
      { kind: 'ha.sensor', pos: M(20, 0, 'xs'), props: { entity: 'sensor.living_humidity', decimals: 0, thresholds: [60, 75] } },
      {
        kind: 'ha.room', pos: M(0, 4, 't'),
        props: { title: 'Salón', rows: ['light.living_room', 'sensor.living_temperature', 'binary_sensor.front_door', 'switch.fan'].map((entity) => ({ entity, name: '', interactive: false })) },
      },
      { kind: 'ha.chart', pos: M(6, 4, 'm'), props: { series: [{ entity: 'sensor.living_temperature', label: '', color: null }, { entity: 'sensor.outdoor_temperature', label: '', color: null }], period: '24h', type: 'area' } },
      { kind: 'ha.sensor', pos: M(14, 4, 's'), props: { entity: 'sensor.power', decimals: 2 } },
      { kind: 'ha.tile', pos: M(20, 4, 'xs'), props: { entity: 'binary_sensor.front_door' } },
      { kind: 'ha.media', pos: M(12, 12, 'w'), props: { entity: 'media_player.living_room' } },
    ],
  },
  // cards at sizes of their own, not only the named ones: a wide clock and forecast, a tall narrow to-do list and
  // agenda, a short news strip, a wide light, a one-row sensor and switch
  flex: {
    canvas: { background: 'ambient', touch: true },
    items: [
      { kind: 'clock.digital', pos: B(0, 0, 8, 4) },
      { kind: 'weather.forecast', pos: B(8, 0, 16, 4), props: { days: 7 } },
      { kind: 'todo', pos: B(0, 4, 6, 12) },
      { kind: 'calendar.agenda', pos: B(6, 4, 8, 12), props: { days: 5 } },
      { kind: 'news', pos: B(14, 4, 10, 4) },
      { kind: 'ha.light', pos: B(14, 8, 10, 4), props: { entity: 'light.living_room' } },
      { kind: 'ha.sensor', pos: B(14, 12, 4, 2), props: { entity: 'sensor.living_temperature', decimals: 1 } },
      { kind: 'ha.switch', pos: B(14, 14, 4, 2), props: { entity: 'switch.coffee_maker' } },
      { kind: 'ha.cover', pos: B(18, 12, 6, 4), props: { entity: 'cover.living_room' } },
    ],
  },
  // the Casa cards with controls, on a screen that allows touch (the demo answers every tap itself)
  controls: {
    canvas: { background: 'ambient', touch: true },
    items: [
      { kind: 'ha.light', pos: M(0, 0, 'm'), props: { entity: 'light.living_room' } },
      { kind: 'ha.climate', pos: M(8, 0, 'm'), props: { entity: 'climate.living_room' } },
      { kind: 'ha.cover', pos: M(16, 0, 's'), props: { entity: 'cover.living_room' } },
      { kind: 'ha.light', pos: M(16, 4, 'xs'), props: { entity: 'light.kitchen' } },
      { kind: 'ha.switch', pos: M(20, 4, 'xs'), props: { entity: 'switch.coffee_maker' } },
      { kind: 'ha.scene', pos: M(0, 6, 'w'), props: { buttons: ['scene.movie', 'scene.good_night', 'scene.dinner', 'scene.all_off'].map((entity) => ({ entity, label: '', icon: '' })) } },
      { kind: 'ha.media', pos: M(12, 8, 'w'), props: { entity: 'media_player.living_room' } },
      {
        kind: 'ha.room', pos: M(0, 10, 'm'),
        props: { title: 'Cocina', rows: ['light.hall', 'switch.fan', 'sensor.kitchen_temperature'].map((entity) => ({ entity, name: '', interactive: true })) },
      },
      { kind: 'ha.tile', pos: M(8, 10, 'xs'), props: { entity: 'light.table' } },
      { kind: 'ha.climate', pos: M(12, 12, 's'), props: { entity: 'climate.bedroom' } },
      { kind: 'ha.cover', pos: M(18, 12, 's'), props: { entity: 'cover.bedroom' } },
    ],
  },
  // Entidad cards with their rows (brightness and colour temperature, −/+ and modes, the cover's buttons, a valve,
  // a vacuum, a select, a number, an update), a Indicador, a Estadística and a Sección, on a screen that allows touch
  features: {
    canvas: { background: 'ambient', touch: true },
    items: [
      { kind: 'heading', pos: M(0, 0, 'w'), props: { title: 'Salón', icon: '🛋️' }, style: { surface: 'none' } },
      { kind: 'ha.statistic', pos: M(12, 0, 's'), props: { entity: 'sensor.energy', stat: 'change', period: 'today', name: 'Consumo de hoy' } },
      { kind: 'ha.tile', pos: M(18, 0, 's'), props: { entity: 'update.home_assistant' } },
      { kind: 'ha.tile', pos: M(0, 4, 'm'), props: { entity: 'light.living_room' } },
      { kind: 'ha.tile', pos: M(8, 4, 'm'), props: { entity: 'climate.living_room' } },
      { kind: 'ha.tile', pos: M(16, 4, 's'), props: { entity: 'cover.living_room' } },
      { kind: 'ha.gauge', pos: M(16, 8, 's'), props: { entity: 'sensor.living_humidity', name: 'Humedad', decimals: 0, thresholds: [60, 75] } },
      { kind: 'ha.tile', pos: M(0, 12, 's'), props: { entity: 'valve.garden' } },
      { kind: 'ha.tile', pos: M(6, 12, 's'), props: { entity: 'vacuum.robot' } },
      { kind: 'ha.tile', pos: M(12, 12, 's'), props: { entity: 'select.dishwasher_mode' } },
      { kind: 'ha.tile', pos: M(18, 12, 's'), props: { entity: 'number.timer' } },
    ],
  },
  // the data cards (Datos): coins as a list and as a big card, games of a team, a league and the NBA, quotes as a
  // list and as a ticker; the numbers come from mockData.ts (made-up answers read like the server reads the real ones)
  data: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'market', pos: M(0, 0, 'm'), props: { coins: [{ id: 'bitcoin', currency: 'eur' }, { id: 'ethereum', currency: 'eur' }, { id: 'solana', currency: 'eur' }, { id: 'cardano', currency: 'eur' }], range: '7d' } },
      { kind: 'market', pos: M(8, 0, 'm'), props: { coins: [{ id: 'bitcoin', currency: 'eur' }], layout: 'big', range: '30d', chart: 'area' } },
      { kind: 'stocks', pos: M(16, 0, 'm'), props: { symbols: [{ sym: 'AAPL', name: 'Apple' }, { sym: 'MSFT', name: 'Microsoft' }, { sym: 'NVDA', name: 'NVIDIA' }, { sym: 'SPY', name: 'S&P 500' }], layout: 'list' } },
      { kind: 'sports', pos: M(0, 6, 'l'), props: { follow: [{ type: 'team', league: 'esp.1', team: '86', name: '' }, { type: 'league', league: 'eng.1', name: '' }], max: 5 } },
      { kind: 'sports', pos: M(12, 6, 'm'), props: { follow: [{ type: 'league', league: 'nba', name: '' }], max: 3 } },
      { kind: 'market', pos: M(20, 6, 'xs'), props: { coins: [{ id: 'solana', currency: 'usd' }, { id: 'dogecoin', currency: 'usd' }], range: '1d' } },
      { kind: 'stocks', pos: M(12, 12, 'w'), props: { symbols: [{ sym: 'AAPL' }, { sym: 'MSFT' }, { sym: 'NVDA' }, { sym: 'AMZN' }, { sym: 'GOOGL' }, { sym: 'TSLA' }, { sym: 'QQQ' }], layout: 'ticker' } },
    ],
  },
  // Divisas (exchange rates of the ECB, made-up answers): a list with its curves, one pair large over a year, the
  // curves behind the rows and behind the big rate, one-line compact cards, and a Bolsa symbol with no data
  currency: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'currency', pos: B(0, 0, 8, 7), props: { pairs: [{ base: 'EUR', quote: 'HUF' }, { base: 'EUR', quote: 'USD' }, { base: 'USD', quote: 'MXN' }, { base: 'GBP', quote: 'EUR' }], layout: 'list', range: '30d', chart: 'area' } },
      { kind: 'currency', pos: B(8, 0, 8, 7), props: { pairs: [{ base: 'EUR', quote: 'HUF' }], layout: 'big', range: '1y', chart: 'area' } },
      { kind: 'currency', pos: B(16, 0, 8, 7), props: { pairs: [{ base: 'EUR', quote: 'CHF' }, { base: 'USD', quote: 'JPY' }, { base: 'EUR', quote: 'PLN' }], layout: 'list', range: '7d', chart: 'line', chartStyle: 'background' } },
      { kind: 'currency', pos: B(0, 7, 8, 7), props: { pairs: [{ base: 'EUR', quote: 'USD' }], layout: 'big', range: '30d', chart: 'area', chartStyle: 'background' } },
      { kind: 'currency', pos: B(8, 7, 8, 1), props: { pairs: [{ base: 'EUR', quote: 'HUF' }], range: '30d', chart: 'area' } },
      { kind: 'currency', pos: B(8, 8, 8, 1), props: { pairs: [{ base: 'USD', quote: 'MXN' }], range: '7d', chart: 'line' } },
      { kind: 'stocks', pos: B(8, 9, 8, 5), props: { symbols: [{ sym: 'AAPL', name: 'Apple' }, { sym: 'EURHUF', name: '' }, { sym: 'MSFT', name: 'Microsoft' }], layout: 'list' } },
      { kind: 'stocks', pos: B(16, 7, 8, 3), props: { symbols: [{ sym: 'OANDA:EUR_HUF', name: '' }], layout: 'ticker' } },
      { kind: 'stocks', pos: B(16, 10, 8, 4), props: { symbols: [{ sym: 'AAPL' }, { sym: 'EURHUF' }, { sym: 'NVDA' }], layout: 'ticker' } },
    ],
  },
  // Divisas in its compact look (one line, the fine grid's smallest boxes) and a pair the ECB does not publish
  currencyLines: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'currency', pos: B(0, 0, 8, 1), props: { pairs: [{ base: 'EUR', quote: 'HUF' }], range: '30d', chart: 'area' } },
      { kind: 'currency', pos: B(0, 1, 6, 1), props: { pairs: [{ base: 'USD', quote: 'MXN' }, { base: 'EUR', quote: 'USD' }], range: '7d', chart: 'line' } },
      { kind: 'currency', pos: B(0, 2, 4, 1), props: { pairs: [{ base: 'GBP', quote: 'EUR' }], range: '30d', chart: 'area' } },
      { kind: 'currency', pos: B(0, 3, 4, 2), props: { pairs: [{ base: 'EUR', quote: 'IDR' }], range: '1y', chart: 'area' } },
      { kind: 'currency', pos: B(8, 0, 6, 3), props: { pairs: [{ base: 'EUR', quote: 'XAU' }], layout: 'list' } },
      { kind: 'currency', pos: B(14, 0, 6, 2), props: { pairs: [{ base: 'JPY', quote: 'EUR' }], layout: 'big', range: '30d', chart: 'area', chartStyle: 'background' } },
    ],
  },
  // Entidad cards at every size, on and off (a light by its own colour, one with the on/off row, a switch, sensors)
  tiles: {
    canvas: { background: 'ambient', touch: true },
    items: [
      { kind: 'ha.tile', pos: M(0, 0, 'xs'), props: { entity: 'light.living_room' } },
      { kind: 'ha.tile', pos: M(4, 0, 'xs'), props: { entity: 'light.kitchen' } },
      { kind: 'ha.tile', pos: M(8, 0, 's'), props: { entity: 'light.hall' } },
      { kind: 'ha.tile', pos: M(14, 0, 's'), props: { entity: 'light.terrace', features: ['toggle'] } },
      { kind: 'ha.tile', pos: M(12, 4, 's'), props: { entity: 'switch.coffee_maker', features: ['toggle'] } },
      { kind: 'ha.tile', pos: M(20, 0, 'xs'), props: { entity: 'switch.fan' } },
      { kind: 'ha.tile', pos: M(0, 4, 'w'), props: { entity: 'light.led_strip' } },
      { kind: 'ha.tile', pos: M(18, 4, 'xs'), props: { entity: 'binary_sensor.front_door' } },
      { kind: 'ha.tile', pos: M(0, 8, 'm'), props: { entity: 'light.living_room' } },
      { kind: 'ha.tile', pos: M(8, 8, 'm'), props: { entity: 'light.kitchen' } },
      { kind: 'ha.tile', pos: M(16, 8, 'xs'), props: { entity: 'sensor.living_temperature' } },
      { kind: 'ha.tile', pos: M(20, 8, 'xs'), props: { entity: 'cover.living_room' } },
      { kind: 'ha.tile', pos: M(16, 12, 'xs'), props: { entity: 'climate.living_room' } },
      { kind: 'ha.tile', pos: M(20, 12, 'xs'), props: { entity: 'lock.front_door' } },
      { kind: 'ha.tile', pos: M(0, 14, 'row'), props: { entity: 'light.porch' } },
      { kind: 'ha.tile', pos: M(6, 14, 'row'), props: { entity: 'sensor.power' } },
    ],
  },
  // Luz and Interruptor cards side by side at each size (one type size for cards of one size), a colour light with
  // its swatches, a white one with warm to cool, the square, medium and tall light layouts, on a touch screen
  lights: {
    canvas: { background: 'ambient', touch: true },
    items: [
      { kind: 'ha.switch', pos: M(0, 0, 's'), props: { entity: 'switch.pool_lights', name: 'Luces del porche' } },
      { kind: 'ha.light', pos: M(6, 0, 's'), props: { entity: 'light.square', name: 'Luz cuadrado' } },
      { kind: 'ha.switch', pos: M(12, 0, 'xs'), props: { entity: 'switch.fan' } },
      { kind: 'ha.light', pos: M(16, 0, 'xs'), props: { entity: 'light.kitchen' } },
      { kind: 'ha.tile', pos: M(20, 0, 'xs'), props: { entity: 'light.hall' } },
      { kind: 'ha.light', pos: M(0, 4, 'sq'), props: { entity: 'light.table' } },
      { kind: 'ha.light', pos: M(6, 4, 'm'), props: { entity: 'light.led_strip' } },
      { kind: 'ha.light', pos: M(14, 4, 't'), props: { entity: 'light.corridor', name: 'Exterior pasillo' } },
      { kind: 'ha.switch', pos: M(20, 4, 'xs'), props: { entity: 'switch.plug' } },
      { kind: 'ha.light', pos: M(0, 10, 'row'), props: { entity: 'light.porch' } },
      { kind: 'ha.light', pos: M(6, 10, 's'), props: { entity: 'light.desk' } },
      { kind: 'ha.light', pos: M(0, 12, 's'), props: { entity: 'light.bed', row: 'brightness' } },
      { kind: 'ha.light', pos: M(6, 14, 'row'), props: { entity: 'light.reading' } },
      { kind: 'ha.switch', pos: M(20, 12, 'xs'), props: { entity: 'switch.heater' } },
    ],
  },
  // binary sensors in the Sensor card at every size: motion, doors, water, smoke, the router, on and off
  binary: {
    canvas: { background: 'ambient' },
    items: [
      ...[0, 2, 4, 6, 8, 10].map((x) => ({ kind: 'ha.sensor' as const, pos: M(x * 2, 0, 'xs'), props: { entity: `binary_sensor.a${x}` } })),
      ...[0, 3, 6, 9].map((x) => ({ kind: 'ha.sensor' as const, pos: M(x * 2, 4, 's'), props: { entity: `binary_sensor.b${x}` } })),
      ...[0, 6].map((x) => ({ kind: 'ha.sensor' as const, pos: M(x * 2, 8, 'w'), props: { entity: `binary_sensor.c${x}` } })),
      ...[0, 3, 6, 9].flatMap((x) => [6, 7].map((y) => ({ kind: 'ha.sensor' as const, pos: M(x * 2, y * 2, 'row'), props: { entity: `binary_sensor.d${x}_${y}` } }))),
    ],
  },
  // the owner's own words for the state (#20): Entidad, Sensor and Interruptor at the Mini and the line, and a room's row
  words: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'ha.tile', pos: M(0, 0, 'xs'), props: { entity: 'binary_sensor.w_door', textOn: 'Abierta, ojo', textOff: 'Bien cerrada', colorOff: 'green' } },
      { kind: 'ha.sensor', pos: M(4, 0, 'xs'), props: { entity: 'binary_sensor.w_motion', textOn: 'Alguien pasa', textOff: 'Nadie' } },
      { kind: 'ha.switch', pos: M(8, 0, 'xs'), props: { entity: 'switch.w_coffee', textOn: 'En marcha', textOff: 'Parada' } },
      { kind: 'ha.tile', pos: M(0, 6, 'row'), props: { entity: 'binary_sensor.w_window', textOn: 'Ventana abierta', textOff: 'Ventana cerrada' } },
      { kind: 'ha.sensor', pos: M(0, 8, 'row'), props: { entity: 'binary_sensor.w_garden', textOn: 'Jardín abierto', textOff: 'Jardín cerrado', colorOn: 'yellow' } },
      { kind: 'ha.room', pos: M(12, 0, 'm'), props: { title: 'Cocina', rows: [{ entity: 'binary_sensor.w_terrace', name: '', interactive: false, textOn: 'Alguien fuera', textOff: 'Sin nadie' }, { entity: 'binary_sensor.w_leak', name: '', interactive: false }] } },
    ],
  },
  // every Casa card at its smallest size (Mini), the Entidad card with each kind of entity
  smallest: {
    canvas: { background: 'ambient', touch: true },
    items: [
      { kind: 'ha.sensor', pos: M(0, 0, 'xs'), props: { entity: 'sensor.living_temperature', decimals: 1 } },
      { kind: 'ha.gauge', pos: M(4, 0, 'xs'), props: { entity: 'sensor.living_humidity', name: 'Humedad', decimals: 0, thresholds: [60, 75] } },
      { kind: 'ha.statistic', pos: M(8, 0, 'xs'), props: { entity: 'sensor.energy', stat: 'change', period: 'today', name: 'Consumo de hoy' } },
      { kind: 'ha.light', pos: M(12, 0, 'xs'), props: { entity: 'light.living_room' } },
      { kind: 'ha.switch', pos: M(16, 0, 'xs'), props: { entity: 'switch.coffee_maker' } },
      { kind: 'ha.cover', pos: M(20, 0, 'xs'), props: { entity: 'cover.living_room' } },
      { kind: 'ha.tile', pos: M(0, 4, 'xs'), props: { entity: 'valve.garden' } },
      { kind: 'ha.tile', pos: M(4, 4, 'xs'), props: { entity: 'vacuum.robot' } },
      { kind: 'ha.tile', pos: M(8, 4, 'xs'), props: { entity: 'select.dishwasher_mode' } },
      { kind: 'ha.tile', pos: M(12, 4, 'xs'), props: { entity: 'number.timer' } },
      { kind: 'ha.tile', pos: M(16, 4, 'xs'), props: { entity: 'update.home_assistant' } },
      { kind: 'ha.tile', pos: M(20, 4, 'xs'), props: { entity: 'climate.bedroom' } },
      { kind: 'ha.tile', pos: M(0, 8, 's'), props: { entity: 'valve.garden_2' } },
      { kind: 'ha.tile', pos: M(6, 8, 's'), props: { entity: 'vacuum.robot_2' } },
      { kind: 'ha.tile', pos: M(12, 8, 's'), props: { entity: 'select.dishwasher_2' } },
      { kind: 'ha.tile', pos: M(18, 8, 's'), props: { entity: 'number.timer_2' } },
      { kind: 'ha.tile', pos: M(0, 12, 's'), props: { entity: 'update.router' } },
      { kind: 'ha.tile', pos: M(6, 12, 's'), props: { entity: 'fan.bedroom', features: ['toggle'] } },
      { kind: 'ha.tile', pos: M(12, 12, 's'), props: { entity: 'media_player.living_room' } },
      { kind: 'ha.scene', pos: M(18, 12, 'xs'), props: { buttons: ['scene.movie', 'scene.good_night'].map((entity) => ({ entity, label: '', icon: '' })) } },
    ],
  },
  // an entity that looks like a door: two taps, or press and hold (display-canvas.test.js)
  confirm: {
    canvas: { background: 'solid', touch: true },
    items: [
      { kind: 'ha.switch', pos: M(0, 0, 's'), props: { entity: 'switch.garage_door', name: 'Puerta del garaje' } },
      { kind: 'ha.switch', pos: M(8, 0, 's'), props: { entity: 'switch.coffee_maker' } },
    ],
  },
  // Rotativas that change with Home Assistant (#19): the hall's motion sensor (&motion=on|off|unavailable, or the
  // 'marco:demo-ha' event, mockHa.ts) shows the hall light while all is clear and the camera when there is movement;
  // with the sensor unavailable neither card holds and the first Rotativa is hidden. The second one keeps a card
  // with no condition, so it always shows something.
  motion: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 'm') },
      { kind: 'rotator', pos: M(8, 0, 'l'), props: { everySec: 5, cards: [
        { id: '', kind: 'ha.tile', props: { ...canvasDefaults('ha.tile'), entity: 'light.hall', name: 'Pasillo' }, when: { src: 'ha', entity: 'binary_sensor.hall_motion', op: 'eq', value: 'off' } },
        { id: '', kind: 'ha.camera', props: { ...canvasDefaults('ha.camera'), entity: 'camera.hall' }, when: { src: 'ha', entity: 'binary_sensor.hall_motion', op: 'eq', value: 'on' } },
      ] } },
      { kind: 'rotator', pos: M(0, 8, 'w'), props: { everySec: 5, cards: [
        { id: '', kind: 'ha.sensor', props: { ...canvasDefaults('ha.sensor'), entity: 'sensor.hall_temperature', name: 'Pasillo' } },
        { id: '', kind: 'ha.tile', props: { ...canvasDefaults('ha.tile'), entity: 'binary_sensor.hall_motion', name: 'Movimiento en el pasillo' }, when: { src: 'ha', entity: 'binary_sensor.hall_motion', op: 'eq', value: 'on' } },
      ] } },
    ],
  },
  // a space that changes with Home Assistant (#19, "Grupo"): a Rotativa of 3×3 cells shows the hall camera while
  // someone moves and a group of three entity cards in rows while all is clear (&motion=on|off, as 'motion'); a
  // second one at its smallest with the group in columns (6×2), and a larger one in rows
  'motion-group': {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 'm') },
      { kind: 'rotator', pos: B(8, 0, 3, 3), props: { everySec: 5, cards: motionGroup('rows') } },
      { kind: 'rotator', pos: B(12, 0, 6, 2), props: { everySec: 5, cards: motionGroup('cols') } },
      { kind: 'rotator', pos: M(8, 6, 'l'), props: { everySec: 5, cards: motionGroup('rows') } },
    ],
  },
  // "Grupo" on its own (#25): a Rotativa whose only card is a group, so it never turns: three entity cards in two rows
  // (3x2, its smallest), four in three rows (3x3) and three side by side (6x2)
  groups: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 'm') },
      { kind: 'rotator', pos: B(8, 0, 3, 2), props: { dots: false, cards: [loneGroup('rows', 3)] } },
      { kind: 'rotator', pos: B(12, 0, 3, 3), props: { dots: false, cards: [loneGroup('rows', 4)] } },
      { kind: 'rotator', pos: B(16, 0, 6, 2), props: { dots: false, cards: [loneGroup('cols', 3)] } },
    ],
  },
  // a small Rotativa inside a group (#19): the 'motion-group' space of 6×6 cells, its group of three in rows, the last
  // of them a Rotativa of its own that turns between two temperature cards every 5 s (a third one, shown only while
  // someone moves, is skipped while all is clear)
  'motion-nest': {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 'm') },
      { kind: 'rotator', pos: B(8, 0, 6, 6), props: { everySec: 5, cards: motionNest() } },
    ],
  },
  // cameras with a chart: a snapshot card with its name, one set to live (the demo shows snapshots), one that waits
  // for a motion sensor, and a picture shown whole
  cameras: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'ha.camera', pos: M(0, 0, 'l'), props: { entity: 'camera.front_door', everySec: 2 } },
      { kind: 'ha.camera', pos: M(12, 0, 'l'), props: { entity: 'camera.garden', mode: 'live' } },
      { kind: 'ha.camera', pos: M(0, 8, 'm'), props: { entity: 'camera.garage', showWhen: 'binary_sensor.garage_motion', fit: 'contain', label: false } },
      { kind: 'ha.chart', pos: M(8, 8, 'w'), props: { series: [{ entity: 'sensor.living_temperature', label: '', color: null }], period: '24h', type: 'line' } },
      { kind: 'clock.digital', pos: M(20, 8, 'xs') },
      { kind: 'ha.sensor', pos: M(20, 12, 'xs'), props: { entity: 'sensor.outdoor_temperature', decimals: 1 } },
    ],
  },
  // every clock kind (the DST and day-offset checks of display-canvas.test.js; &tz= sets the screen's zone)
  clocks: {
    canvas: { background: 'solid' },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 'm'), props: { seconds: false } },
      { kind: 'clock.analog', pos: M(8, 0, 'm'), props: { seconds: false } },
      { kind: 'clock.flip', pos: M(16, 0, 'm') },
      { kind: 'clock.world', pos: M(0, 6, 'm'), props: { zones: [{ tz: 'America/New_York', label: 'New York' }, { tz: 'Pacific/Auckland', label: 'Auckland' }] } },
      { kind: 'date', pos: M(8, 6, 's') },
    ],
  },
  // the clocks' and the date card's own text colours (Estilo: Color de la hora, Color de la fecha), next to the same
  // cards on Automático
  ink: {
    canvas: { background: 'solid' },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 'm'), props: { timeColor: '#ffb340', dateColor: '#64d2ff' } },
      { kind: 'clock.analog', pos: M(8, 0, 'm'), props: { face: 'numbers', seconds: false, showDate: true, timeColor: '#ff6b6b', dateColor: '#30d158' } },
      { kind: 'clock.flip', pos: M(16, 0, 'm'), props: { showDate: true, timeColor: '#bf5af2', dateColor: '#ffd60a' } },
      { kind: 'clock.world', pos: M(0, 6, 'm'), props: { analog: true, timeColor: '#64d2ff' } },
      { kind: 'date', pos: M(8, 6, 's'), props: { dateColor: '#ff9f0a' } },
      { kind: 'date', pos: M(14, 6, 's'), props: { dateColor: '#ff9f0a' }, style: { accent: '#30d158' } },
      { kind: 'clock.digital', pos: M(0, 12, 's') },
      { kind: 'clock.analog', pos: M(8, 12, 's'), props: { face: 'classic', seconds: false } },
      { kind: 'date', pos: M(14, 12, 's') },
    ],
  },
  // two calendars side by side, each with its own calendars (Work, and Lucía & Mateo)
  calendars: {
    canvas: { background: 'solid' },
    items: [
      { kind: 'calendar.agenda', pos: M(0, 0, 'xl'), props: { sourceIds: ['c_work'], days: 14 } },
      { kind: 'calendar.agenda', pos: M(16, 0, 't'), props: { sourceIds: ['c_kids'], days: 14 } },
    ],
  },
  // a saved widget (the demo electricity prices, twice), a photo card, a spacer and the message
  media: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'widget', pos: M(0, 0, 'l'), props: { widgetId: DEMO_WIDGET } },
      { kind: 'photo', pos: M(12, 0, 'l'), props: { fit: 'cover', caption: true } },
      { kind: 'spacer', pos: M(0, 8, 'm') },
      { kind: 'message', pos: M(8, 8, 'w'), props: { align: 'left' } },
      { kind: 'clock.digital', pos: M(20, 8, 'xs') },
      // the same saved widget a second time: each item gets its own copy
      { kind: 'widget', pos: M(8, 12, 's'), props: { widgetId: DEMO_WIDGET } },
    ],
  },
  // Sonando ahora (?np=idle: nothing plays, every card is hidden): the wide card, a big one, one line, one without a
  // cover, one in the sidebar, and one with no account chosen (never drawn on a TV)
  nowplaying: {
    canvas: { background: 'ambient', sidebar: { side: 'right', size: 'normal', fill: 'glass' } },
    items: [
      { kind: 'nowplaying', pos: M(0, 0, 'w'), props: { account: DEMO_NOW_PLAYING_ACCOUNT } },
      { kind: 'nowplaying', pos: M(0, 4, 'l'), props: { account: 'sp_demo0000001' } },
      { kind: 'nowplaying', pos: B(0, 12, 10, 1), props: { account: DEMO_NOW_PLAYING_ACCOUNT } },
      { kind: 'nowplaying', pos: B(0, 14, 8, 2), props: { account: 'sp_demo0000001', art: false } },
      { kind: 'nowplaying', pos: S(0, 3), props: { account: DEMO_NOW_PLAYING_ACCOUNT } },
      { kind: 'clock.digital', pos: S(1, 'fill') },
      { kind: 'nowplaying', pos: M(12, 0, 's') },
    ],
  },
  // Familia y hogar: everyone's routines, one person's, the faces, the leaderboard, rewards, chores and today's meals
  family: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'family.routines', pos: M(0, 0, 'l') },
      { kind: 'family.members', pos: M(12, 0, 's') },
      { kind: 'family.points', pos: M(18, 0, 't') },
      { kind: 'family.rewards', pos: M(12, 4, 's') },
      { kind: 'family.chores', pos: M(0, 8, 't') },
      { kind: 'family.routines', pos: M(6, 8, 'm'), props: { memberId: 'm_mateo' } },
      { kind: 'meals.today', pos: M(14, 8, 's') },
      { kind: 'clock.digital', pos: M(20, 8, 'xs') },
    ],
  },
  // the rest of Familia y hogar: highlights, the announcement (&announce=info), birthdays, countdowns, news, the week's meals
  household: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'highlights', pos: M(0, 0, 'w') },
      { kind: 'announcement', pos: M(12, 0, 'w') },
      { kind: 'birthdays', pos: M(0, 4, 't') },
      { kind: 'countdowns', pos: M(6, 4, 't') },
      { kind: 'news', pos: M(12, 4, 'm') },
      { kind: 'clock.digital', pos: M(20, 4, 'xs') },
      { kind: 'weather.now', pos: M(20, 8, 'xs') },
      { kind: 'meals.week', pos: M(0, 12, 'band') },
    ],
  },
  // the look of each card: its own glass with the automatic tint over each half of the photo (&photo=half), a custom
  // tint, a solid colour, an accent, a title, a larger text, and ten glass cards, two more than the blur budget
  look: {
    canvas: { background: 'photo', dim: 0 },
    items: [
      { kind: 'clock.digital', pos: M(0, 0, 'xs'), props: { showDate: false } },
      { kind: 'date', pos: M(4, 0, 'xs'), style: { accent: '#34c759' } },
      { kind: 'weather.now', pos: M(8, 0, 'xs'), style: { surface: 'solid', color: '#f2c94c' } },
      { kind: 'clock.analog', pos: M(12, 0, 'xs') },
      { kind: 'calendar.next', pos: M(16, 0, 'xs'), style: { radius: 'm' } },
      { kind: 'weather.now', pos: M(20, 0, 'xs'), props: { meta: false } },
      { kind: 'calendar.agenda', pos: M(0, 4, 'm'), style: { glass: { appearance: 'auto', opacity: 0.5, blur: 18, tint: 'auto', edge: true }, title: 'Agenda', icon: '📅', showTitle: true } },
      { kind: 'todo', pos: M(8, 4, 'm'), style: { glass: { appearance: 'tinted', opacity: 0.6, blur: 24, tint: 'dark', edge: false }, color: '#1d2b4c' } },
      { kind: 'message', pos: M(16, 4, 'm'), style: { glass: { appearance: 'auto', opacity: 0.5, blur: 18, tint: 'auto', edge: true } } },
      { kind: 'weather.forecast', pos: M(0, 10, 'w') },
      { kind: 'news', pos: M(12, 10, 'w'), style: { scale: 1.2 } },
    ],
  },
  // custom HTML cards (3 at most): two starter cards of the editor and one with a bar, an icon, the weather and the time
  html: {
    canvas: { background: 'ambient' },
    items: [
      htmlItem(M(0, 0, 'm'), 'temp', { temp: 'sensor.living_temperature' }),
      {
        kind: 'html',
        pos: M(0, 6, 'l'),
        props: {
          html:
            '<div class="w">\n  <svg viewBox="0 0 24 24" width="48" height="48"><circle class="sun" cx="12" cy="12" r="5"/><path class="rays" d="M12 1v3M12 20v3M1 12h3M20 12h3" stroke-width="2" stroke-linecap="round"/></svg>\n' +
            '  <h2>{{now}}</h2>\n  <p>{{wx}}{{wx.unit}} · {{wx.name}}</p>\n  <p class="ev">{{#next}}{{next.time}} {{next}}{{/next}}{{^next}}·{{/next}}</p>\n' +
            '  <div class="bar"><i style="width: {{hum | pct}}%"></i></div>\n  <small>{{hum.name}} {{hum | round:0}} {{hum.unit}}</small>\n</div>',
          css: '.w { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 0.4em; }\nh2 { margin: 0; font-size: 3em; }\np { margin: 0; color: var(--ink-2); }\n.bar { height: 0.6em; border-radius: 1em; background: var(--fill); overflow: hidden; }\n.bar i { display: block; height: 100%; background: var(--accent); }\nsmall { color: var(--ink-2); }\n.sun { fill: var(--accent); }\n.rays { stroke: var(--accent); }',
          bind: [{ name: 'now', builtin: 'time' }, { name: 'wx', builtin: 'weather' }, { name: 'next', builtin: 'nextEvent' }, { name: 'hum', entity: 'sensor.living_humidity' }],
        },
      },
      // after the card above, so the demo's made-up sensors come in a sensible order (humidity there, then these)
      htmlItem(M(8, 0, 'm'), 'rooms', { room1: 'sensor.living_temperature', room2: 'sensor.power', door: 'binary_sensor.front_door' }),
      { kind: 'clock.digital', pos: M(16, 0, 'm') },
      { kind: 'weather.now', pos: M(12, 6, 'm') },
    ],
  },
  // pushed values (Valor): a number with its unit, a word, true/false, one that has gone stale, one with no value yet,
  // a wide one, and a custom card bound to a key
  values: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'value', pos: M(0, 0, 's'), props: { key: 'solar.today', label: 'Solar hoy', unit: 'kWh', decimals: 1, icon: '☀️' } },
      { kind: 'value', pos: M(6, 0, 's'), props: { key: 'washer', label: 'Lavadora', icon: '🧺' } },
      { kind: 'value', pos: M(12, 0, 's'), props: { key: 'garage.open', label: 'Garaje abierto', icon: '🚗' } },
      { kind: 'value', pos: M(18, 0, 's'), props: { key: 'mail', label: 'Buzón', decimals: 0, icon: '📬', staleAfterMin: 60 } },
      { kind: 'value', pos: M(0, 6, 'xs'), props: { key: 'co2', label: 'CO₂', unit: 'ppm', decimals: 0 } },
      { kind: 'value', pos: M(4, 6, 'xs'), props: { key: 'nothing.yet', label: 'Piscina', unit: '°C' } },
      { kind: 'value', pos: M(8, 6, 'w'), props: { key: 'grid.power', decimals: 2 } },
      {
        kind: 'html',
        pos: M(0, 10, 'm'),
        props: {
          html: '<div class="b">\n  <small>{{bat.name}}</small>\n  <h2>{{bat | round:0}} {{bat.unit}}</h2>\n  <div class="bar"><i style="width: {{bat | pct}}%"></i></div>\n  <small>{{bat.ago}}</small>\n</div>',
          css: '.b { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 0.4em; }\nh2 { margin: 0; font-size: 2.6em; }\nsmall { color: var(--ink-2); }\n.bar { height: 0.6em; border-radius: 1em; background: var(--fill); overflow: hidden; }\n.bar i { display: block; height: 100%; background: var(--accent); }',
          bind: [{ name: 'bat', value: 'home.battery' }],
        },
      },
      { kind: 'clock.digital', pos: M(8, 10, 'm') },
    ],
  },
  empty: { canvas: {}, items: [] },
  ...SHOWCASE,
  // weather of several places (#11), made-up places: the screen's own, a card with a place of its own, the cities card
  // as a list and as a grid, the next days somewhere else (the demo makes the weather up: mock.ts mockPlaceWeather)
  places: {
    canvas: { background: 'ambient' },
    items: [
      { kind: 'clock.digital', pos: B(0, 0, 8, 4) },
      { kind: 'weather.now', pos: B(0, 4, 8, 6) },
      { kind: 'weather.now', pos: B(8, 0, 8, 6), props: { place: { name: 'Beach house', lat: 37.02, lon: -7.93 } } },
      { kind: 'weather.cities', pos: B(16, 0, 8, 10), props: { places: [{ name: 'Grandma’s', lat: 41.55, lon: -8.42 }, { name: 'Lake cabin', lat: 46.2, lon: 7.4 }, { name: 'Uni flat', lat: 52.37, lon: 4.9 }, { name: 'Beach house', lat: 37.02, lon: -7.93 }] } },
      { kind: 'weather.cities', pos: B(0, 10, 14, 6), props: { layout: 'grid', places: [{ name: 'Grandma’s', lat: 41.55, lon: -8.42 }, { name: 'Lake cabin', lat: 46.2, lon: 7.4 }, { name: 'Uni flat', lat: 52.37, lon: 4.9 }, { name: 'Ski lodge', lat: 63.4, lon: 10.4 }] } },
      { kind: 'weather.forecast', pos: B(8, 6, 8, 4), props: { place: { name: 'Lake cabin', lat: 46.2, lon: 7.4 } } },
      { kind: 'weather.forecast', pos: B(14, 10, 10, 6), props: { place: { name: 'Ski lodge', lat: 63.4, lon: 10.4 }, layout: 'column', days: 3 } },
    ],
  },
};

/** The cards of a Rotativa of the 'motion-group' demo: the hall camera, or a group of three entity cards (#19). */
function motionGroup(dir: 'rows' | 'cols'): Record<string, unknown>[] {
  const when = (value: string) => ({ src: 'ha', entity: 'binary_sensor.hall_motion', op: 'eq', value });
  const tile = (entity: string, name: string) => ({ id: '', kind: 'ha.tile', props: { ...canvasDefaults('ha.tile'), entity, name } });
  return [
    { id: '', kind: 'ha.camera', props: { ...canvasDefaults('ha.camera'), entity: 'camera.hall' }, when: when('on') },
    { id: '', kind: 'group', props: { dir, cards: [tile('light.hall', 'Pasillo'), tile('binary_sensor.front_door', 'Puerta'), tile('sensor.living_temperature', 'Salón')] }, when: when('off') },
  ];
}

/** The group of the 'groups' demo (#25): `n` entity cards in rows or columns. */
function loneGroup(dir: 'rows' | 'cols', n: number): Record<string, unknown> {
  const tile = (entity: string, name: string) => ({ id: '', kind: 'ha.tile', props: { ...canvasDefaults('ha.tile'), entity, name } });
  const all = [tile('light.hall', 'Pasillo'), tile('binary_sensor.front_door', 'Puerta'), tile('sensor.living_temperature', 'Salón'), tile('switch.fan', 'Ventilador')];
  return { id: '', kind: 'group', props: { dir, cards: all.slice(0, n) } };
}

/** The cards of the 'motion-nest' demo: the hall camera, or a group of two entity cards and a small Rotativa (#19). */
function motionNest(): Record<string, unknown>[] {
  const when = (value: string) => ({ src: 'ha', entity: 'binary_sensor.hall_motion', op: 'eq', value });
  const tile = (entity: string, name: string) => ({ id: '', kind: 'ha.tile', props: { ...canvasDefaults('ha.tile'), entity, name } });
  const nest = { id: '', kind: 'rotator', props: { everySec: 5, dots: true, cards: [
    tile('sensor.living_temperature', 'Salón'),
    { ...tile('binary_sensor.hall_motion', 'Movimiento'), when: when('on') },
    { id: '', kind: 'ha.sensor', props: { ...canvasDefaults('ha.sensor'), entity: 'sensor.hall_temperature', name: 'Pasillo' } },
  ] } };
  return [
    { id: '', kind: 'ha.camera', props: { ...canvasDefaults('ha.camera'), entity: 'camera.hall' }, when: when('on') },
    { id: '', kind: 'group', props: { dir: 'rows', cards: [tile('light.hall', 'Pasillo'), tile('binary_sensor.front_door', 'Puerta'), nest] }, when: when('off') },
  ];
}

/** The demo's pushed values (?demo=1): made up, a few minutes old; the mailbox one is three hours old (stale). */
export function demoValues(cfg: DisplayConfig | null): Record<string, DisplayValue> {
  const now = Date.now();
  const all: Record<string, DisplayValue> = {
    'solar.today': { v: 12.64, u: 'kWh', l: 'Solar', at: now - 4 * 60_000 },
    washer: { v: 'Terminado', at: now - 12 * 60_000 },
    'garage.open': { v: false, at: now - 30_000 },
    mail: { v: 2, at: now - 3 * 3600_000 },
    co2: { v: 612, u: 'ppm', at: now - 2 * 60_000 },
    'grid.power': { v: -1.84, u: 'kW', l: 'Red eléctrica', at: now - 60_000 },
    'home.battery': { v: 76, u: '%', l: 'Batería de casa', at: now - 6 * 60_000 },
  };
  const keys = new Set<string>();
  for (const it of canvasCards(cfg?.canvas?.items)) {
    const p = it.props as { key?: string; bind?: { value?: string }[] };
    if (it.kind === 'value' && p.key) keys.add(p.key);
    if (it.kind === 'html') for (const b of p.bind ?? []) if (b?.value) keys.add(b.value);
  }
  return Object.fromEntries(Object.entries(all).filter(([k]) => keys.has(k)));
}

/** A starter card of the editor (cardSnippets) with its bindings set to `entities` (name → entity id). */
function htmlItem(pos: Raw['pos'], id: string, entities: Record<string, string>): Raw {
  const sn = cardSnippets('Lo mejor de la casa es quien la habita.').find((x) => x.id === id)!;
  return { kind: 'html', pos, props: { html: sn.html, css: sn.css, bind: sn.bind.map((b) => (b.builtin ? b : { name: b.name, entity: entities[b.name] ?? '' })) } };
}

/** What one copy of a Casa card binds in the size fixture (n: which copy, so states and names vary). */
function sizeProps(kind: string, n: number): Record<string, unknown> {
  const one = (d: string) => `${d}.demo_${n}`;
  // the Entidad card: another kind of entity in each copy
  const TILE = ['light', 'switch', 'cover', 'climate', 'sensor', 'binary_sensor', 'valve', 'vacuum', 'select', 'number', 'update', 'media_player', 'lock', 'fan'];
  // a longer name now and then, as people write them
  const name = n % 3 === 2 ? 'Luces de la piscina del jardín de atrás' : '';
  switch (kind) {
    case 'ha.tile': return { entity: one(TILE[n % TILE.length]), name };
    case 'ha.light': return { entity: one('light'), name };
    case 'ha.switch': return { entity: one('switch'), name };
    // every other one as a card saved before the short defaults: all seven modes, the fan and the humidity on
    case 'ha.climate': return n % 2 ? { entity: one('climate'), modes: ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'], fan: true, humidity: true } : { entity: one('climate') };
    case 'ha.cover': return { entity: one('cover') };
    // every third one a binary sensor (motion, a door, water...)
    // the curve behind the value and, every other one, in a band under it (Estilo de la gráfica)
    // (with Colores según el valor, the other way round every other one, so every look shows its colour)
    // a binary one in its own colours every other time (Colores según el estado: red open, green closed)
    case 'ha.sensor': return n % 3 === 1 ? { entity: one('binary_sensor'), ...(n % 2 ? { colorOn: 'red', colorOff: 'green' } : {}) } : { entity: one('sensor'), sparkline: n % 2 === 0, chartStyle: n % 4 === 2 ? 'below' : 'background', decimals: 1, name, thresholds: [20, 60], invert: n % 2 === 1 };
    // (one decimal every other one, so a narrow box shows a wider number, with or without its unit)
    case 'ha.gauge': return { entity: one('sensor'), decimals: n % 2, thresholds: [60, 75], name };
    case 'ha.statistic': return { entity: one('sensor'), stat: n % 2 ? 'mean' : 'change', period: n % 3 ? 'today' : 'month', name: n % 3 === 2 ? '[AA] Aire Dormitorio Principal - Split interior' : n % 2 ? '' : 'Consumo de hoy' };
    case 'heading': return { title: n % 3 === 2 ? 'Planta baja y jardín de atrás' : 'Salón', icon: n % 2 ? '' : '🛋️' };
    case 'ha.room': return { title: 'Salón', rows: ['light', 'sensor', 'binary_sensor', 'switch', 'cover'].slice(0, 3 + (n % 3)).map((d, i) => ({ entity: `${d}.room_${n}_${i}`, name: '', interactive: true })) };
    // lines, areas and bars, under the heading with axes and filling the card behind it (Estilo de la gráfica)
    case 'ha.chart': return { series: [0, 1].map((i) => ({ entity: `sensor.chart_${n}_${i}`, label: '', color: null })), period: '24h', type: (['line', 'area', 'bar'] as const)[n % 3], chartStyle: n % 2 ? 'background' : 'below' };
    case 'ha.camera': return { entity: one('camera') };
    case 'ha.media': return { entity: one('media_player') };
    // the electricity prices with their bars under the price and, every other one, behind it
    case 'widget': return { widgetId: DEMO_WIDGET, chartStyle: n % 2 ? 'background' : 'below' };
    // a number with a unit, a word, yes or no
    case 'value': return [{ key: 'solar.today', label: 'Solar hoy', unit: 'kWh', decimals: 1, icon: '☀️' }, { key: 'washer', label: 'Lavadora', icon: '🧺' }, { key: 'garage.open', label: 'Garaje abierto', icon: '🚗' }][n % 3];
    // one, three or five of the next events (the card leaves out what its box does not hold)
    case 'calendar.next': return { count: 1 + (n % 3) * 2 };
    // a Rotativa of its default cards (the week and the hours ahead), turning every five seconds
    case 'rotator': return { everySec: 5 };
    // two, four (a long name among them) or eight places, every other copy as a grid, with and without high and low
    case 'weather.cities': {
      const all = [
        { name: 'Grandma’s', lat: 41.55, lon: -8.42 }, { name: 'The lake cabin up in the mountains', lat: 46.2, lon: 7.4 },
        { name: 'Uni flat', lat: 52.37, lon: 4.9 }, { name: 'Ski lodge', lat: 63.4, lon: 10.4 }, { name: 'Beach house', lat: 37.02, lon: -7.93 },
        { name: 'Office', lat: 40.42, lon: -3.7 }, { name: 'Aunt Rosa', lat: 45.46, lon: 9.19 }, { name: 'Campsite', lat: 43.3, lon: 5.4 },
      ];
      return { places: all.slice(0, [2, 4, 8][n % 3]), layout: n % 2 ? 'grid' : 'list', highLow: n % 4 !== 3 };
    }
    // what plays: two made-up tracks by turns, every third card without its cover, every other without the bar
    case 'nowplaying': return { account: n % 2 ? 'sp_demo0000001' : DEMO_NOW_PLAYING_ACCOUNT, art: n % 3 !== 2, progress: n % 2 === 0 };
    case 'ha.scene': return { buttons: ['scene', 'script', 'scene', 'button'].slice(0, 2 + (n % 3)).map((d, i) => ({ entity: `${d}.s_${n}_${i}`, label: '', icon: '' })) };
    default: return {};
  }
}

/**
 * &shot=size:<kind>:<size or WxH>[:portrait|landscape[:top|left|right|none[:photo|ambient[:fine][:compact]]]]: as many
 * copies of one card at one size (a named one, or any box of w×h cells its kind allows, e.g. 5x2) as the grid holds
 * (at most six, on a touch screen), for the tests that every card fits at every size it allows (display-canvas.test.js);
 * a Rotativa of other cards than its default ones names them after it, `rotator,ha.tile,ha.camera`;
 * :photo puts the demo photos behind, :compact draws it in Densidad compacta. Sizes and WxH are in cells of the
 * grid (24×16); a :fine flag left by older scripts changes nothing.
 */
function sizeFixture(name: string): (typeof CANVAS_FIXTURES)[string] | null {
  const parts = name.split(':');
  const [, spec, size, orient, side, bg] = parts;
  const [kind, ...inside] = (spec ?? '').split(',');
  const compact = parts.slice(4).includes('compact');
  // a Rotativa's own cards (with the demo props each has on its own)
  const kinds = CANVAS_KINDS as Record<string, unknown>;
  if (inside.length && (kind !== 'rotator' || inside.some((k) => !kinds[k]))) return null;
  const own = (n: number) => (inside.length ? { cards: inside.map((k, i) => ({ id: '', kind: k, props: { ...canvasDefaults(k), ...sizeProps(k, n + i) } })) } : {});
  const def = (CANVAS_KINDS as Record<string, { sizes: string[]; perScreen?: number }>)[kind];
  const o = orient === 'portrait' ? 'portrait' : 'landscape';
  const cells = /^(\d{1,2})x(\d{1,2})$/.exec(size ?? '');
  // (a Rotativa: within what its default cards allow, canvasCore kindFor)
  const sized = kindFor({ kind, props: { ...canvasDefaults(kind), ...sizeProps(kind, 0), ...own(0) } }) ?? kind;
  if (!def || (!def.sizes.includes(size) && !(cells && boxAllowed(sized, Number(cells[1]), Number(cells[2]), o)))) return null;
  const { cols, rows } = gridDims(o);
  const [w, h] = cells ? [Number(cells[1]), Number(cells[2])] : sizeCells(size, o);
  const at = (x: number, y: number) => (cells ? { ...B(x, y, w, h), size: lookSize(sized, w, h, o) as never } : M(x, y, size));
  const items: Raw[] = [];
  // (a Rotativa's cards count against their own kinds' caps too: no more Rotativas than those let keep all their cards)
  const max = Math.min(6, def.perScreen ?? 6, ...inside.map((k) => (kinds[k] as { perScreen?: number }).perScreen ?? 6));
  for (let y = 0; y + h <= rows && items.length < max; y += h) {
    for (let x = 0; x + w <= cols && items.length < max; x += w) items.push({ kind: kind as CanvasItem['kind'], pos: at(x, y), props: { ...sizeProps(kind, items.length), ...own(items.length) } });
  }
  // :top, :left, :right: a wide sidebar there (a third of the height or of the width), so every cell is smaller
  const where = side === 'top' || side === 'left' || side === 'right' ? (side as 'top' | 'left' | 'right') : null;
  const sidebar = where ? { side: where, size: 'wide' as const, fill: 'glass' as const } : undefined;
  // :photo at the end (after the side, or :none): the demo photos behind, a little dimmed
  const back = bg === 'photo' ? { background: 'photo' as const, dim: 0.25 } : { background: 'ambient' as const };
  return { canvas: { ...back, touch: true, ...(sidebar ? { sidebar } : {}), ...(compact ? { density: 'compact' as const } : {}) }, items, orientation: o };
}

/** The demo canvas of `name` (unknown: starter), as the server would send it; `screens`: the household's (names of the "Ir a pantalla" targets). */
export function mockCanvas(name: string | null, screens?: { id: string; name: string }[]): { canvas: DisplayCanvas; orientation?: 'portrait' | 'landscape' } {
  const fx = (name?.startsWith('size:') ? sizeFixture(name) : null) ?? CANVAS_FIXTURES[name ?? ''] ?? CANVAS_FIXTURES.starter;
  const raw = {
    ...defaultCanvas(),
    ...fx.canvas,
    sidebar: { ...defaultCanvas().sidebar, ...(fx.canvas.sidebar ?? {}) },
    items: fx.items.map((it, i) => ({
      // stable ids: the same demo every time (screenshots)
      id: `cv_demo${String(i).padStart(4, '0')}`,
      kind: it.kind,
      pos: it.pos,
      ...(it.portrait ? { portrait: it.portrait } : {}),
      style: { ...defaultItemStyle(), ...(it.style ?? {}) },
      props: { ...canvasDefaults(it.kind), ...(it.props ?? {}) },
    })),
  };
  const canvas = sanitizeCanvas({ err: (p: string, m: string) => console.warn('[demo canvas]', p, m) }, 'canvas', raw, { widgets: new Map([[DEMO_WIDGET, {}]]) }, {});
  // what a server keeps to itself: the entities behind the aliases and the conditions (mockHa.ts reads them)
  DEMO_SAVED.entities.clear();
  for (const it of canvasCards(canvas.items)) for (const a of itemAliases(it)) DEMO_SAVED.entities.set(a.alias, a.entity);
  DEMO_SAVED.canvas = canvas;
  const projected = projectCanvas({ layout: { preset: 'canvas' }, screen: { orientation: fx.orientation ?? 'auto' }, canvas }, screens ? { screens } : {})!;
  return { canvas: projected, orientation: fx.orientation };
}
