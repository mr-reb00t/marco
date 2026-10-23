// The Personalizado builder (web/admin/builder/): the pure editing rules every gesture goes through (model.ts),
// undo (history.ts), draft keys (draftStore.ts), the overlay maths (geometry.ts), and its texts in five languages.
// The web modules load through Node's TypeScript type stripping (skipped before Node 22.18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as nodeModule from 'node:module';
import { CANVAS_LIMITS, CLOUD_CANVAS_KINDS, canvasFromTemplate, defaultCanvas, sanitizeCanvas } from '../core/canvasCore.js';

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
const H = await load('../../web/admin/builder/history.ts');
const D = await load('../../web/admin/builder/draftStore.ts');
const G = await load('../../web/admin/builder/geometry.ts');
const K = await load('../../web/admin/builder/kinds.ts');
const F = await load('../../web/admin/builder/fieldSpecs.ts');
const dict = await load('../../web/admin/i18n-dict.ts');
const nl = await load('../../web/admin/i18n-dict-nl.ts');
const da = await load('../../web/admin/i18n-dict-da.ts');
const fam = await load('../../web/admin/i18n-dict-family.ts');
const HS = await load('../../web/admin/haSearch.ts');
const ts = { skip: M && H && D && G && K && F && dict && nl && da && fam && HS ? false : 'TypeScript imports need Node >= 22.18' };

const clean = () => {
  const c = { errors: [], warnings: [], err(p, m) { this.errors.push([p, m]); }, warn(p, m) { this.warnings.push([p, m]); } };
  return c;
};
/** The server would keep every item where it is: no error, no warning, nothing moved. */
const valid = (cv) => {
  const c = clean();
  const out = sanitizeCanvas(c, 'canvas', structuredClone(cv), {}, {});
  assert.deepEqual([c.errors, c.warnings], [[], []]);
  assert.deepEqual(out.items.map((i) => [i.id, i.pos]), cv.items.map((i) => [i.id, i.pos]));
  assert.ok(M.noOverlap(cv));
};
const ok = (r) => {
  assert.equal(r.ok, true, `refused: ${r.why}`);
  return r.cv;
};

test('add: first free spot, a drop on a taken spot slides to the nearest free one, a full grid refuses', ts, () => {
  let cv = defaultCanvas();
  const a = M.addItem(cv, 'landscape', 'calendar.month', null);
  cv = ok(a);
  assert.deepEqual(M.itemOf(cv, a.id).pos, { zone: 'main', x: 0, y: 0, size: 'l' });
  // a weather card dropped on the month: next to it
  const drop = M.resolveMain(cv, 'landscape', 's', 1, 1);
  assert.ok(drop && (drop.x >= 6 || drop.y >= 4));
  cv = ok(M.addItem(cv, 'landscape', 'weather.now', { zone: 'main', drop }));
  valid(cv);
  // fill the grid with full-screen-sized nothing: no room for another large month
  const full = ok(M.addItem(defaultCanvas(), 'landscape', 'calendar.month', { zone: 'main', drop: { x: 0, y: 0, size: 'full' } }));
  assert.equal(M.resolveMain(full, 'landscape', 'xs', 3, 3), null);
  assert.equal(M.addItem(full, 'landscape', 'clock.digital', null).ok, false);
  assert.equal(M.addItem(full, 'landscape', 'clock.digital', null).why, 'noRoom');
});

test('move: a free spot, a swap with an item of the same size under the pointer, and never an overlap', ts, () => {
  let cv = canvasFromTemplate('calendarWeather');
  const clock = cv.items.find((i) => i.kind === 'clock.digital');
  const wx = cv.items.find((i) => i.kind === 'weather.now');
  assert.equal(clock.pos.size, wx.pos.size);
  const drop = M.resolveMain(cv, 'landscape', 'm', wx.pos.x, wx.pos.y, { id: clock.id, at: { x: wx.pos.x, y: wx.pos.y } });
  assert.equal(drop.swap, wx.id);
  const after = ok(M.applyMain(cv, 'landscape', clock.id, drop));
  assert.deepEqual([M.itemOf(after, clock.id).pos.y, M.itemOf(after, wx.id).pos.y], [wx.pos.y, clock.pos.y]);
  valid(after);
  // keyboard: one cell left jumps over the month to the next free spot, or refuses
  const r = M.nudge(after, 'landscape', clock.id, 1, 0);
  assert.equal(r.ok, false);
  cv = after;
  for (const id of cv.items.map((i) => i.id)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = M.nudge(cv, 'landscape', id, dx, dy);
    if (n.ok) valid(n.cv);
  }
});

