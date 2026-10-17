// Personalizado Home Assistant cards of the Entidad family: the Entidad card (ha.tile) with its rows under it (the
// owner's, or the ones the server picks for the entity's domain: HaState.f, haCore tileFeatures), the Indicador card
// (ha.gauge: a value on a bar from a minimum to a maximum, in colour bands) and the Estadística card (ha.statistic:
// today's, this week's or this month's change, mean, minimum or maximum of a sensor, from Home Assistant's
// long-term statistics through the server). The rows are live only where touch is allowed (ha.ts live()); without
// touch they show the state. Text is set as text; icons are the static SVG strings of widgets/ha/haui.ts.
import type { DisplayCanvasItem, HaState, HaStatistic, TileFeature } from '../../../shared/types';
import { ctx } from '../../ctx';
import { sizeCells } from '../../../../server/core/canvasCore.js';
import { ago, aliasOf, ctlButton, ctlChips, ctlSlider, domainOf, fmtNum, modeName, stateIcon, stateText, stepDecimals, svgEl, tone } from '../ha/haui';
import { bigType, fitWidth, typeCap } from './clock';
import { el, haAdapter, icon, live, miniLine, nameOf, tappable } from './ha';
import { climateState, colorRow, ctChips, fitSwatches, kelvinRgb } from './haControls';
import type { AdapterBox, AdapterEnv, CanvasAdapter } from './types';

type Props = Record<string, any>;
const scaleOf = (env: AdapterEnv) => Number(env.item().style?.scale) || 1;
const armedKey = (env: AdapterEnv) => env.ha.armed(env.item().id);

/** How many rows fit under a tile of a size: none on the mini and the line, two on the medium one. */
const rowsFor = (size: string) => (size === 'm' || size === 'sq' ? 2 : size === 's' || size === 'w' ? 1 : 0);

/** The colour a lit light has (its own colour, else its colour temperature), as 'r g b', or '' (the state colour). */
function lightRgb(s: HaState | null): string {
  if (s?.d !== 'light' || !s.on) return '';
  const rgb = s.rgb ?? (s.ct ? kelvinRgb(s.ct) : null);
  return rgb ? rgb.join(' ') : '';
}

const ACTION_KEY: Record<string, string> = { heating: 'haHeating', cooling: 'haCooling', drying: 'haDrying', fan: 'haFanAction' };

/**
 * The state line of an Entidad card, said once: "Encendido · 70 %" for a light, what a climate is doing and the
 * temperature now when the row under it holds the target, "Hay una versión nueva" when the row shows the versions,
 * what is playing. Everything else as the other cards say it (stateText).
 */
export function tileStateText(s: HaState | null, rows: TileFeature[] = [], line = false, decimals?: unknown): string {
  if (!s) return '';
  switch (s.d) {
    case 'light':
      // on one line the brightness alone says it is on
      if (s.on && s.bri !== null) return line ? `${s.bri} %` : `${ctx.t('haOn')} · ${s.bri} %`;
      return stateText(s);
    case 'switch':
      if (s.on && typeof s.pct === 'number' && s.pct > 0) return line ? `${s.pct} %` : `${ctx.t('haOn')} · ${s.pct} %`;
      return stateText(s);
    case 'climate': {
      // on one line: the temperature now first, then what it is doing
      if (line) return [s.cur !== null ? `${fmtNum(s.cur, 1)}°` : '', climateState({ ...s, cur: null })].filter(Boolean).join(' · ');
      return rows.includes('target') ? climateState(s) : stateText(s);
    }
    case 'update':
      // the versions are in the row (or left out on the mini, where the line is short)
      return s.busy ? stateText(s) : ctx.t(s.on ? 'haUpdateAvail' : 'haUpToDate');
    case 'media':
      return s.state === 'playing' && s.title ? `${ctx.t('haPlaying')} · ${s.title}` : stateText(s);
    case 'sensor':
      // the Sensor card's own decimals on its one-line size
      return stateText(s, decimals === undefined || decimals === null ? 1 : Math.min(3, Math.max(0, Number(decimals) || 0)));
    default:
      return stateText(s);
  }
}

/** A thin bar from `lo` to `hi` with `v` filled (read-only rows). */
function bar(v: number, lo: number, hi: number, cls = ''): HTMLElement {
  const b = el('span', `cv-ha-vol cv-ha-featbar ${cls}`);
  const fill = el('i', '');
  fill.style.width = `${Math.max(0, Math.min(100, hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0))}%`;
  b.appendChild(fill);
  return b;
}

