// Admin authentication: scrypt password, cookie-session, Google OAuth login/connect, CSRF guard.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import cookieSession from 'cookie-session';
import { getConfig, getSecrets, updateSecrets, updateConfig } from './store.js';
import * as google from './google.js';
import * as microsoft from './microsoft.js';
import { CONNECT_BACK, connectBack } from './core/microsoftGraph.js';
import { logActivity, logActivityThrottled } from './activity.js';
import { passwordProblem, PASSWORD_MESSAGES } from './lib/password.js';
import { isPrivateIp, isLanClient, clientBucket, hostAllowed, hostnameOf } from './lib/net.js';
import { LANGS } from './core/lib/i18n.js';
import { twoFactorEnabled, startChallenge, challengeOf, dropChallenge, dropAllChallenges, checkSecondFactor, CHALLENGE_ATTEMPTS } from './twofactor.js';

export { isPrivateIp, isLanClient };

/**
 * 'revoked' () after the session epoch rotates (logout everywhere, password change, imported password);
 * 'logout' (sid) when one browser logs out. Live admin-session streams listen (displayAccess.js).
 */
export const authEvents = new EventEmitter();

const scryptRaw = promisify(crypto.scrypt);
const KEYLEN = 64;

// Global concurrency cap: one scrypt at a time (brute-force throttle + keeps the Pi responsive).
let scryptChain = Promise.resolve();
function scrypt(...args) {
  const run = scryptChain.then(() => scryptRaw(...args));
  scryptChain = run.catch(() => {});
  return run;
}

