// Over the whole screen (#24): the owner's HTML overlay (screen.overlay) and the built-in seasonal decorations
// (screen.decoration). Both sit above the dashboard and below night dimming, alerts, the doorbell and every other
// system layer (styles.css, #decor and #html-overlay), and neither takes a tap.
//
// The overlay is never put in this page. It goes in <iframe sandbox="" srcdoc>: an opaque origin with no scripts,
// forms, popups, navigation of the screen or storage, so it cannot reach the display key or anything else here. A meta
// CSP in the document also stops every request but images (https and data:) and keeps out frames, fonts and other
// files. The frame is transparent and has the same colour scheme as its document, else Chromium paints a backdrop.
//
// The decorations are Marco's own DOM and CSS (no files): a strand of lights along the top edge, with snow for
// Christmas, a few bats and a cobweb for Halloween, a short shower of confetti now and then for New Year. Calm (lite,
// "Ahorro", reduced motion) keeps the lights still and leaves out the snow and the confetti.
import type { ScreenConfig } from '../../shared/types';
import { decorationOn, overlayShown } from '../../../server/core/decorCore.js';

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
  // a small cobweb in the top right corner
  const web = document.createElementNS(SVG_NS, 'svg');
  web.setAttribute('class', 'decor-web');
  web.setAttribute('viewBox', '0 0 100 100');
  let d = '';
  for (const a of [0, 22.5, 45, 67.5, 90]) {
    const rad = (a * Math.PI) / 180;
    d += `M100,0 L${(100 - Math.cos(rad) * 100).toFixed(1)},${(Math.sin(rad) * 100).toFixed(1)} `;
  }
  for (const rr of [28, 52, 76]) {
    const pts = [0, 22.5, 45, 67.5, 90].map((a) => {
      const rad = (a * Math.PI) / 180;
      return [100 - Math.cos(rad) * rr, Math.sin(rad) * rr];
    });
    d += `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} `;
    for (let i = 1; i < pts.length; i++) d += `Q${((pts[i - 1][0] + pts[i][0]) / 2 + 3).toFixed(1)},${((pts[i - 1][1] + pts[i][1]) / 2 - 3).toFixed(1)} ${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)} `;
  }
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d.trim());
  web.appendChild(p);
  box.appendChild(web);
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
  private frame: HTMLIFrameElement | null = null;
  private frameDoc = '';
  private deco: HTMLElement | null = null;
  private decoKey = '';

  /** Draw what `screen` asks for on `today` (YYYY-MM-DD in the screen's time zone); cheap when nothing changed. */
  render(screen: ScreenConfig | null, today: string, env: DecorEnv): void {
    this.renderOverlay(screen && overlayShown(screen.overlay, today) ? screen.overlay!.html : '', env.light ? 'light' : 'dark');
    const kind = screen ? decorationOn(screen.decoration, today) : null;
    this.renderDecoration(kind, !!screen?.decoration?.snow, env);
  }

  private anchor(): Node | null {
    return document.getElementById('night');
  }

  private renderOverlay(html: string, scheme: 'dark' | 'light'): void {
    const doc = html ? overlayDocument(html, scheme) : '';
    if (doc === this.frameDoc) return;
    this.frameDoc = doc;
    if (this.frame) {
      this.frame.srcdoc = '';
      this.frame.remove();
      this.frame = null;
    }
    if (!doc) return;
    const f = document.createElement('iframe');
    f.id = 'html-overlay';
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
    this.frame = f;
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
