// Travel times of the Trayectos cards on a Personalizado screen (docs/API.md "Commute times"). The server asks Google
// with the owner's key and keeps every leg in a cache it shares with the commute widgets; this page only asks the
// server, GET /api/display/commute?item=<card id>&v=<sig>, for each card on screen, every refreshMin minutes (with a
// little jitter) while the page is visible, and again when the card's routes change (its sig). The display never has
// the addresses: the server reads the saved card. Nothing here ever talks to Google.
// The demo (?demo=1) draws made-up times (mockCommute.ts). In the admin preview, a card not saved yet or changed (404,
// 409) shows made-up times marked "Ejemplo", so a design can be picked before saving, at no cost.
import { canvasCards } from '../../server/core/canvasCore.js';
import { MIN_COMMUTE_REFRESH_MIN } from '../../server/core/commuteCore.js';
import type { CommuteMode, CommuteResponse, CommuteRouteResult, DisplayCanvasItem, DisplayCommuteCardProps, DisplayConfig } from '../shared/types';
import { ApiError, getJSON } from './api';
import { isPreview, withScreen } from './identity';
import { demoCommute } from './mockCommute';

/**
 * Where a card's times are: 'loading' (not asked yet), 'ok', 'sample' (the preview of an unsaved card: draw made-up
 * times), 'gone' (the server shows it nothing: hidden, private, removed), 'error' (no answer yet).
 */
export type CommuteState = 'loading' | 'ok' | 'sample' | 'gone' | 'error';

/** What the Trayectos adapter reads (widgets/canvas/types.ts AdapterEnv.commute). */
export interface CommuteSource {
  /** the times of a card: undefined before the first answer, null when there are none */
  get(itemId: string): CommuteResponse | null | undefined;
  state(itemId: string): CommuteState;
  /** seconds since the times were read from Google (the oldest route shown), or null */
  age(itemId: string): number | null;
}

const MODES: CommuteMode[] = ['driving', 'transit', 'bicycling', 'walking'];
const TRAFFIC = ['clear', 'moderate', 'heavy'];
const RETRY_MS = 60_000;
const SAMPLE_MS = 20_000;
const GONE_MS = 5 * 60_000;
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined);
const text = (x: unknown, max = 120) => (typeof x === 'string' ? x.slice(0, max) : '');

/** Only answers of the right shape are kept (a wrong one is never drawn). */
export function cleanCommute(v: unknown): CommuteResponse | null {
  if (!isObj(v) || typeof v.keySet !== 'boolean' || !Array.isArray(v.routes)) return null;
  const routes: CommuteRouteResult[] = [];
  for (const r of v.routes.slice(0, 8)) {
    if (!isObj(r) || typeof r.id !== 'string') continue;
    routes.push({
      id: text(r.id, 64),
      name: text(r.name, 60),
      mode: MODES.includes(r.mode) ? r.mode : 'driving',
      reversed: r.reversed === true,
      active: r.active !== false,
      ok: r.ok === true && (num(r.durationSec) ?? 0) > 0,
      durationSec: num(r.durationSec),
      normalDurationSec: num(r.normalDurationSec),
      delaySec: num(r.delaySec),
      delayMin: num(r.delayMin),
      traffic: TRAFFIC.includes(r.traffic) ? r.traffic : 'clear',
      distanceMeters: num(r.distanceMeters),
      summary: text(r.summary),
      fetchedAt: typeof r.fetchedAt === 'string' ? r.fetchedAt : undefined,
      stale: r.stale === true,
      error: typeof r.error === 'string' ? text(r.error, 40) : null,
    });
  }
  return { fetchedAt: typeof v.fetchedAt === 'string' ? v.fetchedAt : '', keySet: v.keySet, routes };
}

/** The Trayectos cards of a screen's config (on it, in a Rotativa, in a group), not disabled. */
export function commuteCards(cfg: DisplayConfig | null | undefined): DisplayCanvasItem[] {
  return (canvasCards(cfg?.canvas?.items) as DisplayCanvasItem[]).filter((it) => it.kind === 'commute' && !it.disabled);
}

interface Entry {
  sig: string;
  props: DisplayCommuteCardProps;
  data: CommuteResponse | null | undefined;
  state: CommuteState;
  at: number;
  timer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  due: number;
}

export class CommuteFeed implements CommuteSource {
  private items = new Map<string, Entry>();
  private screenId = '';
  /** the demo's answer (?demo=1): no server */
  demo: ((props: DisplayCommuteCardProps) => CommuteResponse) | null = null;

