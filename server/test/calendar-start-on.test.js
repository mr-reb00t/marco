// calendar.startOn: the month / week grid starts on the first day of this week (weekStart, the default) or on today
// (no past days, rows of 7 days from today). Validation, defaults for new and older screens, the display's own
// normalisation, and the date math of the grid (web/shared/i18n.ts, loaded through Vite like the admin modules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig, CALENDAR_START_ON } from '../core/validate.js';
import { defaultConfig, SCREEN_SPLIT_KEYS } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';
import { loadWebModules } from './webModules.js';

const [i18n, displayDefaults] = await loadWebModules('/web/shared/i18n.ts', '/web/display/defaults.ts');
const { gridStartOf, startOfWeek, addDays, diffDays, weekdayOfKey, weekdayNames, dateKeyInTz } = i18n;
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('startOn is week or today, per screen; week by default and for screens saved before it', () => {
  assert.deepEqual(CALENDAR_START_ON, ['week', 'today']);
  assert.ok(SCREEN_SPLIT_KEYS.calendar.includes('startOn'));
  assert.match(read('web/shared/screens.ts'), /'weekStart', 'startOn'/);
  const fresh = defaultConfig();
  assert.equal(fresh.screens[0].calendar.startOn, 'week');
  // an older config: no startOn anywhere
  const old = defaultConfig();
  delete old.screens[0].calendar.startOn;
  const r = validateConfig(old);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.screens[0].calendar.startOn, 'week');
  assert.equal(displayConfig(r.value, r.value.screens[0]).calendar.startOn, 'week');
  for (const ok of CALENDAR_START_ON) {
    const c = defaultConfig();
    c.screens[0].calendar.startOn = ok;
    c.screens[0].calendar.weekStart = 0;
    const v = validateConfig(c);
    assert.equal(v.ok, true, `${ok}: ${JSON.stringify(v.errors)}`);
    assert.equal(v.value.screens[0].calendar.startOn, ok);
    // weekStart is kept as it was (the week of the menus still starts on it)
    assert.equal(v.value.screens[0].calendar.weekStart, 0);
    assert.equal(displayConfig(v.value, v.value.screens[0]).calendar.startOn, ok);
  }
  for (const bad of ['Today', 'monday', 1, 0, null, true, '']) {
    const c = defaultConfig();
    c.screens[0].calendar.startOn = bad;
    const v = validateConfig(c);
    assert.equal(v.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(v.errors.some((e) => e.path === 'screens[0].calendar.startOn'), JSON.stringify(v.errors));
    assert.equal(v.value.screens[0].calendar.startOn, 'week');
  }
});

test('the display normalises startOn: today stays, anything else is week', () => {
  const { normalizeConfig, DEFAULT_CONFIG } = displayDefaults;
  assert.equal(DEFAULT_CONFIG.calendar.startOn, 'week');
  assert.equal(normalizeConfig({}).calendar.startOn, 'week');
  assert.equal(normalizeConfig({ calendar: { weekStart: 0 } }).calendar.startOn, 'week');
  assert.equal(normalizeConfig({ calendar: { startOn: 'today' } }).calendar.startOn, 'today');
  for (const bad of ['TODAY', 3, null, 'tomorrow']) assert.equal(normalizeConfig({ calendar: { startOn: bad } }).calendar.startOn, 'week');
});

/** The grid as the display draws it: its days, the weekday of each column and the column of today. */
function grid(today, weekStart, startOn, weeks = 5) {
  const start = gridStartOf(today, weekStart, startOn);
  const firstWd = weekdayOfKey(start);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  return { start, days, firstWd, todayCol: diffDays(start, today) % 7, cols: Array.from({ length: 7 }, (_, i) => (firstWd + i) % 7) };
}

test('gridStartOf: the start of the week (Monday or Sunday) or today', () => {
  const WED = '2026-10-14';
  assert.equal(weekdayOfKey(WED), 3);
  assert.equal(gridStartOf(WED, 1, 'week'), '2026-10-12');
  assert.equal(gridStartOf(WED, 0, 'week'), '2026-10-11');
  assert.equal(gridStartOf(WED, 1), '2026-10-12', 'week by default');
  assert.equal(gridStartOf(WED, 1, 'today'), WED);
  assert.equal(gridStartOf(WED, 0, 'today'), WED);
  // the week mode is what the grid always did
  for (let i = 0; i < 14; i++) {
    const d = addDays(WED, i);
    for (const ws of [0, 1, 6]) assert.equal(gridStartOf(d, ws, 'week'), startOfWeek(d, ws));
  }
});

