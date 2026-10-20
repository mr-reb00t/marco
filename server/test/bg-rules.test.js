// Special backgrounds (#14, server/core/bgRules.js): rule matching (each kind, ranges over the year end, accents and
// case, calendar filter, the time zone near midnight, first match wins, privacy), validation, the /api/photos answer,
// which gallery files a display may load, and the live event when the active rule changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { localDate } from '../core/lib/tz.js';
import {
  backgroundRuleSig, eventOnDay, inYearlyRange, matchBackgroundRule, ruleGalleryFiles, sanitizeBackgroundRules, MAX_BG_RULES, MAX_BG_RULE_PHOTOS,
} from '../core/bgRules.js';
import { displayConfig } from '../core/screens.js';
import { ensurePassword, hashPassword, _resetLoginLimits } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPoll } from '../pollHub.js';
import { _resetActivityThrottle } from '../activity.js';
import { syncDisplayKeys, listDisplayLinks, _resetDisplayAccess } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { syncPhotoRules, _resetPhotoRules } from '../photoRules.js';

const ALBUM = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const ev = (title, sourceId = 'local', extra = {}) => ({ id: title, sourceId, title, start: '2026-12-24', end: '2026-12-25', allDay: true, ...extra });
const rule = (id, when, files = ['x.jpg']) => ({ id, when, photos: { source: 'gallery', files } });
const at = (today, more = {}) => ({ today, tz: 'Europe/Madrid', screenSources: ['local', 'c_work'], ...more });

// ---------------------------------------------------------------- matching

test('event rules: a word of the title, accents and case ignored, only on the calendars they name', () => {
  const rules = [rule('xmas', { type: 'event', text: 'navidad', calendars: [] })];
  assert.equal(matchBackgroundRule(rules, at('2026-12-24', { events: [ev('Cena de NAVIDÁD en casa')] }))?.id, 'xmas');
  assert.equal(matchBackgroundRule(rules, at('2026-12-24', { events: [ev('Cena')] })), null);
  // a phrase, with spaces and accents in the rule itself
  const phrase = [rule('p', { type: 'event', text: 'Día de playa', calendars: [] })];
  assert.equal(matchBackgroundRule(phrase, at('2026-12-24', { events: [ev('DIA DE PLAYA con los primos')] }))?.id, 'p');
  // no calendars of its own: the calendars the screen shows; a calendar the screen does not show does not count
  assert.equal(matchBackgroundRule(rules, at('2026-12-24', { events: [ev('Navidad', 'c_other')] })), null);
  // its own calendars: only those
  const onlyWork = [rule('w', { type: 'event', text: 'navidad', calendars: ['c_work'] })];
  assert.equal(matchBackgroundRule(onlyWork, at('2026-12-24', { events: [ev('Navidad', 'local')] })), null);
  assert.equal(matchBackgroundRule(onlyWork, at('2026-12-24', { events: [ev('Navidad', 'c_work')] }))?.id, 'w');
  // an event of another day does not count
  assert.equal(matchBackgroundRule(rules, at('2026-12-26', { events: [ev('Navidad')] })), null);
});

test('event rules: timed events count on the local day of the screen time zone, near midnight too', () => {
  const tz = 'Europe/Madrid';
  // 23:30 in Madrid on the 24th is 22:30 UTC: still the 24th there
  const late = { id: 'a', sourceId: 'local', title: 'Nochebuena', allDay: false, start: '2026-12-24T23:30:00+01:00', end: '2026-12-25T00:00:00+01:00' };
  assert.equal(eventOnDay(late, '2026-12-24', tz), true);
  assert.equal(eventOnDay(late, '2026-12-25', tz), false, 'an end at midnight does not reach the next day');
  // 00:30 on the 25th in Madrid is 23:30 UTC on the 24th: the 25th there
  const early = { ...late, start: '2026-12-24T23:30:00Z', end: '2026-12-25T00:30:00Z' };
  assert.equal(eventOnDay(early, '2026-12-24', tz), false);
  assert.equal(eventOnDay(early, '2026-12-25', tz), true);
  assert.equal(eventOnDay(early, '2026-12-24', 'UTC'), true);
  // a multi-day all-day event counts on each of its days, not on its (exclusive) end
  const trip = ev('Viaje', 'local', { start: '2026-12-20', end: '2026-12-27' });
  assert.equal(eventOnDay(trip, '2026-12-26', tz), true);
  assert.equal(eventOnDay(trip, '2026-12-27', tz), false);
});

