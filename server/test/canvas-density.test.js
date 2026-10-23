// Personalizado, issue #9: the grid of 24×16 cells (the fine grid, the only one since 0.17), "Densidad" (compact)
// and the "Rotativa" (one slot that shows its cards one after another). The model (canvasCore.js): ranges and sizes
// (twice the cells of the old 12×8 grid, smaller boxes for the compact look), validation and limits, and every data
// path of a Rotativa's cards (Home Assistant aliases, values, data cards, widgets, conditions, schedules, privacy,
// export). The builder's operations (model.ts) too. Screens of the old grid: canvas-legacy-grid.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import {
  CANVAS_GRID, CANVAS_KINDS, CANVAS_LIMITS, CANVAS_LIMITS_FINE, canvasLimits, CANVAS_SIZE_IDS, CLOUD_CANVAS_KINDS, DEFAULT_CANVAS_KINDS, LEGACY_GRID, ROTATOR_MAX, boxAllowed, boxOf, canvasCards,
  canvasDataItems, canvasDefaults, canvasEventsNeed, canvasFromTemplate, canvasWidgetIds, cellRange, conditionHidden, defaultCanvas, defaultItemStyle,
  exportCanvasFile, fitsAt, fullLookMin, gridDims, itemAliases, kindFor, makeOccupancy, occupy, posCells, projectCanvas, readCanvasFile, rotatorKindOk, sanitizeCanvas,
  scheduleHidden, sizeCells,
} from '../core/canvasCore.js';
import { aliasesFor, watchedEntities } from '../core/haCore.js';
import { screenValueKeys } from '../core/valuesCore.js';

