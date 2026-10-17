// Personalizado custom card (kind 'html', self-hosted only): the owner's HTML and CSS with {{placeholders}} filled in
// from the values it binds (Home Assistant states by alias, the time, the date, the weather, the next event), drawn
// in a frame that cannot run anything, load anything or go anywhere:
//
// - the template is read again here with the server's own allowlist sanitiser (web/shared/cardTemplate.ts), and the
//   filled HTML once more before it goes in the frame, so a config written by an older server draws nothing unsafe;
// - <iframe sandbox="" srcdoc> (an opaque origin, no scripts, forms, popups or navigation of the screen) with the
//   meta CSP default-src 'none' (no network at all, data: images only), pointer-events:none and tabindex -1 (no tap
//   or focus can follow anything), no referrer, no permissions;
// - the card's look (glass, title) is drawn by Marco outside the frame, which is transparent, and the theme comes in
//   as CSS variables: --accent, --ink, --ink-2, --sep, --fill, --radius, --font, --size.
//
// The document is built again only when what it shows changes, at most every 2 s (30 s in lite or on a slow device),
// and swapped without flicker: the new frame takes the old one's place once it has loaded, and the old one is emptied
// and removed so frames never pile up.
import type { DisplayCanvasItem, HaState } from '../../../shared/types';
import { cardDocument, checkCard, parseCard, renderCard, type CardNode, type CardValue } from '../../../shared/cardTemplate';
import { formatDateLine, formatTime } from '../../../shared/i18n';
import { ctx } from '../../ctx';
import { isPreview } from '../../identity';
import { ago, fmtNum, stateText } from '../ha/haui';
import { nextEvents } from './calendar';
import type { AdapterEnv, CanvasAdapter } from './types';
import { screenWeather } from '../../weatherPlaces';

type Bind = { name: string; entity?: { a: string; d: string } | string | null; value?: string; builtin?: 'time' | 'date' | 'weather' | 'nextEvent' };
type Props = { html?: string; css?: string; bind?: Bind[]; refreshSec?: number };

const MIN_MS = 2000;
const LOW_MIN_MS = 30_000;
/** A frame that never says it loaded is swapped in anyway after this long. */
const LOAD_MS = 3000;

/** On or off, for {{#x.on}} sections. */
function isOn(s: HaState): boolean | null {
  switch (s.d) {
    case 'light': case 'switch': case 'binary': return s.on;
    case 'cover': return s.state !== 'closed';
    case 'media': return s.state === 'playing';
    case 'climate': return s.mode !== 'off';
    case 'lock': return s.state === 'unlocked';
    case 'alarm': return s.state.startsWith('armed');
    case 'other': return s.v === 'on' || s.v === 'home' || s.v === 'open';
    case 'sensor': return s.num !== null ? s.num !== 0 : s.v === 'on';
    default: return null;
  }
}

/** What `{{name.field}}` reads from a Home Assistant state. */
function haField(s: HaState | null, field: string): CardValue {
  if (!s) return null;
  if (field === 'unit') return s.d === 'sensor' ? s.unit : s.d === 'climate' ? `°${s.unit}` : s.d === 'light' && s.on && s.bri !== null ? '%' : '';
  if (field === 'ago') return ago(s.at);
  if (field === 'on') return isOn(s);
  if (field === 'name') return s.n ?? '';
  if (field === 'time') return '';
  // the value itself: a number when it is one (so | round and | pct work), else the state in words
  if (s.d === 'sensor') return s.num !== null ? s.num : s.v;
  if (s.d === 'climate') return s.cur ?? s.target ?? stateText(s);
  if (s.d === 'light') return s.on ? s.bri ?? stateText(s) : stateText(s);
  if (s.d === 'cover' && s.pos !== null) return s.pos;
  return stateText(s);
}

