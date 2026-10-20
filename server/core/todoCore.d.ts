// Types for todoCore.js (the display's to-do cards, the admin's to-do settings).
import type { TodoFilter, TodoItem, TodoView } from '../../web/shared/types';

export const LOCAL_TODO_LIST: 'local';
export const TODO_FILTERS: readonly TodoFilter[];
export const TODO_TITLE_MAX: number;
export const TODO_PICK_MAX: number;
export function defaultTodoView(): TodoView;
export function sanitizeTodoView(raw: unknown, err?: (path: string, message: string) => void, path?: string, known?: Set<string> | null): TodoView;
export function todoListIds(cfg: unknown): Set<string>;
export function todoListOf(item: Partial<TodoItem> | null | undefined): string;
export function todoShown<T extends Partial<TodoItem>>(items: T[], view: Partial<TodoView> | null | undefined, today: string): T[];
export function todoTitle(view: Partial<TodoView> | null | undefined, names: Record<string, string> | null | undefined, fallback: string): string;
export function todoViews(screen: unknown, cards?: unknown[]): Partial<TodoView>[];
export function todoListNames(cfg: unknown, views: Partial<TodoView>[]): Record<string, string>;
