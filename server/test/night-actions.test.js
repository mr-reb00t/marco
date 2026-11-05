// What night mode does on a screen (#38): screen.nightMode.action dims it ('dim', the original behaviour and the
// default), swaps the layout for the bedside view ('bedside', with the clock, the agenda or 1 to 4 weeks) or turns it
// black ('black', where a doorbell ring or an announcement still wakes it at the night brightness unless `wake` is
// off). Validation and defaults (older configs keep dimming), the admin save path, the display's own checks, the
// events window of the night view, and the real display in Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultConfig, NIGHT_ACTIONS, NIGHT_VIEWS } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { eventsWindow, nightViewOf, bootEventWindows } from '../core/bootstrap.js';
import { displayConfig } from '../core/screens.js';
import { loadWebModules } from './webModules.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const [screens, displayDefaults] = await loadWebModules('/web/shared/screens.ts', '/web/display/defaults.ts');
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const DEFAULT_NIGHT = { enabled: false, from: '23:00', to: '07:00', dim: 0.35, action: 'dim', view: 'clock', weeks: 2, wake: true };

test('night mode defaults: dim, the clock, two weeks, wake; a config saved before #38 validates to the same', () => {
  assert.deepEqual(NIGHT_ACTIONS, ['dim', 'bedside', 'black']);
  assert.deepEqual(NIGHT_VIEWS, ['clock', 'agenda', 'weeks']);
  const r = validateConfig(defaultConfig());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.screens[0].screen.nightMode, DEFAULT_NIGHT);
  const old = defaultConfig();
  const nm = old.screens[0].screen.nightMode;
  for (const k of ['action', 'view', 'weeks', 'wake']) delete nm[k];
  nm.enabled = true;
  nm.dim = 0.2;
  const o = validateConfig(old);
  assert.equal(o.ok, true, JSON.stringify(o.errors));
  assert.deepEqual(o.value.screens[0].screen.nightMode, { ...DEFAULT_NIGHT, enabled: true, dim: 0.2 });
  // and it reaches the display as it is
  assert.deepEqual(displayConfig(o.value, o.value.screens[0]).screen.nightMode, o.value.screens[0].screen.nightMode);
});

test('bad night settings are errors with their path, and fall back to the defaults', () => {
  const bad = [
    ['action', 'off'], ['action', 'Black'], ['view', 'month'], ['weeks', 0], ['weeks', 5], ['weeks', 'many'], ['wake', 'yes'], ['wake', 1],
  ];
  for (const [k, v] of bad) {
    const c = defaultConfig();
    c.screens[0].screen.nightMode[k] = v;
    const r = validateConfig(c);
    assert.equal(r.ok, false, `accepted ${k} = ${JSON.stringify(v)}`);
    assert.ok(r.errors.some((e) => e.path === `screens[0].screen.nightMode.${k}`), JSON.stringify(r.errors));
    assert.equal(r.value.screens[0].screen.nightMode[k], DEFAULT_NIGHT[k], k);
  }
  // a number as text is a number (as every other number setting), and whole weeks only
  const c = defaultConfig();
  Object.assign(c.screens[0].screen.nightMode, { action: 'bedside', view: 'weeks', weeks: '3' });
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.screens[0].screen.nightMode.weeks, 3);
});

test('the admin save path keeps each screen its own night', () => {
  for (const nm of [{ action: 'black', wake: false }, { action: 'bedside', view: 'weeks', weeks: 4 }, { action: 'bedside', view: 'agenda' }]) {
    const cfg = validateConfig(defaultConfig()).value;
    const view = screens.projectScreen(cfg);
    Object.assign(view.screen.nightMode, nm, { enabled: true });
    const r = validateConfig(screens.applyScreen(cfg, view));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.value.screens[0].screen.nightMode, { ...DEFAULT_NIGHT, ...nm, enabled: true });
  }
});

