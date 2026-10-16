// Personalizado, issue #9: "Cuadrícula" (the fine grid, 24×16), "Densidad" (compact) and the "Rotativa" (one slot
// that shows its cards one after another). The model (canvasCore.js): ranges and sizes on both grids, the exact
// conversion both ways, validation and limits, and every data path of a Rotativa's cards (Home Assistant aliases,
// values, data cards, widgets, conditions, schedules, privacy, export). The builder's operations (model.ts) too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import {
  CANVAS_GRID, CANVAS_KINDS, CANVAS_LIMITS, CANVAS_SIZE_IDS, CANVAS_TEMPLATES, CLOUD_CANVAS_KINDS, DEFAULT_CANVAS_KINDS, ROTATOR_MAX, boxAllowed, boxOf, canvasCards,
  canvasDataItems, canvasDefaults, canvasEventsNeed, canvasFromTemplate, canvasWidgetIds, cellRange, conditionHidden, convertCanvasGrid, defaultCanvas, defaultItemStyle,
  deriveCanvasPortrait, exportCanvasFile, fitsAt, gridDims, itemAliases, kindFor, makeOccupancy, occupy, posCells, projectCanvas, readCanvasFile, rotatorKindOk, sanitizeCanvas,
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

/** True when no two main items share a cell on `o` (positions under `key`), on the canvas's grid. */
function noOverlap(cv, key = 'pos', o = 'landscape') {
  const g = cv.grid === 'fine' ? 'fine' : 'normal';
  const occ = makeOccupancy(o, g);
  for (const it of cv.items) {
    const p = it[key];
    if (p?.zone !== 'main') continue;
    const [w, h] = posCells(p, o, g);
    if (!fitsAt(occ, p.x, p.y, w, h)) return false;
    occupy(occ, it.id, p.x, p.y, w, h);
  }
  return true;
}

// ---- the grid ---------------------------------------------------------------------------------------------------

test('fine grid: twice the cells each way, every named size and range twice as many cells, and smaller line cards', () => {
  assert.deepEqual(CANVAS_GRID, { landscape: { cols: 12, rows: 8 }, portrait: { cols: 8, rows: 12 } }, 'the normal grid did not change');
  assert.deepEqual(gridDims('landscape', 'fine'), { cols: 24, rows: 16 });
  assert.deepEqual(gridDims('portrait', 'fine'), { cols: 16, rows: 24 });
  assert.deepEqual(gridDims('landscape'), { cols: 12, rows: 8 });
  for (const s of CANVAS_SIZE_IDS) {
    for (const o of ['landscape', 'portrait']) assert.deepEqual(sizeCells(s, o, 'fine'), sizeCells(s, o).map((n) => n * 2), `${s} ${o}`);
  }
  for (const kind of Object.keys(CANVAS_KINDS)) {
    for (const o of ['landscape', 'portrait']) {
      const n = cellRange(kind, o);
      const f = cellRange(kind, o, 'fine');
      assert.equal(f.maxW, Math.min(n.maxW * 2, gridDims(o, 'fine').cols), `${kind} ${o} maxW`);
      assert.equal(f.maxH, Math.min(n.maxH * 2, gridDims(o, 'fine').rows), `${kind} ${o} maxH`);
      // never smaller than half a normal cell's worth less, never larger than twice the normal minimum
      assert.ok(f.minW <= n.minW * 2 && f.minH <= n.minH * 2, `${kind} ${o} min`);
      if (!CANVAS_KINDS[kind].fine) assert.deepEqual([f.minW, f.minH], [n.minW * 2, n.minH * 2], `${kind} ${o}: twice the normal minimum`);
      // every named size of the kind is a legal fine box
      for (const s of CANVAS_KINDS[kind].sizes) assert.ok(boxAllowed(kind, ...sizeCells(s, o, 'fine'), o, 'fine'), `${kind} ${s} ${o}`);
    }
  }
  // the line cards (Entidad, Interruptor, Sensor, Luz) half as high as today's 2×1, still readable (browser sweep)
  for (const kind of ['ha.tile', 'ha.switch', 'ha.sensor', 'ha.light']) {
    assert.ok(boxAllowed(kind, 4, 1, 'landscape', 'fine'), `${kind} 4×1 fine`);
    assert.equal(boxAllowed(kind, 3, 1, 'landscape', 'fine'), false, `${kind} 3×1 fine is too narrow`);
    assert.ok(boxAllowed(kind, 2, 1), `${kind} 2×1 normal as before`);
  }
  // a box exactly twice a named size is stored as the name, as on the normal grid
  assert.deepEqual(boxOf('todo', 6, 8, 'landscape', 'fine'), { size: 't' });
  assert.deepEqual(boxOf('ha.tile', 4, 1, 'landscape', 'fine'), { size: 'row', w: 4, h: 1 });
  assert.deepEqual(boxOf('ha.tile', 1, 1, 'landscape', 'fine'), { size: 'row', w: 4, h: 1 }, 'clamped to the fine minimum');
  assert.deepEqual(posCells({ size: 'm' }, 'landscape', 'fine'), [8, 6]);
});

