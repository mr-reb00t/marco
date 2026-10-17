// Showcase screen "portrait": a kitchen tablet on the wall (1080x1920, portrait), late afternoon. The time and the
// weather on top, today's three meals as tiles, the shopping list and today's plan side by side (Elena's birthday:
// candles on the list), the oven timer counting down under the list (in the screen's cool blue, not an alarm's orange), and the two kitchen lights down the right: the
// island strip in purple (its colours) and the pendants warm (their brightness slider, no state line so 80 % is
// printed once).
//   ?demo=1&preset=canvas&lang=en&now=2026-10-15T16:12Z&shot=show.portrait   (the clock reads 17:12)
// Registered in index.ts: PORTRAIT_LAYOUT is the fixture, PORTRAIT_HA this screen's states by alias, PORTRAIT_TODO
// the shopping list (cfg.todo.items).
import type { CanvasConfig, CanvasItem, HaSlim, TodoItem } from '../../shared/types';

type Raw = { kind: CanvasItem['kind']; pos: CanvasItem['pos']; portrait?: CanvasItem['pos']; props?: Record<string, unknown>; style?: Partial<CanvasItem['style']> };
/** A box of its own: w×h cells (the named size is worked out by the validation). */
const B = (x: number, y: number, w: number, h: number) => ({ zone: 'main' as const, x, y, size: 'm' as never, w, h });

// arranged by hand for portrait (8×12); the landscape boxes keep the same story on a 12×8 screen
const ITEMS: Raw[] = [
  { kind: 'clock.digital', pos: B(0, 0, 8, 4), portrait: B(0, 0, 8, 4), props: { showDate: false } },
  { kind: 'weather.now', pos: B(8, 0, 8, 4), portrait: B(8, 0, 8, 4), style: { scale: 1.1 } },
  { kind: 'meals.today', pos: B(0, 4, 16, 6), portrait: B(0, 4, 16, 6) },
  { kind: 'todo', pos: B(16, 0, 8, 12), portrait: B(0, 10, 8, 10), props: { maxRows: 12, showDone: true } },
  { kind: 'calendar.agenda', pos: B(0, 10, 8, 6), portrait: B(8, 10, 8, 6), props: { days: 1, sourceIds: ['c_fam', 'c_kids', 'c_bday', 'c_work'] }, style: { scale: 1.15 } },
  { kind: 'ha.gauge', pos: B(16, 12, 8, 4), portrait: B(0, 20, 8, 4), props: { entity: 'sensor.kitchen_timer', name: 'Oven timer', decimals: 0, min: 0, max: 45 }, style: { accent: '#7fd3ff' } },
  { kind: 'ha.light', pos: B(8, 10, 8, 4), portrait: B(8, 16, 8, 4), props: { entity: 'light.kitchen_island', name: 'Island strip' } },
  { kind: 'ha.light', pos: B(8, 14, 8, 2), portrait: B(8, 20, 8, 4), props: { entity: 'light.kitchen_pendants', name: 'Pendants', showState: false, row: 'brightness' } },
];

export const PORTRAIT_LAYOUT: { canvas: Partial<CanvasConfig>; items: Raw[]; orientation: 'portrait' } = {
  orientation: 'portrait',
  canvas: { background: 'photo', dim: 0.3, portraitAuto: false, touch: true },
  items: ITEMS,
};

/** The Home Assistant states of this screen by entity id. */
const STATES: Record<string, HaSlim> = {
  'light.kitchen_pendants': { d: 'light', on: true, bri: 80, ct: 2700, ctMin: 2200, ctMax: 6500, rgb: null, n: 'Pendants' },
  'light.kitchen_island': { d: 'light', on: true, bri: 65, ct: null, rgb: [175, 82, 222], col: true, n: 'Island strip' },
  'media_player.kitchen': { d: 'media', state: 'playing', title: 'Sunday Slow Cook', artist: 'Mara Lindqvist', vol: 0.28, art: true, source: 'Spotify', n: 'Kitchen speaker' },
  'sensor.kitchen_timer': { d: 'sensor', v: '18', num: 18, unit: 'min', dc: 'duration', min: 0, max: 45, step: 1, n: 'Kitchen timer' },
};

/**
 * The same states by alias (`cv_demo<index>:<slot>`, the ids mockCanvas.ts gives the items in order), for
 * mockHa.ts to use before its domain-order states when this screen is shown.
 */
export const PORTRAIT_HA: Record<string, HaSlim> = Object.fromEntries(
  ITEMS.flatMap((it, i) => {
    const e = (it.props as { entity?: string } | undefined)?.entity;
    return e && STATES[e] ? [[`cv_demo${String(i).padStart(4, '0')}:0`, STATES[e]]] : [];
  }),
);

/** The kitchen's shopping list (cfg.todo.items on this screen). */
export const PORTRAIT_TODO: TodoItem[] = [
  { id: 'p1', text: 'Oat milk', done: false },
  { id: 'p2', text: 'Eggs', done: false },
  { id: 'p4', text: 'Birthday candles', done: false },
  { id: 'p5', text: 'Lemons', done: false },
  { id: 'p7', text: 'Fresh basil', done: false },
  { id: 'p8', text: 'Dish soap', done: false },
  { id: 'p9', text: 'Bananas', done: false },
  { id: 'p10', text: 'Greek yoghurt', done: false },
  { id: 'p11', text: 'Olive oil', done: false },
  { id: 'p12', text: 'Paper towels', done: false },
  { id: 'p13', text: 'Cherry tomatoes', done: false },
  { id: 'p14', text: 'Parmesan', done: false },
];
