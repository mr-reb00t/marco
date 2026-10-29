// Cuentas atrás two cells wide (#30): the smallest box, and on screen each countdown on two lines (the name over the
// days left, "12 días") instead of a name cut to a letter or two (the "countdowns-narrow" demo).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boxAllowed } from '../core/canvasCore.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

test('a countdowns card can be two cells wide and one high, not one wide', () => {
  assert.ok(boxAllowed('countdowns', 2, 1));
  assert.ok(boxAllowed('countdowns', 3, 1));
  assert.ok(!boxAllowed('countdowns', 1, 1));
});

describe('narrow countdowns in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  test('the countdowns-narrow demo', { timeout: 60_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=countdowns-narrow&lang=es`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const r = await p.eval(`[...document.querySelectorAll('.cv-item[data-kind="countdowns"] .cv-cd')].map((e) => {
        const rows = [...e.querySelectorAll('.cd')].filter((x) => x.getClientRects().length > 0);
        return {
          stack: e.classList.contains('is-mstack'),
          rows: rows.length,
          when: rows.map((x) => x.querySelector('.cd-when').textContent),
          titleW: Math.min(...rows.map((x) => x.querySelector('.cd-tt').clientWidth)),
          whenFit: rows.every((x) => { const w = x.querySelector('.cd-when'); return w.scrollWidth <= w.clientWidth + 1; }),
          over: e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2,
          rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        };
      })`);
      assert.equal(r.length, 4, JSON.stringify(r));
      for (const x of r) {
        assert.ok(x.stack, JSON.stringify(x));
        assert.ok(x.rows >= 1 && !x.over && x.whenFit, JSON.stringify(x));
        // the name gets the card's width, not a letter or two beside the days
        assert.ok(x.titleW > x.rem * 9, JSON.stringify(x));
        for (const w of x.when) assert.ok(!w.startsWith('Faltan'), `in short: ${w}`);
      }
      assert.ok(r[1].rows >= 3 && r[2].rows >= 3, JSON.stringify(r));
      assert.ok(r[3].rows >= 2, 'the cards style stacks them too');
      assert.ok(r[2].when.some((w) => /^\d+ días$/.test(w)), JSON.stringify(r[2]));
    } finally {
      await p.close();
    }
  });
});
