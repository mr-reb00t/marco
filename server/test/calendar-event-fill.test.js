// Event fill (#32): how much the events' background covers what is behind them in the month / week grid
// (calendar.eventFill: soft, strong, solid), for the screen's calendar and for the month and week cards (the
// "calendar-grid" demo has one of each).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_KINDS, canvasDefaults } from '../core/canvasCore.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const props = (kind, x) => {
  const errors = [];
  const c = { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
  return { p: CANVAS_KINDS[kind].props(c, 'p', { ...canvasDefaults(kind), ...x }, {}, {}), errors };
};

test('event fill on the month and week cards: soft by default and for cards saved before it, strong or solid', () => {
  for (const kind of ['calendar.month', 'calendar.week']) {
    assert.equal(canvasDefaults(kind).eventFill, 'soft', kind);
    const old = canvasDefaults(kind);
    delete old.eventFill;
    const errors = [];
    const c = { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
    assert.equal(CANVAS_KINDS[kind].props(c, 'p', old, {}, {}).eventFill, 'soft', `${kind}: saved before it`);
    assert.deepEqual(errors, [], kind);
    for (const v of ['strong', 'solid']) assert.equal(props(kind, { eventFill: v }).p.eventFill, v, kind);
    const r = props(kind, { eventFill: 'opaque' });
    assert.equal(r.p.eventFill, 'soft', kind);
    assert.ok(r.errors.some((e) => e.includes('eventFill')), kind);
  }
  // the list cards have no grid: no such option
  assert.equal(props('calendar.agenda', {}).p.eventFill, undefined);
});

test('event fill on the screen calendar: soft for every screen saved before, checked like the rest', () => {
  const d = defaultConfig();
  const withCal = (cal) => {
    const c = structuredClone(d);
    Object.assign(c.screens[0].calendar, cal);
    return validateConfig(c);
  };
  assert.equal(d.screens[0].calendar.eventFill, 'soft');
  const ok = withCal({ eventFill: 'solid' });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.value.screens[0].calendar.eventFill, 'solid');
  const old = structuredClone(d);
  delete old.screens[0].calendar.eventFill;
  assert.equal(validateConfig(old).value.screens[0].calendar.eventFill, 'soft');
  const bad = withCal({ eventFill: '<b>' });
  assert.ok(bad.errors.some((e) => e.path.endsWith('calendar.eventFill')), JSON.stringify(bad.errors));
  assert.equal(bad.value.screens[0].calendar.eventFill, 'soft');
});

describe('event fill in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  // the background alpha of each timed event, and whether its time is drawn in the event's own text colour
  const timed = (sel) => `[...document.querySelectorAll('${sel}')].map((cal) => [...cal.querySelectorAll('.ev.timed')].map((e) => {
    const a = getComputedStyle(e).backgroundColor.match(/[\\d.]+/g).map(Number);
    const tm = e.querySelector('.tm');
    return { a: a.length > 3 ? a[3] : 1, ink: !tm || getComputedStyle(tm).color === getComputedStyle(e).color };
  }))`;

  test('the screen calendar: soft, more solid or filled, in both looks', { timeout: 120_000 }, async () => {
    for (const style of ['modern', 'classic']) {
      for (const v of ['soft', 'strong', 'solid']) {
        const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=es&now=2026-11-01T15:00&view=month&style=${style}&eventFill=${v}`, { width: 1920, height: 1080 });
        try {
          await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))');
          const evs = (await p.eval(timed('#app .cal'))).flat();
          assert.ok(evs.length > 0, `${style}/${v}: the demo month has timed events`);
          const at = `${style}/${v}: ${JSON.stringify(evs.slice(0, 4))}`;
          if (v === 'soft') assert.ok(evs.every((e) => e.a <= 0.2), at);
          if (v === 'strong') assert.ok(evs.every((e) => e.a >= 0.5 && e.a < 1 && e.ink), at);
          if (v === 'solid') assert.ok(evs.every((e) => e.a === 1 && e.ink), at);
        } finally {
          await p.close();
        }
      }
    }
  });

  test('each month and week card its own (the calendar-grid demo)', { timeout: 60_000 }, async () => {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=calendar-grid&lang=es&now=2026-11-01T15:00`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const [month1, , month3] = await p.eval(timed('.cv-item[data-kind="calendar.month"] .cal'));
      const [week] = await p.eval(timed('.cv-item[data-kind="calendar.week"] .cal'));
      assert.ok(month1.length && month3.length && week.length);
      assert.ok(month1.every((e) => e.a <= 0.2), JSON.stringify(month1));
      assert.ok(month3.every((e) => e.a >= 0.5 && e.a < 1 && e.ink), JSON.stringify(month3));
      assert.ok(week.every((e) => e.a === 1 && e.ink), JSON.stringify(week));
    } finally {
      await p.close();
    }
  });
});
