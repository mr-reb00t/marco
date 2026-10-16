// Personalizado, issue #9 in a browser: every card at boxes of its own on the fine grid (24×16, 16×24) and in
// Densidad compacta, at the smallest, the largest and boxes in between (canvasCore cellRange on each grid, the fine
// minimums included), with no "No cabe" and no text cut by the card's edge, the way display-canvas-flex.test.js checks
// the normal grid. And the Rotativa on the screen: one card on show at a time, its dots, the next card after its
// seconds, no fade in lite mode. Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CANVAS_KINDS } from '../core/canvasCore.js';
import { flexSamples } from './flexSizes.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

// the same check as the normal grid's sweep (one source of truth for "fits")
const CHECK = eval(fs.readFileSync(new URL('./display-canvas-flex.test.js', import.meta.url), 'utf8').match(/const CHECK = (`[\s\S]*?`);/)[1]);

const LAND = { width: 1920, height: 1080 };
const PORT = { width: 1080, height: 1920 };
/** The screens of each pass: a grid, a density, and which samples (flexSamples order: min, max, tall, wide, mid, min+1). */
const PASSES = [
  // the fine grid in Densidad compacta: everything, both orientations, and with a wide sidebar (smaller cells)
  { flags: 'fine:compact', grid: 'fine', screens: [
    { o: 'landscape', side: 'none', size: LAND, pick: (l) => l },
    { o: 'portrait', side: 'none', size: PORT, pick: (l) => [l[0], l[1], l[4]].filter(Boolean) },
    { o: 'landscape', side: 'left', size: LAND, pick: (l) => [l[0], l[2]].filter(Boolean) },
  ] },
  // the fine grid with the normal density: the smallest boxes (where the padding counts most) and one in between
  { flags: 'fine', grid: 'fine', screens: [
    { o: 'landscape', side: 'none', size: LAND, pick: (l) => [l[0], l[3], l[4], l[5]].filter(Boolean) },
    { o: 'portrait', side: 'none', size: PORT, pick: (l) => [l[0]] },
  ] },
  // the normal grid in Densidad compacta: the smallest and the largest boxes
  { flags: 'compact', grid: 'normal', screens: [
    { o: 'landscape', side: 'none', size: LAND, pick: (l) => [l[0], l[1], l[3]].filter(Boolean) },
    { o: 'portrait', side: 'none', size: PORT, pick: (l) => [l[0]] },
  ] },
];

