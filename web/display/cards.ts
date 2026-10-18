// Pure helpers for the planner options of the month / week grid (no DOM, so the tests can load them with Node):
// - calendar.weeks = 'auto': how many week rows to show so each day fits calendar.maxEventsPerDay events;
// - calendar.eventStyle = 'cards': the size of each card (time on top, title below on up to two lines) and how a
//   day's cards are split into pages when they do not all fit.
import type { CalendarWeeks } from '../shared/types';
import { AUTO_WEEKS_MAX } from '../../server/core/bootstrap.js';

/** Automatic weeks: never fewer rows than this, nor more than AUTO_WEEKS_MAX (or the cap of the layout). */
export const AUTO_WEEKS_MIN = 2;
/** The same number decides how many weeks of events the display asks for (server/core/bootstrap.js). */
export { AUTO_WEEKS_MAX };
/** Rows shown before the grid has a size (the next render, once it is laid out, picks the real number). */
export const AUTO_WEEKS_FIRST = 4;

/**
 * Week rows for calendar.weeks = 'auto': as many rows of `rowNeed` px as fit in `areaH` px, between AUTO_WEEKS_MIN
 * and `max`. `rowNeed` is the height of the day number plus maxEventsPerDay events at a readable size.
 */
export function autoWeeks(areaH: number, rowNeed: number, max = AUTO_WEEKS_MAX): number {
  const hi = Math.max(AUTO_WEEKS_MIN, Math.min(AUTO_WEEKS_MAX, Math.floor(max) || AUTO_WEEKS_MAX));
  if (!(areaH > 0) || !(rowNeed > 0)) return Math.min(hi, AUTO_WEEKS_FIRST);
  return Math.max(AUTO_WEEKS_MIN, Math.min(hi, Math.floor((areaH + 0.5) / rowNeed)));
}

/**
 * Week rows to draw. A number (every screen saved before 'auto' existed) is used as it is, so those screens keep
 * exactly the rows they had; 'auto' goes through autoWeeks().
 */
export function resolveWeeks(weeks: CalendarWeeks, areaH: number, rowNeed: number, max = AUTO_WEEKS_MAX): number {
  if (weeks === 'auto') return autoWeeks(areaH, rowNeed, max);
  return weeks;
}

/** Weeks of events to fetch: the configured number, or the most 'auto' can show. */
export function rangeWeeks(weeks: CalendarWeeks): number {
  return weeks === 'auto' ? AUTO_WEEKS_MAX : weeks;
}

/** Card sizes in px (calendar.ts reads them from the CSS variables, so what is planned is what shows). */
export interface CardMetrics {
  /** padding above and below the text */
  pad: number;
  /** height of the time line (timed events only) */
  timeH: number;
  /** height of one title line */
  lineH: number;
  /** space between two cards */
  gap: number;
  /** top plus bottom border width of a card (the browser draws it outside the padding) */
  border: number;
}

/** Card border (top plus bottom, px) assumed until a drawn card can be measured. */
export const CARD_BORDER_PX = 2;

/** Card text sizes as a share of the chip font (--chip-fs), line heights in that font, spacing in display units. */
export const CARD_TITLE_FONT = 0.94;
export const CARD_TIME_FONT = 0.8;
export const CARD_TITLE_LINE = 1.2;
export const CARD_TIME_LINE = 1.3;
export const CARD_PAD_U = 0.4;
export const CARD_GAP_U = 0.38;
/** Most title lines a card shows (longer titles are cut, or scroll up when calendar.marquee is on). */
export const CARD_MAX_LINES = 2;

/** Height (px) of a card whose title takes `lines` lines; `timed` adds the time line on top. */
export function cardHeight(lines: number, timed: boolean, m: CardMetrics): number {
  const n = Math.max(1, Math.min(CARD_MAX_LINES, Math.round(lines) || 1));
  return 2 * m.pad + m.border + (timed ? m.timeH : 0) + n * m.lineH;
}

/** Title lines (1..CARD_MAX_LINES) for a title `textW` px wide in a card `innerW` px wide (word wrap wastes a bit). */
export function titleLines(textW: number, innerW: number): number {
  if (!(innerW > 0) || !(textW > 0)) return 1;
  return Math.max(1, Math.min(CARD_MAX_LINES, Math.ceil((textW * 1.06) / innerW)));
}

/**
 * Height (px) one week row needs to show `perDay` cards per day, for 'auto' weeks: the day number, then cards with
 * a time line and a title of one and a quarter lines on average (some titles take two).
 */
export function cardRowNeed(numH: number, rowGap: number, perDay: number, m: CardMetrics): number {
  const card = 2 * m.pad + m.border + m.timeH + 1.25 * m.lineH;
  return numH + rowGap + Math.max(1, perDay) * (card + m.gap) + m.pad;
}

/** Height (px) one week row needs to show `perDay` one-line chips per day (eventStyle 'lines', for 'auto' weeks). */
export function lineRowNeed(numH: number, laneH: number, gap: number, perDay: number): number {
  return numH + gap + Math.max(1, perDay) * (laneH + gap);
}

/**
 * Split a day's cards (their heights, in order) into pages that each fit in `space` px, cards `gap` px apart.
 * Every page takes as many cards as fit; a card taller than the space still gets a page of its own (it is cut).
 * Returns the indexes of the cards on each page; a single page means everything fits.
 */
export function planCardPages(heights: number[], space: number, gap: number): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  heights.forEach((h, i) => {
    const need = cur.length ? used + gap + h : h;
    if (cur.length && need > space + 0.5) {
      pages.push(cur);
      cur = [i];
      used = h;
      return;
    }
    cur.push(i);
    used = need;
  });
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

/**
 * How a day shows its cards: everything (one page), pages that take turns (calendar.rotateBusyDays), or the first
 * page and "+N" for the rest.
 */
export function planDayCards(heights: number[], space: number, gap: number, rotate: boolean): { pages: number[][]; more: number } {
  const pages = planCardPages(heights, space, gap);
  if (pages.length <= 1 || rotate) return { pages, more: 0 };
  return { pages: [pages[0]], more: heights.length - pages[0].length };
}

/**
 * Lanes for the bars of a week in the cards style (multi-day events; one-day events are cards): at most `max`,
 * leaving room for at least one card under them. `rowH` px row, `numH` px day number, `laneH` px lane, `gap` px.
 */
export function barLanesFor(rowH: number, numH: number, laneH: number, gap: number, minCard: number, max = 4): number {
  const room = rowH - numH - gap - minCard - gap;
  return Math.max(1, Math.min(max, Math.floor(room / (laneH + gap))));
}
