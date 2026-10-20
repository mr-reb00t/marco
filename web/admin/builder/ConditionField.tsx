// Inspector, Contenido tab, every card (and each card of a Rotativa): "Mostrar solo si", a condition on a Home Assistant entity's state or on a
// pushed value (Valor). The server works it out for the screens (canvasCore conditionHidden); the builder works it
// out again from the states and values it has, to say when the condition hides the card right now.
import type { CanvasCondition, CanvasConditionOp, CanvasItem, HookValueInfo } from '../../shared/types';
import { conditionMet } from '../../../server/core/canvasCore.js';
import { HaEntitySelect } from '../components/HaEntityPicker';
import { Callout, Field, Segmented, Select, TextInput } from '../components/ui';
import { t } from '../i18n';
import { ValueKeyInput, valueLabel } from './ValueKeyInput';

/** The domains a condition may read (what a screen would ever be shown or hidden by). */
const COND_DOMAINS = [
  'binary_sensor', 'sensor', 'switch', 'input_boolean', 'light', 'fan', 'person', 'device_tracker', 'cover', 'valve', 'lock', 'alarm_control_panel',
  'climate', 'media_player', 'select', 'input_select', 'number', 'input_number', 'vacuum', 'update', 'sun', 'weather',
];

const OPS: { value: CanvasConditionOp; label: string }[] = [
  { value: 'eq', label: 'Es' },
  { value: 'ne', label: 'No es' },
  { value: 'gt', label: 'Más de' },
  { value: 'lt', label: 'Menos de' },
];

/**
 * Whether the condition of `item` hides it now, from what the builder knows: true or false, or null when it cannot
 * tell yet (no state or value known, or nothing chosen).
 */
export function condOffNow(item: CanvasItem, raw: Record<string, string>, values: HookValueInfo[]): boolean | null {
  const w = item.when;
  if (!w || item.hidden) return null;
  if (w.src === 'ha') {
    if (!w.entity || raw[w.entity] === undefined) return null;
    return !conditionMet(w, raw[w.entity]);
  }
  if (!w.key) return null;
  const hit = values.find((x) => x.key === w.key);
  return !conditionMet(w, hit ? hit.value : null);
}

export function ConditionField({ item, ha, values, raw, upd, offText }: {
  item: CanvasItem;
  /** Home Assistant is on (and this is not Marco Cloud) */
  ha: boolean;
  values: HookValueInfo[];
  /** the raw states the builder fetched, by entity id (haPreview.ts) */
  raw: Record<string, string>;
  upd: (fn: (it: CanvasItem) => void, merge?: string) => void;
  /** what the note says while the condition hides it (a t() key; a Rotativa's card is skipped, not hidden) */
  offText?: string;
}) {
  const w = item.when ?? null;
  const src = w?.src ?? 'always';
  const set = (next: CanvasCondition | null, merge?: string) => upd((x) => (next ? (x.when = next) : delete x.when), merge);
  const sources = [{ value: 'always', label: t('Siempre') }, ...(ha || src === 'ha' ? [{ value: 'ha', label: t('Según Home Assistant') }] : []), { value: 'value', label: t('Según un valor') }];
  const off = condOffNow(item, raw, values);
  const now = w?.src === 'ha' && w.entity ? raw[w.entity] : w?.src === 'value' && w.key ? values.find((x) => x.key === w.key) : undefined;
  return (
    <div class="stack bld-cond">
      <Field label={t('Mostrar')} hint={src === 'always' ? t('Puede verse solo cuando algo de casa esté de una manera, por ejemplo la lavadora terminada o una puerta abierta.') : undefined}>
        <Select
          value={src}
          options={sources}
          onChange={(v) => {
            if (v === 'always') return set(null);
            if (v === 'ha') return set({ src: 'ha', entity: '', op: 'eq', value: 'on' });
            set({ src: 'value', key: '', op: 'eq', value: '' });
          }}
        />
      </Field>
      {w?.src === 'ha' && (
        <Field label={t('Entidad')} hint={!ha ? t('Activa Home Assistant en su sección para elegir entidades.') : undefined}>
          <HaEntitySelect domains={COND_DOMAINS} enabled={ha} value={w.entity} onChange={(v) => set({ ...w, entity: v })} />
        </Field>
      )}
      {w?.src === 'value' && (
        <Field label={t('Clave')}>
          <ValueKeyInput value={w.key} values={values} onValue={(v) => set({ ...w, key: v }, `${item.id}.when.key`)} />
        </Field>
      )}
      {w && (
        <>
          <Field label={t('Cuando')}>
            <Segmented full value={w.op} options={OPS.map((o) => ({ value: o.value, label: t(o.label) }))} onChange={(op) => set({ ...w, op } as CanvasCondition)} />
          </Field>
          <Field
            label={w.op === 'gt' || w.op === 'lt' ? t('Número') : t('Valor')}
            hint={w.op === 'gt' || w.op === 'lt' ? t('Solo cuenta si el estado es un número.') : w.src === 'ha' ? t('Como lo escribe Home Assistant: on, off, open, home, playing…') : t('Como llega: un número, un texto, o true y false.')}
          >
            <TextInput value={w.value} maxLength={60} placeholder={w.src === 'ha' ? 'on' : ''} onValue={(v) => set({ ...w, value: v } as CanvasCondition, `${item.id}.when.value`)} />
          </Field>
          {now !== undefined && (
            <p class="muted small">
              {t('Ahora')}: <strong>{typeof now === 'string' ? now : valueLabel(now)}</strong>
            </p>
          )}
          {off === true && <Callout>{t(offText ?? 'Ahora no se ve en la pantalla: no se cumple la condición.')}</Callout>}
        </>
      )}
    </div>
  );
}
