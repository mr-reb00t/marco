// Widgets the owner adds (config.widgets, placed per screen): an image or a web page in a corner, in the side column
// or filling the screen (the 'widget' layout). The server says what to show (DisplayConfig.widgets, server/screens.js
// displayWidgets); this module loads and reloads it.
//
// - Reconciled by `id|place|v`: an unchanged widget keeps its element, so config polls and preview edits never reload
//   or flicker it; size and corner changes only move or restyle it.
// - Images: the next one loads off screen and replaces the old one only once it has loaded. A failed reload keeps the
//   old image with a small "not updated" mark. A widget that never loaded takes no space (corner, side).
// - Web pages (self-hosted only): a sandboxed iframe without top navigation, popups or forms. A page from this
//   display's own origin is never framed (scripts + same origin could lift the sandbox and reach the display).
// - Electricity prices ('prices'): a card this display draws itself (widgets/prices.ts) from this server's prices.
// - Exchange rates ('currency'): the same, the Divisas card (widgets/currency.ts) from this server's rates.
// - Two corners on the same side (top and bottom) share its height: each stack gets half (.uw-half), never overlapping.
//   Inside one corner the widgets share the stack's height, so none is cut by it.
// - Nothing while private; night dimming, alerts and the doorbell sit above (z-order in styles.css).
import type { DisplayConfig, DisplayWidget, FrameCorner } from '../../shared/types';
import { ctx } from '../ctx';
import { authHeaders, isPreview, withScreen } from '../identity';
import { PriceCard, priceFloorHeight } from './prices';
import { CurrencyCard, currencyFloorHeight } from './currency';

/** Corner boxes: max width (vw) and height (vh) per size. */
const CORNER_BOX: Record<string, [number, number]> = { s: [18, 22], m: [26, 32], l: [36, 45] };
/** Side cards: max height (vh) per size; the width is the side column's. */
const SIDE_H: Record<string, number> = { s: 20, m: 30, l: 45 };
const CORNERS: FrameCorner[] = ['tl', 'tr', 'bl', 'br'];
const IMAGE_TIMEOUT = 20_000;
const FRAME_TIMEOUT = 15_000;

interface Entry {
  key: string;
  w: DisplayWidget;
  el: HTMLElement;
  /** what is on screen now (null until the first load) */
  media: HTMLImageElement | HTMLIFrameElement | HTMLElement | null;
  /** 'prices' and 'currency' widgets: the card that draws them */
  card: PriceCard | CurrencyCard | null;
  /** natural size of the image on screen */
  nat: [number, number] | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** bumped on every new load and on removal, so late answers of an older one are ignored */
  gen: number;
  blobUrl: string | null;
  abort: AbortController | null;
  /** waiting for the page to be visible again before the next load */
  waiting: boolean;
  dead: boolean;
}

/** `url` with `k=v` added (or replaced) in its query string. */
export function addParam(url: string, k: string, v: string): string {
  try {
    const u = new URL(url, location.href);
    u.searchParams.set(k, v);
    return u.href;
  } catch {
    return url;
  }
}

/** True when `url` (absolute, or a path of this server) is an http(s) address: never javascript:, data:, blob:... */
export function webUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false;
  try {
    const p = new URL(url, location.href).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

/** True when `url` is on this display's own origin (never framed: see the header). */
export function sameOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return true;
  }
}

/** Order of widgets inside one container: what render() wants where. */
interface Want {
  w: DisplayWidget;
  box: HTMLElement;
  /** Personalizado: the canvas item it is drawn for (one copy per item) */
  slot?: string;
}

/** Entry key of a wanted widget: the widget, its place and version, and the canvas item when it has one. */
const wantKey = (x: Want) => `${x.w.id}|${x.w.place}|${x.w.v}${x.slot ? `|${x.slot}` : ''}`;

