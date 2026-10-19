// The browser sweep of display-canvas-density*.test.js: every card of the registry at boxes of its own on the fine
// grid and the old one, in each density (one file per pass, so the passes run side by side; each takes minutes on a
// CI runner). See display-canvas-density.test.js for what is checked.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CANVAS_KINDS, boxOf, canvasDefaults, cellRange, fullLookMin, kindFor, posCells } from '../core/canvasCore.js';
import { flexSamples } from './flexSizes.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

// the same check as the normal grid's sweep (one source of truth for "fits")
const CHECK = eval(fs.readFileSync(new URL('./display-canvas-flex.test.js', import.meta.url), 'utf8').match(/const CHECK = (`[\s\S]*?`);/)[1]);

/**
 * The samples of a kind: flexSamples over its whole range, then the largest box still smaller than its full look
 * (the last box drawn in its compact look), "WxH", when that is a box of its own the kind allows.
 */
function fineSamples(kind, o) {
  const list = flexSamples(kind, o, 'fine');
  const k = kind === 'rotator' ? kindFor({ kind, props: canvasDefaults(kind) }) : kind;
  const f = cellRange(k, o);
  const [fw, fh] = fullLookMin(k, o);
  const w = Math.max(f.minW, Math.min(f.maxW, fw - 1));
  const h = Math.max(f.minH, Math.min(f.maxH, fh - 1));
  // as the box the kind takes there (the scenes: 6×3, not 4×3)
  const [bw, bh] = posCells(boxOf(k, w, h, o), o);
  return [...list, `${bw}x${bh}`];
}
/** True when a w×h box of `kind` is drawn in its compact look (canvas.ts miniMark). */
function isMini(kind, o, cells) {
  const [w, h] = cells.split('x').map(Number);
  const [fw, fh] = fullLookMin(kind, o);
  return w < fw || h < fh;
}

const LAND = { width: 1920, height: 1080 };
const PORT = { width: 1080, height: 1920 };
/**
 * The screens of each pass: a grid, a density, and which samples (flexSamples order: min, max, tall, wide, mid, min+1;
 * on the fine grid then the largest compact box, fineSamples).
 */
const PASSES = [
  // the fine grid in Densidad compacta: everything, both orientations, and with a wide sidebar (smaller cells)
  { flags: 'fine:compact', grid: 'fine', screens: [
    { o: 'landscape', side: 'none', size: LAND, pick: (l) => l },
    { o: 'portrait', side: 'none', size: PORT, pick: (l) => [l[0], l[1], l[4], l[6]].filter(Boolean) },
    { o: 'landscape', side: 'left', size: LAND, pick: (l) => [l[0], l[2], l[5], l[6]].filter(Boolean) },
  ] },
  // the fine grid with the normal density: the smallest boxes (where the padding counts most), the compact ones and
  // one in between, with a wide sidebar too
  { flags: 'fine', grid: 'fine', screens: [
    { o: 'landscape', side: 'none', size: LAND, pick: (l) => [l[0], l[3], l[4], l[5], l[6]].filter(Boolean) },
    { o: 'portrait', side: 'none', size: PORT, pick: (l) => [l[0], l[6]].filter(Boolean) },
    { o: 'landscape', side: 'left', size: LAND, pick: (l) => [l[0], l[5], l[6]].filter(Boolean) },
  ] },
  // the boxes of a screen made on the old grid, in Densidad compacta: the smallest and the largest
  { flags: 'compact', grid: 'legacy', screens: [
    { o: 'landscape', side: 'none', size: LAND, pick: (l) => [l[0], l[1], l[3]].filter(Boolean) },
    { o: 'portrait', side: 'none', size: PORT, pick: (l) => [l[0]] },
  ] },
];

/** The sweep of the passes named in `only` (PASSES flags), in a browser; skipped without Chrome. */
export function densitySweep(only) {
  const chrome = findChrome();
  describe(`every card fits, ${only.join(', ')}, in a browser`, { skip: !chrome && 'no Chrome' }, () => {
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
    for (const pass of PASSES.filter((p) => only.includes(p.flags))) {
      test(`${pass.flags}: every card fits at the smallest, the largest and boxes in between`, { timeout: 1_800_000 }, async () => {
        const jobs = [];
        for (const kind of kinds) {
          for (const sc of pass.screens) {
            const list = pass.grid === 'fine' ? fineSamples(kind, sc.o) : flexSamples(kind, sc.o);
            for (const sz of new Set(sc.pick(list))) jobs.push({ shot: `size:${kind}:${sz}:${sc.o}:${sc.side}:ambient:${pass.flags}`, size: sc.size, kind, o: sc.o, sz, grid: pass.grid });
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
              // the compact look exactly on the boxes only the fine grid has (a Rotativa's cards: on their slides)
              const mini = j.kind !== 'rotator' && isMini(j.kind, j.o, j.sz);
              const marks = await p.eval(`[...document.querySelectorAll('.cv-item:not([hidden]) > .cv-card > .cv-body')].map((b) => b.dataset.mini !== undefined)`);
              if (j.kind !== 'rotator' && marks.some((m) => m !== mini)) bad.push(`${j.shot}: data-mini ${marks.join(',')}, expected ${mini}`);
              // the density reached the page
              const ok = await p.eval(`document.getElementById('app').classList.contains('cv-dense') === ${pass.flags.includes('compact')}`);
              if (!ok) bad.push(`${j.shot}: density class missing`);
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
  });
}
