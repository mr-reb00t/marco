// The commute time widget ('commute'): drawn by the display from GET /api/display/commute?id=&v= (server/commute.js).
// Placed by widgets/custom.ts like any widget: a corner, the side column or the whole screen (the 'widget' layout).
// The display never has the addresses: it asks by widget id and gets route names and times.
import type { CommuteMode, CommuteResponse, CommuteRouteResult, DisplayCommuteOptions, DisplayWidget } from '../../shared/types';
import { delayMinutes, formatDistance, formatDurationParts, MIN_COMMUTE_REFRESH_MIN } from '../../../server/core/commuteCore.js';
import { formatTime } from '../../shared/i18n';
import { ApiError, getJSON } from '../api';
import { ctx } from '../ctx';
import { isPreview, withScreen } from '../identity';
import { googleMapsAttr, inkGoogleMapsAttr } from './googleMapsAttr';

const RETRY_MS = 60_000;
const SVG = 'http://www.w3.org/2000/svg';
const SCALE: Record<string, number> = { s: 0.85, m: 1, l: 1.16 };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const MODE_PATHS: Record<CommuteMode, string> = {
  driving: 'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11m-15 0h16v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5zm3 2.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  transit: 'M6 4h12a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3l2 2H5l2-2a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2zm0 3v5h12V7H6zm2.5 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  bicycling: 'M5.5 17.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm13 0a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zM15 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-3 5.5L9.5 9l3-2.5 2 2h3v2h-3.8l-1.2-1.2-1.5 1.2 1 3.5H5.5',
  walking: 'M13.5 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6a2 2 0 0 0-1.7-1c-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7',
};

