// Personalizado weather: the conditions now, the next hours and the next days, from the screen's weather (the same
// data and icons as the side panel) or a place of the card's own (#11), and "Tiempo en varias ciudades" (a few places
// at once). Values are written as text; icons are the static SVG strings of icons.ts.
import type { DisplayCanvasItem, WeatherResponse } from '../../../shared/types';
import { diffDays, formatTime, weekdayName, zonedParts } from '../../../shared/i18n';
import { ctx } from '../../ctx';
import { ICON, weatherIcon } from '../../icons';
import { placeLabel } from '../../../../server/core/weatherPlaces.js';
import { placeWeather } from '../../weatherPlaces';
import { sourceCredit } from '../weather';
import { bigType, isMini, keepInBox, shrinkToBox } from './clock';
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
  const weather = () => placeWeather((env.item().props as Props).place);
  const render = (force = false) => {
    const w = weather();
    const s = `${w?.placeKey ?? ''}|${w?.updatedAt ?? ''}|${w?.current?.temp ?? ''}|${env.item().v}|${env.now().dayKey}|${ctx.lang}`;
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
      // a small box (the compact look): one line (or a small block) of its own (miniNow, miniStrip)
      if (root.dataset.mini !== undefined) {
        if (cls === 'cv-wx-now') return miniNow(root, box, Number(env.item().style?.scale) || 1);
        return miniStrip(root, box);
      }
      root.classList.remove('is-mstack', 'no-cond', 'is-few');
      for (const c of root.querySelectorAll<HTMLElement>('.cv-wx-hours .h[hidden], .cv-wx-days .d[hidden]')) c.hidden = false;
      if (!nominal) root.style.removeProperty('--wk');
      const caption = root.querySelector<HTMLElement>('.cv-wx-place');
      if (caption) caption.hidden = false;
      shape?.(root, box, env);
      // a place's name over the hours or the days: only when everything still fits with it
      if (caption && overflows(root)) caption.hidden = true;
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
    empty: () => !weather()?.current,
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
 * Tiempo ahora in a small box (the compact look, data-mini): the icon, the temperature and the sky in one line, or the
 * sky under them in a box about as high as wide; the details, the high and low and the place are left out. The type
 * fills the height, and gets smaller until the line fits; the sky goes first when it would read as a stub.
 */
function miniNow(root: HTMLElement, box: AdapterBox, scale: number): void {
  root.classList.remove('is-stack', 'is-big', 'is-centred', 'no-cond', ...RICH);
  const h = box.h / box.rem;
  const stack = h >= 9 && box.h > box.w * 0.55;
  root.classList.toggle('is-mstack', stack);
  // a block three cells or more each way (#9): what the larger card shows, in smaller type
  if (stack && Number(root.dataset.mw) >= 3 && Number(root.dataset.mh) >= 3 && miniRich(root, box, scale)) return;
  let wk = Math.min(2.4, Math.max(0.4, h / (stack ? 10.4 : 7.2))) * scale;
  root.style.setProperty('--wk', wk.toFixed(3));
  const cond = root.querySelector<HTMLElement>('.cv-wx-cond');
  if (cond && (isCut(cond) || cond.clientWidth < 5.5 * box.rem * Math.min(1, wk))) root.classList.add('no-cond');
  for (let i = 0; i < 16 && overflows(root) && wk > 0.35; i++) {
    wk *= 0.92;
    root.style.setProperty('--wk', wk.toFixed(3));
  }
}

const RICH = ['is-mrich', 'm-noloc', 'm-nohl', 'm-nolabel', 'm-nometa'];
/** What a block leaves out, one step at a time, until it fits: the place, the high and low, the labels, the details. */
const RICH_STEPS = [[], ['m-noloc'], ['m-noloc', 'm-nolabel'], ['m-noloc', 'm-nohl', 'm-nolabel'], ['m-noloc', 'm-nohl', 'm-nometa']];

/**
 * Tiempo ahora in a small block (the compact look): the icon and the temperature over the sky, the high and low, the
 * place and the details, like the card a size up, with type from the height made smaller until it fits; when it does
 * not fit at a size that still reads, the place goes, then the labels, the high and low and the details. False when
 * even the sky with the details does not fit (the small block of miniNow then).
 */
function miniRich(root: HTMLElement, box: AdapterBox, scale: number): boolean {
  const h = innerH(root, box);
  const floor = 0.62 * Math.min(1, scale);
  const lines = '.cv-wx-cond, .cv-wx-hl, .cv-wx-loc';
  const fits = () => !overflows(root) && ![...root.querySelectorAll<HTMLElement>(lines)].some(isCut);
  for (const step of RICH_STEPS) {
    root.classList.remove(...RICH);
    root.classList.add('is-mrich', ...step);
    let wk = Math.min(1.8, Math.max(floor, h / 14)) * scale;
    root.style.setProperty('--wk', wk.toFixed(3));
    for (let i = 0; i < 20 && !fits() && wk > floor; i++) {
      wk = Math.max(floor, wk * 0.93);
      root.style.setProperty('--wk', wk.toFixed(3));
    }
    if (fits()) return true;
  }
  root.classList.remove(...RICH);
  return false;
}

/**
 * Por horas and Previsión in a small box (the compact look): a strip of small hours or days (time or day, icon,
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

/** The hours and the days of a place of the card's own: its name in a small line on top (left out when it does not fit). */
function placeCaption(root: HTMLElement, p: Props): void {
  const name = p.place && typeof p.place === 'object' ? placeLabel(p.place) : '';
  if (name) root.appendChild(el('div', 'cv-wx-place', name));
}

function drawHourly(root: HTMLElement, w: WeatherResponse, env: AdapterEnv): void {
  const p = env.item().props as Props;
  const n = [6, 12, 24].includes(Number(p.hours)) ? Number(p.hours) : 12;
  const dt = env.cfg().datetime;
  placeCaption(root, p);
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
  placeCaption(root, p);
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

// ---------------------------------------------------------------------------------------------- weather.cities
type CityRow = { el: HTMLElement; key: string };

/**
 * "Tiempo en varias ciudades": a row (list) or a tile (grid) per place, with its sky, its temperature now, its name and
 * (highLow) the day's high and low. Laid out like the world clock: the rows in one column, or in two or three side by
 * side when a wide box gives them larger type; a grid has as many columns as make its tiles closest to square. In a box
 * in a small box (the compact look, data-mini) it is one line of places (sky, temperature, name), as many as fit whole.
 */
function citiesAdapter(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let rows: CityRow[] = [];
  let sig = '';
  let last: AdapterBox | null = null;
  const props = () => env.item().props as Props;
  const places = (): { name: string; lat: number; lon: number }[] => (Array.isArray(props().places) ? props().places : []).slice(0, 8);
  const build = (force = false) => {
    const list = places();
    const ws = list.map((p) => placeWeather(p));
    const s = `${ws.map((w) => `${w?.placeKey ?? ''}:${w?.updatedAt ?? ''}:${w?.current?.temp ?? ''}`).join(';')}|${env.item().v}|${env.now().dayKey}|${ctx.lang}|${env.low()}`;
    if (s === sig && !force) return;
    sig = s;
    root.textContent = '';
    root.classList.toggle('is-grid', props().layout === 'grid');
    const hl = props().highLow !== false;
    rows = list.map((p, i) => {
      const w = ws[i];
      const row = el('div', 'cv-city');
      const c = w?.current;
      row.appendChild(icon('cv-city-icon', c ? weatherIcon(c.code, c.isDay, { animated: false }) : ''));
      row.appendChild(el('span', 'cv-city-name', placeLabel(p) || placeLabel(w ? { name: w.locationName } : null) || '–'));
      row.appendChild(el('b', 'cv-city-temp', c ? `${r(c.temp)}°` : '–'));
      if (hl) row.appendChild(el('span', 'cv-city-hl', w?.today ? `${r(w.today.max)}° / ${r(w.today.min)}°` : ''));
      if (c?.description) row.title = c.description;
      root.appendChild(row);
      return { el: row, key: w?.placeKey ?? '' };
    });
    root.classList.toggle('has-hl', hl);
    if (last) api.layout!(last);
  };
  /** A narrow box: a little smaller type (down to three quarters) before a place's name ends in "...". */
  const shrinkNames = (wk: number): number => {
    const names = [...root.querySelectorAll<HTMLElement>('.cv-city-name')];
    const floor = wk * 0.75;
    for (let i = 0; i < 6 && wk > floor && names.some((x) => x.scrollWidth > x.clientWidth + 1); i++) {
      wk = Math.max(floor, wk * 0.94);
      root.style.setProperty('--wk', wk.toFixed(3));
    }
    return wk;
  };
  const api: CanvasAdapter = {
    mount(rt, e) {
      root = rt;
      env = e;
      root.classList.add('cv-wx', 'cv-wx-cities');
      build(true);
    },
    update: () => build(true),
    layout(box) {
      last = box;
      const scale = Number(env.item().style?.scale) || 1;
      for (const r0 of rows) r0.el.hidden = false;
      const n = Math.max(1, rows.length);
      const grid = props().layout === 'grid';
      if (isMini(root)) return miniCities(root, box, scale);
      root.classList.remove('is-mline', 'is-one');
      if (grid) {
        // the columns that make the tiles closest to square (a tile is about 12 by 11 rem at a type size of 1)
        let cols = 1;
        let best = 0;
        for (let c = 1; c <= n; c++) {
          const k = Math.min(box.h / box.rem / (11 * Math.ceil(n / c)), box.w / box.rem / (13 * c));
          if (k > best) {
            best = k;
            cols = c;
          }
        }
        root.style.setProperty('--cols', String(cols));
        let wk = keepInBox(root, bigType(root, box, 11 * Math.ceil(n / cols), scale, 13 * cols, 3), scale);
        shrinkNames(wk);
        wk = parseFloat(root.style.getPropertyValue('--wk')) || wk;
        shrinkToBox(root, wk);
        return;
      }
      const lineW = props().highLow !== false ? 30 : 22;
      // a line is about 3.5 rem high at a type size of 1 (the row and the gap under it)
      const kOf = (c: number) => Math.min(box.h / box.rem / (3.5 * Math.ceil(n / c)), box.w / box.rem / (lineW * c + 4 * (c - 1)));
      let cols = 1;
      for (let c = 2; c <= Math.min(3, n); c++) if (kOf(c) > kOf(cols) * 1.15) cols = c;
      root.classList.toggle('is-cols', cols > 1);
      root.style.setProperty('--cols', String(cols));
      const wk = keepInBox(root, bigType(root, box, 3.5 * Math.ceil(n / cols) + 1, scale, lineW * cols + 4 * (cols - 1), 3), scale);
      shrinkToBox(root, shrinkNames(wk));
    },
    tick(t) {
      if (t.minuteChanged) build();
    },
    data(topic) {
      if (topic === 'weather') build(true);
    },
    empty: () => !places().some((p) => placeWeather(p)?.current),
    destroy() {
      root.textContent = '';
    },
  };
  return api;
}

/**
 * Tiempo en varias ciudades in a small box (the compact look): one line of places (sky, temperature, name; no high and
 * low), the type filling the height, as many places as fit whole (the rest left out, never cut in half).
 */
function miniCities(root: HTMLElement, box: AdapterBox, scale: number): void {
  root.classList.remove('is-cols', 'is-grid');
  root.classList.add('is-mline');
  const h = innerH(root, box);
  let wk = Math.min(1.6, Math.max(0.35, h / 3.4)) * scale;
  root.style.setProperty('--wk', wk.toFixed(3));
  const cells = [...root.querySelectorAll<HTMLElement>('.cv-city')];
  for (let i = 0; i < 10 && wk > 0.35 && root.scrollHeight > root.clientHeight + 1; i++) {
    wk *= 0.92;
    root.style.setProperty('--wk', wk.toFixed(3));
  }
  const b = root.getBoundingClientRect();
  // the room inside the card's padding
  const right = b.right - (parseFloat(getComputedStyle(root).paddingRight) || 0);
  const out = () => cells.some((c) => {
    if (c.hidden) return false;
    const q = c.getBoundingClientRect();
    return q.right > right + 0.5 || q.bottom > b.bottom + 1;
  }) || root.scrollWidth > root.clientWidth + 1;
  root.classList.remove('is-one');
  for (let i = cells.length - 1; i > 0 && out(); i--) cells[i].hidden = true;
  // one place left and still too wide: its name may end in "...", then smaller type until it fits
  if (out()) root.classList.add('is-one');
  if (out()) shrinkToBox(root, wk);
}

export const WEATHER_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  'weather.cities': () => citiesAdapter(),
  'weather.now': () => weatherAdapter('cv-wx-now', drawNow, nowNominal),
  'weather.hourly': () => weatherAdapter('cv-wx-hourly', drawHourly, null, hourlyShape),
  'weather.forecast': () => weatherAdapter('cv-wx-forecast', drawForecast, null, forecastShape),
};
