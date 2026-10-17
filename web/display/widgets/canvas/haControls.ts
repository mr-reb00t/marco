// Personalizado Home Assistant cards made for touch: a light (a bulb in its own colour, on and off, brightness from
// size s, colour temperature at m), a switch or a fan (its speed at s), a climate (a ring dial with −/+, the modes
// and the fan), a cover (up, stop, down and its position) and up to six scene or script buttons. They show the state
// on any screen; the controls are live only where touch is allowed (ha.ts live(): the screen's switch, the item's,
// and the controls the server lists for that state). touch.ts turns the taps into actions.
import type { DisplayCanvasItem, HaState, TileFeature } from '../../../shared/types';
import { ctx } from '../../ctx';
import { CTL_ICON, aliasOf, ctlButton, ctlChips, ctlSlider, domainOf, fanName, fmtNum, modeName, ring, stateIcon, stateText, tone } from '../ha/haui';
import { bigType, typeCap } from './clock';
import { el, haAdapter, icon, live, miniLine, nameOf, tappable } from './ha';
import { coverButtons, drawTile, fitTile, growToFill, tileStateText } from './haTile';
import type { AdapterBox, AdapterEnv, CanvasAdapter } from './types';

type Props = Record<string, any>;
const scaleOf = (env: AdapterEnv) => Number(env.item().style?.scale) || 1;
const armedKey = (env: AdapterEnv) => env.ha.armed(env.item().id);
const sizeOf = (root: HTMLElement) => root.dataset.size || 's';

/** A colour for a colour temperature (warm candle to cool daylight), close enough for a glowing bulb. */
export function kelvinRgb(k: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (k - 2000) / 4500));
  return [255, Math.round(170 + 75 * t), Math.round(90 + 150 * t)];
}

/** The icon, the name and the state line on top of a card with controls (the icon answers a tap when it can). */
function topOf(root: HTMLElement, env: AdapterEnv, ico: HTMLElement, state: string): HTMLElement {
  const p = env.item().props as Props;
  const alias = aliasOf(p.entity);
  const s = env.ha.state(alias);
  const top = el('div', `cv-ha-light-top tone-${tone(s)}`);
  // the card's state colour
  root.dataset.tone = tone(s);
  tappable(ico, env, alias, s);
  const txt = el('div', 'cv-ha-txt');
  txt.append(el('span', 'cv-ha-name', nameOf(p, s)), el('span', 'cv-ha-state cv-sec3', state));
  top.append(ico, txt);
  root.appendChild(top);
  return top;
}

// ------------------------------------------------------------------------------------------------ light
/** Whether a light takes colours (swatches) or only colour temperature (chips). */
const colorful = (s: HaState | null) => s?.d === 'light' && !s.onoff && (!!s.col || !!(s.ctMin && s.ctMax));

/** The rows under a light card for its option and size: the colours, the brightness, both on the larger sizes. */
function lightRows(p: Props, s: HaState | null, size: string): TileFeature[] {
  if (s?.d !== 'light' || s.onoff) return [];
  const row = String(p.row || 'auto');
  if (row === 'none') return [];
  const color = colorful(s) && p.colorTemp !== false;
  const bri = p.brightness !== false;
  if (size === 'sq' || size === 'm') return [...(bri ? ['brightness' as const] : []), ...(color && row !== 'brightness' ? ['color' as const] : [])];
  if (row === 'brightness') return bri ? ['brightness'] : [];
  return color ? ['color'] : [];
}

/**
 * The light card. The icon switches it on and off (no switch row); lit, it glows in the light's colour. From the
 * small size up a row of colours (or the brightness, as the owner chose); the square and medium sizes have both; the
 * tall one the brightness as a ring around a big bulb, −/+ beside it, and the colours under it.
 */
function drawLight(root: HTMLElement, env: AdapterEnv): void {
  const size = sizeOf(root);
  const p = env.item().props as Props;
  const s = env.ha.state(aliasOf(p.entity));
  root.classList.toggle('cv-ha-tile-card', size !== 't');
  if (size !== 't') return drawTile(root, env, lightRows(p, s, size));
  drawLightRing(root, env);
}

