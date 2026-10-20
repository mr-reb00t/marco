// Server capabilities for the admin, read once from GET /api/health (docs/API.md "Health").
// Plain TypeScript with type-only imports, so the server tests can load it.
//
// Rules:
// - No `features` field at all (servers older than 0.5.0): every feature is on, except the account menu,
//   which no server before 0.5.0 had, and the OPT_IN features below (Microsoft calendars, updates, feedback,
//   doorbell).
// - A key missing from `features` is off only when the edition is not 'self-hosted' (OPT_IN keys: always off).
// - No `limits` field: the only limits are the config validator's own caps (BUILTIN_LIMITS).
import type { FeatureName, Features, HealthResponse, Limits } from '../shared/types';

export type LimitName = keyof Limits;

export interface Caps {
  edition: 'self-hosted' | 'cloud';
  tenancy: 'single' | 'multi';
  runtime: 'node' | 'workers';
  live: 'sse' | 'poll';
  pairCodeLength: number;
  /** null = the server sent no `features` field (everything on) */
  features: Partial<Features> | null;
  limits: Limits;
  /** absolute origin of the display pages; null = same origin as the admin */
  displayOrigin: string | null;
  version: string;
  uptime: number | null;
}

/** Hard caps of the config validator (server/core/validate.js). They apply in every edition; a plan limit
 *  from the server can only lower them. */
export const BUILTIN_LIMITS: Partial<Record<LimitName, number>> = {
  screens: 12,
  sources: 50,
  newsFeeds: 20,
  localEvents: 1000,
  birthdays: 500,
  countdowns: 100,
  carousels: 6,
  widgets: 20,
};

const DEFAULT_PAIR_CODE_LENGTH = 6;

/** Normalise a /api/health body (or null when it could not be read) into Caps. */
export function capsFrom(health: Partial<HealthResponse> | null | undefined): Caps {
  const h = health && typeof health === 'object' ? health : {};
  const edition = h.edition === 'cloud' ? 'cloud' : 'self-hosted';
  const len = Number(h.pairCodeLength);
  const features = h.features && typeof h.features === 'object' ? { ...h.features } : null;
  const limits: Limits = {};
  if (h.limits && typeof h.limits === 'object') {
    for (const [k, v] of Object.entries(h.limits)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) (limits as any)[k] = v;
  }
  let displayOrigin: string | null = null;
  if (typeof h.displayOrigin === 'string' && h.displayOrigin) {
    try {
      const u = new URL(h.displayOrigin);
      if (u.protocol === 'https:' || u.protocol === 'http:') displayOrigin = u.origin;
    } catch {
      /* not an absolute URL: same origin */
    }
  }
  return {
    edition,
    tenancy: h.tenancy === 'multi' ? 'multi' : 'single',
    runtime: h.runtime === 'workers' ? 'workers' : 'node',
    live: h.live === 'poll' ? 'poll' : 'sse',
    pairCodeLength: Number.isInteger(len) && len >= 4 && len <= 12 ? len : DEFAULT_PAIR_CODE_LENGTH,
    features,
    limits,
    displayOrigin,
    version: typeof h.version === 'string' ? h.version : '',
    uptime: typeof h.uptime === 'number' && Number.isFinite(h.uptime) ? h.uptime : null,
  };
}

/** Whether `caps` turns `feature` on (see the rules at the top of this file). */
/** Features that only exist on servers that say so in `features`; off when the field or the key is missing.
 *  microsoftCalendar: Marco Cloud, or a self-hosted server with its own Entra app; updates: self-hosted servers
 *  that have the update endpoints; feedback: Marco Cloud's help and feedback form; privacy: privacy mode (servers
 *  that filter events for it, see /api/admin/privacy); doorbell, doorbellLive: servers with POST /api/hooks/doorbell
 *  (live = frames proxied from Home Assistant); carousels: servers that keep config.carousels and serve displays
 *  bound to one; immich: servers that proxy an Immich library (self-hosted); widgets: images (and with webWidgets,
 *  web pages) the owner places on screens (config.widgets); priceWidgets: the electricity price card (servers that
 *  answer GET /api/display/prices); familyPhotos: profile photos of the family members (servers that store them);
 *  accountSettings: the account settings on the admin's account page (Marco Cloud); screenBuilder: Personalizado, the
 *  screen builder (servers that validate layout 'canvas'); familyAccess: each person's own phone dashboard (servers
 *  with /api/admin/family-access). */
