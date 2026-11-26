// Google OAuth 2.0 + Calendar API v3 via plain fetch (no googleapis package).
import crypto from 'node:crypto';
import { request, requestJson, HttpError } from './lib/http.js';
import { getSecrets, updateSecrets } from './store.js';
import {
  GOOGLE_TASKS_SCOPE, MAX_TASK_LIST_PAGES, MAX_TASK_PAGES, googleTaskItems, googleTasksGranted, googleTasksWritable, taskListItem,
  taskListsUrl, taskStatusBody, taskUrl, tasksUrl,
} from './core/googleTasks.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CAL_API = 'https://www.googleapis.com/calendar/v3';
export const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function publicUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
export const redirectUri = (req) => `${publicUrl(req)}/auth/google/callback`;

/**
 * Build the consent URL. purpose: 'login' | 'connect'. State = base64url JSON {p, n} with CSRF nonce n. A connect from
 * the To-do page (`tasks`) asks for Google Tasks too; `account` preselects that account in Google's chooser.
 */
export function authUrl(req, purpose, nonce, { tasks = false, account = '' } = {}) {
  const state = Buffer.from(JSON.stringify({ p: purpose, n: nonce })).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    state,
    include_granted_scopes: 'true',
  });
  if (purpose === 'connect') {
    params.set('scope', `openid email profile ${CAL_SCOPE}${tasks ? ` ${GOOGLE_TASKS_SCOPE}` : ''}`);
    params.set('access_type', 'offline');
    // the account chooser every time, so a second (or third) Google account can be linked too
    params.set('prompt', 'consent select_account');
    if (account) params.set('login_hint', account);
  } else {
    params.set('scope', 'openid email profile');
    params.set('prompt', 'select_account');
  }
  return `${AUTH_URL}?${params}`;
}

export function parseState(state) {
  try {
    const s = JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8'));
    return s && typeof s.n === 'string' && ['login', 'connect'].includes(s.p) ? s : null;
  } catch {
    return null;
  }
}

export const newNonce = () => crypto.randomBytes(16).toString('hex');

async function tokenRequest(params) {
  const res = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...params,
    }).toString(),
    throwOnError: false,
  });
  let json;
  try { json = JSON.parse(res.text); } catch { json = {}; }
  // `oauth`: Google's error code (invalid_grant: the account's refresh token was revoked or expired)
  if (!res.ok) throw Object.assign(new HttpError(`Google token error: ${json.error_description || json.error || res.status}`, res.status), { oauth: json.error });
  return json;
}

export async function exchangeCode(req, code) {
  const tok = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(req) });
  const info = await requestJson(USERINFO_URL, { headers: { authorization: `Bearer ${tok.access_token}` } });
  if (!info.email || info.email_verified === false) throw new Error('Google account email not verified');
  return { tokens: tok, profile: { email: info.email.toLowerCase(), name: info.name || info.email, picture: info.picture || '' } };
}

/** Persist calendar tokens for an account (connect flow). Keeps the old refresh token if Google omitted it. */
export function storeAccount(profile, tokens) {
  updateSecrets((s) => {
    const prev = s.google.accounts[profile.email] || {};
    s.google.accounts[profile.email] = {
      ...prev,
      name: profile.name,
      picture: profile.picture,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || prev.refresh_token,
      expiry: Date.now() + (tokens.expires_in || 3600) * 1000,
      scope: tokens.scope || prev.scope,
    };
  });
}

/**
 * Linked accounts. `tasks` false: linked without Google Tasks access (linked for its calendars, or before Marco
 * asked; its lists need a connect from the To-do page); `tasksWrite` false with `tasks` true: read only.
 */
export function listAccounts() {
  return Object.entries(getSecrets().google.accounts).map(([email, a]) => ({
    email, name: a.name || email, picture: a.picture || '', tasks: googleTasksGranted(a.scope), tasksWrite: googleTasksWritable(a.scope),
  }));
}

/** The account lets Marco read its Google Tasks lists. */
export const accountHasGoogleTasks = (email) => googleTasksGranted(getSecrets().google.accounts[email]?.scope);
/** The account lets Marco mark its Google tasks done. */
export const accountWritesGoogleTasks = (email) => googleTasksWritable(getSecrets().google.accounts[email]?.scope);

export async function removeAccount(email) {
  const acct = getSecrets().google.accounts[email];
  if (!acct) return false;
  const tok = acct.refresh_token || acct.access_token;
  if (tok) {
    request(`${REVOKE_URL}?token=${encodeURIComponent(tok)}`, { method: 'POST', throwOnError: false }).catch(() => {});
  }
  updateSecrets((s) => { delete s.google.accounts[email]; });
  return true;
}

