// Familia: the state file data/family.json (routines done, rewards redeemed, stars given by hand), the family link
// key (secrets.family), rate limits for the family page and the TV, and the changes themselves: each one goes
// through a familyCore.js reducer, is saved, tells every display (`family` live event) and lands in the activity
// log. The rules are in familyCore.js. See the README (Familia).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getConfig, getSecrets, updateSecrets, paths, writeFileAtomic } from './store.js';
import { publish } from './pollHub.js';
import { logActivity, logActivityThrottled } from './activity.js';
import { clientBucket, publicOrigin, hostnameOf, isLanClient } from './lib/net.js';
import { lanAddresses } from './setup.js';
import { zonedParts, addDays, isDateStr } from './core/lib/tz.js';
import { defaultScreen } from './core/screens.js';
import { photoUrl } from './familyPhotos.js';
import {
  FAMILY_KEY_RE, sanitizeState, pruneState, applyToggle, applyRedeem, applyAdjust, undoEntry,
  adminFamily, phoneFamily, displayFamily, hhmmOf,
} from './core/familyCore.js';

export const KEY_HEADER = 'x-family-key';
/** How many days back the admin may tick or untick a routine. */
export const ADMIN_DAYS_BACK = 7;
/** Wrong or missing family keys: per client address and overall, per window. */
export const BAD_KEY_LIMIT = 20;
export const BAD_KEY_GLOBAL = 200;
export const BAD_KEY_WINDOW_MS = 10 * 60_000;
/** With a valid key: requests per minute per address, and toggles + redeems per minute for the key. */
export const REQUESTS_PER_MIN = 120;
export const ACTIONS_PER_MIN = 40;
/** Touches on a TV: toggles per minute per screen. */
export const DISPLAY_TOGGLES_PER_MIN = 30;

const pad = (n) => String(n).padStart(2, '0');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

/** today (YYYY-MM-DD), hh:mm and the ISO time, in the configured zone. */
export function familyClock(cfg = getConfig(), now = new Date()) {
  const p = zonedParts(now, cfg.datetime.timezone);
  return { today: `${String(p.y).padStart(4, '0')}-${pad(p.m)}-${pad(p.d)}`, hhmm: hhmmOf(p), at: now.toISOString() };
}

// ---------------------------------------------------------------- state file

let state = null;
let loadedFrom = null;

function load() {
  if (state && loadedFrom === paths.family) return state;
  loadedFrom = paths.family;
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(paths.family, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Same as the config: keep the broken file aside and start again (the stars of the old file are in that copy).
      console.warn(`[family] cannot read ${paths.family}: ${err.message}; backing it up and starting empty`);
      try { fs.copyFileSync(paths.family, `${paths.family}.corrupt-${Date.now()}`); } catch { /* ignore */ }
    }
  }
  state = sanitizeState(raw);
  const pruned = pruneState(state, familyClock().today);
  if (pruned !== state) {
    state = pruned;
    save();
  }
  return state;
}

function save() {
  state = pruneState(state, familyClock().today);
  try { writeFileAtomic(paths.family, JSON.stringify(state)); } catch (err) { console.warn('[family] save failed:', err.message); }
}

/** A change is in: save it and tell every display (they refetch their family data). */
function commit(next) {
  state = next;
  save();
  publish('family', { rev: state.rev });
}

/** Tell every display to fetch its family data again (the state or the family link changed). */
export function notifyFamily() {
  publish('family', { rev: load().rev });
}

/** The current state (tests, export). */
export function familyState() {
  return structuredClone(load());
}

/** Copies of the state file kept before an import (`family.json.pre-import-<ms>`). */
const PRE_IMPORT_KEEP = 5;

/**
 * Replace the whole state (import of a backup). The revision keeps going up so displays notice. The file before the
 * import is kept next to it (`family.json.pre-import-<ms>`, the newest 5), like a broken one: an older export
 * would otherwise take months of stars with it.
 */
