// Days of the week the month / week grid shows (#39): calendar.weekdays on the screen and weekdays on the month and
// week cards. Hidden days take no column, their events are not drawn and a multi-day event crossing one is clipped to
// the shown days. Missing everywhere (older configs and cards) means all seven, exactly as before.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CANVAS_KINDS, canvasDefaults, canvasFromDesign } from '../core/canvasCore.js';
import { defaultConfig, SCREEN_SPLIT_KEYS } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';
import { validateConfig } from '../core/validate.js';
import { loadWebModules } from './webModules.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const ALL = [0, 1, 2, 3, 4, 5, 6];
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const withCal = (cal) => {
  const c = defaultConfig();
  Object.assign(c.screens[0].calendar, cal);
  return validateConfig(c);
};

test('calendar.weekdays: all seven by default, a per-screen key in both copies of SCREEN_SPLIT_KEYS', () => {
  assert.deepEqual(defaultConfig().screens[0].calendar.weekdays, ALL);
  assert.ok(SCREEN_SPLIT_KEYS.calendar.includes('weekdays'));
  assert.match(read('web/shared/screens.ts'), /'startOn', 'weekdays'/);
});

test('calendar.weekdays: kept sorted, passed to the display, all seven for a config saved before it', () => {
  for (const [v, want] of [[[1, 2, 3, 4, 5], [1, 2, 3, 4, 5]], [[6, 0], [0, 6]], [[3], [3]]]) {
    const r = withCal({ weekdays: v });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.value.screens[0].calendar.weekdays, want);
    assert.deepEqual(displayConfig(r.value, r.value.screens[0]).calendar.weekdays, want);
  }
  const old = defaultConfig();
  delete old.screens[0].calendar.weekdays;
  const r = validateConfig(old);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.screens[0].calendar.weekdays, ALL);
});

