// What one to-do surface shows (#15): a Personalizado to-do card (canvasCore.js props) or the to-do part of a classic
// screen (screen.todo). Each one picks its lists, its title, its icon and which tasks it shows; the display filters
// the items of its config with these rules (web/display/widgets/extras.ts), so a draft in the admin's preview and a
// tap on a task behave the same on every card. Plain JS: the server, Marco Cloud and both browser pages import it.
//
// Every to-do item of a display config says where it comes from (`list`): 'local' for the tasks typed in Marco, the
// id of its todo.lists entry (tl_...) for a Microsoft To Do task. Never a Graph id or an account.

/** The tasks typed in Marco (todo.items), as a list of their own. */
export const LOCAL_TODO_LIST = 'local';
/** Which tasks a surface shows: all, the starred ones, or the ones due today or before. */
export const TODO_FILTERS = ['all', 'important', 'due'];
export const TODO_TITLE_MAX = 40;
/** Lists one surface may pick: the typed tasks and every Microsoft list (validate.js MAX_TODO_LISTS). */
export const TODO_PICK_MAX = 11;
const LIST_ID = /^(?:local|tl_[A-Za-z0-9_-]{1,60})$/;

/** The settings of a surface that shows everything, as before (screen.todo, the props of a new to-do card). */
export const defaultTodoView = () => ({ listIds: null, title: '', icon: '', filter: 'all' });

// eslint-disable-next-line no-control-regex
const cleanText = (s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

/**
 * The settings of one surface from `raw` ({ listIds, title, icon, filter }; other keys are left to the caller).
 * `known`: the ids that may be picked ('local' and the todo.lists ids), or null for any well formed id. Unknown and
 * removed lists are dropped quietly; when none is left the surface shows every list again (null).
 * `err(path, message)` hears wrong types.
 */
export function sanitizeTodoView(raw, err = () => {}, path = 'todo', known = null) {
  const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const D = defaultTodoView();
  let listIds = null;
  if (x.listIds !== undefined && x.listIds !== null) {
    if (!Array.isArray(x.listIds)) err(`${path}.listIds`, 'expected array');
    else {
      const ids = [...new Set(x.listIds.filter((v) => typeof v === 'string' && LIST_ID.test(v) && (!known || known.has(v))))].slice(0, TODO_PICK_MAX);
      listIds = ids.length ? ids : null;
    }
  }
  // `quiet`: cut without a word (an emoji is one picked from the picker, however many characters it takes)
  const text = (k, max, quiet = false) => {
    const v = x[k];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') {
      err(`${path}.${k}`, 'expected string');
      return '';
    }
    const s = [...cleanText(v).trim()];
    if (s.length > max && !quiet) err(`${path}.${k}`, `too long (max ${max})`);
    return s.slice(0, max).join('');
  };
  let filter = D.filter;
  if (x.filter !== undefined && x.filter !== null) {
    if (TODO_FILTERS.includes(x.filter)) filter = x.filter;
    else err(`${path}.filter`, `must be one of ${TODO_FILTERS.join(', ')}`);
  }
  return { listIds, title: text('title', TODO_TITLE_MAX), icon: text('icon', 12, true), filter };
}

/** The ids a surface may pick in a config: the typed tasks and every entry of todo.lists (on or off). */
export const todoListIds = (cfg) => new Set([LOCAL_TODO_LIST, ...(Array.isArray(cfg?.todo?.lists) ? cfg.todo.lists : []).map((l) => l?.id).filter((v) => typeof v === 'string')]);

/** The list an item comes from (an item with none is a typed one). */
export const todoListOf = (item) => (typeof item?.list === 'string' && item.list ? item.list : LOCAL_TODO_LIST);

/**
 * The items a surface shows, in their order: of its lists (null = every list), then by its filter. `today`:
 * YYYY-MM-DD in the screen's time zone. Typed tasks have no star and no due day, so they only show with 'all'.
 */
export function todoShown(items, view, today) {
  const ids = Array.isArray(view?.listIds) && view.listIds.length ? new Set(view.listIds) : null;
  const f = view?.filter;
  return (Array.isArray(items) ? items : []).filter((i) => {
    if (!i || (ids && !ids.has(todoListOf(i)))) return false;
    if (f === 'important') return i.important === true;
    if (f === 'due') return typeof i.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.due) && i.due <= today;
    return true;
  });
}

/**
 * A surface's heading: its own title, else the name of its one Microsoft list (`names`: the display config's
 * todo.listNames), else `fallback` (the usual "Tareas", in the screen's language).
 */
export function todoTitle(view, names, fallback) {
  const own = typeof view?.title === 'string' ? view.title.trim() : '';
  if (own) return own;
  const ids = Array.isArray(view?.listIds) ? view.listIds : [];
  if (ids.length === 1 && ids[0] !== LOCAL_TODO_LIST) {
    const n = names && typeof names[ids[0]] === 'string' ? names[ids[0]].trim() : '';
    if (n) return n;
  }
  return fallback;
}

/** The surfaces of a screen: its own to-do settings, and those of its to-do cards on a Personalizado screen. */
export function todoViews(screen, cards = []) {
  const out = [screen?.todo ?? {}];
  for (const it of cards) if (it?.kind === 'todo') out.push(it.props ?? {});
  return out;
}

/**
 * The names a screen needs for its headings: only lists that are the one list of one of its surfaces (`views`), on
 * in todo.lists. The other names stay on the server.
 */
export function todoListNames(cfg, views) {
  const lists = new Map((Array.isArray(cfg?.todo?.lists) ? cfg.todo.lists : []).filter((l) => l && l.enabled !== false).map((l) => [l.id, l.name || '']));
  const out = {};
  for (const v of views) {
    const ids = Array.isArray(v?.listIds) ? v.listIds : [];
    if (ids.length === 1 && lists.get(ids[0])) out[ids[0]] = lists.get(ids[0]);
  }
  return out;
}
