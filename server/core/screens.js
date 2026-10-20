// Screen profiles (F1): resolve ?screen=, project the v2 config into the flat per-screen view that the display
// (and the legacy single-screen code paths) understand. Pure functions. See docs/API.md and docs/ARCHITECTURE.md.
// Mirror for the admin panel: web/shared/screens.ts (keep both in sync).
import { SCREEN_SPLIT_KEYS, SCREEN_ONLY_KEYS, LOCAL_SOURCE_ID, BIRTHDAYS_SOURCE_ID } from './defaults.js';
import { displayPrivacy } from './privacy.js';
import { showsFamilyQr } from './familyCore.js';
import { carouselBlock } from './carousels.js';
import { canvasWidgetIds, projectCanvas } from './canvasCore.js';

/** Default screen profile (cfg.defaultScreen, falling back to the first one). */
export function defaultScreen(cfg) {
  return cfg.screens.find((s) => s.id === cfg.defaultScreen) || cfg.screens[0];
}

/**
 * Find a screen by slug (case-insensitive) or id. Returns { screen, fallback } where `fallback` is true when
 * `key` was given but matched nothing (the default screen is returned then). Empty key → default, fallback false.
 */
export function resolveScreen(cfg, key) {
  const k = typeof key === 'string' ? key.trim().toLowerCase() : '';
  if (!k) return { screen: defaultScreen(cfg), fallback: false };
  const hit = cfg.screens.find((s) => s.slug === k || s.id.toLowerCase() === k);
  return hit ? { screen: hit, fallback: false } : { screen: defaultScreen(cfg), fallback: true };
}

/**
 * Flat (v1-shaped) view of one screen: global sections merged with that screen's per-screen sections.
 * `screen.name` = profile name. Includes every global key too (localEvents, birthdays, …).
 */
export function flatView(cfg, screen) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) if (k !== 'screens') out[k] = v;
  for (const k of SCREEN_ONLY_KEYS) out[k] = screen[k];
  out.screen = { name: screen.name, ...screen.screen };
  for (const k of Object.keys(SCREEN_SPLIT_KEYS)) out[k] = { ...cfg[k], ...screen[k] };
  out.screenId = screen.id;
  out.slug = screen.slug;
  return out;
}

/** Enabled calendar sources visible on a screen, including the built-in local/birthdays pseudo-sources. */
export function screenSourceIds(cfg, screen) {
  const ids = [
    ...cfg.calendar.sources.filter((s) => s.enabled).map((s) => s.id),
    ...(cfg.localEvents.enabled ? [LOCAL_SOURCE_ID] : []),
    ...(cfg.birthdays.enabled ? [BIRTHDAYS_SOURCE_ID] : []),
  ];
  if (!screen) return ids;
  if (!screen.calendar.enabled) return [];
  const only = screen.calendar.sourceIds;
  return Array.isArray(only) ? ids.filter((id) => only.includes(id)) : ids;
}

/** Public projection of every source (incl. pseudo-sources) as sent to the display legend. */
export function publicSources(cfg, screen) {
  const visible = new Set(screenSourceIds(cfg, screen));
  const all = [
    ...cfg.calendar.sources.map(({ id, name, color, emoji, kind }) => ({ id, name, color, emoji, kind })),
    { id: LOCAL_SOURCE_ID, name: cfg.localEvents.name, color: cfg.localEvents.color, emoji: cfg.localEvents.emoji, kind: 'generic' },
    { id: BIRTHDAYS_SOURCE_ID, name: cfg.birthdays.name, color: cfg.birthdays.color, emoji: cfg.birthdays.emoji, kind: 'birthdays' },
  ];
  // Pseudo-sources without any item are left out of the legend.
  const empty = new Set([
    ...(cfg.localEvents.items.length ? [] : [LOCAL_SOURCE_ID]),
    ...(cfg.birthdays.items.length ? [] : [BIRTHDAYS_SOURCE_ID]),
  ]);
  return all.filter((s) => visible.has(s.id) && !empty.has(s.id));
}

