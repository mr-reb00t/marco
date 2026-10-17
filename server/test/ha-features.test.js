// The Entidad card's rows (haCore tileFeatures), the new Home Assistant domains (valve, vacuum, select, number,
// update), the Indicador and Estadística kinds, the Sección kind, and "Mostrar solo si" (canvasCore conditions):
// slim shapes, defaults per domain, the controls they open, clamping, validation, the projection (no entity id or key
// ever reaches a display) and what the server hides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_KINDS, CLOUD_CANVAS_KINDS, canvasDefaults, conditionEntities, conditionHidden, conditionKeys, conditionMet, defaultCanvas,
  defaultItemStyle, projectCanvas, readCondition, sanitizeCanvas,
} from '../core/canvasCore.js';
import { aliasControls, aliasesFor, clampValue, controlsFor, slim, snapshotStates, tileFeatures, watchedEntities } from '../core/haCore.js';
import { screenValueKeys } from '../core/valuesCore.js';

const collector = () => {
  const errors = [];
  const warnings = [];
  return { errors, warnings, err: (p, m) => errors.push(`${p}: ${m}`), warn: (p, m) => warnings.push(`${p}: ${m}`) };
};
const M = (x, y, size) => ({ zone: 'main', x, y, size });
const item = (id, kind, pos, props = {}, extra = {}) => ({ id, kind, pos, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra });
const screen = (items, extra = {}) => ({ id: 's1', layout: { preset: 'canvas' }, screen: { orientation: 'auto' }, canvas: { ...defaultCanvas(), ...extra, items } });

test('slim: valves, selects, numbers, vacuums and updates', () => {
  assert.deepEqual(slim('valve', 'open', { device_class: 'water', current_position: 40, friendly_name: 'Llave' }), { d: 'valve', state: 'open', pos: 40, dc: 'water', readOnly: false, n: 'Llave' });
  assert.equal(slim('valve', 'closed', { device_class: 'gas' }).readOnly, true, 'a gas valve is only shown');
  assert.deepEqual(slim('select', 'Eco', { options: ['Eco', 'Normal', 42] }), { d: 'select', v: 'Eco', opts: ['Eco', 'Normal'] });
  assert.equal(slim('input_select', 'a', { options: Array.from({ length: 40 }, (_, i) => `o${i}`) }).opts.length, 24);
  assert.deepEqual(slim('number', '45', { min: 0, max: 120, step: 5, unit_of_measurement: 'min' }), { d: 'sensor', v: '45', num: 45, unit: 'min', dc: null, min: 0, max: 120, step: 5 });
  assert.deepEqual(slim('input_number', '22', { mode: 'box' }), { d: 'sensor', v: '22', num: 22, unit: '', dc: null, min: 0, max: 100, step: 1, box: true });
  // a plain sensor keeps its shape (no range)
  assert.deepEqual(slim('sensor', '3', { min: 0, max: 9 }), { d: 'sensor', v: '3', num: 3, unit: '', dc: null });
  assert.deepEqual(slim('vacuum', 'cleaning', { battery_level: 81.6 }), { d: 'vacuum', state: 'cleaning', bat: 82 });
  assert.deepEqual(slim('update', 'on', { installed_version: '1.0', latest_version: '1.1', in_progress: 30 }), { d: 'update', on: true, cur: '1.0', next: '1.1', busy: true });
  assert.deepEqual(slim('update', 'off', { installed_version: '1.1', latest_version: '1.1', in_progress: false }), { d: 'update', on: false, cur: '1.1', next: '1.1' });
});