/** Format: scrypt$<saltB64>$<hashB64> */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, hashB64] = stored.split('$');
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(String(password ?? ''), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

const WEAK_DEFAULTS = new Set(['', 'admin', 'password', 'change-me']);

/** Fresh install: no admin password has been set yet → the admin shows the setup wizard (server/setup.js). */
export const needsSetup = () => !getSecrets().passwordHash;

/**
 * Startup: make sure a session epoch exists and, when ADMIN_PASSWORD is set and no password hash exists yet
 * (headless/Docker installs), hash it as the initial password (`passwordFromEnv`: the panel offers to change it).
 * Without ADMIN_PASSWORD there is no default password at all: the install stays in "needs setup" until the
 * wizard completes. An ADMIN_PASSWORD that does not meet the wizard's rules (at least 10 characters, not a common
 * password: lib/password.js) is flagged as weak (`passwordIsDefault`): it is then only accepted from LAN clients
 * (isLanClient strict) and the panel forces a change. Installs that already have a hash are never touched.
 */
export async function ensurePassword() {
  const sec = getSecrets();
  if (!sec.sessionEpoch) updateSecrets((s) => { s.sessionEpoch = crypto.randomBytes(16).toString('hex'); });
  if (sec.passwordHash) return;
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return;
  const h = await hashPassword(pw);
  if (getSecrets().passwordHash) return; // set meanwhile (wizard)
  const weak = WEAK_DEFAULTS.has(pw) || pw.length < 6 || passwordProblem(pw) !== null;
  updateSecrets((s) => { s.passwordHash = h; s.passwordIsDefault = weak; s.passwordFromEnv = true; });
  if (weak) console.warn('[auth] ADMIN_PASSWORD does not meet the password rules (>= 10 characters, not a common password): it only works from the LAN until you change it in the panel');
}

/** Absolute lifetime of an admin session, counted on the server from the sign-in (the cookie expires then too). */
export const SESSION_MAX_AGE = 14 * 24 * 3600_000;
/** A session not used for this long ends (checked on the server). */
export const SESSION_IDLE_MS = 7 * 24 * 3600_000;
/** Sessions kept per install; signing in once more drops the one used least recently. */
export const MAX_SESSIONS = 50;
/** Exports and imports with private data need a sign-in (or the password) within this time. */
export const RECENT_AUTH_MS = 10 * 60_000;
const SEEN_WRITE_MS = 10 * 60_000;

export function sessionMiddleware() {
  const envSecret = process.env.SESSION_SECRET;
  const secret = envSecret && envSecret !== 'change-me' ? envSecret : getSecrets().sessionSecret;
  const mw = cookieSession({
    name: 'cs_session',
    keys: [secret],
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
  });
  // Secure flag decided per request: https requests (directly or via a trusted proxy) get a Secure cookie,
  // plain-http LAN access (http://<pi-ip>:3000/admin/) still works. COOKIE_SECURE=0 disables it, =1 forces it.
  const mode = process.env.COOKIE_SECURE;
  return (req, res, next) => mw(req, res, () => {
    if (req.sessionOptions) req.sessionOptions.secure = mode === '1' ? true : mode === '0' ? false : Boolean(req.secure);
    next();
  });
}

// Server-side session records (secrets.sessions): the cookie carries a random session id, the server keeps only its
// SHA-256 with the sign-in time, the last use and who signed in. Logging out deletes the record, so a copy of the
// cookie stops working at once; records past SESSION_MAX_AGE or idle for SESSION_IDLE_MS are refused and pruned.
const sidKey = (sid) => crypto.createHash('sha256').update(String(sid)).digest('hex');
const SID_RE = /^[A-Za-z0-9_-]{32}$/;

function sessionStore() {
  const s = getSecrets();
  if (!s.sessions || typeof s.sessions !== 'object' || Array.isArray(s.sessions)) s.sessions = {};
  return s.sessions;
}

const expired = (rec, now) => !rec || typeof rec.iat !== 'number' || typeof rec.seen !== 'number'
  || now - rec.iat > SESSION_MAX_AGE || now - rec.seen > SESSION_IDLE_MS || rec.iat > now + 60_000;

/** Drop expired records and, past MAX_SESSIONS, the least recently used ones (in place; no write). */
function pruneSessions(store, now = Date.now(), keep = MAX_SESSIONS) {
  for (const [k, rec] of Object.entries(store)) if (expired(rec, now)) delete store[k];
  const entries = Object.entries(store);
  if (entries.length > keep) {
    entries.sort((a, b) => a[1].seen - b[1].seen);
    for (const [k] of entries.slice(0, entries.length - keep)) delete store[k];
  }
}

/** The server-side record of this request's session, or null. */
function sessionRecord(req) {
  const sid = req.session?.sid;
  if (typeof sid !== 'string' || !SID_RE.test(sid)) return null;
  const rec = sessionStore()[sidKey(sid)];
  return rec && !expired(rec, Date.now()) ? rec : null;
}

/** Server-side validity of a cookie session: its record (logout, expiry), epoch (revocation), login method still allowed, Google email still allowed. */
export function sessionValid(req) {
  if (needsSetup()) return false;
  const u = req.session?.user;
  if (!u) return false;
  const sec = getSecrets();
  if (!sec.sessionEpoch || req.session.epoch !== sec.sessionEpoch) return false;
  const rec = sessionRecord(req);
  if (!rec || rec.method !== u.method || rec.email !== u.email) return false;
  const cfg = getConfig();
  if (u.method === 'password') {
    if (!cfg.auth.passwordLoginEnabled) return false;
    if (sec.passwordIsDefault && !isLanClient(req, { strict: true })) return false;
  } else if (u.method === 'google') {
    // Sign in with Google turned off (the default on self-hosted): sessions made with it end too.
    if (!google.googleLoginEnabled(cfg)) return false;
    if (!cfg.auth.allowedGoogleEmails.includes(u.email)) return false;
  } else {
    return false;
  }
  return true;
}

/** Note that this session was used (written at most every 10 minutes): keeps it from ending as idle. */
function touchSession(req) {
  const rec = sessionRecord(req);
  if (!rec) return;
  const now = Date.now();
  if (now - rec.seen < SEEN_WRITE_MS) return;
  rec.seen = now;
  try { updateSecrets((s) => pruneSessions(sessionStore(), now)); } catch { /* retried on the next request */ }
}

/** True when this session signed in (or confirmed the password) within RECENT_AUTH_MS. */
export function recentlyAuthenticated(req) {
  const rec = sessionRecord(req);
  return Boolean(rec && Date.now() - (rec.authAt ?? rec.iat) <= RECENT_AUTH_MS);
}

/**
 * Family photos (/media/*): LAN clients (the displays) or a signed-in admin only. Behind a reverse proxy that lets
 * /media/* through (deploy/Caddyfile.example), Internet clients without a session get 404.
 */
export function lanOrSession(req, res, next) {
  if (isLanClient(req) || sessionValid(req)) return next();
  res.status(404).type('text/plain').send('not found');
}

/** Sign this browser in: a new random session id (never the one the browser had) and its server-side record. */
export function startSession(req, user) {
  const old = req.session?.sid;
  const sid = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  updateSecrets(() => {
    const store = sessionStore();
    if (typeof old === 'string' && SID_RE.test(old)) delete store[sidKey(old)];
    pruneSessions(store, now, MAX_SESSIONS - 1);
    store[sidKey(sid)] = { iat: now, seen: now, authAt: now, method: user.method, email: user.email };
  });
  req.session.user = user;
  req.session.epoch = getSecrets().sessionEpoch;
  // Per-login id: the key of the server-side record, also lets a plain logout close this browser's streams.
  req.session.sid = sid;
}

/** End this browser's session on the server (its record is deleted: copies of the cookie stop working too). */
export function endSession(req) {
  const sid = req.session?.sid;
  if (typeof sid === 'string' && SID_RE.test(sid)) {
    const k = sidKey(sid);
    if (sessionStore()[k]) updateSecrets(() => { delete sessionStore()[k]; });
  }
  req.session = null;
  return typeof sid === 'string' ? sid : null;
}

/** Forget a sign-in the server no longer accepts, keeping a two-step challenge this browser is in the middle of. */
function dropStaleSession(req) {
  const tfa = req.session?.tfa;
  req.session = null;
  if (challengeOf(tfa)) req.session = { tfa };
}

export function requireAuth(req, res, next) {
  if (sessionValid(req)) {
    touchSession(req);
    return next();
  }
  if (req.session?.user) dropStaleSession(req);
  res.status(401).json({ error: 'unauthorized' });
}

/** Invalidate every existing session (password change, "log out everywhere"). */
export function rotateSessionEpoch() {
  const epoch = crypto.randomBytes(16).toString('hex');
  updateSecrets((s) => { s.sessionEpoch = epoch; s.sessions = {}; });
  // A password typed before this (a changed password, "log out everywhere") no longer leads to the code step.
  dropAllChallenges();
  authEvents.emit('revoked');
  return epoch;
}

/**
 * CSRF guard for mutating requests: the session cookie is SameSite=Lax; additionally the body must be JSON
 * (or multipart for photo upload, or empty), and a present Origin header must match the Host and be an allowed
 * host name (lib/net.js hostAllowed: LAN names, IP literals, PUBLIC_URL, ALLOWED_HOSTS; DNS rebinding guard).
 * An opaque origin ("Origin: null": sandboxed frames, pages that hide their referrer) is refused. A multipart
 * upload also needs the X-Requested-With header (the admin sends it on every call): a form on another page cannot
 * set it, and a script on another origin cannot either without a CORS preflight this server never answers.
 */
/**
 * True when a request comes from another site: Sec-Fetch-Site (when the browser sends it, HTTPS and localhost only)
 * is not same-origin, or a present Origin is opaque, not an allowed host name, or not this server.
 */
export function foreignOrigin(req) {
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin') return true;
  const origin = req.get('origin');
  if (origin === undefined) return false;
  let host;
  try { host = origin && origin !== 'null' ? new URL(origin).host : ''; } catch { host = ''; }
  if (!host || !hostAllowed(hostnameOf(host))) return true;
  const allowed = new Set([req.get('host'), req.get('x-forwarded-host')].filter(Boolean));
  if (process.env.PUBLIC_URL) { try { allowed.add(new URL(process.env.PUBLIC_URL).host); } catch { /* ignore */ } }
  return !allowed.has(host);
}

export function csrfGuard({ multipartPaths = [] } = {}) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (foreignOrigin(req)) return res.status(403).json({ error: 'bad origin' });
    const marked = Boolean(req.get('x-requested-with'));
    if (req.method === 'DELETE') return next();
    const ct = (req.get('content-type') || '').toLowerCase();
    const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
    if (ct.startsWith('application/json')) return next();
    if (ct.startsWith('multipart/form-data') && multipartPaths.some((p) => (p instanceof RegExp ? p.test(req.path) : p === req.path))) {
      return marked ? next() : res.status(403).json({ error: 'X-Requested-With header required' });
    }
    if (!ct && !hasBody) return next();
    res.status(415).json({ error: 'content-type must be application/json' });
  };
}

