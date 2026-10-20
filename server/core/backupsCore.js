// Pure backup, export and import logic: export bundles, import parsing, preview and merge, and the repair used when
// restoring old backups. No file or network access, so Marco Cloud runs the same code; server/backups.js keeps the
// backup files in data/backups/ and re-exports everything here.
import { validateConfig, mergeDefaults, isV1 } from './validate.js';
import { RESERVED_SOURCE_IDS, defaultConfig, defaultScreenProfile } from './defaults.js';
import { stableStringify } from './lib/text.js';
import { countNoun, countChanged, summaryWord } from './lib/i18n.js';
import { carouselList, targetInfo } from './carousels.js';
import { IMMICH_KEY_RE } from './immichCore.js';
import { FAMILY_KEY_RE } from './familyCore.js';
import { exportAccessPeople, importAccessPeople } from './familyAccessCore.js';

/** Rotated backups kept per installation (or per household in the cloud). */
export const KEEP_BACKUPS = 20;
/** Saves within this window after a `save` backup do not make a new one (a burst keeps the state before it). */
export const COALESCE_MS = 120_000;

// ---------------------------------------------------------------------------------------------------------
// Export / import (§6.2, §6.3)
// ---------------------------------------------------------------------------------------------------------

/** Secrets included in an export when asked (never sessionSecret / sessionEpoch). */
export function exportSecrets(sec) {
  return structuredClone({
    ...(sec.passwordHash ? { passwordHash: sec.passwordHash } : {}),
    homeassistant: { ...(sec.homeassistant?.token ? { token: sec.homeassistant.token } : {}) },
    // A weather source's own API key (Pirate Weather), only when one is stored.
    ...(sec.weather?.apiKey ? { weather: { apiKey: sec.weather.apiKey } } : {}),
    // The Immich API key, only when one is stored.
    ...(sec.immich?.apiKey ? { immich: { apiKey: sec.immich.apiKey } } : {}),
    // The ENTSO-E token of the price widget, only when one is stored.
    ...(sec.prices?.entsoeToken ? { prices: { entsoeToken: sec.prices.entsoeToken } } : {}),
    // The Finnhub key of the stocks card, only when one is stored.
    ...(sec.data?.stocksKey ? { data: { stocksKey: sec.data.stocksKey } } : {}),
    google: { accounts: sec.google?.accounts || {} },
    ...(sec.microsoft?.accounts && Object.keys(sec.microsoft.accounts).length ? { microsoft: { accounts: sec.microsoft.accounts } } : {}),
    apiTokens: sec.apiTokens || [],
    // Private display links and paired devices (token hashes only): an import on a new server keeps every
    // screen's link and paired device working.
    displayKeys: sec.displayKeys || {},
    devices: sec.devices || [],
    // The family link, so the phones keep working after a rebuild.
    ...(typeof sec.family?.key === 'string' && FAMILY_KEY_RE.test(sec.family.key) ? { family: { key: sec.family.key, createdAt: sec.family.createdAt ?? null } } : {}),
    // The people of family access (#16), their link and phones (digests only), so those phones keep working too.
    ...(Array.isArray(sec.familyAccess) && sec.familyAccess.length ? { familyAccess: exportAccessPeople(sec.familyAccess) } : {}),
  });
}

/**
 * `familyState` = the family state (routines done, rewards redeemed, stars; data/family.json here): always in the
 * bundle when there is one, it holds no secret; an import that takes the `family` section restores it.
 * `familyPhotos` = the members' profile photos ({ id: base64 }, server/familyPhotos.js), restored with the family
 * section too.
 */
export function makeBundle(cfg, { appVersion, secrets = null, now = new Date(), familyState = null, familyPhotos = null }) {
  return {
    format: 'marco-backup',
    formatVersion: 1,
    exportedAt: now.toISOString(),
    appVersion,
    config: structuredClone(cfg),
    ...(familyState ? { familyState: structuredClone(familyState) } : {}),
    ...(familyPhotos && Object.keys(familyPhotos).length ? { familyPhotos: { ...familyPhotos } } : {}),
    ...(secrets ? { secrets: exportSecrets(secrets) } : {}),
  };
}

