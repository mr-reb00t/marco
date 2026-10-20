// Express application: display API + admin API + static frontend (dist/) + SSE. Built by createApp() so the
// tests run the very same middleware stack as production (server/index.js adds initStore, listen and shutdown).
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { getConfig, paths, ROOT } from './store.js';
import { sessionMiddleware, csrfGuard, loginHandler, logoutHandler, logoutAllHandler, meHandler,
  googleLoginHandler, googleConnectHandler, googleCallbackHandler, microsoftConnectHandler, microsoftCallbackHandler, twoFactorLoginHandler } from './auth.js';
import { twoFactorRouter } from './routes/twofactor.js';
import { publicRouter, displayBootstrap } from './routes/public.js';
import { injectBoot } from './core/bootstrap.js';
import { adminRouter } from './routes/admin.js';
import { screensAdminRouter, displayPublicRouter } from './routes/screens.js';
import { hooksRouter } from './routes/hooks.js';
import { announceRouter } from './routes/announce.js';
import { systemRouter } from './routes/system.js';
import { updatesRouter } from './routes/updates.js';
import { eventsAdminRouter, eventsPublicRouter } from './routes/localEvents.js';
import { accessAdminRouter, pairPublicRouter } from './routes/access.js';
import { doorbellAdminRouter, doorbellPublicRouter } from './routes/doorbell.js';
import { haAdminRouter, haDisplayRouter } from './routes/ha.js';
import { valuesAdminRouter, valuesDisplayRouter } from './routes/values.js';
import { dataAdminRouter, dataDisplayRouter } from './routes/data.js';
import { setupRouter } from './setup.js';
import { familyAdminRouter, familyPublicRouter, familyDisplayRouter, familyPhotoMedia } from './routes/family.js';
import { geocodeRouter } from './geocode.js';
import { hostGuard } from './lib/net.js';
import { redactSecrets } from './core/activityCore.js';
import { canvasCards } from './core/canvasCore.js';
import { displayAuth, mediaAuth } from './displayAccess.js';
import { spotifyAdminRouter, spotifyCallbackHandler, spotifyConnectHandler, spotifyDisplayRouter } from './routes/spotify.js';
import { checkTrustProxy } from './lib/trustProxy.js';
import { immichMedia } from './immich.js';
import { galleryMedia, thumbMedia } from './photos.js';

const FRAME_DESTS = new Set(['iframe', 'frame', 'embed', 'object', 'fencedframe']);
const PREVIEW_PAGE = /^\/(?:index\.html)?$|^\/d\/[^/]+$/;

/**
 * 403 for a request loaded into a frame (Sec-Fetch-Dest), except the admin preview of a display: GET /, /index.html
 * or /d/<key> with ?preview=1, asked for by this origin itself (Sec-Fetch-Site same-origin). Browsers without
 * Sec-Fetch-* headers are let through (frame-ancestors still applies).
 */
export function frameGuard(req, res, next) {
  const dest = req.get('sec-fetch-dest');
  if (!dest || !FRAME_DESTS.has(dest)) return next();
  const site = req.get('sec-fetch-site');
  const preview = req.method === 'GET' && PREVIEW_PAGE.test(req.path) && new URLSearchParams(req.url.split('?')[1] ?? '').get('preview') === '1';
  if (preview && (!site || site === 'same-origin')) return next();
  // the refusal itself runs nothing and gets an opaque origin
  res.set('content-security-policy', "default-src 'none'; sandbox; frame-ancestors 'self'");
  res.status(403).type('text/plain').send('Forbidden');
}

/** The display page's policy: no script but this server's own files, no plugins, no <base>, no form posts. */
export const DISPLAY_CSP = "script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const cspCache = new WeakMap();

/**
 * The Content-Security-Policy of the display page for `cfg` (cached per saved config). While some screen shows a
 * custom HTML card, `frame-src` also limits the frames of the page to this server and the addresses of the saved web
 * widgets, so no frame can be sent anywhere else (the card's own frame cannot navigate, this is one more lock).
 * Without a custom card it is left open, so web widgets keep working exactly as before (a page that sends its frame
 * on to a sign-in elsewhere, a tap on a link in it). img-src, connect-src and style-src stay open (LAN images, Immich,
 * inline styles).
 */
