// The builder's inspector (right pane, a bottom sheet on a phone). With nothing selected it shows the page: the
// background, the sidebar, the default look of the cards, portrait and templates. With a widget selected it shows
// three tabs: Contenido (its own options and its title), Tamaño (the sizes it allows, the text size) and Estilo.
import type { CanvasConfig, CanvasGlass, CanvasItem, CanvasItemStyle, CanvasSize, GlassConfig, HaState, SideSpan } from '../../shared/types';
import { CANVAS_KINDS, INK_PROPS, NAV_TAP_KINDS, defaultItemStyle, type CanvasPick } from '../../../server/core/canvasCore.js';
import { normalizeGlass } from '../../shared/glass';
import { Icon } from '../components/icons';
import { Button, Callout, ColorPicker, Field, Segmented, Select, Slider, TextInput, ToggleRow } from '../components/ui';
import { t } from '../i18n';
import { GlassPreview } from '../sections/Layout';
import { ContentFields, type FieldEnv } from './fields';
import { HaControlsPanel } from './HaControlsPanel';
import { ConditionField } from './ConditionField';
import { ScheduleField } from './ScheduleField';
import { HIDDEN_TEXT, type HiddenWhy } from './hiddenWhy';
import { PICK_TEXT } from './picks';
import { KIND_META, SIZE_LABEL, SPAN_LABEL, kindName } from './kinds';
import { boxCells, cellsOf, fitSpan, gOf, grid, itemOf, placements, rangeOf, readOnly, resize, setCells, sideOf, sizesOf, sizingOf, type GridId, type Orient, type Refusal, type Result } from './model';

/** The corners the editor offers; a screen saved with the old soft corners ('m') shows the nearest, Redondeadas. */
const RADIUS_OPTS = [
  { v: 'sq', l: 'Rectas' },
  { v: 'l', l: 'Redondeadas' },
  { v: 'xl', l: 'Muy redondeadas' },
] as const;
const radiusChoice = (r: string): 'sq' | 'l' | 'xl' => (r === 'sq' || r === 'xl' ? r : 'l');

export type InspectorTab = 'content' | 'size' | 'style';

/** Deep tints that read well as glass behind white text, and two light ones for dark text. */
const TINTS = ['#1d2b4c', '#123d3a', '#24361f', '#3d2a17', '#4a1d26', '#33204a', '#e9e2d6', '#dde8f3'];

/** The surface a card really gets: its own, or the page's (none inside a glass or solid sidebar). */
function surfaceOf(cv: CanvasConfig, item: CanvasItem, zone: 'main' | 'side' | undefined): 'glass' | 'solid' | 'none' {
  if (item.kind === 'spacer') return 'none';
  if (item.style.surface !== 'inherit') return item.style.surface;
  return zone === 'side' && cv.sidebar.fill !== 'photo' ? 'none' : cv.defaults.surface;
}

const opacityWord = (v: number) => (v < 0.2 ? 'Muy transparente' : v < 0.42 ? 'Más transparente' : v <= 0.58 ? 'Equilibrado' : v <= 0.8 ? 'Más sólido' : 'Muy sólido');

/** One number with − and + (the W and H of a card's box). */
function Stepper({ label, value, min, max, onStep }: { label: string; value: number; min: number; max: number; onStep: (d: 1 | -1) => void }) {
  return (
    <div class="bld-stepper" role="group" aria-label={label}>
      <span class="bld-stepper__l">{label}</span>
      <button type="button" class="bld-stepper__b" aria-label={`${label} −`} disabled={value <= min} onClick={() => onStep(-1)}>
        −
      </button>
      <output class="bld-stepper__v" aria-live="polite">
        {value}
      </output>
      <button type="button" class="bld-stepper__b" aria-label={`${label} +`} disabled={value >= max} onClick={() => onStep(1)}>
        +
      </button>
    </div>
  );
}