test('settings: old screens have neither (Normal), they are kept only when chosen, and wrong values are errors', () => {
  const before = canvasFromTemplate('bento');
  assert.equal('grid' in before, false);
  assert.equal('density' in before, false);
  const again = clean(structuredClone(before));
  assert.deepEqual(again.cv, before, 'a screen saved before validates to the same thing');
  assert.deepEqual(again.errors, []);
  const f = clean({ ...defaultCanvas(), grid: 'fine', density: 'compact' });
  assert.equal(f.cv.grid, 'fine');
  assert.equal(f.cv.density, 'compact');
  const n = clean({ ...defaultCanvas(), grid: 'normal', density: 'normal' });
  assert.equal('grid' in n.cv, false, 'the default is not stored');
  assert.equal('density' in n.cv, false);
  const bad = clean({ ...defaultCanvas(), grid: 'huge', density: 'tiny' });
  assert.deepEqual(bad.errors.map((e) => e.p).sort(), ['canvas.density', 'canvas.grid']);
  assert.equal('grid' in bad.cv, false);
  // a fine box of up to 24 cells is read; a normal grid clamps it to the kind's range (a warning)
  const big = clean({ ...defaultCanvas(), grid: 'fine', items: [item('cv_aaaaaaa1', 'calendar.month', B(0, 0, 24, 16))] });
  assert.deepEqual(big.errors, []);
  assert.deepEqual(big.cv.items[0].pos, { zone: 'main', x: 0, y: 0, size: 'full' });
  const clamp = clean({ ...defaultCanvas(), items: [item('cv_aaaaaaa1', 'calendar.month', B(0, 0, 24, 16))] });
  assert.deepEqual(clamp.errors, []);
  assert.deepEqual(clamp.cv.items[0].pos, { zone: 'main', x: 0, y: 0, size: 'full' });
  assert.ok(clamp.warnings.length);
  // a fine-only box saved on the fine grid stays; on the normal grid it is clamped up
  const tile = clean({ ...defaultCanvas(), grid: 'fine', items: [item('cv_aaaaaaa1', 'ha.tile', B(0, 0, 4, 1), { entity: 'light.a' })] });
  assert.deepEqual(tile.cv.items[0].pos, { zone: 'main', x: 0, y: 0, size: 'row', w: 4, h: 1 });
  // the projection carries both, so the display draws the grid and the density
  const p = projectCanvas(screen(f.cv));
  assert.equal(p.grid, 'fine');
  assert.equal(p.density, 'compact');
  assert.equal('grid' in projectCanvas(screen(before)), false);
});

