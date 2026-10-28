// Agenda list view (today / tomorrow / next days) with big emojis.
// How far it looks ahead is calendar.agendaDays (agendaFill.ts): a number of days, or 'auto', which lays every
// candidate day out in a hidden copy of the agenda, keeps the leading day blocks that fit whole and shows those.
import type { AgendaDays, DisplayConfig } from '../../shared/types';
import { agendaHorizon, agendaKeep } from '../agendaFill';
import { addDays, diffDays, relativeDayLabel, weekdayName, keyToUTC, monthName } from '../../shared/i18n';
import { chipColors } from '../color';
import { ctx } from '../ctx';
import { esc, reconcile, type Spec } from '../dom';
import { type NEvent, sortForDay, timeLabel } from '../eventModel';
import type { Tick } from '../time';

export class Agenda {
  /** Hidden copy of the agenda the 'auto' days are measured in (created on first use). */
  private probe: HTMLElement | null = null;
  /** Last 'auto' measurement: what was laid out (the day blocks, the box, the look) and how many blocks fit. */
  private fill: { sig: string; keep: number } | null = null;

  /** The settings this agenda reads (the screen's, or a canvas item's merged over them). */
  private readonly cfg: () => DisplayConfig;

  /**
   * `days`: a fixed number of days (the side agenda), or omitted to follow calendar.agendaDays.
   * `cfg`: where the settings come from (default: the screen's, ctx.cfg); every read goes through it.
   */
  /** `legend: false`: never the legend line (the small side agenda), whatever calendar.showLegend says. */
  constructor(private root: HTMLElement, private opts: { days?: number; compact?: boolean; maxPerDay?: number; legend?: boolean; cfg?: () => DisplayConfig }) {
    this.cfg = opts.cfg ?? (() => ctx.cfg);
    root.classList.add('agenda');
    if (opts.compact) root.classList.add('compact');
  }

  render(events: NEvent[], tick: Tick): void {
    const setting: AgendaDays | number = this.opts.days ?? this.cfg().calendar.agendaDays ?? 'auto';
    const { specs, offsets } = this.days(events, tick, agendaHorizon(setting));
    const legend = this.legend();
    let shown = specs;
    if (setting === 'auto' && specs.length) shown = specs.slice(0, this.autoKeep(specs, offsets, legend));
    if (!shown.length) shown = [{ key: 'empty', className: 'ag-empty big', html: esc(ctx.t('noUpcoming')) }];
    reconcile(this.root, legend ? [legend, ...shown] : shown, { flip: true });
  }

  /** calendar.showLegend: a line over the day blocks with each calendar's colour and name (as the month view's). */
  private legend(): Spec | null {
    const c = this.cfg().calendar;
    if (this.opts.legend === false || !c.showLegend || !c.sources.length) return null;
    const html = c.sources
      .map((s) => `<span class="lg"><i style="--c:${chipColors(s.color).base}"></i>${s.emoji ? `<span class="em">${esc(s.emoji)}</span>` : ''}${esc(s.name)}</span>`)
      .join('');
    return { key: 'legend', className: 'legend ag-legend', html };
  }