export function replaceFamilyState(raw) {
  const cur = load();
  try {
    if (fs.existsSync(paths.family)) {
      fs.copyFileSync(paths.family, `${paths.family}.pre-import-${Date.now()}`);
      const dir = path.dirname(paths.family);
      const prefix = `${path.basename(paths.family)}.pre-import-`;
      const old = fs.readdirSync(dir).filter((n) => n.startsWith(prefix)).sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
      for (const n of old.slice(0, Math.max(0, old.length - PRE_IMPORT_KEEP))) fs.rmSync(path.join(dir, n), { force: true });
    }
  } catch (err) { console.warn('[family] cannot keep a copy before the import:', err.message); }
  const next = pruneState(sanitizeState(raw), familyClock().today);
  commit({ ...next, rev: Math.max(cur.rev, next.rev) + 1 });
  return state;
}

// ---------------------------------------------------------------- family link key

/** The stored family key ({ key, createdAt }) or null. */
export function familyKey() {
  const f = getSecrets()?.family;
  return f && typeof f.key === 'string' && FAMILY_KEY_RE.test(f.key) ? f : null;
}

/** Constant-time check of a presented key. */
export function checkFamilyKey(given) {
  const f = familyKey();
  const g = typeof given === 'string' ? given.trim() : '';
  // compare even without a stored key or with a malformed one, so the answer takes the same time
  const ok = crypto.timingSafeEqual(sha(f?.key ?? 'none'), sha(g));
  return Boolean(f && FAMILY_KEY_RE.test(g) && ok);
}

/** FamilyAdminState.link: the key is shown to the admin only (it is in the path). */
export function familyLinkInfo() {
  const f = familyKey();
  return f ? { exists: true, path: `/f/${f.key}`, createdAt: f.createdAt ?? null } : { exists: false, path: null, createdAt: null };
}

/** Create the family link, or replace it (the old one stops working at once). */
export function rotateFamilyLink({ req } = {}) {
  const existed = Boolean(familyKey());
  const k = { key: `fk_${crypto.randomBytes(24).toString('base64url')}`, createdAt: new Date().toISOString() };
  updateSecrets((s) => { s.family = k; });
  logActivity('family.link', { req, level: 'warn', data: { action: existed ? 'regenerated' : 'created' } });
  // the QR on the TVs changes
  notifyFamily();
  return familyLinkInfo();
}

/** Remove the family link. False when there was none. */
export function revokeFamilyLink({ req } = {}) {
  if (!familyKey()) return false;
  updateSecrets((s) => { delete s.family; });
  logActivity('family.link', { req, level: 'warn', data: { action: 'revoked' } });
  notifyFamily();
  return true;
}

/**
 * A display we know: link key, paired device or admin session, or the open mode from the local network (the kiosk
 * at home). Only these see the family link or may tick routines; open mode through PUBLIC_URL or a tunnel does not.
 */
export function trustedDisplay(req) {
  const a = req?.displayAccess;
  return ['key', 'device', 'session'].includes(a?.via) || (a?.via === 'open' && isLanClient(req));
}

/**
 * Where a phone on the network opens the family page: PUBLIC_URL when set, else the address the TV itself used
 * (when it is not this machine), else this machine's LAN address. Null without a link or an address, and for a
 * display that is not trusted (the link lets its holder tick routines).
 */
export function familyQrUrl(req) {
  const f = familyKey();
  if (!f || !trustedDisplay(req)) return null;
  const origin = familyOrigin(req);
  return origin ? `${origin}/f/${f.key}` : null;
}

/**
 * The origin a phone at home can open: PUBLIC_URL, else the address this request used (when it is not this machine),
 * else this machine's LAN address. Null when none is known. Also used for the family access codes (familyAccess.js).
 */
export function familyOrigin(req) {
  const pub = publicOrigin();
  if (pub) return pub;
  const host = String(req?.get?.('host') || '');
  const name = hostnameOf(host);
  const loopback = !name || name === 'localhost' || name.endsWith('.localhost') || name.startsWith('127.') || name === '::1';
  if (!loopback) return `${req.protocol === 'https' ? 'https' : 'http'}://${host}`;
  const lan = lanAddresses()[0];
  if (!lan) return null;
  const port = /:(\d+)$/.exec(host)?.[1] || String(Number(process.env.PORT) || 3000);
  return `http://${lan}:${port}`;
}

