// Personalizado content: the screen message, the to-do list, the news, a photo slideshow of its own, a saved widget
// (config.widgets, drawn by widgets/custom.ts in this card), a pushed value (Valor), the empty spacer, and the
// placeholder card of a widget this screen cannot show. Item text is written with textContent only.
import type { DisplayCanvasItem, DisplayValue, Photo } from '../../../shared/types';
import { ctx } from '../../ctx';
import { reducedMotion } from '../../dom';
import { state } from '../../store';
import { renderMessage, renderTodo } from '../extras';
import { News } from '../news';
import { refreshMarquee } from '../../marquee';
import { ago, fmtNum } from '../ha/haui';
import { bigType, fitWidth } from './clock';
import type { AdapterBox, AdapterEnv, CanvasAdapter } from './types';

type Props = Record<string, any>;

// ------------------------------------------------------------------------------------------------ message / to-do
function message(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let box: HTMLElement;
  const render = () => {
    root.classList.toggle('is-left', (env.item().props as Props).align === 'left');
    renderMessage(box, env.cfg());
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-msg');
      box = document.createElement('div');
      box.className = 'msg';
      root.appendChild(box);
      render();
    },
    update: () => render(),
    // a small box (the compact look): the words whole, as large as the box holds them (down to a small size), else on
    // one line that slides to show the rest (the marquee of the titles)
    layout(b) {
      root.classList.remove('is-mline');
      if (root.dataset.mini === undefined) {
        root.style.removeProperty('--mfs');
        return;
      }
      const h = innerH(root, b);
      const tx = root.querySelector<HTMLElement>('.msg-tx');
      const whole = () => root.scrollHeight <= root.clientHeight + 1 && root.scrollWidth <= root.clientWidth + 1 && (!tx || tx.scrollWidth <= tx.clientWidth + 1);
      for (let fs = Math.min(2.6, h / 1.3); fs >= 1.4; fs *= 0.92) {
        root.style.setProperty('--mfs', `${fs.toFixed(2)}rem`);
        if (whole()) return;
      }
      root.classList.add('is-mline');
      root.style.setProperty('--mfs', `${Math.max(1.2, Math.min(2.4, h / 1.35)).toFixed(2)}rem`);
      refreshMarquee();
    },
    data(topic) {
      if (topic === 'config') render();
    },
    empty: () => box.style.display === 'none',
    destroy() {
      root.textContent = '';
    },
  };
}

/** The height inside a card body's padding, in rem. */
export function innerH(root: HTMLElement, b: AdapterBox): number {
  const cs = getComputedStyle(root);
  return (root.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)) / b.rem;
}

