// Display API (display key / device token / admin session in private mode; app.js applies displayAuth; anyone
// in open mode). Never exposes secrets, tokens or calendar URLs.
import { Router } from 'express';
import { getConfig } from '../store.js';
import { getEvents } from '../calendars.js';
import { getWeather } from '../weather.js';
import { getNews } from '../news.js';
import { getPrices, PricesError } from '../prices.js';
import { priceZone } from '../core/pricesCore.js';
import { getGridTariffs } from '../tariffs.js';
import { gridCompany } from '../core/tariffsCore.js';
import { getPhotos } from '../photos.js';
import { activeBackgroundRule } from '../photoRules.js';
import { backgroundRuleSig } from '../core/bgRules.js';
import { sseHandler } from '../sse.js';
import { streamInit, streamHello, onStreamOpen, onStreamClose, pollDisplay } from '../displays.js';
import { displayConfig as projectDisplayConfig } from '../core/screens.js';
import { requestScreen, resolveDisplayAccess, KEY_HEADER } from '../displayAccess.js';
import { needsSetup } from '../auth.js';
import { addDays, localDate, isDateStr, daysBetween } from '../core/lib/tz.js';
import { healthBody } from '../capabilities.js';
import { lanAddresses } from '../setup.js';
import { hostAllowed, hostnameOf, untrustedProxy } from '../lib/net.js';
import { screenPrivacy, screenPrivacyNext } from '../privacy.js';
import { privatizeEvents } from '../core/privacy.js';
import { hash } from '../lib/text.js';
import { familyQrUrl, trustedDisplay } from '../family.js';
import { haStreamHello } from './ha.js';
import { valuesStreamHello } from '../values.js';

/** How long the display's price request waits for a first fetch of grid tariffs (its own timeout is 15 s). */
const GRID_WAIT_MS = 5_000;
/** Privacy of a screen as displayConfig() takes it ({ status, next }). */
const privacyOf = (cfg, screen) => ({ status: screenPrivacy(cfg, screen), next: screenPrivacyNext(cfg, screen) });

/** GET /api/display/config payload for `screenKey` (screen or carousel slug or id; empty → default screen). */
export function displayConfig(cfg, screenKey) {
  return displayConfigFor(cfg, { query: { screen: screenKey } });
}

/** Display config for a request (screen or carousel bound to its key / device, else ?screen=). */
function displayConfigFor(cfg, req) {
  const { screen, carousel } = requestScreen(cfg, req);
  return projectDisplayConfig(cfg, screen, { privacy: privacyOf(cfg, screen), carousel, familyQr: familyQrUrl(req), trusted: trustedDisplay(req) });
}

/**
 * The page bootstrap of a private link (/d/<key>, server/core/bootstrap.js): what GET /api/display/config and GET
 * /api/health answer for that key, so the display draws without asking first. Null for an unknown or revoked key and
 * while the server needs setup (the page then asks as before and shows what the API says). The answer is the API's
 * own (displayConfigFor with the key's binding), so the privacy rules are the same.
 */
export function displayBootstrap(req, key, { version }) {
  if (typeof key !== 'string' || !key || key.length > 64 || needsSetup()) return null;
  // the display's own first request: the key in X-Marco-Key, no query (a keyed display never sends ?screen= at boot)
  const asked = Object.create(req);
  Object.defineProperty(asked, 'headers', { value: { ...req.headers, [KEY_HEADER]: key } });
  Object.defineProperty(asked, 'query', { value: {} });
  const access = resolveDisplayAccess(asked);
  if (!access.ok || access.via !== 'key') return null;
  Object.defineProperty(asked, 'displayAccess', { value: access });
  return {
    '/api/display/config': displayConfigFor(getConfig(), asked),
    '/api/health': healthBody({ version, lanAddresses: onThisMachine(req) ? lanAddresses() : undefined }),
  };
}

/**
 * Events as the display may see them: while the screen is private, busy / hidden calendars are filtered here,
 * before anything leaves the server (core/privacy.js). The admin preview iframe is a display, so it sees the same.
 */
export async function displayEvents(cfg, screen, { from, to }) {
  const r = await getEvents({ from, to, screen });
  if (!screenPrivacy(cfg, screen).active) return r;
  const events = privatizeEvents(r.events, cfg, screen.screen.language);
  return { ...r, events, hash: `p${hash(events)}` };
}

/** The request comes from this machine (loopback, not relayed by an untrusted proxy) under an allowed host name. */
export function onThisMachine(req) {
  const ip = String(req.ip || '').replace(/^::ffff:/i, '');
  if (ip !== '::1' && !ip.startsWith('127.')) return false;
  return !untrustedProxy(req) && hostAllowed(hostnameOf(req.get('host')));
}

