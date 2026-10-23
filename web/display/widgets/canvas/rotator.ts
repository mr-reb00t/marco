// "Rotativa" (kind 'rotator'): one slot that shows its cards one after another, every `everySec` seconds, with a soft
// crossfade, the new card sliding in from the right or a cut ("Transición", #21), and small dots that say which card
// is on. Only lite mode, the screen's "Ahorro" (canvas.perf 'low') and reduced motion make it a cut: a slow device
// keeps the fade and the slide (opacity and transform, on the compositor).
// The controller (widgets/canvas.ts) makes one slide per card, each a card body with the card's own adapter, and
// fits every slide to the box (the hidden ones too, so a card is ready when its turn comes); this adapter only picks
// the slide on show. A card with nothing to show (.is-empty) or whose own condition is off (.is-cond-off) is skipped,
// at once when that changes; with one card left it stays on it, with no dots. A group of cards (#19) is one slide
// like a card (the controller lays its cards out in it); a small Rotativa among a group's cards is a cell of that slide
// with this same adapter on it (its own slides, timer and dots). No touch is needed.
import type { DisplayCanvasItem } from '../../../shared/types';
import { ROTATOR_EVERY_DEFAULT, ROTATOR_EVERY_MAX, ROTATOR_EVERY_MIN, ROTATOR_TRANSITIONS } from '../../../../server/core/canvasCore.js';
import type { AdapterEnv, CanvasAdapter } from './types';

const reduced = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** The card the admin's editor is changing, by Rotativa id: shown and held while it is edited (main.ts). */
export const rotatorPins = new Map<string, string>();

class Rotator implements CanvasAdapter {
  private root!: HTMLElement;
  private env!: AdapterEnv;
  private dots!: HTMLElement;
  /** the id of the card on show */
  private cur = '';
  /** when it came on (ms) */
  private since = 0;
  /** the card that was on before it (slides out while the new one slides in), '' before the first change */
  private out = '';

  mount(root: HTMLElement, env: AdapterEnv): void {
    this.root = root;
    this.env = env;
    root.classList.add('cv-rot');
    this.dots = document.createElement('div');
    this.dots.className = 'cv-rot-dots';
    this.dots.setAttribute('aria-hidden', 'true');
    root.appendChild(this.dots);
    this.update();
  }

  private props(): { everySec: number; dots: boolean; transition: 'fade' | 'slide' | 'none' } {
    const p = this.env.item().props as { everySec?: unknown; dots?: unknown; transition?: unknown };
    const n = Number(p.everySec);
    const tr = ROTATOR_TRANSITIONS.find((x) => x === p.transition) ?? 'fade';
    return { everySec: Number.isFinite(n) ? Math.min(ROTATOR_EVERY_MAX, Math.max(ROTATOR_EVERY_MIN, n)) : ROTATOR_EVERY_DEFAULT, dots: p.dots !== false, transition: tr };
  }

  private all(): HTMLElement[] {
    return Array.from(this.root.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('cv-rot-slide'));
  }

  /** The slides that have something to show (all of them while none has: the Rotativa is then hidden anyway). */
  private live(): HTMLElement[] {
    const all = this.all();
    const some = all.filter((el) => !el.classList.contains('is-empty') && !el.classList.contains('is-cond-off'));
    return some.length ? some : all;
  }

  update(): void {
    this.slides();
  }

  slides(): void {
    const live = this.live();
    const pin = rotatorPins.get(this.env.item().id);
    if (pin && live.some((el) => el.dataset.card === pin)) this.cur = pin;
    // the card on show went away, became empty or its condition went off: the next one, at once
    if (!live.some((el) => el.dataset.card === this.cur)) {
      if (this.cur) this.out = this.cur;
      this.cur = live[0]?.dataset.card ?? '';
      this.since = Date.now();
    }
    this.draw(live);
  }

  tick(): void {
    const live = this.live();
    if (rotatorPins.has(this.env.item().id)) return this.slides();
    if (live.length < 2) return this.slides();
    if (Date.now() - this.since < this.props().everySec * 1000) return;
    const i = live.findIndex((el) => el.dataset.card === this.cur);
    this.out = this.cur;
    this.cur = live[(i + 1) % live.length].dataset.card ?? '';
    this.since = Date.now();
    this.draw(live);
  }

  private draw(live: HTMLElement[]): void {
    const { dots, transition } = this.props();
    const still = transition === 'none' || this.env.calm() || reduced();
    const slide = transition === 'slide' && !still;
    this.root.classList.toggle('no-motion', still);
    this.root.classList.toggle('tr-slide', slide);
    for (const el of this.all()) {
      const on = el.dataset.card === this.cur;
      el.classList.toggle('is-on', on);
      // (the slide: the card coming in and the one going out move together; none at the first card)
      el.classList.toggle('is-in', on && slide && !!this.out && this.out !== this.cur);
      el.classList.toggle('is-out', !on && slide && el.dataset.card === this.out);
    }
    const show = dots && live.length > 1;
    this.root.classList.toggle('has-dots', show);
    this.dots.hidden = !show;
    if (!show) return;
    if (this.dots.childElementCount !== live.length) this.dots.replaceChildren(...live.map(() => document.createElement('i')));
    live.forEach((el, i) => this.dots.children[i].classList.toggle('is-on', el.dataset.card === this.cur));
  }

  destroy(): void {
    this.dots?.remove();
  }
}

export const ROTATOR_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  rotator: () => new Rotator(),
};
