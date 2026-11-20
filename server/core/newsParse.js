// RSS 2.0 / Atom / RDF feed parsing via fast-xml-parser. Pure (no network), shared with Marco Cloud; fetching and
// caching are in server/news.js.
import { XMLParser } from 'fast-xml-parser';
import { stripHtml, truncate, hash, decodeEntities } from './lib/text.js';

/** Items read from one feed at most (news.maxItems is at most 200 too). */
export const MAX_FEED_ITEMS = 200;
/** The date of the newest dated story of `items` (ISO), or null when none has a date. */
export const newestItemDate = (items) => items.reduce((m, i) => (i.date && (!m || i.date > m) ? i.date : m), null);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: false,
  // Entity expansion off: DOCTYPE entities are never expanded (no "billion laughs"); stripHtml() decodes the
  // usual HTML named and numeric entities itself.
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  trimValues: true,
});

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text'] ?? '');
  return '';
};
const attr = (v, name) => (v && typeof v === 'object' ? v[`@_${name}`] : undefined);

function firstImage(it) {
  for (const enc of arr(it.enclosure)) {
    const url = attr(enc, 'url');
    const type = attr(enc, 'type') || '';
    if (url && (type.startsWith('image') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))) return url;
  }
  for (const key of ['media:content', 'media:thumbnail']) {
    for (const m of arr(it[key])) {
      const url = attr(m, 'url');
      const medium = attr(m, 'medium');
      if (url && (!medium || medium === 'image')) return url;
    }
  }
  for (const g of arr(it['media:group'])) {
    const u = attr(arr(g['media:content'])[0], 'url') || attr(arr(g['media:thumbnail'])[0], 'url');
    if (u) return u;
  }
  const html = text(it['content:encoded']) || text(it.description) || text(it.content) || text(it.summary);
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(decodeEntities(html));
  if (m && /^https?:/i.test(m[1])) return m[1];
  return undefined;
}

function toIso(s) {
  const d = new Date(String(s || '').trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Parse feed XML → { title, items:[{id,title,summary,source,date,image?,link}] }. At most `maxItems` items are read
 * (the cap applies before any item is processed).
 */
export function parseFeed(xml, sourceName = '', { maxItems = MAX_FEED_ITEMS } = {}) {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new Error('Not an RSS/Atom feed');
  const doc = parser.parse(xml);
  let title = '';
  let rawItems = [];
  let atom = false;
  if (doc.rss) {
    const ch = arr(doc.rss.channel)[0] || {};
    title = text(ch.title);
    rawItems = arr(ch.item);
  } else if (doc.feed) {
    atom = true;
    title = text(doc.feed.title);
    rawItems = arr(doc.feed.entry);
  } else if (doc['rdf:RDF']) {
    const rdf = doc['rdf:RDF'];
    title = text(arr(rdf.channel)[0]?.title);
    rawItems = arr(rdf.item);
  }
  title = stripHtml(title);
  const source = sourceName || title;
  const items = rawItems.slice(0, Math.max(0, maxItems)).map((it) => {
    const t = stripHtml(text(it.title));
    let link = '';
    if (atom) {
      const links = arr(it.link);
      const alt = links.find((l) => !attr(l, 'rel') || attr(l, 'rel') === 'alternate') || links[0];
      link = attr(alt, 'href') || text(alt);
    } else {
      link = text(it.link) || text(it.guid);
    }
    const body = text(it.description) || text(it.summary) || text(it['content:encoded']) || text(it.content);
    const summary = truncate(stripHtml(body), 200);
    const date = toIso(text(it.pubDate) || text(it.published) || text(it.updated) || text(it['dc:date']));
    const out = {
      id: hash(`${text(it.guid) || text(it.id) || link || t}`, 12),
      title: t,
      summary: summary === t ? '' : summary,
      source,
      date,
      link: link.trim(),
    };
    const image = firstImage(it);
    if (image) out.image = decodeEntities(image);
    return out;
  }).filter((i) => i.title);
  return { title, items };
}
