// Personalizado builder: every change the editor makes to a screen's canvas, as pure functions (no DOM), so the
// mouse, touch and keyboard paths share one set of rules and the server tests can run them. Each operation takes a
// canvas and returns a new one (or a refusal), and never leaves two items on the same cells. The grid rules, the
// size table and validation live in server/core/canvasCore.js; this file only moves items around within them.
import type { CanvasConfig, CanvasGridId, CanvasItem, CanvasKind, CanvasPos, CanvasSize, SideSpan } from '../../shared/types';
import {
  CANVAS_KINDS, CANVAS_LIMITS, CANVAS_SIZE_IDS, SIDE_UNITS, boxOf, canvasCards, canvasDefaults, canvasGrid, cellRange, convertCanvasGrid, defaultItemStyle, deriveCanvasPortrait, fitsAt,
  firstFree, gridDims, gridFactor, kindFor, makeOccupancy, nearestFree, newCanvasId, occupy, portraitSide, posCells, sizeCells, type CanvasKindDef,
} from '../../../server/core/canvasCore.js';

export type Orient = 'landscape' | 'portrait';
/** The field of an item that holds its place on an orientation. */
export type PosKey = 'pos' | 'portrait';
export type MainPos = Extract<CanvasPos, { zone: 'main' }>;
export type SidePos = Extract<CanvasPos, { zone: 'side' }>;
/** Why an operation changed nothing. */
export type Refusal = 'noRoom' | 'noBigger' | 'sideFull' | 'tooMany' | 'kindCap' | 'noSide' | 'notInSide' | 'auto' | 'limit';
export type Result = { ok: true; cv: CanvasConfig; id?: string } | { ok: false; why: Refusal };

const ok = (cv: CanvasConfig, id?: string): Result => ({ ok: true, cv, id });
const no = (why: Refusal): Result => ({ ok: false, why });
const clone = (cv: CanvasConfig): CanvasConfig => structuredClone(cv);

export const keyOf = (o: Orient): PosKey => (o === 'portrait' ? 'portrait' : 'pos');
/** Portrait is drawn from the landscape arrangement (read-only in the editor) until the owner edits it. */
export const readOnly = (cv: CanvasConfig, o: Orient): boolean => o === 'portrait' && cv.portraitAuto;
/** The sidebar's side on an orientation (left and right go on top and at the bottom of a portrait screen). */
export const sideOf = (cv: CanvasConfig, o: Orient): CanvasConfig['sidebar']['side'] => (o === 'portrait' ? portraitSide(cv.sidebar.side) : cv.sidebar.side);
/** The grid of a canvas ("Cuadrícula": 'normal' 12×8, or 'fine' 24×16). Every cell count below is in its cells. */
export const gOf = (cv: Pick<CanvasConfig, 'grid'> | null | undefined): CanvasGridId => canvasGrid(cv);
export type GridId = CanvasGridId;
export const grid = (o: Orient, g: GridId = 'normal') => gridDims(o, g);
export const cellsOf = (size: CanvasSize, o: Orient, g: GridId = 'normal'): [number, number] => sizeCells(size, o, g) as [number, number];
/** A kind, or the sizing of an item (a Rotativa: what its cards allow too, canvasCore kindFor). */
export type KindRef = CanvasKind | string | CanvasKindDef;
const kind = (k: KindRef): CanvasKindDef => (typeof k === 'string' ? CANVAS_KINDS[k as CanvasKind] : k);
/** What an item is sized as (its kind; a Rotativa with cards: the range they leave it). */
export const sizingOf = (it: Pick<CanvasItem, 'kind' | 'props'>): CanvasKindDef => kindFor(it);

/**
 * The box of a card on the main grid: a named size, plus its own w and h in cells when it is not exactly one
 * (canvasCore boxOf: any w×h within the kind's range, cellRange).
 */
export type Box = { size: CanvasSize; w?: number; h?: number };
/** [w, h] of a box or a named size on `o`. */
export const boxCells = (b: Box | CanvasSize, o: Orient, g: GridId = 'normal'): [number, number] => (typeof b === 'string' ? cellsOf(b, o, g) : (posCells(b, o, g) as [number, number]));
/** A box as stored for `k` on `o` (a named size alone when it is exactly one). */
export const boxFor = (k: KindRef, w: number, h: number, o: Orient, g: GridId = 'normal'): Box => boxOf(k, w, h, o, g) as Box;
/** The box of a named size or a box, as a plain Box. */
const asBox = (b: Box | CanvasSize): Box => (typeof b === 'string' ? { size: b } : b.w !== undefined && b.h !== undefined ? { size: b.size, w: b.w, h: b.h } : { size: b.size });
/** The smallest and largest box of `k` on `o`. */
export const rangeOf = (k: KindRef, o: Orient, g: GridId = 'normal') => cellRange(k, o, g);
/** A main position at (x, y) with box `b`. */
const mainPos = (x: number, y: number, b: Box | CanvasSize): MainPos => ({ zone: 'main', x, y, ...asBox(b) });
/** True when two boxes take the same cells. */
const sameCells = (a: Box | CanvasSize, b: Box | CanvasSize, o: Orient, g: GridId) => {
  const [aw, ah] = boxCells(a, o, g);
  const [bw, bh] = boxCells(b, o, g);
  return aw === bw && ah === bh;
};

