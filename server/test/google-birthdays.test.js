// Google Contacts birthdays (#43): through the linked Google account they come as eventType 'birthday' entries of the
// primary calendar. They get the birthday look (kind 'birthdays', the Cumpleaños emoji, tidied titles), and one already
// in Marco's own birthday list (same name and day) is shown once, as Marco's entry with the age. Google is never called:
// the source's items come from its disk cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSourceEvents, dropOwnBirthdays, googleToRaw } from '../calendars.js';
import { privatizeEvents } from '../core/privacy.js';
import { RULES } from './helpers.js';

const TZ = 'Europe/Madrid';
const gsrc = { id: 'c_g', type: 'google', name: 'Ana', color: '#4ea8de', emoji: '📅', kind: 'generic', enabled: true, refreshMin: 5 };
const item = (summary, date, over = {}) => ({
  id: `g_${summary}_${date}`, status: 'confirmed', summary, start: { date }, end: { date: date.slice(0, 8) + String(Number(date.slice(8)) + 1).padStart(2, '0') },
  eventType: 'birthday', birthdayProperties: { type: 'birthday', contact: 'people/c1' }, ...over,
});
const opts = (over = {}) => ({ rules: RULES, eventRules: [], from: '2026-03-01', to: '2026-03-31', tz: TZ, lang: 'es', detail: true, birthdayEmoji: '🥳', ...over });
const build = (items, over) => buildSourceEvents(items.map(googleToRaw).filter(Boolean), gsrc, opts(over));

test('googleToRaw: birthdays (and the owner\'s own) get kind birthdays; anniversaries, custom dates and plain events do not', () => {
  assert.equal(googleToRaw(item('Ana Prado', '2026-03-14')).kind, 'birthdays');
  assert.equal(googleToRaw(item('Ana Prado', '2026-03-14', { birthdayProperties: { type: 'self' } })).kind, 'birthdays');
  assert.equal(googleToRaw(item('Ana Prado', '2026-03-14', { birthdayProperties: undefined })).kind, 'birthdays');
  for (const type of ['anniversary', 'custom', 'other']) assert.equal(googleToRaw(item('Boda', '2026-03-14', { birthdayProperties: { type } })).kind, undefined, type);
  assert.equal(googleToRaw(item('Reunión', '2026-03-14', { eventType: 'default', birthdayProperties: undefined })).kind, undefined);
  assert.equal(googleToRaw(item('Ana Prado', '2026-03-14', { status: 'cancelled' })), null);
});

test('a Google birthday looks like a birthday: kind, the Cumpleaños emoji, the title tidied as set', () => {
  let [e] = build([item('Ana Prado', '2026-03-14')]);
  assert.deepEqual([e.kind, e.emoji, e.title, e.color], ['birthdays', '🥳', 'Ana Prado', '#4ea8de']);
  // "Cumpleaños" also matches the 🎂 icon rule, which wins like it does for any event
  [e] = build([item('Cumpleaños de Ana Prado', '2026-03-14')]);
  assert.deepEqual([e.kind, e.emoji, e.title, e.titleWhy, e.originalTitle], ['birthdays', '🎂', 'Ana Prado', 'birthday', 'Cumpleaños de Ana Prado']);
  [e] = build([item("Ana Prado's birthday", '2026-03-14')], { tidyBirthdays: false });
  assert.deepEqual([e.kind, e.title], ['birthdays', "Ana Prado's birthday"]);
  // the rest of the calendar keeps the calendar's emoji and kind
  [e] = build([item('Llamar a Pepa', '2026-03-14', { eventType: 'default', birthdayProperties: undefined })]);
  assert.deepEqual([e.kind, e.emoji], ['generic', '📅']);
  // a style rule's emoji still wins
  const style = { id: 'f_s', enabled: true, action: 'style', match: 'ana', matchMode: 'contains', field: 'title', sourceIds: [], replaceWith: '', emoji: '⭐', color: null, countdown: false, note: '' };
  [e] = build([item('Ana Prado', '2026-03-14')], { eventRules: [style] });
  assert.equal(e.emoji, '⭐');
  // a calendar already set as Cumpleaños keeps its own emoji
  [e] = buildSourceEvents([googleToRaw(item('Ana Prado', '2026-03-14'))], { ...gsrc, kind: 'birthdays', emoji: '🎈' }, opts());
  assert.deepEqual([e.kind, e.emoji], ['birthdays', '🎈']);
});

test('an ICS event is not changed by any of this', () => {
  const raw = { uid: 'x', title: 'Ana Prado', description: '', location: '', allDay: true, start: '2026-03-14', end: '2026-03-15' };
  const [e] = buildSourceEvents([raw], { ...gsrc, type: 'ics' }, opts());
  assert.deepEqual([e.kind, e.emoji, e.title], ['generic', '📅', 'Ana Prado']);
});

