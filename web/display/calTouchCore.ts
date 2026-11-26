// Touch on the calendar grids (#51, phase 1): the pure part. Where a grid moved by touch starts and how many rows it
// shows, the range of events it needs, its heading, and the text of the read-only sheets (one event, one day). No DOM
// and no fetches, so the tests load it in Node (server/test/display-touch.test.js); calTouch.ts draws it.
import type { DateFormat, Lang } from '../shared/types';
import { addDays, diffDays, formatDateLine, gridStartOf, monthName, startOfWeek, t } from '../shared/i18n';
import { type NEvent, sortForDay, timeLabel } from './eventModel';

/** Without a touch for this long, an open sheet closes and a moved calendar goes back to today. */
export const TOUCH_IDLE_MS = 2 * 60_000;
/** How far a calendar may be moved (the server answers /api/events for about a year back and two ahead). */
export const NAV_BACK_DAYS = 365;
export const NAV_AHEAD_DAYS = 730;

/** A grid of four or more week rows (the month view) moves by month; a week, two weeks or three by what it shows. */
export type NavKind = 'month' | 'span';

export function navKind(isWeek: boolean, nWeeks: number): NavKind {
  return !isWeek && nWeeks >= 4 ? 'month' : 'span';
}

/** The first day of the month `n` months after the month of `key`. */
export function monthStart(key: string, n = 0): string {
  const y = +key.slice(0, 4);
  const m = +key.slice(5, 7) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}

/** Week rows from the week of the 1st to the week of the last day of the month starting `first`. */
export function weeksOfMonth(first: string, weekStart = 1): number {
  const last = addDays(monthStart(first, 1), -1);
  return Math.ceil((diffDays(startOfWeek(first, weekStart), last) + 1) / 7);
}

export interface NavGrid {
  /** first day of the grid */
  start: string;
  /** week rows */
  weeks: number;
  /** the month a month grid shows (its 1st), '' for a span */
  month: string;
}

export interface NavOpts {
  kind: NavKind;
  /** the rows the grid shows on today */
  weeks: number;
  weekStart: number;
  startOn: 'week' | 'today';
}

/**
 * The grid `off` steps away from today (0 = today, as the screen always shows it): a month grid starts on the week of
 * that month's 1st with enough rows for the whole month (at most 6, never fewer than it has), a span grid moves by
 * the days it shows.
 */
export function navGrid(today: string, off: number, o: NavOpts): NavGrid {
  const home = gridStartOf(today, o.weekStart, o.startOn);
  if (o.kind === 'month') {
    const month = monthStart(today, off);
    if (!off) return { start: home, weeks: o.weeks, month };
    return { start: startOfWeek(month, o.weekStart), weeks: Math.min(6, Math.max(o.weeks, weeksOfMonth(month, o.weekStart))), month };
  }
  return { start: addDays(home, off * o.weeks * 7), weeks: o.weeks, month: '' };
}

/** The grid `off` steps away stays inside what the server can answer. */
export function navAllowed(today: string, off: number, o: NavOpts): boolean {
  if (!off) return true;
  const g = navGrid(today, off, o);
  return diffDays(today, g.start) >= -NAV_BACK_DAYS && diffDays(today, addDays(g.start, g.weeks * 7)) <= NAV_AHEAD_DAYS;
}

/** The events range a grid needs (/api/events?from=&to=, the same padding as core/bootstrap.js eventsWindow). */
export function navRange(g: NavGrid): [string, string] {
  return [g.start, addDays(g.start, g.weeks * 7 + 1)];
}

