// Familia, the pure rules (familyCore.js): config sanitizers, ISO weeks and meals, today's routines, points,
// toggles, redemptions, undo, the 90-day prune and what a TV or a phone gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  sanitizeFamily, sanitizeScreenFamily, defaultFamily, defaultScreenFamily, isoWeekKey, dayOfWeek, weekStartOf, mealsForDate,
  mealsOfWeek, slotAt, choresForDay, todayProgress, pointsOf, emptyState, sanitizeState, pruneState, applyToggle, applyRedeem,
  applyAdjust, undoEntry, initials, nextRewards, displayFamily, phoneFamily, adminFamily, PASTELS, KIDS_PRESETS, MAX_MEMBERS,
  MAX_MEAL_WEEKS, RETENTION_DAYS, FAMILY_KEY_RE,
} from '../core/familyCore.js';
import { defaultConfig, defaultScreenProfile, SCREEN_SPLIT_KEYS } from '../core/defaults.js';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import { addDays } from '../core/lib/tz.js';

const collect = () => {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  return { errors, err };
};

// 2026-10-12 is a Monday.
const MON = '2026-10-12';
const AT = '2026-10-12T08:00:00.000Z';

function family(mut = (f) => f) {
  const f = {
    enabled: true,
    members: [
      { id: 'm_lucia', name: 'Lucía', color: '#ff8fab', avatar: '🦊', kid: true },
      { id: 'm_mateo', name: 'Mateo Luis', color: '#7cc6fe', avatar: '🐻', kid: true },
      { id: 'm_mama', name: 'Mamá', avatar: '🌷', kid: false },
    ],
    chores: [
      { id: 'h_teeth_pm', memberId: 'm_lucia', title: 'Dientes noche', emoji: '🪥', slot: 'evening', points: 1 },
      { id: 'h_bed', memberId: 'm_lucia', title: 'Hacer la cama', emoji: '🛏️', slot: 'morning', points: 2 },
      { id: 'h_home', memberId: 'm_lucia', title: 'Deberes', emoji: '📚', slot: 'afternoon', days: [1, 2, 3, 4, 5], points: 3 },
      { id: 'h_toys', memberId: 'm_mateo', title: 'Juguetes', emoji: '🧸', slot: 'any', points: 1 },
      { id: 'h_weekend', memberId: 'm_mateo', title: 'Regar', emoji: '🌱', slot: 'morning', days: [0, 6], points: 1 },
      { id: 'h_off', memberId: 'm_mateo', title: 'Apagada', slot: 'morning', enabled: false },
      { id: 'h_coffee', memberId: 'm_mama', title: 'Café', emoji: '☕', slot: 'morning', points: 5 },
    ],
    rewards: [
      { id: 'w_movie', title: 'Peli del viernes', emoji: '🎬', cost: 10 },
      { id: 'w_ice', title: 'Helado', emoji: '🍦', cost: 3 },
    ],
    meals: {
      enabled: true, slots: ['lunch', 'dinner'], useTemplate: true,
      template: { 1: { lunch: 'Lentejas', dinner: 'Tortilla' }, 2: { lunch: 'Arroz' } },
      weeks: {},
    },
  };
  mut(f);
  const { errors, err } = collect();
  const out = sanitizeFamily(f, err, ['local', 'birthdays', 'c_work']);
  assert.deepEqual(errors, []);
  return out;
}

test('sanitizeFamily: defaults for a missing block, and the per-screen defaults', () => {
  const { errors, err } = collect();
  assert.deepEqual(sanitizeFamily(undefined, err), defaultFamily());
  assert.deepEqual(sanitizeScreenFamily(undefined, err), defaultScreenFamily());
  assert.deepEqual(errors, []);
  sanitizeFamily('nope', err);
  assert.equal(errors[0].path, 'family');
  const v = validateConfig(defaultConfig());
  assert.equal(v.ok, true);
  assert.deepEqual(v.value.family, defaultFamily());
  assert.deepEqual(v.value.screens[0].family, { memberIds: null, touch: false, showQr: true });
  assert.deepEqual(SCREEN_SPLIT_KEYS.family, ['memberIds', 'touch', 'showQr']);
  assert.deepEqual(KIDS_PRESETS, ['kidsRoutines', 'kidsFamily', 'kidsMeals']);
});