test('range and date rules repeat every year; a range may wrap the year end', () => {
  assert.equal(inYearlyRange('2026-12-15', '12-01', '12-31'), true);
  assert.equal(inYearlyRange('2026-11-30', '12-01', '12-31'), false);
  // 20 December to 6 January
  assert.equal(inYearlyRange('2026-12-31', '12-20', '01-06'), true);
  assert.equal(inYearlyRange('2027-01-03', '12-20', '01-06'), true);
  assert.equal(inYearlyRange('2027-01-07', '12-20', '01-06'), false);
  assert.equal(inYearlyRange('2026-12-19', '12-20', '01-06'), false);
  const rules = [rule('xmas', { type: 'date', on: '12-25' }), rule('dec', { type: 'range', from: '12-01', to: '12-31' })];
  assert.equal(matchBackgroundRule(rules, at('2031-12-25'))?.id, 'xmas');
  assert.equal(matchBackgroundRule(rules, at('2031-12-26'))?.id, 'dec');
  assert.equal(matchBackgroundRule(rules, at('2031-11-26')), null);
  // 29 February falls on the 28th in other years
  const leap = [rule('l', { type: 'date', on: '02-29' })];
  assert.equal(matchBackgroundRule(leap, at('2027-02-28'))?.id, 'l');
  assert.equal(matchBackgroundRule(leap, at('2028-02-28')), null);
  assert.equal(matchBackgroundRule(leap, at('2028-02-29'))?.id, 'l');
});

test('birthday rules: someone of the birthdays list today', () => {
  const rules = [rule('b', { type: 'birthday' })];
  const birthdays = [{ id: 'b1', name: 'Ana', month: 3, day: 7, year: null }];
  assert.equal(matchBackgroundRule(rules, at('2026-03-07', { birthdays }))?.id, 'b');
  assert.equal(matchBackgroundRule(rules, at('2026-03-08', { birthdays })), null);
  assert.equal(matchBackgroundRule(rules, at('2026-03-07', { birthdays: [] })), null);
});

test('the first rule that matches wins, in the order of the list', () => {
  const event = rule('event', { type: 'event', text: 'cumple', calendars: [] });
  const month = rule('month', { type: 'range', from: '03-01', to: '03-31' });
  const opts = at('2026-03-07', { events: [ev('Cumple de Ana', 'local', { start: '2026-03-07', end: '2026-03-08' })] });
  assert.equal(matchBackgroundRule([event, month], opts).id, 'event');
  assert.equal(matchBackgroundRule([month, event], opts).id, 'month');
  assert.equal(matchBackgroundRule([], opts), null);
});

test('while private, busy calendars have no titles to match and birthdays count only when kept', () => {
  const cfg = defaultConfig();
  cfg.localEvents.privacy = 'busy';
  const rules = [rule('e', { type: 'event', text: 'navidad', calendars: [] }), rule('b', { type: 'birthday' })];
  const opts = at('2026-12-24', { events: [ev('Navidad')], cfg, birthdays: [{ month: 12, day: 24 }] });
  assert.equal(matchBackgroundRule(rules, opts).id, 'e');
  assert.equal(matchBackgroundRule(rules, { ...opts, isPrivate: true }).id, 'b');
  cfg.birthdays.privacy = 'busy';
  assert.equal(matchBackgroundRule(rules, { ...opts, isPrivate: true }), null);
});

test('the rule signature changes with the rule, never shows it', () => {
  const a = rule('a', { type: 'date', on: '12-25' });
  assert.equal(backgroundRuleSig(null), '');
  assert.match(backgroundRuleSig(a), /^[0-9a-f]{12}$/);
  assert.notEqual(backgroundRuleSig(a), backgroundRuleSig({ ...a, photos: { source: 'gallery', files: ['y.jpg'] } }));
  assert.equal(backgroundRuleSig(a), backgroundRuleSig(structuredClone(a)));
});

// ---------------------------------------------------------------- validation

