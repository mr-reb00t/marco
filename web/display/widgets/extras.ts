// Custom message banner + to-do list cards (side panel).
import type { DisplayConfig, TodoItem } from '../../shared/types';
import { dateKeyInTz, diffDays, formatDatePattern, relativeDayLabel } from '../../shared/i18n';
import { ctx } from '../ctx';
import { esc, setHTML } from '../dom';
import { ICON } from '../icons';
import { now } from '../time';
import { todoFailed, todoTapsOn, todoView } from '../todoTaps';

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
 * `opts`: at most `max` rows (default 6) and the done ones too (default yes). Microsoft To Do tasks a touch screen may
 * tick are drawn with `data-task` (todoTaps.ts listens for the taps).
 */
export function renderTodo(root: HTMLElement, cfg: DisplayConfig = ctx.cfg, opts: { max?: number; showDone?: boolean } = {}): void {
  const td = cfg.todo;
  const items = todoView(td.items || []).filter((i) => i.text?.trim() && (opts.showDone !== false || !i.done));
  const on = td.enabled && items.length > 0;
  root.style.display = on ? '' : 'none';
  if (!on) return;
  const sorted = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)].slice(0, opts.max ?? 6);
  const taps = todoTapsOn(cfg);
  const today = dateKeyInTz(now(), ctx.tz);
  setHTML(
    root,
    `<div class="card-h">✅ ${esc(ctx.t('todo'))}</div><ul>${sorted
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
