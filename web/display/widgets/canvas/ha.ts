// Personalizado Home Assistant cards: a sensor in large type (with today's curve behind it when asked), a room of up
// to six rows (with a switch on the rows that have one), and a media player with its controls. The cards with
// controls only (light, switch, climate, cover, scenes) are in haControls.ts; the Entidad card with its rows, the
// Indicador and the Estadística are in haTile.ts. States come from the server by alias (haFeed.ts); an entity id
// never reaches this page. Text is set as text; icons are the static SVG strings of widgets/ha/haui.ts. Controls
// are drawn live only when the screen allows touch, the item is interactive and the server lists the control for
// that state (HaState.c); the taps themselves are handled by touch.ts.
import type { DisplayCanvasItem, HaHistory, HaState } from '../../../shared/types';
import { ctx } from '../../ctx';
import { isPreview } from '../../identity';
import { HA_ICON, ago, aliasOf, ctlButton, ctlSlider, domainOf, fmtNum, stateIcon, stateText, tone, type HaIconName } from '../ha/haui';
import { now as clockNow, onTick } from '../../time';
import { bigType, fitWidth, typeCap } from './clock';
import { drawTile, fitTile } from './haTile';
import { chartStyleOf, curve, type ChartStyle } from './curve';
import type { AdapterBox, AdapterEnv, CanvasAdapter } from './types';

type Props = Record<string, any>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
export function icon(name: HaIconName, cls = 'cv-ha-ico'): HTMLElement {
  const e = el('span', cls);
  const svg = HA_ICON[name];
  e.innerHTML = svg;
  return e;
}

/** The message a card shows instead of its content: not set up, waiting for the first states. */
function note(root: HTMLElement, key: string): void {
  root.appendChild(el('span', 'cv-ha-note', ctx.t(key)));
}

/**
 * Home Assistant is not set up on the server: a calm note instead of the card (no error, no offline dot). In the
 * admin's preview it says where to set it up.
 */
export function offNote(root: HTMLElement): void {
  const box = el('div', 'cv-ha-off');
  box.append(icon('home'), el('span', 'cv-ha-off__t', ctx.t(isPreview ? 'haOffTitle' : 'haOffTv')));
  if (isPreview) box.append(el('span', 'cv-ha-off__h', ctx.t('haOffHint')));
  root.appendChild(box);
}

/**
 * When a card's content does not fit its box, it adapts before it would be marked cramped, in a fixed order: the
 * parts marked .cv-sec1 go (extra lines: when it changed, the humidity, the minimum and maximum...), then the type
 * gets smaller down to 70 %, then the parts marked .cv-sec2 go (the controls the icon also answers), then .cv-sec3
 * (the state line, last), then the type gets smaller again down to 45 %. Measured on the card body, as the editor's
 * "No cabe" badge is (canvas.ts flags()).
 */
export function squeeze(root: HTMLElement): void {
  delete root.dataset.squeeze;
  if (!root.clientHeight || !root.isConnected) return;
  const over = () => root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1;
  if (!over()) return;
  const wk0 = parseFloat(root.style.getPropertyValue('--wk')) || 1;
  let wk = wk0;
  const set = (k: number) => {
    wk = k;
    root.style.setProperty('--wk', k.toFixed(3));
  };
  const smaller = (floor: number) => {
    for (let i = 0; i < 5 && over() && wk > floor; i++) {
      const k = Math.min(root.clientHeight / root.scrollHeight, root.clientWidth / root.scrollWidth);
      set(Math.max(floor, Math.min(wk * 0.95, wk * k * 0.97)));
    }
  };
  // each level: first at the card's own type size, then a little smaller, before the next part goes
  const levels = ['1', '2', '3'].filter((lv) => root.querySelector(`.cv-sec${lv}`));
  smaller(wk0 * 0.85);
  for (const lv of levels) {
    if (!over()) break;
    root.dataset.squeeze = lv;
    set(wk0);
    if (over()) smaller(wk0 * 0.85);
  }
  if (over()) smaller(0.45);
  // parts went: the rest may take the room they left (up to the type the card had, and a half more)
  if (root.dataset.squeeze && !over()) {
    let used = 0;
    const top = root.getBoundingClientRect().top;
    for (const c of root.children) {
      const r = (c as HTMLElement).getBoundingClientRect();
      if (r.height) used = Math.max(used, r.bottom - top);
    }
    const pad = parseFloat(getComputedStyle(root).paddingBottom) || 0;
    if (used > 0 && used + pad < root.clientHeight * 0.8) {
      const prev = wk;
      set(Math.min(wk0 * 1.5, 2.4, (wk * root.clientHeight) / (used + pad) * 0.9));
      smaller(prev);
    }
  }
}

