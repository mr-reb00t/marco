// "Now playing" with Spotify (issue #18): the shared parts (core/nowPlayingCore.js: the answer's mapping, the cover
// hosts, the refresh policy of one account, the Redirect URI rules, the accounts a screen shows), the validation of the
// card and of "Sonando ahora bajo el reloj", the backup of the app and its accounts, and the routes on the real app
// with a made-up Spotify: the household's own app (the secret never comes back), the connect with PKCE (and the pasted
// address of a server on plain http), what a display may read, one Spotify call per account for every screen, 429 and
// failures, covers by token only, private screens, and disconnecting. No network: every call goes to the fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  askedAccounts, artAllowed, artToken, displayItem, mapSpotifyNow, newAccountId, nextEntry, nextPollSec, NOW_PLAYING_TIMING, nowPlayingAccounts,
  pastedCallback, pickArt, SPOTIFY_ME_URL, SPOTIFY_NOW_URL, SPOTIFY_TOKEN_URL, spotifyAuthUrl, spotifyRedirect,
} from '../core/nowPlayingCore.js';
import { CANVAS_KINDS, canvasDefaults, defaultCanvas, defaultItemStyle, projectCanvas } from '../core/canvasCore.js';
import { validateConfig } from '../core/validate.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { exportSecrets, sanitizeImportedSecrets } from '../core/backupsCore.js';
import { displayConfig } from '../core/screens.js';
import * as store from '../store.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetDisplayAccess, listDisplayLinks, syncDisplayKeys } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { _resetActivityThrottle, listActivity } from '../activity.js';
import { resetNowPlaying } from '../nowPlaying.js';
import { selfHostedFeatures } from '../capabilities.js';
import { makeJpeg } from './photoBytes.js';

const ART = 'https://i.scdn.co/image/ab67616d00001e02aaaaaaaaaaaaaaaaaaaaaaaa';
const track = (over = {}) => ({
  is_playing: true, progress_ms: 61_000, currently_playing_type: 'track',
  item: {
    type: 'track', name: 'Sunday Morning', duration_ms: 200_000,
    artists: [{ name: 'Ana' }, { name: 'The Band' }],
    album: { name: 'Kitchen Radio', images: [{ url: 'https://i.scdn.co/image/big', width: 640 }, { url: ART, width: 300 }, { url: 'https://i.scdn.co/image/small', width: 64 }] },
  },
  ...over,
});

// ---------------------------------------------------------------- core

test('core: a song, an episode, and nothing for paused, 204, ads and unknown items', () => {
  const t = mapSpotifyNow(200, track());
  assert.deepEqual(t, { provider: 'spotify', kind: 'track', title: 'Sunday Morning', artist: 'Ana, The Band', album: 'Kitchen Radio', artUrl: ART, progress: 61, duration: 200 });
  const ep = mapSpotifyNow(200, {
    is_playing: true, progress_ms: 5000, currently_playing_type: 'episode',
    item: { type: 'episode', name: 'Episode 12', duration_ms: 3_600_000, images: [{ url: 'https://i.scdn.co/image/ep', width: 300 }], show: { name: 'The Show', publisher: 'Studio' } },
  });
  assert.deepEqual([ep.kind, ep.title, ep.artist, ep.album, ep.artUrl], ['episode', 'Episode 12', 'The Show', 'Studio', 'https://i.scdn.co/image/ep']);
  assert.equal(mapSpotifyNow(200, track({ is_playing: false })), null, 'paused is hidden');
  assert.equal(mapSpotifyNow(204, null), null);
  assert.equal(mapSpotifyNow(200, { is_playing: true, currently_playing_type: 'ad', item: null }), null);
  assert.equal(mapSpotifyNow(200, { is_playing: true, currently_playing_type: 'unknown', item: { type: 'other', name: 'x' } }), null);
  // control characters and long text are cleaned
  assert.equal(mapSpotifyNow(200, track({ item: { ...track().item, name: `a\u0000b${'x'.repeat(300)}` } })).title.length, 200);
});

