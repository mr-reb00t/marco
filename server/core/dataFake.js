// Made-up answers of the data card sources (CoinGecko, ESPN, Finnhub, Frankfurter) in their own shapes, for the tests, for
// MARCO_DATA_FAKE=1 (a server that never leaves the machine, for screenshots) and for Marco Cloud's own tests. The
// numbers are realistic but invented. `fakeDataCall(opts)` returns a `call` for createDataHub (core/dataCore.js).

const H = 3600_000;

/** Coins the fake CoinGecko knows: price in EUR, its 24 h / 7 d / 30 d change, and a USD rate. */
export const FAKE_COINS = {
  bitcoin: { sym: 'btc', name: 'Bitcoin', eur: 61250.4, ch: [1.84, -2.31, 6.12], rank: 1 },
  ethereum: { sym: 'eth', name: 'Ethereum', eur: 2412.75, ch: [-0.92, 3.05, -4.4], rank: 2 },
  solana: { sym: 'sol', name: 'Solana', eur: 138.42, ch: [4.12, 9.8, 15.3], rank: 5 },
  cardano: { sym: 'ada', name: 'Cardano', eur: 0.3521, ch: [-1.6, -5.2, -11.9], rank: 9 },
  ripple: { sym: 'xrp', name: 'XRP', eur: 0.5234, ch: [0.31, 1.1, 2.7], rank: 6 },
  dogecoin: { sym: 'doge', name: 'Dogecoin', eur: 0.1123, ch: [-3.4, 7.7, 21.2], rank: 8 },
};
const FX = { eur: 1, usd: 1.09, gbp: 0.84, chf: 0.95, dkk: 7.46, sek: 11.4, nok: 11.6, pln: 4.3, brl: 6.0, jpy: 162, cad: 1.48, aud: 1.63, btc: 1 / 61250.4 };

/** A wavy curve that ends at `end`: `n` points, deterministic per seed. */
function curve(seed, n, end, swing) {
  const out = [];
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) % 1000;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const w = Math.sin(x * 9 + s) * 0.5 + Math.sin(x * 23 + s / 7) * 0.25 + (x - 1) * 0.6;
    out.push(end * (1 + w * swing));
  }
  out[n - 1] = end;
  return out;
}

function markets(params, now) {
  const cur = params.get('vs_currency') || 'eur';
  const ids = (params.get('ids') || '').split(',').filter(Boolean);
  const k = FX[cur] ?? 1;
  return ids.filter((id) => FAKE_COINS[id]).map((id) => {
    const c = FAKE_COINS[id];
    const price = cur === 'btc' ? c.eur / 61250.4 : c.eur * k;
    return {
      id, symbol: c.sym, name: c.name, current_price: Number(price.toPrecision(6)), market_cap_rank: c.rank,
      price_change_percentage_24h: c.ch[0], price_change_percentage_24h_in_currency: c.ch[0], price_change_percentage_7d_in_currency: c.ch[1], price_change_percentage_30d_in_currency: c.ch[2],
      last_updated: new Date(now - 40_000).toISOString(),
      // in US dollars, as the real API sends it
      sparkline_in_7d: { price: curve(id, 168, c.eur * FX.usd, 0.06) },
    };
  });
}

function chart(id, params, now) {
  const c = FAKE_COINS[id];
  if (!c) return null;
  const k = FX[params.get('vs_currency') || 'eur'] ?? 1;
  const pts = curve(`${id}30`, 31, c.eur * k, 0.12);
  return { prices: pts.map((v, i) => [now - (30 - i) * 24 * H, v]) };
}