const sessionUser = (u) => ({ email: u.email, name: u.name, picture: u.picture || '', method: u.method });

// ---------- route handlers ----------
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const attempts = new Map(); // ip → { n, first, until }
/**
 * Every failed password check from outside the LAN counts toward one shared budget, so many addresses together
 * cannot guess without limit either: past GLOBAL_FAIL_LIMIT failures in GLOBAL_WINDOW_MS, password checks from
 * outside the LAN are refused until the window ends. LAN clients neither count nor are refused (an attack from the
 * Internet never locks the owner out at home).
 */
export const GLOBAL_FAIL_LIMIT = 30;
export const GLOBAL_WINDOW_MS = 10 * 60_000;
let globalFails = { first: 0, n: 0, logged: false };

function pruneAttempts(now) {
  for (const [ip, a] of attempts) if (a.until <= now && now - a.first > WINDOW_MS) attempts.delete(ip);
}

/** Tests only. */
export function _resetLoginLimits() {
  attempts.clear();
  globalFails = { first: 0, n: 0, logged: false };
}

function globalLocked(req, now) {
  if (isLanClient(req, { strict: true })) return false;
  if (now - globalFails.first > GLOBAL_WINDOW_MS) globalFails = { first: now, n: 0, logged: false };
  return globalFails.n >= GLOBAL_FAIL_LIMIT;
}

