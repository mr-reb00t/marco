// Personalizado (layout 'canvas', server/core/canvasCore.js): the registry, sizes, validation, the portrait derivation
// and the templates, plus how validate.js and defaults.js carry a screen's canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VALUE_KEY_RE, CANVAS_GRID, CANVAS_KINDS, DESIGN_TEMPLATES, canvasFromDesign, projectCanvas, CANVAS_KIND_IDS, CANVAS_LIMITS, CANVAS_SIZES, CANVAS_TEMPLATES, CLOUD_CANVAS_KINDS, DEFAULT_CANVAS_KINDS,
  canvasDefaults, canvasFromTemplate, cssProblem, defaultCanvas, defaultItemStyle, deriveCanvasPortrait, newCanvasId, normalizeGlassJs, sanitizeCanvas, sizeCells,
  boxAllowed, boxOf, cellRange, fullLookMin, lookSize, posCells,
} from '../core/canvasCore.js';
import { validateConfig, mergeDefaults, LAYOUT_PRESETS } from '../core/validate.js';
import { defaultConfig, defaultScreenProfile, SCREEN_ONLY_KEYS } from '../core/defaults.js';

const collector = () => {
  const c = { errors: [], warnings: [] };
  c.err = (path, message) => c.errors.push({ path, message });
  c.warn = (path, message) => c.warnings.push({ path, message });
  return c;
};
const item = (kind, pos, extra = {}) => ({ id: newCanvasId(), kind, pos, style: defaultItemStyle(), props: canvasDefaults(kind), ...extra });
const M = (x, y, size) => ({ zone: 'main', x, y, size });
const S = (order, span) => ({ zone: 'side', order, span });
const run = (raw, refs = {}, opts = {}) => {
  const c = collector();
  const out = sanitizeCanvas(c, 'canvas', { ...defaultCanvas(), ...raw }, refs, opts);
  return { c, out };
};
/** Main-zone boxes never overlap and stay inside the grid. */
function assertNoOverlap(items, orientation = 'landscape', key = 'pos') {
  const { cols, rows } = CANVAS_GRID[orientation];
  const cells = new Set();
  for (const it of items) {
    const p = it[key];
    if (!p || p.zone !== 'main') continue;
    const [w, h] = posCells(p, orientation);
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + w <= cols && p.y + h <= rows, `${it.kind} outside the grid: ${JSON.stringify(p)}`);
    for (let y = p.y; y < p.y + h; y++) {
      for (let x = p.x; x < p.x + w; x++) {
        assert.ok(!cells.has(`${x},${y}`), `${it.kind} overlaps at ${x},${y}`);
        cells.add(`${x},${y}`);
      }
    }
  }
}

test('registry: every kind of the spec and of the owner amendments is reserved, with valid sizes and defaults', () => {
  const want = [
    'clock.digital', 'clock.analog', 'clock.flip', 'clock.world', 'date',
    'calendar.month', 'calendar.week', 'calendar.agenda', 'calendar.today', 'calendar.next', 'calendar.people', 'countdowns',
    'weather.now', 'weather.hourly', 'weather.forecast', 'weather.cities',
    'message', 'todo', 'news', 'photo', 'widget', 'value', 'spacer', 'heading', 'rotator',
    'nav.button', 'nav.pause', 'nav.progress',
    'family.members', 'family.routines', 'family.points', 'family.rewards', 'family.chores', 'meals.today', 'meals.week', 'birthdays', 'highlights', 'announcement',
    'ha.tile', 'ha.light', 'ha.switch', 'ha.climate', 'ha.cover', 'ha.sensor', 'ha.room', 'ha.chart', 'ha.camera', 'ha.media', 'ha.scene',
    'ha.gauge', 'ha.statistic',
    'market', 'sports', 'stocks', 'currency',
    'nowplaying',
    'html', 'card',
  ];
  assert.deepEqual([...CANVAS_KIND_IDS].sort(), [...want].sort());
  for (const k of CANVAS_KIND_IDS) {
    const def = CANVAS_KINDS[k];
    assert.ok(def.sizes.length && def.sizes.every((s) => s in CANVAS_SIZES), k);
    assert.ok(def.sizes.includes(def.def), `${k}: default size ${def.def} not allowed`);
    assert.ok(['time', 'calendar', 'weather', 'content', 'nav', 'family', 'home', 'data', 'adv'].includes(def.cat), k);
    // the defaults pass their own validation with no error
    const c = collector();
    const props = def.props(c, 'p', canvasDefaults(k), {}, {});
    assert.deepEqual(c.errors, [], `${k}: ${JSON.stringify(c.errors)}`);
    assert.deepEqual(props, canvasDefaults(k), `${k}: defaults change when validated`);
  }
  // the family kinds go in their own palette category
  for (const k of want.filter((x) => x.startsWith('family.') || x.startsWith('meals.'))) assert.equal(CANVAS_KINDS[k].cat, 'family', k);
  assert.equal(CANVAS_KINDS.card.reserved, true);
  assert.equal(DEFAULT_CANVAS_KINDS.includes('card'), false);
  // Marco Cloud: no Home Assistant and no custom HTML
  assert.equal(CLOUD_CANVAS_KINDS.some((k) => k.startsWith('ha.') || k === 'html' || k === 'card'), false);
  for (const k of ['clock.digital', 'calendar.month', 'value', 'photo', 'widget', 'family.routines', 'meals.week', 'heading']) assert.ok(CLOUD_CANVAS_KINDS.includes(k), k);
});

test('size table: the grid is 24×16 (16×24 portrait), every named size fits it', () => {
  assert.deepEqual(CANVAS_GRID, { landscape: { cols: 24, rows: 16 }, portrait: { cols: 16, rows: 24 } });
  assert.deepEqual(sizeCells('m', 'landscape'), [8, 6]);
  assert.deepEqual(sizeCells('band', 'portrait'), [16, 6]);
  assert.deepEqual(sizeCells('full', 'landscape'), [24, 16]);
  assert.deepEqual(sizeCells('full', 'portrait'), [16, 24]);
  for (const name of Object.keys(CANVAS_SIZES)) {
    const [lw, lh] = sizeCells(name, 'landscape');
    const [pw, ph] = sizeCells(name, 'portrait');
    assert.ok(lw <= 24 && lh <= 16, name);
    assert.ok(pw <= 16 && ph <= 24, name);
  }
});

