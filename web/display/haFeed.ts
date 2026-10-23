// Home Assistant states on a Personalizado screen (docs/ARCHITECTURE.md). The server mirrors the entities the
// screens show and sends their slim states keyed by alias (`${itemId}:${n}`): a full snapshot when the stream
// opens or when this page asks (GET /api/display/ha), and the aliases that changed as the SSE `ha` event. A
// display on the poll channel asks every 10 s while a Home Assistant card is on screen. Entity ids never reach
// this page.
// In the admin preview, the builder posts the states of items not saved yet ('marco:preview-ha') and their chart
// points ('marco:preview-history'); those win over what the server sends for the same alias or item. Camera pictures
// in the preview come only from the builder ('marco:preview-camera'): the preview never asks the screen's camera
// routes and never opens a live picture.
//
// Taps on the controls (widgets/canvas/touch.ts) go through send(): the new value shows at once (optimistic), the
// action is posted, and the card goes back to the real state when the server says no or after 8 s at the latest.
import { canvasCards } from '../../server/core/canvasCore.js';
import type { DisplayConfig, HaActionResponse, HaControl, HaHistory, HaSnapshot, HaState, HaStatistic } from '../shared/types';
import { ApiError, getJSON } from './api';
import { authHeaders, isPreview, withScreen } from './identity';
import { DEMO_RAW, demoArt, demoHaHidden, demoHaHistory, demoHaStates, demoHaStatistic } from './mockHa';

/** What the canvas adapters read (widgets/canvas/types.ts AdapterEnv.ha). */
export interface HaSource {
  /** the state of an alias, or null (nothing known yet) */
  state(alias: string): HaState | null;
  /** the server's link to Home Assistant: 'ok', 'down', or null before the first answer */
  conn(): 'ok' | 'down' | null;
  /** Home Assistant is not set up on the server (switched off, or no URL or token): the cards say so calmly */
  off(): boolean;
  /** the chart points of an item (`v`: the item's version, new points when it changes) */
  history(itemId: string, v: string): Promise<HaHistory | null>;
  /** the value of a Estadística card (`v`: the item's version), or null */
  statistic(itemId: string, v: string): Promise<HaStatistic | null>;
  /** a condition ("Mostrar solo si") on Home Assistant hides this item now (true until the server has said) */
  hidden(itemId: string): boolean;
  /** an object URL of a media item's cover art, or null (`key` changes with the track) */
  art(itemId: string, key: string): Promise<string | null>;
  /** taps reach Home Assistant on this screen now (touch on, online, not private, not the admin's preview) */
  touch(): boolean;
  /** the cards draw their controls (as touch() but also in the admin's preview, where they do nothing) */
  shows(): boolean;
  /** an action on this alias is on its way (the card pulses) */
  pending(alias: string): boolean;
  /** a short message on an item's card ("Toca otra vez o mantén pulsado", an error), or '' */
  note(itemId: string): string;
  /** the control a first tap armed on an item that needs two taps, or '' */
  armed(itemId: string): string;
  /** the admin's preview: the latest camera picture the builder sent for an item, or null */
  previewFrame(itemId: string): Blob | null;
  /** the demo (?demo=1): no server, made-up pictures */
  isDemo(): boolean;
}

/** How long a value sent stays on screen without word from Home Assistant before the real state comes back. */
const PENDING_MS = 8000;
const NOTE_MS = 3000;
const CONFIRM_MS = 3000;

/** What a control changes in the state shown, before Home Assistant says so. */
/** Fields of a slim state a control changes (merged over it). */
type Patch = Record<string, unknown>;

export function optimistic(s: HaState, control: HaControl, value: unknown): Patch | null {
  const v = value as number;
  switch (s.d) {
    case 'light':
      if (control === 'toggle') return { on: !s.on, bri: !s.on ? s.bri ?? 100 : null };
      if (control === 'on' || control === 'off') return { on: control === 'on' };
      if (control === 'brightness') return { on: true, bri: v };
      if (control === 'colorTemp') return { on: true, ct: v, rgb: null };
      if (control === 'rgb' && Array.isArray(value)) return { on: true, rgb: value, ct: null };
      return null;
    case 'switch':
      if (control === 'toggle') return { on: !s.on };
      if (control === 'on' || control === 'off') return { on: control === 'on' };
      if (control === 'fanPct') return { pct: v, on: v > 0 };
      return null;
    case 'climate':
      if (control === 'setpoint') return { target: v };
      if (control === 'setpointRange' && Array.isArray(value)) return { lo: value[0], hi: value[1] };
      if (control === 'hvacMode') return { mode: String(value) };
      if (control === 'fanMode') return { fan: String(value) };
      return null;
    case 'cover':
    case 'valve':
      if (control === 'open') return { state: 'opening' };
      if (control === 'close') return { state: 'closing' };
      if (control === 'stop') return { state: s.pos === 0 ? 'closed' : 'open' };
      if (control === 'position') return { pos: v, state: v > 0 ? 'open' : 'closed' };
      return null;
    case 'select':
      return control === 'selectOption' && typeof value === 'string' ? { v: value } : null;
    case 'sensor':
      return control === 'numberSet' && typeof value === 'number' ? { v: String(value), num: value } : null;
    case 'vacuum':
      if (control === 'start') return { state: 'cleaning' };
      if (control === 'pause') return { state: 'paused' };
      if (control === 'dock') return { state: 'returning' };
      return null;
    case 'media':
      if (control === 'playPause') return { state: s.state === 'playing' ? 'paused' : 'playing' };
      if (control === 'volume') return { vol: v };
      return null;
    default:
      return null;
  }
}

