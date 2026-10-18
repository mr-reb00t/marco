// Personalizado screens (layout 'canvas'): the widgets the owner placed on the grid of the main area (#canvas) and in
// the sidebar stack (#canvas-side), each in its own card. The server sends what to show (DisplayConfig.canvas,
// server/core/canvasCore.js projectCanvas); this controller lays the cards out, keeps one adapter per item
// (widgets/canvas/*.ts) and passes it the clock ticks, the data changes and its size.
//
// - Reconciled by item id and kind: an item whose `v` changed is updated in place, never rebuilt, so the admin
//   preview and config polls do not flicker; a new kind on the same id gets a new adapter.
// - One ResizeObserver for every card body, batched in an animation frame: adapters fit their content to the box and
//   a card that cannot fit even at its smallest is marked .is-cramped.
// - A card with nothing to show (no message, no countdowns) keeps its cell but is not drawn (.is-empty).
// - A card its condition hides now ("Mostrar solo si", worked out on the server) keeps its cell too (.is-cond-off);
//   the admin's preview still shows it, so it can be edited.
import type { Announcement, CanvasPos, DisplayCanvas, DisplayCanvasItem, DisplayConfig, DisplayRotatorCard, GlassConfig } from '../../shared/types';
import { CANVAS_KINDS, fullLookMin, gridDims, posCells, sizeCells } from '../../../server/core/canvasCore.js';
import { glassVars, normalizeGlass } from '../../shared/glass';
import { parseColor, readableOn, rgbStr } from '../color';
import { ctx } from '../ctx';
import { photoStats, toneOf } from './photos';
import type { NEvent } from '../eventModel';
import { current, type Tick } from '../time';
import { isPreview } from '../identity';
import { itemCfg, posFor, sideTracks, sidebarSide, sourceFilter } from './canvas/config';

export { sidebarSide };
import { adapterFor } from './canvas/registry';
import type { AdapterEnv, CanvasAdapter, CanvasTopic, FamilyView, NavSource } from './canvas/types';
import type { HaSource } from '../haFeed';
import type { ValueSource } from '../valuesFeed';
import type { DataSource } from '../dataFeed';

export interface CanvasDeps {
  /** every normalised event of the screen */
  events(): NEvent[];
  /** lite mode, a low-power device or canvas.perf 'low' (no blur, no flip, no seconds hand; ?blur=1 lifts it) */
  low(): boolean;
  /** the box the slideshow is drawn in (the cards read the part of the photo right behind them) */
  photoArea(): HTMLElement | null;
  /** the boxes saved widgets (config.widgets) are drawn in, by canvas item id (widgets/custom.ts) */
  media(boxes: Map<string, { widgetId: string; box: HTMLElement }>): void;
  /** the family data and whether taps check routines off (the kids layouts' rules, main.ts) */
  family(): FamilyView;
  toggleChore(choreId: string, done: boolean): void;
  /** the newest announcement on screen, or null */
  announcement(): Announcement | null;
  /** Home Assistant states of this screen's aliases (haFeed.ts) */
  ha: HaSource;
  /** pushed values of this screen's keys (valuesFeed.ts) */
  values: ValueSource;
  /** numbers of this screen's data cards (dataFeed.ts) */
  data: DataSource;
  /** the navigation cards (main.ts, web/display/nav.ts) */
  nav: NavSource;
}

/** Canvas.layoutInfo(): boxes in CSS pixels of this page. */
export interface CanvasLayoutInfo {
  portrait: boolean;
  main: { x: number; y: number; w: number; h: number; gx: number; gy: number } | null;
  side: { x: number; y: number; w: number; h: number; gx: number; gy: number } | null;
  /** the sidebar runs across (top or bottom) */
  row: boolean;
  /** need: how many times wider and taller the content of a cramped card is than its box (the builder's Ajustar tamaño) */
  items: { id: string; zone: 'main' | 'side'; x: number; y: number; w: number; h: number; cramped: boolean; noBlur: boolean; empty: boolean; need?: { w: number; h: number } }[];
}

/**
 * At most this many cards blur what is behind them (the largest); the rest get a denser tint with no blur. Above the
 * 24 cards and the sidebar a screen can have, so on a normal device every glass card is real glass and neighbours
 * never look different; lite and low-power screens drop the blur for every card at once (the lite glass).
 */
export const BLUR_BUDGET = 26;

/** The glass vars a card may carry (written on the card, so its own material wins over the screen's). */
/**
 * Kinds whose renderers apply the item's "Tamaño del texto" themselves: the Casa, data and Navegación cards read --cv-scale, the
 * clocks, the date, the weather now, the value, the heading and the HTML card multiply their fitted type (--wk,
 * --size) by it. Every other card is drawn in rem by renderers it shares with the other layouts, so its body is
 * zoomed instead: its text, icons and gaps grow or shrink together inside the same box, and the card's own fitting
 * (the agenda's "+N more", the cramped mark) measures the zoomed content.
 */
const OWN_SCALE = /^(?:ha\.|clock\.|nav\.|date$|weather\.now$|value$|heading$|html$|market$|sports$|stocks$|currency$)/;

/** The text size of a card on its body: --cv-scale for the kinds that read it, a zoom for the others (none at 100 %). */
function applyScale(e: { kind: string; item: DisplayCanvasItem; body: HTMLElement }): void {
  const k = Number(e.item.style?.scale) || 1;
  e.body.style.setProperty('--cv-scale', String(k));
  e.body.style.zoom = k !== 1 && !OWN_SCALE.test(e.kind) ? String(k) : '';
}

/**
 * Cards drawn by shared renderers whose content is a few lines or a short list at a fixed size: in a box much larger
 * than that content (a box of its own, a tall or wide one) their body grows (fillBox), so they never sit as small
 * lines in a band of empty space. Cards that fill their box themselves (calendars, photos, the agenda) are not here.
 */
