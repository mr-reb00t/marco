// A Personalizado card looks the same for the same box, whatever happened before: a screen loaded at one window size
// and resized to another draws every card as a screen opened at that size from the start (no fit carried over from
// the old box, no growth measured on a "loading" line), and the admin's preview (?preview=1, the builder's frame)
// draws the same boxes and the same type as the screen itself in a window of the same size (skipped without a
// browser).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

// the demo layouts with the cards that adapt the most: Home Assistant tiles and lines, the data cards, the lists
// grown to their box
const SHOTS = ['ha', 'tiles', 'data', 'household', 'size:sports:m', 'size:ha.switch:row'];
// [first window, window it is resized to]: a 16:9 screen, a taller browser window, a small one, a portrait one
const PAIRS = [
  [[1280, 720], [1920, 1080]],
  [[1920, 1080], [1850, 1460]],
  [[1850, 1460], [1280, 720]],
];

// every card: its box, its classes, the sizes its fit chose, and the text it shows (times and "ago" left out)
const STATE = `(() => [...document.querySelectorAll('.cv-item')].filter((e) => !e.hidden).map((e) => {
  const b = e.querySelector('.cv-body');
  const r = e.getBoundingClientRect();
  const st = b.style;
  const text = b.innerText.replace(/\\d{1,2}:\\d{2}(:\\d{2})?/g, '#').replace(/\\d+/g, 'N').replace(/\\s+/g, ' ').trim().slice(0, 160);
  const cls = [...b.querySelectorAll('[class]')].map((n) => (n.className.baseVal ?? n.className)).join(' ').replace(/\\s+/g, ' ').slice(0, 400);
  const fs = [...b.querySelectorAll('*')].filter((n) => n.childElementCount === 0 && n.textContent.trim() && n.getClientRects().length).slice(0, 12).map((n) => Math.round(parseFloat(getComputedStyle(n).fontSize) * 2) / 2);
  // a quote ticker moves on its own (a running line with a second copy, or pages in turn without motion): which
  // quotes it shows depends on the moment, so only its sizes are compared, each once
  if (b.classList.contains('is-ticker')) {
    const once = (a) => [...new Set(a)].sort().join(',');
    return { id: e.dataset.canvasItem, kind: e.dataset.kind, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(','), body: b.className, zoom: st.zoom, wk: st.getPropertyValue('--wk'), dk: st.getPropertyValue('--dk'), grow: st.getPropertyValue('--cv-grow'), text: '', cls: once(cls.split(' ')), fs: once(fs) };
  }
  return { id: e.dataset.canvasItem, kind: e.dataset.kind, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(','), body: b.className, zoom: st.zoom, wk: st.getPropertyValue('--wk'), dk: st.getPropertyValue('--dk'), grow: st.getPropertyValue('--cv-grow'), text, cls, fs: fs.join(',') };
}))()`;

const settle = (p) => p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');

const chrome = findChrome();
describe('a card is a function of its box', { skip: !chrome && 'no Chrome' }, () => {
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
  const url = (shot, extra = '') => `${web.url}/?demo=1&lite=1&preset=canvas&shot=${shot}&now=2026-10-14T10:43${extra}`;
  const diff = (a, b) => {
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i];
      const y = b[i];
      if (!x || !y) {
        out.push(`card ${i}: ${x?.kind ?? '-'} / ${y?.kind ?? '-'}`);
        continue;
      }
      for (const k of Object.keys(x)) if (x[k] !== y[k]) out.push(`${x.kind} ${x.id} ${k}: ${JSON.stringify(x[k])} != ${JSON.stringify(y[k])}`);
    }
    return out;
  };

  test('resized to a window, every card is drawn as on a screen opened at that size', { timeout: 600_000 }, async () => {
    const bad = [];
    for (const shot of SHOTS) {
      for (const [[aw, ah], [bw, bh]] of PAIRS) {
        // one tab at a time: a tab in the background gets no animation frames, so it would not lay out
        const p1 = await browser.page(url(shot), { width: aw, height: ah });
        let resized;
        try {
          await settle(p1);
          await p1.send('Emulation.setDeviceMetricsOverride', { width: bw, height: bh, deviceScaleFactor: 1, mobile: false });
          await settle(p1);
          resized = await p1.eval(STATE);
        } finally {
          await p1.close();
        }
        const p2 = await browser.page(url(shot), { width: bw, height: bh });
        try {
          await settle(p2);
          for (const d of diff(resized, await p2.eval(STATE))) bad.push(`${shot} ${aw}×${ah} → ${bw}×${bh}: ${d}`);
        } finally {
          await p2.close();
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  test('the preview draws the boxes and the type of the screen in a window of the same size', { timeout: 600_000 }, async () => {
    const bad = [];
    for (const shot of SHOTS) {
      for (const [w, h] of [[1920, 1080], [1850, 1460], [1080, 1920]]) {
        const look = async (u) => {
          const p = await browser.page(u, { width: w, height: h });
          try {
            await settle(p);
            return await p.eval(STATE);
          } finally {
            await p.close();
          }
        };
        const sa = await look(url(shot));
        const sb = await look(url(shot, '&preview=1'));
        // (the preview may word a note for the editor: boxes, fit and type are compared)
        const strip = (s) => s.map(({ text, cls, ...rest }) => rest);
        for (const d of diff(strip(sa), strip(sb))) bad.push(`${shot} ${w}×${h}: ${d}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});
