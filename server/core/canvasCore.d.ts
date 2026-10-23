// Types for canvasCore.js (Personalizado screens), used by the admin and the display.
import type {
  CanvasCategory, CanvasCondition, CanvasConfig, RotatorGroup, RotatorNested, CanvasGlass, CanvasGridId, CanvasItem, CanvasItemStyle, CanvasKind, CanvasPos, CanvasSize, DisplayCanvas, GlassConfig, SideSpan,
} from '../../web/shared/types';

export type Orientation = 'landscape' | 'portrait';

/** Cells of the main area: 24×16 landscape, 16×24 portrait (every screen). */
export const CANVAS_GRID: { landscape: { cols: number; rows: number }; portrait: { cols: number; rows: number } };
/** The legacy grid of screens saved before 0.17 (12×8, 8×12), converted when read. */
export const LEGACY_GRID: { landscape: { cols: number; rows: number }; portrait: { cols: number; rows: number } };
/** The value canvas.grid has in every saved screen. */
export const CANVAS_GRID_ID: 'fine';
export const CANVAS_DENSITIES: ('normal' | 'compact')[];
/** Grid cells per legacy cell (2; 1 for the internal legacy unit 'normal'). */
export function gridFactor(grid?: CanvasGridId | string | null): 1 | 2;
export function gridDims(orientation?: Orientation | string, grid?: CanvasGridId | string | null): { cols: number; rows: number };
/** Always 'fine'. */
export function canvasGrid(cv?: unknown): 'fine';
/** True for a stored canvas saved on the legacy grid (no `grid`, or 'normal'). */
export function isLegacyCanvas(cv: unknown): boolean;
/** A legacy canvas with every main-grid position and box doubled (the same look) and grid 'fine'; any other as it is. */
export function upgradeCanvasGrid<T>(cv: T): T;
/** The smallest box a kind is drawn in its full look at (twice its legacy smallest), in grid cells. */
export function fullLookMin(kind: CanvasKind | string | CanvasKindDef, orientation?: Orientation | string): [number, number];
export const ROTATOR_MAX: number;
export const ROTATOR_MIN: number;
export const ROTATOR_EVERY_DEFAULT: number;
export const ROTATOR_EVERY_MIN: number;
export const ROTATOR_EVERY_MAX: number;
export function rotatorKindOk(kind: string): boolean;
/** A Rotativa's group of cards (#19): its kind, how many cards it holds, rows or columns. */
export const ROTATOR_GROUP: 'group';
export const GROUP_MIN: number;
export const GROUP_MAX: number;
export const GROUP_DIRS: ('rows' | 'cols')[];
export function isRotatorGroup(cd: unknown): cd is RotatorGroup;
/** A small Rotativa inside a group (#19). */
export function isNestedRotator(m: unknown): m is RotatorNested;
/** The cards a Rotativa's cards show: each card, and a group's cards in its place (a small Rotativa's in its). */
export function rotatorLeaves<T extends { kind: string }>(cards: readonly (T | RotatorGroup)[] | null | undefined): T[];
/** Everything of a Rotativa's cards that has an id: cards, groups, their cards, a small Rotativa and its cards. */
export function rotatorNodes(cards: readonly unknown[] | null | undefined): { id: string; kind: string; when?: CanvasCondition }[];
/** A new group (no ids yet) of cards of `kinds` with their defaults. */
export function groupDefaults(kinds?: string[], dir?: 'rows' | 'cols'): RotatorGroup;
/** Every item and, after a Rotativa, its cards as items (sharing its hiding, schedule, condition and place; a group's cards with `group`). */
export function canvasCards<T extends { id: string; kind: string; props?: Record<string, unknown> }>(items: T[] | null | undefined): (T & { parent?: string; group?: string; nest?: string })[];
export const CANVAS_SIZES: Record<CanvasSize, { landscape: [number, number]; portrait: [number, number] }>;
export const CANVAS_SIZE_IDS: CanvasSize[];
export const SIDE_SPANS: SideSpan[];
export const SIDE_UNITS: number;
export const SIDEBAR_SIDES: CanvasConfig['sidebar']['side'][];
export const SIDEBAR_SIZES: CanvasConfig['sidebar']['size'][];
export const SIDEBAR_SHARE: Record<CanvasConfig['sidebar']['size'], number>;
export const SIDEBAR_FILLS: CanvasConfig['sidebar']['fill'][];
export const CANVAS_SCRIMS: CanvasConfig['scrim'][];
export const CANVAS_BACKGROUNDS: CanvasConfig['background'][];
export const CANVAS_SURFACES: ('glass' | 'solid' | 'none')[];
export const CANVAS_RADII: ('m' | 'l' | 'xl')[];
export type CanvasLimits = { items: number; side: number; haEntities: number; liveCameras: number };
/** Caps per screen: 48 cards, 8 in the sidebar, 80 Home Assistant entities, one live camera. */
export const CANVAS_LIMITS: CanvasLimits;
/** @deprecated the same as CANVAS_LIMITS. */
export const CANVAS_LIMITS_FINE: CanvasLimits;
/** @deprecated CANVAS_LIMITS. */
export function canvasLimits(grid?: unknown): CanvasLimits;
export const CANVAS_ID_RE: RegExp;
export const HA_ENTITY_RE: RegExp;
export const VALUE_KEY_RE: RegExp;