const FILL: Record<string, number> = {
  countdowns: 2, birthdays: 2, todo: 2, 'meals.today': 2, 'family.points': 2, 'family.rewards': 2, 'family.members': 2, highlights: 2,
  message: 2.5, announcement: 2.5, news: 2.5,
  // a forecast is a row of small days: it may grow the most
  'weather.hourly': 3, 'weather.forecast': 3,
  // (the games of Deportes grow and spread to their card themselves: widgets/canvas/data.ts)
  // the list of days of a narrow card (the grid of a wide one fills its box itself)
  'meals.week': 2,
  // today's routines in columns (a box past the named sizes)
  'family.chores': 2,
};
/** How much of its box a grown card's content may take. */
const FILL_AT = 0.84;
/**
 * Lists that, in a box past every named size of their kind and still well below its height once grown (a tall narrow
 * box holds no wider text), share out the height between their rows (.is-spread), and lay a row out over two lines in
 * a tall narrow box (.is-tall), styles-canvas-room.css.
 */
const SPREAD = new Set(['meals.week', 'countdowns', 'birthdays', 'todo', 'meals.today', 'family.points', 'family.rewards', 'family.members', 'family.chores', 'highlights', 'weather.forecast', 'weather.hourly', 'news', 'message', 'announcement']);

/**
 * How much more a card may grow than at its named sizes: 1 inside the largest of them, else with the square root of how
 * many times its box holds the largest one's area (at most twice), so a full-screen list is not a small block in the
 * middle while every saved card of a named size looks as before.
 */
export function roomFactor(kind: string, w: number, h: number, orientation: 'landscape' | 'portrait'): number {
  const sizes = (CANVAS_KINDS as Record<string, { sizes: string[] }>)[kind]?.sizes ?? [];
  let mw = 0, mh = 0, ma = 0;
  for (const s of sizes) {
    const [sw, sh] = sizeCells(s, orientation);
    mw = Math.max(mw, sw);
    mh = Math.max(mh, sh);
    ma = Math.max(ma, sw * sh);
  }
  if (!ma || (w <= mw && h <= mh)) return 1;
  return Math.min(2, Math.max(1.15, Math.sqrt((w * h) / ma)));
}

/**
 * A small box (smaller than its kind's full look in either direction, canvasCore fullLookMin): the card's compact
 * look. data-mini on the body, with data-mw / data-mh its width and height in cells, so each kind's CSS (and its
 * adapter) can draw a line, a strip or a small block. Never in the sidebar, never on a box a screen made on the
 * legacy 12×8 grid has: those look exactly as before.
 */
export function miniMark(body: HTMLElement, kind: string, cells: [number, number] | null, orientation: 'landscape' | 'portrait'): void {
  const r = cells && CANVAS_KINDS[kind as keyof typeof CANVAS_KINDS] ? fullLookMin(kind, orientation) : null;
  const mini = !!r && !!cells && (cells[0] < r[0] || cells[1] < r[1]);
  if (!mini) {
    delete body.dataset.mini;
    delete body.dataset.mw;
    delete body.dataset.mh;
    return;
  }
  body.dataset.mini = '';
  body.dataset.mw = String(cells![0]);
  body.dataset.mh = String(cells![1]);
}

/** The screen rect around the visible text, images and icons of a card body (not its wrappers), or null. */
function contentRect(body: HTMLElement): { top: number; bottom: number; left: number; right: number } | null {
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const n of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
    const leaf = n instanceof SVGElement ? n.tagName.toLowerCase() === 'svg' : n.tagName === 'IMG' || [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim());
    if (!leaf) continue;
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  return Number.isFinite(top) ? { top, bottom, left, right } : null;
}

/** The lines a body's content sits on (its distinct text tops): a list that wraps onto a new line has more. */
function lineCount(body: HTMLElement): number {
  const mids: number[] = [];
  let hMin = Infinity;
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
    if (el instanceof SVGElement || !el.getClientRects().length) continue;
    if (![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())) continue;
    for (const r of Array.from(el.getClientRects())) {
      if (!r.height) continue;
      mids.push(r.top + r.height / 2);
      hMin = Math.min(hMin, r.height);
    }
  }
  // texts whose middles are within half a (smallest) line of each other sit on one line
  mids.sort((a, b) => a - b);
  let n = 0;
  let last = -Infinity;
  for (const m of mids) {
    if (m - last > hMin / 2) n++;
    last = m;
  }
  return n;
}

/** The bits of text a body shows now (a card that leaves rows out shows fewer). */
function shownCount(body: HTMLElement): number {
  const box = body.getBoundingClientRect();
  let n = 0;
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
    if (el instanceof SVGElement || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    if (![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())) continue;
    // whole inside the card, and not cut by a box of its own (a row of days that leaves the last ones outside)
    const r = el.getBoundingClientRect();
    let inside = r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
    for (let p = el.parentElement; inside && p && p !== body; p = p.parentElement) {
      if (getComputedStyle(p).overflow === 'visible') continue;
      const q = p.getBoundingClientRect();
      inside = r.left >= q.left - 1 && r.right <= q.right + 1 && r.top >= q.top - 1 && r.bottom <= q.bottom + 1;
    }
    if (inside) n++;
  }
  return n;
}

/** Elements of a body whose text is cut now (an ellipsis, a clipped line, a line cut at the bottom). */
function cutCount(body: HTMLElement): number {
  let n = 0;
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
    if (el instanceof SVGElement || !el.clientWidth) continue;
    if ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())) n++;
  }
  return n;
}

const CARD_VARS = ['--g-rgb', '--g-solid', '--g-a', '--g-a-wx', '--g-filter', '--g-edge', '--accent', '--accent-rgb'];

