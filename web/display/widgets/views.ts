// Layouts with their own content area (#view inside .main): Today (hour-by-hour timeline), Per person (one column
// per calendar), Photo frame (small clock card in a corner), Board (family organisation cards) and Bedside (huge
// dim clock). The other layouts (and Two weeks, which is the month grid with two rows) leave #view empty.
// Everything is plain HTML strings + setHTML (patched only when it changes) and one fitting pass that drops whole
// rows that do not fit, so nothing is ever cut in half.
import type { CountdownsResponse, DisplayConfig, PublicCalendarSource, WeatherResponse } from '../../shared/types';
import { addDays, diffDays, formatCountdown, formatDateLine, formatTime, keyToUTC, monthName, relativeDayLabel } from '../../shared/i18n';
import { chipColors } from '../color';
import { ctx } from '../ctx';
import { esc, setHTML } from '../dom';
import { type NEvent, sortForDay } from '../eventModel';
import { weatherIcon } from '../icons';
import { sourceCredit } from './weather';
import type { Tick } from '../time';
import { Clock } from './clock';
import { upcomingCountdowns } from './countdowns';
import { todoMetaHtml } from './extras';

export const VIEW_PRESETS = ['today', 'people', 'photoFrame', 'board', 'bedside'];

export interface ViewData {
  events: NEvent[];
  weather: WeatherResponse | null;
  countdowns: CountdownsResponse | null;
}

/** The static markup each view draws into (renderTodayView and renderPeopleView expect theirs). */
export const SKELETON: Record<string, string> = {
  today: `<div class="td-head"><div class="td-title"></div><div class="td-allday"></div></div>
    <div class="td-next"></div>
    <div class="td-line"><div class="td-grid"></div><div class="td-evs"></div><div class="td-now"><span></span></div></div>`,
  people: `<div class="pp-shared"></div><div class="pp-cols"></div>`,
  photoFrame: `<div class="pf-card"><div class="v-clock"></div><div class="pf-wx"></div><div class="pf-next"></div></div>`,
  board: `<div class="bd-cols"></div>`,
  bedside: `<div class="bs"><div class="v-clock"></div><div class="bs-info"><div class="bs-wx"></div><div class="bs-next"></div></div></div>`,
};

const colStyle = (hex: string) => {
  const c = chipColors(hex);
  return `--c:${c.base};--tint:${c.tint};--shade:${c.shade};--on:${c.onSolid}`;
};
const hm = (ms: number, cfg: DisplayConfig = ctx.cfg) => formatTime(new Date(ms), ctx.tz, cfg.datetime.format24, cfg.datetime.showAmPm);
const emojiOr = (e: NEvent, fallback = '') => (e.emoji ? esc(e.emoji) : fallback);

/** Timed single-day events of a day, by start. */
function timedOn(events: NEvent[], key: string): NEvent[] {
  return events.filter((e) => e.timed && e.startKey === key).sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title));
}
/** All-day and multi-day events covering a day. */
function allDayOn(events: NEvent[], key: string): NEvent[] {
  return events.filter((e) => e.bar && e.spanFirst <= key && e.spanLast >= key).sort(sortForDay);
}
/** "Check-in", "Day 2 of 5", … for an all-day / multi-day item on a given day ('' when nothing to add). */
function barNote(e: NEvent, key: string, cfg: DisplayConfig = ctx.cfg): string {
  const { t } = ctx;
  if (e.checkoutMarker) return t('checkOut');
  if (e.airbnb) return key === e.spanFirst ? t('checkIn') : key === e.spanLast ? t('checkOut') : t('dayXofY', { x: diffDays(e.spanFirst, key) + 1, y: e.days + 1 });
  if (e.days > 1 && cfg.calendar.showDayXofY) return t('dayXofY', { x: diffDays(e.spanFirst, key) + 1, y: e.days });
  return '';
}

/** The next thing to look at: upcoming today, else what is on now, else tomorrow's first event. */
function nextOf(events: NEvent[], tick: Tick): { e: NEvent; kind: 'next' | 'now' | 'tomorrow' } | null {
  const nowMs = tick.now.getTime();
  const today = timedOn(events, tick.dayKey);
  const next = today.find((e) => e.startMs > nowMs);
  if (next) return { e: next, kind: 'next' };
  const on = today.filter((e) => e.startMs <= nowMs && e.endMs > nowMs).pop();
  if (on) return { e: on, kind: 'now' };
  const tm = timedOn(events, addDays(tick.dayKey, 1))[0];
  return tm ? { e: tm, kind: 'tomorrow' } : null;
}

