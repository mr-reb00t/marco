// Family access (#16) in headless Chrome, on the real app behind the Vite dev server: the admin asks for a code, the
// kitchen screen draws it (with its QR code, inside the screen, gone after it is used up), the phone dashboard takes
// the code, shows only what the person may do and runs it, and a phone that was revoked goes back to the code screen.
// Skipped without a browser (set CHROME_PATH).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll, listClients } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPoll } from '../pollHub.js';
import { _resetDisplayAccess } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { _resetFamilyAccess } from '../familyAccess.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const realFetch = globalThis.fetch;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `expr` in the page until it is truthy (or fail after `ms`). */
async function until(p, expr, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await p.eval(expr);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${expr}`);
    await wait(100);
  }
}

/** Screenshots of a page in the light and the dark theme into MARCO_SHOT_DIR (for a look by hand). */
async function shotBoth(p, name) {
  fs.mkdirSync(process.env.MARCO_SHOT_DIR, { recursive: true });
  for (const scheme of ['light', 'dark']) {
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await wait(150);
    fs.writeFileSync(path.join(process.env.MARCO_SHOT_DIR, `${name}-${scheme}.png`), await p.screenshot());
  }
  await p.send('Emulation.setEmulatedMedia', { features: [] });
}

const chrome = findChrome();
describe('family access in a browser: a code on the screen, the dashboard on the phone', { skip: !chrome && 'no Chrome' }, () => {
  let dir, server, base, web, browser, cookie;
  const call = async (method, url, body) => {
    const r = await realFetch(base + url, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-access-ui-'));
    globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
    const c = defaultConfig();
    c.calendar.sources = [];
    c.news.feeds = [];
    c.security.displayAccess = 'open';
    c.screens[0].screen.language = 'en';
    c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
    c.screens[1].screen.language = 'en';
    c.family.members = [{ id: 'm_ana', name: 'Ana', avatar: '🦊', color: '#ff8fab' }];
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(validateConfig(c).value));
    fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
    store.initStore(dir);
    _resetDisplays();
    _resetPoll();
    _resetDisplayAccess();
    _resetPrivacy();
    _resetFamilyAccess();
    setServerVersion('test');
    await ensurePassword();
    const app = createApp({ version: 'test', dist: path.join(dir, 'no-dist') });
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
    const login = await realFetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret-pass-123' }) });
    cookie = login.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
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
    _resetFamilyAccess();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the screen draws the code, the phone signs in with it and uses only what it may', async () => {
    const add = await call('POST', '/api/admin/family-access', { name: 'Ana', memberId: 'm_ana', perms: { todo: true, night: true } });
    assert.equal(add.status, 200);
    const id = add.json.person.id;

    // opened with its private link: in open mode a display without a credential never gets a code (familyAccess.js codeClient)
    const key = (await call('GET', '/api/admin/display-links')).json.links.find((l) => l.screenId === 's_kitchen').key;
    const tv = await browser.page(`${web.url}/d/${key}?lite=1`, { width: 1920, height: 1080 });
    const phone = await browser.page(`${web.url}/member/index.html`, { width: 390, height: 844 });
    try {
      // the kitchen display has its stream open
      for (let i = 0; i < 100 && !listClients().some((x) => x.screenId === 's_kitchen'); i++) await wait(100);
      assert.ok(listClients().some((x) => x.screenId === 's_kitchen'), 'the kitchen display is connected');
      const code = await call('POST', `/api/admin/family-access/${id}/code`, { screenId: 's_kitchen' });
      assert.equal(code.status, 200);
      assert.ok(code.json.delivered >= 1);
      const shown = await until(tv, `(() => {
        const root = document.querySelector('#access-code.show');
        if (!root) return null;
        const card = root.querySelector('.ac-card').getBoundingClientRect();
        return {
          code: root.querySelector('.ac-code').textContent,
          kicker: root.querySelector('.ac-kicker').textContent,
          hint: root.querySelector('.ac-hint').textContent,
          qr: !!root.querySelector('.ac-qr svg'),
          inside: card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight,
        };
      })()`);
      assert.equal(shown.code.replace(/\s/g, ''), code.json.code);
      assert.equal(shown.kicker, 'Code for Ana');
      assert.match(shown.hint, /\/my on your phone and type this code/);
      assert.equal(shown.qr, true);
      assert.equal(shown.inside, true, 'the card fits on the screen');

      // the phone types it
      await until(phone, `!!document.querySelector('.m-code')`);
      await phone.eval(`(() => {
        const input = document.querySelector('.m-code');
        input.value = ${JSON.stringify(code.json.code.toLowerCase())};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await wait(100);
      await phone.eval(`document.querySelector('.m-form button[type=submit]').click()`);
      const h1 = await until(phone, `document.querySelector('.m-head h1')?.textContent`);
      assert.equal(h1, 'Hi, Ana');
      const page = await phone.eval(`({
        path: location.pathname + location.hash,
        token: (localStorage.getItem('marco.member.token') || '').slice(0, 3),
        cards: [...document.querySelectorAll('.m-card .m-h2')].map((n) => n.textContent.trim()),
        overflow: document.documentElement.scrollWidth > innerWidth,
        small: [...document.querySelectorAll('button, input')].filter((b) => b.getBoundingClientRect().height && b.getBoundingClientRect().height < 44).map((b) => b.outerHTML.slice(0, 60)),
      })`);
      assert.ok(!page.path.includes('#'), page.path);
      assert.equal(page.token, 'fd_');
      assert.deepEqual(page.cards, ['🌙 Night or day', '✅ New to-do']);
      assert.equal(page.overflow, false, 'no sideways scroll at 390 px');
      assert.deepEqual(page.small.filter((h) => !h.includes('type="checkbox"')), [], 'touch targets of 44 px and up');

      // night, day or auto on one screen: the kitchen goes dark, the main screen does not
      const chips = await phone.eval(`[...document.querySelectorAll('#m-night ~ .m-chips .m-chip')].map((b) => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : ''))`);
      assert.deepEqual(chips, ['All screens*', store.getConfig().screens[0].name, 'Kitchen']);
      if (process.env.MARCO_SHOT_DIR) await shotBoth(phone, 'member-night');
      await phone.eval(`[...document.querySelectorAll('#m-night ~ .m-chips .m-chip')].find((b) => b.textContent.trim() === 'Kitchen').click()`);
      await wait(100);
      await phone.eval(`document.querySelector('#m-night ~ .m-row-3 .m-btn').click()`);
      assert.match(await until(phone, `document.querySelector('#m-night ~ .m-flash.is-ok')?.textContent`), /Kitchen: night mode/);
      assert.equal(await until(tv, `document.documentElement.classList.contains('night')`), true);
      if (process.env.MARCO_SHOT_DIR) await shotBoth(phone, 'member-night-kitchen');
      await phone.eval(`[...document.querySelectorAll('#m-night ~ .m-row-3 .m-btn')][2].click()`);
      assert.match(await until(phone, `document.querySelector('#m-night ~ .m-flash.is-ok')?.textContent.includes('auto') && document.querySelector('#m-night ~ .m-flash.is-ok').textContent`), /Kitchen: auto mode/);

      // the code is single use: the screen drops it at its time; a second phone cannot use it
      assert.equal((await realFetch(`${base}/api/member/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.json.code }) })).status, 404);

      // a to-do from the phone
      await phone.eval(`(() => {
        const input = document.querySelector('#m-todo ~ form input') || document.querySelector('.m-inline input');
        input.value = 'Comprar pan';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await wait(100);
      await phone.eval(`document.querySelector('.m-inline button[type=submit]').click()`);
      assert.match(await until(phone, `document.querySelector('.m-inline ~ .m-flash.is-ok')?.textContent`), /To-do added/);
      assert.equal(store.getConfig().todo.items.at(-1).text, 'Comprar pan');

      // revoked: the next action sends the phone back to the code screen, with a word on why
      const dev = (await call('GET', '/api/admin/family-access')).json.people[0].devices[0];
      assert.equal((await call('DELETE', `/api/admin/family-access/${id}/devices/${dev.id}`)).status, 200);
      await phone.eval(`document.querySelector('.m-row-3 .m-btn').click()`);
      const notice = await until(phone, `document.querySelector('.m-notice')?.textContent`);
      assert.match(notice, /no longer has access/);
      assert.equal(await phone.eval(`localStorage.getItem('marco.member.token')`), null);

      // the QR code on the screen opens the dashboard with the code in the fragment: in at once, nothing left in the address
      const again = await call('POST', `/api/admin/family-access/${id}/code`, { screenId: 's_kitchen' });
      const scanned = await browser.page(`${web.url}/member/index.html#code=${again.json.code}`, { width: 390, height: 844 });
      try {
        assert.equal(await until(scanned, `document.querySelector('.m-head h1')?.textContent`), 'Hi, Ana');
        assert.equal(await scanned.eval('location.pathname + location.hash'), '/my');
      } finally {
        await scanned.close();
      }

      for (const p of [tv, phone]) {
        const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite|403|Failed to load resource/.test(s));
        assert.deepEqual(errors, []);
      }
    } finally {
      await tv.close();
      await phone.close();
    }
  });

  test('the demo code overlay fits a portrait screen too', async () => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=es&accesscode=1`, { width: 1080, height: 1920 });
    try {
      const r = await until(p, `(() => {
        const root = document.querySelector('#access-code.show');
        if (!root) return null;
        const card = root.querySelector('.ac-card').getBoundingClientRect();
        return { kicker: root.querySelector('.ac-kicker').textContent, inside: card.left >= 0 && card.right <= innerWidth && card.top >= 0 && card.bottom <= innerHeight };
      })()`);
      assert.equal(r.kicker, 'Código para Ana');
      assert.equal(r.inside, true);
    } finally {
      await p.close();
    }
  });
});