/**
 * One type size for cards that look alike: Home Assistant cards of the same family (the tile-like ones: Entidad, Luz,
 * Interruptor, a binary Sensor; else one kind) and the same box take the smallest type any of them needed, so a
 * card never has a smaller name than its neighbour of the same size. Smaller type never overflows, so this is safe.
 */
const shared = new Map<string, Map<HTMLElement, { wk: number; grow: number }>>();
const sharedKey = new WeakMap<HTMLElement, string>();
function share(root: HTMLElement, box: AdapterBox, kind: string): void {
  const own = parseFloat(root.style.getPropertyValue('--wk'));
  // what this card's own fit gave (the others keep what theirs gave: never what an earlier share wrote on them)
  const ownGrow = parseFloat(root.style.getPropertyValue('--cv-grow')) || 1;
  // (a sensor with its curve in a band under the value is sized for less height: a family of its own)
  const band = root.querySelector(':scope > .cv-ha-band') ? '|band' : '';
  const key = `${root.classList.contains('cv-ha-tile-card') ? 'tile' : kind}${band}|${box.zone}|${Math.round(box.w)}x${Math.round(box.h)}`;
  const old = sharedKey.get(root);
  if (old && old !== key) shared.get(old)?.delete(root);
  sharedKey.set(root, key);
  let g = shared.get(key);
  if (!g) shared.set(key, (g = new Map()));
  if (Number.isFinite(own)) g.set(root, { wk: own, grow: ownGrow });
  else g.delete(root);
  for (const r of [...g.keys()]) if (!r.isConnected) g.delete(r);
  if (!g.size) return;
  const min = Math.min(...[...g.values()].map((v) => v.wk));
  // the growth of a larger box too (growToFill): the smallest any of them took
  const grow = Math.min(...[...g.values()].map((v) => v.grow));
  for (const r of g.keys()) {
    r.style.setProperty('--wk', min.toFixed(3));
    if (grow > 1) r.style.setProperty('--cv-grow', grow.toFixed(3));
    else r.style.removeProperty('--cv-grow');
  }
}

/**
 * One Home Assistant card: `draw(root, env)` runs again when its states change, when the item changes and once a
 * minute ("hace 5 min"). It marks the card when the server has lost Home Assistant (a small dot).
 */
