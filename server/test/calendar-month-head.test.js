// Month and year over the month card (#48): shown by default (every card saved before keeps them), hidden with
// showMonth false, and with no legend either the heading takes no room, so the grid fills the whole card
// (the "calendar-month-head" demo has one of each).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CANVAS_KINDS, canvasDefaults } from '../core/canvasCore.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const props = (x) => {
  const errors = [];
  const c = { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
  return { p: CANVAS_KINDS['calendar.month'].props(c, 'p', { ...canvasDefaults('calendar.month'), ...x }, {}, {}), errors };
};

test('showMonth on the month card: shown and not saved by default, false only when hidden, checked like the rest', () => {
  assert.equal('showMonth' in canvasDefaults('calendar.month'), false);
  assert.equal('showMonth' in props({}).p, false, 'a card saved before stays as it was');
  assert.equal('showMonth' in props({ showMonth: true }).p, false);
  assert.equal(props({ showMonth: false }).p.showMonth, false);
  const bad = props({ showMonth: 'no' });
  assert.ok(bad.errors.some((e) => e.includes('showMonth')), JSON.stringify(bad.errors));
  assert.equal('showMonth' in bad.p, false);
  assert.match(readFileSync(new URL('../../web/admin/builder/fieldSpecs.ts', import.meta.url), 'utf8'), /'calendar\.month': \[(?:(?!'calendar\.week')[\s\S])*k: 'showMonth'/);
});

describe('month and year in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  test('the calendar-month-head demo', { timeout: 60_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=calendar-month-head&lang=es&now=2026-11-01T15:00`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const r = await p.eval(`[...document.querySelectorAll('.cv-item[data-kind="calendar.month"] .cal')].map((cal) => {
        const shown = (el) => !!el && el.getBoundingClientRect().height > 0;
        const card = cal.closest('.cv-item').getBoundingClientRect();
        const weeks = cal.querySelector('.cal-weeks').getBoundingClientRect();
        return { title: shown(cal.querySelector('.cal-title')), head: shown(cal.querySelector('.cal-head')),
          legend: cal.querySelector('.legend').children.length, h: weeks.height, inCard: weeks.bottom <= card.bottom + 1,
          rows: cal.querySelectorAll('.cal-weeks .wk').length };
      })`);
      assert.equal(r.length, 4);
      const [a, b, c, d] = r;
      assert.deepEqual([a.title, a.head], [true, true], 'shown by default');
      assert.ok(a.legend > 0);
      assert.deepEqual([b.title, b.head], [false, true], 'hidden, the legend kept');
      assert.ok(b.legend > 0);
      assert.deepEqual([c.title, c.head], [false, false], 'no heading at all');
      assert.ok(c.h > a.h * 1.08, `the grid fills the card: ${c.h} against ${a.h}`);
      assert.ok(b.h >= a.h - 1, `${b.h} against ${a.h}`);
      for (const x of r) assert.ok(x.inCard, JSON.stringify(x));
      assert.ok(d.rows >= 1 && d.title === false, JSON.stringify(d));
    } finally {
      await p.close();
    }
  });
});
