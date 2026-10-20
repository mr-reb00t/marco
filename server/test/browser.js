// Headless Chrome for tests and scripts, with no dependency: the DevTools protocol over Node's global WebSocket, and
// the display served by Vite (dev mode, no API: pages open with ?demo=1). `findChrome()` returns null when no browser
// is installed, this Node has no WebSocket or MARCO_SKIP_BROWSER=1 is set (the release workflow), and the tests that
// need one are skipped then.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

/** Path of a Chrome or Chromium binary, or null. */
export function findChrome() {
  if (process.env.MARCO_SKIP_BROWSER === '1' || typeof WebSocket === 'undefined') return null;
  return CANDIDATES.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

/** Vite dev server for web/ on a free port of 127.0.0.1. Returns { url, close }. */
export async function startWeb({ api = '' } = {}) {
  const { createServer } = await import('vite');
  // `api`: a running Marco server (http://127.0.0.1:port) that /api and /media go to, for a display on real data
  const proxy = api ? { '/api': { target: api }, '/media': { target: api } } : undefined;
  const server = await createServer({
    configFile: false,
    root: path.join(root, 'web'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, ws: false, watch: null, proxy },
    optimizeDeps: { noDiscovery: true, include: [] },
    define: { __APP_VERSION__: '"test"', __APP_BUILD__: '"test"', __APP_NOTES__: '""' },
  });
  await server.listen();
  const addr = server.httpServer.address();
  return { url: `http://127.0.0.1:${addr.port}`, close: () => server.close() };
}

/**
 * Launch headless Chrome. Returns { page(url, opts), close }. `page()` opens a tab of `opts.width`×`opts.height`,
 * waits for the load event, and gives { eval(expr), close }.
 */
export async function launchChrome(bin = findChrome()) {
  if (!bin) throw new Error('no chrome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-chrome-'));
  const proc = spawn(bin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  // a test that forgets to close its browser (or a run ended by --test-force-exit) never leaves Chrome behind: it
  // goes with this process, by its own PID
  const reap = () => {
    if (proc.exitCode === null && proc.signalCode === null) try { proc.kill('SIGKILL'); } catch { /* gone */ }
  };
  process.once('exit', reap);
  proc.once('exit', () => process.off('exit', reap));
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('chrome did not start')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    proc.on('exit', () => reject(new Error('chrome exited')));
  });
  const http = wsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '');

  // Each page in a window of its own: tabs of one window are hidden but for the front one, and a hidden page runs no
  // animation frames, so a card fitted in a frame (canvas.ts relayoutSoon) would never be fitted again there. A
  // screen is always visible; so is every page here.
  let browserWs = null;
  let browserReady = null;
  let browserSeq = 0;
  const browserWaiting = new Map();
  const browserSend = async (method, params = {}) => {
    // one connection to the browser, shared by the pages opened at the same time
    browserReady ??= new Promise((res, rej) => {
      browserWs = new WebSocket(wsUrl);
      browserWs.onopen = res;
      browserWs.onerror = rej;
      browserWs.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        const w = msg.id && browserWaiting.get(msg.id);
        if (!w) return;
        browserWaiting.delete(msg.id);
        if (msg.error) w.rej(new Error(msg.error.message));
        else w.res(msg.result);
      };
    });
    await browserReady;
    const id = ++browserSeq;
    return new Promise((res, rej) => {
      browserWaiting.set(id, { res, rej });
      browserWs.send(JSON.stringify({ id, method, params }));
    });
  };

  async function page(url, { width = 1920, height = 1080 } = {}) {
    const { targetId } = await browserSend('Target.createTarget', { url: 'about:blank', newWindow: true });
    const target = { id: targetId, webSocketDebuggerUrl: `${wsUrl.replace(/\/devtools\/browser\/.*$/, '')}/devtools/page/${targetId}` };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });
    let seq = 0;
    const waiting = new Map();
    const events = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && waiting.has(msg.id)) {
        const { res, rej } = waiting.get(msg.id);
        waiting.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        events.push(msg);
        for (const w of [...listeners]) w(msg);
      }
    };
    const listeners = new Set();
    // `sessionId`: a frame of its own process (an out-of-process iframe), reached through Target.setAutoAttach
    const send = (method, params = {}, sessionId = undefined) => new Promise((res, rej) => {
      const id = ++seq;
      waiting.set(id, { res, rej });
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
    const once = (method, ms = 20000) => new Promise((res, rej) => {
      const t = setTimeout(() => {
        listeners.delete(fn);
        rej(new Error(`timeout waiting for ${method}`));
      }, ms);
      const fn = (msg) => {
        if (msg.method !== method) return;
        clearTimeout(t);
        listeners.delete(fn);
        res(msg.params);
      };
      listeners.add(fn);
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url });
    await loaded;
    const evaluate = async (expression) => {
      const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
      return out.result.value;
    };
    return {
      eval: evaluate,
      send,
      events,
      /** Call `fn` with every event from now on (also those of attached frames, with their sessionId). */
      on: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      /** Errors logged by the page (console.error and uncaught exceptions). */
      errors: () => events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')),
      screenshot: async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
      close: async () => {
        ws.close();
        await fetch(`${http}/json/close/${target.id}`).catch(() => undefined);
      },
    };
  }

  return {
    page,
    close: async () => {
      try { browserWs?.close(); } catch { /* already closed */ }
      // the process only: stopped by its own PID
      const exited = () => new Promise((r) => {
        if (proc.exitCode !== null || proc.signalCode !== null) return r(true);
        proc.once('exit', () => r(true));
        setTimeout(() => r(false), 3000);
      });
      proc.kill('SIGTERM');
      // Chrome that does not stop in time is killed, so no process keeps the test run alive
      if (!(await exited())) {
        proc.kill('SIGKILL');
        await exited();
      }
      // its helpers can still be writing the profile for a moment: retry, and never fail a test over a temp folder
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch { /* left for the OS to clean */ }
    },
  };
}
