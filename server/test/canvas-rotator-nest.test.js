// Issue #19, a small Rotativa inside a group: a card of a group can be { id, kind: 'rotator', props: { cards,
// everySec, dots } } whose plain cards take turns in the group's share of the box (a camera while someone moves, and
// while all is clear three cards in rows, one of them cycling the weather). The depth stops there (no group and no
// Rotativa inside it), every card of it gets an id and counts towards the screen's caps and its kind's own, its cards'
// conditions count towards the entities, the box holds it, the feeds walk its cards, the display gets it projected and
// export and import keep it. The display side is in display-canvas-rotator-nest.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_LIMITS, CLOUD_CANVAS_KINDS, ROTATOR_MAX, canvasCards, canvasDefaults, cellRange, conditionEntities, conditionHidden, defaultCanvas, defaultItemStyle,
  exportCanvasFile, haEntitiesOf, isNestedRotator, kindFor, projectCanvas, readCanvasFile, rotatorLeaves, rotatorNodes, sanitizeCanvas,
} from '../core/canvasCore.js';
import { aliasesFor } from '../core/haCore.js';
import { cardPlaces } from '../core/weatherPlaces.js';

const collector = () => {
  const errors = [];
  return { errors, err: (p, m) => errors.push({ p, m }), warn() {} };
};
const run = (items, opts = {}, refs = {}) => {
  const c = collector();
  const out = sanitizeCanvas(c, 'canvas', { ...defaultCanvas(), items }, refs, opts);
  return { c, out };
};
const MOTION = 'binary_sensor.hall_motion';
const on = (value, entity = MOTION) => ({ src: 'ha', entity, op: 'eq', value });
const tile = (id, entity) => ({ id, kind: 'ha.tile', props: { ...canvasDefaults('ha.tile'), entity } });
const card = (id, kind, props = {}) => ({ id, kind, props: { ...canvasDefaults(kind), ...props } });
/** The small Rotativa of the issue: the forecast and the next hours, taking turns. */
const nest = (cards = null, extra = {}) => ({
  id: 'cv_nst00001', kind: 'rotator',
  props: { everySec: 8, dots: false, cards: cards ?? [card('cv_wx000001', 'weather.forecast'), card('cv_wx000002', 'weather.hourly')] },
  ...extra,
});
const group = (members = null, extra = {}) => ({
  id: 'cv_grp00001', kind: 'group',
  props: { dir: 'rows', cards: members ?? [tile('cv_mem00001', 'light.hall'), tile('cv_mem00002', 'lock.front'), nest()] },
  when: on('off'),
  ...extra,
});
const camera = () => ({ id: 'cv_card0001', kind: 'ha.camera', props: { ...canvasDefaults('ha.camera'), entity: 'camera.hall' }, when: on('on') });
const rotator = (cards = null, extra = {}) => ({
  id: 'cv_rot00001', kind: 'rotator', pos: { zone: 'main', x: 0, y: 0, size: 'l', w: 12, h: 12 }, style: defaultItemStyle(),
  props: { ...canvasDefaults('rotator'), cards: cards ?? [camera(), group()] },
  ...extra,
});
const screen = (canvas) => ({ id: 's1', layout: { preset: 'canvas' }, screen: { orientation: 'auto' }, canvas });
const errs = (r) => JSON.stringify(r.c.errors);

test('validation keeps a small Rotativa in a group: its cards with their own props and conditions, its turn and dots', () => {
  const withWhen = nest([card('cv_wx000001', 'weather.forecast'), { ...tile('cv_wx000002', 'sensor.out'), when: on('on', 'binary_sensor.rain') }]);
  const r = run([rotator([camera(), group([tile('cv_mem00001', 'light.hall'), tile('cv_mem00002', 'lock.front'), withWhen])])]);
  assert.deepEqual(r.c.errors, []);
  const n = r.out.items[0].props.cards[1].props.cards[2];
  assert.ok(isNestedRotator(n));
  assert.deepEqual([n.id, n.kind, n.props.everySec, n.props.dots], ['cv_nst00001', 'rotator', 8, false]);
  assert.deepEqual(n.props.cards.map((x) => [x.id, x.kind]), [['cv_wx000001', 'weather.forecast'], ['cv_wx000002', 'ha.tile']]);
  assert.deepEqual(n.props.cards[1].when, on('on', 'binary_sensor.rain'));
  assert.equal('when' in n, false);
  // defaults for its turn and its dots; one card is fine (it shows that one)
  const one = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), { id: 'cv_nst00001', kind: 'rotator', props: { cards: [card('cv_wx000001', 'weather.now')] } }])])]);
  assert.deepEqual(one.c.errors, []);
  const n1 = one.out.items[0].props.cards[1].props.cards[1];
  assert.deepEqual([n1.kind, n1.props.cards.length, n1.props.everySec, n1.props.dots], ['rotator', 1, 10, true]);
  // the cards it shows, in order, in the Rotativa's
  assert.deepEqual(rotatorLeaves(r.out.items[0].props.cards).map((x) => x.kind), ['ha.camera', 'ha.tile', 'ha.tile', 'weather.forecast', 'ha.tile']);
});

