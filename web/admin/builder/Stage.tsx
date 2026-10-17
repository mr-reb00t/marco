// The builder's canvas: the real display in a scaled iframe (it draws what the TV draws), with the editor's overlay
// on top: the cells while something is dragged, a ring on the selected widget, its size handle and menu, the ghost of
// a drop (green when it fits, red when it does not) and a badge on cards whose content does not fit. The iframe never
// takes pointer events; every gesture lands on the overlay (dnd.ts).
import { postDraftWeather } from '../weatherPreview';
import { HIDDEN_TEXT, type HiddenWhy } from './hiddenWhy';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { HaPreview } from './haPreview';
import type { CanvasConfig, CanvasKind, CanvasSize, DataItemData, DisplayConfig, DisplayValue } from '../../shared/types';
import { CANVAS_KINDS, canvasDefaults } from '../../../server/core/canvasCore.js';
import { Icon } from '../components/icons';
import { t } from '../i18n';
import { gesture } from './dnd';
import { cellAt, cellBox, computeGeometry, inSide, mainBox, sideBox, sideIndexAt, sideTracks, type Box, type Geometry } from './geometry';
import { KIND_META, SIZE_LABEL, SPAN_LABEL, kindName } from './kinds';
import {
  addItem, applyBox, applyMain, boxCells, boxFor, fitSpan, gOf, grid, sizingOf, handleBox, itemOf, occupantsAt, placements, rangeOf, voidIds, readOnly, reorderSide, resize, resolveMain,
  sideOf, sideStack, sizeForSpan, sizesOf, spanForBox, stepSize, tabOrder, toSide, type Box as CellsBox, type MainDrop, type Orient, type Refusal, type Result,
} from './model';

/** Something new from the palette: a kind and the props it starts with (a saved widget's id). */
export interface AddSpec {
  kind: CanvasKind;
  props?: Record<string, unknown>;
  label: string;
}

/** What the palette calls while one of its tiles is dragged over the canvas. */
export interface StageApi {
  hover(spec: AddSpec, clientX: number, clientY: number): boolean;
  drop(spec: AddSpec, clientX: number, clientY: number): boolean;
  leave(): void;
}

/** What the display says about each card ('marco:canvas-rects'). */
export interface RectsInfo {
  cramped: Set<string>;
  /** drawn without blur to stay within the display's blur budget */
  noBlur: Set<string>;
  /** cards with nothing to show right now (no announcement, no countdowns...): not drawn on the screen */
  empty: Set<string>;
  /** how many times wider and taller a cramped card's content is than its box */
  need: Map<string, { w: number; h: number }>;
}

type Target = { zone: 'main'; drop: MainDrop | null; cell: { x: number; y: number }; size: CellsBox | CanvasSize; inWay: string[] } | { zone: 'side'; index: number; ok: boolean } | null;
interface Ghost {
  box: Box | null;
  ok: boolean;
  /** an insertion bar in the sidebar instead of a box */
  bar?: Box | null;
  label?: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const okBox = (b: any) => b && ['x', 'y', 'w', 'h', 'gx', 'gy'].every((k) => isNum(b[k]));

export function Stage(props: {
  cv: CanvasConfig;
  orient: Orient;
  url: string | null;
  live: DisplayConfig | null;
  fontScale: number;
  /** the frame's size in screen pixels (a connected screen's window), else 1920×1080 or 1080×1920 */
  frameSize?: { w: number; h: number } | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  commit: (r: Result, label: string) => void;
  /** `inWay`: the names of the cards on the spot a drop wanted */
  refuse: (why: Refusal, inWay?: string[]) => void;
  /** a drop took the place of cards that show nothing (MainDrop.replace) */
  onReplaced?: (drop: NonNullable<MainDrop['replace']>) => void;
  placing: AddSpec | null;
  onPlaced: () => void;
  preview: boolean;
  apiRef: { current: StageApi | null };
  onRects: (info: RectsInfo) => void;
  onMenu: (id: string, at: { x: number; y: number }) => void;
  /** "Ajustar tamaño" from the No cabe badge */
  onFit?: (id: string) => void;
  /** a press on the grey area around the screen (the page settings show again) */
  onOutside?: () => void;
  /** Home Assistant states and chart points of the draft's items (haPreview.ts), for the frame */
  ha?: HaPreview | null;
  /** pushed values by key (valuesPreview.ts), for the frame */
  values?: Record<string, DisplayValue>;
  /** numbers of the draft's data cards by item id (dataPreview.ts), for the frame */
  data?: Record<string, DataItemData>;
  /** why an item is not on the screen right now (hiddenWhy.ts): a badge (the frame still draws them, except by hand) */
  why?: Map<string, HiddenWhy>;
  /** imported cards that still have to choose something: the badge text (t() key) */
  picks?: Map<string, string>;
  /** the card of a Rotativa being edited: the frame shows it and holds it */
  pin?: { item: string; card: string } | null;
}) {
  const { cv, orient } = props;
  // the canvas's grid ("Cuadrícula"): every cell below is one of its cells
  const G = gOf(cv);
  // the frame is as large as the screen it stands for (its own text size, cells and fit), then scaled to the stage
  const W = props.frameSize?.w ?? (orient === 'portrait' ? 1080 : 1920);
  const H = props.frameSize?.h ?? (orient === 'portrait' ? 1920 : 1080);
  const box = useRef<HTMLDivElement>(null);
  const ov = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);
  const [reported, setReported] = useState<Geometry | null>(null);
  const [cramped, setCramped] = useState<Set<string>>(new Set());
  const [noBlur, setNoBlur] = useState<Set<string>>(new Set());
  const [empty, setEmpty] = useState<Set<string>>(new Set());
  const [need, setNeed] = useState<Map<string, { w: number; h: number }>>(new Map());
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(props);
  live.current = props;

