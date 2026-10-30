// Home Assistant on Personalizado screens, the pure part (no node:* imports: the Cloud build copies server/core).
// - slim(): the few fields a display gets for one entity (HaSlim, web/shared/types.ts). Entity ids, HA URLs and
//   pictures never leave the server: the display knows an entity only by its alias `${itemId}:${n}`.
// - aliasesFor() / watchedEntities(): which entities a screen shows, and which ones the server mirrors (haLive.js).
// - CONTROL_TABLE / controlsFor() / isHighRisk() / needsConfirm() / clampValue() / serviceCall(): what a card may
//   offer on a touch screen, and the one Home Assistant service each control becomes (routes/ha.js checks it all
//   again on every action).
// - tileFeatures(): the rows under an Entidad card (the owner's, or the ones that suit the entity's domain).
// - parseHistory() / parseStatistics() / downsample(): chart points, at most 200 per series (LTTB).
import { HA_ENTITY_RE, TILE_FEATURES, canvasCards, conditionEntities, itemAliases, itemNames, needsConfirm } from './canvasCore.js';

export const ENTITY_RE = HA_ENTITY_RE;
export { needsConfirm };

/** Attributes the server keeps for a mirrored entity: what slim() and the builder read, and what weather.js reads. */
export const ATTR_WHITELIST = Object.freeze([
  'friendly_name', 'unit_of_measurement', 'device_class', 'supported_features', 'icon', 'state_class',
  // lights
  'brightness', 'color_mode', 'supported_color_modes', 'color_temp_kelvin', 'color_temp', 'min_color_temp_kelvin', 'max_color_temp_kelvin', 'rgb_color',
  // fans
  'percentage', 'percentage_step', 'preset_mode',
  // climate
  'hvac_modes', 'hvac_action', 'current_temperature', 'temperature', 'target_temp_low', 'target_temp_high', 'min_temp', 'max_temp',
  'target_temp_step', 'fan_mode', 'fan_modes', 'current_humidity',
  // covers
  'current_position',
  // media players
  'media_title', 'media_artist', 'media_album_artist', 'volume_level', 'is_volume_muted', 'source', 'entity_picture',
  // select / input_select, number / input_number
  'options', 'min', 'max', 'step', 'mode',
  // vacuums
  'battery_level', 'status',
  // updates
  'installed_version', 'latest_version', 'in_progress', 'update_percentage',
  // weather entities (weather.js)
  'apparent_temperature', 'humidity', 'wind_speed', 'wind_speed_unit', 'wind_bearing', 'pressure', 'uv_index', 'temperature_unit',
]);

/** Just the whitelisted attributes of `attrs`. */
export function pickAttrs(attrs) {
  const out = {};
  if (!attrs || typeof attrs !== 'object') return out;
  for (const k of ATTR_WHITELIST) if (attrs[k] !== undefined) out[k] = attrs[k];
  return out;
}

const finite = (v) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v, max = 80) => (typeof v === 'string' && v ? v.slice(0, max) : null);
const strList = (v, max = 16) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, max).map((x) => x.slice(0, 40)) : []);
const round = (n, d = 1) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

const SWITCHES = ['switch', 'input_boolean', 'fan'];
/** The colour modes of a light that take any colour (rgb_color), as Home Assistant names them. */
const COLOR_MODES = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];
const RUNNABLE = ['scene', 'script', 'button'];
const NUMERIC = ['sensor', 'number', 'input_number'];
const SETTABLE = ['number', 'input_number'];
const SELECTS = ['select', 'input_select'];
/** Valves that are only shown (gas): never opened or closed from a screen. */
const VALVE_NEVER = ['gas'];
/** "gas" as a word ("gás" in Portuguese, "gaz" in Polish): a valve without a device class named like this is a gas valve too. */
const GAS_RE = /(?<![a-z\u00c0-\u024f])(?:g[aá]s|gaz(?:u|owy|owa|owe)?)(?![a-z\u00c0-\u024f])/i;
/**
 * A gas valve: its device class, or (many integrations set none) "gas" in its entity id, its friendly name or the
 * name the owner gave it on the card. Never opened or closed from a screen.
 */
export function isGasValve(domain, attrs = {}, entityId = '', name = '') {
  if (domain !== 'valve') return false;
  if (VALVE_NEVER.includes(attrs?.device_class)) return true;
  const fname = typeof attrs?.friendly_name === 'string' ? attrs.friendly_name : '';
  return [String(entityId || '').replace(/[_.]/g, ' '), fname, String(name || '')].some((x) => x && GAS_RE.test(x));
}

/**
 * The slim state of one entity (HaSlim). `domain` is the entity's domain (light, sensor…), `state` its state string,
 * `attrs` its attributes. `n` is its friendly name (the card's own name wins on the display).
 */
