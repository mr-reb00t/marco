// Google Tasks lists on the to-do list: the mapping (server/core/googleTasks.js), the connect that asks for the tasks
// scope, the admin's list picker, the tasks in the display config and the tap on a touch screen (server/microsoftTodo.js,
// POST /api/display/todo/toggle). Google is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { hashPassword, ensurePassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetActivityThrottle, listActivity } from '../activity.js';
import { _resetPrivacy } from '../privacy.js';
import { _resetFamily } from '../family.js';
import { _resetTodo, refreshTodo, todoTasks } from '../microsoftTodo.js';
import { validateConfig } from '../core/validate.js';
import {
  GOOGLE_TASKS_SCOPE, TASKS_API, googleTaskItem, googleTaskItems, googleTasksGranted, googleTasksWritable, taskListItem, taskStatusBody, tasksUrl,
} from '../core/googleTasks.js';

const realFetch = globalThis.fetch;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL = 'https://www.googleapis.com/auth/calendar.readonly';
const ANA = 'ana@gmail.example';
const CAL_ONLY = 'cal@gmail.example';
const READ = 'read@gmail.example';

// ---------------------------------------------------------------- pure mapping

test('scopes, URLs and task mapping: open tasks only, the due day, due ones first, capped', () => {
  assert.equal(googleTasksGranted(`openid ${CAL}`), false);
  assert.equal(googleTasksGranted(`${CAL} ${GOOGLE_TASKS_SCOPE}`), true);
  assert.equal(googleTasksGranted('https://www.googleapis.com/auth/tasks.readonly'), true);
  assert.equal(googleTasksWritable('https://www.googleapis.com/auth/tasks.readonly'), false);
  assert.equal(googleTasksWritable(`${CAL} ${GOOGLE_TASKS_SCOPE}`), true);
  assert.equal(googleTaskItem({ id: 't1', title: 'Milk', status: 'completed' }), null);
  assert.equal(googleTaskItem({ id: 't1', title: 'Gone', deleted: true }), null);
  assert.equal(googleTaskItem({ id: 't1', title: 'Cleared', hidden: true }), null);
  assert.equal(googleTaskItem({ id: 't1', title: '  ' }), null);
  assert.equal(googleTaskItem({ title: 'No id' }), null);
  // Google keeps the day only, at midnight UTC
  assert.deepEqual(googleTaskItem({ id: 't2', title: ' Pay\n rent ', status: 'needsAction', due: '2026-11-21T00:00:00.000Z' }), { taskId: 't2', text: 'Pay rent', due: '2026-11-21' });
  assert.deepEqual(googleTaskItem({ id: 't3', title: 'Bins', due: 'soon' }), { taskId: 't3', text: 'Bins' });
  const items = googleTaskItems([
    { id: 'a', title: 'Undated' },
    { id: 'b', title: 'Later', due: '2026-12-02T00:00:00.000Z' },
    { id: 'c', title: 'Soon', due: '2026-11-21T00:00:00.000Z' },
    { id: 'a', title: 'Undated again' },
    { id: 'd', title: 'Done', status: 'completed' },
  ]);
  assert.deepEqual(items.map((x) => x.taskId), ['c', 'b', 'a']);
  assert.equal(googleTaskItems(Array.from({ length: 150 }, (_, i) => ({ id: `t${i}`, title: `T${i}` }))).length, 100);
  assert.deepEqual(taskListItem({ id: 'l1', title: 'Shopping' }), { id: 'l1', name: 'Shopping' });
  assert.equal(taskListItem({ title: 'No id' }), null);
  const u = new URL(tasksUrl('MDk/x==', 'next'));
  assert.equal(u.pathname, '/tasks/v1/lists/MDk%2Fx%3D%3D/tasks');
  assert.equal(u.searchParams.get('showCompleted'), 'false');
  assert.equal(u.searchParams.get('showHidden'), 'false');
  assert.equal(u.searchParams.get('pageToken'), 'next');
  assert.deepEqual(taskStatusBody(true), { status: 'completed' });
  assert.deepEqual(taskStatusBody(false), { status: 'needsAction', completed: null });
});

