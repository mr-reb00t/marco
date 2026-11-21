// In-browser photo pipeline for the gallery: decode (EXIF orientation applied, HEIC via a lazily loaded decoder),
// downscale to ≤ 2560 px, re-encode as JPEG, make a small thumbnail and find a focal point (saliency, saliency.ts).
// Everything runs one photo at a time and frees its bitmaps/canvases, so 30 phone photos don't exhaust memory.
import { saliencyFocus } from './saliency';
import { DATE_HEADER_BYTES, jpegDateTaken } from '../../server/core/photoDate.js';

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const TARGET_SIDE = 2560;
export const THUMB_SIDE = 480;
const QUALITY = 0.86;
const THUMB_QUALITY = 0.8;
/** Already-small JPEGs heavier than this are still re-encoded (they slow the Pi down for nothing). */
const HEAVY_BYTES = 1.6 * 1024 * 1024;

export type PhotoErrorCode = 'too-big' | 'not-image' | 'heic' | 'decode';
export class PhotoError extends Error {
  code: PhotoErrorCode;
  constructor(code: PhotoErrorCode, message: string = code) {
    super(message);
    this.code = code;
  }
}

export const isHeic = (f: { name: string; type: string }) => /\.(heic|heif)$/i.test(f.name) || /^image\/hei[cf]/i.test(f.type);
const IMAGE_EXT = /\.(jpe?g|jfif|png|webp|heic|heif|avif|gif|bmp|tiff?|jxl|ico)$/i;
/** Worth trying to decode (phones sometimes send an empty MIME type for HEIC). */
export const looksLikeImage = (f: File) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);
/** Name after conversion: same stem, ".jpg". */
export const jpgName = (name: string) => `${name.replace(/\.[^./\\]*$/, '') || 'foto'}.jpg`;
export const isJpegName = (name: string) => /\.jpe?g$/i.test(name);

type Drawable = ImageBitmap | HTMLImageElement;
const dims = (d: Drawable) => ('naturalWidth' in d ? { w: d.naturalWidth, h: d.naturalHeight } : { w: d.width, h: d.height });
const release = (d: Drawable | null) => {
  if (d && 'close' in d) d.close();
};

async function decodeNative(blob: Blob): Promise<Drawable> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (e) {
      // older engines reject the option value itself; the default also honours EXIF orientation there
      if (e instanceof TypeError) {
        try {
          return await createImageBitmap(blob);
        } catch {
          /* fall through to <img> */
        }
      }
    }
  }
  // <img> applies EXIF orientation (image-orientation: from-image is the default) and decodes GIF/BMP/AVIF too.
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    if (!img.naturalWidth) throw new Error('empty image');
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decode any image the browser (or the HEIC decoder) understands, upright. */
export async function decodeImage(file: Blob & { name?: string }, onStage?: (s: 'heic') => void): Promise<Drawable> {
  const heic = isHeic({ name: file.name || '', type: file.type });
  try {
    return await decodeNative(file);
  } catch (err) {
    if (!heic) throw new PhotoError('decode', (err as Error)?.message || 'decode');
  }
  // Chrome/Firefox can't decode HEIC: libheif (WASM-free JS build, ~3 MB) only loads when a HEIC shows up.
  onStage?.('heic');
  try {
    const { heicTo } = await import('heic-to/csp');
    return await heicTo({ blob: file, type: 'bitmap' });
  } catch (err) {
    throw new PhotoError('heic', (err as Error)?.message || 'heic');
  }
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const free = (...cs: HTMLCanvasElement[]) => cs.forEach((c) => ((c.width = 0), (c.height = 0)));

/** Draw scaled with good filtering: halve with the GPU until within 2× of the target, then one last step. */
function scaleTo(src: CanvasImageSource, sw: number, sh: number, w: number, h: number): HTMLCanvasElement {
  let cur: CanvasImageSource = src;
  let cw = sw, ch = sh;
  const tmp: HTMLCanvasElement[] = [];
  while (cw / 2 >= w * 1.0001 && ch / 2 >= h) {
    const c = canvas(cw / 2, ch / 2);
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, c.width, c.height);
    tmp.push(c);
    cur = c;
    cw = c.width;
    ch = c.height;
  }
  const out = canvas(w, h);
  const g = out.getContext('2d')!;
  g.fillStyle = '#000'; // transparent PNGs become JPEGs: give them a dark background (they sit on a dark screen)
  g.fillRect(0, 0, out.width, out.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, out.width, out.height);
  free(...tmp);
  return out;
}

const toJpeg = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new PhotoError('decode', 'encode failed'))), 'image/jpeg', q));

