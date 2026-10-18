// First load of a display (web/display/boot.ts, bootShell.ts, main.ts boot): with a page bootstrap the screen draws
// from it without asking for the config, the setup status or the data it carries; without one the config, the setup
// check and the answers that do not depend on the config go out together; a block that does not fit is ignored; the
// clock shell shows while the screen is on its way and nothing kept from an earlier visit is drawn before the server
// answered. Headless Chrome on the display served by Vite, with a fake display API that logs when each request came.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome } from './browser.js';
import { defaultConfig } from '../core/defaults.js';
import { displayConfig as projectDisplayConfig } from '../core/screens.js';
import { localDate } from '../core/lib/tz.js';
import { bootBlock, bootEventWindows, eventsPath } from '../core/bootstrap.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const chrome = findChrome();
const KEY = '6de3cffc-a424-49d3-a44d-aa2d7678319c';

const cfg = defaultConfig();
cfg.revision = 3;
const screen = cfg.screens[0];
screen.background.enabled = false; // no photo to wait for: the screen fades in as soon as it has its config
screen.calendar.weeks = 'auto';
const CONFIG = projectDisplayConfig(cfg, screen, { privacy: { status: { active: false }, next: null } });
const today = () => localDate(new Date(), CONFIG.datetime.timezone);
const event = (title) => ({ id: `e_${title}`, sourceId: 'local', title, start: today(), end: today(), allDay: true, location: '', color: '#ff5a4e', emoji: '', kind: 'event', multiDay: false });
const events = (title) => ({ events: [event(title)], hash: `h_${title}`, errors: [] });

/** What the fake API and page do in the current case. */
const opts = { boot: null, delay: {}, log: [] };
let t0 = 0;

function fakeApi() {
  return {
    name: 'fake-display-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/')) return next();
        const p = url.split('?')[0];
        opts.log.push({ path: url, at: Date.now() - t0, key: req.headers['x-marco-key'] || '' });
        const ms = opts.delay[p] ?? 0;
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const send = (status, body) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'private, no-store');
          res.end(JSON.stringify(body));
        };
        if (p === '/api/setup/status') return send(200, { needsSetup: false });
        if (p === '/api/health') return send(200, { ok: true, version: 'test', edition: 'cloud', live: 'poll' });
        if (p === '/api/display/config') return send(200, CONFIG);
        if (p === '/api/events') return send(200, events('Network dentist'));
        if (p === '/api/countdowns') return send(200, { items: [], hash: 'c0', today: today() });
        if (p === '/api/news') return send(200, { items: [] });
        if (p === '/api/photos') return send(200, { photos: [] });
        if (p === '/api/display/heartbeat') return send(200, { ok: true, now: new Date().toISOString(), revision: 3 });
        return send(404, { error: 'not_found' });
      });
    },
    transformIndexHtml(html) {
      return opts.boot ? html.replace('</body>', `${opts.boot}</body>`) : html;
    },
  };
}

let web;
let browser;
before(async () => {
  if (!chrome) return;
  const { createServer } = await import('vite');
  web = await createServer({
    configFile: false,
    root: path.join(root, 'web'),
    logLevel: 'error',
    plugins: [fakeApi()],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    define: { __APP_VERSION__: '"test"', __APP_BUILD__: '"test"', __APP_NOTES__: '""' },
  });
  await web.listen();
  browser = await launchChrome(chrome);
  // warm Vite's transform cache, so module loading does not count in the timings below
  const p = await browser.page(`${base()}/d/${KEY}?lite=1`, { width: 1280, height: 800 });
  await p.eval('new Promise((r) => setTimeout(r, 1500))');
  await p.close();
});
after(async () => {
  await browser?.close();
  await web?.close();
});
const base = () => `http://127.0.0.1:${web.httpServer.address().port}`;

