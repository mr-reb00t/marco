// A photo card behind the cards on the display (#41), in headless Chrome (skipped without a browser):
// - cards over a photo out to the screen's edge in the left column (the issue's setup) sit centred on it: the same
//   margin on the left and on the right of the visible photo, in both densities (canvasCore photoInsets, data-inset);
// - a photo card in the sidebar fills the whole bar behind its cards (sideBackdropId, .is-backdrop): it takes no place
//   in the stack, the cards are drawn over it, and the bar's glass sheet is not drawn (cv-fill-card); with "Hasta el
//   borde de la pantalla" it reaches the bar's edges, else it sits inside the bar's gaps, and the cards' margins over
//   it match on each axis.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

const URL_OF = (web, shot, o) => `${web.url}/?demo=1&lite=1&lang=en&now=2026-11-05T10:00&preset=canvas&shot=${shot}&orientation=${o}`;
const WAIT = `for (let i = 0; i < 80 && !document.querySelector('.cv-item[data-kind="clock.digital"] .clock .d'); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));`;

describe('a photo card behind the cards, centred and in the sidebar', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  test('cards over a photo out to the edge in the left column sit centred on it, in both densities', { timeout: 90_000 }, async () => {
    for (const dense of [false, true]) {
      const p = await browser.page(URL_OF(web, 'behindColumn', 'landscape'), { width: 1920, height: 1080 });
      try {
        const r = await p.eval(`(async () => {
          ${WAIT}
          // "Densidad compacta": the class the display sets for canvas.density 'compact'
          if (${dense}) document.getElementById('app').classList.add('cv-dense');
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const ph = document.querySelector('.cv-item[data-kind="photo"]').getBoundingClientRect();
          const pad = parseFloat(getComputedStyle(document.getElementById('canvas')).paddingLeft);
          const on = [...document.querySelectorAll('.cv-item:not([data-kind="photo"])')].filter((e) => {
            const c = e.getBoundingClientRect();
            return c.left >= ph.left - 1 && c.right <= ph.right + 1;
          });
          const rects = on.map((e) => ({ kind: e.dataset.kind, inset: e.dataset.inset || '', ...JSON.parse(JSON.stringify(e.getBoundingClientRect())) }));
          return { pad, photo: { left: ph.left, right: ph.right }, rects };
        })()`);
        const tag = dense ? 'compact' : 'normal';
        assert.equal(r.rects.length, 4, `${tag}: ${JSON.stringify(r)}`);
        // the photo reaches the screen's left edge
        assert.ok(Math.abs(r.photo.left) < 1, `${tag}: ${JSON.stringify(r.photo)}`);
        // each card across the photo's full columns: the same margin on both sides, the grid's padding
        for (const c of r.rects.filter((x) => x.kind !== 'value')) {
          const L = c.left - r.photo.left;
          const R = r.photo.right - c.right;
          assert.ok(Math.abs(L - R) < 1, `${tag} ${c.kind}: ${L} / ${R}`);
          assert.ok(Math.abs(L - r.pad) < 1, `${tag} ${c.kind}: ${L} / pad ${r.pad}`);
        }
        // the two cards side by side: the outer margins match the padding too
        const minL = Math.min(...r.rects.map((c) => c.left)) - r.photo.left;
        const maxR = r.photo.right - Math.max(...r.rects.map((c) => c.right));
        assert.ok(Math.abs(minL - r.pad) < 1 && Math.abs(maxR - r.pad) < 1, `${tag}: ${minL} / ${maxR} / ${r.pad}`);
      } finally {
        await p.close();
      }
    }
  });

  test('a photo card in the sidebar fills it behind its cards, out to its edges, and takes no place in the stack', { timeout: 90_000 }, async () => {
    const p = await browser.page(URL_OF(web, 'sideBackdrop', 'landscape'), { width: 1920, height: 1080 });
    try {
      const r = await p.eval(`(async () => {
        ${WAIT}
        const side = document.getElementById('canvas-side');
        const s = side.getBoundingClientRect();
        const el = document.querySelector('.cv-item[data-kind="photo"]');
        const ph = el.getBoundingClientRect();
        const ck = document.querySelector('.cv-item[data-kind="clock.digital"]').getBoundingClientRect();
        const cs = getComputedStyle(side);
        return {
          inSide: el.parentElement === side, backdrop: el.classList.contains('is-backdrop'), edge: el.classList.contains('is-edge'),
          side: [s.left, s.top, s.right, s.bottom], photo: [ph.left, ph.top, ph.right, ph.bottom],
          clockTop: ck.top - s.top, padTop: parseFloat(cs.paddingTop), clockL: ck.left - ph.left, clockR: ph.right - ck.right,
          top: document.elementFromPoint(ck.left + ck.width / 2, ck.top + ck.height / 2)?.closest('.cv-item')?.dataset.kind,
          sheet: getComputedStyle(document.querySelector('#app > .side')).backgroundColor,
          fill: [...document.getElementById('app').classList].filter((c) => c.startsWith('cv-fill-')),
          radius: getComputedStyle(el.querySelector('.cv-card')).borderTopLeftRadius,
          clockCard: document.querySelector('.cv-item[data-kind="clock.digital"] .cv-card').className,
        };
      })()`);
      assert.equal(r.inSide, true);
      assert.equal(r.backdrop, true);
      assert.equal(r.edge, true);
      r.side.forEach((v, i) => assert.ok(Math.abs(v - r.photo[i]) < 1, `photo ${r.photo} vs sidebar ${r.side}`));
      assert.equal(r.top, 'clock.digital');
      // the clock is the first card of the stack: the photo took no place in it
      assert.ok(Math.abs(r.clockTop - r.padTop) < 1, JSON.stringify(r));
      assert.ok(Math.abs(r.clockL - r.clockR) < 1, JSON.stringify(r));
      assert.deepEqual(r.fill, ['cv-fill-card']);
      assert.equal(r.sheet, 'rgba(0, 0, 0, 0)');
      assert.equal(r.radius, '0px');
      // the cards over it keep a surface of their own (the page's glass), as over the sidebar's photo
      assert.match(r.clockCard, /\bis-glass\b/);
    } finally {
      await p.close();
    }
  });

  test('without the edge it sits inside the bar\'s gaps, and the cards\' margins over it match on each axis', { timeout: 90_000 }, async () => {
    const p = await browser.page(URL_OF(web, 'sideBackdropInset', 'landscape'), { width: 1920, height: 1080 });
    try {
      const r = await p.eval(`(async () => {
        ${WAIT}
        const side = document.getElementById('canvas-side');
        const s = side.getBoundingClientRect();
        const ph = document.querySelector('.cv-item[data-kind="photo"]').getBoundingClientRect();
        const ck = document.querySelector('.cv-item[data-kind="clock.digital"]').getBoundingClientRect();
        const td = document.querySelector('.cv-item[data-kind="todo"]').getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(side).rowGap);
        return { gap, inset: [ph.left - s.left, ph.top - s.top, s.right - ph.right, s.bottom - ph.bottom], l: ck.left - ph.left, r: ph.right - ck.right, t: ck.top - ph.top, b: ph.bottom - td.bottom };
      })()`);
      for (const v of r.inset) assert.ok(Math.abs(v - r.gap) < 1, JSON.stringify(r));
      assert.ok(Math.abs(r.l - r.r) < 1 && r.l > 0, JSON.stringify(r));
      assert.ok(Math.abs(r.t - r.b) < 1 && r.t > 0, JSON.stringify(r));
    } finally {
      await p.close();
    }
  });

  test('portrait: the sidebar on top, filled by the photo, the cards over it', { timeout: 90_000 }, async () => {
    const p = await browser.page(URL_OF(web, 'sideBackdrop', 'portrait'), { width: 1080, height: 1920 });
    try {
      const r = await p.eval(`(async () => {
        ${WAIT}
        const s = document.getElementById('canvas-side').getBoundingClientRect();
        const ph = document.querySelector('.cv-item[data-kind="photo"]').getBoundingClientRect();
        const ck = document.querySelector('.cv-item[data-kind="clock.digital"]').getBoundingClientRect();
        return { side: [s.left, s.top, s.right, s.bottom], photo: [ph.left, ph.top, ph.right, ph.bottom], top: document.elementFromPoint(ck.left + ck.width / 2, ck.top + ck.height / 2)?.closest('.cv-item')?.dataset.kind };
      })()`);
      r.side.forEach((v, i) => assert.ok(Math.abs(v - r.photo[i]) < 1, JSON.stringify(r)));
      assert.ok(r.side[3] < 1000, JSON.stringify(r));
      assert.equal(r.top, 'clock.digital');
    } finally {
      await p.close();
    }
  });
});
