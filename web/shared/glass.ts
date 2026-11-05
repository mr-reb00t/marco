// Glass material of the Modern display style (screen.glass), shared by the display and the admin preview.
// Everything ends up as a handful of CSS custom properties on <html>: no extra layers, no extra backdrop-filters.
import type { CanvasConfig, GlassConfig } from './types';

export const GLASS_DEFAULTS: GlassConfig = { appearance: 'auto', opacity: 0.5, blur: 18, tint: 'dark', edge: true };

export function normalizeGlass(raw: unknown): GlassConfig {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Partial<GlassConfig>;
  const n = (v: unknown, min: number, max: number, d: number) => {
    const x = Number(v);
    return v === null || v === undefined || v === '' || !Number.isFinite(x) ? d : Math.min(max, Math.max(min, x));
  };
  return {
    appearance: g.appearance === 'clear' || g.appearance === 'tinted' ? g.appearance : 'auto',
    opacity: n(g.opacity, 0, 1, GLASS_DEFAULTS.opacity),
    blur: Math.round(n(g.blur, 0, 40, GLASS_DEFAULTS.blur)),
    tint: g.tint === 'light' || g.tint === 'photo' ? g.tint : 'dark',
    edge: g.edge !== false,
  };
}

/** What the display knows about the current photo (bottom half, where most cards sit). */
export interface PhotoStats {
  /** 0 = dark & calm, 1 = bright & busy (same measure as --tone-bottom). */
  tone: number;
  /** Dominant colour (saturation-weighted average), 0..255. */
  rgb: [number, number, number];
}

export interface GlassVars {
  vars: Record<string, string>;
  /** The card background ends up light: text inside the cards turns dark. */
  inkDark: boolean;
  /** Very see-through glass: the text inside gets a soft shadow so it stays readable over bright photos. */
  thin: boolean;
  edge: boolean;
}

const DARK: [number, number, number] = [22, 22, 26];
const DARK_SOLID: [number, number, number] = [28, 28, 32];
const LIGHT: [number, number, number] = [246, 246, 250];

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** A deep, calm version of the photo's colour, the way iOS tints a widget from the wallpaper. */
export function tintFromPhoto(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l0 = (max + min) / 2;
  const s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  const s = clamp(s0 * 0.75, 0, 0.5);
  const l = 0.17;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r1, g1, b1].map((v) => Math.round((v + m) * 255)) as [number, number, number];
}

/**
 * Turn the settings (+ the current photo) into CSS custom properties.
 * Defaults reproduce the original Modern look exactly:
 *   card    rgb(22 22 26 / min(0.9, (0.24 + tone * 0.24) * shade)), shade = opacity * 2
 *   weather rgb(22 22 26 / min(0.9, (0.18 + tone * 0.2) * shade))
 *   lite    rgb(28 28 32 / min(0.94, 0.62 * shade + 0.12)), weather min(0.94, (0.5 + tone * 0.2) * shade)
 */
export function glassVars(raw: GlassConfig | undefined, photo: PhotoStats | null, opts: { lite: boolean; hasPhoto: boolean }): GlassVars {
  const g = normalizeGlass(raw);
  const tone = photo ? clamp(photo.tone) : 0.5;
  const shade = g.opacity * 2;
  // appearance: how much of the photo shows through, and how much that follows the photo's brightness
  const A = {
    auto: { a0: 0.24, k: 0.24, w0: 0.18, wk: 0.2, lite: 1, sat: 1.8 },
    clear: { a0: 0.08, k: 0.04, w0: 0.06, wk: 0.03, lite: 0.72, sat: 2 },
    tinted: { a0: 0.46, k: 0.1, w0: 0.4, wk: 0.1, lite: 1.14, sat: 1.5 },
  }[g.appearance];
  let card: number, wx: number;
  if (opts.lite) {
    card = Math.min(0.94, (0.62 * shade + 0.12) * A.lite);
    wx = Math.min(0.94, (0.5 + tone * 0.2) * shade * A.lite);
  } else {
    card = Math.min(0.9, (A.a0 + tone * A.k) * shade);
    wx = Math.min(0.9, (A.w0 + tone * A.wk) * shade);
  }
  // a white veil needs more body than a dark one before text on it reads well (iOS light materials are denser too)
  if (g.tint === 'light') {
    card = Math.min(0.92, card * 1.6);
    wx = Math.min(0.92, wx * 1.6);
  }
  const tintRgb: [number, number, number] =
    g.tint === 'light' ? LIGHT : g.tint === 'photo' && photo ? tintFromPhoto(photo.rgb) : opts.lite ? DARK_SOLID : DARK;
  // cards without a photo behind them are solid
  const solidRgb: [number, number, number] = g.tint === 'light' ? [242, 242, 247] : [28, 28, 30];
  // light glass carries dark text (as iOS does) once it has enough body; a thin light veil keeps white text
  const inkDark = g.tint === 'light' && (!opts.hasPhoto || (g.appearance !== 'clear' && Math.min(card, wx) >= 0.3));
  const blur = opts.lite ? 0 : g.blur;
  const sheetA = opts.lite ? Math.min(0.94, 0.86 * A.lite) : Math.min(0.9, 0.46 * shade * (g.appearance === 'clear' ? 0.6 : g.appearance === 'tinted' ? 1.3 : 1));
  const sheetRgb: [number, number, number] = g.tint === 'photo' && photo ? tintFromPhoto(photo.rgb) : [18, 18, 22];
  const rgb = (c: number[]) => c.join(' ');
  return {
    inkDark,
    thin: !inkDark && opts.hasPhoto && (g.appearance === 'clear' || card < 0.16),
    edge: g.edge,
    vars: {
      '--g-rgb': rgb(tintRgb),
      '--g-solid': rgb(solidRgb),
      '--g-a': card.toFixed(3),
      '--g-a-wx': wx.toFixed(3),
      '--g-filter': blur > 0 ? `blur(${(blur * 0.17).toFixed(2)}rem) saturate(${A.sat})` : 'none',
      '--g-sheet-rgb': rgb(sheetRgb),
      '--g-sheet-a': sheetA.toFixed(3),
      '--g-sheet-filter': blur > 0 ? `blur(${(blur * 0.222).toFixed(2)}rem) saturate(1.6)` : 'none',
      '--g-edge': g.appearance === 'clear' ? '1.5' : '1',
    },
  };
}

