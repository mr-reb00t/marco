// Navigation on touch screens (Personalizado "Navegación": "Ir a pantalla", "Pausar carrusel", the progress card and
// the swipe). The model and its validation (core/canvasCore.js), what a display may read through the buttons
// (core/carousels.js reachableScreens, displayAccess.js requestScreen), the projection (taps only with touch on, not
// private, a trusted display), what a tap does (web/display/nav.ts planNav), the idle return and its memo, the carousel
// jump that restarts a step's time, the pause and the swipe (web/display/carousel.ts, on a fake clock), and in headless
// Chrome (skipped without one): the demo carousel with the cards, the swipe, and the admin's preview where a tap only
// lights the button up.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CANVAS_KINDS, CLOUD_CANVAS_KINDS, NAV_RETURN_DEFAULT, canvasDefaults, defaultCanvas, defaultItemStyle, exportCanvasFile, navTargets, projectCanvas, sanitizeCanvas,
} from '../core/canvasCore.js';
import { carouselPhase, carouselSlot, reachableScreens, readableScreens } from '../core/carousels.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { mediaScreens, requestScreen } from '../displayAccess.js';
import { loadWebModules } from './webModules.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const [{ CarouselController }, nav] = await loadWebModules('/web/display/carousel.ts', '/web/display/nav.ts');
const { planNav, NavIdle, readMemo, swipeDir, NAV_SAVE_EVERY } = nav;
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const sink = () => {
  const errors = [];
  return { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn: () => {} };
};
const item = (kind, props = {}, extra = {}) => ({ id: `cv_${kind.replace(/\W/g, '').slice(0, 8).padEnd(8, 'x')}`, kind, pos: { zone: 'main', x: 0, y: 0, size: CANVAS_KINDS[kind].def }, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra });
const canvasOf = (items, over = {}) => ({ ...defaultCanvas(), touch: true, ...over, items });

// ---------------------------------------------------------------- model

test('the three kinds: category Navegación, every edition (Marco Cloud too), the sizes asked for', () => {
  for (const k of ['nav.button', 'nav.pause', 'nav.progress']) {
    assert.equal(CANVAS_KINDS[k].cat, 'nav', k);
    assert.equal(CANVAS_KINDS[k].edition, 'all', k);
    assert.ok(CLOUD_CANVAS_KINDS.includes(k), `${k} on Cloud`);
  }
  // from one line or the mini (icon only) up to medium
  assert.deepEqual(CANVAS_KINDS['nav.button'].sizes, ['row', 'xs', 's', 'w', 'm']);
  assert.deepEqual(CANVAS_KINDS['nav.button'].defaults(), { target: '', label: '', icon: '', show: 'both', returnMin: NAV_RETURN_DEFAULT });
  assert.equal(NAV_RETURN_DEFAULT, 5);
  // only the buttons need touch; the progress card does not
  assert.equal(CANVAS_KINDS['nav.button'].taps, true);
  assert.equal(CANVAS_KINDS['nav.pause'].taps, true);
  assert.equal(CANVAS_KINDS['nav.progress'].taps, undefined);
  assert.equal(defaultCanvas().swipe, false);
});

test('validation: the target is a screen of the household or Inicio; icons, text, show and the idle time', () => {
  const c = sink();
  const refs = { screenIds: new Set(['s_main', 's_kitchen']) };
  const out = sanitizeCanvas(c, 'canvas', canvasOf([
    item('nav.button', { target: 's_kitchen', icon: 'i:home', show: 'icon', returnMin: 0 }),
    item('nav.button', { target: 'home', icon: '🍳', label: 'Cocina', returnMin: 999 }),
    item('nav.button', { target: 's_gone', icon: 'i:nope' }),
    item('nav.button', { target: 'bad id!', show: 'huge', returnMin: 'x' }),
    item('nav.pause', { returnMin: 15 }),
    item('nav.progress', { style: 'bar', name: false }),
  ].map((it, i) => ({ ...it, id: `cv_nav0000${i}`, pos: { zone: 'main', x: (i % 4) * 3, y: Math.floor(i / 4) * 3, size: 'xs' } })), { swipe: true }), refs, {});
  const p = out.items.map((it) => it.props);
  assert.deepEqual(p[0], { target: 's_kitchen', label: '', icon: 'i:home', show: 'icon', returnMin: 0 });
  assert.deepEqual(p[1], { target: 'home', label: 'Cocina', icon: '🍳', show: 'both', returnMin: 120 });
  // a deleted screen is not chosen any more; an unknown built-in icon is no icon
  assert.equal(p[2].target, '');
  assert.equal(p[2].icon, '');
  assert.equal(p[3].target, '');
  assert.equal(p[3].show, 'both');
  assert.equal(p[3].returnMin, 5);
  assert.equal(p[4].returnMin, 15);
  assert.deepEqual(p[5], { style: 'bar', name: false, time: true });
  assert.equal(out.swipe, true);
  assert.ok(c.errors.some((e) => /items\[3\]\.props\.target: invalid screen id/.test(e)), c.errors.join('\n'));
  assert.ok(c.errors.some((e) => /items\[3\]\.props\.show/.test(e)));
});

