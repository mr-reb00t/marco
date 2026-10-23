// Data cards of Personalizado (market, sports, stocks): the readers of each source's answer (core/dataCore.js), the
// shared cache (one upstream call per key per interval for every screen, stale while error, back off, Retry-After,
// only the allowed hosts), what one item gets, the validation of the three kinds, and the routes on the real app with
// a made-up upstream (core/dataFake.js): only this screen's items, nothing while private or hidden by a condition,
// crests by token only, the builder's routes behind the session, and the Finnhub key in no answer. No network: every
// test runs on fake answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDataHub, crestPath, crestToken, DATA_HOSTS, DataError, dataForItem, parseChart, parseEvent, parseEvents, parseMarkets, parseQuote,
  parseTeams, pickGames, sportsTtl, thin,
} from '../core/dataCore.js';
import { fakeDataCall, fakeScoreboard, FAKE_STOCKS_KEY } from '../core/dataFake.js';
import {
  CANVAS_KINDS, CLOUD_CANVAS_KINDS, canvasDataItems, canvasDefaults, defaultCanvas, defaultItemStyle, projectCanvas, sanitizeCanvas,
} from '../core/canvasCore.js';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetDisplayAccess, listDisplayLinks, syncDisplayKeys } from '../displayAccess.js';
import { _resetPrivacy } from '../privacy.js';
import { _resetActivityThrottle } from '../activity.js';
import { setDataFetch } from '../dataFeeds.js';

const MIN = 60_000;
const collector = () => {
  const errors = [];
  return { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn() {} };
};

// ---- readers -----------------------------------------------------------------------------------------------------

test('parseMarkets: price, the change of each range, the sparkline scaled from dollars to the currency', () => {
  const text = JSON.stringify([
    { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 50000, last_updated: '2026-10-14T10:00:00.000Z', price_change_percentage_24h_in_currency: 1.5, price_change_percentage_7d_in_currency: -2, price_change_percentage_30d_in_currency: 9, sparkline_in_7d: { price: [54000, 55000, 55000] } },
    { id: 'no price', current_price: 1 },
    { id: 'eth', current_price: null },
  ]);
  const m = parseMarkets(text);
  assert.deepEqual([...m.keys()], ['bitcoin']);
  const b = m.get('bitcoin');
  assert.equal(b.sym, 'BTC');
  assert.deepEqual(b.ch, { '1d': 1.5, '7d': -2, '30d': 9 });
  assert.equal(b.spark.length, 3);
  assert.equal(b.spark[2][1], 50000, 'the last point is the price in the currency asked');
  assert.ok(Math.abs(b.spark[0][1] - 49090.9) < 1, 'earlier points keep their shape');
  assert.equal(b.spark[2][0], Date.parse('2026-10-14T10:00:00.000Z'));
  assert.throws(() => parseMarkets('<html>'), DataError);
});

test('parseChart, thin: at most 90 points, first and last kept', () => {
  const pts = Array.from({ length: 721 }, (_, i) => [i * 3600_000, 100 + i]);
  const c = parseChart(JSON.stringify({ prices: [...pts, ['x', 1]] }));
  assert.equal(c.length, 90);
  assert.deepEqual(c[0], [0, 100]);
  assert.deepEqual(c[89], [720 * 3600_000, 820]);
  assert.deepEqual(thin([1, 2], 5), [1, 2]);
});

