// To-do cards with settings of their own (#15, server/core/todoCore.js) in headless Chrome: the demo's four to-do
// cards (&shot=todos, the demo To Do lists of mock.ts) each show their own lists, title, icon and tasks, fit their
// boxes and cut no text; the classic layouts use the screen's own settings. Skipped without Chrome.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

/** In the page: each to-do card's heading, its rows, whether it is cramped and the text its edge cuts. */
const CARDS = `[...document.querySelectorAll('.cv-item[data-kind="todo"]:not([hidden])')].map((e) => {
  const b = e.querySelector('.cv-body');
  const br = b.getBoundingClientRect();
  const rows = [...b.querySelectorAll('li:not([hidden])')];
  const cut = rows.filter((li) => {
    const r = li.querySelector('span').getBoundingClientRect();
    return r.bottom > br.bottom + 1 || r.right > br.right + 1;
  }).map((li) => li.textContent.trim());
  return {
    head: b.querySelector('.card-h')?.textContent.trim() ?? '',
    rows: rows.map((li) => li.querySelector('span').textContent.trim()),
    done: rows.filter((li) => li.classList.contains('done')).map((li) => li.querySelector('span').textContent.trim()),
    cramped: e.classList.contains('is-cramped'),
    cut,
  };
})`;

const chrome = findChrome();
describe('to-do cards with their own settings, in a browser', { skip: !chrome && 'no Chrome' }, () => {
  let web;
  let browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome(chrome);
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  async function open(q, expr, size = { width: 1920, height: 1080 }) {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&${q}`, size);
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1200)))');
      const value = await p.eval(expr);
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      return { value, errors };
    } finally {
      await p.close();
    }
  }

  test('four cards: one list under its name, two lists under a title of their own, due today, starred', async () => {
    const { value: cards, errors } = await open('preset=canvas&shot=todos&lang=en', CARDS);
    assert.deepEqual(errors, []);
    assert.deepEqual(cards.map((c) => c.head), ['🛒 Shopping', '🧹 Home', '📌 To-do', '✅ To-do']);
    assert.deepEqual(cards[0].rows, ['Milk', 'Bread', 'Coffee beans']);
    assert.deepEqual(cards[1].rows, ['Buy batteries for the remote', 'Fresh sheets for the beach house', 'Water the plants', 'Take out the recycling', 'Fix the bathroom shelf', 'Call the plumber']);
    assert.deepEqual(cards[1].done, ['Call the plumber']);
    // due today or before (the typed tasks have no date)
    assert.deepEqual(cards[2].rows, ['Bread', 'Water the plants']);
    // starred, the done ones hidden
    assert.deepEqual(cards[3].rows, ['Milk', 'Fix the bathroom shelf']);
    for (const c of cards) {
      assert.equal(c.cramped, false, `${c.head} does not fit`);
      assert.deepEqual(c.cut, [], `${c.head} cuts text`);
    }
  });

  test('the title of one list in the screen\'s language; a portrait screen fits them too', async () => {
    const es = await open('preset=canvas&shot=todos&lang=es', CARDS);
    assert.deepEqual(es.errors, []);
    assert.deepEqual(es.value.map((c) => c.head), ['🛒 Compra', '🧹 Home', '📌 Tareas', '✅ Tareas']);
    const tall = await open('preset=canvas&shot=todos&lang=en', CARDS, { width: 1080, height: 1920 });
    assert.deepEqual(tall.errors, []);
    for (const c of tall.value) assert.equal(c.cramped, false, `${c.head} does not fit in portrait`);
  });

  test('classic layouts: the screen\'s own lists, title, icon and filter', async () => {
    const SIDE = `(() => { const t = document.getElementById('todo'); return { shown: t.style.display !== 'none', head: t.querySelector('.card-h')?.textContent.trim(), rows: [...t.querySelectorAll('li span')].map((s) => s.textContent.trim()) }; })()`;
    const all = await open('todo=1&todolists=1&lang=en', SIDE);
    assert.deepEqual(all.errors, []);
    assert.equal(all.value.head, '✅ To-do');
    assert.equal(all.value.rows.length, 6, 'every list, at most six rows');
    const one = await open('todo=1&todolists=1&lang=en&todoids=tl_demo_home&todoicon=%F0%9F%A7%B9', SIDE);
    assert.deepEqual(one.value, { shown: true, head: '🧹 Chores', rows: ['Water the plants', 'Take out the recycling', 'Fix the bathroom shelf'] });
    const typed = await open('todo=1&todolists=1&lang=en&todoids=local&todofilter=due', SIDE);
    assert.equal(typed.value.shown, false, 'typed tasks have no due day: nothing to show');
    const BOARD = `[...document.querySelectorAll('.bd-card.bd-todo')].map((c) => ({ head: c.querySelector('.bd-h').textContent.trim(), rows: [...c.querySelectorAll('.bd-task .bd-tt')].map((s) => s.textContent.trim()) }))`;
    const board = await open('todo=1&todolists=1&lang=en&preset=board&todofilter=important&todotitle=Starred', BOARD);
    assert.deepEqual(board.errors, []);
    assert.deepEqual(board.value, [{ head: '✅Starred', rows: ['Milk', 'Fix the bathroom shelf'] }]);
  });
});
