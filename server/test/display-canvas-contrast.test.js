// Personalizado on the light theme: the light cards (light glass, solid, a card's own light material, the cards on a
// light bar) carry dark text that has to read over any photo. Each demo layout is rendered in headless Chrome with
// &theme=light over the animated backdrop (translucent glass), and every piece of secondary and tertiary text inside a
// light card is checked against the card's own surface laid over a dark photo, the worst case: secondary text at
// least 4.5:1, tertiary at least 3:1, and no text shadow on dark text (it blurs it). Probes of the small texts that
// carried dark-glass colours (a clock's seconds, the chance of rain, the date's weekday, a countdown's day) are put in
// a light card and checked the same way (skipped without a browser).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

const SHOTS = ['show.home', 'show.data', 'show.bento', 'kinds', 'clocks', 'household', 'controls', 'lights', 'ha', 'media', 'sidebar', 'commute'];

// in the page: the text of the light cards, each with its contrast against the card over a dark photo
const SAMPLE = `(() => {
  const BACK = [48, 48, 48];
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
  // a colour as the browser computes it (a custom property holds the declared text)
  const probe = document.createElement('i');
  document.body.appendChild(probe);
  const resolve = (el, v) => {
    el.appendChild(probe);
    probe.style.color = v;
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  };
  // the surface of a card: its own, or the bar's for a card without one
  const surface = (c) => {
    let bg = parse(getComputedStyle(c).backgroundColor);
    if ((!bg || bg[3] === 0) && c.classList.contains('is-none')) bg = parse(getComputedStyle(c.closest('.side') || c).backgroundColor);
    return bg && bg[3] > 0 ? bg : null;
  };
  const out = { cards: 0, checked: 0, bad: [] };
  // a light card: a surface with body that stays light over the dark photo, and dark text on it
  const light = [...document.querySelectorAll('.cv-card')].filter((c) => {
    const bg = surface(c);
    const ink = parse(getComputedStyle(c).color);
    return c.offsetWidth && bg && bg[3] >= 0.5 && lum(over(bg, BACK)) > 0.35 && ink && lum(ink) < 0.1;
  });
  // probes of the texts that used dark-glass colours, in the first light card
  const PROBES = [
    ['clock', '<span class="clock digital"><span class="sec">59</span></span>', '.sec', 4.5],
    ['chance of rain', '<div class="cv-wx-hours"><span class="p">60%</span></div>', '.p', 3],
    ['weekday', '<span class="cv-date-wd">Jueves</span>', '.cv-date-wd', 3],
    ['countdown', '<div class="cd is-today" style="--tint:#ffb3de;--deep:#94386f"><span class="cd-when">Hoy</span></div>', '.cd-when', 3],
    ['next event', '<div class="cv-next-ev" style="--tint:#ffb3de;--deep:#94386f"><span class="cv-next-when">Hoy</span></div>', '.cv-next-when', 3],
  ];
  if (light[0]) {
    const host = document.createElement('div');
    host.className = 'cv-contrast-probe';
    host.style.cssText = 'position:absolute;left:0;top:0';
    host.innerHTML = PROBES.map((p) => p[1]).join('');
    light[0].querySelector('.cv-body').appendChild(host);
  }
  for (const card of light) {
    out.cards++;
    const bg = over(surface(card), BACK);
    const fg2 = resolve(card, 'var(--fg-2)');
    const fg3 = resolve(card, 'var(--fg-3)');
    const where = card.closest('.cv-item')?.dataset.kind ?? '?';
    for (const el of card.querySelectorAll('.cv-body *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden') continue;
      // the caption of a photo sits on the photo, not on the card
      if (el.closest('.cv-ph-cap, .cv-photo')) continue;
      const txt = el.textContent.trim().slice(0, 30);
      if (s.textShadow !== 'none') out.bad.push(where + ' "' + txt + '": text shadow ' + s.textShadow);
      // only text straight on the card (a chip or a coloured row has its own surface), at full opacity (a past
      // event is dimmed on purpose)
      let flat = true;
      for (let a = el; a && a !== card; a = a.parentElement) {
        const st = getComputedStyle(a);
        const b = parse(st.backgroundColor);
        if (Number(st.opacity) < 1 || (b && b[3] > 0.04) || (st.backgroundImage !== 'none' && a !== el)) flat = false;
      }
      if (!flat) continue;
      const fill = el instanceof SVGElement ? s.fill : s.color;
      const probeOf = el.closest('.cv-contrast-probe') ? PROBES.find((p) => el.matches(p[2])) : null;
      const need = probeOf ? probeOf[3] : fill === fg2 ? 4.5 : fill === fg3 ? 3 : 0;
      if (!need) continue;
      const c = parse(fill);
      if (!c) continue;
      const k = ratio(over(c, bg), bg);
      out.checked++;
      if (k < need) out.bad.push(where + ' "' + txt + '" ' + (probeOf ? probeOf[0] : fill === fg2 ? 'secondary' : 'tertiary') + ' ' + fill + ': ' + k.toFixed(2) + ':1 < ' + need);
    }
  }
  return out;
})()`;

const chrome = findChrome();
describe('light cards read on the light theme', { skip: !chrome && 'no Chrome' }, () => {
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

  test('secondary text at least 4.5:1, tertiary 3:1, no shadow, on every light card over a dark photo', { timeout: 600_000 }, async () => {
    const bad = [];
    let checked = 0;
    for (const shot of SHOTS) {
      const p = await browser.page(`${web.url}/?demo=1&lite=1&preset=canvas&lang=es&theme=light&cvbg=ambient&shot=${shot}&now=2026-10-15T18:42`, { width: 1920, height: 1080 });
      try {
        await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
        const r = await p.eval(SAMPLE);
        assert.ok(r.cards > 0, `${shot}: no light card`);
        checked += r.checked;
        bad.push(...r.bad.map((b) => `${shot}: ${b}`));
      } finally {
        await p.close();
      }
    }
    assert.ok(checked > 100, `only ${checked} texts checked`);
    assert.deepEqual(bad, []);
  });
});
