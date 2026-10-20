// Family access (#16): the people of the household with a dashboard of their own on the phone (/my), their phones,
// the codes shown on a screen, and the actions those phones may run. The rules (permissions, requests, what the phone
// sees) are core/familyAccessCore.js; this file stores the people in secrets.json (`familyAccess`, never sent to a
// display), keeps the codes and the rate limits in memory, and runs each action through the server's own paths:
// announcements (announce.js), privacy mode (privacy.js), display commands (displays.js) and the config (to-dos and
// local events). See docs/API.md ("Family access") and docs/ARCHITECTURE.md.
//
// secrets.familyAccess: [{ id, name, memberId, perms, createdAt, lastUsedAt,
//   link: { hash, createdAt } | null, devices: [{ id, name, via, hash, createdAt, lastSeenAt, lastIp }] }]
// Tokens and codes are kept as SHA-256 digests only. Every request reads the person again, so a change of
// permissions, a revoked phone or a deleted person counts from the next request on.
import crypto from 'node:crypto';
import { getConfig, getSecrets, updateSecrets, updateConfig } from './store.js';
import { publish } from './pollHub.js';
import { logActivity, logActivityThrottled } from './activity.js';
import { clientBucket } from './lib/net.js';
import { familyOrigin } from './family.js';
import { createAnnouncement, sanitizeAnnounce } from './announce.js';
import { resolveScreenList, runCommand } from './displays.js';
import { applyPrivacy, screenPrivacy } from './privacy.js';
import { defaultScreen } from './core/screens.js';
import { localDate } from './core/lib/tz.js';
import { randomCode } from './core/pairCore.js';
import { newId } from './core/familyCore.js';
import {
  CODE_LENGTH, CODE_TTL_MS, DEVICE_TOKEN_RE, LINK_TOKEN_RE, MAX_DEVICES_PER_PERSON, MAX_PEOPLE, MEMBER_PATH,
  deviceLabel, effectivePerms, emptyPerms, memberEventRequest, memberMessageRequest, memberNightMode, memberPrivacyMode,
  memberState, memberTodoRequest, newLocalEvent, newTodoItem, normalizeAccessCode, sanitizePersonInput,
} from './core/familyAccessCore.js';

export const TOKEN_HEADER = 'x-member-token';
/** Wrong links, device tokens or codes: per client address and overall, per window. */
export const BAD_LIMIT = 20;
export const BAD_GLOBAL = 200;
export const BAD_CODE_LIMIT = 10;
export const BAD_CODE_GLOBAL = 50;
export const BAD_WINDOW_MS = 10 * 60_000;
/** With a valid device: requests per minute per phone, actions per minute per person, messages per 10 minutes. */
export const REQUESTS_PER_MIN = 120;
export const ACTIONS_PER_MIN = 20;
export const MESSAGES_PER_WINDOW = 10;
export const MESSAGE_WINDOW_MS = 10 * 60_000;
/** Codes the admin may show per person and window. */
export const CODES_PER_WINDOW = 10;
const LAST_SEEN_FLUSH_MS = 5 * 60_000;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const shaHex = (s) => sha(s).toString('hex');
const sameHash = (hex, buf) => /^[a-f0-9]{64}$/.test(hex || '') && crypto.timingSafeEqual(Buffer.from(hex, 'hex'), buf);
const actorOf = (person) => `family:${person.name}`;

function people() {
  const s = getSecrets();
  if (!Array.isArray(s.familyAccess)) s.familyAccess = [];
  return s.familyAccess;
}
const findPerson = (id) => people().find((p) => p.id === id) ?? null;

// ---------------------------------------------------------------- rate limits and codes (memory)

const fresh = (list, ms, now) => (list || []).filter((t) => now - t < ms);
const maps = { bad: new Map(), badCode: new Map(), requests: new Map(), actions: new Map(), messages: new Map(), codesShown: new Map() };
let badAll = [];
let badCodeAll = [];
/** sha256(code) hex → { personId, screenId, expiresAt } */
const codes = new Map();
/** device id → ms of the last request not written to secrets.json yet */
const seen = new Map();
let lastFlush = 0;

