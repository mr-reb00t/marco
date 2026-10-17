// Personalizado on the display: what GET /api/display/config carries for a canvas screen (core/canvasCore.js
// projectCanvas through core/screens.js displayConfig). No entity id, HA address or picture ever reaches a display.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasDefaults, canvasEventsNeed, CLOUD_CANVAS_KINDS, defaultCanvas, defaultItemStyle, projectCanvas } from '../core/canvasCore.js';
import { validateConfig } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { displayConfig, displayWidgets } from '../core/screens.js';

const M = (x, y, size) => ({ zone: 'main', x, y, size });
let n = 0;
const item = (kind, pos, props = {}, extra = {}) => ({
  id: `cv_test${String(n++).padStart(4, '0')}`, kind, pos, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra,
});

/** A saved config with one canvas screen holding `items` (validated, as the store keeps it). */
function config(items, canvas = {}, mutate = () => {}) {
  const c = defaultConfig();
  c.screens[0].layout.preset = 'canvas';
  c.screens[0].canvas = { ...defaultCanvas(), ...canvas, items };
  mutate(c);
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.value;
}

const HA_ITEMS = () => [
  item('ha.light', M(0, 0, 's'), { entity: 'light.kitchen_ceiling', name: 'Cocina' }),
  item('ha.room', M(6, 0, 'm'), { title: 'Salón', rows: [{ entity: 'switch.living_lamp', name: '', interactive: true }, { entity: 'sensor.living_temperature', name: '', interactive: false }] }),
  item('ha.chart', M(14, 0, 'm'), { series: [{ entity: 'sensor.outdoor_temperature', label: 'Fuera', color: null }] }),
  item('ha.camera', M(0, 6, 'l'), { entity: 'camera.front_door', showWhen: 'binary_sensor.front_motion' }),
  item('ha.scene', M(12, 6, 's'), { buttons: [{ entity: 'scene.movie_night', label: 'Cine', icon: '' }] }),
  item('html', M(18, 6, 's'), { html: '<b>{{t}}</b>', css: '', bind: [{ name: 't', entity: 'sensor.attic_temperature' }], refreshSec: 60 }),
];
const ENTITIES = ['light.kitchen_ceiling', 'switch.living_lamp', 'sensor.living_temperature', 'sensor.outdoor_temperature', 'camera.front_door', 'binary_sensor.front_motion', 'scene.movie_night', 'sensor.attic_temperature'];

test('null for every other layout; an object for a canvas screen', () => {
  const c = defaultConfig();
  assert.equal(displayConfig(c, c.screens[0]).canvas, null);
  const v = config([item('clock.digital', M(0, 0, 'm'))]);
  const out = displayConfig(v, v.screens[0]).canvas;
  assert.equal(out.items.length, 1);
  assert.equal(out.orientation, 'auto');
  assert.equal(out.touch, false);
  assert.match(out.items[0].v, /^[0-9a-f]{8}$/);
  assert.deepEqual(out.items[0].portrait, M(0, 0, 'm'), 'portrait derived on the server while portraitAuto');
});

test('haOff: only with Home Assistant cards on the screen and Home Assistant switched off', () => {
  const off = config(HA_ITEMS(), {}, (c) => void (c.homeassistant.enabled = false));
  assert.equal(displayConfig(off, off.screens[0]).canvas.haOff, true);
  const on = config(HA_ITEMS(), {}, (c) => void (c.homeassistant.enabled = true));
  assert.equal('haOff' in displayConfig(on, on.screens[0]).canvas, false);
  const none = config([item('clock.digital', M(0, 0, 'm'))]);
  assert.equal('haOff' in displayConfig(none, none.screens[0]).canvas, false);
});

