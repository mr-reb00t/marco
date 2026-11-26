// Touch on the calendar (#51, phase 1): the per-screen switch (screen.touch, stored only when on), the pure part
// (web/display/calTouchCore.ts: where a moved grid starts, the range it reads, the text of the sheets, privacy), and
// in headless Chrome on the real app with a temp data dir (skipped without a browser): with touch off nothing is
// drawn or listened to; with it on a tap opens an event (its text escaped), "+N" and a day number list the day, the
// arrows and Today move the month and read the range they need, a swipe opens nothing, a "Busy" event shows no place
// or notes, and the grid goes back to today by itself (?touchIdle= shortens the two minutes).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { addDays, localDate } from '../core/lib/tz.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPoll } from '../pollHub.js';
import { _resetDisplayAccess, syncDisplayKeys } from '../displayAccess.js';
import { _resetPrivacy, applyPrivacy } from '../privacy.js';
import { loadWebModules } from './webModules.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const [core] = await loadWebModules('/web/display/calTouchCore.ts');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the setting

test('screen.touch: off by default and stored only when on; configs without it stay byte for byte the same', () => {
  const plain = validateConfig(defaultConfig());
  assert.equal(plain.ok, true);
  assert.equal('touch' in plain.value.screens[0].screen, false);
  assert.deepEqual(plain.value, defaultConfig());
  // saved again: the very same bytes
  assert.equal(JSON.stringify(validateConfig(structuredClone(plain.value)).value), JSON.stringify(plain.value));
  // off is the same as absent
  const off = defaultConfig();
  off.screens[0].screen.touch = false;
  assert.equal(JSON.stringify(validateConfig(off).value), JSON.stringify(plain.value));
  // on is kept, and only that
  const on = defaultConfig();
  on.screens[0].screen.touch = true;
  const v = validateConfig(on);
  assert.equal(v.ok, true);
  assert.equal(v.value.screens[0].screen.touch, true);
  const { touch, ...rest } = v.value.screens[0].screen;
  assert.equal(JSON.stringify({ ...v.value, screens: [{ ...v.value.screens[0], screen: rest }] }), JSON.stringify(plain.value));
  // not a boolean: reported, left off
  const bad = defaultConfig();
  bad.screens[0].screen.touch = 'yes';
  const b = validateConfig(bad);
  assert.ok(b.errors.some((e) => e.path === 'screens[0].screen.touch'), JSON.stringify(b.errors));
  assert.equal('touch' in b.value.screens[0].screen, false);
});

// ---------------------------------------------------------------- the pure part

