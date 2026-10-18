// The side preview shows unsaved settings: the screen's config as the server would send it once saved
// (server/core/screens.js, the same projection), posted to the preview iframe (web/display/main.ts listens).
// plain JS without a .d.ts on purpose: Marco Cloud typechecks server/core from its JS (a .d.ts would hide that)
// @ts-expect-error untyped module
import { displayConfig, widgetVersion } from '../../server/core/screens.js';
import type { DisplayConfig, StoredConfig, WidgetDef } from '../shared/types';
import { caps } from './caps';
import { widgetUrlProblem } from './util';

// Marco Cloud serves widget images from its own route, and only saved ones (an unsaved widget answers 409). The
// preview of an unsaved widget then shows the copy its last test made (Widgets "Probar"): Preview.tsx posts it to
// the frame as a Blob ({ type: 'marco:preview-widget', id, v, blob }; web/display/widgets/custom.ts).
const tested = new Map<string, string>();
/** A test of `url` succeeded and its optimized copy is at `previewUrl` (same origin, admin session). */
export const setWidgetPreview = (url: string, previewUrl: string) => void tested.set(url.trim(), previewUrl);
export interface WidgetPreview { id: string; v: string; url: string }
let previews: WidgetPreview[] = [];
/** Tested copies for the widgets of the last draft config (Marco Cloud only; [] elsewhere). */
export const draftWidgetPreviews = (): WidgetPreview[] => previews;

// The family page link (Familia › Acceso sets it once it knows it), so the QR of the kids layouts shows in the
// preview of unsaved settings too. The server adds it to the saved config by itself.
let familyQr: string | null = null;
export const setPreviewFamilyQr = (url: string | null) => void (familyQr = url);

/** Display config of `screenId` from the draft, or null when it cannot be built (the preview keeps the saved one). */
export function draftDisplayConfig(draft: StoredConfig, screenId: string): DisplayConfig | null {
  const screen = draft.screens.find((s) => s.id === screenId);
  if (!screen) return null;
  try {
    const cloud = caps().edition === 'cloud';
    // what the display loads: the address itself, or Marco Cloud's route (displayWidgets in server/core/screens.js)
    const widgetSrc = cloud ? (w: WidgetDef) => `/api/display/widget/${encodeURIComponent(w.id)}` : null;
    const cfg = displayConfig(draft, screen, { familyQr, widgetSrc }) as DisplayConfig;
    previews = cloud
      ? (draft.widgets ?? []).flatMap((w) => {
          const url = tested.get(w.options.url.trim());
          return url ? [{ id: w.id, v: widgetVersion(w) as string, url }] : [];
        })
      : [];
    // an unsaved widget address the server would refuse never reaches the preview (a javascript: one would run there)
    if (Array.isArray(cfg.widgets)) cfg.widgets = cfg.widgets.filter((w) => w.type === 'prices' || w.type === 'currency' || w.via !== 'direct' || !widgetUrlProblem(w.src));
    return cfg;
  } catch (e) {
    console.warn('[preview] draft config', e);
    return null;
  }
}
