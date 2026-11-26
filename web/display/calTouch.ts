// Touch on the calendars (#51; screen.touch, off by default). The grids (widgets/calendar.ts MonthCalendar) mark what
// can be tapped and move by month or by what they show; the lists (agenda, Today, Per person, Board, the highlights
// pills, next events, countdowns and birthdays) are tap zones (tapZone below) that mark their rows while touch is on.
// This module draws the read-only sheets (one event, the events of a day, one countdown), the pressed look, and the
// idle rule: after TOUCH_IDLE_MS without a touch
// the sheet closes and every moved grid goes back to today. While a sheet is open or a grid is away from today, the
// carousel holds the screen (main.ts, host.hold). Taps go through taps.ts isTap(), so a swipe never opens anything.
// The pure part (dates, ranges, sheet text) is calTouchCore.ts.
import type { CalEvent, CountdownItem, DisplayConfig } from '../shared/types';
import { chipColors } from './color';
import { ctx } from './ctx';
import { esc } from './dom';
import type { NEvent } from './eventModel';
import { countdownSheetHtml, daySheetHtml, eventSheetHtml, type SheetOpts, TOUCH_IDLE_MS } from './calTouchCore';
import { isTap } from './taps';

export interface CalTouchHost {
  /** the events of [from, to] of the screen on display; null when they could not be read */
  load(from: string, to: string): Promise<CalEvent[] | null>;
  /** a sheet is open or a grid is away from today (true): hold the carousel; false: let it go on */
  hold(on: boolean): void;
  /** changes when the screen's events change, so the ranges read before are asked for again */
  gen(): string;
  /** this tap only wakes a dimmed screen (night mode): it does nothing else */
  wakes(): boolean;
}

let host: CalTouchHost | null = null;
export function setCalTouchHost(h: CalTouchHost | null): void {
  host = h;
}

/** Touch is on for this screen's calendars (screen.touch). */
export function calTouchOn(cfg: DisplayConfig | null | undefined = ctx.cfg): boolean {
  return cfg?.screen?.touch === true;
}

/** True when the tap only woke the screen. */
export function calTouchWakes(): boolean {
  return !!host?.wakes();
}

// ------------------------------------------------------------------------------------------------ grids and idle
export interface CalTouchMember {
  /** away from today */
  away(): boolean;
  /** back to today */
  home(): void;
}
const members = new Set<CalTouchMember>();

export function calTouchJoin(m: CalTouchMember): () => void {
  members.add(m);
  return () => {
    members.delete(m);
    changed();
  };
}

