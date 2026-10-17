// Personalizado calendars: the month grid and the week (MonthCalendar), the agenda (Agenda), Today and Per person
// (the views.ts renderers), the next events and the countdowns. Each one reads the item's settings through cfg() and
// only gets the events of the calendars the item picked.
import type { DisplayCanvasItem } from '../../../shared/types';
import { formatCountdown, formatTime, relativeDayLabel } from '../../../shared/i18n';
import { chipColors } from '../../color';
import { ctx } from '../../ctx';
import type { NEvent } from '../../eventModel';
import { refreshMarquee } from '../../marquee';
import { state } from '../../store';
import type { Tick } from '../../time';
import { Agenda } from '../agenda';
import { MonthCalendar } from '../calendar';
import { Countdowns } from '../countdowns';
import { fitPeopleView, fitTodayView, renderMiniPeople, renderMiniToday, renderPeopleView, renderTodayView, SKELETON } from '../views';
import type { AdapterEnv, CanvasAdapter } from './types';
import { screenWeather } from '../../weatherPlaces';

type Props = Record<string, any>;

/** The item's events, without what is over when it hides the past. */
function eventsOf(env: AdapterEnv, t: Tick): NEvent[] {
  const evs = env.events();
  if (!(env.item().props as Props).hidePast) return evs;
  const now = t.now.getTime();
  return evs.filter((e) => e.spanLast >= t.dayKey && !(e.timed && e.endMs <= now));
}

// ------------------------------------------------------------------------------------------------ month / week
/**
 * A month or week grid in a card of any size: an event line the card's edge would cut through (the bottom of a short
 * box, the last column of a narrow one) is hidden whole, so no text is ever half shown.
 */
function fitGrid(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.cv-fit-hide'))) el.classList.remove('cv-fit-hide');
  root.querySelector('.cv-legend-off')?.classList.remove('cv-legend-off');
  const r = root.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // the heading: the colour key goes when it would run into the month's name
  const title = root.querySelector<HTMLElement>('.cal-title');
  const legend = root.querySelector<HTMLElement>('.legend');
  if (title && legend) {
    const a = title.getBoundingClientRect();
    const b = legend.getBoundingClientRect();
    // (its keys may stick out of the key's own box, so each one is measured)
    const hit = [legend, ...Array.from(legend.children)].some((k) => {
      const c = k.getBoundingClientRect();
      return c.width > 0 && ((a.right > c.left + 1 && a.left < c.right - 1 && a.bottom > c.top + 1 && a.top < c.bottom - 1) || c.left < r.left || c.right > r.right + 1);
    });
    // or a key taller than three lines of it
    const tall = b.height > (parseFloat(getComputedStyle(legend).lineHeight) || b.height) * 3.5;
    if (hit || tall) legend.classList.add('cv-legend-off');
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.ev'))) {
    const e = el.getBoundingClientRect();
    if (!e.width || !e.height) continue;
    const seen = e.bottom > r.top && e.top < r.bottom && e.right > r.left && e.left < r.right;
    // its text may run past its own box (a time wider than a narrow day); scrollWidth is in the chip's own pixels,
    // the box on screen may be scaled (a card's text size), so it is measured in the screen's
    const k = el.offsetWidth ? e.width / el.offsetWidth : 1;
    const right = Math.max(e.right, e.left + el.scrollWidth * k);
    if (seen && (e.bottom > r.bottom + 1 || right > r.right + 1)) el.classList.add('cv-fit-hide');
  }
  // a chip narrower than its words (a small box, a wide sidebar): the title goes when only a letter or two of it
  // would show, then the time when even that is cut, so a chip never ends in half a word or half a time
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.ev'))) {
    el.classList.remove('cv-chip-notitle', 'cv-chip-icon');
    if (el.classList.contains('cv-fit-hide') || !el.clientWidth) continue;
    const tt = el.querySelector<HTMLElement>(':scope > .tt');
    const tm = el.querySelector<HTMLElement>(':scope > .tm');
    const em = parseFloat(getComputedStyle(el).fontSize) || 16;
    if (tt && tm && (el.scrollWidth > el.clientWidth + 1 || tt.scrollWidth > tt.clientWidth + 1)) {
      const shown = Math.min(el.getBoundingClientRect().right, tt.getBoundingClientRect().right) - tt.getBoundingClientRect().left;
      if (shown < em * 3) el.classList.add('cv-chip-notitle');
    }
    if (tm && el.scrollWidth > el.clientWidth + 1 && el.querySelector(':scope > .em')) el.classList.add('cv-chip-icon');
    // an all-day chip with a letter or two of its title: its icon alone
    if (!tm && tt && !tt.classList.contains('mq') && el.querySelector(':scope > .em') && tt.scrollWidth > tt.clientWidth + 1 && tt.clientWidth < em * 2.5) el.classList.add('cv-chip-icon');
  }
  // the page mark of a busy day (1/2) that would sit on the day's number: left out
  for (const pg of Array.from(root.querySelectorAll<HTMLElement>('.pgi'))) {
    const b = pg.getBoundingClientRect();
    if (!b.width) continue;
    const nums = Array.from(pg.parentElement?.querySelectorAll<HTMLElement>('.num > span') ?? []);
    const hit = nums.some((n) => {
      const a = n.getBoundingClientRect();
      return a.right > b.left - 2 && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
    });
    if (hit) pg.classList.add('cv-fit-hide');
  }
}

