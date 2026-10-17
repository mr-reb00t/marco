// Personalizado Home Assistant chart: 1 to 4 numeric sensors over the last hour, 6 hours, 24 hours or 7 days, as
// lines, areas or bars, hand-drawn SVG (the pattern of the price card). The server sends at most 200 points per
// series (history up to 24 h, hourly statistics beyond) and labels them; this page never sees an entity id.
import type { DisplayCanvasItem, HaHistory } from '../../../shared/types';
import { ctx } from '../../ctx';
import { aliasOf, fmtNum, svgEl } from '../ha/haui';
import { chartStyleOf, fade } from './curve';
import type { AdapterBox, AdapterEnv, CanvasAdapter } from './types';
import { offNote } from './ha';

type Props = Record<string, any>;
/** Series colours when the owner picked none: the accent first, then the semantic tokens of styles-ha.css. */
const PALETTE = ['var(--accent, #4f8cff)', 'var(--ha-cool, #5ac8fa)', 'var(--ha-heat, #ff9f43)', 'var(--ha-alert, #ff6b6b)'];
const REFRESH_MS = 2 * 60_000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Decimals that suit a range of values. */
const decimalsFor = (lo: number, hi: number) => (hi - lo >= 20 ? 0 : hi - lo >= 2 ? 1 : 2);

function timeLabel(t: number, period: string): string {
  try {
    const d = new Date(t);
    if (period === '7d') return new Intl.DateTimeFormat(ctx.lang, { weekday: 'short', timeZone: ctx.tz }).format(d);
    return new Intl.DateTimeFormat(ctx.lang, { hour: '2-digit', minute: '2-digit', hour12: !ctx.cfg.datetime.format24, timeZone: ctx.tz }).format(d);
  } catch {
    return '';
  }
}

