// Microsoft calendars and To Do lists (Outlook.com, Hotmail, Microsoft 365) through Microsoft Graph, read only: the
// parts both editions share (endpoints, scopes, ID token checks, calendar list items, the event mapping and the To Do
// task mapping). The HTTP calls and the token storage live in each server (server/microsoft.js and
// server/microsoftTodo.js here, microsoftApi.ts and microsoftTodo.ts in Marco Cloud).
//
// Scopes: openid email profile offline_access Calendars.Read Calendars.Read.Shared Tasks.ReadWrite
//   Calendars.Read          read the account's own calendars and their events
//   Calendars.Read.Shared   read the calendars other people shared with the account (a family calendar, a partner's)
//   Tasks.ReadWrite         read the account's Microsoft To Do lists and their tasks (lists shared with it too),
//                           and mark a task done (or not done) from a touch screen. Nothing else is ever written.
//                           Accounts linked before Marco asked for it do not have it: their refresh asks only for
//                           what they granted (refreshScopes) and the admin offers to connect them again. An
//                           account that granted only Tasks.Read shows its lists without ticking.
//   offline_access          a refresh token, so screens keep updating with nobody signed in
//   openid email profile    an ID token with the account's email (email, else preferred_username), to name the
//                           account. User.Read is not needed.
import { isValidTimeZone, tzOffsetMinutes } from './lib/tz.js';

export const MS_AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
export const MS_AUTH_URL = `${MS_AUTHORITY}/authorize`;
export const MS_TOKEN_URL = `${MS_AUTHORITY}/token`;
export const GRAPH_API = 'https://graph.microsoft.com/v1.0';
export const CALENDAR_SCOPE = 'Calendars.Read';
export const SHARED_CALENDAR_SCOPE = 'Calendars.Read.Shared';
export const TASKS_SCOPE = 'Tasks.ReadWrite';
export const TASKS_READ_SCOPE = 'Tasks.Read';
export const CONNECT_SCOPES = `openid email profile offline_access ${CALENDAR_SCOPE} ${SHARED_CALENDAR_SCOPE} ${TASKS_SCOPE}`;
/**
 * A refresh asks for the Graph permissions again, so the access token is for Graph. These are the ones every linked
 * account has; refreshScopes() adds Tasks.Read for the accounts that granted it.
 */
export const REFRESH_SCOPES = `offline_access ${CALENDAR_SCOPE} ${SHARED_CALENDAR_SCOPE}`;
export const CONNECT_CALLBACK_PATH = '/auth/microsoft/callback';
/** Where the owner removes the app's access at Microsoft (there is no revoke endpoint for these tokens). */
export const MANAGE_ACCESS_URLS = ['https://account.live.com/consent/Manage', 'https://myapps.microsoft.com'];
/**
 * Where the admin lands after a connect (`back` of /auth/microsoft/connect): the linked accounts card in Calendars,
 * or the Microsoft To Do card on the Tareas page.
 */
export const CONNECT_BACK = { calendars: '#/calendars/cal-accounts', todo: '#/todo/todo-microsoft' };
export const connectBack = (b) => CONNECT_BACK[Object.hasOwn(CONNECT_BACK, b) ? b : 'calendars'];

/** OAuth error codes Microsoft may send back to the redirect URI; each becomes microsoft_<code>. */
export const MICROSOFT_OAUTH_ERRORS = new Set([
  'access_denied', 'consent_required', 'interaction_required', 'login_required', 'invalid_request', 'invalid_scope',
  'unauthorized_client', 'unsupported_response_type', 'server_error', 'temporarily_unavailable',
]);
/** Token endpoint errors that mean the account has to be connected again. */
export const MICROSOFT_AUTH_ERRORS = new Set(['invalid_grant', 'interaction_required', 'consent_required', 'login_required']);

export const EVENT_PAGE_SIZE = 500;
export const EVENT_FIELDS = 'id,subject,bodyPreview,location,start,end,isAllDay,isCancelled,type';
export const CALENDAR_FIELDS = 'id,name,color,hexColor,isDefaultCalendar,owner';
/** Calendar groups read for calendars the flat list may leave out (shared calendars under "People's calendars"). */
export const MAX_CALENDAR_GROUPS = 10;