export function haAdapter(cls: string, aliases: (p: Props) => string[], draw: (root: HTMLElement, env: AdapterEnv) => void, fit?: (root: HTMLElement, box: AdapterBox, env: AdapterEnv) => void): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let sig = '';
  let last: AdapterBox | null = null;
  let fitted = false;
  const render = (force = false) => {
    const p = env.item().props as Props;
    const list = aliases(p);
    const states = list.map((a) => env.ha.state(a));
    const conn = env.ha.conn();
    const id = env.item().id;
    const touch = env.ha.shows() && env.item().interactive;
    const pend = list.some((a) => env.ha.pending(a));
    const off = env.ha.off();
    const s = JSON.stringify([env.item().v, conn, off, states, Math.floor(Date.now() / 60_000), ctx.lang, touch, pend, env.ha.note(id), env.ha.armed(id), last?.size]);
    if (s === sig && !force) return;
    sig = s;
    root.textContent = '';
    root.classList.toggle('is-ha-down', conn === 'down' && !off);
    root.classList.toggle('is-ha-off', off);
    if (off) return offNote(root);
    root.classList.toggle('is-touch', touch);
    // the owner's "Mostrar nombre" and "Mostrar estado" (on unless switched off)
    root.classList.toggle('no-name', env.item().props.showName === false);
    root.classList.toggle('no-state', env.item().props.showState === false);
    root.classList.toggle('is-pending', pend);
    if (!list.length) return note(root, 'cvSetup');
    if (conn === null && states.every((x) => !x)) return note(root, 'haWaiting');
    draw(root, env);
    if (conn === 'down') {
      const dot = el('span', 'cv-ha-down');
      dot.title = ctx.t('haOffline');
      root.appendChild(dot);
    }
    // a short message on the card: "Toca otra vez o mantén pulsado", "Hecho", why an action did not work
    const n = env.ha.note(id);
    if (n) {
      const toast = el('span', `cv-ha-toast${n === 'haDone' ? ' is-ok' : n === 'haTapAgain' ? ' is-ask' : ''}`, ctx.t(n));
      toast.setAttribute('role', 'status');
      root.appendChild(toast);
    }
    fitNow();
  };
  /** Fit the card as drawn now to its box (a fresh drawing: a fit takes rows and buttons out). */
  const fitNow = () => {
    fitted = true;
    if (last && fit) fit(root, last, env);
    else root.style.removeProperty('--wk');
    if (last) {
      squeeze(root);
      share(root, last, env.item().kind);
    }
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-ha', ...cls.split(' '));
      render(true);
    },
    update: () => render(true),
    layout(box) {
      // a box of its own much taller than wide (2×5): some cards show more under it (the climate's modes)
      const shape = box.zone === 'main' && box.h >= box.w * 1.8 ? 'tall' : '';
      last = box;
      root.dataset.size = box.size;
      if (shape) root.dataset.shape = shape;
      else delete root.dataset.shape;
      // drawn again from scratch, then fitted once: a fit takes rows, buttons and the type size down from the full
      // card, so fitting what an earlier fit left would make the card depend on the boxes it had before
      fitted = false;
      render(true);
      // (a note drawn instead of the card is fitted too)
      if (!fitted) fitNow();
    },
    tick(t) {
      if (t.minuteChanged) render();
    },
    data(topic) {
      if (topic === 'ha' || topic === 'config') render();
    },
    destroy() {
      root.textContent = '';
    },
  };
}

/**
 * A box one fine cell high that only the fine grid has (data-mini, widgets/canvas.ts miniMark): the card's one-line
 * look (the media player, the cover, the climate, the scenes, the gauge, the statistic).
 */
export const miniLine = (root: HTMLElement): boolean => root.dataset.mini !== undefined && root.dataset.mh === '1';

export const nameOf = (p: Props, s: HaState | null) => String(p.name || s?.n || '');

/** The control may be tapped now: touch is on, the item is interactive and the server offers it for this state. */
export function live(env: AdapterEnv, s: HaState | null, control: string): boolean {
  return !!s && env.ha.shows() && env.item().interactive && s.c.includes(control as never);
}

/** The control a tap on a whole tile (or a room row) does for this state, or null. */
export function tapControl(s: HaState | null): { control: string; value?: unknown } | null {
  if (!s) return null;
  if (s.c.includes('toggle')) return { control: 'toggle' };
  if (s.c.includes('run')) return { control: 'run' };
  if (s.d === 'cover' && s.c.includes('open')) {
    if (s.state === 'opening' || s.state === 'closing') return { control: 'stop' };
    return { control: s.state === 'closed' ? 'open' : 'close' };
  }
  // a valve: a tap opens it when closed and closes it when open
  if (s.d === 'valve' && s.c.includes('open')) return { control: s.state === 'closed' || s.state === 'closing' ? 'open' : 'close' };
  return null;
}

/** Make a whole element a tap target for `alias` (a tile, a room row, a scene button). */
export function tappable(e: HTMLElement, env: AdapterEnv, alias: string, s: HaState | null): void {
  const t = tapControl(s);
  if (!t || !live(env, s, t.control)) return;
  e.dataset.a = alias;
  e.dataset.ctl = t.control;
  if (t.value !== undefined) e.dataset.v = JSON.stringify(t.value);
  e.classList.add('is-tap');
  if (env.ha.armed(env.item().id) === `${alias}|${t.control}`) e.classList.add('is-armed');
  e.setAttribute('role', 'button');
  e.setAttribute('aria-label', `${e.textContent ?? ''}`.trim());
}