/** Short label of a future day: "Today", "Tomorrow", "Fri 17", "24 Oct". */
function dayLabel(key: string, today: string): string {
  const { lang } = ctx;
  const dd = diffDays(today, key);
  if (dd < 7) return relativeDayLabel(lang, key, today);
  const d = keyToUTC(key);
  const m = monthName(lang, d.getUTCMonth() + 1, 'short');
  // Spanish, Portuguese, Dutch and Danish write months in lower case ("23 oct", "8 nov"); Danish puts a dot after the day ("23. okt")
  return `${d.getUTCDate()}${lang === 'da' ? '.' : ''} ${lang === 'en' ? m : m.toLowerCase()}`;
}

/**
 * Hide rows until `box` stops overflowing. `pick()` returns the next row to drop (or null to stop); `after(row)` runs
 * after each drop (e.g. to update a "+2 more" label, which itself takes room).
 */
function fitRows(box: HTMLElement, pick: () => HTMLElement | null, after?: (row: HTMLElement) => void): void {
  for (let guard = 0; guard < 200 && box.scrollHeight > box.clientHeight + 1; guard++) {
    const row = pick();
    if (!row) return;
    row.classList.add('fit-hide');
    after?.(row);
  }
}

/**
 * Single-line chip rows: drop the chips that would overflow the line, from the last one. The Today line is aligned to
 * the right, so it overflows on the left: its first chip would lose the start of its title.
 */
function fitLine(line: HTMLElement): void {
  const chips = Array.from(line.children) as HTMLElement[];
  for (const c of chips) c.classList.remove('fit-hide');
  const box = line.getBoundingClientRect();
  const over = () => {
    const vis = chips.filter((c) => !c.classList.contains('fit-hide'));
    if (vis.length < 2) return false;
    return vis[0].getBoundingClientRect().left < box.left - 1 || vis[vis.length - 1].getBoundingClientRect().right > box.right + 1;
  };
  for (let i = chips.length - 1; i > 0 && over(); i--) chips[i].classList.add('fit-hide');
}

/**
 * The Today view (hour-by-hour timeline, today's all-day chips and the next event) into `root`, which holds
 * SKELETON.today. `cfg`: the settings it reads (default: the screen's). Shared by the Today layout and the canvas
 * calendar.today widget.
 */
