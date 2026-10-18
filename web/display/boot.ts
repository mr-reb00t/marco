// Answers the display can use before asking the server (docs/ARCHITECTURE.md, "First load"):
//   - the page bootstrap: answers of the display API the server wrote into this page (server/core/bootstrap.js,
//     <script type="application/json" id="marco-boot">), for the credential in the page's own URL
//   - early requests: GETs started at boot, before the config came, for answers that do not depend on it
// Each one stands for one exact request path and is used once, by the first request for that path (api.ts). A
// bootstrapped answer is only taken within a minute of the page load; an early request is dropped when nothing
// asked for it within 30 s. Anything else goes to the server as before.
import { BOOT_ID, BOOT_VERSION } from '../../server/core/bootstrap.js';

/** How long after the page load a bootstrapped answer may still be used. */
const BOOT_MAX_AGE_MS = 60_000;
/** How long an early request waits for the request it stands for. */
const EARLY_MAX_AGE_MS = 30_000;

type Seed = { value: unknown } | { promise: Promise<unknown>; at: number };

const seeds = new Map<string, Seed>();

/** The bootstrapped answers of this page ({ path: answer }), or null without a usable block. */
export function readBoot(doc: Document = document): Record<string, unknown> | null {
  try {
    const el = doc.getElementById(BOOT_ID);
    if (!el || el.getAttribute('type') !== 'application/json') return null;
    // read once: the answers live in boot.ts from now on, not in the page
    el.remove();
    const j = JSON.parse(el.textContent || '') as { v?: unknown; data?: unknown };
    if (!j || j.v !== BOOT_VERSION || !j.data || typeof j.data !== 'object' || Array.isArray(j.data)) return null;
    return j.data as Record<string, unknown>;
  } catch {
    return null;
  }
}

let booted = false;

/** Take this page's bootstrap (once); true when it held the display config. */
export function loadBoot(data: Record<string, unknown> | null = readBoot()): boolean {
  if (booted) return seeds.has('/api/display/config');
  booted = true;
  if (!data) return false;
  for (const [path, value] of Object.entries(data)) {
    if (path.startsWith('/api/') && value && typeof value === 'object') seeds.set(path, { value });
  }
  return seeds.has('/api/display/config');
}

const fresh = (s: Seed): boolean =>
  'value' in s ? performance.now() < BOOT_MAX_AGE_MS : performance.now() - s.at < EARLY_MAX_AGE_MS;

/** The answer kept for `path` (a bootstrapped value or an early request), taken out; undefined when there is none. */
export function takeSeed(path: string): Promise<unknown> | undefined {
  const s = seeds.get(path);
  if (!s) return undefined;
  seeds.delete(path);
  if (!fresh(s)) return undefined;
  return 'value' in s ? Promise.resolve(s.value) : s.promise;
}

/** The bootstrapped answer for `path` without taking it (null when there is none). */
export function peekBoot<T>(path: string): T | null {
  const s = seeds.get(path);
  return s && 'value' in s && fresh(s) ? (s.value as T) : null;
}

/** True when something is kept for `path`. */
export const hasSeed = (path: string): boolean => {
  const s = seeds.get(path);
  return Boolean(s && fresh(s));
};

/** Start `run` now for `path`, unless an answer is already kept for it; the first request for `path` gets it. */
export function early(path: string, run: () => Promise<unknown>): void {
  if (hasSeed(path)) return;
  const promise = run();
  // an early request nobody took must not surface as an unhandled rejection
  promise.catch(() => {});
  seeds.set(path, { promise, at: performance.now() });
}

/** Tests only. */
export function resetBoot(): void {
  seeds.clear();
  booted = false;
}
