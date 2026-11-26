// Compact busy days (calendar.compactBusyDays): validation, defaults for new and older screens, and the pure helpers
// that size the week rows and count compact lines (web/display/compact.ts, loaded through Node's type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import { defaultConfig, SCREEN_SPLIT_KEYS } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';

let compact = null;
try {
  compact = await import('../../web/display/compact.ts');
} catch {
  compact = null;
}
const ts = { skip: compact ? false : 'TypeScript imports need Node ≥ 22.18' };
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sum = (a) => a.reduce((x, y) => x + y, 0);

test('on for new screens, off for screens saved before the option', () => {
  const fresh = validateConfig(defaultConfig());
  assert.equal(fresh.ok, true);
  assert.equal(fresh.value.screens[0].calendar.compactBusyDays, true);
  // a stored config without the key (what an older install has on disk) keeps the grid it had
  const c = defaultConfig();
  delete c.screens[0].calendar.compactBusyDays;
  const old = validateConfig(mergeDefaults(c));
  assert.equal(old.ok, true, JSON.stringify(old.errors));
  assert.equal(old.value.screens[0].calendar.compactBusyDays, false);
  // and so does a config validated without the defaults merged in
  const bare = defaultConfig();
  delete bare.screens[0].calendar.compactBusyDays;
  assert.equal(validateConfig(bare).value.screens[0].calendar.compactBusyDays, false);
  // once saved, the choice stays
  const on = defaultConfig();
  on.screens[0].calendar.compactBusyDays = true;
  assert.equal(validateConfig(mergeDefaults(on)).value.screens[0].calendar.compactBusyDays, true);
});

test('it is per screen, reaches the display, and wrong values are rejected with their path', () => {
  assert.ok(SCREEN_SPLIT_KEYS.calendar.includes('compactBusyDays'));
  assert.match(read('web/shared/screens.ts'), /'compactBusyDays'/);
  const c = defaultConfig();
  c.screens[0].calendar.compactBusyDays = false;
  const { ok, value } = validateConfig(c);
  assert.equal(ok, true);
  assert.equal(displayConfig(value, value.screens[0]).calendar.compactBusyDays, false);
  for (const bad of ['yes', 1, 'true', null]) {
    const b = defaultConfig();
    b.screens[0].calendar.compactBusyDays = bad;
    const r = validateConfig(b);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => e.path === 'screens[0].calendar.compactBusyDays'), JSON.stringify(r.errors));
    assert.equal(r.value.screens[0].calendar.compactBusyDays, false);
  }
});

test('the display reads ?compact= and ?weeks=, and the docs document ?compact=', () => {
  const main = read('web/display/main.ts');
  assert.match(main, /params\.get\('compact'\)/);
  assert.match(main, /params\.get\('weeks'\)/);
  for (const f of ['docs/CONFIGURATION.md']) assert.match(read(f), /\?compact=0/, f);
});

test('rows stay equal while every week fits in an equal share', ts, () => {
  const { shareRows } = compact;
  assert.deepEqual(shareRows([100, 150, 200], 900, 80), [300, 300, 300]);
  assert.deepEqual(shareRows([], 900, 80), []);
  // not even the minimum fits: equal rows
  assert.deepEqual(shareRows([500, 500], 100, 80), [50, 50]);
});

test('a busier week gets what it needs and the others share the rest equally', ts, () => {
  const { shareRows } = compact;
  const h = shareRows([100, 500, 120], 900, 80);
  assert.equal(h[1], 500);
  assert.equal(h[0], 200);
  assert.equal(h[2], 200);
  assert.equal(sum(h), 900);
  // two busy weeks, both satisfied
  const g = shareRows([420, 100, 380, 90], 1200, 80);
  assert.deepEqual([g[0], g[2]], [420, 380]);
  assert.equal(g[1], g[3]);
  assert.ok(Math.abs(sum(g) - 1200) < 1e-9);
});

test('when the weeks need more than the screen has, the light ones get theirs and the busy ones share the rest', ts, () => {
  const { shareRows } = compact;
  const h = shareRows([120, 900, 700, 100], 1000, 80);
  assert.ok(Math.abs(sum(h) - 1000) < 1e-9);
  assert.equal(h[0], 120);
  assert.equal(h[3], 100);
  assert.equal(h[1], 390);
  assert.equal(h[2], 390);
  // nobody gets less than the minimum, even with a huge week
  const k = shareRows([10, 10000, 10], 600, 100);
  assert.deepEqual([k[0], k[2]], [100, 100]);
  assert.equal(k[1], 400);
});

test('compact lines that fit, lane height and what a week needs', ts, () => {
  const { linesThatFit, laneHeight, weekNeed } = compact;
  assert.equal(linesThatFit(0, 20, 2), 0);
  assert.equal(linesThatFit(-5, 20, 2), 0);
  assert.equal(linesThatFit(20, 20, 2), 1);
  assert.equal(linesThatFit(42, 20, 2), 2);
  assert.equal(linesThatFit(41, 20, 2), 1);
  assert.equal(linesThatFit(100, 0, 2), 0);
  // lanes take their preferred height when there is room, never less than their minimum
  assert.equal(laneHeight(400, 50, 4, 29, 24, 4), 29);
  assert.equal(laneHeight(120, 50, 4, 29, 24, 4), 24);
  const m = { numH: 50, laneH: 29, gap: 4, lineH: 20, lineGap: 2, pad: 3 };
  const empty = Array.from({ length: 7 }, () => ({ top: 0, items: 0 }));
  // an empty week still asks for its dates and one lane
  assert.equal(weekNeed(empty, new Array(7).fill(0), 4, m), 50 + 4 + 33);
  // three events that fit in normal lanes ask for three lanes
  const three = empty.map((d, i) => (i === 2 ? { top: 0, items: 3 } : d));
  assert.equal(weekNeed(three, [0, 0, 3, 0, 0, 0, 0], 4, m), 50 + 4 + 3 * 33);
  // nine events under one bar: the bar's lane plus nine compact lines
  const nine = empty.map((d, i) => (i === 4 ? { top: 1, items: 9 } : d));
  assert.equal(weekNeed(nine, [0, 0, 0, 0, 10, 0, 0], 4, m), 50 + 4 + 33 + 9 * 22 - 2 + 3);
});