  constructor(private changed: () => void) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      for (const [id, e] of this.items) if (!e.timer && !e.busy) this.ask(id);
    });
  }

  /** The screen on display changed (a new config, a carousel step, an edit in the preview). */
  config(cfg: DisplayConfig): void {
    const screen = cfg.screenId ?? '';
    if (screen !== this.screenId) {
      for (const e of this.items.values()) if (e.timer) clearTimeout(e.timer);
      this.items.clear();
      this.screenId = screen;
    }
    const seen = new Set<string>();
    let gone = false;
    for (const it of commuteCards(cfg)) {
      const props = it.props as unknown as DisplayCommuteCardProps;
      const sig = `${props.sig ?? ''}|${(props.routes ?? []).map((r) => `${r.id}:${r.mode}:${r.name}`).join(',')}`;
      seen.add(it.id);
      const e = this.items.get(it.id);
      if (e && e.sig === sig) {
        e.props = props;
        continue;
      }
      if (e?.timer) clearTimeout(e.timer);
      this.items.set(it.id, { sig, props, data: undefined, state: 'loading', at: 0, timer: null, busy: false, due: 0 });
      this.ask(it.id);
    }
    for (const [id, e] of this.items) {
      if (seen.has(id)) continue;
      if (e.timer) clearTimeout(e.timer);
      this.items.delete(id);
      gone = true;
    }
    if (gone) this.changed();
  }

  /** Ask again now (the poll channel came back, the page became visible). */
  refresh(): void {
    const now = Date.now();
    for (const [id, e] of this.items) if (!e.busy && now >= e.due) this.ask(id);
  }

  private later(id: string, e: Entry, ms: number): void {
    if (e.timer) clearTimeout(e.timer);
    e.due = Date.now() + ms;
    // a hidden page asks nothing: visibilitychange asks again when it shows
    e.timer = setTimeout(() => {
      e.timer = null;
      if (!document.hidden && this.items.get(id) === e) this.ask(id);
    }, ms * (0.9 + Math.random() * 0.2));
  }

  private ask(id: string): void {
    const e = this.items.get(id);
    if (!e || e.busy) return;
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    const pollMs = Math.max(MIN_COMMUTE_REFRESH_MIN, Number(e.props.refreshMin) || MIN_COMMUTE_REFRESH_MIN) * 60_000;
    // a card with no route written yet asks nothing (the adapter says to finish it in the editor)
    if (!e.props.routes?.length) {
      this.set(e, null, 'ok');
      return;
    }
    if (this.demo) {
      this.set(e, this.demo(e.props), 'ok');
      this.later(id, e, pollMs);
      return;
    }
    if (document.hidden) return;
    e.busy = true;
    const sig = e.sig;
    const path = `/api/display/commute?item=${encodeURIComponent(id)}&v=${encodeURIComponent(e.props.sig ?? '')}`;
    getJSON<CommuteResponse>(withScreen(path), 20000)
      .then((r) => {
        if (this.items.get(id) !== e || e.sig !== sig) return;
        const d = cleanCommute(r);
        if (d) {
          this.set(e, d, 'ok');
          this.later(id, e, pollMs);
        } else {
          this.set(e, e.data ?? null, e.data ? 'ok' : 'error');
          this.later(id, e, RETRY_MS);
        }
      }, (err) => {
        if (this.items.get(id) !== e || e.sig !== sig) return;
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 404 || status === 409) {
          // the preview of a card not saved yet (404) or changed (409): made-up times until it is saved; on a screen,
          // the server shows this card nothing now (hidden, private, removed): the card is not drawn
          this.set(e, null, isPreview ? 'sample' : 'gone');
          this.later(id, e, isPreview ? SAMPLE_MS : status === 409 ? RETRY_MS : GONE_MS);
          return;
        }
        // no answer: what is on screen stays (marked old by its own times), asked again sooner
        this.set(e, e.data ?? null, e.data ? 'ok' : 'error');
        this.later(id, e, e.data ? pollMs / 2 : RETRY_MS);
      })
      .finally(() => {
        e.busy = false;
      });
  }

  private set(e: Entry, data: CommuteResponse | null, state: CommuteState): void {
    const before = JSON.stringify([e.data, e.state]);
    e.data = data;
    e.state = state;
    e.at = Date.now();
    if (JSON.stringify([e.data, e.state]) !== before) this.changed();
  }

  get(itemId: string): CommuteResponse | null | undefined {
    return this.items.get(itemId)?.data;
  }

  state(itemId: string): CommuteState {
    return this.items.get(itemId)?.state ?? 'loading';
  }

  age(itemId: string): number | null {
    const d = this.items.get(itemId)?.data;
    if (!d) return null;
    let oldest = Infinity;
    for (const r of d.routes) {
      const t = r.ok && r.fetchedAt ? Date.parse(r.fetchedAt) : NaN;
      if (Number.isFinite(t)) oldest = Math.min(oldest, t);
    }
    return Number.isFinite(oldest) ? Math.max(0, Math.round((Date.now() - oldest) / 1000)) : null;
  }
}

/** The demo's times of a card (mockCommute.ts), at the display's clock. */
export function demoCommuteFor(props: DisplayCommuteCardProps, nowMs = Date.now()): CommuteResponse {
  return demoCommute(props.routes ?? [], nowMs);
}
