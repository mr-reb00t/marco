// Showcase screen "home" (&shot=show.home, for the website and the video): Home Assistant by room. Three sections
// (Living room, Kitchen, Outside), four cells wide each, with the new controls in good states: lights on in warm white
// and in colour, the thermostat heating, the kitchen blind half open on its vertical shutter and closing at dusk ("Closing" in its header and the down button lit, so the 50 % in the shutter is not printed twice), motion in the garden,
// the back door closed, a driveway camera (a stock photo), a record playing, the solar and usage curves of the day filling their card behind the legend (De fondo), a gauge
// and a statistic.
// Each card has its own cool coloured glass over the warm evening photo (midnight thermostat, graphite pendants and
// back door, violet TV light, plum player, teal coffee, blue fridge and blind, green garden and humidity, indigo energy,
// navy chart), with no amber or brown fills: the orange of the heating and the light's own colour are the only warm
// notes. The switch and the motion tile take their card's accent for "on". The driveway camera is graded to 18:42.
// SHOW_HOME_PHOTO (an evening lane strung with lights) and showHomeArt() (a pier at sunset as the record's cover) are
// exported for the registry: the background photo and the player's cover are not wired from a showcase yet.
//
//   ?demo=1&preset=canvas&lang=en&now=2026-10-15T17:42Z&shot=show.home   (1920x1080, Lisbon time 18:42)
// Wiring (mockCanvas.ts / mockHa.ts / camera.ts, done by the integrator):
//   - SHOW_HOME is a CANVAS_FIXTURES entry (canvas + items, same shape as the show.* layouts);
//   - showHomeState(alias) (or the map HOME_HA) gives the made-up state of each alias (`cv_demo<item>:<slot>`, the ids mockCanvas gives),
//     to be used before the per-domain DEMO lists of demoHaStates;
//   - showHomeStatistic(itemId) the value of the statistic card (before demoHaStatistic's own);
//   - showHomeHistory(itemId) the chart's day of solar and usage on the screen's clock (before demoHaHistory's own);
//   - showHomeCameraFrame(n) the driveway picture (a stock photo with a camera's timestamp) for demoCameraFrame.
import type { CanvasConfig, CanvasItem, HaHistory, HaSlim, HaStatistic } from '../../shared/types';
import { getTimezone, now } from '../time';

type Raw = { kind: CanvasItem['kind']; pos: CanvasItem['pos']; props?: Record<string, unknown>; style?: Partial<CanvasItem['style']> };
/** A box of its own: w×h cells (the named size is worked out by the validation). */
const B = (x: number, y: number, w: number, h: number) => ({ zone: 'main' as const, x, y, size: 'm' as never, w, h });
const GLASS = { surface: 'none' as const };
/**
 * A card's own coloured glass: more tinted and more solid than the screen's, so each card keeps its colour over the
 * photo (cool tones against the warm photo, violet for the TV's colour light, blue for the fridge...).
 */
const T = (color: string, accent?: string): Partial<CanvasItem['style']> => ({
  color,
  ...(accent ? { accent } : {}),
  glass: { appearance: 'tinted', opacity: 0.74, blur: 28, tint: 'dark', edge: true },
});

/** One card of the screen and the states of its entities, slot by slot. */
type Card = Raw & { states?: HaSlim[]; stat?: HaStatistic };