test('tileFeatures: the rows that suit each domain, the owner\'s choice, only what the entity can do', () => {
  assert.deepEqual(tileFeatures('light', { supported_color_modes: ['color_temp', 'xy'] }), ['color'], 'the colours; the icon switches it, the brightness only when chosen');
  assert.deepEqual(tileFeatures('light', { supported_color_modes: ['onoff'] }), [], 'an on and off light has no rows');
  assert.deepEqual(tileFeatures('light', { supported_color_modes: ['rgb'] }), ['color']);
  assert.deepEqual(tileFeatures('light', { supported_color_modes: ['brightness'] }), [], 'a dimmable white light: nothing under it unless chosen');
  assert.deepEqual(tileFeatures('cover', { supported_features: 15 }), ['cover', 'position']);
  assert.deepEqual(tileFeatures('cover', { supported_features: 3 }), ['cover']);
  assert.deepEqual(tileFeatures('valve', { supported_features: 3 }), ['valve']);
  assert.deepEqual(tileFeatures('climate', { hvac_modes: ['off', 'heat', 'heat_cool'] }), ['target', 'hvacModes']);
  assert.deepEqual(tileFeatures('climate', { hvac_modes: ['heat'] }), ['target'], 'one mode is no choice');
  assert.deepEqual(tileFeatures('select', { options: ['a', 'b'] }), ['select']);
  assert.deepEqual(tileFeatures('select', { options: [] }), []);
  assert.deepEqual(tileFeatures('number', {}), ['number']);
  assert.deepEqual(tileFeatures('vacuum', {}), ['vacuum']);
  assert.deepEqual(tileFeatures('update', {}), ['update']);
  assert.deepEqual(tileFeatures('sensor', { unit_of_measurement: '%' }), ['gauge']);
  assert.deepEqual(tileFeatures('sensor', { unit_of_measurement: '°C' }), []);
  assert.deepEqual(tileFeatures('switch', {}), [], 'a tap on the card switches it already');
  // the owner's rows: kept in order, only those of the domain, at most three
  assert.deepEqual(tileFeatures('switch', {}, { features: ['toggle'] }), [], 'the on/off row is gone (the icon switches it)');
  assert.deepEqual(tileFeatures('light', { supported_color_modes: ['color_temp'] }, { features: ['colorTemp', 'toggle', 'cover', 'brightness'] }), ['colorTemp', 'brightness']);
  assert.deepEqual(tileFeatures('light', { supported_color_modes: ['color_temp'] }, { features: [] }), [], 'none chosen: none');
  assert.deepEqual(tileFeatures('sensor', { unit_of_measurement: 'W' }, { features: ['gauge'] }), ['gauge']);
});

test('controls: the Entidad rows open their controls, the climate steps of the entity, water valves need the tick', () => {
  const ct = { supported_color_modes: ['color_temp'] };
  assert.deepEqual(controlsFor('ha.tile', 'climate', { hvac_modes: ['off', 'heat', 'heat_cool'] }), ['setpoint', 'setpointRange', 'hvacMode']);
  assert.deepEqual(controlsFor('ha.tile', 'climate', { hvac_modes: ['off', 'heat'] }, { features: ['hvacModes'] }), ['hvacMode']);
  assert.deepEqual(controlsFor('ha.tile', 'light', ct, { features: ['toggle'] }), ['toggle', 'on', 'off'], 'a saved on/off row: the icon still switches it');
  assert.deepEqual(controlsFor('ha.tile', 'vacuum', { supported_features: 4 }), ['pause'], 'only what the vacuum says it can do');
  assert.deepEqual(controlsFor('ha.tile', 'vacuum', {}), ['pause', 'dock', 'start']);
  assert.deepEqual(controlsFor('ha.room', 'valve', { supported_features: 3 }), ['open', 'close']);
  assert.ok(!controlsFor('ha.tile', 'cover', { supported_features: 3, current_position: 40 }).includes('position'), 'a position it only reports is a bar, not a slider');
  assert.ok(controlsFor('ha.tile', 'cover', { supported_features: 7, current_position: 40 }).includes('position'));
  assert.deepEqual(controlsFor('ha.room', 'select', { options: ['a'] }), [], 'a room row taps on and off only');
  // setpoints follow the entity's step: 0.5 and 1
  assert.deepEqual(clampValue('setpoint', 21.3, 'climate', { target_temp_step: 0.5, min_temp: 7, max_temp: 35 }), { value: 21.5 });
  assert.deepEqual(clampValue('setpoint', 21.3, 'climate', { target_temp_step: 1, min_temp: 7, max_temp: 35 }), { value: 21 });
  assert.deepEqual(clampValue('setpointRange', [18.2, 24.8], 'climate', { target_temp_step: 0.5 }), { value: [18, 25] });
  // selects and numbers
  assert.deepEqual(clampValue('selectOption', 'Eco', 'select', { options: ['Eco'] }), { value: 'Eco' });
  assert.equal(clampValue('selectOption', 'eco', 'select', { options: ['Eco'] }), undefined, 'exactly as Home Assistant wrote it');
  assert.equal(clampValue('selectOption', 'x', 'select', {}), undefined);
  assert.deepEqual(clampValue('numberSet', 0.30000000000000004, 'number', { min: 0, max: 1, step: 0.1 }), { value: 0.3 });
  assert.deepEqual(clampValue('numberSet', 13, 'number', { min: 3, max: 30, step: 5 }), { value: 13 }, 'on the step from the minimum');
  assert.deepEqual(clampValue('numberSet', -5, 'number', { min: 3, max: 30, step: 5 }), { value: 3 });
  assert.deepEqual(clampValue('position', -3, 'valve', {}), { value: 0 });
  assert.deepEqual(clampValue('dock', undefined, 'vacuum', {}), { value: null });
  assert.equal(clampValue('start', 1, 'vacuum', {}), undefined);
  // the water valve: nothing until the owner ticks it, then two taps; a gas valve never
  const a = { entity: 'valve.main', itemId: 'cv_a0000000', kind: 'ha.tile', slot: 0, interactive: true, confirm: false, ack: false, name: '', props: {} };
  const water = { slim: slim('valve', 'open', { device_class: 'water', supported_features: 3 }), attrs: { device_class: 'water', supported_features: 3 } };
  assert.deepEqual(aliasControls(a, water, true), { c: [], cf: true });
  assert.deepEqual(aliasControls({ ...a, ack: true }, water, true), { c: ['open', 'close', 'valve'].filter((c) => c !== 'valve'), cf: true });
  const gas = { slim: slim('valve', 'open', { device_class: 'gas' }), attrs: { device_class: 'gas', supported_features: 3 } };
  assert.deepEqual(aliasControls({ ...a, ack: true }, gas, true).c, []);
  // a cover that is a door, in an Entidad card: the same tick
  const door = { slim: slim('cover', 'closed', { device_class: 'door' }), attrs: { device_class: 'door', supported_features: 15 } };
  assert.deepEqual(aliasControls({ ...a, entity: 'cover.porch' }, door, true), { c: [], cf: true });
  assert.equal(aliasControls({ ...a, entity: 'cover.porch', ack: true }, door, true).cf, true);
});