/**
 * The authorize URL of a connect: code flow with PKCE (S256), the account picker always shown. `loginHint`: the
 * account a reconnect is for, preselected in the picker (another one can still be chosen there).
 */
export function microsoftAuthUrl({ clientId, redirectUri, state, challenge, lang, loginHint }) {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: CONNECT_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  if (lang) q.set('ui_locales', lang);
  if (loginHint) q.set('login_hint', loginHint);
  return `${MS_AUTH_URL}?${q}`;
}

/**
 * The token answer's scope list holds a permission to read the account's own calendars (short form or with the Graph
 * resource in front). Calendars.Read.Shared alone is not enough: the default calendar needs Calendars.Read.
 */
export function scopeGranted(scope) {
  return String(scope || '').split(/\s+/).some((s) => /^(?:https:\/\/graph\.microsoft\.com\/)?calendars\.read(?:write)?$/i.test(s));
}

const hasScope = (scope, re) => String(scope || '').split(/\s+/).some((s) => re.test(s.replace(/^https:\/\/graph\.microsoft\.com\//i, '')));

/** The scope list lets Marco read To Do lists: Tasks.Read or Tasks.ReadWrite (short form or with the Graph resource). */
export const tasksGranted = (scope) => hasScope(scope, /^tasks\.read(?:write)?$/i);
/** The scope list lets Marco mark To Do tasks done: Tasks.ReadWrite. */
export const tasksWritable = (scope) => hasScope(scope, /^tasks\.readwrite$/i);

/**
 * The scopes a refresh asks for, from the scopes the account granted (its stored `scope`). Asking Microsoft for a
 * permission the account never granted fails the refresh (invalid_grant or consent_required), which would also stop
 * its calendars, so a Tasks permission is only asked for when it was granted.
 */
export function refreshScopes(granted) {
  if (tasksWritable(granted)) return `${REFRESH_SCOPES} ${TASKS_SCOPE}`;
  if (tasksGranted(granted)) return `${REFRESH_SCOPES} ${TASKS_READ_SCOPE}`;
  return REFRESH_SCOPES;
}

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

function b64urlJson(part) {
  const b64 = String(part).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

/**
 * The account's email (lower case) from the ID token of a code exchange: `email`, else `preferred_username` when it is
 * an address. The token came straight from the token endpoint over TLS, in exchange for the app's secret and the PKCE
 * verifier, so its signature is not checked again (OpenID Connect Core 3.1.3.7); audience, issuer and expiry are.
 * Null when there is no usable address.
 */
export function idTokenEmail(idToken, clientId, now = Date.now()) {
  if (typeof idToken !== 'string' || !idToken) return null;
  let claims;
  try {
    claims = b64urlJson(idToken.split('.')[1] ?? '');
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object') return null;
  if (!clientId || claims.aud !== clientId) return null;
  const tid = typeof claims.tid === 'string' ? claims.tid : '';
  if (!/^[0-9a-f-]{36}$/i.test(tid) || claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) return null;
  if (!(Number(claims.exp) * 1000 > now - 300_000)) return null;
  for (const c of [claims.email, claims.preferred_username]) {
    if (typeof c !== 'string') continue;
    const e = c.normalize('NFC').trim().toLowerCase();
    if (e.length <= 254 && EMAIL.test(e)) return e;
  }
  return null;
}

/** The next page link, only when it stays on Graph (the bearer token never goes anywhere else). */
export function graphNextLink(j) {
  const next = j?.['@odata.nextLink'];
  return typeof next === 'string' && next.startsWith(`${GRAPH_API}/`) ? next : '';
}

export const calendarsUrl = () => `${GRAPH_API}/me/calendars?${new URLSearchParams({ $select: CALENDAR_FIELDS, $top: '100' })}`;
export const calendarGroupsUrl = () => `${GRAPH_API}/me/calendarGroups?${new URLSearchParams({ $select: 'id', $top: String(MAX_CALENDAR_GROUPS) })}`;
export const groupCalendarsUrl = (groupId) =>
  `${GRAPH_API}/me/calendarGroups/${encodeURIComponent(groupId)}/calendars?${new URLSearchParams({ $select: CALENDAR_FIELDS, $top: '100' })}`;

/** calendarView of one calendar for [from, to): Graph expands recurring series into their occurrences. */
export function calendarViewUrl(calendarId, from, to) {
  const q = new URLSearchParams({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    $select: EVENT_FIELDS,
    $orderby: 'start/dateTime',
    $top: String(EVENT_PAGE_SIZE),
  });
  return `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${q}`;
}

/** Graph headers: times in UTC. */
export const graphHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json', Prefer: 'outlook.timezone="UTC"' });

/** Outlook's preset calendar colours (calendarColor), for calendars without a hexColor. */
const PRESET_COLORS = {
  lightBlue: '#a4c2f4', lightGreen: '#a7d7a5', lightOrange: '#f9c28b', lightGray: '#c7c7c7', lightYellow: '#f6e58d',
  lightTeal: '#8fd3d0', lightPink: '#f4b0c8', lightBrown: '#c9a98a', lightRed: '#f19999',
};

/**
 * A Graph calendar as a MicrosoftCalendarListItem ({ id, name, color?, isDefault?, owner? }), or null. `owner` is set
 * for a calendar someone else shared with the account.
 */
export function calendarItem(c, accountEmail = '') {
  if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 512) return null;
  const item = { id: c.id, name: String(c.name || 'Calendar').slice(0, 200) };
  if (typeof c.hexColor === 'string' && /^#[0-9a-f]{6}$/i.test(c.hexColor)) item.color = c.hexColor.toLowerCase();
  else if (typeof c.color === 'string' && Object.hasOwn(PRESET_COLORS, c.color)) item.color = PRESET_COLORS[c.color];
  if (c.isDefaultCalendar === true) item.isDefault = true;
  const owner = c.owner?.address;
  if (typeof owner === 'string' && owner && owner.toLowerCase() !== String(accountEmail).toLowerCase()) item.owner = owner.slice(0, 254);
  return item;
}

const UTC_NAMES = new Set(['utc', 'etc/utc', 'gmt', 'etc/gmt', 'coordinated universal time', 'tzone://microsoft/utc']);

/** A Graph dateTimeTimeZone as a Date. UTC unless Graph ignored the Prefer header and named an IANA zone. */
export function graphInstant(v) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(String(v?.dateTime ?? ''));
  if (!m) return null;
  const ms = (m[2] ?? '').slice(1, 4).padEnd(3, '0');
  const asUtc = new Date(`${m[1]}.${ms || '000'}Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  const tz = String(v?.timeZone ?? 'UTC');
  if (UTC_NAMES.has(tz.toLowerCase()) || !isValidTimeZone(tz)) return asUtc;
  return new Date(asUtc.getTime() - tzOffsetMinutes(asUtc, tz) * 60_000);
}

/**
 * The calendar day of an all-day boundary. Graph sends all-day events at midnight; should it shift one into UTC from
 * the event's own zone (22:00 the day before for Madrid, 04:00 for New York), the nearest midnight is the right day.
 */
function allDayDate(v) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(v?.dateTime ?? ''));
  if (!m) return null;
  const t = Date.parse(`${m[1]}T00:00:00Z`) + (Number(m[2]) * 60 + Number(m[3])) * 60_000 + 12 * 3_600_000;
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

const addDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * A Graph event as a raw instance ({ uid, title, description, location, allDay, start, end }: all-day dates as
 * YYYY-MM-DD with an exclusive end, timed ones as Date), or null (cancelled, series master, unreadable).
 */
export function graphToRaw(it) {
  if (!it || it.isCancelled === true || it.type === 'seriesMaster' || !it.start) return null;
  const base = {
    uid: String(it.id || ''),
    title: String(it.subject || ''),
    description: String(it.bodyPreview || ''),
    location: String(it.location?.displayName || ''),
  };
  if (it.isAllDay === true) {
    const start = allDayDate(it.start);
    if (!start) return null;
    const endDay = allDayDate(it.end);
    return { ...base, allDay: true, start, end: endDay && endDay > start ? endDay : addDay(start) };
  }
  const start = graphInstant(it.start);
  if (!start) return null;
  let end = graphInstant(it.end) ?? new Date(start);
  if (end < start) end = new Date(start);
  return { ...base, allDay: false, start, end };
}

// ---- Microsoft To Do ----------------------------------------------------------------------------------------------

/** Tasks read per list: pages of TASK_PAGE_SIZE, at most MAX_TASK_PAGES of them, and TASKS_PER_LIST kept. */
export const TASK_PAGE_SIZE = 100;
export const MAX_TASK_PAGES = 5;
export const TASKS_PER_LIST = 100;
/** To Do lists read for the admin's picker (pages of 100). */
export const MAX_TODO_LIST_PAGES = 4;
/** How often a list is read again, and how long after a failure. */
export const TODO_REFRESH_MS = 5 * 60_000;
export const TODO_RETRY_MS = 2 * 60_000;

export const todoListsUrl = () => `${GRAPH_API}/me/todo/lists?${new URLSearchParams({ $top: '100' })}`;

/**
 * The open tasks of one list (completed ones are filtered by Graph). No $select: Graph answers 400 invalidRequest to
 * a $select on To Do tasks, so the whole task comes and todoItems keeps what it needs.
 */
export function todoTasksUrl(listId) {
  const q = new URLSearchParams({
    $filter: "status ne 'completed'",
    $top: String(TASK_PAGE_SIZE),
  });
  return `${GRAPH_API}/me/todo/lists/${encodeURIComponent(listId)}/tasks?${q}`;
}

/**
 * A Graph todoTaskList as a MicrosoftTodoListItem ({ id, name, isDefault?, shared? }), or null. The "Flagged email"
 * list To Do makes from Outlook is left out: it holds emails, not tasks.
 */
export function todoListItem(l) {
  if (!l || typeof l.id !== 'string' || !l.id || l.id.length > 512) return null;
  if (l.wellknownListName === 'flaggedEmails') return null;
  const item = { id: l.id, name: String(l.displayName || 'Tasks').slice(0, 200) };
  if (l.wellknownListName === 'defaultList') item.isDefault = true;
  if (l.isShared === true) item.shared = true;
  return item;
}

/** One task, to mark it done or not done (PATCH { status }). */
export const todoTaskUrl = (listId, taskId) => `${GRAPH_API}/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
export const todoStatusBody = (done) => ({ status: done ? 'completed' : 'notStarted' });

/**
 * A Graph todoTask as a cached task ({ taskId, text, due?, important? }), or null (completed, no title, unreadable).
 * `due` is the calendar day (YYYY-MM-DD): To Do keeps due dates at midnight of the owner's zone, which Graph may send
 * moved into UTC, so the nearest midnight is the day (as for all-day events). The Graph id stays on the server: a
 * display gets an opaque id instead (displayTodoItem).
 */
export function todoTaskItem(t) {
  if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 512) return null;
  if (t.status === 'completed') return null;
  const text = String(t.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return null;
  const item = { taskId: t.id, text };
  const due = t.dueDateTime ? allDayDate(t.dueDateTime) : null;
  if (due) item.due = due;
  if (t.importance === 'high') item.important = true;
  return item;
}

/** Graph tasks as cached tasks: open ones only, those with a due date first (soonest first), at most TASKS_PER_LIST. */
export function todoItems(tasks) {
  const items = (Array.isArray(tasks) ? tasks : []).map(todoTaskItem).filter(Boolean);
  const seen = new Set();
  const unique = items.filter((it) => !seen.has(it.taskId) && seen.add(it.taskId));
  const dated = unique.filter((it) => it.due).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return [...dated, ...unique.filter((it) => !it.due)].slice(0, TASKS_PER_LIST);
}

/**
 * A cached task as the display sees it: { id, text, done, due?, important?, tick?, list? }. `id` is the opaque id the
 * server made for it (ms_...), `tick` that a touch screen may mark it done (the account granted Tasks.ReadWrite),
 * `list` the id of its todo.lists entry (tl_..., a Marco id: the to-do cards pick their lists by it, core/todoCore.js).
 */
export function displayTodoItem(it, id, tick, list = '') {
  const out = { id, text: it.text, done: it.done === true };
  if (it.due) out.due = it.due;
  if (it.important) out.important = true;
  if (tick) out.tick = true;
  if (list) out.list = list;
  return out;
}

/** Ids of to-do items that come from a Microsoft To Do list (displayTodoItem), not typed in the admin. */
export const isListTask = (id) => typeof id === 'string' && id.startsWith('ms_');

/** The Microsoft To Do lists of a config that are on (todo.lists). */
export const enabledTodoLists = (cfg) => (Array.isArray(cfg?.todo?.lists) ? cfg.todo.lists : []).filter((l) => l && l.enabled !== false && l.type === 'microsoft');
