// The day a photo was taken, for the background caption (#49): from the EXIF of a JPEG (DateTimeOriginal, else
// DateTimeDigitized, else DateTime) or from a camera-style file name (IMG_20190812_…, PXL_…, 2019-08-12 …). Gallery
// photos are stored without their metadata, so the day is read before that and kept apart (server/photos.js, the
// admin's upload and Marco Cloud). Only the day: never the time, the camera or the place. Pure, never throws.

const isBytes = (b) => b instanceof Uint8Array;
const u16be = (b, o) => (o >= 0 && o + 2 <= b.length ? (b[o] << 8) | b[o + 1] : -1);

/** Bytes of a JPEG read for its date: the EXIF block sits in the first segments (at most 64 KB each). */
export const DATE_HEADER_BYTES = 256 * 1024;

/** 'YYYY-MM-DD' when y-m-d is a real day between 1900 and 2100, else ''. */
function day(y, m, d) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return '';
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** A day sent by a client or kept on disk: 'YYYY-MM-DD' when valid, else ''. */
export function validPhotoDay(v) {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  return m ? day(+m[1], +m[2], +m[3]) : '';
}

/** The day of an EXIF date ("YYYY:MM:DD HH:MM:SS"; cameras with no clock write zeros or spaces), or ''. */
function exifDay(s) {
  const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})/.exec(s);
  return m ? day(+m[1], +m[2], +m[3]) : '';
}

/** Day taken from an APP1 segment body ("Exif\0\0" + TIFF), or ''. */
export function exifDateTaken(seg) {
  if (!isBytes(seg) || seg.length < 14 || String.fromCharCode(seg[0], seg[1], seg[2], seg[3]) !== 'Exif') return '';
  const t = 6;
  const le = seg[t] === 0x49 && seg[t + 1] === 0x49;
  if (!le && !(seg[t] === 0x4d && seg[t + 1] === 0x4d)) return '';
  const u16 = (o) => (o >= 0 && o + 2 <= seg.length ? (le ? seg[o] | (seg[o + 1] << 8) : (seg[o] << 8) | seg[o + 1]) : -1);
  const u32 = (o) =>
    o >= 0 && o + 4 <= seg.length
      ? (le ? seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16) | (seg[o + 3] << 24) : (seg[o] << 24) | (seg[o + 1] << 16) | (seg[o + 2] << 8) | seg[o + 3]) >>> 0
      : -1;
  // The tags of one IFD: { tag: entry offset }.
  const entries = (off) => {
    const out = new Map();
    const ifd = t + off;
    const n = u16(ifd);
    if (off <= 0 || n < 0 || n > 512) return out;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e);
      if (tag < 0) break; // truncated
      out.set(tag, e);
    }
    return out;
  };
  // An ASCII date of 20 bytes (type 2), always stored at an offset as it is longer than 4 bytes.
  const text = (e) => {
    if (e === undefined || u16(e + 2) !== 2 || u32(e + 4) < 19) return '';
    const at = t + u32(e + 8);
    if (at + 19 > seg.length) return '';
    let s = '';
    for (let i = at; i < at + 19; i++) s += String.fromCharCode(seg[i]);
    return exifDay(s);
  };
  const ifd0 = entries(u32(t + 4));
  const exifPtr = ifd0.get(0x8769);
  const sub = exifPtr !== undefined && u16(exifPtr + 2) === 4 ? entries(u32(exifPtr + 8)) : new Map();
  return text(sub.get(0x9003)) || text(sub.get(0x9004)) || text(ifd0.get(0x0132));
}

/** Day taken from the EXIF of a JPEG (its first bytes are enough, DATE_HEADER_BYTES), or ''. */
export function jpegDateTaken(b) {
  if (!isBytes(b) || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return '';
  let pos = 2;
  for (let guard = 0; guard < 500 && pos + 4 <= b.length; guard++) {
    if (b[pos] !== 0xff) return '';
    const marker = b[pos + 1];
    if (marker === 0xff) { pos++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return '';
    const len = u16be(b, pos + 2);
    if (len < 2) return '';
    if (marker === 0xe1 && pos + 2 + len <= b.length) {
      const d = exifDateTaken(b.subarray(pos + 4, pos + 2 + len));
      if (d) return d;
    }
    pos += 2 + len;
  }
  return '';
}

/**
 * Day taken from a camera-style file name, or '': IMG_20190812_183012, PXL_20190812…, IMG-20190812-WA0001,
 * 20190812_183012, Screenshot_2019-08-12…, "2019-08-12 18.30.12". The digits must not run on into more digits.
 */
export function fileNameDate(name) {
  const base = String(name || '').replace(/^.*[\\/]/, '');
  const m = /(?:^|[^0-9])((?:19|20)\d{2})([-_.]?)(\d{2})\2(\d{2})(?![0-9])/.exec(base);
  return m ? day(+m[1], +m[3], +m[4]) : '';
}

// Words cameras, phones and apps put in the names they give photos (IMG_, PXL_, DSC, Screenshot_, WhatsApp's -WA…).
const CAMERA_WORDS = new Set(
  ('img image imag pxl dsc dscn dscf dji gopr gp vid mvimg pict pic photo foto sam cimg burst portrait cover hdr pano ' +
    'mp lrg wa whatsapp signal telegram mmexport fb received screenshot screen shot captura de pantalla at am pm ' +
    'edited edit copy original').split(' ')
);

/**
 * The title a gallery photo shows in the caption: its file name without the extension, or '' for a name a camera or
 * phone gave it (IMG_20190812_183012, PXL_…, DSC01234, Screenshot_…): only digits and those words, nothing a person
 * wrote. A day in such a name is shown by *Show the date the photo was taken* instead.
 */
export function photoTitle(file) {
  const base = String(file || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  let digits = 0;
  for (const piece of base.toLowerCase().match(/\p{L}+|\p{N}+/gu) || []) {
    if (/^\p{N}+$/u.test(piece)) digits += piece.length;
    else if (!CAMERA_WORDS.has(piece)) return base;
  }
  return digits >= 4 ? '' : base;
}