// ---------------------------------------------------------------- rate limits (memory)

const badByIp = new Map(); // ip bucket → ms[]
let badAll = []; // ms[]
const okByIp = new Map(); // ip bucket → ms[]
const actions = new Map(); // key hash → ms[]
const displayToggles = new Map(); // screen id → ms[]

const fresh = (list, ms, now) => (list || []).filter((t) => now - t < ms);

/** Record a hit in `map[key]` unless `limit` hits already happened in the last `ms`. True when allowed. */
function allow(map, key, ms, limit, now) {
  const l = fresh(map.get(key), ms, now);
  if (l.length >= limit) { map.set(key, l); return false; }
  l.push(now);
  map.set(key, l);
  if (map.size > 5000) for (const [k, v] of map) if (!fresh(v, ms, now).length) map.delete(k);
  return true;
}

const rejected = (req, reason) => logActivityThrottled('family.key_rejected', `${clientBucket(req)}|${reason}`,
  { everyMs: BAD_KEY_WINDOW_MS, perMinute: 5 }, { req, level: 'warn', data: { reason } });

/**
 * Express middleware for /api/family/*: the X-Family-Key header must hold the family key. Wrong and missing keys
 * count against the address and against everyone; once either limit is reached wrong keys get 429 until the window
 * passes. The right key is checked first and never locked out by others (it has its own per-address limit), so
 * someone guessing cannot keep the family off their page.
 */
export function familyKeyAuth(req, res, next) {
  // a CORS preflight carries no key and gets no CORS headers: it fails without counting as a wrong try
  if (req.method === 'OPTIONS') return res.status(204).end();
  const now = Date.now();
  const ip = clientBucket(req);
  const given = req.get(KEY_HEADER);
  if (given && checkFamilyKey(given)) {
    if (!allow(okByIp, ip, 60_000, REQUESTS_PER_MIN, now)) {
      res.set('retry-after', '60');
      return res.status(429).json({ error: 'too many requests, wait a minute', code: 'rate_limited' });
    }
    if (!getConfig().family.enabled) return res.status(404).json({ error: 'family is off', code: 'family_off' });
    return next();
  }
  badAll = fresh(badAll, BAD_KEY_WINDOW_MS, now);
  const mine = fresh(badByIp.get(ip), BAD_KEY_WINDOW_MS, now);
  if (mine.length >= BAD_KEY_LIMIT || badAll.length >= BAD_KEY_GLOBAL) {
    badByIp.set(ip, mine);
    rejected(req, 'rate_limited');
    res.set('retry-after', String(BAD_KEY_WINDOW_MS / 1000));
    return res.status(429).json({ error: 'too many tries, wait a few minutes', code: 'rate_limited' });
  }
  mine.push(now);
  badByIp.set(ip, mine);
  if (badByIp.size > 5000) for (const [k, v] of badByIp) if (!fresh(v, BAD_KEY_WINDOW_MS, now).length) badByIp.delete(k);
  badAll.push(now);
  if (!given) return res.status(401).json({ error: 'family key required', code: 'key_required' });
  rejected(req, 'invalid_key');
  return res.status(403).json({ error: 'this family link is no longer valid', code: 'invalid_key' });
}

/** Toggles and redeems of the family key: true when allowed. */
export function allowFamilyAction(now = Date.now()) {
  return allow(actions, sha(familyKey()?.key || '').toString('hex').slice(0, 16), 60_000, ACTIONS_PER_MIN, now);
}

/** Touches on one screen: true when allowed. */
export const allowDisplayToggle = (screenId, now = Date.now()) => allow(displayToggles, screenId, 60_000, DISPLAY_TOGGLES_PER_MIN, now);

// ---------------------------------------------------------------- changes

const memberName = (cfg, id) => cfg.family.members.find((m) => m.id === id)?.name || id;
/** Who did it in the activity log: the admin's session, or the family page / a TV. */
const actorOf = (by, screen) => (by === 'phone' ? { actor: 'family-link' } : by === 'display' ? { actor: `display:${screen?.slug || ''}` } : {});

/**
 * Tick or untick a routine. `date` (admin only): today or up to ADMIN_DAYS_BACK days back; the family page and the
 * TVs only change today.
 * @returns {{ ok: true, changed: boolean } | { error: string }}
 */
