// Personalizado clocks: digital (the screen clock with the item's options), analog (four faces), flip, world clocks and
// the date card. Text is written with textContent; the only markup comes from static strings and the face SVG.
import type { DisplayCanvasItem } from '../../../shared/types';
import { dateKeyInTz, diffDays, formatDateLine, formatTime, keyToUTC, monthName, pad2, weekdayName } from '../../../shared/i18n';
import { ctx } from '../../ctx';
import { reducedMotion } from '../../dom';
import { ICON } from '../../icons';
import type { Tick } from '../../time';
import { Clock } from '../clock';
import { type AnalogFace, Dial } from '../clock-faces';
import type { AdapterBox, AdapterEnv, CanvasAdapter } from './types';
import { screenWeather } from '../../weatherPlaces';

type Props = Record<string, any>;
const props = (env: AdapterEnv) => env.item().props as Props;

/**
 * Big type follows the box: --wk = clamp(.6, h / nominal height, 2.4) × the item's text scale, and never more than
 * the width allows when `nominalW` (the content's width at --wk 1, in rem) is given.
 */
export function bigType(root: HTMLElement, box: AdapterBox, nominalRem: number, scale = 1, nominalW = 0, max = 2.4): number {
  let k = box.h / box.rem / nominalRem;
  if (nominalW > 0) k = Math.min(k, box.w / box.rem / nominalW);
  const wk = Math.min(max, Math.max(0.6, k)) * scale;
  root.style.setProperty('--wk', wk.toFixed(3));
  return wk;
}

const scaleOf = (env: AdapterEnv) => Number(env.item().style?.scale) || 1;

const HEX = /^#[0-9a-f]{6}$/i;
/**
 * "Color de la hora" and "Color de la fecha" (props timeColor, dateColor; canvasCore INK_PROPS): .cv-tc and .cv-dc
 * on the card's body with --cv-tc and --cv-dc (styles-canvas.css). None set: nothing changes, the usual look.
 */
function applyInk(root: HTMLElement, env: AdapterEnv): void {
  const p = props(env);
  for (const [k, cls, v] of [['timeColor', 'cv-tc', '--cv-tc'], ['dateColor', 'cv-dc', '--cv-dc']] as const) {
    const c = typeof p[k] === 'string' && HEX.test(p[k]) ? (p[k] as string) : null;
    root.classList.toggle(cls, !!c);
    if (c) root.style.setProperty(v, c);
    else root.style.removeProperty(v);
  }
}

/** The largest type size of bigType for a card: larger in a box past its kind's named sizes (data-room, canvas.ts). */
export const typeCap = (root: HTMLElement): number => (root.dataset.room !== undefined ? 4 : 2.4);

/**
 * A text size above 100 % grows the type of a card that fills its box (a clock, the date) only as far as the box
 * holds it: measured like the cramped mark, never smaller than at 100 %. At 100 % and below nothing changes.
 */
export function keepInBox(root: HTMLElement, wk: number, scale: number): number {
  if (scale <= 1) return wk;
  const floor = wk / scale;
  for (let i = 0; i < 4 && wk > floor; i++) {
    const h = root.clientHeight;
    const w = root.clientWidth;
    if (!h || !w) break;
    // the cramped mark's own test (canvas.ts flags())
    if (root.scrollHeight <= h + 2 && root.scrollWidth <= w + 2) break;
    const over = Math.max(root.scrollHeight / h, root.scrollWidth / w);
    wk = Math.max(floor, (wk / over) * 0.98);
    root.style.setProperty('--wk', wk.toFixed(3));
  }
  return wk;
}

/**
 * The type a card's box gives (bigType) can still leave its content a little taller or wider than the box when it
 * carries extra lines (the date's week number, sunrise and sunset): scale --wk down until it fits, as the cramped
 * mark measures it, so a card that does fit on screen is never marked "No cabe".
 */
export function shrinkToBox(root: HTMLElement, wk: number): number {
  for (let i = 0; i < 4; i++) {
    const h = root.clientHeight;
    const w = root.clientWidth;
    if (!h || !w) break;
    if (root.scrollHeight <= h + 2 && root.scrollWidth <= w + 2) break;
    const over = Math.max(root.scrollHeight / h, root.scrollWidth / w);
    const next = Math.max(0.3, (wk / over) * 0.97);
    if (next >= wk) break;
    wk = next;
    root.style.setProperty('--wk', wk.toFixed(3));
  }
  return wk;
}

/**
 * After bigType: when `el` (sized in em of --wk) is still wider than the room inside `root`, scale --wk down so it
 * fits (measured, so digit widths, gaps and padding all count).
 */