test('empty cards: a drop on a spacer replaces it, an empty card of its own moves aside, a card with content stays', ts, () => {
  // the owner's screen: agenda on the left, clock and weather on the right, the middle "free" but taken by an
  // announcement with no announcement and a spacer; a medium clock fits nowhere else
  const it = (id, kind, x, y, size) => ({ id, kind, pos: { zone: 'main', x, y, size }, style: {}, props: {} });
  const cv = {
    ...defaultCanvas(),
    items: [
      it('cv_agenda01', 'calendar.agenda', 0, 0, 't'), it('cv_today001', 'calendar.today', 0, 8, 't'), it('cv_clock001', 'clock.digital', 18, 0, 's'),
      it('cv_wxnow001', 'weather.now', 18, 4, 's'), it('cv_annou001', 'announcement', 6, 4, 'w'), it('cv_space001', 'spacer', 8, 8, 's'),
      it('cv_forec001', 'weather.forecast', 6, 12, 'w'), it('cv_cdown001', 'countdowns', 18, 12, 's'),
    ],
  };
  // without knowing what is empty: no room, and the cards in the way are named
  assert.equal(M.resolveMain(cv, 'landscape', 'm', 6, 6), null);
  assert.deepEqual(M.occupantsAt(cv, 'landscape', 6, 6, 8, 6).sort(), ['cv_annou001', 'cv_space001']);
  const voids = M.voidIds(cv, new Set(['cv_annou001', 'cv_cdown001']));
  assert.deepEqual([...voids].sort(), ['cv_annou001', 'cv_cdown001', 'cv_space001']);
  // dropped there: the spacer goes, the announcement keeps its settings and moves to the nearest free spot
  const drop = M.resolveMain(cv, 'landscape', 'm', 6, 6, { at: { x: 10, y: 8 }, voids });
  assert.ok(drop?.replace);
  assert.deepEqual(drop.replace.remove, ['cv_space001']);
  assert.deepEqual(drop.replace.move.map((m) => m.id), ['cv_annou001']);
  const r = M.addItem(cv, 'landscape', 'clock.analog', { zone: 'main', drop });
  const after = ok(r);
  valid(after);
  assert.equal(M.itemOf(after, 'cv_space001'), undefined);
  assert.ok(M.itemOf(after, 'cv_annou001'));
  assert.equal(after.items.length, cv.items.length);
  // moving the clock card onto them works the same way
  const mv = M.resolveMain(cv, 'landscape', 's', 8, 8, { id: 'cv_clock001', at: { x: 10, y: 8 }, voids });
  assert.deepEqual(mv.replace.remove, ['cv_space001']);
  valid(ok(M.applyMain(cv, 'landscape', 'cv_clock001', mv)));
  // a tap-to-add with no free spot takes the place of an empty card too (and says so through r.drop.replace)
  const add = M.addItem(cv, 'landscape', 'calendar.month', null, {}, voids);
  valid(ok(add));
  assert.ok(add.drop.replace);
  // a card that shows something is never replaced: the weather is not empty
  assert.equal(M.resolveMain(cv, 'landscape', 'm', 16, 4, { voids: new Set(['cv_space001']) })?.replace?.move.some((m) => m.id === 'cv_wxnow001') ?? false, false);
  // an empty card with nowhere to go is not deleted: no room
  const tight = { ...cv, items: [...cv.items, it('cv_fill0001', 'message', 6, 0, 'w')] };
  const d2 = M.resolveMain(tight, 'landscape', 'm', 6, 6, { at: { x: 8, y: 6 }, voids: new Set(['cv_annou001']) });
  assert.equal(d2, null);
});

test('sizes: allowed sizes only, smallest first (m before w), resize keeps the origin or finds room', ts, () => {
  assert.deepEqual(M.sizesOf('clock.digital'), ['xs', 's', 'm', 'w', 'l', 'band', 'xl']);
  assert.deepEqual(M.sizesOf('calendar.month'), ['m', 'l', 'xl', 'full']);
  let cv = ok(M.addItem(defaultCanvas(), 'landscape', 'clock.digital', null));
  const id = cv.items[0].id;
  for (const s of ['xs', 's', 'm', 'w', 'l', 'band', 'xl']) {
    cv = ok(M.resize(cv, 'landscape', id, s));
    assert.equal(M.itemOf(cv, id).pos.size, s);
    valid(cv);
  }
  assert.equal(M.resize(cv, 'landscape', id, 'full').ok, false);
  // step: from xl back down
  cv = ok(M.stepSize(cv, 'landscape', id, -1));
  assert.equal(M.itemOf(cv, id).pos.size, 'band');
  // spans and sizes between the zones
  assert.deepEqual(['xs', 's', 'm', 'w', 't', 'l', 'xl'].map(M.spanForSize), [2, 2, 3, 3, 3, 4, 4]);
  assert.equal(M.sizeForSpan('calendar.agenda', 2), 's');
  assert.equal(M.sizeForSpan('weather.now', 4), 'm');
});

test('sidebar: items move in and out with their size mapped, reorder, spans cycle and the stack never overflows', ts, () => {
  let cv = canvasFromTemplate('calendarWeather');
  cv = ok(M.setSidebarSide(cv, 'left'));
  const clock = cv.items.find((i) => i.kind === 'clock.digital').id;
  const wx = cv.items.find((i) => i.kind === 'weather.now').id;
  const month = cv.items.find((i) => i.kind === 'calendar.month').id;
  cv = ok(M.toSide(cv, 'landscape', clock, 0));
  assert.deepEqual(M.itemOf(cv, clock).pos, { zone: 'side', order: 0, span: 3 });
  cv = ok(M.toSide(cv, 'landscape', wx, 0));
  assert.deepEqual(M.sideStack(cv, 'landscape').map((x) => x.id), [wx, clock]);
  assert.equal(M.toSide(cv, 'landscape', month, 2).why, 'noSide');
  cv = ok(M.reorderSide(cv, 'landscape', wx, 1));
  assert.deepEqual(M.sideStack(cv, 'landscape').map((x) => [x.id, x.pos.order]), [[clock, 0], [wx, 1]]);
  // spans cycle 3 → 4 → fill; with a fill the others leave it at least 2 units
  cv = ok(M.stepSpan(cv, 'landscape', clock));
  assert.equal(M.itemOf(cv, clock).pos.span, 4);
  cv = ok(M.stepSpan(cv, 'landscape', clock));
  assert.equal(M.itemOf(cv, clock).pos.span, 'fill');
  assert.equal(M.setSpan(cv, 'landscape', wx, 4).ok, true);
  assert.equal(M.fitSpan(ok(M.setSpan(cv, 'landscape', wx, 4)), 'landscape', 4), 2, 'a third item gets the 2 units left');
  valid(cv);
  // back to the main grid, and the sidebar off moves what is left
  // a large clock finds no room for its large size; the weather card (span 4: its largest, m) does
  assert.equal(M.toMain(cv, 'landscape', clock, 16, 0).why, 'noRoom');
  cv = ok(M.toMain(cv, 'landscape', wx, 16, 0));
  assert.deepEqual(M.itemOf(cv, wx).pos, { zone: 'main', x: 16, y: 0, size: 'm' });
  const off = ok(M.setSidebarSide(cv, 'none', 'move'));
  assert.ok(off.items.every((i) => i.pos.zone === 'main'));
  valid(off);
  assert.equal(ok(M.setSidebarSide(cv, 'none', 'delete')).items.length, cv.items.length - 1);
});

