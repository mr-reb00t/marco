// "Now playing" (issue #18): what a linked music account plays now, for the Sonando ahora card and the line under the
// clock. Pure, so Marco Cloud runs the same file: the provider's endpoints and scopes, the authorize URL, the mapping
// of its answer, the refresh policy of one account's entry, the art tokens and what a display gets. The HTTP calls,
// the token storage and the caches live in each server (server/nowPlaying.js here, spotify.ts in Marco Cloud).
//
// Providers: only Spotify for now. Each household links its own Spotify app (Client ID and Client Secret from
// https://developer.spotify.com/dashboard), so every household spends its own API quota. An account is known to the
// screens by an opaque id (sp_...); its tokens, its Spotify user id and its name stay on the server.
//
// Scopes: user-read-currently-playing user-read-playback-state (read only: Marco never controls playback).
import { NOW_PLAYING_ACCOUNT_RE, nowPlayingAccounts } from './canvasCore.js';

export { NOW_PLAYING_ACCOUNT_RE, nowPlayingAccounts };

/** Providers a "now playing" account can come from. A later one adds its id here and its own mapping below. */
export const NOW_PLAYING_PROVIDERS = ['spotify'];

export const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API = 'https://api.spotify.com/v1';
/** Episodes too (without additional_types a podcast answers with an empty item). */
export const SPOTIFY_NOW_URL = `${SPOTIFY_API}/me/player/currently-playing?additional_types=track,episode`;
export const SPOTIFY_ME_URL = `${SPOTIFY_API}/me`;
export const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state';
export const SPOTIFY_CALLBACK_PATH = '/auth/spotify/callback';
/** Where the owner removes Marco's access on Spotify's side (Marco has no revoke call for these tokens). */
export const SPOTIFY_APPS_URL = 'https://www.spotify.com/account/apps/';
export const SPOTIFY_DASHBOARD_URL = 'https://developer.spotify.com/dashboard';
/** A Client ID and a Client Secret are 32 hexadecimal characters. */
export const SPOTIFY_CLIENT_ID_RE = /^[0-9a-f]{32}$/i;
export const SPOTIFY_SECRET_RE = /^[0-9a-f]{32}$/i;
/** Accounts one household may link. */
export const NOW_PLAYING_MAX_ACCOUNTS = 6;
/** Error codes Spotify may send back to the Redirect URI; each becomes spotify_<code>, anything else spotify_error. */
export const SPOTIFY_OAUTH_ERRORS = new Set(['access_denied', 'invalid_request', 'invalid_scope', 'unauthorized_client', 'server_error', 'temporarily_unavailable']);
/** Token endpoint errors that mean the account has to be connected again (or the app's keys are wrong). */
export const SPOTIFY_AUTH_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

/**
 * How often one account is read (ms): every 10 s while something plays (sooner when the track ends first), every
 * 20 s while nothing does, and after a failure from 30 s doubling up to 5 minutes. A 429 waits for its Retry-After.
 * An entry older than `stale` is not shown (the server stopped reading it, or it kept failing).
 */
export const NOW_PLAYING_TIMING = { playing: 10_000, idle: 20_000, soonest: 2_000, errorMin: 30_000, errorMax: 300_000, rateLimited: 30_000, stale: 120_000 };
/** The covers a display may ask for: Spotify's own image hosts only. */
const ART_HOST_RE = /^(?:i\.scdn\.co|mosaic\.scdn\.co|image-cdn-[a-z0-9-]+\.spotifycdn\.com|[a-z0-9-]+\.scdn\.co)$/;
export const NOW_PLAYING_ART_TOKEN_RE = /^[0-9a-f]{16}$/;
export const NOW_PLAYING_ART_MAX_BYTES = 512 * 1024;
/** The cover size asked for (Spotify sends 640, 300 and 64 px): the smallest one at least this wide. */
const ART_MIN_WIDTH = 240;

/**
 * The authorize URL of a connect: code flow with PKCE (S256). show_dialog: Spotify asks again even when the app was
 * allowed before, so a second family member can sign in with their own account in the same browser.
 */
export function spotifyAuthUrl({ clientId, redirectUri, state, challenge }) {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    show_dialog: 'true',
  });
  return `${SPOTIFY_AUTH_URL}?${q}`;
}

