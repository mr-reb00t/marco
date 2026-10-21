// The boxes of their own the browser tests draw every kind at (flexible sizes, canvasCore cellRange): its smallest,
// its largest, tall and narrow, wide and short, one in the middle and one a cell wider than the smallest, as "WxH" in
// cells of the 24×16 grid. `set` 'legacy' (the default): the boxes a screen of the old 12×8 grid had, doubled (what a
// converted screen draws); 'fine': the kind's whole range, the compact look's small boxes included (as boxOf
// takes them).
import { boxOf, canvasDefaults, cellRange, kindFor, posCells } from '../core/canvasCore.js';

/**
 * What a kind of the sweeps is sized as: a Rotativa by the range its cards leave it (kindFor), its default ones or
 * the ones named after it ("rotator,ha.tile,ha.camera", as mockCanvas.ts sizeFixture takes them).
 */
export function sizingKind(spec) {
  const [kind, ...inside] = spec.split(',');
  if (kind !== 'rotator') return kind;
  const props = inside.length ? { cards: inside.map((k) => ({ id: '', kind: k, props: canvasDefaults(k) })) } : canvasDefaults(kind);
  return kindFor({ kind, props });
}

export function flexSamples(kind, orientation = 'landscape', set = 'legacy') {
  const k = sizingKind(kind);
  const f = set === 'fine' ? 1 : 2;
  const r = cellRange(k, orientation, set === 'fine' ? 'fine' : 'normal');
  const mid = (a, b) => Math.round((a + b) / 2);
  const list = [[r.minW, r.minH], [r.maxW, r.maxH], [r.minW, r.maxH], [r.maxW, r.minH], [mid(r.minW, r.maxW), mid(r.minH, r.maxH)], [Math.min(r.maxW, r.minW + 1), r.minH]];
  // each as the box the kind takes there (a box below its smallest only around a named size: the scenes' 4×1 is 6×1)
  const grid = set === 'fine' ? 'fine' : 'normal';
  return [...new Set(list.map(([w, h]) => posCells(boxOf(k, w, h, orientation, grid), orientation, grid)).map(([w, h]) => `${w * f}x${h * f}`))];
}
