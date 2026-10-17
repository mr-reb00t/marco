// Showcase screen "data" (made up, in English with &lang=en): a data lover's wall on the dark ambient background.
// Clock, news and weather on top; across the middle Bitcoin and Ethereum each in a wide card of its own, the price in
// large type, its change in green or red and its 30-day chart filling the card behind them, edge to edge ("De fondo",
// Bitcoin up and Ethereum down, so the two are not one colour); along the bottom Arsenal's live match and the NBA (a
// game live, the next one at 20:30), a watchlist of five stocks and four smaller coins with their 7-day curves beside
// them (three up and Cardano down).
// Same shape as the demo layouts of mockCanvas.ts (CANVAS_FIXTURES); the numbers come from the demo's fake sources
// (server/core/dataFake.js through mockData.ts), so it needs no extra entities or data.
// The stocks are a list and not the running ticker on purpose: a ticker is one line in a box at least two rows tall
// (an empty band above and below it) and a still picture always catches it cut at both ends. No sparklines on the
// stocks: the fake quotes have no history, so they would draw nothing.
// The sports card follows one team and not the whole league on purpose: the fake league round plays the same pairs
// twice (Arsenal v Chelsea live, Chelsea v Arsenal on Sunday), which would print the same game twice. Three games and
// no more: a fourth is the Knicks v Lakers result, the same two teams again. Text at 1.3 and not more: at 1.36 the
// card cuts "Warriors" to "Warri..." in a 4-wide box.
//   ?demo=1&preset=canvas&lang=en&now=2026-10-15T17:42Z&shot=show.data (18:42 in Lisbon)
import type { CanvasConfig, CanvasItem } from '../../shared/types';

type Raw = { kind: CanvasItem['kind']; pos: CanvasItem['pos']; portrait?: CanvasItem['pos']; props?: Record<string, unknown>; style?: Partial<CanvasItem['style']> };
/** A box of its own: w×h cells (the named size is worked out by the validation). */
const B = (x: number, y: number, w: number, h: number) => ({ zone: 'main' as const, x, y, size: 'm' as never, w, h });

const STOCKS = [{ sym: 'SPY', name: 'S&P 500' }, { sym: 'AAPL', name: 'Apple' }, { sym: 'NVDA', name: 'NVIDIA' }, { sym: 'MSFT', name: 'Microsoft' }, { sym: 'TSLA', name: 'Tesla' }];

export const DATA_SHOWCASE: { canvas: Partial<CanvasConfig>; items: Raw[]; orientation?: 'portrait' | 'landscape' } = {
  canvas: { background: 'ambient' },
  items: [
    { kind: 'clock.digital', pos: B(0, 0, 8, 4) },
    { kind: 'news', pos: B(8, 0, 8, 4) },
    { kind: 'weather.now', pos: B(16, 0, 8, 4) },
    { kind: 'market', pos: B(0, 4, 12, 6), props: { coins: [{ id: 'bitcoin', currency: 'usd' }], layout: 'big', range: '30d', chart: 'area', chartStyle: 'background' }, style: { scale: 1.6 } },
    { kind: 'market', pos: B(12, 4, 12, 6), props: { coins: [{ id: 'ethereum', currency: 'usd' }], layout: 'big', range: '30d', chart: 'area', chartStyle: 'background' }, style: { scale: 1.6 } },
    { kind: 'sports', pos: B(0, 10, 8, 6), props: { follow: [{ type: 'team', league: 'eng.1', team: '359', name: 'Premier League' }, { type: 'league', league: 'nba', name: '' }], max: 3 }, style: { scale: 1.3 } },
    { kind: 'stocks', pos: B(8, 10, 8, 6), props: { symbols: STOCKS, layout: 'list' } },
    { kind: 'market', pos: B(16, 10, 8, 6), props: { coins: [{ id: 'solana', currency: 'usd' }, { id: 'ripple', currency: 'usd' }, { id: 'cardano', currency: 'usd' }, { id: 'dogecoin', currency: 'usd' }], layout: 'list', range: '7d', chart: 'line' }, style: { scale: 1.3 } },
  ],
};

export default DATA_SHOWCASE;
