// Display heartbeat (docs/ARCHITECTURE.md): POST /api/display/heartbeat on every SSE open, every 60 s (10 min in poll
// mode) and right after handling a night / identify command. Lets the admin's "Dispositivos conectados" page show what each screen runs.
import type { PhotoFrame } from '../shared/focus';
import type { DisplayHeartbeat, NightCommand } from '../shared/types';
import { api } from './api';
import { clientId, isPreview, screenKey } from './identity';

export interface HeartbeatSource {
  screenId(): string;
  webgl(): boolean;
  lite(): boolean;
  night(): boolean;
  nightOverride(): NightCommand;
  demo(): boolean;
  photoFrame?(): PhotoFrame | null;
}

const bootAt = Date.now();
let lastError: string | null = null;

/** Remember the last uncaught error (reported, truncated, in the next heartbeat). */
export function noteError(e: unknown): void {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : (e as { message?: string })?.message;
  if (msg) lastError = String(msg).slice(0, 200);
}

export function buildHeartbeat(src: HeartbeatSource): DisplayHeartbeat {
  const scr = window.screen;
  return {
    clientId,
    screen: screenKey,
    screenId: src.screenId(),
    version: __APP_VERSION__,
    build: __APP_BUILD__,
    viewport: { w: Math.round(window.innerWidth), h: Math.round(window.innerHeight) },
    screenRes: { w: Math.round(scr?.width || 0), h: Math.round(scr?.height || 0) },
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    webgl: src.webgl(),
    lite: src.lite(),
    night: src.night(),
    nightOverride: src.nightOverride(),
    uptimeSec: Math.round((Date.now() - bootAt) / 1000),
    lastError,
    photoFrame: src.photoFrame?.() ?? null,
  };
}

export class Heartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private src: HeartbeatSource, private onResponse?: (now: string) => void) {}

  /** Every 60 s with the SSE stream; poll mode passes 10 min (the poll answer already carries the server time). */
  start(intervalMs = 60_000): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.send(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.pending) clearTimeout(this.pending);
    this.timer = null;
    this.pending = null;
    this.stopped = true;
  }

  /** Send soon (coalesces bursts, e.g. hello + command in the same second). */
  soon(delayMs = 300): void {
    if (this.stopped) return;
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      void this.send();
    }, delayMs);
  }

  async send(): Promise<void> {
    if (this.src.demo() || isPreview || this.stopped) return;
    try {
      const r = await api.heartbeat(buildHeartbeat(this.src));
      if (r?.now) this.onResponse?.(r.now);
    } catch {
      /* server down / old server without the endpoint: the SSE status dot already covers it */
    }
  }
}
