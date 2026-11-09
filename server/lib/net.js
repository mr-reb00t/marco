// Network trust helpers: private-address checks, "is this client really on the LAN?", the Host-header allowlist
// (DNS-rebinding guard) and the outbound-fetch address filter (SSRF guard for unauthenticated endpoints).
import fs from 'node:fs';
import net from 'node:net';

/** Loopback or RFC1918/ULA/link-local address (after `trust proxy` resolution). */
export function isPrivateIp(ip) {
  const a = String(ip || '').replace(/^::ffff:/i, '');
  if (a === '::1' || a === '127.0.0.1' || a.startsWith('127.')) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
}

/** Rate-limit bucket for an address: IPv4 as is, IPv6 by /64 (one host usually owns a whole /64). */
export function ipBucket(ip) {
  const a = String(ip || '').replace(/^::ffff:/i, '');
  if (net.isIPv6(a)) {
    const full = expandIpv6(a);
    return full ? `${full.slice(0, 4).join(':')}::/64` : a;
  }
  return a;
}

function expandIpv6(a) {
  const s = a.split('%')[0];
  if (s.includes('.')) return null; // embedded IPv4: rare, keep as is
  const [head, tail = ''] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = s.includes('::') ? (tail ? tail.split(':') : []) : [];
  const fill = s.includes('::') ? new Array(8 - h.length - t.length).fill('0') : [];
  const parts = [...h, ...fill, ...t];
  return parts.length === 8 ? parts.map((p) => (p || '0').toLowerCase().replace(/^0+(?=.)/, '')) : null;
}

// ------------------------------------------------------------------------------------------------------------
// Container detection: inside Docker/Podman, connections relayed by the host (docker-proxy for localhost/IPv6
// clients, Docker Desktop, rootless slirp4netns/pasta) arrive from the container's default gateway, whoever the
// real client is. That address is "private" but says nothing about where the client is.

let gatewayCache;
/** Default gateway of this container (IPv4), or null when not running in a container. */
export function containerGateway() {
  if (gatewayCache !== undefined) return gatewayCache;
  gatewayCache = null;
  try {
    if (!fs.existsSync('/.dockerenv') && !fs.existsSync('/run/.containerenv')) return gatewayCache;
    for (const line of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const [, dest, gw] = line.trim().split(/\s+/);
      if (dest === '00000000' && gw && gw !== '00000000') {
        const n = parseInt(gw, 16);
        gatewayCache = [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255].join('.');
        break;
      }
    }
  } catch { /* not Linux / no procfs */ }
  return gatewayCache;
}
/** Tests only. */
export const _setContainerGateway = (gw) => { gatewayCache = gw; };