/** Where each item sits on `o` (portrait: derived while portraitAuto). Items left out of the orientation: no entry. */
export function placements(cv: CanvasConfig, o: Orient): Map<string, CanvasPos> {
  const out = new Map<string, CanvasPos>();
  if (o === 'portrait' && cv.portraitAuto) {
    for (const p of deriveCanvasPortrait(cv.items, cv.sidebar, gOf(cv)).placed) out.set(p.id, p.pos as CanvasPos);
    return out;
  }
  const k = keyOf(o);
  for (const it of cv.items) {
    const p = it[k];
    if (p) out.set(it.id, p);
  }
  return out;
}

/** Items left out of the portrait arrangement ("No caben en vertical"). */
export function omittedInPortrait(cv: CanvasConfig): string[] {
  const placed = placements(cv, 'portrait');
  return cv.items.filter((it) => !placed.has(it.id)).map((it) => it.id);
}

/** The cells taken on `o`, leaving out `except`. */
export function occupancy(cv: CanvasConfig, o: Orient, except?: string | string[]) {
  const skip = new Set(Array.isArray(except) ? except : except ? [except] : []);
  const occ = makeOccupancy(o, gOf(cv));
  for (const [id, p] of placements(cv, o)) {
    if (p.zone !== 'main' || skip.has(id)) continue;
    const [w, h] = boxCells(p, o, gOf(cv));
    occupy(occ, id, p.x, p.y, w, h);
  }
  return occ;
}

/** The sidebar stack on `o`, in order. */
export function sideStack(cv: CanvasConfig, o: Orient): { id: string; pos: SidePos }[] {
  const out: { id: string; pos: SidePos }[] = [];
  for (const [id, p] of placements(cv, o)) if (p.zone === 'side') out.push({ id, pos: p });
  return out.sort((a, b) => a.pos.order - b.pos.order);
}

/** Sizes a kind allows, smallest first (by area, ties by the order of the size table: m 4×3 before w 6×2). */
export function sizesOf(k: KindRef, o: Orient = 'landscape'): CanvasSize[] {
  const d = kind(k);
  if (!d) return [];
  const area = (s: CanvasSize) => cellsOf(s, o)[0] * cellsOf(s, o)[1];
  return [...d.sizes].sort((a, b) => area(a) - area(b) || CANVAS_SIZE_IDS.indexOf(a) - CANVAS_SIZE_IDS.indexOf(b));
}

/** The allowed size of `k` closest to `want` in area (ties: the smaller). */
export function closestSize(k: KindRef, want: CanvasSize, o: Orient = 'landscape'): CanvasSize {
  const list = sizesOf(k, o);
  if (list.includes(want)) return want;
  const [w, h] = cellsOf(want, o);
  let best = list[0] ?? kind(k)?.def ?? 'm';
  let d = Infinity;
  for (const s of list) {
    const [sw, sh] = cellsOf(s, o);
    const x = Math.abs(sw * sh - w * h);
    if (x < d) {
      d = x;
      best = s;
    }
  }
  return best;
}

/** Main-area size → sidebar span: xs and s take 2 units, m, w and t take 3, larger ones 4. */
export const spanForSize = (size: CanvasSize): 2 | 3 | 4 => (size === 'xs' || size === 's' ? 2 : size === 'm' || size === 'w' || size === 't' ? 3 : 4);
/** A box → sidebar span: by its named size, or by its rows when it has its own cells (2 rows or less 2, 3 rows 3, else 4). */
export const spanForBox = (b: Box, o: Orient, g: GridId = 'normal'): 2 | 3 | 4 => {
  if (b.w === undefined) return spanForSize(b.size);
  // in normal rows (a fine row is half of one)
  const h = Math.ceil(boxCells(b, o, g)[1] / gridFactor(g));
  return h <= 2 ? 2 : h === 3 ? 3 : 4;
};
/** Sidebar span → main-area size of `k`: 2 is small, 3 medium, 4 and fill large, then the closest the kind allows. */
export const sizeForSpan = (k: KindRef, span: SideSpan): CanvasSize => closestSize(k, span === 2 ? 's' : span === 3 ? 'm' : 'l');

/** Units of the stack the fixed spans take, how many items there are and whether one fills the rest. */
export function sideUse(cv: CanvasConfig, o: Orient, except?: string) {
  const list = sideStack(cv, o).filter((x) => x.id !== except);
  const fill = list.some((x) => x.pos.span === 'fill');
  const units = list.reduce((n, x) => n + (x.pos.span === 'fill' ? 0 : x.pos.span), 0);
  return { count: list.length, units, fill };
}

/**
 * The largest span from `want` down that still fits in the stack (the fill item keeps at least 2 units), or null.
 * A second fill becomes a fixed span.
 */
export function fitSpan(cv: CanvasConfig, o: Orient, want: SideSpan, except?: string): SideSpan | null {
  const u = sideUse(cv, o, except);
  if (u.count >= CANVAS_LIMITS.side) return null;
  const room = SIDE_UNITS - u.units - (u.fill ? 2 : 0);
  if (want === 'fill' && !u.fill && room >= 2) return 'fill';
  const start = want === 'fill' ? 4 : want;
  for (const s of [4, 3, 2] as const) if (s <= start && s <= room) return s;
  return null;
}

/** How many more items the screen takes, and whether a kind is at its own cap. */
export function canAdd(cv: CanvasConfig, k: CanvasKind, cards: CanvasKind[] = k === 'rotator' ? ((canvasDefaults('rotator').cards as { kind: CanvasKind }[]) ?? []).map((c) => c.kind) : []): Refusal | null {
  // the cards of a Rotativa count as cards of the screen (canvasCore sanitizeCanvas)
  const all = canvasCards(cv.items);
  if (all.length + 1 + cards.length > CANVAS_LIMITS.items) return 'tooMany';
  for (const x of [k, ...cards]) {
    const cap = kind(x)?.perScreen;
    if (cap && all.filter((i) => i.kind === x).length + [k, ...cards].filter((y) => y === x).length > cap) return 'kindCap';
  }
  return null;
}

