// A Personalizado photo card on a private link (/d/<key>) or a paired device, with the gallery as the photo source:
// its photos carry the display's credential (?k=), as the background photos do. Before, the card asked for
// /media/photos/... with nothing, got 401 and stayed black on every screen but the admin's own browser (whose session
// cookie got through). Real server, display served by Vite, headless Chrome (skipped without it).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle, newCanvasId } from '../core/canvasCore.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPoll } from '../pollHub.js';
import { _resetDisplayAccess, listDisplayLinks, syncDisplayKeys } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { findChrome, launchChrome, startWeb } from './browser.js';
import { makePng } from './photoBytes.js';

const realFetch = globalThis.fetch;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = findChrome();
describe('a photo card on a private link shows gallery photos', { skip: !chrome && 'no Chrome' }, () => {
  let dir, server, web, browser;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-photocard-'));
    globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
    const c = defaultConfig();
    c.calendar.sources = [];
    c.news.feeds = [];
    c.security.displayAccess = 'private';
    const s = c.screens[0];
    Object.assign(s.background, { source: 'gallery', intervalSec: 3600 });
    s.layout.preset = 'canvas';
    s.canvas = { ...defaultCanvas(), background: 'ambient', items: [{ id: newCanvasId(), kind: 'photo', pos: { zone: 'main', x: 0, y: 0, size: 'm' }, style: defaultItemStyle(), props: canvasDefaults('photo') }] };
    const v = validateConfig(c);
    assert.deepEqual(v.errors ?? [], []);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(v.value));
    fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'photos', 'mine.png'), makePng(64, 40));
    store.initStore(dir);
    _resetDisplays();
    _resetPoll();
    _resetDisplayAccess();
    _resetPrivacy();
    setServerVersion('test');
    await ensurePassword();
    syncDisplayKeys();
    const app = createApp({ version: 'test', dist: path.join(dir, 'no-dist') });
    server = await new Promise((resolve) => { const s2 = app.listen(0, '127.0.0.1', () => resolve(s2)); });
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

  test('the card asks for the photo with the link key, and the server serves it (no admin session)', async () => {
    const key = listDisplayLinks()[0].key;
    const p = await browser.page(`${web.url}/d/${key}?lite=1`);
    try {
      let url = '';
      for (let i = 0; i < 60 && !url; i++) {
        url = await p.eval(`(() => { const n = document.querySelector('.cv-item[data-kind="photo"] [style*="background-image"], .cv-item[data-kind="photo"] img'); return n ? (n.currentSrc || n.src || (n.style.backgroundImage.match(/url\\("?([^")]+)/) || [])[1] || '') : ''; })()`);
        if (!url) await wait(250);
      }
      assert.match(url, /\/media\/photos\/mine\.png/, 'the card shows the gallery photo');
      assert.match(url, /[?&]k=/, 'with the display credential');
      // fetched the way an <img> is, with no cookie: 200, not 401
      const status = await p.eval(`fetch(${JSON.stringify(url)}, { credentials: 'omit' }).then((r) => r.status)`);
      assert.equal(status, 200);
    } finally {
      await p.close();
    }
  });
});
