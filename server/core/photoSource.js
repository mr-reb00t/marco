// Photo options (#41): where a slideshow takes its photos from, the order, the special backgrounds and the weather
// effect over them. The screen's Fondo (screen.background) has them, and so may a Personalizado photo card
// (canvas item props.photoSource) and the sidebar's own photo (canvas.sidebar.photoSource). A card or sidebar block
// with mode 'screen' (or none at all) shows the screen's photos, the look it always had; with mode 'own' it shows its
// own. The keys and checks are the background's, so both read the same. Pure: the validator, the canvas code, the
// server's /api/photos and Marco Cloud use it.
import { hash } from './lib/text.js';
import { IMMICH_ID_RE, MAX_IMMICH_ALBUMS } from './immichCore.js';
import { sanitizeBackgroundRules } from './bgRules.js';

export const PHOTO_SOURCES = ['stock', 'gallery', 'mixed', 'immich'];
export const PHOTO_ORDERS = ['random', 'newest', 'name'];
export const WEATHER_FXS = ['off', 'simple', 'rich'];
/** 'screen': the screen's Fondo (the default); 'own': the block's own settings */
export const PHOTO_SOURCE_MODES = ['screen', 'own'];
/** What a card's or the sidebar's block starts with when a key is missing (a new screen's Fondo; no weather effect). */
export const PHOTO_PICK_DEFAULTS = Object.freeze({ source: 'stock', stockTopic: 'nature', order: 'random', immich: Object.freeze({ albumIds: Object.freeze([]), favoritesOnly: false }) });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// the coercers of validate.js, with the same messages
function oneOf(err, path, v, d, list) {
  if (v === undefined) return d;
  if (list.includes(v)) return v;
  err(path, `must be one of ${list.join(', ')}`);
  return d;
}
function str(err, path, v, d, max) {
  if (v === undefined || v === null) return d;
  if (typeof v !== 'string') {
    err(path, 'expected string');
    return d;
  }
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (s.length > max) {
    err(path, `too long (max ${max})`);
    return s.slice(0, max);
  }
  return s;
}
function bool(err, path, v, d) {
  if (v === undefined) return d;
  if (typeof v === 'boolean') return v;
  err(path, 'expected boolean');
  return d;
}
function objOf(err, path, v) {
  if (v === undefined) return {};
  if (!isObj(v)) {
    err(path, 'expected object');
    return {};
  }
  return v;
}

/**
 * The photo keys a block shares with the screen's Fondo: source, stockTopic, order, immich and rules. `D` = the
 * defaults (the screen's: defaultScreenProfile().background); `sourceIds` = calendars a rule may name (null = any);
 * `immichAvailable` false refuses the Immich source and Immich rules (Marco Cloud). Errors go to `err(path, message)`
 * under `path` (`${path}.source`, `${path}.immich.albumIds`, `${path}.rules[i]...`).
 */
export function sanitizePhotoPick(raw, D = PHOTO_PICK_DEFAULTS, { err = () => {}, path = 'background', sourceIds = null, immichAvailable = true } = {}) {
  const x = isObj(raw) ? raw : {};
  const im = objOf(err, `${path}.immich`, x.immich);
  let albumIds = [];
  if (im.albumIds !== undefined) {
    if (!Array.isArray(im.albumIds)) err(`${path}.immich.albumIds`, 'expected array');
    else if (im.albumIds.length > MAX_IMMICH_ALBUMS) {
      err(`${path}.immich.albumIds`, `too many items (max ${MAX_IMMICH_ALBUMS})`);
      albumIds = im.albumIds.slice(0, MAX_IMMICH_ALBUMS);
    } else albumIds = im.albumIds;
  }
  if (albumIds.some((a) => typeof a !== 'string' || !IMMICH_ID_RE.test(a))) err(`${path}.immich.albumIds`, 'invalid album id');
  const source = oneOf(err, `${path}.source`, x.source, D.source, PHOTO_SOURCES);
  if (immichAvailable === false && source === 'immich') err(`${path}.source`, 'Immich is not available');
  return {
    source,
    stockTopic: str(err, `${path}.stockTopic`, x.stockTopic, D.stockTopic, 60),
    order: oneOf(err, `${path}.order`, x.order, D.order, PHOTO_ORDERS),
    immich: {
      albumIds: [...new Set(albumIds.filter((a) => typeof a === 'string' && IMMICH_ID_RE.test(a)).map((a) => a.toLowerCase()))],
      favoritesOnly: bool(err, `${path}.immich.favoritesOnly`, im.favoritesOnly, D.immich.favoritesOnly),
    },
    // "Fondos especiales" (#14, core/bgRules.js): other photos on some days; the first rule that matches wins
    rules: sanitizeBackgroundRules(x.rules, { err, path: `${path}.rules`, sourceIds, immichAvailable: immichAvailable !== false }),
  };
}

/**
 * A photo card's or the sidebar's block: { mode, source, stockTopic, order, immich, rules, weatherFx }. Kept with
 * mode 'screen' too, so going back to its own photos finds them as they were. Not an object: an error and null (the
 * caller then stores no block, so it shows the screen's photos).
 */
export function sanitizePhotoSource(raw, { err = () => {}, path = 'photoSource', sourceIds = null, immichAvailable = true } = {}) {
  if (!isObj(raw)) {
    err(path, 'expected object');
    return null;
  }
  const pick = sanitizePhotoPick(raw, PHOTO_PICK_DEFAULTS, { err, path, sourceIds, immichAvailable });
  return {
    mode: oneOf(err, `${path}.mode`, raw.mode, 'screen', PHOTO_SOURCE_MODES),
    ...pick,
    // over a card it is off unless chosen
    weatherFx: oneOf(err, `${path}.weatherFx`, raw.weatherFx, 'off', WEATHER_FXS),
  };
}

/** The block shows its own photos (not the screen's). */
export const isOwnPhotoSource = (b) => isObj(b) && b.mode === 'own';

/** A block's rules without their pace (#45): a new pace is not a new list, so the photo on screen stays. */
const rulesForSig = (rules) => (Array.isArray(rules) ? rules.map(({ intervalSec, ...r }) => r) : []);

/**
 * What decides a block's photo list: two blocks with the same signature get the same photos and share their rotation
 * memory on the server (photos.js). The weather effect, the mode and the rules' pace play no part.
 */
export function photoSourceSig(b) {
  return hash({ source: b?.source ?? 'stock', stockTopic: b?.stockTopic ?? '', order: b?.order ?? 'random', immich: b?.immich ?? null, rules: rulesForSig(b?.rules) }, 12);
}

/**
 * A block as the display gets it: no rules (their words name events, /api/photos applies them), only whether it has
 * some (`special`, so it asks again when the day or the events change) and a signature of them (`rulesSig`, so an
 * edited rule is a new list; its pace alone is not).
 */
export function displayPhotoSource(b) {
  const { rules, ...rest } = b;
  const list = Array.isArray(rules) ? rules : [];
  return { ...rest, special: list.length > 0, rulesSig: list.length ? hash(rulesForSig(list), 12) : '' };
}

/** Gallery files the rules of a list may show. */
export function rulesGalleryFiles(rules) {
  const out = new Set();
  for (const r of Array.isArray(rules) ? rules : []) if (r?.photos?.source === 'gallery') for (const f of r.photos.files || []) out.add(f);
  return out;
}

/** Immich albums the rules of a list play. */
export function rulesAlbumIds(rules) {
  const out = new Set();
  for (const r of Array.isArray(rules) ? rules : []) if (r?.photos?.source === 'immich' && r.photos.albumId) out.add(r.photos.albumId);
  return [...out];
}