/** W and H of a card's box in grid cells, within its kind's range (a preset or any box in between). */
function CellsPick({ item, cv, orient, apply, refuse }: { item: CanvasItem; cv: CanvasConfig; orient: Orient; apply: (r: Result) => void; refuse: (why: Refusal) => void }) {
  const p = placements(cv, orient).get(item.id);
  if (p?.zone !== 'main') return null;
  const G = gOf(cv);
  const [w, h] = boxCells(p, orient, G);
  const r = rangeOf(sizingOf(item), orient, G);
  const step = (dw: number, dh: number) => {
    const res = setCells(cv, orient, item.id, w + dw, h + dh);
    if (res.ok) apply(res);
    else refuse(res.why);
  };
  return (
    <div class="stack">
      <div class="bld-steppers">
        <Stepper label={t('Anchura')} value={w} min={r.minW} max={r.maxW} onStep={(d) => step(d, 0)} />
        <Stepper label={t('Altura')} value={h} min={r.minH} max={r.maxH} onStep={(d) => step(0, d)} />
      </div>
      <p class="muted small">
        {t('En cuadros de la cuadrícula. Este widget va de {min} a {max}.', { min: `${r.minW}×${r.minH}`, max: `${r.maxW}×${r.maxH}` })}
        {G === 'fine' ? ` ${t('Cuadrícula fina: cada cuadro es la mitad de uno normal.')}` : ''}
      </p>
    </div>
  );
}

/** The sizes of a kind as small rectangles to pick from. */
function SizePick({ item, cv, orient, onPick }: { item: CanvasItem; cv: CanvasConfig; orient: Orient; onPick: (s: CanvasSize) => void }) {
  const p = placements(cv, orient).get(item.id);
  // a box of its own matches no preset
  const cur = p?.zone === 'main' && p.w === undefined ? p.size : null;
  const G = gOf(cv);
  const { cols, rows } = grid(orient, G);
  return (
    <div class="bld-sizes" role="radiogroup" aria-label={t('Tamaño')}>
      {sizesOf(sizingOf(item), orient).map((sz) => {
        const [w, h] = cellsOf(sz, orient, G);
        const room = sz === cur || resize(cv, orient, item.id, sz).ok;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={sz === cur}
            class={`bld-size ${sz === cur ? 'is-on' : ''} ${room ? '' : 'is-off'}`}
            title={room ? `${t(SIZE_LABEL[sz])} · ${w}×${h}` : t('No hay sitio para este tamaño')}
            aria-disabled={room ? undefined : 'true'}
            onClick={() => room && sz !== cur && onPick(sz)}
          >
            <svg viewBox={orient === 'portrait' ? '0 0 16 24' : '0 0 24 16'} aria-hidden="true">
              <rect x="0.5" y="0.5" width={orient === 'portrait' ? 15 : 23} height={orient === 'portrait' ? 23 : 15} rx="2" fill="none" stroke="currentColor" stroke-opacity=".3" />
              <rect x="1.5" y="1.5" width={(w * (orient === 'portrait' ? 13 : 21)) / cols} height={(h * (orient === 'portrait' ? 21 : 13)) / rows} rx="1" fill="currentColor" />
            </svg>
            <span>{t(SIZE_LABEL[sz])}</span>
            <small>
              {w}×{h}
            </small>
          </button>
        );
      })}
    </div>
  );
}

export interface InspectorProps {
  cv: CanvasConfig;
  glass: GlassConfig;
  orient: Orient;
  screenOrientation: 'landscape' | 'portrait' | 'auto';
  /** where the screen's photos come from (its Fondo section): named under Foto */
  photoSource: { source: string; stockTopic: string };
  selected: string | null;
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
  cramped: Set<string>;
  /** "Ajustar tamaño" (BuilderModal: the smallest larger box with room that should hold the content) */
  onFit: (id: string) => void;
  /** cards the display draws without blur to stay fluid (the blur budget) */
  noBlur: Set<string>;
  env: FieldEnv;
  /** the states the builder fetched for the draft's Home Assistant cards, by alias (haPreview.ts) */
  haStates: Record<string, HaState>;
  /** the raw states of the draft's entities and of the ones its conditions read, by entity id (haPreview.ts) */
  haRaw: Record<string, string>;
  /** displays may open without a link or a pairing (Home Assistant controls do not work there) */
  openMode: boolean;
  /** this screen is a step of a carousel (the swipe applies) */
  inCarousel?: boolean;
  /** a new canvas from the inspector (`merge`: consecutive changes with this key are one undo step) */
  edit: (cv: CanvasConfig, merge?: string) => void;
  /** "Cuadrícula": move the screen to the normal or the fine grid (BuilderModal: converts it, says what moved) */
  onGrid: (g: GridId) => void;
  apply: (r: Result) => void;
  refuse: (why: Refusal) => void;
  setGlass: (g: GlassConfig, merge?: string) => void;
  setSidebar: (side: CanvasConfig['sidebar']['side']) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToSide: (id: string) => void;
  onToMain: (id: string) => void;
  onPortrait: (edit: boolean) => void;
  onPlacePortrait: (id: string) => void;
  omitted: string[];
  /** why a card is not on the screen right now (hiddenWhy.ts) */
  why: Map<string, HiddenWhy>;
  /** imported cards and what they still have to choose (picks.ts) */
  pending: Map<string, CanvasPick[]>;
  onPickDone: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
  onTemplates: () => void;
  copyTargets: { id: string; name: string }[];
  onCopyTo: (screenId: string) => void;
  onClose?: () => void;
}

