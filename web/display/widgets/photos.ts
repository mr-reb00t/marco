// Photo rotation controller: preloads + decodes the next image before showing it, then hands it to the
// WebGL photo layer (shader transition) or to the CSS cross-fade fallback. A photo whose orientation differs from
// the screen can be composed on a canvas first (background.portraitFit): the whole photo over a blurred copy of
// itself. Both layers then take the canvas like any other image, so Ken Burns and the tone measure stay the same.
import { coverPosition, coverWindow, freeBand, type PhotoFrame } from '../../shared/focus';
import type { PhotoStats } from '../../shared/glass';
import type { BackgroundConfig, Photo } from '../../shared/types';
import { immichCaption, wantsBlurFill } from '../photoFit';
import { ctx } from '../ctx';
import { el, esc, reducedMotion } from '../dom';
import { mediaUrl } from '../identity';
import type { PhotoLayer } from '../gl/photoLayer';

const MAX_TEX = 2560;
/** Longest side of a composed (blurred fill) frame. */
const MAX_COMPOSED = 1920;

/** Decoded photo ready for a layer: the image itself, or a canvas with the blurred fill composed around it. */
interface Loaded {
  img: HTMLImageElement;
  src: TexImageSource & { width: number; height: number };
  /** what the tone measure reads (the composed frame when there is one) */
  tone: CanvasImageSource;
  /** composed frame: pixel size, and the URL the CSS layer uses (a blob: URL to revoke later) */
  composed?: { w: number; h: number; url: string };
}

/** A photo loaded ahead for the next carousel screen (Photos.prepare / takeover). */
interface Ahead {
  key: string;
  /** photo panel size it was framed for (a blurred fill frame only fits that size) */
  aw: number;
  ah: number;
  ready: Promise<Loaded | null>;
  loaded: Loaded | null;
}

/** Free what a loaded photo holds that the browser does not free by itself. */
function release(l: Loaded | null): void {
  if (!l) return;
  if (l.composed?.url) URL.revokeObjectURL(l.composed.url);
  if (typeof ImageBitmap !== 'undefined' && l.src instanceof ImageBitmap) l.src.close();
}

/**
 * The whole photo centred over a blurred, darker copy of itself that fills the frame (`fw` x `fh`). The blur is
 * done on a small canvas and scaled up, which is cheap enough for a Raspberry Pi.
 */
function composeBlurFill(img: HTMLImageElement, fw: number, fh: number): HTMLCanvasElement {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = fw;
  c.height = fh;
  const g = c.getContext('2d')!;
  // blurred fill: cover-crop into a small canvas (a bit larger than needed, so the blur has no dark edges)
  const sw = 160, sh = Math.max(1, Math.round((sw * fh) / fw));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sg = small.getContext('2d')!;
  const cover = Math.max(sw / iw, sh / ih) * 1.15;
  const dw = iw * cover, dh = ih * cover;
  if ('filter' in sg) sg.filter = 'blur(6px)';
  sg.drawImage(img, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, fw, fh);
  g.fillStyle = 'rgba(0, 0, 0, 0.28)';
  g.fillRect(0, 0, fw, fh);
  // the photo itself, whole, with a small margin so the slow zoom does not cut it
  const fit = Math.min(fw / iw, fh / ih) * 0.94;
  const pw = Math.round(iw * fit), ph = Math.round(ih * fit);
  g.shadowColor = 'rgba(0, 0, 0, 0.45)';
  g.shadowBlur = Math.round(Math.min(fw, fh) * 0.03);
  g.drawImage(img, Math.round((fw - pw) / 2), Math.round((fh - ph) / 2), pw, ph);
  return c;
}

const canvasUrl = (c: HTMLCanvasElement): Promise<string> =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(URL.createObjectURL(b)) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.9));

type PhNode = HTMLElement & { _ph?: { w: number; h: number; p: Photo }; _blob?: string };
/** Remove a CSS photo node, freeing the composed frame it showed. */
function dropNode(n: PhNode | null | undefined): void {
  if (!n) return;
  n.remove();
  if (n._blob) URL.revokeObjectURL(n._blob);
}

/** set once the first photo's tone has been applied (see measureTone) */
let toneSeen = false;

