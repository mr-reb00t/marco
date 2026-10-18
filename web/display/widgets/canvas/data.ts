// Personalizado data cards (palette "Datos"): Cripto (market: prices with a sparkline or an area chart over 1, 7 or 30
// days), Deportes (sports: live, next and last games of teams or competitions, with crests), Bolsa (stocks: a
// scrolling ticker or a list of quotes) and Divisas (currency: exchange rates of the ECB with their curve over 7 days,
// 30 days or a year, drawn like Cripto; the Currency widget, widgets/currency.ts, draws the same card). The numbers come from this server only (dataFeed.ts, GET /api/display/data);
// every text is written with textContent and every chart is hand-drawn SVG (the approach of chart.ts).
import type { CurrencyData, DataItemData, DisplayCanvasItem, MarketCoinData, MarketData, SportsData, SportsGame, SportsSide, StockQuoteData, StocksData } from '../../../shared/types';
import { ctx } from '../../ctx';
import { reducedMotion } from '../../dom';
import { ago } from '../ha/haui';
import { bigType, fitWidth } from './clock';
import { bleed, chartStyleOf, curve, type ChartStyle } from './curve';
import type { AdapterBox, AdapterEnv, CanvasAdapter } from './types';

type Props = Record<string, any>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ------------------------------------------------------------------------------------------------ formatting

