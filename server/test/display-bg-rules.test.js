// Special backgrounds (#14) on a running display: when the rule that holds on the screen changes (here an event that
// goes away), the server's check sends a `photos` live event and the display shows a photo of the new rule at once,
// without waiting for the slideshow's interval; with no such push (Marco Cloud), new events are enough. The real app on a random port behind the Vite dev server, in
// headless Chrome (skipped without a browser).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { localDate } from '../core/lib/tz.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPoll, publish } from '../pollHub.js';
import { _resetDisplayAccess, syncDisplayKeys } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { syncPhotoRules, _resetPhotoRules } from '../photoRules.js';
import { findChrome, launchChrome, startWeb } from './browser.js';
import { makePng } from './photoBytes.js';

const realFetch = globalThis.fetch;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = findChrome();
describe('special backgrounds on a running display', { skip: !chrome && 'no Chrome' }, () => {
  let dir, server, web, browser;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-bgrules-ui-'));
    globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
    const c = defaultConfig();
    c.calendar.sources = [];
    c.news.feeds = [];
    c.security.displayAccess = 'open';
    const today = localDate(new Date(), c.datetime.timezone);
    c.localEvents.items = [{ id: 'l_party', title: 'Fiesta en casa', allDay: true, date: today, endDate: today }];
    Object.assign(c.screens[0].background, { source: 'stock', transition: 'fade', intervalSec: 3600 });
    c.screens[0].background.rules = [
      { id: 'r_party', when: { type: 'event', text: 'fiesta', calendars: [] }, photos: { source: 'gallery', files: ['party.png'] } },
      { id: 'r_year', when: { type: 'range', from: '01-01', to: '12-31' }, photos: { source: 'gallery', files: ['year.png'] } },
    ];
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(validateConfig(c).value));
    fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    for (const f of ['party.png', 'year.png']) fs.writeFileSync(path.join(dir, 'photos', f), makePng(64, 40));
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
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
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

  // the file of the photo on screen and the rule signature the display holds
  const STATE = `import('/display/store.ts').then(({ state }) => ({
    rule: state.photos?.rule ?? null,
    files: (state.photos?.photos ?? []).map((p) => p.file ?? p.source),
    shown: [...document.querySelectorAll('.photo-area .ph-stack .ph')].map((n) => n.style.backgroundImage).join(' '),
  }))`;
  const until = async (p, ok, ms = 15000) => {
    const end = Date.now() + ms;
    let s;
    while (Date.now() < end) {
      s = await p.eval(STATE);
      if (ok(s)) return s;
      await wait(250);
    }
    return s;
  };

  test('the event goes away: the next rule\'s photo is on screen at once', async () => {
    await syncPhotoRules();
    const p = await browser.page(`${web.url}/?screen=living-room&lite=1`);
    try {
      const first = await until(p, (s) => s.shown.includes('party.png'));
      assert.deepEqual(first.files, ['party.png']);
      assert.match(first.shown, /party\.png/);
      assert.match(first.rule, /^[0-9a-f]{12}$/);
      // the event is deleted (a config save); the refresher's check tells the screen
      const cfg = structuredClone(store.getConfig());
      cfg.localEvents.items = [];
      store.saveConfig(validateConfig(cfg).value);
      assert.deepEqual(await syncPhotoRules(), ['s_main']);
      const next = await until(p, (s) => s.shown.includes('year.png'));
      assert.deepEqual(next.files, ['year.png']);
      assert.match(next.shown, /year\.png/, 'the new photo shows without waiting for the hour-long interval');
      assert.notEqual(next.rule, first.rule);
      // without a push from the server (Marco Cloud has none): the event comes back, the display hears only that the
      // events changed, and asks for its photos again itself (not within 10 s of the last list)
      await wait(10_500);
      const back = structuredClone(store.getConfig());
      back.localEvents.items = [{ id: 'l_party2', title: 'Otra fiesta', allDay: true, date: localDate(new Date(), back.datetime.timezone), endDate: localDate(new Date(), back.datetime.timezone) }];
      store.saveConfig(validateConfig(back).value);
      publish('events', { hash: 'changed' });
      const again = await until(p, (s) => s.shown.includes('party.png'));
      assert.deepEqual(again.files, ['party.png']);
      assert.equal(again.rule, first.rule);
    } finally {
      await p.close();
    }
  });
});
