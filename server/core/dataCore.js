// Data cards of Personalizado (palette "Datos"): crypto prices (market), sports results (sports), stock quotes
// (stocks) and exchange rates (currency). The pure part, shared by the self-hosted server (server/dataFeeds.js) and Marco Cloud: which hosts may be
// asked, how each request is built, how each answer is read, how long it is kept, and what a screen gets. No network,
// no files, no timers: callers pass `call` (one GET to an allowed host), `now` and `sleep`.
//
// Sources (checked 2026-10):
// - CoinGecko public API (api.coingecko.com/api/v3, no key). One /coins/markets call per currency for every coin the
//   screens show (price, 24 h / 7 d / 30 d change and a 7 day hourly sparkline), and /coins/{id}/market_chart for the
//   30 day chart. The keyless tier allows a handful of calls a minute, so markets are asked every 2 minutes at most
//   and calls to the host are spaced out. The 7 day sparkline comes in US dollars whatever the currency: its shape is
//   scaled to the price in the card's currency (the price and the change are exact, the curve is close).
// - ESPN's public site API (site.api.espn.com/apis/site/v2/sports, no key). It is not documented or promised by ESPN:
//   it has worked for years and is what ESPN's own pages use, but it may change without notice. Marco reads the league
//   scoreboard (the current round, with live scores), a team's results (/teams/{id}/schedule) and fixtures
//   (?fixture=true), and the teams of a league for the picker. A team is followed in one competition: to see a club in
//   its league and in the Champions League, add it once for each. Crests come from a.espncdn.com through this server.
// - Finnhub (finnhub.io/api/v1, a free API key). There is no reliable keyless source for stock quotes: Stooq now
//   answers its CSV links with a browser check and Yahoo's chart endpoint is unofficial. Finnhub's free plan allows 60
//   calls a minute and covers US listed shares and ETFs; its free plan has no price history, so the optional curve is
//   drawn from the quotes this server has read since it started (up to the last 24 hours). The free plan has no forex
//   either: a symbol it does not know answers all zeros and a paid one 403, so such a quote is "no data", never a
//   refused key (only a 401 is).
// - Frankfurter (api.frankfurter.dev/v2, no key), the European Central Bank's reference rates (providers=ECB): about
//   30 currencies against the euro, published once per working day around 16:00 CET. Every pair is worked out
//   through the euro (EUR/HUF, USD/MXN = MXN per euro / USD per euro), so one call with every currency serves every
//   pair of every screen: the last five weeks day by day (the rate, the change since the working day before, the 7
//   and 30 day curves) every few hours, and a year week by week only for a 1 year curve.
//
// Every request goes to one of DATA_HOSTS with a path built here from validated ids (no URL ever comes from a
// screen's config), and a display only ever gets the numbers of the items on its screen (dataForItem).

// ---- hosts and limits ---------------------------------------------------------------------------------------------

/** The only hosts the data cards ever ask. */
export const DATA_HOSTS = Object.freeze({
  coingecko: 'api.coingecko.com',
  espn: 'site.api.espn.com',
  espnImg: 'a.espncdn.com',
  finnhub: 'finnhub.io',
  frankfurter: 'api.frankfurter.dev',
});
export const DATA_HOST_LIST = Object.freeze(Object.values(DATA_HOSTS));

/** Spacing between two calls to the same host (ms), so a busy server never bursts. */
export const HOST_GAP_MS = { 'api.coingecko.com': 2500, 'site.api.espn.com': 300, 'a.espncdn.com': 100, 'finnhub.io': 1100, 'api.frankfurter.dev': 1000 };
/** Answers larger than this are refused (an ESPN scoreboard is ~100 KB, a 30 day chart ~40 KB). */
export const DATA_MAX_BYTES = 1024 * 1024;
export const CREST_MAX_BYTES = 256 * 1024;
export const DATA_TIMEOUT_MS = 10_000;
/** No key is asked upstream more often than this, whoever asks. */
export const DATA_MIN_TTL_MS = 60_000;

const MIN = 60_000;
const HOUR = 60 * MIN;

/** How long each kind of answer is kept before it is asked again (ms). Sports scoreboards: sportsTtl. */
export const DATA_TTL = {
  markets: 2 * MIN,
  chart30: 6 * HOUR,
  coinSearch: 24 * HOUR,
  sportsIdle: 15 * MIN,
  sportsLive: MIN,
  results: HOUR,
  fixtures: 6 * HOUR,
  teams: 24 * HOUR,
  quoteOpen: 90_000,
  quoteClosed: 15 * MIN,
  symbolSearch: 24 * HOUR,
  /** exchange rates: a few times a day, every half hour while the day's rates are due (fxTtl) */
  fx: 4 * HOUR,
  fxDue: 30 * MIN,
  fxYear: 12 * HOUR,
  fxCurrencies: 24 * HOUR,
};

// ---- ids --------------------------------------------------------------------------------------------------------

/** Currencies a coin's price can be shown in (CoinGecko vs_currency). */
export const MARKET_CURRENCIES = ['eur', 'usd', 'gbp', 'chf', 'dkk', 'sek', 'nok', 'pln', 'brl', 'jpy', 'cad', 'aud', 'btc'];
export const MARKET_RANGES = ['1d', '7d', '30d'];
export const COIN_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const TEAM_ID_RE = /^\d{1,8}$/;
/** A Finnhub symbol: AAPL, BRK.B, VWCE.DE, BINANCE:BTCUSDT. */
export const STOCK_SYMBOL_RE = /^[A-Z0-9][A-Z0-9.:_-]{0,23}$/;
/** A currency of the exchange rates card: an ISO 4217 code. */
export const FX_CODE_RE = /^[A-Z]{3}$/;
/** Every rate is asked against this one currency, and a pair is worked out through it. */
export const FX_BASE = 'EUR';
/**
 * The ECB's reference currencies (checked 2026-10): what the builder offers when the source's own list cannot be
 * read, and what a symbol must be made of to look like a currency pair. The source's list wins when it is there.
 */