test('moving: a month grid moves by month with rows for the whole month, a span by what it shows', () => {
  const { navGrid, navKind, navAllowed, navRange, monthStart, weeksOfMonth } = core;
  assert.equal(navKind(false, 5), 'month');
  assert.equal(navKind(false, 2), 'span');
  assert.equal(navKind(true, 1), 'span');
  assert.equal(monthStart('2026-11-26', 1), '2026-12-01');
  assert.equal(monthStart('2026-11-26', 2), '2027-01-01');
  assert.equal(monthStart('2026-01-31', -1), '2025-12-01');
  assert.equal(weeksOfMonth('2026-11-01', 1), 6); // Sunday the 1st, Monday first: 6 rows
  assert.equal(weeksOfMonth('2027-02-01', 1), 4); // Monday the 1st, 28 days
  const month = { kind: 'month', weeks: 5, weekStart: 1, startOn: 'week' };
  // today: the grid the screen always shows
  assert.deepEqual(navGrid('2026-11-26', 0, month), { start: '2026-11-23', weeks: 5, month: '2026-11-01' });
  // next: the week of 1 December, enough rows for all of it
  assert.deepEqual(navGrid('2026-11-26', 1, month), { start: '2026-11-30', weeks: 5, month: '2026-12-01' });
  assert.deepEqual(navGrid('2026-11-26', -1, month), { start: '2026-09-28', weeks: 5, month: '2026-10-01' });
  assert.deepEqual(navGrid('2026-12-03', -1, month), { start: '2026-10-26', weeks: 6, month: '2026-11-01' });
  assert.deepEqual(navRange(navGrid('2026-11-26', 1, month)), ['2026-11-30', '2027-01-05']);
  // two weeks and a week: by the days shown; startOn 'today' moves from today
  assert.deepEqual(navGrid('2026-11-26', 1, { kind: 'span', weeks: 2, weekStart: 1, startOn: 'week' }), { start: '2026-12-07', weeks: 2, month: '' });
  assert.deepEqual(navGrid('2026-11-26', -1, { kind: 'span', weeks: 1, weekStart: 0, startOn: 'week' }), { start: '2026-11-15', weeks: 1, month: '' });
  assert.deepEqual(navGrid('2026-11-26', 1, { kind: 'span', weeks: 1, weekStart: 1, startOn: 'today' }), { start: '2026-12-03', weeks: 1, month: '' });
  // about a year back and two ahead (what /api/events answers)
  assert.equal(navAllowed('2026-11-26', -11, month), true);
  assert.equal(navAllowed('2026-11-26', -12, month), false);
  assert.equal(navAllowed('2026-11-26', 23, month), true);
  assert.equal(navAllowed('2026-11-26', 24, month), false);
});

test('headings of a moved grid: the month, or the days and the year', () => {
  const { navTitle, spanLabel } = core;
  assert.equal(navTitle('en', { start: '2026-11-30', weeks: 5, month: '2026-12-01' }, '2027-01-03'), '<b>December</b> <span>2026</span>');
  assert.equal(navTitle('es', { start: '2026-11-30', weeks: 5, month: '2026-12-01' }, '2027-01-03'), '<b>Diciembre</b> <span>2026</span>');
  assert.equal(spanLabel('en', '2026-12-07', '2026-12-20'), '7–20 Dec');
  assert.equal(spanLabel('en', '2026-11-30', '2026-12-06'), '30 Nov – 6 Dec');
  assert.equal(navTitle('en', { start: '2026-12-28', weeks: 1, month: '' }, '2027-01-03'), '<b>28 Dec 2026 – 3 Jan 2027</b>');
});

/** A display event as normalizeEvents makes it (only what the sheets read). */
const nev = (over = {}, ev = {}) => ({
  id: 'e1', title: 'Dinner', emoji: '', color: '#4c8dff', allDay: false, timed: true, bar: false, airbnb: false, checkoutMarker: false,
  startKey: '2026-11-26', lastKey: '2026-11-26', spanFirst: '2026-11-26', spanLast: '2026-11-26',
  startMs: Date.parse('2026-11-26T19:00:00Z'), endMs: Date.parse('2026-11-26T21:30:00Z'), days: 1, halfStart: false, halfEnd: false,
  ev: { id: 'e1', sourceId: 'local', title: 'Dinner', start: '', end: '', allDay: false, color: '#4c8dff', kind: 'ics', multiDay: false, ...ev },
  ...over,
});
const OPTS = { lang: 'en', tz: 'UTC', today: '2026-11-26', format24: true, showAmPm: false };

