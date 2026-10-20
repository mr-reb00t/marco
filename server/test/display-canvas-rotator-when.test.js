// Issue #19 in a browser: a Rotativa whose cards have conditions of their own (the demo 'motion' screen, mockCanvas.ts:
// the hall light while the motion sensor is off, the camera while it is on). Only the card that holds shows, with no
// dots and no turn; when the sensor changes the other one shows at once; with neither holding the Rotativa is hidden.
// The sensor is changed with the demo's 'marco:demo-ha' event (mockHa.ts). Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

const LAND = { width: 1920, height: 1080 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each Rotativa: which card is on, which are skipped, its dots, and whether it is on the screen at all. */
const STATE = `[...document.querySelectorAll('.cv-item[data-kind="rotator"]')].map((e) => {
  const slides = [...e.querySelectorAll('.cv-rot-slide')];
  const on = slides.find((s) => s.classList.contains('is-on'));
  return {
    // (each slide is the card's body, with its kind's classes)
    on: on ? on.className : null,
    off: slides.filter((s) => s.classList.contains('is-cond-off')).length,
    dots: e.querySelector('.cv-rot').classList.contains('has-dots') && !e.querySelector('.cv-rot-dots').hidden,
    seen: getComputedStyle(e).visibility !== 'hidden' && !e.hidden,
  };
})`;
const flip = (state) => `window.dispatchEvent(new CustomEvent('marco:demo-ha', { detail: { entity: 'binary_sensor.hall_motion', state: ${JSON.stringify(state)} } }))`;

const chrome = findChrome();
describe('a Rotativa that changes with Home Assistant (#19), in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  test('only the card whose condition holds, no dots, the other one at once when the sensor changes, hidden when none holds', { timeout: 90_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=motion&motion=off`, LAND);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))');
      const kindOf = (r) => r.on;
      // all clear: the light, alone, with no dots; the second Rotativa keeps its sensor alone too
      let [a, b] = await p.eval(STATE);
      assert.deepEqual([a.seen, a.dots, a.off], [true, false, 1], JSON.stringify(a));
      assert.match(kindOf(a), /cv-ha-tile-card/);
      assert.deepEqual([b.seen, b.dots, b.off], [true, false, 1], JSON.stringify(b));
      assert.match(kindOf(b), /cv-ha-sensor/);
      // past its five seconds it does not turn
      await wait(6000);
      [a] = await p.eval(STATE);
      assert.match(kindOf(a), /cv-ha-tile-card/);
      // someone moves: the camera at once, and the second Rotativa now has two cards that take turns, with dots
      await p.eval(flip('on'));
      await wait(400);
      [a, b] = await p.eval(STATE);
      assert.deepEqual([a.seen, a.dots, a.off], [true, false, 1], JSON.stringify(a));
      assert.match(kindOf(a), /cv-ha-cam\b/);
      assert.deepEqual([b.seen, b.dots, b.off], [true, true, 0], JSON.stringify(b));
      // the sensor unavailable: neither card holds and the Rotativa is hidden; the other keeps its sensor
      await p.eval(flip('unavailable'));
      await wait(400);
      [a, b] = await p.eval(STATE);
      assert.equal(a.seen, false, JSON.stringify(a));
      assert.equal(a.off, 2);
      assert.deepEqual([b.seen, b.dots], [true, false], JSON.stringify(b));
      // all clear again: back, with the light
      await p.eval(flip('off'));
      await wait(400);
      [a] = await p.eval(STATE);
      assert.equal(a.seen, true);
      assert.match(kindOf(a), /cv-ha-tile-card/);
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      assert.deepEqual(errors, []);
    } finally {
      await p.close();
    }
  });

  test('a sensor already on when the screen opens: the camera from the start', async () => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=motion&motion=on`, LAND);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 900)))');
      const [a] = await p.eval(STATE);
      assert.deepEqual([a.seen, a.dots], [true, false]);
      assert.match(a.on, /cv-ha-cam\b/);
    } finally {
      await p.close();
    }
  });
});