/** −/+ around a value (`which`: the setpoint of a climate range). */
function stepRow(env: AdapterEnv, alias: string, control: string, step: number, text: string, which = ''): HTMLElement {
  const row = el('div', 'cv-ha-stepper');
  const armed = armedKey(env);
  const btn = (d: number, ic: 'minus' | 'plus', key: string) => {
    const b = ctlButton({ cls: 'cv-ha-sbtn', alias, control, live: true, d, icon: ic, label: ctx.t(key), armed: armed === `${alias}|${control}` });
    if (which) b.dataset.which = which;
    return b;
  };
  row.append(btn(-step, 'minus', control === 'numberSet' ? 'haLess' : 'haColder'), el('span', 'cv-ha-sval', text), btn(step, 'plus', control === 'numberSet' ? 'haMore' : 'haWarmer'));
  return row;
}

const COVER_BTN = { open: ['up', 'haUp'], stop: ['stop', 'haStop'], close: ['down', 'haDown'] } as const;

/**
 * Up, stop and down for a cover (or the ones of `which`), each only when this card may send it: the screen allows
 * touch, the item is interactive and the cover takes it (its supported_features, through the controls the server
 * lists). Null when none is left (no touch, a garage or a gate, a door not ticked yet).
 */
export function coverButtons(env: AdapterEnv, alias: string, s: HaState | null, which: (keyof typeof COVER_BTN)[] = ['open', 'stop', 'close']): HTMLElement | null {
  if (s?.d !== 'cover' || s.readOnly) return null;
  const list = which.filter((c) => live(env, s, c));
  if (!list.length) return null;
  const armed = armedKey(env);
  const g = el('div', 'cv-ha-coverbtns');
  if (list.length !== 3) g.style.setProperty('--n', String(list.length));
  // no stop button of its own (the line and the compact sizes show up and down only): while the cover moves, the
  // button of the way it goes is the stop (■), when the cover takes one. Right after a tap too: the optimistic state
  // (haFeed.ts) is 'opening' or 'closing' until Home Assistant says
  const stopIn = !list.includes('stop') && live(env, s, 'stop');
  for (const c of list) {
    const on = (c === 'open' && s.state === 'opening') || (c === 'close' && s.state === 'closing');
    const k = on && stopIn ? 'stop' : c;
    g.append(ctlButton({ cls: `cv-ha-cbtn${k !== c ? ' is-stop' : ''}`, alias, control: k, live: true, icon: COVER_BTN[k][0], label: ctx.t(COVER_BTN[k][1]), on, armed: armed === `${alias}|${k}` }));
  }
  return g;
}