function drawLightRing(root: HTMLElement, env: AdapterEnv): void {
  const p = env.item().props as Props;
  const alias = aliasOf(p.entity);
  const s = env.ha.state(alias);
  const l = s?.d === 'light' ? s : null;
  const on = !!l?.on;
  root.dataset.tone = tone(s);
  const txt = el('div', 'cv-ha-txt');
  txt.append(el('span', 'cv-ha-name', nameOf(p, s)), el('span', 'cv-ha-state cv-sec3', tileStateText(s)));
  root.appendChild(txt);
  const dial = el('div', `cv-ha-dial cv-ha-lring tone-${tone(s)}`);
  dial.appendChild(ring({ min: 0, max: 100, target: on && l && !l.onoff ? l.bri ?? 100 : null, cur: null }));
  const bulb = icon('bulb', 'cv-ha-bulb');
  if (on && l) {
    const rgb = l.rgb ?? (l.ct ? kelvinRgb(l.ct) : [255, 201, 77]);
    bulb.style.setProperty('--glow', `${rgb[0]} ${rgb[1]} ${rgb[2]}`);
    bulb.style.setProperty('--glow-a', String(0.35 + 0.65 * ((l.bri ?? 100) / 100)));
    bulb.classList.add('is-on');
    root.style.setProperty('--tile-c', `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`);
  } else root.style.removeProperty('--tile-c');
  tappable(bulb, env, alias, s);
  const mid = el('div', 'cv-ha-dial-mid');
  mid.append(bulb);
  dial.append(mid);
  const armed = armedKey(env);
  if (l && !l.onoff && p.brightness !== false && live(env, s, 'brightness')) {
    const step = (d: number, ic: 'minus' | 'plus', cls: string) => ctlButton({ cls: `cv-ha-step ${cls}`, alias, control: 'brightness', live: true, d, icon: ic, label: ctx.t('haBrightness'), armed: armed === `${alias}|brightness` });
    dial.append(step(-10, 'minus', 'cv-ha-dial-l'), step(10, 'plus', 'cv-ha-dial-r'));
  }
  root.appendChild(dial);
  if (p.row !== 'none' && p.colorTemp !== false) {
    const row = colorRow(env, alias, s);
    if (row) root.appendChild(row);
  }
}

/**
 * As many swatches as the row holds at their full touch size: the others are left out, the lit one always kept (the
 * row is never cut halfway through a swatch).
 */
export function fitSwatches(root: HTMLElement): void {
  // the warm, neutral and cool chips: their words a little smaller (to 70 %) so the last one is not cut by the edge
  for (const row of root.querySelectorAll<HTMLElement>('.cv-ha-ct')) {
    row.style.removeProperty('font-size');
    row.classList.remove('is-tight');
    let k = 1;
    for (let i = 0; i < 5 && row.clientWidth && row.scrollWidth > row.clientWidth + 1 && k > 0.7; i++) {
      k = Math.max(0.7, k * (row.clientWidth / row.scrollWidth) * 0.97);
      row.style.fontSize = `${k.toFixed(3)}em`;
    }
    // still too wide: closer chips with less padding
    if (row.scrollWidth > row.clientWidth + 1) row.classList.add('is-tight');
  }
  for (const row of root.querySelectorAll<HTMLElement>('.cv-ha-swatches')) {
    const all = [...row.children] as HTMLElement[];
    for (const b of all) b.style.display = '';
    row.style.removeProperty('justify-content');
    // all of them fit with a little room left: spread over the row, so it ends on the card's edge (a far wider row
    // keeps them together on the left)
    if (row.scrollWidth <= row.clientWidth + 1 && all.length > 1) {
      const used = all[all.length - 1].getBoundingClientRect().right - all[0].getBoundingClientRect().left;
      if (used >= row.clientWidth * 0.6) row.style.justifyContent = 'space-between';
      continue;
    }
    if (row.scrollWidth <= row.clientWidth + 1 || !all.length) continue;
    const w = all[0].getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const n = Math.max(1, Math.floor((row.clientWidth + gap) / (w + gap)));
    const lit = all.findIndex((b) => b.classList.contains('is-on'));
    const keep = new Set(all.slice(0, n).map((_, i) => i));
    if (lit >= n) keep.delete(n - 1), keep.add(lit);
    all.forEach((b, i) => {
      if (!keep.has(i)) b.style.display = 'none';
    });
  }
}

