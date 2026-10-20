// Special backgrounds (#14): which rule of a screen's background.rules holds right now (the matching itself is pure,
// core/bgRules.js), and the check that tells displays when that changes. The refresher calls syncPhotoRules() after
// every run (each minute, after a calendar refresh and after a config save), so midnight, a new or removed event and
// a rule edit reach the screens within a minute: the screens whose active rule changed get a `photos` live event and
// ask for a new batch.
import { getConfig } from './store.js';
import { getDetailedEvents } from './calendars.js';
import { publish } from './pollHub.js';
import { screenPrivacy } from './privacy.js';
import { screenSourceIds } from './core/screens.js';
import { localDate } from './core/lib/tz.js';
import { backgroundRuleSig, matchBackgroundRule, ruleEventSources, rulesNeedEvents } from './core/bgRules.js';

/** screenId → signature of the active rule, as displays were last told */
let told = new Map();

/**
 * The rule of `screen` that holds at `now`, or null. Event rules read today's events of their calendars (the
 * calendars the screen shows when they name none, even when the screen hides its calendar).
 */
export async function activeBackgroundRule(cfg, screen, now = new Date()) {
  const rules = screen?.background?.rules;
  if (!Array.isArray(rules) || !rules.length) return null;
  const tz = cfg.datetime.timezone;
  const today = localDate(now, tz);
  const shown = screenSourceIds(cfg, { ...screen, calendar: { ...screen.calendar, enabled: true } });
  let events = [];
  if (rulesNeedEvents(rules)) {
    const ids = ruleEventSources(rules, shown);
    if (ids.length) {
      // every enabled calendar the rules name, in the screen's language (the same cache and memo as /api/events)
      const all = { ...screen, calendar: { ...screen.calendar, enabled: true, sourceIds: null } };
      try {
        events = (await getDetailedEvents({ from: today, to: today, screen: all, onlyIds: ids, cfg })).wire;
      } catch (err) {
        console.warn('[photoRules] events failed:', err.message);
      }
    }
  }
  return matchBackgroundRule(rules, {
    today, tz, events, screenSources: shown,
    birthdays: cfg.birthdays?.enabled ? cfg.birthdays.items : [],
    cfg, isPrivate: screenPrivacy(cfg, screen, now).active, lang: screen.screen?.language,
  });
}

/**
 * Tell the displays of every screen whose active rule changed since the last check (`photos` live event: they ask
 * for a new batch, whose `rule` signature tells them to change the photo at once). The first check only takes note.
 */
export async function syncPhotoRules(now = new Date()) {
  const cfg = getConfig();
  if (!cfg) return [];
  const changed = [];
  for (const s of cfg.screens) {
    const sig = backgroundRuleSig(await activeBackgroundRule(cfg, s, now));
    if (told.has(s.id) && told.get(s.id) !== sig) changed.push(s.id);
    told.set(s.id, sig);
  }
  for (const id of told.keys()) if (!cfg.screens.some((s) => s.id === id)) told.delete(id);
  if (changed.length) publish('photos', {}, { screenIds: changed });
  return changed;
}

/** Testing helper: forget what displays were told. */
export function _resetPhotoRules() {
  told = new Map();
}
