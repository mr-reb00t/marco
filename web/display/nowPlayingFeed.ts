// What the linked Spotify accounts of this screen play now (issue #18; docs/API.md "Now playing"): the Sonando ahora
// cards and the line under the clock. The server reads Spotify and shares one entry per account between every screen;
// this page only asks the server, GET /api/display/nowplaying?accounts=..., while such a card or line is on screen and
// the page is visible, when the server says (`next`: sooner when the track is about to end). Covers come by token
// from GET /api/display/nowplaying/art/:token as blobs. Nothing here ever talks to Spotify.
// The demo (?demo=1) plays a made-up track without a server.
import { nowPlayingAccounts } from '../../server/core/nowPlayingCore.js';
import type { DisplayConfig, DisplayNowPlayingResponse, NowPlayingData } from '../shared/types';
import { ApiError, getJSON } from './api';
import { authHeaders, withScreen } from './identity';

/** What the adapters and the line read (widgets/canvas/types.ts AdapterEnv.nowPlaying). */
export interface NowPlayingSource {
  /** what `account` plays: undefined before the first answer, null when nothing plays */
  get(account: string): NowPlayingData | null | undefined;
  /** seconds into the track now (moved on since the answer while it plays), or null */
  position(account: string): number | null;
  /** an object URL of a cover, or null (none, or not loaded yet: `onLoad` runs when it comes) */
  art(token: string, onLoad?: () => void): string | null;
}

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const TOKEN_RE = /^[0-9a-f]{16}$/;
const DEFAULT_NEXT = 10;

/**
 * The accounts the screen of `cfg` shows, in a stable order: its Sonando ahora cards and the line under the clock (the
 * server answers only for the ones the screen's own layout shows, core nowPlayingAccounts).
 */
export function shownAccounts(cfg: DisplayConfig | null | undefined): string[] {
  if (!cfg) return [];
  const cards = cfg.canvas ? (nowPlayingAccounts({ layout: { preset: 'canvas' }, canvas: cfg.canvas }) as string[]) : [];
  const line = nowPlayingAccounts({ layout: { preset: '' }, screen: cfg.screen }) as string[];
  return [...new Set([...cards, ...line])].slice(0, 8);
}

/** Only answers of the right shape are kept (a wrong one is never drawn). */
function clean(v: unknown): NowPlayingData | null {
  if (!isObj(v) || typeof v.title !== 'string' || !v.title) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
  return {
    provider: 'spotify',
    kind: v.kind === 'episode' ? 'episode' : 'track',
    title: v.title,
    artist: typeof v.artist === 'string' ? v.artist : '',
    album: typeof v.album === 'string' ? v.album : '',
    art: typeof v.art === 'string' && TOKEN_RE.test(v.art) ? v.art : '',
    playing: true,
    progress: num(v.progress),
    duration: num(v.duration),
  };
}

export class NowPlayingFeed implements NowPlayingSource {
  private items = new Map<string, { d: NowPlayingData | null; at: number }>();
  private covers = new Map<string, { url: string | null; waiting: (() => void)[] }>();
  private accounts: string[] = [];
  private screenId = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private next = DEFAULT_NEXT;
  private answered = false;
  /** the demo's answer (?demo=1): no server */
  demo: ((accounts: string[]) => Record<string, NowPlayingData | null>) | null = null;

