import type { Lang } from '../shared/types';
import { EN, PT } from './i18n-dict';
import { SINGULAR } from './i18n-plural';
import { LANGS, LOCALES } from '../shared/i18n';
import { NL, NL_SINGULAR } from './i18n-dict-nl';
import { DA, DA_SINGULAR } from './i18n-dict-da';
import { PL, PL_FEW, PL_SINGULAR } from './i18n-dict-pl';
import {
  DA_FAMILY, DA_SINGULAR_FAMILY, NL_FAMILY, NL_SINGULAR_FAMILY, PL_FAMILY, PL_FEW_FAMILY, PL_SINGULAR_FAMILY,
} from './i18n-dict-family';

/**
 * Spanish is the source language: t() takes the Spanish string as key and returns the
 * English/Portuguese/Dutch/Danish/Polish translation when available. A Dutch, Danish or Polish key that is missing
 * falls back to English; English and Portuguese fall back to Spanish.
 * `{name}` placeholders are interpolated from `vars`. Polish also has a "few" form for counts like 2-4 (pluralForm).
 */
let current: Lang = 'es';

const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);

/** Dutch, Danish and Polish rows (admin + family), their singular forms and (Polish) their "few" forms. */
const MORE: Partial<Record<Lang, { rows: Record<string, string>[]; one: Record<string, string>[]; few?: Record<string, string>[] }>> = {
  nl: { rows: [NL, NL_FAMILY], one: [NL_SINGULAR, NL_SINGULAR_FAMILY] },
  da: { rows: [DA, DA_FAMILY], one: [DA_SINGULAR, DA_SINGULAR_FAMILY] },
  pl: { rows: [PL, PL_FAMILY], one: [PL_SINGULAR, PL_SINGULAR_FAMILY], few: [PL_FEW, PL_FEW_FAMILY] },
};

let plRules: Intl.PluralRules | null = null;
/**
 * Count form of `n` in the current language: 'one', 'few' or 'other'. Only Polish has a "few" form here
 * (2-4, 22-24, 32-34… but not 12-14: "2 ekrany", "5 ekranów", "22 ekrany"); every other language says 'one' for 1.
 */
export function pluralForm(n: number, lang: Lang = current): 'one' | 'few' | 'other' {
  if (lang !== 'pl') return n === 1 ? 'one' : 'other';
  plRules ??= new Intl.PluralRules('pl-PL');
  const c = plRules.select(n);
  return c === 'one' || c === 'few' ? c : 'other';
}

const LS_KEY = 'calendar-admin.lang';

export function initialLang(): Lang {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (isLang(v)) return v;
  } catch {
    /* ignore */
  }
  // First visit: follow the browser language (English fallback); the user can switch in the sidebar (remembered per browser).
  return browserLang();
}

/** First of the browser's languages that the admin speaks, else English. */
export function browserLang(langs: readonly string[] | undefined = typeof navigator === 'undefined' ? undefined : navigator.languages ?? [navigator.language]): Lang {
  try {
    for (const l of langs ?? []) {
      const base = String(l).slice(0, 2).toLowerCase();
      if (isLang(base)) return base;
    }
  } catch {
    /* ignore */
  }
  return 'en';
}

export function setLang(l: Lang) {
  current = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem(LS_KEY, l);
  } catch {
    /* ignore */
  }
}

export const getLang = () => current;

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = key;
  const n = vars && vars.n !== undefined && vars.n !== '' ? Number(vars.n) : NaN;
  const form = Number.isFinite(n) ? pluralForm(n) : 'other';
  const isOne = form === 'one';
  const more = MORE[current];
  if (more) {
    const pick = (list: Record<string, string>[]) => list[0][key] ?? list[1][key];
    s =
      (isOne ? pick(more.one) ?? (SINGULAR[key] ? SINGULAR[key][1] : undefined) : undefined) ??
      (form === 'few' && more.few ? pick(more.few) : undefined) ??
      pick(more.rows) ??
      EN[key] ??
      key;
  } else {
    const one = isOne ? SINGULAR[key] : undefined;
    if (one) s = one[current === 'en' ? 1 : current === 'pt' ? 2 : 0];
    else if (current === 'en') s = EN[key] ?? key;
    else if (current === 'pt') s = PT[key] ?? key;
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
  return s;
}

export const locale = () => LOCALES[current];

export function relTime(iso: string | number | null | undefined): string {
  if (iso == null || iso === '') return '–';
  const ts = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ts)) return '–';
  const diff = (ts - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 45 * 60) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 22 * 3600) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '–';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  // Danish writes the units out ("2 t 5 min", t = timer); Polish spaces them ("2 h 5 min", d = dni)
  if (current === 'pl') {
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${m} min`;
    return `${m} min ${Math.floor(sec % 60)} s`;
  }
  if (current === 'da') {
    if (d) return `${d} d ${h} t`;
    if (h) return `${h} t ${m} min`;
    return `${m} min ${Math.floor(sec % 60)} s`;
  }
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}

/** Wind speed unit of the metric system: Danish writes km/t ("kilometer i timen"). */
export const kmh = () => (current === 'da' ? 'km/t' : 'km/h');

/** "1 pantalla" / "3 pantallas" */
export const nScreens = (n: number) => (n === 1 ? t('1 pantalla') : t('{n} pantallas', { n }));
