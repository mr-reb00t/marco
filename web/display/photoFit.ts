// Pure helpers of the photo rotation (widgets/photos.ts): when a photo gets the blurred fill, and the caption.
import type { BackgroundConfig, Photo } from '../shared/types';

/** Whether a photo gets the blurred fill: the setting (auto = Immich photos only), cover on, and an orientation that
 *  differs from the panel's (portrait photo on a landscape screen, or the other way round). */
export function wantsBlurFill(b: Pick<BackgroundConfig, 'cover' | 'portraitFit'>, p: Pick<Photo, 'source'>, iw: number, ih: number, aw: number, ah: number): boolean {
  if (!b.cover || !iw || !ih || !aw || !ah) return false;
  const fit = b.portraitFit ?? 'auto';
  if (fit === 'crop' || (fit === 'auto' && p.source !== 'immich')) return false;
  const ia = iw / ih, aa = aw / ah;
  return ia < 1 !== aa < 1 && Math.max(ia / aa, aa / ia) > 1.25;
}

/** The day a photo was taken, "12 August 2019" in the screen's language ('' when unknown). */
export function takenDay(takenAt: string | undefined, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(takenAt || '');
  if (!m) return '';
  try {
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  } catch {
    return takenAt!;
  }
}

/** Caption of an Immich photo: "Valencia, Spain · 12 August 2019" in the screen's language. */
export function immichCaption(p: Pick<Photo, 'takenAt' | 'place'>, lang: string): string {
  return [p.place, takenDay(p.takenAt, lang)].filter(Boolean).join(' · ');
}

/**
 * Caption of the background photo ('' = none). showMeta: the author or title (Immich: place and date, as before);
 * showDate: the day taken (#49), alone or after the title.
 */
export function photoCaption(
  p: Pick<Photo, 'source' | 'title' | 'author' | 'takenAt' | 'place'>,
  b: { showMeta?: boolean; showDate?: boolean },
  lang: string,
  photoBy: (a: string) => string
): string {
  const date = b.showDate ? takenDay(p.takenAt, lang) : '';
  if (p.source === 'immich') return b.showMeta ? immichCaption(p, lang) : date;
  const meta = !b.showMeta ? '' : p.title ? `${p.title}${p.author ? ' · ' + p.author : ''}` : p.author ? photoBy(p.author) : '';
  return [meta, date].filter(Boolean).join(' · ');
}
