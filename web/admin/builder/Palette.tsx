// The builder's palette: every widget kind by category, the owner's saved widgets ("Mis widgets") and a search.
// A tile is added by dragging it onto the canvas (mouse, pen), by a click or Enter (first free spot), or on a touch
// screen by a tap that starts "modo colocar" (the next tap on the canvas places it). Kinds this server cannot use
// are shown locked, with the reason. Kinds this edition does not have at all (Marco Cloud: Home Assistant, HTML
// propio) get no tile: their names are listed muted with "Solo en la versión instalada en casa", and a group made only
// of them (Casa) stays folded with that badge.
import { useMemo, useRef, useState } from 'preact/hooks';
import type { CanvasConfig, CanvasKind, WidgetDef } from '../../shared/types';
import { CANVAS_KINDS } from '../../../server/core/canvasCore.js';
import { Icon } from '../components/icons';
import { SearchInput } from '../components/ui';
import { t } from '../i18n';
import { gesture } from './dnd';
import { AWAY_NOTE, GROUPS, KIND_META, PALETTE_KINDS, groupOf, lockOf, matchesSearch, outOfEdition, type PaletteGroup } from './kinds';
import { cellsOf } from './model';
import type { AddSpec, StageApi } from './Stage';
import { colorOfKind } from './thumb';

interface Tile {
  key: string;
  spec: AddSpec;
  name: string;
  help: string;
  icon: string;
  group: PaletteGroup;
  lock: string | null;
  /** not in this edition: no tile, only its name muted */
  away: boolean;
}

/** The default size of a kind, drawn on a tiny 12×8 grid. */
function MiniSize({ kind }: { kind: CanvasKind }) {
  const d = CANVAS_KINDS[kind];
  const [w, h] = cellsOf(d.def, 'landscape');
  return (
    <svg viewBox="0 0 24 16" class="bld-tile__mini" aria-hidden="true">
      <rect x="0.5" y="0.5" width="23" height="15" rx="2" fill="none" stroke="currentColor" stroke-opacity=".3" />
      <rect x="1.5" y="1.5" width={Math.max(2, w * 1.75)} height={Math.max(2, h * 1.6)} rx="1" fill={colorOfKind(kind)} fill-opacity=".8" />
    </svg>
  );
}

