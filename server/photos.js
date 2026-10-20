// Background photos: picsum.photos stock (with author info), the local gallery in data/photos/ and Immich albums
// (server/immich.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { requestJson } from './lib/http.js';
import { defaultScreen } from './core/screens.js';
import { getConfig, paths, writeFileAtomic } from './store.js';
import { immichItems, warm } from './immich.js';
import { galleryFileAllowed, mediaScreens } from './displayAccess.js';
import { screenPrivacy } from './privacy.js';
import { IMMICH_ID_RE, placeOf } from './core/immichCore.js';
import {
  ALLOWED_EXT, ALLOWED_MIME, imageInfo as imageInfoOf, imageHeaderNeed, isJpeg, isGalleryFile, uploadName as coreUploadName,
  sniffImage as sniffImageOf, stripImageMetadata,
} from './core/imageInfo.js';

// Header parsing and the file name rules are pure (server/core/imageInfo.js); this file handles disk and multer.
export { exifOrientation, sanitizeFilename, isGalleryFile, sniffImage } from './core/imageInfo.js';

const LIST_TTL = 24 * 3600_000;
/** Per-file upload limit (the admin optimizes photos in the browser first, so real uploads are far smaller). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** Longest side the admin downscales to; larger gallery photos are offered for optimization. */
export const TARGET_MAX_SIDE = 2560;
export const CONFLICT_POLICIES = ['replace', 'rename', 'skip'];
const META_FILE = '.meta.json';
const TMP_PREFIX = '.upload-';
let picsumList = null; // { at, items }

async function getPicsumList() {
  if (picsumList && Date.now() - picsumList.at < LIST_TTL) return picsumList.items;
  try {
    const pages = await Promise.all([1, 2, 3].map((p) => requestJson(`https://picsum.photos/v2/list?page=${p}&limit=100`)));
    // landscape-ish photos only, they look best on a wall screen
    const items = pages.flat().filter((p) => p && p.id != null && p.width >= p.height);
    if (items.length) picsumList = { at: Date.now(), items };
  } catch (err) {
    console.warn('[photos] picsum list failed:', err.message);
  }
  return picsumList?.items || [];
}

/** Tests: seed the cached picsum list (no network). */
export function _setPicsumList(items) { picsumList = items ? { at: Date.now(), items } : null; }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function stockPhotos(count, { width = 1920, height = 1080 } = {}) {
  const list = await getPicsumList();
  if (!list.length) {
    return Array.from({ length: count }, () => ({
      url: `https://picsum.photos/seed/${crypto.randomBytes(5).toString('hex')}/${width}/${height}`,
      source: 'stock',
    }));
  }
  return shuffle([...list]).slice(0, count).map((p) => ({
    url: `https://picsum.photos/id/${p.id}/${width}/${height}`,
    author: p.author,
    source: 'stock',
  }));
}

// busboy decodes multipart filenames as latin1; recover UTF-8 names ("Fotó" instead of "FotÃ³").
export function fixLatin1(name) {
  const s = String(name || '');
  if (!/[\u0080-\u00ff]/.test(s)) return s;
  const utf8 = Buffer.from(s, 'latin1').toString('utf8');
  return utf8.includes('\ufffd') ? s : utf8;
}

/** Name an upload will get on disk: sanitized, `.jpeg` → `.jpg`, extension added from the MIME type when missing. */
export function uploadName(original, mimetype = 'image/jpeg', { multipart = false } = {}) {
  return coreUploadName(multipart ? fixLatin1(original) : original, mimetype);
}

const photoPath = (file) => path.join(paths.photos, file);
const exists = (file) => fs.existsSync(photoPath(file));
export const MAX_THUMB_BYTES = 2 * 1024 * 1024;
const THUMB_FIELDS = new Set(['thumbs[]', 'thumb']);
const PHOTO_FIELDS = new Set(['photos[]', 'photos']);
export const thumbsDir = () => path.join(paths.photos, '.thumbs');
const thumbPath = (file) => path.join(thumbsDir(), file);
export const isThumbField = (f) => THUMB_FIELDS.has(f);

