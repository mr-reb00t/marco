// Issue #19, a small Rotativa inside a group, in a browser: the demo 'motion-nest' screen (mockCanvas.ts) has a
// Rotativa of 6×6 cells that shows the hall camera while someone moves and, while all is clear, a group of three in
// rows whose last card is a Rotativa of its own. That one turns between its cards in its share of the box, with its
// own dots and its own timer, and skips its card whose own condition is off, while the group stays on show. Polled
// with generous timeouts (the turns are 5 s apart), the page brought to the front so its frames run. Skipped without
// Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

const LAND = { width: 1920, height: 1080 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Rotativa: the slide on show, its group's cells, and the small Rotativa's slides, the one on show, its dots. */
const STATE = `(() => {
  const e = document.querySelector('.cv-item[data-kind="rotator"]');
  if (!e) return null;
  const on = [...e.querySelectorAll(':scope .cv-body > .cv-rot-slide')].find((s) => s.classList.contains('is-on'));
  const grp = e.querySelector('.cv-rot-grp');
  const nest = grp && grp.querySelector(':scope > .cv-grp-cell.cv-rot');
  const slides = nest ? [...nest.querySelectorAll(':scope > .cv-rot-slide')] : [];
  const r = nest && nest.getBoundingClientRect();
  return {
    on: on ? on.className : null,
    cells: grp ? [...grp.children].map((c) => c.className) : [],
    nest: nest ? {
      box: { w: Math.round(r.width), h: Math.round(r.height) },
      slides: slides.map((s) => ({ id: s.dataset.card, kind: s.className, on: s.classList.contains('is-on'), off: s.classList.contains('is-cond-off'), cells: s.dataset.cells, opacity: getComputedStyle(s).opacity })),
      dots: nest.classList.contains('has-dots') ? nest.querySelectorAll('.cv-rot-dots i').length : 0,
    } : null,
  };
})()`;
const flip = (state) => `window.dispatchEvent(new CustomEvent('marco:demo-ha', { detail: { entity: 'binary_sensor.hall_motion', state: ${JSON.stringify(state)} } }))`;
const onCard = (s) => s?.nest?.slides.find((x) => x.on)?.id ?? null;

const chrome = findChrome();
describe('a Rotativa inside a group of a Rotativa (#19), in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  test('all clear: the group shows, its small Rotativa turns its cards and skips the one whose condition is off', { timeout: 120_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=motion-nest&motion=off`, LAND);
    try {
      await p.send('Page.bringToFront');
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      let s = await p.eval(STATE);
      const msg = () => JSON.stringify(s);
      assert.match(s.on ?? '', /cv-rot-grp/, msg());
      // the group: two entity cards and the small Rotativa, each a share of the box
      assert.equal(s.cells.length, 3, msg());
      assert.match(s.cells[2], /cv-grp-cell/, msg());
      assert.match(s.cells[2], /cv-rot\b/, msg());
      // its three cards in slides, the one shown only while someone moves is off; two left, so two dots
      assert.equal(s.nest.slides.length, 3, msg());
      assert.deepEqual(s.nest.slides.map((x) => x.off), [false, true, false], msg());
      assert.equal(s.nest.dots, 2, msg());
      assert.ok(s.nest.box.w > 0 && s.nest.box.h > 0, msg());
      // each slide in the small Rotativa's share of the box, in cells (6×6 in rows of three: 6×2)
      assert.ok(s.nest.slides.every((x) => x.cells === '6x2'), msg());
      const [a, skipped, c] = s.nest.slides.map((x) => x.id);
      assert.equal(onCard(s), a, msg());
      // its own turn: the third card comes on (the second is skipped), the group stays on show
      const seen = new Set([onCard(s)]);
      for (let i = 0; i < 80 && !seen.has(c); i++) {
        await wait(250);
        s = await p.eval(STATE);
        seen.add(onCard(s));
        assert.match(s.on ?? '', /cv-rot-grp/, msg());
      }
      assert.ok(seen.has(c), `the small Rotativa never turned: ${msg()}`);
      assert.equal(seen.has(skipped), false, msg());
      // and back to the first one
      for (let i = 0; i < 80 && onCard(s) !== a; i++) {
        await wait(250);
        s = await p.eval(STATE);
        assert.notEqual(onCard(s), skipped, msg());
      }
      assert.equal(onCard(s), a, msg());
      // someone moves: the camera, the group skipped as a whole
      await p.eval(flip('on'));
      for (let i = 0; i < 40; i++) {
        await wait(150);
        s = await p.eval(STATE);
        if (/cv-ha-cam\b/.test(s.on ?? '')) break;
      }
      assert.match(s.on ?? '', /cv-ha-cam\b/, msg());
      // all clear again: the group is back
      await p.eval(flip('off'));
      for (let i = 0; i < 40; i++) {
        await wait(150);
        s = await p.eval(STATE);
        if (/cv-rot-grp/.test(s.on ?? '')) break;
      }
      assert.match(s.on ?? '', /cv-rot-grp/, msg());
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((x) => !/vite|Vite/.test(x));
      assert.deepEqual(errors, []);
    } finally {
      await p.close();
    }
  });
});
