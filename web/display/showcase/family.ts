// Showcase screen "family": a warm family morning, in the light theme on a cream background. The children's faces with
// their stars, each child's routines with check-offs, the grown-ups' chores, rewards with progress, the week's meals,
// one birthdays card, the two next fun things to count down to, the clock and the weather.
//   ?demo=1&preset=canvas&lang=en&now=2026-10-27T07:40Z&shot=show.family
// The family is the demo's own (mock.ts mockFamily); the registry (index.ts) gives it the grown-ups' chores, the light
// theme, FAMILY_CHORES (each child's own routines, none of them twice) and FAMILY_COUNTDOWNS_FILTER, so the countdowns card never repeats the birthdays card.
// The clock and the weather share the top row with the faces: the weather is 4 cells wide, the shape its line of text
// fills (3x2 left a band under it). Each child's routines card has the text size that fills it with its ticked routine
// still shown (Mateo's has one more group, Sofía's one routine less), and the countdowns are set as large as the rewards
// and birthdays beside them.
// Colour, warm and varied on the cream: the clock on peach, the weather on a deep sky blue (white text), the countdowns
// on a pale butter and the birthdays on pink; the cards full of member colours (faces, routines, rewards, chores, meals)
// stay white so their own pills read.
import type { CanvasConfig, CanvasItem, ChoreSlot, CountdownsResponse } from '../../shared/types';

type Raw = { kind: CanvasItem['kind']; pos: CanvasItem['pos']; portrait?: CanvasItem['pos']; props?: Record<string, unknown>; style?: Partial<CanvasItem['style']> };
/** A box of its own: w×h cells (the named size is worked out by the validation). Same as B() in mockCanvas.ts. */
const B = (x: number, y: number, w: number, h: number) => ({ zone: 'main' as const, x, y, size: 'm' as never, w, h });

/** The layout, in the shape of mockCanvas.ts CANVAS_FIXTURES entries. */
export const SHOW_FAMILY: { canvas: Partial<CanvasConfig>; items: Raw[]; orientation?: 'portrait' | 'landscape' } = {
  canvas: { background: 'solid', color: '#f3e9dd' },
  items: [
    { kind: 'family.members', pos: B(0, 0, 10, 4), props: { memberIds: ['m_lucia', 'm_mateo', 'm_sofia'] } },
    { kind: 'clock.digital', pos: B(10, 0, 6, 4), style: { color: '#ffe2cf' } },
    { kind: 'weather.now', pos: B(16, 0, 8, 4), style: { scale: 1.3, color: '#2f74c9' } },
    { kind: 'family.routines', pos: B(0, 4, 6, 8), props: { memberId: 'm_lucia' }, style: { scale: 0.85 } },
    { kind: 'family.routines', pos: B(6, 4, 6, 8), props: { memberId: 'm_mateo' }, style: { scale: 0.8 } },
    { kind: 'family.routines', pos: B(12, 4, 6, 8), props: { memberId: 'm_sofia' }, style: { scale: 0.95 } },
    { kind: 'family.rewards', pos: B(18, 4, 6, 4), props: { max: 2 } },
    { kind: 'countdowns', pos: B(18, 8, 6, 4), props: { max: 2 }, style: { scale: 1.2, color: '#fbefc6' } },
    { kind: 'meals.week', pos: B(0, 12, 12, 4), props: { days: 5 } },
    { kind: 'family.chores', pos: B(12, 12, 6, 4), props: { memberIds: ['m_mama', 'm_papa', 'm_abuela'] }, style: { scale: 0.9 } },
    { kind: 'birthdays', pos: B(18, 12, 6, 4), props: { max: 3 }, style: { color: '#ffdbe6' } },
  ],
};

/** The countdowns card of this screen leaves the birthdays to the birthdays card: apply to mockCountdowns(). */
export function FAMILY_COUNTDOWNS_FILTER(r: CountdownsResponse): CountdownsResponse {
  return { ...r, items: r.items.filter((x) => x.origin !== 'birthday') };
}

/**
 * The family's routines on this screen, in place of the demo's own (where every child starts with brushing their teeth):
 * each child a different morning, no routine twice on the screen, and the same number per part of the day as the demo's
 * so the text sizes above still fill each card. The
 * stars of the routine each child has done this morning keep their totals where the rewards card shows each child a
 * different reward. [member, slot, emoji, title, stars]
 */
export const FAMILY_CHORES: [string, ChoreSlot, string, string, number][] = [
  ['m_lucia', 'morning', '🛏️', 'Make the bed', 1],
  ['m_lucia', 'morning', '🥣', 'Clear the breakfast', 2],
  ['m_lucia', 'afternoon', '📚', 'Homework', 3],
  ['m_lucia', 'evening', '🍽️', 'Set the table', 2],
  ['m_lucia', 'evening', '📖', 'Read for 20 minutes', 1],
  ['m_mateo', 'morning', '🎒', 'Pack the school bag', 1],
  ['m_mateo', 'morning', '👕', 'Get dressed', 2],
  ['m_mateo', 'afternoon', '🧺', 'Laundry in the basket', 1],
  ['m_mateo', 'evening', '🧸', 'Tidy up the toys', 2],
  ['m_mateo', 'any', '🐶', 'Walk Toby', 2],
  ['m_sofia', 'morning', '🐱', 'Feed Luna', 1],
  ['m_sofia', 'morning', '🥛', 'Cup to the sink', 1],
  ['m_sofia', 'afternoon', '🎹', 'Piano practice', 2],
  ['m_sofia', 'evening', '🪥', 'Brush teeth', 1],
  ['m_papa', 'evening', '🗑️', 'Take out the bins', 0],
  ['m_mama', 'afternoon', '🌱', 'Water the plants', 0],
  ['m_abuela', 'any', '📞', 'Call the grandkids', 0],
];
