// SSE client for /api/stream?screen=&client= with manual exponential-backoff reconnect (docs/ARCHITECTURE.md).
// The per-event checks live in live.ts (dispatch), shared with the poll channel.
import { dispatch, type StreamHandlers } from './live';
import { clientId, credential, isPreview, screenKey } from './identity';

export type { StreamHandlers } from './live';

export function streamUrl(): string {
  const q = new URLSearchParams();
  if (screenKey) q.set('screen', screenKey);
  q.set('client', clientId);
  if (isPreview) q.set('preview', '1');
  // EventSource cannot send headers: the credential travels as ?k= (never logged by the server).
  if (credential) q.set('k', credential);
  return `/api/stream?${q.toString()}`;
}

/** Events the stream listens for (besides `revoked` and `ping`). */
export const STREAM_EVENTS = ['hello', 'config', 'events', 'photos', 'reload', 'announce', 'announce-clear', 'identify', 'night', 'doorbell', 'doorbell-end', 'privacy', 'family', 'todo', 'ha', 'values'] as const;

/** Query string for GET /api/display/poll (the screen is added by api.ts; the credential travels in X-Marco-Key). */
export function pollUrl(cursor: string, revision: number | undefined, hidden: boolean): string {
  const q = new URLSearchParams();
  q.set('client', clientId);
  if (isPreview) q.set('preview', '1');
  if (cursor) q.set('cursor', cursor);
  if (typeof revision === 'number') q.set('rev', String(revision));
  if (hidden) q.set('hidden', '1');
  return q.toString();
}

export function connectStream(h: StreamHandlers): { close(): void } {
  let es: EventSource | null = null;
  let delay = 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const parse = (e: Event) => {
    try {
      const d = (e as MessageEvent).data;
      return d ? JSON.parse(d) : {};
    } catch {
      return {};
    }
  };

  // Server sends a named `ping` event every 25 s; any event counts as liveness. If nothing arrives
  // for ~3 heartbeats the stream is considered stalled and is reopened.
  const kick = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => restart(), 80 * 1000);
  };

  const safe = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.error('[stream] handler failed', err);
    }
  };

  const listen = (name: string, fn: (d: any) => void) => {
    es!.addEventListener(name, (e) => {
      kick();
      const d = parse(e);
      safe(() => fn(d));
    });
  };

  const open = () => {
    if (closed) return;
    try {
      es = new EventSource(streamUrl());
    } catch {
      schedule();
      return;
    }
    es.onopen = () => {
      delay = 1000;
      kick();
      h.open?.();
    };
    es.onerror = () => {
      h.down?.();
      restart();
    };
    for (const name of STREAM_EVENTS) listen(name, (d) => dispatch(name, d, h));
    // Transport specific: a revoked stream is closed for good before the handler runs.
    listen('revoked', (d) => {
      closed = true;
      es?.close();
      dispatch('revoked', d, h);
    });
    es.addEventListener('ping', () => kick());
    es.onmessage = () => kick();
  };

  const restart = () => {
    if (es) {
      es.close();
      es = null;
    }
    schedule();
  };

  const schedule = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      open();
    }, delay + Math.random() * 500);
    delay = Math.min(delay * 2, 30000);
  };

  open();
  return {
    close() {
      closed = true;
      es?.close();
      if (timer) clearTimeout(timer);
      if (watchdog) clearTimeout(watchdog);
    },
  };
}
