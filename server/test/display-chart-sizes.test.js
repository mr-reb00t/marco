// Every card of Personalizado that draws a chart (the Sensor with today's curve, binary sensors beside it, Gráfica,
// Cripto, Bolsa with its sparklines, the electricity prices widget) at every box from its smallest up to 12×8 fine
// cells (6×4 on the normal grid), on the fine grid and on the normal one, with the chart under the numbers ("Debajo")
// and behind them ("De fondo"): wherever the card is two rows high or more its chart is drawn and seen (an element of
// some area, not hidden), the card is never marked "No cabe" and no text is cut by its edge. A Sensor 5×3 on the fine
// grid drew the one-line look with no curve while 4×4 had it (the boxes three fine rows high are drawn like the 'row'
// size). Skipped without a browser (set CHROME_PATH).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cellRange } from '../core/canvasCore.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Each kind: its copies (props; chart: whether a chart must show), and where its chart is drawn. */
const KINDS = {
  'ha.sensor': {
    chart: 'svg.cv-curve',
    variants: [
      { chart: true, props: { entity: 'sensor.demo_0', sparkline: true, chartStyle: 'background', decimals: 1 } },
      { chart: true, props: { entity: 'sensor.demo_2', sparkline: true, chartStyle: 'below', decimals: 1, name: 'Humedad del dormitorio de invitados' } },
      { chart: false, props: { entity: 'binary_sensor.demo_1' } },
    ],
  },
  'ha.chart': {
    chart: 'svg.cv-ha-chart-svg',
    variants: ['line', 'area', 'bar'].flatMap((type, i) => ['below', 'background'].map((chartStyle) => ({
      chart: true, props: { series: [0, 1].map((j) => ({ entity: `sensor.chart_${i}_${j}`, label: '', color: null })), period: '24h', type, chartStyle },
    }))),
  },
  market: {
    chart: 'svg.cv-curve',
    variants: [
      ...['below', 'background'].map((chartStyle) => ({ chart: true, props: { coins: [{ id: 'bitcoin', currency: 'eur' }], layout: 'big', range: '7d', chart: 'area', chartStyle } })),
      ...['below', 'background'].map((chartStyle) => ({ chart: true, props: { coins: [{ id: 'ethereum', currency: 'usd' }, { id: 'solana', currency: 'eur' }], layout: 'list', range: '30d', chart: 'line', chartStyle } })),
    ],
  },
  stocks: {
    chart: 'svg.cv-curve',
    variants: ['below', 'background'].map((chartStyle) => ({ chart: true, props: { symbols: [{ sym: 'AAPL', name: 'Apple' }, { sym: 'NVDA', name: 'NVIDIA' }], layout: 'list', sparkline: true, chartStyle } })),
  },
  widget: {
    chart: '.pw-chart svg',
    variants: ['below', 'background'].map((chartStyle) => ({ chart: true, props: { widgetId: 'w_demo_prices', chartStyle } })),
  },
};

/** Every w×h of `kind` from its smallest up to 12×8 cells of the fine grid (6×4 of the normal one). */
function boxes(kind, grid) {
  const r = cellRange(kind, 'landscape', grid);
  const f = grid === 'fine' ? 2 : 1;
  const out = [];
  for (let h = r.minH; h <= Math.min(r.maxH, 4 * f); h++) for (let w = r.minW; w <= Math.min(r.maxW, 6 * f); w++) out.push([w, h]);
  return out;
}

/**
 * In the page: the copies of `kind` at w×h on `grid`, two across and two down, laid over the demo's config the way
 * the admin preview does; once each has drawn, what each shows.
 */
