// Small boxes that keep what a size up shows (#31): the digital clock two cells high keeps its date (under the time),
// the weather now two cells high and four or more wide its sky, high and low, place and details (beside the
// temperature); the meals cards three cells wide; an Indicador's second sensor after its number (#28) (the
// "two-high" demo).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boxAllowed, canvasDefaults, defaultCanvas, defaultItemStyle, haEntitiesOf, sanitizeCanvas } from '../core/canvasCore.js';
import { aliasesFor } from '../core/haCore.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

test('the meals cards can be three cells wide', () => {
  assert.ok(boxAllowed('meals.today', 3, 1));
  assert.ok(boxAllowed('meals.week', 3, 2));
  assert.ok(!boxAllowed('meals.today', 2, 1));
});

test('an Indicador takes a second sensor: a sensor read only, never a touch control', () => {
  const gauge = (entity2) => ({ id: 'cv_gauge001', kind: 'ha.gauge', pos: { zone: 'main', x: 0, y: 0, w: 4, h: 1 }, style: defaultItemStyle(), props: { ...canvasDefaults('ha.gauge'), entity: 'sensor.car_battery', entity2 } });
  assert.equal(canvasDefaults('ha.gauge').entity2, '');
  for (const [v, want] of [['sensor.car_range', 'sensor.car_range'], ['switch.fan', ''], [null, '']]) {
    const errors = [];
    const out = sanitizeCanvas({ errors, err: (q, m) => errors.push(`${q}: ${m}`), warn() {} }, 'canvas', { ...defaultCanvas(), items: [gauge(v)] }, {}, {});
    assert.equal(out.items[0].props.entity2, want, String(v));
  }
  const it = gauge('sensor.car_range');
  assert.deepEqual(haEntitiesOf(it), ['sensor.car_battery', 'sensor.car_range']);
  const al = aliasesFor({ id: 's1', layout: { preset: 'canvas' }, canvas: { ...defaultCanvas(), items: [it] } });
  assert.equal(al.get('cv_gauge001:1').entity, 'sensor.car_range');
  assert.equal(al.get('cv_gauge001:1').interactive, false);
});

describe('two cells high in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  test('the two-high demo', { timeout: 60_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=two-high&lang=en`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const clocks = await p.eval(`[...document.querySelectorAll('.cv-item[data-kind="clock.digital"] .cv-body')].map((b) => {
        const d = b.querySelector('.date');
        return { mh: b.dataset.mh, date: !!d && d.getClientRects().length > 0 && d.scrollWidth <= d.clientWidth + 1, over: b.scrollHeight > b.clientHeight + 2 };
      })`);
      assert.equal(clocks.length, 4, JSON.stringify(clocks));
      for (const c of clocks) assert.ok(c.date && !c.over, JSON.stringify(clocks));
      const wx = await p.eval(`[...document.querySelectorAll('.cv-item[data-kind="weather.now"] .cv-body')].map((b) => {
        const on = (q) => { const e = b.querySelector(q); return !!e && e.getClientRects().length > 0; };
        return { mw: b.dataset.mw, mh: b.dataset.mh, wide: b.classList.contains('is-mwide'), cond: on('.cv-wx-cond'), hl: on('.cv-wx-hl'), meta: on('.cv-wx-meta'),
          over: b.scrollHeight > b.clientHeight + 2 || b.scrollWidth > b.clientWidth + 2 };
      })`);
      assert.equal(wx.length, 4, JSON.stringify(wx));
      for (const w of wx) assert.ok(w.cond && !w.over, JSON.stringify(wx));
      // six cells wide, two or three high: everything a size up shows, on one row
      for (const w of wx.filter((x) => x.mw === '6')) assert.ok(w.wide && w.hl && w.meta, JSON.stringify(w));
      const meals = await p.eval(`[...document.querySelectorAll('.cv-item[data-kind^="meals."]')].map((e) => ({ w: e.getBoundingClientRect().width, kind: e.dataset.kind }))`);
      assert.ok(meals.some((m) => m.w < 1920 / 24 * 3.5), JSON.stringify(meals));
      const g = await p.eval(`[...document.querySelectorAll('.cv-item[data-kind="ha.gauge"] .cv-ha-big')].map((b) => {
        const v2 = b.querySelector('.v2');
        return { v2: v2 ? v2.textContent : null, on: !!v2 && v2.getClientRects().length > 0, over: b.scrollWidth > b.clientWidth + 2 };
      })`);
      assert.equal(g.length, 4, JSON.stringify(g));
      for (const x of g) assert.ok(/^\/ \d+ mi$/.test(x.v2), JSON.stringify(g));
      assert.ok(g.filter((x) => x.on).length >= 3, JSON.stringify(g));
    } finally {
      await p.close();
    }
  });
});
