import { useMemo, useState } from 'preact/hooks';
import { confirmDialog } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Card, Chips, ColorPicker, EmojiPicker, Empty, Field, PageHeader, ReorderButtons, RuleNumber, Select, useReorder } from '../components/ui';
import { t } from '../i18n';
import { clone, DEFAULT_ICON_RULES, matchIconRule, moveItem, resolveEmoji, uid } from '../util';
import type { SectionProps } from './common';

const EXAMPLES = ['Cumple de la abuela 🎈', 'Reserva Airbnb – João', 'Check-out apartamento', 'Vuelo a Madrid', 'Dentista Lucía', 'Cena con amigos', 'Pádel'];

export function IconRulesSection({ cfg, set, errors }: SectionProps) {
  const rules = cfg.calendar.iconRules;
  const sources = cfg.calendar.sources;
  const [sample, setSample] = useState(() => t('Cumpleaños de María'));
  const [sampleSrc, setSampleSrc] = useState<string>(sources[0]?.id ?? '');
  const src = sources.find((s) => s.id === sampleSrc);
  const match = useMemo(() => matchIconRule(rules, sample), [rules, sample]);
  const emoji = resolveEmoji(rules, src, sample);
  const color = match?.rule.color || src?.color || cfg.screen.accent;

  const move = (from: number, to: number) => set((d) => void (d.calendar.iconRules = moveItem(d.calendar.iconRules, from, to)));
  const reorder = useReorder(move);

  const restore = async () => {
    const ok = await confirmDialog({
      title: t('Restaurar reglas predeterminadas'),
      body: t('Se reemplazarán tus reglas actuales por las predeterminadas.'),
      confirm: t('Restaurar'),
      danger: true,
    });
    if (ok) set((d) => void (d.calendar.iconRules = clone(DEFAULT_ICON_RULES)));
  };

  return (
    <>
      <PageHeader title={t('Iconos automáticos')} desc={t('Reglas que añaden un emoji (y opcionalmente un color) según el título del evento. Se evalúan en orden: gana la primera que coincide.')}>
        <Button variant="ghost" icon="refresh" onClick={restore}>
          {t('Restaurar predeterminadas')}
        </Button>
      </PageHeader>

      <Card id="ico-tester" title={t('Probar reglas')} icon="wand" class="tester">
        <div class="tester__row">
          <Field label={t('Título de un evento')} class="tester__input">
            <input class="input input--lg" value={sample} placeholder={t('Escribe el título de un evento…')} onInput={(e) => setSample(e.currentTarget.value)} />
          </Field>
          {sources.length > 0 && (
            <Field label={t('Calendario')} class="tester__src">
              <Select value={sampleSrc} options={[{ value: '', label: t('(ninguno)') }, ...sources.map((s) => ({ value: s.id, label: `${s.emoji || ''} ${s.name}`.trim() }))]} onChange={setSampleSrc} />
            </Field>
          )}
        </div>
        <div class="tester__preview">
          <div class="event-pill" style={{ '--ev': color } as any}>
            <span class="event-pill__emoji">{emoji || '·'}</span>
            <span class="event-pill__title">{sample || t('Sin título')}</span>
          </div>
          <div class="tester__why small muted">
            {match ? (
              <>
                {t('Regla #{n} · coincide con', { n: match.index + 1 })} <span class="chip chip--static">{match.keyword}</span>
              </>
            ) : emoji ? (
              t('Sin regla: se usa el emoji del calendario')
            ) : (
              t('Ninguna regla coincide')
            )}
          </div>
        </div>
        <div class="quick-add">
          {EXAMPLES.map((key) => t(key)).map((e) => (
            <button type="button" class="pill" onClick={() => setSample(e)}>
              {e}
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={t('Reglas')}
        id="ico-rules"
        scope="global"
        icon="tag"
        desc={t('{n} reglas · sin distinguir mayúsculas ni acentos', { n: rules.length })}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            onClick={() => set((d) => void d.calendar.iconRules.unshift({ id: uid('r'), match: [], emoji: '⭐', color: null }))}
          >
            {t('Nueva regla')}
          </Button>
        }
      >
        {rules.length === 0 ? (
          <Empty icon="tag" title={t('Sin reglas')}>
            {t('Añade una regla o restaura las predeterminadas.')}
          </Empty>
        ) : (
          <div class="rule-list">
            {rules.map((r, i) => {
              const upd = (fn: (x: typeof r) => void) =>
                set((d) => {
                  const x = d.calendar.iconRules.find((y) => y.id === r.id);
                  if (x) fn(x);
                });
              const hit = match?.rule.id === r.id;
              return (
                <div key={r.id} class={`rule ${hit ? 'is-hit' : ''}`} {...(reorder.rowProps(i) as any)}>
                  <span class="grip" {...reorder.handleProps(i)}>
                    <Icon name="grip" size={16} />
                  </span>
                  <RuleNumber index={i} count={rules.length} onMove={move} />
                  <EmojiPicker size="lg" value={r.emoji} error={!!errors[`rule.${r.id}.emoji`]} onChange={(v) => upd((x) => void (x.emoji = v))} />
                  <div class="rule__chips">
                    <Chips
                      values={r.match}
                      error={!!errors[`rule.${r.id}.match`]}
                      placeholder={t('Palabras clave (Enter o coma para añadir)')}
                      onChange={(v) => upd((x) => void (x.match = v))}
                    />
                  </div>
                  <ColorPicker compact allowNone value={r.color} onChange={(v) => upd((x) => void (x.color = v))} />
                  <ReorderButtons index={i} count={rules.length} onMove={move} />
                  <button
                    type="button"
                    class="icon-btn icon-btn--danger"
                    aria-label={t('Eliminar')}
                    title={t('Eliminar')}
                    onClick={() => set((d) => void (d.calendar.iconRules = d.calendar.iconRules.filter((x) => x.id !== r.id)))}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
