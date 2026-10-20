// Microsoft calendars and To Do lists (Outlook.com, Hotmail, Microsoft 365), read only, through Microsoft Graph with your own Microsoft
// Entra app (MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in .env; see README "Connecting Outlook, Hotmail or Microsoft 365"). Optional: without them
// the admin does not offer Microsoft accounts.
//
// Connect: authorization code with PKCE; the state and the verifier live in the admin's session. Tokens are kept in
// data/secrets.json under microsoft.accounts[email] (like Google accounts). Microsoft hands out a new refresh token
// with every access token: the new one replaces the stored one each time. There is no revoke endpoint: removing an
// account deletes its tokens here, and access can be removed at https://account.live.com/consent/Manage (personal) or
// https://myapps.microsoft.com (work or school). Tokens are never logged or sent to the browser.
import crypto from 'node:crypto';
import { request, HttpError } from './lib/http.js';
import { getSecrets, updateSecrets } from './store.js';
import { publicUrl } from './google.js';
import {
  CONNECT_CALLBACK_PATH, CONNECT_SCOPES, MAX_TASK_PAGES, MAX_TODO_LIST_PAGES, MICROSOFT_AUTH_ERRORS, MS_TOKEN_URL,
  calendarGroupsUrl, calendarItem, calendarViewUrl, calendarsUrl, graphHeaders, graphNextLink, groupCalendarsUrl,
  idTokenEmail, microsoftAuthUrl, refreshScopes, scopeGranted, tasksGranted, tasksWritable, todoItems, todoListItem,
  todoListsUrl, todoStatusBody, todoTaskUrl, todoTasksUrl,
} from './core/microsoftGraph.js';

export { graphToRaw, MANAGE_ACCESS_URLS, MICROSOFT_OAUTH_ERRORS } from './core/microsoftGraph.js';

export const microsoftConfigured = () => Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
export const redirectUri = (req) => `${publicUrl(req)}${CONNECT_CALLBACK_PATH}`;

/** Events read per calendar refresh (500 per page). */
const MAX_EVENT_PAGES = 10;

/**
 * A failed Microsoft call. code 'auth_failed': the account must be connected again. 'tasks_scope': the account was
 * linked before Marco asked for Tasks.Read, so it must be connected again to read its To Do lists.
 */
export class MicrosoftError extends HttpError {
  constructor(message, status = 0, code = '') {
    super(message, status);
    if (code) this.code = code;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Starts a connect: state and PKCE verifier in the session, returns Microsoft's sign-in URL. `account`: a linked
 * account this connect reconnects (its new tokens and scopes replace the stored ones, everything that uses it stays;
 * another account signed in there is refused). `back`: where the admin lands (core connectBack).
 */
export function startConnect(req, lang = '', { account = '', back = '' } = {}) {
  const state = b64url(crypto.randomBytes(32));
  const verifier = b64url(crypto.randomBytes(48));
  const reconnect = account && accounts()[account] ? account : '';
  req.session.msOauth = { state, verifier, at: Date.now(), ...(reconnect ? { account: reconnect } : {}), ...(back ? { back } : {}) };
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return microsoftAuthUrl({ clientId: process.env.MICROSOFT_CLIENT_ID, redirectUri: redirectUri(req), state, challenge, lang, loginHint: reconnect });
}

/** Takes the session's pending connect (single use). Null when missing, older than 10 minutes, or another state. */
export function takeConnect(req, state) {
  const p = req.session?.msOauth;
  if (req.session) delete req.session.msOauth;
  if (!p || typeof state !== 'string' || typeof p.state !== 'string' || Date.now() - p.at > 10 * 60_000) return null;
  if (state.length !== p.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(p.state))) return null;
  return p;
}

async function tokenRequest(params) {
  const res = await request(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, ...params }).toString(),
    throwOnError: false,
  });
  let json;
  try { json = JSON.parse(res.text); } catch { json = {}; }
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error.slice(0, 40) : '';
    // Only Microsoft's short error code goes into the message (shown in Status): never a token or a description.
    throw new MicrosoftError(`Microsoft token error: ${code || `HTTP ${res.status}`}`, res.status, MICROSOFT_AUTH_ERRORS.has(code) ? 'auth_failed' : '');
  }
  if (typeof json.access_token !== 'string' || !json.access_token) throw new MicrosoftError('Microsoft token error: no access token', res.status);
  return json;
}

