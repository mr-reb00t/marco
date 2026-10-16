// The demo's numbers for the data cards (?demo=1): the same reading and projection as the server
// (server/core/dataCore.js) over made-up answers in the sources' own shapes (server/core/dataFake.js), so the demo
// shows exactly what a server would send. Nothing leaves the page.
import { canvasCards } from '../../server/core/canvasCore.js';
import type { DataItemData, DisplayConfig } from '../shared/types';
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
    if (d) out[it.id] = d;
  }
  return out;
}
