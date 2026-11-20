// Microsoft To Do and Google Tasks lists on the to-do list (config todo.lists; Graph calls in server/microsoft.js,
// mapping in server/core/microsoftGraph.js; Google Tasks calls in server/google.js, mapping in core/googleTasks.js).
// The background refresher reads the open tasks of every list that is on, each one at
// most every 5 minutes (2 after a failure), and keeps them in memory. Displays get them in their config, after the
// typed items (core screens.js displayConfig todoTasks), and a `todo` live event when they change. A list that fails
// keeps showing its last tasks.
//
// A display sees the title, the due day, the importance, the Marco id of its list (tl_...) and an opaque id per task
// (ms_ or gt_ + an HMAC of the account, the list and the task id, with a key that lives in this process only): never
// a Graph or Google id, an account or a token.
// A touch screen may tick a task (POST /api/display/todo/toggle, routes/public.js): the id is looked up among the
// tasks this server shows right now, and the task is marked done at Microsoft (Tasks.ReadWrite) or Google (the tasks
// scope). It stays on screen,
// struck through, until its list is read again (a second tap before that puts it back).
import crypto from 'node:crypto';
import { getConfig } from './store.js';
import * as microsoft from './microsoft.js';
import * as google from './google.js';
import { publish } from './pollHub.js';
import { logActivity } from './activity.js';
import { hash } from './lib/text.js';
import { displayTodoItem, enabledTodoLists, TODO_REFRESH_MS, TODO_RETRY_MS } from './core/microsoftGraph.js';
import { enabledGoogleTaskLists } from './core/googleTasks.js';

/**
 * Where each kind of list lives: its account and list id in the config entry, the prefix of its tasks' opaque ids,
 * whether the server can reach it, and its calls (read the open tasks, mark one done).
 */
const PROVIDERS = {
  microsoft: {
    name: 'Microsoft To Do', prefix: 'ms_', account: (l) => l.microsoftAccount, listId: (l) => l.microsoftListId,
    lists: enabledTodoLists, on: () => microsoft.microsoftConfigured(),
    reads: (a) => microsoft.accountHasTasks(a), writes: (a) => microsoft.accountWritesTasks(a),
    read: (a, id) => microsoft.listTodoTasks(a, id), set: (a, id, taskId, done) => microsoft.setTodoTaskDone(a, id, taskId, done),
  },
  google: {
    name: 'Google Tasks', prefix: 'gt_', account: (l) => l.googleAccount, listId: (l) => l.googleListId,
    lists: enabledGoogleTaskLists, on: () => google.googleConfigured(),
    reads: (a) => google.accountHasGoogleTasks(a), writes: (a) => google.accountWritesGoogleTasks(a),
    read: (a, id) => google.listGoogleTasks(a, id), set: (a, id, taskId, done) => google.setGoogleTaskDone(a, id, taskId, done),
  },
};
const providerOf = (l) => PROVIDERS[l.type];

/** `${type}|${account}|${listId}` → { items: [{ id, taskId, text, due?, important?, done? }], okAt, error, next } */
const cache = new Map();
const keyOf = (l) => `${l.type}|${providerOf(l).account(l)}|${providerOf(l).listId(l)}`;
const ID_KEY = crypto.randomBytes(32);
const opaqueId = (l, taskId) => {
  const p = providerOf(l);
  return `${p.prefix}${crypto.createHmac('sha256', ID_KEY).update(`${l.type}\n${p.account(l)}\n${p.listId(l)}\n${taskId}`).digest('base64url').slice(0, 22)}`;
};
let lastSig = hash([]);
let running = null;
let pending = false;

/** The lists of the config that are read: on, of an account with access to its tasks, on a server with that app. */
const activeLists = (cfg) => Object.values(PROVIDERS).flatMap((p) => (p.on() ? p.lists(cfg).filter((l) => p.reads(p.account(l))) : []));

/** Every cached task of the lists that are on, once each, with its list. */
function shownTasks(cfg) {
  const seen = new Set();
  const out = [];
  for (const l of activeLists(cfg)) {
    for (const it of cache.get(keyOf(l))?.items ?? []) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({ it, list: l });
    }
  }
  return out;
}

