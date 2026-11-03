// Past events (#32): how faded the events that have ended are (calendar.pastEvents: dim, soft, full), for the screen's
// calendar and for the month, week, agenda and Hoy cards (the "calendar-grid" demo has one of each on its month cards).
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

test('past events on the calendar cards: dimmed by default and for cards saved before it, soft or full', () => {
  for (const kind of ['calendar.month', 'calendar.week', 'calendar.agenda', 'calendar.today']) {
    assert.equal(canvasDefaults(kind).pastEvents, 'dim', kind);
    assert.equal(props(kind, {}).p.pastEvents, 'dim', kind);
    const old = canvasDefaults(kind);
    delete old.pastEvents;
    const errors = [];
    const c = { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
    assert.equal(CANVAS_KINDS[kind].props(c, 'p', old, {}, {}).pastEvents, 'dim', `${kind}: saved before it`);
    assert.deepEqual(errors, [], kind);
    for (const v of ['soft', 'full']) assert.equal(props(kind, { pastEvents: v }).p.pastEvents, v, kind);
    const r = props(kind, { pastEvents: 'none' });
    assert.equal(r.p.pastEvents, 'dim', kind);
    assert.ok(r.errors.some((e) => e.includes('pastEvents')), kind);
  }
  // the next events are never past: the card has no such option
  assert.equal(props('calendar.next', {}).p.pastEvents, undefined);
});

test('past events on the screen calendar: dimmed for every screen saved before, checked like the rest', () => {
  const d = defaultConfig();
  const withCal = (cal) => {
    const c = structuredClone(d);
    Object.assign(c.screens[0].calendar, cal);
    return validateConfig(c);
  };
  assert.equal(d.screens[0].calendar.pastEvents, 'dim');
  const ok = withCal({ pastEvents: 'full' });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.value.screens[0].calendar.pastEvents, 'full');
  const old = structuredClone(d);
  delete old.screens[0].calendar.pastEvents;
  assert.equal(validateConfig(old).value.screens[0].calendar.pastEvents, 'dim');
  const bad = withCal({ pastEvents: 0.5 });
  assert.ok(bad.errors.some((e) => e.path.endsWith('calendar.pastEvents')), JSON.stringify(bad.errors));
  assert.equal(bad.value.screens[0].calendar.pastEvents, 'dim');
});

describe('past events in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  // the opacity of every ended event shown in each calendar on the page (those paged out of a busy day are at 0)
  const opacities = `[...document.querySelectorAll('.cal, .agenda')].map((cal) =>
    [...cal.querySelectorAll('.ev.past, .ag-ev.past, .more.past')].map((e) => Number(getComputedStyle(e).opacity)).filter((o) => o > 0))`;

  test('the screen calendar: dimmed, a little or not at all', { timeout: 90_000 }, async () => {
    const seen = {};
    for (const v of ['dim', 'soft', 'full']) {
      const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=es&now=2026-11-01T15:00&pastEvents=${v}`, { width: 1920, height: 1080 });
      try {
        await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))');
        const all = (await p.eval(opacities)).flat();
        assert.ok(all.length > 0, `${v}: the demo month has ended events`);
        seen[v] = all;
      } finally {
        await p.close();
      }
    }
    assert.ok(Math.max(...seen.dim) <= 0.45, JSON.stringify(seen.dim));
    assert.ok(seen.soft.every((o) => o >= 0.7 && o < 1), JSON.stringify(seen.soft));
    assert.ok(seen.full.every((o) => o === 1), JSON.stringify(seen.full));
  });

  test('each month card its own (the calendar-grid demo)', { timeout: 60_000 }, async () => {
    // a day of its own: the demo's events move with today, and on some days every ended one is paged out of its day
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=calendar-grid&lang=es&now=2026-11-01T15:00`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const r = await p.eval(`[...document.querySelectorAll('.cv-item[data-kind="calendar.month"] .cal')].map((cal) =>
        [...cal.querySelectorAll('.ev.past')].map((e) => Number(getComputedStyle(e).opacity)).filter((o) => o > 0))`);
      assert.equal(r.length, 3, JSON.stringify(r));
      const [dim, soft, full] = r;
      assert.ok(dim.length && soft.length && full.length, JSON.stringify(r));
      assert.ok(Math.max(...dim) <= 0.45, JSON.stringify(dim));
      assert.ok(soft.every((o) => o >= 0.7 && o < 1), JSON.stringify(soft));
      assert.ok(full.every((o) => o === 1), JSON.stringify(full));
    } finally {
      await p.close();
    }
  });
});