test('defaults: an inert canvas on every screen, back-filled for configs saved before it', () => {
  assert.ok(SCREEN_ONLY_KEYS.includes('canvas'));
  assert.ok(LAYOUT_PRESETS.includes('canvas'));
  assert.deepEqual(defaultScreenProfile().canvas, defaultCanvas());
  assert.deepEqual(defaultCanvas(), {
    v: 1, background: 'ambient', dim: 0.15, scrim: 'uniform', color: null, sidebar: { side: 'none', size: 'normal', fill: 'glass' },
    defaults: { surface: 'glass', radius: 'l' }, touch: false, swipe: false, perf: 'auto', portraitAuto: true, grid: 'fine', items: [],
  });
  const c = defaultConfig();
  delete c.screens[0].canvas;
  const merged = mergeDefaults(c);
  assert.deepEqual(merged.screens[0].canvas, defaultCanvas());
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.screens[0].canvas, defaultCanvas());
  assert.deepEqual(r.warnings, []);
});

test('validateConfig: the canvas preset is Modern only, items keep their ids, errors carry the screen path', () => {
  const c = defaultConfig();
  c.screens[0].screen.style = 'classic';
  c.screens[0].layout.preset = 'canvas';
  const a = item('clock.digital', M(0, 0, 'm'));
  c.screens[0].canvas = { ...defaultCanvas(), items: [a, { ...item('weather.now', M(4, 0, 's')), props: { meta: 'yes' } }] };
  const r = validateConfig(c);
  assert.equal(r.value.screens[0].screen.style, 'modern');
  assert.equal(r.value.screens[0].canvas.items[0].id, a.id);
  assert.ok(r.errors.some((e) => e.path === 'screens[0].canvas.items[1].props.meta'), JSON.stringify(r.errors));
  // another layout keeps its style: the canvas is inert there
  const c2 = defaultConfig();
  c2.screens[0].screen.style = 'classic';
  c2.screens[0].canvas = { ...defaultCanvas(), items: [item('clock.digital', M(0, 0, 'm'))] };
  const r2 = validateConfig(c2);
  assert.equal(r2.ok, true, JSON.stringify(r2.errors));
  assert.equal(r2.value.screens[0].screen.style, 'classic');
  assert.equal(r2.value.screens[0].canvas.items.length, 1);
});

test('sizes: a size the kind does not allow becomes its default; boxes are clamped inside the grid', () => {
  const { c, out } = run({ items: [item('clock.digital', M(0, 0, 'full')), item('weather.now', M(22, 14, 's'))] });
  assert.equal(out.items[0].pos.size, 'm');
  assert.ok(c.warnings.some((w) => w.path.endsWith('.size')));
  // s is 6×4: x 22 → 18, y 14 → 12
  assert.deepEqual(out.items[1].pos, M(18, 12, 's'));
  assertNoOverlap(out.items);
});

test('overlap: a later item moves to the nearest free spot with a warning; with no room it is dropped with an error', () => {
  const { c, out } = run({ items: [item('clock.digital', M(0, 0, 'm')), item('clock.digital', M(2, 2, 'm'))] });
  assert.equal(out.items.length, 2);
  assertNoOverlap(out.items);
  assert.deepEqual(out.items[1].pos, M(2, 6, 'm'));
  assert.ok(c.warnings.some((w) => /moved/.test(w.message)));
  // a full-screen calendar leaves no room for anything else
  const full = run({ items: [item('calendar.month', M(0, 0, 'full')), item('clock.digital', M(0, 0, 'm'))] });
  assert.equal(full.out.items.length, 1);
  assert.ok(full.c.errors.some((e) => e.path === 'canvas.items[1]' && /no free space/.test(e.message)), JSON.stringify(full.c.errors));
  // the result is the same every time (the server, the admin and the display agree)
  const again = run({ items: [item('clock.digital', M(0, 0, 'm')), item('clock.digital', M(2, 2, 'm'))] });
  assert.deepEqual(again.out.items.map((i) => i.pos), out.items.map((i) => i.pos));
});