interface Entry {
  id: string;
  kind: string;
  item: DisplayCanvasItem;
  el: HTMLElement;
  card: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  adapter: CanvasAdapter;
  zone: 'main' | 'side';
  cramped: boolean;
  /** a cramped card's content against its box (scroll size / client size), else null */
  need: { w: number; h: number } | null;
  /** drawn without blur to stay within BLUR_BUDGET */
  noBlur: boolean;
  /** what the last look() pass wrote, to skip cards that did not change */
  lookKey: string;
  /** the surface style() chose */
  surface: 'glass' | 'solid' | 'none';
  /** the item's settings, built again when the item or the screen changes */
  cfg: DisplayConfig;
  /** its body was grown to its box (fillBox) */
  filled?: boolean;
  /** a Rotativa: one entry per card, each in a slide of this card's body (they share its el, card and title) */
  subs?: Entry[];
  /** a Rotativa's card: the Rotativa */
  parent?: Entry;
}

export class Canvas {
  private entries = new Map<string, Entry>();
  private cv: DisplayCanvas | null = null;
  private screen: DisplayConfig | null = null;
  private portrait = false;
  private hint: HTMLElement | null = null;
  private ro: ResizeObserver | null = null;
  private raf = 0;
  /** the cards the next relayoutSoon() frame fits again (null: every card) */
  private dirty: Set<string> | null = new Set();
  private lookRaf = 0;
  private media = new Map<string, { widgetId: string; box: HTMLElement }>();
  private evCache: { src: NEvent[]; key: string; out: NEvent[] }[] = [];
  private paused = false;

  constructor(private main: HTMLElement, private side: HTMLElement, private deps: CanvasDeps) {
    // a body that changed size is fitted again (a window resize changes every body; a card the builder moved, one)
    if ('ResizeObserver' in window) this.ro = new ResizeObserver((list) => {
      for (const r of list) this.relayoutSoon((r.target as HTMLElement).parentElement?.parentElement?.dataset.canvasItem ?? null);
    });
    // a new photo: every card reads the part behind it again, in one frame
    window.addEventListener('marco:photo-tone', () => this.restyle());
    // a font that arrives late changes every width: each card is fitted again with the type it really shows, so the
    // result is the same as on a page that had the fonts from the start
    document.fonts?.addEventListener?.('loadingdone', () => this.relayoutSoon());
    // so does an image inside a card grown to its box (a member's photo): that card again (the other cards give their
    // images a fixed box; and a card that draws itself again on a layout would load its images again, round and round)
    const onImg = (ev: Event) => {
      if (!(ev.target instanceof HTMLImageElement)) return;
      const it = ev.target.closest<HTMLElement>('.cv-item');
      if (it?.dataset.canvasItem && FILL[it.dataset.kind ?? '']) this.relayoutSoon(it.dataset.canvasItem);
    };
    main.addEventListener('load', onImg, true);
    side.addEventListener('load', onImg, true);
  }

  /** The low-power look turned on or off: the adapters drop or bring back what they skip there, the cards restyle. */
  lowChanged(): void {
    if (!this.cv) return;
    for (const e of this.every()) if (!e.item.disabled) e.adapter.update();
    this.restyle();
  }

  /** Work the look of every card out again (a new photo, the device turned out to be slow). */
  restyle(): void {
    if (!this.cv) return;
    for (const e of this.entries.values()) e.lookKey = '';
    if (this.lookRaf) return;
    this.lookRaf = requestAnimationFrame(() => {
      this.lookRaf = 0;
      this.look();
    });
  }

  /** True while a canvas is on screen. */
  get active(): boolean {
    return !!this.cv;
  }

  /** Lay the canvas of `cfg` out (null canvas: everything goes). `portrait`: the screen's orientation now. */
  render(cfg: DisplayConfig, portrait: boolean): void {
    const cv = cfg.canvas ?? null;
    if (!cv) return this.destroy();
    const screenChanged = this.screen !== cfg;
    this.cv = cv;
    this.screen = cfg;
    this.portrait = portrait;
    this.main.hidden = false;
    const grid = gridDims(portrait ? 'portrait' : 'landscape');
    this.main.style.setProperty('--cv-cols', String(grid.cols));
    this.main.style.setProperty('--cv-rows', String(grid.rows));
    const side = sidebarSide(cv, portrait);
    this.side.hidden = side === 'none';
    this.side.classList.toggle('is-row', side === 'top' || side === 'bottom');

    const shown = cv.items.map((it) => ({ it, pos: posFor(it, portrait) })).filter((x): x is { it: DisplayCanvasItem; pos: CanvasPos } => !!x.pos && (x.pos.zone === 'main' || side !== 'none'));
    const tracks = sideTracks(shown.map((x) => ({ id: x.it.id, pos: x.pos })));
    const keep = new Set<string>();
    for (const { it, pos } of shown) {
      keep.add(it.id);
      let e = this.entries.get(it.id);
      if (e && e.kind !== it.kind) {
        this.drop(e);
        e = undefined;
      }
      if (!e) e = this.create(it);
      const changed = e.item.v !== it.v || !!e.item.disabled !== !!it.disabled;
      const rebuilt = !!e.item.disabled !== !!it.disabled;
      e.item = it;
      if (changed || screenChanged) e.cfg = itemCfg(cfg, it);
      this.place(e, pos, tracks.get(it.id));
      this.style(e);
      if (rebuilt) {
        this.dropSubs(e);
        e.adapter.destroy();
        e.body.textContent = '';
        e.body.className = 'cv-body';
        e.adapter = adapterFor(it);
        e.adapter.mount(e.body, this.env(e));
      } else if (changed) e.adapter.update();
      else if (screenChanged) e.adapter.data?.('config');
      if (e.kind === 'rotator') this.syncSubs(e, changed, screenChanged);
    }
    for (const e of [...this.entries.values()]) if (!keep.has(e.id)) this.drop(e);
    // DOM order = item order (focus order, and the admin's overlay reads the rects in this order)
    for (const x of shown) {
      const e = this.entries.get(x.it.id)!;
      const box = e.zone === 'side' ? this.side : this.main;
      if (e.el.parentElement !== box) box.appendChild(e.el);
    }
    this.emptyHint(cv.items.length === 0);
    this.deps.media(this.media);
    this.relayoutSoon();
  }

