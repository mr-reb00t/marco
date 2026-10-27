// The HTML overlays (screen.overlays, screen.overlay until 0.21) and the seasonal decorations (screen.decoration) of a screen (#24): validation,
// defaults, the dates they show on, carousels, capabilities, and the frame document the display builds
// (web/display/widgets/decor.ts, loaded through Node's type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDefaults, validateConfig } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';
import { emptyCarouselScreen } from '../core/carousels.js';
import { FEATURE_KEYS } from '../capabilities.js';
import { decorationOn, inYearlyRange, migrateOverlay, OVERLAY_MAX, OVERLAYS_MAX, overlaysBytes, overlayShown, sanitizeDecoration, sanitizeOverlay, seasonOn, SEASONS } from '../core/decorCore.js';

let decor = null;
try {
  decor = await import('../../web/display/widgets/decor.ts');
} catch {
  decor = null;
}
const ts = { skip: decor ? false : 'TypeScript imports need Node >= 22.18' };

const withScreen = (patch) => {
  const c = defaultConfig();
  Object.assign(c.screens[0].screen, patch);
  return validateConfig(c);
};
const errPaths = (r) => r.errors.map((e) => e.path);

const DEF_DECOR = { mode: 'none', snow: true, seasons: { newyear: { from: '12-31', to: '01-01' }, christmas: { from: '12-01', to: '01-06' }, halloween: { from: '10-24', to: '10-31' } } };
const ov = (html, when = { type: 'always' }, name = '') => ({ name, html, when });

test('new and old screens: no overlays and no decoration', () => {
  const fresh = validateConfig(defaultConfig());
  assert.equal(fresh.ok, true);
  assert.deepEqual(fresh.value.screens[0].screen.overlays, []);
  assert.deepEqual(fresh.value.screens[0].screen.decoration, DEF_DECOR);
  assert.equal('overlay' in fresh.value.screens[0].screen, false);
  const c = defaultConfig();
  delete c.screens[0].screen.overlays;
  delete c.screens[0].screen.decoration;
  const old = validateConfig(c);
  assert.equal(old.ok, true, JSON.stringify(old.errors));
  assert.deepEqual(old.value.screens[0].screen.overlays, []);
  assert.deepEqual(old.value.screens[0].screen.decoration, DEF_DECOR);
});

test('the single overlay of 0.21 becomes the first of the list, on load and on save', () => {
  const html = '<div class="b"></div>';
  const legacy = { html, when: { type: 'range', from: '12-01', to: '01-06' } };
  const stored = defaultConfig();
  delete stored.screens[0].screen.overlays;
  stored.screens[0].screen.overlay = legacy;
  stored.screens[0].screen.decoration = { mode: 'auto', snow: false };
  const loaded = mergeDefaults(structuredClone(stored));
  assert.deepEqual(loaded.screens[0].screen.overlays, [ov(html, legacy.when)]);
  assert.equal('overlay' in loaded.screens[0].screen, false);
  assert.deepEqual(loaded.screens[0].screen.decoration.seasons, DEF_DECOR.seasons, 'the default days filled in');
  const saved = validateConfig(structuredClone(stored));
  assert.equal(saved.ok, true, JSON.stringify(saved.errors));
  assert.deepEqual(saved.value.screens[0].screen.overlays, [ov(html, legacy.when)]);
  assert.equal('overlay' in saved.value.screens[0].screen, false);
  // an empty one leaves an empty list, and a list already there wins
  assert.deepEqual(migrateOverlay({ html: ' ', when: { type: 'always' } }), []);
  const both = defaultConfig();
  both.screens[0].screen.overlay = legacy;
  both.screens[0].screen.overlays = [ov('<i>new</i>')];
  assert.deepEqual(validateConfig(both).value.screens[0].screen.overlays, [ov('<i>new</i>')]);
  assert.deepEqual(mergeDefaults(both).screens[0].screen.overlays, [ov('<i>new</i>')]);
});

