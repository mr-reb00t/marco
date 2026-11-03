// The Value widget's options (#34, Widgets section): 1 to 6 keys pushed to POST /api/hooks/values, each with the
// Valor card's name, unit, decimals and emoji, and when the values grey. The keys the server already has are offered
// with their last value (builder/ValueKeyInput.tsx).
import type { ValueWidgetItem, WidgetDef } from '../../shared/types';
import { Button, EmojiPicker, Field, NumberInput, Slider, TextInput } from '../components/ui';
import { Icon } from '../components/icons';
import { t } from '../i18n';
import { ValueKeyInput } from '../builder/ValueKeyInput';
import { useHookValues } from '../builder/valuesPreview';
import { has } from '../caps';

/** Keys of one Value widget, as the server keeps them (server/core/defaults.js MAX_VALUE_WIDGET_KEYS). */
export const MAX_VALUE_KEYS = 6;

export const newValueItem = (): ValueWidgetItem => ({ key: '', label: '', unit: '', decimals: 1, icon: '' });
/** A new Value widget: one key to fill in, greyed after an hour (the Valor card's defaults). */
export const newValueOptions = (): NonNullable<WidgetDef['options']['value']> => ({ items: [newValueItem()], staleAfterMin: 60 });

export function ValueWidgetFields({ w, errors, upd, go }: { w: WidgetDef; errors: Record<string, string>; upd: (fn: (x: WidgetDef) => void) => void; go: (route: string) => void }) {
  const known = useHookValues(has('valueHooks')) ?? [];
  const o = w.options.value ?? newValueOptions();
  const edit = (fn: (v: NonNullable<WidgetDef['options']['value']>) => void) =>
    upd((x) => {
      const v = structuredClone(x.options.value ?? newValueOptions());
      fn(v);
      x.options.value = v;
    });
  const setItem = <K extends keyof ValueWidgetItem>(i: number, k: K, v: ValueWidgetItem[K]) => edit((x) => void (x.items[i] = { ...x.items[i], [k]: v }));
  const err = errors[`wdg.${w.id}.items`];
  return (
    <div class="stack">
      <div class="stack value-widget-items">
        {o.items.map((x, i) => (
          <div class="value-widget-item">
            <div class="value-widget-item__head">
              <strong class="small">{t('Valor {n}', { n: i + 1 })}</strong>
              {o.items.length > 1 && (
                <button type="button" class="icon-btn icon-btn--danger" aria-label={t('Quitar')} onClick={() => edit((v) => void v.items.splice(i, 1))}>
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
            <Field label={t('Clave')}>
              <ValueKeyInput value={x.key} values={known} onValue={(v) => setItem(i, 'key', v)} />
            </Field>
            <div class="grid grid--2">
              <Field label={t('Nombre')} hint={t('Vacío: el que llega con el valor, o la clave.')}>
                <TextInput value={x.label} maxLength={40} onValue={(v) => setItem(i, 'label', v)} />
              </Field>
              <Field label={t('Unidad')} hint={t('Vacía: la que llega con el valor.')}>
                <TextInput value={x.unit} maxLength={12} placeholder="%" onValue={(v) => setItem(i, 'unit', v)} />
              </Field>
              <Field label={t('Decimales')}>
                <NumberInput value={x.decimals} min={0} max={3} onValue={(v) => setItem(i, 'decimals', Math.min(3, Math.max(0, Math.round(v))))} />
              </Field>
              <Field label={t('Emoji')}>
                <EmojiPicker value={x.icon} allowNone onChange={(v) => setItem(i, 'icon', v)} />
              </Field>
            </div>
          </div>
        ))}
        {err && <p class="field__error">{t(err)}</p>}
        {o.items.length < MAX_VALUE_KEYS && (
          <Button size="sm" icon="plus" class="value-widget-add" onClick={() => edit((v) => void v.items.push(newValueItem()))}>
            {t('Añadir otro valor')}
          </Button>
        )}
      </div>
      <Field label={t('En gris pasados')} hint={t('Un valor que no se ha actualizado en ese tiempo sale en gris. 0: nunca.')}>
        <Slider value={o.staleAfterMin} min={0} max={1440} step={5} format={(v) => t('{n} min', { n: v })} onChange={(v) => edit((x) => void (x.staleAfterMin = v))} />
      </Field>
      <p class="muted small">
        {t('Se envía con POST /api/hooks/values. En API y webhooks tienes el ejemplo para Home Assistant.')}{' '}
        <button type="button" class="link-btn" onClick={() => go('api')}>
          {t('Abrir API y webhooks')}
        </button>
      </p>
    </div>
  );
}