/** The Authorization header of the token endpoint (the app's own Client ID and Client Secret). */
export const spotifyBasicAuth = (clientId, secret) => `Basic ${btoa(`${clientId}:${secret}`)}`;
/** Form fields of the code exchange. */
export const codeExchangeBody = ({ code, redirectUri, verifier }) => ({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
/** Form fields of a refresh. */
export const refreshBody = (refreshToken) => ({ grant_type: 'refresh_token', refresh_token: refreshToken });

/**
 * The Redirect URI of a server reached at `base` (its public address, no trailing slash) and whether the owner pastes
 * the address back (SpotifyStatus.paste). Spotify accepts https addresses and loopback ones over http
 * (http://127.0.0.1:PORT, http://[::1]:PORT), never "localhost". A server on plain http in the home network gets the
 * loopback address on its own port: Spotify sends the browser there, the page does not load, and the owner pastes that
 * address into the admin, which finishes the connect on the server.
 */
export function spotifyRedirect(base) {
  let u;
  try {
    u = new URL(base);
  } catch {
    return { redirectUri: `http://127.0.0.1:3000${SPOTIFY_CALLBACK_PATH}`, paste: true };
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol === 'https:') return { redirectUri: `${u.origin}${u.pathname.replace(/\/+$/, '')}${SPOTIFY_CALLBACK_PATH}`, paste: false };
  if (host === '127.0.0.1' || host === '::1') return { redirectUri: `${u.origin}${SPOTIFY_CALLBACK_PATH}`, paste: false };
  const port = u.port || '80';
  return { redirectUri: `http://127.0.0.1:${port}${SPOTIFY_CALLBACK_PATH}`, paste: true };
}

/**
 * The code and state of a pasted address (paste mode): any address whose query has them (the loopback page, or the
 * server's own callback). `error` when Spotify said no. Null when it is not such an address.
 */
export function pastedCallback(text) {
  const s = String(text ?? '').trim();
  if (!s || s.length > 4096) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!u.pathname.endsWith(SPOTIFY_CALLBACK_PATH)) return null;
  const state = u.searchParams.get('state') ?? '';
  const code = u.searchParams.get('code') ?? '';
  const error = u.searchParams.get('error') ?? '';
  if (!state || (!code && !error)) return null;
  return { state, code, error };
}

/** The name an account is shown by in the admin: its Spotify display name, else its user id. */
export function spotifyAccountName(me) {
  const n = typeof me?.display_name === 'string' && me.display_name.trim() ? me.display_name : typeof me?.id === 'string' ? me.id : '';
  return clean(n, 60) || 'Spotify';
}

// ------------------------------------------------------------------------------------------------- the answer

// eslint-disable-next-line no-control-regex
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const secs = (ms) => (Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 100) / 10 : null);

