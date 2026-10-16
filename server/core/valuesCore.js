// Pushed values for the Valor card (POST /api/hooks/values) and token scopes, shared by the self-hosted server and
// Marco Cloud. Pure: no I/O, no clock (callers pass `now`). See docs/API.md.
import { VALUE_KEY_RE, canvasCards } from './canvasCore.js';

/** What an API token may do. A token with no `scopes` field (made before scopes existed) has '*'. */
export const TOKEN_SCOPES = Object.freeze(['announce', 'commands', 'privacy', 'doorbell', 'values', 'screen']);
/** Scopes '*' does not include: they must be ticked one by one (a token that changes what a screen shows). */
export const EXPLICIT_SCOPES = Object.freeze(['screen']);

/**
 * The scopes of a stored token, cleaned: ['*'] when the field is missing, else the known scopes in TOKEN_SCOPES order
 * ('*' first when present), possibly none.
 */
export function tokenScopes(raw) {
  // only a token with no field at all (made before scopes existed) has everything; a list (or a single name) that
  // names nothing this version knows, such as a scope of a newer version after a downgrade, allows nothing
  if (raw === undefined || raw === null) return ['*'];
  const list = Array.isArray(raw) ? raw : [raw];
  const set = new Set(list.filter((s) => typeof s === 'string'));
  return [...(set.has('*') ? ['*'] : []), ...TOKEN_SCOPES.filter((s) => set.has(s))];
}

/**
 * Scopes as the admin sends them: { scopes } or { error }. Missing means ['*'] (Todo). An empty list or an unknown
 * name is an error, so a typo never makes a token that can do nothing or everything.
 */
export function parseScopes(raw) {
  if (raw === undefined || raw === null) return { scopes: ['*'] };
  if (!Array.isArray(raw) || !raw.length || raw.length > 10) return { error: 'scopes must be a non-empty list' };
  for (const s of raw) if (s !== '*' && !TOKEN_SCOPES.includes(s)) return { error: `unknown scope: ${String(s).slice(0, 20)}` };
  return { scopes: tokenScopes(raw) };
}

/** True when a token with `scopes` may use a route of `scope`. */
export function hasScope(scopes, scope) {
  const list = tokenScopes(scopes);
  if (list.includes(scope)) return true;
  return list.includes('*') && !EXPLICIT_SCOPES.includes(scope);
}

export const VALUES_LIMITS = Object.freeze({
  /** entries in one request */
  perRequest: 20,
  /** request body, bytes */
  bodyBytes: 8 * 1024,
  /** characters of a string value */
  valueChars: 120,
  unitChars: 16,
  labelChars: 40,
  /** one stored update per key in this window; later ones inside it overwrite it (last value wins, no 429) */
  windowMs: 2000,
  /** keys kept at once (self-hosted; Marco Cloud passes its own plan limit) */
  keys: 50,
});

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/g; // eslint-disable-line no-control-regex
const clean = (s, max) => String(s).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Check the body of POST /api/hooks/values: { values: [{ key, value, unit?, label? }] } (a single { key, value } is
 * accepted too). Returns { values } (later entries of a key replace earlier ones, order kept) or { error }.
 * Values are numbers (finite), booleans or strings (at most 120 characters); they stay plain text everywhere.
 */
export function parseValues(body, limits = VALUES_LIMITS) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be a JSON object' };
  const list = Array.isArray(body.values) ? body.values : body.key !== undefined ? [body] : null;
  if (!list) return { error: 'values must be a list of { key, value }' };
  if (!list.length) return { error: 'values is empty' };
  if (list.length > limits.perRequest) return { error: `at most ${limits.perRequest} values per request` };
  const out = new Map();
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const at = `values[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { error: `${at} must be an object` };
    if (typeof e.key !== 'string' || !VALUE_KEY_RE.test(e.key)) return { error: `${at}.key must be 1-40 characters a-z, 0-9, _ . -` };
    let v = e.value;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return { error: `${at}.value must be a finite number` };
    } else if (typeof v === 'string') {
      if (v.length > limits.valueChars) return { error: `${at}.value is longer than ${limits.valueChars} characters` };
      v = clean(v, limits.valueChars);
    } else if (typeof v !== 'boolean') return { error: `${at}.value must be a number, a string or true/false` };
    const x = { key: e.key, value: v };
    if (e.unit !== undefined && e.unit !== null) {
      if (typeof e.unit !== 'string') return { error: `${at}.unit must be a string` };
      x.unit = clean(e.unit, limits.unitChars);
    }
    if (e.label !== undefined && e.label !== null) {
      if (typeof e.label !== 'string') return { error: `${at}.label must be a string` };
      x.label = clean(e.label, limits.labelChars);
    }
    out.delete(e.key);
    out.set(e.key, x);
  }
  return { values: [...out.values()] };
}

/**
 * The value keys a screen shows: its Valor cards and the custom cards bound to a key (hidden items left out, and
 * the items in `hiddenIds`).
 * Only these keys ever reach a display of that screen.
 */
export function screenValueKeys(screen, hiddenIds = null) {
  const keys = new Set();
  if (screen?.layout?.preset !== 'canvas') return keys;
  for (const it of canvasCards(screen.canvas?.items)) {
    // hidden items, and the ones a condition hides now (`hiddenIds`), get no values (a Rotativa's cards: with it)
    if (it.hidden || hiddenIds?.has(it.id)) continue;
    if (it.kind === 'value' && typeof it.props?.key === 'string' && VALUE_KEY_RE.test(it.props.key)) keys.add(it.props.key);
    if (it.kind === 'html' && Array.isArray(it.props?.bind)) {
      for (const b of it.props.bind) if (typeof b?.value === 'string' && VALUE_KEY_RE.test(b.value)) keys.add(b.value);
    }
  }
  return keys;
}

/** A stored value as a display gets it: { v, u?, l?, at } (`at` in ms). */
export function displayValue(rec) {
  const out = { v: rec.value, at: rec.at };
  if (rec.unit) out.u = rec.unit;
  if (rec.label) out.l = rec.label;
  return out;
}
