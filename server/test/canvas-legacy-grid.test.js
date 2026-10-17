// Personalizado screens made on the old 12×8 grid (before 0.17): every canvas is on the 24×16 grid now, and a stored
// canvas without `grid` (or with 'normal') is converted when it is read: every position and box doubled, in both
// orientations, sidebar spans unchanged, so it looks exactly the same. The fixtures (fixtures/canvas-legacy.json) are
// screens as 0.16.3 saved them (every template, with an automatic and a hand-made portrait, hand-made screens with a
// sidebar, boxes of their own, a Rotativa, hidden and scheduled cards, a portrait screen, every kind) and the positions
// its projection sent to a display.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CANVAS_GRID, CANVAS_LIMITS, CANVAS_TEMPLATES, canvasFromTemplate, defaultCanvas, exportCanvasFile, isLegacyCanvas, posCells, projectCanvas, readCanvasFile,
  sanitizeCanvas, upgradeCanvasGrid,
} from '../core/canvasCore.js';
import { validateConfig } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';

const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/canvas-legacy.json', import.meta.url), 'utf8')).screens;
const refs = { widgets: new Map([['w_1', {}]]) };
const collector = () => {
  const c = { errors: [], warnings: [] };
  c.err = (p, m) => c.errors.push(`${p}: ${m}`);
  c.warn = (p, m) => c.warnings.push(`${p}: ${m}`);
  return c;
};
const save = (raw) => {
  const c = collector();
  const out = sanitizeCanvas(c, 'canvas', structuredClone(raw), refs, {});
  return { out, c };
};
/** A main position twice as large (what the conversion must give). */
const twice = (p) => (p && p.zone === 'main' ? { ...p, x: p.x * 2, y: p.y * 2, ...(p.w !== undefined ? { w: p.w * 2, h: p.h * 2 } : {}) } : p);
const project = (cv, orientation = 'auto') => projectCanvas({ layout: { preset: 'canvas' }, screen: { orientation }, canvas: cv }, {});

test('the fixtures cover what the owner asked for', () => {
  const names = Object.keys(FIX);
  for (const t of CANVAS_TEMPLATES) {
    assert.ok(names.includes(`template.${t.id}`), t.id);
    assert.ok(names.includes(`template.${t.id}.portrait`), `${t.id} portrait by hand`);
  }
  assert.ok(Object.values(FIX).every((f) => !('grid' in f.canvas)), 'saved before the grid existed');
  assert.ok(Object.values(FIX).some((f) => f.canvas.sidebar.side !== 'none'));
  assert.ok(Object.values(FIX).some((f) => f.canvas.items.some((it) => it.kind === 'rotator' && it.props.cards.length === 3)));
  assert.ok(Object.values(FIX).some((f) => f.orientation === 'portrait' && !f.canvas.portraitAuto));
  assert.ok(Object.values(FIX).some((f) => f.canvas.items.some((it) => it.pos.w !== undefined)));
});