/** Collects validation problems: errors refuse the save, warnings are fixes made on the way. */
export interface CanvasCollector {
  err(path: string, message: string): void;
  warn?(path: string, message: string): void;
}
export interface CanvasRefs {
  /** the screen's calendars (the pool calendar widgets pick from); null = any */
  sourceIds?: Set<string> | null;
  /** config.widgets by id */
  widgets?: Map<string, unknown>;
  /** family member ids */
  memberIds?: Set<string> | null;
  /** saved screen ids ("Ir a pantalla"); null = any well-formed id */
  screenIds?: Set<string> | null;
}
export interface CanvasOpts {
  canvasKinds?: readonly string[];
  haControls?: boolean;
  cameraLive?: boolean;
}

export interface CanvasKindDef {
  cat: CanvasCategory;
  sizes: CanvasSize[];
  def: CanvasSize;
  /** [min w, min h, max w, max h] in landscape cells (cellRange gives them per orientation) */
  cells: [number, number, number, number];
  /** its smallest box in grid cells (else twice its legacy minimum) */
  fine?: [number, number];
  side: boolean;
  edition: 'all' | 'local';
  feature?: string;
  perScreen?: number;
  ha?: { domains: string[]; max: number };
  controls?: boolean;
  bigType?: boolean;
  events?: boolean;
  family?: boolean;
  private?: boolean;
  reserved?: boolean;
  /** a navigation card (Navegación) */
  nav?: boolean;
  /** drawn only while the screen allows touch (canvas.touch) */
  taps?: boolean;
  /** the look a new item of this kind starts with (a Sección has no card) */
  defStyle?: Partial<CanvasItemStyle>;
  defaults(): Record<string, unknown>;
  props(c: CanvasCollector, path: string, raw: Record<string, unknown>, refs: CanvasRefs, opts: CanvasOpts): Record<string, unknown>;
}

export const CANVAS_KINDS: Record<CanvasKind, CanvasKindDef>;
export const CANVAS_KIND_IDS: CanvasKind[];
export const DEFAULT_CANVAS_KINDS: CanvasKind[];
export const CLOUD_CANVAS_KINDS: CanvasKind[];
export const CANVAS_CATEGORIES: CanvasCategory[];
export const DATA_KIND_IDS: CanvasKind[];
export const CHART_STYLES: ('below' | 'background')[];
export function currencyProps(c: { err(path: string, msg: string): void }, p: string, x: Record<string, unknown>): { pairs: { base: string; quote: string }[]; layout: "list" | "big"; range: "7d" | "30d" | "1y"; chart: "area" | "line" | "none"; chartStyle: "below" | "background" };
export const NAV_SHOW: ('both' | 'icon' | 'text')[];
export const NAV_RETURN_DEFAULT: number;
export const NAV_RETURN_MAX: number;
export const NAV_ICONS: string[];
export const NAV_HOME: 'home';
export const NAV_TAP_KINDS: CanvasKind[];
export function navTargets(screen: unknown): string[];
export function canvasDataItems(screen: unknown, opts?: { now?: Date; tz?: string }): CanvasItem[];
/** The "now playing" account ids a screen shows (its Sonando ahora cards, or screen.nowPlaying on other layouts). */
export function nowPlayingAccounts(screen: unknown, opts?: { now?: Date; tz?: string }): string[];
export const NOW_PLAYING_ACCOUNT_RE: RegExp;

