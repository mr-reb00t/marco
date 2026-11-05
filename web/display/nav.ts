// Navigation on touch screens (the Personalizado "Navegación" cards and the swipe; docs/ARCHITECTURE.md). Pure: no
// DOM and no fetches (main.ts passes them in), so the tests run it with a fake clock (server/test/display-nav.test.js).
//
// - planNav() decides what a tap on "Ir a pantalla" does on this display: back home, jump to a step of the carousel
//   it runs (that step starts its time again and the carousel goes on from there), or show a screen outside it and
//   stay there.
// - NavMemo is the only thing kept, and only in this browser (localStorage): a screen shown by touch or a paused
//   carousel, with the time it ends. Nothing is written to the server on a tap.
// - "Volver solo tras X min sin tocar": every touch on the screen pushes that time forward; when it passes, the
//   display goes back to its own screen or carousel (expire). 0 minutes: it stays until someone taps Inicio.
// - carouselTouch() and CarouselGesture: the carousel's "Pantallas táctiles" (swipe, press and hold, dots), on every
//   layout (#40).

/** What a tap does (planNav). */
export type NavPlan =
  | { do: 'home' }
  | { do: 'jump'; index: number }
  | { do: 'visit'; screenId: string }
  | { do: 'none' };

export interface NavPlace {
  /** the screen this display is bound to, or '' when it runs a carousel */
  homeScreen: string;
  /** the carousel's steps (screen ids, in order), or null on a single screen */
  steps: string[] | null;
  /** the carousel rotates now (inside its schedule, not held at night) */
  rotating: boolean;
  /** the screen on display now */
  current: string;
  /** the step on display now (-1 outside the steps) */
  index: number;
}

/** What a tap on "Ir a pantalla" with `target` (a screen id or 'home') does here. */
export function planNav(target: string, at: NavPlace): NavPlan {
  if (!target) return { do: 'none' };
  if (target === 'home') return { do: 'home' };
  if (at.steps) {
    if (at.rotating) {
      // the step on display when it is that screen (its time starts again), else the first step that shows it
      if (at.index >= 0 && at.steps[at.index] === target) return { do: 'jump', index: at.index };
      const i = at.steps.indexOf(target);
      if (i >= 0) return { do: 'jump', index: i };
    }
    return target === at.current ? { do: 'none' } : { do: 'visit', screenId: target };
  }
  if (target === at.homeScreen) return { do: 'home' };
  return target === at.current ? { do: 'none' } : { do: 'visit', screenId: target };
}

export type NavMode = 'visit' | 'pause';

/** What this browser keeps of a navigation (localStorage). */
export interface NavMemo {
  v: 1;
  mode: NavMode;
  /** the screen shown ('visit'); '' for a pause */
  screenId: string;
  /** "Volver solo tras": minutes without a touch (0 = it stays) */
  returnMin: number;
  /** when it ends (ms, Date.now), null = it stays */
  until: number | null;
  /** what the display was bound to when it started: a memo of another binding is dropped */
  home: string;
}

export interface NavDeps {
  now(): number;
  load(): unknown;
  save(m: NavMemo | null): void;
  /** the time passed with no touch: go back to the display's own screen or carousel */
  expire(m: NavMemo): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** Writes of a pushed-forward end are kept to one every this many ms (a finger on a slider touches a lot). */
export const NAV_SAVE_EVERY = 15_000;
/** The longest a timer waits in one go (timers drift over hours; it is armed again). */
const MAX_WAIT = 6 * 3600_000;

/** A stored memo when it is well formed, of this binding and not over yet; else null. */
export function readMemo(raw: unknown, home: string, now: number): NavMemo | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<NavMemo>;
  if (m.v !== 1 || (m.mode !== 'visit' && m.mode !== 'pause') || m.home !== home) return null;
  if (typeof m.screenId !== 'string' || (m.mode === 'visit' && !m.screenId)) return null;
  const returnMin = Number(m.returnMin);
  if (!Number.isFinite(returnMin) || returnMin < 0) return null;
  const until = m.until === null ? null : Number(m.until);
  if (until !== null && (!Number.isFinite(until) || until <= now)) return null;
  return { v: 1, mode: m.mode, screenId: m.screenId, returnMin, until, home };
}

/** The navigation this display is in (a visit or a pause), its end and the idle timer. */
export class NavIdle {
  private memo: NavMemo | null = null;
  private timer: unknown = null;
  private savedAt = 0;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (t: unknown) => void;

