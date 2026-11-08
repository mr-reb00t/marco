// Birthdays from a contacts file (#43): Google Contacts, iCloud and Outlook export vCards (.vcf, versions 2.1, 3.0 and
// 4.0). The file is read in the browser and never sent anywhere; only the birthdays the owner picks go into the config.
// Pure functions, unit-tested in server/test/vcard-import.test.js.
import type { Birthday } from '../shared/types';
import { daysInMonth, normalize } from './util';

export const VCARD_MAX_BYTES = 5 * 1024 * 1024;
export const VCARD_MAX_CONTACTS = 5000;
/** Same cap as the validator (server/core/validate.js sanitizeBirthday). */
export const BIRTHDAY_NAME_MAX = 80;

export interface VcardDate {
  month: number;
  day: number;
  year: number | null;
  /** the file had a year that cannot be a birth year (0000, 1604, a future one) */
  yearDropped?: boolean;
}
export interface VcardContact {
  name: string;
  bday: VcardDate | null;
  problem?: 'noName' | 'noBday' | 'badBday';
}
export interface VcardParse {
  contacts: VcardContact[];
  /** cards read (one contact each) */
  cards: number;
  /** the file had more than `max` cards: the rest were not read */
  capped: boolean;
}

/** Bytes as a string of one character per byte, so each value can be decoded with its own CHARSET. */
function binaryString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return out;
}

function decodeBytes(bin: string, charset: string): string {
  if (!/[^\x00-\x7f]/.test(bin)) return bin;
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0) & 0xff);
  for (const label of [charset, 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes);
    } catch {
      /* unknown label or not that encoding: try the next one */
    }
  }
  return new TextDecoder('windows-1252').decode(bytes);
}

const unQp = (s: string) => s.replace(/=([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** Splits on `sep` when it is not escaped with a backslash. */
function splitUnescaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      cur += c + s[i + 1];
      i++;
    } else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const unescape = (s: string) => s.replace(/\\([\\,;:nN])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c));
// Control characters become spaces; marks that only steer direction or are invisible (zero width space, LRM, RLM,
// bidi embeddings and isolates, BOM) are dropped. ZWNJ and ZWJ stay: emoji sequences and some scripts need them.
const cleanName = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** "item1.BDAY;VALUE=date:1990-03-14" → { name: 'BDAY', params: { VALUE: 'date' }, value: '1990-03-14' }, or null. */
function parseProp(line: string): Prop | null {
  let i = 0;
  while (i < line.length && line[i] !== ';' && line[i] !== ':') i++;
  if (i >= line.length) return null;
  const name = line.slice(0, i).split('.').pop()!.trim().toUpperCase();
  const params: Record<string, string> = {};
  while (line[i] === ';') {
    i++;
    let raw = '';
    let quoted = false;
    while (i < line.length && (quoted || (line[i] !== ';' && line[i] !== ':'))) {
      if (line[i] === '"') quoted = !quoted;
      else raw += line[i];
      i++;
    }
    const eq = raw.indexOf('=');
    if (eq > 0) params[raw.slice(0, eq).trim().toUpperCase()] = raw.slice(eq + 1).trim();
    else if (raw.trim()) {
      // vCard 2.1 bare parameters: ";QUOTED-PRINTABLE", ";UTF-8", ";HOME"
      const v = raw.trim();
      if (/^(quoted-printable|base64|b|8bit|7bit)$/i.test(v)) params.ENCODING = v;
      else if (/^(utf-8|us-ascii|windows-\d+|iso-8859-\d+|cp\d+)$/i.test(v)) params.CHARSET = v;
      else params.TYPE = params.TYPE ? `${params.TYPE},${v}` : v;
    }
  }
  if (line[i] !== ':') return null;
  return { name, params, value: line.slice(i + 1) };
}

const WANTED = new Set(['BEGIN', 'END', 'FN', 'N', 'BDAY', 'AGENT']);
const isQpHead = (line: string) => {
  const colon = line.indexOf(':');
  return /quoted-printable/i.test(colon < 0 ? line : line.slice(0, colon));
};

/**
 * BDAY value → date. YYYY-MM-DD, YYYYMMDD, --MM-DD and --MMDD, with or without a time part. A year that cannot be a
 * birth year (before 1900, after this year, or Apple's X-APPLE-OMIT-YEAR placeholder) is left out.
 */
export function parseBday(value: string, params: Record<string, string> = {}, thisYear = new Date().getFullYear()): VcardDate | null {
  if (/^text$/i.test(params.VALUE ?? '')) return null;
  const v = value.trim().replace(/[T ].*$/i, '');
  let year: number | null = null;
  let month: number;
  let day: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else if ((m = /^--(\d{2})-?(\d{2})$/.exec(v))) {
    month = Number(m[1]);
    day = Number(m[2]);
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month)) return null;
  const omit = params['X-APPLE-OMIT-YEAR'];
  if (year != null && omit && Number(omit) === year) return { month, day, year: null };
  if (year != null && (year < 1900 || year > 2100 || year > thisYear)) return { month, day, year: null, yearDropped: true };
  return { month, day, year };
}

