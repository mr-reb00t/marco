// calendar.weekdays (#39): which columns of a 7-day grid row are shown, and where a span lands on them.
// Pure (no DOM), so the tests load it directly.

/**
 * Day offsets 0..6 of a row starting on weekday `firstWd` (0 = Sunday) whose weekday is shown. Every row of a grid
 * starts on the same weekday, so this is worked out once per render. An empty list (never saved) shows every day.
 */
export function visibleCols(firstWd: number, weekdays: number[]): number[] {
  const shown = new Set(weekdays);
  const out: number[] = [];
  for (let d = 0; d < 7; d++) if (!shown.size || shown.has((firstWd + d) % 7)) out.push(d);
  return out;
}

/**
 * A span of row days [d0, d1] on the visible columns `cols`: the first and last column it touches, and whether a
 * hidden day was cut off at either end. null when it only covers hidden days (the event is not drawn in this row).
 */
export function clipSpan(d0: number, d1: number, cols: number[]): { c0: number; c1: number; clipL: boolean; clipR: boolean } | null {
  const c0 = cols.findIndex((d) => d >= d0);
  let c1 = -1;
  for (let i = cols.length - 1; i >= 0; i--) if (cols[i] <= d1) { c1 = i; break; }
  if (c0 < 0 || c1 < 0 || c0 > c1) return null;
  return { c0, c1, clipL: cols[c0] > d0, clipR: cols[c1] < d1 };
}
