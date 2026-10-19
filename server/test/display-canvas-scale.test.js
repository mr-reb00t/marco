// "Tamaño del texto" of a Personalizado card (item.style.scale, 70 to 150 %): every kind follows it. The Casa and data
// cards read --cv-scale, the clocks, the date, the weather now, the value, the heading and the HTML card multiply
// their fitted type by it, and every other card's body is zoomed (web/display/widgets/canvas.ts applyScale). Each
// kind of the registry is rendered in headless Chrome at 70, 100 and 150 % (&cvscale=, web/display/mock.ts) and its
// largest text must shrink and grow (skipped without a browser).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CANVAS_KINDS } from '../core/canvasCore.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// kinds with no text to size: the spacer, the analog dial (it fills its box) and the declarative card (reserved,
// refused by this version, drawn as "comes later")
const NO_TEXT = new Set(['spacer', 'clock.analog', 'card']);

// the demo layout that shows a kind with text (default: copies of it at a size with room, &shot=size:<kind>:<size>)
const SHOT = {
  'clock.digital': 'size:clock.digital:l',
  'clock.flip': 'size:clock.flip:w',
  photo: 'media',
  widget: 'media',
  announcement: 'household&announce=info',
  heading: 'features',
  html: 'html',
  'ha.camera': 'cameras',
  sports: 'size:sports:l',
  // a button's text fills its width (a long one is made smaller to fit): the demo's buttons with screen names; the
  // pause and the progress show on a display that runs a carousel: the demo carousel with the navigation cards
  'nav.button': 'nav',
  'nav.pause': 'nav&carousel=1&nav=1&stepSec=600',
  'nav.progress': 'nav&carousel=1&nav=1&stepSec=600',
};
// where the largest text is not the one to follow: the thermostat's temperature is sized by its dial (the room the
// other lines leave), so its name is measured; a saved widget switches to its compact drawing when a larger text
// leaves it less room, so the small one of the demo (compact at every size) is measured
const MAIN = { 'ha.climate': '.cv-ha-name', widget: '.pw-title' };
const LAST = new Set(['widget']);
// type that fills its box (the flip clock fills its width already at 100 %): above 100 % it grows only as far as the
// box holds it, so 150 % is never smaller than 100 % and never cramped
// cards that already fill their box at 100 % (the navigation buttons, the flip clock; the lists, the forecasts, the message and the next
// event grown to a box larger than their content): 150 % may not grow them further, it must not shrink them
const FILLS = new Set(['nav.button', 'nav.pause', 'clock.flip', 'announcement', 'birthdays', 'calendar.next', 'family.points', 'family.rewards', 'meals.today', 'message', 'news', 'todo', 'weather.forecast', 'weather.hourly']);
const shotOf = (kind) => {
  if (SHOT[kind]) return SHOT[kind];
  const sizes = CANVAS_KINDS[kind].sizes;
  const size = ['m', 'w', 't', 'l', 's', 'xs', 'row'].find((s) => sizes.includes(s)) ?? sizes[0];
  return `size:${kind}:${size}`;
};

test('the text size reaches every card: its own type, or the zoom of its body, never both, nothing at 100 %', () => {
  const src = read('web/display/widgets/canvas.ts');
  assert.match(src, /e\.body\.style\.zoom = k !== 1 && !OWN_SCALE\.test\(e\.kind\) \? String\(k\) : '';/);
  // set before the body is measured, so the first layout already sees the zoomed box
  assert.match(src, /applyScale\(e\);\n\s+const w = e\.body\.clientWidth;/);
  const own = /const OWN_SCALE = (\/.*\/);/.exec(src)[1];
  const re = new RegExp(own.slice(1, -1).replace(/\\\\/g, '\\'));
  // the kinds that size their own type read the scale; the others do not (or they would grow twice)
  const readsScale = (k) => re.test(k);
  for (const k of Object.keys(CANVAS_KINDS)) {
    if (k.startsWith('ha.') || k.startsWith('nav.') || ['market', 'sports', 'stocks', 'currency', 'clock.digital', 'clock.analog', 'clock.flip', 'clock.world', 'date', 'weather.now', 'value', 'heading', 'html'].includes(k)) assert.ok(readsScale(k), k);
    else assert.ok(!readsScale(k), k);
  }
});

