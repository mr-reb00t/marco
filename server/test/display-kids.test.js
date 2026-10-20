// Kids layouts (Familia) on the display: wiring, texts and the parts of widgets/kids.ts that need no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LAYOUT_PRESETS, validateConfig } from '../core/validate.js';
import { KIDS_PRESETS } from '../core/familyCore.js';
import { SCREEN_SPLIT_KEYS, defaultConfig } from '../core/defaults.js';
import { loadWebModules } from './webModules.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const exists = (p) => fs.existsSync(new URL(`../../${p}`, import.meta.url));

/** Run `fn` with the browser globals the display modules read when they load (ctx.ts, mock.ts). */
async function withLocation(url, fn) {
  const saved = globalThis.location;
  const u = new URL(url);
  Object.defineProperty(globalThis, 'location', { value: { href: u.href, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash }, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, 'location', { value: saved, configurable: true, writable: true });
  }
}

test('the three kids layouts are known everywhere and saved by the server', async () => {
  assert.deepEqual([...KIDS_PRESETS], ['kidsRoutines', 'kidsFamily', 'kidsMeals']);
  const main = read('web/display/main.ts');
  const types = read('web/shared/types.ts');
  const admin = read('web/admin/sections/Layout.tsx');
  for (const p of KIDS_PRESETS) {
    assert.ok(LAYOUT_PRESETS.includes(p), `LAYOUT_PRESETS misses ${p}`);
    assert.ok(main.includes(`'${p}'`), `main.ts misses ${p}`);
    assert.ok(types.includes(`'${p}'`), `types.ts misses ${p}`);
    assert.ok(admin.includes(`id: '${p}'`), `Layout.tsx misses ${p}`);
    const c = defaultConfig();
    c.screens[0].layout.preset = p;
    const { ok, errors, value } = validateConfig(c);
    assert.equal(ok, true, JSON.stringify(errors));
    assert.equal(value.screens[0].layout.preset, p);
  }
  // the display keeps its own copy of the ids (no server import in the browser bundle)
  const [kids] = await withLocation('http://tv.local/', () => loadWebModules('/web/display/widgets/kids.ts'));
  assert.deepEqual(kids.KIDS_PRESETS, [...KIDS_PRESETS]);
});

test('Classic falls back to the big calendar; the display listens to family and asks for it', () => {
  const main = read('web/display/main.ts');
  assert.match(main, /if \(isKidsPreset\(p\) && cfg\.screen\.style !== 'modern'\) return 'bigCalendar';/);
  // same pastel page everywhere: no photo, no animated background, unless the photo goes behind the whole screen
  assert.match(main, /effectivePreset\(cfg\) === 'bedside' \|\| \(isKidsPreset\(effectivePreset\(cfg\)\) && !photoOnWholeScreen\(cfg\.background, effectivePreset\(cfg\)\)\)/);
  assert.match(main, /family: \(\) => void fetchFamily\(\)/);
  assert.match(read('web/display/stream.ts'), /STREAM_EVENTS = \[[^\]]*'family'/);
  assert.match(read('web/display/live.ts'), /case 'family': h\.family\?\./);
  assert.match(read('web/display/api.ts'), /'\/api\/display\/family\/toggle'/);
  assert.match(read('web/index.html'), /<div id="kids"><\/div>/);
  // a 403 touch_off from a tap puts the routine back; it is not "this display lost its access"
  assert.match(main, /e\.code !== 'touch_off' && deniedBy\(e\)/);
});