function draw(root: HTMLElement, h: HaHistory, p: Props, box: AdapterBox | null): void {
  // "De fondo": the chart fills the card under the heading, edge to edge and down to its bottom edge, no axes (the
  // legend over it says the values now)
  const bg = chartStyleOf(p, 'below') === 'background';
  // a small box (the compact look, data-mini, widgets/canvas.ts): a sparkline, the values now on one line over it, no
  // axes and no period
  const spark = root.dataset.mini !== undefined;
  root.classList.toggle('is-bg', bg);
  root.classList.toggle('has-bgchart', bg);
  const series = h.series.map((s, i) => ({ ...s, color: (p.series?.[i]?.color as string | null) || PALETTE[i % PALETTE.length] })).filter((s) => s.points.length);
  const head = el('div', 'cv-ha-chart-head');
  if (!spark) head.appendChild(el('span', 'cv-ha-chart-period', ctx.t(`haPeriod${h.period}`)));
  const legend = el('div', 'cv-ha-legend');
  for (const s of series) {
    const last = s.points[s.points.length - 1][1];
    const ys = s.points.map((x) => x[1]);
    const d = decimalsFor(Math.min(...ys), Math.max(...ys));
    const li = el('span', 'cv-ha-leg');
    const sw = el('i', 'sw');
    sw.style.background = s.color;
    const now = el('b', 'now', `${fmtNum(last, d)}${s.unit ? ` ${s.unit}` : ''}`);
    now.dataset.bare = fmtNum(last, d);
    li.append(sw, el('span', 'l', s.label), now);
    legend.appendChild(li);
  }
  head.appendChild(legend);
  root.appendChild(head);
  // the sparkline's values in a narrow box: the names go first, then the units, so every value shows whole
  if (spark && legend.scrollWidth > legend.clientWidth + 1) {
    for (const l of legend.querySelectorAll('.l')) l.remove();
    if (legend.scrollWidth > legend.clientWidth + 1) for (const n of legend.querySelectorAll<HTMLElement>('.now')) n.textContent = n.dataset.bare ?? '';
  }
  if (!series.length) {
    root.appendChild(el('span', 'cv-ha-note', ctx.t('haNoData')));
    return;
  }
  const all = series.flatMap((s) => s.points);
  const x0 = Math.min(...all.map((x) => x[0]));
  const x1 = Math.max(...all.map((x) => x[0]));
  const ys = all.map((x) => x[1]);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (p.type === 'bar') lo = Math.min(0, lo);
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.08;
  hi += pad;
  if (p.type !== 'bar') lo -= pad;
  // the drawing is sized in the card's own pixels, so text and strokes keep their size whatever the card's shape
  const rem = box?.rem ?? 10;
  // the body's box less its padding, the heading and the gap (a background chart: the whole body under the heading)
  const cs = getComputedStyle(root);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const headBottom = head.offsetTop + head.offsetHeight;
  const W = bg ? Math.max(120, Math.floor(box?.w ?? root.clientWidth)) : Math.max(120, Math.floor((box?.w ?? root.clientWidth) - padX));
  const H = bg
    ? Math.max(spark ? 16 : 60, Math.floor((box?.h ?? root.clientHeight) - headBottom - rem * 0.4))
    : Math.max(spark ? 16 : 60, Math.floor((box?.h ?? root.clientHeight) - padY - head.getBoundingClientRect().height - rem * (spark ? 0.4 : 0.8)));
  // the unit once, on the axis's top value, when every series shares it (the legend says it for the rest)
  const units = [...new Set(series.map((s) => s.unit ?? ''))];
  const unit = units.length === 1 && units[0] && units[0].length <= 5 ? units[0] : '';
  const left = bg || spark ? 0 : rem * (3.8 + (unit ? 0.75 * (unit.length + 1) : 0));
  // (a background chart keeps a line at zero just off the card's bottom edge)
  const bottom = bg || spark ? rem * 0.35 : rem * 1.9;
  const top = rem * 0.6;
  const plotW = bg ? W : W - left - rem * (spark ? 0.6 : 0.4);
  const plotH = H - top - bottom;
  const X = (t: number) => left + ((t - x0) / (x1 - x0 || 1)) * plotW;
  const Y = (v: number) => top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'cv-ha-chart-svg', 'aria-hidden': 'true' });
  const d = decimalsFor(lo, hi);
  for (const [i, v] of (bg || spark ? [] : [hi - pad, (hi - pad + lo + (p.type === 'bar' ? 0 : pad)) / 2, lo + (p.type === 'bar' ? 0 : pad)]).entries()) {
    svg.appendChild(svgEl('line', { x1: left, x2: W - rem * 0.4, y1: Y(v), y2: Y(v), class: 'grid' }));
    const t = svgEl('text', { x: left - rem * 0.4, y: Y(v) + rem * 0.35, class: 'ax', 'text-anchor': 'end' });
    t.textContent = i === 0 && unit ? `${fmtNum(v, d)} ${unit}` : fmtNum(v, d);
    svg.appendChild(t);
  }
  for (const [i, t] of (bg || spark ? [] : [x0, (x0 + x1) / 2, x1]).entries()) {
    const tx = svgEl('text', { x: X(t), y: H - rem * 0.45, class: 'ax', 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle' });
    tx.textContent = timeLabel(t, h.period);
    svg.appendChild(tx);
  }
  series.forEach((s, si) => {
    // each series in its own colour: the line, the fade under it and the bars take it from the group (curve.ts)
    const g = svgEl('g', { class: 'sr', style: `color: ${s.color}` });
    svg.appendChild(g);
    if (p.type === 'bar') {
      // behind the text, each bar fades to nothing at its foot like the areas; under it, solid as before
      const barFill = bg ? fade(g, true, [0, H]) : 'currentColor';
      const n = s.points.length;
      const slot = plotW / Math.max(1, n) / series.length;
      const bw = Math.max(1, slot * 0.8);
      for (const [t, v] of s.points) {
        const x = X(t) - (slot * series.length) / 2 + si * slot;
        const y = Y(Math.max(0, v));
        g.appendChild(svgEl('rect', { x: x.toFixed(1), y: y.toFixed(1), width: bw.toFixed(1), height: Math.max(0.5, Math.abs(Y(v) - Y(0))).toFixed(1), fill: barFill, class: 'bar' }));
      }
      return;
    }
    const line = s.points.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    if (p.type === 'area') {
      const base = bg ? H : Y(lo);
      g.appendChild(svgEl('path', { d: `${line}L${X(s.points[s.points.length - 1][0]).toFixed(1)},${base.toFixed(1)}L${X(s.points[0][0]).toFixed(1)},${base.toFixed(1)}Z`, fill: fade(g), class: 'ar area' }));
    }
    g.appendChild(svgEl('path', { d: line, class: 'ln line' }));
    // the value now as a dot at the end of the line (not on a background chart: its end is the card's edge)
    if (bg) return;
    const [lt, lv] = s.points[s.points.length - 1];
    g.appendChild(svgEl('circle', { cx: X(lt).toFixed(1), cy: Y(lv).toFixed(1), r: rem * 0.3, class: 'now' }));
  });
  // (no line of lowest and highest values under it: the axis already reads them, the legend the values now)
  if (bg) {
    const holder = el('div', 'cv-bgchart cv-ha-chart-bg');
    holder.style.top = `${Math.round(headBottom + rem * 0.4)}px`;
    holder.appendChild(svg);
    root.appendChild(holder);
  } else root.appendChild(svg);
}

function chart(item0: DisplayCanvasItem): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let box: AdapterBox | null = null;
  let hist: HaHistory | null = null;
  let at = 0;
  let asking = false;
  let drawn = '';
  const bound = () => ((env.item().props as Props).series ?? []).filter((s: Props) => aliasOf(s.entity));
  const render = (force = false) => {
    const it = env.item();
    const off = env.ha.off();
    const key = `${it.v}|${box?.w}x${box?.h}|${at}|${ctx.lang}|${env.ha.conn()}|${off}`;
    if (key === drawn && !force) return;
    drawn = key;
    root.textContent = '';
    root.classList.toggle('is-ha-down', env.ha.conn() === 'down' && !off);
    root.classList.toggle('is-ha-off', off);
    if (off) return offNote(root);
    if (!bound().length) {
      root.appendChild(el('span', 'cv-ha-note', ctx.t('cvSetup')));
      return;
    }
    // a changed item keeps its last points until the new ones come
    if (hist) draw(root, hist, it.props as Props, box);
    else root.appendChild(el('span', 'cv-ha-note', ctx.t(asking || !at ? 'haWaiting' : 'haNoData')));
    if (env.ha.conn() === 'down') {
      const dot = el('span', 'cv-ha-down');
      dot.title = ctx.t('haOffline');
      root.appendChild(dot);
    }
  };
  const load = () => {
    if (asking || !bound().length) return;
    const it = env.item();
    const v = it.v;
    asking = true;
    void env.ha.history(item0.id, v).then((h) => {
      asking = false;
      at = Date.now();
      if (env.item().v !== v) return;
      hist = h;
      render(true);
    });
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-ha', 'cv-ha-chart');
      render(true);
      load();
    },
    update() {
      render(true);
      load();
    },
    layout(b) {
      box = b;
      render();
    },
    tick(t) {
      if (t.minuteChanged && Date.now() - at > REFRESH_MS) load();
    },
    data(topic) {
      if (topic === 'ha') render();
    },
    destroy() {
      root.textContent = '';
    },
  };
}

export const CHART_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  'ha.chart': (item) => chart(item),
};
