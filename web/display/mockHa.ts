// Demo Home Assistant states (?demo=1&preset=canvas&shot=home): made-up states for the aliases of the demo screen,
// chosen by each item's kind and domain, so the Casa cards can be shown and screenshotted without a server.
import { canvasCards, conditionHidden } from '../../server/core/canvasCore.js';
import type { DisplayConfig, HaControl, HaHistory, HaSlim, HaState, HaStatistic } from '../shared/types';
import { controlsFor, tileFeatures } from '../../server/core/haCore.js';
import { attrsFromSlim } from '../shared/haGuess';
import { DEMO_SAVED } from './mockCanvas';
import { mockDoorbellFrame } from './mockDoorbell';
import { SHOW_ACTIVE, showArt, showCamera, showcaseOf } from './showcase';
import { now as clockNow } from './time';

/** ?cam=fail: the demo cameras send nothing ("Sin señal"); ?cam=off: their motion sensor is off (cards hidden). */
const demoCam = typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('cam') ?? '';

/** A showcase screen (&shot=show.*, or the showcase carousel; web/display/showcase/): the player gets a drawn cover and English names. */
const showcase = SHOW_ACTIVE;

/**
 * The demo player's cover art on a showcase screen: the screen's own (a stock photo made into a sleeve, show.home's
 * pier at sunset for the others too), or, when that cannot be fetched, an abstract drawn sleeve; null elsewhere.
 */
export function demoArt(): Promise<string | null> {
  if (!showcase || typeof document === 'undefined') return Promise.resolve(null);
  const own = showcaseOf(null)?.art ?? showArt;
  return own().then((u) => u ?? drawnArt());
}

