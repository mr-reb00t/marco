// Birthdays from a contacts file (#43, web/admin/vcard.ts): vCards exported by Google Contacts, iCloud and Outlook
// (2.1, 3.0 and 4.0) are read in the browser, and the import plan says what is new, what is already in the list and
// why the other contacts are left out. Also the hint for Google's secret iCal address (web/admin/util.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWebModules } from './webModules.js';

const [vc, util] = await loadWebModules('/web/admin/vcard.ts', '/web/admin/util.ts');

const YEAR = 2026;
const parse = (data, max) => vc.parseVcards(data, max, YEAR);
const bytes = (s) => new TextEncoder().encode(s);
const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const crlf = (lines) => lines.join('\r\n') + '\r\n';
const card = (...props) => ['BEGIN:VCARD', 'VERSION:3.0', ...props, 'END:VCARD'];

test('Google Contacts 3.0: dates with and without a year, item groups, a photo, CRLF', () => {
  const file = crlf([
    ...card('FN:Lucía Prado', 'N:Prado;Lucía;;;', 'BDAY:1990-03-14', 'item1.EMAIL;TYPE=INTERNET:lucia@example.com', 'item1.X-ABLabel:'),
    ...card('FN:Tomás Vidal', 'item2.BDAY:--07-02', 'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ', ' AAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMU'),
    ...card('FN:Sin Fecha', 'TEL:+34 600 000 000'),
  ]);
  const r = parse(bytes(file));
  assert.equal(r.cards, 3);
  assert.deepEqual(r.contacts, [
    { name: 'Lucía Prado', bday: { month: 3, day: 14, year: 1990 } },
    { name: 'Tomás Vidal', bday: { month: 7, day: 2, year: null } },
    { name: 'Sin Fecha', bday: null, problem: 'noBday' },
  ]);
});

test('iCloud: VALUE=date, X-APPLE-OMIT-YEAR means no year, a folded name', () => {
  const file = crlf([
    ...card('FN:Marta Ferrer', 'BDAY;VALUE=date:1985-11-30'),
    ...card('FN:Rosa', ' lía Gil', 'BDAY;X-APPLE-OMIT-YEAR=1604;VALUE=date:1604-05-09'),
  ]);
  const r = parse(bytes(file));
  assert.deepEqual(r.contacts.map((c) => [c.name, c.bday]), [
    ['Marta Ferrer', { month: 11, day: 30, year: 1985 }],
    ['Rosalía Gil', { month: 5, day: 9, year: null }],
  ]);
});

test('Outlook 2.1: quoted-printable Windows-1252 names, a soft break, YYYYMMDD', () => {
  const file = latin1(crlf([
    'BEGIN:VCARD', 'VERSION:2.1',
    'N;CHARSET=Windows-1252;ENCODING=QUOTED-PRINTABLE:Mu=F1oz;Jos=E9',
    'FN;CHARSET=Windows-1252;ENCODING=QUOTED-PRINTABLE:Jos=E9 Mu=F1oz',
    'BDAY:19780621',
    'END:VCARD',
    'BEGIN:VCARD', 'VERSION:2.1',
    'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:In=C3=A9s de la Fuente y=',
    ' Garc=C3=ADa',
    'BDAY:1966-01-05',
    'END:VCARD',
  ]));
  const r = parse(file);
  assert.deepEqual(r.contacts.map((c) => [c.name, c.bday]), [
    ['José Muñoz', { month: 6, day: 21, year: 1978 }],
    ['Inés de la Fuente y García', { month: 1, day: 5, year: 1966 }],
  ]);
});

