import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { parseIcsText, expandEvents } from '../ics.js';
import { buildSourceEvents, sortEvents, eventsHash } from '../calendars.js';
import { zonedMidnight, addDays } from '../core/lib/tz.js';
import { fixture, RULES } from './helpers.js';

const TZ = 'Europe/Lisbon';
const SOURCE = { id: 'c_fam', name: 'Familia', color: '#4ea8de', emoji: '', kind: 'generic' };

async function eventsFor(file, from, to, source = SOURCE, lang = 'es') {
  const vevents = await parseIcsText(fixture(file));
  const raws = expandEvents(vevents, new Date(zonedMidnight(from, TZ) - 86400000), new Date(zonedMidnight(addDays(to, 1), TZ).getTime() + 86400000));
  return sortEvents(buildSourceEvents(raws, source, { rules: RULES, from, to, tz: TZ, lang }), TZ);
}

test('rejects non-ICS payloads', async () => {
  await assert.rejects(parseIcsText('<html>login</html>'), /iCalendar/);
});

test('weekly RRULE with EXDATE, RECURRENCE-ID override and DST change', async () => {
  const ev = await eventsFor('family.ics', '2026-10-01', '2026-10-31');
  const gym = ev.filter((e) => e.title.startsWith('Gym'));
  assert.deepEqual(gym.map((e) => e.start), [
    '2026-10-01T09:00:00+01:00',
    '2026-10-08T09:00:00+01:00',
    // 15th excluded by EXDATE
    '2026-10-22T11:30:00+01:00', // overridden instance
    '2026-10-29T09:00:00+00:00', // after DST end (25 Oct) still 09:00 local
  ]);
  assert.equal(gym[2].title, 'Gym con Pedro (movido)');
  assert.equal(gym[0].emoji, '🏃');
  assert.equal(gym[0].color, '#4ea8de');
  assert.equal(gym[0].allDay, false);
  assert.equal(gym[0].multiDay, false);
});

test('daily recurrence keeps local wall time across DST', async () => {
  const ev = await eventsFor('family.ics', '2026-10-01', '2026-10-31');
  const cena = ev.filter((e) => e.title === 'Cena familiar').map((e) => e.start);
  assert.deepEqual(cena, ['2026-10-24T20:00:00+01:00', '2026-10-25T20:00:00+00:00', '2026-10-26T20:00:00+00:00']);
  assert.equal(ev.find((e) => e.title === 'Cena familiar').emoji, '🍽️');
});

test('all-day multi-day event uses exclusive end date', async () => {
  const ev = await eventsFor('family.ics', '2026-10-01', '2026-10-31');
  const trip = ev.find((e) => e.title.startsWith('Vacaciones'));
  assert.equal(trip.allDay, true);
  assert.equal(trip.start, '2026-10-09');
  assert.equal(trip.end, '2026-10-12');
  assert.equal(trip.multiDay, true);
  assert.equal(trip.emoji, '🏖️');
});

test('timed event crossing midnight is multiDay; other timezones converted', async () => {
  const ev = await eventsFor('family.ics', '2026-10-01', '2026-10-31');
  const flight = ev.find((e) => e.title === 'Vuelo a Londres');
  assert.equal(flight.start, '2026-10-20T22:30:00+01:00');
  assert.equal(flight.end, '2026-10-21T02:30:00+01:00');
  assert.equal(flight.multiDay, true);
  assert.equal(flight.emoji, '✈️');
  assert.equal(flight.location, 'Aeroporto de Lisboa');
  const call = ev.find((e) => e.title === 'Call con cliente');
  assert.equal(call.start, '2026-10-13T14:00:00+01:00');
  assert.equal(call.emoji, '💼');
});

test('cancelled events are dropped', async () => {
  const ev = await eventsFor('family.ics', '2026-10-01', '2026-10-31');
  assert.equal(ev.some((e) => e.title === 'Cancelado'), false);
});

test('yearly all-day birthday expands into a far window', async () => {
  const ev = await eventsFor('family.ics', '2027-03-01', '2027-03-31');
  // the 🎂 emoji already says "birthday", so the title is tidied down to the name
  const b = ev.filter((e) => e.title === 'Ana');
  assert.equal(b.length, 1);
  assert.equal(b[0].start, '2027-03-12');
  assert.equal(b[0].end, '2027-03-13');
  assert.equal(b[0].emoji, '🎂');
  assert.equal(b[0].multiDay, false);
});

test('window clipping includes events overlapping the edges', async () => {
  const ev = await eventsFor('family.ics', '2026-10-11', '2026-10-11');
  assert.deepEqual(ev.map((e) => e.title), ['Vacaciones en el Algarve']);
  const none = await eventsFor('family.ics', '2026-10-12', '2026-10-12');
  assert.equal(none.length, 0);
});