/** A slideshow's place, kept by a carousel while another screen shows (Photos.position / resume). */
export interface SlideshowPosition {
  list: Photo[];
  idx: number;
}

export class Photos {
  private list: Photo[] = [];
  private idx = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** when the timer fires (ms) and with which interval it was set (s) */
  private dueAt = 0;
  private dueSec = 0;
  /** the pace of the special background whose photos show now (PhotosResponse.intervalSec, #45); null = the screen's */
  private ruleEvery: number | null = null;
  /** When a carousel changes screen next (local ms, null = not by time), so a photo change never lands on it (main.ts). */
  switchAt: (() => number | null) | null = null;
  private loading = false;
  private glLayer: PhotoLayer | null = null;
  private domCur: HTMLElement | null = null;
  private meta: HTMLElement;
  private failures = 0;
  private shownFile = '';
  private lastShown = '';
  private fitSig = '';
  /** a photo was put on screen (by this slideshow or a takeover) */
  private shown = false;
  /** background.enabled at the last applyConfig (null before the first) */
  private wasOn: boolean | null = null;
  /** bumped when a carousel switch puts a photo on screen: a photo still loading from before is dropped */
  private gen = 0;
  private ahead: Ahead | null = null;
  /** Called when the batch has been shown completely; may replace the list (awaited before wrapping around). */
  onExhausted: (() => Promise<void> | void) | null = null;
  /** Free band of the photo panel (not covered by clock / weather card / side widgets); reported in heartbeats. */
  frame: PhotoFrame | null = null;
  onFrameChange: (() => void) | null = null;

  constructor(private area: HTMLElement, metaEl: HTMLElement) {
    this.meta = metaEl;
  }

  /** Gallery file on screen right now ('' for stock photos). */
  get currentFile(): string {
    return this.shownFile;
  }

  /** Last gallery file or Immich asset shown (for `after=`: sequential orders continue from it). */
  get lastKey(): string {
    return this.lastShown;
  }

  /** Switch between WebGL and DOM rendering (e.g. after context loss). */
  setGL(layer: PhotoLayer | null): void {
    this.glLayer = layer;
    if (layer) layer.targetY = this.frame?.targetY ?? 0.5;
    this.area.classList.toggle('dom', !this.usingGL);
    // WebGL became available after a photo was already shown via the DOM: hand it over.
    if (layer && this.usingGL && this.idx >= 0) this.showCurrentAgain();
  }

  get usingGL(): boolean {
    return this.glFor(ctx.cfg.background);
  }

  private glFor(b: Pick<BackgroundConfig, 'transition'>): boolean {
    return !!this.glLayer && b.transition === 'webgl';
  }

  /** Seconds between photos: the active special background's own pace, else the configured one. */
  private every(b: Pick<BackgroundConfig, 'intervalSec'>): number {
    return this.ruleEvery ?? b.intervalSec;
  }

  /** The pace the last photos response asked for (null = as configured); a new one restarts the timer from now. */
  setEvery(sec: number | null): void {
    this.ruleEvery = sec && sec >= 10 ? sec : null;
    if (this.glLayer) this.glLayer.interval = this.every(ctx.cfg.background);
    this.schedule();
  }

  applyConfig(): void {
    const b = ctx.cfg.background;
    const gl = this.usingGL;
    this.area.classList.toggle('dom', !gl);
    this.area.style.setProperty('--photo-bright', String(b.brightness));
    if (this.glLayer) {
      this.glLayer.enabled = gl && b.enabled;
      this.glLayer.brightness = b.brightness;
      this.glLayer.interval = this.every(b);
      this.glLayer.cover = b.cover;
    }
    // the portrait option changed: show the photo on screen again with the new framing
    const fitSig = `${b.cover}|${b.portraitFit ?? 'auto'}`;
    const refit = this.fitSig !== '' && fitSig !== this.fitSig;
    this.fitSig = fitSig;
    if ((refit || (!gl && !this.domCur)) && this.idx >= 0) this.showCurrentAgain();
    this.area.style.display = b.enabled ? '' : 'none';
    this.reframe();
    this.schedule();
    // The photo just came on (a Personalizado page switched from Animado or Color to Foto, the toggle in Fondo) or
    // none could be shown yet: show one now. The list may have arrived while photos were off, and waiting for the
    // timer would leave a black page for a whole interval.
    const turnedOn = b.enabled && this.wasOn === false;
    this.wasOn = b.enabled;
    if (b.enabled && (turnedOn || !this.shown) && this.list.length && !this.loading) void this.next();
  }