export function Inspector(p: InspectorProps) {
  const it = itemOf(p.cv, p.selected);
  return <div class="bld-inspector">{it ? <ItemPanel {...p} item={it} /> : <PagePanel {...p} />}</div>;
}

/** The photos a Foto page shows, as the screen's Fondo section has them (an empty gallery or Immich falls back to stock). */
export function photoSourceText(b: InspectorProps['photoSource']): string {
  if (b.source === 'gallery') return t('Fotos de tu galería.');
  if (b.source === 'mixed') return t('Fotos de tu galería y de stock.');
  if (b.source === 'immich') return t('Fotos de tus álbumes de Immich.');
  const topic = b.stockTopic.trim();
  return topic ? t('Fotos de stock ({topic}).', { topic }) : t('Fotos de stock.');
}

function PagePanel(p: InspectorProps) {
  const cv = p.cv;
  const set = (fn: (c: CanvasConfig) => void, merge?: string) => {
    const c = structuredClone(cv);
    fn(c);
    p.edit(c, merge);
  };
  const g = normalizeGlass(p.glass);
  const putGlass = <K extends keyof GlassConfig>(k: K, v: GlassConfig[K]) => p.setGlass({ ...g, [k]: v }, `glass.${k}`);
  const sideOn = cv.sidebar.side !== 'none';
  const touchy = cv.items.some((i) => CANVAS_KINDS[i.kind]?.controls || CANVAS_KINDS[i.kind]?.nav) || p.inCarousel;
  const haTouchy = cv.items.some((i) => CANVAS_KINDS[i.kind]?.controls);
  const canPortrait = p.screenOrientation !== 'landscape';
  return (
    <div class="stack bld-page">
      <h4 class="bld-h">{t('Página')}</h4>
      <Field
        label={t('Cuadrícula')}
        hint={gOf(cv) === 'fine' ? t('Fina: 24×16 cuadros, para más tarjetas y más pequeñas. Al volver a Normal, cada tarjeta va al cuadro más cercano.') : t('Normal: 12×8 cuadros. Fina tiene el doble en cada sentido, para más tarjetas y más pequeñas.')}
      >
        <Segmented
          full
          value={gOf(cv)}
          options={[
            { value: 'normal', label: t('Normal') },
            { value: 'fine', label: t('Fina') },
          ]}
          onChange={(v) => v !== gOf(cv) && p.onGrid(v)}
        />
      </Field>
      <Field label={t('Densidad')} hint={t('Compacta junta más las tarjetas y deja menos margen dentro de ellas.')}>
        <Segmented
          full
          value={cv.density === 'compact' ? 'compact' : 'normal'}
          options={[
            { value: 'normal', label: t('Normal') },
            { value: 'compact', label: t('Compacta') },
          ]}
          onChange={(v) =>
            set((c) => {
              if (v === 'compact') c.density = 'compact';
              else delete c.density;
            })
          }
        />
      </Field>
      <Field
        label={t('Fondo')}
        hint={
          cv.background === 'ambient' ? (
            <>
              {t('La animación (aurora, partículas) se elige en Fondo, en Efecto ambiental.')}{' '}
              <button type="button" class="link-btn" onClick={() => p.env.go('background/bg-ambient')}>
                {t('Ir a Efecto ambiental')}
              </button>
            </>
          ) : undefined
        }
      >
        <Segmented
          full
          value={cv.background}
          options={[
            { value: 'photo', label: t('Foto') },
            { value: 'ambient', label: t('Animado') },
            { value: 'solid', label: t('Color') },
          ]}
          onChange={(v) =>
            set((c) => {
              c.background = v;
              if (v === 'photo' && c.sidebar.fill === 'photo') c.sidebar.fill = 'glass';
            })
          }
        />
      </Field>
      {cv.background === 'photo' && (
        <Field label={t('Oscurecer foto')} hint={`${photoSourceText(p.photoSource)} ${t('Se cambian en la sección Fondo de esta pantalla.')}`}>
          <Slider value={cv.dim} min={0} max={0.6} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((c) => void (c.dim = v), 'dim')} />
        </Field>
      )}
      {cv.background === 'photo' && cv.dim > 0 && (
        <Field label={t('Dónde oscurecer')}>
          <Segmented
            full
            value={cv.scrim ?? 'uniform'}
            options={[
              { value: 'uniform', label: t('Toda la foto') },
              { value: 'topBottom', label: t('Arriba y abajo') },
              { value: 'edges', label: t('Bordes') },
            ]}
            onChange={(v) => set((c) => void (c.scrim = v))}
          />
        </Field>
      )}
      {cv.background === 'solid' && (
        <Field label={t('Color del fondo')} hint={t('Sin color, el del tema de la pantalla.')}>
          <ColorPicker value={cv.color} allowNone onChange={(v) => set((c) => void (c.color = v))} />
        </Field>
      )}
      <Field label={t('Barra lateral')}>
        <Segmented
          full
          value={cv.sidebar.side}
          options={[
            { value: 'none', label: t('Ninguna') },
            { value: 'left', label: t('Izq.'), title: t('Izquierda') },
            { value: 'right', label: t('Der.'), title: t('Derecha') },
            { value: 'top', label: t('Arriba') },
            { value: 'bottom', label: t('Abajo') },
          ]}
          onChange={(v) => p.setSidebar(v)}
        />
      </Field>
      {sideOn && (
        <>
          <Field label={t('Anchura de la barra')}>
            <Segmented
              full
              value={cv.sidebar.size}
              options={[
                { value: 'narrow', label: t('Estrecha') },
                { value: 'normal', label: t('Normal') },
                { value: 'wide', label: t('Ancha') },
              ]}
              onChange={(v) => set((c) => void (c.sidebar.size = v))}
            />
          </Field>
          <Field label={t('Relleno de la barra')}>
            <Segmented
              full
              value={cv.sidebar.fill}
              options={[
                { value: 'glass', label: t('Cristal') },
                { value: 'solid', label: t('Sólida') },
                { value: 'photo', label: t('Foto'), off: cv.background === 'photo', title: cv.background === 'photo' ? t('La foto ya está de fondo en toda la pantalla.') : undefined },
              ]}
              onChange={(v) => set((c) => void (c.sidebar.fill = v))}
            />
          </Field>
        </>
      )}
      <h4 class="bld-h">{t('Estilo por defecto de las tarjetas')}</h4>
      <Field label={t('Tarjetas')}>
        <Segmented
          full
          value={cv.defaults.surface}
          options={[
            { value: 'glass', label: t('Cristal') },
            { value: 'solid', label: t('Sólida') },
            { value: 'none', label: t('Sin tarjeta') },
          ]}
          onChange={(v) => set((c) => void (c.defaults.surface = v))}
        />
      </Field>
      <Field label={t('Esquinas')}>
        <div class="bld-radius">
          <Segmented
            full
            value={radiusChoice(cv.defaults.radius)}
            options={RADIUS_OPTS.map((o) => ({ value: o.v, label: t(o.l) }))}
            onChange={(v) => set((c) => void (c.defaults.radius = v))}
          />
        </div>
      </Field>
      {cv.defaults.surface === 'glass' && (
        <div class="stack bld-glass">
          <GlassPreview glass={g} />
          <Field label={t('Transparencia')}>
            <Slider value={g.opacity} min={0} max={1} step={0.05} format={(v) => t(opacityWord(v))} onChange={(v) => putGlass('opacity', v)} />
          </Field>
          <Field label={t('Desenfoque')} hint={t('En Raspberry Pi y Fire TV se usa un fondo sólido.')}>
            <Slider value={g.blur} min={0} max={40} step={1} format={(v) => (v ? `${v}` : t('Sin desenfoque'))} onChange={(v) => putGlass('blur', v)} />
          </Field>
          <Field label={t('Tono')}>
            <Segmented
              full
              value={g.tint}
              options={[
                { value: 'light', label: t('Claro') },
                { value: 'dark', label: t('Oscuro') },
                { value: 'photo', label: t('De la foto') },
              ]}
              onChange={(v) => putGlass('tint', v)}
            />
          </Field>
          <ToggleRow label={t('Borde de luz')} checked={g.edge} onChange={(v) => putGlass('edge', v)} />
        </div>
      )}
      {/* touch: the Home Assistant controls, the Navegación buttons and the swipe (shown once one of them is useful) */}
      {(touchy || cv.touch) && (
        <>
          <ToggleRow label={t('Permitir tocar en la pantalla')} hint={t('Para los controles de Home Assistant, los botones de Navegación y deslizar entre pantallas.')} checked={cv.touch} onChange={(v) => set((c) => void (c.touch = v))} />
          {cv.touch && haTouchy && <Callout kind="warn">{t('Cualquiera que toque la pantalla podrá usar estos controles.')}</Callout>}
          {cv.touch && haTouchy && p.openMode && <Callout kind="warn">{t('En modo abierto los controles no funcionan: vincula la pantalla o ábrela con su enlace privado.')}</Callout>}
        </>
      )}
      {cv.touch && (
        <ToggleRow
          label={t('Deslizar para cambiar de pantalla')}
          hint={t('En un carrusel, deslizar el dedo a la izquierda o a la derecha pasa a la pantalla siguiente o a la anterior.')}
          checked={!!cv.swipe}
          onChange={(v) => set((c) => void (c.swipe = v))}
        />
      )}
      <Field label={t('Rendimiento')} hint={t('Ahorro quita el desenfoque y las animaciones en esta pantalla, para televisores y placas lentas.')}>
        <Segmented
          full
          value={cv.perf}
          options={[
            { value: 'auto', label: t('Automático') },
            { value: 'low', label: t('Ahorro') },
          ]}
          onChange={(v) => set((c) => void (c.perf = v))}
        />
      </Field>
      {canPortrait && (
        <>
          {/* a screen that is always vertical is edited by hand there (BuilderModal), with no automatic order */}
          {p.screenOrientation === 'auto' && (
            <>
              <h4 class="bld-h">{t('Vertical')}</h4>
              <p class="muted small">
                {cv.portraitAuto ? t('En vertical los widgets se ordenan solos a partir del horizontal.') : t('El vertical tiene su propio orden. Lo que añadas o quites vale para los dos.')}
              </p>
              <Button size="sm" onClick={() => p.onPortrait(cv.portraitAuto)}>
                {cv.portraitAuto ? t('Editar en vertical') : t('Volver a automático')}
              </Button>
            </>
          )}
          {p.omitted.length > 0 && (
            <Callout kind="warn">
              {t('No caben en vertical')}:{' '}
              {p.omitted.map((id, i) => (
                <>
                  {i > 0 && ', '}
                  {cv.portraitAuto ? (
                    t(kindName(itemOf(cv, id)?.kind ?? ''))
                  ) : (
                    <button type="button" class="link-btn" onClick={() => p.onPlacePortrait(id)}>
                      {t(kindName(itemOf(cv, id)?.kind ?? ''))}
                    </button>
                  )}
                </>
              ))}
            </Callout>
          )}
        </>
      )}
      <h4 class="bld-h">{t('Archivo')}</h4>
      <p class="muted small">{t('Guarda esta pantalla en un archivo para usarla en otra pantalla o en otro Marco. No lleva tus calendarios, personas, entidades de Home Assistant ni widgets: al importarla se eligen de nuevo.')}</p>
      <div class="bld-file">
        <Button size="sm" icon="download" onClick={p.onExport}>
          {t('Exportar esta pantalla')}
        </Button>
        <Button size="sm" icon="upload" onClick={p.onImport}>
          {t('Importar una pantalla')}
        </Button>
      </div>
      {p.pending.size > 0 && <Callout kind="warn">{t('{n} tarjetas importadas tienen que elegir algo de nuevo.', { n: p.pending.size })}</Callout>}
      <h4 class="bld-h">{t('Plantillas')}</h4>
      <Button size="sm" icon="layout" onClick={p.onTemplates}>
        {t('Volver a una plantilla')}
      </Button>
      {p.copyTargets.length > 0 && (
        <Field label={t('Copiar a otra pantalla')} hint={t('Esa pantalla pasa a Personalizado con estos widgets. Se guarda con el resto de cambios.')}>
          <Select value="" options={[{ value: '', label: t('Elige una pantalla') }, ...p.copyTargets.map((s) => ({ value: s.id, label: s.name }))]} onChange={(v) => v && p.onCopyTo(v)} />
        </Field>
      )}
    </div>
  );
}

