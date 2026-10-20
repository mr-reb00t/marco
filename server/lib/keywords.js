// Icon-rule keyword matching, shared by the server (server/rules.js) and the admin preview
// (web/admin/util.ts imports this file directly, typed by keywords.d.ts). Pure, dependency-free.

/** Lowercase + strip diacritics, ł as l (same as server/core/lib/text.js fold). */
export const foldText = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ł/g, 'l');

export const SHORT_KEYWORD = 4;
const reCache = new Map();

/**
 * Accent/case-insensitive keyword match on already folded text. Keywords longer than 4 characters match as a
 * substring ("dentist" in "Dentista"); short ones (≤ 4: "car", "vet", "call", "gym", "itv", "cine") must be a
 * whole word, otherwise "car" would hit "Carmen", "Oscar" or "Carlos" and "call" would hit "Calle".
 */
export function keywordMatches(foldedText, keyword) {
  const k = foldText(keyword).trim();
  if (!k) return false;
  if ([...k].length > SHORT_KEYWORD) return foldedText.includes(k);
  let re = reCache.get(k);
  if (!re) {
    re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'u');
    if (reCache.size > 500) reCache.clear();
    reCache.set(k, re);
  }
  return re.test(foldedText);
}

/** First (rule, keyword) whose keyword matches `text` (raw, folded here), in rule order; or null. */
export function findKeyword(rules, text) {
  const hay = foldText(text);
  if (!hay.trim()) return null;
  for (let i = 0; i < (rules || []).length; i++) {
    for (const kw of rules[i].match || []) if (keywordMatches(hay, kw)) return { rule: rules[i], keyword: kw, index: i };
  }
  return null;
}
