// The Currency widget (config.widgets type 'currency', Widgets section): exchange rates of the ECB in a corner, in the
// side column, on the whole screen ('widget' layout) or in a Personalizado card ('widget' item). It draws the very
// card of the Divisas kind (widgets/canvas/data.ts, the same adapter and styles-data.css) inside the glass card of
// the price widget (.pw), so the two look alike on every design. The numbers come from this server only
// (GET /api/display/currency?pairs=, the shared cache of server/core/dataCore.js); in the demo, from made-up answers
// (mockData.ts). The interface is PriceCard's (widgets/prices.ts), which custom.ts drives.
import type { CurrencyData, CurrencyOptions, DisplayCanvasItem, DisplayWidget } from '../../shared/types';
import { ApiError, getJSON } from '../api';
import { ctx } from '../ctx';
import { withScreen } from '../identity';
import { demoItem } from '../mockData';
import { DATA_ADAPTERS } from './canvas/data';
import type { AdapterEnv, CanvasAdapter } from './canvas/types';

export type CurrencyPlace = 'corner' | 'side' | 'full' | 'canvas';

const POLL_MS = 10 * 60_000;
const RETRY_MS = 60_000;
/** Text size of the card per corner size (the side column 1, the whole screen 1.9): the price widget's. */
const SCALE: Record<string, number> = { s: 0.8, m: 1, l: 1.2 };
/** Below this height (rem, times the text size) the card is one line: a pair, its rate and change (the compact look). */
const LINE_REM = 7;

/** Height (px) of the smallest card, one line: the room the side column keeps for one (custom.ts). */
export function currencyFloorHeight(): number {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  return 6.4 * rem;
}

/** The query of a widget's options: one feed per pairs, period and curve, shared by the widgets that ask the same. */
export function currencyQuery(o: CurrencyOptions | undefined): string {
  if (!o?.pairs?.length) return '';
  const pairs = o.pairs.slice(0, 6).map((x) => `${x.base}-${x.quote}`).join(',');
  return `pairs=${encodeURIComponent(pairs)}&range=${encodeURIComponent(o.range)}&chart=${encodeURIComponent(o.chart)}`;
}

interface Feed {
  subs: Set<(d: CurrencyData | null, failed: boolean, at: number) => void>;
  data: CurrencyData | null;
  failed: boolean;
  at: number;
  timer: ReturnType<typeof setTimeout> | null;
}
const feeds = new Map<string, Feed>();

async function poll(key: string, f: Feed): Promise<void> {
  if (f.timer) clearTimeout(f.timer);
  f.timer = null;
  if (document.hidden) {
    document.addEventListener('visibilitychange', () => void poll(key, f), { once: true });
    return;
  }
  let next = POLL_MS;
  try {
    if (ctx.params.get('demo') === '1') {
      const q = new URLSearchParams(key);
      const pairs = (q.get('pairs') ?? '').split(',').map((x) => ({ base: x.split('-')[0], quote: x.split('-')[1] }));
      f.data = (await demoItem('currency', { pairs, range: q.get('range'), chart: q.get('chart') })) as CurrencyData | null;
    } else f.data = await getJSON<CurrencyData>(withScreen(`/api/display/currency?${key}`), 15_000);
    f.failed = !f.data;
    f.at = Date.now();
  } catch (e) {
    // private: nothing to show; anything else keeps the last numbers and asks again sooner
    if (e instanceof ApiError && (e.status === 403 || e.status === 400)) f.data = null;
    f.failed = true;
    next = f.data ? POLL_MS / 2 : RETRY_MS;
  }
  if (feeds.get(key) !== f) return;
  for (const cb of f.subs) cb(f.data, f.failed, f.at);
  f.timer = setTimeout(() => void poll(key, f), next * (0.9 + Math.random() * 0.2));
}

function subscribe(key: string, cb: Feed['subs'] extends Set<infer F> ? F : never): () => void {
  let f = feeds.get(key);
  if (!f) {
    f = { subs: new Set(), data: null, failed: false, at: 0, timer: null };
    feeds.set(key, f);
    void poll(key, f);
  } else if (f.data || f.failed) cb(f.data, f.failed, f.at);
  f.subs.add(cb);
  const feed = f;
  return () => {
    feed.subs.delete(cb);
    if (feed.subs.size) return;
    if (feed.timer) clearTimeout(feed.timer);
    feeds.delete(key);
  };
}