test('kids styles only touch the kids layouts (and hide #kids elsewhere)', () => {
  const css = read('web/display/styles-kids.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (!prelude || prelude.startsWith('@') || /^(from|to|\d+%)$/.test(prelude)) continue;
    for (const s of prelude.split(',')) selectors.push(s.trim());
  }
  assert.ok(selectors.length > 100);
  const bad = selectors.filter((s) => !/\.style-modern(\.[\w-]+)* #app\.is-kids/.test(s) && s !== '#app:not(.is-kids) #kids');
  assert.deepEqual(bad, []);
  // no animation on the Pi lite mode
  assert.match(css, /:root:not\(\.lite\)\.style-modern #app\.is-kids \.k-pop \.k-check \{ animation/);
  assert.match(css, /\.lite\.style-modern #app\.is-kids \.k-bar i \{ transition: none; \}/);
});

test('display texts of the kids layouts exist in Spanish, English, Portuguese, Dutch, Danish and Polish', () => {
  const i18n = read('web/shared/i18n.ts');
  const keys = ['kidsMorning', 'kidsAfternoon', 'kidsEvening', 'kidsAnytime', 'kidsAllDone', 'kidsScan', 'kidsNone', 'kidsNoMembers', 'kidsRoutines',
    'kidsMealsToday', 'kidsMealsWeek', 'kidsMealsOff', 'meal_breakfast', 'meal_lunch', 'meal_snack', 'meal_dinner', 'greetMorning', 'greetAfternoon',
    'greetEvening', 'kidsEventsLeft', 'kidsEventsLeft1', 'kidsNoEventsLeft', 'kidsRoutinesDone', 'kidsRewards', 'kidsStarsLeft', 'kidsTasks',
    'kidsNoMeal', 'kidsRewardReady', 'kidsNoMealsDay', 'kidsPrivate', 'kidsStarsLeft1', 'kidsLeft'];
  for (const k of keys) assert.equal(i18n.split(new RegExp(`\\n  ${k}: ['"]`)).length - 1, 6, `display string ${k} not in es, en, pt, nl, da and pl`);
  // every key the widget asks for is one of them (or an older one)
  const kids = read('web/display/widgets/kids.ts');
  for (const m of kids.matchAll(/\bt\('(\w+)'/g)) assert.ok(i18n.includes(`  ${m[1]}: `), `kids.ts uses unknown key ${m[1]}`);
});

test('every admin and phone text of Familia has an English and a Portuguese row', async () => {
  const [{ EN, PT }] = await loadWebModules('/web/admin/i18n-dict.ts');
  const files = ['web/admin/sections/Family.tsx', 'web/admin/sections/Meals.tsx'];
  if (exists('web/family/main.tsx')) files.push('web/family/main.tsx');
  const missing = [];
  for (const f of files) {
    for (const m of read(f).matchAll(/\bt\('((?:[^'\\]|\\.)+)'/g)) {
      const key = m[1].replace(/\\'/g, "'");
      if (!EN[key] || !PT[key]) missing.push(`${f}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the per-screen family keys are split the same way by the server and the admin', async () => {
  const [screens] = await loadWebModules('/web/shared/screens.ts');
  assert.deepEqual(screens.SCREEN_SPLIT_KEYS.family, SCREEN_SPLIT_KEYS.family);
  assert.deepEqual(SCREEN_SPLIT_KEYS.family, ['memberIds', 'touch', 'showQr']);
});

test('a tap shows at once: the routine, the done count and the stars move together', async () => {
  const [kids, f] = await withLocation('http://tv.local/?demo=1', async () => {
    const [k, mock] = await loadWebModules('/web/display/widgets/kids.ts', '/web/display/mock.ts');
    return [k, mock.mockFamily(new Date('2026-10-12T07:10:00Z'))];
  });
  const lucia = f.members.find((m) => m.id === 'm_lucia');
  const todo = f.chores.find((c) => c.memberId === 'm_lucia' && !c.done && c.points > 0);
  const on = kids.withToggle(f, todo.id, true);
  const l2 = on.members.find((m) => m.id === 'm_lucia');
  assert.equal(on.chores.find((c) => c.id === todo.id).done, true);
  assert.equal(l2.done, lucia.done + 1);
  assert.equal(l2.points, lucia.points + todo.points);
  // the other people and the original state are untouched
  assert.deepEqual(on.members.filter((m) => m.id !== 'm_lucia'), f.members.filter((m) => m.id !== 'm_lucia'));
  assert.equal(f.chores.find((c) => c.id === todo.id).done, false);
  // the same state again changes nothing; untick goes back
  assert.equal(kids.withToggle(on, todo.id, true), on);
  assert.deepEqual(kids.withToggle(on, todo.id, false).members, f.members);
  // an adult's routine never gives stars; a routine that is not there leaves everything as it is
  const adult = f.chores.find((c) => c.memberId === 'm_papa');
  assert.equal(kids.withToggle(f, adult.id, true).members.find((m) => m.id === 'm_papa').points, null);
  assert.equal(kids.withToggle(f, 'h_nope', true), f);
});

test('demo family: three kids with stars, routines by time of day, a week of meals and the next reward', async () => {
  const f = await withLocation('http://tv.local/?demo=1', async () => {
    const [mock] = await loadWebModules('/web/display/mock.ts');
    return mock.mockFamily(new Date('2026-10-12T07:10:00Z'));
  });
  assert.equal(f.today, '2026-10-12');
  assert.equal(f.slotNow, 'morning');
  assert.deepEqual(f.members.filter((m) => m.kid).map((m) => m.name), ['Lucía', 'Mateo', 'Sofía']);
  for (const m of f.members) {
    const mine = f.chores.filter((c) => c.memberId === m.id);
    assert.equal(m.total, mine.length);
    assert.equal(m.done, mine.filter((c) => c.done).length);
    assert.equal(m.points === null, !m.kid);
  }
  assert.equal(f.meals.days.length, 7);
  assert.equal(f.meals.days[0].date, '2026-10-12');
  assert.ok(f.nextReward.m_lucia.missing > 0);
  // privacy: initials, no stars, no taps, no QR
  const p = await withLocation('http://tv.local/?demo=1&private=1', async () => {
    const [mock] = await loadWebModules('/web/display/mock.ts');
    return mock.mockFamily(new Date('2026-10-12T07:10:00Z'), mock.mockConfig());
  });
  assert.equal(p.members[0].name, 'L');
  assert.equal(p.members[0].points, null);
  assert.equal(p.touch, false);
  assert.equal(p.qrUrl, null);
});

test('the family page on the phone: its own build entry, only the family API, texts from the Familia rows', () => {
  assert.match(read('vite.config.ts'), /family: resolve\(root, 'web\/family\/index\.html'\)/);
  const main = read('web/family/main.tsx');
  // the page talks to /api/family only (never the admin or display APIs) and sends the key as a header
  for (const m of main.matchAll(/'(\/api\/[^']*)'/g)) assert.match(m[1], /^\/api\/family\//, `phone page calls ${m[1]}`);
  assert.match(main, /'X-Family-Key'/);
  assert.match(main, /localStorage\.setItem\(LS_KEY/);
  // no APIs that need https: the page works over plain http on the home network
  assert.doesNotMatch(main, /navigator\.clipboard|crypto\.randomUUID|serviceWorker/);
  const i18n = read('web/family/i18n.ts');
  assert.match(i18n, /from '\.\.\/admin\/i18n-dict-family'/);
  assert.doesNotMatch(i18n, /from '\.\.\/admin\/i18n-dict'/);
  // every time-of-day and meal label of the page is one of the Familia rows
  const rows = read('web/admin/i18n-dict-family.ts');
  for (const k of ['Por la mañana', 'Por la tarde', 'Por la noche', 'Durante el día', 'Desayuno', 'Comida', 'Merienda', 'Cena']) {
    assert.ok(main.includes(`'${k}'`) && rows.includes(`['${k}', `), `${k}`);
  }
});