/** Schedules (F5) that target a screen (enabled; empty screenIds = all screens). */
export function screenSchedules(cfg, screen) {
  return cfg.schedules.items.filter((m) => m.enabled && (!m.screenIds.length || m.screenIds.includes(screen.id)));
}

/**
 * The `family` block of the display config: what the kids layouts need to know before asking for the family state
 * (GET /api/display/family). `qrUrl` = the family page (familyQr, from server/family.js; the cloud passes its own) when the screen shows the QR, has a
 * kids layout and is not private. While private there are no stars and no touch.
 */
export function displayFamilyBlock(cfg, screen, priv, familyQr = null) {
  const fam = cfg.family;
  const sf = screen.family || {};
  const on = Boolean(fam?.enabled);
  return {
    enabled: on,
    mealsEnabled: Boolean(on && fam.meals?.enabled),
    showPoints: Boolean(on && fam.showPoints && !priv),
    touch: Boolean(on && sf.touch && !priv),
    qrUrl: on && sf.showQr !== false && !priv && familyQr && showsFamilyQr(screen) ? familyQr : null,
    privacy: fam?.privacy === 'hide' ? 'hide' : 'initials',
  };
}

/** Short, stable hash of a string (FNV-1a, 32 bits, hex). Plain JS: the admin bundles this file (livePreview.ts). */
function shortHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** What changes when a saved widget changes in a way the display must load again (its `v`). */
export const widgetVersion = (w) => shortHash(JSON.stringify(w.type === 'currency' ? [w.type] : w.type === 'prices' ? [w.type, w.options.prices?.zone, ...(w.options.prices?.tariff === 'grid' ? [w.options.prices.grid] : [])] : [w.type, w.options.url, w.options.refreshSec, w.options.bust]));

/**
 * Widgets a screen shows, in display form. `widgetSrc(w)` = what the display loads: the URL itself on a server whose
 * TVs load widgets directly (default), or a route of this server (Marco Cloud). None while private.
 * The 'widget' layout's widget comes first, with place 'full'; then the screen's placements in order; then the widgets
 * a Personalizado screen shows ('widget' items), with place 'canvas'.
 */
export function displayWidgets(cfg, screen, { isPrivate = false, widgetSrc = null } = {}) {
  if (isPrivate) return [];
  const defs = new Map((Array.isArray(cfg.widgets) ? cfg.widgets : []).map((w) => [w.id, w]));
  const one = (w, place, corner, size) => (w.type === 'currency'
    // exchange rates: the display asks this server for them (GET /api/display/currency) and draws them itself; the
    // options go through update(), so `v` stays the same when they change
    ? { id: w.id, type: w.type, name: w.name, place, corner, size, refreshSec: 0, fit: 'contain', bust: false, src: '', via: 'direct', v: widgetVersion(w), currency: structuredClone(w.options.currency) }
    : w.type === 'prices'
    // the display asks this server for the zone's prices (GET /api/display/prices) and draws them itself
    ? { id: w.id, type: w.type, name: w.name, place, corner, size, refreshSec: 0, fit: 'contain', bust: false, src: '', via: 'direct', v: widgetVersion(w), prices: { ...w.options.prices } }
    : {
        id: w.id, type: w.type, name: w.name, place, corner, size,
        refreshSec: w.options.refreshSec, fit: w.options.fit, bust: w.options.bust,
        src: widgetSrc ? widgetSrc(w) : w.options.url,
        via: widgetSrc ? 'proxy' : 'direct',
        v: widgetVersion(w),
      });
  const out = [];
  const full = screen.layout?.preset === 'widget' ? defs.get(screen.layout.widgetId) : null;
  if (full) out.push(one(full, 'full', 'br', 'l'));
  for (const p of Array.isArray(screen.widgets) ? screen.widgets : []) {
    const w = defs.get(p.widgetId);
    if (w) out.push(one(w, p.place, p.corner, p.size));
  }
  for (const id of canvasWidgetIds(screen, { tz: cfg.datetime?.timezone || 'UTC' })) {
    const w = defs.get(id);
    if (w && !out.some((o) => o.id === id && o.place === 'canvas')) out.push(one(w, 'canvas', 'br', 'm'));
  }
  return out;
}

