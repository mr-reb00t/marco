// Carousel runtime of the display (docs/ARCHITECTURE.md, Carousels): which screen of the carousel is on now, when
// the next one comes, and the data of every screen kept ready ("bundles") so a switch needs no request.
//
// - The step comes from the epoch clock and the server time (shared/carousels.ts carouselPhase), so every TV on the
//   same carousel switches at the same moment, also after a reconnect or a reload. One timer to the next boundary,
//   recomputed at every switch, so it never drifts.
// - A few seconds before a switch the next screen's data is refreshed when it is old (events older than a minute, a
//   new config revision, a privacy change for that screen, a live event that marked it).
// - Missing data (offline, server error): stay on the current screen and try again at the next step.
// - A doorbell ring or an announcement on screen holds the current step (holdOnAlert); when it is gone the display
//   jumps straight to the step the clock says.
// - Touch (web/display/nav.ts): jumpTo() restarts a step on this display only (an offset on the shared clock, so the
//   carousel goes on from there; a swipe passes its direction for the animation), visit() holds a screen outside the steps, pause() stops the rotation, home()
//   drops all three and follows the shared clock again.
// The controller does no DOM work and no fetches itself: main.ts passes them in (CarouselDeps), so it is tested
// with a fake clock (server/test/display-carousel.test.js).
import type { CarouselBlock, CountdownsResponse, DisplayConfig, EventsResponse, PhotosResponse } from '../shared/types';
import { carouselPhase, carouselSlot, cycleMs, speedOf, type CarouselPhase } from '../shared/carousels';
import { switchNumber, type SwitchInfo } from './switchPlan';

/** Everything one screen needs on the display, fetched for that screen. */
export interface Bundle {
  config: DisplayConfig | null;
  configAt: number;
  events: EventsResponse | null;
  eventsAt: number;
  countdowns: CountdownsResponse | null;
  countdownsAt: number;
  photos: PhotosResponse | null;
  photosAt: number;
  /** a live event said this screen changed (privacy, config, calendar data): refresh before showing it */
  dirty: boolean;
}

export type BundlePart = 'config' | 'events' | 'countdowns' | 'photos';

export interface CarouselDeps {
  /** server time (ms) */
  now: () => number;
  /** night mode with the night settings of `cfg` (the screen held at night) */
  night: (cfg: DisplayConfig | null) => boolean;
  /** true while a doorbell ring or an announcement is on screen */
  alertOn: () => boolean;
  /** fetch these parts for `screenId`; resolves with what came back (missing = failed) */
  fetch: (screenId: string, parts: BundlePart[], cfg: DisplayConfig | null) => Promise<Partial<Pick<Bundle, BundlePart>>>;
  /** put `screenId` on screen with its bundle; `sw` says how to animate it (web/display/switchPlan.ts) */
  show: (screenId: string, b: Bundle, sw: SwitchInfo) => void;
  /** the next screen's data is ready a few seconds before it comes on (main.ts loads its first photo then) */
  upcoming?: (screenId: string, b: Bundle) => void;
  /** the screen's data was refreshed while it is on screen */
  refreshed?: (screenId: string, b: Bundle, parts: BundlePart[]) => void;
  /** debug: ?step=<slug> pins one screen, ?carousel=0 freezes on the first step */
  pin?: string | null;
  frozen?: boolean;
  /** persist a bundle part (offline boot); optional */
  save?: (screenId: string, part: BundlePart, value: unknown) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export const EVENTS_MAX_AGE = 60_000;
export const COUNTDOWNS_MAX_AGE = 30 * 60_000;
export const PHOTOS_MAX_AGE = 60 * 60_000;
/** How long before a switch the next screen is refreshed (at most half the step). */
export const PREFETCH_LEAD = 8_000;
/** While nothing changes by time (night hold, paused), check again this often. */
export const IDLE_CHECK_MS = 30_000;
/** While an alert holds the step, check again this often. */
export const HOLD_CHECK_MS = 1_000;

export const emptyBundle = (): Bundle => ({
  config: null, configAt: 0, events: null, eventsAt: 0, countdowns: null, countdownsAt: 0, photos: null, photosAt: 0, dirty: false,
});

export class CarouselController {
  readonly bundles = new Map<string, Bundle>();
  private block: CarouselBlock;
  private tz: string;
  private active: string;
  private revision = 0;
  private timer: unknown = null;
  private prefetchTimer: unknown = null;
  private stopped = false;
  private loading = new Map<string, Promise<Bundle | null>>();
  /** tryNext() chose this screen: it stays until the next tryNext (the clock no longer decides) */
  private manual: string | null = null;
  /** switches made by tryNext: with 'random' each one is the next of the sequence, not the clock's slot again */
  private manualN = 0;
  /** switchNumber at the first tryNext */
  private manualBase: number | null = null;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (t: unknown) => void;
  /** this display's own rotation: ms added to the shared clock for the slot (a touch jumped to a step) */
  private offset = 0;
  /** the rotation is paused on this display ("Pausar carrusel"): what was left of the step when it paused */
  private pausedLeft: number | null = null;
  /** a screen outside the steps shown by touch ("Ir a pantalla"), until home() */
  private visiting: string | null = null;
  /** a swipe asked for this screen: its switch slides that way (only that one switch) */
  private swiped: { screenId: string; dir: 1 | -1 } | null = null;
  /** told when the step, the pause or the visit changes (the progress card) */
  onChange: (() => void) | null = null;