test('config: Google lists in todo.lists are validated next to the Microsoft ones', () => {
  const c = defaultConfig();
  c.todo.lists = [
    { type: 'google', googleAccount: 'Ana@Gmail.example', googleListId: 'g1', name: 'Shopping' },
    { type: 'microsoft', microsoftAccount: 'ana@outlook.example', microsoftListId: 'm1', name: 'Chores' },
  ];
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual({ ...r.value.todo.lists[0], id: 'x' }, { id: 'x', type: 'google', googleAccount: 'ana@gmail.example', googleListId: 'g1', name: 'Shopping', enabled: true });
  assert.equal(r.value.todo.lists[1].type, 'microsoft');
  c.todo.lists = [{ type: 'google', googleAccount: 'nope', googleListId: '', microsoftAccount: 'x@y.example' }];
  const bad = validateConfig(c);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.path === 'todo.lists[0].googleListId'));
  assert.ok(bad.errors.some((e) => e.path === 'todo.lists[0].googleAccount'));
  assert.equal('microsoftAccount' in bad.value.todo.lists[0], false);
  c.todo.lists = [{ type: 'google', googleAccount: ANA, googleListId: '..' }];
  assert.ok(validateConfig(c).errors.some((e) => e.path === 'todo.lists[0].googleListId'), 'no path tricks in the list id');
  c.todo.lists = [{ type: 'apple', googleAccount: ANA, googleListId: 'g1' }];
  assert.ok(validateConfig(c).errors.some((e) => e.path === 'todo.lists[0].type'));
});

// ---------------------------------------------------------------- the server