  /** Whether a card of `kind` is laid out now (placed in this orientation and not turned off). */
  shows(kind: string): boolean {
    if (!this.cv) return false;
    for (const e of this.every()) if (e.kind === kind && !e.item.disabled) return true;
    return false;
  }

  /** Every card and every card of a Rotativa (after it). */
  private *every(): Generator<Entry> {
    for (const e of this.entries.values()) {
      yield e;
      for (const s of e.subs ?? []) yield s;
    }
  }

  /** Every second: clocks with seconds work now, the rest on minute changes (a Rotativa turns after its cards). */
  tick(t: Tick): void {
    if (!this.cv || this.paused) return;
    for (const e of this.entries.values()) {
      for (const s of e.subs ?? []) s.adapter.tick?.(t);
      e.adapter.tick?.(t);
    }
    if (t.minuteChanged) this.flags();
  }

  /** New data of a topic reached the store. */
  onData(topic: CanvasTopic): void {
    if (!this.cv) return;
    if (topic === 'events') this.evCache = [];
    for (const e of this.every()) e.adapter.data?.(topic);
    this.flags();
    // a card grown to its box (FILL) was measured with what it showed then (a "loading" line, last minute's list):
    // with new content it is fitted again, so how it looks never depends on when the data came
    // (Home Assistant, pushed values and data cards draw none of them)
    if (topic !== 'ha' && topic !== 'values' && topic !== 'data' && topic !== 'photos' && topic !== 'nav') for (const e of this.every()) if (FILL[e.kind]) this.relayoutSoon(e.parent?.id ?? e.id);
  }

  /** Fit every card to its box again (resize, fonts, the sidebar changed size), or only the cards of `only`. */
  relayout(only: Set<string> | null = null): void {
    if (!this.cv) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    for (const e of this.entries.values()) {
      if (only && !only.has(e.id)) continue;
      this.fitOne(e, rem);
      // a Rotativa's cards: each in its slide, the box of the Rotativa (the hidden ones too, so each is ready to show)
      for (const s of e.subs ?? []) {
        s.zone = e.zone;
        this.fitOne(s, rem);
      }
    }
    this.flags();
    this.look();
  }

  /** Fit one card (or one card of a Rotativa) to its body. */
  private fitOne(e: Entry, rem: number): void {
    // before measuring: a zoomed body reports its box in its own (zoomed) pixels
    applyScale(e);
    const w = e.body.clientWidth;
    const h = e.body.clientHeight;
    if (!w || !h) return;
    const pos = posFor(e.item, this.portrait);
    // a box past every named size of its kind: cards may lay out for the extra room (data-room, styles-canvas-room.css)
    const o = this.portrait ? 'portrait' : 'landscape';
    const room = pos?.zone === 'main' ? roomFactor(e.kind, ...posCells(pos, o), o) : 1;
    if (room > 1) e.body.dataset.room = '';
    else delete e.body.dataset.room;
    miniMark(e.body, e.kind, pos?.zone === 'main' ? posCells(pos, o) : null, o);
    e.adapter.layout?.({ w, h, rem, size: pos?.zone === 'main' ? pos.size : 'side', zone: e.zone });
    // (a compact look is made for its small box: it is not zoomed up, so its rows never get shorter to grow)
    if (FILL[e.kind] && e.body.dataset.mini === undefined) this.fillBox(e, rem, pos?.zone === 'main' ? pos.size : 'side');
    else if (FILL[e.kind]) {
      e.filled = false;
      e.body.classList.remove('is-spread', 'is-tall');
    }
  }

