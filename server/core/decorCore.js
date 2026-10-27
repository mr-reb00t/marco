// The owner's HTML over the whole screen and the built-in seasonal decorations (#24), per screen:
//
// - screen.overlay = { html, when }: HTML (and its <style>) the display draws over everything in a frame that cannot
//   run scripts, keep data, send forms or go anywhere (web/display/widgets/decor.ts). `when` is { type: 'always' } or
//   a yearly range { type: 'range', from: 'MM-DD', to: 'MM-DD' } (12-01 to 01-06 runs over New Year), checked in the
//   screen's time zone on the display.
// - screen.decoration = { mode, snow }: lights along the top edge (Christmas, Halloween) or a little confetti
//   (New Year), drawn by Marco itself. 'auto' picks by the date (SEASONS); 'none' (the default) draws nothing.
//
// Pure, no dependencies: the validator, the display and Marco Cloud use it.

export const OVERLAY_MAX = 20000;
export const OVERLAY_WHEN = Object.freeze(['always', 'range']);
export const DECOR_MODES = Object.freeze(['none', 'auto', 'christmas', 'halloween', 'newyear']);
/** The days each decoration shows on with 'auto' (yearly, both ends included). New Year wins on its own days. */
export const SEASONS = Object.freeze({
  newyear: Object.freeze(['12-31', '01-01']),
  christmas: Object.freeze(['12-01', '01-06']),
  halloween: Object.freeze(['10-24', '10-31']),
});

const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const defaultOverlay = () => ({ html: '', when: { type: 'always' } });
export const defaultDecoration = () => ({ mode: 'none', snow: true });

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
 * screen.overlay, cleaned. `err(path, message)` records what blocks the save (a string too long, a bad date, a
 * `when` that is not one of the known kinds); anything missing or unknown falls back to the defaults.
 */
export function sanitizeOverlay(raw, err = () => {}, path = 'screen.overlay') {
  const out = defaultOverlay();
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) {
    err(path, 'expected object');
    return out;
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

/** The season the dates of `today` belong to ('newyear' before 'christmas'), or null. */
export function seasonOn(today) {
  for (const [k, [from, to]] of Object.entries(SEASONS)) if (inYearlyRange(today, from, to)) return k;
  return null;
}

/** The decoration drawn on `today` for screen.decoration `d`: 'christmas', 'halloween', 'newyear' or null. */
export function decorationOn(d, today) {
  const mode = isObj(d) && DECOR_MODES.includes(d.mode) ? d.mode : 'none';
  if (mode === 'none') return null;
  if (mode === 'auto') return seasonOn(today);
  return mode;
}