test('conversion: every template to the fine grid and back is exact, in both orientations, sidebar spans unchanged', () => {
  for (const tpl of CANVAS_TEMPLATES) {
    for (const auto of [true, false]) {
      let cv = canvasFromTemplate(tpl.id);
      if (!auto) {
        // portrait arranged by hand: the derived arrangement made the owner's own
        const placed = new Map(deriveCanvasPortrait(cv.items, cv.sidebar).placed.map((d) => [d.id, d.pos]));
        cv = { ...cv, portraitAuto: false, items: cv.items.map((it) => ({ ...it, portrait: placed.get(it.id) ?? null })) };
        cv = clean(cv).cv;
      }
      const up = convertCanvasGrid(cv, 'fine');
      assert.ok(up.ok, tpl.id);
      assert.deepEqual([up.moved, up.resized], [[], []], `${tpl.id}: nothing moves`);
      assert.equal(up.canvas.grid, 'fine');
      for (const it of up.canvas.items) {
        const was = cv.items.find((x) => x.id === it.id);
        for (const [key, o] of [['pos', 'landscape'], ['portrait', 'portrait']]) {
          const a = was[key];
          const b = it[key];
          if (key === 'portrait' && auto) continue;
          if (!a) {
            assert.equal(b ?? null, a ?? null);
            continue;
          }
          if (a.zone === 'side') assert.deepEqual(b, a, `${tpl.id}: sidebar unchanged`);
          else {
            assert.deepEqual([b.x, b.y], [a.x * 2, a.y * 2], `${tpl.id} ${key} origin`);
            assert.deepEqual(posCells(b, o, 'fine'), posCells(a, o).map((n) => n * 2), `${tpl.id} ${key} box`);
          }
        }
      }
      // valid as saved, with no overlap, and the derived portrait of the fine grid is laid out on 16×24
      const v = clean(structuredClone(up.canvas));
      assert.deepEqual(v.errors, [], tpl.id);
      assert.deepEqual(v.cv, up.canvas, `${tpl.id}: validation keeps the converted canvas as it is`);
      assert.ok(noOverlap(v.cv) && (auto || noOverlap(v.cv, 'portrait', 'portrait')), tpl.id);
      if (auto) {
        const occ = makeOccupancy('portrait', 'fine');
        for (const d of deriveCanvasPortrait(v.cv.items, v.cv.sidebar, 'fine').placed) {
          if (d.pos.zone !== 'main') continue;
          const [w, h] = posCells(d.pos, 'portrait', 'fine');
          assert.ok(fitsAt(occ, d.pos.x, d.pos.y, w, h), `${tpl.id}: derived fine portrait`);
          occupy(occ, d.id, d.pos.x, d.pos.y, w, h);
        }
      }
      const down = convertCanvasGrid(up.canvas, 'normal');
      assert.ok(down.ok);
      assert.deepEqual([down.moved, down.resized], [[], []], `${tpl.id}: back with nothing moved`);
      assert.deepEqual(down.canvas, cv, `${tpl.id}: back to exactly the screen it was`);
    }
  }
});

test('conversion back to normal: boxes only the fine grid has go to the nearest legal cells, with no overlap, and say so', () => {
  const items = [
    // four line cards half a row high, side by side in pairs
    item('cv_aaaaaaa1', 'ha.tile', B(0, 0, 4, 1), { entity: 'light.a' }),
    item('cv_aaaaaaa2', 'ha.tile', B(0, 1, 4, 1), { entity: 'light.b' }),
    item('cv_aaaaaaa3', 'ha.sensor', B(4, 0, 4, 1), { entity: 'sensor.c' }),
    item('cv_aaaaaaa4', 'ha.sensor', B(4, 1, 4, 1), { entity: 'sensor.d' }),
    // an odd box: 7×5 fine cells
    item('cv_aaaaaaa5', 'todo', B(9, 3, 7, 5)),
    item('cv_aaaaaaa6', 'clock.digital', B(16, 0, 8, 6)),
  ];
  const fine = clean({ ...defaultCanvas(), grid: 'fine', sidebar: { side: 'left', size: 'normal', fill: 'glass' }, items: [...items, item('cv_aaaaaaa7', 'weather.now', { zone: 'side', order: 0, span: 3 })] });
  assert.deepEqual(fine.errors, []);
  const r = convertCanvasGrid(fine.cv, 'normal');
  assert.ok(r.ok);
  assert.equal('grid' in r.canvas, false);
  assert.ok(noOverlap(r.canvas), 'no overlap');
  const v = clean(structuredClone(r.canvas));
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.cv, r.canvas, 'a legal normal canvas as it is');
  const pos = (id) => r.canvas.items.find((x) => x.id === id).pos;
  // the clock was exactly twice a normal box: same place, same box
  assert.deepEqual(pos('cv_aaaaaaa6'), { zone: 'main', x: 8, y: 0, size: 'm' });
  // the side item keeps its span
  assert.deepEqual(pos('cv_aaaaaaa7'), { zone: 'side', order: 0, span: 3 });
  // the half-row tiles grew to the normal 2×1 and had to make room for each other
  for (const id of ['cv_aaaaaaa1', 'cv_aaaaaaa2', 'cv_aaaaaaa3', 'cv_aaaaaaa4']) {
    assert.deepEqual(posCells(pos(id), 'landscape'), [2, 1], id);
    assert.ok(r.moved.includes(id) || r.resized.includes(id), `${id} is reported`);
  }
  assert.ok(r.resized.includes('cv_aaaaaaa5') || r.moved.includes('cv_aaaaaaa5'), 'the odd box is reported');
  for (const id of r.resized) assert.ok(!r.moved.includes(id));
  // to the fine grid again and back: stable from then on
  const again = convertCanvasGrid(convertCanvasGrid(r.canvas, 'fine').canvas, 'normal');
  assert.deepEqual(again.canvas, r.canvas);
  // the same canvas twice: nothing to do
  assert.deepEqual(convertCanvasGrid(r.canvas, 'normal'), { ok: true, canvas: r.canvas, moved: [], resized: [], lost: [] });
});