export const FX_CURRENCIES = ['AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR'];
export const CURRENCY_RANGES = ['7d', '30d', '1y'];
/** A Finnhub API key as the admin may save it. */
export const STOCKS_KEY_RE = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * Competitions the sports card can follow (ESPN's slugs). `sport` is the path part, `short` what the card shows.
 * Football first; a few other sports where ESPN has them on the same endpoints.
 */
export const SPORTS_LEAGUES = [
  { id: 'esp.1', sport: 'soccer', name: 'LaLiga', short: 'LaLiga' },
  { id: 'esp.2', sport: 'soccer', name: 'LaLiga Hypermotion', short: 'LaLiga 2' },
  { id: 'esp.copa_del_rey', sport: 'soccer', name: 'Copa del Rey', short: 'Copa' },
  { id: 'eng.1', sport: 'soccer', name: 'Premier League', short: 'Premier' },
  { id: 'eng.2', sport: 'soccer', name: 'Championship', short: 'Championship' },
  { id: 'eng.fa', sport: 'soccer', name: 'FA Cup', short: 'FA Cup' },
  { id: 'ita.1', sport: 'soccer', name: 'Serie A', short: 'Serie A' },
  { id: 'ger.1', sport: 'soccer', name: 'Bundesliga', short: 'Bundesliga' },
  { id: 'fra.1', sport: 'soccer', name: 'Ligue 1', short: 'Ligue 1' },
  { id: 'por.1', sport: 'soccer', name: 'Liga Portugal', short: 'Liga PT' },
  { id: 'ned.1', sport: 'soccer', name: 'Eredivisie', short: 'Eredivisie' },
  { id: 'den.1', sport: 'soccer', name: 'Superliga', short: 'Superliga' },
  { id: 'bra.1', sport: 'soccer', name: 'Brasileirão', short: 'Brasileirão' },
  { id: 'usa.1', sport: 'soccer', name: 'MLS', short: 'MLS' },
  { id: 'uefa.champions', sport: 'soccer', name: 'Champions League', short: 'Champions' },
  { id: 'uefa.europa', sport: 'soccer', name: 'Europa League', short: 'Europa' },
  { id: 'uefa.europa.conf', sport: 'soccer', name: 'Conference League', short: 'Conference' },
  { id: 'uefa.nations', sport: 'soccer', name: 'Nations League', short: 'Nations' },
  { id: 'fifa.world', sport: 'soccer', name: 'World Cup', short: 'Mundial' },
  { id: 'nba', sport: 'basketball', name: 'NBA', short: 'NBA' },
  { id: 'wnba', sport: 'basketball', name: 'WNBA', short: 'WNBA' },
  { id: 'nfl', sport: 'football', name: 'NFL', short: 'NFL' },
  { id: 'nhl', sport: 'hockey', name: 'NHL', short: 'NHL' },
  { id: 'mlb', sport: 'baseball', name: 'MLB', short: 'MLB' },
];
const LEAGUES = new Map(SPORTS_LEAGUES.map((l) => [l.id, l]));
export const sportsLeague = (id) => LEAGUES.get(id) ?? null;

/** Limits of each card. */
export const DATA_LIMITS = { coins: 6, follow: 4, games: 8, symbols: 12, pairs: 6, chartPoints: 90, searchResults: 12 };

// ---- requests ---------------------------------------------------------------------------------------------------

const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

/** Price, changes and the 7 day sparkline of up to 250 coins in one currency. */
export function marketsRequest(currency, ids) {
  return { host: DATA_HOSTS.coingecko, path: `/api/v3/coins/markets?${q({ vs_currency: currency, ids: ids.join(','), sparkline: 'true', price_change_percentage: '24h,7d,30d', per_page: 250 })}` };
}
export const chartRequest = (id, currency) => ({ host: DATA_HOSTS.coingecko, path: `/api/v3/coins/${encodeURIComponent(id)}/market_chart?${q({ vs_currency: currency, days: 30, interval: 'daily' })}` });
export const coinSearchRequest = (text) => ({ host: DATA_HOSTS.coingecko, path: `/api/v3/search?${q({ query: text })}` });

const espnBase = (l) => `/apis/site/v2/sports/${l.sport}/${l.id}`;
export const scoreboardRequest = (l) => ({ host: DATA_HOSTS.espn, path: `${espnBase(l)}/scoreboard` });
export const resultsRequest = (l, team) => ({ host: DATA_HOSTS.espn, path: `${espnBase(l)}/teams/${team}/schedule` });
export const fixturesRequest = (l, team) => ({ host: DATA_HOSTS.espn, path: `${espnBase(l)}/teams/${team}/schedule?fixture=true` });
export const teamsRequest = (l) => ({ host: DATA_HOSTS.espn, path: `${espnBase(l)}/teams` });

/** Finnhub: the key goes in a header (never in a URL, so it is in no log line). */
export const quoteRequest = (sym, key) => ({ host: DATA_HOSTS.finnhub, path: `/api/v1/quote?${q({ symbol: sym })}`, headers: { 'x-finnhub-token': key } });
export const symbolSearchRequest = (text, key) => ({ host: DATA_HOSTS.finnhub, path: `/api/v1/search?${q({ q: text })}`, headers: { 'x-finnhub-token': key } });

/** A day as YYYY-MM-DD in UTC, `days` before `now`. */
const dayIso = (now, days = 0) => new Date(now - days * 24 * HOUR).toISOString().slice(0, 10);
/** Frankfurter: the ECB's rates against the euro, every currency, day by day from five weeks back. */
export const fxMonthRequest = (now) => ({ host: DATA_HOSTS.frankfurter, path: `/v2/rates?${q({ providers: 'ECB', base: FX_BASE, from: dayIso(now, 36) })}` });
/** A year of them, one point a week (for the 1 year curve only). */
export const fxYearRequest = (now) => ({ host: DATA_HOSTS.frankfurter, path: `/v2/rates?${q({ providers: 'ECB', base: FX_BASE, from: dayIso(now, 366), group: 'week' })}` });
export const fxCurrenciesRequest = () => ({ host: DATA_HOSTS.frankfurter, path: `/v2/currencies?${q({ providers: 'ECB' })}` });

// ---- reading answers ----------------------------------------------------------------------------------------------

export class DataError extends Error {
  /**
   * `code`: fetch_failed, timeout, rate_limited, bad_response, too_large, not_found, no_key, key_refused, no_access
   * (Finnhub: the key works, this symbol is not on its plan), host
   */
  constructor(code, detail = '', retryMs = null) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.retryMs = retryMs;
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, max = 60) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError('bad_response', 'not JSON');
  }
}

/** Evenly spaced points down to `n` (the first and the last kept). */
export function thin(points, n) {
  if (points.length <= n) return points;
  const out = [];
  for (let i = 0; i < n; i++) out.push(points[Math.round((i * (points.length - 1)) / (n - 1))]);
  return out;
}

/** Few significant digits for a chart point (a sparkline needs no more). */
const sig = (v) => (v === 0 ? 0 : Number(v.toPrecision(5)));

/**
 * CoinGecko /coins/markets → Map id → { id, sym, name, price, ch: { '1d', '7d', '30d' }, spark: [[t, v]] (hourly, 7
 * days, in the currency asked), at }. Coins without a price are left out.
 */