test('core: covers only from Spotify\'s image hosts over https, the 300 px one, a token instead of the address', () => {
  assert.equal(artAllowed('https://i.scdn.co/image/x'), true);
  assert.equal(artAllowed('https://mosaic.scdn.co/640/x'), true);
  assert.equal(artAllowed('https://image-cdn-ak.spotifycdn.com/image/x'), true);
  for (const bad of ['http://i.scdn.co/image/x', 'https://evil.example/i.scdn.co', 'https://i.scdn.co.evil.example/x', 'https://user:pw@i.scdn.co/x', 'https://i.scdn.co:8443/x', 'javascript:alert(1)', 42]) assert.equal(artAllowed(bad), false, String(bad));
  assert.equal(pickArt([{ url: 'https://i.scdn.co/a', width: 640 }, { url: 'https://i.scdn.co/b', width: 300 }, { url: 'https://i.scdn.co/c', width: 64 }]), 'https://i.scdn.co/b');
  assert.equal(pickArt([{ url: 'https://i.scdn.co/c', width: 64 }]), 'https://i.scdn.co/c');
  assert.equal(pickArt([{ url: 'https://evil.example/a', width: 300 }]), '');
  assert.match(artToken(ART), /^[0-9a-f]{16}$/);
  assert.equal(artToken(ART), artToken(ART));
});

