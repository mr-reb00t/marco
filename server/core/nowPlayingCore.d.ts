// Types for nowPlayingCore.js ("now playing": Spotify accounts for the Sonando ahora card and the line under the clock).
import type { NowPlayingData } from '../../web/shared/types';

export { NOW_PLAYING_ACCOUNT_RE, nowPlayingAccounts } from './canvasCore.js';

export const NOW_PLAYING_PROVIDERS: string[];
export const SPOTIFY_AUTH_URL: string;
export const SPOTIFY_TOKEN_URL: string;
export const SPOTIFY_API: string;
export const SPOTIFY_NOW_URL: string;
export const SPOTIFY_ME_URL: string;
export const SPOTIFY_SCOPES: string;
export const SPOTIFY_CALLBACK_PATH: string;
export const SPOTIFY_APPS_URL: string;
export const SPOTIFY_DASHBOARD_URL: string;
export const SPOTIFY_CLIENT_ID_RE: RegExp;
export const SPOTIFY_SECRET_RE: RegExp;
export const NOW_PLAYING_MAX_ACCOUNTS: number;
export const SPOTIFY_OAUTH_ERRORS: Set<string>;
export const SPOTIFY_AUTH_ERRORS: Set<string>;
export const SPOTIFY_APP_ERRORS: Set<string>;
export const NOW_PLAYING_TIMING: { playing: number; idle: number; soonest: number; errorMin: number; errorMax: number; rateLimited: number; stale: number };
export const NOW_PLAYING_ART_TOKEN_RE: RegExp;
export const NOW_PLAYING_ART_MAX_BYTES: number;

/** What plays, as the server keeps it (the cover's address never leaves the server). */
export interface NowPlayingValue {
  provider: 'spotify';
  kind: 'track' | 'episode';
  title: string;
  artist: string;
  album: string;
  artUrl: string;
  progress: number | null;
  duration: number | null;
}
export interface NowPlayingEntry {
  at: number;
  value: NowPlayingValue | null;
  fails: number;
  until: number;
  error: '' | 'auth' | 'app' | 'rate_limited' | 'unavailable';
}

export function spotifyAuthUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string }): string;
export function spotifyBasicAuth(clientId: string, secret: string): string;
export function codeExchangeBody(o: { code: string; redirectUri: string; verifier: string }): Record<string, string>;
export function refreshBody(refreshToken: string): Record<string, string>;
export function spotifyRedirect(base: string): { redirectUri: string; paste: boolean };
export function pastedCallback(text: unknown): { state: string; code: string; error: string } | null;
export function spotifyAccountName(me: unknown): string;
export function artAllowed(url: unknown): boolean;
export function pickArt(images: unknown): string;
export function artToken(url: string): string;
export function mapSpotifyNow(status: number, json: unknown): NowPlayingValue | null;
export function nextEntry(prev: NowPlayingEntry | null | undefined, res: { status: number; json?: unknown; retryAfterMs?: number | null; auth?: boolean; app?: boolean }, now: number): NowPlayingEntry;
export function entryDue(entry: NowPlayingEntry | null | undefined, now: number): boolean;
export function displayItem(entry: NowPlayingEntry | null | undefined, now: number): NowPlayingData | null;
export function nextPollSec(entries: (NowPlayingEntry | null | undefined)[], now: number): number;
export function artUrls(entries: (NowPlayingEntry | null | undefined)[]): Map<string, string>;
export function askedAccounts(asked: unknown, allowed: Iterable<string>): string[];
export function newAccountId(bytes: Uint8Array): string;