/** Every value the card binds, read now. */
function values(env: AdapterEnv, binds: Bind[]): Map<string, (field: string) => CardValue> {
  const out = new Map<string, (field: string) => CardValue>();
  const t = env.now();
  const dt = env.cfg().datetime;
  for (const b of binds) {
    if (b.builtin === 'time') out.set(b.name, (f) => (f === '' || f === 'time' ? formatTime(t.now, ctx.tz, dt.format24, dt.showAmPm) : null));
    else if (b.builtin === 'date') out.set(b.name, (f) => (f === '' ? formatDateLine(ctx.lang, t.dayKey, dt.dateFormat, dt.dateCustom ?? '') : null));
    else if (b.builtin === 'weather') {
      const w = screenWeather()?.current ?? null;
      out.set(b.name, (f) => (!w ? null : f === '' ? Math.round(w.temp) : f === 'unit' ? '°' : f === 'name' ? w.description : f === 'on' ? w.isDay : null));
    } else if (b.builtin === 'nextEvent') {
      const e = nextEvents(env.events(), t, 1)[0] ?? null;
      out.set(b.name, (f) => {
        if (!e) return null;
        if (f === '' || f === 'name') return e.title;
        if (f === 'on') return e.timed && e.startMs <= t.now.getTime();
        if (f === 'time') return e.timed ? formatTime(new Date(e.startMs), ctx.tz, dt.format24, dt.showAmPm) : '';
        return null;
      });
    } else if (b.entity && typeof b.entity === 'object') {
      const s = env.ha.state(b.entity.a);
      out.set(b.name, (f) => haField(s, f));
    } else if (typeof b.value === 'string' && b.value) {
      // a pushed value (POST /api/hooks/values): the value, its unit, its label as .name, and how long ago
      const r = env.values.get(b.value) ?? null;
      out.set(b.name, (f) => {
        if (!r) return null;
        if (f === '') return r.v;
        if (f === 'unit') return r.u ?? '';
        if (f === 'name') return r.l ?? '';
        if (f === 'ago') return ago(r.at);
        if (f === 'on') return r.v === true || (typeof r.v === 'number' && r.v !== 0) || r.v === 'on';
        if (f === 'time') return formatTime(new Date(r.at), ctx.tz, dt.format24, dt.showAmPm);
        return null;
      });
    } else out.set(b.name, () => null); // an entity not chosen yet
  }
  return out;
}

/** The page's theme as the card's variables: its ink, accent and fills, in this card's text size. */
function themeVars(root: HTMLElement, scale: number): { vars: Record<string, string>; scheme: 'dark' | 'light' } {
  const cs = getComputedStyle(root);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  const v = (name: string, d: string) => cs.getPropertyValue(name).trim() || d;
  // dark ink means a light card: the frame's color scheme follows, or the browser paints the frame opaque
  const [r = 255, g = 255, b = 255] = (cs.color.match(/[\d.]+/g) ?? []).map(Number);
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  return {
    scheme: light ? 'light' : 'dark',
    vars: {
      '--accent': v('--accent', '#0a84ff'),
      '--ink': v('--fg', cs.color),
      '--ink-2': v('--fg-2', cs.color),
      // lines and fills from the ink itself, so they show on any card (light, dark, a colour of its own)
      '--sep': `rgb(${r} ${g} ${b} / 0.16)`,
      '--fill': `rgb(${r} ${g} ${b} / 0.1)`,
      '--radius': `${Math.round(rem * 1.4)}px`,
      '--font': cs.fontFamily || 'system-ui, sans-serif',
      '--size': `${Math.round(rem * 2 * scale * 10) / 10}px`,
    },
  };
}

