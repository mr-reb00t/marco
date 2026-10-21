// Family access (#16): each person of the household gets their own small dashboard on the phone (/my), opened with a
// private link or authorised with a code shown on one of the screens, without the admin password. The admin picks
// what each person may do: send a message to the screens, turn privacy mode on or off, switch night, day or auto
// mode (on every screen or the ones the admin chose), add to-dos and add events to the local calendar. Pure functions: no fs, no express, no store, so Marco Cloud
// runs the same rules. server/familyAccess.js keeps the people in secrets.json and runs the actions; Marco Cloud keeps
// them in D1 (src/cloud/familyAccess.ts). See docs/API.md ("Family access") and docs/ARCHITECTURE.md.
//
// Credentials: the private link carries a link token (fa_…). Opening it on a phone trades it for a device token
// (fd_…) that the phone keeps, so every phone shows up as its own device and can be revoked alone; regenerating the
// link only stops new phones from coming in. A code shown on a screen (6 characters of the pairing alphabet, two
// minutes, single use) is the other way to get a device token. Only SHA-256 digests of tokens and codes are stored.
import { addDays, isDateStr } from './lib/tz.js';
import { CODE_ALPHABET } from './pairCore.js';
import { defaultScreen } from './screens.js';

/** What a person may be allowed to do, in the order the admin lists them. */
export const ACCESS_PERMS = Object.freeze(['message', 'privacy', 'night', 'todo', 'events']);
export const MAX_PEOPLE = 20;
export const MAX_DEVICES_PER_PERSON = 10;
export const NAME_MAX = 40;
export const MESSAGE_MAX = 200;
/** The same caps as config validation (todo.items[].text, localEvents.items[].title). */
export const TODO_TEXT_MAX = 200;
export const EVENT_TITLE_MAX = 120;
/** How long a message stays on the screens (seconds): the phone offers these. */
export const MESSAGE_DURATIONS = Object.freeze([60, 600, 3600]);
export const DEFAULT_MESSAGE_SECONDS = 600;
/** A code on a screen lives two minutes and works once. */
export const CODE_TTL_MS = 2 * 60_000;
export const CODE_LENGTH = 6;
/** How far back and ahead an event may be added from the phone. */
export const EVENT_DAYS_BACK = 31;
export const EVENT_DAYS_AHEAD = 731;

/** Link token: fa_ + base64url(24 random bytes). Device token: fd_ + base64url(32 random bytes). */
export const LINK_TOKEN_RE = /^fa_[A-Za-z0-9_-]{32}$/;
export const DEVICE_TOKEN_RE = /^fd_[A-Za-z0-9_-]{43}$/;
export const PERSON_ID_RE = /^fp_[a-f0-9]{12}$/;
export const DEVICE_ID_RE = /^fv_[a-f0-9]{12}$/;
/** Where a phone opens its dashboard. */
export const MEMBER_PATH = '/my';

/** The household's language (the default screen's): the phone page uses it from the first screen, before sign-in. */
export const householdLang = (cfg) => defaultScreen(cfg)?.screen?.language || 'en';

/** `/my?lang=es` or `/my/<link>?lang=es`: the language only changes texts, so it may travel in the address. */
export const memberPath = (cfg, link = '') => `${MEMBER_PATH}${link ? `/${link}` : ''}?lang=${encodeURIComponent(householdLang(cfg))}`;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** One line of text: control characters out, spaces folded, trimmed. */
export const cleanLine = (v) => (typeof v === 'string' ? v.replace(CONTROL, ' ').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() : '');

/** No permission at all (a new person starts like this until the admin ticks something). */
export const emptyPerms = () => ({ message: false, messageScreens: [], privacy: false, night: false, nightScreens: [], todo: false, events: false });

const screenIds = (cfg) => new Set((cfg?.screens ?? []).map((s) => s.id));

/** The permissions that may be limited to some screens, and the field that lists them ([] = every screen). */
const SCREEN_LISTS = Object.freeze({ message: 'messageScreens', night: 'nightScreens' });

/**
 * The permissions of a request or a stored person, with only known screens. `messageScreens` and `nightScreens`
 * [] = every screen (a person saved before `nightScreens` existed has none, so night mode stays on every screen).
 * Anything that is not `true` is off.
 */