/** The message of a refused or failed action (display strings, web/shared/i18n.ts). */
const ERROR_KEY: Record<string, string> = {
  rate: 'haErrRate', ha_down: 'haErrDown', ha_error: 'haErrHa', touch_off: 'haErrTouchOff', private: 'haErrTouchOff',
  untrusted: 'haErrUntrusted', confirm_needed: 'haTapAgain',
};

interface Pending {
  patch: Patch;
  seq: number;
  until: number;
  /** the server said yes to the last action sent */
  ok: boolean;
  /** a new state came while it was on its way */
  fresh: boolean;
}

interface Store {
  rev: number;
  conn: 'ok' | 'down';
  off: boolean;
  states: Record<string, HaState>;
  /** the items a condition hides now */
  hide: Set<string>;
}

const POLL_MS = 10_000;
const STAT_MS = 5 * 60_000;
const HISTORY_MS = 2 * 60_000;
const HISTORY_LONG_MS = 15 * 60_000;

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * True when the screen of `cfg` has a Home Assistant card that is drawn (not a placeholder), a custom card bound to
 * one, or a Home Assistant condition (an item's, or a Rotativa card's, group's or small Rotativa card's own).
 */
export function showsHa(cfg: DisplayConfig | null | undefined): boolean {
  const ha = (w: unknown) => isObj(w) && w.src === 'ha';
  return canvasCards(cfg?.canvas?.items).some((it) => ha(it.when) || ha((it as { own?: unknown }).own) || ha((it as { inner?: unknown }).inner) || (!it.disabled && (it.kind.startsWith('ha.') || (it.kind === 'html' && Array.isArray(it.props.bind) && it.props.bind.some((b) => isObj(b) && isObj(b.entity))))));
}

export class HaFeed implements HaSource {
  private stores = new Map<string, Store>();
  private screenId = '';
  private wanted = false;
  private pollMode = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private fetchTimer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private preview: Record<string, HaState> = {};
  private previewHistory = new Map<string, HaHistory>();
  private previewFrames = new Map<string, Blob>();
  private hist = new Map<string, { v: string; at: number; p: Promise<HaHistory | null> }>();
  private stats = new Map<string, { v: string; at: number; p: Promise<HaStatistic | null> }>();
  private previewStats = new Map<string, HaStatistic>();
  private arts = new Map<string, { key: string; p: Promise<string | null>; url: string | null }>();
  private cfg: DisplayConfig | null = null;
  private pend = new Map<string, Pending>();
  private notes = new Map<string, { text: string; until: number }>();
  private arms = new Map<string, { key: string; until: number }>();
  private seq = 0;
  private touchOff = false;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;
  demo = false;
  /** the rest of what decides taps (main.ts): online, not private, not the admin's preview */
  gate: () => boolean = () => false;
  /** where an action goes (tests replace it) */
  post: (body: unknown) => Promise<{ status: number; json: HaActionResponse | null }> = async (body) => {
    const r = await fetch(withScreen('/api/display/ha/action'), {
      method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', Accept: 'application/json', ...authHeaders() }, body: JSON.stringify(body),
    });
    let json: HaActionResponse | null = null;
    try {
      json = (await r.json()) as HaActionResponse;
    } catch { /* not JSON */ }
    return { status: r.status, json };
  };