function countGlobalFailure(req, now) {
  if (isLanClient(req, { strict: true })) return;
  if (now - globalFails.first > GLOBAL_WINDOW_MS) globalFails = { first: now, n: 0, logged: false };
  globalFails.n += 1;
}

/**
 * Reserve one password check for this request (login or the current password of a change): per address
 * (MAX_ATTEMPTS a minute) and the shared budget above. Returns null when allowed, else the 429 body; logs the
 * refusal once per lockout.
 */
function reservePasswordCheck(req, scope) {
  const now = Date.now();
  if (attempts.size > 1000) pruneAttempts(now);
  const key = `${scope}|${clientBucket(req)}`;
  let a = attempts.get(key);
  if (!a || (a.until <= now && now - a.first > WINDOW_MS)) {
    a = { n: 0, first: now, until: 0 };
    attempts.set(key, a);
  }
  if (a.until > now) {
    // Logged once per lockout window (not for every rejected hammering attempt).
    if (!a.lockLogged) { a.lockLogged = true; logActivity('auth.login_failed', { req, actor: 'anonymous', level: 'warn', data: { method: 'password', reason: 'rate_limited' } }); }
    return { error: 'too many attempts, wait a minute' };
  }
  if (globalLocked(req, now)) {
    if (!globalFails.logged) {
      globalFails.logged = true;
      logActivity('auth.login_failed', { req, actor: 'anonymous', level: 'error', data: { method: 'password', reason: 'rate_limited', scope: 'global', failures: globalFails.n } });
    }
    return { error: 'too many failed sign-ins from outside the local network, try again later' };
  }
  // Reserve the attempt *before* the async verification so parallel requests cannot bypass the limit.
  a.n += 1;
  if (a.n >= MAX_ATTEMPTS) a.until = now + WINDOW_MS;
  return { reserved: a, key };
}

export async function loginHandler(req, res) {
  const cfg = getConfig();
  if (needsSetup()) return res.status(409).json({ error: 'setup required', needsSetup: true });
  if (!cfg.auth.passwordLoginEnabled) return res.status(403).json({ error: 'password login disabled' });
  const r = reservePasswordCheck(req, 'login');
  if (r.error) return res.status(429).json({ error: r.error });
  const sec = getSecrets();
  const ok = await verifyPassword(req.body?.password, sec.passwordHash);
  if (!ok) {
    countGlobalFailure(req, Date.now());
    logActivity('auth.login_failed', { req, actor: 'anonymous', level: 'warn', data: { method: 'password', reason: 'invalid_password', attempt: r.reserved.n } });
    return res.status(401).json({ error: 'invalid password' });
  }
  if (sec.passwordIsDefault && !isLanClient(req, { strict: true })) {
    logActivity('auth.login_failed', { req, actor: 'anonymous', level: 'warn', data: { method: 'password', reason: 'default_password_remote' } });
    return res.status(403).json({ error: 'default password only allowed from the local network; change it first' });
  }
  attempts.delete(r.key);
  const user = { email: 'admin', name: 'Admin', picture: '', method: 'password' };
  // Two-step sign-in on: no session yet, the code comes next (POST /api/auth/2fa).
  if (twoFactorEnabled()) {
    beginTwoFactor(req, user);
    return res.json({ twoFactor: true });
  }
  startSession(req, user);
  logActivity('auth.login', { req, data: { method: 'password' } });
  res.json({ user: sessionUser(req.session.user) });
}

