// A photo card on Personalizado is always behind the other cards (#36, #41): on the main grid it takes no cells, so
// the server keeps the cards placed over it and the builder lets cards be dropped on it; an old "Detrás de las otras
// tarjetas" (props.behind, true or false) is read and dropped, and a screen saved with it off looks as it did. In the
// sidebar the first photo fills the whole bar behind its cards and takes no place in the stack (sideBackdropId); a
// second one goes to the main area. Its interval goes up to a day, and so does the sidebar's own photo (sidebar.fill
// 'photo': sidebar.intervalSec and sidebar.dim). Cards over an edge photo get the grid's padding on its inner side
// too (photoInsets), so they sit centred on it. Its "Oscurecer foto" and "Hasta el borde de la pantalla" as before.
// The display is checked in headless Chrome (skipped without a browser); display-canvas-photo-backdrop.test.js has
// the sidebar and the centring. The builder modules load through Node's TypeScript type stripping (skipped before
// Node 22.18).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { canvasDefaults, defaultCanvas, deriveCanvasPortrait, isBehind, isEdge, photoInsets, posCells, sanitizeCanvas, sideBackdropId } from '../core/canvasCore.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

nodeModule.registerHooks?.({
  resolve(specifier, context, next) {
    if (/^\.\.?\/[^.]*$/.test(specifier) && context.parentURL?.includes('/web/')) {
      try { return next(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return next(specifier, context);
  },
});
let M = null;
let G = null;
try {
  M = await import('../../web/admin/builder/model.ts');
  G = await import('../../web/shared/glass.ts');
} catch {
  /* older Node */
}
const ts = { skip: M && G ? false : 'TypeScript imports need Node >= 22.18' };

const collect = () => ({ errors: [], warnings: [], err(p, m) { this.errors.push([p, m]); }, warn(p, m) { this.warnings.push([p, m]); } });
const box = (x, y, w, h) => ({ zone: 'main', x, y, size: 'm', w, h });
const side = (order, span) => ({ zone: 'side', order, span });
const item = (id, kind, pos, props = {}) => ({ id, kind, pos, props });
/** A photo over two thirds of the screen, a clock and the weather placed over it, the agenda beside it. */
const canvas = (props = {}) => ({
  ...defaultCanvas(),
  items: [
    item('cv_photo001', 'photo', box(0, 0, 16, 16), props),
    item('cv_clock001', 'clock.digital', box(1, 1, 8, 4)),
    item('cv_wx000001', 'weather.now', { zone: 'main', x: 1, y: 11, size: 's' }),
    item('cv_agenda01', 'calendar.agenda', { zone: 'main', x: 16, y: 0, size: 't' }),
  ],
});
/** A left sidebar with a photo card in it, a clock and the to-dos. */
const sideCanvas = (extra = []) => ({
  ...defaultCanvas(),
  sidebar: { side: 'left', size: 'wide', fill: 'glass' },
  items: [
    item('cv_photo001', 'photo', side(0, 4), { edge: true }),
    item('cv_clock001', 'clock.digital', side(1, 4)),
    item('cv_todo0001', 'todo', side(2, 4)),
    ...extra,
  ],
});
const at = (cv, id) => cv.items.find((x) => x.id === id).pos;
/** Where a box is and how many cells it takes (its named size is the server's to pick). */
const cells = (p) => [p.x, p.y, p.w, p.h];

test('every photo is behind: the old switch is read and dropped, and the cards over it stay where they are', () => {
  assert.equal('behind' in canvasDefaults('photo'), false);
  for (const behind of [true, false, 'yes', undefined]) {
    const c = collect();
    const out = sanitizeCanvas(c, 'canvas', canvas(behind === undefined ? {} : { behind }));
    assert.deepEqual([c.errors, c.warnings], [[], []], String(behind));
    const ph = out.items.find((x) => x.kind === 'photo');
    assert.equal('behind' in ph.props, false, String(behind));
    assert.deepEqual(cells(at(out, 'cv_clock001')), [1, 1, 8, 4]);
    assert.deepEqual(at(out, 'cv_wx000001'), { zone: 'main', x: 1, y: 11, size: 's' });
  }
  // a screen saved with the photo among the cards (behind: false, cards around it) keeps every place
  const old = {
    ...defaultCanvas(),
    items: [
      item('cv_photo001', 'photo', box(0, 0, 8, 8), { behind: false }),
      item('cv_clock001', 'clock.digital', box(8, 0, 8, 4)),
      item('cv_wx000001', 'weather.now', { zone: 'main', x: 0, y: 8, size: 's' }),
    ],
  };
  const c = collect();
  const out = sanitizeCanvas(c, 'canvas', old);
  assert.deepEqual([c.errors, c.warnings], [[], []]);
  assert.deepEqual(cells(at(out, 'cv_photo001')), [0, 0, 8, 8]);
  assert.deepEqual(cells(at(out, 'cv_clock001')), [8, 0, 8, 4]);
  // only a photo is behind (a photo inside a Rotativa is a card of the Rotativa)
  assert.equal(isBehind({ kind: 'photo', props: {} }), true);
  assert.equal(isBehind({ kind: 'clock.digital', props: { behind: true } }), false);
  assert.equal(isBehind({ kind: 'rotator', props: { cards: [{ kind: 'photo' }] } }), false);
});

test('a card that has to move looks for room with no photo under it first, then over a photo', () => {
  // two clocks on the same cells: the second moves, past the photo's cells to the free ones beside it
  const c = collect();
  const out = sanitizeCanvas(c, 'canvas', {
    ...defaultCanvas(),
    items: [
      item('cv_photo001', 'photo', box(0, 0, 8, 16)),
      item('cv_clock001', 'clock.digital', box(8, 0, 8, 4)),
      item('cv_clock002', 'clock.digital', box(8, 0, 8, 4)),
    ],
  });
  const moved = at(out, 'cv_clock002');
  assert.ok(moved.x >= 8, JSON.stringify(moved));
  assert.equal(c.warnings.length, 1);
});

test('photo interval: up to a day, as the screen background', () => {
  const run = (v) => sanitizeCanvas(collect(), 'canvas', { ...defaultCanvas(), items: [item('cv_photo001', 'photo', box(0, 0, 8, 8), { intervalSec: v })] }).items[0].props.intervalSec;
  assert.equal(run(86400), 86400);
  assert.equal(run(3600), 3600);
  assert.equal(run(1800), 1800);
  // the old steps still read as they were
  assert.equal(run(70), 70);
  assert.equal(run(600), 600);
  assert.equal(run(5), 10);
  assert.equal(run(999999), 86400);
});

test("a photo's shade (0 to 0.6) and its edge: off by default, checked, and only a photo has them", () => {
  const c = collect();
  const out = sanitizeCanvas(c, 'canvas', { ...defaultCanvas(), items: [item('cv_photo001', 'photo', box(0, 0, 8, 8), { dim: 0.353, edge: true })] });
  assert.deepEqual(c.errors, []);
  assert.deepEqual([out.items[0].props.dim, out.items[0].props.edge], [0.35, true]);
  assert.equal(isEdge(out.items[0]), true);
  const c2 = collect();
  const plain = sanitizeCanvas(c2, 'canvas', { ...defaultCanvas(), items: [item('cv_photo001', 'photo', box(0, 0, 8, 8))] });
  assert.deepEqual([plain.items[0].props.dim, plain.items[0].props.edge], [0, false]);
  const c3 = collect();
  const over = sanitizeCanvas(c3, 'canvas', { ...defaultCanvas(), items: [item('cv_photo001', 'photo', box(0, 0, 8, 8), { dim: 5 })] });
  assert.equal(over.items[0].props.dim, 0.6);
  const c4 = collect();
  sanitizeCanvas(c4, 'canvas', { ...defaultCanvas(), items: [item('cv_photo001', 'photo', box(0, 0, 8, 8), { dim: 'dark', edge: 'yes' })] });
  assert.deepEqual(c4.errors.map((e) => e[0]).sort(), ['canvas.items[0].props.dim', 'canvas.items[0].props.edge']);
  assert.equal(isEdge({ kind: 'clock.digital', props: { edge: true } }), false);
});

test('sidebar: the first photo fills the bar behind its cards and takes no place in the stack; a second one goes to the main area', () => {
  // a photo of span 4 and two cards of span 4: all three stay (before, the photo took half the stack)
  const c = collect();
  const out = sanitizeCanvas(c, 'canvas', sideCanvas());
  assert.deepEqual([c.errors, c.warnings], [[], []]);
  assert.deepEqual(out.items.map((x) => [x.id, x.pos.zone, x.pos.span]), [['cv_photo001', 'side', 4], ['cv_clock001', 'side', 4], ['cv_todo0001', 'side', 4]]);
  assert.equal(sideBackdropId(out.items), 'cv_photo001');
  // the first photo by order wins, wherever it is in the list; the other one moves to the main area, with a warning
  const c2 = collect();
  const two = sanitizeCanvas(c2, 'canvas', sideCanvas([item('cv_photo002', 'photo', side(-1, 2))]));
  assert.deepEqual(c2.errors, []);
  assert.deepEqual(c2.warnings, [['canvas.items[0].pos', 'only one photo can fill the sidebar, moved to the main area']]);
  assert.equal(at(two, 'cv_photo001').zone, 'main');
  assert.equal(at(two, 'cv_photo002').zone, 'side');
  assert.equal(sideBackdropId(two.items), 'cv_photo002');
  // the whole stack is the cards': four of 2 units over the photo
  const four = { ...sideCanvas(), items: [item('cv_photo001', 'photo', side(0, 'fill')), ...[1, 2, 3, 4].map((i) => item(`cv_clock00${i}`, 'clock.digital', side(i, 2)))] };
  const c3 = collect();
  const full = sanitizeCanvas(c3, 'canvas', four);
  assert.deepEqual([c3.errors, c3.warnings], [[], []]);
  assert.equal(full.items.filter((x) => x.pos.zone === 'side').length, 5);
  assert.equal(sideBackdropId([]), null);
  assert.equal(sideBackdropId([{ id: 'a', kind: 'photo', pos: box(0, 0, 4, 4) }]), null);
});

test("the sidebar's photo: its own interval and shade, kept only when set, checked", () => {
  const cv = (sb) => ({ ...defaultCanvas(), background: 'ambient', sidebar: { side: 'left', size: 'normal', fill: 'photo', ...sb } });
  const c = collect();
  const out = sanitizeCanvas(c, 'canvas', cv({ intervalSec: 3600, dim: 0.304 }));
  assert.deepEqual(c.errors, []);
  assert.deepEqual(out.sidebar, { side: 'left', size: 'normal', fill: 'photo', intervalSec: 3600, dim: 0.3 });
  // absent: not written (an old screen comes out as it was)
  const plain = sanitizeCanvas(collect(), 'canvas', cv({}));
  assert.deepEqual(plain.sidebar, { side: 'left', size: 'normal', fill: 'photo' });
  // out of range: clamped; not a number: an error, and left out
  assert.deepEqual(sanitizeCanvas(collect(), 'canvas', cv({ intervalSec: 999999, dim: 2 })).sidebar, { side: 'left', size: 'normal', fill: 'photo', intervalSec: 86400, dim: 0.6 });
  const c2 = collect();
  const bad = sanitizeCanvas(c2, 'canvas', cv({ intervalSec: 'often', dim: 'dark' }));
  assert.deepEqual(c2.errors.map((e) => e[0]).sort(), ['canvas.sidebar.dim', 'canvas.sidebar.intervalSec']);
  assert.deepEqual(bad.sidebar, { side: 'left', size: 'normal', fill: 'photo' });
});

test('portrait: a photo with cards over it stays under them; one with none is placed among the cards', () => {
  const covered = deriveCanvasPortrait(canvas().items, null);
  assert.deepEqual(covered.omitted, []);
  const pos = Object.fromEntries(covered.placed.map((p) => [p.id, p.pos]));
  assert.deepEqual(cells(pos.cv_photo001), [0, 0, 16, 16]);
  // the first card of the others goes at the top left, over the photo
  assert.ok(covered.placed.some((p) => p.id !== 'cv_photo001' && p.pos.x === 0 && p.pos.y === 0));
  // nothing over the photo on landscape: on portrait it takes its own cells, and no card is placed on them
  const free = [
    item('cv_photo001', 'photo', box(0, 0, 8, 8)),
    item('cv_clock001', 'clock.digital', box(8, 0, 8, 4)),
    item('cv_wx000001', 'weather.now', { zone: 'main', x: 8, y: 4, size: 's' }),
    item('cv_agenda01', 'calendar.agenda', { zone: 'main', x: 16, y: 0, size: 't' }),
  ];
  const r = deriveCanvasPortrait(free, null);
  const rect = (p) => {
    const [w, h] = posCells(p, 'portrait');
    return [p.x, p.y, p.x + w, p.y + h];
  };
  const ph = rect(r.placed.find((p) => p.id === 'cv_photo001').pos);
  for (const p of r.placed.filter((x) => x.id !== 'cv_photo001')) {
    const b = rect(p.pos);
    assert.ok(b[2] <= ph[0] || b[0] >= ph[2] || b[3] <= ph[1] || b[1] >= ph[3], `${p.id} on the photo: ${JSON.stringify([b, ph])}`);
  }
});

test('photoInsets: cards on an edge photo get the padding on its inner side, so they sit centred on it (#41)', () => {
  const e = (id, kind, pos, props = {}) => ({ id, kind, pos, props });
  // his screen: the photo in the left column out to the edge, cards across its full columns
  const list = [
    e('ph', 'photo', box(0, 0, 8, 16), { edge: true }),
    e('clock', 'clock.digital', box(0, 0, 8, 3)),
    e('todo', 'todo', box(0, 3, 8, 5)),
    e('v1', 'value', box(0, 8, 4, 2)),
    e('v2', 'value', box(4, 8, 4, 2)),
    e('month', 'calendar.month', box(8, 0, 16, 12)),
  ];
  assert.deepEqual([...photoInsets(list, 'landscape')], [['clock', 'r'], ['todo', 'r'], ['v2', 'r']]);
  // without the edge, or out to both sides of an axis, nothing changes
  assert.equal(photoInsets(list.map((x) => (x.kind === 'photo' ? { ...x, props: {} } : x)), 'landscape').size, 0);
  assert.equal(photoInsets([e('ph', 'photo', box(0, 0, 24, 8), { edge: true }), e('c', 'clock.digital', box(0, 0, 24, 4))], 'landscape').size, 0);
  // a photo on the right and at the bottom: the inner sides are the left and the top
  const br = photoInsets([e('ph', 'photo', box(16, 8, 8, 8), { edge: true }), e('c', 'clock.digital', box(16, 8, 8, 4)), e('d', 'date', box(16, 12, 4, 4))], 'landscape');
  assert.deepEqual([...br], [['c', 'lt'], ['d', 'l']]);
  // a card that is not fully on the photo is left alone
  assert.equal(photoInsets([e('ph', 'photo', box(0, 0, 8, 16), { edge: true }), e('c', 'clock.digital', box(4, 0, 8, 4))], 'landscape').size, 0);
  // portrait: the photo across the top, out to the left, top and right
  assert.deepEqual([...photoInsets([e('ph', 'photo', box(0, 0, 16, 8), { edge: true }), e('c', 'clock.digital', box(0, 4, 16, 4))], 'portrait')], [['c', 'b']]);
});

test('builder: cards drop on a photo, a new card looks for room with no photo under it first, and the photo moves anywhere', ts, () => {
  const cv = canvas();
  assert.ok(M.noOverlap(cv));
  assert.equal('setBehind' in M, false);
  // the photo is not in the way: a card dropped on it stays there
  const drop = M.resolveMain(cv, 'landscape', 's', 10, 6);
  assert.deepEqual([drop.x, drop.y], [10, 6]);
  assert.deepEqual(M.occupantsAt(cv, 'landscape', 0, 0, 16, 16), ['cv_clock001', 'cv_wx000001']);
  // nothing is in the photo's way either: it moves over the cards
  const move = M.resolveMain(cv, 'landscape', at(cv, 'cv_photo001'), 2, 0, { id: 'cv_photo001' });
  assert.deepEqual([move.x, move.y], [2, 0]);
  // drawn first, so the overlay puts the cards over it
  assert.equal(M.tabOrder(cv, 'landscape')[0], 'cv_photo001');
  // a new card: beside the photo while there is room there ...
  const col = { ...defaultCanvas(), items: [item('cv_photo001', 'photo', box(0, 0, 8, 16))] };
  const spot = M.firstSpot(col, 'landscape', 'clock.digital');
  assert.ok(spot.x >= 8, JSON.stringify(spot));
  const added = M.addItem(col, 'landscape', 'clock.digital', null);
  assert.ok(added.ok && at(added.cv, added.id).x >= 8);
  // ... and over the photo when that is the only room left
  const full = { ...defaultCanvas(), items: [item('cv_photo001', 'photo', box(0, 0, 8, 16)), item('cv_month001', 'calendar.month', box(8, 0, 16, 16))] };
  const over = M.firstSpot(full, 'landscape', 'clock.digital');
  assert.ok(over && over.x < 8, JSON.stringify(over));
});

test('builder: a photo in the sidebar fills the bar, takes no units, and only one fits', ts, () => {
  const cv = sideCanvas();
  assert.equal(M.sideBackdrop(cv, 'landscape'), 'cv_photo001');
  assert.deepEqual(M.sideStack(cv, 'landscape').map((x) => x.id), ['cv_clock001', 'cv_todo0001']);
  // its span counts for nothing: 4 + 4 of 8 units, so a card of 2 does not fit but the stack is not over
  assert.deepEqual(M.sideUse(cv, 'landscape'), { count: 3, units: 8, fill: false });
  const room = { ...cv, items: cv.items.map((x) => (x.id === 'cv_todo0001' ? { ...x, pos: side(2, 2) } : x)) };
  assert.equal(M.fitSpan(room, 'landscape', 2), 2);
  // a second photo: refused, with the reason
  const r = M.addItem(cv, 'landscape', 'photo', { zone: 'side', index: 0 });
  assert.deepEqual(r, { ok: false, why: 'sidePhoto' });
  const main = M.addItem(cv, 'landscape', 'photo', null);
  assert.ok(main.ok);
  assert.deepEqual(M.toSide(main.cv, 'landscape', main.id, 0), { ok: false, why: 'sidePhoto' });
  // the first one goes in without room in the stack (the bar is full of cards)
  const none = { ...cv, items: cv.items.filter((x) => x.kind !== 'photo') };
  const add = M.addItem(none, 'landscape', 'photo', { zone: 'side', index: 1 });
  assert.ok(add.ok, JSON.stringify(add));
  assert.equal(M.sideBackdrop(add.cv, 'landscape'), add.id);
  assert.deepEqual(M.sideStack(add.cv, 'landscape').map((x) => x.id), ['cv_clock001', 'cv_todo0001']);
  // it has no height in the bar and no place in the order
  assert.deepEqual(M.stepSpan(cv, 'landscape', 'cv_photo001', 1), { ok: false, why: 'notInSide' });
  assert.deepEqual(M.setSpan(cv, 'landscape', 'cv_photo001', 2), { ok: false, why: 'notInSide' });
  assert.deepEqual(M.reorderSide(cv, 'landscape', 'cv_photo001', 2), { ok: false, why: 'notInSide' });
  // the overlay draws it before the bar's cards; a copy goes to the main area
  assert.deepEqual(M.tabOrder(cv, 'landscape').slice(0, 3), ['cv_photo001', 'cv_clock001', 'cv_todo0001']);
  const copy = M.duplicateItem(cv, 'landscape', 'cv_photo001');
  assert.ok(copy.ok);
  assert.equal(at(copy.cv, copy.id).zone, 'main');
  // back to the main area: its saved fill shows again
  assert.equal(G.sidebarFillOf(cv), 'card');
  const out = M.toMain(cv, 'landscape', 'cv_photo001', 4, 4);
  assert.ok(out.ok);
  assert.equal(G.sidebarFillOf(out.cv), 'glass');
});

test('the sidebar fill: a photo card wins over it, and the photo of fill Foto has its own interval', ts, () => {
  const bg = { enabled: true, scope: 'side', intervalSec: 120 };
  const cv = { ...defaultCanvas(), background: 'ambient', sidebar: { side: 'left', size: 'normal', fill: 'photo' }, items: [] };
  assert.deepEqual(G.effectiveBackground(bg, cv), { ...bg, enabled: true, scope: 'side' });
  assert.deepEqual(G.effectiveBackground(bg, { ...cv, sidebar: { ...cv.sidebar, intervalSec: 3600 } }), { ...bg, enabled: true, scope: 'side', intervalSec: 3600 });
  // with a photo card filling the bar, the screen's photo is not drawn there (the card's is)
  const card = { ...cv, items: [item('cv_photo001', 'photo', side(0, 2))] };
  assert.equal(G.effectiveBackground(bg, card).enabled, false);
  assert.equal(G.sidebarFillOf(card), 'card');
  // hidden by hand it fills nothing; a hand-made portrait with it in the main area neither
  assert.equal(G.sidebarFillOf({ ...card, items: [{ ...card.items[0], hidden: true }] }), 'photo');
  const p = { ...card, portraitAuto: false, items: [{ ...card.items[0], portrait: box(0, 0, 4, 4) }] };
  assert.equal(G.sidebarFillOf(p, false), 'card');
  assert.equal(G.sidebarFillOf(p, true), 'photo');
  assert.equal(G.sidebarFillOf({ ...card, sidebar: { ...card.sidebar, side: 'none' } }), 'photo');
});

describe('photo behind the cards in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  test('drawn under the clock and the weather placed over it, on both orientations', { timeout: 90_000 }, async () => {
    for (const [o, size] of [['landscape', { width: 1920, height: 1080 }], ['portrait', { width: 1080, height: 1920 }]]) {
      const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=en&now=2026-11-05T10:00&preset=canvas&shot=behind&orientation=${o}`, size);
      try {
        const r = await p.eval(`(async () => {
          for (let i = 0; i < 60 && !document.querySelector('.cv-item[data-kind="clock.digital"] .clock .d'); i++) await new Promise((r) => setTimeout(r, 100));
          const el = (k) => document.querySelector('.cv-item[data-kind="' + k + '"]');
          const rect = (k) => el(k).getBoundingClientRect();
          const ph = rect('photo'), ck = rect('clock.digital');
          const on = (a, b) => a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
          const top = document.elementFromPoint(ck.left + ck.width / 2, ck.top + ck.height / 2)?.closest('.cv-item')?.dataset.kind;
          return { behind: el('photo').classList.contains('is-behind'), others: document.querySelectorAll('.cv-item.is-behind').length, clockOnPhoto: on(ck, ph), top, photoBig: ph.width > innerWidth * 0.5 };
        })()`);
        assert.equal(r.behind, true, o);
        assert.equal(r.others, 1, o);
        assert.equal(r.clockOnPhoto, true, `${o}: ${JSON.stringify(r)}`);
        assert.equal(r.top, 'clock.digital', o);
        assert.equal(r.photoBig, true, o);
      } finally {
        await p.close();
      }
    }
  });

  test('darkened, square and out to the edges it touches, still under the cards, on both orientations', { timeout: 90_000 }, async () => {
    for (const [o, size] of [['landscape', { width: 1920, height: 1080 }], ['portrait', { width: 1080, height: 1920 }]]) {
      const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=en&now=2026-11-05T10:00&preset=canvas&shot=behindEdge&orientation=${o}`, size);
      try {
        const r = await p.eval(`(async () => {
          for (let i = 0; i < 60 && !document.querySelector('.cv-item[data-kind="clock.digital"] .clock .d'); i++) await new Promise((r) => setTimeout(r, 100));
          const el = (k) => document.querySelector('.cv-item[data-kind="' + k + '"]');
          const ph = el('photo').getBoundingClientRect(), ck = el('clock.digital').getBoundingClientRect();
          const grid = document.getElementById('canvas').getBoundingClientRect();
          const card = el('photo').querySelector('.cv-card');
          const top = document.elementFromPoint(ck.left + ck.width / 2, ck.top + ck.height / 2)?.closest('.cv-item')?.dataset.kind;
          return {
            edge: el('photo').dataset.edge, l: ph.left, t: ph.top, r: grid.right - ph.right, b: grid.bottom - ph.bottom,
            radius: getComputedStyle(card).borderTopLeftRadius, shade: getComputedStyle(el('photo').querySelector('.cv-photo'), '::after').backgroundColor,
            agendaRadius: getComputedStyle(el('calendar.agenda').querySelector('.cv-card')).borderTopLeftRadius, top,
          };
        })()`);
        // a box of 16 x 16 cells from the top left: the left, top and bottom edges of the 24 x 16 grid, the left, top and
        // right ones of the 16 x 24 grid
        assert.equal(r.edge, o === 'landscape' ? 'ltb' : 'ltr', `${o}: ${JSON.stringify(r)}`);
        assert.ok(Math.abs(r.l) < 1 && Math.abs(r.t) < 1, `${o}: ${JSON.stringify(r)}`);
        if (o === 'landscape') assert.ok(Math.abs(r.b) < 1 && r.r > 100, `${o}: ${JSON.stringify(r)}`);
        else assert.ok(Math.abs(r.r) < 1 && r.b > 100, `${o}: ${JSON.stringify(r)}`);
        assert.equal(r.radius, '0px', o);
        assert.notEqual(r.agendaRadius, '0px', o);
        assert.equal(r.shade, 'rgba(0, 0, 0, 0.35)', o);
        assert.equal(r.top, 'clock.digital', o);
      } finally {
        await p.close();
      }
    }
  });
});
