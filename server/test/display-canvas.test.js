// Personalizado on the display (web/display/widgets/canvas.ts and canvas/*): the preset wiring, the background rules,
// the per-item settings, the "text only" rule of the adapters, and the demo layouts rendered in headless Chrome
// (skipped without a browser; set CHROME_PATH): every card on the grid with no overlap, the clocks right across
// daylight saving time, and two calendar cards each with only their own calendars.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LAYOUT_PRESETS } from '../core/validate.js';
import { loadWebModules } from './webModules.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const [glass, cfgMod] = await loadWebModules('/web/shared/glass.ts', '/web/display/widgets/canvas/config.ts');

test('the canvas preset is wired everywhere a layout is listed', () => {
  assert.ok(LAYOUT_PRESETS.includes('canvas'));
  const main = read('web/display/main.ts');
  assert.match(main, /'kidsRoutines', 'kidsFamily', 'kidsMeals',\n\s+\/\/ Personalizado[^\n]*\n\s+'canvas',\n\];/);
  assert.match(main, /'planner', 'widget', 'canvas'\]\.includes\(preset\)/, 'the animated background is offered');
  assert.ok(glass.SCREEN_PHOTO_PRESETS.includes('canvas'));
  assert.match(read('web/shared/types.ts'), /\| 'canvas';/);
  assert.match(read('web/index.html'), /<div id="canvas" class="cv" hidden><\/div>/);
  assert.match(read('web/index.html'), /<div id="canvas-side" class="cv cv--side" hidden><\/div>/);
  // Classic (and an older server with no canvas block) shows the big calendar, as the kids layouts do
  assert.match(main, /if \(p === 'canvas' && \(cfg\.screen\.style !== 'modern' \|\| !cfg\.canvas\)\) return 'bigCalendar';/);
});

test('effectiveBackground: the photo behind the screen, only in the sidebar, or none; the saved one is left alone', () => {
  const bg = { enabled: true, scope: 'side', source: 'gallery', intervalSec: 60 };
  const side = (s, fill) => ({ side: s, size: 'normal', fill });
  assert.deepEqual(glass.effectiveBackground(bg, { background: 'photo', sidebar: side('none', 'glass') }), { ...bg, enabled: true, scope: 'screen' });
  assert.deepEqual(glass.effectiveBackground(bg, { background: 'ambient', sidebar: side('left', 'photo') }), { ...bg, enabled: true, scope: 'side' });
  assert.deepEqual(glass.effectiveBackground(bg, { background: 'solid', sidebar: side('left', 'photo') }), { ...bg, enabled: true, scope: 'side' });
  assert.deepEqual(glass.effectiveBackground(bg, { background: 'ambient', sidebar: side('none', 'photo') }), { ...bg, enabled: false, scope: 'side' });
  assert.deepEqual(glass.effectiveBackground(bg, { background: 'solid', sidebar: side('right', 'glass') }), { ...bg, enabled: false, scope: 'side' });
  assert.deepEqual(glass.effectiveBackground({ ...bg, enabled: false }, { background: 'photo', sidebar: side('none', 'glass') }).enabled, true);
  assert.deepEqual(bg, { enabled: true, scope: 'side', source: 'gallery', intervalSec: 60 });
  assert.equal(glass.effectiveBackground(bg, null), bg);
  assert.equal(glass.photoOnWholeScreen(glass.effectiveBackground(bg, { background: 'photo', sidebar: side('none', 'glass') }), 'canvas'), true);
});

test('per-item settings: the item props over the screen section, calendars filtered, cached by v', () => {
  const screen = {
    calendar: { enabled: false, view: 'agenda', weeks: 5, sources: [{ id: 'a' }, { id: 'b' }], hidePast: false },
    datetime: { enabled: false, clock: 'analog', showSeconds: true, dateFormat: 'weekday_d_month', dateCustom: '' },
    weather: { enabled: false, forecastDays: 5 }, news: { enabled: false, rotateSec: 15 }, countdowns: { enabled: false, max: 4 },
    todo: { enabled: false, items: [] }, message: { enabled: false, text: 'x', emoji: '' },
  };
  const month = { id: 'cv_aaaaaaaa', kind: 'calendar.month', v: '1', props: { sourceIds: ['b'], hidePast: true, weeks: 3, eventStyle: 'cards', maxEventsPerDay: 6, showLegend: false } };
  const c = cfgMod.itemCfg(screen, month);
  assert.equal(c.calendar.enabled, true);
  assert.equal(c.calendar.view, 'month');
  assert.equal(c.calendar.weeks, 3);
  assert.deepEqual(c.calendar.sources, [{ id: 'b' }]);
  assert.equal(c.calendar.hidePast, true);
  assert.equal(c.datetime, screen.datetime, 'other sections are the screen\'s own');
  assert.equal(cfgMod.itemCfg(screen, month), c, 'cached while v is the same');
  assert.notEqual(cfgMod.itemCfg(screen, { ...month, v: '2' }), c);
  const clock = cfgMod.itemCfg(screen, { id: 'cv_bbbbbbbb', kind: 'clock.digital', v: '1', props: { seconds: false, dateFormat: 'short' } });
  assert.deepEqual([clock.datetime.enabled, clock.datetime.clock, clock.datetime.showSeconds, clock.datetime.dateFormat], [true, 'digital', false, 'custom']);
  const keep = cfgMod.sourceFilter(month);
  assert.deepEqual(['a', 'b'].filter(keep), ['b']);
  assert.equal(cfgMod.sourceFilter({ props: { sourceIds: null } }), null);
  // the sidebar stack: spans in order, the fill takes what is left
  const tracks = cfgMod.sideTracks([
    { id: 'x', pos: { zone: 'side', order: 1, span: 'fill' } }, { id: 'y', pos: { zone: 'side', order: 0, span: 3 } }, { id: 'z', pos: { zone: 'side', order: 2, span: 2 } },
  ]);
  assert.deepEqual([...tracks], [['y', { start: 0, span: 3 }], ['x', { start: 3, span: 3 }], ['z', { start: 6, span: 2 }]]);
  assert.equal(cfgMod.sidebarSide({ sidebar: { side: 'left' } }, true), 'top');
  assert.equal(cfgMod.sidebarSide({ sidebar: { side: 'right' } }, true), 'bottom');
  assert.equal(cfgMod.sidebarSide({ sidebar: { side: 'right' } }, false), 'right');
});

