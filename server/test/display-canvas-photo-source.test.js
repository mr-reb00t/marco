// A Personalizado photo card with photos of its own (#41, props.photoSource mode 'own') on the display, in headless
// Chrome (skipped without a browser), with the demo's offline photos (&photo=topic: a colour per stock topic):
// - the card with its own photos shows its own list (topic1), the card next to it the screen's;
// - its "Efecto del tiempo" is one layer inside that card only, clipped by it; none with the effect off, with ?lite=1,
//   or on a card that shows the screen's photos (its saved effect does not count there);
// - a card on the screen's photos asks for no list of its own;
// - the sidebar's photo with photos of its own runs the screen's slideshow on its own settings.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

const URL_OF = (web, shot, extra = '') => `${web.url}/?demo=1&lang=en&now=2026-11-05T10:00&preset=canvas&shot=${shot}&orientation=landscape&photo=topic&wx=rain${extra}`;
const WAIT = `for (let i = 0; i < 80 && document.querySelectorAll('.cv-item[data-kind="photo"] .cv-ph').length < 2; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));`;
const CARDS = `const cards = [...document.querySelectorAll('.cv-item[data-kind="photo"]')];
  const own = window.__ownPhotos;
  const bgOf = (el) => (el.querySelector('.cv-ph')?.style.backgroundImage ?? '').replace(/^url\\("?|"?\\)$/g, '');`;

describe('a photo card with photos of its own', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  test('its own list and its weather effect, clipped to the card; the other card shows the screen photos', { timeout: 90_000 }, async () => {
    const p = await browser.page(URL_OF(web, 'photoOwn'), { width: 1920, height: 1080 });
    try {
      const r = await p.eval(`(async () => {
        ${WAIT}
        ${CARDS}
        const [a, b] = cards;
        const ownList = own.get('cv_demo0000')?.photos.map((x) => x.url) ?? [];
        const fx = [...document.querySelectorAll('.cv-phfx')];
        const ra = a.getBoundingClientRect();
        const rf = fx[0]?.getBoundingClientRect();
        const card = a.querySelector('.cv-card');
        return {
          size: own.size, ownList, a: bgOf(a), b: bgOf(b),
          fx: fx.length, inA: !!fx[0] && a.contains(fx[0]), wx: fx[0]?.dataset.wx ?? '',
          rectA: [ra.left, ra.top, ra.right, ra.bottom], rectFx: rf ? [rf.left, rf.top, rf.right, rf.bottom] : null,
          overflow: card ? getComputedStyle(card).overflow : '', anim: fx[0] ? getComputedStyle(fx[0].firstElementChild).animationName : '',
        };
      })()`);
      assert.equal(r.size, 1, `one list of its own, for card A only: ${JSON.stringify(r)}`);
      assert.equal(r.ownList.length, 3, JSON.stringify(r));
      assert.ok(r.ownList.includes(r.a), `card A shows its own topic: ${r.a.slice(0, 60)}`);
      assert.ok(r.b && !r.ownList.includes(r.b), 'card B shows the screen photos, not card A list');
      assert.equal(r.fx, 1, 'one weather layer, on card A only');
      assert.ok(r.inA, 'the layer is inside card A');
      assert.equal(r.wx, 'rain');
      assert.equal(r.anim, 'cv-phfx-fall', 'moved by a CSS animation');
      assert.equal(r.overflow, 'hidden', 'the card clips what goes past it');
      // the layer covers card A and nothing else
      const [l, t, rr, bb] = r.rectFx;
      const [al, at, ar, ab] = r.rectA;
      assert.ok(l >= al - 1 && t >= at - 1 && rr <= ar + 1 && bb <= ab + 1, `${JSON.stringify(r.rectFx)} in ${JSON.stringify(r.rectA)}`);
    } finally {
      await p.close();
    }
  });

  test('no weather layer with the effect off, with ?lite=1, or on a card that shows the screen photos', { timeout: 90_000 }, async () => {
    for (const [shot, extra, why] of [['photoOwnOff', '', 'off (and the screen card keeps its saved effect unused)'], ['photoOwn', '&lite=1', 'lite']]) {
      const p = await browser.page(URL_OF(web, shot, extra), { width: 1920, height: 1080 });
      try {
        const r = await p.eval(`(async () => {
          ${WAIT}
          ${CARDS}
          return { fx: document.querySelectorAll('.cv-phfx').length, size: own.size, a: bgOf(cards[0]), b: bgOf(cards[1]) };
        })()`);
        assert.equal(r.fx, 0, `${why}: ${JSON.stringify(r)}`);
        assert.equal(r.size, 1, `${why}: only card A has a list of its own (a 'screen' block asks for none)`);
        assert.notEqual(r.a, r.b, why);
      } finally {
        await p.close();
      }
    }
  });

  test('the sidebar photo with photos of its own: the slideshow takes its topic, no card list', { timeout: 90_000 }, async () => {
    const p = await browser.page(URL_OF(web, 'photoOwnSide'), { width: 1920, height: 1080 });
    try {
      const r = await p.eval(`(async () => {
        for (let i = 0; i < 80 && !document.querySelector('.cv-item[data-kind="clock.digital"] .clock .d'); i++) await new Promise((r) => setTimeout(r, 100));
        const { state } = await import('/display/store.ts');
        const { ctx } = await import('/display/ctx.ts');
        return { size: window.__ownPhotos.size, own: ctx.cfg.background.own ?? '', topic: ctx.cfg.background.stockTopic, fx: ctx.cfg.background.weatherFx, n: state.photos?.photos?.length ?? 0 };
      })()`);
      assert.equal(r.size, 0, JSON.stringify(r));
      assert.equal(r.own, 'sidebar');
      assert.equal(r.topic, 'topic2');
      assert.equal(r.fx, 'simple');
      assert.ok(r.n > 0);
    } finally {
      await p.close();
    }
  });
});