/** Contacts of a .vcf file. `data`: the file's bytes (each value decoded with its CHARSET) or already decoded text. */
export function parseVcards(data: Uint8Array | string, max = VCARD_MAX_CONTACTS, thisYear = new Date().getFullYear()): VcardParse {
  let text: string;
  let binary = false;
  if (typeof data === 'string') text = data;
  else if (data[0] === 0xff && data[1] === 0xfe) text = new TextDecoder('utf-16le').decode(data.subarray(2));
  else if (data[0] === 0xfe && data[1] === 0xff) text = new TextDecoder('utf-16be').decode(data.subarray(2));
  else {
    text = binaryString(data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.subarray(3) : data);
    binary = true;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const out: VcardParse = { contacts: [], cards: 0, capped: false };
  let card: { fn: string; n: string; bday: string | null; bdayParams: Record<string, string> } | null = null;
  let depth = 0;
  let afterAgent = false;

  const textValue = (p: Prop) => {
    const charset = (p.params.CHARSET ?? '').toLowerCase();
    if (/^(quoted-printable|q)$/i.test(p.params.ENCODING ?? '')) return decodeBytes(unQp(p.value), charset);
    return binary ? decodeBytes(p.value, charset) : p.value;
  };
  const finish = () => {
    if (!card) return;
    const name = cleanName(unescape(card.fn)) || cleanName(card.n);
    const bday = card.bday == null ? null : parseBday(card.bday, card.bdayParams, thisYear);
    const contact: VcardContact = { name, bday };
    if (card.bday == null) contact.problem = 'noBday';
    else if (!bday) contact.problem = 'badBday';
    else if (!name) contact.problem = 'noName';
    out.contacts.push(contact);
    card = null;
  };
  const handle = (line: string) => {
    const p = parseProp(line);
    if (!p) return;
    const agent = afterAgent;
    afterAgent = p.name === 'AGENT' && !p.value.trim();
    if (p.name === 'BEGIN' && /^vcard$/i.test(p.value.trim())) {
      // a vCard nested in another (2.1 AGENT, right after an empty AGENT line): only the outer one counts
      if (depth > 1 || (depth === 1 && agent)) {
        depth++;
        return;
      }
      finish(); // the card before had no END:VCARD
      depth = 1;
      if (out.cards >= max) {
        out.capped = true;
        return 'stop';
      }
      out.cards++;
      card = { fn: '', n: '', bday: null, bdayParams: {} };
      return;
    }
    if (p.name === 'END' && /^vcard$/i.test(p.value.trim())) {
      if (depth > 0 && --depth === 0) finish();
      return;
    }
    if (!card || depth !== 1) return;
    if (p.name === 'FN' && !card.fn.trim()) card.fn = textValue(p);
    else if (p.name === 'N' && !card.n) {
      const [family = '', given = '', additional = ''] = splitUnescaped(textValue(p), ';').map(unescape);
      card.n = [given, additional, family].map((s) => s.trim()).filter(Boolean).join(' ');
    } else if (p.name === 'BDAY' && card.bday == null) {
      card.bday = textValue(p);
      card.bdayParams = p.params;
    }
  };

  // Logical lines: folded lines (next line starts with a space or a tab) and quoted-printable soft breaks (a line
  // ending in "=") are joined. Lines of properties that are not read (PHOTO and so on) are not kept.
  let parts: string[] | null = null;
  let qp = false;
  let softBreak = false;
  let pending = false;
  const flush = () => {
    if (pending && parts && handle(parts.join('')) === 'stop') return true;
    pending = false;
    parts = null;
    return false;
  };
  for (const line of text.split(/\r\n|\n|\r/)) {
    // a soft break before a card's END or a new property is a stray "=": the value ends there
    if (pending && softBreak && !/^(BEGIN|END):VCARD\s*$/i.test(line) && !/^[A-Za-z][\w-]*(\.[\w-]+)?[;:]/.test(line)) {
      if (parts) parts.push(line);
      softBreak = line.endsWith('=');
      if (parts && softBreak) parts[parts.length - 1] = line.slice(0, -1);
      continue;
    }
    if (pending && (line[0] === ' ' || line[0] === '\t')) {
      if (parts) parts.push(line.slice(1));
      continue;
    }
    if (flush()) return out;
    if (!line.trim()) continue;
    const head = /^[^;:]*/.exec(line)![0].split('.').pop()!.trim().toUpperCase();
    pending = true;
    qp = isQpHead(line);
    parts = WANTED.has(head) ? [line] : null;
    if (!parts) afterAgent = false;
    softBreak = qp && line.endsWith('=');
    if (parts && softBreak) parts[0] = line.slice(0, -1);
  }
  if (flush()) return out;
  if (card) finish(); // a last card without END:VCARD
  return out;
}

export interface ImportRow {
  key: string;
  name: string;
  month: number;
  day: number;
  year: number | null;
  /** 'existing': the same name and day is already in the list */
  status: 'new' | 'existing';
  /** the name was cut to BIRTHDAY_NAME_MAX characters */
  truncated: boolean;
  yearDropped: boolean;
}
export interface ImportPlan {
  rows: ImportRow[];
  /** contacts with a name and a birthday that can be read */
  found: number;
  fresh: number;
  existing: number;
  /** the same person and day more than once in the file */
  inFile: number;
  skipped: { noBday: number; badBday: number; noName: number };
  truncated: number;
  capped: boolean;
}

/** Same key as the add form and the CSV import: name without case or accents, day and month (the year is ignored). */
const keyOf = (name: string, month: number, day: number) => `${normalize(name)}|${month}|${day}`;

function cut(name: string, max: number): string {
  if (name.length <= max) return name;
  let s = name.slice(0, max);
  if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);
  return s.trim();
}

