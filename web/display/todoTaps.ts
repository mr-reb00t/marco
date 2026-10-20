// Taps on Microsoft To Do tasks (todo.touch in the display config: the screen allows touch, it is not private and the
// server may write to the list). One delegated listener on the document picks up `[data-task]` rows drawn by
// renderTodo (widgets/extras.ts) in the side card and in the Personalizado to-do card. A tap shows at once (the task
// is struck through), goes to the server, and is put back with a short note when the server says no. One tap per task
// every 700 ms, as for routines (widgets/kids.ts ChoreTaps): a finger that bounces must not tick and untick. A second
// tap while the task is still on screen puts it back (it leaves the list when the server reads the list again).
// While night mode dims the screen a tap does nothing here: main.ts wakes the screen.
import type { DisplayConfig, TodoItem } from '../shared/types';

const TAP_LOCK_MS = 700;
/** How long the "did not work" note stays on a task. */
const NOTE_MS = 4_000;
/** A tap shown before the config says the same is kept at most this long. */
const SHOWN_MS = 10 * 60_000;

interface Host {
  /** send one tap; rejects when the server says no */
  send(id: string, done: boolean): Promise<void>;
  /** draw the to-do lists again */
  redraw(): void;
  /** taps may go out now (online, not the admin's preview) */
  allowed(): boolean;
}

/** A task of a Microsoft To Do list (the server's opaque id), not an item typed in the admin (core microsoftGraph.js). */
export const isListTask = (id: string): boolean => typeof id === 'string' && id.startsWith('ms_');

let host: Host | null = null;
const shown = new Map<string, { done: boolean; at: number }>();
const locks = new Map<string, number>();
const notes = new Map<string, number>();

/** Taps are on for this config: the server allows them on this screen and the display may send them. */
export function todoTapsOn(cfg: DisplayConfig): boolean {
  return !!cfg.todo?.touch && !!host?.allowed();
}

/** The items with the taps not confirmed yet laid over them (a tap the config already shows is forgotten). */
export function todoView(items: TodoItem[]): TodoItem[] {
  const now = Date.now();
  return items.map((it) => {
    const s = shown.get(it.id);
    if (!s) return it;
    if (s.done === it.done || now - s.at > SHOWN_MS) {
      shown.delete(it.id);
      return it;
    }
    return { ...it, done: s.done };
  });
}

/** The task's last tap did not work (shown for a few seconds). */
export function todoFailed(id: string): boolean {
  const until = notes.get(id);
  if (until && until > Date.now()) return true;
  notes.delete(id);
  return false;
}

function onTap(e: PointerEvent): void {
  const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-task]');
  if (!row || !host || !host.allowed() || document.documentElement.classList.contains('night')) return;
  const id = row.dataset.task || '';
  const now = Date.now();
  if (!id || now - (locks.get(id) ?? 0) < TAP_LOCK_MS) return;
  locks.set(id, now);
  const done = row.dataset.done !== '1';
  shown.set(id, { done, at: now });
  notes.delete(id);
  host.redraw();
  host.send(id, done).catch(() => {
    if (shown.get(id)?.at === now) shown.delete(id);
    notes.set(id, Date.now() + NOTE_MS);
    host?.redraw();
    setTimeout(() => host?.redraw(), NOTE_MS + 50);
  });
}

/** Start listening (once). */
export function initTodoTaps(h: Host): void {
  if (!host) document.addEventListener('pointerup', onTap);
  host = h;
}