// ---------- two-step sign-in (server/twofactor.js) ----------

/**
 * The password (or Google) was right and two-step sign-in is on: this browser gets a challenge id in its session
 * cookie, and nothing else. A sign-in the server no longer accepts is dropped from the cookie first, so its leftovers
 * cannot be mistaken for the new one.
 */
function beginTwoFactor(req, user) {
  if (req.session?.user && !sessionValid(req)) {
    delete req.session.user;
    delete req.session.sid;
    delete req.session.epoch;
  }
  dropChallenge(req.session?.tfa);
  req.session.tfa = startChallenge(user);
}

/**
 * Check a code from the authenticator app or a recovery code, rate limited like a password (per address and the
 * shared budget for addresses outside the LAN; `scope` keeps the sign-in and the confirmations apart). Wrong codes
 * are logged (auth.2fa_failed). Returns { ok: true, kind, recoveryLeft } or { ok: false, status, error?, reason? }.
 */
export function checkSecondFactorLimited(req, code, { scope = '2fa', actor, method } = {}) {
  const r = reservePasswordCheck(req, scope);
  if (r.error) return { ok: false, status: 429, error: r.error };
  const out = checkSecondFactor(code);
  if (!out.ok) {
    if (out.reason !== 'off') countGlobalFailure(req, Date.now());
    logActivity('auth.2fa_failed', { req, ...(actor ? { actor } : {}), level: 'warn', data: { method, reason: out.reason, attempt: r.reserved.n } });
    return { ok: false, status: 401, reason: out.reason };
  }
  attempts.delete(r.key);
  return out;
}

/** POST /api/auth/2fa { code }: the second step of a sign-in. The session starts only here. */
export function twoFactorLoginHandler(req, res) {
  const id = req.session?.tfa;
  const ch = challengeOf(id);
  if (!ch) {
    if (req.session?.tfa) delete req.session.tfa;
    return res.status(401).json({ error: 'sign in again', code: 'challenge_expired' });
  }
  const code = typeof req.body?.code === 'string' ? req.body.code.slice(0, 40) : '';
  ch.attempts += 1;
  const r = checkSecondFactorLimited(req, code, { actor: ch.user.email, method: ch.user.method });
  if (!r.ok) {
    if (r.status === 429) return res.status(429).json({ error: r.error });
    const left = r.reason === 'off' ? 0 : Math.max(0, CHALLENGE_ATTEMPTS - ch.attempts);
    if (!left) {
      dropChallenge(id);
      delete req.session.tfa;
      return res.status(401).json({ error: 'sign in again', code: 'challenge_expired' });
    }
    return res.status(401).json({ error: 'invalid code', code: 'code_invalid', attemptsLeft: left });
  }
  dropChallenge(id);
  delete req.session.tfa;
  startSession(req, ch.user);
  logActivity('auth.login', {
    req,
    level: r.kind === 'recovery' ? 'warn' : 'info',
    data: { method: ch.user.method, twoFactor: r.kind, ...(r.kind === 'recovery' ? { recoveryLeft: r.recoveryLeft } : {}) },
  });
  res.json({ user: sessionUser(req.session.user), ...(r.kind === 'recovery' ? { recoveryLeft: r.recoveryLeft } : {}) });
}

/**
 * Turning two-step sign-in off, or new recovery codes: the admin password (sessions signed in with it), or a code
 * from the app or a recovery code from a session that signed in within RECENT_AUTH_MS. Answers 403
 * (password_required / password_incorrect / code_incorrect / reauth_required) or 429 and returns false otherwise.
 */
