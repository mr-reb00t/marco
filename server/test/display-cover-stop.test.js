// A Persiana with up and down only (the line of the fine grid, an Entidad line showing a cover) had no way to stop a
// moving shutter. While the cover opens, its up button is the stop (■), while it closes the down button is; a tap on
// it stops the cover, and the button goes back. Right after a tap too (the state on its way). The cards with a stop
// button of their own keep it as it was. In headless Chrome with the demo's covers (their state in the demo is what
// a tap leaves). Skipped without a browser (set CHROME_PATH).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, launchChrome, startWeb } from './browser.js';

/** In the page: tap `ctl` on the first cover of the screen whose buttons hold it, then the buttons of every cover. */
const TAP = (ctl) => `(async () => {
  const lists = () => [...document.querySelectorAll('.cv-ha-coverbtns')];
  const g = lists().find((x) => x.querySelector('button[data-ctl="${ctl}"]'));
  if (!g) return { tapped: false, after: [] };
  const i = lists().indexOf(g);
  const b = g.querySelector('button[data-ctl="${ctl}"]');
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
  await new Promise((r) => setTimeout(r, 120));
  const now = lists()[i];
  const card = now.closest('.cv-body');
  return {
    tapped: true,
    buttons: [...now.querySelectorAll('button')].map((x) => x.dataset.ctl + (x.classList.contains('is-stop') ? '*' : '')),
    label: now.querySelector('.is-stop')?.getAttribute('aria-label') ?? '',
    state: card.querySelector('.cv-ha-state')?.textContent ?? '',
  };
})()`;
const BUTTONS = `[...document.querySelectorAll('.cv-ha-coverbtns')].map((g) => [...g.querySelectorAll('button')].map((x) => x.dataset.ctl).join(','))`;

const chrome = findChrome();
describe('a cover with up and down only: the moving button stops it, in a browser', { skip: !chrome && 'no Chrome' }, () => {
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

  const open = async (shot, fn) => {
    const p = await browser.page(`${web.url}/?demo=1&lite=1&lang=en&preset=canvas&shot=${shot}`, { width: 1920, height: 1080 });
    try {
      await p.eval('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 900)))');
      await fn(p);
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      assert.deepEqual(errors, []);
    } finally {
      await p.close();
    }
  };

  for (const [what, shot] of [['Persiana, the fine grid line', 'size:ha.cover:8x2:landscape:none:ambient'], ['Entidad line of a cover', 'size:ha.tile:row']]) {
    test(`${what}: opening shows the stop on the up button, closing on the down button`, async () => {
      await open(shot, async (p) => {
        const before = await p.eval(BUTTONS);
        assert.ok(before.length > 0 && before.every((b) => b === 'open,close'), JSON.stringify(before));
        // up: opening, the up button is the stop
        const up = await p.eval(TAP('open'));
        assert.ok(up.tapped);
        assert.deepEqual(up.buttons, ['stop*', 'close']);
        assert.equal(up.label, 'Stop');
        assert.equal(up.state, 'Opening');
        // the stop: the cover stops and up is back
        const stop = await p.eval(TAP('stop'));
        assert.deepEqual(stop.buttons, ['open', 'close']);
        assert.notEqual(stop.state, 'Opening');
        // down: closing, the down button is the stop
        const down = await p.eval(TAP('close'));
        assert.deepEqual(down.buttons, ['open', 'stop*']);
        assert.equal(down.state, 'Closing');
      });
    });
  }

  test('Persiana with a stop button of its own: kept, up and down stay as they are while it moves', async () => {
    await open('size:ha.cover:s', async (p) => {
      const up = await p.eval(TAP('open'));
      assert.ok(up.tapped);
      assert.deepEqual(up.buttons, ['open', 'stop', 'close']);
    });
  });
});
