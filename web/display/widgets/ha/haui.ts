// Shared pieces of the Home Assistant cards (widgets/canvas/ha.ts and chart.ts): icons by domain and device class,
// the state as words, "hace X", the state colour class and a small SVG builder. Text is always set as text; the icons
// are static SVG strings.
import type { HaState } from '../../../shared/types';
import { ctx } from '../../ctx';
import { binaryKey } from './binaryWords';
import { g, type HaIconName } from './haIcons';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An SVG element with attributes (charts). */
export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export { HA_ICON, batteryIcon, haIconOf, type HaIconName } from './haIcons';

/** The icon of an entity: by its domain (from the alias) and, for sensors, its device class. */
export function stateIcon(domain: string, s: HaState | null): HaIconName {
  const dc = s && 'dc' in s ? s.dc ?? '' : '';
  switch (domain) {
    case 'light': return 'bulb';
    case 'switch': case 'input_boolean': return 'plug';
    case 'fan': return 'fan';
    case 'climate': return 'climate';
    case 'cover': return 'shutter';
    case 'media_player': return s?.d === 'media' && s.state === 'playing' ? 'music' : 'play';
    case 'scene': case 'script': case 'button': return 'scene';
    case 'lock': return 'lock';
    case 'alarm_control_panel': return 'shield';
    case 'person': case 'device_tracker': return 'person';
    case 'sun': case 'weather': return 'sun';
    case 'valve': return 'valve';
    case 'vacuum': return 'vacuum';
    case 'select': case 'input_select': return 'list';
    case 'update': return 'update';
    case 'binary_sensor':
      if (['door', 'garage_door', 'opening'].includes(dc)) return 'door';
      if (dc === 'window') return 'window';
      if (['motion', 'occupancy', 'moving', 'vibration'].includes(dc)) return 'motion';
      if (dc === 'presence') return 'person';
      if (dc === 'moisture') return 'drop';
      if (['smoke', 'gas', 'carbon_monoxide', 'safety', 'problem', 'tamper', 'sound'].includes(dc)) return 'bell';
      if (dc === 'connectivity') return 'wifi';
      if (dc === 'battery' || dc === 'battery_charging') return 'battery';
      if (dc === 'lock') return 'lock';
      if (['plug', 'power', 'running'].includes(dc)) return 'plug';
      if (dc === 'light') return 'sun';
      if (dc === 'heat' || dc === 'cold') return 'thermo';
      if (dc === 'update') return 'update';
      return 'dot';
    case 'sensor': case 'number': case 'input_number':
      if (dc === 'temperature') return 'thermo';
      if (domain !== 'sensor' && !dc) return 'slider';
      if (dc === 'humidity' || dc === 'moisture') return 'drop';
      if (dc === 'battery') return 'battery';
      if (['power', 'energy', 'current', 'voltage'].includes(dc)) return 'bolt';
      return 'gauge';
    default: return 'home';
  }
}