  constructor(private changed: () => void) {
    // the demo: a made-up entity changes state (mockHa.ts DEMO_RAW), as a server's push would say
    window.addEventListener('marco:demo-ha', (e) => {
      const d = (e as CustomEvent<{ entity?: unknown; state?: unknown }>).detail;
      if (!this.demo || typeof d?.entity !== 'string' || !(d.entity in DEMO_RAW) || typeof d.state !== 'string') return;
      DEMO_RAW[d.entity] = d.state;
      this.refresh();
    });
    if (isPreview) {
      window.addEventListener('message', (e) => {
        if (e.source !== window.parent) return;
        const d = e.data;
        if (d?.type === 'marco:preview-ha' && isObj(d.states)) {
          this.preview = {};
          for (const [k, v] of Object.entries(d.states)) if (typeof k === 'string' && isObj(v) && typeof v.d === 'string') this.preview[k] = v as HaState;
          this.changed();
        } else if (d?.type === 'marco:preview-history' && typeof d.item === 'string' && isObj(d.data) && Array.isArray(d.data.series)) {
          this.previewHistory.set(d.item, d.data as HaHistory);
          this.hist.delete(d.item);
          this.changed();
        } else if (d?.type === 'marco:preview-statistic' && typeof d.item === 'string' && isObj(d.data)) {
          this.previewStats.set(d.item, d.data as HaStatistic);
          this.stats.delete(d.item);
          this.changed();
        } else if (d?.type === 'marco:preview-camera' && typeof d.item === 'string' && d.blob instanceof Blob && /^image\/(jpeg|png|webp|gif)$/.test(d.blob.type)) {
          this.previewFrames.set(d.item, d.blob);
          if (this.previewFrames.size > 8) this.previewFrames.delete(this.previewFrames.keys().next().value!);
        }
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.wanted && this.pollMode) this.refresh();
    });
  }

  /** The screen on display changed (a new config, a carousel step). */
  config(cfg: DisplayConfig): void {
    const before = this.screenId;
    const wasWanted = this.wanted;
    this.cfg = cfg;
    // a new config: taps work again if the screen allows them (a 403 touch_off held them until now)
    this.touchOff = false;
    this.screenId = cfg.screenId ?? '';
    this.wanted = showsHa(cfg);
    this.syncPoll();
    if (!this.wanted) return;
    // new items or a new screen: their states now (the stream only sends what changes)
    if (this.screenId !== before || !wasWanted || !this.store()) this.refresh();
    else this.refreshSoon();
  }

  /** The display uses the poll channel: no `ha` events come, ask every 10 s instead. */
  setPollMode(on: boolean): void {
    this.pollMode = on;
    this.syncPoll();
  }

  /** An `ha` event (live.ts dispatch), or the answer of GET /api/display/ha. */
  apply(snap: HaSnapshot): void {
    if (!isObj(snap) || typeof snap.rev !== 'number' || !isObj(snap.states)) return;
    const id = typeof snap.screenId === 'string' && snap.screenId ? snap.screenId : this.screenId;
    const cur = this.stores.get(id);
    // diffs come in order; an answer older than what is here already is dropped
    if (cur && snap.rev < cur.rev) return;
    if (cur && !snap.full && snap.rev === cur.rev && Object.keys(snap.states).length) return;
    const conn = snap.conn === 'down' ? 'down' : 'ok';
    const states: Record<string, HaState> = snap.full || !cur ? {} : { ...cur.states };
    for (const [k, v] of Object.entries(snap.states)) {
      if (!isObj(v) || typeof v.d !== 'string') continue;
      states[k] = { ...(v as HaState), c: Array.isArray(v.c) ? v.c : [] };
      // Home Assistant's own answer: what was sent and confirmed is shown as it really is now
      const p = id === this.screenId ? this.pend.get(k) : undefined;
      if (p) {
        if (p.ok) this.pend.delete(k);
        else p.fresh = true;
      }
    }
    // the items a condition hides: as the server says them in this answer (a diff without the list keeps the last one)
    const hide = Array.isArray(snap.hide) ? new Set(snap.hide.filter((x): x is string => typeof x === 'string')) : snap.full || !cur ? new Set<string>() : cur.hide;
    // not set up: said in every full answer; a diff keeps what the last one said until the link is up
    const off = snap.off === true || (!snap.full && conn === 'down' && !!cur?.off);
    this.stores.set(id, { rev: snap.rev, conn, off, states, hide });
    if (this.stores.size > 12) this.stores.delete(this.stores.keys().next().value!);
    if (id === this.screenId) this.changed();
  }

