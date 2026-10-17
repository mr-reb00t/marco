import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRule, decorate as decorateFull, keywordMatches, normalizeAirbnbTitle, petsToEmoji, tidyTitle, tidyTitleWhy } from '../rules.js';
import { fold } from '../lib/text.js';
import { RULES } from './helpers.js';

const emojiOf = (title, desc = '') => matchRule(RULES, title, desc)?.emoji ?? null;

test('accent/case-insensitive matching', () => {
  assert.equal(emojiOf('CUMPLEAÑOS de Marta'), '🎂');
  assert.equal(emojiOf('Aniversario Joao'), '🎂');
  assert.equal(emojiOf('aniversário da avó'), '🎂');
  assert.equal(emojiOf('Medico de cabecera'), '🩺'); // rule has "médico"
  assert.equal(emojiOf('Reunion de equipo'), '💼');
  assert.equal(emojiOf('Reunião semanal'), '💼');
  assert.equal(emojiOf('FUTBOL niños'), '🏃');
  assert.equal(emojiOf('Inspecao do carro'), '🚗');
});

test('description is matched too; order matters', () => {
  assert.equal(emojiOf('Implantação da República', 'Public holiday'), '🎉');
  assert.equal(emojiOf('Check-out huésped'), '🧳');
  assert.equal(emojiOf('Check-in huésped'), '🏠');
  assert.equal(emojiOf('Vuelo Lisboa', ''), '✈️');
});

test('short keywords match whole words only', () => {
  assert.equal(keywordMatches(fold('Comida con Carlos'), 'car'), false);
  assert.equal(keywordMatches(fold('Llevar el car al taller'), 'car'), true);
  assert.equal(keywordMatches(fold('Calle Mayor'), 'call'), false);
  assert.equal(keywordMatches(fold('Call semanal'), 'call'), true);
  assert.equal(emojiOf('Nada que ver'), null);
});

test('decorate priority: rule > source.emoji > kind default; color rule > source', () => {
  const rules = [{ id: 'x', match: ['dentista'], emoji: '🦷', color: '#ff0000' }];
  const decorate = (...a) => { const { emoji, color } = decorateFull(...a); return { emoji, color }; };
  assert.deepEqual(decorate(rules, { emoji: '⭐', kind: 'generic', color: '#00ff00' }, 'Dentista'), { emoji: '🦷', color: '#ff0000' });
  assert.deepEqual(decorate(rules, { emoji: '⭐', kind: 'generic', color: '#00ff00' }, 'Otra cosa'), { emoji: '⭐', color: '#00ff00' });
  assert.deepEqual(decorate(rules, { emoji: '', kind: 'birthdays', color: '#00ff00' }, 'Ana'), { emoji: '🎂', color: '#00ff00' });
  assert.deepEqual(decorate(rules, { emoji: '', kind: 'generic', color: '#00ff00' }, 'Ana'), { emoji: '', color: '#00ff00' });
  const noColor = [{ id: 'y', match: ['ana'], emoji: '👩', color: null }];
  assert.equal(decorate(noColor, { emoji: '', kind: 'generic', color: '#123456' }, 'Ana').color, '#123456');
});

test('airbnb title normalisation', () => {
  assert.deepEqual(normalizeAirbnbTitle('Reserved', '', 'es'), { title: 'Reserva', blocked: false, emoji: '' });
  assert.deepEqual(normalizeAirbnbTitle('Airbnb (Not available)', '', 'es'), { title: 'No disponible', blocked: true, emoji: '' });
  assert.equal(normalizeAirbnbTitle('CLOSED - Not available', '', 'pt').title, 'Indisponível');
  assert.equal(normalizeAirbnbTitle('Reserved - Maria Lopes', '', 'es').title, 'Reserva · Maria Lopes');
  assert.equal(normalizeAirbnbTitle('Reserved', 'Guest: Ana Silva\nPhone: 1234', 'es').title, 'Reserva · Ana Silva');
  assert.equal(normalizeAirbnbTitle('Peter Parker (HMAB12CD34)', '', 'en').title, 'Reservation · Peter Parker');
  assert.equal(normalizeAirbnbTitle('Airbnb', 'Reservation URL: https://www.airbnb.com/x', 'es').title, 'Reserva');
});

test('google holiday boilerplate does not trigger the vacation rule', () => {
  const d = 'Observance\nTo hide observances, go to Google Calendar Settings > Holidays in Portugal';
  assert.equal(emojiOf('Daylight Saving Time ends', d), null);
  assert.equal(emojiOf('Republic Day', 'Public holiday'), '🎉');
});

test('holiday titles from Google feeds are translated', async () => {
  const { translateHoliday } = await import('../rules.js');
  assert.equal(translateHoliday('Republic Day', 'es'), 'Día de la República');
  assert.equal(translateHoliday("All Saints' Day", 'pt'), 'Dia de Todos os Santos');
  assert.equal(translateHoliday('Republic Day', 'en'), 'Republic Day');
  assert.equal(translateHoliday('Some local feast', 'es'), 'Some local feast');
});

