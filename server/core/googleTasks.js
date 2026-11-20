// Google Tasks on the to-do list: the URLs, scopes and mapping of the Google Tasks API v1 (calls in server/google.js,
// the cache and the taps in server/microsoftTodo.js with the Microsoft To Do lists). Plain JS with no I/O.
//
// Scope: https://www.googleapis.com/auth/tasks, asked for only when an account is linked from the To-do page (the
// calendars keep calendar.readonly alone). It reads the account's task lists and marks a task done from a touch
// screen; an account that granted tasks.readonly only (a server setup outside Marco) shows its lists without ticking.

export const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
const TASKS_READ_SCOPE = 'https://www.googleapis.com/auth/tasks.readonly';

/** Tasks read per list: pages of TASK_PAGE_SIZE (the API's most), at most MAX_TASK_PAGES, and TASKS_PER_LIST kept. */
export const TASK_PAGE_SIZE = 100;
export const MAX_TASK_PAGES = 5;
export const TASKS_PER_LIST = 100;
/** Task lists read for the admin's picker (pages of 100). */
export const MAX_TASK_LIST_PAGES = 4;

const scopes = (scope) => String(scope || '').split(/\s+/).filter(Boolean);
/** The scope list lets Marco read Google Tasks lists. */
export const googleTasksGranted = (scope) => scopes(scope).some((s) => s === GOOGLE_TASKS_SCOPE || s === TASKS_READ_SCOPE);
/** The scope list lets Marco mark Google tasks done. */
export const googleTasksWritable = (scope) => scopes(scope).includes(GOOGLE_TASKS_SCOPE);

const page = (q, pageToken) => (pageToken ? { ...q, pageToken: String(pageToken) } : q);
export const taskListsUrl = (pageToken = '') => `${TASKS_API}/users/@me/lists?${new URLSearchParams(page({ maxResults: '100' }, pageToken))}`;

/** The open tasks of one list: completed and hidden (cleared) ones are left out by Google. */
export function tasksUrl(listId, pageToken = '') {
  const q = page({ maxResults: String(TASK_PAGE_SIZE), showCompleted: 'false', showHidden: 'false', showDeleted: 'false' }, pageToken);
  return `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks?${new URLSearchParams(q)}`;
}

/** One task, to mark it done or not done (PATCH). Not done clears its completion time too, as the Tasks app does. */
export const taskUrl = (listId, taskId) => `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
export const taskStatusBody = (done) => (done ? { status: 'completed' } : { status: 'needsAction', completed: null });

/** A Google task list as a GoogleTaskListItem ({ id, name }), or null. */
export function taskListItem(l) {
  if (!l || typeof l.id !== 'string' || !l.id || l.id.length > 512) return null;
  return { id: l.id, name: String(l.title || 'My Tasks').slice(0, 200) };
}

/**
 * A Google task as a cached task ({ taskId, text, due? }), or null (completed, deleted, hidden, no title). Google
 * keeps only the day of a due date, sent as midnight UTC, so the day is the date part. The Google id stays on the
 * server: a display gets an opaque id instead (core/microsoftGraph.js displayTodoItem).
 */
export function googleTaskItem(t) {
  if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 512) return null;
  if (t.status === 'completed' || t.deleted === true || t.hidden === true) return null;
  const text = String(t.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return null;
  const item = { taskId: t.id, text };
  const due = typeof t.due === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.due) ? t.due.slice(0, 10) : null;
  if (due) item.due = due;
  return item;
}

/** Google tasks as cached tasks: open ones only, those with a due date first (soonest first), at most TASKS_PER_LIST. */
export function googleTaskItems(tasks) {
  const items = (Array.isArray(tasks) ? tasks : []).map(googleTaskItem).filter(Boolean);
  const seen = new Set();
  const unique = items.filter((it) => !seen.has(it.taskId) && seen.add(it.taskId));
  const dated = unique.filter((it) => it.due).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return [...dated, ...unique.filter((it) => !it.due)].slice(0, TASKS_PER_LIST);
}

/** The Google Tasks lists of a config that are on (todo.lists). */
export const enabledGoogleTaskLists = (cfg) => (Array.isArray(cfg?.todo?.lists) ? cfg.todo.lists : []).filter((l) => l && l.enabled !== false && l.type === 'google');