  constructor(private home: string, private d: NavDeps) {
    this.setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = d.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  get current(): NavMemo | null {
    return this.memo;
  }

  /** The memo kept from before a reload, when it still holds (it is armed again). */
  restore(): NavMemo | null {
    let m: NavMemo | null = null;
    try {
      m = readMemo(this.d.load(), this.home, this.d.now());
    } catch {
      m = null;
    }
    if (!m) {
      this.d.save(null);
      return null;
    }
    this.memo = m;
    this.arm();
    return m;
  }

  /** A visit or a pause starts (a tap). `returnMin` 0: it stays until home. */
  start(mode: NavMode, screenId: string, returnMin: number): NavMemo {
    const now = this.d.now();
    const min = Number.isFinite(returnMin) && returnMin > 0 ? returnMin : 0;
    this.memo = { v: 1, mode, screenId: mode === 'visit' ? screenId : '', returnMin: min, until: min ? now + min * 60_000 : null, home: this.home };
    this.savedAt = now;
    this.d.save(this.memo);
    this.arm();
    return this.memo;
  }

  /** Someone touched the screen: the end moves to `returnMin` from now. */
  touched(): void {
    const m = this.memo;
    if (!m || !m.returnMin) return;
    const now = this.d.now();
    m.until = now + m.returnMin * 60_000;
    if (now - this.savedAt >= NAV_SAVE_EVERY) {
      this.savedAt = now;
      this.d.save(m);
    }
    this.arm();
  }

  /** It ended (home, the carousel went on, a new binding): forget it. */
  clear(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    if (!this.memo) return;
    this.memo = null;
    this.d.save(null);
  }

  private arm(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    const m = this.memo;
    if (!m || m.until === null) return;
    const wait = Math.max(0, m.until - this.d.now());
    this.timer = this.setTimer(() => {
      this.timer = null;
      const cur = this.memo;
      if (!cur || cur.until === null) return;
      if (cur.until > this.d.now() + 50) return this.arm();
      this.memo = null;
      this.d.save(null);
      this.d.expire(cur);
    }, Math.min(wait, MAX_WAIT));
  }
}

/** A swipe: at least this far sideways (px, or 12 % of the width when that is less), mostly sideways, quick. */
export const SWIPE_MIN_PX = 80;
export const SWIPE_MAX_MS = 900;

/** -1 (to the left: the next screen), 1 (to the right: the previous one) or 0 (not a swipe). */
export function swipeDir(dx: number, dy: number, ms: number, width = 1920): -1 | 0 | 1 {
  const min = Math.min(SWIPE_MIN_PX, Math.max(40, width * 0.12));
  if (ms > SWIPE_MAX_MS || Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return dx < 0 ? -1 : 1;
}

// ---------------------------------------------------------------------------------------------
// Touch on a carousel (the carousel's "Pantallas táctiles" settings, or the Personalizado screen's own swipe): what is
// on, and the gesture itself (a swipe or a press and hold). Pure like the rest of this file; main.ts does the DOM.
// ---------------------------------------------------------------------------------------------

/** The carousel's touch settings as the display reads them (CarouselBlock; absent from older servers). */
export interface CarouselTouchBlock {
  swipe?: unknown;
  holdPause?: unknown;
  dots?: unknown;
  steps?: unknown[];
}

/** What is on for this display (carouselTouch). */
export interface CarouselTouch {
  swipe: boolean;
  hold: boolean;
  dots: boolean;
}

/**
 * The touch features a carousel display runs. The values are checked again here (the server already did), so a
 * stale or hand-made config never turns anything on by accident. Fewer than 2 steps: nothing to move through.
 * The admin preview gets no gestures (the admin is used with a mouse and the preview must not leave its step), but it
 * shows the dots, so the owner sees them.
 */
export function carouselTouch(block: CarouselTouchBlock | null | undefined, canvas: { swipe?: unknown; taps?: unknown } | null | undefined, env: { preview: boolean; touchDevice: boolean }): CarouselTouch {
  const off = { swipe: false, hold: false, dots: false };
  if (!block || !Array.isArray(block.steps) || block.steps.length < 2) return off;
  return {
    // the Personalizado screen's own "Deslizar" (needs its taps) keeps working next to the carousel's
    swipe: !env.preview && (block.swipe === true || (canvas?.swipe === true && canvas?.taps === true)),
    hold: !env.preview && block.holdPause === true,
    dots: block.dots === 'always' || (block.dots === 'touch' && env.touchDevice),
  };
}

/** A press held this long without moving pauses the carousel. */
export const HOLD_MS = 500;
/** A finger moving more than this (px) is not a press: the hold is off (it may still be a swipe). */
export const HOLD_SLOP_PX = 16;
/** A hold ends by itself after this long, in case the lift of the finger is lost (a driver glitch). */
export const HOLD_MAX_MS = 10 * 60_000;
/** The press ring shows only after this long, so a quick tap never flashes it. */
export const PRESS_RING_DELAY_MS = 150;
/**
 * Presses that start on these never become a gesture: the controls do their own thing (Home Assistant cards,
 * sliders, the navigation cards, chores, To Do rows that tick a task, links and form fields).
 */
export const GESTURE_SKIP = '[data-ctl], [data-slide], [data-task], [data-chore], .cv-nav-btn, .k-chore, .kf-chore, a[href], input, select, textarea, button';

export type GestureAction = { do: 'step'; dir: 1 | -1 } | { do: 'press' } | { do: 'hold' } | { do: 'release' };

export interface GesturePointer {
  id: number;
  x: number;
  y: number;
}

export interface GestureDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
  /** a swipe moves the carousel now */
  swipe(): boolean;
  /** press and hold pauses it now */
  hold(): boolean;
  act(a: GestureAction): void;
}

/**
 * One finger (or pen) on the screen: a quick sideways stroke is a step, a still press of HOLD_MS is a hold until it
 * lifts. A mouse never counts (desktop drags, the admin), and a second finger (a pinch) ends the gesture.
 */
export class CarouselGesture {
  private p: { id: number; x: number; y: number; t: number } | null = null;
  private held = false;
  private moved = false;
  /** the press ring is on (shown after PRESS_RING_DELAY_MS, until the hold, a move or the lift) */
  private pressed = false;
  private timers: unknown[] = [];
  private maxTimer: unknown = null;

