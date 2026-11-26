// "Avisos bajo la fecha" (screen.highlights): the pills under the date of the usual designs (next event, happening
// now, birthdays, check-in/out) can be switched off per screen. On by default, also for screens saved before the
// option; off, the display shows no pills and keeps no room for them. The Personalizado "highlights" card ignores it.
// The browser part is skipped without Chrome (set CHROME_PATH).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('on by default, for new screens and for screens saved before the option', () => {
  assert.equal(defaultScreenProfile().screen.highlights, true);
  const fresh = validateConfig(defaultConfig());
  assert.equal(fresh.ok, true);
  assert.equal(fresh.value.screens[0].screen.highlights, true);
  const old = defaultConfig();
  delete old.screens[0].screen.highlights;
  assert.equal(validateConfig(old).value.screens[0].screen.highlights, true);
  assert.equal(validateConfig(mergeDefaults(old)).value.screens[0].screen.highlights, true);
});

test('per screen, reaches the display, and wrong values are rejected with their path', () => {
  const c = defaultConfig();
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  c.screens[1].screen.highlights = false;
  const { ok, errors, value } = validateConfig(c);
  assert.equal(ok, true, JSON.stringify(errors));
  assert.equal(displayConfig(value, value.screens[0]).screen.highlights, true);
  assert.equal(displayConfig(value, value.screens[1]).screen.highlights, false);
  for (const bad of ['no', 0, null]) {
    const b = defaultConfig();
    b.screens[0].screen.highlights = bad;
    const r = validateConfig(b);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => e.path === 'screens[0].screen.highlights'), JSON.stringify(r.errors));
    assert.equal(r.value.screens[0].screen.highlights, true);
  }
});

test('the display reads ?highlights=, only the pills under the date follow it, the docs document it', () => {
  const main = read('web/display/main.ts');
  assert.match(main, /params\.get\('highlights'\)/);
  assert.match(main, /new Highlights\(\$\('#highlights'\), \{ shown: \(\) => ctx\.cfg\.screen\.highlights !== false \}\)/);
  // the Personalizado card builds its own Highlights without the switch
  assert.doesNotMatch(read('web/display/widgets/canvas/family.ts'), /shown:/);
  assert.match(read('web/display/defaults.ts'), /highlights: true/);
  for (const f of ['docs/CONFIGURATION.md']) assert.match(read(f), /\?highlights=0/, f);
});

const PILLS = `(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  const el = document.querySelector('#highlights');
  return { shown: getComputedStyle(el).display !== 'none', pills: el.querySelectorAll('.hl-pill').length, h: el.getBoundingClientRect().height };
})()`;

test('off, no pill is drawn and no room is kept for them, on every design that shows them', { skip: !findChrome() && 'no Chrome', timeout: 120_000 }, async () => {
  const web = await startWeb();
  const chrome = await launchChrome();
  try {
    for (const q of ['preset=bigCalendar&style=modern', 'preset=bigCalendar&style=classic', 'preset=agenda&style=modern', 'preset=topBottom&style=classic', 'preset=today&style=modern']) {
      const base = `${web.url}/?demo=1&now=2026-03-04T10:43&shot=1&lite=1&photos=0&${q}`;
      const on = await chrome.page(base, { width: 1920, height: 1080 });
      const a = await on.eval(PILLS);
      await on.close();
      const off = await chrome.page(`${base}&highlights=0`, { width: 1920, height: 1080 });
      const b = await off.eval(PILLS);
      await off.close();
      assert.ok(a.shown && a.pills > 0, `${q}: the demo shows pills (${JSON.stringify(a)})`);
      assert.deepEqual([b.shown, b.pills, b.h], [false, 0, 0], q);
    }
  } finally {
    await chrome.close();
    await web.close();
  }
});