/** True for a cover on one of Spotify's image hosts, over https. */
export function artAllowed(url) {
  if (typeof url !== 'string' || url.length > 512) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && ART_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

/** The cover to show: the smallest image at least ART_MIN_WIDTH wide (else the largest), on an allowed host; '' = none. */
export function pickArt(images) {
  const list = (Array.isArray(images) ? images : []).filter((i) => artAllowed(i?.url));
  if (!list.length) return '';
  const w = (i) => (Number.isFinite(i.width) ? i.width : 0);
  const big = list.filter((i) => w(i) >= ART_MIN_WIDTH).sort((a, b) => w(a) - w(b));
  return (big[0] ?? list.sort((a, b) => w(b) - w(a))[0]).url;
}

/** Short, stable token for a cover address (FNV-1a twice): what a display asks for instead of the address. */
export function artToken(url) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  const s = String(url);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/**
 * What Spotify's currently-playing answer says, or null when nothing should show: 204 (no device), paused, an ad, an
 * unknown item, no title. A song: its title, its artists and its album; a podcast episode: the episode, the show and
 * the publisher. `artUrl` stays on the server (the display gets a token).
 */
export function mapSpotifyNow(status, json) {
  if (status === 204 || !json || typeof json !== 'object') return null;
  if (json.is_playing !== true) return null;
  const it = json.item;
  if (!it || typeof it !== 'object') return null;
  const type = json.currently_playing_type ?? it.type;
  let out;
  if (type === 'track' || it.type === 'track') {
    const artists = (Array.isArray(it.artists) ? it.artists : []).map((a) => clean(a?.name, 80)).filter(Boolean);
    out = { kind: 'track', title: clean(it.name, 200), artist: clean(artists.join(', '), 200), album: clean(it.album?.name, 200), artUrl: pickArt(it.album?.images) };
  } else if (type === 'episode' || it.type === 'episode') {
    out = { kind: 'episode', title: clean(it.name, 200), artist: clean(it.show?.name, 200), album: clean(it.show?.publisher, 200), artUrl: pickArt(Array.isArray(it.images) && it.images.length ? it.images : it.show?.images) };
  } else return null;
  if (!out.title) return null;
  const duration = secs(Number(it.duration_ms));
  const progress = secs(Number(json.progress_ms));
  return { provider: 'spotify', ...out, progress: progress === null ? null : duration ? Math.min(progress, duration) : progress, duration: duration || null };
}

// ------------------------------------------------------------------------------------------------- one account's entry

/**
 * The entry of one account after a read. `res`: { status, json?, retryAfterMs? } of the currently-playing call (the
 * server already refreshed the token and tried once more after a 401; status 0 = the network failed). Entry:
 * { at, value, fails, until, error }: `value` what plays (mapSpotifyNow) as of `at`, `until` when to read it again,
 * `error` '' or a short code (auth, rate_limited, unavailable). A failure keeps the last value until it is stale.
 */
export function nextEntry(prev, res, now) {
  const T = NOW_PLAYING_TIMING;
  const status = Number(res?.status) || 0;
  if (status === 200 || status === 204) {
    const value = mapSpotifyNow(status, res.json);
    let wait = value ? T.playing : T.idle;
    // the track ends before the next read: read again just after it does, so the next one shows at once
    if (value?.duration && value.progress !== null) wait = Math.min(wait, Math.max(T.soonest, (value.duration - value.progress) * 1000 + 1500));
    return { at: now, value, fails: 0, until: now + wait, error: '' };
  }
  const keep = prev && prev.value && now - prev.at < T.stale ? { at: prev.at, value: prev.value } : { at: prev?.at ?? 0, value: null };
  if (status === 429) {
    const wait = Number.isFinite(res.retryAfterMs) && res.retryAfterMs > 0 ? Math.min(3600_000, res.retryAfterMs) : T.rateLimited;
    return { ...keep, fails: prev?.fails ?? 0, until: now + wait, error: 'rate_limited' };
  }
  const fails = (prev?.fails ?? 0) + 1;
  const wait = Math.min(T.errorMax, T.errorMin * 2 ** Math.min(8, fails - 1));
  return { ...keep, fails, until: now + wait, error: status === 401 || status === 403 || res?.auth ? 'auth' : 'unavailable' };
}

/** The entry should be read again (none yet, or its time came). */
export const entryDue = (entry, now) => !entry || now >= (entry.until ?? 0);

/**
 * What a display gets for one account (NowPlayingData), or null: nothing plays, or the last read is stale. The
 * progress is moved on to `now` (the display moves it on from there by itself).
 */
export function displayItem(entry, now) {
  const v = entry?.value;
  if (!v || now - entry.at > NOW_PLAYING_TIMING.stale) return null;
  let progress = v.progress;
  if (progress !== null) {
    progress += Math.max(0, now - entry.at) / 1000;
    if (v.duration) progress = Math.min(progress, v.duration);
    progress = Math.round(progress * 10) / 10;
  }
  return { provider: v.provider, kind: v.kind, title: v.title, artist: v.artist, album: v.album, art: v.artUrl ? artToken(v.artUrl) : '', playing: true, progress, duration: v.duration };
}

/** Seconds until a display should ask again: the soonest entry's next read (3 to 30 s), 10 s when nothing is known. */
export function nextPollSec(entries, now) {
  const times = (entries ?? []).filter(Boolean).map((e) => (e.until ?? 0) - now);
  if (!times.length) return 10;
  return Math.max(3, Math.min(30, Math.ceil(Math.min(...times) / 1000) + 1));
}

/** The cover addresses the entries name now, by token (the art route serves only these). */
export function artUrls(entries) {
  const out = new Map();
  for (const e of entries ?? []) if (e?.value?.artUrl) out.set(artToken(e.value.artUrl), e.value.artUrl);
  return out;
}

/**
 * The accounts a display request may read: the ones it asks for (`asked`, a comma separated list, at most 8) that are
 * in `allowed`. A display key or a paired TV is allowed its screen's accounts (nowPlayingAccounts); the admin's
 * preview (a signed in session) every linked account, so a card not saved yet shows its track too.
 */
export function askedAccounts(asked, allowed) {
  const set = new Set(allowed);
  const list = String(asked ?? '').split(',').map((x) => x.trim()).filter((x) => NOW_PLAYING_ACCOUNT_RE.test(x));
  return [...new Set(list)].filter((x) => set.has(x)).slice(0, 8);
}

/** A new account id from random bytes (Uint8Array of at least 8): sp_ and 16 base-36 characters. */
export function newAccountId(bytes) {
  let s = '';
  for (const b of bytes) s += (b % 36).toString(36);
  return `sp_${s.slice(0, 16).padEnd(10, '0')}`;
}
