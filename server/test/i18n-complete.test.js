// Dutch (nl) and Danish (da): every text the admin, the family page, the display and the server can show has a value
// in both, with the same {placeholders} as the source, and a missing key falls back to English. The web modules load
// through Node's TypeScript type stripping (skipped before Node 22.18).
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
const shared = await load('../../web/shared/i18n.ts');
const access = await load('../../web/admin/i18n-dict-access.ts');
const ts = { skip: dict && plural && family && nlMod && daMod && shared && access ? false : 'TypeScript imports need Node >= 22.18' };

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
const MORE = () => ({
  nl: { rows: { ...nlMod.NL, ...family.NL_FAMILY }, one: { ...nlMod.NL_SINGULAR, ...family.NL_SINGULAR_FAMILY } },
  da: { rows: { ...daMod.DA, ...family.DA_FAMILY }, one: { ...daMod.DA_SINGULAR, ...family.DA_SINGULAR_FAMILY } },
});

test('languages: es, en, pt, nl and da on the server and the screens', ts, () => {
  assert.deepEqual(LANGS, ['es', 'en', 'pt', 'nl', 'da']);
  assert.deepEqual(shared.LANGS, LANGS);
  assert.equal(shared.LOCALES.nl, 'nl-NL');
  assert.equal(shared.LOCALES.da, 'da-DK');
  assert.equal(shared.normLang('nl'), 'nl');
  assert.equal(shared.normLang('da'), 'da');
  assert.equal(shared.normLang('fr'), 'en');
  assert.equal(langFromHeader('nl-BE,nl;q=0.9'), 'nl');
  assert.equal(langFromHeader('da-DK,da;q=0.9,en;q=0.5'), 'da');
  for (const lang of ['nl', 'da']) {
    const c = defaultConfig();
    c.screens[0].screen.language = lang;
    const v = validateConfig(c);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(v.value.screens[0].screen.language, lang);
  }
});

test('admin: every Spanish key has a Dutch and a Danish value with the same placeholders, and nothing extra', ts, () => {
  const keys = Object.keys(dict.EN);
  for (const [lang, { rows }] of Object.entries(MORE())) {
    const missing = keys.filter((k) => typeof rows[k] !== 'string' || !rows[k].trim());
    assert.deepEqual(missing, [], `${lang} misses admin rows`);
    const extra = Object.keys(rows).filter((k) => !(k in dict.EN));
    assert.deepEqual(extra, [], `${lang} has rows no dictionary uses`);
    for (const k of keys) assert.equal(holes(rows[k]), holes(k), `${lang} placeholders: ${k}`);
  }
});

test('admin: every singular form has a Dutch and a Danish value', ts, () => {
  for (const [lang, { one }] of Object.entries(MORE())) {
    for (const [k, [es]] of Object.entries(plural.SINGULAR)) {
      assert.ok(one[k], `${lang} misses the singular of ${k}`);
      assert.equal(holes(one[k]), holes(es), `${lang} singular placeholders: ${k}`);
    }
    assert.deepEqual(Object.keys(one).filter((k) => !(k in plural.SINGULAR)), [], `${lang} has singular forms nobody uses`);
  }
});