/** Record a hit in `map[key]` unless `limit` hits already happened in the last `ms`. True when allowed. */
function allow(map, key, ms, limit, now = Date.now()) {
  const l = fresh(map.get(key), ms, now);
  if (l.length >= limit) { map.set(key, l); return false; }
  l.push(now);
  map.set(key, l);
  if (map.size > 5000) for (const [k, v] of map) if (!fresh(v, ms, now).length) map.delete(k);
  return true;
}

/** A wrong credential from `req`: false once the address or everyone together is over the limit. */
function countBad(req, { code = false } = {}, now = Date.now()) {
  const map = code ? maps.badCode : maps.bad;
  const limit = code ? BAD_CODE_LIMIT : BAD_LIMIT;
  const global = code ? BAD_CODE_GLOBAL : BAD_GLOBAL;
  if (code) badCodeAll = fresh(badCodeAll, BAD_WINDOW_MS, now);
  else badAll = fresh(badAll, BAD_WINDOW_MS, now);
  const all = code ? badCodeAll : badAll;
  const ip = clientBucket(req);
  const mine = fresh(map.get(ip), BAD_WINDOW_MS, now);
  if (mine.length >= limit || all.length >= global) { map.set(ip, mine); return false; }
  mine.push(now);
  map.set(ip, mine);
  all.push(now);
  return true;
}

/** Locked out right now (before looking anything up, so a locked address learns nothing). */
function locked(req, { code = false } = {}, now = Date.now()) {
  const map = code ? maps.badCode : maps.bad;
  const all = fresh(code ? badCodeAll : badAll, BAD_WINDOW_MS, now);
  return fresh(map.get(clientBucket(req)), BAD_WINDOW_MS, now).length >= (code ? BAD_CODE_LIMIT : BAD_LIMIT)
    || all.length >= (code ? BAD_CODE_GLOBAL : BAD_GLOBAL);
}

const rejected = (req, reason) => logActivityThrottled('family.access_rejected', `${clientBucket(req)}|${reason}`,
  { everyMs: BAD_WINDOW_MS, perMinute: 5 }, { req, actor: 'anonymous', level: 'warn', data: { reason } });

function pruneCodes(now = Date.now()) {
  for (const [k, c] of codes) if (c.expiresAt <= now || !findPerson(c.personId)) codes.delete(k);
}

// ---------------------------------------------------------------- admin

