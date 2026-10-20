// Capability block for GET /api/health. The admin and the display read it to decide which sections,
// actions and limits apply. Marco Cloud answers the same shape with its own values; a server that sends
// no `features` field is treated as having every feature on.
import { googleConfigured, googleLoginEnabled } from './google.js';
import { getConfig } from './store.js';
import { microsoftConfigured } from './microsoft.js';
import { CODE_LENGTH } from './pairing.js';

/** Every feature key, in the order docs/API.md lists them. */
export const FEATURE_KEYS = Object.freeze([
  'homeassistant', 'news', 'customCss', 'gallery', 'schedules', 'announcements', 'displayCommands',
  'openDisplayAccess', 'insecureTls', 'googleCalendar', 'googleLogin', 'passwordLogin', 'apiTokens',
  'webhooks', 'backups', 'importExport', 'includeSecrets', 'activity', 'setupWizard', 'status', 'accountMenu',
  'microsoftCalendar', 'updates', 'feedback', 'privacy', 'doorbell', 'doorbellLive', 'carousels', 'immich',
  'family', 'widgets', 'webWidgets', 'priceWidgets', 'familyPhotos', 'twoFactor', 'accountSettings', 'screenBuilder',
  'valueHooks', 'tokenScopes', 'stockQuotes', 'familyAccess', 'spotify',
]);

/** Feature flags of a self-hosted server: all on (`updates` too: the update banner and settings), Google and
 *  Microsoft follow their credentials, no account menu and no feedback form (that one reaches Marco Cloud's team).
 *  `doorbell` is the ring overlay and its hook; `doorbellLive` says the frames are a live camera picture proxied
 *  from Home Assistant (a server without it serves the latest uploaded snapshot instead). `carousels`: several
 *  screens in a loop on one TV (config.carousels, server/core/carousels.js). `immich` is the Immich
 *  photo source (server/immich.js), which needs a server on the same network as the library. `family` is Familia:
 *  members, routines with stars, rewards, meals, the kids layouts and the family page on the phone (server/family.js).
 *  `widgets` are images on screens (config.widgets); `webWidgets` adds web pages in a sandboxed frame;
 *  `priceWidgets` the electricity price card (server/prices.js). `familyPhotos`: profile photos of the family members
 *  (POST /api/admin/family/photos, GET /media/avatars/<id>; server/familyPhotos.js). `twoFactor`: two-step sign-in
 *  with an authenticator app for the admin (server/twofactor.js; Marco Cloud has its own on the account page).
 *  `accountSettings` (always off here): the account settings of a Marco Cloud account on the admin's account page.
 *  `screenBuilder`: Personalizado, the screen builder (layout 'canvas', server/core/canvasCore.js). `valueHooks`:
 *  POST /api/hooks/values and the Valor card (server/values.js); `tokenScopes`: what each API token may do
 *  (core/valuesCore.js TOKEN_SCOPES); `stockQuotes`: the Bolsa card can get quotes (here with the owner's own Finnhub
 *  key, saved from the card). `familyAccess`: each person's own dashboard on the phone (/my) with the controls the
 *  admin allows (server/familyAccess.js). `spotify`: "now playing" with the household's own Spotify app
 *  (server/nowPlaying.js). */
export function selfHostedFeatures() {
  const google = googleConfigured();
  const out = {};
  for (const k of FEATURE_KEYS) out[k] = true;
  out.googleCalendar = google;
  out.googleLogin = googleLoginEnabled(getConfig());
  out.accountMenu = false;
  out.accountSettings = false;
  out.feedback = false;
  out.microsoftCalendar = microsoftConfigured();
  return out;
}

/** Live update channel for displays: 'sse' unless MARCO_LIVE=poll. */
export const liveMode = (env = process.env) => (String(env.MARCO_LIVE || '').trim().toLowerCase() === 'poll' ? 'poll' : 'sse');

/**
 * Body of GET /api/health. `lanAddresses` is only passed for a client on this machine (routes/public.js): the
 * pairing screen of a kiosk opened on http://localhost shows them instead of "localhost".
 */
export function healthBody({ version, env = process.env, lanAddresses }) {
  const body = {
    ok: true,
    uptime: Math.round(process.uptime()),
    version,
    live: liveMode(env),
    edition: 'self-hosted',
    tenancy: 'single',
    runtime: 'node',
    pairCodeLength: CODE_LENGTH,
    features: selfHostedFeatures(),
  };
  if (Array.isArray(lanAddresses) && lanAddresses.length) body.lanAddresses = lanAddresses.slice(0, 3);
  return body;
}
