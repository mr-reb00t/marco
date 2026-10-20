// API client for the public display endpoints (docs/API.md).
// Every per-screen endpoint gets `?screen=<key>` when the display was opened with one; every request carries the
// display credential (private-link key or paired-device token) in X-Marco-Key.
import type {
  CountdownsResponse, DisplayConfig, DisplayHeartbeat, EventsResponse, FamilyDisplayState, HealthResponse, HeartbeatResponse, NewsResponse,
  PhotosResponse, PollResponse, WeatherResponse,
} from '../shared/types';
import { authHeaders, withScreen, withTarget } from './identity';
import { early, takeSeed } from './boot';

export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = '') {
    super(message);
  }
}

async function send<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(path, {
      ...init, signal: ctl.signal, cache: 'no-store', headers: { Accept: 'application/json', ...authHeaders(), ...(init.headers || {}) },
    });
    if (!r.ok) {
      // 401 key_required / 403 invalid_key: the display shows the pairing / "link no longer valid" screen;
      // 404 screen_not_found: the "Screen not found" page.
      let code = '';
      if (r.status === 401 || r.status === 403 || r.status === 404) {
        try {
          code = String(((await r.json()) as { code?: string }).code || '');
        } catch { /* not JSON */ }
      }
      throw new ApiError(`${path} → HTTP ${r.status}`, r.status, code);
    }
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new ApiError(`${path} → not JSON`, r.status);
    return (await r.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(`${path} → ${(e as Error).message || 'network error'}`);
  } finally {
    clearTimeout(tm);
  }
}

/** A GET is answered by what boot.ts keeps for that exact path (the page bootstrap, an early request) when it can. */
function request<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  if (!init.method || init.method === 'GET') {
    const kept = takeSeed(path);
    if (kept) return kept as Promise<T>;
  }
  return send<T>(path, init, timeoutMs);
}

export function getJSON<T>(path: string, timeoutMs = 15000): Promise<T> {
  return request<T>(path, {}, timeoutMs);
}

/** Start the GET for `path` now; the first getJSON(path) gets its answer (boot.ts early). */
export function prefetchJSON(path: string, timeoutMs = 15000): void {
  early(path, () => send(path, {}, timeoutMs));
}

/**
 * Request paths of the display GETs, so an early request (boot.ts) and the request it stands for are the same path.
 * `screen` (optional) asks for one screen of the carousel the display runs (a prefetch); left out, the request is for
 * the screen on display.
 */
export const paths = {
  config: (screen?: string) => withScreen('/api/display/config', screen),
  events: (from: string, to: string, screen?: string) =>
    withScreen(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, screen),
  weather: (screen?: string) => withScreen('/api/weather', screen),
  news: () => '/api/news',
  photos: (count = 20, after = '', screen?: string) =>
    withScreen(`/api/photos?count=${count}${after ? `&after=${encodeURIComponent(after)}` : ''}`, screen),
  countdowns: (screen?: string) => withScreen('/api/countdowns', screen),
};

export const api = {
  config: (screen?: string) => getJSON<DisplayConfig>(paths.config(screen)),
  /** First config fetch at boot: short timeout so an unreachable server falls back to the cache quickly. */
  configQuick: () => getJSON<DisplayConfig>(paths.config(), 5000),
  events: (from: string, to: string, screen?: string) => getJSON<EventsResponse>(paths.events(from, to, screen)),
  weather: (screen?: string) => getJSON<WeatherResponse>(paths.weather(screen)),
  news: () => getJSON<NewsResponse>(paths.news()),
  /** `after` = gallery file shown last, so sequential orders continue from there and random avoids repeating it. */
  photos: (count = 20, after = '', screen?: string) => getJSON<PhotosResponse>(paths.photos(count, after, screen)),
  countdowns: (screen?: string) => getJSON<CountdownsResponse>(paths.countdowns(screen)),
  /** Familia of a screen (kids layouts): today's routines, stars and the meals of the week. */
  family: (screen?: string) => getJSON<FamilyDisplayState>(withScreen('/api/display/family', screen)),
  /** A tap on a routine (only screens with touch on): the new state of that screen. */
  familyToggle: (choreId: string, done: boolean, screen?: string) =>
    request<{ ok: boolean; state: FamilyDisplayState }>(withScreen('/api/display/family/toggle', screen), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ choreId, done }),
    }, 8000),
  /** A tap on a Microsoft To Do task (`id`: the opaque id of the display config; only screens with touch on). */
  todoToggle: (id: string, done: boolean, screen?: string) =>
    request<{ ok: boolean }>(withScreen('/api/display/todo/toggle', screen), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, done }),
    }, 15000),
  health: () => getJSON<HealthResponse>('/api/health', 5000),
  /** `q` from stream.ts pollUrl (client, cursor, rev, hidden, preview). Asks for what the display is bound to. */
  poll: (q: string) => getJSON<PollResponse>(withTarget(`/api/display/poll?${q}`), 10000),
  heartbeat: (hb: DisplayHeartbeat) =>
    request<HeartbeatResponse>('/api/display/heartbeat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(hb),
    }, 8000),
};