test('kinds: unknown ones are dropped quietly, reserved and not allowed ones with an error', () => {
  const { c, out } = run({ items: [{ kind: 'clock.word', pos: M(0, 0, 'm') }, item('card', M(0, 0, 'm')), item('ha.light', M(4, 0, 's')), item('clock.digital', M(8, 0, 'm'))] }, {}, { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.deepEqual(out.items.map((i) => i.kind), ['clock.digital']);
  assert.ok(c.errors.some((e) => e.path === 'canvas.items[1].kind' && /version/.test(e.message)));
  assert.ok(c.errors.some((e) => e.path === 'canvas.items[2].kind' && e.message === 'not available on this server'));
  assert.equal(c.errors.some((e) => e.path === 'canvas.items[0].kind'), false);
});

test('ids: cv_ + 8 characters, unique per screen; invalid or repeated ones get a new id', () => {
  const a = item('clock.digital', M(0, 0, 'm'));
  const { out } = run({ items: [a, { ...item('date', M(4, 0, 's')), id: a.id }, { ...item('date', M(8, 0, 's')), id: 'bad id' }] });
  const ids = out.items.map((i) => i.id);
  assert.equal(ids[0], a.id);
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) assert.match(id, /^cv_[a-z0-9]{8}$/);
});

test('caps: 48 items, 2 photos, 4 cameras, one live camera, 80 Home Assistant entities', () => {
  assert.deepEqual(CANVAS_LIMITS, { items: 48, side: 8, haEntities: 80, liveCameras: 1 });
  const many = [];
  for (let i = 0; i < 50; i++) many.push(item('spacer', M(0, 0, 'xs')));
  const r = run({ items: many });
  assert.ok(r.out.items.length <= CANVAS_LIMITS.items);
  assert.ok(r.c.errors.some((e) => /max 48/.test(e.message)));
  const photos = run({ items: [item('photo', M(0, 0, 's')), item('photo', M(3, 0, 's')), item('photo', M(6, 0, 's'))] });
  assert.equal(photos.out.items.length, 2);
  assert.ok(photos.c.errors.some((e) => /max 2/.test(e.message)));
  const cam = (e) => item('ha.camera', M(0, 0, 's'), { props: { ...canvasDefaults('ha.camera'), entity: e, mode: 'live' } });
  const cams = run({ items: [cam('camera.a'), cam('camera.b')] });
  assert.deepEqual(cams.out.items.map((i) => i.props.mode), ['live', 'snapshot']);
  const noLive = run({ items: [cam('camera.a')] }, {}, { cameraLive: false });
  assert.equal(noLive.out.items[0].props.mode, 'snapshot');
  const rooms = [];
  for (let i = 0; i < 14; i++) rooms.push(item('ha.room', M(0, 0, 'm'), { props: { title: '', rows: [0, 1, 2, 3, 4, 5].map((n) => ({ entity: `light.l${i}_${n}`, name: '', interactive: true })) } }));
  const ents = run({ items: rooms });
  assert.ok(ents.c.errors.some((e) => /max 80/.test(e.message)), JSON.stringify(ents.c.errors));
});

test('props: dangling calendars, members and widgets are dropped quietly; time zones are checked', () => {
  const refs = { sourceIds: new Set(['c1', 'local']), memberIds: new Set(['m_1']), widgets: new Map([['w_1', { id: 'w_1' }]]) };
  const { c, out } = run({
    items: [
      item('calendar.month', M(0, 0, 'l'), { props: { ...canvasDefaults('calendar.month'), sourceIds: ['c1', 'gone'] } }),
      item('calendar.agenda', M(6, 0, 'm'), { props: { ...canvasDefaults('calendar.agenda'), sourceIds: ['gone'] } }),
      item('calendar.people', M(0, 4, 'l'), { props: { ...canvasDefaults('calendar.people'), memberIds: ['m_1', 'm_2'] } }),
      item('widget', M(6, 4, 's'), { props: { widgetId: 'w_1' } }),
      item('widget', M(9, 4, 's'), { props: { widgetId: 'w_gone' } }),
      item('clock.world', M(6, 6, 's'), { props: { zones: [{ tz: 'Mars/Olympus', label: 'Mars' }, { tz: 'Pacific/Auckland', label: '' }], analog: false } }),
    ],
  }, refs);
  assert.deepEqual(out.items[0].props.sourceIds, ['c1']);
  assert.equal(out.items[1].props.sourceIds, null, 'an empty pick means every calendar of the screen');
  assert.deepEqual(out.items[2].props.memberIds, ['m_1']);
  assert.deepEqual(out.items.filter((i) => i.kind === 'widget').map((i) => i.props.widgetId), ['w_1']);
  const world = out.items.find((i) => i.kind === 'clock.world');
  assert.deepEqual(world.props.zones.map((z) => z.tz), ['UTC', 'Pacific/Auckland']);
  assert.ok(c.warnings.some((w) => /timezone/.test(w.message)));
  assert.equal(c.errors.length, 0, JSON.stringify(c.errors));
});

test('props: Home Assistant entities by domain, value keys, controls off when the server has none', () => {
  const { c, out } = run({
    items: [
      item('ha.light', M(0, 0, 's'), { props: { ...canvasDefaults('ha.light'), entity: 'switch.kitchen' } }),
      item('ha.switch', M(3, 0, 's'), { props: { ...canvasDefaults('ha.switch'), entity: 'fan.bedroom' } }),
      item('value', M(6, 0, 's'), { props: { ...canvasDefaults('value'), key: 'Solar Today' } }),
      item('value', M(9, 0, 's'), { props: { ...canvasDefaults('value'), key: 'solar.today' } }),
    ],
  }, {}, { haControls: false });
  assert.equal(out.items[0].props.entity, '');
  assert.ok(c.errors.some((e) => e.path === 'canvas.items[0].props.entity'));
  assert.equal(out.items[1].props.entity, 'fan.bedroom');
  assert.equal(out.items[1].interactive, false);
  assert.equal(out.items[2].props.key, '');
  assert.equal(out.items[3].props.key, 'solar.today');
  // a key is plain data: never the name of an object's own machinery
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    const r = run({ items: [item('value', M(0, 0, 's'), { props: { ...canvasDefaults('value'), key: bad } })] });
    assert.equal(r.out.items[0].props.key, '', bad);
  }
  assert.ok(VALUE_KEY_RE.test('proto.constructor') && VALUE_KEY_RE.test('__proto'));
  const on = run({ items: [item('ha.switch', M(0, 0, 's'), { props: { ...canvasDefaults('ha.switch'), entity: 'switch.a' } })] });
  assert.equal(on.out.items[0].interactive, true, 'control kinds default to interactive');
  assert.equal(run({ items: [item('clock.digital', M(0, 0, 'm'))] }).out.items[0].interactive, undefined);
});

test('custom card CSS: imports, fonts, external urls, expressions and placeholders are refused', () => {
  for (const bad of ['@import "x.css";', '@IMPORT url(a)', '@font-face { src: x }', 'a { background: url(https://x/y.png) }', "a{b:url('//x')}", 'a{width:expression(1)}', '</style>', 'a{content:"{{x}}"}']) {
    assert.ok(cssProblem(bad), bad);
  }
  assert.equal(cssProblem('a { color: red; background: url(data:image/png;base64,AAAA) }'), '');
  const { c, out } = run({ items: [item('html', M(0, 0, 'm'), { props: { ...canvasDefaults('html'), css: '@import "x"', html: '<b>{{{x}}}</b>' } })] });
  assert.equal(out.items[0].props.css, '');
  assert.ok(c.errors.some((e) => e.path.endsWith('.css')));
  assert.ok(c.errors.some((e) => e.path.endsWith('.html')));
});

test('sidebar: order renumbered, one fill, spans within 8, items move to the main area when it is off', () => {
  const { out } = run({
    sidebar: { side: 'left', size: 'normal', fill: 'glass' },
    items: [
      item('clock.digital', S(5, 4)), item('weather.now', S(1, 'fill')), item('date', S(2, 'fill')), item('calendar.next', S(3, 4)),
      // not allowed in the sidebar
      item('calendar.month', S(4, 2)),
    ],
  });
  const side = out.items.filter((i) => i.pos.zone === 'side').sort((a, b) => a.pos.order - b.pos.order);
  assert.deepEqual(side.map((i) => i.kind), ['weather.now', 'date', 'calendar.next', 'clock.digital']);
  assert.deepEqual(side.map((i) => i.pos.order), [0, 1, 2, 3]);
  assert.equal(side.filter((i) => i.pos.span === 'fill').length, 1);
  assert.ok(side.reduce((n, i) => n + (i.pos.span === 'fill' ? 0 : i.pos.span), 0) <= 8);
  assert.equal(out.items.find((i) => i.kind === 'calendar.month').pos.zone, 'main');
  // sidebar off: everything in the main area, nothing overlapping
  const off = run({ items: [item('clock.digital', S(0, 4)), item('weather.now', S(1, 4)), item('calendar.month', M(0, 0, 'l'))] });
  assert.ok(off.out.items.every((i) => i.pos.zone === 'main'));
  assertNoOverlap(off.out.items);
  // the photo cannot be both behind everything and in the sidebar
  assert.equal(run({ background: 'photo', sidebar: { side: 'left', size: 'wide', fill: 'photo' } }).out.sidebar.fill, 'glass');
  assert.equal(run({ background: 'ambient', sidebar: { side: 'left', size: 'wide', fill: 'photo' } }).out.sidebar.fill, 'photo');
});