/** A few colours to choose from: two whites (by colour temperature) and six colours, the one it has now lit. */
const SWATCHES: { key: string; k?: number; rgb?: [number, number, number] }[] = [
  { key: 'haWarm', k: 2700 }, { key: 'haCool', k: 6000 },
  { key: 'haColRed', rgb: [255, 59, 48] }, { key: 'haColOrange', rgb: [255, 149, 0] }, { key: 'haColGreen', rgb: [52, 199, 89] },
  { key: 'haColBlue', rgb: [10, 132, 255] }, { key: 'haColPurple', rgb: [175, 82, 222] }, { key: 'haColPink', rgb: [255, 55, 140] },
];

/** The colour row of a light: swatches for a colour light, warm, neutral and cool chips for a white one, or null. */
export function colorRow(env: AdapterEnv, alias: string, s: HaState | null): HTMLElement | null {
  const l = s?.d === 'light' ? s : null;
  if (!l || l.onoff) return null;
  if (!l.col) return ctChips(env, alias, s);
  const row = el('div', 'cv-ha-swatches');
  const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 60;
  const lit = !l.on ? -1 : SWATCHES.findIndex((w) => w.rgb && l.rgb && near(w.rgb, l.rgb));
  const litW = !l.on || lit >= 0 || !l.ct ? -1 : SWATCHES.findIndex((w) => w.k && Math.abs(w.k - l.ct!) < 700);
  const armed = armedKey(env);
  SWATCHES.forEach((w, i) => {
    const control = w.k ? 'colorTemp' : 'rgb';
    const value = w.k ?? w.rgb;
    const b = ctlButton({ cls: 'cv-swatch', alias, control, live: live(env, s, control), value, label: ctx.t(w.key), on: i === lit || i === litW, armed: armed === `${alias}|${control}|${JSON.stringify(value)}` });
    const [r, g, bl] = w.rgb ?? kelvinRgb(w.k!);
    b.style.setProperty('--sw', `rgb(${r} ${g} ${bl})`);
    row.append(b);
  });
  return row;
}

/** Colour temperature as three chips, warm, neutral and cool, within what the light can do (null: it cannot). */
export function ctChips(env: AdapterEnv, alias: string, s: HaState | null): HTMLElement | null {
  const l = s?.d === 'light' ? s : null;
  if (!l || !l.ctMin || !l.ctMax || l.ctMax <= l.ctMin) return null;
  const pick = (k: number) => Math.round(Math.max(l.ctMin!, Math.min(l.ctMax!, k)));
  const opts = [
    { v: pick(2700), key: 'haWarm' },
    { v: pick(4000), key: 'haNeutral' },
    { v: pick(6000), key: 'haCool' },
  ].filter((o, i, a) => a.findIndex((x) => x.v === o.v) === i);
  const near = l.on && l.ct ? opts.reduce((a, b) => (Math.abs(b.v - l.ct!) < Math.abs(a.v - l.ct!) ? b : a)).v : null;
  const row = el('div', 'cv-chips cv-ha-ct');
  const lv = live(env, s, 'colorTemp');
  for (const o of opts) {
    const b = ctlButton({ cls: 'cv-chip', alias, control: 'colorTemp', live: lv, value: o.v, text: ctx.t(o.key), label: ctx.t(o.key), on: o.v === near, armed: armedKey(env) === `${alias}|colorTemp|${o.v}` });
    const [r, g, bl] = kelvinRgb(o.v);
    b.style.setProperty('--chip-dot', `rgb(${r} ${g} ${bl})`);
    row.append(b);
  }
  return row;
}

// ------------------------------------------------------------------------------------------------ switch / fan
/** The switch card: like an Entidad card, the icon (and the card) switches it; a fan's speed under it from small up. */
function drawSwitch(root: HTMLElement, env: AdapterEnv): void {
  const p = env.item().props as Props;
  root.classList.add('cv-ha-tile-card');
  drawTile(root, env, domainOf(p.entity) === 'fan' ? ['fanPct'] : []);
}