test('a saved config drops the targets of deleted screens; navTargets lists the shown ones', () => {
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  const kitchen = defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' });
  c.screens.push(kitchen);
  const main = c.screens[0];
  main.layout.preset = 'canvas';
  main.canvas = canvasOf([
    { ...item('nav.button', { target: 's_kitchen' }), id: 'cv_navaaaaa', pos: { zone: 'main', x: 0, y: 0, size: 's' } },
    { ...item('nav.button', { target: 's_gone00' }), id: 'cv_navbbbbb', pos: { zone: 'main', x: 3, y: 0, size: 's' } },
    { ...item('nav.button', { target: 'home' }), id: 'cv_navccccc', pos: { zone: 'main', x: 6, y: 0, size: 's' } },
  ]);
  const r = validateConfig(c);
  const saved = r.value.screens.find((s) => s.id === main.id);
  assert.deepEqual(saved.canvas.items.map((it) => it.props.target), ['s_kitchen', '', 'home']);
  assert.deepEqual(navTargets(saved), ['s_kitchen']);
  // hidden buttons lead nowhere
  saved.canvas.items[0].hidden = true;
  assert.deepEqual(navTargets(saved), []);
});

test('a screen file leaves the targets behind (another Marco has other screens), Inicio stays', () => {
  const cv = canvasOf([
    { ...item('nav.button', { target: 's_kitchen' }), id: 'cv_navaaaaa' },
    { ...item('nav.button', { target: 'home' }), id: 'cv_navbbbbb', pos: { zone: 'main', x: 4, y: 0, size: 's' } },
  ]);
  const f = exportCanvasFile(cv);
  assert.deepEqual(f.canvas.items.map((it) => it.props.target), ['', 'home']);
  assert.deepEqual(f.picks, { cv_navaaaaa: ['screen'] });
});

// ---------------------------------------------------------------- projection

test('projection: taps need touch, a screen that is not private and a trusted display; Cloud (no HA controls) has them', () => {
  const screen = { layout: { preset: 'canvas' }, canvas: canvasOf([{ ...item('nav.button', { target: 's_kitchen' }), id: 'cv_navaaaaa' }], { swipe: true }) };
  const screens = [{ id: 's_main', name: 'Salón' }, { id: 's_kitchen', name: 'Cocina' }];
  const on = projectCanvas(screen, { screens });
  assert.equal(on.taps, true);
  assert.equal(on.swipe, true);
  assert.equal(on.items[0].props.targetName, 'Cocina');
  assert.equal(on.items[0].interactive, false);
  // Marco Cloud: no Home Assistant controls, the navigation still works
  assert.equal(projectCanvas(screen, { screens, haControls: false }).taps, true);
  assert.equal(projectCanvas(screen, { screens, haControls: false }).touch, false);
  assert.equal(projectCanvas(screen, { screens, isPrivate: true }).taps, false);
  assert.equal(projectCanvas(screen, { screens, isPrivate: true }).swipe, false);
  assert.equal(projectCanvas(screen, { screens, trusted: false }).taps, false);
  assert.equal(projectCanvas({ ...screen, canvas: { ...screen.canvas, touch: false } }, { screens }).taps, false);
  // a screen deleted since: no target
  assert.equal(projectCanvas(screen, { screens: [screens[0]] }).items[0].props.target, '');
});

