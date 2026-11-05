// Where the layouts put the clock and how large (#36): datetime.clockAlign ('auto' keeps the layout's own place, or
// left, centre, right) and datetime.clockSize (0.6 to 1.6 times the layout's size), per screen. Validation, the
// admin's save path (web/shared/screens.ts, which must list the same per-screen keys as the server), the display's
// own normalisation, and the clock on the Modern and Classic designs in headless Chrome (skipped without a browser).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../core/validate.js';
import { defaultConfig, SCREEN_ONLY_KEYS, SCREEN_SPLIT_KEYS, CLOCK_ALIGNS } from '../core/defaults.js';
import { loadWebModules } from './webModules.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const [screens, displayDefaults] = await loadWebModules('/web/shared/screens.ts', '/web/display/defaults.ts');

test('clockAlign and clockSize: per screen, auto and 1 by default and for screens saved before them, checked', () => {
  assert.deepEqual(CLOCK_ALIGNS, ['auto', 'left', 'center', 'right']);
  assert.ok(SCREEN_SPLIT_KEYS.datetime.includes('clockAlign') && SCREEN_SPLIT_KEYS.datetime.includes('clockSize'));
  const fresh = validateConfig(defaultConfig());
  assert.equal(fresh.value.screens[0].datetime.clockAlign, 'auto');
  assert.equal(fresh.value.screens[0].datetime.clockSize, 1);
  const old = defaultConfig();
  delete old.screens[0].datetime.clockAlign;
  delete old.screens[0].datetime.clockSize;
  const r = validateConfig(old);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.screens[0].datetime.clockAlign, 'auto');
  assert.equal(r.value.screens[0].datetime.clockSize, 1);
  const bad = defaultConfig();
  bad.screens[0].datetime.clockAlign = 'top';
  bad.screens[0].datetime.clockSize = 3;
  const b = validateConfig(bad);
  assert.equal(b.ok, false);
  const paths = b.errors.map((e) => e.path);
  assert.ok(paths.some((p) => p.endsWith('datetime.clockAlign')), JSON.stringify(paths));
  assert.ok(paths.some((p) => p.endsWith('datetime.clockSize')), JSON.stringify(paths));
});

test("the admin's save path keeps every per-screen key: the custom date pattern, the clock's place and size", () => {
  // the admin's copy of the key lists is the server's
  assert.deepEqual(JSON.parse(JSON.stringify(screens.SCREEN_SPLIT_KEYS)), SCREEN_SPLIT_KEYS);
  assert.deepEqual([...screens.SCREEN_ONLY_KEYS], SCREEN_ONLY_KEYS);
  const cfg = validateConfig(defaultConfig()).value;
  const view = screens.projectScreen(cfg);
  Object.assign(view.datetime, { dateFormat: 'custom', dateCustom: '{d}/{m}', clockAlign: 'center', clockSize: 1.3 });
  const r = validateConfig(screens.applyScreen(cfg, view));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.screens[0].datetime, { ...cfg.screens[0].datetime, dateFormat: 'custom', dateCustom: '{d}/{m}', clockAlign: 'center', clockSize: 1.3 });
  assert.deepEqual(r.value.datetime, cfg.datetime);
});

test('the display keeps a known place and a size in range, else the defaults', () => {
  const n = (dt) => displayDefaults.normalizeConfig({ datetime: dt }).datetime;
  assert.deepEqual([n({}).clockAlign, n({}).clockSize], ['auto', 1]);
  assert.deepEqual([n({ clockAlign: 'left', clockSize: 1.4 }).clockAlign, n({ clockAlign: 'left', clockSize: 1.4 }).clockSize], ['left', 1.4]);
  assert.deepEqual([n({ clockAlign: 'middle', clockSize: 9 }).clockAlign, n({ clockAlign: 'middle', clockSize: 9 }).clockSize], ['auto', 1.6]);
  assert.equal(n({ clockSize: 0.1 }).clockSize, 0.6);
});

describe('the clock in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });
  const measure = async (q) => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=en&now=2026-11-05T10:00&shot=1&${q}`, { width: 1920, height: 1080 });
    try {
      return await p.eval(`(async () => {
        for (let i = 0; i < 60 && !document.querySelector('.side-top .clock .d'); i++) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 300));
        const top = document.querySelector('.side-top').getBoundingClientRect();
        const face = document.querySelector('.side-top .clock.digital');
        const c = face.getBoundingClientRect();
        const pill = document.querySelector('.side-top .hl-pill')?.getBoundingClientRect() ?? null;
        return {
          left: c.left - top.left, right: top.right - c.right,
          pillLeft: pill ? pill.left - top.left : null, pillRight: pill ? top.right - pill.right : null,
          fs: parseFloat(getComputedStyle(face).fontSize), zoom: face.style.zoom || '', inside: c.left >= top.left - 1 && c.right <= top.right + 1,
        };
      })()`);
    } finally {
      await p.close();
    }
  };

  test('left, centre or right in the side panel, the pills under it with it, on both designs', { timeout: 120_000 }, async () => {
    for (const style of ['modern', 'classic']) {
      const left = await measure(`style=${style}&clockAlign=left&clockSize=0.7`);
      const center = await measure(`style=${style}&clockAlign=center&clockSize=0.7`);
      const right = await measure(`style=${style}&clockAlign=right&clockSize=0.7`);
      assert.ok(left.left < 10 && left.right > 100, `${style} left: ${JSON.stringify(left)}`);
      assert.ok(right.right < 40 && right.left > 100, `${style} right: ${JSON.stringify(right)}`);
      assert.ok(Math.abs(center.left - center.right) < 40, `${style} center: ${JSON.stringify(center)}`);
      // the pills under the clock go with it
      assert.ok(left.pillLeft < 10 && right.pillRight < 10, `${style} pills: ${JSON.stringify([left, right])}`);
    }
  });

  test('smaller or larger, never wider than its panel', { timeout: 120_000 }, async () => {
    for (const style of ['modern', 'classic']) {
      const base = await measure(`style=${style}&clockSize=1`);
      const small = await measure(`style=${style}&clockSize=0.7`);
      const big = await measure(`style=${style}&clockSize=1.6&clockAlign=center`);
      assert.ok(Math.abs(small.fs / base.fs - 0.7) < 0.01, `${style}: ${small.fs} / ${base.fs}`);
      assert.ok(Math.abs(big.fs / base.fs - 1.6) < 0.01, `${style}: ${big.fs} / ${base.fs}`);
      // 1.6 times the Modern / Classic clock is wider than the side panel: it shrinks back to fit
      assert.ok(big.inside, `${style}: ${JSON.stringify(big)}`);
    }
  });
});