test('canvas fields: enums, colours, numbers clamped; an unknown version resets with a warning', () => {
  const { c, out } = run({ background: 'video', dim: 3, color: 'red', perf: 'turbo', touch: 'yes' });
  assert.equal(out.background, 'ambient');
  assert.equal(out.dim, 0.6);
  assert.equal(out.color, null);
  assert.equal(out.perf, 'auto');
  // where "Oscurecer foto" darkens: all over (default), top and bottom, or the edges
  assert.equal(defaultCanvas().scrim, 'uniform');
  assert.equal(run({ scrim: 'edges' }).out.scrim, 'edges');
  assert.equal(run({ scrim: 'topBottom' }).out.scrim, 'topBottom');
  const sc = run({ scrim: 'center' });
  assert.equal(sc.out.scrim, 'uniform');
  assert.ok(sc.c.errors.some((e) => e.path === 'canvas.scrim'));
  assert.equal(out.touch, false);
  assert.ok(c.errors.length >= 4);
  const v2 = collector();
  assert.deepEqual(sanitizeCanvas(v2, 'canvas', { v: 2, items: [item('clock.digital', M(0, 0, 'm'))] }), defaultCanvas());
  assert.ok(v2.warnings.some((w) => w.path === 'canvas.v'));
  // item style: enums, colours, the text scale in 0.05 steps within 0.7..1.5
  const st = run({ items: [item('clock.digital', M(0, 0, 'm'), { style: { surface: 'glass', glass: { opacity: 5, blur: 99, tint: 'pink' }, color: '#ABCDEF', radius: 'xl', title: 'x'.repeat(60), scale: 1.63 } })] });
  const s = st.out.items[0].style;
  assert.equal(s.surface, 'glass');
  assert.deepEqual(s.glass, { appearance: 'auto', opacity: 1, blur: 40, tint: 'dark', edge: true });
  assert.equal(s.color, '#abcdef');
  assert.equal(s.title.length, 40);
  assert.equal(s.scale, 1.5);
  // a card's own glass also takes the automatic tint (light or dark after the photo behind it), the screen's does not
  const auto = run({ items: [item('clock.digital', M(0, 0, 'm'), { style: { glass: { tint: 'auto', opacity: 0.3, blur: 0, edge: false }, accent: '#12AB34' } })] });
  assert.deepEqual(auto.out.items[0].style.glass, { appearance: 'auto', opacity: 0.3, blur: 0, tint: 'auto', edge: false });
  assert.equal(auto.out.items[0].style.accent, '#12ab34');
  assert.equal(normalizeGlassJs({ tint: 'auto' }).tint, 'dark');
  assert.equal(normalizeGlassJs({ tint: 'auto' }, true).tint, 'auto');
  assert.equal(normalizeGlassJs({ tint: 'pink' }, true).tint, 'dark');
  const bad = collector();
  sanitizeCanvas(bad, 'canvas', { v: 1, items: [item('clock.digital', M(0, 0, 'm'), { style: { glass: 'frosted', color: 'red', accent: '#12' } })] });
  assert.deepEqual(bad.errors.map((e) => e.path).sort(), ['canvas.items[0].style.accent', 'canvas.items[0].style.color', 'canvas.items[0].style.glass']);
});

// Portrait derivation golden fixtures: the landscape layouts of the templates, arranged for a portrait screen.
const PORTRAIT_GOLDEN = {
  // the next-events band no longer fits under the forecast: left out of the portrait view
  calendarWeather: { placed: [['calendar.month', 0, 0, 'xl'], ['clock.digital', 0, 12, 'm'], ['weather.now', 8, 12, 'm'], ['weather.forecast', 0, 18, 'w']], omitted: ['calendar.next'] },
  bedroom: { placed: [['clock.analog', 0, 0, 'xl'], ['calendar.agenda', 0, 12, 's'], ['weather.now', 8, 12, 'xs']], omitted: [] },
  halfHalf: { placed: [['calendar.month', 0, 0, 'full']], omitted: [], side: 3 },
  // the month alone, the whole grid on both orientations (16×24 on a portrait screen)
  calendarOnly: { placed: [['calendar.month', 0, 0, 'full']], omitted: [] },
};

test('portrait derivation: deterministic golden fixtures, sizes kept or replaced by the default, side items in order', () => {
  for (const [id, want] of Object.entries(PORTRAIT_GOLDEN)) {
    const cv = canvasFromTemplate(id);
    const d = deriveCanvasPortrait(cv.items, cv.sidebar);
    const byId = new Map(cv.items.map((i) => [i.id, i]));
    const main = d.placed.filter((p) => p.pos.zone === 'main').map((p) => [byId.get(p.id).kind, p.pos.x, p.pos.y, p.pos.size]);
    assert.deepEqual(main, want.placed, id);
    assert.deepEqual(d.omitted.map((x) => byId.get(x).kind), want.omitted, id);
    if (want.side) assert.equal(d.placed.filter((p) => p.pos.zone === 'side').length, want.side, id);
    assertNoOverlap(d.placed.map((p) => ({ kind: byId.get(p.id).kind, pos: p.pos })), 'portrait');
    // the same answer every time
    assert.deepEqual(deriveCanvasPortrait(cv.items, cv.sidebar), d);
  }
  // what does not fit is left out of the portrait view
  const busy = canvasFromTemplate('kitchen');
  const d = deriveCanvasPortrait(busy.items, busy.sidebar);
  assert.ok(d.omitted.length > 0);
  assert.equal(d.placed.length + d.omitted.length, busy.items.length);
});