test('the server passes the household\'s screens and whether the display is trusted (family rule)', () => {
  assert.match(read('server/core/screens.js'), /screens: \(cfg\.screens \?\? \[\]\)\.map\(\(x\) => \(\{ id: x\.id, name: x\.name \}\)\), trusted,/);
  assert.match(read('server/routes/public.js'), /familyQr: familyQrUrl\(req\), trusted: trustedDisplay\(req\),/);
});

// ---------------------------------------------------------------- what a display may read

function household() {
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.screens[0].id = 's_main';
  c.defaultScreen = 's_main';
  for (const [id, slug] of [['s_kitchen', 'kitchen'], ['s_photos', 'photos'], ['s_guest', 'guest'], ['s_far', 'far']]) c.screens.push(defaultScreenProfile({ id, slug, name: slug }));
  const nav = (id, targets) => {
    const s = c.screens.find((x) => x.id === id);
    s.layout.preset = 'canvas';
    s.canvas = canvasOf(targets.map((t, i) => ({ ...item('nav.button', { target: t }), id: `cv_nav${id.slice(2, 5)}${i}0`.padEnd(11, '0').slice(0, 11), pos: { zone: 'main', x: (i % 4) * 3, y: 0, size: 's' } })));
  };
  nav('s_main', ['s_kitchen', 'home']);
  nav('s_kitchen', ['s_photos']);
  c.carousels = { items: [{ id: 'v_loop', name: 'Loop', slug: 'loop', steps: [{ screenId: 's_guest', seconds: 30 }] }] };
  nav('s_guest', ['s_far']);
  const r = validateConfig(c);
  assert.deepEqual(r.errors, []);
  return r.value;
}

test('reachableScreens: the screens the buttons lead to, and where those lead, nothing else', () => {
  const cfg = household();
  assert.deepEqual(reachableScreens(cfg, ['s_main']), ['s_main', 's_kitchen', 's_photos']);
  assert.deepEqual(reachableScreens(cfg, ['s_photos']), ['s_photos']);
  assert.deepEqual(readableScreens(cfg, 'v_loop'), ['s_guest', 's_far']);
  assert.deepEqual(reachableScreens(cfg, ['s_nope']), []);
});

test('requestScreen: a binding reads the screens its buttons lead to, and still never any other', () => {
  const cfg = household();
  const bound = (id, screen) => requestScreen(cfg, { displayAccess: { screenId: id }, query: { screen } });
  assert.equal(bound('s_main', 's_kitchen').screen.id, 's_kitchen');
  assert.equal(bound('s_main', 'photos').screen.id, 's_photos', 'through the kitchen\'s button');
  assert.equal(bound('s_main', 'guest').screen.id, 's_main', 'no button leads there');
  assert.equal(bound('s_main', 's_kitchen').carousel, null);
  assert.equal(bound('s_photos', 'kitchen').screen.id, 's_photos', 'the photos screen has no button');
  // a carousel: its screens, and where their buttons lead (the carousel stays, so the display keeps rotating after)
  const far = bound('v_loop', 'far');
  assert.equal(far.screen.id, 's_far');
  assert.equal(far.carousel.id, 'v_loop');
  assert.equal(bound('v_loop', 'kitchen').screen.id, 's_guest');
  // open mode: a screen via the carousel keeps the carousel when a button of it leads there
  assert.equal(requestScreen(cfg, { query: { screen: 'far', via: 'loop' } }).carousel.id, 'v_loop');
  assert.equal(requestScreen(cfg, { query: { screen: 'kitchen', via: 'loop' } }).carousel, null);
  // photos of the screens a binding may show
  assert.deepEqual(mediaScreens(cfg, { via: 'key', screenId: 's_main' }).map((s) => s.id), ['s_main', 's_kitchen', 's_photos']);
  assert.deepEqual(mediaScreens(cfg, { via: 'key', screenId: 's_photos' }).map((s) => s.id), ['s_photos']);
});

// ---------------------------------------------------------------- what a tap does

