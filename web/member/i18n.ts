import type { Lang } from '../shared/types';
import { ROWS_ACCESS_ALL } from '../admin/i18n-dict-access';

/**
 * The phone dashboard's texts: only the family access rows (keeps the page small). Same rules as the admin's t():
 * the Spanish string is the key and `{name}` placeholders come from `vars`. A missing key falls back to English.
 */
const DICTS: Record<Exclude<Lang, 'es'>, Record<string, string>> = { en: {}, pt: {}, nl: {}, da: {} };
for (const [es, en, pt, nl, da] of ROWS_ACCESS_ALL) {
  DICTS.en[es] ??= en;
  DICTS.pt[es] ??= pt;
  DICTS.nl[es] ??= nl;
  DICTS.da[es] ??= da;
}

const LANGS: Lang[] = ['es', 'en', 'pt', 'nl', 'da'];
const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);

let current: Lang = 'en';
const LS_LANG = 'marco.member.lang';

/** The household language the page used last time, else the browser's, else English. */
export function initialLang(): Lang {
  try {
    const v = localStorage.getItem(LS_LANG);
    if (isLang(v)) return v;
  } catch {
    /* ignore */
  }
  try {
    for (const l of navigator.languages ?? [navigator.language]) {
      const base = String(l).slice(0, 2).toLowerCase();
      if (isLang(base)) return base;
    }
  } catch {
    /* ignore */
  }
  return 'en';
}

export function setLang(l: Lang) {
  if (!isLang(l)) return;
  current = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem(LS_LANG, l);
  } catch {
    /* ignore */
  }
}

export const getLang = () => current;

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = current === 'es' ? key : DICTS[current][key] ?? DICTS.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
  return s;
}

const LOCALE: Record<Lang, string> = { es: 'es-ES', en: 'en-GB', pt: 'pt-PT', nl: 'nl-NL', da: 'da-DK' };
export const locale = () => LOCALE[current];