  setList(photos: Photo[]): void {
    const sig = (l: Photo[]) => l.map((p) => `${p.url}@${p.focusX ?? ''},${p.focusY ?? ''}`).join('|');
    if (sig(photos) === sig(this.list)) return;
    // The photo on screen got a new focal point (edited in the admin): re-frame it right away.
    const shown = this.list[this.idx];
    const updated = shown && photos.find((p) => p.url === shown.url);
    const refocus = !!updated && (updated.focusX !== shown.focusX || updated.focusY !== shown.focusY);
    const first = this.list.length === 0;
    this.list = photos.slice();
    this.idx = -1;
    // nothing on screen yet (the first list, or one that came while photos were off): show its first photo now
    if (first || !this.shown) void this.next();
    else if (refocus && updated) {
      this.list = [updated, ...photos.filter((p) => p !== updated)];
      this.idx = 0;
      this.showCurrentAgain();
    }
  }

  /**
   * Measure which vertical parts of the photo panel are covered by the side panel's text blocks and re-apply the
   * focal crop so the subject sits in the largest free band (layout changed, widgets appeared / disappeared).
   */
  reframe(): void {
    const f = this.measure();
    const prev = this.frame;
    const changed = !prev !== !f || (!!f && !!prev && (Math.abs(f.targetY - prev.targetY) > 0.01 || Math.abs(f.aspect - prev.aspect) > 0.01 ||
      JSON.stringify(f.blocks) !== JSON.stringify(prev.blocks)));
    if (!changed) return;
    this.frame = f;
    if (this.glLayer) this.glLayer.targetY = f?.targetY ?? 0.5;
    const n = this.domCur as PhNode | null;
    if (n?._ph) this.frameDom(n, n._ph.w, n._ph.h, n._ph.p);
    this.onFrameChange?.();
  }