// ------------------------------------------------------------------------------------------------ sensor
/** ok / warn / err from the two breakpoints (inverted: a high value is the good one). */
function level(num: number | null, th: unknown, invert: boolean): '' | 'ok' | 'warn' | 'err' {
  if (num === null || !Array.isArray(th) || th.length !== 2) return '';
  const [a, b] = th as [number, number];
  const l = num < a ? 0 : num <= b ? 1 : 2;
  return (['ok', 'warn', 'err'] as const)[invert ? 2 - l : l];
}

/**
 * Today's curve of a sensor in the shared style (curve.ts), in the accent colour. Behind the value (the card's own
 * look, "De fondo"): over the lower part of the card, edge to edge and down to its bottom edge. Under the value
 * ("Debajo"): in a band of its own at the bottom (fitSensor gives it room). The lowest and highest go beside the value
 * on the right, never under it.
 */
function sparkline(root: HTMLElement, h: HaHistory | null, decimals: number, into: HTMLElement, style: ChartStyle): void {
  const pts = h?.series[0]?.points ?? [];
  const svg = curve(pts, { area: true, tone: 'accent', top: style === 'background' ? 0.1 : 0.08, bottom: style === 'background' ? 0.06 : 0.04 });
  if (!svg) return;
  const ys = pts.map((p) => p[1]);
  const holder = el('div', style === 'background' ? 'cv-bgchart cv-ha-spark' : 'cv-ha-band');
  holder.appendChild(svg);
  root.classList.toggle('has-bgchart', style === 'background');
  root.appendChild(holder);
  const mm = el('div', 'cv-ha-minmax cv-sec1');
  mm.append(el('span', '', `${ctx.t('haMin')} ${fmtNum(Math.min(...ys), decimals)}`), el('span', '', `${ctx.t('haMax')} ${fmtNum(Math.max(...ys), decimals)}`));
  into.appendChild(mm);
}

/**
 * The value of a sensor as large as its box allows. With its curve in a band under it, the value is sized for the
 * upper 60 % of the card; a band then left with less than a fifth of the card's height goes, and the value is sized
 * again for the whole card.
 */
function fitSensor(root: HTMLElement, box: AdapterBox, env: AdapterEnv): void {
  const size = (band: boolean) => fitWidth(root, root.querySelector('.cv-ha-sfoot'), bigType(root, box, band ? 11.5 / 0.6 : 11.5, Number(env.item().style?.scale) || 1, 14, typeCap(root)));
  const band = root.querySelector<HTMLElement>(':scope > .cv-ha-band');
  size(!!band);
  if (band && (band.clientHeight < Math.max(box.rem * 2.6, root.clientHeight * 0.2) || root.scrollHeight > root.clientHeight + 1)) {
    band.remove();
    size(false);
  }
}