test('the event sheet: escaped text, the line breaks of the notes, its day and time in the screen\'s language', () => {
  const { eventSheetHtml, plainText } = core;
  const e = nev({ title: '<img src=x onerror=alert(1)> & "you"', emoji: '🍝' }, { location: 'Main <St> 5', description: 'Line one\nLine <two> & three' });
  const html = eventSheetHtml(e, '76 141 255', { ...OPTS, sourceName: () => 'Family <home>' });
  assert.ok(!html.includes('<img'), html);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;you&quot;/);
  assert.match(html, /Main &lt;St&gt; 5/);
  assert.match(html, /<div class="cs-desc">Line one\nLine &lt;two&gt; &amp; three<\/div>/);
  assert.match(html, /Thursday, 26 November/);
  assert.match(html, /19:00 – 21:30/);
  assert.match(html, /Family &lt;home&gt;/);
  assert.match(html, /--c:76 141 255/);
  // Spanish, 12 h
  const es = eventSheetHtml(e, '1 2 3', { ...OPTS, lang: 'es', format24: false, showAmPm: true });
  assert.match(es, /Jueves, 26 de noviembre/);
  assert.match(es, /7:00 PM – 9:30 PM/);
  // an all-day event over several days; a day of another year carries its year
  const trip = nev({ allDay: true, timed: false, bar: true, startKey: '2027-01-04', lastKey: '2027-01-06' });
  assert.match(eventSheetHtml(trip, '1 2 3', OPTS), /Monday, 4 January 2027 – Wednesday, 6 January 2027<\/div><div>All day/);
  // HTML notes from a calendar become plain text, line breaks kept
  assert.equal(plainText('<p>Hello<br>world</p><p>Bring <b>cake</b> &amp; tea</p>'), 'Hello\nworld\nBring cake & tea');
  assert.equal(plainText('a < b and c > d'), 'a < b and c > d');
});

test('privacy: a "Busy" event or a private screen shows no place, notes or calendar name', () => {
  const { eventSheetHtml } = core;
  const busy = nev({ title: 'Busy' }, { busy: true, location: 'Secret place', description: 'Secret notes' });
  const html = eventSheetHtml(busy, '1 2 3', { ...OPTS, sourceName: () => 'Work' });
  assert.match(html, /Busy/);
  assert.match(html, /19:00 – 21:30/);
  assert.ok(!/Secret|cs-loc|cs-desc|Work/.test(html), html);
  const priv = eventSheetHtml(nev({}, { location: 'Home', description: 'Notes' }), '1 2 3', { ...OPTS, privateNow: true });
  assert.ok(!/Home|Notes|cs-loc|cs-desc/.test(priv), priv);
});

test('the day sheet: every event of the day as the grid orders them, each one a button that opens it', () => {
  const { daySheetHtml } = core;
  const list = [
    nev({ id: 'b', title: 'Later', startMs: Date.parse('2026-11-26T18:00:00Z'), endMs: Date.parse('2026-11-26T19:00:00Z') }),
    nev({ id: 'a', title: 'Holiday <x>', allDay: true, timed: false, bar: true }),
    nev({ id: 'c', title: 'Other day', startKey: '2026-11-27', lastKey: '2026-11-27', spanFirst: '2026-11-27', spanLast: '2026-11-27' }),
  ];
  const html = daySheetHtml('2026-11-26', list, () => '1 2 3', OPTS);
  assert.deepEqual([...html.matchAll(/data-eid="(\w)"/g)].map((m) => m[1]), ['a', 'b']);
  assert.match(html, /Holiday &lt;x&gt;/);
  assert.match(html, /All day/);
  assert.match(html, /18:00 – 19:00/);
  assert.match(daySheetHtml('2026-11-28', list, () => '1 2 3', OPTS), /Nothing planned/);
});

// ---------------------------------------------------------------- in a browser