test('validation: caps, bad dates and empty words refused, unknown photos and calendars dropped quietly', () => {
  const errs = [];
  const err = (p, m) => errs.push(`${p}: ${m}`);
  const out = sanitizeBackgroundRules([
    { id: 'r1', when: { type: 'event', text: '  Navidad   en casa ', calendars: ['local', 'c_gone', 'local'] }, photos: { source: 'gallery', files: ['a.jpg', '../etc/passwd', '.hidden.jpg', 'a.jpg', 'notes.txt'] } },
    { when: { type: 'range', from: '12-20', to: '01-06' }, photos: { files: ['b.png'] } },
    { id: 'r1', when: { type: 'date', on: '12-25' }, photos: { source: 'immich', albumId: ALBUM.toUpperCase() } },
    { when: { type: 'birthday' }, photos: { source: 'gallery', files: ['c.webp'] }, extra: 'dropped' },
  ], { err, sourceIds: ['local', 'birthdays'] });
  assert.deepEqual(errs, []);
  assert.deepEqual(out[0], { id: 'r1', when: { type: 'event', text: 'Navidad en casa', calendars: ['local'] }, photos: { source: 'gallery', files: ['a.jpg'] } });
  assert.deepEqual(out[1].when, { type: 'range', from: '12-20', to: '01-06' });
  assert.equal(out[1].photos.source, 'gallery');
  assert.notEqual(out[2].id, 'r1', 'a repeated id gets a new one');
  assert.deepEqual(out[2].photos, { source: 'immich', albumId: ALBUM });
  assert.deepEqual(Object.keys(out[3]), ['id', 'when', 'photos']);

  const bad = [];
  sanitizeBackgroundRules([
    { when: { type: 'event', text: '' }, photos: { files: ['a.jpg'] } },
    { when: { type: 'event', text: 'x'.repeat(61) }, photos: { files: ['a.jpg'] } },
    { when: { type: 'range', from: '13-01', to: '02-30' }, photos: { files: ['a.jpg'] } },
    { when: { type: 'date', on: '2026-12-25' }, photos: { files: [] } },
    { when: { type: 'sometimes' }, photos: { source: 'immich', albumId: 'nope' } },
    { when: { type: 'birthday' }, photos: { files: Array.from({ length: MAX_BG_RULE_PHOTOS + 1 }, (_, i) => `p${i}.jpg`) } },
  ], { err: (p, m) => bad.push(`${p}: ${m}`) });
  assert.ok(bad.includes('background.rules[0].when.text: required'));
  assert.ok(bad.includes('background.rules[1].when.text: too long (max 60)'));
  assert.ok(bad.includes('background.rules[2].when.from: invalid date (MM-DD)'));
  assert.ok(bad.includes('background.rules[3].photos.files: at least one photo'));
  assert.ok(bad.includes('background.rules[4].when.type: must be one of event, range, date, birthday'));
  assert.ok(bad.includes('background.rules[4].photos.albumId: invalid album id'));
  assert.ok(bad.includes('background.rules[5].photos.files: too many items (max 50)'));

  const many = [];
  const list = sanitizeBackgroundRules(Array.from({ length: MAX_BG_RULES + 2 }, () => rule('', { type: 'birthday' })), { err: (p, m) => many.push(m) });
  assert.equal(list.length, MAX_BG_RULES);
  assert.deepEqual(many, ['too many items (max 30)']);
});

test('the config validator keeps the rules of each screen; Marco Cloud (no Immich) refuses Immich rules', () => {
  const c = defaultConfig();
  c.screens[0].background.rules = [rule('r1', { type: 'event', text: 'Navidad', calendars: ['birthdays', 'c_gone'] })];
  const r = validateConfig(c);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.value.screens[0].background.rules[0].when.calendars, ['birthdays']);
  assert.deepEqual(validateConfig(defaultConfig()).value.screens[0].background.rules, []);
  c.screens[0].background.rules = [{ id: 'r2', when: { type: 'birthday' }, photos: { source: 'immich', albumId: ALBUM } }];
  assert.deepEqual(validateConfig(c).errors, []);
  assert.deepEqual(validateConfig(c, { immichAvailable: false }).errors.map((e) => e.path), ['screens[0].background.rules[0].photos.source']);
});