export class CurrencyCard {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private w: DisplayWidget;
  private adapter: CanvasAdapter;
  /** undefined: nothing asked yet; null: the server had nothing */
  private data: CurrencyData | null | undefined = undefined;
  private at = 0;
  private key = '';
  private unsub: (() => void) | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private place: CurrencyPlace = 'corner';
  private maxW = 0;
  private maxH = 0;
  /** the text size of the place (corner s / m / l, the side column, the whole screen) */
  private k = 1;
  /** a Personalizado card with "Estilo de la gráfica" De fondo (custom.ts passes it on, as for the price widget) */
  backdrop = false;
  onState: ((s: 'loading' | 'ok' | 'stale' | 'failed') => void) | null = null;

  constructor(w: DisplayWidget) {
    this.w = w;
    this.el = document.createElement('div');
    this.el.className = 'uw-media pw fxw';
    this.body = document.createElement('div');
    this.body.className = 'fxw-body';
    this.el.appendChild(this.body);
    this.adapter = DATA_ADAPTERS.currency(this.item());
    const env = {
      item: () => this.item(),
      cfg: () => ctx.cfg,
      low: () => ctx.params.get('lite') === '1' || document.documentElement.classList.contains('lite'),
      data: {
        get: () => this.data,
        age: () => (this.data && typeof this.data.age === 'number' ? this.data.age + Math.max(0, Math.round((Date.now() - this.at) / 1000)) : null),
        crest: () => null,
      },
    } as unknown as AdapterEnv;
    this.adapter.mount(this.body, env);
  }

  /** The widget as a Divisas item: its options are the card's props. */
  private item(): DisplayCanvasItem {
    const o = this.w.currency;
    const props = { ...(o ?? {}), chartStyle: this.backdrop ? 'background' : o?.chartStyle ?? 'below' };
    return { id: this.w.id, kind: 'currency', props, style: { scale: this.k }, v: JSON.stringify([props, this.k]) } as unknown as DisplayCanvasItem;
  }

  get hasData(): boolean {
    return !!this.data?.pairs?.length;
  }

  start(): void {
    if (this.unsub) return;
    this.key = currencyQuery(this.w.currency);
    if (!this.key) {
      this.onState?.('failed');
      return;
    }
    this.unsub = subscribe(this.key, (d, failed, at) => {
      this.data = d;
      this.at = at;
      this.adapter.data?.('data');
      this.onState?.(d ? (d.stale || failed ? 'stale' : 'ok') : 'failed');
    });
    if (this.data === undefined) this.onState?.('loading');
    // the minute (the "updated X ago" line) and the big card's turns
    this.tick = setInterval(() => this.adapter.tick?.({ minuteChanged: new Date().getSeconds() === 0 } as never), 1000);
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  /** New options from the config: other pairs, period or curve ask another feed. */
  update(w: DisplayWidget): void {
    this.w = w;
    if (this.unsub && currencyQuery(w.currency) !== this.key) {
      this.stop();
      this.data = undefined;
      this.start();
    }
    this.layout(this.maxW, this.maxH, this.place);
  }

  /** The room the card may take (px) and where it is: it takes what it needs of it, all of it on the whole screen. */
  layout(maxW: number, maxH: number, place: CurrencyPlace): void {
    this.maxW = Math.max(0, Math.floor(maxW));
    this.maxH = Math.max(0, Math.floor(maxH));
    this.place = place;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const k = place === 'full' ? 1.9 : place === 'corner' ? SCALE[this.w.size] ?? 1 : 1;
    this.k = k;
    const o = this.w.currency;
    const n = Math.max(1, o?.pairs?.length ?? 1);
    const chart = o?.chart !== 'none';
    const bands = chart && o?.chartStyle === 'background' && o?.layout !== 'big';
    // what a list of n pairs or the big card wants, padding included
    const want = (o?.layout === 'big' ? (chart ? 24 : 12) : 5.4 + n * (bands ? 5.6 : 4.2)) * rem * k + 3 * rem;
    const fill = place === 'full' || place === 'canvas';
    const w = fill || place === 'side' ? this.maxW : Math.min(this.maxW, 40 * rem * k);
    const h = fill ? this.maxH : Math.min(this.maxH, Math.round(want));
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    this.el.style.setProperty('--cv-scale', String(k));
    this.el.classList.toggle('pw--side', place === 'side');
    this.el.classList.toggle('pw--full', place === 'full');
    if (!this.el.isConnected) return;
    // too short for a list or the big card (a crowded side column): one line, as a Divisas card one cell high
    if (this.body.clientHeight < LINE_REM * rem * Math.min(1, k)) {
      this.body.dataset.mini = '';
      this.body.dataset.mh = '1';
    } else {
      delete this.body.dataset.mini;
      delete this.body.dataset.mh;
    }
    this.adapter.layout?.({ w: this.body.clientWidth, h: this.body.clientHeight, rem, size: 'm', zone: 'main' });
  }
}