function modeIcon(mode: CommuteMode): SVGSVGElement {
  const s = svgEl('svg', { viewBox: '0 0 24 24', class: `cw-mode cw-mode--${mode}`, 'aria-hidden': 'true' });
  s.appendChild(svgEl('path', {
    d: MODE_PATHS[mode] || MODE_PATHS.driving,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.9,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));
  return s;
}

function demoCommute(opts: DisplayCommuteOptions | undefined): CommuteResponse {
  const routes = opts?.routes?.length
    ? opts.routes
    : [
        { id: 'cr_1', name: 'Work', mode: 'driving' as const },
        { id: 'cr_2', name: 'School', mode: 'driving' as const },
      ];
  return {
    fetchedAt: new Date().toISOString(),
    keySet: true,
    routes: routes.map((r, i) => ({
      id: r.id,
      name: r.name,
      mode: r.mode || 'driving',
      reversed: false,
      active: true,
      ok: true,
      durationSec: i === 0 ? 24 * 60 : 12 * 60,
      normalDurationSec: i === 0 ? 19 * 60 : 12 * 60,
      delaySec: i === 0 ? 5 * 60 : 0,
      traffic: i === 0 ? 'moderate' : 'clear',
      distanceMeters: i === 0 ? 18400 : 6200,
      summary: i === 0 ? 'I-95 N' : 'Main St',
      provider: 'demo',
      fetchedAt: new Date().toISOString(),
      stale: false,
    })),
  };
}

export class CommuteCard {
  readonly el: HTMLElement;
  private w: DisplayWidget;
  private data: CommuteResponse | null = null;
  private failed = false;
  /** admin preview of a widget not saved yet (or changed): a note until it is saved */
  private unsaved = false;
  /** preview only: the server answered 404 (new, not on this screen, or the screen is private) */
  private notShown = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private place: 'corner' | 'side' | 'full' = 'corner';
  private maxW = 0;
  private maxH = 0;
  backdrop = false;
  onState: ((s: 'loading' | 'ok' | 'stale' | 'failed') => void) | null = null;

  constructor(w: DisplayWidget) {
    this.w = w;
    this.el = el('div', 'uw-media cw');
  }

  get hasData(): boolean {
    return Boolean(this.data || this.unsaved || (this.w.commute?.routes && this.w.commute.routes.length));
  }

  start(): void {
    if (!this.data && !this.failed) {
      this.draw();
      this.onState?.('loading');
    }
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  update(w: DisplayWidget): void {
    const prev = `${this.w.v}|${JSON.stringify(this.w.commute)}`;
    this.w = w;
    if (`${w.v}|${JSON.stringify(w.commute)}` !== prev) {
      void this.poll();
    } else {
      this.draw();
    }
  }

  layout(maxW: number, maxH: number, place: 'corner' | 'side' | 'full'): void {
    this.maxW = maxW;
    this.maxH = maxH;
    this.place = place;
    this.fit();
  }

  private async poll(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (document.hidden) {
      document.addEventListener('visibilitychange', () => void this.poll(), { once: true });
      return;
    }
    const opts = this.w.commute;
    const pollMs = Math.max(MIN_COMMUTE_REFRESH_MIN, opts?.refreshMin || MIN_COMMUTE_REFRESH_MIN) * 60_000;
    let next = pollMs;
    try {
      // the widget id and its version only: the server reads the routes from the saved widget
      const path = `/api/display/commute?id=${encodeURIComponent(this.w.id)}&v=${encodeURIComponent(this.w.v)}`;
      this.data = await getJSON<CommuteResponse>(withScreen(path));
      this.failed = false;
      this.unsaved = false;
      this.notShown = false;
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (ctx.params.get('demo') === '1') {
        this.data = demoCommute(opts);
        this.failed = false;
      } else if (isPreview && (status === 404 || status === 409)) {
        // the admin preview: the server answers only for a saved widget (409 'unsaved' for a changed one) that the
        // previewed screen shows while it is not private (404 otherwise, also for a new widget not saved yet)
        this.data = null;
        this.unsaved = true;
        this.notShown = status === 404;
        next = 15_000;
      } else if (status === 404) {
        // removed from this screen, or the screen went private: nothing to show until the config says otherwise
        this.data = null;
        this.failed = true;
      } else {
        this.failed = true;
        next = this.data ? pollMs / 2 : RETRY_MS;
      }
    }
    this.draw();
    const anyStale = Boolean(this.data?.routes?.some((r) => r.stale));
    this.onState?.(this.unsaved ? 'ok' : this.data ? (anyStale || this.failed ? 'stale' : 'ok') : 'failed');
    this.timer = setTimeout(() => void this.poll(), next * (0.9 + Math.random() * 0.2));
  }

  private units(): 'metric' | 'imperial' {
    const u = this.w.commute?.units ?? 'auto';
    if (u === 'metric' || u === 'imperial') return u;
    return ctx.cfg?.weather?.units === 'imperial' ? 'imperial' : 'metric';
  }

  /** An unnamed route: "Route 2" by its place in the widget, never its addresses. */
  private routeLabel(id: string): string {
    const i = (this.w.commute?.routes ?? []).findIndex((x) => x.id === id);
    return ctx.t('commuteRoute', { n: i >= 0 ? i + 1 : 1 });
  }

  private formatDur(sec: number): string {
    const { hours, minutes } = formatDurationParts(sec);
    if (hours > 0) {
      return minutes > 0
        ? `${hours} ${ctx.t('commuteHr')} ${minutes} ${ctx.t('commuteMin')}`
        : `${hours} ${ctx.t('commuteHr')}`;
    }
    return `${minutes} ${ctx.t('commuteMin')}`;
  }

  private draw(): void {
    this.el.replaceChildren();
    this.el.className = `uw-media cw cw--${this.place}`;

    const head = el('div', 'cw-head');
    const title = el('span', 'cw-title', this.w.name || ctx.t('commuteTitle'));
    head.appendChild(title);
    this.el.appendChild(head);

    if (this.unsaved) {
      this.el.appendChild(el('div', 'cw-empty', ctx.t(this.notShown ? 'commuteNotShown' : 'widgetSaveToSee')));
      this.fit();
      return;
    }

    if (!this.data && !this.failed) {
      this.el.appendChild(el('div', 'cw-empty', ctx.t('commuteLoading')));
      this.fit();
      return;
    }

    const opts = this.w.commute;
    const activeRoutes: CommuteRouteResult[] = (this.data?.routes ?? []).filter((r) => r.active !== false);

    if (this.data && !this.data.keySet) {
      const note = el('div', 'cw-note', ctx.t('commuteNoKey'));
      this.el.appendChild(note);
    }

    if (!activeRoutes.length) {
      this.el.appendChild(el('div', 'cw-empty', ctx.t('commuteNoRoutes')));
      this.fit();
      return;
    }

    const list = el('div', 'cw-list');
    const units = this.units();
    const showSummary = opts?.showRouteSummary !== false;
    const showArrival = opts?.showArrival !== false;

    for (const r of activeRoutes) {
      const row = el('div', `cw-row${r.traffic ? ` cw-row--${r.traffic}` : ''}`);
      const left = el('div', 'cw-left');
      left.appendChild(modeIcon(r.mode || 'driving'));

      const info = el('div', 'cw-info');
      const nameLine = el('div', 'cw-name');
      nameLine.appendChild(el('span', 'cw-name-text', r.name || this.routeLabel(r.id)));
      if (r.reversed) {
        nameLine.appendChild(el('span', 'cw-rev', '⇄'));
      }
      info.appendChild(nameLine);

      const metaParts: string[] = [];
      if (showSummary && r.summary) metaParts.push(ctx.t('commuteVia', { s: r.summary }));
      if (typeof r.distanceMeters === 'number' && r.distanceMeters > 0) {
        const dStr = formatDistance(r.distanceMeters, units);
        if (dStr) metaParts.push(dStr);
      }
      if (showArrival && typeof r.durationSec === 'number' && r.durationSec > 0 && ctx.cfg) {
        const eta = new Date(Date.now() + r.durationSec * 1000);
        const hm = formatTime(eta, ctx.tz, ctx.cfg.datetime.format24);
        metaParts.push(ctx.t('commuteEta', { t: hm }));
      }
      if (metaParts.length) {
        info.appendChild(el('div', 'cw-meta', metaParts.join(' · ')));
      }
      left.appendChild(info);
      row.appendChild(left);

      const right = el('div', 'cw-right');
      if (r.ok && typeof r.durationSec === 'number') {
        const traffic = r.traffic || 'clear';
        const dur = el('div', `cw-dur cw-dur--${traffic}`, this.formatDur(r.durationSec));
        right.appendChild(dur);

        const delayMin = delayMinutes(r.durationSec, r.normalDurationSec || r.durationSec);
        if (delayMin >= 2 && r.mode === 'driving') {
          right.appendChild(el('span', `cw-badge cw-badge--${traffic}`, ctx.t('commuteDelay', { n: delayMin })));
        } else if (r.mode === 'driving') {
          const labelKey = traffic === 'heavy' ? 'commuteHeavy' : traffic === 'moderate' ? 'commuteModerate' : 'commuteClear';
          right.appendChild(el('span', `cw-badge cw-badge--${traffic}`, ctx.t(labelKey)));
        }
      } else {
        right.appendChild(el('div', 'cw-dur cw-dur--na', '·'));
      }
      row.appendChild(right);
      list.appendChild(row);
    }

    this.el.appendChild(list);
    // times from Google: "Google Maps" under them, at the bottom right (it stays when rows are cut: it is not in the list)
    if (activeRoutes.some((r) => r.ok && Number(r.durationSec) > 0)) {
      const foot = el('div', 'cw-attr');
      const a = googleMapsAttr();
      foot.appendChild(a);
      this.el.appendChild(foot);
      inkGoogleMapsAttr(a, this.el);
    }
    this.fit();
  }

  private fit(): void {
    if (!this.maxW || !this.maxH) return;
    const baseScale = this.place === 'full' ? 1.45 : (SCALE[this.w.size] ?? 1);
    this.el.style.setProperty('--cw-scale', String(baseScale));
    if (this.place === 'full') {
      this.el.style.width = `${Math.round(this.maxW)}px`;
      this.el.style.maxHeight = `${Math.round(this.maxH)}px`;
    } else if (this.place === 'side') {
      this.el.style.width = `${Math.round(this.maxW)}px`;
      this.el.style.maxHeight = `${Math.round(this.maxH)}px`;
    } else {
      this.el.style.width = `${Math.round(this.maxW)}px`;
      this.el.style.maxHeight = `${Math.round(this.maxH)}px`;
    }
  }
}
