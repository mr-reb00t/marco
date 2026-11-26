// Mealie (self-hosted recipes and meal planner) as a source for the week's meals: the pure parts shared by the
// validator, the server client (server/mealie.js) and the tests. No network here.
//
// Mealie's meal plan answers entries { date, entryType, title, text, recipeId, recipe: { id, name, image } | null }.
// mealieOverlay() turns them into { 'YYYY-MM-DD': { breakfast?, lunch?, snack?, dinner?, photo? } }, which
// familyCore.js mealsForDate() lays over Marco's own plan: per date and meal, Mealie's text wins; meals Mealie has
// nothing for keep Marco's plan (the week or the template).

/** The meal plan of Mealie 2.0 and newer (households). Mealie 1.x had /api/groups/mealplans. */
export const MEALPLAN_PATH = '/api/households/mealplans';
/** Recipe ids are UUIDs. */
export const MEALIE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mealie API tokens are JWTs (letters, digits, `-`, `_` and dots). */
export const MEALIE_TOKEN_RE = /^[A-Za-z0-9._-]{10,4096}$/;
/** The recipe image key Mealie sends (`recipe.image`, a short cache key), used in the photo address. */
export const MEALIE_IMAGE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Same as familyCore.js MAX_MEAL_TEXT (kept here so this file has no imports). */
export const MEALIE_MAX_TEXT = 120;
/** Mealie's entry types that are Marco meals. */
export const MEALIE_SLOTS = Object.freeze({ breakfast: 'breakfast', lunch: 'lunch', snack: 'snack', dinner: 'dinner' });
/** Entry types that go with the day's dinner, in this order after the dinner itself. */
export const DINNER_EXTRAS = Object.freeze(['side', 'drink', 'dessert']);
/** Several entries of one meal. */
export const JOIN = ' · ';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// eslint-disable-next-line no-control-regex
const clean = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '');

/** "https://mealie.example.com/api/ " → "https://mealie.example.com" (no trailing slash, no /api). */
export function normalizeMealieUrl(u) {
  let s = String(u ?? '').trim();
  for (let i = 0; i < 3; i++) s = s.replace(/\/+$/, '').replace(/\/api$/i, '');
  return s;
}

/** True for an absolute http(s) URL without credentials in it. */
export function mealieUrlOk(u) {
  try {
    const x = new URL(u);
    return (x.protocol === 'http:' || x.protocol === 'https:') && !x.username && !x.password && !x.search && !x.hash;
  } catch {
    return false;
  }
}

/** GET /api/admin/mealie/token: whether a token is stored and its last 4 characters (never the token). */
export function mealieTokenStatus(token) {
  const k = String(token || '');
  return { set: k.length > 0, hint: k.length >= 16 ? k.slice(-4) : '' };
}

/** "v3.31.0" → { major: 3, text: '3.31.0' }, or null. */
export function parseMealieVersion(v) {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v ?? '').trim());
  return m ? { major: Number(m[1]), text: `${m[1]}.${m[2]}.${m[3] ?? 0}` } : null;
}

/** Text of an entry: its recipe's name, else its title; '' when there is none. */
export function entryText(e) {
  if (!isObj(e)) return '';
  const name = isObj(e.recipe) ? clean(e.recipe.name) : '';
  return name || clean(e.title);
}

/** Cut to `max` characters (the last one an ellipsis when something was cut). */
export function clampText(s, max = MEALIE_MAX_TEXT) {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** { id, v } of an entry's recipe photo, or null (no recipe, no picture, or something odd in it). */
export function entryPhoto(e) {
  const r = isObj(e) ? e.recipe : null;
  if (!isObj(r) || typeof r.id !== 'string' || !MEALIE_ID_RE.test(r.id)) return null;
  const v = typeof r.image === 'string' ? r.image.trim() : '';
  return v && MEALIE_IMAGE_KEY_RE.test(v) ? { id: r.id.toLowerCase(), v } : null;
}

/** Dates of an entry: its date, through its endDate when Mealie sends one (at most 14 days). */
function entryDates(e) {
  const from = typeof e.date === 'string' ? e.date.slice(0, 10) : '';
  // a real day only ("2026-13-01" matches the pattern but is no date)
  if (!DATE.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || new Date(`${from}T00:00:00Z`).toISOString().slice(0, 10) !== from) return [];
  const to = typeof e.endDate === 'string' && DATE.test(e.endDate.slice(0, 10)) ? e.endDate.slice(0, 10) : from;
  const out = [from];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < 13 && out[out.length - 1] < to; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Mealie meal plan entries → { overlay, count }. `overlay` = { 'YYYY-MM-DD': { breakfast?, lunch?, snack?, dinner?,
 * photo? } } for dates in [from, to] (both optional). Breakfast, lunch, snack and dinner map to Marco's meals; side,
 * drink and dessert follow the day's dinner (or are the dinner when there is none); other types are left out.
 * Several entries of one meal are joined with " · ", in Mealie's order (by id). `photo` = { id, v } of the first
 * dinner entry whose recipe has a picture. `count` = entries used.
 */
export function mealieOverlay(items, { from = '', to = '' } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(isObj)
    .map((e, i) => ({ e, i, id: Number.isFinite(e.id) ? e.id : null }))
    .sort((a, b) => (a.id !== null && b.id !== null && a.id !== b.id ? a.id - b.id : a.i - b.i))
    .map((x) => x.e);
  const parts = Object.create(null); // date → { breakfast: [], …, side: [], drink: [], dessert: [], photo }
  let count = 0;
  for (const e of list) {
    const type = typeof e.entryType === 'string' ? e.entryType.toLowerCase() : '';
    if (!Object.hasOwn(MEALIE_SLOTS, type) && !DINNER_EXTRAS.includes(type)) continue;
    const txt = entryText(e);
    if (!txt) continue;
    let used = false;
    for (const date of entryDates(e)) {
      if ((from && date < from) || (to && date > to)) continue;
      const p = (parts[date] ??= Object.create(null));
      (p[type] ??= []).push(txt);
      if (type === 'dinner' && !p.photo) p.photo = entryPhoto(e);
      used = true;
    }
    if (used) count++;
  }
  const overlay = {};
  for (const date of Object.keys(parts).sort()) {
    const p = parts[date];
    const day = {};
    for (const slot of Object.values(MEALIE_SLOTS)) {
      const texts = slot === 'dinner' ? [...(p.dinner || []), ...DINNER_EXTRAS.flatMap((x) => p[x] || [])] : p[slot] || [];
      if (texts.length) day[slot] = clampText(texts.join(JOIN));
    }
    if (p.photo) day.photo = p.photo;
    if (Object.keys(day).length) overlay[date] = day;
  }
  return { overlay, count };
}

/** Recipe ids (lower case) of the photos in an overlay. */
export function overlayPhotoIds(overlay) {
  const out = new Map();
  for (const day of Object.values(overlay || {})) if (day?.photo) out.set(day.photo.id, day.photo.v);
  return out;
}

/** Meals (slot texts) in an overlay from `from` to `to` (inclusive, both optional). */
export function overlayMealCount(overlay, { from = '', to = '' } = {}) {
  let n = 0;
  for (const [date, day] of Object.entries(overlay || {})) {
    if ((from && date < from) || (to && date > to)) continue;
    for (const slot of Object.values(MEALIE_SLOTS)) if (day[slot]) n++;
  }
  return n;
}

/** Display address of a recipe photo (GET /media/mealie/<id>?v=<image key>, server/mealie.js mealieMedia). */
export const mealiePhotoPath = (photo) => `/media/mealie/${photo.id}?v=${encodeURIComponent(photo.v)}`;
