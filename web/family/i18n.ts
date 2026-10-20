import type { Lang } from '../shared/types';
import {
  DA_FAMILY, DA_SINGULAR_FAMILY, NL_FAMILY, NL_SINGULAR_FAMILY, PL_FAMILY, PL_FEW_FAMILY, PL_SINGULAR_FAMILY, ROWS_FAMILY, SINGULAR_FAMILY,
} from '../admin/i18n-dict-family';

/**
 * The family page's texts: only the Familia rows (keeps the page small). Same rules as the admin's t():
 * the Spanish string is the key, `{name}` placeholders come from `vars`, and vars.n === 1 picks the singular form
 * (Polish also has a "few" form for 2-4, 22-24…). A Dutch, Danish or Polish key that is missing falls back to English.
 */
const EN: Record<string, string> = {};
const PT: Record<string, string> = {};
for (const [es, en, pt] of ROWS_FAMILY) {
  if (!(es in EN)) EN[es] = en;
  if (!(es in PT)) PT[es] = pt;
}
const MORE: Partial<Record<Lang, [Record<string, string>, Record<string, string>, Record<string, string>?]>> = {
  nl: [NL_FAMILY, NL_SINGULAR_FAMILY],
  da: [DA_FAMILY, DA_SINGULAR_FAMILY],
  pl: [PL_FAMILY, PL_SINGULAR_FAMILY, PL_FEW_FAMILY],
};

const FAMILY_LANGS: Lang[] = ['es', 'en', 'pt', 'nl', 'da', 'pl'];
let plRules: Intl.PluralRules | null = null;
/** Polish "few" counts: 2-4, 22-24, 32-34… (not 12-14). */
const isFew = (n: number) => current === 'pl' && Number.isFinite(n) && (plRules ??= new Intl.PluralRules('pl-PL')).select(n) === 'few';
const isLang = (v: unknown): v is Lang => FAMILY_LANGS.includes(v as Lang);

let current: Lang = 'en';
const LS_LANG = 'marco.family.lang';

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
  let s = key;
  const isOne = !!vars && Number(vars.n) === 1;
  const more = MORE[current];
  if (more) {
    const few = vars && more[2] && isFew(Number(vars.n)) ? more[2][key] : undefined;
    s = (isOne ? more[1][key] ?? SINGULAR_FAMILY[key]?.[1] : undefined) ?? few ?? more[0][key] ?? EN[key] ?? key;
  } else {
    const one = isOne ? SINGULAR_FAMILY[key] : undefined;
    if (one) s = one[current === 'en' ? 1 : current === 'pt' ? 2 : 0];
    else if (current === 'en') s = EN[key] ?? key;
    else if (current === 'pt') s = PT[key] ?? key;
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
  return s;
}

const LOCALE: Record<Lang, string> = { es: 'es-ES', en: 'en-GB', pt: 'pt-PT', nl: 'nl-NL', da: 'da-DK', pl: 'pl-PL' };
export const locale = () => LOCALE[current];
