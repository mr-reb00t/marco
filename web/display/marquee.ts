// Titles cut short move to show the rest (calendar.marquee):
// - one-line titles (bars and timed chips of the calendar grids, the list-like views, the side panel's pills,
//   countdowns and agenda) slide sideways to their end, wait, slide back, wait, and so on;
// - chip titles clamped to a few lines in a month cell scroll up like film credits, a line at a time, until the last
//   line shows, wait, glide back, wait; the box keeps its size (the grid never moves) and the time stays put when there is room;
// - the news headline slides once per item, within the time the item stays on screen.
// A title that fits never moves. Every motion is one Web Animation on the transform of an inner wrapper (runs on the
// compositor, no per-frame script); titles are measured after each render and when the screen size or fonts change.
import { ctx } from './ctx';
import {
  MARQUEE_MAX, MARQUEE_MAX_LITE, creditsTiming, marqueeDelay, marqueeTiming, onceTiming, pickMovers,
  type MarqueeTiming,
} from './motion';

/** One-line titles that slide sideways. */
const SLIDE = [
  '.cal .ev:not(.wrap) > .tt', // bars and one-line timed chips (month, week, two weeks)
  '.agenda .ag-tt', '.agenda .ag-sub', // agenda view and the side agenda
  '.td-chip > b', '.td-tt', '.td-l1 > span', // today
  '.pp-chip > b', '.pp-tt', // per person
  '.bd-agenda .bd-tt', // board: agenda card
  '.pf-tt', // next event line of the portrait views
  '.hl-tt', // side panel pills: next event, happening now, check-in / check-out, birthdays
  '.cd-tt', // countdowns
  '.sched-body', // scheduled messages
  '.cv-msg.is-mline .msg-tx', // a Personalizado message on one line (a small box, the compact look)
].join(',');
/** Chip titles clamped to a few lines (and card titles, calendar.eventStyle = 'cards'): they scroll up. */
const SCROLL = ['.cal .ev.wrap > .tx', '.cal .ev.card > .tx'].join(',');
/** The news headline: one slide per item (its .news-item carries data-mq-until, when it leaves). */
const ONCE = '.news-item:last-child > .news-title';

type Kind = 'x' | 'y' | 'once';

interface MqState {
  kind: Kind;
  distance: number;
  anim: Animation | null;
  /** 'y': the chip's size when the scroll was set up (a new size sets it up again) */
  w?: number;
  h?: number;
  /** 'y': the nodes of the title in their original order, to put back */
  nodes?: Node[];
}

interface MqEl extends HTMLElement {
  __mq?: MqState;
}

const reduceQuery = (() => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return null;
  }
})();

/** Narrowest box (in display units) worth sliding a title in. */
const MIN_BOX_U = 5;

let frame = 0;
/** Elements set up to scroll (their wrappers must come off when they stop). */
const scrolling = new Set<MqEl>();
/**
 * Where each moving title is in its cycle (timeline start time by its text): a pill re-drawn with a new countdown
 * ("In 23 min" → "In 22 min") or a list re-rendered picks up its titles where they were instead of starting over.
 */
let phase = new Map<string, number>();

/** Measure again in the next frame (coalesced: many calls in one frame measure once). */
export function refreshMarquee(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    scan();
  });
}

function enabled(): boolean {
  return ctx.cfg.calendar.marquee !== false && !reduceQuery?.matches;
}

function innerOf(el: HTMLElement): HTMLElement | null {
  const c = el.firstElementChild as HTMLElement | null;
  return c && c.classList.contains('mq-in') && el.childNodes.length === 1 ? c : null;
}

/** The scrolling box of a 'y' title that is still set up (null once a render replaced its content). */
function boxOf(el: HTMLElement): HTMLElement | null {
  const b = el.lastElementChild as HTMLElement | null;
  return b && b.classList.contains('mq-box') && b.firstElementChild?.classList.contains('mq-in') ? b : null;
}

function stop(el: MqEl): void {
  const st = el.__mq;
  if (!st) return;
  st.anim?.cancel();
  el.__mq = undefined;
  if (st.kind === 'y') {
    scrolling.delete(el);
    if (boxOf(el) && st.nodes) el.replaceChildren(...st.nodes);
    el.classList.remove('mqv', 'mqv-pin');
    el.style.removeProperty('height');
    return;
  }
  const inner = innerOf(el);
  if (inner) el.replaceChildren(...Array.from(inner.childNodes));
  el.classList.remove('mq');
}

function kindOf(el: Element): Kind {
  return el.matches(SCROLL) ? 'y' : el.matches(ONCE) ? 'once' : 'x';
}