test('sanitizeFamily: members (max 6, colours, avatars, calendars) and ids', () => {
  const { errors, err } = collect();
  const members = Array.from({ length: 7 }, (_, i) => ({ id: i === 1 ? 'm_0' : `m_${i}`, name: ` Kid ${i} ` }));
  members[2].color = 'red';
  members[3].color = '#ABCDEF';
  members[4].calendarId = 'c_gone';
  members[5].calendarId = 'birthdays';
  members[0].avatar = '';
  const f = sanitizeFamily({ members }, err, ['local', 'birthdays']);
  assert.equal(f.members.length, MAX_MEMBERS);
  assert.ok(errors.some((e) => e.path === 'family.members' && /max 6/.test(e.message)));
  assert.ok(errors.some((e) => e.path === 'family.members[2].color'));
  assert.equal(errors.length, 2, JSON.stringify(errors));
  assert.equal(f.members[0].name, 'Kid 0');
  assert.equal(f.members[0].avatar, '🙂');
  assert.equal(f.members[0].kid, true);
  assert.notEqual(f.members[1].id, 'm_0', 'duplicate id gets a new one');
  assert.match(f.members[1].id, /^m_/);
  assert.equal(f.members[2].color, PASTELS[2]);
  assert.equal(f.members[3].color, '#abcdef');
  assert.equal(f.members[1].color, PASTELS[1]);
  assert.equal(f.members[4].calendarId, null, 'unknown calendar → null, no error');
  assert.equal(f.members[5].calendarId, 'birthdays');
  const e2 = collect();
  sanitizeFamily({ members: [{ name: '' }, { name: 'x'.repeat(31) }] }, e2.err);
  assert.deepEqual(e2.errors.map((e) => e.path), ['family.members[0].name', 'family.members[1].name']);
});

test('sanitizeFamily: routines, rewards and their ranges', () => {
  const { errors, err } = collect();
  const f = sanitizeFamily({
    members: [{ id: 'm_a', name: 'Ana' }],
    chores: [
      { memberId: 'm_a', title: 'Ok' },
      { memberId: 'm_gone', title: 'Orphan' },
      { memberId: 'm_a', title: 'Bad', slot: 'night', days: [1, 1, 9], points: 21 },
      { memberId: 'm_a', title: '' },
    ],
    rewards: [{ title: 'Zoo', cost: 0 }, { title: 'Park', cost: 501 }, { title: 'Cine', cost: 12 }],
  }, err);
  assert.equal(f.chores.length, 3, 'the orphan routine is dropped');
  assert.deepEqual(f.chores[0], { id: f.chores[0].id, memberId: 'm_a', title: 'Ok', emoji: '⭐', days: [], slot: 'any', points: 1, enabled: true });
  assert.match(f.chores[0].id, /^h_/);
  assert.equal(f.chores[1].slot, 'any');
  assert.deepEqual(f.chores[1].days, [1]);
  assert.equal(f.chores[1].points, 1);
  assert.deepEqual(f.rewards.map((w) => w.cost), [10, 10, 12]);
  assert.match(f.rewards[0].id, /^w_/);
  assert.equal(f.rewards[0].emoji, '🎁');
  const paths = errors.map((e) => e.path);
  for (const p of ['family.chores[1].memberId', 'family.chores[2].slot', 'family.chores[2].days', 'family.chores[2].points',
    'family.chores[3].title', 'family.rewards[0].cost', 'family.rewards[1].cost']) assert.ok(paths.includes(p), `${p} in ${paths}`);
  assert.equal(errors.find((e) => e.path === 'family.chores[1].memberId').message, 'unknown member');
});