test('the overlays keep the HTML as written, with a name, and reach the display', () => {
  const html = '<style>.b{position:fixed;top:0}</style><div class="b"><i class="bulb red"></i></div>';
  const r = withScreen({ overlays: [ov(html, { type: 'range', from: '12-01', to: '01-06' }, '  Luces de Navidad '), ov('<b>2</b>')] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const list = r.value.screens[0].screen.overlays;
  assert.equal(list.length, 2);
  assert.equal(list[0].html, html);
  assert.equal(list[0].name, 'Luces de Navidad');
  assert.deepEqual(list[0].when, { type: 'range', from: '12-01', to: '01-06' });
  const d = displayConfig(r.value, r.value.screens[0]);
  assert.equal(d.screen.overlays[0].html, html);
  assert.equal(d.screen.overlays[1].html, '<b>2</b>');
});

test('at most 4 overlays, a list and nothing else, names capped at 60', () => {
  assert.equal(OVERLAYS_MAX, 4);
  const four = withScreen({ overlays: [1, 2, 3, 4].map((n) => ov(`<b>${n}</b>`)) });
  assert.equal(four.ok, true);
  const five = withScreen({ overlays: [1, 2, 3, 4, 5].map((n) => ov(`<b>${n}</b>`)) });
  assert.equal(five.ok, false);
  assert.ok(errPaths(five).includes('screens[0].screen.overlays'));
  assert.equal(five.value.screens[0].screen.overlays.length, 4);
  const notList = withScreen({ overlays: { html: 'x' } });
  assert.equal(notList.ok, false);
  assert.deepEqual(notList.value.screens[0].screen.overlays, []);
  assert.equal(sanitizeOverlay({ name: 'a\u0000b'.repeat(40) }).name.length, 60);
  assert.equal(sanitizeOverlay({ name: 'a\u0007b' }).name, 'ab');
  const badName = withScreen({ overlays: [{ name: 5, html: 'x' }] });
  assert.ok(errPaths(badName).includes('screens[0].screen.overlays[0].name'));
});

test('each overlay is capped at 20000 characters', () => {
  assert.equal(OVERLAY_MAX, 20000);
  const ok = withScreen({ overlays: [ov('a'.repeat(20000))] });
  assert.equal(ok.ok, true);
  const long = withScreen({ overlays: [ov('x'), ov('a'.repeat(20001))] });
  assert.equal(long.ok, false);
  assert.ok(errPaths(long).includes('screens[0].screen.overlays[1].html'), JSON.stringify(long.errors));
  assert.equal(long.value.screens[0].screen.overlays[1].html.length, 20000);
  // control characters go, and a value that is not a string is refused
  assert.equal(sanitizeOverlay({ html: 'a\u0000b\u0007c' }).html, 'abc');
  const num = withScreen({ overlays: [{ html: 42 }] });
  assert.equal(num.ok, false);
  assert.equal(num.value.screens[0].screen.overlays[0].html, '');
});

test('the overlay schedule: always or a yearly range of real days, anything else refused', () => {
  for (const [when, path] of [
    [{ type: 'weekly' }, 'when'],
    ['always', 'when'],
    [{ type: 'range', from: '13-01', to: '01-06' }, 'when.from'],
    [{ type: 'range', from: '12-01', to: '02-30' }, 'when.to'],
    [{ type: 'range', from: '12-1', to: '01-06' }, 'when.from'],
    [{ type: 'range' }, 'when.from'],
  ]) {
    const r = withScreen({ overlays: [{ html: 'x', when }] });
    assert.equal(r.ok, false, JSON.stringify(when));
    assert.ok(errPaths(r).includes(`screens[0].screen.overlays[0].${path}`), JSON.stringify(r.errors));
  }
  const errs = [];
  assert.deepEqual(sanitizeOverlay({ html: 'x', when: { type: 'range', from: '02-29', to: '03-01', extra: 1 } }, (p) => errs.push(p)).when, { type: 'range', from: '02-29', to: '03-01' });
  assert.deepEqual(errs, []);
  assert.deepEqual(sanitizeOverlay({ html: 'x', when: { type: 'always', from: '01-01' } }).when, { type: 'always' });
  assert.deepEqual(sanitizeOverlay('nope', (p) => errs.push(p)), ov(''));
  assert.deepEqual(errs, ['screen.overlay']);
});

test('the decoration: a known mode, a boolean snow and real days per season, the rest back to the defaults', () => {
  for (const mode of ['none', 'auto', 'christmas', 'halloween', 'newyear']) {
    const r = withScreen({ decoration: { mode, snow: false } });
    assert.equal(r.ok, true, mode);
    assert.deepEqual(r.value.screens[0].screen.decoration, { ...DEF_DECOR, mode, snow: false });
  }
  const bad = withScreen({ decoration: { mode: 'easter', snow: 'yes' } });
  assert.equal(bad.ok, false);
  assert.ok(errPaths(bad).includes('screens[0].screen.decoration.mode'));
  assert.ok(errPaths(bad).includes('screens[0].screen.decoration.snow'));
  assert.deepEqual(bad.value.screens[0].screen.decoration, DEF_DECOR);
  assert.deepEqual(sanitizeDecoration([1]), DEF_DECOR);
  // the owner's days: all of December for Christmas, the others as they were
  const dec = withScreen({ decoration: { mode: 'auto', snow: true, seasons: { christmas: { from: '12-01', to: '12-31' } } } });
  assert.equal(dec.ok, true, JSON.stringify(dec.errors));
  assert.deepEqual(dec.value.screens[0].screen.decoration.seasons, { ...DEF_DECOR.seasons, christmas: { from: '12-01', to: '12-31' } });
  const wrong = withScreen({ decoration: { mode: 'auto', snow: true, seasons: { halloween: { from: '10-32', to: '10-31' }, newyear: 'x', easter: { from: '04-01', to: '04-02' } } } });
  assert.equal(wrong.ok, false);
  assert.ok(errPaths(wrong).includes('screens[0].screen.decoration.seasons.halloween.from'));
  assert.ok(errPaths(wrong).includes('screens[0].screen.decoration.seasons.newyear'));
  assert.deepEqual(wrong.value.screens[0].screen.decoration.seasons, DEF_DECOR.seasons, 'unknown seasons are dropped');
  assert.equal(withScreen({ decoration: { mode: 'auto', snow: true, seasons: [] } }).ok, false);
});

test('yearly ranges include both ends and may run over New Year', () => {
  assert.equal(inYearlyRange('2026-12-01', '12-01', '01-06'), true);
  assert.equal(inYearlyRange('2026-12-31', '12-01', '01-06'), true);
  assert.equal(inYearlyRange('2027-01-01', '12-01', '01-06'), true);
  assert.equal(inYearlyRange('2027-01-06', '12-01', '01-06'), true);
  assert.equal(inYearlyRange('2027-01-07', '12-01', '01-06'), false);
  assert.equal(inYearlyRange('2026-11-30', '12-01', '01-06'), false);
  assert.equal(inYearlyRange('2026-06-15', '06-01', '06-30'), true);
  assert.equal(inYearlyRange('2026-07-01', '06-01', '06-30'), false);
  assert.equal(inYearlyRange('2026-03-05', '03-05', '03-05'), true);
});

test('the overlay shows when it has HTML and its dates hold', () => {
  const xmas = { html: '<i></i>', when: { type: 'range', from: '12-01', to: '01-06' } };
  assert.equal(overlayShown(xmas, '2026-12-15'), true);
  assert.equal(overlayShown(xmas, '2027-01-03'), true);
  assert.equal(overlayShown(xmas, '2026-10-27'), false);
  assert.equal(overlayShown({ html: '<i></i>', when: { type: 'always' } }, '2026-10-27'), true);
  assert.equal(overlayShown({ html: '   ', when: { type: 'always' } }, '2026-10-27'), false);
  assert.equal(overlayShown(undefined, '2026-10-27'), false);
  assert.equal(overlayShown({ html: 'x', when: { type: 'range', from: 'bad', to: '01-01' } }, '2026-10-27'), false);
});

test('automatic decorations follow the dates, New Year wins over Christmas on its days', () => {
  assert.deepEqual(SEASONS.christmas, ['12-01', '01-06']);
  assert.equal(seasonOn('2026-11-30'), null);
  assert.equal(seasonOn('2026-12-01'), 'christmas');
  assert.equal(seasonOn('2026-12-30'), 'christmas');
  assert.equal(seasonOn('2026-12-31'), 'newyear');
  assert.equal(seasonOn('2027-01-01'), 'newyear');
  assert.equal(seasonOn('2027-01-02'), 'christmas');
  assert.equal(seasonOn('2027-01-06'), 'christmas');
  assert.equal(seasonOn('2027-01-07'), null);
  assert.equal(seasonOn('2026-10-23'), null);
  assert.equal(seasonOn('2026-10-24'), 'halloween');
  assert.equal(seasonOn('2026-10-31'), 'halloween');
  assert.equal(seasonOn('2026-11-01'), null);
  assert.equal(decorationOn({ mode: 'auto', snow: true }, '2026-10-27'), 'halloween');
  assert.equal(decorationOn({ mode: 'auto', snow: true }, '2026-05-01'), null);
  // a chosen one shows every day; none and unknown modes show nothing
  assert.equal(decorationOn({ mode: 'christmas', snow: true }, '2026-05-01'), 'christmas');
  assert.equal(decorationOn({ mode: 'none', snow: true }, '2026-12-24'), null);
  assert.equal(decorationOn({ mode: 'easter' }, '2026-12-24'), null);
  assert.equal(decorationOn(undefined, '2026-12-24'), null);
});

test("automatic decorations on the owner's days", () => {
  const seasons = { ...DEF_DECOR.seasons, christmas: { from: '12-01', to: '12-31' }, halloween: { from: '10-01', to: '11-02' } };
  const d = { mode: 'auto', snow: true, seasons };
  assert.equal(decorationOn(d, '2026-12-30'), 'christmas');
  assert.equal(decorationOn(d, '2026-12-31'), 'newyear', 'New Year still wins on its days');
  assert.equal(decorationOn(d, '2027-01-03'), null, 'no Christmas in January any more');
  assert.equal(decorationOn(d, '2026-10-05'), 'halloween');
  assert.equal(decorationOn(d, '2026-11-02'), 'halloween');
  // a season broken in the stored value keeps its usual days
  assert.equal(seasonOn('2027-01-03', { christmas: { from: 'x', to: '12-31' } }), 'christmas');
  // Christmas over Halloween when someone makes them meet
  assert.equal(seasonOn('2026-11-15', { christmas: { from: '11-01', to: '01-06' }, halloween: { from: '10-24', to: '11-20' } }), 'christmas');
});

test('a carousel with no screens borrows the look but never the overlay or the CSS', () => {
  const c = defaultConfig();
  c.screens[0].screen.customCss = 'a{}';
  c.screens[0].screen.overlays = [ov('<b>hi</b>'), ov('<b>2</b>')];
  c.screens[0].screen.decoration = { mode: 'christmas', snow: false };
  const p = emptyCarouselScreen(c, { id: 'v_x', slug: 'x', name: 'X' });
  assert.equal(p.screen.customCss, '');
  assert.deepEqual(p.screen.overlays, []);
  assert.equal('overlay' in p.screen, false);
  assert.deepEqual(p.screen.decoration, { mode: 'christmas', snow: false });
});

test('htmlOverlay is a capability an edition can turn off', () => {
  assert.ok(FEATURE_KEYS.includes('htmlOverlay'));
  assert.ok(FEATURE_KEYS.indexOf('htmlOverlay') === FEATURE_KEYS.indexOf('customCss') + 1);
});

test('the frame document: Marco base style and a CSP that blocks everything but inline styles and images', ts, () => {
  const html = '<style>.x{color:red}</style><div class="x">hi</div>';
  const doc = decor.overlayDocument(html, 'dark');
  assert.match(doc, /^<!doctype html>/);
  assert.match(doc, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:;/);
  assert.match(doc, /html,body\{margin:0;padding:0;background:transparent;width:100%;height:100%;overflow:hidden\}/);
  assert.match(doc, /:root\{color-scheme:dark\}/);
  assert.match(decor.overlayDocument(html, 'light'), /:root\{color-scheme:light\}/);
  // the base comes first so the owner's rules win; the HTML is in the body as written
  assert.ok(doc.indexOf('color-scheme') < doc.indexOf(html));
  assert.ok(doc.endsWith(`<body>${html}</body></html>`));
  assert.doesNotMatch(decor.OVERLAY_CSP, /script-src|unsafe-eval/);
});

test('an edition without the overlays refuses them, and its byte cap holds on the server for all of them together', () => {
  const c = defaultConfig();
  c.screens[0].screen.overlays = [ov('<b>hi</b>')];
  const off = validateConfig(c, { htmlOverlay: false });
  assert.equal(off.ok, false);
  assert.ok(errPaths(off).includes('screens[0].screen.overlays'));
  assert.deepEqual(off.value.screens[0].screen.overlays, []);
  // empty ones are fine there
  assert.equal(validateConfig(defaultConfig(), { htmlOverlay: false }).ok, true);
  c.screens[0].screen.overlays = [ov('')];
  assert.equal(validateConfig(c, { htmlOverlay: false }).ok, true);
  c.screens[0].screen.overlays = [ov('é'.repeat(300)), ov('é'.repeat(300))]; // 1200 bytes in all
  assert.equal(overlaysBytes(c.screens[0].screen.overlays), 1200);
  const capped = validateConfig(c, { htmlOverlayBytes: 1000 });
  assert.equal(capped.ok, false);
  assert.ok(errPaths(capped).includes('screens[0].screen.overlays'));
  assert.equal(validateConfig(c, { htmlOverlayBytes: 2000 }).ok, true);
});