// ------------------------------------------------------------------------------------------------ climate
const ACTION_KEY: Record<string, string> = { heating: 'haHeating', cooling: 'haCooling', drying: 'haDrying', fan: 'haFanAction', idle: 'haClimateIdle', off: 'haModeOff' };
/** The modes people use most, in that order (a new card offers off and the first two of these the entity has). */
const MODE_PREF = ['heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'];
type Climate = Extract<HaState, { d: 'climate' }>;

/** The modes a climate card offers: the owner's, else off and the two most used the entity has; the current one always. */
export function climateModes(c: Pick<Climate, 'modes' | 'mode'>, keep: unknown): string[] {
  const list = Array.isArray(keep) ? c.modes.filter((m) => keep.includes(m)) : [...c.modes.filter((m) => m === 'off'), ...MODE_PREF.filter((m) => c.modes.includes(m)).slice(0, 2)];
  if (c.modes.includes(c.mode) && !list.includes(c.mode)) list.push(c.mode);
  return c.modes.filter((m) => list.includes(m));
}

/** What a climate is doing and the temperature now: "Calentando · ahora 20,5°", "Apagado · ahora 23°". */
export function climateState(c: Climate): string {
  const act = c.mode === 'off' ? modeName('off') : c.action && c.action !== 'off' && ACTION_KEY[c.action] ? ctx.t(ACTION_KEY[c.action]) : modeName(c.mode);
  return c.cur !== null ? `${act} · ${ctx.t('haNowTemp', { t: `${fmtNum(c.cur, 1)}°` })}` : act;
}

/** On and off for a climate (to off, or back to the first mode the card offers), when touch allows and it has off. */
function climatePower(env: AdapterEnv, alias: string, s: HaState | null, c: Climate, modes: string[]): HTMLElement | null {
  if (!c.modes.includes('off') || !live(env, s, 'hvacMode')) return null;
  const on = c.mode !== 'off';
  const back = modes.find((m) => m !== 'off') ?? c.modes.find((m) => m !== 'off');
  if (!on && !back) return null;
  return ctlButton({ cls: 'cv-ha-power', alias, control: 'hvacMode', live: true, value: on ? 'off' : back, icon: 'power', on, label: ctx.t(on ? 'haTurnOff' : 'haTurnOn'), armed: armedKey(env) === `${alias}|hvacMode|${on ? 'off' : back}` });
}

