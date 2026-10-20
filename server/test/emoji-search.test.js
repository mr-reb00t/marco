// Admin emoji picker search (web/admin/emojiSearch.ts + emoji-data.ts, loaded through Node's TypeScript
// type stripping, so these tests are skipped on runtimes older than Node 22.18).
import { test } from 'node:test';
import assert from 'node:assert/strict';

let mod = null;
let data = null;
try {
  mod = await import('../../web/admin/emojiSearch.ts');
  data = await import('../../web/admin/emoji-data.ts');
} catch {
  mod = null;
}
const opts = { skip: mod && data ? false : 'TypeScript imports need Node ≥ 22.18' };
const FREQ = ['🎂', '✈️', '⚽', '🏠'];
const index = () => mod.buildEmojiIndex(data.EMOJI_CATEGORIES, { id: 'frequent', icon: '⭐', title: 'Frecuentes', emojis: FREQ });
const first = (q, lang = 'es') => mod.searchEmoji(index(), q, lang).slice(0, 5).map((e) => e.e);

test('emoji data: unique, six languages, compact', opts, () => {
  const seen = new Set();
  for (const c of data.EMOJI_CATEGORIES) {
    for (const it of c.items) {
      const e = it.slice(0, it.indexOf(' '));
      assert.ok(!seen.has(e), `duplicate ${e}`);
      seen.add(e);
      const parts = it.slice(it.indexOf(' ') + 1).split('|');
      assert.equal(parts.length, 6, it);
      for (const p of parts) assert.ok(p.trim(), it);
    }
  }
  assert.ok(seen.size >= 350 && seen.size <= 460, `${seen.size} emojis`);
});

test('emoji search: accents, languages and ranking', opts, () => {
  assert.equal(first('cumple')[0], '🎂');
  assert.ok(first('avion').includes('✈️'));
  assert.ok(first('AVIÓN').includes('✈️'));
  assert.equal(first('football')[0], '⚽');
  assert.ok(first('futebol', 'pt').includes('⚽'));
  assert.ok(first('praia', 'pt').includes('🏖️'));
  assert.ok(first('verjaardag', 'nl').includes('🎂'));
  assert.ok(first('voetbal', 'nl').includes('⚽'));
  assert.ok(first('fødselsdag', 'da').includes('🎂'));
  assert.ok(first('fodbold', 'da').includes('⚽'));
  assert.ok(first('strand', 'da').includes('🏖️'));
  assert.ok(first('urodziny', 'pl').includes('🎂'));
  assert.ok(first('piłka', 'pl').includes('⚽'));
  assert.ok(first('pilka', 'pl').includes('⚽'));
  assert.ok(first('plaża', 'pl').includes('🏖️'));
  assert.ok(first('tarta cumple').includes('🎂'));
  assert.deepEqual(first('zzqx'), []);
  assert.deepEqual(first('  '), []);
  assert.equal(first('🎂')[0], '🎂');
});

test('emoji names follow the language; frequent section comes first', opts, () => {
  const idx = index();
  assert.equal(idx.sections[0].id, 'frequent');
  assert.deepEqual(idx.sections[0].list.map((e) => e.e), FREQ);
  const cake = idx.byEmoji.get('🎂');
  assert.equal(mod.emojiName(cake, 'es'), 'tarta de cumpleaños');
  assert.equal(mod.emojiName(cake, 'en'), 'birthday cake');
  assert.equal(mod.emojiName(cake, 'pt'), 'bolo de aniversário');
  assert.equal(mod.emojiName(cake, 'nl'), 'verjaardagstaart');
  assert.equal(mod.emojiName(cake, 'da'), 'fødselsdagskage');
  assert.equal(mod.emojiName(cake, 'pl'), 'tort urodzinowy');
  assert.ok(mod.looksLikeEmoji('🦩'));
  assert.ok(!mod.looksLikeEmoji('abc'));
});