/** The bundle's family state (an object) or null (a bare config, an older export). */
export const bundleFamilyState = (bundle) => (isObj(bundle) && bundle.format === 'marco-backup' && isObj(bundle.familyState) ? bundle.familyState : null);

/**
 * The bundle's profile photos ({ id: base64 }) or null. Exports of the older calendar-screen format carry them under
 * the same name.
 */
export const bundleFamilyPhotos = (bundle) => (isObj(bundle) && (bundle.format === 'marco-backup' || bundle.format === 'calendar-screen-backup') && isObj(bundle.familyPhotos) ? bundle.familyPhotos : null);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Accepts an ExportBundle or a bare v1/v2 config. Returns { raw, secrets, appVersion, exportedAt } or null. */
export function unwrapBundle(bundle) {
  if (!isObj(bundle)) return null;
  if (bundle.format === 'marco-backup') {
    if (!isObj(bundle.config)) return null;
    return {
      raw: bundle.config,
      secrets: isObj(bundle.secrets) ? bundle.secrets : null,
      appVersion: typeof bundle.appVersion === 'string' ? bundle.appVersion.slice(0, 40) : null,
      exportedAt: typeof bundle.exportedAt === 'string' ? bundle.exportedAt.slice(0, 40) : null,
    };
  }
  // Bare config: must look like one (screens[] or v1 sections).
  if (Array.isArray(bundle.screens) || isObj(bundle.calendar) || isObj(bundle.screen)) {
    return { raw: bundle, secrets: null, appVersion: null, exportedAt: null };
  }
  return null;
}