test('entity ids never reach a display: aliases instead, checked over the whole payload', () => {
  const v = config(HA_ITEMS(), { touch: true });
  const out = displayConfig(v, v.screens[0]);
  const json = JSON.stringify(out);
  for (const e of ENTITIES) assert.equal(json.includes(e), false, `${e} leaked`);
  for (const bad of ['entity_picture', 'access_token', 'http://homeassistant', 'https://']) assert.equal(JSON.stringify(out.canvas).includes(bad), false, bad);
  const light = out.canvas.items.find((i) => i.kind === 'ha.light');
  assert.deepEqual(light.props.entity, { a: `${light.id}:0`, d: 'light' });
  const room = out.canvas.items.find((i) => i.kind === 'ha.room');
  assert.deepEqual(room.props.rows.map((r) => r.entity), [{ a: `${room.id}:0`, d: 'switch' }, { a: `${room.id}:1`, d: 'sensor' }]);
  const cam = out.canvas.items.find((i) => i.kind === 'ha.camera');
  assert.deepEqual([cam.props.entity.a, cam.props.showWhen.a], [`${cam.id}:0`, `${cam.id}:1`]);
  const html = out.canvas.items.find((i) => i.kind === 'html');
  assert.deepEqual(html.props.bind[0].entity, { a: `${html.id}:0`, d: 'sensor' });
});

test('touch: the screen switch, ANDed with the server allowing controls and the screen not being private', () => {
  const v = config(HA_ITEMS(), { touch: true });
  const on = displayConfig(v, v.screens[0]).canvas;
  assert.equal(on.touch, true);
  assert.equal(on.items.find((i) => i.kind === 'ha.light').interactive, true);
  assert.equal(on.items.find((i) => i.kind === 'ha.chart').interactive, false, 'no controls on a chart');
  const off = displayConfig(v, v.screens[0], { haControls: false }).canvas;
  assert.equal(off.touch, false);
  assert.ok(off.items.every((i) => i.interactive === false));
  const v2 = config(HA_ITEMS(), { touch: false });
  assert.ok(displayConfig(v2, v2.screens[0]).canvas.items.every((i) => i.interactive === false));
  const priv = displayConfig(v, v.screens[0], { privacy: { status: { active: true, until: null, reason: 'manual' }, next: null } }).canvas;
  assert.equal(priv.touch, false);
});

test('private screens: Home Assistant, cameras, values, per person and custom cards become neutral placeholders', () => {
  const v = config([...HA_ITEMS(), item('value', M(12, 14, 'xs'), { key: 'solar.today' }), item('clock.digital', M(16, 12, 's'))]);
  const priv = displayConfig(v, v.screens[0], { privacy: { status: { active: true, until: null, reason: 'manual' }, next: null } }).canvas;
  for (const it of priv.items) {
    if (it.kind === 'clock.digital') {
      assert.equal(it.disabled, undefined);
      continue;
    }
    assert.equal(it.disabled, 'privacy', it.kind);
    assert.deepEqual(it.props, {}, it.kind);
  }
  const people = config([item('calendar.people', M(0, 0, 'l'))]);
  const p2 = displayConfig(people, people.screens[0], { privacy: { status: { active: true, until: null, reason: 'manual' }, next: null } }).canvas;
  assert.equal(p2.items[0].disabled, 'privacy');
});

test('kinds the server does not allow are sent as disabled placeholders (the last line of defence)', () => {
  const v = config([item('ha.light', M(0, 0, 's'), { entity: 'light.a' }), item('clock.digital', M(8, 0, 'm'))]);
  const out = displayConfig(v, v.screens[0], { canvasKinds: CLOUD_CANVAS_KINDS }).canvas;
  assert.equal(out.items[0].disabled, 'feature');
  assert.deepEqual(out.items[0].props, {});
  assert.equal(out.items[1].disabled, undefined);
});

test('saved widgets: the widget items bring their definitions with place canvas', () => {
  const v = config([item('widget', M(0, 0, 'm'), { widgetId: 'w_pic' })], {}, (c) => {
    c.widgets = [{ id: 'w_pic', type: 'image', name: 'Pic', options: { url: 'https://example.com/a.png', refreshSec: 300, fit: 'contain', bust: false } }];
  });
  assert.equal(v.screens[0].canvas.items.length, 1);
  const ws = displayWidgets(v, v.screens[0]);
  assert.deepEqual(ws.map((w) => [w.id, w.place]), [['w_pic', 'canvas']]);
  assert.deepEqual(displayWidgets(v, v.screens[0], { isPrivate: true }), []);
  // the same widget on another layout is not sent for the canvas
  const other = structuredClone(v);
  other.screens[0].layout.preset = 'bigCalendar';
  assert.deepEqual(displayWidgets(other, other.screens[0]), []);
});