function todo(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let box: HTMLElement;
  const render = () => {
    const p = env.item().props as Props;
    renderTodo(box, env.cfg(), { max: Math.min(12, Math.max(1, Number(p.maxRows) || 6)), showDone: p.showDone !== false });
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-todo');
      box = document.createElement('div');
      box.className = 'todo';
      root.appendChild(box);
      render();
    },
    update: () => render(),
    // a small box (the compact look): smaller rows on one line each, the heading only when there is room, and as many
    // rows as fit whole (the open ones come first)
    layout(b) {
      const rows = [...box.querySelectorAll<HTMLElement>('li')];
      for (const li of rows) li.hidden = false;
      root.classList.remove('no-head');
      if (root.dataset.mini === undefined) {
        root.style.removeProperty('--mfs');
        return;
      }
      const h = innerH(root, b);
      root.style.setProperty('--mfs', `${Math.min(1.9, Math.max(1.4, h / 6)).toFixed(2)}rem`);
      root.classList.toggle('no-head', h < 11);
      for (let i = rows.length - 1; i > 0 && root.scrollHeight > root.clientHeight + 1; i--) rows[i].hidden = true;
    },
    data(topic) {
      if (topic === 'config') render();
    },
    empty: () => box.style.display === 'none',
    destroy() {
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ news
function news(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let n: News;
  let box: HTMLElement;
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-news');
      box = document.createElement('div');
      root.appendChild(box);
      n = new News(box, { cfg: env.cfg });
      n.setData(state.news);
    },
    update: () => n.setData(state.news),
    // taller than the largest named size: the headline and the summary over several lines instead of one
    layout(b) {
      // (on screen: the box handed here is in the card's own pixels, smaller once the card grows)
      root.classList.toggle('is-big', b.zone === 'main' && root.getBoundingClientRect().height / b.rem >= 60);
    },
    data(topic) {
      if (topic === 'news' || topic === 'config') n.setData(state.news);
    },
    empty: () => box.style.display === 'none',
    destroy() {
      n.destroy();
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ photo
/** Its own slideshow of the screen's photos: a crossfade every intervalSec, starting at a different photo per item. */
function photo(item0: DisplayCanvasItem): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idx = -1;
  let cur: HTMLElement | null = null;
  let listSig = '';
  // spread items over the list, so two photo cards do not show the same one
  const offset = [...item0.id].reduce((n, c) => n + c.charCodeAt(0), 0);
  const list = (): Photo[] => state.photos?.photos ?? [];
  const show = () => {
    const photos = list();
    if (timer) clearTimeout(timer);
    timer = null;
    // a hidden page loads nothing: the next photo comes once it is visible again
    if (document.hidden && cur) {
      timer = setTimeout(show, 30_000);
      return;
    }
    if (!photos.length) {
      root.classList.add('is-empty');
      return;
    }
    root.classList.remove('is-empty');
    idx = idx < 0 ? offset % photos.length : (idx + 1) % photos.length;
    const p = photos[idx];
    const props = env.item().props as Props;
    const img = new Image();
    img.decoding = 'async';
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      if (!root.isConnected) return;
      const node = document.createElement('div');
      node.className = `cv-ph${props.fit === 'contain' ? ' contain' : ''}`;
      node.style.backgroundImage = `url("${img.src.replace(/["\\\n]/g, '')}")`;
      if (typeof p.focusX === 'number' && typeof p.focusY === 'number') node.style.backgroundPosition = `${(p.focusX * 100).toFixed(1)}% ${(p.focusY * 100).toFixed(1)}%`;
      root.insertBefore(node, root.querySelector('.cv-ph-cap'));
      const old = cur;
      cur = node;
      if (old) {
        if (reducedMotion() || env.low()) old.remove();
        else {
          node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1200, easing: 'ease-out' });
          setTimeout(() => old.remove(), 1250);
        }
      }
      const cap = root.querySelector<HTMLElement>('.cv-ph-cap')!;
      cap.textContent = props.caption ? [p.title, p.place, p.author].filter(Boolean).join(' · ') : '';
    };
    img.onerror = () => undefined;
    img.src = p.url;
    timer = setTimeout(show, Math.min(600, Math.max(10, Number(props.intervalSec) || 60)) * 1000);
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-photo');
      const cap = document.createElement('div');
      cap.className = 'cv-ph-cap';
      root.appendChild(cap);
      listSig = list().map((p) => p.url).join('|');
      show();
    },
    update() {
      idx = Math.max(-1, idx - 1);
      show();
    },
    data(topic) {
      if (topic !== 'photos') return;
      const sig = list().map((p) => p.url).join('|');
      if (sig === listSig) return;
      listSig = sig;
      if (!cur) show();
    },
    destroy() {
      if (timer) clearTimeout(timer);
      timer = null;
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ saved widget
function widget(item0: DisplayCanvasItem): CanvasAdapter {
  let env: AdapterEnv;
  let box: HTMLElement;
  let id = String((item0.props as Props).widgetId || '');
  // the card's "Estilo de la gráfica", for the electricity prices drawn in it (custom.ts reads it from the box)
  const style = () => {
    box.dataset.chartStyle = (env.item().props as Props).chartStyle === 'background' ? 'background' : 'below';
  };
  return {
    mount(root, e) {
      env = e;
      root.classList.add('cv-widget');
      box = document.createElement('div');
      box.className = 'cv-media';
      root.appendChild(box);
      style();
      env.mediaBox(id, box);
    },
    update() {
      const next = String((env.item().props as Props).widgetId || '');
      const was = box.dataset.chartStyle;
      style();
      // another style for the same widget: its box again, so it is drawn again
      if (next === id && was !== box.dataset.chartStyle) {
        env.mediaBox(id, null);
        env.mediaBox(id, box);
      }
      if (next === id) return;
      env.mediaBox(id, null);
      id = next;
      env.mediaBox(id, box);
    },
    destroy() {
      env.mediaBox(id, null);
      box.remove();
    },
  };
}

// ------------------------------------------------------------------------------------------------ value
/** The value as text: a number with the item's decimals, true/false as Sí/No, a word as it came. */
export function valueText(v: DisplayValue['v'], decimals: number): string {
  if (typeof v === 'number') return fmtNum(v, decimals);
  if (typeof v === 'boolean') return ctx.t(v ? 'valYes' : 'valNo');
  return v;
}

/**
 * Valor: a value pushed to the server (POST /api/hooks/values), only for the keys this screen shows. Its label and
 * unit are the item's, else the ones sent with the value. "hace 5 min" under it, greyed once it is older than the
 * item's staleAfterMin (0: never). "Esperando datos" before the first answer, "Sin datos" when the server has none.
 * Everything is written as text: a value is never read as HTML, a URL or a colour.
 */
function value(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let last: AdapterBox | null = null;
  let sig = '';
  const render = (force = false) => {
    const p = env.item().props as Props;
    const key = String(p.key || '');
    const rec = key ? env.values.get(key) : null;
    const minute = Math.floor(Date.now() / 60_000);
    const next = JSON.stringify([env.item().v, rec, minute, ctx.lang]);
    if (next === sig && !force) return;
    sig = next;
    root.textContent = '';
    const head = document.createElement('div');
    head.className = 'cv-val-head';
    if (p.icon) head.appendChild(Object.assign(document.createElement('span'), { className: 'cv-val-icon', textContent: String(p.icon) }));
    head.appendChild(Object.assign(document.createElement('span'), { className: 'cv-val-label', textContent: String(p.label || rec?.l || key) }));
    const num = document.createElement('div');
    num.className = 'cv-val-num';
    const decimals = Math.min(3, Math.max(0, Number(p.decimals ?? 1)));
    const text = rec ? valueText(rec.v, decimals) : '–';
    const b = Object.assign(document.createElement('b'), { textContent: text });
    // a word (or Sí/No) is set smaller than a number
    if (rec && typeof rec.v !== 'number') b.className = 'is-text';
    num.appendChild(b);
    const unit = String(p.unit || rec?.u || '');
    if (unit && rec && typeof rec.v === 'number') num.appendChild(Object.assign(document.createElement('span'), { className: 'cv-val-unit', textContent: unit }));
    const stale = !rec || (Number(p.staleAfterMin) > 0 && Date.now() - rec.at > Number(p.staleAfterMin) * 60_000);
    const noteKey = !key ? 'cvSetup' : rec === undefined ? 'cvNoValue' : rec === null ? 'cvNoData' : '';
    const note = Object.assign(document.createElement('div'), { className: 'cv-val-note', textContent: noteKey ? ctx.t(noteKey) : ago(rec!.at) });
    root.append(head, num, note);
    root.classList.toggle('is-stale', stale);
    if (last) fit(last);
  };
  const fit = (box: AdapterBox) => {
    const line = root.dataset.mini !== undefined && root.dataset.mh === '1';
    root.classList.toggle('is-mline', line);
    root.classList.remove('no-label');
    if (line) return fitLine(box);
    const wk = bigType(root, box, 18, Number(env.item().style?.scale) || 1, root.dataset.room !== undefined ? 16 : 0, 4);
    fitWidth(root, root.querySelector('.cv-val-num'), wk);
  };
  /**
   * One row high: the label and the value side by side on one line ("hace 5 min" left out), the value as large
   * as the height allows; the label gives way first (its "..."), then goes when too little of it would show.
   */
  const fitLine = (box: AdapterBox) => {
    let wk = Math.min(1.2, Math.max(0.3, innerH(root, box) / 6.4)) * (Number(env.item().style?.scale) || 1);
    root.style.setProperty('--wk', wk.toFixed(3));
    const label = root.querySelector<HTMLElement>('.cv-val-label');
    if (label && (label.clientWidth < 3 * box.rem || (label.scrollWidth > label.clientWidth + 1 && label.clientWidth < 7 * box.rem))) root.classList.add('no-label');
    for (let i = 0; i < 16 && wk > 0.3 && (root.scrollWidth > root.clientWidth + 1 || root.scrollHeight > root.clientHeight + 1); i++) {
      wk *= 0.92;
      root.style.setProperty('--wk', wk.toFixed(3));
    }
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-value');
      render(true);
    },
    update: () => render(true),
    layout(box) {
      last = box;
      root.dataset.size = box.size;
      fit(box);
    },
    tick(t) {
      if (t.minuteChanged) render();
    },
    data(topic) {
      if (topic === 'values' || topic === 'config') render();
    },
    destroy() {
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ heading
/** "Sección": a title with an emoji on a thin band, a line under it, to group the cards around it. */
function heading(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  const render = () => {
    const p = env.item().props as Props;
    root.textContent = '';
    root.classList.toggle('is-center', p.align === 'center');
    root.classList.toggle('has-line', p.line !== false);
    const row = document.createElement('div');
    row.className = 'cv-heading-row';
    if (p.icon) {
      const ic = document.createElement('span');
      ic.className = 'cv-heading-ico';
      ic.textContent = String(p.icon);
      row.appendChild(ic);
    }
    const t = document.createElement('span');
    t.className = 'cv-heading-t';
    t.textContent = String(p.title ?? '');
    row.appendChild(t);
    root.appendChild(row);
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-heading');
      render();
    },
    update: () => render(),
    layout(box) {
      // the title takes about half the band's height, never more than a large heading; the text size multiplies
      // that (--cv-scale in the CSS), so it is not clamped away
      bigType(root, box, 6);
    },
    // nothing written yet: the band is not drawn
    empty: () => !String((env.item().props as Props).title ?? '').trim() && !String((env.item().props as Props).icon ?? '').trim(),
    destroy() {
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ spacer
const spacer = (): CanvasAdapter => ({
  mount(root) {
    root.classList.add('cv-spacer');
  },
  update() {},
  destroy() {},
});

// ------------------------------------------------------------------------------------------------ placeholder
/** A neutral card: not allowed on this server, hidden while private, not set up, or not drawn by this version yet. */
export function placeholder(reason: 'feature' | 'privacy' | 'setup' | 'soon'): CanvasAdapter {
  return {
    mount(root) {
      root.classList.add('cv-ph-card', `is-${reason}`);
      if (reason === 'privacy') {
        // the same lock as the privacy badge (static markup)
        const lock = document.createElement('span');
        lock.className = 'cv-lock';
        lock.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>';
        root.appendChild(lock);
      }
      const key = reason === 'feature' ? 'cvNotAvailable' : reason === 'privacy' ? 'cvPrivate' : reason === 'setup' ? 'cvSetup' : 'cvSoon';
      root.appendChild(Object.assign(document.createElement('span'), { className: 'cv-ph-text', textContent: ctx.t(key) }));
    },
    update() {},
    destroy() {},
  };
}

export const CONTENT_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  message,
  todo,
  news,
  photo,
  widget,
  value,
  spacer,
  heading,
};
