// "Efecto del tiempo" over a Personalizado photo card with photos of its own (#41): rain, snow, fog or sun drawn over
// that card only. The card is part of the page, above the WebGL canvas the screen's photo effect is drawn on, so it
// gets a light layer of its own instead: one element per card, a pattern built once, moved with CSS transforms only
// (the compositor runs it, no timers, and it stops while the page is hidden). Nothing is made while the effect is off
// or the weather has nothing to show. 'simple' is rain and snow; 'rich' adds fog and sun (no drops on the glass: that
// needs the WebGL photo).
import type { WeatherFxPlan } from './icons';

export interface CardWeather {
  /** Show the weather of `plan` with effect `fx` ('off' or no plan: nothing). */
  set(plan: WeatherFxPlan | null, fx: string): void;
  destroy(): void;
}

/** The same pattern on every screen (screenshots): a small seeded random. */
function seq(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TILE = 200;
let rainTile = '';
let snowTile = '';

/** Thin slanted streaks, as a data URI (built once per page). */
function rain(): string {
  if (rainTile) return rainTile;
  const r = seq(41);
  let d = '';
  for (let i = 0; i < 26; i++) {
    const x = r() * TILE, y = r() * TILE, len = 14 + r() * 18;
    d += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - len * 0.12).toFixed(1)}" y2="${(y + len).toFixed(1)}" stroke-opacity="${(0.25 + r() * 0.45).toFixed(2)}"/>`;
    // the same streak one tile higher, so one cut by the tile's bottom goes on at its top
    if (y + len > TILE) d += `<line x1="${x.toFixed(1)}" y1="${(y - TILE).toFixed(1)}" x2="${(x - len * 0.12).toFixed(1)}" y2="${(y + len - TILE).toFixed(1)}" stroke-opacity="0.4"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><g stroke="#dfe9ff" stroke-width="1.4" stroke-linecap="round">${d}</g></svg>`;
  return (rainTile = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
}

/** Soft flakes of a few sizes, as a data URI (built once per page). */
function snow(): string {
  if (snowTile) return snowTile;
  const r = seq(73);
  let d = '';
  for (let i = 0; i < 22; i++) {
    const x = r() * TILE, y = r() * TILE, rad = 1.2 + r() * 2.4;
    d += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}" fill-opacity="${(0.45 + r() * 0.5).toFixed(2)}"/>`;
    if (y + rad > TILE) d += `<circle cx="${x.toFixed(1)}" cy="${(y - TILE).toFixed(1)}" r="${rad.toFixed(1)}" fill-opacity="0.6"/>`;
    if (y - rad < 0) d += `<circle cx="${x.toFixed(1)}" cy="${(y + TILE).toFixed(1)}" r="${rad.toFixed(1)}" fill-opacity="0.6"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><g fill="#ffffff">${d}</g></svg>`;
  return (snowTile = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
}

/** What the card shows for `plan` with effect `fx`: 'rain', 'snow', 'fog', 'sun' or '' (nothing). */
export function cardWeatherMode(plan: WeatherFxPlan | null, fx: string): string {
  if (!plan?.mode || (fx !== 'simple' && fx !== 'rich')) return '';
  if (plan.mode === 'rain' || plan.mode === 'snow') return plan.mode;
  return fx === 'rich' ? plan.mode : '';
}

/** The effect layer of one photo card, in `root` (the card body), under the caption. */
export function mountCardWeather(root: HTMLElement): CardWeather {
  let el: HTMLElement | null = null;
  let layer: HTMLElement | null = null;
  let shown = '';
  return {
    set(plan, fx) {
      const mode = cardWeatherMode(plan, fx);
      if (!mode) {
        el?.remove();
        el = layer = null;
        shown = '';
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.className = 'cv-phfx';
        el.setAttribute('aria-hidden', 'true');
        layer = document.createElement('div');
        layer.className = 'cv-phfx__l';
        el.appendChild(layer);
        root.insertBefore(el, root.querySelector('.cv-ph-cap'));
      }
      if (mode !== shown) {
        el.dataset.wx = mode;
        // the pattern twice, the second at half size and shifted (a far layer): no visible repeat, still one element
        const tile = mode === 'rain' ? rain() : mode === 'snow' ? snow() : '';
        layer!.style.backgroundImage = tile ? `${tile}, ${tile}` : '';
        shown = mode;
      }
      el.style.setProperty('--wx-level', String(Math.min(1, Math.max(0.2, plan?.level ?? 0.6))));
      el.toggleAttribute('data-storm', !!plan?.storm && mode === 'rain');
    },
    destroy() {
      el?.remove();
      el = layer = null;
      shown = '';
    },
  };
}
