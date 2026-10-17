// The weather of places a draft shows but the server does not know yet (#11): a screen's place or a weather card's
// place not saved yet. The admin asks POST /api/admin/weather/preview (the server's own cache, so the preview costs the
// weather source no more than a screen) and posts the answer to the preview frame ('marco:preview-weather',
// web/display/weatherPlaces.ts). Answers are kept here for ten minutes per place.
import type { WeatherResponse } from '../shared/types';
import { weatherPlacesOf } from '../../server/core/weatherPlaces.js';
import { api } from './api';
import { getLang } from './i18n';

const KEEP_MS = 10 * 60_000;
const got = new Map<string, { w: WeatherResponse; at: number }>();
const asking = new Set<string>();

type DraftLike = { weather?: Parameters<typeof weatherPlacesOf>[0]; canvas?: { items?: { kind: string; props?: Record<string, unknown> }[] } | null };

/** Sends the frame the weather of the draft's places that are not the household's (fetched when not kept). */
export async function postDraftWeather(win: Window | null | undefined, origin: string, draft: unknown): Promise<void> {
  const d = draft as DraftLike | null;
  if (!win || !d?.weather) return;
  const places = weatherPlacesOf(d.weather, d.canvas?.items ?? null).filter((p) => !p.home);
  if (!places.length) return;
  const now = Date.now();
  const lang = getLang();
  const need = places.filter((p) => !(now - (got.get(`${lang}|${p.key}`)?.at ?? 0) < KEEP_MS) && !asking.has(`${lang}|${p.key}`));
  if (need.length) {
    for (const p of need) asking.add(`${lang}|${p.key}`);
    try {
      const r = await api.weatherPreview({ places: need.map(({ name, lat, lon }) => ({ name, lat, lon })), lang });
      for (const [k, w] of Object.entries(r.places ?? {})) got.set(`${lang}|${k}`, { w, at: Date.now() });
    } catch {
      /* the preview shows the card empty until the next try */
    } finally {
      for (const p of need) asking.delete(`${lang}|${p.key}`);
    }
  }
  const out: Record<string, WeatherResponse> = {};
  for (const p of places) {
    const hit = got.get(`${lang}|${p.key}`);
    if (hit) out[p.key] = hit.w;
  }
  if (!Object.keys(out).length) return;
  try {
    win.postMessage({ type: 'marco:preview-weather', places: out }, origin);
  } catch {
    /* the frame went away */
  }
}