/** Fresh ids for the cards of a Rotativa (a new one, a copy), none taken on the screen. */
export function freshCardIds(cv: CanvasConfig, it: CanvasItem): void {
  if (it.kind !== 'rotator' || !Array.isArray(it.props.cards)) return;
  const taken = new Set(canvasCards(cv.items).map((i) => i.id));
  taken.add(it.id);
  for (const c of it.props.cards as { id: string }[]) {
    c.id = newCanvasId(taken);
    taken.add(c.id);
  }
}

/** How many cards a screen has (a Rotativa's cards count too), for "N de 24 widgets". */
export const cardCount = (cv: CanvasConfig): number => canvasCards(cv.items).length;

/** A drop target on the main grid (w and h: a box of its own, see Box). */
export interface MainDrop {
  x: number;
  y: number;
  size: CanvasSize;
  w?: number;
  h?: number;
  /** the item of the same size under the pointer swaps places with the dragged one */
  swap?: string;
  /**
   * cards that show nothing under the drop make room for it (resolveMain's `voids`): spacers go, the others (a card
   * of its own that is only empty now, or hidden) move to the nearest free spot. Never a card that shows something.
   */
  replace?: { remove: string[]; move: { id: string; x: number; y: number }[] };
}

/** The items on the cells of a w×h box at (x, y) on `o` (leaving out `except`), each once. */
export function occupantsAt(cv: CanvasConfig, o: Orient, x: number, y: number, w: number, h: number, except?: string): string[] {
  const occ = occupancy(cv, o, except);
  const out = new Set<string>();
  for (let j = Math.max(0, y); j < Math.min(occ.rows, y + h); j++) for (let i = Math.max(0, x); i < Math.min(occ.cols, x + w); i++) if (occ.cells[j][i]) out.add(occ.cells[j][i]!);
  return [...out];
}

/**
 * Room for a w×h box at (x, y) made by the cards that show nothing there (`voids`): spacers are removed, other empty
 * or hidden cards move to the nearest free spot. null when a card that shows something is in the way, or when an
 * empty card that must move finds no free spot (it is never deleted).
 */
function makeRoom(cv: CanvasConfig, o: Orient, size: Box | CanvasSize, x: number, y: number, voids: ReadonlySet<string>, id?: string): MainDrop | null {
  const [w, h] = boxCells(size, o, gOf(cv));
  const under = occupantsAt(cv, o, x, y, w, h, id);
  if (!under.length || under.some((u) => !voids.has(u))) return null;
  const pl = placements(cv, o);
  const remove = under.filter((u) => itemOf(cv, u)?.kind === 'spacer');
  const movers = under.filter((u) => !remove.includes(u));
  const occ = occupancy(cv, o, [...under, ...(id ? [id] : [])]);
  occupy(occ, id ?? '+new', x, y, w, h);
  const move: { id: string; x: number; y: number }[] = [];
  for (const m of movers) {
    const p = pl.get(m) as MainPos;
    const [mw, mh] = boxCells(p, o, gOf(cv));
    const spot = nearestFree(occ, p.x, p.y, mw, mh);
    if (!spot) return null;
    occupy(occ, m, spot.x, spot.y, mw, mh);
    move.push({ id: m, x: spot.x, y: spot.y });
  }
  return { x, y, ...asBox(size), replace: { remove, move } };
}

/**
 * Where a box of `size` dropped with its origin at (x, y) lands on `o`: there when free, the place of an item of the
 * same size under the pointer cell (`at`) when the dragged item comes from the main grid (a swap), else the nearest
 * free spot. null: no room anywhere.
 */
export function resolveMain(
  cv: CanvasConfig, o: Orient, size0: Box | CanvasSize, x: number, y: number, opts: { id?: string; at?: { x: number; y: number }; voids?: ReadonlySet<string> } = {},
): MainDrop | null {
  const size = asBox(size0);
  const { cols, rows } = grid(o, gOf(cv));
  const [w, h] = boxCells(size, o, gOf(cv));
  if (w > cols || h > rows) return null;
  const cx = Math.min(Math.max(0, x), cols - w);
  const cy = Math.min(Math.max(0, y), rows - h);
  const occ = occupancy(cv, o, opts.id);
  if (fitsAt(occ, cx, cy, w, h)) return { x: cx, y: cy, ...size };
  const here = opts.id ? placements(cv, o).get(opts.id) : undefined;
  if (opts.at && here?.zone === 'main') {
    const other = occ.cells[opts.at.y]?.[opts.at.x];
    const op = other ? placements(cv, o).get(other) : undefined;
    // a card of the same cells under the pointer swaps places with the dragged one
    if (other && op?.zone === 'main' && sameCells(op, here, o, gOf(cv)) && sameCells(here, size, o, gOf(cv)) && !opts.voids?.has(other)) return { x: op.x, y: op.y, ...size, swap: other };
  }
  // dropped on cards that show nothing (a spacer, an empty or hidden card): the new one takes their place, there or
  // at the origin of the one under the pointer
  if (opts.voids?.size) {
    const pl = placements(cv, o);
    const at = opts.at && occ.cells[opts.at.y]?.[opts.at.x];
    // the empty card under the pointer first, then those under the box, then the nearest other ones
    const order = [...new Set([...(at ? [at] : []), ...occupantsAt(cv, o, cx, cy, w, h, opts.id)])].filter((v) => opts.voids!.has(v));
    const dist = (v: string) => {
      const p = pl.get(v) as MainPos;
      return Math.abs(p.x - cx) + Math.abs(p.y - cy);
    };
    order.push(...[...opts.voids].filter((v) => !order.includes(v) && v !== opts.id && pl.get(v)?.zone === 'main').sort((a, b) => dist(a) - dist(b)));
    const tries: [number, number][] = [[cx, cy]];
    for (const v of order) {
      const p = pl.get(v);
      if (p?.zone === 'main') tries.push([Math.min(p.x, cols - w), Math.min(p.y, rows - h)]);
    }
    for (const [tx, ty] of tries) {
      const r = makeRoom(cv, o, size, tx, ty, opts.voids, opts.id);
      if (r) return r;
    }
  }
  const spot = nearestFree(occ, cx, cy, w, h);
  return spot ? { x: spot.x, y: spot.y, ...size } : null;
}

