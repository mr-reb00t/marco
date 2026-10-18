// Inspector, Contenido tab: draws the options of each kind (fieldSpecs.ts) as one small form.
import { RotatorCards } from './RotatorFields';
import type { CanvasItem, FamilyMember, HaState, HookValueInfo, TileFeature, WidgetDef } from '../../shared/types';
import { ColorPicker, EmojiPicker, Field, NumberInput, Segmented, Select, Slider, TextInput, ToggleRow } from '../components/ui';
import { HaEntitySelect } from '../components/HaEntityPicker';
import { CANVAS_KINDS, NAV_ICONS, TILE_FEATURES } from '../../../server/core/canvasCore.js';
import { FEATURE_DOMAINS, tileFeatures } from '../../../server/core/haCore.js';
import { attrsFromSlim } from '../../shared/haGuess';
import { t } from '../i18n';
import { Icon } from '../components/icons';
import { FIELDS } from './fieldSpecs';
import { HtmlEditor } from './HtmlEditor';
import { ValueKeyInput } from './ValueKeyInput';
import { CoinsField, FollowField, PairsField, StocksKeyField, SymbolsField } from './DataPickers';
import { PlaceChoice, PlaceList } from '../components/PlaceSearch';
import { CITIES_MAX, CITIES_MIN } from '../../../server/core/weatherPlaces.js';

export interface FieldEnv {
  /** the kinds this server offers (a Rotativa picks its cards among them) */
  allowed?: readonly string[];
  /** cards the screen still takes (a Rotativa's cards count too) */
  cardsLeft?: number;
  /** a card of a Rotativa is being edited: the preview shows it and holds it (null: it turns again) */
  pinCard?: (item: string, card: string | null) => void;
  sources: { id: string; name: string; color: string; emoji: string }[];
  /** the household's screens ("Ir a pantalla"), and the one being edited */
  screens?: { id: string; name: string }[];
  screenId?: string;
  members: FamilyMember[];
  widgets: WidgetDef[];
  go: (route: string) => void;
  /** Home Assistant is on (and this is not Marco Cloud): entities can be picked */
  ha: boolean;
  /** Marco Cloud: no Home Assistant at all */
  cloud?: boolean;
  /** the states the builder fetched for the draft's Home Assistant bindings, by alias (the custom card's preview) */
  haStates?: Record<string, HaState>;
  /** values pushed by POST /api/hooks/values (valuesPreview.ts) */
  values?: HookValueInfo[];
}

const fmt = (unit: string | undefined, v: number) =>
  unit === 'min' ? (v === 0 ? t('Nunca') : t('{n} min', { n: v })) : unit === 'days' ? t('{n} días', { n: v }) : unit === 'sec' ? (v >= 60 && v % 60 === 0 ? t('{n} min', { n: v / 60 }) : t('{n} s', { n: v })) : String(v);

/** The built-in icons of the navigation cards (the display draws the same paths: widgets/canvas/nav.ts). */
const NAV_ICON_PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6',
  back: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  prev: 'm15 6-6 6 6 6',
  next: 'm9 6 6 6-6 6',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  pause: 'M8 5v14 M16 5v14',
  play: 'M7 4l13 8-13 8z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  photo: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 9.5a1.5 1.5 0 1 0 0-.01',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5',
};
const navSvg = (name: string) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={NAV_ICON_PATHS[name] ?? ''} />
  </svg>
);

/** "Icono" of a navigation card: one of the built-in icons, an emoji, or none (the card's default icon). */
function NavIconField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const builtIn = value.startsWith('i:') ? value.slice(2) : '';
  return (
    <Field label={label} hint={t('Sin icono: el de siempre (una flecha, o la casa para Inicio).')}>
      <div class="bld-navicons" role="group">
        {NAV_ICONS.map((n) => (
          <button type="button" class={`bld-chip bld-navicon ${builtIn === n ? 'is-on' : ''}`} aria-pressed={builtIn === n} aria-label={n} title={n} onClick={() => onChange(builtIn === n ? '' : `i:${n}`)}>
            {navSvg(n)}
          </button>
        ))}
        <EmojiPicker value={builtIn ? '' : value} allowNone onChange={(v) => onChange(v)} />
      </div>
    </Field>
  );
}