  /**
   * 'auto': lay every candidate day out in a hidden agenda of the same size and look, and keep the leading day
   * blocks that are fully inside it (agendaKeep). Measured again only when the days, the size or the look change,
   * and the visible agenda is written once, so a render never feeds back into the next one.
   */
  private autoKeep(specs: Spec[], offsets: number[], legend: Spec | null): number {
    const root = this.root;
    const w = root.offsetWidth, h = root.offsetHeight;
    // not on screen (another view, booting): show what the 14 days would show; the next render measures
    if (!w || !h || !root.parentElement) return agendaKeep(offsets, offsets.map(() => false));
    let fonts = '';
    try {
      fonts = document.fonts?.status ?? '';
    } catch { /* old browser */ }
    const sig = `${w}x${h}|${root.className}|${document.documentElement.className}|${fonts}|${legend?.html ?? ''}|${specs.map((s) => `${s.key}|${s.className}|${s.html}`).join('\n')}`;
    if (this.fill?.sig === sig) return this.fill.keep;
    let probe = this.probe;
    if (!probe) {
      probe = this.probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
    }
    probe.className = root.className;
    probe.classList.add('ag-probe');
    probe.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;visibility:hidden;pointer-events:none;`;
    if (probe.parentElement !== root.parentElement) root.parentElement.appendChild(probe);
    // the legend first, as on screen: it takes its room, but only the day blocks are measured
    probe.innerHTML = (legend ? [legend, ...specs] : specs).map((s) => `<div class="${s.className}">${s.html}</div>`).join('');
    const box = probe.getBoundingClientRect();
    const cs = getComputedStyle(probe);
    const right = box.right - (parseFloat(cs.paddingRight) || 0) + 1;
    const bottom = box.bottom - (parseFloat(cs.paddingBottom) || 0) + 1;
    const fits = Array.from(probe.children).slice(legend ? 1 : 0).map((d) => {
      const r = d.getBoundingClientRect();
      return r.right <= right && r.bottom <= bottom;
    });
    // emptied right away: nothing else (the sliding titles) ever sees the copy
    probe.innerHTML = '';
    const keep = agendaKeep(offsets, fits);
    this.fill = { sig, keep };
    return keep;
  }

  /** The day blocks of the next `horizon` days (Today and Tomorrow always, later days only with events). */
  private days(events: NEvent[], tick: Tick, horizon: number): { specs: Spec[]; offsets: number[] } {
    const cfg = this.cfg();
    const { lang, tz, t } = ctx;
    const c = cfg.calendar;
    const today = tick.dayKey;
    const nowMs = tick.now.getTime();
    const specs: Spec[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < horizon; i++) {
      const key = addDays(today, i);
      const items: { e: NEvent; sub: string; badge?: string }[] = [];
      for (const e of events) {
        if (e.spanFirst > key || e.spanLast < key) continue;
        if (e.timed && i === 0 && e.endMs <= nowMs && this.opts.compact) continue;
        let sub = '';
        let badge: string | undefined;
        if (e.checkoutMarker) {
          badge = t('checkOut');
        } else if (e.airbnb) {
          if (key === e.spanFirst) badge = t('checkIn');
          else if (key === e.spanLast) badge = `${t('checkOut')} 🚪`;
          else if (i !== 0) continue;
          else sub = t('dayXofY', { x: diffDays(e.spanFirst, key) + 1, y: e.days + 1 });
        } else if (e.bar && e.days > 1) {
          if (key !== e.spanFirst && i !== 0) continue;
          sub = c.showDayXofY ? t('dayXofY', { x: diffDays(e.spanFirst, key) + 1, y: e.days }) : t('allDay');
        } else if (e.allDay) {
          sub = t('allDay');
        } else {
          sub = timeLabel(e, tz, cfg.datetime.format24, cfg.datetime.showAmPm, true);
        }
        if (c.showLocation && e.ev.location) sub += ` · ${e.ev.location}`;
        items.push({ e, sub, badge });
      }
      if (!items.length && i > 1) continue;
      items.sort((a, b) => sortForDay(a.e, b.e));
      const max = this.opts.maxPerDay ?? 99;
      const rows = items.slice(0, max).map(({ e, sub, badge }) => {
        const col = chipColors(e.color);
        const past = e.timed && e.endMs <= nowMs;
        const now = e.timed && e.startMs <= nowMs && e.endMs > nowMs;
        return `<div class="ag-ev${past ? ' past' : ''}${now ? ' ongoing' : ''}" style="--c:${col.base};--tint:${col.tint};--shade:${col.shade}">
          <span class="ag-em">${e.emoji ? esc(e.emoji) : '<i class="ag-dot"></i>'}</span>
          <div class="ag-main"><div class="ag-tt">${esc(e.title)}</div>${sub || badge ? `<div class="ag-sub">${badge ? `<b class="badge">${esc(badge)}</b>` : ''}${esc(sub)}</div>` : ''}</div>
        </div>`;
      });
      if (items.length > max) rows.push(`<div class="ag-more">${esc(t('more', { n: items.length - max }))}</div>`);
      if (!rows.length) rows.push(`<div class="ag-empty">${esc(t('noEvents'))}</div>`);
      const d = keyToUTC(key);
      const rel = relativeDayLabel(lang, key, today, false);
      // Dutch, Danish and Polish write the month in lower case ("Dinsdag 13 okt", "Wtorek 13 paź"); Danish puts a dot
      // after the day ("Tirsdag 13. okt")
      const mon = monthName(lang, d.getUTCMonth() + 1, 'short');
      const dateStr = `${weekdayName(lang, key, 'long')} ${d.getUTCDate()}${lang === 'da' ? '.' : ''} ${lang === 'nl' || lang === 'da' || lang === 'pl' ? mon.toLowerCase() : mon}`;
      const label = i < 2 ? `<b>${esc(rel)}</b><span>${esc(dateStr)}</span>` : `<b>${esc(dateStr)}</b>`;
      specs.push({
        key: `d${key}`,
        className: `ag-day${i === 0 ? ' today' : ''}`,
        html: `<div class="ag-date">${label}</div><div class="ag-list">${rows.join('')}</div>`,
      });
      offsets.push(i);
    }
    return { specs, offsets };
  }
}