test('upgradeCanvasGrid: positions and boxes doubled in both orientations, sidebar and everything else as it was, idempotent', () => {
  for (const [name, f] of Object.entries(FIX)) {
    const legacy = f.canvas;
    assert.equal(isLegacyCanvas(legacy), true, name);
    const before = structuredClone(legacy);
    const up = upgradeCanvasGrid(legacy);
    assert.deepEqual(legacy, before, `${name}: the argument is not changed`);
    assert.equal(up.grid, 'fine');
    assert.equal(isLegacyCanvas(up), false);
    assert.equal(upgradeCanvasGrid(up), up, `${name}: a converted canvas comes back as it is`);
    const { grid: _g, items, ...rest } = up;
    const { items: items0, ...rest0 } = legacy;
    assert.deepEqual(rest, rest0, `${name}: the screen's settings`);
    items.forEach((it, i) => {
      const was = items0[i];
      assert.deepEqual(it.pos, twice(was.pos), `${name} ${it.kind} pos`);
      if ('portrait' in was) assert.deepEqual(it.portrait, twice(was.portrait), `${name} ${it.kind} portrait`);
      const { pos: _p, portrait: _q, ...r } = it;
      const { pos: _p0, portrait: _q0, ...r0 } = was;
      assert.deepEqual(r, r0, `${name} ${it.kind}: props, style, cards, schedule`);
    });
  }
  // 'normal' (a screen switched back to the normal grid in 0.16) is legacy too; a garbled canvas is left to validation
  assert.equal(upgradeCanvasGrid({ ...defaultCanvas(), grid: 'normal', items: [{ kind: 'date', pos: { zone: 'main', x: 1, y: 2, size: 's' } }] }).items[0].pos.x, 2);
  assert.equal(upgradeCanvasGrid(null), null);
  assert.deepEqual(upgradeCanvasGrid({ items: [null, { kind: 'date', pos: { zone: 'main', x: 'a' } }] }).items, [null, { kind: 'date', pos: { zone: 'main', x: 'a' } }]);
});

test('read and saved: a legacy screen validates to the doubled one with no warning, the same on every later save', () => {
  for (const [name, f] of Object.entries(FIX)) {
    const a = save(f.canvas);
    // (a card 0.16 left out of a hand-made portrait is looked for again on every save, as it was then)
    const left = f.canvas.items.filter((it) => it.portrait === null).length;
    assert.deepEqual([a.c.errors, a.c.warnings.filter((w) => !/portrait: no free space/.test(w))], [[], []], name);
    assert.ok(a.c.warnings.length <= left, name);
    assert.equal(a.out.grid, 'fine');
    assert.deepEqual(a.out.items.map((it) => [it.id, it.pos, it.portrait]), f.canvas.items.map((it) => [it.id, twice(it.pos), twice(it.portrait)]), name);
    // saved back: nothing changes any more (stored as fine, never converted twice)
    const b = save(a.out);
    assert.deepEqual([b.c.errors, b.c.warnings], [a.c.errors, a.c.warnings], name);
    assert.deepEqual(b.out, a.out, `${name}: idempotent`);
    // inside the grid of 24×16 and 16×24
    for (const it of a.out.items) {
      for (const [key, o] of [['pos', 'landscape'], ['portrait', 'portrait']]) {
        const p = it[key];
        if (p?.zone !== 'main') continue;
        const [w, h] = posCells(p, o);
        assert.ok(p.x + w <= CANVAS_GRID[o].cols && p.y + h <= CANVAS_GRID[o].rows, `${name} ${it.kind} ${key}`);
      }
    }
  }
});

test('the display gets the same rectangles: every position the old projection sent, doubled', () => {
  for (const [name, f] of Object.entries(FIX)) {
    const want = f.display.map((d) => ({ id: d.id, pos: twice(d.pos), portrait: twice(d.portrait) }));
    // a stored canvas the server has not read yet (Marco Cloud reads the store as it is), and the saved one
    for (const cv of [f.canvas, save(f.canvas).out]) {
      const p = project(cv, f.orientation);
      assert.equal(p.grid, 'fine');
      assert.deepEqual(p.items.map((it) => ({ id: it.id, pos: it.pos, portrait: it.portrait })), want, name);
    }
  }
});

