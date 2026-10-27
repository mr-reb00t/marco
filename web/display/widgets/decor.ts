// Over the whole screen (#24): the owner's HTML overlays (screen.overlays) and the built-in seasonal decorations
// (screen.decoration). Both sit above the dashboard and below night dimming, alerts, the doorbell and every other
// system layer (styles.css, #decor and .html-overlay), and neither takes a tap.
//
// An overlay is never put in this page. Each one whose dates hold goes in an <iframe sandbox="" srcdoc> of its own: an opaque origin with no scripts,
// forms, popups, navigation of the screen or storage, so it cannot reach the display key or anything else here. A meta
// CSP in the document also stops every request but images (https and data:) and keeps out frames, fonts and other
// files. The frame is transparent and has the same colour scheme as its document, else Chromium paints a backdrop.
//
// The decorations are Marco's own DOM and CSS (no files): a strand of lights along the top edge, with snow for
// Christmas, a few bats, two cobwebs and a spider for Halloween, a short shower of confetti now and then for New Year. Calm (lite,
// "Ahorro", reduced motion) keeps the lights still, the spider at home, and leaves out the snow and the confetti.
import type { ScreenConfig } from '../../shared/types';
import { decorationOn, OVERLAYS_MAX, overlayShown } from '../../../server/core/decorCore.js';

export const OVERLAY_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-src 'none'; form-action 'none'";

/** The frame's whole document: Marco's base rules first (transparent, no margin, nothing scrolls), then the owner's HTML. */
export function overlayDocument(html: string, scheme: 'dark' | 'light'): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${OVERLAY_CSP}">` +
    `<meta name="referrer" content="no-referrer">` +
    `<style>:root{color-scheme:${scheme}}html,body{margin:0;padding:0;background:transparent;width:100%;height:100%;overflow:hidden}</style>` +
    `</head><body>${html}</body></html>`
  );
}

const XMAS = ['#e74c3c', '#2ecc71', '#f1c40f', '#3498db'];
const SPOOKY = ['#ff7a1a', '#9b59ff', '#ff7a1a', '#7dff5a'];
const NEWYEAR = ['#ffd76a', '#f4f4f8', '#ffb347', '#d9c8ff'];
const CONFETTI = ['#ffd76a', '#ff6b8b', '#6bd5ff', '#b6ff6b', '#ffffff', '#c9a2ff'];
const SVG_NS = 'http://www.w3.org/2000/svg';

/** A tiny repeatable pseudo-random sequence (the same flakes and confetti on every redraw). */
function seq(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function el(tag: string, cls: string, style = ''): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (style) e.setAttribute('style', style);
  return e;
}

/** The wire: scallops from bulb to bulb, the bulbs hang at the low points. */
function strand(n: number, colors: string[]): HTMLElement {
  const box = el('div', 'decor-strand');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'decor-wire');
  svg.setAttribute('viewBox', `0 0 ${n * 10} 10`);
  svg.setAttribute('preserveAspectRatio', 'none');
  let d = 'M0,1.5';
  for (let i = 0; i < n; i++) d += ` Q${i * 10 + 5},9.5 ${i * 10 + 10},1.5`;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(path);
  box.appendChild(svg);
  for (let i = 0; i < n; i++) {
    const c = colors[i % colors.length];
    box.appendChild(el('i', 'decor-bulb', `left:${(((i + 0.5) / n) * 100).toFixed(3)}%;--c:${c};--d:${(1.6 + (i % 4) * 0.45).toFixed(2)}s;--o:${((i * 0.37) % 1.3).toFixed(2)}s`));
  }
  return box;
}

function snow(): HTMLElement {
  const box = el('div', 'decor-snow');
  const r = seq(7);
  for (let i = 0; i < 16; i++) {
    const size = 0.35 + r() * 0.45;
    box.appendChild(el('i', 'decor-flake', `left:${(r() * 100).toFixed(2)}%;--s:${size.toFixed(2)};--d:${(14 + r() * 12).toFixed(1)}s;--o:${(-r() * 26).toFixed(1)}s;--x:${(r() * 6 - 3).toFixed(1)}`));
  }
  return box;
}