const chrome = findChrome();
describe('touch on the calendar of a running display', { skip: !chrome && 'no Chrome' }, () => {
  const realFetch = globalThis.fetch;
  let dir, server, web, browser, today, tz;
  const busyDay = () => addDays(today, 2);
  const prevDay = () => `${core.monthStart(today, -1).slice(0, 8)}10`;
  const farDay = () => `${core.monthStart(today, 2).slice(0, 8)}20`;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-touch-'));
    globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
    const c = defaultConfig();
    c.calendar.sources = [];
    c.news.feeds = [];
    c.security.displayAccess = 'open';
    tz = c.datetime.timezone;
    today = localDate(new Date(), tz);
    const timed = (id, title, date, startTime, endTime, extra = {}) => ({ id, title, allDay: false, date, endDate: date, startTime, endTime, ...extra });
    c.localEvents.items = [
      timed('l_dinner', 'Cena <b>familia</b>', today, '19:00', '21:00', { location: 'Calle <Mayor> 5', notes: 'Primera línea\nSegunda & <tercera>' }),
      timed('l_b1', 'Uno', busyDay(), '08:00', '09:00'),
      timed('l_b2', 'Dos', busyDay(), '10:00', '11:00'),
      timed('l_b3', 'Tres', busyDay(), '12:00', '13:00'),
      timed('l_b4', 'Cuatro', busyDay(), '14:00', '15:00'),
      { id: 'l_prev', title: 'Antes', allDay: true, date: prevDay(), endDate: prevDay() },
      { id: 'l_far', title: 'Excursión', allDay: true, date: farDay(), endDate: farDay() },
    ];
    const main = c.screens[0];
    main.screen.touch = true;
    Object.assign(main.calendar, { maxEventsPerDay: 2, rotateBusyDays: false, compactBusyDays: false, weeks: 5 });
    main.background.enabled = false;
    const kitchen = defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' });
    kitchen.background.enabled = false;
    c.screens.push(kitchen);
    const v = validateConfig(c);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(v.value));
    fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
    store.initStore(dir);
    _resetDisplays();
    _resetPoll();
    _resetDisplayAccess();
    _resetPrivacy();
    setServerVersion('test');
    await ensurePassword();
    syncDisplayKeys();
    const app = createApp({ version: 'test', dist: path.join(dir, 'no-dist') });
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    web = await startWeb({ api: `http://127.0.0.1:${server.address().port}` });
    browser = await launchChrome(chrome);
  });
  after(async () => {
    await browser?.close();
    await web?.close();
    closeAll();
    server?.closeAllConnections?.();
    if (server) await new Promise((r) => server.close(r));
    globalThis.fetch = realFetch;
    _resetPrivacy();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  const until = async (p, expr, ms = 15000) => {
    const end = Date.now() + ms;
    let v;
    while (Date.now() < end) {
      v = await p.eval(expr);
      if (v) return v;
      await wait(200);
    }
    return v;
  };
  /** The middle of the first element matching `sel` (or of the event chip whose title has `title`). */
  const at = (p, sel, title = '') => p.eval(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getBoundingClientRect().width > 0);
    const el = ${JSON.stringify(title)} ? els.find((e) => e.textContent.includes(${JSON.stringify(title)})) : els[0];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 };
  })()`);
  const press = async (p, from, to = from) => {
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    if (to !== from) {
      for (let i = 1; i <= 5; i++) {
        await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + ((to.x - from.x) * i) / 5, y: from.y + ((to.y - from.y) * i) / 5, button: 'left' });
      }
    }
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
    await wait(250);
  };
  const tap = async (p, sel, title = '') => {
    const pt = await at(p, sel, title);
    assert.ok(pt, `nothing to tap: ${sel} ${title}`);
    await press(p, pt);
  };
  const SHEET = `(() => { const s = document.getElementById('cal-sheet'); return s && s.classList.contains('show') ? { text: s.querySelector('.cs-body').textContent, html: s.querySelector('.cs-body').innerHTML, back: !s.querySelector('.cs-back').hidden } : null; })()`;
  const TITLE = `document.querySelector('#calendar .cal-title').textContent`;
  const RANGES = `performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/api/events?')).map((n) => new URL(n).searchParams.get('from') + '/' + new URL(n).searchParams.get('to'))`;
  const ready = (p) => until(p, `document.querySelectorAll('#calendar .wk .ev').length > 0`);

  test('touch off (another screen): no taps, no buttons, nothing marked', async () => {
    const p = await browser.page(`${web.url}/?screen=kitchen&lite=1`);
    try {
      assert.ok(await ready(p));
      const s = await p.eval(`({
        touch: !!document.querySelector('.cal-touch'), nav: document.querySelectorAll('.cal-nav, .cal-nav button').length,
        marked: document.querySelectorAll('#calendar [data-eid], #calendar [data-tday]').length,
      })`);
      assert.deepEqual(s, { touch: false, nav: 0, marked: 0 });
      await tap(p, '#calendar .wk .ev', 'Cena');
      assert.equal(await p.eval(SHEET), null);
      assert.equal(await p.eval(`!!document.getElementById('cal-sheet')`), false);
    } finally {
      await p.close();
    }
  });

  test('touch on: an event opens with its text escaped; +N and a day list the day; a swipe opens nothing', async () => {
    const p = await browser.page(`${web.url}/?screen=living-room&lite=1`);
    try {
      assert.ok(await ready(p));
      assert.equal(await p.eval(`document.querySelectorAll('#calendar .cal-nav button').length`), 3);
      // a swipe that starts on the event: nothing opens
      const pt = await at(p, '#calendar .wk .ev[data-eid]', 'Cena');
      await press(p, pt, { x: pt.x + 260, y: pt.y });
      assert.equal(await p.eval(SHEET), null);
      // a tap: the event, as text
      await press(p, pt);
      const ev = await until(p, SHEET);
      assert.ok(ev, 'the sheet opened');
      assert.match(ev.text, /Cena <b>familia<\/b>/);
      assert.ok(!/<b>familia/.test(ev.html), 'the title is text, not HTML');
      assert.match(ev.text, /Calle <Mayor> 5/);
      assert.match(ev.text, /Primera línea\nSegunda & <tercera>/);
      assert.match(ev.text, /19:00 – 21:00/);
      assert.equal(ev.back, false);
      // closes with its button
      await tap(p, '#cal-sheet .cs-close');
      assert.equal(await p.eval(SHEET), null);
      // "+2 more": the four events of that day; one of them opens, Back returns to the list, a tap outside closes
      await tap(p, `#calendar .more[data-tday="${busyDay()}"]`);
      const day = await until(p, SHEET);
      assert.ok(day);
      assert.equal(await p.eval(`document.querySelectorAll('#cal-sheet .cs-row').length`), 4);
      assert.match(day.text, /Uno.*Dos.*Tres.*Cuatro/s);
      await tap(p, '#cal-sheet .cs-row', 'Cuatro');
      const one = await p.eval(SHEET);
      assert.match(one.text, /Cuatro/);
      assert.match(one.text, /14:00 – 15:00/);
      assert.equal(one.back, true);
      await tap(p, '#cal-sheet .cs-back');
      assert.equal(await p.eval(`document.querySelectorAll('#cal-sheet .cs-row').length`), 4);
      await press(p, { x: 8, y: 8 });
      assert.equal(await p.eval(SHEET), null);
      // the day number lists its day too
      await tap(p, `#calendar .num[data-tday="${today}"]`);
      assert.match((await p.eval(SHEET)).text, /Cena/);
      await tap(p, '#cal-sheet .cs-close');
      assert.deepEqual(p.errors().map((e) => JSON.stringify(e.params).slice(0, 200)).filter((e) => !/vite/i.test(e)), []);
    } finally {
      await p.close();
    }
  });

  test('previous, next and Today move the month and read the range it needs; idle returns to today', async () => {
    const p = await browser.page(`${web.url}/?screen=living-room&lite=1&touchIdle=2500`);
    try {
      assert.ok(await ready(p));
      const home = await p.eval(TITLE);
      const month = (n) => core.navGrid(today, n, { kind: 'month', weeks: 5, weekStart: 1, startOn: 'week' });
      // two months ahead: the far event shows, the heading says which month, the range of that grid was read
      await tap(p, '#calendar .cal-nav [data-nav="1"]');
      await tap(p, '#calendar .cal-nav [data-nav="1"]');
      const far = month(2);
      assert.ok(await until(p, `[...document.querySelectorAll('#calendar .wk .ev')].some((e) => e.textContent.includes('Excursión'))`), 'the far event shows');
      const title = await p.eval(TITLE);
      assert.notEqual(title, home);
      assert.match(title, new RegExp(far.month.slice(0, 4)));
      assert.equal(await p.eval(`document.querySelector('#calendar .cal-today').classList.contains('is-away')`), true);
      const ranges = await p.eval(RANGES);
      assert.ok(ranges.includes(core.navRange(far).join('/')), `${core.navRange(far)} in ${ranges}`);
      // Today: back at once
      await tap(p, '#calendar .cal-nav [data-nav="0"]');
      assert.equal(await p.eval(TITLE), home);
      assert.equal(await p.eval(`!!document.querySelector('#calendar.cal-away')`), false);
      // the month before: its event shows
      await tap(p, '#calendar .cal-nav [data-nav="-1"]');
      assert.ok(await until(p, `[...document.querySelectorAll('#calendar .wk .ev')].some((e) => e.textContent.includes('Antes'))`));
      assert.ok((await p.eval(RANGES)).includes(core.navRange(month(-1)).join('/')));
      // an event of that month opens, then nothing more is touched: the sheet closes and the grid is on today again
      await tap(p, '#calendar .wk .ev[data-eid]', 'Antes');
      assert.ok(await p.eval(SHEET));
      assert.ok(await until(p, `!document.getElementById('cal-sheet').classList.contains('show') && !document.querySelector('#calendar.cal-away')`, 8000));
      assert.equal(await p.eval(TITLE), home);
    } finally {
      await p.close();
    }
  });

  test('a carousel holds the screen while a sheet is open or the month is moved, and goes on after', async () => {
    const p = await browser.page(`${web.url}/?demo=1&carousel=1&touch=1&stepSec=6&lite=1&fade=0&rotate=0&compact=0`);
    const PRESET = `(document.getElementById('app').className.match(/preset-(\\w+)/)?.[1] ?? '')`;
    try {
      assert.ok(await until(p, `${PRESET} === 'bigCalendar' && document.querySelectorAll('#calendar .wk .ev[data-eid]').length > 0`));
      await tap(p, '#calendar .wk .ev[data-eid]');
      assert.ok(await p.eval(SHEET));
      await wait(7500);
      assert.equal(await p.eval(PRESET), 'bigCalendar', 'held while the sheet is open');
      await tap(p, '#cal-sheet .cs-close');
      // a moved month holds it too
      await tap(p, '#calendar .cal-nav [data-nav="1"]');
      await wait(7500);
      assert.equal(await p.eval(PRESET), 'bigCalendar', 'held while away from today');
      await tap(p, '#calendar .cal-nav [data-nav="0"]');
      assert.ok(await until(p, `${PRESET} !== 'bigCalendar'`, 15000), 'the carousel goes on');
    } finally {
      await p.close();
    }
  });

  test('a private screen: the event shows as Busy with its time, no place and no notes', async () => {
    applyPrivacy({ mode: 'on', screenIds: ['s_main'] });
    const p = await browser.page(`${web.url}/?screen=living-room&lite=1`);
    try {
      assert.ok(await ready(p));
      await tap(p, '#calendar .wk .ev[data-eid]', 'Busy');
      const s = await until(p, SHEET);
      assert.ok(s, 'the busy event opens');
      assert.match(s.text, /Busy/);
      assert.match(s.text, /19:00 – 21:00/);
      assert.ok(!/Cena|Mayor|Primera/.test(s.text), s.text);
      assert.ok(!/cs-loc|cs-desc/.test(s.html));
    } finally {
      await p.close();
      applyPrivacy({ mode: 'off', screenIds: ['s_main'] });
    }
  });
});