export function toggleChore({ choreId, date, done, by = 'admin', screen = null, req = null }) {
  load();
  const cfg = getConfig();
  const c = familyClock(cfg);
  const day = date ?? c.today;
  if (!isDateStr(day) || day > c.today || day < addDays(c.today, by === 'admin' ? -ADMIN_DAYS_BACK : 0)) return { error: 'bad_date' };
  if (typeof choreId !== 'string') return { error: 'unknown_chore' };
  const r = applyToggle(cfg.family, state, { choreId, date: day, done: Boolean(done), by, at: c.at });
  if (r.error) return r;
  if (r.changed) {
    commit(r.state);
    logActivity('family.chore', {
      req, ...actorOf(by, screen),
      data: {
        member: r.member.name, chore: r.chore.title, done: Boolean(done), via: by,
        ...(screen ? { screen: screen.slug } : {}), ...(day !== c.today ? { date: day } : {}),
      },
    });
  }
  return { ok: true, changed: r.changed };
}

/** Redeem a reward for a kid (family page or admin; `force` = admin going below zero). */
export function redeemReward({ rewardId, memberId, by = 'admin', force = false, req = null }) {
  load();
  const cfg = getConfig();
  const r = applyRedeem(cfg.family, state, { rewardId, memberId, by, at: familyClock(cfg).at, force: by === 'admin' && force === true });
  if (r.error) return r;
  commit(r.state);
  logActivity('family.redeemed', { req, ...actorOf(by), data: { member: r.member.name, reward: r.entry.title, cost: r.entry.cost, via: by } });
  return { ok: true, entry: r.entry };
}

/** Stars added or taken by hand (admin). */
export function adjustPoints({ memberId, delta, note = '', req = null }) {
  load();
  const cfg = getConfig();
  const r = applyAdjust(cfg.family, state, { memberId, delta, note, at: familyClock(cfg).at });
  if (r.error) return r;
  commit(r.state);
  logActivity('family.points', { req, data: { member: r.member.name, delta: r.entry.delta, ...(r.entry.note ? { note: r.entry.note } : {}) } });
  return { ok: true, entry: r.entry };
}

/** Undo a redemption (stars come back) or an adjustment (admin). */
export function undoFamilyEntry({ kind, id, req = null }) {
  load();
  const r = undoEntry(state, { kind, id });
  if (r.error) return r;
  commit(r.state);
  const cfg = getConfig();
  logActivity('family.undone', {
    req,
    data: {
      kind, member: memberName(cfg, r.entry.memberId),
      ...(kind === 'redemption' ? { reward: r.entry.title } : { delta: r.entry.delta }),
    },
  });
  return { ok: true };
}

// ---------------------------------------------------------------- projections

/** FamilyAdminState. */
export function adminFamilyState() {
  load();
  const cfg = getConfig();
  return { ...adminFamily(cfg.family, state, { today: familyClock(cfg).today }), link: familyLinkInfo(), lanAddresses: lanAddresses(), publicUrl: publicOrigin() };
}

/** FamilyPhoneState (the language is the default screen's). */
export function phoneFamilyState() {
  load();
  const cfg = getConfig();
  const c = familyClock(cfg);
  return phoneFamily(cfg, state, { today: c.today, hhmm: c.hhmm, lang: defaultScreen(cfg)?.screen?.language || 'en', photoUrl });
}

/** FamilyDisplayState of `screen` (`priv` = its privacy mode is on, `qrUrl` = familyQrUrl()). */
export function displayFamilyState(cfg, screen, { priv = false, qrUrl = null } = {}) {
  load();
  const c = familyClock(cfg);
  return displayFamily(cfg, screen, state, { today: c.today, hhmm: c.hhmm, private: priv, qrUrl, generatedAt: c.at, photoUrl });
}

/** Tests only: forget the in-memory state (next call reloads from disk) and the rate limits. */
export function _resetFamily() {
  state = null;
  loadedFrom = null;
  badByIp.clear();
  badAll = [];
  okByIp.clear();
  actions.clear();
  displayToggles.clear();
}