function confetti(): HTMLElement {
  const box = el('div', 'decor-confetti');
  const r = seq(11);
  for (let i = 0; i < 26; i++) {
    box.appendChild(el('i', 'decor-bit', `left:${(r() * 100).toFixed(2)}%;--c:${CONFETTI[i % CONFETTI.length]};--o:${(r() * 2.5).toFixed(2)}s;--r:${Math.round(r() * 720 - 360)}deg;--x:${(r() * 8 - 4).toFixed(1)}`));
  }
  return box;
}

const BAT = 'M12 7c-1-2-3-2.6-4.4-1.6.6.2 1 .8 1 1.5-1.4-.8-3.4-.6-4.6.6.8 0 1.6.4 2 1C3.8 8 2 8.6 1 10c1.6-.6 3.4-.4 4.6.4C6.4 9.6 8 9.6 9 10.4c.6-.8 1.6-1.2 3-1.2s2.4.4 3 1.2c1-.8 2.6-.8 3.4 0 1.2-.8 3-1 4.6-.4-1-1.4-2.8-2-5-1.4.4-.6 1.2-1 2-1-1.2-1.2-3.2-1.4-4.6-.6 0-.7.4-1.3 1-1.5C15 4.4 13 5 12 7z';

/** A cobweb in the top or bottom right corner of a 100x100 box: threads out from the corner, rings sagging towards it. */
function cobweb(cls: string, edge: 'top' | 'bottom', angles: number[], rings: number[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 100 100');
  const y = (v: number) => (edge === 'top' ? v : 100 - v);
  const sag = edge === 'top' ? -3 : 3;
  let d = '';
  for (const a of angles) {
    const rad = (a * Math.PI) / 180;
    d += `M100,${y(0)} L${(100 - Math.cos(rad) * 100).toFixed(1)},${y(Math.sin(rad) * 100).toFixed(1)} `;
  }
  for (const rr of rings) {
    const pts = angles.map((a) => {
      const rad = (a * Math.PI) / 180;
      return [100 - Math.cos(rad) * rr, y(Math.sin(rad) * rr)];
    });
    d += `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} `;
    for (let i = 1; i < pts.length; i++) d += `Q${((pts[i - 1][0] + pts[i][0]) / 2 + 3).toFixed(1)},${((pts[i - 1][1] + pts[i][1]) / 2 + sag).toFixed(1)} ${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)} `;
  }
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d.trim());
  svg.appendChild(p);
  return svg;
}

/** Head up, centred at (20,22) in a 40x40 box; two sets of legs that twitch in turn. */
function spider(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'decor-spider');
  svg.setAttribute('viewBox', '0 0 40 40');
  const left = ['M17,15 Q9,8 6,2', 'M16,18 Q7,14 2,12', 'M16,22 Q7,24 3,30', 'M17,25 Q10,32 8,38'];
  const mirror = (d: string) => d.replace(/(\d+(?:\.\d+)?),/g, (_, x) => `${40 - Number(x)},`);
  const legs = (cls: string, ds: string[]) => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', cls);
    for (const d of ds) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      g.appendChild(p);
    }
    svg.appendChild(g);
  };
  legs('decor-legs-a', [left[0], left[2], mirror(left[1]), mirror(left[3])]);
  legs('decor-legs-b', [left[1], left[3], mirror(left[0]), mirror(left[2])]);
  const body = (tag: string, attrs: Record<string, string>) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.appendChild(e);
  };
  body('ellipse', { class: 'decor-spider-body', cx: '20', cy: '26', rx: '6.5', ry: '8' });
  body('circle', { class: 'decor-spider-body', cx: '20', cy: '15', r: '4.5' });
  body('circle', { class: 'decor-spider-eye', cx: '18.3', cy: '13.4', r: '1.3' });
  body('circle', { class: 'decor-spider-eye', cx: '21.7', cy: '13.4', r: '1.3' });
  return svg;
}

/** The bite: a half oval standing on the bottom edge with tooth marks round it, in the screen's background colour (left
 *  open along the edge, so only the tooth marks get the rim). */
