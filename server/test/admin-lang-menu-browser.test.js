// The language menu (web/admin/components/LangMenu.tsx) in headless Chrome, on the real app behind the Vite dev
// server: the setup wizard's first step, then the panel's sidebar. Every language by its own name, the
// current one checked, the keyboard (arrows, Escape) and a click outside, and picking one switches the texts and is
// remembered. Skipped without a browser (set CHROME_PATH).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPoll } from '../pollHub.js';
import { _resetDisplayAccess } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const realFetch = globalThis.fetch;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ['Español', 'English', 'Português', 'Nederlands', 'Dansk', 'Polski'];

async function until(p, expr, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    // (right after a reload the page may still be navigating: that is asked again)
    const v = await p.eval(expr).catch((e) => {
      if (/navigated|closed|context|destroyed/i.test(String(e?.message))) return null;
      throw e;
    });
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${expr}`);
    await wait(100);
  }
}

const key = (p, k, code, vk) => Promise.all(['keyDown', 'keyUp'].map((type) => p.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk })));

/** The menu's items in `root`: [{ name, checked }] */
const items = (p, root) => p.eval(`[...document.querySelectorAll('${root} [role="menuitemradio"]')].map((b) => ({ name: b.querySelector('.lang-menu__name').textContent, checked: b.getAttribute('aria-checked') }))`);

const chrome = findChrome();
describe('admin language menu in a browser', { skip: !chrome && 'no Chrome' }, () => {
  let dir, server, base, web, browser;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-lang-ui-'));
    globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
    const c = defaultConfig();
    c.calendar.sources = [];
    c.news.feeds = [];
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(validateConfig(c).value));
    store.initStore(dir);
    _resetDisplays();
    _resetPoll();
    _resetDisplayAccess();
    _resetPrivacy();
    setServerVersion('test');
    await ensurePassword();
    const app = createApp({ version: 'test', dist: path.join(dir, 'no-dist') });
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
    web = await startWeb({ api: base });
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

  test('the setup wizard: a language menu on the first step instead of six cards', async () => {
    const p = await browser.page(`${web.url}/admin/?lang=en`, { width: 390, height: 844 });
    // (a tab in the background has no focus: the keyboard checks need it as if it were in front)
    await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    try {
      // (the page before the reload is marked: only the reloaded one counts)
      await p.eval(`window.__before = 1; localStorage.setItem('calendar-admin.lang', 'en'); location.reload()`).catch(() => {});
      await until(p, `!window.__before && document.querySelector('.wizard .lang-menu--field')`);
      // no row of language cards any more
      assert.equal(await p.eval(`document.querySelectorAll('.wz-lang, .wz-langs').length`), 0);
      const btn = `.wizard .lang-menu--field .lang-menu__btn`;
      assert.equal(await p.eval(`document.querySelector('${btn}').getAttribute('aria-haspopup')`), 'menu');
      assert.equal(await p.eval(`document.querySelector('${btn}').getAttribute('aria-expanded')`), 'false');
      assert.match(await p.eval(`document.querySelector('${btn}').textContent`), /English/);
      // the step gives the button the focus once it is drawn: opened before that, the step would take it back
      await until(p, `document.activeElement === document.querySelector('${btn}')`);
      await p.eval(`document.querySelector('${btn}').click()`);
      await until(p, `document.querySelector('.wizard .lang-menu--field [role="menu"]')`);
      assert.equal(await p.eval(`document.querySelector('${btn}').getAttribute('aria-expanded')`), 'true');
      const list = await items(p, '.wizard .lang-menu--field');
      assert.deepEqual(list.map((i) => i.name), NAMES);
      assert.deepEqual(list.filter((i) => i.checked === 'true').map((i) => i.name), ['English']);
      // the focus goes to the checked language; no horizontal scroll on a phone with the menu open
      await until(p, `document.activeElement.getAttribute('aria-checked') === 'true'`);
      assert.equal(await p.eval(`document.documentElement.scrollWidth <= innerWidth`), true);
      await p.eval(`[...document.querySelectorAll('.wizard [role="menuitemradio"]')].find((b) => b.textContent.includes('Dansk')).click()`);
      await until(p, `document.documentElement.lang === 'da' && !document.querySelector('.wizard [role="menu"]')`);
      assert.match(await p.eval(`document.querySelector('${btn}').textContent`), /Dansk/);
      assert.equal(await p.eval(`localStorage.getItem('calendar-admin.lang')`), 'da');
      // back to English for the next test
      await p.eval(`document.querySelector('${btn}').click()`);
      await until(p, `document.querySelector('.wizard [role="menu"]')`);
      await p.eval(`[...document.querySelectorAll('.wizard [role="menuitemradio"]')].find((b) => b.textContent.includes('English')).click()`);
      await until(p, `document.documentElement.lang === 'en'`);
      assert.deepEqual(p.errors().map((e) => e.params?.exceptionDetails?.text ?? e.params?.args?.[0]?.value).filter((m) => !/Failed to load resource/.test(String(m))), []);
    } finally {
      await p.close();
    }
  });

  test('the sidebar: six languages, the current one checked, the keyboard, and Polski switches the panel', async () => {
    // the wizard's job done by hand: a password, so the panel opens after a login
    const hash = await hashPassword('secret-pass-123');
    store.updateSecrets((s) => { s.passwordHash = hash; s.passwordIsDefault = false; });
    const p = await browser.page(`${web.url}/admin/`, { width: 1280, height: 860 });
    // (a tab in the background has no focus: the keyboard checks need it as if it were in front)
    await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    try {
      await p.eval(`(async () => {
        localStorage.setItem('calendar-admin.lang', 'en');
        await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret-pass-123' }) });
        location.reload();
      })()`).catch(() => {});
      const btn = `.sidebar .lang-menu__btn`;
      await until(p, `document.querySelector('${btn}')`);
      assert.equal(await p.eval(`document.querySelectorAll('.lang-switch').length`), 0);
      assert.equal(await p.eval(`document.querySelector('${btn}').getAttribute('aria-label')`), 'Panel language: English');
      // keyboard: ArrowDown opens it on the current language, the arrows move, Escape closes it and gives the focus back
      await p.eval(`document.querySelector('${btn}').focus()`);
      await key(p, 'ArrowDown', 'ArrowDown', 40);
      await until(p, `document.querySelector('.sidebar [role="menu"]')`);
      await until(p, `document.activeElement.getAttribute('role') === 'menuitemradio' && document.activeElement.textContent === 'English'`);
      await key(p, 'ArrowDown', 'ArrowDown', 40);
      await until(p, `document.activeElement.getAttribute('role') === 'menuitemradio' && document.activeElement.textContent === 'Português'`);
      await key(p, 'End', 'End', 35);
      await until(p, `document.activeElement.getAttribute('role') === 'menuitemradio' && document.activeElement.textContent === 'Polski'`);
      await key(p, 'Escape', 'Escape', 27);
      await until(p, `!document.querySelector('.sidebar [role="menu"]')`);
      await until(p, `document.activeElement === document.querySelector('${btn}')`);
      // a click outside closes it
      await p.eval(`document.querySelector('${btn}').click()`);
      await until(p, `document.activeElement.getAttribute('aria-checked') === 'true'`);
      await p.eval(`document.querySelector('.main-col').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
      await until(p, `!document.querySelector('.sidebar [role="menu"]')`);
      // open it, six languages by their own names, English checked; pick Polski
      await p.eval(`document.querySelector('${btn}').click()`);
      await until(p, `document.querySelector('.sidebar [role="menu"]')`);
      const list = await items(p, '.sidebar');
      assert.deepEqual(list.map((i) => i.name), NAMES);
      assert.deepEqual(list.filter((i) => i.checked === 'true').map((i) => i.name), ['English']);
      assert.equal(await p.eval(`document.querySelector('.sidebar .brand').textContent.includes('Control panel')`), true);
      await p.eval(`[...document.querySelectorAll('.sidebar [role="menuitemradio"]')].find((b) => b.textContent === 'Polski').click()`);
      await until(p, `document.documentElement.lang === 'pl'`);
      await until(p, `document.querySelector('.sidebar .brand').textContent.includes('Panel sterowania')`);
      assert.equal(await p.eval(`!!document.querySelector('.sidebar [role="menu"]')`), false);
      assert.equal(await p.eval(`document.querySelector('${btn}').getAttribute('aria-label')`), 'Język panelu: Polski');
      assert.equal(await p.eval(`localStorage.getItem('calendar-admin.lang')`), 'pl');
      await p.eval(`document.querySelector('${btn}').click()`);
      await until(p, `document.querySelector('.sidebar [role="menu"]')`);
      assert.deepEqual((await items(p, '.sidebar')).filter((i) => i.checked === 'true').map((i) => i.name), ['Polski']);
    } finally {
      await p.close();
    }
  });
});
