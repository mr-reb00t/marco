// Emoji picker index and search. Pure functions (no imports at runtime) so the server tests can load them.

export type EmojiLang = 'es' | 'en' | 'pt' | 'nl' | 'da' | 'pl';
export type EmojiEntry = {
  e: string;
  /** keywords per language [es, en, pt, nl, da, pl]; the first one is the name */
  kw: string[][];
  /** folded words of every keyword, per language */
  words: string[][];
};
export type EmojiSection = { id: string; icon: string; title: string; list: EmojiEntry[] };
export type EmojiIndex = { sections: EmojiSection[]; all: EmojiEntry[]; byEmoji: Map<string, EmojiEntry> };

const LANGS: EmojiLang[] = ['es', 'en', 'pt', 'nl', 'da', 'pl'];

/** Lowercase, no accents, no punctuation: "Avión" and "avion" match (and "łódka" and "lodka"). */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
export const looksLikeEmoji = (s: string) => EMOJI_RE.test(s);

function parse(item: string): EmojiEntry {
  const sp = item.indexOf(' ');
  const e = item.slice(0, sp);
  const parts = item.slice(sp + 1).split('|');
  const kw = LANGS.map((_, i) => (parts[i] ?? '').split(',').map((k) => k.trim()).filter(Boolean));
  const words = kw.map((list) => [...new Set(list.flatMap((k) => foldText(k).split(' ')).filter(Boolean))]);
  return { e, kw, words };
}

/**
 * Builds the index from the category data. `frequent` becomes a first section (emojis that are
 * not in the data still show, without keywords).
 */
export function buildEmojiIndex(
  cats: { id: string; icon: string; title: string; items: string[] }[],
  frequent: { id: string; icon: string; title: string; emojis: string[] },
): EmojiIndex {
  const byEmoji = new Map<string, EmojiEntry>();
  const sections: EmojiSection[] = cats.map((c) => ({
    id: c.id,
    icon: c.icon,
    title: c.title,
    list: c.items.map((it) => {
      const en = parse(it);
      if (!byEmoji.has(en.e)) byEmoji.set(en.e, en);
      return en;
    }),
  }));
  const all = [...byEmoji.values()];
  const freq: EmojiSection = {
    id: frequent.id,
    icon: frequent.icon,
    title: frequent.title,
    list: frequent.emojis.map((e) => byEmoji.get(e) ?? { e, kw: LANGS.map(() => []), words: LANGS.map(() => []) }),
  };
  return { sections: [freq, ...sections], all, byEmoji };
}

export function emojiName(entry: EmojiEntry | undefined, lang: EmojiLang): string {
  if (!entry) return '';
  const i = LANGS.indexOf(lang);
  return entry.kw[i]?.[0] ?? entry.kw[1][0] ?? entry.e;
}

/** Lower is better; -1 when the token does not match any word. */
function tokenScore(words: string[], tok: string): number {
  let best = -1;
  for (const w of words) {
    let s = -1;
    if (w === tok) s = 0;
    else if (w.startsWith(tok)) s = 1;
    else if (tok.length >= 3 && w.includes(tok)) s = 3;
    if (s >= 0 && (best < 0 || s < best)) best = s;
    if (best === 0) break;
  }
  return best;
}

/**
 * Every word of the query has to match the start of a keyword word (or, from 3 letters, the
 * middle of one) in any of the languages. Matches in the current language rank first.
 */
export function searchEmoji(index: EmojiIndex, query: string, lang: EmojiLang): EmojiEntry[] {
  const raw = query.trim();
  if (!raw) return [];
  const exact = index.byEmoji.get(raw);
  const toks = foldText(raw).split(' ').filter(Boolean);
  if (!toks.length) return exact ? [exact] : [];
  const li = LANGS.indexOf(lang);
  const scored: { en: EmojiEntry; s: number; i: number }[] = [];
  index.all.forEach((en, i) => {
    let best = -1;
    for (let l = 0; l < LANGS.length; l++) {
      let sum = 0;
      for (const tok of toks) {
        const s = tokenScore(en.words[l] ?? [], tok);
        if (s < 0) {
          sum = -1;
          break;
        }
        sum += s;
      }
      if (sum < 0) continue;
      const s = sum * 2 + (l === li ? 0 : 1);
      if (best < 0 || s < best) best = s;
    }
    if (best >= 0) scored.push({ en, s: best, i });
  });
  scored.sort((a, b) => a.s - b.s || a.i - b.i);
  const out = scored.map((x) => x.en);
  if (exact && !out.includes(exact)) out.unshift(exact);
  return out;
}
