// A Personalizado photo card's and the sidebar's own photo options (#41, core/photoSource.js): validation (screens
// saved before it stay exactly as they were, a block gets the Fondo's keys and checks), the display projection (no
// rules), and which settings a screen shows (photoTarget, screenPhotoBlocks), all pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle, projectCanvas, sanitizeCanvas } from '../core/canvasCore.js';
import { displayPhotoSource, photoSourceSig, sanitizePhotoSource } from '../core/photoSource.js';
import { allPhotoSources, isPhotoFor, photoTarget, screenPhotoBlocks, screenRuleAlbumIds, screenRuleGalleryFiles, screenShowsGallery } from '../core/screens.js';

const ALBUM = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const XMAS = { id: 'bg_xmas', when: { type: 'range', from: '12-01', to: '12-31' }, photos: { source: 'gallery', files: ['xmas.jpg'] } };
const OWN = { mode: 'own', source: 'gallery', stockTopic: 'sea', order: 'newest', immich: { albumIds: [], favoritesOnly: false }, rules: [XMAS], weatherFx: 'simple' };
const pos = (x) => ({ zone: 'main', x, y: 0, size: 'm', w: 8, h: 8 });

/** The Personalizado screen of fixtures/photo-source-old.json: two photo cards (one in a Rotativa) and a sidebar photo. */
function oldConfig() {
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  const s = defaultScreenProfile({ id: 's_custom', slug: 'custom', name: 'Custom' });
  s.layout.preset = 'canvas';
  Object.assign(s.background, { source: 'gallery', order: 'name', stockTopic: 'sea', weatherFx: 'rich', rules: [XMAS] });
  s.canvas = {
    ...defaultCanvas(), background: 'ambient', sidebar: { side: 'left', size: 'wide', fill: 'photo', intervalSec: 300, dim: 0.2 },
    items: [
      { id: 'cv_photo001', kind: 'photo', pos: pos(0), style: defaultItemStyle(), props: { ...canvasDefaults('photo'), intervalSec: 600, dim: 0.3, edge: true } },
      { id: 'cv_rot00001', kind: 'rotator', pos: pos(8), style: defaultItemStyle(), props: { everySec: 10, dots: true, cards: [{ id: 'cv_photo002', kind: 'photo', props: { ...canvasDefaults('photo') } }, { id: 'cv_clock001', kind: 'clock.digital', props: canvasDefaults('clock.digital') }] } },
    ],
  };
  c.screens.push(s);
  return c;
}
const collector = () => ({ errors: [], err(p, m) { this.errors.push([p, m]); }, warn() {} });

test('a screen saved before it validates to exactly what 0.36.0 stored (no block added, same key order)', () => {
  const want = JSON.parse(fs.readFileSync(new URL('./fixtures/photo-source-old.json', import.meta.url), 'utf8'));
  const r = validateConfig(oldConfig());
  assert.deepEqual(r.errors, []);
  assert.equal(JSON.stringify(r.value.screens[1]), JSON.stringify(want));
  assert.ok(!JSON.stringify(r.value).includes('photoSource'));
});

test('a block gets the Fondo keys with their defaults; mode screen keeps its settings', () => {
  const c = collector();
  assert.deepEqual(sanitizePhotoSource({ mode: 'own' }, { err: (p, m) => c.err(p, m) }), {
    mode: 'own', source: 'stock', stockTopic: 'nature', order: 'random', immich: { albumIds: [], favoritesOnly: false }, rules: [], weatherFx: 'off',
  });
  assert.deepEqual(c.errors, []);
  const kept = sanitizePhotoSource({ ...OWN, mode: 'screen', immich: { albumIds: [ALBUM.toUpperCase(), ALBUM], favoritesOnly: true } });
  assert.equal(kept.mode, 'screen');
  assert.equal(kept.source, 'gallery');
  assert.deepEqual(kept.immich, { albumIds: [ALBUM], favoritesOnly: true });
  assert.deepEqual(kept.rules, [XMAS]);
});

