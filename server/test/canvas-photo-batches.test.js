// A Foto card on a screen with no photo slideshow behind it (an Ambiente background): once it has shown every photo
// of the batch it asks for the next one (env.morePhotos), so it goes through the whole gallery instead of the same
// twenty photos (a gallery of 600 showed "10 to 15 photos over and over"). The real app on a random port behind the
// Vite dev server, in headless Chrome (skipped without a browser).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle } from '../core/canvasCore.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPoll } from '../pollHub.js';
import { _resetDisplayAccess, syncDisplayKeys } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { resetPhotoHistory } from '../photos.js';
import { findChrome, launchChrome, startWeb } from './browser.js';
import { makePng } from './photoBytes.js';

const realFetch = globalThis.fetch;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = findChrome();
describe('a Foto card goes through the whole gallery', { skip: !chrome && 'no Chrome' }, () => {
  let dir, server, web, browser;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-photo-batches-'));
    globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
    const c = defaultConfig();
    c.calendar.sources = [];
    c.news.feeds = [];
    c.security.displayAccess = 'open';
    const s = c.screens[0];
    Object.assign(s.background, { source: 'gallery', order: 'name', intervalSec: 3600 });
    s.layout = { ...s.layout, preset: 'canvas' };
    s.canvas = {
      ...defaultCanvas(), background: 'ambient',
      items: [{ id: 'cv_photo001', kind: 'photo', pos: { zone: 'main', x: 0, y: 0, w: 12, h: 8 }, style: defaultItemStyle(), props: { ...canvasDefaults('photo'), intervalSec: 10 } }],
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(validateConfig(c).value));
    fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    for (let i = 0; i < 45; i++) fs.writeFileSync(path.join(dir, 'photos', `p${String(i).padStart(2, '0')}.png`), makePng(32 + i, 20));
    store.initStore(dir);
    resetPhotoHistory();
    _resetDisplays();
    _resetPoll();
    _resetDisplayAccess();
    _resetPrivacy();
    setServerVersion('test');
    await ensurePassword();
    syncDisplayKeys();
    const app = createApp({ version: 'test', dist: path.join(dir, 'no-dist') });
    server = await new Promise((resolve) => { const sv = app.listen(0, '127.0.0.1', () => resolve(sv)); });
    web = await startWeb({ api: `http://127.0.0.1:${server.address().port}` });
    browser = await launchChrome(chrome);
  });
  after(async () => {
    await browser?.close();
    await web?.close();
    closeAll();
    server?.closeAllConnections?.();
    if (server) await new Promise((r) => server.close(r));
    globalThis.fetch = realFetch;
    _resetPrivacy();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('after its first twenty photos the card shows the next ones', { timeout: 120_000 }, async () => {
    const p = await browser.page(`${web.url}/?lite=1`, { width: 1280, height: 720 });
    try {
      // the card's ten seconds made a fortieth from its second change on, and every photo it shows noted
      await p.eval(`(() => {
        const st = window.setTimeout.bind(window);
        window.setTimeout = (fn, ms, ...a) => st(fn, ms >= 9000 && ms <= 11000 ? ms / 40 : ms, ...a);
        window.__shown = new Set();
        setInterval(() => {
          for (const n of document.querySelectorAll('.cv-photo .cv-ph')) {
            const m = /p(\\d+)\\.png/.exec(n.style.backgroundImage);
            if (m) window.__shown.add(m[1]);
          }
        }, 50);
      })()`);
      const end = Date.now() + 60_000;
      let n = 0;
      while (Date.now() < end) {
        n = await p.eval('window.__shown.size');
        if (n >= 30) break;
        await wait(500);
      }
      const asked = await p.eval(`performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/photos')).map((e) => e.name.split('?')[1])`);
      assert.ok(n >= 30, `only ${n} photos shown; asked: ${JSON.stringify(asked)}`);
      // the next batch continues from the photo the card showed last
      assert.ok(asked.some((q) => /after=p\d+\.png/.test(q)), JSON.stringify(asked));
    } finally {
      await p.close();
    }
  });
});