test('adapters write item text as text: innerHTML only with static markup', () => {
  const dirs = ['web/display/widgets/canvas', 'web/display/widgets/ha'].filter((d) => fs.existsSync(new URL(`../../${d}`, import.meta.url)));
  // what may be assigned: a string literal with no ${}, the views' static skeletons, the static icon strings of icons.ts
  const ok = /^(?:'[^'$]*'|"[^"$]*"|`[^`$]*`|SKELETON\[kind\]|icon|svg)$/;
  let seen = 0;
  for (const d of dirs) {
    for (const f of fs.readdirSync(new URL(`../../${d}`, import.meta.url))) {
      const src = read(path.join(d, f));
      assert.equal(/insertAdjacentHTML|outerHTML\s*=|document\.write/.test(src), false, `${f}: insertAdjacentHTML / outerHTML / document.write`);
      for (const m of src.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) {
        seen++;
        assert.match(m[1].trim(), ok, `${f}: innerHTML = ${m[1].trim()}`);
      }
    }
  }
  assert.ok(seen > 0);
});

test('display strings of the canvas: six languages, no em dashes', async () => {
  const [i18n] = await loadWebModules('/web/shared/i18n.ts');
  for (const k of ['cvEmpty', 'cvNotAvailable', 'cvPrivate', 'cvSoon', 'cvSetup', 'cvWeek', 'cvNoValue']) {
    for (const l of ['es', 'en', 'pt', 'nl', 'da', 'pl']) {
      const s = i18n.DICTS[l][k];
      assert.ok(s, `${k} ${l}`);
      assert.equal(s.includes('\u2014'), false, `${k} ${l}`);
      assert.equal(/dakboard/i.test(s), false);
    }
  }
  assert.equal(read('web/admin/i18n-dict-builder.ts').includes('\u2014'), false);
});