test('bad values: an error at their path and the default', () => {
  const cases = [
    [{ mode: 'x' }, 'p.mode', 'mode', 'screen'],
    [{ source: 'flickr' }, 'p.source', 'source', 'stock'],
    [{ order: 'z' }, 'p.order', 'order', 'random'],
    [{ weatherFx: 'max' }, 'p.weatherFx', 'weatherFx', 'off'],
    [{ stockTopic: 'x'.repeat(61) }, 'p.stockTopic', 'stockTopic', 'x'.repeat(60)],
  ];
  for (const [raw, path, k, v] of cases) {
    const c = collector();
    const out = sanitizePhotoSource(raw, { err: (p, m) => c.err(p, m), path: 'p' });
    assert.ok(c.errors.some(([p]) => p === path), `${path}: ${JSON.stringify(c.errors)}`);
    assert.equal(out[k], v, path);
  }
  let c = collector();
  assert.deepEqual(sanitizePhotoSource({ immich: { albumIds: ['nope', ALBUM] } }, { err: (p, m) => c.err(p, m), path: 'p' }).immich.albumIds, [ALBUM]);
  assert.deepEqual(c.errors, [['p.immich.albumIds', 'invalid album id']]);
  c = collector();
  assert.deepEqual(sanitizePhotoSource({ rules: 'xmas' }, { err: (p, m) => c.err(p, m), path: 'p' }).rules, []);
  assert.deepEqual(c.errors, [['p.rules', 'expected array']]);
  c = collector();
  const many = Array.from({ length: 31 }, (_, i) => ({ ...XMAS, id: `bg_${i}` }));
  assert.equal(sanitizePhotoSource({ rules: many }, { err: (p, m) => c.err(p, m), path: 'p' }).rules.length, 30);
  assert.ok(c.errors.some(([p, m]) => p === 'p.rules' && /max 30/.test(m)));
  c = collector();
  assert.equal(sanitizePhotoSource('own', { err: (p, m) => c.err(p, m), path: 'p' }), null);
  assert.deepEqual(c.errors, [['p', 'expected object']]);
});

test('canvas: a card and the sidebar keep a block only when set; a bad one is an error and is dropped', () => {
  const raw = { ...defaultCanvas(), background: 'ambient', sidebar: { side: 'left', size: 'wide', fill: 'photo', photoSource: OWN }, items: [
    { id: 'cv_a', kind: 'photo', pos: pos(0), style: defaultItemStyle(), props: { ...canvasDefaults('photo'), photoSource: OWN } },
    { id: 'cv_b', kind: 'photo', pos: pos(8), style: defaultItemStyle(), props: { ...canvasDefaults('photo'), photoSource: 7 } },
  ] };
  const c = collector();
  const cv = sanitizeCanvas(c, 'canvas', raw);
  assert.deepEqual(cv.items[0].props.photoSource, OWN);
  assert.ok(!('photoSource' in cv.items[1].props));
  assert.deepEqual(cv.sidebar.photoSource, OWN);
  assert.deepEqual(c.errors, [['canvas.items[1].props.photoSource', 'expected object']]);
  assert.ok(!('photoSource' in sanitizeCanvas(collector(), 'canvas', { ...raw, sidebar: { side: 'left', size: 'wide', fill: 'photo' } }).sidebar));
});

test('Marco Cloud (no Immich): an Immich block or rule on a card or the sidebar is refused at its path', () => {
  const c = oldConfig();
  const s = c.screens[1];
  s.canvas.items[0].props.photoSource = { ...OWN, source: 'immich', rules: [] };
  s.canvas.items[1].props.cards[0].props.photoSource = { ...OWN, rules: [{ id: 'bg_im', when: { type: 'birthday' }, photos: { source: 'immich', albumId: ALBUM } }] };
  s.canvas.sidebar.photoSource = { ...OWN, source: 'immich', rules: [] };
  const r = validateConfig(c, { immichAvailable: false });
  const paths = r.errors.map((e) => `${e.path}: ${e.message}`);
  assert.ok(paths.includes('screens[1].canvas.items[0].props.photoSource.source: Immich is not available'), paths.join('\n'));
  assert.ok(paths.includes('screens[1].canvas.items[1].props.cards[0].props.photoSource.rules[0].photos.source: Immich is not available'), paths.join('\n'));
  assert.ok(paths.includes('screens[1].canvas.sidebar.photoSource.source: Immich is not available'), paths.join('\n'));
  // the Fondo's own check kept its path and message
  c.screens[0].background.source = 'immich';
  assert.ok(validateConfig(c, { immichAvailable: false }).errors.some((e) => e.path === 'screens[0].background.source' && e.message === 'Immich is not available'));
  // self-hosted: all fine
  assert.deepEqual(validateConfig(oldConfig()).errors, []);
});

test('the display gets each block without its rules, only whether there are some and their signature', () => {
  const r = validateConfig(oldConfig());
  const s = r.value.screens[1];
  s.canvas.items[0].props.photoSource = OWN;
  s.canvas.items[1].props.cards[0].props.photoSource = { ...OWN, rules: [] };
  s.canvas.sidebar.photoSource = OWN;
  const cv = projectCanvas(s);
  const text = JSON.stringify(cv);
  assert.ok(!text.includes('xmas.jpg') && !text.includes('"rules"'), 'no rule reaches a display');
  const a = cv.items[0].props.photoSource;
  assert.equal(a.special, true);
  assert.match(a.rulesSig, /^[0-9a-f]{12}$/);
  assert.equal(a.source, 'gallery');
  assert.equal(a.weatherFx, 'simple');
  const inRot = cv.items[1].props.cards[0].props.photoSource;
  assert.deepEqual([inRot.special, inRot.rulesSig], [false, '']);
  assert.deepEqual(cv.sidebar.photoSource, displayPhotoSource(OWN));
  // the saved screen is left as it was
  assert.deepEqual(s.canvas.sidebar.photoSource.rules, [XMAS]);
});