export function parseMarkets(text) {
  const d = json(text);
  if (!Array.isArray(d)) throw new DataError('bad_response', 'not a list');
  const out = new Map();
  for (const c of d) {
    if (!isObj(c) || typeof c.id !== 'string' || !COIN_ID_RE.test(c.id)) continue;
    const price = num(c.current_price);
    if (price === null) continue;
    const at = Date.parse(c.last_updated) || 0;
    let spark = [];
    const raw = Array.isArray(c.sparkline_in_7d?.price) ? c.sparkline_in_7d.price.map(num).filter((v) => v !== null && v > 0) : [];
    if (raw.length >= 2) {
      // the sparkline is in US dollars: scaled so its last point is the price in this currency
      const k = price / raw[raw.length - 1];
      const end = at || 0;
      const step = (7 * 24 * HOUR) / (raw.length - 1);
      spark = raw.map((v, i) => [Math.round(end - (raw.length - 1 - i) * step), sig(v * k)]);
    }
    out.set(c.id, {
      id: c.id,
      sym: str(c.symbol, 12).toUpperCase(),
      name: str(c.name, 40),
      price,
      ch: { '1d': num(c.price_change_percentage_24h_in_currency) ?? num(c.price_change_percentage_24h), '7d': num(c.price_change_percentage_7d_in_currency), '30d': num(c.price_change_percentage_30d_in_currency) },
      spark,
      at,
    });
  }
  return out;
}

/** CoinGecko /market_chart → [[t, v]], at most DATA_LIMITS.chartPoints. */
export function parseChart(text) {
  const d = json(text);
  if (!isObj(d) || !Array.isArray(d.prices)) throw new DataError('bad_response', 'no prices');
  const pts = d.prices.filter((p) => Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null).map((p) => [num(p[0]), sig(num(p[1]))]);
  return thin(pts, DATA_LIMITS.chartPoints);
}

/** CoinGecko /search → [{ id, sym, name, rank }], at most DATA_LIMITS.searchResults. */
export function parseCoinSearch(text) {
  const d = json(text);
  const list = Array.isArray(d?.coins) ? d.coins : [];
  return list
    .filter((c) => isObj(c) && typeof c.id === 'string' && COIN_ID_RE.test(c.id))
    .slice(0, DATA_LIMITS.searchResults)
    .map((c) => ({ id: c.id, sym: str(c.symbol, 12).toUpperCase(), name: str(c.name, 40), rank: num(c.market_cap_rank) }));
}

const ESPN_LOGO_RE = /^https:\/\/a\.espncdn\.com\/(?:i\/teamlogos|i\/leaguelogos|guid)\/[A-Za-z0-9/_.-]{1,160}\.png$/;

/** The path of a crest on a.espncdn.com, resized by ESPN's own image service, or null when the URL is not one. */
export function crestPath(url) {
  if (typeof url !== 'string' || !ESPN_LOGO_RE.test(url) || url.includes('..')) return null;
  const p = url.slice('https://a.espncdn.com'.length);
  return `/combiner/i?${q({ img: p, w: 96, h: 96 })}`;
}

/** Short, stable token for a crest path (FNV-1a twice): what a display asks for instead of a URL. */
export function crestToken(path) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export const CREST_TOKEN_RE = /^[0-9a-f]{16}$/;

const STATE = { pre: 'pre', in: 'in', post: 'post' };
/** ESPN's status names that mean the game did not or will not happen as planned. */
const NOTES = { STATUS_POSTPONED: 'postponed', STATUS_CANCELED: 'canceled', STATUS_SUSPENDED: 'suspended', STATUS_ABANDONED: 'canceled', STATUS_DELAYED: 'delayed' };

function side(x) {
  const t = isObj(x?.team) ? x.team : {};
  const logo = typeof t.logo === 'string' ? t.logo : Array.isArray(t.logos) ? t.logos.find((l) => typeof l?.href === 'string')?.href : '';
  const sc = typeof x?.score === 'string' ? x.score : isObj(x?.score) ? str(x.score.displayValue, 8) || (num(x.score.value) !== null ? String(num(x.score.value)) : '') : num(x?.score) !== null ? String(num(x.score)) : '';
  const color = typeof t.color === 'string' && /^[0-9a-f]{6}$/i.test(t.color) ? `#${t.color.toLowerCase()}` : null;
  return {
    id: typeof t.id === 'string' && TEAM_ID_RE.test(t.id) ? t.id : '',
    n: str(t.shortDisplayName || t.displayName || t.name, 32),
    ab: str(t.abbreviation, 6),
    sc: str(sc, 8),
    w: x?.winner === true,
    c: color,
    logo: crestPath(logo ?? ''),
  };
}

/**
 * One ESPN event → { id, t (start, ms), st: pre | in | post, clk (the minute or the clock, as ESPN writes it), note?,
 * home, away } or null. `sport` decides what the clock shows (football: the minute).
 */
export function parseEvent(e, sport = 'soccer') {
  if (!isObj(e)) return null;
  const c = Array.isArray(e.competitions) && isObj(e.competitions[0]) ? e.competitions[0] : null;
  if (!c || !Array.isArray(c.competitors) || c.competitors.length !== 2) return null;
  const status = isObj(c.status) ? c.status : isObj(e.status) ? e.status : {};
  const type = isObj(status.type) ? status.type : {};
  const st = STATE[type.state] ?? 'pre';
  const t = Date.parse(c.date || e.date);
  if (!Number.isFinite(t)) return null;
  const home = c.competitors.find((x) => x?.homeAway === 'home') ?? c.competitors[0];
  const away = c.competitors.find((x) => x !== home) ?? c.competitors[1];
  let clk = '';
  if (st === 'in') clk = sport === 'soccer' && /^\d+'?(\+\d+'?)?$/.test(String(status.displayClock || '')) && type.name !== 'STATUS_HALFTIME' ? str(status.displayClock, 10) : str(type.shortDetail, 16);
  else if (st === 'post') clk = str(type.shortDetail, 16);
  const out = { id: str(String(e.id ?? ''), 16), t, st, clk, home: side(home), away: side(away) };
  if (type.name === 'STATUS_HALFTIME') out.half = true;
  if (NOTES[type.name]) out.note = NOTES[type.name];
  if (!out.id) return null;
  return out;
}

/** An ESPN scoreboard or team schedule → events sorted by start. */
export function parseEvents(text, sport) {
  const d = json(text);
  if (!isObj(d)) throw new DataError('bad_response', 'not an object');
  const list = Array.isArray(d.events) ? d.events : [];
  return list.map((e) => parseEvent(e, sport)).filter(Boolean).sort((a, b) => a.t - b.t).slice(0, 120);
}

