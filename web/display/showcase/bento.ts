// Showcase screen "bento" (website and video): boxes of many shapes, each one filled, to show that a Personalizado
// card takes any w×h within its kind's range: a square clock with the date (3×3), a wide photo (6×4), a tall to-do
// list (3×6), three one-line Casa cards (3×1: the front door, motion in the hallway, a lamp on), the heating and the
// next two events (3×2), a news band (8×2) and a speaker playing (4×2). Grey cards on black, like phone widgets, with
// three of them in a deep colour of their own (the to-do list green, the next events indigo, the speaker plum, next to
// its cover) and the clock's second hand in the heating's orange, so the screen is not all grey.
// The motion in the hallway in a soft blue, not the default amber of an alert. The photo is a red canyon at golden hour
// (SHOW_BENTO_PHOTO, from the demo's own stock photos), warm like the evening the screen shows.
// Touch on, so the heating shows its - and + and the speaker its pause button.
//   ?demo=1&preset=canvas&lang=en&now=2026-10-15T17:42Z&shot=show.bento   (18:42 in the demo's Lisbon time)
// It needs a name starting with "show." (mockHa.ts gives the speaker its cover only there) and SHOW_BENTO_TODO as the
// demo's to-do items.
import type { CanvasConfig, CanvasItem } from '../../shared/types';

type Raw = { kind: CanvasItem['kind']; pos: CanvasItem['pos']; portrait?: CanvasItem['pos']; props?: Record<string, unknown>; style?: Partial<CanvasItem['style']> };
type Fixture = { canvas: Partial<CanvasConfig>; items: Raw[]; orientation?: 'portrait' | 'landscape' };

/** A box of its own: w×h cells (the named size is worked out by the validation). */
const B = (x: number, y: number, w: number, h: number) => ({ zone: 'main' as const, x, y, size: 'm' as never, w, h });

export const SHOW_BENTO: Fixture = {
  canvas: { background: 'solid', color: '#000000', touch: true },
  items: [
    { kind: 'clock.analog', pos: B(0, 0, 6, 6), props: { showDate: true }, style: { accent: '#ff9f0a' } },
    { kind: 'photo', pos: B(6, 0, 12, 8), props: { fit: 'cover' } },
    { kind: 'todo', pos: B(18, 0, 6, 12), props: { maxRows: 8 }, style: { surface: 'solid', color: '#123a2a', accent: '#4cd98a' } },
    // one-line cards (the demo states go by domain and order: the first binary sensor is a closed door, the second
    // motion detected; the first light is on at 70 % in a warm white; the first thermostat is heating)
    { kind: 'ha.sensor', pos: B(0, 6, 6, 2), props: { entity: 'binary_sensor.front_door', name: 'Front door' } },
    { kind: 'ha.sensor', pos: B(0, 8, 6, 2), props: { entity: 'binary_sensor.hallway_motion', name: 'Hallway' }, style: { accent: '#8ab4ff' } },
    { kind: 'ha.light', pos: B(0, 10, 6, 2), props: { entity: 'light.sofa_lamp', name: 'Sofa lamp' } },
    { kind: 'ha.climate', pos: B(6, 8, 6, 4), props: { entity: 'climate.living_room', name: 'Living room' } },
    // the next two events without the birthdays (football practice now, the school trip tomorrow)
    { kind: 'calendar.next', pos: B(12, 8, 6, 4), props: { count: 2, sourceIds: ['c_fam', 'c_kids', 'c_hol', 'c_work'] }, style: { surface: 'solid', color: '#2c2a6b', accent: '#ffb340' } },
    // a touch under 100 %: grown to its box the headline would otherwise end a pixel short and show an ellipsis
    { kind: 'news', pos: B(0, 12, 16, 4), style: { scale: 0.96 } },
    { kind: 'ha.media', pos: B(16, 12, 8, 4), props: { entity: 'media_player.kitchen', name: 'Kitchen speaker' }, style: { surface: 'solid', color: '#4a1f2c', accent: '#f4a261' } },
  ],
};

/** The photo card's picture: the demo's red canyon at golden hour (Picsum, first in mockPhotos() on this screen). */
export const SHOW_BENTO_PHOTO = { url: 'https://picsum.photos/id/1016/1920/1080', author: 'Philippe Wuyts' };

/**
 * The to-do list of this screen (the demo's own has three items, too few for a tall box): the integrator puts these in
 * cfg.todo.items when &shot is this screen.
 */
export const SHOW_BENTO_TODO = [
  { id: 'bt1', text: 'Pick up the dry cleaning', done: false },
  { id: 'bt2', text: 'Pay the swim club fees', done: false },
  { id: 'bt3', text: 'Call the plumber', done: true },
  { id: 'bt4', text: 'Order the birthday cake', done: false },
  { id: 'bt5', text: 'Return library books', done: false },
  { id: 'bt6', text: 'Book the car service', done: false },
  { id: 'bt7', text: 'Water the tomatoes', done: true },
  { id: 'bt8', text: 'Make up the guest room', done: false },
];
