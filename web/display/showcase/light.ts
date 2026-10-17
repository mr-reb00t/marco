// Showcase screen "light": a calm home office and kitchen screen on the light theme. The time and the weather on top
// (both 4 wide, on the same columns as the cards under them), the week ahead and the to-do list; under them the office
// thermostat heating and the kitchen blind half open; down the right the desk lamp lit warm (its brightness) and the
// kitchen shelf in purple (its colours). Soft tints (sky blue weather, butter to-do, warm thermostat) give the white
// cards some colour without leaving the light look.
//   ?demo=1&preset=canvas&lang=en&now=2026-10-15T08:40Z&shot=show.light   (the screen shows Lisbon: 09:40)
// Each value is printed once: the clock leaves out the date (the week view has it), the weather leaves out "feels
// like" (it equals the temperature this morning), the blind and the desk lamp hide their state line (the shutter and
// the brightness slider carry the percentage). The to-do list is 4x4, past the card's named sizes, so it grows to fill
// its box. The demo gives the Home Assistant cards their states by domain order; LIGHT_HA has the states this screen
// wants (by alias, as mockHa.ts sees them) and LIGHT_TODO the to-do list (cfg.todo.items).
import type { CanvasConfig, CanvasItem, HaSlim, TodoItem } from '../../shared/types';

type Raw = { kind: CanvasItem['kind']; pos: CanvasItem['pos']; portrait?: CanvasItem['pos']; props?: Record<string, unknown>; style?: Partial<CanvasItem['style']> };
/** A box of its own: w×h cells (the named size is worked out by the validation). */
const B = (x: number, y: number, w: number, h: number) => ({ zone: 'main' as const, x, y, size: 'm' as never, w, h });

/** Every demo calendar but the beach house rental (its stays run across the week as long bars). */
const CALENDARS = ['c_fam', 'c_kids', 'c_bday', 'c_hol', 'c_work'];

const ITEMS: Raw[] = [
  { kind: 'clock.digital', pos: B(0, 0, 8, 4), props: { showDate: false } },
  { kind: 'weather.now', pos: B(8, 0, 8, 4), props: { feelsLike: false }, style: { color: '#e4efff' } },
  { kind: 'todo', pos: B(16, 0, 8, 8), props: { maxRows: 7, showDone: true }, style: { color: '#fff5d9' } },
  { kind: 'calendar.week', pos: B(0, 4, 16, 6), props: { sourceIds: CALENDARS } },
  { kind: 'ha.climate', pos: B(0, 10, 8, 6), props: { entity: 'climate.office', name: 'Office' }, style: { color: '#fff0e4' } },
  { kind: 'ha.cover', pos: B(8, 10, 8, 6), props: { entity: 'cover.kitchen_blind', name: 'Kitchen blind', showState: false } },
  { kind: 'ha.light', pos: B(16, 8, 8, 4), props: { entity: 'light.desk_lamp', name: 'Desk lamp', showState: false, row: 'brightness' }, style: { scale: 1.25 } },
  { kind: 'ha.light', pos: B(16, 12, 8, 4), props: { entity: 'light.kitchen_shelf', name: 'Kitchen shelf' } },
];

export const SHOW_LIGHT: { canvas: Partial<CanvasConfig>; items: Raw[] } = {
  canvas: { background: 'solid', color: '#f3f0ea', touch: true },
  items: ITEMS,
};

/** The Home Assistant states of this screen by entity id. */
const STATES: Record<string, HaSlim> = {
  'climate.office': {
    d: 'climate', mode: 'heat', modes: ['off', 'heat', 'auto'], action: 'heating', cur: 20.5, target: 21.5, lo: null, hi: null,
    min: 7, max: 30, step: 0.5, unit: 'C', hum: 46, n: 'Office',
  },
  'light.desk_lamp': { d: 'light', on: true, bri: 80, ct: 2900, ctMin: 2200, ctMax: 6500, rgb: null, n: 'Desk lamp' },
  'light.kitchen_shelf': { d: 'light', on: true, bri: 65, ct: null, rgb: [175, 82, 222], col: true, n: 'Kitchen shelf' },
  'cover.kitchen_blind': { d: 'cover', state: 'open', pos: 50, readOnly: false, n: 'Blind' },
};

/**
 * The same states by alias (`cv_demo<index>:<slot>`, the ids mockCanvas.ts gives the items in order), for
 * mockHa.ts to use before its domain-order states when this screen is shown.
 */
export const LIGHT_HA: Record<string, HaSlim> = Object.fromEntries(
  ITEMS.flatMap((it, i) => {
    const e = (it.props as { entity?: string } | undefined)?.entity;
    return e && STATES[e] ? [[`cv_demo${String(i).padStart(4, '0')}:0`, STATES[e]]] : [];
  }),
);

/** The to-do list of this screen (cfg.todo.items). */
export const LIGHT_TODO: TodoItem[] = [
  { id: 'l1', text: 'Send the Hartley invoice', done: false },
  { id: 'l2', text: 'Book the boiler service', done: false },
  { id: 'l3', text: 'Order coffee beans', done: true },
  { id: 'l4', text: 'Return the library books', done: false },
  { id: 'l6', text: 'Renew the car insurance', done: false },
  { id: 'l7', text: 'Water the herbs', done: false },
  { id: 'l8', text: 'Call Mum about Sunday', done: false },
];

export default SHOW_LIGHT;