  /**
   * A FILL card larger than its content: its body is zoomed up (up to its FILL, times the item's text size) while the
   * content takes less than FILL_AT of the box, stays inside it and cuts no more words than before; then the card is
   * laid out again at that zoom, and back at its own size when that does not fit after all.
   */
  private fillBox(e: Entry, rem: number, size: string): void {
    const b = e.body;
    const base = Number(e.item.style?.scale) || 1;
    e.filled = false;
    // the rows shared out or on two lines of the last pass: the card was just laid out with them, so it is laid out
    // again without them before anything is measured (else what fits is worked out for a shape it no longer has, and
    // the card goes back and forth between grown and cramped)
    const had = b.classList.contains('is-spread') || b.classList.contains('is-tall');
    b.classList.remove('is-spread', 'is-tall');
    if (had && b.clientWidth && b.clientHeight) e.adapter.layout?.({ w: b.clientWidth, h: b.clientHeight, rem, size, zone: e.zone });
    const box = b.getBoundingClientRect();
    if (!box.height || !box.width || (e.parent ? b : e.el).classList.contains('is-empty')) return;
    const pos = posFor(e.item, this.portrait);
    const [cw, ch] = pos?.zone === 'main' ? posCells(pos, this.portrait ? 'portrait' : 'landscape') : [0, 0];
    // (the week's meals as a list of days: a narrow box no named size of it has)
    const room = Math.max(cw ? roomFactor(e.kind, cw, ch, this.portrait ? 'portrait' : 'landscape') : 1, b.querySelector('.cvf-mlist') ? 1.5 : 1);
    // cards that grow only in a box past their named sizes (their named sizes look as before)
    if (room <= 1 && (e.kind === 'family.chores' || e.kind === 'meals.week')) {
      applyScale(e);
      return;
    }
    const cap = FILL[e.kind] * room;
    // a tall narrow box past the named sizes: rows on two lines (kept only when that fits at 100 %)
    if (room > 1 && SPREAD.has(e.kind) && box.height > box.width * 1.5) {
      b.classList.add('is-tall');
      e.adapter.layout?.({ w: b.clientWidth, h: b.clientHeight, rem, size, zone: e.zone });
      if (b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1) {
        b.classList.remove('is-tall');
        e.adapter.layout?.({ w: b.clientWidth, h: b.clientHeight, rem, size, zone: e.zone });
      }
    }
    const over = () => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1;
    // measured at a text size of 100 %, the owner's text size goes on top at the end
    b.style.zoom = '1';
    const none = () => {
      applyScale(e);
      return undefined;
    };
    if (over()) return none();
    // tiles that take the whole box and size their content to it (Premios, Comidas de hoy in a big box)
    if (b.classList.contains('is-tiles') || b.querySelector('.km-grid')) return none();
    // a title that already slides to be read whole: no room to grow
    if (Array.from(b.querySelectorAll<HTMLElement>('.mq')).some((m) => m.scrollWidth > m.clientWidth + 1)) return none();
    const cut0 = cutCount(b);
    const shown0 = shownCount(b);
    // free text may wrap onto more lines as it grows; a list or a row of people may not
    const wraps = e.kind === 'message' || e.kind === 'announcement';
    const lines0 = wraps ? 0 : lineCount(b);
    const fits = () => {
      const c = contentRect(b);
      return !!c && !over() && c.bottom - c.top <= box.height * FILL_AT && cutCount(b) <= cut0 && shownCount(b) >= shown0 && (wraps || lineCount(b) <= lines0);
    };
    if (!fits()) {
      none();
      this.spread(e, room, box.height);
      return;
    }
    // how much the card grows at a text size of 100 % (g), then the owner's text size on top of it, so 70 % stays
    // smaller and 150 % larger, as far as the box holds it
    let g = 1;
    {
      for (let i = 0; i < 24; i++) {
        const next = Math.min(cap, g * 1.08);
        if (next <= g + 0.001) break;
        b.style.zoom = String(next);
        if (!fits()) break;
        g = next;
      }
    }
    let k = base * g;
    if (k > g) {
      b.style.zoom = String(k);
      if (!fits()) k = Math.max(base, g);
    }
    if (k <= base * 1.04) {
      applyScale(e);
      this.spread(e, room, box.height);
      return;
    }
    const lay = (z: number) => {
      b.style.zoom = z === 1 ? '' : String(z);
      if (b.clientWidth && b.clientHeight) e.adapter.layout?.({ w: b.clientWidth, h: b.clientHeight, rem, size, zone: e.zone });
    };
    lay(k);
    // laid out again at that zoom the card may choose a narrower layout or leave a row out: then not
    const bad = () => over() || cutCount(b) > cut0 || shownCount(b) < shown0 || (!wraps && lineCount(b) > lines0);
    if (bad() && k > g && g > base * 1.04) {
      k = g;
      lay(k);
    }
    if (bad()) {
      applyScale(e);
      lay(base);
      this.spread(e, room, box.height);
      return;
    }
    e.filled = true;
    this.spread(e, room, box.height);
  }

  /** A SPREAD list past its named sizes whose content still takes little of its height: its rows share the height. */
  private spread(e: Entry, room: number, height: number): void {
    if (room <= 1 || !SPREAD.has(e.kind)) return;
    const c = contentRect(e.body);
    // a to-do list takes the height once it leaves a band of a tenth under its rows (a tall list grown as far as it
    // may, FILL_AT, still leaves one), the others once they leave a band of about a third
    if (!c || c.bottom - c.top > height * (e.kind === 'todo' ? 0.9 : 0.7)) return;
    e.body.classList.add('is-spread');
    // shared out, a row may not get cut or overflow: then not
    if (e.body.scrollHeight > e.body.clientHeight + 1 || e.body.scrollWidth > e.body.clientWidth + 1) e.body.classList.remove('is-spread');
  }

  /** Where each card is, and whether its content fits (the admin's builder overlay). */
  rects(): { id: string; rect: DOMRect; cramped: boolean }[] {
    return [...this.entries.values()].map((e) => ({ id: e.id, rect: e.el.getBoundingClientRect(), cramped: e.cramped }));
  }

  /**
   * The grids and every card on this page (the admin's builder overlay draws its cells and handles from it): the
   * content box of the main grid and of the sidebar (padding taken off), their gaps, and each card's box.
   */
  layoutInfo(): CanvasLayoutInfo | null {
    if (!this.cv) return null;
    const box = (el: HTMLElement) => {
      if (el.hidden || !el.isConnected) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      const cs = getComputedStyle(el);
      const n = (v: string) => parseFloat(v) || 0;
      return {
        x: r.left + n(cs.paddingLeft), y: r.top + n(cs.paddingTop),
        w: r.width - n(cs.paddingLeft) - n(cs.paddingRight), h: r.height - n(cs.paddingTop) - n(cs.paddingBottom),
        gx: n(cs.columnGap), gy: n(cs.rowGap),
      };
    };
    const rnd = (r: DOMRect) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    return {
      portrait: this.portrait,
      main: box(this.main),
      side: box(this.side),
      row: this.side.classList.contains('is-row'),
      items: [...this.entries.values()].filter((e) => !e.el.hidden).map((e) => ({ id: e.id, zone: e.zone, ...rnd(e.el.getBoundingClientRect()), cramped: e.cramped, noBlur: e.noBlur, empty: e.el.classList.contains('is-empty'), ...(e.need ? { need: e.need } : {}) })),
    };
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    if (this.cv) for (const e of this.entries.values()) e.adapter.tick?.({ ...current(), minuteChanged: true });
  }

