// Persistent config + secrets in data/ (atomic writes: tmp file + rename).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { defaultConfig, DEFAULT_ICON_RULES } from './core/defaults.js';
import { validateConfig, mergeDefaults, migrateConfig, isV1 } from './core/validate.js';
import { backupBeforeSave, writeBackup } from './backups.js';
import { isLegacyCanvas, startCanvasGlassOnSave } from './core/canvasCore.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {};
// 'config' (config, prev, { reason, req }) after every save. reason: 'admin' | 'server' | 'restore' | 'import' | …
export const events = new EventEmitter();

let config = null;
let secrets = null;
/** Set when the stored config was migrated during the last initStore() (logged by the activity module). */
export let migratedOnLoad = null;

export function initStore(dataDir = process.env.DATA_DIR || path.join(ROOT, 'data')) {
  paths.data = path.resolve(dataDir);
  paths.config = path.join(paths.data, 'config.json');
  paths.secrets = path.join(paths.data, 'secrets.json');
  paths.photos = path.join(paths.data, 'photos');
  paths.cache = path.join(paths.data, 'cache');
  paths.backups = path.join(paths.data, 'backups'); // rotating config backups (docs/ARCHITECTURE.md)
  paths.activity = path.join(paths.data, 'activity.jsonl'); // activity log
  paths.announcements = path.join(paths.data, 'announcements.json'); // active + history
  paths.displays = path.join(paths.data, 'displays.json'); // known displays registry
  paths.privacy = path.join(paths.data, 'privacy.json'); // privacy mode state per screen (server/privacy.js)
  paths.family = path.join(paths.data, 'family.json'); // routines done, rewards redeemed, stars (server/family.js)
  paths.values = path.join(paths.data, 'values.json'); // values pushed by POST /api/hooks/values (server/values.js)
  migratedOnLoad = null;
  for (const d of [paths.data, paths.photos, paths.cache, paths.backups]) fs.mkdirSync(d, { recursive: true });
  config = loadConfig();
  secrets = loadSecrets();
  return { config, secrets };
}

export function writeFileAtomic(file, data, mode) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

export class StoreError extends Error {}

function readJson(file, { strict = false } = {}) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (strict && (!v || typeof v !== 'object' || Array.isArray(v))) throw new Error('not a JSON object');
    return v;
  } catch (err) {
    if (err.code !== 'ENOENT' && strict) {
      // Secrets hold the admin password hash: falling back to {} would silently reopen the setup wizard on a
      // configured install. Refuse to start instead and let the owner fix or restore the file.
      throw new StoreError(`[store] cannot read ${file}: ${err.message}. Refusing to start: fix the file, restore it from a `
        + 'backup, or delete it on purpose to reset the admin password (the setup wizard then asks for the setup token '
        + 'printed in this log).');
    }
    if (err.code !== 'ENOENT') {
      console.error(`[store] cannot read ${file}: ${err.message}; backing it up and using defaults`);
      try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
    }
    return null;
  }
}

/** A stored config without security.displayAccess predates private display links (→ migrated to 'open'). */
export const isLegacyAccess = (raw) => Boolean(raw && typeof raw === 'object' && !Array.isArray(raw)
  && !(raw.security && typeof raw.security === 'object' && ['private', 'open'].includes(raw.security.displayAccess)));