type GridArg = CanvasGridId | string | null | undefined;
export function sizeCells(size: CanvasSize | string, orientation?: Orientation | string, grid?: GridArg): [number, number];
export function cellRange(kind: CanvasKind | string | CanvasKindDef, orientation?: Orientation | string, grid?: GridArg): { minW: number; minH: number; maxW: number; maxH: number };
export function posCells(pos: { size: CanvasSize | string; w?: number; h?: number } | null | undefined, orientation?: Orientation | string, grid?: GridArg): [number, number];
export function lookSize(kind: CanvasKind | string | CanvasKindDef, w: number, h: number, orientation?: Orientation | string, grid?: GridArg): CanvasSize;
export function boxOf(kind: CanvasKind | string | CanvasKindDef, w: number, h: number, orientation?: Orientation | string, grid?: GridArg): { size: CanvasSize; w?: number; h?: number };
export function boxAllowed(kind: CanvasKind | string | CanvasKindDef, w: number, h: number, orientation?: Orientation | string, grid?: GridArg): boolean;
export function canvasDefaults(kind: CanvasKind | string): Record<string, unknown>;
/** The text colour props of the clocks and the date card ("Color de la hora", "Color de la fecha"). */
export const INK_PROPS: Partial<Record<CanvasKind, readonly ('timeColor' | 'dateColor')[]>>;
export function defaultItemStyle(): CanvasItemStyle;
export function defaultCanvas(): CanvasConfig;
export function newCanvasId(taken?: Set<string>): string;
export function cssProblem(css: string): string;
export const CARD_BUILTINS: readonly ('time' | 'date' | 'weather' | 'nextEvent')[];
export function normalizeGlassJs(raw: unknown, card?: false): GlassConfig;
export function normalizeGlassJs(raw: unknown, card: true): CanvasGlass;
export const SCREEN_GLASS_DEFAULTS: Readonly<GlassConfig>;
export const CANVAS_GLASS_DEFAULTS: Readonly<GlassConfig>;
export function glassUntouched(raw: unknown): boolean;
export function startCanvasGlass(screen: { layout?: { preset?: string } | null; canvas?: { items?: unknown[] } | null; screen: { glass?: GlassConfig | null } }): boolean;
export function startCanvasGlassOnSave(prev: { screens?: unknown[] } | null | undefined, next: { screens?: unknown[] }): string[];
export function portraitSide(side: CanvasConfig['sidebar']['side']): CanvasConfig['sidebar']['side'];

export interface Occupancy { cols: number; rows: number; orientation: Orientation; grid: CanvasGridId; cells: (string | null)[][] }
export function makeOccupancy(orientation?: Orientation | string, grid?: GridArg): Occupancy;
export function fitsAt(occ: Occupancy, x: number, y: number, w: number, h: number): boolean;
export function occupy(occ: Occupancy, id: string, x: number, y: number, w: number, h: number): void;
export function nearestFree(occ: Occupancy, x: number, y: number, w: number, h: number): { x: number; y: number } | null;
export function firstFree(occ: Occupancy, w: number, h: number): { x: number; y: number } | null;