test('portrait by hand (portraitAuto off): stored positions are validated, missing ones derived, kept without overlap', () => {
  const a = item('clock.digital', M(0, 0, 'm'), { portrait: M(0, 0, 'm') });
  const b = item('weather.now', M(4, 0, 'm'), { portrait: M(1, 1, 'm') });
  const c2 = item('date', M(8, 0, 's'));
  const { out } = run({ portraitAuto: false, items: [a, b, c2] });
  assert.ok(out.items.every((i) => i.portrait && i.portrait.zone === 'main'));
  assertNoOverlap(out.items, 'portrait', 'portrait');
  // with the derivation on, portrait positions are not stored
  const auto = run({ portraitAuto: true, items: [a] });
  assert.equal('portrait' in auto.out.items[0], false);
});

test('templates: data only, valid, no overlap, the Home Assistant one is offered only with it', () => {
  const ids = CANVAS_TEMPLATES.map((t) => t.id);
  assert.deepEqual(ids.filter((id) => !id.startsWith('design.')), ['calendarWeather', 'kitchen', 'photoFrame', 'halfHalf', 'calendarOnly', 'bedroom', 'homePanel', 'bento', 'cinematic', 'blank']);
  for (const t of CANVAS_TEMPLATES) {
    const c = collector();
    const raw = canvasFromTemplate(t.id);
    const again = sanitizeCanvas(c, 'canvas', raw, {}, {});
    assert.deepEqual(c.errors, [], `${t.id}: ${JSON.stringify(c.errors)}`);
    assert.deepEqual(c.warnings, [], `${t.id}: ${JSON.stringify(c.warnings)}`);
    assert.equal(again.items.length, t.canvas.items.length, t.id);
    assertNoOverlap(again.items);
  }
  assert.deepEqual(CANVAS_TEMPLATES.filter((t) => t.requires?.ha).map((t) => t.id), ['homePanel']);
  // on Marco Cloud the Home Assistant items are left out
  assert.deepEqual(canvasFromTemplate('homePanel', {}, { canvasKinds: CLOUD_CANVAS_KINDS }).items.map((i) => i.kind), ['clock.digital']);
  assert.equal(canvasFromTemplate('photoFrame').background, 'photo');
  assert.equal(canvasFromTemplate('halfHalf').sidebar.side, 'left');
  assert.equal(canvasFromTemplate('bedroom').color, '#0a0a0f');
  // Solo calendario: one month card over the whole grid, no sidebar
  const only = canvasFromTemplate('calendarOnly');
  assert.equal(only.sidebar.side, 'none');
  assert.deepEqual(only.items.map((i) => [i.kind, i.pos]), [['calendar.month', { zone: 'main', x: 0, y: 0, size: 'full' }]]);
});

test('design templates: one per existing design, valid with no overlap, and "Copiar mi diseño actual" follows the screen', () => {
  const presets = ['bigCalendar', 'twoWeeks', 'leftRight', 'topBottom', 'agenda', 'today', 'people', 'board', 'bigTime', 'photoFrame', 'bedside', 'planner', 'kidsRoutines', 'kidsFamily', 'kidsMeals'];
  assert.deepEqual(Object.keys(DESIGN_TEMPLATES).sort(), [...presets].sort());
  for (const p of presets) {
    const id = DESIGN_TEMPLATES[p];
    const t = CANVAS_TEMPLATES.find((x) => x.id === id);
    assert.ok(t, p);
    const c = collector();
    const again = sanitizeCanvas(c, 'canvas', canvasFromTemplate(id), {}, {});
    assert.deepEqual([c.errors, c.warnings], [[], []], `${id}: ${JSON.stringify(c)}`);
    assert.equal(again.items.length, t.canvas.items.length, id);
    assertNoOverlap(again.items);
    // portrait: derived without overlap
    const d = deriveCanvasPortrait(again.items, again.sidebar);
    assertNoOverlap(d.placed.map((x) => ({ kind: again.items.find((i) => i.id === x.id).kind, pos: x.pos })), 'portrait');
  }
  assert.ok(['design.kidsRoutines', 'design.kidsFamily', 'design.kidsMeals'].every((id) => CANVAS_TEMPLATES.find((t) => t.id === id).theme === 'light'));
  // the screen's own settings: the column on the right, the photo off, two weeks, an analog clock
  const screen = { layout: { preset: 'bigCalendar', sidePanel: 'right', sideWidth: 0.4 }, background: { enabled: false, scope: 'side' }, calendar: { weeks: 3, eventStyle: 'cards', maxEventsPerDay: 5, hidePast: true }, datetime: { clock: 'analog' } };
  const { canvas, template, theme } = canvasFromDesign(screen);
  assert.equal(template, 'design.bigCalendar');
  assert.equal(theme, null);
  assert.deepEqual(canvas.sidebar, { side: 'right', size: 'wide', fill: 'glass' });
  assert.equal(canvas.background, 'ambient');
  const month = canvas.items.find((i) => i.kind === 'calendar.month');
  assert.deepEqual([month.props.weeks, month.props.eventStyle, month.props.maxEventsPerDay, month.props.hidePast], [3, 'cards', 5, true]);
  assert.ok(canvas.items.some((i) => i.kind === 'clock.analog') && !canvas.items.some((i) => i.kind === 'clock.digital'));
  // a whole-screen photo goes behind the canvas; the photo beside (Izquierda / Derecha) stays in the column
  assert.equal(canvasFromDesign({ layout: { preset: 'agenda' }, background: { enabled: true, scope: 'screen' } }).canvas.background, 'photo');
  const lr = canvasFromDesign({ layout: { preset: 'leftRight', sidePanel: 'right' }, background: { enabled: true, scope: 'side' } }).canvas;
  assert.deepEqual([lr.sidebar.side, lr.sidebar.fill, lr.background], ['right', 'photo', 'ambient']);
  // a new Personalizado screen starts on Animado: copying Izquierda / Derecha with the photo on the whole screen or
  // off, the blank grid and every template that does not ask for a plain colour on purpose
  const lr2 = canvasFromDesign({ layout: { preset: 'leftRight', sidePanel: 'left', sideWidth: 0.36 }, background: { enabled: true, scope: 'screen' } }).canvas;
  assert.deepEqual([lr2.sidebar.fill, lr2.background], ['photo', 'ambient']);
  assert.equal(canvasFromDesign({ layout: { preset: 'leftRight' }, background: { enabled: false } }).canvas.background, 'ambient');
  assert.equal(canvasFromTemplate('blank').background, 'ambient');
  assert.equal(canvasFromTemplate('nope').background, 'ambient');
  const plain = new Set(['bedroom', 'design.bedside', 'design.kidsRoutines', 'design.kidsFamily', 'design.kidsMeals']);
  for (const tp of CANVAS_TEMPLATES) if (!plain.has(tp.id)) assert.notEqual(canvasFromTemplate(tp.id).background, 'solid', tp.id);
  assert.equal(canvasFromTemplate('bedroom').background, 'solid');
  // another layout (the widget, Personalizado itself): the big calendar
  assert.equal(canvasFromDesign({ layout: { preset: 'widget' } }).template, 'design.bigCalendar');
  assert.equal(canvasFromDesign({ layout: { preset: 'kidsMeals' } }).theme, 'light');
});

