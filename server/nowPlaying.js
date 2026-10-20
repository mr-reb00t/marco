// "Now playing" on a self-hosted server (issue #18): Spotify accounts linked with the household's own Spotify app, and
// what each one plays now for the Sonando ahora card and the line under the clock. The parts Marco Cloud shares
// (endpoints, mapping, refresh policy, art tokens) are in core/nowPlayingCore.js; this file does the network part,
// the tokens and the caches.
//
// - The app: secrets.spotify.clientId and clientSecret (data/secrets.json, like every other secret). The secret is
//   never sent back to the browser, never logged and never reaches a display. A new Client ID forgets the accounts:
//   their tokens belong to the old app.
// - Accounts: secrets.spotify.accounts[<id>] = { name, user, access_token, refresh_token, expiry, scope, connectedAt,
//   status? }. The id (sp_...) is random and is all a screen or a card ever names; the Spotify user id is kept only to
//   reconnect an account in place.
// - Connect: authorization code with PKCE; the state, the verifier and the Redirect URI live in the admin's session
//   (single use, 10 minutes). A server on plain http in the home network uses a loopback Redirect URI and the owner
//   pastes the address the browser ends on (core spotifyRedirect, POST /api/admin/spotify/finish).
// - Reading: only on a display's demand, one entry per account shared by every screen: Spotify is asked at most every
//   10 s while something plays (20 s while nothing does), a 429 waits for its Retry-After and failures back off up to
//   5 minutes. Nothing is read for an account no connected display shows.
// - Covers: fetched from Spotify's image hosts only, for the tracks on the entries now, and kept in memory while they
//   are (at most 12). Displays get them from GET /api/display/nowplaying/art/:token.
import crypto from 'node:crypto';
import { request } from './lib/http.js';
import { getSecrets, updateSecrets } from './store.js';
import { publicUrl } from './google.js';
import { sniffImage } from './core/imageInfo.js';
import { retryAfterMs } from './core/pricesCore.js';
import {
  artUrls, codeExchangeBody, displayItem, entryDue, NOW_PLAYING_ART_MAX_BYTES, NOW_PLAYING_ART_TOKEN_RE, NOW_PLAYING_MAX_ACCOUNTS,
  NOW_PLAYING_TIMING, nextEntry, nextPollSec, newAccountId, refreshBody, SPOTIFY_AUTH_ERRORS, SPOTIFY_CLIENT_ID_RE, SPOTIFY_ME_URL,
  SPOTIFY_NOW_URL, SPOTIFY_SCOPES, SPOTIFY_SECRET_RE, SPOTIFY_TOKEN_URL, spotifyAccountName, spotifyAuthUrl, spotifyBasicAuth, spotifyRedirect,
} from './core/nowPlayingCore.js';

const TIMEOUT_MS = 10_000;
const CONNECT_TTL_MS = 10 * 60_000;
const ART_KEEP = 12;

/** A failed Spotify call. code 'auth': the account has to be connected again (or the app's keys are wrong). */
export class SpotifyError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

const sp = () => getSecrets().spotify || {};
const accounts = () => sp().accounts || {};
/** The household's Spotify app is saved (both keys). */
export const spotifyConfigured = () => Boolean(sp().clientId && sp().clientSecret);
/** The Redirect URI of this server (core spotifyRedirect) as the admin is reached now. */
export const redirectFor = (req) => spotifyRedirect(publicUrl(req));

/** Linked accounts as the admin lists them (no token, no Spotify user id). */
export function listAccounts() {
  return Object.entries(accounts()).map(([id, a]) => ({ id, name: String(a?.name || 'Spotify'), connectedAt: String(a?.connectedAt || ''), status: a?.status === 'reconnect' ? 'reconnect' : 'ok' }));
}
export const accountIds = () => Object.keys(accounts());

/** GET /api/admin/spotify (SpotifyStatus). */
export function spotifyStatus(req) {
  const { redirectUri, paste } = redirectFor(req);
  return { clientId: String(sp().clientId || ''), secretSet: Boolean(sp().clientSecret), redirectUri, paste, accounts: listAccounts(), max: NOW_PLAYING_MAX_ACCOUNTS };
}

