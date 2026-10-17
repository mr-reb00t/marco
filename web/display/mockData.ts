// The demo's numbers for the data cards (?demo=1): the same reading and projection as the server
// (server/core/dataCore.js) over made-up answers in the sources' own shapes (server/core/dataFake.js), so the demo
// shows exactly what a server would send. Nothing leaves the page.
import { canvasCards } from '../../server/core/canvasCore.js';
import type { DataItemData, DisplayConfig, StockQuoteData } from '../shared/types';
import { createDataHub, dataForItem } from '../../server/core/dataCore.js';
import { fakeDataCall, FAKE_STOCKS_KEY } from '../../server/core/dataFake.js';

// One cache per card: on a server a coin that another card asks for later joins the next call (within 15 s); the demo
// asks once, so each card gets its own call and every coin shows at once.
const hubs = new Map<string, ReturnType<typeof createDataHub>>();

export async function demoData(cfg: DisplayConfig | null): Promise<Record<string, DataItemData>> {
  const out: Record<string, DataItemData> = {};
  for (const it of canvasCards(cfg?.canvas?.items)) {
    if (it.disabled || !['market', 'sports', 'stocks'].includes(it.kind)) continue;
    const key = `${it.id}|${JSON.stringify(it.props)}`;
    let hub = hubs.get(key);
    if (!hub) {
      if (hubs.size > 40) hubs.clear();
      hub = createDataHub({ call: fakeDataCall(), stocksKey: () => FAKE_STOCKS_KEY });
      hubs.set(key, hub);
    }
    const d = (await dataForItem(hub, { kind: it.kind, props: it.props })) as DataItemData | null;
    if (d) out[it.id] = d.kind === 'stocks' && it.props.sparkline === true ? { ...d, quotes: d.quotes.map(dayCurve) } : d;
  }
  return out;
}

/**
 * A quote's curve of today in the demo: a server draws it from the quotes it has read through the day, so a page that
 * has just asked once has none; made up here from the change of the day, ending at the price.
 */
function dayCurve(q: StockQuoteData): StockQuoteData {
  if (q.pts.length >= 2 || q.price === null) return q;
  const open = q.price / (1 + (q.ch ?? 0) / 100);
  const seed = [...q.sym].reduce((a, c) => a + c.charCodeAt(0), 0);
  const end = Date.now();
  const pts: [number, number][] = Array.from({ length: 40 }, (_, i) => {
    const f = i / 39;
    const wave = Math.sin(f * 7 + seed) * 0.004 + Math.sin(f * 17 + seed * 3) * 0.002;
    return [end - (39 - i) * 10 * 60_000, Math.round((open + (q.price! - open) * f) * (1 + wave * (1 - f)) * 100) / 100];
  });
  return { ...q, pts };
}
