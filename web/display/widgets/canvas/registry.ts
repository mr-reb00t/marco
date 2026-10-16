// Display side of the Personalizado registry: which adapter draws each kind. Everything else about a kind (sizes,
// options, edition) lives in server/core/canvasCore.js. Kinds without an adapter here are drawn as a neutral
// "comes in a later version" card.
import type { DisplayCanvasItem } from '../../../shared/types';
import { CALENDAR_ADAPTERS } from './calendar';
import { CAMERA_ADAPTERS } from './camera';
import { CHART_ADAPTERS } from './chart';
import { CLOCK_ADAPTERS } from './clock';
import { CONTENT_ADAPTERS, placeholder } from './content';
import { DATA_ADAPTERS } from './data';
import { FAMILY_ADAPTERS } from './family';
import { HA_ADAPTERS } from './ha';
import { HA_CONTROL_ADAPTERS } from './haControls';
import { HA_TILE_ADAPTERS } from './haTile';
import { HTML_ADAPTERS } from './html';
import { NAV_ADAPTERS } from './nav';
import { ROTATOR_ADAPTERS } from './rotator';
import type { CanvasAdapter } from './types';
import { WEATHER_ADAPTERS } from './weather';

const ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  ...CLOCK_ADAPTERS,
  ...CALENDAR_ADAPTERS,
  ...WEATHER_ADAPTERS,
  ...CONTENT_ADAPTERS,
  ...FAMILY_ADAPTERS,
  ...HA_ADAPTERS,
  ...HA_CONTROL_ADAPTERS,
  ...HA_TILE_ADAPTERS,
  ...CHART_ADAPTERS,
  ...CAMERA_ADAPTERS,
  ...HTML_ADAPTERS,
  ...DATA_ADAPTERS,
  ...NAV_ADAPTERS,
  ...ROTATOR_ADAPTERS,
};

/** Kinds this display draws itself (the rest get the placeholder). */
export const DRAWN_KINDS = Object.keys(ADAPTERS);

/** The adapter of an item: its kind's, or a placeholder when it is disabled or not drawn by this version. */
export function adapterFor(item: DisplayCanvasItem): CanvasAdapter {
  if (item.disabled) return placeholder(item.disabled);
  const f = ADAPTERS[item.kind];
  return f ? f(item) : placeholder('soon');
}
