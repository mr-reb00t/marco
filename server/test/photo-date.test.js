// The day a photo was taken in the background caption (#49): read from the EXIF before the gallery strips it, sent
// by the admin for photos it re-encodes, or taken from a camera-style file name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { sessionMiddleware, csrfGuard, ensurePassword, loginHandler, hashPassword } from '../auth.js';
import { adminRouter } from '../routes/admin.js';
import { publicRouter } from '../routes/public.js';
import { readMeta, writeMeta, listGallery } from '../photos.js';
import { exifDateTaken, fileNameDate, jpegDateTaken, validPhotoDay } from '../core/photoDate.js';
import { loadWebModules } from './webModules.js';

/** TIFF block with IFD0 { DateTime?, ExifIFD pointer? } and an Exif IFD { DateTimeOriginal?, DateTimeDigitized? }. */
function exifTiff({ le = false, original = '', digitized = '', dateTime = '' } = {}) {
  const sub = [[0x9003, original], [0x9004, digitized]].filter(([, v]) => v);
  const top = [[0x0132, dateTime]].filter(([, v]) => v);
  const ifd0Len = 2 + (top.length + (sub.length ? 1 : 0)) * 12 + 4;
  const subAt = 8 + ifd0Len;
  const subLen = sub.length ? 2 + sub.length * 12 + 4 : 0;
  let strAt = subAt + subLen;
  const b = Buffer.alloc(strAt + (top.length + sub.length) * 20);
  const w16 = (v, o) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (v, o) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  b.write(le ? 'II' : 'MM', 0, 'latin1');
  w16(42, 2);
  w32(8, 4);
  const ascii = (e, tag, v) => {
    w16(tag, e); w16(2, e + 2); w32(20, e + 4); w32(strAt, e + 8);
    b.write(v, strAt, 'latin1');
    strAt += 20;
  };
  w16(top.length + (sub.length ? 1 : 0), 8);
  let e = 10;
  for (const [tag, v] of top) { ascii(e, tag, v); e += 12; }
  if (sub.length) { w16(0x8769, e); w16(4, e + 2); w32(1, e + 4); w32(subAt, e + 8); }
  if (sub.length) {
    w16(sub.length, subAt);
    sub.forEach(([tag, v], i) => ascii(subAt + 2 + i * 12, tag, v));
  }
  return b;
}
const app1 = (tiff) => {
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const hdr = Buffer.from([0xff, 0xe1, 0, 0]);
  hdr.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([hdr, body]);
};
/** Minimal JPEG (SOI, APP0, optional EXIF, SOF0, EOI). */
function jpeg(w, h, exif = null) {
  const app0 = Buffer.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, ...(exif ? [app1(exifTiff(exif))] : []), sof, Buffer.from([0xff, 0xd9])]);
}

test('EXIF: DateTimeOriginal first, then DateTimeDigitized, then DateTime; both byte orders; bad dates ignored', () => {
  const day = (o) => jpegDateTaken(jpeg(10, 10, o));
  assert.equal(day({ original: '2019:08:12 18:30:12', digitized: '2020:01:01 00:00:00', dateTime: '2021:01:01 00:00:00' }), '2019-08-12');
  assert.equal(day({ le: true, original: '2019:08:12 18:30:12' }), '2019-08-12');
  assert.equal(day({ digitized: '2018:02:03 10:00:00', dateTime: '2021:01:01 00:00:00' }), '2018-02-03');
  assert.equal(day({ le: true, dateTime: '2021:12:31 23:59:59' }), '2021-12-31');
  assert.equal(day({ original: '0000:00:00 00:00:00', dateTime: '2017:05:06 07:08:09' }), '2017-05-06', 'a camera with no clock');
  assert.equal(day({ original: '    :  :     :  :  ' }), '');
  assert.equal(day({ original: '2019:02:30 10:00:00' }), '', 'no such day');
  assert.equal(day(), '');
  assert.equal(jpegDateTaken(Buffer.from('not a jpeg')), '');
  assert.equal(exifDateTaken(new Uint8Array(3)), '');
  // cut off anywhere: never throws, never reads past the end
  const full = jpeg(10, 10, { original: '2019:08:12 18:30:12' });
  for (let n = 0; n < full.length; n++) assert.equal(typeof jpegDateTaken(full.subarray(0, n)), 'string');
  const tiff = app1(exifTiff({ original: '2019:08:12 18:30:12' })).subarray(4);
  for (let i = 6; i < tiff.length; i++) {
    const bad = Buffer.from(tiff);
    bad[i] = 0xff;
    assert.equal(typeof exifDateTaken(bad), 'string');
  }
});

