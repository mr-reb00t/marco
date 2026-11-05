// A photo behind the other cards on Personalizado (#36): with "Detrás de las otras tarjetas" a photo card takes no
// cells of the grid, so the server keeps the cards placed over it, the portrait arrangement keeps it under them, the
// builder lets cards be dropped on it (and finds the photo a free spot when it comes back among them), and the display
// draws it under them (headless Chrome, skipped without a browser). Its "Oscurecer foto" and "Hasta el borde de la
// pantalla" (the follow-up on #36): a shade over the photo, and square corners out to the screen's edges.
// The builder modules load through Node's TypeScript type stripping (skipped before Node 22.18).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { defaultCanvas, deriveCanvasPortrait, isBehind, isEdge, sanitizeCanvas } from '../core/canvasCore.js';
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
try {
  M = await import('../../web/admin/builder/model.ts');
} catch {
  /* older Node */
}
const ts = { skip: M ? false : 'TypeScript imports need Node >= 22.18' };

const collect = () => ({ errors: [], warnings: [], err(p, m) { this.errors.push([p, m]); }, warn(p, m) { this.warnings.push([p, m]); } });
const box = (x, y, w, h) => ({ zone: 'main', x, y, size: 'm', w, h });
const item = (id, kind, pos, props = {}) => ({ id, kind, pos, props });
/** A photo over two thirds of the screen, a clock and the weather placed over it, the agenda beside it. */
const canvas = (behind) => ({
  ...defaultCanvas(),
  items: [
    item('cv_photo001', 'photo', box(0, 0, 16, 16), { behind }),
    item('cv_clock001', 'clock.digital', box(1, 1, 8, 4)),
    item('cv_wx000001', 'weather.now', { zone: 'main', x: 1, y: 11, size: 's' }),
    item('cv_agenda01', 'calendar.agenda', { zone: 'main', x: 16, y: 0, size: 't' }),
  ],
});
const at = (cv, id) => cv.items.find((x) => x.id === id).pos;
/** Where a box is and how many cells it takes (its named size is the server's to pick). */
const cells = (p) => [p.x, p.y, p.w, p.h];

test('the server keeps the cards placed over a photo behind them; without it they move off the photo', () => {
  const c = collect();
  const out = sanitizeCanvas(c, 'canvas', canvas(true));
  assert.deepEqual([c.errors, c.warnings], [[], []]);
  assert.equal(out.items.find((x) => x.kind === 'photo').props.behind, true);
  assert.deepEqual(cells(at(out, 'cv_clock001')), [1, 1, 8, 4]);
  assert.deepEqual(at(out, 'cv_wx000001'), { zone: 'main', x: 1, y: 11, size: 's' });
  // the same screen with the photo among the cards: the ones over it are moved (or dropped), never left on it
  const c2 = collect();
  const out2 = sanitizeCanvas(c2, 'canvas', canvas(false));
  assert.ok(c2.warnings.length + c2.errors.length > 0);
  assert.notDeepEqual(cells(at(out2, 'cv_clock001') ?? {}), [1, 1, 8, 4]);
  // off by default, and only a photo can be behind
  const c3 = collect();
  const plain = sanitizeCanvas(c3, 'canvas', { ...defaultCanvas(), items: [item('cv_photo001', 'photo', box(0, 0, 4, 4))] });
  assert.equal(plain.items[0].props.behind, false);
  assert.equal(isBehind({ kind: 'clock.digital', props: { behind: true } }), false);
  assert.equal(isBehind({ kind: 'photo', props: { behind: 'yes' } }), false);
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

test('portrait: the photo behind keeps its place under the others, which are placed as if it were not there', () => {
  const { placed, omitted } = deriveCanvasPortrait(canvas(true).items, null);
  assert.deepEqual(omitted, []);
  const pos = Object.fromEntries(placed.map((p) => [p.id, p.pos]));
  assert.deepEqual(cells(pos.cv_photo001), [0, 0, 16, 16]);
  // the first card of the others goes at the top left, over the photo
  const others = placed.filter((p) => p.id !== 'cv_photo001');
  assert.ok(others.some((p) => p.pos.x === 0 && p.pos.y === 0), JSON.stringify(others));
});

test('builder: cards drop on the photo behind them, the photo moves anywhere, and comes back among them only on free cells', ts, () => {
  let cv = canvas(true);
  assert.ok(M.noOverlap(cv));
  // the photo is not in the way: a card dropped on it stays there
  const drop = M.resolveMain(cv, 'landscape', 's', 10, 6);
  assert.deepEqual([drop.x, drop.y], [10, 6]);
  assert.deepEqual(M.occupantsAt(cv, 'landscape', 0, 0, 16, 16), ['cv_clock001', 'cv_wx000001']);
  // nothing is in the photo's way either: it moves over the cards
  const move = M.resolveMain(cv, 'landscape', at(cv, 'cv_photo001'), 2, 0, { id: 'cv_photo001' });
  assert.deepEqual([move.x, move.y], [2, 0]);
  // drawn first, so the overlay puts the cards over it
  assert.equal(M.tabOrder(cv, 'landscape')[0], 'cv_photo001');
  // back among the cards: it must not cover them, so it moves to free cells of its size
  cv = { ...cv, items: cv.items.map((x) => (x.id === 'cv_photo001' ? { ...x, pos: box(0, 0, 4, 4) } : x)) };
  const back = M.setBehind(cv, 'cv_photo001', false);
  assert.deepEqual(back.stuck, []);
  assert.equal(M.itemOf(back.cv, 'cv_photo001').props.behind, false);
  assert.ok(M.noOverlap(back.cv));
  assert.notDeepEqual([at(back.cv, 'cv_photo001').x, at(back.cv, 'cv_photo001').y], [0, 0]);
  // no room for its size anywhere: it stays behind, and the builder says why
  const big = canvas(true);
  const stuck = M.setBehind(big, 'cv_photo001', false);
  assert.deepEqual(stuck.stuck, ['landscape']);
  assert.equal(M.itemOf(stuck.cv, 'cv_photo001').props.behind, true);
  // sent behind: nothing to check
  const sent = M.setBehind(back.cv, 'cv_photo001', true);
  assert.equal(M.itemOf(sent.cv, 'cv_photo001').props.behind, true);
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
