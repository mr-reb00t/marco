// What the photos of a Foto page, a photo card or the sidebar are, in one line for a hint.
import { t } from '../i18n';

/** The photos a source shows, as the screen's Fondo section has them (an empty gallery or Immich falls back to stock). */
export function photoSourceText(b: { source: string; stockTopic: string }): string {
  if (b.source === 'gallery') return t('Fotos de tu galería.');
  if (b.source === 'mixed') return t('Fotos de tu galería y de stock.');
  if (b.source === 'immich') return t('Fotos de tus álbumes de Immich.');
  const topic = b.stockTopic.trim();
  return topic ? t('Fotos de stock ({topic}).', { topic }) : t('Fotos de stock.');
}