function bite(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'decor-bite');
  svg.setAttribute('viewBox', '0 0 80 50');
  const n = 9;
  const at = (i: number) => {
    const a = Math.PI - (i / n) * Math.PI;
    return [40 + Math.cos(a) * 38, 50 - Math.sin(a) * 46];
  };
  let d = 'M2,50';
  for (let i = 1; i <= n; i++) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    // each tooth mark bulges in, towards the middle of the bite
    d += ` Q${(40 + ((x0 + x1) / 2 - 40) * 0.84).toFixed(1)},${(50 + ((y0 + y1) / 2 - 50) * 0.84).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}

function bats(): HTMLElement {
  const box = el('div', 'decor-bats');
  [
    ['13%', '2.8', '0s'],
    ['41%', '2.2', '-2.4s'],
    ['67%', '2.5', '-1.2s'],
  ].forEach(([left, s, o]) => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'decor-bat');
    svg.setAttribute('viewBox', '0 0 24 14');
    svg.setAttribute('style', `left:${left};--s:${s};--o:${o}`);
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', BAT);
    svg.appendChild(p);
    box.appendChild(svg);
  });
  box.appendChild(cobweb('decor-web', 'top', [0, 22.5, 45, 67.5, 90], [28, 52, 76]));
  // a bigger one in the bottom right corner, and its spider: it sits in the web, now and then walks out along the
  // bottom edge, takes a bite out of the screen and goes home, and the bite heals (60 s, styles.css)
  box.appendChild(cobweb('decor-cornerweb', 'bottom', [0, 15, 30, 45, 60, 75, 90], [16, 32, 50, 68, 88]));
  box.appendChild(bite());
  box.appendChild(spider());
  return box;
}

export interface DecorEnv {
  /** lite, "Ahorro" or reduced motion: still lights, no snow or confetti */
  calm: boolean;
  light: boolean;
  /** strand length: fewer bulbs on a portrait screen */
  portrait: boolean;
}

export class ScreenDecor {
  private frames: HTMLIFrameElement[] = [];
  private frameDocs: string[] = [];
  private deco: HTMLElement | null = null;
  private decoKey = '';

  /** Draw what `screen` asks for on `today` (YYYY-MM-DD in the screen's time zone); cheap when nothing changed. */
  render(screen: ScreenConfig | null, today: string, env: DecorEnv): void {
    const shown = (screen?.overlays ?? []).filter((o) => overlayShown(o, today)).slice(0, OVERLAYS_MAX);
    this.renderOverlays(
      shown.map((o) => o.html),
      env.light ? 'light' : 'dark'
    );
    const kind = screen ? decorationOn(screen.decoration, today) : null;
    this.renderDecoration(kind, !!screen?.decoration?.snow, env);
  }

  private anchor(): Node | null {
    return document.getElementById('night');
  }

  /** One sandboxed frame per overlay shown, in the order of the list (a later one draws over an earlier one). */
  private renderOverlays(htmls: string[], scheme: 'dark' | 'light'): void {
    const docs = htmls.map((h) => overlayDocument(h, scheme));
    if (docs.length === this.frameDocs.length && docs.every((d, i) => d === this.frameDocs[i])) return;
    this.frameDocs = docs;
    for (const f of this.frames) {
      f.srcdoc = '';
      f.remove();
    }
    this.frames = docs.map((doc) => {
      const f = document.createElement('iframe');
      f.className = 'html-overlay';
      f.setAttribute('sandbox', '');
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.setAttribute('allow', '');
      f.setAttribute('allowtransparency', 'true');
      f.setAttribute('loading', 'eager');
      f.setAttribute('aria-hidden', 'true');
      f.setAttribute('title', '');
      f.tabIndex = -1;
      f.style.colorScheme = scheme;
      f.srcdoc = doc;
      document.body.insertBefore(f, this.anchor());
      return f;
    });
  }

  private renderDecoration(kind: string | null, wantSnow: boolean, env: DecorEnv): void {
    const key = kind ? `${kind}|${wantSnow && kind === 'christmas'}|${env.calm}|${env.light}|${env.portrait}` : '';
    if (key === this.decoKey) return;
    this.decoKey = key;
    this.deco?.remove();
    this.deco = null;
    if (!kind) return;
    const d = el('div', `decor decor--${kind}${env.calm ? ' is-calm' : ''}${env.light ? ' is-light' : ''}`);
    d.id = 'decor';
    d.setAttribute('aria-hidden', 'true');
    const n = env.portrait ? 12 : 20;
    d.appendChild(strand(n, kind === 'christmas' ? XMAS : kind === 'halloween' ? SPOOKY : NEWYEAR));
    if (kind === 'christmas' && wantSnow && !env.calm) d.appendChild(snow());
    if (kind === 'halloween') d.appendChild(bats());
    if (kind === 'newyear' && !env.calm) d.appendChild(confetti());
    document.body.insertBefore(d, this.anchor());
    this.deco = d;
  }
}
