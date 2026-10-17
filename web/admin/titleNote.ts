// Admin Filtros preview: why an event's title on screen is not the calendar's (#10). Kept apart from Filters.tsx so
// the tests can load it without the components.
import type { EventRule, PreviewEvent } from '../shared/types';
import { t } from './i18n';

/**
 * The line under a preview event that says why its title on screen is not the calendar's: a recognised birthday
 * (only the name is kept), a rename rule (named by its number) or an ALL CAPS title. The calendar's title is shown as
 * it is, never struck through: nothing is removed.
 */
export function titleNote(e: Pick<PreviewEvent, 'title' | 'originalTitle' | 'titleWhy' | 'applied'>, rules: Pick<EventRule, 'id'>[]): { lead: string; original: string } | null {
  if (!e.originalTitle || e.originalTitle === e.title) return null;
  const original = e.originalTitle;
  if (e.titleWhy === 'birthday') return { lead: t('Cumpleaños reconocido'), original };
  if (e.titleWhy === 'caps') return { lead: t('Sin mayúsculas'), original };
  const rename = [...(e.applied ?? [])].reverse().find((a) => a.action === 'rename');
  const idx = rename ? rules.findIndex((r) => r.id === rename.ruleId) : -1;
  if (idx >= 0) return { lead: t('Renombrado por la regla #{n}', { n: idx + 1 }), original };
  return { lead: '', original };
}

