// While the first screen is still on its way (assets, config or the first photo over a slow network), the clock and
// the date drawn from this device's time instead of a black page. It shows only when the screen is not there after
// SHOW_AFTER_MS (a display on the LAN never sees it) and fades out as the screen fades in (#app loses `booting`).
// Settings come from the config the page has (bootstrap) or the one kept from the last visit: language, time zone,
// 12/24 h, date format and theme only, never anything of the family's.
import type { DisplayConfig, Lang } from '../shared/types';
import { dateKeyInTz, formatDateLine, LANGS, pad2, zonedParts } from '../shared/i18n';
import { now } from './time';

const SHOW_AFTER_MS = 350;

let el: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;

function validTz(tz: unknown): string | undefined {
  if (typeof tz !== 'string' || !tz) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

/** The settings the shell reads from a (possibly partial or old) config. */
export function shellSettings(cfg: Partial<DisplayConfig> | null | undefined, navLang = typeof navigator !== 'undefined' ? navigator.language : 'en') {
  const dt = (cfg?.datetime ?? {}) as Partial<DisplayConfig['datetime']>;
  const sc = (cfg?.screen ?? {}) as Partial<DisplayConfig['screen']>;
  const wanted = (sc.language || String(navLang || '').slice(0, 2).toLowerCase()) as Lang;
  return {
    lang: (LANGS.includes(wanted) ? wanted : 'en') as Lang,
    tz: validTz(dt.timezone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    format24: dt.format24 !== false,
    showAmPm: dt.showAmPm !== false,
    dateFormat: dt.dateFormat,
    dateCustom: dt.dateCustom ?? '',
    light: sc.theme === 'light',
  };
}

/** The time and date lines for `at` (exported for the tests). */
export function shellText(s: ReturnType<typeof shellSettings>, at: Date): { time: string; date: string } {
  const p = zonedParts(at, s.tz);
  let h = p.hour;
  let suffix = '';
  if (!s.format24) {
    suffix = s.showAmPm ? (h < 12 ? ' AM' : ' PM') : '';
    h = h % 12 === 0 ? 12 : h % 12;
  }
  const time = `${s.format24 ? pad2(h) : String(h)}:${pad2(p.minute)}${suffix}`;
  return { time, date: formatDateLine(s.lang, dateKeyInTz(at, s.tz), s.dateFormat, s.dateCustom) };
}

/** Start the shell for this page load (once): it shows after a moment unless the screen is already there. */
export function armBootShell(cfg: Partial<DisplayConfig> | null | undefined, doc: Document = document): void {
  const app = doc.getElementById('app');
  if (el || !app || !app.classList.contains('booting')) return;
  const s = shellSettings(cfg);
  el = doc.createElement('div');
  el.id = 'boot-shell';
  el.setAttribute('aria-hidden', 'true');
  el.classList.toggle('light', s.light);
  el.innerHTML = '<div class="bs-time"></div><div class="bs-date"></div>';
  const [timeEl, dateEl] = [el.firstElementChild as HTMLElement, el.lastElementChild as HTMLElement];
  const draw = () => {
    const t = shellText(s, now());
    timeEl.textContent = t.time;
    dateEl.textContent = t.date;
    timer = setTimeout(draw, 1000 - (Date.now() % 1000) + 5);
  };
  draw();
  doc.body.appendChild(el);
  showTimer = setTimeout(() => el?.classList.add('show'), SHOW_AFTER_MS);
  observer = new MutationObserver(() => {
    if (!app.classList.contains('booting')) hideBootShell();
  });
  observer.observe(app, { attributes: true, attributeFilter: ['class'] });
}

/** Fade the shell out and remove it (the screen is there, or the page shows pairing, welcome or an error instead). */
export function hideBootShell(): void {
  if (!el) return;
  const node = el;
  el = null;
  if (timer) clearTimeout(timer);
  if (showTimer) clearTimeout(showTimer);
  observer?.disconnect();
  observer = null;
  if (!node.classList.contains('show')) return void node.remove();
  node.classList.remove('show');
  setTimeout(() => node.remove(), 900);
}
