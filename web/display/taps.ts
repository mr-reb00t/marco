// Tap or stroke: one document listener notes where each pointer goes down (nav.ts TapTracker), and the tap handlers
// (To Do rows in todoTaps.ts, routines in widgets/kids.ts ChoreTaps) ignore a lift that moved, so a swipe that starts
// on a row steps the carousel without also ticking the task.
import { TapTracker } from './nav';

const tracker = new TapTracker();
let listening = false;

/** Start noting the pointer downs (once; capture, so a handler that stops the event cannot hide it). */
function listen(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('pointerdown', (e) => tracker.down({ id: e.pointerId, x: e.clientX, y: e.clientY }), { capture: true, passive: true });
}
listen();

/** The pointerup `e` lifted about where it went down (not a swipe). */
export function isTap(e: PointerEvent): boolean {
  return tracker.isTap({ id: e.pointerId, x: e.clientX, y: e.clientY });
}