function animate(inner: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions, key: string, keep: Map<string, number>): Animation | null {
  try {
    const anim = inner.animate(frames, opts);
    const now = document.timeline?.currentTime;
    if (typeof now === 'number') {
      const t0 = phase.get(key);
      // carry on from where the same title was (only for the looping motions)
      anim.startTime = t0 !== undefined && opts.iterations === Infinity ? t0 : now;
      keep.set(key, anim.startTime as number);
    }
    return anim;
  } catch {
    return null; // no Web Animations: the title just shows its start
  }
}

/** Ping-pong keyframes of the side slide. */
function loopFrames(distance: number, offsets: [number, number, number]): Keyframe[] {
  const [a, b, c] = offsets;
  const f = (px: number) => ({ transform: `translateX(${-px}px)` });
  return [
    { ...f(0), offset: 0 },
    { ...f(0), offset: a, easing: 'ease-in-out' },
    { ...f(distance), offset: b },
    { ...f(distance), offset: c, easing: 'ease-in-out' },
    { ...f(0), offset: 1 },
  ];
}

/**
 * Set a clamped chip title up to scroll: it keeps its height, loses the clamp (no "…" while it moves), and its
 * words go into a box that clips an inner wrapper. The time keeps the first line to itself when it already had it, or
 * with 3 lines or more.
 * Returns the distance to scroll (0 when it turns out to fit) and the height of a line.
 */
function setUpScroll(el: MqEl, chipW: number, chipH: number): { distance: number; line: number } {
  const h = el.clientHeight;
  const nodes = Array.from(el.childNodes);
  // the title's own line height (taller than the box's, for descenders) sets the real line pitch: take it from the
  // clamped height, so each step moves exactly one line
  const css = parseFloat(getComputedStyle(el).lineHeight) || h;
  const lines = Math.max(1, Math.round(h / css));
  const lh = h / lines;
  const tm = el.querySelector(':scope > .tm');
  const tt = el.querySelector(':scope > .tt');
  // the time stays on top when it already has the first line to itself (narrow columns), or when there are lines
  // enough to give it one; otherwise it scrolls with the title and comes back at every pause
  const alone = !!tm && !!tt && (tt.getClientRects()[0]?.top ?? 0) - tm.getBoundingClientRect().top > lh / 2;
  const pin = !!tm && (alone || lines >= 3);
  const box = document.createElement('span');
  box.className = 'mq-box';
  const inner = document.createElement('span');
  inner.className = 'mq-in';
  box.append(inner);
  if (pin) {
    // emoji and time stay on top; the title (and place) scroll below them
    const at = nodes.indexOf(tm!) + 1;
    const hd = document.createElement('span');
    hd.className = 'mq-hd';
    hd.append(...nodes.slice(0, at));
    inner.append(...nodes.slice(at));
    el.replaceChildren(hd, box);
  } else {
    inner.append(...nodes);
    el.replaceChildren(box);
  }
  el.style.height = `${h}px`;
  el.classList.add('mqv');
  el.classList.toggle('mqv-pin', pin);
  el.__mq = { kind: 'y', distance: 0, anim: null, w: chipW, h: chipH, nodes };
  scrolling.add(el);
  return { distance: Math.ceil(inner.offsetHeight - box.clientHeight), line: lh };
}

