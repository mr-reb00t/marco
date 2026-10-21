// Issue #19, "Grupo": a card of a Rotativa that is a block of 2 to 4 cards in rows or columns, so a Rotativa can swap
// a space for another (a camera while someone moves, three entity cards while all is clear). The validation keeps
// groups and refuses what does not fit (nesting, too few or too many cards, a condition on a card of a group), ids and
// caps count every card of a group, the Rotativa's box holds the group, the feeds walk the group's cards with the
// group's condition, the display gets aliases and the source only, and exports and imports treat it like the other
// cards. The display side is in display-canvas-rotator-group.test.js, the editor's in builder-model.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_LIMITS, CLOUD_CANVAS_KINDS, GROUP_MAX, canvasCards, canvasDefaults, cellRange, conditionEntities, conditionHidden, conditionKeys, defaultCanvas,
  defaultItemStyle, exportCanvasFile, groupDefaults, haEntitiesOf, isRotatorGroup, kindFor, projectCanvas, readCanvasFile, rotatorLeaves, sanitizeCanvas,
} from '../core/canvasCore.js';
import { aliasesFor, watchedEntities } from '../core/haCore.js';

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
/** The group of three entity cards of the issue, while all is clear. */
const group = (extra = {}, cards = null, dir = 'rows') => ({
  id: 'cv_grp00001', kind: 'group',
  props: { dir, cards: cards ?? [tile('cv_mem00001', 'light.hall'), tile('cv_mem00002', 'lock.front'), tile('cv_mem00003', 'sensor.hall_temp')] },
  when: on('off'),
  ...extra,
});
const camera = () => ({ id: 'cv_card0001', kind: 'ha.camera', props: { ...canvasDefaults('ha.camera'), entity: 'camera.hall' }, when: on('on') });
/** A Rotativa of 3×3 cells: the camera when someone moves, the group while all is clear. */
const rotator = (cards = null, extra = {}) => ({
  id: 'cv_rot00001', kind: 'rotator', pos: { zone: 'main', x: 0, y: 0, size: 'm', w: 3, h: 3 }, style: defaultItemStyle(),
  props: { ...canvasDefaults('rotator'), cards: cards ?? [camera(), group()] },
  ...extra,
});
const screen = (canvas) => ({ id: 's1', layout: { preset: 'canvas' }, screen: { orientation: 'auto' }, canvas });