/** Teams of the fake leagues: [id, name, short, abbr, colour]. */
export const FAKE_TEAMS = {
  'esp.1': [['86', 'Real Madrid', 'Real Madrid', 'RMA', 'ffffff'], ['83', 'Barcelona', 'Barcelona', 'BAR', 'a50044'], ['1068', 'Atlético Madrid', 'Atlético', 'ATM', 'cb3524'], ['244', 'Real Betis', 'Betis', 'BET', '00954c'], ['243', 'Sevilla', 'Sevilla', 'SEV', 'd21e26'], ['94', 'Valencia', 'Valencia', 'VAL', 'ee3524']],
  'eng.1': [['359', 'Arsenal', 'Arsenal', 'ARS', 'ef0107'], ['382', 'Manchester City', 'Man City', 'MNC', '99c5ea'], ['364', 'Liverpool', 'Liverpool', 'LIV', 'c8102e'], ['363', 'Chelsea', 'Chelsea', 'CHE', '034694']],
  'uefa.champions': [['86', 'Real Madrid', 'Real Madrid', 'RMA', 'ffffff'], ['132', 'Bayern Munich', 'Bayern', 'BAY', 'dc052d'], ['359', 'Arsenal', 'Arsenal', 'ARS', 'ef0107'], ['160', 'Paris Saint-Germain', 'PSG', 'PSG', '004170']],
  nba: [['13', 'Los Angeles Lakers', 'Lakers', 'LAL', '552583'], ['2', 'Boston Celtics', 'Celtics', 'BOS', '008348'], ['9', 'Golden State Warriors', 'Warriors', 'GS', 'fdb927'], ['18', 'New York Knicks', 'Knicks', 'NY', 'f58426']],
};

const team = (league, t, home, score, winner) => ({
  homeAway: home ? 'home' : 'away', winner,
  score: score === null ? '0' : String(score),
  team: { id: t[0], displayName: t[1], shortDisplayName: t[2], abbreviation: t[3], color: t[4], logo: `https://a.espncdn.com/i/teamlogos/${league === 'nba' ? 'nba' : 'soccer'}/500/${t[0]}.png` },
});

function event(league, i, a, b, t, state, score = null, clock = '') {
  const done = state === 'post';
  const names = { pre: 'STATUS_SCHEDULED', in: clock === 'HT' ? 'STATUS_HALFTIME' : 'STATUS_IN_PROGRESS', post: 'STATUS_FULL_TIME' };
  return {
    id: `9${league.length}${i}${a[0]}${b[0]}`.slice(0, 15), date: new Date(t).toISOString().replace(/:\d\d\.\d{3}Z$/, 'Z'), name: `${b[1]} at ${a[1]}`,
    competitions: [{
      date: new Date(t).toISOString(),
      status: { displayClock: state === 'in' ? clock : "0'", type: { name: names[state], state, completed: done, shortDetail: state === 'post' ? (league === 'nba' ? 'Final' : 'FT') : state === 'in' ? (clock === 'HT' ? 'HT' : clock) : 'Scheduled' } },
      competitors: [team(league, a, true, score?.[0] ?? null, done && score[0] > score[1]), team(league, b, false, score?.[1] ?? null, done && score[1] > score[0])],
    }],
  };
}

/** A scoreboard round around `now`: one game live, some done, some to come. */
export function fakeScoreboard(league, now) {
  const T = FAKE_TEAMS[league] ?? FAKE_TEAMS['esp.1'];
  const day = Math.floor(now / (24 * H)) * 24 * H;
  if (league === 'nba') {
    return { events: [
      event(league, 1, T[0], T[1], now - 1.2 * H, 'in', [88, 91], 'Q4 6:12'),
      event(league, 2, T[2], T[3], day + 24 * H + 19.5 * H, 'pre'),
      event(league, 3, T[3], T[0], now - 22 * H, 'post', [104, 99]),
    ] };
  }
  return { events: [
    event(league, 1, T[0], T[3 % T.length], now - 0.9 * H, 'in', [2, 1], "67'"),
    event(league, 2, T[1], T[2], now - 26 * H, 'post', [1, 1]),
    event(league, 3, T[2 % T.length], T[1 % T.length], day + 44 * H, 'pre'),
    event(league, 4, T[3 % T.length], T[0], day + 3 * 24 * H + 19 * H, 'pre'),
  ] };
}

function schedule(league, id, fixture, now) {
  const T = FAKE_TEAMS[league] ?? FAKE_TEAMS['esp.1'];
  const me = T.find((t) => t[0] === id) ?? T[0];
  const others = T.filter((t) => t !== me);
  if (fixture) return { events: [event(league, 7, others[0], me, now + 3 * 24 * H, 'pre'), event(league, 8, me, others[1 % others.length], now + 10 * 24 * H, 'pre')] };
  return { events: [event(league, 5, me, others[1 % others.length], now - 7 * 24 * H, 'post', [3, 0]), event(league, 6, others[0], me, now - 4 * 24 * H, 'post', [2, 2])] };
}