export function sanitizePerms(raw, cfg) {
  const p = isObj(raw) ? raw : {};
  const ids = screenIds(cfg);
  const chosen = (v) => [...new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string' && ids.has(x)) : [])].slice(0, 12);
  return {
    message: p.message === true,
    messageScreens: chosen(p.messageScreens),
    privacy: p.privacy === true,
    night: p.night === true,
    nightScreens: chosen(p.nightScreens),
    todo: p.todo === true,
    events: p.events === true,
  };
}

/**
 * What a stored person may do now. A message or night mode limited to screens that were all deleted since is off: it
 * never widens to every screen on its own.
 */
export function effectivePerms(person, cfg) {
  const stored = isObj(person?.perms) ? person.perms : {};
  const p = sanitizePerms(stored, cfg);
  for (const [perm, list] of Object.entries(SCREEN_LISTS)) {
    const askedSome = Array.isArray(stored[list]) && stored[list].length > 0;
    if (p[perm] && askedSome && !p[list].length) p[perm] = false;
  }
  return p;
}

/** The screens a person may reach with `perm` (message or night), as { id, name } ([] when it is off). */
function targetsOf(perm, person, cfg) {
  const p = effectivePerms(person, cfg);
  if (!p[perm]) return [];
  const chosen = p[SCREEN_LISTS[perm]];
  const all = cfg.screens ?? [];
  return (chosen.length ? all.filter((s) => chosen.includes(s.id)) : all).map((s) => ({ id: s.id, name: s.name }));
}

/** The screens a person may send a message to ([] when messages are off). */
export const messageTargets = (person, cfg) => targetsOf('message', person, cfg);

/** The screens a person may switch to night, day or auto ([] when night mode is off). */
export const nightTargets = (person, cfg) => targetsOf('night', person, cfg);

/**
 * The fields of an admin request to add (`partial` false) or change a person.
 * @returns {{ value: { name?: string, memberId?: string | null, perms?: object } } | { error: string, path: string }}
 */
export function sanitizePersonInput(body, cfg, { partial = false } = {}) {
  const b = isObj(body) ? body : {};
  const value = {};
  if (!partial || b.name !== undefined) {
    const name = cleanLine(b.name).slice(0, NAME_MAX);
    if (!name) return { error: 'name_required', path: 'name' };
    value.name = name;
  }
  if (!partial || b.memberId !== undefined) {
    if (b.memberId === null || b.memberId === undefined || b.memberId === '') value.memberId = null;
    else if (typeof b.memberId === 'string' && (cfg?.family?.members ?? []).some((m) => m.id === b.memberId)) value.memberId = b.memberId;
    else return { error: 'unknown_member', path: 'memberId' };
  }
  if (!partial || b.perms !== undefined) {
    if (b.perms !== undefined && !isObj(b.perms)) return { error: 'bad_perms', path: 'perms' };
    value.perms = sanitizePerms(b.perms, cfg);
  }
  return { value };
}

const ISO = (v) => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);
const HASH = /^[a-f0-9]{64}$/;

/**
 * The people of family access in an export with secrets (backupsCore.js exportSecrets): digests only, no address,
 * so the links and phones keep working after a restore or a move to a new server.
 */
export const exportAccessPeople = (list) => (Array.isArray(list) ? list : []).map((p) => ({
  id: p.id, name: p.name, memberId: p.memberId ?? null, perms: p.perms ?? emptyPerms(), createdAt: p.createdAt ?? null, lastUsedAt: p.lastUsedAt ?? null,
  link: p.link?.hash ? { hash: p.link.hash, createdAt: p.link.createdAt ?? null } : null,
  devices: (p.devices || []).map((d) => ({ id: d.id, name: d.name, via: d.via, hash: d.hash, createdAt: d.createdAt ?? null, lastSeenAt: d.lastSeenAt ?? null })),
}));

/**
 * The people of an imported bundle, well-formed parts only (MAX_PEOPLE, MAX_DEVICES_PER_PERSON). The permissions
 * are read again against the config on every request (effectivePerms), so a screen missing here only turns off.
 */