/** One row under an Entidad card, or null when it has nothing to show for this state. */
function featureRow(f: TileFeature | 'fanPct', env: AdapterEnv, alias: string, s: HaState, p: Props): HTMLElement | null {
  const row = el('div', `cv-ha-feat feat-${f}`);
  const armed = armedKey(env);
  switch (f) {
    case 'brightness': {
      if (s.d !== 'light') return null;
      const lv = live(env, s, 'brightness');
      // off and nothing to touch: an empty bar would only say "off" again
      if (!lv && !s.on) return null;
      row.append(ctlSlider({
        cls: 'cv-ha-bri', alias, control: 'brightness', live: lv, value: s.on ? s.bri ?? 100 : 0, min: 1, max: 100, step: 1,
        label: ctx.t('haBrightness'), text: s.on && s.bri !== null ? `${s.bri} %` : ctx.t('haBrightness'),
      }));
      return row;
    }
    case 'colorTemp': {
      const chips = ctChips(env, alias, s);
      if (!chips) return null;
      row.append(chips);
      return row;
    }
    case 'color': {
      // colour swatches for a colour light, warm to cool chips for one with colour temperature only
      const sw = colorRow(env, alias, s);
      if (!sw) return null;
      row.append(sw);
      return row;
    }
    case 'fanPct': {
      // the Interruptor card of a fan: its speed (drawn here, not one of the Entidad rows)
      if (s.d !== 'switch' || (!live(env, s, 'fanPct') && s.pct === undefined)) return null;
      row.append(ctlSlider({ cls: 'cv-ha-bri', alias, control: 'fanPct', live: live(env, s, 'fanPct'), value: s.on ? s.pct ?? 0 : 0, min: 0, max: 100, step: 1, label: ctx.t('haSpeed'), text: s.on && s.pct ? `${s.pct} %` : ctx.t('haSpeed') }));
      return row;
    }
    case 'cover':
    case 'valve': {
      if ((s.d !== 'cover' && s.d !== 'valve') || s.readOnly || !live(env, s, 'open')) return null;
      if (f === 'cover') {
        // up, stop and down: only the ones this cover takes (supported_features, through the controls it lists)
        const g = coverButtons(env, alias, s);
        if (!g) return null;
        row.append(g);
        return row;
      }
      const g = el('div', 'cv-ha-coverbtns is-two');
      g.append(
        ctlButton({ cls: 'cv-ha-cbtn', alias, control: 'open', live: true, text: ctx.t('haOpenValve'), label: ctx.t('haOpenValve'), on: s.state === 'open' || s.state === 'opening', armed: armed === `${alias}|open` }),
        ctlButton({ cls: 'cv-ha-cbtn', alias, control: 'close', live: live(env, s, 'close'), text: ctx.t('haCloseValve'), label: ctx.t('haCloseValve'), on: s.state === 'closed' || s.state === 'closing', armed: armed === `${alias}|close` }),
      );
      row.append(g);
      return row;
    }
    case 'position': {
      if ((s.d !== 'cover' && s.d !== 'valve') || s.pos === null) return null;
      if (live(env, s, 'position')) row.append(ctlSlider({ cls: 'cv-ha-pos', alias, control: 'position', live: true, value: s.pos, min: 0, max: 100, step: 1, label: ctx.t('haPosition'), text: `${s.pos} %` }));
      else row.append(bar(s.pos, 0, 100));
      return row;
    }
    case 'hvacModes': {
      if (s.d !== 'climate' || s.modes.length < 2) return null;
      row.append(ctlChips({ cls: 'cv-ha-modes', alias, control: 'hvacMode', live: live(env, s, 'hvacMode'), options: s.modes.map((m) => ({ v: m, label: modeName(m) })), current: s.mode, armed }));
      return row;
    }
    case 'target': {
      if (s.d !== 'climate' || s.mode === 'off') return null;
      const dec = s.step < 1 ? 1 : 0;
      const range = s.mode === 'heat_cool' && s.lo !== null && s.hi !== null;
      if (range) {
        if (!live(env, s, 'setpointRange')) return row.append(el('span', 'cv-ha-sval', `${fmtNum(s.lo!, dec)}° · ${fmtNum(s.hi!, dec)}°`)), row;
        row.append(stepRow(env, alias, 'setpointRange', s.step, `${fmtNum(s.lo!, dec)}°`, 'lo'), stepRow(env, alias, 'setpointRange', s.step, `${fmtNum(s.hi!, dec)}°`, 'hi'));
        return row;
      }
      if (s.target === null) return null;
      if (!live(env, s, 'setpoint')) return row.append(el('span', 'cv-ha-sval', `${fmtNum(s.target, dec)}°`)), row;
      row.append(stepRow(env, alias, 'setpoint', s.step, `${fmtNum(s.target, dec)}°`));
      return row;
    }
    case 'select': {
      if (s.d !== 'select' || !s.opts.length) return null;
      // as many as a row holds, and the one chosen now always among them
      let opts = s.opts.slice(0, 6);
      if (!opts.includes(s.v) && s.opts.includes(s.v)) opts = [...opts.slice(0, 5), s.v];
      row.append(ctlChips({ cls: 'cv-ha-opts', alias, control: 'selectOption', live: live(env, s, 'selectOption'), options: opts.map((o) => ({ v: o, label: o })), current: s.v, armed }));
      return row;
    }
    case 'number': {
      if (s.d !== 'sensor' || s.min === undefined || s.max === undefined) return null;
      const n = s.num ?? s.min;
      const step = s.step ?? 1;
      const dec = stepDecimals(step);
      const text = `${fmtNum(n, dec)}${s.unit ? ` ${s.unit}` : ''}`;
      const lv = live(env, s, 'numberSet');
      if (lv && s.box) row.append(stepRow(env, alias, 'numberSet', step, text));
      else if (lv) row.append(ctlSlider({ cls: 'cv-ha-num', alias, control: 'numberSet', live: true, value: n, min: s.min, max: s.max, step, label: nameOf(p, s), text }));
      else row.append(bar(n, s.min, s.max));
      return row;
    }
    case 'vacuum': {
      if (s.d !== 'vacuum') return null;
      const btns = ([['start', 'play', 'haVacStart'], ['pause', 'pause', 'haVacPause'], ['dock', 'dock', 'haVacDock']] as const).filter(([c]) => live(env, s, c));
      if (btns.length) {
        const g = el('div', 'cv-ha-coverbtns');
        g.style.setProperty('--n', String(btns.length));
        for (const [c, ic, key] of btns) g.append(ctlButton({ cls: 'cv-ha-cbtn', alias, control: c, live: true, icon: ic, label: ctx.t(key), on: (c === 'start' && s.state === 'cleaning') || (c === 'dock' && s.state === 'returning'), armed: armed === `${alias}|${c}` }));
        row.append(g);
        return row;
      }
      if (s.bat === undefined) return null;
      row.append(el('span', 'cv-ha-featnote', `🔋 ${s.bat} %`), bar(s.bat, 0, 100));
      return row;
    }
    case 'update': {
      if (s.d !== 'update') return null;
      // the version it has, and the one waiting (the state above says whether there is one)
      const txt = s.on && s.cur && s.next ? `${s.cur} → ${s.next}` : s.on && s.next ? ctx.t('haVersion', { v: s.next }) : s.cur ? ctx.t('haVersion', { v: s.cur }) : '';
      if (!txt) return null;
      row.append(el('span', `cv-ha-featnote${s.on ? ' is-new' : ''}`, txt));
      return row;
    }
    case 'gauge': {
      if (s.d !== 'sensor' || s.num === null) return null;
      const lo = Number(p.gaugeMin ?? 0);
      const hi = Number(p.gaugeMax ?? 100);
      row.append(bar(s.num, lo, hi, 'is-gauge'));
      return row;
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------------------------------------ tile
export function drawTile(root: HTMLElement, env: AdapterEnv, feats?: (TileFeature | 'fanPct')[]): void {
  const p = env.item().props as Props;
  const alias = aliasOf(p.entity);
  const s = env.ha.state(alias);
  const size = root.dataset.size || 'xs';
  const tn = tone(s);
  // the state colour of the whole card (the icon, the switch, the slider): a lit light in its own colour
  root.dataset.tone = tn;
  // what it shows (a cover's card keeps its buttons; the browser tests look for them)
  if (s) root.dataset.d = s.d;
  else delete root.dataset.d;
  const rgb = lightRgb(s);
  if (rgb) root.style.setProperty('--tile-c', `rgb(${rgb})`);
  else root.style.removeProperty('--tile-c');
  root.classList.toggle('is-lit', s?.d === 'light' && s.on);
  // the rows first: the state line says what they do not
  // a cover on the Mini: its buttons still (the one row it takes); other kinds show none there
  const coverMini = size === 'xs' && s?.d === 'cover';
  const max = coverMini ? 1 : rowsFor(size);
  const box = el('div', 'cv-ha-feats');
  const drawn: TileFeature[] = [];
  if (s && max) {
    for (const f of feats ?? s.f ?? []) {
      if (box.childNodes.length >= max) break;
      if (coverMini && f !== 'cover') continue;
      const row = featureRow(f, env, alias, s, p);
      if (row) {
        box.append(row);
        if (f !== 'fanPct') drawn.push(f);
      }
    }
  }
  // a binary sensor that is active (motion, water, a door open) breathes softly (never in lite or low power)
  const wrap = el('div', `cv-ha-tile tone-${tn}${s?.d === 'binary' && tn !== 'off' && tn !== 'na' ? ' is-pulse' : ''}`);
  const txt = el('div', 'cv-ha-txt');
  txt.append(el('span', 'cv-ha-name', nameOf(p, s)), el('span', 'cv-ha-state cv-sec3', tileStateText(s, drawn, size === 'row', p.decimals)));
  // when it changed, under the state while there is room (it is the first thing to go)
  const when = s?.at && !drawn.length && size !== 'row' ? ago(s.at) : '';
  if (when) txt.append(el('span', 'cv-ha-ago cv-sec1', when));
  wrap.append(icon(stateIcon(domainOf(p.entity), s)), txt);
  tappable(wrap, env, alias, s);
  // the line of a cover: small up and down at its end while the width allows them (fitTile takes them out)
  if (size === 'row' && s?.d === 'cover') {
    const lb = coverButtons(env, alias, s, ['open', 'close']);
    if (lb) {
      lb.classList.add('is-line');
      wrap.append(lb);
    }
  }
  // the line of a climate in a box only the fine grid has: − the target + at its end while the width allows them
  // (fitTile takes them out), and the temperature now as its state (short, so the name keeps the room)
  if (size === 'row' && root.dataset.mini !== undefined && s?.d === 'climate' && s.mode !== 'off' && s.target !== null && live(env, s, 'setpoint')) {
    const st = stepRow(env, alias, 'setpoint', s.step, `${fmtNum(s.target, s.step < 1 ? 1 : 0)}°`);
    st.classList.add('is-line');
    wrap.append(st);
    const now = wrap.querySelector('.cv-ha-state');
    if (now && s.cur !== null) now.textContent = `${fmtNum(s.cur, 1)}°`;
  }
  root.appendChild(wrap);
  root.classList.toggle('has-feats', drawn.length > 0);
  if (drawn.length) root.appendChild(box);
}

/**
 * Fit an Entidad card: the type from the box (about 9.5rem high stacked on the mini, 4.5rem on the line, 5.5rem in a
 * row plus 5.6rem per row under it), then measured: smaller type while it does not fit (large screen text, a small
 * screen), and the last row left out when even that is not enough, so the icon, the name and the state always show.
 */
export function fitTile(root: HTMLElement, box: AdapterBox, env: AdapterEnv): void {
  // from the card's own type: a growth an earlier fit (or a neighbour, share()) left is not measured into this one
  root.style.removeProperty('--cv-grow');
  // a box much wider than the shape of its named size (a box of its own): the rows beside the header
  const [cw, ch] = sizeCells(box.size, 'landscape');
  root.classList.toggle('is-side', box.zone === 'main' && box.size !== 'row' && box.w / box.h > ((cw * 16) / (ch * 13.5)) * 1.45);
  // by the size, not by what this card has under it, so cards of one size have one type size; a tall box past the
  // named sizes: the icon over the name and the state, all larger (styles-canvas-room.css)
  const tall = root.dataset.room !== undefined && box.zone === 'main' && box.size !== 'row' && box.h > box.w * 1.05;
  root.classList.toggle('is-tall', tall);
  const nominal = tall ? 13 + rowsFor(box.size) * 5.6 : box.size === 'xs' ? 9.5 : box.size === 'row' ? 4.5 : 5.5 + Math.max(1, rowsFor(box.size)) * 5.6;
  // the line two fine cells wide (#9): no icon, the name over the state, the type from the height as on a wider line
  const narrow = box.size === 'row' && root.dataset.mini !== undefined && Number(root.dataset.mw) <= 2;
  root.classList.toggle('is-mnarrow', narrow);
  // a line much narrower than its height wants (4×2 on the fine grid, 2×1 on the normal one): the name over the
  // state, the type from the height, the same for every card of that box whatever its name (#9)
  const deep = !narrow && box.size === 'row' && box.zone === 'main' && box.w / 22 < (box.h / nominal) * 0.8 && belowRow(root);
  let wk = deep
    ? bigType(root, box, 6.8, scaleOf(env), 14, typeCap(root))
    : bigType(root, box, nominal, scaleOf(env), tall ? 12 : box.size === 'xs' ? 11 : box.size === 'row' ? (narrow ? 11 : 22) : 24, typeCap(root));
  const over = () => root.scrollHeight > root.clientHeight + 1;
  if (!root.clientHeight) return;
  const wk0 = wk;
  const smaller = (floor: number) => {
    for (let i = 0; i < 4 && over() && wk > floor; i++) {
      wk = Math.max(floor, wk * (root.clientHeight / root.scrollHeight) * 0.97);
      root.style.setProperty('--wk', wk.toFixed(3));
    }
  };
  // a little smaller type first, then the rows go (the last one first) before the type gets small, so the name and
  // the state keep the size of their neighbours'
  smaller(wk0 * 0.9);
  while (over()) {
    const feats = root.querySelector('.cv-ha-feats');
    // a cover's buttons stay: the type gets smaller instead (they are what the card is for)
    const last = [...(feats?.children ?? [])].reverse().find((r) => !r.classList.contains('feat-cover'));
    if (!feats || !last) break;
    last.remove();
    if (!feats.childElementCount) {
      feats.remove();
      root.classList.remove('has-feats');
    }
    // the state line again, for the rows that are left
    const left = [...root.querySelectorAll('.cv-ha-feat')].map((r) => r.className.replace(/.*\bfeat-(\w+).*/, '$1') as TileFeature);
    const st = root.querySelector('.cv-ha-tile .cv-ha-state');
    if (st) st.textContent = tileStateText(env.ha.state(aliasOf((env.item().props as Props).entity)), left);
    wk = wk0;
    root.style.setProperty('--wk', wk.toFixed(3));
    smaller(wk0 * 0.9);
  }
  smaller(0.5);
  // the line of a cover: up and down only while the name keeps a word or so beside them
  const lb = box.size === 'row' ? root.querySelector<HTMLElement>('.cv-ha-coverbtns.is-line, .cv-ha-stepper.is-line') : null;
  // the stacked line with buttons at its end: the icon gives the name its room, so the buttons can stay
  root.classList.toggle('no-lico', deep && !!lb);
  if (lb) {
    const name = root.querySelector<HTMLElement>('.cv-ha-tile .cv-ha-name');
    const em = name ? parseFloat(getComputedStyle(name).fontSize) || 16 : 16;
    // the stacked line: by the room beside the buttons (not by the name), so every card of a box looks the same
    const txt = root.querySelector<HTMLElement>('.cv-ha-tile .cv-ha-txt');
    const short = deep ? !!txt && txt.clientWidth < em * 4.5 : !!name && name.scrollWidth > name.clientWidth + 1 && name.clientWidth < em * 5;
    if (short) {
      lb.remove();
      root.classList.remove('no-lico');
      smaller(0.5);
    }
  }
  // the line in a narrow box (2×1): when the state leaves the name only a letter or two, the state goes under the
  // name instead of beside it, so the name reads
  if (narrow || deep) {
    if (narrow) root.querySelector('.cv-ha-coverbtns.is-line, .cv-ha-stepper.is-line')?.remove();
    root.classList.toggle('is-stack', !!root.querySelector('.cv-ha-tile .cv-ha-state')?.textContent);
    smaller(0.5);
    if (deep) return;
  } else if (box.size === 'row') stackLine(root, () => smaller(0.5));
  // a narrow box of its own (two cells of a wide sidebar): the type a little smaller until the name reads, since
  // the icon beside it grows with the type and leaves the name a letter or two
  else if (narrowName(root, wk)) return;
  growToFill(root, root.dataset.room !== undefined ? 2.2 : 1.4, scaleOf(env));
}

/**
 * True when the card's box is fewer cells wide than the line's own size (3 of 12 columns, 4 of 8 in portrait; twice
 * that on the fine grid): only such boxes take the stacked line, so a line of its own size looks as it always did.
 */
function belowRow(root: HTMLElement): boolean {
  const w = Number(root.closest<HTMLElement>('.cv-item')?.dataset.cells?.split('x')[0]);
  const grid = root.closest<HTMLElement>('#canvas');
  if (!w || !grid) return false;
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  return w < (cols % 12 === 0 ? cols / 4 : cols / 2);
}

/**
 * A tile header in a box too narrow for its type: smaller type (icon and text together) while the name shows only a
 * few letters, down to 60 % of what the height gave. True when it made the type smaller.
 */
export function narrowName(root: HTMLElement, wk: number): boolean {
  const name = root.querySelector<HTMLElement>('.cv-ha-name');
  if (!name || !name.getClientRects().length) return false;
  const short = () => {
    const em = parseFloat(getComputedStyle(name).fontSize) || 16;
    return name.scrollWidth > name.clientWidth + 1 && name.clientWidth < em * 5;
  };
  if (!short()) return false;
  const floor = wk * 0.6;
  for (let i = 0; i < 8 && short() && wk > floor; i++) {
    wk = Math.max(floor, wk * 0.9);
    root.style.setProperty('--wk', wk.toFixed(3));
  }
  return true;
}

/** The line card: the name over the state when beside it the name would show only a few letters. */
function stackLine(root: HTMLElement, refit: () => void): void {
  root.classList.remove('is-stack');
  const name = root.querySelector<HTMLElement>('.cv-ha-tile .cv-ha-name');
  const state = root.querySelector<HTMLElement>('.cv-ha-tile .cv-ha-state');
  if (!name || !state?.textContent) return;
  // beside the state the name is cut: over it, where the whole width is the name's (kept only when that shows more)
  if (name.scrollWidth <= name.clientWidth + 1) return;
  const before = name.clientWidth / name.scrollWidth;
  const wk = root.style.getPropertyValue('--wk');
  root.classList.add('is-stack');
  refit();
  if (name.clientWidth / name.scrollWidth <= before + 0.02) {
    root.classList.remove('is-stack');
    root.style.setProperty('--wk', wk);
  }
}

/**
 * A tile-like card with room to spare (a wide or tall box of its own size, a short name): its type grows a little
 * with the box (--cv-grow), at most `max` times what the type size alone gives, while the content stays well inside the card
 * and no state line gets cut that was whole. Cards that already fill their box (Persiana Pequeño) do not change.
 * A smaller Tamaño del texto (`scale` under 1) lowers that limit as much, so the growth never undoes it.
 */
export function growToFill(root: HTMLElement, max = 1.4, scale = 1): void {
  root.style.removeProperty('--cv-grow');
  max *= Math.min(1, scale);
  const wk0 = 1;
  if (!root.clientHeight || !root.clientWidth) return;
  const cs = getComputedStyle(root);
  const inner = root.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  const kids = Array.from(root.children).filter((c) => c.getClientRects().length) as HTMLElement[];
  if (!kids.length || inner <= 0) return;
  const used = () => {
    let top = Infinity;
    let bottom = -Infinity;
    for (const c of kids) {
      const r = c.getBoundingClientRect();
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
    return bottom - top;
  };
  // the names and the state lines that are whole stay whole. A name is measured by its text, not by scrollWidth: a
  // name over by less than a pixel already ends in … while scrollWidth still equals clientWidth ("Gard...").
  const names = Array.from(root.querySelectorAll<HTMLElement>('.cv-ha-state, .cv-ha-name')).filter((n) => n.getClientRects().length);
  const textW = (n: HTMLElement) => {
    const r = document.createRange();
    r.selectNodeContents(n);
    return r.getBoundingClientRect().width;
  };
  const cut = (n: HTMLElement) => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1 || textW(n) > n.getBoundingClientRect().width + 0.5;
  const whole = names.filter((n) => !cut(n));
  const set = (k: number) => root.style.setProperty('--cv-grow', k.toFixed(3));
  let wk = wk0;
  for (let i = 0; i < 8; i++) {
    const next = Math.min(wk0 * max, wk * 1.06);
    if (next <= wk + 0.001) break;
    set(next);
    const fits = root.scrollHeight <= root.clientHeight + 1 && root.scrollWidth <= root.clientWidth + 1 && used() <= inner * 0.84 && !whole.some(cut);
    if (!fits) {
      set(wk);
      break;
    }
    wk = next;
  }
}

/**
 * The Indicador and the Estadística on one line (a box only the fine grid has, styles-canvas-mini.css): the number
 * as high as the line allows on the left, never more than about half the width, the name (and the bar or what the
 * number is) beside it.
 */
function fitNumberLine(root: HTMLElement, box: AdapterBox, env: AdapterEnv): void {
  const cs = getComputedStyle(root);
  const h = root.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  const w = root.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  // the number's line box is 5.6rem × --wk high
  let wk = Math.min(1.2, (h * 0.66) / (5.6 * box.rem)) * Math.min(1, scaleOf(env));
  root.style.setProperty('--wk', wk.toFixed(3));
  const big = root.querySelector<HTMLElement>('.cv-ha-big');
  const bw = big?.getBoundingClientRect().width ?? 0;
  if (bw > w * 0.5) {
    wk = Math.max(0.25, (wk * w * 0.5) / bw);
    root.style.setProperty('--wk', wk.toFixed(3));
  }
}

// ------------------------------------------------------------------------------------------------ gauge
/** ok / warn / err of a value against two breakpoints (inverted: a high value is the good one). */
function level(num: number, th: unknown, invert: boolean): '' | 'ok' | 'warn' | 'err' {
  if (!Array.isArray(th) || th.length !== 2) return '';
  const [a, b] = th as [number, number];
  const l = num < a ? 0 : num <= b ? 1 : 2;
  return (['ok', 'warn', 'err'] as const)[invert ? 2 - l : l];
}

function drawGauge(root: HTMLElement, env: AdapterEnv): void {
  const p = env.item().props as Props;
  const alias = aliasOf(p.entity);
  const s = env.ha.state(alias);
  const decimals = Math.min(3, Math.max(0, Number(p.decimals ?? 1)));
  const head = el('div', 'cv-ha-head');
  const htxt = el('div', 'cv-ha-txt');
  htxt.append(el('span', 'cv-ha-name', nameOf(p, s)));
  head.append(icon(stateIcon(domainOf(p.entity), s)), htxt);
  root.appendChild(head);
  const big = el('div', 'cv-ha-big');
  const num = s?.d === 'sensor' ? s.num : null;
  if (num === null) {
    big.append(el('span', 'v is-text', s ? stateText(s, decimals) : ''));
    root.appendChild(big);
    return;
  }
  const lv = level(num, p.thresholds, !!p.invert);
  big.append(el('span', 'v', fmtNum(num, decimals)));
  if (s?.d === 'sensor' && s.unit) big.append(el('span', 'u', s.unit));
  if (lv) big.classList.add(`lv-${lv}`);
  root.appendChild(big);
  // the bar: the bands of the breakpoints underneath, the value filled in its band's colour
  const lo = Number(p.min ?? 0);
  const hi = Number(p.max ?? 100) > lo ? Number(p.max ?? 100) : lo + 1;
  const X = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const svg = svgEl('svg', { viewBox: '0 0 100 10', preserveAspectRatio: 'none', class: 'cv-ha-gaugebar', 'aria-hidden': 'true' });
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: 100, height: 10, rx: 5, class: 'track' }));
  if (Array.isArray(p.thresholds) && p.thresholds.length === 2) {
    const [a, b] = (p.thresholds as number[]).map(X);
    const names = p.invert ? ['err', 'warn', 'ok'] : ['ok', 'warn', 'err'];
    [[0, a], [a, b], [b, 100]].forEach(([x0, x1], i) => {
      if (x1 > x0) svg.appendChild(svgEl('rect', { x: x0, y: 0, width: x1 - x0, height: 10, class: `band lv-${names[i]}` }));
    });
  }
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: Math.max(0.5, X(num)), height: 10, rx: 5, class: `fill${lv ? ` lv-${lv}` : ''}` }));
  root.appendChild(svg);
  const mm = el('div', 'cv-ha-gaugeends cv-sec1');
  mm.append(el('span', '', fmtNum(lo, decimals)), el('span', '', fmtNum(hi, decimals)));
  root.appendChild(mm);
}

