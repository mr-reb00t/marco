// The owner's HTML over the whole screen and the built-in seasonal decorations (#24), per screen:
//
// - screen.overlays = [{ name, html, when }] (up to OVERLAYS_MAX): HTML (and its <style>) the display draws over
//   everything, each in a frame of its own that cannot run scripts, keep data, send forms or go anywhere
//   (web/display/widgets/decor.ts). `when` is { type: 'always' } or a yearly range { type: 'range', from: 'MM-DD',
//   to: 'MM-DD' } (12-01 to 01-06 runs over New Year), checked in the screen's time zone on the display. Those whose
//   dates hold show together. Until 0.22 a screen had one, screen.overlay = { html, when } (migrateOverlay).
// - screen.decoration = { mode, snow, seasons }: lights along the top edge (Christmas, Halloween) or a little confetti
//   (New Year), drawn by Marco itself. 'auto' picks by the date, from `seasons` (the owner's days for each, SEASONS
//   by default); 'none' (the default) draws nothing.
//
// Pure, no dependencies: the validator, the display and Marco Cloud use it.

export const OVERLAY_MAX = 20000;
export const OVERLAYS_MAX = 4;
export const OVERLAY_NAME_MAX = 60;
export const OVERLAY_WHEN = Object.freeze(['always', 'range']);
export const DECOR_MODES = Object.freeze(['none', 'auto', 'christmas', 'halloween', 'newyear']);
/** The days each decoration shows on with 'auto' by default (yearly, both ends included), in the order they win
 *  when two overlap: New Year on its own days, then Christmas, then Halloween. */
export const SEASONS = Object.freeze({
  newyear: Object.freeze(['12-31', '01-01']),
  christmas: Object.freeze(['12-01', '01-06']),
  halloween: Object.freeze(['10-24', '10-31']),
});

const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const defaultOverlay = () => ({ name: '', html: '', when: { type: 'always' } });
export const defaultSeasons = () => Object.fromEntries(Object.entries(SEASONS).map(([k, [from, to]]) => [k, { from, to }]));
export const defaultDecoration = () => ({ mode: 'none', snow: true, seasons: defaultSeasons() });

/** "MM-DD" of a real day in some year (29 February included), as in core/bgRules.js. */
export function isMonthDay(s) {
  const m = typeof s === 'string' && MONTH_DAY.exec(s);
  if (!m) return false;
  const mo = +m[1], d = +m[2];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= DAYS_IN_MONTH[mo - 1];
}

/** `today` (YYYY-MM-DD) falls in the yearly range from..to (MM-DD), which may run over New Year. */
export function inYearlyRange(today, from, to) {
  const md = String(today).slice(5);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/**
 * One of screen.overlays, cleaned. `err(path, message)` records what blocks the save (a string too long, a bad date, a
 * `when` that is not one of the known kinds); anything missing or unknown falls back to the defaults.
 */
export function sanitizeOverlay(raw, err = () => {}, path = 'screen.overlay') {
  const out = defaultOverlay();
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) {
    err(path, 'expected object');
    return out;
  }
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') err(`${path}.name`, 'expected string');
    // eslint-disable-next-line no-control-regex
    else out.name = raw.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, OVERLAY_NAME_MAX);
  }
  if (raw.html !== undefined) {
    if (typeof raw.html !== 'string') err(`${path}.html`, 'expected string');
    else {
      // eslint-disable-next-line no-control-regex
      const html = raw.html.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
      if (html.length > OVERLAY_MAX) err(`${path}.html`, `too long (max ${OVERLAY_MAX})`);
      out.html = html.slice(0, OVERLAY_MAX);
    }
  }
  const w = raw.when;
  if (w === undefined || w === null) return out;
  if (!isObj(w) || !OVERLAY_WHEN.includes(w.type)) {
    err(`${path}.when`, `one of: ${OVERLAY_WHEN.join(', ')}`);
    return out;
  }
  if (w.type === 'range') {
    if (!isMonthDay(w.from)) err(`${path}.when.from`, 'invalid date (MM-DD)');
    if (!isMonthDay(w.to)) err(`${path}.when.to`, 'invalid date (MM-DD)');
    const from = isMonthDay(w.from) ? w.from : '12-01';
    out.when = { type: 'range', from, to: isMonthDay(w.to) ? w.to : from };
  }
  return out;
}