  /** Remove every card (another layout, a carousel switch, privacy): timers stop, boxes go. */
  destroy(): void {
    for (const e of [...this.entries.values()]) this.drop(e);
    this.hint?.remove();
    this.hint = null;
    this.cv = null;
    this.screen = null;
    this.main.hidden = true;
    this.side.hidden = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.dirty = new Set();
    if (this.lookRaf) cancelAnimationFrame(this.lookRaf);
    this.lookRaf = 0;
    this.media.clear();
    this.deps.media(this.media);
  }

  // ------------------------------------------------------------------------------------------------ internals

  private create(it: DisplayCanvasItem): Entry {
    const el = document.createElement('div');
    el.className = 'cv-item';
    el.dataset.widget = it.id;
    el.dataset.canvasItem = it.id;
    el.dataset.kind = it.kind;
    const card = document.createElement('div');
    card.className = 'cv-card';
    const title = document.createElement('div');
    title.className = 'cv-title';
    title.hidden = true;
    const body = document.createElement('div');
    body.className = 'cv-body';
    card.append(title, body);
    el.appendChild(card);
    const e: Entry = { id: it.id, kind: it.kind, item: it, el, card, title, body, adapter: adapterFor(it), zone: 'main', cramped: false, need: null, noBlur: false, lookKey: '', surface: 'glass', cfg: itemCfg(this.screen!, it) };
    this.entries.set(it.id, e);
    e.adapter.mount(body, this.env(e));
    this.ro?.observe(body);
    return e;
  }

  private env(e: Entry): AdapterEnv {
    return {
      cfg: () => e.cfg,
      item: () => e.item,
      events: () => this.eventsFor(e.item),
      now: () => current(),
      low: () => this.deps.low(),
      // one box per widget item, so two items showing the same saved widget each get their own copy
      mediaBox: (id, box) => {
        if (id && box) this.media.set(e.id, { widgetId: id, box });
        else this.media.delete(e.id);
      },
      family: () => this.deps.family(),
      toggleChore: (id, done) => this.deps.toggleChore(id, done),
      announcement: () => this.deps.announcement(),
      ha: this.deps.ha,
      values: this.deps.values,
      data: this.deps.data,
      nav: this.deps.nav,
    };
  }

  /** The screen's events, only those of the item's calendars (memoised per set of calendars). */
  private eventsFor(item: DisplayCanvasItem): NEvent[] {
    const all = this.deps.events();
    const keep = sourceFilter(item);
    if (!keep) return all;
    const key = JSON.stringify((item.props as { sourceIds?: unknown }).sourceIds);
    const hit = this.evCache.find((c) => c.src === all && c.key === key);
    if (hit) return hit.out;
    const out = all.filter((ev) => keep(ev.ev.sourceId));
    this.evCache.push({ src: all, key, out });
    if (this.evCache.length > 24) this.evCache.shift();
    return out;
  }

  private place(e: Entry, pos: CanvasPos, track: { start: number; span: number } | undefined): void {
    const s = e.el.style;
    if (pos.zone === 'main') {
      e.zone = 'main';
      const [w, h] = posCells(pos, this.portrait ? 'portrait' : 'landscape');
      s.gridColumn = `${pos.x + 1} / span ${w}`;
      s.gridRow = `${pos.y + 1} / span ${h}`;
      // the named size it is drawn like, and its cells (a box of its own is any w×h within the kind's range)
      e.el.dataset.size = pos.size;
      e.el.dataset.cells = `${w}x${h}`;
      e.el.hidden = false;
      return;
    }
    e.zone = 'side';
    e.el.dataset.size = 'side';
    delete e.el.dataset.cells;
    const t = track ?? { start: 0, span: 2 };
    e.el.hidden = t.span <= 0;
    const row = this.side.classList.contains('is-row');
    s.gridColumn = row ? `${t.start + 1} / span ${Math.max(1, t.span)}` : '1';
    s.gridRow = row ? '1' : `${t.start + 1} / span ${Math.max(1, t.span)}`;
  }

  /** Surface, corner radius and title of a card (its glass, tint and accent: look()). */
  private style(e: Entry): void {
    const cv = this.cv!;
    const st = e.item.style;
    // inside a glass or solid sidebar the bar itself is the card
    const inherit = e.zone === 'side' && cv.sidebar.fill !== 'photo' ? 'none' : cv.defaults.surface;
    let surface = st?.surface && st.surface !== 'inherit' ? st.surface : inherit;
    if (e.kind === 'spacer') surface = 'none';
    const radius = st?.radius && st.radius !== 'inherit' ? st.radius : cv.defaults.radius;
    e.surface = surface;
    const keep = ['is-ink-dark', 'is-thin', 'no-edge', 'no-blur', 'has-own', 'has-color'].filter((k) => e.card.classList.contains(k));
    e.card.className = [`cv-card is-${surface} r-${radius}`, ...keep].join(' ');
    e.lookKey = '';
    applyScale(e);
    e.el.classList.toggle('is-disabled', !!e.item.disabled);
    const showTitle = !!st?.showTitle && !!(st.title || st.icon);
    e.title.hidden = !showTitle;
    if (showTitle) e.title.textContent = [st.icon, st.title].filter(Boolean).join(' ');
  }

