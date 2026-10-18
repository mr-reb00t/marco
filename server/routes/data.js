// Data cards of Personalizado screens (market, sports, stocks, currency; server/dataFeeds.js, core/dataCore.js):
//   dataDisplayRouter() mounted at /api (displayAuth already ran for /api/display):
//     GET /display/data               → { items: { [itemId]: DataItemData } } for the requesting screen's data items
//     GET /display/data/crest/:token  → a team crest (PNG/JPEG/WebP bytes) a data answer named
//     GET /display/currency?pairs=EUR-HUF,USD-MXN&range=&chart= → CurrencyData for a Currency widget (any pairs: the
//                                       admin preview shows unsaved widgets; every pair comes from the same shared
//                                       entries, so no query costs the source more than one screen does)
//   dataAdminRouter() mounted at /api/admin (session):
//     GET  /data/coins?q=             → { coins } coin search for the picker (CoinGecko)
//     GET  /data/sports/leagues       → { leagues } the competitions the card can follow
//     GET  /data/sports/teams?league=&q= → { teams } of one competition
//     GET  /data/stocks/symbols?q=    → { symbols } symbol search (needs the Finnhub key)
//     GET  /data/currency/currencies  → { currencies } the ECB's currencies for the pair picker (Frankfurter, a day)
//     GET  /data/stocks/key           → { set, last4 }    PUT { key } (write-only, tried once before it is kept)
//     POST /data/preview              → { items } the builder's preview of items not saved yet (the same cache)
// A display only gets the numbers of the items on its own screen, never while the screen is private, never for an
// item a condition hides now; no source address or key ever reaches it.
import { Router } from 'express';
import { getConfig, updateSecrets } from '../store.js';
import { requestScreen } from '../displayAccess.js';
import { screenPrivacy } from '../privacy.js';
import { hiddenItems } from '../canvasConditions.js';
import { CANVAS_ID_RE, CANVAS_KINDS, canvasDataItems, currencyProps, DATA_KIND_IDS } from '../core/canvasCore.js';
import { CREST_TOKEN_RE, DataError, SPORTS_LEAGUES, STOCKS_KEY_RE, sportsLeague } from '../core/dataCore.js';
import {
  checkStocksKey, crestImage, fxCurrencies, itemData, leagueTeams, searchCoins, searchSymbols, stocksKey, stocksKeyChanged, stocksStatus,
} from '../dataFeeds.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ERR_STATUS = { no_key: 409, key_refused: 409, not_found: 404, rate_limited: 503 };
const sendErr = (res, err) => {
  const code = err instanceof DataError ? err.code : 'fetch_failed';
  res.status(ERR_STATUS[code] ?? 502).json({ error: code });
};

/** The numbers of several items, each on its own (one failing item never fails the others). */
async function dataOf(items, opts = {}) {
  const out = {};
  await Promise.all(items.map(async (it) => {
    try {
      const d = await itemData(it, opts);
      if (d) out[it.id] = d;
    } catch (err) {
      console.warn('[data]', err?.message);
    }
  }));
  return out;
}

export function dataDisplayRouter() {
  const r = Router();
  r.get('/display/data', wrap(async (req, res) => {
    res.set('cache-control', 'no-store');
    const cfg = getConfig();
    const { screen } = requestScreen(cfg, req);
    if (screenPrivacy(cfg, screen).active) return res.status(403).json({ error: 'private' });
    const hide = hiddenItems(cfg, screen);
    res.json({ items: await dataOf(canvasDataItems(screen, { tz: cfg.datetime?.timezone || 'UTC' }).filter((it) => !hide.has(it.id))) });
  }));

  // the Currency widget (Widgets section): its pairs come in the query, like the prices widget's zone
  r.get('/display/currency', wrap(async (req, res) => {
    res.set('cache-control', 'no-store');
    const cfg = getConfig();
    const { screen } = requestScreen(cfg, req);
    if (screenPrivacy(cfg, screen).active) return res.status(403).json({ error: 'private' });
    const props = currencyQuery(req.query);
    if (!props) return res.status(400).json({ error: 'invalid_pairs' });
    res.json(await itemData({ kind: 'currency', props }));
  }));

  r.get('/display/data/crest/:token', wrap(async (req, res) => {
    const token = String(req.params.token || '');
    if (!CREST_TOKEN_RE.test(token)) return res.status(404).json({ error: 'not found' });
    const cfg = getConfig();
    const { screen } = requestScreen(cfg, req);
    if (screenPrivacy(cfg, screen).active) return res.status(403).json({ error: 'private' });
    try {
      const img = await crestImage(token);
      res.set('cache-control', 'private, max-age=86400');
      res.set('content-type', img.type);
      res.set('content-length', String(img.buf.length));
      res.set('x-content-type-options', 'nosniff');
      res.end(img.buf);
    } catch (err) {
      sendErr(res, err);
    }
  }));
  return r;
}

