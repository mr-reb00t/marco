// Per-card to-do settings (#15, server/core/todoCore.js): which lists, the title, the icon and which tasks, on a
// Personalizado to-do card (canvasCore props) and on a classic screen's to-do part (screen.todo). Validation, the
// filter, the default title, what the display config carries and what it never does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { displayConfig } from '../core/screens.js';
import { CANVAS_KINDS } from '../core/canvasCore.js';
import { displayTodoItem } from '../core/microsoftGraph.js';
import { sanitizeTodoView, todoListNames, todoShown, todoTitle, todoViews } from '../core/todoCore.js';
import { loadWebModules } from './webModules.js';

const SHOP = { id: 'tl_shop', type: 'microsoft', microsoftAccount: 'ana@outlook.example', microsoftListId: 'graph-list-shop', name: 'Shopping', enabled: true };
const HOME = { id: 'tl_home', type: 'microsoft', microsoftAccount: 'leo@outlook.example', microsoftListId: 'graph-list-home', name: 'Chores', enabled: true };

/** A config with two To Do lists, a typed task and one Personalizado screen with the given to-do cards. */
function config(cards = [], screenTodo = {}) {
  const c = defaultConfig();
  c.todo.items = [{ id: 't_typed', text: 'Typed here', done: false }];
  c.todo.lists = [SHOP, HOME];
  c.screens[0].todo = { ...c.screens[0].todo, enabled: true, ...screenTodo };
  if (cards.length) {
    c.screens[0].layout.preset = 'canvas';
    c.screens[0].canvas.items = cards.map((props, i) => ({ id: `cv_todo000${i}`, kind: 'todo', pos: { zone: 'main', x: (i % 3) * 8, y: Math.floor(i / 3) * 8, size: 't' }, props }));
  }
  return c;
}

const TODAY = '2026-10-20';
const ITEMS = [
  { id: 't_typed', text: 'Typed here', done: false, list: 'local' },
  { id: 'ms_a', text: 'Milk', done: false, important: true, list: 'tl_shop' },
  { id: 'ms_b', text: 'Bread', done: false, due: '2026-10-20', list: 'tl_shop' },
  { id: 'ms_c', text: 'Bins', done: false, due: '2026-10-19', list: 'tl_home' },
  { id: 'ms_d', text: 'Paint', done: false, due: '2026-10-25', list: 'tl_home' },
  { id: 'old', text: 'No list key', done: false },
];

test('filter: lists, then all, starred, or due today and overdue; typed tasks only with all', () => {
  const texts = (v) => todoShown(ITEMS, v, TODAY).map((i) => i.text);
  assert.deepEqual(texts({ listIds: null, filter: 'all' }), ITEMS.map((i) => i.text));
  assert.deepEqual(texts({ listIds: ['tl_shop'], filter: 'all' }), ['Milk', 'Bread']);
  // an item without a list is a typed one
  assert.deepEqual(texts({ listIds: ['local'], filter: 'all' }), ['Typed here', 'No list key']);
  assert.deepEqual(texts({ listIds: null, filter: 'important' }), ['Milk']);
  assert.deepEqual(texts({ listIds: null, filter: 'due' }), ['Bread', 'Bins']);
  assert.deepEqual(texts({ listIds: ['local', 'tl_home'], filter: 'due' }), ['Bins']);
  assert.deepEqual(texts({ listIds: ['local'], filter: 'important' }), []);
  // a list the display does not know shows nothing
  assert.deepEqual(texts({ listIds: ['tl_gone'], filter: 'all' }), []);
  assert.deepEqual(todoShown(null, null, TODAY), []);
});

test('title: own text, else the one list\'s name, else the usual words', () => {
  const names = { tl_shop: 'Shopping' };
  assert.equal(todoTitle({ listIds: null, title: '' }, names, 'To-do'), 'To-do');
  assert.equal(todoTitle({ listIds: ['tl_shop'], title: '' }, names, 'To-do'), 'Shopping');
  assert.equal(todoTitle({ listIds: ['tl_shop'], title: '  Groceries ' }, names, 'To-do'), 'Groceries');
  assert.equal(todoTitle({ listIds: ['tl_shop', 'tl_home'], title: '' }, names, 'To-do'), 'To-do');
  assert.equal(todoTitle({ listIds: ['local'], title: '' }, names, 'To-do'), 'To-do');
  // a list with no name (or not sent) keeps the usual words
  assert.equal(todoTitle({ listIds: ['tl_home'], title: '' }, names, 'To-do'), 'To-do');
});

