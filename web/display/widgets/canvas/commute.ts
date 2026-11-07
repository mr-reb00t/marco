// Personalizado "Trayectos" card (kind 'commute'): live travel times of the card's own routes, asked of this server
// (commuteFeed.ts, GET /api/display/commute?item=), which asks Google with the owner's key. The display never has the
// addresses: the card's props carry each route's id, name and mode only (canvasCore projectCanvas).
// Drawn with the data cards' building blocks (data.ts: the type size, the list rows, the fitting ladder; the Valor
// card's big number; the Home Assistant icon chips and state colours), in one of four designs:
//   focus  one route large: its time, the traffic as a chip ("+5 min", never colour alone), the arrival time
//   list   one row per route, as the Cripto list; side by side in columns in a wide, low box
//   line   one line per route (the compact look and the sidebar); one at a time in a box one cell high
//   pill   the time and a dot, centred (the smallest box)
// 'auto' (the default) picks one from the box and the number of routes, as Cripto and Valor do.
// Whenever a time from Google is drawn, "Google Maps" goes under it (googleMapsAttr.ts): in its own row at the bottom
// (with the "updated" note of old times beside it), inline at the end of a one-cell-high line, centred under the pill.
// It is never one of the things a design gives up to fit, and its size is fixed (rem), so shrinking the text keeps it.
import type { CommuteMode, CommuteResponse, CommuteRouteResult, DisplayCanvasItem, DisplayCommuteCardProps } from '../../../shared/types';
import { delayMinutes, formatDistance, formatDurationParts } from '../../../../server/core/commuteCore.js';
import { formatTime, LOCALES } from '../../../shared/i18n';
import { ctx } from '../../ctx';
import { isPreview } from '../../identity';
import { demoCommute } from '../../mockCommute';
import { g, HA_ICON } from '../ha/haIcons';
import { ago } from '../ha/haui';
import { googleMapsAttr, inkGoogleMapsAttr } from '../googleMapsAttr';
import { bigType, fitWidth, typeCap } from './clock';
import { cut, dropRow, ladder, sideways, staleFoot } from './data';
import type { AdapterBox, AdapterEnv, CanvasAdapter } from './types';

type Look = 'focus' | 'list' | 'cols' | 'lines' | 'line' | 'pill';
const LOOK_CLASSES = ['is-focus', 'is-list', 'is-cols', 'is-lines', 'is-line', 'is-pill', 'is-wide', 'is-across', 'is-stale', 'no-name', 'has-end'];
type Route = CommuteRouteResult & { label: string };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The mode icons: 24×24 strokes like every icon of the canvas cards (ha/haIcons.ts). */
const MODE_ICON: Record<CommuteMode, string> = {
  driving: HA_ICON.car,
  transit: g('<rect x="5" y="3.5" width="14" height="14" rx="2.5"/><path d="M5 11h14"/><path d="M9.5 6.5h5"/><circle cx="8.5" cy="14.3" r=".8"/><circle cx="15.5" cy="14.3" r=".8"/><path d="M7.5 17.5v2.5M16.5 17.5v2.5"/>'),
  bicycling: g('<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16 9 9.5l3 6.5h-6.5"/><path d="M9 9.5h6.2L12 16"/><path d="M15.2 9.5 18.5 16"/><path d="M14.4 7h2.6"/><path d="M7.6 7.5h3"/>'),
  walking: g('<circle cx="12.5" cy="4.3" r="1.8"/><path d="M12 8.2 10.6 14.5"/><path d="M10.6 14.5 8.4 20.5"/><path d="M10.6 14.5l3 3 .6 3"/><path d="M11.8 9.3 8.5 12.2"/><path d="M12.2 9.6l2.4 3 2.6.6"/>'),
};

function modeIcon(mode: CommuteMode, cls: string): HTMLElement {
  const e = el('span', cls);
  // (static markup: one of the icons above, never the item's text)
  const svg = MODE_ICON[mode] ?? MODE_ICON.driving;
  e.innerHTML = svg;
  return e;
}

const isLineBox = (root: HTMLElement) => root.dataset.mini !== undefined && root.dataset.mh === '1';

/** The time as numbers and units: [["24", "min"]], [["1", "h"], ["12", "min"]]. */
function durParts(sec: number): [string, string][] {
  const { hours, minutes } = formatDurationParts(sec);
  if (!hours) return [[String(minutes), ctx.t('commuteMin')]];
  return minutes ? [[String(hours), ctx.t('commuteHr')], [String(minutes), ctx.t('commuteMin')]] : [[String(hours), ctx.t('commuteHr')]];
}
const durText = (sec: number) => durParts(sec).map(([n, u]) => `${n} ${u}`).join(' ');