export function slim(domain, state, attrs = {}) {
  const a = attrs && typeof attrs === 'object' ? attrs : {};
  const s = typeof state === 'string' ? state : String(state ?? '');
  const n = str(a.friendly_name, 60);
  const named = (x) => (n ? { ...x, n } : x);
  // a scene or a button that never ran says 'unknown': it still runs
  if (s === 'unavailable' || (s === 'unknown' && !RUNNABLE.includes(domain))) {
    return named({ d: 'unavailable' });
  }
  if (domain === 'light') {
    const on = s === 'on';
    const modes = strList(a.supported_color_modes);
    const bri = finite(a.brightness);
    let ct = finite(a.color_temp_kelvin);
    if (ct === null && finite(a.color_temp)) ct = Math.round(1e6 / finite(a.color_temp));
    const out = { d: 'light', on, bri: on && bri !== null ? Math.max(1, Math.round((bri / 255) * 100)) : null, ct: on ? ct : null, rgb: null };
    // a light that only goes on and off: no brightness row; one that takes any colour: the colour swatches
    if (modes.length && modes.every((m) => m === 'onoff')) out.onoff = true;
    if (modes.some((m) => COLOR_MODES.includes(m))) out.col = true;
    if (modes.includes('color_temp')) {
      const lo = finite(a.min_color_temp_kelvin);
      const hi = finite(a.max_color_temp_kelvin);
      if (lo !== null) out.ctMin = lo;
      if (hi !== null) out.ctMax = hi;
    }
    if (on && Array.isArray(a.rgb_color) && a.rgb_color.length === 3 && a.rgb_color.every((x) => finite(x) !== null)) {
      out.rgb = a.rgb_color.map((x) => Math.max(0, Math.min(255, Math.round(x))));
    }
    return named(out);
  }
  if (SWITCHES.includes(domain)) {
    const out = { d: 'switch', on: s === 'on', dc: str(a.device_class, 30) };
    if (domain === 'fan' && finite(a.percentage) !== null) out.pct = Math.round(finite(a.percentage));
    return named(out);
  }
  if (domain === 'climate') {
    const unit = /F/i.test(String(a.temperature_unit ?? '')) || (finite(a.max_temp) ?? 0) > 60 ? 'F' : 'C';
    const out = {
      d: 'climate', mode: s.slice(0, 30), modes: strList(a.hvac_modes), action: str(a.hvac_action, 30),
      cur: round(finite(a.current_temperature)), target: round(finite(a.temperature)),
      lo: round(finite(a.target_temp_low)), hi: round(finite(a.target_temp_high)),
      min: finite(a.min_temp) ?? (unit === 'F' ? 45 : 7), max: finite(a.max_temp) ?? (unit === 'F' ? 95 : 35),
      step: finite(a.target_temp_step) ?? (unit === 'F' ? 1 : 0.5), unit,
    };
    if (str(a.fan_mode)) out.fan = str(a.fan_mode, 30);
    if (Array.isArray(a.fan_modes)) out.fans = strList(a.fan_modes);
    if (finite(a.current_humidity) !== null) out.hum = Math.round(finite(a.current_humidity));
    return named(out);
  }
  if (domain === 'cover') {
    const dc = str(a.device_class, 30);
    const pos = finite(a.current_position);
    const out = { d: 'cover', state: s.slice(0, 30), pos: pos === null ? null : Math.round(pos), readOnly: dc === 'garage' || dc === 'gate', dc };
    // a cover without one of up, down, stop or a settable position says which it takes (the editor's preview)
    const sf = finite(a.supported_features);
    if (sf && (sf & 15) !== 15) out.sf = sf & 15;
    return named(out);
  }
  if (domain === 'media_player') {
    const vol = finite(a.volume_level);
    const out = {
      d: 'media', state: s.slice(0, 30), title: str(a.media_title, 120), artist: str(a.media_artist, 120) ?? str(a.media_album_artist, 120),
      vol: vol === null ? null : Math.round(vol * 100) / 100,
      // only a picture Home Assistant itself proxies is ever fetched (routes/ha.js art)
      art: typeof a.entity_picture === 'string' && a.entity_picture.startsWith('/api/media_player_proxy/'),
    };
    if (str(a.source)) out.source = str(a.source, 60);
    // where the track is: the position, its length and when Home Assistant read the position (the card moves it on)
    const dur = finite(a.media_duration);
    const mpos = finite(a.media_position);
    if (dur !== null && dur > 0 && mpos !== null) {
      out.pos = Math.max(0, Math.min(Math.round(dur), Math.round(mpos)));
      out.dur = Math.round(dur);
      const at = typeof a.media_position_updated_at === 'string' ? Date.parse(a.media_position_updated_at) : NaN;
      if (Number.isFinite(at)) out.posAt = at;
    }
    return named(out);
  }
  if (NUMERIC.includes(domain)) {
    const out = { d: 'sensor', v: s.slice(0, 60), num: finite(s), unit: str(a.unit_of_measurement, 16) ?? '', dc: str(a.device_class, 30) };
    if (SETTABLE.includes(domain)) {
      const r = numberRange(a);
      Object.assign(out, { min: r.lo, max: r.hi, step: r.step });
      if (a.mode === 'box') out.box = true;
    }
    return named(out);
  }
  if (domain === 'valve') {
    const dc = str(a.device_class, 30);
    const pos = finite(a.current_position);
    return named({ d: 'valve', state: s.slice(0, 30), pos: pos === null ? null : Math.round(pos), dc, readOnly: isGasValve('valve', a) });
  }
  if (SELECTS.includes(domain)) return named({ d: 'select', v: s.slice(0, 60), opts: strList(a.options, 24) });
  if (domain === 'vacuum') {
    const bat = finite(a.battery_level);
    return named({ d: 'vacuum', state: s.slice(0, 30), ...(bat !== null ? { bat: Math.round(bat) } : {}) });
  }
  if (domain === 'update') {
    const out = { d: 'update', on: s === 'on', cur: str(a.installed_version, 30), next: str(a.latest_version, 30) };
    if (a.in_progress === true || typeof a.in_progress === 'number') out.busy = true;
    return named(out);
  }
  if (domain === 'binary_sensor') return named({ d: 'binary', on: s === 'on', dc: str(a.device_class, 30) });
  if (RUNNABLE.includes(domain)) return named({ d: 'scene' });
  if (domain === 'lock') return named({ d: 'lock', state: s.slice(0, 30) });
  if (domain === 'alarm_control_panel') return named({ d: 'alarm', state: s.slice(0, 30) });
  return named({ d: 'other', v: s.slice(0, 60) });
}