const refreshing = new Map();
/** Valid access token for an account, refreshing when it expires within 60 s. */
export async function getAccessToken(email) {
  const acct = getSecrets().google.accounts[email];
  if (!acct) throw new Error(`Google account not connected: ${email}`);
  if (acct.access_token && acct.expiry > Date.now() + 60_000) return acct.access_token;
  if (!acct.refresh_token) throw new Error(`No refresh token for ${email}; reconnect the account`);
  if (!googleConfigured()) throw new Error('Google OAuth not configured (GOOGLE_CLIENT_ID/SECRET)');
  if (!refreshing.has(email)) {
    refreshing.set(email, (async () => {
      try {
        const tok = await tokenRequest({ refresh_token: acct.refresh_token, grant_type: 'refresh_token' });
        updateSecrets((s) => {
          const a = s.google.accounts[email];
          if (!a) return;
          a.access_token = tok.access_token;
          a.expiry = Date.now() + (tok.expires_in || 3600) * 1000;
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

async function api(email, url, { method = 'GET', body } = {}) {
  const token = await getAccessToken(email);
  const res = await request(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    throwOnError: false,
  });
  let json;
  try { json = JSON.parse(res.text); } catch { json = {}; }
  if (!res.ok) {
    const err = new HttpError(`Google API: ${json.error?.message || `HTTP ${res.status}`}`, res.status);
    // the Google Tasks API is off in the server's own Google Cloud project (docs/INTEGRATIONS.md, Connecting Google Calendar)
    const reasons = [json.error?.status, ...(json.error?.errors ?? []).map((e) => e?.reason), ...(json.error?.details ?? []).map((d) => d?.reason)];
    if (res.status === 403 && reasons.some((r) => r === 'accessNotConfigured' || r === 'SERVICE_DISABLED')) err.code = 'tasks_api_off';
    else if (res.status === 401) err.code = 'auth_failed';
    else if (res.status === 403 && reasons.some((r) => r === 'insufficientPermissions' || r === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) err.code = 'tasks_scope';
    throw err;
  }
  return json;
}

/**
 * A Google Tasks call that failed: 'auth_failed' when the account's refresh token no longer works (not when the
 * server's own client id or secret is wrong: connecting the account again would not help then).
 */
function tasksFailure(err) {
  if (!err.code && err.oauth === 'invalid_grant') err.code = 'auth_failed';
  if (!err.code && /^No refresh token/.test(err.message || '')) err.code = 'auth_failed';
  return err;
}

const scopeError = () => Object.assign(new Error('Google Tasks access not granted; connect the account from the To-do page'), { code: 'tasks_scope' });

/** The account's Google Tasks lists. Throws 'tasks_scope' without Tasks access. */
export async function listTaskLists(email) {
  if (!accountHasGoogleTasks(email)) throw scopeError();
  const out = [];
  let pageToken = '';
  try {
    for (let i = 0; i < MAX_TASK_LIST_PAGES; i++) {
      const j = await api(email, taskListsUrl(pageToken));
      for (const l of j.items || []) {
        const item = taskListItem(l);
        if (item) out.push(item);
      }
      if (!(pageToken = j.nextPageToken)) break;
    }
  } catch (err) {
    throw tasksFailure(err);
  }
  return out;
}

/** The open tasks of one list (core googleTaskItems: Google id, title, due day), all pages up to MAX_TASK_PAGES. */
export async function listGoogleTasks(email, listId) {
  if (!accountHasGoogleTasks(email)) throw scopeError();
  const tasks = [];
  let pageToken = '';
  try {
    for (let i = 0; i < MAX_TASK_PAGES; i++) {
      const j = await api(email, tasksUrl(listId, pageToken));
      if (Array.isArray(j.items)) tasks.push(...j.items);
      if (!(pageToken = j.nextPageToken)) break;
    }
  } catch (err) {
    throw tasksFailure(err);
  }
  return googleTaskItems(tasks);
}

/** Marks one task done (completed) or not done (needsAction). Throws 'tasks_scope' without write access. */
export async function setGoogleTaskDone(email, listId, taskId, done) {
  if (!accountWritesGoogleTasks(email)) throw scopeError();
  try {
    await api(email, taskUrl(listId, taskId), { method: 'PATCH', body: taskStatusBody(done) });
  } catch (err) {
    throw tasksFailure(err);
  }
}

export async function listCalendars(email) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ maxResults: '250', ...(pageToken && { pageToken }) });
    const j = await api(email, `${CAL_API}/users/me/calendarList?${q}`);
    for (const c of j.items || []) {
      out.push({ id: c.id, summary: c.summaryOverride || c.summary, backgroundColor: c.backgroundColor || null, primary: Boolean(c.primary) });
    }
    if (!(pageToken = j.nextPageToken)) break;
  }
  return out;
}

/** events.list with singleEvents=true (recurrences expanded by Google). timeMin/timeMax are Date. */
export async function listEvents(email, calendarId, timeMin, timeMax) {
  const items = [];
  let pageToken = '';
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({
      singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', showDeleted: 'false',
      timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
      ...(pageToken && { pageToken }),
    });
    const j = await api(email, `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    // Google Workspace "working location" entries ("Home", "Office") are not events: leave them out
    items.push(...(j.items || []).filter((it) => it?.eventType !== 'workingLocation'));
    if (!(pageToken = j.nextPageToken)) break;
  }
  return items;
}

/**
 * "Sign in with Google" on a self-hosted server. Off by default: people sign in to their home server with its
 * password, and Google is for calendars. It stays on for servers that already rely on it (password sign-in turned
 * off and allowed Google emails set), and MARCO_GOOGLE_LOGIN=1 turns it on explicitly.
 */
export function googleLoginEnabled(cfg, env = process.env) {
  if (!googleConfigured()) return false;
  if (String(env.MARCO_GOOGLE_LOGIN || '').trim() === '1') return true;
  const a = cfg?.auth ?? {};
  return a.passwordLoginEnabled === false && Array.isArray(a.allowedGoogleEmails) && a.allowedGoogleEmails.length > 0;
}