function sensorAdapter(): CanvasAdapter {
  // today's curve: kept between draws, asked for again when the item changes or every 5 minutes
  let hist: HaHistory | null = null;
  let histV = '';
  let histAt = 0;
  let asking = false;
  let ask: (() => void) | null = null;
  const base = haAdapter('cv-ha-sensor', (p) => [aliasOf(p.entity)].filter(Boolean), (root, env) => {
    // the one-line size, and a binary sensor at any size (motion, a door, water): drawn like an Entidad card, the
    // icon in its state colour, the name, what it says and when it changed
    const st0 = env.ha.state(aliasOf((env.item().props as Props).entity));
    const tileLike = root.dataset.size === 'row' || st0?.d === 'binary';
    root.classList.toggle('cv-ha-tile-card', tileLike);
    if (tileLike) return drawTile(root, env);
    const it = env.item();
    const p = it.props as Props;
    const s = env.ha.state(aliasOf(p.entity));
    const decimals = Math.min(3, Math.max(0, Number(p.decimals ?? 1)));
    // the header of every tile-like card: the icon, and beside it the name with when it changed under it
    const head = el('div', 'cv-ha-head');
    const htxt = el('div', 'cv-ha-txt');
    htxt.append(el('span', 'cv-ha-name', nameOf(p, s)));
    if (s?.at) htxt.append(el('span', 'cv-ha-ago cv-sec1', ago(s.at)));
    head.append(icon(stateIcon(domainOf(p.entity), s)), htxt);
    root.appendChild(head);
    const big = el('div', 'cv-ha-big');
    if (s?.d === 'sensor' && s.num !== null) {
      big.append(el('span', 'v', fmtNum(s.num, decimals)));
      if (s.unit) big.append(el('span', 'u', s.unit));
      const lv = level(s.num, p.thresholds, !!p.invert);
      if (lv) big.classList.add(`lv-${lv}`);
    } else {
      big.append(el('span', 'v is-text', s ? stateText(s, decimals) : ''));
      big.classList.add(`tone-${tone(s)}`);
    }
    // the value and, beside it on the right, the lowest and highest of today (never over the value)
    const foot = el('div', 'cv-ha-sfoot');
    foot.appendChild(big);
    root.appendChild(foot);
    root.classList.remove('has-bgchart');
    if (p.sparkline && s?.d === 'sensor') {
      if (hist && histV === it.v) sparkline(root, hist, decimals, foot, chartStyleOf(p, 'background'));
      if (!asking && (histV !== it.v || Date.now() - histAt > 5 * 60_000)) ask?.();
    }
  }, (root, box, env) => {
    if (root.classList.contains('cv-ha-tile-card')) return fitTile(root, box, env);
    fitSensor(root, box, env);
  });
  return {
    ...base,
    mount(r, e) {
      ask = () => {
        const it = e.item();
        const v = it.v;
        asking = true;
        void e.ha.history(it.id, v).then((h) => {
          asking = false;
          histAt = Date.now();
          if (e.item().v !== v) return;
          const had = !!hist && histV === v;
          hist = h;
          histV = v;
          if (h || had) base.update();
        });
      };
      base.mount(r, e);
    },
  };
}

// ------------------------------------------------------------------------------------------------ room
function drawRoom(root: HTMLElement, env: AdapterEnv): void {
  const p = env.item().props as Props;
  if (p.title) root.appendChild(el('div', 'cv-ha-room-title', String(p.title)));
  const list = el('div', 'cv-ha-rows');
  for (const r of (p.rows ?? []) as Props[]) {
    const a = aliasOf(r.entity);
    if (!a) continue;
    const s = env.ha.state(a);
    const row = el('div', `cv-ha-row tone-${tone(s)}`);
    row.append(icon(stateIcon(domainOf(r.entity), s)), el('span', 'cv-ha-name', String(r.name || s?.n || '')));
    // a row that can be switched shows a switch; the whole row is the tap target
    const t = tapControl(s);
    if (t?.control === 'toggle' && live(env, s, 'toggle') && (s?.d === 'light' || s?.d === 'switch')) {
      const sw = el('span', `cv-ha-switch${s.on ? ' is-on' : ''}`);
      sw.appendChild(el('i', ''));
      row.append(sw);
    } else row.append(el('span', 'cv-ha-state', stateText(s)));
    tappable(row, env, a, s);
    list.appendChild(row);
  }
  root.appendChild(list);
}