test('depth guard: no group and no Rotativa inside a small Rotativa, none outside a group, no condition of its own', () => {
  const g = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest([card('cv_wx000001', 'weather.now'), { id: 'cv_grp00002', kind: 'group', props: { dir: 'rows', cards: [card('cv_x0000001', 'date'), card('cv_x0000002', 'date')] } }])])])]);
  assert.ok(g.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards[1].props.cards[1].kind' && /cannot hold a group/.test(e.m)), errs(g));
  assert.deepEqual(g.out.items[0].props.cards[1].props.cards[1].props.cards.map((x) => x.kind), ['weather.now']);
  const deeper = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest([card('cv_wx000001', 'weather.now'), nest(null, { id: 'cv_nst00002' })])])])]);
  assert.ok(deeper.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards[1].props.cards[1].kind' && /another rotating card/.test(e.m)), errs(deeper));
  assert.deepEqual(rotatorNodes(deeper.out.items[0].props.cards).filter((x) => x.kind === 'rotator').length, 1);
  // a Rotativa straight in a Rotativa's cards (no group) is still refused
  const direct = run([rotator([camera(), nest()])]);
  assert.ok(direct.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].kind' && /not allowed inside a rotating card/.test(e.m)), errs(direct));
  assert.deepEqual(direct.out.items[0].props.cards.map((x) => x.kind), ['ha.camera']);
  // the group has the condition, not the small Rotativa in it
  const own = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest(null, { when: on('on') })])])]);
  assert.ok(own.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards[1].when'), errs(own));
  // too many cards, cards not a list, kinds a Rotativa never takes
  const many = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest(Array.from({ length: ROTATOR_MAX + 1 }, (_, i) => card(`cv_x000000${i}`, 'date')))])])]);
  assert.ok(many.c.errors.some((e) => /too many cards/.test(e.m) && /props\.cards\[1\]\.props\.cards$/.test(e.p)), errs(many));
  assert.equal(many.out.items[0].props.cards[1].props.cards[1].props.cards.length, ROTATOR_MAX);
  const bad = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), { id: 'cv_nst00001', kind: 'rotator', props: { cards: 'x' } }])])]);
  assert.ok(bad.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards[1].props.cards'), errs(bad));
  const nav = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest([card('cv_wx000001', 'weather.now'), { id: 'cv_x0000001', kind: 'nav.button', props: {} }])])])]);
  assert.ok(nav.c.errors.some((e) => /not allowed inside a rotating card/.test(e.m)), errs(nav));
  // a group left with only a small Rotativa (a widget deleted since) stays a group: the small Rotativa keeps all of
  // its cards and the group its condition
  const lone = run([rotator([camera(), group([{ id: 'cv_mem00001', kind: 'widget', props: { widgetId: 'gone' } }, nest()])])]);
  assert.deepEqual(lone.c.errors, []);
  const cd = lone.out.items[0].props.cards[1];
  assert.deepEqual([cd.kind, cd.when, cd.props.cards.map((x) => x.kind)], ['group', on('off'), ['rotator']]);
  assert.ok(cd.props.cards[0].props.cards.length >= 2);
  // and it is saved again as it is
  const again = run(structuredClone(lone.out.items));
  assert.deepEqual(again.c.errors, []);
});

test('ids: the small Rotativa and each of its cards get one, unique on the screen', () => {
  const { out } = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest([card('', 'weather.now'), card('cv_card0001', 'date'), card('cv_wx000003', 'date')], { id: 'cv_mem00001' })])])]);
  const ids = rotatorNodes(out.items[0].props.cards).map((x) => x.id);
  assert.equal(ids.length, 7);
  assert.equal(new Set([out.items[0].id, ...ids]).size, 8);
  assert.ok(ids.every((id) => /^cv_[a-z0-9]{8}$/.test(id)), ids.join());
  assert.ok(ids.includes('cv_wx000003'));
});