/** ?touchIdle=<ms> (tests) shortens the idle time. */
function idleMs(): number {
  const v = Number(ctx.params.get('touchIdle'));
  return Number.isFinite(v) && v >= 200 ? v : TOUCH_IDLE_MS;
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let held = false;

function active(): boolean {
  return sheetOpen() || Array.from(members).some((m) => m.away());
}

function arm(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = active() ? setTimeout(() => calTouchReset(), idleMs()) : null;
}

/** A sheet opened or closed, a grid moved: the carousel holds or goes on, the idle time starts again. */
export function changed(): void {
  const on = active();
  if (on !== held) {
    held = on;
    host?.hold(on);
  }
  arm();
}

/** Close the sheet and take every grid back to today (the idle time passed, another screen came on). */
export function calTouchReset(): void {
  closeSheet(false);
  for (const m of Array.from(members)) if (m.away()) m.home();
  changed();
}

/**
 * A new config: with touch off (or the screen gone private) an open sheet closes; a moved grid goes back to today on
 * its next draw (MonthCalendar.syncTouch), which lets the carousel go on.
 */
export function calTouchSync(cfg: DisplayConfig): void {
  if (sheetOpen() && (!calTouchOn(cfg) || cfg.privacy?.active)) closeSheet();
}

// ------------------------------------------------------------------------------------------------ event ranges
interface Range {
  gen: string;
  evs: CalEvent[] | null;
  loading: boolean;
}
const ranges = new Map<string, Range>();

/**
 * The events of [from, to] for a moved grid: what was read before (null while the first answer is on its way), asked
 * for again when the screen's events changed. `ready` runs when an answer comes.
 */
export function rangeEvents(from: string, to: string, ready: () => void): CalEvent[] | null {
  const key = `${from}/${to}`;
  const gen = host?.gen() ?? '';
  let r = ranges.get(key);
  if (r && (r.gen === gen || r.loading)) return r.evs;
  if (!host) return r?.evs ?? null;
  r = { gen, evs: r?.evs ?? null, loading: true };
  ranges.delete(key);
  ranges.set(key, r);
  while (ranges.size > 12) ranges.delete(ranges.keys().next().value as string);
  const entry = r;
  host.load(from, to).then((evs) => {
    entry.loading = false;
    if (evs) entry.evs = evs;
    else entry.gen = ''; // try again on the next draw
    ready();
  }, () => {
    entry.loading = false;
    entry.gen = '';
  });
  return r.evs;
}

// ------------------------------------------------------------------------------------------------ the sheet
let sheet: HTMLElement | null = null;
/** what the sheet shows: an event (from a day's list or not), or a day */
let shown:
  | { kind: 'event'; e: NEvent; day: { key: string; list: NEvent[] } | null }
  | { kind: 'day'; key: string; list: NEvent[] }
  | { kind: 'cd'; item: CountdownItem; days: number; color: string }
  | null = null;

export function sheetOpen(): boolean {
  return !!sheet?.classList.contains('show');
}

function sheetOpts(today: string): SheetOpts {
  const cfg = ctx.cfg;
  const sources = new Map((cfg.calendar?.sources ?? []).map((s) => [s.id, s]));
  return {
    lang: ctx.lang, tz: ctx.tz, today, format24: cfg.datetime.format24, showAmPm: cfg.datetime.showAmPm,
    dateFormat: cfg.datetime.dateFormat, customDate: cfg.datetime.dateCustom ?? '',
    privateNow: !!cfg.privacy?.active,
    sourceName: (id) => {
      const s = sources.get(id);
      return s ? `${s.emoji ? `${s.emoji} ` : ''}${s.name}` : '';
    },
  };
}

const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

function ensureSheet(): HTMLElement {
  if (sheet) return sheet;
  const el = document.createElement('div');
  el.id = 'cal-sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="cs-card"><div class="cs-top"><button type="button" class="cs-back" hidden>${BACK}</button>`
    + `<button type="button" class="cs-close">${CLOSE}</button></div><div class="cs-body"></div></div>`;
  el.addEventListener('pointerup', onSheetUp);
  document.body.appendChild(el);
  sheet = el;
  return el;
}

function paint(today: string): void {
  const el = ensureSheet();
  const o = sheetOpts(today);
  const body = el.querySelector('.cs-body') as HTMLElement;
  const back = el.querySelector('.cs-back') as HTMLButtonElement;
  const close = el.querySelector('.cs-close') as HTMLButtonElement;
  close.setAttribute('aria-label', ctx.t('touchClose'));
  back.setAttribute('aria-label', ctx.t('touchBack'));
  if (!shown) return;
  if (shown.kind === 'event') {
    body.innerHTML = eventSheetHtml(shown.e, chipColors(shown.e.color).base, o);
    back.hidden = !shown.day;
  } else if (shown.kind === 'day') {
    body.innerHTML = daySheetHtml(shown.key, shown.list, (e) => chipColors(e.color).base, o);
    back.hidden = true;
  } else {
    body.innerHTML = countdownSheetHtml(shown.item, shown.days, chipColors(shown.color).base, o);
    back.hidden = true;
  }
  body.scrollTop = 0;
  el.classList.add('show');
}

let sheetToday = '';

/** Open an event's sheet (`day`: the day list it was opened from, for the back button). */
export function showEvent(e: NEvent, today: string, day: { key: string; list: NEvent[] } | null = null): void {
  shown = { kind: 'event', e, day };
  sheetToday = today;
  paint(today);
  changed();
}

/** Open the list of a day's events. */
export function showDay(key: string, list: NEvent[], today: string): void {
  shown = { kind: 'day', key, list };
  sheetToday = today;
  paint(today);
  changed();
}

/** Open a countdown (or a birthday of the countdowns list): `color` is the chip's colour as drawn. */
export function showCountdown(item: CountdownItem, days: number, color: string, today: string): void {
  shown = { kind: 'cd', item, days, color };
  sheetToday = today;
  paint(today);
  changed();
}

export function closeSheet(notify = true): void {
  shown = null;
  if (sheet?.classList.contains('show')) {
    sheet.classList.remove('show');
    (sheet.querySelector('.cs-body') as HTMLElement).innerHTML = '';
  }
  if (notify) changed();
}

function onSheetUp(e: PointerEvent): void {
  if (!sheet || !isTap(e) || (e.pointerType === 'mouse' && e.button > 0)) return;
  const t = e.target as Element | null;
  if (!t) return;
  if (t.closest('.cs-close') || t === sheet) {
    closeSheet();
    return;
  }
  if (t.closest('.cs-back') && shown?.kind === 'event' && shown.day) {
    showDay(shown.day.key, shown.day.list, sheetToday);
    return;
  }
  const row = t.closest<HTMLElement>('.cs-row');
  if (row && shown?.kind === 'day') {
    const ev = shown.list.find((x) => x.id === row.dataset.eid);
    if (ev) showEvent(ev, sheetToday, { key: shown.key, list: shown.list });
  }
}

// ------------------------------------------------------------------------------------------------ tap zones
/** What a tap zone's marked rows open: its events (data-eid, data-tday) and its countdowns (data-tcd). */
export interface TapSource {
  /** today as the zone drew it */
  today: string;
  events?: NEvent[];
  /** the countdowns it drew, by `cdKey()` */
  cds?: { item: CountdownItem; days: number; color: string }[];
}
const zones = new WeakMap<HTMLElement, TapSource>();

/** The data-tcd of a countdown. */
export const cdKey = (item: CountdownItem): string => `${item.id}|${item.date}`;

/** ` data-eid="…"` on an event drawn as HTML while `on` (nothing otherwise). */
export function eidAttr(e: NEvent, on: boolean): string {
  return on ? ` data-eid="${esc(e.id)}"` : '';
}

/** ` data-tday="…"` on a day heading drawn as HTML while `on`. */
export function tdayAttr(key: string, on: boolean): string {
  return on && /^\d{4}-\d{2}-\d{2}$/.test(key) ? ` data-tday="${key}"` : '';
}

/**
 * A list that opens what it shows while touch is on: `root` gets the class `tap-zone` and one pointerup listener, and
 * `src` says what its marked rows are. With `on` false (touch off, the night view) the class and the listener go, so
 * nothing of it is left. Returns `on`, for the renderer to mark its rows with.
 */
export function tapZone(root: HTMLElement, on: boolean, src?: TapSource): boolean {
  if (on && src) {
    zones.set(root, src);
    if (!root.classList.contains('tap-zone')) {
      root.classList.add('tap-zone');
      root.addEventListener('pointerup', onZoneUp);
    }
    return true;
  }
  if (zones.has(root) || root.classList.contains('tap-zone')) {
    zones.delete(root);
    root.classList.remove('tap-zone');
    root.removeEventListener('pointerup', onZoneUp);
  }
  return false;
}

/** Rows a list hid because they did not fit: never opened. */
const HIDDEN = '.fit-hide, .cv-fit-hide, .cvm-hide';

function onZoneUp(e: PointerEvent): void {
  const root = e.currentTarget as HTMLElement;
  const src = zones.get(root);
  if (!src || !calTouchOn() || !isTap(e) || (e.pointerType === 'mouse' && e.button > 0)) return;
  const t = e.target as Element | null;
  const hit = t?.closest<HTMLElement>('[data-eid], [data-tday], [data-tcd]');
  if (!hit || !root.contains(hit) || hit.closest(HIDDEN) || hit.closest('.cal-touch')) return;
  if (hit.style.display === 'none') return;
  // the first tap on a dimmed screen only wakes it
  if (calTouchWakes()) return;
  const { eid, tday, tcd } = hit.dataset;
  if (eid) {
    const ev = src.events?.find((x) => x.id === eid);
    if (ev) showEvent(ev, src.today);
  } else if (tday) {
    showDay(tday, src.events ?? [], src.today);
  } else if (tcd) {
    const cd = src.cds?.find((c) => cdKey(c.item) === tcd);
    if (cd) showCountdown(cd.item, cd.days, cd.color, src.today);
  }
}

// ------------------------------------------------------------------------------------------------ pressed look
/** What shows it was touched: event chips, days, rows of the tap zones, the header buttons and the sheet's buttons. */
const PRESSABLE = '.cal-touch [data-eid], .cal-touch [data-tday], .cal-touch .cal-nav button, .tap-zone [data-eid], .tap-zone [data-tday], .tap-zone [data-tcd], #cal-sheet button';
let pressed: HTMLElement | null = null;
let pressedAt = 0;

function unpress(): void {
  const el = pressed;
  if (!el) return;
  pressed = null;
  // long enough to be seen after a quick tap
  setTimeout(() => el.classList.remove('is-pressed'), Math.max(0, 140 - (Date.now() - pressedAt)));
}

if (typeof document !== 'undefined') {
  // every touch starts the idle time again (only while something is open or moved)
  document.addEventListener('pointerdown', (e) => {
    if (idleTimer) arm();
    const el = (e.target as Element | null)?.closest?.<HTMLElement>(PRESSABLE);
    if (!el) return;
    unpress();
    pressed = el;
    pressedAt = Date.now();
    el.classList.add('is-pressed');
  }, { capture: true, passive: true });
  document.addEventListener('pointerup', unpress, { capture: true, passive: true });
  document.addEventListener('pointercancel', unpress, { capture: true, passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetOpen()) closeSheet();
  });
}
