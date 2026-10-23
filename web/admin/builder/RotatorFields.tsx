// The cards of a Rotativa (kind 'rotator') in the inspector: 2 to 6 cards, each a kind of its own with its own options
// (the same fields as that card on its own, ContentFields) and its own "Mostrar" (ConditionField: while it does not
// hold, the Rotativa skips the card), in the order they show. Opening a card holds it on the preview while it is
// edited (FieldEnv.pinCard). Which kinds may go inside: canvasCore rotatorKindOk, the kinds this
// server offers, and Home Assistant only where Home Assistant is on. A card of the list can be a group ("Añadir grupo",
// #19): 2 to 4 cards in the box of one, in rows or columns, each with its own options; the group has the "Mostrar".
// A card of a group can be a small Rotativa ("Añadir una Rotativa al grupo"): this same editor for its cards (env.nest),
// without groups, its preview not held.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { CanvasItem, CanvasKind, RotatorCard, RotatorEntry, RotatorGroup, RotatorMember, RotatorNested } from '../../shared/types';
import { CANVAS_CATEGORIES, CANVAS_KINDS, DEFAULT_CANVAS_KINDS, GROUP_MAX, GROUP_MIN, ROTATOR_MAX, ROTATOR_MIN, canvasDefaults, groupDefaults, isRotatorGroup, newCanvasId, rotatorKindOk, rotatorLeaves, rotatorNodes } from '../../../server/core/canvasCore.js';
import { Icon } from '../components/icons';
import { Field, Segmented, Select } from '../components/ui';
import { t } from '../i18n';
import { ConditionField } from './ConditionField';
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

/** What a new group holds: three entity cards where Home Assistant is on, else three values (#19). */
function groupKinds(kinds: CanvasKind[], n: number): CanvasKind[] {
  const k = (['ha.tile', 'value'] as CanvasKind[]).find((x) => kinds.includes(x)) ?? kinds[0];
  return k ? Array.from({ length: n }, () => k) : [];
}

/** A new small Rotativa for a group: the cards of a new Rotativa this server offers, else the first kinds (ids: none yet). */
function nestedDefaults(kinds: CanvasKind[]): RotatorNested {
  const d = canvasDefaults('rotator') as RotatorNested['props'];
  let cards = d.cards.filter((c) => kinds.includes(c.kind));
  if (cards.length < ROTATOR_MIN) cards = kinds.slice(0, ROTATOR_MIN).map((k) => ({ id: '', kind: k, props: canvasDefaults(k) }));
  return { id: '', kind: 'rotator', props: { ...d, cards } };
}

/** One card's row of the list: its name, up, down, remove, and its options when open. */
function CardRow(p: {
  label: string;
  icon: string;
  open: boolean;
  first: boolean;
  last: boolean;
  /** why it cannot be removed (null: it can) */
  keep: string | null;
  toggle: () => void;
  move: (d: -1 | 1) => void;
  remove: () => void;
  children?: ComponentChildren;
}) {
  return (
    <li class={`bld-rot__card ${p.open ? 'is-open' : ''}`}>
      <div class="bld-rot__head">
        <button type="button" class="bld-rot__name" aria-expanded={p.open} onClick={p.toggle}>
          <Icon name={p.icon} size={15} />
          <span>{p.label}</span>
          <Icon name="chevron" size={14} class={p.open ? 'bld-rot__chev is-open' : 'bld-rot__chev'} />
        </button>
        <button type="button" class="icon-btn" aria-label={t('Subir')} title={t('Subir')} disabled={p.first} onClick={() => p.move(-1)}>
          <Icon name="up" size={14} />
        </button>
        <button type="button" class="icon-btn" aria-label={t('Bajar')} title={t('Bajar')} disabled={p.last} onClick={() => p.move(1)}>
          <Icon name="down" size={14} />
        </button>
        <button type="button" class="icon-btn" aria-label={t('Quitar')} title={p.keep ?? t('Quitar')} disabled={!!p.keep} onClick={p.remove}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      {p.open && <div class="bld-rot__body">{p.children}</div>}
    </li>
  );
}

/** A list moved one place up or down. */
const moved = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
  const next = [...list];
  const [x] = next.splice(i, 1);
  next.splice(i + d, 0, x);
  return next;
};

