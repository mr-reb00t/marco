// How often a photo changes: the steps the screen's Fondo offers, which the photo card and the sidebar's photo of a
// Personalizado screen share (#41). The server takes any whole number of seconds from 10 to 86400.
import { t } from './i18n';

export const INTERVALS = [30, 60, 120, 300, 600, 900, 1800, 3600, 10800, 86400];

/** The steps, with `cur` added in its place when it is not one of them (a value saved before, or from the API). */
export const intervalsWith = (cur: number): number[] => (INTERVALS.includes(cur) || !Number.isFinite(cur) ? INTERVALS : [...INTERVALS, cur].sort((a, b) => a - b));

export function intervalLabel(s: number): string {
  if (s < 60 || (s < 3600 && s % 60)) return t('{n} segundos', { n: s });
  if (s < 3600 || (s < 86400 && s % 3600)) return s === 60 ? t('1 minuto') : t('{n} minutos', { n: Math.round(s / 60) });
  if (s < 86400) return s === 3600 ? t('1 hora') : t('{n} horas', { n: s / 3600 });
  return t('1 día');
}