/** Write a position on `o` (portrait edits first copy the derived arrangement, see editPortrait). */
function setPos(cv: CanvasConfig, o: Orient, id: string, pos: CanvasPos | null) {
  const it = cv.items.find((i) => i.id === id);
  if (!it) return;
  if (o === 'portrait') it.portrait = pos;
  else if (pos) it.pos = pos;
}

/** Renumber the sidebar stack on `o` so its order runs 0..n-1. */
function renumber(cv: CanvasConfig, o: Orient) {
  sideStack(cv, o).forEach((x, i) => setPos(cv, o, x.id, { ...x.pos, order: i }));
}

/** Put item `id` at a resolved main-grid drop (a swap moves the other item to where the dragged one was). */
export function applyMain(cv0: CanvasConfig, o: Orient, id: string, drop: MainDrop): Result {
  if (readOnly(cv0, o)) return no('auto');
  const cv = clone(cv0);
  const was = placements(cv, o).get(id);
  clearRoom(cv, o, drop);
  if (drop.swap) {
    if (was?.zone !== 'main') return no('noRoom');
    setPos(cv, o, drop.swap, mainPos(was.x, was.y, placements(cv, o).get(drop.swap) as MainPos));
  }
  setPos(cv, o, id, mainPos(drop.x, drop.y, drop));
  if (was?.zone === 'side') renumber(cv, o);
  return ok(cv, id);
}

/** The placeholders a drop replaces (MainDrop.replace): spacers removed, empty cards moved aside. */
function clearRoom(cv: CanvasConfig, o: Orient, drop: MainDrop) {
  if (!drop.replace) return;
  const pl = placements(cv, o);
  for (const m of drop.replace.move) {
    const p = pl.get(m.id);
    if (p?.zone === 'main') setPos(cv, o, m.id, { ...p, x: m.x, y: m.y });
  }
  if (drop.replace.remove.length) {
    cv.items = cv.items.filter((i) => !drop.replace!.remove.includes(i.id));
    renumber(cv, 'landscape');
    if (!cv.portraitAuto) renumber(cv, 'portrait');
  }
}

/** Move item `id` so its origin is near (x, y) (keyboard, drag). */
export function moveMain(cv: CanvasConfig, o: Orient, id: string, x: number, y: number, at?: { x: number; y: number }): Result {
  const p = placements(cv, o).get(id);
  if (!p) return no('noRoom');
  const size: Box | CanvasSize = p.zone === 'main' ? p : sizeForSpan(sizingOf(itemOf(cv, id)!), p.span);
  const drop = resolveMain(cv, o, size, x, y, { id, at });
  return drop ? applyMain(cv, o, id, drop) : no('noRoom');
}

/** One cell in a direction; jumps over items in the way to the next free spot along that line. */
export function nudge(cv: CanvasConfig, o: Orient, id: string, dx: number, dy: number): Result {
  if (readOnly(cv, o)) return no('auto');
  const p = placements(cv, o).get(id);
  if (!p) return no('noRoom');
  if (p.zone === 'side') {
    // in the stack the arrows along the bar reorder it
    const along = sideOf(cv, o) === 'top' || sideOf(cv, o) === 'bottom' ? dx : dy;
    if (!along) return no('noRoom');
    return reorderSide(cv, o, id, p.order + along);
  }
  const { cols, rows } = grid(o, gOf(cv));
  const [w, h] = boxCells(p, o, gOf(cv));
  const occ = occupancy(cv, o, id);
  for (let i = 1; ; i++) {
    const x = p.x + dx * i;
    const y = p.y + dy * i;
    if (x < 0 || y < 0 || x + w > cols || y + h > rows) return no('noRoom');
    if (fitsAt(occ, x, y, w, h)) return applyMain(cv, o, id, mainPos(x, y, p));
  }
}

