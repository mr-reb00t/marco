// Tiny DOM helpers: escaping, element creation and a keyed reconciler with FLIP animations,
// so data refreshes patch the screen in place (never a visible full re-render).

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const e = root.querySelector(sel);
  if (!e) throw new Error(`missing ${sel}`);
  return e as HTMLElement;
}

/** Set innerHTML only when it actually changed (avoids needless layout / animation restarts). */
export function setHTML(e: HTMLElement, html: string): boolean {
  if ((e as any).__html === html) return false;
  (e as any).__html = html;
  e.innerHTML = html;
  return true;
}

export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

export function toggle(e: Element, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

export interface Spec {
  key: string;
  tag?: string;
  className: string;
  style?: string;
  html: string;
  /**
   * What `html` is compared by, when it holds a state the caller keeps up to date itself (a busy day's page on show):
   * the same key keeps the element's content as it is, a new one writes `html`.
   */
  htmlKey?: string;
  /** data-* attributes (e.g. { day: '2026-10-14' } → data-day) */
  data?: Record<string, string>;
}

interface Keyed extends HTMLElement {
  __key?: string;
  __sig?: string;
  __leaving?: boolean;
  __data?: string[];
}

export const reducedMotion = () => document.documentElement.classList.contains('lite');

/**
 * Keyed reconciliation of `parent`'s children against `specs`.
 * - unchanged elements are left alone
 * - changed ones are patched in place; moved ones are FLIP-animated
 * - new ones fade/scale in, removed ones fade out then detach
 */
export function reconcile(parent: HTMLElement, specs: Spec[], opts: { flip?: boolean; animate?: boolean } = {}): void {
  const animate = opts.animate !== false && !reducedMotion() && parent.isConnected;
  const flip = animate && opts.flip !== false;
  const existing = new Map<string, Keyed>();
  for (const c of Array.from(parent.children) as Keyed[]) {
    if (c.__key && !c.__leaving) existing.set(c.__key, c);
  }

  const first = new Map<Keyed, DOMRect>();
  if (flip) for (const [, c] of existing) first.set(c, c.getBoundingClientRect());

  const keep = new Set<Keyed>();
  const entered: Keyed[] = [];
  let prev: Keyed | null = null;
  for (const s of specs) {
    let node = existing.get(s.key);
    const htmlKey = s.htmlKey ?? s.html;
    const sig = `${s.className}|${s.style ?? ''}|${htmlKey}${s.data ? `|${JSON.stringify(s.data)}` : ''}`;
    if (!node) {
      node = document.createElement(s.tag || 'div') as Keyed;
      node.__key = s.key;
      entered.push(node);
    }
    if (node.__sig !== sig) {
      if (node.className !== s.className) node.className = s.className;
      if ((node.getAttribute('style') ?? '') !== (s.style ?? '')) node.setAttribute('style', s.style ?? '');
      if ((node as any).__html !== htmlKey) {
        node.innerHTML = s.html;
        (node as any).__html = htmlKey;
      }
      const keys = s.data ? Object.keys(s.data) : [];
      for (const k of node.__data ?? []) if (!keys.includes(k)) node.removeAttribute(`data-${k}`);
      for (const k of keys) if (node.getAttribute(`data-${k}`) !== s.data![k]) node.setAttribute(`data-${k}`, s.data![k]);
      node.__data = keys;
      node.__sig = sig;
    }
    // keep DOM order == spec order (cheap check)
    const want: ChildNode | null = prev ? prev.nextSibling : parent.firstChild;
    if (want !== node) parent.insertBefore(node, want);
    keep.add(node);
    prev = node;
  }

  for (const [, c] of existing) {
    if (keep.has(c)) continue;
    if (!animate) {
      c.remove();
      continue;
    }
    c.__leaving = true;
    const a = c.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.96)' }], {
      duration: 450, easing: 'ease-in', fill: 'forwards',
    });
    a.onfinish = () => c.remove();
  }

  if (!animate) return;
  for (const n of entered) {
    n.animate([{ opacity: 0, transform: 'translateY(6px) scale(.97)' }, { opacity: 1, transform: 'none' }], {
      duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)', delay: 120,
      fill: 'backwards',
    });
  }
  if (flip) {
    for (const [n, r0] of first) {
      if (!keep.has(n)) continue;
      const r1 = n.getBoundingClientRect();
      const dx = r0.left - r1.left;
      const dy = r0.top - r1.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }
  }
}