test('caps: each card of a small Rotativa counts towards the 48 cards and its kind\'s own cap; its conditions towards the 80 entities', () => {
  // 41 spacers, a Rotativa (1) of a date (1) and a group of a date and a small Rotativa of three: 41 + 1 + 1 + 1 + 3 = 47
  const spacers = (n) => Array.from({ length: n }, (_, i) => ({ id: `cv_d${String(i).padStart(7, '0')}`, kind: 'spacer', pos: { zone: 'main', x: i % 22, y: 14 + Math.floor(i / 22), size: 'xs', w: 1, h: 1 }, props: {} }));
  const dates = (n) => Array.from({ length: n }, (_, i) => card(`cv_x000000${i}`, 'date'));
  const rot = () => rotator([card('cv_card0001', 'date'), group([card('cv_mem00001', 'date'), nest(dates(3))], { when: undefined })]);
  const fits = run([...spacers(42), rot()]);
  assert.deepEqual(fits.c.errors.filter((e) => /too many items/.test(e.m)), []);
  assert.equal(canvasCards(fits.out.items).length, CANVAS_LIMITS.items);
  // one more: the group goes whole
  const full = run([...spacers(43), rot()]);
  assert.ok(full.c.errors.some((e) => /too many items/.test(e.m)), errs(full));
  assert.deepEqual(full.out.items.find((it) => it.kind === 'rotator').props.cards.map((x) => x.kind), ['date']);
  // a kind's own cap (cameras: 4 per screen) counts the cards of a small Rotativa
  const cams = [1, 2, 3].map((i) => ({ id: `cv_c000000${i}`, kind: 'ha.camera', pos: { zone: 'main', x: i * 3, y: 0, size: 'm' }, props: { entity: `camera.c${i}` } }));
  const capped = run([...cams, rotator([card('cv_card0001', 'date'), group([tile('cv_mem00001', 'light.a'), nest([{ id: 'cv_x0000001', kind: 'ha.camera', props: { entity: 'camera.x' } }, { id: 'cv_x0000002', kind: 'ha.camera', props: { entity: 'camera.y' } }])])])]);
  assert.ok(capped.c.errors.some((e) => /too many ha\.camera/.test(e.m)), errs(capped));
  // the small Rotativa does not count as a Rotativa of the screen (4 per screen): only its cards count
  const four = run([1, 2, 3, 4].map((i) => rotator([card(`cv_a000000${i}`, 'date'), group([card(`cv_b000000${i}`, 'date'), nest([card(`cv_e000000${i}`, 'date'), card(`cv_f000000${i}`, 'date')], { id: `cv_n000000${i}` })], { id: `cv_g000000${i}`, when: undefined })], { id: `cv_r000000${i}`, pos: { zone: 'main', x: (i - 1) * 6, y: 0, size: 'l', w: 6, h: 6 } })));
  assert.deepEqual(four.c.errors.filter((e) => /too many/.test(e.m)), []);
  // entities: its cards' and its cards' conditions count (and the feeds read them)
  const ents = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest([tile('cv_x0000001', 'sensor.out'), { ...tile('cv_x0000002', 'sensor.rain'), when: on('on', 'binary_sensor.rain') }])])])]);
  assert.deepEqual(ents.c.errors, []);
  assert.deepEqual(haEntitiesOf(ents.out.items[0]).sort(), ['camera.hall', 'light.a', 'sensor.out', 'sensor.rain']);
  assert.ok(conditionEntities(screen(ents.out)).has('binary_sensor.rain'));
  const scenes = (n) => Array.from({ length: n }, (_, i) => ({
    id: `cv_s${String(i).padStart(7, '0')}`, kind: 'ha.scene', pos: { zone: 'main', x: (i % 4) * 6, y: 12 + Math.floor(i / 4), size: 'w', w: 6, h: 1 },
    props: { buttons: [0, 1, 2, 3, 4, 5].map((b) => ({ entity: `scene.s${i}_${b}`, label: '', icon: '' })) },
  }));
  // 12 scenes (72) + camera, light, sensor.out, sensor.rain, the motion sensor (77) + the rain sensor (78): fits
  const fine = run([...scenes(12), ents.out.items[0]]);
  assert.deepEqual(fine.c.errors.filter((e) => /entities/.test(e.m)), []);
  // 75 scene buttons + the four cards (79) + the motion sensor (80): the rain condition of the small Rotativa's card is
  // one too many, and only that one
  const over = run([...scenes(12), { ...scenes(13)[12], props: { buttons: [0, 1, 2].map((b) => ({ entity: `scene.t_${b}`, label: '', icon: '' })) } }, ents.out.items[0]]);
  const tooMany = over.c.errors.filter((e) => /too many Home Assistant entities/.test(e.m));
  assert.deepEqual(tooMany.map((e) => e.p), ['canvas.items[13].props.cards[1].props.cards[1].props.cards[1].when'], errs(over));
});