/** The next (dir 1) or previous (dir -1) allowed size of item `id`, kept at its origin when it fits there. */
export function stepSize(cv: CanvasConfig, o: Orient, id: string, dir: 1 | -1): Result {
  const it = itemOf(cv, id);
  const p = placements(cv, o).get(id);
  if (!it || !p) return no('noRoom');
  if (p.zone === 'side') return stepSpan(cv, o, id, dir);
  const list = sizesOf(sizingOf(it), o);
  // a box of its own steps from the named size of about its area
  const [cw, ch] = boxCells(p, o, gOf(cv));
  const area = (s: CanvasSize) => cellsOf(s, o, gOf(cv))[0] * cellsOf(s, o, gOf(cv))[1];
  let i = list.indexOf(p.size);
  if (p.w !== undefined) {
    const up = list.findIndex((s) => area(s) > cw * ch);
    const down = list.findIndex((s) => area(s) >= cw * ch);
    i = dir > 0 ? (up < 0 ? list.length - 1 : up - 1) : down < 0 ? list.length : down;
  }
  // the next size that has room, skipping those that do not
  for (let j = i + dir; j >= 0 && j < list.length; j += dir) {
    const r = resize(cv, o, id, list[j]);
    if (r.ok) return r;
  }
  return no('noRoom');
}

/** Give item `id` a size: kept at its origin (clamped inside the grid), else the nearest free spot. */
export function resize(cv: CanvasConfig, o: Orient, id: string, size: CanvasSize): Result {
  if (readOnly(cv, o)) return no('auto');
  const it = itemOf(cv, id);
  const p = placements(cv, o).get(id);
  if (!it || !p || p.zone !== 'main' || !sizingOf(it)?.sizes.includes(size)) return no('noRoom');
  const drop = resolveMain(cv, o, size, p.x, p.y, { id });
  return drop ? applyMain(cv, o, id, { ...drop, swap: undefined }) : no('noRoom');
}

/**
 * Give item `id` a box of w×h cells (the W and H steppers): clamped to its kind's range, kept at its origin when
 * it fits there, else at the nearest free spot. 'limit': already at the edge of the range that way.
 */
export function setCells(cv: CanvasConfig, o: Orient, id: string, w: number, h: number): Result {
  if (readOnly(cv, o)) return no('auto');
  const it = itemOf(cv, id);
  const p = placements(cv, o).get(id);
  if (!it || !p || p.zone !== 'main') return no('noRoom');
  const box = boxFor(sizingOf(it), w, h, o, gOf(cv));
  const [bw, bh] = boxCells(box, o, gOf(cv));
  if (bw !== w || bh !== h) return no('limit');
  if (sameCells(box, p, o, gOf(cv))) return no('limit');
  const drop = resolveMain(cv, o, box, p.x, p.y, { id });
  return drop ? applyMain(cv, o, id, { ...drop, swap: undefined }) : no('noRoom');
}

/**
 * The box the corner handle gives when it is dragged to w×h (origin kept): clamped to the kind's range, and when
 * that box would cover another card the legal box nearest to it (fewest cells away, then the larger). null: the
 * card cannot change at all there.
 */
export function handleBox(cv: CanvasConfig, o: Orient, id: string, w: number, h: number): Box | null {
  const it = itemOf(cv, id);
  const p = placements(cv, o).get(id);
  if (!it || !p || p.zone !== 'main') return null;
  const r = rangeOf(sizingOf(it), o, gOf(cv));
  const { cols, rows } = grid(o, gOf(cv));
  const tw = Math.min(r.maxW, Math.max(r.minW, Math.round(w)));
  const th = Math.min(r.maxH, Math.max(r.minH, Math.round(h)));
  const occ = occupancy(cv, o, id);
  let best: [number, number] | null = null;
  let key: [number, number] | null = null;
  for (let bw = r.minW; bw <= Math.min(r.maxW, cols - p.x); bw++) {
    for (let bh = r.minH; bh <= Math.min(r.maxH, rows - p.y); bh++) {
      if (!fitsAt(occ, p.x, p.y, bw, bh)) continue;
      const k: [number, number] = [Math.abs(bw - tw) + Math.abs(bh - th), -bw * bh];
      if (!key || k[0] < key[0] || (k[0] === key[0] && k[1] < key[1])) {
        key = k;
        best = [bw, bh];
      }
    }
  }
  return best ? boxFor(sizingOf(it), best[0], best[1], o, gOf(cv)) : null;
}

/** Put item `id` at its origin with box `b` (the handle, after handleBox). */
export function applyBox(cv: CanvasConfig, o: Orient, id: string, b: Box): Result {
  if (readOnly(cv, o)) return no('auto');
  const p = placements(cv, o).get(id);
  if (!p || p.zone !== 'main') return no('noRoom');
  if (sameCells(b, p, o, gOf(cv))) return no('noRoom');
  const [w, h] = boxCells(b, o, gOf(cv));
  if (!fitsAt(occupancy(cv, o, id), p.x, p.y, w, h)) return no('noRoom');
  return applyMain(cv, o, id, { x: p.x, y: p.y, ...asBox(b) });
}

/**
 * "Ajustar tamaño": the smallest box larger than the card's now that should hold its content (`need`: how many
 * times wider and taller the content is than the box, as the display measures it) and has room, at its origin or
 * else nearby; boxes are tried from the smallest area up and only grow, within the kind's range. 'noBigger': none.
 */
