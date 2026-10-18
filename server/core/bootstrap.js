// First load of a display page: the answers of the display API the page would ask for first, written into the page
// itself (a JSON data block, never a script that runs), so the display draws without waiting for those round trips.
// Shared with Marco Cloud (the Worker writes the same block into /d/<key>). The display reads it once
// (web/display/boot.ts): an answer is used only for the exact request it stands for, within a minute of the page
// load; anything missing or different is fetched as before.
//
// Only answers the display API itself gave for the same credential go in (so the same privacy filtering applies),
// and only into a page served with Cache-Control: private, no-store.
import { addDays, localDate } from './lib/tz.js';
import { canvasEventsNeed } from './canvasCore.js';

/** id of the <script type="application/json"> element */
export const BOOT_ID = 'marco-boot';
/** Version of the block: the display ignores a block of another version. */
export const BOOT_VERSION = 1;

/** Weeks of events 'auto' fetches (web/display/cards.ts uses the same number for the rows it can draw). */
export const AUTO_WEEKS_MAX = 6;
/** Furthest day the agenda view's 'auto' looks at (web/display/agendaFill.ts). */
export const AGENDA_AUTO_MAX_DAYS = 60;

/** Start of the week containing `day` (YYYY-MM-DD); weekStart 0 = Sunday, 1 = Monday. */
function startOfWeek(day, weekStart) {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(day, -((wd - weekStart + 7) % 7));
}

/**
 * The days of events a display asks for (GET /api/events?from=&to=): from the first day of its grid to as far as
 * its weeks, its agenda or its Personalizado calendars look. The display (web/display/main.ts eventsRange) and the
 * page bootstrap both use this, so they ask for the same window.
 * @param {string} today YYYY-MM-DD in the screen's time zone
 * @param {{ weekStart?: number, startOn?: string, weeks?: number | 'auto', agenda?: boolean, agendaDays?: number | 'auto', canvas?: object | null }} o
 * @returns {[string, string]}
 */
export function eventsWindow(today, { weekStart = 1, startOn = 'week', weeks = 5, agenda = false, agendaDays = 14, canvas = null } = {}) {
  const from = startOn === 'today' ? today : startOfWeek(today, weekStart);
  const w = weeks === 'auto' ? AUTO_WEEKS_MAX : weeks;
  let to = addDays(from, Math.max(w * 7, 21) + 1);
  if (agenda) {
    const agendaTo = addDays(today, (agendaDays === 'auto' ? AGENDA_AUTO_MAX_DAYS : agendaDays) + 1);
    if (agendaTo > to) to = agendaTo;
  }
  if (canvas) {
    const canvasTo = addDays(today, canvasEventsNeed(canvas));
    if (canvasTo > to) to = canvasTo;
  }
  return [from, to];
}

const KIDS = new Set(['kids', 'kidsWeek', 'kidsDay']);

/**
 * The event windows a display of this config (a GET /api/display/config answer) is likely to ask for first, with
 * no URL overrides: its own, and the one with four week rows that small landscape screens and some layouts draw
 * (web/display/main.ts applyConfig capWeeks). The display uses a bootstrapped answer only when its own window is
 * one of these.
 * @returns {[string, string][]}
 */
export function bootEventWindows(config, now = new Date()) {
  const cal = config?.calendar;
  if (!cal || !config.screen) return [];
  const today = localDate(now, config.datetime?.timezone || 'Europe/Lisbon');
  let preset = config.layout?.preset || 'bigCalendar';
  const modern = config.screen.style === 'modern';
  if ((KIDS.has(preset) && !modern) || (preset === 'canvas' && (!modern || !config.canvas))) preset = 'bigCalendar';
  let weeks = cal.weeks ?? 5;
  let view = cal.view;
  if (preset === 'twoWeeks') {
    weeks = 2;
    view = 'month';
  }
  const o = {
    weekStart: cal.weekStart ?? 1, startOn: cal.startOn, agenda: preset === 'agenda' || view === 'agenda', agendaDays: cal.agendaDays ?? 14,
    canvas: preset === 'canvas' ? config.canvas : null,
  };
  const out = [eventsWindow(today, { ...o, weeks })];
  if (typeof weeks === 'number' && weeks > 4) {
    const capped = eventsWindow(today, { ...o, weeks: 4 });
    if (capped.join() !== out[0].join()) out.push(capped);
  }
  return out;
}

/** The request path the display sends for an events window (web/display/api.ts api.events). */
export const eventsPath = ([from, to]) => `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

/**
 * The data requests a display of this config sends first, as it sends them (web/display/api.ts paths): weather,
 * countdowns, the first photos, news and the events of its likely windows. A display on a carousel names the screen
 * it shows (?screen=<id>) on every request about that screen.
 */
export function bootDataPaths(config, now = new Date()) {
  const screen = config?.target?.kind === 'carousel' && typeof config.screenId === 'string' ? config.screenId : '';
  const own = (p) => (screen ? `${p}${p.includes('?') ? '&' : '?'}screen=${encodeURIComponent(screen)}` : p);
  return [
    own('/api/weather'), own('/api/countdowns'), own('/api/photos?count=20'), '/api/news',
    ...bootEventWindows(config, now).map((w) => own(eventsPath(w))),
  ];
}

/** The block for `data` ({ [request path]: answer }), safe inside HTML: no "<" (so no "</script>"), no U+2028/9. */
export function bootBlock(data) {
  const json = JSON.stringify({ v: BOOT_VERSION, data })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script type="application/json" id="${BOOT_ID}">${json}</script>`;
}

/** `html` with the block for `data` before </body> (or at the end when there is none). */
export function injectBoot(html, data) {
  const block = bootBlock(data);
  const i = html.lastIndexOf('</body>');
  return i < 0 ? html + block : html.slice(0, i) + block + html.slice(i);
}