test('kinds: Indicador, Estadística and Sección validate, Sección also on Marco Cloud with no card by default', () => {
  const c = collector();
  const g = CANVAS_KINDS['ha.gauge'].props(c, 'p', { entity: 'sensor.x', min: 50, max: 10, thresholds: [80, 20], decimals: 9 }, {}, {});
  assert.deepEqual([g.min, g.max, g.thresholds, g.decimals], [10, 50, [20, 80], 3]);
  CANVAS_KINDS['ha.gauge'].props(c, 'p', { entity: 'light.x' }, {}, {});
  assert.ok(c.errors.some((e) => e.includes('must be one of the domains')));
  const c2 = collector();
  const st = CANVAS_KINDS['ha.statistic'].props(c2, 'p', { entity: 'sensor.energy', stat: 'median', period: 'year' }, {}, {});
  assert.deepEqual([st.stat, st.period], ['change', 'today']);
  assert.equal(c2.errors.length, 2);
  assert.equal(CANVAS_KINDS['ha.statistic'].perScreen, 8);
  const c3 = collector();
  const tile = CANVAS_KINDS['ha.tile'].props(c3, 'p', { entity: 'valve.x', features: ['valve', 'nope', 'valve', 'position', 'gauge', 'update'], gaugeMin: 5, gaugeMax: 5 }, {}, {});
  assert.deepEqual(tile.features, ['valve', 'position', 'gauge'], 'known ones, once, at most three');
  assert.deepEqual([tile.gaugeMin, tile.gaugeMax], [5, 6]);
  assert.equal(CANVAS_KINDS['ha.tile'].props(collector(), 'p', { entity: 'update.core' }, {}, {}).entity, 'update.core', 'updates and valves may be picked');
  assert.equal(CANVAS_KINDS['ha.tile'].sizes.includes('m'), true);
  assert.deepEqual(canvasDefaults('heading'), { title: '', icon: '', align: 'left', line: true });
  assert.deepEqual(CANVAS_KINDS.heading.defStyle, { surface: 'none' });
  assert.ok(CLOUD_CANVAS_KINDS.includes('heading'));
  assert.equal(CLOUD_CANVAS_KINDS.includes('ha.gauge') || CLOUD_CANVAS_KINDS.includes('ha.statistic'), false);
});

