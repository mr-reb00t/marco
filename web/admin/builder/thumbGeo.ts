// The boxes of a canvas's items scaled to a small drawing (thumb.tsx).
import type { CanvasConfig, CanvasKind } from '../../shared/types';
import { computeGeometry, mainBox, sideBox, sideTracks, type Box } from './geometry';
import { placements, sideBackdrop, sideStack, type Orient } from './model';

export function geometryBoxes(cv: CanvasConfig, o: Orient, W: number, H: number) {
  const g = computeGeometry(cv, o);
  const kx = W / g.W;
  const ky = H / g.H;
  const s = (b: Box): Box => ({ x: b.x * kx, y: b.y * ky, w: b.w * kx, h: b.h * ky });
  const pl = placements(cv, o);
  const tracks = sideTracks(sideStack(cv, o));
  // a photo card that fills the sidebar (#41): the bar is the photo, and its cards keep their own surface
  const backdrop = sideBackdrop(cv, o);
  const items: (Box & { kind: CanvasKind; surface: string; hidden: boolean })[] = [];
  for (const it of cv.items) {
    const p = pl.get(it.id);
    if (!p || it.id === backdrop) continue;
    let b: Box | null = null;
    if (p.zone === 'main') b = mainBox(g, o, p);
    else {
      const t = tracks.get(it.id);
      b = t ? sideBox(g, t.start, t.span) : null;
    }
    if (!b) continue;
    const surface = it.style.surface !== 'inherit' ? it.style.surface : p.zone === 'side' && cv.sidebar.fill !== 'photo' && !backdrop ? 'none' : cv.defaults.surface;
    items.push({ ...s(b), kind: it.kind, surface, hidden: !!it.hidden });
  }
  // photos under the other cards (they are always behind them)
  items.sort((a, b) => Number(b.kind === 'photo') - Number(a.kind === 'photo'));
  return { side: g.strip ? s(g.strip) : null, sidePhoto: !!backdrop, items };
}
