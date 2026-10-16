// Personalizado weather: the conditions now, the next hours and the next days, from the screen's weather (the same
// data and icons as the side panel). Values are written as text; icons are the static SVG strings of icons.ts.
import type { DisplayCanvasItem, WeatherResponse } from '../../../shared/types';
import { diffDays, formatTime, weekdayName, zonedParts } from '../../../shared/i18n';
import { ctx } from '../../ctx';
import { ICON, weatherIcon } from '../../icons';
import { state } from '../../store';
import { sourceCredit } from '../weather';
import { bigType } from './clock';
import type { AdapterBox, AdapterEnv, CanvasAdapter } from './types';

type Props = Record<string, any>;
const r = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? '–' : String(Math.round(n)));
const has = (n: number | null | undefined): n is number => n !== null && n !== undefined && !Number.isNaN(n);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/** An icon element: `svg` is one of the static strings of icons.ts. */
function icon(cls: string, svg: string): HTMLElement {
  const e = el('span', cls);
  e.innerHTML = svg;
  return e;
}

/** One adapter that draws `draw(root, weather)` whenever the weather (or the item) changes. */
/**
 * The type size of a card that grows with its box: its height and width at a type size of 1, in rem, from the box (a
 * card may lay itself out for it first, as Tiempo ahora in a tall narrow box).
 */
type Nominal = (root: HTMLElement, box: AdapterBox) => [number, number];

function weatherAdapter(cls: string, draw: (root: HTMLElement, w: WeatherResponse, env: AdapterEnv) => void, nominal: Nominal | null = null, shape?: (root: HTMLElement, box: AdapterBox, env: AdapterEnv) => void): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let sig = '';
  let last: AdapterBox | null = null;
  const render = (force = false) => {
    const w = state.weather;
    const s = `${w?.updatedAt ?? ''}|${w?.current?.temp ?? ''}|${env.item().v}|${env.now().dayKey}|${ctx.lang}`;
    if (s === sig && !force) return;
    sig = s;
    root.textContent = '';
    if (!w?.current) return;
    draw(root, w, env);
    // new words: fitted to the box again
    if (last) api.layout!(last);
  };
  const api: CanvasAdapter = {
    mount(rt, e) {
      root = rt;
      env = e;
      root.classList.add('cv-wx', cls);
      render(true);
    },
    update: () => render(true),
    layout(box) {
      last = box;
      // today's high and low once on a screen: a forecast on it already opens with today's row
      if (cls === 'cv-wx-now') root.classList.toggle('no-hl', !!(root.closest('#app') ?? document).querySelector('.cv-wx-forecast'));
      // a box only the fine grid has: one line (or a small block) of its own (miniNow, miniStrip)
      if (root.dataset.mini !== undefined) {
        if (cls === 'cv-wx-now') return miniNow(root, box, Number(env.item().style?.scale) || 1);
        return miniStrip(root, box);
      }
      root.classList.remove('is-mstack', 'no-cond', 'is-few');
      for (const c of root.querySelectorAll<HTMLElement>('.cv-wx-hours .h[hidden], .cv-wx-days .d[hidden]')) c.hidden = false;
      if (!nominal) root.style.removeProperty('--wk');
      shape?.(root, box, env);
      if (!nominal) return;
      const [h, w] = nominal(root, box);
      bigType(root, box, h, Number(env.item().style?.scale) || 1, w, 4);
      // laid out over its height and still too big: as before, side by side
      if (root.classList.contains('is-stack') && (root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1)) {
        root.classList.remove('is-stack');
        bigType(root, box, 18, Number(env.item().style?.scale) || 1, 18 * 2.2, 4);
      }
      if (cls === 'cv-wx-now') fillNow(root, box);
    },
    tick(t) {
      if (t.minuteChanged) render();
    },
    data(topic) {
      if (topic === 'weather') render(true);
    },
    empty: () => !state.weather?.current,
    destroy() {
      root.textContent = '';
    },
  };
  return api;
}