function grid(): CanvasAdapter {
  let env: AdapterEnv;
  let cal: MonthCalendar;
  let box: HTMLElement;
  let root: HTMLElement;
  const render = () => {
    const t = env.now();
    cal.render(eventsOf(env, t), t);
    refreshMarquee();
    fitGrid(root);
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-cal');
      box = document.createElement('div');
      root.appendChild(box);
      cal = new MonthCalendar(box, { cfg: env.cfg });
      render();
    },
    update: () => render(),
    layout(b) {
      // a small box (the compact look): drawn as in a small box (some 40 by 34 rem for the month,
      // 46 by 20 for the week), scaled down to its box, never under 60 % (the card's own text size on top)
      if (root.dataset.mini !== undefined) {
        const [nw, nh] = env.item().kind === 'calendar.month' ? [40, 34] : [46, 20];
        const r = root.getBoundingClientRect();
        const z = Math.max(0.6, Math.min(1, r.width / b.rem / nw, r.height / b.rem / nh));
        root.style.zoom = String((Number(env.item().style?.scale) || 1) * z);
      }
      render();
    },
    tick(t) {
      if (t.minuteChanged) render();
    },
    data(topic) {
      if (topic === 'events' || topic === 'config') render();
    },
    destroy() {
      cal.destroy();
      box.remove();
    },
  };
}

// ------------------------------------------------------------------------------------------------ agenda
/**
 * The agenda in a card keeps what fits whole: everything after the first row or day heading that leaves the box is
 * hidden (a cut day keeps its heading when it still shows a row, today always does), and a cut day says "+N more".
 * Only later content is hidden, so what was measured as fitting never moves.
 */