test('sanitizeFamily: meals (slots in a fixed order, week keys, 26 newest weeks, trimmed and capped texts)', () => {
  const { errors, err } = collect();
  const weeks = {};
  for (let i = 1; i <= 30; i++) weeks[`2026-W${String(i).padStart(2, '0')}`] = { 1: { lunch: `L${i}` } };
  weeks['2026-W54'] = { 1: { lunch: 'x' } };
  weeks['2026-w01'] = { 1: { lunch: 'x' } };
  weeks['2026-W40'] = { 1: { lunch: '  ' }, 2: {} };
  const f = sanitizeFamily({
    meals: {
      enabled: true, slots: ['dinner', 'breakfast', 'brunch'],
      template: { 0: { breakfast: '  Tostadas  ', dinner: 'y'.repeat(130), brunch: 'z' }, 7: { lunch: 'x' }, 3: { lunch: '' } },
      weeks,
    },
  }, err);
  assert.deepEqual(f.meals.slots, ['breakfast', 'dinner']);
  assert.equal(f.meals.template[0].breakfast, 'Tostadas');
  assert.equal(f.meals.template[0].dinner.length, 120);
  assert.equal(f.meals.template[0].brunch, undefined);
  assert.equal(f.meals.template[3], undefined, 'empty days removed');
  const keys = Object.keys(f.meals.weeks);
  assert.equal(keys.length, MAX_MEAL_WEEKS);
  assert.equal(keys[0], '2026-W05');
  assert.equal(keys.at(-1), '2026-W30');
  assert.ok(!('2026-W40' in f.meals.weeks), 'empty weeks removed');
  const paths = errors.map((e) => e.path);
  assert.ok(paths.includes('family.meals.slots'));
  assert.ok(paths.includes('family.meals.template.0.dinner'));
  assert.ok(paths.includes('family.meals.template.7'));
  assert.ok(paths.includes('family.meals.weeks.2026-W54'));
  assert.ok(paths.includes('family.meals.weeks.2026-w01'));
  assert.ok(!paths.some((p) => p === 'family.meals.weeks'), 'more than 26 weeks: the oldest go quietly');
});

test('screen family block: unknown members dropped quietly, validation wires both blocks', () => {
  const { errors, err } = collect();
  assert.deepEqual(sanitizeScreenFamily({ memberIds: ['m_a', 'm_x', 'm_a', 3], touch: true, showQr: false }, err, 'screens[0].family', ['m_a']),
    { memberIds: ['m_a'], touch: true, showQr: false });
  assert.deepEqual(errors, []);
  sanitizeScreenFamily({ touch: 'yes' }, err, 'screens[0].family', []);
  assert.equal(errors[0].path, 'screens[0].family.touch');

  const c = defaultConfig();
  c.family = { enabled: true, members: [{ id: 'm_a', name: 'Ana', calendarId: 'local' }] };
  c.screens[0].family = { memberIds: ['m_a', 'm_old'], touch: true };
  c.screens.push(defaultScreenProfile({ id: 's_k', slug: 'k', name: 'K' }));
  delete c.screens[1].family;
  const r = validateConfig(mergeDefaults(c));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.screens[0].family, { memberIds: ['m_a'], touch: true, showQr: true });
  assert.deepEqual(r.value.screens[1].family, { memberIds: null, touch: false, showQr: true });
  assert.equal(r.value.family.members[0].calendarId, 'local');
  // an older config without the block gets it back-filled
  const old = defaultConfig();
  delete old.family;
  delete old.screens[0].family;
  const r2 = validateConfig(mergeDefaults(old));
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.value.family, defaultFamily());
  // a chore of a member that was removed: the save is refused with a path
  const bad = validateConfig({ ...r.value, family: { ...r.value.family, chores: [{ memberId: 'm_zz', title: 'x' }] } });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.path), ['family.chores[0].memberId']);
});

test('isoWeekKey across year ends, dayOfWeek, weekStartOf', () => {
  assert.equal(isoWeekKey('2026-12-31'), '2026-W53');
  assert.equal(isoWeekKey('2027-01-01'), '2026-W53');
  assert.equal(isoWeekKey('2027-01-04'), '2027-W01');
  assert.equal(isoWeekKey('2025-12-29'), '2026-W01');
  assert.equal(isoWeekKey('2026-10-12'), '2026-W42');
  assert.equal(isoWeekKey('2026-10-18'), '2026-W42');
  assert.equal(dayOfWeek(MON), 1);
  assert.equal(dayOfWeek('2026-10-18'), 0);
  assert.equal(weekStartOf('2026-10-14', 1), MON);
  assert.equal(weekStartOf('2026-10-18', 1), MON);
  assert.equal(weekStartOf('2026-10-14', 0), '2026-10-11');
  assert.equal(weekStartOf('2026-10-11', 0), '2026-10-11');
});