nodeModule.registerHooks?.({
  resolve(specifier, context, next) {
    if (/^\.\.?\/[^.]*$/.test(specifier) && context.parentURL?.includes('/web/')) {
      try { return next(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return next(specifier, context);
  },
});
const load = async (p) => {
  try {
    return await import(p);
  } catch {
    return null;
  }
};
const M = await load('../../web/admin/builder/model.ts');
const G = await load('../../web/admin/builder/geometry.ts');
const ts = { skip: M && G ? false : 'TypeScript imports need Node >= 22.18' };

const collector = () => {
  const errors = [];
  const warnings = [];
  return { errors, warnings, err: (p, m) => errors.push({ p, m }), warn: (p, m) => warnings.push({ p, m }) };
};
const clean = (raw, opts = {}, refs = {}) => {
  const c = collector();
  const cv = sanitizeCanvas(c, 'canvas', raw, refs, opts);
  return { cv, errors: c.errors, warnings: c.warnings };
};
const B = (x, y, w, h) => ({ zone: 'main', x, y, size: 'm', w, h });
const item = (id, kind, pos, props = {}, extra = {}) => ({ id, kind, pos, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra });
const screen = (canvas, extra = {}) => ({ id: 's1', layout: { preset: 'canvas' }, screen: { orientation: 'auto' }, canvas, ...extra });

/** True when no two main items share a cell on `o` (positions under `key`). */
function noOverlap(cv, key = 'pos', o = 'landscape') {
  const occ = makeOccupancy(o);
  for (const it of cv.items) {
    const p = it[key];
    if (p?.zone !== 'main') continue;
    const [w, h] = posCells(p, o);
    if (!fitsAt(occ, p.x, p.y, w, h)) return false;
    occupy(occ, it.id, p.x, p.y, w, h);
  }
  return true;
}

// ---- the grid ---------------------------------------------------------------------------------------------------

test('the grid: 24×16 cells (16×24 portrait), every named size and range twice the old cells, and smaller line cards', () => {
  assert.deepEqual(CANVAS_GRID, { landscape: { cols: 24, rows: 16 }, portrait: { cols: 16, rows: 24 } });
  assert.deepEqual(LEGACY_GRID, { landscape: { cols: 12, rows: 8 }, portrait: { cols: 8, rows: 12 } }, 'the old grid, only read to convert');
  assert.deepEqual(gridDims('landscape'), { cols: 24, rows: 16 });
  assert.deepEqual(gridDims('portrait'), { cols: 16, rows: 24 });
  for (const s of CANVAS_SIZE_IDS) {
    for (const o of ['landscape', 'portrait']) assert.deepEqual(sizeCells(s, o), sizeCells(s, o, 'normal').map((n) => n * 2), `${s} ${o}`);
  }
  for (const kind of Object.keys(CANVAS_KINDS)) {
    for (const o of ['landscape', 'portrait']) {
      const n = cellRange(kind, o, 'normal');
      const f = cellRange(kind, o);
      assert.equal(f.maxW, Math.min(n.maxW * 2, gridDims(o).cols), `${kind} ${o} maxW`);
      assert.equal(f.maxH, Math.min(n.maxH * 2, gridDims(o).rows), `${kind} ${o} maxH`);
      // never larger than twice the old minimum (every box of a converted screen is allowed), and the full look
      // from there on (fullLookMin)
      assert.ok(f.minW <= n.minW * 2 && f.minH <= n.minH * 2, `${kind} ${o} min`);
      assert.deepEqual(fullLookMin(kind, o), [n.minW * 2, n.minH * 2], `${kind} ${o} full look`);
      if (!CANVAS_KINDS[kind].fine) assert.deepEqual([f.minW, f.minH], [n.minW * 2, n.minH * 2], `${kind} ${o}: twice the old minimum`);
      // every named size of the kind is a legal box
      for (const s of CANVAS_KINDS[kind].sizes) assert.ok(boxAllowed(kind, ...sizeCells(s, o), o), `${kind} ${s} ${o}`);
    }
  }
  // the line cards (Entidad, Interruptor, Sensor, Luz, Clima, Persiana) one row high and down to two cells wide (#9),
  // still readable (browser sweep)
  for (const kind of ['ha.tile', 'ha.switch', 'ha.sensor', 'ha.light', 'ha.climate', 'ha.cover']) {
    assert.ok(boxAllowed(kind, 4, 1), `${kind} 4×1`);
    assert.ok(boxAllowed(kind, 2, 1), `${kind} 2×1`);
    assert.equal(boxAllowed(kind, 1, 1), false, `${kind} 1×1 is too narrow`);
    if (kind !== 'ha.cover') assert.ok(boxAllowed(kind, 4, 2), `${kind} 4×2 (the old 2×1) as before`);
  }
  // the Indicador one row high from two cells wide (#9): its number and the bar, the name beside it when it fits (browser test)
  assert.ok(boxAllowed('ha.gauge', 2, 1) && boxAllowed('ha.gauge', 2, 2) && boxAllowed('ha.gauge', 3, 1) && boxAllowed('ha.gauge', 4, 1));
  assert.equal(boxAllowed('ha.gauge', 1, 1), false, 'ha.gauge 1×1 is too narrow');
  assert.deepEqual(fullLookMin('ha.gauge'), [4, 4], 'its full look from 4×4, as before');
  // a box exactly a named size is stored as the name
  assert.deepEqual(boxOf('todo', 6, 8), { size: 't' });
  assert.deepEqual(boxOf('ha.tile', 4, 1), { size: 'row', w: 4, h: 1 });
  assert.deepEqual(boxOf('ha.tile', 1, 1), { size: 'row', w: 2, h: 1 }, 'clamped to the minimum');
  assert.deepEqual(posCells({ size: 'm' }), [8, 6]);
});

test('settings: every canvas is on the grid ("fine"), the density is kept only when chosen, and wrong values are errors', () => {
  const before = canvasFromTemplate('bento');
  assert.equal(before.grid, 'fine');
  assert.equal('density' in before, false);
  const again = clean(structuredClone(before));
  assert.deepEqual(again.cv, before, 'a saved screen validates to the same thing');
  assert.deepEqual(again.errors, []);
  const f = clean({ ...defaultCanvas(), density: 'compact' });
  assert.equal(f.cv.grid, 'fine');
  assert.equal(f.cv.density, 'compact');
  const n = clean({ ...defaultCanvas(), density: 'normal' });
  assert.equal(n.cv.grid, 'fine');
  assert.equal('density' in n.cv, false, 'the default is not stored');
  const bad = clean({ ...defaultCanvas(), density: 'tiny' });
  assert.deepEqual(bad.errors.map((e) => e.p), ['canvas.density']);
  // grid: anything but 'fine' is a screen of the old grid, converted (canvas-legacy-grid.test.js), never an error
  const old = clean({ ...defaultCanvas(), grid: 'huge', items: [item('cv_aaaaaaa1', 'date', B(1, 1, 3, 2))] });
  assert.deepEqual(old.errors, []);
  assert.deepEqual([old.cv.grid, old.cv.items[0].pos], ['fine', { zone: 'main', x: 2, y: 2, size: 's' }]);
  // a box of up to 24 cells is read
  const big = clean({ ...defaultCanvas(), items: [item('cv_aaaaaaa1', 'calendar.month', B(0, 0, 24, 16))] });
  assert.deepEqual(big.errors, []);
  assert.deepEqual(big.cv.items[0].pos, { zone: 'main', x: 0, y: 0, size: 'full' });
  // a box only this grid has stays
  const tile = clean({ ...defaultCanvas(), items: [item('cv_aaaaaaa1', 'ha.tile', B(0, 0, 4, 1), { entity: 'light.a' })] });
  assert.deepEqual(tile.cv.items[0].pos, { zone: 'main', x: 0, y: 0, size: 'row', w: 4, h: 1 });
  // the projection carries both
  const p = projectCanvas(screen(f.cv));
  assert.equal(p.grid, 'fine');
  assert.equal(p.density, 'compact');
  assert.equal(projectCanvas(screen(before)).grid, 'fine');
});

// ---- the Rotativa -------------------------------------------------------------------------------------------------

const rot = (id, cards, props = {}, extra = {}) => item(id, 'rotator', B(0, 0, 12, 6), { cards, ...props }, extra);
const card = (id, kind, props = {}) => ({ id, kind, props: { ...canvasDefaults(kind), ...props } });

test('rotativa: its defaults validate, its cards get ids of their own, a range its cards allow, and what cannot go inside', () => {
  assert.ok(DEFAULT_CANVAS_KINDS.includes('rotator') && CLOUD_CANVAS_KINDS.includes('rotator'), 'every edition');
  assert.equal(CANVAS_KINDS.rotator.cat, 'content');
  const d = canvasDefaults('rotator');
  assert.deepEqual(d.cards.map((c) => c.kind), ['weather.forecast', 'weather.hourly']);
  assert.equal(d.everySec, 10);
  assert.equal(d.dots, true);
  const a = clean({ ...defaultCanvas(), items: [{ ...rot('cv_rrrrrrr1', d.cards), pos: { zone: 'main', x: 0, y: 0, size: 'w' } }] });
  assert.deepEqual(a.errors, []);
  const cards = a.cv.items[0].props.cards;
  assert.equal(cards.length, 2);
  assert.ok(cards.every((c) => /^cv_[a-z0-9]{8}$/.test(c.id)));
  assert.notEqual(cards[0].id, cards[1].id);
  // ids that clash with an item or with each other get new ones
  const clash = clean({ ...defaultCanvas(), items: [item('cv_xxxxxxx1', 'clock.digital', B(12, 0, 8, 6)), rot('cv_rrrrrrr1', [card('cv_xxxxxxx1', 'date'), card('cv_rrrrrrr1', 'date'), card('cv_ccccccc1', 'date'), card('cv_ccccccc1', 'date')])] });
  const ids = canvasCards(clash.cv.items).map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'every card id is unique on the screen');
  assert.ok(ids.includes('cv_ccccccc1'));
  // "Cambiar cada": 5 to 120 seconds; the dots a boolean
  const t = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', d.cards, { everySec: 2 }), rot('cv_rrrrrrr2', d.cards, { everySec: 999 }, { pos: B(12, 0, 12, 6) })] });
  assert.deepEqual(t.cv.items.map((x) => x.props.everySec), [5, 120]);
  // never inside: another Rotativa, the spacer, the heading, the navigation cards
  for (const k of ['rotator', 'spacer', 'heading', 'nav.button', 'nav.pause', 'nav.progress', 'card']) assert.equal(rotatorKindOk(k), false, k);
  for (const k of ['weather.hourly', 'calendar.agenda', 'ha.sensor', 'market', 'photo', 'widget', 'value']) assert.equal(rotatorKindOk(k), true, k);
  const nested = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', [card('', 'date'), { id: '', kind: 'rotator', props: d }, card('', 'nav.button')])] });
  assert.equal(nested.errors.filter((e) => /not allowed inside a rotating card/.test(e.m)).length, 2);
  assert.deepEqual(nested.cv.items[0].props.cards.map((c) => c.kind), ['date']);
  // at most six cards
  const many = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', Array.from({ length: ROTATOR_MAX + 2 }, () => card('', 'date')))] });
  assert.ok(many.errors.some((e) => /too many cards/.test(e.m)));
  assert.equal(many.cv.items[0].props.cards.length, ROTATOR_MAX);
  // each card validated by its own kind
  const own = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', [card('', 'weather.forecast', { days: 99 }), card('', 'value', { key: 'BAD KEY' })])] });
  assert.equal(own.cv.items[0].props.cards[0].props.days, 7);
  assert.ok(own.errors.some((e) => /cards\[1\]\.props\.key/.test(e.p)));
  // a camera inside shows pictures; a deleted widget's card goes quietly
  const cam = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', [card('', 'ha.camera', { entity: 'camera.door', mode: 'live' }), card('', 'widget', { widgetId: 'gone' }), card('', 'widget', { widgetId: 'w1' })])] }, {}, { widgets: new Map([['w1', {}]]) });
  assert.deepEqual(cam.cv.items[0].props.cards.map((c) => [c.kind, c.props.mode ?? c.props.widgetId]), [['ha.camera', 'snapshot'], ['widget', 'w1']]);
  // its range: what every one of its cards allows too (the largest of their minimums, the hourly strip's 8×2; its
  // full look from 12×4, the hourly forecast's)
  const k = kindFor({ kind: 'rotator', props: d });
  assert.deepEqual([cellRange(k).minW, cellRange(k).minH], [8, 2]);
  assert.deepEqual(fullLookMin(k), [12, 4]);
  assert.deepEqual(cellRange(kindFor({ kind: 'rotator', props: { cards: [] } })), cellRange('rotator'), 'no cards: the kind itself');
  // so a box too small for its cards is grown on save
  const small = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', d.cards, {}, { pos: B(0, 0, 3, 2) })] });
  assert.deepEqual(posCells(small.cv.items[0].pos, 'landscape'), [8, 2]);
  // a light and a camera (#19): down to the camera's 3×2 and up to the whole screen, starting as small as the light
  const lc = kindFor({ kind: 'rotator', props: { cards: [card('', 'ha.tile'), card('', 'ha.camera')] } });
  assert.deepEqual(cellRange(lc), { minW: 3, minH: 2, maxW: 24, maxH: 16 });
  assert.equal(lc.def, 'xs');
  // a sensor and a gauge: one row high and two cells wide (the gauge's 2×1, as the sensor's)
  const sg = kindFor({ kind: 'rotator', props: { cards: [card('', 'ha.sensor'), card('', 'ha.gauge')] } });
  assert.deepEqual([cellRange(sg).minW, cellRange(sg).minH], [2, 1]);
  // such a small box is kept on save
  const tiny = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', [card('', 'ha.tile'), card('', 'ha.camera')], {}, { pos: B(0, 0, 4, 2) })] });
  assert.deepEqual(posCells(tiny.cv.items[0].pos, 'landscape'), [4, 2]);
});

test('rotativa: its cards count towards the cap of cards, the cap of each kind and the Home Assistant entities', () => {
  // 46 items and a Rotativa of three cards: 50 cards, two left out
  const items = Array.from({ length: 46 }, (_, i) => item(`cv_ddddd${String(i).padStart(3, '0')}`, 'spacer', B(i % 24, Math.floor(i / 24), 1, 1)));
  const a = clean({ ...defaultCanvas(), items: [...items, rot('cv_rrrrrrr1', [card('', 'date'), card('', 'date'), card('', 'date')], {}, { pos: B(0, 4, 12, 6) })] });
  assert.ok(a.errors.some((e) => /too many items \(max 48\)/.test(e.m)));
  assert.equal(canvasCards(a.cv.items).length, CANVAS_LIMITS.items);
  assert.equal(a.cv.items.at(-1).props.cards.length, 1);
  // two photo cards already: a third inside a Rotativa is one too many
  const ph = clean({ ...defaultCanvas(), items: [item('cv_ppppppp1', 'photo', B(0, 0, 6, 4)), item('cv_ppppppp2', 'photo', B(6, 0, 6, 4)), rot('cv_rrrrrrr1', [card('', 'photo'), card('', 'date')], {}, { pos: B(0, 6, 12, 6) })] });
  assert.ok(ph.errors.some((e) => /too many photo/.test(e.m)));
  assert.deepEqual(ph.cv.items[2].props.cards.map((c) => c.kind), ['date']);
  // the entities of its cards count towards the 80 of a screen: 79 and two more, one too many
  const sensors = Array.from({ length: 79 }, (_, i) => ({ entity: `sensor.s${i}`, name: '', interactive: false }));
  const rooms = Array.from({ length: 14 }, (_, i) => item(`cv_eeeee${String(i).padStart(3, '0')}`, 'ha.room', B((i % 4) * 6, Math.floor(i / 4) * 3, 6, 3), { rows: sensors.slice(i * 6, i * 6 + 6) }));
  const e = clean({ ...defaultCanvas(), items: [...rooms, rot('cv_rrrrrrr1', [card('', 'ha.sensor', { entity: 'sensor.x1' }), card('', 'ha.sensor', { entity: 'sensor.x2' })], {}, { pos: B(12, 12, 12, 4) })] });
  assert.ok(e.errors.some((x) => /too many Home Assistant entities \(max 80\)/.test(x.m)), JSON.stringify(e.errors));
});

test('rotativa on Marco Cloud: no Home Assistant card inside, and the file import leaves them out', () => {
  const opts = { canvasKinds: CLOUD_CANVAS_KINDS, haControls: false, cameraLive: false };
  const r = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', [card('', 'ha.sensor', { entity: 'sensor.t' }), card('', 'date'), card('', 'html')])] }, opts);
  assert.equal(r.errors.filter((e) => /not available on this server/.test(e.m)).length, 2);
  assert.deepEqual(r.cv.items[0].props.cards.map((c) => c.kind), ['date']);
  // a file from a self-hosted Marco with a Home Assistant card in its Rotativa: that card is left out on import
  const self = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', [card('', 'ha.sensor', { entity: 'sensor.t' }), card('', 'date'), card('', 'weather.now')])] });
  const file = exportCanvasFile(self.cv);
  const back = readCanvasFile(JSON.parse(JSON.stringify(file)), {}, opts);
  assert.ok(back.ok, back.error);
  assert.deepEqual(back.canvas.items[0].props.cards.map((c) => c.kind), ['date', 'weather.now']);
  assert.equal(back.dropped, 1);
});

test('rotativa: export empties what points into the household inside its cards, and import gives new ids', () => {
  const r = clean({
    ...defaultCanvas(),
    items: [rot('cv_rrrrrrr1', [card('cv_card0001', 'ha.sensor', { entity: 'sensor.t' }), card('cv_card0002', 'calendar.agenda', { sourceIds: ['c1'] }), card('cv_card0003', 'value', { key: 'solar.today' })])],
  }, {}, { sourceIds: new Set(['c1']) });
  assert.deepEqual(r.errors, []);
  const file = exportCanvasFile(r.cv);
  const cards = file.canvas.items[0].props.cards;
  assert.equal(cards[0].props.entity, '');
  assert.equal(cards[1].props.sourceIds, null);
  assert.equal(cards[2].props.key, 'solar.today', 'a Valor key is a name anyone can use');
  assert.deepEqual(file.picks.cv_rrrrrrr1, ['calendars', 'entities']);
  const back = readCanvasFile(JSON.parse(JSON.stringify(file)));
  assert.ok(back.ok);
  const ids = canvasCards(back.canvas.items).map((x) => x.id);
  assert.ok(!ids.includes('cv_card0001') && !ids.includes('cv_rrrrrrr1'), 'new ids');
  assert.equal(new Set(ids).size, 4);
  assert.ok(back.picks[back.canvas.items[0].id].includes('entities'));
});

test('rotativa: its cards get their data like any card (aliases, values, data cards, widgets, calendars), never as controls', () => {
  const raw = {
    ...defaultCanvas(), touch: true,
    items: [
      item('cv_tile0001', 'ha.tile', B(6, 0, 3, 2), { entity: 'light.hall' }),
      rot('cv_rrrrrrr1', [
        card('cv_card0001', 'ha.sensor', { entity: 'sensor.outside' }),
        card('cv_card0002', 'ha.switch', { entity: 'switch.fan' }),
        card('cv_card0003', 'value', { key: 'solar.today' }),
        card('cv_card0004', 'market'),
        card('cv_card0005', 'widget', { widgetId: 'w1' }),
        card('cv_card0006', 'calendar.agenda', { days: 10 }),
      ]),
    ],
  };
  const { cv, errors } = clean(raw, {}, { widgets: new Map([['w1', {}]]) });
  assert.deepEqual(errors, []);
  const s = screen(cv);
  // Home Assistant: the cards have aliases of their own (their own ids), and are never touch controls
  const al = aliasesFor(s);
  assert.equal(al.get('cv_card0001:0').entity, 'sensor.outside');
  assert.equal(al.get('cv_card0002:0').entity, 'switch.fan');
  assert.equal(al.get('cv_card0002:0').interactive, false);
  assert.equal(al.get('cv_tile0001:0').interactive, true);
  assert.ok(watchedEntities({ screens: [s] }).has('sensor.outside'));
  assert.deepEqual(itemAliases(canvasCards(cv.items).find((x) => x.id === 'cv_card0001')), [{ alias: 'cv_card0001:0', entity: 'sensor.outside', slot: 0 }]);
  // values, data cards, widgets and the calendars' look ahead
  assert.ok(screenValueKeys(s).has('solar.today'));
  assert.deepEqual(canvasDataItems(s).map((x) => x.id), ['cv_card0004']);
  assert.deepEqual(canvasWidgetIds(s), ['w1']);
  assert.equal(canvasEventsNeed(cv), 11);
  // the display: each card as an item of its own, entity ids replaced by aliases, never interactive
  const p = projectCanvas(s);
  const r = p.items.find((x) => x.kind === 'rotator');
  assert.deepEqual(r.props.cards.map((c) => c.id), ['cv_card0001', 'cv_card0002', 'cv_card0003', 'cv_card0004', 'cv_card0005', 'cv_card0006']);
  assert.deepEqual(r.props.cards[0].props.entity, { a: 'cv_card0001:0', d: 'sensor' });
  assert.equal(JSON.stringify(p).includes('sensor.outside'), false, 'no entity id reaches the display');
  assert.ok(r.props.cards.every((c) => typeof c.v === 'string' && !c.disabled));
  assert.equal(r.interactive, false);
  // a card's change changes the Rotativa's hash (the display draws it again)
  const cv2 = structuredClone(cv);
  cv2.items[1].props.cards[0].props.decimals = 3;
  const r2 = projectCanvas(screen(cv2)).items.find((x) => x.kind === 'rotator');
  assert.notEqual(r2.v, r.v);
  assert.notEqual(r2.props.cards[0].v, r.props.cards[0].v);
  assert.equal(r2.props.cards[1].v, r.props.cards[1].v);
});

test('rotativa: privacy, hiding, schedules and conditions apply to its cards as to it', () => {
  const raw = {
    ...defaultCanvas(),
    items: [
      rot('cv_rrrrrrr1', [card('cv_card0001', 'ha.sensor', { entity: 'sensor.outside' }), card('cv_card0002', 'value', { key: 'solar.today' }), card('cv_card0003', 'weather.now')]),
    ],
  };
  const { cv } = clean(raw);
  // a private screen: the private kinds inside are placeholders with no props; the weather still shows
  const priv = projectCanvas(screen(cv), { isPrivate: true }).items[0].props.cards;
  assert.deepEqual(priv.map((c) => c.disabled ?? ''), ['privacy', 'privacy', '']);
  assert.deepEqual(priv[0].props, {});
  assert.deepEqual(priv[1].props, {});
  // a server without Home Assistant cards: that card is a 'feature' placeholder
  const noHa = projectCanvas(screen(cv), { canvasKinds: CLOUD_CANVAS_KINDS }).items[0].props.cards;
  assert.equal(noHa[0].disabled, 'feature');
  // hidden by hand: the Rotativa is not sent and its cards get nothing
  const hid = structuredClone(cv);
  hid.items[0].hidden = true;
  assert.equal(projectCanvas(screen(hid)).items.length, 0);
  assert.equal(aliasesFor(screen(hid)).size, 0);
  assert.equal(screenValueKeys(screen(hid)).size, 0);
  // a condition on the Rotativa hides its cards too (their values are not sent while it is hidden)
  const cond = structuredClone(cv);
  cond.items[0].when = { src: 'value', key: 'away', op: 'eq', value: 'true' };
  const off = conditionHidden(screen(cond), { value: () => false });
  assert.deepEqual([...off].sort(), ['cv_card0001', 'cv_card0002', 'cv_card0003', 'cv_rrrrrrr1']);
  assert.equal(screenValueKeys(screen(cond), off).size, 0);
  assert.equal(conditionHidden(screen(cond), { value: () => true }).size, 0);
  // private: every item with a condition is hidden, its cards too
  assert.ok(conditionHidden(screen(cond), { isPrivate: true }).has('cv_card0002'));
  // a schedule: outside its window the Rotativa and its cards are hidden
  const sch = structuredClone(cv);
  sch.items[0].schedule = [{ id: 'p_0', enabled: true, days: [], from: '08:00', to: '09:00' }];
  const at = new Date('2026-10-16T12:00:00Z');
  assert.deepEqual([...scheduleHidden(screen(sch), at, 'UTC')].sort(), ['cv_card0001', 'cv_card0002', 'cv_card0003', 'cv_rrrrrrr1']);
  assert.equal(projectCanvas(screen(sch), { now: at, tz: 'UTC' }).items.length, 0);
});

// ---- the builder ----------------------------------------------------------------------------------------------------

test('builder: the grid takes the smaller boxes, the cells follow it, and compact cards sit closer', ts, () => {
  // a card can be one row high (W and H steppers, the handle)
  let c = { ...defaultCanvas(), items: [] };
  const add = M.addItem(c, 'landscape', 'ha.tile', null, { entity: 'light.a' });
  assert.ok(add.ok);
  c = add.cv;
  const id = add.id;
  const p = M.placements(c, 'landscape').get(id);
  assert.deepEqual(M.boxCells(p, 'landscape'), [4, 4], 'its default size (xs)');
  const small = M.setCells(c, 'landscape', id, 4, 1);
  assert.ok(small.ok);
  assert.deepEqual(M.boxCells(M.placements(small.cv, 'landscape').get(id), 'landscape'), [4, 1]);
  assert.ok(M.setCells(c, 'landscape', id, 2, 1).ok, 'two cells wide (#9)');
  assert.equal(M.setCells(c, 'landscape', id, 1, 1).ok, false, 'not under the minimum');
  assert.deepEqual(M.handleBox(small.cv, 'landscape', id, 30, 0.2), M.boxFor('ha.tile', 12, 1, 'landscape'), 'the handle stops at the range');
  // the named sizes of the size menu are in cells of this grid
  assert.deepEqual(M.cellsOf('m', 'landscape'), [8, 6]);
  assert.deepEqual(M.cellsOf('s', 'portrait'), [8, 4]);
  // the overlay's cells: 24 columns from edge to edge
  const cv = canvasFromTemplate('bento');
  const g = G.computeGeometry(cv, 'landscape');
  const first = G.cellBox(g, 'landscape', 0, 0, 1, 1);
  const last = G.cellBox(g, 'landscape', 23, 15, 1, 1);
  assert.ok(Math.abs(first.x - g.main.x) < 0.01 && Math.abs(last.x + last.w - (g.main.x + g.main.w)) < 0.01, JSON.stringify([first, last, g.main]));
  assert.equal(G.cellAt(g, 'landscape', last.x + 1, last.y + 1).x, 23);
  // Densidad compacta: tighter gaps and edges in the overlay too
  const dense = G.computeGeometry({ ...cv, density: 'compact' }, 'landscape');
  assert.ok(dense.main.gx < g.main.gx && dense.main.x < g.main.x);
});

test('builder: a Rotativa counts its cards, gets ids of its own when added or copied, and stays within what its cards allow', ts, () => {
  let c = { ...defaultCanvas(), items: [] };
  const r = M.addItem(c, 'landscape', 'rotator', null);
  assert.ok(r.ok);
  c = r.cv;
  assert.equal(M.cardCount(c), 3);
  const it = M.itemOf(c, r.id);
  const ids = it.props.cards.map((x) => x.id);
  assert.ok(ids.every((x) => /^cv_[a-z0-9]{8}$/.test(x)) && new Set(ids).size === 2);
  // a copy: its cards get new ids
  const d = M.duplicateItem(c, 'landscape', r.id);
  assert.ok(d.ok);
  const all = canvasCards(d.cv.items).map((x) => x.id);
  assert.equal(new Set(all).size, all.length);
  assert.equal(M.cardCount(d.cv), 6);
  // its smallest box: what the hourly forecast needs
  assert.equal(M.setCells(c, 'landscape', r.id, 6, 2).ok, false);
  assert.equal(M.setCells(c, 'landscape', r.id, 8, 2).ok, true);
  // the cap counts the cards inside
  const full = clean({ ...defaultCanvas(), items: Array.from({ length: 46 }, (_, i) => item(`cv_fffff${String(i).padStart(3, '0')}`, 'spacer', B(i % 24, Math.floor(i / 24), 1, 1))) }).cv;
  assert.equal(M.canAdd(full, 'rotator'), 'tooMany', 'a Rotativa of two cards needs three');
  assert.equal(M.canAdd(full, 'spacer'), null);
  // validation agrees with the editor
  const v = clean(structuredClone(d.cv));
  assert.deepEqual(v.errors, []);
});

test('every screen takes 48 cards and 80 Home Assistant entities', () => {
  // 49 sensors of 4×1 (room for 96): the 49th is one too many
  const sensors = (n, w, h, cols) => Array.from({ length: n }, (_, i) => item(`cv_fffff${String(i).padStart(3, '0')}`, 'ha.sensor', B((i % cols) * w, Math.floor(i / cols) * h, w, h), { entity: `sensor.s${i}` }));
  const fine = clean({ ...defaultCanvas(), items: sensors(49, 4, 1, 6) });
  assert.ok(fine.errors.some((e) => /too many items \(max 48\)/.test(e.m)), JSON.stringify(fine.errors));
  assert.equal(fine.cv.items.length, 48);
  assert.equal(CANVAS_LIMITS.items, 48);
  assert.equal(CANVAS_LIMITS.haEntities, 80);
  // the names of 0.16 still answer, with the one set of caps
  assert.equal(CANVAS_LIMITS_FINE, CANVAS_LIMITS);
  assert.equal(canvasLimits('normal'), CANVAS_LIMITS);
  // 81 entities (14 rooms of 6 rows = 84): the 81st is refused, 78 are kept (the room that crosses 80 is left out)
  const room = (i) => item(`cv_rooom${String(i).padStart(3, '0')}`, 'ha.room', B((i % 4) * 6, Math.floor(i / 4) * 4, 6, 4), { rows: Array.from({ length: 6 }, (_, j) => ({ entity: `light.r${i}_${j}`, name: '', interactive: true })) });
  const many = clean({ ...defaultCanvas(), items: Array.from({ length: 14 }, (_, i) => room(i)) });
  assert.ok(many.errors.some((e) => /too many Home Assistant entities \(max 80\)/.test(e.m)), JSON.stringify(many.errors));
  assert.equal(new Set(many.cv.items.flatMap((it) => it.props.rows.map((r) => r.entity))).size, 78);
  const ok = clean({ ...defaultCanvas(), items: Array.from({ length: 13 }, (_, i) => room(i)) });
  assert.deepEqual(ok.errors, []);
});

test('builder: "N de 48 widgets" on every screen, and a 49th card is refused', ts, () => {
  assert.equal(M.maxCards(defaultCanvas()), 48);
  let cv = defaultCanvas();
  for (let i = 0; i < 48; i++) {
    const r = M.addItem(cv, 'landscape', 'spacer', { zone: 'main', drop: M.firstSpot(cv, 'landscape', 'spacer', 'xs') ?? { x: 0, y: 0, size: 'xs' } });
    assert.ok(r.ok, `card ${i + 1}: ${r.why}`);
    cv = r.cv;
  }
  assert.equal(M.cardCount(cv), 48);
  assert.equal(M.canAdd(cv, 'spacer'), 'tooMany');
});