test('conversion back to normal: a card with no room at all is reported and nothing is changed', () => {
  // 23 weather cards at the fine grid's smallest (3×2, a normal 2×2 each: 92 of the 96 normal cells) and a month
  // calendar (8×6 fine, 4×3 normal): on the fine grid there is room to spare, on the normal one not for everything
  const items = [item('cv_cal00001', 'calendar.month', B(0, 0, 8, 6))];
  for (let i = 0; i < 23; i++) items.push(item(`cv_wx${String(i).padStart(6, '0')}`, 'weather.now', B(8 + (i % 5) * 3, Math.floor(i / 5) * 2, 3, 2)));
  const fine = clean({ ...defaultCanvas(), grid: 'fine', items });
  assert.deepEqual(fine.errors, []);
  assert.equal(fine.cv.items.length, 24);
  const r = convertCanvasGrid(fine.cv, 'normal');
  assert.equal(r.ok, false);
  assert.ok(r.lost.length >= 1);
  // the builder refuses the switch, so the screen stays on the fine grid as it was
  assert.equal(fine.cv.grid, 'fine');
  // with room for every card it goes through
  const fewer = clean({ ...defaultCanvas(), grid: 'fine', items: items.slice(0, 20) }).cv;
  const ok = convertCanvasGrid(fewer, 'normal');
  assert.ok(ok.ok);
  assert.ok(noOverlap(ok.canvas));
});

// ---- the Rotativa -------------------------------------------------------------------------------------------------

const rot = (id, cards, props = {}, extra = {}) => item(id, 'rotator', B(0, 0, 6, 3), { cards, ...props }, extra);
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
  const clash = clean({ ...defaultCanvas(), items: [item('cv_xxxxxxx1', 'clock.digital', B(6, 0, 4, 3)), rot('cv_rrrrrrr1', [card('cv_xxxxxxx1', 'date'), card('cv_rrrrrrr1', 'date'), card('cv_ccccccc1', 'date'), card('cv_ccccccc1', 'date')])] });
  const ids = canvasCards(clash.cv.items).map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'every card id is unique on the screen');
  assert.ok(ids.includes('cv_ccccccc1'));
  // "Cambiar cada": 5 to 120 seconds; the dots a boolean
  const t = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', d.cards, { everySec: 2 }), rot('cv_rrrrrrr2', d.cards, { everySec: 999 }, { pos: B(6, 0, 6, 3) })] });
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
  // its range: what every one of its cards allows too (the hourly forecast needs 6 cells across)
  const k = kindFor({ kind: 'rotator', props: d });
  assert.deepEqual([cellRange(k).minW, cellRange(k).minH], [6, 2]);
  assert.deepEqual([cellRange(k, 'landscape', 'fine').minW, cellRange(k, 'landscape', 'fine').minH], [12, 4]);
  assert.deepEqual(cellRange(kindFor({ kind: 'rotator', props: { cards: [] } })), cellRange('rotator'), 'no cards: the kind itself');
  // so a box too small for its cards is grown on save
  const small = clean({ ...defaultCanvas(), items: [rot('cv_rrrrrrr1', d.cards, {}, { pos: B(0, 0, 3, 2) })] });
  assert.deepEqual(posCells(small.cv.items[0].pos, 'landscape'), [6, 2]);
});