  constructor(block: CarouselBlock, tz: string, active: string, private d: CarouselDeps) {
    this.block = block;
    this.tz = tz;
    this.active = active;
    this.setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = d.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  /** Screen on the display now. */
  get current(): string {
    return this.active;
  }

  get carousel(): CarouselBlock {
    return this.block;
  }

  /** Bundle of a screen (created empty). */
  bundle(screenId: string): Bundle {
    let b = this.bundles.get(screenId);
    if (!b) {
      b = emptyBundle();
      this.bundles.set(screenId, b);
    }
    return b;
  }

  /** Store fresh data of a screen (main.ts calls it for the screen on display, whatever fetched it). */
  put(screenId: string, part: BundlePart, value: unknown, at = this.d.now()): void {
    const b = this.bundle(screenId);
    (b as any)[part] = value;
    (b as any)[`${part}At`] = at;
    if (part === 'config' && value) this.revision = Math.max(this.revision, (value as DisplayConfig).revision || 0);
    this.d.save?.(screenId, part, value);
  }

  /** What the clock says now (no pin, no hold), with this display's own offset. */
  phase(nowMs = this.d.now()): CarouselPhase {
    const off = this.bundles.get(this.block.offScreenId)?.config ?? null;
    return carouselPhase(this.block, nowMs, { tz: this.tz, night: this.d.night(off), offset: this.offset });
  }

  /** The screen that should be on: a visit, the pinned one, the first step while frozen, the paused one, else the clock's. */
  wanted(nowMs = this.d.now()): string {
    const steps = this.block.steps;
    if (this.visiting) return this.visiting;
    if (this.manual && steps.some((s) => s.screenId === this.manual)) return this.manual;
    if (this.d.pin) {
      const hit = steps.find((s) => s.slug === this.d.pin || s.screenId === this.d.pin);
      if (hit) return hit.screenId;
    }
    if (this.d.frozen && steps.length) return steps[0].screenId;
    if (this.pausedLeft !== null) return this.active;
    return this.phase(nowMs).screenId || this.active;
  }

  /** The step on screen now: its index (-1 outside the steps), whether it rotates, and when it started and ends. */
  where(nowMs = this.d.now()): { index: number; rotating: boolean; startsAt: number | null; endsAt: number | null; paused: boolean; visiting: string | null } {
    const steps = this.block.steps;
    const ph = this.phase(nowMs);
    const rotating = ph.mode === 'rotate' && !this.visiting && !this.d.pin && !this.d.frozen && this.manual === null;
    let index = steps.findIndex((s) => s.screenId === this.active);
    if (ph.mode === 'rotate' && ph.index >= 0 && steps[ph.index]?.screenId === this.active) index = ph.index;
    if (this.visiting) index = -1;
    const len = index >= 0 ? Math.max(1, Number(steps[index].seconds) || 0) * 1000 : 0;
    if (this.pausedLeft !== null) return { index, rotating: false, startsAt: null, endsAt: null, paused: true, visiting: this.visiting };
    if (!rotating || index < 0 || ph.index !== index || ph.endsAt === null) return { index, rotating: false, startsAt: null, endsAt: null, paused: false, visiting: this.visiting };
    // the slot's own end (a schedule boundary may cut it shorter)
    const slot = carouselSlot(steps, nowMs + this.offset);
    const end = slot ? slot.endsAt - this.offset : ph.endsAt;
    return { index, rotating: true, startsAt: end - len, endsAt: end, paused: false, visiting: null };
  }

  /** Paused on this display ("Pausar carrusel"). */
  get paused(): boolean {
    return this.pausedLeft !== null;
  }

  /** The screen held by touch outside the steps, or null. */
  get visit(): string | null {
    return this.visiting;
  }

  /** True while the clock rotates the steps (inside the schedule, not held at night, not pinned or frozen). */
  rotates(nowMs = this.d.now()): boolean {
    return this.phase(nowMs).mode === 'rotate' && !this.d.pin && !this.d.frozen;
  }

  /**
   * Show step `index` now and start its time from the beginning, on this display only: the carousel goes on from
   * there (the steps after it, each for its time). A visit and a pause end. `dir`: a swipe brought it (the switch
   * slides that way).
   */
  jumpTo(index: number, nowMs = this.d.now(), dir?: 1 | -1): void {
    const steps = this.block.steps;
    if (this.stopped || index < 0 || index >= steps.length) return;
    // the same screen already on display (a screen may come back in the next step) has no switch to animate
    this.swiped = dir && steps[index].screenId !== this.active ? { screenId: steps[index].screenId, dir } : null;
    const total = cycleMs(steps);
    let start = 0;
    for (let i = 0; i < index; i++) start += Math.max(1, Number(steps[i].seconds) || 0) * 1000;
    // (now + offset) mod total = the step's start in the loop
    this.offset = (((start - nowMs) % total) + total) % total;
    this.visiting = null;
    this.pausedLeft = null;
    this.manual = null;
    this.manualBase = null;
    this.manualN = 0;
    this.tick();
    this.onChange?.();
  }

  /** The next (+1) or the previous (-1) step from the one on screen (a swipe). */
  stepBy(dir: 1 | -1, nowMs = this.d.now()): void {
    const n = this.block.steps.length;
    if (n < 2) return;
    let i = this.where(nowMs).index;
    if (i < 0) i = Math.max(0, this.phase(nowMs).index);
    this.jumpTo((((i + dir) % n) + n) % n, nowMs, dir);
  }

  /** Show a screen that is not one of the steps and stay on it, until home() (or another touch). */
  visitScreen(screenId: string): void {
    if (this.stopped || !screenId) return;
    this.visiting = screenId;
    this.pausedLeft = null;
    this.swiped = null;
    this.tick();
    this.onChange?.();
  }

  /** Pause the rotation on this display, or go on: the step on screen then starts its time again. */
  pause(on: boolean, nowMs = this.d.now()): void {
    if (this.stopped || on === this.paused) return;
    if (on) {
      this.swiped = null;
      const w = this.where(nowMs);
      this.pausedLeft = w.endsAt !== null ? Math.max(0, w.endsAt - nowMs) : 0;
      this.tick();
      this.onChange?.();
      return;
    }
    this.pausedLeft = null;
    const i = this.where(nowMs).index;
    if (i >= 0 && this.rotates(nowMs)) this.jumpTo(i, nowMs);
    else {
      this.tick();
      this.onChange?.();
    }
  }

  /** Back to the shared clock: no visit, no pause, no offset (the display's normal carousel). */
  home(): void {
    const had = this.visiting !== null || this.pausedLeft !== null || this.offset !== 0 || this.manual !== null;
    this.visiting = null;
    this.pausedLeft = null;
    this.swiped = null;
    this.offset = 0;
    this.manual = null;
    this.manualBase = null;
    this.manualN = 0;
    if (!had) return;
    this.tick();
    this.onChange?.();
  }

  /**
   * The admin's "Probar" (?try=1): go to the step after the one on screen now, with the carousel's animation. From
   * then on the clock no longer moves the display; only the next tryNext does.
   */
  tryNext(): void {
    const steps = this.block.steps;
    if (this.stopped || steps.length < 2) return;
    const i = steps.findIndex((s) => s.screenId === this.active);
    let next = steps[(i + 1) % steps.length].screenId;
    if (next === this.active) next = steps.find((s) => s.screenId !== this.active)?.screenId ?? next;
    if (next === this.active) return;
    this.manual = next;
    this.manualBase ??= switchNumber(steps, this.d.now());
    this.manualN++;
    void this.switchTo(next);
  }

  /** The display shows `screenId` without the controller asking (the server answered with it). */
  adopt(screenId: string): void {
    this.active = screenId;
  }

  /** Start: keep the screen already on display, load the others in the background, then follow the clock. */
  start(): void {
    this.stopped = false;
    // the off-schedule screen decides the night hold: load it first, then look again (the screen on display is
    // loaded by main.ts as usual)
    if (this.block.offScreenId && this.block.offScreenId !== this.active) void this.ensure(this.block.offScreenId).then(() => this.tick());
    this.tick();
  }

  /** New carousel definition (config saved) or time zone. */
  update(block: CarouselBlock, tz: string): void {
    this.block = block;
    this.tz = tz;
    for (const id of [...this.bundles.keys()]) if (!this.members().includes(id) && id !== this.visiting) this.bundles.delete(id);
    this.tick();
  }

  /** A new config revision exists: every screen's config (and what depends on it) is refreshed before it shows. */
  revisionSeen(revision: number): void {
    if (revision > this.revision) {
      this.revision = revision;
      for (const [id, b] of this.bundles) if (id !== this.active) b.dirty = true;
    }
  }

  /** Mark one screen (or all) as changed: refreshed before it comes on screen. */
  invalidate(screenId?: string | null, parts?: BundlePart[]): void {
    const list = screenId ? [this.bundles.get(screenId)].filter(Boolean) as Bundle[] : [...this.bundles.values()];
    for (const b of list) {
      if (!parts) b.dirty = true;
      else for (const p of parts) (b as any)[`${p}At`] = 0;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    if (this.prefetchTimer !== null) this.clearTimer(this.prefetchTimer);
    this.timer = null;
    this.prefetchTimer = null;
  }

  /** Re-evaluate now: switch when the clock says so, then arm the next timers. Safe to call any time. */
  tick(): void {
    if (this.stopped) return;
    const now = this.d.now();
    const want = this.wanted(now);
    let holding = false;
    if (want && want !== this.active) {
      if (this.block.holdOnAlert && this.d.alertOn()) holding = true;
      else void this.switchTo(want);
    }
    this.arm(now, holding);
  }

  private members(): string[] {
    const ids = this.block.steps.map((s) => s.screenId);
    if (this.block.offScreenId) ids.push(this.block.offScreenId);
    return [...new Set(ids)];
  }

  private arm(now: number, holding: boolean): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    if (this.prefetchTimer !== null) this.clearTimer(this.prefetchTimer);
    this.timer = null;
    this.prefetchTimer = null;
    if (this.stopped) return;
    if (holding) {
      this.timer = this.setTimer(() => this.tick(), HOLD_CHECK_MS);
      return;
    }
    const pinned = Boolean(this.d.pin && this.block.steps.some((s) => s.slug === this.d.pin || s.screenId === this.d.pin)) || (this.d.frozen && this.block.steps.length > 0)
      || this.visiting !== null || this.pausedLeft !== null;
    const ph = pinned ? null : this.phase(now);
    const endsAt = ph?.endsAt ?? null;
    if (endsAt === null) {
      this.timer = this.setTimer(() => this.tick(), IDLE_CHECK_MS);
      return;
    }
    // a little after the boundary, so the clock is surely on the other side of it
    const wait = Math.max(50, endsAt - now + 30);
    this.timer = this.setTimer(() => this.tick(), Math.min(wait, 24 * 3600_000));
    const next = this.phase(endsAt + 1);
    // at most half of the step that is on (a 10 s step refreshes the next one 5 s ahead)
    const stepMs = ph && ph.mode === 'rotate' && ph.index >= 0 ? Math.max(1, Number(this.block.steps[ph.index]?.seconds) || 0) * 1000 : 2 * PREFETCH_LEAD;
    const lead = Math.min(PREFETCH_LEAD, Math.floor(stepMs / 2));
    if (next.screenId && next.screenId !== this.active) {
      this.prefetchTimer = this.setTimer(() => {
        this.prefetchTimer = null;
        if (typeof document !== 'undefined' && document.hidden) return;
        void this.ensure(next.screenId).then((b) => {
          if (b && !this.stopped && this.active !== next.screenId) this.d.upcoming?.(next.screenId, b);
        });
      }, Math.max(0, endsAt - lead - now));
    }
  }

  /** When the screen on display changes next by the clock (ms, server time), or null (paused, held, pinned, try mode). */
  nextSwitchAt(now = this.d.now()): number | null {
    if (this.stopped || this.manual !== null || this.d.frozen || this.d.pin || this.visiting !== null || this.pausedLeft !== null) return null;
    const ph = this.phase(now);
    if (ph.mode !== 'rotate' || ph.endsAt === null) return null;
    const next = this.phase(ph.endsAt + 1);
    return next.screenId && next.screenId !== ph.screenId ? ph.endsAt : null;
  }

  /** Parts of a screen's bundle that need a refresh now. */
  stale(screenId: string, now = this.d.now()): BundlePart[] {
    const b = this.bundles.get(screenId);
    if (!b || !b.config) return ['config', 'events', 'countdowns', 'photos'];
    const out: BundlePart[] = [];
    const priv = b.config.privacy;
    const privDue = [priv?.next, priv?.active ? priv?.until : null, b.config.canvas?.next].some((x) => x && Date.parse(x) <= now);
    if (b.dirty || b.config.revision < this.revision || privDue) out.push('config', 'events', 'countdowns');
    else {
      if (!b.events || now - b.eventsAt > EVENTS_MAX_AGE) out.push('events');
      if (!b.countdowns || now - b.countdownsAt > COUNTDOWNS_MAX_AGE) out.push('countdowns');
    }
    if (!b.photos || now - b.photosAt > PHOTOS_MAX_AGE || out.includes('config')) out.push('photos');
    return out;
  }

  /** Refresh what is old in a screen's bundle. Resolves with the bundle, or null when it has no config yet. */
  ensure(screenId: string): Promise<Bundle | null> {
    if (!screenId) return Promise.resolve(null);
    const running = this.loading.get(screenId);
    if (running) return running;
    const parts = this.stale(screenId);
    if (!parts.length) return Promise.resolve(this.bundle(screenId));
    const p = (async () => {
      try {
        const b0 = this.bundle(screenId);
        const got = await this.d.fetch(screenId, parts, b0.config);
        const at = this.d.now();
        for (const k of parts) if (got[k]) this.put(screenId, k, got[k], at);
        const b = this.bundle(screenId);
        if (got.config) b.dirty = false;
        if (screenId === this.active && !this.stopped) this.d.refreshed?.(screenId, b, parts.filter((k) => got[k]));
        return b.config ? b : null;
      } catch {
        return this.bundles.get(screenId)?.config ? this.bundle(screenId) : null;
      } finally {
        this.loading.delete(screenId);
      }
    })();
    this.loading.set(screenId, p);
    return p;
  }

  private switchTo(screenId: string): Promise<void> | void {
    const b = this.bundles.get(screenId);
    const ready = b?.config && b.events;
    if (ready && !b.dirty && !(b.config!.revision < this.revision)) {
      this.show(screenId, b);
      // anything old is refreshed while it is on screen
      if (this.stale(screenId).length) void this.ensure(screenId);
      return;
    }
    return this.ensure(screenId).then((fresh) => {
      if (this.stopped || !fresh?.config || !fresh.events) return; // no data: stay, try again at the next step
      if (this.wanted() !== screenId || this.active === screenId) return;
      if (this.block.holdOnAlert && this.d.alertOn()) return this.tick();
      this.show(screenId, fresh);
    });
  }

  private show(screenId: string, b: Bundle): void {
    if (screenId === this.active) return;
    this.active = screenId;
    // only the switch the swipe asked for slides its way; a later one by the clock or a tap has its own animation
    const dir = this.swiped?.screenId === screenId ? this.swiped.dir : undefined;
    this.swiped = null;
    this.d.show(screenId, b, {
      transition: this.block.transition || 'fade',
      speed: speedOf(this.block.transitionSpeed),
      n: this.manual && this.manualBase !== null ? this.manualBase + this.manualN : switchNumber(this.block.steps, this.d.now() + this.offset),
      seed: this.block.id,
      ...(dir ? { dir } : {}),
    });
    this.onChange?.();
  }
}
