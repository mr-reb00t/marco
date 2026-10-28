// Issue #26, icons on the Home Assistant cards: the "Icono" an owner picks (canvasCore HA_ICONS, the same names the
// display draws, widgets/ha/haIcons.ts) on an Entidad, Sensor or Indicador card and on each row of a Habitación, kept
// when known and dropped to the automatic one otherwise; and a battery that shows its level. In a browser, the demo
// 'vehicles' screen (mockCanvas.ts): a battery at 54 % filled, the fuel icon picked, a range with the gauge icon and a
// phone at 12 % in red. Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HA_ICONS, canvasDefaults, defaultCanvas, defaultItemStyle, sanitizeCanvas } from '../core/canvasCore.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const LAND = { width: 1920, height: 1080 };
const collector = () => {
  const errors = [];
  return { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
};
// (the server gives each card an id of its own: they are told apart by their place)
const item = (x, kind, props) => ({ id: '', kind, pos: { zone: 'main', x, y: 0, size: kind === 'ha.room' ? 'l' : 's' }, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props } });
const clean = (items) => {
  const c = collector();
  const out = sanitizeCanvas(c, 'canvas', { ...defaultCanvas(), items }, {}, {});
  return { items: out.items, errors: c.errors };
};

test('HA_ICONS are the icons the display draws, every one of them', () => {
  const src = fs.readFileSync(new URL('../../web/display/widgets/ha/haIcons.ts', import.meta.url), 'utf8');
  const drawn = [...src.matchAll(/^ {2}(\w+): g\(/gm)].map((m) => m[1]);
  assert.deepEqual([...HA_ICONS].sort(), [...drawn].sort());
  assert.ok(HA_ICONS.every((n) => n.length <= 8));
});

test('an icon an owner picked is kept; an unknown one is the automatic one, on cards and room rows', () => {
  const { items, errors } = clean([
    item(0, 'ha.tile', { entity: 'sensor.car_battery', icon: 'fuel' }),
    item(6, 'ha.sensor', { entity: 'sensor.car_range', icon: '<svg>' }),
    item(12, 'ha.gauge', { entity: 'sensor.car_battery', icon: 'battery' }),
    { ...item(0, 'ha.room', { rows: [{ entity: 'sensor.car_range', icon: 'gauge' }, { entity: 'binary_sensor.car_plug', icon: 'nope' }, { entity: 'sensor.phone_battery' }] }), pos: { zone: 'main', x: 0, y: 4, size: 'l' } },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 4);
  const by = Object.fromEntries(items.map((i) => [i.kind, i.props]));
  assert.equal(by['ha.tile'].icon, 'fuel');
  assert.equal(by['ha.sensor'].icon, '');
  assert.equal(by['ha.gauge'].icon, 'battery');
  assert.deepEqual(by['ha.room'].rows.map((r) => r.icon), ['gauge', '', '']);
  assert.equal(canvasDefaults('ha.tile').icon, '');
});

const chrome = findChrome();
describe('icons on the Home Assistant cards (#26), in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  test('a battery shows its level (red when low), a picked icon replaces the automatic one, whole percents', { timeout: 60_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=vehicles`, LAND);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))');
      const r = await p.eval(`({
        tiles: [...document.querySelectorAll('.cv-item[data-kind="ha.tile"]')].map((e) => {
          const i = e.querySelector('.cv-ha-ico');
          return { icon: i.dataset.icon, level: i.dataset.level ?? null, low: i.classList.contains('is-low'), fill: i.querySelector('rect[fill]')?.getAttribute('width') ?? null, state: e.querySelector('.cv-ha-state').textContent, bar: !!e.querySelector('.cv-ha-feats > *') };
        }),
        rows: [...document.querySelectorAll('.cv-ha-row')].map((e) => {
          const i = e.querySelector('.cv-ha-ico');
          return { icon: i.dataset.icon, level: i.dataset.level ?? null, low: i.classList.contains('is-low'), red: getComputedStyle(i).color, state: e.querySelector('.cv-ha-state').textContent };
        }),
      })`);
      const msg = JSON.stringify(r);
      const [tesla, toyota] = r.tiles;
      assert.deepEqual({ ...tesla, fill: undefined }, { icon: 'battery', level: '54', low: false, fill: undefined, state: '54 %', bar: true }, msg);
      assert.equal(Number(tesla.fill), 5.9, msg);
      assert.equal(toyota.icon, 'fuel', msg);
      assert.equal(toyota.level, null, msg);
      assert.equal(toyota.bar, true, msg);
      const [range, plug, phone] = r.rows;
      assert.equal(range.icon, 'gauge', msg);
      assert.equal(plug.icon, 'plug', msg);
      assert.equal(plug.state, 'Unplugged', msg);
      assert.deepEqual([phone.icon, phone.level, phone.low, phone.state], ['battery', '12', true, '12 %'], msg);
      assert.notEqual(phone.red, range.red, msg);
    } finally {
      await p.close();
    }
  });
});