test('hidden items keep their place in the config but are not sent to the display; a portrait left out (null) is derived again', () => {
  const a = item('clock.digital', M(0, 0, 'm'), { hidden: true });
  const b = item('weather.now', M(4, 0, 'm'));
  const { out } = run({ items: [a, b] });
  assert.equal(out.items[0].hidden, true);
  assert.equal('hidden' in out.items[1], false);
  const pr = projectCanvas({ layout: { preset: 'canvas' }, canvas: out });
  assert.deepEqual(pr.items.map((i) => i.kind), ['weather.now']);
  const c = collector();
  const again = sanitizeCanvas(c, 'canvas', { portraitAuto: false, items: [{ ...b, portrait: null }] }, {}, {});
  assert.deepEqual(c.errors, []);
  assert.equal(again.items[0].portrait.zone, 'main');
});

test('date position: clocks keep the date below by default and may put it above; the Fecha card its weekday', () => {
  for (const k of ['clock.digital', 'clock.analog', 'clock.flip']) {
    assert.equal(canvasDefaults(k).datePos, 'below', k);
    const { out, c } = run({ items: [item(k, M(0, 0, 'm'), { props: { ...canvasDefaults(k), datePos: 'above' } })] });
    assert.equal(out.items[0].props.datePos, 'above', k);
    assert.deepEqual(c.errors, []);
    // an old item without it: below; a wrong value: an error and the default
    const { datePos: _d, ...old } = canvasDefaults(k);
    assert.equal(run({ items: [item(k, M(0, 0, 'm'), { props: old })] }).out.items[0].props.datePos, 'below');
    const bad = run({ items: [item(k, M(0, 0, 'm'), { props: { ...old, datePos: 'left' } })] });
    assert.equal(bad.out.items[0].props.datePos, 'below');
    assert.ok(bad.c.errors.length);
  }
  assert.equal(canvasDefaults('date').weekday, 'above');
  assert.equal(run({ items: [item('date', M(0, 0, 's'), { props: { ...canvasDefaults('date'), weekday: 'below' } })] }).out.items[0].props.weekday, 'below');
});

test('corners: square (sq) for the screen and per card, the old soft corners (m) still accepted', () => {
  for (const r of ['sq', 'm', 'l', 'xl']) {
    const { out, c } = run({ defaults: { surface: 'glass', radius: r }, items: [item('clock.digital', M(0, 0, 'm'), { style: { ...defaultItemStyle(), radius: r } })] });
    assert.deepEqual(c.errors, [], r);
    assert.equal(out.defaults.radius, r);
    assert.equal(out.items[0].style.radius, r);
  }
  const bad = run({ defaults: { surface: 'glass', radius: 'round' } });
  assert.equal(bad.out.defaults.radius, 'l');
});

// ---- flexible sizes: any w×h in whole cells within each kind's range --------------------------------------------

test('flexible sizes: every kind has a range in cells that holds all its named sizes, within the grid, on both orientations', () => {
  for (const [kind, k] of Object.entries(CANVAS_KINDS)) {
    assert.ok(Array.isArray(k.cells) && k.cells.length === 4 && k.cells.every(Number.isInteger), `${kind}: cells`);
    assert.ok(k.cells[0] <= k.cells[2] && k.cells[1] <= k.cells[3], `${kind}: min before max`);
    for (const o of ['landscape', 'portrait']) {
      const r = cellRange(kind, o);
      const { cols, rows } = CANVAS_GRID[o];
      assert.ok(r.minW >= 1 && r.minH >= 1 && r.maxW <= cols && r.maxH <= rows, `${kind} ${o}: ${JSON.stringify(r)}`);
      for (const s of k.sizes) {
        const [w, h] = sizeCells(s, o);
        assert.ok(boxAllowed(kind, w, h, o), `${kind} ${o}: named size ${s} inside its range`);
      }
    }
  }
  // the owner's examples (in cells of the 24×16 grid): tall and narrow lists, full-width strips, small Casa tiles,
  // readable clocks
  for (const kind of ['todo', 'calendar.agenda', 'birthdays', 'family.routines', 'meals.week', 'countdowns']) assert.ok(boxAllowed(kind, 6, 12) || boxAllowed(kind, 12, 12), kind);
  assert.ok(boxAllowed('todo', 6, 12) && boxAllowed('calendar.agenda', 6, 12) && boxAllowed('birthdays', 6, 12) && boxAllowed('family.routines', 6, 12));
  for (const kind of ['news', 'stocks', 'weather.forecast', 'highlights', 'message', 'countdowns', 'calendar.week', 'calendar.month', 'calendar.agenda']) assert.ok(boxAllowed(kind, 24, 4) || boxAllowed(kind, 24, 6), `${kind} full width`);
  for (const kind of ['ha.switch', 'ha.light', 'ha.tile', 'ha.sensor']) assert.ok(boxAllowed(kind, 4, 2) && boxAllowed(kind, 2, 1), `${kind} 4×2 and 2×1`);
  // cards grow down and sideways where the room is used: faces in a big grid or a list, rewards and meals as tiles,
  // the week's meals as a list of days in a narrow card, more cities, events and hours, larger Casa tiles
  for (const kind of ['family.members', 'family.rewards', 'family.points', 'family.chores', 'meals.today', 'birthdays', 'countdowns', 'news', 'message', 'announcement', 'clock.world', 'weather.now', 'weather.hourly', 'weather.forecast']) assert.ok(boxAllowed(kind, 24, 16), `${kind} 24×16`);
  for (const kind of ['meals.week', 'family.members', 'todo', 'family.rewards', 'meals.today']) assert.ok(boxAllowed(kind, 6, 16), `${kind} 6×16`);
  assert.ok(boxAllowed('calendar.next', 24, 12) && boxAllowed('date', 24, 12) && boxAllowed('value', 16, 12) && boxAllowed('market', 16, 16));
  assert.ok(boxAllowed('ha.tile', 4, 8) && boxAllowed('ha.switch', 12, 8) && boxAllowed('ha.sensor', 16, 8) && boxAllowed('ha.gauge', 16, 12) && boxAllowed('ha.statistic', 16, 12) && boxAllowed('ha.scene', 24, 12) && boxAllowed('ha.media', 16, 16));
  // the smallest boxes (the compact look below twice the old minimum, fullLookMin)
  assert.deepEqual([cellRange('family.members').minW, cellRange('family.members').minH], [4, 1]);
  assert.deepEqual(fullLookMin('family.members'), [6, 4]);
  assert.equal(boxAllowed('meals.week', 4, 16), false);
  assert.ok(boxAllowed('ha.cover', 4, 4));
  assert.equal(boxAllowed('clock.digital', 2, 1), false);
  assert.equal(boxAllowed('clock.flip', 3, 1), false);
  assert.equal(boxAllowed('todo', 24, 4), false, 'past its largest width');
  assert.equal(boxAllowed('todo', 4.5, 8), false, 'whole cells only');
  // portrait: at most 16 wide, a full-height kind takes all 24 rows
  assert.deepEqual([cellRange('calendar.month', 'portrait').maxW, cellRange('calendar.month', 'portrait').maxH], [16, 24]);
});