test('the display config never carries the rules', () => {
  const c = validateConfig((() => {
    const x = defaultConfig();
    x.screens[0].background.rules = [rule('r1', { type: 'event', text: 'Secret dentist', calendars: [] })];
    return x;
  })()).value;
  const d = displayConfig(c, c.screens[0]);
  assert.equal('rules' in d.background, false);
  assert.equal(d.background.special, true, 'only that there are some');
  assert.equal('special' in displayConfig(validateConfig(defaultConfig()).value, validateConfig(defaultConfig()).value.screens[0]).background, false);
  assert.ok(!JSON.stringify(d).includes('Secret dentist'));
});

// ---------------------------------------------------------------- server

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
const PASSWORD = 'secret-pass-123';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 100, 0, 150, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

/** Two screens with stock photos: the living room has rules (Navidad today → xmas photos), the guest screen none. */
async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-bgrules-'));
  globalThis.fetch = offlineFetch;
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  const today = localDate(new Date(), c.datetime.timezone);
  c.localEvents.items = [{ id: 'l_xmas', title: 'Cena de Navidad', allDay: true, date: today, endDate: today }];
  c.screens[0].background.source = 'stock';
  c.screens[0].privacy = { ...(c.screens[0].privacy || {}), hidePhotos: true };
  c.screens[0].background.rules = [
    rule('r_event', { type: 'event', text: 'navidad', calendars: [] }, ['xmas_1.jpg', 'xmas_2.jpg', 'hidden.jpg', 'gone.jpg']),
    rule('r_year', { type: 'range', from: '01-01', to: '12-31' }, ['year.jpg']),
  ];
  c.screens.push(defaultScreenProfile({ id: 's_guest', slug: 'guest', name: 'Guest' }));
  c.screens[1].background.source = 'stock';
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(validateConfig(c).value));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword(PASSWORD), passwordIsDefault: false }));
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  for (const f of ['xmas_1.jpg', 'xmas_2.jpg', 'hidden.jpg', 'year.jpg', 'other.jpg']) fs.writeFileSync(path.join(dir, 'photos', f), JPEG);
  fs.writeFileSync(path.join(dir, 'photos', '.meta.json'), JSON.stringify({ 'hidden.jpg': { hidden: true } }));
  store.initStore(dir);
  _resetDisplays();
  _resetPoll();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetLoginLimits();
  _resetPrivacy();
  _resetPhotoRules();
  setServerVersion('0.13.0');
  await ensurePassword();
  syncDisplayKeys();
  const app = createApp({ version: '0.13.0', dist: path.join(dir, 'no-dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {}, cookie = '' } = {}) => {
    const r = await realFetch(base + url, {
      method,
      headers: { ...headers, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, headers: r.headers, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: PASSWORD } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  const keyOf = (slug) => listDisplayLinks().find((l) => l.slug === slug).key;
  const photosOf = async (slug) => (await call('GET', '/api/photos?count=20', { headers: { 'x-marco-key': keyOf(slug) } })).json;
  try {
    await fn({ call, login, keyOf, photosOf });
  } finally {
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
    _resetLoginLimits();
    _resetPrivacy();
    _resetPhotoRules();
  }
}

test('/api/photos: the photos of the first rule that matches, its signature, never hidden or missing files', async () => {
  await withServer(async ({ call, login, photosOf }) => {
    const r = await photosOf('living-room');
    assert.deepEqual(r.photos.map((p) => p.file).sort(), ['xmas_1.jpg', 'xmas_2.jpg']);
    assert.ok(r.photos.every((p) => p.source === 'gallery'));
    assert.match(r.rule, /^[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(r).includes('navidad'), 'the rule itself stays on the server');
    // the guest screen has no rules: stock as before, no signature
    const g = await photosOf('guest');
    assert.ok(g.photos.every((p) => p.source === 'stock'));
    assert.equal(g.rule, '');
    // the event goes away: the next rule (the whole year) takes over
    const cookie = await login();
    const cfg = (await call('GET', '/api/admin/config', { cookie })).json;
    cfg.localEvents.items = [];
    assert.equal((await call('PUT', '/api/admin/config', { cookie, body: cfg })).status, 200);
    const y = await photosOf('living-room');
    assert.deepEqual(y.photos.map((p) => p.file), ['year.jpg']);
    assert.notEqual(y.rule, r.rule);
    // privacy mode with "hide photos" wins: stock only, no rule
    assert.equal((await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'on', hours: 2, screens: ['living-room'] } })).status, 200);
    const p = await photosOf('living-room');
    assert.ok(p.photos.every((x) => x.source === 'stock'));
    assert.equal(p.rule, '');
  });
});

test('/api/photos: a rule whose photos are all gone falls back to the normal background', async () => {
  await withServer(async ({ call, login, photosOf }) => {
    const cookie = await login();
    const cfg = (await call('GET', '/api/admin/config', { cookie })).json;
    cfg.screens[0].background.rules = [rule('r_gone', { type: 'range', from: '01-01', to: '12-31' }, ['gone.jpg', 'hidden.jpg'])];
    assert.equal((await call('PUT', '/api/admin/config', { cookie, body: cfg })).status, 200);
    const r = await photosOf('living-room');
    assert.ok(r.photos.length > 0 && r.photos.every((p) => p.source === 'stock'));
  });
});

test('gallery files of a rule: only for displays of that screen, never hidden ones, the same 404 otherwise', async () => {
  await withServer(async ({ call, login, keyOf }) => {
    const get = (file, slug) => call('GET', `/media/photos/${file}?k=${keyOf(slug)}`);
    // the living room shows stock photos, but its rules name these files
    assert.equal((await get('xmas_1.jpg', 'living-room')).status, 200);
    assert.equal((await get('year.jpg', 'living-room')).status, 200, 'a rule that does not hold now may still be loaded');
    // a gallery file no rule names, a hidden one and a missing one: the same 404
    assert.equal((await get('other.jpg', 'living-room')).status, 404);
    assert.equal((await get('hidden.jpg', 'living-room')).status, 404);
    assert.equal((await get('gone.jpg', 'living-room')).status, 404);
    // another screen without such rules gets nothing
    assert.equal((await get('xmas_1.jpg', 'guest')).status, 404);
    // privacy with "hide photos": none of them
    const cookie = await login();
    assert.equal((await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'on', hours: 2, screens: ['living-room'] } })).status, 200);
    assert.equal((await get('xmas_1.jpg', 'living-room')).status, 404);
    // the admin reads every file
    assert.equal((await call('GET', '/media/photos/other.jpg', { cookie })).status, 200);
  });
});

