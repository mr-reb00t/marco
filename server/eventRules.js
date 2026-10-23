// event filters & overrides (hide / rename / style). Pure functions; unit-tested in events-rules.test.js.
// A rule's `match` may list several alternatives separated by commas (ruleNeedles).
// See docs/API.md and docs/ARCHITECTURE.md. Order: hide (any match) → rename (every match, chained, in list order) →
// style (first match on the renamed or the original title).
import { fold } from './lib/text.js';

const WS = /\s/u;

/**
 * Accent/case-insensitive, whitespace-collapsed view of `s` with a map back to the original string.
 * `text[i]` comes from `s.slice(starts[i], ends[i])`.
 */
export function foldMap(input) {
  const s = String(input ?? '').normalize('NFC');
  let text = '';
  const starts = [];
  const ends = [];
  let i = 0;
  let prevWs = false;
  for (const ch of s) {
    const len = ch.length;
    if (WS.test(ch)) {
      if (prevWs) ends[ends.length - 1] = i + len;
      else {
        text += ' ';
        starts.push(i);
        ends.push(i + len);
      }
      prevWs = true;
    } else {
      const f = fold(ch);
      for (let k = 0; k < f.length; k++) {
        starts.push(i);
        ends.push(i + len);
      }
      text += f;
      prevWs = false;
    }
    i += len;
  }
  return { source: s, text, starts, ends };
}

/** Normalised comparison key: folded, whitespace collapsed, trimmed. */
export const normKey = (s) => foldMap(String(s ?? '').trim()).text;

const needleCache = new Map();

/**
 * The needles of a rule (contains / startsWith; exact always uses `full`): `match` may list several alternatives
 * separated by commas ("14u, 15u, 16u"), each one trimmed, empty ones dropped. `full` is the whole string (comma
 * included), still matched literally so a rule like "Smith, John" keeps working.
 */
export function ruleNeedles(match) {
  // (the same few rules run over every event: their needles are worked out once)
  const key = String(match ?? '');
  const hit = needleCache.get(key);
  if (hit) return hit;
  const out = needlesOf(key);
  if (needleCache.size >= 500) needleCache.clear();
  needleCache.set(key, out);
  return out;
}

function needlesOf(match) {
  const full = normKey(match);
  const alts = [];
  for (const part of String(match ?? '').split(',')) {
    const k = normKey(part);
    if (k && !alts.includes(k)) alts.push(k);
  }
  return { full, alts };
}

/** Needles that hit the folded text `text` in `mode`: [full] when the whole literal hits, else the matching alternatives. */
function hits(text, { full, alts }, mode) {
  // exact never splits: the title must be the whole text (quick hide/style rules are made from titles with commas)
  if (mode === 'exact') return full && text === full ? [full] : [];
  const test = mode === 'startsWith' ? (n) => text.startsWith(n) : (n) => text.includes(n);
  if (full && test(full)) return [full];
  return alts.filter(test);
}

/** Does `rule` match the event? `ev` = { title, description?, location?, sourceId? }. Ignores enabled/sourceIds. */
export function textMatches(rule, ev) {
  const needles = ruleNeedles(rule.match);
  if (!needles.full) return false;
  const mode = rule.matchMode === 'exact' || rule.matchMode === 'startsWith' ? rule.matchMode : 'contains';
  if (hits(normKey(ev.title), needles, mode).length) return true;
  if (mode === 'contains' && rule.field === 'any') {
    return hits(normKey(ev.description), needles, mode).length > 0 || hits(normKey(ev.location), needles, mode).length > 0;
  }
  return false;
}

/** Rule applies to this source (enabled, and sourceIds empty or containing the event's source). */
export const ruleApplies = (rule, sourceId) =>
  rule && rule.enabled !== false && (!rule.sourceIds?.length || rule.sourceIds.includes(sourceId));

const tidy = (s) => String(s).replace(/\s+/g, ' ').trim();

/** Apply one rename rule to a title (assumes it matched). Empty result → previous title. */
export function renameTitle(title, rule) {
  const replaceWith = String(rule.replaceWith ?? '');
  let out;
  if (rule.matchMode === 'exact') {
    out = replaceWith;
  } else {
    const trimmed = String(title).trim();
    const m = foldMap(trimmed);
    const found = hits(m.text, ruleNeedles(rule.match), rule.matchMode === 'startsWith' ? 'startsWith' : 'contains');
    if (!found.length) return title;
    if (rule.matchMode === 'startsWith') {
      const needle = found.reduce((a, b) => (b.length > a.length ? b : a));
      out = replaceWith + m.source.slice(m.ends[needle.length - 1]);
    } else {
      // contains: replace every (non-overlapping) occurrence of every needle, case/accent-insensitive, left to
      // right; where two needles start at the same spot the longer one wins
      const byLength = [...found].sort((a, b) => b.length - a.length);
      const ranges = [];
      for (let at = 0; at < m.text.length; ) {
        const needle = byLength.find((x) => m.text.startsWith(x, at));
        if (!needle) { at++; continue; }
        ranges.push([m.starts[at], m.ends[at + needle.length - 1]]);
        at += needle.length;
      }
      if (!ranges.length) return title;
      out = '';
      let last = 0;
      for (const [a, b] of ranges) {
        if (a < last) continue;
        out += m.source.slice(last, a) + replaceWith;
        last = b;
      }
      out += m.source.slice(last);
    }
  }
  out = tidy(out);
  return out || title;
}

/**
 * Evaluate the rules for one event.
 * @param {Array} rules EventRule[]
 * @param {{ title: string, description?: string, location?: string, sourceId: string }} ev
 * @returns {{ hidden: boolean, title: string, style: object|null, applied: {ruleId: string, action: string}[] }}
 */
export function applyEventRules(rules, ev) {
  const applied = [];
  let hidden = false;
  const list = (rules || []).filter((r) => ruleApplies(r, ev.sourceId));
  if (!list.length) return { hidden, title: ev.title, style: null, applied };
  const original = ev.title;

  for (const r of list) {
    if (r.action === 'hide' && textMatches(r, ev)) {
      hidden = true;
      applied.push({ ruleId: r.id, action: 'hide' });
    }
  }

  let title = original;
  for (const r of list) {
    if (r.action !== 'rename' || !textMatches(r, { ...ev, title })) continue;
    const next = renameTitle(title, r);
    if (next !== title) {
      title = next;
      applied.push({ ruleId: r.id, action: 'rename' });
    }
  }

  let style = null;
  for (const r of list) {
    if (r.action !== 'style') continue;
    if (textMatches(r, { ...ev, title }) || (title !== original && textMatches(r, ev))) {
      style = r;
      applied.push({ ruleId: r.id, action: 'style' });
      break;
    }
  }
  return { hidden, title, style, applied };
}