  /**
   * The material of every card: its own glass (or the screen's), sampled from the part of the photo right behind it,
   * a custom tint, the accent, and the blur budget (the largest BLUR_BUDGET cards blur, the others get the denser
   * no-blur tint). Classes on the card: .is-ink-dark (dark text), .is-thin, .no-edge, .no-blur, .has-own (its own glass
   * or colour: the light theme's card colours do not apply), .has-color.
   */
  private look(): void {
    const cfg = this.screen;
    const cv = this.cv;
    if (!cfg || !cv) return;
    const low = this.deps.low();
    const bg = cfg.background;
    const photoOn = !!bg.enabled && !document.getElementById('app')?.classList.contains('no-photo');
    const screenPhoto = photoOn && bg.scope === 'screen';
    const sidePhoto = photoOn && (screenPhoto || cv.sidebar.fill === 'photo');
    // the photo right behind a card (its tone tints the glass) ...
    const photoBehind = (e: Entry) => (e.zone === 'side' ? sidePhoto : screenPhoto);
    // ... or the animated backdrop (canvas.background 'ambient'): something moves behind it, so its glass is real glass
    // (translucent, blurred within the budget), only without a photo tone to follow
    const ambientOn = cv.background === 'ambient' && bg.ambient !== 'none';
    const behind = (e: Entry) => photoBehind(e) || ambientOn;
    const base = normalizeGlass(cfg.screen.glass);
    const glassOf = (e: Entry) => {
      const own = e.item.style?.glass;
      if (!own) return { g: base, auto: false };
      const auto = own.tint === 'auto';
      return { g: normalizeGlass({ ...own, tint: auto ? 'dark' : own.tint } as GlassConfig), auto };
    };
    const shown = [...this.entries.values()].filter((e) => !e.el.hidden && !e.el.classList.contains('is-empty') && !e.el.classList.contains('is-cond-off'));
    const rects = new Map(shown.map((e) => [e.id, e.el.getBoundingClientRect()]));
    // the blur budget: the glass sidebar is one more blurred sheet
    let budget = BLUR_BUDGET - (cv.sidebar.side !== 'none' && cv.sidebar.fill === 'glass' && (sidePhoto || ambientOn) && !this.side.hidden ? 1 : 0);
    const blurs = new Set<string>();
    if (!low) {
      const want = shown.filter((e) => e.surface === 'glass' && behind(e) && glassOf(e).g.blur > 0);
      const area = (e: Entry) => {
        const r = rects.get(e.id)!;
        return r.width * r.height;
      };
      want.sort((a, b) => area(b) - area(a));
      for (const e of want) if (budget-- > 0) blurs.add(e.id);
    }
    const frame = this.deps.photoArea();
    const fr = frame && frame.isConnected ? frame.getBoundingClientRect() : null;
    for (const e of this.entries.values()) {
      const st = e.item.style;
      const { g, auto } = glassOf(e);
      const hasPhoto = behind(e);
      const photo = photoBehind(e);
      const r = rects.get(e.id);
      const region = photo && r && fr && fr.width > 1 && fr.height > 1
        ? toneOf((r.left - fr.left) / fr.width, (r.top - fr.top) / fr.height, (r.right - fr.left) / fr.width, (r.bottom - fr.top) / fr.height, fr.width / fr.height)
        : null;
      const noBlur = !low && e.surface === 'glass' && hasPhoto && g.blur > 0 && !blurs.has(e.id) && shown.includes(e);
      const tint: GlassConfig['tint'] = auto ? (region ? (region.lum > 0.55 ? 'light' : 'dark') : cfg.screen.theme === 'light' ? 'light' : 'dark') : g.tint;
      const color = st?.color ?? null;
      const accent = st?.accent ?? null;
      const key = [e.surface, JSON.stringify(g), tint, color, accent, hasPhoto, low, noBlur, region ? `${region.tone.toFixed(2)}|${region.rgb}` : photo && photoStats ? `${photoStats.tone}|${photoStats.rgb}` : '-'].join('|');
      if (key === e.lookKey) continue;
      e.lookKey = key;
      e.noBlur = noBlur;
      const out = glassVars({ ...g, tint }, photo ? (region ?? photoStats) : null, { lite: low || noBlur, hasPhoto });
      const vars: Record<string, string> = { ...out.vars };
      // a solid card is the solid tint: light (dark text) only with a light tint
      let inkDark = e.surface === 'solid' ? tint === 'light' : out.inkDark;
      if (color) {
        const rgb = parseColor(color);
        vars['--g-rgb'] = rgbStr(rgb);
        vars['--g-solid'] = rgbStr(rgb);
        inkDark = readableOn(rgb) !== '#ffffff';
        // a light colour needs some body before dark text on it reads well
        if (inkDark && e.surface === 'glass' && hasPhoto) vars['--g-a'] = String(Math.max(0.5, Number(vars['--g-a'])));
      }
      if (accent) {
        vars['--accent'] = accent;
        vars['--accent-rgb'] = parseColor(accent).join(' ');
      }
      const own = !!st?.glass || !!color;
      const cs = e.card.style;
      for (const k of CARD_VARS) if (!(k in vars)) cs.removeProperty(k);
      for (const [k, v] of Object.entries(vars)) if (CARD_VARS.includes(k)) cs.setProperty(k, v);
      const c = e.card.classList;
      // the screen's own glass in the light theme keeps the theme's light cards; a card's own material wins over them
      c.toggle('is-ink-dark', own || cfg.screen.theme !== 'light' ? inkDark : false);
      c.toggle('is-thin', out.thin && !color);
      c.toggle('no-edge', !out.edge);
      c.toggle('no-blur', noBlur);
      c.toggle('has-own', own);
      c.toggle('has-color', !!color);
    }
  }

