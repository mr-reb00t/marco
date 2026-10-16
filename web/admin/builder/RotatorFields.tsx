// The cards of a Rotativa (kind 'rotator') in the inspector: 2 to 6 cards, each a kind of its own with its own options
// (the same fields as that card on its own, ContentFields), in the order they show. Opening a card holds it on the
// preview while it is edited (FieldEnv.pinCard). Which kinds may go inside: canvasCore rotatorKindOk, the kinds this
// server offers, and Home Assistant only where Home Assistant is on.
import { useEffect, useState } from 'preact/hooks';
import type { CanvasItem, CanvasKind, RotatorCard } from '../../shared/types';
import { CANVAS_CATEGORIES, CANVAS_KINDS, DEFAULT_CANVAS_KINDS, ROTATOR_MAX, ROTATOR_MIN, canvasDefaults, newCanvasId, rotatorKindOk } from '../../../server/core/canvasCore.js';
import { Icon } from '../components/icons';
import { Field, Select } from '../components/ui';
import { t } from '../i18n';
import { ContentFields, type FieldEnv } from './fields';
import { GROUPS, KIND_META, groupOf, kindName } from './kinds';

/** The kinds a Rotativa may show here, in the palette's category order. */
function cardKinds(env: FieldEnv): CanvasKind[] {
  const allowed = new Set(env.allowed ?? DEFAULT_CANVAS_KINDS);
  const cat = (k: CanvasKind) => CANVAS_CATEGORIES.indexOf(CANVAS_KINDS[k].cat);
  return (Object.keys(CANVAS_KINDS) as CanvasKind[])
    .filter((k) => rotatorKindOk(k) && allowed.has(k) && !KIND_META[k]?.soon && (!k.startsWith('ha.') || (env.ha && !env.cloud)))
    .sort((a, b) => cat(a) - cat(b));
}

export function RotatorCards({ item, env, put }: { item: CanvasItem; env: FieldEnv; put: (k: string, v: unknown, merge?: string) => void }) {
  const cards = (Array.isArray(item.props.cards) ? item.props.cards : []) as RotatorCard[];
  const [open, setOpen] = useState<string | null>(null);
  // the card being edited stays on the preview; closing it (or leaving the Rotativa) lets it turn again
  useEffect(() => {
    env.pinCard?.(item.id, open && cards.some((c) => c.id === open) ? open : null);
  }, [open, item.id]);
  useEffect(() => () => env.pinCard?.(item.id, null), [item.id]);
  const set = (next: RotatorCard[], merge?: string) => put('cards', next, merge);
  const move = (i: number, d: -1 | 1) => {
    const next = [...cards];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    set(next);
  };
  const kinds = cardKinds(env);
  const room = cards.length < ROTATOR_MAX && (env.cardsLeft ?? 1) > 0;
  const add = (k: string) => {
    if (!k || !room) return;
    const taken = new Set([item.id, ...cards.map((c) => c.id)]);
    const id = newCanvasId(taken);
    set([...cards, { id, kind: k as CanvasKind, props: canvasDefaults(k) }]);
    setOpen(id);
  };
  return (
    <div class="stack bld-rot">
      <Field label={t('Tarjetas')} hint={t('Se ven una tras otra en el mismo hueco, de {min} a {max}. No hace falta tocar la pantalla.', { min: ROTATOR_MIN, max: ROTATOR_MAX })}>
        <ol class="bld-rot__list">
          {cards.map((c, i) => {
            const name = t(kindName(c.kind));
            const isOpen = open === c.id;
            return (
              <li class={`bld-rot__card ${isOpen ? 'is-open' : ''}`} key={c.id}>
                <div class="bld-rot__head">
                  <button type="button" class="bld-rot__name" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)}>
                    <Icon name={KIND_META[c.kind]?.icon ?? 'widget'} size={15} />
                    <span>
                      {i + 1}. {name}
                    </span>
                    <Icon name="chevron" size={14} class={isOpen ? 'bld-rot__chev is-open' : 'bld-rot__chev'} />
                  </button>
                  <button type="button" class="icon-btn" aria-label={t('Subir')} title={t('Subir')} disabled={i === 0} onClick={() => move(i, -1)}>
                    <Icon name="up" size={14} />
                  </button>
                  <button type="button" class="icon-btn" aria-label={t('Bajar')} title={t('Bajar')} disabled={i === cards.length - 1} onClick={() => move(i, 1)}>
                    <Icon name="down" size={14} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={t('Quitar')}
                    title={cards.length <= ROTATOR_MIN ? t('Una Rotativa tiene al menos {n} tarjetas.', { n: ROTATOR_MIN }) : t('Quitar')}
                    disabled={cards.length <= ROTATOR_MIN}
                    onClick={() => set(cards.filter((x) => x.id !== c.id))}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
                {isOpen && (
                  <div class="bld-rot__body">
                    <ContentFields
                      item={{ ...item, id: c.id, kind: c.kind, props: c.props }}
                      env={env}
                      put={(k, v, merge) => set(cards.map((x) => (x.id === c.id ? { ...x, props: { ...x.props, [k]: v } } : x)), merge)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </Field>
      {room ? (
        <Select
          value=""
          options={[{ value: '', label: t('Añadir una tarjeta') }, ...kinds.map((k) => ({ value: k, label: t(kindName(k)), group: t(GROUPS.find((g) => g.id === groupOf(k))?.name ?? '') }))]}
          onChange={add}
        />
      ) : (
        <p class="muted small">{cards.length >= ROTATOR_MAX ? t('Ya tiene {n} tarjetas, el máximo.', { n: ROTATOR_MAX }) : t('La pantalla ya tiene todas las tarjetas que caben.')}</p>
      )}
      {cards.some((c) => CANVAS_KINDS[c.kind]?.controls) && <p class="muted small">{t('Las tarjetas de una Rotativa solo se ven: no se pueden tocar en la pantalla.')}</p>}
    </div>
  );
}
