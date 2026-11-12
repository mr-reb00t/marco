// Special backgrounds with a pace of their own (#45): while a rule that changes its photos every hour holds, the screen
// whose Fondo changes every 10 s keeps the rule's photo, and so does a Personalizado photo card on the screen's
// photos; once the rule follows the screen again, the photos change at the screen's pace. The real app on a random port
// behind the Vite dev server, in headless Chrome (skipped without a browser).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle } from '../core/canvasCore.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPoll, publish } from '../pollHub.js';
import { _resetDisplayAccess, syncDisplayKeys } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { _resetPhotoRules } from '../photoRules.js';
import { findChrome, launchChrome, startWeb } from './browser.js';
import { makePng } from './photoBytes.js';

const realFetch = globalThis.fetch;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FILES = ['r1.png', 'r2.png', 'r3.png'];
const HOURLY = { id: 'r_year', when: { type: 'range', from: '01-01', to: '12-31' }, photos: { source: 'gallery', files: FILES }, intervalSec: 3600 };

const chrome = findChrome();
describe('a special background with its own pace on a running display', { skip: !chrome && 'no Chrome' }, () => {
  let dir, server, web, browser;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-bgrule-pace-'));
    globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
    const c = defaultConfig();
    c.calendar.sources = [];
    c.news.feeds = [];
    c.security.displayAccess = 'open';
    Object.assign(c.screens[0].background, { source: 'stock', transition: 'fade', intervalSec: 10, rules: [HOURLY] });
    // a Personalizado screen with a photo card on the screen's photos, every 10 s
    const s = defaultScreenProfile({ id: 's_cv', slug: 'canvas', name: 'Canvas' });
    Object.assign(s.background, { source: 'stock', intervalSec: 10, rules: [HOURLY] });
    s.layout.preset = 'canvas';
    s.canvas = {
      ...defaultCanvas(), background: 'ambient',
      items: [{ id: 'cv_photo001', kind: 'photo', pos: { zone: 'main', x: 0, y: 0, size: 'm', w: 6, h: 6 }, style: defaultItemStyle(), props: { ...canvasDefaults('photo'), intervalSec: 10 } }],
    };
    c.screens.push(s);
    const v = validateConfig(c);
    assert.deepEqual(v.errors, []);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(v.value));
    fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    for (const f of FILES) fs.writeFileSync(path.join(dir, 'photos', f), makePng(64, 40));
    store.initStore(dir);
    _resetDisplays();
    _resetPoll();
    _resetDisplayAccess();
    _resetPrivacy();
    _resetPhotoRules();
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
    _resetPhotoRules();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  // the rule photo on screen (the Fondo's newest layer, or the card's) and the pace the display was told
  const STATE = (sel) => `import('/display/store.ts').then(({ state }) => {
    const nodes = [...document.querySelectorAll('${sel}')];
    const m = /(r\\d)\\.png/.exec(nodes.length ? nodes[nodes.length - 1].style.backgroundImage : '');
    return { every: state.photos?.intervalSec ?? null, shown: m ? m[1] : '' };
  })`;
  const until = async (p, sel, ok, ms = 15000) => {
    const end = Date.now() + ms;
    let s;
    while (Date.now() < end) {
      s = await p.eval(STATE(sel));
      if (ok(s)) return s;
      await wait(250);
    }
    return s;
  };
  // the rule follows the screen's pace again (an admin save, which server/index.js announces to the displays)
  const backToScreenPace = (idx) => {
    const cfg = structuredClone(store.getConfig());
    delete cfg.screens[idx].background.rules[0].intervalSec;
    store.saveConfig(validateConfig(cfg).value);
    publish('config', { revision: store.getConfig().revision });
  };

  for (const [name, url, sel, idx] of [
    ['the Fondo', '?screen=living-room&lite=1', '.photo-area .ph-stack .ph', 0],
    ['a photo card on the screen\'s photos', '?screen=canvas&lite=1', '.cv-photo .cv-ph', 1],
  ]) {
    test(`${name}: an hourly rule keeps its photo past the screen's 10 s, then goes at the screen's pace`, async () => {
      const p = await browser.page(`${web.url}/${url}`);
      try {
        const first = await until(p, sel, (s) => !!s.shown);
        assert.ok(first.shown, 'a rule photo is on screen');
        assert.equal(first.every, 3600);
        await wait(13_000);
        const later = await p.eval(STATE(sel));
        assert.equal(later.shown, first.shown, 'the same photo after more than the screen interval');
        backToScreenPace(idx);
        const next = await until(p, sel, (s) => s.every === null && !!s.shown && s.shown !== first.shown, 30_000);
        assert.equal(next.every, null);
        assert.notEqual(next.shown, first.shown, 'the photo changed at the screen\'s pace');
      } finally {
        await p.close();
      }
    });
  }
});