/** Code + verifier to tokens and the account email. Throws MicrosoftError with code scope_denied / no_refresh_token / no_email. */
export async function exchangeCode(req, code, verifier) {
  const tok = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri(req), scope: CONNECT_SCOPES });
  if (!scopeGranted(tok.scope)) throw new MicrosoftError('Calendar permission not granted', 0, 'scope_denied');
  if (!tok.refresh_token) throw new MicrosoftError('No refresh token', 0, 'no_refresh_token');
  let email = idTokenEmail(tok.id_token, process.env.MICROSOFT_CLIENT_ID);
  if (!email) {
    // The owner of the default calendar, when the ID token has no address.
    const j = await graphGet(`https://graph.microsoft.com/v1.0/me/calendar?$select=owner`, tok.access_token).catch(() => ({}));
    const a = String(j.owner?.address || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) email = a;
  }
  if (!email) throw new MicrosoftError('No email for the Microsoft account', 0, 'no_email');
  return { email, tokens: tok };
}

/** Saves (or replaces) an account's tokens. */
export function storeAccount(email, tokens) {
  updateSecrets((s) => {
    s.microsoft ??= {};
    s.microsoft.accounts ??= {};
    s.microsoft.accounts[email] = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
      scope: String(tokens.scope || ''),
      connectedAt: new Date().toISOString(),
    };
  });
}

const accounts = () => getSecrets().microsoft?.accounts || {};

/**
 * Linked accounts. `tasks` false: linked before Marco asked for To Do access (its lists need a new connect);
 * `tasksWrite` false with `tasks` true: Tasks.Read only, its tasks cannot be ticked from a screen.
 */
export function listAccounts() {
  return Object.entries(accounts()).map(([email, a]) => ({ email, tasks: tasksGranted(a?.scope), tasksWrite: tasksWritable(a?.scope) }));
}

/** The account may read its To Do lists (false for an unknown account). */
export const accountHasTasks = (email) => tasksGranted(accounts()[email]?.scope);
/** The account may mark its To Do tasks done (Tasks.ReadWrite). */
export const accountWritesTasks = (email) => tasksWritable(accounts()[email]?.scope);

/** Deletes an account's tokens (Microsoft has no revoke endpoint). */
export function removeAccount(email) {
  if (!accounts()[email]) return false;
  updateSecrets((s) => { delete s.microsoft.accounts[email]; });
  return true;
}

const refreshing = new Map();
/**
 * Valid access token for an account, refreshing (and storing the rotated refresh token) when it expires within 60 s.
 * The refresh asks only for the permissions the account granted (refreshScopes of its stored scope): an account
 * linked before Tasks.Read keeps reading its calendars.
 */
export async function getAccessToken(email) {
  const acct = accounts()[email];
  if (!acct) throw new MicrosoftError(`Microsoft account not connected: ${email}`, 0, 'auth_failed');
  if (acct.access_token && acct.expiry > Date.now() + 60_000) return acct.access_token;
  if (!acct.refresh_token) throw new MicrosoftError(`No refresh token for ${email}; reconnect the account`, 0, 'auth_failed');
  if (!microsoftConfigured()) throw new MicrosoftError('Microsoft is not configured (MICROSOFT_CLIENT_ID/SECRET)');
  if (!refreshing.has(email)) {
    refreshing.set(email, (async () => {
      try {
        const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: acct.refresh_token, scope: refreshScopes(acct.scope) });
        updateSecrets((s) => {
          const a = s.microsoft?.accounts?.[email];
          if (!a) return;
          a.access_token = tok.access_token;
          a.expiry = Date.now() + (Number(tok.expires_in) || 3600) * 1000;
          if (tok.refresh_token) a.refresh_token = tok.refresh_token;
        });
        return tok.access_token;
      } finally {
        refreshing.delete(email);
      }
    })());
  }
  return refreshing.get(email);
}