/** Open the display (fresh tab), wait until `until` holds in the page, return the request log. */
async function open({ boot = null, delay = {}, until = '!document.getElementById("app").classList.contains("booting")', setup = '' } = {}) {
  opts.boot = boot;
  opts.delay = delay;
  opts.log = [];
  t0 = Date.now();
  const page = await browser.page(`${base()}/d/${KEY}?lite=1${setup}`, { width: 1600, height: 900 });
  const start = Date.now();
  while (!(await page.eval(`Boolean(${until})`))) {
    if (Date.now() - start > 15000) throw new Error(`timeout: ${until}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  return { page, log: opts.log };
}
const asked = (log, p) => log.filter((x) => x.path.split('?')[0] === p);

test('a bootstrapped page draws from the block: no config, setup or data requests for what it carries', { skip: !chrome && 'no Chrome' }, async () => {
  const data = {
    '/api/display/config': CONFIG,
    '/api/health': { ok: true, version: 'test', edition: 'cloud', live: 'poll' },
    '/api/countdowns': { items: [], hash: 'c0', today: today() },
    '/api/news': { items: [] },
    '/api/photos?count=20': { photos: [] },
  };
  for (const w of bootEventWindows(CONFIG)) data[eventsPath(w)] = events('Bootstrapped dentist');
  // every API answer is slow: whatever the screen shows within the first second came from the block
  const slow = Object.fromEntries(['/api/display/config', '/api/setup/status', '/api/events', '/api/weather', '/api/health', '/api/countdowns'].map((p) => [p, 3000]));
  const { page, log } = await open({ boot: bootBlock(data), delay: slow, until: 'document.getElementById("app").textContent.includes("Bootstrapped dentist")' });
  try {
    const shownAt = Date.now() - t0;
    assert.ok(shownAt < 3000, `drawn from the block (${shownAt} ms)`);
    assert.equal(await page.eval('document.getElementById("app").classList.contains("booting")'), false);
    assert.deepEqual(asked(log, '/api/display/config'), []);
    assert.deepEqual(asked(log, '/api/setup/status'), []);
    // the events the block has for this window are not asked for again on the first draw
    assert.ok(!log.some((x) => x.path.startsWith('/api/events') && x.at < 1500), JSON.stringify(log));
    // what the block did not carry is asked for at once, with the credential
    const w = asked(log, '/api/weather');
    assert.equal(w.length, 1);
    assert.equal(w[0].key, KEY);
  } finally {
    await page.close();
  }
});

test('without a block, the config, the setup check and the first data go out together', { skip: !chrome && 'no Chrome' }, async () => {
  const { page, log } = await open({ delay: { '/api/display/config': 600, '/api/setup/status': 600 }, until: 'document.getElementById("app").textContent.includes("Network dentist")' });
  try {
    const at = (p) => asked(log, p)[0]?.at ?? Infinity;
    const cfgAt = at('/api/display/config');
    for (const p of ['/api/setup/status', '/api/weather', '/api/news', '/api/countdowns', '/api/photos']) {
      assert.ok(Math.abs(at(p) - cfgAt) < 300, `${p} at ${at(p)} ms, config at ${cfgAt} ms`);
    }
    // the events need the config (their window), and each early request is used: one request per path
    assert.ok(at('/api/events') >= cfgAt + 550, `events at ${at('/api/events')} ms`);
    for (const p of ['/api/weather', '/api/news', '/api/photos']) assert.equal(asked(log, p).length, 1, p);
  } finally {
    await page.close();
  }
});

test('a block that does not fit is ignored: other event window, other version, broken JSON', { skip: !chrome && 'no Chrome' }, async () => {
  const wrong = bootBlock({ '/api/display/config': CONFIG, '/api/events?from=2000-01-01&to=2000-02-01': events('Old dentist') });
  let r = await open({ boot: wrong, until: 'document.getElementById("app").textContent.includes("Network dentist")' });
  assert.deepEqual(asked(r.log, '/api/display/config'), []);
  assert.equal(asked(r.log, '/api/events').length >= 1, true);
  assert.equal(await r.page.eval('document.getElementById("app").textContent.includes("Old dentist")'), false);
  await r.page.close();
  for (const bad of [
    bootBlock({ '/api/display/config': CONFIG }).replace('{"v":1', '{"v":99'),
    '<script type="application/json" id="marco-boot">{not json</script>',
  ]) {
    r = await open({ boot: bad, until: 'document.getElementById("app").textContent.includes("Network dentist")' });
    assert.equal(asked(r.log, '/api/display/config').length, 1);
    assert.equal(asked(r.log, '/api/setup/status').length, 1);
    await r.page.close();
  }
});

test('the clock shell shows while the screen is slow to come, and nothing kept from before is drawn', { skip: !chrome && 'no Chrome' }, async () => {
  // a first visit leaves the config and the events in this browser's storage
  let r = await open({ until: 'document.getElementById("app").textContent.includes("Network dentist")' });
  await r.page.eval(`(() => {
    const ns = Object.keys(localStorage).find((k) => k.startsWith('cs.cache.k_') && k.endsWith('.config'));
    const cfg = JSON.parse(localStorage.getItem(ns));
    cfg.datetime.format24 = false; cfg.datetime.showAmPm = true; cfg.screen.theme = 'light';
    localStorage.setItem(ns, JSON.stringify(cfg));
    localStorage.setItem(ns.replace(/config$/, 'events'), JSON.stringify(${JSON.stringify(events('Cached dentist'))}));
  })()`);
  await r.page.close();
  // the server is slow now: the shell (12 h, light, from the kept settings) and no family data until it answers
  r = await open({ delay: { '/api/display/config': 2500 }, until: 'document.querySelector("#boot-shell.show")' });
  try {
    const shell = await r.page.eval('({ text: document.getElementById("boot-shell").textContent, light: document.getElementById("boot-shell").classList.contains("light") })');
    assert.match(shell.text, /\d{1,2}:\d{2} (AM|PM)/);
    assert.equal(shell.light, true);
    assert.equal(await r.page.eval('document.getElementById("app").textContent.includes("Cached dentist")'), false);
    assert.equal(await r.page.eval('document.getElementById("app").classList.contains("booting")'), true);
    // the server answers: the screen fades in and the shell goes
    const start = Date.now();
    while (!(await r.page.eval('document.getElementById("app").textContent.includes("Network dentist") && !document.getElementById("boot-shell")'))) {
      if (Date.now() - start > 8000) throw new Error('the shell did not go');
      await new Promise((res) => setTimeout(res, 50));
    }
  } finally {
    await r.page.close();
  }
});
