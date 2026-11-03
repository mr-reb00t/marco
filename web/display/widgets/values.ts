// The Value widget (config.widgets type 'value', #34): values pushed by POST /api/hooks/values in a corner, in the
// side column, on the whole screen ('widget' layout) or in a Personalizado card ('widget' item), on any design. One
// key is drawn large (its label, the number and "hace 5 min" under it, as the Valor card); several are a list, one
// row each ("🚗 Car 1  43 %"). The values come from the screen's values feed (valuesFeed.ts), which the server fills
// with only the keys this screen shows (server/core/valuesCore.js screenValueKeys). Everything is written as text: a
// value is never read as HTML, a URL or a colour. The interface is the price widget's (widgets/prices.ts), which
// custom.ts drives.
import type { DisplayWidget, ValueWidgetItem } from '../../shared/types';
import { ctx } from '../ctx';
import type { ValueSource } from '../valuesFeed';
import { valueText } from './canvas/content';
import { ago } from './ha/haui';

export type ValuePlace = 'corner' | 'side' | 'full' | 'canvas';

/** Text size per corner size (the side column 1, the whole screen fills it): the price widget's. */
const SCALE: Record<string, number> = { s: 0.8, m: 1, l: 1.2 };

let source: ValueSource | null = null;
const live = new Set<ValueCard>();

/** Where the widgets read their values (main.ts: the values feed). */
export function setValueSource(s: ValueSource): void {
  source = s;
}

/** The values of the screen changed (a `values` event, a poll, a new screen): every Value widget draws again. */
export function valueWidgetsChanged(): void {
  for (const c of live) c.render();
}

/**
 * Height (px) of a Value widget's smallest readable look: the room the side column keeps for it (custom.ts), so the
 * column drops its secondary content before the values get small. A list keeps its full size (a row: 1.5em of
 * 1.6rem, plus the gap), one value large three quarters of it (its name, the number and "hace 5 min").
 */
export function valueFloorHeight(w: DisplayWidget): number {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  const n = Math.max(1, Math.min(6, w.value?.items?.length ?? 1));
  return (n === 1 ? 2.9 + 0.75 * 10 : 2.9 + n * 2.9 + (n - 1) * 0.8) * rem;
}

const span = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text });

export class ValueCard {
  readonly el: HTMLElement;
  private w: DisplayWidget;
  private sig = '';
  private tick: ReturnType<typeof setInterval> | null = null;
  private place: ValuePlace = 'corner';
  private maxW = 0;
  private maxH = 0;
  /** a Personalizado card's "Estilo de la gráfica" (custom.ts sets it for every card widget; a value has no chart) */
  backdrop = false;
  onState: ((s: 'loading' | 'ok' | 'stale' | 'failed') => void) | null = null;

  constructor(w: DisplayWidget) {
    this.w = w;
    this.el = document.createElement('div');
    this.el.className = 'uw-media pw vw';
  }

  get hasData(): boolean {
    return true;
  }

  private items(): ValueWidgetItem[] {
    return Array.isArray(this.w.value?.items) ? this.w.value.items.filter((x) => x && typeof x.key === 'string' && x.key).slice(0, 6) : [];
  }

  start(): void {
    if (this.tick) return;
    if (!this.items().length) {
      this.onState?.('failed');
      return;
    }
    live.add(this);
    this.render();
    this.onState?.('ok');
    // "hace 5 min" and the grey of an old value move on with the minute
    this.tick = setInterval(() => this.render(), 30_000);
  }

