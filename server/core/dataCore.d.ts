// Types for dataCore.js (the data cards: market, sports, stocks, currency), used by the admin and the display.
import type { DataItemData } from '../../web/shared/types';

export const DATA_HOSTS: { coingecko: string; espn: string; espnImg: string; finnhub: string; frankfurter: string };
export const DATA_HOST_LIST: readonly string[];
export const MARKET_CURRENCIES: string[];
export const MARKET_RANGES: ('1d' | '7d' | '30d')[];
export const COIN_ID_RE: RegExp;
export const TEAM_ID_RE: RegExp;
export const STOCK_SYMBOL_RE: RegExp;
export const STOCKS_KEY_RE: RegExp;
export const FX_CODE_RE: RegExp;
export const FX_BASE: string;
export const FX_CURRENCIES: string[];
export const CURRENCY_RANGES: ('7d' | '30d' | '1y')[];
export interface SportsLeague { id: string; sport: string; name: string; short: string }
export const SPORTS_LEAGUES: SportsLeague[];
export function sportsLeague(id: string): SportsLeague | null;
export const DATA_LIMITS: { coins: number; follow: number; games: number; symbols: number; pairs: number; chartPoints: number; searchResults: number };

/** Spacing between two calls to one host (ms), answer size caps, the call timeout and the shortest interval. */
export const HOST_GAP_MS: Record<string, number>;
export const DATA_MAX_BYTES: number;
export const CREST_MAX_BYTES: number;
export const DATA_TIMEOUT_MS: number;
export const DATA_MIN_TTL_MS: number;
export const DATA_TTL: {
  markets: number; chart30: number; coinSearch: number; sportsIdle: number; sportsLive: number; results: number; fixtures: number;
  teams: number; quoteOpen: number; quoteClosed: number; symbolSearch: number; fx: number; fxDue: number; fxYear: number; fxCurrencies: number;
};
export const MARKETS_MAX_IDS: number;
export const HOST_QUEUE_MAX: number;
export const HOST_SEARCH_QUEUE_MAX: number;
export const CREST_TOKEN_RE: RegExp;

export class DataError extends Error {
  code: string;
  retryMs: number | null;
  constructor(code: string, detail?: string, retryMs?: number | null);
}

/** A game as the parsers read it (the crest is a path on a.espncdn.com, never sent to a screen). */
export interface DataSide { id: string; n: string; ab: string; sc: string; w: boolean; c: string | null; logo: string | null }
export interface DataEvent { id: string; t: number; st: 'pre' | 'in' | 'post'; clk: string; note?: string; half?: true; home: DataSide; away: DataSide }
export interface DataCoin { id: string; sym: string; name: string; price: number; ch: Record<'1d' | '7d' | '30d', number | null>; spark: [number, number][]; at: number }
export interface DataQuote { price: number; ch: number | null; prev: number | null; t: number }

export function marketsRequest(currency: string, ids: string[]): DataRequest;
export function chartRequest(id: string, currency: string): DataRequest;
export function coinSearchRequest(text: string): DataRequest;
export function scoreboardRequest(l: { id: string; sport: string }): DataRequest;
export function resultsRequest(l: { id: string; sport: string }, team: string): DataRequest;
export function fixturesRequest(l: { id: string; sport: string }, team: string): DataRequest;
export function teamsRequest(l: { id: string; sport: string }): DataRequest;
export function quoteRequest(sym: string, key: string): DataRequest;
export function symbolSearchRequest(text: string, key: string): DataRequest;
export function fxMonthRequest(now: number): DataRequest;
export function fxYearRequest(now: number): DataRequest;
export function fxCurrenciesRequest(): DataRequest;

/** Rates against the euro: the dates in order and, per currency, a rate (or null) for each date. */
export interface FxSeries { dates: string[]; rates: Record<string, (number | null)[]> }
export function parseFxSeries(text: string): FxSeries;
export function parseFxCurrencies(text: string): { code: string; name: string }[];
export function fxRate(series: FxSeries, base: string, quote: string, i: number): number | null;
export function fxPairOf(sym: string): { base: string; quote: string } | null;
export function fxTtl(series: FxSeries | null | undefined, now: number): number;
export function statusError(host: string, status: number): DataError | null;

export function thin<T>(points: T[], n: number): T[];
export function parseMarkets(text: string): Map<string, DataCoin>;
export function parseChart(text: string): [number, number][];
export function parseCoinSearch(text: string): { id: string; sym: string; name: string; rank: number | null }[];
export function crestPath(url: string): string | null;
export function crestToken(path: string): string;
export function parseEvent(e: unknown, sport?: string): DataEvent | null;
export function parseEvents(text: string, sport?: string): DataEvent[];
export function parseTeams(text: string): { id: string; name: string; abbr: string }[];
export function parseQuote(text: string): DataQuote | null;
export function parseSymbolSearch(text: string): { sym: string; name: string; type: string }[];
export function sportsTtl(events: DataEvent[] | null | undefined, now: number): number;
export function quoteTtl(quote: DataQuote | null | undefined, now: number): number;
export function pickGames(entry: { type: string; team?: string }, ev: DataEvent[], show: string, max: number, now: number): DataEvent[];
export function stocksKeyStatus(key: string): { set: boolean; last4: string };

export interface DataRequest { host: string; path: string; headers?: Record<string, string> }
export interface DataAnswer { status: number; text: string; retryAfterMs?: number }
export interface DataHub {
  now(): number;
  crest(token: string): string | null;
  keyChanged(): void;
}
export function createDataHub(opts: {
  call: (req: DataRequest) => Promise<DataAnswer>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  stocksKey?: () => string;
  log?: (msg: string) => void;
  max?: number;
}): DataHub;
export function dataForItem(hub: DataHub, item: { kind: string; props: Record<string, unknown> }, now?: number, opts?: { preview?: boolean }): Promise<DataItemData | null>;