export function fitAgenda(box: HTMLElement): void {
  for (const el of Array.from(box.querySelectorAll<HTMLElement>('.cv-fit-hide'))) el.classList.remove('cv-fit-hide');
  for (const el of Array.from(box.querySelectorAll<HTMLElement>('.cv-more'))) el.remove();
  if (!box.offsetWidth || !box.offsetHeight) return;
  // layout positions (offsets), not getBoundingClientRect: the agenda's FLIP and fade-in animations move the rows
  // with transforms for a moment, and that must not decide what fits
  const at = (el: HTMLElement) => {
    let x = 0;
    let y = 0;
    for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    return { x, y };
  };
  const cs = getComputedStyle(box);
  const o = at(box);
  const right = o.x + box.offsetWidth - (parseFloat(cs.paddingRight) || 0) + 1;
  const bottom = o.y + box.offsetHeight - (parseFloat(cs.paddingBottom) || 0) + 1;
  const fits = (el: HTMLElement) => {
    const p = at(el);
    return p.x + el.offsetWidth <= right && p.y + el.offsetHeight <= bottom;
  };
  const days = Array.from(box.querySelectorAll<HTMLElement>(':scope > .ag-day'));
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const head = day.querySelector<HTMLElement>('.ag-date');
    const rows = Array.from(day.querySelectorAll<HTMLElement>('.ag-list > *'));
    if (head && !fits(head) && i > 0) {
      for (const d of days.slice(i)) d.classList.add('cv-fit-hide');
      return;
    }
    const cut = rows.findIndex((x) => !fits(x));
    if (cut < 0) continue;
    // this day is cut: hide its rows from the first that does not fit, and every later day
    for (const d of days.slice(i + 1)) d.classList.add('cv-fit-hide');
    const evs = rows.filter((x) => x.classList.contains('ag-ev'));
    let shown = cut;
    const hideFrom = (n: number) => rows.forEach((x, j) => x.classList.toggle('cv-fit-hide', j >= n));
    hideFrom(shown);
    const more = document.createElement('div');
    more.className = 'ag-more cv-more';
    day.querySelector('.ag-list')?.appendChild(more);
    const setMore = () => {
      const hidden = evs.filter((x) => x.classList.contains('cv-fit-hide')).length;
      more.textContent = hidden ? ctx.t('more', { n: hidden }) : '';
      more.hidden = !hidden;
    };
    setMore();
    while (shown > 0 && !more.hidden && !fits(more)) {
      shown--;
      hideFrom(shown);
      setMore();
    }
    // a later day with nothing left to show goes whole
    if (shown === 0 && i > 0) day.classList.add('cv-fit-hide');
    return;
  }
}

function agenda(): CanvasAdapter {
  let env: AdapterEnv;
  let ag: Agenda;
  let box: HTMLElement;
  let root: HTMLElement;
  const build = () => {
    const p = env.item().props as Props;
    box?.remove();
    box = document.createElement('div');
    root.appendChild(box);
    ag = new Agenda(box, { days: Math.min(14, Math.max(1, Number(p.days) || 7)), compact: !!p.compact, maxPerDay: Math.min(10, Math.max(1, Number(p.maxPerDay) || 4)), cfg: env.cfg });
    render();
  };
  const render = () => {
    const t = env.now();
    ag.render(eventsOf(env, t), t);
    fitAgenda(box);
    refreshMarquee();
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-agenda');
      build();
    },
    update: () => build(),
    layout: () => render(),
    tick(t) {
      if (t.minuteChanged) render();
    },
    data(topic) {
      if (topic === 'events' || topic === 'config') render();
    },
    destroy() {
      box.remove();
    },
  };
}

