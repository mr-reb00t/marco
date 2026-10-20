// Issue #19: a Rotativa's cards with conditions of their own ("Mostrar solo si"), so one card or another shows in the
// same place depending on Home Assistant or a value. The validation keeps them, the feeds follow their entities and
// keys, the hidden list names the card, the display gets only the source, and exports and imports treat them like an
// item's. The display side (skipping the card, no dots, hidden when none holds) is in display-canvas-rotator-when.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_CANVAS_KINDS, canvasCards, canvasDefaults, conditionEntities, conditionHidden, conditionKeys, defaultCanvas, defaultItemStyle,
  exportCanvasFile, projectCanvas, readCanvasFile, sanitizeCanvas,
} from '../core/canvasCore.js';
import { watchedEntities } from '../core/haCore.js';

const collector = () => {
  const errors = [];
  return { errors, err: (p, m) => errors.push({ p, m }), warn() {} };
};
const run = (items, opts = {}) => {
  const c = collector();
  const out = sanitizeCanvas(c, 'canvas', { ...defaultCanvas(), items }, {}, opts);
  return { c, out };
};
const MOTION = 'binary_sensor.hall_motion';
const on = (value, entity = MOTION) => ({ src: 'ha', entity, op: 'eq', value });
/** A Rotativa of the hall light while all is clear and the camera when someone moves. */
const rotator = (extra = {}, cards = null) => ({
  id: 'cv_rot00001', kind: 'rotator', pos: { zone: 'main', x: 0, y: 0, size: 'l' }, style: defaultItemStyle(),
  props: {
    ...canvasDefaults('rotator'),
    cards: cards ?? [
      { id: 'cv_card0001', kind: 'ha.tile', props: { ...canvasDefaults('ha.tile'), entity: 'light.hall' }, when: on('off') },
      { id: 'cv_card0002', kind: 'ha.camera', props: { ...canvasDefaults('ha.camera'), entity: 'camera.hall' }, when: on('on') },
    ],
  },
  ...extra,
});
const screen = (canvas) => ({ id: 's1', layout: { preset: 'canvas' }, screen: { orientation: 'auto' }, canvas });

