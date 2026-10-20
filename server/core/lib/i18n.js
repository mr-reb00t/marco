// Server-side strings (weather descriptions, Airbnb titles, wind labels). Default language: en.
export const LANGS = ['es', 'en', 'pt', 'nl', 'da', 'pl'];
export const lang = (l) => (LANGS.includes(l) ? l : 'en');

// WMO weather interpretation codes (Open-Meteo; 68 and 69 for the other providers' sleet).
const WMO = {
  0: ['Despejado', 'Clear sky', 'Céu limpo', 'Onbewolkt', 'Klart vejr', 'Bezchmurnie'],
  1: ['Mayormente despejado', 'Mainly clear', 'Céu pouco nublado', 'Licht bewolkt', 'Overvejende klart', 'Przeważnie bezchmurnie'],
  2: ['Parcialmente nublado', 'Partly cloudy', 'Parcialmente nublado', 'Half bewolkt', 'Delvis skyet', 'Częściowe zachmurzenie'],
  3: ['Nublado', 'Overcast', 'Encoberto', 'Zwaar bewolkt', 'Overskyet', 'Pochmurno'],
  45: ['Niebla', 'Fog', 'Nevoeiro', 'Mist', 'Tåge', 'Mgła'],
  48: ['Niebla con escarcha', 'Depositing rime fog', 'Nevoeiro com geada', 'Mist met rijp', 'Rimtåge', 'Mgła osadzająca szadź'],
  51: ['Llovizna ligera', 'Light drizzle', 'Chuvisco fraco', 'Lichte motregen', 'Let støvregn', 'Lekka mżawka'],
  53: ['Llovizna', 'Drizzle', 'Chuvisco', 'Motregen', 'Støvregn', 'Mżawka'],
  55: ['Llovizna intensa', 'Dense drizzle', 'Chuvisco forte', 'Zware motregen', 'Kraftig støvregn', 'Gęsta mżawka'],
  56: ['Llovizna helada', 'Freezing drizzle', 'Chuvisco gelado', 'Aanvriezende motregen', 'Frysende støvregn', 'Marznąca mżawka'],
  57: ['Llovizna helada intensa', 'Dense freezing drizzle', 'Chuvisco gelado forte', 'Zware aanvriezende motregen', 'Kraftig frysende støvregn', 'Gęsta marznąca mżawka'],
  61: ['Lluvia ligera', 'Light rain', 'Chuva fraca', 'Lichte regen', 'Let regn', 'Lekki deszcz'],
  63: ['Lluvia', 'Rain', 'Chuva', 'Regen', 'Regn', 'Deszcz'],
  65: ['Lluvia intensa', 'Heavy rain', 'Chuva forte', 'Zware regen', 'Kraftig regn', 'Ulewny deszcz'],
  66: ['Lluvia helada', 'Freezing rain', 'Chuva gelada', 'IJzel', 'Frysende regn', 'Marznący deszcz'],
  67: ['Lluvia helada intensa', 'Heavy freezing rain', 'Chuva gelada forte', 'Zware ijzel', 'Kraftig frysende regn', 'Silny marznący deszcz'],
  // 68, 69: rain and snow mixed (WMO 4677); MET Norway and Pirate Weather "sleet"
  68: ['Aguanieve', 'Sleet', 'Água-neve', 'Natte sneeuw', 'Slud', 'Deszcz ze śniegiem'],
  69: ['Aguanieve intensa', 'Heavy sleet', 'Água-neve forte', 'Zware natte sneeuw', 'Kraftig slud', 'Silny deszcz ze śniegiem'],
  71: ['Nevada ligera', 'Light snow', 'Neve fraca', 'Lichte sneeuw', 'Let sne', 'Lekki śnieg'],
  73: ['Nevada', 'Snow', 'Neve', 'Sneeuw', 'Sne', 'Śnieg'],
  75: ['Nevada intensa', 'Heavy snow', 'Neve forte', 'Zware sneeuw', 'Kraftig sne', 'Intensywny śnieg'],
  77: ['Granizo fino', 'Snow grains', 'Grãos de neve', 'Motsneeuw', 'Kornsne', 'Ziarna śniegu'],
  80: ['Chubascos ligeros', 'Light showers', 'Aguaceiros fracos', 'Lichte buien', 'Lette byger', 'Lekkie przelotne opady'],
  81: ['Chubascos', 'Showers', 'Aguaceiros', 'Buien', 'Byger', 'Przelotne opady'],
  82: ['Chubascos fuertes', 'Violent showers', 'Aguaceiros fortes', 'Zware buien', 'Kraftige byger', 'Silne przelotne opady'],
  85: ['Chubascos de nieve', 'Snow showers', 'Aguaceiros de neve', 'Sneeuwbuien', 'Snebyger', 'Przelotne opady śniegu'],
  86: ['Chubascos de nieve fuertes', 'Heavy snow showers', 'Aguaceiros de neve fortes', 'Zware sneeuwbuien', 'Kraftige snebyger', 'Silne przelotne opady śniegu'],
  95: ['Tormenta', 'Thunderstorm', 'Trovoada', 'Onweer', 'Tordenvejr', 'Burza'],
  96: ['Tormenta con granizo', 'Thunderstorm with hail', 'Trovoada com granizo', 'Onweer met hagel', 'Torden med hagl', 'Burza z gradem'],
  99: ['Tormenta con granizo fuerte', 'Thunderstorm with heavy hail', 'Trovoada com granizo forte', 'Onweer met zware hagel', 'Torden med kraftigt hagl', 'Burza z silnym gradem'],
};

