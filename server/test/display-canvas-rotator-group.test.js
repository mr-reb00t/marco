// Issue #19, "Grupo", in a browser: the demo 'motion-group' screen (mockCanvas.ts) has three Rotativas that show the
// hall camera while someone moves and a group of three entity cards while all is clear: one of 3×3 cells with the
// group in rows (its smallest box), one of 6×2 with the group in columns (its smallest too) and a large one in rows.
// The group shows as three equal parts of the box, each card whole (no "No cabe", no cut text), and the space swaps
// at once when the sensor changes ('marco:demo-ha', mockHa.ts). The 'groups' screen has groups on their own (#25), three
// cards in two rows among them. Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

const LAND = { width: 1920, height: 1080 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each Rotativa: its cells, the slide on show, its group's cards (boxes, cut text), dots, cramped, seen. */
const STATE = `[...document.querySelectorAll('.cv-item[data-kind="rotator"]')].map((e) => {
  const slides = [...e.querySelectorAll('.cv-rot > .cv-rot-slide')];
  const on = slides.find((s) => s.classList.contains('is-on'));
  const grp = e.querySelector('.cv-rot-grp');
  const cut = (root) => [...root.querySelectorAll('*')].filter((el) => !(el instanceof SVGElement) && el.clientWidth && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)).map((el) => el.textContent.trim());
  return {
    cells: e.dataset.cells,
    on: on ? on.className : null,
    group: grp ? {
      cols: grp.classList.contains('is-cols'),
      off: grp.classList.contains('is-cond-off'),
      cards: [...grp.children].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cells: c.dataset.cells, kind: c.className, over: c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1, cut: cut(c) };
      }),
    } : null,
    dots: e.querySelector('.cv-rot').classList.contains('has-dots') && !e.querySelector('.cv-rot-dots').hidden,
    cramped: e.classList.contains('is-cramped'),
    seen: getComputedStyle(e).visibility !== 'hidden' && !e.hidden,
  };
})`;
const flip = (state) => `window.dispatchEvent(new CustomEvent('marco:demo-ha', { detail: { entity: 'binary_sensor.hall_motion', state: ${JSON.stringify(state)} } }))`;

/** The group of a Rotativa on show and whole: three equal parts of its box, in rows or in columns, nothing cut. */
function assertGroup(r, cols) {
  const msg = JSON.stringify(r);
  assert.equal(r.seen, true, msg);
  assert.match(r.on, /cv-rot-grp/, msg);
  assert.equal(r.dots, false, msg);
  assert.equal(r.cramped, false, msg);
  const g = r.group;
  assert.equal(g.cols, cols, msg);
  assert.equal(g.cards.length, 3, msg);
  assert.ok(g.cards.every((c) => /cv-grp-cell/.test(c.kind) && /cv-ha-tile-card/.test(c.kind)), msg);
  const [a, b, c] = g.cards;
  if (cols) {
    assert.ok(a.y === b.y && b.y === c.y && a.x < b.x && b.x < c.x, msg);
    assert.ok(Math.max(a.w, b.w, c.w) - Math.min(a.w, b.w, c.w) <= 2, msg);
  } else {
    assert.ok(a.x === b.x && b.x === c.x && a.y < b.y && b.y < c.y, msg);
    assert.ok(Math.max(a.h, b.h, c.h) - Math.min(a.h, b.h, c.h) <= 2, msg);
  }
  for (const x of g.cards) {
    assert.equal(x.over, false, msg);
    assert.deepEqual(x.cut, [], msg);
  }
}

const chrome = findChrome();
describe('a Rotativa that swaps a space for a group of cards (#19), in a browser', { skip: !chrome && 'no Chrome' }, () => {
  let web;
  let browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome(chrome);
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  test('all clear: three cards in rows (3×3) or columns (6×2), whole; someone moves: the camera at once; unavailable: hidden', { timeout: 90_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=motion-group&motion=off`, LAND);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      let [a, b, c] = await p.eval(STATE);
      assert.deepEqual([a.cells, b.cells, c.cells], ['3x3', '6x2', '12x8']);
      assertGroup(a, false);
      assertGroup(b, true);
      assertGroup(c, false);
      // each card has its share of the box in cells, in its compact look when that is small
      assert.deepEqual(a.group.cards.map((x) => x.cells), ['3x1', '3x1', '3x1']);
      assert.deepEqual(b.group.cards.map((x) => x.cells), ['2x2', '2x2', '2x2']);
      assert.deepEqual(c.group.cards.map((x) => x.cells), ['12x2', '12x2', '12x2']);
      // past the five seconds of each turn it stays
      await wait(6000);
      [a] = await p.eval(STATE);
      assertGroup(a, false);
      // someone moves: the camera, the group skipped
      await p.eval(flip('on'));
      await wait(400);
      for (const r of await p.eval(STATE)) {
        assert.equal(r.seen, true, JSON.stringify(r));
        assert.match(r.on, /cv-ha-cam\b/, JSON.stringify(r));
        assert.equal(r.group.off, true);
        assert.equal(r.dots, false);
      }
      // the sensor unavailable: neither holds, every Rotativa is hidden
      await p.eval(flip('unavailable'));
      await wait(400);
      for (const r of await p.eval(STATE)) assert.equal(r.seen, false, JSON.stringify(r));
      // all clear again: the group is back
      await p.eval(flip('off'));
      await wait(400);
      [a, b, c] = await p.eval(STATE);
      assertGroup(a, false);
      assertGroup(b, true);
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      assert.deepEqual(errors, []);
    } finally {
      await p.close();
    }
  });

  test('a group on its own (#25): three cards in two rows, four in three, three side by side, whole and still', { timeout: 60_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=groups`, LAND);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const [a, b, c] = await p.eval(STATE);
      assert.deepEqual([a.cells, b.cells, c.cells], ['3x2', '3x3', '6x2']);
      for (const [r, cols, n] of [[a, false, 3], [b, false, 4], [c, true, 3]]) {
        const msg = JSON.stringify(r);
        assert.equal(r.seen, true, msg);
        assert.match(r.on, /cv-rot-grp/, msg);
        assert.equal(r.dots, false, msg);
        assert.equal(r.cramped, false, msg);
        assert.equal(r.group.cols, cols, msg);
        assert.equal(r.group.cards.length, n, msg);
        for (const x of r.group.cards) {
          assert.equal(x.over, false, msg);
          assert.deepEqual(x.cut, [], msg);
        }
      }
      // in rows each card has an equal share of the height
      for (const r of [a, b]) {
        const hs = r.group.cards.map((x) => x.h);
        assert.ok(Math.max(...hs) - Math.min(...hs) <= 2, JSON.stringify(r));
      }
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      assert.deepEqual(errors, []);
    } finally {
      await p.close();
    }
  });

  test('a sensor already on when the screen opens: the camera from the start', async () => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=motion-group&motion=on`, LAND);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 900)))');
      for (const r of await p.eval(STATE)) assert.match(r.on, /cv-ha-cam\b/, JSON.stringify(r));
    } finally {
      await p.close();
    }
  });
});
