// RSS 2.0 / Atom / RDF news feeds: fetching and caching. Parsing is in server/core/newsParse.js.
import { request, BROWSER_UA } from './lib/http.js';
import { getConfig } from './store.js';
import { newestItemDate, parseFeed } from './core/newsParse.js';

export { parseFeed } from './core/newsParse.js';

const TTL = 15 * 60_000;

export async function fetchFeed(url) {
  const res = await request(url, {
    headers: {
      'user-agent': BROWSER_UA,
      accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      'accept-language': 'es-ES,es;q=0.9,pt;q=0.8,en;q=0.7',
    },
  });
  return res.text;
}

export async function testFeed(url) {
  try {
    const f = parseFeed(await fetchFeed(url));
    return { ok: true, title: f.title, count: f.items.length, newest: newestItemDate(f.items) };
  } catch (err) {
    return { ok: false, title: '', count: 0, error: err.message };
  }
}

const feedCache = new Map(); // url → { at, items, error }
export const status = { ok: null, updatedAt: null, errors: [] };

export async function getNews({ force = false } = {}) {
  const cfg = getConfig().news;
  const feeds = cfg.feeds.filter((f) => f.enabled);
  const errors = [];
  await Promise.all(feeds.map(async (f) => {
    const c = feedCache.get(f.url);
    if (!force && c && Date.now() - c.at < TTL) return;
    try {
      const parsed = parseFeed(await fetchFeed(f.url), f.name);
      feedCache.set(f.url, { at: Date.now(), items: parsed.items, name: f.name });
    } catch (err) {
      errors.push({ feedId: f.id, message: err.message });
      // stale on error; retry after 2 min instead of full TTL
      feedCache.set(f.url, { ...(c || { items: [] }), at: Date.now() - TTL + 120_000, error: err.message });
    }
  }));
  // Interleave feeds by date
  const items = feeds.flatMap((f) => (feedCache.get(f.url)?.items || []).map((i) => ({ ...i, source: f.name || i.source })))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, cfg.maxItems);
  const updatedAt = new Date().toISOString();
  const persistentErrors = feeds.map((f) => feedCache.get(f.url)?.error && { feedId: f.id, message: feedCache.get(f.url).error }).filter(Boolean);
  Object.assign(status, { ok: persistentErrors.length === 0, updatedAt, errors: persistentErrors.length ? persistentErrors : errors });
  return { updatedAt, items };
}