export async function requirePasswordOrCode(req, res, { password, code } = {}) {
  if (typeof password === 'string' && password && req.session?.user?.method === 'password') {
    const r = await confirmPassword(req, password);
    if (r.ok) return true;
    if (r.status === 429) res.status(429).json({ error: r.error });
    else res.status(403).json({ error: 'password incorrect', code: 'password_incorrect' });
    return false;
  }
  if (typeof code === 'string' && code) {
    if (!recentlyAuthenticated(req)) {
      res.status(403).json({ error: 'sign in again first', code: 'reauth_required' });
      return false;
    }
    const r = checkSecondFactorLimited(req, code.slice(0, 40), { scope: 'confirm', method: req.session.user.method });
    if (r.ok) return true;
    if (r.status === 429) res.status(429).json({ error: r.error });
    else res.status(403).json({ error: 'code incorrect', code: 'code_incorrect' });
    return false;
  }
  res.status(403).json({ error: 'confirm your password first', code: 'password_required' });
  return false;
}

export function logoutHandler(req, res) {
  if (sessionValid(req)) logActivity('auth.logout', { req });
  const sid = endSession(req);
  if (sid) authEvents.emit('logout', sid);
  res.json({ ok: true });
}

/** Revoke all sessions (including this one). */
export function logoutAllHandler(req, res) {
  if (!sessionValid(req)) return res.status(401).json({ error: 'unauthorized' });
  logActivity('auth.logout_all', { req, level: 'warn' });
  rotateSessionEpoch();
  req.session = null;
  res.json({ ok: true });
}

export function meHandler(req, res) {
  const valid = sessionValid(req);
  if (!valid && req.session?.user) dropStaleSession(req);
  const sec = getSecrets();
  res.json({
    user: valid ? sessionUser(req.session.user) : null,
    needsSetup: needsSetup(),
    mustChangePassword: Boolean(valid && req.session.user.method === 'password' && sec.passwordIsDefault),
    // Initial password came from ADMIN_PASSWORD (headless/Docker install): the panel offers to change it.
    passwordFromEnv: Boolean(valid && sec.passwordFromEnv),
    googleConfigured: google.googleConfigured(),
    // Sign in with Google (off by default on self-hosted, see google.googleLoginEnabled)
    googleLoginEnabled: google.googleLoginEnabled(getConfig()),
    // Microsoft calendars with the server's own Entra app (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET).
    microsoftConfigured: microsoft.microsoftConfigured(),
    passwordLoginEnabled: getConfig().auth.passwordLoginEnabled,
    // The password (or Google) was right and this browser still has to type the code (POST /api/auth/2fa).
    twoFactorPending: !valid && Boolean(challengeOf(req.session?.tfa)),
  });
}

/**
 * Check the admin password for a sensitive action of a signed-in session (rate limited like the login). Returns
 * true and marks the session as recently authenticated when it matches.
 */
export async function confirmPassword(req, password, { reason = 'password_confirm_wrong' } = {}) {
  const r = reservePasswordCheck(req, 'confirm');
  if (r.error) return { ok: false, status: 429, error: r.error };
  if (!(await verifyPassword(password, getSecrets().passwordHash))) {
    countGlobalFailure(req, Date.now());
    logActivity('auth.login_failed', { req, level: 'warn', data: { method: 'password', reason } });
    return { ok: false, status: 401 };
  }
  attempts.delete(r.key);
  const rec = sessionRecord(req);
  if (rec) updateSecrets(() => { rec.authAt = Date.now(); });
  return { ok: true };
}

/**
 * Sensitive actions (an export or import with private data): a sign-in within RECENT_AUTH_MS, or the admin password
 * in `password`. Returns true when allowed; otherwise answers 403 password_required (401 when the password is
 * wrong, 429 when rate limited) and returns false.
 */
export async function requireRecentAuth(req, res, password) {
  if (recentlyAuthenticated(req)) return true;
  if (typeof password === 'string' && password && req.session?.user?.method === 'password') {
    const r = await confirmPassword(req, password);
    if (r.ok) return true;
    if (r.status === 429) { res.status(429).json({ error: r.error }); return false; }
    res.status(403).json({ error: 'password incorrect', code: 'password_incorrect' });
    return false;
  }
  res.status(403).json({ error: 'confirm your password first', code: 'password_required' });
  return false;
}