/** What adding the contacts of a parsed file would do: new rows, rows already in `existing` and why others are left out. */
export function planBirthdayImport(parse: VcardParse, existing: Birthday[], maxName = BIRTHDAY_NAME_MAX): ImportPlan {
  const have = new Set(existing.map((b) => keyOf(b.name, b.month, b.day)));
  const byKey = new Map<string, ImportRow>();
  const plan: ImportPlan = { rows: [], found: 0, fresh: 0, existing: 0, inFile: 0, skipped: { noBday: 0, badBday: 0, noName: 0 }, truncated: 0, capped: parse.capped };
  for (const c of parse.contacts) {
    if (c.problem || !c.bday) {
      plan.skipped[c.problem ?? 'noBday']++;
      continue;
    }
    plan.found++;
    const name = cut(c.name, maxName);
    const { month, day, year } = c.bday;
    const key = keyOf(name, month, day);
    const same = byKey.get(key);
    if (same) {
      plan.inFile++;
      if (same.year == null && year != null) Object.assign(same, { year, yearDropped: false });
      continue;
    }
    byKey.set(key, { key, name, month, day, year, status: have.has(key) ? 'existing' : 'new', truncated: name !== c.name, yearDropped: !!c.bday.yearDropped });
  }
  plan.rows = [...byKey.values()].sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name));
  for (const r of plan.rows) {
    if (r.status === 'new') plan.fresh++;
    else plan.existing++;
    if (r.truncated) plan.truncated++;
  }
  return plan;
}
