// The display's now playing feed (web/display/nowPlayingFeed.ts) without a browser: what stays on screen when the
// server stops answering, and an answer for accounts that changed while it was on its way. fetch, the clock and the
// timers are fakes; the page globals the display modules touch are the few lines below.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import fs from 'node:fs';
import { transformSync } from 'rolldown/experimental';
import { NOW_PLAYING_TIMING } from '../core/nowPlayingCore.js';

// The display's .ts files are compiled on load with the bundler's own transform (they use parameter properties, which
// Node's type stripping refuses).
nodeModule.registerHooks?.({
  resolve(specifier, context, next) {
    if (/^\.\.?\/[^.]*$/.test(specifier) && context.parentURL?.includes('/web/')) {
      try { return next(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts') || !url.includes('/web/')) return next(url, context);
    const src = fs.readFileSync(new URL(url), 'utf8');
    return { format: 'module', source: transformSync(url, src, { lang: 'ts' }).code, shortCircuit: true };
  },
});

const store = new Map();
globalThis.location ??= new URL('http://marco.test/?screen=main');
globalThis.document ??= { hidden: false, addEventListener() {} };
globalThis.localStorage ??= {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

let F = null;
try {
  F = await import('../../web/display/nowPlayingFeed.ts');
} catch {
  // a Node without module hooks: the browser tests cover the feed
}
const cfgFor = (accounts) => ({ screenId: 's_main', screen: { nowPlaying: accounts[0] }, canvas: null });
const song = (title, progress = 10, duration = 200) => ({ provider: 'spotify', kind: 'track', title, artist: 'Ana', album: '', art: '', playing: true, progress, duration });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('a display cut off from the server lets the last track go after the stale time', { skip: !F }, async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const realFetch = globalThis.fetch;
  let up = true;
  globalThis.fetch = async () => {
    if (!up) throw new TypeError('network down');
    return Response.json({ items: { sp_aaaaaaaaaa: song('Sunday Morning') }, next: 10 });
  };
  try {
    let draws = 0;
    const feed = new F.NowPlayingFeed(() => draws++);
    feed.config(cfgFor(['sp_aaaaaaaaaa']));
    await flush();
    assert.equal(feed.get('sp_aaaaaaaaaa')?.title, 'Sunday Morning');
    up = false;
    // the server is gone: the track stays a while (it may still be true)...
    mock.timers.tick(30_000);
    await flush();
    assert.equal(feed.get('sp_aaaaaaaaaa')?.title, 'Sunday Morning');
    const before = draws;
    // ...but not past the server's own stale time
    for (let i = 0; i < 6; i++) {
      mock.timers.tick(30_000);
      await flush();
    }
    assert.equal(feed.get('sp_aaaaaaaaaa'), null);
    assert.equal(feed.position('sp_aaaaaaaaaa'), null);
    assert.ok(draws > before, 'the card and the line draw again without it');
    assert.ok(NOW_PLAYING_TIMING.stale <= 180_000);
  } finally {
    globalThis.fetch = realFetch;
    mock.timers.reset();
  }
});

test('a track well past its end is not shown, even before the stale time', { skip: !F }, async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 2_000_000 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ items: { sp_bbbbbbbbbb: song('Last Song', 190, 200) }, next: 30 });
  try {
    const feed = new F.NowPlayingFeed(() => {});
    feed.config(cfgFor(['sp_bbbbbbbbbb']));
    await flush();
    assert.equal(feed.get('sp_bbbbbbbbbb')?.title, 'Last Song');
    mock.timers.tick(20_000);
    assert.equal(feed.get('sp_bbbbbbbbbb'), null, '10 s left, 20 s gone: over');
  } finally {
    globalThis.fetch = realFetch;
    mock.timers.reset();
  }
});

test('accounts changed while a request was on its way: the new ones are asked at once', { skip: !F }, async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 3_000_000 });
  const realFetch = globalThis.fetch;
  const asked = [];
  let release = null;
  globalThis.fetch = async (url) => {
    const accounts = new URL(String(url), 'http://marco.test').searchParams.get('accounts');
    asked.push(accounts);
    if (asked.length === 1) await new Promise((r) => { release = r; });
    return Response.json({ items: Object.fromEntries(accounts.split(',').map((a) => [a, song(`for ${a}`)])), next: 30 });
  };
  try {
    const feed = new F.NowPlayingFeed(() => {});
    feed.config(cfgFor(['sp_cccccccccc']));
    await flush();
    feed.config(cfgFor(['sp_dddddddddd']));
    release();
    await flush();
    assert.deepEqual(asked, ['sp_cccccccccc', 'sp_dddddddddd'], 'no wait of up to 30 s for the new account');
    assert.equal(feed.get('sp_dddddddddd')?.title, 'for sp_dddddddddd');
  } finally {
    globalThis.fetch = realFetch;
    mock.timers.reset();
  }
});
