// Where the grid cells and the sidebar slots are on the screen, in the screen's own pixels (1920×1080 or 1080×1920, or
// the window of a connected screen of another shape),
// so the builder's overlay can draw them over the scaled preview and turn a pointer into a cell. The display reports
// the real boxes ('marco:canvas-rects', web/display/main.ts); until it does, the same CSS rules are worked out here.
import type { CanvasConfig, CanvasPos } from '../../shared/types';
import { SIDEBAR_SHARE, SIDE_UNITS } from '../../../server/core/canvasCore.js';
import { boxCells, grid, sideOf, type Orient } from './model';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface GridBox extends Box {
  /** gap between columns and between rows */
  gx: number;
  gy: number;
}
export interface Geometry {
  W: number;
  H: number;
  main: GridBox;
  side: GridBox | null;
  /** the sidebar runs across the screen (top or bottom) */
  row: boolean;
  /** the sidebar's whole strip, padding included */
  strip: Box | null;
}

/** The display's root size unit (styles.css --u) for a screen of W×H and a font scale. */
export function remOf(W: number, H: number, fs = 1): number {
  return H > W * 1.05 ? fs * Math.min(0.0095 * W, 0.0054 * H) : fs * Math.min(0.00521 * W, 0.00926 * H);
}

/** The boxes as styles-canvas.css lays them out (used until the display reports its own). */
export function computeGeometry(cv: CanvasConfig, o: Orient, fs = 1, size?: { w: number; h: number } | null): Geometry {
  const W = size?.w ?? (o === 'portrait' ? 1080 : 1920);
  const H = size?.h ?? (o === 'portrait' ? 1920 : 1080);
  const rem = remOf(W, H, fs);
  const side = sideOf(cv, o);
  const share = SIDEBAR_SHARE[cv.sidebar.size] ?? SIDEBAR_SHARE.normal;
  let mainBox: Box = { x: 0, y: 0, w: W, h: H };
  let sideBox: Box | null = null;
  if (side === 'left' || side === 'right') {
    const sw = Math.round(W * share);
    sideBox = { x: side === 'left' ? 0 : W - sw, y: 0, w: sw, h: H };
    mainBox = { x: side === 'left' ? sw : 0, y: 0, w: W - sw, h: H };
  } else if (side === 'top' || side === 'bottom') {
    const sh = Math.round(H * share);
    sideBox = { x: 0, y: side === 'top' ? 0 : H - sh, w: W, h: sh };
    mainBox = { x: 0, y: side === 'top' ? sh : 0, w: W, h: H - sh };
  }
  const pad = (b: Box, px: number, py: number, g: number): GridBox => ({ x: b.x + px, y: b.y + py, w: b.w - 2 * px, h: b.h - 2 * py, gx: g, gy: g });
  const row = side === 'top' || side === 'bottom';
  // "Densidad compacta": the gaps and the padding of styles-canvas.css .cv-dense
  const dense = cv.density === 'compact';
  const gap = (dense ? 0.6 : 1.2) * rem;
  const edge = (dense ? 1.4 : 2.4) * rem;
  const edgeX = (dense ? 1.2 : 2) * rem;
  return {
    W, H, row, strip: sideBox,
    main: pad(mainBox, edge, edge, gap),
    side: sideBox ? (row ? pad(sideBox, edge, edgeX, gap) : pad(sideBox, edgeX, edge, gap)) : null,
  };
}

/** The box of cells (x, y, w, h) on the main grid. */
export function cellBox(g: Geometry, o: Orient, x: number, y: number, w: number, h: number): Box {
  const { cols, rows } = grid(o);
  const cw = (g.main.w - g.main.gx * (cols - 1)) / cols;
  const ch = (g.main.h - g.main.gy * (rows - 1)) / rows;
  return { x: g.main.x + x * (cw + g.main.gx), y: g.main.y + y * (ch + g.main.gy), w: w * cw + (w - 1) * g.main.gx, h: h * ch + (h - 1) * g.main.gy };
}

/** The cell under a point of the screen (clamped to the grid), and whether the point is inside the main grid. */
export function cellAt(g: Geometry, o: Orient, px: number, py: number): { x: number; y: number; inside: boolean } {
  const { cols, rows } = grid(o);
  const cw = (g.main.w - g.main.gx * (cols - 1)) / cols;
  const ch = (g.main.h - g.main.gy * (rows - 1)) / rows;
  const fx = (px - g.main.x + g.main.gx / 2) / (cw + g.main.gx);
  const fy = (py - g.main.y + g.main.gy / 2) / (ch + g.main.gy);
  const inside = px >= g.main.x - g.main.gx && px <= g.main.x + g.main.w + g.main.gx && py >= g.main.y - g.main.gy && py <= g.main.y + g.main.h + g.main.gy;
  return { x: Math.min(cols - 1, Math.max(0, Math.floor(fx))), y: Math.min(rows - 1, Math.max(0, Math.floor(fy))), inside };
}

/** The box of a main-grid position. */
export const mainBox = (g: Geometry, o: Orient, p: Extract<CanvasPos, { zone: 'main' }>): Box => {
  const [w, h] = boxCells(p, o);
  return cellBox(g, o, p.x, p.y, w, h);
};

/** Start and length (in units of the stack) of each sidebar item; the fill item takes what the others leave. */
export function sideTracks(list: { id: string; pos: Extract<CanvasPos, { zone: 'side' }> }[]): Map<string, { start: number; span: number }> {
  const fixed = list.reduce((n, x) => n + (x.pos.span === 'fill' ? 0 : x.pos.span), 0);
  const out = new Map<string, { start: number; span: number }>();
  let at = 0;
  for (const x of list) {
    const span = x.pos.span === 'fill' ? Math.max(0, SIDE_UNITS - fixed) : Math.min(x.pos.span, SIDE_UNITS - at);
    out.set(x.id, { start: at, span });
    at += span;
  }
  return out;
}

/** The box of units [start, start + span) of the sidebar stack. */
export function sideBox(g: Geometry, start: number, span: number): Box | null {
  const s = g.side;
  if (!s || span <= 0) return null;
  if (g.row) {
    const u = (s.w - s.gx * (SIDE_UNITS - 1)) / SIDE_UNITS;
    return { x: s.x + start * (u + s.gx), y: s.y, w: span * u + (span - 1) * s.gx, h: s.h };
  }
  const u = (s.h - s.gy * (SIDE_UNITS - 1)) / SIDE_UNITS;
  return { x: s.x, y: s.y + start * (u + s.gy), w: s.w, h: span * u + (span - 1) * s.gy };
}

/** Whether a point is on the sidebar (its whole strip, padding included). */
export function inSide(g: Geometry, px: number, py: number): boolean {
  const s = g.side;
  if (!s) return false;
  const m = Math.max(s.gx, s.gy) * 2;
  return px >= s.x - m && px <= s.x + s.w + m && py >= s.y - m && py <= s.y + s.h + m;
}

/** Index in the stack a point drops at: before the first item whose middle is past the point. */
export function sideIndexAt(g: Geometry, boxes: Box[], px: number, py: number): number {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (g.row ? px < b.x + b.w / 2 : py < b.y + b.h / 2) return i;
  }
  return boxes.length;
}