/** The time (ms) an HA state object last changed: last_changed (ISO), else last_updated, else 0. */
export function changedAt(st) {
  for (const k of ['last_changed', 'last_updated']) {
    const t = Date.parse(st?.[k] ?? '');
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/** { slim, attrs, at, state } of a REST state object ({ entity_id, state, attributes, last_changed }). */
export function fromRestState(st) {
  const domain = String(st?.entity_id ?? '').split('.')[0];
  const attrs = pickAttrs(st?.attributes);
  return { state: String(st?.state ?? ''), attrs, slim: slim(domain, st?.state, attrs), at: changedAt(st) };
}

// ---- which entities -----------------------------------------------------------------------------------------------

/**
 * The aliases of a screen's Personalizado items (none unless its layout is 'canvas'; hidden items are not sent, so
 * they have none): Map alias → { entity, itemId, kind, slot, interactive }. `interactive` is the item's (and, for a
 * room row, the row's) own switch, before the screen's touch switch. The cards of a Rotativa have aliases of their own
 * (their own ids) and are never controls.
 */
export function aliasesFor(screen) {
  const out = new Map();
  if (screen?.layout?.preset !== 'canvas' || !Array.isArray(screen.canvas?.items)) return out;
  for (const it of canvasCards(screen.canvas.items)) {
    if (it.hidden) continue;
    const list = itemAliases(it);
    const names = itemNames(it);
    // a room's rows are bound in order after its (empty) `entity`, so row i is the i-th alias of the rows
    const rows = Array.isArray(it.props?.rows) ? it.props.rows.filter((r) => r?.entity) : [];
    for (const a of list) {
      const row = it.kind === 'ha.room' ? rows[a.slot] : null;
      // an Entidad's or Indicador's second sensor (#28) is only read: the first alias is its entity whenever it has one
      const second = (it.kind === 'ha.tile' || it.kind === 'ha.gauge') && a.slot > 0;
      out.set(a.alias, {
        entity: a.entity, itemId: it.id, kind: it.kind, slot: a.slot,
        interactive: it.interactive !== false && !second && (!row || row.interactive !== false),
        confirm: !!it.confirm, ack: !!it.ack, name: names[a.slot]?.name ?? '', props: it.props ?? {},
      });
    }
  }
  return out;
}

/** Every entity the saved screens show or test, plus the weather entities: the set the server mirrors (haLive.js). */
export function watchedEntities(cfg) {
  const out = new Set();
  for (const s of cfg?.screens ?? []) {
    for (const a of aliasesFor(s).values()) out.add(a.entity);
    // the entities "Mostrar solo si" reads (never sent to a display: the server decides)
    for (const e of conditionEntities(s)) out.add(e);
  }
  const w = cfg?.weather ?? {};
  for (const k of ['haWeatherEntity', 'haIndoorTempEntity', 'haIndoorHumidityEntity']) {
    if (typeof w[k] === 'string' && ENTITY_RE.test(w[k])) out.add(w[k]);
  }
  return out;
}

// ---- controls -----------------------------------------------------------------------------------------------------

/**
 * The fixed allowlist of what a touch screen may ask Home Assistant to do: control → domains and the service per
 * domain. Nothing else is ever called (no unlock, no alarm, no automation, no shell or rest commands, no gas valve).
 */
const byDomain = (map) => (d) => map[d];
export const CONTROL_TABLE = Object.freeze({
  toggle: { domains: ['light', 'switch', 'input_boolean', 'fan'], service: () => 'toggle' },
  on: { domains: ['light', 'switch', 'input_boolean', 'fan'], service: () => 'turn_on' },
  off: { domains: ['light', 'switch', 'input_boolean', 'fan'], service: () => 'turn_off' },
  brightness: { domains: ['light'], service: () => 'turn_on' },
  colorTemp: { domains: ['light'], service: () => 'turn_on' },
  rgb: { domains: ['light'], service: () => 'turn_on' },
  fanPct: { domains: ['fan'], service: () => 'set_percentage' },
  setpoint: { domains: ['climate'], service: () => 'set_temperature' },
  setpointRange: { domains: ['climate'], service: () => 'set_temperature' },
  hvacMode: { domains: ['climate'], service: () => 'set_hvac_mode' },
  fanMode: { domains: ['climate'], service: () => 'set_fan_mode' },
  open: { domains: ['cover', 'valve'], service: byDomain({ cover: 'open_cover', valve: 'open_valve' }) },
  close: { domains: ['cover', 'valve'], service: byDomain({ cover: 'close_cover', valve: 'close_valve' }) },
  stop: { domains: ['cover', 'valve'], service: byDomain({ cover: 'stop_cover', valve: 'stop_valve' }) },
  position: { domains: ['cover', 'valve'], service: byDomain({ cover: 'set_cover_position', valve: 'set_valve_position' }) },
  playPause: { domains: ['media_player'], service: () => 'media_play_pause' },
  next: { domains: ['media_player'], service: () => 'media_next_track' },
  prev: { domains: ['media_player'], service: () => 'media_previous_track' },
  volume: { domains: ['media_player'], service: () => 'volume_set' },
  run: { domains: ['scene', 'script', 'button'], service: (d) => (d === 'button' ? 'press' : 'turn_on') },
  selectOption: { domains: ['select', 'input_select'], service: () => 'select_option' },
  numberSet: { domains: ['number', 'input_number'], service: () => 'set_value' },
  start: { domains: ['vacuum'], service: () => 'start' },
  pause: { domains: ['vacuum'], service: () => 'pause' },
  dock: { domains: ['vacuum'], service: () => 'return_to_base' },
});

/**
 * Entities a screen never controls: locks, alarms, garage doors and gates, gas valves (by device class, or by name
 * when `entityId` or `name` is given or the friendly name says so).
 */
export function isHighRisk(domain, attrs = {}, entityId = '', name = '') {
  if (domain === 'lock' || domain === 'alarm_control_panel') return true;
  if (domain === 'cover' && ['garage', 'gate'].includes(attrs?.device_class)) return true;
  if (isGasValve(domain, attrs, entityId, name)) return true;
  return false;
}

/** Supported-feature bits of Home Assistant (CoverEntityFeature, ValveEntityFeature, VacuumEntityFeature). */
const VACUUM_BITS = { pause: 4, dock: 16, start: 8192 };
/** The controls of `bits` the entity says it supports (all of them when it says nothing). */
const supported = (feats, bits) => Object.keys(bits).filter((k) => !feats || feats & bits[k]);

/** The domains each tile feature is for. */
export const FEATURE_DOMAINS = {
  brightness: ['light'], colorTemp: ['light'], color: ['light'], cover: ['cover'], position: ['cover', 'valve'],
  hvacModes: ['climate'], target: ['climate'], valve: ['valve'], select: SELECTS, number: SETTABLE, vacuum: ['vacuum'],
  update: ['update'], gauge: NUMERIC,
};
/** The features an Entidad card gets when the owner chose none, by domain (the ones that do not apply are skipped). */
const AUTO_FEATURES = {
  light: ['color'], cover: ['cover', 'position'], valve: ['valve', 'position'], climate: ['target', 'hvacModes'],
  select: ['select'], input_select: ['select'], number: ['number'], input_number: ['number'], vacuum: ['vacuum'], update: ['update'],
};

/**
 * The rows under an Entidad card (ha.tile) for an entity of `domain` with `attrs`: the owner's list (props.features)
 * or, when not chosen, the ones that suit its domain (brightness and colour temperature for a light, the buttons and
 * the position for a cover or a valve, −/+ and the modes for a climate, the options of a select…), each only when
 * the entity can do it. A percentage sensor gets a bar gauge.
 */
export function tileFeatures(domain, attrs = {}, props = {}) {
  const a = attrs && typeof attrs === 'object' ? attrs : {};
  const p = props && typeof props === 'object' ? props : {};
  const feats = finite(a.supported_features) ?? 0;
  const modes = strList(a.supported_color_modes);
  const unit = typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : '';
  const fits = (f) => {
    if (!FEATURE_DOMAINS[f]?.includes(domain)) return false;
    if (f === 'brightness') return !modes.length || modes.some((m) => m !== 'onoff');
    if (f === 'colorTemp') return modes.includes('color_temp');
    if (f === 'color') return modes.includes('color_temp') || modes.some((m) => COLOR_MODES.includes(m));
    if (f === 'position') return domain === 'cover' ? !!(feats & 4) || finite(a.current_position) !== null : !!(feats & 4);
    if (f === 'hvacModes') return strList(a.hvac_modes).length > 1;
    if (f === 'select') return strList(a.options, 24).length > 0;
    return true;
  };
  const want = Array.isArray(p.features) ? p.features.filter((f) => TILE_FEATURES.includes(f)) : [...(AUTO_FEATURES[domain] ?? []), ...(domain === 'sensor' && unit === '%' ? ['gauge'] : [])];
  return [...new Set(want)].filter(fits).slice(0, 3);
}

/** The controls of one tile feature for an entity (a subset of CONTROL_TABLE). */
function featureControls(f, domain, a) {
  const feats = finite(a.supported_features) ?? 0;
  switch (f) {
    case 'brightness': return ['brightness'];
    case 'colorTemp': return ['colorTemp'];
    case 'color': {
      const modes = strList(a.supported_color_modes);
      return [...(modes.some((m) => COLOR_MODES.includes(m)) ? ['rgb'] : []), ...(modes.includes('color_temp') || modes.some((m) => COLOR_MODES.includes(m)) ? ['colorTemp'] : [])];
    }
    case 'cover': return supported(feats, { open: 1, close: 2, stop: 8 });
    case 'valve': return supported(feats, { open: 1, close: 2, stop: 8 });
    // a cover or valve that only reports its position shows a bar, never a slider Home Assistant would refuse
    case 'position': return feats & 4 ? ['position'] : [];
    case 'hvacModes': return ['hvacMode'];
    case 'target': return strList(a.hvac_modes).includes('heat_cool') ? ['setpoint', 'setpointRange'] : ['setpoint'];
    case 'select': return ['selectOption'];
    case 'number': return ['numberSet'];
    case 'vacuum': return supported(feats, VACUUM_BITS);
    default: return [];
  }
}

/**
 * Which controls a card of `kind` offers for an entity of `domain` with `attrs` (always a subset of CONTROL_TABLE).
 * `props`: the item's options (a light without its brightness slider, the climate modes the owner chose, the rows
 * of an Entidad card).
 */
export function controlsFor(kind, domain, attrs = {}, props = {}) {
  const a = attrs && typeof attrs === 'object' ? attrs : {};
  const p = props && typeof props === 'object' ? props : {};
  if (isHighRisk(domain, a)) return [];
  if (['ha.sensor', 'ha.chart', 'ha.camera', 'ha.gauge', 'ha.statistic'].includes(kind)) return [];
  const feats = finite(a.supported_features) ?? 0;
  const out = [];
  if (RUNNABLE.includes(domain)) {
    if (['ha.tile', 'ha.room', 'ha.scene'].includes(kind)) out.push('run');
  } else if (['light', ...SWITCHES].includes(domain)) {
    if (['ha.tile', 'ha.room', 'ha.light', 'ha.switch'].includes(kind)) out.push('toggle', 'on', 'off');
    if (domain === 'light' && kind === 'ha.light') {
      const modes = strList(a.supported_color_modes);
      if (p.brightness !== false && modes.some((m) => m !== 'onoff')) out.push('brightness');
      if (p.colorTemp !== false && modes.includes('color_temp')) out.push('colorTemp');
      // the colour swatches (a white swatch on a colour light without colour temperature is sent as a colour)
      if (p.colorTemp !== false && modes.some((m) => COLOR_MODES.includes(m))) out.push('rgb', 'colorTemp');
    }
    if (domain === 'fan' && kind === 'ha.switch' && feats & 1) out.push('fanPct');
  } else if (domain === 'climate' && kind === 'ha.climate') {
    const modes = climateModes(a, p);
    out.push('setpoint');
    if (modes.includes('heat_cool')) out.push('setpointRange');
    if (modes.length) out.push('hvacMode');
    if (p.fan !== false && Array.isArray(a.fan_modes) && a.fan_modes.length) out.push('fanMode');
  } else if (domain === 'cover' && ['ha.cover', 'ha.tile', 'ha.room'].includes(kind)) {
    // only what the cover says it takes (all three when it says nothing)
    out.push(...supported(feats, { open: 1, close: 2, stop: 8 }));
    if (kind === 'ha.cover' && feats & 4) out.push('position');
  } else if (domain === 'valve' && ['ha.tile', 'ha.room'].includes(kind)) {
    // a tap opens a closed valve and closes an open one
    out.push(...supported(feats, { open: 1, close: 2 }));
  } else if (domain === 'media_player' && kind === 'ha.media') {
    out.push('playPause', 'next', 'prev', 'volume');
  }
  if (kind === 'ha.tile') for (const f of tileFeatures(domain, a, p)) out.push(...featureControls(f, domain, a));
  return [...new Set(out)].filter((c) => CONTROL_TABLE[c]?.domains.includes(domain));
}

/** The hvac modes a climate card offers: the entity's, the ones the owner kept (props.modes; all when not set). */
function climateModes(attrs, props) {
  const modes = strList(attrs?.hvac_modes);
  return Array.isArray(props?.modes) ? modes.filter((m) => props.modes.includes(m)) : modes;
}

const snap = (v, step, base = 0) => Math.round((v - base) / step) * step + base;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** A finite number, or null (numbers only: '50' is not a brightness). */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The temperature range and step of a climate entity (Home Assistant's defaults when it does not say). */
function climateRange(a) {
  const f = /F/i.test(String(a.temperature_unit ?? '')) || (finite(a.max_temp) ?? 0) > 60;
  const lo = finite(a.min_temp) ?? (f ? 45 : 7);
  const hi = finite(a.max_temp) ?? (f ? 95 : 35);
  const step = finite(a.target_temp_step) > 0 ? finite(a.target_temp_step) : f ? 1 : 0.5;
  return { lo, hi, step };
}
const setTemp = (v, r) => Math.round(clamp(snap(v, r.step), r.lo, r.hi) * 100) / 100;

/** The range and step of a number or input_number entity (Home Assistant's defaults: 0 to 100 by 1). */
function numberRange(a) {
  let lo = finite(a?.min) ?? 0;
  let hi = finite(a?.max) ?? 100;
  if (hi < lo) [lo, hi] = [hi, lo];
  const st = finite(a?.step);
  return { lo, hi, step: st !== null && st > 0 ? st : 1 };
}

/**
 * The value a control may send, clamped to what the entity accepts, or `undefined` when it is refused
 * (out_of_range): a control without a value takes none; numbers are clamped and snapped (brightness 1..100 whole,
 * colour temperature within the light's kelvin range, setpoints within min_temp..max_temp on target_temp_step,
 * low below high, fan and cover 0..100, volume 0..1); modes must be ones the entity has (and the card offers).
 * Returns { value } (value null for the controls without one).
 */
export function clampValue(control, value, domain, attrs = {}, props = {}) {
  const a = attrs && typeof attrs === 'object' ? attrs : {};
  switch (control) {
    case 'toggle': case 'on': case 'off': case 'open': case 'close': case 'stop':
    case 'playPause': case 'next': case 'prev': case 'run': case 'start': case 'pause': case 'dock':
      return value === undefined || value === null ? { value: null } : undefined;
    case 'brightness': {
      const v = num(value);
      return v === null ? undefined : { value: clamp(Math.round(v), 1, 100) };
    }
    case 'colorTemp': {
      const v = num(value);
      if (v === null) return undefined;
      const lo = finite(a.min_color_temp_kelvin) ?? 2000;
      const hi = finite(a.max_color_temp_kelvin) ?? 6500;
      return { value: clamp(Math.round(v), Math.min(lo, hi), Math.max(lo, hi)) };
    }
    case 'rgb': {
      // a colour: three whole numbers 0..255, only for a light that takes any colour
      if (!Array.isArray(value) || value.length !== 3 || !strList(a.supported_color_modes).some((m) => COLOR_MODES.includes(m))) return undefined;
      const c = value.map(num);
      return c.some((x) => x === null) ? undefined : { value: c.map((x) => clamp(Math.round(x), 0, 255)) };
    }
    case 'fanPct': case 'position': {
      const v = num(value);
      return v === null ? undefined : { value: clamp(Math.round(v), 0, 100) };
    }
    case 'volume': {
      const v = num(value);
      return v === null ? undefined : { value: Math.round(clamp(v, 0, 1) * 100) / 100 };
    }
    case 'setpoint': {
      const v = num(value);
      return v === null ? undefined : { value: setTemp(v, climateRange(a)) };
    }
    case 'setpointRange': {
      if (!Array.isArray(value) || value.length !== 2) return undefined;
      const lo = num(value[0]);
      const hi = num(value[1]);
      if (lo === null || hi === null) return undefined;
      const r = climateRange(a);
      const l = setTemp(lo, r);
      const h = setTemp(hi, r);
      return l < h ? { value: [l, h] } : undefined;
    }
    case 'hvacMode':
      return typeof value === 'string' && climateModes(a, props).includes(value) ? { value } : undefined;
    case 'fanMode':
      return typeof value === 'string' && strList(a.fan_modes, 32).includes(value) ? { value } : undefined;
    case 'selectOption':
      // one of the options the entity has now, exactly as Home Assistant wrote it
      return typeof value === 'string' && Array.isArray(a.options) && a.options.slice(0, 64).includes(value) ? { value } : undefined;
    case 'numberSet': {
      const v = num(value);
      if (v === null) return undefined;
      const r = numberRange(a);
      // on the entity's step from its minimum, within its range, without float dust (0.1 + 0.2)
      return { value: Math.round(clamp(snap(v, r.step, r.lo), r.lo, r.hi) * 1e6) / 1e6 };
    }
    default:
      return undefined;
  }
}

/**
 * The Home Assistant service call of a control: { domain, service, data } for POST /api/services/<domain>/<service>
 * (`data` without the entity id). `value` is what clampValue gave. Null for anything outside CONTROL_TABLE.
 */
export function serviceCall(control, domain, value) {
  const row = CONTROL_TABLE[control];
  if (!row || !row.domains.includes(domain)) return null;
  if (control === 'setpointRange' && !(Array.isArray(value) && value.length === 2)) return null;
  const service = row.service(domain);
  const data = {};
  if (control === 'brightness') data.brightness_pct = value;
  else if (control === 'colorTemp') data.color_temp_kelvin = value;
  else if (control === 'rgb') data.rgb_color = value;
  else if (control === 'fanPct') data.percentage = value;
  else if (control === 'setpoint') data.temperature = value;
  else if (control === 'setpointRange') [data.target_temp_low, data.target_temp_high] = value;
  else if (control === 'hvacMode') data.hvac_mode = value;
  else if (control === 'fanMode') data.fan_mode = value;
  else if (control === 'position') data.position = value;
  else if (control === 'volume') data.volume_level = value;
  else if (control === 'selectOption') data.option = value;
  else if (control === 'numberSet') data.value = value;
  if (!service) return null;
  return { domain, service, data };
}

/** True when an alias's entity looks like a door (needsConfirm), from its live attributes and the owner's name. */
export function aliasFlagged(a, attrs) {
  return needsConfirm(a.entity.split('.')[0], attrs, a.entity, a.name);
}

/**
 * The controls an alias offers right now, and whether they need a second tap: none unless `touch` and the item (and
 * its row) is interactive; none for an entity that looks like a door until the owner ticked it in the builder.
 */
export function aliasControls(a, m, touch) {
  if (!touch || !a.interactive || !m || m.slim?.d === 'unavailable') return { c: [], cf: false };
  // a gas valve by its id or the card's name too (controlsFor only sees the attributes)
  if (isHighRisk(a.entity.split('.')[0], m.attrs, a.entity, a.name)) return { c: [], cf: false };
  const flagged = aliasFlagged(a, m.attrs);
  if (flagged && !a.ack) return { c: [], cf: true };
  return { c: controlsFor(a.kind, a.entity.split('.')[0], m.attrs, a.props), cf: flagged || !!a.confirm };
}

// ---- snapshots ----------------------------------------------------------------------------------------------------

/**
 * The states of a screen's aliases (HaSnapshot.states). `lookup(entity)` gives the mirrored { slim, attrs, at } or
 * null; `missing` decides what an entity the mirror does not have becomes: 'unavailable' (the mirror is complete,
 * the entity is gone) or 'skip' (not there yet). `touch`: the screen offers controls (canvas.touch, controls
 * allowed, not private); without it every `c` is empty. `only`: just these aliases.
 */
export function snapshotStates(aliases, lookup, { touch = false, missing = 'skip', only = null, hidden = null } = {}) {
  const states = {};
  for (const [alias, a] of aliases) {
    if (only && !only.has(alias)) continue;
    // an item its condition hides now gets nothing
    if (hidden?.has(a.itemId)) continue;
    const m = lookup(a.entity);
    if (!m) {
      if (missing === 'unavailable') states[alias] = { d: 'unavailable', at: 0, c: [] };
      continue;
    }
    const { c, cf } = aliasControls(a, m, touch);
    const st = c.length && cf ? { ...m.slim, at: m.at, c, cf: true } : { ...m.slim, at: m.at, c };
    // a gas valve known by its id or the card's name: drawn as one that is only shown
    if (st.d === 'valve' && !st.readOnly && isGasValve('valve', m.attrs, a.entity, a.name)) st.readOnly = true;
    // an Entidad card's rows (drawn read-only without touch)
    if (a.kind === 'ha.tile' && a.slot === 0 && m.slim?.d !== 'unavailable') {
      const f = tileFeatures(a.entity.split('.')[0], m.attrs, a.props);
      if (f.length) st.f = f;
    }
    states[alias] = st;
  }
  return states;
}

// ---- charts -------------------------------------------------------------------------------------------------------

export const CHART_PERIODS = Object.freeze({ '1h': 3600_000, '6h': 6 * 3600_000, '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000 });
export const MAX_POINTS = 200;

/** The time range of a chart period, and where its points come from (history up to 24 h, statistics beyond). */
export function periodRange(period, now = Date.now()) {
  const ms = CHART_PERIODS[period] ?? CHART_PERIODS['24h'];
  return { start: now - ms, end: now, source: ms > CHART_PERIODS['24h'] ? 'statistics' : 'history' };
}

/**
 * Points of GET /api/history/period (minimal_response, no_attributes): an array per entity, the first state of each
 * carrying its entity_id. Returns Map entity → [[ms, value]] with the numeric states only, in time order.
 */
export function parseHistory(raw) {
  const out = new Map();
  if (!Array.isArray(raw)) return out;
  for (const list of raw) {
    if (!Array.isArray(list) || !list.length) continue;
    const id = list.find((x) => typeof x?.entity_id === 'string')?.entity_id;
    if (!id) continue;
    const pts = [];
    for (const x of list) {
      const v = finite(x?.state);
      const t = Date.parse(x?.last_changed ?? x?.last_updated ?? '');
      if (v !== null && Number.isFinite(t)) pts.push([t, v]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    out.set(id, pts);
  }
  return out;
}

/** Points of WS recorder/statistics_during_period: Map statistic id → [[ms, mean (else state)]]. */
export function parseStatistics(result) {
  const out = new Map();
  if (!result || typeof result !== 'object') return out;
  for (const [id, rows] of Object.entries(result)) {
    if (!Array.isArray(rows)) continue;
    const pts = [];
    for (const r of rows) {
      const t = typeof r?.start === 'number' ? r.start : Date.parse(r?.start ?? '');
      const v = finite(r?.mean) ?? finite(r?.state);
      if (Number.isFinite(t) && v !== null) pts.push([t, v]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    out.set(id, pts);
  }
  return out;
}

/**
 * Largest-Triangle-Three-Buckets: at most `n` points that keep the shape of the series (the first and last points
 * are always kept). Points are [x, y] pairs in x order.
 */
export function downsample(points, n = MAX_POINTS) {
  if (!Array.isArray(points)) return [];
  if (n < 3 || points.length <= n) return points.slice();
  const out = [points[0]];
  const every = (points.length - 2) / (n - 2);
  let a = 0;
  for (let i = 0; i < n - 2; i++) {
    // the average of the next bucket
    const s2 = Math.floor((i + 1) * every) + 1;
    const e2 = Math.min(Math.floor((i + 2) * every) + 1, points.length);
    let ax = 0;
    let ay = 0;
    for (let j = s2; j < e2; j++) {
      ax += points[j][0];
      ay += points[j][1];
    }
    const len = Math.max(1, e2 - s2);
    ax /= len;
    ay /= len;
    // the point of this bucket that makes the largest triangle with the last kept point and that average
    const s = Math.floor(i * every) + 1;
    const e = Math.floor((i + 1) * every) + 1;
    let best = s;
    let area = -1;
    const [px, py] = points[a];
    for (let j = s; j < e; j++) {
      const ar = Math.abs((px - ax) * (points[j][1] - py) - (px - points[j][0]) * (ay - py));
      if (ar > area) {
        area = ar;
        best = j;
      }
    }
    out.push(points[best]);
    a = best;
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Points rounded for the wire: seconds-precision times, values to 3 decimals. */
export const roundPoints = (pts) => pts.map(([t, v]) => [Math.round(t / 1000) * 1000, Math.round(v * 1000) / 1000]);