// ------------------------------------------------------------------------------------------------ media
/** m:ss (h:mm:ss past an hour) of a number of seconds. */
const clockText = (sec: number): string => {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
/** Where a track is now: its position when Home Assistant read it, plus the time since while it plays. */
function trackAt(pg: HTMLElement): number {
  const pos = Number(pg.dataset.pos) || 0;
  const dur = Number(pg.dataset.dur) || 0;
  const at = Number(pg.dataset.at) || 0;
  const run = pg.dataset.run === '1' && at ? (clockNow().getTime() - at) / 1000 : 0;
  return Math.min(dur, pos + Math.max(0, run));
}
function paintProgress(pg: HTMLElement): void {
  const dur = Number(pg.dataset.dur) || 0;
  const t = trackAt(pg);
  const [a, , b] = pg.children as unknown as HTMLElement[];
  if (a) a.textContent = clockText(t);
  if (b) b.textContent = `-${clockText(dur - t)}`;
  const fill = pg.querySelector<HTMLElement>('.cv-ha-prog-bar > i');
  if (fill) fill.style.width = `${dur ? ((t / dur) * 100).toFixed(2) : 0}%`;
}
let progTick = false;
/** The progress of a playing track: the time so far, a thin bar and the time left; it moves each second while it plays. */
function progressRow(m: { pos?: number; dur?: number; posAt?: number; state: string }): HTMLElement | null {
  if (!m.dur || m.dur <= 0 || typeof m.pos !== 'number') return null;
  const pg = el('div', 'cv-ha-prog cv-sec2');
  pg.dataset.pos = String(m.pos);
  pg.dataset.dur = String(m.dur);
  pg.dataset.at = String(m.posAt ?? 0);
  pg.dataset.run = m.state === 'playing' ? '1' : '0';
  const bar = el('span', 'cv-ha-prog-bar');
  bar.appendChild(el('i', ''));
  pg.append(el('span', 'cv-ha-prog-t'), bar, el('span', 'cv-ha-prog-t is-left'));
  paintProgress(pg);
  if (!progTick) {
    progTick = true;
    onTick(() => {
      for (const x of document.querySelectorAll<HTMLElement>('.cv-ha-prog[data-run="1"]')) paintProgress(x);
    });
  }
  return pg;
}

function mediaAdapter(item0: DisplayCanvasItem): CanvasAdapter {
  let artKey = '';
  let artUrl: string | null = null;
  const base: CanvasAdapter = haAdapter('cv-ha-media', (p) => [aliasOf(p.entity)].filter(Boolean), (root, env) => {
    const p = env.item().props as Props;
    const s = env.ha.state(aliasOf(p.entity));
    const m = s?.d === 'media' ? s : null;
    const art = el('div', 'cv-ha-art');
    const key = m?.art ? `${m.title ?? ''}|${m.artist ?? ''}` : '';
    if (key && key === artKey && artUrl) art.style.backgroundImage = `url("${artUrl}")`;
    else art.appendChild(icon(m?.state === 'playing' ? 'music' : 'play', 'cv-ha-art-ico'));
    if (key && key !== artKey) {
      artKey = key;
      artUrl = null;
      void env.ha.art(item0.id, key).then((u) => {
        if (artKey !== key || !u) return;
        artUrl = u;
        base.update();
      });
    } else if (!key) {
      artKey = '';
      artUrl = null;
    }
    const txt = el('div', 'cv-ha-txt');
    // a small look in a box wider than the small size (4×2): the whole row of controls, as on the wide card
    // one line (a box only the fine grid has): the art, the title and play or pause, as on the small card
    const line = miniLine(root);
    const size = line ? 's' : root.dataset.size === 's' && root.classList.contains('is-roomy') ? 'w' : root.dataset.size || 'w';
    const playing = !!(m && m.title && m.state !== 'off' && m.state !== 'idle' && m.state !== 'standby');
    // playing: the title, the artist and where it plays (and "En pausa" when paused); idle: where, and its state
    const where = nameOf(p, s);
    if (playing) {
      txt.append(el('span', 'cv-ha-title', m!.title!));
      if (m!.artist) txt.append(el('span', 'cv-ha-artist cv-sec1', m!.artist));
      txt.append(el('span', 'cv-ha-state cv-sec3', m!.state === 'paused' ? [where, stateText(s)].filter(Boolean).join(' · ') : where));
      // where the track is (not on the small card: it plays and pauses only)
      const pg = size !== 's' ? progressRow(m!) : null;
      if (pg) txt.append(pg);
    } else {
      txt.append(el('span', 'cv-ha-title', where || ctx.t('haNothingPlaying')));
      txt.append(el('span', 'cv-ha-state cv-sec3', m?.state === 'off' ? stateText(s) : ctx.t('haNothingPlaying')));
    }
    const alias = aliasOf(p.entity);
    const touchy = live(env, s, 'playPause');
    const ctl = el('div', 'cv-ha-mctl');
    if (touchy && m) {
      const row = el('div', 'cv-ha-transport');
      const armed = env.ha.armed(env.item().id);
      // the small card: play and pause only
      const small = size === 's';
      if (!small && s!.c.includes('prev')) row.append(ctlButton({ cls: 'cv-ha-tr cv-sec2', alias, control: 'prev', live: true, icon: 'prev', label: ctx.t('haPrev'), armed: armed === `${alias}|prev` }));
      row.append(ctlButton({ cls: 'cv-ha-tr is-main', alias, control: 'playPause', live: true, icon: m.state === 'playing' ? 'pause' : 'play', label: ctx.t('haPlayPause'), armed: armed === `${alias}|playPause` }));
      if (!small && s!.c.includes('next')) row.append(ctlButton({ cls: 'cv-ha-tr cv-sec2', alias, control: 'next', live: true, icon: 'next', label: ctx.t('haNext'), armed: armed === `${alias}|next` }));
      ctl.append(row);
    }
    if (m && m.vol !== null && m.state !== 'off' && size !== 's') {
      if (live(env, s, 'volume')) {
        ctl.append(ctlSlider({ cls: 'cv-ha-volume cv-sec1', alias, control: 'volume', live: true, value: m.vol, min: 0, max: 1, step: 0.01, label: ctx.t('haVolume'), text: `${Math.round(m.vol * 100)} %` }));
      } else {
        const bar = el('span', 'cv-ha-vol cv-sec1');
        const fill = el('i', '');
        fill.style.width = `${Math.round(m.vol * 100)}%`;
        bar.appendChild(fill);
        ctl.append(bar);
      }
    }
    if (ctl.childNodes.length && !line) txt.append(ctl);
    const wrap = el('div', `cv-ha-player tone-${tone(s)}`);
    wrap.append(art, txt);
    if (ctl.childNodes.length && line) wrap.append(ctl);
    root.appendChild(wrap);
  }, (root, box, env) => {
    // the small look in a box at least 2.2 times as wide as high (4×2): room beside the art for back, next and the
    // volume, so they are drawn (once, when it changes) instead of a lone play button over empty space
    const line = miniLine(root);
    const roomy = !line && box.size === 's' && box.zone === 'main' && box.w >= box.h * 2.2;
    if (roomy !== root.classList.contains('is-roomy')) {
      root.classList.toggle('is-roomy', roomy);
      base.update();
      return;
    }
    // one line: the type from its height (the art as high as the card, play or pause at its end)
    if (line) {
      root.classList.remove('is-stack');
      bigType(root, box, 4.6, Number(env.item().style?.scale) || 1, 0, 1.2);
      return;
    }
    // a box as high as it is wide (3×4, a box of its own): the art on top, the words under it, both centred
    const stack = box.zone === 'main' && box.h >= box.w * 0.95;
    root.classList.toggle('is-stack', stack);
    if (stack) {
      bigType(root, box, 18, Number(env.item().style?.scale) || 1, 22, typeCap(root));
      return;
    }
    // the text grows with the card like a tile's: about 9rem of text high (6 on the small card), the art beside it
    bigType(root, box, box.size === 's' ? 7 : 9, Number(env.item().style?.scale) || 1, box.size === 's' ? 22 : 34, typeCap(root));
  });
  return base;
}

export const HA_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  'ha.sensor': () => sensorAdapter(),
  'ha.room': () => haAdapter('cv-ha-room', (p) => ((p.rows ?? []) as Props[]).map((r) => aliasOf(r.entity)).filter(Boolean), drawRoom, (root, box, env) => {
    const p = env.item().props as Props;
    const rows = Math.max(1, ((p.rows ?? []) as Props[]).filter((r) => aliasOf(r.entity)).length);
    // rows in two columns when one does not hold them and the card is wide enough
    root.classList.remove('is-2col');
    const sc = Number(env.item().style?.scale) || 1;
    // a box only the fine grid has: the tighter rows (styles-canvas-mini.css), each about 2.9 lines of text high
    if (root.dataset.mini !== undefined) {
      bigType(root, box, rows * 2.9 + (p.title ? 2.2 : 0), sc, 22);
      return;
    }
    bigType(root, box, rows * 3.9 + (p.title ? 3 : 0), sc, 26);
    if (rows > 2 && root.scrollHeight > root.clientHeight + 1 && box.w / box.rem > 44) {
      root.classList.add('is-2col');
      bigType(root, box, Math.ceil(rows / 2) * 3.9 + (p.title ? 3 : 0), sc, 40);
    }
  }),
  'ha.media': (item) => mediaAdapter(item),
};