export function displayCsp(cfg) {
  if (!cfg || typeof cfg !== 'object') return DISPLAY_CSP;
  const hit = cspCache.get(cfg);
  if (hit) return hit;
  const cards = (cfg.screens ?? []).some((s) => s?.layout?.preset === 'canvas' && canvasCards(s.canvas?.items).some((it) => it?.kind === 'html' && !it.hidden));
  let csp = DISPLAY_CSP;
  if (cards) {
    const origins = new Set();
    for (const w of cfg.widgets ?? []) {
      if (w?.type !== 'web' || typeof w.options?.url !== 'string') continue;
      try {
        const u = new URL(w.options.url);
        if (u.protocol === 'http:' || u.protocol === 'https:') origins.add(u.origin);
      } catch { /* not an address: never framed */ }
    }
    csp += `; frame-src 'self'${[...origins].sort().map((o) => ` ${o}`).join('')}`;
  }
  cspCache.set(cfg, csp);
  return csp;
}

/** Display-facing JSON endpoints: private mode requires a display key, a device token or an admin session. */
export const DISPLAY_API_PATHS = ['/api/display', '/api/events', '/api/weather', '/api/news', '/api/photos', '/api/countdowns'];

/**
 * @param {{ version: string, dist?: string, updater?: object }} opts  dist = built frontend directory (default
 *   <repo>/dist); updater = update checker (server/updates.js; default: the server's own, created on first use)
 */