test('validation keeps the condition of each card of a Rotativa, and refuses a wrong one like an item\'s', () => {
  const { c, out } = run([rotator()]);
  assert.deepEqual(c.errors, []);
  const cards = out.items[0].props.cards;
  assert.deepEqual(cards.map((cd) => cd.when), [on('off'), on('on')]);
  // a value condition, a card with none, and one not chosen yet (kept: it holds until an entity is picked)
  const mixed = run([rotator({}, [
    { id: 'cv_card0001', kind: 'clock.digital', props: canvasDefaults('clock.digital'), when: { src: 'value', key: 'washer', op: 'eq', value: 'done' } },
    { id: 'cv_card0002', kind: 'date', props: canvasDefaults('date') },
    { id: 'cv_card0003', kind: 'ha.tile', props: canvasDefaults('ha.tile'), when: { src: 'ha', entity: '', op: 'eq', value: 'on' } },
  ])]);
  assert.deepEqual(mixed.c.errors, []);
  assert.deepEqual(mixed.out.items[0].props.cards.map((cd) => cd.when ?? null), [
    { src: 'value', key: 'washer', op: 'eq', value: 'done' }, null, { src: 'ha', entity: '', op: 'eq', value: 'on' },
  ]);
  // wrong ones: an error at the card's path, and the card shows always
  const bad = run([rotator({}, [
    { id: 'cv_card0001', kind: 'date', props: canvasDefaults('date'), when: { src: 'mqtt', op: 'eq', value: '1' } },
    { id: 'cv_card0002', kind: 'date', props: canvasDefaults('date'), when: { src: 'value', key: 'x', op: 'gt', value: 'many' } },
  ])]);
  assert.ok(bad.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[0].when.src'), JSON.stringify(bad.c.errors));
  assert.ok(bad.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].when.value'), JSON.stringify(bad.c.errors));
  assert.deepEqual(bad.out.items[0].props.cards.map((cd) => cd.when), [undefined, undefined]);
  // where Home Assistant is not offered (Marco Cloud): only values
  const cloud = run([rotator({}, [
    { id: 'cv_card0001', kind: 'date', props: canvasDefaults('date'), when: on('on') },
    { id: 'cv_card0002', kind: 'date', props: canvasDefaults('date'), when: { src: 'value', key: 'k', op: 'eq', value: '1' } },
  ])], { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.ok(cloud.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[0].when.src'));
  assert.deepEqual(cloud.out.items[0].props.cards.map((cd) => cd.when?.src ?? null), [null, 'value']);
});

test('the entities of the cards\' conditions count towards the screen\'s 80', () => {
  // rooms of six rows bring the screen to `n` entities, then the Rotativa adds the light, the camera and the sensor
  const rooms = (n) => Array.from({ length: Math.ceil(n / 6) }, (_, i) => ({
    id: `cv_room${String(i).padStart(4, '0')}`, kind: 'ha.room', pos: { zone: 'main', x: (i % 6) * 4, y: Math.floor(i / 6) * 3, size: 'm', w: 4, h: 3 }, style: defaultItemStyle(),
    props: { title: '', rows: Array.from({ length: Math.min(6, n - i * 6) }, (_, j) => ({ entity: `sensor.r${i}_${j}`, name: '', interactive: true })) },
  }));
  const rot = rotator({ pos: { zone: 'main', x: 0, y: 12, size: 'w', w: 6, h: 4 } });
  // 77 + light + camera + the sensor = 80: fine
  const { c, out } = run([...rooms(77), rot]);
  assert.deepEqual(c.errors, []);
  assert.equal(out.items.at(-1).props.cards[0].when.entity, MOTION);
  // one more and the condition is one too many: emptied, with an error at its path
  const two = run([...rooms(78), rot]);
  assert.ok(two.c.errors.some((e) => e.p.endsWith('.props.cards[0].when') && /too many Home Assistant entities/.test(e.m)), JSON.stringify(two.c.errors));
  assert.equal(two.out.items.at(-1).props.cards[0].when.entity, '');
});

test('the feeds follow the cards\' conditions: watched entities, keys, and the hidden list names the card', () => {
  const cv = run([rotator(), rotator({ id: 'cv_rot00002', pos: { zone: 'main', x: 12, y: 0, size: 'l' } }, [
    { id: 'cv_card0003', kind: 'date', props: canvasDefaults('date'), when: { src: 'value', key: 'washer', op: 'eq', value: 'done' } },
    { id: 'cv_card0004', kind: 'clock.digital', props: canvasDefaults('clock.digital') },
  ])]).out;
  const s = screen(cv);
  const subs = canvasCards(cv.items).filter((it) => it.parent);
  assert.deepEqual(subs.map((x) => x.own ?? null), [on('off'), on('on'), { src: 'value', key: 'washer', op: 'eq', value: 'done' }, null]);
  assert.deepEqual([...conditionEntities(s)], [MOTION]);
  assert.deepEqual([...conditionKeys(s)], ['washer']);
  // the server mirrors the sensor (and the cards' own entities)
  const watched = watchedEntities({ screens: [s] });
  for (const e of [MOTION, 'light.hall', 'camera.hall']) assert.ok(watched.has(e), e);
  // all clear: the camera is skipped; someone moves: the light is; unavailable: both
  const hid = (state, washer = null) => [...conditionHidden(s, { ha: (e) => (e === MOTION ? state : null), value: (k) => (k === 'washer' ? washer : null) })].sort();
  assert.deepEqual(hid('off', 'done'), ['cv_card0002']);
  assert.deepEqual(hid('on', 'done'), ['cv_card0001']);
  assert.deepEqual(hid('unavailable', 'running'), ['cv_card0001', 'cv_card0002', 'cv_card0003']);
  // a private screen hides every card with a condition
  assert.deepEqual([...conditionHidden(s, { isPrivate: true })].sort(), ['cv_card0001', 'cv_card0002', 'cv_card0003']);
  // the Rotativa's own condition still hides all its cards; a card's own does not hide its Rotativa
  const own = screen(run([rotator({ when: { src: 'value', key: 'away', op: 'eq', value: 'no' } })]).out);
  assert.deepEqual([...conditionHidden(own, { ha: () => 'off', value: () => 'yes' })].sort(), ['cv_card0001', 'cv_card0002', 'cv_rot00001']);
  assert.deepEqual([...conditionHidden(own, { ha: () => 'off', value: () => 'no' })], ['cv_card0002']);
  // a Rotativa hidden by hand: nothing followed
  const hidden = screen(run([rotator({ hidden: true })]).out);
  assert.equal(conditionEntities(hidden).size, 0);
});

test('the display gets only the source of a card\'s condition, and its hash changes with it', () => {
  const cv = run([rotator()]).out;
  const cards = projectCanvas(screen(cv), {}).items[0].props.cards;
  assert.deepEqual(cards.map((cd) => cd.when), [{ src: 'ha' }, { src: 'ha' }]);
  assert.ok(!JSON.stringify(cards).includes(MOTION), 'never the entity');
  // none chosen yet: no condition on the display (the card shows)
  const blank = run([rotator({}, [
    { id: 'cv_card0001', kind: 'date', props: canvasDefaults('date'), when: { src: 'ha', entity: '', op: 'eq', value: 'on' } },
    { id: 'cv_card0002', kind: 'date', props: canvasDefaults('date') },
  ])]).out;
  const b = projectCanvas(screen(blank), {}).items[0].props.cards;
  assert.deepEqual(b.map((cd) => cd.when ?? null), [null, null]);
  const plain = run([rotator({}, [
    { id: 'cv_card0001', kind: 'date', props: canvasDefaults('date'), when: on('on') },
    { id: 'cv_card0002', kind: 'date', props: canvasDefaults('date') },
  ])]).out;
  const p = projectCanvas(screen(plain), {}).items[0].props.cards;
  assert.notEqual(p[0].v, b[0].v);
});

test('export empties the entity of a card\'s condition; an import without Home Assistant drops it and counts it', () => {
  const cv = run([rotator()]).out;
  const file = exportCanvasFile(cv);
  assert.deepEqual(file.canvas.items[0].props.cards.map((cd) => cd.when), [on('off', ''), on('on', '')]);
  assert.deepEqual(file.picks[cv.items[0].id], ['entities']);
  // back on a server with Home Assistant: kept, waiting for the entity
  const home = readCanvasFile(file);
  assert.equal(home.ok, true);
  assert.deepEqual(home.canvas.items[0].props.cards.map((cd) => cd.when), [on('off', ''), on('on', '')]);
  // where there is none: the Home Assistant cards go, and so do the conditions of the cards that stay
  const mixed = exportCanvasFile(run([rotator({}, [
    { id: 'cv_card0001', kind: 'date', props: canvasDefaults('date'), when: on('on') },
    { id: 'cv_card0002', kind: 'clock.digital', props: canvasDefaults('clock.digital'), when: { src: 'value', key: 'k', op: 'eq', value: '1' } },
  ])]).out);
  const cloud = readCanvasFile(mixed, {}, { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.equal(cloud.ok, true);
  assert.equal(cloud.conditions, 1);
  assert.deepEqual(cloud.canvas.items[0].props.cards.map((cd) => cd.when?.src ?? null), [null, 'value']);
});
