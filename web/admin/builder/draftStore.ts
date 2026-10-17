// Draft recovery of the builder: while the editor has unsaved changes, the canvas is kept in this browser
// (localStorage['marco.canvasDraft.<tenant>.<screenId>']) so a closed tab or a crash does not lose the work. <tenant>
// is the Marco Cloud household, or 'local' on a self-hosted server, so two households in one browser never see each
// other's drafts. Drafts older than 7 days are dropped, and every draft goes on sign-out. Storage may be missing or
// full (private windows): every access is wrapped and the editor works without it.
import type { CanvasConfig } from '../../shared/types';
import { upgradeCanvasGrid } from '../../../server/core/canvasCore.js';

/** A screen's orientation setting (screen.orientation). */
export type ScreenOrientation = 'auto' | 'landscape' | 'portrait';

const PREFIX = 'marco.canvasDraft.';
export const DRAFT_TTL_MS = 7 * 24 * 3600_000;

export interface CanvasDraft {
  at: number;
  canvas: CanvasConfig;
  /** the screen theme a template asked for (null: unchanged) */
  theme?: 'light' | 'dark' | null;
  /** the screen's orientation chosen in the editor (screen.orientation) */
  orientation?: ScreenOrientation;
}

const safeTenant = (t: string | null | undefined) => (t && /^[A-Za-z0-9_-]{1,80}$/.test(t) ? t : 'local');
export const draftKey = (tenant: string | null | undefined, screenId: string) => `${PREFIX}${safeTenant(tenant)}.${screenId}`;

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveDraft(tenant: string | null | undefined, screenId: string, d: CanvasDraft): void {
  try {
    store()?.setItem(draftKey(tenant, screenId), JSON.stringify(d));
  } catch {
    /* full or blocked: the editor keeps working */
  }
}

/** The draft of a screen, if there is a recent one. */
export function loadDraft(tenant: string | null | undefined, screenId: string, now = Date.now()): CanvasDraft | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(draftKey(tenant, screenId));
    if (!raw) return null;
    const d = JSON.parse(raw) as CanvasDraft;
    if (!d || typeof d.at !== 'number' || !d.canvas || !Array.isArray(d.canvas.items) || now - d.at > DRAFT_TTL_MS) {
      s.removeItem(draftKey(tenant, screenId));
      return null;
    }
    // a draft kept by an editor before 0.17, on the old 12×8 grid: on the grid of today, the same look
    return { ...d, canvas: upgradeCanvasGrid(d.canvas) };
  } catch {
    return null;
  }
}

export function clearDraft(tenant: string | null | undefined, screenId: string): void {
  try {
    store()?.removeItem(draftKey(tenant, screenId));
  } catch {
    /* ignore */
  }
}

/** Drop old drafts (every tenant), or all of them (`all`: on sign-out). */
export function pruneDrafts(all = false, now = Date.now()): void {
  const s = store();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      if (all) {
        s.removeItem(k);
        continue;
      }
      try {
        const d = JSON.parse(s.getItem(k) || 'null') as CanvasDraft | null;
        if (!d || typeof d.at !== 'number' || now - d.at > DRAFT_TTL_MS) s.removeItem(k);
      } catch {
        s.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}