test('vCard 4.0: --MMDD, a time part, VALUE=text is not a date', () => {
  const file = crlf([
    'BEGIN:VCARD', 'VERSION:4.0', 'FN:Pablo Ríos', 'BDAY:--0314', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:4.0', 'FN:Nora Sanz', 'BDAY:20010101T000000Z', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:4.0', 'FN:Elena Mar', 'BDAY:1993-08-12T00:00:00.000Z', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:4.0', 'FN:Abuelo Ernesto', 'BDAY;VALUE=text:circa 1800', 'END:VCARD',
  ]);
  const r = parse(bytes(file));
  assert.deepEqual(r.contacts, [
    { name: 'Pablo Ríos', bday: { month: 3, day: 14, year: null } },
    { name: 'Nora Sanz', bday: { month: 1, day: 1, year: 2001 } },
    { name: 'Elena Mar', bday: { month: 8, day: 12, year: 1993 } },
    { name: 'Abuelo Ernesto', bday: null, problem: 'badBday' },
  ]);
});

test('names: N when there is no FN, no name at all, a contact without a birthday', () => {
  const file = crlf([
    ...card('N:Ruiz;Ana;María;;', 'BDAY:2000-02-29'),
    ...card('EMAIL:nobody@example.com', 'BDAY:2000-04-01'),
    ...card('FN:   ', 'N:;;;;', 'BDAY:2000-04-02'),
    ...card('FN:Iván Soler'),
  ]);
  assert.deepEqual(parse(bytes(file)).contacts, [
    { name: 'Ana María Ruiz', bday: { month: 2, day: 29, year: 2000 } },
    { name: '', bday: { month: 4, day: 1, year: 2000 }, problem: 'noName' },
    { name: '', bday: { month: 4, day: 2, year: 2000 }, problem: 'noName' },
    { name: 'Iván Soler', bday: null, problem: 'noBday' },
  ]);
});

test('escapes, a BOM, LF only, UTF-16, bare 2.1 parameters, no END at the end of the file', () => {
  const text = card('FN:Gómez\\, Clara \\; tía\\\\', 'BDAY:1971-09-09').join('\n');
  assert.deepEqual(parse(bytes(`﻿${text}\n`)).contacts, [{ name: 'Gómez, Clara ; tía\\', bday: { month: 9, day: 9, year: 1971 } }]);
  const le = new Uint8Array([0xff, 0xfe, ...new Uint8Array(new Uint16Array([...'BEGIN:VCARD\r\nFN:Óscar Peña\r\nBDAY:1980-12-24\r\nEND:VCARD\r\n'].map((c) => c.charCodeAt(0))).buffer)]);
  assert.deepEqual(parse(le).contacts, [{ name: 'Óscar Peña', bday: { month: 12, day: 24, year: 1980 } }]);
  const bare = latin1('BEGIN:VCARD\r\nVERSION:2.1\r\nFN;QUOTED-PRINTABLE;CHARSET=ISO-8859-1:Bego=F1a\r\nBDAY:1959-07-30\r\nEND:VCARD');
  assert.deepEqual(parse(bare).contacts, [{ name: 'Begoña', bday: { month: 7, day: 30, year: 1959 } }]);
  const utf8Bare = bytes('BEGIN:VCARD\r\nVERSION:2.1\r\nFN;UTF-8:Zoë Blanco\r\nBDAY:1988-10-10\r\n');
  assert.deepEqual(parse(utf8Bare).contacts, [{ name: 'Zoë Blanco', bday: { month: 10, day: 10, year: 1988 } }]);
  // a plain text file is not a contacts file: no cards
  assert.equal(parse(bytes('Nombre;Fecha\nAna;14/03\n')).cards, 0);
});

test('dates: 29 February is a birthday, 31 April is not, years that cannot be a birth year are dropped', () => {
  const d = (v, p) => vc.parseBday(v, p, YEAR);
  assert.deepEqual(d('--02-29'), { month: 2, day: 29, year: null });
  assert.deepEqual(d('2004-02-29'), { month: 2, day: 29, year: 2004 });
  assert.equal(d('1990-04-31'), null);
  assert.equal(d('1990-13-01'), null);
  assert.equal(d('1990-03'), null);
  assert.equal(d('1990-12'), null);
  assert.equal(d('---14'), null);
  assert.equal(d('marzo'), null);
  assert.deepEqual(d('0000-06-15'), { month: 6, day: 15, year: null, yearDropped: true });
  assert.deepEqual(d('1850-06-15'), { month: 6, day: 15, year: null, yearDropped: true });
  assert.deepEqual(d(`${YEAR + 1}-06-15`), { month: 6, day: 15, year: null, yearDropped: true });
  assert.deepEqual(d('1604-06-15'), { month: 6, day: 15, year: null, yearDropped: true });
  assert.deepEqual(d('1604-06-15', { 'X-APPLE-OMIT-YEAR': '1604' }), { month: 6, day: 15, year: null });
  assert.deepEqual(d(`${YEAR}-01-02`), { month: 1, day: 2, year: YEAR });
});