test('conditions: validation, Valor only on Marco Cloud, the entity counts towards the watched set and the cap', () => {
  const c = collector();
  assert.deepEqual(readCondition(c, 'w', { src: 'ha', entity: 'binary_sensor.door', op: 'eq', value: 'on' }), { src: 'ha', entity: 'binary_sensor.door', op: 'eq', value: 'on' });
  assert.deepEqual(readCondition(c, 'w', { src: 'value', key: 'washer', op: 'ne', value: 3 }), { src: 'value', key: 'washer', op: 'ne', value: '3' });
  assert.deepEqual(readCondition(c, 'w', { src: 'ha', entity: '', op: 'gt', value: '20,5' }), { src: 'ha', entity: '', op: 'gt', value: '20,5' }, 'kept while it is being written');
  assert.deepEqual(c.errors, []);
  assert.equal(readCondition(c, 'w', { src: 'ha', entity: 'x.y', op: 'gt', value: 'warm' }), null, 'above needs a number');
  assert.equal(readCondition(c, 'w', { src: 'ha', entity: 'binary_sensor.door' }, { ha: false }), null, 'no Home Assistant on Marco Cloud');
  assert.equal(readCondition(c, 'w', { src: 'value', key: '__proto__' }).key, '');
  assert.equal(readCondition(c, 'w', { src: 'mqtt' }), null);
  assert.equal(c.errors.length, 4);
  // through sanitizeCanvas: on Cloud the Home Assistant condition goes, the Valor one stays
  const raw = {
    ...defaultCanvas(),
    items: [
      item('cv_a0000001', 'clock.digital', M(0, 0, 'm'), {}, { when: { src: 'ha', entity: 'binary_sensor.door', op: 'eq', value: 'on' } }),
      item('cv_a0000002', 'heading', M(8, 0, 'w'), { title: 'x' }, { when: { src: 'value', key: 'washer', op: 'eq', value: 'done' } }),
    ],
  };
  const cloud = collector();
  const cv = sanitizeCanvas(cloud, 'canvas', raw, {}, { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.equal(cv.items[0].when, undefined);
  assert.deepEqual(cv.items[1].when, { src: 'value', key: 'washer', op: 'eq', value: 'done' });
  assert.ok(cloud.errors.some((e) => e.includes('when.src')));
  const local = sanitizeCanvas(collector(), 'canvas', raw, {}, {});
  assert.equal(local.items[0].when.entity, 'binary_sensor.door');
  const scr = screen(local.items);
  assert.deepEqual([...conditionEntities(scr)], ['binary_sensor.door']);
  assert.deepEqual([...conditionKeys(scr)], ['washer']);
  assert.ok(watchedEntities({ screens: [scr] }).has('binary_sensor.door'), 'mirrored so the server can decide');
  assert.equal(aliasesFor(scr).size, 0, 'but never an alias: the display never learns it');
  // the cap of Home Assistant entities counts it
  const many = { ...defaultCanvas(), items: Array.from({ length: 40 }, (_, i) => item(`cv_t${String(i).padStart(7, '0')}`, 'ha.tile', { zone: 'main', x: (i % 12) * 2, y: Math.floor(i / 12), size: 'row', w: 2, h: 1 }, { entity: `light.l${i}` }, { when: { src: 'ha', entity: `binary_sensor.b${i}`, op: 'eq', value: 'on' } })) };
  many.items.push(item('cv_clock001', 'clock.digital', M(16, 12, 's'), {}, { when: { src: 'ha', entity: 'binary_sensor.one_more', op: 'eq', value: 'on' } }));
  const cap = collector();
  const capped = sanitizeCanvas(cap, 'canvas', many, {}, {});
  assert.ok(cap.errors.some((e) => e.includes('items[40].when') && e.includes('too many Home Assistant entities')));
  assert.equal(capped.items.filter((it) => it.when?.entity).length, 40, '80 entities: 40 lights and 40 conditions');
  assert.equal(capped.items.find((it) => it.id === 'cv_clock001').when.entity, '', 'the 81st is left out');
});

test('conditionMet: equals, not equals, above, below; numbers as numbers; nothing known never shows', () => {
  const ha = (op, value) => ({ src: 'ha', entity: 'x.y', op, value });
  assert.equal(conditionMet(ha('eq', 'on'), 'on'), true);
  assert.equal(conditionMet(ha('eq', 'ON'), 'on'), true, 'case does not matter');
  assert.equal(conditionMet(ha('eq', 'on'), 'off'), false);
  assert.equal(conditionMet(ha('ne', 'on'), 'off'), true);
  assert.equal(conditionMet(ha('ne', 'on'), null), false, 'unknown: hidden');
  assert.equal(conditionMet(ha('eq', '21'), '21.0'), true, 'numbers compare as numbers');
  assert.equal(conditionMet(ha('gt', '20,5'), '21'), true);
  assert.equal(conditionMet(ha('gt', '25'), '21'), false);
  assert.equal(conditionMet(ha('lt', '25'), '21'), true);
  assert.equal(conditionMet(ha('lt', '25'), 'unavailable'), false);
  assert.equal(conditionMet(ha('eq', 'unavailable'), 'unavailable'), true);
  assert.equal(conditionMet({ src: 'ha', entity: '', op: 'eq', value: 'on' }, null), true, 'not chosen yet: shown');
  const v = (op, value) => ({ src: 'value', key: 'k', op, value });
  assert.equal(conditionMet(v('eq', 'true'), true), true);
  assert.equal(conditionMet(v('eq', 'on'), true), true);
  assert.equal(conditionMet(v('ne', 'on'), false), true);
  assert.equal(conditionMet(v('gt', '1'), true), false);
  assert.equal(conditionMet(v('gt', '100'), 612), true);
  assert.equal(conditionMet(v('eq', 'Terminado'), 'terminado'), true);
  assert.equal(conditionMet(null, null), true);
});

test('conditionHidden and the projection: only { src } reaches a display; hidden items get no states and no values', () => {
  const items = [
    item('cv_a0000001', 'ha.tile', M(0, 0, 'xs'), { entity: 'light.a' }, { when: { src: 'ha', entity: 'binary_sensor.door', op: 'eq', value: 'on' } }),
    item('cv_a0000002', 'value', M(4, 0, 's'), { key: 'solar' }, { when: { src: 'value', key: 'washer', op: 'eq', value: 'done' } }),
    item('cv_a0000003', 'ha.tile', M(10, 0, 'xs'), { entity: 'light.b' }),
    item('cv_a0000004', 'clock.digital', M(14, 0, 's'), {}, { when: { src: 'ha', entity: '', op: 'eq', value: 'on' } }),
    item('cv_a0000005', 'heading', M(0, 4, 'w'), { title: 'x' }, { hidden: true, when: { src: 'ha', entity: 'binary_sensor.door', op: 'eq', value: 'on' } }),
  ];
  const scr = screen(items);
  const states = { 'binary_sensor.door': 'off' };
  const values = { washer: 'running' };
  const hide = conditionHidden(scr, { ha: (e) => states[e] ?? null, value: (k) => values[k] ?? null });
  assert.deepEqual([...hide], ['cv_a0000001', 'cv_a0000002']);
  states['binary_sensor.door'] = 'on';
  values.washer = 'Done';
  assert.deepEqual([...conditionHidden(scr, { ha: (e) => states[e] ?? null, value: (k) => values[k] ?? null })], []);
  assert.deepEqual([...conditionHidden(scr, { ha: (e) => states[e] ?? null, value: (k) => values[k] ?? null, isPrivate: true })], ['cv_a0000001', 'cv_a0000002'], 'private: every item with a condition');
  // the projection: { src } only, and the hash changes with it
  const p = projectCanvas(scr);
  const text = JSON.stringify(p);
  assert.deepEqual(p.items.find((x) => x.id === 'cv_a0000001').when, { src: 'ha' });
  assert.deepEqual(p.items.find((x) => x.id === 'cv_a0000002').when, { src: 'value' });
  assert.equal(p.items.find((x) => x.id === 'cv_a0000004').when, undefined, 'nothing chosen: no condition');
  for (const bad of ['binary_sensor.door', 'washer', 'done', 'light.a']) assert.equal(text.includes(bad), false, bad);
  const plain = projectCanvas(screen([{ ...items[0], when: undefined }]));
  assert.notEqual(plain.items[0].v, p.items.find((x) => x.id === 'cv_a0000001').v);
  // the states of a hidden item and the keys of a hidden Valor card are not sent
  const aliases = aliasesFor(scr);
  const mirror = (e) => ({ slim: slim(e.split('.')[0], 'on', {}), attrs: {}, at: 1 });
  const snap = snapshotStates(aliases, mirror, { hidden: new Set(['cv_a0000001']) });
  assert.deepEqual(Object.keys(snap), ['cv_a0000003:0']);
  assert.deepEqual([...screenValueKeys(scr, new Set(['cv_a0000002']))], []);
  assert.deepEqual([...screenValueKeys(scr)], ['solar']);
});