export function fitContent(cv: CanvasConfig, o: Orient, id: string, need: { w: number; h: number } = { w: 1, h: 1 }): Result {
  if (readOnly(cv, o)) return no('auto');
  const it = itemOf(cv, id);
  const p = placements(cv, o).get(id);
  if (!it || !p) return no('noRoom');
  if (p.zone === 'side') return stepSpan(cv, o, id, 1);
  const r = rangeOf(sizingOf(it), o, gOf(cv));
  const [cw, ch] = boxCells(p, o, gOf(cv));
  // what the content asks for, in whole cells (at least one more cell one way)
  const wantW = Math.min(r.maxW, Math.max(cw, Math.ceil(cw * Math.max(1, need.w) - 0.05)));
  const wantH = Math.min(r.maxH, Math.max(ch, Math.ceil(ch * Math.max(1, need.h) - 0.05)));
  const list: [number, number][] = [];
  for (let w = cw; w <= r.maxW; w++) for (let h = ch; h <= r.maxH; h++) if ((w > cw || h > ch) && w >= wantW && h >= wantH) list.push([w, h]);
  // smallest first; at the same area the shape closer to the card's own
  list.sort((a, b) => a[0] * a[1] - b[0] * b[1] || Math.abs(a[0] / a[1] - cw / ch) - Math.abs(b[0] / b[1] - cw / ch));
  // at its origin first, then anywhere nearby
  for (const [w, h] of list) {
    const box = boxFor(sizingOf(it), w, h, o, gOf(cv));
    if (fitsAt(occupancy(cv, o, id), p.x, p.y, w, h)) return applyMain(cv, o, id, { x: p.x, y: p.y, ...box });
  }
  for (const [w, h] of list) {
    const drop = resolveMain(cv, o, boxFor(sizingOf(it), w, h, o, gOf(cv)), p.x, p.y, { id });
    if (drop) return applyMain(cv, o, id, { ...drop, swap: undefined });
  }
  return no('noBigger');
}

const SPANS: SideSpan[] = [2, 3, 4, 'fill'];

/** Next sidebar span (2, 3, 4, fill and round again), skipping what does not fit. */
export function stepSpan(cv0: CanvasConfig, o: Orient, id: string, dir: 1 | -1 = 1): Result {
  if (readOnly(cv0, o)) return no('auto');
  const p = placements(cv0, o).get(id);
  if (p?.zone !== 'side') return no('notInSide');
  const i = SPANS.indexOf(p.span);
  for (let n = 1; n < SPANS.length; n++) {
    const want = SPANS[(i + dir * n + SPANS.length * 2) % SPANS.length];
    if (fitSpan(cv0, o, want, id) !== want) continue;
    const cv = clone(cv0);
    setPos(cv, o, id, { ...p, span: want });
    return ok(cv, id);
  }
  return no('sideFull');
}

/** Set a sidebar span directly (the inspector). */
export function setSpan(cv0: CanvasConfig, o: Orient, id: string, span: SideSpan): Result {
  if (readOnly(cv0, o)) return no('auto');
  const p = placements(cv0, o).get(id);
  if (p?.zone !== 'side') return no('notInSide');
  if (fitSpan(cv0, o, span, id) !== span) return no('sideFull');
  const cv = clone(cv0);
  setPos(cv, o, id, { ...p, span });
  return ok(cv, id);
}

/** Move item `id` into the sidebar stack at `index` (its size becomes a span). */
export function toSide(cv0: CanvasConfig, o: Orient, id: string, index: number): Result {
  if (readOnly(cv0, o)) return no('auto');
  if (sideOf(cv0, o) === 'none') return no('noSide');
  const it = itemOf(cv0, id);
  const p = placements(cv0, o).get(id);
  if (!it || !p) return no('noRoom');
  if (!kind(it.kind)?.side) return no('noSide');
  if (p.zone === 'side') return reorderSide(cv0, o, id, index);
  const span = fitSpan(cv0, o, spanForBox(p, o, gOf(cv0)), id);
  if (!span) return no('sideFull');
  const cv = clone(cv0);
  insertSide(cv, o, id, span, index);
  return ok(cv, id);
}

function insertSide(cv: CanvasConfig, o: Orient, id: string, span: SideSpan, index: number) {
  const list = sideStack(cv, o).filter((x) => x.id !== id);
  const at = Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, { id, pos: { zone: 'side', order: at, span } });
  list.forEach((x, i) => setPos(cv, o, x.id, { zone: 'side', order: i, span: x.id === id ? span : x.pos.span }));
}

/** Move a sidebar item to another place in the stack. */
export function reorderSide(cv0: CanvasConfig, o: Orient, id: string, index: number): Result {
  if (readOnly(cv0, o)) return no('auto');
  const list = sideStack(cv0, o);
  const from = list.findIndex((x) => x.id === id);
  if (from < 0) return no('notInSide');
  const to = Math.max(0, Math.min(index, list.length - 1));
  if (to === from) return no('noRoom');
  const cv = clone(cv0);
  const [x] = list.splice(from, 1);
  list.splice(to, 0, x);
  list.forEach((y, i) => setPos(cv, o, y.id, { ...y.pos, order: i }));
  return ok(cv, id);
}

/** Move a sidebar item to the main grid near (x, y), with its span turned into a size. */
export function toMain(cv: CanvasConfig, o: Orient, id: string, x: number, y: number): Result {
  if (readOnly(cv, o)) return no('auto');
  const it = itemOf(cv, id);
  const p = placements(cv, o).get(id);
  if (!it || !p) return no('noRoom');
  if (p.zone === 'main') return moveMain(cv, o, id, x, y);
  const drop = resolveMain(cv, o, sizeForSpan(sizingOf(it), p.span), x, y, { id });
  return drop ? applyMain(cv, o, id, drop) : no('noRoom');
}

/**
 * Where a new item of `k` goes when it is just picked: the first free spot scanning from the top left; with no free
 * spot, the place of a card that shows nothing (`voids`, see resolveMain).
 */