test('validation keeps a group: its cards in order with their own props, rows by default, the condition on the group', () => {
  const { c, out } = run([rotator()]);
  assert.deepEqual(c.errors, []);
  const [cam, g] = out.items[0].props.cards;
  assert.equal(cam.kind, 'ha.camera');
  assert.ok(isRotatorGroup(g));
  assert.deepEqual([g.id, g.props.dir, g.when], ['cv_grp00001', 'rows', on('off')]);
  assert.deepEqual(g.props.cards.map((m) => [m.id, m.kind, m.props.entity, 'when' in m]), [
    ['cv_mem00001', 'ha.tile', 'light.hall', false], ['cv_mem00002', 'ha.tile', 'lock.front', false], ['cv_mem00003', 'ha.tile', 'sensor.hall_temp', false],
  ]);
  // each card's props through its own kind (a name too long is cut, like on its own)
  const long = run([rotator([camera(), group({}, [{ ...tile('cv_mem00001', 'light.a'), props: { entity: 'light.a', name: 'x'.repeat(60) } }, tile('cv_mem00002', 'light.b')])])]);
  assert.ok(long.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards[0].props.name'), JSON.stringify(long.c.errors));
  // columns, and a group with no condition (it shows always, taking turns)
  const cols = run([rotator([camera(), group({ when: undefined }, null, 'cols')])]);
  assert.deepEqual(cols.c.errors, []);
  assert.equal(cols.out.items[0].props.cards[1].props.dir, 'cols');
  assert.equal(cols.out.items[0].props.cards[1].when, undefined);
  // the editor's new group: three entity cards in rows
  const d = groupDefaults();
  assert.deepEqual([d.kind, d.props.dir, d.props.cards.map((m) => m.kind)], ['group', 'rows', ['ha.tile', 'ha.tile', 'ha.tile']]);
});

test('validation refuses what a group may not hold: another group, a condition on one of its cards, too few or too many, a wrong direction', () => {
  const nested = run([rotator([camera(), group({}, [tile('cv_mem00001', 'light.a'), tile('cv_mem00002', 'light.b'), group({ id: 'cv_grp00002' })])])]);
  assert.ok(nested.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards[2].kind' && /another group/.test(e.m)), JSON.stringify(nested.c.errors));
  assert.equal(nested.out.items[0].props.cards[1].props.cards.length, 2);
  // a group never goes on the grid on its own, nor inside the cards of a group as a kind
  const alone = run([{ id: 'cv_grp00001', kind: 'group', pos: { zone: 'main', x: 0, y: 0, size: 'm' }, props: group().props }]);
  assert.deepEqual(alone.out.items, []);
  // only the group has a condition
  const own = run([rotator([camera(), group({}, [{ ...tile('cv_mem00001', 'light.a'), when: on('on') }, tile('cv_mem00002', 'light.b')])])]);
  assert.ok(own.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards[0].when'), JSON.stringify(own.c.errors));
  assert.equal('when' in own.out.items[0].props.cards[1].props.cards[0], false);
  // 2 to 4 cards
  const one = run([rotator([camera(), group({}, [tile('cv_mem00001', 'light.a')])])]);
  assert.ok(one.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards'), JSON.stringify(one.c.errors));
  const five = run([rotator([camera(), group({}, [1, 2, 3, 4, 5].map((i) => tile(`cv_mem0000${i}`, `light.l${i}`)))])]);
  assert.ok(five.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards' && /2 to 4/.test(e.m)), JSON.stringify(five.c.errors));
  assert.equal(five.out.items[0].props.cards[1].props.cards.length, GROUP_MAX);
  const dir = run([rotator([camera(), group({}, null, 'diagonal')])]);
  assert.ok(dir.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.dir'), JSON.stringify(dir.c.errors));
  assert.equal(dir.out.items[0].props.cards[1].props.dir, 'rows');
  const notList = run([rotator([camera(), { id: 'cv_grp00001', kind: 'group', props: { dir: 'rows', cards: 'all' } }])]);
  assert.ok(notList.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards'), JSON.stringify(notList.c.errors));
  assert.equal(notList.out.items[0].props.cards.length, 1);
  // the kinds a Rotativa never takes are refused inside a group too, and so are the ones this server does not offer
  const nav = run([rotator([camera(), group({}, [tile('cv_mem00001', 'light.a'), { id: 'cv_mem00002', kind: 'nav.button', props: {} }])])]);
  assert.ok(nav.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].props.cards[1].kind'), JSON.stringify(nav.c.errors));
  const cloud = run([rotator([{ id: 'cv_card0001', kind: 'date', props: canvasDefaults('date') }, group({ when: undefined })])], { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.ok(cloud.c.errors.some((e) => /not available on this server/.test(e.m) && e.p.startsWith('canvas.items[0].props.cards[1].props.cards[')), JSON.stringify(cloud.c.errors));
});

test('a group left with one card (a widget deleted since) is that card with the group\'s condition; with none it goes', () => {
  const w = (id) => ({ id, kind: 'widget', props: { widgetId: 'w_gone' } });
  const one = run([rotator([camera(), group({}, [tile('cv_mem00001', 'light.a'), w('cv_mem00002')])])]);
  assert.deepEqual(one.c.errors, []);
  const cd = one.out.items[0].props.cards[1];
  assert.deepEqual([cd.kind, cd.id, cd.when], ['ha.tile', 'cv_mem00001', on('off')]);
  const none = run([rotator([camera(), group({}, [w('cv_mem00001'), w('cv_mem00002')])])]);
  assert.deepEqual(none.out.items[0].props.cards.map((x) => x.kind), ['ha.camera']);
});

test('ids: the group and each of its cards get one, unique on the screen; repeated or wrong ones are made new', () => {
  const { out } = run([rotator([camera(), group({ id: 'cv_card0001' }, [tile('cv_rot00001', 'light.a'), tile('bad', 'light.b'), tile('cv_mem00003', 'light.c')])])]);
  const g = out.items[0].props.cards[1];
  const ids = [out.items[0].id, out.items[0].props.cards[0].id, g.id, ...g.props.cards.map((m) => m.id)];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^cv_[a-z0-9]{8}$/.test(id)), ids.join());
  assert.equal(g.props.cards[2].id, 'cv_mem00003');
});

test('caps: every card of a group counts towards the 48 cards and its kind\'s own cap; its entities and its condition towards the 80', () => {
  // 44 spacers and a Rotativa of a date and a group of three: 44 + 1 + 1 + 3 = 49, one too many, so the group goes whole
  const dates = Array.from({ length: 44 }, (_, i) => ({ id: `cv_d${String(i).padStart(7, '0')}`, kind: 'spacer', pos: { zone: 'main', x: i % 22, y: 10 + Math.floor(i / 22), size: 'xs', w: 1, h: 1 }, props: {} }));
  const full = run([...dates, rotator([{ id: 'cv_card0001', kind: 'date', props: {} }, group({ when: undefined }, [1, 2, 3].map((i) => ({ id: `cv_mem0000${i}`, kind: 'date', props: {} })))])]);
  assert.ok(full.c.errors.some((e) => /too many items/.test(e.m)), JSON.stringify(full.c.errors.slice(0, 3)));
  const rot = full.out.items.find((it) => it.kind === 'rotator');
  assert.deepEqual(rot?.props.cards.map((x) => x.kind), ['date']);
  // with one spacer less it fits: 48 cards
  const fits = run([...dates.slice(1), rotator([{ id: 'cv_card0001', kind: 'date', props: {} }, group({ when: undefined }, [1, 2, 3].map((i) => ({ id: `cv_mem0000${i}`, kind: 'date', props: {} })))])]);
  assert.deepEqual(fits.c.errors.filter((e) => /too many items/.test(e.m)), []);
  assert.equal(canvasCards(fits.out.items).length, CANVAS_LIMITS.items);
  // a kind's own cap (the html card: 3 per screen) counts the cards of a group
  const htmls = [1, 2].map((i) => ({ id: `cv_h000000${i}`, kind: 'html', pos: { zone: 'main', x: 0, y: 0, size: 'm' }, props: {} }));
  const capped = run([...htmls, rotator([camera(), group({}, [tile('cv_mem00001', 'light.a'), { id: 'cv_mem00002', kind: 'html', props: {} }, { id: 'cv_mem00003', kind: 'html', props: {} }])])]);
  assert.ok(capped.c.errors.some((e) => /too many html/.test(e.m)), JSON.stringify(capped.c.errors));
  // the 80 entities: scenes of six buttons, then the camera, the group's three and the motion sensor (5 more)
  const scenes = (n) => Array.from({ length: n }, (_, i) => ({
    id: `cv_s${String(i).padStart(7, '0')}`, kind: 'ha.scene', pos: { zone: 'main', x: (i % 4) * 6, y: 4 + Math.floor(i / 4), size: 'w', w: 6, h: 1 },
    props: { buttons: [0, 1, 2, 3, 4, 5].map((b) => ({ entity: `scene.s${i}_${b}`, label: '', icon: '' })) },
  }));
  const ents = run([...scenes(12), rotator()]);
  assert.deepEqual(ents.c.errors.filter((e) => /entities/.test(e.m)), []);
  assert.deepEqual(haEntitiesOf(ents.out.items.find((it) => it.kind === 'rotator')).sort(), ['camera.hall', 'light.hall', 'lock.front', 'sensor.hall_temp']);
  const over = run([...scenes(13), rotator()]);
  assert.ok(over.c.errors.some((e) => /too many Home Assistant entities/.test(e.m)), JSON.stringify(over.c.errors.slice(0, 2)));
});

test('the box of a Rotativa holds its groups: rows add up the heights, columns the widths', () => {
  const rows = run([rotator()]).out.items[0];
  // a camera (3×2 at its smallest) and three entity cards in rows (2×1 each): 3×3
  const r = cellRange(kindFor(rows), 'landscape');
  assert.deepEqual([r.minW, r.minH], [3, 3]);
  const cols = run([rotator([camera(), group({}, null, 'cols')], { pos: { zone: 'main', x: 0, y: 0, size: 'w', w: 6, h: 2 } })]).out.items[0];
  const c = cellRange(kindFor(cols), 'landscape');
  assert.deepEqual([c.minW, c.minH], [6, 2]);
  // a box saved smaller than that grows to it
  const small = run([rotator(null, { pos: { zone: 'main', x: 0, y: 0, size: 'xs', w: 3, h: 2 } })]).out.items[0];
  assert.ok(small.pos.h >= 3 && small.pos.w >= 3, JSON.stringify(small.pos));
  // the cards a Rotativa shows: the camera and the group's three
  assert.deepEqual(rotatorLeaves(rows.props.cards).map((x) => x.kind), ['ha.camera', 'ha.tile', 'ha.tile', 'ha.tile']);
});

test('the feeds walk the cards of a group with its condition: entities, hidden list, aliases, never controls', () => {
  const { out } = run([rotator()]);
  const sc = screen(out);
  const cards = canvasCards(out.items);
  const mem = cards.filter((x) => x.group === 'cv_grp00001');
  assert.deepEqual(mem.map((x) => x.id), ['cv_mem00001', 'cv_mem00002', 'cv_mem00003']);
  assert.ok(mem.every((x) => x.parent === 'cv_rot00001' && x.interactive === false && x.own?.value === 'off'));
  // the group itself is no card
  assert.equal(cards.some((x) => x.kind === 'group' || x.id === 'cv_grp00001'), false);
  assert.ok(conditionEntities(sc).has(MOTION));
  assert.ok(watchedEntities({ screens: [sc] }).has(MOTION));
  assert.ok(watchedEntities({ screens: [sc] }).has('lock.front'));
  // someone moves: the group's three cards are hidden, the camera shows; all clear: the other way round
  assert.deepEqual([...conditionHidden(sc, { ha: () => 'on' })].sort(), ['cv_mem00001', 'cv_mem00002', 'cv_mem00003']);
  assert.deepEqual([...conditionHidden(sc, { ha: () => 'off' })], ['cv_card0001']);
  // the cards of a group have aliases of their own and are never touch controls
  const al = [...aliasesFor(sc).values()].filter((a) => a.itemId.startsWith('cv_mem'));
  assert.equal(al.length, 3);
  assert.ok(al.every((a) => a.interactive === false));
  // a value condition on a group (Marco Cloud: no Home Assistant): its key is followed
  const v = run([rotator([{ id: 'cv_card0001', kind: 'date', props: {} }, group({ when: { src: 'value', key: 'washer', op: 'eq', value: 'done' } }, [{ id: 'cv_mem00001', kind: 'date', props: {} }, { id: 'cv_mem00002', kind: 'clock.digital', props: {} }])])], { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.deepEqual(v.c.errors, []);
  assert.deepEqual([...conditionKeys(screen(v.out))], ['washer']);
  // a Home Assistant condition on a group where there is none: refused
  const ha = run([rotator([{ id: 'cv_card0001', kind: 'date', props: {} }, group({}, [{ id: 'cv_mem00001', kind: 'date', props: {} }, { id: 'cv_mem00002', kind: 'clock.digital', props: {} }])])], { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.ok(ha.c.errors.some((e) => e.p === 'canvas.items[0].props.cards[1].when.src'), JSON.stringify(ha.c.errors));
});

test('the display gets a group with its cards projected like the others: aliases, no entity ids, the source of its condition only', () => {
  const { out } = run([rotator()]);
  const p = projectCanvas(screen(out));
  const g = p.items[0].props.cards[1];
  assert.deepEqual([g.id, g.kind, g.props.dir, g.when], ['cv_grp00001', 'group', 'rows', { src: 'ha' }]);
  assert.ok(typeof g.v === 'string' && g.v);
  assert.deepEqual(g.props.cards.map((m) => m.props.entity.a), ['cv_mem00001:0', 'cv_mem00002:0', 'cv_mem00003:0']);
  assert.ok(g.props.cards.every((m) => !('when' in m) && typeof m.v === 'string'));
  const json = JSON.stringify(p);
  for (const e of [MOTION, 'light.hall', 'lock.front', 'sensor.hall_temp', 'camera.hall']) assert.ok(!json.includes(e), e);
  // the cards of a group the display may not show are placeholders (a private screen: privacy)
  const priv = projectCanvas(screen(out), { isPrivate: true });
  assert.deepEqual(priv.items[0].props.cards[1].props.cards.map((m) => [m.disabled, Object.keys(m.props).length]), [['privacy', 0], ['privacy', 0], ['privacy', 0]]);
  // a new direction is a new hash
  const cols = projectCanvas(screen(run([rotator([camera(), group({}, null, 'cols')])]).out));
  assert.notEqual(cols.items[0].props.cards[1].v, g.v);
  // Home Assistant off: a Rotativa with Home Assistant cards in a group says so
  const off = projectCanvas(screen(run([rotator([{ id: 'cv_card0001', kind: 'date', props: {} }, group()])]).out), { haOff: true });
  assert.equal(off.haOff, true);
});

test('export empties the entities of a group\'s cards and its condition; import gives new ids and leaves out what the server does not offer', () => {
  const { out } = run([rotator()]);
  const file = exportCanvasFile(out);
  const g = file.canvas.items[0].props.cards[1];
  assert.deepEqual(g.props.cards.map((m) => m.props.entity), ['', '', '']);
  assert.equal(g.when.entity, '');
  assert.deepEqual(file.picks.cv_rot00001, ['entities']);
  assert.ok(!JSON.stringify(file).includes('light.hall'));
  const back = readCanvasFile(file, {}, {});
  assert.equal(back.ok, true);
  const g2 = back.canvas.items[0].props.cards[1];
  assert.equal(g2.kind, 'group');
  assert.equal(g2.props.cards.length, 3);
  assert.ok(g2.props.cards.every((m) => m.id && !['cv_mem00001', 'cv_mem00002', 'cv_mem00003'].includes(m.id)));
  // on a server without Home Assistant: the group's Home Assistant cards and its condition are left out
  const mixed = exportCanvasFile(run([rotator([{ id: 'cv_card0001', kind: 'date', props: {} }, group({}, [tile('cv_mem00001', 'light.a'), { id: 'cv_mem00002', kind: 'date', props: {} }, { id: 'cv_mem00003', kind: 'clock.digital', props: {} }])])]).out);
  const cloud = readCanvasFile(mixed, {}, { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.equal(cloud.ok, true, JSON.stringify(cloud));
  assert.equal(cloud.dropped, 1);
  assert.equal(cloud.conditions, 1);
  const g3 = cloud.canvas.items[0].props.cards[1];
  assert.deepEqual([g3.kind, g3.props.cards.map((m) => m.kind), g3.when], ['group', ['date', 'clock.digital'], undefined]);
  // a group left with one card is that card; a condition written on a card of a group is left out
  const one = exportCanvasFile(run([rotator([{ id: 'cv_card0001', kind: 'date', props: {} }, group({ when: { src: 'value', key: 'k', op: 'eq', value: '1' } }, [tile('cv_mem00001', 'light.a'), { id: 'cv_mem00002', kind: 'date', props: {} }])])]).out);
  one.canvas.items[0].props.cards[1].props.cards[1].when = { src: 'value', key: 'x', op: 'eq', value: '1' };
  const r1 = readCanvasFile(one, {}, { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.deepEqual([r1.canvas.items[0].props.cards[1].kind, r1.canvas.items[0].props.cards[1].when?.key], ['date', 'k']);
});
