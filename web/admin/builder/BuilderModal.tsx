// Personalizado, the screen builder: a near full-screen editor over Diseño. The palette is on the left, the real
// screen in the middle (Stage.tsx) and the inspector on the right; on a tablet the palette is a drawer, and on a
// phone the canvas sits on top with a bar of actions and the inspector in a bottom sheet. Everything happens on a
// copy of the screen's canvas with undo and redo; Guardar writes it into the page's draft and saves the config in one
// go. While there are unsaved changes the copy is also kept in this browser (draftStore.ts) to be recovered.
// This module and its pieces load only when the editor opens (Layout.tsx imports it on demand).
import './styles-builder.css';
import { useHaPreview } from './haPreview';
import { condOffNow } from './ConditionField';
import { scheduleOffNow } from './ScheduleField';
import { hiddenWhy, type HiddenWhy } from './hiddenWhy';
import { displayValues, useHookValues } from './valuesPreview';
import { useDataPreview } from './dataPreview';
import { api } from '../api';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CanvasConfig, CanvasItem, DisplayConfig, GlassConfig, LayoutPreset } from '../../shared/types';
import type { ScreenOrientation } from './draftStore';
import {
  CANVAS_FILE_MAX, CLOUD_CANVAS_KINDS, DEFAULT_CANVAS_KINDS, canvasFromDesign, canvasFromTemplate, defaultCanvas, exportCanvasFile, newCanvasId, startCanvasGlass,
  readCanvasFile, sanitizeCanvas, type CanvasPick,
} from '../../../server/core/canvasCore.js';
import { PICK_TEXT, pendingPicks, type PickMark } from './picks';
import { normalizeGlass } from '../../shared/glass';
import { caps, has } from '../caps';
import { useScreenUrl } from '../displayLinks';
import { choiceDialog, confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Callout, Modal, Segmented } from '../components/ui';
import { t } from '../i18n';
import { draftDisplayConfig } from '../livePreview';
import type { SectionProps } from '../sections/common';
import { allSourceOptions } from '../util';
import { clearDraft, loadDraft, pruneDrafts, saveDraft, type CanvasDraft } from './draftStore';
import { push, redo, startHistory, undo, type History } from './history';
import { Inspector, type InspectorTab } from './Inspector';
import { kindName } from './kinds';
import {
  addItem, autoPortrait, boxCells, cardCount, maxCards, duplicateItem, fitContent, editPortrait, itemOf, nudge, omittedInPortrait, placeInPortrait, placements, readOnly, removeItem,
  setCells, setSidebarSide, sideItems, sideOf, stepSize, toMain, toSide, voidIds, type MainDrop, type Orient, type Refusal, type Result,
} from './model';
import { Palette } from './Palette';
import { Stage, type AddSpec, type RectsInfo, type StageApi } from './Stage';
import { TemplatePicker, type TemplateChoice } from './TemplatePicker';

interface BState {
  cv: CanvasConfig;
  /** the screen theme a template asked for (null: unchanged) */
  theme: 'light' | 'dark' | null;
  /** the screen's glass (the default card style) */
  glass: GlassConfig;
  /** the screen's orientation (screen.orientation, the same field as the screen settings) */
  orientation: ScreenOrientation;
}

const orientationOf = (v: unknown): ScreenOrientation => (v === 'portrait' || v === 'landscape' ? v : 'auto');

const REFUSALS: Record<Refusal, string> = {
  noRoom: 'No hay sitio para este tamaño',
  noBigger: 'No hay sitio para un tamaño mayor. Haz sitio a su alrededor o elige otro tamaño.',
  sideFull: 'No cabe en la barra lateral',
  tooMany: 'Ya hay {n} widgets, el máximo en una pantalla',
  kindCap: 'No caben más widgets de este tipo en una pantalla',
  noSide: 'Este widget no puede ir en la barra lateral',
  notInSide: 'Este widget no está en la barra lateral',
  auto: 'El vertical se ordena solo. Pulsa «Editar en vertical» para moverlo a mano.',
  limit: 'Este widget no puede ser más grande ni más pequeño en ese sentido',
};

/** The canvas the frame draws while editing: cards outside their schedule are drawn too (their badge says why). */
const drawAll = (c: CanvasConfig): CanvasConfig => (c.items.some((it) => it.schedule) ? { ...c, items: c.items.map(({ schedule: _s, ...it }) => it) } : c);

/** Short hash for the draft key of a Marco Cloud household. */
function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const useMedia = (q: string) => {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
};