test('property-manager style titles keep guest name + leading emoji; pets become dogs', () => {
  assert.deepEqual(normalizeAirbnbTitle('🏠 Jane Doe - 4p+1m', 'Check-in: x\nHuéspedes: 4', 'es'), { title: 'Jane Doe · 🧑🏻🧑🏻🧑🏻🧑🏻 🐶', blocked: false, emoji: '🏠' });
  assert.deepEqual(normalizeAirbnbTitle('🚪 John Roe', 'Checkout de: John Roe', 'es'), { title: 'John Roe', blocked: false, emoji: '🚪' });
  assert.equal(petsToEmoji('Ana · 2p+2m'), 'Ana · 🧑🏻🧑🏻 🐶🐶');
  assert.equal(petsToEmoji('Ana · 4p+1m', 'Adultos: 2\nNiños: 1\nBebés: 1\nMascotas: 1'), 'Ana · 🧑🏻🧑🏻 🧒🏻 👶🏻 🐶');
  assert.equal(petsToEmoji('Big · 7p'), 'Big · 🧑🏻×7');
  assert.equal(petsToEmoji('X · 2p + 5m'), 'X · 🧑🏻🧑🏻 🐶×5');
  assert.equal(petsToEmoji('Bob · 3p'), 'Bob · 🧑🏻🧑🏻🧑🏻');
  // a numeric "Huéspedes: 2" line is not a guest name
  assert.equal(normalizeAirbnbTitle('Reserved', 'Huéspedes: 2', 'es').title, 'Reserva');
});

test('tidyTitle: un-shout and strip redundant birthday words', () => {
  assert.equal(tidyTitle('CUMPLE MARIA', { emoji: '🎂' }), 'Maria');
  assert.equal(tidyTitle('Cumpleaños de Juan Pérez', { emoji: '🎂' }), 'Juan Pérez');
  assert.equal(tidyTitle("María's birthday", { emoji: '🎂' }), 'María');
  assert.equal(tidyTitle('Cumple', { emoji: '🎂' }), 'Cumple');
  // a name that starts like "do"/"da"/"del" keeps those letters
  assert.equal(tidyTitle('CUMPLE DORU', { emoji: '🎂' }), 'Doru');
  assert.equal(tidyTitle('Cumple Delia', { emoji: '🎂' }), 'Delia');
  assert.equal(tidyTitle('Aniversário da Ana', { emoji: '🎂' }), 'Ana');
  assert.equal(tidyTitle('Birthday Ofelia', { emoji: '🎂' }), 'Ofelia');
  assert.equal(tidyTitle('REUNIÓN DE EQUIPO', { emoji: '💼' }), 'Reunión de Equipo');
  assert.equal(tidyTitle('Cumple de Ana', { emoji: '💼' }), 'Cumple de Ana');
});

test('short keywords never match inside names (car ≠ Carmen/Oscar/Carlos), shared admin matcher agrees', async () => {
  const { findKeyword, keywordMatches: km, foldText } = await import('../lib/keywords.js');
  for (const name of ['Cena con Carmen', 'Oscar viene a casa', 'Cumple de Carlota', 'Llamar a Oscar', 'Scarlett']) {
    assert.equal(km(foldText(name), 'car'), false, name);
    assert.notEqual(emojiOf(name), '🚗', name);
  }
  assert.equal(km(foldText('Lavar el car'), 'car'), true);
  assert.equal(km(foldText('car wash'), 'car'), true);
  assert.equal(km(foldText('(car) ITV'), 'car'), true);
  assert.equal(km(foldText('Vettel race'), 'vet'), false);
  assert.equal(km(foldText('Vet: Luna'), 'vet'), true);
  assert.equal(km(foldText('Cinema night'), 'cine'), false);
  assert.equal(km(foldText('Ir al cine'), 'cine'), true);
  // longer keywords keep substring matching (accent-insensitive)
  assert.equal(km(foldText('Revisión del carro'), 'carro'), true);
  assert.equal(km(foldText('Dentista Lucía'), 'dentist'), true);
  // the admin preview uses findKeyword: same answers as the server
  assert.equal(findKeyword(RULES, 'Cena con Carmen')?.rule.id, 'r_dinner');
  assert.equal(findKeyword(RULES, 'Oscar'), null);
  assert.equal(findKeyword(RULES, 'Taller: car')?.rule.id, 'r_car');
  assert.equal(findKeyword(RULES, 'Inspeção do carro')?.keyword, 'inspeção');
});

test('expanded multilingual icon rules', () => {
  const em = (t) => matchRule(RULES, t)?.emoji ?? null;
  assert.equal(em('Dentist appointment'), '🩺');
  assert.equal(em('Swimming lesson'), '🏊');
  assert.equal(em('Bin day'), '🗑️');
  assert.equal(em('Haircut'), '💇');
  assert.equal(em('Train to Porto'), '🚆');
  assert.equal(em('Pay rent'), '💶');
  assert.equal(em("Lucía's birthday party"), '🎂');
  assert.equal(em('Carmen comes over'), null); // short keyword "car" only as a whole word
});

test('tidyTitleWhy (#10): why a title changed, and birthdayNames off keeps the birthday words', () => {
  assert.deepEqual(tidyTitleWhy("Astrid's Birthday", { emoji: '🎂' }), { title: 'Astrid', why: 'birthday' });
  assert.deepEqual(tidyTitleWhy("Astrid's Birthday", { emoji: '🎂', birthdayNames: false }), { title: "Astrid's Birthday", why: null });
  assert.deepEqual(tidyTitleWhy('CUMPLE MARIA', { emoji: '🎂', birthdayNames: false }), { title: 'Cumple Maria', why: 'caps' });
  assert.deepEqual(tidyTitleWhy('Cumple', { emoji: '🎂' }), { title: 'Cumple', why: null });
  assert.deepEqual(tidyTitleWhy('Dentista', {}), { title: 'Dentista', why: null });
  assert.equal(tidyTitle('Cumpleaños de Juan', { emoji: '🎂', birthdayNames: false }), 'Cumpleaños de Juan');
});