  private measure(): PhotoFrame | null {
    const a = this.area.getBoundingClientRect();
    if (a.height < 10 || a.width < 10) return null;
    const blocks: [number, number][] = [];
    const side = document.querySelector<HTMLElement>('#app .side');
    if (side && side.offsetHeight > 0) {
      const els = [side.querySelector('.side-top'), ...Array.from(side.querySelectorAll('.side-mid > *')), side.querySelector('.side-bottom')];
      for (const el of els) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 2 || r.width < 2) continue;
        // only what actually sits over the photo (most of its width)
        if (Math.min(r.right, a.right) - Math.max(r.left, a.left) < a.width * 0.3) continue;
        const r3 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
        blocks.push([r3((r.top - a.top) / a.height), r3((r.bottom - a.top) / a.height)]);
      }
    }
    const band = freeBand(blocks);
    return {
      aspect: Math.round((a.width / a.height) * 1000) / 1000,
      targetY: Math.round(band.target * 1000) / 1000,
      freeTop: Math.round(band.top * 1000) / 1000,
      freeBottom: Math.round(band.bottom * 1000) / 1000,
      blocks: blocks.slice(0, 8),
    };
  }

  private frameDom(node: HTMLElement, w: number, h: number, p: Photo): void {
    const bw = this.area.clientWidth || window.innerWidth, bh = this.area.clientHeight || window.innerHeight;
    if (!ctx.cfg.background.cover || !w || !h) return;
    const ty = this.frame?.targetY ?? 0.5;
    node.style.backgroundPosition = coverPosition(w, h, bw, bh, p.focusX, p.focusY, 0.5, ty);
    const win = coverWindow(w, h, bw, bh, p.focusX, p.focusY, 0.5, ty);
    // zoom (Ken Burns) around the focal point, so it stays in frame
    node.style.transformOrigin = `${(win.ax * 100).toFixed(1)}% ${(win.ay * 100).toFixed(1)}%`;
  }

  /**
   * Set the timer for the next photo. A config refresh (every carousel switch brings one) keeps a running timer, so
   * the slideshow goes on at its own pace; only a new interval, or `restart` after a photo, sets it again. A change
   * that would come within a few seconds of a carousel switch moves to the middle of the next screen's turn.
   */
  private schedule(restart = false): void {
    const b = ctx.cfg.background;
    const now = Date.now();
    if (!b.enabled) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    const sec = this.every(b);
    if (!restart && this.timer && sec === this.dueSec && this.dueAt > now) return;
    let at = now + sec * 1000;
    const sw = this.switchAt?.() ?? null;
    if (sw !== null && sw > now) {
      // at least the length of a photo transition plus a short load, so the change is over before the switch
      const margin = Math.max(3500, Math.min(5000, sec * 250));
      if (Math.abs(at - sw) < margin) at = sw + Math.max(margin, sec * 500);
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.next(), at - now);
    this.dueAt = at;
    this.dueSec = sec;
  }

  private async load(p: Photo, b: BackgroundConfig = ctx.cfg.background, gl = this.usingGL): Promise<Loaded> {
    const url = p.url;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = mediaUrl(url);
    try {
      await img.decode();
    } catch (e) {
      // decode() can reject spuriously (e.g. under memory pressure); fall back to the load event
      if (!(img.complete && img.naturalWidth)) {
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(e);
          if (img.complete) (img.naturalWidth ? res() : rej(e));
        });
      }
    }
    let src: TexImageSource & { width: number; height: number } = img;
    const w = img.naturalWidth, h = img.naturalHeight;
    const aw = this.area.clientWidth || window.innerWidth, ah = this.area.clientHeight || window.innerHeight;
    if (wantsBlurFill(b, p, w, h, aw, ah)) {
      try {
        const s = Math.min(1, MAX_COMPOSED / Math.max(aw * (window.devicePixelRatio || 1), ah * (window.devicePixelRatio || 1))) * (window.devicePixelRatio || 1);
        const fw = Math.max(2, Math.round(aw * s)), fh = Math.max(2, Math.round(ah * s));
        const canvas = composeBlurFill(img, fw, fh);
        const composedUrl = gl ? '' : await canvasUrl(canvas);
        return { img, src: canvas, tone: canvas, composed: { w: fw, h: fh, url: composedUrl } };
      } catch (e) {
        console.warn('[photos] blurred fill failed', e);
      }
    }
    if (gl && (w > MAX_TEX || h > MAX_TEX) && 'createImageBitmap' in window) {
      const s = MAX_TEX / Math.max(w, h);
      // WebGL ignores UNPACK_FLIP_Y for ImageBitmaps (three uploads them unflipped): flip at decode time;
      // PhotoLayer sets texture.flipY = false for bitmaps so both paths end up upright.
      src = await createImageBitmap(img, {
        resizeWidth: Math.round(w * s), resizeHeight: Math.round(h * s), resizeQuality: 'high', imageOrientation: 'flipY',
      });
    }
    return { img, src, tone: img };
  }

  /** Where the slideshow is: its list and the photo on screen (a carousel keeps it while another screen shows). */
  position(): SlideshowPosition {
    return { list: this.list.slice(), idx: this.idx };
  }

  /** Go on from a saved position: the photo after the one that was on screen then. */
  resume(p: SlideshowPosition): void {
    if (!p.list.length) return void this.next();
    this.list = p.list.slice();
    this.idx = Math.min(p.idx, p.list.length - 1);
    void this.next();
  }

  /** What a loaded photo depends on besides its URL: the renderer and the framing settings. */
  private aheadKey(url: string, b: BackgroundConfig): string {
    return `${url}|${this.glFor(b) ? 'gl' : 'dom'}|${b.cover}|${b.portraitFit ?? 'auto'}`;
  }

  /**
   * Load and decode ahead the photo a carousel screen starts with (`list[idx]`, framed with that screen's photo
   * settings `b`), so the switch can put it on screen at once (takeover). Resolves with false when it failed.
   */
  prepare(list: Photo[], idx: number, b: BackgroundConfig): Promise<boolean> {
    const p = list[idx];
    if (!p || !b.enabled) return Promise.resolve(false);
    const key = this.aheadKey(p.url, b);
    if (this.ahead?.key === key) return this.ahead.ready.then((l) => !!l);
    this.dropAhead();
    const a: Ahead = {
      key, aw: this.area.clientWidth, ah: this.area.clientHeight, loaded: null,
      ready: this.load(p, b, this.glFor(b)).then(
        (l) => {
          if (this.ahead !== a) {
            release(l);
            return null;
          }
          a.loaded = l;
          return l;
        },
        () => {
          // failed: the next prepare tries again
          if (this.ahead === a) this.ahead = null;
          return null;
        },
      ),
    };
    this.ahead = a;
    return a.ready.then((l) => !!l);
  }

  private dropAhead(): void {
    release(this.ahead?.loaded ?? null);
    this.ahead = null;
  }

  /**
   * A carousel switch: show `list[idx]` right now if prepare() has it ready, with no crossfade (the switch animation
   * carries the change) and the tone set at once. `crossfade`: the slideshow's usual crossfade instead (the light
   * switch on a Raspberry Pi is too short to carry a photo change). False when it is not ready: go on as before.
   */
  takeover(list: Photo[], idx: number, crossfade = false): boolean {
    const a = this.ahead;
    const p = list[idx];
    const l = a?.loaded;
    const b = ctx.cfg.background;
    if (!a || !l || !p || !b.enabled || a.key !== this.aheadKey(p.url, b)) return false;
    // a blurred fill frame is composed for one panel size
    if (l.composed && (Math.abs(a.aw - this.area.clientWidth) > 2 || Math.abs(a.ah - this.area.clientHeight) > 2)) return false;
    this.ahead = null;
    this.restart();
    this.list = list.slice();
    this.idx = idx;
    this.display(p, l, crossfade ? undefined : 0);
    applyTone(l.tone, true);
    this.failures = 0;
    this.schedule(true);
    return true;
  }

  async next(): Promise<void> {
    if (this.loading || !this.list.length || !ctx.cfg.background.enabled) {
      this.schedule(true);
      return;
    }
    this.loading = true;
    const gen = this.gen;
    try {
      let tries = 0;
      while (tries++ < Math.min(5, this.list.length)) {
        if (this.idx + 1 >= this.list.length && this.onExhausted) {
          // batch done: fetch the next one first (it continues the rotation), then show its first photo
          try {
            await this.onExhausted();
          } catch {
            /* keep the old list */
          }
          if (!this.list.length || gen !== this.gen) break;
        }
        this.idx++;
        if (this.idx >= this.list.length) this.idx = 0;
        const p = this.list[this.idx];
        try {
          const loaded = await this.load(p).catch(async () => {
            await new Promise((r) => setTimeout(r, 1500)); // one retry for transient network/decoder hiccups
            return this.load(p);
          });
          // a slow load that ends just before a carousel switch waits until the switch is over
          const sw = this.switchAt?.() ?? null;
          const wait = sw === null ? Infinity : sw - Date.now();
          if (gen === this.gen && wait > -500 && wait < 3000) await new Promise((r) => setTimeout(r, Math.max(0, wait) + 2500));
          // a carousel switch put another photo on screen meanwhile
          if (gen !== this.gen) {
            release(loaded);
            break;
          }
          this.display(p, loaded);
          applyTone(loaded.tone);
          this.failures = 0;
          break;
        } catch (e) {
          this.failures++;
          console.warn('[photos] failed', p.url, e);
        }
      }
    } finally {
      // after a newer start (see restart) that one owns the flag and the timer
      if (gen === this.gen) {
        this.loading = false;
        this.schedule(true);
      }
    }
  }

  /** Another slideshow starts (a carousel switch to other photo settings): a photo still loading is dropped. */
  restart(): void {
    this.gen++;
    this.loading = false;
  }

  private showCurrentAgain(): void {
    const p = this.list[this.idx];
    const gen = this.gen;
    if (p) this.load(p).then((l) => (gen === this.gen ? this.display(p, l) : release(l))).catch(() => {});
  }

  /** `cut`: undefined = the usual transition; 0 = no transition; > 0 = a WebGL transition of that many seconds. */
  private display(p: Photo, l: Loaded, cut?: number): void {
    const { img, src, composed } = l;
    const b = ctx.cfg.background;
    this.shown = true;
    this.shownFile = p.file || '';
    if (p.file || p.id) this.lastShown = p.file || p.id || '';
    // a composed frame is already framed: no focal point
    const focus = composed ? undefined : p;
    if (this.usingGL && this.glLayer) {
      // composed for the CSS path before WebGL came back: its blob URL is not used here
      if (composed?.url) URL.revokeObjectURL(composed.url);
      this.glLayer.show(src, focus, cut);
      if (this.domCur) {
        dropNode(this.domCur);
        this.domCur = null;
      }
    } else {
      const node = el('div', `ph${b.cover ? '' : ' contain'}`) as PhNode;
      const bgUrl = composed?.url || img.src;
      if (composed?.url) node._blob = composed.url;
      node.style.backgroundImage = `url("${bgUrl.replace(/"/g, '%22')}")`;
      node.style.setProperty('--kb-dur', `${this.every(b) + 6}s`);
      node.style.setProperty('--kb-x', `${(Math.random() * 2 - 1).toFixed(2)}%`);
      node.style.setProperty('--kb-y', `${(Math.random() * 2 - 1).toFixed(2)}%`);
      const fw = composed?.w ?? img.naturalWidth, fh = composed?.h ?? img.naturalHeight;
      const fp: Photo = composed ? { ...p, focusX: undefined, focusY: undefined } : p;
      node._ph = { w: fw, h: fh, p: fp };
      this.frameDom(node, fw, fh, fp);
      const old = this.domCur as PhNode | null;
      this.area.querySelector('.ph-stack')!.appendChild(node);
      this.domCur = node;
      const fade = cut === undefined && b.transition !== 'none' && !reducedMotion();
      if (fade) {
        node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2200, easing: 'ease-in-out', fill: 'backwards' }).onfinish = () =>
          dropNode(old);
      } else dropNode(old);
    }
    const text =
      p.source === 'immich' ? immichCaption(p, ctx.lang) : p.title ? `${p.title}${p.author ? ' · ' + p.author : ''}` : p.author ? ctx.t('photoBy', { a: p.author }) : '';
    const showMeta = b.showMeta && !!text;
    this.meta.style.display = showMeta ? '' : 'none';
    if (showMeta) this.meta.innerHTML = esc(text);
  }
}

