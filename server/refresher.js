// Background refresher: keeps calendar sources fresh (respecting refreshMin) and broadcasts SSE `events`
// when the merged events (default window) change. Also pre-warms weather/news caches, checks which special
// background rule holds on each screen (photoRules.js) and reads the Microsoft To Do lists of the to-do list
// (microsoftTodo.js, every 5 minutes; SSE `todo` when their tasks change).
import { getConfig } from './store.js';
import { refreshAll, getEvents, defaultWindow } from './calendars.js';
import { getWeather } from './weather.js';
import { getNews } from './news.js';
import { publish } from './pollHub.js';
import { syncPhotoRules } from './photoRules.js';
import { refreshTodo } from './microsoftTodo.js';

let timer = null;
let running = null;
let lastHash = null;
let lastDay = null;

let pending = false;

/** Run one refresh. If called while a run is active, one more run is queued after it (fresh config). */
export function runRefresh() {
  if (running) {
    pending = true;
    return running;
  }
  running = (async () => {
    try {
      const cfg = getConfig();
      // not awaited: a slow Microsoft To Do list never holds up the calendars (it queues its own next run)
      refreshTodo().catch(() => {});
      await refreshAll();
      const win = defaultWindow(cfg.datetime.timezone);
      const { hash } = await getEvents(win);
      // Hash changes on data changes and on day rollover (window moves)
      if (lastHash !== null && (hash !== lastHash || win.from !== lastDay)) publish('events', { hash });
      lastHash = hash;
      lastDay = win.from;
      // Pre-warm the weather cache for every screen that shows weather (each place once: the cache is per place, for
      // every language).
      for (const screen of cfg.screens.filter((s) => s.weather.enabled)) getWeather({ screen }).catch(() => {});
      if (cfg.screens.some((s) => s.news.enabled)) getNews().catch(() => {});
      // special backgrounds: screens whose active rule changed (midnight, events, a rule edit) get new photos
      await syncPhotoRules();
    } catch (err) {
      console.warn('[refresher]', err.message);
    } finally {
      running = null;
      if (pending) {
        pending = false;
        runRefresh();
      }
    }
  })();
  return running;
}

export function startRefresher(intervalMs = 60_000) {
  runRefresh();
  timer = setInterval(runRefresh, intervalMs);
  timer.unref();
}

export function stopRefresher() {
  if (timer) clearInterval(timer);
  timer = null;
}