test('broken files: a card without END, a stray soft break, a time after a space, ZWJ and invisible marks', () => {
  // a missing END:VCARD does not swallow the cards after it
  let r = parse(bytes(crlf(['BEGIN:VCARD', 'FN:Ana Prado', 'BDAY:1990-01-01', ...card('FN:Bea Gil', 'BDAY:1991-02-02'), ...card('FN:Ciro Sanz', 'BDAY:1992-03-03')])));
  assert.equal(r.cards, 3);
  assert.deepEqual(r.contacts.map((c) => c.name), ['Ana Prado', 'Bea Gil', 'Ciro Sanz']);
  // a 2.1 AGENT card inside another still counts once
  r = parse(bytes(crlf(['BEGIN:VCARD', 'VERSION:2.1', 'FN:Dora Ruiz', 'AGENT:', ...card('FN:Asistente', 'BDAY:1970-01-01'), 'BDAY:1980-04-04', 'END:VCARD', ...card('FN:Eva Mora', 'BDAY:--05-05')])));
  assert.deepEqual(r.contacts.map((c) => [c.name, c.bday?.month]), [['Dora Ruiz', 4], ['Eva Mora', 5]]);
  // a quoted-printable name ending in a stray "=" stops at END:VCARD and at the next property
  r = parse(bytes(crlf(['BEGIN:VCARD', 'VERSION:2.1', 'FN;ENCODING=QUOTED-PRINTABLE:Ana=', 'END:VCARD', ...card('FN;ENCODING=QUOTED-PRINTABLE:Bea=', 'BDAY:1991-02-02')])));
  assert.deepEqual(r.contacts, [{ name: 'Ana', bday: null, problem: 'noBday' }, { name: 'Bea', bday: { month: 2, day: 2, year: 1991 } }]);
  assert.deepEqual(vc.parseBday('1990-03-14 10:00', {}, YEAR), { month: 3, day: 14, year: 1990 });
  r = parse(bytes(crlf([...card('FN:Ana \u200e\u202bFamilia\u202c 👨\u200d👩\u200d👧', 'BDAY:--06-06'), ...card('FN:نیک\u200cنام', 'BDAY:--07-07')])));
  assert.deepEqual(r.contacts.map((c) => c.name), ['Ana Familia 👨\u200d👩\u200d👧', 'نیک\u200cنام']);
});

test('a file with too many contacts stops at the cap', () => {
  const many = Array.from({ length: 5001 }, (_, i) => card(`FN:Persona ${i}`, 'BDAY:--01-01').join('\r\n')).join('\r\n');
  const r = parse(bytes(many));
  assert.equal(r.capped, true);
  assert.equal(r.cards, 5000);
  assert.equal(r.contacts.length, 5000);
  assert.equal(parse(bytes(many), 10).contacts.length, 10);
  assert.equal(vc.VCARD_MAX_CONTACTS, 5000);
  assert.equal(vc.VCARD_MAX_BYTES, 5 * 1024 * 1024);
});

