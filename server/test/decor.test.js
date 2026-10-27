// The HTML overlay (screen.overlay) and the seasonal decorations (screen.decoration) of a screen (#24): validation,
// defaults, the dates they show on, carousels, capabilities, and the frame document the display builds
// (web/display/widgets/decor.ts, loaded through Node's type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';
import { emptyCarouselScreen } from '../core/carousels.js';
import { FEATURE_KEYS } from '../capabilities.js';
import { decorationOn, inYearlyRange, OVERLAY_MAX, overlayShown, sanitizeDecoration, sanitizeOverlay, seasonOn, SEASONS } from '../core/decorCore.js';

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

test('new and old screens: no overlay and no decoration', () => {
  const fresh = validateConfig(defaultConfig());
  assert.equal(fresh.ok, true);
  assert.deepEqual(fresh.value.screens[0].screen.overlay, { html: '', when: { type: 'always' } });
  assert.deepEqual(fresh.value.screens[0].screen.decoration, { mode: 'none', snow: true });
  const c = defaultConfig();
  delete c.screens[0].screen.overlay;
  delete c.screens[0].screen.decoration;
  const old = validateConfig(c);
  assert.equal(old.ok, true, JSON.stringify(old.errors));
  assert.deepEqual(old.value.screens[0].screen.overlay, { html: '', when: { type: 'always' } });
  assert.equal(old.value.screens[0].screen.decoration.mode, 'none');
});

test('the overlay keeps the HTML as written and reaches the display', () => {
  const html = '<style>.b{position:fixed;top:0}</style><div class="b"><i class="bulb red"></i></div>';
  const r = withScreen({ overlay: { html, when: { type: 'range', from: '12-01', to: '01-06' } } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.screens[0].screen.overlay.html, html);
  assert.deepEqual(r.value.screens[0].screen.overlay.when, { type: 'range', from: '12-01', to: '01-06' });
  const d = displayConfig(r.value, r.value.screens[0]);
  assert.equal(d.screen.overlay.html, html);
});

test('the overlay is capped at 20000 characters', () => {
  assert.equal(OVERLAY_MAX, 20000);
  const ok = withScreen({ overlay: { html: 'a'.repeat(20000) } });
  assert.equal(ok.ok, true);
  const long = withScreen({ overlay: { html: 'a'.repeat(20001) } });
  assert.equal(long.ok, false);
  assert.ok(errPaths(long).includes('screens[0].screen.overlay.html'), JSON.stringify(long.errors));
  assert.equal(long.value.screens[0].screen.overlay.html.length, 20000);
  // control characters go, and a value that is not a string is refused
  assert.equal(sanitizeOverlay({ html: 'a\u0000b\u0007c' }).html, 'abc');
  const num = withScreen({ overlay: { html: 42 } });
  assert.equal(num.ok, false);
  assert.equal(num.value.screens[0].screen.overlay.html, '');
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
    const r = withScreen({ overlay: { html: 'x', when } });
    assert.equal(r.ok, false, JSON.stringify(when));
    assert.ok(errPaths(r).includes(`screens[0].screen.overlay.${path}`), JSON.stringify(r.errors));
  }
  const errs = [];
  assert.deepEqual(sanitizeOverlay({ html: 'x', when: { type: 'range', from: '02-29', to: '03-01', extra: 1 } }, (p) => errs.push(p)).when, { type: 'range', from: '02-29', to: '03-01' });
  assert.deepEqual(errs, []);
  assert.deepEqual(sanitizeOverlay({ html: 'x', when: { type: 'always', from: '01-01' } }).when, { type: 'always' });
  assert.deepEqual(sanitizeOverlay('nope', (p) => errs.push(p)), { html: '', when: { type: 'always' } });
  assert.deepEqual(errs, ['screen.overlay']);
});

test('the decoration: a known mode and a boolean snow, unknown values back to the defaults', () => {
  for (const mode of ['none', 'auto', 'christmas', 'halloween', 'newyear']) {
    const r = withScreen({ decoration: { mode, snow: false } });
    assert.equal(r.ok, true, mode);
    assert.deepEqual(r.value.screens[0].screen.decoration, { mode, snow: false });
  }
  const bad = withScreen({ decoration: { mode: 'easter', snow: 'yes' } });
  assert.equal(bad.ok, false);
  assert.ok(errPaths(bad).includes('screens[0].screen.decoration.mode'));
  assert.ok(errPaths(bad).includes('screens[0].screen.decoration.snow'));
  assert.deepEqual(bad.value.screens[0].screen.decoration, { mode: 'none', snow: true });
  assert.deepEqual(sanitizeDecoration([1]), { mode: 'none', snow: true });
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

test('a carousel with no screens borrows the look but never the overlay or the CSS', () => {
  const c = defaultConfig();
  c.screens[0].screen.customCss = 'a{}';
  c.screens[0].screen.overlay = { html: '<b>hi</b>', when: { type: 'always' } };
  c.screens[0].screen.decoration = { mode: 'christmas', snow: false };
  const p = emptyCarouselScreen(c, { id: 'v_x', slug: 'x', name: 'X' });
  assert.equal(p.screen.customCss, '');
  assert.deepEqual(p.screen.overlay, { html: '', when: { type: 'always' } });
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

test('an edition without the overlay refuses it, and its byte cap holds on the server', () => {
  const c = defaultConfig();
  c.screens[0].screen.overlay = { html: '<b>hi</b>', when: { type: 'always' } };
  const off = validateConfig(c, { htmlOverlay: false });
  assert.equal(off.ok, false);
  assert.ok(errPaths(off).includes('screens[0].screen.overlay.html'));
  // an empty one is fine there
  assert.equal(validateConfig(defaultConfig(), { htmlOverlay: false }).ok, true);
  c.screens[0].screen.overlay.html = 'é'.repeat(600); // 1200 bytes
  const capped = validateConfig(c, { htmlOverlayBytes: 1000 });
  assert.equal(capped.ok, false);
  assert.ok(errPaths(capped).includes('screens[0].screen.overlay.html'));
  assert.equal(validateConfig(c, { htmlOverlayBytes: 2000 }).ok, true);
});