/**
 * The image without its metadata (where it was taken, the camera, dates, comments: core/imageInfo.js
 * stripImageMetadata keeps the EXIF orientation only), or null when the bytes are not a JPEG, PNG or WebP that
 * parses. Every gallery photo and thumbnail is stored this way, whoever uploaded it and however.
 */
export function cleanImage(buf) {
  const mime = sniffImageOf(buf);
  const out = mime ? stripImageMetadata(buf, mime) : null;
  return out ? Buffer.from(out.buffer, out.byteOffset, out.byteLength) : null;
}

/** Rewrite a file on disk without its metadata. Returns false (file untouched) when it is not an image that parses. */
export function cleanImageFile(file) {
  const buf = fs.readFileSync(file);
  const out = cleanImage(buf);
  if (!out) return false;
  if (!out.equals(buf)) fs.writeFileSync(file, out);
  return true;
}

/** Store a (browser-made, small JPEG) thumbnail for a gallery file; `src` = temp file path or Buffer. */
export function storeThumb(file, src) {
  fs.mkdirSync(thumbsDir(), { recursive: true });
  const buf = Buffer.isBuffer(src) ? src : fs.readFileSync(src);
  const clean = cleanImage(buf) || buf; // validThumb checked it is a JPEG; one that does not parse is kept as sent
  writeFileAtomic(thumbPath(file), clean);
  if (!Buffer.isBuffer(src)) fs.rmSync(src, { force: true });
}
export function removeThumb(file) {
  try { fs.rmSync(thumbPath(file), { force: true }); } catch { /* ignore */ }
}
/** Cheap sanity check for an uploaded thumbnail (JPEG magic bytes, size cap). */
export function validThumb(src) {
  try {
    const buf = Buffer.isBuffer(src) ? src : fs.readFileSync(src);
    return buf.length <= MAX_THUMB_BYTES && isJpeg(buf);
  } catch {
    return false;
  }
}

/** First free "stem-2.ext", "stem-3.ext"… (same convention the sanitizer produces, so names stay URL-friendly). */
export function freeName(name) {
  if (!exists(name)) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length) || 'foto';
  for (let i = 2; ; i++) {
    const c = `${stem}-${i}${ext}`;
    if (!exists(c)) return c;
  }
}

// ---------------------------------------------------------------- metadata (data/photos/.meta.json)

