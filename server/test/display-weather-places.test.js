// Weather of several places on the display (#11), in a browser with the demo's made-up weather: a screen's own place
// on the usual layouts, weather cards with a place of their own, the cities card as a list, a grid and in one row on
// the fine grid. Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

const LAND = { width: 1920, height: 1080 };
const settle = 'document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))';

const chrome = findChrome();
describe('weather of several places, in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  test('a screen with a place of its own: the weather card and the forecast are of that place', async () => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=en&wxplace=Beach%20house`, LAND);
    try {
      await p.eval(settle);
      const loc = await p.eval(`document.querySelector('#weather')?.textContent ?? ''`);
      assert.match(loc, /Beach house/);
      assert.doesNotMatch(loc, /Lisbon/);
      // the household's place on a screen without one
      const home = await browser.page(`${web.url}/?demo=1&lite=1&lang=en`, LAND);
      try {
        await home.eval(settle);
        assert.match(await home.eval(`document.querySelector('#weather')?.textContent ?? ''`), /Lisbon/);
      } finally {
        await home.close();
      }
    } finally {
      await p.close();
    }
  });

  test('custom screen: cards with places of their own, the cities card as a list and a grid', async () => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=places&lang=en`, LAND);
    try {
      await p.eval(settle);
      const out = await p.eval(`(() => {
        const now = [...document.querySelectorAll('.cv-wx-now')].map((e) => e.querySelector('.cv-wx-loc')?.textContent);
        const cities = [...document.querySelectorAll('.cv-wx-cities')].map((e) => ({
          grid: e.classList.contains('is-grid'),
          names: [...e.querySelectorAll('.cv-city:not([hidden]) .cv-city-name')].map((n) => n.textContent),
          temps: [...e.querySelectorAll('.cv-city:not([hidden]) .cv-city-temp')].map((n) => n.textContent),
          hl: e.querySelectorAll('.cv-city-hl').length,
        }));
        const captions = [...document.querySelectorAll('.cv-wx-forecast .cv-wx-place')].map((e) => e.textContent);
        return { now, cities, captions };
      })()`);
      assert.deepEqual(out.now, ['Lisbon', 'Beach house']);
      assert.deepEqual(out.cities.map((c) => [c.grid, c.names]), [
        [false, ['Grandma’s', 'Lake cabin', 'Uni flat', 'Beach house']],
        [true, ['Grandma’s', 'Lake cabin', 'Uni flat', 'Ski lodge']],
      ]);
      // every place has its own weather (a temperature, never the placeholder)
      for (const c of out.cities) for (const t of c.temps) assert.match(t, /^-?\d+°$/);
      assert.equal(out.cities[0].hl, 4);
      assert.deepEqual(out.captions, ['Lake cabin', 'Ski lodge']);
      // the card with the same place as the cities card shows the same temperature
      const same = await p.eval(`(() => {
        const beach = [...document.querySelectorAll('.cv-wx-now')].find((e) => e.textContent.includes('Beach house'));
        const row = [...document.querySelectorAll('.cv-city')].find((e) => e.textContent.includes('Beach house'));
        return [beach?.querySelector('.cv-wx-temp')?.textContent, row?.querySelector('.cv-city-temp')?.textContent];
      })()`);
      assert.equal(same[0], same[1]);
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      assert.deepEqual(errors, []);
    } finally {
      await p.close();
    }
  });

  test('fine grid: the cities card in one row shows as many whole places as fit', async () => {
    for (const [cells, min] of [['4x1', 1], ['8x1', 2], ['12x1', 2]]) {
      const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=size:weather.cities:${cells}:landscape:none:ambient:fine&lang=en`, LAND);
      try {
        await p.eval(settle);
        const cards = await p.eval(`[...document.querySelectorAll('.cv-wx-cities')].map((e) => {
          const b = e.getBoundingClientRect();
          const shown = [...e.querySelectorAll('.cv-city')].filter((c) => !c.hidden);
          return {
            mini: e.dataset.mini !== undefined, line: e.classList.contains('is-mline'), shown: shown.length,
            inside: shown.every((c) => { const r = c.getBoundingClientRect(); return r.right <= b.right + 1 && r.bottom <= b.bottom + 1 && r.left >= b.left - 1; }),
          };
        })`);
        assert.ok(cards.length > 0, cells);
        for (const c of cards) {
          assert.ok(c.mini && c.line, `${cells}: compact look`);
          assert.ok(c.shown >= min, `${cells}: ${c.shown} places`);
          assert.ok(c.inside, `${cells}: a place cut`);
        }
      } finally {
        await p.close();
      }
    }
  });
});
