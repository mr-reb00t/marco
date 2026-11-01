// Today on the 1st of a month: the month name in the today mark stays readable and fits (it was drawn in the
// accent colour on the accent circle, and "Nov" did not fit in it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWeb, launchChrome } from './browser.js';

test('today on the 1st shows the month name readable inside the today mark', { timeout: 120000 }, async () => {
  const web = await startWeb();
  const chrome = await launchChrome();
  try {
    for (const style of ['modern', 'classic']) {
      for (const theme of ['dark', 'light']) {
        const page = await chrome.page(`${web.url}/?demo=1&view=month&shot=1&now=2026-11-01T15:00&style=${style}&theme=${theme}`);
        const got = await page.eval(`(async () => {
          for (let i = 0; i < 100 && !document.querySelector('.num.today .dot > span'); i++) await new Promise((r) => setTimeout(r, 100));
          const dot = document.querySelector('.num.today .dot');
          const txt = dot.querySelector(':scope > span');
          const a = dot.getBoundingClientRect(), b = txt.getBoundingClientRect();
          return { label: txt.textContent, fg: getComputedStyle(txt).color, bg: getComputedStyle(dot).backgroundColor,
            fits: b.left >= a.left - 0.5 && b.right <= a.right + 0.5 };
        })()`);
        await page.close();
        assert.equal(got.label, 'Nov', `${style}/${theme}`);
        assert.notEqual(got.fg, got.bg, `${style}/${theme}: text and mark share a colour`);
        assert.ok(got.fits, `${style}/${theme}: the month name sticks out of the mark`);
      }
    }
  } finally {
    await chrome.close();
    await web.close();
  }
});
