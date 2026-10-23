import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EventRule, EventRuleAction, EventsPreviewResponse, PreviewEvent } from '../../shared/types';
import { api, ApiError } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { SourcePicker } from '../components/SourcePicker';
import { Button, Callout, Card, ColorPicker, EmojiPicker, Empty, PageHeader, ReorderButtons, SearchInput, Segmented, Select, TextInput, Toggle, useReorder } from '../components/ui';
import { daysBetween, eventDay, eventTimeLabel, fmtDay, relDays, todayIn } from '../dates';
import { t } from '../i18n';
import { takeIntent } from '../intent';
import { titleNote } from '../titleNote';
import { allSourceOptions, moveItem, normalize, uid } from '../util';
import type { SectionProps } from './common';

const ACTIONS: { value: EventRuleAction; label: string; icon: 'eyeOff' | 'edit' | 'palette' }[] = [
  { value: 'hide', label: 'Ocultar', icon: 'eyeOff' },
  { value: 'rename', label: 'Renombrar', icon: 'edit' },
  { value: 'style', label: 'Emoji / color', icon: 'palette' },
];

export function newRule(action: EventRuleAction, match = '', extra: Partial<EventRule> = {}): EventRule {
  return { id: uid('f'), enabled: true, action, match, matchMode: 'contains', field: 'title', sourceIds: [], replaceWith: '', emoji: '', color: null, countdown: false, note: '', ...extra };
}

function RuleRow({ r, i, n, hits, errors, sources, upd, remove, move, reorder, highlight }: {
  r: EventRule;
  i: number;
  n: number;
  hits: number | undefined;
  errors: Record<string, string>;
  sources: ReturnType<typeof allSourceOptions>;
  upd: (fn: (x: EventRule) => void) => void;
  remove: () => void;
  move: (a: number, b: number) => void;
  reorder: ReturnType<typeof useReorder>;
  highlight: boolean;
}) {
  const p = `frule.${r.id}`;
  return (
    <div class={`frule frule--${r.action} ${r.enabled ? '' : 'is-off'} ${highlight ? 'is-hit' : ''}`} {...(reorder.rowProps(i) as any)} id={`rule-${r.id}`}>
      <div class="frule__line">
        <span class="grip" {...reorder.handleProps(i)}>
          <Icon name="grip" size={16} />
        </span>
        <div class="frule__action">
          <Select value={r.action} options={ACTIONS.map((a) => ({ value: a.value, label: t(a.label) }))} onChange={(v) => upd((x) => void (x.action = v))} />
        </div>
        <span class="frule__lbl">{t('si')}</span>
        <div class="frule__mode">
          <Select
            value={r.matchMode}
            options={[
              { value: 'contains', label: t('contiene') },
              { value: 'exact', label: t('es exactamente') },
              { value: 'startsWith', label: t('empieza por') },
            ]}
            onChange={(v) => upd((x) => void (x.matchMode = v))}
          />
        </div>
        <TextInput class="frule__match" value={r.match} error={!!errors[`${p}.match`]} maxLength={120} placeholder={r.matchMode === 'exact' ? t('Texto del título…') : t('Texto del título… (varios separados por comas)')} onValue={(v) => upd((x) => void (x.match = v))} />
        <span class={`frule__hits ${hits ? 'is-on' : ''}`} title={t('Eventos afectados en los próximos 14 días')}>
          {hits ?? 0}
        </span>
        <Toggle checked={r.enabled} size="sm" label={t('Activa')} onChange={(v) => upd((x) => void (x.enabled = v))} />
        <ReorderButtons index={i} count={n} onMove={move} />
        <button type="button" class="icon-btn icon-btn--danger" aria-label={t('Eliminar')} onClick={remove}>
          <Icon name="trash" size={15} />
        </button>
      </div>
      <div class="frule__line frule__line--sub">
        {r.action === 'rename' && (
          <div class="frule__rename">
            <Icon name="enter" size={14} class="flip-x" />
            <TextInput value={r.replaceWith} maxLength={120} placeholder={r.matchMode === 'exact' ? t('Nuevo título') : t('Reemplazar por (vacío = quitar el texto)')} onValue={(v) => upd((x) => void (x.replaceWith = v))} />
          </div>
        )}
        {r.action === 'style' && (
          <div class={`frule__style ${errors[`${p}.emoji`] ? 'is-invalid' : ''}`}>
            <EmojiPicker value={r.emoji} allowNone error={!!errors[`${p}.emoji`]} onChange={(v) => upd((x) => void (x.emoji = v))} />
            <ColorPicker compact allowNone value={r.color} onChange={(v) => upd((x) => void (x.color = v))} />
            <label class="mini-toggle" title={t('Mostrar como cuenta atrás en la pantalla')}>
              <Toggle size="sm" checked={r.countdown} onChange={(v) => upd((x) => void (x.countdown = v))} />
              <span>⏳ {t('Cuenta atrás')}</span>
            </label>
          </div>
        )}
        <SourcePicker compact options={sources} value={r.sourceIds} onChange={(v) => upd((x) => void (x.sourceIds = v))} />
        {r.matchMode === 'contains' && (
          <label class="mini-toggle" title={t('Buscar también en la descripción y la ubicación')}>
            <Toggle size="sm" checked={r.field === 'any'} onChange={(v) => upd((x) => void (x.field = v ? 'any' : 'title'))} />
            <span>{t('+ descripción y lugar')}</span>
          </label>
        )}
        <input class="input input--sm input--bare frule__note" value={r.note} maxLength={200} placeholder={t('Nota (opcional)')} onInput={(e) => upd((x) => void (x.note = e.currentTarget.value))} />
      </div>
      {errors[`${p}.emoji`] && <div class="field__error">{t(errors[`${p}.emoji`])}</div>}
    </div>
  );
}