test('parseEvent: live minute, half time, final, postponed, crests only from ESPN\'s own image host', () => {
  const ev = (state, name, extra = {}) => ({
    id: '401', date: '2026-10-14T19:00Z',
    competitions: [{
      status: { displayClock: "67'", type: { state, name, shortDetail: state === 'post' ? 'FT' : name === 'STATUS_HALFTIME' ? 'HT' : "67'" } },
      competitors: [
        { homeAway: 'away', score: { displayValue: '1', value: 1 }, team: { id: '83', shortDisplayName: 'Barcelona', abbreviation: 'BAR', color: 'A50044', logos: [{ href: 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png' }] } },
        { homeAway: 'home', winner: true, score: '2', team: { id: '86', displayName: 'Real Madrid', abbreviation: 'RMA', logo: 'https://evil.example/x.png' } },
      ],
      ...extra,
    }],
  });
  const live = parseEvent(ev('in', 'STATUS_IN_PROGRESS'));
  assert.equal(live.st, 'in');
  assert.equal(live.clk, "67'");
  assert.equal(live.home.n, 'Real Madrid', 'home is the home side whatever the order');
  assert.equal(live.home.sc, '2');
  assert.equal(live.away.sc, '1');
  assert.equal(live.away.c, '#a50044');
  assert.equal(live.home.logo, null, 'a crest on another host is dropped');
  assert.match(live.away.logo, /^\/combiner\/i\?img=%2Fi%2Fteamlogos%2Fsoccer%2F500%2F83\.png&w=96&h=96$/);
  const ht = parseEvent(ev('in', 'STATUS_HALFTIME'));
  assert.equal(ht.clk, 'HT');
  assert.equal(ht.half, true);
  assert.equal(parseEvent(ev('post', 'STATUS_FULL_TIME')).clk, 'FT');
  assert.equal(parseEvent(ev('pre', 'STATUS_POSTPONED')).note, 'postponed');
  assert.equal(parseEvent({ id: '1', competitions: [{ competitors: [] }] }), null);
  // a basketball clock as ESPN writes it
  const nba = parseEvents(JSON.stringify(fakeScoreboard('nba', Date.now())), 'basketball');
  assert.equal(nba.find((e) => e.st === 'in').clk, 'Q4 6:12');
});

test('crestPath and crestToken: a.espncdn.com logo paths only, no way up the tree', () => {
  assert.equal(crestPath('https://a.espncdn.com/i/teamlogos/../../etc.png'), null);
  assert.equal(crestPath('http://a.espncdn.com/i/teamlogos/soccer/500/1.png'), null);
  assert.equal(crestPath('https://a.espncdn.com.evil.net/i/teamlogos/soccer/500/1.png'), null);
  assert.equal(crestPath('https://a.espncdn.com/i/teamlogos/soccer/500/1.svg'), null);
  assert.equal(crestPath(42), null);
  const p = crestPath('https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/mia.png');
  assert.ok(p);
  assert.match(crestToken(p), /^[0-9a-f]{16}$/);
  assert.notEqual(crestToken(p), crestToken(`${p}x`));
});

test('parseTeams, parseQuote', () => {
  assert.deepEqual(parseTeams(JSON.stringify({ sports: [{ leagues: [{ teams: [{ team: { id: '2', displayName: 'Zeta', abbreviation: 'ZET' } }, { team: { id: 'x', displayName: 'Bad' } }, { team: { id: '1', displayName: 'Alfa', abbreviation: 'ALF' } }] }] }] })), [
    { id: '1', name: 'Alfa', abbr: 'ALF' }, { id: '2', name: 'Zeta', abbr: 'ZET' },
  ]);
  assert.deepEqual(parseQuote('{"c":228.4,"dp":0.84,"pc":226.5,"t":1792000000}'), { price: 228.4, ch: 0.84, prev: 226.5, t: 1792000000000 });
  assert.equal(parseQuote('{"c":0,"d":null,"dp":null,"t":0}'), null, 'a symbol Finnhub does not know');
});

test('sportsTtl: a minute while a game is on or about to start, 15 minutes otherwise, earlier before a start', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(sportsTtl([{ st: 'in', t: now - 30 * MIN }], now), MIN);
  assert.equal(sportsTtl([{ st: 'pre', t: now + 10 * MIN }], now), MIN);
  assert.equal(sportsTtl([{ st: 'post', t: now - 2 * 60 * MIN }], now), 5 * MIN);
  assert.equal(sportsTtl([{ st: 'pre', t: now + 3 * 24 * 60 * MIN }], now), 15 * MIN);
  assert.equal(sportsTtl([{ st: 'pre', t: now + 18 * MIN }], now), 8 * MIN, 'wakes up 10 minutes before a start');
  assert.equal(sportsTtl([{ st: 'pre', t: now + 10.5 * MIN }], now), MIN, 'never under a minute');
  assert.equal(sportsTtl([], now), 15 * MIN);
});

test('pickGames: a team shows its live game, else its last result and next game; a league what is on, then next', () => {
  const now = 1_000_000_000_000;
  const g = (id, st, t, home = '86', away = '83') => ({ id, st, t, home: { id: home }, away: { id: away } });
  const ev = [g('a', 'post', now - 7e8), g('b', 'post', now - 3e8), g('c', 'pre', now + 3e8), g('d', 'pre', now + 9e8), g('x', 'post', now - 1e8, '1', '2')];
  assert.deepEqual(pickGames({ type: 'team', team: '86' }, ev, 'auto', 4, now).map((x) => x.id), ['b', 'c']);
  assert.deepEqual(pickGames({ type: 'team', team: '86' }, [...ev, g('l', 'in', now - 1e6)], 'auto', 4, now).map((x) => x.id), ['l']);
  assert.deepEqual(pickGames({ type: 'team', team: '86' }, ev, 'last', 4, now).map((x) => x.id), ['b', 'a']);
  assert.deepEqual(pickGames({ type: 'team', team: '86' }, ev, 'next', 1, now).map((x) => x.id), ['c']);
  assert.deepEqual(pickGames({ type: 'league' }, ev, 'auto', 3, now).map((x) => x.id), ['c', 'd', 'x']);
});

// ---- the hub -----------------------------------------------------------------------------------------------------

function hubWith(opts = {}) {
  let t = Date.parse('2026-10-14T12:00:00Z');
  const calls = [];
  const fail = {};
  const fake = fakeDataCall({ calls, now: () => t, fail });
  const hub = createDataHub({ call: opts.call ?? fake, now: () => t, stocksKey: () => opts.key ?? FAKE_STOCKS_KEY });
  return { hub, calls, fail, now: () => t, step: (ms) => { t += ms; } };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

test('one upstream call per key per interval, however many screens ask', async () => {
  const { hub, calls, step } = hubWith();
  const item = { kind: 'market', props: { coins: [{ id: 'bitcoin', currency: 'eur' }, { id: 'ethereum', currency: 'eur' }], range: '7d', chart: 'area' } };
  await Promise.all(Array.from({ length: 20 }, () => dataForItem(hub, item)));
  assert.equal(calls.length, 1, 'twenty screens at once: one call');
  assert.match(calls[0].path, /ids=bitcoin%2Cethereum&/);
  step(59_000);
  await dataForItem(hub, item);
  assert.equal(calls.length, 1, 'inside the interval: from the cache');
  step(62_000);
  const d = await dataForItem(hub, item);
  assert.ok(d.coins[0].price > 0, 'a due entry answers at once with what it has');
  await settle();
  assert.equal(calls.length, 2, 'and is asked again behind');
});

test('a coin another card asks for joins the same call; a new coin is fetched within 15 s', async () => {
  const { hub, calls, step } = hubWith();
  await dataForItem(hub, { kind: 'market', props: { coins: [{ id: 'bitcoin', currency: 'eur' }] } });
  step(5000);
  const d = await dataForItem(hub, { kind: 'market', props: { coins: [{ id: 'solana', currency: 'eur' }] } });
  assert.equal(calls.length, 1, 'under 15 s: not asked again');
  assert.equal(d.coins[0].price, null);
  step(11_000);
  const d2 = await dataForItem(hub, { kind: 'market', props: { coins: [{ id: 'solana', currency: 'eur' }] } });
  assert.equal(calls.length, 2);
  assert.match(calls[1].path, /ids=bitcoin%2Csolana&/, 'one call for every coin wanted in that currency');
  assert.ok(d2.coins[0].price > 100);
  // another currency is another call
  await dataForItem(hub, { kind: 'market', props: { coins: [{ id: 'bitcoin', currency: 'usd' }] } });
  assert.match(calls[2].path, /vs_currency=usd/);
});

test('a coin CoinGecko does not know waits for the normal refresh, not 15 s', async () => {
  const { hub, calls, step } = hubWith();
  const item = { kind: 'market', props: { coins: [{ id: 'bitcoin', currency: 'eur' }, { id: 'not-a-real-coin', currency: 'eur' }] } };
  await dataForItem(hub, item);
  assert.equal(calls.length, 1);
  for (let i = 0; i < 6; i++) {
    step(16_000);
    await dataForItem(hub, item);
  }
  assert.equal(calls.length, 1, 'asked for once already: no call every 15 s');
  step(30_000);
  await dataForItem(hub, item);
  await settle();
  assert.equal(calls.length, 2, 'the normal two minute refresh');
});

test('stale while error: the last good numbers stay, marked, and the failing source is backed off', async () => {
  const { hub, calls, fail, step } = hubWith();
  const item = { kind: 'market', props: { coins: [{ id: 'bitcoin', currency: 'eur' }], range: '1d' } };
  const ok = await dataForItem(hub, item);
  assert.equal(ok.stale, false);
  fail[DATA_HOSTS.coingecko] = 500;
  step(3 * MIN);
  await dataForItem(hub, item);
  await settle();
  const after = await dataForItem(hub, item);
  assert.equal(after.coins[0].price, ok.coins[0].price, 'kept');
  assert.equal(after.stale, true);
  assert.equal(after.error, 'bad_response');
  assert.ok(after.age >= 180);
  const n = calls.length;
  step(MIN);
  await dataForItem(hub, item);
  await settle();
  assert.equal(calls.length, n, 'backed off (2 minutes after the first failure)');
  delete fail[DATA_HOSTS.coingecko];
  step(2 * MIN);
  await dataForItem(hub, item);
  await settle();
  const back = await dataForItem(hub, item);
  assert.equal(back.stale, false);
  assert.equal(back.error, undefined);
});

test('a 429 is honoured for its Retry-After on the whole host', async () => {
  const { hub, calls, fail, step } = hubWith();
  fail[DATA_HOSTS.coingecko] = 429;
  const first = await dataForItem(hub, { kind: 'market', props: { coins: [{ id: 'bitcoin', currency: 'eur' }] } });
  assert.equal(first.error, 'rate_limited');
  assert.equal(first.coins[0].price, null);
  delete fail[DATA_HOSTS.coingecko];
  step(30_000);
  await dataForItem(hub, { kind: 'market', props: { coins: [{ id: 'ethereum', currency: 'usd' }] } });
  assert.equal(calls.length, 1, 'no call to the host before Retry-After (90 s) is over');
  step(70_000);
  const d = await dataForItem(hub, { kind: 'market', props: { coins: [{ id: 'ethereum', currency: 'usd' }] } });
  assert.ok(d.coins[0].price > 0);
});

test('only the allowed hosts are ever asked', async () => {
  const { hub } = hubWith();
  await assert.rejects(hub.get({ host: 'evil.example', path: '/' }), (e) => e.code === 'host');
  await assert.rejects(hub.get({ host: '127.0.0.1', path: '/' }), (e) => e.code === 'host');
});

test('sports: a team in its league (results, fixtures and the live round), a league, crests as tokens', async () => {
  const { hub, calls, step } = hubWith();
  const item = { kind: 'sports', props: { follow: [{ type: 'team', league: 'esp.1', team: '86', name: '' }, { type: 'league', league: 'nba', name: '' }], show: 'auto', max: 6 } };
  const d = await dataForItem(hub, item);
  assert.equal(d.groups.length, 2);
  assert.equal(d.groups[0].label, 'Real Madrid', 'the team\'s own name');
  assert.equal(d.groups[0].games.length, 1, 'a live game is all a team shows');
  assert.equal(d.groups[0].games[0].st, 'in');
  assert.equal(d.groups[1].lg, 'NBA');
  const text = JSON.stringify(d);
  assert.equal(text.includes('espncdn'), false, 'no image address reaches a screen');
  assert.match(d.groups[0].games[0].home.cr, /^[0-9a-f]{16}$/);
  assert.ok(hub.crest(d.groups[0].games[0].home.cr).startsWith('/combiner/i?img='));
  assert.equal(hub.crest('0000000000000000'), null);
  const n = calls.length;
  assert.equal(n, 4, 'scoreboard, results and fixtures of the team, the NBA scoreboard');
  // a game is on: the scoreboards are asked again after a minute, the results and fixtures much later
  step(61_000);
  await dataForItem(hub, item);
  await settle();
  assert.deepEqual(calls.slice(n).map((c) => c.path.split('/').slice(-2).join('/')).sort(), ['esp.1/scoreboard', 'nba/scoreboard']);
});

test('stocks: no key, no call and a note; with the key, quotes and the curve from what was read', async () => {
  const none = hubWith({ key: '' });
  const d0 = await dataForItem(none.hub, { kind: 'stocks', props: { symbols: [{ sym: 'AAPL', name: 'Apple' }] } });
  assert.equal(d0.needsKey, true);
  assert.equal(none.calls.length, 0);
  const { hub, calls, step } = hubWith();
  const item = { kind: 'stocks', props: { symbols: [{ sym: 'AAPL', name: 'Apple' }, { sym: 'NOPE', name: '' }], sparkline: true } };
  const d = await dataForItem(hub, item);
  assert.equal(d.quotes[0].name, 'Apple');
  assert.ok(d.quotes[0].price > 200);
  assert.equal(d.quotes[0].ch, 0.84);
  assert.equal(d.quotes[1].price, null, 'an unknown symbol shows a dash');
  assert.equal(calls[0].headers['x-finnhub-token'], FAKE_STOCKS_KEY);
  assert.equal(calls[0].path.includes(FAKE_STOCKS_KEY), false, 'the key is never in a URL');
  for (let i = 0; i < 3; i++) {
    step(91_000);
    await dataForItem(hub, item);
    await settle();
  }
  const d2 = await dataForItem(hub, item);
  assert.ok(d2.quotes[0].pts.length >= 3, 'the curve grows with each new quote');
  assert.equal(JSON.stringify(d2).includes(FAKE_STOCKS_KEY), false);
  // a refused key
  const bad = hubWith({ key: 'wrongwrongwrong' });
  const d3 = await dataForItem(bad.hub, { kind: 'stocks', props: { symbols: [{ sym: 'AAPL' }] } });
  assert.equal(d3.needsKey, true);
  assert.equal(d3.error, 'key_refused');
});

// ---- the kinds ---------------------------------------------------------------------------------------------------

test('market, sports and stocks: on both editions, private, validated (bad ids out, lists capped)', () => {
  for (const k of ['market', 'sports', 'stocks']) {
    assert.equal(CANVAS_KINDS[k].cat, 'data');
    assert.ok(CLOUD_CANVAS_KINDS.includes(k), `${k} on Marco Cloud`);
    assert.equal(CANVAS_KINDS[k].private, true);
  }
  const c = collector();
  const m = CANVAS_KINDS.market.props(c, 'p', { coins: [{ id: 'bitcoin', currency: 'usd' }, { id: 'bitcoin', currency: 'usd' }, { id: '../x' }, { id: 'ethereum', currency: 'xxx' }, ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}` }))], range: '30d' }, {}, {});
  assert.deepEqual(m.coins.map((x) => `${x.id}:${x.currency}`), ['bitcoin:usd', 'ethereum:eur', 'c0:eur', 'c1:eur'], 'six at most, repeats and bad ids out');
  assert.ok(m.coins.length <= 6);
  assert.ok(c.errors.some((e) => e.includes('invalid coin id')));
  assert.ok(c.errors.some((e) => e.includes('too many items')));
  const s = CANVAS_KINDS.sports.props(c, 'p', { follow: [{ type: 'team', league: 'esp.1', team: '86' }, { type: 'team', league: 'esp.1', team: 'abc' }, { league: 'nowhere' }, { type: 'league', league: 'nba' }], max: 99 }, {}, {});
  assert.deepEqual(s.follow, [{ type: 'team', league: 'esp.1', team: '86', name: '' }, { type: 'league', league: 'nba', name: '' }]);
  assert.equal(s.max, 8);
  const st = CANVAS_KINDS.stocks.props(c, 'p', { symbols: [{ sym: 'aapl' }, { sym: 'AAPL' }, { sym: 'BAD SYMBOL' }, { sym: 'BRK.B', name: 'Berkshire' }] }, {}, {});
  assert.deepEqual(st.symbols, [{ sym: 'AAPL', name: '' }, { sym: 'BRK.B', name: 'Berkshire' }]);
  for (const k of ['market', 'sports', 'stocks']) {
    const d = collector();
    CANVAS_KINDS[k].props(d, 'p', canvasDefaults(k), {}, {});
    assert.deepEqual(d.errors, [], `${k} defaults are valid`);
  }
});

test('projection: the data cards are placeholders on a private screen; canvasDataItems skips hidden ones', () => {
  const it = (id, kind, x, extra = {}) => ({ id, kind, pos: { zone: 'main', x, y: 0, size: CANVAS_KINDS[kind].def }, style: defaultItemStyle(), props: canvasDefaults(kind), ...extra });
  const raw = { ...defaultCanvas(), items: [it('cv_mark0001', 'market', 0), it('cv_spor0001', 'sports', 3), it('cv_stoc0001', 'stocks', 0, { pos: { zone: 'main', x: 0, y: 4, size: 'w' }, hidden: true })] };
  const c = collector();
  const canvas = sanitizeCanvas(c, 'canvas', raw);
  assert.deepEqual(c.errors, []);
  const screen = { layout: { preset: 'canvas' }, screen: { orientation: 'auto' }, canvas };
  assert.deepEqual(canvasDataItems(screen).map((x) => x.id), ['cv_mark0001', 'cv_spor0001']);
  const open = projectCanvas(screen, {});
  assert.equal(open.items.find((x) => x.kind === 'market').props.coins[0].id, 'bitcoin');
  const priv = projectCanvas(screen, { isPrivate: true });
  assert.ok(priv.items.every((x) => x.disabled === 'privacy'));
  // Marco Cloud's kinds keep them
  assert.equal(sanitizeCanvas(collector(), 'canvas', raw, {}, { canvasKinds: CLOUD_CANVAS_KINDS }).items.length, 3);
});

// ---- routes ------------------------------------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const offline = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error(`offline test: ${url}`)));
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);

async function withApp(fn, { mutate = () => {}, secrets = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-data-'));
  globalThis.fetch = offline;
  const calls = [];
  const crestCalls = [];
  setDataFetch(fakeDataCall({ calls }), { crest: async (req) => (crestCalls.push(req), { status: 200, bytes: PNG }) });
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'private';
  const main = c.screens[0];
  main.layout.preset = 'canvas';
  const it = (id, kind, x, y, props = {}, extra = {}) => ({ id, kind, pos: { zone: 'main', x, y, size: CANVAS_KINDS[kind].def }, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra });
  main.canvas = {
    ...defaultCanvas(),
    items: [
      it('cv_mark0001', 'market', 0, 0, { coins: [{ id: 'bitcoin', sym: 'BTC', name: 'Bitcoin', currency: 'eur' }, { id: 'solana', sym: 'SOL', name: 'Solana', currency: 'eur' }] }),
      it('cv_spor0001', 'sports', 3, 0, { follow: [{ type: 'team', league: 'esp.1', team: '86', name: 'Madrid' }] }),
      it('cv_stoc0001', 'stocks', 0, 4, { symbols: [{ sym: 'AAPL', name: 'Apple' }] }),
      it('cv_mark0002', 'market', 7, 0, {}, { when: { src: 'value', key: 'show.crypto', op: 'eq', value: 'yes' } }),
      it('cv_mark0003', 'market', 9, 0, {}, { hidden: true }),
    ],
  };
  mutate(c);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false, ...secrets }));
  store.initStore(dir);
  _resetDisplays();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetPrivacy?.();
  setServerVersion('0.5.0');
  await ensurePassword();
  syncDisplayKeys();
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  const app = createApp({ version: '0.5.0', dist: path.join(dir, 'dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bodies = [];
  const call = async (method, url, { body, headers = {} } = {}) => {
    const r = await realFetch(base + url, { method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
    bodies.push(buf.toString('latin1'));
    return { status: r.status, json, buf, text: buf.toString('utf8'), headers: r.headers, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const key = () => listDisplayLinks().find((l) => l.slug === store.getConfig().screens[0].slug).key;
  const display = (url) => call('GET', url, { headers: { 'x-marco-key': key() } });
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  try {
    await fn({ call, display, login, calls, crestCalls, bodies, lines });
  } finally {
    for (const [k, f] of Object.entries(orig)) console[k] = f;
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
    setDataFetch();
  }
}

test('GET /api/display/data: the numbers of this screen\'s data items only, with a key', async () => {
  await withApp(async ({ call, display, calls }) => {
    assert.equal((await call('GET', '/api/display/data')).status, 401);
    const r = await display('/api/display/data');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.json.items).sort(), ['cv_mark0001', 'cv_spor0001', 'cv_stoc0001'], 'not the hidden card, not the one its condition hides');
    const m = r.json.items.cv_mark0001;
    assert.equal(m.kind, 'market');
    assert.deepEqual(m.coins.map((x) => x.sym), ['BTC', 'SOL']);
    assert.ok(m.coins[0].pts.length > 10);
    assert.equal(r.json.items.cv_spor0001.groups[0].label, 'Madrid');
    assert.equal(r.json.items.cv_stoc0001.needsKey, true, 'no key saved');
    assert.equal(r.text.includes('coingecko'), false);
    assert.equal(r.text.includes('espncdn'), false);
    // a second screen load: from the cache
    const n = calls.length;
    await display('/api/display/data');
    assert.equal(calls.length, n);
  });
});

test('a private screen gets no data and no crests', async () => {
  await withApp(async ({ call, display, login }) => {
    const r = await display('/api/display/data');
    const tok = r.json.items.cv_spor0001.groups[0].games[0].home.cr;
    const cookie = await login();
    const p = await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: [store.getConfig().screens[0].id] }, headers: { cookie } });
    assert.equal(p.status, 200, p.text);
    assert.equal((await display('/api/display/data')).status, 403);
    assert.equal((await display(`/api/display/data/crest/${tok}`)).status, 403);
    const cfg = (await display('/api/display/config')).json;
    assert.ok(cfg.canvas.items.every((i) => i.disabled === 'privacy'));
  });
});

test('crests: by a token a data answer handed out, an image only, from ESPN\'s image host', async () => {
  await withApp(async ({ display, crestCalls }) => {
    const r = await display('/api/display/data');
    const tok = r.json.items.cv_spor0001.groups[0].games[0].home.cr;
    const img = await display(`/api/display/data/crest/${tok}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(crestCalls[0].host, 'a.espncdn.com');
    assert.match(crestCalls[0].path, /^\/combiner\/i\?img=%2Fi%2Fteamlogos%2F/);
    await display(`/api/display/data/crest/${tok}`);
    assert.equal(crestCalls.length, 1, 'cached');
    assert.equal((await display('/api/display/data/crest/0123456789abcdef')).status, 404);
    assert.equal((await display('/api/display/data/crest/..%2F..%2Fetc')).status, 404);
  });
});

test('the builder\'s routes: session only; search, teams, preview through the same cache', async () => {
  await withApp(async ({ call, login, calls }) => {
    assert.equal((await call('GET', '/api/admin/data/coins?q=sol')).status, 401);
    assert.equal((await call('POST', '/api/admin/data/preview', { body: { items: [] } })).status, 401);
    const cookie = await login();
    const h = { cookie };
    const coins = await call('GET', '/api/admin/data/coins?q=sol', { headers: h });
    assert.deepEqual(coins.json.coins.map((x) => x.id), ['solana']);
    const leagues = await call('GET', '/api/admin/data/sports/leagues', { headers: h });
    assert.ok(leagues.json.leagues.some((l) => l.id === 'esp.1'));
    const teams = await call('GET', '/api/admin/data/sports/teams?league=esp.1&q=bet', { headers: h });
    assert.deepEqual(teams.json.teams.map((x) => x.name), ['Real Betis']);
    assert.equal((await call('GET', '/api/admin/data/sports/teams?league=../x', { headers: h })).status, 400);
    assert.equal((await call('GET', '/api/admin/data/stocks/symbols?q=app', { headers: h })).status, 409, 'no key yet');
    const pv = await call('POST', '/api/admin/data/preview', {
      headers: h,
      body: { items: [{ id: 'cv_new00001', kind: 'market', props: { coins: [{ id: 'ethereum', currency: 'usd' }, { id: '../../x' }] } }, { id: 'bad', kind: 'market', props: {} }, { id: 'cv_ha000001', kind: 'ha.tile', props: {} }] },
    });
    assert.equal(pv.status, 200, pv.text);
    assert.deepEqual(Object.keys(pv.json.items), ['cv_new00001']);
    assert.deepEqual(pv.json.items.cv_new00001.coins.map((x) => x.id), ['ethereum']);
    assert.ok(calls.every((c) => ['api.coingecko.com', 'site.api.espn.com', 'finnhub.io'].includes(c.host)));
  });
});

test('the Finnhub key: tried once, kept in secrets, never sent back, never to a display', async () => {
  await withApp(async ({ call, display, login, bodies, lines }) => {
    const cookie = await login();
    const h = { cookie };
    assert.deepEqual((await call('GET', '/api/admin/data/stocks/key', { headers: h })).json, { set: false, last4: '' });
    assert.equal((await call('PUT', '/api/admin/data/stocks/key', { headers: h, body: { key: 'wrongkeywrongkey' } })).status, 400, 'refused upstream: not kept');
    assert.equal((await call('PUT', '/api/admin/data/stocks/key', { headers: h, body: { key: 'bad key!' } })).status, 400);
    const put = await call('PUT', '/api/admin/data/stocks/key', { headers: h, body: { key: FAKE_STOCKS_KEY } });
    assert.equal(put.status, 200, put.text);
    assert.deepEqual(put.json, { set: true, last4: FAKE_STOCKS_KEY.slice(-4), checked: true });
    assert.equal(store.getSecrets().data.stocksKey, FAKE_STOCKS_KEY);
    const r = await display('/api/display/data');
    const q = r.json.items.cv_stoc0001;
    assert.equal(q.needsKey, undefined);
    assert.ok(q.quotes[0].price > 0);
    const syms = await call('GET', '/api/admin/data/stocks/symbols?q=nvid', { headers: h });
    assert.deepEqual(syms.json.symbols.map((x) => x.sym), ['NVDA']);
    for (const b of bodies) assert.equal(b.includes(FAKE_STOCKS_KEY), false, 'the key in an answer');
    for (const l of lines) assert.equal(l.includes(FAKE_STOCKS_KEY), false, 'the key in a log line');
    const del = await call('PUT', '/api/admin/data/stocks/key', { headers: h, body: { key: '' } });
    assert.deepEqual(del.json, { set: false, last4: '', checked: false });
  });
});

test('sports: a followed team is late only when an answer is past its own refresh (#22)', async () => {
  const MIN = 60_000;
  const now = Date.parse('2026-10-23T12:00:00Z');
  const hubAt = ({ sb, res, fix, error = null }) => ({
    now: () => now,
    scoreboard: async () => ({ value: [], at: now - sb, error }),
    results: async () => ({ value: [], at: now - res, error: null }),
    fixtures: async () => ({ value: [], at: now - fix, error: null }),
  });
  const item = { kind: 'sports', props: { follow: [{ type: 'team', league: 'eng.1', team: '359' }], show: 'auto', max: 4 } };
  // results asked hourly and fixtures every few hours: not late, though hours old
  const fresh = await dataForItem(hubAt({ sb: 5 * MIN, res: 50 * MIN, fix: 5 * 60 * MIN }), item, now);
  assert.equal(fresh.stale, false);
  assert.ok(fresh.age >= 5 * 60 * 60);
  // the scoreboard past its refresh, results past theirs, a failed call: late
  assert.equal((await dataForItem(hubAt({ sb: 40 * MIN, res: 5 * MIN, fix: 5 * MIN }), item, now)).stale, true);
  assert.equal((await dataForItem(hubAt({ sb: 5 * MIN, res: 2 * 60 * MIN, fix: 5 * MIN }), item, now)).stale, true);
  assert.equal((await dataForItem(hubAt({ sb: 1 * MIN, res: 1 * MIN, fix: 1 * MIN, error: 'fetch_failed' }), item, now)).stale, true);
});