  /** Ask the server for the full snapshot of the screen on display. */
  refresh(): void {
    if (this.fetchTimer) clearTimeout(this.fetchTimer);
    this.fetchTimer = null;
    if (!this.wanted) return;
    if (this.demo) {
      this.stores.set(this.screenId, { rev: 1, conn: 'ok', off: false, states: demoHaStates(this.cfg), hide: demoHaHidden() });
      this.changed();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    getJSON<HaSnapshot>(withScreen('/api/display/ha'), 8000)
      .then((s) => this.apply({ ...s, full: true }))
      .catch(() => undefined)
      .finally(() => (this.busy = false));
  }

  private refreshSoon(): void {
    if (this.fetchTimer) return;
    this.fetchTimer = setTimeout(() => this.refresh(), 400);
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

  private store(): Store | undefined {
    return this.stores.get(this.screenId);
  }

  state(alias: string): HaState | null {
    if (isPreview && this.preview[alias]) return this.preview[alias];
    const s = this.store()?.states[alias] ?? null;
    const p = s ? this.pend.get(alias) : undefined;
    return s && p ? ({ ...s, ...p.patch } as HaState) : s;
  }

  /** The state as Home Assistant last said it, without what is on its way. */
  real(alias: string): HaState | null {
    return this.store()?.states[alias] ?? null;
  }

  touch(): boolean {
    return !!this.cfg?.canvas?.touch && !this.touchOff && this.gate();
  }

  shows(): boolean {
    return !!this.cfg?.canvas?.touch && !this.touchOff && (isPreview || this.gate());
  }

  pending(alias: string): boolean {
    return this.pend.has(alias);
  }

  note(itemId: string): string {
    const n = this.notes.get(itemId);
    return n && n.until > Date.now() ? n.text : '';
  }

  armed(itemId: string): string {
    const a = this.arms.get(itemId);
    return a && a.until > Date.now() ? a.key : '';
  }

  /** A short message on a card for 3 s. */
  say(itemId: string, key: string): void {
    this.notes.set(itemId, { text: key, until: Date.now() + NOTE_MS });
    this.sweepSoon();
    this.changed();
  }

  /**
   * A first tap on an item that needs two: `key` (the control) is armed for 3 s. True when this tap is the second
   * one (the same control, still armed): the action may go.
   */
  arm(itemId: string, key: string): boolean {
    const a = this.arms.get(itemId);
    if (a && a.key === key && a.until > Date.now()) {
      this.arms.delete(itemId);
      this.notes.delete(itemId);
      return true;
    }
    this.arms.set(itemId, { key, until: Date.now() + CONFIRM_MS });
    this.say(itemId, 'haTapAgain');
    return false;
  }

  /** Forget a first tap (a press and hold confirmed it instead). */
  disarm(itemId: string): void {
    this.arms.delete(itemId);
    if (this.notes.get(itemId)?.text === 'haTapAgain') this.notes.delete(itemId);
  }

  /** Show a value at once while a slider moves, without sending it (send() goes with the last one). */
  show(alias: string, control: HaControl, value: unknown): void {
    const s = this.state(alias);
    const patch = s ? optimistic(s, control, value) : null;
    if (!patch) return;
    const p = this.pend.get(alias);
    this.pend.set(alias, { patch: { ...(p?.patch ?? {}), ...patch }, seq: p?.seq ?? 0, until: Date.now() + PENDING_MS, ok: false, fresh: false });
    this.sweepSoon();
    this.changed();
  }

  /**
   * Send an action: shown at once, posted, put back on a refusal or a failure (with a message on the card), and
   * after 8 s at the latest if Home Assistant never says anything.
   */
  send(alias: string, control: HaControl, value?: unknown, confirm = false): void {
    if (!this.touch()) return;
    const [item, slotStr] = alias.split(':');
    const slot = Number(slotStr);
    const s = this.state(alias);
    if (!s || !Number.isInteger(slot)) return;
    const patch = optimistic(s, control, value) ?? {};
    const seq = ++this.seq;
    const prev = this.pend.get(alias);
    this.pend.set(alias, { patch: { ...(prev?.patch ?? {}), ...patch }, seq, until: Date.now() + PENDING_MS, ok: false, fresh: false });
    this.sweepSoon();
    this.changed();
    if (this.demo) {
      // the demo has no server: the value simply stays
      const st = this.store();
      if (st?.states[alias]) st.states[alias] = { ...st.states[alias], ...patch } as HaState;
      this.pend.delete(alias);
      if (control === 'run') this.say(item, 'haDone');
      this.changed();
      return;
    }
    const body: Record<string, unknown> = { item, slot, control, seq };
    if (value !== undefined && value !== null) body.value = value;
    if (confirm) body.confirm = true;
    this.post(body).then(
      ({ status, json }) => {
        const p = this.pend.get(alias);
        const mine = p?.seq === seq;
        if (json && json.ok) {
          if (control === 'run') this.say(item, 'haDone');
          if (mine && p) {
            if (p.fresh || !Object.keys(p.patch).length) this.pend.delete(alias);
            else p.ok = true;
            this.changed();
          }
          return;
        }
        const err = json && !json.ok ? json.error : status >= 500 ? 'ha_down' : 'ha_error';
        if (err === 'touch_off' || err === 'private') this.touchOff = true;
        if (mine) this.pend.delete(alias);
        if (mine || err === 'touch_off') this.say(item, ERROR_KEY[err] ?? 'haErrFailed');
        this.changed();
      },
      () => {
        if (this.pend.get(alias)?.seq === seq) this.pend.delete(alias);
        this.say(item, 'haErrDown');
      },
    );
  }

  /** Drop what timed out (values never confirmed, old messages, unconfirmed first taps). */
  private sweepSoon(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      const now = Date.now();
      let changed = false;
      for (const [k, p] of this.pend) if (p.until <= now) (this.pend.delete(k), (changed = true));
      for (const [k, n] of this.notes) if (n.until <= now) (this.notes.delete(k), (changed = true));
      for (const [k, a] of this.arms) if (a.until <= now) (this.arms.delete(k), (changed = true));
      if (this.pend.size || this.notes.size || this.arms.size) this.sweepSoon();
      if (changed) this.changed();
    }, 500);
  }