  constructor(private changed: () => void) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.refresh();
    });
  }

  /** The screen on display changed (a new config, a carousel step, privacy on or off, an edit in the preview). */
  config(cfg: DisplayConfig): void {
    const list = shownAccounts(cfg);
    const before = `${this.screenId}|${this.accounts.join(',')}`;
    this.screenId = cfg.screenId ?? '';
    this.accounts = list;
    if (before === `${this.screenId}|${list.join(',')}`) return;
    for (const k of [...this.items.keys()]) if (!list.includes(k)) this.items.delete(k);
    this.answered = false;
    this.stop();
    this.refresh();
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.stop();
    if (!this.accounts.length || document.hidden) return;
    this.timer = setTimeout(() => this.refresh(), Math.max(3, Math.min(60, this.next)) * 1000);
  }

  /** Ask the server what the accounts play (it answers from its shared entries). */
  refresh(): void {
    if (this.busy) return;
    if (!this.accounts.length) {
      if (this.items.size) {
        this.items.clear();
        this.prune();
        this.changed();
      }
      return;
    }
    if (document.hidden) return;
    this.busy = true;
    const asked = this.accounts.join(',');
    const done = (items: Record<string, unknown>, next: number) => {
      this.next = next;
      if (asked !== this.accounts.join(',')) return;
      const now = Date.now();
      const sig = JSON.stringify([...this.items.entries()].map(([k, v]) => [k, v.d?.title, v.d?.artist, v.d?.art]));
      this.items.clear();
      for (const a of this.accounts) this.items.set(a, { d: clean(items[a]), at: now });
      this.answered = true;
      this.prune();
      // the bars move by themselves: only a new track (or one that stops) draws again; a progress jump does too
      const after = JSON.stringify([...this.items.entries()].map(([k, v]) => [k, v.d?.title, v.d?.artist, v.d?.art]));
      const jump = this.jumped();
      if (sig !== after || jump) this.changed();
    };
    const p = this.demo
      ? Promise.resolve(this.demo(this.accounts)).then((items) => done(items, DEFAULT_NEXT))
      : getJSON<DisplayNowPlayingResponse>(withScreen(`/api/display/nowplaying?accounts=${encodeURIComponent(asked)}`), 15000).then(
          (r) => done(isObj(r?.items) ? r.items : {}, typeof r?.next === 'number' ? r.next : DEFAULT_NEXT),
          (e) => {
            // private or not allowed: nothing shows; anything else keeps what is on screen and asks again later
            if (e instanceof ApiError && (e.status === 403 || e.status === 404)) done({}, 30);
            else this.next = 30;
          },
        );
    void p.catch(() => undefined).finally(() => {
      this.busy = false;
      this.schedule();
    });
  }

  /** The positions the adapters drew last are far from the new ones (a seek): draw again. */
  private lastPos = new Map<string, { p: number; t: number }>();
  private jumped(): boolean {
    let j = false;
    const now = Date.now();
    for (const a of this.accounts) {
      const p = this.position(a);
      const was = this.lastPos.get(a);
      // where the last answer said it would be by now
      if (p !== null && was && Math.abs(p - (was.p + (now - was.t) / 1000)) > 4) j = true;
      if (p !== null) this.lastPos.set(a, { p, t: now });
      else this.lastPos.delete(a);
    }
    return j;
  }

  get(account: string): NowPlayingData | null | undefined {
    const hit = this.items.get(account);
    if (hit) return hit.d;
    return this.answered || !this.accounts.includes(account) ? null : undefined;
  }

  position(account: string): number | null {
    const hit = this.items.get(account);
    const d = hit?.d;
    if (!d || d.progress === null) return null;
    const p = d.progress + Math.max(0, (Date.now() - hit.at) / 1000);
    return d.duration ? Math.min(d.duration, p) : p;
  }

  /** Covers no track on screen uses any more are let go (no cover is kept longer than it shows). */
  private prune(): void {
    const keep = new Set([...this.items.values()].map((v) => v.d?.art).filter(Boolean) as string[]);
    for (const [k, c] of this.covers) {
      if (keep.has(k)) continue;
      if (c.url) URL.revokeObjectURL(c.url);
      this.covers.delete(k);
    }
  }

  art(token: string, onLoad?: () => void): string | null {
    if (!TOKEN_RE.test(token) || this.demo) return null;
    let c = this.covers.get(token);
    if (c) {
      if (!c.url && onLoad) c.waiting.push(onLoad);
      return c.url;
    }
    c = { url: null, waiting: onLoad ? [onLoad] : [] };
    const entry = c;
    this.covers.set(token, entry);
    void fetch(withScreen(`/api/display/nowplaying/art/${token}`), { headers: authHeaders() })
      .then(async (r) => {
        if (!r.ok || !/^image\/(png|jpeg|webp)$/.test(r.headers.get('content-type') || '')) return;
        const url = URL.createObjectURL(await r.blob());
        // let go meanwhile (the track changed): not kept
        if (this.covers.get(token) !== entry) return URL.revokeObjectURL(url);
        entry.url = url;
        for (const fn of entry.waiting) fn();
      })
      .catch(() => undefined)
      .finally(() => {
        entry.waiting = [];
      });
    return null;
  }
}

/** The account the demo's line under the clock follows (?demo=1&np=1). */
export const DEMO_NOW_PLAYING_ACCOUNT = 'sp_demo0000000';

/** The demo's answer: a made-up track for every account (none with `idle`), half way through. */
export function demoNowPlaying(accounts: string[], idle = false): Record<string, NowPlayingData | null> {
  const out: Record<string, NowPlayingData | null> = {};
  accounts.forEach((a, i) => {
    out[a] = idle ? null : {
      provider: 'spotify', kind: 'track', playing: true, art: '',
      title: i % 2 ? 'Long Way Round the Lake' : 'Sunday Morning Pancakes',
      artist: i % 2 ? 'The Quiet Hours' : 'Ana and the Weekend Band', album: i % 2 ? 'Field Notes' : 'Kitchen Radio',
      progress: 74, duration: 212,
    };
  });
  return out;
}