export function importAccessPeople(list) {
  if (!Array.isArray(list)) return null;
  const now = new Date().toISOString();
  const ids = new Set();
  const out = [];
  for (const p of list) {
    if (!isObj(p) || typeof p.id !== 'string' || !/^fp_[a-f0-9]{12}$/.test(p.id) || ids.has(p.id)) continue;
    const name = cleanLine(p.name).slice(0, NAME_MAX);
    if (!name) continue;
    ids.add(p.id);
    const perms = isObj(p.perms) ? p.perms : {};
    out.push({
      id: p.id, name,
      memberId: typeof p.memberId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.memberId) ? p.memberId : null,
      perms: {
        ...Object.fromEntries(['message', 'privacy', 'night', 'todo', 'events'].map((k) => [k, perms[k] === true])),
        ...Object.fromEntries(Object.values(SCREEN_LISTS).map((k) => [k, Array.isArray(perms[k]) ? perms[k].filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)).slice(0, 12) : []])),
      },
      createdAt: ISO(p.createdAt) ?? now, lastUsedAt: ISO(p.lastUsedAt),
      link: isObj(p.link) && HASH.test(p.link.hash || '') ? { hash: p.link.hash, createdAt: ISO(p.link.createdAt) ?? now } : null,
      devices: (Array.isArray(p.devices) ? p.devices : [])
        .filter((d) => isObj(d) && typeof d.id === 'string' && /^fv_[a-f0-9]{12}$/.test(d.id) && HASH.test(d.hash || ''))
        .slice(0, MAX_DEVICES_PER_PERSON)
        .map((d) => ({
          id: d.id, name: cleanLine(d.name).slice(0, 60) || 'Browser', via: d.via === 'code' ? 'code' : 'link', hash: d.hash,
          createdAt: ISO(d.createdAt) ?? now, lastSeenAt: ISO(d.lastSeenAt), lastIp: null,
        })),
    });
    if (out.length >= MAX_PEOPLE) break;
  }
  return out;
}

/** A rough name of the phone from its user agent ("iPhone", "Android · Chrome"), for the admin's device list. */
export function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  const os = /iPad/.test(ua) ? 'iPad' : /iPhone|iPod/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /EdgA?\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' · ') || 'Browser';
}

/** "abc 234" → "ABC234"; null when it cannot be a code. */
export function normalizeAccessCode(v) {
  const s = typeof v === 'string' ? v.toUpperCase().replace(/[\s-]+/g, '') : '';
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

// ---------------------------------------------------------------- what the phone sees

/**
 * MemberState: the person's name, what they may do and what the controls need. Nothing secret: no token, no
 * account, no other person.
 * @param {object} cfg config
 * @param {object} person stored person
 * @param {{ lang: string, privacy: { on: number, total: number } }} o  `privacy`: screens private now / all screens
 */
export function memberState(cfg, person, { lang = 'en', privacy = { on: 0, total: 0 } } = {}) {
  const p = effectivePerms(person, cfg);
  const member = person.memberId ? (cfg.family?.members ?? []).find((m) => m.id === person.memberId) : null;
  return {
    name: person.name,
    lang,
    avatar: member?.avatar || '',
    color: member?.color || '',
    can: { message: p.message, privacy: p.privacy, night: p.night, todo: p.todo, events: p.events },
    screens: p.message ? messageTargets(person, cfg) : [],
    nightScreens: p.night ? nightTargets(person, cfg) : [],
    privacy: p.privacy ? { on: privacy.on, total: privacy.total } : null,
    calendarOn: cfg.localEvents?.enabled !== false,
    durations: [...MESSAGE_DURATIONS],
  };
}

// ---------------------------------------------------------------- actions

/**
 * A message from the phone, as an announcement request for sanitizeAnnounce: the person's name is the title, the
 * text the body. `screens` must be screens the person may reach ([] or missing = all of them).
 * @returns {{ value: object } | { error: string }}
 */
export function memberMessageRequest(body, person, cfg) {
  const b = isObj(body) ? body : {};
  const text = typeof b.text === 'string' ? b.text.replace(CONTROL, '').trim() : '';
  if (!text) return { error: 'text_required' };
  if (text.length > MESSAGE_MAX) return { error: 'text_too_long' };
  const allowed = messageTargets(person, cfg).map((s) => s.id);
  if (!allowed.length) return { error: 'not_allowed' };
  let screens = allowed;
  if (b.screens !== undefined && b.screens !== null) {
    if (!Array.isArray(b.screens)) return { error: 'bad_screens' };
    const asked = [...new Set(b.screens.filter((x) => typeof x === 'string'))];
    if (asked.length !== b.screens.length || asked.some((id) => !allowed.includes(id))) return { error: 'bad_screens' };
    if (asked.length) screens = asked;
  }
  const seconds = b.durationSec === undefined || b.durationSec === null ? DEFAULT_MESSAGE_SECONDS : Number(b.durationSec);
  if (!MESSAGE_DURATIONS.includes(seconds)) return { error: 'bad_duration' };
  const every = !effectivePerms(person, cfg).messageScreens.length && screens.length === (cfg.screens ?? []).length;
  return {
    value: {
      title: person.name.slice(0, 120), body: text, emoji: '💬', style: 'info', durationSec: seconds, sound: true,
      // [] = every screen, as an admin announcement without screens (a screen added later gets it too)
      screens: every ? [] : screens,
    },
  };
}

/** `{ mode }` of a privacy request from the phone: on or off for every screen. */
export function memberPrivacyMode(body) {
  const m = isObj(body) ? body.mode : undefined;
  return m === 'on' || m === 'off' ? m : null;
}

/** `{ mode }` of a night mode request: on (night), off (day) or auto. */
export function memberNightMode(body) {
  const m = isObj(body) ? body.mode : undefined;
  return m === 'on' || m === 'off' || m === 'auto' ? m : null;
}

/**
 * A night mode request from the phone: `{ mode, screens? }`. `screens` must be screens the person may switch ([] or
 * missing = all of them). `screens` of the value is the display command's target ([] = every screen, as the admin's
 * command without screens); `names` are the screens it names, for the activity log ([] = every screen).
 * @returns {{ value: { mode: 'on' | 'off' | 'auto', screens: string[], names: string[] } } | { error: string }}
 */
export function memberNightRequest(body, person, cfg) {
  const mode = memberNightMode(body);
  if (!mode) return { error: 'bad_mode' };
  const allowed = nightTargets(person, cfg);
  if (!allowed.length) return { error: 'not_allowed' };
  const raw = isObj(body) ? body.screens : undefined;
  let picked = allowed;
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw)) return { error: 'bad_screens' };
    const asked = [...new Set(raw.filter((x) => typeof x === 'string'))];
    if (asked.length !== raw.length || asked.some((id) => !allowed.some((s) => s.id === id))) return { error: 'bad_screens' };
    if (asked.length) picked = allowed.filter((s) => asked.includes(s.id));
  }
  const every = !effectivePerms(person, cfg).nightScreens.length && picked.length === (cfg.screens ?? []).length;
  return { value: { mode, screens: every ? [] : picked.map((s) => s.id), names: every ? [] : picked.map((s) => s.name) } };
}