function drawNow(root: HTMLElement, w: WeatherResponse, env: AdapterEnv): void {
  const p = env.item().props as Props;
  const c = w.current;
  const head = el('div', 'cv-wx-head');
  head.append(icon('cv-wx-icon', weatherIcon(c.code, c.isDay, { animated: !env.low() })), el('span', 'cv-wx-temp', `${r(c.temp)}°`));
  const side = el('div', 'cv-wx-side');
  side.append(el('span', 'cv-wx-cond', c.description || ''));
  if (w.today) side.append(el('span', 'cv-wx-hl', `${ctx.t('hiShort')} ${r(w.today.max)}° · ${ctx.t('loShort')} ${r(w.today.min)}°`));
  side.append(el('span', 'cv-wx-loc', (w.locationName || env.cfg().weather.locationName || '').split(',')[0].trim()));
  root.append(head, side);
  if (p.meta === false) return;
  const meta = el('div', 'cv-wx-meta');
  const m = (svg: string, text: string, label = '') => {
    const s = icon('m', svg);
    if (label) s.appendChild(el('em', '', label));
    s.appendChild(el('b', '', text));
    meta.appendChild(s);
  };
  if (p.feelsLike !== false && has(c.feelsLike)) m(ICON.thermo, `${r(c.feelsLike)}°`, ctx.t('feelsLike'));
  if (has(c.humidity)) m(ICON.drop, `${r(c.humidity)}%`);
  const wc = env.cfg().weather;
  if (has(c.windKmh)) m(ICON.wind, `${r(wc.units === 'imperial' ? c.windKmh / 1.609 : c.windKmh)} ${wc.units === 'imperial' ? 'mph' : 'km/h'}`);
  if (p.indoor && w.indoor && (w.indoor.temp !== null || w.indoor.humidity !== null)) m(ICON.home, w.indoor.temp !== null ? `${r(w.indoor.temp)}°` : `${r(w.indoor.humidity)}%`);
  // in a big box (.is-big): the chance of rain, sunrise and sunset too
  const extra = (svg: string, text: string) => {
    m(svg, text);
    meta.lastElementChild!.classList.add('is-extra');
  };
  if (w.today && has(w.today.precipChance)) extra(ICON.umbrella, `${r(w.today.precipChance)}%`);
  const dt = env.cfg().datetime;
  if (w.today?.sunrise) extra(ICON.sunrise, formatTime(new Date(w.today.sunrise), ctx.tz, dt.format24, dt.showAmPm));
  if (w.today?.sunset) extra(ICON.sunset, formatTime(new Date(w.today.sunset), ctx.tz, dt.format24, dt.showAmPm));
  if (meta.childElementCount) root.appendChild(meta);
  root.appendChild(el('span', 'wx-src', sourceCredit(w)));
}

/**
 * Tiempo ahora side by side: the type the box gives (bigType) is reckoned for a nominal shape, so in a box of another
 * shape the words stop short of its bottom or its right. Grow the type (up to half as large again) while everything
 * still fits whole: no line cut, the details on as many lines as before. Then, in a box still wider than the words,
 * the words are centred across it (.is-centred) instead of leaving a band on the right.
 */
function fillNow(root: HTMLElement, box: AdapterBox): void {
  root.classList.remove('is-centred');
  if (root.classList.contains('is-stack') || !root.childElementCount || !root.clientWidth || !root.clientHeight) return;
  // a line cut by its "..." (measured on the words themselves: scrollWidth rounds a cut of under a pixel away)
  const cut = () => [...root.querySelectorAll<HTMLElement>('.cv-wx-cond, .cv-wx-hl, .cv-wx-loc')].some((e) => {
    if (!e.offsetParent) return false;
    const range = document.createRange();
    range.selectNodeContents(e);
    return range.getBoundingClientRect().width > e.getBoundingClientRect().width - 2;
  });
  const rows = () => new Set([...root.querySelectorAll<HTMLElement>('.cv-wx-meta > .m')].filter((m) => m.offsetParent).map((m) => m.offsetTop)).size;
  const rows0 = rows();
  const fits = () => root.scrollHeight <= root.clientHeight + 1 && root.scrollWidth <= root.clientWidth + 1 && !cut() && rows() <= rows0;
  if (!fits()) return;
  const wk0 = parseFloat(root.style.getPropertyValue('--wk')) || 1;
  let wk = wk0;
  for (let i = 0; i < 12; i++) {
    const next = Math.min(wk0 * 1.5, wk * 1.05);
    if (next <= wk + 0.001) break;
    root.style.setProperty('--wk', next.toFixed(3));
    if (!fits()) break;
    wk = next;
  }
  root.style.setProperty('--wk', wk.toFixed(3));
  // the width the words take: the head and the words beside it, or the line of details when that is longer
  const r0 = root.getBoundingClientRect();
  let right = r0.left;
  for (const e of root.querySelectorAll<HTMLElement>('.cv-wx-head, .cv-wx-cond, .cv-wx-hl, .cv-wx-loc, .cv-wx-meta > .m')) {
    const range = document.createRange();
    range.selectNodeContents(e);
    right = Math.max(right, range.getBoundingClientRect().right);
  }
  const cs = getComputedStyle(root);
  const inner = r0.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const used = right - r0.left - (parseFloat(cs.paddingLeft) || 0);
  if (inner - used > inner * 0.08) root.classList.add('is-centred');
}