  previewFrame(itemId: string): Blob | null {
    return isPreview ? this.previewFrames.get(itemId) ?? null : null;
  }

  isDemo(): boolean {
    return this.demo;
  }

  off(): boolean {
    if (this.demo || (isPreview && Object.keys(this.preview).length)) return false;
    return !!this.cfg?.canvas?.haOff || !!this.store()?.off;
  }

  conn(): 'ok' | 'down' | null {
    if (isPreview && Object.keys(this.preview).length) return 'ok';
    return this.store()?.conn ?? null;
  }

  history(itemId: string, v: string): Promise<HaHistory | null> {
    const pv = isPreview ? this.previewHistory.get(itemId) : undefined;
    if (pv) return Promise.resolve(pv);
    const hit = this.hist.get(itemId);
    const now = Date.now();
    if (hit && hit.v === v && now - hit.at < HISTORY_MS) return hit.p;
    if (this.demo) return Promise.resolve(demoHaHistory(this.cfg, itemId));
    const url = withScreen(`/api/display/ha/history/${encodeURIComponent(itemId)}`);
    const p: Promise<HaHistory | null> = getJSON<HaHistory>(url, 15000).catch((e) => {
      // a new item the server does not know yet (the admin preview before saving): nothing
      if (e instanceof ApiError && e.status === 404) return null;
      return hit?.v === v ? hit.p : null;
    });
    this.hist.set(itemId, { v, at: now, p });
    void p.then((h) => {
      // longer periods change slowly: their points are kept longer
      const x = this.hist.get(itemId);
      if (x && x.p === p && h?.period === '7d') x.at = now + HISTORY_LONG_MS - HISTORY_MS;
    });
    return p;
  }

  hidden(itemId: string): boolean {
    const st = this.store();
    return !st || st.hide.has(itemId);
  }

  statistic(itemId: string, v: string): Promise<HaStatistic | null> {
    const pv = isPreview ? this.previewStats.get(itemId) : undefined;
    if (pv) return Promise.resolve(pv);
    const hit = this.stats.get(itemId);
    const now = Date.now();
    // the server keeps a value 5 minutes: asking sooner gives the same one
    if (hit && hit.v === v && now - hit.at < STAT_MS) return hit.p;
    if (this.demo) return Promise.resolve(demoHaStatistic(this.cfg, itemId));
    const p: Promise<HaStatistic | null> = getJSON<HaStatistic>(withScreen(`/api/display/ha/statistic/${encodeURIComponent(itemId)}`), 15000).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      return hit?.v === v ? hit.p : null;
    });
    this.stats.set(itemId, { v, at: now, p });
    return p;
  }

  art(itemId: string, key: string): Promise<string | null> {
    const hit = this.arts.get(itemId);
    if (hit && hit.key === key) return hit.p;
    if (hit?.url) URL.revokeObjectURL(hit.url);
    const entry: { key: string; p: Promise<string | null>; url: string | null } = { key, p: Promise.resolve(null), url: null };
    if (this.demo) entry.p = key ? demoArt() : Promise.resolve(null);
    else {
      entry.p = fetch(withScreen(`/api/display/ha/art/${encodeURIComponent(itemId)}`), { headers: authHeaders(), cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) return null;
          entry.url = URL.createObjectURL(await r.blob());
          return entry.url;
        })
        .catch(() => null);
    }
    this.arts.set(itemId, entry);
    return entry.p;
  }
}
