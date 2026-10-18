// GET /api/health, read once per page load by the parts of the display that depend on the server's edition:
// the pairing screen (code length, where to open the admin), the page a paired display continues at, and the
// optional emoji web font. Offline or on an old server it resolves to {} (self-hosted defaults).
import type { HealthResponse } from '../shared/types';
import { peekBoot } from './boot';

let pending: Promise<Partial<HealthResponse>> | null = null;

export function healthOnce(): Promise<Partial<HealthResponse>> {
  // the page bootstrap's answer (boot.ts), left for the live channel's first ask (api.health)
  const boot = pending ? null : peekBoot<Partial<HealthResponse>>('/api/health');
  if (boot) pending = Promise.resolve(boot);
  pending ??= (async () => {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch('/api/health', { cache: 'no-store', signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Partial<HealthResponse>;
      return j && typeof j === 'object' ? j : {};
    } catch {
      pending = null; // ask again next time
      return {};
    } finally {
      clearTimeout(tm);
    }
  })();
  return pending;
}

const EMOJI_CSS = 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap';

/**
 * Self-hosted displays also load Noto Color Emoji from Google Fonts, as before 0.5: an optional, non-blocking
 * fallback for systems without fonts-noto-color-emoji (installed by deploy/install.sh); offline it is simply
 * skipped. Other editions load nothing from third parties: the bundled "Marco Emoji" subset (web/shared/emoji-font.css)
 * covers the emoji the admin offers.
 */
export function loadEmojiWebFont(h: Partial<HealthResponse>, doc: Document = document): boolean {
  if (h.edition != null && h.edition !== 'self-hosted') return false;
  if (doc.getElementById('emoji-web-font')) return false;
  const link = doc.createElement('link');
  link.id = 'emoji-web-font';
  link.rel = 'stylesheet';
  link.href = EMOJI_CSS;
  // Loaded as "print" first so it never blocks rendering, then switched on.
  link.media = 'print';
  link.addEventListener('load', () => {
    link.media = 'all';
  });
  doc.head.appendChild(link);
  return true;
}
