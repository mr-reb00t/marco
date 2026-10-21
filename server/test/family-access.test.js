// Family access (#16) through the real app: the admin API, the phone dashboard (/api/member/*) with its link, codes
// on a screen and device tokens, every permission checked on the server, revocation, rate limits, CSRF, the live
// events the screens get, what is stored (hashes only) and the activity log. Plus the pure rules of
// core/familyAccessCore.js and the texts of the phone page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { hashPassword, ensurePassword, _resetLoginLimits } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetAnnouncements, createAnnouncement, listAnnouncements, sanitizeAnnounce, ACTIVE_MAX, FAMILY_ACTIVE_MAX } from '../announce.js';
import { retireFor } from '../core/announceCore.js';
import { _resetActivityThrottle, listActivity } from '../activity.js';
import { _resetPrivacy, privacyResponse } from '../privacy.js';
import { _resetFamily } from '../family.js';
import { _resetFamilyAccess, BAD_CODE_LIMIT, BAD_CODE_GLOBAL, BAD_LIMIT, BAD_GLOBAL, ACTIONS_PER_MIN } from '../familyAccess.js';
import { FEATURE_KEYS } from '../capabilities.js';
import { addDays, localDate } from '../core/lib/tz.js';
import {
  effectivePerms, memberEventRequest, memberMessageRequest, memberNightRequest, memberState, nightTargets, memberTodoRequest, normalizeAccessCode, sanitizePersonInput,
  deviceLabel, LINK_TOKEN_RE, DEVICE_TOKEN_RE, MESSAGE_MAX, MAX_DEVICES_PER_PERSON,
} from '../core/familyAccessCore.js';

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