test('import plan: new and already listed rows, repeats in the file, long names, counts that add up', () => {
  const long = 'Bartolomé ' + 'Alonso '.repeat(12);
  const file = crlf([
    ...card('FN:MARÍA López', 'BDAY:--03-14'), // already in the list as "Maria lopez", 14/03 (the year is not compared)
    ...card('FN:Juan Torres', 'BDAY:1975-05-02'),
    ...card('FN:Juan Torres', 'BDAY:--05-02'), // same person twice
    ...card('FN:Carla Núñez', 'BDAY:--12-01'),
    ...card('FN:Carla Núñez', 'BDAY:2011-12-01'), // the repeat with a year wins
    ...card(`FN:${long}`, 'BDAY:1999-01-20'),
    ...card('FN:<img src=x onerror=alert(1)>', 'BDAY:2001-07-07'),
    ...card('FN:Sin cumple'),
    ...card('FN:Fecha rara', 'BDAY:1990-02-30'),
    ...card('BDAY:1990-02-03'),
  ]);
  const existing = [{ id: 'b_1', name: 'Maria lopez', day: 14, month: 3, year: 1980, emoji: '' }];
  const plan = vc.planBirthdayImport(parse(bytes(file)), existing);
  assert.deepEqual(plan.skipped, { noBday: 1, badBday: 1, noName: 1 });
  assert.equal(plan.found, 7);
  assert.equal(plan.inFile, 2);
  assert.equal(plan.rows.length, 5);
  assert.equal(plan.fresh, 4);
  assert.equal(plan.existing, 1);
  assert.equal(plan.found, plan.fresh + plan.existing + plan.inFile);
  assert.equal(plan.truncated, 1);
  assert.deepEqual(plan.rows.map((r) => [r.month, r.day]), [[1, 20], [3, 14], [5, 2], [7, 7], [12, 1]]);
  const [longRow, maria, juan, html, carla] = plan.rows;
  assert.equal(longRow.truncated, true);
  assert.ok(longRow.name.length <= 80 && long.startsWith(longRow.name) && longRow.name === longRow.name.trim());
  assert.equal(maria.status, 'existing');
  assert.equal(juan.year, 1975);
  assert.equal(carla.year, 2011);
  assert.equal(html.name, '<img src=x onerror=alert(1)>', 'kept as plain text: the dialog renders it as text');
  assert.equal(new Set(plan.rows.map((r) => r.key)).size, plan.rows.length);
  // a name cut in the middle of an emoji does not leave half of it
  const emojiName = 'a'.repeat(79) + '🎉';
  assert.equal(vc.planBirthdayImport({ contacts: [{ name: emojiName, bday: { month: 1, day: 1, year: null } }], cards: 1, capped: false }, []).rows[0].name, 'a'.repeat(79));
});

test('Google secret iCal address: only the private one, only on calendar.google.com (or the older www.google.com)', () => {
  const ok = [
    'https://calendar.google.com/calendar/ical/ana.prado%40gmail.com/private-0123456789abcdef0123456789abcdef/basic.ics',
    'webcal://calendar.google.com/calendar/ical/ana.prado@gmail.com/private-abc/basic.ics',
    '  HTTPS://Calendar.Google.com/calendar/ical/abc123%40group.calendar.google.com/private-xyz/basic.ics ',
    'https://www.google.com/calendar/ical/ana.prado%40gmail.com/private-abc/basic.ics',
  ];
  for (const u of ok) assert.equal(util.isGoogleIcalUrl(u), true, u);
  const no = [
    'https://calendar.google.com/calendar/ical/es.spain%23holiday%40group.v.calendar.google.com/public/basic.ics',
    'https://calendar.google.com/calendar/embed?src=ana.prado%40gmail.com',
    'https://evil.example/calendar.google.com/calendar/ical/a/private-b/basic.ics',
    'https://calendar.google.com.evil.example/calendar/ical/a/private-b/basic.ics',
    'https://www.google.com/calendar/ical/es.spain%23holiday%40group.v.calendar.google.com/public/basic.ics',
    'https://google.com/calendar/ical/a/private-b/basic.ics',
    'https://p01-caldav.icloud.com/published/2/abc',
    'ftp://calendar.google.com/calendar/ical/a/private-b/basic.ics',
    'not a url',
    '',
  ];
  for (const u of no) assert.equal(util.isGoogleIcalUrl(u), false, u);
});