test('caps, duplicate, remove and hide', ts, () => {
  let cv = defaultCanvas();
  for (let i = 0; i < 2; i++) cv = ok(M.addItem(cv, 'landscape', 'photo', null));
  assert.equal(M.addItem(cv, 'landscape', 'photo', null).why, 'kindCap');
  cv = defaultCanvas();
  while (cv.items.length < CANVAS_LIMITS.items) cv = ok(M.addItem(cv, 'landscape', 'spacer', { zone: 'main', drop: M.firstSpot(cv, 'landscape', 'spacer', 'xs') ?? { x: 0, y: 0, size: 'xs' } }));
  assert.equal(M.addItem(cv, 'landscape', 'spacer', null).why, 'tooMany');
  let t = canvasFromTemplate('bedroom');
  const n = t.items.length;
  const d = M.duplicateItem(t, 'landscape', t.items[2].id);
  t = ok(d);
  assert.equal(t.items.length, n + 1);
  assert.deepEqual(M.itemOf(t, d.id).props, t.items[2].props);
  valid(t);
  t = ok(M.removeItem(t, d.id));
  assert.equal(t.items.length, n);
});

test('portrait: derived and read-only until edited, then its own arrangement; new items get a portrait spot', ts, () => {
  let cv = canvasFromTemplate('kitchen');
  const orig = cv;
  assert.equal(M.readOnly(cv, 'portrait'), true);
  assert.equal(M.nudge(cv, 'portrait', cv.items[0].id, 1, 0).why, 'auto');
  const omitted = M.omittedInPortrait(cv);
  assert.ok(omitted.length > 0);
  cv = M.editPortrait(cv);
  assert.equal(cv.portraitAuto, false);
  assert.deepEqual(cv.items.filter((i) => i.portrait === null).map((i) => i.id), omitted);
  const first = cv.items.find((i) => i.portrait);
  const moved = M.nudge(cv, 'portrait', first.id, 0, 1);
  if (moved.ok) assert.deepEqual(M.itemOf(moved.cv, first.id).pos, first.pos, 'landscape untouched');
  // what the server keeps (a portrait left out is derived again, never an error)
  const c = clean();
  sanitizeCanvas(c, 'canvas', cv, {}, {});
  assert.deepEqual(c.errors, []);
  assert.ok(M.autoPortrait(cv).items.every((i) => !('portrait' in i)));
  // "Volver a automático" from the portrait view: read-only again and the derived arrangement, not the hand-made one
  // a hand-made portrait: one card taken out of it (the grid is full, nothing can move)
  const hand = structuredClone(cv);
  hand.items.find((i) => i.portrait).portrait = null;
  assert.ok(hand, 'a card moves in portrait');
  const back = M.autoPortrait(hand);
  assert.equal(M.readOnly(back, 'portrait'), true);
  assert.notDeepEqual([...M.placements(hand, 'portrait')], [...M.placements(orig, 'portrait')]);
  assert.deepEqual([...M.placements(back, 'portrait')], [...M.placements(orig, 'portrait')]);
  // undo brings the hand-made one back
  let h = H.startHistory(hand);
  h = H.push(h, back);
  assert.equal(H.undo(h).present, hand);
});

test('history: 50 steps, slider changes on one field merge, undo and redo', ts, () => {
  let h = H.startHistory(0);
  for (let i = 1; i <= 60; i++) h = H.push(h, i);
  assert.equal(h.past.length, H.HISTORY_MAX);
  h = H.startHistory('a');
  h = H.push(h, 'b', 'dim', 1000);
  h = H.push(h, 'c', 'dim', 1500);
  h = H.push(h, 'd', 'dim', 1900);
  assert.deepEqual(h.past, ['a']);
  h = H.push(h, 'e', 'blur', 2000);
  h = H.undo(h);
  assert.equal(h.present, 'd');
  h = H.undo(h);
  assert.equal(h.present, 'a');
  h = H.redo(h);
  assert.equal(h.present, 'd');
});

