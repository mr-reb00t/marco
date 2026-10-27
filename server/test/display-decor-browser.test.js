// The HTML overlay and the seasonal decorations on a running display (#24): the owner's HTML is drawn only in a
// sandboxed frame (no scripts, an opaque origin, no taps) over the dashboard and under night dimming; the lights stay
// in a thin band along the top, with snow at Christmas and confetti at New Year, and stand still in lite mode. The
// real app on a random port behind the Vite dev server, in headless Chrome (skipped without a browser).
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
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetPoll } from '../pollHub.js';
import { _resetDisplayAccess, syncDisplayKeys } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { findChrome, launchChrome, startWeb } from './browser.js';

const realFetch = globalThis.fetch;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// the HTML of the issue (#24), as the owner had it in Home Assistant
const LIGHTS = `<style>
  html, body { background: transparent !important; }
  .light-strand { position: fixed; top: -10px; left: 0; width: 100%; height: 60px; z-index: 5; pointer-events: none; display: flex; justify-content: space-around; padding: 0 2%; overflow: visible; }
  .bulb { position: relative; width: 16px; height: 22px; border-radius: 50%; background: #ccc; margin-top: 12px; display: inline-block; animation: twinkle 2s ease-in-out infinite; }
  .bulb.red { background: #e74c3c; --glow-color: #c0392b; }
  .bulb.green { background: #2ecc71; --glow-color: #27ae60; }
  @keyframes twinkle { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; box-shadow: 0 0 20px var(--glow-color); } }
</style>
<div class="light-strand"><i class="bulb red"></i><i class="bulb green"></i><i class="bulb red"></i><i class="bulb green"></i></div>
<script>document.title = 'ran'</script>`;

