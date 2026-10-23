// A group of a Rotativa left with only its small Rotativa (#19): it stays a group, so the small Rotativa keeps all of
// its cards and each card its own condition under the group's (no silent loss when a sibling card goes away).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCanvas } from '../core/canvasCore.js';

const clean = () => {
  const errors = [];
  return { errors, err: (p, m) => errors.push(`${p}: ${m}`), warn: () => {} };
};

test('a group left with its small Rotativa keeps it whole, with the conditions of its cards', () => {
  const cv = {
    items: [{
      id: 'cv_rot00001', kind: 'rotator', pos: { landscape: { x: 0, y: 0, w: 6, h: 6 } },
      props: {
        everySec: 10, dots: true,
        cards: [
          { id: 'cv_card0001', kind: 'weather.forecast', props: {} },
          {
            id: 'cv_group001', kind: 'group', when: { src: 'ha', entity: 'binary_sensor.g', op: 'eq', value: 'on' },
            props: {
              dir: 'rows',
              cards: [
                { id: 'cv_nest0001', kind: 'rotator', props: { everySec: 10, dots: true, cards: [
                  { id: 'cv_cam00001', kind: 'ha.camera', props: { entity: 'camera.door' }, when: { src: 'ha', entity: 'binary_sensor.motion', op: 'eq', value: 'on' } },
                  { id: 'cv_hour0001', kind: 'weather.hourly', props: {} },
                ] } },
              ],
            },
          },
        ],
      },
    }],
  };
  const c = clean();
  const out = sanitizeCanvas(c, 'canvas', structuredClone(cv), {}, { ha: true });
  assert.deepEqual(c.errors, []);
  const g = out.items[0]?.props.cards[1];
  assert.ok(g, JSON.stringify(c.errors));
  assert.equal(g.kind, 'group');
  assert.equal(g.when?.entity, 'binary_sensor.g');
  const nest = g.props.cards[0];
  assert.equal(nest.kind, 'rotator');
  assert.deepEqual(nest.props.cards.map((x) => x.kind), ['ha.camera', 'weather.hourly']);
  assert.equal(nest.props.cards[0].when?.entity, 'binary_sensor.motion');
});