// ------------------------------------------------------------------------------------------------ statistic
const STAT_PERIOD_KEY: Record<string, string> = { today: 'haStatToday', week: 'haStatWeek', month: 'haStatMonth' };
const STAT_TYPE_KEY: Record<string, string> = { mean: 'haStatMean', min: 'haStatMin', max: 'haStatMax' };

/** "Hoy", "Media · Esta semana": what the number is. */
export function statCaption(stat: string, period: string): string {
  const per = ctx.t(STAT_PERIOD_KEY[period] ?? 'haStatToday');
  return STAT_TYPE_KEY[stat] ? `${ctx.t(STAT_TYPE_KEY[stat])} · ${per}` : per;
}

function statisticAdapter(): CanvasAdapter {
  // the value: kept between draws, asked for again when the item changes or every 5 minutes
  let val: HaStatistic | null = null;
  let valV = '';
  let valAt = 0;
  let asking = false;
  let ask: (() => void) | null = null;
  const base = haAdapter('cv-ha-sensor cv-ha-stat', (p) => [aliasOf(p.entity)].filter(Boolean), (root, env) => {
    const it = env.item();
    const p = it.props as Props;
    const s = env.ha.state(aliasOf(p.entity));
    const decimals = Math.min(3, Math.max(0, Number(p.decimals ?? 1)));
    // the header: the icon, the name and under it what the number is ("Media · Hoy")
    const head = el('div', 'cv-ha-head');
    const htxt = el('div', 'cv-ha-txt');
    htxt.append(el('span', 'cv-ha-name', nameOf(p, s)), el('span', 'cv-ha-ago cv-ha-statcap', statCaption(String(p.stat || 'change'), String(p.period || 'today'))));
    head.append(icon('stats'), htxt);
    root.appendChild(head);
    const big = el('div', 'cv-ha-big');
    const v = val && valV === it.v ? val : null;
    if (v && v.value !== null) {
      big.append(el('span', 'v', fmtNum(v.value, decimals)));
      const unit = v.unit || (s?.d === 'sensor' ? s.unit : '');
      if (unit) big.append(el('span', 'u', unit));
    } else big.append(el('span', 'v is-text', v ? ctx.t('haNoData') : ''));
    root.appendChild(big);
    if (!asking && (valV !== it.v || Date.now() - valAt > 5 * 60_000)) ask?.();
  }, (root, box, env) => {
    if (miniLine(root)) return fitNumberLine(root, box, env);
    const wk = bigType(root, box, 11.5, scaleOf(env), 14, typeCap(root));
    fitWidth(root, root.querySelector('.cv-ha-big'), wk);
  });
  return {
    ...base,
    mount(r, e) {
      ask = () => {
        const it = e.item();
        const v = it.v;
        asking = true;
        void e.ha.statistic(it.id, v).then((x) => {
          asking = false;
          valAt = Date.now();
          if (e.item().v !== v) return;
          val = x ?? { stat: 'change', period: 'today', value: null, unit: '' };
          valV = v;
          base.update();
        });
      };
      base.mount(r, e);
    },
  };
}

export const HA_TILE_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  'ha.tile': () => haAdapter('cv-ha-tile-card', (p) => [aliasOf(p.entity)].filter(Boolean), drawTile, (root, box, env) => {
    fitTile(root, box, env);
    fitSwatches(root);
  }),
  'ha.gauge': () => haAdapter('cv-ha-sensor cv-ha-gauge', (p) => [aliasOf(p.entity)].filter(Boolean), drawGauge, (root, box, env) => {
    if (miniLine(root)) return fitNumberLine(root, box, env);
    const wk = bigType(root, box, box.size === 'xs' ? 11.5 : 13, scaleOf(env), 14, typeCap(root));
    fitWidth(root, root.querySelector('.cv-ha-big'), wk);
  }),
  'ha.statistic': () => statisticAdapter(),
};