test('sanitizeTodoView: known ids only, none left = every list, capped text, wrong types heard', () => {
  const errs = [];
  const err = (p, m) => errs.push(p);
  const known = new Set(['local', 'tl_shop']);
  assert.deepEqual(sanitizeTodoView({}, err), { listIds: null, title: '', icon: '', filter: 'all' });
  assert.deepEqual(sanitizeTodoView({ listIds: ['tl_shop', 'tl_gone', 'tl_shop', 'local', 'x y', 5] }, err, 'p', known).listIds, ['tl_shop', 'local']);
  assert.equal(sanitizeTodoView({ listIds: ['tl_gone'] }, err, 'p', known).listIds, null);
  assert.equal(sanitizeTodoView({ listIds: [] }, err, 'p', known).listIds, null);
  assert.deepEqual(errs, [], 'unknown and removed lists are dropped quietly');
  const v = sanitizeTodoView({ title: 'x'.repeat(50), icon: '🛒'.repeat(14), filter: 'soon', listIds: 'tl_shop' }, err, 'p', known);
  assert.equal(v.title.length, 40);
  assert.equal([...v.icon].length, 12, 'an emoji too long is cut quietly');
  assert.equal(sanitizeTodoView({ icon: '👨‍👩‍👧‍👦' }).icon, '👨‍👩‍👧‍👦');
  assert.equal(v.filter, 'all');
  assert.equal(v.listIds, null);
  assert.deepEqual(errs.sort(), ['p.filter', 'p.listIds', 'p.title']);
  assert.equal(sanitizeTodoView({ title: ' Shop\u0007 ' }).title, 'Shop');
});

test('validation: a to-do card and a classic screen keep their settings; removed lists are dropped', () => {
  const c = config([
    { listIds: ['tl_shop'], icon: '🛒' },
    { listIds: ['local', 'tl_home', 'tl_removed'], title: 'Home', filter: 'due', maxRows: 8 },
    { listIds: ['tl_removed'], filter: 'important' },
  ]);
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const [a, b, x] = r.value.screens[0].canvas.items.map((it) => it.props);
  assert.deepEqual(a, { maxRows: 6, showDone: true, listIds: ['tl_shop'], title: '', icon: '🛒', filter: 'all' });
  assert.deepEqual(b, { maxRows: 8, showDone: true, listIds: ['local', 'tl_home'], title: 'Home', filter: 'due', icon: '' });
  assert.equal(x.listIds, null, 'its one list was removed: every list again');
  assert.equal(x.filter, 'important');
  // the classic screen's to-do part
  const s = validateConfig(config([], { listIds: ['tl_home', 'nope'], title: 'Chores!', icon: '🧹', filter: 'important' }));
  assert.equal(s.ok, true, JSON.stringify(s.errors));
  assert.deepEqual(s.value.screens[0].todo, { enabled: true, listIds: ['tl_home'], title: 'Chores!', icon: '🧹', filter: 'important' });
  const bad = validateConfig(config([], { filter: 'later' }));
  assert.ok(bad.errors.some((e) => e.path === 'screens[0].todo.filter'));
  // removing a list from todo.lists takes it off the screens on the next save
  const c2 = r.value;
  c2.todo.lists = [HOME];
  assert.equal(validateConfig(c2).value.screens[0].canvas.items[0].props.listIds, null);
});

test('several to-do cards on one screen, at most four', () => {
  assert.equal(CANVAS_KINDS.todo.perScreen, 4);
  const four = validateConfig(config([{}, {}, {}, {}]));
  assert.equal(four.ok, true, JSON.stringify(four.errors));
  assert.equal(four.value.screens[0].canvas.items.length, 4);
  const five = validateConfig(config([{}, {}, {}, {}, {}]));
  assert.ok(five.errors.some((e) => /too many todo/.test(e.message)), JSON.stringify(five.errors));
});