export function firstSpot(cv: CanvasConfig, o: Orient, k: KindRef, size?: CanvasSize, voids?: ReadonlySet<string>): MainDrop | null {
  const occ = occupancy(cv, o);
  const sizes = [size ?? kind(k).def, ...sizesOf(k, o)];
  for (const s of sizes) {
    const [w, h] = cellsOf(s, o, gOf(cv));
    const spot = firstFree(occ, w, h);
    if (spot) return { x: spot.x, y: spot.y, size: s };
  }
  if (!voids?.size) return null;
  const pl = placements(cv, o);
  for (const s of sizes) {
    const { cols, rows } = grid(o, gOf(cv));
    const [w, h] = cellsOf(s, o, gOf(cv));
    for (const id of tabOrder(cv, o)) {
      const p = pl.get(id);
      if (!voids.has(id) || p?.zone !== 'main') continue;
      const r = makeRoom(cv, o, s, Math.min(p.x, cols - w), Math.min(p.y, rows - h), voids);
      if (r) return r;
    }
  }
  return null;
}

/** The cards that show nothing on the screen now: spacers, cards hidden by hand and the ones the display says are empty. */
export function voidIds(cv: CanvasConfig, empty: ReadonlySet<string> = new Set()): Set<string> {
  return new Set(cv.items.filter((it) => it.kind === 'spacer' || it.hidden || empty.has(it.id)).map((it) => it.id));
}

/** A new item of `k` (default props and style, plus `extra` props), with no position yet. */
export function newItem(cv: CanvasConfig, k: CanvasKind, extra: Record<string, unknown> = {}): CanvasItem {
  const it: CanvasItem = {
    id: newCanvasId(new Set(cv.items.map((i) => i.id))),
    kind: k,
    pos: { zone: 'main', x: 0, y: 0, size: kind(k).def },
    style: { ...(defaultItemStyle() as CanvasItem['style']), ...(kind(k).defStyle ?? {}) },
    props: { ...canvasDefaults(k), ...extra },
  };
  freshCardIds(cv, it);
  if (kind(k).controls) {
    it.interactive = true;
    it.confirm = false;
  }
  return it;
}

/**
 * Add an item of `k` on orientation `o`: at a main-grid drop, at an index of the sidebar stack, or (no target) at
 * the first free spot. With portrait arranged by hand, the item also gets the first free portrait spot (or none).
 * The landscape place of an item added while editing portrait is its first free landscape spot.
 */
export function addItem(
  cv0: CanvasConfig, o: Orient, k: CanvasKind, target: { zone: 'main'; drop: MainDrop } | { zone: 'side'; index: number } | null, extra: Record<string, unknown> = {},
  voids?: ReadonlySet<string>,
): Result & { drop?: MainDrop } {
  if (readOnly(cv0, o)) return no('auto');
  const cap = canAdd(cv0, k);
  if (cap) return no(cap);
  const cv = clone(cv0);
  const it = newItem(cv, k, extra);
  let used: MainDrop | undefined;
  const other: Orient = o === 'portrait' ? 'landscape' : 'portrait';
  if (target?.zone === 'side') {
    if (sideOf(cv, o) === 'none' || !kind(k).side) return no('noSide');
    const span = fitSpan(cv, o, spanForSize(kind(k).def));
    if (!span) return no('sideFull');
    cv.items.push(it);
    insertSide(cv, o, it.id, span, target.index);
  } else {
    const drop = target?.drop ?? firstSpot(cv, o, sizingOf(it), undefined, voids);
    if (!drop) return no('noRoom');
    clearRoom(cv, o, drop);
    cv.items.push(it);
    setPos(cv, o, it.id, mainPos(drop.x, drop.y, drop));
    used = drop;
  }
  // the other orientation: landscape always needs a place; a hand-made portrait gets one if there is room
  if (o === 'portrait') {
    const spot = firstSpot({ ...cv, items: cv.items.filter((i) => i.id !== it.id) }, 'landscape', sizingOf(it));
    if (!spot) return no('noRoom');
    it.pos = { zone: 'main', x: spot.x, y: spot.y, size: spot.size };
  } else if (!cv.portraitAuto) {
    const spot = firstSpot({ ...cv, items: cv.items.filter((i) => i.id !== it.id) }, other, sizingOf(it));
    it.portrait = spot ? { zone: 'main', x: spot.x, y: spot.y, size: spot.size } : null;
  }
  return { ok: true, cv, id: it.id, drop: used };
}

/** Remove an item (from both orientations). */
export function removeItem(cv0: CanvasConfig, id: string): Result {
  const cv = clone(cv0);
  cv.items = cv.items.filter((i) => i.id !== id);
  renumber(cv, 'landscape');
  if (!cv.portraitAuto) renumber(cv, 'portrait');
  return ok(cv);
}

/** A copy of item `id` next to it (the nearest free spot of its size, else after it in the sidebar, else anywhere). */
export function duplicateItem(cv0: CanvasConfig, o: Orient, id: string): Result {
  const src = itemOf(cv0, id);
  if (!src) return no('noRoom');
  if (readOnly(cv0, o)) return no('auto');
  const cap = canAdd(cv0, src.kind, src.kind === 'rotator' ? ((src.props.cards as { kind: CanvasKind }[]) ?? []).map((c) => c.kind) : []);
  if (cap) return no(cap);
  const p = placements(cv0, o).get(id)!;
  let target: Parameters<typeof addItem>[3] = null;
  if (p.zone === 'main') {
    const drop = resolveMain(cv0, o, p, p.x, p.y);
    if (drop) target = { zone: 'main', drop };
  } else if (fitSpan(cv0, o, p.span)) target = { zone: 'side', index: p.order + 1 };
  const r = addItem(cv0, o, src.kind, target);
  if (!r.ok) return r;
  const it = itemOf(r.cv, r.id!)!;
  it.props = structuredClone(src.props);
  freshCardIds(r.cv, it);
  it.style = structuredClone(src.style);
  if (src.interactive !== undefined) it.interactive = src.interactive;
  if (p.zone === 'side') {
    const sp = placements(r.cv, o).get(it.id);
    if (sp?.zone === 'side') setPos(r.cv, o, it.id, { ...sp, span: fitSpan(cv0, o, p.span) ?? sp.span });
  }
  return r;
}