test('drafts: one key per household and screen, old ones dropped, all of them on sign-out', ts, () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
    key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
  };
  try {
    assert.equal(D.draftKey(null, 's_1'), 'marco.canvasDraft.local.s_1');
    assert.equal(D.draftKey('../x', 's_1'), 'marco.canvasDraft.local.s_1');
    const cv = defaultCanvas();
    D.saveDraft('h1', 's_1', { at: Date.now(), canvas: cv });
    assert.ok(D.loadDraft('h1', 's_1'));
    assert.equal(D.loadDraft('h2', 's_1'), null, 'another household never sees it');
    assert.deepEqual(D.loadDraft('h1', 's_1').canvas, cv, 'a draft of today comes back as it was');
    // a draft an editor kept before 0.17, on the old 12×8 grid: read on today's grid, every box doubled
    const old = { ...cv, items: [{ id: 'cv_old00001', kind: 'date', pos: { zone: 'main', x: 3, y: 2, size: 's' }, style: {}, props: {} }] };
    delete old.grid;
    D.saveDraft('h1', 's_3', { at: Date.now(), canvas: old });
    const up = D.loadDraft('h1', 's_3').canvas;
    assert.equal(up.grid, 'fine');
    assert.deepEqual(up.items[0].pos, { zone: 'main', x: 6, y: 4, size: 's' });
    D.saveDraft('h1', 's_2', { at: Date.now() - D.DRAFT_TTL_MS - 1, canvas: cv });
    D.pruneDrafts();
    assert.equal(mem.has('marco.canvasDraft.h1.s_2'), false);
    D.pruneDrafts(true);
    assert.equal(mem.size, 0);
  } finally {
    delete globalThis.localStorage;
  }
});

test('geometry: cells, the pointer cell and the sidebar slots line up with the display rules', ts, () => {
  const cv = defaultCanvas();
  const g = G.computeGeometry(cv, 'landscape');
  const a = G.cellBox(g, 'landscape', 0, 0, 1, 1);
  const b = G.cellBox(g, 'landscape', 23, 15, 1, 1);
  assert.ok(Math.abs(a.x - 24) < 0.6 && Math.abs(b.x + b.w - (1920 - 24)) < 0.6, JSON.stringify([a, b]));
  // two cells and their gap are exactly one cell of the old 12×8 grid (a converted screen looks the same)
  const gap = G.cellBox(g, 'landscape', 1, 0, 1, 1).x - a.x - a.w;
  const old = (1920 - 48 - 11 * gap) / 12;
  const two = G.cellBox(g, 'landscape', 2, 2, 2, 2);
  assert.ok(Math.abs(two.w - old) < 0.6 && Math.abs(two.x - (24 + old + gap)) < 0.6, JSON.stringify([two, old, gap]));
  for (const [x, y] of [[0, 0], [10, 6], [23, 15]]) {
    const c = G.cellBox(g, 'landscape', x, y, 1, 1);
    assert.deepEqual(G.cellAt(g, 'landscape', c.x + c.w / 2, c.y + c.h / 2), { x, y, inside: true });
  }
  const side = G.computeGeometry({ ...cv, sidebar: { side: 'top', size: 'normal', fill: 'glass' } }, 'landscape');
  assert.equal(side.row, true);
  const s1 = G.sideBox(side, 0, 4);
  const s2 = G.sideBox(side, 4, 4);
  assert.ok(s1.x + s1.w < s2.x);
  assert.equal(G.sideIndexAt(side, [s1, s2], s1.x + 1, s1.y + 1), 0);
  assert.equal(G.sideIndexAt(side, [s1, s2], s2.x + s2.w, s2.y + 1), 2);
  // left and right go on top and at the bottom of a portrait screen
  assert.equal(G.computeGeometry({ ...cv, sidebar: { side: 'left', size: 'normal', fill: 'glass' } }, 'portrait').row, true);
});

test('palette search: tags in five languages, the group name and tags, no case or accents', ts, () => {
  const find = (q) => K.PALETTE_KINDS.filter((k) => K.matchesSearch(q, { kind: k, name: K.KIND_META[k].name, help: K.KIND_META[k].help, group: K.groupOf(k) })).sort();
  const ha = K.PALETTE_KINDS.filter((k) => k.startsWith('ha.'));
  // every Home Assistant card, the Valor, the Sección and the HTML card for "home assistant", in any case
  for (const q of ['home assistant', 'Home Assistant', 'HASS', 'domotica', 'smart home']) {
    const got = find(q);
    for (const k of [...ha, 'value', 'heading', 'html']) assert.ok(got.includes(k), `${q}: ${k}`);
    assert.ok(!got.includes('clock.digital') && !got.includes('calendar.month'), q);
  }
  // "ha" is a whole word: not every kind with an h and an a
  assert.ok(find('ha').includes('ha.light') && !find('ha').includes('weather.hourly'));
  assert.ok(find('bitcoin').includes('market') && find('futbol').includes('sports') && find('Fútbol').includes('sports') && find('stocks').includes('stocks'));
  for (const k of ['clock.digital', 'clock.analog', 'clock.flip', 'clock.world', 'date']) assert.ok(find('reloj').includes(k) && find('time').includes(k), k);
  assert.ok(find('ninos').includes('family.routines') && find('kids').includes('family.points'));
  assert.ok(find('persiana').includes('ha.cover') && find('blind').includes('ha.cover') && find('rolluik').includes('ha.cover'));
  // the group's name finds its cards too
  assert.ok(find('casa').includes('ha.room'));
  // every kind has tags
  assert.deepEqual(K.PALETTE_KINDS.filter((k) => !K.KIND_META[k].tags), []);
});

