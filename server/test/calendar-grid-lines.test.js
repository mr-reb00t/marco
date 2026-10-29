// Calendar grid lines (#29): how much the month / week grid's lines show (calendar.gridLines: soft, clear, strong) and
// their own colour (gridColor), for the screen's calendar and for the month and week cards (the "calendar-grid" demo).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_KINDS, canvasDefaults, INK_PROPS } from '../core/canvasCore.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const props = (kind, x) => {
  const errors = [];
  const c = { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
  return { p: CANVAS_KINDS[kind].props(c, 'p', { ...canvasDefaults(kind), ...x }, {}, {}), errors };
};

test('grid lines on the month and week cards: soft by default, clear or strong, a colour of their own or none', () => {
  for (const kind of ['calendar.month', 'calendar.week']) {
    assert.equal(props(kind, {}).p.gridLines, 'soft', kind);
    assert.equal(props(kind, {}).p.gridColor, undefined, `${kind}: no colour saved while on Automático`);
    assert.equal(props(kind, { gridLines: 'strong' }).p.gridLines, 'strong', kind);
    assert.equal(props(kind, { gridColor: '#64D2FF' }).p.gridColor, '#64d2ff', kind);
    for (const bad of ['red', 'url(x)', '#12345', 'var(--x)']) {
      const r = props(kind, { gridColor: bad });
      assert.equal(r.p.gridColor, undefined, `${kind} ${bad}`);
      assert.ok(r.errors.some((e) => e.includes('gridColor')), `${kind} ${bad}`);
    }
    const r = props(kind, { gridLines: 'thick' });
    assert.equal(r.p.gridLines, 'soft');
    assert.ok(r.errors.some((e) => e.includes('gridLines')));
    assert.deepEqual(INK_PROPS[kind], ['gridColor'], 'its colour is in the Estilo tab');
  }
});

test('grid lines on the screen calendar: soft and no colour for every screen saved before, checked like the rest', () => {
  const d = defaultConfig();
  const withCal = (cal) => {
    const c = structuredClone(d);
    Object.assign(c.screens[0].calendar, cal);
    return validateConfig(c);
  };
  assert.equal(d.screens[0].calendar.gridLines, 'soft');
  assert.equal(d.screens[0].calendar.gridColor, null);
  const ok = withCal({ gridLines: 'clear', gridColor: '#FF0000' });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.value.screens[0].calendar.gridLines, 'clear');
  assert.equal(ok.value.screens[0].calendar.gridColor, '#ff0000');
  const old = structuredClone(d);
  delete old.screens[0].calendar.gridLines;
  delete old.screens[0].calendar.gridColor;
  const kept = validateConfig(old);
  assert.equal(kept.value.screens[0].calendar.gridLines, 'soft');
  assert.equal(kept.value.screens[0].calendar.gridColor, null);
  const bad = withCal({ gridLines: 'x', gridColor: 'red;}' });
  assert.ok(bad.errors.some((e) => e.path.endsWith('calendar.gridLines')), JSON.stringify(bad.errors));
  assert.ok(bad.errors.some((e) => e.path.endsWith('calendar.gridColor')), JSON.stringify(bad.errors));
  assert.equal(bad.value.screens[0].calendar.gridColor, null);
});

describe('grid lines in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  test('the calendar-grid demo', { timeout: 60_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=calendar-grid&lang=es`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const r = await p.eval(`[...document.querySelectorAll('.cv-item[data-kind^="calendar."] .cal')].map((cal) => {
        const wk = getComputedStyle(cal.querySelector('.wk'));
        const cell = getComputedStyle(cal.querySelector('.wk .cell:nth-child(3)'));
        const modern = !!cal.closest('.style-modern');
        return {
          grid: cal.dataset.grid ?? '', c: cal.style.getPropertyValue('--grid-c'),
          w: parseFloat(modern ? wk.borderTopWidth : wk.borderBottomWidth),
          color: modern ? wk.borderTopColor : wk.borderBottomColor,
          col: cell.borderLeftColor, colW: parseFloat(cell.borderLeftWidth),
        };
      })`);
      assert.equal(r.length, 4, JSON.stringify(r));
      const [soft, clear, strong, week] = r;
      const alpha = (c) => {
        const v = (c.match(/\(([^)]*)\)/)?.[1] ?? '').replace(/^srgb /, '').split(/[ ,/]+/).filter(Boolean).map(Number);
        return v.length > 3 ? v[3] : 1;
      };
      assert.equal(soft.grid, '');
      assert.equal(clear.grid, 'clear');
      assert.ok(alpha(clear.color) > alpha(soft.color), JSON.stringify([soft, clear]));
      assert.equal(strong.grid, 'strong');
      assert.equal(strong.c, '#64d2ff');
      assert.equal(strong.w, 2, JSON.stringify(strong));
      assert.match(strong.color, /100, 210, 255|0\.39\d* 0\.82\d* 1/, JSON.stringify(strong));
      // the day columns show their lines too
      assert.ok(alpha(clear.col) > 0 && alpha(strong.col) > 0, JSON.stringify(r));
      assert.equal(week.c, '#ffb340');
      assert.match(week.color, /255, 179, 64|1 0\.70\d* 0\.25\d*/, JSON.stringify(week));
    } finally {
      await p.close();
    }
  });
});