test('file names: camera and phone patterns, nothing from other digits', () => {
  assert.equal(fileNameDate('IMG_20190812_183012.jpg'), '2019-08-12');
  assert.equal(fileNameDate('PXL_20231224_101010123.MP.jpg'), '2023-12-24');
  assert.equal(fileNameDate('IMG-20190812-WA0001.jpg'), '2019-08-12');
  assert.equal(fileNameDate('2019-08-12 18.30.12.jpg'), '2019-08-12');
  assert.equal(fileNameDate('IMG_20190812_183012-2.jpg'), '2019-08-12');
  for (const n of ['IMG_1234.jpg', 'holiday 2019.jpg', 'x120190812.jpg', '20191312_1.jpg', '2019-08_12.jpg', 'scan-123456789.jpg']) assert.equal(fileNameDate(n), '', n);
  assert.equal(validPhotoDay('2019-08-12'), '2019-08-12');
  for (const v of ['2019-8-12', '2019-02-29', '1850-01-01', '2019-08-12T10:00', 20190812, null]) assert.equal(validPhotoDay(v), '', String(v));
});

test('caption: the date alone, after the title, Immich as before; nothing when both are off', async () => {
  const [{ photoCaption }] = await loadWebModules('/web/display/photoFit.ts');
  const by = (a) => `Photo by ${a}`;
  const gal = { source: 'gallery', title: 'Playa', takenAt: '2019-08-12' };
  assert.equal(photoCaption(gal, { showDate: true }, 'en'), 'August 12, 2019');
  assert.equal(photoCaption(gal, { showMeta: true, showDate: true }, 'es', by), 'Playa · 12 de agosto de 2019');
  assert.equal(photoCaption(gal, { showMeta: true }, 'en', by), 'Playa');
  assert.equal(photoCaption(gal, {}, 'en', by), '');
  assert.equal(photoCaption({ source: 'gallery', title: 'IMG_1' }, { showDate: true }, 'en', by), '', 'no date known');
  const im = { source: 'immich', takenAt: '2019-08-12', place: 'Valencia, Spain' };
  assert.equal(photoCaption(im, { showDate: true }, 'en', by), 'August 12, 2019');
  assert.equal(photoCaption(im, { showMeta: true }, 'en', by), 'Valencia, Spain · August 12, 2019');
  assert.equal(photoCaption({ source: 'stock', author: 'Ana' }, { showMeta: true, showDate: true }, 'en', by), 'Photo by Ana');
});

