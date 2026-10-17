// Showcase screen "cinematic" (made up, for the website and the video): a full-screen photo with very few cards, so
// most of the picture shows. A large light clock and the date top left and the weather top right, straight on the
// photo (no card; the weather a size up, so it answers the clock and ends on the right edge of the player below), and
// two glass cards of the same size (4x2) side by side along the bottom right: the next two family plans and what is
// playing in the living room. At 4x2 the player is wide enough for back, pause, next and the volume (the touch
// controls on), so it fills its card instead of a lone pause button over empty glass. No hourly strip under the
// weather: its "Now" column would print the 19 degrees a second time.
//   ?demo=1&preset=canvas&lang=en&now=2026-10-15T17:42Z&shot=show.cinematic
// The integrator registers CINEMATIC in mockCanvas.ts SHOWCASE under CINEMATIC_KEY (it replaces the old
// fromTemplate('cinematic') entry). The key must start with "show." so the demo player gets its drawn cover and an
// English track (mockHa.ts). No extra Home Assistant entities: the first demo media player is the playing one.
import type { CanvasConfig, CanvasItem } from '../../shared/types';

type Raw = { kind: CanvasItem['kind']; pos: CanvasItem['pos']; portrait?: CanvasItem['pos']; props?: Record<string, unknown>; style?: Partial<CanvasItem['style']> };
type Fixture = { canvas: Partial<CanvasConfig>; items: Raw[]; orientation?: 'portrait' | 'landscape' };

/** A box of its own: w×h cells (the named size is worked out by the validation). */
const B = (x: number, y: number, w: number, h: number) => ({ zone: 'main' as const, x, y, size: 'm' as never, w, h });

/** Straight on the photo, no card. */
const BARE = { surface: 'none' as const };
/** Light smoked glass: a strong blur and the light edge, the photo still shows through. */
const CLEAR = { surface: 'glass' as const, radius: 'xl' as const, glass: { appearance: 'auto' as const, opacity: 0.4, blur: 28, tint: 'dark' as const, edge: true } };

export const CINEMATIC_KEY = 'show.cinematic';

export const CINEMATIC: Fixture = {
  canvas: { background: 'photo', dim: 0.12, scrim: 'topBottom', touch: true },
  items: [
    { kind: 'clock.digital', pos: B(0, 0, 10, 6), style: BARE, props: { weight: 'light', showDate: true, dateFormat: 'long', datePos: 'below' } },
    { kind: 'weather.now', pos: B(16, 0, 8, 4), style: { ...BARE, scale: 1.45 }, props: { meta: false, feelsLike: false } },
    { kind: 'calendar.next', pos: B(8, 12, 8, 4), style: CLEAR, props: { count: 2, sourceIds: ['c_fam'] } },
    { kind: 'ha.media', pos: B(16, 12, 8, 4), style: CLEAR, props: { entity: 'media_player.living_room', name: 'Living room' } },
  ],
};