async function withServer(fn, { mut = () => {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-access-'));
  globalThis.fetch = offlineFetch;
  const prevLan = process.env.LAN_ADDRESS;
  process.env.LAN_ADDRESS = '192.168.0.50';
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.revision = 7000 + Math.floor(Math.random() * 1000);
  c.family.members = [{ id: 'm_ana', name: 'Ana', avatar: '🦊', color: '#ff8fab', kid: false }];
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  mut(c);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dist, 'member'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>display</title>');
  fs.writeFileSync(path.join(dist, 'member', 'index.html'), '<!doctype html><title>member</title>');
  store.initStore(dir);
  _resetDisplays();
  _resetAnnouncements();
  _resetActivityThrottle();
  _resetPrivacy();
  _resetFamily();
  _resetFamilyAccess();
  _resetLoginLimits();
  setServerVersion('0.5.3');
  await ensurePassword();
  const app = createApp({ version: '0.5.3', dist });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {}, cookie = '', raw } = {}) => {
    const r = await realFetch(base + url, {
      method,
      headers: { ...headers, ...(cookie ? { cookie } : {}), ...(body !== undefined && raw === undefined ? { 'content-type': 'application/json' } : {}) },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, headers: r.headers, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const streams = [];
  /** The display key of a screen. */
  const keyOf = async (screenId) => (await call('GET', '/api/admin/display-links', { cookie: await login() })).json.links.find((l) => l.screenId === screenId).key;
  /** An SSE stream of a screen, with the display key (private mode), or with no credential (`open`: open mode). */
  const sse = async (screenId, { open = false } = {}) => {
    const q = open ? { client: `c_open_${screenId}`, screen: store.getConfig().screens.find((x) => x.id === screenId).slug } : { client: `c_${screenId}`, k: await keyOf(screenId) };
    const ctl = new AbortController();
    const r = await realFetch(`${base}/api/stream?${new URLSearchParams(q)}`, { signal: ctl.signal });
    assert.equal(r.status, 200);
    const events = [];
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (ev) events.push({ event: ev, data: data ? JSON.parse(data) : {} });
          }
        }
      } catch { /* aborted */ }
    })();
    const st = {
      events,
      async waitFor(name, pred = () => true) {
        for (let i = 0; i < 100; i++) {
          const hit = events.find((e) => e.event === name && pred(e.data));
          if (hit) return hit;
          await new Promise((res) => setTimeout(res, 20));
        }
        throw new Error(`no ${name} event`);
      },
      close() { ctl.abort(); return pump; },
    };
    streams.push(st);
    await st.waitFor('hello');
    return st;
  };
  let cookieCache = '';
  const login = async () => {
    if (cookieCache) return cookieCache;
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    cookieCache = r.setCookie.map((x) => x.split(';')[0]).join('; ');
    return cookieCache;
  };
  const phone = (token) => ({ 'x-member-token': token });
  /** Add a person from the admin and open their link on a phone. */
  const addPerson = async (body) => {
    const cookie = await login();
    const r = await call('POST', '/api/admin/family-access', { cookie, body });
    assert.equal(r.status, 200, r.text);
    // /my/<link>?lang=<household language>
    const link = r.json.link.path.slice('/my/'.length).replace(/\?.*$/, '');
    return { person: r.json.person, link };
  };
  const redeem = async (link, token) => call('POST', '/api/member/redeem', { body: { link, ...(token ? { token } : {}) }, headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' } });
  try {
    await fn({ call, login, dir, sse, phone, addPerson, redeem, keyOf });
  } finally {
    await Promise.all(streams.map((x) => x.close()));
    _resetPrivacy();
    _resetFamilyAccess();
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
    if (prevLan === undefined) delete process.env.LAN_ADDRESS; else process.env.LAN_ADDRESS = prevLan;
  }
}

const ALL = { message: true, privacy: true, night: true, todo: true, events: true };

test('core: permissions, requests and what the phone sees', () => {
  const cfg = defaultConfig();
  cfg.screens.push(defaultScreenProfile({ id: 's_k', slug: 'k', name: 'K' }));
  cfg.family.members = [{ id: 'm_a', name: 'Ana', avatar: '🦊', color: '#ff8fab' }];
  const main = cfg.screens[0].id;
  // anything but true is off; unknown screens are dropped
  const r = sanitizePersonInput({ name: '  Ana\n  ', memberId: 'm_a', perms: { message: 'yes', privacy: true, messageScreens: ['s_k', 's_gone', 's_k'] } }, cfg);
  assert.deepEqual(r.value, { name: 'Ana', memberId: 'm_a', perms: { message: false, messageScreens: ['s_k'], privacy: true, night: false, nightScreens: [], todo: false, events: false } });
  assert.equal(sanitizePersonInput({ name: '' }, cfg).error, 'name_required');
  assert.equal(sanitizePersonInput({ name: 'x', memberId: 'm_nobody' }, cfg).error, 'unknown_member');
  assert.deepEqual(sanitizePersonInput({ perms: { night: true } }, cfg, { partial: true }).value, { perms: { message: false, messageScreens: [], privacy: false, night: true, nightScreens: [], todo: false, events: false } });
  // messages limited to screens that were all deleted are off, never every screen
  const p = { name: 'Ana', memberId: 'm_a', perms: { message: true, messageScreens: ['s_gone'] } };
  assert.equal(effectivePerms(p, cfg).message, false);
  const q = { name: 'Ana', memberId: 'm_a', perms: { message: true, messageScreens: ['s_k'] } };
  assert.deepEqual(memberMessageRequest({ text: 'Hola' }, q, cfg).value.screens, ['s_k']);
  assert.equal(memberMessageRequest({ text: 'Hola', screens: [main] }, q, cfg).error, 'bad_screens');
  assert.equal(memberMessageRequest({ text: 'x'.repeat(MESSAGE_MAX + 1) }, q, cfg).error, 'text_too_long');
  assert.equal(memberMessageRequest({ text: 'Hola', durationSec: 7 }, q, cfg).error, 'bad_duration');
  const all = { name: 'Ana', perms: { message: true, messageScreens: [] } };
  const m = memberMessageRequest({ text: ' Dinner ', durationSec: 60 }, all, cfg).value;
  assert.deepEqual(m, { title: 'Ana', body: 'Dinner', emoji: '💬', style: 'info', durationSec: 60, sound: true, screens: [] });
  assert.deepEqual(memberMessageRequest({ text: 'Hi', screens: ['s_k'] }, all, cfg).value.screens, ['s_k']);
  // to-dos and events
  assert.deepEqual(memberTodoRequest({ text: '  pan \n leche ' }).value, { text: 'pan leche' });
  assert.equal(memberTodoRequest({ text: '' }).error, 'text_required');
  assert.deepEqual(memberEventRequest({ title: 'Dentista', date: '2026-10-21', allDay: false, startTime: '17:30' }, '2026-10-20').value,
    { title: 'Dentista', date: '2026-10-21', allDay: false, startTime: '17:30', endTime: '18:30' });
  assert.equal(memberEventRequest({ title: 'Late', date: '2026-10-21', allDay: false, startTime: '23:15' }, '2026-10-20').value.endTime, '23:59');
  // at 23:59 there is no later minute for a default end: the phone gets bad_time, not a save error
  assert.deepEqual(memberEventRequest({ title: 'Late', date: '2026-10-21', allDay: false, startTime: '23:59' }, '2026-10-20'), { error: 'bad_time', path: 'startTime' });
  assert.equal(memberEventRequest({ title: 'Late', date: '2026-10-21', allDay: false, startTime: '23:58' }, '2026-10-20').value.endTime, '23:59');
  assert.equal(memberEventRequest({ title: 'x', date: '2026-10-21', allDay: false, startTime: '10:00', endTime: '09:00' }, '2026-10-20').error, 'bad_time');
  assert.equal(memberEventRequest({ title: 'x', date: '2031-01-01' }, '2026-10-20').error, 'bad_date');
  assert.equal(memberEventRequest({ title: 'x', date: '2026-02-30' }, '2026-10-20').error, 'bad_date');
  // the phone sees its own name and what it may do, nothing else
  const st = memberState(cfg, { name: 'Ana', memberId: 'm_a', perms: { message: true, messageScreens: ['s_k'], todo: true } }, { lang: 'es', privacy: { on: 1, total: 2 } });
  assert.deepEqual(st, {
    name: 'Ana', lang: 'es', avatar: '🦊', color: '#ff8fab', can: { message: true, privacy: false, night: false, todo: true, events: false },
    screens: [{ id: 's_k', name: 'K' }], nightScreens: [], privacy: null, calendarOn: true, durations: [60, 600, 3600],
  });
  // night mode on every screen (a person saved before nightScreens existed has none), or on the chosen ones
  const old = { name: 'Leo', perms: { night: true } };
  assert.deepEqual(effectivePerms(old, cfg).nightScreens, []);
  assert.deepEqual(nightTargets(old, cfg).map((s) => s.id), [main, 's_k']);
  assert.deepEqual(memberNightRequest({ mode: 'on' }, old, cfg).value, { mode: 'on', screens: [], names: [] });
  assert.deepEqual(memberNightRequest({ mode: 'off', screens: ['s_k'] }, old, cfg).value, { mode: 'off', screens: ['s_k'], names: ['K'] });
  assert.deepEqual(memberNightRequest({ mode: 'auto', screens: [] }, old, cfg).value, { mode: 'auto', screens: [], names: [] });
  assert.equal(memberNightRequest({ mode: 'dim' }, old, cfg).error, 'bad_mode');
  assert.equal(memberNightRequest({ mode: 'on', screens: ['s_gone'] }, old, cfg).error, 'bad_screens');
  assert.equal(memberNightRequest({ mode: 'on', screens: 's_k' }, old, cfg).error, 'bad_screens');
  const some = { name: 'Leo', perms: { night: true, nightScreens: ['s_k', 's_gone'] } };
  assert.deepEqual(sanitizePersonInput({ perms: some.perms }, cfg, { partial: true }).value.perms.nightScreens, ['s_k']);
  // limited to some screens: "all" means the ones allowed, never the others
  assert.deepEqual(memberNightRequest({ mode: 'on' }, some, cfg).value, { mode: 'on', screens: ['s_k'], names: ['K'] });
  assert.equal(memberNightRequest({ mode: 'on', screens: [main] }, some, cfg).error, 'bad_screens');
  assert.deepEqual(memberState(cfg, some, { lang: 'en' }).nightScreens, [{ id: 's_k', name: 'K' }]);
  // limited to screens that were all deleted: off
  const gone = { name: 'Leo', perms: { night: true, nightScreens: ['s_gone'] } };
  assert.equal(effectivePerms(gone, cfg).night, false);
  assert.equal(memberNightRequest({ mode: 'on' }, gone, cfg).error, 'not_allowed');
  assert.equal(normalizeAccessCode('abc-234'), 'ABC234');
  assert.equal(normalizeAccessCode('ABC10O'), null);
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36'), 'Android · Chrome');
  assert.equal(deviceLabel(''), 'Browser');
});

test('admin: a session is needed; people are listed without any token; secrets keep hashes only', async () => {
  await withServer(async ({ call, login, dir, addPerson }) => {
    assert.ok(FEATURE_KEYS.includes('familyAccess'));
    assert.equal((await call('GET', '/api/health')).json.features.familyAccess, true);
    assert.equal((await call('GET', '/api/admin/family-access')).status, 401);
    assert.equal((await call('POST', '/api/admin/family-access', { body: { name: 'Ana' } })).status, 401);
    const cookie = await login();
    assert.deepEqual((await call('GET', '/api/admin/family-access', { cookie })).json.people, []);
    assert.equal((await call('POST', '/api/admin/family-access', { cookie, body: { name: ' ' } })).json.code, 'name_required');
    const { person, link } = await addPerson({ name: 'Ana', memberId: 'm_ana', perms: { todo: true } });
    assert.match(link, LINK_TOKEN_RE);
    assert.equal(person.link.exists, true);
    assert.deepEqual(person.perms, { message: false, messageScreens: [], privacy: false, night: false, nightScreens: [], todo: true, events: false });
    const list = await call('GET', '/api/admin/family-access', { cookie });
    assert.equal(list.headers.get('cache-control'), 'private, no-store');
    assert.equal(list.json.people.length, 1);
    assert.ok(!list.text.includes(link), 'the link is never listed again');
    assert.ok(!/hash/.test(list.text));
    const secrets = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
    assert.ok(!secrets.includes(link), 'only a digest of the link is stored');
    assert.equal(JSON.parse(secrets).familyAccess[0].link.hash.length, 64);
    // the page itself
    const page = await call('GET', `/my/${link}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /member/);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(page.headers.get('cache-control'), 'private, no-store');
    assert.equal((await call('GET', '/my')).status, 200);
  });
});

test('phone: the link gives this phone its own token; a new link stops new phones, not the ones already in', async () => {
  await withServer(async ({ call, login, dir, phone, addPerson, redeem }) => {
    const { person, link } = await addPerson({ name: 'Ana', memberId: 'm_ana', perms: { todo: true } });
    const r = await redeem(link);
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.token, DEVICE_TOKEN_RE);
    assert.equal(r.json.state.name, 'Ana');
    assert.equal(r.json.state.avatar, '🦊');
    assert.equal(r.json.state.can.todo, true);
    assert.equal(r.json.state.can.message, false);
    // the same phone opening the link again keeps its token, no second device
    const again = await redeem(link, r.json.token);
    assert.equal(again.json.token, r.json.token);
    const cookie = await login();
    let people = (await call('GET', '/api/admin/family-access', { cookie })).json.people;
    assert.equal(people[0].devices.length, 1);
    assert.equal(people[0].devices[0].via, 'link');
    assert.equal(people[0].devices[0].name, 'iPhone · Safari');
    assert.ok(!fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8').includes(r.json.token), 'only a digest of the token is stored');
    // a new link: the old one is refused, the phone already in still works
    const fresh = await call('POST', `/api/admin/family-access/${person.id}/link`, { cookie, body: {} });
    assert.equal(fresh.status, 200);
    assert.notEqual(fresh.json.link.path.replace(/\?.*$/, ''), `/my/${link}`);
    assert.equal((await redeem(link)).status, 403);
    assert.equal((await redeem(link)).json.code, 'invalid_link');
    assert.equal((await call('GET', '/api/member/state', { headers: phone(r.json.token) })).status, 200);
    // a member token is no admin credential
    assert.equal((await call('GET', '/api/admin/config', { headers: phone(r.json.token) })).status, 401);
    assert.equal((await call('GET', '/api/admin/family-access', { headers: phone(r.json.token) })).status, 401);
    // no token, a wrong one
    assert.equal((await call('GET', '/api/member/state')).json.code, 'token_required');
    assert.equal((await call('GET', '/api/member/state', { headers: phone(`fd_${'a'.repeat(43)}`) })).json.code, 'invalid_token');
    people = (await call('GET', '/api/admin/family-access', { cookie })).json.people;
    assert.equal(people[0].devices.length, 1);
  });
});

test('every action is checked against the permissions of now', async () => {
  await withServer(async ({ call, login, phone, addPerson, redeem, sse }) => {
    const { person, link } = await addPerson({ name: 'Ana', perms: {} });
    const token = (await redeem(link)).json.token;
    const h = phone(token);
    for (const [p, body] of [['message', { text: 'Hola' }], ['privacy', { mode: 'on' }], ['night', { mode: 'on' }], ['todo', { text: 'Pan' }], ['event', { title: 'Cine', date: 'tomorrow' }]]) {
      const r = await call('POST', `/api/member/${p}`, { headers: h, body });
      assert.equal(r.status, 403, `${p} ${r.text}`);
      assert.equal(r.json.code, 'not_allowed');
    }
    const cookie = await login();
    const patch = await call('PATCH', `/api/admin/family-access/${person.id}`, { cookie, body: { perms: { ...ALL, messageScreens: ['s_kitchen'] } } });
    assert.equal(patch.status, 200, patch.text);
    const state = (await call('GET', '/api/member/state', { headers: h })).json;
    assert.deepEqual(state.can, { message: true, privacy: true, night: true, todo: true, events: true });
    assert.deepEqual(state.screens, [{ id: 's_kitchen', name: 'Kitchen' }]);
    assert.deepEqual(state.privacy, { on: 0, total: 2 });

    // a message: an announcement with the person's name, only on the screens allowed
    const kitchen = await sse('s_kitchen');
    const main = await sse(store.getConfig().screens[0].id);
    const sent = await call('POST', '/api/member/message', { headers: h, body: { text: 'La cena está lista', durationSec: 60 } });
    assert.equal(sent.status, 200, sent.text);
    const ev = await kitchen.waitFor('announce');
    assert.equal(ev.data.title, 'Ana');
    assert.equal(ev.data.body, 'La cena está lista');
    assert.equal(ev.data.via, 'family');
    assert.deepEqual(ev.data.screenIds, ['s_kitchen']);
    assert.ok(!main.events.some((e) => e.event === 'announce'));
    assert.equal(listAnnouncements().active[0].by, 'family:Ana');
    const other = await call('POST', '/api/member/message', { headers: h, body: { text: 'x', screens: [store.getConfig().screens[0].id] } });
    assert.equal(other.json.code, 'bad_screens');

    // privacy on every screen
    const priv = await call('POST', '/api/member/privacy', { headers: h, body: { mode: 'on' } });
    assert.deepEqual(priv.json.privacy, { on: 2, total: 2 });
    assert.ok(privacyResponse().screens.every((s) => s.active));
    await call('POST', '/api/member/privacy', { headers: h, body: { mode: 'off' } });
    assert.ok(privacyResponse().screens.every((s) => !s.active));
    assert.equal((await call('POST', '/api/member/privacy', { headers: h, body: { mode: 'toggle' } })).json.code, 'bad_mode');

    // night, day, auto on every screen
    await call('POST', '/api/member/night', { headers: h, body: { mode: 'on' } });
    assert.equal((await main.waitFor('night')).data.mode, 'on');
    assert.equal((await kitchen.waitFor('night')).data.mode, 'on');
    // or on one screen only
    const nightAll = main.events.filter((e) => e.event === 'night').length;
    const one = await call('POST', '/api/member/night', { headers: h, body: { mode: 'off', screens: ['s_kitchen'] } });
    assert.equal(one.status, 200, one.text);
    assert.equal(one.json.delivered, 1);
    assert.equal((await kitchen.waitFor('night', (d) => d.mode === 'off')).data.mode, 'off');
    assert.equal(main.events.filter((e) => e.event === 'night').length, nightAll);
    assert.equal((await call('POST', '/api/member/night', { headers: h, body: { mode: 'off', screens: ['s_nope'] } })).json.code, 'bad_screens');
    const nightOne = listActivity({ type: 'family', limit: 50 }).items.find((e) => e.type === 'family.night');
    assert.deepEqual(nightOne.data.screens, ['Kitchen']);
    // limited by the admin to the kitchen: the main screen is refused, "all" is the kitchen only
    await call('PATCH', `/api/admin/family-access/${person.id}`, { cookie, body: { perms: { ...ALL, messageScreens: ['s_kitchen'], nightScreens: ['s_kitchen'] } } });
    assert.deepEqual((await call('GET', '/api/member/state', { headers: h })).json.nightScreens, [{ id: 's_kitchen', name: 'Kitchen' }]);
    assert.equal((await call('POST', '/api/member/night', { headers: h, body: { mode: 'on', screens: [store.getConfig().screens[0].id] } })).status, 400);
    assert.equal((await call('POST', '/api/member/night', { headers: h, body: { mode: 'auto' } })).json.delivered, 1);
    assert.equal((await kitchen.waitFor('night', (d) => d.mode === 'auto')).data.mode, 'auto');
    assert.equal(main.events.filter((e) => e.event === 'night').length, nightAll);

    // a to-do and an event go to the config
    const rev = store.getConfig().revision;
    const todo = await call('POST', '/api/member/todo', { headers: h, body: { text: 'Comprar pan' } });
    assert.equal(todo.status, 200, todo.text);
    assert.deepEqual(store.getConfig().todo.items.at(-1), { id: todo.json.id, text: 'Comprar pan', done: false });
    assert.equal(store.getConfig().revision, rev + 1);
    const soon = addDays(localDate(new Date(), store.getConfig().datetime.timezone), 10);
    const evr = await call('POST', '/api/member/event', { headers: h, body: { title: 'Dentista', date: soon, allDay: false, startTime: '17:00', endTime: '18:00' } });
    assert.equal(evr.status, 200, evr.text);
    const le = store.getConfig().localEvents.items.at(-1);
    assert.deepEqual({ title: le.title, date: le.date, allDay: le.allDay, startTime: le.startTime, endTime: le.endTime, repeat: le.repeat.freq }, { title: 'Dentista', date: soon, allDay: false, startTime: '17:00', endTime: '18:00', repeat: 'none' });
    assert.equal((await call('POST', '/api/member/event', { headers: h, body: { title: 'x', date: soon, allDay: false, startTime: '17:00', endTime: '16:00' } })).json.code, 'bad_time');

    // taking a permission away counts from the next request
    await call('PATCH', `/api/admin/family-access/${person.id}`, { cookie, body: { perms: { todo: true } } });
    assert.equal((await call('POST', '/api/member/night', { headers: h, body: { mode: 'off' } })).status, 403);
    assert.equal((await call('POST', '/api/member/todo', { headers: h, body: { text: 'Leche' } })).status, 200);

    // the activity log says who did it
    const acts = listActivity({ type: 'family', limit: 50 }).items;
    for (const type of ['family.message', 'family.privacy', 'family.night', 'family.todo', 'family.event', 'family.device', 'family.access']) {
      assert.ok(acts.some((e) => e.type === type), `${type} logged`);
    }
    const msg = acts.find((e) => e.type === 'family.message');
    assert.equal(msg.actor, 'family:Ana');
    assert.equal(msg.data.person, 'Ana');
    assert.ok(!JSON.stringify(acts).includes(token), 'no token in the log');
    assert.ok(!JSON.stringify(acts).includes(link), 'no link in the log');
  });
});

test('a code on a screen authorises one phone, once, and the codes are rate limited', async () => {
  await withServer(async ({ call, login, phone, addPerson, sse }) => {
    const { person } = await addPerson({ name: 'Leo', perms: { night: true } });
    const cookie = await login();
    const kitchen = await sse('s_kitchen');
    const main = await sse(store.getConfig().screens[0].id);
    assert.equal((await call('POST', `/api/admin/family-access/${person.id}/code`, { cookie, body: { screenId: 's_nope' } })).json.code, 'unknown_screen');
    const r = await call('POST', `/api/admin/family-access/${person.id}/code`, { cookie, body: { screenId: 's_kitchen' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.delivered, 1);
    const ev = await kitchen.waitFor('access-code');
    assert.equal(ev.data.code, r.json.code);
    assert.equal(ev.data.name, 'Leo');
    // the address a phone at home can open (this test server is on loopback: the LAN address)
    assert.match(ev.data.url, /^http:\/\/192\.168\.0\.50:\d+\/my\?lang=[a-z]{2}$/);
    assert.deepEqual(Object.keys(ev.data).sort(), ['code', 'expiresAt', 'id', 'name', 'url']);
    assert.ok(!main.events.some((e) => e.event === 'access-code'), 'only the chosen screen');
    assert.ok((await call('GET', '/api/admin/family-access', { cookie })).json.people[0].code);
    // typed on the phone, with spaces and lower case
    const typed = `${r.json.code.slice(0, 3).toLowerCase()} ${r.json.code.slice(3)}`;
    const pair = await call('POST', '/api/member/pair', { body: { code: typed } });
    assert.equal(pair.status, 200, pair.text);
    assert.equal(pair.json.state.name, 'Leo');
    assert.equal((await call('GET', '/api/member/state', { headers: phone(pair.json.token) })).status, 200);
    // single use
    assert.equal((await call('POST', '/api/member/pair', { body: { code: r.json.code } })).status, 404);
    const people = (await call('GET', '/api/admin/family-access', { cookie })).json.people;
    assert.equal(people[0].devices[0].via, 'code');
    assert.equal(people[0].code, null);
    // the used code leaves the screen at once (the overlay with this id hides)
    const cleared = await kitchen.waitFor('access-code', (d) => d.clear === true);
    assert.equal(cleared.data.id, ev.data.id);
    assert.equal(cleared.data.code, '');
    // guessing stops after a few wrong codes, also for a right one
    _resetFamilyAccess();
    const next = (await call('POST', `/api/admin/family-access/${person.id}/code`, { cookie, body: { screenId: 's_kitchen' } })).json.code;
    for (let i = 0; i < BAD_CODE_LIMIT; i++) assert.equal((await call('POST', '/api/member/pair', { body: { code: 'ZZZZZZ' } })).status, 404);
    const locked = await call('POST', '/api/member/pair', { body: { code: next } });
    assert.equal(locked.status, 429);
    assert.ok(locked.headers.get('retry-after'));
    assert.ok(listActivity({ type: 'family.access_rejected' }).items.length >= 1);
  });
});

test('revoking a phone or deleting a person takes effect at once', async () => {
  await withServer(async ({ call, login, phone, addPerson, redeem }) => {
    const { person, link } = await addPerson({ name: 'Ana', perms: { todo: true } });
    const a = (await redeem(link)).json.token;
    const b = (await call('POST', '/api/member/redeem', { body: { link }, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120' } })).json.token;
    assert.notEqual(a, b);
    const cookie = await login();
    const devices = (await call('GET', '/api/admin/family-access', { cookie })).json.people[0].devices;
    assert.equal(devices.length, 2);
    const android = devices.find((d) => d.name.startsWith('Android'));
    assert.equal((await call('DELETE', `/api/admin/family-access/${person.id}/devices/${android.id}`, { cookie })).status, 200);
    assert.equal((await call('GET', '/api/member/state', { headers: phone(b) })).status, 403);
    assert.equal((await call('GET', '/api/member/state', { headers: phone(a) })).status, 200);
    // the phone signs itself out
    const c = (await redeem(link)).json.token;
    assert.equal((await call('POST', '/api/member/forget', { headers: phone(c), body: {} })).status, 200);
    assert.equal((await call('GET', '/api/member/state', { headers: phone(c) })).status, 403);
    // deleting the person: the link and every phone stop
    assert.equal((await call('DELETE', `/api/admin/family-access/${person.id}`, { cookie })).status, 200);
    assert.equal((await call('GET', '/api/member/state', { headers: phone(a) })).status, 403);
    assert.equal((await redeem(link)).status, 403);
    assert.equal((await call('DELETE', `/api/admin/family-access/${person.id}`, { cookie })).status, 404);
    const types = listActivity({ type: 'family.access', limit: 20 }).items.map((e) => e.data.action);
    assert.ok(types.includes('device_revoked') && types.includes('deleted'));
  });
});

test('CSRF and limits: same origin, JSON only, and a budget per person', async () => {
  await withServer(async ({ call, phone, addPerson, redeem }) => {
    const { link } = await addPerson({ name: 'Ana', perms: { todo: true, night: true } });
    const token = (await redeem(link)).json.token;
    const h = phone(token);
    assert.equal((await call('POST', '/api/member/todo', { headers: { ...h, origin: 'https://evil.example' }, body: { text: 'x' } })).status, 403);
    assert.equal((await call('POST', '/api/member/todo', { headers: { ...h, 'content-type': 'text/plain' }, raw: '{"text":"x"}' })).status, 415);
    assert.equal((await call('POST', '/api/member/redeem', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: `link=${link}` })).status, 415);
    assert.equal((await call('POST', '/api/member/todo', { headers: h, body: { text: 'x'.repeat(5000) } })).status, 413);
    let last = null;
    for (let i = 0; i <= ACTIONS_PER_MIN; i++) last = await call('POST', '/api/member/night', { headers: h, body: { mode: 'auto' } });
    assert.equal(last.status, 429);
    assert.equal(last.json.code, 'rate_limited');
  });
});

test('the phone page, the display overlay and the texts are wired up', async () => {
  // the page reads the link from the path and a code from the fragment, and keeps neither in the address bar
  const main = read('web/member/main.tsx');
  assert.match(main, /history\.replaceState\(null, '', '\/my'\)/);
  assert.match(main, /'X-Member-Token'/);
  assert.match(main, /credentials: 'omit'/);
  assert.match(read('vite.config.ts'), /member: resolve\(root, 'web\/member\/index\.html'\)/);
  // the display listens to access-code over SSE and the poll channel
  assert.match(read('web/display/stream.ts'), /STREAM_EVENTS = \[[^\]]*'access-code'/);
  assert.match(read('web/display/live.ts'), /case 'access-code':/);
  assert.match(read('server/pollHub.js'), /POLL_EVENTS = Object\.freeze\(\[[^\]]*'access-code'/);
  assert.match(read('web/index.html'), /<div id="access-code"/);
  const i18n = read('web/shared/i18n.ts');
  for (const k of ['accessCodeFor', 'accessCodeHint', 'accessCodeHintNoUrl', 'accessCodeScan']) assert.equal(i18n.split(`  ${k}: '`).length - 1, 6, `${k} in 6 languages`);
});

test('the phone page needs only its own table: every text it shows has all six languages', async (t) => {
  let mod;
  try {
    mod = await import('../../web/admin/i18n-dict-access.ts');
  } catch {
    return t.skip('TypeScript imports need Node >= 22.18');
  }
  const rows = new Map(mod.ROWS_ACCESS_ALL.map((r) => [r[0], r]));
  const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  for (const r of mod.ROWS_ACCESS_ALL) {
    assert.equal(r.length, 6);
    for (const v of r) assert.ok(v && !/\u2014/.test(v), `${r[0]}: no empty value, no em dash`);
    for (const v of r.slice(1)) assert.equal(holes(v), holes(r[0]), `placeholders of ${r[0]}`);
  }
  const used = (src) => [...src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  const main = read('web/member/main.tsx');
  const mapped = [...main.matchAll(/^\s+[a-z_]+: '((?:[^'\\]|\\.)*)',$/gm)].map((m) => m[1]);
  const missing = [...used(main), ...mapped, 'No se pudo hacer. Inténtalo otra vez.'].filter((k) => !rows.has(k));
  assert.deepEqual(missing, []);
  assert.doesNotMatch(read('web/member/i18n.ts'), /i18n-dict-(nl|da|family)/, 'the phone page loads only the access table');
});

test('a flood of wrong codes and tokens from the Internet never locks out the phones at home', async () => {
  await withServer(async ({ call, login, addPerson, redeem }) => {
    const { person, link } = await addPerson({ name: 'Ana', perms: { todo: true } });
    const from = (i) => ({ 'x-forwarded-for': `203.0.113.${i}` });
    // far past the overall limits (50 codes, 200 links and tokens), from many public addresses
    for (let i = 1; i <= 25; i++) {
      for (let j = 0; j < BAD_CODE_LIMIT; j++) await call('POST', '/api/member/pair', { headers: from(i), body: { code: 'ZZZZZZ' } });
      for (let j = 0; j < BAD_LIMIT; j++) await call('GET', '/api/member/state', { headers: { ...from(i), 'x-member-token': `fd_${'A'.repeat(43)}` } });
    }
    assert.ok(BAD_CODE_GLOBAL < 25 * BAD_CODE_LIMIT && BAD_GLOBAL < 25 * BAD_LIMIT);
    // a new public address is refused by the overall limit
    assert.equal((await call('POST', '/api/member/pair', { headers: from(99), body: { code: 'ZZZZZZ' } })).status, 429);
    // a phone on the LAN still gets in, with the link and with a code
    const r = await redeem(link);
    assert.equal(r.status, 200, r.text);
    const cookie = await login();
    const code = (await call('POST', `/api/admin/family-access/${person.id}/code`, { cookie, body: { screenId: 's_kitchen' } })).json.code;
    const pair = await call('POST', '/api/member/pair', { body: { code } });
    assert.equal(pair.status, 200, pair.text);
  });
});

test('a person with every phone slot taken keeps the code; a new code or a removed person clears the screen', async () => {
  await withServer(async ({ call, login, addPerson, redeem, sse }) => {
    const { person, link } = await addPerson({ name: 'Ana', perms: { todo: true } });
    for (let i = 0; i < MAX_DEVICES_PER_PERSON; i++) {
      const r = await call('POST', '/api/member/redeem', { body: { link }, headers: { 'user-agent': `phone ${i}` } });
      assert.equal(r.status, 200, r.text);
    }
    assert.equal((await redeem(link)).json.code, 'device_limit');
    const cookie = await login();
    const kitchen = await sse('s_kitchen');
    const first = (await call('POST', `/api/admin/family-access/${person.id}/code`, { cookie, body: { screenId: 's_kitchen' } })).json.code;
    const full = await call('POST', '/api/member/pair', { body: { code: first } });
    assert.equal(full.status, 409);
    assert.equal(full.json.code, 'device_limit');
    // the admin removes a phone and the same code still works
    const dev = (await call('GET', '/api/admin/family-access', { cookie })).json.people[0].devices[0];
    await call('DELETE', `/api/admin/family-access/${person.id}/devices/${dev.id}`, { cookie });
    assert.equal((await call('POST', '/api/member/pair', { body: { code: first } })).status, 200);
    // a new code replaces the old one on the screen, removing the person clears it
    const a = (await call('POST', `/api/admin/family-access/${person.id}/code`, { cookie, body: { screenId: 's_kitchen' } })).json;
    const evA = await kitchen.waitFor('access-code', (d) => d.code === a.code);
    const b = (await call('POST', `/api/admin/family-access/${person.id}/code`, { cookie, body: { screenId: 's_kitchen' } })).json;
    await kitchen.waitFor('access-code', (d) => d.clear === true && d.id === evA.data.id);
    const evB = await kitchen.waitFor('access-code', (d) => d.code === b.code);
    await call('DELETE', `/api/admin/family-access/${person.id}`, { cookie });
    await kitchen.waitFor('access-code', (d) => d.clear === true && d.id === evB.data.id);
  });
});

test('an export with secrets keeps the people and their phones (digests only), and an import brings them back', async () => {
  await withServer(async ({ call, login, phone, addPerson, redeem }) => {
    const { person, link } = await addPerson({ name: 'Ana', perms: { message: true, messageScreens: ['s_kitchen'], night: true, nightScreens: ['s_kitchen'] } });
    const token = (await redeem(link)).json.token;
    assert.equal((await call('POST', '/api/member/message', { headers: phone(token), body: { text: 'Hola' } })).status, 200);
    const cookie = await login();
    const bundle = (await call('POST', '/api/admin/export', { cookie, body: { includeSecrets: true, password: 'secret-pass-123' } })).json;
    const fa = bundle.secrets.familyAccess;
    assert.equal(fa.length, 1);
    assert.equal(fa[0].id, person.id);
    assert.match(fa[0].link.hash, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(fa).includes(token) && !JSON.stringify(fa).includes(link), 'digests only');
    assert.ok(!('lastIp' in fa[0].devices[0]), 'no address in the export');
    // the person is removed, then the export is imported: the same link and phone work again
    await call('DELETE', `/api/admin/family-access/${person.id}`, { cookie });
    assert.equal((await call('GET', '/api/member/state', { headers: phone(token) })).status, 403);
    const imp = await call('POST', '/api/admin/import/apply', { cookie, body: { bundle, includeSecrets: true, password: 'secret-pass-123' } });
    assert.equal(imp.status, 200, imp.text);
    const back = await call('GET', '/api/member/state', { headers: phone(token) });
    assert.equal(back.status, 200);
    assert.deepEqual(back.json.nightScreens, [{ id: 's_kitchen', name: 'Kitchen' }]);
    assert.equal((await redeem(link, token)).json.token, token);
  });
});

test('open display access: a code on a screen only goes to displays with a credential, live and in the poll', async () => {
  await withServer(async ({ call, login, addPerson, sse, keyOf }) => {
    const { person } = await addPerson({ name: 'Leo', perms: { night: true } });
    const cookie = await login();
    const open = await sse('s_kitchen', { open: true });
    const keyed = await sse('s_kitchen');
    const key = await keyOf('s_kitchen');
    const poll = ({ k, ...q }) => call('GET', `/api/display/poll?${new URLSearchParams({ screen: 'kitchen', ...q })}`, { headers: k ? { 'x-marco-key': k } : {} });
    const openStart = await poll({ client: 'c_poll_open' });
    const keyedStart = await poll({ client: 'c_poll_key', k: key });
    assert.equal(openStart.status, 200, openStart.text);
    assert.equal(keyedStart.status, 200, keyedStart.text);
    const r = await call('POST', `/api/admin/family-access/${person.id}/code`, { cookie, body: { screenId: 's_kitchen' } });
    assert.equal(r.status, 200, r.text);
    assert.equal((await keyed.waitFor('access-code')).data.code, r.json.code);
    const openPoll = await poll({ client: 'c_poll_open', cursor: openStart.json.cursor });
    const keyedPoll = await poll({ client: 'c_poll_key', k: key, cursor: keyedStart.json.cursor });
    assert.ok(keyedPoll.json.commands.some((c) => c.type === 'access-code' && c.code === r.json.code), 'the keyed poller gets it');
    assert.ok(!openPoll.json.commands.some((c) => c.type === 'access-code'), 'the open poller does not');
    await new Promise((res) => setTimeout(res, 100));
    assert.ok(!open.events.some((e) => e.event === 'access-code'), 'the open stream does not');
    assert.ok(!JSON.stringify(open.events).includes(r.json.code));
  }, { mut: (c) => { c.security = { ...(c.security || {}), displayAccess: 'open' }; } });
});

test('a valid link or token from outside gets in past the overall limit; codes keep it', async () => {
  await withServer(async ({ call, login, addPerson, redeem, phone }) => {
    const { person, link } = await addPerson({ name: 'Ana', perms: { todo: true } });
    const token = (await redeem(link)).json.token;
    const from = (i) => ({ 'x-forwarded-for': `203.0.113.${i}` });
    const ua = { 'user-agent': 'Mozilla/5.0 (Android 14; Mobile) Chrome/120' };
    for (let i = 1; i <= Math.ceil(BAD_GLOBAL / BAD_LIMIT) + 1; i++) {
      for (let j = 0; j < BAD_LIMIT; j++) await call('POST', '/api/member/redeem', { headers: from(i), body: { link: `fa_${'A'.repeat(32)}` } });
    }
    for (let i = 1; i <= Math.ceil(BAD_CODE_GLOBAL / BAD_CODE_LIMIT) + 1; i++) {
      for (let j = 0; j < BAD_CODE_LIMIT; j++) await call('POST', '/api/member/pair', { headers: from(100 + i), body: { code: 'ZZZZZZ' } });
    }
    // a wrong link from a new public address is refused, the right one gets in
    assert.equal((await call('POST', '/api/member/redeem', { headers: from(90), body: { link: `fa_${'B'.repeat(32)}` } })).status, 429);
    const ok = await call('POST', '/api/member/redeem', { headers: { ...from(91), ...ua }, body: { link } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await call('GET', '/api/member/state', { headers: { ...from(92), ...phone(token) } })).status, 200);
    // a right code from outside still waits for the overall count to go down (it stops guessing from many addresses)
    const cookie = await login();
    const code = (await call('POST', `/api/admin/family-access/${person.id}/code`, { cookie, body: { screenId: 's_kitchen' } })).json.code;
    assert.equal((await call('POST', '/api/member/pair', { headers: from(93), body: { code } })).status, 429);
    // the per-address limit still holds for links: a locked address is refused even with the right one
    assert.equal((await call('POST', '/api/member/redeem', { headers: { ...from(1), ...ua }, body: { link } })).status, 429);
  });
});

test('core: a family message only retires the same person\'s messages', () => {
  const mk = (id, via, by) => ({ id, via, by });
  const admin = Array.from({ length: 10 }, (_, i) => mk(`a${i}`, 'admin', 'owner'));
  const ana = [mk('f1', 'family', 'family:Ana'), mk('f2', 'family', 'family:Ana'), mk('f3', 'family', 'family:Ana')];
  const leo = [mk('l1', 'family', 'family:Leo')];
  assert.deepEqual(retireFor([...admin, ...leo, ...ana], mk('x', 'family', 'family:Ana')).map((a) => a.id), ['f1']);
  assert.deepEqual(retireFor([...admin, ...leo], mk('x', 'family', 'family:Ana')), []);
  const full = Array.from({ length: ACTIVE_MAX }, (_, i) => mk(`a${i}`, 'admin', 'owner'));
  assert.equal(retireFor(full, mk('x', 'family', 'family:Ana')), null);
  assert.equal(retireFor([...full.slice(1), ...leo], mk('x', 'family', 'family:Ana')), null);
  assert.deepEqual(retireFor([...full.slice(1), ana[0]], mk('x', 'family', 'family:Ana')).map((a) => a.id), ['f1']);
  // an admin announcement retires the oldest, whoever sent them
  assert.deepEqual(retireFor([...ana, ...full.slice(3)], mk('x', 'admin', 'owner')).map((a) => a.id), ['f1']);
});

test('family messages never take down announcements someone else sent', async () => {
  await withServer(async ({ call, phone, addPerson, redeem }) => {
    const { link } = await addPerson({ name: 'Ana', perms: ALL });
    const h = phone((await redeem(link)).json.token);
    const send = (text) => call('POST', '/api/member/message', { headers: h, body: { text, durationSec: 3600 } });
    const adminOne = (i) => createAnnouncement(sanitizeAnnounce({ title: `Admin ${i}`, durationSec: 3600 }, () => ({ ids: [] })).value, { via: 'admin', by: 'owner' });
    for (let i = 1; i <= FAMILY_ACTIVE_MAX + 1; i++) assert.equal((await send(`m${i}`)).status, 200);
    let active = listAnnouncements().active;
    assert.equal(active.length, FAMILY_ACTIVE_MAX);
    assert.ok(!active.some((a) => a.body === 'm1'), 'the oldest of her own went');
    // the household fills up with the owner's announcements: hers make room among her own only
    for (let i = 0; i < ACTIVE_MAX - FAMILY_ACTIVE_MAX; i++) adminOne(i);
    assert.equal((await send('m5')).status, 200);
    active = listAnnouncements().active;
    assert.equal(active.length, ACTIVE_MAX);
    assert.equal(active.filter((a) => a.via === 'admin').length, ACTIVE_MAX - FAMILY_ACTIVE_MAX);
    // the owner's own ones retire the oldest of any kind, and a house full of the owner's refuses her message
    for (let i = 0; i < ACTIVE_MAX; i++) adminOne(100 + i);
    assert.equal(listAnnouncements().active.filter((a) => a.via === 'family').length, 0);
    const full = await send('m6');
    assert.equal(full.status, 409);
    assert.equal(full.json.code, 'announcements_full');
    assert.equal(listAnnouncements().active.filter((a) => a.via === 'admin').length, ACTIVE_MAX);
  });
});