test('calendar.weekdays: anything else is an error and all seven', () => {
  for (const bad of [[], [7], [-1], ['1'], [1.5], [1, 1], 'mon', {}]) {
    const r = withCal({ weekdays: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.errors.some((e) => e.path === 'screens[0].calendar.weekdays'), `${JSON.stringify(bad)}: ${JSON.stringify(r.errors)}`);
    if (!Array.isArray(bad) || !bad.length || bad.every((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      assert.deepEqual(r.value.screens[0].calendar.weekdays, ALL, JSON.stringify(bad));
    }
  }
});

const props = (kind, x) => {
  const errors = [];
  const c = { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
  return { p: CANVAS_KINDS[kind].props(c, 'p', x, {}, {}), errors };
};

test('weekdays on the month and week cards: all seven when missing, checked like the screen setting', () => {
  for (const kind of ['calendar.month', 'calendar.week']) {
    assert.deepEqual(canvasDefaults(kind).weekdays, ALL, kind);
    assert.deepEqual(props(kind, {}).p.weekdays, ALL, kind);
    assert.deepEqual(props(kind, { weekdays: [5, 6, 0] }).p.weekdays, [0, 5, 6], kind);
    assert.equal(props(kind, { weekdays: [5, 6, 0] }).errors.length, 0, kind);
    for (const bad of [[], [9], 'x']) {
      const r = props(kind, { weekdays: bad });
      assert.deepEqual(r.p.weekdays, ALL, `${kind} ${JSON.stringify(bad)}`);
      assert.ok(r.errors.some((e) => e.startsWith('p.weekdays')), `${kind} ${JSON.stringify(bad)}`);
    }
  }
  assert.equal(props('calendar.agenda', { weekdays: [1] }).p.weekdays, undefined, 'the agenda card has no such prop');
});

test('Copiar mi diseño actual takes the screen\'s days into the month card', () => {
  const { canvas } = canvasFromDesign({ layout: { preset: 'bigCalendar' }, calendar: { weeks: 2, weekdays: [1, 2, 3, 4, 5] } });
  const month = canvas.items.find((it) => it.kind === 'calendar.month');
  assert.deepEqual(month.props.weekdays, [1, 2, 3, 4, 5]);
  const plain = canvasFromDesign({ layout: { preset: 'bigCalendar' }, calendar: {} }).canvas.items.find((it) => it.kind === 'calendar.month');
  assert.deepEqual(plain.props.weekdays, ALL);
});

test('display: weekdays normalised again, a card never takes the screen\'s days', async () => {
  const [defs, cfgMod] = await loadWebModules('/web/display/defaults.ts', '/web/display/widgets/canvas/config.ts');
  assert.deepEqual(defs.normalizeConfig({}).calendar.weekdays, ALL);
  assert.deepEqual(defs.normalizeConfig({ calendar: { weekdays: [] } }).calendar.weekdays, ALL);
  assert.deepEqual(defs.normalizeConfig({ calendar: { weekdays: 'mon' } }).calendar.weekdays, ALL);
  assert.deepEqual(defs.normalizeConfig({ calendar: { weekdays: [3, 3, 8, '1', 1] } }).calendar.weekdays, [1, 3]);
  const screen = defs.normalizeConfig({ calendar: { weekdays: [1, 2, 3, 4, 5] } });
  const item = (id, kind, props) => ({ id, kind, v: 1, props, pos: { x: 0, y: 0, w: 6, h: 4 } });
  assert.deepEqual(cfgMod.itemCfg(screen, item('a', 'calendar.month', {})).calendar.weekdays, ALL);
  assert.deepEqual(cfgMod.itemCfg(screen, item('b', 'calendar.month', { weekdays: [0, 6] })).calendar.weekdays, [0, 6]);
  assert.deepEqual(cfgMod.itemCfg(screen, item('c', 'calendar.week', { weekdays: [6] })).calendar.weekdays, [6]);
});

test('layout helpers: shown columns of a row and an event clipped to them', async () => {
  const [{ visibleCols, clipSpan }] = await loadWebModules('/web/display/weekdays.ts');
  assert.deepEqual(visibleCols(1, [1, 2, 3, 4, 5]), [0, 1, 2, 3, 4]);
  assert.deepEqual(visibleCols(1, ALL), ALL);
  assert.deepEqual(visibleCols(0, [0, 6]), [0, 6]);
  assert.deepEqual(visibleCols(1, [0, 6]), [5, 6]);
  assert.deepEqual(visibleCols(3, [0, 6]), [3, 4], 'rows starting on a Wednesday (startOn today)');
  assert.deepEqual(visibleCols(1, []), ALL);
  const mf = [0, 1, 2, 3, 4];
  assert.deepEqual(clipSpan(4, 6, mf), { c0: 4, c1: 4, clipL: false, clipR: true }, 'Fri..Sun on Mon-Fri');
  assert.deepEqual(clipSpan(0, 6, mf), { c0: 0, c1: 4, clipL: false, clipR: true });
  assert.equal(clipSpan(5, 6, mf), null, 'a weekend only event');
  assert.deepEqual(clipSpan(1, 3, [0, 1, 3, 4]), { c0: 1, c1: 2, clipL: false, clipR: false }, 'Tue..Thu with Wednesday hidden');
  assert.equal(clipSpan(2, 2, [0, 1, 3]), null);
  assert.deepEqual(clipSpan(0, 3, [2, 5]), { c0: 0, c1: 0, clipL: true, clipR: true });
  assert.deepEqual(clipSpan(2, 4, ALL), { c0: 2, c1: 4, clipL: false, clipR: false });
});

describe('days shown in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  const grid = async (query) => {
    const p = await browser.page(`${web.url}/?demo=1&lang=es&${query}`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      return await p.eval(`(() => {
        const cal = document.querySelector('.cal');
        const rows = [...cal.querySelectorAll('.wk')];
        return {
          heads: [...cal.querySelectorAll('.cal-dow > div')].map((d) => ({ we: d.classList.contains('we'), text: d.textContent })),
          dowTracks: getComputedStyle(cal.querySelector('.cal-dow')).gridTemplateColumns.split(' ').length,
          rows: rows.map((wk) => ({
            nums: wk.querySelectorAll('.num').length,
            tracks: getComputedStyle(wk).gridTemplateColumns.split(' ').length,
            we: wk.querySelectorAll('.cell.we').length,
            ends: [...wk.querySelectorAll(':scope > .ev')].map((e) => parseInt(getComputedStyle(e).gridColumnEnd, 10)),
          })),
        };
      })()`);
    } finally {
      await p.close();
    }
  };

  test('Monday to Friday: five columns, no weekend', { timeout: 60_000 }, async () => {
    const r = await grid('preset=bigCalendar&weeks=2&weekdays=1,2,3,4,5');
    assert.equal(r.heads.length, 5, JSON.stringify(r.heads));
    assert.ok(r.heads.every((h) => !h.we));
    assert.equal(r.dowTracks, 5);
    assert.equal(r.rows.length, 2);
    for (const row of r.rows) {
      assert.equal(row.nums, 5);
      assert.equal(row.tracks, 10);
      assert.equal(row.we, 0);
      assert.ok(row.ends.every((e) => e <= 11), JSON.stringify(row.ends));
    }
  });

  test('without the setting: seven columns as before', { timeout: 60_000 }, async () => {
    const r = await grid('preset=bigCalendar&weeks=2');
    assert.equal(r.heads.length, 7);
    assert.equal(r.dowTracks, 7);
    for (const row of r.rows) {
      assert.equal(row.nums, 7);
      assert.equal(row.tracks, 14);
    }
  });

  test('week view, weekend only, starting today: two columns', { timeout: 60_000 }, async () => {
    const r = await grid('preset=bigCalendar&view=week&weekdays=0,6&startOn=today');
    assert.equal(r.heads.length, 2, JSON.stringify(r.heads));
    assert.ok(r.heads.every((h) => h.we));
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].nums, 2);
    assert.equal(r.rows[0].tracks, 4);
    assert.ok(r.rows[0].ends.every((e) => e <= 5), JSON.stringify(r.rows[0].ends));
  });
});