export function createApp({ version, dist = path.join(ROOT, 'dist'), updater = null }) {
  const app = express();
  app.disable('x-powered-by');
  // TRUST_PROXY: Express "trust proxy" value (default loopback). Set it to the address the reverse proxy connects
  // from whenever that is not loopback: a proxy on another host (TRUST_PROXY=192.168.1.10), or any proxy in front
  // of the Docker container (it connects from the bridge gateway: TRUST_PROXY=172.16.0.0/12), so
  // X-Forwarded-Proto/For are honoured (secure cookies, real client IP, LAN checks). See lib/net.js isLanClient.
  // index.js checks it before the server starts (lib/trustProxy.js); a bad value here still says what is wrong
  const trust = checkTrustProxy(process.env.TRUST_PROXY);
  if (!trust.ok) throw new Error(trust.message);
  app.set('trust proxy', trust.value);

  // Browser hardening on every response. Private display links live in the URL (/d/<key>): never leak them
  // through the Referer header. No MIME sniffing. Only this same origin may frame a page (the admin's live
  // preview iframes the display; nothing else can, so no clickjacking of the admin).
  app.use((req, res, next) => {
    res.set('referrer-policy', 'no-referrer');
    res.set('x-content-type-options', 'nosniff');
    res.set('x-frame-options', 'SAMEORIGIN');
    res.set('content-security-policy', "frame-ancestors 'self'");
    next();
  });
  // Framing: only the admin's live preview frames this server's pages (frame-ancestors above), and only the display
  // with ?preview=1. Any other framed load is refused, so a web widget page that sends its frame here (a redirect,
  // a script setting location) never gets a page of this origin inside the display's sandboxed widget frame.
  app.use(frameGuard);
  // DNS-rebinding guard: only LAN host names, IP literals, PUBLIC_URL and ALLOWED_HOSTS (lib/net.js).
  app.use(hostGuard());
  app.use(sessionMiddleware());
  // Route-specific body limits must come before the global parser (body-parser skips already-parsed bodies).
  app.use(['/api/admin/import/preview', '/api/admin/import/apply'], express.json({ limit: '5mb' }));
  app.use('/api/display/heartbeat', express.json({ limit: '4kb' }));
  app.use('/api/display/ha/action', express.json({ limit: '2kb' }));
  app.use('/api/pair', express.json({ limit: '2kb' }));
  app.use('/api/hooks/values', express.json({ limit: '8kb' })); // core/valuesCore.js VALUES_LIMITS.bodyBytes
  app.use('/api/hooks', express.json({ limit: '16kb' }));
  app.use(['/api/family', '/api/display/family'], express.json({ limit: '4kb' }));
  app.use('/api/display/todo', express.json({ limit: '2kb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(['/api/admin', '/api/auth', '/api/setup'], csrfGuard({ multipartPaths: ['/photos', /^\/photos\/[^/]+\/thumb$/] }));

  // --- auth ---
  app.get('/api/auth/me', meHandler);
  app.post('/api/auth/login', (req, res, next) => loginHandler(req, res).catch(next));
  // The code step of a sign-in when two-step sign-in is on (server/twofactor.js).
  app.post('/api/auth/2fa', twoFactorLoginHandler);
  app.post('/api/auth/logout', logoutHandler);
  app.post('/api/auth/logout-all', logoutAllHandler);
  app.get('/auth/google/login', googleLoginHandler);
  app.get('/auth/google/connect', googleConnectHandler);
  app.get('/auth/google/callback', (req, res, next) => googleCallbackHandler(req, res).catch(next));
  app.get('/auth/microsoft/connect', microsoftConnectHandler);
  app.get('/auth/microsoft/callback', (req, res, next) => microsoftCallbackHandler(req, res).catch(next));
  // Spotify accounts for "now playing" (routes/spotify.js), with the household's own Spotify app
  app.get('/auth/spotify/connect', spotifyConnectHandler);
  app.get('/auth/spotify/callback', (req, res, next) => spotifyCallbackHandler(req, res).catch(next));

  // --- APIs ---
  // First-run setup wizard (open only while no admin password exists; server/setup.js).
  app.use('/api/setup', setupRouter({ version }));
  // Webhooks (bearer API tokens, no cookies → outside the CSRF guard) (docs/ARCHITECTURE.md).
  app.use('/api/hooks', hooksRouter());
  // Place search: an admin session, or the setup wizard before the first password exists (server/geocode.js).
  app.use('/api/admin', geocodeRouter());
  // Admin routers: each one applies requireAuth; unmatched paths fall through to the next one.
  app.use('/api/admin', adminRouter());
  // Two-step sign-in settings (routes/twofactor.js).
  app.use('/api/admin', twoFactorRouter());
  app.use('/api/admin', updatesRouter({ version, updater }));
  app.use('/api/admin', screensAdminRouter(), announceRouter(), systemRouter({ version }), eventsAdminRouter(), accessAdminRouter(), doorbellAdminRouter(), familyAdminRouter(), haAdminRouter(), valuesAdminRouter(), dataAdminRouter(), spotifyAdminRouter());
  // Display access (private links / paired devices / admin session; open mode = legacy LAN). displayAccess.js
  app.use(DISPLAY_API_PATHS, displayAuth());
  app.use('/api/stream', displayAuth({ allowQuery: true }));
  // Pairing (unauthenticated, rate-limited), the family page (its own key, rate-limited) and the public (display)
  // routers.
  app.use('/api', pairPublicRouter(), familyPublicRouter());
  app.use('/api', displayPublicRouter(), eventsPublicRouter(), doorbellPublicRouter(), familyDisplayRouter(), haDisplayRouter(), valuesDisplayRouter(), dataDisplayRouter(), spotifyDisplayRouter());
  app.use('/api', publicRouter({ version }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  // --- media ---
  // Profile photos of the family members: their own rules (family key, admin session, or a display that shows that
  // member), so before the /media guard. routes/family.js familyPhotoMedia
  app.get('/media/avatars/:id', familyPhotoMedia);
  // Family photos: private mode → display key / device token (?k=) or admin session; open mode → LAN clients or
  // an admin session (and valid keys). displayAccess.js mediaAuth
  app.use('/media', mediaAuth);
  // Immich photos (server/immich.js): proxied with the server's API key, only assets of albums a screen plays.
  app.get('/media/immich/:id', (req, res, next) => immichMedia(req, res).catch(next));
  // Gallery URLs carry ?v=<mtime> (replaced photos get a new URL), so they can be cached for long, privately. A
  // display reads only photos in the rotation of a screen its credential may read (photos.js galleryMedia).
  app.use('/media/photos', galleryMedia, express.static(paths.photos, {
    maxAge: '30d', dotfiles: 'deny', index: false, fallthrough: false,
    setHeaders: (res) => res.set('cache-control', res.locals.mediaNoStore ? 'private, no-store' : 'private, max-age=2592000'),
  }));
  // Browser-made thumbnails (always JPEG, whatever the photo's extension) for the admin gallery grid (admin only).
  app.use('/media/thumbs', thumbMedia, express.static(path.join(paths.photos, '.thumbs'), {
    maxAge: '365d', immutable: true, dotfiles: 'deny', index: false, fallthrough: false,
    setHeaders: (res) => { res.type('image/jpeg'); res.set('cache-control', 'private, max-age=31536000, immutable'); },
  }));

  // --- frontend (production build) ---
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => {
      if (p.includes(`${path.sep}assets${path.sep}`)) res.set('cache-control', 'public, max-age=31536000, immutable');
      // The display and admin pages (also as /index.html, /admin/index.html) are never cached: a new build or a
      // revoked link takes effect on the next load.
      else if (p.endsWith('.html')) res.set('cache-control', 'no-store');
      // the display page, asked for as /index.html
      if (p === path.join(dist, 'index.html')) res.set('content-security-policy', displayCsp(getConfig()));
    } }));
    const sendHtml = (file, cache = 'no-store') => (req, res) => {
      res.set('cache-control', cache);
      if (file === 'index.html') res.set('content-security-policy', displayCsp(getConfig()));
      res.sendFile(path.join(dist, file));
    };
    app.get(['/admin', '/admin/', '/admin/*splat'], (req, res, next) =>
      fs.existsSync(path.join(dist, 'admin', 'index.html')) ? sendHtml('admin/index.html')(req, res) : next());
    app.get(['/', '/index.html', '/pair'], sendHtml('index.html'));
    // Private display link: the same display page; the key is read from the path by the page itself. The page
    // carries what the display API answers first for that key (routes/public.js displayBootstrap), so the screen
    // draws without those round trips; without it (unknown key, setup, an error) it is the plain page.
    let displayPage = { mtimeMs: -1, html: '' };
    const displayHtml = () => {
      const file = path.join(dist, 'index.html');
      const { mtimeMs } = fs.statSync(file);
      if (mtimeMs !== displayPage.mtimeMs) displayPage = { mtimeMs, html: fs.readFileSync(file, 'utf8') };
      return displayPage.html;
    };
    app.get('/d/:key', (req, res) => {
      res.set('x-robots-tag', 'noindex, nofollow');
      let boot = null;
      try {
        boot = displayBootstrap(req, req.params.key, { version });
      } catch (err) {
        console.warn('[display] page bootstrap', err?.message || err);
      }
      if (!boot) return sendHtml('index.html', 'private, no-store')(req, res);
      res.set('cache-control', 'private, no-store');
      res.set('content-security-policy', displayCsp(getConfig()));
      res.type('html').send(injectBoot(displayHtml(), boot));
    });
    // Family page (/f/<key>, or /f with the key the phone remembers): the key is read from the path by the page.
    app.get(['/f', '/f/', '/f/:key'], (req, res, next) => {
      if (!fs.existsSync(path.join(dist, 'family', 'index.html'))) return next();
      res.set('x-robots-tag', 'noindex, nofollow');
      sendHtml('family/index.html', 'private, no-store')(req, res);
    });
  } else {
    app.get('/', (req, res) => res.type('text/plain').send(
      'Marco API running. Frontend not built: run `npm run build` (production) or `npm run dev` (vite on :5173).'));
  }

  // --- errors ---
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : err.name === 'MulterError' ? 400 : 500);
    if (status >= 500) console.error('[server]', req.method, redactSecrets(req.originalUrl), err);
    const message = err.type === 'entity.parse.failed' ? 'invalid JSON' : status >= 500 ? 'internal error' : err.message;
    if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/auth')) return res.status(status).json({ error: message });
    res.status(status).type('text/plain').send(message);
  });
  return app;
}