export function wmoDescription(code, l) {
  const row = WMO[code];
  if (!row) return '';
  return row[LANGS.indexOf(lang(l))];
}

const DIRS = {
  es: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  pt: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  nl: ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'],
  da: ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'],
  pl: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
};

export function windDirLabel(deg, l) {
  if (deg == null || Number.isNaN(+deg)) return '';
  const i = Math.round((((+deg % 360) + 360) % 360) / 45) % 8;
  return DIRS[lang(l)][i];
}

const STRINGS = {
  reservation: { es: 'Reserva', en: 'Reservation', pt: 'Reserva', nl: 'Reservering', da: 'Reservation', pl: 'Rezerwacja' },
  busy: { es: 'Ocupado', en: 'Busy', pt: 'Ocupado', nl: 'Bezet', da: 'Optaget', pl: 'Zajęte' },
  blocked: { es: 'No disponible', en: 'Not available', pt: 'Indisponível', nl: 'Niet beschikbaar', da: 'Ikke ledig', pl: 'Niedostępne' },
  untitled: { es: '(Sin título)', en: '(No title)', pt: '(Sem título)', nl: '(Geen titel)', da: '(Uden titel)', pl: '(Bez tytułu)' },
};

export function t(key, l) {
  return STRINGS[key]?.[lang(l)] ?? key;
}