test('rotativa: its cards count towards the cap of cards, the cap of each kind and the Home Assistant entities', () => {
  // 22 items and a Rotativa of three cards: 26 cards, two left out
  const items = Array.from({ length: 22 }, (_, i) => item(`cv_ddddd${String(i).padStart(3, '0')}`, 'spacer', B(i % 12, Math.floor(i / 12), 1, 1)));
  const a = clean({ ...defaultCanvas(), items: [...items, rot('cv_rrrrrrr1', [card('', 'date'), card('', 'date'), card('', 'date')], {}, { pos: B(0, 3, 6, 3) })] });
  assert.ok(a.errors.some((e) => /too many items \(max 24\)/.test(e.m)));
  assert.equal(canvasCards(a.cv.items).length, CANVAS_LIMITS.items);
  assert.equal(a.cv.items.at(-1).props.cards.length, 1);
  // two photo cards already: a third inside a Rotativa is one too many
  const ph = clean({ ...defaultCanvas(), items: [item('cv_ppppppp1', 'photo', B(0, 0, 3, 2)), item('cv_ppppppp2', 'photo', B(3, 0, 3, 2)), rot('cv_rrrrrrr1', [card('', 'photo'), card('', 'date')], {}, { pos: B(0, 3, 6, 3) })] });
  assert.ok(ph.errors.some((e) => /too many photo/.test(e.m)));
  assert.deepEqual(ph.cv.items[2].props.cards.map((c) => c.kind), ['date']);
  // the entities of its cards count towards the 40 of a screen
  const sensors = Array.from({ length: 39 }, (_, i) => item(`cv_eeeee${String(i).padStart(3, '0')}`, 'ha.sensor', B(0, 0, 2, 1), { entity: `sensor.s${i}` }));
  const e = clean({ ...defaultCanvas(), items: [...sensors.slice(0, 20), rot('cv_rrrrrrr1', [card('', 'ha.sensor', { entity: 'sensor.x1' }), card('', 'ha.sensor', { entity: 'sensor.x2' })], {}, { pos: B(0, 3, 6, 3) })] });
  assert.deepEqual(e.errors, []);
  assert.equal(canvasCards(e.cv.items).length, 23);
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

test('builder: Cuadrícula converts with one undo step, the fine grid takes the smaller boxes, the cells follow it', ts, () => {
  const cv = canvasFromTemplate('bento');
  const up = M.setGrid(cv, 'fine');
  assert.ok(up.ok);
  assert.equal(up.moved + up.resized, 0);
  assert.equal(M.gOf(up.cv), 'fine');
  assert.ok(M.noOverlap(up.cv));
  // a card on the fine grid can be half a normal row high (W and H steppers, the handle)
  let c = { ...defaultCanvas(), grid: 'fine', items: [] };
  const add = M.addItem(c, 'landscape', 'ha.tile', null, { entity: 'light.a' });
  assert.ok(add.ok);
  c = add.cv;
  const id = add.id;
  const p = M.placements(c, 'landscape').get(id);
  assert.deepEqual(M.boxCells(p, 'landscape', 'fine'), [4, 4], 'its default size, twice the normal cells');
  const small = M.setCells(c, 'landscape', id, 4, 1);
  assert.ok(small.ok);
  assert.deepEqual(M.boxCells(M.placements(small.cv, 'landscape').get(id), 'landscape', 'fine'), [4, 1]);
  assert.equal(M.setCells(c, 'landscape', id, 3, 1).ok, false, 'not under the fine minimum');
  assert.deepEqual(M.handleBox(small.cv, 'landscape', id, 30, 0.2), M.boxFor('ha.tile', 12, 1, 'landscape', 'fine'), 'the handle stops at the range');
  // the overlay's cells: 24 columns over the same screen
  const g = G.computeGeometry(up.cv, 'landscape');
  assert.equal(g.grid, 'fine');
  const one = G.cellBox(g, 'landscape', 0, 0, 1, 1);
  const two = G.cellBox(G.computeGeometry(cv, 'landscape'), 'landscape', 0, 0, 1, 1);
  assert.ok(one.w < two.w / 2 + 1 && one.w > two.w / 2 - 12);
  // the same box on both grids is the same rectangle on the screen
  const a = G.cellBox(g, 'landscape', 8, 0, 8, 6);
  const b = G.cellBox(G.computeGeometry(cv, 'landscape'), 'landscape', 4, 0, 4, 3);
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(a[k] - b[k]) < 0.01, k);
  // Densidad compacta: tighter gaps and edges in the overlay too
  const dense = G.computeGeometry({ ...cv, density: 'compact' }, 'landscape');
  assert.ok(dense.main.gx < G.computeGeometry(cv, 'landscape').main.gx && dense.main.x < G.computeGeometry(cv, 'landscape').main.x);
  // back to normal from a fine-only box: moved or resized, never overlapping
  const down = M.setGrid(small.cv, 'normal');
  assert.ok(down.ok);
  assert.ok(down.moved + down.resized >= 1);
  assert.ok(M.noOverlap(down.cv));
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
  assert.equal(M.setCells(c, 'landscape', r.id, 3, 2).ok, false);
  // the cap counts the cards inside
  const full = clean({ ...defaultCanvas(), items: Array.from({ length: 22 }, (_, i) => item(`cv_fffff${String(i).padStart(3, '0')}`, 'spacer', B(i % 12, Math.floor(i / 12), 1, 1))) }).cv;
  assert.equal(M.canAdd(full, 'rotator'), 'tooMany', 'a Rotativa of two cards needs three');
  assert.equal(M.canAdd(full, 'spacer'), null);
  // validation agrees with the editor
  const v = clean(structuredClone(d.cv));
  assert.deepEqual(v.errors, []);
});