function drawnArt(): Promise<string | null> {
  const c = document.createElement('canvas');
  c.width = c.height = 400;
  const g = c.getContext('2d');
  if (!g) return Promise.resolve(null);
  const bg = g.createLinearGradient(0, 0, 400, 400);
  bg.addColorStop(0, '#1d3557');
  bg.addColorStop(1, '#0b132b');
  g.fillStyle = bg;
  g.fillRect(0, 0, 400, 400);
  for (const [x, y, r, col] of [[250, 150, 120, '#e76f51'], [140, 260, 90, '#f4a261'], [300, 300, 50, '#2a9d8f']] as [number, number, number, string][]) {
    g.globalAlpha = 0.85;
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = '600 26px system-ui, sans-serif';
  g.fillText('HARBOUR LIGHTS', 28, 370);
  return Promise.resolve(c.toDataURL('image/png'));
}

/** Picture number `n` of a demo camera (the doorbell's drawn street). */
export function demoCameraFrame(n: number): Promise<Blob | null> {
  if (demoCam === 'fail') return Promise.reject(new Error('demo camera off'));
  // a showcase camera: its own picture (show.home's driveway)
  const own = showCamera();
  return own ? own(n) : mockDoorbellFrame(n);
}

/** The controls a demo card offers when its screen allows touch (what the server would work out). */
function demoControls(kind: string, s: HaSlim): HaControl[] {
  const tog: HaControl[] = ['toggle', 'on', 'off'];
  switch (s.d) {
    case 'light': return kind === 'ha.light' ? [...tog, 'brightness', 'colorTemp'] : ['ha.tile', 'ha.room'].includes(kind) ? tog : [];
    case 'switch': return ['ha.tile', 'ha.room', 'ha.switch'].includes(kind) ? (kind === 'ha.switch' ? [...tog, 'fanPct'] : tog) : [];
    case 'climate': return kind === 'ha.climate' ? ['setpoint', 'hvacMode', 'fanMode'] : [];
    case 'cover': return ['ha.cover', 'ha.tile', 'ha.room'].includes(kind) ? (kind === 'ha.cover' ? ['open', 'close', 'stop', 'position'] : ['open', 'close', 'stop']) : [];
    case 'media': return kind === 'ha.media' ? ['playPause', 'next', 'prev', 'volume'] : [];
    case 'scene': return ['ha.tile', 'ha.room', 'ha.scene'].includes(kind) ? ['run'] : [];
    default: return [];
  }
}

type Ref = { a: string; d: string } | null | undefined;

// one made-up entity per domain and per use, in order (the demo knows only aliases and domains, not entity ids):
// names and values that belong together, so a demo screen never shows a power sensor in °C
const DEMO: Record<string, HaSlim[]> = {
  light: [
    { d: 'light', on: true, bri: 70, ct: 2900, ctMin: 2200, ctMax: 6500, rgb: null, n: 'Salón' },
    { d: 'light', on: false, bri: null, ct: null, rgb: null, n: 'Cocina' },
    { d: 'light', on: true, bri: 40, ct: 2700, rgb: null, n: 'Pasillo' },
    { d: 'light', on: false, bri: null, ct: null, rgb: null, n: 'Mesa' },
    { d: 'light', on: true, bri: 85, ct: null, rgb: [175, 82, 222], col: true, n: 'Tira LED' },
    { d: 'light', on: false, bri: null, ct: null, rgb: null, col: true, ctMin: 2200, ctMax: 6500, n: 'Exterior pasillo' },
  ],
  switch: [
    { d: 'switch', on: true, dc: null, n: 'Cafetera' },
    { d: 'switch', on: false, dc: null, n: 'Ventilador' },
    { d: 'switch', on: false, dc: null, n: 'Enchufe' },
  ],
  sensor: [
    { d: 'sensor', v: '21.4', num: 21.4, unit: '°C', dc: 'temperature', n: 'Temperatura' },
    { d: 'sensor', v: '48', num: 48, unit: '%', dc: 'humidity', n: 'Humedad' },
    { d: 'sensor', v: '21.4', num: 21.4, unit: '°C', dc: 'temperature', n: 'Temperatura' },
    { d: 'sensor', v: '1.27', num: 1.27, unit: 'kW', dc: 'power', n: 'Consumo' },
    { d: 'sensor', v: '12.8', num: 12.8, unit: '°C', dc: 'temperature', n: 'Fuera' },
  ],
  binary_sensor: [
    { d: 'binary', on: false, dc: 'door', n: 'Puerta de la calle' },
    { d: 'binary', on: true, dc: 'motion', n: 'Movimiento' },
    { d: 'binary', on: false, dc: 'window', n: 'Ventana' },
    { d: 'binary', on: true, dc: 'door', n: 'Puerta del jardín' },
    { d: 'binary', on: false, dc: 'motion', n: 'Terraza de invitados Movimiento' },
    { d: 'binary', on: true, dc: 'moisture', n: 'Fuga bajo el fregadero' },
    { d: 'binary', on: false, dc: 'smoke', n: 'Humo de la cocina' },
    { d: 'binary', on: true, dc: 'connectivity', n: 'Router' },
    { d: 'binary', on: false, dc: 'occupancy', n: 'Despacho' },
    { d: 'binary', on: false, dc: 'plug', n: 'Cargador del coche' },
    { d: 'binary', on: false, dc: 'lock', n: 'Cerradura de la entrada' },
    { d: 'binary', on: true, dc: 'presence', n: 'Ana' },
    { d: 'binary', on: true, dc: 'plug', n: 'Lavadora' },
  ],
  media_player: [
    { d: 'media', state: 'playing', title: 'Blue in Green', artist: 'Miles Davis', vol: 0.35, art: false, n: 'Altavoz del salón' },
    { d: 'media', state: 'idle', title: null, artist: null, vol: 0.3, art: false, n: 'Altavoz del despacho' },
    { d: 'media', state: 'paused', title: 'The Girl from Ipanema (with Astrud Gilberto), live at Carnegie Hall', artist: 'Stan Getz and João Gilberto', vol: 0.5, art: false, n: 'Cocina' },
  ],
  climate: [
    { d: 'climate', mode: 'heat', modes: ['off', 'heat', 'cool', 'auto'], action: 'heating', cur: 20.5, target: 21.5, lo: null, hi: null, min: 7, max: 30, step: 0.5, unit: 'C', hum: 47, fan: 'auto', fans: ['auto', 'low', 'high'], n: 'Salón' },
    { d: 'climate', mode: 'cool', modes: ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'], action: 'idle', cur: 24.5, target: 24, lo: null, hi: null, min: 16, max: 30, step: 1, unit: 'C', hum: 52, fan: 'auto', fans: ['silent', 'low', 'medium', 'high', 'auto', 'max'], n: 'Dormitorio' },
  ],
  cover: [{ d: 'cover', state: 'open', pos: 60, readOnly: false, n: 'Persiana' }, { d: 'cover', state: 'closed', pos: 0, readOnly: false, n: 'Dormitorio' }],
  scene: [{ d: 'scene', n: 'Cine' }, { d: 'scene', n: 'Buenas noches' }, { d: 'scene', n: 'Cena' }, { d: 'scene', n: 'Todo apagado' }],
  lock: [{ d: 'lock', state: 'locked', n: 'Puerta' }],
  camera: [{ d: 'other', v: 'idle', n: 'Entrada' }, { d: 'other', v: 'streaming', n: 'Jardín' }, { d: 'other', v: 'idle', n: 'Garaje' }],
  valve: [{ d: 'valve', state: 'open', pos: null, dc: null, readOnly: false, n: 'Riego del jardín' }, { d: 'valve', state: 'closed', pos: 0, dc: null, readOnly: false, n: 'Radiador' }],
  vacuum: [{ d: 'vacuum', state: 'docked', bat: 92, n: 'Robot aspirador' }],
  select: [{ d: 'select', v: 'Eco', opts: ['Eco', 'Normal', 'Rápido'], n: 'Modo del lavavajillas' }],
  number: [
    { d: 'sensor', v: '45', num: 45, unit: 'min', dc: null, min: 0, max: 120, step: 5, n: 'Temporizador' },
    { d: 'sensor', v: '22', num: 22, unit: '°C', dc: null, min: 16, max: 30, step: 0.5, box: true, n: 'Agua caliente' },
  ],
  update: [{ d: 'update', on: true, cur: '2026.9.3', next: '2026.10.1', n: 'Home Assistant' }, { d: 'update', on: false, cur: '1.4.2', next: '1.4.2', n: 'Router' }],
};
/**
 * Demo entities with a state that can change (the demo 'motion', mockCanvas.ts): the raw state by entity id, from
 * &motion= at first, then from the 'marco:demo-ha' event ({ entity, state }; haFeed.ts asks for the states again).
 */
export const DEMO_RAW: Record<string, string> = {
  'binary_sensor.hall_motion': typeof location === 'undefined' ? 'off' : new URLSearchParams(location.search).get('motion') ?? 'off',
};

/** Demo entities with a state of their own by entity id (the 'vehicles' demo, #26: a battery, a tank, a range, a plug). */
const DEMO_FIXED: Record<string, HaSlim> = {
  'sensor.tesla_battery': { d: 'sensor', v: '54', num: 54, unit: '%', dc: 'battery', n: 'Tesla' },
  'sensor.toyota_fuel': { d: 'sensor', v: '74', num: 74, unit: '%', dc: null, n: 'Toyota' },
  'sensor.tesla_range': { d: 'sensor', v: '137', num: 137, unit: 'mi', dc: 'distance', n: 'Range' },
  'sensor.garage_temp': { d: 'sensor', v: '74.0', num: 74, unit: '°F', dc: 'temperature', n: 'Garage' },
  'sensor.garage_humidity': { d: 'sensor', v: '46.3', num: 46.3, unit: '%', dc: 'humidity', n: 'Garage humidity' },
  'sensor.toyota_range': { d: 'sensor', v: '292', num: 292, unit: 'mi', dc: 'distance', n: 'Range' },
  'binary_sensor.tesla_plug': { d: 'binary', on: false, dc: 'plug', n: 'Charger' },
  'sensor.phone_battery': { d: 'sensor', v: '12', num: 12, unit: '%', dc: 'battery', n: 'Phone' },
};

/** The demo screen's items a server would hide now by their conditions (canvasCore conditionHidden). */
export function demoHaHidden(): Set<string> {
  const canvas = DEMO_SAVED.canvas;
  if (!canvas) return new Set();
  return conditionHidden({ layout: { preset: 'canvas' }, canvas }, { ha: (e: string) => DEMO_RAW[e] ?? null });
}

/** The sensor a demo camera waits for (showWhen): on, so the card is seen. */
const DEMO_GATE: HaSlim = { d: 'binary', on: demoCam !== 'off', dc: 'motion', n: 'Movimiento' };
DEMO.input_boolean = DEMO.switch;
DEMO.fan = DEMO.switch;
DEMO.input_number = DEMO.number;
DEMO.input_select = DEMO.select;
DEMO.script = DEMO.scene;
DEMO.button = DEMO.scene;

/** States for every alias of the demo screen. Chart series take no state (their points come from demoHaHistory). */
export function demoHaStates(cfg: DisplayConfig | null): Record<string, HaState> {
  const out: Record<string, HaState> = {};
  const now = Date.now();
  const used: Record<string, number> = {};
  // a showcase screen's own states by alias (web/display/showcase/)
  const own = showcaseOf(cfg)?.ha;
  for (const it of canvasCards(cfg?.canvas?.items)) {
    const p = it.props as Record<string, any>;
    const refs: Ref[] = [p.entity, p.entity2, ...(p.rows ?? []).map((r: any) => r.entity), ...(p.buttons ?? []).map((b: any) => b.entity), ...(p.bind ?? []).map((b: any) => b.entity)];
    const gate = p.showWhen as Ref;
    if (gate?.a) out[gate.a] = { ...DEMO_GATE, at: now - 60_000, c: [] };
    refs.forEach((r, i) => {
      if (!r?.a) return;
      const list = DEMO[r.d];
      // scenes, scripts and buttons share one list: each button of a card gets its own name
      const key = list === DEMO.scene ? 'scene' : r.d;
      const n = used[key] ?? 0;
      used[key] = n + 1;
      const mine = own?.(r.a) ?? null;
      // a demo entity with a state of its own (DEMO_RAW): a motion sensor on or off, or unavailable
      const raw = DEMO_RAW[DEMO_SAVED.entities.get(r.a) ?? ''];
      const moving: HaSlim | null = raw === undefined ? null : raw === 'on' || raw === 'off' ? { d: 'binary', on: raw === 'on', dc: 'motion', n: 'Movimiento' } : { d: 'other', v: raw, n: 'Movimiento' };
      const fixed = DEMO_FIXED[DEMO_SAVED.entities.get(r.a) ?? ''] ?? null;
      const base: HaSlim = mine ?? moving ?? fixed ?? (list ? list[n % list.length] : { d: 'other', v: 'home', n: 'Casa' });
      // a showcase player: a made-up track with its cover (unless the screen plays its own), two minutes in
      let slim: HaSlim = showcase && base.d === 'media' && base.state === 'playing' && !mine ? { ...base, title: 'Harbour Lights', artist: 'The Low Tides', art: true } : base;
      if (showcase && slim.d === 'media' && slim.state === 'playing' && slim.dur === undefined) slim = { ...slim, pos: 132, dur: 247 };
      if (slim.d === 'media' && typeof slim.pos === 'number' && slim.posAt === undefined) slim = { ...slim, posAt: clockNow().getTime() };
      if (showcase && r.d === 'camera') slim = { ...slim, n: 'Driveway' };
      // an Entidad card: its controls and its rows as the server would work them out
      const tile = it.kind === 'ha.tile' && i === 0;
      // an Entidad or Luz card: the controls the server would work out from the light's colour modes
      const exact = tile || it.kind === 'ha.light';
      const attrs = exact ? attrsFromSlim(slim) : {};
      const c = it.interactive ? (exact ? controlsFor(it.kind, r.d, attrs, p) : demoControls(it.kind, slim)) : [];
      const st: HaState = c.length && it.confirm ? { ...slim, at: now - (7 + i * 13) * 60_000, c, cf: true } : { ...slim, at: now - (7 + i * 13) * 60_000, c };
      if (tile) {
        const f = tileFeatures(r.d, attrs, p);
        if (f.length) st.f = f;
      }
      out[r.a] = st;
    });
    for (const s of p.series ?? []) if (s?.entity?.a) out[s.entity.a] = { ...DEMO.sensor[0], at: now - 7 * 60_000, c: [] };
  }
  return out;
}

/** The made-up value of a demo Estadística card: energy used today, this week or this month, or a mean temperature. */
export function demoHaStatistic(cfg: DisplayConfig | null, itemId: string): HaStatistic | null {
  const it = canvasCards(cfg?.canvas?.items).find((x) => x.id === itemId);
  if (!it) return null;
  const mine = showcaseOf(cfg)?.statistic?.(itemId);
  if (mine) return mine;
  const p = it.props as Record<string, any>;
  const stat = (['change', 'mean', 'min', 'max'].includes(p.stat) ? p.stat : 'change') as HaStatistic['stat'];
  const period = (['today', 'week', 'month'].includes(p.period) ? p.period : 'today') as HaStatistic['period'];
  if (stat === 'change') return { stat, period, value: { today: 7.42, week: 48.9, month: 203.6 }[period], unit: 'kWh' };
  return { stat, period, value: { mean: 20.8, min: 17.9, max: 23.4 }[stat], unit: '°C' };
}

/** A day of smooth made-up points per series of a demo chart (or a sensor's curve). */
export function demoHaHistory(cfg: DisplayConfig | null, itemId: string): HaHistory | null {
  const it = canvasCards(cfg?.canvas?.items).find((x) => x.id === itemId);
  if (!it) return null;
  const mine = showcaseOf(cfg)?.history?.(itemId);
  if (mine) return mine;
  const p = it.props as Record<string, any>;
  const period = (['1h', '6h', '24h', '7d'].includes(p.period) ? p.period : '24h') as HaHistory['period'];
  const span = { '1h': 3600_000, '6h': 6 * 3600_000, '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000 }[period];
  const list = it.kind === 'ha.chart' ? (p.series ?? []) : [{ label: '' }];
  // the screen's clock (a frozen &now= moves the axis with it)
  const now = clockNow().getTime();
  return {
    period,
    series: list.map((s: any, j: number) => ({
      label: s.label || ['Salón', 'Fuera', 'Dormitorio', 'Cocina'][j % 4],
      unit: power(s) ? 'kW' : '°C',
      points: Array.from({ length: 96 }, (_, i): [number, number] => {
        const t = now - span + (span * i) / 95;
        const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
        if (power(s)) return [t, Math.round(watts(s.label, h, i) * 100) / 100];
        return [t, Math.round((19 - j * 5 + 3 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + 0.4 * Math.sin(i / 3)) * 10) / 10];
      }),
    })),
  };
}

/** A showcase chart series labelled Solar or Usage: kW through the day instead of a temperature. */
const power = (s: { label?: string }): boolean => showcase && /^(solar|usage)$/i.test(s?.label ?? '');
function watts(label: string, h: number, i: number): number {
  if (/solar/i.test(label)) return Math.max(0, 3.6 * Math.sin(((h - 7.5) / 11) * Math.PI) - 0.15 * Math.max(0, Math.sin(i / 5)));
  const bump = (c: number, w: number, a: number) => a * Math.exp(-(((h - c) / w) ** 2));
  return 0.35 + bump(7.5, 1, 1.4) + bump(13, 1, 0.6) + bump(19.5, 1.5, 2.1) + 0.08 * Math.sin(i * 1.7);
}