/** The height inside a card body's padding, in rem. */
const innerH = (root: HTMLElement, box: AdapterBox): number => {
  const cs = getComputedStyle(root);
  return (root.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)) / box.rem;
};

/** True when an element's words are cut by its "...". */
const isCut = (e: HTMLElement | null): boolean => !!e && !!e.offsetParent && e.scrollWidth > e.clientWidth + 1;
const overflows = (root: HTMLElement): boolean => root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1;

/**
 * Tiempo ahora in a box only the fine grid has (data-mini): the icon, the temperature and the sky in one line, or the
 * sky under them in a box about as high as wide; the details, the high and low and the place are left out. The type
 * fills the height, and gets smaller until the line fits; the sky goes first when it would read as a stub.
 */
function miniNow(root: HTMLElement, box: AdapterBox, scale: number): void {
  root.classList.remove('is-stack', 'is-big', 'is-centred', 'no-cond');
  const h = box.h / box.rem;
  const stack = h >= 9 && box.h > box.w * 0.55;
  root.classList.toggle('is-mstack', stack);
  let wk = Math.min(2.4, Math.max(0.4, h / (stack ? 10.4 : 7.2))) * scale;
  root.style.setProperty('--wk', wk.toFixed(3));
  const cond = root.querySelector<HTMLElement>('.cv-wx-cond');
  if (cond && (isCut(cond) || cond.clientWidth < 5.5 * box.rem * Math.min(1, wk))) root.classList.add('no-cond');
  for (let i = 0; i < 16 && overflows(root) && wk > 0.35; i++) {
    wk *= 0.92;
    root.style.setProperty('--wk', wk.toFixed(3));
  }
}

/**
 * Por horas and Previsión in a box only the fine grid has: a strip of small hours or days (time or day, icon,
 * temperature; the chance of rain and the low only when there is room), as many as fit whole.
 */
function miniStrip(root: HTMLElement, box: AdapterBox): void {
  root.classList.remove('is-grid', 'is-column');
  const h = innerH(root, box);
  // the chance of rain and the low only when there is room for them
  const few = h < 10;
  root.classList.toggle('is-few', few);
  // the type follows the height: the time or day, the icon and the temperature under each other (plus the low or the
  // chance of rain)
  let wk = Math.min(1.3, Math.max(0.5, h / (few ? 7.6 : 9.6)));
  root.style.setProperty('--wk', wk.toFixed(3));
  const cells = [...root.querySelectorAll<HTMLElement>('.cv-wx-hours .h, .cv-wx-days .d')];
  for (const c of cells) c.hidden = false;
  const row = cells[0]?.parentElement;
  if (!row) return;
  // a column taller than the strip (the chance of rain under a day): smaller type until each column fits
  for (let i = 0; i < 12 && wk > 0.5 && (row.scrollHeight > row.clientHeight + 1 || overflows(root)); i++) {
    wk *= 0.93;
    root.style.setProperty('--wk', wk.toFixed(3));
  }
  // as many as fit at their smallest width, the rest left out (never cut in half)
  const out = () => {
    const r = row.getBoundingClientRect();
    const b = root.getBoundingClientRect();
    return cells.some((c) => {
      if (c.hidden) return false;
      const q = c.getBoundingClientRect();
      return q.right > r.right + 1 || q.bottom > b.bottom + 1;
    }) || overflows(root);
  };
  for (let i = cells.length - 1; i > 0 && out(); i--) cells[i].hidden = true;
}

/**
 * Tiempo ahora: the icon and temperature beside the words, or over them in a tall narrow box of the main grid; the
 * chance of rain, sunrise and sunset as well in a box taller than its named sizes.
 */
const nowNominal: Nominal = (root, box) => {
  const stack = box.zone === 'main' && box.h > box.w * 1.6;
  root.classList.toggle('is-stack', stack);
  root.classList.toggle('is-big', box.zone === 'main' && box.h / box.rem >= 52);
  return stack ? [26, 18] : [18, 18 * 2.2];
};