const CARDS: Card[] = [
  // ---- Living room (columns 0 to 3)
  { kind: 'heading', pos: B(0, 0, 8, 2), props: { title: 'Living room', icon: '🛋️' }, style: GLASS },
  {
    kind: 'ha.climate', pos: B(0, 2, 8, 6), props: { entity: 'climate.living_room', name: 'Thermostat', modes: ['off', 'heat', 'auto'] },
    style: T('#1f2340'),
    states: [{ d: 'climate', mode: 'heat', modes: ['off', 'heat', 'cool', 'auto'], action: 'heating', cur: 20.4, target: 21.5, lo: null, hi: null, min: 7, max: 30, step: 0.5, unit: 'C', hum: 46, fan: 'auto', fans: ['auto', 'low', 'high'], n: 'Thermostat' }],
  },
  {
    kind: 'ha.light', pos: B(0, 8, 8, 4), props: { entity: 'light.tv_backlight', name: 'TV backlight' },
    style: T('#341a52', '#c77dff'),
    states: [{ d: 'light', on: true, bri: 80, ct: null, rgb: [175, 82, 222], col: true, n: 'TV backlight' }],
  },
  {
    kind: 'ha.media', pos: B(0, 12, 8, 4), props: { entity: 'media_player.living_room', name: 'Bookshelf speaker' },
    style: T('#2c1c3a', '#f49ac1'),
    states: [{ d: 'media', state: 'playing', title: 'Harbour Lights', artist: 'The Low Tides', vol: 0.32, art: true, source: 'Spotify', n: 'Bookshelf speaker' }],
  },

  // ---- Kitchen (columns 4 to 7)
  { kind: 'heading', pos: B(8, 0, 8, 2), props: { title: 'Kitchen', icon: '🍳' }, style: GLASS },
  {
    kind: 'ha.light', pos: B(8, 2, 8, 2), props: { entity: 'light.kitchen_pendants', name: 'Pendants' },
    style: T('#262a3e'),
    states: [{ d: 'light', on: true, bri: 72, ct: 3000, ctMin: 2200, ctMax: 6500, rgb: [255, 196, 137], n: 'Pendants' }],
  },
  {
    kind: 'ha.tile', pos: B(8, 4, 4, 2), props: { entity: 'switch.coffee_machine', name: 'Coffee' },
    style: T('#16302f', '#6fd6c2'),
    states: [{ d: 'switch', on: true, dc: 'outlet', n: 'Coffee' }],
  },
  {
    kind: 'ha.sensor', pos: B(12, 4, 4, 2), props: { entity: 'sensor.fridge_temperature', name: 'Fridge', decimals: 1 },
    style: T('#10324a', '#7fd3ff'),
    states: [{ d: 'sensor', v: '3.8', num: 3.8, unit: '°C', dc: 'temperature', n: 'Fridge' }],
  },
  {
    kind: 'ha.cover', pos: B(8, 6, 8, 6), props: { entity: 'cover.kitchen_blind', name: 'Window blind' },
    style: T('#1b2a3c', '#9cc8ff'),
    states: [{ d: 'cover', state: 'closing', pos: 50, readOnly: false, n: 'Window blind' }],
  },
  {
    kind: 'ha.gauge', pos: B(8, 12, 4, 4), props: { entity: 'sensor.kitchen_humidity', name: 'Humidity', decimals: 0, min: 0, max: 100, thresholds: [60, 75] },
    style: T('#0f3330'),
    states: [{ d: 'sensor', v: '52', num: 52, unit: '%', dc: 'humidity', n: 'Humidity' }],
  },
  {
    kind: 'ha.statistic', pos: B(12, 12, 4, 4), props: { entity: 'sensor.kitchen_energy', stat: 'change', period: 'today', name: 'Kitchen energy', decimals: 1 },
    style: T('#24204a', '#a59bff'),
    states: [{ d: 'sensor', v: '1043.6', num: 1043.6, unit: 'kWh', dc: 'energy', n: 'Kitchen energy' }],
    stat: { stat: 'change', period: 'today', value: 2.38, unit: 'kWh' },
  },

  // ---- Outside (columns 8 to 11)
  { kind: 'heading', pos: B(16, 0, 8, 2), props: { title: 'Outside', icon: '🌳' }, style: GLASS },
  {
    kind: 'ha.camera', pos: B(16, 2, 8, 6), props: { entity: 'camera.driveway', everySec: 5, label: true },
    states: [{ d: 'other', v: 'streaming', n: 'Driveway' }],
  },
  {
    kind: 'ha.tile', pos: B(16, 8, 4, 2), props: { entity: 'binary_sensor.garden_motion', name: 'Garden' },
    style: T('#12332a', '#5fe3a1'),
    states: [{ d: 'binary', on: true, dc: 'motion', n: 'Garden' }],
  },
  {
    kind: 'ha.tile', pos: B(20, 8, 4, 2), props: { entity: 'binary_sensor.back_door', name: 'Back door' },
    style: T('#262a3e'),
    states: [{ d: 'binary', on: false, dc: 'door', n: 'Back door' }],
  },
  {
    kind: 'ha.chart', pos: B(16, 10, 8, 6),
    props: { series: [{ entity: 'sensor.solar_power', label: 'Solar', color: '#ffc23d' }, { entity: 'sensor.home_power', label: 'Usage', color: '#5ad1c8' }], period: '24h', type: 'area', chartStyle: 'background' },
    style: T('#0e2236'),
  },
];