const MODE_KEY: Record<string, string> = {
  off: 'haModeOff', heat: 'haModeHeat', cool: 'haModeCool', heat_cool: 'haModeHeatCool', auto: 'haModeAuto', dry: 'haModeDry', fan_only: 'haModeFan',
};
/** A mode name in the screen's language (unknown ones: as Home Assistant says them, first letter in capitals). */
export function modeName(m: string): string {
  const k = MODE_KEY[m];
  if (k) return ctx.t(k);
  const s = m.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The decimals a step needs (1 → 0, 0.5 → 1, 0.25 → 2), at most 3. */
export const stepDecimals = (step: number): number => Math.min(3, (String(step).split('.')[1] ?? '').length);

/** A number for the screen: `decimals` places, in the screen's locale. */
export function fmtNum(n: number, decimals = 1): string {
  try {
    return new Intl.NumberFormat(ctx.lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  } catch {
    return n.toFixed(decimals);
  }
}

/** The state in words ("Encendido", "Abierta", "21,5 °C"…). `decimals` for numbers (none: as Home Assistant sends them, at most one). */
export function stateText(s: HaState | null, decimals?: number): string {
  if (!s) return '';
  switch (s.d) {
    case 'unavailable': return ctx.t('haUnavailable');
    case 'light': return s.on ? (s.bri !== null ? `${s.bri} %` : ctx.t('haOn')) : ctx.t('haOff');
    case 'switch': return s.on ? (s.pct !== undefined && s.pct !== null ? `${s.pct} %` : ctx.t('haOn')) : ctx.t('haOff');
    case 'binary': return binaryText(s.on, s.dc ?? '');
    case 'sensor': {
      // a number entity: as many decimals as its step has; a battery in whole percents (#26); a card with no decimals
      // of its own: as many as Home Assistant sends, at most one (137 mi, 21.5 °C)
      const dec = s.step !== undefined ? stepDecimals(s.step) : s.dc === 'battery' ? 0 : decimals ?? Math.min(1, stepDecimals(Number(s.v)));
      return s.num !== null ? `${fmtNum(s.num, dec)}${s.unit ? ` ${s.unit}` : ''}` : s.v;
    }
    case 'cover':
      if (s.state === 'opening') return ctx.t('haOpening');
      if (s.state === 'closing') return ctx.t('haClosing');
      if (s.state === 'open' && s.pos !== null && s.pos < 100) return ctx.t('haOpenPct', { n: s.pos });
      return ctx.t(s.state === 'closed' ? 'haClosed' : 'haOpen');
    case 'climate': {
      const t = s.target !== null ? ` · ${fmtNum(s.target, s.step < 1 ? 1 : 0)}°` : '';
      return `${modeName(s.mode)}${s.mode === 'off' ? '' : t}`;
    }
    case 'media':
      return s.state === 'playing' ? ctx.t('haPlaying') : s.state === 'paused' ? ctx.t('haPaused') : s.state === 'off' ? ctx.t('haOff') : ctx.t('haIdle');
    case 'lock': return ctx.t(s.state === 'locked' ? 'haLocked' : s.state === 'unlocked' ? 'haUnlocked' : 'haUnavailable');
    case 'alarm': return ctx.t(s.state.startsWith('armed') ? 'haArmed' : s.state === 'disarmed' ? 'haDisarmed' : 'haUnavailable');
    case 'scene': return '';
    case 'valve':
      if (s.state === 'opening') return ctx.t('haOpening');
      if (s.state === 'closing') return ctx.t('haClosing');
      if (s.state === 'open' && s.pos !== null && s.pos < 100) return ctx.t('haOpenPct', { n: s.pos });
      return ctx.t(s.state === 'closed' ? 'haClosed' : 'haOpen');
    case 'select': return s.v;
    case 'vacuum': {
      const k = VACUUM_KEY[s.state];
      return k ? ctx.t(k) : s.state.replace(/_/g, ' ');
    }
    case 'update':
      if (s.busy) return ctx.t('haUpdating');
      return s.on ? (s.next ? ctx.t('haUpdateNew', { v: s.next }) : ctx.t('haUpdateAvail')) : ctx.t('haUpToDate');
    case 'other':
      if (s.v === 'home') return ctx.t('haHome');
      if (s.v === 'not_home') return ctx.t('haAway');
      if (s.v === 'on' || s.v === 'off') return ctx.t(s.v === 'on' ? 'haOn' : 'haOff');
      if (OTHER_KEY[s.v]) return ctx.t(OTHER_KEY[s.v]);
      return s.v.replace(/_/g, ' ');
    default: return '';
  }
}

/** What a binary sensor says, by its device class (binaryWords.ts; unknown classes: Encendido / Apagado). */
export function binaryText(on: boolean, dc: string): string {
  return ctx.t(binaryKey(on, dc));
}

/** The common states of the other domains (a sun, a remote, a person's tracker) in the screen's language. */
const OTHER_KEY: Record<string, string> = {
  unknown: 'haUnknown', idle: 'haIdle', standby: 'haStandby', paused: 'haPaused', playing: 'haPlaying', open: 'haOpen', closed: 'haClosed',
  opening: 'haOpening', closing: 'haClosing', above_horizon: 'haSunUp', below_horizon: 'haSunDown',
};

const VACUUM_KEY: Record<string, string> = {
  cleaning: 'haVacCleaning', docked: 'haVacDocked', returning: 'haVacReturning', paused: 'haPaused', idle: 'haIdle', error: 'haVacError',
};

/** "hace 5 min" for a change at `at` (ms), or '' when unknown. */
export function ago(at: number, now = Date.now()): string {
  if (!at) return '';
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return ctx.t('haJustNow');
  if (min < 60) return ctx.t('haAgoMin', { n: min });
  const h = Math.floor(min / 60);
  if (h < 48) return ctx.t('haAgoH', { n: h });
  return ctx.t('haAgoD', { n: Math.floor(h / 24) });
}

/**
 * The state colour of a card (automatic, like Home Assistant's own): 'on' (lit, running, playing), 'alert' (a door
 * or window open, something detected, unlocked), 'heat' / 'cool' (the climate working), 'off', or 'na'.
 */
export function tone(s: HaState | null): 'on' | 'alert' | 'open' | 'heat' | 'cool' | 'off' | 'na' {
  if (!s || s.d === 'unavailable') return 'na';
  switch (s.d) {
    case 'light': case 'switch': return s.on ? 'on' : 'off';
    // a binary sensor: something wrong in red (water, smoke, a problem), something open in blue, the rest (motion,
    // someone there) in the warm on colour; a connection or a plug that is fine is calm
    case 'binary': {
      const dc = s.dc ?? '';
      if (dc === 'connectivity') return s.on ? 'off' : 'alert';
      if (!s.on) return 'off';
      if (['moisture', 'smoke', 'gas', 'carbon_monoxide', 'problem', 'safety', 'tamper', 'battery', 'heat', 'cold'].includes(dc)) return 'alert';
      if (['door', 'garage_door', 'opening', 'window', 'lock'].includes(dc)) return 'open';
      return 'on';
    }
    case 'media': return s.state === 'playing' ? 'on' : 'off';
    case 'cover': return s.state === 'closed' ? 'off' : 'on';
    case 'climate': return s.action === 'heating' || (s.mode === 'heat' && s.action !== 'idle') ? 'heat' : s.action === 'cooling' || s.mode === 'cool' ? 'cool' : s.mode === 'off' ? 'off' : 'on';
    case 'lock': return s.state === 'unlocked' ? 'alert' : 'off';
    case 'alarm': return s.state.startsWith('armed') ? 'on' : 'off';
    // a valve that lets water through, a vacuum at work, an update waiting (or one that went wrong)
    case 'valve': return s.state === 'closed' ? 'off' : 'on';
    case 'vacuum': return s.state === 'error' ? 'alert' : s.state === 'cleaning' || s.state === 'returning' ? 'on' : 'off';
    case 'update': return s.on ? 'alert' : 'off';
    default: return 'off';
  }
}

const PICKED = { green: 'good', yellow: 'warn', red: 'alert' } as const;

/**
 * The state colour with the owner's choice on top (Colores según el estado, colorOn / colorOff): when the entity is
 * active (open, on, detected) or not, green, yellow or red instead of the automatic colour.
 */
export function stateTone(s: HaState | null, p: { colorOn?: unknown; colorOff?: unknown }): ReturnType<typeof tone> | 'good' | 'warn' {
  const t = tone(s);
  if (t === 'na') return t;
  const c = t === 'off' ? p.colorOff : p.colorOn;
  return typeof c === 'string' && c in PICKED ? PICKED[c as keyof typeof PICKED] : t;
}

/** The states that are either active or not, where the owner's own words fit (a number or a climate keeps its own). */
const WORD_DOMAINS = ['binary', 'switch', 'light', 'lock', 'cover', 'valve', 'alarm'];

/**
 * The owner's own word for the state (Texto si está activo / Texto si no, textOn / textOff), or '' for the automatic
 * one: active and not as the colours read them (stateTone), never for an entity that is unavailable.
 */
export function ownStateText(s: HaState | null, p: { textOn?: unknown; textOff?: unknown }): string {
  if (!s || !WORD_DOMAINS.includes(s.d)) return '';
  const t = tone(s);
  if (t === 'na') return '';
  const w = t === 'off' ? p.textOff : p.textOn;
  return typeof w === 'string' ? w.trim() : '';
}

/** The domain an alias was bound to ({ a, d } in the item's props), or ''. */
export const domainOf = (ref: unknown): string => (ref && typeof ref === 'object' && typeof (ref as { d?: unknown }).d === 'string' ? (ref as { d: string }).d : '');
/** The alias of a binding, or ''. */
export const aliasOf = (ref: unknown): string => (ref && typeof ref === 'object' && typeof (ref as { a?: unknown }).a === 'string' ? (ref as { a: string }).a : '');

// ---- controls (touch screens): buttons, slider tracks, chips and the climate ring. The touch layer
// (widgets/canvas/touch.ts) reads their data attributes: data-a (alias), data-ctl (control), data-v (a value as
// JSON), data-d (a step for −/+), data-slide (a slider's control, with data-min, data-max, data-step). Without
// `live` they are drawn as they are, with no data attributes: nothing to tap.

export const CTL_ICON = {
  up: g('<path d="M6 15l6-6 6 6"/>'),
  down: g('<path d="M6 9l6 6 6-6"/>'),
  stop: g('<rect x="7" y="7" width="10" height="10" rx="1.5"/>'),
  minus: g('<path d="M6 12h12"/>'),
  plus: g('<path d="M12 6v12M6 12h12"/>'),
  play: g('<path d="M8 5v14l11-7z"/>'),
  pause: g('<path d="M9 5v14M15 5v14"/>'),
  next: g('<path d="M6 5v14l9-7z"/><path d="M18 5v14"/>'),
  prev: g('<path d="M18 5v14l-9-7z"/><path d="M6 5v14"/>'),
  power: g('<path d="M12 3v8"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>'),
  dock: g('<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'),
};
export type CtlIconName = keyof typeof CTL_ICON;

/** A control button. `label`: what it does (aria-label), `text`: what it shows (else `icon`). */
export function ctlButton(o: { cls: string; alias: string; control: string; live: boolean; value?: unknown; d?: number; icon?: CtlIconName; text?: string; label: string; on?: boolean; armed?: boolean }): HTMLElement {
  const e = document.createElement(o.live ? 'button' : 'span');
  e.className = `cv-ctl ${o.cls}${o.on ? ' is-on' : ''}${o.armed ? ' is-armed' : ''}${o.live ? '' : ' is-ro'}`;
  if (o.live) {
    (e as HTMLButtonElement).type = 'button';
    e.dataset.a = o.alias;
    e.dataset.ctl = o.control;
    if (o.value !== undefined) e.dataset.v = JSON.stringify(o.value);
    if (o.d !== undefined) e.dataset.d = String(o.d);
  }
  e.setAttribute('aria-label', o.label);
  if (o.on !== undefined) e.setAttribute('aria-pressed', String(!!o.on));
  if (o.icon) {
    // a static SVG string of CTL_ICON
    const svg = CTL_ICON[o.icon];
    e.innerHTML = svg;
  }
  else if (o.text !== undefined) e.textContent = o.text;
  return e;
}

/** A slider track (not an input: big, custom, the same on every browser). `value` within min..max. */
export function ctlSlider(o: { cls: string; alias: string; control: string; live: boolean; value: number; min: number; max: number; step: number; label: string; text?: string }): HTMLElement {
  const e = document.createElement('div');
  const pct = o.max > o.min ? Math.max(0, Math.min(100, ((o.value - o.min) / (o.max - o.min)) * 100)) : 0;
  e.className = `cv-slider ${o.cls}${o.live ? '' : ' is-ro'}`;
  const fill = document.createElement('i');
  fill.style.width = `${pct}%`;
  if (o.text) {
    // the number twice: in the card's colour on the track, and dark on the fill (the fill clips its copy), so a label
    // longer than the fill ("Volumen 35 %") reads on both
    const t = document.createElement('span');
    t.className = 'cv-slider-t';
    t.textContent = o.text;
    e.appendChild(t);
    const on = document.createElement('span');
    on.className = 'cv-slider-t is-on';
    on.textContent = o.text;
    on.setAttribute('aria-hidden', 'true');
    fill.appendChild(on);
  }
  e.appendChild(fill);
  e.setAttribute('role', 'slider');
  e.setAttribute('aria-label', o.label);
  e.setAttribute('aria-valuemin', String(o.min));
  e.setAttribute('aria-valuemax', String(o.max));
  e.setAttribute('aria-valuenow', String(o.value));
  if (o.live) {
    e.dataset.a = o.alias;
    e.dataset.slide = o.control;
    e.dataset.min = String(o.min);
    e.dataset.max = String(o.max);
    e.dataset.step = String(o.step);
  }
  return e;
}

/** A row of choices (modes): the current one lit. */
export function ctlChips(o: { cls: string; alias: string; control: string; live: boolean; options: { v: string; label: string }[]; current: string | null | undefined; armed?: string }): HTMLElement {
  const row = document.createElement('div');
  row.className = `cv-chips ${o.cls}`;
  for (const opt of o.options) {
    row.appendChild(ctlButton({ cls: `cv-chip mode-${opt.v}`, alias: o.alias, control: o.control, live: o.live, value: opt.v, text: opt.label, label: opt.label, on: opt.v === o.current, armed: o.armed === `${o.alias}|${o.control}|${opt.v}` }));
  }
  return row;
}

/**
 * The climate ring: a 270° track, the arc from the bottom of the range up to the target (or between the two
 * setpoints), and a dot for the current temperature.
 */
export function ring(o: { min: number; max: number; target: number | null; lo?: number | null; hi?: number | null; cur: number | null }): SVGSVGElement {
  const R = 44;
  const C = 50;
  const START = 135;
  const SWEEP = 270;
  const ang = (v: number) => START + (Math.max(0, Math.min(1, (v - o.min) / (o.max - o.min || 1))) * SWEEP);
  const pt = (a: number) => [C + R * Math.cos((a * Math.PI) / 180), C + R * Math.sin((a * Math.PI) / 180)];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    return `M${x0.toFixed(2)},${y0.toFixed(2)}A${R},${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'cv-ring', 'aria-hidden': 'true' });
  svg.appendChild(svgEl('path', { d: arc(START, START + SWEEP), class: 'cv-ring-track' }));
  if (o.lo !== null && o.lo !== undefined && o.hi !== null && o.hi !== undefined) {
    svg.appendChild(svgEl('path', { d: arc(ang(o.lo), Math.max(ang(o.lo) + 1, ang(o.hi))), class: 'cv-ring-arc' }));
  } else if (o.target !== null) {
    svg.appendChild(svgEl('path', { d: arc(START, Math.max(START + 1, ang(o.target))), class: 'cv-ring-arc' }));
  }
  if (o.cur !== null) {
    const [x, y] = pt(ang(o.cur));
    svg.appendChild(svgEl('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: 3.2, class: 'cv-ring-cur' }));
  }
  return svg;
}

/** A fan mode in the screen's language (auto, low, medium, high; others as Home Assistant says them). */
export function fanName(m: string): string {
  const k: Record<string, string> = { auto: 'haFanAuto', low: 'haFanLow', medium: 'haFanMedium', middle: 'haFanMedium', high: 'haFanHigh', on: 'haOn', off: 'haOff' };
  return k[m] ? ctx.t(k[m]) : modeName(m);
}