test('the low-power look follows a late detection and a screen with no photo engine still asks the GPU', () => {
  const main = read('web/display/main.ts');
  // the client hints and the GPU name arrive after the first frame: both go through setLowPower, which restyles
  assert.match(main, /isArmDesktop\(v\.architecture, uad\.platform, uad\.mobile\)\) setLowPower\(\);/);
  assert.match(main, /if \(isLowPowerGPU\(String\(name \?\? ''\)\)\) setLowPower\(\);\n  \} catch \{ \/\* no name/);
  assert.match(main, /function setLowPower\(\): void \{\n  if \(lowPower\) return;\n  lowPower = true;\n  syncLowPower\(\);/);
  assert.match(main, /root\.classList\.toggle\('low-power', on\);\n  canvasView\.lowChanged\(\);/);
  // a plain or animated background starts no GL engine: a throwaway context reads the name once, then is let go
  assert.match(main, /if \(engine\) return checkGPU\(\);/);
  assert.match(main, /WEBGL_lose_context'\)\?\.loseContext\(\)/);
  assert.match(main, /syncLowPower\(\);\n  if \(on\) \{\n    probeGPU\(\);/);
});

const chrome = findChrome();
describe('demo layouts in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  /** Open the demo with `q`, wait for it to settle, and return `expr` evaluated in the page (errors included). */
  async function open(q, expr, size = { width: 1920, height: 1080 }) {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&${q}`, size);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))');
      const value = await p.eval(expr);
      // the Vite client's own websocket (no HMR in tests) is not a page error
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      return { value, errors };
    } finally {
      await p.close();
    }
  }

  const LAYOUT = `(() => {
    const app = document.getElementById('app');
    const grid = document.getElementById('canvas').getBoundingClientRect();
    const side = document.getElementById('canvas-side');
    const sideBox = side.hidden ? null : side.getBoundingClientRect();
    const items = [...document.querySelectorAll('.cv-item:not([hidden])')].map((e) => {
      const r = e.getBoundingClientRect();
      return { kind: e.dataset.kind, zone: e.parentElement.id, x: r.left, y: r.top, w: r.width, h: r.height, body: e.querySelector('.cv-body').childElementCount };
    });
    return { app: app.className, items, grid: { x: grid.left, y: grid.top, w: grid.width, h: grid.height }, side: sideBox && { x: sideBox.left, y: sideBox.top, w: sideBox.width, h: sideBox.height }, hint: !!document.querySelector('.cv-hint'), canvasHidden: document.getElementById('canvas').hidden };
  })()`;

  const inside = (r, b) => r.x >= b.x - 1 && r.y >= b.y - 1 && r.x + r.w <= b.x + b.w + 1 && r.y + r.h <= b.y + b.h + 1;
  const overlap = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

  for (const [shot, n, size] of [
    ['starter', 5], ['todos', 5], ['kinds', 8], ['sidebar', 8], ['dense', 24], ['home', 8], ['ha', 10], ['controls', 11], ['features', 11], ['binary', 20], ['data', 7], ['cameras', 6], ['html', 5], ['values', 9], ['clocks', 5], ['calendars', 2], ['media', 6],
    ['portrait', 5, { width: 1080, height: 1920 }],
  ]) {
    test(`${shot}: ${n} cards on the grid, none overlapping, nothing outside its area, no page error`, async () => {
      const { value: L, errors } = await open(`preset=canvas&shot=${shot}`, LAYOUT, size);
      assert.deepEqual(errors, []);
      assert.match(L.app, /\bpreset-canvas\b/);
      assert.equal(L.items.length, n, JSON.stringify(L.items.map((i) => i.kind)));
      for (const it of L.items) {
        assert.ok(it.w > 20 && it.h > 20, `${it.kind} has no size`);
        assert.ok(it.body > 0 || it.kind === 'spacer', `${it.kind} drew nothing`);
        assert.ok(inside(it, it.zone === 'canvas-side' ? L.side : L.grid), `${it.kind} outside its area`);
      }
      for (let i = 0; i < L.items.length; i++) for (let j = i + 1; j < L.items.length; j++) assert.equal(overlap(L.items[i], L.items[j]), false, `${L.items[i].kind} overlaps ${L.items[j].kind}`);
    });
  }

  test('Home Assistant cards read their states by alias: tile, sensor with its curve, room rows, chart, media', async () => {
    const { value: v, errors } = await open('preset=canvas&shot=ha&lang=en', `(() => {
      const card = (k) => [...document.querySelectorAll('.cv-item[data-kind="' + k + '"] .cv-body')];
      return {
        tiles: card('ha.tile').map((b) => [b.querySelector('.cv-ha-name')?.textContent, b.querySelector('.cv-ha-state')?.textContent, b.querySelector('.cv-ha-tile')?.className]),
        sensor: card('ha.sensor').map((b) => [b.querySelector('.cv-ha-big .v')?.textContent, !!b.querySelector('.cv-ha-spark path'), b.querySelector('.cv-ha-big')?.className]),
        rows: card('ha.room')[0].querySelectorAll('.cv-ha-row').length,
        chart: [card('ha.chart')[0].querySelectorAll('.cv-ha-chart-svg path.line').length, card('ha.chart')[0].querySelector('.cv-ha-chart-period')?.textContent],
        media: card('ha.media')[0].querySelector('.cv-ha-title')?.textContent,
        notes: [...document.querySelectorAll('.cv-ha-note')].map((n) => n.textContent),
      };
    })()`);
    assert.deepEqual(errors, []);
    assert.deepEqual(v.tiles[0].slice(0, 2), ['Salón', 'On · 70 %'], 'the state once, with the brightness');
    assert.match(v.tiles[0][2], /tone-on/);
    assert.equal(v.sensor[0][0], '21.4');
    assert.equal(v.sensor[0][1], true, 'today\'s curve behind the value');
    assert.match(v.sensor[1][2], /lv-ok/, 'below the first breakpoint: green');
    assert.equal(v.rows, 4);
    assert.deepEqual(v.chart, [2, 'Last 24 hours']);
    assert.equal(v.media, 'Blue in Green');
    assert.deepEqual(v.notes, []);
  });

  test('Colores según el valor in the small look of a sensor too (issue #13): the value line takes the colour', async () => {
    const { value: v, errors } = await open('preset=canvas&shot=size:ha.sensor:row&lang=en', `[...document.querySelectorAll('.cv-item[data-kind="ha.sensor"] .cv-body')]
      .filter((b) => b.querySelector('.cv-ha-tile-card, .cv-ha-tile') && /\\d/.test(b.querySelector('.cv-ha-state')?.textContent ?? ''))
      .map((b) => { const st = b.querySelector('.cv-ha-state'); return [st.textContent, (/lv-(ok|warn|err)/.exec(st.className) ?? [])[1] ?? '', getComputedStyle(st).color]; })`);
    assert.deepEqual(errors, []);
    assert.ok(v.length >= 3, JSON.stringify(v));
    // the demo's sensors: 20 and 60, the other way round every other one (21.4 °C and 48 % between, 1.3 kW above)
    for (const [text, lv, color] of v) {
      assert.ok(lv, `${text}: no colour`);
      assert.doesNotMatch(color, /^rgba?\(255, 255, 255/, `${text}: still the plain ink`);
    }
  });

  test('Colores según el estado (issue #13): a door closed in green when the owner says so, the others as Home Assistant colours them', async () => {
    const { value: v, errors } = await open('preset=canvas&shot=size:ha.sensor:row&lang=en', `[...document.querySelectorAll('.cv-item[data-kind="ha.sensor"] .cv-body .cv-ha-tile')]
      .map((t) => [t.querySelector('.cv-ha-state')?.textContent, (/tone-([a-z]+)/.exec(t.className) ?? [])[1], getComputedStyle(t.querySelector('.cv-ha-state')).color])`);
    assert.deepEqual(errors, []);
    // the demo: the second sensor a door with colorOn red / colorOff green, closed; the fifth a motion sensor on auto
    const door = v.find(([text]) => text === 'Closed');
    assert.ok(door, JSON.stringify(v));
    assert.equal(door[1], 'good');
    assert.match(door[2], /^rgb\(76, 217, 100\)/, 'the state line in the green of --ha-ok');
    assert.ok(v.some(([text, t]) => text === 'Motion' && t === 'on'), 'a sensor on auto keeps its own colour');
  });

  // every Casa card (and the Sección) at every size it allows, with the defaults and normal names (every third one
  // long), on a touch screen: nothing reports "No cabe" (the same measure as the editor's badge) and no text is cut by
  // the card's edge, with no sidebar, a wide sidebar on top or on the left, and in portrait; the climate card's name,
  // state, temperature and modes never overlap; a cover (its own card or an Entidad) shows up, stop and down whole
  const FITS = `(() => {
    const boxes = (b) => [...b.querySelectorAll('.cv-ha-name, .cv-ha-state, .cv-ha-cl-big, .cv-ha-cur, .cv-ha-target, .cv-ha-modes, .cv-ha-fans, .cv-ha-climate-extra, .cv-ha-head')]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => { const r = e.getBoundingClientRect(); return { c: e.className, x: r.left, y: r.top, w: r.width, h: r.height, inHead: !!e.closest('.cv-ha-head') && !e.classList.contains('cv-ha-head'), inDial: !!e.closest('.cv-ha-dial-mid') }; });
    return [...document.querySelectorAll('.cv-item:not([hidden])')].map((e) => {
      const b = e.querySelector('.cv-body');
      const bs = boxes(b);
      const hit = [];
      if (e.dataset.kind === 'ha.climate') {
        for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i], c = bs[j];
          if (a.inHead || c.inHead || (a.inDial && c.inDial)) continue;
          if (a.c.includes('cv-ha-head') && c.inHead) continue;
          if (a.x < c.x + c.w - 1 && c.x < a.x + a.w - 1 && a.y < c.y + c.h - 1 && c.y < a.y + a.h - 1) hit.push(a.c + ' / ' + c.c);
        }
      }
      // any text cut by the card's edge (not only the cramped mark): a line half under the bottom, a word past the side
      const br = b.getBoundingClientRect();
      const cut = [...b.querySelectorAll('*')].filter((t) => !(t instanceof SVGElement) && !t.closest('.cv-slider, .cv-ha-toast, .cv-ha-swatches, .cv-chips')
        && [...t.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && t.getClientRects().length && getComputedStyle(t).visibility !== 'hidden')
        .filter((t) => { const r = t.getBoundingClientRect(); return r.bottom > br.bottom + 1 || r.top < br.top - 1 || r.right > br.right + 1 || r.left < br.left - 1; })
        .map((t) => t.className || t.tagName);
      // a cover's up, stop and down: whole and inside the card, at least 4.4rem high (a comfortable touch target)
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
      const cover = e.dataset.kind === 'ha.cover' || b.dataset.d === 'cover';
      const btns = [...b.querySelectorAll('.cv-ha-cbtn')].filter((t) => {
        if (!t.getClientRects().length || getComputedStyle(t).visibility === 'hidden') return false;
        const r = t.getBoundingClientRect();
        return r.top >= br.top - 1 && r.bottom <= br.bottom + 1 && r.left >= br.left - 1 && r.right <= br.right + 1 && (t.closest('.is-line') || r.height >= rem * 4.4);
      }).length;
      return { kind: e.dataset.kind, cramped: e.classList.contains('is-cramped'), name: b.querySelector('.cv-ha-name, .cv-ha-room-title, .cv-heading-t')?.textContent ?? '', hit, cut, cover, btns };
    });
  })()`;
  test('every Casa card fits every size it allows: no "No cabe", nothing overlapping (sidebars, portrait)', { timeout: 600_000 }, async () => {
    const { CANVAS_KINDS } = await import('../core/canvasCore.js');
    const bad = [];
    for (const [o, side, size] of [['landscape', '', null], ['landscape', 'top', null], ['landscape', 'left', null], ['portrait', '', { width: 1080, height: 1920 }]]) {
      for (const [kind, def] of Object.entries(CANVAS_KINDS)) {
        if (!kind.startsWith('ha.') && kind !== 'heading') continue;
        for (const sz of def.sizes) {
          const shot = `size:${kind}:${sz}:${o}${side ? `:${side}` : ''}`;
          const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=${shot}`, size ?? { width: 1920, height: 1080 });
          try {
            await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 500)))');
            const cards = await p.eval(FITS);
            if (!cards.length) bad.push(`${shot}: no cards`);
            for (const c of cards) {
              if (c.cramped) bad.push(`${shot}: ${c.name} does not fit`);
              if (c.hit.length) bad.push(`${shot}: ${c.name} overlaps ${c.hit.join(', ')}`);
              if (c.cut.length) bad.push(`${shot}: ${c.name} cuts ${c.cut.join(', ')}`);
              // a cover on a touch screen: up, stop and down at every size (the line: none, or up and down)
              if (c.cover && sz !== 'row' && c.btns !== 3) bad.push(`${shot}: ${c.name} shows ${c.btns} of the cover's 3 buttons`);
              if (c.cover && sz === 'row' && c.btns !== 0 && c.btns !== 2) bad.push(`${shot}: ${c.name} shows ${c.btns} buttons on its line`);
            }
          } finally {
            await p.close();
          }
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  const CONTROLS = `(async () => {
    const q = (s, r = document) => [...r.querySelectorAll(s)];
    const card = (k, i = 0) => q('.cv-item[data-kind="' + k + '"] .cv-body')[i];
    const ev = (el, type, x = 0) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: x }));
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = { touch: document.getElementById('canvas').classList.contains('ha-touch') };
    // the switch (it says what a tap does; the state line says the state)
    // the light's icon and name switch it (no switch row); the card's tone says whether it is on
    const sw = () => card('ha.light', 1).querySelector('.cv-ha-tile.is-tap');
    const lit = () => String(card('ha.light', 1).dataset.tone === 'on');
    out.before = lit();
    out.label = String(!!card('ha.light', 1).querySelector('.cv-ha-toggle'));
    ev(sw(), 'pointerup');
    await pause(30);
    out.after = lit();
    // a finger that bounces: the second tap within 600 ms does nothing
    ev(sw(), 'pointerup');
    await pause(30);
    out.bounce = lit();
    // + twice on the climate: 21.5 to 22.5 at once
    ev(card('ha.climate').querySelector('.cv-ha-dial-r'), 'pointerup');
    ev(card('ha.climate').querySelector('.cv-ha-dial-r'), 'pointerup');
    await pause(30);
    out.target = card('ha.climate').querySelector('.cv-ha-target').textContent;
    // the brightness slider follows the finger
    const s = card('ha.light').querySelector('[data-slide="brightness"]');
    const r = s.getBoundingClientRect();
    // (the card is drawn again under the finger: the moves reach the zone, which holds the pointer)
    const zone = document.getElementById('canvas');
    ev(s, 'pointerdown', r.left + r.width * 0.2);
    ev(zone, 'pointermove', r.left + r.width * 0.5);
    ev(zone, 'pointerup', r.left + r.width * 0.5);
    await pause(30);
    out.bri = card('ha.light').querySelector('.cv-slider-t').textContent;
    // a scene says it is done
    ev(card('ha.scene').querySelector('.cv-ha-scene'), 'pointerup');
    await pause(30);
    out.toast = card('ha.scene').querySelector('.cv-ha-toast')?.textContent ?? '';
    // a mode chip, a room row
    ev(card('ha.climate').querySelector('.cv-chip.mode-cool'), 'pointerup');
    ev(card('ha.room').querySelectorAll('.cv-ha-row.is-tap')[1], 'pointerup');
    await pause(30);
    out.mode = card('ha.climate').querySelector('.cv-chip.is-on')?.textContent;
    out.row = card('ha.room').querySelectorAll('.cv-ha-switch')[1]?.className;
    out.small = Math.min(...q('button.cv-ctl, .cv-slider:not(.is-ro), .is-tap').filter((b) => b.getClientRects().length).map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)));
    out.rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    out.buttons = q('button.cv-ctl').length;
    return out;
  })()`;

  test('Home Assistant controls on a touch screen: taps and −/+ act at once, a slider follows the finger, bounces are ignored', async () => {
    const { value: v, errors } = await open('preset=canvas&shot=controls&lang=en', CONTROLS);
    assert.deepEqual(errors, []);
    assert.equal(v.touch, true);
    assert.deepEqual([v.before, v.after, v.bounce], ['false', 'true', 'true']);
    assert.equal(v.label, 'false', 'no switch row');
    assert.equal(v.target, '22.5°');
    assert.equal(v.bri, '51 %');
    assert.equal(v.toast, 'Done');
    assert.equal(v.mode, 'Cool');
    assert.match(v.row, /is-on/, 'the fan row switched on');
    assert.ok(v.small >= 4.8 * v.rem - 1, `every touch target is at least 4.8rem (${v.small}px, rem ${v.rem}px)`);
    // the admin's preview draws the same controls, and taps do nothing there
    const pv = await open('preset=canvas&shot=controls&lang=en&preview=1', CONTROLS);
    assert.deepEqual(pv.errors, []);
    assert.equal(pv.value.touch, false);
    assert.equal(pv.value.buttons, v.buttons);
    assert.deepEqual([pv.value.before, pv.value.after], ['false', 'false']);
  });

  const FEATURES = `(async () => {
    const q = (s, r = document) => [...r.querySelectorAll(s)];
    const tiles = q('.cv-item[data-kind="ha.tile"] .cv-body');
    const tile = (name) => tiles.find((b) => b.querySelector('.cv-ha-name')?.textContent === name);
    const ev = (el, type, x = 0) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 8, clientX: x }));
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = { rows: tiles.map((b) => [b.querySelector('.cv-ha-name')?.textContent, q('.cv-ha-feat', b).map((f) => f.className.replace('cv-ha-feat feat-', ''))]) };
    // a select: the chip of another option
    ev(q('.cv-chip', tile('Modo del lavavajillas'))[1], 'pointerup');
    // a vacuum starts, a valve closes
    ev(q('button.cv-ctl', tile('Robot aspirador'))[0], 'pointerup');
    ev(q('button.cv-ctl', tile('Riego del jardín'))[1], 'pointerup');
    // the climate's + by its step
    ev(q('.cv-ha-sbtn', tiles.find((b) => b.querySelector('.feat-target'))).at(-1), 'pointerup');
    await pause(30);
    out.select = q('.cv-chip.is-on', tile('Modo del lavavajillas')).map((c) => c.textContent);
    out.vacuum = tile('Robot aspirador').querySelector('.cv-ha-state').textContent;
    out.valve = tile('Riego del jardín').querySelector('.cv-ha-state').textContent;
    out.climate = q('.cv-ha-sval', tiles.find((b) => b.querySelector('.feat-target'))).map((x) => x.textContent);
    out.update = tile('Home Assistant').querySelector('.cv-ha-featnote')?.textContent;
    out.gauge = [q('.cv-item[data-kind="ha.gauge"] .cv-ha-big .v')[0]?.textContent, q('.cv-item[data-kind="ha.gauge"] .band').length, q('.cv-item[data-kind="ha.gauge"] .cv-ha-big')[0]?.className];
    await pause(200);
    out.stat = [q('.cv-item[data-kind="ha.statistic"] .cv-ha-big .v')[0]?.textContent, q('.cv-item[data-kind="ha.statistic"] .cv-ha-ago')[0]?.textContent];
    out.heading = q('.cv-item[data-kind="heading"] .cv-heading-t')[0]?.textContent;
    out.small = Math.min(...q('.cv-ha-feats button.cv-ctl, .cv-ha-feats .cv-slider:not(.is-ro)').filter((b) => b.getClientRects().length).map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)));
    out.rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return out;
  })()`;

  test('Entidad rows: brightness and colour temperature, −/+ and modes, a cover, a valve, a vacuum, a select, a number; Indicador, Estadística, Sección', async () => {
    const { value: v, errors } = await open('preset=canvas&shot=features&lang=en', FEATURES);
    assert.deepEqual(errors, []);
    assert.deepEqual(v.rows.map((r) => r[1]), [['update'], ['color'], ['target', 'hvacModes'], ['cover'], ['valve'], ['vacuum'], ['select'], ['number']]);
    assert.deepEqual(v.select, ['Normal']);
    assert.equal(v.vacuum, 'Cleaning');
    assert.equal(v.valve, 'Closing');
    assert.deepEqual(v.climate, ['22.0°']);
    assert.equal(v.update, '2026.9.3 → 2026.10.1');
    assert.equal(v.gauge[0], '48');
    assert.equal(v.gauge[1], 3, 'three colour bands');
    assert.match(v.gauge[2], /lv-ok/);
    assert.deepEqual(v.stat, ['7.4', 'Today']);
    assert.equal(v.heading, 'Salón');
    assert.ok(v.small >= 4.8 * v.rem - 1, `every touch target is at least 4.8rem (${v.small}px, rem ${v.rem}px)`);
  });

  const DATA = `(async () => {
    const q = (s, root = document) => [...root.querySelectorAll(s)];
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    await pause(400);
    const card = (kind, i = 0) => q('.cv-item[data-kind="' + kind + '"] .cv-body')[i];
    const out = {};
    const list = card('market', 0);
    out.coins = q('.cv-mk-row', list).map((r) => [r.querySelector('.cv-mk-badge').textContent, r.querySelector('.cv-mk-p').textContent, r.className.includes('is-up') ? 'up' : r.className.includes('is-down') ? 'down' : 'flat', !!r.querySelector('svg.cv-curve path.ln')]);
    out.range = list.querySelector('.cv-dt-range')?.textContent;
    const big = card('market', 1);
    out.big = [big.classList.contains('is-big'), big.querySelector('.cv-mk-price')?.textContent, !!big.querySelector('.cv-dt-area path.ar'), big.querySelector('.cv-dt-range')?.textContent];
    const sp = card('sports', 0);
    out.groups = q('.cv-sp-group .l', sp).map((x) => x.textContent);
    out.live = q('.cv-sp-game.is-in', sp).map((g) => [g.querySelector('.cv-sp-sc').textContent, g.querySelector('.cv-sp-st').textContent]);
    out.crests = q('.cv-sp-ini', sp).length;
    out.nba = q('.cv-sp-game', card('sports', 1)).length;
    out.ticker = q('.cv-st-q .sym', card('stocks', 1)).map((x) => x.textContent).slice(0, 3);
    out.quotes = q('.cv-st-row .sym', card('stocks', 0)).map((x) => x.textContent);
    // every text of the data cards is plain text: no element came from the data as markup
    out.html = q('.cv-dt *').some((e) => e.tagName === 'SCRIPT' || e.tagName === 'IFRAME' || e.tagName === 'A');
    return out;
  })()`;

  test('data cards: coins as a list and one large, games of a team, a league and the NBA, quotes as a list and a ticker', async () => {
    const { value: v, errors } = await open('preset=canvas&shot=data&lang=en', DATA);
    assert.deepEqual(errors, []);
    assert.deepEqual(v.coins.map((c) => c[0]), ['BTC', 'ETH', 'SOL', 'ADA']);
    assert.match(v.coins[0][1], /61,250/);
    assert.deepEqual(v.coins.map((c) => c[2]), ['down', 'up', 'up', 'down'], '7 day change, red down and green up');
    assert.ok(v.coins.every((c) => c[3]), 'a curve on each row');
    assert.equal(v.range, '7 days');
    assert.deepEqual(v.big.slice(0, 3), [true, '€61,250', true]);
    assert.equal(v.big[3], '30 days');
    assert.deepEqual(v.groups, ['Real Madrid', 'Premier League']);
    assert.deepEqual(v.live[0], ['2 – 1', "67'"]);
    assert.ok(v.crests > 0, 'the demo draws initials on the team colour where there is no crest');
    assert.equal(v.nba, 3);
    assert.deepEqual(v.quotes, ['AAPL', 'MSFT', 'NVDA', 'SPY']);
    assert.deepEqual(v.ticker, ['AAPL', 'MSFT', 'NVDA']);
    assert.equal(v.html, false);
  });

  const CONFIRM = `(async () => {
    const card = (i) => document.querySelectorAll('.cv-item[data-kind="ha.switch"] .cv-body')[i];
    // the icon and the name switch it (no switch row); the card's tone says whether it is on
    const pill = (i) => card(i).querySelector('.cv-ha-tile.is-tap');
    const on = (i) => String(card(i).dataset.tone === 'on');
    const ev = (el, type) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, clientX: 1, clientY: 1 }));
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = { night: document.documentElement.classList.contains('night'), before: on(0), coffee0: on(1) };
    // a dimmed screen: the first tap only wakes it
    ev(pill(1), 'pointerdown');
    ev(pill(1), 'pointerup');
    await pause(30);
    out.woke = !document.documentElement.classList.contains('night');
    out.coffee = on(1);
    // a door: one tap only asks for a second one
    ev(pill(0), 'pointerdown');
    ev(pill(0), 'pointerup');
    await pause(30);
    out.ask = card(0).querySelector('.cv-ha-toast')?.textContent ?? '';
    out.afterOne = on(0);
    await pause(650);
    ev(pill(0), 'pointerdown');
    ev(pill(0), 'pointerup');
    await pause(30);
    out.afterTwo = on(0);
    // press and hold: it goes once the 0.7 s have passed, and the lift does not count as a tap
    await pause(650);
    ev(pill(0), 'pointerdown');
    await pause(850);
    out.held = on(0);
    ev(pill(0), 'pointerup');
    await pause(30);
    out.afterLift = on(0);
    out.toast = card(0).querySelector('.cv-ha-toast')?.textContent ?? '';
    return out;
  })()`;

  test('a door-like entity needs a second tap or a press and hold; on a dimmed screen the first tap only wakes it', async () => {
    const { value: v, errors } = await open('preset=canvas&shot=confirm&lang=en&night=1', CONFIRM);
    assert.deepEqual(errors, []);
    assert.equal(v.night, true);
    assert.equal(v.woke, true, 'the tap lifted the dimming');
    assert.equal(v.coffee, v.coffee0, 'the waking tap switched nothing');
    assert.equal(v.ask, 'Tap again or press and hold');
    assert.equal(v.afterOne, v.before, 'one tap does nothing');
    assert.notEqual(v.afterTwo, v.before, 'the second tap does it');
    assert.equal(v.held, v.before, 'holding switched it back');
    assert.equal(v.afterLift, v.held, 'the lift after a hold is not a tap');
    assert.equal(v.toast, '');
  });

  test('a saved widget is drawn in its card by the widget loader, once per item (the demo electricity prices)', async () => {
    const { value, errors } = await open('preset=canvas&shot=media', `[...document.querySelectorAll('.cv-item[data-kind="widget"]')].map((c) => c.querySelectorAll('.cv-media .uw-prices .pw').length)`);
    assert.deepEqual(errors, []);
    assert.deepEqual(value, [1, 1]);
  });

  test('an empty canvas shows one hint card; other layouts and the Classic style never show the canvas', async () => {
    const empty = await open('preset=canvas&shot=empty', LAYOUT);
    assert.equal(empty.value.items.length, 0);
    assert.equal(empty.value.hint, true);
    const other = await open('preset=bigCalendar', LAYOUT);
    assert.equal(other.value.canvasHidden, true);
    assert.equal(other.value.items.length, 0);
    const classic = await open('preset=canvas&style=classic', LAYOUT);
    assert.match(classic.value.app, /\bpreset-bigCalendar\b/);
    assert.equal(classic.value.canvasHidden, true);
  });

  const CLOCKS = `(() => {
    const q = (k) => document.querySelector('.cv-item[data-kind="' + k + '"]');
    const digital = q('clock.digital').querySelector('.hm').textContent;
    const flip = [...q('clock.flip').querySelectorAll('.fd')].map((d) => d.textContent).join('');
    const hour = q('clock.analog').querySelector('.hh').getAttribute('transform');
    const zones = [...q('clock.world').querySelectorAll('.cv-zone')].map((z) => [z.querySelector('.cv-zone-name').textContent, z.querySelector('.cv-zone-time').textContent, z.querySelector('.cv-zone-off').textContent]);
    return { digital, flip, hour, zones };
  })()`;

  test('every clock shows the wall time of its zone on both sides of a daylight saving change', async () => {
    // Madrid, 29 March 2026: 01:59 CET, then 03:01 CEST
    const before = await open('preset=canvas&shot=clocks&tz=Europe/Madrid&now=2026-03-29T00:59:00Z', CLOCKS);
    assert.deepEqual([before.value.digital, before.value.flip], ['01:59', '0159']);
    assert.equal(before.value.hour, 'rotate(59.5 100 100)');
    const afterDst = await open('preset=canvas&shot=clocks&tz=Europe/Madrid&now=2026-03-29T01:01:00Z', CLOCKS);
    assert.deepEqual([afterDst.value.digital, afterDst.value.flip], ['03:01', '0301']);
    assert.equal(afterDst.value.hour, 'rotate(90.5 100 100)');
    // New York, 1 November 2026: 01:30 twice (EDT, then EST)
    for (const now of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']) {
      const r = await open(`preset=canvas&shot=clocks&tz=Europe/Lisbon&now=${now}`, CLOCKS);
      assert.equal(r.value.zones[0][1], '01:30', now);
    }
    // Auckland is already tomorrow at noon (UTC) in Lisbon: "+1"
    const ak = await open('preset=canvas&shot=clocks&tz=Europe/Lisbon&now=2026-03-04T12:00:00Z', CLOCKS);
    assert.deepEqual(ak.value.zones[1], ['Auckland', '01:00', '+1']);
    assert.equal(ak.value.zones[0][2], '');
  });

  /** The demo as a normal screen (no lite: blur and the photo pipeline on); the half white, half black photo. */
  async function openFull(q, expr, size = { width: 1920, height: 1080 }) {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=look&photo=half&${q}`, size);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 2500)))');
      const value = await p.eval(expr);
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      return { value, errors };
    } finally {
      await p.close();
    }
  }
  const LOOK = `(() => ({
    html: document.documentElement.className,
    cards: [...document.querySelectorAll('.cv-item')].map((e) => {
      const c = e.querySelector('.cv-card');
      const r = e.getBoundingClientRect();
      return { kind: e.dataset.kind, x: r.left, area: r.width * r.height, cls: c.className, bf: getComputedStyle(c).backdropFilter, bg: getComputedStyle(c).backgroundColor, accent: getComputedStyle(c).getPropertyValue('--accent').trim() };
    }),
    blurred: [...document.querySelectorAll('*')].filter((e) => { const f = getComputedStyle(e).backdropFilter; return f && f !== 'none'; }).length,
  }))()`;

  test('each card has its own look: the ink follows the photo behind it, a custom tint and colour, an accent, every glass card blurred', async () => {
    const { value, errors } = await openFull('', LOOK);
    assert.deepEqual(errors, []);
    const card = (k) => value.cards.find((c) => c.kind === k);
    // automatic tint: the agenda (cells 0..3) sits on the white half, the message (cells 8..11) on the black half
    assert.ok(card('calendar.agenda').x < 400);
    assert.match(card('calendar.agenda').cls, /\bis-ink-dark\b/);
    assert.ok(card('message').x > 1200);
    assert.doesNotMatch(card('message').cls, /\bis-ink-dark\b/);
    assert.match(card('message').cls, /\bhas-own\b/);
    // a custom tint on its own glass, and a solid yellow card with dark text
    assert.match(card('todo').cls, /\bhas-color\b/);
    assert.match(card('todo').cls, /\bno-edge\b/);
    assert.match(card('todo').bg, /^rgba\(29, 43, 76, /);
    assert.equal(card('weather.now').bg, 'rgb(242, 201, 76)');
    assert.match(card('weather.now').cls, /\bis-ink-dark\b/);
    assert.equal(card('date').accent, '#34c759');
    // ten glass cards over the photo: every one is real glass (no card looks different from its neighbours)
    const glass = value.cards.filter((c) => /\bis-glass\b/.test(c.cls));
    assert.equal(glass.length, 10);
    assert.equal(glass.filter((c) => c.bf !== 'none').length, 10);
    for (const c of glass) assert.doesNotMatch(c.cls, /\bno-blur\b/);
    assert.doesNotMatch(value.html, /\blow-power\b/);
  });

  test('light theme: a card with its own dark material keeps white text and dark rows inside (no white panels)', async () => {
    const { value, errors } = await openFull('theme=light', `(() => [...document.querySelectorAll('.cv-card.has-own:not(.is-ink-dark):not(.is-none)')].map((c) => ({
      kind: c.closest('.cv-item').dataset.kind,
      color: getComputedStyle(c).color,
      white: [...c.querySelectorAll('*')].filter((e) => getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)').map((e) => e.className),
    })))()`, { width: 1080, height: 1920 });
    assert.deepEqual(errors, []);
    // in portrait the agenda (its own glass, automatic tint) sits on the black half
    assert.ok(value.some((c) => c.kind === 'calendar.agenda'), JSON.stringify(value));
    assert.ok(value.some((c) => c.kind === 'todo'), JSON.stringify(value));
    for (const c of value) {
      assert.match(c.color, /^rgba?\(255, 255, 255/, c.kind);
      assert.deepEqual(c.white, [], c.kind);
    }
  });

  test('nothing blurs in lite, with ?lowpower=1 or with "Rendimiento: Ahorro"; ?blur=1 brings the blur back', async () => {
    for (const q of ['lite=1', 'lowpower=1', 'perf=low']) {
      const { value, errors } = await openFull(q, LOOK);
      assert.deepEqual(errors, [], q);
      assert.equal(value.blurred, 0, q);
      assert.match(value.html, /\blow-power\b/, q);
    }
    const back = await openFull('perf=low&blur=1', LOOK);
    assert.equal(back.value.cards.filter((c) => c.bf !== 'none').length, 10);
    assert.doesNotMatch(back.value.html, /\blow-power\b/);
  });

  // the camera cards outside lite mode (in lite a picture comes every 10 s at the fastest)
  // `until`: on a slow machine, wait (up to 10 s more) until it is true
  async function openCams(q, ms, until = '') {
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=cameras&lang=en&${q}`, { width: 1920, height: 1080 });
    try {
      await p.eval(`new Promise((r) => setTimeout(r, ${ms}))`);
      for (let i = 0; until && i < 50 && !(await p.eval(until)); i++) await p.eval('new Promise((r) => setTimeout(r, 200))');
      const value = await p.eval(`(() => [...document.querySelectorAll('.cv-item[data-kind="ha.camera"]')].map((e) => {
        const b = e.querySelector('.cv-body');
        return { cls: b.className, empty: e.classList.contains('is-empty'), label: b.querySelector('.cv-cam-label').hidden ? '' : b.querySelector('.cv-cam-label').textContent,
          msg: b.querySelector('.cv-cam-msg').hidden ? '' : b.querySelector('.cv-cam-msg').textContent, on: b.querySelectorAll('.cv-cam-img.on').length,
          contain: b.querySelector('.cv-cam-stage').classList.contains('contain'), shown: [...b.querySelectorAll('.cv-cam-img.on')].map((i) => i.naturalWidth) };
      }))()`);
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((x) => !/vite|Vite/.test(x));
      return { value, errors };
    } finally {
      await p.close();
    }
  }

  test('Cámara cards: a picture with its name, a whole picture, live falls back to pictures in the demo, the sensor hides one', async () => {
    // every card's first picture shown
    const pictures = `[...document.querySelectorAll('.cv-item[data-kind="ha.camera"] .cv-body')].every((b) => b.classList.contains('has-frame') && [...b.querySelectorAll('.cv-cam-img.on')].some((i) => i.naturalWidth > 100))`;
    let { value: v, errors } = await openCams('', 1500, pictures);
    assert.deepEqual(errors, []);
    assert.equal(v.length, 3);
    for (const c of v) {
      assert.match(c.cls, /has-frame/);
      assert.equal(c.on, 1, 'one of the two images shows');
      assert.ok(c.shown[0] > 100, 'a decoded picture');
      assert.equal(c.msg, '');
      assert.doesNotMatch(c.cls, /is-live|is-nosig/);
    }
    assert.deepEqual(v.map((c) => c.label), ['Entrada', 'Jardín', '']);
    assert.deepEqual(v.map((c) => c.contain), [false, false, true]);
    assert.deepEqual(v.map((c) => c.empty), [false, false, false]);
    // the motion sensor off: that card is not drawn (its cell stays)
    ({ value: v, errors } = await openCams('cam=off', 1200));
    assert.deepEqual(errors, []);
    assert.deepEqual(v.map((c) => c.empty), [false, false, true]);
    // no pictures come: "No signal" after three
    ({ value: v, errors } = await openCams('cam=fail', 5200));
    assert.deepEqual(errors, []);
    assert.match(v[0].cls, /is-nosig/);
    assert.equal(v[0].msg, 'No signal');
  });

  test('Valor cards: the pushed value with its decimals and unit, how long ago, grey when stale, Sin datos, and a custom card bound to a key', async () => {
    const { value: v, errors } = await open('preset=canvas&shot=values&lang=en', `({
      cards: [...document.querySelectorAll('.cv-item[data-kind="value"] .cv-body')].map((b) => ({
        label: b.querySelector('.cv-val-label')?.textContent,
        num: b.querySelector('.cv-val-num b')?.textContent,
        unit: b.querySelector('.cv-val-unit')?.textContent ?? '',
        note: b.querySelector('.cv-val-note')?.textContent,
        stale: b.classList.contains('is-stale'),
      })),
      html: document.querySelector('.cv-item[data-kind="html"] iframe')?.srcdoc ?? '',
    })`);
    assert.deepEqual(errors, []);
    const [solar, washer, garage, mail, co2, pool, grid] = v.cards;
    assert.deepEqual(solar, { label: 'Solar hoy', num: '12.6', unit: 'kWh', note: '4 min ago', stale: false });
    assert.deepEqual([washer.num, washer.unit, washer.stale], ['Terminado', '', false]);
    assert.equal(garage.num, 'No');
    assert.deepEqual([mail.num, mail.note, mail.stale], ['2', '3 h ago', true], 'older than staleAfterMin: grey');
    assert.deepEqual([co2.num, co2.unit], ['612', 'ppm']);
    assert.deepEqual([pool.num, pool.note, pool.stale], ['–', 'No data', true]);
    assert.deepEqual([grid.label, grid.num, grid.unit], ['Red eléctrica', '-1.84', 'kW'], 'the label and unit sent with the value when the item has none');
    assert.match(v.html, /76 %/);
    assert.match(v.html, /Batería de casa/);
    assert.match(v.html, /width: 76%/);
  });

  test('custom HTML cards: a sandboxed frame per card, with the meta CSP, its bound values filled in and escaped, nothing to tap', async () => {
    const { value: v, errors } = await open('preset=canvas&shot=html&lang=en', `[...document.querySelectorAll('.cv-item[data-kind="html"]')].map((c) => {
      const f = c.querySelectorAll('iframe');
      const one = f[0];
      return {
        frames: f.length,
        sandbox: one?.getAttribute('sandbox'),
        allow: one?.getAttribute('allow'),
        referrer: one?.getAttribute('referrerpolicy'),
        tab: one?.tabIndex,
        pe: one ? getComputedStyle(one).pointerEvents : '',
        src: one?.getAttribute('src'),
        doc: one?.srcdoc ?? '',
        note: c.querySelector('.cv-html-note')?.textContent ?? '',
      };
    })`);
    assert.deepEqual(errors, []);
    assert.equal(v.length, 3);
    for (const c of v) {
      assert.equal(c.frames, 1, 'one frame once loaded (the old one is removed)');
      assert.equal(c.sandbox, '');
      assert.equal(c.allow, '');
      assert.equal(c.referrer, 'no-referrer');
      assert.equal(c.tab, -1);
      assert.equal(c.pe, 'none');
      assert.equal(c.src, null);
      assert.equal(c.note, '');
      assert.ok(c.doc.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'">`));
      assert.equal(/<script|<a |<meta http-equiv="refresh"|https?:/i.test(c.doc.replace(/http-equiv="Content-Security-Policy"[^>]*>/, '')), false);
    }
    // the big temperature: the demo's sensor, its unit and how long ago it changed
    assert.match(v[0].doc, /<div class="v">21\.4<small>°C<\/small><\/div>/);
    assert.match(v[0].doc, /Temperatura · \d+ min ago/);
    // the time, the weather, a bar that follows the humidity (a plain number in style)
    assert.match(v[1].doc, /<h2>\d{2}:\d{2}<\/h2>/);
    assert.match(v[1].doc, /style="width: 48%"/);
    // the rooms: a binary sensor's state in words, its on/off as a class
    assert.match(v[2].doc, /<li class="door-off"><span>Puerta de la calle<\/span><b>Closed<\/b><\/li>/);
  });

  test('two calendar cards with different calendars each show only their own events', async () => {
    const { value, errors } = await open('preset=canvas&shot=calendars&now=2026-03-04T10:43', `(async () => {
      const [{ mockEvents }, { normalizeEvents }] = await Promise.all([import('/display/mock.ts'), import('/display/eventModel.ts')]);
      const evs = normalizeEvents(mockEvents(new Date(Date.parse('2026-03-04T10:43'))).events, 'Europe/Lisbon');
      const titles = (src) => [...new Set(evs.filter((e) => e.ev.sourceId === src).map((e) => e.title))];
      const card = (id) => [...document.querySelectorAll('[data-canvas-item="' + id + '"] .ag-tt')].map((e) => e.textContent);
      return { work: titles('c_work'), kids: titles('c_kids'), a: card('cv_demo0000'), b: card('cv_demo0001') };
    })()`);
    assert.deepEqual(errors, []);
    assert.ok(value.a.length > 0 && value.b.length > 0, JSON.stringify(value));
    for (const t of value.a) assert.ok(value.work.includes(t), `"${t}" is not a Work event`);
    for (const t of value.b) assert.ok(value.kids.includes(t), `"${t}" is not a Lucía & Mateo event`);
  });
});
