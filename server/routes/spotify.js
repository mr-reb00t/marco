// "Now playing" with Spotify (server/nowPlaying.js, core/nowPlayingCore.js):
//   Browser redirects (app.js):
//     GET /auth/spotify/connect      a signed in admin goes to Spotify (PKCE, state in the session)
//     GET /auth/spotify/callback     the Redirect URI: back to /admin/?spotify=<id>#/spotify, or ?error=spotify_<code>
//   spotifyAdminRouter() mounted at /api/admin (session, CSRF guard):
//     GET    /spotify                    SpotifyStatus: the app (Client ID, secretSet), the Redirect URI, the accounts
//     PUT    /spotify/app                { clientId, clientSecret? } ('' clientId removes the app and its accounts)
//     POST   /spotify/finish             { url }: the address the browser landed on after Spotify (paste mode)
//     GET    /spotify/accounts/:id/now   SpotifyNowResponse: what the account plays now (the admin's test)
//     DELETE /spotify/accounts/:id       forgets the account's tokens ({ ok, manageAccess })
//   spotifyDisplayRouter() mounted at /api (displayAuth already ran for /api/display):
//     GET /display/nowplaying?accounts=sp_a,sp_b   DisplayNowPlayingResponse for the accounts this display may read
//     GET /display/nowplaying/art/:token           the cover of a track one of them plays now
// A display key or a paired TV reads only the accounts its own screen shows (core nowPlayingAccounts), nothing while
// the screen is private; the admin's preview (a signed in session) may read every linked account. No token, Spotify
// user id or address ever reaches a display.
import { Router } from 'express';
import { requireAuth, sessionValid } from '../auth.js';
import { logActivity, logActivityThrottled } from '../activity.js';
import { getConfig } from '../store.js';
import { requestScreen } from '../displayAccess.js';
import { screenPrivacy } from '../privacy.js';
import { askedAccounts, nowPlayingAccounts, pastedCallback, SPOTIFY_APPS_URL, SPOTIFY_OAUTH_ERRORS } from '../core/nowPlayingCore.js';
import { langFromHeader, t } from '../core/lib/i18n.js';
import * as np from '../nowPlaying.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const BACK = '#/spotify';

/** Codes of a failed connect, as /admin/?error= carries them (App.tsx spotifyErrorMessage). */
const EXCHANGE_ERRORS = { no_refresh_token: 'spotify_no_refresh_token', scope_denied: 'spotify_scope_denied', unavailable: 'spotify_unavailable', app: 'spotify_app_refused' };

/** GET /auth/spotify/connect */
export function spotifyConnectHandler(req, res) {
  if (!sessionValid(req)) return res.redirect('/admin/?error=login_required');
  if (!np.spotifyConfigured()) return res.redirect(`/admin/?error=spotify_not_configured${BACK}`);
  res.set('cache-control', 'no-store');
  res.redirect(np.startConnect(req));
}

/**
 * Finishes a connect from the code and state Spotify sent back. Returns { id } or { error } (a spotify_* code). Used by
 * the callback and by the pasted address.
 */
async function finish(req, { state, code, error }) {
  const fail = (c) => {
    logActivityThrottled('auth.login_failed', `spotify|${req.ip}|${c}`, { everyMs: 60_000, perMinute: 10 },
      { req, actor: 'anonymous', level: 'warn', data: { method: 'spotify', reason: c } });
    return { error: c };
  };
  const pending = np.takeConnect(req, state);
  if (error) return fail(SPOTIFY_OAUTH_ERRORS.has(error) ? `spotify_${error}` : 'spotify_error');
  if (!pending) return fail('spotify_invalid_state');
  if (!sessionValid(req)) return { error: 'login_required' };
  if (typeof code !== 'string' || !code || code.length > 4096) return fail('spotify_missing_code');
  let got;
  try {
    got = await np.exchangeCode(code, pending.verifier, pending.redirectUri);
  } catch (err) {
    console.warn('[auth] spotify connect failed:', err.code || err.status || 'error');
    return { error: EXCHANGE_ERRORS[err.code] || 'spotify_exchange_failed' };
  }
  const stored = np.storeAccount(got);
  if (stored.error) return { error: stored.error === 'too_many' ? 'spotify_too_many_accounts' : 'spotify_not_configured' };
  logActivity('spotify.connected', { req, data: { name: got.name } });
  return { id: stored.id, name: got.name };
}

/**
 * GET /auth/spotify/callback. A browser that comes here without the admin's session (paste mode: the loopback address
 * on the server itself, where the admin's cookie is not sent) gets a short page that says to paste the address.
 */