test('the box: a small Rotativa needs the largest of its cards\' smallest boxes', () => {
  const plain = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), tile('cv_mem00002', 'light.b'), tile('cv_mem00003', 'light.c')])])]).out.items[0];
  const withNest = run([rotator()]).out.items[0];
  const a = cellRange(kindFor(plain), 'landscape');
  const b = cellRange(kindFor(withNest), 'landscape');
  // in rows: the widest smallest width (the forecast's) and the sum of the heights with the forecast's in place of a tile
  const fc = cellRange('weather.forecast', 'landscape');
  const hr = cellRange('weather.hourly', 'landscape');
  const t = cellRange('ha.tile', 'landscape');
  assert.equal(b.minW, Math.max(cellRange('ha.camera', 'landscape').minW, fc.minW, hr.minW, t.minW));
  assert.equal(b.minH, Math.max(cellRange('ha.camera', 'landscape').minH, t.minH * 2 + Math.max(fc.minH, hr.minH)));
  assert.ok(b.minH >= a.minH && b.minW >= a.minW, JSON.stringify({ a, b }));
});

test('the feeds walk a small Rotativa\'s cards: group, nest, both conditions, aliases, weather places', () => {
  const rain = on('on', 'binary_sensor.rain');
  const { out } = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest([tile('cv_x0000001', 'sensor.out'), { ...tile('cv_x0000002', 'sensor.rain'), when: rain }, card('cv_x0000003', 'weather.now', { place: { name: 'Lake', lat: 46.2, lon: 7.4 } })])])])]);
  const sc = screen(out);
  const cards = canvasCards(out.items);
  const inNest = cards.filter((x) => x.nest === 'cv_nst00001');
  assert.deepEqual(inNest.map((x) => x.id), ['cv_x0000001', 'cv_x0000002', 'cv_x0000003']);
  assert.ok(inNest.every((x) => x.group === 'cv_grp00001' && x.parent === 'cv_rot00001' && x.own?.value === 'off' && x.interactive === false));
  assert.deepEqual(inNest.map((x) => x.inner ?? null), [null, rain, null]);
  // the small Rotativa itself is no card
  assert.equal(cards.some((x) => x.id === 'cv_nst00001' || x.kind === 'group'), false);
  // all clear and no rain: the rain card is skipped; someone moves: the whole group (the small Rotativa's cards too)
  const hidden = (motion, r) => [...conditionHidden(sc, { ha: (e) => (e === MOTION ? motion : r) })].sort();
  assert.deepEqual(hidden('off', 'off'), ['cv_card0001', 'cv_x0000002']);
  assert.deepEqual(hidden('off', 'on'), ['cv_card0001']);
  assert.deepEqual(hidden('on', 'on'), ['cv_mem00001', 'cv_x0000001', 'cv_x0000002', 'cv_x0000003']);
  assert.ok([...aliasesFor(sc).values()].some((a) => a.itemId === 'cv_x0000001' && a.entity === 'sensor.out' && a.interactive === false));
  assert.deepEqual(cardPlaces(out.items).map((p) => p.name), ['Lake']);
});