/** A fake Google: the token endpoint and the Tasks API. */
function fakeGoogle() {
  const fake = {
    tokenCalls: [],
    api: [],
    patches: [],
    patchStatus: 200,
    listsStatus: 200,
    lists: [{ id: 'g-list-shop', title: 'Shopping' }, { id: 'g-list-home', title: 'Home' }],
    tasks: {
      'g-list-shop': [
        { id: 'g-task-milk', title: 'Milk', status: 'needsAction' },
        { id: 'g-task-bread', title: 'Bread', status: 'needsAction', due: '2026-11-21T00:00:00.000Z' },
      ],
      'g-list-home': [{ id: 'g-task-plants', title: 'Water the plants', status: 'needsAction' }],
    },
  };
  fake.fetch = async (url, init = {}) => {
    const s = String(url);
    if (/^https?:\/\/127\.0\.0\.1[:/]/.test(s)) return realFetch(url, init);
    if (s === TOKEN_URL) {
      fake.tokenCalls.push(new URLSearchParams(String(init.body)));
      return Response.json({ access_token: 'AT-secret-new', expires_in: 3600 });
    }
    if (s.startsWith(TASKS_API)) {
      const u = new URL(s);
      fake.api.push({ u, method: init.method || 'GET' });
      assert.match(init.headers?.authorization ?? '', /^Bearer AT-secret/);
      const p = u.pathname.replace('/tasks/v1', '');
      if (p === '/users/@me/lists') {
        if (fake.listsStatus === 403) {
          return Response.json({ error: { code: 403, message: 'Google Tasks API has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }], status: 'PERMISSION_DENIED' } }, { status: 403 });
        }
        return Response.json({ items: fake.lists });
      }
      const task = /^\/lists\/([^/]+)\/tasks\/([^/]+)$/.exec(p);
      if (task && init.method === 'PATCH') {
        fake.patches.push({ list: decodeURIComponent(task[1]), task: decodeURIComponent(task[2]), body: JSON.parse(init.body) });
        return fake.patchStatus === 200 ? Response.json({ id: decodeURIComponent(task[2]) }) : Response.json({ error: { code: fake.patchStatus, message: 'no' } }, { status: fake.patchStatus });
      }
      const m = /^\/lists\/([^/]+)\/tasks$/.exec(p);
      if (m) {
        const list = decodeURIComponent(m[1]);
        // the home list comes in two pages
        if (list === 'g-list-home' && u.searchParams.get('pageToken') !== 'p2') return Response.json({ items: fake.tasks[list], nextPageToken: 'p2' });
        if (list === 'g-list-home') return Response.json({ items: [{ id: 'g-task-bins', title: 'Bins', status: 'needsAction' }] });
        return Response.json({ items: fake.tasks[list] ?? [] });
      }
    }
    throw new Error(`unexpected fetch ${s}`);
  };
  return fake;
}

async function withServer(fn, { mut = () => {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-gtasks-'));
  const envKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PUBLIC_URL'];
  const prevEnv = envKeys.map((k) => process.env[k]);
  process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.example';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.PUBLIC_URL = 'http://localhost:3000';
  const fake = fakeGoogle();
  globalThis.fetch = fake.fetch;
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'open';
  c.todo.items = [{ id: 't_typed', text: 'Typed here', done: false }];
  c.todo.lists = [
    { id: 'tl_shop', type: 'google', googleAccount: ANA, googleListId: 'g-list-shop', name: 'Shopping', enabled: true },
    { id: 'tl_home', type: 'google', googleAccount: ANA, googleListId: 'g-list-home', name: 'Home', enabled: true },
    { id: 'tl_cal', type: 'google', googleAccount: CAL_ONLY, googleListId: 'g-list-cal', name: 'Calendar only', enabled: true },
  ];
  c.screens[0].todo.enabled = true;
  mut(c);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  const acct = (scope) => ({ name: 'A', access_token: 'AT-secret-1', refresh_token: 'RT-secret-1', expiry: Date.now() + 3_600_000, scope });
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({
    passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false,
    google: { accounts: {
      [ANA]: acct(`openid ${CAL} ${GOOGLE_TASKS_SCOPE}`), [CAL_ONLY]: acct(`openid ${CAL}`), [READ]: acct(`${CAL} https://www.googleapis.com/auth/tasks.readonly`),
    } },
  }));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>display</title>');
  store.initStore(dir);
  _resetDisplays();
  _resetActivityThrottle();
  _resetPrivacy();
  _resetFamily();
  _resetTodo();
  setServerVersion('0.5.3');
  await ensurePassword();
  const app = createApp({ version: '0.5.3', dist });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {}, cookie = '' } = {}) => {
    const r = await realFetch(base + url, {
      method,
      redirect: 'manual',
      headers: { ...headers, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, location: r.headers.get('location') || '', setCookie: r.headers.getSetCookie?.() || [] };
  };
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  try {
    await fn({ call, login, fake });
  } finally {
    _resetTodo();
    _resetFamily();
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
    envKeys.forEach((k, i) => (prevEnv[i] === undefined ? delete process.env[k] : (process.env[k] = prevEnv[i])));
  }
}

const setConfig = (fn) => {
  const r = store.updateConfig(fn);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
};

test('connect: the tasks scope only from the To-do page, with the account preselected', async () => {
  await withServer(async ({ call, login }) => {
    const cookie = await login();
    const plain = new URL((await call('GET', '/auth/google/connect', { cookie })).location);
    assert.equal(plain.searchParams.get('scope').includes(GOOGLE_TASKS_SCOPE), false, 'calendars alone keep calendar.readonly');
    const r = await call('GET', `/auth/google/connect?tasks=1&account=${encodeURIComponent(CAL_ONLY)}`, { cookie });
    assert.equal(r.status, 302);
    const u = new URL(r.location);
    assert.equal(u.host, 'accounts.google.com');
    assert.deepEqual(u.searchParams.get('scope').split(' '), ['openid', 'email', 'profile', CAL, GOOGLE_TASKS_SCOPE]);
    assert.equal(u.searchParams.get('login_hint'), CAL_ONLY);
    assert.equal(u.searchParams.get('include_granted_scopes'), 'true');
    // not an address: no hint
    const odd = new URL((await call('GET', '/auth/google/connect?tasks=1&account=%22%3E%3Cx', { cookie })).location);
    assert.equal(odd.searchParams.has('login_hint'), false);
    // signed out: no connect
    assert.match((await call('GET', '/auth/google/connect?tasks=1')).location, /error=login_required/);
  });
});

test('admin: accounts say which ones have Google Tasks; the list picker needs a session, access and the API on', async () => {
  await withServer(async ({ call, login, fake }) => {
    assert.equal((await call('GET', `/api/admin/google/task-lists?account=${ANA}`)).status, 401);
    const cookie = await login();
    const accounts = (await call('GET', '/api/admin/google/accounts', { cookie })).json;
    const flags = Object.fromEntries(accounts.map((a) => [a.email, [a.tasks, a.tasksWrite]]));
    assert.deepEqual(flags, { [ANA]: [true, true], [CAL_ONLY]: [false, false], [READ]: [true, false] });
    assert.ok(!JSON.stringify(accounts).includes('secret'));
    const lists = await call('GET', `/api/admin/google/task-lists?account=${encodeURIComponent(ANA)}`, { cookie });
    assert.equal(lists.status, 200, lists.text);
    assert.deepEqual(lists.json, [{ id: 'g-list-shop', name: 'Shopping' }, { id: 'g-list-home', name: 'Home' }]);
    const cal = await call('GET', `/api/admin/google/task-lists?account=${encodeURIComponent(CAL_ONLY)}`, { cookie });
    assert.equal(cal.status, 409);
    assert.equal(cal.json.error, 'google_tasks_reconnect');
    fake.listsStatus = 403;
    const off = await call('GET', `/api/admin/google/task-lists?account=${encodeURIComponent(ANA)}`, { cookie });
    assert.equal(off.status, 409);
    assert.equal(off.json.error, 'google_tasks_api_off');
    assert.equal((await call('GET', '/api/admin/google/task-lists?account=nobody%40x.example', { cookie })).status, 404);
  });
});

test('display config: open Google tasks after the typed items, opaque ids, nothing about the account or Google', async () => {
  await withServer(async ({ call, fake }) => {
    await refreshTodo();
    const reads = fake.api.filter((x) => x.u.pathname.endsWith('/tasks'));
    assert.equal(reads.filter((x) => x.u.pathname.includes('g-list-home')).length, 2, 'both pages');
    assert.ok(reads.every((x) => x.u.searchParams.get('showCompleted') === 'false'));
    // the account without Tasks access was never asked
    assert.ok(!reads.some((x) => x.u.pathname.includes('g-list-cal')));
    const r = await call('GET', '/api/display/config?screen=living-room');
    assert.equal(r.status, 200);
    const items = r.json.todo.items;
    assert.deepEqual(items.map((i) => i.text), ['Typed here', 'Bread', 'Milk', 'Water the plants', 'Bins']);
    assert.equal(items.find((i) => i.text === 'Bread').due, '2026-11-21');
    assert.ok(items.slice(1).every((i) => /^gt_[A-Za-z0-9_-]{22}$/.test(i.id)));
    assert.equal(items.find((i) => i.text === 'Milk').tick, true);
    assert.equal(items.find((i) => i.text === 'Milk').list, 'tl_shop');
    for (const secret of ['g-task', 'g-list', ANA, READ, 'AT-secret', 'RT-secret']) assert.ok(!r.text.includes(secret), secret);
    // no Google app: no tasks
    delete process.env.GOOGLE_CLIENT_SECRET;
    assert.deepEqual(todoTasks(), []);
  });
});

test('tap on a Google task: done at Google and in the activity log; failures say Google', async () => {
  await withServer(async ({ call, fake }) => {
    await refreshTodo();
    const cfgOf = async () => (await call('GET', '/api/display/config?screen=living-room')).json;
    const milk = (await cfgOf()).todo.items.find((i) => i.text === 'Milk');
    assert.equal((await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: milk.id, done: true } })).json.code, 'touch_off');
    setConfig((c) => { c.screens[0].family = { ...c.screens[0].family, touch: true }; });
    const ok = await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: milk.id, done: true } });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(fake.patches.at(-1), { list: 'g-list-shop', task: 'g-task-milk', body: { status: 'completed' } });
    assert.equal((await cfgOf()).todo.items.find((i) => i.id === milk.id).done, true);
    const entry = listActivity({ type: 'todo.task' }).items[0];
    assert.deepEqual(entry.data, { task: 'Milk', list: 'Shopping', done: true, screen: 'living-room' });
    assert.ok(!JSON.stringify(entry).includes(ANA));
    assert.equal((await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: milk.id, done: false } })).status, 200);
    assert.deepEqual(fake.patches.at(-1).body, { status: 'needsAction', completed: null });
    assert.equal((await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: 'gt_unknown', done: true } })).status, 404);

    fake.patchStatus = 500;
    const bread = (await cfgOf()).todo.items.find((i) => i.text === 'Bread');
    const failed = await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: bread.id, done: true } });
    assert.equal(failed.status, 502);
    assert.equal(failed.json.code, 'google_unavailable');
    assert.equal((await cfgOf()).todo.items.find((i) => i.id === bread.id).done, false);
    fake.patchStatus = 401;
    const gone = await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: bread.id, done: true } });
    assert.equal(gone.status, 409);
    assert.equal(gone.json.code, 'google_reconnect');
  });
});

test('a read-only Google list is shown without ticking', async () => {
  await withServer(async ({ call }) => {
    await refreshTodo();
    const items = (await call('GET', '/api/display/config?screen=living-room')).json.todo.items;
    const read = items.filter((i) => i.list === 'tl_read');
    assert.deepEqual(read.map((i) => i.text), ['Bread', 'Milk']);
    assert.ok(read.every((i) => !i.tick));
  }, { mut: (c) => { c.todo.lists = [{ id: 'tl_read', type: 'google', googleAccount: READ, googleListId: 'g-list-shop', name: 'Read only', enabled: true }]; } });
});
