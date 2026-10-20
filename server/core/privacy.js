// Privacy mode ("Modo privado"), per screen: while it is on, events of the calendars marked 'busy' reach the display
// as "Busy" blocks (time, length and calendar colour only) and those marked 'hide' do not reach it at all. Pure
// functions shared with Marco Cloud: the state (on / until / by) is stored by the caller (data/privacy.json here).
// See docs/ARCHITECTURE.md (Privacy mode) and docs/API.md (/api/admin/privacy, /api/hooks/privacy).
//
// Who wins:
// - A manual "on" (admin, webhook) lasts until its `until` (null = until someone turns it off), whatever the
//   schedule says. When it ends, the schedule decides again.
// - A manual "off" while a schedule window is running lasts until that window ends (the next schedule boundary);
//   outside a window it only clears the manual state.
// - Without a manual state, the screen is private while one of its schedule rules is running.
import { localInstant, windowState, nextWindowBoundary, enabledWindows } from './schedules.js';
import { zonedParts, addDays } from './lib/tz.js';
import { t } from './lib/i18n.js';
import { LOCAL_SOURCE_ID, BIRTHDAYS_SOURCE_ID } from './defaults.js';

export const PRIVACY_MODES = Object.freeze(['busy', 'hide', 'keep']);
export const MAX_PRIVACY_RULES = 10;
/** Longest manual period (hours) a request may ask for. */
export const MAX_PRIVACY_HOURS = 24 * 31;
/** "Until tomorrow" in the admin: the next 06:00 in the configured time zone. */
export const MORNING = '06:00';

const pad = (n) => String(n).padStart(2, '0');
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Default per source: holiday and birthday calendars stay as they are, everything else shows as busy. */
export const defaultSourcePrivacy = (kind) => (kind === 'holidays' || kind === 'birthdays' ? 'keep' : 'busy');

/** What privacy mode does to the events of `sourceId` ('busy' | 'hide' | 'keep'). */
export function sourcePrivacyMode(cfg, sourceId) {
  if (sourceId === LOCAL_SOURCE_ID) return PRIVACY_MODES.includes(cfg.localEvents?.privacy) ? cfg.localEvents.privacy : 'busy';
  if (sourceId === BIRTHDAYS_SOURCE_ID) return PRIVACY_MODES.includes(cfg.birthdays?.privacy) ? cfg.birthdays.privacy : 'keep';
  const s = cfg.calendar.sources.find((x) => x.id === sourceId);
  if (!s) return 'busy';
  return PRIVACY_MODES.includes(s.privacy) ? s.privacy : defaultSourcePrivacy(s.kind);
}

function sourceColor(cfg, sourceId, fallback) {
  if (sourceId === LOCAL_SOURCE_ID) return cfg.localEvents.color;
  if (sourceId === BIRTHDAYS_SOURCE_ID) return cfg.birthdays.color;
  return cfg.calendar.sources.find((x) => x.id === sourceId)?.color || fallback;
}

/**
 * Wire events (CalEvent[]) as a private screen may show them. 'keep' sources pass unchanged, 'hide' sources are
 * dropped, 'busy' sources keep id, time, length, all-day flag, kind and the calendar colour; the title becomes the
 * word for "Busy" in `lang` and location, description, emoji and age are removed. A rental checkout marker keeps
 * its 🚪 (the display draws it as a departure, it names nobody).
 */
export function privatizeEvents(events, cfg, lang) {
  const word = t('busy', lang);
  const out = [];
  for (const e of events) {
    const mode = sourcePrivacyMode(cfg, e.sourceId);
    if (mode === 'keep') { out.push(e); continue; }
    if (mode === 'hide') continue;
    out.push({
      id: e.id, sourceId: e.sourceId, title: word, start: e.start, end: e.end, allDay: e.allDay,
      location: '', color: sourceColor(cfg, e.sourceId, e.color), emoji: e.kind === 'airbnb' && e.emoji === '🚪' ? '🚪' : '',
      kind: e.kind, multiDay: e.multiDay, busy: true,
    });
  }
  return out;
}

