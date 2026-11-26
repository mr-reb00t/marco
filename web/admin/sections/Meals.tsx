// Menús: the week's meals (family.meals in the config, server/core/familyCore.js mealsForDate). A week without its own
// plan shows the template when "use the template" is on. Saved with the normal save bar.
import { useEffect, useState } from 'preact/hooks';
import { isoWeekKey, MEAL_SLOTS, weekStartOf } from '../../../server/core/familyCore.js';
import type { MealDays, MealSlot, StoredConfig } from '../../shared/types';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Callout, Card, PageHeader, ToggleRow } from '../components/ui';
import { addDays, dropAbbrDots, todayIn, weekdayNames } from '../dates';
import { locale, t } from '../i18n';
import type { SectionProps } from './common';
import { has } from '../caps';
import { MealieCard } from './MealieCard';

export const MEAL_LABEL: Record<MealSlot, { label: string; emoji: string; hint: string }> = {
  breakfast: { label: 'Desayuno', emoji: '🥣', hint: 'Ej.: Tostadas y fruta' },
  lunch: { label: 'Comida', emoji: '🍽️', hint: 'Ej.: Lentejas con verduras' },
  snack: { label: 'Merienda', emoji: '🍎', hint: 'Ej.: Yogur' },
  dinner: { label: 'Cena', emoji: '🍲', hint: 'Ej.: Tortilla de patatas' },
};

/** Days of the week in the order they are shown: Monday first (ISO weeks). */
const WEEK_DOWS = [1, 2, 3, 4, 5, 6, 0];

const clean = (v: unknown) => JSON.parse(JSON.stringify(v ?? {})) as MealDays;
const isEmpty = (days: MealDays | undefined) => !days || !Object.values(days).some((d) => d && Object.values(d).some((x) => x?.trim()));

/** Put one cell in a week / template object, dropping empty slots and days. */
function putCell(days: MealDays, dow: number, slot: MealSlot, text: string) {
  const day = { ...(days[dow] ?? {}) };
  if (text.trim()) day[slot] = text;
  else delete day[slot];
  if (Object.keys(day).length) days[dow] = day;
  else delete days[dow];
}

/** "Semana del 12 al 18 de octubre" */
function weekLabel(monday: string) {
  const sun = addDays(monday, 6);
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), { ...o, timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
  const sameMonth = monday.slice(0, 7) === sun.slice(0, 7);
  const from = sameMonth ? fmt(monday, { day: 'numeric' }) : fmt(monday, { day: 'numeric', month: 'long' });
  const to = fmt(sun, { day: 'numeric', month: 'long' });
  return t('Semana del {from} al {to}', { from, to });
}

