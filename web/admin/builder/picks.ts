// Cards imported from a screen file (canvasCore readCanvasFile) lost what pointed into the other household: their
// calendars, people, Home Assistant entities, widget or the addresses of their routes. Each one is marked "Elige ..." until it is chosen again (an
// entity or a widget picked, the calendars or people changed) or the owner keeps it as it is.
import type { CanvasItem } from '../../shared/types';
import type { CanvasPick } from '../../../server/core/canvasCore.js';

export interface PickMark {
  cats: CanvasPick[];
  /** the item's props as imported: calendars and people count as chosen once they change */
  props: string;
}

/** The badge of each thing to choose again (t() keys). */
export const PICK_TEXT: Record<CanvasPick, string> = {
  calendars: 'Elige los calendarios',
  people: 'Elige las personas',
  entities: 'Elige las entidades',
  widget: 'Elige un widget',
  screen: 'Elige la pantalla',
  routes: 'Escribe las direcciones',
};

/** True when one of the item's Home Assistant slots (or its Home Assistant condition) is still empty. */
function entityEmpty(it: CanvasItem): boolean {
  const p = it.props as Record<string, unknown>;
  if (it.when?.src === 'ha' && !it.when.entity) return true;
  if (!it.kind.startsWith('ha.') && it.kind !== 'html') return false;
  if (typeof p.entity === 'string' && !p.entity) return true;
  const list = (k: string) => (Array.isArray(p[k]) ? (p[k] as { entity?: unknown }[]) : []);
  if ([...list('rows'), ...list('series'), ...list('buttons')].some((r) => !r?.entity)) return true;
  return list('bind').some((b) => b && 'entity' in b && !b.entity);
}

/** True when a route of a Trayectos card has no origin or no destination yet. */
function routeEmpty(it: CanvasItem): boolean {
  const routes = (it.props as { routes?: { origin?: string; destination?: string }[] }).routes;
  return Array.isArray(routes) && routes.some((r) => !r?.origin?.trim() || !r?.destination?.trim());
}

/** What an imported card still has to choose (empty: nothing left). */
export function pendingPicks(it: CanvasItem, mark: PickMark | undefined): CanvasPick[] {
  if (!mark) return [];
  const same = JSON.stringify(it.props) === mark.props;
  return mark.cats.filter((c) => {
    if (c === 'entities') return entityEmpty(it);
    if (c === 'widget') return !(it.props as { widgetId?: string }).widgetId;
    if (c === 'screen') return !(it.props as { target?: string }).target;
    if (c === 'routes') return routeEmpty(it);
    return same;
  });
}