/** Countdowns from events or birthdays of a source survive privacy mode only when that source is 'keep'. */
export const countdownSourceAllowed = (cfg, sourceId) => sourcePrivacyMode(cfg, sourceId) === 'keep';

// ---------------------------------------------------------------- schedule

const enabledRules = (screen) => enabledWindows(screen?.privacy?.schedule);

/**
 * Is one of `rules` running at `now`? `until` = end of the whole running stretch (back-to-back or overlapping
 * windows count as one), as an ISO time with offset. Shared with carousels (core/schedules.js windowState).
 */
export const privacyScheduleState = windowState;

/** Next instant after `now` where one of `rules` starts or ends (ms), or null without rules. */
export const nextScheduleBoundary = nextWindowBoundary;

/** The next time `hhmm` comes round in `tz` after `now`, as an ISO time with offset. */
export function nextLocalTime(hhmm, now, tz) {
  const p = zonedParts(now, tz);
  const today = `${String(p.y).padStart(4, '0')}-${pad(p.m)}-${pad(p.d)}`;
  const first = localInstant(today, hhmm, tz);
  return Date.parse(first) > now.getTime() ? first : localInstant(addDays(today, 1), hhmm, tz);
}

// ---------------------------------------------------------------- state

const live = (state, now) => Boolean(state && typeof state === 'object' && (state.until === null || Date.parse(state.until) > now.getTime()));

/**
 * Privacy of one screen right now.
 * `state` = the stored manual state of that screen ({ on, until, by, at }) or undefined.
 * @returns {{ active: boolean, until: string | null, by: 'admin' | 'hook' | 'schedule' | null, resumesAt: string | null }}
 *   until: when it ends (null while active = until someone turns it off); resumesAt: a manual off pauses the
 *   schedule until then.
 */
export function privacyStatus(cfg, screen, state, now = new Date()) {
  const tz = cfg.datetime.timezone;
  const rules = enabledRules(screen);
  const manual = live(state, now) ? state : null;
  if (manual?.on) {
    let until = manual.until;
    // A manual period that runs into a schedule window goes on until that window ends.
    if (until) {
      const after = privacyScheduleState(rules, new Date(Date.parse(until)), tz);
      if (after.active) until = after.until;
    }
    return { active: true, until, by: manual.by === 'hook' ? 'hook' : 'admin', resumesAt: null };
  }
  if (manual && !manual.on) return { active: false, until: null, by: manual.by === 'hook' ? 'hook' : 'admin', resumesAt: manual.until };
  const sched = privacyScheduleState(rules, now, tz);
  return sched.active ? { active: true, until: sched.until, by: 'schedule', resumesAt: null } : { active: false, until: null, by: null, resumesAt: null };
}

/** Next instant (ms) where the privacy of `screen` may change on its own (a period ends, a rule starts), or null. */
export function privacyNextChange(cfg, screen, state, now = new Date()) {
  const c = [];
  if (live(state, now) && state.until) c.push(Date.parse(state.until));
  const b = nextScheduleBoundary(enabledRules(screen), now, cfg.datetime.timezone);
  if (b !== null) c.push(b);
  return c.length ? Math.min(...c) : null;
}

/**
 * Validate a privacy request body ({ mode, hours?, until?, untilTime?, screens? }).
 * @returns {{ value: { mode, end: string | null | undefined, screens } } | { error: string }}
 *   end: ISO time the period ends, null = until turned off (mode 'off': undefined).
 */
