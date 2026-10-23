// Pushed values on a Personalizado screen (the Valor card and custom cards bound to a key; docs/API.md). The server
// sends only the keys this screen shows: a full snapshot when the stream opens or when this page asks
// (GET /api/display/values), and the keys that changed as the SSE `values` event. A display on the poll channel asks
// every 30 s while such a card is on screen and the page is visible. Values are plain text everywhere: the cards
// write them with textContent and never read them as HTML, a URL or a colour.
// In the admin preview, the builder posts the values it knows ('marco:preview-values'), so a card not saved yet
// shows its key's value too.
import { canvasCards } from '../../server/core/canvasCore.js';
import type { DisplayConfig, DisplayValue, ValuesSnapshot } from '../shared/types';
import { getJSON } from './api';
import { isPreview, withScreen } from './identity';

/** What the canvas adapters read (widgets/canvas/types.ts AdapterEnv.values). */
export interface ValueSource {
  /** the value of a key: undefined before the first answer, null when the server has none */
  get(key: string): DisplayValue | null | undefined;
  /** a condition ("Mostrar solo si") on a value hides this item now (true until the server has said) */
  hidden(itemId: string): boolean;
}

const POLL_MS = 30_000;

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);

/** A value as it came, or null when it is not one (a wrong type is never shown). */
function clean(v: unknown): DisplayValue | null {
  if (!isObj(v)) return null;
  const x = v.v;
  if (!(typeof x === 'number' && Number.isFinite(x)) && typeof x !== 'string' && typeof x !== 'boolean') return null;
  const out: DisplayValue = { v: typeof x === 'string' ? x.slice(0, 120) : x, at: Number(v.at) || 0 };
  if (typeof v.u === 'string' && v.u) out.u = v.u.slice(0, 16);
  if (typeof v.l === 'string' && v.l) out.l = v.l.slice(0, 40);
  return out;
}

/** True when the screen of `cfg` draws a card that reads a pushed value. */
export function showsValues(cfg: DisplayConfig | null | undefined): boolean {
  // (the own conditions of a Rotativa's cards, groups and small Rotativas' cards too)
  const val = (w: unknown) => isObj(w) && w.src === 'value';
  return canvasCards(cfg?.canvas?.items).some((it) => val(it.when) || val((it as { own?: unknown }).own) || val((it as { inner?: unknown }).inner) || (!it.disabled && (it.kind === 'value' || (it.kind === 'html' && Array.isArray(it.props.bind) && it.props.bind.some((b) => isObj(b) && typeof b.value === 'string' && b.value)))));
}

export class ValuesFeed implements ValueSource {
  private stores = new Map<string, { rev: number; values: Record<string, DisplayValue | null>; hide: Set<string> }>();
  private screenId = '';
  private wanted = false;
  private pollMode = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private preview: Record<string, DisplayValue> = {};
  /** the demo's values (?demo=1): no server */
  demo: (() => Record<string, DisplayValue>) | null = null;

  constructor(private changed: () => void) {
    if (isPreview) {
      window.addEventListener('message', (e) => {
        if (e.source !== window.parent) return;
        const d = e.data;
        if (d?.type !== 'marco:preview-values' || !isObj(d.values)) return;
        this.preview = {};
        for (const [k, v] of Object.entries(d.values)) {
          const c = clean(v);
          if (c) this.preview[k] = c;
        }
        this.changed();
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.wanted && this.pollMode) this.refresh();
    });
  }

  /** The screen on display changed (a new config, a carousel step, privacy on or off). */
  config(cfg: DisplayConfig): void {
    this.screenId = cfg.screenId ?? '';
    this.wanted = showsValues(cfg);
    this.syncPoll();
    // a new screen, new cards or the end of private mode: the values now (the stream only sends what changes)
    this.refresh();
  }

  /** The display uses the poll channel: no `values` events come, ask every 30 s instead. */
  setPollMode(on: boolean): void {
    this.pollMode = on;
    this.syncPoll();
  }

  /** A `values` event (live.ts dispatch), or the answer of GET /api/display/values. */
  apply(snap: ValuesSnapshot): void {
    if (!isObj(snap) || typeof snap.rev !== 'number' || !isObj(snap.values)) return;
    const id = typeof snap.screenId === 'string' && snap.screenId ? snap.screenId : this.screenId;
    const cur = this.stores.get(id);
    if (cur && !snap.full && snap.rev < cur.rev) return;
    const values: Record<string, DisplayValue | null> = snap.full || !cur ? {} : { ...cur.values };
    for (const [k, v] of Object.entries(snap.values)) values[k] = clean(v);
    const hide = Array.isArray(snap.hide) ? new Set(snap.hide.filter((x): x is string => typeof x === 'string')) : snap.full || !cur ? new Set<string>() : cur.hide;
    this.stores.set(id, { rev: Math.max(snap.rev, cur?.rev ?? 0), values, hide });
    if (this.stores.size > 12) this.stores.delete(this.stores.keys().next().value!);
    if (id === this.screenId) this.changed();
  }

  /** Ask the server for the values of the screen on display. */
  refresh(): void {
    if (!this.wanted) return;
    if (this.demo) {
      this.stores.set(this.screenId, { rev: 1, values: this.demo(), hide: new Set() });
      this.changed();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    getJSON<ValuesSnapshot>(withScreen('/api/display/values'), 8000)
      .then((s) => this.apply({ ...s, full: true }))
      .catch(() => undefined)
      .finally(() => (this.busy = false));
  }

  private syncPoll(): void {
    const on = this.wanted && this.pollMode && !this.demo;
    if (on && !this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (!document.hidden) this.refresh();
      }, POLL_MS);
    } else if (!on && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  hidden(itemId: string): boolean {
    const s = this.stores.get(this.screenId);
    return !s || s.hide.has(itemId);
  }

  get(key: string): DisplayValue | null | undefined {
    if (isPreview && Object.prototype.hasOwnProperty.call(this.preview, key)) return this.preview[key];
    const s = this.stores.get(this.screenId);
    if (!s) return undefined;
    return Object.prototype.hasOwnProperty.call(s.values, key) ? s.values[key] : null;
  }
}
