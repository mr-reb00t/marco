// Marco server entry point: store, password bootstrap, the Express app (app.js), listen, refresher, shutdown.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { initStore, getConfig, events as storeEvents, paths, ROOT, migratedOnLoad, StoreError } from './store.js';
import { ensurePassword } from './auth.js';
import { createApp } from './app.js';
import { checkTrustProxy } from './lib/trustProxy.js';
import { syncDisplayKeys, onDisplayAccessConfig, revalidateStreams } from './displayAccess.js';
import { broadcast, closeAll, reresolveClients, setStreamValidator } from './sse.js';
import { startRefresher, stopRefresher, runRefresh } from './refresher.js';
import { logActivity, changedSections } from './activity.js';
import { setServerVersion, flushDisplays, reresolveDisplays, subscriptionFor } from './displays.js';
import { pruneScreens } from './announce.js';
import { pruneDoorbellScreens } from './doorbell.js';
import { flushTokenUsage } from './tokens.js';
import { flushValues } from './values.js';
import { logSetupHint } from './setup.js';
import { invalidateIcsParsing } from './calendars.js';
import { serverUpdater } from './routes/updates.js';
import { onPrivacyConfig, syncPrivacy, stopPrivacy } from './privacy.js';
import { startPhotoSweep } from './familyPhotos.js';
import { cleanStoredPhotos } from './photos.js';
import { startHomeAssistantLive, stopHomeAssistantLive } from './haService.js';

// TRUST_PROXY: a value Express cannot read stops here with a plain message (not a stack trace later on)
const trust = checkTrustProxy(process.env.TRUST_PROXY);
if (!trust.ok) {
  console.error(trust.message);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

try {
  initStore();
} catch (err) {
  if (!(err instanceof StoreError)) throw err;
  console.error(err.message);
  process.exit(1);
}
setServerVersion(pkg.version);
if (migratedOnLoad) {
  logActivity('config.migrated', { actor: 'system', data: { ...migratedOnLoad, ...(migratedOnLoad.from ? { backup: 'config-v1-premigration.json' } : {}) } });
}
// Floating ICS times (no TZID) are interpreted in the process zone; align it with the configured zone (and keep
// it aligned when the zone is changed in the admin or the wizard, see the 'config' listener below). A TZ set in
// the environment wins and is never changed.
const tzFromEnv = Boolean(process.env.TZ);
if (!tzFromEnv) process.env.TZ = getConfig().datetime.timezone;
await ensurePassword();

// Every display screen gets its private-link key (secrets.json; displayAccess.js).
syncDisplayKeys();
// Gallery photos stored before uploads were cleaned lose their metadata once (photos.js cleanStoredPhotos).
setTimeout(() => { try { const n = cleanStoredPhotos(); if (n) console.log(`[photos] removed metadata from ${n} gallery photo(s)`); } catch (err) { console.warn('[photos] metadata cleanup:', err.message); } }, 5000).unref();
// Profile photos the config does not use go a week after they were last used (familyPhotos.js).
startPhotoSweep();
// Every heartbeat re-checks each open stream's credential (sessions expire, keys / devices change).
setStreamValidator(() => revalidateStreams());
// Home Assistant: the live mirror of the entities Personalizado screens show (haLive.js).
startHomeAssistantLive();
const app = createApp({ version: pkg.version });

// Config saved (admin, restore, import or server-side) → re-resolve each display's screen (slug renamed / screen
// deleted), displays refetch their config, calendars may have changed; activity log gets the changed sections.
storeEvents.on('config', (cfg, prev, { reason, req } = {}) => {
  if (!tzFromEnv && cfg.datetime.timezone && cfg.datetime.timezone !== process.env.TZ) {
    process.env.TZ = cfg.datetime.timezone; // Node applies a runtime TZ change to new Date computations
    invalidateIcsParsing();
  }
  reresolveClients((key) => subscriptionFor(cfg, key));
  onDisplayAccessConfig(cfg, prev);
  reresolveDisplays(cfg);
  pruneScreens(cfg);
  pruneDoorbellScreens(cfg);
  broadcast('config', { revision: cfg.revision });
  onPrivacyConfig();
  runRefresh().catch(() => {});
  // restore and import log their own entry, and so does a phone dashboard that adds a to-do or an event (family.todo,
  // family.event in familyAccess.js)
  if (reason !== 'restore' && reason !== 'import' && reason !== 'family') {
    logActivity('config.saved', { req, ...(req ? {} : { actor: 'system' }), data: { revision: cfg.revision, sections: changedSections(prev, cfg), ...(reason && reason !== 'admin' ? { reason } : {}) } });
  }
});

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, process.env.HOST || '0.0.0.0', (err) => {
  // Express 5 passes listen errors (EADDRINUSE, EACCES…) to this callback.
  if (err) {
    console.error(`[server] cannot listen on port ${PORT}: ${err.code || err.message}`);
    process.exit(1);
  }
  console.log(`[server] Marco v${pkg.version} on http://localhost:${PORT} (data: ${paths.data})`);
  logSetupHint(PORT);
  startRefresher();
  // Privacy periods that end and schedule rules that start while the server runs (server/privacy.js)
  syncPrivacy();
  // Daily check for a newer release (MARCO_UPDATE_CHECK=0 or the admin switch turn it off); server/updates.js
  serverUpdater(pkg.version).start();
});

function shutdown(sig) {
  console.log(`[server] ${sig}, shutting down`);
  stopRefresher();
  stopPrivacy();
  stopHomeAssistantLive();
  serverUpdater(pkg.version).stop();
  try { flushDisplays(); flushTokenUsage(); flushValues(); } catch { /* ignore */ }
  closeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
// Photo uploads can be up to 100 MB (fallback when the browser cannot optimize them): allow slow uplinks.
server.requestTimeout = 30 * 60_000;
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[server] unhandled rejection:', err));
