// Personalizado flexible sizes on the display: every kind drawn at boxes of its own (any w×h in whole cells within its
// range, canvasCore cellRange), not only its named sizes: its smallest, its largest and a few in between, on a
// landscape screen, with a wide sidebar on the left (smaller cells) and in portrait. Nothing may say "No cabe" and no
// text may be cut by the card's edge (a line ending in … or a scrolling title is fine; what a card leaves out whole is
// fine too). The data cards have their own, stricter sweep (display-data-sizes.test.js). Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_KINDS, DATA_KIND_IDS } from '../core/canvasCore.js';
import { flexSamples } from './flexSizes.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

/** In the page: each card, whether it is marked cramped, and the text the card's edge cuts through. */
const CHECK = `(() => [...document.querySelectorAll('.cv-item:not([hidden])')].map((e) => {
  const b = e.querySelector('.cv-body');
  const br = b.getBoundingClientRect();
  const cut = [...b.querySelectorAll('*')]
    .filter((t) => !(t instanceof SVGElement) && !t.closest('.cv-slider, .cv-ha-toast, .cv-ha-swatches, .cv-chips, .cv-st-vp')
      && [...t.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && t.getClientRects().length && getComputedStyle(t).visibility !== 'hidden')
    .filter((t) => {
      const r = t.getBoundingClientRect();
      const out = r.bottom > br.bottom + 1 || r.top < br.top - 1 || r.right > br.right + 1 || r.left < br.left - 1;
      const seen = r.right > br.left + 1 && r.left < br.right - 1 && r.bottom > br.top + 1 && r.top < br.bottom - 1;
      // inside a line that ends in … or a title that scrolls: shortened on purpose
      for (let n = t; n && n !== b; n = n.parentElement) if (getComputedStyle(n).textOverflow === 'ellipsis' || /\\bmq/.test(n.className)) return false;
      return out && seen;
    })
    .map((t) => (t.className || t.tagName) + ' "' + t.textContent.trim().slice(0, 20) + '"');
  return { kind: e.dataset.kind, cells: e.dataset.cells, cramped: e.classList.contains('is-cramped'), cut };
}))()`;

const SCREENS = [
  { o: 'landscape', side: '', size: { width: 1920, height: 1080 }, pick: (list) => list },
  { o: 'landscape', side: 'left', size: { width: 1920, height: 1080 }, pick: (list) => [list[0], list[2]].filter(Boolean) },
  { o: 'portrait', side: '', size: { width: 1080, height: 1920 }, pick: (list) => [list[0], list[1], list[4]].filter(Boolean) },
];