/** Focal point (0..1) of an image, from a small copy of it. */
export async function findFocus(src: CanvasImageSource, w: number, h: number): Promise<{ focusX: number; focusY: number }> {
  const s = Math.min(1, 256 / Math.max(w, h));
  const small = s < 1 ? scaleTo(src, w, h, w * s, h * s) : null;
  try {
    return saliencyFocus(small ?? src);
  } finally {
    if (small) free(small);
  }
}

/** Focus for an already-decoded image (editor's "Automático"). */
export async function autoFocus(img: HTMLImageElement): Promise<{ focusX: number; focusY: number }> {
  return findFocus(img, img.naturalWidth, img.naturalHeight);
}

/** EXIF orientation of a JPEG (1 when absent / not a JPEG). Reads only the first 128 KB. */
export async function jpegOrientation(file: Blob): Promise<number> {
  try {
    const b = new DataView(await file.slice(0, 128 * 1024).arrayBuffer());
    if (b.getUint16(0) !== 0xffd8) return 1;
    let p = 2;
    while (p + 4 < b.byteLength) {
      if (b.getUint8(p) !== 0xff) return 1;
      const m = b.getUint8(p + 1);
      const len = b.getUint16(p + 2);
      if (m === 0xe1 && b.getUint32(p + 4) === 0x45786966) {
        const t = p + 10;
        const le = b.getUint16(t) === 0x4949;
        const ifd = t + b.getUint32(t + 4, le);
        const n = b.getUint16(ifd, le);
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (b.getUint16(e, le) === 0x0112) return b.getUint16(e + 8, le) || 1;
        }
        return 1;
      }
      if (m === 0xda) return 1;
      p += 2 + len;
    }
  } catch {
    /* truncated / odd file */
  }
  return 1;
}

/** Day a photo was taken (YYYY-MM-DD) from its EXIF, read before optimizing drops it (#49), or ''. */
export async function photoDateTaken(file: Blob): Promise<string> {
  try {
    return jpegDateTaken(new Uint8Array(await file.slice(0, DATE_HEADER_BYTES).arrayBuffer()));
  } catch {
    return '';
  }
}

export interface Optimized {
  /** what gets uploaded */
  blob: Blob;
  thumb: Blob;
  name: string;
  w: number;
  h: number;
  focusX: number;
  focusY: number;
  before: number;
  after: number;
  /** the original bytes were already fine and are uploaded as they are */
  kept: boolean;
}

/**
 * Full pipeline for one file. `keepFocus` skips the saliency pass (photo already framed by hand). `strip` always
 * re-encodes (a canvas keeps no metadata), for servers that must never store the original bytes.
 * Throws PhotoError('heic' | 'decode' | 'too-big' | 'not-image').
 */
export async function optimizePhoto(
  file: File,
  opts: {
    onStage?: (s: 'heic' | 'optimizing') => void;
    keepFocus?: { focusX: number; focusY: number };
    /** always re-encode, never keep the original bytes: drops EXIF (GPS, camera) and every other metadata */
    strip?: boolean;
  } = {}
): Promise<Optimized> {
  if (file.size > MAX_UPLOAD_BYTES) throw new PhotoError('too-big');
  if (!looksLikeImage(file)) throw new PhotoError('not-image');
  opts.onStage?.('optimizing');
  let img: Drawable | null = null;
  let full: HTMLCanvasElement | null = null;
  let th: HTMLCanvasElement | null = null;
  try {
    img = await decodeImage(file, (s) => opts.onStage?.(s));
    opts.onStage?.('optimizing');
    const { w: iw, h: ih } = dims(img);
    if (!iw || !ih) throw new PhotoError('decode');
    const s = Math.min(1, TARGET_SIDE / Math.max(iw, ih)); // never upscale
    const w = Math.round(iw * s), h = Math.round(ih * s);
    full = scaleTo(img, iw, ih, w, h);
    release(img);
    img = null;
    const ts = Math.min(1, THUMB_SIDE / Math.max(w, h));
    th = scaleTo(full, w, h, w * ts, h * ts);
    const [encoded, thumb, focus] = await Promise.all([
      toJpeg(full, QUALITY),
      toJpeg(th, THUMB_QUALITY),
      opts.keepFocus ? Promise.resolve(opts.keepFocus) : findFocus(th, th.width, th.height),
    ]);
    // An already web-sized, upright, light JPEG is kept byte-for-byte (no generation loss).
    const keep =
      !opts.strip &&
      file.type === 'image/jpeg' && s === 1 && file.size <= Math.max(encoded.size, HEAVY_BYTES) && (await jpegOrientation(file)) === 1;
    const blob = keep ? file : encoded;
    return { blob, thumb, name: jpgName(file.name), w, h, ...focus, before: file.size, after: blob.size, kept: keep };
  } finally {
    release(img);
    if (full) free(full);
    if (th) free(th);
  }
}