/** The layout, as a CANVAS_FIXTURES entry. */
export const SHOW_HOME: { canvas: Partial<CanvasConfig>; items: Raw[] } = {
  canvas: { background: 'photo', dim: 0.35, touch: true },
  items: CARDS.map(({ states: _s, stat: _t, ...raw }) => raw),
};

/** The same states as a map by alias (`cv_demo0003:0`), the shape the other showcase files export. */
export const HOME_HA: Record<string, HaSlim> = Object.fromEntries(
  CARDS.flatMap((c, i) => (c.states ?? []).map((st, slot) => [`cv_demo${String(i).padStart(4, '0')}:${slot}`, st] as const)),
);

/** The demo item id mockCanvas gives the card at `i` (cv_demo0000, cv_demo0001...). */
const itemIndex = (id: string): number => (/^cv_demo(\d{4})$/.test(id) ? Number(id.slice(7)) : -1);

/** The made-up state of a demo alias of this screen (`cv_demo0003:0`), or null when it has none of its own. */
export function showHomeState(alias: string): HaSlim | null {
  const [id, slot] = alias.split(':');
  return CARDS[itemIndex(id)]?.states?.[Number(slot)] ?? null;
}

/** The value of this screen's statistic card `itemId`, or null. */
export function showHomeStatistic(itemId: string): HaStatistic | null {
  return CARDS[itemIndex(itemId)]?.stat ?? null;
}

/** The hour of the day (0 to 24, decimal) of time `t` on the screen's clock. */
function hourAt(t: number): number {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: getTimezone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const [h, m] = f.format(new Date(t)).split(':').map(Number);
  return h + m / 60;
}

/**
 * The last 24 hours of the energy chart, up to the screen's clock (the demo's frozen &now=): the solar panels from
 * sunrise to sunset with a few passing clouds, and the house's usage with its breakfast, lunch and dinner peaks.
 */
export function showHomeHistory(itemId: string): HaHistory | null {
  const card = CARDS[itemIndex(itemId)];
  if (card?.kind !== 'ha.chart') return null;
  const end = now().getTime();
  const span = 24 * 3600_000;
  const n = 97;
  const bump = (h: number, c: number, w: number, a: number) => a * Math.exp(-(((h - c) / w) ** 2));
  const solar = (h: number, i: number) => {
    const day = Math.sin(((h - 7.8) / 11.2) * Math.PI);
    if (day <= 0) return 0;
    // October sun: about 3.4 kW at its best, two clouds after midday
    return Math.max(0, 3.45 * day ** 1.3 - bump(h, 12.4, 0.35, 0.9) - bump(h, 15.1, 0.5, 0.7) - 0.06 * Math.abs(Math.sin(i * 2.3)));
  };
  const usage = (h: number, i: number) =>
    0.32 + bump(h, 7.4, 0.7, 1.35) + bump(h, 13.2, 0.8, 0.75) + bump(h, 19.2, 1.1, 1.9) + bump(h, 22.3, 0.6, 0.4) + 0.07 * Math.sin(i * 1.7) + 0.04 * Math.sin(i * 0.6);
  const series = (card.props?.series as { label?: string }[] | undefined) ?? [];
  return {
    period: '24h',
    series: series.map((sr) => {
      const sun = /solar/i.test(sr.label ?? '');
      return {
        label: sr.label ?? '',
        unit: 'kW',
        points: Array.from({ length: n }, (_, i): [number, number] => {
          const t = end - span + (span * i) / (n - 1);
          const v = (sun ? solar : usage)(hourAt(t), i);
          return [t, Math.round(v * 100) / 100];
        }),
      };
    }),
  };
}

