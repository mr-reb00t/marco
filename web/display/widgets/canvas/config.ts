// Per-item settings of a Personalizado widget: the screen's DisplayConfig with the item's props laid over the section
// they belong to (calendar, datetime, weather, ...). Every widget class reads its settings through a cfg() getter,
// so a canvas item hands it one of these and the class needs no other change. Cached by the item's `v`.
import type { CanvasPos, DisplayCanvas, DisplayCanvasItem, DisplayConfig } from '../../../shared/types';
import { SIDE_UNITS, portraitSide } from '../../../../server/core/canvasCore.js';

const cache = new WeakMap<DisplayConfig, Map<string, DisplayConfig>>();

/** The settings `item` renders with, on top of `screen` (the screen's config as the display normalised it). */
export function itemCfg(screen: DisplayConfig, item: DisplayCanvasItem): DisplayConfig {
  let per = cache.get(screen);
  if (!per) {
    per = new Map();
    cache.set(screen, per);
  }
  const key = `${item.id}|${item.v}`;
  const hit = per.get(key);
  if (hit) return hit;
  const out = build(screen, item);
  per.set(key, out);
  return out;
}

function build(screen: DisplayConfig, item: DisplayCanvasItem): DisplayConfig {
  const p = item.props as Record<string, any>;
  const cfg: DisplayConfig = { ...screen };
  if (item.kind.startsWith('calendar.')) {
    const ids: string[] | null = Array.isArray(p.sourceIds) ? p.sourceIds : null;
    const sources = ids ? screen.calendar.sources.filter((s) => ids.includes(s.id)) : screen.calendar.sources;
    cfg.calendar = { ...screen.calendar, enabled: true, sources, hidePast: !!p.hidePast };
    if (item.kind === 'calendar.month') {
      Object.assign(cfg.calendar, {
        view: 'month', weeks: p.weeks === 'auto' || !p.weeks ? 'auto' : p.weeks, startOn: 'week', eventStyle: p.eventStyle === 'cards' ? 'cards' : 'lines',
        maxEventsPerDay: p.maxEventsPerDay ?? 4, showLegend: p.showLegend !== false,
      });
    } else if (item.kind === 'calendar.week') {
      Object.assign(cfg.calendar, { view: 'week', weeks: 1, startOn: p.start === 'monday' ? 'week' : 'today', eventStyle: 'cards', showLegend: false });
    } else if (item.kind === 'calendar.agenda') {
      cfg.calendar.showLegend = p.showLegend === true;
    }
    if (item.kind === 'calendar.month' || item.kind === 'calendar.week') {
      // the card's own grid lines (#29), not the screen's calendar settings
      cfg.calendar.gridLines = p.gridLines === 'clear' || p.gridLines === 'strong' ? p.gridLines : 'soft';
      cfg.calendar.gridColor = typeof p.gridColor === 'string' ? p.gridColor : null;
    }
  }
  if (item.kind.startsWith('clock.') || item.kind === 'date') {
    cfg.datetime = {
      ...screen.datetime, enabled: true, clock: item.kind === 'clock.analog' ? 'analog' : 'digital', showSeconds: !!p.seconds,
      ...(p.dateFormat === 'short' ? { dateFormat: 'custom' as const, dateCustom: '{ddd} {d} {mmm}' } : {}),
    };
  }
  if (item.kind.startsWith('weather.')) {
    cfg.weather = {
      ...screen.weather, enabled: true,
      forecastDays: item.kind === 'weather.forecast' ? Math.min(7, Math.max(3, Number(p.days) || 5)) : screen.weather.forecastDays,
    };
  }
  if (item.kind === 'news') cfg.news = { ...screen.news, enabled: true, rotateSec: Math.min(60, Math.max(5, Number(p.rotateSec) || 15)) };
  if (item.kind === 'countdowns') cfg.countdowns = { ...(screen.countdowns ?? { enabled: true, max: 4 }), enabled: true, max: Math.min(6, Math.max(1, Number(p.max) || 4)) };
  // a to-do card's own lists, title, icon and filter (core todoCore.js), in place of the screen's
  if (item.kind === 'todo') {
    cfg.todo = {
      ...screen.todo, enabled: true, listIds: Array.isArray(p.listIds) ? (p.listIds as string[]) : null, title: typeof p.title === 'string' ? p.title : '',
      icon: typeof p.icon === 'string' ? p.icon : '', filter: p.filter === 'important' || p.filter === 'due' ? p.filter : 'all',
    };
  }
  if (item.kind === 'message') cfg.message = { ...screen.message, enabled: true };
  return cfg;
}

/** Calendar items: only the events of the calendars they picked (null = every calendar of the screen). */
export function sourceFilter(item: DisplayCanvasItem): ((sourceId: string) => boolean) | null {
  const ids = (item.props as { sourceIds?: unknown }).sourceIds;
  if (!Array.isArray(ids)) return null;
  const set = new Set(ids.filter((x): x is string => typeof x === 'string'));
  return (id) => set.has(id);
}

/** The sidebar side on this orientation (left and right go on top and at the bottom of a portrait screen). */
export function sidebarSide(cv: Pick<DisplayCanvas, 'sidebar'>, portrait: boolean): DisplayCanvas['sidebar']['side'] {
  const s = cv.sidebar?.side ?? 'none';
  return portrait ? portraitSide(s) : s;
}

/** Where an item sits on this orientation (null = not shown there). */
export function posFor(item: DisplayCanvasItem, portrait: boolean): CanvasPos | null {
  return portrait ? item.portrait ?? null : item.pos;
}

/**
 * Grid lines of the sidebar stack: each item's start and span in units of SIDE_UNITS, in order. The fill item takes
 * what the others leave (nothing left: it is not shown).
 */
export function sideTracks(items: { id: string; pos: CanvasPos }[]): Map<string, { start: number; span: number }> {
  const list = items.filter((x) => x.pos.zone === 'side').sort((a, b) => (a.pos as { order: number }).order - (b.pos as { order: number }).order);
  const fixed = list.reduce((n, x) => n + ((x.pos as { span: number | 'fill' }).span === 'fill' ? 0 : Number((x.pos as { span: number }).span) || 2), 0);
  const out = new Map<string, { start: number; span: number }>();
  let at = 0;
  for (const x of list) {
    const sp = (x.pos as { span: number | 'fill' }).span;
    const span = sp === 'fill' ? Math.max(0, SIDE_UNITS - fixed) : Math.min(Number(sp) || 2, SIDE_UNITS - at);
    out.set(x.id, { start: at, span });
    at += span;
  }
  return out;
}