/** Symbols the fake Finnhub knows: [price, change %, name]. */
export const FAKE_STOCKS = {
  AAPL: [228.42, 0.84, 'Apple Inc'], MSFT: [431.1, -0.37, 'Microsoft Corp'], NVDA: [131.65, 2.91, 'NVIDIA Corp'], AMZN: [187.3, 1.12, 'Amazon.com Inc'],
  GOOGL: [164.2, -1.05, 'Alphabet Inc'], TSLA: [219.8, -3.4, 'Tesla Inc'], SPY: [571.2, 0.42, 'SPDR S&P 500 ETF'], QQQ: [489.9, 0.77, 'Invesco QQQ Trust'],
};
export const FAKE_STOCKS_KEY = 'fakefinnhubkey0123456789';

/** Currencies the fake Frankfurter knows: units per euro on the last day, and their names (the ECB's set). */
export const FAKE_FX = {
  AUD: [1.6171, 'Australian Dollar'], BRL: [5.7197, 'Brazilian Real'], CAD: [1.5935, 'Canadian Dollar'], CHF: [0.9272, 'Swiss Franc'],
  CNY: [7.524, 'Chinese Renminbi Yuan'], CZK: [24.323, 'Czech Koruna'], DKK: [7.4748, 'Danish Krone'], GBP: [0.84385, 'British Pound'],
  HKD: [8.8316, 'Hong Kong Dollar'], HUF: [363.08, 'Hungarian Forint'], IDR: [20290.28, 'Indonesian Rupiah'], ILS: [3.4822, 'Israeli New Shekel'],
  INR: [106.864, 'Indian Rupee'], ISK: [136.2, 'Icelandic Króna'], JPY: [177.82, 'Japanese Yen'], KRW: [1499.01, 'South Korean Won'],
  MXN: [20.6871, 'Mexican Peso'], MYR: [4.5929, 'Malaysian Ringgit'], NOK: [10.624, 'Norwegian Krone'], NZD: [1.9868, 'New Zealand Dollar'],
  PHP: [70.858, 'Philippine Peso'], PLN: [4.37, 'Polish Złoty'], RON: [5.331, 'Romanian Leu'], SEK: [11.145, 'Swedish Krona'],
  SGD: [1.4395, 'Singapore Dollar'], THB: [37.602, 'Thai Baht'], TRY: [48.91, 'Turkish Lira'], USD: [1.1298, 'United States Dollar'],
  ZAR: [19.62, 'South African Rand'],
};

/** The working days (YYYY-MM-DD) from `from` to the last one published by `now` (the ECB's rates come at 15:00 UTC). */
function fxDays(from, now) {
  const out = [];
  const end = new Date(now - 15 * H);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end.getTime(); t += 24 * H) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** A currency's rate on a day: a slow wave and a small daily wobble around its last rate (the last day exactly it). */
function fxOn(code, day, last) {
  const [v] = FAKE_FX[code];
  if (day === last) return v;
  const d = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / (24 * H);
  const s = [...code].reduce((a, c) => a + c.charCodeAt(0), 0);
  const wave = (x) => Math.sin(x / 9 + s) * 0.012 + Math.sin(x / 47 + s / 3) * 0.025 + Math.sin(x * 1.7 + s) * 0.002;
  const w = wave(d) - wave(0);
  return Number((v * (1 + w)).toPrecision(6));
}

function fxRates(params, now) {
  const from = params.get('from') || new Date(now).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  const days = fxDays(from, now);
  const last = fxDays(new Date(now - 10 * 24 * H).toISOString().slice(0, 10), now).pop();
  // group=week: one point a week (as v2 does), the newest week's last day
  const pick = params.get('group') === 'week' ? days.filter((_, i) => (days.length - 1 - i) % 5 === 0) : days;
  const out = [];
  for (const day of pick) for (const code of Object.keys(FAKE_FX)) out.push({ date: day, base: 'EUR', quote: code, rate: fxOn(code, day, last) });
  return out;
}

/**
 * A `call` for createDataHub answering like the four sources. `opts.now()` the clock, `opts.fail` = host → status
 * (to test errors), `opts.calls` an array every request is pushed to, `opts.key` the Finnhub key it accepts.
 */
