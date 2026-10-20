// Dutch (nl), Danish (da) and Polish (pl): every text the admin, the family page, the display and the server can show
// has a value in each, with the same {placeholders} as the source, and a missing key falls back to English. Polish also
// has a "few" form for counts like 2-4. The web modules load through Node's TypeScript type stripping (skipped before
// Node 22.18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// a namespace import: Node 20 has no registerHooks, and a named import of it would fail before any test runs
import * as nodeModule from 'node:module';
import { LANGS, wmoDescription, windDirLabel, t as serverT, countChanged, countNoun, summaryWord, langFromHeader } from '../core/lib/i18n.js';
import { translateHoliday } from '../rules.js';
import { findKeyword } from '../lib/keywords.js';
import { defaultConfig, DEFAULT_ICON_RULES } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';

// The admin's own imports have no extension (Vite resolves them): add ".ts" for those under web/.
nodeModule.registerHooks?.({
  resolve(specifier, context, next) {
    if (/^\.\.?\/[^.]*$/.test(specifier) && context.parentURL?.includes('/web/')) {
      try { return next(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return next(specifier, context);
  },
});

const load = async (p) => {
  try {
    return await import(p);
  } catch {
    return null;
  }
};
const dict = await load('../../web/admin/i18n-dict.ts');
const plural = await load('../../web/admin/i18n-plural.ts');
const family = await load('../../web/admin/i18n-dict-family.ts');
const nlMod = await load('../../web/admin/i18n-dict-nl.ts');
const daMod = await load('../../web/admin/i18n-dict-da.ts');
const plMod = await load('../../web/admin/i18n-dict-pl.ts');
const shared = await load('../../web/shared/i18n.ts');
const ts = { skip: dict && plural && family && nlMod && daMod && plMod && shared ? false : 'TypeScript imports need Node >= 22.18' };

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
const MORE = () => ({
  nl: { rows: { ...nlMod.NL, ...family.NL_FAMILY }, one: { ...nlMod.NL_SINGULAR, ...family.NL_SINGULAR_FAMILY } },
  da: { rows: { ...daMod.DA, ...family.DA_FAMILY }, one: { ...daMod.DA_SINGULAR, ...family.DA_SINGULAR_FAMILY } },
  pl: { rows: { ...plMod.PL, ...family.PL_FAMILY }, one: { ...plMod.PL_SINGULAR, ...family.PL_SINGULAR_FAMILY } },
});

test('languages: es, en, pt, nl, da and pl on the server and the screens', ts, () => {
  assert.deepEqual(LANGS, ['es', 'en', 'pt', 'nl', 'da', 'pl']);
  assert.deepEqual(shared.LANGS, LANGS);
  assert.equal(shared.LOCALES.nl, 'nl-NL');
  assert.equal(shared.LOCALES.da, 'da-DK');
  assert.equal(shared.LOCALES.pl, 'pl-PL');
  assert.equal(shared.LANG_NAMES.pl, 'Polski');
  assert.equal(shared.normLang('pl'), 'pl');
  assert.equal(langFromHeader('pl-PL,pl;q=0.9,en;q=0.5'), 'pl');
  assert.equal(shared.normLang('nl'), 'nl');
  assert.equal(shared.normLang('da'), 'da');
  assert.equal(shared.normLang('fr'), 'en');
  assert.equal(langFromHeader('nl-BE,nl;q=0.9'), 'nl');
  assert.equal(langFromHeader('da-DK,da;q=0.9,en;q=0.5'), 'da');
  for (const lang of ['nl', 'da', 'pl']) {
    const c = defaultConfig();
    c.screens[0].screen.language = lang;
    const v = validateConfig(c);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(v.value.screens[0].screen.language, lang);
  }
});

test('admin: every Spanish key has a Dutch, a Danish and a Polish value with the same placeholders, and nothing extra', ts, () => {
  const keys = Object.keys(dict.EN);
  for (const [lang, { rows }] of Object.entries(MORE())) {
    const missing = keys.filter((k) => typeof rows[k] !== 'string' || !rows[k].trim());
    assert.deepEqual(missing, [], `${lang} misses admin rows`);
    const extra = Object.keys(rows).filter((k) => !(k in dict.EN));
    assert.deepEqual(extra, [], `${lang} has rows no dictionary uses`);
    for (const k of keys) assert.equal(holes(rows[k]), holes(k), `${lang} placeholders: ${k}`);
  }
});

test('admin: every singular form has a Dutch, a Danish and a Polish value', ts, () => {
  for (const [lang, { one }] of Object.entries(MORE())) {
    for (const [k, [es]] of Object.entries(plural.SINGULAR)) {
      assert.ok(one[k], `${lang} misses the singular of ${k}`);
      assert.equal(holes(one[k]), holes(es), `${lang} singular placeholders: ${k}`);
    }
    // Polish may also need a singular where the other languages do not change ("kończy 1 rok", "turns 1")
    const polishOnly = (k) => lang === 'pl' && k in dict.EN && /\{n\}/.test(k);
    assert.deepEqual(Object.keys(one).filter((k) => !(k in plural.SINGULAR) && !polishOnly(k)), [], `${lang} has singular forms nobody uses`);
  }
});

test('family page: the family tables hold every Familia row, so the page needs nothing else', ts, () => {
  for (const [lang, mod] of [['nl', family.NL_FAMILY], ['da', family.DA_FAMILY], ['pl', family.PL_FAMILY]]) {
    const rows = family.ROWS_FAMILY.map((r) => r[0]).filter((k) => !(k in mod));
    assert.deepEqual(rows, [], `${lang} family rows`);
  }
  for (const [lang, mod] of [['nl', family.NL_SINGULAR_FAMILY], ['da', family.DA_SINGULAR_FAMILY], ['pl', family.PL_SINGULAR_FAMILY]]) {
    assert.deepEqual(Object.keys(family.SINGULAR_FAMILY).filter((k) => !(k in mod)), [], `${lang} family singular forms`);
  }
  const src = read('web/family/i18n.ts');
  assert.doesNotMatch(src, /i18n-dict-(nl|da|pl)/, 'the family page loads only the family tables');
});

test('admin t(): Dutch and Danish, singular forms, English when a key is missing', ts, async () => {
  globalThis.document ??= { documentElement: {} };
  const i18n = await import('../../web/admin/i18n.ts');
  try {
    i18n.setLang('nl');
    assert.equal(i18n.t('Guardar'), nlMod.NL.Guardar ?? family.NL_FAMILY.Guardar);
    assert.equal(i18n.t('{n} pantallas', { n: 1 }), '1 scherm');
    assert.equal(i18n.t('{n} pantallas', { n: 3 }), '3 schermen');
    assert.equal(i18n.t('Festivos de Dinamarca'), 'Feestdagen Denemarken');
    i18n.setLang('da');
    assert.equal(i18n.t('{n} pantallas', { n: 1 }), '1 skærm');
    assert.equal(i18n.t('{n} pantallas', { n: 2 }), '2 skærme');
    assert.equal(i18n.t('Forma'), 'Form');
    // a key with no Danish value yet: the English one
    delete daMod.DA['Cerrar'];
    assert.equal(i18n.t('Cerrar'), dict.EN['Cerrar']);
    assert.equal(i18n.t('Texto que no existe'), 'Texto que no existe');
    assert.equal(i18n.locale(), 'da-DK');
    assert.equal(i18n.browserLang(['nl-NL']), 'nl');
    assert.equal(i18n.browserLang(['da']), 'da');
  } finally {
    i18n.setLang('es');
  }
});

test('the price widget Shape field has its own key (not the date Format one)', ts, () => {
  assert.equal(dict.EN.Forma, 'Shape');
  assert.equal(dict.EN.Formato, 'Format');
  assert.match(read('web/admin/sections/PriceWidget.tsx'), /label=\{t\('Forma'\)\}/);
});

test('display: every key in Dutch, Danish and Polish with the same placeholders; English for a missing one', ts, () => {
  const en = shared.DICTS.en;
  for (const lang of ['nl', 'da', 'pl']) {
    const d = shared.DICTS[lang];
    assert.deepEqual(Object.keys(en).filter((k) => !d[k]), [], `${lang} display keys`);
    // Polish "few" twins (key_few) belong to a key that exists, with the same placeholders
    const base = (k) => (lang === 'pl' ? k.replace(/_few$/, '') : k);
    assert.deepEqual(Object.keys(d).filter((k) => !(base(k) in en)), [], `${lang} extra display keys`);
    for (const k of Object.keys(d)) assert.equal(holes(d[k]), holes(en[base(k)]), `${lang} placeholders: ${k}`);
  }
  const saved = shared.DICTS.da.today;
  delete shared.DICTS.da.today;
  try {
    assert.equal(shared.t('da', 'today'), 'Today');
  } finally {
    shared.DICTS.da.today = saved;
  }
  assert.equal(shared.t('nl', 'inMinutes', { n: 5 }), 'Over 5 min');
});

test('display: pairing screen texts in Dutch, Danish and Polish', () => {
  const src = read('web/display/widgets/pairing.ts');
  const block = (l) => src.slice(src.indexOf(`\n  ${l}: {`), src.indexOf('\n  },', src.indexOf(`\n  ${l}: {`)));
  const keys = (l) => [...block(l).matchAll(/\n {4}(\w+): /g)].map((m) => m[1]);
  for (const l of ['nl', 'da', 'pl']) assert.deepEqual(keys(l), keys('en'), l);
});

test('display: welcome screen texts in Dutch, Danish and Polish', () => {
  const src = read('web/display/widgets/welcome.ts');
  const block = (l) => src.slice(src.indexOf(`\n  ${l}: {`), src.indexOf('\n  },', src.indexOf(`\n  ${l}: {`)));
  const keys = (l) => [...block(l).matchAll(/\n {4}(\w+): /g)].map((m) => m[1]);
  for (const l of ['nl', 'da', 'pl']) assert.deepEqual(keys(l), keys('en'), l);
});

test('demo seed (scripts/demo.js): every demo string has a Dutch, a Danish and a Polish version', () => {
  const src = read('scripts/demo.js');
  const table = src.slice(src.indexOf('const NL_DA_PL = {'), src.indexOf('\n};', src.indexOf('const NL_DA_PL = {')));
  const lit = `('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`;
  const strings = new Set([...src.matchAll(new RegExp(`\\bL\\(\\s*${lit}`, 'g'))].map((m) => m[1].slice(1, -1)));
  assert.ok(strings.size > 40, `${strings.size} demo strings`);
  const missing = [...strings].filter((s) => !table.includes(`'${s}': [`) && !table.includes(`"${s}": [`));
  assert.deepEqual(missing, []);
  // three values per row: nl, da, pl
  for (const line of table.split('\n').filter((l) => /^ {2}["']/.test(l))) {
    const cols = line.slice(line.indexOf('[') + 1, line.lastIndexOf(']')).match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g);
    assert.equal(cols.length, 3, line);
  }
});

test('dates: long date line as Dutch and Danish write it; Monday first; decimal comma', ts, () => {
  const f = (lang, fmt) => shared.formatDateLine(lang, '2026-10-12', fmt);
  assert.equal(f('nl', 'weekday_d_month'), 'Maandag 12 oktober');
  assert.equal(f('da', 'weekday_d_month'), 'Mandag den 12. oktober');
  assert.equal(f('da', 'weekday_d_dot_month'), 'Mandag 12. oktober');
  assert.deepEqual(shared.weekdayNames('nl', 1).slice(0, 2), ['Ma', 'Di']);
  assert.deepEqual(shared.weekdayNames('da', 1).slice(0, 2), ['Man', 'Tirs']);
  assert.equal(shared.monthName('nl', 3), 'Maart');
  assert.equal(shared.formatDatePattern('da', '2026-10-12', '{dddd} {d}. {mmmm}'), 'Mandag 12. oktober');
  assert.equal((1234.5).toLocaleString(shared.LOCALES.nl), '1.234,5');
  assert.equal((1234.5).toLocaleString(shared.LOCALES.da), '1.234,5');
});

test('weather: descriptions and wind directions in Dutch and Danish', () => {
  assert.equal(wmoDescription(0, 'nl'), 'Onbewolkt');
  assert.equal(wmoDescription(95, 'da'), 'Tordenvejr');
  assert.equal(windDirLabel(90, 'nl'), 'O');
  assert.equal(windDirLabel(225, 'nl'), 'ZW');
  assert.equal(windDirLabel(90, 'da'), 'Ø');
  assert.equal(windDirLabel(315, 'da'), 'NV');
  for (const code of [0, 1, 2, 3, 45, 61, 63, 71, 80, 95, 99]) {
    for (const l of ['nl', 'da']) assert.ok(wmoDescription(code, l), `${l} ${code}`);
  }
});

test('server words: private mode titles and backup summaries in Dutch and Danish', () => {
  assert.equal(serverT('busy', 'nl'), 'Bezet');
  assert.equal(serverT('reservation', 'da'), 'Reservation');
  assert.equal(serverT('blocked', 'da'), 'Ikke ledig');
  assert.equal(countNoun(1, 'screen', 'nl'), '1 scherm');
  assert.equal(countNoun(3, 'iconRule', 'da'), '3 ikonregler');
  assert.equal(countChanged(2, 'screen', 'nl'), '2 gewijzigd');
  assert.equal(countChanged(1, 'source', 'da'), '1 ændret');
  assert.equal(summaryWord('unchanged', 'da'), 'uændret');
  assert.equal(summaryWord('settingsModified', 'nl'), 'instellingen gewijzigd');
});

test('holidays: the Dutch, Belgian, Danish and Polish Google feeds, curly apostrophes included', () => {
  assert.equal(translateHoliday("King's Birthday", 'nl'), 'Koningsdag');
  assert.equal(translateHoliday('Second Day of Christmas', 'nl'), 'Tweede kerstdag');
  assert.equal(translateHoliday('Father’s Day', 'nl'), 'Vaderdag');
  assert.equal(translateHoliday('Mother’s Day', 'da'), 'Mors dag');
  assert.equal(translateHoliday('Belgian National Day', 'da'), 'Belgiens nationaldag');
  assert.equal(translateHoliday('Great Prayer Day', 'da'), 'Store bededag');
  assert.equal(translateHoliday('2nd Christmas Day', 'da'), '2. juledag');
  assert.equal(translateHoliday('Constitution Day', 'da'), 'Grundlovsdag');
  assert.equal(translateHoliday('Whit Monday', 'es'), 'Lunes de Pentecostés');
  assert.equal(translateHoliday('Palm Sunday', 'pt'), 'Domingo de Ramos');
  assert.equal(translateHoliday("King's Birthday", 'en'), "King's Birthday");
  assert.equal(translateHoliday('Christmas Eve', 'pl'), 'Wigilia');
  assert.equal(translateHoliday('Independence Day', 'pl'), 'Święto Niepodległości');
  assert.equal(translateHoliday('National Independence Day', 'pl'), 'Narodowe Święto Niepodległości');
  assert.equal(translateHoliday('May 3rd Constitution Day', 'pl'), 'Święto Konstytucji 3 Maja');
  assert.equal(translateHoliday("All Souls' Day", 'pl'), 'Zaduszki');
  assert.equal(translateHoliday('Father’s Day', 'pl'), 'Dzień Ojca');
  assert.equal(translateHoliday('Whit Sunday', 'pl'), 'Zielone Świątki');
  // every row has a value for es, pt, nl, da and pl
  const src = read('server/rules.js');
  const block = src.slice(src.indexOf('const HOLIDAYS = {'), src.indexOf('\n};', src.indexOf('const HOLIDAYS = {')));
  for (const line of block.split('\n').filter((l) => /^ {2}["']/.test(l))) {
    const cols = line.slice(line.indexOf('[') + 1, line.lastIndexOf(']')).match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g);
    assert.equal(cols.length, 5, line);
  }
});

test('icon rules: Dutch, Danish and Polish keywords, within the limits, for existing installs too (marker v4)', () => {
  const emoji = (title) => findKeyword(DEFAULT_ICON_RULES, title)?.rule.emoji ?? null;
  assert.equal(emoji('Verjaardag van Anna'), '🎂');
  assert.equal(emoji('Tandarts Lucía'), '🩺');
  assert.equal(emoji('Zwemles'), emoji('Swimming lesson'));
  assert.equal(emoji('Annas fødselsdag'), '🎂');
  assert.equal(emoji('Tandlæge'), '🩺');
  assert.equal(emoji('Fodboldtræning'), emoji('Football practice'));
  assert.equal(emoji('Morfar Luis'), null);
  assert.equal(emoji('Urodziny Ani'), '🎂');
  assert.equal(emoji('Dentysta Lucía'), '🩺');
  assert.equal(emoji('Lekcja pływania'), emoji('Swimming lesson'));
  assert.equal(emoji('Wywóz śmieci'), '🗑️');
  assert.equal(emoji('Wylot do Madrytu'), '✈️');
  assert.equal(emoji('Dziadek Luis'), null);
  // Polish stems must not catch other languages' titles
  assert.equal(emoji('Terminar el informe'), null);
  assert.equal(emoji('Pilot doctor visit'), emoji('Doctor visit'));
  assert.equal(emoji('Parking lot downtown'), null);
  assert.equal(emoji('PSA test'), null);
  assert.equal(emoji('Apple pies'), null);
  assert.equal(emoji('Praça do Comércio'), null);
  for (const r of DEFAULT_ICON_RULES) assert.ok(r.match.length <= 100, `${r.id}: ${r.match.length} keywords`);
  assert.match(read('server/store.js'), /const ICON_RULES_MARKER = '.iconrules-v4';/);
});

test('demo data: every demo string of mock.ts has a Dutch, a Danish and a Polish version', ts, async () => {
  const { DEMO_MORE, DEMO_NEWS } = await import('../../web/display/mock-text.ts');
  const src = read('web/display/mock.ts');
  const strings = new Set();
  const lit = `('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`;
  const unq = (s) => s.slice(1, -1).replace(/\\'/g, "'");
  for (const m of src.matchAll(new RegExp(`\\bL\\(\\s*${lit}`, 'g'))) strings.add(unq(m[1]));
  // tuples [en, es, pt, …] (holidays: ['MM-DD', en, …])
  for (const m of src.matchAll(new RegExp(`\\[(?:'\\d\\d-\\d\\d', )?${lit}, '[^']*', '[^']*'(?:, \\d+, \\d+)?, '(?:c_\\w+)'\\]|\\['\\d\\d-\\d\\d', ${lit}, `, 'g'))) strings.add(unq(m[1] ?? m[2]));
  // family demo (Spanish): routines, meals, rewards, grown-ups' names
  for (const m of src.matchAll(/\['m_\w+', '(?:morning|afternoon|evening|any)', '[^']+', '([^']+)'/g)) strings.add(m[1]);
  for (const m of src.matchAll(/(?:breakfast|lunch|snack|dinner): '([^']+)'/g)) strings.add(m[1]);
  for (const m of src.matchAll(/\{ title: '([^']+)', emoji/g)) strings.add(m[1]);
  for (const n of ['Mamá', 'Papá', 'Abuela Carmen']) strings.add(n);
  strings.delete('English');
  assert.ok(strings.size > 150, `${strings.size} demo strings`);
  const missing = [...strings].filter((s) => !DEMO_MORE[s] || DEMO_MORE[s].length !== 3 || DEMO_MORE[s].some((v) => !v));
  assert.deepEqual(missing, []);
  assert.equal(DEMO_NEWS.nl.length, 6);
  assert.equal(DEMO_NEWS.da.length, 6);
  assert.equal(DEMO_NEWS.pl.length, 6);
});

test('Dutch, Danish and Polish files: no em dashes, no DAKboard', () => {
  for (const f of ['web/admin/i18n-dict-nl.ts', 'web/admin/i18n-dict-da.ts', 'web/admin/i18n-dict-pl.ts', 'web/admin/i18n-dict-family.ts', 'web/display/mock-text.ts', 'web/shared/i18n.ts', 'server/core/lib/i18n.js', 'server/core/iconRules.js', 'scripts/demo.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /—/, `em dash in ${f}`);
    // the Spanish keys are the existing source strings; only the Dutch, Danish and Polish values are checked
    const values = /i18n-dict-(nl|da|pl|family)\.ts$/.test(f) ? [...s.matchAll(/^ {2}'(?:[^'\\]|\\.)*': ('(?:[^'\\]|\\.)*'),$/gm)].map((m) => m[1]).join('\n') : s;
    assert.doesNotMatch(values, /dakboard/i, f);
  }
});

test('Polish: three count forms in the admin and the family tables, every "few" form a real count key', ts, async () => {
  globalThis.document ??= { documentElement: {} };
  const i18n = await import('../../web/admin/i18n.ts');
  try {
    i18n.setLang('pl');
    assert.equal(i18n.t('{n} pantallas', { n: 1 }), '1 ekran');
    assert.equal(i18n.t('{n} pantallas', { n: 2 }), '2 ekrany');
    assert.equal(i18n.t('{n} pantallas', { n: 5 }), '5 ekranów');
    assert.equal(i18n.t('{n} pantallas', { n: 12 }), '12 ekranów');
    assert.equal(i18n.t('{n} pantallas', { n: 22 }), '22 ekrany');
    assert.equal(i18n.t('{n} minutos', { n: 1 }), '1 minuta');
    assert.equal(i18n.t('{n} minutos', { n: 3 }), '3 minuty');
    assert.equal(i18n.t('{n} minutos', { n: 5 }), '5 minut');
    assert.equal(i18n.t('{n} días', { n: 1 }), '1 dzień');
    assert.equal(i18n.t('{n} días', { n: 2 }), '2 dni');
    assert.equal(i18n.t('{n} días', { n: 5 }), '5 dni');
    assert.equal(i18n.t('{n} estrellas', { n: 3 }), '3 gwiazdki');
    assert.equal(i18n.t('Guardar'), 'Zapisz');
    assert.equal(i18n.pluralForm(4), 'few');
    assert.equal(i18n.pluralForm(14), 'other');
    assert.equal(i18n.locale(), 'pl-PL');
    assert.equal(i18n.browserLang(['pl-PL']), 'pl');
    assert.equal(i18n.formatDuration(3 * 3600 + 5 * 60), '3 h 5 min');
    // a key with no Polish value yet: the English one
    const saved = plMod.PL.Cerrar;
    delete plMod.PL.Cerrar;
    try {
      assert.equal(i18n.t('Cerrar'), dict.EN.Cerrar);
    } finally {
      plMod.PL.Cerrar = saved;
    }
    i18n.setLang('es');
    assert.equal(i18n.pluralForm(3), 'other');
  } finally {
    i18n.setLang('es');
  }
  // ages: "kończy 1 rok", "kończy 3 lata", "kończy 5 lat"
  i18n.setLang('pl');
  try {
    assert.equal(i18n.t('cumple {n}', { n: 1 }), 'kończy 1 rok');
    assert.equal(i18n.t('cumple {n}', { n: 23 }), 'kończy 23 lata');
    assert.equal(i18n.t('cumple {n}', { n: 12 }), 'kończy 12 lat');
  } finally {
    i18n.setLang('es');
  }
  const counts = new Set(Object.keys(dict.EN).filter((k) => /\{n\}/.test(k)));
  // A Polish count row with a noun after {n} needs a "few" twin, unless that word reads the same for 2-4 and 5+
  // (genitive after a preposition, "dni", units, a label-first form).
  const fewKeys = new Set([...Object.keys(plMod.PL_FEW), ...Object.keys(family.PL_FEW_FAMILY)]);
  const invariant = new Set(['dni', 'wiadomości', 'z', 'znaków', 'zdjęć', 'ekranów', 'miejsc', 'więcej', 's', 'h', 'min', '%', '⭐']);
  for (const [k, v] of Object.entries({ ...plMod.PL, ...family.PL_FAMILY })) {
    if (!counts.has(k) || fewKeys.has(k)) continue;
    const word = v.match(/\{n\}\s*([^\s{}.,:;()·]+)/)?.[1];
    if (word) assert.ok(invariant.has(word), `PL_FEW needs a "few" form for: ${k} (${v})`);
  }
  for (const [name, few] of [['PL_FEW', plMod.PL_FEW], ['PL_FEW_FAMILY', family.PL_FEW_FAMILY]]) {
    for (const [k, v] of Object.entries(few)) {
      assert.ok(counts.has(k), `${name}: ${k} is not a count key`);
      assert.equal(holes(v), holes(k), `${name} placeholders: ${k}`);
    }
  }
});

test('Polish: dates with the month in the genitive, Monday first, "Ndz" for Sunday, decimal comma', ts, () => {
  assert.equal(shared.formatDateLine('pl', '2026-10-12', 'weekday_d_month'), 'Poniedziałek, 12 października');
  assert.equal(shared.formatDateLine('pl', '2026-10-12', 'weekday_month_d'), 'Poniedziałek, październik 12');
  assert.equal(shared.formatDatePattern('pl', '2026-10-12', '{dddd} {d} {mmmm}'), 'Poniedziałek 12 października');
  assert.equal(shared.formatDatePattern('pl', '2026-10-12', '{mmmm} {yyyy}'), 'październik 2026');
  assert.equal(shared.formatDatePattern('pl', '2026-10-11', '{ddd} {d}'), 'Ndz 11');
  assert.equal(shared.monthName('pl', 10), 'Październik');
  assert.deepEqual(shared.weekdayNames('pl', 1), ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz']);
  assert.equal(shared.formatDateLine('es', '2026-10-12', 'weekday_d_month'), 'Lunes, 12 de octubre');
  assert.equal((1234.5).toLocaleString(shared.LOCALES.pl), '1234,5');
  // the display's count keys: "few" twins for 2-4, 22-24…
  assert.equal(shared.t('pl', 'kidsEventsLeft', { n: 3 }), 'Jeszcze 3 wydarzenia dziś');
  assert.equal(shared.t('pl', 'kidsEventsLeft', { n: 5 }), 'Jeszcze 5 wydarzeń dziś');
  assert.equal(shared.t('pl', 'kidsEventsLeft', { n: 13 }), 'Jeszcze 13 wydarzeń dziś');
  assert.equal(shared.t('pl', 'kidsEventsLeft', { n: 23 }), 'Jeszcze 23 wydarzenia dziś');
  assert.equal(shared.t('pl', 'inDays', { n: 3 }), 'Za 3 dni');
  assert.equal(shared.formatCountdown('pl', 25 * 60000), 'Za 25 min');
});

test('Polish: weather, wind, private mode titles and backup summaries on the server', () => {
  assert.equal(wmoDescription(0, 'pl'), 'Bezchmurnie');
  assert.equal(wmoDescription(95, 'pl'), 'Burza');
  for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 68, 69, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) {
    assert.ok(wmoDescription(code, 'pl'), `pl ${code}`);
  }
  assert.equal(windDirLabel(225, 'pl'), 'SW');
  assert.equal(serverT('busy', 'pl'), 'Zajęte');
  assert.equal(serverT('blocked', 'pl'), 'Niedostępne');
  assert.equal(countNoun(1, 'screen', 'pl'), '1 ekran');
  assert.equal(countNoun(3, 'screen', 'pl'), '3 ekrany');
  assert.equal(countNoun(5, 'screen', 'pl'), '5 ekranów');
  assert.equal(countNoun(12, 'source', 'pl'), '12 źródeł');
  assert.equal(countNoun(24, 'iconRule', 'pl'), '24 reguły ikon');
  assert.equal(countChanged(2, 'screen', 'pl'), 'zmienione: 2');
  assert.equal(summaryWord('unchanged', 'pl'), 'bez zmian');
});

test('Polish: rental and birthday titles, quick-add holidays for Poland', async () => {
  const rules = await import('../rules.js');
  assert.deepEqual(rules.normalizeAirbnbTitle('Niedostępne', '', 'pl'), { title: 'Niedostępne', blocked: true, emoji: '' });
  assert.equal(rules.normalizeAirbnbTitle('Rezerwacja', 'Gość: Jan Kowalski', 'pl').title, 'Rezerwacja · Jan Kowalski');
  assert.deepEqual(rules.guestBreakdown('Dorośli: 2\nDzieci: 1\nNiemowlęta: 0\nZwierzęta: 1'), { adults: 2, children: 1, infants: 0, pets: 1 });
  assert.equal(rules.tidyTitle('Urodziny: Ania', { emoji: '🎂' }), 'Ania');
  // the name after "Urodziny" is in the genitive ("Urodziny Ani"), so that title stays whole
  assert.equal(rules.tidyTitle('Urodziny Ani', { emoji: '🎂' }), 'Urodziny Ani');
  assert.match(read('web/admin/util.ts'), /cc: 'PL', flag: '🇵🇱', name: 'Festivos de Polonia', url: 'https:\/\/calendar\.google\.com\/calendar\/ical\/en\.polish%23holiday/);
});

test('Polish: ł folds to l, so "pilka" finds "piłka" and slugs keep the letter', async () => {
  const { fold } = await import('../core/lib/text.js');
  const { slugify } = await import('../core/validate.js');
  assert.equal(fold('Łódź'), 'lodz');
  assert.equal(slugify('Łazienka'), 'lazienka');
  assert.equal(findKeyword(DEFAULT_ICON_RULES, 'Mecz piłki nożnej')?.rule.emoji, findKeyword(DEFAULT_ICON_RULES, 'Mecz pilki noznej')?.rule.emoji);
});