export function fitWidth(root: HTMLElement, el: HTMLElement | null, wk: number): number {
  if (!el) return wk;
  const cs = getComputedStyle(root);
  const room = root.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const w = el.getBoundingClientRect().width;
  if (room <= 0 || w <= room) return wk;
  const k = Math.max(0.3, (wk * room) / w * 0.98);
  root.style.setProperty('--wk', k.toFixed(3));
  return k;
}

/** A one-line text that is wider than its box gets a smaller font (down to 70%), then the ellipsis. */
export function shrinkLine(el: HTMLElement | null): void {
  if (!el) return;
  el.style.fontSize = '';
  const w = el.scrollWidth;
  const room = el.clientWidth;
  if (!room || w <= room) return;
  const size = parseFloat(getComputedStyle(el).fontSize) || 0;
  if (size) el.style.fontSize = `${Math.max(size * 0.7, (size * room) / w * 0.98).toFixed(1)}px`;
}

/** A box only the fine grid has (canvas.ts miniMark): the compact look of the clocks and the date. */
export const isMini = (root: HTMLElement): boolean => root.dataset.mini !== undefined;

/**
 * Type of a card in a box only the fine grid has: like bigType, from the box's height and width, but with no floor
 * (bigType never goes under 0.6, too large for a line half a normal row high), then shrunk until it fits.
 */
function miniType(root: HTMLElement, box: AdapterBox, nominalRem: number, nominalW: number, scale: number): number {
  const k = Math.min(box.h / box.rem / nominalRem, nominalW > 0 ? box.w / box.rem / nominalW : Infinity);
  const wk = Math.min(2.4, Math.max(0.2, k)) * scale;
  root.style.setProperty('--wk', wk.toFixed(3));
  return shrinkToBox(root, wk);
}

/** Above 100 %, a new minute (wider digits, another day) is fitted again, so it stays inside its box. */
function refit(t: Tick, scale: number, box: AdapterBox | null, a: CanvasAdapter): void {
  if (scale > 1 && box && t.minuteChanged) a.layout?.(box);
}