/** A multi-pick of chips with "all" first (null = all). */
function MultiPick({ all, items, value, onChange }: { all: string; items: { id: string; label: string; color?: string }[]; value: string[] | null; onChange: (v: string[] | null) => void }) {
  const on = (id: string) => !value || value.includes(id);
  const flip = (id: string) => {
    const cur = value ?? items.map((i) => i.id);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onChange(next.length === 0 || next.length === items.length ? null : next);
  };
  return (
    <div class="bld-chips" role="group">
      <button type="button" class={`bld-chip ${!value ? 'is-on' : ''}`} aria-pressed={!value} onClick={() => onChange(null)}>
        {t(all)}
      </button>
      {items.map((i) => (
        <button type="button" class={`bld-chip ${value && on(i.id) ? 'is-on' : ''}`} aria-pressed={!!value && on(i.id)} onClick={() => flip(i.id)}>
          {i.color && <i class="bld-chip__dot" style={{ background: i.color }} />}
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Up to four cities of the world clock (IANA time zone and a label). */
function Zones({ value, onChange }: { value: { tz: string; label: string }[]; onChange: (v: { tz: string; label: string }[]) => void }) {
  const zones = Array.isArray(value) ? value : [];
  const all = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  })();
  const put = (i: number, z: Partial<{ tz: string; label: string }>) => onChange(zones.map((x, j) => (j === i ? { ...x, ...z } : x)));
  return (
    <div class="stack bld-zones">
      <datalist id="bld-tz">
        {all.map((z) => (
          <option value={z} />
        ))}
      </datalist>
      {zones.map((z, i) => (
        <div class="bld-zone">
          <TextInput value={z.tz} list="bld-tz" placeholder="Europe/Madrid" onValue={(v) => put(i, { tz: v.trim() })} aria-label={t('Zona horaria')} />
          <TextInput value={z.label} maxLength={24} placeholder={t('Nombre')} onValue={(v) => put(i, { label: v })} aria-label={t('Nombre')} />
          <button type="button" class="icon-btn" disabled={zones.length <= 1} onClick={() => onChange(zones.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
            ×
          </button>
        </div>
      ))}
      {zones.length < 8 && (
        <button type="button" class="link-btn" onClick={() => onChange([...zones, { tz: 'UTC', label: 'UTC' }])}>
          {t('Añadir ciudad')}
        </button>
      )}
    </div>
  );
}

type Row = { entity: string; name: string; interactive: boolean };
type Series = { entity: string; label: string; color: string | null };

/** A room's rows: an entity and a name each (empty: Home Assistant's name), up to six. */
function Rows({ value, domains, env, onChange }: { value: Row[]; domains: readonly string[]; env: FieldEnv; onChange: (v: Row[]) => void }) {
  const rows = Array.isArray(value) ? value : [];
  const put = (i: number, r: Partial<Row>) => onChange(rows.map((x, j) => (j === i ? { ...x, ...r } : x)));
  return (
    <div class="stack bld-ha-list">
      {rows.map((r, i) => (
        <div class="bld-ha-item">
          <HaEntitySelect domains={domains} enabled={env.ha} value={r.entity} taken={rows.map((x) => x.entity)} onChange={(v) => put(i, { entity: v })} />
          <div class="bld-ha-line">
            <TextInput value={r.name} maxLength={40} placeholder={t('Nombre')} onValue={(v) => put(i, { name: v })} aria-label={t('Nombre')} />
            <button type="button" class="icon-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
              ×
            </button>
          </div>
        </div>
      ))}
      {rows.length < 6 && (
        <button type="button" class="link-btn" disabled={!env.ha} onClick={() => onChange([...rows, { entity: '', name: '', interactive: true }])}>
          {t('Añadir fila')}
        </button>
      )}
    </div>
  );
}

/** A chart's series: a sensor, a label and a colour each, up to four. */
function SeriesList({ value, domains, env, onChange }: { value: Series[]; domains: readonly string[]; env: FieldEnv; onChange: (v: Series[]) => void }) {
  const list = Array.isArray(value) ? value : [];
  const put = (i: number, r: Partial<Series>) => onChange(list.map((x, j) => (j === i ? { ...x, ...r } : x)));
  return (
    <div class="stack bld-ha-list">
      {list.map((r, i) => (
        <div class="bld-ha-item">
          <HaEntitySelect domains={domains} enabled={env.ha} value={r.entity} taken={list.map((x) => x.entity)} onChange={(v) => put(i, { entity: v })} />
          <div class="bld-ha-line">
            <TextInput value={r.label} maxLength={40} placeholder={t('Nombre')} onValue={(v) => put(i, { label: v })} aria-label={t('Nombre')} />
            <ColorPicker compact allowNone value={r.color} onChange={(v) => put(i, { color: v })} />
            <button type="button" class="icon-btn" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
              ×
            </button>
          </div>
        </div>
      ))}
      {list.length < 4 && (
        <button type="button" class="link-btn" disabled={!env.ha} onClick={() => onChange([...list, { entity: '', label: '', color: null }])}>
          {t('Añadir sensor')}
        </button>
      )}
    </div>
  );
}

type SceneButton = { entity: string; label: string; icon: string };

/** A scene card's buttons: a scene, script or button entity, a label and an emoji each, up to six. */
function Buttons({ value, domains, env, onChange }: { value: SceneButton[]; domains: readonly string[]; env: FieldEnv; onChange: (v: SceneButton[]) => void }) {
  const list = Array.isArray(value) ? value : [];
  const put = (i: number, r: Partial<SceneButton>) => onChange(list.map((x, j) => (j === i ? { ...x, ...r } : x)));
  return (
    <div class="stack bld-ha-list">
      {list.map((r, i) => (
        <div class="bld-ha-item">
          <HaEntitySelect domains={domains} enabled={env.ha} value={r.entity} taken={list.map((x) => x.entity)} onChange={(v) => put(i, { entity: v })} />
          <div class="bld-ha-line">
            <TextInput class="bld-ha-emoji" value={r.icon} maxLength={8} placeholder="🎬" onValue={(v) => put(i, { icon: v })} aria-label={t('Icono')} />
            <TextInput value={r.label} maxLength={40} placeholder={t('Nombre')} onValue={(v) => put(i, { label: v })} aria-label={t('Nombre')} />
            <button type="button" class="icon-btn" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
              ×
            </button>
          </div>
        </div>
      ))}
      {list.length < 6 && (
        <button type="button" class="link-btn" disabled={!env.ha} onClick={() => onChange([...list, { entity: '', label: '', icon: '' }])}>
          {t('Añadir botón')}
        </button>
      )}
    </div>
  );
}

const HVAC: { v: string; l: string }[] = [
  { v: 'off', l: 'Apagado' },
  { v: 'heat', l: 'Calor' },
  { v: 'cool', l: 'Frío' },
  { v: 'heat_cool', l: 'Calor y frío' },
  { v: 'auto', l: 'Automático' },
  { v: 'dry', l: 'Deshumidificar' },
  { v: 'fan_only', l: 'Ventilador' },
];

/** Two breakpoints for a sensor's colour, or none. */
function Thresholds({ value, onChange }: { value: [number, number] | null; onChange: (v: [number, number] | null) => void }) {
  const on = Array.isArray(value) && value.length === 2;
  const [a, b] = on ? value : [0, 0];
  const set = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) onChange([x, y]);
  };
  return (
    <div class="stack">
      <ToggleRow label={t('Usar colores')} checked={on} onChange={(v) => onChange(v ? [20, 25] : null)} />
      {on && (
        <div class="bld-ha-line">
          <NumberInput value={a} step={0.5} onValue={(v) => set(v, b)} />
          <NumberInput value={b} step={0.5} onValue={(v) => set(a, v)} />
        </div>
      )}
    </div>
  );
}

/** What each row under an Entidad card is called (t() keys). */
export const FEATURE_LABEL: Record<TileFeature, string> = {
  brightness: 'Brillo', colorTemp: 'Tono de la luz', color: 'Color', cover: 'Subir, parar y bajar', position: 'Posición',
  hvacModes: 'Modos', target: 'Temperatura', valve: 'Abrir y cerrar', select: 'Opciones', number: 'Valor', vacuum: 'Empezar, pausa y base',
  update: 'Versión', gauge: 'Barra',
};

/**
 * The rows under an Entidad card: Automático (null: the ones that suit the entity, shown as they are now) or the
 * owner's choice of up to three among those its domain can have.
 */
function Features({ value, entity, state, onChange }: { value: TileFeature[] | null; entity: string; state: HaState | null; onChange: (v: TileFeature[] | null) => void }) {
  const domain = entity.split('.')[0] || '';
  const fit = (TILE_FEATURES as readonly TileFeature[]).filter((f) => FEATURE_DOMAINS[f].includes(domain));
  const auto = value === null || value === undefined;
  const now = state && state.d !== 'unavailable' ? tileFeatures(domain, attrsFromSlim(state), {}) : [];
  const cur = Array.isArray(value) ? value : [];
  const flip = (f: TileFeature) => onChange(cur.includes(f) ? cur.filter((x) => x !== f) : cur.length >= 3 ? cur : [...cur, f]);
  if (!domain) return <p class="muted small">{t('Elige antes una entidad.')}</p>;
  if (!fit.length) return <p class="muted small">{t('Esta entidad solo muestra su estado.')}</p>;
  return (
    <div class="stack">
      <ToggleRow
        label={t('Automático')}
        hint={auto ? (now.length ? `${t('Ahora')}: ${now.map((f) => t(FEATURE_LABEL[f])).join(', ')}` : t('Nada para esta entidad.')) : undefined}
        checked={auto}
        onChange={(v) => onChange(v ? null : now.length ? now : fit.slice(0, 1))}
      />
      {!auto && (
        <div class="bld-chips" role="group">
          {fit.map((f) => (
            <button type="button" class={`bld-chip ${cur.includes(f) ? 'is-on' : ''}`} aria-pressed={cur.includes(f)} disabled={!cur.includes(f) && cur.length >= 3} onClick={() => flip(f)}>
              {t(FEATURE_LABEL[f])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Home Assistant is not on: what to do, once (Marco Cloud: not available here). */
export function HaOffNote({ env }: { env: FieldEnv }) {
  if (env.cloud) return <p class="muted small bld-note">{t('Solo en Marco instalado en casa')}</p>;
  return (
    <div class="bld-ha-off" role="note">
      <span class="bld-ha-off__icon" aria-hidden="true">
        <Icon name="home" size={18} />
      </span>
      <div class="bld-ha-off__text">
        <strong>{t('Home Assistant no está conectado')}</strong>
        <span class="muted small">{t('Conéctalo para elegir qué muestra esta tarjeta. Tus cambios del editor no se pierden.')}</span>
        <button type="button" class="btn btn--sm btn--primary bld-ha-off__go" onClick={() => env.go('homeassistant')}>
          {t('Ir a Home Assistant')}
        </button>
      </div>
    </div>
  );
}

/** The kind's own options for `item`. `put` changes one prop (`merge`: a key for undo to merge typing). */
export function ContentFields({ item, env, put }: { item: CanvasItem; env: FieldEnv; put: (k: string, v: unknown, merge?: string) => void }) {
  const specs = FIELDS[item.kind] ?? [];
  const p = item.props as Record<string, any>;
  const domains: readonly string[] = (CANVAS_KINDS[item.kind] as { ha?: { domains: string[] } } | undefined)?.ha?.domains ?? [];
  // a Home Assistant card while Home Assistant is off: one note with the way there, and no entity pickers
  const haOff = item.kind.startsWith('ha.') && !env.ha;
  const HA_ONLY = ['entity', 'rows', 'series', 'buttons', 'features'];
  return (
    <div class="stack">
      {haOff && <HaOffNote env={env} />}
      {specs.map((s) => {
        if (haOff && HA_ONLY.includes(s.type)) return null;
        if (s.type === 'html') return <HtmlEditor item={item} haOn={env.ha} states={env.haStates ?? {}} values={env.values ?? []} put={put} />;
        if (s.type === 'valueKey')
          return (
            <Field label={t(s.label)}>
              <ValueKeyInput value={String(p.key ?? '')} values={env.values ?? []} onValue={(v) => put('key', v, `${item.id}.key`)} />
            </Field>
          );
        if (s.type === 'group') return <h4 class="bld-h">{t(s.label)}</h4>;
        if (s.type === 'rotatorCards') return <RotatorCards item={item} env={env} put={put} />;
        if (s.type === 'note')
          return (
            <p class="muted small bld-note">
              {t(s.text)}{' '}
              {s.go && (
                <button type="button" class="link-btn" onClick={() => env.go(s.go!.route)}>
                  {t(s.go.label)}
                </button>
              )}
            </p>
          );
        if (s.type === 'bool') return <ToggleRow label={t(s.label)} hint={s.hint ? t(s.hint) : undefined} checked={s.k === 'showName' || s.k === 'showState' ? p[s.k] !== false : !!p[s.k]} onChange={(v) => put(s.k, v)} />;
        if (s.type === 'seg') {
          if (s.show && !s.show(p, env.widgets)) return null;
          return (
            <Field label={t(s.label)} hint={s.hint ? t(s.hint) : undefined}>
              <Segmented full value={p[s.k]} options={s.opts.map((o) => ({ value: o.v, label: t(o.l) }))} onChange={(v) => put(s.k, v)} />
            </Field>
          );
        }
        if (s.type === 'select')
          return (
            <Field label={t(s.label)} hint={s.hint ? t(s.hint) : undefined}>
              <Select value={p[s.k]} options={s.opts.map((o) => ({ value: o.v, label: t(o.l) }))} onChange={(v) => put(s.k, v)} />
            </Field>
          );
        if (s.type === 'screen') {
          const list = env.screens ?? [];
          const gone = !!p.target && p.target !== 'home' && !list.some((x) => x.id === p.target);
          return (
            <Field label={t(s.label)} hint={!p.target || gone ? t('Elige a qué pantalla lleva el botón.') : p.target === 'home' ? t('La pantalla o el carrusel que el dispositivo muestra siempre.') : undefined}>
              <Select
                value={gone ? '' : p.target ?? ''}
                options={[
                  ...(!p.target || gone ? [{ value: '', label: t('Elige una pantalla') }] : []),
                  { value: 'home', label: t('Inicio (la de siempre del dispositivo)') },
                  ...list.map((x) => ({ value: x.id, label: x.id === env.screenId ? t('{name} (esta pantalla)', { name: x.name || x.id }) : x.name || x.id })),
                ]}
                onChange={(v) => put('target', v)}
              />
            </Field>
          );
        }
        if (s.type === 'navIcon') return <NavIconField value={String(p.icon ?? '')} onChange={(v) => put('icon', v)} label={t(s.label)} />;
        if (s.type === 'num')
          return (
            <Field label={t(s.label)}>
              <Slider value={Number(p[s.k]) || s.min} min={s.min} max={s.max} step={s.step ?? 1} format={(v) => fmt(s.unit, v)} onChange={(v) => put(s.k, v, `${item.id}.${s.k}`)} />
            </Field>
          );
        if (s.type === 'sources')
          return (
            <Field label={t(s.label)} hint={env.sources.length ? undefined : t('Esta pantalla no tiene calendarios. Elígelos en Calendarios.')}>
              <MultiPick all="Todos los de esta pantalla" items={env.sources.map((x) => ({ id: x.id, label: `${x.emoji ? `${x.emoji} ` : ''}${x.name}`, color: x.color }))} value={p.sourceIds ?? null} onChange={(v) => put('sourceIds', v)} />
            </Field>
          );
        if (s.type === 'members')
          return (
            <Field label={t(s.label)} hint={env.members.length ? undefined : t('Añade a la familia en la sección Familia.')}>
              <MultiPick all="Todos" items={env.members.map((m) => ({ id: m.id, label: `${m.avatar ? `${m.avatar} ` : ''}${m.name}`, color: m.color }))} value={p.memberIds ?? null} onChange={(v) => put('memberIds', v)} />
            </Field>
          );
        if (s.type === 'member')
          return (
            <Field label={t(s.label)}>
              <Select value={p.memberId ?? ''} options={[{ value: '', label: t('Todos') }, ...env.members.map((m) => ({ value: m.id, label: m.name }))]} onChange={(v) => put('memberId', v || null)} />
            </Field>
          );
        if (s.type === 'widget')
          return (
            <Field label={t(s.label)}>
              <Select value={p.widgetId ?? ''} options={env.widgets.map((w) => ({ value: w.id, label: w.name.trim() || t('Widget sin nombre') }))} onChange={(v) => put('widgetId', v)} />
            </Field>
          );
        if (s.type === 'zones')
          return (
            <Field label={t(s.label)}>
              <Zones value={p.zones} onChange={(v) => put('zones', v, `${item.id}.zones`)} />
            </Field>
          );
        if (s.type === 'place')
          return (
            <Field label={t(s.label)}>
              <PlaceChoice value={p.place ?? null} inherit={t('Igual que la pantalla')} onChange={(v) => put('place', v)} />
            </Field>
          );
        if (s.type === 'places')
          return (
            <Field label={t(s.label)} hint={t('De {min} a {max} lugares. Una pantalla muestra como mucho 8 lugares además del suyo.', { min: CITIES_MIN, max: CITIES_MAX })}>
              <PlaceList value={p.places} min={CITIES_MIN} max={CITIES_MAX} onChange={(v) => put('places', v, `${item.id}.places`)} />
            </Field>
          );
        if (s.type === 'text')
          return (
            <Field label={t(s.label)} hint={s.hint ? t(s.hint) : undefined}>
              <TextInput value={String(p[s.k] ?? '')} maxLength={s.max} placeholder={s.placeholder ? t(s.placeholder) : undefined} onValue={(v) => put(s.k, v, `${item.id}.${s.k}`)} />
            </Field>
          );
        if (s.type === 'entity')
          return (
            <Field label={t(s.label)} hint={!env.ha ? t('Activa Home Assistant en su sección para elegir entidades.') : s.hint ? t(s.hint) : undefined}>
              <HaEntitySelect
                domains={s.domains ?? domains}
                enabled={env.ha}
                value={String(p[s.k] ?? '')}
                emptyLabel={s.optional ? t('Siempre') : undefined}
                onChange={(v) => put(s.k, s.optional ? v || null : v)}
              />
            </Field>
          );
        if (s.type === 'rows')
          return (
            <Field label={t(s.label)}>
              <Rows value={p.rows} domains={domains} env={env} onChange={(v) => put('rows', v, `${item.id}.rows`)} />
            </Field>
          );
        if (s.type === 'series')
          return (
            <Field label={t(s.label)}>
              <SeriesList value={p.series} domains={domains} env={env} onChange={(v) => put('series', v, `${item.id}.series`)} />
            </Field>
          );
        if (s.type === 'buttons')
          return (
            <Field label={t(s.label)}>
              <Buttons value={p.buttons} domains={domains} env={env} onChange={(v) => put('buttons', v, `${item.id}.buttons`)} />
            </Field>
          );
        if (s.type === 'modes') {
          // null: automático (off and the two the entity has that people use most); else the list kept, all seven
          // for a card saved before there was an automatic choice
          const cur: string[] | null = Array.isArray(p.modes) ? p.modes : null;
          const flip = (id: string) => {
            const base = cur ?? [];
            const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
            put('modes', next.length ? HVAC.map((m) => m.v).filter((m) => next.includes(m)) : null);
          };
          return (
            <Field label={t(s.label)} hint={s.hint ? t(s.hint) : undefined}>
              <div class="bld-chips" role="group">
                <button type="button" class={`bld-chip ${!cur ? 'is-on' : ''}`} aria-pressed={!cur} onClick={() => put('modes', null)}>
                  {t('Automático')}
                </button>
                {HVAC.map((m) => (
                  <button type="button" class={`bld-chip ${cur?.includes(m.v) ? 'is-on' : ''}`} aria-pressed={!!cur?.includes(m.v)} onClick={() => flip(m.v)}>
                    {t(m.l)}
                  </button>
                ))}
              </div>
            </Field>
          );
        }
        if (s.type === 'number') {
          if (s.show && !s.show(p)) return null;
          return (
            <Field label={t(s.label)} hint={s.hint ? t(s.hint) : undefined}>
              <NumberInput value={Number(p[s.k]) || 0} step={s.step ?? 1} onValue={(v) => Number.isFinite(v) && put(s.k, v, `${item.id}.${s.k}`)} />
            </Field>
          );
        }
        if (s.type === 'features')
          return (
            <Field label={t(s.label)} hint={s.hint ? t(s.hint) : undefined}>
              <Features value={(p.features ?? null) as TileFeature[] | null} entity={String(p.entity ?? '')} state={env.haStates?.[`${item.id}:0`] ?? null} onChange={(v) => put('features', v)} />
            </Field>
          );
        if (s.type === 'coins')
          return (
            <Field label={t(s.label)}>
              <CoinsField value={p.coins} onChange={(v) => put('coins', v)} />
            </Field>
          );
        if (s.type === 'follow')
          return (
            <Field label={t(s.label)}>
              <FollowField value={p.follow} onChange={(v) => put('follow', v)} />
            </Field>
          );
        if (s.type === 'symbols')
          return (
            <Field label={t(s.label)}>
              <SymbolsField value={p.symbols} onChange={(v) => put('symbols', v, `${item.id}.symbols`)} />
            </Field>
          );
        if (s.type === 'pairs')
          return (
            <Field label={t(s.label)}>
              <PairsField value={p.pairs} onChange={(v) => put('pairs', v, `${item.id}.pairs`)} />
            </Field>
          );
        if (s.type === 'stocksKey') return <StocksKeyField />;
        if (s.type === 'thresholds')
          return (
            <Field label={t(s.label)} hint={s.hint ? t(s.hint) : undefined}>
              <Thresholds value={p.thresholds ?? null} onChange={(v) => put('thresholds', v, `${item.id}.thresholds`)} />
            </Field>
          );
        return null;
      })}
    </div>
  );
}