export function BuilderModal(props: SectionProps & { onClose: () => void; startWithTemplates: boolean; copyFrom: LayoutPreset | null }) {
  const { cfg, full, screenId } = props;
  const cloud = caps().edition === 'cloud';
  const allowed = cloud ? CLOUD_CANVAS_KINDS : DEFAULT_CANVAS_KINDS;
  const screenName = full.screens.find((s) => s.id === screenId)?.name ?? '';
  const tenant = cloud ? hashOf(`${props.me.user?.email ?? ''}|${props.me.account?.household.name ?? ''}`) : 'local';

  // a screen that is always vertical has no landscape to derive from: its portrait is edited by hand from the start
  const ownFor = (o: ScreenOrientation, c: CanvasConfig): CanvasConfig => (o === 'portrait' && c.portraitAuto ? editPortrait(c) : c);
  const initial = useMemo<BState>(() => {
    const o = orientationOf(cfg.screen.orientation);
    return { cv: ownFor(o, structuredClone(cfg.canvas ?? defaultCanvas())), theme: null, glass: normalizeGlass(cfg.screen.glass), orientation: o };
  }, []);
  const [hist, setHist] = useState<History<BState>>(() => startHistory(initial));
  const st = hist.present;
  const cv = st.cv;
  // the orientation chosen in the editor bar (Automática, Siempre horizontal, Siempre vertical)
  const fixed = st.orientation;
  const own = (c: CanvasConfig): CanvasConfig => ownFor(fixed, c);
  const [orient, setOrient] = useState<Orient>(fixed === 'portrait' ? 'portrait' : 'landscape');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>('content');
  const [preview, setPreview] = useState(false);
  const [placing, setPlacing] = useState<AddSpec | null>(null);
  const [templates, setTemplates] = useState(props.startWithTemplates);
  const [rects, setRects] = useState<RectsInfo>({ cramped: new Set(), noBlur: new Set(), empty: new Set(), need: new Map() });
  const [said, setSaid] = useState('');
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // the card of a Rotativa the inspector is editing: held on the preview (Stage posts it to the frame)
  const [pin, setPin] = useState<{ item: string; card: string } | null>(null);
  const [recover, setRecover] = useState<CanvasDraft | null>(null);
  const [panel, setPanel] = useState<'none' | 'palette' | 'inspector'>('none');
  const [sheetH, setSheetH] = useState(50);
  // cards imported from a file that still have to choose their calendars, people, entities or widget
  const [marks, setMarks] = useState<Map<string, PickMark>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);
  // other unsaved changes on the page get saved too; switching this screen to Personalizado does not count
  const [otherDirty] = useState(
    () =>
      props.dirty &&
      (() => {
        const norm = (f: typeof full) => ({
          ...f,
          screens: f.screens.map((s) => {
            if (s.id !== screenId) return s;
            const { canvas: _c, ...rest } = s;
            // the glass is saved by the editor too (and changes by itself the first time, see startCanvasGlass)
            return { ...rest, layout: { ...s.layout, preset: null }, screen: { ...s.screen, style: null, glass: null } };
          }),
        });
        return JSON.stringify(norm(full)) !== JSON.stringify(norm(props.saved));
      })(),
  );
  // the windows of the screens that show this one (their heartbeats): the frame takes the shape of the latest one of
  // each orientation, so the cells, the type and the fit of every card are the ones that screen really has
  const [seen, setSeen] = useState<{ w: number; h: number; name: string; at: number }[]>([]);
  useEffect(() => {
    let live = true;
    api.displays().then(
      (r) => {
        if (!live) return;
        const mine = r.displays.filter((d) => d.viewport && d.viewport.w >= 320 && d.viewport.h >= 320 && (d.screenId === screenId || d.showingScreenId === screenId));
        setSeen(mine.map((d) => ({ w: d.viewport!.w, h: d.viewport!.h, name: d.deviceName || d.uaShort || t('Pantalla conectada'), at: Date.parse(d.lastSeen) || 0 })).sort((a, b) => b.at - a.at));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [screenId]);
  const [frameKey, setFrameKey] = useState<string>('auto');
  const narrow = useMedia('(max-width: 1099px)');
  const phone = useMedia('(max-width: 679px)');
  const stageApi = useRef<StageApi | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const dirty = JSON.stringify(st) !== JSON.stringify(initial);
  const announce = (m: string) => setSaid(m);

  // ---- the references validation checks against: the screen's calendars, the saved widgets, the family
  const refs = useMemo(() => {
    const pool = allSourceOptions(cfg).map((s) => s.id).filter((id) => !Array.isArray(cfg.calendar.sourceIds) || cfg.calendar.sourceIds.includes(id));
    return {
      sourceIds: new Set(pool), widgets: new Map((full.widgets ?? []).map((w) => [w.id, w])), memberIds: new Set((full.family?.members ?? cfg.family?.members ?? []).map((m) => m.id)),
      screenIds: new Set((full.screens ?? []).map((x) => x.id)),
    };
  }, [cfg, full]);
  const opts = useMemo(() => ({ canvasKinds: allowed, haControls: !cloud, cameraLive: !cloud }), [cloud]);
  // values pushed by POST /api/hooks/values: the Valor card's key picker and the frame's preview
  const hookValues = useHookValues(has('valueHooks'));
  const previewValues = useMemo(() => displayValues(hookValues), [hookValues]);
  // another section of the admin (Widgets, Home Assistant): set below, once the draft helpers exist
  const goRef = useRef<(route: string) => void>(() => {});
  const fieldEnv = useMemo(() => {
    const pool = refs.sourceIds;
    return {
      sources: allSourceOptions(cfg).filter((s) => pool.has(s.id)),
      screens: (full.screens ?? []).map((x) => ({ id: x.id, name: x.name })),
      screenId,
      members: cfg.family?.members ?? [],
      todoLists: cfg.todo?.lists ?? [],
      widgets: (full.widgets ?? []).filter((w) => !(cloud && w.type === 'web')),
      go: (r: string) => goRef.current(r),
      ha: !cloud && !!full.homeassistant?.enabled,
      cloud,
      values: hookValues ?? [],
      allowed,
      pinCard: (item: string, card: string | null) => setPin((p) => (card ? { item, card } : p?.item === item ? null : p)),
    };
  }, [cfg, full, refs, hookValues]);
  // Home Assistant cards in the frame: states and points of the draft's entities (also for items not saved yet)
  const haPv = useHaPreview(cv, fieldEnv.ha);
  const dataPv = useDataPreview(cv);
  // cards a condition hides right now, from the states and values the builder has (a badge on the stage)
  const condOff = useMemo(() => new Set(cv.items.filter((it) => condOffNow(it, haPv?.raw ?? {}, hookValues ?? []) === true).map((it) => it.id)), [cv, haPv, hookValues]);
  // cards their schedule hides now (checked again every minute while the editor is open)
  const tz = cfg.datetime.timezone || 'UTC';
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const id = window.setInterval(() => setMinute(Math.floor(Date.now() / 60000)), 20000);
    return () => clearInterval(id);
  }, []);
  const schedOff = useMemo(() => new Set(cv.items.filter((it) => scheduleOffNow(it, tz)).map((it) => it.id)), [cv, tz, minute]);

  // ---- history
  const commit = (next: Partial<BState>, merge?: string) => setHist((h) => push(h, { ...h.present, ...next }, merge));
  const refuse = (why: Refusal, inWay?: string[]) => {
    let m = t(REFUSALS[why], { n: maxCards(cv) });
    if (inWay?.length) m = `${m}. ${t('En ese hueco está: {names}', { names: inWay.join(', ') })}`;
    toast(m, 'error');
    announce(m);
  };
  const apply = (r: Result, what?: string) => {
    if (!r.ok) return refuse(r.why);
    commit({ cv: r.cv });
    if (what) announce(what);
  };
  const doUndo = () => setHist((h) => (h.past.length ? (announce(t('Deshecho')), undo(h)) : h));
  const doRedo = () => setHist((h) => (h.future.length ? (announce(t('Rehecho')), redo(h)) : h));
  // an orientation undone or redone: the stage follows a fixed one
  useEffect(() => {
    if (fixed !== 'auto' && orient !== fixed) setOrient(fixed);
  }, [fixed]);
  // a selection that went away (undo, delete)
  useEffect(() => {
    if (selected && !itemOf(cv, selected)) setSelected(null);
  }, [cv, selected]);

  // ---- what the preview shows: the page's draft with this canvas on this screen
  const draftFull = useMemo(
    () => ({
      ...full,
      screens: full.screens.map((s) =>
        s.id === screenId
          ? { ...s, canvas: preview ? cv : drawAll(cv), layout: { ...s.layout, preset: 'canvas' as LayoutPreset }, screen: { ...s.screen, style: 'modern' as const, glass: st.glass, theme: st.theme ?? s.screen.theme, orientation: st.orientation } }
          : s,
      ),
    }),
    [full, st, screenId, preview],
  );
  const [live, setLive] = useState<DisplayConfig | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => setLive(draftDisplayConfig(draftFull, screenId)), 120);
    return () => clearTimeout(id);
  }, [draftFull]);
  const savedSlug = props.saved.screens.find((s) => s.id === screenId)?.slug ?? null;
  const base = useScreenUrl(props.saved, savedSlug ? screenId : null, { preview: true });
  const url = base ? `${base}${base.includes('?') ? '&' : '?'}builder=1` : null;

  // ---- drafts kept in this browser
  useEffect(() => {
    pruneDrafts();
    const d = loadDraft(tenant, screenId);
    if (d && JSON.stringify(d.canvas) !== JSON.stringify(initial.cv)) setRecover(d);
  }, []);
  const latest = useRef(st);
  latest.current = st;
  // leaving for another section closes the editor; unsaved work stays as this browser's draft, offered on return
  goRef.current = (route: string) => {
    if (dirty) {
      saveDraft(tenant, screenId, { at: Date.now(), canvas: st.cv, theme: st.theme, orientation: st.orientation });
      toast(t('Tus cambios del editor siguen aquí: al volver a abrirlo podrás recuperarlos.'), 'info', 6000);
    }
    props.onClose();
    location.hash = `#/${route}`;
  };
  useEffect(() => {
    if (!dirty) return;
    const id = window.setTimeout(() => saveDraft(tenant, screenId, { at: Date.now(), canvas: latest.current.cv, theme: latest.current.theme, orientation: latest.current.orientation }), 2000);
    return () => clearTimeout(id);
  }, [st, dirty]);

  // ---- actions
  const select = (id: string | null) => {
    setSelected(id);
    setMenu(null);
    if (id) {
      if (selected !== id) setTab('content');
      if (narrow) setPanel('inspector');
      const it = itemOf(cv, id);
      if (it) announce(`${t(kindName(it.kind))}`);
    }
  };
  /** A new or moved card took the place of cards that showed nothing: say what happened, with a way back. */
  const replaced = (rp: NonNullable<MainDrop['replace']>) => {
    const moved = rp.move.map((m) => itemOf(cv, m.id)).filter((x): x is CanvasItem => !!x);
    const parts = [
      ...(rp.remove.length ? [t('Sustituido el espacio vacío')] : []),
      ...(moved.length ? [t('{name} no mostraba nada y ha pasado al hueco libre más cercano', { name: moved.map((x) => (x.kind === 'widget' ? t('Widget') : t(kindName(x.kind)))).join(', ') })] : []),
    ];
    const m = parts.join('. ');
    toast(m, 'ok', 6000, { label: t('Deshacer'), run: doUndo });
    announce(m);
  };
  const addSpec = (spec: AddSpec) => {
    setPlacing(null);
    const r = addItem(cv, orient, spec.kind, null, spec.props, voidIds(cv, rects.empty));
    if (!r.ok) return refuse(r.why);
    commit({ cv: r.cv });
    if (r.drop?.replace) replaced(r.drop.replace);
    setSelected(r.id ?? null);
    setTab('content');
    if (phone) setPanel('none');
    announce(t('Añadido: {name}', { name: t(spec.label) }));
  };
  const remove = (id: string) => {
    const it = itemOf(cv, id);
    apply(removeItem(cv, id), it ? t('Eliminado: {name}', { name: t(kindName(it.kind)) }) : undefined);
    setSelected(null);
  };
  const duplicate = (id: string) => {
    const r = duplicateItem(cv, orient, id);
    if (!r.ok) return refuse(r.why);
    commit({ cv: r.cv });
    setSelected(r.id ?? null);
    announce(t('Duplicado'));
  };
  const toSideAct = (id: string) => apply(toSide(cv, orient, id, 99), t('Movido a la barra lateral'));
  const toMainAct = (id: string) => apply(toMain(cv, orient, id, 0, 0), t('Movido al área principal'));
  const setSidebar = async (side: CanvasConfig['sidebar']['side']) => {
    if (side === 'none' && sideItems(cv).length) {
      const v = await choiceDialog<'move' | 'delete'>({
        title: t('Quitar la barra lateral'),
        body: t('Los widgets de la barra lateral pueden pasar al área principal o borrarse.'),
        choices: [
          { value: 'delete', label: t('Borrarlos'), kind: 'ghost' },
          { value: 'move', label: t('Moverlos al área principal'), kind: 'primary' },
        ],
      });
      if (!v) return;
      return apply(setSidebarSide(cv, 'none', v));
    }
    apply(setSidebarSide(cv, side));
  };
  const pickTemplate = async (c: TemplateChoice) => {
    if (cv.items.length) {
      const ok = await confirmDialog({ title: t('¿Empezar con esta plantilla?'), body: t('Los widgets de ahora se quitan. Puedes deshacerlo.'), confirm: t('Usar la plantilla') });
      if (!ok) return;
    }
    commit({ cv: own(c.canvas), theme: c.theme ?? st.theme });
    setTemplates(false);
    setSelected(null);
    announce(t('Plantilla aplicada'));
  };
  const makeTemplate = useMemo(() => (id: string) => canvasFromTemplate(id, refs, opts), [refs, opts]);
  const current = useMemo(() => {
    if (!props.copyFrom || props.copyFrom === 'canvas' || props.copyFrom === 'widget') return null;
    const r = canvasFromDesign({ layout: { ...cfg.layout, preset: props.copyFrom }, background: cfg.background, calendar: cfg.calendar as unknown as Record<string, unknown>, datetime: cfg.datetime }, refs, opts);
    const name = { bigCalendar: 'Calendario grande', twoWeeks: 'Dos semanas', leftRight: 'Izquierda / Derecha', topBottom: 'Arriba / Abajo', agenda: 'Agenda', today: 'Hoy', people: 'Por persona', board: 'Tablero', bigTime: 'Hora grande', photoFrame: 'Marco de fotos', bedside: 'Mesilla', planner: 'Planificador', kidsRoutines: 'Rutinas', kidsFamily: 'Familia', kidsMeals: 'Semana de comidas' }[props.copyFrom as string] ?? 'Diseño';
    return { name, canvas: r.canvas, theme: r.theme };
  }, [props.copyFrom]);
  const copyTo = async (sid: string) => {
    const target = full.screens.find((s) => s.id === sid);
    if (!target) return;
    const ok = await confirmDialog({ title: t('¿Copiar a {name}?', { name: target.name }), body: t('Esa pantalla pasa a Personalizado con estos widgets. Se guarda con el resto de cambios.'), confirm: t('Copiar') });
    if (!ok) return;
    const taken = new Set<string>();
    const copy = structuredClone(cv);
    for (const it of copy.items) {
      it.id = newCanvasId(taken);
      taken.add(it.id);
    }
    props.setFull((d) => {
      const s = d.screens.find((x) => x.id === sid);
      if (!s) return;
      startCanvasGlass(s);
      s.canvas = copy;
      s.layout.preset = 'canvas';
      s.screen.style = 'modern';
    });
    toast(t('Copiado a {name}. Se guarda al pulsar Guardar.', { name: target.name }), 'ok');
  };
  // ---- one screen as a file: without this household's calendars, people, entities and widgets
  const doExport = () => {
    const file = exportCanvasFile(cv, { theme: st.theme ?? cfg.screen.theme, glass: st.glass });
    const slug = (full.screens.find((x) => x.id === screenId)?.slug || 'pantalla').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'pantalla';
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `marco-${slug}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce(t('Pantalla exportada'));
  };
  const doImport = async (f: File) => {
    if (f.size > CANVAS_FILE_MAX) return toast(t('El archivo es demasiado grande'), 'error');
    let raw: unknown;
    try {
      raw = JSON.parse(await f.text());
    } catch {
      return toast(t('Ese archivo no es una pantalla de Marco'), 'error');
    }
    const r = readCanvasFile(raw, refs, opts);
    if (!r.ok) {
      const why = r.error === 'not a Marco screen file' || r.error === 'no canvas in the file' ? t('Ese archivo no es una pantalla de Marco') : r.error === 'made by a newer version of Marco' ? t('Ese archivo es de una versión más nueva de Marco') : t('Hay un problema en el archivo: {msg}', { msg: r.error });
      return toast(why, 'error');
    }
    if (cv.items.length) {
      const ok = await confirmDialog({ title: t('¿Importar esta pantalla?'), body: t('Los widgets de ahora se quitan. Puedes deshacerlo.'), confirm: t('Importar') });
      if (!ok) return;
    }
    commit({ cv: own(r.canvas), theme: r.theme ?? st.theme, glass: r.glass ? normalizeGlass(r.glass as GlassConfig) : st.glass });
    const next = new Map<string, PickMark>();
    for (const it of r.canvas.items) {
      const cats = r.picks[it.id] as CanvasPick[] | undefined;
      if (cats?.length) next.set(it.id, { cats, props: JSON.stringify(it.props) });
    }
    setMarks(next);
    setTemplates(false);
    setSelected(null);
    const notes = [t('Pantalla importada')];
    if (next.size) notes.push(t('Elige de nuevo lo que falta en las tarjetas marcadas.'));
    if (r.dropped) notes.push(t('{n} widgets no están disponibles aquí y se han dejado fuera.', { n: r.dropped }));
    if (r.conditions) notes.push(t('Las condiciones de Home Assistant se han quitado.'));
    toast([`${notes[0]}.`, ...notes.slice(1)].join(' '), r.dropped ? 'info' : 'ok');
    announce(notes[0]);
  };

  // the screen's orientation from the editor bar: the same field as Pantalla > Orientación
  const setScreenOrientation = (o: ScreenOrientation) => {
    if (o === st.orientation) return;
    // always vertical: the portrait derived from the landscape becomes its own, so it can be edited
    commit({ orientation: o, cv: ownFor(o, cv) });
    if (o !== 'auto') setOrient(o);
    setSelected(null);
    announce(o === 'portrait' ? t('Siempre vertical') : o === 'landscape' ? t('Siempre horizontal') : t('Automática'));
  };
  const portraitEdit = (edit: boolean) => {
    commit({ cv: edit ? editPortrait(cv) : autoPortrait(cv) });
    if (edit) return setOrient('portrait');
    // back to automatic from either view: the stage shows the derived arrangement at once, and says so
    setSelected(null);
    setPlacing(null);
    const m = t('El vertical vuelve a ordenarse solo a partir del horizontal.');
    toast(m, 'ok', 6000, { label: t('Deshacer'), run: doUndo });
    announce(m);
  };

  // ---- save: validate here, write into the page's draft, then save the whole config
  const pendingSave = useRef(false);
  const doSave = async () => {
    if (saving) return;
    if (pending.size) {
      const ok = await confirmDialog({
        title: t('¿Guardar así?'),
        body: t('Algunas tarjetas importadas aún no tienen sus calendarios, personas, entidades o widget. Un widget sin elegir no se guarda.'),
        confirm: t('Guardar'),
      });
      if (!ok) return;
    }
    const errors: { path: string; msg: string }[] = [];
    sanitizeCanvas({ err: (path, msg) => errors.push({ path, msg }), warn() {} }, 'canvas', cv, refs, opts);
    if (errors.length) {
      const m = /items\[(\d+)\]/.exec(errors[0].path);
      const it = m ? cv.items[Number(m[1])] : null;
      if (it) select(it.id);
      toast(t('Hay un problema en {name}: {msg}', { name: it ? t(kindName(it.kind)) : t('la página'), msg: errors[0].msg }), 'error');
      return;
    }
    setSaving(true);
    pendingSave.current = true;
    props.set((d) => {
      d.canvas = structuredClone(cv);
      d.layout.preset = 'canvas';
      d.screen.style = 'modern';
      d.screen.glass = { ...st.glass };
      d.screen.orientation = st.orientation;
      if (st.theme) d.screen.theme = st.theme;
    });
  };
  useEffect(() => {
    if (!pendingSave.current || JSON.stringify(cfg.canvas) !== JSON.stringify(cv)) return;
    pendingSave.current = false;
    void props.save().then((ok) => {
      setSaving(false);
      if (!ok) return;
      clearDraft(tenant, screenId);
      props.onClose();
    });
  }, [cfg]);
  const close = () => {
    clearDraft(tenant, screenId);
    props.onClose();
  };

  // ---- keyboard: move, resize, delete, duplicate, undo, Escape steps back
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const tg = e.target as HTMLElement | null;
    if (tg && tg !== document.body && !root.current?.contains(tg)) return;
    const typing = !!tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') {
      e.preventDefault();
      e.stopPropagation();
      return void doSave();
    }
    // Escape steps back (menu, templates, placing, preview, panel, selection) and never closes the editor: closing
    // is the X or Cancelar, so a stray Escape cannot throw the work away
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typing) return void tg!.blur();
      if (menu) return setMenu(null);
      if (templates && cv.items.length) return setTemplates(false);
      if (placing) return setPlacing(null);
      if (preview) return setPreview(false);
      if (panel !== 'none' && narrow) return setPanel('none');
      if (selected) return setSelected(null);
      return;
    }
    if (typing) return;
    if (mod && k === 'z') {
      e.preventDefault();
      return e.shiftKey ? doRedo() : doUndo();
    }
    if (mod && k === 'y') {
      e.preventDefault();
      return doRedo();
    }
    if (!selected || preview) return;
    // Delete and Ctrl+D work wherever the focus is in the editor (not while typing): a card selected and then its
    // inspector touched is still the card being edited
    if (k === 'delete' || k === 'backspace') {
      e.preventDefault();
      return remove(selected);
    }
    if (mod && k === 'd') {
      e.preventDefault();
      return duplicate(selected);
    }
    // the arrows only when the focus is on the canvas, or nowhere in particular (elsewhere they move inside controls)
    if (tg && tg !== document.body && !tg.closest('.bld-ov') && !tg.closest('.bld-stage')) return;
    const dirs: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (dirs[k]) {
      e.preventDefault();
      const [dx, dy] = dirs[k];
      if (e.shiftKey) {
        // one cell wider or narrower (left, right), taller or shorter (down, up); the sidebar's height steps
        const p = placements(cv, orient).get(selected);
        const r = p?.zone === 'main' ? setCells(cv, orient, selected, boxCells(p, orient)[0] + dx, boxCells(p, orient)[1] + dy) : stepSize(cv, orient, selected, dx + dy > 0 ? 1 : -1);
        if (r.ok) {
          const q = placements(r.cv, orient).get(selected);
          apply(r, q?.zone === 'main' ? t('Tamaño {w}×{h}', { w: boxCells(q, orient)[0], h: boxCells(q, orient)[1] }) : t('Tamaño cambiado'));
        } else refuse(r.why);
      } else {
        const r = nudge(cv, orient, selected, dx, dy);
        if (r.ok) {
          const p = placements(r.cv, orient).get(selected);
          apply(r, p?.zone === 'main' ? t('Movido a la columna {x}, fila {y}', { x: p.x + 1, y: p.y + 1 }) : t('Movido'));
        } else refuse(r.why);
      }
      return;
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    // capture: before the modal's own Escape (which closes it) and the page's Ctrl+S
    document.addEventListener('keydown', on, true);
    return () => document.removeEventListener('keydown', on, true);
  }, []);
  // the selected card keeps the keyboard focus after a move
  useEffect(() => {
    if (!selected) return;
    const el = root.current?.querySelector<HTMLElement>(`.bld-it[data-id="${selected}"]`);
    if (el && document.activeElement !== el && (document.activeElement === document.body || document.activeElement?.classList.contains('bld-it'))) el.focus({ preventScroll: true });
  }, [selected, cv, orient]);

  // ---- the sheet on a phone: drag its grip between 30% and 90% of the height
  const onGrip = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const y0 = e.clientY;
    const h0 = sheetH;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setSheetH(Math.min(90, Math.max(30, h0 + ((y0 - ev.clientY) / innerHeight) * 100)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // every card counts, the cards inside a Rotativa too (the screen's cap, canvasCore sanitizeCanvas)
  const count = cardCount(cv);
  const crampedN = [...rects.cramped].filter((id) => itemOf(cv, id) && !itemOf(cv, id)!.hidden).length;
  const omitted = omittedInPortrait(cv);
  // what imported cards still have to choose (a badge on the stage, a line in the inspector)
  const pending = new Map<string, CanvasPick[]>();
  for (const it of cv.items) {
    const left = pendingPicks(it, marks.get(it.id));
    if (left.length) pending.set(it.id, left);
  }
  const pickBadges = new Map([...pending].map(([id, cats]) => [id, PICK_TEXT[cats[0]]]));
  // why each card is not on the screen now: a badge on the stage, a line in the inspector
  const why = new Map<string, HiddenWhy>();
  {
    const ctx = { allowed, omitted: new Set(omitted), portraitMatters: fixed !== 'landscape', schedOff, condOff, touch: cv.touch };
    for (const it of cv.items) {
      const w = hiddenWhy(it, ctx);
      if (w) why.set(it.id, w);
    }
  }
  const copyTargets = full.screens.filter((s) => s.id !== screenId).map((s) => ({ id: s.id, name: s.name }));
  const ro = readOnly(cv, orient);
  /** "Ajustar tamaño": the smallest larger box that should hold the content and has room (or say there is none) */
  const fit = (id: string) => {
    const r = fitContent(cv, orient, id, rects.need.get(id));
    if (r.ok) {
      const q = placements(r.cv, orient).get(id);
      apply(r, q?.zone === 'main' ? t('Tamaño {w}×{h}', { w: boxCells(q, orient)[0], h: boxCells(q, orient)[1] }) : t('Tamaño cambiado'));
    } else refuse(r.why);
  };
  const menuItem = menu ? itemOf(cv, menu.id) : null;
  const menuPos = menu ? placements(cv, orient).get(menu.id) : null;

  const inspector = (
    <Inspector
      cv={cv}
      glass={st.glass}
      orient={orient}
      screenOrientation={fixed}
      photoSource={{ source: cfg.background.source, stockTopic: cfg.background.stockTopic }}
      selected={selected}
      tab={tab}
      setTab={setTab}
      cramped={rects.cramped}
      noBlur={rects.noBlur}
      onFit={(id) => fit(id)}
      env={{ ...fieldEnv, cardsLeft: maxCards(cv) - count }}
      haStates={haPv?.states ?? {}}
      haRaw={haPv?.raw ?? {}}
      openMode={full.security?.displayAccess === 'open'}
      inCarousel={(full.carousels?.items ?? []).some((c) => c.steps.some((st) => st.screenId === screenId))}
      edit={(c, merge) => commit({ cv: c }, merge)}
      apply={(r) => apply(r)}
      refuse={refuse}
      setGlass={(g, merge) => commit({ glass: g }, merge)}
      setSidebar={(s) => void setSidebar(s)}
      onDuplicate={duplicate}
      onDelete={remove}
      onToSide={toSideAct}
      onToMain={toMainAct}
      onPortrait={portraitEdit}
      onPlacePortrait={(id) => apply(placeInPortrait(cv, id))}
      omitted={omitted}
      why={why}
      pending={pending}
      onPickDone={(id) => setMarks((m) => {
        const n = new Map(m);
        n.delete(id);
        return n;
      })}
      onExport={doExport}
      onImport={() => fileRef.current?.click()}
      onTemplates={() => setTemplates(true)}
      copyTargets={copyTargets}
      onCopyTo={(id) => void copyTo(id)}
      onClose={narrow ? () => (setSelected(null), setPanel('none')) : undefined}
    />
  );

  // the sizes the frame can take in this orientation: each connected window of this shape (one per size), and 16:9
  const frames = (() => {
    const out: { key: string; w: number; h: number; label: string }[] = [];
    for (const d of seen) {
      if ((d.h > d.w) !== (orient === 'portrait')) continue;
      const key = `${d.w}x${d.h}`;
      if (!out.some((x) => x.key === key)) out.push({ key, w: d.w, h: d.h, label: `${d.w}×${d.h} · ${d.name}` });
    }
    return out;
  })();
  const std = orient === 'portrait' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
  const frame = frameKey === 'std' ? null : (frames.find((f) => f.key === frameKey) ?? frames[0] ?? null);
  // a window of the 16:9 shape draws as the standard frame does (everything scales with the window)
  const frameSize = frame && Math.abs(frame.w / frame.h - std.w / std.h) > 0.01 ? { w: frame.w, h: frame.h } : null;
  const title = (
    <div class="bld-bar">
      <span class="bld-bar__title">
        {t('Editor')}
        {screenName && <span class="muted"> · {screenName}</span>}
      </span>
      <label class="bld-bar__orient">
        <span class="bld-bar__label">{t('Orientación de la pantalla')}</span>
        <select
          class="input input--sm"
          value={fixed}
          aria-label={t('Orientación de la pantalla')}
          title={t('Lo mismo que Orientación en los ajustes de la pantalla.')}
          onChange={(e) => setScreenOrientation(orientationOf((e.currentTarget as HTMLSelectElement).value))}
        >
          <option value="auto">{t('Automática')}</option>
          <option value="landscape">{t('Siempre horizontal')}</option>
          <option value="portrait">{t('Siempre vertical')}</option>
        </select>
      </label>
      {frames.length > 0 && !phone && (
        <label class="bld-bar__orient">
          <span class="bld-bar__label">{t('Ver como')}</span>
          <select
            class="input input--sm"
            value={frame ? frame.key : 'std'}
            aria-label={t('Ver como')}
            title={t('El editor dibuja la pantalla con la forma de esta ventana, para que se vea como allí.')}
            onChange={(e) => setFrameKey((e.currentTarget as HTMLSelectElement).value)}
          >
            {frames.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
            <option value="std">{orient === 'portrait' ? t('Pantalla 9:16') : t('Pantalla 16:9')}</option>
          </select>
        </label>
      )}
      {fixed === 'auto' && (
        <Segmented
          size="sm"
          value={orient}
          options={[
            { value: 'landscape' as Orient, label: phone ? '▭' : t('Horizontal'), title: t('Horizontal') },
            { value: 'portrait' as Orient, label: phone ? '▯' : t('Vertical'), title: t('Vertical') },
          ]}
          onChange={(v) => (setOrient(v), setSelected(null))}
        />
      )}
      <span class="bld-bar__group">
        <button type="button" class="icon-btn" disabled={!hist.past.length} onClick={doUndo} title={t('Deshacer')} aria-label={t('Deshacer')}>
          <Icon name="undo" size={16} />
        </button>
        <button type="button" class="icon-btn" disabled={!hist.future.length} onClick={doRedo} title={t('Rehacer')} aria-label={t('Rehacer')}>
          <Icon name="redo" size={16} />
        </button>
      </span>
      {!phone && (
        <Button size="sm" variant="ghost" icon="layout" onClick={() => setTemplates(true)}>
          {t('Plantillas')}
        </Button>
      )}
      {!phone && (
        <Button
          size="sm"
          variant={!preview && !selected && (!narrow || panel === 'inspector') ? 'primary' : 'ghost'}
          icon="settings"
          aria-pressed={!preview && !selected && (!narrow || panel === 'inspector')}
          title={t('Ajustes de la página')}
          onClick={() => {
            setPreview(false);
            setSelected(null);
            setPlacing(null);
            if (narrow) setPanel('inspector');
          }}
        >
          {t('Página')}
        </Button>
      )}
      <Button size="sm" variant={preview ? 'primary' : 'ghost'} icon="eye" onClick={() => (setPreview(!preview), setSelected(null))} aria-pressed={preview}>
        {phone ? '' : t('Vista previa')}
      </Button>
      <span class="bld-bar__end">
        {!phone && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (dirty && !(await confirmDialog({ title: t('¿Salir sin guardar?'), body: t('Los cambios del editor se perderán.'), confirm: t('Descartar'), danger: true }))) return;
              close();
            }}
          >
            {t('Cancelar')}
          </Button>
        )}
        <Button size="sm" variant="primary" loading={saving} onClick={() => void doSave()}>
          {t('Guardar')}
        </Button>
      </span>
    </div>
  );

  return (
    <Modal size="full" title={title} onClose={close} dirty={dirty} discard={{ title: t('¿Salir sin guardar?'), body: t('Los cambios del editor se perderán.') }} autoFocus={false}>
      <div class={`bld ${narrow ? 'is-narrow' : ''} ${phone ? 'is-phone' : ''} ${preview ? 'is-preview' : ''} panel-${panel}`} ref={root}>
        {(!narrow || panel === 'palette') && !preview && (
          <aside class="bld-left" aria-label={t('Añadir widgets')}>
            {narrow && (
              <div class="bld-drawer__head">
                <strong>{t('Añadir')}</strong>
                <button type="button" class="icon-btn" onClick={() => setPanel('none')} aria-label={t('Cerrar')}>
                  <Icon name="x" size={16} />
                </button>
              </div>
            )}
            <Palette
              cv={cv}
              widgets={fieldEnv.widgets}
              cloud={cloud}
              ha={fieldEnv.ha}
              allowed={allowed}
              stocks={has('stockQuotes')}
              spotify={has('spotify')}
              stage={stageApi}
              onAdd={addSpec}
              onPlace={(spec) => {
                setPlacing(spec);
                setPanel('none');
                setSelected(null);
              }}
              onLocked={(why) => toast(t(why), 'info')}
              go={fieldEnv.go}
            />
          </aside>
        )}
        <section class="bld-center">
          {recover && (
            <Callout kind="info">
              {t('Tienes cambios sin guardar de hace {n} min. ¿Recuperarlos?', { n: Math.max(1, Math.round((Date.now() - recover.at) / 60000)) })}{' '}
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const o = recover.orientation ? orientationOf(recover.orientation) : st.orientation;
                  commit({ cv: ownFor(o, recover.canvas), theme: recover.theme ?? null, orientation: o });
                  if (o !== 'auto') setOrient(o);
                  setRecover(null);
                  setTemplates(false);
                }}
              >
                {t('Recuperar')}
              </Button>{' '}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearDraft(tenant, screenId);
                  setRecover(null);
                }}
              >
                {t('Descartar')}
              </Button>
            </Callout>
          )}
          {placing && (
            <div class="bld-placing" role="status">
              <span>{t('Toca dónde quieres poner «{name}»', { name: t(placing.label) })}</span>
              <Button size="sm" onClick={() => addSpec(placing)}>
                {t('En el primer hueco')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPlacing(null)}>
                {t('Cancelar')}
              </Button>
            </div>
          )}
          {ro && !preview && (
            <div class="bld-placing bld-placing--auto" role="status">
              <span>{t('En vertical los widgets se ordenan solos a partir del horizontal.')}</span>
              <Button size="sm" onClick={() => portraitEdit(true)}>
                {t('Editar en vertical')}
              </Button>
            </div>
          )}
          {preview && (
            <div class="bld-placing" role="status">
              <span>{t('Así se ve en la pantalla. Pulsa Esc para seguir editando.')}</span>
              <Button size="sm" onClick={() => setPreview(false)}>
                {t('Seguir editando')}
              </Button>
            </div>
          )}
          <Stage
            pin={selected && pin?.item === selected ? pin : null}
            cv={cv}
            orient={orient}
            url={url}
            live={live}
            ha={haPv}
            values={previewValues}
            data={dataPv}
            why={why}
            picks={pickBadges}
            fontScale={cfg.screen.fontScale ?? 1}
            frameSize={frameSize}
            selected={selected}
            onSelect={select}
            commit={(r, what) => apply(r, what === 'add' ? t('Añadido') : what === 'size' ? t('Tamaño cambiado') : t('Movido'))}
            refuse={refuse}
            onReplaced={replaced}
            placing={placing}
            onPlaced={() => {
              setPlacing(null);
              if (phone) setPanel('none');
            }}
            preview={preview}
            apiRef={stageApi}
            onRects={setRects}
            onMenu={(id, at) => setMenu({ id, ...at })}
            onFit={(id) => {
              select(id);
              fit(id);
            }}
            onOutside={() => {
              if (placing || preview) return;
              setSelected(null);
              setMenu(null);
            }}
          />
          <div class="bld-status" role="status">
            {crampedN > 0 && (
              <span class="bld-status__warn">
                <Icon name="alert" size={13} /> {t('{n} widgets no caben enteros', { n: crampedN })}
              </span>
            )}
            <span>{t('{n} de {max} widgets', { n: count, max: maxCards(cv) })}</span>
            <span>{dirty ? t('Cambios sin guardar') : t('Sin cambios')}</span>
            {otherDirty && <span class="muted">{t('También se guardarán los cambios de otras secciones')}</span>}
          </div>
        </section>
        {!narrow && !preview && <aside class="bld-right">{inspector}</aside>}
        {narrow && panel === 'inspector' && !preview && (
          <aside class="bld-sheet" style={phone ? { height: `${sheetH}%` } : undefined}>
            {phone && <div class="bld-sheet__grip" onPointerDown={(e) => onGrip(e as unknown as PointerEvent)} aria-hidden="true" />}
            {inspector}
          </aside>
        )}
        {narrow && !preview && (
          <nav class="bld-bottom" aria-label={t('Editor')}>
            <Button size="sm" icon="plus" variant={panel === 'palette' ? 'primary' : 'default'} onClick={() => setPanel(panel === 'palette' ? 'none' : 'palette')}>
              {t('Añadir')}
            </Button>
            <Button size="sm" icon="settings" variant={panel === 'inspector' && !selected ? 'primary' : 'default'} onClick={() => (setSelected(null), setPanel(panel === 'inspector' && !selected ? 'none' : 'inspector'))}>
              {t('Página')}
            </Button>
            {phone && (
              <Button size="sm" icon="layout" onClick={() => setTemplates(true)}>
                {t('Plantillas')}
              </Button>
            )}
            <Button size="sm" icon="undo" disabled={!hist.past.length} onClick={doUndo}>
              {t('Deshacer')}
            </Button>
          </nav>
        )}
        {templates && (
          <div class="bld-tpls-wrap" onPointerDown={(e) => e.target === e.currentTarget && cv.items.length && setTemplates(false)}>
            <TemplatePicker
              make={makeTemplate}
              current={current}
              portrait={orient === 'portrait'}
              light={cfg.screen.theme === 'light'}
              ha={fieldEnv.ha}
              onPick={(c) => void pickTemplate(c)}
              onClose={() => setTemplates(false)}
            />
          </div>
        )}
        {menu && menuItem && (
          <div class="bld-menu-wrap" onPointerDown={(e) => e.target === e.currentTarget && setMenu(null)}>
            <div class="bld-menu" role="menu" style={{ left: `${Math.min(menu.x, innerWidth - 230)}px`, top: `${Math.min(menu.y, innerHeight - 220)}px` }}>
              <button type="button" role="menuitem" disabled={ro} onClick={() => (setMenu(null), duplicate(menu.id))}>
                <Icon name="copy" size={15} /> {t('Duplicar')}
              </button>
              {sideOf(cv, orient) !== 'none' && !ro && menuPos && (
                <button type="button" role="menuitem" onClick={() => (setMenu(null), menuPos.zone === 'side' ? toMainAct(menu.id) : toSideAct(menu.id))}>
                  <Icon name="layout" size={15} /> {menuPos.zone === 'side' ? t('Mover al área principal') : t('Mover a la barra lateral')}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  const c = structuredClone(cv);
                  const x = itemOf(c, menu.id)!;
                  if (x.hidden) delete x.hidden;
                  else x.hidden = true;
                  commit({ cv: c });
                }}
              >
                <Icon name={menuItem.hidden ? 'eye' : 'eyeOff'} size={15} /> {menuItem.hidden ? t('Mostrar') : t('Ocultar sin borrar')}
              </button>
              <button type="button" role="menuitem" class="is-danger" onClick={() => (setMenu(null), remove(menu.id))}>
                <Icon name="trash" size={15} /> {t('Eliminar')}
              </button>
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void doImport(f);
            e.currentTarget.value = '';
          }}
        />
        <div class="bld-sr" aria-live="polite">
          {said}
        </div>
      </div>
    </Modal>
  );
}

export default BuilderModal;