export function renderTodayView(root: HTMLElement, d: ViewData, tick: Tick, cfg: DisplayConfig = ctx.cfg): void {
  const { lang, t } = ctx;
  const key = tick.dayKey;
  const nowMs = tick.now.getTime();
  const p = tick.parts;
  // the date as the screen writes it everywhere else ("Miércoles, 14 de octubre", "Wednesday, 14 October")
  setHTML(root.querySelector('.td-title')!, `<b>${esc(t('today'))}</b><span>${esc(formatDateLine(lang, key, cfg.datetime.dateFormat, cfg.datetime.dateCustom))}</span>`);

  // all-day + multi-day things of today, as chips next to the title
  const chips = allDayOn(d.events, key).map((e) => {
    const note = barNote(e, key, cfg);
    return `<span class="td-chip" style="${colStyle(e.color)}">${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}<b>${esc(e.title)}</b>${note ? `<em>${esc(note)}</em>` : ''}</span>`;
  });
  setHTML(root.querySelector('.td-allday')!, chips.join(''));

  // the next event, large
  const nx = nextOf(d.events, tick);
  let next: string;
  if (nx) {
    const e = nx.e;
    const kicker = nx.kind === 'now'
      ? `${t('happeningNow')} · ${t('untilTime', { t: hm(e.endMs, cfg) })}`
      : nx.kind === 'tomorrow'
        ? `${t('firstTomorrow')} · ${hm(e.startMs, cfg)}`
        : `${t('upNext')} · ${formatCountdown(lang, e.startMs - nowMs)}`;
    const sub = [`${hm(e.startMs, cfg)}–${hm(e.endMs, cfg)}`, e.ev.location || '', sourceName(e, cfg)].filter(Boolean).map(esc).join(' · ');
    next = `<div class="td-card${nx.kind === 'now' ? ' is-now' : ''}" style="${colStyle(e.color)}">
        <span class="td-em">${emojiOr(e, '<i class="td-dot"></i>')}</span>
        <div class="td-txt"><span class="td-k">${esc(kicker)}</span><span class="td-tt">${esc(e.title)}</span><span class="td-sub">${sub}</span></div></div>`;
  } else {
    next = `<div class="td-card is-empty"><div class="td-txt"><span class="td-tt">${esc(t('nothingMoreToday'))}</span></div></div>`;
  }
  setHTML(root.querySelector('.td-next')!, next);

  // hour-by-hour timeline: 07:00–22:00 at least, stretched to every event of the day and to "now"
  const evs = timedOn(d.events, key);
  const startOfDay = nowMs - ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
  const minOf = (ms: number) => (ms - startOfDay) / 60000;
  let h0 = Math.min(7, p.hour), h1 = Math.max(22, p.hour + 1);
  for (const e of evs) {
    h0 = Math.min(h0, Math.floor(minOf(e.startMs) / 60));
    h1 = Math.max(h1, Math.ceil(Math.min(24 * 60, minOf(e.endMs)) / 60));
  }
  h0 = Math.max(0, h0);
  h1 = Math.min(24, Math.max(h1, h0 + 1));
  const span = (h1 - h0) * 60;
  const pct = (m: number) => `${(((m - h0 * 60) / span) * 100).toFixed(3)}%`;
  const nowMin = p.hour * 60 + p.minute;
  const f24 = cfg.datetime.format24;
  const hourLbl = (h: number) => (f24 ? `${String(h).padStart(2, '0')}:00` : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`);
  const step = h1 - h0 > 15 ? 2 : 1;
  let grid = '';
  for (let h = h0; h <= h1; h++) {
    const near = Math.abs(h * 60 - nowMin) < 22;
    const lbl = (h - h0) % step === 0 && h < 24 && !near ? `<span>${esc(hourLbl(h))}</span>` : '';
    grid += `<div class="td-hr${h * 60 < nowMin ? ' past' : ''}" style="top:${pct(h * 60)}">${lbl}</div>`;
  }
  setHTML(root.querySelector('.td-grid')!, grid);

  // lanes: overlapping events (counting the minimum drawn height) share the width
  const box = root.querySelector<HTMLElement>('.td-evs')!;
  const H = box.clientHeight || 1;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  const minMin = Math.ceil(((rem * 4.4) / H) * span);
  const items = evs.map((e) => {
    const a = Math.max(h0 * 60, minOf(e.startMs));
    const b = Math.min(h1 * 60, Math.max(minOf(e.endMs), a + 15));
    return { e, a, b, vis: Math.max(b, a + minMin), lane: 0, of: 1 };
  });
  let cluster: typeof items = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    const n = Math.max(1, ...cluster.map((x) => x.lane + 1));
    for (const x of cluster) x.of = n;
    cluster = [];
  };
  for (const it of items) {
    if (it.a >= clusterEnd) closeCluster();
    const used = new Set(cluster.filter((x) => x.vis > it.a).map((x) => x.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    it.lane = lane;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.vis);
  }
  closeCluster();
  const rows = items.map(({ e, a, b, vis, lane, of }) => {
    const past = e.endMs <= nowMs;
    const on = e.startMs <= nowMs && e.endMs > nowMs;
    const tall = ((b - a) / span) * H > rem * 7.4;
    const loc = tall && e.ev.location ? `<span class="td-loc">${esc(e.ev.location)}</span>` : '';
    return `<div class="td-ev${past ? ' past' : ''}${on ? ' ongoing' : ''}${tall ? ' tall' : ''}" style="${colStyle(e.color)};top:${pct(a)};height:calc(${(((vis - a) / span) * 100).toFixed(3)}% - 0.3rem);left:calc(${((lane / of) * 100).toFixed(2)}% + 0.2rem);width:calc(${(100 / of).toFixed(2)}% - 0.4rem)">
        <span class="td-l1"><b>${esc(hm(e.startMs, cfg))}</b>${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}<span>${esc(e.title)}</span></span>${loc}</div>`;
  });
  setHTML(box, rows.join(''));
  const nowEl = root.querySelector<HTMLElement>('.td-now')!;
  nowEl.style.top = pct(nowMin + p.second / 60);
  nowEl.firstElementChild!.textContent = hm(nowMs, cfg);
  fitTodayView(root);
}

/** Today view: drop the all-day chips that do not fit their line. */
export function fitTodayView(root: HTMLElement): void {
  const line = root.querySelector<HTMLElement>('.td-allday');
  if (line) fitLine(line);
}

/**
 * The calendars shown as columns: `want` (a list of calendar ids, even an empty one, is used as is), else ?people=,
 * else layout.people; null means automatic (every calendar but holidays and birthdays). At most 5.
 */
function peopleColumns(cfg: DisplayConfig, columns?: string[] | null): PublicCalendarSource[] {
  const srcs = cfg.calendar.sources || [];
  const want = columns !== undefined ? columns : ctx.params.get('people')?.split(',').filter(Boolean) ?? cfg.layout.people;
  // a list (even an empty one, "nothing ticked" in the admin) is used as is; null means automatic
  if (Array.isArray(want)) return want.map((id) => srcs.find((s) => s.id === id)).filter((s): s is PublicCalendarSource => !!s).slice(0, 5);
  return srcs.filter((s) => s.kind !== 'holidays' && s.kind !== 'birthdays').slice(0, 5);
}

/**
 * The Per person view (one column per calendar, today and the next days) into `root`, which holds SKELETON.people.
 * `cfg`: the settings it reads (default: the screen's); `opts.columns`: the calendars to show (default: the layout's);
 * `opts.days`: how many days per column (default 2: today and tomorrow). Shared by the Per person layout and the
 * canvas calendar.people widget.
 */
export function renderPeopleView(root: HTMLElement, d: ViewData, tick: Tick, cfg: DisplayConfig = ctx.cfg, opts: { columns?: string[] | null; days?: number } = {}): void {
  const { t } = ctx;
  const today = tick.dayKey;
  const nowMs = tick.now.getTime();
  const cols = peopleColumns(cfg, opts.columns);
  const dayKeys = Array.from({ length: Math.max(1, Math.min(3, opts.days ?? 2)) }, (_, i) => addDays(today, i));
  const inCols = new Set(cols.map((s) => s.id));
  root.style.setProperty('--pp-n', String(Math.max(1, cols.length)));
  root.classList.toggle('pp-many', cols.length >= 4);

  // shared things (holidays, birthdays, calendars without a column): one line above the columns
  const shared = dayKeys.slice(0, 2).flatMap((key) =>
    d.events
      .filter((e) => !inCols.has(e.ev.sourceId) && e.startKey === key && (e.allDay || e.ev.kind === 'holidays' || e.ev.kind === 'birthdays'))
      .map((e) => `<span class="pp-chip" style="${colStyle(e.color)}">${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}<b>${esc(e.title)}</b><em>${esc(relativeDayLabel(ctx.lang, key, today))}</em></span>`),
  );
  const sharedEl = root.querySelector<HTMLElement>('.pp-shared')!;
  setHTML(sharedEl, shared.length ? `<span class="pp-who">${esc(t('everyone'))}</span>${shared.join('')}` : '');
  sharedEl.style.display = shared.length ? '' : 'none';

  const row = (e: NEvent, key: string) => {
    if (e.bar) {
      const note = barNote(e, key, cfg);
      return `<div class="pp-ev allday" style="${colStyle(e.color)}">${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}<span class="pp-tt">${esc(e.title)}</span>${note ? `<em>${esc(note)}</em>` : ''}</div>`;
    }
    const past = e.endMs <= nowMs, on = e.startMs <= nowMs && e.endMs > nowMs;
    return `<div class="pp-ev${past ? ' past' : ''}${on ? ' ongoing' : ''}" style="${colStyle(e.color)}"><b class="pp-tm">${esc(hm(e.startMs, cfg))}</b>${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}<span class="pp-tt">${esc(e.title)}</span></div>`;
  };
  const section = (s: PublicCalendarSource, key: string) => {
    const list = [...allDayOn(d.events, key), ...timedOn(d.events, key)].filter((e) => e.ev.sourceId === s.id);
    const body = list.length ? list.map((e) => row(e, key)).join('') : `<div class="pp-none">${esc(t('nothingPlanned'))}</div>`;
    return `<div class="pp-sec${key === today ? ' is-today' : ''}"><div class="pp-day">${esc(relativeDayLabel(ctx.lang, key, today, false))}</div><div class="pp-list">${body}</div><div class="pp-more"></div></div>`;
  };
  const html = cols.length
    ? cols.map((s) => {
        const initial = (s.name.trim()[0] || '?').toUpperCase();
        return `<div class="pp-col" style="${colStyle(s.color)}"><div class="pp-head"><span class="pp-av">${s.emoji ? esc(s.emoji) : esc(initial)}</span><span class="pp-name">${esc(s.name)}</span></div>${dayKeys.map((k) => section(s, k)).join('')}</div>`;
      }).join('')
    : `<div class="pp-empty">${esc(t('noPeople'))}</div>`;
  setHTML(root.querySelector('.pp-cols')!, html);
  fitPeopleView(root);
}

/** Per person view: drop whole rows that do not fit their column. */
export function fitPeopleView(root: HTMLElement): void {
  for (const col of Array.from(root.querySelectorAll<HTMLElement>('.pp-col'))) {
    const rows = Array.from(col.querySelectorAll<HTMLElement>('.pp-ev'));
    for (const r of rows) r.classList.remove('fit-hide');
    for (const m of Array.from(col.querySelectorAll<HTMLElement>('.pp-more'))) m.textContent = '';
    const visible = (sel: string) => Array.from(col.querySelectorAll<HTMLElement>(sel)).filter((r) => !r.classList.contains('fit-hide'));
    // what is over first (oldest first), then tomorrow from the end, then today from the end
    fitRows(
      col,
      () => visible('.is-today .pp-ev.past')[0] ?? visible('.pp-sec:not(.is-today) .pp-ev').pop() ?? visible('.is-today .pp-ev').pop() ?? null,
      (r) => {
        const sec = r.closest('.pp-sec')!;
        const n = sec.querySelectorAll('.pp-ev.fit-hide:not(.past)').length;
        sec.querySelector('.pp-more')!.textContent = n ? ctx.t('more', { n }) : '';
      },
    );
  }
  }

// ---- the compact Today and Per person (a Personalizado card in a small box, the compact look) ----------------------

/** One line of an event: its time (none for an all-day one), its emoji and its title (ending in …). */
function miniRow(e: NEvent, nowMs: number, cfg: DisplayConfig, tm = ''): string {
  const past = e.timed && e.endMs <= nowMs;
  const on = e.timed && e.startMs <= nowMs && e.endMs > nowMs;
  const time = tm || (e.timed ? hm(e.startMs, cfg) : '');
  return `<div class="cvm-ev${past ? ' past' : ''}${on ? ' ongoing' : ''}" style="${colStyle(e.color)}">${time ? `<b class="cvm-tm">${esc(time)}</b>` : '<i class="cvm-dot"></i>'}${e.emoji ? `<i class="cvm-em">${esc(e.emoji)}</i>` : ''}<span class="cvm-tt">${esc(e.title)}</span></div>`;
}

/** Drop rows from the end (what is over first) until `root` holds what is left, and say how many went. */
function fitMini(root: HTMLElement): void {
  const rows = Array.from(root.querySelectorAll<HTMLElement>('.cvm-ev'));
  const more = root.querySelector<HTMLElement>('.cvm-more');
  for (const r of rows) r.classList.remove('cvm-hide');
  if (more) more.textContent = '';
  if (!root.clientHeight) return;
  const over = () => root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1;
  const order = [...rows.filter((r) => r.classList.contains('past')), ...rows.filter((r) => !r.classList.contains('past')).reverse()];
  // the first row always stays (its title ends in …)
  for (const r of order) {
    if (!over() || rows.filter((x) => !x.classList.contains('cvm-hide')).length <= 1) break;
    r.classList.add('cvm-hide');
    const n = rows.filter((x) => x.classList.contains('cvm-hide') && !x.classList.contains('past')).length;
    if (more) more.textContent = n ? ctx.t('more', { n }) : '';
  }
}

/** Today in a small card: "Hoy" and the date, then today's events one per line, as many as fit and "+N más". */
export function renderMiniToday(root: HTMLElement, d: ViewData, tick: Tick, cfg: DisplayConfig = ctx.cfg): void {
  const today = tick.dayKey;
  const nowMs = tick.now.getTime();
  const date = keyToUTC(today);
  const list = [...allDayOn(d.events, today), ...timedOn(d.events, today)];
  const rows = list.length ? list.map((e) => miniRow(e, nowMs, cfg)).join('') : `<div class="cvm-none">${esc(ctx.t('noEvents'))}</div>`;
  setHTML(root, `<div class="cvm-head"><b>${esc(relativeDayLabel(ctx.lang, today, today, false))}</b><span>${esc(`${date.getUTCDate()} ${monthName(ctx.lang, date.getUTCMonth() + 1, 'short')}`)}</span></div><div class="cvm-list">${rows}</div><div class="cvm-more"></div>`);
  fitMini(root);
}

/** Per person in a small card: a line per person, their colour and initial (or emoji) and what they have next. */
export function renderMiniPeople(root: HTMLElement, d: ViewData, tick: Tick, cfg: DisplayConfig = ctx.cfg, opts: { columns?: string[] | null; days?: number } = {}): void {
  const today = tick.dayKey;
  const nowMs = tick.now.getTime();
  const cols = peopleColumns(cfg, opts.columns);
  const days = Array.from({ length: Math.max(1, Math.min(3, opts.days ?? 2)) }, (_, i) => addDays(today, i));
  const html = cols.map((s) => {
    const initial = (s.name.trim()[0] || '?').toUpperCase();
    const who = `<span class="cvm-av" style="${colStyle(s.color)}">${s.emoji ? esc(s.emoji) : esc(initial)}</span><span class="cvm-name">${esc(s.name)}</span>`;
    // what is on now or later today (an all-day one of today first), else the first thing of the next days
    let next = '';
    for (const key of days) {
      const mine = (e: NEvent) => e.ev.sourceId === s.id;
      const all = allDayOn(d.events, key).filter(mine);
      const timed = timedOn(d.events, key).filter((e) => mine(e) && e.endMs > nowMs);
      const e = all[0] ?? timed[0];
      if (!e) continue;
      const tm = key === today ? '' : relativeDayLabel(ctx.lang, key, today, false);
      next = miniRow(e, nowMs, cfg, tm && e.timed ? `${tm} ${hm(e.startMs, cfg)}` : tm).replace('<div class="cvm-ev', '<div class="cvm-ev cvm-pp').replace(/(style="[^"]*">)/, `$1${who}`);
      break;
    }
    return next || `<div class="cvm-ev cvm-pp is-none" style="${colStyle(s.color)}">${who}<span class="cvm-tt">${esc(ctx.t('nothingPlanned'))}</span></div>`;
  }).join('');
  setHTML(root, `<div class="cvm-list">${html || `<div class="cvm-none">${esc(ctx.t('noPeople'))}</div>`}</div><div class="cvm-more"></div>`);
  // a narrow card: the names go when they would show a letter or two (the initials stay)
  root.classList.remove('cvm-nonames');
  const names = Array.from(root.querySelectorAll<HTMLElement>('.cvm-name'));
  if (names.some((n) => n.scrollWidth > n.clientWidth + 1 && n.clientWidth < (parseFloat(getComputedStyle(n).fontSize) || 15) * 3.5)) root.classList.add('cvm-nonames');
  fitMini(root);
}

export class Views {
  private kind = '';
  private clock: Clock | null = null;
  private lastTick: Tick | null = null;

  constructor(private root: HTMLElement) {}

  /** Build the skeleton of a layout (no-op when it is not one of VIEW_PRESETS or did not change). */
  setPreset(preset: string): void {
    const kind = VIEW_PRESETS.includes(preset) ? preset : '';
    if (kind === this.kind) return;
    this.kind = kind;
    this.clock = null;
    this.root.className = kind ? `view view-${kind}` : 'view';
    this.root.innerHTML = SKELETON[kind] ?? '';
    const ck = this.root.querySelector<HTMLElement>('.v-clock');
    if (ck) this.clock = new Clock(ck, { seconds: false });
    if (this.lastTick) this.clock?.update(this.lastTick);
  }

  /** Every second: only the small clocks. */
  tick(tick: Tick): void {
    this.lastTick = tick;
    this.clock?.update(tick);
  }

  render(d: ViewData, tick: Tick): void {
    this.lastTick = tick;
    if (!this.kind) return;
    this.clock?.update(tick);
    if (this.kind === 'today') this.today(d, tick);
    else if (this.kind === 'people') this.people(d, tick);
    else if (this.kind === 'photoFrame') this.frame(d, tick);
    else if (this.kind === 'board') this.board(d, tick);
    else if (this.kind === 'bedside') this.bedside(d, tick);
  }

  /** Drop whatever does not fit (after layout changes: resize, fonts, news appearing). */
  fit(): void {
    if (this.kind === 'today') fitTodayView(this.root);
    else if (this.kind === 'people') fitPeopleView(this.root);
    else if (this.kind === 'board') this.fitBoard();
  }

  // ------------------------------------------------------------------------------------------------ Today
  private today(d: ViewData, tick: Tick): void {
    renderTodayView(this.root, d, tick);
  }

  // ------------------------------------------------------------------------------------------------ Per person
  private people(d: ViewData, tick: Tick): void {
    renderPeopleView(this.root, d, tick);
  }

  // ------------------------------------------------------------------------------------------------ Photo frame
  private frame(d: ViewData, tick: Tick): void {
    setHTML(this.root.querySelector('.pf-wx')!, weatherLine(d.weather));
    const nx = nextOf(d.events, tick);
    const nowMs = tick.now.getTime();
    let next = '';
    if (nx) {
      const e = nx.e;
      const when = nx.kind === 'now' ? ctx.t('happeningNow') : nx.kind === 'tomorrow' ? `${ctx.t('tomorrow')} ${hm(e.startMs)}` : `${hm(e.startMs)} · ${formatCountdown(ctx.lang, e.startMs - nowMs)}`;
      next = `<div class="pf-ev" style="${colStyle(e.color)}"><span class="pf-em">${emojiOr(e, '<i class="td-dot"></i>')}</span><span class="pf-tt">${esc(e.title)}</span><span class="pf-when">${esc(when)}</span></div>`;
    }
    setHTML(this.root.querySelector('.pf-next')!, next);
  }

  // ------------------------------------------------------------------------------------------------ Bedside
  private bedside(d: ViewData, tick: Tick): void {
    setHTML(this.root.querySelector('.bs-wx')!, weatherLine(d.weather, false));
    const nx = nextOf(d.events, tick);
    let next = '';
    if (nx) {
      const e = nx.e;
      const when = nx.kind === 'now' ? ctx.t('happeningNow') : nx.kind === 'tomorrow' ? `${ctx.t('tomorrow')} ${hm(e.startMs)}` : hm(e.startMs);
      next = `<span class="bs-when">${esc(when)}</span><span class="bs-tt">${e.emoji ? `<i class="bs-em">${esc(e.emoji)}</i> ` : ''}${esc(e.title)}</span>`;
    }
    setHTML(this.root.querySelector('.bs-next')!, next);
    // a bit dimmer again during the night window (the configured one, else 22:00–07:00)
    const nm = ctx.cfg.screen.nightMode;
    const toMin = (s: string) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
      return m ? +m[1] * 60 + +m[2] : -1;
    };
    const [f, to] = nm.enabled ? [toMin(nm.from), toMin(nm.to)] : [22 * 60, 7 * 60];
    const n = tick.parts.hour * 60 + tick.parts.minute;
    const late = f >= 0 && to >= 0 && f !== to && (f < to ? n >= f && n < to : n >= f || n < to);
    document.getElementById('app')?.classList.toggle('bedside-late', late || ctx.params.get('night') === '1');
  }

  // ------------------------------------------------------------------------------------------------ Board
  private board(d: ViewData, tick: Tick): void {
    const { t, cfg } = ctx;
    const today = tick.dayKey, tomorrow = addDays(today, 1);
    const nowMs = tick.now.getTime();
    const cards: { id: string; w: number; html: string }[] = [];
    const card = (id: string, icon: string, title: string, body: string, w: number) =>
      cards.push({ id, w, html: `<section class="bd-card bd-${id}"><h3 class="bd-h"><span>${icon}</span>${esc(title)}</h3>${body}</section>` });
    const rowsHtml = (rows: string[]) => `<div class="bd-list">${rows.join('')}</div><div class="bd-more"></div>`;

    // short agenda: what is left of today + tomorrow
    const dayRows = (key: string) => {
      const list = [...allDayOn(d.events, key), ...timedOn(d.events, key).filter((e) => e.endMs > nowMs)];
      const rows = list.map((e) => {
        const on = !e.bar && e.startMs <= nowMs;
        const lead = e.bar ? barNote(e, key) || t('allDay') : on ? t('happeningNow') : hm(e.startMs);
        return `<div class="bd-row${on ? ' ongoing' : ''}" style="${colStyle(e.color)}"><span class="bd-tile">${emojiOr(e, '<i class="td-dot"></i>')}</span><span class="bd-tt">${esc(e.title)}</span><span class="bd-meta">${esc(lead)}</span></div>`;
      });
      return `<div class="bd-day">${esc(relativeDayLabel(ctx.lang, key, today, false))}</div>${rows.length ? rows.join('') : `<div class="bd-none">${esc(t('nothingPlanned'))}</div>`}`;
    };
    card('agenda', '📅', t('agenda'), `<div class="bd-list">${dayRows(today)}${dayRows(tomorrow)}</div><div class="bd-more"></div>`, 9);

    // message of the day
    const m = cfg.message;
    if (m.enabled && m.text.trim()) {
      cards.push({ id: 'msg', w: 3, html: `<section class="bd-card bd-msg"><span class="bd-msg-em">${esc(m.emoji || '💬')}</span><p>${esc(m.text)}</p></section>` });
    }

    // to-do
    const items = (cfg.todo.items || []).filter((i) => i.text?.trim());
    if (cfg.todo.enabled && items.length) {
      const sorted = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
      const open = sorted.filter((i) => !i.done).length;
      const rows = sorted.map((i) => `<div class="bd-row bd-task${i.done ? ' done' : ''}"><span class="bd-check">${i.done ? '✓' : ''}</span><span class="bd-tt">${esc(i.text)}</span>${todoMetaHtml(i)}</div>`);
      if (!open) rows.unshift(`<div class="bd-none">${esc(t('allDone'))} 🎉</div>`);
      card('todo', '✅', t('todo'), rowsHtml(rows), 1 + rows.length);
    }

    // countdowns (birthdays get their own card)
    if (cfg.countdowns?.enabled !== false) {
      const cds = upcomingCountdowns(d.countdowns, today, 12).filter((v) => v.item.origin !== 'birthday');
      if (cds.length) {
        const rows = cds.map(({ item, days }) => {
          const when = days === 0 ? esc(t('cdToday')) : days === 1 ? esc(t('cdTomorrow')) : `<b>${days}</b> <small>${esc(t('daysWord'))}</small>`;
          return `<div class="bd-row bd-cd${days <= 1 ? ' soon' : ''}" style="${colStyle(item.color || cfg.screen.accent)}"><span class="bd-tile">${esc(item.emoji || '⏳')}</span><span class="bd-tt">${esc(item.title)}</span><span class="bd-meta">${when}</span></div>`;
        });
        card('cd', '⏳', t('countdowns'), rowsHtml(rows), 1 + rows.length);
      }
    }

    // upcoming birthdays: the countdown list (it knows the age and looks a year ahead) + calendar birthdays
    const seen = new Set<string>();
    const bdays: { title: string; key: string; color: string }[] = [];
    for (const v of upcomingCountdowns(d.countdowns, today, 40)) {
      if (v.item.origin !== 'birthday') continue;
      const title = typeof v.item.age === 'number' ? `${v.item.title} (${v.item.age})` : v.item.title;
      seen.add(`${v.item.date}|${v.item.title}`);
      bdays.push({ title, key: v.item.date, color: v.item.color || '#f15bb5' });
    }
    for (const e of d.events) {
      if (!(e.allDay && (e.ev.kind === 'birthdays' || e.emoji === '🎂')) || e.startKey < today) continue;
      if (seen.has(`${e.startKey}|${e.ev.title}`) || bdays.some((b) => b.key === e.startKey && b.title === e.title)) continue;
      bdays.push({ title: e.title, key: e.startKey, color: e.color });
    }
    bdays.sort((a, b) => a.key.localeCompare(b.key) || a.title.localeCompare(b.title));
    if (bdays.length) {
      const rows = bdays.slice(0, 8).map((b) => {
        const dd = diffDays(today, b.key);
        return `<div class="bd-row bd-bday${dd <= 1 ? ' soon' : ''}" style="${colStyle(b.color)}"><span class="bd-tile">🎂</span><span class="bd-tt">${esc(b.title)}</span><span class="bd-meta">${esc(dayLabel(b.key, today))}</span></div>`;
      });
      card('bday', '🎂', t('birthdays'), rowsHtml(rows), 1 + rows.length);
    }

    // columns: the agenda gets the first one, the rest go to the shortest column (landscape 3, portrait 2)
    const app = document.getElementById('app');
    const n = app?.classList.contains('portrait') ? 2 : 3;
    const colsOut: string[][] = Array.from({ length: n }, () => []);
    const weight = new Array(n).fill(0);
    colsOut[0].push(cards[0].html);
    weight[0] = Infinity;
    for (const c of cards.slice(1)) {
      let best = 1;
      for (let i = 1; i < n; i++) if (weight[i] < weight[best]) best = i;
      colsOut[best].push(c.html);
      weight[best] += c.w + 1.5;
    }
    // the grid keeps its columns even when some are empty, so a lone agenda card does not stretch across the screen
    const html = colsOut.filter((c, i) => i === 0 || c.length).map((c) => `<div class="bd-col">${c.join('')}</div>`).join('');
    const box = this.root.querySelector<HTMLElement>('.bd-cols')!;
    box.style.setProperty('--bd-n', String(n));
    setHTML(box, html);
    this.fit();
  }

  private fitBoard(): void {
    for (const col of Array.from(this.root.querySelectorAll<HTMLElement>('.bd-col'))) {
      const rows = Array.from(col.querySelectorAll<HTMLElement>('.bd-row, .bd-day, .bd-none'));
      for (const r of rows) r.classList.remove('fit-hide');
      for (const m of Array.from(col.querySelectorAll<HTMLElement>('.bd-more'))) m.textContent = '';
      // drop the last row of the card that has the most rows left
      const pick = () => {
        let best: HTMLElement | null = null, bestN = 1;
        for (const c of Array.from(col.querySelectorAll<HTMLElement>('.bd-card'))) {
          const vis = Array.from(c.querySelectorAll<HTMLElement>('.bd-row')).filter((r) => !r.classList.contains('fit-hide'));
          if (vis.length > bestN) {
            bestN = vis.length;
            best = vis[vis.length - 1];
          }
        }
        return best;
      };
      fitRows(col, pick, (r) => {
        const c = r.closest('.bd-card')!;
        // a day header whose rows are all gone goes too
        for (const day of Array.from(c.querySelectorAll<HTMLElement>('.bd-day'))) {
          let s = day.nextElementSibling as HTMLElement | null;
          let any = false;
          while (s && !s.classList.contains('bd-day')) {
            if (!s.classList.contains('fit-hide')) any = true;
            s = s.nextElementSibling as HTMLElement | null;
          }
          if (!any && day.previousElementSibling) day.classList.add('fit-hide');
        }
        const k = c.querySelectorAll('.bd-row.fit-hide').length;
        const more = c.querySelector('.bd-more');
        if (more) more.textContent = k ? ctx.t('more', { n: k }) : '';
      });
    }
  }
}

function sourceName(e: NEvent, cfg: DisplayConfig = ctx.cfg): string {
  const s = cfg.calendar.sources?.find((x) => x.id === e.ev.sourceId);
  return s && s.kind !== 'holidays' ? s.name : '';
}

/** "⛅ 19° Partly cloudy" (+ "H 22° L 14°" when `full`). */
function weatherLine(w: WeatherResponse | null, full = true): string {
  const wc = ctx.cfg.weather;
  if (!wc.enabled || !w?.current) return '';
  const c = w.current;
  const r = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? '–' : String(Math.round(n)));
  const hilo = full && w.today ? `<span class="v-hl">${esc(ctx.t('hiShort'))} ${r(w.today.max)}° · ${esc(ctx.t('loShort'))} ${r(w.today.min)}°</span>` : '';
  const src = full ? `<span class="wx-src">${esc(sourceCredit(w))}</span>` : '';
  return `<span class="v-wx-ic">${weatherIcon(c.code, c.isDay, { animated: !ctx.lite })}</span><span class="v-temp">${r(c.temp)}°</span><span class="v-cond"><span>${esc(c.description || '')}</span>${hilo}${src}</span>`;
}