test('mealsForDate: the week plan wins, its empty days stay empty, template fallback, useTemplate off', () => {
  const meals = family().meals;
  assert.deepEqual(mealsForDate(meals, MON), { lunch: 'Lentejas', dinner: 'Tortilla' });
  assert.deepEqual(mealsForDate(meals, '2026-10-13'), { lunch: 'Arroz' });
  assert.deepEqual(mealsForDate(meals, '2026-10-14'), {});
  const planned = { ...meals, weeks: { '2026-W42': { 2: { lunch: 'Pescado', breakfast: 'Tostadas' } } } };
  assert.deepEqual(mealsForDate(planned, '2026-10-13'), { lunch: 'Pescado' }, 'only enabled slots');
  assert.deepEqual(mealsForDate(planned, MON), {}, 'a planned week does not borrow from the template');
  assert.deepEqual(mealsForDate(planned, '2026-10-19'), { lunch: 'Lentejas', dinner: 'Tortilla' }, 'next week has no plan');
  assert.deepEqual(mealsForDate({ ...meals, useTemplate: false }, MON), {});
  const week = mealsOfWeek(meals, MON);
  assert.equal(week.length, 7);
  assert.deepEqual(week[0], { date: MON, dow: 1, meals: { lunch: 'Lentejas', dinner: 'Tortilla' } });
  assert.equal(week[6].date, '2026-10-18');
  assert.equal(week[6].dow, 0);
});

test('slotAt boundaries and choresForDay ordering + filters', () => {
  assert.equal(slotAt('00:00'), 'morning');
  assert.equal(slotAt('11:59'), 'morning');
  assert.equal(slotAt('12:00'), 'afternoon');
  assert.equal(slotAt('17:59'), 'afternoon');
  assert.equal(slotAt('18:00'), 'evening');
  assert.equal(slotAt('23:59'), 'evening');
  const f = family();
  assert.deepEqual(choresForDay(f, MON).map((c) => c.id), ['h_bed', 'h_home', 'h_teeth_pm', 'h_toys', 'h_coffee']);
  assert.deepEqual(choresForDay(f, '2026-10-18').map((c) => c.id), ['h_bed', 'h_teeth_pm', 'h_weekend', 'h_toys', 'h_coffee'], 'Sunday');
  assert.deepEqual(choresForDay(f, MON, ['m_mateo']).map((c) => c.id), ['h_toys']);
  assert.deepEqual(choresForDay(f, MON, []), []);
});

