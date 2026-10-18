// calendar.agendaDays: how far the agenda view looks ahead ('auto', 7, 14 or 30). Validation, defaults for new and
// older screens, the display's normalization, and the pure helpers that decide how many day blocks 'auto' keeps
// (web/display/agendaFill.ts, loaded through Vite like the admin modules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig, AGENDA_DAYS } from '../core/validate.js';
import { defaultConfig, defaultScreenProfile, SCREEN_SPLIT_KEYS } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';
import { loadWebModules } from './webModules.js';

const [fill, displayDefaults] = await loadWebModules('/web/display/agendaFill.ts', '/web/display/defaults.ts');
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('agendaDays accepts auto, 7, 14 or 30 per screen; anything else is rejected with its path', () => {
  assert.deepEqual(AGENDA_DAYS, ['auto', 7, 14, 30]);
  assert.ok(SCREEN_SPLIT_KEYS.calendar.includes('agendaDays'));
  assert.match(read('web/shared/screens.ts'), /'agendaDays'/);
  for (const ok of AGENDA_DAYS) {
    const c = defaultConfig();
    c.screens[0].calendar.agendaDays = ok;
    const r = validateConfig(c);
    assert.equal(r.ok, true, `${ok}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.value.screens[0].calendar.agendaDays, ok);
    assert.equal(displayConfig(r.value, r.value.screens[0]).calendar.agendaDays, ok);
  }
  for (const bad of ['Auto', '14', 0, 3, 15, 31, null, true, 'all']) {
    const c = defaultConfig();
    c.screens[0].calendar.agendaDays = bad;
    const r = validateConfig(c);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => e.path === 'screens[0].calendar.agendaDays'), JSON.stringify(r.errors));
    assert.equal(r.value.screens[0].calendar.agendaDays, 'auto');
  }
});

test('agendaDays is auto for new screens and for screens saved before the option', () => {
  assert.equal(defaultScreenProfile().calendar.agendaDays, 'auto');
  const c = defaultConfig();
  delete c.screens[0].calendar.agendaDays;
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.screens[0].calendar.agendaDays, 'auto');
  // the display: a missing or unknown value (an older server) is auto, a valid number stays
  const { normalizeConfig, normalizeAgendaDays } = displayDefaults;
  assert.equal(normalizeConfig({}).calendar.agendaDays, 'auto');
  assert.equal(normalizeConfig({ calendar: { agendaDays: 30 } }).calendar.agendaDays, 30);
  assert.equal(normalizeConfig({ calendar: { agendaDays: 7 } }).calendar.agendaDays, 7);
  assert.equal(normalizeConfig({ calendar: { agendaDays: 21 } }).calendar.agendaDays, 'auto');
  for (const v of [undefined, null, '14', 0, 'auto']) assert.equal(normalizeAgendaDays(v), 'auto');
});

test('agendaHorizon and agendaFetchDays: fixed settings look that far, auto up to its maximum', () => {
  const { agendaHorizon, agendaFetchDays, AGENDA_AUTO_MAX_DAYS, AGENDA_BASE_DAYS } = fill;
  assert.equal(AGENDA_BASE_DAYS, 14);
  assert.ok(AGENDA_AUTO_MAX_DAYS >= 30);
  assert.equal(agendaHorizon(7), 7);
  assert.equal(agendaHorizon(14), 14);
  assert.equal(agendaHorizon(30), 30);
  assert.equal(agendaHorizon(3), 3); // the compact side agenda
  assert.equal(agendaHorizon('auto'), AGENDA_AUTO_MAX_DAYS);
  assert.equal(agendaFetchDays(30), 31);
  assert.equal(agendaFetchDays('auto'), AGENDA_AUTO_MAX_DAYS + 1);
});

test('agendaKeep: leading day blocks that fit, never cut, never fewer than the first 14 days', () => {
  const { agendaKeep } = fill;
  // a quiet fortnight: Today, Tomorrow and day 3, then days 21, 24 and 28 have events
  const offsets = [0, 1, 3, 21, 24, 28];
  // everything fits: everything is kept (events three weeks away now show)
  assert.equal(agendaKeep(offsets, [true, true, true, true, true, true]), 6);
  // day 24 would overflow: stop there, even if a later, smaller day would fit (no gaps, no half days)
  assert.equal(agendaKeep(offsets, [true, true, true, true, false, true]), 4);
  // the first days already overflow: the blocks of the first 14 days, as before the option
  assert.equal(agendaKeep(offsets, [true, false, false, false, false, false]), 3);
  assert.equal(agendaKeep(offsets, [false, false, false, false, false, false]), 3);
  // a busy calendar with a block every day: never fewer than the 14 days showed
  const busy = Array.from({ length: 40 }, (_, i) => i);
  assert.equal(agendaKeep(busy, busy.map((i) => i < 5)), 14);
  assert.equal(agendaKeep(busy, busy.map((i) => i < 20)), 20);
  // a custom base, and empty input
  assert.equal(agendaKeep([0, 1, 5, 9], [true, false, false, false], 7), 3);
  assert.equal(agendaKeep([], []), 0);
  // nothing measured (the agenda is not on screen): the first 14 days
  assert.equal(agendaKeep(offsets, offsets.map(() => false)), 3);
});

test('the agenda view follows calendar.agendaDays; the compact side agenda keeps 3 days', () => {
  const main = read('web/display/main.ts');
  assert.match(main, /new Agenda\(\$\('#agenda'\), \{\}\)/);
  assert.match(main, /new Agenda\(\$\('#side-agenda'\), \{ days: 3, compact: true/);
  // the events fetched reach as far as the agenda looks
  assert.match(main, /agendaDays: cfg\.calendar\.agendaDays/);
  assert.match(read('server/core/bootstrap.js'), /agendaDays === 'auto' \? AGENDA_AUTO_MAX_DAYS : agendaDays\) \+ 1/);
  const agenda = read('web/display/widgets/agenda.ts');
  assert.match(agenda, /agendaKeep\(offsets, fits\)/);
});

test('admin: Days in the agenda, with texts in Spanish, English and Portuguese', () => {
  const fields = read('web/admin/components/PlannerFields.tsx');
  assert.match(fields, /export function AgendaDaysField/);
  assert.match(read('web/admin/sections/Calendars.tsx'), /<AgendaDaysField /);
  const dict = read('web/admin/i18n-dict-planner.ts');
  assert.ok(dict.includes("['Días en la agenda', 'Days in the agenda', 'Dias na agenda']"));
  for (const f of ['CHANGELOG.md', 'docs/ARCHITECTURE.md', 'docs/API.md']) assert.match(read(f), /agendaDays/, f);
});