test('planNav: Inicio, a step of the carousel (jump), a screen outside it (visit), a single screen', () => {
  const car = { homeScreen: '', steps: ['a', 'b', 'c', 'b'], rotating: true, current: 'a', index: 0 };
  assert.deepEqual(planNav('home', car), { do: 'home' });
  assert.deepEqual(planNav('', car), { do: 'none' });
  assert.deepEqual(planNav('c', car), { do: 'jump', index: 2 });
  assert.deepEqual(planNav('b', car), { do: 'jump', index: 1 });
  // the step on screen is that screen: its time starts again there
  assert.deepEqual(planNav('b', { ...car, current: 'b', index: 3 }), { do: 'jump', index: 3 });
  assert.deepEqual(planNav('x', car), { do: 'visit', screenId: 'x' });
  // outside its schedule (or held at night) the carousel does not rotate: the screen is shown and stays
  assert.deepEqual(planNav('c', { ...car, rotating: false }), { do: 'visit', screenId: 'c' });
  const solo = { homeScreen: 'a', steps: null, rotating: false, current: 'a', index: -1 };
  assert.deepEqual(planNav('x', solo), { do: 'visit', screenId: 'x' });
  assert.deepEqual(planNav('a', { ...solo, current: 'x' }), { do: 'home' });
  assert.deepEqual(planNav('x', { ...solo, current: 'x' }), { do: 'none' });
});

/** A virtual clock with timers. */
function fakeClock(start) {
  let now = start;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    pending: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].at);
        next[1].fn();
        await new Promise((r) => setImmediate(r));
      }
      now = end;
      await new Promise((r) => setImmediate(r));
    },
  };
}

function idle(home = 'v_loop', stored = null) {
  const clock = fakeClock(1_000_000);
  const saved = [];
  const expired = [];
  let mem = stored;
  const n = new NavIdle(home, {
    now: clock.now,
    load: () => mem,
    save: (m) => {
      mem = m ? structuredClone(m) : null;
      saved.push(mem);
    },
    expire: (m) => expired.push(m),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { n, clock, saved, expired, mem: () => mem };
}

test('idle return: back after X minutes without a touch; every touch pushes it; 0 = it stays; kept only in this browser', async () => {
  const { n, clock, expired, saved, mem } = idle();
  n.start('visit', 's_kitchen', 5);
  assert.equal(mem().until, 1_000_000 + 5 * 60_000);
  await clock.advance(4 * 60_000);
  n.touched();
  await clock.advance(4 * 60_000);
  assert.equal(expired.length, 0, 'the touch pushed the return');
  await clock.advance(60_000 + 100);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].screenId, 's_kitchen');
  assert.equal(mem(), null, 'forgotten once it ended');
  // a finger on a slider touches a lot: the end is written at most every NAV_SAVE_EVERY
  n.start('pause', '', 2);
  const writes = saved.length;
  for (let i = 0; i < 10; i++) {
    n.touched();
    await clock.advance(1000);
  }
  assert.ok(saved.length - writes <= Math.ceil(10_000 / NAV_SAVE_EVERY) + 1, `${saved.length - writes} writes`);
  // "No volver solo": no timer at all
  const b = idle();
  b.n.start('visit', 's_kitchen', 0);
  assert.equal(b.mem().until, null);
  assert.equal(b.clock.pending(), 0);
  await b.clock.advance(24 * 3600_000);
  assert.equal(b.expired.length, 0);
});

test('after a reload: the memo of this binding comes back while it holds; old, broken or of another binding is dropped', async () => {
  const memo = { v: 1, mode: 'visit', screenId: 's_kitchen', returnMin: 5, until: 1_000_000 + 60_000, home: 'v_loop' };
  const a = idle('v_loop', memo);
  assert.deepEqual(a.n.restore(), memo);
  await a.clock.advance(60_100);
  assert.equal(a.expired.length, 1, 'the time left after the reload still counts');
  assert.equal(idle('v_other', memo).n.restore(), null);
  assert.equal(idle('v_loop', { ...memo, until: 999_999 }).n.restore(), null);
  assert.equal(idle('v_loop', { ...memo, mode: 'fly' }).n.restore(), null);
  assert.equal(idle('v_loop', 'junk').n.restore(), null);
  assert.deepEqual(readMemo({ ...memo, until: null, returnMin: 0 }, 'v_loop', 2e12), { ...memo, until: null, returnMin: 0 });
});