test('displays of a screen whose active rule changes get a photos event, the others do not', async () => {
  await withServer(async ({ call, login, keyOf }) => {
    const poll = async (slug, client, cursor = '') => (await call('GET', `/api/display/poll?client=${client}&cursor=${encodeURIComponent(cursor)}`, { headers: { 'x-marco-key': keyOf(slug) } })).json;
    assert.deepEqual(await syncPhotoRules(), [], 'the first check only takes note');
    const m0 = await poll('living-room', 'main-tv');
    const g0 = await poll('guest', 'guest-tv');
    assert.deepEqual(await syncPhotoRules(), [], 'nothing changed');
    // the event is removed in the admin (the refresher runs the check after a save; here by hand)
    const cookie = await login();
    const cfg = (await call('GET', '/api/admin/config', { cookie })).json;
    cfg.localEvents.items = [];
    assert.equal((await call('PUT', '/api/admin/config', { cookie, body: cfg })).status, 200);
    assert.deepEqual(await syncPhotoRules(), ['s_main']);
    const m1 = await poll('living-room', 'main-tv', m0.cursor);
    const g1 = await poll('guest', 'guest-tv', g0.cursor);
    assert.ok(m1.commands.some((c) => c.type === 'photos'), JSON.stringify(m1.commands));
    assert.ok(!g1.commands.some((c) => c.type === 'photos'), JSON.stringify(g1.commands));
    // the next day (midnight): the year range still holds, so no change
    assert.deepEqual(await syncPhotoRules(new Date(Date.now() + 86400_000)), []);
  });
});

test('ruleGalleryFiles lists the gallery files of every rule of a screen', () => {
  const s = { background: { rules: [rule('a', { type: 'birthday' }, ['a.jpg', 'b.jpg']), { id: 'i', when: { type: 'birthday' }, photos: { source: 'immich', albumId: ALBUM } }] } };
  assert.deepEqual([...ruleGalleryFiles(s)], ['a.jpg', 'b.jpg']);
  assert.deepEqual([...ruleGalleryFiles({ background: {} })], []);
});