test('per person: the members chosen become the calendars shown as columns', () => {
  const v = config([item('calendar.people', M(0, 0, 'l'), { memberIds: ['m_ana', 'm_leo'] })], {}, (c) => {
    c.family.members = [
      { id: 'm_ana', name: 'Ana', color: '#ff0000', avatar: '🙂', kid: true, calendarId: 'c_holidays' },
      { id: 'm_leo', name: 'Leo', color: '#00ff00', avatar: '🙂', kid: true, calendarId: null },
    ];
  });
  const it = displayConfig(v, v.screens[0]).canvas.items[0];
  assert.deepEqual(it.props.columns, ['c_holidays']);
  assert.equal('memberIds' in it.props, false);
});

test('reconcile key: v changes with what an item draws, and only then', () => {
  const a = item('clock.digital', M(0, 0, 'm'));
  const v1 = config([a]);
  const v2 = config([{ ...a, props: { ...a.props, seconds: true } }]);
  const v3 = config([{ ...a, pos: M(8, 0, 'm') }]);
  const key = (v) => displayConfig(v, v.screens[0]).canvas.items[0].v;
  assert.equal(key(v1), key(config([a])));
  assert.notEqual(key(v1), key(v2));
  assert.notEqual(key(v1), key(v3));
});

test('portrait: derived while automatic, the stored arrangement otherwise', () => {
  const a = item('calendar.month', M(8, 0, 'xl'));
  const b = item('clock.digital', M(0, 0, 'm'));
  const auto = config([a, b]);
  const pa = displayConfig(auto, auto.screens[0]).canvas.items;
  // derived by (y, x): the clock (x 0) first
  assert.deepEqual(pa.find((i) => i.kind === 'clock.digital').portrait, M(0, 0, 'm'));
  assert.deepEqual(pa.find((i) => i.kind === 'calendar.month').portrait, M(0, 6, 'xl'));
  const manual = config([{ ...a, portrait: M(0, 0, 'xl') }, { ...b, portrait: M(0, 12, 'm') }], { portraitAuto: false });
  const pm = displayConfig(manual, manual.screens[0]).canvas.items;
  assert.deepEqual(pm.find((i) => i.kind === 'calendar.month').portrait, M(0, 0, 'xl'));
  assert.deepEqual(pm.find((i) => i.kind === 'clock.digital').portrait, M(0, 12, 'm'));
});

test('events range: the longest look-ahead of the calendar items, at most six weeks', () => {
  assert.equal(canvasEventsNeed(null), 0);
  assert.equal(canvasEventsNeed({ items: [item('clock.digital', M(0, 0, 'm'))] }), 0);
  assert.equal(canvasEventsNeed({ items: [item('calendar.agenda', M(0, 0, 'm'), { days: 14 })] }), 15);
  assert.equal(canvasEventsNeed({ items: [item('calendar.month', M(0, 0, 'l'), { weeks: 'auto' })] }), 42);
  assert.equal(canvasEventsNeed({ items: [item('calendar.month', M(0, 0, 'l'), { weeks: 2 }), item('calendar.people', M(0, 8, 'l'), { days: 3 })] }), 21);
});

test('projectCanvas is a function of the config only (the admin preview runs it too)', () => {
  const v = config(HA_ITEMS());
  const s = v.screens[0];
  assert.deepEqual(projectCanvas(s, {}), projectCanvas(structuredClone(s), {}));
  // the saved config is not changed by projecting it
  const before = JSON.stringify(s);
  projectCanvas(s, { isPrivate: true });
  assert.equal(JSON.stringify(s), before);
});