test('display config: list keys on items, the screen\'s settings, only the names its headings need, no account', () => {
  const v = validateConfig(config([{ listIds: ['tl_shop'] }, { listIds: ['local', 'tl_home'] }, {}])).value;
  const tasks = [displayTodoItem({ text: 'Milk', important: true }, 'ms_a', true, 'tl_shop'), displayTodoItem({ text: 'Bins', due: '2026-10-19' }, 'ms_c', false, 'tl_home')];
  const d = displayConfig(v, v.screens[0], { todoTasks: tasks });
  assert.deepEqual(d.todo.items.map((i) => [i.text, i.list]), [['Typed here', 'local'], ['Milk', 'tl_shop'], ['Bins', 'tl_home']]);
  assert.deepEqual(d.todo.listNames, { tl_shop: 'Shopping' }, 'Chores is not the one list of any card');
  assert.deepEqual([d.todo.listIds, d.todo.title, d.todo.icon, d.todo.filter], [null, '', '', 'all']);
  assert.deepEqual(d.canvas.items.map((it) => it.props.listIds), [['tl_shop'], ['local', 'tl_home'], null]);
  const text = JSON.stringify(d);
  for (const secret of ['ana@outlook.example', 'leo@outlook.example', 'graph-list-shop', 'graph-list-home', 'microsoftAccount']) assert.ok(!text.includes(secret), secret);
  // a list that is off gives no name
  const off = structuredClone(v);
  off.todo.lists[0].enabled = false;
  assert.deepEqual(displayConfig(off, off.screens[0]).todo.listNames, {});
  // a classic screen with one list sends its name
  const cl = validateConfig(config([], { listIds: ['tl_home'] })).value;
  assert.deepEqual(displayConfig(cl, cl.screens[0]).todo.listNames, { tl_home: 'Chores' });
  assert.deepEqual(todoListNames(cl, todoViews(cl.screens[0])), { tl_home: 'Chores' });
});

test('privacy mode: the to-do settings and items stay as they are, only ticking stops', () => {
  const v = validateConfig(config([{ listIds: ['tl_shop'], filter: 'important' }])).value;
  v.screens[0].family.touch = true;
  const tasks = [displayTodoItem({ text: 'Milk', important: true }, 'ms_a', true, 'tl_shop')];
  const open = displayConfig(v, v.screens[0], { todoTasks: tasks });
  const priv = displayConfig(v, v.screens[0], { todoTasks: tasks, privacy: { status: { active: true, until: null, reason: 'manual' } } });
  assert.equal(priv.privacy.active, true);
  assert.equal(open.todo.touch, true);
  assert.equal(priv.todo.touch, false);
  assert.deepEqual(priv.todo.items, open.todo.items);
  assert.deepEqual(priv.todo.listNames, open.todo.listNames);
  assert.deepEqual(priv.canvas.items[0].props, open.canvas.items[0].props);
});

test('display: a to-do card renders with its own lists, title, icon and filter over the screen\'s', async () => {
  const [cfgMod] = await loadWebModules('/web/display/widgets/canvas/config.ts');
  const screen = { todo: { enabled: false, items: ITEMS, listIds: ['local'], title: 'Screen', icon: '🏠', filter: 'all', listNames: { tl_shop: 'Shopping' } } };
  const card = cfgMod.itemCfg(screen, { id: 'cv_todo0000', kind: 'todo', v: '1', props: { listIds: ['tl_shop'], title: '', icon: '🛒', filter: 'due' } });
  assert.deepEqual([card.todo.enabled, card.todo.listIds, card.todo.title, card.todo.icon, card.todo.filter], [true, ['tl_shop'], '', '🛒', 'due']);
  assert.equal(card.todo.items, ITEMS);
  assert.deepEqual(todoShown(card.todo.items, card.todo, TODAY).map((i) => i.text), ['Bread']);
  assert.equal(todoTitle(card.todo, card.todo.listNames, 'To-do'), 'Shopping');
  // a card saved before these settings shows every list, as before
  const old = cfgMod.itemCfg(screen, { id: 'cv_todo0001', kind: 'todo', v: '1', props: { maxRows: 6, showDone: true } });
  assert.deepEqual([old.todo.listIds, old.todo.title, old.todo.icon, old.todo.filter], [null, '', '', 'all']);
});