/** { [file]: { w, h, focusX?, focusY?, bytes, uploadedAt } }: w/h are display dimensions (EXIF orientation applied). */
export function readMeta() {
  try {
    const j = JSON.parse(fs.readFileSync(photoPath(META_FILE), 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

export function writeMeta(meta) {
  fs.mkdirSync(paths.photos, { recursive: true });
  writeFileAtomic(photoPath(META_FILE), JSON.stringify(meta));
}

/** Read-modify-write (synchronous, so concurrent requests cannot interleave). */
export function updateMeta(fn) {
  const m = readMeta();
  const r = fn(m);
  writeMeta(m);
  return r;
}

export const isUnit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const round4 = (v) => Math.round(v * 10000) / 10000;

// Header bytes read before giving up on finding the image size (EXIF and ICC segments can be large). A file that
// is not a known image, or is broken, stops after the first read.
const HEADER_READS = [128 * 1024, 1024 * 1024, 16 * 1024 * 1024];

/**
 * Pixel size of a JPEG / PNG / WebP file from its header (see imageInfo in server/core/imageInfo.js): reads 128 KB
 * first and more only when the header goes on past that. Returns { w, h, orientation } or null.
 */
export function imageInfo(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    for (const want of HEADER_READS) {
      const buf = Buffer.alloc(Math.min(want, size));
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const head = buf.subarray(0, n);
      const info = imageInfoOf(head);
      if (info || n >= size || n < buf.length) return info;
      const need = imageHeaderNeed(head);
      if (!need || need > HEADER_READS[HEADER_READS.length - 1]) return null;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Fresh metadata for a file on disk (keeps the focal point unless `resetFocus`). */
function describe(file, prev = {}, { resetFocus = false } = {}) {
  const st = fs.statSync(photoPath(file));
  const info = imageInfo(photoPath(file));
  const out = { ...(info ? { w: info.w, h: info.h } : {}), bytes: st.size, uploadedAt: prev.uploadedAt || st.mtime.toISOString() };
  if (!resetFocus && isUnit(prev.focusX) && isUnit(prev.focusY)) Object.assign(out, { focusX: prev.focusX, focusY: prev.focusY });
  if (prev.hidden === true) out.hidden = true; // excluded from the rotation (survives replace / re-describe)
  return out;
}

function entry(file, st, m = {}) {
  const v = Math.round(st.mtimeMs).toString(36);
  const url = `/media/photos/${encodeURIComponent(file)}?v=${v}`;
  let thumb = null;
  try { thumb = fs.statSync(thumbPath(file)); } catch { /* no thumbnail yet */ }
  return {
    file,
    url,
    thumbUrl: thumb ? `/media/thumbs/${encodeURIComponent(file)}?v=${Math.round(thumb.mtimeMs).toString(36)}` : url,
    hasThumb: !!thumb,
    size: st.size,
    mtime: st.mtime.toISOString(),
    ...(m.w && m.h ? { w: m.w, h: m.h } : {}),
    ...(isUnit(m.focusX) && isUnit(m.focusY) ? { focusX: m.focusX, focusY: m.focusY } : {}),
    ...(m.uploadedAt ? { uploadedAt: m.uploadedAt } : {}),
    hidden: m.hidden === true,
  };
}

/**
 * Gallery listing with metadata. Missing/stale entries (photos copied in by hand, replaced outside the admin)
 * get their size read from the header; entries of deleted files are pruned.
 */
export function listGallery() {
  let files = [];
  try { files = fs.readdirSync(paths.photos); } catch { return []; }
  const meta = readMeta();
  let dirty = false;
  const out = [];
  for (const file of files.filter(isGalleryFile)) {
    let st;
    try { st = fs.statSync(photoPath(file)); } catch { continue; }
    if (!st.isFile()) continue;
    let m = meta[file];
    if (!m || m.bytes !== st.size || !m.w) {
      m = meta[file] = describe(file, m || {}, { resetFocus: !!m && m.bytes !== st.size });
      dirty = true;
    }
    out.push(entry(file, st, m));
  }
  const known = new Set(out.map((p) => p.file));
  for (const k of Object.keys(meta)) {
    if (!known.has(k)) { delete meta[k]; dirty = true; }
  }
  try {
    for (const t of fs.readdirSync(thumbsDir())) if (!known.has(t) && !t.startsWith('.')) removeThumb(t); // orphaned thumbnails
  } catch { /* no thumbs dir yet */ }
  if (dirty) { try { writeMeta(meta); } catch (err) { console.warn('[photos] meta write failed:', err.message); } }
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/**
 * GET /media/photos/<file> after mediaAuth: an admin session reads every file; a display only a photo in the
 * rotation (not hidden) and only when a screen its credential may read shows the gallery, or has a special
 * background rule with that file, and is not private with "hide photos". Anything else gets the same 404 as a
 * missing file, so names cannot be probed.
 */
export function galleryMedia(req, res, next) {
  const notFound = () => res.status(404).set('cache-control', 'private, no-store').type('text/plain').send('not found');
  let file;
  try { file = decodeURIComponent(String(req.path || '').replace(/^\//, '')); } catch { return notFound(); }
  if (!isGalleryFile(file)) return notFound();
  const screens = mediaScreens(getConfig(), req.displayAccess);
  if (screens === null) return next();
  if (!galleryFileAllowed(screens, file) || readMeta()[file]?.hidden === true) return notFound();
  // While one of its screens is private, the browser keeps nothing: a photo a guest could see must not stay cached for
  // 30 days on a device the owner no longer controls (app.js reads this flag when it sets the cache header).
  const cfg = getConfig();
  if (screens.some((s) => screenPrivacy(cfg, s).active)) res.locals.mediaNoStore = true;
  next();
}

/** GET /media/thumbs/<file>: the admin's gallery grid only (an admin session). */
export function thumbMedia(req, res, next) {
  if (req.displayAccess?.via === 'session') return next();
  res.status(404).set('cache-control', 'private, no-store').type('text/plain').send('not found');
}

export function getPhoto(file) {
  return isGalleryFile(file) ? listGallery().find((p) => p.file === file) || null : null;
}

export const PHOTO_ORDERS = ['random', 'newest', 'name'];
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
/** Per-screen memory of the last batch served (gallery, Immich): { files, last } (random: avoid repeats; sequential: cursor). */
const recent = new Map();
const RECENT_MAX = 64;
export function resetPhotoHistory() { recent.clear(); }

function sortFor(list, order) {
  if (order === 'name') list.sort((a, b) => collator.compare(a.file, b.file) || a.file.localeCompare(b.file));
  else if (order === 'newest') {
    const when = (g) => g.uploadedAt || g.mtime;
    list.sort((a, b) => when(b).localeCompare(when(a)) || collator.compare(a.file, b.file));
  }
  return list;
}

/**
 * Pick `n` items for one batch (gallery files, Immich assets). Sequential orders ('newest' / 'name') continue right
 * after `after` (what the display showed last; else where the previous batch for this rotation key ended) and wrap
 * around. 'random' shuffles, putting the items of the previous batch last and never starting with `after`.
 * `sort(list)` sorts in place for the sequential orders; `resume(sorted, ref)` = where to continue when `ref` is gone.
 */
function pickFrom(all, order, n, key, after, { idOf, sort, isHidden = () => false, resume = null }) {
  const list = all.filter((g) => !isHidden(g));
  if (!list.length || n <= 0) return [];
  const prev = recent.get(key);
  let out;
  if (order === 'newest' || order === 'name') {
    // Locate the reference in the full sorted list (it may have just been hidden), then take the next items in
    // rotation from there.
    const full = sort(all.slice());
    const ref = after || prev?.last;
    let start = 0;
    if (ref) {
      const i = full.findIndex((g) => idOf(g) === ref);
      if (i >= 0) start = i + 1;
      else if (resume) {
        const j = resume(full, ref);
        start = j < 0 ? 0 : j;
      }
    }
    const seq = [...full.slice(start), ...full.slice(0, start)].filter((g) => !isHidden(g));
    out = seq.slice(0, n);
  } else {
    const seen = new Set(prev?.files || []);
    const fresh = shuffle(list.filter((g) => !seen.has(idOf(g))));
    const stale = shuffle(list.filter((g) => seen.has(idOf(g))));
    out = [...fresh, ...stale].slice(0, n);
    const avoid = after || prev?.last;
    if (out.length > 1 && idOf(out[0]) === avoid) [out[0], out[1]] = [out[1], out[0]];
  }
  recent.delete(key);
  recent.set(key, { files: out.map(idOf), last: idOf(out[out.length - 1]) });
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value);
  return out;
}

function pickGallery(order, n, key, after, only = null) {
  const all = only ? listGallery().filter((g) => only.has(g.file)) : listGallery();
  const picked = pickFrom(all, order, n, key, after, {
    idOf: (g) => g.file,
    sort: (l) => sortFor(l, order),
    isHidden: (g) => g.hidden,
    // a file deleted meanwhile: continue with the next name after it
    resume: order === 'name' ? (full, ref) => full.findIndex((g) => collator.compare(g.file, ref) > 0) : null,
  });
  return picked.map((g) => ({
    url: g.url,
    file: g.file,
    title: g.file.replace(/\.[^.]+$/, ''),
    source: 'gallery',
    ...(g.focusX !== undefined ? { focusX: g.focusX, focusY: g.focusY } : {}),
  }));
}

/** Immich items in rotation order: newest = date taken, name = original file name (never shown). */
function sortImmich(list, order) {
  if (order === 'name') list.sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
  else if (order === 'newest') list.sort((a, b) => b.t.localeCompare(a.t) || a.id.localeCompare(b.id));
  return list;
}

/** Photo sent to the display for an Immich asset: the server proxies the image, captions get date and place. */
const immichPhoto = (it) => ({
  url: `/media/immich/${it.id}?v=${it.v}`,
  source: 'immich',
  id: it.id,
  ...(it.t ? { takenAt: it.t.slice(0, 10) } : {}),
  ...(placeOf(it) ? { place: placeOf(it) } : {}),
});

async function pickImmich(bg, order, n, key, after, sel = bg.immich) {
  const items = await immichItems(sel);
  const picked = pickFrom(items, order, n, `${key}|immich`, after, { idOf: (it) => it.id, sort: (l) => sortImmich(l, order) });
  warm(picked);
  return picked.map(immichPhoto);
}

/**
 * The photos of a special background rule (core/bgRules.js) in the screen's order: its gallery files that still
 * exist and are not hidden, or its Immich album. [] when there is nothing to show (the normal background then).
 */
async function rulePhotos(rule, bg, order, n, key, after) {
  const k = `${key}|rule|${rule.id}`;
  if (rule.photos?.source === 'immich') {
    if (!IMMICH_ID_RE.test(rule.photos.albumId || '')) return [];
    return pickImmich(bg, order, n, k, IMMICH_ID_RE.test(after) ? after.toLowerCase() : '', { albumIds: [rule.photos.albumId], favoritesOnly: false });
  }
  const files = new Set(rule.photos?.files || []);
  return files.size ? pickGallery(order, n, k, isGalleryFile(after) ? after : '', files) : [];
}

/**
 * One batch for the display. `opts.key` identifies the screen (rotation memory), `opts.after` = gallery file or
 * Immich asset id the display showed last, `opts.rule` = the special background rule that holds now (its photos
 * replace the source's; when it has none to show, the source as usual). Hidden photos never appear; a gallery with
 * nothing in rotation, or an Immich source with no photos (not set up, no albums, unreachable with nothing cached),
 * falls back to stock.
 */
export async function getPhotos(count = 20, bg = defaultScreen(getConfig()).background, { key = '', after = '', rule = null } = {}) {
  count = Math.max(1, Math.min(100, count | 0 || 20));
  const order = PHOTO_ORDERS.includes(bg.order) ? bg.order : 'random';
  key = String(key || 'default');
  if (rule) {
    const p = await rulePhotos(rule, bg, order, count, key, String(after || ''));
    if (p.length) return p;
  }
  if (bg.source === 'immich') {
    const p = await pickImmich(bg, order, count, key, IMMICH_ID_RE.test(after) ? after.toLowerCase() : '');
    return p.length ? p : stockPhotos(count);
  }
  if (!isGalleryFile(after)) after = '';
  if (bg.source === 'gallery') {
    const g = pickGallery(order, count, key, after);
    return g.length ? g : stockPhotos(count); // fall back to stock when nothing is in rotation
  }
  if (bg.source === 'mixed') {
    const g = pickGallery(order, Math.ceil(count / 2), key, after);
    const s = await stockPhotos(count - g.length);
    // interleave, keeping the gallery part in its order
    const out = [];
    for (let i = 0; i < Math.max(g.length, s.length); i++) {
      if (g[i]) out.push(g[i]);
      if (s[i]) out.push(s[i]);
    }
    return out;
  }
  return stockPhotos(count);
}

export function deletePhoto(file) {
  if (!isGalleryFile(file)) return false;
  const p = photoPath(file);
  if (path.dirname(p) !== paths.photos || !fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  removeThumb(file);
  try { updateMeta((m) => void delete m[file]); } catch { /* listing prunes it later */ }
  return true;
}

/** Set the focal point (0..1 of width/height). Returns the updated listing entry, or null if the photo is unknown. */
export function setFocus(file, focusX, focusY) {
  if (!isGalleryFile(file) || !exists(file)) return null;
  updateMeta((m) => {
    m[file] = { ...describe(file, m[file] || {}), focusX: round4(focusX), focusY: round4(focusY) };
  });
  return getPhoto(file);
}

/**
 * Include (`hidden` false) or exclude photos from the rotation. Returns { updated: [...files], missing: [...files] }.
 */
export function setHidden(files, hidden) {
  const updated = [], missing = [];
  updateMeta((m) => {
    for (const file of new Set(files)) {
      if (!isGalleryFile(file) || !exists(file)) { missing.push(file); continue; }
      const next = describe(file, m[file] || {});
      if (hidden) next.hidden = true;
      else delete next.hidden;
      m[file] = next;
      updated.push(file);
    }
  });
  return { updated, missing };
}

/** For POST /photos/check: what each name becomes and whether it is taken. */
export function checkNames(names) {
  return names.map((name) => {
    const sanitized = uploadName(name);
    const taken = exists(sanitized);
    return { name, sanitized, exists: taken, ...(taken ? { renamed: freeName(sanitized) } : {}) };
  });
}

/**
 * Move an uploaded temp file into the gallery under `requested` according to the conflict policy:
 * replace (overwrite, metadata refreshed), rename (first free "name-N.ext"), skip (discard). Never overwrites
 * unless asked. `focus` = optional client-computed focal point.
 */
export function finalizeUpload(tmpPath, requested, policy = 'rename', focus = null, meta = readMeta(), thumbTmp = null) {
  let target = requested;
  let status = 'created';
  if (exists(requested)) {
    if (policy === 'skip') {
      fs.rmSync(tmpPath, { force: true });
      if (thumbTmp) fs.rmSync(thumbTmp, { force: true });
      return { status: 'skipped', requested, file: requested };
    }
    if (policy === 'replace') status = 'replaced';
    else { target = freeName(requested); status = 'renamed'; }
  }
  fs.renameSync(tmpPath, photoPath(target));
  // The thumbnail always follows the photo: a new one replaces it, otherwise a stale one is dropped.
  if (thumbTmp && validThumb(thumbTmp)) storeThumb(target, thumbTmp);
  else {
    if (thumbTmp) fs.rmSync(thumbTmp, { force: true });
    removeThumb(target);
  }
  const m = describe(target, status === 'replaced' && meta[target]?.hidden ? { hidden: true } : {}, { resetFocus: true });
  m.uploadedAt = new Date().toISOString();
  if (focus && isUnit(focus.focusX) && isUnit(focus.focusY)) Object.assign(m, { focusX: round4(focus.focusX), focusY: round4(focus.focusY) });
  meta[target] = m;
  const st = fs.statSync(photoPath(target));
  return { status, requested, ...entry(target, st, m) };
}

const CLEANED_MARKER = '.metadata-cleaned';

/**
 * Once per install: strip the metadata of gallery photos stored before uploads were cleaned on the server. The
 * modification time is kept (the gallery order and the photo URLs stay the same) and so is the focal point.
 * Returns how many files were rewritten.
 */
export function cleanStoredPhotos() {
  const marker = photoPath(CLEANED_MARKER);
  if (fs.existsSync(marker)) return 0;
  let files = [];
  try { files = fs.readdirSync(paths.photos).filter(isGalleryFile); } catch { return 0; }
  let n = 0;
  for (const file of files) {
    try {
      const p = photoPath(file);
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      const buf = fs.readFileSync(p);
      const out = cleanImage(buf);
      if (!out || out.equals(buf)) continue;
      writeFileAtomic(p, out);
      fs.utimesSync(p, st.atime, st.mtime);
      updateMeta((m) => { if (m[file]) m[file].bytes = out.length; });
      n++;
    } catch (err) {
      console.warn('[photos] could not clean', file, err.message);
    }
  }
  try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* tried again on the next start */ }
  return n;
}

/** Remove abandoned temp uploads (aborted requests) older than an hour. */
export function cleanupTempUploads(maxAgeMs = 3600_000) {
  let files = [];
  try { files = fs.readdirSync(paths.photos); } catch { return; }
  for (const f of files) {
    if (!f.startsWith(TMP_PREFIX)) continue;
    try {
      const p = photoPath(f);
      if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) fs.rmSync(p, { force: true });
    } catch { /* ignore */ }
  }
}

/**
 * multer middleware: field "photos[]" or "photos", jpg/png/webp, ≤ 100 MB each. Files land under a hidden temp
 * name and are moved into place by finalizeUpload() (so a half-written upload is never served or listed).
 * With req.conflictPolicy === 'skip', files whose name is taken are not even stored (req.skippedPhotos).
 * Optional thumbnails (field "thumbs[]" / "thumb", JPEG ≤ 2 MB) pair with photos by order: file.seq.
 */
export function uploadMiddleware({ maxBytes = MAX_UPLOAD_BYTES } = {}) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(paths.photos, { recursive: true });
      cb(null, paths.photos);
    },
    filename: (req, file, cb) => cb(null, `${TMP_PREFIX}${crypto.randomBytes(8).toString('hex')}.tmp`),
  });
  return multer({
    storage,
    limits: { fileSize: maxBytes, files: 50 },
    fileFilter: (req, file, cb) => {
      if (THUMB_FIELDS.has(file.fieldname)) {
        file.seq = req.thumbSeq = (req.thumbSeq ?? -1) + 1;
        if (file.mimetype !== 'image/jpeg') return cb(Object.assign(new Error('Thumbnails must be JPEG'), { status: 415 }));
        return cb(null, true);
      }
      const okField = PHOTO_FIELDS.has(file.fieldname);
      const ext = path.extname(fixLatin1(file.originalname || '')).toLowerCase();
      if (!okField) return cb(Object.assign(new Error(`Unexpected field ${file.fieldname}`), { status: 400 }));
      file.seq = req.photoSeq = (req.photoSeq ?? -1) + 1;
      if (!ALLOWED_MIME.has(file.mimetype) || (ext && !ALLOWED_EXT.has(ext))) {
        return cb(Object.assign(new Error(`Unsupported file type: ${fixLatin1(file.originalname)} (only JPG, PNG or WebP)`), { status: 415 }));
      }
      file.targetName = uploadName(file.originalname, file.mimetype, { multipart: true });
      if (req.conflictPolicy === 'skip' && exists(file.targetName)) {
        (req.skippedPhotos ||= []).push({ seq: file.seq, file: file.targetName });
        return cb(null, false);
      }
      cb(null, true);
    },
  }).any();
}

/** multer middleware for PUT /photos/:file/thumb: one JPEG in field "thumb", ≤ 2 MB, kept in memory. */
export function thumbMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_THUMB_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
      if (file.fieldname !== 'thumb') return cb(Object.assign(new Error(`Unexpected field ${file.fieldname}`), { status: 400 }));
      if (file.mimetype !== 'image/jpeg') return cb(Object.assign(new Error('Thumbnails must be JPEG'), { status: 415 }));
      cb(null, true);
    },
  }).single('thumb');
}