test('config: background.showDate is off by default (not written) and kept when on', () => {
  const c = defaultConfig();
  assert.equal(validateConfig(c).value.screens[0].background.showDate, undefined);
  c.screens[0].background.showDate = true;
  assert.equal(validateConfig(c).value.screens[0].background.showDate, true);
});

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-photodate-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.screens[0].background.source = 'gallery';
  c.screens[0].background.order = 'name';
  c.screens[0].background.showDate = true;
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret123'), passwordIsDefault: false }));
  store.initStore(dir);
  await ensurePassword();
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(sessionMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.use(['/api/admin', '/api/auth'], csrfGuard({ multipartPaths: ['/photos', /^\/photos\/[^/]+\/thumb$/] }));
  app.post('/api/auth/login', (req, res, next) => loginHandler(req, res).catch(next));
  app.use('/api/admin', adminRouter());
  app.use('/api', publicRouter({ version: 'test' }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const raw = async (method, url, { json, form } = {}) => {
    const r = await fetch(base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(form ? { 'x-requested-with': 'fetch' } : {}) },
      body: json !== undefined ? JSON.stringify(json) : form,
    });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((x) => x.split(';')[0]).join('; ');
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const upload = (files, { policy, meta } = {}) => {
    const fd = new FormData();
    if (meta) fd.append('meta', JSON.stringify(meta));
    for (const [name, buf] of files) fd.append('photos[]', new Blob([buf], { type: 'image/jpeg' }), name);
    return raw('POST', `/api/admin/photos${policy ? `?onConflict=${policy}` : ''}`, { form: fd });
  };
  try {
    assert.equal((await raw('POST', '/api/auth/login', { json: { password: 'secret123' } })).status, 200);
    await fn({ raw, upload, photos: path.join(dir, 'photos') });
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('upload: the day is read before the EXIF goes, else the admin sends it, else the file name; screens get it', async () => {
  await withApp(async ({ raw, upload, photos }) => {
    let r = await upload([
      ['a.jpg', jpeg(800, 600, { original: '2019:08:12 18:30:12' })],
      ['b.jpg', jpeg(800, 600)],
      ['img_20150704_120000.jpg', jpeg(800, 600)],
      ['d.jpg', jpeg(800, 600)],
      ['e.jpg', jpeg(800, 600, { original: '2011:11:11 11:11:11' })],
    ], { meta: [null, { takenAt: '2020-02-29' }, null, { takenAt: '2020-02-30' }, { takenAt: '1999-01-01' }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const by = Object.fromEntries(r.body.files.map((f) => [f.file, f.takenAt]));
    assert.deepEqual(by, { 'a.jpg': '2019-08-12', 'b.jpg': '2020-02-29', 'img_20150704_120000.jpg': '2015-07-04', 'd.jpg': undefined, 'e.jpg': '2011-11-11' });
    // the stored file keeps no date, the gallery's metadata does
    assert.equal(jpegDateTaken(fs.readFileSync(path.join(photos, 'a.jpg'))), '');
    assert.equal(readMeta()['a.jpg'].takenAt, '2019-08-12');
    assert.equal(readMeta()['d.jpg'].takenAt, '');

    // a replace with no date of its own (the admin's optimized copy) keeps the photo's day
    r = await upload([['a.jpg', jpeg(400, 300)]], { policy: 'replace' });
    assert.equal(r.body.files[0].takenAt, '2019-08-12');
    r = await upload([['a.jpg', jpeg(400, 300, { original: '2001:01:02 03:04:05' })]], { policy: 'replace' });
    assert.equal(r.body.files[0].takenAt, '2001-01-02');

    const got = await raw('GET', '/api/photos?count=10');
    const shown = Object.fromEntries(got.body.photos.map((p) => [p.file, p.takenAt]));
    assert.equal(shown['a.jpg'], '2001-01-02');
    assert.equal(shown['img_20150704_120000.jpg'], '2015-07-04');
    assert.equal(shown['d.jpg'], undefined);
  });
});

test('gallery: photos copied in by hand and ones stored before #49 get their day once', async () => {
  await withApp(async ({ upload, photos }) => {
    await upload([['old.jpg', jpeg(800, 600)]]);
    fs.writeFileSync(path.join(photos, 'IMG_20100101_000000.jpg'), jpeg(800, 600));
    fs.writeFileSync(path.join(photos, 'byhand.jpg'), jpeg(800, 600, { le: true, original: '2012:06:07 08:09:10' }));
    const m = readMeta();
    delete m['old.jpg'].takenAt; // stored by an older version
    writeMeta(m);
    const days = Object.fromEntries(listGallery().map((g) => [g.file, g.takenAt]));
    assert.deepEqual(days, { 'old.jpg': undefined, 'IMG_20100101_000000.jpg': '2010-01-01', 'byhand.jpg': '2012-06-07' });
    const after = readMeta();
    assert.equal(after['old.jpg'].takenAt, '');
    assert.equal(after['byhand.jpg'].takenAt, '2012-06-07');
  });
});
