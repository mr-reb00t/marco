// Pure parts of the activity log (server/activity.js keeps the file and the in-memory ring): which config sections
// changed, the secret redaction used for log lines and entries, and the size cap on entry data.
import { stableStringify } from './lib/text.js';

// Keep display credentials out of logs: private-link keys (/d/<key>, ?k=<key>), device tokens (md_…), pairing
// session ids, the family link (/f/<key>, fk_…) and family access links and phone tokens (/my/<link>, fa_…, fd_…).
// Used for server log lines that include URLs and as a safety net in the activity log.
const PATTERNS = [
  [/(\/[df]\/)[^/?#\s"']+/gi, '$1[redacted]'],
  [/([?&](?:k|key|sessionId|sid)=)[^&#\s"']+/gi, '$1[redacted]'],
  [/\bmd_[A-Za-z0-9_-]{20,}/g, 'md_[redacted]'],
  [/\bfk_[A-Za-z0-9_-]{20,}/g, 'fk_[redacted]'],
  [/(\/my\/)[^/?#\s"']+/gi, '$1[redacted]'],
  [/\bf([ad])_[A-Za-z0-9_-]{20,}/g, 'f$1_[redacted]'],
];

/** `s` with display keys, device tokens and pairing ids replaced by "[redacted]". */
export function redactSecrets(s) {
  let out = String(s ?? '');
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** True when `s` contains something redactSecrets() would hide. */
export const hasSecrets = (s) => PATTERNS.some(([re]) => { re.lastIndex = 0; const hit = re.test(String(s ?? '')); re.lastIndex = 0; return hit; });

/** Serialised `data` above this many characters is replaced by a truncated preview (entries come from
 * unauthenticated requests too). */
export const MAX_DATA_CHARS = 2048;

/** Keep `data` small and free of display credentials: oversized payloads become a truncated preview. */
export function capData(data) {
  let s;
  try { s = JSON.stringify(data); } catch { return { truncated: true }; }
  // Safety net: display keys / device tokens never land in the log, whatever a caller passes.
  if (s !== undefined && hasSecrets(s)) {
    s = redactSecrets(s);
    try { data = JSON.parse(s); } catch { return { redacted: true }; }
  }
  if (s === undefined || s.length <= MAX_DATA_CHARS) return data;
  return { truncated: true, preview: s.slice(0, 300) };
}

/**
 * Changed sections between two stored configs, for `config.saved`: top-level keys plus
 * `screens:<slug>.<section>` per screen (`screens:+<slug>` added, `screens:-<slug>` removed). Pure.
 */
export function changedSections(prev, next) {
  if (!prev) return ['*'];
  const same = (a, b) => stableStringify(a) === stableStringify(b);
  const out = [];
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (k === 'revision' || k === 'screens' || k === 'version') continue;
    if (!same(prev[k], next[k])) out.push(k);
  }
  const before = new Map((prev.screens || []).map((s) => [s.id, s]));
  const after = new Map((next.screens || []).map((s) => [s.id, s]));
  for (const [sid, s] of after) {
    const p = before.get(sid);
    if (!p) { out.push(`screens:+${s.slug}`); continue; }
    if (p.name !== s.name || p.slug !== s.slug) out.push(`screens:${s.slug}.name`);
    for (const sec of Object.keys(s)) {
      if (['id', 'slug', 'name'].includes(sec)) continue;
      if (!same(p[sec], s[sec])) out.push(`screens:${s.slug}.${sec}`);
    }
  }
  for (const [sid, p] of before) if (!after.has(sid)) out.push(`screens:-${p.slug}`);
  const order = (prev.screens || []).map((s) => s.id).filter((x) => after.has(x));
  const order2 = (next.screens || []).map((s) => s.id).filter((x) => before.has(x));
  if (!same(order, order2)) out.push('screens:order');
  return out;
}