const escH = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** "23–29 Nov" / "30 Nov – 6 Dec" (the year goes apart, or on both ends when it changes). */
export function spanLabel(lang: Lang, from: string, to: string): string {
  const d = (k: string) => String(+k.slice(8, 10));
  const mo = (k: string) => monthName(lang, +k.slice(5, 7), 'short');
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${d(from)} ${mo(from)} ${from.slice(0, 4)} – ${d(to)} ${mo(to)} ${to.slice(0, 4)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${d(from)}–${d(to)} ${mo(to)}`;
  return `${d(from)} ${mo(from)} – ${d(to)} ${mo(to)}`;
}

/** The heading of a moved grid (HTML): the month and year, or the days it shows and the year. */
export function navTitle(lang: Lang, g: NavGrid, lastDay: string): string {
  if (g.month) return `<b>${escH(monthName(lang, +g.month.slice(5, 7)))}</b> <span>${g.month.slice(0, 4)}</span>`;
  if (g.start.slice(0, 4) !== lastDay.slice(0, 4)) return `<b>${escH(spanLabel(lang, g.start, lastDay))}</b>`;
  return `<b>${escH(spanLabel(lang, g.start, lastDay))}</b> <span>${g.start.slice(0, 4)}</span>`;
}

/**
 * A description as plain text: calendars often send HTML (line breaks, paragraphs, links), so the tags go and the
 * line breaks stay; the result is escaped where it is drawn.
 */
export function plainText(s: string): string {
  let x = String(s ?? '').replace(/\r\n?/g, '\n');
  if (/<\/?(?:br|p|div|a|b|i|u|span|ul|ol|li|strong|em|html|body|font|h\d)\b[^>]*>/i.test(x)) {
    x = x
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h\d)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }
  return x.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface SheetOpts {
  lang: Lang;
  tz: string;
  today: string;
  format24: boolean;
  showAmPm: boolean;
  dateFormat?: DateFormat;
  customDate?: string;
  /** the screen is private now: no place or notes, whatever the calendar */
  privateNow?: boolean;
  /** the calendar's name and emoji by source id */
  sourceName?: (id: string) => string;
}

const YEAR_FORMATS = new Set(['weekday_month_d_y', 'weekday_mdy', 'weekday_dmy', 'weekday_iso', 'custom']);

/** A day as the screen writes dates (its own date format), with the year when it is not this year's. */
export function dayLine(key: string, o: SheetOpts): string {
  const f = o.dateFormat ?? 'weekday_d_month';
  const s = formatDateLine(o.lang, key, f, o.customDate ?? '');
  return key.slice(0, 4) !== o.today.slice(0, 4) && !YEAR_FORMATS.has(f) ? `${s} ${key.slice(0, 4)}` : s;
}

/** When the event is, as lines: the day(s), then the time range or "All day". */
export function eventWhen(e: NEvent, o: SheetOpts): string[] {
  const time = (ms: number) => timeLabel({ ...e, allDay: false, startMs: ms, endMs: ms }, o.tz, o.format24, o.showAmPm, false);
  if (e.allDay) {
    const all = t(o.lang, 'allDay');
    // a rental stay runs from the check-in day to the check-out day, as the grid draws it
    const last = e.airbnb && !e.checkoutMarker ? e.spanLast : e.lastKey;
    if (e.startKey === last) return [dayLine(e.startKey, o), all];
    return [`${dayLine(e.startKey, o)} – ${dayLine(last, o)}`, all];
  }
  if (e.startKey === e.lastKey) {
    return [dayLine(e.startKey, o), timeLabel(e, o.tz, o.format24, o.showAmPm, true).replace('–', ' – ')];
  }
  return [`${dayLine(e.startKey, o)}, ${time(e.startMs)} –`, `${dayLine(e.lastKey, o)}, ${time(e.endMs)}`];
}

/** The event may show its place and notes (not a "Busy" block, not while the screen is private). */
export function showsDetail(e: NEvent, o: Pick<SheetOpts, 'privateNow'>): boolean {
  return !e.ev.busy && !o.privateNow;
}

const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.6A2.6 2.6 0 1 1 12 6.4a2.6 2.6 0 0 1 0 5.2Z"/></svg>';

/** The body of an event's sheet (HTML; every text escaped). `color` is the calendar colour as "r g b". */
export function eventSheetHtml(e: NEvent, color: string, o: SheetOpts): string {
  const detail = showsDetail(e, o);
  const em = e.emoji ? `<span class="em">${escH(e.emoji)}</span>` : '';
  let html = `<div class="cs-ev" style="--c:${color}"><h2 class="cs-title">${em}<span class="cs-tt">${escH(e.title)}</span></h2>`;
  html += `<div class="cs-when">${eventWhen(e, o).map((l) => `<div>${escH(l)}</div>`).join('')}</div>`;
  const name = !e.ev.busy && o.sourceName ? o.sourceName(e.ev.sourceId) : '';
  html += `<div class="cs-cal"><i></i>${name ? `<span>${escH(name)}</span>` : ''}</div>`;
  if (detail && e.ev.location) {
    html += `<div class="cs-loc" aria-label="${escH(t(o.lang, 'touchLocation'))}">${PIN}<span>${escH(e.ev.location)}</span></div>`;
  }
  const notes = detail && e.ev.description ? plainText(e.ev.description) : '';
  if (notes) html += `<div class="cs-desc">${escH(notes)}</div>`;
  return `${html}</div>`;
}

/** The events of one day as the grid lays them out (bars first, then by time). */
export function eventsOfDay(list: NEvent[], key: string): NEvent[] {
  return list.filter((e) => e.spanFirst <= key && e.spanLast >= key).sort(sortForDay);
}

/** The body of a day's sheet: the date, then one row per event (`data-eid` opens it). */
export function daySheetHtml(key: string, list: NEvent[], colorOf: (e: NEvent) => string, o: SheetOpts): string {
  const rows = eventsOfDay(list, key).map((e) => {
    const tm = e.timed ? timeLabel(e, o.tz, o.format24, o.showAmPm, true).replace('–', ' – ') : t(o.lang, 'allDay');
    const em = e.emoji ? `<span class="em">${escH(e.emoji)}</span>` : '';
    return `<button type="button" class="cs-row" data-eid="${escH(e.id)}" style="--c:${colorOf(e)}"><i></i>${em}<span class="cs-rt">${escH(e.title)}</span><span class="cs-rm">${escH(tm)}</span></button>`;
  });
  const body = rows.length ? `<div class="cs-list">${rows.join('')}</div>` : `<p class="cs-none">${escH(t(o.lang, 'nothingPlanned'))}</p>`;
  return `<div class="cs-day"><h2 class="cs-title">${escH(dayLine(key, o))}</h2>${body}</div>`;
}