export function Palette(props: {
  cv: CanvasConfig;
  widgets: WidgetDef[];
  cloud: boolean;
  /** Home Assistant is on (self-hosted): else the Casa group says what its cards need */
  ha?: boolean;
  allowed: readonly string[];
  /** false: Bolsa cannot get quotes here (no stockQuotes feature) */
  stocks?: boolean;
  stage: { current: StageApi | null };
  /** add at the first free spot */
  onAdd: (spec: AddSpec) => void;
  /** touch: start "modo colocar" */
  onPlace: (spec: AddSpec) => void;
  onLocked: (reason: string) => void;
  go: (route: string) => void;
}) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<PaletteGroup>>(new Set());
  const chip = useRef<HTMLDivElement>(null);
  const photoBg = props.cv.background === 'photo';

  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];
    for (const k of PALETTE_KINDS) {
      // a photo card over a photo background makes no sense
      if (k === 'photo' && photoBg) continue;
      const m = KIND_META[k]!;
      out.push({ key: k, spec: { kind: k, label: m.name }, name: m.name, help: m.help, icon: m.icon, group: groupOf(k), lock: lockOf(k, props), away: outOfEdition(k, props) });
    }
    for (const w of props.widgets) {
      const name = w.name.trim() || t('Widget sin nombre');
      const lock = props.cloud && w.type === 'web' ? 'Solo en Marco instalado en casa' : lockOf('widget', props);
      out.push({
        key: `w:${w.id}`, spec: { kind: 'widget', props: { widgetId: w.id }, label: name }, name, help: w.type === 'prices' ? 'Precio de la luz' : w.type === 'currency' ? 'Divisas' : w.type === 'web' ? 'Página web' : 'Imagen',
        icon: w.type === 'prices' ? 'zap' : w.type === 'currency' ? 'exchange' : w.type === 'web' ? 'globe' : 'image', group: 'mine', lock, away: props.cloud && w.type === 'web',
      });
    }
    return out;
  }, [props.widgets, props.cloud, props.allowed, props.stocks, photoBg]);

  const nq = q.trim();
  const shown = nq ? tiles.filter((x) => matchesSearch(nq, { kind: x.spec.kind, name: x.name, help: x.help, group: x.group }, t)) : tiles;

  const onDown = (e: PointerEvent, tile: Tile) => {
    if (tile.lock) return;
    const el = e.currentTarget as HTMLElement;
    // touch: a tap starts "modo colocar" (the palette scrolls, so no drag from here)
    if (e.pointerType === 'touch') {
      // a press held still is the same as a tap (people try to drag from here): it starts "modo colocar" too
      gesture(e, el, { longPress: true, onTap: () => props.onPlace(tile.spec), onStart: () => (props.onPlace(tile.spec), false), onMove: () => {}, onEnd: () => {}, onCancel: () => {} });
      return;
    }
    gesture(e, el, {
      longPress: false,
      onTap: () => props.onAdd(tile.spec),
      onStart: () => {
        const c = chip.current;
        if (c) {
          c.textContent = t(tile.name);
          c.hidden = false;
        }
        return true;
      },
      onMove: (ev) => {
        const c = chip.current;
        if (c) c.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
        props.stage.current?.hover(tile.spec, ev.clientX, ev.clientY);
      },
      onEnd: (ev) => {
        if (chip.current) chip.current.hidden = true;
        props.stage.current?.drop(tile.spec, ev.clientX, ev.clientY);
      },
      onCancel: () => {
        if (chip.current) chip.current.hidden = true;
        props.stage.current?.leave();
      },
    });
  };

  const groups = GROUPS.map((g) => {
    const all = shown.filter((x) => x.group === g.id);
    return { ...g, tiles: all.filter((x) => !x.away), away: all.filter((x) => x.away) };
  }).filter((g) => g.tiles.length || g.away.length || (g.id === 'mine' && !nq));
  /** the muted names of the kinds this edition does not have */
  const awayLine = (list: Tile[]) => (
    <p class="bld-away">
      <Icon name="lock" size={13} />
      <span class="bld-away__names">{list.map((x) => t(x.name)).join(', ')}</span>
      <span class="bld-away__badge">{t(AWAY_NOTE)}</span>
    </p>
  );
  return (
    <div class="bld-palette">
      <SearchInput value={q} onValue={setQ} placeholder={t('Buscar widgets')} />
      <div class="bld-palette__list">
        {groups.map((g) => {
          // a group with nothing this edition has (Casa on Marco Cloud): folded, with the badge; a search lists the
          // names it matched, still muted
          if (!g.tiles.length && g.away.length) {
            return (
              <section class="bld-group is-away">
                <div class="bld-group__head bld-group__head--away">
                  <Icon name={g.icon} size={15} />
                  <span>{t(g.name)}</span>
                  <Icon name="lock" size={13} class="bld-group__chev" />
                </div>
                <div class="bld-group__tiles">
                  {nq ? awayLine(g.away) : (
                    <p class="bld-away">
                      <span class="bld-away__badge">{t(AWAY_NOTE)}</span>
                    </p>
                  )}
                </div>
              </section>
            );
          }
          const open = !!nq || !closed.has(g.id);
          return (
            <section class="bld-group">
              <button
                type="button"
                class="bld-group__head"
                aria-expanded={open}
                onClick={() => setClosed((s) => {
                  const n = new Set(s);
                  if (n.has(g.id)) n.delete(g.id);
                  else n.add(g.id);
                  return n;
                })}
              >
                <Icon name={g.icon} size={15} />
                <span>{t(g.name)}</span>
                <Icon name="chevron" size={14} class={`bld-group__chev ${open ? 'is-open' : ''}`} />
              </button>
              {open && (
                <div class="bld-group__tiles">
                  {g.id === 'home' && !props.cloud && props.ha === false && (
                    <p class="muted small bld-note bld-group__note">
                      {t('Estas tarjetas necesitan Home Assistant, que ahora está desactivado.')}{' '}
                      <button type="button" class="link-btn" onClick={() => props.go('homeassistant')}>
                        {t('Ir a Home Assistant')}
                      </button>
                    </p>
                  )}
                  {g.id === 'mine' && !g.tiles.length && (
                    <p class="muted small bld-note">
                      {t('Aquí salen las imágenes, páginas y precios que crees en Widgets.')}{' '}
                      <button type="button" class="link-btn" onClick={() => props.go('widgets')}>
                        {t('Ir a Widgets')}
                      </button>
                    </p>
                  )}
                  {g.tiles.map((x) => (
                    <button
                      type="button"
                      class={`bld-tile ${x.lock ? 'is-locked' : ''}`}
                      aria-disabled={x.lock ? 'true' : undefined}
                      title={x.lock ? t(x.lock) : t(x.help)}
                      onPointerDown={(e) => onDown(e as unknown as PointerEvent, x)}
                      onClick={(e) => {
                        // the keyboard (Enter, Space) and the locked tiles; pointer taps go through onDown
                        if (x.lock) return props.onLocked(x.lock);
                        if (e.detail === 0) props.onAdd(x.spec);
                      }}
                    >
                      <span class="bld-tile__icon" style={{ color: colorOfKind(x.spec.kind) }}>
                        <Icon name={x.lock ? 'lock' : (x.icon as any)} size={17} />
                      </span>
                      <span class="bld-tile__text">
                        <span class="bld-tile__name">{t(x.name)}</span>
                        <span class="bld-tile__help">{x.lock ? t(x.lock) : t(x.help)}</span>
                      </span>
                      {x.spec.kind !== 'widget' && <MiniSize kind={x.spec.kind} />}
                    </button>
                  ))}
                  {!!g.away.length && awayLine(g.away)}
                </div>
              )}
            </section>
          );
        })}
        {!groups.length && <p class="muted small bld-note">{t('Ningún widget se llama así.')}</p>}
      </div>
      <div class="bld-dragchip" ref={chip} hidden aria-hidden="true" />
    </div>
  );
}