test('swipe: quick and sideways, to the left = next', () => {
  assert.equal(swipeDir(-200, 10, 300), -1);
  assert.equal(swipeDir(200, 10, 300), 1);
  assert.equal(swipeDir(-200, 150, 300), 0, 'too steep');
  assert.equal(swipeDir(-30, 0, 300), 0, 'too short');
  assert.equal(swipeDir(-200, 0, 2000), 0, 'too slow');
  // a small screen needs less
  assert.equal(swipeDir(-60, 0, 300, 480), -1);
});

// ---------------------------------------------------------------- the carousel on this display

const cfgOf = (screenId) => ({ revision: 1, screenId, screen: { name: screenId, language: 'en', nightMode: { enabled: false, from: '23:00', to: '07:00', dim: 0.3 } } });
const BLOCK = {
  id: 'v_loop', slug: 'loop', name: 'Loop', enabled: true, transition: 'fade', holdOnAlert: true, nightRotate: false, offScreenId: 'a', schedule: [],
  steps: [{ screenId: 'a', slug: 'aa', name: 'A', seconds: 60 }, { screenId: 'b', slug: 'bb', name: 'B', seconds: 20 }, { screenId: 'c', slug: 'cc', name: 'C', seconds: 40 }],
};

function controller() {
  const t0 = 120_000 * 20_000_000; // a loop starts: step "a"
  const clock = fakeClock(t0);
  const shown = [];
  const c = new CarouselController(BLOCK, 'Europe/Lisbon', 'a', {
    now: clock.now,
    night: () => false,
    alertOn: () => false,
    fetch: async (id, parts) => ({ config: parts.includes('config') ? cfgOf(id) : undefined, events: { events: [], hash: id }, countdowns: { items: [] }, photos: { photos: [] } }),
    show: (id) => shown.push([id, clock.now() - t0]),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  c.put('a', 'config', cfgOf('a'));
  c.put('a', 'events', { events: [], hash: 'a' });
  let changes = 0;
  c.onChange = () => changes++;
  return { c, clock, shown, t0, changes: () => changes };
}

test('carouselPhase offset: the slot moves, the schedule keeps the real time', () => {
  const t = 120_000 * 7;
  assert.equal(carouselPhase(BLOCK, t).screenId, 'a');
  // shifted 60 s: "b" starts now and ends 20 s later
  const ph = carouselPhase(BLOCK, t, { offset: 60_000 });
  assert.equal(ph.screenId, 'b');
  assert.equal(ph.endsAt, t + 20_000);
  assert.equal(carouselSlot(BLOCK.steps, t + 60_000).index, 1);
});

test('a jump shows the step at once and starts its time again; the carousel goes on from there', async () => {
  const { c, clock, shown, changes } = controller();
  c.start();
  await clock.advance(30_000);
  c.jumpTo(2); // "c", 40 s
  await clock.advance(50);
  assert.deepEqual(shown.map(([id]) => id), ['c']);
  const w = c.where();
  assert.equal(w.index, 2);
  assert.equal(w.endsAt - w.startsAt, 40_000);
  assert.equal(w.endsAt, clock.now() - 50 + 40_000);
  assert.ok(changes() >= 1, 'the progress card hears of it');
  // the full 40 s of "c", then "a" (the loop goes on from the jumped step), 60 s, then "b"
  await clock.advance(39_000);
  assert.equal(shown.length, 1);
  await clock.advance(1_000);
  assert.deepEqual(shown.map(([id]) => id), ['c', 'a']);
  await clock.advance(60_100);
  assert.deepEqual(shown.map(([id]) => id), ['c', 'a', 'b']);
  // a jump to the step on screen only restarts its time
  await clock.advance(10_000);
  c.jumpTo(1);
  assert.equal(shown.length, 3);
  assert.equal(c.where().endsAt, clock.now() + 20_000);
  // home: the shared clock again (every TV on the carousel agrees)
  c.home();
  await clock.advance(50);
  const shared = carouselPhase(BLOCK, clock.now()).screenId;
  assert.equal(c.current, shared);
  c.stop();
});

test('swipe steps: next and previous from the step on screen, round the loop', async () => {
  const { c, clock, shown } = controller();
  c.start();
  c.stepBy(-1);
  await clock.advance(50);
  assert.deepEqual(shown.map(([id]) => id), ['c']);
  c.stepBy(1);
  await clock.advance(50);
  c.stepBy(1);
  await clock.advance(50);
  assert.deepEqual(shown.map(([id]) => id), ['c', 'a', 'b']);
  assert.equal(c.where().endsAt - clock.now(), 20_000 - 50);
  c.stop();
});

test('pause holds the step until it goes on (its time starts again); a visit holds a screen outside the steps', async () => {
  const { c, clock, shown } = controller();
  c.start();
  await clock.advance(10_000);
  c.pause(true);
  assert.equal(c.paused, true);
  assert.equal(c.nextSwitchAt(), null);
  assert.equal(c.where().paused, true);
  await clock.advance(10 * 60_000);
  assert.deepEqual(shown, [], 'no switch while paused');
  c.pause(false);
  assert.equal(c.where().endsAt - clock.now(), 60_000, '"a" starts its 60 s again');
  await clock.advance(60_100);
  assert.deepEqual(shown.map(([id]) => id), ['b']);
  // a screen of no step: fetched like a bundle, held (no rotation) until home
  c.visitScreen('x');
  await clock.advance(50);
  assert.deepEqual(shown.map(([id]) => id), ['b', 'x']);
  assert.equal(c.visit, 'x');
  assert.equal(c.where().index, -1);
  assert.equal(c.where().visiting, 'x');
  await clock.advance(10 * 60_000);
  assert.equal(shown.length, 2);
  c.update(BLOCK, 'Europe/Lisbon');
  assert.ok(c.bundles.has('x'), 'a saved config keeps the visited screen\'s data');
  c.home();
  await clock.advance(50);
  assert.equal(c.visit, null);
  assert.equal(shown.length, 3);
  assert.equal(shown[2][0], carouselPhase(BLOCK, clock.now()).screenId);
  c.stop();
});

// ---------------------------------------------------------------- the editor

test('the editor: why a button does not show without touch, the swipe switch, the ambient hint', () => {
  const why = read('web/admin/builder/hiddenWhy.ts');
  assert.match(why, /if \(k\.taps && ctx\.touch === false\) return 'touch';/);
  const insp = read('web/admin/builder/Inspector.tsx');
  assert.match(insp, /t\('Deslizar para cambiar de pantalla'\)/);
  assert.match(insp, /p\.env\.go\('background\/bg-ambient'\)/);
  assert.match(read('web/admin/sections/Background.tsx'), /<Card id="bg-ambient"/);
  // every string of the cards in the five languages
  const dict = read('web/admin/i18n-dict-nav.ts');
  for (const k of ['Ir a pantalla', 'Pausar carrusel', 'Progreso del carrusel', 'Volver solo tras', 'Sin tocar', 'Ir a Efecto ambiental']) assert.ok(dict.includes(`['${k}',`), k);
  const shared = read('web/shared/i18n.ts');
  for (const k of ['navHome', 'navPause', 'navResume', 'navPaused', 'navUnavailable']) assert.equal(shared.split(`  ${k}: `).length - 1, 5, k);
});

// ---------------------------------------------------------------- in a browser

const chrome = findChrome();
describe('navigation cards in a browser', { skip: !chrome && 'no Chrome' }, () => {
  let web;
  let browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome(chrome);
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });
  const open = async (q, expr) => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=es&${q}`);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const value = await p.eval(expr);
      const errors = p.errors().map((e) => JSON.stringify(e.params).slice(0, 300)).filter((e) => !/Vite|WebSocket|404|Failed to load/.test(e));
      return { value, errors };
    } finally {
      await p.close();
    }
  };
  const TAP = `const tap = async (sel, text) => {
    const b = [...document.querySelectorAll(sel)].find((x) => !text || x.textContent.includes(text));
    b.click();
    await new Promise((r) => setTimeout(r, 1800));
  };
  const app = () => document.getElementById('app').className;
  const left = () => [...document.querySelectorAll('.cv-prog-left')].map((e) => e.textContent);`;

  test('a carousel: tap jumps to the step (its time starts again), the pause holds it, a screen outside is shown', async () => {
    const { value, errors } = await open('carousel=1&nav=1&stepSec=600&fade=0', `(async () => {
      ${TAP}
      const start = { app: app(), buttons: document.querySelectorAll('.cv-nav-btn').length, left: left() };
      await tap('.cv-nav-pause .cv-nav-btn');
      const paused = { left: left(), label: document.querySelector('.cv-nav-pause .cv-nav-t').textContent };
      await tap('.cv-nav-pause .cv-nav-btn');
      const resumed = left();
      await tap('.cv-nav-go .cv-nav-btn', 'Agenda');
      const agenda = app();
      return { start, paused, resumed, agenda };
    })()`);
    assert.deepEqual(errors, []);
    assert.match(value.start.app, /preset-canvas/);
    assert.ok(value.start.buttons >= 6);
    assert.deepEqual(value.paused, { left: ['En pausa', 'En pausa'], label: 'Seguir' });
    for (const l of value.resumed) assert.match(l, /^(10 min|9:5\d)$/, 'going on starts the step\'s time again');
    assert.match(value.agenda, /preset-agenda/);
    const kitchen = await open('carousel=1&nav=1&stepSec=600&fade=0', `(async () => {
      ${TAP}
      await tap('.cv-nav-go .cv-nav-btn', 'Cocina');
      return app();
    })()`);
    assert.match(kitchen.value, /preset-today/, 'the kitchen is not in the carousel: shown and kept');
  });

  test('a swipe to the left goes to the next screen; a mouse drag does not', async () => {
    const { value } = await open('carousel=1&nav=1&stepSec=600&fade=0', `(async () => {
      const app = () => document.getElementById('app').className;
      const stroke = (type, x0, x1) => {
        const at = (x) => ({ bubbles: true, pointerId: 7, pointerType: type, clientX: x, clientY: 980, isPrimary: true });
        const el = document.elementFromPoint(x0, 980);
        el.dispatchEvent(new PointerEvent('pointerdown', at(x0)));
        el.dispatchEvent(new PointerEvent('pointerup', at(x1)));
      };
      const swipeOn = document.documentElement.classList.contains('nav-swipe');
      stroke('mouse', 1400, 600);
      await new Promise((r) => setTimeout(r, 1500));
      const afterMouse = app();
      stroke('touch', 1400, 600);
      await new Promise((r) => setTimeout(r, 1800));
      return { swipeOn, afterMouse, afterTouch: app() };
    })()`);
    assert.equal(value.swipeOn, true);
    assert.match(value.afterMouse, /preset-canvas/);
    assert.match(value.afterTouch, /preset-today/, 'the next step: Hoy');
  });

  test('the admin preview: the buttons show, a tap only lights them up; no swipe', async () => {
    const { value } = await open('preset=canvas&shot=nav&preview=1', `(async () => {
      ${TAP}
      const b = [...document.querySelectorAll('.cv-nav-go .cv-nav-btn')].find((x) => x.textContent.includes('Cocina'));
      b.click();
      const lit = b.classList.contains('is-pressed');
      await new Promise((r) => setTimeout(r, 1500));
      return {
        lit, inert: b.classList.contains('is-inert') || true, still: !!document.querySelector('.cv-nav-btn'), app: app(),
        swipe: document.documentElement.classList.contains('nav-swipe'),
        progress: document.querySelectorAll('.cv-prog-dot').length,
        on: [...document.querySelectorAll('.cv-nav-btn.is-on')].length,
      };
    })()`);
    assert.equal(value.lit, true);
    assert.equal(value.still, true);
    assert.equal(value.on, 0, 'nothing navigated');
    assert.equal(value.swipe, false);
    assert.equal(value.progress, 4, 'a made-up progress so the card can be edited');
  });

  test('without touch the buttons are not drawn (the progress card stays)', async () => {
    const { value } = await open('preset=canvas&shot=nav&touch=0', `(() => ({
      buttons: document.querySelectorAll('.cv-nav-btn').length,
      empty: [...document.querySelectorAll('.cv-item.is-empty')].map((e) => e.dataset.kind).sort(),
    }))()`);
    assert.equal(value.buttons, 0);
    assert.ok(value.empty.includes('nav.button') && value.empty.includes('nav.pause'), JSON.stringify(value.empty));
  });
});
