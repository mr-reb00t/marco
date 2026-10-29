// "Color de la hora" and "Color de la fecha" of the clocks and the date card (canvasCore INK_PROPS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INK_PROPS, canvasDefaults, defaultCanvas, defaultItemStyle, newCanvasId, sanitizeCanvas } from '../core/canvasCore.js';

const collector = () => {
  const c = { errors: [], warnings: [] };
  c.err = (path, message) => c.errors.push({ path, message });
  c.warn = (path, message) => c.warnings.push({ path, message });
  return c;
};
const run = (kind, props) => {
  const c = collector();
  const it = { id: newCanvasId(), kind, pos: { zone: 'main', x: 0, y: 0, size: 's' }, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props } };
  const out = sanitizeCanvas(c, 'canvas', { ...defaultCanvas(), items: [it] }, {}, {});
  return { c, props: out.items[0].props };
};

test('ink: the clocks take a time and a date colour, the world clock a time colour, the date card a date colour', () => {
  assert.deepEqual(INK_PROPS, {
    'calendar.month': ['gridColor'],
    'calendar.week': ['gridColor'],
    'clock.digital': ['timeColor', 'dateColor'],
    'clock.analog': ['timeColor', 'dateColor'],
    'clock.flip': ['timeColor', 'dateColor'],
    'clock.world': ['timeColor'],
    date: ['dateColor'],
  });
  for (const [kind, keys] of Object.entries(INK_PROPS)) {
    const { c, props } = run(kind, Object.fromEntries(keys.map((k) => [k, ' #FFAA00 '])));
    assert.deepEqual(c.errors, [], kind);
    for (const k of keys) assert.equal(props[k], '#ffaa00', `${kind}.${k}`);
  }
});

test('ink: Automático (none) saves as before, a bad colour is refused, other kinds ignore them', () => {
  for (const kind of Object.keys(INK_PROPS)) {
    const { c, props } = run(kind, {});
    assert.deepEqual(c.errors, []);
    assert.ok(!('timeColor' in props) && !('dateColor' in props), kind);
    assert.deepEqual(props, run(kind, { timeColor: null, dateColor: '' }).props);
  }
  for (const bad of ['red', '#fff', 'url(x)', 12, '#12345g']) {
    const { c, props } = run('clock.digital', { timeColor: bad });
    assert.ok(c.errors.some((e) => e.path.endsWith('.timeColor')), String(bad));
    assert.ok(!('timeColor' in props));
  }
  // the date card has no time colour, the world clock no date colour
  assert.ok(!('timeColor' in run('date', { timeColor: '#ffaa00' }).props));
  assert.ok(!('dateColor' in run('clock.world', { dateColor: '#ffaa00' }).props));
  assert.ok(!('timeColor' in run('weather.now', { timeColor: '#ffaa00' }).props));
});