test('photoTarget: a card (in a Rotativa too), the sidebar, the screen photos, or nothing', () => {
  const s = structuredClone(validateConfig(oldConfig()).value.screens[1]);
  // no own photos yet: every card and the sidebar get the screen's (its key, its rules)
  assert.deepEqual(photoTarget(s, 'cv_photo001'), { key: 's_custom', block: s.background, rules: s.background.rules });
  assert.equal(photoTarget(s, 'sidebar').key, 's_custom');
  s.canvas.items[0].props.photoSource = OWN;
  s.canvas.items[1].props.cards[0].props.photoSource = { ...OWN, mode: 'screen' };
  s.canvas.sidebar.photoSource = { ...OWN, source: 'stock' };
  const a = photoTarget(s, 'cv_photo001');
  assert.equal(a.key, `s_custom|own|${photoSourceSig(OWN)}`);
  assert.equal(a.block.source, 'gallery');
  assert.deepEqual(a.rules, [XMAS]);
  assert.equal(photoTarget(s, 'cv_photo002').key, 's_custom', "a card on 'screen' keeps the screen's photos");
  assert.equal(photoTarget(s, 'sidebar').block.source, 'stock');
  // two cards with the same settings share the key (and so the rotation memory)
  s.canvas.items[1].props.cards[0].props.photoSource = { ...OWN, weatherFx: 'off' };
  assert.equal(photoTarget(s, 'cv_photo002').key, a.key);
  // not a photo card, no such card, a hidden one, another layout: none
  assert.equal(photoTarget(s, 'cv_clock001'), null);
  assert.equal(photoTarget(s, 'cv_nope'), null);
  s.canvas.items[0].hidden = true;
  assert.equal(photoTarget(s, 'cv_photo001'), null);
  // the sidebar on glass: the screen's photos
  s.canvas.sidebar.fill = 'glass';
  assert.equal(photoTarget(s, 'sidebar').key, 's_custom');
  assert.equal(photoTarget({ ...s, layout: { ...s.layout, preset: 'bigCalendar' } }, 'cv_photo002'), null);
  assert.equal(isPhotoFor('sidebar'), true);
  assert.equal(isPhotoFor('cv_photo001'), true);
  for (const bad of ['../x', '', 'a/b', 'x'.repeat(65), ['a'], 5]) assert.equal(isPhotoFor(bad), false, String(bad));
});

test('what a screen shows: the gallery, rule files and Immich albums of its Fondo and of its own blocks', () => {
  const s = structuredClone(validateConfig(oldConfig()).value.screens[1]);
  s.background.source = 'stock';
  s.background.rules = [];
  assert.equal(screenShowsGallery(s), false);
  s.canvas.items[0].props.photoSource = { ...OWN, mode: 'screen' };
  assert.equal(screenShowsGallery(s), false, 'a block on the screen photos shows nothing of its own');
  assert.equal(allPhotoSources(s).length, 1, 'but it is still stored (imports, Marco Cloud)');
  s.canvas.items[0].props.photoSource = OWN;
  assert.equal(screenShowsGallery(s), true);
  assert.deepEqual([...screenRuleGalleryFiles(s)], ['xmas.jpg']);
  s.canvas.items[0].hidden = true;
  assert.equal(screenShowsGallery(s), false, 'a hidden card shows nothing');
  s.canvas.items[0].hidden = false;
  s.canvas.items[0].props.photoSource = { ...OWN, source: 'immich', immich: { albumIds: [ALBUM], favoritesOnly: false }, rules: [{ id: 'r', when: { type: 'birthday' }, photos: { source: 'immich', albumId: ALBUM.replace('6f', '7f') } }] };
  s.canvas.sidebar.photoSource = OWN;
  assert.deepEqual(screenPhotoBlocks(s).map((x) => x.key), ['', 'cv_photo001', 'sidebar']);
  assert.deepEqual(screenRuleAlbumIds(s), [ALBUM.replace('6f', '7f')]);
  assert.equal(screenShowsGallery(s), true, 'the sidebar shows the gallery');
  // the sidebar's block counts only while it shows a photo of its own
  s.canvas.background = 'photo';
  assert.deepEqual(screenPhotoBlocks(s).map((x) => x.key), ['', 'cv_photo001']);
  // another layout: only the Fondo
  assert.deepEqual(screenPhotoBlocks({ ...s, layout: { preset: 'bigCalendar' } }).map((x) => x.key), ['']);
});
