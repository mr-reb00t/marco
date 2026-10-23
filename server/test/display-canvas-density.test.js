// Personalizado, issue #9 in a browser: every card at boxes of its own on the grid (24×16, 16×24) and in Densidad
// compacta, at the smallest, the largest and boxes in between (canvasCore cellRange, the small minimums included),
// with no "No cabe" and no text cut by the card's edge, the way display-canvas-flex.test.js checks the boxes a screen
// of the old 12×8 grid had. Every kind's minimum (its compact look, data-mini) and the largest box still below its full
// look (fullLookMin) are drawn in both densities, landscape, portrait and next to a wide sidebar. And the Rotativa on
// the screen: one card on show at a time, its dots, the next card after its seconds, no fade in lite mode. The
// Indicador at its 3×1 and 2×1 (#9): its name and number on one line over the bar, or the number and the bar alone.
// Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChrome, launchChrome, startWeb } from './browser.js';
import { densitySweep } from './densitySweep.js';

const LAND = { width: 1920, height: 1080 };
const PORT = { width: 1080, height: 1920 };
// the same check as the normal grid's sweep (one source of truth for "fits")
const CHECK = eval(fs.readFileSync(new URL('./display-canvas-flex.test.js', import.meta.url), 'utf8').match(/const CHECK = (`[\s\S]*?`);/)[1]);