function drawClimate(root: HTMLElement, env: AdapterEnv): void {
  // one line (a box only the fine grid has, whatever size it is drawn like): the line, − the target + at its end
  if (miniLine(root)) root.dataset.size = 'row';
  root.classList.toggle('cv-ha-tile-card', sizeOf(root) === 'row');
  root.classList.remove('has-under');
  const size = sizeOf(root);
  if (size === 'row') return drawTile(root, env);
  const p = env.item().props as Props;
  const alias = aliasOf(p.entity);
  const s = env.ha.state(alias);
  const c = s?.d === 'climate' ? s : null;
  root.dataset.tone = tone(s);
  const head = el('div', 'cv-ha-head');
  head.append(icon('climate'), el('span', 'cv-ha-name', nameOf(p, s)));
  root.appendChild(head);
  if (!c) {
    root.appendChild(el('div', 'cv-ha-big', s ? stateText(s) : ''));
    return;
  }
  const modes = climateModes(c, p.modes);
  const pw = climatePower(env, alias, s, c, modes);
  const dec = c.step < 1 ? 1 : 0;
  const off = c.mode === 'off';
  const range = c.mode === 'heat_cool' && c.lo !== null && c.hi !== null;
  const armed = armedKey(env);
  const chips = () => (modes.length > 1 ? ctlChips({ cls: 'cv-ha-modes', alias, control: 'hvacMode', live: live(env, s, 'hvacMode'), options: modes.map((m) => ({ v: m, label: modeName(m) })), current: c.mode, armed }) : null);
  const steppers = (): [HTMLElement, HTMLElement] | null => {
    if (off) return null;
    if (range) return live(env, s, 'setpointRange') ? [stepper(alias, 'setpointRange', -c.step, 'lo', 'minus', 'cv-ha-dial-l', armed), stepper(alias, 'setpointRange', c.step, 'hi', 'plus', 'cv-ha-dial-r', armed)] : null;
    return c.target !== null && live(env, s, 'setpoint') ? [stepper(alias, 'setpoint', -c.step, '', 'minus', 'cv-ha-dial-l', armed), stepper(alias, 'setpoint', c.step, '', 'plus', 'cv-ha-dial-r', armed)] : null;
  };
  const targetText = range ? `${fmtNum(c.lo!, dec)}–${fmtNum(c.hi!, dec)}°` : c.target !== null ? `${fmtNum(c.target, dec)}°` : '';

  if (size === 'xs' || size === 's' || size === 'w') {
    // the target in big type between − and +, what it is doing and the temperature now under it; on and off in the
    // corner; the wide card puts the modes beside it
    // on and off in the corner, unless the wide card's modes already have Apagado
    if (pw && !(size === 'w' && modes.length > 1 && modes.includes('off'))) {
      pw.classList.add('cv-sec2');
      head.append(pw);
    }
    const main = el('div', 'cv-ha-cl-main');
    const mid = el('div', 'cv-ha-cl-mid');
    const big = el('span', 'cv-ha-cl-big', off ? (c.cur !== null ? `${fmtNum(c.cur, 1)}°` : modeName('off')) : targetText);
    const st = steppers();
    if (st) mid.append(st[0], big, st[1]);
    else mid.append(big);
    main.append(mid, el('span', 'cv-ha-state cv-sec3', off ? modeName('off') : climateState(c)));
    root.appendChild(main);
    // a tall narrow box of its own: the modes under it, so the card is not a band of empty space around one line
    if ((size === 'xs' || size === 's') && root.dataset.shape === 'tall') {
      const ch = chips();
      if (ch) {
        root.classList.add('has-under');
        main.append(ch);
      }
    }
    if (size === 'w') {
      const ch = chips();
      if (ch) {
        root.classList.add('has-side');
        main.append(ch);
      }
    }
    return;
  }

  // medium and tall: the ring dial (the temperature now inside, the target under it, −/+ beside it), one row of modes
  if (pw && modes.length < 2) head.append(pw);
  const dial = el('div', `cv-ha-dial tone-${tone(s)}`);
  dial.appendChild(ring({ min: c.min, max: c.max, target: off ? null : c.target, lo: range ? c.lo : null, hi: range ? c.hi : null, cur: c.cur }));
  const mid = el('div', 'cv-ha-dial-mid');
  if (c.cur !== null) mid.append(el('span', 'cv-ha-cur', `${fmtNum(c.cur, 1)}°`));
  // the mode is said by the lit chip; without chips, off says so here
  const target = off ? (modes.length > 1 ? '' : modeName('off')) : targetText;
  if (target) mid.append(el('span', 'cv-ha-target', target));
  const act = !off && c.action && ['heating', 'cooling', 'drying', 'fan'].includes(c.action) ? ACTION_KEY[c.action] : '';
  if (act) mid.append(el('span', 'cv-ha-action cv-sec1', ctx.t(act)));
  dial.append(mid);
  const st = steppers();
  if (st) dial.append(...st);
  root.appendChild(dial);
  const ch = chips();
  if (ch) root.appendChild(ch);
  if (size === 't' && p.fan === true && c.fans && c.fans.length > 1) {
    const fans = ctlChips({ cls: 'cv-ha-fans cv-sec1', alias, control: 'fanMode', live: live(env, s, 'fanMode'), options: c.fans.map((m) => ({ v: m, label: fanName(m) })), current: c.fan, armed });
    root.appendChild(fans);
  }
  if (p.humidity === true && c.hum !== undefined) root.appendChild(el('div', 'cv-ha-climate-extra cv-sec1', ctx.t('haHumidityPct', { n: c.hum })));
}

