// Microsoft To Do lists on the to-do list (#15): the Graph mapping (server/core/microsoftGraph.js), the scopes of
// accounts linked before Marco asked for To Do access, the admin's list picker, the tasks in the display config and
// the tap on a touch screen (server/microsoftTodo.js, POST /api/display/todo/toggle). Microsoft is faked.
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
import * as microsoft from '../microsoft.js';
import { _resetTodo, refreshTodo, todoTasks } from '../microsoftTodo.js';
import { validateConfig } from '../core/validate.js';
import {
  CONNECT_SCOPES, GRAPH_API, MS_TOKEN_URL, refreshScopes, tasksGranted, tasksWritable, todoItems, todoListItem, todoTaskItem, todoTasksUrl,
} from '../core/microsoftGraph.js';

const realFetch = globalThis.fetch;
const NEW = 'ana@outlook.example';
const OLD = 'old@outlook.example';
const READ = 'read@outlook.example';
const RW_SCOPE = 'Calendars.Read Calendars.Read.Shared Tasks.ReadWrite openid profile email';

// ---------------------------------------------------------------- pure mapping

test('scopes: Tasks.ReadWrite on connect, a refresh only asks for what the account granted', () => {
  assert.match(CONNECT_SCOPES, /\bTasks\.ReadWrite\b/);
  assert.equal(tasksGranted('Calendars.Read'), false);
  assert.equal(tasksGranted('https://graph.microsoft.com/Tasks.Read'), true);
  assert.equal(tasksWritable('Tasks.Read'), false);
  assert.equal(tasksWritable('https://graph.microsoft.com/Tasks.ReadWrite'), true);
  assert.equal(refreshScopes('Calendars.Read Calendars.Read.Shared'), 'offline_access Calendars.Read Calendars.Read.Shared');
  assert.equal(refreshScopes(''), 'offline_access Calendars.Read Calendars.Read.Shared');
  assert.equal(refreshScopes('Calendars.Read Tasks.Read'), 'offline_access Calendars.Read Calendars.Read.Shared Tasks.Read');
  assert.equal(refreshScopes(RW_SCOPE), 'offline_access Calendars.Read Calendars.Read.Shared Tasks.ReadWrite');
});

test('task mapping: completed and empty tasks out, due day, importance, due ones first, capped', () => {
  assert.equal(todoTaskItem({ id: 't1', title: 'Milk', status: 'completed' }), null);
  assert.equal(todoTaskItem({ id: 't1', title: '   ' }), null);
  assert.equal(todoTaskItem({ title: 'No id' }), null);
  // To Do keeps due dates at midnight of the owner's zone; Graph may send them moved into UTC
  assert.deepEqual(todoTaskItem({ id: 't2', title: ' Pay\n rent ', importance: 'high', dueDateTime: { dateTime: '2026-10-20T22:00:00.0000000', timeZone: 'UTC' } }),
    { taskId: 't2', text: 'Pay rent', due: '2026-10-21', important: true });
  assert.deepEqual(todoTaskItem({ id: 't3', title: 'Bins', importance: 'normal', dueDateTime: { dateTime: '2026-10-22T00:00:00.0000000', timeZone: 'UTC' } }),
    { taskId: 't3', text: 'Bins', due: '2026-10-22' });
  const items = todoItems([
    { id: 'a', title: 'Undated' },
    { id: 'b', title: 'Later', dueDateTime: { dateTime: '2026-11-02T00:00:00' } },
    { id: 'c', title: 'Soon', dueDateTime: { dateTime: '2026-10-21T00:00:00' } },
    { id: 'a', title: 'Undated again' },
    { id: 'd', title: 'Done', status: 'completed' },
  ]);
  assert.deepEqual(items.map((x) => x.taskId), ['c', 'b', 'a']);
  assert.equal(todoItems(Array.from({ length: 150 }, (_, i) => ({ id: `t${i}`, title: `T${i}` }))).length, 100);
  assert.equal(todoListItem({ id: 'f', displayName: 'Flagged email', wellknownListName: 'flaggedEmails' }), null);
  assert.deepEqual(todoListItem({ id: 'l1', displayName: 'Tasks', wellknownListName: 'defaultList' }), { id: 'l1', name: 'Tasks', isDefault: true });
  assert.deepEqual(todoListItem({ id: 'l2', displayName: 'Shopping', isShared: true, wellknownListName: 'none' }), { id: 'l2', name: 'Shopping', shared: true });
  const u = new URL(todoTasksUrl('AQMk/x=='));
  assert.equal(u.pathname, '/v1.0/me/todo/lists/AQMk%2Fx%3D%3D/tasks');
  assert.equal(u.searchParams.get('$filter'), "status ne 'completed'");
  // Graph refuses a $select on To Do tasks (400 invalidRequest): never ask for one
  assert.equal(u.searchParams.has('$select'), false);
});