function scan(): void {
  const on = enabled();
  // Scrolling chips whose content was re-rendered or whose chip changed size: put them back as they were, so they
  // are measured with their real clamp below.
  for (const el of scrolling) {
    const chip = el.parentElement;
    if (!on || !el.isConnected || !chip || !boxOf(el) || chip.clientWidth !== el.__mq?.w || chip.clientHeight !== el.__mq?.h) {
      if (!boxOf(el) && el.__mq) el.__mq.nodes = undefined; // a render already put new content in
      stop(el);
    }
  }
  // not the still copy of the screen that leaves during a carousel switch (web/display/screenSwitch.ts)
  const els = Array.from(document.querySelectorAll<MqEl>(`${SLIDE},${SCROLL},${ONCE}`)).filter((el) => !el.closest('.switch-shot'));
  const kinds = els.map(kindOf);
  const unit = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  const vw = window.innerWidth, vh = window.innerHeight;
  const now = Date.now();
  // read every size first, then write (one layout pass)
  const over = els.map((el, i) => {
    // a chip on a busy day's page that is not showing does not move (nor count against the budget)
    if (!on || !el.isConnected || el.closest('.pg-off')) return 0;
    // clipped off the screen (the Agenda's extra columns, rows below the fold): no motion nobody sees
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return 0;
    const box = el.clientWidth;
    // a box squeezed to a few letters would only show a blur of moving text: keep the ellipsis there
    if (box < MIN_BOX_U * unit) return 0;
    if (kinds[i] === 'y') {
      if (el.__mq?.kind === 'y') return el.__mq.distance; // already scrolling, same size
      // a clamp hides whole lines: a few pixels over (descenders, a box a bit short) is not a hidden line
      const d = el.scrollHeight - el.clientHeight;
      return d >= 0.6 * (parseFloat(getComputedStyle(el).lineHeight) || 0) ? d : 0;
    }
    const inner = innerOf(el);
    return (inner ? inner.offsetWidth : el.scrollWidth) - box;
  });
  const windowOf = (el: HTMLElement) => Number((el.parentElement as HTMLElement | null)?.dataset.mqUntil) - now;
  const timing = (i: number) => {
    const k = kinds[i];
    if (k === 'once') return onceTiming(over[i], unit, windowOf(els[i]));
    return marqueeTiming(over[i], unit);
  };
  const movers = new Set(pickMovers(over.map((_, i) => !!timing(i)), ctx.lite ? MARQUEE_MAX_LITE : MARQUEE_MAX));
  const keep = new Map<string, number>();
  let n = 0;
  els.forEach((el, i) => {
    if (!movers.has(i)) return stop(el);
    const kind = kinds[i];
    const key = `${kind}|${el.textContent}`;
    const st = el.__mq;
    if (kind === 'y') {
      if (st?.kind === 'y' && st.anim) {
        if (phase.has(key)) keep.set(key, phase.get(key)!);
        n++;
        return; // already scrolling in a box of the same size
      }
      if (st) stop(el); // set up but not moving (no Web Animations): start from the plain title again
      const chip = el.parentElement!;
      const { distance, line } = setUpScroll(el, chip.clientWidth, chip.clientHeight);
      const t = creditsTiming(distance, line, unit);
      if (!t) return stop(el);
      const inner = el.querySelector<HTMLElement>(':scope > .mq-box > .mq-in')!;
      el.__mq!.distance = t.distance;
      const frames = t.frames.map((f, k) => ({
        offset: f.offset, transform: `translateY(${-f.y}px)`, ...(k < t.frames.length - 1 ? { easing: 'ease-in-out' } : {}),
      }));
      el.__mq!.anim = animate(inner, frames, {
        duration: t.duration, delay: marqueeDelay(n), iterations: Infinity,
      }, key, keep);
      n++;
      return;
    }
    const t = timing(i)!;
    if (st && st.kind === kind && Math.abs(st.distance - t.distance) <= 1 && innerOf(el)) {
      if (phase.has(key)) keep.set(key, phase.get(key)!);
      if (kind === 'x') n++;
      return; // already sliding the right distance: leave it running
    }
    st?.anim?.cancel();
    let inner = innerOf(el);
    if (!inner) {
      inner = document.createElement('span');
      inner.className = 'mq-in';
      inner.append(...Array.from(el.childNodes));
      el.append(inner);
    }
    el.classList.add('mq');
    let anim: Animation | null;
    if (kind === 'once') {
      const o = onceTiming(over[i], unit, windowOf(el))!;
      const x = (px: number) => ({ transform: `translateX(${-px}px)` });
      anim = animate(inner, [
        { ...x(0), offset: 0 },
        { ...x(0), offset: o.offsets[0], easing: 'ease-in-out' },
        { ...x(o.distance), offset: o.offsets[1] },
        { ...x(o.distance), offset: 1 },
      ], { duration: o.duration, fill: 'forwards' }, key, keep);
    } else {
      anim = animate(inner, loopFrames(t.distance, (t as MarqueeTiming).offsets), {
        duration: t.duration, delay: marqueeDelay(n), iterations: Infinity,
      }, key, keep);
      n++;
    }
    el.__mq = { kind, distance: t.distance, anim };
  });
  phase = keep;
}

// The screen size, the fonts or the motion preference changed: measure again.
try {
  reduceQuery?.addEventListener('change', refreshMarquee);
} catch { /* old browser */ }
try {
  if ('ResizeObserver' in window) {
    let w = 0, h = 0;
    new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (Math.abs(r.width - w) < 1 && Math.abs(r.height - h) < 1) return;
      w = r.width;
      h = r.height;
      refreshMarquee(); // in the next frame, never inside the observer callback (no loop warnings)
    }).observe(document.documentElement);
  }
} catch { /* ignore */ }
try {
  void document.fonts?.ready.then(refreshMarquee);
} catch { /* old browser */ }