const OPT_IN: readonly FeatureName[] = ['accountMenu', 'microsoftCalendar', 'updates', 'feedback', 'privacy', 'doorbell', 'doorbellLive', 'carousels', 'immich', 'family', 'widgets', 'webWidgets', 'priceWidgets', 'familyPhotos', 'twoFactor', 'accountSettings', 'screenBuilder', 'familyAccess'];

export function hasFeature(caps: Caps, feature: FeatureName): boolean {
  if (!caps.features) return !OPT_IN.includes(feature);
  const v = caps.features[feature];
  if (typeof v === 'boolean') return v;
  return caps.edition === 'self-hosted' && !OPT_IN.includes(feature);
}

/** Features a self-hosted admin shows even when they are off, with a hint on how to set them up
 *  (Google needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server's .env). */
const SELF_HOSTED_SETUP_HINT: readonly FeatureName[] = ['googleCalendar', 'googleLogin'];

/** Whether the admin shows the controls of `feature`: on, or off on a self-hosted server that can still turn it on. */
export function offersFeature(caps: Caps, feature: FeatureName): boolean {
  return hasFeature(caps, feature) || (caps.edition === 'self-hosted' && SELF_HOSTED_SETUP_HINT.includes(feature));
}

/** True when the admin offers at least one of the features (no gate or an empty list counts as offered). */
export function offersAny(caps: Caps, features: FeatureName | readonly FeatureName[] | undefined): boolean {
  if (!features) return true;
  const list = typeof features === 'string' ? [features] : features;
  return list.length === 0 || list.some((f) => offersFeature(caps, f));
}

/** Effective limit: the plan limit when the server sends one, else the validator cap; null = no limit. */
export function limitOf(caps: Caps, name: LimitName): number | null {
  const plan = caps.limits[name];
  const builtin = BUILTIN_LIMITS[name];
  if (typeof plan === 'number') return typeof builtin === 'number' ? Math.min(plan, builtin) : plan;
  return typeof builtin === 'number' ? builtin : null;
}

// ---- the admin's current capabilities (module state, set once at boot) ----

let current: Caps = capsFrom(null);

/** Replace the current capabilities (boot, tests). */
export function setCaps(c: Caps) {
  current = c;
}

/** Current capabilities. */
export const caps = (): Caps => current;

/** Read /api/health and keep the result. A failed read keeps the old-server defaults (everything on). */
export async function loadCaps(fetchHealth: () => Promise<Partial<HealthResponse>> = defaultFetchHealth): Promise<Caps> {
  let health: Partial<HealthResponse> | null = null;
  try {
    health = await fetchHealth();
  } catch {
    health = null;
  }
  current = capsFrom(health);
  return current;
}

async function defaultFetchHealth(): Promise<Partial<HealthResponse>> {
  const r = await fetch('/api/health', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as Partial<HealthResponse>;
}

export const has = (feature: FeatureName): boolean => hasFeature(current, feature);
export const offers = (feature: FeatureName): boolean => offersFeature(current, feature);
export const edition = (): Caps['edition'] => current.edition;
export const isSelfHosted = (): boolean => current.edition === 'self-hosted';
export const runtime = (): Caps['runtime'] => current.runtime;
export const pairCodeLength = (): number => current.pairCodeLength;
export const limit = (name: LimitName): number | null => limitOf(current, name);
/** True when `count` items already reach the limit, so "add" must be disabled. */
export const atLimit = (name: LimitName, count: number): boolean => {
  const l = limit(name);
  return l != null && count >= l;
};