// the old grid's boxes in Densidad compacta here; the fine grid in display-canvas-density-fine*.test.js
densitySweep(['compact']);

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

  test('the grid is 24×16 cells over the screen, a named size the rectangle it always was, and compact cards sit closer', async () => {
    const at = async (flags) => {
      const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=size:clock.digital:m:landscape:none:ambient${flags ? `:${flags}` : ''}`, LAND);
      try {
        await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 600)))');
        return await p.eval(`(() => {
          const c = document.getElementById('canvas');
          const cs = getComputedStyle(c);
          const r = [...document.querySelectorAll('.cv-item')].map((e) => e.getBoundingClientRect());
          const inner = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          return { cols: cs.gridTemplateColumns.split(' ').length, rows: cs.gridTemplateRows.split(' ').length, gap: parseFloat(cs.columnGap), inner, w: r[0].width, h: r[0].height, x2: r[1]?.left ?? 0, x1: r[0].right };
        })()`);
      } finally {
        await p.close();
      }
    };
    const normal = await at('');
    const dense = await at('compact');
    assert.deepEqual([normal.cols, normal.rows], [24, 16]);
    // a medium card is 4×3 cells of the old 12×8 grid: a third of the width less the gaps, as before
    const cw = (normal.inner - 11 * normal.gap) / 12;
    assert.ok(Math.abs(normal.w - (4 * cw + 3 * normal.gap)) < 1.5, JSON.stringify({ normal, cw }));
    // Densidad compacta: half the gap between cards, and larger cards in the same cells
    assert.ok(dense.gap < normal.gap * 0.6 && dense.w > normal.w, JSON.stringify({ normal, dense }));
  });

  test('Indicador at 3×1 and 2×1 (#9): the name and the number on one line over the bar, or the number and the bar alone, never cut', { timeout: 400_000 }, async () => {
    // each gauge: its name shown whole (or left out), on the number's line, the bar under both
    const LOOK = `[...document.querySelectorAll('.cv-item[data-kind="ha.gauge"] .cv-ha-gauge')].map((g) => {
      const r = (q) => g.querySelector(q)?.getBoundingClientRect() ?? null;
      const name = g.querySelector('.cv-ha-head .cv-ha-name');
      const head = r('.cv-ha-head');
      const shown = !!head && head.width > 0 && getComputedStyle(g.querySelector('.cv-ha-head')).display !== 'none';
      const u = g.querySelector('.cv-ha-big .u');
      const v = g.querySelector('.cv-ha-big .v');
      return { noname: g.classList.contains('is-noname'), nounit: g.classList.contains('is-nounit'), unit: !!u && getComputedStyle(u).display !== 'none', hasUnit: !!u, num: v?.textContent ?? '', vr: v?.getBoundingClientRect() ?? null, shown, whole: !shown || name.scrollWidth <= name.clientWidth + 1, head, big: r('.cv-ha-big'), bar: r('.cv-ha-gaugebar'), body: g.getBoundingClientRect() };
    })`;
    const bad = [];
    let names = 0;
    for (const flags of ['', ':compact']) {
      for (const [o, side, size] of [['landscape', 'none', LAND], ['portrait', 'none', PORT], ['landscape', 'left', LAND]]) {
        for (const sz of ['2x1', '3x1', '3x2', '4x1']) {
          const shot = `size:ha.gauge:${sz}:${o}:${side}:ambient${flags}`;
          const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=${shot}`, size);
          try {
            await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 900)))');
            for (const c of await p.eval(CHECK)) {
              if (c.cramped) bad.push(`${shot}: does not fit`);
              if (c.cut.length) bad.push(`${shot}: cuts ${c.cut.join(', ')}`);
            }
            if (sz !== '3x1' && sz !== '2x1') continue;
            const looks = await p.eval(LOOK);
            if (!looks.length) bad.push(`${shot}: no gauges`);
            for (const g of looks) {
              if (g.shown === g.noname) bad.push(`${shot}: name ${g.shown ? 'shown' : 'hidden'} but is-noname ${g.noname}`);
              if (!g.whole) bad.push(`${shot}: name cut`);
              if (g.shown) {
                names++;
                // on the number's line: the two overlap in height
                if (g.head.bottom < g.big.top || g.head.top > g.big.bottom) bad.push(`${shot}: name not beside the number`);
              }
              // the bar under the number and the name, across the card
              if (!g.bar || g.bar.top < g.big.bottom - 1 || (g.shown && g.bar.top < g.head.bottom - 1)) bad.push(`${shot}: bar not under the line`);
              if (g.bar && g.bar.width < g.body.width * 0.6) bad.push(`${shot}: bar too short`);
              // the number always there, inside the card and readable; its unit shown or left out whole
              if (!g.num || !g.vr || g.vr.width < 1) bad.push(`${shot}: no number`);
              else if (g.vr.left < g.body.left - 1 || g.vr.right > g.body.right + 1) bad.push(`${shot}: number out of the card`);
              else if (g.vr.height < g.body.height * 0.25) bad.push(`${shot}: number too small (${Math.round(g.vr.height)} of ${Math.round(g.body.height)})`);
              if (g.big && (g.big.right > g.body.right + 1 || g.big.left < g.body.left - 1)) bad.push(`${shot}: number and unit out of the card`);
              if (g.hasUnit && g.unit === g.nounit) bad.push(`${shot}: unit ${g.unit ? 'shown' : 'hidden'} but is-nounit ${g.nounit}`);
              if (sz === '3x1' && g.nounit) bad.push(`${shot}: unit left out at 3×1`);
            }
          } finally {
            await p.close();
          }
        }
      }
    }
    assert.deepEqual(bad, []);
    // the short names ("Humedad", "Fuera") are read on the wide screens
    assert.ok(names > 6, `names shown: ${names}`);
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
    const p = await browser.page(`${web.url}/?demo=1&preset=canvas&shot=size:rotator:12x4:landscape:none:ambient:compact`, LAND);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const a = await p.eval(state);
      assert.ok(a.length >= 1);
      for (const r of a) {
        assert.equal(r.slides, 2, 'one slide per card');
        // (on a slow machine the first change can come before this first look: the card on show and its dot match)
        assert.ok(r.on === 0 || r.on === 1, 'one card on show');
        assert.equal(r.dots, 2);
        assert.equal(r.dotOn, r.on);
        assert.equal(r.still, false, 'a soft fade on a normal screen');
        assert.ok(r.kinds, 'the cards are drawn');
      }
      // every five seconds (the fixture's "Cambiar cada"): the next card, and the dot follows
      let b = a;
      for (let i = 0; i < 24 && b.every((r, n) => r.on === a[n].on); i++) {
        await p.eval('new Promise((r) => setTimeout(r, 500))');
        b = await p.eval(state);
      }
      for (const [n, r] of b.entries()) assert.deepEqual([r.on, r.dotOn], [(a[n].on + 1) % 2, (a[n].on + 1) % 2]);
    } finally {
      await p.close();
    }
    // lite mode: the cards change with no fade
    const q = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=size:rotator:12x4:landscape:none:ambient`, LAND);
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