/** Turn the sidebar on, change its side, or off ('move': its items go to the main grid; 'delete': they go). */
export function setSidebarSide(cv0: CanvasConfig, side: CanvasConfig['sidebar']['side'], mode: 'move' | 'delete' = 'move'): Result {
  const cv = clone(cv0);
  cv.sidebar.side = side;
  if (side !== 'none') return ok(cv);
  for (const o of ['landscape', 'portrait'] as Orient[]) {
    if (o === 'portrait' && cv.portraitAuto) continue;
    const k = keyOf(o);
    for (const it of [...cv.items]) {
      const p = it[k];
      if (p?.zone !== 'side') continue;
      if (mode === 'delete') {
        cv.items = cv.items.filter((i) => i.id !== it.id);
        continue;
      }
      const spot = firstSpot({ ...cv, items: cv.items.filter((i) => i.id !== it.id) }, o, sizingOf(it), sizeForSpan(sizingOf(it), p.span));
      if (spot) setPos(cv, o, it.id, { zone: 'main', x: spot.x, y: spot.y, size: spot.size });
      else if (o === 'portrait') it.portrait = null;
      else cv.items = cv.items.filter((i) => i.id !== it.id);
    }
  }
  return ok(cv);
}

/** Items in the sidebar on either orientation. */
export const sideItems = (cv: CanvasConfig): CanvasItem[] => cv.items.filter((it) => it.pos.zone === 'side' || (!cv.portraitAuto && it.portrait?.zone === 'side'));

/** "Editar en vertical": the derived portrait arrangement becomes the owner's own. */
export function editPortrait(cv0: CanvasConfig): CanvasConfig {
  const cv = clone(cv0);
  const placed = placements(cv0, 'portrait');
  cv.portraitAuto = false;
  for (const it of cv.items) it.portrait = placed.get(it.id) ?? null;
  return cv;
}

/** "Volver a automático": portrait is derived again. */
export function autoPortrait(cv0: CanvasConfig): CanvasConfig {
  const cv = clone(cv0);
  cv.portraitAuto = true;
  for (const it of cv.items) delete it.portrait;
  return cv;
}

/** Put an item left out of portrait back at the first free portrait spot. */
export function placeInPortrait(cv0: CanvasConfig, id: string): Result {
  if (cv0.portraitAuto) return no('auto');
  const it = itemOf(cv0, id);
  if (!it) return no('noRoom');
  const spot = firstSpot(cv0, 'portrait', sizingOf(it));
  if (!spot) return no('noRoom');
  const cv = clone(cv0);
  setPos(cv, 'portrait', id, { zone: 'main', x: spot.x, y: spot.y, size: spot.size });
  return ok(cv, id);
}

/** Change an item's props or style (the inspector). */
export function updateItem(cv0: CanvasConfig, id: string, fn: (it: CanvasItem) => void): CanvasConfig {
  const cv = clone(cv0);
  const it = itemOf(cv, id);
  if (it) fn(it);
  return cv;
}

export const itemOf = (cv: CanvasConfig, id: string | null | undefined): CanvasItem | undefined => (id ? cv.items.find((i) => i.id === id) : undefined);

/** Items in the order Tab walks them: by row, then column; the sidebar stack first when it is on the left or top. */
export function tabOrder(cv: CanvasConfig, o: Orient): string[] {
  const pl = placements(cv, o);
  const side = sideStack(cv, o).map((x) => x.id);
  const main = [...pl.entries()].filter(([, p]) => p.zone === 'main').sort(([, a], [, b]) => (a as MainPos).y - (b as MainPos).y || (a as MainPos).x - (b as MainPos).x).map(([id]) => id);
  const s = sideOf(cv, o);
  return s === 'left' || s === 'top' ? [...side, ...main] : [...main, ...side];
}

/** True when no two items share a cell on either orientation (the rule every operation keeps). */
export function noOverlap(cv: CanvasConfig): boolean {
  for (const o of ['landscape', 'portrait'] as Orient[]) {
    const occ = makeOccupancy(o, gOf(cv));
    for (const [id, p] of placements(cv, o)) {
      if (p.zone !== 'main') continue;
      const [w, h] = boxCells(p, o, gOf(cv));
      if (!fitsAt(occ, p.x, p.y, w, h)) return false;
      occupy(occ, id, p.x, p.y, w, h);
    }
  }
  return true;
}

/**
 * "Cuadrícula": the canvas on the normal or the fine grid, both orientations (canvasCore convertCanvasGrid). Going
 * to the fine grid nothing moves on the screen; going back, `moved` and `resized` say how many cards had to change.
 */
export function setGrid(cv: CanvasConfig, g: GridId): { ok: true; cv: CanvasConfig; moved: number; resized: number } | { ok: false } {
  const r = convertCanvasGrid(cv, g);
  if (!r.ok) return { ok: false };
  return { ok: true, cv: r.canvas, moved: r.moved.length, resized: r.resized.length };
}