test('sorting: per day, all-day first then by start; hash stable', async () => {
  const ev = await eventsFor('family.ics', '2026-10-01', '2026-10-31');
  for (let i = 1; i < ev.length; i++) {
    const day = (e) => e.start.slice(0, 10);
    assert.ok(day(ev[i - 1]) <= day(ev[i]), 'days ascending');
  }
  const again = await eventsFor('family.ics', '2026-10-01', '2026-10-31');
  assert.equal(eventsHash(ev), eventsHash(again));
  assert.equal(new Set(ev.map((e) => e.id)).size, ev.length, 'ids unique');
});

test('airbnb feed normalisation', async () => {
  const src = { id: 'c_al', name: 'AL', color: '#2ec4b6', emoji: '🏠', kind: 'airbnb' };
  const ev = await eventsFor('airbnb.ics', '2026-10-01', '2026-10-31', src);
  assert.deepEqual(ev.map((e) => e.title), ['Reserva', 'No disponible', 'Reserva · John Smith']);
  assert.ok(ev.every((e) => e.kind === 'airbnb' && e.allDay && e.multiDay));
  assert.equal(ev[0].emoji, '🏠');
  assert.equal(ev[0].start, '2026-10-10');
  assert.equal(ev[0].end, '2026-10-14');
  const en = await eventsFor('airbnb.ics', '2026-10-01', '2026-10-31', src, 'en');
  assert.equal(en[0].title, 'Reservation');
});

test('airbnb stay whose checkout is the first day of the window is kept (checkout half-bar)', () => {
  const raws = [{ uid: 'r1', title: 'Reserved', description: '', location: '', allDay: true, start: '2026-10-09', end: '2026-10-12' }];
  const air = { id: 'c_air', name: 'Airbnb', color: '#ff5a5f', emoji: '', kind: 'airbnb' };
  const opts = { rules: RULES, from: '2026-10-12', to: '2026-10-18', tz: TZ, lang: 'es' };
  assert.equal(buildSourceEvents(raws, air, opts).length, 1);
  // non-airbnb all-day events keep exclusive-end semantics
  assert.equal(buildSourceEvents(raws, SOURCE, opts).length, 0);
});

test('pathological RRULEs are bounded (MINUTELY → base occurrence, instance caps)', async () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:m1', 'DTSTART:20261001T000000Z', 'DTEND:20261001T000100Z', 'RRULE:FREQ=MINUTELY', 'SUMMARY:spam', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:s1', 'DTSTART:20261001T000000Z', 'DTEND:20261001T000001Z', 'RRULE:FREQ=SECONDLY', 'SUMMARY:spam2', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:h1', 'DTSTART:20261001T000000Z', 'DTEND:20261001T001000Z', 'RRULE:FREQ=HOURLY', 'SUMMARY:hourly', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');
  const vevents = await parseIcsText(ics);
  const t0 = Date.now();
  const raws = expandEvents(vevents, new Date('2026-09-01T00:00:00Z'), new Date('2027-10-01T00:00:00Z'));
  assert.ok(Date.now() - t0 < 5000, 'expansion must be fast');
  assert.equal(raws.filter((r) => r.uid === 'm1').length, 1);
  assert.equal(raws.filter((r) => r.uid === 's1').length, 1);
  assert.ok(raws.filter((r) => r.uid === 'h1').length <= 2000);
});

test('a parsed feed is not kept alive by node-ical time zone names (#46)', async () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const mem = () => { 'ab'.match(/a/); gc(); const m = process.memoryUsage(); return m.heapUsed + m.external; };
  const feed = () => {
    const pad = 'Descripción ñ 日本 '.repeat(40);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
    for (let i = 0; i < 12000; i++) {
      lines.push('BEGIN:VEVENT', `UID:e${i}`, 'DTSTAMP:20261001T000000Z', 'DTSTART;TZID=America/Argentina/Ushuaia:20261012T100000',
        `SUMMARY:x${i}`, `DESCRIPTION:${pad}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR', '');
    return lines.join('\r\n');
  };
  // the text is made and dropped inside a helper, so this async function holds no reference to it across awaits
  const parse = async () => {
    const text = feed();
    return { count: (await parseIcsText(text)).length, size: text.length * 2 };
  };
  const before = mem();
  const { count, size } = await parse();
  assert.equal(count, 12000);
  await new Promise((r) => setTimeout(r, 0));
  // without the warm-up the whole text (about 20 MB) stays on Node 22, where it lives on the heap; with it, well under 1 MB
  const grew = mem() - before;
  assert.ok(grew < size / 2, `retained ${grew} bytes of a ${size} byte feed`);
});
