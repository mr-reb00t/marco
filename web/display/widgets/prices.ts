// The electricity price widget ('prices'): drawn by the display from GET /api/display/prices?zone= (the server
// fetches and caches the zone, server/prices.js). Placed by widgets/custom.ts like any widget: a corner, the side
// column or the whole screen (the 'widget' layout).
//
// Views (PriceWidgetOptions.view): 'now' (the price now, cheap / normal / expensive, next hour), 'chart' (bars from
// today 00:00, tomorrow added once published, now marked), 'cheap' (the cheapest stretches still ahead), 'next' (the
// next 24 hours as a list with a bar each, from the current hour) and 'auto' (by place: corner = now, large corner or
// side = now + chart, full screen = everything, or the next 24 hours on a portrait screen, where a list fits the
// height better than a wide chart).
// Prices include what the widget adds per hour (tariffsCore.js): a Danish grid company's tariffs (the server sends
// them with the prices, &grid=) or the household's time bands, then the fixed extra and VAT.
// Every time is in the household's time zone (ctx.tz): on DST days the chart has 23 or 25 hours.
import type { DisplayWidget, PricesResponse, PriceWidgetOptions } from '../../shared/types';
import {
  axisStep, cheapestWindows, DKK_PER_EUR, hourly, levelLimits, levelOf, localMidnight, priceLabelPicks, pricedSlots, priceUnit, priceZone, slotAt, trend, wallClock,
  widgetCurrency,
} from '../../../server/core/pricesCore.js';
import { gridCompany, tariffAdder, tariffMode } from '../../../server/core/tariffsCore.js';
import type { PricedSlot } from '../../../server/core/pricesCore.js';
import { LOCALES, formatHM } from '../../shared/i18n';
import { getJSON } from '../api';
import { ctx } from '../ctx';
import { fade } from './canvas/curve';

const POLL_MS = 10 * 60_000;
const RETRY_MS = 60_000;
const PENDING_MS = 20_000;
const SVG = 'http://www.w3.org/2000/svg';

// ------------------------------------------------------------------------------------------- data

interface Feed {
  subs: Set<(d: PricesResponse | null, failed: boolean) => void>;
  data: PricesResponse | null;
  failed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}
const feeds = new Map<string, Feed>();

/** Made-up prices for the demo when the server has none (?demo=1 without a server). */
function demoPrices(zone: string): PricesResponse {
  const tz = priceZone(zone)?.tz || ctx.tz;
  const start = localMidnight(Date.now(), tz, 0);
  const dkk = priceZone(zone)?.currency === 'DKK';
  const slots: PricesResponse['slots'] = [];
  for (let t = start; t < localMidnight(Date.now(), tz, 2); t += 15 * 60_000) {
    const p = wallClock(t, tz);
    const h = p.h + p.mi / 60;
    const g = (c: number, w: number) => Math.exp(-(((h - c) / w) ** 2));
    const eur = 80 + 70 * g(8, 1.6) + 120 * g(19.5, 2) - 46 * g(13, 2.4) - 22 * g(3.5, 2.2) + Math.sin(t / 3.7e6) * 5;
    slots.push(dkk ? [t / 1000, 15, eur, eur * 7.46] : [t / 1000, 15, eur]);
  }
  return { zone, currency: dkk ? 'DKK' : 'EUR', converted: false, source: 'demo', credit: 'Demo', fetchedAt: new Date().toISOString(), stale: false, error: null, slots };
}

/** The feed of a zone, with a grid company's tariffs when one is chosen: 'DK2' or 'DK2|radius'. */
const feedKey = (o: PriceWidgetOptions | undefined): string => (o ? (tariffMode(o) === 'grid' ? `${o.zone}|${o.grid}` : o.zone) : '');

async function poll(key: string, f: Feed): Promise<void> {
  const [zone, grid] = key.split('|');
  if (f.timer) clearTimeout(f.timer);
  f.timer = null;
  if (document.hidden) {
    document.addEventListener('visibilitychange', () => void poll(key, f), { once: true });
    return;
  }
  let next = POLL_MS;
  try {
    f.data = await getJSON<PricesResponse>(`/api/display/prices?zone=${encodeURIComponent(zone)}${grid ? `&grid=${encodeURIComponent(grid)}` : ''}`);
    f.failed = false;
    // the server was still fetching the grid tariffs: ask again soon
    if (f.data?.grid?.error === 'pending') next = PENDING_MS;
  } catch {
    if (ctx.params.get('demo') === '1') f.data = demoPrices(zone);
    else {
      f.failed = true;
      next = f.data ? POLL_MS / 2 : RETRY_MS;
    }
  }
  if (feeds.get(key) !== f) return;
  for (const cb of f.subs) cb(f.data, f.failed);
  f.timer = setTimeout(() => void poll(key, f), next * (0.9 + Math.random() * 0.2));
}

/** Prices of `zone` for one widget: `cb` now (when known) and on every new answer. Returns the unsubscribe. */
function subscribe(key: string, cb: Feed['subs'] extends Set<infer F> ? F : never): () => void {
  let f = feeds.get(key);
  if (!f) {
    f = { subs: new Set(), data: null, failed: false, timer: null };
    feeds.set(key, f);
    void poll(key, f);
  } else if (f.data || f.failed) cb(f.data, f.failed);
  f.subs.add(cb);
  const feed = f;
  return () => {
    feed.subs.delete(cb);
    if (feed.subs.size) return;
    if (feed.timer) clearTimeout(feed.timer);
    feeds.delete(key);
  };
}

// ------------------------------------------------------------------------------------------- drawing

export type PricePlace = 'corner' | 'side' | 'full';
type Mode = 'now' | 'nowchart' | 'chart' | 'cheap' | 'full' | 'next' | 'rows';

/**
 * What a widget shows where it is (`portrait`: the room is taller than wide). `rows`: the chart is drawn tall, as
 * one row per hour (the Vertical shape), wherever a chart would be.
 */
export function priceMode(view: PriceWidgetOptions['view'], place: PricePlace, size: string, portrait = false, rows = false): Mode {
  const m: Mode = view === 'auto' ? (place === 'full' ? (portrait ? 'next' : 'full') : place === 'side' || size === 'l' ? 'nowchart' : 'now') : view;
  return rows && (m === 'chart' || m === 'nowchart' || m === 'full') ? 'rows' : m;
}

