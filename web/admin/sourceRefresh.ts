// Manual calendar downloads on Admin > Estado (#37): the pure parts of StatusSection, kept here so tests can load
// them without Preact.
import type { AdminStatus, SourceRefreshResult, SourceStatus } from '../shared/types';
import { BIRTHDAYS_SOURCE_ID, LOCAL_SOURCE_ID } from '../shared/types';
import { t } from './i18n';

/** Longest wait the admin believes from a server answer (seconds); the server never asks for more than 120. */
const MAX_WAIT_SECS = 3600;

/** A server-sent wait in seconds, or null when absent or not a sane number. */
export function waitSecs(raw: unknown): number | null {
  const n = Number(raw);
  return raw != null && Number.isFinite(n) && n >= 0 && n <= MAX_WAIT_SECS ? Math.ceil(n) : null;
}

/** Epoch ms of a server wait: the seconds when sent (immune to clock differences), else the ISO time. */
function untilOf(secs: unknown, iso: string | null | undefined, now: number): number {
  const s = waitSecs(secs);
  if (s != null) return s > 0 ? now + s * 1000 : 0;
  return iso ? Date.parse(iso) || 0 : 0;
}

/** Cooldowns (epoch ms when allowed again; '*' = Descargar todos) carried by a status or refresh answer. */
export function coolOf(st: Pick<AdminStatus, 'sources' | 'refreshAllAfter' | 'refreshAllAfterSecs'>, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of st.sources) {
    const at = untilOf(s.refreshAfterSecs, s.refreshAfter, now);
    if (at > now) out[s.id] = at;
  }
  const all = untilOf(st.refreshAllAfterSecs, st.refreshAllAfter, now);
  if (all > now) out['*'] = all;
  return out;
}

/** Whether a status row gets Descargar ahora. Read from the server's row, not the unsaved draft, so the button
 *  matches what the server accepts. */
export const rowRefreshable = (s: Pick<SourceStatus, 'id' | 'enabled'>) =>
  s.enabled !== false && s.id !== LOCAL_SOURCE_ID && s.id !== BIRTHDAYS_SOURCE_ID;

/** Seconds of the soonest wait when an "all" run fetched nothing because every source was cooling, else 0. */
export function allCoolingSecs(results: SourceRefreshResult[]): number {
  if (!results.length || results.some((x) => x.result !== 'cooldown')) return 0;
  const waits = results.map((x) => waitSecs(x.retryAfter)).filter((x): x is number => x != null && x > 0);
  return waits.length ? Math.min(...waits) : 60;
}

/** Toast text of a refused single download: a known code's sentence, else the translated generic failure (the
 *  server's 404 / 409 / 400 bodies are English codes meant for scripts). */
export const refreshErrorText = (err: { code?: string; message: string }) =>
  err.code ? err.message : t('No se pudo descargar el calendario.');
