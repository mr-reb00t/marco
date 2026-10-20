// Custom message banner + to-do list cards (side panel).
import type { DisplayConfig, TodoItem } from '../../shared/types';
import { dateKeyInTz, diffDays, formatDatePattern, relativeDayLabel } from '../../shared/i18n';
import { ctx } from '../ctx';
import { esc, setHTML } from '../dom';
import { ICON } from '../icons';
import { now } from '../time';
import { todoFailed, todoTapsOn, todoView } from '../todoTaps';
import { todoShown, todoTitle } from '../../../server/core/todoCore.js';

export function renderMessage(root: HTMLElement, cfg: DisplayConfig = ctx.cfg): void {
  const m = cfg.message;
  const on = m.enabled && !!m.text.trim();
  root.style.display = on ? '' : 'none';
  if (!on) return;
  setHTML(root, `<span class="msg-em">${esc(m.emoji || '💬')}</span><span class="msg-tx">${esc(m.text)}</span>`);
}

/**
 * The star and the due day of a Microsoft To Do task (TodoItem.important / due), as HTML after its title: today,
 * tomorrow or a weekday within the coming week, else the day and month; an overdue day gets `late`.
 */
export function todoMetaHtml(i: TodoItem, today = dateKeyInTz(now(), ctx.tz)): string {
  let out = '';
  if (i.due && /^\d{4}-\d{2}-\d{2}$/.test(i.due)) {
    const dd = diffDays(today, i.due);
    const label = dd >= -1 && dd <= 6 ? relativeDayLabel(ctx.lang, i.due, today) : formatDatePattern(ctx.lang, i.due, '{d} {mmm}');
    out += `<small class="td-due${dd < 0 && !i.done ? ' late' : ''}">${esc(label)}</small>`;
  }
  if (i.important) out += '<b class="td-star" aria-hidden="true">★</b>';
  return out;
}

/**
 * The items `cfg.todo` shows: of its lists and by its filter (a to-do card's settings, or the screen's; core
 * todoCore.js), with the taps not confirmed yet laid over them, open ones first. Items without text are left out.
 */
export function todoItemsOf(cfg: DisplayConfig = ctx.cfg, today = dateKeyInTz(now(), ctx.tz)): TodoItem[] {
  const items = todoShown(todoView(cfg.todo?.items || []), cfg.todo, today).filter((i) => i.text?.trim());
  return [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
}

/** The heading of `cfg.todo`: its icon (`icon` when it has none) and its title (`fallback`: the usual words). */
export function todoHeadOf(cfg: DisplayConfig = ctx.cfg, fallback = ctx.t('todo'), icon = '✅'): { icon: string; title: string } {
  return { icon: cfg.todo?.icon || icon, title: todoTitle(cfg.todo, cfg.todo?.listNames, fallback) };
}

/**
 * `opts`: at most `max` rows (default 6) and the done ones too (default yes). Microsoft To Do tasks a touch screen may
 * tick are drawn with `data-task` (todoTaps.ts listens for the taps).
 */
export function renderTodo(root: HTMLElement, cfg: DisplayConfig = ctx.cfg, opts: { max?: number; showDone?: boolean } = {}): void {
  const td = cfg.todo;
  const today = dateKeyInTz(now(), ctx.tz);
  const items = todoItemsOf(cfg, today).filter((i) => opts.showDone !== false || !i.done);
  const on = td.enabled && items.length > 0;
  root.style.display = on ? '' : 'none';
  if (!on) return;
  const sorted = items.slice(0, opts.max ?? 6);
  const taps = todoTapsOn(cfg);
  const head = todoHeadOf(cfg);
  setHTML(
    root,
    `<div class="card-h">${esc(head.icon)} ${esc(head.title)}</div><ul>${sorted
      .map((i) => {
        const tap = taps && i.tick;
        const failed = tap && todoFailed(i.id);
        const cls = [i.done ? 'done' : '', tap ? 'tap' : '', failed ? 'tap-fail' : ''].filter(Boolean).join(' ');
        const attrs = tap ? ` data-task="${esc(i.id)}" data-done="${i.done ? 1 : 0}" role="button"` : '';
        return `<li class="${cls}"${attrs}>${i.done ? ICON.check : ICON.circle}<span>${esc(i.text)}</span>${todoMetaHtml(i, today)}${
          failed ? `<em class="td-err">${esc(ctx.t('haErrFailed'))}</em>` : ''
        }</li>`;
      })
      .join('')}</ul>`,
  );
}
