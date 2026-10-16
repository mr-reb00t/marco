// The data cards of Personalizado (Cripto, Deportes, Bolsa: web/display/widgets/canvas/data.ts) at every size they
// allow, in headless Chrome with the demo's made-up numbers (web/display/mockData.ts): one coin and several, euros and
// dollars, up and down, the large card with each chart, the chart under the numbers and behind them ("De fondo"); a
// team's live game, next game and last result, a whole competition, two followed at once, with and without crests;
// quotes as a list and as a ticker. Each size is drawn on a landscape screen, with a wide sidebar, in portrait and in
// portrait under a wide top bar (the real box changes, the size's name does not), and no card may be marked cramped
// (the editor's "No cabe") or have a name or a number cut.
// Skipped without a browser (set CHROME_PATH).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANVAS_KINDS } from '../core/canvasCore.js';
import { flexSamples } from './flexSizes.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const VARIANTS = {
  market: [
    { coins: [{ id: 'bitcoin', currency: 'eur' }], layout: 'list', range: '7d', chart: 'area' },
    { coins: [{ id: 'bitcoin', currency: 'usd' }, { id: 'ethereum', currency: 'eur' }, { id: 'solana', currency: 'usd' }, { id: 'cardano', currency: 'eur' }, { id: 'dogecoin', currency: 'usd' }], layout: 'list', range: '30d' },
    { coins: [{ id: 'bitcoin', currency: 'eur' }], layout: 'big', range: '7d', chart: 'area' },
    { coins: [{ id: 'cardano', currency: 'usd' }, { id: 'solana', currency: 'eur' }], layout: 'big', range: '1d', chart: 'line' },
    { coins: [{ id: 'ethereum', currency: 'usd' }], layout: 'big', range: '30d', chart: 'none' },
    { coins: [{ id: 'solana', currency: 'usd' }, { id: 'ripple', currency: 'eur' }], layout: 'list', range: '1d', chart: 'none' },
    // Estilo de la gráfica "De fondo": the chart filling the big card behind the price, and behind each row of a list
    { coins: [{ id: 'bitcoin', currency: 'usd' }], layout: 'big', range: '30d', chart: 'area', chartStyle: 'background' },
    { coins: [{ id: 'ethereum', currency: 'eur' }, { id: 'cardano', currency: 'usd' }], layout: 'big', range: '1d', chart: 'line', chartStyle: 'background' },
    { coins: [{ id: 'solana', currency: 'usd' }, { id: 'ripple', currency: 'eur' }, { id: 'cardano', currency: 'usd' }, { id: 'dogecoin', currency: 'usd' }], layout: 'list', range: '7d', chart: 'area', chartStyle: 'background' },
    { coins: [{ id: 'bitcoin', currency: 'usd' }, { id: 'ethereum', currency: 'usd' }], layout: 'list', range: '30d', chart: 'line', chartStyle: 'background' },
  ],
  sports: [
    { follow: [{ type: 'league', league: 'uefa.champions', name: '' }], max: 4, crests: true },
    { follow: [{ type: 'team', league: 'esp.1', team: '86', name: '' }], max: 4 },
    { follow: [{ type: 'league', league: 'nba', name: '' }], max: 3 },
    { follow: [{ type: 'team', league: 'esp.1', team: '86', name: '' }, { type: 'league', league: 'eng.1', name: '' }], max: 5, crests: false },
    { follow: [{ type: 'team', league: 'eng.1', team: '382', name: '' }], max: 2, show: 'next' },
    { follow: [{ type: 'team', league: 'nba', team: '9', name: '' }], max: 2, show: 'last' },
  ],
  stocks: [
    { symbols: [{ sym: 'AAPL', name: 'Apple' }, { sym: 'MSFT', name: 'Microsoft' }, { sym: 'SPY', name: 'S&P 500' }], layout: 'ticker' },
    { symbols: [{ sym: 'AAPL', name: 'Apple' }, { sym: 'MSFT', name: 'Microsoft' }, { sym: 'NVDA', name: '' }, { sym: 'TSLA', name: '' }, { sym: 'QQQ', name: '' }], layout: 'list' },
    { symbols: [{ sym: 'TSLA' }, { sym: 'GOOGL' }], layout: 'list', sparkline: true },
    { symbols: [{ sym: 'NVDA' }, { sym: 'AMZN' }, { sym: 'GOOGL' }, { sym: 'TSLA' }], layout: 'ticker', sparkline: true },
    { symbols: [{ sym: 'SPY', name: 'SPDR S&P 500 ETF Trust' }], layout: 'list' },
    { symbols: [{ sym: 'MSFT', name: 'Microsoft' }], layout: 'ticker' },
    { symbols: [{ sym: 'AAPL', name: 'Apple' }, { sym: 'NVDA', name: 'NVIDIA' }, { sym: 'TSLA', name: 'Tesla' }], layout: 'list', sparkline: true, chartStyle: 'background' },
  ],
};