/**
 * Saves the app. `clientId` '' removes the app and every account. A Client ID other than the stored one needs its
 * secret and forgets the accounts (their tokens were issued to the other app). An empty `clientSecret` keeps the stored
 * one. Returns { ok, error?, dropped } (dropped: accounts forgotten).
 */
export function saveApp({ clientId, clientSecret }) {
  const id = String(clientId ?? '').trim();
  const secret = String(clientSecret ?? '').trim();
  const cur = sp();
  if (!id) {
    const dropped = Object.keys(cur.accounts || {}).length;
    updateSecrets((s) => { delete s.spotify; });
    forgetAll();
    return { ok: true, dropped };
  }
  if (!SPOTIFY_CLIENT_ID_RE.test(id)) return { ok: false, error: 'client_id_invalid' };
  if (secret && !SPOTIFY_SECRET_RE.test(secret)) return { ok: false, error: 'client_secret_invalid' };
  const sameApp = cur.clientId === id;
  if (!secret && !(sameApp && cur.clientSecret)) return { ok: false, error: 'client_secret_required' };
  const dropped = sameApp ? 0 : Object.keys(cur.accounts || {}).length;
  updateSecrets((s) => {
    s.spotify = { clientId: id, clientSecret: secret || cur.clientSecret, accounts: sameApp ? cur.accounts || {} : {} };
  });
  if (!sameApp) forgetAll();
  return { ok: true, dropped };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Starts a connect: state, PKCE verifier and Redirect URI in the session; returns Spotify's sign-in URL. */
export function startConnect(req) {
  const state = b64url(crypto.randomBytes(32));
  const verifier = b64url(crypto.randomBytes(48));
  const { redirectUri } = redirectFor(req);
  req.session.spOauth = { state, verifier, redirectUri, at: Date.now() };
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return spotifyAuthUrl({ clientId: sp().clientId, redirectUri, state, challenge });
}

/** Takes the session's pending connect (single use). Null when missing, older than 10 minutes, or another state. */
export function takeConnect(req, state) {
  const p = req.session?.spOauth;
  if (req.session) delete req.session.spOauth;
  if (!p || typeof state !== 'string' || typeof p.state !== 'string' || Date.now() - p.at > CONNECT_TTL_MS) return null;
  if (state.length !== p.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(p.state))) return null;
  return p;
}

async function tokenRequest(params) {
  const app = sp();
  if (!app.clientId || !app.clientSecret) throw new SpotifyError('Spotify app not set', 0, 'auth');
  let res;
  try {
    res = await request(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { authorization: spotifyBasicAuth(app.clientId, app.clientSecret), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      throwOnError: false,
      timeout: TIMEOUT_MS,
    });
  } catch {
    throw new SpotifyError('Spotify did not answer', 0, 'unavailable');
  }
  let json;
  try { json = JSON.parse(res.text); } catch { json = {}; }
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error.slice(0, 40) : '';
    // Only Spotify's short error code goes into the message: never a token or the app's keys.
    throw new SpotifyError(`Spotify token error: ${code || `HTTP ${res.status}`}`, res.status, SPOTIFY_AUTH_ERRORS.has(code) ? 'auth' : res.status >= 500 || res.status === 429 ? 'unavailable' : '');
  }
  if (typeof json.access_token !== 'string' || !json.access_token) throw new SpotifyError('Spotify token error: no access token', res.status);
  return json;
}

async function apiGet(url, token) {
  try {
    return await request(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, throwOnError: false, timeout: TIMEOUT_MS });
  } catch {
    return { status: 0, ok: false, headers: {}, text: '' };
  }
}

/**
 * Code + verifier to an account: the tokens and who signed in (GET /v1/me, for the name). Throws SpotifyError with
 * code no_refresh_token, scope_denied, unavailable or ''.
 */