test('a config with legacy screens: validateConfig converts them, the file import too', () => {
  const c = defaultConfig();
  c.screens = [c.screens[0], structuredClone(c.screens[0]), structuredClone(c.screens[0])];
  c.screens.forEach((s, i) => {
    s.id = `s_${i}`;
    s.slug = `s-${i}`;
    s.layout.preset = 'canvas';
  });
  c.screens[0].canvas = structuredClone(FIX['template.bento'].canvas);
  c.screens[1].canvas = structuredClone(FIX['hand.portrait'].canvas);
  c.screens[1].screen.orientation = 'portrait';
  c.screens[2].canvas = structuredClone(save(FIX['template.kitchen'].canvas).out);
  c.defaultScreen = 's_0';
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  // (only the card that hand-made portrait left out, looked for again as on every save)
  assert.deepEqual(r.warnings.map((w) => w.path), ['screens[1].canvas.items[6].portrait']);
  assert.ok(r.value.screens.every((s) => s.canvas.grid === 'fine'));
  assert.deepEqual(r.value.screens[0].canvas, save(FIX['template.bento'].canvas).out);
  assert.deepEqual(r.value.screens[2].canvas, save(FIX['template.kitchen'].canvas).out, 'a converted screen is not converted again');
  // a screen file exported by 0.16 (no grid in it): converted on import
  const file = JSON.parse(JSON.stringify(exportCanvasFile(FIX['template.halfHalf'].canvas)));
  assert.equal('grid' in file.canvas, false);
  const back = readCanvasFile(file);
  assert.ok(back.ok, back.error);
  assert.equal(back.canvas.grid, 'fine');
  assert.deepEqual(back.canvas.items.map((it) => it.pos), FIX['template.halfHalf'].canvas.items.map((it) => twice(it.pos)));
  // and one exported now carries grid 'fine' and comes back as it was
  const now = readCanvasFile(JSON.parse(JSON.stringify(exportCanvasFile(back.canvas))));
  assert.deepEqual(now.canvas.items.map((it) => it.pos), back.canvas.items.map((it) => it.pos));
});

test('templates are written in cells of the 24×16 grid and look as they did', () => {
  for (const t of CANVAS_TEMPLATES) {
    const cv = canvasFromTemplate(t.id);
    assert.equal(cv.grid, 'fine');
    assert.deepEqual(cv.items.map((it) => [it.kind, it.pos]), FIX[`template.${t.id}`].canvas.items.map((it) => [it.kind, twice(it.pos)]), t.id);
  }
});

test('one set of caps for every screen: 48 cards, 80 Home Assistant entities', () => {
  assert.deepEqual(CANVAS_LIMITS, { items: 48, side: 8, haEntities: 80, liveCameras: 1 });
  // a legacy screen with as many cards as it could have had (24) is far from the cap
  const many = { ...defaultCanvas(), grid: undefined, items: Array.from({ length: 24 }, (_, i) => ({ kind: 'spacer', pos: { zone: 'main', x: (i % 12), y: Math.floor(i / 12), size: 'xs', w: 1, h: 1 } })) };
  const r = save(many);
  assert.deepEqual(r.c.errors, []);
  assert.equal(r.out.items.length, 24);
});

test('the store converts the config file once, after a backup of it as it was', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-grid-'));
  try {
    const c = validateConfig(defaultConfig()).value;
    c.screens[0].layout.preset = 'canvas';
    c.screens[0].canvas = structuredClone(FIX['hand.sidebar'].canvas);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c, null, 2));
    const store = await import('../store.js');
    store.initStore(dir);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(onDisk.screens[0].canvas.grid, 'fine');
    assert.deepEqual(onDisk.screens[0].canvas, store.getConfig().screens[0].canvas);
    assert.deepEqual(onDisk.screens[0].canvas.items.map((it) => it.pos), c.screens[0].canvas.items.map((it) => twice(it.pos)));
    assert.deepEqual(store.migratedOnLoad, { canvasGrid: 'fine' });
    const backups = fs.readdirSync(path.join(dir, 'backups')).filter((n) => n.startsWith('config-'));
    assert.equal(backups.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'backups', backups[0]), 'utf8')).screens[0].canvas, c.screens[0].canvas, 'the backup is the file as it was');
    // the next start: nothing to convert, no backup, the file untouched
    const stat = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
    store.initStore(dir);
    assert.equal(store.migratedOnLoad, null);
    assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), stat);
    assert.equal(fs.readdirSync(path.join(dir, 'backups')).filter((n) => n.startsWith('config-')).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