const DISPLAY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Sanitised secrets from a bundle (only well-formed parts; unknown keys dropped). */
export function sanitizeImportedSecrets(s) {
  if (!isObj(s)) return {};
  const out = {};
  if (typeof s.passwordHash === 'string' && /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(s.passwordHash)) out.passwordHash = s.passwordHash;
  if (isObj(s.homeassistant) && typeof s.homeassistant.token === 'string' && s.homeassistant.token.length <= 1000) {
    out.haToken = s.homeassistant.token;
  }
  if (isObj(s.weather) && typeof s.weather.apiKey === 'string' && /^[A-Za-z0-9_-]{0,128}$/.test(s.weather.apiKey)) {
    out.weatherKey = s.weather.apiKey;
  }
  if (isObj(s.immich) && typeof s.immich.apiKey === 'string' && (s.immich.apiKey === '' || IMMICH_KEY_RE.test(s.immich.apiKey))) {
    out.immichKey = s.immich.apiKey;
  }
  if (isObj(s.prices) && typeof s.prices.entsoeToken === 'string' && /^(?:[A-Za-z0-9-]{20,64})?$/.test(s.prices.entsoeToken)) {
    out.entsoeToken = s.prices.entsoeToken;
  }
  if (isObj(s.data) && typeof s.data.stocksKey === 'string' && /^(?:[A-Za-z0-9_-]{10,64})?$/.test(s.data.stocksKey)) {
    out.stocksKey = s.data.stocksKey;
  }
  if (isObj(s.google) && isObj(s.google.accounts)) {
    const acc = {};
    for (const [email, a] of Object.entries(s.google.accounts).slice(0, 20)) {
      if (/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email) && isObj(a)) acc[email.toLowerCase()] = a;
    }
    out.googleAccounts = acc;
  }
  if (isObj(s.microsoft) && isObj(s.microsoft.accounts)) {
    const acc = {};
    for (const [email, a] of Object.entries(s.microsoft.accounts).slice(0, 20)) {
      if (/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email) && isObj(a) && typeof a.refresh_token === 'string') acc[email.toLowerCase()] = a;
    }
    out.microsoftAccounts = acc;
  }
  if (Array.isArray(s.apiTokens)) {
    out.apiTokens = s.apiTokens.filter((t) => isObj(t) && typeof t.id === 'string' && /^[a-f0-9]{64}$/.test(t.hash || '')
      && typeof t.name === 'string').slice(0, 20).map((t) => ({
      id: t.id.slice(0, 40), name: t.name.slice(0, 60), hash: t.hash, prefix: String(t.prefix || '').slice(0, 8),
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
      lastUsedAt: typeof t.lastUsedAt === 'string' ? t.lastUsedAt : null,
      lastUsedIp: typeof t.lastUsedIp === 'string' ? t.lastUsedIp.slice(0, 64) : null,
      useCount: Number.isInteger(t.useCount) && t.useCount >= 0 ? t.useCount : 0,
    }));
  }
  if (isObj(s.displayKeys)) {
    const keys = {};
    for (const [screenId, v] of Object.entries(s.displayKeys).slice(0, 50)) {
      if (/^[A-Za-z0-9_-]{1,64}$/.test(screenId) && isObj(v) && typeof v.key === 'string' && DISPLAY_KEY_RE.test(v.key)) {
        keys[screenId] = { key: v.key, createdAt: typeof v.createdAt === 'string' ? v.createdAt.slice(0, 40) : new Date().toISOString() };
      }
    }
    if (Object.keys(keys).length) out.displayKeys = keys;
  }
  if (isObj(s.family) && typeof s.family.key === 'string' && FAMILY_KEY_RE.test(s.family.key)) {
    out.familyKey = { key: s.family.key, createdAt: typeof s.family.createdAt === 'string' ? s.family.createdAt.slice(0, 40) : new Date().toISOString() };
  }
  if (Array.isArray(s.familyAccess)) out.familyAccess = importAccessPeople(s.familyAccess);
  if (Array.isArray(s.devices)) {
    out.devices = s.devices.filter((d) => isObj(d) && /^dv_[a-f0-9]{12}$/.test(d.id || '') && /^[a-f0-9]{64}$/.test(d.hash || '')
      && typeof d.screenId === 'string' && typeof d.name === 'string').slice(0, 50).map((d) => ({
      id: d.id, name: d.name.slice(0, 60), screenId: d.screenId.slice(0, 64), hash: d.hash, prefix: String(d.prefix || '').slice(0, 7),
      createdAt: typeof d.createdAt === 'string' ? d.createdAt.slice(0, 40) : new Date().toISOString(),
      lastSeenAt: typeof d.lastSeenAt === 'string' ? d.lastSeenAt.slice(0, 40) : null,
      lastIp: typeof d.lastIp === 'string' ? d.lastIp.slice(0, 64) : null,
      userAgent: typeof d.userAgent === 'string' ? d.userAgent.slice(0, 300) : '',
    }));
  }
  return out;
}

/** Validate an import bundle → { ok, errors, value, fromVersion, … } (value = sanitised v2 config). */
export function parseImport(bundle) {
  const u = unwrapBundle(bundle);
  if (!u) return { ok: false, errors: [{ path: '', message: 'not a marco backup or config' }] };
  const fromVersion = isV1(u.raw) ? 1 : Number(u.raw.version) || 2;
  const { ok, errors, value } = validateConfig(mergeDefaults(structuredClone(u.raw)));
  return { ok, errors, value, fromVersion, secrets: u.secrets, appVersion: u.appVersion, exportedAt: u.exportedAt };
}

const same = (a, b) => stableStringify(a) === stableStringify(b);
const named = (x) => x.name || x.title || x.id;

/** added / removed / changed (by id) between two lists of { id, name }. */
function diffById(before = [], after = []) {
  const a = new Map(before.map((x) => [x.id, x]));
  const b = new Map(after.map((x) => [x.id, x]));
  return {
    added: [...b.values()].filter((x) => !a.has(x.id)).map(named),
    removed: [...a.values()].filter((x) => !b.has(x.id)).map(named),
    changed: [...b.values()].filter((x) => a.has(x.id) && !same(a.get(x.id), x)).map(named),
  };
}