test('flexible sizes: a box is stored as its named size when it is one, else with its own w and h and the named size it looks like', () => {
  assert.deepEqual(boxOf('todo', 6, 8), { size: 't' });
  assert.deepEqual(boxOf('todo', 6, 12), { size: 't', w: 6, h: 12 });
  assert.deepEqual(boxOf('ha.switch', 4, 2), { size: 'row', w: 4, h: 2 });
  assert.deepEqual(boxOf('ha.light', 10, 4), { size: 's', w: 10, h: 4 });
  // clamped to the range
  assert.deepEqual(boxOf('todo', 1, 40), { size: 's', w: 4, h: 16 });
  // the look: the largest named size inside the box, else the one sticking out least
  assert.equal(lookSize('weather.forecast', 16, 4), 'w');
  assert.equal(lookSize('calendar.agenda', 8, 12), 't');
  assert.equal(lookSize('calendar.agenda', 12, 6), 'm');
  assert.equal(lookSize('ha.tile', 4, 2), 'row');
  assert.deepEqual(posCells({ size: 'm' }), [8, 6]);
  assert.deepEqual(posCells({ size: 'm', w: 5, h: 2 }), [5, 2]);
  assert.deepEqual(posCells({ size: 's' }, 'portrait'), [8, 4]);
});

test('flexible sizes: validation keeps boxes of their own, clamps them to the kind, refuses what is not whole cells, and never overlaps', () => {
  const a = item('todo', { zone: 'main', x: 0, y: 0, size: 't', w: 6, h: 12 });
  const b = item('news', { zone: 'main', x: 6, y: 0, size: 'w', w: 18, h: 4 });
  // exactly a named size: stored as the name
  const c = item('weather.now', { zone: 'main', x: 6, y: 4, size: 'xs', w: 6, h: 4 });
  // too large for a switch (12×8 at most): clamped (a warning, not an error)
  const d = item('ha.switch', { zone: 'main', x: 12, y: 4, size: 's', w: 12, h: 12 });
  // overlapping the to-do list: moved to the nearest free spot with its own box
  const e = item('ha.sensor', { zone: 'main', x: 2, y: 2, size: 'row', w: 4, h: 2 });
  let { c: col, out } = run({ items: [a, b, c, d, e] });
  assert.deepEqual(col.errors, []);
  const by = (it) => out.items.find((x) => x.id === it.id).pos;
  assert.deepEqual(by(a), { zone: 'main', x: 0, y: 0, size: 't', w: 6, h: 12 });
  assert.deepEqual(by(b), { zone: 'main', x: 6, y: 0, size: 'w', w: 18, h: 4 });
  assert.deepEqual(by(c), { zone: 'main', x: 6, y: 4, size: 's' });
  assert.deepEqual(posCells(by(d)), [12, 8]);
  assert.ok(col.warnings.some((w) => /not allowed for ha\.switch/.test(w.message)));
  assert.deepEqual(posCells(by(e)), [4, 2]);
  assert.ok(by(e).x >= 6 || by(e).y >= 12);
  assertNoOverlap(out.items);
  // only one of w and h, or a fraction: an error, and the named size is used
  ({ c: col, out } = run({ items: [item('todo', { zone: 'main', x: 0, y: 0, size: 't', w: 6 }), item('todo', { zone: 'main', x: 8, y: 0, size: 't', w: 4.5, h: 8 })] }));
  assert.equal(col.errors.length, 2);
  assert.deepEqual(out.items.map((i) => i.pos), [{ zone: 'main', x: 0, y: 0, size: 't' }, { zone: 'main', x: 8, y: 0, size: 't' }]);
  // a screen saved before flexible sizes comes back exactly as it was
  for (const t of CANVAS_TEMPLATES) {
    const cv = canvasFromTemplate(t.id);
    const r = run(structuredClone(cv));
    assert.deepEqual(r.out.items.map((i) => i.pos), cv.items.map((i) => i.pos), t.id);
    assert.ok(r.out.items.every((i) => i.pos.w === undefined));
  }
});

