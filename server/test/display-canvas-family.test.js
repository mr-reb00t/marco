// Personalizado "Familia y hogar" cards (web/display/widgets/canvas/family.ts): they reuse the kids layouts' renderers
// and data path (widgets/kids.ts, GET /api/display/family, the same tap path and its trust rules), the highlights
// pills and the announcements on screen; countdowns and news cards read the data the other layouts already have.
// The demo layouts (&shot=family, &shot=household) are rendered in headless Chrome (skipped without a browser): no
// overlap, privacy like the kids layouts (initials, no stars or rewards, no taps), taps tick a routine in every card
// that shows it, never in the admin's preview, and the announcement card is hidden when there is none.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CANVAS_KINDS, canvasEventsNeed } from '../core/canvasCore.js';
import { loadWebModules } from './webModules.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const FAMILY_CAT = Object.keys(CANVAS_KINDS).filter((k) => CANVAS_KINDS[k].cat === 'family');

test('every "Familia y hogar" kind has an adapter, and the registry draws them', () => {
  assert.deepEqual(FAMILY_CAT.sort(), [
    'announcement', 'birthdays', 'family.chores', 'family.members', 'family.points', 'family.rewards', 'family.routines', 'highlights', 'meals.today', 'meals.week',
  ]);
  const src = read('web/display/widgets/canvas/family.ts');
  const block = src.slice(src.indexOf('export const FAMILY_ADAPTERS'));
  for (const k of FAMILY_CAT) assert.ok(block.includes(k.includes('.') ? `'${k}':` : `  ${k}`), `${k} has no adapter`);
  assert.match(read('web/display/widgets/canvas/registry.ts'), /\.\.\.FAMILY_ADAPTERS,/);
  // the family data kinds are the ones that need GET /api/display/family
  assert.deepEqual(FAMILY_CAT.filter((k) => CANVAS_KINDS[k].family).sort(), ['family.chores', 'family.members', 'family.points', 'family.rewards', 'family.routines', 'meals.today', 'meals.week']);
});