export const inContainer = () => {
  try { return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv'); } catch { return false; }
};

const FORWARD_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-proto', 'x-forwarded-host'];
const warnedProxies = new Set();
const warnedNoXff = new Set();

/** The request carries a forwarding header (X-Forwarded-For/-Proto/-Host, Forwarded or X-Real-IP): a proxy relayed it. */
export function relayed(req) {
  return FORWARD_HEADERS.some((h) => req.headers?.[h]);
}

const peerOf = (req) => req.socket?.remoteAddress || '';
const trustedPeer = (req) => {
  const trust = typeof req.app?.get === 'function' ? req.app.get('trust proxy fn') : null;
  return Boolean(trust && trust(peerOf(req), 0));
};

/**
 * True when the request was relayed (forwarding headers present) and its client address is not known:
 *   - the proxy is not in TRUST_PROXY (Express ignores its X-Forwarded-For), or
 *   - the proxy is trusted but sent no X-Forwarded-For (only X-Real-IP, Forwarded, X-Forwarded-Proto or
 *     X-Forwarded-Host, e.g. nginx with `proxy_set_header X-Real-IP` alone): Express reads the client address from
 *     X-Forwarded-For only, so `req.ip` would be the proxy itself (127.0.0.1 for a proxy on this machine) and every
 *     Internet client would look local.
 * Such clients are treated as remote (fail closed).
 */
export function untrustedProxy(req) {
  if (!relayed(req)) return false;
  const peer = peerOf(req);
  const ip = peer.replace(/^::ffff:/i, '');
  if (trustedPeer(req)) {
    if (req.headers?.['x-forwarded-for']) return false;
    if (!warnedNoXff.has(peer) && warnedNoXff.size < 20) {
      warnedNoXff.add(peer);
      console.warn(`[net] requests from the proxy at ${ip} carry forwarding headers but no X-Forwarded-For: their clients are treated as `
        + 'remote (setup token required, no LAN access). Make the proxy send X-Forwarded-For (nginx: proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for)');
    }
    return true;
  }
  if (!warnedProxies.has(peer) && warnedProxies.size < 20) {
    warnedProxies.add(peer);
    console.warn(`[net] requests from ${ip} carry X-Forwarded-* headers but ${ip} is not a trusted proxy: their clients are treated as `
      + `remote (setup token required, no Secure cookie detection). If this is your reverse proxy, set TRUST_PROXY=${ip}`);
  }
  return true;
}

/**
 * Rate-limit bucket for a request: ipBucket(req.ip), except behind a trusted proxy that sends X-Real-IP without
 * X-Forwarded-For, where req.ip is the proxy for everybody (one shared bucket would let one client lock out all
 * the others): there X-Real-IP picks the bucket. Only used to count attempts, never to trust a client.
 */
export function clientBucket(req) {
  const real = String(req.headers?.['x-real-ip'] || '').trim();
  if (real && !req.headers?.['x-forwarded-for'] && net.isIP(real.replace(/^::ffff:/i, '')) && trustedPeer(req)) return ipBucket(real);
  return ipBucket(req.ip);
}

/**
 * Does this request really come from the local network? Private `req.ip` AND not relayed by an untrusted proxy
 * (a proxy on the Docker bridge or another host without TRUST_PROXY would otherwise make every Internet client
 * look local; so would a trusted proxy that sends no X-Forwarded-For). `strict` (setup wizard without token, weak
 * ADMIN_PASSWORD) also refuses any relayed request and the container's gateway address, which in Docker Desktop /
 * rootless setups is what every client looks like.
 */
export function isLanClient(req, { strict = false } = {}) {
  const ip = String(req.ip || '').replace(/^::ffff:/i, '');
  if (!isPrivateIp(ip)) return false;
  if (untrustedProxy(req)) return false;
  if (strict) {
    // setup without token, weak ADMIN_PASSWORD: a direct connection only. A relayed request's client address is only
    // as good as the proxy's X-Forwarded-For (a proxy that passes the client's own header on unchanged lets anyone
    // claim a LAN address), so any forwarding header is enough to refuse.
    if (relayed(req)) return false;
    const gw = containerGateway();
    if (gw && ip === gw) return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------------------------
// Host allowlist (DNS rebinding). A malicious website can point its own hostname at this server's LAN IP; the
// victim's browser then talks to us "same-origin" with Host: attacker.example. Only names that cannot be
// rebound from the public DNS are accepted, plus the ones the owner configures.

const LAN_SUFFIXES = ['.local', '.lan', '.home.arpa', '.internal', '.localdomain', '.home', '.localhost'];

function configuredHosts() {
  const out = [];
  for (const u of [process.env.PUBLIC_URL]) {
    if (!u) continue;
    try { out.push(new URL(u).hostname.toLowerCase()); } catch { /* ignore */ }
  }
  for (const h of String(process.env.ALLOWED_HOSTS || '').split(',')) {
    const x = h.trim().toLowerCase();
    if (x) out.push(x.replace(/^\*\./, '.').replace(/:\d+$/, ''));
  }
  return out;
}

/** Host name (no port) from a Host header value, lower-case, IPv6 brackets removed. */
export function hostnameOf(hostHeader) {
  let h = String(hostHeader || '').trim().toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') > 0 ? h.indexOf(']') : undefined);
  h = h.replace(/:\d*$/, '');
  return h.replace(/\.$/, '');
}

export function hostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || net.isIP(h)) return true;
  if (!h.includes('.')) return true; // single-label LAN names (raspberrypi, nas…) are never resolved by public DNS
  if (LAN_SUFFIXES.some((s) => h.endsWith(s))) return true;
  for (const a of configuredHosts()) {
    if (a === '*') return true;
    if (a.startsWith('.') ? h.endsWith(a) || h === a.slice(1) : h === a) return true;
  }
  return false;
}

