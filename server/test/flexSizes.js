// The boxes of their own the browser tests draw every kind at (flexible sizes, canvasCore cellRange): its smallest,
// its largest, tall and narrow, wide and short, one in the middle and one a cell wider than the smallest, as "WxH"
// (in cells of `grid`: 'fine' has twice as many each way).
import { canvasDefaults, cellRange, kindFor } from '../core/canvasCore.js';

export function flexSamples(kind, orientation = 'landscape', grid = 'normal') {
  // a Rotativa: the range its default cards leave it (kindFor)
  const r = cellRange(kind === 'rotator' ? kindFor({ kind, props: canvasDefaults(kind) }) : kind, orientation, grid);
  const mid = (a, b) => Math.round((a + b) / 2);
  const list = [[r.minW, r.minH], [r.maxW, r.maxH], [r.minW, r.maxH], [r.maxW, r.minH], [mid(r.minW, r.maxW), mid(r.minH, r.maxH)], [Math.min(r.maxW, r.minW + 1), r.minH]];
  return [...new Set(list.map(([w, h]) => `${w}x${h}`))];
}
