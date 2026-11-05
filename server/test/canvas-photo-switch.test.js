// "Mostrar fotos de fondo" on a Personalizado screen: the screen shows the photo after its own Fondo in the editor
// (canvas.background, the sidebar's fill), so the Fondo section's switch follows that and sets it (setCanvasPhoto);
// and the editor's Fotos card, which cannot go over a photo background, is listed locked with what to change instead
// of missing from the search. The web modules load through Node's TypeScript type stripping (skipped before Node 22.18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { CANVAS_KINDS, defaultCanvas } from '../core/canvasCore.js';

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
const G = await load('../../web/shared/glass.ts');
const K = await load('../../web/admin/builder/kinds.ts');
const dict = await load('../../web/admin/i18n-dict-group.ts');
const ts = { skip: G && K && dict ? false : 'TypeScript imports need Node >= 22.18' };

const cv = (background, side = 'none', fill = 'glass') => ({ ...defaultCanvas(), background, sidebar: { side, size: 'normal', fill } });
const shows = (c) => G.effectiveBackground({ enabled: false, scope: 'side' }, c).enabled;

test('turned off, the photo leaves the whole screen and the sidebar; turned on, it goes behind the whole screen', ts, () => {
  const a = cv('photo');
  assert.equal(shows(a), true);
  G.setCanvasPhoto(a, false);
  assert.deepEqual([a.background, a.sidebar.fill, shows(a)], ['ambient', 'glass', false]);
  const b = cv('solid', 'left', 'photo');
  assert.equal(shows(b), true);
  G.setCanvasPhoto(b, false);
  assert.deepEqual([b.background, b.sidebar.fill, shows(b)], ['solid', 'glass', false]);
  G.setCanvasPhoto(b, true);
  assert.deepEqual([b.background, b.sidebar.fill, shows(b)], ['photo', 'glass', true]);
  // already showing it (in the sidebar): turning it on changes nothing
  const c = cv('ambient', 'right', 'photo');
  G.setCanvasPhoto(c, true);
  assert.deepEqual([c.background, c.sidebar.fill], ['ambient', 'photo']);
});

test('the Fotos card over a photo background: listed locked, with what to change', ts, () => {
  const env = { cloud: false, allowed: Object.keys(CANVAS_KINDS) };
  assert.equal(K.lockOf('photo', env), null);
  assert.equal(K.lockOf('photo', { ...env, photoBg: false }), null);
  const why = K.lockOf('photo', { ...env, photoBg: true });
  assert.match(why, /Animado o Color/);
  assert.equal(K.lockOf('clock.digital', { ...env, photoBg: true }), null);
  // its text and the Fondo switch's hint are translated
  const rows = dict.default ?? Object.values(dict).find(Array.isArray);
  const es = new Set(rows.map((r) => r[0]));
  assert.ok(es.has(why), 'lock text translated');
  assert.ok(es.has('En una pantalla Personalizado también se elige en el editor, en Fondo: Foto, Animado o Color.'));
});