/** "+2 fuentes, −1 fuente, 1 modificada" / "+2 sources, −1 source, 1 modified" in the admin's language. */
function listSummary(d, noun, l) {
  const parts = [];
  if (d.added.length) parts.push(`+${countNoun(d.added.length, noun, l)}`);
  if (d.removed.length) parts.push(`−${countNoun(d.removed.length, noun, l)}`);
  if (d.changed.length) parts.push(countChanged(d.changed.length, noun, l));
  return parts.join(', ');
}

/** Top-level keys that make up a v2 config (except version/revision). */
export const IMPORT_SECTIONS = ['screens', 'defaultScreen', 'calendar', 'datetime', 'weather', 'news', 'todo', 'localEvents',
  'birthdays', 'eventRules', 'countdowns', 'schedules', 'carousels', 'widgets', 'homeassistant', 'immich', 'auth', 'family'];

/** Short localized summary of what changes per section (ImportPreview.sections); `l` = es | en | pt. */
export function sectionSummaries(cur, next, l = 'en', absent = new Set()) {
  const out = [];
  const modified = summaryWord('modified', l);
  for (const key of IMPORT_SECTIONS) {
    // a section the file does not carry (e.g. a Marco Cloud export has no sign-in or Home Assistant settings) keeps
    // the current value: it is never offered as a change
    const changed = !absent.has(key) && !same(cur[key], next[key]);
    let summary = changed ? modified : summaryWord('unchanged', l);
    if (changed) {
      if (key === 'screens') summary = listSummary(diffById(cur.screens, next.screens), 'screen', l) || modified;
      else if (key === 'calendar') {
        const parts = [];
        const s = listSummary(diffById(cur.calendar.sources, next.calendar.sources), 'source', l);
        if (s) parts.push(s);
        if (!same(cur.calendar.iconRules, next.calendar.iconRules)) parts.push(countNoun(next.calendar.iconRules.length, 'iconRule', l));
        summary = parts.join('; ') || modified;
      } else if (key === 'defaultScreen') {
        summary = `→ ${next.screens.find((s) => s.id === next.defaultScreen)?.name || next.defaultScreen}`;
      } else if (key === 'family') {
        const f = next.family;
        summary = [countNoun(f.members.length, 'member', l), countNoun(f.chores.length, 'chore', l), countNoun(f.rewards.length, 'reward', l)].join(', ');
      } else if (key === 'news') {
        summary = listSummary(diffById(cur.news.feeds, next.news.feeds), 'feed', l) || modified;
      } else if (next[key] && Array.isArray(next[key].items)) {
        const d = diffById(cur[key].items, next[key].items);
        summary = listSummary(d, 'item', l) || summaryWord('settingsModified', l);
      }
    }
    out.push({ key, changed, summary });
  }
  return out;
}

/** A bundle with the family state replaces the stars and the history too (data/family.json): the family line says so. */
function familyStateNote(sections, bundle, l) {
  if (!bundleFamilyState(bundle)) return sections;
  const note = summaryWord('familyState', l);
  return sections.map((s) => (s.key !== 'family' || absentSections(bundle).has('family') ? s
    : { ...s, changed: true, summary: s.changed ? `${s.summary}; ${note}` : note }));
}

/**
 * Enabled scheduled messages that would lose every target screen on a partial import (they get disabled
 * on save, since an empty target list means "all screens").
 *   screensOnly:   current messages when only `screens` is taken from the bundle
 *   schedulesOnly: imported messages when only `schedules` is taken
 */
export function orphanSchedules(current, imported) {
  const lost = (items, screens) => {
    const ids = new Set(screens.map((s) => s.id));
    return items.filter((m) => m.enabled && m.screenIds.length && !m.screenIds.some((x) => ids.has(x)))
      .map((m) => `${m.emoji ? `${m.emoji} ` : ''}${m.title || m.id}`);
  };
  return {
    screensOnly: lost(current.schedules.items, imported.screens),
    schedulesOnly: lost(imported.schedules.items, current.screens),
  };
}

