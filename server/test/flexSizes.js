// The boxes of their own the browser tests draw every kind at (flexible sizes, canvasCore cellRange): its smallest,
// its largest, tall and narrow, wide and short, one in the middle and one a cell wider than the smallest, as "WxH" in
// cells of the 24×16 grid. `set` 'legacy' (the default): the boxes a screen of the old 12×8 grid had, doubled (what a
// converted screen draws); 'fine': the kind's whole range, the compact look's small boxes included.
import { canvasDefaults, cellRange, kindFor } from '../core/canvasCore.js';

export function flexSamples(kind, orientation = 'landscape', set = 'legacy') {
  // a Rotativa: the range its default cards leave it (kindFor)
  const k = kind === 'rotator' ? kindFor({ kind, props: canvasDefaults(kind) }) : kind;
  const f = set === 'fine' ? 1 : 2;
  const r = cellRange(k, orientation, set === 'fine' ? 'fine' : 'normal');
  const mid = (a, b) => Math.round((a + b) / 2);
  const list = [[r.minW, r.minH], [r.maxW, r.maxH], [r.minW, r.maxH], [r.maxW, r.minH], [mid(r.minW, r.maxW), mid(r.minH, r.maxH)], [Math.min(r.maxW, r.minW + 1), r.minH]];
  return [...new Set(list.map(([w, h]) => `${w * f}x${h * f}`))];
}