export async function exchangeCode(code, verifier, redirectUri) {
  const tok = await tokenRequest(codeExchangeBody({ code, redirectUri, verifier }));
  if (!tok.refresh_token) throw new SpotifyError('No refresh token', 0, 'no_refresh_token');
  const granted = String(tok.scope || '').split(/\s+/);
  if (!granted.includes('user-read-currently-playing') && !granted.includes('user-read-playback-state')) throw new SpotifyError('Scope not granted', 0, 'scope_denied');
  const me = await apiGet(SPOTIFY_ME_URL, tok.access_token);
  let json = {};
  try { json = JSON.parse(me.text); } catch { /* no name */ }
  if (!me.ok || typeof json.id !== 'string' || !json.id) throw new SpotifyError(`Spotify profile: HTTP ${me.status}`, me.status, me.status ? '' : 'unavailable');
  return { user: json.id.slice(0, 128), name: spotifyAccountName(json), tokens: tok };
}

/**
 * Saves (or replaces) an account. The same Spotify user keeps its id, so the cards and screens that show it keep
 * working after a reconnect. Returns the id, or null when the household already has the most accounts.
 */
export function storeAccount({ user, name, tokens }) {
  const found = Object.entries(accounts()).find(([, a]) => a?.user === user)?.[0];
  if (!found && Object.keys(accounts()).length >= NOW_PLAYING_MAX_ACCOUNTS) return null;
  let id = found;
  while (!id || (!found && accounts()[id])) id = newAccountId(crypto.randomBytes(16));
  updateSecrets((s) => {
    s.spotify.accounts ??= {};
    s.spotify.accounts[id] = {
      name, user,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
      scope: String(tokens.scope || SPOTIFY_SCOPES).slice(0, 300),
      connectedAt: new Date().toISOString(),
    };
  });
  entries.delete(id);
  return id;
}

/** Deletes an account's tokens (Spotify has no revoke call: access is removed at spotify.com/account/apps). */
export function removeAccount(id) {
  if (!Object.hasOwn(accounts(), id)) return false;
  updateSecrets((s) => { delete s.spotify.accounts[id]; });
  entries.delete(id);
  pruneArt();
  return true;
}

const refreshing = new Map();
/** A valid access token, refreshed when it expires within 60 s. invalid_grant marks the account 'reconnect'. */
async function accessToken(id) {
  const a = accounts()[id];
  if (!a) throw new SpotifyError('unknown account', 0, 'auth');
  if (a.status === 'reconnect') throw new SpotifyError('reconnect the account', 0, 'auth');
  if (a.access_token && a.expiry > Date.now() + 60_000) return a.access_token;
  if (!refreshing.has(id)) {
    refreshing.set(id, (async () => {
      try {
        const tok = await tokenRequest(refreshBody(a.refresh_token));
        updateSecrets((s) => {
          const x = s.spotify?.accounts?.[id];
          if (!x) return;
          x.access_token = tok.access_token;
          x.expiry = Date.now() + (Number(tok.expires_in) || 3600) * 1000;
          // Spotify sometimes hands out a new refresh token: the new one replaces the stored one
          if (tok.refresh_token) x.refresh_token = tok.refresh_token;
        });
        return tok.access_token;
      } catch (err) {
        if (err.code === 'auth') updateSecrets((s) => { const x = s.spotify?.accounts?.[id]; if (x) x.status = 'reconnect'; });
        throw err;
      } finally {
        refreshing.delete(id);
      }
    })());
  }
  return refreshing.get(id);
}

/** One currently-playing call for an account, as core nextEntry reads it. A 401 drops the token and tries once more. */
async function readSpotify(id) {
  let token;
  try {
    token = await accessToken(id);
  } catch (err) {
    return { status: 0, auth: err.code === 'auth' };
  }
  let res = await apiGet(SPOTIFY_NOW_URL, token);
  if (res.status === 401) {
    updateSecrets((s) => { const x = s.spotify?.accounts?.[id]; if (x) x.expiry = 0; });
    try {
      res = await apiGet(SPOTIFY_NOW_URL, await accessToken(id));
    } catch (err) {
      return { status: 0, auth: err.code === 'auth' };
    }
  }
  let json = null;
  if (res.status === 200) {
    try { json = JSON.parse(res.text); } catch { return { status: 0 }; }
  }
  return { status: res.status, json, retryAfterMs: retryAfterMs(res.headers?.['retry-after']) };
}