  /**
   * The cards of a Rotativa, kept in step with its props: one slide (a card body of its own, in the Rotativa's body)
   * and one adapter per card, reconciled by id and kind like the items; a card whose hash or Rotativa changed is
   * drawn again in place. The Rotativa's adapter (widgets/canvas/rotator.ts) shows one slide at a time.
   */
  private syncSubs(e: Entry, changed: boolean, screenChanged: boolean): void {
    const cards = e.item.disabled ? [] : ((e.item.props as { cards?: DisplayRotatorCard[] }).cards ?? []);
    const old = new Map((e.subs ?? []).map((s) => [s.id, s]));
    const next: Entry[] = [];
    for (const cd of cards) {
      const item: DisplayCanvasItem = { id: cd.id, kind: cd.kind, props: cd.props, v: `${cd.v}|${e.item.v}`, pos: e.item.pos, portrait: e.item.portrait, style: e.item.style, interactive: false, ...(cd.disabled ? { disabled: cd.disabled } : {}) };
      let s = old.get(cd.id);
      if (s && (s.kind !== cd.kind || !!s.item.disabled !== !!cd.disabled)) {
        this.dropSub(s);
        s = undefined;
      }
      old.delete(cd.id);
      if (!s) {
        const body = document.createElement('div');
        body.className = 'cv-body cv-rot-slide';
        body.dataset.card = cd.id;
        s = { id: cd.id, kind: cd.kind, item, el: e.el, card: e.card, title: e.title, body, adapter: adapterFor(item), zone: e.zone, cramped: false, need: null, noBlur: false, lookKey: '', surface: e.surface, cfg: itemCfg(this.screen!, item), parent: e };
        s.adapter.mount(body, this.env(s));
      } else {
        const ch = s.item.v !== item.v;
        s.item = item;
        if (ch || screenChanged) s.cfg = itemCfg(this.screen!, item);
        if (ch) s.adapter.update();
        else if (screenChanged) s.adapter.data?.('config');
      }
      next.push(s);
    }
    for (const s of old.values()) this.dropSub(s);
    e.subs = next;
    // the slides in the order of the cards, before what the Rotativa draws itself (its dots)
    let at: ChildNode | null = e.body.firstChild;
    for (const s of next) {
      if (at !== s.body) e.body.insertBefore(s.body, at);
      at = s.body.nextSibling;
    }
    e.adapter.slides?.();
    if (changed) this.relayoutSoon(e.id);
  }

  private dropSub(s: Entry): void {
    try {
      s.adapter.destroy();
    } catch (err) {
      console.warn('[canvas] destroy', err);
    }
    s.body.remove();
    this.media.delete(s.id);
  }

  private dropSubs(e: Entry): void {
    for (const s of e.subs ?? []) this.dropSub(s);
    e.subs = [];
  }

  private drop(e: Entry): void {
    this.dropSubs(e);
    this.ro?.unobserve(e.body);
    try {
      e.adapter.destroy();
    } catch (err) {
      console.warn('[canvas] destroy', err);
    }
    e.el.remove();
    this.entries.delete(e.id);
  }

  /** Empty canvas on the TV: one centred card says where to edit it. */
  private emptyHint(on: boolean): void {
    if (!on) {
      this.hint?.remove();
      this.hint = null;
      return;
    }
    if (this.hint) return;
    const h = document.createElement('div');
    h.className = 'cv-hint cv-card is-glass r-l';
    h.textContent = ctx.t('cvEmpty');
    this.main.appendChild(h);
    this.hint = h;
  }

  /** Fit a card (by id), or every card (no id), in the next frame; several asks in one frame are one pass. */
  private relayoutSoon(id: string | null = null): void {
    if (id === null) this.dirty = null;
    else this.dirty?.add(id);
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const only = this.dirty;
      this.dirty = new Set();
      this.relayout(only);
    });
  }

  /** A condition hides the item now (the feed of its source says so; never in the admin's preview). */
  private condOff(it: DisplayCanvasItem): boolean {
    if (isPreview || !it.when) return false;
    return it.when.src === 'ha' ? this.deps.ha.hidden(it.id) : it.when.src === 'value' ? this.deps.values.hidden(it.id) : false;
  }

  /** Empty, hidden-by-condition and cramped marks of every card. */
  private flags(): void {
    let blurChanged = false;
    for (const e of this.entries.values()) {
      e.el.classList.toggle('is-empty', !!e.adapter.empty?.());
      const off = this.condOff(e.item);
      if (off !== e.el.classList.contains('is-cond-off')) {
        e.el.classList.toggle('is-cond-off', off);
        blurChanged = true;
      }
      const over = (b: HTMLElement) => !!b.clientHeight && (b.scrollHeight > b.clientHeight + 2 || b.scrollWidth > b.clientWidth + 2);
      const needOf = (b: HTMLElement) => ({ w: Math.round((b.scrollWidth / Math.max(1, b.clientWidth)) * 100) / 100, h: Math.round((b.scrollHeight / Math.max(1, b.clientHeight)) * 100) / 100 });
      let cramped = over(e.body);
      e.need = cramped ? needOf(e.body) : null;
      // a Rotativa: empty when every card is, cramped when one of its cards is (the most it needs)
      if (e.subs?.length) {
        let all = true;
        for (const s of e.subs) {
          const em = !!s.adapter.empty?.();
          s.body.classList.toggle('is-empty', em);
          if (!em) all = false;
          s.cramped = !em && over(s.body);
          s.need = s.cramped ? needOf(s.body) : null;
          if (s.cramped) {
            cramped = true;
            e.need = { w: Math.max(e.need?.w ?? 1, s.need!.w), h: Math.max(e.need?.h ?? 1, s.need!.h) };
          }
          if (s.cramped && s.filled) {
            s.filled = false;
            this.relayoutSoon(e.id);
          }
        }
        e.el.classList.toggle('is-empty', all);
        e.adapter.slides?.();
      }
      e.cramped = cramped;
      e.el.classList.toggle('is-cramped', cramped);
      // a grown card whose content grew since (new data): laid out again from its own size
      if (cramped && e.filled) {
        e.filled = false;
        this.relayoutSoon(e.id);
      }
    }
    // a card that comes or goes changes who gets the blur
    if (blurChanged) this.restyle();
  }
}