/** A −/+ button: `d` is the step, `which` the setpoint of a range ('lo' or 'hi'). */
function stepper(alias: string, control: string, d: number, which: string, ic: 'minus' | 'plus', cls: string, armed: string): HTMLElement {
  const b = ctlButton({ cls: `cv-ha-step ${cls}`, alias, control, live: true, d, icon: ic, label: ctx.t(d < 0 ? 'haColder' : 'haWarmer'), armed: armed === `${alias}|${control}` });
  if (which) b.dataset.which = which;
  return b;
}

// ------------------------------------------------------------------------------------------------ cover
/**
 * The position of a cover as a shutter: the slats come down from the top as far as it is closed, the open part below
 * them, the percentage on it. Dragged up or down where the cover can be set to a position, else only shown.
 */
function shutter(alias: string, pos: number, lv: boolean): HTMLElement {
  const e = el('div', `cv-ha-shutter${lv ? '' : ' is-ro'}`);
  const slats = el('i', 'cv-ha-slats');
  slats.style.height = `${100 - pos}%`;
  // the open part: the daylight under the slats
  const open = el('b', 'cv-ha-sky');
  open.style.height = `${pos}%`;
  e.append(open, slats, el('span', 'cv-ha-shutter-t', `${pos} %`));
  e.setAttribute('role', 'slider');
  e.setAttribute('aria-orientation', 'vertical');
  e.setAttribute('aria-label', ctx.t('haPosition'));
  e.setAttribute('aria-valuemin', '0');
  e.setAttribute('aria-valuemax', '100');
  e.setAttribute('aria-valuenow', String(pos));
  if (lv) {
    e.dataset.a = alias;
    e.dataset.slide = 'position';
    e.dataset.min = '0';
    e.dataset.max = '100';
    e.dataset.step = '1';
    // top is open (100), bottom closed (0): touch.ts reads the finger's height
    e.dataset.dir = 'v';
  }
  return e;
}

/**
 * The cover card. The header (the icon beside the name, "Abierta al 46 %"), then with touch the buttons the cover
 * takes (up, stop, down) at every size: on the Mini alone in one row, on the small one under a wide position slider,
 * from the medium one up beside a shutter that shows and sets the position. Without touch the position only.
 */
/** A Persiana in a box only the fine grid has, one or two cells high: drawn as the line (its buttons below leave the name too small). */
const coverLine = (root: HTMLElement): boolean => root.dataset.mini !== undefined && Number(root.dataset.mh) <= 2;

function drawCover(root: HTMLElement, env: AdapterEnv): void {
  const p = env.item().props as Props;
  const alias = aliasOf(p.entity);
  const s = env.ha.state(alias);
  const cv = s?.d === 'cover' ? s : null;
  // one line (a box only the fine grid has, one or two cells high): the Entidad card's line, with up and down at
  // its end (two cells high: the name over the state, larger, #9)
  const line = coverLine(root);
  root.classList.toggle('cv-ha-tile-card', line);
  if (line) {
    root.dataset.size = 'row';
    return drawTile(root, env);
  }
  const size = sizeOf(root);
  topOf(root, env, icon('shutter'), s ? stateText(s) : '');
  if (!cv) return;
  const btns = coverButtons(env, alias, s);
  const setPos = cv.pos !== null && live(env, s, 'position');
  root.classList.toggle('has-btns', !!btns);
  if (size === 'm') {
    // the shutter and the buttons side by side, filling the card under the header
    const body = el('div', 'cv-ha-cvbody');
    if (cv.pos !== null) body.append(shutter(alias, cv.pos, setPos));
    if (btns) body.append(btns);
    if (body.childElementCount) root.appendChild(body);
    return;
  }
  if (cv.pos !== null) {
    if (setPos && size !== 'xs') {
      // the first thing to go when the card is short (the buttons stay)
      root.appendChild(ctlSlider({ cls: 'cv-ha-pos cv-sec1', alias, control: 'position', live: true, value: cv.pos, min: 0, max: 100, step: 1, label: ctx.t('haPosition'), text: `${cv.pos} %` }));
    } else if (!btns || size !== 'xs') {
      const bar = el('span', 'cv-ha-vol cv-ha-posbar cv-sec1');
      const fill = el('i', '');
      fill.style.width = `${cv.pos}%`;
      bar.appendChild(fill);
      root.appendChild(bar);
    }
  }
  if (btns) root.appendChild(btns);
}

