// Numbers of the data cards on a Personalizado screen (market, sports, stocks; docs/API.md). The server fetches and
// caches them from the sources (server/dataFeeds.js); this page only asks the server: GET /api/display/data for the
// items of its own screen, every minute while such a card is on screen and the page is visible, and team crests by
// token (GET /api/display/data/crest/:token). Nothing here ever talks to a third party.
// In the admin preview, the builder posts the numbers of items not saved yet ('marco:preview-data'); they win over
// what the server sends for the same item. The demo (?demo=1) works them out from made-up answers (mockData.ts).
import { canvasCards } from '../../server/core/canvasCore.js';
import type { DataItemData, DisplayConfig, DisplayDataResponse } from '../shared/types';
import { ApiError, getJSON } from './api';
import { authHeaders, isPreview, withScreen } from './identity';

/** What the canvas adapters read (widgets/canvas/types.ts AdapterEnv.data). */
export interface DataSource {
  /** the numbers of an item: undefined before the first answer, null when the server has none */
  get(itemId: string): DataItemData | null | undefined;
  /** seconds since the numbers were read upstream, now (null: unknown) */
  age(itemId: string): number | null;
  /** an object URL of a crest, or null (none, or not loaded yet: `onLoad` runs when it comes) */
  crest(token: string, onLoad?: () => void): string | null;
}

const DATA_KINDS = ['market', 'sports', 'stocks'];
const POLL_MS = 60_000;
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);

/** True when the screen of `cfg` draws a data card. */
export function showsData(cfg: DisplayConfig | null | undefined): boolean {
  return canvasCards(cfg?.canvas?.items).some((it) => !it.disabled && DATA_KINDS.includes(it.kind));
}

/** Only answers of the three shapes are kept (a wrong one is never drawn). */
function clean(v: unknown): DataItemData | null {
  if (!isObj(v) || !DATA_KINDS.includes(v.kind)) return null;
  if (v.kind === 'market' && !Array.isArray(v.coins)) return null;
  if (v.kind === 'sports' && !Array.isArray(v.groups)) return null;
  if (v.kind === 'stocks' && !Array.isArray(v.quotes)) return null;
  return v as DataItemData;
}

export class DataFeed implements DataSource {
  private items = new Map<string, { d: DataItemData | null; at: number }>();
  private preview = new Map<string, { d: DataItemData; at: number }>();
  private crests = new Map<string, { url: string | null; p: Promise<void> | null; waiting: (() => void)[] }>();
  private screenId = '';
  private wanted = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private lastAsk = 0;
  private answered = false;
  /** the demo's numbers (?demo=1): no server */
  demo: ((cfg: DisplayConfig) => Promise<Record<string, DataItemData>>) | null = null;
  private cfg: DisplayConfig | null = null;

  constructor(private changed: () => void) {
    if (isPreview) {
      window.addEventListener('message', (e) => {
        if (e.source !== window.parent) return;
        const d = e.data;
        if (d?.type !== 'marco:preview-data' || !isObj(d.items)) return;
        for (const [id, v] of Object.entries(d.items)) {
          const c = clean(v);
          if (c) this.preview.set(id, { d: c, at: Date.now() });
        }
        this.changed();
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.wanted && Date.now() - this.lastAsk > POLL_MS) this.refresh();
    });
  }

  /** The screen on display changed (a new config, a carousel step, privacy on or off). */
  config(cfg: DisplayConfig): void {
    const before = this.screenId;
    this.cfg = cfg;
    this.screenId = cfg.screenId ?? '';
    this.wanted = showsData(cfg);
    if (before !== this.screenId) {
      this.items.clear();
      this.answered = false;
    }
    this.syncTimer();
    this.refresh();
  }

  /** Ask the server for the numbers of the screen on display (it answers from its cache). */
  refresh(): void {
    if (!this.wanted || this.busy) return;
    this.busy = true;
    this.lastAsk = Date.now();
    const id = this.screenId;
    const done = (items: Record<string, unknown>) => {
      if (id !== this.screenId) return;
      const now = Date.now();
      this.items.clear();
      for (const [k, v] of Object.entries(items)) this.items.set(k, { d: clean(v), at: now });
      this.answered = true;
      this.changed();
    };
    const p = this.demo && this.cfg
      ? this.demo(this.cfg).then(done)
      : getJSON<DisplayDataResponse>(withScreen('/api/display/data'), 15000).then((r) => done(isObj(r?.items) ? r.items : {}), (e) => {
        // private or not allowed: nothing to show; anything else keeps what is on screen
        if (e instanceof ApiError && (e.status === 403 || e.status === 404) && id === this.screenId) done({});
      });
    void p.catch(() => undefined).finally(() => (this.busy = false));
  }

  private syncTimer(): void {
    if (this.wanted && !this.timer) {
      this.timer = setInterval(() => {
        if (!document.hidden) this.refresh();
      }, POLL_MS);
    } else if (!this.wanted && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get(itemId: string): DataItemData | null | undefined {
    const pv = isPreview ? this.preview.get(itemId) : undefined;
    if (pv) return pv.d;
    const hit = this.items.get(itemId);
    if (hit) return hit.d;
    return this.answered ? null : undefined;
  }

  age(itemId: string): number | null {
    const hit = (isPreview ? this.preview.get(itemId) : undefined) ?? this.items.get(itemId);
    const a = hit?.d?.age;
    if (!hit || typeof a !== 'number') return null;
    return a + Math.max(0, Math.round((Date.now() - hit.at) / 1000));
  }

  crest(token: string, onLoad?: () => void): string | null {
    if (!/^[0-9a-f]{16}$/.test(token) || this.demo) return null;
    let c = this.crests.get(token);
    if (c) {
      if (!c.url && c.p && onLoad) c.waiting.push(onLoad);
      return c.url;
    }
    c = { url: null, p: null, waiting: onLoad ? [onLoad] : [] };
    const entry = c;
    entry.p = fetch(withScreen(`/api/display/data/crest/${token}`), { headers: authHeaders() })
      .then(async (r) => {
        if (!r.ok || !/^image\/(png|jpeg|webp)$/.test(r.headers.get('content-type') || '')) return;
        entry.url = URL.createObjectURL(await r.blob());
        for (const fn of entry.waiting) fn();
      })
      .catch(() => undefined)
      .finally(() => {
        entry.p = null;
        entry.waiting = [];
      });
    this.crests.set(token, entry);
    if (this.crests.size > 80) {
      const [k, old] = this.crests.entries().next().value!;
      if (old.url) URL.revokeObjectURL(old.url);
      this.crests.delete(k);
    }
    return null;
  }
}