test('family page: the family tables hold every Familia row, so the page needs nothing else', ts, () => {
  for (const [lang, mod] of [['nl', family.NL_FAMILY], ['da', family.DA_FAMILY]]) {
    const rows = family.ROWS_FAMILY.map((r) => r[0]).filter((k) => !(k in mod));
    assert.deepEqual(rows, [], `${lang} family rows`);
  }
  for (const [lang, mod] of [['nl', family.NL_SINGULAR_FAMILY], ['da', family.DA_SINGULAR_FAMILY]]) {
    assert.deepEqual(Object.keys(family.SINGULAR_FAMILY).filter((k) => !(k in mod)), [], `${lang} family singular forms`);
  }
  const src = read('web/family/i18n.ts');
  assert.doesNotMatch(src, /i18n-dict-(nl|da)/, 'the family page loads only the family tables');
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

test('display: every key in Dutch and Danish with the same placeholders; English for a missing one', ts, () => {
  const en = shared.DICTS.en;
  for (const lang of ['nl', 'da']) {
    const d = shared.DICTS[lang];
    assert.deepEqual(Object.keys(en).filter((k) => !d[k]), [], `${lang} display keys`);
    assert.deepEqual(Object.keys(d).filter((k) => !(k in en)), [], `${lang} extra display keys`);
    for (const k of Object.keys(en)) assert.equal(holes(d[k]), holes(en[k]), `${lang} placeholders: ${k}`);
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

test('display: pairing screen texts in Dutch and Danish', () => {
  const src = read('web/display/widgets/pairing.ts');
  const block = (l) => src.slice(src.indexOf(`\n  ${l}: {`), src.indexOf('\n  },', src.indexOf(`\n  ${l}: {`)));
  const keys = (l) => [...block(l).matchAll(/\n {4}(\w+): /g)].map((m) => m[1]);
  for (const l of ['nl', 'da']) assert.deepEqual(keys(l), keys('en'), l);
});

test('display: welcome screen texts in Dutch and Danish', () => {
  const src = read('web/display/widgets/welcome.ts');
  const block = (l) => src.slice(src.indexOf(`\n  ${l}: {`), src.indexOf('\n  },', src.indexOf(`\n  ${l}: {`)));
  const keys = (l) => [...block(l).matchAll(/\n {4}(\w+): /g)].map((m) => m[1]);
  for (const l of ['nl', 'da']) assert.deepEqual(keys(l), keys('en'), l);
});

test('demo seed (scripts/demo.js): every demo string has a Dutch and a Danish version', () => {
  const src = read('scripts/demo.js');
  const table = src.slice(src.indexOf('const NL_DA = {'), src.indexOf('\n};', src.indexOf('const NL_DA = {')));
  const lit = `('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`;
  const strings = new Set([...src.matchAll(new RegExp(`\\bL\\(\\s*${lit}`, 'g'))].map((m) => m[1].slice(1, -1)));
  assert.ok(strings.size > 40, `${strings.size} demo strings`);
  const missing = [...strings].filter((s) => !table.includes(`'${s}': [`) && !table.includes(`"${s}": [`));
  assert.deepEqual(missing, []);
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

test('holidays: the Dutch, Belgian and Danish Google feeds, curly apostrophes included', () => {
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
  // every row has a value for es, pt, nl and da
  const src = read('server/rules.js');
  const block = src.slice(src.indexOf('const HOLIDAYS = {'), src.indexOf('\n};', src.indexOf('const HOLIDAYS = {')));
  for (const line of block.split('\n').filter((l) => /^ {2}["']/.test(l))) {
    const cols = line.slice(line.indexOf('[') + 1, line.lastIndexOf(']')).match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g);
    assert.equal(cols.length, 4, line);
  }
});

test('icon rules: Dutch and Danish keywords, within the limits, for existing installs too (marker v3)', () => {
  const emoji = (title) => findKeyword(DEFAULT_ICON_RULES, title)?.rule.emoji ?? null;
  assert.equal(emoji('Verjaardag van Anna'), '🎂');
  assert.equal(emoji('Tandarts Lucía'), '🩺');
  assert.equal(emoji('Zwemles'), emoji('Swimming lesson'));
  assert.equal(emoji('Annas fødselsdag'), '🎂');
  assert.equal(emoji('Tandlæge'), '🩺');
  assert.equal(emoji('Fodboldtræning'), emoji('Football practice'));
  assert.equal(emoji('Morfar Luis'), null);
  for (const r of DEFAULT_ICON_RULES) assert.ok(r.match.length <= 100, `${r.id}: ${r.match.length} keywords`);
  assert.match(read('server/store.js'), /const ICON_RULES_MARKER = '.iconrules-v3';/);
});

test('demo data: every demo string of mock.ts has a Dutch and a Danish version', ts, async () => {
  const { DEMO_NL_DA, DEMO_NEWS } = await import('../../web/display/mock-text.ts');
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
  const missing = [...strings].filter((s) => !DEMO_NL_DA[s] || DEMO_NL_DA[s].some((v) => !v));
  assert.deepEqual(missing, []);
  assert.equal(DEMO_NEWS.nl.length, 6);
  assert.equal(DEMO_NEWS.da.length, 6);
});

test('Dutch and Danish files: no em dashes, no DAKboard', () => {
  for (const f of ['web/admin/i18n-dict-nl.ts', 'web/admin/i18n-dict-da.ts', 'web/admin/i18n-dict-family.ts', 'web/display/mock-text.ts', 'web/shared/i18n.ts', 'server/core/lib/i18n.js', 'server/core/iconRules.js', 'scripts/demo.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /—/, `em dash in ${f}`);
    // the Spanish keys are the existing source strings; only the Dutch and Danish values are checked
    const values = /i18n-dict-(nl|da|family)\.ts$/.test(f) ? [...s.matchAll(/^ {2}'(?:[^'\\]|\\.)*': ('(?:[^'\\]|\\.)*'),$/gm)].map((m) => m[1]).join('\n') : s;
    assert.doesNotMatch(values, /dakboard/i, f);
  }
});

test('family access (#16): every row has a value in every column, with the same {placeholders}, and no em dash', ts, () => {
  // [es, en, pt, nl, da, pl]: the phone page (web/member/i18n.ts) reads the column of each language
  assert.ok(access.ROWS_ACCESS_ALL.length > 100);
  const keys = new Set();
  for (const row of access.ROWS_ACCESS_ALL) {
    assert.equal(row.length, 6, row[0]);
    assert.ok(!keys.has(row[0]), `twice: ${row[0]}`);
    keys.add(row[0]);
    for (const v of row) {
      assert.ok(typeof v === 'string' && v.trim(), `empty value for ${row[0]}`);
      assert.equal(holes(v), holes(row[0]), `placeholders of ${row[0]}: ${v}`);
      assert.doesNotMatch(v, /—/, v);
    }
  }
  for (const l of shared.LANGS) if (l !== 'es') assert.ok(['en', 'pt', 'nl', 'da', 'pl'].includes(l), `no family access column for ${l}`);
  // the admin's own wording: "private mode", never "privacy mode"
  assert.ok(access.ROWS_ACCESS_ALL.every((r) => !/privacy mode/i.test(r[1])));
});
