// The Currency widget and the Divisas card in a browser, with the demo's made-up rates (web/display/mockData.ts): the
// widget in a corner (each size), in the side column (Classic and Modern) and on the whole screen, as a list and one
// large, with the curve under and behind; in a Personalizado 'widget' card; the Divisas card's compact look (one
// line on the fine grid) and a pair the ECB does not publish; Bolsa's symbols with no data ("Sin datos" on the row,
// "Sin datos para …" when none has any, never a card that keeps loading). Nothing may be cut by the card's edge.
// Skipped without a browser (set CHROME_PATH).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

const LAND = { width: 1920, height: 1080 };
const NOW = '2026-10-16T17:43';

/** In the page: each Currency widget's card, its box, its text, whether it shows rates, and anything cut. */
const WIDGETS = `(() => [...document.querySelectorAll('.uw-currency')].map((e) => {
  const card = e.querySelector('.fxw');
  const r = card ? card.getBoundingClientRect() : { width: 0, height: 0 };
  const cut = [];
  if (card) {
    for (const x of card.querySelectorAll('*')) {
      const b = x.getBoundingClientRect();
      const text = [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!b.width || !b.height || (!text && x.tagName !== 'svg')) continue;
      if (b.bottom > r.bottom + 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.left < r.left - 1) cut.push('outside: ' + (x.className.baseVal ?? x.className) + ' ' + x.textContent.slice(0, 20));
      if (text && x.scrollWidth > x.clientWidth + 1) cut.push('cut short: ' + x.textContent.slice(0, 20));
    }
  }
  return {
    place: e.classList.contains('uw-in-side') ? 'side' : e.classList.contains('uw-in-full') ? 'full' : e.classList.contains('uw-in-canvas') ? 'canvas' : 'corner',
    w: Math.round(r.width), h: Math.round(r.height), text: card ? card.textContent : '', line: !!card?.querySelector('.cv-dt.is-line'),
    rates: card ? card.querySelectorAll('.cv-mk-p, .cv-mk-price').length : 0, curves: card ? card.querySelectorAll('svg.cv-curve').length : 0, cut,
  };
}))()`;