/** The cached tasks of every list that is on, as display to-do items with their list (core displayTodoItem). */
export function todoTasks(cfg = getConfig()) {
  return shownTasks(cfg).map(({ it, list }) => displayTodoItem(it, it.id, providerOf(list).writes(providerOf(list).account(list)), list.id));
}

/** Per list of the config: how many tasks are shown, the last good read and the last error (admin status). */
export function todoStatus(cfg = getConfig()) {
  return activeLists(cfg).map((l) => {
    const e = cache.get(keyOf(l));
    return { id: l.id, count: e?.items.length ?? 0, okAt: e?.okAt ? new Date(e.okAt).toISOString() : null, error: e?.error || '' };
  });
}

async function readList(l, now) {
  const k = keyOf(l);
  const prev = cache.get(k);
  const p = providerOf(l);
  try {
    const tasks = await p.read(p.account(l), p.listId(l));
    cache.set(k, { items: tasks.map((t) => ({ ...t, id: opaqueId(l, t.taskId) })), okAt: now, error: '', next: now + TODO_REFRESH_MS });
  } catch (err) {
    // Only a short code: never a token or the provider's description.
    const code = err.code || (err.status ? `HTTP ${err.status}` : 'error');
    if (!prev?.error) console.warn(`[todo] ${p.name} list failed:`, code, err.graph || '');
    cache.set(k, { items: prev?.items ?? [], okAt: prev?.okAt ?? 0, error: String(code).slice(0, 60), next: now + TODO_RETRY_MS });
  }
}

/** Tells the displays when the tasks they show changed. */
function announce(cfg) {
  const sig = hash(todoTasks(cfg));
  if (sig !== lastSig) publish('todo', {});
  lastSig = sig;
}

/**
 * Reads the lists that are due and tells the displays when the tasks they show changed. A call while one runs queues
 * one more run after it (with the config as it is then), so a list added in the admin is read right away.
 */
export function refreshTodo() {
  if (running) {
    pending = true;
    return running;
  }
  running = (async () => {
    try {
      const cfg = getConfig();
      const now = Date.now();
      const lists = activeLists(cfg);
      const keys = new Set(lists.map(keyOf));
      for (const k of cache.keys()) if (!keys.has(k)) cache.delete(k);
      const due = new Map();
      for (const l of lists) if (!due.has(keyOf(l)) && !(cache.get(keyOf(l))?.next > now)) due.set(keyOf(l), l);
      await Promise.all([...due.values()].map((l) => readList(l, now)));
      announce(cfg);
    } catch (err) {
      console.warn('[todo]', err.message);
    } finally {
      running = null;
      if (pending) {
        pending = false;
        refreshTodo();
      }
    }
  })();
  return running;
}

/**
 * A tap on a task on a touch screen (the route checked the screen). `id`: the opaque id the display got. Marks the
 * task done (or not done again) at Microsoft or Google, then in the cache, and tells every display. `provider`: the
 * list's kind ('microsoft' | 'google'), for the route's error code.
 * @returns {Promise<{ ok: true } | { error: 'not_found' | 'read_only' | 'reconnect' | 'unavailable', provider?: string }>}
 */
export async function toggleTask(cfg, id, done, { screen = null, req = null } = {}) {
  const found = typeof id === 'string' ? shownTasks(cfg).find(({ it }) => it.id === id) : null;
  if (!found) return { error: 'not_found' };
  const { it, list } = found;
  const p = providerOf(list);
  const provider = list.type;
  if (!p.writes(p.account(list))) return { error: 'read_only', provider };
  try {
    await p.set(p.account(list), p.listId(list), it.taskId, done);
  } catch (err) {
    console.warn(`[todo] ${p.name} task change failed:`, err.code || (err.status ? `HTTP ${err.status}` : 'error'));
    return { error: err.code === 'auth_failed' || err.code === 'tasks_scope' ? 'reconnect' : 'unavailable', provider };
  }
  it.done = done;
  // the same rule as routines ticked on a TV: the task's title and the list's name, never the account
  logActivity('todo.task', {
    req, actor: `display:${screen?.slug || ''}`,
    data: { task: it.text, list: list.name || '', done, ...(screen ? { screen: screen.slug } : {}) },
  });
  announce(cfg);
  return { ok: true };
}

/** Tests only. */
export function _resetTodo() {
  cache.clear();
  lastSig = hash([]);
  running = null;
  pending = false;
}