test('entity picker search: name, id, area and the kind in five languages, no case or accents', ts, () => {
  const e = (entity_id, name, area = '') => ({ entity_id, name, area, domain: entity_id.split('.')[0], state: 'on' });
  const list = [e('light.salon_techo', 'Techo del Salón', 'Salón'), e('cover.dormitorio', 'Persiana', 'Dormitorio'), e('sensor.temp_cocina', 'Temperatura', 'Cocina'), e('switch.enchufe_tv', 'Enchufe TV')];
  const find = (q) => list.filter((x) => HS.haEntityMatches(x, q)).map((x) => x.entity_id);
  assert.deepEqual(find('salon'), ['light.salon_techo']);
  assert.deepEqual(find('SALÓN'), ['light.salon_techo']);
  assert.deepEqual(find('luz'), ['light.salon_techo']);
  assert.deepEqual(find('blind'), ['cover.dormitorio']);
  assert.deepEqual(find('roleta'), ['cover.dormitorio']);
  assert.deepEqual(find('temp cocina'), ['sensor.temp_cocina']);
  assert.deepEqual(find('enchufe'), ['switch.enchufe_tv']);
  assert.equal(find('').length, 4);
});

test('entity picker list: grouped by area (none last), by name inside; by domain when there are no areas', ts, () => {
  const e = (entity_id, name, area = '') => ({ entity_id, name, area, domain: entity_id.split('.')[0], state: 'on' });
  const list = [
    e('light.b', 'Techo', 'Salón'), e('sensor.x', 'Suelto'), e('light.a', 'Lámpara', 'Salón'), e('switch.c', 'Enchufe', 'Cocina'),
    e('sensor.t', 'Temperatura', 'Baño'),
  ];
  const rows = (q) => HS.haEntityGroups(list, q, 'Sin habitación').map((m) => `${m.group}/${m.e.name}`);
  assert.deepEqual(rows(''), ['Baño/Temperatura', 'Cocina/Enchufe', 'Salón/Lámpara', 'Salón/Techo', 'Sin habitación/Suelto']);
  assert.deepEqual(rows('SALON'), ['Salón/Lámpara', 'Salón/Techo']);
  assert.deepEqual(rows('luz'), ['Salón/Lámpara', 'Salón/Techo']);
  assert.deepEqual(rows('nada'), []);
  // a token of a user who is not an administrator: no areas at all
  const flat = list.map((x) => ({ ...x, area: '' }));
  assert.deepEqual(HS.haEntityGroups(flat, '', 'Sin habitación').map((m) => m.group), ['light', 'light', 'sensor', 'sensor', 'switch']);
});