/** Entries by account id (core nextEntry), shared by every screen. */
const entries = new Map();
const reading = new Map();
let clock = () => Date.now();

/** What an account plays (its entry), read again first when it is due. */
async function entryOf(id) {
  const now = clock();
  const e = entries.get(id);
  if (!entryDue(e, now)) return e;
  if (!reading.has(id)) {
    reading.set(id, (async () => {
      try {
        const next = nextEntry(entries.get(id), await readSpotify(id), clock());
        if (Object.hasOwn(accounts(), id)) entries.set(id, next);
        pruneArt();
        return next;
      } finally {
        reading.delete(id);
      }
    })());
  }
  return reading.get(id);
}

/** GET /api/display/nowplaying for `ids` (already checked): { items, next }. */
export async function nowPlayingFor(ids) {
  const items = {};
  const list = await Promise.all(ids.map(async (id) => {
    if (!Object.hasOwn(accounts(), id)) return null;
    try {
      return await entryOf(id);
    } catch (err) {
      console.warn('[spotify]', err?.message);
      return null;
    }
  }));
  const now = clock();
  ids.forEach((id, i) => { items[id] = displayItem(list[i], now); });
  return { items, next: nextPollSec(list, now) };
}

/** The admin's test: what an account plays now (a fresh read, unless one ran in the last 3 s). */
export async function testAccount(id) {
  if (!Object.hasOwn(accounts(), id)) return null;
  const e = entries.get(id);
  if (e && clock() - e.at > 3000) entries.set(id, { ...e, until: 0 });
  const got = await entryOf(id);
  return { ok: !got?.error, item: displayItem(got, clock()), ...(got?.error ? { error: got.error } : {}) };
}

// ---- covers ----------------------------------------------------------------------------------------------------

/** token → { type, buf } | { promise } */
const art = new Map();

/** Drops the covers no entry shows any more. */
function pruneArt() {
  const keep = artUrls([...entries.values()]);
  for (const k of art.keys()) if (!keep.has(k)) art.delete(k);
  while (art.size > ART_KEEP) art.delete(art.keys().next().value);
}

let artFetch = (url, init) => fetch(url, init);

async function loadArt(url) {
  const r = await artFetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'image/jpeg,image/png,image/webp' } });
  if (!r.ok) throw new SpotifyError(`cover: HTTP ${r.status}`, r.status);
  const len = Number(r.headers.get('content-length'));
  if (Number.isFinite(len) && len > NOW_PLAYING_ART_MAX_BYTES) throw new SpotifyError('cover too large');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > NOW_PLAYING_ART_MAX_BYTES) throw new SpotifyError('cover too large');
  const type = sniffImage(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
  if (!type) throw new SpotifyError('cover is not an image');
  return { type, buf };
}

/**
 * The cover of `token`, when it belongs to what one of `ids` plays now (else null: the route answers 404). Fetched
 * once per cover, then served from memory while it is on an entry.
 */
export async function artImage(token, ids) {
  if (!NOW_PLAYING_ART_TOKEN_RE.test(String(token))) return null;
  const url = artUrls(ids.map((id) => entries.get(id))).get(token);
  if (!url) return null;
  let hit = art.get(token);
  if (!hit) {
    const promise = loadArt(url).then((v) => {
      if (art.get(token)?.promise === promise) art.set(token, v);
      return v;
    }, (err) => {
      art.delete(token);
      throw err;
    });
    hit = { promise };
    art.set(token, hit);
    pruneArt();
  }
  return hit.promise ? hit.promise : hit;
}

function forgetAll() {
  entries.clear();
  art.clear();
}

/** Tests: a clock, the cover fetch, and empty caches. */
export function resetNowPlaying({ now = null, fetchArt = null } = {}) {
  clock = now || (() => Date.now());
  artFetch = fetchArt || ((url, init) => fetch(url, init));
  forgetAll();
  refreshing.clear();
  reading.clear();
}

export { NOW_PLAYING_TIMING };
