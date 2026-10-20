// Text helpers shared by the server and its pure core (server/core). No Node APIs: hash() is a synchronous
// SHA-1 in plain JavaScript and randomId() uses crypto.getRandomValues, so the file also runs on Workers.
// server/lib/text.js re-exports it with a node:crypto hash(), which gives the same output faster.

/** Lowercase + strip diacritics, for accent-insensitive matching. */
export function fold(s) {
  // ł has no combining mark to strip, so it is mapped by hand: "Łódź" and "lodz" match
  return String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ł/g, 'l');
}

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '\u2014', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', euro: '€', copy: '©', reg: '®',
  trade: '™', deg: '°', middot: '·', bull: '•', iexcl: '¡', iquest: '¿', ordf: 'ª', ordm: 'º',
};

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    const k = e.toLowerCase();
    if (k in NAMED) return NAMED[k];
    // Latin-1 letters with accents: &aacute; &ntilde; &ccedil; …
    const acc = { acute: '́', grave: '̀', tilde: '̃', circ: '̂', uml: '̈', cedil: '̧' };
    const mm = /^([a-z])(acute|grave|tilde|circ|uml|cedil)$/i.exec(e);
    if (mm) return (mm[1] + acc[mm[2].toLowerCase()]).normalize('NFC');
    return m;
  });
}

/** Strip HTML tags → plain text, entities decoded, whitespace collapsed. */
export function stripHtml(html) {
  let s = String(html ?? '');
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, ' ');
  s = s.replace(/<[^>]*>/g, ' ');
  s = decodeEntities(decodeEntities(s)); // some feeds double-encode
  s = s.replace(/<[^>]*>/g, ' '); // tags that were entity-encoded
  return s.replace(/\s+/g, ' ').trim();
}

export function truncate(s, max) {
  s = String(s ?? '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:\u2013\u2014-]+$/, '') + '…';
}

/** Stable JSON stringify (sorted keys) for hashing. */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export function hash(v, len = 16) {
  const s = typeof v === 'string' ? v : stableStringify(v);
  return sha1Hex(s).slice(0, len);
}

/** Lowercase hex of `bytes` (Uint8Array). */
export function toHex(bytes) {
  let out = '';
  for (const x of bytes) out += x.toString(16).padStart(2, '0');
  return out;
}

export function randomId(prefix = '', bytes = 6) {
  return prefix + toHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * SHA-1 of the UTF-8 bytes of `s`, as hex. Synchronous on purpose (WebCrypto digests are async and the callers are
 * not). Same output as node:crypto. Only used for ids and change detection, never for security.
 */
export function sha1Hex(s) {
  const bytes = new TextEncoder().encode(String(s));
  const len = bytes.length;
  const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = len * 8;
  words[words.length - 2] = Math.floor(len / 0x20000000);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < words.length; off += 16) {
    for (let i = 0; i < 16; i++) w[i] = words[off + i];
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = tmp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}