/** First supported language of an Accept-Language header (default en). */
export function langFromHeader(header) {
  for (const part of String(header || '').split(',')) {
    const base = part.trim().slice(0, 2).toLowerCase();
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

/** Language of an admin request: explicit ?lang= / body.lang, else Accept-Language. */
export const requestLang = (req) => {
  const explicit = req?.query?.lang ?? req?.body?.lang;
  return LANGS.includes(explicit) ? explicit : langFromHeader(req?.get?.('accept-language'));
};

// Import-preview summaries (server/core/backupsCore.js). Nouns: [one, many, grammatical gender ('f'|'m')]; Polish:
// [one, few (2-4, 22-24…), many].
const NOUNS = {
  screen: { es: ['pantalla', 'pantallas', 'f'], en: ['screen', 'screens'], pt: ['ecrã', 'ecrãs', 'm'], nl: ['scherm', 'schermen'], da: ['skærm', 'skærme'], pl: ['ekran', 'ekrany', 'ekranów'] },
  source: { es: ['fuente', 'fuentes', 'f'], en: ['source', 'sources'], pt: ['fonte', 'fontes', 'f'], nl: ['bron', 'bronnen'], da: ['kilde', 'kilder'], pl: ['źródło', 'źródła', 'źródeł'] },
  feed: { es: ['feed', 'feeds', 'm'], en: ['feed', 'feeds'], pt: ['feed', 'feeds', 'm'], nl: ['feed', 'feeds'], da: ['feed', 'feeds'], pl: ['kanał', 'kanały', 'kanałów'] },
  item: { es: ['elemento', 'elementos', 'm'], en: ['item', 'items'], pt: ['elemento', 'elementos', 'm'], nl: ['item', 'items'], da: ['element', 'elementer'], pl: ['element', 'elementy', 'elementów'] },
  iconRule: { es: ['regla de iconos', 'reglas de iconos', 'f'], en: ['icon rule', 'icon rules'], pt: ['regra de ícones', 'regras de ícones', 'f'], nl: ['pictogramregel', 'pictogramregels'], da: ['ikonregel', 'ikonregler'], pl: ['reguła ikon', 'reguły ikon', 'reguł ikon'] },
  member: { es: ['miembro', 'miembros', 'm'], en: ['member', 'members'], pt: ['membro', 'membros', 'm'], nl: ['gezinslid', 'gezinsleden'], da: ['medlem', 'medlemmer'], pl: ['członek', 'członków', 'członków'] },
  chore: { es: ['rutina', 'rutinas', 'f'], en: ['routine', 'routines'], pt: ['rotina', 'rotinas', 'f'], nl: ['routine', 'routines'], da: ['rutine', 'rutiner'], pl: ['rutyna', 'rutyny', 'rutyn'] },
  reward: { es: ['premio', 'premios', 'm'], en: ['reward', 'rewards'], pt: ['prémio', 'prémios', 'm'], nl: ['beloning', 'beloningen'], da: ['belønning', 'belønninger'], pl: ['nagroda', 'nagrody', 'nagród'] },
};
const SUMMARY = {
  modified: { es: 'modificado', en: 'modified', pt: 'modificado', nl: 'gewijzigd', da: 'ændret', pl: 'zmienione' },
  unchanged: { es: 'sin cambios', en: 'unchanged', pt: 'sem alterações', nl: 'ongewijzigd', da: 'uændret', pl: 'bez zmian' },
  settingsModified: { es: 'ajustes modificados', en: 'settings modified', pt: 'definições modificadas', nl: 'instellingen gewijzigd', da: 'indstillinger ændret', pl: 'zmienione ustawienia' },
  familyState: { es: 'también se sustituyen las estrellas y el historial', en: 'stars and history are replaced too', pt: 'as estrelas e o histórico também são substituídos', nl: 'sterren en geschiedenis worden ook vervangen', da: 'stjerner og historik erstattes også', pl: 'gwiazdki i historia też zostaną zastąpione' },
};

let plRules = null;
/** Polish count form: 0 one ("1 ekran"), 1 few ("3 ekrany", "22 ekrany"), 2 many ("5 ekranów", "12 ekranów"). */
const plForm = (n) => {
  plRules ??= new Intl.PluralRules('pl-PL');
  const c = plRules.select(n);
  return c === 'one' ? 0 : c === 'few' ? 1 : 2;
};

/** "3 pantallas" / "1 screen" / "5 ekranów" */
export function countNoun(n, noun, l) {
  const L = lang(l);
  if (L === 'pl') return `${n} ${NOUNS[noun].pl[plForm(n)]}`;
  const [one, many] = NOUNS[noun][L];
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "1 modificada" / "2 modified" / "2 modificados" / "2 gewijzigd" / "2 ændret" / "zmienione: 2" (agrees with the noun's
 * gender in es/pt; Polish puts the count after a colon, so the word does not change with it).
 */
export function countChanged(n, noun, l) {
  const L = lang(l);
  if (L === 'en') return `${n} modified`;
  if (L === 'pl') return `zmienione: ${n}`;
  if (L === 'nl') return `${n} gewijzigd`;
  if (L === 'da') return `${n} ændret`;
  const g = NOUNS[noun][L][2] === 'f' ? 'a' : 'o';
  return `${n} modificad${g}${n === 1 ? '' : 's'}`;
}

export const summaryWord = (key, l) => SUMMARY[key][lang(l)];