/**
 * GET /api/display/config payload for one screen (no secrets, no HA entity ids, no URLs except two: the family page's,
 * which the TV draws as a QR code, and the widgets' addresses on a server whose TVs load them directly).
 * `privacy` = { status, next } from core/privacy.js (privacyStatus, privacyNextChange); absent = not private.
 * While private with `hidePhotos`, the background only uses stock photos.
 * `carousel` = the carousel this display runs (the screen is one of its members), else null: the payload then says
 * which carousel (`target`, `carousel`) so the display can rotate through its screens.
 * `familyQr` = the family page URL (family.js familyQrUrl), or null without a family link.
 * `widgetSrc` = how the display loads widgets (displayWidgets): null = the URL itself.
 * `canvasKinds` / `haControls` = what a Personalizado screen may show on this server (core/canvasCore.js projectCanvas).
 * `trusted` = false for a display that may not tap (open mode from outside the local network): no navigation taps.
 */
export function displayConfig(cfg, screen, { privacy = null, carousel = null, familyQr = null, widgetSrc = null, canvasKinds, haControls, trusted } = {}) {
  const f = flatView(cfg, screen);
  const priv = displayPrivacy(screen, privacy?.status, privacy?.next ?? null);
  // the special background rules stay on the server (their words name events): /api/photos applies them. The display
  // only learns that there are some (`special`), so it asks for its photos again when the events or the day change.
  const { rules, ...rest } = f.background;
  const bg = Array.isArray(rules) && rules.length ? { ...rest, special: true } : rest;
  const background = priv.active && screen.privacy?.hidePhotos && bg.source !== 'stock' ? { ...bg, source: 'stock' } : bg;
  const { sources, sourceIds, ...cal } = f.calendar;
  const { haWeatherEntity, haIndoorTempEntity, haIndoorHumidityEntity, ...weather } = f.weather;
  return {
    revision: cfg.revision,
    screenId: screen.id,
    slug: screen.slug,
    screen: f.screen,
    layout: f.layout,
    background,
    calendar: { ...cal, sources: publicSources(cfg, screen) },
    datetime: f.datetime,
    weather,
    news: { enabled: f.news.enabled, rotateSec: f.news.rotateSec },
    todo: { enabled: f.todo.enabled, items: f.todo.items },
    message: f.message,
    countdowns: { enabled: f.countdowns.enabled, max: f.countdowns.max },
    alerts: f.alerts,
    schedules: screenSchedules(cfg, screen).map(({ screenIds, ...m }) => m),
    privacy: priv,
    family: displayFamilyBlock(cfg, screen, priv.active, familyQr),
    widgets: displayWidgets(cfg, screen, { isPrivate: priv.active, widgetSrc }),
    // the Personalizado layout's widgets (null on every other layout)
    canvas: projectCanvas(screen, {
      isPrivate: priv.active, canvasKinds, haControls, tz: cfg.datetime?.timezone || 'UTC', haOff: !cfg.homeassistant?.enabled,
      members: (cfg.family?.members ?? []).map((m) => ({ id: m.id, calendarId: m.calendarId ?? null })),
      screens: (cfg.screens ?? []).map((x) => ({ id: x.id, name: x.name })), trusted,
    }),
    // what the display is bound to: this screen, or a carousel that shows it among others
    target: carousel
      ? { id: carousel.id, kind: 'carousel', slug: carousel.slug, name: carousel.name }
      : { id: screen.id, kind: 'screen', slug: screen.slug, name: screen.name },
    carousel: carousel ? carouselBlock(cfg, carousel) : null,
  };
}
