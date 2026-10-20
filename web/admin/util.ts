import { projectScreen, SLUG_RE } from '../shared/screens';
import { locale, t } from './i18n';
import type { AppConfig, CalendarSource, IconRule, SourceKind, StoredConfig } from '../shared/types';
import { findKeyword } from '../../server/lib/keywords.js';
import { MAX_SURCHARGE, MAX_VAT, MIN_SURCHARGE, priceZone } from '../../server/core/pricesCore.js';
import { gridCompany, MAX_BAND_PRICE, MIN_BAND_PRICE } from '../../server/core/tariffsCore.js';
import { caps as currentCaps, hasFeature, limitOf, type Caps, type LimitName } from './caps';

export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 7)}`;

export const clone = <T,>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

/** Immer-lite: clone then mutate. Config is small, so this is cheap enough. */
export function produce<T>(base: T, fn: (draft: T) => void): T {
  const d = clone(base);
  fn(d);
  return d;
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (to < 0 || to >= out.length || from === to) return out;
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

/** Case- and accent-insensitive normalisation (same rule the server applies). */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** First icon rule matching `text`, same rule as the server (short keywords match whole words only). */
export function matchIconRule(rules: IconRule[], text: string): { rule: IconRule; keyword: string; index: number } | null {
  return findKeyword(rules, text);
}

export const KIND_EMOJI: Record<SourceKind, string> = { generic: '', airbnb: '🏠', birthdays: '🎂', holidays: '🎉' };

export function resolveEmoji(rules: IconRule[], source: CalendarSource | undefined, text: string): string {
  const m = matchIconRule(rules, text);
  if (m?.rule.emoji) return m.rule.emoji;
  if (source?.emoji) return source.emoji;
  if (source) return KIND_EMOJI[source.kind] || '';
  return '';
}

export const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Widget refresh choices in seconds (server/defaults.js); web pages also have 0 = never reload. */
export const WIDGET_REFRESH_SEC = [1, 10, 30, 60, 300, 900, 3600, 21600, 86400];
export const WEB_WIDGET_REFRESH_SEC = [0, 30, 60, 300, 900, 3600, 21600, 86400];
export const MAX_WIDGETS = 20;
export const MAX_SCREEN_WIDGETS = 6;

/** Why a widget address is refused (Spanish key for t()), or '' (same rules as server/validate.js widgetUrlError). */
export function widgetUrlProblem(url: string, httpsOnly = false): string {
  const s = (url ?? '').trim();
  if (!s) return 'Obligatorio';
  if (s.length > 2048) return 'Demasiado larga';
  // written out as scheme://host, without spaces, quotes, angle brackets, backslashes or control characters
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(s);
  if (!m || !m[1] || /[\s"'<>\\\u0000-\u001f\u007f]/.test(s)) return 'La dirección no es válida.';
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return 'La dirección no es válida.';
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return 'La dirección no es válida.';
  if (httpsOnly && u.protocol !== 'https:') return 'Debe empezar por https://';
  if (m[1].includes('@') || u.username || u.password) return 'Sin usuario ni contraseña en la dirección';
  return '';
}

export function isHttpUrl(s: string, allowWebcal = false): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' || (allowWebcal && u.protocol === 'webcal:');
  } catch {
    return false;
  }
}

/** Public holiday iCal feeds (Google's public holiday calendars), by ISO country code. Name = Spanish i18n key. */
export const HOLIDAY_PRESETS: { cc: string; flag: string; name: string; url: string }[] = [
  { cc: 'PT', flag: '🇵🇹', name: 'Festivos de Portugal', url: 'https://calendar.google.com/calendar/ical/es.portuguese.official%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'ES', flag: '🇪🇸', name: 'Festivos de España', url: 'https://calendar.google.com/calendar/ical/es.spain%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'GB', flag: '🇬🇧', name: 'Festivos de Reino Unido', url: 'https://calendar.google.com/calendar/ical/en.uk%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'US', flag: '🇺🇸', name: 'Festivos de Estados Unidos', url: 'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'DE', flag: '🇩🇪', name: 'Festivos de Alemania', url: 'https://calendar.google.com/calendar/ical/en.german%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'FR', flag: '🇫🇷', name: 'Festivos de Francia', url: 'https://calendar.google.com/calendar/ical/en.french%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'BR', flag: '🇧🇷', name: 'Festivos de Brasil', url: 'https://calendar.google.com/calendar/ical/pt.brazilian%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'NL', flag: '🇳🇱', name: 'Festivos de Países Bajos', url: 'https://calendar.google.com/calendar/ical/en.dutch%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'BE', flag: '🇧🇪', name: 'Festivos de Bélgica', url: 'https://calendar.google.com/calendar/ical/en.be%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'DK', flag: '🇩🇰', name: 'Festivos de Dinamarca', url: 'https://calendar.google.com/calendar/ical/en.danish%23holiday%40group.v.calendar.google.com/public/basic.ics' },
];

export const SWATCHES = [
  '#ff5a4e', '#ff8a3d', '#ffc23d', '#9bd34a', '#2ec4b6', '#3ab0ff',
  '#5b7cfa', '#9b6bff', '#e05bd6', '#ff6f91', '#8d99ae', '#f2f2f2',
];

export const EMOJI_GRID = [
  '🎂', '🎁', '🎉', '🥳', '🏠', '🧳', '🛎️', '🔑', '✈️', '🚆', '🚗', '⛽',
  '🩺', '💊', '🦷', '🎒', '📚', '🎓', '🏃', '⚽', '🎾', '🏋️', '🚴', '🏊',
  '🍽️', '☕', '🍷', '🍕', '💼', '📞', '💻', '📅', '🏖️', '⛰️', '🏕️', '🌴',
  '💍', '❤️', '👶', '👨‍👩‍👧', '🐾', '🐶', '🛒', '💶', '🧾', '🏦', '🔧', '🧹',
  '🎬', '🎵', '🎮', '📺', '🎨', '📸', '⭐', '📌', '⏰', '🔔', '💬', '✅',
];

/** Mirror of server/core/defaults.js DEFAULT_ICON_RULES (used by "restore defaults"). */
export const DEFAULT_ICON_RULES: IconRule[] = [
  { id: 'r_birthday', match: ['cumple', 'birthday', 'aniversário', 'aniversario', 'faz anos'], emoji: '🎂', color: null },
  { id: 'r_checkout', match: ['check-out', 'checkout', 'check out', 'salida huésped'], emoji: '🧳', color: null },
  { id: 'r_airbnb', match: ['airbnb', 'booking', 'reserva', 'reservation', 'reserved', 'check-in', 'checkin', 'hóspede', 'huésped'], emoji: '🏠', color: null },
  { id: 'r_flight', match: ['vuelo', 'flight', 'voo', 'aeropuerto', 'airport', 'aeroporto'], emoji: '✈️', color: null },
  { id: 'r_doctor', match: ['médico', 'medico', 'doctor', 'dentista', 'dentist', 'consulta', 'hospital', 'clínica'], emoji: '🩺', color: null },
  { id: 'r_school', match: ['colegio', 'escuela', 'school', 'escola', 'guardería', 'creche'], emoji: '🎒', color: null },
  { id: 'r_sport', match: ['fútbol', 'futbol', 'futebol', 'football', 'gym', 'ginásio', 'gimnasio', 'padel', 'pádel', 'tenis', 'ténis', 'tennis', 'deporte', 'desporto', 'sport', 'running', 'yoga'], emoji: '🏃', color: null },
  { id: 'r_dinner', match: ['cena', 'cenar', 'dinner', 'jantar', 'restaurante', 'restaurant', 'almuerzo', 'almoço', 'lunch'], emoji: '🍽️', color: null },
  { id: 'r_meeting', match: ['reunión', 'reunion', 'meeting', 'call', 'reunião', 'zoom', 'teams'], emoji: '💼', color: null },
  // Public holidays before vacations: Google holiday feeds carry "Public holiday" in the description.
  { id: 'r_holiday', match: ['festivo', 'feriado', 'public holiday', 'bank holiday'], emoji: '🎉', color: null },
  { id: 'r_vacation', match: ['vacaciones', 'holiday', 'férias', 'vacation'], emoji: '🏖️', color: null },
  { id: 'r_wedding', match: ['boda', 'wedding', 'casamento'], emoji: '💍', color: null },
  { id: 'r_shopping', match: ['compra', 'shopping', 'mercado', 'supermercado'], emoji: '🛒', color: null },
  { id: 'r_car', match: ['coche', 'car', 'taller', 'itv', 'inspeção', 'inspección', 'oficina auto', 'carro'], emoji: '🚗', color: null },
  { id: 'r_bill', match: ['pago', 'factura', 'fatura', 'bill', 'recibo', 'pagamento'], emoji: '💶', color: null },
  { id: 'r_vet', match: ['veterinario', 'veterinário', 'vet'], emoji: '🐾', color: null },
  { id: 'r_cinema', match: ['cine', 'cinema', 'film', 'filme', 'película'], emoji: '🎬', color: null },
  { id: 'r_concert', match: ['concierto', 'concert', 'concerto', 'festival'], emoji: '🎵', color: null },
];

export function guessKind(nameOrId: string): SourceKind {
  const s = normalize(nameOrId);
  // vacation rentals only on clear words: a bare "al" also matched "Portugal", "Personal" or "Festival"
  if (/airbnb|booking|vrbo|reserv|alojamento/.test(s)) return 'airbnb';
  if (/birthday|cumple|aniversar|contacts/.test(s)) return 'birthdays';
  if (/holiday|festivo|feriado/.test(s)) return 'holidays';
  return 'generic';
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  // "4,1 MB" in Spanish / Portuguese, "4.1 MB" in English
  return `${(n / 1024 / 1024).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

export type Errors = Record<string, string>;

/** Message of every "over the limit" error (the server answers limit_exceeded for the same cases). */
export const LIMIT_EXCEEDED = 'Supera el máximo permitido';

/** UTF-8 size of a string (custom CSS limit). */
export const cssBytes = (v: string) => new TextEncoder().encode(v).length;

/** Client-side validation. Keys are dotted paths used by fields to show inline errors. Messages are Spanish keys for t().
 *  Rules for features the server turns off (Home Assistant, password login) are skipped. */
export function validateConfig(c: AppConfig, caps: Caps = currentCaps()): Errors {
  const e: Errors = {};
  const ha = hasFeature(caps, 'homeassistant');
  const s = c.screen;
  if (!s.name.trim()) e['screen.name'] = 'Obligatorio';
  if (!HEX_RE.test(s.accent)) e['screen.accent'] = 'Color no válido';
  if (!(s.fontScale >= 0.5 && s.fontScale <= 2)) e['screen.fontScale'] = 'Entre 0.5 y 2';
  if (s.nightMode.enabled) {
    if (!TIME_RE.test(s.nightMode.from)) e['screen.nightMode.from'] = 'Hora no válida (HH:MM)';
    if (!TIME_RE.test(s.nightMode.to)) e['screen.nightMode.to'] = 'Hora no válida (HH:MM)';
  }
  const b = c.background;
  if (!(b.intervalSec >= 10)) e['background.intervalSec'] = 'Mínimo 10 s';
  // "Fondos especiales": a word to look for and photos to show (server/core/bgRules.js refuses them too)
  for (const r of b.rules ?? []) {
    if (r.when.type === 'event' && !r.when.text.trim()) e[`background.rules.${r.id}.text`] = 'Obligatorio';
    if (r.photos.source === 'gallery' ? !r.photos.files.length : !r.photos.albumId) e[`background.rules.${r.id}.photos`] = 'Elige al menos una foto';
  }
  const cal = c.calendar;
  if (cal.weeks !== 'auto' && !(cal.weeks >= 1 && cal.weeks <= 6)) e['calendar.weeks'] = 'Entre 1 y 6';
  if (!(cal.maxEventsPerDay >= 1 && cal.maxEventsPerDay <= 12)) e['calendar.maxEventsPerDay'] = 'Entre 1 y 12';
  cal.sources.forEach((src) => {
    const p = `source.${src.id}`;
    if (!src.name.trim()) e[`${p}.name`] = 'Obligatorio';
    if (!HEX_RE.test(src.color)) e[`${p}.color`] = 'Color no válido';
    if (src.type === 'ics') {
      // A hidden URL (see CalendarSource.urlHidden) is still stored on the server: an empty field keeps it.
      const kept = src.urlHidden && !src.url;
      if (!kept && (!src.url || !isHttpUrl(src.url, true))) e[`${p}.url`] = 'URL no válida (http, https o webcal)';
    } else if (src.type === 'microsoft') {
      if (!src.microsoftAccount || !src.microsoftCalendarId) e[`${p}.url`] = 'Falta la cuenta o el calendario de Microsoft';
    } else {
      if (!src.googleAccount || !src.googleCalendarId) e[`${p}.url`] = 'Falta la cuenta o el calendario de Google';
    }
    if (!(src.refreshMin >= 1 && src.refreshMin <= 1440)) e[`${p}.refreshMin`] = 'Entre 1 y 1440 min';
  });
  cal.iconRules.forEach((r) => {
    if (!r.match.some((m) => m.trim())) e[`rule.${r.id}.match`] = 'Añade al menos una palabra clave';
    if (!r.emoji.trim()) e[`rule.${r.id}.emoji`] = 'Elige un emoji';
    if (r.color && !HEX_RE.test(r.color)) e[`rule.${r.id}.color`] = 'Color no válido';
  });
  const d = c.datetime;
  if (!d.timezone.trim()) e['datetime.timezone'] = 'Obligatorio';
  else {
    try {
      new Intl.DateTimeFormat('en', { timeZone: d.timezone });
    } catch {
      e['datetime.timezone'] = 'Zona horaria desconocida';
    }
  }
  const w = c.weather;
  if (w.enabled) {
    if (!(w.lat >= -90 && w.lat <= 90)) e['weather.lat'] = 'Latitud entre -90 y 90';
    if (!(w.lon >= -180 && w.lon <= 180)) e['weather.lon'] = 'Longitud entre -180 y 180';
    if (ha && w.provider === 'homeassistant' && !w.haWeatherEntity) e['weather.haWeatherEntity'] = 'Elige una entidad weather.*';
  }
  c.news.feeds.forEach((f) => {
    if (!f.name.trim()) e[`feed.${f.id}.name`] = 'Obligatorio';
    if (!isHttpUrl(f.url)) e[`feed.${f.id}.url`] = 'URL no válida';
  });
  if (!(c.news.rotateSec >= 3)) e['news.rotateSec'] = 'Mínimo 3 s';
  if (!(c.news.maxItems >= 1 && c.news.maxItems <= 200)) e['news.maxItems'] = 'Entre 1 y 200';
  if (ha && c.homeassistant.enabled && !isHttpUrl(c.homeassistant.url)) e['homeassistant.url'] = 'URL no válida';
  if (hasFeature(caps, 'immich') && c.immich?.enabled && !isHttpUrl(c.immich.url)) e['immich.url'] = 'URL no válida';
  c.auth.allowedGoogleEmails.forEach((m, i) => {
    if (!EMAIL_RE.test(m)) e[`auth.allowedGoogleEmails.${i}`] = 'Email no válido';
  });
  if (hasFeature(caps, 'passwordLogin') && !c.auth.passwordLoginEnabled && c.auth.allowedGoogleEmails.length === 0)
    e['auth.passwordLoginEnabled'] = 'Añade un email de Google permitido antes de desactivar la contraseña';
  (c.privacy?.schedule ?? []).forEach((r) => {
    if (r.from === r.to) e[`privacy.${r.id}.to`] = 'Debe ser distinta de la hora de inicio';
  });
  const cssMax = caps.limits.customCssBytes;
  if (typeof cssMax === 'number' && hasFeature(caps, 'customCss') && cssBytes(s.customCss) > cssMax) e['screen.customCss'] = LIMIT_EXCEEDED;
  // Familia (same limits as server/core/familyCore.js)
  const fam = c.family;
  fam?.members.forEach((m) => {
    if (!m.name.trim()) e[`fam.m.${m.id}.name`] = 'Obligatorio';
    if (!/^#[0-9a-f]{6}$/i.test(m.color)) e[`fam.m.${m.id}.color`] = 'Color no válido';
  });
  fam?.chores.forEach((h) => {
    if (!h.title.trim()) e[`fam.h.${h.id}.title`] = 'Obligatorio';
    if (!(Number.isInteger(h.points) && h.points >= 0 && h.points <= 20)) e[`fam.h.${h.id}.points`] = 'Entre 0 y 20';
  });
  fam?.rewards.forEach((w) => {
    if (!w.title.trim()) e[`fam.w.${w.id}.title`] = 'Obligatorio';
    if (!(Number.isInteger(w.cost) && w.cost >= 1 && w.cost <= 500)) e[`fam.w.${w.id}.cost`] = 'Entre 1 y 500';
  });
  return e;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isValidDate = (v: string) => {
  if (!DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysInMonth = (m: number) => DAYS_IN_MONTH[m - 1] ?? 31;

/** Keys produced by validateConfig() that belong to the selected screen (the rest are global). */
const PER_SCREEN_KEY = /^(screen\.|background\.|layout\.|widgets\.|message\.|alerts\.|privacy\.|calendar\.(weeks|maxEventsPerDay)$|news\.rotateSec$|countdowns\.max$|family\.(memberIds|touch|showQr)$)/;
export const isPerScreenKey = (k: string) => PER_SCREEN_KEY.test(k);

/** Validation of the global v2 lists (local events, birthdays, rules, countdowns, schedules, screens). */
export function validateGlobal(c: StoredConfig): Errors {
  const e: Errors = {};
  const seenSlugs = new Map<string, string>();
  const carouselSlugs = new Set((c.carousels?.items ?? []).map((x) => x.slug));
  for (const s of c.screens) {
    if (!s.name.trim()) e[`scr.${s.id}.name`] = 'Obligatorio';
    if (!SLUG_RE.test(s.slug)) e[`scr.${s.id}.slug`] = 'Solo minúsculas, números y guiones';
    else if (seenSlugs.has(s.slug)) e[`scr.${s.id}.slug`] = 'Ya existe otra pantalla con esta dirección';
    else if (carouselSlugs.has(s.slug)) e[`scr.${s.id}.slug`] = 'Ya hay un carrusel con esta dirección';
    seenSlugs.set(s.slug, s.id);
  }
  for (const x of c.localEvents?.items ?? []) {
    const p = `local.${x.id}`;
    if (!x.title.trim()) e[`${p}.title`] = 'Obligatorio';
    if (!isValidDate(x.date)) e[`${p}.date`] = 'Fecha no válida';
    if (!isValidDate(x.endDate) || x.endDate < x.date) e[`${p}.endDate`] = 'Debe ser igual o posterior al inicio';
    if (!x.allDay) {
      if (!TIME_RE.test(x.startTime)) e[`${p}.startTime`] = 'Hora no válida (HH:MM)';
      if (!TIME_RE.test(x.endTime)) e[`${p}.endTime`] = 'Hora no válida (HH:MM)';
      else if (x.endDate === x.date && x.endTime <= x.startTime) e[`${p}.endTime`] = 'Debe ser posterior a la hora de inicio';
    }
    if (x.repeat.until && (!isValidDate(x.repeat.until) || x.repeat.until < x.date)) e[`${p}.until`] = 'Debe ser igual o posterior al inicio';
    if (x.color && !HEX_RE.test(x.color)) e[`${p}.color`] = 'Color no válido';
  }
  for (const b of c.birthdays?.items ?? []) {
    const p = `bday.${b.id}`;
    if (!b.name.trim()) e[`${p}.name`] = 'Obligatorio';
    if (!(b.month >= 1 && b.month <= 12) || !(b.day >= 1 && b.day <= daysInMonth(b.month))) e[`${p}.date`] = 'Fecha no válida';
    if (b.year != null && !(b.year >= 1900 && b.year <= 2100)) e[`${p}.year`] = 'Año entre 1900 y 2100';
  }
  for (const r of c.eventRules?.items ?? []) {
    const p = `frule.${r.id}`;
    if (!r.match.trim()) e[`${p}.match`] = 'Obligatorio';
    if (r.action === 'style' && !r.emoji && !r.color && !r.countdown) e[`${p}.emoji`] = 'Elige un emoji, un color o la cuenta atrás';
    if (r.color && !HEX_RE.test(r.color)) e[`${p}.color`] = 'Color no válido';
  }
  for (const k of c.countdowns?.items ?? []) {
    const p = `cd.${k.id}`;
    if (!k.title.trim()) e[`${p}.title`] = 'Obligatorio';
    if (!isValidDate(k.date)) e[`${p}.date`] = 'Fecha no válida';
  }
  const cd = c.countdowns;
  if (cd) {
    if (!(cd.birthdayDays >= 1 && cd.birthdayDays <= 366)) e['countdowns.birthdayDays'] = 'Entre 1 y 366';
    if (!(cd.horizonDays >= 1 && cd.horizonDays <= 3660)) e['countdowns.horizonDays'] = 'Entre 1 y 3660';
  }
  // carousels: a name, an address no screen uses, at least one step, 10 s to 1 h per step
  const carSlugs = new Set<string>();
  const screenIds = new Set(c.screens.map((s) => s.id));
  for (const x of c.carousels?.items ?? []) {
    const p = `car.${x.id}`;
    if (!x.name.trim()) e[`${p}.name`] = 'Obligatorio';
    if (!SLUG_RE.test(x.slug)) e[`${p}.slug`] = 'Solo minúsculas, números y guiones';
    else if (seenSlugs.has(x.slug)) e[`${p}.slug`] = 'Ya hay una pantalla con esta dirección';
    else if (carSlugs.has(x.slug)) e[`${p}.slug`] = 'Ya existe otro carrusel con esta dirección';
    carSlugs.add(x.slug);
    if (x.enabled && !x.steps.some((st) => screenIds.has(st.screenId))) e[`${p}.steps`] = 'Añade al menos una pantalla';
    x.steps.forEach((st, j) => {
      if (!(Number.isInteger(st.seconds) && st.seconds >= 10 && st.seconds <= 3600)) e[`${p}.step${j}.seconds`] = 'Entre 10 s y 1 h';
    });
    for (const r of x.schedule ?? []) if (r.from === r.to) e[`${p}.sched.${r.id}.to`] = 'Debe ser distinta de la hora de inicio';
  }
  // widgets: an address the server takes (http or https, no user:password; https only on Marco Cloud), a type and a
  // refresh it offers
  const wcaps = currentCaps();
  const minRefresh = limitOf(wcaps, 'widgetMinRefreshSec') ?? 0;
  for (const w of c.widgets ?? []) {
    const p = `wdg.${w.id}`;
    if (w.type === 'prices') {
      const o = w.options.prices;
      if (!hasFeature(wcaps, 'priceWidgets')) e[`${p}.type`] = 'No disponible aquí';
      if (!o || !priceZone(o.zone)) e[`${p}.zone`] = 'Elige una zona';
      if (o && !(Number.isFinite(o.surcharge) && o.surcharge >= MIN_SURCHARGE && o.surcharge <= MAX_SURCHARGE)) e[`${p}.surcharge`] = `Entre ${MIN_SURCHARGE} y ${MAX_SURCHARGE}`;
      if (o && !(Number.isFinite(o.vat) && o.vat >= 0 && o.vat <= MAX_VAT)) e[`${p}.vat`] = `Entre 0 y ${MAX_VAT}`;
      // the tariff: a grid company of the zone, band prices in range
      if (o?.tariff === 'grid' && gridCompany(o.grid ?? '')?.zone !== o.zone) e[`${p}.grid`] = 'Elige tu compañía de red';
      if (o?.tariff === 'bands' && o.bands) {
        o.bands.list.forEach((b, i) => {
          if (!(Number.isFinite(b.price) && b.price >= MIN_BAND_PRICE && b.price <= MAX_BAND_PRICE)) e[`${p}.bands.${i}.price`] = `Entre ${MIN_BAND_PRICE} y ${MAX_BAND_PRICE}`;
        });
        if (o.bands.list.every((b) => !b.price)) e[`${p}.bands`] = 'Pon el precio de al menos un tramo';
      }
      continue;
    }
    if (w.type === 'currency') {
      const o = w.options.currency;
      if (!o?.pairs?.length) e[`${p}.pairs`] = 'Añade al menos un par';
      else if (o.pairs.some((x) => x.base === x.quote)) e[`${p}.pairs`] = 'Elige dos monedas distintas.';
      continue;
    }
    const bad = widgetUrlProblem(w.options.url, wcaps.edition === 'cloud');
    if (bad) e[`${p}.url`] = bad;
    if (w.type === 'web' && !hasFeature(wcaps, 'webWidgets')) e[`${p}.type`] = 'No disponible aquí';
    const list = w.type === 'web' ? WEB_WIDGET_REFRESH_SEC : WIDGET_REFRESH_SEC;
    if (!list.includes(w.options.refreshSec)) e[`${p}.refreshSec`] = 'Elige un intervalo de la lista';
    else if (w.options.refreshSec > 0 && w.options.refreshSec < minRefresh) e[`${p}.refreshSec`] = 'Elige un intervalo de la lista';
  }
  for (const m of c.schedules?.items ?? []) {
    const p = `sched.${m.id}`;
    if (!m.title.trim()) e[`${p}.title`] = 'Obligatorio';
    if (!TIME_RE.test(m.from)) e[`${p}.from`] = 'Hora no válida (HH:MM)';
    if (!TIME_RE.test(m.to)) e[`${p}.to`] = 'Hora no válida (HH:MM)';
    else if (m.from === m.to) e[`${p}.to`] = 'Debe ser distinta de la hora de inicio';
    if (m.startDate && m.endDate && m.endDate < m.startDate) e[`${p}.endDate`] = 'Debe ser igual o posterior al inicio';
  }
  return e;
}

export interface AllErrors {
  /** errors not tied to a screen (sources, rules, lists, auth…) */
  global: Errors;
  /** per-screen errors, keyed by screen id (keys as produced by validateConfig on the flat view) */
  screens: Record<string, Errors>;
  total: number;
}

/** List sizes checked against the limits (key `limit.<name>`, see sectionForError). */
const LIMITED_LISTS: [LimitName, (c: StoredConfig) => number][] = [
  ['screens', (c) => c.screens.length],
  ['sources', (c) => c.calendar.sources.length],
  ['newsFeeds', (c) => c.news?.feeds?.length ?? 0],
  ['localEvents', (c) => c.localEvents?.items?.length ?? 0],
  ['birthdays', (c) => c.birthdays?.items?.length ?? 0],
  ['countdowns', (c) => c.countdowns?.items?.length ?? 0],
  ['carousels', (c) => c.carousels?.items?.length ?? 0],
];

/** `limit.<name>` errors for lists longer than the limit. */
export function validateLimits(full: StoredConfig, caps: Caps = currentCaps()): Errors {
  const e: Errors = {};
  for (const [name, count] of LIMITED_LISTS) {
    const max = limitOf(caps, name);
    if (max != null && count(full) > max) e[`limit.${name}`] = LIMIT_EXCEEDED;
  }
  return e;
}

/** Validate the whole stored config: every screen's flat view + the global lists + the limits. */
export function validateAll(full: StoredConfig, caps: Caps = currentCaps()): AllErrors {
  const global: Errors = { ...validateGlobal(full), ...validateLimits(full, caps) };
  const screens: Record<string, Errors> = {};
  for (const s of full.screens) {
    const errs = validateConfig(projectScreen(full, s.id), caps);
    const mine: Errors = {};
    for (const [k, v] of Object.entries(errs)) {
      if (isPerScreenKey(k)) mine[k] = v;
      else global[k] = v;
    }
    screens[s.id] = mine;
  }
  const total = Object.keys(global).length + Object.values(screens).reduce((n, e) => n + Object.keys(e).length, 0);
  return { global, screens, total };
}

/**
 * Server validation path → { screenIndex, section } (docs/ARCHITECTURE.md error paths).
 * `screens[1].screen.accent` → { screenIndex: 1, section: 'screen' }; `calendar.sources[2].url` → calendars.
 */
export function sectionForServerPath(path: string): { screenIndex: number | null; section: string } {
  const m = /^screens\[(\d+)\]\.?([a-zA-Z]+)?/.exec(path);
  if (m) {
    const sec = m[2] ?? '';
    const map: Record<string, string> = { screen: 'screen', layout: 'layout', background: 'background', message: 'message', calendar: 'calendars', datetime: 'datetime', weather: 'weather', news: 'news', todo: 'todo', countdowns: 'countdowns', alerts: 'alerts', privacy: 'screen', family: 'family', widgets: 'layout', canvas: 'layout' };
    return { screenIndex: Number(m[1]), section: map[sec] ?? 'screens' };
  }
  const top = path.split(/[.[]/)[0];
  const map: Record<string, string> = {
    calendar: path.includes('iconRules') ? 'icons' : 'calendars',
    datetime: 'datetime', weather: 'weather', news: 'news', todo: 'todo', localEvents: 'local', birthdays: 'birthdays',
    eventRules: 'filters', countdowns: 'countdowns', schedules: 'alerts', homeassistant: 'homeassistant', immich: 'immich', auth: 'security',
    screens: 'screens', defaultScreen: 'screens', carousels: 'carousels', widgets: 'widgets', family: path.startsWith('family.meals') ? 'meals' : 'family',
  };
  return { screenIndex: null, section: map[top] ?? 'home' };
}

/** Map an error key to the nav section that owns it (for "jump to error"). */
const LIMIT_SECTION: Record<string, string> = { screens: 'screens', sources: 'calendars', newsFeeds: 'news', localEvents: 'local', birthdays: 'birthdays', countdowns: 'countdowns', carousels: 'carousels' };

export function sectionForError(key: string): string {
  if (key.startsWith('limit.')) return LIMIT_SECTION[key.slice(6)] ?? 'home';
  if (key.startsWith('screen.') || key.startsWith('privacy.')) return 'screen';
  if (key.startsWith('layout.')) return 'layout';
  if (key.startsWith('message.')) return 'message';
  if (key.startsWith('alerts.') || key.startsWith('sched.')) return 'alerts';
  if (key.startsWith('countdowns.') || key.startsWith('cd.')) return 'countdowns';
  if (key.startsWith('local.')) return 'local';
  if (key.startsWith('bday.')) return 'birthdays';
  if (key.startsWith('frule.')) return 'filters';
  if (key.startsWith('scr.')) return 'screens';
  if (key.startsWith('car.')) return 'carousels';
  if (key.startsWith('wdg.')) return 'widgets';
  if (key.startsWith('widgets.')) return 'layout';
  if (key.startsWith('background.')) return 'background';
  if (key.startsWith('calendar.') || key.startsWith('source.')) return 'calendars';
  if (key.startsWith('rule.')) return 'icons';
  if (key.startsWith('datetime.')) return 'datetime';
  if (key.startsWith('weather.')) return 'weather';
  if (key.startsWith('feed.') || key.startsWith('news.')) return 'news';
  if (key.startsWith('homeassistant.')) return 'homeassistant';
  if (key.startsWith('immich.')) return 'immich';
  if (key.startsWith('auth.')) return 'security';
  if (key.startsWith('fam.') || key.startsWith('family.')) return 'family';
  return 'screen';
}

type BuiltinCfg = Pick<StoredConfig, 'calendar' | 'localEvents' | 'birthdays'>;
export type BuiltinListId = 'local' | 'birthdays';

/** A built-in list with no items, or turned off, is left out of the display legend (server/core/screens.js publicSources). */
export const builtinListShown = (c: BuiltinCfg, id: BuiltinListId) => {
  const b = id === 'local' ? c.localEvents : c.birthdays;
  return b.enabled !== false && (b.items?.length ?? 0) > 0;
};

const builtinBaseName = (c: BuiltinCfg, id: BuiltinListId) => (id === 'local' ? c.localEvents.name || 'Local' : c.birthdays.name || t('Cumpleaños')).trim();

/** Whether a calendar source has the same name as a built-in list (case-insensitive). */
export function builtinNameClashes(c: BuiltinCfg, id: BuiltinListId) {
  const key = builtinBaseName(c, id).toLocaleLowerCase();
  return c.calendar.sources.some((s) => (s.name || '').trim().toLocaleLowerCase() === key);
}

/** Name of a built-in list, marked "(lista de Marco)" when a calendar source has the same name. */
export function builtinListName(c: BuiltinCfg, id: BuiltinListId) {
  const name = builtinBaseName(c, id);
  return builtinNameClashes(c, id) ? t('{name} (lista de Marco)', { name }) : name;
}

/** Name of a source row from the server (status lists): the built-in lists get the clash label of builtinListName. */
export const sourceRowName = (c: BuiltinCfg, id: string, name: string) => (id === 'local' || id === 'birthdays' ? builtinListName(c, id) : name);

/**
 * Rows of "Qué se ve de cada calendario" (privacy mode): every calendar source, then the built-in lists that the
 * display would show (not empty, not turned off), with the clash label of builtinListName.
 */
export function privacyCalendarRows(c: BuiltinCfg) {
  const rows: { id: string; name: string; color: string }[] = c.calendar.sources.map((s) => ({ id: s.id, name: s.name || s.id, color: s.color }));
  for (const id of ['local', 'birthdays'] as const) {
    if (builtinListShown(c, id)) rows.push({ id, name: builtinListName(c, id), color: (id === 'local' ? c.localEvents : c.birthdays).color });
  }
  return rows;
}

/** User calendar sources + the built-in pseudo-sources (local events, birthdays) as picker options. */
export function allSourceOptions(c: BuiltinCfg, opts: { includeDisabled?: boolean } = {}) {
  const out = c.calendar.sources
    .filter((s) => opts.includeDisabled || s.enabled)
    .map((s) => ({ id: s.id, name: s.name || s.id, color: s.color, emoji: s.emoji || KIND_EMOJI[s.kind] || '' }));
  out.push({ id: 'local', name: builtinListName(c, 'local'), color: c.localEvents.color, emoji: c.localEvents.emoji || '📅' });
  out.push({ id: 'birthdays', name: builtinListName(c, 'birthdays'), color: c.birthdays.color, emoji: c.birthdays.emoji || '🎂' });
  return out;
}

/** First name for the dashboard greeting; none when the account name is an email address (Marco Cloud accounts). */
export function greetingName(name?: string | null): string {
  const n = (name || '').trim();
  return n && !n.includes('@') ? n.split(/\s+/)[0] : '';
}