test('config: todo.lists are validated and capped', () => {
  const c = defaultConfig();
  c.todo.lists = [{ type: 'microsoft', microsoftAccount: 'Ana@Outlook.example', microsoftListId: 'l1', name: 'Shopping' }];
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.todo.lists[0].microsoftAccount, 'ana@outlook.example');
  assert.match(r.value.todo.lists[0].id, /^tl_/);
  assert.equal(r.value.todo.lists[0].enabled, true);
  c.todo.lists = [{ type: 'microsoft', microsoftAccount: 'nope', microsoftListId: '' }];
  const bad = validateConfig(c);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.path === 'todo.lists[0].microsoftListId'));
  c.todo.lists = Array.from({ length: 11 }, (_, i) => ({ type: 'microsoft', microsoftAccount: NEW, microsoftListId: `l${i}` }));
  assert.equal(validateConfig(c).ok, false);
});

// ---------------------------------------------------------------- the server

/** A fake Microsoft: token endpoint and the Graph To Do endpoints. */
function fakeMicrosoft() {
  const fake = {
    tokenCalls: [],
    graph: [],
    patches: [],
    patchStatus: 200,
    lists: [{ id: 'list-shop', displayName: 'Shopping', isShared: true }, { id: 'list-flag', displayName: 'Flagged email', wellknownListName: 'flaggedEmails' }],
    tasks: {
      'list-shop': [
        { id: 'graph-task-milk', title: 'Milk', status: 'notStarted', importance: 'high' },
        { id: 'graph-task-bread', title: 'Bread', status: 'notStarted', dueDateTime: { dateTime: '2026-10-21T00:00:00.0000000', timeZone: 'UTC' } },
      ],
      'list-shop-2': [{ id: 'graph-task-eggs', title: 'Eggs', status: 'notStarted' }],
      'list-chores': [{ id: 'graph-task-bins', title: 'Bins', status: 'notStarted' }],
    },
  };
  fake.fetch = async (url, init = {}) => {
    const s = String(url);
    if (/^https?:\/\/127\.0\.0\.1[:/]/.test(s)) return realFetch(url, init);
    if (s === MS_TOKEN_URL) {
      const form = new URLSearchParams(String(init.body));
      fake.tokenCalls.push(form);
      return Response.json({ access_token: 'AT-secret-new', expires_in: 3600, scope: form.get('scope'), refresh_token: 'RT-secret-rotated' });
    }
    if (s.startsWith(GRAPH_API)) {
      const u = new URL(s);
      fake.graph.push(u);
      assert.match(init.headers?.Authorization ?? '', /^Bearer AT-secret/);
      const p = u.pathname.replace('/v1.0', '');
      if (p === '/me/todo/lists') return Response.json({ value: fake.lists });
      const task = /^\/me\/todo\/lists\/([^/]+)\/tasks\/([^/]+)$/.exec(p);
      if (task && init.method === 'PATCH') {
        fake.patches.push({ list: decodeURIComponent(task[1]), task: decodeURIComponent(task[2]), body: JSON.parse(init.body) });
        return fake.patchStatus === 200 ? Response.json({ id: decodeURIComponent(task[2]) }) : Response.json({ error: { code: 'x' } }, { status: fake.patchStatus });
      }
      const m = /^\/me\/todo\/lists\/([^/]+)\/tasks$/.exec(p);
      if (m) {
        const list = decodeURIComponent(m[1]);
        // the chores list comes in two pages; the shopping list's second page points outside Graph (never followed)
        if (list === 'list-chores' && u.searchParams.get('page') !== '2') {
          return Response.json({ value: fake.tasks[list], '@odata.nextLink': `${GRAPH_API}/me/todo/lists/list-chores/tasks?page=2` });
        }
        if (list === 'list-chores') return Response.json({ value: [{ id: 'graph-task-dog', title: 'Walk the dog', status: 'notStarted' }] });
        if (list === 'list-shop') return Response.json({ value: fake.tasks[list], '@odata.nextLink': 'https://evil.example/steal' });
        return Response.json({ value: fake.tasks[list] ?? [] });
      }
    }
    throw new Error(`unexpected fetch ${s}`);
  };
  return fake;
}