export function MealsSection({ full, setFull, cfg, go, saved, errors }: SectionProps) {
  const m = full.family.meals;
  const today = todayIn(cfg.datetime.timezone);
  const thisMonday = weekStartOf(today, 1);
  const [monday, setMonday] = useState(thisMonday);
  const [editTpl, setEditTpl] = useState(() => location.hash.includes('meals-template'));
  useEffect(() => {
    const on = () => location.hash.includes('meals-template') && setEditTpl(true);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const key = isoWeekKey(monday);
  const plan = m.weeks[key];
  const usesTemplate = !plan && m.useTemplate && !isEmpty(m.template);
  const slots = MEAL_SLOTS.filter((s) => m.slots.includes(s));

  const setWeek = (fn: (days: MealDays, d: StoredConfig) => void) =>
    setFull((d) => {
      const meals = d.family.meals;
      // the first change to a week that shows the template starts from the template
      const days = meals.weeks[key] ? clean(meals.weeks[key]) : meals.useTemplate ? clean(meals.template) : {};
      fn(days, d);
      if (isEmpty(days)) delete meals.weeks[key];
      else meals.weeks[key] = days;
    });

  const copyPrevious = async () => {
    const prev = full.family.meals.weeks[isoWeekKey(addDays(monday, -7))];
    if (isEmpty(prev)) return toast(t('La semana anterior no tiene menú propio.'), 'error');
    if (!isEmpty(plan) && !(await confirmDialog({ title: t('¿Sustituir el menú de esta semana?'), body: t('Se copia el de la semana anterior encima del que hay.'), confirm: t('Copiar') }))) return;
    setFull((d) => void (d.family.meals.weeks[key] = clean(prev)));
    toast(t('Semana anterior copiada'));
  };
  const saveAsTemplate = async () => {
    const src = plan ?? (m.useTemplate ? m.template : {});
    if (isEmpty(src)) return toast(t('Esta semana está vacía.'), 'error');
    if (!isEmpty(m.template) && !(await confirmDialog({ title: t('¿Usar esta semana como plantilla?'), body: t('La plantilla actual se sustituye por el menú de esta semana.'), confirm: t('Guardar como plantilla') }))) return;
    setFull((d) => void (d.family.meals.template = clean(src)));
    toast(t('Plantilla actualizada'));
  };
  const clearWeek = async () => {
    if (!(await confirmDialog({ title: t('¿Vaciar esta semana?'), body: m.useTemplate ? t('La semana vuelve a usar la plantilla.') : t('La semana se queda sin menú.'), confirm: t('Vaciar'), danger: true }))) return;
    setFull((d) => void delete d.family.meals.weeks[key]);
  };

  return (
    <>
      <PageHeader title={t('Menús')} desc={t('El menú de la semana para toda la familia. Se ve en los diseños Familia y Semana de comidas, y en el móvil.')} />
      {!full.family.enabled && (
        <Callout>
          {t('Los menús forman parte de Familia, que está apagada.')}{' '}
          <button type="button" class="link-btn" onClick={() => go('family')}>
            {t('Ir a Familia')}
          </button>
        </Callout>
      )}
      <Card id="meals-settings" scope="global" title={t('Ajustes de los menús')} icon="utensils">
        <ToggleRow label={t('Mostrar menús')} hint={t('En las pantallas y en el enlace familiar.')} checked={m.enabled} onChange={(v) => setFull((d) => void (d.family.meals.enabled = v))} />
        <div class="meals-slots">
          <span class="muted small">{t('Comidas del día')}</span>
          <div class="meals-slots__list">
            {MEAL_SLOTS.map((s) => {
              const on = m.slots.includes(s);
              return (
                <button
                  type="button"
                  class={`pill ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => setFull((d) => void (d.family.meals.slots = MEAL_SLOTS.filter((x) => (x === s ? !on : d.family.meals.slots.includes(x)))))}
                >
                  {MEAL_LABEL[s].emoji} {t(MEAL_LABEL[s].label)}
                </button>
              );
            })}
          </div>
        </div>
        <ToggleRow
          label={t('Usar la plantilla en semanas sin plan')}
          hint={t('La plantilla es tu semana tipo. Las semanas que no rellenes la muestran.')}
          checked={m.useTemplate}
          onChange={(v) => setFull((d) => void (d.family.meals.useTemplate = v))}
        />
      </Card>

      {has('mealie') && <MealieCard full={full} setFull={setFull} saved={saved} errors={errors} />}

      <Card
        id="meals-week"
        scope="global"
        title={t('Menú de la semana')}
        icon="calendar"
        actions={
          <div class="meals-nav">
            <button type="button" class="icon-btn" aria-label={t('Semana anterior')} title={t('Semana anterior')} onClick={() => setMonday(addDays(monday, -7))}>
              <Icon name="left" size={16} />
            </button>
            <span class="meals-nav__label">{weekLabel(monday)}</span>
            <button type="button" class="icon-btn" aria-label={t('Semana siguiente')} title={t('Semana siguiente')} onClick={() => setMonday(addDays(monday, 7))}>
              <Icon name="right" size={16} />
            </button>
            <Button size="sm" variant="ghost" disabled={monday === thisMonday} onClick={() => setMonday(thisMonday)}>
              {t('Esta semana')}
            </Button>
          </div>
        }
      >
        {slots.length === 0 ? (
          <Callout kind="warn">{t('Marca al menos una comida del día en los ajustes de arriba.')}</Callout>
        ) : (
          <>
            {usesTemplate && <Callout>{t('Esta semana usa la plantilla. Si cambias algo, se guarda solo para esta semana.')}</Callout>}
            <MealGrid
              days={plan ?? (usesTemplate ? m.template : undefined)}
              faded={usesTemplate}
              slots={slots}
              monday={monday}
              today={today}
              onChange={(dow, slot, text) => setWeek((days) => putCell(days, dow, slot, text))}
            />
          </>
        )}
        <div class="meals-actions">
          <Button size="sm" icon="copy" onClick={() => void copyPrevious()}>
            {t('Copiar la semana anterior')}
          </Button>
          <Button size="sm" icon="archive" onClick={() => void saveAsTemplate()}>
            {t('Guardar como plantilla')}
          </Button>
          <Button size="sm" variant="ghost" icon="trash" disabled={!plan} onClick={() => void clearWeek()}>
            {t('Vaciar esta semana')}
          </Button>
        </div>
      </Card>

      <Card
        id="meals-template"
        scope="global"
        title={t('Plantilla')}
        icon="repeat"
        desc={t('Tu semana tipo. Se usa en las semanas sin plan propio, si está activado arriba.')}
        actions={
          <Button size="sm" variant={editTpl ? 'default' : 'primary'} icon={editTpl ? 'check' : 'edit'} onClick={() => setEditTpl(!editTpl)}>
            {editTpl ? t('Listo') : t('Editar plantilla')}
          </Button>
        }
      >
        {editTpl && slots.length > 0 ? (
          <MealGrid days={m.template} slots={slots} onChange={(dow, slot, text) => setFull((d) => putCell(d.family.meals.template, dow, slot, text))} />
        ) : (
          <p class="muted small">{isEmpty(m.template) ? t('La plantilla está vacía.') : t('{n} días con menú en la plantilla.', { n: Object.keys(m.template).length })}</p>
        )}
      </Card>
    </>
  );
}

/** 7 days (Monday first, one row each) × the enabled meals, as text inputs. With `monday` the rows carry dates. */
function MealGrid({
  days,
  slots,
  onChange,
  monday,
  today,
  faded,
}: {
  days: MealDays | undefined;
  slots: MealSlot[];
  onChange: (dow: number, slot: MealSlot, text: string) => void;
  monday?: string;
  today?: string;
  faded?: boolean;
}) {
  const names = weekdayNames('long');
  const fmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <div class={`meals-grid ${faded ? 'is-faded' : ''}`} style={{ '--meal-n': slots.length } as any}>
      <div class="meals-grid__head" aria-hidden="true">
        <span />
        {slots.map((s) => (
          <span>
            {MEAL_LABEL[s].emoji} {t(MEAL_LABEL[s].label)}
          </span>
        ))}
      </div>
      {WEEK_DOWS.map((dow, i) => {
        const date = monday ? addDays(monday, i) : null;
        const isToday = date && date === today;
        return (
          <div class={`meals-day ${isToday ? 'is-today' : ''}`} key={dow}>
            <div class="meals-day__head">
              <strong>{names[dow]}</strong>
              {date && <span class="muted small">{dropAbbrDots(fmt.format(new Date(`${date}T12:00:00Z`)))}</span>}
              {isToday && <span class="meals-day__today">{t('Hoy')}</span>}
            </div>
            {slots.map((s) => (
              <label class="meals-cell">
                <span class="meals-cell__label">
                  {MEAL_LABEL[s].emoji} {t(MEAL_LABEL[s].label)}
                </span>
                <input class="input" value={days?.[dow]?.[s] ?? ''} maxLength={120} placeholder={t(MEAL_LABEL[s].hint)} onInput={(e) => onChange(dow, s, e.currentTarget.value)} />
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}