test('the family cards reuse the kids renderers and data path: no request, no tap path of their own', () => {
  const fam = read('web/display/widgets/canvas/family.ts');
  assert.match(fam, /from '\.\.\/kids'/);
  for (const f of ['routineCardsHtml', 'personRowHtml', 'rewardRowsHtml', 'mealRowsHtml', 'mealsGridHtml', 'choreHtml', 'ChoreTaps', 'fitRoutineCards']) assert.ok(fam.includes(f), f);
  assert.match(fam, /from '\.\.\/highlights'/);
  assert.equal(/\bfetch\(|\bapi\.|XMLHttpRequest|EventSource/.test(fam), false, 'family.ts asks for nothing itself');
  assert.match(fam, /env\.toggleChore\(id, done\)/);
  const kids = read('web/display/widgets/kids.ts');
  // the kids layouts draw with the same exported pieces
  assert.match(kids, /routineCardsHtml\(f!, people, tick, \{ touch: this\.taps\.active, pop: this\.popId \}\)/);
  assert.match(kids, /personRowHtml\(f!, m, tick,/);
  assert.match(kids, /rewardRowsHtml\(f\)/);
  assert.match(kids, /mealsGridHtml\(meals, today,/);
  const main = read('web/display/main.ts');
  // one family state and one rule for taps: the kids layouts and the canvas cards both go through familyShown()
  assert.match(main, /family: \(\) => familyShown\(current\(\)\),\n\s+toggleChore: \(id, done\) => toggleChore\(id, done\),/);
  assert.match(main, /const \{ state: fam, touch \} = familyShown\(tick\);/);
  assert.match(main, /return \{ state: fam, touch: kidsTouch\(\) && !stale && !!fam\?\.touch \};/);
  assert.match(main, /function kidsTouch\(\): boolean \{\n\s+return !!state\.family\?\.touch && !!ctx\.cfg\.family\?\.touch && \(state\.online \|\| state\.demo\) && !state\.config\?\.privacy\?\.active && !isPreview;/);
  // going on or offline draws the family cards again (taps follow the online state), as it does the kids layouts
  assert.match(main, /if \(kids\.active\) renderKids\(current\(\)\);\n\s+\/\/[^\n]*\n\s+canvasView\.onData\('family'\);/);
  // the corner toast steps aside only for an announcement card laid out in this orientation
  assert.match(main, /announcements\.setDocked\(on && canvasView\.shows\('announcement'\)\)/);
  // the family data is asked for on a canvas with a family card (a Rotativa's cards too), as on a kids layout
  assert.match(main, /isKidsPreset\(p\) \|\| \(p === 'canvas' && canvasCards\(ctx\.cfg\.canvas\?\.items\)\.some\(\(it\) => !it\.disabled && CANVAS_KINDS\[it\.kind\]\?\.family\)\)/);
  // the server's tap route is the kids one (touch on, not private, a known display, the screen's members)
  const route = read('server/routes/family.js');
  assert.match(route, /r\.post\('\/display\/family\/toggle'/);
  assert.match(route, /!sf\?\.touch \|\| !trusted \|\| screenPrivacy\(cfg, screen\)\.active/);
});

test('countdowns and news cards read the data the other layouts have; birthdays widen the events range', () => {
  assert.match(read('web/display/widgets/canvas/calendar.ts'), /cds\.render\(state\.countdowns, env\.now\(\)\.dayKey\)/);
  assert.match(read('web/display/widgets/canvas/content.ts'), /n\.setData\(state\.news\)/);
  const item = (kind, props = {}) => ({ kind, props });
  assert.equal(canvasEventsNeed({ items: [item('birthdays')] }), 32);
  assert.equal(canvasEventsNeed({ items: [item('highlights')] }), 3);
  assert.equal(canvasEventsNeed({ items: [item('family.routines'), item('meals.week')] }), 0);
});

test('display strings of the family cards: six languages, no em dashes', async () => {
  const [i18n] = await loadWebModules('/web/shared/i18n.ts');
  for (const k of ['cvFamilyOff', 'cvPointsOff', 'cvNoRewards', 'cvNoBirthdays']) {
    for (const l of ['es', 'en', 'pt', 'nl', 'da', 'pl']) {
      const s = i18n.DICTS[l][k];
      assert.ok(s, `${k} ${l}`);
      assert.equal(/—|–/.test(s), false, `${k} ${l}`);
    }
  }
});

const chrome = findChrome();
describe('family cards in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  async function open(q, expr, size = { width: 1920, height: 1080 }) {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&now=2026-03-04T10:43&${q}`, size);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))');
      const value = await p.eval(expr);
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      return { value, errors };
    } finally {
      await p.close();
    }
  }

  // the words of a card: its text nodes one by one (no emoji or punctuation)
  const CARDS = `(() => {
    const words = (el) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const out = [];
      while (w.nextNode()) if (w.currentNode.parentElement.closest('.fit-hide') === null) out.push(w.currentNode.textContent);
      return out.join(' ').replace(/[^\\p{L}\\p{N}()]+/gu, ' ').trim();
    };
    return [...document.querySelectorAll('.cv-item:not([hidden])')].map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.dataset.canvasItem, kind: e.dataset.kind, x: r.left, y: r.top, w: r.width, h: r.height, empty: e.classList.contains('is-empty'),
        cramped: e.classList.contains('is-cramped'), text: words(e.querySelector('.cv-body')) };
    });
  })()`;
  const overlap = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  const card = (cards, kind, i = 0) => cards.filter((c) => c.kind === kind)[i];

  for (const [shot, q, size] of [
    ['family', '', null], ['household', '&announce=info', null],
    ['family', '&theme=light', null], ['family', '', { width: 1080, height: 1920 }], ['household', '', { width: 1080, height: 1920 }],
  ]) {
    test(`${shot}${q}${size ? ' portrait' : ''}: every card draws, none overlapping or cut, no page error`, async () => {
      const { value: cards, errors } = await open(`preset=canvas&shot=${shot}${q}`, CARDS, size ?? undefined);
      assert.deepEqual(errors, []);
      assert.ok(cards.length >= (size ? 5 : 8), JSON.stringify(cards.map((c) => c.kind)));
      for (const c of cards) {
        assert.ok(c.w > 20 && c.h > 20, `${c.kind} has no size`);
        assert.equal(c.cramped, false, `${c.kind} does not fit its card`);
        if (!(c.kind === 'announcement' && !q.includes('announce'))) assert.ok(c.text.length > 0, `${c.kind} drew nothing`);
      }
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) assert.equal(overlap(cards[i], cards[j]), false, `${cards[i].kind} overlaps ${cards[j].kind}`);
    });
  }

  test('the family data: names, stars, rewards, routines and meals of the demo family', async () => {
    const { value: cards } = await open('preset=canvas&shot=family', CARDS);
    const routines = card(cards, 'family.routines');
    for (const n of ['Lucía', 'Mateo', 'Sofía']) assert.ok(routines.text.includes(n), n);
    const one = card(cards, 'family.routines', 1);
    assert.ok(one.text.startsWith('Mateo'), one.text);
    assert.equal(/Lucía|Sofía/.test(one.text), false, 'one person only');
    assert.match(card(cards, 'family.points').text, /^1 Lucía 13 2 Mateo 9 3 Sofía 5$/);
    assert.match(card(cards, 'family.rewards').text, /Helado/);
    assert.match(card(cards, 'meals.today').text, /Yogur con fruta/);
    assert.ok(card(cards, 'family.chores').text.length > 0);
  });

  test('private screen: initials, no photos, no stars or rewards, no taps (as the kids layouts)', async () => {
    const { value, errors } = await open('preset=canvas&shot=family&private=1', `(() => ({
      cards: ${CARDS},
      photos: document.querySelectorAll('#canvas .k-av-img').length,
      buttons: document.querySelectorAll('#canvas [data-chore]').length,
      touch: document.querySelectorAll('#canvas .k-touch').length,
      names: [...document.querySelectorAll('#canvas .cvf-person .k-name')].map((e) => e.textContent),
      stars: document.querySelectorAll('#canvas .k-stars, #canvas .k-pts').length,
      locks: [...document.querySelectorAll('#canvas .k-private')].map((e) => e.closest('.cv-item').dataset.kind),
    }))()`);
    assert.deepEqual(errors, []);
    assert.equal(value.photos, 0);
    assert.equal(value.buttons, 0);
    assert.equal(value.touch, 0);
    assert.ok(value.names.length > 0);
    for (const n of value.names) assert.ok(n.length <= 2, `"${n}" is not initials`);
    assert.equal(value.stars, 0);
    assert.deepEqual(value.locks.sort(), ['family.points', 'family.rewards']);
    // family.privacy 'hide': no members or routines at all
    const hide = await open('preset=canvas&shot=family&private=1&famPrivacy=hide', CARDS);
    for (const k of ['family.routines', 'family.members', 'family.chores']) assert.match(card(hide.value, k).text, /Private mode/, k);
    assert.equal(/Lucía|Mateo|Sofía|\bL\b/.test(hide.value.map((c) => c.text).join(' ')), false);
    assert.match(card(hide.value, 'meals.today').text, /Yogur con fruta/, 'meals stay, as on the kids layouts');
  });

  test('a tap on a routine ticks it in every card that shows it; never in the admin preview', async () => {
    const { value, errors } = await open('preset=canvas&shot=family', `(async () => {
      const chores = document.querySelector('.cv-item[data-kind="family.chores"]');
      const btn = chores.querySelector('[data-chore][data-done="0"]');
      const id = btn.dataset.chore;
      const state = () => [...document.querySelectorAll('#canvas [data-chore="' + id + '"]')].map((b) => b.dataset.done);
      const before = state();
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const after = state();
      // a bouncing finger: a second tap within 700 ms does nothing
      chores.querySelector('[data-chore="' + id + '"]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return { before, after, bounce: state(), big: getComputedStyle(chores.querySelector('[data-chore]')).minHeight };
    })()`);
    assert.deepEqual(errors, []);
    assert.ok(value.before.length >= 1 && value.before.every((d) => d === '0'), JSON.stringify(value));
    assert.ok(value.after.every((d) => d === '1'), JSON.stringify(value));
    assert.deepEqual(value.bounce, value.after);
    assert.ok(parseFloat(value.big) >= 71.9, `touch targets of at least 7.2rem (${value.big})`);
    const preview = await open('preset=canvas&shot=family&preview=1', `document.querySelectorAll('#canvas [data-chore]').length`);
    assert.equal(preview.value, 0);
    const off = await open('preset=canvas&shot=family&touch=0', `document.querySelectorAll('#canvas [data-chore]').length`);
    assert.equal(off.value, 0);
  });

  test('Familia off: the family cards say where to turn it on; birthdays, highlights and meals of the week', async () => {
    const off = await open('preset=canvas&shot=family&family=0', CARDS);
    for (const k of ['family.routines', 'family.members', 'family.points', 'family.rewards', 'family.chores', 'meals.today']) {
      assert.match(card(off.value, k).text, /Turn on Family/, k);
    }
    const { value: cards } = await open('preset=canvas&shot=household', CARDS);
    const bd = card(cards, 'birthdays').text;
    assert.match(bd, /^Elena \(39\) Today/, bd);
    assert.ok(bd.indexOf('Grandpa Luis') < bd.indexOf('Mateo (7)'), 'soonest first');
    assert.match(card(cards, 'highlights').text, /In 17 min/);
    const week = card(cards, 'meals.week').text;
    for (const d of ['Mon', 'Sun', 'Paella']) assert.ok(week.includes(d), d);
  });

  test('the announcement card shows the newest announcement and is hidden when there is none', async () => {
    const none = await open('preset=canvas&shot=household', CARDS);
    assert.equal(card(none.value, 'announcement').empty, true);
    const one = await open('preset=canvas&shot=household&announce=all', `(() => ({
      cards: ${CARDS}, docked: document.getElementById('alerts').classList.contains('an-docked'),
    }))()`);
    const an = card(one.value.cards, 'announcement');
    assert.equal(an.empty, false);
    assert.match(an.text, /Rain in 20 minutes|Garage door is open/, an.text);
    assert.equal(one.value.docked, true, 'no corner toast as well');
    const other = await open('preset=canvas&shot=family&announce=info', `document.getElementById('alerts').classList.contains('an-docked')`);
    assert.equal(other.value, false);
  });

  test('light theme: the highlights pills are a light chip with dark ink, readable on the light card', async () => {
    const r = await open('preset=canvas&shot=household&theme=light', `(() => {
      const pill = document.querySelector('#canvas .cv-hl .hl-pill');
      const tt = pill && pill.querySelector('.hl-tt');
      return pill && { bg: getComputedStyle(pill).backgroundColor, ink: getComputedStyle(tt || pill).color };
    })()`);
    assert.ok(r.value, 'a pill is drawn');
    const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const [ir, ig, ib] = rgb(r.value.ink);
    assert.ok(ir + ig + ib < 200, `dark ink: ${r.value.ink}`);
    const [br, bg, bb, ba = 1] = rgb(r.value.bg);
    // a dark capsule (the glass of the photo layouts) would be dark and nearly opaque
    assert.ok(br + bg + bb > 600 || ba < 0.2, `light chip: ${r.value.bg}`);
  });
});