/** A to-do typed on the phone. @returns {{ value: { text } } | { error }} */
export function memberTodoRequest(body) {
  const text = cleanLine(isObj(body) ? body.text : '');
  if (!text) return { error: 'text_required' };
  if (text.length > TODO_TEXT_MAX) return { error: 'text_too_long' };
  return { value: { text } };
}

/**
 * An event typed on the phone: title, date, all day or a start (and end) time. `today` is the household's date.
 * @returns {{ value: { title, date, allDay, startTime, endTime } } | { error, path }}
 */
export function memberEventRequest(body, today) {
  const b = isObj(body) ? body : {};
  const title = cleanLine(b.title);
  if (!title) return { error: 'title_required', path: 'title' };
  if (title.length > EVENT_TITLE_MAX) return { error: 'title_too_long', path: 'title' };
  if (!isDateStr(b.date)) return { error: 'bad_date', path: 'date' };
  if (b.date < addDays(today, -EVENT_DAYS_BACK) || b.date > addDays(today, EVENT_DAYS_AHEAD)) return { error: 'bad_date', path: 'date' };
  const allDay = b.allDay !== false;
  if (allDay) return { value: { title, date: b.date, allDay: true, startTime: '', endTime: '' } };
  if (typeof b.startTime !== 'string' || !HHMM.test(b.startTime)) return { error: 'bad_time', path: 'startTime' };
  let endTime = typeof b.endTime === 'string' && b.endTime ? b.endTime : '';
  if (endTime && !HHMM.test(endTime)) return { error: 'bad_time', path: 'endTime' };
  if (endTime && endTime <= b.startTime) return { error: 'bad_time', path: 'endTime' };
  if (!endTime) {
    // an hour by default, never past midnight; at 23:59 there is no minute left for it to end in
    if (b.startTime >= '23:59') return { error: 'bad_time', path: 'startTime' };
    const [h, m] = b.startTime.split(':').map(Number);
    endTime = h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return { value: { title, date: b.date, allDay: false, startTime: b.startTime, endTime } };
}

/** The to-do item stored in config.todo.items. */
export const newTodoItem = (value, id) => ({ id, text: value.text, done: false });

/** The local event stored in config.localEvents.items (one day, no repeat). */
export const newLocalEvent = (value, id) => ({
  id, title: value.title, emoji: '', color: null, location: '', notes: '', allDay: value.allDay, date: value.date, endDate: value.date,
  startTime: value.startTime, endTime: value.endTime, repeat: { freq: 'none', interval: 1, until: null, weekdays: [] }, exceptions: [], countdown: false,
});

/** Error codes of the member API and their HTTP status. */
export const MEMBER_ERROR_STATUS = Object.freeze({
  text_required: 400, text_too_long: 400, bad_screens: 400, bad_duration: 400, bad_mode: 400, title_required: 400, title_too_long: 400,
  bad_date: 400, bad_time: 400, not_allowed: 403, todo_full: 409, events_full: 409, calendar_off: 409, conflict: 409, invalid: 400,
});