test('applyToggle: idempotent, unknown and not-scheduled routines, snapshots survive edits, adults earn nothing', () => {
  const f = family();
  let s = emptyState();
  const on = applyToggle(f, s, { choreId: 'h_bed', date: MON, done: true, by: 'phone', at: AT });
  assert.equal(on.changed, true);
  assert.equal(on.state.rev, 1);
  assert.deepEqual(on.state.completions[MON].h_bed, { memberId: 'm_lucia', points: 2, title: 'Hacer la cama', emoji: '🛏️', by: 'phone', at: AT });
  assert.deepEqual(s, emptyState(), 'pure: the old state is untouched');
  s = on.state;
  const again = applyToggle(f, s, { choreId: 'h_bed', date: MON, done: true, at: AT });
  assert.equal(again.changed, false);
  assert.equal(again.state, s);
  assert.deepEqual(applyToggle(f, s, { choreId: 'h_nope', date: MON, done: true, at: AT }), { error: 'unknown_chore' });
  assert.deepEqual(applyToggle(f, s, { choreId: 'h_off', date: MON, done: true, at: AT }), { error: 'unknown_chore' });
  assert.deepEqual(applyToggle(f, s, { choreId: 'h_weekend', date: MON, done: true, at: AT }), { error: 'not_today' });
  // the routine is edited afterwards: the stars earned stay what they were
  const edited = family((x) => { x.chores[1].points = 9; x.chores[1].title = 'Cama'; });
  assert.equal(pointsOf(edited, s).m_lucia, 2);
  s = applyToggle(f, s, { choreId: 'h_coffee', date: MON, done: true, at: AT }).state;
  assert.equal(s.completions[MON].h_coffee.points, 0);
  assert.deepEqual(Object.keys(pointsOf(f, s)).sort(), ['m_lucia', 'm_mateo']);
  assert.deepEqual(todayProgress(f, s, MON), { m_lucia: { done: 1, total: 3 }, m_mateo: { done: 0, total: 1 }, m_mama: { done: 1, total: 1 } });
  const off = applyToggle(f, s, { choreId: 'h_bed', date: MON, done: false, at: AT });
  assert.equal(off.changed, true);
  assert.equal(off.state.completions[MON].h_bed, undefined);
  const off2 = applyToggle(f, off.state, { choreId: 'h_coffee', date: MON, done: false, at: AT });
  assert.equal(off2.state.completions[MON], undefined, 'an empty day is removed');
  // a routine moved to someone else the same day starts undone for them; ticking it gives them the stars
  const moved = family((x) => { x.chores.find((c) => c.id === 'h_bed').memberId = 'm_mateo'; });
  assert.equal(todayProgress(moved, s, MON).m_mateo.done, 0);
  assert.equal(applyToggle(moved, s, { choreId: 'h_bed', date: MON, done: false, at: AT }).changed, false, "Lucía's stars stay");
  const mine = applyToggle(moved, s, { choreId: 'h_bed', date: MON, done: true, at: AT });
  assert.equal(mine.changed, true);
  assert.equal(mine.state.completions[MON].h_bed.memberId, 'm_mateo');
  assert.equal(todayProgress(moved, mine.state, MON).m_mateo.done, 1);
});

test('points: base + completions + adjustments − redemptions; redeem, adjust and undo', () => {
  const f = family();
  let s = { ...emptyState(), base: { m_lucia: 5, m_mama: 50 } };
  s = applyToggle(f, s, { choreId: 'h_home', date: MON, done: true, at: AT }).state;
  assert.deepEqual(pointsOf(f, s), { m_lucia: 8, m_mateo: 0 });
  assert.deepEqual(applyRedeem(f, s, { rewardId: 'w_movie', memberId: 'm_lucia', at: AT }), { error: 'not_enough' });
  assert.deepEqual(applyRedeem(f, s, { rewardId: 'w_x', memberId: 'm_lucia', at: AT }), { error: 'unknown_reward' });
  assert.deepEqual(applyRedeem(f, s, { rewardId: 'w_ice', memberId: 'm_x', at: AT }), { error: 'unknown_member' });
  assert.deepEqual(applyRedeem(f, s, { rewardId: 'w_ice', memberId: 'm_mama', at: AT }), { error: 'not_kid' });
  const forced = applyRedeem(f, s, { rewardId: 'w_movie', memberId: 'm_lucia', at: AT, force: true });
  assert.equal(pointsOf(f, forced.state).m_lucia, -2, 'the raw balance may go below zero');
  const r = applyRedeem(f, s, { rewardId: 'w_ice', memberId: 'm_lucia', by: 'phone', at: AT, id: 'rd_1' });
  assert.deepEqual(r.entry, { id: 'rd_1', rewardId: 'w_ice', memberId: 'm_lucia', title: 'Helado', emoji: '🍦', cost: 3, by: 'phone', at: AT });
  s = r.state;
  assert.equal(pointsOf(f, s).m_lucia, 5);
  for (const delta of [0, 501, 1.5, 'x', null]) assert.deepEqual(applyAdjust(f, s, { memberId: 'm_mateo', delta, at: AT }), { error: 'bad_delta' }, String(delta));
  assert.deepEqual(applyAdjust(f, s, { memberId: 'm_mama', delta: 2, at: AT }), { error: 'not_kid' });
  const a = applyAdjust(f, s, { memberId: 'm_mateo', delta: '4', note: '  Ayudó en casa ', at: AT, id: 'ad_1' });
  assert.deepEqual(a.entry, { id: 'ad_1', memberId: 'm_mateo', delta: 4, note: 'Ayudó en casa', at: AT });
  s = a.state;
  assert.equal(pointsOf(f, s).m_mateo, 4);
  const u = undoEntry(s, { kind: 'redemption', id: 'rd_1' });
  assert.equal(pointsOf(f, u.state).m_lucia, 8, 'undo refunds');
  assert.equal(u.state.rev, s.rev + 1);
  assert.equal(pointsOf(f, undoEntry(s, { kind: 'adjustment', id: 'ad_1' }).state).m_mateo, 0);
  assert.deepEqual(undoEntry(s, { kind: 'adjustment', id: 'rd_1' }), { error: 'not_found' });
  assert.deepEqual(undoEntry(s, { kind: 'other', id: 'rd_1' }), { error: 'not_found' });
});