const SCREENS = [
  { name: 'landscape', orientation: 'landscape', size: { width: 1920, height: 1080 }, sidebar: null },
  { name: 'landscape, wide sidebar on the left', orientation: 'landscape', size: { width: 1920, height: 1080 }, sidebar: 'left' },
  { name: 'portrait', orientation: 'portrait', size: { width: 1080, height: 1920 }, sidebar: null },
  { name: 'portrait, wide bar on top', orientation: 'portrait', size: { width: 1080, height: 1920 }, sidebar: 'top' },
];

/**
 * In the page: a screen of `kind` cards at `size` (as many as the grid holds, up to the kind's limit), props from
 * `variants` starting at `from`, laid over the demo's config the way the admin preview does; then, once every card
 * has its numbers, what does not fit.
 */
const DRAW = (kind, size, orientation, sidebar, variants, from) => `(async () => {
  const cc = await import('/@fs${ROOT}/server/core/canvasCore.js');
  const store = await import('/display/store.ts');
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const { cols, rows } = cc.CANVAS_GRID[${JSON.stringify(orientation)}];
  // a named size, or a box of its own ("5x3")
  const own = /^[0-9]+x[0-9]+$/.test(${JSON.stringify(size)});
  const [w, h] = own ? ${JSON.stringify(size)}.split('x').map(Number) : cc.sizeCells(${JSON.stringify(size)}, ${JSON.stringify(orientation)});
  const max = Math.min(6, cc.CANVAS_KINDS[${JSON.stringify(kind)}].perScreen ?? 6);
  const variants = ${JSON.stringify(variants)};
  const items = [];
  for (let y = 0; y + h <= rows && items.length < max; y += h) {
    for (let x = 0; x + w <= cols && items.length < max; x += w) {
      const n = items.length;
      items.push({
        id: 'cv_dsz' + String(n).padStart(5, '0'), kind: ${JSON.stringify(kind)}, pos: { zone: 'main', x, y, size: own ? cc.lookSize(${JSON.stringify(kind)}, w, h, ${JSON.stringify(orientation)}) : ${JSON.stringify(size)}, ...(own ? { w, h } : {}) },
        style: cc.defaultItemStyle(), props: { ...cc.canvasDefaults(${JSON.stringify(kind)}), ...variants[(${from} + n) % variants.length] },
      });
    }
  }
  const raw = { ...cc.defaultCanvas(), background: 'ambient', touch: true, items };
  ${sidebar ? `raw.sidebar = { ...cc.defaultCanvas().sidebar, side: ${JSON.stringify(sidebar)}, size: 'wide', fill: 'glass' };` : ''}
  // a card the grid has no room for is left out, as the editor would (a band in portrait)
  const canvas = cc.sanitizeCanvas({ err() {}, warn() {} }, 'canvas', raw, { widgets: new Map() }, {});
  const projected = cc.projectCanvas({ layout: { preset: 'canvas' }, screen: { orientation: ${JSON.stringify(orientation)} }, canvas }, {});
  store.setConfigOverlay((c) => ({ ...c, screen: { ...c.screen, orientation: ${JSON.stringify(orientation)} }, canvas: projected }));
  // until every card shows its numbers (no "loading" note), then a moment for the layout to settle
  const cards = () => [...document.querySelectorAll('.cv-item[data-canvas-item^="cv_dsz"]:not([hidden])')];
  for (let i = 0; i < 60; i++) {
    await pause(100);
    if (cards().length === projected.items.length && cards().every((e) => !e.querySelector('.cv-dt-note'))) break;
  }
  await document.fonts.ready;
  await pause(400);
  const out = [];
  for (const e of cards()) {
    const b = e.querySelector('.cv-body');
    const br = b.getBoundingClientRect();
    const cut = [];
    const leaves = [];
    for (const x of b.querySelectorAll('*')) {
      // a running ticker moves through its window by design
      if (x.closest('[hidden]') || x.closest('.cv-st-vp')) continue;
      const r = x.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const text = [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!text && x.tagName !== 'svg') continue;
      const what = (x.className.baseVal ?? x.className) + ' "' + x.textContent.slice(0, 24) + '"';
      if (r.bottom > br.bottom + 1 || r.right > br.right + 1 || r.top < br.top - 1 || r.left < br.left - 1) cut.push('outside the card: ' + what);
      if (!text) continue;
      if (x.scrollWidth > x.clientWidth + 1) cut.push('cut short: ' + what);
      if (x.clientHeight && x.scrollHeight > x.clientHeight + 2 && getComputedStyle(x).overflow !== 'visible') cut.push('clipped: ' + what);
      leaves.push([x, r, what]);
    }
    for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
      const [a, ra, wa] = leaves[i];
      const [c, rc, wc] = leaves[j];
      if (a.contains(c) || c.contains(a)) continue;
      if (ra.left < rc.right - 2 && rc.left < ra.right - 2 && ra.top < rc.bottom - 2 && rc.top < ra.bottom - 2) cut.push('over each other: ' + wa + ' / ' + wc);
    }
    out.push({ id: e.dataset.canvasItem, box: Math.round(br.width) + 'x' + Math.round(br.height), cramped: e.classList.contains('is-cramped'), empty: !b.textContent.trim(), cut });
  }
  return { n: projected.items.length, cards: out };
})()`;