/**
 * What importing the bundle's secrets would do to display access: screens whose private link would change (old
 * links come back / current ones stop working) and paired devices that would be dropped or added. Null when the
 * bundle carries no display secrets.
 */
function secretsImpact(raw, cur, current, imported) {
  const s = sanitizeImportedSecrets(raw);
  if (!s.displayKeys && !s.devices) return null;
  // screens and carousels both have a private link (displayKeys is keyed by either id)
  const name = (id) => (targetInfo(imported, id) || targetInfo(current, id))?.name || id;
  // current carousels count too: a file without carousels keeps them, and their keys are still merged
  const known = (id) => imported.screens.some((x) => x.id === id) || carouselList(imported).some((x) => x.id === id)
    || carouselList(current).some((x) => x.id === id);
  const curKeys = isObj(cur?.displayKeys) ? cur.displayKeys : {};
  const curDevices = Array.isArray(cur?.devices) ? cur.devices : [];
  const linksChanged = s.displayKeys
    ? Object.keys(s.displayKeys).filter((id) => curKeys[id]?.key && curKeys[id].key !== s.displayKeys[id].key && known(id)).map(name)
    : [];
  const nextIds = new Set((s.devices || curDevices).map((d) => d.id));
  const prevIds = new Set(curDevices.map((d) => d.id));
  return {
    linksChanged,
    devicesRemoved: curDevices.filter((d) => !nextIds.has(d.id)).map((d) => d.name || d.id),
    devicesAdded: (s.devices || []).filter((d) => !prevIds.has(d.id)).length,
  };
}

/** Import sections missing from a v2 file (a v1 file is migrated whole, so nothing counts as missing there). */
export function absentSections(bundle) {
  const u = unwrapBundle(bundle);
  if (!u || !isObj(u.raw) || isV1(u.raw)) return new Set();
  return new Set(IMPORT_SECTIONS.filter((k) => !(k in u.raw)));
}

/** ImportPreview (web/shared/types.ts) for `bundle` against the current config. */
export function importPreview(bundle, current, l = 'en', currentSecrets = null) {
  const p = parseImport(bundle);
  const empty = { added: [], removed: [], changed: [] };
  if (!p.value) {
    return {
      ok: false, errors: p.errors, fromVersion: 0, appVersion: null, exportedAt: null, hasSecrets: false,
      sections: [], screens: empty, sources: empty, orphanSchedules: { screensOnly: [], schedulesOnly: [] },
      counts: { localEvents: 0, birthdays: 0, eventRules: 0, countdowns: 0, schedules: 0 },
    };
  }
  const v = p.value;
  const userSources = (c) => c.calendar.sources.filter((s) => !RESERVED_SOURCE_IDS.includes(s.id));
  return {
    ok: p.ok,
    errors: p.errors,
    fromVersion: p.fromVersion,
    appVersion: p.appVersion,
    exportedAt: p.exportedAt,
    hasSecrets: Boolean(p.secrets && Object.keys(sanitizeImportedSecrets(p.secrets)).length),
    secretsImpact: secretsImpact(p.secrets, currentSecrets, current, v),
    sections: familyStateNote(sectionSummaries(current, v, l, absentSections(bundle)), bundle, l),
    screens: diffById(current.screens, v.screens),
    sources: diffById(userSources(current), userSources(v)),
    orphanSchedules: orphanSchedules(current, v),
    counts: {
      localEvents: v.localEvents.items.length,
      birthdays: v.birthdays.items.length,
      eventRules: v.eventRules.items.length,
      countdowns: v.countdowns.items.length,
      schedules: v.schedules.items.length,
    },
  };
}

/**
 * Merge an imported (validated) config into the current one. `sections` limits which top-level keys are
 * taken (others kept). `screens`, `defaultScreen` and `carousels` travel together (a default id must exist, and
 * carousel steps point at screens).
 */