// ------------------------------------------------------------------------------------------------ scenes
function drawScenes(root: HTMLElement, env: AdapterEnv): void {
  const p = env.item().props as Props;
  const grid = el('div', 'cv-ha-scenes');
  const list = ((p.buttons ?? []) as Props[]).filter((b) => aliasOf(b.entity));
  grid.style.setProperty('--n', String(list.length));
  for (const b of list) {
    const alias = aliasOf(b.entity);
    const s = env.ha.state(alias);
    const btn = el('div', `cv-ha-scene${s?.d === 'unavailable' ? ' tone-na' : ''}`);
    if (b.icon) btn.append(el('span', 'cv-ha-emoji', String(b.icon)));
    else btn.append(icon('scene'));
    btn.append(el('span', 'cv-ha-name', String(b.label || s?.n || '')));
    tappable(btn, env, alias, s);
    grid.append(btn);
  }
  root.appendChild(grid);
}

/**
 * Rows of mode and fan chips that do not fit their width: their words get smaller (to 60 %) so every chip shows
 * whole (a large text size, many modes), before the row would have to slide sideways.
 */
function fitChipRows(root: HTMLElement): void {
  for (const row of root.querySelectorAll<HTMLElement>('.cv-ha-modes, .cv-ha-fans')) {
    row.style.removeProperty('font-size');
    let k = 1;
    for (let i = 0; i < 5 && row.clientWidth && row.scrollWidth > row.clientWidth + 1 && k > 0.6; i++) {
      k = Math.max(0.6, k * (row.clientWidth / row.scrollWidth) * 0.97);
      row.style.fontSize = `${k.toFixed(3)}em`;
    }
  }
}

const fitBy = (rem: (size: string) => number, w: number) => (root: HTMLElement, box: AdapterBox, env: AdapterEnv) => {
  if (box.size === 'row') return fitTile(root, box, env);
  bigType(root, box, rem(box.size), scaleOf(env), w);
};