const chrome = findChrome();
describe('data cards at every size, in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  for (const kind of ['market', 'sports', 'stocks']) {
    for (const screen of SCREENS) {
      test(`${kind}, ${screen.name}: every size fits, nothing cut (named sizes and boxes of their own)`, async () => {
        const p = await browser.page(`${web.url}/?demo=1&lite=1&now=2026-03-04T10:43&lang=es&preset=canvas&shot=data`, screen.size);
        try {
          await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 800)))');
          for (const size of [...CANVAS_KINDS[kind].sizes, ...flexSamples(kind, screen.orientation)]) {
            // enough rounds that every variant is drawn at this size
            let from = 0;
            do {
              const v = await p.eval(DRAW(kind, size, screen.orientation, screen.sidebar, VARIANTS[kind], from));
              assert.ok(v.n > 0, `${size}: a card on the grid`);
              assert.equal(v.cards.length, v.n, `${size}: every card is on screen`);
              for (const c of v.cards) {
                const label = `${kind} ${size} (${c.box}, ${screen.name}) #${c.id.slice(-2)}`;
                assert.equal(c.empty, false, `${label} drew nothing`);
                assert.equal(c.cramped, false, `${label} is marked cramped`);
                assert.deepEqual(c.cut, [], `${label}`);
              }
              from += v.n;
            } while (from < VARIANTS[kind].length);
          }
          const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
          assert.deepEqual(errors, []);
        } finally {
          await p.close();
        }
      });
    }
  }
});
