// A Personalizado photo card with photos of its own (#41, props.photoSource mode 'own') on the display, in headless
// Chrome (skipped without a browser), with the demo's offline photos (&photo=topic: a colour per stock topic):
// - the card with its own photos shows its own list (topic1), the card next to it the screen's;
// - its "Efecto del tiempo" is one layer inside that card only, clipped by it; none with the effect off, with ?lite=1,
//   or on a card that shows the screen's photos (its saved effect does not count there);
// - a card on the screen's photos asks for no list of its own;
// - the sidebar's photo with photos of its own runs the screen's slideshow on its own settings, and a card left on the
//   screen's photos then shows the Fondo's, not the sidebar's;
// - a card whose own list fails to load asks again later, never in a loop.
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

  test("a card on the screen's photos next to a sidebar with photos of its own shows the Fondo's", { timeout: 90_000 }, async () => {
    const p = await browser.page(URL_OF(web, 'photoOwnSideCard'), { width: 1920, height: 1080 });
    try {
      const r = await p.eval(`(async () => {
        for (let i = 0; i < 80 && !document.querySelector('.cv-item[data-kind="photo"] .cv-ph'); i++) await new Promise((r) => setTimeout(r, 100));
        const { state } = await import('/display/store.ts');
        const { ctx } = await import('/display/ctx.ts');
        ${CARDS}
        return { own: ctx.cfg.background.own ?? '', side: state.photos?.photos?.map((x) => x.url) ?? [], card: bgOf(cards[0]), size: own.size };
      })()`);
      assert.equal(r.own, 'sidebar', JSON.stringify(r));
      assert.ok(r.side.length > 0, 'the sidebar has its list');
      assert.ok(r.card, 'the card shows a photo');
      assert.ok(!r.side.includes(r.card), `the card shows the Fondo's photos, not the sidebar's: ${r.card.slice(0, 60)}`);
      assert.equal(r.size, 1, "one list kept apart: the Fondo's");
    } finally {
      await p.close();
    }
  });

  test('a list that fails to load is asked for again later, not in a loop', { timeout: 60_000 }, async () => {
    const p = await browser.page(URL_OF(web, 'photoOwn'), { width: 800, height: 600 });
    try {
      const r = await p.eval(`(async () => {
        const { OwnPhotos } = await import('/display/ownPhotos.ts');
        let calls = 0;
        const realFetch = window.fetch;
        // fails at once (the worst case: a loop would never let the page run); stops answering past 50 so a loop cannot hang the test
        window.fetch = (u, o) => (String(u).includes('/api/photos') ? (++calls > 50 ? new Promise(() => {}) : Promise.reject(new Error('offline'))) : realFetch(u, o));
        const block = { mode: 'own', source: 'stock', stockTopic: 'topic1', order: 'random', weatherFx: 'off' };
        let looks = 0;
        const o = new OwnPhotos({
          screen: () => 's1', demo: () => false, mock: () => ({ photos: [] }), fallback: () => ({ photos: [{ url: 'screen.jpg' }] }), fondo: () => null,
          // the cards look again, as canvasView.onData('photos') does
          changed: () => { looks++; o.want('c1', block); },
        });
        const first = o.want('c1', block);
        await new Promise((r) => setTimeout(r, 1000));
        o.want('c1', block);
        o.refresh();
        await new Promise((r) => setTimeout(r, 300));
        const after = o.get('c1');
        window.fetch = realFetch;
        return { calls, looks, first, after: after?.photos?.[0]?.url ?? '' };
      })()`);
      assert.equal(r.first, null, 'nothing yet while it loads');
      assert.ok(r.calls <= 3, `at most the first request and the refresh: ${JSON.stringify(r)}`);
      assert.equal(r.looks, 1, 'the cards look again once, when it falls back');
      assert.equal(r.after, 'screen.jpg', "the screen's photos meanwhile");
    } finally {
      await p.close();
    }
  });
});