export async function changePasswordHandler(req, res) {
  const { current, next } = req.body || {};
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: PASSWORD_MESSAGES[problem], code: problem });
  const check = await confirmPassword(req, current, { reason: 'password_change_wrong_current' });
  if (check.status === 429) return res.status(429).json({ error: check.error });
  if (!check.ok) return res.status(401).json({ error: 'current password incorrect' });
  const h = await hashPassword(next);
  updateSecrets((x) => { x.passwordHash = h; x.passwordIsDefault = false; delete x.passwordFromEnv; });
  // Revoke every session; this browser continues with a new one.
  rotateSessionEpoch();
  startSession(req, req.session.user);
  logActivity('auth.password_changed', { req, level: 'warn' });
  res.json({ ok: true });
}

function oauthRedirect(req, res, purpose) {
  if (!google.googleConfigured()) return res.redirect('/admin/?error=google_not_configured');
  if (purpose === 'connect' && !sessionValid(req)) return res.redirect('/admin/?error=login_required');
  const nonce = google.newNonce();
  req.session.oauthNonce = nonce;
  // The purpose is kept in the session: the one in `state` comes back from the browser and is only compared.
  req.session.oauthPurpose = purpose;
  res.redirect(google.authUrl(req, purpose, nonce));
}

export const googleLoginHandler = (req, res) =>
  google.googleLoginEnabled(getConfig()) ? oauthRedirect(req, res, 'login') : res.redirect('/admin/?error=google_login_off');
export const googleConnectHandler = (req, res) => oauthRedirect(req, res, 'connect');

/** OAuth error codes Google may send back (RFC 6749 §4.1.2.1 + Google's own); anything else → google_error. */
const GOOGLE_ERRORS = new Set(['access_denied', 'admin_policy_enforced', 'disallowed_useragent', 'org_internal', 'invalid_request',
  'unauthorized_client', 'invalid_scope', 'server_error', 'temporarily_unavailable', 'consent_required', 'interaction_required']);

export async function googleCallbackHandler(req, res) {
  const fail = (code, email = null) => {
    logActivity('auth.login_failed', { req, actor: email || 'anonymous', level: 'warn', data: { method: 'google', reason: code } });
    return res.redirect(`/admin/?error=${encodeURIComponent(code)}`);
  };
  // Failures before a code exchange can be triggered by anyone (public URL): throttle their log entries.
  const failEarly = (code) => {
    logActivityThrottled('auth.login_failed', `google|${req.ip}|${code}`, { everyMs: 60_000, perMinute: 10 },
      { req, actor: 'anonymous', level: 'warn', data: { method: 'google', reason: code } });
    return res.redirect(`/admin/?error=${encodeURIComponent(code)}`);
  };
  if (!google.googleConfigured()) return res.redirect('/admin/?error=google_not_configured');
  const state = google.parseState(req.query.state);
  const nonce = req.session?.oauthNonce;
  const purpose = req.session?.oauthPurpose;
  if (req.session) { delete req.session.oauthNonce; delete req.session.oauthPurpose; }
  if (req.query.error) {
    const e = String(req.query.error);
    return failEarly(GOOGLE_ERRORS.has(e) ? `google_${e}` : 'google_error');
  }
  if (!state || !nonce || state.n.length !== nonce.length || !crypto.timingSafeEqual(Buffer.from(state.n), Buffer.from(nonce))
    || !purpose || state.p !== purpose) {
    return failEarly('invalid_state');
  }
  if (typeof req.query.code !== 'string') return failEarly('missing_code');
  let result;
  try {
    result = await google.exchangeCode(req, req.query.code);
  } catch (err) {
    console.warn('[auth] google exchange failed:', err.message);
    return fail('google_exchange_failed');
  }
  const { profile, tokens } = result;

  if (purpose === 'connect') {
    if (!sessionValid(req)) return fail('login_required');
    if (!tokens.refresh_token && !getSecrets().google.accounts[profile.email]?.refresh_token) return fail('no_refresh_token');
    if (!String(tokens.scope || '').includes(google.CAL_SCOPE)) return fail('calendar_scope_denied');
    google.storeAccount(profile, tokens);
    logActivity('google.connected', { req, data: { email: profile.email } });
    return res.redirect(`/admin/?connected=${encodeURIComponent(profile.email)}`);
  }

  // login
  if (!google.googleLoginEnabled(getConfig())) return fail('google_login_off', profile.email);
  const allowed = getConfig().auth.allowedGoogleEmails;
  if (!allowed.includes(profile.email)) {
    if (allowed.length === 0 && sessionValid(req) && req.session.user.method === 'password') {
      updateConfig((c) => { c.auth.allowedGoogleEmails = [profile.email]; }, { reason: 'server', req });
    } else {
      return fail('email_not_allowed', profile.email);
    }
  }
  const user = { email: profile.email, name: profile.name, picture: profile.picture, method: 'google' };
  // Two-step sign-in applies to Google too: the admin opens on the code step (GET /api/auth/me twoFactorPending).
  if (twoFactorEnabled()) {
    beginTwoFactor(req, user);
    return res.redirect('/admin/');
  }
  startSession(req, user);
  logActivity('auth.login', { req, data: { method: 'google' } });
  res.redirect('/admin/');
}