export function RotatorCards({ item, env, put }: { item: CanvasItem; env: FieldEnv; put: (k: string, v: unknown, merge?: string) => void }) {
  const cards = (Array.isArray(item.props.cards) ? item.props.cards : []) as RotatorEntry[];
  const [open, setOpen] = useState<string | null>(null);
  /** the card of a group that is open (its group is open too) */
  const [inner, setInner] = useState<string | null>(null);
  // the card being edited stays on the preview (a group's card: its group); closing it (or leaving the Rotativa) lets
  // it turn again
  // (a small Rotativa of a group: never held, its group is)
  const nest = env.nest;
  useEffect(() => {
    if (!nest) env.pinCard?.(item.id, open && cards.some((c) => c.id === open) ? open : null);
  }, [open, item.id]);
  useEffect(() => () => void (!nest && env.pinCard?.(item.id, null)), [item.id]);
  const set = (next: RotatorEntry[], merge?: string) => put('cards', next, merge);
  const kinds = cardKinds(env);
  const left = env.cardsLeft ?? 1;
  const room = cards.length < ROTATOR_MAX && left > 0;
  // every id of this Rotativa (the new ones are new on the screen too: the save gives a new id to a repeated one)
  // (a small Rotativa: the ids of the Rotativa it is in too)
  const taken = () => new Set([item.id, ...rotatorNodes(cards).map((c) => c.id), ...(nest ? nest.taken() : [])]);
  const add = (k: string) => {
    if (!k || !room) return;
    const id = newCanvasId(taken());
    set([...cards, { id, kind: k as CanvasKind, props: canvasDefaults(k) }]);
    setOpen(id);
  };
  // a group: as many cards as the screen still takes, up to three
  const groupN = Math.min(3, left);
  const addGroup = () => {
    if (!room || groupN < GROUP_MIN) return;
    const ids = taken();
    const g = groupDefaults(groupKinds(kinds, groupN)) as RotatorGroup;
    for (const x of [g, ...g.props.cards]) {
      x.id = newCanvasId(ids);
      ids.add(x.id);
    }
    set([...cards, g]);
    setOpen(g.id);
    setInner(null);
  };
  /** The condition of a card or a group (`label`: what the Rotativa skips while it does not hold). */
  const condition = (c: RotatorEntry, offText: string) => (
    <ConditionField
      item={{ ...item, id: c.id, kind: isRotatorGroup(c) ? item.kind : c.kind, props: c.props as Record<string, unknown>, hidden: false, when: c.when }}
      ha={env.ha}
      values={env.values ?? []}
      raw={env.haRaw ?? {}}
      offText={offText}
      upd={(fn, merge) => {
        const x: CanvasItem = { ...item, id: c.id, kind: isRotatorGroup(c) ? item.kind : c.kind, props: c.props as Record<string, unknown>, when: c.when };
        fn(x);
        set(cards.map((y) => {
          if (y.id !== c.id) return y;
          const { when: _w, ...rest } = y;
          return (x.when ? { ...rest, when: x.when } : rest) as RotatorEntry;
        }), merge);
      }}
    />
  );
  /** The options of a group: rows or columns, its cards, its condition. */
  const groupBody = (g: RotatorGroup) => {
    const members = g.props.cards;
    const setG = (props: RotatorGroup['props'], merge?: string) => set(cards.map((y) => (y.id === g.id ? { ...g, props } : y)), merge);
    const setM = (next: RotatorMember[], merge?: string) => setG({ ...g.props, cards: next }, merge);
    const addM = (k: string) => {
      if (!k || members.length >= GROUP_MAX || left <= 0) return;
      const id = newCanvasId(taken());
      setM([...members, { id, kind: k as CanvasKind, props: canvasDefaults(k) }]);
      setInner(id);
    };
    // a small Rotativa: its cards count on the screen, so it needs room for two
    const nestOk = members.length < GROUP_MAX && left >= ROTATOR_MIN && kinds.length > 0;
    const addNest = () => {
      if (!nestOk) return;
      const ids = taken();
      const n = nestedDefaults(kinds);
      for (const x of [n, ...n.props.cards]) {
        x.id = newCanvasId(ids);
        ids.add(x.id);
      }
      setM([...members, n]);
      setInner(n.id);
    };
    return (
      <>
        <Field label={t('Colocación')} hint={t('Cada tarjeta ocupa una parte igual del hueco.')}>
          <Segmented
            value={g.props.dir}
            full
            options={[{ value: 'rows', label: t('Filas') }, { value: 'cols', label: t('Columnas') }]}
            onChange={(v) => setG({ ...g.props, dir: v })}
          />
        </Field>
        <Field label={t('Tarjetas del grupo')} hint={t('De {min} a {max} tarjetas, cada una con sus opciones.', { min: GROUP_MIN, max: GROUP_MAX })}>
          <ol class="bld-rot__list">
            {members.map((m, j) => (
              <CardRow
                key={m.id}
                label={`${j + 1}. ${t(kindName(m.kind))}`}
                icon={KIND_META[m.kind]?.icon ?? 'widget'}
                open={inner === m.id}
                first={j === 0}
                last={j === members.length - 1}
                keep={members.length <= GROUP_MIN ? t('Un grupo tiene al menos {min} tarjetas.', { min: GROUP_MIN }) : null}
                toggle={() => setInner(inner === m.id ? null : m.id)}
                move={(d) => setM(moved(members, j, d))}
                remove={() => setM(members.filter((x) => x.id !== m.id))}
              >
                <ContentFields
                  item={{ ...item, id: m.id, kind: m.kind, props: m.props }}
                  env={m.kind === 'rotator' ? { ...env, pinCard: undefined, nest: { taken } } : env}
                  put={(k, v, merge) => setM(members.map((x) => (x.id === m.id ? ({ ...x, props: { ...x.props, [k]: v } } as RotatorMember) : x)), merge)}
                />
              </CardRow>
            ))}
          </ol>
        </Field>
        {members.length < GROUP_MAX && left > 0 ? (
          <div class="bld-rot__add">
            <Select value="" options={[{ value: '', label: t('Añadir una tarjeta al grupo') }, ...kindOptions(kinds)]} onChange={addM} />
            <button type="button" class="btn btn--sm btn--ghost" disabled={!nestOk} title={!nestOk ? t('La pantalla ya tiene todas las tarjetas que caben.') : undefined} onClick={addNest}>
              <Icon name="repeat" size={15} />
              {t('Añadir una Rotativa al grupo')}
            </button>
          </div>
        ) : (
          <p class="muted small">{members.length >= GROUP_MAX ? t('El grupo ya tiene {max} tarjetas, el máximo.', { max: GROUP_MAX }) : t('La pantalla ya tiene todas las tarjetas que caben.')}</p>
        )}
        <p class="muted small">{t('Una Rotativa dentro de un grupo pasa sus tarjetas una tras otra en su parte del hueco. Dentro no puede haber grupos ni otra Rotativa.')}</p>
        {condition(g, 'Ahora la Rotativa se salta este grupo: no se cumple la condición.')}
      </>
    );
  };
  return (
    <div class="stack bld-rot">
      <Field label={t('Tarjetas')} hint={t('Se ven una tras otra en el mismo hueco, de {min} a {max}. No hace falta tocar la pantalla.', { min: ROTATOR_MIN, max: ROTATOR_MAX })}>
        <ol class="bld-rot__list">
          {cards.map((c, i) => {
            const isOpen = open === c.id;
            const group = isRotatorGroup(c);
            return (
              <CardRow
                key={c.id}
                label={`${i + 1}. ${group ? `${t('Grupo')} · ${t(c.props.dir === 'cols' ? 'Columnas' : 'Filas')}` : t(kindName(c.kind))}`}
                icon={group ? 'layout' : KIND_META[c.kind]?.icon ?? 'widget'}
                open={isOpen}
                first={i === 0}
                last={i === cards.length - 1}
                keep={cards.length <= ROTATOR_MIN ? t('Una Rotativa tiene al menos {n} tarjetas.', { n: ROTATOR_MIN }) : null}
                toggle={() => setOpen(isOpen ? null : c.id)}
                move={(d) => set(moved(cards, i, d))}
                remove={() => set(cards.filter((x) => x.id !== c.id))}
              >
                {group ? (
                  groupBody(c)
                ) : (
                  <>
                    <ContentFields
                      item={{ ...item, id: c.id, kind: c.kind, props: c.props }}
                      env={env}
                      put={(k, v, merge) => set(cards.map((x) => (x.id === c.id ? ({ ...x, props: { ...x.props, [k]: v } } as RotatorCard) : x)), merge)}
                    />
                    {condition(c, 'Ahora la Rotativa se salta esta tarjeta: no se cumple la condición.')}
                  </>
                )}
              </CardRow>
            );
          })}
        </ol>
      </Field>
      {room ? (
        <div class="bld-rot__add">
          <Select value="" options={[{ value: '', label: t('Añadir una tarjeta') }, ...kindOptions(kinds)]} onChange={add} />
          {!nest && (
            <button type="button" class="btn btn--sm btn--ghost" disabled={groupN < GROUP_MIN} title={groupN < GROUP_MIN ? t('La pantalla ya tiene todas las tarjetas que caben.') : undefined} onClick={addGroup}>
              <Icon name="layout" size={15} />
              {t('Añadir grupo')}
            </button>
          )}
        </div>
      ) : (
        <p class="muted small">{cards.length >= ROTATOR_MAX ? t('Ya tiene {n} tarjetas, el máximo.', { n: ROTATOR_MAX }) : t('La pantalla ya tiene todas las tarjetas que caben.')}</p>
      )}
      {rotatorLeaves(cards).some((c) => CANVAS_KINDS[c.kind as CanvasKind]?.controls) && <p class="muted small">{t('Las tarjetas de una Rotativa solo se ven: no se pueden tocar en la pantalla.')}</p>}
      {/* one card or another in the same place, by what happens at home (#19) */}
      <p class="muted small">
        {env.ha && !env.cloud
          ? t('Para cambiar una tarjeta por otra según Home Assistant: añade las dos y elige en cada una, en «Mostrar», cuándo se ve.')
          : t('Para cambiar una tarjeta por otra según un valor: añade las dos y elige en cada una, en «Mostrar», cuándo se ve.')}
      </p>
      {!nest && <p class="muted small">{t('Un grupo pone de {min} a {max} tarjetas en el hueco de una, en filas o en columnas, y se ve o se salta entero según su «Mostrar».', { min: GROUP_MIN, max: GROUP_MAX })}</p>}
    </div>
  );
}

/** The kinds a card may be, under their palette groups (the "Añadir" lists). */
function kindOptions(kinds: CanvasKind[]): { value: string; label: string; group: string }[] {
  return kinds.map((k) => ({ value: k, label: t(kindName(k)), group: t(GROUPS.find((g) => g.id === groupOf(k))?.name ?? '') }));
}
