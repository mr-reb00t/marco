// Display identity (docs/ARCHITECTURE.md): how this display gets in (private link /d/<key>, paired-device token in
// localStorage, or nothing: open mode / admin session), which screen profile it shows (?screen=, ignored with a
// key or device token, which are bound to a screen) and a stable client id (?client= from the kiosk, else
// persisted in localStorage, else generated).

const params = new URLSearchParams(location.search);

/**
 * Admin preview iframe (`?preview=1`): live updates but never registered as a connected display. It also leaves this
 * browser's storage alone: no stored device token is read or written and no client id is kept, so a preview opened
 * where a real display runs (same browser) cannot replace that display's key, token or id.
 */
export const isPreview = params.get('preview') === '1';
/** Admin preview of one widget (Widgets page): only the widget, on a plain backdrop (styles.css html.widget-only). */
export const isWidgetOnly = isPreview && params.get('widgetOnly') === '1';

/** Private-link key from the path (/d/<key>); '' when the page was opened at / or /pair. */
export const linkKey = (() => {
  const m = /^\/d\/([^/?#]+)/.exec(location.pathname);
  try {
    return m ? decodeURIComponent(m[1]).trim().slice(0, 64) : '';
  } catch {
    return '';
  }
})();

const DEVICE_LS = 'marco.deviceToken';
/** Paired-device token (stored by the pairing screen). */
export function storedDeviceToken(): string {
  if (isPreview) return '';
  try {
    const v = localStorage.getItem(DEVICE_LS) || '';
    return /^md_[A-Za-z0-9_-]{43}$/.test(v) ? v : '';
  } catch {
    return '';
  }
}
export function saveDeviceToken(token: string): void {
  if (isPreview) return;
  try {
    localStorage.setItem(DEVICE_LS, token);
  } catch { /* storage disabled: the screen pairs again after a reload */ }
}
export function clearDeviceToken(): void {
  if (isPreview) return;
  try {
    localStorage.removeItem(DEVICE_LS);
  } catch { /* ignore */ }
}

/** The credential this display presents (X-Marco-Key / ?k=): the link key wins over a stored device token. */
export const credential = linkKey || storedDeviceToken();
export const credentialKind: 'key' | 'device' | '' = linkKey ? 'key' : credential ? 'device' : '';

/** Requested screen key (slug or id) as typed in the URL; '' = default screen (or the one bound to the credential). */
export const screenKey = credential ? '' : (params.get('screen') || '').trim().slice(0, 64);

/** Storage namespace for per-screen caches (`cs.cache.<ns>.config` …). Never contains the key itself. */
export const screenNs = linkKey ? `k_${linkKey.slice(0, 6).replace(/[^A-Za-z0-9]/g, '_')}` : credential ? '_device'
  : screenKey ? screenKey.toLowerCase().replace(/[^a-z0-9_-]/g, '_') : '_default';

/** Forget every cached data set (a revoked link or device must not keep showing family data). */
export function clearCaches(): void {
  if (isPreview) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cs.cache.')) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

const KIOSK_SS = 'marco.kioskKey';
/**
 * The kiosk key (server/power.js): deploy/kiosk.sh opens the page with #kp=<key>, only in the kiosk browser of the
 * computer that runs Marco. Kept in sessionStorage (this browser session only, so a reload or "Ir a pantalla" keeps
 * it) and taken out of the address. '' anywhere else: the "Salir del kiosko" and "Apagar" cards then say they only
 * work there. Never in the preview.
 */
export const kioskKey = ((): string => {
  if (isPreview) return '';
  const ok = (v: string) => /^[A-Za-z0-9_-]{43}$/.test(v);
  const m = /(?:^#|&)kp=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash);
  if (m) {
    try {
      sessionStorage.setItem(KIOSK_SS, m[1]);
    } catch { /* storage disabled: kept for this page only */ }
    try {
      const rest = location.hash.replace(/(^#|&)kp=[^&]*/, '$1').replace(/^#&/, '#').replace(/&$/, '');
      history.replaceState(history.state, '', `${location.pathname}${location.search}${rest === '#' ? '' : rest}`);
    } catch { /* the address keeps it */ }
    return m[1];
  }
  try {
    const v = sessionStorage.getItem(KIOSK_SS) || '';
    return ok(v) ? v : '';
  } catch {
    return '';
  }
})();

/** Request headers carrying the credential (fetch). */
export const authHeaders = (): Record<string, string> => (credential ? { 'X-Marco-Key': credential } : {});

/** Same-origin media URL with ?k= (an <img> / WebGL texture cannot send headers). Other URLs unchanged. */
export function mediaUrl(url: string): string {
  if (!credential || !url.startsWith('/media/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}k=${encodeURIComponent(credential)}`;
}

const CLIENT_RE = /^[A-Za-z0-9_-]{8,64}$/;

function sanitizeClient(raw: string): string {
  let s = raw.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!s) return '';
  if (s.length < 8) s = `d_${s}`.padEnd(8, '0');
  return CLIENT_RE.test(s) ? s : '';
}

function randomId(): string {
  let s = '';
  try {
    const a = new Uint8Array(10);
    crypto.getRandomValues(a);
    for (const b of a) s += (b % 36).toString(36);
  } catch {
    while (s.length < 10) s += Math.floor(Math.random() * 36).toString(36);
  }
  return `d_${s}`;
}

function resolveClientId(): string {
  const fromUrl = sanitizeClient(params.get('client') || '');
  if (fromUrl) return fromUrl;
  if (isPreview) return randomId(); // this page load only
  try {
    const stored = localStorage.getItem('cs.clientId');
    if (stored && CLIENT_RE.test(stored)) return stored;
    const id = randomId();
    localStorage.setItem('cs.clientId', id);
    return id;
  } catch {
    // private mode / storage disabled: stable for this page load only
    return randomId();
  }
}

export const clientId = resolveClientId();


/**
 * Screen of a carousel on display now (id); '' = not on a carousel, every request then asks for `screenKey` as it
 * always did. Set by main.ts when a carousel switches screen.
 */
let activeScreen = '';
export const getActiveScreen = (): string => activeScreen;
export function setActiveScreen(id: string): void {
  activeScreen = id || '';
}

/** Append `screen=<what the display is bound to>` (when set) to an API path: the live channels use this one. */
export function withTarget(path: string): string {
  if (!screenKey) return path;
  return `${path}${path.includes('?') ? '&' : '?'}screen=${encodeURIComponent(screenKey)}`;
}

/**
 * Append `screen=` (when set) to an API path: `screen` (default: the carousel screen on display), else the
 * screen key from the URL. Without a credential (open mode) a carousel screen also sends `via=<carousel>`, so the
 * server knows which carousel it belongs to; with one, the credential already says so.
 */
export function withScreen(path: string, screen: string = activeScreen): string {
  if (!screen) return withTarget(path);
  const via = !credential && screenKey && screenKey !== screen ? `&via=${encodeURIComponent(screenKey)}` : '';
  return `${path}${path.includes('?') ? '&' : '?'}screen=${encodeURIComponent(screen)}${via}`;
}