/** Font scale per place and size (1 = the side column's cards). */
const SCALE: Record<string, number> = { s: 0.82, m: 1, l: 1.18 };
/** Smallest scale a crowded card is shrunk to (side column, a shared corner); under it, the card is not shown. */
const FLOOR = 0.6;
/**
 * The price-now card, in rem: its padding (fixed) and its content at scale 1 (measured: 3.2 + 13.3; with the level
 * badge and the next hour line, and a larger font scale rounding each line up, up to 14.2). The room kept for it errs
 * on the large side: kept too short, the card would not fit at FLOOR and would not be shown at all.
 */
const NOW_CARD_PAD_REM = 3.2;
const NOW_CARD_REM = 14.6;
/** Fewest hours the next-24-hours list shows outside full screen; with less room the card shows the price now. */
const MIN_ROWS = 4;

/** Height (px) of the smallest price-now card: the room the side column keeps for one (custom.ts). */
export function priceFloorHeight(): number {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  return (NOW_CARD_PAD_REM + NOW_CARD_REM * FLOOR) * rem + 6;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const TREND_PATH: Record<string, string> = {
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  flat: 'M5 12h14M13 6l6 6-6 6',
};
function arrow(dir: string): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 24 24', class: `pw-trend pw-trend--${dir}`, 'aria-hidden': 'true' });
  s.appendChild(svg('path', { d: TREND_PATH[dir], fill: 'none', stroke: 'currentColor', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return s;
}

interface Model {
  unit: { label: string; factor: number; decimals: number };
  fmt: Intl.NumberFormat;
  fmtShort: Intl.NumberFormat;
  /** what the chart draws, from today 00:00 */
  bars: PricedSlot[];
  hours: PricedSlot[];
  now: PricedSlot | null;
  nextHour: PricedSlot | null;
  /** what the trend arrow compares the price now with: the next hour, or the next quarter with quarter-hour bars */
  next: PricedSlot | null;
  /** cheap / expensive limits of today (the price now, today's bars) and of tomorrow (its bars) */
  limits: { low: number; high: number };
  limitsTomorrow: { low: number; high: number };
  todayStart: number;
  tomorrowStart: number;
  hasTomorrow: boolean;
  min: number;
  max: number;
  /** what the prices include on top of the market: a grid company's tariffs, time bands, or nothing */
  tariff: 'grid' | 'bands' | 'none';
  /** some grid tariffs ahead are carried forward from the last published ones */
  estimated: boolean;
  /** the grid company's tariffs are still being fetched: the prices are without them for now */
  gridPending: boolean;
}

interface NextHours {
  list: PricedSlot[];
  low: PricedSlot | null;
  high: PricedSlot | null;
  avg: number;
}

export class PriceCard {
  readonly el: HTMLElement;
  private w: DisplayWidget;
  private data: PricesResponse | null = null;
  private failed = false;
  private unsub: (() => void) | null = null;
  private tick: ReturnType<typeof setTimeout> | null = null;
  private place: PricePlace = 'corner';
  private maxW = 0;
  private maxH = 0;
  private sig = '';
  /** the room ('WxH size') where the next-24-hours list had fewer than MIN_ROWS rows: the price now is drawn there */
  private nextTooSmall = '';
  /** The room (roomKey) in which a Personalizado card's chart under the price had too little height: drawn behind it. */
  private chartTooSmall = '';
  /**
   * The tall chart (rows) in this room: 2 with the price now and the lowest / average / highest, 1 without those
   * three figures, 0 with the price now in the header only; -1: not even then MIN_ROWS rows, the wide chart instead.
   */
  private rowsFit: { room: string; level: number } = { room: '', level: 2 };
  /**
   * A Personalizado card's "Estilo de la gráfica" set to "De fondo" (widgets/canvas/content.ts puts it on the card's
   * box, custom.ts passes it on): the bars fill the card behind the price now, edge to edge (bgChart).
   */
  backdrop = false;
  /** called when the card first has prices, fails before having any, or turns stale / fresh */
  onState: ((s: 'loading' | 'ok' | 'stale' | 'failed') => void) | null = null;

  constructor(w: DisplayWidget) {
    this.w = w;
    this.el = el('div', 'uw-media pw');
  }

  get zone(): string {
    return this.w.prices?.zone ?? '';
  }

  private key = '';

  start(): void {
    if (this.unsub) return;
    this.key = feedKey(this.w.prices);
    this.unsub = subscribe(this.key, (d, failed) => {
      this.data = d;
      this.failed = failed;
      this.draw();
      this.onState?.(d ? (d.stale || failed ? 'stale' : 'ok') : 'failed');
    });
    // nothing yet (a first fetch can take seconds): the card shows that the prices are on their way
    if (!this.data && !this.failed) {
      this.draw();
      this.onState?.('loading');
    }
    this.minuteTick();
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.tick) clearTimeout(this.tick);
    this.tick = null;
  }

  /** New options from the config (same zone: the widget's `v` changes with the zone). */
  update(w: DisplayWidget): void {
    this.w = w;
    // another grid company or none: another feed
    if (this.unsub && feedKey(w.prices) !== this.key) {
      this.stop();
      this.data = null;
      this.start();
      return;
    }
    this.draw();
  }

  /** Room the card may take (px) and where it is. */
  layout(maxW: number, maxH: number, place: PricePlace): void {
    this.maxW = Math.max(0, Math.floor(maxW));
    this.maxH = Math.max(0, Math.floor(maxH));
    this.place = place;
    this.draw();
  }

  get hasData(): boolean {
    return !!this.data?.slots.length;
  }

  private minuteTick(): void {
    const ms = 60_000 - (Date.now() % 60_000) + 200;
    this.tick = setTimeout(() => {
      this.draw(true);
      this.minuteTick();
    }, ms);
  }

  private model(now: number): Model | null {
    const d = this.data;
    const o = this.w.prices;
    if (!d || !o || !d.slots.length) return null;
    const currency = widgetCurrency(d.zone, o.currency) === 'EUR' ? 'EUR' : d.currency;
    const unit = priceUnit(currency, o.unit);
    const raw = d.slots.map(([t, m, eur, loc]) => ({ t: t * 1000, m, eur, loc }));
    // a grid company's tariffs come with the prices (an older answer without them: none yet)
    const mode = tariffMode(o);
    const add = tariffAdder(o, { gridList: d.grid?.hours ?? null, tz: ctx.tz, currency, dkkPerEur: DKK_PER_EUR });
    const tariff = add ? (mode as 'grid' | 'bands') : 'none';
    let estimated = false;
    const addSeen = add ? (t: number) => {
      const a = add(t);
      if (a?.est && t + 3600_000 > now) estimated = true;
      return a;
    } : null;
    const priced = pricedSlots(raw, { currency, surcharge: o.surcharge, vat: o.vat, add: addSeen }).map((s) => ({ ...s, p: s.p * unit.factor }));
    const hours = hourly(priced);
    const todayStart = localMidnight(now, ctx.tz, 0);
    const tomorrowStart = localMidnight(now, ctx.tz, 1);
    const dayAfter = localMidnight(now, ctx.tz, 2);
    const src = o.resolution === 'quarter' ? priced : hours;
    const bars = src.filter((s) => s.t >= todayStart && s.t < dayAfter);
    const hasTomorrow = bars.some((s) => s.t >= tomorrowStart);
    const today = bars.filter((s) => s.t < tomorrowStart).map((s) => s.p);
    const tomorrow = bars.filter((s) => s.t >= tomorrowStart).map((s) => s.p);
    const all = bars.map((s) => s.p);
    const nowSlot = slotAt(o.resolution === 'quarter' ? priced : hours, now) ?? slotAt(priced, now);
    const curHour = slotAt(hours, now);
    const nextHour = curHour ? hours.find((s) => s.t === curHour.t + 3600_000) ?? null : null;
    const nowP = curHour && o.resolution !== 'quarter' ? curHour : nowSlot;
    const next = o.resolution === 'quarter' && nowP ? priced.find((s) => s.t === nowP.t + nowP.m * 60_000) ?? null : nextHour;
    const loc = LOCALES[ctx.lang] ?? 'es-ES';
    return {
      unit,
      fmt: new Intl.NumberFormat(loc, { minimumFractionDigits: unit.decimals, maximumFractionDigits: unit.decimals }),
      fmtShort: new Intl.NumberFormat(loc, { minimumFractionDigits: Math.max(0, unit.decimals - 1), maximumFractionDigits: Math.max(0, unit.decimals - 1) }),
      bars,
      hours,
      now: nowP,
      nextHour,
      next,
      limits: levelLimits(today.length ? today : all),
      limitsTomorrow: levelLimits(tomorrow.length ? tomorrow : all),
      todayStart,
      tomorrowStart,
      hasTomorrow,
      min: all.length ? Math.min(...all) : 0,
      max: all.length ? Math.max(...all) : 0,
      tariff,
      estimated,
      gridPending: mode === 'grid' && !add && d.grid?.error === 'pending',
    };
  }

  private roomKey(): string {
    return `${this.maxW}x${this.maxH} ${this.place} ${this.w.size}`;
  }

  private hm(t: number): string {
    const p = wallClock(t, ctx.tz);
    const dt = ctx.cfg.datetime;
    return formatHM(p.h, p.mi, dt.format24 !== false, !!dt.showAmPm);
  }

  /** Draws again; on the minute tick only when something visible changed. */
  draw(tick = false): void {
    const now = Date.now();
    const o = this.w.prices;
    const room = this.roomKey();
    if (this.rowsFit.room !== room) this.rowsFit = { room, level: 2 };
    const rowsWanted = o?.chartShape === 'rows' && this.rowsFit.level >= 0;
    let mode = priceMode(o?.view ?? 'auto', this.place, this.w.size, this.maxH > this.maxW * 1.05, rowsWanted);
    // too little room for a chart or a list (a crowded side column, a short corner): the price now only
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const k = this.place === 'full' ? 1.9 : SCALE[this.w.size] ?? 1;
    // the list: header, price, lowest / average / highest and at least MIN_ROWS hours
    const need = mode === 'nowchart' ? 22 : mode === 'chart' ? 16 : mode === 'next' ? 30 : mode === 'rows' ? 12 : 0;
    // (a Personalizado card too short for its chart under the price: the bars behind the price instead, "De fondo",
    // so the chart stays on the card whichever style it has)
    const inCanvas = !!this.el.parentElement?.classList.contains('uw-in-canvas');
    let under = false;
    if (this.place !== 'full' && need && this.maxH < need * rem * k) {
      under = (mode === 'nowchart' || mode === 'chart') && inCanvas;
      mode = under ? 'nowchart' : 'now';
    } else if (inCanvas && (mode === 'nowchart' || mode === 'chart') && this.chartTooSmall === room) {
      under = true;
      mode = 'nowchart';
    }
    if (mode === 'next' && this.place !== 'full' && this.nextTooSmall === this.roomKey()) mode = 'now';
    const sig = JSON.stringify([this.data?.fetchedAt, this.data?.grid?.fetchedAt, this.data?.stale, this.failed, o, mode, this.rowsFit.level, this.maxW, this.maxH, this.w.name, this.w.size, ctx.lang, ctx.tz, this.backdrop, under, Math.floor(now / (o?.resolution === 'quarter' ? 900_000 : 3600_000))]);
    if (tick && sig === this.sig) return;
    this.sig = sig;
    const m = this.model(now);
    const card = this.el;
    card.className = `uw-media pw pw--${mode}${mode === 'rows' ? ` pw--next pw--rows${this.rowsFit.level}` : ''} pw--${this.place} pw--${this.w.size}${this.maxH > this.maxW * 1.05 ? ' pw--tall' : ''}`;
    // what it draws (the admin's widget preview says when a view does not fit)
    card.dataset.mode = mode;
    // full screen: the chart views fill it; a lone price or list is drawn larger, to read from across the room
    const pk = this.place === 'full' ? (mode === 'now' || mode === 'cheap' ? 2.6 : mode === 'next' || mode === 'rows' ? 1.7 : 1.9) : SCALE[this.w.size] ?? 1;
    card.style.setProperty('--pk', String(pk));
    card.replaceChildren();
    if (!m && o && !this.failed && !this.data) return this.loading(mode);
    if (!m || !o) return;
    const rows = mode === 'next' || mode === 'rows';
    const next = rows ? this.nextHours(m, now) : null;
    // the list's rows are hours: its badge takes the level of the current hour (with quarter-hour prices the big
    // price is the current quarter's, its colour and the highlighted row still agree)
    const lvlOf = next ? slotAt(m.hours, now) ?? m.now : m.now;
    const lvl = lvlOf ? levelOf(lvlOf.p, m.limits) : 'mid';
    card.dataset.level = lvl;

    // sizes: the cards with a chart take the room they are given, the others fit their content
    const chart = mode === 'chart' || mode === 'nowchart' || mode === 'full';
    // "De fondo" (a Personalizado card): the bars behind the price now, from under it to the card's bottom edge, the
    // card as large as its box
    const behind = (this.backdrop || under) && (mode === 'nowchart' || mode === 'full');
    card.classList.toggle('pw--bg', behind);
    card.style.width = '';
    card.style.height = '';
    card.style.maxWidth = `${this.maxW}px`;
    card.style.maxHeight = `${this.maxH}px`;
    if (chart) {
      const w = this.place === 'corner' ? this.maxW : this.maxW;
      const h = this.place === 'full' || behind ? this.maxH : Math.min(this.maxH, Math.round(w * (mode === 'nowchart' ? 0.66 : 0.52)));
      card.style.width = `${w}px`;
      card.style.height = `${h}px`;
    } else if (mode === 'next') {
      // the list takes the room it is given: as many hours as fit
      card.style.width = `${this.maxW}px`;
      card.style.height = `${this.maxH}px`;
    } else if (mode === 'rows') {
      // the tall card: the room's height, and a card's width, not wider than it needs (a wide room keeps it upright)
      // (in the side column it takes the column's width, like its other cards)
      const w = this.place === 'side' ? this.maxW : Math.min(this.maxW, Math.max(rem * pk * 30, Math.round(this.maxH * (this.place === 'full' ? 0.75 : 0.8))));
      card.style.width = `${w}px`;
      card.style.height = `${this.maxH}px`;
    } else if (this.place === 'side') card.style.width = `${this.maxW}px`;

    // the tall chart in a short room: fewer figures on top, so that more hours fit
    const level = mode === 'rows' ? this.rowsFit.level : 2;
    card.appendChild(this.header(m, mode, next?.list.length ?? 0, level));
    if (next) {
      if (level > 0) {
        const top = el('div', 'pw-nx-top');
        top.appendChild(this.nextHero(m, lvl));
        if (level > 1) top.appendChild(this.nextStats(m, next));
        card.appendChild(top);
      }
      const box = el('div', 'pw-nx');
      card.appendChild(box);
      // Vertical: one column of hours; Horizontal: two where the card is wide enough
      const oneCol = mode === 'rows' || o.chartShape === 'rows';
      requestAnimationFrame(() => this.nextList(box, m, next, now, oneCol, mode === 'rows'));
    }
    if (mode === 'now') card.appendChild(this.nowBlock(m, lvl, true));
    if (mode === 'nowchart') card.appendChild(this.nowBlock(m, lvl, false));
    if (mode === 'full') {
      const top = el('div', 'pw-top');
      top.appendChild(this.nowBlock(m, lvl, true));
      top.appendChild(this.cheapBlock(m, now, 3));
      card.appendChild(top);
    }
    if (chart) {
      const box = el('div', 'pw-chart');
      card.appendChild(box);
      // measured once in the document
      requestAnimationFrame(() => (behind ? this.bgChart(box, m, now) : this.chart(box, m, now)));
    }
    if (mode === 'cheap') card.appendChild(this.cheapBlock(m, now, this.place === 'full' ? 4 : this.place === 'side' ? 3 : this.w.size === 's' ? 1 : this.w.size === 'm' ? 2 : 3));
    card.appendChild(this.footer(m, mode));
    if (this.place !== 'full' && !rows) this.fit(pk);
    else if (mode === 'full' && card.parentElement?.classList.contains('uw-in-canvas')) this.fitWide(pk);
  }

  /**
   * A Personalizado card drawn like the full screen is narrower than the screen: when the price and its unit no longer
   * fit their half of the card, everything is drawn a little smaller so they do not run into the list next to them.
   * The full-screen Widget layout never gets here.
   */
  private fitWide(pk: number): void {
    const now = this.el.querySelector<HTMLElement>('.pw-now');
    if (!now || !this.el.isConnected) return;
    let k = pk;
    for (let i = 0; i < 4 && now.scrollWidth > now.clientWidth + 1; i++) {
      k = Math.max(FLOOR, (k * now.clientWidth) / now.scrollWidth - 0.01);
      this.el.style.setProperty('--pk', k.toFixed(3));
      if (k === FLOOR) return;
    }
  }

  /**
   * Before the first prices: the card at its size with its title, faint bars or rows in place of the prices and
   * "Loading prices…" (the bars breathe slowly; still on lite screens).
   */
  private loading(mode: Mode): void {
    const card = this.el;
    card.classList.add('pw-loading');
    card.dataset.level = 'mid';
    const chart = mode === 'chart' || mode === 'nowchart' || mode === 'full';
    if (chart) {
      card.style.width = `${this.maxW}px`;
      card.style.height = `${this.place === 'full' ? this.maxH : Math.min(this.maxH, Math.round(this.maxW * (mode === 'nowchart' ? 0.66 : 0.52)))}px`;
    } else if (mode === 'next' || mode === 'rows') {
      card.style.width = `${mode === 'rows' && this.place !== 'side' ? Math.min(this.maxW, Math.max(this.maxW * 0.5, Math.round(this.maxH * 0.8))) : this.maxW}px`;
      card.style.height = `${this.maxH}px`;
    } else if (this.place === 'side') card.style.width = `${this.maxW}px`;
    const h = el('div', 'pw-h');
    h.appendChild(el('span', 'pw-title', this.title()));
    h.appendChild(el('span', 'pw-zone', this.zoneLabel()));
    card.appendChild(h);
    const sk = el('div', `pw-skel pw-skel--${chart ? 'bars' : mode === 'next' || mode === 'rows' ? 'rows' : 'now'}`);
    const n = chart ? 24 : mode === 'next' || mode === 'rows' ? 14 : 0;
    for (let i = 0; i < n; i++) {
      const b = el('i', '');
      // a calm day's shape: low at night, a morning and an evening peak
      const f = 0.35 + 0.3 * Math.exp(-(((i - 8) / 2.2) ** 2)) + 0.45 * Math.exp(-(((i - 19) / 2.4) ** 2));
      if (chart) b.style.height = `${Math.round(f * 100)}%`;
      else b.style.width = `${Math.round(40 + 50 * Math.abs(Math.sin(i * 1.7)))}%`;
      b.style.animationDelay = `${(i * 0.06).toFixed(2)}s`;
      sk.appendChild(b);
    }
    card.appendChild(sk);
    card.appendChild(el('div', 'pw-wait', ctx.t('priceLoading')));
  }

  /** The next 24 hours from the current one (hourly, whatever the bars), their limits, lowest, average and highest. */
  private nextHours(m: Model, now: number): NextHours {
    const from = slotAt(m.hours, now)?.t ?? Math.floor(now / 3600_000) * 3600_000;
    const list = m.hours.filter((h) => h.t >= from).slice(0, 24);
    const ps = list.map((h) => h.p);
    const low = list.reduce<PricedSlot | null>((a, h) => (!a || h.p < a.p ? h : a), null);
    const high = list.reduce<PricedSlot | null>((a, h) => (!a || h.p > a.p ? h : a), null);
    return {
      list,
      low,
      high,
      avg: ps.length ? ps.reduce((n, p) => n + p, 0) / ps.length : 0,
    };
  }

  /** The price now in large type, coloured by its level, and a "Now: Cheap" badge. */
  private nextHero(m: Model, lvl: string): HTMLElement {
    const b = el('div', 'pw-nx-hero');
    const row = el('div', 'pw-nowrow');
    row.appendChild(el('span', 'pw-val pw-val--lvl', m.now ? m.fmt.format(m.now.p) : '–'));
    row.appendChild(el('span', 'pw-unit', m.unit.label));
    b.appendChild(row);
    const name = ctx.t(lvl === 'cheap' ? 'priceCheap' : lvl === 'high' ? 'priceHigh' : 'priceMid');
    b.appendChild(el('span', `pw-badge pw-badge--${lvl}`, ctx.t('priceNowIs', { l: name })));
    return b;
  }

  private nextStats(m: Model, n: NextHours): HTMLElement {
    const b = el('div', 'pw-nx-stats');
    const cell = (label: string, p: number | null, t: number | null, cls: string) => {
      const c = el('div', `pw-stat ${cls}`);
      c.appendChild(el('span', 'pw-stat-l', label));
      c.appendChild(el('span', 'pw-stat-v', p == null ? '–' : m.fmt.format(p)));
      c.appendChild(el('span', 'pw-stat-t', t == null ? '\u00a0' : this.hm(t)));
      b.appendChild(c);
    };
    cell(ctx.t('priceLowest'), n.low?.p ?? null, n.low?.t ?? null, 'pw-stat--cheap');
    cell(ctx.t('priceAverage'), n.list.length ? n.avg : null, null, '');
    cell(ctx.t('priceHighest'), n.high?.p ?? null, n.high?.t ?? null, 'pw-stat--high');
    return b;
  }

  /**
   * The hours as rows (time, a bar from the lowest to the highest price of the 24 hours, the price), in one or two
   * columns by the width, as many as fit the height; full screen: all of them, the text sized to fill it.
   */
  private nextList(box: HTMLElement, m: Model, n: NextHours, now: number, oneCol = false, tall = false): void {
    if (!box.isConnected) return;
    const W = box.clientWidth;
    const H = box.clientHeight;
    if (W < 40 || !n.list.length) return;
    const LINE = 2.05;
    // the figures on top took all the height: the tall chart drops them (below)
    if (H < 20 && !(tall && this.place !== 'full')) return;
    let fs = parseFloat(getComputedStyle(box).fontSize) || 16;
    // two columns where there is width for them; a full portrait screen keeps one, with long bars
    const cols = oneCol ? 1 : this.place === 'full' ? (W < H * 0.8 ? 1 : 2) : W >= fs * 25 ? 2 : 1;
    let count: number;
    if (this.place === 'full') {
      count = n.list.length;
      // sized for 24 hours whatever is published (before tomorrow's prices are out the list is shorter, not larger),
      // never wider than a column holds (time, bar, price)
      const rows = Math.max(Math.ceil(count / cols), Math.ceil(24 / cols));
      fs = Math.max(12, Math.min(H / rows / LINE, W / cols / 13));
      // the tall chart on a wide screen: fewer hours, read from across the room
      if (tall) {
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
        fs = Math.max(fs, Math.min(rem * 2.6, W / 13));
        count = Math.min(count, Math.max(1, Math.floor(H / (fs * LINE))));
      }
      box.style.fontSize = `${fs.toFixed(1)}px`;
    } else {
      count = Math.min(n.list.length, cols * Math.max(1, Math.floor(H / (fs * LINE))));
      // fewer than MIN_ROWS hours is not a list: the price now card in this room instead (the tall chart drops its
      // figures on top first, then turns into the wide chart)
      if (count < Math.min(tall && this.rowsFit.level > 0 ? MIN_ROWS + 2 : MIN_ROWS, n.list.length)) {
        if (tall) this.rowsFit = { room: this.roomKey(), level: this.rowsFit.level - 1 };
        else this.nextTooSmall = this.roomKey();
        this.sig = '';
        this.draw();
        return;
      }
    }
    const rows = Math.ceil(count / cols);
    box.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    // full screen: the rows share what is left over (less than one row), so the list ends at the footer; elsewhere
    // they keep their height from the top
    box.style.gridTemplateRows = this.place === 'full' && (count >= 24 || tall) ? `repeat(${rows}, minmax(0, 1fr))` : `repeat(${rows}, ${LINE}em)`;
    box.classList.toggle('pw-nx--2', cols === 2);
    // a 12-hour clock has longer labels: the bars still start in one line
    box.classList.toggle('pw-nx--h12', ctx.cfg.datetime.format24 === false);
    const lo = n.low?.p ?? 0;
    const hi = n.high?.p ?? 1;
    const span = hi - lo;
    const out: HTMLElement[] = [];
    for (const h of n.list.slice(0, count)) {
      // the same level as on the chart: today's hours against today, tomorrow's against tomorrow
      const lvl = levelOf(h.p, h.t >= m.tomorrowStart ? m.limitsTomorrow : m.limits);
      const cur = h.t <= now && now < h.t + 3600_000;
      const tmw = h.t >= m.tomorrowStart;
      const r = el('div', `pw-row pw-row--${lvl}${cur ? ' is-now' : ''}${tmw ? ' is-tmw' : ''}${h.t === m.tomorrowStart ? ' is-midnight' : ''}`);
      r.appendChild(el('span', 'pw-rt', this.hm(h.t)));
      const bar = el('span', 'pw-rbar');
      const fill = el('i', '');
      // the cheapest hour still shows a stub; a flat day draws every bar at half
      const f = span > 1e-9 ? 0.08 + 0.92 * ((h.p - lo) / span) : 0.5;
      fill.style.width = `${(f * 100).toFixed(1)}%`;
      bar.appendChild(fill);
      r.appendChild(bar);
      r.appendChild(el('span', 'pw-rv', m.fmt.format(h.p)));
      out.push(r);
    }
    box.replaceChildren(...out);
  }

  /**
   * A card taller than its room (a crowded side column, a corner shared with other widgets) is drawn smaller, down to
   * FLOOR; with less room than that, nothing is shown rather than a sliver of card.
   */
  private fit(pk: number): void {
    const card = this.el;
    if (!card.isConnected || !this.maxH) return;
    let k = pk;
    const cs = getComputedStyle(card);
    // the padding does not scale
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + 2;
    for (let i = 0; i < 4 && card.scrollHeight > this.maxH + 2; i++) {
      const next = (k * Math.max(0, this.maxH - pad)) / Math.max(1, card.scrollHeight - pad) - 0.005;
      if (next < FLOOR) {
        // the estimate overshoots a little: the card at FLOOR may still fit
        card.style.setProperty('--pk', String(FLOOR));
        if (k > FLOOR && card.scrollHeight <= this.maxH + 2) return;
        card.classList.add('pw-cramped');
        return;
      }
      k = next;
      card.style.setProperty('--pk', k.toFixed(3));
    }
  }

  private title(): string {
    const n = this.w.name.trim();
    return n && n !== 'Widget' ? n : ctx.t('priceTitle');
  }

  private zoneLabel(): string {
    const z = this.zone;
    return z === 'ES-PVPC' ? 'PVPC' : z;
  }

  private header(m: Model, mode: Mode, nextCount = 0, level = 2): HTMLElement {
    const h = el('div', 'pw-h');
    const title = el('span', 'pw-title', this.title());
    h.appendChild(title);
    // the tall chart's smallest form: the title and the price now share the line
    if (!(mode === 'rows' && level <= 0)) h.appendChild(el('span', 'pw-zone', this.zoneLabel()));
    if ((mode === 'next' || (mode === 'rows' && level > 0)) && nextCount) h.appendChild(el('span', 'pw-hsub', ctx.t('priceNextHours', { n: nextCount })));
    // the chart and the list carry the price now in their header
    if ((mode === 'chart' || mode === 'cheap' || (mode === 'rows' && level <= 0)) && m.now) {
      const v = el('span', 'pw-hnow');
      v.appendChild(el('b', '', m.fmt.format(m.now.p)));
      v.appendChild(el('span', 'pw-u', ` ${m.unit.label}`));
      h.appendChild(v);
    }
    return h;
  }

  private nowBlock(m: Model, lvl: string, withNext: boolean): HTMLElement {
    const b = el('div', 'pw-now');
    const row = el('div', 'pw-nowrow');
    row.appendChild(el('span', 'pw-val', m.now ? m.fmt.format(m.now.p) : '–'));
    row.appendChild(el('span', 'pw-unit', m.unit.label));
    if (m.now && m.next) row.appendChild(arrow(trend(m.now.p, m.next.p)));
    b.appendChild(row);
    const sub = el('div', 'pw-sub');
    const tag = el('span', `pw-level pw-level--${lvl}`, ctx.t(lvl === 'cheap' ? 'priceCheap' : lvl === 'high' ? 'priceHigh' : 'priceMid'));
    sub.appendChild(tag);
    if (withNext && m.nextHour) sub.appendChild(el('span', 'pw-next', ctx.t('priceNextHour', { p: m.fmt.format(m.nextHour.p) })));
    b.appendChild(sub);
    return b;
  }

  private cheapBlock(m: Model, now: number, count: number): HTMLElement {
    const hours = this.w.prices?.windowHours ?? 3;
    const list = cheapestWindows(m.hours, now, hours, count);
    const b = el('div', 'pw-cheap');
    b.appendChild(el('div', 'pw-cheap-h', ctx.t(hours === 1 ? 'priceCheapestHours' : 'priceCheapestStretches', { n: hours })));
    if (!list.length) {
      b.appendChild(el('div', 'pw-empty', ctx.t('priceNoneLeft')));
      return b;
    }
    const ol = el('ol', 'pw-cheap-list');
    for (const w of list) {
      // every window listed is one of the cheapest ahead: all drawn as cheap
      const li = el('li', 'pw-win pw-win--cheap');
      const when = el('span', 'pw-when');
      if (w.t >= m.tomorrowStart) when.appendChild(el('span', 'pw-day', ctx.t('tomorrow')));
      if (w.t <= now) when.appendChild(el('span', 'pw-day pw-day--now', ctx.t('now')));
      when.appendChild(document.createTextNode(ctx.t('priceRange', { a: this.hm(w.t), b: this.hm(w.end) })));
      li.appendChild(when);
      li.appendChild(el('span', 'pw-avg', m.fmt.format(w.p)));
      ol.appendChild(li);
    }
    b.appendChild(ol);
    return b;
  }

  private footer(m: Model, mode: Mode): HTMLElement {
    const f = el('div', 'pw-foot');
    if (mode !== 'now' && mode !== 'cheap' && mode !== 'next' && mode !== 'rows' && m.bars.length) {
      f.appendChild(el('span', 'pw-range', ctx.t('priceMinMax', { a: m.fmtShort.format(m.min), b: m.fmtShort.format(m.max) })));
    }
    // what the prices include besides the market (and the fixed extra): the grid company's tariffs or the time bands
    const o = this.w.prices;
    if (m.tariff === 'grid') f.appendChild(el('span', 'pw-incl', ctx.t(m.estimated ? 'priceInclGridEst' : 'priceInclGrid')));
    else if (m.tariff === 'bands') f.appendChild(el('span', 'pw-incl', ctx.t('priceInclBands')));
    else if (m.gridPending) f.appendChild(el('span', 'pw-incl pw-incl--wait', ctx.t('priceLoadingGrid', { c: this.data?.grid?.name || gridCompany(o?.grid ?? '')?.name || '' })));
    else if (o && tariffMode(o) === 'grid') f.appendChild(el('span', 'pw-incl pw-incl--miss', ctx.t('priceNoGrid')));
    // 'Energinet' and 'Energinet DataHub': one credit
    const spot = this.data?.credit ?? '';
    const grid = m.tariff === 'grid' ? this.data?.grid?.credit ?? '' : '';
    const credit = grid && spot && grid.startsWith(spot) ? grid : [spot, grid].filter(Boolean).join(' · ');
    if (credit) f.appendChild(el('span', 'pw-credit', credit));
    return f;
  }

  /**
   * The bars behind the card ("De fondo"): from the top of the chart's place to the card's bottom edge and from its
   * left edge to its right one, no prices over them and no hours under them (the price now, the lowest and the highest
   * are written over them). Each bar in its level's colour fades to its foot like the curves of the other cards
   * (canvas/curve.ts), the past ones dimmed, the hour now marked by its line.
   */
  private bgChart(box: HTMLElement, m: Model, now: number): void {
    const card = this.el;
    if (!box.isConnected) return;
    const W = Math.floor(card.clientWidth);
    const H = Math.floor(card.clientHeight - box.offsetTop);
    const bars = m.bars;
    if (W < 40 || H < 30 || !bars.length) return;
    const fs = parseFloat(getComputedStyle(box).fontSize) || 12;
    const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'pw-svg pw-svg--bg', 'aria-hidden': 'true' });
    s.style.left = `${-box.offsetLeft}px`;
    s.style.right = 'auto';
    s.style.bottom = 'auto';
    box.replaceChildren(s);
    const start = m.todayStart;
    const end = bars[bars.length - 1].t + bars[bars.length - 1].m * 60_000;
    const span = Math.max(1, end - start);
    const x = (t: number) => ((t - start) / span) * W;
    const top = fs * 0.4;
    const lo = Math.min(0, m.min);
    const hi = Math.max(m.max, lo + 1e-9);
    const y = (p: number) => top + (H - top) - ((p - lo) / (hi - lo)) * (H - top);
    const zeroY = y(0);
    const slotW = (15 * 60_000 / span) * W;
    const gapFrac = slotW * (bars[0].m / 15) > 6 ? 0.22 : 0.08;
    // one fade per level, in a group of that level's colour
    const fills: Record<string, string> = {};
    for (const lv of ['cheap', 'mid', 'high']) {
      const g = svg('g', { class: `pw-bgl pw-bgl--${lv}` });
      s.appendChild(g);
      // over the chart's whole height, so every bar is faint at the foot where the lowest and highest are written
      fills[lv] = fade(g, true, [top, H]);
    }
    for (const b of bars) {
      const x0 = x(b.t);
      const w = Math.max(1, x(b.t + b.m * 60_000) - x0);
      const g = w * gapFrac;
      const yv = y(b.p);
      const lv = levelOf(b.p, b.t >= m.tomorrowStart ? m.limitsTomorrow : m.limits);
      const past = b.t + b.m * 60_000 <= now;
      const cur = b.t <= now && now < b.t + b.m * 60_000;
      const r = Math.min((w - g) / 2, fs * 0.25);
      const bar = svg('rect', {
        x: x0 + g / 2, y: Math.min(yv, zeroY), width: Math.max(1, w - g), height: Math.max(1, Math.abs(zeroY - yv)), rx: r, ry: r,
        class: `pw-bar pw-bar--${lv}${past ? ' is-past' : ''}${cur ? ' is-now' : ''}`,
      });
      // (a past hour keeps the dimmed ink of the stylesheet)
      if (!past) bar.style.fill = fills[lv];
      s.appendChild(bar);
    }
    const nx = x(now);
    if (nx >= 0 && nx <= W) s.appendChild(svg('line', { x1: nx, x2: nx, y1: top, y2: H, class: 'pw-nowline' }));
  }

  /**
   * The bars, drawn at the box's size in pixels (crisp text, no scaling). Over the bars of the coming hours, their
   * price: all of them when they fit, else every 2nd, 3rd... hour, always with the cheapest and the dearest one.
   */
  private chart(box: HTMLElement, m: Model, now: number): void {
    if (!box.isConnected) return;
    const W = Math.floor(box.clientWidth);
    const H = Math.floor(box.clientHeight);
    if (W >= 40 && H < 30 && this.el.parentElement?.classList.contains('uw-in-canvas') && this.chartTooSmall !== this.roomKey()) {
      // the price took the height the chart had: behind the price instead (draw)
      this.chartTooSmall = this.roomKey();
      this.sig = '';
      this.draw();
      return;
    }
    if (W < 40 || H < 30) return;
    const fs = parseFloat(getComputedStyle(box).fontSize) || 12;
    const bars = m.bars;
    if (!bars.length) return;
    const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'pw-svg', 'aria-hidden': 'true' });
    // in the document first: the labels are measured there, in their own font
    box.replaceChildren(s);
    const measure = (cls: string, texts: string[]): { w: number; fs: number } => {
      const t = svg('text', { x: -9999, y: -9999, class: cls });
      s.appendChild(t);
      let w = 0;
      for (const x of new Set(texts)) {
        t.textContent = x;
        w = Math.max(w, t.getComputedTextLength());
      }
      const size = parseFloat(getComputedStyle(t).fontSize) || fs;
      t.remove();
      return { w, fs: size };
    };
    const start = m.todayStart;
    const end = bars[bars.length - 1].t + bars[bars.length - 1].m * 60_000;
    const span = Math.max(1, end - start);
    const x = (t: number) => ((t - start) / span) * W;
    const pitch = (3600_000 / span) * W;
    // the coming hours (hourly prices also over quarter-hour bars) and their labels
    const from = slotAt(m.hours, now)?.t ?? Math.floor(now / 3600_000) * 3600_000;
    const coming = m.hours.filter((h) => h.t >= from && h.t < end && h.t >= start);
    const dec = m.unit.decimals === 3 ? 2 : m.unit.decimals;
    const fmtL = new Intl.NumberFormat(LOCALES[ctx.lang] ?? 'es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const texts = coming.map((h) => fmtL.format(h.p));
    const lab = coming.length ? measure('pw-pv pw-pv--ext', texts) : { w: 0, fs };
    // larger where the labels have room for it (a large card, full screen): as large as the hours between two of
    // them allow, up to 1.6 times
    const base = coming.length ? priceLabelPicks(coming.map((h) => h.p), pitch, lab.w, lab.fs * 0.55).step : 1;
    const grow = Math.min(this.place === 'full' ? 1.6 : 1.2, (base * pitch * 0.9) / Math.max(1, lab.w + lab.fs * 0.55));
    if (grow > 1) {
      lab.w *= grow;
      lab.fs *= grow;
    }
    const axisH = Math.round(fs * 1.7);
    // labels only with room for the bars under them
    const withLabels = coming.length > 0 && H - axisH - lab.fs * 1.4 > lab.fs * 3;
    const top = withLabels ? Math.round(lab.fs * 1.3) : Math.round(fs * 0.5);
    const plotH = H - axisH - top;
    if (plotH < 10) return;
    const lo = Math.min(0, m.min);
    const hi = Math.max(m.max, lo + 1e-9);
    const y = (p: number) => top + plotH - ((p - lo) / (hi - lo)) * plotH;
    const zeroY = y(0);
    const slotW = (15 * 60_000 / span) * W;
    const gapFrac = slotW * (bars[0].m / 15) > 6 ? 0.22 : 0.08;
    // tomorrow: a light band behind and a divider
    if (m.hasTomorrow) {
      const tx = x(m.tomorrowStart);
      s.appendChild(svg('rect', { x: tx, y: 0, width: W - tx, height: top + plotH, class: 'pw-tmw' }));
      s.appendChild(svg('line', { x1: tx, x2: tx, y1: 0, y2: top + plotH, class: 'pw-div' }));
    }
    const tops: { x0: number; x1: number; y: number }[] = [];
    for (const b of bars) {
      const x0 = x(b.t);
      const w = Math.max(1, x(b.t + b.m * 60_000) - x0);
      const g = w * gapFrac;
      const yv = y(b.p);
      const y0 = Math.min(yv, zeroY);
      const h = Math.max(1, Math.abs(zeroY - yv));
      const past = b.t + b.m * 60_000 <= now;
      const cur = b.t <= now && now < b.t + b.m * 60_000;
      const r = Math.min((w - g) / 2, fs * 0.25);
      tops.push({ x0, x1: x0 + w, y: y0 });
      s.appendChild(svg('rect', {
        x: x0 + g / 2, y: y0, width: Math.max(1, w - g), height: h, rx: r, ry: r,
        class: `pw-bar pw-bar--${levelOf(b.p, b.t >= m.tomorrowStart ? m.limitsTomorrow : m.limits)}${past ? ' is-past' : ''}${cur ? ' is-now' : ''}`,
      }));
    }
    if (lo < 0) s.appendChild(svg('line', { x1: 0, x2: W, y1: zeroY, y2: zeroY, class: 'pw-zero' }));
    // the prices over the coming hours: each one just above the highest bar under it
    const nx = x(now);
    let nowTop = top - fs * 0.2;
    if (withLabels) {
      const gap = lab.fs * 0.55;
      const pick = priceLabelPicks(coming.map((h) => h.p), pitch, lab.w, gap);
      const placed = pick.picks.map((i) => {
        const h = coming[i];
        const cx = Math.max(lab.w / 2, Math.min(W - lab.w / 2, x(h.t) + pitch / 2));
        const l = cx - lab.w / 2;
        const r = cx + lab.w / 2;
        const under = tops.filter((b) => b.x1 > l && b.x0 < r).reduce((n, b) => Math.min(n, b.y), zeroY);
        return { i, h, cx, base: Math.max(lab.fs * 0.95, under - lab.fs * 0.32), anchor: 'middle' };
      });
      // the cheapest and the dearest hour side by side, when they are too close to stand apart
      const a = placed.find((p) => p.i === Math.min(pick.min, pick.max));
      const b = placed.find((p) => p.i === Math.max(pick.min, pick.max));
      if (a && b && a !== b && b.cx - a.cx < lab.w + gap && Math.abs(a.base - b.base) < lab.fs * 1.1) {
        const mid = (a.cx + b.cx) / 2;
        a.base = b.base = Math.min(a.base, b.base);
        a.cx = Math.max(lab.w + gap / 2, mid) - gap / 2;
        a.anchor = 'end';
        b.cx = Math.min(W - lab.w - gap / 2, mid) + gap / 2;
        b.anchor = 'start';
      }
      for (const p of placed) {
        const lvl = levelOf(p.h.p, p.h.t >= m.tomorrowStart ? m.limitsTomorrow : m.limits);
        const ext = p.i === pick.min ? ' pw-pv--ext pw-pv--min' : p.i === pick.max ? ' pw-pv--ext pw-pv--max' : '';
        const t = svg('text', { x: p.cx, y: p.base, 'text-anchor': p.anchor, class: `pw-pv pw-pv--${lvl}${ext}` });
        if (grow > 1) t.style.fontSize = `${lab.fs.toFixed(1)}px`;
        t.textContent = texts[p.i];
        s.appendChild(t);
        // the now line starts under the current hour's price
        if (p.h.t === from && Math.abs(nx - p.cx) < lab.w / 2 + 2) nowTop = p.base + lab.fs * 0.3;
      }
    }
    // now: a thin line over the plot, and a dot on top of the current bar when it has no price over it
    if (nx >= 0 && nx <= W) {
      s.appendChild(svg('line', { x1: nx, x2: nx, y1: nowTop, y2: top + plotH, class: 'pw-nowline' }));
      const cur = slotAt(bars, now);
      if (cur && !withLabels) s.appendChild(svg('circle', { cx: nx, cy: Math.max(fs * 0.35, Math.min(y(cur.p), zeroY) - fs * 0.55), r: fs * 0.3, class: 'pw-nowdot' }));
    }
    // hour labels under their bar: every 6 hours (3 on wide charts with only today), or as chosen (3 h, 1 h) when they
    // do not touch; tomorrow's name after the divider
    const h24 = ctx.cfg.datetime.format24 !== false;
    const hourText = (h: number) => (h24 ? String(h).padStart(2, '0') : `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`);
    const ax = measure('pw-ax', Array.from({ length: 24 }, (_, h) => hourText(h)));
    const step = axisStep(this.w.prices?.axis ?? 'simple', pitch, ax.w, { gap: fs * 0.5, wide: !m.hasTomorrow && W >= fs * 26 });
    const ay = H - fs * 0.35;
    const dayLabel = ctx.t('tomorrow');
    const tx0 = m.hasTomorrow ? x(m.tomorrowStart) : Infinity;
    // the day's name takes the place of the hours right after midnight
    const dayEnd = m.hasTomorrow ? tx0 + fs * 0.4 + measure('pw-ax pw-ax--day', [dayLabel]).w + fs * 0.5 : -1;
    for (const hr of m.hours) {
      if (hr.t < start || hr.t >= end) continue;
      const p = wallClock(hr.t, ctx.tz);
      if (p.h % step !== 0) continue;
      if (m.hasTomorrow && hr.t === m.tomorrowStart) continue;
      const lx = x(hr.t) + pitch / 2;
      const l = Math.max(0, lx - ax.w / 2);
      if (l + ax.w > W) continue;
      if (l + ax.w > tx0 - fs * 0.15 && l < dayEnd) continue;
      const t = svg('text', { x: l + ax.w / 2, y: ay, 'text-anchor': 'middle', class: 'pw-ax' });
      // the household's clock: 00 06 12 18, or 12a 6a 12p 6p
      t.textContent = hourText(p.h);
      s.appendChild(t);
    }
    if (m.hasTomorrow) {
      const t = svg('text', { x: tx0 + fs * 0.4, y: ay, class: 'pw-ax pw-ax--day' });
      t.textContent = dayLabel;
      s.appendChild(t);
    }
  }
}
