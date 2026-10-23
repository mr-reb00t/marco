// Issue #21 in a browser: how a Rotativa goes from one card to the next ("Transición": a crossfade, a slide, a cut)
// and the busy days of the calendar paging through their events. A slow device (&lowpower=1, as a Raspberry Pi is
// found) keeps both moving: only lite mode, the screen's "Ahorro" (&perf=low) and "Ninguna" make the Rotativa cut.
// A redraw of the grid keeps the page on show, with no page appearing for a moment and fading out again.
// Checked by class, computed style and transition events, never by timing a frame. Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

const LAND = { width: 1920, height: 1080 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The first Rotativa: its classes and, for each slide, its classes and computed transition and animation. */
const ROT = `(() => {
  const r = document.querySelector('.cv-item[data-kind="rotator"] .cv-rot');
  if (!r) return null;
  return {
    html: document.documentElement.className,
    slide: r.classList.contains('tr-slide'),
    still: r.classList.contains('no-motion'),
    slides: [...r.querySelectorAll(':scope > .cv-rot-slide')].map((s) => {
      const cs = getComputedStyle(s);
      return { on: s.classList.contains('is-on'), in: s.classList.contains('is-in'), out: s.classList.contains('is-out'), tr: cs.transitionDuration, anim: cs.animationName };
    }),
  };
})()`;

const chrome = findChrome();
describe('transitions of the Rotativa and the busy days (#21), in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  // a background tab runs no animation frames: each page is brought to the front while it is looked at
  const open = async (q) => {
    const p = await browser.page(`${web.url}/?demo=1&now=2026-10-14T10:43${q}`, LAND);
    await p.send('Page.bringToFront');
    await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))');
    return p;
  };

  test('Rotativa: the fade on a slow device, a cut with Ahorro, in lite mode and with Ninguna', { timeout: 90_000 }, async () => {
    const cases = [
      ['&lowpower=1', { still: false, slide: false, tr: '0.9s' }],
      ['&lowpower=1&rottr=fade', { still: false, slide: false, tr: '0.9s' }],
      ['&perf=low', { still: true, slide: false, tr: '0s' }],
      ['&lite=1', { still: true, slide: false, tr: '0s' }],
      ['&rottr=none', { still: true, slide: false, tr: '0s' }],
      ['&lite=1&rottr=slide', { still: true, slide: false, tr: '0s' }],
    ];
    for (const [q, want] of cases) {
      const p = await open(`&preset=canvas&shot=size:rotator:l${q}`);
      try {
        const r = await p.eval(ROT);
        const msg = `${q} ${JSON.stringify(r)}`;
        assert.ok(r && r.slides.length >= 2, msg);
        if (q.includes('lowpower')) assert.match(r.html, /\blow-power\b/, msg);
        assert.equal(r.still, want.still, msg);
        assert.equal(r.slide, want.slide, msg);
        assert.equal(r.slides.filter((s) => s.on).length, 1, msg);
        assert.ok(r.slides.every((s) => s.tr === want.tr), msg);
      } finally {
        await p.close();
      }
    }
  });

  test('Rotativa: Deslizar on a slow device, the new card slides in while the old one slides out', { timeout: 90_000 }, async () => {
    const p = await open('&preset=canvas&shot=size:rotator:l&lowpower=1&rottr=slide');
    try {
      let r = await p.eval(ROT);
      assert.match(r.html, /\blow-power\b/);
      assert.deepEqual([r.slide, r.still], [true, false], JSON.stringify(r));
      // the first card does not slide in
      assert.ok(r.slides.every((s) => !s.in && !s.out && s.anim === 'none'), JSON.stringify(r));
      // past its five seconds (the demo's everySec): the next one comes in, the first goes out
      const first = r.slides.findIndex((s) => s.on);
      for (let i = 0; i < 40; i++) {
        await wait(250);
        r = await p.eval(ROT);
        if (!r.slides[first].on) break;
      }
      const msg = JSON.stringify(r);
      const now = r.slides.findIndex((s) => s.on);
      assert.notEqual(now, first, msg);
      assert.deepEqual([r.slides[now].in, r.slides[now].anim], [true, 'cv-rot-in'], msg);
      assert.deepEqual([r.slides[first].out, r.slides[first].anim], [true, 'cv-rot-out'], msg);
      assert.ok(r.slides.filter((_, i) => i !== now && i !== first).every((s) => s.anim === 'none'), msg);
    } finally {
      await p.close();
    }
  });

  test('busy days fade on a slow device, on a Personalizado month card too', { timeout: 60_000 }, async () => {
    for (const q of ['&busy=1&lowpower=1', '&busy=1&compact=0&lowpower=1', '&preset=canvas&shot=size:calendar.month:xl&busy=1&lowpower=1']) {
      const p = await open(q);
      try {
        const r = await p.eval(`(() => {
          const els = [...document.querySelectorAll('.pg, .cpg')];
          return { html: document.documentElement.className, n: els.length, tr: [...new Set(els.map((e) => getComputedStyle(e).transitionDuration))] };
        })()`);
        const msg = `${q} ${JSON.stringify(r)}`;
        assert.ok(r.n > 1, msg);
        if (q.includes('canvas')) assert.match(r.html, /\blow-power\b/, msg);
        assert.deepEqual(r.tr, ['0.7s, 0s'], msg);
      } finally {
        await p.close();
      }
    }
  });

  test('a redraw of the grid keeps the page on show: no other page fades in and out', { timeout: 90_000 }, async () => {
    const p = await open('&busy=1&lowpower=1');
    try {
      // every page of every busy day (shown or not), and the opacity transitions that start on them
      const PAGES = `JSON.stringify([...document.querySelectorAll('.cpg')].map((e) => e.dataset.day + ':' + e.dataset.pg + ':' + e.classList.contains('pg-off')))`;
      await p.eval(`(() => {
        window.__runs = [];
        document.addEventListener('transitionrun', (e) => {
          if (e.propertyName === 'opacity' && e.target.matches('.cpg, .ev.pg')) window.__runs.push(e.target.className);
        }, true);
      })()`);
      // a page turn (every 8 s) fades: on a slow device too
      for (let i = 0; i < 48 && !(await p.eval('window.__runs.length')); i++) await wait(250);
      assert.ok(await p.eval('window.__runs.length') > 0, 'no page turn faded');
      await wait(1000);
      const before = await p.eval(PAGES);
      await p.eval('window.__runs = []');
      // a narrower window: the grid is drawn again (its stacks written anew)
      await p.send('Emulation.setDeviceMetricsOverride', { width: 1900, height: 1080, deviceScaleFactor: 1, mobile: false });
      await wait(1200);
      const after = await p.eval(PAGES);
      // (only when the pages came out the same: a redraw that lays them out differently may turn them)
      if (after === before) assert.deepEqual(await p.eval('window.__runs'), []);
      else assert.fail(`the pages changed with the width: ${before} ${after}`);
    } finally {
      await p.close();
    }
  });
});