const chrome = findChrome();
describe('every card at boxes of its own size, in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  const kinds = Object.keys(CANVAS_KINDS).filter((k) => !CANVAS_KINDS[k].reserved && k !== 'spacer' && !DATA_KIND_IDS.includes(k));
  for (const group of [kinds.filter((k) => !k.startsWith('ha.')), kinds.filter((k) => k.startsWith('ha.'))]) {
    test(`${group[0].startsWith('ha.') ? 'Casa' : 'the other'} cards: no "No cabe", no text cut at the smallest, the largest and boxes in between`, { timeout: 900_000 }, async () => {
      const jobs = [];
      for (const kind of group) {
        for (const sc of SCREENS) for (const sz of sc.pick(flexSamples(kind, sc.o))) jobs.push({ shot: `size:${kind}:${sz}:${sc.o}${sc.side ? `:${sc.side}` : ''}`, size: sc.size });
      }
      const bad = [];
      let next = 0;
      // a few tabs at a time
      await Promise.all(Array.from({ length: 4 }, async () => {
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

  /** Open a demo shot and evaluate `expr` in it. */
  async function look(shot, expr, extra = '', size = { width: 1920, height: 1080 }) {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=${shot}${extra}`, size);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 900)))');
      return await p.eval(expr);
    } finally {
      await p.close();
    }
  }

  // How much of its body a card's content takes in height, and where its middle is (0 top, 1 bottom).
  const ROOM = `[...document.querySelectorAll('.cv-item:not([hidden]) .cv-body')].map((b) => {
    const br = b.getBoundingClientRect();
    let top = Infinity, bottom = -Infinity;
    for (const n of b.querySelectorAll('*')) {
      const leaf = n instanceof SVGElement ? n.tagName.toLowerCase() === 'svg' : n.tagName === 'IMG' || [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (!leaf || getComputedStyle(n).visibility === 'hidden') continue;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < br.top || r.top > br.bottom) continue;
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
    return { cls: b.className, fill: (bottom - top) / br.height, mid: ((top + bottom) / 2 - br.top) / br.height };
  })`;

  test('a box past the named sizes is used: lists and faces grow, take tiles or columns, tall boxes stack, no small block in a band of empty space', { timeout: 300_000 }, async () => {
    const bad = [];
    // [kind, box, a class the card takes there (or ''), the least share of the height its content takes]
    const CASES = [
      ['family.members', '24x16', '', 0.3], ['family.members', '6x16', 'is-tall', 0.6],
      ['family.rewards', '24x16', 'is-tiles', 0.4], ['family.rewards', '6x16', 'is-tall', 0.5],
      ['family.points', '24x16', 'is-tiles', 0.4], ['meals.today', '24x16', 'is-tiles', 0.35], ['meals.today', '24x4', 'is-row', 0.4],
      ['meals.week', '6x16', '', 0.5], ['birthdays', '24x16', '', 0.5], ['birthdays', '24x4', 'is-cols', 0.4], ['countdowns', '24x16', '', 0.5],
      ['family.chores', '24x16', 'is-cols', 0.5], ['news', '24x16', 'is-big', 0.5], ['message', '24x16', '', 0.4], ['todo', '16x16', '', 0.5],
      ['weather.now', '4x16', 'is-stack', 0.4], ['weather.hourly', '12x16', 'is-grid', 0.5], ['weather.forecast', '6x16', 'is-column', 0.5],
      ['clock.world', '6x16', 'is-stack', 0.3], ['calendar.next', '4x12', 'is-stack', 0.2], ['date', '24x12', '', 0.5],
      ['ha.tile', '4x8', 'is-tall', 0.5], ['ha.switch', '12x8', '', 0.35], ['ha.statistic', '16x12', '', 0.3], ['ha.media', '16x16', '', 0.25], ['market', '16x16', 'is-big', 0.5],
    ];
    for (const [kind, box, cls, least] of CASES) {
      const cards = await look(`size:${kind}:${box}:landscape`, ROOM);
      if (!cards.length) bad.push(`${kind} ${box}: no cards`);
      for (const c of cards) {
        if (cls && !c.cls.split(' ').includes(cls)) bad.push(`${kind} ${box}: no ${cls} (${c.cls})`);
        // a short block is at least in the middle of its card, not at its top
        if (c.fill < least) bad.push(`${kind} ${box}: content takes ${c.fill.toFixed(2)} of the height`);
        if (c.fill < 0.6 && Math.abs(c.mid - 0.5) > 0.15) bad.push(`${kind} ${box}: content sits at ${c.mid.toFixed(2)} of the height`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('the owner\'s rules for the Casa tiles: icon beside the name, the name on one line over a state, dim colours when off, a calm thermostat at 150 %', async () => {
    // Persiana Mini: the icon on the name's row, then the buttons (never the icon on a row of its own)
    const cover = await look('size:ha.cover:xs:landscape', `[...document.querySelectorAll('.cv-ha-cover')].map((b) => {
      const i = b.querySelector('.cv-ha-light-top > .cv-ha-ico, .cv-ha-light-top > *').getBoundingClientRect();
      const n = b.querySelector('.cv-ha-name').getBoundingClientRect();
      return i.right <= n.left + 1 && i.top < n.bottom && i.bottom > n.top;
    })`);
    assert.ok(cover.length && cover.every(Boolean), 'Persiana Mini: icon and name on one row');
    // with a state line under it the name is one line ending in …; without one it may take two
    const names = await look('size:ha.tile:xs:landscape', `[...document.querySelectorAll('.cv-ha-tile .cv-ha-txt')].map((t) => [!!t.querySelector('.cv-ha-state')?.textContent, getComputedStyle(t.querySelector('.cv-ha-name')).whiteSpace])`);
    assert.ok(names.length);
    for (const [state, ws] of names) assert.equal(ws, state ? 'nowrap' : 'normal');
    // a line card in a narrow box (4×2, the old 2×1): the name keeps more than a letter or two (the state goes under it)
    for (const k of ['ha.sensor', 'ha.switch']) {
      const shown = await look(`size:${k}:4x2:landscape`, `[...document.querySelectorAll('.cv-ha-tile .cv-ha-name')].map((n) => n.clientWidth / parseFloat(getComputedStyle(n).fontSize))`);
      assert.ok(shown.length && shown.every((em) => em >= 3), `${k} 4×2: name ${shown.map((x) => x.toFixed(1)).join(', ')} em`);
    }
    // the Interruptor in a box wider than its named size: the type grows a little
    const grow = await look('size:ha.switch:8x4:landscape', `[...document.querySelectorAll('.cv-ha-switchcard')].map((b) => parseFloat(b.style.getPropertyValue('--cv-grow')) || 1)`);
    assert.ok(grow.length && grow.every((g) => g > 1.1 && g <= 1.4), String(grow));
    // a light that is off: its colours dimmed; a lit one: full colour
    const sw = await look('size:ha.light:12x4:landscape', `[...document.querySelectorAll('.cv-ha-light')].filter((b) => b.querySelector('.cv-swatch')).map((b) => [b.dataset.tone, parseFloat(getComputedStyle(b.querySelector('.cv-swatch')).opacity)])`);
    assert.ok(sw.some(([t]) => t === 'off') && sw.some(([t]) => t === 'on'), JSON.stringify(sw));
    for (const [t, o] of sw) assert.ok(t === 'off' ? o < 0.6 : o === 1, `${t}: ${o}`);
    // the thermostat at 150 %: every mode chip whole, the dial as large as at 100 %
    const CL = `[...document.querySelectorAll('.cv-ha-climate')].map((b) => ({ dial: b.querySelector('.cv-ha-dial')?.clientHeight ?? 0, rows: [...b.querySelectorAll('.cv-ha-modes')].every((r) => r.scrollWidth <= r.clientWidth + 1) }))`;
    const at100 = await look('size:ha.climate:m:landscape', CL);
    const at150 = await look('size:ha.climate:m:landscape', CL, '&cvscale=1.5');
    assert.equal(at150.length, at100.length);
    at150.forEach((c, i) => {
      assert.ok(c.rows, `card ${i}: a mode chip is cut at 150 %`);
      assert.ok(c.dial >= at100[i].dial * 0.95, `card ${i}: dial ${c.dial} at 150 %, ${at100[i].dial} at 100 %`);
    });
  });
});
