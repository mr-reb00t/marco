// How many days the agenda view shows (calendar.agendaDays). Pure helpers; agenda.ts measures the day blocks.
// - 7, 14 or 30: that many days from today (empty days after Tomorrow are skipped, as always).
// - 'auto': Today and Tomorrow, then the next days that have events, as long as each whole day block fits in the
//   agenda. It never shows less than the 14 days the agenda always showed, so nothing that showed before disappears;
//   it only fills room that was empty. How far it can look is limited by the events the display has fetched.
import type { AgendaDays } from '../shared/types';
import { AGENDA_AUTO_MAX_DAYS } from '../../server/core/bootstrap.js';

/** Days the agenda showed before the setting existed: 'auto' never shows fewer. */
export const AGENDA_BASE_DAYS = 14;
/** Furthest day 'auto' looks at (the display fetches events this far ahead when the agenda view is on). */
export { AGENDA_AUTO_MAX_DAYS };

/** Number of days from today the agenda considers. */
export function agendaHorizon(setting: AgendaDays | number): number {
  return setting === 'auto' ? AGENDA_AUTO_MAX_DAYS : setting;
}

/** Days ahead (from today) the display should have events for, so the agenda can show what its setting asks. */
export function agendaFetchDays(setting: AgendaDays): number {
  return agendaHorizon(setting) + 1;
}

/**
 * 'auto': how many of the day blocks (in date order) to keep.
 * `offsets[i]` is the day of block i counted from today (0 = Today), `fits[i]` whether block i was fully inside
 * the agenda when every candidate day was laid out. The blocks kept are the leading ones that fit, stopping at the
 * first one that would overflow (a day block is never cut in half), but never fewer than the blocks of the first
 * `base` days: when those already overflow, the agenda looks exactly as it did before.
 */
export function agendaKeep(offsets: readonly number[], fits: readonly boolean[], base = AGENDA_BASE_DAYS): number {
  const n = Math.min(offsets.length, fits.length);
  let lead = 0;
  while (lead < n && fits[lead]) lead++;
  let baseline = 0;
  while (baseline < n && offsets[baseline] < base) baseline++;
  return Math.max(lead, baseline);
}