test('pruneState folds entries older than 90 days into base and keeps the totals', () => {
  const f = family();
  const today = '2026-10-12';
  const old = addDays(today, -(RETENTION_DAYS + 1));
  const edge = addDays(today, -RETENTION_DAYS);
  let s = emptyState();
  for (const date of [old, edge, today]) s = applyToggle(f, s, { choreId: 'h_bed', date, done: true, at: `${date}T08:00:00.000Z` }).state;
  s = applyAdjust(f, s, { memberId: 'm_mateo', delta: 7, at: `${old}T09:00:00.000Z`, id: 'ad_old' }).state;
  s = applyAdjust(f, s, { memberId: 'm_mateo', delta: -2, at: `${today}T09:00:00.000Z`, id: 'ad_new' }).state;
  s = applyRedeem(f, s, { rewardId: 'w_ice', memberId: 'm_lucia', at: `${old}T10:00:00.000Z`, id: 'rd_old' }).state;
  const before = pointsOf(f, s);
  const p = pruneState(s, today);
  assert.deepEqual(pointsOf(f, p), before);
  assert.deepEqual(Object.keys(p.completions).sort(), [edge, today]);
  assert.deepEqual(p.adjustments.map((x) => x.id), ['ad_new']);
  assert.deepEqual(p.redemptions, []);
  assert.deepEqual(p.base, { m_lucia: 2 - 3, m_mateo: 7 });
  assert.equal(pruneState(p, today), p, 'nothing old: the same object');
});