export async function spotifyCallbackHandler(req, res) {
  res.set('cache-control', 'no-store');
  const q = { state: String(req.query.state ?? ''), code: typeof req.query.code === 'string' ? req.query.code : '', error: typeof req.query.error === 'string' ? req.query.error : '' };
  if ((q.code || q.error) && !sessionValid(req)) {
    const l = langFromHeader(req.headers['accept-language']);
    return res.type('html').send(`<!doctype html><html lang="${l}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marco</title><p style="font:16px/1.5 system-ui,sans-serif;margin:24px">${t('spotifyPaste', l)}</p></html>\n`);
  }
  const out = await finish(req, q);
  if (out.error) return res.redirect(`/admin/?error=${encodeURIComponent(out.error)}${BACK}`);
  res.redirect(`/admin/?spotify=${encodeURIComponent(out.id)}${BACK}`);
}

export function spotifyAdminRouter() {
  const r = Router();
  r.use('/spotify', requireAuth, (req, res, next) => {
    res.set('cache-control', 'no-store');
    next();
  });
  r.get('/spotify', (req, res) => res.json(np.spotifyStatus(req)));

  r.put('/spotify/app', (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof b.clientId !== 'string' || b.clientId.length > 64 || (b.clientSecret !== undefined && (typeof b.clientSecret !== 'string' || b.clientSecret.length > 64))) {
      return res.status(400).json({ error: 'clientId and clientSecret: strings' });
    }
    const before = np.spotifyStatus(req).clientId;
    const out = np.saveApp(b);
    if (!out.ok) return res.status(400).json({ error: out.error });
    const removed = !b.clientId.trim();
    logActivity(removed ? 'spotify.app_removed' : 'spotify.app_saved', { req, data: { ...(removed || before !== b.clientId.trim() ? { accounts: out.dropped } : {}) } });
    res.json(np.spotifyStatus(req));
  });

  r.post('/spotify/finish', wrap(async (req, res) => {
    const got = pastedCallback(req.body?.url);
    if (!got) return res.status(400).json({ error: 'spotify_bad_address' });
    const out = await finish(req, got);
    if (out.error) return res.status(out.error === 'login_required' ? 401 : 400).json({ error: out.error });
    res.json({ ok: true, id: out.id, ...np.spotifyStatus(req) });
  }));

  r.get('/spotify/accounts/:id/now', wrap(async (req, res) => {
    const out = await np.testAccount(String(req.params.id));
    if (!out) return res.status(404).json({ error: 'not found' });
    res.json(out);
  }));

  r.delete('/spotify/accounts/:id', (req, res) => {
    const id = String(req.params.id);
    const name = np.listAccounts().find((a) => a.id === id)?.name ?? '';
    if (!np.removeAccount(id)) return res.status(404).json({ error: 'not found' });
    logActivity('spotify.removed', { req, data: { name } });
    res.json({ ok: true, manageAccess: SPOTIFY_APPS_URL });
  });
  return r;
}

/** The accounts this request may read (see the top of this file), or null while its screen is private. */
function readable(req) {
  const cfg = getConfig();
  const { screen } = requestScreen(cfg, req);
  if (screenPrivacy(cfg, screen).active) return null;
  if (req.displayAccess?.via === 'session') return np.accountIds();
  return nowPlayingAccounts(screen, { tz: cfg.datetime?.timezone || 'UTC' });
}

export function spotifyDisplayRouter() {
  const r = Router();
  r.get('/display/nowplaying', wrap(async (req, res) => {
    res.set('cache-control', 'no-store');
    const allowed = readable(req);
    if (!allowed) return res.status(403).json({ error: 'private' });
    res.json(await np.nowPlayingFor(askedAccounts(req.query.accounts, allowed)));
  }));

  r.get('/display/nowplaying/art/:token', wrap(async (req, res) => {
    const allowed = readable(req);
    if (!allowed) return res.status(403).json({ error: 'private' });
    let img = null;
    try {
      img = await np.artImage(String(req.params.token), allowed);
    } catch (err) {
      console.warn('[spotify]', err?.message);
      return res.status(502).json({ error: 'unavailable' });
    }
    if (!img) return res.status(404).json({ error: 'not found' });
    // the display keeps the cover itself (a blob URL) while it shows it: nothing else keeps a copy
    res.set('cache-control', 'no-store');
    res.set('content-type', img.type);
    res.set('content-length', String(img.buf.length));
    res.set('x-content-type-options', 'nosniff');
    res.end(img.buf);
  }));
  return r;
}
