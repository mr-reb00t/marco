// The commute widget (#42) on the display, in headless Chrome with the demo's made-up times (?cw=, skipped without a
// browser): in a corner, in the side column and on the whole screen, in the Classic and Modern designs, dark and
// light. Its times carry "Google Maps" under them, as Google's terms ask for route times shown without its map: one
// line, the text as it is, translate="no", at least 1.2rem (12 px on a 1080-line screen), weight 400, inside the
// widget, in white, #1F1F1F or #5E5E5E, and at least 4.5:1 on a light panel laid over a dark photo.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChrome, launchChrome, startWeb } from './browser.js';

const read = `(async () => {
  for (let i = 0; i < 60 && !document.querySelector('.cw .cw-dur'); i++) await new Promise((r) => setTimeout(r, 100));
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 600));
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const parse = (s) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(s || '');
    if (!m) return null;
    const v = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
  };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]));
  const lum = (c) => {
    const l = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  return [...document.querySelectorAll('.cw')].filter((el) => el.offsetWidth).map((el) => {
    const cr = el.getBoundingClientRect();
    const bg = over(parse(getComputedStyle(el).backgroundColor) ?? [0, 0, 0, 0], [48, 48, 48]);
    return {
      place: [...el.classList].find((c) => c.startsWith('cw--')),
      rows: el.querySelectorAll('.cw-row').length,
      lightPanel: lum(bg) > 0.35,
      attrs: [...el.querySelectorAll('.gm-attr')].map((a) => {
        const r = a.getBoundingClientRect();
        const s = getComputedStyle(a);
        const c = parse(s.color);
        return {
          text: a.textContent, translate: a.getAttribute('translate'), size: parseFloat(s.fontSize) / rem, weight: s.fontWeight, color: s.color,
          contrast: c ? ratio(over(c, bg), bg) : 0,
          shown: s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0,
          inside: r.left >= cr.left - 0.5 && r.right <= cr.right + 0.5 && r.top >= cr.top - 0.5 && r.bottom <= cr.bottom + 0.5,
        };
      }),
    };
  });
})()`;

const GM_COLORS = ['rgb(255, 255, 255)', 'rgb(31, 31, 31)', 'rgb(94, 94, 94)'];

test('the widget writes the attribution only with a time, never translated', () => {
  const src = fs.readFileSync(new URL('../../web/display/widgets/googleMapsAttr.ts', import.meta.url), 'utf8');
  assert.match(src, /textContent = 'Google Maps'/);
  assert.match(src, /setAttribute\('translate', 'no'\)/);
  assert.doesNotMatch(src, /ctx\.t\(/, 'the attribution is never translated');
  assert.doesNotMatch(src, /\u2014/);
});

describe('commute widget in a browser', { skip: !findChrome() && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome();
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });
  const open = async (q) => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=es&now=2026-11-05T08:30&${q}`, { width: 1920, height: 1080 });
    try {
      return await p.eval(read);
    } finally {
      await p.close();
    }
  };

  test('corner, side and whole screen; Classic and Modern; dark and light: "Google Maps" under the times', { timeout: 300_000 }, async () => {
    let seen = 0;
    for (const style of ['classic', 'modern']) {
      for (const theme of ['dark', 'light']) {
        for (const cw of ['2:corner:br:m,3:side:tr:m', '3:full']) {
          const what = `${style} ${theme} ${cw}`;
          const ws = await open(`cw=${cw}&theme=${theme}&style=${style}`);
          assert.ok(ws.length >= 1, `${what}: no widget`);
          for (const w of ws) {
            assert.ok(w.rows >= 1, `${what} ${w.place}: no rows`);
            assert.equal(w.attrs.length, 1, `${what} ${w.place}: ${w.attrs.length} attributions`);
            const a = w.attrs[0];
            assert.equal(a.text, 'Google Maps', what);
            assert.equal(a.translate, 'no', what);
            assert.ok(a.shown && a.inside, `${what} ${w.place}: attribution hidden or outside`);
            assert.ok(a.size >= 1.2 - 0.001, `${what} ${w.place}: ${a.size.toFixed(2)}rem`);
            assert.equal(a.weight, '400', what);
            assert.ok(GM_COLORS.includes(a.color), `${what} ${w.place}: ${a.color}`);
            if (w.lightPanel) assert.ok(a.contrast >= 4.5, `${what} ${w.place}: ${a.contrast.toFixed(2)}:1 on a light panel`);
            seen++;
          }
        }
      }
    }
    assert.ok(seen >= 12, `${seen} widgets checked`);
  });
});