export function mergeImport(current, imported, sections, absent = new Set()) {
  // sections the file does not carry are never taken from it (they would come back as defaults)
  const all = !Array.isArray(sections) || !sections.length;
  if (all && !absent.size) return { ...structuredClone(imported), revision: current.revision };
  const take = new Set((all ? IMPORT_SECTIONS : sections).filter((s) => IMPORT_SECTIONS.includes(s) && !absent.has(s)));
  if (take.has('screens')) take.add('defaultScreen');
  // carousels only make sense with the screens they show: they travel with them (unless the file has none)
  if (take.has('screens') && !absent.has('carousels')) take.add('carousels');
  // the same for widgets: screens place them (a file without widgets keeps the current ones)
  if (take.has('screens') && !absent.has('widgets')) take.add('widgets');
  const out = structuredClone(current);
  for (const k of take) out[k] = structuredClone(imported[k]);
  if (!out.screens.some((s) => s.id === out.defaultScreen)) out.defaultScreen = out.screens[0].id;
  // screens and carousels can come from different sides (an older file has no carousels, or only one of them was
  // picked): a carousel whose address is now a screen's gets a free one, so the import is not refused on save
  const used = new Set(out.screens.map((s) => s.slug));
  for (const c of carouselList(out)) {
    let slug = c.slug;
    for (let i = 2; used.has(slug); i++) slug = `${c.slug.slice(0, 29)}-${i}`;
    c.slug = slug;
    used.add(slug);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Repair (restore of old backups)
// ---------------------------------------------------------------------------------------------------------

/** "a.b[2].c" → ['a', 'b', 2, 'c'] */
function splitPath(p) {
  const out = [];
  for (const part of String(p).split('.')) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) return null;
    if (m[1]) out.push(m[1]);
    for (const i of m[2].matchAll(/\[(\d+)\]/g)) out.push(Number(i[1]));
  }
  return out;
}

function getIn(o, segs) {
  let x = o;
  for (const s of segs) { if (x == null) return undefined; x = x[s]; }
  return x;
}

/** Fix the value behind one validation error path. Returns true when something changed. */
function fixPath(cfg, errPath) {
  const segs = splitPath(errPath);
  if (!segs || !segs.length) return false;
  let k = -1;
  segs.forEach((s, i) => { if (typeof s === 'number') k = i; });
  const isScreen = k === 1 && segs[0] === 'screens';
  if (k >= 0 && !isScreen) {
    // Broken list item (event, rule, feed…): drop it.
    const list = getIn(cfg, segs.slice(0, k));
    if (!Array.isArray(list) || segs[k] >= list.length) return false;
    list.splice(segs[k], 1);
    return true;
  }
  // Plain setting: reset it to its default (screen settings → default screen profile).
  const base = isScreen ? getIn(cfg, segs.slice(0, 2)) : cfg;
  const rest = isScreen ? segs.slice(2) : segs;
  if (!base || !rest.length) return false;
  const def = getIn(isScreen ? defaultScreenProfile() : defaultConfig(), rest);
  const parent = getIn(base, rest.slice(0, -1));
  if (!parent || typeof parent !== 'object') return false;
  const leaf = rest[rest.length - 1];
  if (stableStringify(parent[leaf]) === stableStringify(def)) return false;
  if (def === undefined) delete parent[leaf];
  else parent[leaf] = structuredClone(def);
  return true;
}

/**
 * Make an (already sanitised) config valid by dropping list items that still fail validation and
 * resetting other failing settings to their defaults. Used when restoring old backups.
 * @returns {{ ok: boolean, value: object|null, fixed: string[], errors: object[] }}
 */
export function repairConfig(cfg) {
  let cur = structuredClone(cfg);
  const fixed = [];
  for (let i = 0; i < 300; i++) {
    const r = validateConfig(cur);
    if (r.ok) return { ok: true, value: r.value, fixed, errors: [] };
    cur = r.value;
    const e = r.errors.find((x) => fixPath(cur, x.path));
    if (!e) return { ok: false, value: null, fixed, errors: r.errors };
    fixed.push(e.path);
  }
  return { ok: false, value: null, fixed, errors: [{ path: '', message: 'could not repair' }] };
}
