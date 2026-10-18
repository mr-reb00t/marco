// The widget preview on the Widgets page (under the screen preview): the widget being edited, alone, as the TV draws
// it at the chosen place. The admin builds the screen's config with only this widget there (a copy of the draft, never
// saved) and a second preview frame (?widgetOnly=1) draws it on a plain backdrop of the screen's style and theme
// (livePreview.ts, Preview.tsx). The display reports the widget's box and the frame shows just that box
// (web/display/main.ts, 'marco:preview-focus').
import { useEffect, useState } from 'preact/hooks';
import type { FrameCorner, StoredConfig, WidgetDef, WidgetSize } from '../shared/types';
import { clone } from './util';

export type WidgetPreviewPlace = 'corner' | 'side' | 'full';
export interface WidgetPreviewSpot {
  place: WidgetPreviewPlace;
  size: WidgetSize;
  corner: FrameCorner;
}

interface PickState {
  /** the widget the owner is editing (null = the first one) */
  id: string | null;
  /** chosen in the preview bar; null = where the screen has it (widgetPreviewSpot) */
  spot: WidgetPreviewSpot | null;
  /** bumped by a "Probar": the preview loads the widget again */
  tested: number;
}

let pick: PickState = { id: null, spot: null, tested: 0 };
const subs = new Set<(p: PickState) => void>();
const emit = (next: PickState) => {
  pick = next;
  for (const fn of subs) fn(pick);
};

/** The owner works on widget `id`: the preview shows it where the screen has it (until another place is chosen). */
export const setPreviewWidget = (id: string) => void (pick.id !== id && emit({ ...pick, id, spot: null }));
export const setPreviewSpot = (spot: WidgetPreviewSpot | null) => emit({ ...pick, spot });
/** A test of widget `id` went through: the preview shows it (and loads it again). */
export const previewTested = (id: string) => emit({ ...pick, id, spot: pick.id === id ? pick.spot : null, tested: pick.tested + 1 });

export function useWidgetPreview(): PickState {
  const [p, setP] = useState(pick);
  useEffect(() => {
    subs.add(setP);
    setP(pick);
    return () => void subs.delete(setP);
  }, []);
  return p;
}

/**
 * Where `w` is shown first: as placed on screen `screenId`, else a medium corner. A price widget not placed there goes
 * in the side column, where every view has room (Next 24 h and the Vertical shape in a large one).
 */
export function widgetPreviewSpot(cfg: StoredConfig, screenId: string, w: WidgetDef): WidgetPreviewSpot {
  const screen = cfg.screens.find((s) => s.id === screenId);
  if (screen?.layout.preset === 'widget' && screen.layout.widgetId === w.id) return { place: 'full', size: 'l', corner: 'br' };
  const p = (screen?.widgets ?? []).find((x) => x.widgetId === w.id);
  if (p) return { place: p.place, size: p.size, corner: p.corner };
  // the Vertical shape is a tall card: the large size, where it has the height
  // the exchange rates: a list in the side column, the big card in a large corner
  if (w.type === 'currency') return w.options.currency?.layout === 'big' ? { place: 'corner', size: 'l', corner: 'br' } : { place: 'side', size: 'm', corner: 'br' };
  if (w.type === 'prices') return { place: 'side', size: w.options.prices?.view === 'next' || w.options.prices?.chartShape === 'rows' ? 'l' : 'm', corner: 'br' };
  return { place: 'corner', size: 'm', corner: 'br' };
}

/**
 * A copy of `cfg` where screen `screenId` shows only widget `widgetId` at `spot`: in a corner or the side column of
 * the Calendario grande layout (a side column on every screen; the widget-only preview hides the rest), or full
 * screen with the Widget layout. Null when the screen or the widget is missing.
 */
export function widgetPreviewDraft(cfg: StoredConfig, screenId: string, widgetId: string, spot: WidgetPreviewSpot): StoredConfig | null {
  if (!cfg.screens.some((s) => s.id === screenId) || !(cfg.widgets ?? []).some((w) => w.id === widgetId)) return null;
  const d = clone(cfg);
  const s = d.screens.find((x) => x.id === screenId)!;
  if (spot.place === 'full') {
    s.layout.preset = 'widget';
    s.layout.widgetId = widgetId;
    s.widgets = [];
    return d;
  }
  s.layout.preset = 'bigCalendar';
  s.widgets = [{ widgetId, place: spot.place, corner: spot.corner, size: spot.size }];
  return d;
}
