// Contracts between the Personalizado controller (widgets/canvas.ts) and its widget adapters (widgets/canvas/*.ts).
import type { Announcement, DisplayCanvasItem, DisplayConfig, FamilyDisplayState } from '../../../shared/types';
import type { NEvent } from '../../eventModel';
import type { Tick } from '../../time';
import type { HaSource } from '../../haFeed';
import type { ValueSource } from '../../valuesFeed';
import type { DataSource } from '../../dataFeed';

/** Data topics an adapter can be told about. */
export type CanvasTopic = 'events' | 'weather' | 'news' | 'countdowns' | 'photos' | 'family' | 'announcements' | 'config' | 'ha' | 'values' | 'data' | 'nav';

/** The family data as the kids layouts get it (main.ts): today's state, and whether taps check routines off now. */
export interface FamilyView {
  /** null: Familia is off, or the data has not come yet */
  state: FamilyDisplayState | null;
  /** the screen allows taps, the server answers, the screen is not private and this is not the admin's preview */
  touch: boolean;
}

/** Where the carousel of this display is (the progress card). Times in the display's server clock (`now`). */
export interface NavProgress {
  steps: { name: string }[];
  /** the step on display (-1: a screen outside the carousel) */
  index: number;
  startsAt: number | null;
  endsAt: number | null;
  paused: boolean;
  /** a screen outside the carousel is on (shown by touch) */
  visiting: boolean;
  now: number;
}

/** The navigation cards' side of the display (main.ts, web/display/nav.ts). */
export interface NavSource {
  /** the buttons are drawn: the screen allows touch (canvas.taps), or this is the admin's preview */
  shows(): boolean;
  /** a tap does something: touch allowed and not the preview */
  live(): boolean;
  /** this display runs a carousel */
  carousel(): boolean;
  /** "Ir a pantalla": a screen id or 'home'; `returnMin` = "Volver solo tras" */
  go(target: string, returnMin: number): void;
  /** "Pausar carrusel": pause, or go on */
  pause(returnMin: number): void;
  paused(): boolean;
  /** the screen on display */
  current(): string;
  /** the carousel's steps and time, or null (no carousel) */
  progress(): NavProgress | null;
}

/** What an adapter gets from the controller. */
export interface AdapterEnv {
  /** this item's settings (the screen's with the item's props over them, widgets/canvas/config.ts) */
  cfg(): DisplayConfig;
  /** the item as the server sent it last */
  item(): DisplayCanvasItem;
  /** normalised events, already filtered to the item's calendars */
  events(): NEvent[];
  /** the current tick */
  now(): Tick;
  /** lite mode or a low-power device: no animation, no seconds hands */
  low(): boolean;
  /** a box a saved widget (config.widgets) is drawn in by widgets/custom.ts */
  mediaBox(widgetId: string, box: HTMLElement | null): void;
  /** the family data (the kids layouts' path: GET /api/display/family) */
  family(): FamilyView;
  /** a tap on a routine: the same path as the kids layouts (shown at once, sent, put back when the server says no) */
  toggleChore(choreId: string, done: boolean): void;
  /** the newest announcement on screen now, or null */
  announcement(): Announcement | null;
  /** Home Assistant states by alias, chart points and cover art (haFeed.ts) */
  ha: HaSource;
  /** values pushed by POST /api/hooks/values, only the keys this screen shows (valuesFeed.ts) */
  values: ValueSource;
  /** numbers of the data cards (market, sports, stocks), from this server only (dataFeed.ts) */
  data: DataSource;
  /** the navigation cards: taps, the carousel's progress (main.ts) */
  nav: NavSource;
}

/** The room an item has, in px (its card body), and where it is. */
export interface AdapterBox {
  w: number;
  h: number;
  /** 1rem in px */
  rem: number;
  size: string;
  zone: 'main' | 'side';
}

export interface CanvasAdapter {
  /** Build the widget inside `root` (the card body). */
  mount(root: HTMLElement, env: AdapterEnv): void;
  /** The item changed (props, style or position): draw it again. */
  update(): void;
  /** The box changed size: fit the content; `cramped` = it does not fit even at its smallest. */
  layout?(box: AdapterBox): { cramped: boolean } | void;
  /** Every second (`minuteChanged` once a minute). */
  tick?(t: Tick): void;
  data?(topic: CanvasTopic): void;
  /** Nothing to show (an empty message, no countdowns): the controller hides the card. */
  empty?(): boolean;
  /** A Rotativa: its slides (one per card, made by the controller) changed, or one of them became empty or not. */
  slides?(): void;
  destroy(): void;
}

export type AdapterFactory = (item: DisplayCanvasItem) => CanvasAdapter;