/** The big time: numbers in the Valor card's figures, units small beside them; "–" without a time. */
function bigDur(r: Route, cls = 'cv-val-num cv-cm-num'): HTMLElement {
  const n = el('div', cls);
  if (!r.ok || !r.durationSec) {
    n.appendChild(el('b', '', '–'));
    return n;
  }
  for (const [num, unit] of durParts(r.durationSec)) n.append(el('b', '', num), el('span', 'cv-val-unit', unit));
  return n;
}

/** The traffic of a driving route: "+5 min" on its colour, or "Fluido"; null for other modes and without a time. */
function trafficChip(r: Route): HTMLElement | null {
  if (r.mode !== 'driving' || !r.ok || !r.durationSec) return null;
  const level = r.traffic ?? 'clear';
  const late = typeof r.delayMin === 'number' ? r.delayMin : delayMinutes(r.durationSec, r.normalDurationSec ?? r.durationSec);
  const c = el('span', `cv-cm-tr is-${level}`);
  c.append(el('i', 'dot'), el('span', 'tx', late >= 1 ? ctx.t('commuteDelay', { n: late }) : ctx.t('commuteClear')));
  if (late >= 1) c.dataset.n = String(late);
  return c;
}

/** The mode icon in its round chip, coloured like a Home Assistant card when the traffic is slow. */
function modeChip(r: Route): HTMLElement {
  const lvl = r.mode === 'driving' && r.ok ? r.traffic ?? 'clear' : 'clear';
  return modeIcon(r.mode, `cv-ha-ico cv-cm-ico is-${lvl}`);
}

function nameEl(r: Route, cls = 'cv-cm-name'): HTMLElement {
  const w = el('span', cls, r.label);
  return w;
}

/** "vuelta" after a route that shows the way back. */
const backEl = (r: Route) => (r.reversed ? el('span', 'cv-cm-back', ctx.t('commuteBack')) : null);

/** The class of a route's row, line or column: its traffic, and is-old when its time is old (dimmed on its own). */
const rowCls = (r: Route) => `is-${r.mode === 'driving' && r.ok ? r.traffic ?? 'clear' : 'clear'}${r.ok && r.stale ? ' is-old' : ''}`;

const over = (e: Element) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1;

/**
 * Something is cut (data.ts cut), a line is pushed wider than its place (a name keeps a few letters at the least,
 * floorNames) or the line under a list name ends in "…". The names of the lists and the lines may end in "…" (the
 * times are what they are for), so they are not in data.ts CLIP.
 */
function bad(root: HTMLElement): boolean {
  return cut(root) || [...root.querySelectorAll('.cv-cm-ln, .cv-cm-lmeta')].some(over);
}

/** A name of a list, a line or a column ends in "…". */
const namesCut = (root: HTMLElement) => [...root.querySelectorAll('.cv-cm-lname')].some(over);

/** data.ts ladder, with bad(). */
function fit(root: HTMLElement, steps: (() => boolean | void)[]): void {
  let i = 0;
  let guard = 60;
  while (i < steps.length && guard-- > 0 && bad(root)) if (steps[i]() !== true) i++;
}

/**
 * The text at the largest size between `lo` and `hi` (--dk) at which nothing is cut; false when even `lo` is cut
 * (the text is left at `lo`).
 */
function fitDk(root: HTMLElement, lo: number, hi: number): boolean {
  const set = (k: number) => root.style.setProperty('--dk', k.toFixed(3));
  set(hi);
  if (!bad(root)) return true;
  set(lo);
  if (bad(root)) return false;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 7; i++) {
    const m = (a + b) / 2;
    set(m);
    if (bad(root)) b = m;
    else a = m;
  }
  set(Math.max(lo, a * 0.98));
  return true;
}

/**
 * Give things up in order until the text fits at its floor: each stage changes the card, then the text is made as
 * large as fits between the stage's floor and `hi`.
 */
function stages(root: HTMLElement, hi: number, plan: [number, (() => void) | null][]): void {
  for (const [floor, step] of plan) {
    step?.();
    if (fitDk(root, Math.min(floor, hi), hi)) return;
  }
}

/** A name of a line keeps a few letters and its "…" at the least: past that the text gets smaller, not the name. */
function floorNames(root: HTMLElement): void {
  for (const n of root.querySelectorAll<HTMLElement>('.cv-cm-ln .cv-cm-lname, .cv-cm-name.is-soft')) {
    const fs = parseFloat(getComputedStyle(n).fontSize);
    if (fs > 0) n.style.minWidth = `${Math.min(n.scrollWidth / fs, 4.2).toFixed(2)}em`;
  }
}