test('core: one account is read every 10 s while it plays, sooner when the track ends, 20 s idle, Retry-After, back off', () => {
  const T = NOW_PLAYING_TIMING;
  const now = 1_000_000;
  const playing = nextEntry(null, { status: 200, json: track() }, now);
  assert.equal(playing.until - now, T.playing);
  const ending = nextEntry(null, { status: 200, json: track({ progress_ms: 197_000 }) }, now);
  assert.equal(ending.until - now, 4500, 'just after the track ends');
  const idle = nextEntry(playing, { status: 204 }, now + 10_000);
  assert.equal(idle.value, null);
  assert.equal(idle.until - idle.at, T.idle);
  const limited = nextEntry(playing, { status: 429, retryAfterMs: 42_000 }, now + 10_000);
  assert.deepEqual([limited.error, limited.until - (now + 10_000), limited.value?.title], ['rate_limited', 42_000, 'Sunday Morning'], 'the last track stays while it waits');
  let e = playing;
  const waits = [];
  for (let i = 0; i < 6; i++) {
    e = nextEntry(e, { status: 0 }, now + 20_000);
    waits.push(e.until - (now + 20_000));
  }
  assert.deepEqual(waits, [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  assert.equal(e.error, 'unavailable');
  assert.equal(nextEntry(e, { status: 0 }, now + T.stale + 1).value, null, 'a value older than two minutes is not kept');
  assert.equal(nextEntry(null, { status: 401 }, now).error, 'auth');
  assert.equal(nextEntry(null, { status: 0, auth: true }, now).error, 'auth');
});

test('core: what a display gets, the progress moved on, and when it asks again', () => {
  const now = 2_000_000;
  const e = nextEntry(null, { status: 200, json: track() }, now);
  const d = displayItem(e, now + 5000);
  assert.deepEqual(d, { provider: 'spotify', kind: 'track', title: 'Sunday Morning', artist: 'Ana, The Band', album: 'Kitchen Radio', art: artToken(ART), playing: true, progress: 66, duration: 200 });
  assert.equal(JSON.stringify(d).includes('scdn'), false, 'no address reaches a display');
  assert.equal(displayItem(e, now + NOW_PLAYING_TIMING.stale + 1), null, 'stale');
  assert.equal(displayItem({ ...e, value: { ...e.value, progress: 199 } }, now + 9000).progress, 200, 'never past the end');
  assert.equal(nextPollSec([e], now), 11);
  assert.equal(nextPollSec([], now), 10);
  assert.equal(nextPollSec([{ ...e, until: now - 5000 }], now), 3);
});

test('core: Redirect URIs as Spotify accepts them, and the pasted address', () => {
  assert.deepEqual(spotifyRedirect('https://marco.example.com'), { redirectUri: 'https://marco.example.com/auth/spotify/callback', paste: false });
  assert.deepEqual(spotifyRedirect('https://example.com/marco/'), { redirectUri: 'https://example.com/marco/auth/spotify/callback', paste: false });
  assert.deepEqual(spotifyRedirect('http://127.0.0.1:3000'), { redirectUri: 'http://127.0.0.1:3000/auth/spotify/callback', paste: false });
  assert.deepEqual(spotifyRedirect('http://[::1]:3000'), { redirectUri: 'http://[::1]:3000/auth/spotify/callback', paste: false });
  // Spotify refuses "localhost" and plain http on the home network: the loopback address, pasted back
  assert.deepEqual(spotifyRedirect('http://localhost:3000'), { redirectUri: 'http://127.0.0.1:3000/auth/spotify/callback', paste: true });
  assert.deepEqual(spotifyRedirect('http://192.168.1.20:8080'), { redirectUri: 'http://127.0.0.1:8080/auth/spotify/callback', paste: true });
  assert.deepEqual(pastedCallback('http://127.0.0.1:3000/auth/spotify/callback?code=abc&state=xyz'), { state: 'xyz', code: 'abc', error: '' });
  assert.deepEqual(pastedCallback(' http://127.0.0.1:3000/auth/spotify/callback?error=access_denied&state=xyz '), { state: 'xyz', code: '', error: 'access_denied' });
  for (const bad of ['', 'nonsense', 'http://127.0.0.1:3000/other?code=a&state=b', 'http://127.0.0.1:3000/auth/spotify/callback?code=a', null]) assert.equal(pastedCallback(bad), null, String(bad));
  const u = new URL(spotifyAuthUrl({ clientId: 'c'.repeat(32), redirectUri: 'https://x/auth/spotify/callback', state: 's', challenge: 'ch' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.deepEqual(['response_type', 'scope', 'code_challenge_method', 'show_dialog'].map((k) => u.searchParams.get(k)), ['code', 'user-read-currently-playing user-read-playback-state', 'S256', 'true']);
  assert.match(newAccountId(crypto.randomBytes(16)), /^sp_[a-z0-9]{16}$/);
});

test('core: the accounts a screen shows, the request it may make, and the validation of the card and the line', () => {
  const c = defaultConfig();
  const main = c.screens[0];
  main.layout.preset = 'canvas';
  const it = (id, kind, x, props = {}, extra = {}) => ({ id, kind, pos: { zone: 'main', x, y: 0, size: CANVAS_KINDS[kind].def }, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra });
  main.canvas = { ...defaultCanvas(), items: [it('cv_np000001', 'nowplaying', 0, { account: 'sp_aaaaaaaaaaaa' }), it('cv_np000002', 'nowplaying', 6, { account: 'sp_bbbbbbbbbbbb' }, { hidden: true }), it('cv_np000003', 'nowplaying', 12)] };
  const kitchen = defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' });
  kitchen.screen.nowPlaying = 'sp_cccccccccccc';
  c.screens.push(kitchen);
  const v = validateConfig(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(nowPlayingAccounts(v.value.screens[0]), ['sp_aaaaaaaaaaaa'], 'not the hidden card, not the one without an account');
  assert.deepEqual(nowPlayingAccounts(v.value.screens[1]), ['sp_cccccccccccc']);
  assert.equal(v.value.screens[1].screen.nowPlaying, 'sp_cccccccccccc');
  assert.equal('nowPlaying' in v.value.screens[0].screen, false, 'stored only when chosen');
  // the display config carries the opaque id only
  assert.equal(displayConfig(v.value, v.value.screens[1]).screen.nowPlaying, 'sp_cccccccccccc');
  const projected = projectCanvas(v.value.screens[0], {});
  assert.deepEqual(projected.items.find((x) => x.id === 'cv_np000001').props, { account: 'sp_aaaaaaaaaaaa', art: true, progress: true });
  // a display may read only what it asks for that it is allowed
  assert.deepEqual(askedAccounts('sp_aaaaaaaaaaaa,sp_zzzzzzzzzzzz,../x', ['sp_aaaaaaaaaaaa']), ['sp_aaaaaaaaaaaa']);
  assert.deepEqual(askedAccounts(undefined, ['sp_aaaaaaaaaaaa']), []);
  // wrong values are errors with their path
  const bad = structuredClone(c);
  bad.screens[1].screen.nowPlaying = 'ana@example.com';
  bad.screens[0].canvas.items[0].props.account = 'https://evil.example';
  const r = validateConfig(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'screens[1].screen.nowPlaying'), JSON.stringify(r.errors));
  assert.ok(r.errors.some((e) => e.path.endsWith('items[0].props.account')), JSON.stringify(r.errors));
  // Marco Cloud has the card too
  assert.equal(CANVAS_KINDS.nowplaying.edition, 'all');
  assert.equal(selfHostedFeatures().spotify, true);
});

test('backups: the app and its accounts go in a backup with secrets and come back, nothing malformed', () => {
  const sec = { spotify: { clientId: 'a'.repeat(32), clientSecret: 'b'.repeat(32), accounts: { sp_aaaaaaaaaaaa: { name: 'Ana', user: 'ana', refresh_token: 'RT', access_token: 'AT', expiry: 1, scope: 'user-read-currently-playing', connectedAt: '2026-01-01T00:00:00.000Z' } } } };
  const out = exportSecrets(sec);
  assert.equal(out.spotify.clientSecret, 'b'.repeat(32));
  const back = sanitizeImportedSecrets(out);
  assert.equal(back.spotify.accounts.sp_aaaaaaaaaaaa.refresh_token, 'RT');
  assert.equal(back.spotify.accounts.sp_aaaaaaaaaaaa.access_token, '', 'access tokens are not brought back');
  assert.equal(sanitizeImportedSecrets({ spotify: { clientId: 'nope', clientSecret: '' } }).spotify, undefined);
  assert.deepEqual(Object.keys(sanitizeImportedSecrets({ spotify: { clientId: 'a'.repeat(32), clientSecret: '', accounts: { 'bad id': { refresh_token: 'x' } } } }).spotify.accounts), []);
  assert.equal(exportSecrets({}).spotify, undefined);
});

// ---------------------------------------------------------------- the app, with a made-up Spotify

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const CLIENT_SECRET = 'fedcba9876543210fedcba9876543210';

async function withApp(fn, { publicUrl } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-np-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  store.initStore(dir);
  _resetDisplays();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetPrivacy?.();
  setServerVersion('0.5.0');
  await ensurePassword();
  syncDisplayKeys();
  let clock = Date.now();
  resetNowPlaying({ now: () => clock });
  const prevPublic = process.env.PUBLIC_URL;
  const realFetch = globalThis.fetch;
  const fake = { tokenCalls: [], nowCalls: 0, artCalls: 0, challenge: '', redirect: '', now: { status: 200, body: track() }, refreshError: '', issued: 0 };
  const app = createApp({ version: '0.5.0', dist: path.join(dir, 'dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.PUBLIC_URL = publicUrl ?? base;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith(base)) return realFetch(url, init);
    const headers = new Headers(init.headers || {});
    if (u === SPOTIFY_TOKEN_URL) {
      const form = new URLSearchParams(String(init.body));
      fake.tokenCalls.push({ form, auth: headers.get('authorization') });
      if (headers.get('authorization') !== `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`) return Response.json({ error: 'invalid_client' }, { status: 400 });
      if (form.get('grant_type') === 'authorization_code') {
        const ch = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
        if (ch !== fake.challenge || form.get('redirect_uri') !== fake.redirect || form.get('code') !== 'CODE-1') return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({ access_token: 'AT-secret-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT-secret-1', scope: 'user-read-currently-playing user-read-playback-state' });
      }
      if (fake.refreshError) return Response.json({ error: fake.refreshError }, { status: 400 });
      fake.issued++;
      return Response.json({ access_token: `AT-secret-r${fake.issued}`, expires_in: 3600, scope: 'user-read-currently-playing user-read-playback-state' });
    }
    if (u === SPOTIFY_ME_URL) return Response.json({ id: 'ana.listens', display_name: 'Ana' });
    if (u === SPOTIFY_NOW_URL) {
      fake.nowCalls++;
      assert.match(headers.get('authorization') || '', /^Bearer AT-secret-/);
      const { status, body, retryAfter } = fake.now;
      if (status === 204) return new Response(null, { status: 204 });
      return Response.json(body ?? {}, { status, headers: retryAfter ? { 'retry-after': String(retryAfter) } : {} });
    }
    if (u === ART) {
      fake.artCalls++;
      return new Response(makeJpeg(4, 4), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  const call = async (method, url, { body, headers = {} } = {}) => {
    const r = await realFetch(base + url, { method, redirect: 'manual', headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
    return { status: r.status, json, buf, text: buf.toString('utf8'), headers: r.headers, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const keyOf = (slug) => listDisplayLinks().find((l) => l.slug === slug).key;
  const display = (url, slug = 'living-room') => call('GET', url, { headers: { 'x-marco-key': keyOf(slug) } });
  const cookieOf = (r, prev = '') => {
    const jar = new Map(prev.split('; ').filter(Boolean).map((x) => x.split(/=(.*)/s).slice(0, 2)));
    for (const x of r.setCookie) {
      const [kv] = x.split(';');
      const [k, v] = kv.split(/=(.*)/s);
      jar.set(k, v);
    }
    return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  };
  const login = async () => cookieOf(await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } }));
  /** Saves the app, goes through Spotify's consent and comes back: the new account's id and the cookie. */
  const connect = async (cookie) => {
    const st = await call('GET', '/api/admin/spotify', { headers: { cookie } });
    fake.redirect = st.json.redirectUri;
    const go = await call('GET', '/auth/spotify/connect', { headers: { cookie } });
    assert.equal(go.status, 302);
    const to = new URL(go.headers.get('location'));
    fake.challenge = to.searchParams.get('code_challenge');
    const jar = cookieOf(go, cookie);
    return { to, cookie: jar, state: to.searchParams.get('state') };
  };
  try {
    await fn({ call, display, login, connect, cookieOf, fake, base, tick: (ms) => (clock += ms) });
  } finally {
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    globalThis.fetch = realFetch;
    if (prevPublic === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = prevPublic;
    resetNowPlaying();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Puts the account on the main screen (a Sonando ahora card) and under the kitchen's clock. */
function showOn(id) {
  store.updateConfig((c) => {
    const main = c.screens[0];
    main.layout.preset = 'canvas';
    main.canvas = { ...defaultCanvas(), items: [{ id: 'cv_np000001', kind: 'nowplaying', pos: { zone: 'main', x: 0, y: 0, size: 'w' }, style: defaultItemStyle(), props: { account: id, art: true, progress: true } }] };
    c.screens[1].screen.nowPlaying = id;
  }, { reason: 'server' });
}

test('the app: the Client Secret is write-only, checked, and a new Client ID needs its secret', async () => {
  await withApp(async ({ call, login }) => {
    assert.equal((await call('GET', '/api/admin/spotify')).status, 401);
    const cookie = await login();
    const h = { cookie };
    const st = await call('GET', '/api/admin/spotify', { headers: h });
    assert.equal(st.status, 200);
    assert.deepEqual([st.json.clientId, st.json.secretSet, st.json.accounts, st.json.paste], ['', false, [], false]);
    assert.match(st.json.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/spotify\/callback$/);
    assert.equal((await call('PUT', '/api/admin/spotify/app', { body: { clientId: 'short' }, headers: h })).json.error, 'client_id_invalid');
    assert.equal((await call('PUT', '/api/admin/spotify/app', { body: { clientId: CLIENT_ID }, headers: h })).json.error, 'client_secret_required');
    assert.equal((await call('PUT', '/api/admin/spotify/app', { body: { clientId: CLIENT_ID, clientSecret: 'x' }, headers: h })).json.error, 'client_secret_invalid');
    // CSRF: a form post is refused
    const form = await call('PUT', '/api/admin/spotify/app', { headers: { ...h, 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    const ok = await call('PUT', '/api/admin/spotify/app', { body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, headers: h });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual([ok.json.clientId, ok.json.secretSet], [CLIENT_ID, true]);
    assert.equal(ok.text.includes(CLIENT_SECRET), false, 'the secret never comes back');
    assert.equal((await call('GET', '/api/admin/spotify', { headers: h })).text.includes(CLIENT_SECRET), false);
    assert.equal(store.getSecrets().spotify.clientSecret, CLIENT_SECRET);
    // the same Client ID without a secret keeps the stored one
    assert.equal((await call('PUT', '/api/admin/spotify/app', { body: { clientId: CLIENT_ID }, headers: h })).status, 200);
    assert.equal(store.getSecrets().spotify.clientSecret, CLIENT_SECRET);
    assert.ok(listActivity({ type: 'spotify.app_saved' }).items?.length ?? listActivity({ type: 'spotify.app_saved' }).length);
    // removing it
    const gone = await call('PUT', '/api/admin/spotify/app', { body: { clientId: '' }, headers: h });
    assert.deepEqual([gone.json.clientId, gone.json.secretSet], ['', false]);
    assert.equal(store.getSecrets().spotify, undefined);
  });
});

test('connect: PKCE and state, the app\'s own keys, an opaque id, and what a display reads', async () => {
  await withApp(async ({ call, display, login, connect, fake, tick }) => {
    const cookie = await login();
    assert.equal((await call('GET', '/auth/spotify/connect', { headers: { cookie } })).headers.get('location'), '/admin/?error=spotify_not_configured#/spotify');
    await call('PUT', '/api/admin/spotify/app', { body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, headers: { cookie } });
    const { to, cookie: jar, state } = await connect(cookie);
    assert.equal(to.origin, 'https://accounts.spotify.com');
    assert.deepEqual([to.searchParams.get('client_id'), to.searchParams.get('code_challenge_method'), to.searchParams.get('scope')], [CLIENT_ID, 'S256', 'user-read-currently-playing user-read-playback-state']);
    // a wrong state is refused and stores nothing
    const wrong = await call('GET', `/auth/spotify/callback?code=CODE-1&state=${'x'.repeat(state.length)}`, { headers: { cookie: jar } });
    assert.equal(wrong.status, 302);
    assert.match(wrong.headers.get('location'), /error=spotify_invalid_state/);
    // the state was used up by that try: start again
    const again = await connect(cookie);
    const back = await call('GET', `/auth/spotify/callback?code=CODE-1&state=${again.state}`, { headers: { cookie: again.cookie } });
    assert.equal(back.status, 302, back.text);
    const loc = back.headers.get('location');
    const id = new URL(loc, 'http://x').searchParams.get('spotify');
    assert.match(id, /^sp_[a-z0-9]{16}$/);
    assert.match(loc, /#\/spotify$/);
    const acct = store.getSecrets().spotify.accounts[id];
    assert.deepEqual([acct.name, acct.user, acct.refresh_token], ['Ana', 'ana.listens', 'RT-secret-1']);
    assert.ok(fake.tokenCalls.every((x) => x.auth.startsWith('Basic ')), 'the app\'s keys go in the Authorization header');
    const st = await call('GET', '/api/admin/spotify', { headers: { cookie } });
    assert.deepEqual(st.json.accounts.map((a) => [a.id, a.name, a.status]), [[id, 'Ana', 'ok']]);
    assert.equal(/RT-secret|AT-secret|ana\.listens/.test(st.text), false, 'no token and no Spotify user id in the admin');
    // the same Spotify user again keeps its id
    const re = await connect(cookie);
    const back2 = await call('GET', `/auth/spotify/callback?code=CODE-1&state=${re.state}`, { headers: { cookie: re.cookie } });
    assert.equal(new URL(back2.headers.get('location'), 'http://x').searchParams.get('spotify'), id);
    assert.equal(Object.keys(store.getSecrets().spotify.accounts).length, 1);

    // a display: nothing before a screen shows the account
    assert.deepEqual((await display(`/api/display/nowplaying?accounts=${id}`)).json.items, {});
    assert.equal(fake.nowCalls, 0, 'Spotify is not asked for an account no screen shows');
    showOn(id);
    const r = await display(`/api/display/nowplaying?accounts=${id},sp_zzzzzzzzzzzz`);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.json.items), [id]);
    const d = r.json.items[id];
    assert.deepEqual([d.title, d.artist, d.album, d.kind, d.playing, d.duration], ['Sunday Morning', 'Ana, The Band', 'Kitchen Radio', 'track', true, 200]);
    assert.match(d.art, /^[0-9a-f]{16}$/);
    assert.equal(/scdn|secret|ana\.listens/.test(r.text), false, 'no address, token or user id reaches a display');
    assert.equal(r.json.next, 11);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    // the kitchen (the line under its clock) shares the same entry: one Spotify call for both
    const k = await display(`/api/display/nowplaying?accounts=${id}`, 'kitchen');
    assert.equal(k.json.items[id].title, 'Sunday Morning');
    assert.equal(fake.nowCalls, 1);
    tick(NOW_PLAYING_TIMING.playing + 1);
    await display(`/api/display/nowplaying?accounts=${id}`);
    assert.equal(fake.nowCalls, 2, 'read again after 10 s');

    // the cover, by token only, from memory after the first time
    const art = await display(`/api/display/nowplaying/art/${d.art}`);
    assert.equal(art.status, 200);
    assert.equal(art.headers.get('content-type'), 'image/jpeg');
    await display(`/api/display/nowplaying/art/${d.art}`);
    assert.equal(fake.artCalls, 1);
    assert.equal((await display('/api/display/nowplaying/art/0123456789abcdef')).status, 404);
    assert.equal((await display('/api/display/nowplaying/art/..%2Fx')).status, 404);
    assert.equal((await call('GET', `/api/display/nowplaying/art/${d.art}`)).status, 401, 'no credential, no cover');

    // paused: nothing to show
    fake.now = { status: 200, body: track({ is_playing: false }) };
    tick(NOW_PLAYING_TIMING.playing + 1);
    assert.equal((await display(`/api/display/nowplaying?accounts=${id}`)).json.items[id], null);
    // 429: Spotify is left alone for its Retry-After
    fake.now = { status: 429, body: {}, retryAfter: 120 };
    tick(NOW_PLAYING_TIMING.idle + 1);
    await display(`/api/display/nowplaying?accounts=${id}`);
    const n = fake.nowCalls;
    tick(60_000);
    await display(`/api/display/nowplaying?accounts=${id}`);
    assert.equal(fake.nowCalls, n, 'still waiting');
    tick(61_000);
    fake.now = { status: 200, body: track() };
    assert.equal((await display(`/api/display/nowplaying?accounts=${id}`)).json.items[id].title, 'Sunday Morning');

    // a private screen gets nothing
    const p = await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: ['s_main'] }, headers: { cookie } });
    assert.equal(p.status, 200, p.text);
    assert.equal((await display(`/api/display/nowplaying?accounts=${id}`)).status, 403);
    assert.equal((await display(`/api/display/nowplaying/art/${d.art}`)).status, 403);

    // the admin's preview (a signed in session) reads any linked account
    const pv = await call('GET', `/api/display/nowplaying?screen=kitchen&accounts=${id}`, { headers: { cookie } });
    assert.equal(pv.json.items[id].title, 'Sunday Morning');

    // the test button
    const t = await call('GET', `/api/admin/spotify/accounts/${id}/now`, { headers: { cookie } });
    assert.deepEqual([t.json.ok, t.json.item.title], [true, 'Sunday Morning']);
    assert.equal((await call('GET', '/api/admin/spotify/accounts/sp_zzzzzzzzzzzz/now', { headers: { cookie } })).status, 404);

    // an expired access token is refreshed with the app's keys; invalid_grant asks for a new connect
    store.updateSecrets((s) => { s.spotify.accounts[id].expiry = 0; });
    tick(NOW_PLAYING_TIMING.playing + 1);
    await call('GET', `/api/admin/spotify/accounts/${id}/now`, { headers: { cookie } });
    assert.equal(fake.tokenCalls.at(-1).form.get('grant_type'), 'refresh_token');
    assert.equal(fake.tokenCalls.at(-1).form.get('refresh_token'), 'RT-secret-1');
    store.updateSecrets((s) => { s.spotify.accounts[id].expiry = 0; });
    fake.refreshError = 'invalid_grant';
    tick(NOW_PLAYING_TIMING.playing + 1);
    const failed = await call('GET', `/api/admin/spotify/accounts/${id}/now`, { headers: { cookie } });
    assert.deepEqual([failed.json.ok, failed.json.error], [false, 'auth']);
    assert.equal((await call('GET', '/api/admin/spotify', { headers: { cookie } })).json.accounts[0].status, 'reconnect');

    // disconnect: the tokens go, with where to remove the access at Spotify
    const del = await call('DELETE', `/api/admin/spotify/accounts/${id}`, { headers: { cookie } });
    assert.deepEqual([del.status, del.json.manageAccess], [200, 'https://www.spotify.com/account/apps/']);
    assert.equal(store.getSecrets().spotify.accounts[id], undefined);
    assert.equal((await call('DELETE', `/api/admin/spotify/accounts/${id}`, { headers: { cookie } })).status, 404);
    const log = JSON.stringify(listActivity({ limit: 50 }));
    assert.match(log, /spotify\.connected/);
    assert.match(log, /spotify\.removed/);
    assert.equal(/RT-secret|AT-secret|fedcba98/.test(log), false, 'no token or secret in the activity log');
  });
});

test('connect on plain http: the loopback Redirect URI and the pasted address', async () => {
  await withApp(async ({ call, login, connect, cookieOf }) => {
    const cookie = await login();
    await call('PUT', '/api/admin/spotify/app', { body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, headers: { cookie } });
    const st = await call('GET', '/api/admin/spotify', { headers: { cookie } });
    assert.deepEqual([st.json.paste, st.json.redirectUri], [true, 'http://127.0.0.1:3000/auth/spotify/callback']);
    const { cookie: jar, state, to } = await connect(cookie);
    assert.equal(to.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/auth/spotify/callback');
    // the loopback page opened without the admin's cookie: a page that says to paste the address
    const page = await call('GET', `/auth/spotify/callback?code=CODE-1&state=${state}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /paste it/);
    assert.equal((await call('POST', '/api/admin/spotify/finish', { body: { url: 'not an address' }, headers: { cookie: jar } })).json.error, 'spotify_bad_address');
    const done = await call('POST', '/api/admin/spotify/finish', { body: { url: `http://127.0.0.1:3000/auth/spotify/callback?code=CODE-1&state=${state}` }, headers: { cookie: jar } });
    assert.equal(done.status, 200, done.text);
    assert.match(done.json.id, /^sp_/);
    assert.equal(done.json.accounts.length, 1);
    // single use
    const twice = await call('POST', '/api/admin/spotify/finish', { body: { url: `http://127.0.0.1:3000/auth/spotify/callback?code=CODE-1&state=${state}` }, headers: { cookie: cookieOf(done, jar) } });
    assert.equal(twice.json.error, 'spotify_invalid_state');
  }, { publicUrl: 'http://marco.local:3000' });
});