// ---- Photo on the whole screen (background.scope = 'screen') ----

/** Default of background.calendarOpacity. */
export const CALENDAR_OPACITY_DEFAULT = 0.5;

/** Default of background.calendarBlur (0..40, the same scale as the glass blur). */
export const CALENDAR_BLUR_DEFAULT = 18;

/**
 * Layouts where background.scope 'screen' changes something. The others already have the photo behind the whole
 * screen (left / right, big time, photo frame, board), or no photo at all (bedside, a full-screen widget).
 */
export const SCREEN_PHOTO_PRESETS = ['bigCalendar', 'twoWeeks', 'today', 'agenda', 'topBottom', 'people', 'planner', 'kidsRoutines', 'kidsFamily', 'kidsMeals', 'canvas'];

/** The background photo goes behind the whole screen on this layout. */
export function photoOnWholeScreen(bg: { enabled?: boolean; scope?: string } | undefined, preset: string): boolean {
  return !!bg?.enabled && bg.scope === 'screen' && SCREEN_PHOTO_PRESETS.includes(preset);
}

/**
 * Alpha of the calendar glass over a full-screen photo, from background.calendarOpacity (0..1).
 * Never fully see-through: the lowest setting still keeps the text readable over a bright photo. A light sheet needs
 * more body than a dark one before dark text on it reads well, and with no blur (lite mode, a Raspberry Pi) the
 * photo behind is sharp, so the sheet is denser there too.
 */
export function calendarSheetAlpha(raw: unknown, opts: { light: boolean; lite: boolean }): number {
  const x = Number(raw);
  const v = raw === null || raw === undefined || raw === '' || !Number.isFinite(x) ? CALENDAR_OPACITY_DEFAULT : clamp(x);
  const [lo, hi] = opts.light ? (opts.lite ? [0.66, 0.96] : [0.56, 0.95]) : opts.lite ? [0.5, 0.94] : [0.24, 0.9];
  return Math.round((lo + (hi - lo) * v) * 1000) / 1000;
}

/**
 * The background a Personalizado screen (layout 'canvas') really shows, from its own canvas.background: the slideshow
 * behind the whole screen ('photo'), only in the sidebar (sidebar fill 'photo'), or none ('ambient', 'solid').
 * The saved screen.background is never rewritten (its source, interval and the rest still apply), so going back to
 * another layout finds it as it was.
 */
export function effectiveBackground<B extends { enabled?: boolean; scope?: string }>(bg: B, canvas: Pick<CanvasConfig, 'background' | 'sidebar'> | null | undefined): B {
  if (!canvas) return bg;
  const photo = canvas.background === 'photo';
  const side = !photo && canvas.sidebar?.side !== 'none' && canvas.sidebar?.fill === 'photo';
  return { ...bg, enabled: photo || side, scope: photo ? 'screen' : 'side' };
}

/**
 * "Mostrar fotos de fondo" on a Personalizado screen: turned off, the photo leaves the whole screen and the sidebar
 * (Animado and a glass sidebar instead); turned on with none, it goes behind the whole screen. The canvas is changed in
 * place, the saved screen.background is not (effectiveBackground).
 */
export function setCanvasPhoto(canvas: Pick<CanvasConfig, 'background' | 'sidebar'>, on: boolean): void {
  if (!on) {
    if (canvas.background === 'photo') canvas.background = 'ambient';
    if (canvas.sidebar.fill === 'photo') canvas.sidebar.fill = 'glass';
  } else if (!effectiveBackground({ enabled: false }, canvas).enabled) {
    canvas.background = 'photo';
    if (canvas.sidebar.fill === 'photo') canvas.sidebar.fill = 'glass';
  }
}