export function sanitizeCanvas(c: CanvasCollector, path: string, raw: unknown, refs?: CanvasRefs, opts?: CanvasOpts): CanvasConfig;
export const TILE_FEATURES: readonly import('../../web/shared/types').TileFeature[];
export const STAT_PERIODS: readonly ('today' | 'week' | 'month')[];
export const STAT_TYPES: readonly ('change' | 'mean' | 'min' | 'max')[];
export const CONDITION_OPS: readonly ('eq' | 'ne' | 'gt' | 'lt')[];
export function readCondition(c: CanvasCollector, path: string, raw: unknown, opts?: { ha?: boolean }): CanvasCondition | null;
export function conditionMet(when: CanvasCondition | null | undefined, raw: unknown): boolean;
type ScreenLike = { layout?: { preset?: string }; canvas?: { items?: CanvasItem[] } } | null | undefined;
export function conditionEntities(screen: ScreenLike): Set<string>;
export function conditionKeys(screen: ScreenLike): Set<string>;
export function conditionHidden(screen: ScreenLike, opts?: { ha?: (entity: string) => unknown; value?: (key: string) => unknown; isPrivate?: boolean }): Set<string>;
export const ITEM_SCHEDULE_MAX: number;
export function readSchedule(c: CanvasCollector, path: string, raw: unknown): import('../../web/shared/types').PrivacyRule[] | null;
export function scheduleOn(item: Pick<CanvasItem, 'schedule'> | null | undefined, now?: Date, tz?: string): boolean;
export function scheduleHidden(screen: ScreenLike, now?: Date, tz?: string): Set<string>;
export function scheduleNext(screen: ScreenLike, now?: Date, tz?: string): number | null;
export function haEntitiesOf(item: Pick<CanvasItem, 'kind' | 'props'>): string[];
export function itemNames(item: Pick<CanvasItem, 'kind' | 'props'>): { entity: string; name: string }[];
export function needsConfirm(domain: string, attrs?: Record<string, unknown> | null, entityId?: string, name?: string): boolean;
export function itemAliases(item: Pick<CanvasItem, 'id' | 'kind' | 'props'>): { alias: string; entity: string; slot: number }[];
export function deriveCanvasPortrait(items: Pick<CanvasItem, 'id' | 'kind' | 'pos'>[], sidebar?: CanvasConfig['sidebar'], grid?: GridArg): { placed: { id: string; pos: CanvasPos }[]; omitted: string[] };
export function projectCanvas(
  screen: { layout?: { preset?: string }; screen?: { orientation?: string }; canvas?: CanvasConfig } | null | undefined,
  opts?: { isPrivate?: boolean; canvasKinds?: readonly string[]; haControls?: boolean; members?: { id: string; calendarId: string | null }[]; screens?: { id: string; name: string }[]; trusted?: boolean; now?: Date; tz?: string },
): DisplayCanvas | null;
export function canvasWidgetIds(screen: { layout?: { preset?: string }; canvas?: CanvasConfig } | null | undefined, opts?: { now?: Date; tz?: string }): string[];
export function canvasEventsNeed(canvas: { items?: { kind: string; props?: Record<string, unknown> }[] } | null | undefined): number;

export interface CanvasTemplate {
  id: string;
  /** Spanish key of the admin dictionaries */
  name: string;
  requires?: { ha?: boolean };
  /** 'design': made from one of the existing designs (DESIGN_TEMPLATES) */
  group?: 'design';
  /** the screen theme the design is made for */
  theme?: 'light' | 'dark';
  canvas: Partial<Omit<CanvasConfig, 'items'>> & { items: { kind: CanvasKind; pos: CanvasPos; style?: Partial<CanvasItemStyle>; props?: Record<string, unknown> }[] };
}
export const CANVAS_TEMPLATES: CanvasTemplate[];
export function canvasFromTemplate(id: string, refs?: CanvasRefs, opts?: CanvasOpts): CanvasConfig;
export const DESIGN_TEMPLATES: Record<string, string>;
export function canvasFromDesign(
  screen: { layout?: { preset?: string; sidePanel?: string; sideWidth?: number }; background?: { enabled?: boolean; scope?: string }; calendar?: Record<string, unknown>; datetime?: { clock?: string } } | null | undefined,
  refs?: CanvasRefs,
  opts?: CanvasOpts,
): { canvas: CanvasConfig; theme: 'light' | 'dark' | null; template: string };

export type CanvasPick = 'calendars' | 'people' | 'entities' | 'widget' | 'screen';
export const CANVAS_FILE_FORMAT: 'marco-screen';
export const CANVAS_FILE_VERSION: number;
export const CANVAS_FILE_MAX: number;
export const CANVAS_PICKS: readonly CanvasPick[];
export interface CanvasFile {
  format: 'marco-screen';
  version: number;
  canvas: CanvasConfig;
  picks: Record<string, CanvasPick[]>;
  theme?: 'light' | 'dark';
  glass?: unknown;
}
export function exportCanvasFile(canvas: CanvasConfig, screen?: { theme?: string | null; glass?: unknown }): CanvasFile;
export function readCanvasFile(
  raw: unknown,
  refs?: CanvasRefs,
  opts?: CanvasOpts,
):
  | { ok: true; canvas: CanvasConfig; picks: Record<string, CanvasPick[]>; dropped: number; conditions: number; theme: 'light' | 'dark' | null; glass: unknown }
  | { ok: false; error: string; path?: string };
/** The kind an item is sized as (a Rotativa: the range its cards allow too). */
export function kindFor(item: { kind: string; props?: Record<string, unknown> } | null | undefined): CanvasKindDef;
/** "Tiempo en varias ciudades": a new card's places, and its layouts. */
export const CITIES_DEFAULT: { name: string; lat: number; lon: number }[];
export const CITIES_LAYOUTS: ('list' | 'grid')[];