  constructor(private d: GestureDeps) {}

  /** A hold is on (the carousel is paused by the finger). */
  get holding(): boolean {
    return this.held;
  }

  down(e: GesturePointer & { type: string; skip?: boolean }): void {
    if (this.p) {
      // a second pointer while one is down: a pinch or a palm, not a gesture
      if (e.id !== this.p.id) this.cancel();
      return;
    }
    if (e.type === 'mouse' || e.skip) return;
    if (!this.d.swipe() && !this.d.hold()) return;
    this.p = { id: e.id, x: e.x, y: e.y, t: this.d.now() };
    this.moved = false;
    if (!this.d.hold()) return;
    this.timers.push(this.d.setTimer(() => {
      this.pressed = true;
      this.d.act({ do: 'press' });
    }, PRESS_RING_DELAY_MS));
    this.timers.push(this.d.setTimer(() => {
      this.disarm();
      this.held = true;
      this.d.act({ do: 'hold' });
      this.maxTimer = this.d.setTimer(() => this.release(), HOLD_MAX_MS);
    }, HOLD_MS));
  }

  move(e: GesturePointer): void {
    const p = this.p;
    if (!p || e.id !== p.id || this.held || this.moved) return;
    if (Math.hypot(e.x - p.x, e.y - p.y) > HOLD_SLOP_PX) {
      this.moved = true;
      // no hold any more; the ring goes ('release' with no hold only hides it)
      if (this.disarm()) this.d.act({ do: 'release' });
    }
  }

  up(e: GesturePointer, width: number): void {
    const p = this.p;
    if (!p || e.id !== p.id) return;
    this.p = null;
    const armed = this.disarm();
    if (this.held) return this.release();
    if (armed) this.d.act({ do: 'release' });
    if (!this.d.swipe()) return;
    const dir = swipeDir(e.x - p.x, e.y - p.y, this.d.now() - p.t, width);
    // to the left: the next screen; to the right: the one before
    if (dir) this.d.act({ do: 'step', dir: dir === -1 ? 1 : -1 });
  }

  /** The gesture ends with no step (a pinch, pointercancel, the tab hidden); a hold is released. */
  cancel(): void {
    this.p = null;
    const armed = this.disarm();
    if (this.held) this.release();
    else if (armed) this.d.act({ do: 'release' });
  }

  private release(): void {
    if (this.maxTimer !== null) this.d.clearTimer(this.maxTimer);
    this.maxTimer = null;
    this.p = null;
    if (!this.held) return;
    this.held = false;
    this.d.act({ do: 'release' });
  }

  /** Stop the pending press and hold timers; true when the press ring was on. */
  private disarm(): boolean {
    for (const t of this.timers) this.d.clearTimer(t);
    this.timers = [];
    const had = this.pressed;
    this.pressed = false;
    return had;
  }
}