/** ESPN /teams → [{ id, name, abbr }] sorted by name. */
export function parseTeams(text) {
  const d = json(text);
  const teams = d?.sports?.[0]?.leagues?.[0]?.teams;
  if (!Array.isArray(teams)) throw new DataError('bad_response', 'no teams');
  return teams
    .map((x) => x?.team)
    .filter((t) => isObj(t) && typeof t.id === 'string' && TEAM_ID_RE.test(t.id))
    .map((t) => ({ id: t.id, name: str(t.displayName || t.name, 40), abbr: str(t.abbreviation, 6) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Finnhub /quote → { price, ch (%), prev, t (ms) } or null when Finnhub does not know the symbol (all zeros). */
export function parseQuote(text) {
  const d = json(text);
  if (!isObj(d)) throw new DataError('bad_response', 'not an object');
  const price = num(d.c);
  const t = num(d.t);
  if (price === null || (price === 0 && !t)) return null;
  return { price, ch: num(d.dp), prev: num(d.pc), t: t ? t * 1000 : 0 };
}

/** Finnhub /search → [{ sym, name, type }] (common shares, ETFs and the like), at most DATA_LIMITS.searchResults. */
export function parseSymbolSearch(text) {
  const d = json(text);
  const list = Array.isArray(d?.result) ? d.result : [];
  return list
    .filter((x) => isObj(x) && typeof x.symbol === 'string' && STOCK_SYMBOL_RE.test(x.symbol))
    .slice(0, DATA_LIMITS.searchResults)
    .map((x) => ({ sym: x.symbol, name: str(x.description, 40), type: str(x.type, 24) }));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FX_MAX_DATES = 400;
const FX_MAX_CODES = 80;

/**
 * Frankfurter's rates against the euro → { dates (sorted, YYYY-MM-DD), rates: { CODE: [rate | null per date] } }.
 * Reads v2's list of { date, base, quote, rate } and v1's { rates: { date: { CODE: rate } } } or { date, rates }.
 * Rates against another base, odd codes and rates that are not a positive number are left out.
 */
export function parseFxSeries(text) {
  const d = json(text);
  const by = new Map(); // date → Map code → rate
  const put = (date, code, rate) => {
    if (typeof date !== 'string' || !DATE_RE.test(date) || typeof code !== 'string' || !FX_CODE_RE.test(code) || code === FX_BASE) return;
    const r = num(rate);
    if (r === null || !(r > 0)) return;
    if (!by.has(date)) {
      if (by.size >= FX_MAX_DATES) return;
      by.set(date, new Map());
    }
    by.get(date).set(code, r);
  };
  if (Array.isArray(d)) {
    for (const x of d) if (isObj(x) && (x.base ?? FX_BASE) === FX_BASE) put(x.date, x.quote, x.rate);
  } else if (isObj(d) && (d.base ?? FX_BASE) === FX_BASE && isObj(d.rates)) {
    if (typeof d.date === 'string') for (const [c, r] of Object.entries(d.rates)) put(d.date, c, r);
    else for (const [date, m] of Object.entries(d.rates)) if (isObj(m)) for (const [c, r] of Object.entries(m)) put(date, c, r);
  } else throw new DataError('bad_response', 'no rates');
  if (!by.size) throw new DataError('bad_response', 'no rates');
  const dates = [...by.keys()].sort();
  const codes = [...new Set([...by.values()].flatMap((m) => [...m.keys()]))].sort().slice(0, FX_MAX_CODES);
  const rates = {};
  for (const c of codes) rates[c] = dates.map((t) => by.get(t).get(c) ?? null);
  return { dates, rates };
}

/**
 * Frankfurter's currencies → [{ code, name }] sorted by code: v2's list (only the ones still published: an end date
 * within a month of the newest one, so the franc of 2001 is not offered) or v1's { CODE: name }. The euro is always
 * there.
 */
export function parseFxCurrencies(text) {
  const d = json(text);
  const out = new Map();
  if (Array.isArray(d)) {
    const ends = d.map((x) => (isObj(x) && typeof x.end_date === 'string' && DATE_RE.test(x.end_date) ? x.end_date : '')).filter(Boolean).sort();
    const newest = ends.length ? Date.parse(`${ends[ends.length - 1]}T00:00:00Z`) : 0;
    for (const x of d) {
      if (!isObj(x) || typeof x.iso_code !== 'string' || !FX_CODE_RE.test(x.iso_code)) continue;
      const end = typeof x.end_date === 'string' && DATE_RE.test(x.end_date) ? Date.parse(`${x.end_date}T00:00:00Z`) : null;
      if (end !== null && newest && newest - end > 31 * 24 * HOUR) continue;
      out.set(x.iso_code, str(x.name, 40));
    }
  } else if (isObj(d)) {
    for (const [c, n] of Object.entries(d)) if (FX_CODE_RE.test(c)) out.set(c, str(n, 40));
  } else throw new DataError('bad_response', 'no currencies');
  if (!out.size) throw new DataError('bad_response', 'no currencies');
  if (!out.has(FX_BASE)) out.set(FX_BASE, 'Euro');
  return [...out].sort((a, b) => a[0].localeCompare(b[0])).slice(0, FX_MAX_CODES).map(([code, name]) => ({ code, name }));
}

/** A currency's rate against the euro on the `i`th date of a series (the euro itself: 1), or null. */
const perEuro = (series, code, i) => (code === FX_BASE ? 1 : series.rates[code]?.[i] ?? null);

/** QUOTE per one BASE on the `i`th date, worked out through the euro (GBP/EUR = 1 / GBP per euro), or null. */
export function fxRate(series, base, quote, i) {
  const b = perEuro(series, base, i);
  const qv = perEuro(series, quote, i);
  return b && qv ? qv / b : null;
}

/**
 * A symbol that looks like a currency pair (EURHUF, EUR/HUF, OANDA:EUR_HUF, FX:GBPUSD) → { base, quote } when both
 * halves are ECB currencies, else null: what the Bolsa card points to the Divisas card for.
 */
export function fxPairOf(sym) {
  const s = String(sym ?? '').toUpperCase().trim().replace(/^[A-Z_]{1,12}:/, '');
  const m = /^([A-Z]{3})[/_\-. ]?([A-Z]{3})$/.exec(s);
  if (!m || m[1] === m[2] || !FX_CURRENCIES.includes(m[1]) || !FX_CURRENCIES.includes(m[2])) return null;
  return { base: m[1], quote: m[2] };
}

// ---- refresh policy -----------------------------------------------------------------------------------------------

/**
 * How long a scoreboard is kept: a minute while a game is on, about to start (15 minutes) or just ended (30 minutes,
 * for the final score); otherwise 15 minutes, waking up 10 minutes before the next start.
 */
export function sportsTtl(events, now) {
  let next = Infinity;
  for (const e of events ?? []) {
    if (e.st === 'in') return DATA_TTL.sportsLive;
    if (e.st === 'pre' && !e.note) {
      if (e.t - now <= 15 * MIN && now - e.t < 4 * HOUR) return DATA_TTL.sportsLive;
      if (e.t > now) next = Math.min(next, e.t - 10 * MIN - now);
    }
    if (e.st === 'post' && now - e.t < 3 * HOUR) return 5 * MIN;
  }
  return Math.max(DATA_TTL.sportsLive, Math.min(DATA_TTL.sportsIdle, next));
}

/** A quote is asked often while its market trades (a quote under 30 minutes old), rarely otherwise. */
export const quoteTtl = (quote, now) => (quote && quote.t && now - quote.t < 30 * MIN ? DATA_TTL.quoteOpen : DATA_TTL.quoteClosed);

/**
 * Exchange rates are asked every few hours; on a working day from 13:00 to 18:00 UTC, while the day's rates are not
 * in yet (the ECB publishes them around 16:00 CET), every half hour.
 */
export function fxTtl(series, now) {
  const wd = new Date(now).getUTCDay();
  const h = new Date(now).getUTCHours();
  const last = series?.dates?.[series.dates.length - 1] ?? '';
  if (wd >= 1 && wd <= 5 && h >= 13 && h < 18 && last < dayIso(now)) return DATA_TTL.fxDue;
  return DATA_TTL.fx;
}

/**
 * What a source's status means: a DataError, or null for a 200. Finnhub answers 401 to a key it does not know and
 * 403 to a symbol its plan does not cover (a forex pair on the free plan): the key is fine then, the symbol is not.
 */
export function statusError(host, status) {
  if (status === 200) return null;
  if (status === 401) return new DataError(host === DATA_HOSTS.finnhub ? 'key_refused' : 'bad_response', '401');
  if (status === 403) return new DataError(host === DATA_HOSTS.finnhub ? 'no_access' : 'bad_response', '403');
  if (status === 404) return new DataError('not_found');
  return new DataError('bad_response', String(status));
}

// ---- the hub: cache and calls -------------------------------------------------------------------------------------

/** 2 minutes, doubling up to 30, after failures (a 429's Retry-After wins). */
const backoff = (fails) => Math.min(30 * MIN, 2 * MIN * 2 ** Math.max(0, fails - 1));
const FORGET_MS = 24 * HOUR;
const WANT_MS = 2 * HOUR;
/** A coin only the builder's preview asked for is let go sooner than one a saved screen shows. */
const WANT_PREVIEW_MS = 10 * MIN;
/** Coins in one /coins/markets call (CoinGecko's page size). */
export const MARKETS_MAX_IDS = 250;
/**
 * Calls waiting for one host at most: more are refused at once (rate_limited) instead of queueing for minutes behind
 * the gap, so a burst of new keys (a preview with many cards, a run of searches) cannot hold up every screen's
 * refresh. Searches have their own, smaller share.
 */
export const HOST_QUEUE_MAX = 40;
export const HOST_SEARCH_QUEUE_MAX = 3;
/** Cache keys of the builder's pickers: the first let go when the cache is full. */
const PICKER_KEY_RE = /^(?:coinsearch|symsearch|teams|fxcur):/;

/**
 * The shared cache of the data cards: one upstream call per key per interval, whoever asks (every screen, the
 * builder's preview), the last good answer kept when a call fails (stale while error), failures backed off, calls to a
 * host one at a time and spaced out, a 429 honoured for its Retry-After.
 *
 * `call({ host, path, headers? })` → { status, text, retryAfterMs? } does one GET (the caller enforces the timeout and
 * the size cap); `now()`; `sleep(ms)`; `stocksKey()` → the Finnhub key or ''; `log(msg)`.
 */
export function createDataHub({ call, now = () => Date.now(), sleep = () => Promise.resolve(), stocksKey = () => '', log = () => {}, max = 500 } = {}) {
  const cache = new Map(); // key → { value, at, nextAt, fails, error, usedAt }
  const inflight = new Map();
  const gates = new Map(); // host → { chain, until, pending, searches }
  /** coins wanted per currency by saved screens: currency → Map id → last wanted (ms) */
  const wanted = new Map();
  /** coins wanted per currency by the builder's preview only: currency → Map id → last wanted (ms) */
  const previewWanted = new Map();
  /** coins the last markets call of each currency asked for: currency → Set of ids */
  const asked = new Map();
  /** crest token → path on a.espncdn.com */
  const crests = new Map();

  function gate(host) {
    let g = gates.get(host);
    if (!g) gates.set(host, (g = { chain: Promise.resolve(), until: 0, pending: 0, searches: 0 }));
    return g;
  }

  /**
   * One GET through the host's gate: the answer's text (`raw`: the whole answer), or a DataError. `search`: a picker's
   * search (its own share of the queue).
   */
  function get(req, { search = false, raw = false } = {}) {
    if (!DATA_HOST_LIST.includes(req.host)) return Promise.reject(new DataError('host', req.host));
    const g = gate(req.host);
    if (g.pending >= HOST_QUEUE_MAX || (search && g.searches >= HOST_SEARCH_QUEUE_MAX)) return Promise.reject(new DataError('rate_limited', 'busy', 15_000));
    g.pending++;
    if (search) g.searches++;
    const run = g.chain.then(async () => {
      if (now() < g.until) throw new DataError('rate_limited', '', g.until - now());
      let r;
      try {
        r = await call(req);
      } catch (err) {
        if (err instanceof DataError) throw err;
        throw new DataError(err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'fetch_failed');
      }
      if (r.status === 429) {
        const wait = r.retryAfterMs ?? 2 * MIN;
        g.until = now() + wait;
        throw new DataError('rate_limited', '', wait);
      }
      const bad = statusError(req.host, r.status);
      if (bad) throw bad;
      return raw ? r : r.text;
    });
    const done = () => {
      g.pending--;
      if (search) g.searches--;
    };
    run.then(done, done);
    g.chain = run.catch(() => {}).then(() => sleep(HOST_GAP_MS[req.host] ?? 500));
    return run;
  }

  function prune() {
    const t = now();
    for (const [k, e] of cache) if (t - e.usedAt > FORGET_MS) cache.delete(k);
    if (cache.size > max) {
      // the least used first, the pickers' searches before what screens show
      const order = [...cache].sort(([ka, a], [kb, b]) => (PICKER_KEY_RE.test(kb) - PICKER_KEY_RE.test(ka)) || a.usedAt - b.usedAt);
      for (const [k] of order.slice(0, cache.size - max)) cache.delete(k);
    }
    for (const m of wanted.values()) for (const [id, w] of m) if (t - w > WANT_MS) m.delete(id);
    for (const m of previewWanted.values()) for (const [id, w] of m) if (t - w > WANT_PREVIEW_MS) m.delete(id);
    while (crests.size > 400) crests.delete(crests.keys().next().value);
  }

  /**
   * The entry of `key` ({ value, at, error } or null): fresh from the cache, or loaded once (`load(prev)` → value,
   * `ttl(value, at)` → ms). A due entry with a value answers at once and is refreshed behind; one with nothing yet
   * waits for its first answer. `force`: due now when the last answer is at least `forceAfter` ms old (a coin a screen
   * just added; never sooner than 15 s, and never while a failure is backed off), and the caller waits for it.
   */
  async function cached(key, load, ttl, { force = false, forceAfter = DATA_MIN_TTL_MS } = {}) {
    const t = now();
    const e = cache.get(key);
    if (e) e.usedAt = t;
    const forced = force && !!e && !e.error && t - e.at >= Math.max(15_000, forceAfter);
    const due = !e || t >= e.nextAt || forced;
    if (due && !inflight.has(key)) {
      const prev = e?.value ?? null;
      const p = (async () => {
        try {
          const value = await load(prev);
          const at = now();
          cache.set(key, { value, at, nextAt: at + Math.max(DATA_MIN_TTL_MS, ttl(value, at)), fails: 0, error: null, usedAt: e?.usedAt ?? at });
        } catch (err) {
          const code = err instanceof DataError ? err.code : 'fetch_failed';
          const fails = (e?.fails ?? 0) + 1;
          const wait = Math.max(DATA_MIN_TTL_MS, err?.retryMs ?? backoff(fails));
          cache.set(key, { value: prev, at: e?.at ?? 0, nextAt: now() + wait, fails, error: code, usedAt: e?.usedAt ?? now() });
          if (fails === 1 || fails % 10 === 0) log(`${key}: ${code}`);
        } finally {
          inflight.delete(key);
          prune();
        }
      })();
      inflight.set(key, p);
    }
    if ((!e || e.value === null || e.value === undefined || forced) && inflight.has(key)) await inflight.get(key);
    const out = cache.get(key);
    return out ? { value: out.value ?? null, at: out.at, error: out.error, nextAt: out.nextAt } : null;
  }

  // ---- market
  function want(currency, ids, preview) {
    const maps = preview ? previewWanted : wanted;
    let m = maps.get(currency);
    if (!m) maps.set(currency, (m = new Map()));
    const t = now();
    for (const id of ids) {
      m.delete(id);
      m.set(id, t);
    }
  }

  /**
   * The coins of the next markets call in `currency`: what saved screens show, the most recently wanted first, then
   * what only the preview asked for, MARKETS_MAX_IDS at most (sorted, so the address is the same each time).
   */
  function marketList(currency) {
    const recent = (m) => [...(m?.entries() ?? [])].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const screens = recent(wanted.get(currency));
    const seen = new Set(screens);
    const list = [...screens, ...recent(previewWanted.get(currency)).filter((id) => !seen.has(id))];
    return list.slice(0, MARKETS_MAX_IDS).sort();
  }

  /**
   * Market data of `ids` in `currency`: { coins: Map id → coin, at, error }. One call for every wanted coin.
   * `preview`: asked by the builder's preview, not by a saved screen (never pushes a screen's coin out of the call).
   */
  async function markets(currency, ids, { preview = false } = {}) {
    want(currency, ids, preview);
    const key = `markets:${currency}`;
    // a coin the last call did not ask for (one a screen just added): the next call includes it, 15 s after the last
    // one at the soonest. A coin that was asked for and that CoinGecko does not know waits for the normal refresh, and
    // so does one with no room in the call (more than MARKETS_MAX_IDS wanted).
    const sent = asked.get(currency);
    const next = new Set(marketList(currency));
    const missing = ids.some((id) => !sent?.has(id) && next.has(id));
    const r = await cached(key, async () => {
      const list = marketList(currency);
      const out = parseMarkets(await get(marketsRequest(currency, list)));
      asked.set(currency, new Set(list));
      return out;
    }, () => DATA_TTL.markets, { force: missing, forceAfter: 15_000 });
    return { coins: r?.value ?? new Map(), at: r?.at ?? 0, error: r?.error ?? null };
  }

  const chart30 = (id, currency) => cached(`chart30:${id}:${currency}`, async () => parseChart(await get(chartRequest(id, currency))), () => DATA_TTL.chart30);

  async function searchCoins(text) {
    const s = String(text ?? '').trim().toLowerCase().slice(0, 40);
    if (s.length < 2) return [];
    const r = await cached(`coinsearch:${s}`, async () => parseCoinSearch(await get(coinSearchRequest(s), { search: true })), () => DATA_TTL.coinSearch);
    if (r?.error && !r.value) throw new DataError(r.error);
    return r?.value ?? [];
  }

  // ---- sports
  function remember(events) {
    for (const e of events) {
      for (const s of [e.home, e.away]) {
        if (!s.logo) continue;
        const tok = crestToken(s.logo);
        crests.delete(tok);
        crests.set(tok, s.logo);
      }
    }
    return events;
  }
  const scoreboard = (l) => cached(`sb:${l.id}`, async () => remember(parseEvents(await get(scoreboardRequest(l)), l.sport)), (v, at) => sportsTtl(v, at));
  const results = (l, team) => cached(`res:${l.id}:${team}`, async () => remember(parseEvents(await get(resultsRequest(l, team)), l.sport)), () => DATA_TTL.results);
  const fixtures = (l, team) => cached(`fix:${l.id}:${team}`, async () => remember(parseEvents(await get(fixturesRequest(l, team)), l.sport)), (v, at) => Math.min(DATA_TTL.fixtures, sportsTtl(v, at) === DATA_TTL.sportsLive ? 10 * MIN : DATA_TTL.fixtures));

  async function teams(leagueId) {
    const l = sportsLeague(leagueId);
    if (!l) throw new DataError('not_found');
    const r = await cached(`teams:${l.id}`, async () => parseTeams(await get(teamsRequest(l))), () => DATA_TTL.teams);
    if (r?.error && !r.value) throw new DataError(r.error);
    return r?.value ?? [];
  }

  /** The path of a crest a parsed answer named (null for a token this server never handed out). */
  const crest = (token) => (CREST_TOKEN_RE.test(String(token)) ? crests.get(token) ?? null : null);

  // ---- stocks
  async function quote(sym) {
    const key = stocksKey();
    if (!key) return { value: null, at: 0, error: 'no_key' };
    return cached(`q:${sym}`, async (prev) => {
      const qt = parseQuote(await get(quoteRequest(sym, key)));
      if (!qt) return { quote: null, pts: [] };
      // the curve: the quotes read so far, one point per new quote time, the last 24 hours
      const pts = (prev?.pts ?? []).filter(([t]) => qt.t - t <= 24 * HOUR);
      if (qt.t && (!pts.length || pts[pts.length - 1][0] < qt.t)) pts.push([qt.t, sig(qt.price)]);
      return { quote: qt, pts: pts.slice(-200) };
    }, (v, at) => quoteTtl(v?.quote, at));
  }

  async function searchSymbols(text) {
    const key = stocksKey();
    if (!key) throw new DataError('no_key');
    const s = String(text ?? '').trim().slice(0, 30);
    if (s.length < 1) return [];
    const r = await cached(`symsearch:${s.toLowerCase()}`, async () => parseSymbolSearch(await get(symbolSearchRequest(s, key), { search: true })), () => DATA_TTL.symbolSearch);
    if (r?.error && !r.value) throw new DataError(r.error);
    return r?.value ?? [];
  }

  // ---- exchange rates: one call with every currency (against the euro) for every pair of every screen
  /** `span` 'month': five weeks day by day; 'year': a year week by week. */
  const fx = (span) => cached(`fx:${FX_BASE}:${span === 'year' ? 'year' : 'month'}`, async () => parseFxSeries(await get(span === 'year' ? fxYearRequest(now()) : fxMonthRequest(now()))), (v, at) => (span === 'year' ? DATA_TTL.fxYear : fxTtl(v, at)));

  /** The currencies for the builder's picker (cached a day). */
  async function fxCurrencies() {
    const r = await cached('fxcur:ECB', async () => parseFxCurrencies(await get(fxCurrenciesRequest(), { search: true })), () => DATA_TTL.fxCurrencies);
    if (r?.error && !r.value) throw new DataError(r.error);
    return r?.value ?? [];
  }

  /** A new or removed key: quotes are asked again with it. */
  function keyChanged() {
    for (const k of [...cache.keys()]) if (k.startsWith('q:') || k.startsWith('symsearch:')) cache.delete(k);
  }

  /** What the admin status shows: key → { at, error }. */
  const status = () => Object.fromEntries([...cache].map(([k, e]) => [k, { at: e.at, error: e.error }]));

  return { now, get, cached, markets, chart30, searchCoins, scoreboard, results, fixtures, teams, crest, quote, searchSymbols, fx, fxCurrencies, keyChanged, status, _cache: cache };
}

// ---- what a screen gets -------------------------------------------------------------------------------------------

/** "Updated X ago" applies once an answer is this much older than it should be. */
const staleAfter = (kind) => (kind === 'sports' ? 20 * MIN : kind === 'stocks' ? 20 * MIN : kind === 'currency' ? 10 * HOUR : 10 * MIN);

const ageOf = (at, t) => (at ? Math.max(0, Math.round((t - at) / 1000)) : null);

/**
 * The numbers one data item shows, worked out from the hub: { kind, age (s since the oldest answer used), stale,
 * error?, ...kind's own } (types.ts DataItemData). Only what the card draws: no URL, no key, no upstream id beyond the
 * coin and team ids the item already has. Crests become tokens (GET /api/display/data/crest/:token).
 */
export async function dataForItem(hub, item, now = hub.now(), { preview = false } = {}) {
  const p = item?.props ?? {};
  if (item?.kind === 'market') return marketData(hub, p, now, preview);
  if (item?.kind === 'sports') return sportsData(hub, p, now);
  if (item?.kind === 'stocks') return stocksData(hub, p, now);
  if (item?.kind === 'currency') return currencyData(hub, p, now);
  return null;
}

async function marketData(hub, p, now, preview = false) {
  const coins = Array.isArray(p.coins) ? p.coins.filter((c) => COIN_ID_RE.test(c?.id ?? '')).slice(0, DATA_LIMITS.coins) : [];
  const range = MARKET_RANGES.includes(p.range) ? p.range : '7d';
  const byCur = new Map();
  for (const c of coins) {
    const cur = MARKET_CURRENCIES.includes(c.currency) ? c.currency : 'eur';
    if (!byCur.has(cur)) byCur.set(cur, []);
    byCur.get(cur).push(c.id);
  }
  const got = new Map();
  for (const [cur, ids] of byCur) got.set(cur, await hub.markets(cur, ids, { preview }));
  let oldest = Infinity;
  let error = null;
  const out = [];
  for (const c of coins) {
    const cur = MARKET_CURRENCIES.includes(c.currency) ? c.currency : 'eur';
    const m = got.get(cur);
    if (m.error) error = m.error;
    const x = m.coins.get(c.id);
    if (!x) {
      out.push({ id: c.id, sym: str(c.sym, 12) || c.id.slice(0, 6).toUpperCase(), name: str(c.name, 40), cur, price: null, ch: null, pts: [] });
      continue;
    }
    if (m.at) oldest = Math.min(oldest, m.at);
    let pts = [];
    if (p.chart !== 'none') {
      if (range === '30d') {
        const ch = await hub.chart30(c.id, cur);
        pts = ch?.value ?? [];
        if (ch?.error && !pts.length) error = error ?? ch.error;
      } else pts = range === '1d' ? x.spark.slice(-25) : thin(x.spark, 84);
    }
    out.push({ id: c.id, sym: x.sym || str(c.sym, 12), name: x.name || str(c.name, 40), cur, price: x.price, ch: x.ch[range] ?? null, pts });
  }
  const age = ageOf(Number.isFinite(oldest) ? oldest : 0, now);
  return { kind: 'market', range, coins: out, age, stale: !!error || age === null || age * 1000 > staleAfter('market'), ...(error ? { error } : {}) };
}

/** The games of one followed team or league, as the card shows them (`show`: auto, next or last). */
export function pickGames(entry, ev, show, max, now) {
  const all = ev.filter((e) => entry.type !== 'team' || e.home.id === entry.team || e.away.id === entry.team);
  const live = all.filter((e) => e.st === 'in');
  const done = all.filter((e) => e.st === 'post').sort((a, b) => b.t - a.t);
  const next = all.filter((e) => e.st === 'pre' && (e.t > now - 4 * HOUR || e.note)).sort((a, b) => a.t - b.t);
  if (show === 'next') return [...live, ...next].slice(0, max);
  if (show === 'last') return [...live, ...done].slice(0, max);
  if (entry.type === 'team') return live.length ? live.slice(0, max) : [...done.slice(0, 1), ...next.slice(0, 1)].slice(0, max);
  // a league: what is on now, then what comes, then the latest results
  return [...live, ...next, ...done].slice(0, max);
}

async function sportsData(hub, p, now) {
  const follow = Array.isArray(p.follow) ? p.follow.slice(0, DATA_LIMITS.follow) : [];
  const show = ['auto', 'next', 'last'].includes(p.show) ? p.show : 'auto';
  const max = Math.min(DATA_LIMITS.games, Math.max(1, Number(p.max) || 4));
  let oldest = Infinity;
  let error = null;
  // old = an answer past its own refresh (results are asked hourly and fixtures every few hours, the scoreboard far
  // more often: one limit for all made a followed team look out of date all the time, #22)
  let late = false;
  const groups = [];
  const seen = new Set();
  const use = (r, every) => {
    if (!r) return [];
    if (r.error) error = error ?? r.error;
    if (r.at) {
      oldest = Math.min(oldest, r.at);
      if (now - r.at > every + staleAfter('sports')) late = true;
    }
    return r.value ?? [];
  };
  for (const f of follow) {
    const l = sportsLeague(f?.league);
    if (!l || (f.type === 'team' && !TEAM_ID_RE.test(f.team ?? ''))) continue;
    // the scoreboard (the round now, live) first: its scores are the freshest; a team adds its results and fixtures
    const byId = new Map();
    const lists = [use(await hub.scoreboard(l), 0)];
    if (f.type === 'team') lists.unshift(use(await hub.results(l, f.team), DATA_TTL.results), use(await hub.fixtures(l, f.team), DATA_TTL.fixtures));
    for (const list of lists) for (const e of list) byId.set(e.id, e);
    const games = pickGames(f, [...byId.values()], show, max, now).filter((g) => !seen.has(g.id));
    for (const g of games) seen.add(g.id);
    const mine = f.type === 'team' ? [...byId.values()].map((e) => (e.home.id === f.team ? e.home : e.away.id === f.team ? e.away : null)).find(Boolean) : null;
    groups.push({ label: str(f.name, 40) || mine?.n || l.name, lg: l.short, sport: l.sport, games: games.map((g) => projectGame(g)) });
  }
  // the card's limit over all groups, in order
  let room = max;
  for (const g of groups) {
    g.games = g.games.slice(0, Math.max(0, room));
    room -= g.games.length;
  }
  const age = ageOf(Number.isFinite(oldest) ? oldest : 0, now);
  return { kind: 'sports', groups, age, stale: !!error || age === null || late, ...(error ? { error } : {}) };
}

function projectGame(g) {
  const s = (x) => ({ n: x.n, ab: x.ab, sc: x.sc, w: x.w, c: x.c, cr: x.logo ? crestToken(x.logo) : '' });
  const out = { id: g.id, t: g.t, st: g.st, clk: g.clk, home: s(g.home), away: s(g.away) };
  if (g.st === 'pre') {
    out.home.sc = '';
    out.away.sc = '';
  }
  if (g.half) out.half = true;
  if (g.note) out.note = g.note;
  return out;
}

/** Why a symbol has nothing to show: Finnhub does not know it (all zeros, 404) or its plan does not cover it (403). */
const NO_DATA_ERRORS = new Set(['not_found', 'no_access']);

async function stocksData(hub, p, now) {
  const syms = Array.isArray(p.symbols) ? p.symbols.filter((s) => STOCK_SYMBOL_RE.test(s?.sym ?? '')).slice(0, DATA_LIMITS.symbols) : [];
  let oldest = Infinity;
  let error = null;
  const quotes = [];
  for (const s of syms) {
    const r = await hub.quote(s.sym);
    const v = r?.value;
    // a symbol with no data (unknown, all zeros, not on the free plan) says so on its own row: the card is not old
    // for it, and the key is not wrong
    const none = !v?.quote && (NO_DATA_ERRORS.has(r?.error) || (!r?.error && !!r?.at));
    if (r?.error && !NO_DATA_ERRORS.has(r.error)) error = error ?? r.error;
    if (r?.at && v?.quote) oldest = Math.min(oldest, r.at);
    quotes.push({
      sym: s.sym,
      name: str(s.name, 40),
      price: v?.quote?.price ?? null,
      ch: v?.quote?.ch ?? null,
      pts: p.sparkline && v?.pts?.length >= 2 ? thin(v.pts, 60) : [],
      ...(none ? { noData: true } : {}),
    });
  }
  const age = ageOf(Number.isFinite(oldest) ? oldest : 0, now);
  const anyData = quotes.some((x) => !x.noData);
  // every symbol without data: nothing is old, there is just nothing to show
  const stale = !!error || (anyData && (age === null || age * 1000 > staleAfter('stocks')));
  const out = { kind: 'stocks', quotes, age, stale, ...(error ? { error } : {}) };
  if (error === 'no_key' || error === 'key_refused') out.needsKey = true;
  return out;
}

/** Days between two YYYY-MM-DD dates. */
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (24 * HOUR));
const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);

/** The last date of a series on which both currencies of a pair have a rate, before index `before`; -1 if none. */
function lastWith(series, base, quote, before = series.dates.length) {
  for (let i = Math.min(before, series.dates.length) - 1; i >= 0; i--) if (fxRate(series, base, quote, i) !== null) return i;
  return -1;
}

/** The [t, rate] points of a pair over the dates of a series from `from` (YYYY-MM-DD) on. */
function fxPoints(series, base, quote, from) {
  const pts = [];
  for (let i = 0; i < series.dates.length; i++) {
    if (series.dates[i] < from) continue;
    const r = fxRate(series, base, quote, i);
    if (r !== null) pts.push([dayMs(series.dates[i]), sig(r)]);
  }
  return pts;
}

async function currencyData(hub, p, now) {
  const pairs = Array.isArray(p.pairs) ? p.pairs.filter((x) => FX_CODE_RE.test(x?.base ?? '') && FX_CODE_RE.test(x?.quote ?? '') && x.base !== x.quote).slice(0, DATA_LIMITS.pairs) : [];
  const range = CURRENCY_RANGES.includes(p.range) ? p.range : '30d';
  const m = await hub.fx('month');
  const y = range === '1y' && p.chart !== 'none' && pairs.length ? await hub.fx('year') : null;
  const series = m?.value ?? null;
  let error = m?.error ?? null;
  if (y?.error && !y.value) error = error ?? y.error;
  let date = '';
  const out = [];
  for (const { base, quote } of pairs) {
    const i = series ? lastWith(series, base, quote) : -1;
    if (i < 0) {
      out.push({ base, quote, rate: null, ch: null, pts: [], ...(series ? { noData: true } : {}) });
      continue;
    }
    const rate = fxRate(series, base, quote, i);
    const j = lastWith(series, base, quote, i);
    const prev = j >= 0 ? fxRate(series, base, quote, j) : null;
    const last = series.dates[i];
    if (last > date) date = last;
    let pts = [];
    if (p.chart !== 'none') {
      if (range === '1y') {
        pts = y?.value ? fxPoints(y.value, base, quote, dayIso(dayMs(last), 366)) : [];
        // the weekly points end at the latest day's rate
        if (pts.length && pts[pts.length - 1][0] < dayMs(last)) pts.push([dayMs(last), sig(rate)]);
      } else {
        const days = range === '7d' ? 7 : 30;
        pts = fxPoints(series, base, quote, dayIso(dayMs(last), days)).filter(([t]) => daysBetween(dayIso(t), last) <= days);
      }
      pts = thin(pts, DATA_LIMITS.chartPoints);
    }
    out.push({ base, quote, rate, ch: prev ? ((rate / prev) - 1) * 100 : null, pts });
  }
  const age = ageOf(m?.at ?? 0, now);
  return { kind: 'currency', range, date, pairs: out, age, stale: !!error || age === null || age * 1000 > staleAfter('currency'), ...(error ? { error } : {}) };
}

/** Whether a stocks key is saved and its last 4 characters, never the key. */
export const stocksKeyStatus = (key) => ({ set: !!key, last4: key ? key.slice(-4) : '' });