export const HA_CONTROL_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  'ha.light': () => haAdapter('cv-ha-ctl-card cv-ha-light', (p) => [aliasOf(p.entity)].filter(Boolean), drawLight, (root, box, env) => {
    if (box.size !== 't') fitTile(root, box, env);
    else bigType(root, box, 30, scaleOf(env), 26);
    fitSwatches(root);
  }),
  'ha.switch': () => haAdapter('cv-ha-ctl-card cv-ha-switchcard', (p) => [aliasOf(p.entity)].filter(Boolean), drawSwitch, fitTile),
  'ha.climate': () => haAdapter('cv-ha-ctl-card cv-ha-climate', (p) => [aliasOf(p.entity)].filter(Boolean), drawClimate, (root, box, env) => {
    if (box.size === 'row' || miniLine(root)) return fitTile(root, { ...box, size: 'row' }, env);
    const nominal = box.size === 'xs' ? 13 : box.size === 's' ? 12 : box.size === 'w' ? 11 : box.size === 't' ? 30 : 22;
    const sc = scaleOf(env);
    const dial = () => root.querySelector<HTMLElement>('.cv-ha-dial')?.clientHeight ?? 0;
    // the dial at 100 % first: a larger text size grows the words, never makes the dial smaller than that
    // (at 100 % the type stops at 1.5, the card's own upper limit then)
    const wk1 = Math.min(1.5, bigType(root, box, nominal, 1, 26));
    root.style.setProperty('--wk', wk1.toFixed(3));
    fitChipRows(root);
    const d1 = dial();
    if (sc !== 1) {
      let wk = bigType(root, box, nominal, sc, 26);
      fitChipRows(root);
      const floor = wk1 * 0.9;
      for (let i = 0; i < 12 && d1 && dial() < d1 * 0.97 && wk > floor; i++) {
        wk = Math.max(floor, wk - Math.max(0.03, (wk - wk1) * 0.3));
        root.style.setProperty('--wk', wk.toFixed(3));
        fitChipRows(root);
      }
    }
    // the target between − and + in a narrow box: smaller type until the number is whole, never under the buttons
    const big = root.querySelector<HTMLElement>('.cv-ha-cl-big');
    if (big) {
      let wk = parseFloat(root.style.getPropertyValue('--wk')) || 1;
      for (let i = 0; i < 10 && big.scrollWidth > big.clientWidth + 1 && wk > 0.5; i++) {
        wk = Math.max(0.5, wk * Math.max(0.8, (big.clientWidth / big.scrollWidth) * 0.98));
        root.style.setProperty('--wk', wk.toFixed(3));
      }
    }
    // a row of modes still wider than the card slides sideways: the lit one in view
    for (const row of root.querySelectorAll<HTMLElement>('.cv-ha-modes, .cv-ha-fans')) {
      const on = row.querySelector<HTMLElement>('.is-on');
      if (on && row.scrollWidth > row.clientWidth) row.scrollLeft = on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
    }
  }),
  'ha.cover': () => haAdapter('cv-ha-ctl-card cv-ha-cover', (p) => [aliasOf(p.entity)].filter(Boolean), drawCover, (root, box, env) => {
    if (coverLine(root)) return fitTile(root, { ...box, size: 'row' }, env);
    fitBy((z) => (z === 'xs' ? 13 : z === 'm' ? 13 : 12), 22)(root, box, env);
    if (box.size !== 'row') growToFill(root, 1.4, scaleOf(env));
  }),
  'ha.scene': () => haAdapter('cv-ha-ctl-card cv-ha-scenecard', (p) => ((p.buttons ?? []) as Props[]).map((b) => aliasOf(b.entity)).filter(Boolean), drawScenes, (root, box, env) => {
    // as many columns as the buttons need to fit the height (a button is at least 4.8rem high)
    const n = Math.max(1, ((env.item().props as Props).buttons ?? []).length);
    // a box only the fine grid has (one to three cells high): the buttons as chips in as many rows as the height
    // holds, the names on one line shortened with … (and no icon when a chip is narrow), so each scene still reads
    if (root.dataset.mini !== undefined) {
      const rows = Math.min(n, Math.max(1, Math.floor((box.h / box.rem + 0.5) / 5.2)));
      const cols = Math.ceil(n / rows);
      root.style.setProperty('--cols', String(cols));
      let wk = bigType(root, box, rows * 4.6 + (rows - 1) * 0.6, scaleOf(env), 0, 1.2);
      root.classList.toggle('no-ico', box.w / cols < 9 * box.rem * wk);
      // names cut: a little smaller type first (to 70 %), then the …
      const names = [...root.querySelectorAll<HTMLElement>('.cv-ha-scene .cv-ha-name')];
      const floor = wk * 0.7;
      for (let i = 0; i < 6 && wk > floor && names.some((e) => e.scrollWidth > e.clientWidth + 1); i++) {
        wk = Math.max(floor, wk * 0.92);
        root.style.setProperty('--wk', wk.toFixed(3));
      }
      return;
    }
    root.classList.remove('no-ico');
    const fitRows = Math.max(1, Math.floor((box.h / box.rem + 0.8) / 6.2));
    const want = box.size === 'w' ? Math.min(n, 6) : Math.min(n, box.size === 'xs' ? 1 : 2);
    // never so many columns that a name gets only a few letters (a narrow box of its own, a wide sidebar)
    const roomCols = Math.max(1, Math.floor(box.w / box.rem / 15));
    const cols = Math.min(n, roomCols, Math.max(want, Math.ceil(n / fitRows)));
    const rows = Math.ceil(n / cols);
    root.style.setProperty('--cols', String(cols));
    let wk = bigType(root, box, rows * 6.5, scaleOf(env), (cols * 12), typeCap(root));
    // a word wider than its button (a narrow box): smaller type until the names are whole, down to 60 %
    const names = [...root.querySelectorAll<HTMLElement>('.cv-ha-scene .cv-ha-name')];
    const floor = wk * 0.6;
    for (let i = 0; i < 8 && wk > floor && names.some((e) => e.scrollWidth > e.clientWidth + 1); i++) {
      wk = Math.max(floor, wk * 0.9);
      root.style.setProperty('--wk', wk.toFixed(3));
    }
  }),
};