function ItemPanel(p: InspectorProps & { item: CanvasItem }) {
  const { item, cv, orient } = p;
  const meta = KIND_META[item.kind];
  const kind = CANVAS_KINDS[item.kind];
  const pos = placements(cv, orient).get(item.id);
  const ro = readOnly(cv, orient);
  const name = item.kind === 'widget' ? (p.env.widgets.find((w) => w.id === (item.props as { widgetId?: string }).widgetId)?.name || t('Widget')) : t(kindName(item.kind));
  const upd = (fn: (it: CanvasItem) => void, merge?: string) => {
    const c = structuredClone(cv);
    const x = itemOf(c, item.id);
    if (x) fn(x);
    p.edit(c, merge);
  };
  const style = (k: keyof CanvasItemStyle, v: unknown, merge?: string) => upd((x) => void ((x.style as unknown as Record<string, unknown>)[k] = v), merge);
  const sideOn = sideOf(cv, orient) !== 'none';
  const why = p.why.get(item.id) ?? null;
  return (
    <div class="stack bld-item">
      <div class="bld-item__head">
        <span class="bld-item__icon">
          <Icon name={meta?.icon ?? 'widget'} size={18} />
        </span>
        <div>
          <h4 class="bld-h">{name}</h4>
          {meta && <p class="muted small">{t(meta.help)}</p>}
        </div>
        {p.onClose && (
          <button type="button" class="icon-btn" onClick={p.onClose} aria-label={t('Cerrar')}>
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
      {why && why !== 'orient' && (
        <Callout>
          <span class={`bld-badge bld-badge--muted bld-badge--inline bld-badge--${why}`}>{t(HIDDEN_TEXT[why].badge)}</span> {t(HIDDEN_TEXT[why].long)}
        </Callout>
      )}
      {(p.pending.get(item.id)?.length ?? 0) > 0 && (
        <Callout kind="warn">
          <span>{t('Esta tarjeta viene de un archivo. Elige de nuevo lo que es de tu casa:')}</span>
          <ul class="bld-picks">
            {p.pending.get(item.id)!.map((c) => (
              <li>{t(PICK_TEXT[c])}</li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" onClick={() => p.onPickDone(item.id)}>
            {t('Dejar así')}
          </Button>
        </Callout>
      )}
      {p.cramped.has(item.id) && !item.hidden && (
        <Callout kind="warn">
          <span>{t('El contenido no cabe entero; prueba un tamaño mayor')}</span>{' '}
          {/* one step up to the next size that has room, never over another card; nothing changes by itself */}
          {pos?.zone === 'main' && !ro && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => p.onFit(item.id)}
            >
              {t('Ajustar tamaño')}
            </Button>
          )}
        </Callout>
      )}
      {(!pos || why === 'orient') && <Callout kind="warn">{t('No cabe en vertical. Hazle sitio o ponlo más pequeño en horizontal.')}</Callout>}
      <Segmented
        full
        value={p.tab}
        options={[
          { value: 'content', label: t('Contenido') },
          { value: 'size', label: t('Tamaño') },
          { value: 'style', label: t('Estilo') },
        ]}
        onChange={p.setTab}
      />
      {p.tab === 'content' && (
        <div class="stack">
          {NAV_TAP_KINDS.includes(item.kind) && !cv.touch && (
            <Callout kind="info">
              <span>{t('Este botón no se ve en la pantalla mientras no se pueda tocar.')}</span>{' '}
              <Button size="sm" variant="ghost" onClick={() => p.edit({ ...structuredClone(cv), touch: true })}>
                {t('Permitir tocar en la pantalla')}
              </Button>
            </Callout>
          )}
          <ContentFields item={item} env={{ ...p.env, haStates: p.haStates }} put={(k, v, merge) => upd((x) => void (x.props[k] = v), merge)} />
          {p.env.ha && <HaControlsPanel item={item} cv={cv} states={p.haStates} openMode={p.openMode} upd={upd} />}
          <ConditionField item={item} ha={p.env.ha} values={p.env.values ?? []} raw={p.haRaw} upd={upd} />
          <ScheduleField item={item} upd={upd} />
          {/* a Sección is a title already: no second "Título" for its card */}
          {item.kind !== 'heading' && (
            <Field label={t('Título')}>
              <div class="bld-title">
                <TextInput value={item.style.icon} maxLength={8} placeholder="⭐" aria-label={t('Icono')} onValue={(v) => style('icon', v, `${item.id}.icon`)} />
                <TextInput value={item.style.title} maxLength={40} placeholder={t('Sin título')} onValue={(v) => style('title', v, `${item.id}.title`)} />
              </div>
            </Field>
          )}
          {item.kind !== 'heading' && (
            <ToggleRow label={t('Mostrar el título')} checked={item.style.showTitle} disabled={!item.style.title && !item.style.icon} onChange={(v) => style('showTitle', v)} />
          )}
          <ToggleRow label={t('Ocultar sin borrar')} hint={t('No se ve en la pantalla y guarda su sitio para cuando lo vuelvas a mostrar.')} checked={!!item.hidden} onChange={(v) => upd((x) => (v ? (x.hidden = true) : delete x.hidden))} />
        </div>
      )}
      {p.tab === 'size' && (
        <div class="stack">
          {ro && <p class="muted small">{t('En vertical automático los tamaños son los del horizontal.')}</p>}
          {pos?.zone === 'main' && !ro && <SizePick item={item} cv={cv} orient={orient} onPick={(sz) => p.apply(resize(cv, orient, item.id, sz))} />}
          {pos?.zone === 'main' && !ro && <CellsPick item={item} cv={cv} orient={orient} apply={p.apply} refuse={p.refuse} />}
          {pos?.zone === 'side' && !ro && (
            <Field label={t('Alto en la barra')}>
              <Segmented
                full
                value={pos.span}
                options={([2, 3, 4, 'fill'] as SideSpan[]).map((s) => ({ value: s, label: t(SPAN_LABEL[String(s)]), off: s !== pos.span && fitSpan(cv, orient, s, item.id) !== s }))}
                onChange={(v) => {
                  const c = structuredClone(cv);
                  const x = itemOf(c, item.id)!;
                  const k = orient === 'portrait' ? 'portrait' : 'pos';
                  x[k] = { ...pos, span: v };
                  p.edit(c);
                }}
              />
            </Field>
          )}
          <Field label={t('Tamaño del texto')}>
            <Slider value={item.style.scale} min={0.7} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => style('scale', Math.round(v * 20) / 20, `${item.id}.scale`)} />
          </Field>
          {!ro && pos && sideOn && kind?.side && (
            <Button size="sm" onClick={() => (pos.zone === 'side' ? p.onToMain(item.id) : p.onToSide(item.id))}>
              {pos.zone === 'side' ? t('Mover al área principal') : t('Mover a la barra lateral')}
            </Button>
          )}
        </div>
      )}
      {p.tab === 'style' && <StylePanel {...p} upd={upd} zone={pos?.zone} />}
      <div class="bld-item__foot">
        <Button size="sm" icon="copy" disabled={ro} onClick={() => p.onDuplicate(item.id)}>
          {t('Duplicar')}
        </Button>
        <Button size="sm" variant="danger" icon="trash" onClick={() => p.onDelete(item.id)}>
          {t('Eliminar')}
        </Button>
      </div>
    </div>
  );
}

function StylePanel(p: InspectorProps & { item: CanvasItem; upd: (fn: (it: CanvasItem) => void, merge?: string) => void; zone: 'main' | 'side' | undefined }) {
  const { item, upd } = p;
  const st = item.style;
  const set = (k: keyof CanvasItemStyle, v: unknown, merge?: string) => upd((x) => void ((x.style as unknown as Record<string, unknown>)[k] = v), merge);
  const surface = surfaceOf(p.cv, item, p.zone);
  // its own glass (a custom colour alone also means its own material, from the screen's glass)
  const own = st.glass ?? (st.color ? normalizeGlass(p.glass) : null);
  const putGlass = <K extends keyof CanvasGlass>(k: K, v: CanvasGlass[K]) => upd((x) => void (x.style.glass = { ...(x.style.glass ?? normalizeGlass(p.glass)), [k]: v }), `${item.id}.glass.${k}`);
  const tone = st.color ? 'custom' : own?.tint ?? 'dark';
  // the clocks' and the date's own text colours (props; none = Automático, the look they always had)
  const ink = INK_PROPS[item.kind] ?? [];
  const props = item.props as Record<string, unknown>;
  const putInk = (k: string, v: string | null) =>
    upd((x) => {
      const pr = x.props as Record<string, unknown>;
      if (v) pr[k] = v;
      else delete pr[k];
    }, `${item.id}.ink.${k}`);
  const swatches = (none: boolean) => (
    <div class="bld-tints" role="group" aria-label={t('Color')}>
      {TINTS.map((c) => (
        <button type="button" class={`swatch swatch--lg ${c === st.color?.toLowerCase() ? 'is-active' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={c === st.color?.toLowerCase()} onClick={() => set('color', c)} />
      ))}
      <ColorPicker value={st.color} compact allowNone={none} onChange={(v) => set('color', v)} />
    </div>
  );
  return (
    <div class="stack">
      <Field label={t('Tarjeta')}>
        <Segmented
          full
          value={st.surface}
          options={[
            { value: 'inherit', label: t('Como el resto') },
            { value: 'glass', label: t('Cristal') },
            { value: 'solid', label: t('Sólida') },
            { value: 'none', label: t('Sin tarjeta') },
          ]}
          onChange={(v) => set('surface', v)}
        />
      </Field>
      {surface === 'glass' && (
        <>
          <ToggleRow
            label={t('Igual que el resto')}
            hint={t('Apágalo para darle a esta tarjeta su propio cristal.')}
            checked={!own && !st.color}
            onChange={(v) =>
              upd((x) => {
                x.style.glass = v ? null : { ...normalizeGlass(p.glass) };
                if (v) x.style.color = null;
              })
            }
          />
          {(p.noBlur.has(item.id) || (p.cv.perf === 'low' && surface === 'glass')) && <Callout>{t('En pantallas lentas se muestra sin desenfoque')}</Callout>}
          {own && (
            <div class="stack bld-glass">
              <GlassPreview glass={normalizeGlass({ ...own, tint: own.tint === 'auto' ? 'dark' : own.tint } as GlassConfig)} />
              <Field label={t('Transparencia')}>
                <Slider value={own.opacity} min={0} max={1} step={0.05} format={(v) => t(opacityWord(v))} onChange={(v) => putGlass('opacity', v)} />
              </Field>
              <Field label={t('Desenfoque')} hint={t('En Raspberry Pi y Fire TV se usa un fondo sólido.')}>
                <Slider value={own.blur} min={0} max={40} step={1} format={(v) => (v ? `${v}` : t('Sin desenfoque'))} onChange={(v) => putGlass('blur', v)} />
              </Field>
              <Field label={t('Tono')} hint={tone === 'auto' ? t('Claro u oscuro según la parte de la foto que queda detrás.') : undefined}>
                <Select
                  value={tone}
                  options={[
                    { value: 'auto', label: t('Automático') },
                    { value: 'dark', label: t('Oscuro') },
                    { value: 'light', label: t('Claro') },
                    { value: 'photo', label: t('De la foto') },
                    { value: 'custom', label: t('Personalizado') },
                  ]}
                  onChange={(v) =>
                    upd((x) => {
                      const g = x.style.glass ?? normalizeGlass(p.glass);
                      if (v === 'custom') x.style.color = x.style.color ?? TINTS[0];
                      else {
                        x.style.color = null;
                        x.style.glass = { ...g, tint: v as CanvasGlass['tint'] };
                      }
                    })
                  }
                />
              </Field>
              {tone === 'custom' && swatches(false)}
              <ToggleRow label={t('Borde de luz')} checked={own.edge} onChange={(v) => putGlass('edge', v)} />
            </div>
          )}
        </>
      )}
      {surface === 'solid' && (
        <Field label={t('Color de la tarjeta')} hint={st.color ? undefined : t('Sin color, el de las demás tarjetas.')}>
          {swatches(true)}
        </Field>
      )}
      <Field label={t('Esquinas')}>
        <Select
          value={st.radius === 'inherit' ? 'inherit' : radiusChoice(st.radius)}
          options={[{ value: 'inherit', label: t('Como el resto') }, ...RADIUS_OPTS.map((o) => ({ value: o.v, label: t(o.l) }))]}
          onChange={(v) => set('radius', v)}
        />
      </Field>
      <Field label={t('Color de acento')} hint={st.accent ? undefined : t('Sin color, el de la pantalla.')}>
        <ColorPicker value={st.accent} allowNone onChange={(v) => set('accent', v)} />
      </Field>
      {ink.map((k) => {
        const v = typeof props[k] === 'string' ? (props[k] as string) : null;
        // the date card's weekday takes it too, unless the card has its own accent colour
        const hint = !v
          ? t('Automático: el color de siempre.')
          : item.kind === 'date'
            ? st.accent
              ? t('El día de la semana sigue con el color de acento.')
              : t('También el día de la semana, mientras la tarjeta no tenga color de acento.')
            : undefined;
        return (
          <Field label={k === 'timeColor' ? t('Color de la hora') : t('Color de la fecha')} hint={hint}>
            <ColorPicker value={v} allowNone onChange={(c) => putInk(k, c)} />
          </Field>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          upd((x) => {
            x.style = { ...(defaultItemStyle() as CanvasItemStyle), title: x.style.title, icon: x.style.icon, showTitle: x.style.showTitle, scale: x.style.scale };
            for (const k of ink) delete (x.props as Record<string, unknown>)[k];
          })
        }
      >
        {t('Restablecer estilo')}
      </Button>
    </div>
  );
}