  stop(): void {
    live.delete(this);
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  /** New options from the config: other keys, names or units. */
  update(w: DisplayWidget): void {
    this.w = w;
    this.sig = '';
    this.render();
    this.layout(this.maxW, this.maxH, this.place);
  }

  render(): void {
    const items = this.items();
    const recs = items.map((x) => source?.get(x.key));
    const staleMin = Number(this.w.value?.staleAfterMin) || 0;
    const sig = JSON.stringify([items, staleMin, recs, Math.floor(Date.now() / 60_000), ctx.lang]);
    if (sig === this.sig) return;
    this.sig = sig;
    const stale = (i: number) => {
      const rec = recs[i];
      return !rec || (staleMin > 0 && Date.now() - rec.at > staleMin * 60_000);
    };
    const parts = (x: ValueWidgetItem, i: number) => {
      const rec = recs[i];
      const num = document.createElement('span');
      num.className = 'vw-num';
      const b = Object.assign(document.createElement('b'), { textContent: rec ? valueText(rec.v, Math.min(3, Math.max(0, Number(x.decimals ?? 1)))) : '–' });
      // a word (or Sí/No) is set smaller than a number
      if (rec && typeof rec.v !== 'number') b.className = 'is-text';
      num.appendChild(b);
      const unit = String(x.unit || rec?.u || '');
      if (unit && rec && typeof rec.v === 'number') num.appendChild(span('vw-unit', unit));
      return { label: String(x.label || rec?.l || x.key), num };
    };
    this.el.textContent = '';
    this.el.classList.toggle('vw--one', items.length === 1);
    if (items.length === 1) {
      const x = items[0];
      const rec = recs[0];
      const { label, num } = parts(x, 0);
      const head = document.createElement('div');
      head.className = 'vw-head';
      if (x.icon) head.appendChild(span('vw-icon', x.icon));
      head.appendChild(span('vw-label', label));
      const note = rec === undefined ? ctx.t('cvNoValue') : rec === null ? ctx.t('cvNoData') : ago(rec.at);
      this.el.append(head, num, Object.assign(document.createElement('div'), { className: 'vw-note', textContent: note }));
      this.el.classList.toggle('is-stale', stale(0));
    } else {
      this.el.classList.remove('is-stale');
      const list = document.createElement('div');
      list.className = 'vw-list';
      items.forEach((x, i) => {
        const { label, num } = parts(x, i);
        const row = document.createElement('div');
        row.className = 'vw-row';
        row.classList.toggle('is-stale', stale(i));
        const who = document.createElement('span');
        who.className = 'vw-who';
        if (x.icon) who.appendChild(span('vw-icon', x.icon));
        who.appendChild(span('vw-label', label));
        row.append(who, num);
        list.appendChild(row);
      });
      this.el.appendChild(list);
    }
    if (this.el.isConnected) this.fit();
  }

  /** The room the card may take (px) and where it is: it takes what it needs of it, all of it on the whole screen. */
  layout(maxW: number, maxH: number, place: ValuePlace): void {
    this.maxW = Math.max(0, Math.floor(maxW));
    this.maxH = Math.max(0, Math.floor(maxH));
    this.place = place;
    this.el.classList.toggle('pw--side', place === 'side');
    this.el.classList.toggle('pw--full', place === 'full');
    if (this.el.isConnected) this.fit();
  }

  /**
   * The text size: the corner's (s / m / l) or the side column's, smaller when the card would not fit its room; on the
   * whole screen and in a Personalizado card as large as the room allows.
   */
  private fit(): void {
    const fill = this.place === 'full' || this.place === 'canvas';
    const el = this.el;
    const set = (k: number) => el.style.setProperty('--pk', k.toFixed(3));
    // natural size at the base text size, then scaled to the room
    el.style.width = '';
    el.style.height = '';
    el.style.maxWidth = `${this.maxW}px`;
    const base = this.place === 'corner' ? SCALE[this.w.size] ?? 1 : 1;
    set(1);
    if (this.place === 'side') el.style.width = `${this.maxW}px`;
    const w1 = el.offsetWidth || 1;
    const h1 = el.offsetHeight || 1;
    let k = fill ? Math.min(6, (this.maxW * 0.92) / w1, (this.maxH * 0.86) / h1) : Math.min(base, this.maxH > 0 ? this.maxH / h1 : base);
    k = Math.max(0.5, k);
    set(k);
    if (fill) {
      el.style.width = `${this.maxW}px`;
      el.style.height = `${this.maxH}px`;
    }
    // a long label or value: smaller until it fits (labels end in "…" first, styles.css)
    for (let i = 0; i < 12 && k > 0.5 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 || (!fill && this.maxH > 0 && el.offsetHeight > this.maxH)); i++) {
      k *= 0.92;
      set(k);
    }
  }
}