function PreviewRow({ e, rules, onHide, onEmoji, onColor, onFocusRule }: { e: PreviewEvent; rules: EventRule[]; onHide: () => void; onEmoji: (v: string) => void; onColor: (v: string | null) => void; onFocusRule: (id: string) => void }) {
  const note = titleNote(e, rules);
  return (
    <li class={`pev ${e.hidden ? 'is-hidden' : ''}`} style={{ '--ev': e.color } as any}>
      <span class="pev__bar" />
      <span class="pev__emoji">{e.emoji || '·'}</span>
      <div class="pev__main">
        <div class="pev__title">
          <span>
            {e.title}
            {e.age != null && ` (${e.age})`}
          </span>
          {e.hidden && <span class="badge badge--soft">{t('oculto')}</span>}
        </div>
        <div class="pev__meta muted small" title={e.titleWhy === 'birthday' ? t('Marco deja solo el nombre junto al 🎂. Puedes cambiarlo en Cumpleaños, «Ordenar los títulos de cumpleaños».') : undefined}>
          {eventTimeLabel(e)} · {e.sourceName}
          {note && (
            <>
              {' · '}
              <span class="pev__before">
                {note.lead && <>{note.lead} · </>}
                {t('título original')}: <span class="pev__orig">{note.original}</span>
              </span>
            </>
          )}
        </div>
        {e.applied.length > 0 && (
          <div class="pev__rules">
            {e.applied.map((a) => {
              const idx = rules.findIndex((r) => r.id === a.ruleId);
              const r = rules[idx];
              return (
                <button type="button" class={`rule-chip rule-chip--${a.action}`} onClick={() => onFocusRule(a.ruleId)} title={r?.match}>
                  #{idx + 1} {t(ACTIONS.find((x) => x.value === a.action)?.label ?? a.action)}
                  {r && <span class="rule-chip__m">“{r.match}”</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div class="pev__actions">
        {!e.hidden && (
          <button type="button" class="pev__act" onClick={onHide} title={t('Crear una regla que oculte este evento')}>
            <Icon name="eyeOff" size={14} /> <span>{t('Ocultar')}</span>
          </button>
        )}
        <div class="pev__act pev__act--pick" title={t('Cambiar emoji')}>
          <EmojiPicker value={e.emoji ?? ''} allowNone onChange={onEmoji} />
        </div>
        <div class="pev__act pev__act--pick" title={t('Cambiar color')}>
          <ColorPicker compact allowNone value={e.color} onChange={onColor} />
        </div>
      </div>
    </li>
  );
}

/** Human message for a 400 from /events/preview, pointing at the part of the draft that is wrong. */
function previewError(e: ApiError): string {
  const details = (e.body as { details?: { path?: string }[] } | null)?.details ?? [];
  const path = details[0]?.path ?? '';
  if (path === 'screen') return t('Guarda la pantalla para filtrar por ella');
  if (path.startsWith('localEvents')) return t('Hay un evento local con datos no válidos: corrígelo en Eventos locales para ver la vista previa.');
  if (path.startsWith('birthdays')) return t('Hay un cumpleaños con datos no válidos: corrígelo en Cumpleaños para ver la vista previa.');
  if (path.startsWith('calendar.iconRules')) return t('Hay una regla de iconos incompleta: corrígela para ver la vista previa.');
  if (path.startsWith('eventRules')) return t('Hay reglas incompletas: corrígelas para ver la vista previa.');
  return `${t('No se pudo cargar la vista previa')}: ${e.message}`;
}

export function FiltersSection({ full, setFull, errors, cfg, screenId, saved }: SectionProps) {
  const rules = full.eventRules.items;
  const sources = useMemo(() => allSourceOptions(full), [full.calendar.sources, full.localEvents, full.birthdays]);
  const [scope, setScope] = useState<'all' | 'screen'>('all');
  const [prev, setPrev] = useState<EventsPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [perr, setPerr] = useState('');
  const [showHidden, setShowHidden] = useState(true);
  const [q, setQ] = useState('');
  const [hit, setHit] = useState('');
  const today = todayIn(cfg.datetime.timezone);
  const seq = useRef(0);
  useEffect(() => {
    if (takeIntent('filters', 'add')) setFull((d) => void d.eventRules.items.unshift(newRule('hide')));
  }, []);

  // "Esta pantalla" needs the screen to exist on the server: unsaved screens preview with all sources.
  const screenSaved = saved.screens.some((s) => s.id === screenId);
  const byScreen = scope === 'screen' && screenSaved;
  const draftScreenCal = full.screens.find((s) => s.id === screenId)?.calendar;
  const screenCalendar = draftScreenCal ? { enabled: draftScreenCal.enabled, sourceIds: draftScreenCal.sourceIds } : undefined;

  // live preview (debounced) with the draft rules
  const body = JSON.stringify({ eventRules: rules, iconRules: full.calendar.iconRules, localEvents: full.localEvents, birthdays: full.birthdays, byScreen, screenId, screenCalendar });
  useEffect(() => {
    const my = ++seq.current;
    setLoading(true);
    const h = setTimeout(async () => {
      try {
        const r = await api.eventsPreview({
          days: 14,
          // incomplete rules (being typed) would make the whole preview fail validation: skip them
          eventRules: rules.filter((r) => r.match.trim() && !(r.action === 'style' && !r.emoji && !r.color && !r.countdown)),
          iconRules: full.calendar.iconRules,
          localEvents: full.localEvents,
          birthdays: full.birthdays,
          screen: byScreen ? screenId : undefined,
          screenCalendar: byScreen ? screenCalendar : undefined,
        });
        if (my === seq.current) {
          setPrev(r);
          setPerr('');
        }
      } catch (e) {
        const ae = e as ApiError;
        if (my === seq.current) setPerr(ae.status === 400 ? previewError(ae) : ae.status === 404 ? t('El servidor aún no admite la vista previa.') : ae.message);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(h);
  }, [body]);

  const move = (a: number, b: number) => setFull((d) => void (d.eventRules.items = moveItem(d.eventRules.items, a, b)));
  const reorder = useReorder(move);
  const add = (action: EventRuleAction) => setFull((d) => void d.eventRules.items.unshift(newRule(action)));

  const styleRuleFor = (title: string) => rules.find((r) => r.action === 'style' && r.matchMode === 'exact' && normalize(r.match) === normalize(title));
  const quickHide = (e: PreviewEvent) => {
    setFull((d) => void d.eventRules.items.push(newRule('hide', e.originalTitle || e.title, { matchMode: 'exact', sourceIds: [e.sourceId] })));
    toast(t('Regla creada: ocultar “{title}”', { title: e.originalTitle || e.title }), 'ok', 2200);
  };
  const quickStyle = (e: PreviewEvent, patch: Partial<EventRule>) => {
    const existing = styleRuleFor(e.title);
    setFull((d) => {
      const r = existing && d.eventRules.items.find((x) => x.id === existing.id);
      if (r) Object.assign(r, patch, { enabled: true });
      else d.eventRules.items.unshift(newRule('style', e.title, { matchMode: 'exact', ...patch }));
    });
    toast(existing ? t('Regla actualizada para “{title}”', { title: e.title }) : t('Regla creada para “{title}”', { title: e.title }), 'ok', 2000);
  };
  const focusRule = (id: string) => {
    setHit(id);
    document.getElementById(`rule-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setHit(''), 1600);
  };

  const events = (prev?.events ?? []).filter((e) => (showHidden || !e.hidden) && (!q || normalize(`${e.title} ${e.originalTitle} ${e.sourceName}`).includes(normalize(q))));
  const hiddenCount = prev?.events.filter((e) => e.hidden).length ?? 0;
  const changed = prev?.events.filter((e) => e.applied.length).length ?? 0;
  const ruleErr = Object.keys(errors).some((k) => k.startsWith('frule.'));

  return (
    <>
      <PageHeader title={t('Filtros y cambios')} desc={t('Oculta eventos que no quieres ver (“No disponible”, “Blocked”…), corrige títulos o fija el emoji y el color de una serie. Se aplican en todas las pantallas.')} />

      <Card
        title={t('Reglas')}
        icon="filter"
        id="flt-rules"
        scope="global"
        desc={t('Orden: primero ocultar, luego renombrar (en orden) y por último el primer estilo que coincida. Sin distinguir mayúsculas ni acentos.')}
        actions={
          <div class="btn-row">
            {ACTIONS.map((a) => (
              <Button size="sm" icon={a.icon} variant={a.value === 'hide' ? 'primary' : 'default'} onClick={() => add(a.value)}>
                {t(a.label)}
              </Button>
            ))}
          </div>
        }
      >
        {rules.length === 0 ? (
          <Empty icon="filter" title={t('Sin reglas todavía')}>
            {t('Crea una con los botones de arriba o directamente desde la vista previa (“Ocultar”, emoji, color).')}
          </Empty>
        ) : (
          <div class="frule-list">
            {rules.map((r, i) => (
              <RuleRow
                key={r.id}
                r={r}
                i={i}
                n={rules.length}
                hits={prev?.ruleHits[r.id]}
                errors={errors}
                sources={sources}
                reorder={reorder}
                move={move}
                highlight={hit === r.id}
                remove={async () => {
                  if (r.match && !(await confirmDialog({ title: t('Eliminar la regla “{name}”', { name: r.match }), confirm: t('Eliminar'), danger: true }))) return;
                  setFull((d) => void (d.eventRules.items = d.eventRules.items.filter((x) => x.id !== r.id)));
                }}
                upd={(fn) =>
                  setFull((d) => {
                    const x = d.eventRules.items.find((y) => y.id === r.id);
                    if (x) fn(x);
                  })
                }
              />
            ))}
          </div>
        )}
        {ruleErr && <Callout kind="error">{t('Hay reglas incompletas (marcadas en rojo).')}</Callout>}
      </Card>

      <Card
        title={t('Vista previa · próximos 14 días')}
        icon="eye"
        id="flt-preview"
        desc={prev ? t('{n} eventos · {h} ocultos · {c} modificados', { n: prev.events.length, h: hiddenCount, c: changed }) : t('Con los cambios sin guardar aplicados')}
        actions={loading ? <span class="spinner" /> : undefined}
      >
        <div class="toolbar">
          {full.screens.length > 1 && (
            <Segmented
              size="sm"
              value={scope}
              options={[
                { value: 'all', label: t('Todas las fuentes') },
                { value: 'screen', label: t('Esta pantalla') },
              ]}
              onChange={setScope}
            />
          )}
          {scope === 'screen' && !screenSaved && <span class="muted small">{t('Guarda la pantalla para filtrar por ella')}</span>}
          <label class="mini-toggle">
            <Toggle size="sm" checked={showHidden} onChange={setShowHidden} />
            <span>{t('Mostrar ocultos')}</span>
          </label>
          <SearchInput value={q} onValue={setQ} placeholder={t('Buscar evento…')} />
        </div>
        {perr && <Callout kind={perr.includes('incompletas') ? 'warn' : 'error'}>{perr}</Callout>}
        {prev?.errors.length ? (
          <div class="muted small">
            <Icon name="alert" size={12} /> {t('Sin datos de: {list}', { list: prev.errors.map((e) => sources.find((s) => s.id === e.sourceId)?.name ?? e.sourceId).join(', ') })}
          </div>
        ) : null}
        {!prev && !perr ? (
          <div class="skeleton-list">
            <div class="skeleton" />
            <div class="skeleton" />
            <div class="skeleton" />
          </div>
        ) : prev && events.length === 0 ? (
          <Empty icon="calendar" title={q ? t('Sin resultados') : t('No hay eventos en los próximos 14 días')} />
        ) : (
          <ul class={`pev-list ${loading ? 'is-loading' : ''}`}>
            {events.map((e, i) => {
              const day = eventDay(e);
              const head = i === 0 || eventDay(events[i - 1]) !== day;
              const n = daysBetween(today, day);
              return (
                <>
                  {head && (
                    <li class="pev-day">
                      <strong>{n >= 0 && n <= 1 ? relDays(n) : fmtDay(day)}</strong>
                      {n > 1 && <span class="muted small">{relDays(n)}</span>}
                    </li>
                  )}
                  <PreviewRow
                    e={e}
                    rules={rules}
                    onHide={() => quickHide(e)}
                    onEmoji={(v) => quickStyle(e, { emoji: v })}
                    onColor={(v) => quickStyle(e, { color: v })}
                    onFocusRule={focusRule}
                  />
                </>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