  // the screen fits the stage, letterboxed, never larger than 1:1
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setFit({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const s = Math.max(0.05, Math.min(fit.w / W, fit.h / H, 1)) || 0.1;

  // the draft goes to the display whenever it changes, and again each time the page in the frame loads
  const origin = useMemo(() => {
    try {
      return props.url ? new URL(props.url, location.href).origin : null;
    } catch {
      return null;
    }
  }, [props.url]);
  useEffect(() => setLoaded(false), [props.url, orient]);
  useEffect(() => {
    if (!loaded || !origin || !props.live) return;
    try {
      frame.current?.contentWindow?.postMessage({ type: 'marco:preview-draft', config: props.live, focus: null }, origin);
      // weather cards with a place not saved yet (#11)
      void postDraftWeather(frame.current?.contentWindow, origin, props.live);
    } catch {
      /* the frame went away */
    }
  }, [props.live, loaded, origin]);
  // a Rotativa's card being edited stays on show in the frame (main.ts 'marco:rotator-pin')
  const pinKey = props.pin ? `${props.pin.item}|${props.pin.card}` : '';
  useEffect(() => {
    if (!loaded || !origin) return;
    try {
      frame.current?.contentWindow?.postMessage({ type: 'marco:rotator-pin', item: props.pin?.item ?? null, card: props.pin?.card ?? null }, origin);
    } catch {
      /* the frame went away */
    }
  }, [pinKey, loaded, origin]);
  // a drag or a resize under way: the frame holds its animated backdrop still meanwhile (main.ts)
  useEffect(() => {
    if (!loaded || !origin) return;
    try {
      frame.current?.contentWindow?.postMessage({ type: 'marco:builder-busy', on: busy }, origin);
    } catch {
      /* the frame went away */
    }
  }, [busy, loaded, origin]);
  // Home Assistant cards not saved yet: their states and points come from the builder
  useEffect(() => {
    if (!loaded || !origin || !props.ha) return;
    try {
      const w = frame.current?.contentWindow;
      w?.postMessage({ type: 'marco:preview-ha', states: props.ha.states }, origin);
      for (const [item, data] of Object.entries(props.ha.history)) w?.postMessage({ type: 'marco:preview-history', item, data }, origin);
      for (const [item, data] of Object.entries(props.ha.stats)) w?.postMessage({ type: 'marco:preview-statistic', item, data }, origin);
      for (const [item, blob] of Object.entries(props.ha.frames)) w?.postMessage({ type: 'marco:preview-camera', item, blob }, origin);
    } catch {
      /* the frame went away */
    }
  }, [props.ha, loaded, origin]);

  // pushed values: a Valor card not saved yet shows its key's value too
  useEffect(() => {
    if (!loaded || !origin || !props.values) return;
    try {
      frame.current?.contentWindow?.postMessage({ type: 'marco:preview-values', values: props.values }, origin);
    } catch {
      /* the frame went away */
    }
  }, [props.values, loaded, origin]);

  // data cards: the numbers of items not saved yet
  useEffect(() => {
    if (!loaded || !origin || !props.data || !Object.keys(props.data).length) return;
    try {
      frame.current?.contentWindow?.postMessage({ type: 'marco:preview-data', items: props.data }, origin);
    } catch {
      /* the frame went away */
    }
  }, [props.data, loaded, origin]);

  // where the display drew the grids and the cards (only from our own frame and the display's origin)
  useEffect(() => {
    setReported(null);
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== origin || e.data?.type !== 'marco:canvas-rects') return;
      const d = e.data;
      if (!okBox(d.main) || (d.side !== null && !okBox(d.side)) || !Array.isArray(d.items) || !d.screen || !isNum(d.screen.w)) return;
      const p = !!d.portrait;
      const want = live.current.orient === 'portrait';
      if (p !== want) return;
      setReported({ W: d.screen.w, H: d.screen.h, main: d.main, side: d.side, row: !!d.row, strip: null, grid: gOf(live.current.cv) });
      const cr = new Set<string>(d.items.filter((x: any) => x && typeof x.id === 'string' && x.cramped === true).map((x: any) => x.id as string));
      setCramped((old) => (old.size === cr.size && [...cr].every((x) => old.has(x)) ? old : cr));
      const nb = new Set<string>(d.items.filter((x: any) => x && typeof x.id === 'string' && x.noBlur === true).map((x: any) => x.id as string));
      setNoBlur((old) => (old.size === nb.size && [...nb].every((x) => old.has(x)) ? old : nb));
      const em = new Set<string>(d.items.filter((x: any) => x && typeof x.id === 'string' && x.empty === true).map((x: any) => x.id as string));
      setEmpty((old) => (old.size === em.size && [...em].every((x) => old.has(x)) ? old : em));
      const nd = new Map<string, { w: number; h: number }>();
      for (const x of d.items) if (x && typeof x.id === 'string' && x.need && isNum(x.need.w) && isNum(x.need.h)) nd.set(x.id, { w: x.need.w, h: x.need.h });
      setNeed((old) => (old.size === nd.size && [...nd].every(([k, v]) => old.get(k)?.w === v.w && old.get(k)?.h === v.h) ? old : nd));
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [origin, orient]);
  useEffect(() => props.onRects({ cramped, noBlur, empty, need }), [cramped, noBlur, empty, need]);

  // the reported boxes, while they match this layout (a sidebar just turned on is worked out here until it reports)
  const geo: Geometry = useMemo(() => {
    const mine = computeGeometry(cv, orient, props.fontScale, { w: W, h: H });
    const r = reported;
    if (!r || r.W !== W || r.H !== H || !!r.side !== !!mine.side || (mine.side && r.row !== mine.row)) return mine;
    if (mine.side && r.side && Math.abs(r.side.w * r.side.h - mine.side.w * mine.side.h) > 0.08 * mine.side.w * mine.side.h) return mine;
    // the cells of the canvas's own grid (a switch of Cuadrícula is drawn at once, before the frame reports again)
    return { ...r, strip: mine.strip, grid: mine.grid };
  }, [cv, orient, reported, props.fontScale, W, H]);

  const pl = useMemo(() => placements(cv, orient), [cv, orient]);
  const stack = useMemo(() => sideStack(cv, orient), [cv, orient]);
  const tracks = useMemo(() => sideTracks(stack), [stack]);
  const ro = readOnly(cv, orient);
  /** Cards that show nothing on the screen now: a spacer, an empty card (the display says so) or one hidden by hand. */
  const voidOf = (c: CanvasConfig, id: string): 'space' | 'empty' | 'hidden' | null => {
    const it = itemOf(c, id);
    if (!it) return null;
    if (it.kind === 'spacer') return 'space';
    if (it.hidden) return 'hidden';
    return empty.has(id) ? 'empty' : null;
  };
  const voidsOf = (c: CanvasConfig) => voidIds(c, empty);
  /** Names of the cards on a box of the main grid (what is in the way of a drop). */
  const namesAt = (c: CanvasConfig, x: number, y: number, size: CellsBox | CanvasSize, except?: string) => {
    const [w, h] = boxCells(size, orient, G);
    const { cols: gc, rows: gr } = grid(orient, G);
    const cx = Math.min(Math.max(0, x), gc - w);
    const cy = Math.min(Math.max(0, y), gr - h);
    return occupantsAt(c, orient, cx, cy, w, h, except).map((id) => {
      const it = itemOf(c, id)!;
      return it.kind === 'widget' ? t('Widget') : t(kindName(it.kind));
    });
  };
  const boxOf = (id: string): Box | null => {
    const p = pl.get(id);
    if (!p) return null;
    if (p.zone === 'main') return mainBox(geo, orient, p);
    const tr = tracks.get(id);
    return tr ? sideBox(geo, tr.start, tr.span) : null;
  };

  /** A pointer position on the screen (screen pixels). */
  const toScreen = (clientX: number, clientY: number) => {
    const r = ov.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s, inside: clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom };
  };

  /** Where a dragged thing lands at a point: `id` an item being moved (`grab`: the cell of it under the pointer). */
  const targetAt = (px: number, py: number, what: { id?: string; kind: CanvasKind; grab?: { x: number; y: number } }): Target => {
    const c = live.current.cv;
    const k = CANVAS_KINDS[what.kind];
    const from = what.id ? placements(c, orient).get(what.id) : undefined;
    // what it is sized as (a Rotativa: within what its cards allow)
    const moving = what.id ? itemOf(c, what.id) : undefined;
    const sz = sizingOf(moving ?? { kind: what.kind, props: canvasDefaults(what.kind) });
    if (sideOf(c, orient) !== 'none' && inSide(geo, px, py) && !cellAt(geo, orient, px, py).inside) {
      const others = sideStack(c, orient).filter((x) => x.id !== what.id);
      const tr = sideTracks(sideStack(c, orient));
      const boxes = others.map((x) => {
        const tt = tr.get(x.id);
        return (tt && sideBox(geo, tt.start, tt.span)) || { x: 0, y: 0, w: 0, h: 0 };
      });
      const index = sideIndexAt(geo, boxes, px, py);
      if (!k.side) return { zone: 'side', index, ok: false };
      if (from?.zone === 'side') return { zone: 'side', index, ok: true };
      const size: CellsBox = from?.zone === 'main' ? from : { size: sz.def };
      return { zone: 'side', index, ok: !!fitSpan(c, orient, spanForBox(size, orient, G), what.id) };
    }
    const cell = cellAt(geo, orient, px, py);
    if (!cell.inside) return null;
    const size: CellsBox | CanvasSize = from?.zone === 'main' ? from : from?.zone === 'side' ? sizeForSpan(sz, from.span) : sz.def;
    const [w, h] = boxCells(size, orient, G);
    const g = what.grab && from?.zone === 'main' ? what.grab : { x: Math.floor(w / 2), y: Math.floor(h / 2) };
    const drop = resolveMain(c, orient, size, cell.x - g.x, cell.y - g.y, { id: what.id, at: cell, voids: voidsOf(c) });
    // a new card that does not fit there at its usual size goes in at the largest smaller box that does (any w×h
    // within its range, a named size first at the same area; it can be changed afterwards), as a tap on its palette
    // tile already does
    if (!drop && !from) {
      const r = rangeOf(sz, orient, G);
      const smaller: [number, number, boolean][] = [];
      for (let w2 = r.minW; w2 <= Math.min(w, r.maxW); w2++) {
        for (let h2 = r.minH; h2 <= Math.min(h, r.maxH); h2++) if (w2 * h2 < w * h) smaller.push([w2, h2, boxFor(sz, w2, h2, orient, G).w === undefined]);
      }
      smaller.sort((a, b) => b[0] * b[1] - a[0] * a[1] || Number(b[2]) - Number(a[2]) || Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]));
      for (const [w2, h2] of smaller) {
        const z = boxFor(sz, w2, h2, orient, G);
        const d = resolveMain(c, orient, z, cell.x - Math.floor(w2 / 2), cell.y - Math.floor(h2 / 2), { at: cell, voids: voidsOf(c) });
        if (d) return { zone: 'main', drop: d, cell, size: z, inWay: [] };
      }
    }
    return { zone: 'main', drop, cell, size, inWay: drop ? [] : namesAt(c, cell.x - g.x, cell.y - g.y, size, what.id) };
  };

  const ghostFor = (tg: Target, what: { id?: string; kind: CanvasKind }): Ghost | null => {
    if (!tg) return null;
    if (tg.zone === 'main') {
      if (tg.drop) {
        const rp = tg.drop.replace;
        const label = tg.drop.swap ? t('Cambiar de sitio') : rp?.move.length ? t('Ocupa el sitio de una tarjeta vacía') : rp ? t('Sustituye el espacio vacío') : undefined;
        return { box: mainBox(geo, orient, { zone: 'main', ...tg.drop }), ok: true, label };
      }
      const [w, h] = boxCells(tg.size, orient, G);
      const { cols, rows } = grid(orient, G);
      const label = tg.inWay.length ? `${t('No hay sitio para este tamaño')} · ${t('En ese hueco está: {names}', { names: tg.inWay.join(', ') })}` : t('No hay sitio para este tamaño');
      return { box: cellBox(geo, orient, Math.min(Math.max(0, tg.cell.x - Math.floor(w / 2)), cols - w), Math.min(Math.max(0, tg.cell.y - Math.floor(h / 2)), rows - h), w, h), ok: false, label };
    }
    // a bar where it goes in the stack
    const c = live.current.cv;
    const list = sideStack(c, orient).filter((x) => x.id !== what.id);
    const tr = sideTracks(sideStack(c, orient));
    const sb = geo.side;
    if (!sb) return null;
    const at = list[tg.index];
    const prev = list[tg.index - 1];
    const b = at ? sideBox(geo, tr.get(at.id)!.start, tr.get(at.id)!.span) : prev ? sideBox(geo, tr.get(prev.id)!.start, tr.get(prev.id)!.span) : null;
    const thick = 6;
    let bar: Box;
    if (geo.row) {
      const x = b ? (at ? b.x - sb.gx / 2 : b.x + b.w + sb.gx / 2) : sb.x;
      bar = { x: x - thick / 2, y: sb.y, w: thick, h: sb.h };
    } else {
      const y = b ? (at ? b.y - sb.gy / 2 : b.y + b.h + sb.gy / 2) : sb.y;
      bar = { x: sb.x, y: y - thick / 2, w: sb.w, h: thick };
    }
    return { box: null, bar, ok: tg.ok, label: tg.ok ? undefined : t('No cabe en la barra lateral') };
  };

  /** Apply a drop. */
  const dropAt = (tg: Target, what: { id?: string; kind: CanvasKind; props?: Record<string, unknown> }): boolean => {
    const c = live.current.cv;
    if (!tg) return false;
    let r: Result;
    if (tg.zone === 'main') {
      if (!tg.drop) {
        live.current.refuse('noRoom', tg.inWay);
        return false;
      }
      r = what.id ? applyMain(c, orient, what.id, tg.drop) : addItem(c, orient, what.kind, { zone: 'main', drop: tg.drop }, what.props);
    } else {
      if (!tg.ok) {
        live.current.refuse('sideFull');
        return false;
      }
      const from = what.id ? placements(c, orient).get(what.id) : undefined;
      r = !what.id ? addItem(c, orient, what.kind, { zone: 'side', index: tg.index }, what.props) : from?.zone === 'side' ? reorderSide(c, orient, what.id, tg.index) : toSide(c, orient, what.id, tg.index);
    }
    if (!r.ok) {
      if (r.why !== 'noRoom' || tg.zone === 'main') live.current.refuse(r.why);
      return false;
    }
    live.current.commit(r, what.id ? 'move' : 'add');
    if (r.id) live.current.onSelect(r.id);
    if (tg.zone === 'main' && tg.drop?.replace) live.current.onReplaced?.(tg.drop.replace);
    return true;
  };

  // the palette drags its tiles here
  props.apiRef.current = {
    hover(spec, cx, cy) {
      const p = toScreen(cx, cy);
      if (!p || !p.inside || ro) {
        setGhost(null);
        setBusy(false);
        return false;
      }
      setBusy(true);
      const tg = targetAt(p.x, p.y, { kind: spec.kind });
      setGhost(ghostFor(tg, { kind: spec.kind }));
      return !!tg;
    },
    drop(spec, cx, cy) {
      setGhost(null);
      setBusy(false);
      const p = toScreen(cx, cy);
      if (!p || !p.inside || ro) return false;
      return dropAt(targetAt(p.x, p.y, { kind: spec.kind }), { kind: spec.kind, props: spec.props });
    },
    leave() {
      setGhost(null);
      setBusy(false);
    },
  };

  /** Drag an item by its body. */
  const onItemDown = (e: PointerEvent, id: string) => {
    if (props.preview) return;
    const el = e.currentTarget as HTMLElement;
    const it = itemOf(cv, id);
    if (!it) return;
    let grab: { x: number; y: number } | undefined;
    let last: Target = null;
    gesture(e, el, {
      onTap: (ev) => {
        // "modo colocar": a tap on a card places the new one in the nearest free spot (or says there is no room),
        // it does not pick the card under the finger
        const pl2 = live.current.placing;
        if (pl2) {
          const p = toScreen(ev.clientX, ev.clientY);
          if (p && !ro && dropAt(targetAt(p.x, p.y, { kind: pl2.kind }), { kind: pl2.kind, props: pl2.props })) live.current.onPlaced();
          setGhost(null);
          return;
        }
        props.onSelect(id);
      },
      onStart: (ev) => {
        if (ro || live.current.placing) return false;
        props.onSelect(id);
        const p = toScreen(ev.clientX, ev.clientY);
        const at = placements(live.current.cv, orient).get(id);
        if (p && at?.zone === 'main') {
          const c = cellAt(geo, orient, p.x, p.y);
          grab = { x: c.x - at.x, y: c.y - at.y };
        }
        setBusy(true);
        return true;
      },
      onMove: (ev) => {
        const p = toScreen(ev.clientX, ev.clientY);
        last = p ? targetAt(p.x, p.y, { id, kind: it.kind, grab }) : null;
        setGhost(ghostFor(last, { id, kind: it.kind }));
      },
      onEnd: () => {
        setGhost(null);
        setBusy(false);
        dropAt(last, { id, kind: it.kind });
      },
      onCancel: () => {
        setGhost(null);
        setBusy(false);
      },
    });
  };

  /**
   * The size handle: a tap steps to the next named size; a drag gives any w×h in whole cells under the pointer (within
   * the kind's range, and where it would cover another card the legal box nearest to it), "w×h" on the ghost.
   */
  const onHandleDown = (e: PointerEvent, id: string) => {
    e.stopPropagation();
    if (ro || props.preview) return;
    const el = e.currentTarget as HTMLElement;
    const it = itemOf(cv, id);
    const at = pl.get(id);
    if (!it || !at) return;
    let want: CellsBox | null = null;
    gesture(e, el, {
      longPress: false,
      onTap: () => {
        const c = live.current.cv;
        let r = stepSize(c, orient, id, 1);
        // past the largest: back to the smallest
        if (!r.ok && at.zone === 'main') r = resize(c, orient, id, sizesOf(sizingOf(it), orient)[0]);
        if (r.ok) live.current.commit(r, 'size');
        else live.current.refuse(r.why);
      },
      onStart: () => {
        if (at.zone !== 'main') return false;
        setBusy(true);
        return true;
      },
      onMove: (ev) => {
        if (at.zone !== 'main') return;
        const p = toScreen(ev.clientX, ev.clientY);
        if (!p) return;
        const c = cellAt(geo, orient, p.x, p.y);
        const tw = Math.max(1, c.x - at.x + 1);
        const th = Math.max(1, c.y - at.y + 1);
        const best = handleBox(live.current.cv, orient, id, tw, th);
        want = best;
        if (!best) {
          setGhost({ box: cellBox(geo, orient, at.x, at.y, tw, th), ok: false, label: t('No hay sitio para este tamaño') });
          return;
        }
        const [w, h] = boxCells(best, orient, G);
        const r = rangeOf(sizingOf(it), orient, G);
        // at the kind's edge the label says so
        const edge = tw > r.maxW || th > r.maxH ? ` · ${t('máximo')}` : tw < r.minW || th < r.minH ? ` · ${t('mínimo')}` : '';
        setGhost({ box: cellBox(geo, orient, at.x, at.y, w, h), ok: true, label: `${w}×${h}${edge}` });
      },
      onEnd: () => {
        setGhost(null);
        setBusy(false);
        if (!want || at.zone !== 'main') return;
        const [w0, h0] = boxCells(at, orient, G);
        const [w1, h1] = boxCells(want, orient, G);
        if (w0 === w1 && h0 === h1) return;
        const r = applyBox(live.current.cv, orient, id, want);
        if (r.ok) live.current.commit(r, 'size');
        else live.current.refuse(r.why);
      },
      onCancel: () => {
        setGhost(null);
        setBusy(false);
      },
    });
  };

  /** A tap on the empty canvas: places the widget being placed, or clears the selection. */
  const onBackDown = (e: PointerEvent) => {
    if (props.preview || e.target !== e.currentTarget) return;
    const el = e.currentTarget as HTMLElement;
    gesture(e, el, {
      longPress: false,
      onTap: (ev) => {
        const pl2 = live.current.placing;
        if (pl2) {
          const p = toScreen(ev.clientX, ev.clientY);
          if (p && !ro && dropAt(targetAt(p.x, p.y, { kind: pl2.kind }), { kind: pl2.kind, props: pl2.props })) live.current.onPlaced();
          setGhost(null);
          return;
        }
        props.onSelect(null);
      },
      onStart: () => false,
      onMove: () => {},
      onEnd: () => {},
      onCancel: () => {},
    });
  };
  // "modo colocar" with a mouse: the ghost follows the pointer
  const onBackMove = (e: PointerEvent) => {
    const pl2 = props.placing;
    if (!pl2 || e.pointerType === 'touch' || ro) return;
    const p = toScreen(e.clientX, e.clientY);
    if (!p) return;
    setGhost(ghostFor(targetAt(p.x, p.y, { kind: pl2.kind }), { kind: pl2.kind }));
  };

  const order = tabOrder(cv, orient);
  const showCells = busy || !!props.placing;
  const { cols, rows } = grid(orient, G);
  const sel = props.selected && pl.get(props.selected) ? props.selected : null;
  const selBox = sel ? boxOf(sel) : null;
  const selPos = sel ? pl.get(sel) : null;
  const px = (b: Box) => ({ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
  const sizeTag = (id: string) => {
    const p = pl.get(id);
    if (!p) return '';
    if (p.zone === 'side') return t(SPAN_LABEL[String(p.span)]);
    const [w, h] = boxCells(p, orient, G);
    return p.w === undefined ? `${t(SIZE_LABEL[p.size])} · ${w}×${h}` : `${w}×${h}`;
  };

  return (
    <div class="bld-stage" ref={box} onPointerDown={(e) => e.target === e.currentTarget && props.onOutside?.()}>
      <div class={`bld-screen ${orient === 'portrait' ? 'is-portrait' : ''}`} style={{ width: `${W * s}px`, height: `${H * s}px` }}>
        {props.url ? (
          <iframe
            key={`${props.url}|${orient}`}
            ref={frame}
            class="bld-frame"
            src={props.url}
            title={t('Vista previa')}
            tabIndex={-1}
            style={{ width: `${W}px`, height: `${H}px`, transform: `scale(${s})` }}
            onLoad={() => setLoaded(true)}
          />
        ) : (
          <div class="bld-noframe muted small">{t('Guarda la pantalla una vez para ver aquí cómo queda. Mientras tanto puedes colocar los widgets.')}</div>
        )}
        {props.url && !loaded && <div class="bld-loading shimmer" />}
        {!props.preview && (
          <div
            ref={ov}
            class={`bld-ov ${showCells ? 'is-busy' : ''} ${props.placing ? 'is-placing' : ''} ${ro ? 'is-readonly' : ''} ${props.url ? '' : 'is-bare'}`}
            style={{ width: `${W}px`, height: `${H}px`, transform: `scale(${s})`, '--s': String(s) } as Record<string, string>}
            onPointerDown={onBackDown}
            onPointerMove={onBackMove}
            onPointerLeave={() => props.placing && setGhost(null)}
          >
            {showCells && (
              <div class="bld-cells" aria-hidden="true">
                {Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => <i style={px(cellBox(geo, orient, x, y, 1, 1))} />))}
                {geo.side && <b class="bld-sidezone" style={px(geo.side)} />}
              </div>
            )}
            {order.map((id) => {
              const it = itemOf(cv, id)!;
              const b = boxOf(id);
              if (!b) return null;
              const name = it.kind === 'widget' ? t('Widget') : t(kindName(it.kind));
              const soon = KIND_META[it.kind]?.soon;
              const why = props.why?.get(id) ?? null;
              // a card that draws nothing still takes its cells: a dashed box with its name, so it can be found
              const vd = voidOf(cv, id);
              const isVoid = vd === 'space' || vd === 'empty';
              const vtext = vd === 'empty' ? t('Vacío') : null;
              return (
                <button
                  type="button"
                  key={id}
                  data-id={id}
                  class={`bld-it ${sel === id ? 'is-sel' : ''} ${it.hidden ? 'is-hidden' : ''} ${isVoid ? 'is-void' : ''} ${props.url ? '' : 'is-bare'}`}
                  style={px(b)}
                  title={vd === 'empty' ? t('No tiene nada que mostrar ahora, así que en la pantalla no se ve, pero ocupa su sitio. Suelta otra tarjeta encima para usar el hueco.') : vd === 'space' ? t('Un hueco vacío. Suelta otra tarjeta encima para usar el sitio.') : undefined}
                  aria-label={`${name} · ${sizeTag(id)}${vtext ? ` · ${vtext}` : ''}${why ? ` · ${t(HIDDEN_TEXT[why].badge)}` : ''}`}
                  aria-pressed={sel === id}
                  onPointerDown={(e) => onItemDown(e, id)}
                  // the keyboard's Tab selects; a focus the page moves here by itself (a sheet closing on a phone) does not
                  onFocus={(e) => props.selected !== id && (e.currentTarget as HTMLElement).matches(':focus-visible') && props.onSelect(id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    props.onMenu(id, { x: e.clientX, y: e.clientY });
                  }}
                >
                  {(!props.url || it.hidden || soon || isVoid) && (
                    <span class="bld-it__name">
                      <Icon name={KIND_META[it.kind]?.icon ?? 'widget'} size={18} />
                      {name}
                      {vtext && props.url && <span class="bld-it__void">{vtext}</span>}
                    </span>
                  )}
                  {why && (
                    <span class={`bld-badge bld-badge--muted bld-badge--${why}`} title={t(HIDDEN_TEXT[why].long)}>
                      <Icon name={why === 'schedule' ? 'clock' : 'eyeOff'} size={14} /> {t(HIDDEN_TEXT[why].badge)}
                    </span>
                  )}
                  {props.picks?.has(id) && (
                    <span class="bld-badge bld-badge--warn bld-badge--top">
                      <Icon name="alert" size={14} /> {t(props.picks.get(id)!)}
                    </span>
                  )}
                  {!it.hidden && cramped.has(id) && (
                    <span
                      class={`bld-badge bld-badge--warn ${props.onFit && !ro ? 'is-tap' : ''}`}
                      title={props.onFit && !ro ? t('El contenido no cabe entero. Pulsa para ajustar el tamaño.') : t('El contenido no cabe entero; selecciónalo y pulsa Ajustar tamaño')}
                      onPointerDown={(e) => props.onFit && !ro && e.stopPropagation()}
                      onClick={(e) => {
                        if (!props.onFit || ro) return;
                        e.stopPropagation();
                        props.onFit(id);
                      }}
                    >
                      <Icon name="alert" size={14} /> {t('No cabe')}
                    </span>
                  )}
                </button>
              );
            })}
            {sel && selBox && (
              <div class={`bld-selection ${selBox.h < cellBox(geo, orient, 0, 0, 1, 2).h - 1 ? 'is-short' : ''}`} style={px(selBox)} aria-hidden="true">
                <span class="bld-selection__tag">{sizeTag(sel)}</span>
                {!ro && (
                  <span
                    class="bld-handle"
                    role="presentation"
                    title={selPos?.zone === 'side' ? t('Cambiar el alto') : t('Cambiar el tamaño')}
                    onPointerDown={(e) => onHandleDown(e as unknown as PointerEvent, sel)}
                  >
                    <Icon name="right" size={16} />
                  </span>
                )}
                <span
                  class="bld-more"
                  role="presentation"
                  title={t('Más')}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    props.onMenu(sel, { x: r.left, y: r.bottom });
                  }}
                >
                  <Icon name="more" size={16} />
                </span>
              </div>
            )}
            {ghost && (ghost.box || ghost.bar) && (
              <div class={`bld-ghost ${ghost.ok ? 'is-ok' : 'is-bad'} ${ghost.bar ? 'is-bar' : ''}`} style={px((ghost.box ?? ghost.bar)!)}>
                {ghost.label && <span class="bld-ghost__label">{ghost.label}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