export function fakeDataCall(opts = {}) {
  const now = opts.now ?? (() => Date.now());
  const key = opts.key ?? FAKE_STOCKS_KEY;
  return async (req) => {
    opts.calls?.push(req);
    const fail = opts.fail?.[req.host];
    if (fail) return { status: fail, text: '{}', retryAfterMs: fail === 429 ? 90_000 : undefined };
    const u = new URL(`https://${req.host}${req.path}`);
    const p = u.pathname;
    const ok = (body) => ({ status: 200, text: JSON.stringify(body) });
    if (req.host === 'api.coingecko.com') {
      if (p === '/api/v3/coins/markets') return ok(markets(u.searchParams, now()));
      if (p === '/api/v3/search') {
        const s = (u.searchParams.get('query') || '').toLowerCase();
        return ok({ coins: Object.entries(FAKE_COINS).filter(([id, c]) => id.includes(s) || c.sym.includes(s) || c.name.toLowerCase().includes(s)).map(([id, c]) => ({ id, symbol: c.sym.toUpperCase(), name: c.name, market_cap_rank: c.rank })) });
      }
      const m = /^\/api\/v3\/coins\/([a-z0-9-]+)\/market_chart$/.exec(p);
      const c = m ? chart(m[1], u.searchParams, now()) : null;
      return c ? ok(c) : { status: 404, text: '{"error":"coin not found"}' };
    }
    if (req.host === 'site.api.espn.com') {
      const m = /^\/apis\/site\/v2\/sports\/[a-z]+\/([a-z0-9._]+)\/(scoreboard|teams)(?:\/(\d+)\/schedule)?$/.exec(p);
      if (!m) return { status: 404, text: '{}' };
      const [, league, what, id] = m;
      if (what === 'scoreboard') return ok(fakeScoreboard(league, now()));
      if (!id) return ok({ sports: [{ leagues: [{ teams: (FAKE_TEAMS[league] ?? []).map((t) => ({ team: { id: t[0], displayName: t[1], abbreviation: t[3] } })) }] }] });
      return ok(schedule(league, id, u.searchParams.get('fixture') === 'true', now()));
    }
    if (req.host === 'finnhub.io') {
      if (req.headers?.['x-finnhub-token'] !== key) return { status: 401, text: '{"error":"Invalid API key."}' };
      if (p === '/api/v1/quote') {
        const s = FAKE_STOCKS[u.searchParams.get('symbol') || ''];
        if (!s) return ok({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 });
        const wobble = Math.sin(now() / 600_000) * s[0] * 0.002;
        const c = Number((s[0] + wobble).toFixed(2));
        return ok({ c, d: Number(((c * s[1]) / 100).toFixed(2)), dp: s[1], h: c * 1.01, l: c * 0.99, o: s[0], pc: Number((c / (1 + s[1] / 100)).toFixed(2)), t: Math.floor((now() - 60_000) / 1000) });
      }
      if (p === '/api/v1/search') {
        const s = (u.searchParams.get('q') || '').toUpperCase();
        return ok({ count: 1, result: Object.entries(FAKE_STOCKS).filter(([k, v]) => k.includes(s) || v[2].toUpperCase().includes(s)).map(([k, v]) => ({ symbol: k, displaySymbol: k, description: v[2].toUpperCase(), type: 'Common Stock' })) });
      }
      return { status: 404, text: '{}' };
    }
    if (req.host === 'api.frankfurter.dev') {
      if (p === '/v2/rates') {
        const r = fxRates(u.searchParams, now());
        return r ? ok(r) : { status: 422, text: '{"message":"bad date"}' };
      }
      if (p === '/v2/currencies') {
        const end = new Date(now()).toISOString().slice(0, 10);
        return ok([{ iso_code: 'EUR', name: 'Euro', end_date: end }, { iso_code: 'HRK', name: 'Croatian Kuna', end_date: '2022-12-30' }, ...Object.entries(FAKE_FX).map(([c, [, n]]) => ({ iso_code: c, name: n, end_date: end }))]);
      }
      return { status: 404, text: '{}' };
    }
    // crests: not drawn by the fake (the card falls back to the team's colour and initials)
    return { status: 404, text: '' };
  };
}