/** FamilyAccessPerson (no hash, no token). */
function personInfo(p, now = Date.now()) {
  pruneCodes(now);
  const code = [...codes.values()].find((c) => c.personId === p.id);
  const lastSeen = (d) => {
    const m = seen.get(d.id);
    return m ? new Date(Math.max(m, Date.parse(d.lastSeenAt || 0) || 0)).toISOString() : d.lastSeenAt ?? null;
  };
  return {
    id: p.id, name: p.name, memberId: p.memberId ?? null, perms: effectivePerms(p, getConfig()), createdAt: p.createdAt, lastUsedAt: p.lastUsedAt ?? null,
    link: { exists: Boolean(p.link?.hash), createdAt: p.link?.createdAt ?? null },
    devices: (p.devices || []).map((d) => ({ id: d.id, name: d.name, via: d.via === 'code' ? 'code' : 'link', createdAt: d.createdAt, lastSeenAt: lastSeen(d) }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    code: code ? { screenId: code.screenId, expiresAt: new Date(code.expiresAt).toISOString() } : null,
  };
}

/** FamilyAccessPerson[] in the order they were added. */
export const listPeople = () => people().map((p) => personInfo(p));

const newLink = () => {
  const token = `fa_${crypto.randomBytes(24).toString('base64url')}`;
  return { token, stored: { hash: shaHex(token), createdAt: new Date().toISOString() } };
};

/** Add a person. Returns { person, link: { path } } (the only time the link is shown) or { error, status }. */
export function createPerson(body, { req } = {}) {
  if (people().length >= MAX_PEOPLE) return { error: 'too_many_people', status: 409 };
  const r = sanitizePersonInput(body, getConfig());
  if (r.error) return { error: r.error, status: 400 };
  const { token, stored } = newLink();
  let id;
  do id = newId('fp_'); while (findPerson(id));
  const p = { id, name: r.value.name, memberId: r.value.memberId, perms: r.value.perms ?? emptyPerms(), createdAt: new Date().toISOString(), lastUsedAt: null, link: stored, devices: [] };
  updateSecrets((s) => {
    if (!Array.isArray(s.familyAccess)) s.familyAccess = [];
    s.familyAccess.push(p);
  });
  logActivity('family.access', { req, level: 'warn', data: { action: 'created', person: p.name, perms: permList(p) } });
  return { person: personInfo(p), link: { path: `${MEMBER_PATH}/${token}` } };
}

/** The permissions that are on, for the activity log ("message", "privacy"...). */
const permList = (p) => Object.entries(effectivePerms(p, getConfig())).filter(([k, v]) => k !== 'messageScreens' && v === true).map(([k]) => k);

/** Rename a person, link them to a member or change what they may do. */
export function updatePerson(id, body, { req } = {}) {
  const p = findPerson(id);
  if (!p) return { error: 'not_found', status: 404 };
  const r = sanitizePersonInput(body, getConfig(), { partial: true });
  if (r.error) return { error: r.error, status: 400 };
  const before = { name: p.name, perms: permList(p) };
  updateSecrets(() => Object.assign(p, r.value));
  logActivity('family.access', {
    req, data: { action: 'updated', person: p.name, ...(p.name !== before.name ? { from: before.name } : {}), perms: permList(p) },
  });
  return { person: personInfo(p) };
}

/** A new private link (the old one stops working; phones already in keep working). */
export function regenerateLink(id, { req } = {}) {
  const p = findPerson(id);
  if (!p) return { error: 'not_found', status: 404 };
  const { token, stored } = newLink();
  updateSecrets(() => { p.link = stored; });
  logActivity('family.access', { req, level: 'warn', data: { action: 'link', person: p.name } });
  return { person: personInfo(p), link: { path: `${MEMBER_PATH}/${token}` } };
}

/** Remove a person: the link, every phone and any code on a screen stop working at once. */
export function deletePerson(id, { req } = {}) {
  const p = findPerson(id);
  if (!p) return false;
  updateSecrets((s) => { s.familyAccess = people().filter((x) => x.id !== id); });
  for (const [k, c] of codes) if (c.personId === id) codes.delete(k);
  for (const d of p.devices || []) seen.delete(d.id);
  logActivity('family.access', { req, level: 'warn', data: { action: 'deleted', person: p.name, devices: (p.devices || []).length } });
  return true;
}

/** Revoke one phone of a person. */
export function revokePersonDevice(id, deviceId, { req } = {}) {
  const p = findPerson(id);
  const d = p?.devices?.find((x) => x.id === deviceId);
  if (!d) return false;
  updateSecrets(() => { p.devices = p.devices.filter((x) => x.id !== deviceId); });
  seen.delete(deviceId);
  logActivity('family.access', { req, level: 'warn', data: { action: 'device_revoked', person: p.name, device: d.name } });
  return true;
}

/**
 * Show a code for this person on one screen for two minutes (`access-code` live event). A new code replaces the
 * person's previous one. The phone types it at /my, or scans the QR code the screen draws with it.
 * @returns {{ code, expiresAt, screenId, delivered } | { error, status }}
 */
export function showCode(id, screenId, { req } = {}, now = Date.now()) {
  const p = findPerson(id);
  if (!p) return { error: 'not_found', status: 404 };
  const cfg = getConfig();
  const screen = cfg.screens.find((s) => s.id === screenId);
  if (!screen) return { error: 'unknown_screen', status: 400 };
  if (!allow(maps.codesShown, id, BAD_WINDOW_MS, CODES_PER_WINDOW, now)) return { error: 'rate_limited', status: 429 };
  pruneCodes(now);
  for (const [k, c] of codes) if (c.personId === id) codes.delete(k);
  const live = new Set(codes.keys());
  let code;
  do code = randomCode(CODE_LENGTH); while (live.has(shaHex(code)));
  const expiresAt = now + CODE_TTL_MS;
  codes.set(shaHex(code), { personId: id, screenId, expiresAt });
  const origin = familyOrigin(req);
  const payload = { code, name: p.name, expiresAt: new Date(expiresAt).toISOString(), url: origin ? `${origin}${MEMBER_PATH}` : '' };
  const delivered = publish('access-code', payload, { screenIds: [screenId] });
  logActivity('family.code', { req, data: { person: p.name, screen: screen.slug, delivered } });
  return { code, expiresAt: payload.expiresAt, screenId, delivered };
}

// ---------------------------------------------------------------- phones

/** The person and device of a presented device token, or null. Constant-time over every stored digest. */
function deviceFor(token) {
  if (typeof token !== 'string' || !DEVICE_TOKEN_RE.test(token)) return null;
  const h = sha(token);
  let hit = null;
  for (const p of people()) for (const d of p.devices || []) if (sameHash(d.hash, h)) hit = { person: p, device: d };
  return hit;
}

/** A new device token for `person` (the caller checked the credential). { token, device } or { error, status }. */
function addDevice(person, via, req) {
  if ((person.devices || []).length >= MAX_DEVICES_PER_PERSON) return { error: 'device_limit', status: 409 };
  const token = `fd_${crypto.randomBytes(32).toString('base64url')}`;
  const at = new Date().toISOString();
  const device = {
    id: newId('fv_'), name: deviceLabel(req?.get?.('user-agent')), via, hash: shaHex(token), createdAt: at, lastSeenAt: at,
    lastIp: req?.ip ? String(req.ip).slice(0, 64) : null,
  };
  updateSecrets(() => {
    if (!Array.isArray(person.devices)) person.devices = [];
    person.devices.push(device);
    person.lastUsedAt = at;
  });
  logActivity('family.device', { req, actor: actorOf(person), level: 'warn', data: { person: person.name, via, device: device.name } });
  return { token, device };
}

/** MemberState of a person now (the household's language: the default screen's). */
export function stateOf(person) {
  const cfg = getConfig();
  const on = cfg.screens.filter((s) => screenPrivacy(cfg, s).active).length;
  return memberState(cfg, person, { lang: defaultScreen(cfg)?.screen?.language || 'en', privacy: { on, total: cfg.screens.length } });
}

const tooMany = { error: 'too many tries, wait a few minutes', code: 'rate_limited', status: 429 };

/**
 * The private link opened on a phone: trade it for a device token. A phone that already holds a valid token for
 * the same person keeps it (no second device). { token, state } or { error, code, status }.
 */
export function redeemLink(link, current, req) {
  if (locked(req)) return tooMany;
  const given = typeof link === 'string' ? link.trim() : '';
  let person = null;
  if (LINK_TOKEN_RE.test(given)) {
    const h = sha(given);
    for (const p of people()) if (p.link?.hash && sameHash(p.link.hash, h)) person = p;
  }
  if (!person) {
    if (!countBad(req)) return tooMany;
    rejected(req, 'invalid_link');
    return { error: 'this link is no longer valid', code: 'invalid_link', status: 403 };
  }
  const mine = deviceFor(current);
  if (mine && mine.person.id === person.id) return { token: current, state: stateOf(person) };
  const r = addDevice(person, 'link', req);
  if (r.error) return { error: r.error, code: r.error, status: r.status };
  return { token: r.token, state: stateOf(person) };
}

/** A code typed on a phone (single use). { token, state } or { error, code, status }. */
export function redeemCode(raw, req, now = Date.now()) {
  if (locked(req, { code: true }, now)) return tooMany;
  pruneCodes(now);
  const code = normalizeAccessCode(raw);
  let hit = null;
  let hitKey = null;
  if (code) {
    const h = sha(code);
    // constant-time over every live code, no early exit
    for (const [k, c] of codes) if (crypto.timingSafeEqual(Buffer.from(k, 'hex'), h) && c.expiresAt > now) { hit = c; hitKey = k; }
  }
  const person = hit ? findPerson(hit.personId) : null;
  if (!person) {
    if (!countBad(req, { code: true }, now)) return tooMany;
    rejected(req, code ? 'invalid_code' : 'malformed_code');
    return { error: 'unknown or expired code: check the code on the screen', code: 'invalid_code', status: 404 };
  }
  codes.delete(hitKey);
  const r = addDevice(person, 'code', req);
  if (r.error) return { error: r.error, code: r.error, status: r.status };
  return { token: r.token, state: stateOf(person) };
}

/**
 * Express middleware for /api/member/* (all but redeem and pair): the X-Member-Token header must hold a device token
 * of a person. Wrong tokens count against the address and everyone; the right one has its own per-phone limit.
 */
export function memberAuth(req, res, next) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  const now = Date.now();
  const given = String(req.get(TOKEN_HEADER) || '').trim();
  const hit = given ? deviceFor(given) : null;
  if (hit) {
    if (!allow(maps.requests, hit.device.id, 60_000, REQUESTS_PER_MIN, now)) {
      res.set('retry-after', '60');
      return res.status(429).json({ error: 'too many requests, wait a minute', code: 'rate_limited' });
    }
    touch(hit.person, hit.device, req, now);
    req.member = hit;
    return next();
  }
  if (locked(req, {}, now) || !countBad(req, {}, now)) {
    res.set('retry-after', String(BAD_WINDOW_MS / 1000));
    return res.status(429).json({ error: 'too many tries, wait a few minutes', code: 'rate_limited' });
  }
  if (!given) return res.status(401).json({ error: 'this phone is not authorised yet', code: 'token_required' });
  rejected(req, 'invalid_token');
  return res.status(403).json({ error: 'this phone is no longer authorised', code: 'invalid_token' });
}

/** Last seen of a phone: kept in memory, written to secrets.json at most every 5 minutes. */
function touch(person, device, req, now) {
  seen.set(device.id, now);
  if (now - lastFlush < LAST_SEEN_FLUSH_MS) return;
  lastFlush = now;
  updateSecrets(() => {
    for (const p of people()) {
      for (const d of p.devices || []) {
        const m = seen.get(d.id);
        if (!m) continue;
        d.lastSeenAt = new Date(m).toISOString();
        if (d.id === device.id) d.lastIp = req?.ip ? String(req.ip).slice(0, 64) : d.lastIp ?? null;
        if (!p.lastUsedAt || p.lastUsedAt < d.lastSeenAt) p.lastUsedAt = d.lastSeenAt;
      }
    }
  });
  seen.clear();
}

/** This phone signs out (its token stops working). */
export function forgetDevice({ person, device }, { req } = {}) {
  updateSecrets(() => { person.devices = (person.devices || []).filter((d) => d.id !== device.id); });
  seen.delete(device.id);
  logActivity('family.access', { req, actor: actorOf(person), data: { action: 'device_revoked', person: person.name, device: device.name, self: true } });
}

// ---------------------------------------------------------------- actions

const fail = (code, status) => ({ error: code, code, status });
const NOT_ALLOWED = fail('not_allowed', 403);

/** The action budget of a person: false (429) once it is spent. */
function budget(person, now = Date.now()) {
  return allow(maps.actions, person.id, 60_000, ACTIONS_PER_MIN, now);
}

/** Every action: the permission now, then the budget. Null when allowed, else the error. */
function gate(person, perm) {
  if (!effectivePerms(person, getConfig())[perm]) return NOT_ALLOWED;
  if (!budget(person)) return fail('rate_limited', 429);
  return null;
}

/** The permission alone (checked before the request is read, so a phone without it learns nothing else). */
const allowed = (person, perm) => Boolean(effectivePerms(person, getConfig())[perm]);

/** POST /api/member/message { text, screens?, durationSec? } */
export function memberMessage({ person }, body, { req } = {}) {
  const cfg = getConfig();
  if (!allowed(person, 'message')) return NOT_ALLOWED;
  const r = memberMessageRequest(body, person, cfg);
  if (r.error) return fail(r.error, r.error === 'not_allowed' ? 403 : 400);
  if (!allow(maps.messages, person.id, MESSAGE_WINDOW_MS, MESSAGES_PER_WINDOW) || !budget(person)) return fail('rate_limited', 429);
  const v = sanitizeAnnounce(r.value, (keys) => resolveScreenList(cfg, keys));
  if (!v.ok) return fail('text_too_long', 400);
  const { announcement, delivered } = createAnnouncement(v.value, { via: 'family', by: actorOf(person) });
  const slugs = announcement.screenIds.map((id) => cfg.screens.find((s) => s.id === id)?.slug || id);
  logActivity('family.message', {
    req, actor: actorOf(person),
    data: { person: person.name, text: announcement.body.slice(0, 60), ...(slugs.length ? { screens: slugs } : {}), delivered },
  });
  return { ok: true, delivered };
}

/** POST /api/member/privacy { mode: on | off }: every screen. */
export function memberPrivacy({ person }, body, { req } = {}) {
  if (!allowed(person, 'privacy')) return NOT_ALLOWED;
  const mode = memberPrivacyMode(body);
  if (!mode) return fail('bad_mode', 400);
  const g = gate(person, 'privacy');
  if (g) return g;
  const { targets } = applyPrivacy({ mode, end: null, screenIds: [], by: 'family' });
  const active = targets.filter((x) => x.active).length;
  logActivity('family.privacy', { req, actor: actorOf(person), data: { person: person.name, mode, active } });
  return { ok: true, privacy: { on: active, total: targets.length } };
}

/** POST /api/member/night { mode: on | off | auto }: every screen. */
export function memberNight({ person }, body, { req } = {}) {
  if (!allowed(person, 'night')) return NOT_ALLOWED;
  const mode = memberNightMode(body);
  if (!mode) return fail('bad_mode', 400);
  const g = gate(person, 'night');
  if (g) return g;
  const out = runCommand({ action: 'night', mode });
  logActivity('family.night', { req, actor: actorOf(person), data: { person: person.name, mode, delivered: out.delivered } });
  return { ok: true, delivered: out.delivered };
}

/** Save a config change made from a phone (no revision guard: it adds one item to what is saved now). */
function saveChange(fn, req) {
  const r = updateConfig(fn, { reason: 'family', req });
  return r.ok ? null : fail('conflict', 409);
}

/** POST /api/member/todo { text }: a typed to-do on the list (config.todo.items). */
export function memberTodo({ person }, body, { req } = {}) {
  if (!allowed(person, 'todo')) return NOT_ALLOWED;
  const r = memberTodoRequest(body);
  if (r.error) return fail(r.error, 400);
  const g = gate(person, 'todo');
  if (g) return g;
  if (getConfig().todo.items.length >= 100) return fail('todo_full', 409);
  const item = newTodoItem(r.value, newId('t_'));
  const err = saveChange((c) => { c.todo.items.push(item); }, req);
  if (err) return err;
  logActivity('family.todo', { req, actor: actorOf(person), data: { person: person.name, text: item.text.slice(0, 60) } });
  return { ok: true, id: item.id };
}

/** POST /api/member/event { title, date, allDay, startTime?, endTime? }: an event on the local calendar. */
export function memberEvent({ person }, body, { req } = {}) {
  if (!allowed(person, 'events')) return NOT_ALLOWED;
  const cfg = getConfig();
  const r = memberEventRequest(body, localDate(new Date(), cfg.datetime.timezone));
  if (r.error) return fail(r.error, 400);
  const g = gate(person, 'events');
  if (g) return g;
  if (cfg.localEvents.enabled === false) return fail('calendar_off', 409);
  if (cfg.localEvents.items.length >= 1000) return fail('events_full', 409);
  const ev = newLocalEvent(r.value, newId('l_'));
  const err = saveChange((c) => { c.localEvents.items.push(ev); }, req);
  if (err) return err;
  logActivity('family.event', {
    req, actor: actorOf(person), data: { person: person.name, title: ev.title.slice(0, 60), date: ev.date, ...(ev.allDay ? {} : { time: ev.startTime }) },
  });
  return { ok: true, id: ev.id };
}

/** Tests only: forget the codes and the rate limits. */
export function _resetFamilyAccess() {
  for (const m of Object.values(maps)) m.clear();
  badAll = [];
  badCodeAll = [];
  codes.clear();
  seen.clear();
  lastFlush = 0;
}