test('starting today: today is the first cell, the columns follow its weekday, no past days', () => {
  const g = grid('2026-10-14', 1, 'today');
  assert.equal(g.days[0], '2026-10-14');
  assert.equal(g.todayCol, 0);
  assert.deepEqual(g.cols, [3, 4, 5, 6, 0, 1, 2]);
  assert.ok(g.days.every((d) => d >= '2026-10-14'));
  assert.equal(g.days.at(-1), '2026-11-17');
  // the header names start on Wednesday
  assert.deepEqual(weekdayNames('en', g.firstWd, 'short').slice(0, 2), ['Wed', 'Thu']);
  assert.deepEqual(weekdayNames('es', g.firstWd, 'short')[0], weekdayNames('es', 1, 'short')[2]);
  // every column keeps one weekday all the way down
  for (let i = 0; i < g.days.length; i++) assert.equal(weekdayOfKey(g.days[i]), g.cols[i % 7]);
  // the week mode on the same day: Monday first, two past days, today in the third column
  const w = grid('2026-10-14', 1, 'week');
  assert.equal(w.todayCol, 2);
  assert.deepEqual(w.cols, [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(w.days.filter((d) => d < '2026-10-14').length, 2);
  const s = grid('2026-10-14', 0, 'week');
  assert.equal(s.todayCol, 3);
  assert.deepEqual(s.cols, [0, 1, 2, 3, 4, 5, 6]);
});

test('starting today across month and year ends: the first of the month falls where it should', () => {
  // the 31st: the 1st of November is the second cell
  let g = grid('2026-10-31', 1, 'today');
  assert.equal(g.days[1], '2026-11-01');
  assert.equal(g.days.filter((d) => d.endsWith('-01')).length, 2, 'Nov 1 and Dec 1 in 5 weeks');
  // February in a leap year and in a common one
  g = grid('2028-02-27', 1, 'today', 1);
  assert.deepEqual(g.days.slice(0, 4), ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
  g = grid('2027-02-27', 1, 'today', 1);
  assert.deepEqual(g.days.slice(0, 3), ['2027-02-27', '2027-02-28', '2027-03-01']);
  // year end
  g = grid('2026-12-29', 0, 'today', 2);
  assert.equal(g.days[3], '2027-01-01');
  assert.equal(g.days.at(-1), '2027-01-11');
});

test('starting today on DST change days: one cell per day, and the grid moves on by one day at midnight', () => {
  for (const [day, tz] of [
    ['2026-10-25', 'Europe/Madrid'], // clocks go back
    ['2026-03-29', 'Europe/Lisbon'], // clocks go forward
    ['2026-03-08', 'America/New_York'],
    ['2026-11-01', 'America/New_York'],
    ['2026-04-05', 'Australia/Sydney'],
  ]) {
    const g = grid(day, 1, 'today', 6);
    assert.equal(new Set(g.days).size, 42, `${day}: every day once`);
    for (let i = 1; i < g.days.length; i++) assert.equal(diffDays(g.days[i - 1], g.days[i]), 1, `${day}: no gap at ${g.days[i]}`);
    // the display's day comes from the clock in the screen's time zone: just before and just after local midnight
    // of the day after, the grid starts on that day and then on the next one
    const next = addDays(day, 1);
    const midnight = localMidnight(next, tz);
    const before = dateKeyInTz(new Date(midnight - 1000), tz);
    const after = dateKeyInTz(new Date(midnight + 1000), tz);
    assert.equal(before, day, `${tz} ${day}: still the day before midnight`);
    assert.equal(after, next, `${tz} ${day}: the next day after midnight`);
    assert.equal(gridStartOf(before, 1, 'today'), day);
    assert.equal(gridStartOf(after, 1, 'today'), next);
    // the week mode only moves on Mondays
    assert.equal(gridStartOf(after, 1, 'week'), weekdayOfKey(next) === 1 ? next : gridStartOf(before, 1, 'week'));
  }
});

/** Epoch ms of 00:00 local time on `key` in `tz` (found by stepping through the hours around it). */
function localMidnight(key, tz) {
  const base = Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) - 16 * 3600_000;
  for (let m = 0; m < 40 * 60; m += 15) {
    const t = base + m * 60_000;
    if (dateKeyInTz(new Date(t), tz) === key) return t;
  }
  throw new Error(`no midnight for ${key} in ${tz}`);
}

test('the grid, the events range and the admin all read startOn', () => {
  const cal = read('web/display/widgets/calendar.ts');
  assert.match(cal, /gridStartOf\(today, c\.weekStart, c\.startOn\)/);
  assert.doesNotMatch(cal, /weekdayNames\(lang, c\.weekStart/);
  const main = read('web/display/main.ts');
  // the events window is worked out in server/core/bootstrap.js (the page bootstrap asks for the same one)
  assert.match(main, /eventsWindow\(current\(\)\.dayKey, \{\s*weekStart: cfg\.calendar\.weekStart \?\? 1, startOn: cfg\.calendar\.startOn/);
  assert.match(read('server/core/bootstrap.js'), /startOn === 'today' \? today : startOfWeek\(today, weekStart\)/);
  const admin = read('web/admin/sections/Calendars.tsx');
  assert.match(admin, /d\.calendar\.startOn = 'today'/);
  assert.match(admin, /t\('El calendario empieza en'\)/);
});