const chrome = findChrome();
describe('HTML overlay and seasonal decorations on a running display', { skip: !chrome && 'no Chrome' }, () => {
  let dir, server, web, browser;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-decor-ui-'));
    globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
    const c = defaultConfig();
    c.calendar.sources = [];
    c.news.feeds = [];
    c.security.displayAccess = 'open';
    Object.assign(c.screens[0].background, { enabled: false, ambient: 'none' });
    c.screens[0].screen.overlay = { html: LIGHTS, when: { type: 'range', from: '12-01', to: '01-06' } };
    c.screens[0].screen.decoration = { mode: 'auto', snow: true };
    const k = defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' });
    Object.assign(k.background, { enabled: false, ambient: 'none' });
    k.screen.theme = 'light';
    k.screen.overlay = { html: LIGHTS, when: { type: 'range', from: '06-01', to: '06-30' } };
    k.screen.decoration = { mode: 'halloween', snow: true };
    c.screens.push(k);
    const v = validateConfig(c);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(v.value));
    fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    store.initStore(dir);
    _resetDisplays();
    _resetPoll();
    _resetDisplayAccess();
    _resetPrivacy();
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
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  const STATE = `(() => {
    const f = document.getElementById('html-overlay');
    const d = document.getElementById('decor');
    const bulbs = d ? [...d.querySelectorAll('.decor-bulb')] : [];
    const cs = f ? getComputedStyle(f) : null;
    return {
      title: document.title,
      frame: f ? {
        sandbox: f.getAttribute('sandbox'), sandboxTokens: f.sandbox.length, pointer: cs.pointerEvents, z: Number(cs.zIndex),
        position: cs.position, w: f.getBoundingClientRect().width, h: f.getBoundingClientRect().height,
        aria: f.getAttribute('aria-hidden'), tab: f.tabIndex, referrer: f.getAttribute('referrerpolicy'), loading: f.getAttribute('loading'),
        bg: cs.backgroundColor, scheme: f.style.colorScheme, srcdoc: f.srcdoc.includes('light-strand'),
        reachable: (() => { try { return !!f.contentDocument; } catch { return false; } })(),
        inApp: !!f.closest('#app'), hit: document.elementFromPoint(innerWidth / 2, 20) === f,
      } : null,
      strandInPage: document.querySelectorAll('.light-strand, .bulb').length,
      night: Number(getComputedStyle(document.getElementById('night')).zIndex),
      decor: d ? {
        cls: d.className, z: Number(getComputedStyle(d).zIndex), pointer: getComputedStyle(d).pointerEvents,
        bulbs: bulbs.length, bottom: Math.max(0, ...bulbs.map((b) => b.getBoundingClientRect().bottom)),
        band: Math.max(0, ...[...d.querySelectorAll('.decor-strand, .decor-bulb, .decor-bat, .decor-web')].map((b) => b.getBoundingClientRect().bottom)),
        anim: bulbs[0] ? getComputedStyle(bulbs[0]).animationName : '',
        flakes: d.querySelectorAll('.decor-flake').length, confetti: d.querySelectorAll('.decor-bit').length, bats: d.querySelectorAll('.decor-bat').length,
      } : null,
    };
  })()`;
  const until = async (p, ok, ms = 20000) => {
    const end = Date.now() + ms;
    let s;
    while (Date.now() < end) {
      s = await p.eval(STATE);
      if (ok(s)) return s;
      await wait(250);
    }
    return s;
  };
  const open = async (q, size) => {
    const p = await browser.page(`${web.url}/?${q}`, size);
    // a background tab of headless Chrome has no focus and no animation frames
    await p.send('Page.bringToFront').catch(() => undefined);
    await p.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
    return p;
  };
  /** Evaluate `expression` in the overlay frame, which runs in a process of its own (an opaque origin): DevTools can
   *  read it, the page cannot. */
  const inFrame = async (p, expression) => {
    const sessions = [];
    const off = p.on((msg) => {
      if (msg.method === 'Target.attachedToTarget' && msg.params.targetInfo.type === 'iframe') sessions.push(msg.params.sessionId);
    });
    await p.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    for (let i = 0; i < 80 && !sessions.length; i++) await wait(100);
    off();
    assert.ok(sessions.length, 'the overlay frame is a frame of its own');
    let out;
    for (let i = 0; i < 80; i++) {
      out = (await p.send('Runtime.evaluate', { expression, returnByValue: true }, sessions[0])).result.value;
      if (out?.ready) break;
      await wait(100);
    }
    return out;
  };

  test('December: the owner\'s HTML in a sandboxed, transparent frame that takes no taps, with the Christmas lights and snow', async () => {
    const p = await open('screen=living-room&now=2026-12-15T10:00&photos=0');
    try {
      const s = await until(p, (x) => x.frame && x.decor);
      assert.ok(s.frame, 'the overlay frame is on the page');
      assert.equal(s.frame.sandbox, '', 'sandbox with no permission at all');
      assert.equal(s.frame.sandboxTokens, 0, 'no allow-scripts, no allow-same-origin');
      assert.equal(s.frame.reachable, false, 'an opaque origin: the page cannot reach into it, nor it into the page');
      assert.equal(s.frame.pointer, 'none');
      assert.equal(s.frame.hit, false, 'a tap goes through to the dashboard');
      assert.equal(s.frame.position, 'fixed');
      assert.ok(s.frame.w >= 1900 && s.frame.h >= 1060, JSON.stringify(s.frame));
      assert.equal(s.frame.aria, 'true');
      assert.equal(s.frame.tab, -1);
      assert.equal(s.frame.referrer, 'no-referrer');
      assert.equal(s.frame.loading, 'eager');
      assert.equal(s.frame.bg, 'rgba(0, 0, 0, 0)');
      assert.equal(s.frame.scheme, 'dark');
      assert.equal(s.frame.srcdoc, true);
      assert.equal(s.frame.inApp, false);
      assert.equal(s.strandInPage, 0, 'the HTML is never put in the display page itself');
      assert.ok(s.frame.z > 1 && s.frame.z < s.night, `above the dashboard, under night dimming (${s.frame.z} < ${s.night})`);
      // the HTML is drawn in the frame, and its script did not run (it would have set the frame's title)
      const f = await inFrame(p, `({ ready: document.querySelectorAll('.bulb').length > 0, bulbs: document.querySelectorAll('.bulb').length,
        title: document.title, bg: getComputedStyle(document.body).backgroundColor, margin: getComputedStyle(document.body).marginTop,
        top: document.querySelector('.bulb')?.getBoundingClientRect().top ?? -1, origin: location.origin })`);
      assert.equal(f.bulbs, 4, JSON.stringify(f));
      assert.notEqual(f.title, 'ran', 'scripts do not run in the frame');
      assert.equal(f.bg, 'rgba(0, 0, 0, 0)');
      assert.equal(f.margin, '0px');
      assert.ok(f.top >= 0 && f.top < 40, `the bulbs at the top of the screen (${f.top})`);
      assert.equal(f.origin, 'null', 'an opaque origin');
      assert.notEqual(s.title, 'ran');
      // Marco's lights: a thin band along the top, snow, nothing that takes a tap
      assert.match(s.decor.cls, /decor--christmas/);
      assert.doesNotMatch(s.decor.cls, /is-calm/);
      assert.equal(s.decor.pointer, 'none');
      assert.ok(s.decor.z > 1 && s.decor.z < s.night);
      assert.equal(s.decor.bulbs, 20);
      assert.ok(s.decor.bottom > 0 && s.decor.bottom <= 50, `lights within the top 50 px (${s.decor.bottom})`);
      assert.ok(s.decor.band <= 50, `the strand within the top 50 px (${s.decor.band})`);
      assert.equal(s.decor.anim, 'decor-twinkle');
      assert.ok(s.decor.flakes > 0 && s.decor.flakes <= 20, `a few flakes (${s.decor.flakes})`);
      assert.equal(s.decor.confetti, 0);
    } finally {
      await p.close();
    }
  });

  test('New Year\'s Eve: New Year wins over Christmas; lite mode keeps the lights still, with no confetti', async () => {
    const p = await open('screen=living-room&now=2026-12-31T20:00&photos=0');
    try {
      const s = await until(p, (x) => x.decor);
      assert.match(s.decor.cls, /decor--newyear/);
      assert.ok(s.decor.confetti > 0);
      assert.equal(s.decor.flakes, 0);
    } finally {
      await p.close();
    }
    const l = await open('screen=living-room&now=2026-12-15T10:00&photos=0&lite=1');
    try {
      const s = await until(l, (x) => x.decor && x.frame);
      assert.match(s.decor.cls, /is-calm/);
      assert.equal(s.decor.anim, 'none');
      assert.equal(s.decor.flakes, 0);
      assert.ok(s.decor.bulbs > 0, 'the lights are still there');
      assert.ok(s.frame, 'the owner\'s overlay stays in lite mode');
    } finally {
      await l.close();
    }
  });

  test('outside its dates there is no frame; a chosen decoration shows any day, on a light portrait screen too', async () => {
    const p = await open('screen=kitchen&now=2026-12-15T10:00&photos=0', { width: 1080, height: 1920 });
    try {
      const s = await until(p, (x) => x.decor);
      assert.equal(s.frame, null, 'the June overlay is not drawn in December');
      assert.match(s.decor.cls, /decor--halloween/);
      assert.match(s.decor.cls, /is-light/);
      assert.equal(s.decor.bulbs, 12, 'fewer bulbs on a portrait screen');
      assert.ok(s.decor.bottom <= 50, `lights within the top 50 px (${s.decor.bottom})`);
      assert.ok(s.decor.bats > 0);
      assert.ok(s.decor.band <= 50, `bats and cobweb within the top 50 px too (${s.decor.band})`);
      assert.equal(s.decor.flakes, 0, 'snow goes with Christmas only');
    } finally {
      await p.close();
    }
  });
});