export function sanitizePrivacyRequest(body, cfg, now = new Date()) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!['on', 'off', 'toggle'].includes(b.mode)) return { error: 'mode must be on, off or toggle' };
  const given = ['hours', 'until', 'untilTime'].filter((k) => b[k] !== undefined && b[k] !== null && b[k] !== '');
  if (given.length > 1) return { error: 'use only one of hours, until or untilTime' };
  let end = null;
  if (b.hours !== undefined && b.hours !== null && b.hours !== '') {
    const h = Number(b.hours);
    if (!Number.isFinite(h) || h <= 0 || h > MAX_PRIVACY_HOURS) return { error: `hours must be between 0 and ${MAX_PRIVACY_HOURS}` };
    end = new Date(now.getTime() + Math.round(h * 3600_000)).toISOString();
  } else if (b.until) {
    const ms = typeof b.until === 'string' ? Date.parse(b.until) : NaN;
    if (!Number.isFinite(ms)) return { error: 'until must be an ISO date and time' };
    if (ms <= now.getTime()) return { error: 'until must be in the future' };
    if (ms - now.getTime() > MAX_PRIVACY_HOURS * 3600_000) return { error: `until must be within ${MAX_PRIVACY_HOURS} hours` };
    end = new Date(ms).toISOString();
  } else if (b.untilTime) {
    if (typeof b.untilTime !== 'string' || !HHMM.test(b.untilTime)) return { error: 'untilTime must be HH:MM' };
    end = nextLocalTime(b.untilTime, now, cfg.datetime.timezone);
  }
  if (b.screens !== undefined && b.screens !== null && !Array.isArray(b.screens)) return { error: 'screens must be an array' };
  return { value: { mode: b.mode, end, screens: b.screens ?? [] } };
}

/**
 * Apply a request to the stored states (pure: returns a new object).
 * `states` = { [screenId]: { on, until, by, at } }; `screenIds` = targets ([] = every screen).
 * @returns {{ states: object, changed: string[] }} changed = screens whose privacy turned on or off
 */
export function applyPrivacyRequest(cfg, states, { mode, end = null, screenIds = [], by = 'admin' }, now = new Date()) {
  const next = pruneStates(cfg, states, now);
  const targets = cfg.screens.filter((s) => !screenIds.length || screenIds.includes(s.id));
  const changed = [];
  const at = now.toISOString();
  for (const s of targets) {
    const before = privacyStatus(cfg, s, next[s.id], now);
    const on = mode === 'toggle' ? !before.active : mode === 'on';
    if (on) {
      next[s.id] = { on: true, until: end ?? null, by, at };
    } else {
      const sched = privacyScheduleState(enabledRules(s), now, cfg.datetime.timezone);
      if (sched.active) next[s.id] = { on: false, until: sched.until, by, at };
      else delete next[s.id];
    }
    if (privacyStatus(cfg, s, next[s.id], now).active !== before.active) changed.push(s.id);
  }
  return { states: next, changed };
}

/** Drop states of deleted screens and periods that are over. */
export function pruneStates(cfg, states, now = new Date()) {
  const ids = new Set(cfg.screens.map((s) => s.id));
  const out = {};
  for (const [id, st] of Object.entries(states && typeof states === 'object' ? states : {})) {
    if (!ids.has(id) || !live(st, now)) continue;
    out[id] = { on: Boolean(st.on), until: st.until ?? null, by: st.by === 'hook' || st.by === 'family' ? st.by : 'admin', at: typeof st.at === 'string' ? st.at : now.toISOString() };
  }
  return out;
}

/** PrivacyResponse.screens: one row per screen. */
export function privacyOverview(cfg, states, now = new Date()) {
  return cfg.screens.map((s) => ({
    screenId: s.id, slug: s.slug, name: s.name,
    ...privacyStatus(cfg, s, states?.[s.id], now),
    scheduled: enabledRules(s).length > 0,
  }));
}

/**
 * The `privacy` block of GET /api/display/config. `status` = privacyStatus(); `nextMs` = privacyNextChange().
 * `next`: when the display should ask again even without a live event (a period ends, a rule starts).
 */
export function displayPrivacy(screen, status, nextMs = null) {
  const next = nextMs ? new Date(nextMs).toISOString() : null;
  return status?.active
    ? { active: true, until: status.until, lock: screen.privacy?.showLock !== false, next }
    : { active: false, until: null, lock: false, next };
}
