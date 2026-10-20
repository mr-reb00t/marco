// How the display learns about changes (docs/ARCHITECTURE.md). Self-hosted servers keep an SSE stream open
// (/api/stream). A server that cannot hold long-lived connections answers `live: 'poll'` in GET /api/health; the
// display then polls GET /api/display/poll, which returns the same events as commands. A server that answers 404
// there gets the older config revision check every 90 s.
// No runtime imports on purpose: the module is unit-tested directly by node --test (server/test/display-live.test.js).
import type { Announcement, DoorbellRing, HaSnapshot, IdentifyPayload, NightCommand, PollResponse, StreamHello, ValuesSnapshot } from '../shared/types';

export type LiveMode = 'sse' | 'poll';

export const CONFIG_POLL_MS = 90_000;

/** Live mode advertised by a /api/health body. Anything but an explicit 'poll' (old servers, self-hosted) is SSE. */
export function liveModeOf(health: unknown): LiveMode {
  return (health as { live?: unknown } | null)?.live === 'poll' ? 'poll' : 'sse';
}

export interface DetectOptions {
  health: () => Promise<unknown>;
  /** True when the error is an HTTP answer (the server is up but /api/health failed): settle on SSE right away. */
  answered: (e: unknown) => boolean;
  /** Stop retrying (access denied, page closing). */
  cancelled?: () => boolean;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Ask /api/health which live mode to use. A network error or timeout is retried (5 s, doubling to 30 s) until the
 * server answers, so a display that boots offline does not pick SSE against a polling-only server.
 */
export async function detectLiveMode(o: DetectOptions): Promise<LiveMode | null> {
  const wait = o.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let delay = 5000;
  for (;;) {
    if (o.cancelled?.()) return null;
    try {
      return liveModeOf(await o.health());
    } catch (e) {
      if (o.answered(e)) return 'sse';
    }
    await wait(delay);
    delay = Math.min(delay * 2, 30_000);
  }
}

export interface ConfigPollOptions {
  /** Current config revision (before the fetch). */
  revision: () => number | undefined;
  /** Fetch, save and apply the config; false on failure (401 / 403 handling lives in the caller). */
  fetchConfig: () => Promise<boolean>;
  /** Called after a fetched config carries a different revision (refetch events and countdowns). */
  changed: () => void;
  intervalMs?: number;
}

/** Poll the display config; same contract as the SSE `config` event. */
export function startConfigPoll(o: ConfigPollOptions): { close(): void; tick(): Promise<void> } {
  let closed = false;
  let busy = false;
  const tick = async () => {
    if (closed || busy) return;
    busy = true;
    try {
      const before = o.revision();
      if ((await o.fetchConfig()) && !closed && o.revision() !== before) o.changed();
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), o.intervalMs ?? CONFIG_POLL_MS);
  return {
    close() {
      closed = true;
      clearInterval(timer);
    },
    tick,
  };
}

// ---------------------------------------------------------------------------------------------
// Event dispatch, shared by the SSE stream and the poll channel
// ---------------------------------------------------------------------------------------------

export interface StreamHandlers {
  hello?: (d: Partial<StreamHello>) => void;
  config?: (d: { revision: number }) => void;
  reload?: () => void;
  events?: (d: { hash: string }) => void;
  photos?: (d: { hidden?: string[] }) => void;
  announce?: (d: Announcement) => void;
  announceClear?: (d: { id: string | null }) => void;
  identify?: (d: IdentifyPayload) => void;
  night?: (d: { mode: NightCommand }) => void;
  /** privacy mode turned on or off for this screen (`screenId`: which one, for a display on a carousel): refetch
   *  config, events, countdowns and photos */
  privacy?: (d: { active: boolean; screenId?: string }) => void;
  /** doorbell ring on this screen (a later one with the same id extends it) */
  doorbell?: (d: DoorbellRing) => void;
  doorbellEnd?: (d: { id: string | null }) => void;
  /** Familia changed (a routine ticked, stars, a new family link): refetch the family state */
  family?: (d: { rev?: number }) => void;
  /** the tasks of the Microsoft To Do lists changed: refetch the config (they come in todo.items) */
  todo?: () => void;
  /** Home Assistant states of a Personalizado screen changed (aliases only; haFeed.ts) */
  ha?: (d: HaSnapshot) => void;
  /** pushed values of a Personalizado screen changed (only the keys it shows; valuesFeed.ts) */
  values?: (d: ValuesSnapshot) => void;
  /** link regenerated / device revoked / display access switched to private */
  revoked?: (d: { code: string }) => void;
  open?: () => void;
  down?: () => void;
}

/**
 * Run the handler for one live event. The checks are the ones the SSE client always applied, so a malformed
 * payload is dropped the same way whichever transport brought it. Returns false for an unknown name.
 */
export function dispatch(name: string, d: any, h: StreamHandlers): boolean {
  switch (name) {
    case 'hello': h.hello?.(d); return true;
    case 'config': h.config?.(d); return true;
    case 'events': h.events?.(d); return true;
    case 'photos':
      h.photos?.({ hidden: Array.isArray(d?.hidden) ? d.hidden.filter((f: unknown) => typeof f === 'string') : undefined });
      return true;
    case 'reload': h.reload?.(); return true;
    case 'announce': if (d && typeof d.id === 'string') h.announce?.(d); return true;
    case 'announce-clear': h.announceClear?.({ id: typeof d?.id === 'string' ? d.id : null }); return true;
    case 'identify': h.identify?.(d); return true;
    case 'night': if (d?.mode === 'on' || d?.mode === 'off' || d?.mode === 'auto') h.night?.(d); return true;
    case 'privacy': h.privacy?.({ active: d?.active === true, ...(typeof d?.screenId === 'string' ? { screenId: d.screenId } : {}) }); return true;
    case 'doorbell': if (d && typeof d.id === 'string' && typeof d.expiresAt === 'string') h.doorbell?.(d); return true;
    case 'family': h.family?.({ ...(typeof d?.rev === 'number' ? { rev: d.rev } : {}) }); return true;
    case 'todo': h.todo?.(); return true;
    case 'ha':
      if (d && typeof d.rev === 'number' && d.states && typeof d.states === 'object' && !Array.isArray(d.states)) h.ha?.(d);
      return true;
    case 'values':
      if (d && typeof d.rev === 'number' && d.values && typeof d.values === 'object' && !Array.isArray(d.values)) h.values?.(d);
      return true;
    case 'doorbell-end': h.doorbellEnd?.({ id: typeof d?.id === 'string' ? d.id : null }); return true;
    case 'revoked': h.revoked?.({ code: typeof d?.code === 'string' ? d.code : 'invalid_key' }); return true;
    default: return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Poll channel (GET /api/display/poll)
// ---------------------------------------------------------------------------------------------

export const POLL_DEFAULT_MS = 90_000;
export const POLL_MIN_MS = 3_000;
export const POLL_MAX_MS = 15 * 60_000;
export const POLL_ERROR_MIN_MS = 5_000;
export const POLL_ERROR_MAX_MS = 5 * 60_000;

export interface PollHandlers extends StreamHandlers {
  /** First answer or a reset: the poll version of the SSE `hello`. */
  first: (r: PollResponse) => void;
  /** The credential now belongs to another screen or carousel (device moved): reload the page. */
  screenChanged: () => void;
  /** Server time from a regular answer. */
  now?: (iso: string) => void;
  /** Announcements still active, from a regular answer that carries them. */
  sync?: (ids: string[]) => void;
}

/**
 * Apply one poll answer: a moved screen reloads, a reset runs `first`, a new revision runs `config`, then every
 * command goes through `dispatch` in order. Returns the number of commands dispatched.
 */
export function applyPoll(prev: { revision?: number; screenId?: string }, r: PollResponse, h: PollHandlers): number {
  if (prev.screenId && r.screenId && r.screenId !== prev.screenId) {
    h.screenChanged();
    return 0;
  }
  if (r.reset) {
    h.first(r);
  } else {
    if (typeof r.now === 'string') h.now?.(r.now);
    if (Array.isArray(r.activeAnnouncementIds)) h.sync?.(r.activeAnnouncementIds);
    if (typeof r.revision === 'number' && r.revision !== prev.revision) h.config?.({ revision: r.revision });
  }
  let n = 0;
  // `revoked` and `hello` never come as commands: lost access is a 401 / 403 on the poll, and a reset is `first`.
  for (const c of (Array.isArray(r.commands) ? r.commands : []) as unknown[]) {
    if (!c || typeof c !== 'object') continue;
    const { type, ...data } = c as { type?: unknown } & Record<string, unknown>;
    if (typeof type !== 'string' || type === 'revoked' || type === 'hello') continue;
    try {
      if (dispatch(type, data, h)) n++;
    } catch (err) {
      console.error('[poll] handler failed', err);
    }
  }
  return n;
}

/** Delay before the next poll: the server's `next` with ±10 % jitter, clamped to [3 s, 15 min]. */
export function pollDelay(next: unknown, random: () => number = Math.random): number {
  const base = typeof next === 'number' && Number.isFinite(next) && next > 0 ? next : POLL_DEFAULT_MS;
  const jittered = base * (0.9 + 0.2 * random());
  return Math.round(Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, jittered)));
}

export interface PollOptions {
  poll: (cursor: string, revision: number | undefined, hidden: boolean) => Promise<PollResponse>;
  revision: () => number | undefined;
  screenId: () => string | undefined;
  handlers: PollHandlers;
  /** True when the caller handled the error as lost access (401 / 403): polling stops for good. */
  denied: (e: unknown) => boolean;
  /** HTTP status of a failed poll (0 for a network error). */
  status: (e: unknown) => number;
  /** The server has no poll endpoint (404): switch to the config revision check. */
  fallback: () => void;
  hidden?: () => boolean;
  random?: () => number;
  /** Timer hooks for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/**
 * Poll for commands until closed. The first poll runs right away; later ones follow the server's `next`. Errors back
 * off from 5 s to 5 min; a 401 / 403 stops (the caller shows the pairing screen); a 404 hands over to `fallback`.
 */
export function startPoll(o: PollOptions): { close(): void; tick(): Promise<void> } {
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const random = o.random ?? Math.random;
  let cursor = '';
  let closed = false;
  let busy = false;
  let timer: unknown = null;
  let errorDelay = POLL_ERROR_MIN_MS;

  const schedule = (ms: number) => {
    if (closed) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void tick();
    }, ms);
  };

  const close = () => {
    closed = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const tick = async (): Promise<void> => {
    if (closed || busy) return;
    busy = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    let wait: number;
    try {
      const r = await o.poll(cursor, o.revision(), o.hidden?.() ?? false);
      if (closed) return;
      if (!r || typeof r !== 'object' || typeof r.cursor !== 'string') throw new Error('bad poll answer');
      cursor = r.cursor;
      errorDelay = POLL_ERROR_MIN_MS;
      o.handlers.open?.();
      try {
        applyPoll({ revision: o.revision(), screenId: o.screenId() }, r, o.handlers);
      } catch (err) {
        console.error('[poll] apply failed', err);
      }
      wait = pollDelay(r.next, random);
    } catch (e) {
      if (closed) return;
      if (o.denied(e)) {
        close();
        return;
      }
      if (o.status(e) === 404) {
        close();
        o.fallback();
        return;
      }
      o.handlers.down?.();
      wait = errorDelay;
      errorDelay = Math.min(errorDelay * 2, POLL_ERROR_MAX_MS);
    } finally {
      busy = false;
    }
    schedule(wait);
  };

  void tick();
  return { close, tick };
}