const chrome = findChrome();
describe('every kind follows its text size on screen', { skip: !chrome && 'no Chrome' }, () => {
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

  // the largest text of the first card of `kind` on screen, in screen pixels (its font size times every zoom above
  // it); the HTML card's frame is sized by its --size
  const MEASURE = (kind) => `(() => {
    const only = ${JSON.stringify(MAIN[kind] ?? '')};
    const cards = [...document.querySelectorAll('.cv-item[data-kind="${kind}"]')].filter((e) => !e.hidden && !e.classList.contains('is-empty') && e.offsetWidth);
    const card = cards[${LAST.has(kind) ? 'cards.length - 1' : '0'}];
    if (!card) return null;
    const body = card.querySelector('.cv-body');
    const zoom = (el) => { let z = 1; for (let n = el; n && n !== document.documentElement; n = n.parentElement) z *= parseFloat(getComputedStyle(n).zoom) || 1; return z; };
    const frame = body.querySelector('iframe[srcdoc]');
    if (frame) {
      const m = /--size:\\s*([\\d.]+)px/.exec(frame.srcdoc);
      if (m) return { px: parseFloat(m[1]) * zoom(frame), cramped: card.classList.contains('is-cramped') };
    }
    let max = 0;
    const walk = (el) => {
      for (const n of el.childNodes) {
        if (n.nodeType === 1) walk(n);
        else if (n.nodeType === 3 && n.textContent.trim()) {
          const r = document.createRange();
          r.selectNodeContents(n);
          const b = r.getBoundingClientRect();
          if (b.width < 1 || b.height < 1 || getComputedStyle(n.parentElement).visibility === 'hidden') continue;
          if (only && !n.parentElement.closest(only)) continue;
          max = Math.max(max, parseFloat(getComputedStyle(n.parentElement).fontSize) * zoom(n.parentElement));
        }
      }
    };
    walk(body);
    return max ? { px: max, cramped: card.classList.contains('is-cramped') } : null;
  })()`;

  const measure = async (kind, scale) => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&shot=${shotOf(kind)}&cvscale=${scale}&now=2026-10-14T10:43`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))');
      return await p.eval(MEASURE(kind));
    } finally {
      await p.close();
    }
  };

  test('70 % is smaller and 150 % larger than 100 %, for every kind with text', { timeout: 900_000 }, async () => {
    const kinds = Object.keys(CANVAS_KINDS).filter((k) => !NO_TEXT.has(k));
    const bad = [];
    const queue = [...kinds];
    // a few tabs at a time
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let k = queue.shift(); k; k = queue.shift()) {
        // measured twice before it counts as a failure: on a busy runner a card can still be fitting its text
        let fail = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const [ma, mb, mc] = [await measure(k, 0.7), await measure(k, 1), await measure(k, 1.5)];
          if (!ma || !mb || !mc) {
            fail = `${k} (${shotOf(k)}): no text measured`;
            continue;
          }
          const [a, b, c] = [ma.px, mb.px, mc.px];
          // (a card that fills its box keeps its size within a few per cent: its padding grows with the text size)
          const grows = FILLS.has(k) ? c >= b * 0.95 && !mc.cramped : c > b * 1.08;
          fail = a < b * 0.92 && grows ? null : `${k} (${shotOf(k)}): ${a.toFixed(1)} / ${b.toFixed(1)} / ${c.toFixed(1)} px${mc.cramped ? ', cramped at 150 %' : ''}`;
          if (!fail) break;
        }
        if (fail) bad.push(fail);
      }
    }));
    assert.deepEqual(bad.sort(), []);
  });
});