test('builder texts: every string in Spanish, English, Portuguese, Dutch and Danish, no em dashes', ts, () => {
  const keys = new Set();
  const dir = new URL('../../web/admin/builder/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => /\.tsx?$/.test(x))) {
    const s = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
    const re = /const REFUSALS[^=]*= \{([\s\S]*?)\n\};/.exec(s);
    if (re) for (const m of re[1].matchAll(/: '((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  }
  for (const g of K.GROUPS) keys.add(g.name);
  keys.add(K.AWAY_NOTE);
  for (const m of Object.values(K.KIND_META)) keys.add(m.name).add(m.help);
  for (const v of [...Object.values(K.SIZE_LABEL), ...Object.values(K.SPAN_LABEL)]) keys.add(v);
  for (const list of Object.values(F.FIELDS)) for (const s of list) {
    for (const k of [s.label, s.hint, s.text, s.go?.label]) if (k) keys.add(k);
    for (const o of s.opts ?? []) if (!/^\d+$/.test(o.l)) keys.add(o.l);
  }
  const all = [...keys];
  assert.ok(all.length > 300, `${all.length} keys`);
  const NL = { ...nl.NL, ...fam.NL_FAMILY };
  const DA = { ...da.DA, ...fam.DA_FAMILY };
  assert.deepEqual(all.filter((k) => !(k in dict.EN) || !(k in dict.PT) || !(k in NL) || !(k in DA)), []);
  const src = fs.readFileSync(new URL('../../web/admin/i18n-dict-builder.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /—/);
});

test('wiring: the display reports its boxes only in the builder preview, the admin trusts only its own frame', () => {
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const main = read('web/display/main.ts');
  assert.match(main, /isPreview && params\.get\('builder'\) === '1'/);
  assert.match(main, /type: 'marco:canvas-rects'/);
  const stage = read('web/admin/builder/Stage.tsx');
  assert.match(stage, /e\.source !== frame\.current\?\.contentWindow \|\| e\.origin !== origin/);
  assert.match(stage, /pointer-events|bld-frame/);
  // drag styles go through the CSSOM (style objects), never inline style strings
  for (const f of ['Stage.tsx', 'Palette.tsx', 'BuilderModal.tsx', 'Inspector.tsx']) assert.doesNotMatch(read(`web/admin/builder/${f}`), /style="|setAttribute\('style'/);
  // the builder is its own chunk, loaded when the editor opens; drafts go on sign-out
  assert.match(read('web/admin/sections/Layout.tsx'), /import\('\.\.\/builder\/BuilderModal'\)/);
  assert.match(read('web/admin/App.tsx'), /pruneDrafts\(true\)/);
});

test('flexible sizes: W and H steppers, the corner handle (nearest legal box, never over a card), Ajustar tamaño and the rules every move keeps', ts, () => {
  let cv = defaultCanvas();
  const a = M.addItem(cv, 'landscape', 'todo', { zone: 'main', drop: { x: 0, y: 0, size: 't' } });
  cv = ok(a);
  const b = M.addItem(cv, 'landscape', 'news', { zone: 'main', drop: { x: 10, y: 0, size: 'w' } });
  cv = ok(b);
  // H + 1, + 1: a box of its own (6×10), then 6×12
  cv = ok(M.setCells(cv, 'landscape', a.id, 6, 9));
  cv = ok(M.setCells(cv, 'landscape', a.id, 6, 10));
  cv = ok(M.setCells(cv, 'landscape', a.id, 6, 12));
  assert.deepEqual(M.itemOf(cv, a.id).pos, { zone: 'main', x: 0, y: 0, size: 't', w: 6, h: 12 });
  valid(cv);
  assert.deepEqual(M.boxCells(M.itemOf(cv, a.id).pos, 'landscape'), [6, 12]);
  // past the kind's range: refused with 'limit' (the to-do list is 4×2 to 12×16)
  assert.equal(M.setCells(cv, 'landscape', a.id, 6, 17).why, 'limit');
  assert.equal(M.setCells(cv, 'landscape', a.id, 3, 12).why, 'limit');
  // wider into the news card: kept at its origin is impossible, so it goes to the nearest free spot, never over it
  const w = M.setCells(cv, 'landscape', a.id, 12, 12);
  if (w.ok) valid(w.cv);
  // the handle: dragged over the news card, the legal box nearest to the pointer that leaves it alone
  const box = M.handleBox(cv, 'landscape', a.id, 16, 12);
  assert.deepEqual(M.boxCells(box, 'landscape'), [10, 12]);
  cv = ok(M.applyBox(cv, 'landscape', a.id, box));
  valid(cv);
  // dragged past the smallest: the smallest
  assert.deepEqual(M.boxCells(M.handleBox(cv, 'landscape', a.id, 1, 1), 'landscape'), [4, 2]);
  // the same box again changes nothing
  assert.equal(M.applyBox(cv, 'landscape', a.id, M.itemOf(cv, a.id).pos).ok, false);
  // a tap on the handle steps the named sizes, from about the box's area
  const st = M.stepSize(cv, 'landscape', a.id, -1);
  assert.equal(st.ok, true);
  assert.equal(M.itemOf(st.cv, a.id).pos.w, undefined);
  // the keyboard and the arrows move a box of its own whole
  const n = ok(M.nudge(cv, 'landscape', a.id, 0, 1));
  assert.deepEqual(M.itemOf(n, a.id).pos, { ...M.itemOf(cv, a.id).pos, y: 1 });
  valid(n);
  // Ajustar tamaño: the content is 1.4 times taller than the box: the smallest larger box with room
  let small = ok(M.setCells(cv, 'landscape', a.id, 6, 6));
  const f = ok(M.fitContent(small, 'landscape', a.id, { w: 1, h: 1.4 }));
  assert.deepEqual(M.boxCells(M.itemOf(f, a.id).pos, 'landscape'), [6, 9]);
  valid(f);
  // nothing larger has room: say so
  const full = ok(M.addItem(defaultCanvas(), 'landscape', 'ha.switch', { zone: 'main', drop: { x: 0, y: 0, size: 'xs' } }));
  let packed = full;
  for (let x = 4; x < 24; x += 4) for (let y = 0; y < 16; y += 4) packed = ok(M.addItem(packed, 'landscape', 'spacer', { zone: 'main', drop: { x, y, size: 'xs' } }));
  for (const y of [4, 8, 12]) packed = ok(M.addItem(packed, 'landscape', 'spacer', { zone: 'main', drop: { x: 0, y, size: 'xs' } }));
  assert.equal(M.fitContent(packed, 'landscape', M.tabOrder(full, 'landscape')[0]).why, 'noBigger');
  // a swap only between cards that take the same cells
  small = ok(M.setCells(cv, 'landscape', a.id, 12, 4));
  const pa = M.itemOf(small, a.id).pos;
  const pb = M.itemOf(small, b.id).pos;
  const sw = M.resolveMain(small, 'landscape', pa, pb.x, pb.y, { id: a.id, at: { x: pb.x, y: pb.y } });
  assert.equal(sw?.swap, b.id, 'a 12×4 to-do list and a 12×4 news card swap places');
  small = ok(M.setCells(small, 'landscape', a.id, 10, 4));
  const pa2 = M.itemOf(small, a.id).pos;
  assert.notEqual(M.resolveMain(small, 'landscape', pa2, pb.x, pb.y, { id: a.id, at: { x: pb.x, y: pb.y } })?.swap, b.id, 'a 10×4 one does not');
  // portrait drawn from a box of its own keeps it, and editing portrait copies it
  const pc = M.editPortrait(cv);
  assert.deepEqual(M.boxCells(M.itemOf(pc, a.id).portrait, 'portrait'), M.boxCells(M.itemOf(cv, a.id).pos, 'landscape'));
  assert.ok(M.noOverlap(pc));
  // into the sidebar: its height makes the span (two rows each, the unit of the spans)
  assert.equal(M.spanForBox({ size: 't', w: 6, h: 12 }, 'landscape'), 4);
  assert.equal(M.spanForBox({ size: 't', w: 6, h: 6 }, 'landscape'), 3);
  assert.equal(M.spanForBox({ size: 'row', w: 4, h: 2 }, 'landscape'), 2);
  assert.equal(M.spanForBox({ size: 'row', w: 2, h: 1 }, 'landscape'), 2);
});

test('palette on Marco Cloud: the Home Assistant cards and HTML propio are out of the edition, the Casa group has nothing else', ts, () => {
  const away = K.PALETTE_KINDS.filter((k) => K.outOfEdition(k, { cloud: true }));
  assert.deepEqual(away.sort(), [...K.PALETTE_KINDS.filter((k) => k.startsWith('ha.')), 'html'].sort());
  // nothing is out on a self-hosted server, and every kind Cloud can draw stays a tile there
  assert.deepEqual(K.PALETTE_KINDS.filter((k) => K.outOfEdition(k, { cloud: false })), []);
  for (const k of K.PALETTE_KINDS) if (!away.includes(k)) assert.ok(CLOUD_CANVAS_KINDS.includes(k), k);
  // so Casa folds on Cloud (every kind of the group is out), while Avanzado keeps Espacio
  assert.ok(K.PALETTE_KINDS.filter((k) => K.groupOf(k) === 'home').every((k) => away.includes(k)));
  assert.ok(K.PALETTE_KINDS.some((k) => K.groupOf(k) === 'adv' && !away.includes(k)));
  assert.equal(dict.EN[K.AWAY_NOTE], 'Only on the self-hosted version');
});

test('a Rotativa from a palette tile of its own (Cambiar según Casa, #19): its cards and their conditions, new ids each time', ts, () => {
  const spec = {
    cards: [
      { id: '', kind: 'ha.tile', props: {}, when: { src: 'ha', entity: '', op: 'eq', value: 'off' } },
      { id: '', kind: 'ha.camera', props: {}, when: { src: 'ha', entity: '', op: 'eq', value: 'on' } },
    ],
  };
  let cv = defaultCanvas();
  const a = M.addItem(cv, 'landscape', 'rotator', null, spec);
  cv = ok(a);
  const first = M.itemOf(cv, a.id).props.cards.map((c) => c.id);
  const b = M.addItem(cv, 'landscape', 'rotator', null, spec);
  cv = ok(b);
  const cards = M.itemOf(cv, b.id).props.cards;
  assert.deepEqual(cards.map((c) => [c.kind, c.when.value]), [['ha.tile', 'off'], ['ha.camera', 'on']]);
  // the tile's props are not shared: the first Rotativa keeps its ids, every id is its own
  assert.deepEqual(M.itemOf(cv, a.id).props.cards.map((c) => c.id), first);
  assert.equal(new Set([...first, ...cards.map((c) => c.id)]).size, 4);
  assert.deepEqual(spec.cards.map((c) => c.id), ['', '']);
  // the server keeps the cards and their conditions
  const c = clean();
  const out = sanitizeCanvas(c, 'canvas', structuredClone(cv), {}, {});
  assert.deepEqual(c.errors, []);
  assert.deepEqual(out.items[1].props.cards.map((x) => x.when.value), ['off', 'on']);
});

test('a Rotativa with a group (#19, Cambiar un espacio según Casa): new ids for the group and its cards, its cards count, the box holds it', ts, () => {
  const tile = () => ({ id: '', kind: 'ha.tile', props: {} });
  const spec = {
    cards: [
      { id: '', kind: 'ha.camera', props: {}, when: { src: 'ha', entity: '', op: 'eq', value: 'on' } },
      { id: '', kind: 'group', props: { dir: 'rows', cards: [tile(), tile(), tile()] }, when: { src: 'ha', entity: '', op: 'eq', value: 'off' } },
    ],
  };
  let cv = defaultCanvas();
  const a = M.addItem(cv, 'landscape', 'rotator', null, spec);
  cv = ok(a);
  const ids = (it) => it.props.cards.flatMap((c) => (c.kind === 'group' ? [c.id, ...c.props.cards.map((m) => m.id)] : [c.id]));
  const first = ids(M.itemOf(cv, a.id));
  assert.equal(first.length, 5);
  assert.ok(first.every((id) => /^cv_[a-z0-9]{8}$/.test(id)), first.join());
  // a copy: every id new, the group's too
  const d = M.duplicateItem(cv, 'landscape', a.id);
  cv = ok(d);
  const copy = ids(M.itemOf(cv, d.id));
  assert.equal(new Set([...first, ...copy, a.id, d.id]).size, 12);
  assert.deepEqual(spec.cards[1].props.cards.map((c) => c.id), ['', '', '']);
  // the cards of a group count as cards of the screen (2 Rotativas: 2 + 2 × 4 = 10), the group does not
  assert.equal(M.cardCount(cv), 10);
  assert.deepEqual(M.cardKinds(spec.cards), ['ha.camera', 'ha.tile', 'ha.tile', 'ha.tile']);
  // 35 spacers more: 45 cards, and a third Rotativa needs five (itself, the camera and the group's three): too many
  const nearly = structuredClone(cv);
  for (let i = 0; i < 35; i++) nearly.items.push({ id: `cv_x${String(i).padStart(7, '0')}`, kind: 'spacer', pos: { zone: 'main', x: i % 24, y: 15, size: 'xs', w: 1, h: 1 }, style: {}, props: {} });
  assert.equal(M.cardCount(nearly), 45);
  assert.equal(M.addItem(nearly, 'landscape', 'rotator', null, spec).why, 'tooMany');
  // as small as its cards allow: 3×3 (the camera's width, three rows of entity cards); columns: 6×2
  const it = M.itemOf(cv, a.id);
  const r = M.rangeOf(M.sizingOf(it), 'landscape');
  assert.deepEqual([r.minW, r.minH], [3, 3]);
  const colsIt = structuredClone(it);
  colsIt.props.cards[1].props.dir = 'cols';
  const rc = M.rangeOf(M.sizingOf(colsIt), 'landscape');
  assert.deepEqual([rc.minW, rc.minH], [6, 2]);
  // a fourth card in the group needs a taller box: it grows in place
  const one = ok(M.addItem(defaultCanvas(), 'landscape', 'rotator', null, spec));
  const rid = one.items.at(-1).id;
  const small = ok(M.setCells(one, 'landscape', rid, 3, 3));
  M.itemOf(small, rid).props.cards[1].props.cards.push({ id: 'cv_fourth01', kind: 'ha.tile', props: {} });
  const g = M.growToCards(small, rid);
  assert.deepEqual(g.grown, ['landscape']);
  assert.deepEqual(M.boxCells(M.placements(g.cv, 'landscape').get(rid), 'landscape'), [3, 4]);
  // the server keeps all of it
  const c = clean();
  const out = sanitizeCanvas(c, 'canvas', structuredClone(cv), {}, {});
  assert.deepEqual(c.errors, []);
  assert.deepEqual(out.items[0].props.cards.map((x) => [x.kind, x.when.value]), [['ha.camera', 'on'], ['group', 'off']]);
});

test('more than one Rotativa on a screen (#21): up to four from the palette, then the kind is at its cap; the server keeps them', ts, () => {
  let cv = defaultCanvas();
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const r = M.addItem(cv, 'landscape', 'rotator', null);
    cv = ok(r);
    ids.push(r.id);
  }
  assert.equal(new Set(ids).size, 4);
  assert.equal(cv.items.filter((i) => i.kind === 'rotator').length, 4);
  assert.equal(M.addItem(cv, 'landscape', 'rotator', null).why, 'kindCap');
  assert.equal(M.duplicateItem(cv, 'landscape', ids[0]).why, 'kindCap');
  // a copy of the second while there are only two
  const two = structuredClone(cv);
  two.items = two.items.filter((i) => i.id !== ids[2] && i.id !== ids[3]);
  assert.equal(ok(M.duplicateItem(two, 'landscape', ids[1])).items.filter((i) => i.kind === 'rotator').length, 3);
  valid(cv);
});

test('a small Rotativa (#19): it starts at its first card\'s size, goes down to what its cards need, and grows when a card needs more', ts, () => {
  const spec = { cards: [{ id: '', kind: 'ha.tile', props: {} }, { id: '', kind: 'ha.camera', props: {} }] };
  let cv = defaultCanvas();
  const a = M.addItem(cv, 'landscape', 'rotator', null, spec);
  cv = ok(a);
  // as small as the light (the Entidad's own size), not the wide box of the weather Rotativa
  assert.deepEqual(M.boxCells(M.placements(cv, 'landscape').get(a.id), 'landscape'), [4, 4]);
  // the steppers and the handle: down to the camera's 3×2, up to the whole screen
  const it = M.itemOf(cv, a.id);
  assert.deepEqual(M.rangeOf(M.sizingOf(it), 'landscape'), { minW: 3, minH: 2, maxW: 24, maxH: 16 });
  cv = ok(M.setCells(cv, 'landscape', a.id, 4, 2));
  assert.deepEqual(M.boxCells(M.placements(cv, 'landscape').get(a.id), 'landscape'), [4, 2]);
  assert.equal(M.setCells(cv, 'landscape', a.id, 4, 1).why, 'limit');
  // a sensor and a gauge go down to one row
  const sgCv = ok(M.addItem(defaultCanvas(), 'landscape', 'rotator', null, { cards: [{ id: '', kind: 'ha.sensor', props: {} }, { id: '', kind: 'ha.gauge', props: {} }] }));
  const sgId = sgCv.items.at(-1).id;
  const sgRange = M.rangeOf(M.sizingOf(M.itemOf(sgCv, sgId)), 'landscape');
  assert.deepEqual([sgRange.minW, sgRange.minH], [3, 1]);
  // a weather card added inside: the box grows at its place to the 8×2 the hourly strip needs
  const more = structuredClone(cv);
  M.itemOf(more, a.id).props.cards.push({ id: 'cv_hourly01', kind: 'weather.hourly', props: {} });
  const g = M.growToCards(more, a.id);
  assert.deepEqual(g.grown, ['landscape']);
  assert.deepEqual(g.stuck, []);
  const p = M.placements(g.cv, 'landscape').get(a.id);
  assert.deepEqual([p.x, p.y, ...M.boxCells(p, 'landscape')], [0, 0, 8, 2]);
  // nothing to do when it already fits; no room at all: said, and the box stays
  assert.deepEqual(M.growToCards(g.cv, a.id).grown, []);
  const full = structuredClone(more);
  for (let y = 0; y < 16; y += 2) for (let x = 0; x < 24; x += 4) if (y >= 2 || x >= 4) full.items.push({ id: `cv_sp${String(x).padStart(2, '0')}${String(y).padStart(2, '0')}00`, kind: 'spacer', pos: { zone: 'main', x, y, size: 'xs', w: 4, h: 2 }, style: {}, props: {} });
  const s2 = M.growToCards(full, a.id);
  assert.deepEqual(s2.stuck, ['landscape']);
  assert.deepEqual(M.boxCells(M.placements(s2.cv, 'landscape').get(a.id), 'landscape'), [4, 2]);
});