/** The traffic chips with the minutes only ("+5"; "Fluido" stays). */
function shortChips(root: HTMLElement): void {
  for (const c of root.querySelectorAll<HTMLElement>('.cv-cm-tr[data-n] .tx')) c.textContent = `+${(c.parentElement as HTMLElement).dataset.n}`;
}

const dropAll = (root: HTMLElement, sel: string) => () => root.querySelectorAll(sel).forEach((x) => x.remove());

export function commuteAdapter(item0: DisplayCanvasItem): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let box: AdapterBox | null = null;
  let sig = '';
  let idx = 0;
  let turnAt = Date.now();
  let turning = 0;
  /** A time from Google is drawn: the attribution goes with it. */
  let google = false;

  const props = () => env.item().props as unknown as DisplayCommuteCardProps;

  /** The times to draw: the server's, the demo's, or made-up ones in the preview of an unsaved card ('sample'). */
  const data = (): { d: CommuteResponse | null | undefined; sample: boolean } => {
    const st = env.commute.state(item0.id);
    if (st === 'sample') return { d: demoCommute(props().routes ?? [], Date.now()), sample: true };
    return { d: env.commute.get(item0.id), sample: false };
  };

  /** The routes on show now (outside their schedule they are left out), each with what names it. */
  const shown = (d: CommuteResponse): Route[] => {
    const own = props().routes ?? [];
    return d.routes.filter((r) => r.active !== false).map((r) => {
      const i = own.findIndex((x) => x.id === r.id);
      const name = r.name || own[i]?.name || '';
      return { ...r, mode: r.mode || own[i]?.mode || 'driving', label: name || ctx.t('commuteRoute', { n: i >= 0 ? i + 1 : 1 }) };
    });
  };

  const units = (): 'metric' | 'imperial' => {
    const u = props().units ?? 'auto';
    if (u === 'metric' || u === 'imperial') return u;
    return ctx.cfg?.weather?.units === 'imperial' ? 'imperial' : 'metric';
  };
  const arrival = (r: Route): string => {
    if (props().showArrival === false || !r.ok || !r.durationSec) return '';
    const at = new Date(env.now().now.getTime() + r.durationSec * 1000);
    return ctx.t('commuteEta', { t: formatTime(at, ctx.tz, ctx.cfg?.datetime?.format24 !== false) });
  };
  const via = (r: Route): string => (props().showRouteSummary !== false && r.summary ? ctx.t('commuteVia', { s: r.summary }) : '');
  const dist = (r: Route): string => (r.ok && r.distanceMeters ? formatDistance(r.distanceMeters, units(), LOCALES[ctx.lang]) : '');
  const failText = (r: Route) => ctx.t(r.error === 'no_route' ? 'commuteNoRoute' : 'dtNoDataRow');

  /** "Actualizado hace 52 min" when the times shown are old, else ''. */
  const staleOf = (rs: Route[]): string => {
    let oldest = Infinity;
    for (const r of rs) {
      if (!r.ok || !r.stale) continue;
      const t = r.fetchedAt ? Date.parse(r.fetchedAt) : NaN;
      oldest = Math.min(oldest, Number.isFinite(t) ? t : 0);
    }
    if (oldest === Infinity) return '';
    return oldest ? ctx.t('dtUpdated', { when: ago(oldest) }) : ctx.t('dtNoData');
  };

  /** The design for this box and this many routes ('auto'), or the owner's when the box holds it. */
  const lookOf = (n: number): Look => {
    if (isLineBox(root)) return 'line';
    const want = props().look ?? 'auto';
    const b = box;
    const ratio = b ? b.w / Math.max(1, b.h) : 1;
    const mini = root.dataset.mini !== undefined;
    if (want === 'pill') return 'pill';
    if (want === 'line' || mini) return 'lines';
    if (want === 'focus') return 'focus';
    // a wide, low box: the routes side by side, each in a column wide enough for its name and its time
    const wideLow = !!b && n >= 2 && ratio >= 2.4 && b.w / n / b.rem >= 18;
    if (want === 'list') return wideLow ? 'cols' : 'list';
    if (b?.size === 'xs') return 'pill';
    if (b?.size === 's' || n <= 1) return 'focus';
    return wideLow ? 'cols' : 'list';
  };

  const note = (text: string) => root.appendChild(el('span', 'cv-dt-note', text));
  const attr = () => googleMapsAttr('cv-cm-attr');
  /** The bottom row: the note of old times (it may go to fit) and the attribution (it never goes); null when empty. */
  const endRow = (stale: string): HTMLElement | null => {
    if (!stale && !google) return null;
    const e = el('div', 'cv-cm-end');
    if (stale) e.appendChild(staleFoot(stale));
    if (google) e.appendChild(attr());
    return e;
  };
  const addEnd = (stale: string) => {
    const e = endRow(stale);
    if (e) root.appendChild(e);
    root.classList.toggle('has-end', !!e);
  };
  /** A step: the note of old times goes (the attribution stays). */
  const dropFoot = () => {
    root.querySelector('.cv-dt-foot')?.remove();
    root.querySelector('.cv-cm-end:empty')?.remove();
  };
  /** The name of a card that shows its routes in turn may end in "…" (data.ts CLIP leaves .is-soft out). */
  const softName = () => (turning > 1 ? 'cv-cm-name is-soft' : 'cv-cm-name');

  const render = (force = false) => {
    if (!root) return;
    const it = env.item();
    const p = props();
    const { d, sample } = data();
    const st = env.commute.state(item0.id);
    const s = JSON.stringify([it.v, d, st, box?.w, box?.h, box?.size, root.dataset.mini, root.dataset.mh, root.dataset.room, ctx.lang, idx, Math.floor(env.now().now.getTime() / 60_000)]);
    if (s === sig && !force) return;
    sig = s;
    root.textContent = '';
    root.classList.remove(...LOOK_CLASSES);
    root.style.setProperty('--dk', '1');
    root.style.removeProperty('--wk');
    turning = 0;
    google = false;
    if (!p.routes?.length) return note(ctx.t('cvSetup'));
    if (d === undefined) return note(ctx.t('dtLoading'));
    if (d === null) {
      // (on a screen the card is not drawn: empty())
      if (isPreview || st !== 'gone') note(ctx.t(st === 'error' ? 'dtNoData' : 'commuteNoRoutes'));
      return;
    }
    if (!d.keySet) return note(ctx.t('commuteKeyMissing'));
    const rs = shown(d);
    if (!rs.length) {
      if (isPreview) note(ctx.t('commuteNoRoutes'));
      return;
    }
    google = rs.some((r) => r.ok && !!r.durationSec);
    const look = lookOf(rs.length);
    root.classList.add(`is-${look}`);
    const one = look === 'focus' || look === 'pill' || look === 'line';
    if (one && rs.length > 1) turning = rs.length;
    idx = turning ? idx % rs.length : 0;
    // (several routes: each old time is dimmed on its own row, and the line under the card names it when it is one)
    let stale = one ? staleOf([rs[idx]]) : staleOf(rs);
    const olds = rs.filter((r) => r.ok && r.stale);
    if (!one && stale && olds.length === 1 && rs.length > 1) stale = `${olds[0].label} · ${stale}`;
    root.classList.toggle('is-stale', one && !!stale);
    const scale = Number(it.style?.scale) || 1;
    if (look === 'focus') drawFocus(rs, stale, scale);
    else if (look === 'pill') drawPill(rs[idx], rs.length, stale, scale);
    else if (look === 'line') drawLine(rs[idx]);
    else if (look === 'cols') {
      // side by side only while every column keeps its route's whole name: else one row per route
      drawCols(rs, stale);
      if (root.classList.contains('no-name') || namesCut(root)) {
        root.textContent = '';
        root.classList.remove('is-cols', 'no-name');
        root.classList.add('is-list');
        root.style.setProperty('--dk', '1');
        drawList(rs, stale);
      }
    }
    else if (look === 'lines') drawLines(rs, stale);
    else drawList(rs, stale);
    if (sample) {
      const tag = el('span', 'cv-dt-range is-pill cv-cm-sample', ctx.t('commuteSample'));
      root.appendChild(tag);
    }
    inkGoogleMapsAttr(root.querySelector<HTMLElement>('.gm-attr'), root);
  };

  // ---------------------------------------------------------------------------------------------- focus
  const drawFocus = (rs: Route[], stale: string, scale: number) => {
    const r = rs[idx];
    const b = box;
    const wide = !!b && b.w / Math.max(1, b.h) >= 2 && b.zone === 'main';
    root.classList.toggle('is-wide', wide);
    const head = el('div', 'cv-mk-head cv-cm-head');
    head.append(modeChip(r), nameEl(r, softName()));
    const back = backEl(r);
    if (back) head.appendChild(back);
    if (rs.length > 1) {
      const dots = el('span', 'cv-mk-dots');
      rs.forEach((_x, i) => dots.appendChild(el('i', i === idx ? 'on' : '')));
      head.appendChild(dots);
    }
    const body = el('div', 'cv-cm-body');
    const left = el('div', 'cv-cm-main');
    left.appendChild(r.ok ? bigDur(r) : el('div', 'cv-cm-fail', failText(r)));
    const right = el('div', 'cv-cm-info');
    const status = el('div', 'cv-cm-status');
    const chip = trafficChip(r);
    if (chip) status.appendChild(chip);
    const eta = arrival(r);
    if (eta) status.appendChild(el('span', 'cv-cm-eta', eta));
    if (status.childElementCount) right.appendChild(status);
    // how much of the time is the traffic: the usual time and the extra, on one bar (driving, and room for it)
    const late = r.ok && r.mode === 'driving' && r.normalDurationSec && r.durationSec && r.durationSec > r.normalDurationSec + 30;
    if (late && b && b.h / b.rem >= 16 && b.w / b.rem >= 26) {
      const bar = el('div', `cv-cm-bar is-${r.traffic ?? 'clear'}`);
      const track = el('span', 'cv-cm-track');
      const usual = el('i', 'usual');
      usual.style.width = `${((r.normalDurationSec! / r.durationSec!) * 100).toFixed(1)}%`;
      track.append(usual, el('i', 'extra'));
      bar.append(track, el('span', 'cv-cm-usual', ctx.t('commuteTypical', { n: Math.round(r.normalDurationSec! / 60) })));
      right.appendChild(bar);
    }
    const meta = el('div', 'cv-cm-meta');
    const v = via(r);
    const km = dist(r);
    if (v) meta.appendChild(el('span', 'cv-cm-via', v));
    if (km) meta.appendChild(el('span', 'cv-cm-dist', km));
    if (meta.childElementCount) right.appendChild(meta);
    body.append(left, right);
    root.append(head, body);
    addEnd(stale);
    if (!b) return;
    // the type as large as the box allows (the Valor card's rule), then whatever does not fit goes, in this order
    const wk0 = fitWidth(root, left.firstElementChild as HTMLElement, bigType(root, b, wide ? 15 : 22, scale, wide ? 34 : 20, typeCap(root)));
    const wk = (f: number) => () => root.style.setProperty('--wk', Math.max(0.3, wk0 * f).toFixed(3));
    const drop = (sel: string) => () => {
      root.querySelector(sel)?.remove();
      for (const x of root.querySelectorAll('.cv-cm-meta:empty, .cv-cm-status:empty')) x.remove();
    };
    floorNames(root);
    // (the name goes only after the type got smaller, and never while the routes take turns: it says which one is on)
    ladder(root, [
      drop('.cv-cm-via'), drop('.cv-cm-dist'), drop('.cv-cm-bar'), drop('.cv-cm-eta'),
      sideways(root, dropAll(root, '.cv-cm-back')),
      wk(0.85), wk(0.72),
      ...(turning > 1 ? [] : [sideways(root, () => root.classList.add('no-name'))]),
      wk(0.6), wk(0.5), wk(0.4),
    ]);
  };

  // ---------------------------------------------------------------------------------------------- pill
  const drawPill = (r: Route, n: number, stale: string, scale: number) => {
    const top = el('div', 'cv-cm-top');
    top.append(modeIcon(r.mode, 'cv-cm-mi'), nameEl(r, softName()));
    const mid = r.ok ? bigDur(r) : el('div', 'cv-cm-fail', failText(r));
    root.append(top, mid);
    // the traffic of a car; the arrival time of the other modes (no traffic to tell)
    const chip = trafficChip(r);
    const eta = chip ? '' : arrival(r);
    if (chip) root.appendChild(chip);
    else if (eta) root.appendChild(el('span', 'cv-cm-eta', eta));
    if (n > 1) {
      const dots = el('span', 'cv-mk-dots cv-cm-dots');
      for (let i = 0; i < n; i++) dots.appendChild(el('i', i === idx ? 'on' : ''));
      root.appendChild(dots);
    }
    if (google) root.appendChild(attr());
    if (stale) root.classList.add('is-stale');
    if (!box) return;
    const wk0 = fitWidth(root, mid, bigType(root, box, 15, scale, 15, typeCap(root)));
    const wk = (f: number) => () => root.style.setProperty('--wk', Math.max(0.3, wk0 * f).toFixed(3));
    floorNames(root);
    // (the name says which route it is: it goes only after the type got smaller, and never while the routes take turns)
    ladder(root, [
      () => root.querySelector('.cv-cm-dots')?.remove(),
      wk(0.85), wk(0.72),
      ...(turning > 1 ? [] : [() => root.classList.add('no-name')]),
      wk(0.6), wk(0.5), wk(0.4),
    ]);
  };

  // ---------------------------------------------------------------------------------------------- one line
  /** One route on one line: the icon, the name, the time and the traffic, as large as the box allows. */
  const lineRow = (r: Route): HTMLElement => {
    const row = el('div', `cv-cm-ln ${rowCls(r)}`);
    // (the name may end in "…", never below a few letters: floorNames)
    row.append(modeIcon(r.mode, 'cv-cm-mi'), nameEl(r, 'cv-cm-lname'));
    const back = backEl(r);
    if (back) row.appendChild(back);
    const val = el('div', 'cv-cm-val');
    if (r.ok && r.durationSec) {
      const dur = el('b', 'cv-cm-dur');
      for (const [i, [num, unit]] of durParts(r.durationSec).entries()) {
        if (i) dur.append(' ');
        dur.append(num, el('span', 'u', ` ${unit}`));
      }
      val.appendChild(dur);
    } else val.appendChild(el('span', 'cv-dt-nd', failText(r)));
    const chip = trafficChip(r);
    if (chip) val.appendChild(chip);
    row.appendChild(val);
    return row;
  };

  const drawLine = (r: Route) => {
    const row = lineRow(r);
    if (google) row.appendChild(attr());
    root.appendChild(row);
    if (!box) return;
    // as large as the box's height allows, then smaller before anything goes; the name goes last, and never while the
    // card shows its routes in turn (it is what says which one is on)
    const k = Math.max(0.8, Math.min(3, (box.h * 0.45) / (box.rem * 1.6)));
    floorNames(root);
    // ("Google Maps" takes room on this one line: the chip says "+5" and the way back goes before the text gets smaller)
    stages(root, k, [
      [k, null],
      [k, dropAll(root, '.cv-cm-back')],
      [k, () => shortChips(root)],
      [0.8, null],
      [0.5, dropAll(root, '.cv-cm-dur .u')],
      ...(turning > 1 ? [] : [[0.5, () => root.classList.add('no-name')] as [number, () => void]]),
      [0.4, null],
    ]);
  };

  const drawLines = (rs: Route[], stale: string) => {
    const list = el('div', 'cv-cm-lines');
    const b = box;
    // a wide box too low for the rows one under another: side by side
    const across = !!b && rs.length > 1 && b.h / b.rem < rs.length * 3.4 && b.w / rs.length / b.rem >= 20;
    root.classList.toggle('is-across', across);
    if (across) list.style.gridTemplateColumns = `repeat(${rs.length}, minmax(0, 1fr))`;
    for (const r of rs) list.appendChild(lineRow(r));
    root.appendChild(list);
    addEnd(stale);
    if (!b) return;
    floorNames(root);
    fit(root, [dropFoot, dropRow(root, list, '.cv-cm-ln')]);
    // the text smaller before the names go, and the names only when one route is left
    const one = list.childElementCount < 2;
    stages(root, 1, [
      [1, null],
      [0.85, dropAll(root, '.cv-cm-back')],
      [0.7, () => shortChips(root)],
      [0.55, dropAll(root, '.cv-cm-dur .u')],
      ...(one ? [[0.55, () => root.classList.add('no-name')] as [number, () => void]] : []),
      [0.45, null],
    ]);
    // one or two lines in a large box read from across the room: they grow with it
    grow(root, list.childElementCount <= 2 ? 3.5 : 1.8);
  };

  // ---------------------------------------------------------------------------------------------- list
  /**
   * The list in one arrangement: the arrival and the road under each name or not (`meta`), the traffic beside the
   * time or under it (`inline`); fitted (rows dropped and the text made smaller until nothing is cut, then grown).
   * Returns how many rows it shows and its text size.
   */
  const listOnce = (rs: Route[], stale: string, meta: boolean, inline: boolean): { rows: number; k: number; meta: boolean } => {
    root.textContent = '';
    root.classList.remove('no-name');
    root.style.setProperty('--dk', '1');
    const list = el('div', 'cv-mk-list cv-cm-list');
    for (const r of rs) {
      const row = el('div', `cv-mk-row cv-cm-row ${rowCls(r)}`);
      const who = el('div', 'cv-mk-who');
      const txt = el('div', 'cv-cm-txt');
      const nm = el('div', 'cv-cm-nl');
      // (a long name ends in "…" rather than making every row smaller: the times are what the row is for)
      nm.appendChild(nameEl(r, 'cv-cm-lname'));
      const back = backEl(r);
      if (back) nm.appendChild(back);
      txt.appendChild(nm);
      // the arrival and the road; the road goes first when the line is too long (never cut in the middle of a word)
      const parts = meta ? [arrival(r), via(r)].filter(Boolean) : [];
      if (parts.length) {
        const line = el('span', 'cv-cm-lmeta');
        parts.forEach((x, i) => line.appendChild(el('span', i ? 'cv-cm-lvia' : 'cv-cm-leta', `${i ? ' · ' : ''}${x}`)));
        txt.appendChild(line);
      }
      who.append(modeChip(r), txt);
      const val = el('div', `cv-mk-val${inline ? ' is-inline' : ''}`);
      if (r.ok && r.durationSec) val.appendChild(el('b', 'cv-mk-p cv-cm-dur', durText(r.durationSec)));
      else val.appendChild(el('span', 'cv-dt-nd', failText(r)));
      const chip = trafficChip(r);
      if (chip) val.appendChild(chip);
      row.append(who, val);
      list.appendChild(row);
    }
    root.appendChild(list);
    addEnd(stale);
    if (!box) return { rows: rs.length, k: 1, meta };
    const lmetaCut = () => [...root.querySelectorAll('.cv-cm-lmeta')].some(over);
    fit(root, [
      dropRow(root, list, '.cv-mk-row'),
      () => {
        if (lmetaCut()) root.querySelectorAll('.cv-cm-lvia').forEach((x) => x.remove());
      },
      () => {
        if (lmetaCut()) root.querySelectorAll('.cv-cm-lmeta').forEach((x) => x.remove());
      },
      () => {
        if (namesCut(root)) root.querySelectorAll('.cv-cm-back').forEach((x) => x.remove());
      },
    ]);
    stages(root, 1, [
      [1, null],
      [0.9, dropAll(root, '.cv-cm-back')],
      [0.7, null],
      ...(list.childElementCount < 2 ? [[0.7, () => root.classList.add('no-name')] as [number, () => void]] : []),
    ]);
    grow(root, list.childElementCount <= 2 ? 3 : 1.7);
    const k = parseFloat(root.style.getPropertyValue('--dk')) || 1;
    // (the line under the names only with the text above its size: smaller it does not read from a distance)
    const hasMeta = !!root.querySelector('.cv-cm-lmeta');
    return { rows: list.childElementCount, k, meta: hasMeta && k >= 1.2 };
  };

  /**
   * One row per route: the arrangement that shows every route, at the largest text; the arrival and the road stay
   * unless leaving them out makes the text a quarter larger or keeps a route on the card.
   */
  const drawList = (rs: Route[], stale: string) => {
    const tries: [boolean, boolean][] = [[true, false], [false, false]];
    if (box && box.w / box.rem >= 34) tries.splice(1, 0, [true, true], [false, true]);
    let best: { meta: boolean; inline: boolean; score: number } | null = null;
    for (const [meta, inline] of tries) {
      const r = listOnce(rs, stale, meta, inline);
      // (the line under the names is kept only when it reads, or not at all)
      if (meta && !r.meta) continue;
      // (with the arrival lines and the text at least 1.25 times its size, it reads well enough: those win)
      const score = r.rows * 10 + (meta && r.k >= 1.25 ? 5 + r.k : r.k * (meta ? 1.25 : 1));
      if (!best || score > best.score + 0.01) best = { meta, inline, score };
      if (!box) break;
    }
    if (best && (tries.length > 1 || !box)) listOnce(rs, stale, best.meta, best.inline);
  };

  // ---------------------------------------------------------------------------------------------- columns
  const drawCols = (rs: Route[], stale: string) => {
    const list = el('div', 'cv-cm-cols');
    list.style.gridTemplateColumns = `repeat(${rs.length}, minmax(0, 1fr))`;
    for (const r of rs) {
      const col = el('div', `cv-cm-col ${rowCls(r)}`);
      const head = el('div', 'cv-cm-chead');
      // (a long name ends in "…": the times are what the columns are for)
      head.append(modeIcon(r.mode, 'cv-cm-mi'), nameEl(r, 'cv-cm-lname'));
      const back = backEl(r);
      if (back) head.appendChild(back);
      col.appendChild(head);
      if (r.ok && r.durationSec) {
        const dur = el('b', 'cv-cm-dur');
        for (const [i, [num, unit]] of durParts(r.durationSec).entries()) {
          if (i) dur.append(' ');
          dur.append(num, el('span', 'u', ` ${unit}`));
        }
        col.appendChild(dur);
      } else col.appendChild(el('span', 'cv-dt-nd', failText(r)));
      const chip = trafficChip(r);
      const sub = el('div', 'cv-cm-sub');
      if (chip) sub.appendChild(chip);
      const eta = arrival(r);
      if (eta) sub.appendChild(el('span', 'cv-cm-eta', eta));
      if (sub.childElementCount) col.appendChild(sub);
      list.appendChild(col);
    }
    root.appendChild(list);
    addEnd(stale);
    if (!box) return;
    // ("vuelta" goes before a name ends in "…")
    if (namesCut(root)) root.querySelectorAll('.cv-cm-back').forEach((x) => x.remove());
    ladder(root, [
      dropFoot,
      () => root.querySelectorAll('.cv-cm-eta').forEach((x) => x.remove()),
      sideways(root, () => root.querySelectorAll('.cv-cm-back').forEach((x) => x.remove())),
      () => root.style.setProperty('--dk', '0.85'),
      () => root.style.setProperty('--dk', '0.7'),
      sideways(root, () => root.classList.add('no-name')),
      () => root.style.setProperty('--dk', '0.6'),
      () => root.style.setProperty('--dk', '0.5'),
    ]);
    grow(root, 2);
  };

  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-dt', 'cv-cm');
      render(true);
    },
    update: () => render(true),
    layout(b) {
      box = b;
      root.dataset.size = b.size;
      render(true);
    },
    tick(t) {
      // one route at a time: the next every 10 s
      if (turning > 1 && Date.now() - turnAt >= 10_000) {
        turnAt = Date.now();
        idx = (idx + 1) % turning;
        render();
      } else if (t.minuteChanged) render();
    },
    data(topic) {
      if (topic === 'commute' || topic === 'config') render();
    },
    // on a screen: nothing to show (the server shows this card nothing now, or no route is on at this hour)
    empty: () => {
      if (isPreview || !env) return false;
      if (env.commute.state(item0.id) === 'gone') return true;
      const d = env.commute.get(item0.id);
      return !!d && d.keySet && !d.routes.some((r) => r.active !== false);
    },
    destroy() {
      root.textContent = '';
    },
  };
}

