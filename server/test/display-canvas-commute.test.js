// The Trayectos card (canvas kind 'commute') in a browser, with the demo's made-up times (web/display/mockCommute.ts):
// every design (one route large, wide, a list, columns, lines, one line, the time alone) in the fixtures commute,
// commuteLines, commuteSide, commuteStates and commutePortrait, dark and light; nothing cramped or cut; the traffic
// always in words ("+5 min"), never by colour alone; the states (no key, old times, no route); and the page never holds
// an address. Then every named size of the card. Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CANVAS_KINDS } from '../core/canvasCore.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
// the same check as the flexible sizes sweep (one source of truth for "fits")
const CHECK = eval(read('server/test/display-canvas-flex.test.js').match(/const CHECK = (`[\s\S]*?`);/)[1]);
const CARDS = `(() => [...document.querySelectorAll('.cv-item[data-kind="commute"]')].map((e) => {
  const b = e.querySelector('.cv-body');
  return {
    looks: [...b.classList].filter((c) => /^is-(focus|list|cols|lines|line|pill|wide|stale|across)$/.test(c)),
    text: b.textContent,
    chips: [...b.querySelectorAll('.cv-cm-tr')].map((c) => [c.className.replace('cv-cm-tr ', ''), c.textContent]),
    empty: e.classList.contains('is-empty'),
  };
}))()`;
const settle = 'document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))';

test('the display never talks to Google, and the card reads no address', () => {
  for (const f of ['web/display/commuteFeed.ts', 'web/display/widgets/canvas/commute.ts', 'web/display/mockCommute.ts']) {
    const s = read(f);
    assert.doesNotMatch(s, /googleapis|maps\.google/, f);
    assert.doesNotMatch(s, /\.origin\b|\.destination\b/, f);
    assert.doesNotMatch(s, /\u2014/, `no em dashes in ${f}`);
  }
  assert.match(read('web/display/commuteFeed.ts'), /\/api\/display\/commute\?item=/);
});

const chrome = findChrome();
describe('Trayectos in a browser', { skip: !chrome && 'no Chrome' }, () => {
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
  async function look(q, size = { width: 1920, height: 1080 }) {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&lang=es&now=2026-10-15T08:12&${q}`, size);
    try {
      await p.eval(settle);
      const fit = await p.eval(CHECK);
      const cards = await p.eval(CARDS);
      const html = await p.eval('document.documentElement.outerHTML');
      return { fit, cards, html };
    } finally {
      await p.close();
    }
  }
  const fits = (r, what) => {
    for (const c of r.fit.filter((x) => x.kind === 'commute')) {
      assert.equal(c.cramped, false, `${what}: ${c.cells} cramped`);
      assert.deepEqual(c.cut, [], `${what}: ${c.cells} cut`);
    }
  };

  test('every design, dark and light, landscape and portrait: fits, says the traffic in words, never an address', { timeout: 300_000 }, async () => {
    const seen = new Set();
    const text = [];
    for (const [shot, size] of [['commute'], ['commuteLines'], ['commuteSide'], ['commuteStates'], ['commutePortrait', { width: 1080, height: 1920 }]]) {
      for (const theme of ['dark', 'light']) {
        const r = await look(`shot=${shot}&theme=${theme}`, size);
        fits(r, `${shot} ${theme}`);
        assert.ok(r.cards.length >= 3, `${shot}: ${r.cards.length} cards`);
        for (const c of r.cards) for (const l of c.looks) seen.add(l);
        for (const c of r.cards) text.push(c.text);
        // the traffic of a car is a chip with its minutes (or "Fluido"): the colour is never alone
        for (const c of r.cards) for (const [cls, t] of c.chips) assert.match(t, cls.includes('is-clear') ? /^(Fluido|\+\d+ min)$/ : /^\+\d+ min$/, `${shot}: ${cls}`);
        assert.doesNotMatch(r.html, /Calle Inventada|Plaza Ficticia|Villaejemplo/, shot);
      }
    }
    for (const l of ['is-focus', 'is-wide', 'is-list', 'is-cols', 'is-lines', 'is-line', 'is-pill', 'is-stale']) assert.ok(seen.has(l), `no card ${l}`);
    const all = text.join('\n');
    for (const s of ['+5 min', '+16 min', 'Llegada', 'Normalmente 19 min', 'vuelta', 'Sin ruta', 'Falta la clave de Google Maps', 'Actualizado hace 52 min', 'Termina de configurarlo en el editor', 'por A-6']) {
      assert.ok(all.includes(s), s);
    }
  });

  test('every named size of the card, and its smallest boxes: nothing cramped or cut', { timeout: 300_000 }, async () => {
    const sizes = [...CANVAS_KINDS.commute.sizes, '4x1', '5x2', '4x3', '24x12'];
    for (const s of sizes) {
      const r = await look(`shot=size:commute:${s}`);
      assert.ok(r.cards.length >= 1, s);
      fits(r, `size ${s}`);
      // (a box one cell high: one route on one line)
      if (s === '4x1') assert.ok(r.cards.every((c) => c.looks.includes('is-line')), s);
    }
    const p = await look('shot=size:commute:m:portrait', { width: 1080, height: 1920 });
    fits(p, 'portrait m');
  });
});
