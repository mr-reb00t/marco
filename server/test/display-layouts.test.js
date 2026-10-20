// The newer layouts (today, people, photoFrame, twoWeeks, board, bedside, planner): validation, defaults and wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig, LAYOUT_PRESETS } from '../core/validate.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';
import { parseSetupBody } from '../setup.js';

const NEW = ['today', 'people', 'photoFrame', 'twoWeeks', 'board', 'bedside', 'planner', 'kidsRoutines', 'kidsFamily', 'kidsMeals'];
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('every layout is accepted and reaches the display', () => {
  for (const preset of LAYOUT_PRESETS) {
    const c = defaultConfig();
    c.screens[0].layout.preset = preset;
    const { ok, errors, value } = validateConfig(c);
    assert.equal(ok, true, `${preset}: ${JSON.stringify(errors)}`);
    assert.equal(displayConfig(value, value.screens[0]).layout.preset, preset);
  }
  for (const p of NEW) assert.ok(LAYOUT_PRESETS.includes(p), p);
});

test('unknown layouts are rejected with a path and fall back to the big calendar', () => {
  for (const bad of ['Today', 'kitchen', '', 3, null]) {
    const c = defaultConfig();
    c.screens[0].layout.preset = bad;
    const { ok, errors, value } = validateConfig(c);
    assert.equal(ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(errors.some((e) => e.path === 'screens[0].layout.preset'), JSON.stringify(errors));
    assert.equal(value.screens[0].layout.preset, 'bigCalendar');
  }
});

test('older configs get the layout options back-filled (automatic people, bottom-right corner)', () => {
  assert.deepEqual({ people: defaultScreenProfile().layout.people, corner: defaultScreenProfile().layout.corner }, { people: null, corner: 'br' });
  const c = defaultConfig();
  delete c.screens[0].layout.people;
  delete c.screens[0].layout.corner;
  const { ok, value } = validateConfig(c);
  assert.equal(ok, true);
  assert.equal(value.screens[0].layout.people, null);
  assert.equal(value.screens[0].layout.corner, 'br');
});

test('people columns: at most five ids, no duplicates, only valid ids', () => {
  const c = defaultConfig();
  c.screens[0].layout.people = ['a', 'b', 'b', 'local'];
  let r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.screens[0].layout.people, ['a', 'b', 'local']);

  c.screens[0].layout.people = ['a', 'b', 'c', 'd', 'e', 'f'];
  r = validateConfig(c);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'screens[0].layout.people'));
  assert.equal(r.value.screens[0].layout.people.length, 5);

  c.screens[0].layout.people = 'a';
  r = validateConfig(c);
  assert.equal(r.ok, false);
  assert.deepEqual(r.value.screens[0].layout.people, []);
  // the display gets the list as stored
  c.screens[0].layout.people = ['local'];
  r = validateConfig(c);
  assert.deepEqual(displayConfig(r.value, r.value.screens[0]).layout.people, ['local']);
  // nothing ticked stays an empty list (not automatic): the display then asks to choose calendars, as the admin says
  c.screens[0].layout.people = [];
  r = validateConfig(c);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.screens[0].layout.people, []);
  const views = read('web/display/widgets/views.ts');
  assert.match(views, /if \(Array\.isArray\(want\)\) return want\.map/);
});

test('Two weeks, Board and Bedside polish: spare chip lines, fixed board columns, night mode not dimmed twice', () => {
  const cal = read('web/display/widgets/calendar.ts');
  assert.match(cal, /const maxSpan = wrapLineCap\(day\.length, this\.roomy,/);
  assert.match(read('web/display/widgets/views.ts'), /box\.style\.setProperty\('--bd-n', String\(n\)\)/);
  const css = read('web/display/styles-views.css');
  assert.match(css, /\.night #app\.preset-bedside\.bedside-late \{/);
  assert.match(css, /#app\.no-photo \.view-photoFrame \{/);
  // Modern: the board and photo frame cards follow the glass settings, also with the light theme
  const modern = read('web/display/styles-modern.css');
  assert.doesNotMatch(modern, /theme-light \.(bd|pf)-card \{/);
});

test('photo frame corner: tl, tr, bl or br', () => {
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const c = defaultConfig();
    c.screens[0].layout.corner = corner;
    const { ok, value } = validateConfig(c);
    assert.equal(ok, true);
    assert.equal(value.screens[0].layout.corner, corner);
  }
  const c = defaultConfig();
  c.screens[0].layout.corner = 'middle';
  const { ok, errors, value } = validateConfig(c);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.path === 'screens[0].layout.corner'));
  assert.equal(value.screens[0].layout.corner, 'br');
});

test('the setup wizard accepts the new layouts too', () => {
  for (const p of NEW) {
    const { errors, value } = parseSetupBody({ layout: p });
    assert.deepEqual(errors.filter((e) => e.path.startsWith('layout')), []);
    assert.equal(value.layout, p);
  }
});

test('display, admin and types know every layout', () => {
  const main = read('web/display/main.ts');
  const types = read('web/shared/types.ts');
  const admin = read('web/admin/sections/Layout.tsx');
  const screens = read('web/admin/sections/Screens.tsx');
  for (const p of LAYOUT_PRESETS) {
    assert.ok(main.includes(`'${p}'`), `main.ts misses ${p}`);
    assert.ok(types.includes(`'${p}'`), `types.ts misses ${p}`);
    assert.ok(admin.includes(`id: '${p}'`), `Layout.tsx PRESETS misses ${p}`);
    assert.ok(screens.includes(`${p}: '`), `Screens.tsx label misses ${p}`);
  }
  for (const p of NEW) assert.ok(admin.includes(`id === '${p}'`), `no schematic for ${p}`);
});

test('the new layouts have Spanish, English and Portuguese texts (Dutch and Danish: i18n-complete.test.js)', () => {
  const admin = read('web/admin/sections/Layout.tsx');
  const dict = ['', '2', '3', '4', '5', '6', '7', '-planner', '-family'].map((n) => read(`web/admin/i18n-dict${n}.ts`)).join('\n');
  for (const m of admin.matchAll(/\{ id: '(\w+)', name: '([^']+)', desc: '([^']+)'/g)) {
    if (!NEW.includes(m[1])) continue;
    for (const s of [m[2], m[3]]) {
      // English rows with an apostrophe use double quotes
      const row = new RegExp(`\\['${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}', (?:'[^']+'|"[^"]+"), (?:'[^']+'|"[^"]+")\\]`);
      assert.ok(row.test(dict), `no en/pt for "${s}"`);
    }
  }
  const i18n = read('web/shared/i18n.ts');
  for (const k of ['upNext', 'nothingMoreToday', 'everyone', 'birthdays', 'allDone', 'noPeople', 'nothingPlanned', 'daysWord']) {
    assert.equal(i18n.split(`  ${k}: '`).length - 1, 6, `display string ${k} not in es, en, pt, nl, da and pl`);
  }
});

test('the layout stylesheet only touches the new layouts, so the others look exactly as before', () => {
  const css = read('web/display/styles-views.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;
    let depth = 0, cur = '';
    for (const ch of prelude) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { selectors.push(cur.trim()); cur = ''; } else cur += ch;
    }
    selectors.push(cur.trim());
  }
  assert.ok(selectors.length > 80);
  const scoped = new RegExp(`preset-(${NEW.join('|')})|#view|\\.has-view|\\.view-|\\.(td|pp|bd|pf|bs|v)(-|\\b)|\\.corner-|\\.bedside-late`);
  assert.deepEqual(selectors.filter((s) => !scoped.test(s)), []);
});