/**
 * screen.overlays, cleaned: a list of at most OVERLAYS_MAX. `legacy` is the screen.overlay of a screen saved before
 * 0.22, used when there is no list yet.
 */
export function sanitizeOverlays(raw, err = () => {}, path = 'screen.overlays', legacy) {
  if (raw === undefined || raw === null) return migrateOverlay(legacy);
  if (!Array.isArray(raw)) {
    err(path, 'expected array');
    return [];
  }
  if (raw.length > OVERLAYS_MAX) err(path, `too many (max ${OVERLAYS_MAX})`);
  return raw.slice(0, OVERLAYS_MAX).map((o, i) => sanitizeOverlay(o, err, `${path}[${i}]`));
}

/** The list a pre-0.22 screen.overlay becomes: itself when it has some HTML, else nothing. */
export function migrateOverlay(legacy) {
  if (!isObj(legacy) || typeof legacy.html !== 'string' || !legacy.html.trim()) return [];
  return [sanitizeOverlay(legacy)];
}

/** The UTF-8 size of all the HTML of a screen's overlays (what an edition's byte cap counts). */
export function overlaysBytes(list) {
  let n = 0;
  if (Array.isArray(list)) for (const o of list) if (isObj(o) && typeof o.html === 'string') n += new TextEncoder().encode(o.html).length;
  return n;
}

/** screen.decoration, cleaned (an unknown mode is reported and turns it off). */
export function sanitizeDecoration(raw, err = () => {}, path = 'screen.decoration') {
  const out = defaultDecoration();
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) {
    err(path, 'expected object');
    return out;
  }
  if (raw.mode !== undefined) {
    if (DECOR_MODES.includes(raw.mode)) out.mode = raw.mode;
    else err(`${path}.mode`, `one of: ${DECOR_MODES.join(', ')}`);
  }
  if (raw.snow !== undefined) {
    if (typeof raw.snow === 'boolean') out.snow = raw.snow;
    else err(`${path}.snow`, 'expected boolean');
  }
  if (raw.seasons !== undefined && raw.seasons !== null) {
    if (!isObj(raw.seasons)) err(`${path}.seasons`, 'expected object');
    else {
      for (const k of Object.keys(SEASONS)) {
        const r = raw.seasons[k];
        if (r === undefined || r === null) continue;
        const sp = `${path}.seasons.${k}`;
        if (!isObj(r)) {
          err(sp, 'expected object');
          continue;
        }
        if (!isMonthDay(r.from)) err(`${sp}.from`, 'invalid date (MM-DD)');
        if (!isMonthDay(r.to)) err(`${sp}.to`, 'invalid date (MM-DD)');
        if (isMonthDay(r.from) && isMonthDay(r.to)) out.seasons[k] = { from: r.from, to: r.to };
      }
    }
  }
  return out;
}

/** The overlay is drawn on `today` (YYYY-MM-DD in the screen's time zone): it has some HTML and its `when` holds. */
export function overlayShown(overlay, today) {
  if (!isObj(overlay) || typeof overlay.html !== 'string' || !overlay.html.trim()) return false;
  const w = overlay.when;
  if (!isObj(w) || w.type !== 'range') return true;
  if (!isMonthDay(w.from) || !isMonthDay(w.to)) return false;
  return inYearlyRange(today, w.from, w.to);
}

/** The season the dates of `today` belong to ('newyear', then 'christmas', then 'halloween'), or null. `seasons` is
 *  decoration.seasons (the owner's days); a season missing or broken there keeps its SEASONS days. */
export function seasonOn(today, seasons) {
  for (const [k, [from, to]] of Object.entries(SEASONS)) {
    const r = isObj(seasons) && isObj(seasons[k]) && isMonthDay(seasons[k].from) && isMonthDay(seasons[k].to) ? seasons[k] : { from, to };
    if (inYearlyRange(today, r.from, r.to)) return k;
  }
  return null;
}

/** The decoration drawn on `today` for screen.decoration `d`: 'christmas', 'halloween', 'newyear' or null. */
export function decorationOn(d, today) {
  const mode = isObj(d) && DECOR_MODES.includes(d.mode) ? d.mode : 'none';
  if (mode === 'none') return null;
  if (mode === 'auto') return seasonOn(today, d.seasons);
  return mode;
}