test('the display gets a small Rotativa projected: its cards like a Rotativa\'s, the source of their conditions only', () => {
  const rain = on('on', 'binary_sensor.rain');
  const base = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest([tile('cv_x0000001', 'sensor.out'), { ...tile('cv_x0000002', 'sensor.rain'), when: rain }])])])]).out;
  const p = projectCanvas(screen(base));
  const n = p.items[0].props.cards[1].props.cards[1];
  assert.deepEqual([n.id, n.kind, n.props.everySec, n.props.dots], ['cv_nst00001', 'rotator', 8, false]);
  assert.ok(typeof n.v === 'string' && n.v);
  assert.deepEqual(n.props.cards.map((x) => [x.id, x.props.entity.a, x.when ?? null]), [['cv_x0000001', 'cv_x0000001:0', null], ['cv_x0000002', 'cv_x0000002:0', { src: 'ha' }]]);
  const json = JSON.stringify(p);
  for (const e of ['sensor.out', 'sensor.rain', 'binary_sensor.rain', MOTION]) assert.ok(!json.includes(e), e);
  // a private screen: placeholders; Home Assistant off: it says so
  const priv = projectCanvas(screen(base), { isPrivate: true });
  assert.deepEqual(priv.items[0].props.cards[1].props.cards[1].props.cards.map((x) => x.disabled), ['privacy', 'privacy']);
  const off = projectCanvas(screen(run([rotator([card('cv_card0001', 'date'), group([card('cv_mem00001', 'date'), nest([tile('cv_x0000001', 'sensor.out'), card('cv_x0000002', 'date')])], { when: undefined })])]).out), { haOff: true });
  assert.equal(off.haOff, true);
  // a new turn is a new hash
  const slow = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest([tile('cv_x0000001', 'sensor.out'), card('cv_x0000002', 'date')], { props: { everySec: 30, cards: [tile('cv_x0000001', 'sensor.out'), card('cv_x0000002', 'date')] } })])])]).out;
  const fast = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest([tile('cv_x0000001', 'sensor.out'), card('cv_x0000002', 'date')], { props: { everySec: 5, cards: [tile('cv_x0000001', 'sensor.out'), card('cv_x0000002', 'date')] } })])])]).out;
  assert.notEqual(projectCanvas(screen(slow)).items[0].props.cards[1].props.cards[1].v, projectCanvas(screen(fast)).items[0].props.cards[1].props.cards[1].v);
});

test('export empties a small Rotativa\'s entities and conditions; import keeps it with new ids, without what the server does not offer', () => {
  const rain = on('on', 'binary_sensor.rain');
  const { out } = run([rotator([camera(), group([tile('cv_mem00001', 'light.a'), nest([{ ...tile('cv_x0000001', 'sensor.out'), when: rain }, card('cv_x0000002', 'date')])])])]);
  const file = exportCanvasFile(out);
  const n = file.canvas.items[0].props.cards[1].props.cards[1];
  assert.deepEqual([n.props.cards[0].props.entity, n.props.cards[0].when.entity], ['', '']);
  assert.ok(!JSON.stringify(file).includes('sensor.out') && !JSON.stringify(file).includes('binary_sensor.rain'));
  const back = readCanvasFile(file, {}, {});
  assert.equal(back.ok, true, JSON.stringify(back));
  const n2 = back.canvas.items[0].props.cards[1].props.cards[1];
  assert.deepEqual([n2.kind, n2.props.cards.map((x) => x.kind), n2.props.everySec], ['rotator', ['ha.tile', 'date'], 8]);
  assert.ok(rotatorNodes(back.canvas.items[0].props.cards).every((x) => /^cv_[a-z0-9]{8}$/.test(x.id) && !['cv_nst00001', 'cv_x0000001', 'cv_x0000002'].includes(x.id)));
  // without Home Assistant: its Home Assistant card goes (and the group's), the rest stays
  const mixed = exportCanvasFile(run([rotator([card('cv_card0001', 'date'), group([card('cv_mem00001', 'date'), nest([tile('cv_x0000001', 'sensor.out'), card('cv_x0000002', 'date'), card('cv_x0000003', 'clock.digital')])], { when: undefined })])]).out);
  const cloud = readCanvasFile(mixed, {}, { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.equal(cloud.ok, true, JSON.stringify(cloud));
  assert.equal(cloud.dropped, 1);
  assert.deepEqual(cloud.canvas.items[0].props.cards[1].props.cards[1].props.cards.map((x) => x.kind), ['date', 'clock.digital']);
});

test('old configs: a Rotativa with groups and no small Rotativa is unchanged by the walkers', () => {
  const old = rotator([camera(), group([tile('cv_mem00001', 'light.a'), tile('cv_mem00002', 'light.b')])]);
  const { c, out } = run([old]);
  assert.deepEqual(c.errors, []);
  assert.deepEqual(rotatorNodes(out.items[0].props.cards).map((x) => x.id), ['cv_card0001', 'cv_grp00001', 'cv_mem00001', 'cv_mem00002']);
  assert.ok(canvasCards(out.items).every((x) => !('nest' in x) && !('inner' in x)));
});