/**
 * Measure how bright / busy the photo is where text sits (clock: top, weather: bottom) and expose it as
 * --tone-top / --tone-bottom (0 = dark & calm, 1 = bright & busy). CSS scales the scrim and the frosted
 * weather card with it, so dark photos stay vivid and light ones stay legible.
 */
const toneCanvas = document.createElement('canvas');
/** Latest measure of the photo (for the Modern glass tint / ink); null until a photo could be read. */
export let photoStats: PhotoStats | null = null;
/** The 48×32 sample of the latest photo (RGBA) and the photo's width / height, for toneOf(). */
let toneBuf: Uint8ClampedArray | null = null;
let toneAspect = 0;
let toneSeq = 0;
const toneCache = new Map<string, RegionTone>();

function aspectOf(img: CanvasImageSource): number {
  const o = img as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number | { baseVal?: { value: number } }; height?: number | { baseVal?: { value: number } } };
  const w = o.naturalWidth || o.videoWidth || (typeof o.width === 'number' ? o.width : 0);
  const h = o.naturalHeight || o.videoHeight || (typeof o.height === 'number' ? o.height : 0);
  return w && h ? w / h : 0;
}

/** What the photo looks like in one region: the same tone as --tone-bottom, its colour and its mean brightness. */
export interface RegionTone extends PhotoStats {
  /** mean luminance, 0..1 */
  lum: number;
}

