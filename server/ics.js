// ICS parsing + recurrence expansion (node-ical), producing source-agnostic "raw instances":
// { uid, title, description, location, allDay, start, end }
//   allDay → start/end are 'YYYY-MM-DD' (end exclusive); timed → start/end are Date instants.
import ical from 'node-ical';
import { addDays, dateOnlyToString } from './core/lib/tz.js';

const DAY = 86_400_000;

const val = (v) => {
  if (v == null) return '';
  if (typeof v === 'object' && 'val' in v) return String(v.val ?? '');
  return String(v);
};

/** node-ical caches time zone names for good, and a name cut out of a feed keeps that whole feed in memory (#46):
 * each new name is first checked on a tiny calendar of our own. */
const seenZones = new Set();
function warmZones(text) {
  for (const m of text.matchAll(/TZID[=:]"?([^":;\r\n]{1,80})/g)) {
    const tz = Buffer.from(m[1], 'utf8').toString('utf8');
    if (seenZones.has(tz) || seenZones.size >= 200) continue;
    seenZones.add(tz);
    try {
      ical.sync.parseICS(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:z\r\nDTSTART;TZID=${tz}:20260101T000000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
    } catch { /* ignore */ }
  }
}

export async function parseIcsText(text) {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Not an iCalendar file (missing BEGIN:VCALENDAR)');
  warmZones(text);
  const data = await ical.async.parseICS(text);
  return Object.values(data).filter((c) => c && c.type === 'VEVENT' && c.start);
}

function isAllDay(d, inst) {
  return Boolean(inst?.isFullDay || d?.dateOnly || d?.datetype === 'date');
}

/** Expand parsed VEVENTs into instances overlapping [fromDate, toDate) (Date instants; margin applied by caller). */
export const MAX_INSTANCES_PER_EVENT = 2000;
export const MAX_INSTANCES_TOTAL = 20000;

function rruleFreq(ev) {
  const o = ev.rrule?.options;
  const f = o?.freq;
  if (typeof f === 'number') return ['YEARLY', 'MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY', 'MINUTELY', 'SECONDLY'][f] || '';
  return String(f || '').toUpperCase();
}

export function expandEvents(vevents, fromDate, toDate) {
  const out = [];
  for (const ev of vevents) {
    if (out.length >= MAX_INSTANCES_TOTAL) break;
    if (String(ev.status || '').toUpperCase() === 'CANCELLED') continue;
    let instances;
    const freq = ev.rrule ? rruleFreq(ev) : '';
    try {
      if (freq === 'SECONDLY' || freq === 'MINUTELY') {
        // Pathological for a wall calendar (and a DoS vector): show only the base occurrence.
        instances = [{ start: ev.start, end: ev.end, summary: ev.summary, isFullDay: ev.datetype === 'date' || ev.start?.dateOnly, event: ev }];
      } else {
        let to = toDate;
        // HOURLY: clamp the expansion window so a single rule cannot produce thousands of instances.
        if (freq === 'HOURLY' && to - fromDate > 62 * DAY) to = new Date(fromDate.getTime() + 62 * DAY);
        instances = ical.expandRecurringEvent(ev, { from: fromDate, to, expandOngoing: true });
      }
      if (instances.length > MAX_INSTANCES_PER_EVENT) instances = instances.slice(0, MAX_INSTANCES_PER_EVENT);
    } catch (err) {
      // Malformed RRULE: fall back to the single base occurrence.
      instances = [{ start: ev.start, end: ev.end, summary: ev.summary, isFullDay: ev.datetype === 'date' || ev.start?.dateOnly, event: ev }];
      if (process.env.DEBUG) console.warn('[ics] expand failed', ev.uid, err.message);
    }
    for (const inst of instances) {
      if (out.length >= MAX_INSTANCES_TOTAL) break;
      const src = inst.event || ev;
      if (String(src.status || '').toUpperCase() === 'CANCELLED') continue;
      const allDay = isAllDay(inst.start, inst) || ev.datetype === 'date';
      let start, end;
      if (allDay) {
        start = dateOnlyToString(inst.start);
        end = inst.end ? dateOnlyToString(inst.end) : addDays(start, 1);
        if (end <= start) end = addDays(start, 1);
      } else {
        start = new Date(inst.start);
        end = inst.end ? new Date(inst.end) : new Date(start);
        if (end < start) end = new Date(start);
        if (end - start > 3 * 366 * DAY) end = new Date(start.getTime() + DAY); // garbage DTEND guard
      }
      out.push({
        uid: String(ev.uid || ''),
        title: val(inst.summary ?? src.summary),
        description: val(src.description),
        location: val(src.location),
        allDay,
        start,
        end,
      });
    }
  }
  return out;
}