const DRAW = (kind, grid, w, h, variants, from, chartSel) => `(async () => {
  const cc = await import('/@fs${ROOT}/server/core/canvasCore.js');
  const store = await import('/display/store.ts');
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const variants = ${JSON.stringify(variants)};
  const items = [];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const n = ${from} + items.length;
    if (items.length >= variants.length) break;
    const v = variants[n % variants.length];
    items.push({
      id: 'cv_chs' + String(items.length).padStart(5, '0'), kind: ${JSON.stringify(kind)},
      pos: { zone: 'main', x: x * ${w}, y: y * ${h}, size: cc.lookSize(${JSON.stringify(kind)}, ${w}, ${h}, 'landscape', ${JSON.stringify(grid)}), w: ${w}, h: ${h} },
      style: cc.defaultItemStyle(), props: { ...cc.canvasDefaults(${JSON.stringify(kind)}), ...v.props },
    });
  }
  const raw = { ...cc.defaultCanvas(), background: 'ambient', touch: true, grid: ${JSON.stringify(grid)}, items };
  const canvas = cc.sanitizeCanvas({ err() {}, warn() {} }, 'canvas', raw, { widgets: new Map([['w_demo_prices', {}]]) }, {});
  const projected = cc.projectCanvas({ layout: { preset: 'canvas' }, screen: { orientation: 'landscape' }, canvas }, {});
  // the prices widget with its chart on (its automatic view shows the price alone on a card of this size)
  store.setConfigOverlay((c) => ({ ...c, screen: { ...c.screen, orientation: 'landscape' }, canvas: projected,
    widgets: (c.widgets ?? []).map((x) => (x.prices ? { ...x, prices: { ...x.prices, view: 'nowchart' } } : x)) }));
  const cards = () => [...document.querySelectorAll('.cv-item[data-canvas-item^="cv_chs"]:not([hidden])')];
  const drawn = (e) => e.querySelector('.cv-body').textContent.trim() && !e.querySelector('.cv-dt-note');
  for (let i = 0; i < 40; i++) {
    await pause(60);
    if (cards().length === projected.items.length && cards().every(drawn)) break;
  }
  await pause(250);
  return cards().map((e, i) => {
    const b = e.querySelector('.cv-body');
    const br = b.getBoundingClientRect();
    // the chart: some area, inside the card, not hidden
    const charts = [...b.querySelectorAll(${JSON.stringify(chartSel)})].filter((c) => {
      const r = c.getBoundingClientRect();
      const vis = r.width >= 8 && r.height >= 8 && r.right > br.left + 4 && r.left < br.right - 4 && r.bottom > br.top + 4 && r.top < br.bottom - 4;
      if (!vis) return false;
      for (let n = c; n && n !== b; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      }
      return true;
    });
    const cut = [...b.querySelectorAll('*')]
      .filter((t) => !(t instanceof SVGElement) && !t.closest('.cv-slider, .cv-ha-toast, .cv-st-vp')
        && [...t.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && t.getClientRects().length && getComputedStyle(t).visibility !== 'hidden')
      .filter((t) => {
        const r = t.getBoundingClientRect();
        const out = r.bottom > br.bottom + 1 || r.top < br.top - 1 || r.right > br.right + 1 || r.left < br.left - 1;
        const seen = r.right > br.left + 1 && r.left < br.right - 1 && r.bottom > br.top + 1 && r.top < br.bottom - 1;
        for (let n = t; n && n !== b; n = n.parentElement) if (getComputedStyle(n).textOverflow === 'ellipsis' || /\\bmq/.test(n.className)) return false;
        return out && seen;
      })
      .map((t) => (t.className || t.tagName) + ' "' + t.textContent.trim().slice(0, 20) + '"');
    return { i, cramped: e.classList.contains('is-cramped'), chart: charts.length > 0, cut };
  });
})()`;

const chrome = findChrome();
describe('chart cards at every size, both chart styles, in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  for (const grid of ['fine', 'normal']) {
    for (const [kind, spec] of Object.entries(KINDS)) {
      test(`${kind}, ${grid} grid: the chart at every box two rows high or more, nothing cramped or cut`, { timeout: 900_000 }, async () => {
        const [w0, h0] = boxes(kind, grid)[0];
        const p = await browser.page(`${web.url}/?demo=1&lite=1&now=2026-03-04T10:43&lang=es&preset=canvas&shot=size:${kind}:${w0}x${h0}:landscape:none:ambient${grid === 'fine' ? ':fine' : ''}`, { width: 1920, height: 1080 });
        const bad = [];
        try {
          await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 800)))');
          for (const [w, h] of boxes(kind, grid)) {
            for (let from = 0; from < spec.variants.length; from += 4) {
              const cards = await p.eval(DRAW(kind, grid, w, h, spec.variants, from, spec.chart));
              if (!cards.length) bad.push(`${w}x${h}: no cards`);
              for (const c of cards) {
                const v = spec.variants[(from + c.i) % spec.variants.length];
                const label = `${w}x${h} ${JSON.stringify(v.props.chartStyle ?? v.props.entity)}${v.props.type ? ` ${v.props.type}` : ''}${v.props.layout ? ` ${v.props.layout}` : ''}`;
                if (v.chart && h >= 2 && !c.chart) bad.push(`${label}: no chart`);
                if (c.cramped) bad.push(`${label}: No cabe`);
                if (c.cut.length) bad.push(`${label}: cuts ${c.cut.join(', ')}`);
              }
            }
          }
          const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
          assert.deepEqual(errors, []);
        } finally {
          await p.close();
        }
        assert.deepEqual(bad, []);
      });
    }
  }
});