/**
 * The text of a list grows (--dk, up to `max` times what it was fitted at) while nothing gets cut, so a card with room
 * to spare reads from further away; a few halvings find the largest that fits.
 */
function grow(root: HTMLElement, max: number): void {
  if (!root.isConnected || bad(root)) return;
  const k0 = parseFloat(root.style.getPropertyValue('--dk')) || 1;
  let lo = k0;
  let hi = k0 * max;
  root.style.setProperty('--dk', hi.toFixed(3));
  if (!bad(root) && !overfull(root)) return;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    root.style.setProperty('--dk', mid.toFixed(3));
    if (bad(root) || overfull(root)) hi = mid;
    else lo = mid;
  }
  // (a hair under the largest that fits: a name measured whole to the pixel may still end in "…" on screen)
  root.style.setProperty('--dk', Math.max(k0, lo * 0.98).toFixed(3));
}

/** A row's own height: its tallest part and its padding (a list's rows stretch to share the card). */
function ownHeight(row: HTMLElement): number {
  const cs = getComputedStyle(row);
  let h = 0;
  for (const k of row.children) h = Math.max(h, (k as HTMLElement).getBoundingClientRect().height);
  return h + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderTopWidth) || 0);
}

/** The content takes more than 86 % of the card's height (grown no further: room is left around it, as FILL_AT). */
function overfull(root: HTMLElement): boolean {
  const cs = getComputedStyle(root);
  const room = root.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  let need = 0;
  for (const k of root.children) {
    const e = k as HTMLElement;
    if (e.classList.contains('cv-cm-sample')) continue;
    // a list stretches to the card: its rows' own height counts (side by side: the tallest)
    if (e.matches('.cv-cm-list, .cv-cm-lines, .cv-cm-cols')) {
      const rows = [...e.children].map((r) => ownHeight(r as HTMLElement));
      need += e.matches('.cv-cm-cols') || root.classList.contains('is-across') ? Math.max(0, ...rows) : rows.reduce((a, b) => a + b, 0);
    } else need += e.getBoundingClientRect().height;
  }
  return need > room * 0.86;
}

export const COMMUTE_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  commute: (item) => commuteAdapter(item),
};