export class CustomWidgets {
  private entries = new Map<string, Entry>();
  private side: HTMLElement;
  private full: HTMLElement;
  private corners: Record<FrameCorner, HTMLElement>;
  private fullPh: HTMLElement;
  private cfg: DisplayConfig | null = null;
  private preset = '';
  /** blobs the admin preview posted for unsaved widgets (proxy mode only): id → { v, url } */
  private previewBlobs = new Map<string, { v: string; url: string }>();
  /** called when a widget in the side column appears or changes size (the side content is fitted again) */
  onSideChange: (() => void) | null = null;
  /** Personalizado screens: the card each 'widget' item draws its widget in, by canvas item id (widgets/canvas.ts) */
  private canvasBoxes = new Map<string, { widgetId: string; box: HTMLElement }>();

  /** The boxes of the Personalizado layout's widget items (the next render() fills them). */
  setCanvasBoxes(boxes: Map<string, { widgetId: string; box: HTMLElement }>): void {
    this.canvasBoxes = new Map(boxes);
  }

  private isCanvasBox(box: Element | null): boolean {
    return !!box && box.classList.contains('cv-media');
  }

  constructor(root: ParentNode = document) {
    this.side = root.querySelector('#uw-side') as HTMLElement;
    this.full = root.querySelector('#uw-full') as HTMLElement;
    const wrap = root.querySelector('#uw-corners') as HTMLElement;
    this.corners = Object.fromEntries(CORNERS.map((c) => [c, wrap.querySelector(`.uw-c.${c}`) as HTMLElement])) as Record<FrameCorner, HTMLElement>;
    this.fullPh = document.createElement('div');
    this.fullPh.className = 'uw-ph';
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      for (const e of this.entries.values()) if (e.waiting) this.load(e);
    });
    if (isPreview) {
      window.addEventListener('message', (ev) => {
        // the admin tested a widget ("Probar"): it loads again now (prices: asked again)
        if (ev.source === window.parent && ev.data?.type === 'marco:preview-reload' && typeof ev.data.id === 'string') {
          for (const e of this.entries.values()) {
            if (e.w.id !== ev.data.id) continue;
            e.card?.stop();
            this.load(e);
          }
          return;
        }
        if (ev.source !== window.parent || ev.data?.type !== 'marco:preview-widget') return;
        const { id, v, blob } = ev.data as { id?: unknown; v?: unknown; blob?: unknown };
        if (typeof id !== 'string' || typeof v !== 'string' || !(blob instanceof Blob) || !blob.type.startsWith('image/')) return;
        const old = this.previewBlobs.get(id);
        if (old) URL.revokeObjectURL(old.url);
        this.previewBlobs.set(id, { v, url: URL.createObjectURL(blob) });
        for (const e of this.entries.values()) if (e.w.id === id && e.w.v === v) this.load(e);
      });
    }
  }

  /** The widgets of `cfg` on screen, for the layout `preset` (the display's effective one). */
  render(cfg: DisplayConfig, preset: string): void {
    this.cfg = cfg;
    this.preset = preset;
    const priv = !!cfg.privacy?.active;
    const list = priv ? [] : (Array.isArray(cfg.widgets) ? cfg.widgets : []).filter((w) => this.usable(w));
    const sideOn = this.sideVisible();
    const wants: Want[] = [];
    for (const w of list) {
      // Personalizado: its widget items, each in its card; the corner and side placements are not part of it
      if (preset === 'canvas' || w.place === 'canvas') {
        if (w.place !== 'canvas' || preset !== 'canvas') continue;
        for (const [slot, c] of this.canvasBoxes) {
          if (c.widgetId === w.id && !wants.some((x) => x.box === c.box)) wants.push({ w, box: c.box, slot });
        }
        continue;
      }
      if (w.place === 'full') {
        if (preset === 'widget' && !wants.some((x) => x.box === this.full)) wants.push({ w, box: this.full });
        continue;
      }
      const corner = CORNERS.includes(w.corner) ? w.corner : 'br';
      wants.push({ w, box: w.place === 'side' && sideOn ? this.side : this.corners[corner] });
    }
    const keep = new Set<string>();
    for (const want of wants) {
      const { w, box } = want;
      const key = wantKey(want);
      keep.add(key);
      let e = this.entries.get(key);
      if (!e) {
        e = this.create(key, w);
        this.entries.set(key, e);
        e.w = w;
        this.place(e, box);
        this.load(e);
      } else {
        e.w = w;
        this.place(e, box);
        e.card?.update(w);
      }
      e.el.dataset.size = w.size;
      e.el.classList.toggle('uw-cover', w.fit === 'cover');
    }
    for (const [key, e] of this.entries) if (!keep.has(key)) this.destroy(key, e);
    // order inside each container = the order the server sent
    for (const box of [this.side, this.full, ...Object.values(this.corners), ...[...this.canvasBoxes.values()].map((c) => c.box)]) {
      const order = wants.filter((x) => x.box === box).map((x) => this.entries.get(wantKey(x))!.el);
      order.forEach((el, i) => {
        if (box.children[i] !== el) box.insertBefore(el, box.children[i] ?? null);
      });
    }
    // the 'widget' layout with no widget (none chosen, or private): a short note instead of an empty screen
    const fullEntry = wants.find((x) => x.box === this.full);
    if (preset === 'widget' && !fullEntry && !priv) this.showFullPlaceholder(ctx.t('widgetNone'));
    else if (!fullEntry) this.fullPh.remove();
    this.relayout();
  }

  /** Remove every widget (stops their timers). */
  stop(): void {
    for (const [key, e] of this.entries) this.destroy(key, e);
    this.fullPh.remove();
  }

  /** Sizes and places again (after a layout change, a resize, the photo frame card moving). */
  relayout(): void {
    if (!this.cfg) return;
    // a side widget goes to its corner when the layout shows no side column (and back)
    const sideOn = this.sideVisible();
    let moved = false;
    for (const e of this.entries.values()) {
      if (e.w.place !== 'side') continue;
      const want = sideOn ? this.side : this.corners[e.w.corner] ?? this.corners.br;
      if (e.el.parentElement !== want) {
        want.appendChild(e.el);
        moved = true;
      }
    }
    this.avoidPhotoFrame();
    this.halves(false);
    for (const e of this.entries.values()) this.size(e);
    this.fitSideBox();
    if (moved) this.onSideChange?.();
  }

  /**
   * The side column gives widgets the room its other content leaves (#uw-side shrinks, styles.css): when their cards
   * are taller than that, all of them are scaled down together instead of being cut.
   */
  private fitSideBox(): void {
    const items = [...this.entries.values()].filter((e) => e.el.parentElement === this.side && e.media && !e.el.classList.contains('uw-wait'));
    // price cards keep the room for their smallest readable size: the column drops its secondary content first
    // (main.ts fitSideContent), as it does for its own cards
    // (an exchange rates card: its one-line look, widgets/currency.ts)
    const cards = items.filter((e) => e.card);
    const gap = parseFloat(getComputedStyle(this.side).rowGap) || 0;
    const floor = cards.length ? cards.reduce((n, e) => n + (e.card instanceof CurrencyCard ? currencyFloorHeight() : priceFloorHeight()), 0) + gap * (cards.length - 1) : 0;
    this.side.style.minHeight = floor ? `${Math.ceil(floor)}px` : '';
    if (!items.length) return;
    const avail = this.side.clientHeight;
    const need = this.side.scrollHeight;
    if (!avail || need <= avail + 1) return;
    const gaps = need - items.reduce((n, e) => n + (e.media?.offsetHeight ?? 0), 0);
    const k = Math.max(0, (avail - gaps) / Math.max(1, need - gaps));
    for (const e of items) {
      const m = e.media!;
      if (e.card) {
        e.card.layout(m.offsetWidth, Math.floor(m.offsetHeight * k), 'side');
        continue;
      }
      m.style.width = `${Math.max(1, Math.floor(m.offsetWidth * k))}px`;
      m.style.height = `${Math.max(1, Math.floor(m.offsetHeight * k))}px`;
    }
  }

  private usable(w: DisplayWidget): boolean {
    // only http(s): a javascript: or data: address in an iframe or the unsaved preview would run on this origin
    if (w?.type === 'prices') return typeof w.id === 'string' && typeof w.prices?.zone === 'string' && !!w.prices.zone;
    if (w?.type === 'currency') return typeof w.id === 'string' && Array.isArray(w.currency?.pairs) && w.currency.pairs.length > 0;
    if (!w || typeof w.id !== 'string' || !webUrl(w.src)) return false;
    // web pages are framed directly only; a proxied server never sends them, but never frame its routes either
    if (w.type === 'web') return w.via === 'direct';
    return w.type === 'image';
  }

  private sideVisible(): boolean {
    const mid = this.side.parentElement;
    if (!mid) return false;
    const side = mid.closest('.side') as HTMLElement | null;
    if (!side || side.offsetWidth === 0 || getComputedStyle(side).display === 'none') return false;
    return mid.offsetWidth > 0 && mid.getClientRects().length > 0;
  }

  private create(key: string, w: DisplayWidget): Entry {
    const el = document.createElement('div');
    el.className = `uw uw-${w.type} uw-wait`;
    el.dataset.widget = w.id;
    const pill = document.createElement('span');
    pill.className = 'uw-pill';
    el.appendChild(pill);
    const e: Entry = { key, w, el, media: null, card: null, nat: null, timer: null, gen: 0, blobUrl: null, abort: null, waiting: false, dead: false };
    if (w.type === 'prices' || w.type === 'currency') {
      const card = w.type === 'prices' ? new PriceCard(w) : new CurrencyCard(w);
      e.card = card;
      card.onState = (st) => {
        if (e.dead) return;
        if (st === 'failed') {
          // the loading card goes: nothing to show
          if (e.media && !card.hasData) {
            e.media.remove();
            e.media = null;
          }
          return this.failed(e);
        }
        if (!e.media) this.swap(e, card.el, null);
        this.setStale(e, st === 'stale');
      };
    }
    return e;
  }

  private place(e: Entry, box: HTMLElement): void {
    if (e.el.parentElement !== box) box.appendChild(e.el);
    e.el.classList.toggle('uw-in-side', box === this.side);
    e.el.classList.toggle('uw-in-full', box === this.full);
    e.el.classList.toggle('uw-in-canvas', this.isCanvasBox(box));
    if (box === this.full) this.fullPh.remove();
  }

  private destroy(key: string, e: Entry): void {
    e.dead = true;
    e.gen++;
    if (e.timer) clearTimeout(e.timer);
    e.abort?.abort();
    e.card?.stop();
    if (e.blobUrl) URL.revokeObjectURL(e.blobUrl);
    const wasSide = e.el.parentElement === this.side;
    e.el.remove();
    this.entries.delete(key);
    if (wasSide) this.onSideChange?.();
  }

  // ------------------------------------------------------------------------------------------- loading

  private schedule(e: Entry): void {
    if (e.dead) return;
    if (e.timer) clearTimeout(e.timer);
    const sec = e.w.refreshSec;
    if (!(sec > 0)) return; // web page that is never reloaded
    const jitter = sec >= 60 ? 1 + (Math.random() * 0.2 - 0.1) : 1;
    e.timer = setTimeout(() => {
      e.timer = null;
      if (document.hidden) {
        e.waiting = true;
        return;
      }
      this.load(e);
    }, sec * 1000 * jitter);
  }

  private load(e: Entry): void {
    if (e.dead) return;
    e.waiting = false;
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    if (e.card) return e.card.start();
    if (e.w.type === 'web') return this.loadFrame(e);
    if (e.w.via === 'proxy') return void this.loadProxy(e);
    this.loadImage(e, e.w.bust ? addParam(e.w.src, '_marco', String(Math.floor(Date.now() / 1000))) : e.w.src, null);
  }

  /** Load `src` off screen; on success it replaces what is shown. `blobUrl` is revoked if it is not used. */
  private loadImage(e: Entry, src: string, blobUrl: string | null, stale = false): void {
    const gen = ++e.gen;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.alt = '';
    img.className = 'uw-media';
    // our own blob: copies, or an http(s) address (checked again here, whatever the caller)
    if (!src.startsWith('blob:') && !webUrl(src)) {
      this.failed(e);
      return;
    }
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      img.onload = img.onerror = null;
      if (gen !== e.gen || e.dead) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        return;
      }
      if (ok && img.naturalWidth > 0) {
        this.swap(e, img, [img.naturalWidth, img.naturalHeight]);
        if (e.blobUrl && e.blobUrl !== blobUrl) URL.revokeObjectURL(e.blobUrl);
        e.blobUrl = blobUrl;
        this.setStale(e, stale);
      } else {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        img.removeAttribute('src');
        this.failed(e);
      }
      this.schedule(e);
    };
    const to = setTimeout(() => finish(false), IMAGE_TIMEOUT);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = src;
  }

  /** Marco Cloud: the image comes from this server's route, with the display credential, shown as a blob. */
  private async loadProxy(e: Entry): Promise<void> {
    const gen = ++e.gen;
    e.abort?.abort();
    const ctl = new AbortController();
    e.abort = ctl;
    const to = setTimeout(() => ctl.abort(), IMAGE_TIMEOUT);
    try {
      const path = addParam(e.w.src, 'v', e.w.v).replace(location.origin, '');
      // the display credential only ever goes to this server's widget route
      if (!path.startsWith('/api/display/widget/')) throw new Error('not a widget route');
      const r = await fetch(withScreen(path), { headers: authHeaders(), cache: 'no-store', signal: ctl.signal });
      if (gen !== e.gen || e.dead) return;
      if (r.status === 404 && !isPreview) {
        // removed, or the screen went private: nothing to show until the config says otherwise
        e.el.classList.add('uw-wait');
        return;
      }
      if ((r.status === 409 || r.status === 404) && isPreview) {
        // the admin preview of an unsaved widget (a changed one is 409, a new one 404 until saved): the copy the
        // admin posted, or a note until it is saved
        const pv = this.previewBlobs.get(e.w.id);
        if (pv && pv.v === e.w.v) return this.loadImage(e, pv.url, null);
        this.showNote(e, ctx.t('widgetSaveToSee'));
        return;
      }
      if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      if (gen !== e.gen || e.dead) return;
      const url = URL.createObjectURL(blob);
      // loadImage takes its own generation and owns the blob URL from here on
      this.loadImage(e, url, url, r.headers.get('x-marco-stale') === '1');
      return;
    } catch {
      if (gen !== e.gen || e.dead) return;
      this.failed(e);
      this.schedule(e);
    } finally {
      clearTimeout(to);
      if (e.abort === ctl) e.abort = null;
    }
  }

  private loadFrame(e: Entry): void {
    if (!webUrl(e.w.src) || e.w.via !== 'direct' || sameOrigin(e.w.src)) {
      // never framed (see the header); the admin warns about it
      this.showNote(e, e.w.name);
      return;
    }
    const gen = ++e.gen;
    const f = document.createElement('iframe');
    f.className = 'uw-media uw-frame-next';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('allow', '');
    f.setAttribute('loading', 'eager');
    f.setAttribute('scrolling', 'no');
    f.tabIndex = -1;
    f.title = e.w.name;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      if (gen !== e.gen || e.dead) return void f.remove();
      if (ok) {
        f.classList.remove('uw-frame-next');
        this.swap(e, f, null);
        this.setStale(e, false);
      } else {
        f.remove();
        this.failed(e);
      }
      this.schedule(e);
    };
    const to = setTimeout(() => finish(false), FRAME_TIMEOUT);
    f.addEventListener('load', () => finish(true), { once: true });
    f.src = e.w.src;
    // loads hidden next to the one on screen, then takes its place
    e.el.appendChild(f);
    this.size(e, f);
  }

  private swap(e: Entry, next: HTMLImageElement | HTMLIFrameElement | HTMLElement, nat: [number, number] | null): void {
    const first = !e.media;
    const sizeChanged = !e.nat || !nat || e.nat[0] !== nat[0] || e.nat[1] !== nat[1];
    e.el.querySelector('.uw-note')?.remove();
    // a frame already loaded in place: moving it would load it again, so the old one just goes
    if (next.parentElement === e.el) e.media?.remove();
    else if (e.media) e.media.replaceWith(next);
    else e.el.insertBefore(next, e.el.firstChild);
    e.media = next;
    e.nat = nat;
    e.el.classList.remove('uw-wait', 'uw-failed');
    this.size(e);
    if (first) this.halves();
    if ((first || sizeChanged) && e.el.parentElement === this.side) this.onSideChange?.();
  }

  private failed(e: Entry): void {
    if (e.media) return this.setStale(e, true);
    e.el.classList.add('uw-failed');
    this.halves();
    // full screen: the widget's name and "not updated" instead of an empty screen; corner / side: no space taken
    if (e.el.parentElement === this.full || this.isCanvasBox(e.el.parentElement)) this.showNote(e, `${e.w.name} · ${ctx.t('widgetStale')}`);
  }

  private setStale(e: Entry, on: boolean): void {
    e.el.classList.toggle('uw-stale', on);
    const pill = e.el.querySelector('.uw-pill') as HTMLElement | null;
    if (pill) pill.textContent = on ? ctx.t('widgetStale') : '';
  }

  /** A small glass card with a text in place of the widget (shown even before anything loaded). */
  private showNote(e: Entry, text: string): void {
    let note = e.el.querySelector('.uw-note') as HTMLElement | null;
    if (!note) {
      note = document.createElement('div');
      note.className = 'uw-note uw-ph';
      e.el.appendChild(note);
    }
    note.textContent = text;
    e.el.classList.remove('uw-wait');
  }

  private showFullPlaceholder(text: string): void {
    this.fullPh.textContent = text;
    if (this.fullPh.parentElement !== this.full) this.full.appendChild(this.fullPh);
  }

  // ------------------------------------------------------------------------------------------- sizing

  /** Box the widget may take, in px: [max width, max height]. */
  private bounds(e: Entry): [number, number] {
    const vw = window.innerWidth / 100;
    const vh = window.innerHeight / 100;
    const box = e.el.parentElement;
    if (box === this.full || (box && this.isCanvasBox(box))) {
      const b = box as HTMLElement;
      const cs = getComputedStyle(b);
      const w = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = b.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      return [Math.max(0, w), Math.max(0, h)];
    }
    if (box === this.side) return [Math.max(0, this.side.clientWidth || this.side.parentElement?.clientWidth || 0), SIDE_H[e.w.size] * vh];
    const [bw, bh] = CORNER_BOX[e.w.size] ?? CORNER_BOX.m;
    let h = bh * vh;
    if (box) {
      // the corner's stack: the whole height, or half when the other corner of its side has widgets too (.uw-half),
      // less its padding (the photo frame card's room included) and gaps; shared by its widgets in proportion to
      // their sizes when they do not all fit
      const cs = getComputedStyle(box);
      const shown = [...box.children].filter((x) => x.classList.contains('uw') && !x.classList.contains('uw-wait') && !x.classList.contains('uw-failed'));
      if (!shown.includes(e.el)) shown.push(e.el);
      const gap = parseFloat(cs.rowGap) || 0;
      const room = (box.classList.contains('uw-half') ? window.innerHeight / 2 : window.innerHeight)
        - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - gap * (shown.length - 1);
      const want = (x: Element) => (CORNER_BOX[(x as HTMLElement).dataset.size ?? ''] ?? CORNER_BOX.m)[1] * vh;
      const sum = shown.reduce((n, x) => n + want(x), 0);
      if (sum > room) h = (h * room) / sum;
    }
    return [bw * vw, Math.max(0, Math.floor(h))];
  }

  private size(e: Entry, media: HTMLImageElement | HTMLIFrameElement | HTMLElement | null = e.media): void {
    // the room it may take, for the admin's widget preview (it outlines it)
    if (isPreview && e.el.parentElement) {
      const [rw, rh] = this.bounds(e);
      e.el.dataset.room = `${Math.round(rw)}x${Math.round(rh)}`;
    }
    if (e.card) {
      const box = e.el.parentElement;
      if (!box) return;
      const [cw, ch] = this.bounds(e);
      // a Personalizado card draws it like the full screen when it is big enough, else like the side column
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
      const canvasPlace = cw >= rem * 70 && ch >= rem * 36 ? 'full' : 'side';
      // a Personalizado card with its chart "De fondo" (widgets/canvas/content.ts)
      e.card.backdrop = this.isCanvasBox(box) && box.dataset.chartStyle === 'background';
      if (e.card instanceof CurrencyCard) e.card.layout(cw, ch, box === this.full ? 'full' : this.isCanvasBox(box) ? 'canvas' : box === this.side ? 'side' : 'corner');
      else e.card.layout(cw, ch, box === this.full ? 'full' : this.isCanvasBox(box) ? canvasPlace : box === this.side ? 'side' : 'corner');
      return;
    }
    if (!media || !(media instanceof HTMLImageElement || media instanceof HTMLIFrameElement)) return;
    const [mw, mh] = this.bounds(e);
    const full = e.el.parentElement === this.full || this.isCanvasBox(e.el.parentElement);
    if (media instanceof HTMLIFrameElement) {
      if (full) {
        media.style.width = `${Math.round(mw)}px`;
        media.style.height = `${Math.round(mh)}px`;
      } else {
        const h = Math.min(mh, (mw * 9) / 16);
        media.style.width = `${Math.round(h === mh ? (mh * 16) / 9 : mw)}px`;
        media.style.height = `${Math.round(h)}px`;
      }
      return;
    }
    if (full && e.w.fit === 'cover') {
      media.style.width = `${Math.round(mw)}px`;
      media.style.height = `${Math.round(mh)}px`;
      return;
    }
    const nat = e.nat;
    if (!nat || !nat[0] || !nat[1]) return;
    const k = Math.min(mw / nat[0], mh / nat[1]);
    media.style.width = `${Math.max(1, Math.round(nat[0] * k))}px`;
    media.style.height = `${Math.max(1, Math.round(nat[1] * k))}px`;
  }

  /**
   * Widgets in both corners of one side (top-left and bottom-left, or top-right and bottom-right): each corner stack
   * gets half the screen's height so they never overlap. `resize` sizes the widgets again when that changed.
   */
  private halves(resize = true): void {
    const shown = (c: FrameCorner) => [...this.corners[c].children].filter((x) => x.classList.contains('uw') && !x.classList.contains('uw-wait') && !x.classList.contains('uw-failed')).length;
    for (const [a, b] of [['tl', 'bl'], ['tr', 'br']] as [FrameCorner, FrameCorner][]) {
      const both = shown(a) > 0 && shown(b) > 0;
      for (const c of [a, b]) this.corners[c].classList.toggle('uw-half', both);
    }
    // what each corner shows changed (a widget loaded, failed, or the other corner filled): sized again
    const sig = CORNERS.map((c) => `${shown(c)}${this.corners[c].classList.contains('uw-half') ? 'h' : ''}`).join(',');
    const changed = sig !== this.cornerSig;
    this.cornerSig = sig;
    if (changed && resize) for (const e of this.entries.values()) if (e.el.parentElement !== this.side && e.el.parentElement !== this.full) this.size(e);
  }
  private cornerSig = '';

  /** Photo frame layout: widgets in the clock card's corner stack beside it, never over it. */
  private avoidPhotoFrame(): void {
    for (const c of CORNERS) {
      this.corners[c].style.paddingTop = '';
      this.corners[c].style.paddingBottom = '';
    }
    if (this.preset !== 'photoFrame' || !this.cfg) return;
    const card = document.querySelector('#view .pf-card') as HTMLElement | null;
    if (!card || !card.offsetHeight) return;
    const corner = (this.cfg.layout.corner ?? 'br') as FrameCorner;
    const box = this.corners[corner];
    if (!box) return;
    const r = card.getBoundingClientRect();
    const gap = Math.min(window.innerWidth, window.innerHeight) * 0.02;
    if (corner[0] === 'b') box.style.paddingBottom = `${Math.round(window.innerHeight - r.top + gap)}px`;
    else box.style.paddingTop = `${Math.round(r.bottom + gap)}px`;
  }
}
