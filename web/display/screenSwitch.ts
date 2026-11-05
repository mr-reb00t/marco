// Animated switch between two carousel screens (the plan comes from web/display/switchPlan.ts).
//
// 1. Snapshot: #app is copied into a fixed overlay above it, inside a blank same-origin iframe with the page's own
//    styles and the root classes and variables of the screen that leaves (theme, style, font size, accent...). The
//    copy is a separate document, so when the new screen changes those on <html> the old one keeps its look. Canvases
//    are copied, scroll positions and the current frame of running animations are kept. With WebGL on, the GL canvas
//    (photo, ambient backdrop) is copied too, so the old screen is complete and opaque.
// 2. As soon as the copy is ready (its images decoded and fonts loaded, a few frames at most), the new screen is
//    rendered into the real #app underneath.
// 3. Both layers are animated with the Web Animations API, on transform and opacity only (the wipe's soft edge is a
//    gradient mask that moves with a transform), so the compositor does the work. 'dissolve' instead hands the GL copy to
//    the GL dissolve layer (web/display/gl/dissolveLayer.ts) and crossfades the content above it.
// 4. The overlay is removed. A switch that arrives while one runs finishes that one at once.
//
// A light plan (reduced motion, lite mode, very little memory) skips all of that: #app fades out, the new screen goes
// in and #app fades back in, with no copy of the page or of the GL frame.
import type { SwitchPlan } from './switchPlan';

export interface SwitchGL {
  /** the GL canvas (#gl), animated together with #app */
  canvas: HTMLCanvasElement;
  /** a copy of the GL frame as it is now, or null */
  snapshot(): HTMLCanvasElement | null;
  /** run the noise dissolve from `from` to the live GL frame; false when it cannot */
  dissolve(from: HTMLCanvasElement, ms: number): boolean;
  /** stop a running dissolve */
  stopDissolve(): void;
  /** keep the GL panel rects where the new layout puts them while #app moves (true), or follow it again (false) */
  holdRects(on: boolean): void;
}

const EASE = 'cubic-bezier(0.45, 0, 0.2, 1)';
/** Longest wait for the copy's images and fonts before the switch goes on anyway (ms). */
const READY_MAX = 600;

interface Running {
  overlay: HTMLElement | null;
  anims: Animation[];
  timer: ReturnType<typeof setTimeout>;
  gl: SwitchGL | null;
  /** the light fade only: the new screen, not rendered yet while #app fades out */
  pending?: (() => void) | null;
}

export class ScreenSwitcher {
  private run: Running | null = null;
  /** called when an animated switch ends (the new screen sits still where it belongs) */
  onDone: (() => void) | null = null;

  constructor(private app: HTMLElement, private gl: () => SwitchGL | null) {}

  /** Put the new screen on (apply renders it into #app) with the planned animation. */
  switch(plan: SwitchPlan, apply: () => void): void {
    this.finish();
    if (plan.effect === 'none' || plan.ms <= 0 || document.hidden || typeof this.app.animate !== 'function') return apply();
    if (plan.light) return this.fade(plan.ms, apply);
    let shot: { overlay: HTMLElement; ready: Promise<unknown> };
    let glShot: HTMLCanvasElement | null = null;
    const gl = this.glOn();
    let effect = plan.effect;
    try {
      glShot = gl ? gl.snapshot() : null;
      if (effect === 'dissolve' && !glShot) effect = 'fade';
      // the dissolve keeps the old content see-through: the GL layer under it does the background
      shot = this.snapshot(effect === 'dissolve' ? null : glShot, effect !== 'dissolve');
    } catch (e) {
      console.warn('[switch] snapshot failed', e);
      return apply();
    }
    // the copy covers #app already: the new screen goes in once the copy is fully drawn (finish() puts it in sooner)
    const run: Running = { overlay: shot.overlay, anims: [], gl, pending: apply, timer: setTimeout(() => this.finish(), plan.ms + READY_MAX + 600) };
    this.run = run;
    const go = () => {
      if (this.run !== run || !run.pending) return;
      const put = run.pending;
      run.pending = null;
      try {
        put();
      } catch (e) {
        this.finish();
        throw e;
      }
      this.animate(run, plan, effect, glShot);
    };
    void Promise.race([shot.ready, new Promise((r) => setTimeout(r, READY_MAX))]).then(go, go);
  }