/** The driveway camera's stock photo (Picsum, like the demo's background photos). */
const DRIVEWAY = 'https://picsum.photos/id/514/1280/720';
let photo: Promise<ImageBitmap | null> | null = null;

/**
 * Picture `n` of the driveway camera: the stock photo, a little darker and cooler as an evening camera sees it, with
 * a running date and time in the corner the way a real one stamps its frames.
 */
export function showHomeCameraFrame(_n: number): Promise<Blob | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  photo ??= fetch(DRIVEWAY, { mode: 'cors' })
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((b) => createImageBitmap(b))
    .catch(() => {
      photo = null;
      return null;
    });
  return photo.then((img) => {
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    if (!g) return null;
    // 18:42 in October: the low sun of the golden hour, warm from the top right, the shadows a little deeper
    g.filter = 'brightness(0.84) saturate(1.08) contrast(1.06) sepia(0.18)';
    g.drawImage(img, 0, 0);
    g.filter = 'none';
    const sun = g.createRadialGradient(c.width * 0.95, -c.height * 0.1, 0, c.width * 0.95, -c.height * 0.1, c.width * 1.1);
    sun.addColorStop(0, 'rgba(255,170,80,0.42)');
    sun.addColorStop(0.55, 'rgba(255,120,60,0.12)');
    sun.addColorStop(1, 'rgba(40,20,60,0.18)');
    g.globalCompositeOperation = 'soft-light';
    g.fillStyle = sun;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    const low = g.createLinearGradient(0, c.height * 0.55, 0, c.height);
    low.addColorStop(0, 'rgba(0,0,0,0)');
    low.addColorStop(1, 'rgba(10,6,4,0.35)');
    g.fillStyle = low;
    g.fillRect(0, 0, c.width, c.height);
    // the stamp: the screen's date and time (the demo's frozen clock with &now=), white on a faint band
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: getTimezone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const part = (t: string) => f.formatToParts(now()).find((x) => x.type === t)?.value ?? '';
    const stamp = `${part('year')}-${part('month')}-${part('day')}  ${part('hour')}:${part('minute')}:${part('second')}`;
    g.font = '600 24px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'top';
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 0, c.width, 48);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    // inside the part a wide card's crop keeps
    g.fillText(stamp, c.width - 90 - g.measureText(stamp).width, 13);
    return new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.88));
  });
}

/**
 * The background photo this screen is made for (Picsum, like the demo's other photos): a lane strung with warm lights
 * on an autumn evening, so the glass glows amber at the top instead of over a grey mountain. For the integrator:
 * mockPhotos() should put it first when &shot=show.home (the registry has no photo hook yet).
 */
export const SHOW_HOME_PHOTO = { url: 'https://picsum.photos/id/195/1920/1080', author: 'Picsum stock' };

/** The record's cover: an old pier at sunset with gulls (Picsum), cropped square. */
const COVER = 'https://picsum.photos/id/270/900/600';
let cover: Promise<string | null> | null = null;

/**
 * The player's cover art on this screen as a data: URL (for mockHa's demoArt, which today draws three circles): the
 * golden pier at sunset, square, a little warmer and with a soft vignette.
 */
export function showHomeArt(): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  cover ??= fetch(COVER, { mode: 'cors' })
    .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((b) => createImageBitmap(b))
    .then((img) => {
      const n = 600;
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const g = c.getContext('2d');
      if (!g) return null;
      // the square on the pier and the birds (the left two thirds of the picture)
      const side = img.height;
      g.filter = 'saturate(1.15) contrast(1.05)';
      g.drawImage(img, img.width * 0.08, 0, side, side, 0, 0, n, n);
      g.filter = 'none';
      // a little vignette, as a printed sleeve has (no title on it: the card prints the title and the band beside it)
      const v = g.createRadialGradient(n / 2, n / 2, n * 0.35, n / 2, n / 2, n * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(20,8,0,0.35)');
      g.fillStyle = v;
      g.fillRect(0, 0, n, n);
      return c.toDataURL('image/jpeg', 0.9);
    })
    .catch(() => {
      cover = null;
      return null;
    });
  return cover;
}

export default SHOW_HOME;