test('the display checks the night settings again (older servers send none)', () => {
  const { normalizeConfig } = displayDefaults;
  assert.deepEqual(normalizeConfig({}).screen.nightMode, DEFAULT_NIGHT);
  // an older server: the four keys missing, the screen dims as it always did
  assert.deepEqual(normalizeConfig({ screen: { nightMode: { enabled: true, from: '22:00', to: '06:00', dim: 0.5 } } }).screen.nightMode, { ...DEFAULT_NIGHT, enabled: true, from: '22:00', to: '06:00', dim: 0.5 });
  const odd = normalizeConfig({ screen: { nightMode: { action: 'x', view: 'y', weeks: 9, wake: 0, dim: 7 } } }).screen.nightMode;
  // weeks clamps, wake is off only when it is false (0 is not a boolean: the default stays), dim at most 1
  assert.deepEqual({ action: odd.action, view: odd.view, weeks: odd.weeks, wake: odd.wake, dim: odd.dim }, { action: 'dim', view: 'clock', weeks: 4, wake: true, dim: 1 });
  assert.equal(normalizeConfig({ screen: { nightMode: { wake: false } } }).screen.nightMode.wake, false);
  assert.equal(normalizeConfig({ screen: { nightMode: { action: 'black' } } }).screen.nightMode.action, 'black');
});

test('the events window covers the night view all day, so the switch needs no new request', () => {
  const cfg = (nm, calendar = {}) => ({ screen: { nightMode: { ...DEFAULT_NIGHT, ...nm } }, calendar: { enabled: true, weeks: 2, weekStart: 1, ...calendar }, layout: { preset: 'bigCalendar' }, datetime: { timezone: 'UTC' } });
  assert.equal(nightViewOf(cfg({})), null);
  assert.equal(nightViewOf(cfg({ action: 'bedside' })), null);
  assert.equal(nightViewOf(cfg({ action: 'black', view: 'agenda' })), null);
  assert.equal(nightViewOf(cfg({ action: 'bedside', view: 'agenda' }, { enabled: false })), null);
  assert.deepEqual(nightViewOf(cfg({ action: 'bedside', view: 'weeks', weeks: 4 })), { view: 'weeks', weeks: 4 });
  // Thursday 5 November 2026: the grid starts on Monday 2; two weeks ask for 22 days, the night's four for 29
  assert.deepEqual(eventsWindow('2026-11-05', { weeks: 2 }), ['2026-11-02', '2026-11-24']);
  assert.deepEqual(eventsWindow('2026-11-05', { weeks: 2, night: { view: 'weeks', weeks: 4 } }), ['2026-11-02', '2026-12-01']);
  assert.deepEqual(eventsWindow('2026-11-05', { weeks: 2, night: { view: 'agenda', weeks: 2 } }), ['2026-11-02', '2027-01-05']);
  // the page bootstrap asks for the same window as the display
  const now = new Date('2026-11-05T12:00:00Z');
  assert.deepEqual(bootEventWindows(cfg({ action: 'bedside', view: 'weeks', weeks: 4 }), now)[0], ['2026-11-02', '2026-12-01']);
  assert.deepEqual(bootEventWindows(cfg({}), now)[0], ['2026-11-02', '2026-11-24']);
});