const chrome = findChrome();
describe('fine grid, compact density and the Rotativa, in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  const kinds = Object.keys(CANVAS_KINDS).filter((k) => !CANVAS_KINDS[k].reserved && k !== 'spacer');
  for (const pass of PASSES) {
    test(`${pass.flags}: every card fits at the smallest, the largest and boxes in between`, { timeout: 1_800_000 }, async () => {
      const jobs = [];
      for (const kind of kinds) {
        for (const sc of pass.screens) {
          for (const sz of sc.pick(flexSamples(kind, sc.o, pass.grid))) jobs.push({ shot: `size:${kind}:${sz}:${sc.o}:${sc.side}:ambient:${pass.flags}`, size: sc.size });
        }
      }
      const bad = [];
      let next = 0;
      await Promise.all(Array.from({ length: 5 }, async () => {
        while (next < jobs.length) {
          const j = jobs[next++];
          const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=${j.shot}`, j.size);
          try {
            await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 900)))');
            const cards = await p.eval(CHECK);
            if (!cards.length) bad.push(`${j.shot}: no cards`);
            for (const c of cards) {
              if (c.cramped) bad.push(`${j.shot}: does not fit`);
              if (c.cut.length) bad.push(`${j.shot}: cuts ${c.cut.join(', ')}`);
            }
            // the grid and the density reached the page
            const ok = await p.eval(`(() => { const a = document.getElementById('app'); return a.classList.contains('cv-fine') === ${pass.grid === 'fine'} && a.classList.contains('cv-dense') === ${pass.flags.includes('compact')}; })()`);
            if (!ok) bad.push(`${j.shot}: grid or density classes missing`);
            const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
            if (errors.length) bad.push(`${j.shot}: ${errors.join(' ')}`);
          } finally {
            await p.close();
          }
        }
      }));
      assert.deepEqual([...new Set(bad)].sort(), []);
    });
  }

  test('the fine grid draws 24×16 cells over the same screen, and compact cards sit closer', async () => {
    const at = async (flags) => {
      const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=size:clock.digital:m:landscape:none:ambient${flags ? `:${flags}` : ''}`, LAND);
      try {
        await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 600)))');
        return await p.eval(`(() => {
          const c = document.getElementById('canvas');
          const cs = getComputedStyle(c);
          const r = [...document.querySelectorAll('.cv-item')].map((e) => e.getBoundingClientRect());
          return { cols: cs.gridTemplateColumns.split(' ').length, rows: cs.gridTemplateRows.split(' ').length, gap: parseFloat(cs.columnGap), w: r[0].width, h: r[0].height, x2: r[1]?.left ?? 0, x1: r[0].right };
        })()`);
      } finally {
        await p.close();
      }
    };
    const normal = await at('');
    const fine = await at('fine');
    const dense = await at('compact');
    assert.deepEqual([normal.cols, normal.rows], [12, 8]);
    assert.deepEqual([fine.cols, fine.rows], [24, 16]);
    // a named size is the same rectangle on both grids
    assert.ok(Math.abs(normal.w - fine.w) < 1 && Math.abs(normal.h - fine.h) < 1, JSON.stringify({ normal, fine }));
    // Densidad compacta: half the gap between cards, and larger cards in the same cells
    assert.ok(dense.gap < normal.gap * 0.6 && dense.w > normal.w, JSON.stringify({ normal, dense }));
  });

  test('Rotativa: one card on show, its dots, the next card after its seconds, and no fade in lite mode', { timeout: 120_000 }, async () => {
    const state = `[...document.querySelectorAll('.cv-item[data-kind="rotator"]')].map((e) => ({
      slides: e.querySelectorAll('.cv-rot-slide').length,
      on: [...e.querySelectorAll('.cv-rot-slide')].findIndex((s) => s.classList.contains('is-on')),
      shown: [...e.querySelectorAll('.cv-rot-slide')].filter((s) => getComputedStyle(s).opacity !== '0').length,
      dots: e.querySelectorAll('.cv-rot-dots i').length,
      dotOn: [...e.querySelectorAll('.cv-rot-dots i')].findIndex((d) => d.classList.contains('is-on')),
      still: e.querySelector('.cv-rot').classList.contains('no-motion'),
      kinds: [...e.querySelectorAll('.cv-rot-slide > *')].length > 0,
    }))`;
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=size:rotator:12x4:landscape:none:ambient:fine:compact`, LAND);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const a = await p.eval(state);
      assert.ok(a.length >= 1);
      for (const r of a) {
        assert.equal(r.slides, 2, 'one slide per card');
        assert.equal(r.on, 0, 'the first card first');
        assert.equal(r.dots, 2);
        assert.equal(r.dotOn, 0);
        assert.equal(r.still, false, 'a soft fade on a normal screen');
        assert.ok(r.kinds, 'the cards are drawn');
      }
      // every five seconds (the fixture's "Cambiar cada"): the next card, and the dot follows
      await p.eval('new Promise((r) => setTimeout(r, 6000))');
      const b = await p.eval(state);
      for (const r of b) assert.deepEqual([r.on, r.dotOn], [1, 1]);
    } finally {
      await p.close();
    }
    // lite mode: the cards change with no fade
    const q = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=size:rotator:12x4:landscape:none:ambient:fine`, LAND);
    try {
      await q.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 900)))');
      for (const r of await q.eval(state)) {
        assert.equal(r.still, true);
        assert.equal(r.shown, 1, 'only the card on show is visible');
      }
    } finally {
      await q.close();
    }
  });
});