function loadConfig() {
  const raw = readJson(paths.config);
  if (!raw) {
    const c = defaultConfig();
    writeFileAtomic(paths.config, JSON.stringify(c, null, 2));
    mergeIconRuleUpdates(c); // fresh install: already the current rule set, only records the marker
    return c;
  }
  // v1 (single screen) → v2 (screens[]): keep an untouched copy of the old file, then persist the migrated one.
  const migrate = isV1(raw);
  // Configs saved before private display links existed (0.3) keep their displays working without a key:
  // display access 'open' (the admin recommends switching). Fresh installs get the 'private' default.
  const legacyAccess = isLegacyAccess(raw);
  if (legacyAccess) raw.security = { ...(raw.security && typeof raw.security === 'object' ? raw.security : {}), displayAccess: 'open' };
  // Back-fill new keys from defaults, then sanitise. Invalid stored values fall back to defaults (logged).
  const { value, errors } = validateConfig(mergeDefaults(migrateConfig(raw)));
  if (errors.length) console.warn('[store] config had invalid values (defaults used):', errors.map((e) => `${e.path}: ${e.message}`).join('; '));
  // Personalizado screens saved before 0.17 on the legacy 12×8 grid: validateConfig converted them (positions and
  // boxes doubled, the same look); the file is written converted once, after a backup of the file as it was
  const legacyGrid = !migrate && Array.isArray(raw.screens) && raw.screens.some((s) => s && typeof s === 'object' && s.canvas && isLegacyCanvas(s.canvas));
  if (legacyGrid) {
    try {
      const b = writeBackup(raw, 'save');
      writeFileAtomic(paths.config, JSON.stringify(value, null, 2));
      console.log(`[store] custom screens converted to the 24×16 grid (they look the same); previous file in backups/${b?.id ?? ''}`);
      migratedOnLoad = { ...(migratedOnLoad || {}), canvasGrid: 'fine' };
    } catch (err) {
      console.error('[store] custom screen grid conversion could not be persisted:', err.message);
    }
  }
  if (legacyAccess && !migrate) {
    try {
      writeFileAtomic(paths.config, JSON.stringify(value, null, 2));
      console.log('[store] display access set to "open" for this existing install (switch to private links in the admin: Security)');
      migratedOnLoad = { ...(migratedOnLoad || {}), displayAccess: 'open' };
    } catch (err) {
      console.error('[store] display access migration could not be persisted:', err.message);
    }
  }
  if (migrate) {
    try {
      const dest = path.join(paths.backups, 'config-v1-premigration.json');
      if (!fs.existsSync(dest)) fs.copyFileSync(paths.config, dest);
      writeFileAtomic(paths.config, JSON.stringify(value, null, 2));
      console.log(`[store] config migrated to v${value.version} (${value.screens.length} screen); v1 copy in ${dest}`);
      migratedOnLoad = { from: Number(raw.version) || 1, to: value.version, ...(legacyAccess ? { displayAccess: 'open' } : {}) };
    } catch (err) {
      console.error('[store] config migration could not be persisted:', err.message);
    }
  }
  mergeIconRuleUpdates(value);
  return value;
}

/**
 * One-time, additive update of the icon rules in an existing config (v2 rule set: more keywords in English,
 * Spanish and Portuguese, and new categories; v3: Dutch and Danish keywords). Rules the user kept from the defaults
 * gain the missing keywords; new default rules are appended after the user's own, so custom rules keep their
 * priority. Nothing is removed.
 * A marker file in the data folder makes it run once: rules deleted afterwards stay deleted.
 */
const ICON_RULES_MARKER = '.iconrules-v3';
function mergeIconRuleUpdates(cfg) {
  const marker = path.join(paths.data, ICON_RULES_MARKER);
  if (fs.existsSync(marker)) return;
  const rules = cfg.calendar?.iconRules;
  if (Array.isArray(rules)) {
    const byId = new Map(rules.map((r) => [r.id, r]));
    let added = 0;
    for (const def of DEFAULT_ICON_RULES) {
      const mine = byId.get(def.id);
      if (!mine) {
        if (rules.length >= 200) break; // validate.js limit
        rules.push({ ...def, match: [...def.match] });
        added++;
        continue;
      }
      const have = new Set(mine.match.map((m) => m.toLowerCase()));
      for (const m of def.match) {
        if (mine.match.length >= 100) break; // validate.js limit per rule
        if (!have.has(m.toLowerCase())) { mine.match.push(m); added++; }
      }
    }
    if (added) {
      try {
        writeFileAtomic(paths.config, JSON.stringify(cfg, null, 2));
        console.log(`[store] icon rules updated (${added} keywords or rules added)`);
      } catch (err) {
        console.error('[store] icon rules update could not be persisted:', err.message);
        return;
      }
    }
  }
  try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* retried on the next start */ }
}