const warnedHosts = new Set();
/** Express middleware: 421 for requests whose Host is not allowed (webhooks/health excluded: no ambient authority). */
export function hostGuard({ exempt = ['/api/health', '/api/hooks'] } = {}) {
  return (req, res, next) => {
    if (exempt.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
    const host = hostnameOf(req.get('host'));
    if (hostAllowed(host)) return next();
    if (!warnedHosts.has(host) && warnedHosts.size < 50) {
      warnedHosts.add(host);
      console.warn(`[net] refused request for unknown host "${host}" (DNS rebinding guard). If that is your own domain, `
        + 'set PUBLIC_URL or ALLOWED_HOSTS to it.');
    }
    res.status(421).type('text/plain').send('Unknown host name. Set PUBLIC_URL or ALLOWED_HOSTS on the server to use this address.');
  };
}

/** PUBLIC_URL's origin when it points somewhere else than this machine (http(s) only), else null. */
export function publicOrigin() {
  const v = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|\[::1\])/.test(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------------------
// Same machine, no proxy: the "Salir del kiosko" and "Apagar" cards (routes/power.js) act on the computer that runs
// the server, so only a browser on that computer may use them. `req.ip` and `trust proxy` are not used: a proxy on
// this machine (Caddy, nginx) connects from 127.0.0.1 too, so a request that carries any proxy header is refused.

const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'via', 'cf-connecting-ip', 'true-client-ip'];
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

/** A loopback socket address (127.x, ::1, ::ffff:127.x). */
const loopbackPeer = (addr) => {
  const a = String(addr || '').replace(/^::ffff:/i, '');
  return a === '::1' || (net.isIPv4(a) && a.startsWith('127.'));
};

/**
 * The request comes straight from this machine: the socket's own address is loopback, no proxy header at all, and
 * Host is localhost, 127.0.0.1 or [::1] (any port), so a name that resolves here (DNS rebinding) does not count.
 */
export function sameMachineDirect(req) {
  if (!loopbackPeer(req?.socket?.remoteAddress)) return false;
  if (PROXY_HEADERS.some((h) => req.headers?.[h] !== undefined)) return false;
  return LOOPBACK_NAMES.has(hostnameOf(req.headers?.host));
}

/**
 * A POST from a page of this very origin: Origin is exactly http://<Host> (a sandboxed frame sends "null", another
 * site its own), and Sec-Fetch-Site, when the browser sends it, is same-origin.
 */
export function sameOrigin(req) {
  const host = String(req?.headers?.host || '');
  if (!host || req.headers?.origin !== `http://${host}`) return false;
  const site = req.headers?.['sec-fetch-site'];
  return site === undefined || site === 'same-origin';
}

// ------------------------------------------------------------------------------------------------------------
// Outbound fetch filter (SSRF) for unauthenticated endpoints: no loopback, link-local (incl. cloud metadata
// 169.254.169.254 / fd00:ec2::254), unspecified, multicast or the metadata names.

const BLOCKED_NAMES = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data']);

export function blockedFetchAddress(ip) {
  let a = String(ip || '').toLowerCase();
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a); // ::ffff:7f00:1 (how URL() writes ::ffff:127.0.0.1)
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    a = [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  a = a.replace(/^::ffff:/, '');
  if (net.isIPv4(a)) {
    const [p, q] = a.split('.').map(Number);
    return p === 127 || p === 0 || (p === 169 && q === 254) || p >= 224 || (p === 100 && q === 100 && a === '100.100.100.200');
  }
  if (net.isIPv6(a)) {
    return a === '::1' || a === '::' || /^fe[89ab][0-9a-f]:/.test(a) || a.startsWith('ff') || a.startsWith('fd00:ec2:');
  }
  return false;
}

export function blockedFetchHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (BLOCKED_NAMES.has(h) || h.endsWith('.localhost')) return true;
  return net.isIP(h) ? blockedFetchAddress(h) : false;
}