async function withServer(fn, { mut = () => {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-mstodo-'));
  const envKeys = ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'PUBLIC_URL'];
  const prevEnv = envKeys.map((k) => process.env[k]);
  process.env.MICROSOFT_CLIENT_ID = '7a3a24ab-0000-4000-8000-000000000003';
  process.env.MICROSOFT_CLIENT_SECRET = 'ms-secret';
  const fake = fakeMicrosoft();
  globalThis.fetch = fake.fetch;
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'open';
  c.todo.items = [{ id: 't_typed', text: 'Typed here', done: false }];
  c.todo.lists = [
    { id: 'tl_shop', type: 'microsoft', microsoftAccount: NEW, microsoftListId: 'list-shop', name: 'Shopping', enabled: true },
    { id: 'tl_chores', type: 'microsoft', microsoftAccount: NEW, microsoftListId: 'list-chores', name: 'Chores', enabled: true },
    { id: 'tl_read', type: 'microsoft', microsoftAccount: READ, microsoftListId: 'list-shop-2', name: 'Read only', enabled: true },
    { id: 'tl_old', type: 'microsoft', microsoftAccount: OLD, microsoftListId: 'list-old', name: 'Old', enabled: true },
  ];
  c.screens[0].todo.enabled = true;
  mut(c);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  const acct = (scope) => ({ access_token: 'AT-secret-1', refresh_token: 'RT-secret-1', expiry: Date.now() + 3_600_000, scope, connectedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({
    passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false,
    microsoft: { accounts: { [NEW]: acct(RW_SCOPE), [OLD]: acct('Calendars.Read Calendars.Read.Shared'), [READ]: acct('Calendars.Read Tasks.Read') } },
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
      headers: { ...headers, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, setCookie: r.headers.getSetCookie?.() || [] };
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

test('admin: accounts say which ones need a new connect; the list picker needs a session and To Do access', async () => {
  await withServer(async ({ call, login }) => {
    assert.equal((await call('GET', '/api/admin/microsoft/todo-lists?account=' + NEW)).status, 401);
    const cookie = await login();
    const accounts = (await call('GET', '/api/admin/microsoft/accounts', { cookie })).json;
    assert.deepEqual(accounts.sort((a, b) => a.email.localeCompare(b.email)), [
      { email: NEW, tasks: true, tasksWrite: true },
      { email: OLD, tasks: false, tasksWrite: false },
      { email: READ, tasks: true, tasksWrite: false },
    ]);
    const lists = await call('GET', `/api/admin/microsoft/todo-lists?account=${encodeURIComponent(NEW)}`, { cookie });
    assert.equal(lists.status, 200, lists.text);
    assert.deepEqual(lists.json, [{ id: 'list-shop', name: 'Shopping', shared: true }]);
    const old = await call('GET', `/api/admin/microsoft/todo-lists?account=${encodeURIComponent(OLD)}`, { cookie });
    assert.equal(old.status, 409);
    assert.equal(old.json.error, 'microsoft_tasks_reconnect');
    assert.equal((await call('GET', '/api/admin/microsoft/todo-lists?account=nobody%40x.example', { cookie })).status, 404);
  });
});

test('old accounts keep refreshing with their own scopes; new ones ask for Tasks.ReadWrite again', async () => {
  await withServer(async ({ fake }) => {
    store.updateSecrets((s) => { for (const a of Object.values(s.microsoft.accounts)) a.expiry = 0; });
    await microsoft.getAccessToken(OLD);
    assert.equal(fake.tokenCalls.at(-1).get('scope'), 'offline_access Calendars.Read Calendars.Read.Shared');
    await microsoft.getAccessToken(READ);
    assert.equal(fake.tokenCalls.at(-1).get('scope'), 'offline_access Calendars.Read Calendars.Read.Shared Tasks.Read');
    await microsoft.getAccessToken(NEW);
    assert.equal(fake.tokenCalls.at(-1).get('scope'), 'offline_access Calendars.Read Calendars.Read.Shared Tasks.ReadWrite');
  });
});

test('display config: open tasks after the typed items, opaque ids, nothing about the account or Graph', async () => {
  await withServer(async ({ call, fake }) => {
    await refreshTodo();
    const tasksRead = fake.graph.filter((u) => u.pathname.endsWith('/tasks'));
    // the chores list read both pages; the shopping list's link outside Graph was not followed
    assert.equal(tasksRead.filter((u) => u.pathname.includes('list-chores')).length, 2);
    // completed tasks are filtered by Graph (a next page link carries the query on)
    assert.ok(tasksRead.filter((u) => !u.searchParams.has('page')).every((u) => u.searchParams.get('$filter') === "status ne 'completed'"));
    assert.ok(!fake.graph.some((u) => u.host !== 'graph.microsoft.com'));
    // the old account was never asked (no To Do access)
    assert.ok(!tasksRead.some((u) => u.pathname.includes('list-old')));
    const r = await call('GET', '/api/display/config?screen=living-room');
    assert.equal(r.status, 200);
    const items = r.json.todo.items;
    assert.deepEqual(items.map((i) => i.text), ['Typed here', 'Bread', 'Milk', 'Bins', 'Walk the dog', 'Eggs']);
    assert.equal(items.find((i) => i.text === 'Milk').important, true);
    assert.equal(items.find((i) => i.text === 'Bread').due, '2026-10-21');
    assert.ok(items.slice(1).every((i) => /^ms_[A-Za-z0-9_-]{22}$/.test(i.id)));
    assert.equal(items.find((i) => i.text === 'Eggs').tick, undefined, 'Tasks.Read only: no ticking');
    assert.equal(items.find((i) => i.text === 'Milk').tick, true);
    assert.equal(r.json.todo.touch, false, 'touch is off on this screen');
    assert.equal(r.json.todo.lists, undefined);
    for (const secret of ['graph-task', 'list-shop', 'list-chores', NEW, READ, 'AT-secret', 'RT-secret', 'tl_shop']) assert.ok(!r.text.includes(secret), secret);
    // no Microsoft app: no tasks
    delete process.env.MICROSOFT_CLIENT_SECRET;
    assert.deepEqual(todoTasks(), []);
  });
});

test('tap on a task: only with touch on, on a screen with the list, then done at Microsoft and in the activity log', async () => {
  await withServer(async ({ call, fake }) => {
    await refreshTodo();
    const cfgOf = async (slug) => (await call('GET', `/api/display/config?screen=${slug}`)).json;
    const milk = (await cfgOf('living-room')).todo.items.find((i) => i.text === 'Milk');
    const off = await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: milk.id, done: true } });
    assert.equal(off.status, 403);
    assert.equal(off.json.code, 'touch_off');
    assert.equal(fake.patches.length, 0);

    setConfig((c) => { c.screens[0].family = { ...c.screens[0].family, touch: true }; });
    assert.equal((await cfgOf('living-room')).todo.touch, true);
    const ok = await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: milk.id, done: true } });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(fake.patches.at(-1), { list: 'list-shop', task: 'graph-task-milk', body: { status: 'completed' } });
    assert.equal((await cfgOf('living-room')).todo.items.find((i) => i.id === milk.id).done, true);
    const entry = listActivity({ type: 'todo.task' }).items[0];
    assert.deepEqual(entry.data, { task: 'Milk', list: 'Shopping', done: true, screen: 'living-room' });
    assert.equal(entry.actor, 'display:living-room');
    assert.ok(!JSON.stringify(entry).includes(NEW));
    // a second tap while it is still on screen puts it back
    assert.equal((await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: milk.id, done: false } })).status, 200);
    assert.deepEqual(fake.patches.at(-1).body, { status: 'notStarted' });

    // a task the server does not show, and a read-only list
    assert.equal((await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: 'ms_unknown', done: true } })).status, 404);
    assert.equal((await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: 'graph-task-milk', done: true } })).status, 404);
    const eggs = (await cfgOf('living-room')).todo.items.find((i) => i.text === 'Eggs');
    const ro = await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: eggs.id, done: true } });
    assert.equal(ro.status, 403);
    assert.equal(ro.json.code, 'read_only');

    // Microsoft fails: refused, the task stays open
    fake.patchStatus = 500;
    const bread = (await cfgOf('living-room')).todo.items.find((i) => i.text === 'Bread');
    const failed = await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: bread.id, done: true } });
    assert.equal(failed.status, 502);
    assert.equal(failed.json.code, 'microsoft_unavailable');
    assert.equal((await cfgOf('living-room')).todo.items.find((i) => i.id === bread.id).done, false);
    fake.patchStatus = 200;

    // a screen that does not show the to-do list (touch on there too): refused
    setConfig((c) => {
      c.screens.push({ ...structuredClone(c.screens[0]), id: 's_hall', slug: 'hall', name: 'Hall', todo: { enabled: false } });
    });
    const hall = await call('POST', '/api/display/todo/toggle?screen=hall', { body: { id: bread.id, done: true } });
    assert.equal(hall.status, 403);
    assert.equal(hall.json.code, 'touch_off');

    // private: no touch
    const cookie = await (async () => {
      const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
      return r.setCookie.map((x) => x.split(';')[0]).join('; ');
    })();
    assert.equal((await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'on', screens: ['living-room'] } })).status, 200);
    assert.equal((await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: bread.id, done: true } })).status, 403);
    assert.equal((await cfgOf('living-room')).todo.touch, false);
  });
});

test('in private access mode a tap needs the screen credential', async () => {
  await withServer(async ({ call }) => {
    await refreshTodo();
    assert.equal((await call('POST', '/api/display/todo/toggle?screen=living-room', { body: { id: 'ms_x', done: true } })).status, 401);
  }, { mut: (c) => { c.security.displayAccess = 'private'; c.screens[0].family = { touch: true }; } });
});