const chrome = findChrome();
describe('exchange rates in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  const open = async (q, size = LAND) => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=es&now=${NOW}&${q}`, size);
    await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
    return p;
  };
  const noErrors = (p) => assert.deepEqual(p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s)), []);

  for (const style of ['classic', 'modern']) {
    test(`Currency widget, ${style}: corners of each size, the side column, the whole screen; nothing cut`, async () => {
      const cases = [
        ['fx=list:corner:br:s,big:corner:tl:l', ['corner', 'corner']],
        ['fx=list:corner:br:m&fxstyle=background', ['corner']],
        ['fx=big:corner:bl:m&fxrange=1y', ['corner']],
        ['fx=list:side:br:m&fxpairs=EUR-HUF,EUR-USD', ['side']],
        ['fx=big:full:br:l&fxrange=7d', ['full']],
        ['fx=list:full:br:l&fxstyle=background&fxpairs=EUR-HUF,EUR-USD,USD-MXN,GBP-EUR,EUR-CHF,USD-JPY', ['full']],
        ['fx=list:corner:tr:m&fxchart=none&fxpairs=EUR-XAU,EUR-HUF', ['corner']],
      ];
      for (const [q, places] of cases) {
        const p = await open(`style=${style}&${q}`);
        try {
          const ws = await p.eval(WIDGETS);
          assert.deepEqual(ws.map((w) => w.place), places, q);
          for (const w of ws) {
            assert.ok(w.w > 100 && w.h > 40, `${q}: a card of some size (${w.w}x${w.h})`);
            assert.ok(w.rates > 0, `${q}: rates shown: ${w.text}`);
            assert.match(w.text, /EUR\/|USD\//, q);
            assert.deepEqual(w.cut, [], q);
          }
          if (/fxchart=none/.test(q)) assert.match(ws[0].text, /Sin datos/, 'a pair the ECB does not publish says so');
          else if (!ws.some((w) => w.line)) assert.ok(ws.every((w) => w.curves > 0), `${q}: the curve`);
          noErrors(p);
        } finally {
          await p.close();
        }
      }
    });
  }

  // "De fondo" with one pair: the curve fills the card behind the numbers (the large card, as a Divisas card with room
  // draws it), from the card's left edge to its right one and down to its bottom, never a short band under the text
  test('Currency widget, De fondo: the curve behind the numbers fills the card, edge to edge and down to the bottom', async () => {
    const BG = `(() => [...document.querySelectorAll('.uw-currency .fxw')].map((card) => {
      const r = card.getBoundingClientRect();
      const g = card.querySelector('.cv-bgchart')?.getBoundingClientRect();
      return { w: r.width, h: r.height, big: !!card.querySelector('.cv-dt.is-big'), bg: g ? { l: g.left - r.left, r: r.right - g.right, b: r.bottom - g.bottom, area: (g.width * g.height) / (r.width * r.height) } : null };
    }))()`;
    for (const q of ['fx=list:corner:br:s', 'fx=list:corner:br:m', 'fx=list:corner:br:l', 'fx=big:corner:tl:l', 'fx=list:full:br:l', 'fx=big:full:br:l']) {
      const p = await open(`style=modern&${q}&fxstyle=background&fxpairs=EUR-USD&fxrange=7d`);
      try {
        const ws = await p.eval(BG);
        assert.equal(ws.length, 1, q);
        const [w] = ws;
        assert.ok(w.big, `${q}: one pair "De fondo" is the large card`);
        assert.ok(w.bg, `${q}: a chart behind`);
        assert.ok(w.bg.l <= 1 && w.bg.r <= 1 && w.bg.b <= 1, `${q}: the chart reaches the card's edges ${JSON.stringify(w.bg)}`);
        assert.ok(w.bg.area >= 0.3, `${q}: the chart takes a good part of the card (${w.bg.area.toFixed(2)})`);
        noErrors(p);
      } finally {
        await p.close();
      }
    }
  });

  test('Currency widget in a Personalizado card (the widget card), with its curve', async () => {
    for (const shot of ['size:widget:8x6:landscape:none:ambient', 'size:widget:12x8:landscape:none:ambient']) {
      const p = await open(`preset=canvas&shot=${shot}&demowidget=currency`);
      try {
        const ws = await p.eval(WIDGETS);
        assert.ok(ws.length > 0 && ws.every((w) => w.place === 'canvas'), shot);
        for (const w of ws) {
          assert.ok(w.rates > 0 && w.curves > 0, `${shot}: ${w.text}`);
          assert.deepEqual(w.cut, [], shot);
        }
        assert.equal(await p.eval(`document.querySelectorAll('.cv-item.is-cramped').length`), 0);
        noErrors(p);
      } finally {
        await p.close();
      }
    }
  });

  test('Divisas: the compact look is one line (pair, rate, change, curve); a pair with no data says which', async () => {
    const p = await open('preset=canvas&shot=currencyLines');
    try {
      const cards = await p.eval(`[...document.querySelectorAll('.cv-item:not([hidden]) .cv-body.cv-fx')].map((b) => ({
        mini: b.dataset.mini !== undefined, mh: b.dataset.mh, line: b.classList.contains('is-line'), text: b.textContent,
        rows: b.querySelectorAll('.cv-mk-row').length, curve: !!b.querySelector('svg.cv-curve'), pair: b.querySelector('.cv-fx-pair')?.textContent ?? '',
      }))`);
      const lines = cards.filter((c) => c.mh === '1');
      assert.ok(lines.length >= 3, JSON.stringify(cards));
      for (const c of lines) {
        assert.equal(c.line, true, c.text);
        assert.equal(c.rows, 1);
        assert.match(c.pair, /^[A-Z]{3}\/[A-Z]{3}$/);
        assert.match(c.text, /\d/);
      }
      assert.ok(lines.some((c) => c.curve), 'a sparkline on the line where there is room');
      assert.ok(cards.some((c) => c.text.includes('Sin datos para EUR/XAU')), 'EUR/XAU: no data, by name');
      assert.equal(await p.eval(`document.querySelectorAll('.cv-item.is-cramped').length`), 0);
      noErrors(p);
    } finally {
      await p.close();
    }
  });

  test('Bolsa: a symbol with no data shows "Sin datos" on its row, a card of only such symbols says which; never loading', async () => {
    const p = await open('preset=canvas&shot=currency');
    try {
      const st = await p.eval(`[...document.querySelectorAll('.cv-item:not([hidden]) .cv-body.cv-st')].map((b) => ({ text: b.textContent, note: b.querySelector('.cv-dt-note')?.textContent ?? '', nd: [...b.querySelectorAll('.cv-dt-nd')].map((x) => x.closest('.cv-st-row, .cv-st-q')?.querySelector('.sym')?.textContent) }))`);
      assert.ok(st.length >= 2, JSON.stringify(st));
      assert.ok(st.some((c) => c.note === 'Sin datos para OANDA:EUR_HUF'), JSON.stringify(st));
      assert.ok(st.some((c) => c.nd.includes('EURHUF') && /AAPL/.test(c.text)), JSON.stringify(st));
      assert.equal(st.some((c) => /Cargando/.test(c.text)), false);
      noErrors(p);
    } finally {
      await p.close();
    }
  });
});