/**
 * The photo behind a part of its frame, as fractions of the frame's box (0..1, the photo drawn to cover it, centred).
 * null until a photo could be read. Cached per photo and region.
 */
export function toneOf(x0: number, y0: number, x1: number, y1: number, frameAspect: number): RegionTone | null {
  const px = toneBuf;
  if (!px) return null;
  const W = 48, H = 32;
  // the part of the photo the frame shows (object-fit: cover, centred)
  let ox = 0, oy = 0, sx = 1, sy = 1;
  if (toneAspect && frameAspect) {
    if (toneAspect > frameAspect) {
      sx = frameAspect / toneAspect;
      ox = (1 - sx) / 2;
    } else {
      sy = toneAspect / frameAspect;
      oy = (1 - sy) / 2;
    }
  }
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const ax = Math.floor(c(ox + c(x0) * sx) * W), bx = Math.max(ax + 1, Math.ceil(c(ox + c(x1) * sx) * W));
  const ay = Math.floor(c(oy + c(y0) * sy) * H), by = Math.max(ay + 1, Math.ceil(c(oy + c(y1) * sy) * H));
  const key = `${toneSeq}|${ax},${ay},${bx},${by}`;
  const hit = toneCache.get(key);
  if (hit) return hit;
  let sum = 0, sq = 0, n = 0, wr = 0, wg = 0, wb = 0, ws = 0;
  for (let y = ay; y < Math.min(H, by); y++) {
    for (let x = ax; x < Math.min(W, bx); x++) {
      const i = (y * W + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      sum += l; sq += l * l; n++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const w = 0.05 + (mx ? (mx - mn) / mx : 0) * Math.min(1, mx / 96);
      wr += r * w; wg += g * w; wb += b * w; ws += w;
    }
  }
  if (!n) return null;
  const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
  const bright = Math.min(1, Math.max(0, (mean - 0.18) / 0.5));
  const busy = Math.min(1, std / 0.22);
  const out: RegionTone = { tone: Math.min(1, bright * 0.75 + busy * 0.35), rgb: [wr / ws, wg / ws, wb / ws].map(Math.round) as [number, number, number], lum: mean };
  if (toneCache.size > 64) toneCache.clear();
  toneCache.set(key, out);
  return out;
}
function applyTone(img: CanvasImageSource, instant = false): void {
  try {
    const W = 48, H = 32;
    toneCanvas.width = W; toneCanvas.height = H;
    const g = toneCanvas.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.drawImage(img, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data; // throws on tainted (non-CORS) images → keep defaults
    const region = (y0: number, y1: number) => {
      let sum = 0, sq = 0, n = 0;
      for (let y = Math.floor(y0 * H); y < Math.ceil(y1 * H); y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
          sum += l; sq += l * l; n++;
        }
      }
      const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
      const bright = Math.min(1, Math.max(0, (mean - 0.18) / 0.5));
      const busy = Math.min(1, std / 0.22);
      return Math.min(1, bright * 0.75 + busy * 0.35);
    };
    const root = document.documentElement.style;
    // The first photo sets the tone at once: easing it in from the default made the glass cards and the chips
    // visibly change a second after the screen appeared. Later photos still ease (with the photo crossfade).
    const first = !toneSeen || instant;
    toneSeen = true;
    if (first) document.documentElement.classList.add('tone-instant');
    root.setProperty('--tone-top', region(0, 0.4).toFixed(3));
    const toneBottom = region(0.5, 1);
    root.setProperty('--tone-bottom', toneBottom.toFixed(3));
    // whole frame: saturation-weighted colour (the dominant hue, not the grey average of everything)
    let wr = 0, wg = 0, wb = 0, ws = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g2 = px[i + 1], b = px[i + 2];
      const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b);
      const w = 0.05 + (mx ? (mx - mn) / mx : 0) * Math.min(1, mx / 96);
      wr += r * w; wg += g2 * w; wb += b * w; ws += w;
    }
    photoStats = { tone: toneBottom, rgb: [wr / ws, wg / ws, wb / ws].map(Math.round) as [number, number, number] };
    // kept for toneOf(): the cards of a Personalizado screen each read the part of the photo right behind them
    toneBuf = new Uint8ClampedArray(px);
    toneAspect = aspectOf(img);
    toneSeq++;
    toneCache.clear();
    window.dispatchEvent(new Event('marco:photo-tone'));
    if (first) {
      void getComputedStyle(document.documentElement).getPropertyValue('--tone-bottom');
      requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('tone-instant')));
    }
  } catch {
    /* cross-origin without CORS: leave the defaults */
  }
}