/** A price in its currency: no decimals from 1000 up, two from 1, more below (a coin worth cents). */
export function fmtPrice(v: number | null, cur = ''): string {
  if (v === null || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  const d = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  try {
    if (!cur) return new Intl.NumberFormat(ctx.lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
    if (cur === 'btc') return `₿${new Intl.NumberFormat(ctx.lang, { maximumSignificantDigits: 6 }).format(v)}`;
    return new Intl.NumberFormat(ctx.lang, { style: 'currency', currency: cur.toUpperCase(), minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  } catch {
    return v.toFixed(d);
  }
}

/**
 * An exchange rate: as many decimals as its size wants (363,08 · 20,687 · 1,1298 · 0,8439 · 0,005624), no currency
 * sign (the pair says what it is).
 */
export function fmtRate(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  const d = a >= 100 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a > 0 ? Math.min(8, 3 - Math.floor(Math.log10(a))) : 2;
  try {
    return new Intl.NumberFormat(ctx.lang, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  } catch {
    return v.toFixed(d);
  }
}

/** A currency's name in the screen's language ("forinto húngaro"), or '' when the browser has none. */
export function currencyName(code: string): string {
  try {
    const n = new Intl.DisplayNames([ctx.lang], { type: 'currency' }).of(code) ?? '';
    return n && n !== code ? n.charAt(0).toUpperCase() + n.slice(1) : '';
  } catch {
    return '';
  }
}

/** A change in percent with its sign ("+1,84 %"). */
export function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '';
  try {
    const d = Math.abs(v) >= 10 ? 1 : 2;
    return new Intl.NumberFormat(ctx.lang, { style: 'percent', signDisplay: 'exceptZero', minimumFractionDigits: d, maximumFractionDigits: d }).format(v / 100);
  } catch {
    return `${v > 0 ? '+' : ''}${v.toFixed(2)} %`;
  }
}

const trend = (v: number | null) => (v === null || !Number.isFinite(v) || Math.abs(v) < 0.005 ? 'flat' : v > 0 ? 'up' : 'down');

/** The change as a chip: an arrow and the percent, green up and red down. */
function changeChip(v: number | null): HTMLElement {
  const t = trend(v);
  const c = el('span', `cv-dt-ch is-${t}`);
  if (v === null) return c;
  c.append(el('i', 'ar', t === 'up' ? '▲' : t === 'down' ? '▼' : '•'), el('span', '', fmtPct(v)));
  c.setAttribute('aria-label', fmtPct(v));
  return c;
}

/** A sparkline (a row of a list, a quote of the ticker) in the shared style of curve.ts. */
const spark = (pts: [number, number][], tone: string, cls = 'cv-dt-spark') => curve(pts, { area: false, tone, cls });

/**
 * A row's chart behind it ("De fondo" in a list): the coin's curve over the row's whole height and the card's whole
 * width, the fill only with an area chart.
 */
function rowBg(row: HTMLElement, pts: [number, number][], tone: string, area: boolean): void {
  const s = curve(pts, { area, tone, top: 0.14, bottom: 0.1 });
  if (!s) return;
  const bg = el('div', 'cv-bgchart cv-dt-rowbg');
  bg.appendChild(s);
  row.classList.add('has-bgchart');
  row.appendChild(bg);
}

/**
 * The sparklines of a list that no longer fit beside the name and the price: behind their rows instead (the chart
 * stays on the card, as a "De fondo" row's does, only in the row's own height).
 */
function sparksBehind(root: HTMLElement): void {
  for (const h of root.querySelectorAll<HTMLElement>(':is(.cv-mk-row, .cv-st-row) > .cv-mk-spark')) {
    const row = h.parentElement as HTMLElement;
    const s = h.querySelector('svg');
    h.remove();
    if (!s) continue;
    const bg = el('div', 'cv-bgchart cv-dt-rowbg');
    bg.appendChild(s);
    row.classList.add('has-bgchart');
    row.appendChild(bg);
  }
}

/**
 * A list with its charts behind (each row a band): the text grows (up to `max` times) until it takes about half of
 * the shortest band, the other half left for the chart under it. Never so far that something is cut.
 */
function fillBands(root: HTMLElement, max: number): void {
  const rows = [...root.querySelectorAll<HTMLElement>('.cv-mk-row, .cv-st-row')];
  if (!rows.length || !root.isConnected || cut(root)) return;
  const textOf = (row: HTMLElement) => {
    let b = 0;
    for (const k of row.children) if (!k.classList.contains('cv-dt-rowbg')) b = Math.max(b, (k as HTMLElement).offsetTop + (k as HTMLElement).offsetHeight);
    return b;
  };
  const band = Math.min(...rows.map((r) => r.clientHeight));
  const text = Math.max(...rows.map(textOf));
  if (!band || !text) return;
  const k = Math.min(max, (band * 0.5) / text);
  if (k <= 1.02) return;
  root.style.setProperty('--dk', k.toFixed(3));
  if (!cut(root)) return;
  let lo = 1;
  let hi = k;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    root.style.setProperty('--dk', mid.toFixed(3));
    if (cut(root)) hi = mid;
    else lo = mid;
  }
  root.style.setProperty('--dk', lo.toFixed(3));
}

/**
 * Each row's chart, once the rows are laid out: pulled out to the card's left and right edges, under the row's text
 * down to the row's bottom (a row too short for that: over its lower part, behind the text).
 */
function bleedRows(root: HTMLElement): void {
  for (const bg of root.querySelectorAll<HTMLElement>('.cv-dt-rowbg')) {
    const row = bg.parentElement as HTMLElement;
    bleed(bg, row, root);
    let text = 0;
    for (const k of row.children) if (k !== bg) text = Math.max(text, (k as HTMLElement).offsetTop + (k as HTMLElement).offsetHeight);
    const h = row.clientHeight;
    bg.style.top = `${Math.round(h - text >= h * 0.3 ? text : h * 0.4)}px`;
  }
}

/** "Actualizado hace 12 min" when the numbers are old or the last call failed; '' otherwise. */
function staleText(env: AdapterEnv, id: string, d: DataItemData | null | undefined): string {
  if (!d?.stale) return '';
  const age = env.data.age(id);
  if (age === null) return ctx.t('dtNoData');
  return ctx.t('dtUpdated', { when: ago(Date.now() - age * 1000) });
}

const RANGE_KEY: Record<string, string> = { '1d': 'dt1d', '7d': 'dt7d', '30d': 'dt30d', '1y': 'dt1y' };

/** The price or rate of a row and its change, or "Sin datos" when the source has nothing for it. */
function valueOf(c: { price: number | null; ch: number | null; noData?: boolean }, fmt: (v: number | null) => string, cls = 'cv-mk-val'): HTMLElement {
  const val = el('div', cls);
  if (c.noData) val.appendChild(el('span', 'cv-dt-nd', ctx.t('dtNoDataRow')));
  else val.append(el('b', 'cv-mk-p', fmt(c.price)), changeChip(c.ch));
  return val;
}

/** The note of a card with nothing to draw yet (set it up, loading, no numbers), or ''. */
function emptyNote(d: DataItemData | null | undefined, configured: boolean): string {
  if (!configured) return ctx.t('cvSetup');
  if (d === undefined) return ctx.t('dtLoading');
  if (d === null) return ctx.t('dtNoData');
  return '';
}

/** The line under a card that says its numbers are old. */
function staleFoot(text: string): HTMLElement {
  const f = el('div', 'cv-dt-foot');
  f.appendChild(el('span', 'cv-dt-stale', text));
  return f;
}

function note(root: HTMLElement, text: string): void {
  root.appendChild(el('span', 'cv-dt-note', text));
}

// ------------------------------------------------------------------------------------------------ fitting

/** The one-line parts of the data cards that must show whole: a name with an ellipsis, a row part wider than its column. */
const CLIP = '.cv-mk-head, .cv-mk-line, .cv-mk-who, .cv-mk-name, .cv-fx-pair, .cv-dt-nd, .cv-mk-val, .cv-mk-badge, .cv-st-who, .cv-st-who .nm, .cv-sp-side, .cv-sp-n, .cv-sp-mid, .cv-sp-group .l';

/** The card's content is taller (or wider) than its box (the editor would say it does not fit), or a row of a list is squeezed shorter than its text. */
function cutV(root: HTMLElement): boolean {
  if (root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1) return true;
  for (const e of root.querySelectorAll<HTMLElement>('.cv-mk-row, .cv-st-row, .cv-sp-game, .cv-sp-group')) if (e.scrollHeight > e.clientHeight + 1) return true;
  return false;
}

/** A name or a number of the card is cut short (an ellipsis) or runs over its neighbour. */
function cutH(root: HTMLElement): boolean {
  for (const e of root.querySelectorAll<HTMLElement>(CLIP)) {
    // (a column squeezed to nothing while its text is there is cut too: the symbol of a quote that vanished)
    if (!e.clientWidth) {
      if (e.scrollWidth > 1) return true;
      continue;
    }
    if (e.scrollWidth > e.clientWidth + 1) return true;
    // a word cut by less than a pixel still ends in "…" (the widths are whole pixels): its text measured exactly
    if (e.childElementCount === 0 && e.textContent) {
      const r = document.createRange();
      r.selectNodeContents(e);
      if (r.getBoundingClientRect().width > e.getBoundingClientRect().width + 0.25) return true;
    }
  }
  return false;
}

const cut = (root: HTMLElement) => cutV(root) || cutH(root);

/**
 * Make a drawn card fit its box by giving things up in order until nothing is cut: each step changes the card once
 * (or returns true to be tried again, as dropping rows one by one). Measured, so it follows the real box (a wide
 * sidebar, a portrait screen, a larger text size) and not the size's name.
 */
function ladder(root: HTMLElement, steps: (() => boolean | void)[]): void {
  let i = 0;
  let guard = 60;
  while (i < steps.length && guard-- > 0 && cut(root)) if (steps[i]() !== true) i++;
}

/** A step: the text of the card at `k` times its size. */
const dkStep = (root: HTMLElement, k: number) => () => {
  root.style.setProperty('--dk', String(k));
};

/** A step: while the rows are taller than the card, the last one goes (one row always stays). */
function dropRow(root: HTMLElement, list: HTMLElement | null, row: string): () => boolean {
  return () => {
    if (!list || !cutV(root)) return false;
    const rows = list.querySelectorAll(row);
    if (rows.length < 2) return false;
    // from the bottom up to the last row (a "no games" line after it goes first), then a title left with nothing under it
    for (let last = list.lastElementChild; last; last = list.lastElementChild) {
      last.remove();
      if (last.matches(row)) break;
    }
    while (list.lastElementChild?.matches('.cv-sp-group')) list.lastElementChild.remove();
    return true;
  };
}

/** A step taken only when something is cut sideways (a name, a row), not for a card that is too short. */
const sideways = (root: HTMLElement, fn: () => void) => () => {
  if (cutH(root)) fn();
};

/**
 * Grow the text of a list card until it fills its box (up to `max` times): the rows were counted at the normal size,
 * so a card with room to spare reads from further away. Never so far that something is cut again.
 */
function fill(root: HTMLElement, list: HTMLElement | null, max = 1.6): void {
  if (!list || !root.isConnected || cut(root)) return;
  const cs = getComputedStyle(root);
  const foot = root.querySelector<HTMLElement>(':scope > .cv-dt-foot');
  const room = root.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - (foot ? foot.getBoundingClientRect().height + 8 : 0);
  // the rows' own height (the list itself stretches to the card)
  const kids = [...list.children] as HTMLElement[];
  if (!kids.length) return;
  const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
  const need = kids.reduce((n, k) => n + k.getBoundingClientRect().height + gap, 0);
  if (room <= 0 || need <= 0) return;
  const k0 = parseFloat(root.style.getPropertyValue('--dk')) || 1;
  const k = Math.min(max, (k0 * room) / need);
  if (k < k0 * 1.05) return;
  root.style.setProperty('--dk', k.toFixed(3));
  if (!cut(root)) return;
  // too far (a name got cut): the largest size that still fits, in a few halvings
  let lo = k0;
  let hi = k;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    root.style.setProperty('--dk', mid.toFixed(3));
    if (cut(root)) hi = mid;
    else lo = mid;
  }
  root.style.setProperty('--dk', lo.toFixed(3));
}

/** The rows of a list card share the card's height (.is-spread) when they leave a band under them, and nothing gets cut. */
function spreadRows(root: HTMLElement, list: HTMLElement | null): void {
  if (!list || !root.isConnected || cut(root)) return;
  const last = list.lastElementChild?.getBoundingClientRect();
  const box = list.getBoundingClientRect();
  if (!last || box.bottom - last.bottom < box.height * 0.04) return;
  // the rows take the height in equal shares, a heading only its own line (a grid track per child)
  list.style.gridTemplateRows = [...list.children].map((c) => (c.matches('.cv-sp-game, .cv-mk-row, .cv-st-row') ? 'minmax(min-content, 1fr)' : 'auto')).join(' ');
  root.classList.add('is-spread');
  if (cut(root)) {
    root.classList.remove('is-spread');
    list.style.gridTemplateRows = '';
  }
}

/** A card body that keeps its last drawing key, its box, and a rotation index. */
interface Base {
  env: AdapterEnv;
  root: HTMLElement;
  box: AdapterBox | null;
  sig: string;
}

// ------------------------------------------------------------------------------------------------ market and currency

/** One row of a Cripto or Divisas card: a coin in its currency, or a pair of currencies. */
type PriceRow = MarketCoinData & { noData?: boolean };

/** What differs between Cripto and Divisas: the rows of an answer and of the props, the row's label, the number. */
interface PriceLook {
  cls: string;
  /** the rows of the answer (null: none yet) */
  rows(d: DataItemData | null | undefined): PriceRow[] | null;
  /** the rows the props name, before any number */
  skeleton(p: Props): PriceRow[];
  /** what says which row it is: the coin's badge, the pair */
  label(c: PriceRow): HTMLElement;
  fmt(v: number | null, c: PriceRow): string;
  /** the default period */
  range: string;
  /** a list too narrow: the names go before the sparklines move behind the rows (a pair says enough by itself) */
  namesFirst?: boolean;
}

function coinSkeleton(p: Props): MarketCoinData[] {
  return (Array.isArray(p.coins) ? p.coins : []).map((c: Props) => ({ id: c.id, sym: c.sym || String(c.id).slice(0, 5).toUpperCase(), name: c.name || '', cur: c.currency || 'eur', price: null, ch: null, pts: [] }));
}

const MARKET_LOOK: PriceLook = {
  cls: 'cv-mk',
  rows: (d) => ((d as MarketData | null | undefined)?.coins?.length ? (d as MarketData).coins : null),
  skeleton: coinSkeleton,
  label: (c) => coinBadge(c),
  fmt: (v, c) => fmtPrice(v, c.cur),
  range: '7d',
};

/** A pair as a row: EUR/HUF, the quote's name in the screen's language. */
const pairRow = (x: { base: string; quote: string; rate?: number | null; ch?: number | null; pts?: [number, number][]; noData?: boolean }): PriceRow => ({
  id: `${x.base}${x.quote}`, sym: `${x.base}/${x.quote}`, name: currencyName(x.quote), cur: x.quote, price: x.rate ?? null, ch: x.ch ?? null, pts: x.pts ?? [], ...(x.noData ? { noData: true } : {}),
});

export const CURRENCY_LOOK: PriceLook = {
  cls: 'cv-fx',
  rows: (d) => ((d as CurrencyData | null | undefined)?.pairs?.length ? (d as CurrencyData).pairs.map(pairRow) : null),
  skeleton: (p) => (Array.isArray(p.pairs) ? p.pairs : []).filter((x: Props) => x && x.base && x.quote).map((x: Props) => pairRow({ base: String(x.base), quote: String(x.quote) })),
  label: (c) => el('b', 'cv-fx-pair', c.sym),
  fmt: (v) => fmtRate(v),
  range: '30d',
  namesFirst: true,
};

function market(item0: DisplayCanvasItem, look: PriceLook = MARKET_LOOK): CanvasAdapter {
  const b = { box: null, sig: '' } as unknown as Base;
  let idx = 0;
  let turnAt = Date.now();
  const render = (force = false) => {
    const { env, root } = b;
    const it = env.item();
    const p = it.props as Props;
    const d = env.data.get(item0.id);
    const coins = look.rows(d) ?? look.skeleton(p);
    // a box past the named sizes with one coin: the big price and its chart rather than one line of a list
    // a box one cell high (the compact look): one coin on one line, each in turn like the big card
    const line = isLine(root);
    const big = !line && (p.layout === 'big' || b.box?.size === 'xs' || (root.dataset.room !== undefined && coins.length === 1));
    if ((big || line) && coins.length) idx %= coins.length;
    const sig = JSON.stringify([it.v, d, b.box?.w, b.box?.h, ctx.lang, big || line ? idx : -1, line, Math.floor(Date.now() / 60_000)]);
    if (sig === b.sig && !force) return;
    b.sig = sig;
    root.textContent = '';
    root.classList.remove('no-name', 'has-bgchart', 'is-bg', 'is-line');
    root.style.setProperty('--dk', '1');
    root.classList.toggle('is-big', big);
    const n0 = emptyNote(d, look.skeleton(p).length > 0);
    if (n0 && !(d === undefined && coins.length)) return note(root, n0);
    // nothing the source knows (a pair of a currency the ECB does not publish): which ones, rather than empty rows
    if (d && coins.length && coins.every((c) => c.noData)) return note(root, ctx.t('dtNoDataFor', { s: coins.map((c) => c.sym).join(', ') }));
    const range = String((d as MarketData | CurrencyData | null | undefined)?.range || p.range || look.range);
    const chart: 'line' | 'area' | 'none' = p.chart === 'none' ? 'none' : p.chart === 'line' ? 'line' : 'area';
    if (line) {
      const c = coins[idx] ?? coins[0];
      if (!c) return;
      const row = drawLineRow(root, chart === 'none' ? null : spark(c.pts, trend(c.ch)), `cv-mk-row is-${trend(c.ch)}`);
      const who = el('div', 'cv-mk-who');
      who.append(look.label(c), el('span', 'cv-mk-name', c.name || c.sym));
      row.prepend(who);
      row.appendChild(valueOf(c, (v) => look.fmt(v, c)));
      const st = staleText(env, item0.id, d);
      root.classList.toggle('is-stale', !!st);
      if (b.box) fitLine(root, b.box);
      return;
    }
    const style = chartStyleOf(p, 'below');
    if (big) drawBig(root, coins[idx] ?? coins[0], coins.length, idx, chart, b.box, style, look);
    else drawList(root, coins, chart, b.box, style, look);
    const foot = el('div', 'cv-dt-foot');
    foot.append(el('span', 'cv-dt-range', ctx.t(RANGE_KEY[range] ?? 'dt7d')));
    const st = staleText(env, item0.id, d);
    if (st) foot.append(el('span', 'cv-dt-stale', st));
    root.appendChild(foot);
    root.classList.toggle('is-stale', !!st);
    // a background chart: the lowest and highest in the bottom corner, on the period's line (the old-numbers note
    // takes that corner when there is one)
    const mm = root.querySelector(':scope > .cv-mk-minmax');
    if (mm && root.classList.contains('is-bg')) {
      if (st) mm.remove();
      else foot.appendChild(mm);
    }
    if (big && b.box) {
      fitBig(root, b.box, Number(it.style?.scale) || 1);
      if (root.classList.contains('is-bg')) placeBg(root, coins[idx] ?? coins[0], chart);
    } else if (b.box) {
      const list = root.querySelector<HTMLElement>('.cv-mk-list');
      const names = sideways(root, () => root.classList.add('no-name'));
      const behind = sideways(root, () => sparksBehind(root));
      ladder(root, [
        ...(look.namesFirst ? [names, behind] : [behind, names]),
        dropRow(root, list, '.cv-mk-row'),
        dkStep(root, 0.9), dkStep(root, 0.8), dkStep(root, 0.7),
      ]);
      if (root.classList.contains('is-bg')) fillBands(root, 1.4);
      else fill(root, list, 1.4);
      bleedRows(root);
    }
  };
  return dataAdapter(b, look.cls, render, (t) => {
    // a big card with several coins shows each in turn, 10 s each
    const p = b.env.item().props as Props;
    const n = look.rows(b.env.data.get(item0.id))?.length ?? 0;
    if ((p.layout === 'big' || b.box?.size === 'xs' || isLine(b.root)) && n > 1 && t.ms - turnAt >= 10_000) {
      turnAt = t.ms;
      idx = (idx + 1) % n;
      render();
    } else if (t.minuteChanged) render();
  });
}

/** A box one cell high (the compact look, widgets/canvas.ts miniMark): the card on one line. */
const isLine = (root: HTMLElement) => root.dataset.mini !== undefined && root.dataset.mh === '1';

/** The one line of a card one cell high, with its sparkline in the middle (`s`, when there is one). */
function drawLineRow(root: HTMLElement, s: SVGSVGElement | null | undefined, cls: string): HTMLElement {
  root.classList.add('is-line');
  const row = el('div', cls);
  if (s) {
    const holder = el('div', 'cv-mk-spark');
    holder.appendChild(s);
    row.appendChild(holder);
  }
  root.appendChild(row);
  return row;
}

/**
 * The line's text as large as about half the box's height allows, then, while something does not fit: the
 * name goes (the badge or the symbol stays), the sparkline goes, the text gets smaller, and last the change goes.
 */
function fitLine(root: HTMLElement, box: AdapterBox): void {
  // (the item's text size is on top of --dk already: .cv-dt reads --cv-scale)
  const k = Math.max(0.8, Math.min(1.5, (box.h * 0.45) / (box.rem * 1.6)));
  root.style.setProperty('--dk', k.toFixed(3));
  const dk = (f: number) => () => root.style.setProperty('--dk', Math.max(0.7, k * f).toFixed(3));
  ladder(root, [
    () => root.classList.add('no-name'),
    () => root.querySelectorAll('.cv-mk-spark, .cv-st-spark').forEach((x) => x.remove()),
    dk(0.9), dk(0.8), dk(0.7), dk(0.6), dk(0.55), dk(0.5), dk(0.45),
    () => root.querySelectorAll('.cv-dt-ch').forEach((x) => x.remove()),
  ]);
}

function coinBadge(c: PriceRow): HTMLElement {
  const s = el('span', 'cv-mk-badge', c.sym.slice(0, 4));
  s.dataset.len = String(Math.min(4, c.sym.length));
  return s;
}

function drawList(root: HTMLElement, coins: PriceRow[], chart: 'line' | 'area' | 'none', box: AdapterBox | null, style: ChartStyle, look: PriceLook): void {
  const rem = box?.rem ?? 10;
  // behind each row, whatever the card's width (each row then a band, its curve under its text); beside the name and
  // the price only where there is room for it
  const behind = chart !== 'none' && style === 'background' && coins.some((c) => c.pts.length >= 2);
  const rows = box ? Math.max(1, Math.floor((box.h - rem * 2.4) / (rem * (behind ? 5.6 : 3.6)))) : coins.length;
  const withSpark = chart !== 'none' && !behind && (!box || box.w / rem >= 26);
  const list = el('div', 'cv-mk-list');
  for (const c of coins.slice(0, rows)) {
    const row = el('div', `cv-mk-row is-${trend(c.ch)}`);
    const who = el('div', 'cv-mk-who');
    who.append(look.label(c), el('span', 'cv-mk-name', c.name || c.sym));
    row.appendChild(who);
    if (withSpark) {
      const s = spark(c.pts, trend(c.ch));
      const holder = el('div', 'cv-mk-spark');
      if (s) holder.appendChild(s);
      row.appendChild(holder);
    }
    row.appendChild(valueOf(c, (v) => look.fmt(v, c)));
    // (a card too narrow for it beside the numbers: behind the row, never none)
    if (behind || (chart !== 'none' && !withSpark)) rowBg(row, c.pts, trend(c.ch), behind && chart === 'area');
    list.appendChild(row);
  }
  root.classList.toggle('is-bg', behind);
  root.appendChild(list);
}

/**
 * The large card in its box: the price as big as the height allows, then, while something does not fit, the period
 * moves up beside the name as a small pill, the lowest and highest go, the price gets smaller, the chart under it
 * moves behind it, the name goes (the badge keeps the symbol), smaller still.
 */
function fitBig(root: HTMLElement, box: AdapterBox, scale: number): void {
  const wk0 = fitWidth(root, root.querySelector('.cv-mk-price'), bigType(root, box, 9, scale));
  const wk = (f: number) => () => {
    root.style.setProperty('--wk', Math.max(0.3, wk0 * f).toFixed(3));
  };
  // the chart behind it ("De fondo"): the price gets a little smaller first, so the period and the lowest and
  // highest keep their line at the bottom, over the chart's faded foot; then the room for the chart goes (the chart
  // stays, behind the numbers)
  if (root.classList.contains('is-bg')) {
    // the lowest and highest beside the period only when the line holds both (its size does not follow the price's)
    const foot = root.querySelector<HTMLElement>(':scope > .cv-dt-foot');
    if (foot && foot.scrollWidth > foot.clientWidth + 1) root.querySelector('.cv-mk-minmax')?.remove();
    ladder(root, [
      wk(0.9), wk(0.8), wk(0.72),
      () => {
        if (cutV(root)) rangeUp(root);
      },
      () => root.querySelector('.cv-mk-minmax')?.remove(),
      () => root.querySelector('.cv-mk-chart')?.remove(),
      sideways(root, () => root.classList.add('no-name')),
      wk(0.6), wk(0.5), wk(0.4),
    ]);
    return;
  }
  ladder(root, [
    () => {
      if (cutV(root)) rangeUp(root);
    },
    () => root.querySelector('.cv-mk-minmax')?.remove(),
    wk(0.85), wk(0.72),
    // the band under the numbers goes, and its chart moves behind them (placeBg): it stays on the card
    () => {
      const band = root.querySelector('.cv-mk-chart');
      if (!band) return;
      band.remove();
      root.classList.add('is-bg', 'has-bgchart');
    },
    sideways(root, () => root.classList.add('no-name')),
    wk(0.6), wk(0.5), wk(0.4),
  ]);
}

/** The period from the line under the chart to a pill at the top right, beside the coin's name. */
function rangeUp(root: HTMLElement): void {
  const head = root.querySelector('.cv-mk-head');
  const range = root.querySelector('.cv-dt-foot .cv-dt-range');
  if (!head || !range) return;
  range.classList.add('is-pill');
  head.insertBefore(range, head.querySelector('.cv-mk-dots'));
  const foot = root.querySelector('.cv-dt-foot');
  if (foot && !foot.childElementCount) foot.remove();
}

function drawBig(root: HTMLElement, c: PriceRow | undefined, n: number, idx: number, chart: 'line' | 'area' | 'none', box: AdapterBox | null, style: ChartStyle, look: PriceLook): void {
  if (!c) return;
  const fmt = (v: number | null) => look.fmt(v, c);
  const head = el('div', 'cv-mk-head');
  head.append(look.label(c), el('span', 'cv-mk-name', c.name || c.sym));
  if (n > 1) {
    const dots = el('span', 'cv-mk-dots');
    for (let i = 0; i < n; i++) dots.appendChild(el('i', i === idx ? 'on' : ''));
    head.appendChild(dots);
  }
  const price = el('div', 'cv-mk-price', c.noData ? ctx.t('dtNoDataRow') : fmt(c.price));
  const line = el('div', 'cv-mk-line');
  line.append(price);
  root.append(head, line, changeChip(c.ch));
  const ys = c.pts.map((x) => x[1]);
  const tall = !box || box.h / box.rem >= 9;
  // a card too short for a band under the numbers draws its chart behind them, whichever style: never none
  if (chart !== 'none' && (style === 'background' || !tall) && c.pts.length >= 2) {
    // behind the text: a band of room for it under the numbers where the card is tall enough (the chart itself is
    // drawn once the card is fitted, placeBg), the lowest and highest in the bottom corner
    root.classList.add('is-bg', 'has-bgchart');
    if (tall) root.appendChild(el('div', 'cv-mk-chart is-room'));
    if (box && box.h / box.rem >= 16 && box.w / box.rem >= 26) {
      const mm = el('div', 'cv-mk-minmax');
      mm.append(el('span', '', `${ctx.t('haMin')} ${fmt(Math.min(...ys))}`), el('span', '', `${ctx.t('haMax')} ${fmt(Math.max(...ys))}`));
      root.appendChild(mm);
    }
    return;
  }
  if (chart !== 'none' && tall) {
    const s = curve(c.pts, { area: chart === 'area', tone: trend(c.ch), cls: 'cv-dt-area' });
    if (s) {
      const holder = el('div', 'cv-mk-chart');
      holder.appendChild(s);
      root.appendChild(holder);
      // the lowest and highest of the range, under the chart, where there is room for a line of its own
      if (ys.length && box && box.h / box.rem >= 26 && box.w / box.rem >= 30) {
        const mm = el('div', 'cv-mk-minmax');
        mm.append(el('span', '', `${ctx.t('haMin')} ${fmt(Math.min(...ys))}`), el('span', '', `${ctx.t('haMax')} ${fmt(Math.max(...ys))}`));
        root.appendChild(mm);
      }
    }
  }
}

/**
 * The big card's background chart, once its text is fitted: from the top of the room left for it under the numbers
 * (at least 30 % of the card, the price gets smaller for it; in a card too short for that room, from 40 % of its
 * height, behind the numbers) down to the card's bottom edge,
 * edge to edge; the curve stays above the line at the bottom (the period, the lowest and highest).
 */
function placeBg(root: HTMLElement, c: PriceRow | undefined, chart: 'line' | 'area' | 'none'): void {
  if (!c) return;
  const H = root.clientHeight;
  const room = root.querySelector<HTMLElement>('.cv-mk-chart.is-room');
  const top = room ? Math.min(room.offsetTop, H * 0.7) : H * 0.4;
  const foot = root.querySelector<HTMLElement>(':scope > .cv-dt-foot');
  const mm = root.querySelector<HTMLElement>(':scope > .cv-mk-minmax');
  const low = Math.min(foot?.offsetTop ?? H, mm?.offsetTop ?? H);
  const span = Math.max(1, H - top);
  const s = curve(c.pts, { area: chart === 'area', tone: trend(c.ch), top: 0.08, bottom: Math.min(0.45, Math.max(0.06, (H - low + 6) / span)) });
  if (!s) return;
  const bg = el('div', 'cv-bgchart cv-mk-bg');
  bg.style.top = `${Math.round(top)}px`;
  bg.appendChild(s);
  root.appendChild(bg);
}

// ------------------------------------------------------------------------------------------------ sports

const pad2 = (n: number) => String(n).padStart(2, '0');

/** When a game starts: "Hoy 21:00", "Mañana 18:30", "sáb 19:00", or "12 nov 20:45" further away. */
function kickoff(t: number, now = Date.now()): string {
  const k = kickoffParts(t, now);
  return k.time ? `${k.day} ${k.time}` : k.day;
}

/** When a game starts as the day ("Hoy", "Mañana", "sáb", "12 nov") and the time ('' further than a week away). */
function kickoffParts(t: number, now = Date.now()): { day: string; time: string } {
  try {
    const tz = ctx.tz;
    const dayOf = (x: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x));
    const time = new Intl.DateTimeFormat(ctx.lang, { hour: '2-digit', minute: '2-digit', hour12: !ctx.cfg.datetime.format24, timeZone: tz }).format(new Date(t));
    const d0 = Date.parse(`${dayOf(now)}T00:00:00Z`);
    const d1 = Date.parse(`${dayOf(t)}T00:00:00Z`);
    const days = Math.round((d1 - d0) / 86400_000);
    if (days === 0) return { day: ctx.t('today'), time };
    if (days === 1) return { day: ctx.t('tomorrow'), time };
    if (days === -1) return { day: ctx.t('yesterday'), time };
    if (Math.abs(days) < 7) return { day: new Intl.DateTimeFormat(ctx.lang, { weekday: 'short', timeZone: tz }).format(new Date(t)), time };
    return { day: new Intl.DateTimeFormat(ctx.lang, { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(t)), time: '' };
  } catch {
    const d = new Date(t);
    return { day: '', time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
  }
}

/** The status under the score: the minute (live), half time, final, or when it starts. */
function gameStatus(g: SportsGame): { text: string; live: boolean } {
  if (g.note) return { text: ctx.t(`dtNote_${g.note}`), live: false };
  if (g.st === 'in') return { text: g.half ? ctx.t('dtHalf') : g.clk || ctx.t('dtLive'), live: true };
  if (g.st === 'post') {
    const c = g.clk.toUpperCase();
    if (/PEN/.test(c)) return { text: ctx.t('dtPens'), live: false };
    if (/AET|OT/.test(c)) return { text: ctx.t('dtAet'), live: false };
    return { text: ctx.t('dtFinal'), live: false };
  }
  return { text: kickoff(g.t), live: false };
}

/** Black or white initials on a team's colour (when the crest is missing). */
function inkOn(hex: string | null): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '';
  const n = parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? '#111' : '#fff';
}

function crestEl(env: AdapterEnv, s: SportsSide, show: boolean, redraw: () => void): HTMLElement {
  const box = el('span', 'cv-sp-cr');
  if (!show) return box;
  const url = s.cr ? env.data.crest(s.cr, redraw) : null;
  if (url) {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = url;
    box.appendChild(img);
  } else {
    const ini = el('span', 'cv-sp-ini', (s.ab || s.n).slice(0, 3));
    if (s.c) {
      ini.style.background = s.c;
      ini.style.color = inkOn(s.c);
    }
    box.appendChild(ini);
  }
  return box;
}

function sports(item0: DisplayCanvasItem): CanvasAdapter {
  const b = { box: null, sig: '' } as unknown as Base;
  let crestTick = 0;
  const redraw = () => {
    crestTick++;
    render(true);
  };
  const render = (force = false) => {
    const { env, root } = b;
    const it = env.item();
    const p = it.props as Props;
    const d = env.data.get(item0.id) as SportsData | null | undefined;
    const sig = JSON.stringify([it.v, d, b.box?.w, b.box?.h, ctx.lang, Math.floor(Date.now() / 60_000), crestTick]);
    if (sig === b.sig && !force) return;
    b.sig = sig;
    root.textContent = '';
    root.classList.remove('no-name', 'no-lg', 'is-spread');
    root.style.setProperty('--dk', '1');
    const configured = Array.isArray(p.follow) && p.follow.length > 0;
    const n0 = emptyNote(d, configured);
    if (n0) return note(root, n0);
    const groups = (d as SportsData).groups ?? [];
    const rem = b.box?.rem ?? 10;
    const narrow = !!b.box && b.box.w / rem < 30;
    const short = !!b.box && b.box.w / rem < 20;
    root.classList.toggle('is-narrow', narrow);
    const heads = !!b.box && b.box.h / rem >= 9;
    let room = b.box ? Math.max(1, Math.floor((b.box.h - rem * (1.6 + (heads ? groups.length * 2.2 : 0))) / (rem * (narrow ? 4 : 4.4)))) : 8;
    const list = el('div', 'cv-sp-list');
    let any = false;
    for (const g of groups) {
      if (room <= 0) break;
      if (heads && (groups.length > 1 || g.games.length)) {
        const h = el('div', 'cv-sp-group');
        // the league's short name only when the title does not say it already (Champions League, Champions)
        h.append(el('span', 'l', g.label), el('span', 'lg', g.lg && !g.label.toLowerCase().includes(g.lg.toLowerCase()) ? g.lg : ''));
        list.appendChild(h);
      }
      if (!g.games.length) {
        list.appendChild(el('div', 'cv-sp-none', ctx.t('dtNoGames')));
        continue;
      }
      for (const game of g.games.slice(0, room)) {
        any = true;
        room--;
        const st = gameStatus(game);
        const row = el('div', `cv-sp-game is-${game.st}${game.note ? ' is-off' : ''}`);
        const side = (s: SportsSide, home: boolean) => {
          const x = el('div', `cv-sp-side ${home ? 'home' : 'away'}${s.w ? ' is-win' : ''}`);
          const name = el('span', 'cv-sp-n', short ? s.ab || s.n : s.n);
          if (s.ab) name.dataset.ab = s.ab;
          const cr = crestEl(env, s, p.crests !== false, redraw);
          if (home) x.append(name, cr);
          else x.append(cr, name);
          return x;
        };
        const mid = el('div', 'cv-sp-mid');
        // a game to come: its time where the score will be and the day under it (as compact as a score), or "–"
        const ko = game.st === 'pre' && !game.note ? kickoffParts(game.t) : null;
        if (ko?.time) mid.appendChild(el('b', 'cv-sp-sc is-time', ko.time));
        else if (game.st === 'pre' || game.note) mid.appendChild(el('span', 'cv-sp-vs', '–'));
        else mid.appendChild(el('b', 'cv-sp-sc', `${game.home.sc || '0'} – ${game.away.sc || '0'}`));
        const stx = el('span', `cv-sp-st${st.live ? ' is-live' : ''}`);
        if (st.live) stx.appendChild(el('i', 'dot'));
        stx.appendChild(el('span', '', ko?.time ? ko.day : st.text));
        mid.appendChild(stx);
        row.append(side(game.home, true), mid, side(game.away, false));
        list.appendChild(row);
      }
    }
    if (!any && !groups.length) return note(root, ctx.t('dtNoGames'));
    root.appendChild(list);
    const stale = staleText(env, item0.id, d);
    if (stale) root.appendChild(staleFoot(stale));
    root.classList.toggle('is-stale', !!stale);
    if (b.box) {
      const crests = p.crests !== false;
      ladder(root, [
        // names that do not fit: the crests alone (they say who plays), or the short names without crests
        sideways(root, () => {
          if (crests) root.classList.add('no-name');
          else root.querySelectorAll<HTMLElement>('.cv-sp-n[data-ab]').forEach((n) => (n.textContent = n.dataset.ab ?? n.textContent));
        }),
        sideways(root, () => root.classList.add('no-lg')),
        dropRow(root, list, '.cv-sp-game'),
        dkStep(root, 0.9), dkStep(root, 0.8),
        sideways(root, () => root.classList.add('no-name')),
        dkStep(root, 0.7), dkStep(root, 0.6),
      ]);
    }
    // a card with room to spare: the games larger (as far as nothing gets cut), then, in a box taller than that, the
    // rows share its height so the list reaches the bottom of the card
    fill(root, list, 2);
    spreadRows(root, list);
  };
  return dataAdapter(b, 'cv-sp', render, (t) => {
    if (t.minuteChanged) render();
  });
}

// ------------------------------------------------------------------------------------------------ stocks

function stocks(item0: DisplayCanvasItem): CanvasAdapter {
  const b = { box: null, sig: '' } as unknown as Base;
  let anim: Animation | null = null;
  /** where the running line was (ms into its loop), so a redraw (new numbers, a new minute) carries on from there */
  let phase = 0;
  let page = 0;
  let pageAt = Date.now();
  const stop = () => {
    const ct = anim?.currentTime;
    if (typeof ct === 'number' && Number.isFinite(ct)) phase = ct;
    anim?.cancel();
    anim = null;
  };
  const render = (force = false) => {
    const { env, root } = b;
    const it = env.item();
    const p = it.props as Props;
    const d = env.data.get(item0.id) as StocksData | null | undefined;
    const sig = JSON.stringify([it.v, d, b.box?.w, b.box?.h, ctx.lang, Math.floor(Date.now() / 60_000), page]);
    if (sig === b.sig && !force) return;
    b.sig = sig;
    stop();
    root.textContent = '';
    root.classList.remove('no-name', 'is-bg');
    root.style.setProperty('--dk', '1');
    const configured = Array.isArray(p.symbols) && p.symbols.length > 0;
    if (d && (d as StocksData).needsKey) return note(root, ctx.t('dtNeedsKey'));
    const n0 = emptyNote(d, configured);
    if (n0) return note(root, n0);
    const quotes = (d as StocksData).quotes ?? [];
    // no symbol with data (unknown, all zeros, not on the free plan): which ones, never a card that keeps loading
    if (quotes.length && quotes.every((q) => q.noData)) return note(root, ctx.t('dtNoDataFor', { s: quotes.map((q) => q.sym).join(', ') }));
    const ticker = p.layout !== 'list';
    const line = isLine(root);
    root.classList.toggle('is-ticker', ticker);
    root.classList.remove('is-line');
    delete root.dataset.pages;
    if (line && !ticker) {
      // a list one cell high: one quote on one line, each in turn (tick)
      const q = quotes[page % Math.max(1, quotes.length)];
      if (!q) return;
      if (quotes.length > 1) root.dataset.pages = String(quotes.length);
      const row = drawLineRow(root, p.sparkline === true ? spark(q.pts, trend(q.ch)) : null, `cv-st-row is-${trend(q.ch)}`);
      const who = el('div', 'cv-st-who');
      who.append(el('b', 'sym', q.sym), el('span', 'nm', q.name));
      row.prepend(who);
      row.appendChild(valueOf(q, (v) => fmtPrice(v)));
      root.classList.toggle('is-stale', !!staleText(env, item0.id, d));
      if (b.box) fitLine(root, b.box);
      return;
    }
    if (ticker && b.box) {
      // the line grows with the card's height, within reason (one cell high: about half of it)
      const px = (line ? Math.max(b.box.rem * 1.4, Math.min(b.box.h * 0.4, b.box.rem * 2.6)) : Math.max(b.box.rem * 1.6, Math.min(b.box.h * 0.17, b.box.rem * 3.6))) * (Number(it.style?.scale) || 1);
      root.style.setProperty('--tk', `${px.toFixed(1)}px`);
    }
    if (ticker) drawTicker(root, quotes, b.box, p.sparkline === true);
    else drawQuotes(root, quotes, b.box, p.sparkline === true, chartStyleOf(p, 'below'));
    const stale = staleText(env, item0.id, d);
    if (stale) root.appendChild(staleFoot(stale));
    root.classList.toggle('is-stale', !!stale);
    if (!ticker && b.box) {
      const list = root.querySelector<HTMLElement>('.cv-st-list');
      ladder(root, [
        sideways(root, () => root.querySelectorAll('.cv-mk-val.is-inline').forEach((x) => x.classList.remove('is-inline'))),
        sideways(root, () => sparksBehind(root)),
        sideways(root, () => root.classList.add('no-name')),
        dropRow(root, list, '.cv-st-row'),
        dkStep(root, 0.9), dkStep(root, 0.8), dkStep(root, 0.7),
      ]);
      if (root.classList.contains('is-bg')) fillBands(root, 1.8);
      else fill(root, list, 1.8);
      bleedRows(root);
    }
  };
  const drawTicker = (root: HTMLElement, quotes: StocksData['quotes'], box: AdapterBox | null, withSpark: boolean) => {
    const vp = el('div', 'cv-st-vp');
    const track = el('div', 'cv-st-track');
    const one = (q: StockQuoteData) => {
      const x = el('span', `cv-st-q is-${trend(q.ch)}`);
      if (q.noData) {
        x.append(el('b', 'sym', q.sym), el('span', 'cv-dt-nd', ctx.t('dtNoDataRow')));
        return x;
      }
      x.append(el('b', 'sym', q.sym), el('span', 'p', fmtPrice(q.price)));
      x.appendChild(changeChip(q.ch));
      if (withSpark) {
        const s = spark(q.pts, trend(q.ch), 'cv-st-spark');
        if (s) x.appendChild(s);
      }
      return x;
    };
    for (const q of quotes) track.appendChild(one(q));
    vp.appendChild(track);
    root.appendChild(vp);
    const moving = !b.env.low() && !reducedMotion();
    requestAnimationFrame(() => {
      if (!vp.isConnected) return;
      const w = track.scrollWidth;
      const room = vp.clientWidth;
      if (w <= room) return;
      if (moving && typeof track.animate === 'function') {
        // a second copy right after the first, so the line runs on without a gap
        for (const q of quotes) track.appendChild(one(q));
        const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        const dist = w + gap;
        const rem = box?.rem ?? 10;
        const duration = (dist / (rem * 6)) * 1000;
        anim = track.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-dist}px)` }], { duration, iterations: Infinity, easing: 'linear' });
        anim.currentTime = phase % duration;
      } else {
        // no motion: the quotes in pages that fit, one after another (tick)
        const kids = [...track.children] as HTMLElement[];
        // a small box (the compact look): a quote wider than the line gets smaller type, so each page shows it whole
        if (root.dataset.mini !== undefined) {
          const widest = Math.max(...kids.map((k) => k.getBoundingClientRect().width));
          const tk = parseFloat(root.style.getPropertyValue('--tk')) || 0;
          if (tk && widest > room) root.style.setProperty('--tk', `${Math.max(8, (tk * room) / widest - 0.5).toFixed(1)}px`);
        }
        let x = 0;
        const pages: number[][] = [[]];
        for (const [i, k] of kids.entries()) {
          const kw = k.getBoundingClientRect().width + (parseFloat(getComputedStyle(track).columnGap) || 0);
          if (x + kw > room && pages[pages.length - 1].length) {
            pages.push([]);
            x = 0;
          }
          pages[pages.length - 1].push(i);
          x += kw;
        }
        const show = new Set(pages[page % pages.length]);
        kids.forEach((k, i) => (k.hidden = !show.has(i)));
        vp.classList.add('is-static');
        root.dataset.pages = String(pages.length);
      }
    });
  };
  const drawQuotes = (root: HTMLElement, quotes: StocksData['quotes'], box: AdapterBox | null, withSpark: boolean, style: ChartStyle) => {
    const rem = box?.rem ?? 10;
    // behind each row, whatever the card's width (each row then a band, its curve under its text); beside the name
    // and the price only where there is room for it
    // (the quotes this server has read are the curve: none yet, no bands either)
    const behind = withSpark && style === 'background' && quotes.some((q) => q.pts.length >= 2);
    const rows = box ? Math.max(1, Math.floor((box.h - rem * 1.6) / (rem * (behind ? 5.2 : 3.2)))) : quotes.length;
    const sp = withSpark && !behind && (!box || box.w / rem >= 26);
    const list = el('div', 'cv-st-list');
    for (const q of quotes.slice(0, rows)) {
      const row = el('div', `cv-st-row is-${trend(q.ch)}`);
      const who = el('div', 'cv-st-who');
      who.append(el('b', 'sym', q.sym), el('span', 'nm', q.name));
      row.appendChild(who);
      if (sp) {
        const holder = el('div', 'cv-mk-spark');
        const s = spark(q.pts, trend(q.ch));
        if (s) holder.appendChild(s);
        row.appendChild(holder);
      }
      // the price and its change on one line in a card wide enough for them (each quote one line, not two)
      row.appendChild(valueOf(q, (v) => fmtPrice(v), `cv-mk-val${!box || box.w / rem >= 30 ? ' is-inline' : ''}`));
      // (a card too narrow for it beside the numbers: behind the row, never none)
      if (behind || (withSpark && !sp)) rowBg(row, q.pts, trend(q.ch), behind);
      list.appendChild(row);
    }
    root.classList.toggle('is-bg', behind);
    root.appendChild(list);
  };
  const a = dataAdapter(b, 'cv-st', render, (t) => {
    const pages = Number(b.root.dataset.pages || 0);
    if (pages > 1 && t.ms - pageAt >= 8000) {
      pageAt = t.ms;
      page = (page + 1) % pages;
      render();
    } else if (t.minuteChanged) render();
  });
  const destroy = a.destroy;
  a.destroy = () => {
    stop();
    destroy();
  };
  return a;
}

// ------------------------------------------------------------------------------------------------ shared adapter

function dataAdapter(b: Base, cls: string, render: (force?: boolean) => void, tick: (t: { ms: number; minuteChanged: boolean }) => void): CanvasAdapter {
  return {
    mount(r, e) {
      b.root = r;
      b.env = e;
      r.classList.add('cv-dt', cls);
      render(true);
    },
    update: () => render(true),
    layout(box) {
      b.box = box;
      b.root.dataset.size = box.size;
      // drawn again from the fullest card and fitted down: the result depends on this box only, never on the boxes
      // and the steps before it
      render(true);
    },
    tick(t) {
      tick({ ms: Date.now(), minuteChanged: !!t.minuteChanged });
    },
    data(topic) {
      if (topic === 'data' || topic === 'config') render();
    },
    destroy() {
      b.root.textContent = '';
    },
  };
}

export const DATA_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  market: (item) => market(item),
  sports: (item) => sports(item),
  stocks: (item) => stocks(item),
  currency: (item) => market(item, CURRENCY_LOOK),
};