// ------------------------------------------------------------------------------------------------ digital
export function digitalClock(): CanvasAdapter {
  let fitBox: AdapterBox | null = null;
  let root: HTMLElement;
  let env: AdapterEnv;
  let clock: Clock;
  let seconds = false;
  const apply = () => {
    const p = props(env);
    root.classList.toggle('cv-nodate', p.showDate === false);
    root.classList.toggle('cv-date-above', p.datePos === 'above');
    root.dataset.weight = p.weight === 'light' || p.weight === 'bold' ? p.weight : 'regular';
    applyInk(root, env);
    clock.update(env.now());
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-clock');
      const inner = document.createElement('div');
      root.appendChild(inner);
      seconds = !!props(env).seconds;
      clock = new Clock(inner, { cfg: env.cfg, seconds });
      apply();
    },
    update() {
      // the seconds option is fixed per Clock: a new one only when it changes
      if (!!props(env).seconds !== seconds) {
        seconds = !seconds;
        const inner = root.firstElementChild as HTMLElement;
        const fresh = document.createElement('div');
        inner.replaceWith(fresh);
        clock = new Clock(fresh, { cfg: env.cfg, seconds });
      }
      apply();
    },
    layout(box) {
      fitBox = box;
      const mini = isMini(root);
      // a line (one row of the fine grid): the time with the date beside it, or alone when the date does not fit
      const line = mini && box.h < box.w / 2;
      root.classList.toggle('is-mline', line);
      root.classList.remove('is-mnodate');
      if (mini) {
        const date = props(env).showDate !== false;
        if (line) {
          root.classList.add('is-mnodate');
          const full = miniType(root, box, 11, 0, scaleOf(env));
          if (!date) return;
          root.classList.remove('is-mnodate');
          const wk = miniType(root, box, 11, 0, scaleOf(env));
          const d = root.querySelector<HTMLElement>('.date');
          // the date shrinks the time, or is cut: the time alone
          if (wk < full * 0.92 || (d && d.scrollWidth > d.clientWidth + 1)) {
            root.classList.add('is-mnodate');
            miniType(root, box, 11, 0, scaleOf(env));
          }
          return;
        }
        miniType(root, box, date ? 16 : 12, 30, scaleOf(env));
        shrinkLine(root.querySelector<HTMLElement>('.date'));
        return;
      }
      keepInBox(root, bigType(root, box, props(env).showDate === false ? 13 : 17, scaleOf(env), 30), scaleOf(env));
      shrinkLine(root.querySelector<HTMLElement>('.date'));
    },
    tick(t) {
      clock.update(t);
      if (t.dayChanged) shrinkLine(root.querySelector<HTMLElement>('.date'));
      refit(t, scaleOf(env), fitBox, this);
    },
    destroy() {
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ analog
export function analogClock(): CanvasAdapter {
  let root: HTMLElement;
  let env: AdapterEnv;
  let dial: Dial;
  let dateEl: HTMLElement;
  let sig = '';
  const build = () => {
    const p = props(env);
    const seconds = !!p.seconds && !env.low();
    const s = `${p.face}|${seconds}`;
    if (s !== sig) {
      sig = s;
      const box = root.querySelector<HTMLElement>('.cv-dial')!;
      box.className = 'cv-dial';
      dial = new Dial(box, (['classic', 'minimal', 'dots', 'numbers'].includes(p.face) ? p.face : 'classic') as AnalogFace, seconds, ctx.tz);
    }
    dateEl.hidden = !p.showDate;
    root.classList.toggle('cv-date-above', p.datePos === 'above');
    applyInk(root, env);
    render(env.now());
  };
  const render = (t: Tick) => {
    dial.set(t.now);
    if (!dateEl.hidden) dateEl.textContent = formatDateLine(ctx.lang, t.dayKey, env.cfg().datetime.dateFormat, env.cfg().datetime.dateCustom);
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-analog');
      root.innerHTML = '<div class="cv-dial"></div><div class="cv-date"></div>';
      dateEl = root.querySelector('.cv-date')!;
      build();
    },
    update: () => build(),
    tick: (t) => render(t),
    destroy() {
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ flip
export function flipClock(): CanvasAdapter {
  let fitBox: AdapterBox | null = null;
  let root: HTMLElement;
  let env: AdapterEnv;
  let digits: HTMLElement[] = [];
  let dateEl: HTMLElement;
  let last = '';
  const render = (t: Tick, animate: boolean) => {
    const dt = env.cfg().datetime;
    let h = t.parts.hour;
    if (!dt.format24) h = h % 12 === 0 ? 12 : h % 12;
    const s = `${dt.format24 ? pad2(h) : String(h).padStart(2, ' ')}${pad2(t.parts.minute)}`;
    if (s !== last) {
      const prev = last;
      last = s;
      digits.forEach((d, i) => {
        const ch = s[i].trim();
        if (d.textContent === ch) return;
        d.textContent = ch;
        if (animate && prev && !env.low() && !reducedMotion()) {
          d.classList.remove('flip');
          void d.offsetWidth;
          d.classList.add('flip');
        }
      });
    }
    dateEl.hidden = !props(env).showDate;
    root.classList.toggle('cv-date-above', props(env).datePos === 'above');
    if (!dateEl.hidden) dateEl.textContent = formatDateLine(ctx.lang, t.dayKey, dt.dateFormat, dt.dateCustom);
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-flip');
      root.innerHTML = '<div class="cv-flip-row"><span class="fd"></span><span class="fd"></span><span class="fc">:</span><span class="fd"></span><span class="fd"></span></div><div class="cv-date"></div>';
      digits = Array.from(root.querySelectorAll<HTMLElement>('.fd'));
      dateEl = root.querySelector('.cv-date')!;
      applyInk(root, env);
      render(env.now(), false);
    },
    update() {
      last = '';
      applyInk(root, env);
      render(env.now(), false);
    },
    layout(box) {
      fitBox = box;
      if (isMini(root)) {
        // a line (one row of the fine grid): the digits alone; a small block: the digits and the date, smaller
        const line = box.h < box.w / 2.5;
        root.classList.toggle('is-mnodate', line);
        const wk = miniType(root, box, props(env).showDate && !line ? 15 : 11, 33, scaleOf(env));
        shrinkToBox(root, fitWidth(root, root.querySelector<HTMLElement>('.cv-flip-row'), wk));
        return;
      }
      root.classList.remove('is-mnodate');
      const wk = bigType(root, box, props(env).showDate ? 17 : 13, scaleOf(env), 33);
      keepInBox(root, fitWidth(root, root.querySelector<HTMLElement>('.cv-flip-row'), wk), scaleOf(env));
    },
    tick(t) {
      if (t.minuteChanged) render(t, true);
      refit(t, scaleOf(env), fitBox, this);
    },
    destroy() {
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ world
export function worldClock(): CanvasAdapter {
  let fitBox: AdapterBox | null = null;
  let root: HTMLElement;
  let env: AdapterEnv;
  let rows: { tz: string; time: HTMLElement; off: HTMLElement; dial: Dial | null }[] = [];
  const build = () => {
    const p = props(env);
    const zones: { tz: string; label: string }[] = Array.isArray(p.zones) ? p.zones : [];
    root.classList.toggle('is-analog', !!p.analog);
    applyInk(root, env);
    root.textContent = '';
    rows = zones.slice(0, 8).map((z) => {
      const row = document.createElement('div');
      row.className = 'cv-zone';
      const dialEl = document.createElement('div');
      const name = document.createElement('span');
      name.className = 'cv-zone-name';
      name.textContent = z.label || z.tz.split('/').pop()!.replace(/_/g, ' ');
      const time = document.createElement('b');
      time.className = 'cv-zone-time';
      const off = document.createElement('em');
      off.className = 'cv-zone-off';
      let dial: Dial | null = null;
      if (p.analog) {
        dialEl.className = 'cv-zone-dial';
        row.appendChild(dialEl);
        dial = new Dial(dialEl, 'minimal', false, z.tz);
      }
      row.append(name, time, off);
      root.appendChild(row);
      return { tz: z.tz, time, off, dial };
    });
    render(env.now());
  };
  const render = (t: Tick) => {
    const dt = env.cfg().datetime;
    for (const r of rows) {
      r.time.textContent = formatTime(t.now, r.tz, dt.format24, dt.showAmPm);
      // the zone's day against the screen's: "+1" when it is already tomorrow there
      const d = diffDays(t.dayKey, dateKeyInTz(t.now, r.tz));
      r.off.textContent = d > 0 ? `+${d}` : d < 0 ? `-${-d}` : '';
      r.dial?.set(t.now);
    }
    root.classList.toggle('has-off', rows.some((r) => r.off.textContent));
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-world');
      build();
    },
    update: () => build(),
    layout(box) {
      fitBox = box;
      const p0 = () => props(env);
      // the cities in one column, or in two or three side by side when that gives them larger type (a wide box, many
      // cities); a big box lets the type grow past what the named sizes need
      const n = Math.max(1, rows.length);
      const kOf = (c: number) => Math.min(box.h / box.rem / (5.2 * Math.ceil(n / c)), box.w / box.rem / (26 * c + 4 * (c - 1)));
      let cols = 1;
      for (let c = 2; c <= Math.min(3, n); c++) if (kOf(c) > kOf(cols) * 1.15) cols = c;
      // a tall narrow box of the main grid: each city's name over its time
      let stack = box.zone === 'main' && !p0().analog && box.h > box.w * 1.6 && Math.min(box.h / box.rem / (8 * n), box.w / box.rem / 15) > kOf(cols) * 1.15;
      if (stack) cols = 1;
      root.classList.toggle('is-stack', stack);
      root.classList.toggle('is-cols', cols > 1);
      root.style.setProperty('--cols', String(cols));
      let wk = keepInBox(root, stack ? bigType(root, box, 8 * n, scaleOf(env), 15, 4) : bigType(root, box, 5.2 * Math.ceil(n / cols), scaleOf(env), 26 * cols + 4 * (cols - 1), 4), scaleOf(env));
      // stacked and still too big: a line each, as before
      if (stack && (root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1)) {
        stack = false;
        root.classList.remove('is-stack');
        wk = keepInBox(root, bigType(root, box, 5.2 * n, scaleOf(env), 26, 4), scaleOf(env));
      }
      // a narrow box: a little smaller type before a city's name ends in …
      const names = [...root.querySelectorAll<HTMLElement>('.cv-zone-name')];
      const floor = wk * 0.75;
      for (let i = 0; i < 6 && wk > floor && names.some((n) => n.scrollWidth > n.clientWidth + 1); i++) {
        wk = Math.max(floor, wk * 0.94);
        root.style.setProperty('--wk', wk.toFixed(3));
      }
      // a box only the fine grid has: smaller type than bigType's floor when the cities need it
      if (isMini(root)) shrinkToBox(root, wk);
    },
    tick(t) {
      if (t.minuteChanged) render(t);
      refit(t, scaleOf(env), fitBox, this);
    },
    destroy() {
      root.textContent = '';
    },
  };
}

/** ISO 8601 week number of a date key. */
export function isoWeek(key: string): number {
  const d = keyToUTC(key);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}

// ------------------------------------------------------------------------------------------------ date
export function dateCard(): CanvasAdapter {
  let fitBox: AdapterBox | null = null;
  let root: HTMLElement;
  let env: AdapterEnv;
  let key = '';
  // a line in a box only the fine grid has: "Vie 16 oct" (layout() decides)
  let mline = false;
  const render = (t: Tick, force = false) => {
    const p = props(env);
    const w = screenWeather()?.today;
    applyInk(root, env);
    // the weekday takes the date colour too, unless the card has its own accent colour (the weekday's usual colour)
    root.classList.toggle('cv-dc-wd', !env.item().style?.accent);
    const sig = `${t.dayKey}|${p.style}|${p.weekday}|${p.isoWeek}|${p.sun}|${w?.sunrise ?? ''}|${w?.sunset ?? ''}|${ctx.lang}|${mline}`;
    if (sig === key && !force) return;
    key = sig;
    const lang = ctx.lang;
    const d = keyToUTC(t.dayKey);
    root.textContent = '';
    root.classList.toggle('is-line', p.style === 'line' || mline);
    root.classList.toggle('is-mline', mline);
    if (mline) {
      // the short weekday, the day and the short month, the weekday in its colour
      const line = document.createElement('div');
      line.className = 'cv-date-line';
      const wd = Object.assign(document.createElement('span'), { className: 'cv-date-wd', textContent: weekdayName(lang, t.dayKey, 'short') });
      line.append(wd, ` ${d.getUTCDate()} ${monthName(lang, d.getUTCMonth() + 1, 'short')}`);
      root.appendChild(line);
      return;
    }
    if (p.style === 'line') {
      const line = document.createElement('div');
      line.className = 'cv-date-line';
      line.textContent = formatDateLine(lang, t.dayKey, env.cfg().datetime.dateFormat, env.cfg().datetime.dateCustom);
      root.appendChild(line);
    } else {
      const wd = document.createElement('div');
      wd.className = 'cv-date-wd';
      wd.textContent = weekdayName(lang, t.dayKey, 'long');
      const num = document.createElement('div');
      num.className = 'cv-date-num';
      num.textContent = String(d.getUTCDate());
      const mo = document.createElement('div');
      mo.className = 'cv-date-mo';
      mo.textContent = `${monthName(lang, d.getUTCMonth() + 1)} ${d.getUTCFullYear()}`;
      // the weekday on top (as a calendar page) or under the date
      if (p.weekday === 'below') root.append(num, mo, wd);
      else root.append(wd, num, mo);
    }
    const extra: string[] = [];
    if (p.isoWeek) extra.push(ctx.t('cvWeek', { n: isoWeek(t.dayKey) }));
    const metaEl = document.createElement('div');
    metaEl.className = 'cv-date-meta';
    for (const x of extra) {
      const s = document.createElement('span');
      s.textContent = x;
      metaEl.appendChild(s);
    }
    if (p.sun && w && (w.sunrise || w.sunset)) {
      const dt = env.cfg().datetime;
      for (const [icon, iso] of [[ICON.sunrise, w.sunrise], [ICON.sunset, w.sunset]] as const) {
        if (!iso) continue;
        const s = document.createElement('span');
        // the icon is a static SVG string from icons.ts; the time is text
        s.innerHTML = icon;
        const b = document.createElement('b');
        b.textContent = formatTime(new Date(iso), ctx.tz, dt.format24, dt.showAmPm);
        s.appendChild(b);
        metaEl.appendChild(s);
      }
    }
    if (metaEl.childElementCount) root.appendChild(metaEl);
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-datecard');
      render(env.now());
    },
    update() {
      render(env.now(), true);
      // a line more or less (the week, sunrise and sunset): fitted again
      if (fitBox) this.layout?.(fitBox);
    },
    layout(box) {
      fitBox = box;
      const mini = isMini(root);
      const line = mini && box.h < box.w / 2;
      if (line !== mline) {
        mline = line;
        render(env.now(), true);
      }
      if (line) {
        miniType(root, box, 5.6, 20, scaleOf(env));
        return;
      }
      if (mini) {
        miniType(root, box, (props(env).style === 'line' ? 7 : 18) + (root.querySelector('.cv-date-meta') ? 4 : 0), 20, scaleOf(env));
        return;
      }
      shrinkToBox(root, keepInBox(root, bigType(root, box, 18, scaleOf(env), 20, 4), scaleOf(env)));
    },
    tick(t) {
      if (t.minuteChanged) render(t);
      refit(t, scaleOf(env), fitBox, this);
    },
    data(topic) {
      if (topic === 'weather') render(env.now(), true);
    },
    destroy() {
      root.textContent = '';
    },
  };
}

/** Kind → adapter of this family. */
export const CLOCK_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  'clock.digital': digitalClock,
  'clock.analog': analogClock,
  'clock.flip': flipClock,
  'clock.world': worldClock,
  date: dateCard,
};
