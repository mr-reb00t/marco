// "Now playing" on the display (issue #18), in a browser with the demo's made-up tracks: the Sonando ahora card at
// its sizes (the cover, the title, the artist, the small Spotify credit, a bar that moves on by itself, nothing cut or
// cramped), every card hidden when nothing plays, a card with no account never drawn on a TV, and the line under the
// clock of the usual designs (one pill, hidden when nothing plays, never on Personalizado). Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChrome, launchChrome, startWeb } from './browser.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
// the same check as the flexible sizes sweep (one source of truth for "fits")
const CHECK = eval(read('server/test/display-canvas-flex.test.js').match(/const CHECK = (`[\s\S]*?`);/)[1]);

const CARDS = `(() => [...document.querySelectorAll('.cv-item[data-kind="nowplaying"]')].map((e) => ({
  empty: e.classList.contains('is-empty'),
  shown: getComputedStyle(e).visibility !== 'hidden',
  cells: e.dataset.cells,
  title: e.querySelector('.cv-ha-title')?.textContent ?? '',
  artist: e.querySelector('.cv-ha-artist')?.textContent ?? '',
  credit: e.querySelector('.cv-np-src')?.textContent ?? '',
  art: !!e.querySelector('.cv-ha-art'),
  bar: e.querySelector('.cv-ha-prog-bar > i')?.style.width ?? '',
  times: [...e.querySelectorAll('.cv-ha-prog-t')].map((t) => t.textContent),
})))()`;
const LINE = `(() => {
  const el = document.querySelector('#nowplaying');
  return { shown: getComputedStyle(el).display !== 'none', pills: el.querySelectorAll('.np-pill').length, text: el.querySelector('.hl-tt')?.textContent ?? '', credit: el.querySelector('.np-src')?.textContent ?? '', h: el.getBoundingClientRect().height };
})()`;
const settle = 'document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))';

test('the display reads ?np=, the README documents it, and the marquee slides a long line', () => {
  const main = read('web/display/main.ts');
  assert.match(main, /params\.get\('np'\)/);
  assert.match(read('web/display/marquee.ts'), /'\.hl-tt'/);
  for (const f of ['README.md', 'README.es.md']) assert.match(read(f), /\?np=0/, f);
  // nothing in the display talks to Spotify itself
  for (const f of ['web/display/nowPlayingFeed.ts', 'web/display/widgets/canvas/nowPlaying.ts', 'web/display/widgets/nowPlayingLine.ts']) assert.doesNotMatch(read(f), /spotify\.com|scdn\.co/, f);
});

const chrome = findChrome();
describe('now playing in a browser', { skip: !chrome && 'no Chrome' }, () => {
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
  async function look(q, expr, size = { width: 1920, height: 1080 }, wait = settle) {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&${q}`, size);
    try {
      await p.eval(wait);
      const out = await p.eval(expr);
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      return { out, errors, p };
    } finally {
      await p.close();
    }
  }

  test('the card: cover, title, artist, credit, a bar that moves, nothing cut; no account and nothing playing are not drawn', { timeout: 120_000 }, async () => {
    const { out: cards, errors } = await look('preset=canvas&shot=nowplaying', CARDS);
    assert.deepEqual(errors, []);
    assert.equal(cards.length, 6);
    const drawn = cards.filter((c) => !c.empty);
    assert.equal(drawn.length, 5, 'the card with no account is not drawn on a TV');
    assert.equal(cards.filter((c) => c.empty && !c.shown).length, 1);
    for (const c of drawn) {
      assert.ok(c.shown, c.cells);
      assert.ok(['Sunday Morning Pancakes', 'Long Way Round the Lake'].includes(c.title), c.title);
      assert.ok(c.artist, `${c.cells}: the artist`);
      assert.equal(c.credit, 'Spotify', `${c.cells}: the credit`);
    }
    assert.equal(drawn.filter((c) => !c.art).length, 1, 'one card without its cover');
    const wide = drawn.find((c) => c.bar);
    assert.ok(wide, 'a card with the bar');
    assert.equal(wide.times[0], '1:14');
    // nothing cut by its card's edge, nothing cramped
    const { out: fit } = await look('preset=canvas&shot=nowplaying', CHECK);
    const bad = fit.filter((c) => c.kind === 'nowplaying' && (c.cramped || c.cut.length));
    assert.deepEqual(bad, []);
    // the bar moves on between answers, by itself
    const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=nowplaying`, { width: 1920, height: 1080 });
    try {
      await p.eval(settle);
      const a = await p.eval(`document.querySelector('.cv-np .cv-ha-prog-t').textContent`);
      await p.eval('new Promise((r) => setTimeout(r, 2300))');
      const b = await p.eval(`document.querySelector('.cv-np .cv-ha-prog-t').textContent`);
      assert.notEqual(a, b, `${a} → ${b}`);
    } finally {
      await p.close();
    }
    // nothing plays: every card hidden
    const { out: idle } = await look('preset=canvas&shot=nowplaying&np=idle', CARDS);
    assert.deepEqual(idle.map((c) => [c.empty, c.shown]), idle.map(() => [true, false]));
  });

  test('every size the card allows reads whole', { timeout: 300_000 }, async () => {
    const bad = [];
    for (const [o, size] of [['landscape', { width: 1920, height: 1080 }], ['portrait', { width: 1080, height: 1920 }]]) {
      for (const box of ['s', 'w', 'm', 't', 'l', '4x1', '6x1', '16x16', '6x2', '8x16']) {
        const { out } = await look(`preset=canvas&shot=size:nowplaying:${box}:${o}`, CHECK, size);
        if (!out.length) continue;
        for (const c of out) {
          if (c.cramped) bad.push(`${o} ${box}: does not fit`);
          if (c.cut.length) bad.push(`${o} ${box}: cuts ${c.cut.join(', ')}`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  test('the line under the clock: one pill on the usual designs, hidden when nothing plays, never on Personalizado', { timeout: 120_000 }, async () => {
    for (const q of ['preset=bigCalendar&style=classic', 'preset=bigCalendar&style=modern', 'preset=topBottom&style=classic', 'preset=agenda&style=modern']) {
      const { out: on, errors } = await look(`${q}&np=1`, LINE);
      assert.deepEqual(errors, [], q);
      assert.deepEqual([on.shown, on.pills, on.text, on.credit], [true, 1, 'Sunday Morning Pancakes · Ana and the Weekend Band', 'Spotify'], q);
      assert.ok(on.h > 0, q);
      const { out: idle } = await look(`${q}&np=idle`, LINE);
      assert.deepEqual([idle.shown, idle.pills, idle.h], [false, 0, 0], q);
      const { out: off } = await look(q, LINE);
      assert.deepEqual([off.shown, off.pills], [false, 0], `${q}: off unless the screen chooses an account`);
    }
    const { out: canvas } = await look('preset=canvas&shot=nowplaying&np=1', LINE);
    assert.equal(canvas.shown, false, 'Personalizado has its own card');
  });
});