test('sanitizeState: malformed entries dropped, caps fold into base', () => {
  const f = family();
  assert.deepEqual(sanitizeState(null), emptyState());
  assert.deepEqual(sanitizeState('x'), emptyState());
  const redemptions = Array.from({ length: 505 }, (_, i) => ({ id: `rd_${i}`, rewardId: 'w_ice', memberId: 'm_lucia', title: 'Helado', cost: 1, at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  const raw = {
    rev: 4, base: { m_lucia: 600, 'bad id': 3, m_mateo: 1.5 }, extra: true,
    completions: {
      [MON]: { h_bed: { memberId: 'm_lucia', points: 2, title: 'Cama', emoji: '🛏️', by: 'tv', at: AT }, h_bad: { memberId: 'm_lucia', points: 50, at: AT } },
      'not-a-date': {},
    },
    redemptions: [...redemptions, { id: 'rd_bad', memberId: 'm_lucia', cost: -1, at: AT }],
    adjustments: [{ id: 'ad_1', memberId: 'm_lucia', delta: 0, at: AT }, { id: 'ad_2', memberId: 'm_lucia', delta: 3, note: 'ok', at: AT }],
  };
  const s = sanitizeState(raw);
  assert.equal(s.rev, 4);
  assert.equal(s.extra, undefined);
  assert.deepEqual(s.completions, { [MON]: { h_bed: { memberId: 'm_lucia', points: 2, title: 'Cama', emoji: '🛏️', by: 'admin', at: AT } } });
  assert.equal(s.redemptions.length, 500);
  assert.equal(s.redemptions[0].id, 'rd_5', 'the oldest go first');
  assert.deepEqual(s.base, { m_lucia: 600 - 5 });
  assert.deepEqual(s.adjustments.map((a) => a.id), ['ad_2']);
  assert.equal(pointsOf(f, s).m_lucia, 600 + 2 + 3 - 505, 'balances as if nothing was dropped');
});

test('initials and next rewards', () => {
  assert.equal(initials('Lucía'), 'L');
  assert.equal(initials('maría josé pérez'), 'MJ');
  assert.equal(initials('  Ñu  '), 'Ñ');
  assert.equal(initials(''), '');
  const f = family();
  assert.deepEqual(nextRewards(f, { m_lucia: 2, m_mateo: 12 }), {
    m_lucia: { title: 'Helado', emoji: '🍦', cost: 3, missing: 1 },
    m_mateo: { title: 'Peli del viernes', emoji: '🎬', cost: 10, missing: 0 },
  });
  assert.deepEqual(nextRewards(family((x) => { x.rewards = []; }), { m_lucia: 2 }), {});
});

function cfgWithFamily(mutScreen = (s) => s, mutFam = (f) => f) {
  const c = defaultConfig();
  c.family = family(mutFam);
  mutScreen(c.screens[0]);
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.value;
}

test('displayFamily: members of the screen, today, meals of its week, next reward; privacy initials and hide', () => {
  const cfg = cfgWithFamily((s) => { s.family = { memberIds: ['m_mateo', 'm_lucia'], touch: true, showQr: true }; s.layout.preset = 'kidsRoutines'; });
  const screen = cfg.screens[0];
  let s = { ...emptyState(), base: { m_mateo: 12 } };
  s = applyToggle(cfg.family, s, { choreId: 'h_bed', date: MON, done: true, at: AT }).state;
  const d = displayFamily(cfg, screen, s, { today: MON, hhmm: '08:10', qrUrl: 'http://x/f/k', generatedAt: AT });
  assert.equal(d.slotNow, 'morning');
  assert.equal(d.private, false);
  assert.equal(d.hidden, false);
  assert.equal(d.touch, true);
  assert.equal(d.showPoints, true);
  assert.equal(d.qrUrl, 'http://x/f/k');
  assert.deepEqual(d.members.map((m) => [m.id, m.name, m.initials, m.points, m.done, m.total]), [
    ['m_mateo', 'Mateo Luis', 'ML', 12, 0, 1],
    ['m_lucia', 'Lucía', 'L', 2, 1, 3],
  ]);
  assert.deepEqual(d.chores.map((c) => [c.id, c.done, c.points]), [['h_toys', false, 1], ['h_bed', true, 2], ['h_home', false, 3], ['h_teeth_pm', false, 1]]);
  assert.equal(d.meals.days[0].date, MON, 'weekStart Monday');
  assert.deepEqual(d.meals.slots, ['lunch', 'dinner']);
  assert.deepEqual(d.nextReward.m_lucia, { title: 'Helado', emoji: '🍦', cost: 3, missing: 1 });
  assert.equal(d.nextReward.m_mama, undefined);
  assert.equal(d.generatedAt, AT);

  const p = displayFamily(cfg, screen, s, { today: MON, hhmm: '19:00', private: true, qrUrl: 'http://x/f/k' });
  assert.equal(p.slotNow, 'evening');
  assert.deepEqual(p.members.map((m) => [m.name, m.points]), [['ML', null], ['L', null]]);
  assert.equal(p.showPoints, false);
  assert.equal(p.touch, false);
  assert.equal(p.qrUrl, null);
  assert.equal(p.nextReward, undefined);
  assert.ok(p.chores.length && p.chores.every((c) => c.points === 0));
  assert.ok(p.meals, 'meals stay while private');

  const hideCfg = cfgWithFamily((sc) => sc, (f) => { f.privacy = 'hide'; });
  const h = displayFamily(hideCfg, hideCfg.screens[0], s, { today: MON, private: true });
  assert.equal(h.hidden, true);
  assert.deepEqual(h.members, []);
  assert.deepEqual(h.chores, []);
  assert.ok(h.meals);
  // QR off on the screen, or family off
  const noQr = cfgWithFamily((sc) => { sc.family = { showQr: false }; });
  assert.equal(displayFamily(noQr, noQr.screens[0], s, { today: MON, qrUrl: 'http://x' }).qrUrl, null);
  // a normal layout never gets the family link
  const normal = cfgWithFamily((sc) => { sc.family = { showQr: true }; sc.layout.preset = 'bigCalendar'; });
  assert.equal(displayFamily(normal, normal.screens[0], s, { today: MON, qrUrl: 'http://x' }).qrUrl, null);
  const noMeals = cfgWithFamily((sc) => sc, (f) => { f.meals.enabled = false; f.showPoints = false; });
  const nm = displayFamily(noMeals, noMeals.screens[0], s, { today: MON });
  assert.equal(nm.meals, null);
  assert.equal(nm.nextReward, undefined);
  assert.ok(nm.members.every((m) => m.points === null));
});

test('phoneFamily: everyone, today, rewards and meals; never the rest of the config', () => {
  const cfg = cfgWithFamily();
  let s = emptyState();
  s = applyToggle(cfg.family, s, { choreId: 'h_toys', date: MON, done: true, at: AT }).state;
  const p = phoneFamily(cfg, s, { today: MON, hhmm: '13:00', lang: 'pt' });
  assert.deepEqual(Object.keys(p).sort(), ['allowRedeem', 'chores', 'lang', 'meals', 'members', 'rev', 'rewards', 'showPoints', 'slotNow', 'today']);
  assert.equal(p.slotNow, 'afternoon');
  assert.equal(p.lang, 'pt');
  assert.equal(p.allowRedeem, false);
  assert.deepEqual(p.members.map((m) => [m.id, m.points, m.done, m.total]), [['m_lucia', 0, 0, 3], ['m_mateo', 1, 1, 1], ['m_mama', null, 0, 1]]);
  assert.equal(p.chores.find((c) => c.id === 'h_toys').done, true);
  assert.deepEqual(p.rewards[0], { id: 'w_movie', title: 'Peli del viernes', emoji: '🎬', cost: 10 });
  assert.deepEqual(p.meals, { slots: ['lunch', 'dinner'], today: { lunch: 'Lentejas', dinner: 'Tortilla' } });
  const txt = JSON.stringify(p);
  for (const leak of ['calendar', 'screens', 'sources', 'c_work']) assert.ok(!txt.includes(leak), leak);
});

test('adminFamily: last 14 days newest first, last 50 entries', () => {
  const f = family();
  let s = emptyState();
  for (let i = 0; i < 20; i++) {
    const date = addDays(MON, -i);
    s = applyToggle(f, s, { choreId: 'h_toys', date, done: true, at: `${date}T10:00:00.000Z` }).state;
  }
  for (let i = 0; i < 60; i++) s = applyAdjust(f, s, { memberId: 'm_mateo', delta: 1, at: AT, id: `ad_${i}` }).state;
  const a = adminFamily(f, s, { today: MON });
  assert.equal(a.completions.length, 14);
  assert.equal(a.completions[0].date, MON);
  assert.equal(a.completions[0].choreId, 'h_toys');
  assert.equal(a.adjustments.length, 50);
  assert.equal(a.adjustments[0].id, 'ad_59');
  assert.equal(a.points.m_mateo, 80);
  assert.deepEqual(a.progress.m_mateo, { done: 1, total: 1 });
});

test('familyCore stays portable: no fs, no express, no store; only lib/tz.js, the pure photo checks and Mealie rules', () => {
  const src = fs.readFileSync(new URL('../core/familyCore.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./lib/tz.js', './familyPhotoCore.js', './mealieCore.js']);
  const mealie = fs.readFileSync(new URL('../core/mealieCore.js', import.meta.url), 'utf8');
  assert.deepEqual([...mealie.matchAll(/^import .* from '([^']+)';$/gm)], [], 'mealieCore.js has no imports');
  const photo = fs.readFileSync(new URL('../core/familyPhotoCore.js', import.meta.url), 'utf8');
  assert.deepEqual([...photo.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]), ['./imageInfo.js']);
  assert.doesNotMatch(photo, /\bBuffer\b|node:/);
  assert.ok(FAMILY_KEY_RE.test(`fk_${'a'.repeat(32)}`));
  assert.ok(!FAMILY_KEY_RE.test(`fk_${'a'.repeat(31)}`));
});