  /** Run the planned animation: the copy in `run.overlay` leaves, the new screen in #app comes in. */
  private animate(run: Running, plan: SwitchPlan, effect: SwitchPlan['effect'], glShot: HTMLCanvasElement | null): void {
    const overlay = run.overlay!;
    const gl = run.gl;
    const ms = plan.ms;
    const anims: Animation[] = [];
    const opts = (extra?: KeyframeAnimationOptions): KeyframeAnimationOptions => ({ duration: ms, easing: EASE, fill: 'both', ...extra });
    const shell = overlay.firstElementChild as HTMLElement;
    const inner = shell.firstElementChild as HTMLElement;
    if (effect === 'dissolve' && !(gl && glShot && gl.dissolve(glShot, ms))) {
      // the GL layer could not take it: a plain crossfade of the full snapshot
      effect = 'fade';
      if (glShot) inner.prepend(glLayer(glShot));
    }
    // the new screen: #app and, when it moves, the GL canvas under it
    const moving: HTMLElement[] = [this.app];
    if (gl && (effect === 'slide' || effect === 'zoom')) {
      gl.holdRects(true);
      moving.push(gl.canvas);
    }
    switch (effect) {
      case 'slide': {
        // a swipe back (dir -1) moves the other way: the previous screen comes in from the left
        const s = plan.dir === -1 ? -1 : 1;
        anims.push(shell.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-100 * s}%,0,0)` }], opts()));
        for (const el of moving) anims.push(el.animate([{ transform: `translate3d(${100 * s}%,0,0)` }, { transform: 'translate3d(0,0,0)' }], opts()));
        break;
      }
      case 'zoom':
        anims.push(shell.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.96)', opacity: 0 }], opts({ easing: 'ease-out' })));
        for (const el of moving) anims.push(el.animate([{ transform: 'scale(1.04)' }, { transform: 'scale(1)' }], opts({ easing: 'cubic-bezier(0.2, 0.6, 0.2, 1)' })));
        break;
      case 'wipe': {
        // the shell carries a soft diagonal mask and moves right; the content inside moves back by the same amount,
        // so it stays still while the edge sweeps over it
        const travel = wipeGeometry(shell, inner);
        anims.push(shell.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${travel}px,0,0)` }], opts()));
        anims.push(inner.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-travel}px,0,0)` }], opts()));
        break;
      }
      case 'dissolve':
        anims.push(shell.animate([{ opacity: 1 }, { opacity: 0 }], opts({ easing: 'ease-in-out' })));
        anims.push(this.app.animate([{ opacity: 0 }, { opacity: 1 }], opts({ easing: 'ease-in-out' })));
        break;
      default:
        // a true crossfade: the old screen is opaque, so fading it out over the new one mixes the two
        anims.push(shell.animate([{ opacity: 1 }, { opacity: 0 }], opts({ easing: 'ease-in-out' })));
    }
    run.anims = anims;
    clearTimeout(run.timer);
    run.timer = setTimeout(() => this.finish(), ms + 600);
    void Promise.all(anims.map((a) => a.finished)).then(
      () => this.run === run && this.finish(),
      () => undefined,
    );
  }

  /** End the running animation now (the new screen is put in place if it is not yet). */
  finish(): void {
    const r = this.run;
    if (!r) return;
    this.run = null;
    clearTimeout(r.timer);
    for (const a of r.anims) {
      try {
        a.cancel();
      } catch { /* ignore */ }
    }
    r.overlay?.remove();
    if (r.gl) {
      r.gl.stopDissolve();
      r.gl.holdRects(false);
    }
    const pending = r.pending;
    r.pending = null;
    try {
      pending?.();
    } finally {
      this.onDone?.();
    }
  }

  /** The light switch: #app fades out, the new screen goes in, #app fades back in (half of `ms` each). */
  private fade(ms: number, apply: () => void): void {
    const half = Math.max(1, Math.round(ms / 2));
    const out = this.app.animate([{ opacity: 1 }, { opacity: 0 }], { duration: half, easing: 'ease-in', fill: 'forwards' });
    const run: Running = { overlay: null, anims: [out], gl: null, pending: apply, timer: setTimeout(() => this.finish(), ms + 600) };
    this.run = run;
    void out.finished.then(() => {
      if (this.run !== run) return;
      const put = run.pending;
      run.pending = null;
      try {
        put?.();
      } catch (e) {
        console.warn('[switch] render failed', e);
      }
      const back = this.app.animate([{ opacity: 0 }, { opacity: 1 }], { duration: half, easing: 'ease-out', fill: 'backwards' });
      run.anims = [back];
      try {
        out.cancel();
      } catch { /* ignore */ }
      void back.finished.then(() => this.run === run && this.finish(), () => undefined);
    }, () => undefined);
  }

  private glOn(): SwitchGL | null {
    const gl = this.gl();
    return gl && document.documentElement.classList.contains('gl') ? gl : null;
  }

  /**
   * The overlay with a still copy of #app (and of the GL frame when given), drawn in its own blank iframe so it keeps
   * the root classes and variables it has now. `ready` settles once its images and fonts can be drawn.
   */
  private snapshot(glShot: HTMLCanvasElement | null, opaque: boolean): { overlay: HTMLElement; ready: Promise<unknown> } {
    const app = this.app;
    const clone = app.cloneNode(true) as HTMLElement;
    const src = [app, ...Array.from(app.querySelectorAll<HTMLElement>('*'))];
    const dst = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
    const scrolled: [number, number, number][] = [];
    const canvases: [number, HTMLCanvasElement][] = [];
    const animated = new Set<Element>();
    for (const a of app.getAnimations({ subtree: true })) {
      const t = (a.effect as KeyframeEffect | null)?.target;
      if (t) animated.add(t);
    }
    for (let i = 0; i < dst.length; i++) {
      const s = src[i];
      const d = dst[i];
      if (!d || !s) break;
      if (s.scrollTop || s.scrollLeft) scrolled.push([i, s.scrollTop, s.scrollLeft]);
      if (animated.has(s)) {
        // the copy has no animations: keep the frame they are at now
        const cs = getComputedStyle(s);
        d.style.transform = cs.transform === 'none' ? '' : cs.transform;
        d.style.opacity = cs.opacity;
      }
      if (s instanceof HTMLCanvasElement && s.width && s.height) canvases.push([i, s]);
      else if (d instanceof HTMLImageElement) d.removeAttribute('loading');
      // a web widget is not loaded again for a still copy (an empty frame of the same size stands in)
      else if (d instanceof HTMLIFrameElement) d.removeAttribute('src');
      else if (d instanceof HTMLMediaElement) {
        d.muted = true;
        d.removeAttribute('autoplay');
      }
    }
    clone.classList.remove('booting');
    const overlay = document.createElement('div');
    overlay.className = 'switch-shot';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    const shell = document.createElement('div');
    shell.className = 'switch-shot__shell';
    const inner = document.createElement('div');
    inner.className = 'switch-shot__inner';
    if (glShot) inner.appendChild(glLayer(glShot));
    // no GL copy: the page background makes the old screen opaque
    else if (opaque) inner.style.background = getComputedStyle(document.body).backgroundColor;
    const frame = document.createElement('iframe');
    frame.className = 'switch-shot__frame';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    // the same color scheme inside and out, or the browser paints the frame opaque
    const scheme = getComputedStyle(document.documentElement).colorScheme || 'normal';
    Object.assign(frame.style, { width: `${window.innerWidth}px`, height: `${window.innerHeight}px`, colorScheme: scheme });
    inner.appendChild(frame);
    shell.appendChild(inner);
    overlay.appendChild(shell);
    app.after(overlay);
    const doc = frame.contentDocument;
    if (!doc) throw new Error('no frame document');
    const root = document.documentElement;
    const attrs = (el: HTMLElement) => `class="${esc(el.className)}" style="${esc(el.getAttribute('style') ?? '')}"`;
    doc.open();
    doc.write(
      `<!doctype html><html ${attrs(root)} lang="${esc(root.lang)}"><head><meta charset="utf-8"><style>${pageCss()}</style>` +
        `<style>:root{color-scheme:${scheme}!important}html,body{background:transparent!important}*,*::before,*::after{animation:none!important;transition:none!important}</style>` +
        `</head><body ${attrs(document.body)}>${clone.outerHTML}</body></html>`,
    );
    doc.close();
    // the copy of #app, in the same order as src/dst
    const base = doc.body.firstElementChild as HTMLElement | null;
    const nodes = base ? [base, ...Array.from(base.querySelectorAll<HTMLElement>('*'))] : [];
    for (const [i, c] of canvases) {
      const d = nodes[i];
      if (!(d instanceof HTMLCanvasElement)) continue;
      d.width = c.width;
      d.height = c.height;
      try {
        d.getContext('2d')?.drawImage(c, 0, 0);
      } catch { /* a canvas we cannot read stays empty */ }
    }
    for (const [i, top, left] of scrolled) {
      const d = nodes[i];
      if (!d) continue;
      d.scrollTop = top;
      d.scrollLeft = left;
    }
    const imgs = Array.from(doc.images).map((img) => (img.complete ? null : img.decode().catch(() => undefined)));
    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
    const ready = Promise.all([...imgs, fonts ? fonts.ready : null]);
    return { overlay, ready };
  }
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The text of every stylesheet of the page (same origin), for the copy's own document. */
function pageCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin
    }
    if (!rules) continue;
    const media = sheet.media?.mediaText;
    const text = Array.from(rules, (r) => r.cssText).join('\n');
    out.push(media && media !== 'all' ? `@media ${media}{${text}}` : text);
  }
  return out.join('\n').replace(/<\/style/gi, '<\\/style');
}

function glLayer(c: HTMLCanvasElement): HTMLCanvasElement {
  c.className = 'switch-shot__gl';
  return c;
}

/**
 * Size the wipe shell: wide enough to hold the soft diagonal edge left of the screen at the start and right of it
 * at the end, with the content (inner) placed back on the viewport. Returns how far the shell travels (px).
 */
function wipeGeometry(shell: HTMLElement, inner: HTMLElement): number {
  const vw = window.innerWidth || 1920;
  const vh = window.innerHeight || 1080;
  const feather = Math.round(vw * 0.08);
  // horizontal reach of the tilted edge (about 14 degrees off vertical) plus the soft band
  const m = Math.round(vh * 0.25) + feather;
  const w = 2 * (vw + m);
  shell.classList.add('is-wipe');
  Object.assign(shell.style, { left: `${-(vw + 2 * m)}px`, width: `${w}px`, right: 'auto' });
  shell.style.setProperty('--feather', `${feather}px`);
  Object.assign(inner.style, { left: `${vw + 2 * m}px`, width: `${vw}px`, right: 'auto' });
  return vw + 2 * m;
}