function loadSecrets() {
  const s = readJson(paths.secrets, { strict: true }) || {};
  s.google ??= {};
  s.google.accounts ??= {};
  s.microsoft ??= {};
  s.microsoft.accounts ??= {}; // Microsoft calendar accounts (server/microsoft.js)
  s.homeassistant ??= {};
  s.weather ??= {}; // { apiKey } of a weather source that needs one (server/weather.js)
  s.immich ??= {}; // { apiKey } of the Immich server (server/immich.js)
  s.prices ??= {}; // { entsoeToken } for the electricity price widget (server/prices.js)
  s.data ??= {}; // { stocksKey } (Finnhub) for the stocks card (server/dataFeeds.js)
  if (!Array.isArray(s.apiTokens)) s.apiTokens = []; // webhook tokens (hashed), see docs/ARCHITECTURE.md
  if (!s.sessionSecret) s.sessionSecret = crypto.randomBytes(32).toString('hex');
  writeFileAtomic(paths.secrets, JSON.stringify(s, null, 2), 0o600);
  return s;
}

export const getConfig = () => config;
export const getSecrets = () => secrets;

/**
 * Validate + save a full config. Returns { ok, errors, config, conflict? }. Bumps revision.
 * Before overwriting, the current file is copied to data/backups/ (rotating, docs/ARCHITECTURE.md).
 * `baseRevision` (the revision the caller's copy was loaded at) turns on the revision guard: when the config was
 * saved since then, nothing is written and the result has `conflict: true`. Without it the last write wins.
 * @param {unknown} input
 * `checks` is passed to validateConfig (the admin save asks for the weather API key check).
 * @param {{ reason?: string, req?: any, backup?: boolean, baseRevision?: number | null, checks?: { weatherKeySet?: boolean } }} [opts] reason/req are passed to 'config' listeners
 */
export function saveConfig(input, { reason = 'server', req = null, backup = true, baseRevision = null, checks = {} } = {}) {
  if (baseRevision !== null && baseRevision !== undefined && baseRevision !== (config?.revision || 0)) {
    return { ok: false, conflict: true, errors: [], config };
  }
  // A config without `security` (old admin build, backup or export from before 0.3) keeps the current display
  // access mode: restoring an old backup must neither open private displays nor lock out open-mode kiosks.
  if (input && typeof input === 'object' && !Array.isArray(input) && input.security === undefined && config?.security) {
    input = { ...input, security: structuredClone(config.security) };
  }
  const { ok, errors, value } = validateConfig(input, checks);
  if (!ok) return { ok, errors, config };
  // a screen saved from the admin as Personalizado for the first time, glass untouched: the Personalizado card glass
  // (the admin does the same when the layout is picked; this covers older admins and other clients)
  if (reason === 'admin') startCanvasGlassOnSave(config, value);
  value.revision = (config?.revision || 0) + 1;
  if (backup) {
    try { backupBeforeSave(config); } catch (err) { console.warn('[store] backup before save failed:', err.message); }
  }
  writeFileAtomic(paths.config, JSON.stringify(value, null, 2));
  const prev = config;
  config = value;
  keepHaTokenOnItsUrl(prev, value);
  events.emit('config', config, prev, { reason, req });
  return { ok: true, errors: [], config };
}

/** Mutate config through a function (for server-side changes, e.g. adding an allowed Google email). */
export function updateConfig(fn, opts = {}) {
  const next = structuredClone(config);
  fn(next);
  return saveConfig(next, opts);
}

const haUrl = (c) => String(c?.homeassistant?.url || '').trim().replace(/\/+$/, '');

/**
 * The Home Assistant URL changed: a stored token saved before tokens were tied to a URL is tied to the old one now,
 * so it is never sent to the new URL (homeassistant.js tokenForOtherUrl) until the owner saves it again for it.
 */
function keepHaTokenOnItsUrl(prev, next) {
  const sec = secrets?.homeassistant;
  if (!prev || !sec?.token || typeof sec.url === 'string' || haUrl(prev) === haUrl(next)) return;
  updateSecrets((s) => { s.homeassistant.url = haUrl(prev); });
}

export function updateSecrets(fn) {
  fn(secrets);
  writeFileAtomic(paths.secrets, JSON.stringify(secrets, null, 2), 0o600);
  return secrets;
}

/** Persist the in-memory secrets as they are (after in-place mutations such as token usage counters). */
export const flushSecrets = () => updateSecrets(() => {});
