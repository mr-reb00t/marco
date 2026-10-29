// The Bolsa card's currency, labels and big layout: the props, the prices in dollars as Finnhub gives them or in
// another currency at the ECB rate of the day (dataCore stocksData), and on screen (the "stocks" demo).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_KINDS, canvasDefaults } from '../core/canvasCore.js';
import { createDataHub, dataForItem } from '../core/dataCore.js';
import { FAKE_FX, fakeDataCall, FAKE_STOCKS_KEY } from '../core/dataFake.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const props = (x) => {
  const errors = [];
  const c = { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
  return { p: CANVAS_KINDS.stocks.props(c, 'p', { ...canvasDefaults('stocks'), ...x }, {}, {}), errors };
};

test('stocks props: the big layout, a currency of the ECB list or none, what names a quote', () => {
  const d = canvasDefaults('stocks');
  assert.deepEqual([d.layout, d.currency, d.label], ['ticker', '', 'both']);
  assert.equal(props({ layout: 'big' }).p.layout, 'big');
  assert.equal(props({ currency: 'EUR' }).p.currency, 'EUR');
  assert.equal(props({ currency: 'GBP' }).p.currency, 'GBP');
  for (const bad of ['eur', 'BTC', 'XXX', 5]) {
    const r = props({ currency: bad });
    assert.equal(r.p.currency, '', String(bad));
    assert.ok(r.errors.some((e) => e.includes('currency')), String(bad));
  }
  assert.equal(props({ label: 'name' }).p.label, 'name');
  assert.equal(props({ label: 'sym' }).p.label, 'sym');
  assert.equal(props({ label: 'other' }).p.label, 'both');
});

function hub() {
  const t = Date.parse('2026-10-16T17:00:00Z');
  return createDataHub({ call: fakeDataCall({ calls: [], now: () => t, fail: {} }), now: () => t, stocksKey: () => FAKE_STOCKS_KEY });
}
const SYMS = [{ sym: 'AAPL', name: 'Apple' }, { sym: 'MSFT', name: 'Microsoft' }];

test('stocks data: dollars as they come, euros or pounds at the ECB rate, the curve converted too', async () => {
  const usd = await dataForItem(hub(), { kind: 'stocks', props: { symbols: SYMS, sparkline: true } });
  assert.equal(usd.cur, undefined, 'no currency: the number alone, as before');
  const asUsd = await dataForItem(hub(), { kind: 'stocks', props: { symbols: SYMS, currency: 'USD' } });
  assert.equal(asUsd.cur, 'USD');
  assert.deepEqual(asUsd.quotes.map((q) => q.price), usd.quotes.map((q) => q.price));
  for (const cur of ['EUR', 'GBP']) {
    const d = await dataForItem(hub(), { kind: 'stocks', props: { symbols: SYMS, currency: cur, sparkline: true } });
    assert.equal(d.cur, cur);
    // a dollar in `cur`: euros per dollar through the euro
    const rate = (cur === 'EUR' ? 1 : FAKE_FX[cur][0]) / FAKE_FX.USD[0];
    d.quotes.forEach((q, i) => {
      assert.ok(Math.abs(q.price - usd.quotes[i].price * rate) / q.price < 1e-4, `${cur} ${q.sym}`);
      assert.equal(q.ch, usd.quotes[i].ch, 'the change in % stays');
      q.pts.forEach(([, y], j) => assert.ok(Math.abs(y - usd.quotes[i].pts[j][1] * rate) / y < 1e-4));
    });
  }
});

const chrome = findChrome();
describe('stocks on screen: big, in euros or dollars, names only', { skip: !chrome && 'no Chrome' }, () => {
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

  test('the stocks demo', { timeout: 60_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=stocks&lang=es`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const r = await p.eval(`[...document.querySelectorAll('.cv-item[data-kind="stocks"] .cv-st')].map((e) => ({
        big: e.classList.contains('is-big'),
        price: e.querySelector('.cv-mk-price')?.textContent ?? null,
        head: e.querySelector('.cv-mk-head')?.textContent ?? null,
        chart: !!e.querySelector('.cv-mk-chart svg, .cv-mk-chart.is-room, .cv-dt-bgchart, svg'),
        labels: [...e.querySelectorAll('.cv-st-who, .cv-st-q .sym')].map((x) => x.textContent),
        over: e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1,
      }))`);
      assert.equal(r.length, 4, JSON.stringify(r));
      const [eur, usd, list, line] = r;
      assert.ok(eur.big && /€$/.test(eur.price) && /^AAPL/.test(eur.head) && eur.chart, JSON.stringify(eur));
      // dollars with the short sign, the name alone (no symbol badge)
      assert.ok(usd.big && /\$$/.test(usd.price) && !/US\$/.test(usd.price) && usd.head.startsWith('S&P 500') && !usd.head.includes('SPY'), JSON.stringify(usd));
      assert.deepEqual(list.labels, ['Apple', 'Microsoft', 'S&P 500', 'Google'], JSON.stringify(list));
      assert.ok(line.labels.length >= 3 && line.labels.slice(0, 3).join() === 'Apple,Microsoft,S&P 500', JSON.stringify(line));
      for (const x of r) assert.ok(!x.over, JSON.stringify(x));
    } finally {
      await p.close();
    }
  });
});