function htmlCard(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let box: HTMLElement;
  let frame: HTMLIFrameElement | null = null;
  let incoming: HTMLIFrameElement | null = null;
  let note: HTMLElement | null = null;
  let parsed: { src: string; nodes: CardNode[] | null } = { src: '\u0000', nodes: null };
  let doc = '';
  /** which bound values were known and the theme when the document was built: a value arriving or a new look shows at once */
  let known = '';
  let nextKnown = '';
  /** the colour scheme of the document built last ('light' or 'dark') */
  let nextScheme = '';
  let lastAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshAt = 0;

  const props = () => env.item().props as Props;
  const binds = (): Bind[] => (Array.isArray(props().bind) ? props().bind! : []);
  const minMs = () => (env.low() ? LOW_MIN_MS : MIN_MS);

  const showNote = (key: string) => {
    drop(frame);
    drop(incoming);
    frame = incoming = null;
    doc = '';
    if (!note) note = box.appendChild(Object.assign(document.createElement('span'), { className: 'cv-html-note' }));
    note.textContent = ctx.t(key);
  };

  /** Empty a frame and take it out (its document goes with it). */
  function drop(f: HTMLIFrameElement | null): void {
    if (!f) return;
    f.removeAttribute('srcdoc');
    f.src = 'about:blank';
    f.remove();
  }

  /** The document the card shows now, or '' (with its note) when it has nothing safe to show. */
  const build = (): string => {
    const p = props();
    const html = typeof p.html === 'string' ? p.html : '';
    if (!html.trim()) return '';
    const key = `${html}\u0000${p.css ?? ''}`;
    if (parsed.src !== key) {
      const r = parseCard(html);
      parsed = { src: key, nodes: r.errors.length || checkCard(html, p.css ?? '').length ? null : r.nodes };
    }
    if (!parsed.nodes) return '';
    const vals = values(env, binds());
    nextKnown = [...vals].map(([name, get]) => (get('') === null ? '' : name)).join(',');
    const body = renderCard(parsed.nodes, (name, field) => vals.get(name)?.(field) ?? null, (n, d) => (d === null ? fmtNum(n, Number.isInteger(n) ? 0 : Math.min(3, String(n).split('.')[1]?.length ?? 0)) : fmtNum(n, d)));
    // the filled HTML goes through the sanitiser once more before it reaches the frame
    if (parseCard(body).errors.length) return '';
    const { vars, scheme } = themeVars(root, Number(env.item().style?.scale) || 1);
    nextKnown += `|${scheme}|${vars['--ink']}|${vars['--accent']}|${vars['--size']}`;
    nextScheme = scheme;
    return cardDocument({ body, css: p.css ?? '', vars, scheme });
  };

  const swap = (next: string) => {
    lastAt = Date.now();
    doc = next;
    known = nextKnown;
    if (note) {
      note.remove();
      note = null;
    }
    drop(incoming);
    const f = document.createElement('iframe');
    f.className = 'cv-html-frame is-loading';
    // the frame element takes its document's colour scheme: when the two differ, Chromium paints an opaque backdrop
    // for the frame (on a light screen it showed as a grey box, sometimes left behind where the card first was)
    if (nextScheme) f.style.colorScheme = nextScheme;
    f.setAttribute('sandbox', '');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('allow', '');
    f.setAttribute('loading', 'eager');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.title = env.item().style?.title || ctx.t('cvHtmlTitle');
    const done = () => {
      if (incoming !== f) return;
      if (loadTimer) clearTimeout(loadTimer);
      loadTimer = null;
      incoming = null;
      f.classList.remove('is-loading');
      drop(frame);
      frame = f;
    };
    f.addEventListener('load', done, { once: true });
    loadTimer = setTimeout(done, LOAD_MS);
    incoming = f;
    f.srcdoc = next;
    box.appendChild(f);
  };

  /** Build the document again; `now`: right away (the item changed), else within the rate limit. */
  const render = (now = false) => {
    // the theme is read from the card: nothing to read before it is on the page (layout() comes next)
    if (!root?.isConnected) return;
    const p = props();
    const html = typeof p.html === 'string' ? p.html : '';
    if (!html.trim()) return showNote('cvSetup');
    const next = build();
    if (!next) return showNote('cvHtmlError');
    if (next === doc && frame) return;
    const wait = now || isPreview || nextKnown !== known ? 0 : lastAt + minMs() - Date.now();
    if (wait <= 0) {
      if (timer) clearTimeout(timer);
      timer = null;
      return swap(next);
    }
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        render();
      }, wait);
    }
  };

  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-html');
      box = root.appendChild(Object.assign(document.createElement('div'), { className: 'cv-html-box' }));
      render(true);
    },
    update: () => render(true),
    layout() {
      // a new size can mean a new text size for the card (--size)
      render();
    },
    tick(t) {
      // the time, "hace 5 min" and the next event move on: at least once a minute, or every refreshSec
      const every = Math.max(5, Math.min(3600, Number(props().refreshSec) || 60)) * 1000;
      if (t.minuteChanged || Date.now() >= refreshAt) {
        refreshAt = Date.now() + every;
        // a new minute shows at once (a card with the time must not lag behind the clocks next to it)
        render(t.minuteChanged);
      }
    },
    data(topic) {
      if (topic === 'ha' || topic === 'values' || topic === 'weather' || topic === 'events' || topic === 'config') render();
    },
    destroy() {
      if (timer) clearTimeout(timer);
      if (loadTimer) clearTimeout(loadTimer);
      timer = loadTimer = null;
      drop(frame);
      drop(incoming);
      frame = incoming = null;
      root.textContent = '';
    },
  };
}

export const HTML_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  html: htmlCard,
};
