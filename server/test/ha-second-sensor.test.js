// An Entidad card with a second sensor (#28): "74 °F / 46.3 %" on one card. The validation (a sensor or a binary
// sensor, never something to control), its alias after the first entity's, never a touch control, left out of an
// exported file, and on screen the two values whole at every size (the vehicles-small demo).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SECOND_DOMAINS, canvasDefaults, defaultCanvas, defaultItemStyle, exportCanvasFile, haEntitiesOf, itemAliases, sanitizeCanvas } from '../core/canvasCore.js';
import { aliasesFor } from '../core/haCore.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const collector = () => {
  const errors = [];
  return { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
};
const tile = (id, props) => ({ id, kind: 'ha.tile', pos: { zone: 'main', x: 0, y: 0, size: 'xs' }, style: defaultItemStyle(), props: { ...canvasDefaults('ha.tile'), ...props } });

test('the second sensor: empty by default, a sensor or a binary sensor, never a light or a switch', () => {
  assert.deepEqual(TILE_SECOND_DOMAINS, ['sensor', 'binary_sensor']);
  assert.equal(canvasDefaults('ha.tile').entity2, '');
  for (const [v, want, bad] of [
    ['sensor.garage_humidity', 'sensor.garage_humidity', false],
    ['binary_sensor.garage_door', 'binary_sensor.garage_door', false],
    ['switch.fan', '', true],
    ['light.hall', '', true],
    ['not an entity', '', true],
    [null, '', false],
  ]) {
    const c = collector();
    const out = sanitizeCanvas(c, 'canvas', { ...defaultCanvas(), items: [tile('cv_tile0001', { entity: 'sensor.garage_temp', entity2: v })] }, {}, {});
    assert.equal(out.items[0].props.entity2, want, String(v));
    assert.equal(c.errors.some((e) => e.includes('entity2')), bad, `${v}: ${c.errors}`);
  }
});

test('its alias comes after the first entity\'s, it is watched, never a touch control, and an exported file drops it', () => {
  const it = tile('cv_tile0001', { entity: 'sensor.garage_temp', entity2: 'sensor.garage_humidity' });
  assert.deepEqual(haEntitiesOf(it), ['sensor.garage_temp', 'sensor.garage_humidity']);
  assert.deepEqual(itemAliases(it).map((a) => [a.alias, a.entity]), [['cv_tile0001:0', 'sensor.garage_temp'], ['cv_tile0001:1', 'sensor.garage_humidity']]);
  const al = aliasesFor({ id: 's1', layout: { preset: 'canvas' }, canvas: { ...defaultCanvas(), items: [it] } });
  assert.equal(al.get('cv_tile0001:0').interactive, true);
  assert.equal(al.get('cv_tile0001:1').interactive, false);
  const file = exportCanvasFile({ ...defaultCanvas(), items: [it] });
  assert.equal(file.canvas.items[0].props.entity2, '');
  assert.deepEqual(file.picks.cv_tile0001, ['entities']);
});

const chrome = findChrome();
describe('the second sensor on screen (#28), in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  test('both values whole: beside the name, under it on a short line, broken at the slash on a tall card', { timeout: 60_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=vehicles-small&lang=en`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))');
      const r = await p.eval(`[...document.querySelectorAll('.cv-item[data-kind="ha.tile"]')].map((e) => {
        const st = e.querySelector('.cv-ha-state');
        const card = e.querySelector('.cv-ha-tile-card') ?? e;
        return { cells: e.dataset.cells, state: st.textContent.replace(/\\u00a0/g, ' '), cut: st.scrollWidth > st.clientWidth + 1, over: card.scrollHeight > card.clientHeight + 1, wrap: st.classList.contains('is-wrap'), lines: Math.round(st.getBoundingClientRect().height / parseFloat(getComputedStyle(st).lineHeight)) };
      }).filter((x) => x.state.includes(' / '))`);
      assert.equal(r.length, 4, JSON.stringify(r));
      for (const x of r) {
        assert.equal(x.state, '74 °F / 46.3 %', JSON.stringify(x));
        assert.ok(!x.cut && !x.over, JSON.stringify(x));
      }
      // the tall narrow card: on two lines, broken at the slash; the others on one
      const tall = r.find((x) => x.cells === '3x3');
      assert.ok(tall?.wrap && tall.lines === 2, JSON.stringify(r));
      assert.ok(r.filter((x) => x.cells !== '3x3').every((x) => !x.wrap && x.lines === 1), JSON.stringify(r));
    } finally {
      await p.close();
    }
  });
});
