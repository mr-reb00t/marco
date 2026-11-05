// The days of the week a month / week grid shows (#39): calendar.weekdays in Calendars > Calendar view, and the
// weekdays of a month / week card in the builder. Texts in i18n-dict-group.ts.
import type { AppConfig } from '../../shared/types';
import { weekdayNames } from '../dates';
import { t } from '../i18n';
import { Field, WeekdayPicker } from './ui';

type Set = (fn: (d: AppConfig) => void) => void;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
/** Quick picks of calendar.weekdays (#39), with their (Spanish) t() keys. */
const DAY_PRESETS: { label: string; days: number[] }[] = [
  { label: 'Todos los días', days: ALL_DAYS },
  { label: 'Lunes a viernes', days: [1, 2, 3, 4, 5] },
  { label: 'Fin de semana', days: [0, 6] },
];

/**
 * The days of the week a month / week grid shows (calendar.weekdays, a month / week card's weekdays): quick picks and
 * one toggle per day, in the grid's order (`weekStart`). The last day shown cannot be turned off.
 */
export function ShownDaysPicker({ value, onChange, weekStart = 1 }: { value: number[] | undefined; onChange: (v: number[]) => void; weekStart?: number }) {
  const days = Array.isArray(value) && value.length ? value : ALL_DAYS;
  const same = (a: number[]) => a.length === days.length && a.every((d) => days.includes(d));
  return (
    <div class="shown-days">
      <div class="quick-add">
        {DAY_PRESETS.map((p) => (
          <button type="button" class={`pill${same(p.days) ? ' is-on' : ''}`} aria-pressed={same(p.days)} onClick={() => onChange([...p.days])}>
            {t(p.label)}
          </button>
        ))}
      </div>
      <WeekdayPicker
        labels={weekdayNames('short')}
        order={weekStart === 0 ? ALL_DAYS : [1, 2, 3, 4, 5, 6, 0]}
        value={days}
        onChange={(v) => {
          if (v.length) onChange(v);
        }}
      />
    </div>
  );
}

/** Calendars > Calendar view: calendar.weekdays (#39), for the month and week grids. */
export function WeekdaysField({ cfg, set, error }: { cfg: AppConfig; set: Set; error?: string }) {
  const c = cfg.calendar;
  return (
    <Field
      class="field--days"
      label={t('Días que se muestran')}
      hint={t('Los días sin marcar no ocupan sitio y sus eventos no se ven. Un evento de varios días se muestra en los días marcados que toca.')}
      error={error}
    >
      <ShownDaysPicker value={c.weekdays} weekStart={c.weekStart} onChange={(v) => set((d) => void (d.calendar.weekdays = v))} />
    </Field>
  );
}