// --- Microsoft calendars (server/microsoft.js) ---

/**
 * GET /auth/microsoft/connect: a signed in admin goes to Microsoft (PKCE, state in the session). `?account=<email>`
 * reconnects that linked account (Microsoft preselects it; its tokens and scopes are replaced in place), `?back=todo`
 * comes back to the Tareas page.
 */
export function microsoftConnectHandler(req, res) {
  const backTo = connectBack(req.query?.back);
  if (!microsoft.microsoftConfigured()) return res.redirect(`/admin/?error=microsoft_not_configured${backTo}`);
  if (!sessionValid(req)) return res.redirect('/admin/?error=login_required');
  const lang = LANGS.includes(getConfig().screens?.[0]?.screen?.language) ? getConfig().screens[0].screen.language : '';
  const account = typeof req.query?.account === 'string' ? req.query.account.trim().toLowerCase().slice(0, 320) : '';
  const back = typeof req.query?.back === 'string' && Object.hasOwn(CONNECT_BACK, req.query.back) ? req.query.back : '';
  res.redirect(microsoft.startConnect(req, lang, { account, back }));
}

/** GET /auth/microsoft/callback: the redirect URI registered in the Entra app (PUBLIC_URL + this path). */
export async function microsoftCallbackHandler(req, res) {
  let backTo = connectBack('');
  const back = (q) => res.redirect(`/admin/?${q}${backTo}`);
  const failEarly = (code) => {
    logActivityThrottled('auth.login_failed', `microsoft|${req.ip}|${code}`, { everyMs: 60_000, perMinute: 10 },
      { req, actor: 'anonymous', level: 'warn', data: { method: 'microsoft', reason: code } });
    return back(`error=${encodeURIComponent(code)}`);
  };
  if (!microsoft.microsoftConfigured()) return back('error=microsoft_not_configured');
  const pendingConnect = microsoft.takeConnect(req, req.query.state);
  if (pendingConnect) backTo = connectBack(pendingConnect.back);
  if (req.query.error) {
    const e = String(req.query.error);
    return failEarly(microsoft.MICROSOFT_OAUTH_ERRORS.has(e) ? `microsoft_${e}` : 'microsoft_error');
  }
  if (!pendingConnect) return failEarly('microsoft_invalid_state');
  if (!sessionValid(req)) return back('error=login_required');
  if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) return failEarly('microsoft_missing_code');
  let result;
  try {
    result = await microsoft.exchangeCode(req, req.query.code, pendingConnect.verifier);
  } catch (err) {
    const known = { scope_denied: 'microsoft_scope_denied', no_refresh_token: 'microsoft_no_refresh_token', no_email: 'microsoft_no_email' };
    console.warn('[auth] microsoft connect failed:', err.code || err.status || 'error');
    return back(`error=${known[err.code] || 'microsoft_exchange_failed'}`);
  }
  // A reconnect signed in as another account: nothing is stored (the tokens of the other account are dropped).
  if (pendingConnect.account && result.email !== pendingConnect.account) {
    return back(`error=microsoft_wrong_account&account=${encodeURIComponent(pendingConnect.account)}`);
  }
  microsoft.storeAccount(result.email, result.tokens);
  logActivity('microsoft.connected', { req, data: { email: result.email } });
  return back(`microsoft=${encodeURIComponent(result.email)}`);
}
