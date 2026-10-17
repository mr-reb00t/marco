// Showcase screen "everyday": the classic family wall, made with Personalizado. The month is the hero; around it
// the clock with the date, the weather now and the next days, today's agenda, the next thing coming up and a note.
//   ?demo=1&preset=canvas&lang=en&now=2026-10-15T07:20Z&shot=show.everyday    (08:20 in the demo's Lisbon time)
// The integrator registers EVERYDAY under a show.* name (the family demo is in English only there) and puts
// EVERYDAY_MESSAGE in cfg.message for this screen.
import type { CanvasConfig, CanvasItem, MessageConfig } from '../../shared/types';

type Raw = { kind: CanvasItem['kind']; pos: CanvasItem['pos']; portrait?: CanvasItem['pos']; props?: Record<string, unknown>; style?: Partial<CanvasItem['style']> };
/** A box of its own: w×h cells (the named size is worked out by the validation). */
const B = (x: number, y: number, w: number, h: number) => ({ zone: 'main' as const, x, y, size: 'm' as never, w, h });
const S = (order: number, span: 2 | 3 | 4 | 'fill') => ({ zone: 'side' as const, order, span });
const GLASS = { surface: 'none' as const };

/** What the next-event card counts down to (the demo's beach-house bookings stay off this screen). */
const FAMILY = ['c_fam', 'c_kids', 'c_work', 'c_hol'];

const ITEMS: Raw[] = [
  { kind: 'clock.digital', pos: S(0, 2), style: GLASS },
  // no "feels like": in the demo it is the temperature again
  { kind: 'weather.now', pos: S(1, 2), props: { feelsLike: false }, style: GLASS },
  // the whole week down the sidebar, from today's sun to Wednesday's storm
  { kind: 'weather.forecast', pos: S(2, 'fill'), props: { days: 7, layout: 'column' }, style: GLASS },
  // the hero: four weeks with Mum's work in purple too (it fills the Mondays), the cards a touch smaller so a busy
  // day like today (Elena's birthday, the client call, the dentist, football) shows all four without taking turns
  {
    kind: 'calendar.month', pos: B(0, 0, 18, 16),
    props: { sourceIds: ['c_fam', 'c_kids', 'c_work', 'c_bday', 'c_hol'], eventStyle: 'cards', weeks: 4, maxEventsPerDay: 4 },
    style: { scale: 0.9 },
  },
  // today and tomorrow for the family in detail, without the birthdays (Elena's is on the month already) and without
  // the work call, which is the next thing coming up just under it
  { kind: 'calendar.agenda', pos: B(18, 0, 6, 6), props: { sourceIds: ['c_fam', 'c_kids', 'c_hol'], days: 2, compact: true } },
  { kind: 'calendar.next', pos: B(18, 6, 6, 4), props: { sourceIds: FAMILY, relative: true } },
  // the note reads from the left, beside its heart, like a note on the fridge
  { kind: 'message', pos: B(18, 10, 6, 6), props: { align: 'left' } },
];

export const EVERYDAY: { canvas: Partial<CanvasConfig>; items: Raw[] } = {
  canvas: { background: 'photo', dim: 0.3, sidebar: { side: 'left', size: 'narrow', fill: 'glass' } as never },
  items: ITEMS,
};

/** The note on the fridge (cfg.message on this screen). */
export const EVERYDAY_MESSAGE: MessageConfig = { enabled: true, text: 'Lunchboxes are in the fridge!', emoji: '💛' };
