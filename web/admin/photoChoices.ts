// The photo options of the Fondo section, a Personalizado photo card and the sidebar's photo (#41): which sources the
// admin offers here and how a card's own options start. Plain TypeScript with type-only imports (the server tests
// load it).
import type { BackgroundConfig, PhotoSource } from '../shared/types';

export type PhotoSourceId = BackgroundConfig['source'];

/**
 * The sources the Origen control offers on this server: Stock always; Mi galería and Mezcla with the gallery (or when
 * already chosen, so the warning shows); Immich where the server has it (or when already chosen).
 */
export function sourceChoices(has: { gallery: boolean; immich: boolean }, current: PhotoSourceId): PhotoSourceId[] {
  return [
    'stock',
    ...(has.gallery || current === 'gallery' || current === 'mixed' ? (['gallery', 'mixed'] as const) : []),
    ...(has.immich || current === 'immich' ? (['immich'] as const) : []),
  ];
}

/**
 * A card's or the sidebar's own photo options when "Propias" is chosen for the first time: the screen's Fondo as it
 * is (its source, topic, order, Immich albums and special backgrounds), a source this server lacks becoming Stock.
 * The weather effect starts off on a card (a new layer over it) and as the Fondo's on the sidebar (the same effect).
 */
export function startPhotoSource(bg: Pick<BackgroundConfig, 'source' | 'stockTopic' | 'order' | 'immich' | 'rules' | 'weatherFx'>, card: boolean, has: { gallery: boolean; immich: boolean }): PhotoSource {
  const ok = bg.source === 'stock' || ((bg.source === 'gallery' || bg.source === 'mixed') && has.gallery) || (bg.source === 'immich' && has.immich);
  const rules = (bg.rules ?? []).filter((r) => (r.photos.source === 'immich' ? has.immich : has.gallery));
  return {
    mode: 'own',
    source: ok ? bg.source : 'stock',
    stockTopic: bg.stockTopic ?? 'nature',
    order: bg.order ?? 'random',
    immich: { albumIds: [...(bg.immich?.albumIds ?? [])], favoritesOnly: bg.immich?.favoritesOnly ?? false },
    rules: structuredClone(rules),
    weatherFx: card ? 'off' : bg.weatherFx ?? 'simple',
  };
}
