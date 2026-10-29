// Countdown chips (F4): "🎄 Navidad · Faltan 12 días", "¡Mañana!", "¡Hoy!".
// Rendered into the side panel card and into a horizontal strip used by layouts without a side-mid area
// (portrait, topBottom). `days` is always recomputed locally from `date`, so midnight needs no refetch.
import type { CountdownItem, CountdownsResponse, DisplayConfig } from '../../shared/types';
import { diffDays } from '../../shared/i18n';
import { chipColors } from '../color';
import { ctx } from '../ctx';
import { esc, reconcile, type Spec } from '../dom';

export interface CdView {
  item: CountdownItem;
  days: number;
}

/** Upcoming items (today or later) with locally recomputed days, nearest first, capped at `max`. */
export function upcomingCountdowns(data: CountdownsResponse | null, today: string, max: number): CdView[] {
  if (!data?.items?.length) return [];
  const out: CdView[] = [];
  for (const item of data.items) {
    if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
    const days = diffDays(today, item.date);
    if (days < 0) continue;
    out.push({ item, days });
  }
  const rank = (v: CdView) => (v.item.origin === 'manual' ? 0 : 1);
  out.sort((a, b) => a.days - b.days || rank(a) - rank(b) || a.item.title.localeCompare(b.item.title));
  return out.slice(0, Math.max(0, max));
}

function title(it: CountdownItem): string {
  const t = (it.title || '').trim() || '–';
  return typeof it.age === 'number' && Number.isFinite(it.age) && it.age >= 0 ? `${t} (${it.age})` : t;
}

/** `short`: "12 días" instead of "Faltan 12 días" (a narrow canvas card). */
function whenHtml(days: number, short = false): string {
  const { t } = ctx;
  if (days === 0) return esc(t('cdToday'));
  if (days === 1) return esc(t('cdTomorrow'));
  if (short) return `<b>${days}</b> ${esc(t('daysWord'))}`;
  // bold number inside the localized sentence ("Faltan <b>12</b> días")
  const marker = '\u0001';
  return esc(t('cdDays', { n: marker })).replace(marker, `<b>${days}</b>`);
}

export class Countdowns {
  /** The settings these chips read (the screen's, or a canvas item's merged over them). */
  private readonly cfg: () => DisplayConfig;

  /** The days left in short ("12 días"): a narrow canvas card sets it. */
  short = false;

  /** `opts.cfg`: where the settings come from (default: the screen's, ctx.cfg). */
  constructor(private card: HTMLElement, private strip: HTMLElement, opts: { cfg?: () => DisplayConfig } = {}) {
    this.cfg = opts.cfg ?? (() => ctx.cfg);
    card.classList.add('cd-card');
    strip.classList.add('cd-strip');
  }

  /**
   * @param shownToday titles (as rendered) already featured today by the highlight pills (e.g. "María (34)"):
   *   a same-day birthday chip would only repeat them.
   */
  render(data: CountdownsResponse | null, today: string, shownToday: Set<string> = new Set()): void {
    const screenCfg = this.cfg();
    const cfg = screenCfg.countdowns ?? { enabled: true, max: 4 };
    const filtered = data
      ? { ...data, items: data.items.filter((it) => !(it.origin === 'birthday' && it.date === today && shownToday.has(title(it)))) }
      : null;
    const list = cfg.enabled ? upcomingCountdowns(filtered, today, cfg.max) : [];
    const show = list.length > 0;
    this.card.style.display = show ? '' : 'none';
    this.strip.style.display = show ? '' : 'none';
    const specs = (variant: 'c' | 's'): Spec[] =>
      list.map(({ item, days }) => {
        const col = chipColors(item.color || screenCfg.screen.accent);
        const cls = ['cd', days === 0 ? 'is-today' : '', days === 1 ? 'is-tomorrow' : '', `o-${item.origin}`].filter(Boolean).join(' ');
        return {
          key: `${variant}${item.id}|${item.date}`,
          className: cls,
          style: `--c:${col.base};--tint:${col.tint};--on:${col.onSolid};--deep:${col.shade}`,
          html: `<span class="cd-em">${esc(item.emoji || '⏳')}</span><span class="cd-tt">${esc(title(item))}</span><span class="cd-when">${whenHtml(days, this.short)}</span>`,
        };
      });
    reconcile(this.card, specs('c'), { flip: true });
    reconcile(this.strip, specs('s'), { flip: true });
  }
}
