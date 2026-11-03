// The Value widget (#34) on the display, in headless Chrome with the demo's values (skipped without a browser): a list
// in the side column of the Modern and Classic designs, one value large in a corner and on the whole screen, and in a
// Personalizado widget card. The values are written as text, an old one is greyed, and the card fits its room.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

const read = `(async () => {
  for (let i = 0; i < 60 && !document.querySelector('.vw .vw-num b'); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 400));
  return [...document.querySelectorAll('.pw.vw')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      one: el.classList.contains('vw--one'),
      rows: [...el.querySelectorAll('.vw-row')].map((x) => ({ label: x.querySelector('.vw-label').textContent, num: x.querySelector('.vw-num').textContent, stale: x.classList.contains('is-stale') })),
      label: el.querySelector('.vw--one .vw-label, .vw-head .vw-label')?.textContent ?? null,
      num: el.querySelector('.vw-head + .vw-num')?.textContent ?? null,
      note: el.querySelector('.vw-note')?.textContent ?? null,
      fits: el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
      inView: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 50,
      w: r.width, h: r.height, fs: parseFloat(getComputedStyle(el).fontSize),
    };
  });
})()`;

describe('Value widget in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });
  const open = async (q) => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=en&now=2026-11-03T10:00&${q.includes('shot=') ? q : `shot=1&${q}`}`, { width: 1920, height: 1080 });
    try {
      return await p.eval(read);
    } finally {
      await p.close();
    }
  };

  test('a list in the side column and one large in a corner, on both designs', { timeout: 90_000 }, async () => {
    for (const style of ['modern', 'classic']) {
      const [side, corner] = await open(`style=${style}&vw=2:side:br:m,1:corner:tr:m`);
      assert.ok(side && corner, style);
      assert.deepEqual(side.rows, [
        { label: 'Car 1', num: '43%', stale: false },
        // not heard from for two hours (the widget greys after an hour)
        { label: 'Car 2', num: '23%', stale: true },
      ], style);
      assert.ok(side.fits && side.inView, `${style}: ${JSON.stringify(side)}`);
      // readable from across the room: the side column keeps the room for it
      assert.ok(side.fs >= 15, `${style}: ${side.fs}px`);
      assert.equal(corner.one, true);
      assert.equal(corner.label, 'Car 1');
      assert.equal(corner.num, '43%');
      assert.equal(corner.note, '3 min ago');
      assert.ok(corner.fits && corner.inView, `${style}: ${JSON.stringify(corner)}`);
    }
  });

  test('on the whole screen as large as it fits; in a Personalizado widget card', { timeout: 90_000 }, async () => {
    const [one] = await open('style=modern&vw=1:full');
    assert.ok(one.fits && one.inView && one.w > 1500 && one.fs > 50, JSON.stringify(one));
    const [three] = await open('style=modern&vw=3:full');
    assert.deepEqual(three.rows.map((r) => r.label), ['Car 1', 'Car 2', 'Solar']);
    assert.equal(three.rows[2].num, '12.6kWh');
    assert.ok(three.fits && three.fs > 40, JSON.stringify(three));
    const cards = await open('preset=canvas&shot=media&demowidget=value');
    assert.equal(cards.length, 2, 'the same widget in two cards');
    for (const c of cards) assert.ok(c.fits && c.inView && c.rows.length === 2, JSON.stringify(c));
  });
});