test('raised smallest boxes: a gauge, a statistic or scenes saved smaller grow on read where there is room, never over another card, else stay as they were', () => {
  assert.deepEqual([cellRange('ha.gauge').minW, cellRange('ha.gauge').minH], [4, 1]);
  assert.deepEqual([cellRange('ha.statistic').minW, cellRange('ha.statistic').minH], [4, 1]);
  // the scenes: at least 6 wide, narrower only around their 4×4 named size
  assert.ok(boxAllowed('ha.scene', 6, 1) && boxAllowed('ha.scene', 4, 4) && boxAllowed('ha.scene', 5, 4));
  assert.equal(boxAllowed('ha.gauge', 3, 1), false);
  assert.equal(boxAllowed('ha.scene', 5, 1), false);
  assert.equal(boxAllowed('ha.scene', 4, 3), false);
  assert.deepEqual(boxOf('ha.scene', 4, 1), { size: lookSize('ha.scene', 6, 1), w: 6, h: 1 });
  assert.deepEqual(boxOf('ha.scene', 4, 4), { size: 'xs' });
  // room beside them: grown in place (a warning, not an error)
  const g = item('ha.gauge', { zone: 'main', x: 0, y: 0, size: 'xs', w: 3, h: 1 });
  const st = item('ha.statistic', { zone: 'main', x: 0, y: 1, size: 'xs', w: 3, h: 2 });
  const sc = item('ha.scene', { zone: 'main', x: 0, y: 3, size: 'xs', w: 4, h: 1 });
  let { c: col, out } = run({ items: [g, st, sc] });
  const by = (it) => out.items.find((x) => x.id === it.id)?.pos;
  assert.deepEqual(col.errors, []);
  assert.deepEqual([by(g).x, by(g).y, ...posCells(by(g))], [0, 0, 4, 1]);
  assert.deepEqual([by(st).x, by(st).y, ...posCells(by(st))], [0, 1, 4, 2]);
  assert.deepEqual([by(sc).x, by(sc).y, ...posCells(by(sc))], [0, 3, 6, 1]);
  assert.equal(col.warnings.filter((w) => /grown to/.test(w.message)).length, 3);
  assertNoOverlap(out.items);
  // a neighbour where it would grow: the grown box moves to the nearest free spot
  const g2 = item('ha.gauge', { zone: 'main', x: 4, y: 0, size: 'xs', w: 3, h: 1 });
  const wall = item('ha.sensor', { zone: 'main', x: 7, y: 0, size: 'row', w: 4, h: 2 });
  ({ c: col, out } = run({ items: [wall, g2] }));
  assert.deepEqual(col.errors, []);
  assert.deepEqual(posCells(by(g2)), [4, 1]);
  assertNoOverlap(out.items);
  // a grid full but for its own cells: kept as it was, nothing deleted
  const fill = [];
  for (let y = 0; y < 16; y += 4) for (let x = 0; x < 24; x += 4) if (!(x === 0 && y === 0)) fill.push(item('ha.tile', { zone: 'main', x, y, size: 's', w: 4, h: 4 }));
  const left = [item('ha.tile', { zone: 'main', x: 3, y: 0, size: 's', w: 1, h: 4 }), item('ha.tile', { zone: 'main', x: 0, y: 1, size: 's', w: 3, h: 3 })].map((it) => ({ ...it, kind: 'spacer', props: {} }));
  const g3 = item('ha.gauge', { zone: 'main', x: 0, y: 0, size: 'xs', w: 3, h: 1 });
  ({ c: col, out } = run({ items: [...fill, ...left, g3] }));
  assert.deepEqual(col.errors, []);
  assert.deepEqual(by(g3), { zone: 'main', x: 0, y: 0, size: lookSize('ha.gauge', 3, 1), w: 3, h: 1 });
  assert.ok(col.warnings.some((w) => /no room to grow it, kept/.test(w.message)));
  assertNoOverlap(out.items);
});

test('flexible sizes: portrait keeps a box of its own (at most 16 wide), a hand-made portrait one is checked like landscape, the display gets w and h', () => {
  const items = [item('news', { zone: 'main', x: 0, y: 0, size: 'w', w: 24, h: 4 }), item('todo', { zone: 'main', x: 0, y: 4, size: 't', w: 6, h: 12 }), item('clock.digital', { zone: 'main', x: 6, y: 4, size: 'm' })];
  const { placed, omitted } = deriveCanvasPortrait(items);
  assert.deepEqual(omitted, []);
  const pos = new Map(placed.map((p) => [p.id, p.pos]));
  assert.deepEqual(posCells(pos.get(items[0].id), 'portrait'), [16, 4]);
  assert.deepEqual(posCells(pos.get(items[1].id), 'portrait'), [6, 12]);
  // the clock keeps its named size, as before
  assert.equal(pos.get(items[2].id).size, 'm');
  assert.equal(pos.get(items[2].id).w, undefined);
  // a hand-made portrait box past 16 columns is clamped there
  const hand = { ...structuredClone(items[1]), portrait: { zone: 'main', x: 0, y: 0, size: 't', w: 18, h: 24 } };
  const { c: col, out } = run({ portraitAuto: false, items: [hand] });
  assert.deepEqual(col.errors, []);
  assert.deepEqual(posCells(out.items[0].portrait, 'portrait'), [16, 24]);
  // the display config carries the boxes as they are
  const cv = run({ items }).out;
  const proj = projectCanvas({ layout: { preset: 'canvas' }, screen: { orientation: 'auto' }, canvas: cv }, {});
  assert.deepEqual(proj.items[1].pos, { zone: 'main', x: 0, y: 4, size: 't', w: 6, h: 12 });
  assert.deepEqual(posCells(proj.items[0].portrait, 'portrait'), [16, 4]);
});

test('Colores según el estado (issue #13): Entidad, binary sensors and switches keep auto, green, yellow or red; anything else is refused', () => {
  for (const kind of ['ha.tile', 'ha.sensor', 'ha.switch']) {
    const fresh = run({ items: [item(kind, M(0, 0, 'xs'))] });
    assert.deepEqual([fresh.out.items[0].props.colorOn, fresh.out.items[0].props.colorOff], ['auto', 'auto'], `${kind}: automatic by default`);
    const raw = item(kind, M(0, 0, 'xs'));
    raw.props = { ...raw.props, colorOn: 'red', colorOff: 'green' };
    const { c, out } = run({ items: [raw] });
    assert.deepEqual(c.errors, []);
    assert.deepEqual([out.items[0].props.colorOn, out.items[0].props.colorOff], ['red', 'green'], kind);
    const bad = item(kind, M(0, 0, 'xs'));
    bad.props = { ...bad.props, colorOn: 'purple' };
    assert.ok(run({ items: [bad] }).c.errors.some((e) => e.path.endsWith('.colorOn')), `${kind}: an unknown colour is an error`);
  }
});