// ------------------------------------------------------------------------------------------------ today / people
function view(kind: 'today' | 'people'): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  // a small box (the compact look): a line per event (Today) or per person (Per person), views.ts renderMini*
  let mini = false;
  const render = () => {
    const t = env.now();
    const d = { events: eventsOf(env, t), weather: screenWeather(), countdowns: state.countdowns };
    if (mini) {
      const p = env.item().props as Props;
      if (kind === 'today') renderMiniToday(root, d, t, env.cfg());
      else renderMiniPeople(root, d, t, env.cfg(), { columns: Array.isArray(p.columns) ? p.columns : null, days: Number(p.days) || 2 });
      return;
    }
    if (kind === 'today') {
      renderTodayView(root, d, t, env.cfg());
      fitToday();
      // an event too narrow for its time, emoji and title loses the emoji (the title ends in …)
      for (const l of Array.from(root.querySelectorAll<HTMLElement>('.td-l1'))) {
        l.classList.remove('cv-noi');
        if (l.scrollWidth > l.clientWidth + 1) l.classList.add('cv-noi');
      }
    } else {
      const p = env.item().props as Props;
      renderPeopleView(root, d, t, env.cfg(), { columns: Array.isArray(p.columns) ? p.columns : null, days: Number(p.days) || 2 });
    }
  };
  /**
   * Today in a small card: the hour lines need room, so the big "next" card goes when the timeline would be too
   * tight, and the hour labels thin out (every 2, 4 or 6 hours) so they never run into each other.
   */
  let fitting = false;
  const fitToday = () => {
    if (fitting) return;
    const line = root.querySelector<HTMLElement>('.td-line');
    const hours = Math.max(1, root.querySelectorAll('.td-grid .td-hr').length - 1);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    if (!line || !line.clientHeight) return;
    const noNext = root.classList.contains('cv-td-nonext');
    if (!noNext && line.clientHeight / hours < rem * 2.6) {
      // drawn again: the event boxes are sized from the timeline's height
      root.classList.add('cv-td-nonext');
      fitting = true;
      try {
        render();
      } finally {
        fitting = false;
      }
      return;
    }
    const per = line.clientHeight / hours;
    const step = [1, 2, 4, 6].find((n) => per * n >= rem * 2.2) ?? 6;
    for (const n of [2, 4, 6]) root.classList.toggle(`cv-td-step-${n}`, step === n);
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('view', `view-${kind}`, 'cv-view');
      // a static skeleton (views.ts); every value in it is written by the renderer
      root.innerHTML = SKELETON[kind];
      render();
    },
    update: () => render(),
    layout() {
      const m = root.dataset.mini !== undefined;
      if (m !== mini) {
        mini = m;
        root.classList.toggle('view', !m);
        root.classList.toggle(`view-${kind}`, !m);
        root.classList.toggle('cv-vmini', m);
        if (m) root.textContent = '';
        else root.innerHTML = SKELETON[kind];
        // (setHTML in views.ts skips a string it wrote last time: the next one is written whatever it is)
        delete (root as unknown as { __html?: string }).__html;
      }
      root.classList.remove('cv-td-nonext');
      render();
      if (mini) return;
      if (kind === 'today') fitTodayView(root);
      else fitPeopleView(root);
    },
    tick(t) {
      if (t.minuteChanged) render();
    },
    data(topic) {
      if (topic === 'events' || topic === 'config' || topic === 'weather') render();
    },
    destroy() {
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ next events
/** The next `count` things: what is on now or later today, then the next days; all-day ones of today first. */
export function nextEvents(events: NEvent[], t: Tick, count: number): NEvent[] {
  const now = t.now.getTime();
  const out = events
    .filter((e) => (e.timed ? e.endMs > now : e.spanLast >= t.dayKey))
    .sort((a, b) => {
      const ka = a.timed ? a.startMs : Date.parse(`${a.spanFirst < t.dayKey ? t.dayKey : a.spanFirst}T00:00:00Z`);
      const kb = b.timed ? b.startMs : Date.parse(`${b.spanFirst < t.dayKey ? t.dayKey : b.spanFirst}T00:00:00Z`);
      return ka - kb || a.title.localeCompare(b.title);
    });
  return out.slice(0, Math.max(1, count));
}

/**
 * The next event in a box larger than its words: the type grows with the box (up to three times, five past the named
 * sizes), so a wide or tall
 * card is not one small line in a band of empty space; never larger than the box holds.
 */
function fitNext(root: HTMLElement): void {
  root.style.removeProperty('--nx');
  const all = Array.from(root.querySelectorAll<HTMLElement>('.cv-next-ev, .cv-next-none'));
  for (const r of all) r.style.removeProperty('display');
  if (!all.length || !root.clientHeight || !root.clientWidth) return;
  const cs = getComputedStyle(root);
  const innerH = root.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  const innerW = root.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const main = !root.closest('.side');
  // a tall narrow box: the emoji over the words, so they get the whole width; a long low one (past the named sizes):
  // the events side by side, as many as get some 26rem each
  const row = main && all.length > 1 && innerW > innerH * 5;
  root.classList.toggle('is-stack', main && innerH > innerW * 1.4);
  root.classList.toggle('is-row', row);
  if (row) {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const fit = Math.max(1, Math.floor(innerW / (rem * 26)));
    all.forEach((r, i) => { if (i >= fit) r.style.display = 'none'; });
  }
  // the events that fit whole at 100 % (the later ones are left out, the first always stays)
  for (let i = all.length - 1; i > 0 && (root.scrollHeight > root.clientHeight + 1); i--) all[i].style.display = 'none';
  const rows = all.filter((r) => r.style.display !== 'none');
  // the natural size of the rows at 1: their height and their widest line (the words are not cut yet)
  const gap = parseFloat(cs.rowGap) || 0;
  const h = row ? Math.max(...rows.map((r) => r.offsetHeight)) : rows.reduce((a, r) => a + r.offsetHeight, 0) + gap * (rows.length - 1);
  const w = Math.max(...rows.map((r) => {
    const em = r.querySelector<HTMLElement>('.cv-next-em');
    const words = Array.from(r.querySelectorAll<HTMLElement>('.cv-next-when, .cv-next-tt, .cv-next-none'));
    const ww = Math.max(0, ...words.map((x) => x.scrollWidth));
    return em ? (root.classList.contains('is-stack') ? Math.max(em.offsetWidth, ww) : em.offsetWidth + 14 + ww) : ww;
  }));
  if (!h || !w) return;
  // (a narrow box: a little smaller, down to 80 %, before the title ends in …)
  const k = Math.max(0.8, Math.min(root.dataset.room !== undefined ? 5 : 3, (innerH * 0.72) / h, ((row ? innerW / rows.length : innerW) * 0.92) / w));
  if (Math.abs(k - 1) < 0.05) return;
  root.style.setProperty('--nx', k.toFixed(3));
  const floor = Math.min(1, k);
  for (let i = 0; i < 12 && (root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1); i++) {
    const nx = Math.max(floor, parseFloat(root.style.getPropertyValue('--nx')) * 0.97);
    root.style.setProperty('--nx', nx.toFixed(3));
  }
}

function next(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let sig = '';
  const render = () => {
    const t = env.now();
    const p = env.item().props as Props;
    const list = nextEvents(eventsOf(env, t), t, Math.min(6, Math.max(1, Number(p.count) || 1)));
    const dt = env.cfg().datetime;
    const rows = list.map((e) => {
      const today = e.timed ? e.startKey === t.dayKey : e.spanFirst <= t.dayKey;
      const now = e.timed && e.startMs <= t.now.getTime();
      let when: string;
      if (!e.timed) when = today ? ctx.t('today') : relativeDayLabel(ctx.lang, e.spanFirst, t.dayKey);
      else if (now) when = ctx.t('happeningNow');
      else if (p.relative !== false && today) when = formatCountdown(ctx.lang, e.startMs - t.now.getTime());
      else {
        const hm = formatTime(new Date(e.startMs), ctx.tz, dt.format24, dt.showAmPm);
        when = today ? hm : `${relativeDayLabel(ctx.lang, e.startKey, t.dayKey)} ${hm}`;
      }
      return { e, when, now };
    });
    const s = JSON.stringify(rows.map((r) => [r.e.id, r.e.title, r.e.emoji, r.e.color, r.when, r.now]));
    if (s === sig) return;
    sig = s;
    root.textContent = '';
    if (!rows.length) {
      const none = document.createElement('div');
      none.className = 'cv-next-none';
      none.textContent = ctx.t('noUpcoming');
      root.appendChild(none);
      return;
    }
    for (const r of rows) {
      const c = chipColors(r.e.color);
      const row = document.createElement('div');
      row.className = `cv-next-ev${r.now ? ' is-now' : ''}`;
      row.style.setProperty('--c', c.base);
      row.style.setProperty('--tint', c.tint);
      // the deeper shade: the day on a light card (the pale tint is made for dark glass)
      row.style.setProperty('--deep', c.shade);
      const em = document.createElement('span');
      em.className = 'cv-next-em';
      if (r.e.emoji) em.textContent = r.e.emoji;
      else em.appendChild(Object.assign(document.createElement('i'), { className: 'cv-next-dot' }));
      const txt = document.createElement('span');
      txt.className = 'cv-next-txt';
      const k = document.createElement('span');
      k.className = 'cv-next-when';
      k.textContent = r.when;
      const tt = document.createElement('span');
      tt.className = 'cv-next-tt';
      tt.textContent = r.e.title;
      txt.append(k, tt);
      row.append(em, txt);
      root.appendChild(row);
    }
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-next');
      render();
    },
    update() {
      sig = '';
      render();
      fitNext(root);
    },
    layout: () => fitNext(root),
    tick(t) {
      if (t.minuteChanged) {
        render();
        fitNext(root);
      }
    },
    data(topic) {
      if (topic === 'events' || topic === 'config') {
        render();
        fitNext(root);
      }
    },
    destroy() {
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ countdowns
function countdowns(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let cds: Countdowns;
  let card: HTMLElement;
  // the rows that fit whole: later ones are left out instead of being cut at the bottom of the card
  const fit = () => {
    const rows = [...card.querySelectorAll<HTMLElement>('.cd')];
    for (const r of rows) r.style.removeProperty('display');
    if (!root.clientHeight) return;
    // a card one row high: one countdown, the nearest
    if (root.dataset.mini !== undefined && root.dataset.mh === '1') rows.slice(1).forEach((r) => (r.style.display = 'none'));
    for (let i = rows.length - 1; i > 0 && (root.scrollHeight > root.clientHeight + 2 || root.scrollWidth > root.clientWidth + 2); i--) rows[i].style.display = 'none';
  };
  const render = () => {
    root.classList.toggle('is-cards', (env.item().props as Props).style === 'cards');
    cds.render(state.countdowns, env.now().dayKey);
    fit();
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-cd');
      card = document.createElement('div');
      const strip = document.createElement('div');
      strip.hidden = true;
      root.append(card, strip);
      cds = new Countdowns(card, strip, { cfg: env.cfg });
      render();
    },
    update: () => render(),
    layout(box) {
      // a small box (the compact look): one line per countdown (emoji, title ending in …, days), as many as fit
      const mini = root.dataset.mini !== undefined;
      root.classList.toggle('is-mline', mini);
      root.classList.toggle('is-narrow', !mini && box.w / box.rem < 40);
      // a long low box past the named sizes: the countdowns in two or three columns, read down each one
      const n = card.querySelectorAll('.cd').length;
      // (on screen: the box handed here is in the card's own pixels, smaller once it grows)
      const r = root.getBoundingClientRect();
      const cols = root.dataset.room !== undefined && !root.classList.contains('is-cards') && r.height / box.rem < 40 ? Math.max(1, Math.min(3, n, Math.floor(r.width / box.rem / 40))) : 1;
      root.classList.toggle('is-cols', cols > 1);
      root.style.setProperty('--cd-rows', String(Math.ceil(n / cols)));
      // a narrow line: the emoji goes before the title would show only a letter or two
      root.classList.remove('is-noem');
      if (mini) {
        const tt = card.querySelector<HTMLElement>('.cd-tt');
        if (tt && tt.scrollWidth > tt.clientWidth + 1 && tt.clientWidth < (parseFloat(getComputedStyle(tt).fontSize) || 16) * 4.5) root.classList.add('is-noem');
      }
      fit();
    },
    tick(t) {
      if (t.dayChanged) render();
    },
    data(topic) {
      if (topic === 'countdowns' || topic === 'config') render();
    },
    empty: () => card.style.display === 'none',
    destroy() {
      root.textContent = '';
    },
  };
}

export const CALENDAR_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  'calendar.month': grid,
  'calendar.week': grid,
  'calendar.agenda': agenda,
  'calendar.today': () => view('today'),
  'calendar.people': () => view('people'),
  'calendar.next': next,
  countdowns,
};