function drawHourly(root: HTMLElement, w: WeatherResponse, env: AdapterEnv): void {
  const p = env.item().props as Props;
  const n = [6, 12, 24].includes(Number(p.hours)) ? Number(p.hours) : 12;
  const dt = env.cfg().datetime;
  const row = el('div', 'cv-wx-hours');
  (w.hourly ?? []).slice(0, n).forEach((h, i) => {
    const z = zonedParts(new Date(h.time), ctx.tz);
    const lbl = i === 0 ? ctx.t('now') : dt.format24 ? `${z.hour}` : `${z.hour % 12 === 0 ? 12 : z.hour % 12}${z.hour < 12 ? 'a' : 'p'}`;
    const cell = el('div', 'h');
    cell.append(el('span', 'hl', lbl), icon('hi', weatherIcon(h.code, h.isDay)));
    if (has(h.precipChance) && h.precipChance >= 20) cell.append(el('span', 'p', `${r(h.precipChance)}%`));
    cell.append(el('span', 'hv', `${r(h.temp)}°`));
    row.appendChild(cell);
  });
  root.appendChild(row);
}

function drawForecast(root: HTMLElement, w: WeatherResponse, env: AdapterEnv): void {
  const p = env.item().props as Props;
  const today = env.now().dayKey;
  const days = (w.daily ?? []).filter((d) => d.date >= today).slice(0, Math.min(7, Math.max(3, Number(p.days) || 5)));
  const all = days.flatMap((d) => [d.min, d.max]).filter(has);
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(1, hi - lo);
  const list = el('div', 'cv-wx-days');
  for (const d of days) {
    const cell = el('div', `d${diffDays(today, d.date) === 0 ? ' today' : ''}`);
    cell.append(el('span', 'dn', diffDays(today, d.date) === 0 ? ctx.t('today') : weekdayName(ctx.lang, d.date, 'short')), icon('di', weatherIcon(d.code, true)));
    if (has(d.precipChance) && d.precipChance >= 30) cell.append(el('span', 'p', `${r(d.precipChance)}%`));
    const bar = el('span', 'rng');
    const fill = el('i', '');
    fill.style.left = `${(((d.min - lo) / span) * 100).toFixed(0)}%`;
    fill.style.right = `${(100 - ((d.max - lo) / span) * 100).toFixed(0)}%`;
    bar.appendChild(fill);
    cell.append(el('span', 'dmn', `${r(d.min)}°`), bar, el('span', 'dmx', `${r(d.max)}°`));
    list.appendChild(cell);
  }
  root.appendChild(list);
}

/** The card's size on screen in rem (the box handed to layout is in its own pixels, smaller once the card grows). */
const onScreen = (root: HTMLElement, box: AdapterBox): [number, number] => {
  const r = root.getBoundingClientRect();
  return [r.width / box.rem, r.height / box.rem];
};

/**
 * Por horas in a box taller than its named sizes: the hours in two or three rows when that makes them closer to
 * square (a tall box), instead of one line of small hours over empty space.
 */
const hourlyShape = (root: HTMLElement, box: AdapterBox): void => {
  const [w, h] = onScreen(root, box);
  const n = root.querySelectorAll('.cv-wx-hours .h').length;
  const rows = Math.min(3, Math.max(1, Math.round(Math.sqrt((n * h) / (w * 1.6)))));
  const grid = box.zone === 'main' && h >= 60 && rows > 1 && n > rows;
  root.classList.toggle('is-grid', grid);
  if (grid) root.style.setProperty('--per', String(Math.ceil(n / rows)));
};

/** Previsión in a tall box of the main grid: a row per day, as with layout "column". */
const forecastShape = (root: HTMLElement, box: AdapterBox, env: AdapterEnv): void => {
  const [w, h] = onScreen(root, box);
  root.classList.toggle('is-column', (env.item().props as Props).layout === 'column' || (box.zone === 'main' && h > w * 1.3));
};

export const WEATHER_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  'weather.now': () => weatherAdapter('cv-wx-now', drawNow, nowNominal),
  'weather.hourly': () => weatherAdapter('cv-wx-hourly', drawHourly, null, hourlyShape),
  'weather.forecast': () => weatherAdapter('cv-wx-forecast', drawForecast, null, forecastShape),
};