async function graphGet(url, token, write = null) {
  const res = await request(url, write
    ? { method: 'PATCH', headers: { ...graphHeaders(token), 'content-type': 'application/json' }, body: JSON.stringify(write), throwOnError: false }
    : { headers: graphHeaders(token), throwOnError: false });
  let json;
  try { json = JSON.parse(res.text); } catch { json = {}; }
  if (!res.ok) {
    // Graph's own error code and the start of its message (never a token) say what was wrong with the request
    const e = new MicrosoftError(`Microsoft Graph: HTTP ${res.status}`, res.status, res.status === 401 ? 'auth_failed' : '');
    e.graph = [json?.error?.code, json?.error?.message].filter((x) => typeof x === 'string' && x).join(': ').slice(0, 160);
    throw e;
  }
  return json;
}

/** Graph call for an account (`write`: a PATCH body). A 401 drops the access token and tries once more with a fresh one. */
async function api(email, url, write = null) {
  try {
    return await graphGet(url, await getAccessToken(email), write);
  } catch (err) {
    if (err.status !== 401) throw err;
    updateSecrets((s) => { const a = s.microsoft?.accounts?.[email]; if (a) a.expiry = 0; });
    return graphGet(url, await getAccessToken(email), write);
  }
}

/** The account's own calendars and the ones shared with it (calendar groups too), once each. */
export async function listCalendars(email) {
  const out = [];
  const seen = new Set();
  const add = (c) => {
    const item = calendarItem(c, email);
    if (item && !seen.has(item.id)) { seen.add(item.id); out.push(item); }
  };
  const pages = async (first) => {
    let url = first;
    for (let i = 0; i < 4 && url; i++) {
      const j = await api(email, url);
      (Array.isArray(j.value) ? j.value : []).forEach(add);
      url = graphNextLink(j);
    }
  };
  await pages(calendarsUrl());
  let groups = [];
  try {
    const j = await api(email, calendarGroupsUrl());
    groups = (Array.isArray(j.value) ? j.value : []).map((g) => g?.id).filter((id) => typeof id === 'string' && id && id.length <= 512).slice(0, 10);
  } catch (err) {
    if (err.code === 'auth_failed') throw err;
  }
  for (const g of groups) {
    try { await pages(groupCalendarsUrl(g)); } catch (err) { if (err.code === 'auth_failed') throw err; }
  }
  return out;
}

/** calendarView for [timeMin, timeMax) (Date), all pages up to MAX_EVENT_PAGES. Recurrences come expanded. */
export async function listEvents(email, calendarId, timeMin, timeMax) {
  const items = [];
  let url = calendarViewUrl(calendarId, timeMin, timeMax);
  for (let i = 0; i < MAX_EVENT_PAGES && url; i++) {
    const j = await api(email, url);
    if (Array.isArray(j.value)) items.push(...j.value);
    url = graphNextLink(j);
  }
  return items;
}

/** The account's Microsoft To Do lists (its own and the ones shared with it). Throws 'tasks_scope' without To Do access. */
export async function listTodoLists(email) {
  if (!accountHasTasks(email)) throw new MicrosoftError('To Do access not granted; reconnect the account', 0, 'tasks_scope');
  const out = [];
  let url = todoListsUrl();
  for (let i = 0; i < MAX_TODO_LIST_PAGES && url; i++) {
    const j = await api(email, url);
    for (const l of Array.isArray(j.value) ? j.value : []) {
      const item = todoListItem(l);
      if (item && !out.some((x) => x.id === item.id)) out.push(item);
    }
    url = graphNextLink(j);
  }
  return out;
}

/** The open tasks of one list (core todoItems: Graph id, title, due day, importance), all pages up to MAX_TASK_PAGES. */
export async function listTodoTasks(email, listId) {
  if (!accountHasTasks(email)) throw new MicrosoftError('To Do access not granted; reconnect the account', 0, 'tasks_scope');
  const tasks = [];
  let url = todoTasksUrl(listId);
  for (let i = 0; i < MAX_TASK_PAGES && url; i++) {
    const j = await api(email, url);
    if (Array.isArray(j.value)) tasks.push(...j.value);
    url = graphNextLink(j);
  }
  return todoItems(tasks);
}

/** Marks one task done (completed) or not done (notStarted). Throws 'tasks_scope' without Tasks.ReadWrite. */
export async function setTodoTaskDone(email, listId, taskId, done) {
  if (!accountWritesTasks(email)) throw new MicrosoftError('Tasks.ReadWrite not granted', 0, 'tasks_scope');
  await api(email, todoTaskUrl(listId, taskId), todoStatusBody(done));
}