/**
 * The data items of a builder preview, validated like a save, and no more cards of a kind than one screen may have
 * (perScreen): a preview never asks the sources more than a saved screen could.
 */
export function previewItems(list) {
  const sink = { err() {}, warn() {} };
  const counts = {};
  return list
    .filter((x) => x && typeof x === 'object' && CANVAS_ID_RE.test(String(x.id)) && DATA_KIND_IDS.includes(x.kind))
    .filter((x) => (counts[x.kind] = (counts[x.kind] ?? 0) + 1) <= (CANVAS_KINDS[x.kind].perScreen ?? 24))
    .map((x) => ({ id: x.id, kind: x.kind, props: CANVAS_KINDS[x.kind].props(sink, 'props', x.props && typeof x.props === 'object' ? x.props : {}, {}, {}) }));
}

/**
 * The options of a Currency widget as GET /display/currency reads them: pairs=EUR-HUF,USD-MXN (1 to 6), range, chart;
 * null when no pair is valid.
 */
export function currencyQuery(q) {
  const sink = { err() {}, warn() {} };
  const pairs = (typeof q?.pairs === 'string' ? q.pairs.slice(0, 64) : '').split(',').filter(Boolean).slice(0, 6).map((x) => {
    const [base, quote] = x.split('-');
    return { base, quote };
  });
  const props = currencyProps(sink, 'q', { pairs, range: typeof q?.range === 'string' ? q.range : undefined, chart: typeof q?.chart === 'string' ? q.chart : undefined });
  return props.pairs.length ? props : null;
}

const qText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function dataAdminRouter() {
  const r = Router();
  r.get('/data/coins', wrap(async (req, res) => {
    res.set('cache-control', 'no-store');
    try {
      res.json({ coins: await searchCoins(qText(req.query.q, 40)) });
    } catch (err) {
      sendErr(res, err);
    }
  }));

  r.get('/data/sports/leagues', (req, res) => res.json({ leagues: SPORTS_LEAGUES.map((l) => ({ ...l })) }));

  r.get('/data/sports/teams', wrap(async (req, res) => {
    res.set('cache-control', 'no-store');
    const league = qText(req.query.league, 40);
    if (!sportsLeague(league)) return res.status(400).json({ error: 'invalid_league' });
    const text = qText(req.query.q, 40).toLowerCase();
    try {
      const teams = await leagueTeams(league);
      res.json({ teams: text ? teams.filter((t) => t.name.toLowerCase().includes(text) || t.abbr.toLowerCase() === text) : teams });
    } catch (err) {
      sendErr(res, err);
    }
  }));

  r.get('/data/stocks/symbols', wrap(async (req, res) => {
    res.set('cache-control', 'no-store');
    try {
      res.json({ symbols: await searchSymbols(qText(req.query.q, 30)) });
    } catch (err) {
      sendErr(res, err);
    }
  }));

  r.get('/data/currency/currencies', wrap(async (req, res) => {
    res.set('cache-control', 'no-store');
    try {
      res.json({ currencies: await fxCurrencies() });
    } catch (err) {
      sendErr(res, err);
    }
  }));

  // the Finnhub key for the stocks card: write-only, like the ENTSO-E token
  r.get('/data/stocks/key', (req, res) => res.json(stocksStatus()));
  r.put('/data/stocks/key', wrap(async (req, res) => {
    const key = req.body?.key;
    if (typeof key !== 'string' || key.length > 200) return res.status(400).json({ error: 'key must be a string' });
    const k = key.trim();
    if (k && !STOCKS_KEY_RE.test(k)) return res.status(400).json({ error: 'key_invalid' });
    const checked = k ? await checkStocksKey(k) : null;
    if (checked === false) return res.status(400).json({ error: 'key_invalid' });
    const changed = stocksKey() !== k;
    updateSecrets((s) => { s.data = { ...(s.data || {}), stocksKey: k }; });
    if (changed) stocksKeyChanged();
    res.json({ ...stocksStatus(), checked: checked === true });
  }));

  // the builder's preview: items as they are in the editor, validated like a save, through the same cache
  r.post('/data/preview', wrap(async (req, res) => {
    res.set('cache-control', 'no-store');
    const list = Array.isArray(req.body?.items) ? req.body.items.slice(0, 24) : null;
    if (!list) return res.status(400).json({ error: 'items: a list' });
    res.json({ items: await dataOf(previewItems(list), { preview: true }) });
  }));
  return r;
}