export function publicRouter({ version }) {
  const r = Router();
  const noStore = (req, res, next) => { if (!res.get('cache-control')) res.set('cache-control', 'private, no-store'); next(); };
  r.use(noStore);

  // A display opened on the server itself (a kiosk on http://localhost) gets this machine's LAN addresses, so its
  // pairing screen can say where other devices reach the admin. Nobody else gets them.
  r.get('/health', (req, res) => res.json(healthBody({ version, lanAddresses: onThisMachine(req) ? lanAddresses() : undefined })));

  r.get('/display/config', (req, res) => res.json(displayConfigFor(getConfig(), req)));

  r.get('/events', async (req, res, next) => {
    try {
      const tz = getConfig().datetime.timezone;
      const today = localDate(new Date(), tz);
      let from = isDateStr(req.query.from) ? req.query.from : addDays(today, -7);
      let to = isDateStr(req.query.to) ? req.query.to : addDays(today, 42);
      if (to < from) return res.status(400).json({ error: '`to` must be >= `from`' });
      // Keep the (unauthenticated) window near today: limits Google refetches and recurrence expansion.
      const minDate = addDays(today, -366);
      const maxDate = addDays(today, 731);
      if (from < minDate) from = minDate;
      if (to > maxDate) to = maxDate;
      if (from > maxDate) from = maxDate;
      if (to < from) to = from;
      if (daysBetween(from, to) > 400) to = addDays(from, 400);
      const cfg = getConfig();
      res.json(await displayEvents(cfg, requestScreen(cfg, req).screen, { from, to }));
    } catch (err) {
      next(err);
    }
  });

  r.get('/weather', async (req, res) => {
    try {
      const screen = requestScreen(getConfig(), req).screen;
      res.json(await getWeather({ lang: screen.screen.language, screen }));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // Electricity prices of one zone (the 'prices' widget). Any known zone: the admin preview shows unsaved widgets, and
  // every zone is one cache entry refreshed a few times a day whoever asks (server/prices.js).
  r.get('/display/prices', async (req, res, next) => {
    try {
      const zone = typeof req.query.zone === 'string' ? req.query.zone : '';
      if (!priceZone(zone)) return res.status(400).json({ error: 'invalid_zone' });
      // &grid=<company>: the Danish grid tariffs of the zone's hours too (server/tariffs.js), a company of that zone
      const grid = typeof req.query.grid === 'string' ? req.query.grid : '';
      if (grid && gridCompany(grid)?.zone !== zone) return res.status(400).json({ error: 'invalid_grid' });
      const out = await getPrices(zone);
      // a first fetch of the tariffs (one call per code, spaced out) never holds up the prices: after 5 s the screen
      // gets them without tariffs and a note, and has them on its next ask
      if (grid) out.grid = await getGridTariffs(grid, zone, { wait: GRID_WAIT_MS });
      res.json(out);
    } catch (err) {
      if (err instanceof PricesError) return res.status(502).json({ error: err.code });
      next(err);
    }
  });

  r.get('/news', async (req, res, next) => {
    try {
      res.json(await getNews());
    } catch (err) {
      next(err);
    }
  });

  r.get('/photos', async (req, res, next) => {
    try {
      const cfg = getConfig();
      const { screen } = requestScreen(cfg, req);
      const after = typeof req.query.after === 'string' ? req.query.after : '';
      // Privacy mode with "hide photos": stock photos only, gallery file names never reach the display.
      const hide = screen.privacy?.hidePhotos && screenPrivacy(cfg, screen).active;
      const background = hide ? { ...screen.background, source: 'stock' } : screen.background;
      // a special background rule that holds now (core/bgRules.js) brings its own photos; privacy still wins.
      // `rule` is only a signature, so the display knows when to change the photo at once (never the rule itself).
      const rule = hide ? null : await activeBackgroundRule(cfg, screen);
      const photos = await getPhotos(Number(req.query.count) || 20, background, { key: hide ? `${screen.id}|private` : screen.id, after: hide ? '' : after, rule });
      res.json({ photos, rule: backgroundRuleSig(rule) });
    } catch (err) {
      next(err);
    }
  });

  // Poll channel for displays without a stream: GET /api/display/poll?client=&cursor=&rev=&hidden= (docs/API.md).
  r.get('/display/poll', (req, res) => res.json(pollDisplay(req)));

  // SSE: GET /api/stream?screen=<slug|id>&client=<clientId>[&k=<key|device token>] (docs/ARCHITECTURE.md).
  r.get('/stream', sseHandler({
    init: streamInit, hello: streamHello, onClose: onStreamClose,
    onOpen: (client, req) => {
      onStreamOpen(client, req);
      haStreamHello(client);
      valuesStreamHello(client);
    },
  }));
  return r;
}