test('dropOwnBirthdays: same name and day as Marco\'s list goes; another day or person stays; case, accents and 29 February', () => {
  const evs = build([
    item('Cumpleaños de ANA prado', '2026-03-14'),
    item('Ana Prado', '2026-03-15'),
    item('Luis Prado', '2026-03-14'),
    item('Jose Muñoz', '2026-03-01'),
    item('Reunión con Ana Prado', '2026-03-14', { eventType: 'default', birthdayProperties: undefined }),
  ]);
  const items = [
    { id: 'b_1', name: 'Ána Prado', month: 3, day: 14, year: 1990, emoji: '' },
    { id: 'b_2', name: 'José Muñoz', month: 2, day: 29, year: 2000, emoji: '' },
  ];
  const kept = dropOwnBirthdays(evs, items, { from: '2026-02-28', to: '2026-04-01' });
  assert.deepEqual(kept.map((e) => [e.title, e.start]), [
    ['Ana Prado', '2026-03-15'],
    ['Luis Prado', '2026-03-14'],
    ['Reunión con Ana Prado', '2026-03-14'],
  ]);
  // 29 February on the 28th too
  const feb = build([item('José Muñoz', '2026-02-28')], { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(dropOwnBirthdays(feb, items, { from: '2026-01-31', to: '2026-03-01' }).length, 0);
  assert.equal(dropOwnBirthdays(evs, [], { from: '2026-02-28', to: '2026-04-01' }), evs);
});

test('private screens: a Google birthday in a calendar shown as busy is busy time, not a birthday', () => {
  const [e] = build([item('Ana Prado', '2026-03-14')], { detail: false });
  const cfg = { calendar: { sources: [gsrc] }, localEvents: {}, birthdays: {} };
  const [p] = privatizeEvents([e], cfg, 'es');
  assert.deepEqual([p.kind, p.emoji, p.busy], ['generic', '', true]);
  const [k] = privatizeEvents([e], { ...cfg, calendar: { sources: [{ ...gsrc, privacy: 'keep' }] } }, 'es');
  assert.equal(k.kind, 'birthdays');
});

test('events of a screen: Marco\'s own entry wins over Google\'s, only while Marco\'s list is on that screen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-gbday-'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('no network in tests'));
  try {
    const store = await import('../store.js');
    store.initStore(dir);
    const cfg = structuredClone(store.getConfig());
    const src = { ...gsrc, googleAccount: 'owner@example.com', googleCalendarId: 'primary', refreshMin: 1440 };
    cfg.calendar.sources = [src];
    cfg.birthdays.items = [{ id: 'b_ana', name: 'Ana Prado', month: 3, day: 14, year: 1990, emoji: '' }];
    assert.equal(store.saveConfig(cfg).ok, true, JSON.stringify(store.saveConfig(cfg).errors));
    // the disk cache a previous fetch would have left (fresh, covering the window): nothing is fetched
    fs.writeFileSync(path.join(store.paths.cache, 'src_c_g.json'), JSON.stringify({
      key: 'google|owner@example.com|primary', fetchedAt: Date.now(), window: { from: '2025-01-01', to: '2027-12-31' },
      items: [item('Ana Prado', '2026-03-14'), item('Luis Prado', '2026-03-20')],
    }));
    const { getEvents, previewEvents } = await import('../calendars.js');
    const r = await getEvents({ from: '2026-03-01', to: '2026-03-31' });
    assert.deepEqual(r.events.map((e) => [e.sourceId, e.title, e.kind, e.age]), [
      ['birthdays', 'Ana Prado', 'birthdays', 36],
      ['c_g', 'Luis Prado', 'birthdays', undefined],
    ]);
    // Marco's list off: Google's entry is shown
    const off = await previewEvents({ from: '2026-03-01', to: '2026-03-31', overrides: { birthdays: { ...store.getConfig().birthdays, enabled: false } } });
    assert.deepEqual(off.events.map((e) => [e.sourceId, e.title]), [['c_g', 'Ana Prado'], ['c_g', 'Luis Prado']]);
    // a screen without Marco's list: Google's entry too
    const screen = structuredClone(store.getConfig().screens[0]);
    screen.calendar.sourceIds = ['c_g'];
    const only = await getEvents({ from: '2026-03-01', to: '2026-03-31', screen });
    assert.deepEqual(only.events.map((e) => e.title), ['Ana Prado', 'Luis Prado']);
    // private mode shows the Google calendar more than Marco's list: Google's entry stays, so Ana is not hidden
    const more = await previewEvents({ from: '2026-03-01', to: '2026-03-31', overrides: { birthdays: { ...store.getConfig().birthdays, privacy: 'hide' } } });
    assert.deepEqual(more.events.map((e) => [e.sourceId, e.title]), [['c_g', 'Ana Prado'], ['c_g', 'Luis Prado']]);
    const same = await previewEvents({ from: '2026-03-01', to: '2026-03-31', overrides: { birthdays: { ...store.getConfig().birthdays, privacy: 'busy' } } });
    assert.deepEqual(same.events.map((e) => [e.sourceId, e.title]), [['birthdays', 'Ana Prado'], ['c_g', 'Luis Prado']]);
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