test('the black screen hides what glows, and every new admin text is used and translated', () => {
  const css = read('web/display/styles.css');
  assert.match(css, /html\.night-black #status, html\.night-black #privacy-lock \{ visibility: hidden; \}/);
  assert.match(css, /html\.night-black #alerts, html\.night-black #doorbell \{ filter: brightness\(var\(--night-wake/);
  assert.match(css, /html\.night-black\.night-nowake #alerts, html\.night-black\.night-nowake #doorbell \{ visibility: hidden !important; \}/);
  const src = read('web/admin/sections/Screen.tsx');
  const group = read('web/admin/i18n-dict-group.ts');
  for (const k of [
    'Atenúa la pantalla, muestra la vista de mesilla o la deja en negro durante la noche.', 'Durante el modo noche', 'Atenuar',
    'Vista de mesilla', 'En negro', 'Una semana', 'Tres semanas', 'Cuatro semanas', 'Brillo de la vista de mesilla', 'Brillo de los avisos',
    'Despertar con el timbre y los avisos', 'Despertar con los avisos',
    'La pantalla sigue en negro y solo enseña el timbre o el aviso mientras dura, con poco brillo.',
    'El calendario está apagado en esta pantalla: se verá el reloj.',
  ]) {
    assert.ok(src.includes(`t('${k}')`), k);
    assert.ok(group.includes(`'${k}'`), k);
  }
  assert.ok(read('web/admin/sections/Layout.tsx').includes("t('Para verla solo de noche, deja otro diseño y elige Vista de mesilla en Pantalla, Modo noche.')"));
});

describe('night mode in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });
  // the demo screen at 23:30 (or noon), the night forced on with ?night=1 unless `day`; `probe` runs once it settled
  const look = async (q, probe, { day = false, wait = 600 } = {}) => {
    const at = day ? '2026-11-05T12:00' : '2026-11-05T23:30';
    const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=en&now=${at}&shot=1&preset=bigCalendar${day ? '' : '&night=1'}&${q}`, { width: 1920, height: 1080 });
    try {
      return await p.eval(`(async () => {
        for (let i = 0; i < 80 && !document.querySelector('#app[class*="preset-"] .clock .d, #app[class*="preset-"] .clock svg'); i++) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, ${wait}));
        return (${probe})();
      })()`);
    } finally {
      await p.close();
    }
  };

  test('bedside with the agenda or a few weeks, over the big calendar', { timeout: 120_000 }, async () => {
    const agenda = await look('nightAction=bedside&nightView=agenda', `() => ({
      app: document.getElementById('app').className,
      view: document.getElementById('view').className,
      days: document.querySelectorAll('#view .bs-cal .agenda .ag-day').length,
      grid: getComputedStyle(document.getElementById('calendar')).display,
      late: document.getElementById('app').classList.contains('bedside-late'),
    })`);
    assert.match(agenda.app, /\bpreset-bedside\b/, agenda.app);
    assert.match(agenda.view, /\bview-bedside\b.*\bbs-v-agenda\b/, agenda.view);
    assert.ok(agenda.days > 0, JSON.stringify(agenda));
    assert.equal(agenda.grid, 'none');
    assert.equal(agenda.late, true);
    const weeks = await look('nightAction=bedside&nightView=weeks&nightWeeks=3', `() => {
      const cal = document.querySelector('#view .bs-cal .cal');
      return { weeks: cal && getComputedStyle(cal).getPropertyValue('--weeks').trim(), rows: cal ? cal.querySelectorAll('.wk').length : 0 };
    }`);
    assert.deepEqual(weeks, { weeks: '3', rows: 3 });
  });

  test('black hides the screen and what glows on it; dim is as before', { timeout: 120_000 }, async () => {
    const black = await look('nightAction=black', `() => ({
      opacity: document.getElementById('night').style.opacity,
      cls: document.documentElement.className,
      app: document.getElementById('app').className,
      status: getComputedStyle(document.getElementById('status')).visibility,
    })`);
    assert.equal(black.opacity, '1');
    assert.match(black.cls, /\bnight-black\b/);
    assert.doesNotMatch(black.cls, /\bnight-nowake\b/);
    assert.match(black.app, /\bpreset-bigCalendar\b/);
    assert.equal(black.status, 'hidden');
    const dim = await look('nightAction=dim', `() => ({ opacity: document.getElementById('night').style.opacity, cls: document.documentElement.className, app: document.getElementById('app').className })`);
    assert.equal(dim.opacity, '0.65');
    assert.doesNotMatch(dim.cls, /\bnight-black\b/);
    assert.match(dim.app, /\bpreset-bigCalendar\b/);
  });

  test('a doorbell ring wakes a black screen dimmed, or stays hidden without wake', { timeout: 120_000 }, async () => {
    const probe = `() => { const d = document.getElementById('doorbell'); const cs = getComputedStyle(d); return { show: d.classList.contains('show'), filter: cs.filter, visibility: cs.visibility }; }`;
    const woken = await look('nightAction=black&doorbell=1', probe, { wait: 1800 });
    assert.equal(woken.show, true, JSON.stringify(woken));
    assert.equal(woken.visibility, 'visible');
    assert.match(woken.filter, /brightness\(0\.35\)/);
    const asleep = await look('nightAction=black&doorbell=1&nightWake=0', probe, { wait: 1800 });
    assert.equal(asleep.show, true, JSON.stringify(asleep));
    assert.equal(asleep.visibility, 'hidden');
  });

  test('by day the screen keeps its own layout', { timeout: 60_000 }, async () => {
    const day = await look('nightAction=bedside&nightView=agenda', `() => ({ app: document.getElementById('app').className, op: document.getElementById('night').style.opacity })`, { day: true });
    assert.match(day.app, /\bpreset-bigCalendar\b/);
    assert.doesNotMatch(day.app, /\bpreset-bedside\b/);
    assert.equal(day.op, '0');
  });
});
