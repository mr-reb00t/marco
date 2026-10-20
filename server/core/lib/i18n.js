// Server-side strings (weather descriptions, Airbnb titles, wind labels). Default language: en.
export const LANGS = ['es', 'en', 'pt', 'nl', 'da'];
export const lang = (l) => (LANGS.includes(l) ? l : 'en');

// WMO weather interpretation codes (Open-Meteo; 68 and 69 for the other providers' sleet).
const WMO = {
  0: ['Despejado', 'Clear sky', 'Céu limpo', 'Onbewolkt', 'Klart vejr'],
  1: ['Mayormente despejado', 'Mainly clear', 'Céu pouco nublado', 'Licht bewolkt', 'Overvejende klart'],
  2: ['Parcialmente nublado', 'Partly cloudy', 'Parcialmente nublado', 'Half bewolkt', 'Delvis skyet'],
  3: ['Nublado', 'Overcast', 'Encoberto', 'Zwaar bewolkt', 'Overskyet'],
  45: ['Niebla', 'Fog', 'Nevoeiro', 'Mist', 'Tåge'],
  48: ['Niebla con escarcha', 'Depositing rime fog', 'Nevoeiro com geada', 'Mist met rijp', 'Rimtåge'],
  51: ['Llovizna ligera', 'Light drizzle', 'Chuvisco fraco', 'Lichte motregen', 'Let støvregn'],
  53: ['Llovizna', 'Drizzle', 'Chuvisco', 'Motregen', 'Støvregn'],
  55: ['Llovizna intensa', 'Dense drizzle', 'Chuvisco forte', 'Zware motregen', 'Kraftig støvregn'],
  56: ['Llovizna helada', 'Freezing drizzle', 'Chuvisco gelado', 'Aanvriezende motregen', 'Frysende støvregn'],
  57: ['Llovizna helada intensa', 'Dense freezing drizzle', 'Chuvisco gelado forte', 'Zware aanvriezende motregen', 'Kraftig frysende støvregn'],
  61: ['Lluvia ligera', 'Light rain', 'Chuva fraca', 'Lichte regen', 'Let regn'],
  63: ['Lluvia', 'Rain', 'Chuva', 'Regen', 'Regn'],
  65: ['Lluvia intensa', 'Heavy rain', 'Chuva forte', 'Zware regen', 'Kraftig regn'],
  66: ['Lluvia helada', 'Freezing rain', 'Chuva gelada', 'IJzel', 'Frysende regn'],
  67: ['Lluvia helada intensa', 'Heavy freezing rain', 'Chuva gelada forte', 'Zware ijzel', 'Kraftig frysende regn'],
  // 68, 69: rain and snow mixed (WMO 4677); MET Norway and Pirate Weather "sleet"
  68: ['Aguanieve', 'Sleet', 'Água-neve', 'Natte sneeuw', 'Slud'],
  69: ['Aguanieve intensa', 'Heavy sleet', 'Água-neve forte', 'Zware natte sneeuw', 'Kraftig slud'],
  71: ['Nevada ligera', 'Light snow', 'Neve fraca', 'Lichte sneeuw', 'Let sne'],
  73: ['Nevada', 'Snow', 'Neve', 'Sneeuw', 'Sne'],
  75: ['Nevada intensa', 'Heavy snow', 'Neve forte', 'Zware sneeuw', 'Kraftig sne'],
  77: ['Granizo fino', 'Snow grains', 'Grãos de neve', 'Motsneeuw', 'Kornsne'],
  80: ['Chubascos ligeros', 'Light showers', 'Aguaceiros fracos', 'Lichte buien', 'Lette byger'],
  81: ['Chubascos', 'Showers', 'Aguaceiros', 'Buien', 'Byger'],
  82: ['Chubascos fuertes', 'Violent showers', 'Aguaceiros fortes', 'Zware buien', 'Kraftige byger'],
  85: ['Chubascos de nieve', 'Snow showers', 'Aguaceiros de neve', 'Sneeuwbuien', 'Snebyger'],
  86: ['Chubascos de nieve fuertes', 'Heavy snow showers', 'Aguaceiros de neve fortes', 'Zware sneeuwbuien', 'Kraftige snebyger'],
  95: ['Tormenta', 'Thunderstorm', 'Trovoada', 'Onweer', 'Tordenvejr'],
  96: ['Tormenta con granizo', 'Thunderstorm with hail', 'Trovoada com granizo', 'Onweer met hagel', 'Torden med hagl'],
  99: ['Tormenta con granizo fuerte', 'Thunderstorm with heavy hail', 'Trovoada com granizo forte', 'Onweer met zware hagel', 'Torden med kraftigt hagl'],
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
};

export function windDirLabel(deg, l) {
  if (deg == null || Number.isNaN(+deg)) return '';
  const i = Math.round((((+deg % 360) + 360) % 360) / 45) % 8;
  return DIRS[lang(l)][i];
}

const STRINGS = {
  reservation: { es: 'Reserva', en: 'Reservation', pt: 'Reserva', nl: 'Reservering', da: 'Reservation' },
  busy: { es: 'Ocupado', en: 'Busy', pt: 'Ocupado', nl: 'Bezet', da: 'Optaget' },
  blocked: { es: 'No disponible', en: 'Not available', pt: 'Indisponível', nl: 'Niet beschikbaar', da: 'Ikke ledig' },
  untitled: { es: '(Sin título)', en: '(No title)', pt: '(Sem título)', nl: '(Geen titel)', da: '(Uden titel)' },
  // the Spotify callback opened on the server itself in paste mode (routes/spotify.js)
  spotifyPaste: {
    es: 'Copia la dirección de esta página y pégala en la página Spotify del panel de Marco.',
    en: 'Copy the address of this page and paste it on the Spotify page of the Marco admin.',
    pt: 'Copie o endereço desta página e cole-o na página Spotify da administração do Marco.',
    nl: 'Kopieer het adres van deze pagina en plak het op de Spotify-pagina van het Marco-beheer.',
    da: 'Kopiér adressen på denne side, og indsæt den på Spotify-siden i Marcos administration.',
  },
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

// Import-preview summaries (server/core/backupsCore.js). Nouns: [one, many, grammatical gender ('f'|'m')].
const NOUNS = {
  screen: { es: ['pantalla', 'pantallas', 'f'], en: ['screen', 'screens'], pt: ['ecrã', 'ecrãs', 'm'], nl: ['scherm', 'schermen'], da: ['skærm', 'skærme'] },
  source: { es: ['fuente', 'fuentes', 'f'], en: ['source', 'sources'], pt: ['fonte', 'fontes', 'f'], nl: ['bron', 'bronnen'], da: ['kilde', 'kilder'] },
  feed: { es: ['feed', 'feeds', 'm'], en: ['feed', 'feeds'], pt: ['feed', 'feeds', 'm'], nl: ['feed', 'feeds'], da: ['feed', 'feeds'] },
  item: { es: ['elemento', 'elementos', 'm'], en: ['item', 'items'], pt: ['elemento', 'elementos', 'm'], nl: ['item', 'items'], da: ['element', 'elementer'] },
  iconRule: { es: ['regla de iconos', 'reglas de iconos', 'f'], en: ['icon rule', 'icon rules'], pt: ['regra de ícones', 'regras de ícones', 'f'], nl: ['pictogramregel', 'pictogramregels'], da: ['ikonregel', 'ikonregler'] },
  member: { es: ['miembro', 'miembros', 'm'], en: ['member', 'members'], pt: ['membro', 'membros', 'm'], nl: ['gezinslid', 'gezinsleden'], da: ['medlem', 'medlemmer'] },
  chore: { es: ['rutina', 'rutinas', 'f'], en: ['routine', 'routines'], pt: ['rotina', 'rotinas', 'f'], nl: ['routine', 'routines'], da: ['rutine', 'rutiner'] },
  reward: { es: ['premio', 'premios', 'm'], en: ['reward', 'rewards'], pt: ['prémio', 'prémios', 'm'], nl: ['beloning', 'beloningen'], da: ['belønning', 'belønninger'] },
};
const SUMMARY = {
  modified: { es: 'modificado', en: 'modified', pt: 'modificado', nl: 'gewijzigd', da: 'ændret' },
  unchanged: { es: 'sin cambios', en: 'unchanged', pt: 'sem alterações', nl: 'ongewijzigd', da: 'uændret' },
  settingsModified: { es: 'ajustes modificados', en: 'settings modified', pt: 'definições modificadas', nl: 'instellingen gewijzigd', da: 'indstillinger ændret' },
  familyState: { es: 'también se sustituyen las estrellas y el historial', en: 'stars and history are replaced too', pt: 'as estrelas e o histórico também são substituídos', nl: 'sterren en geschiedenis worden ook vervangen', da: 'stjerner og historik erstattes også' },
};

/** "3 pantallas" / "1 screen" */
export function countNoun(n, noun, l) {
  const [one, many] = NOUNS[noun][lang(l)];
  return `${n} ${n === 1 ? one : many}`;
}

/** "1 modificada" / "2 modified" / "2 modificados" / "2 gewijzigd" / "2 ændret" (agrees with the noun's gender in es/pt). */
export function countChanged(n, noun, l) {
  const L = lang(l);
  if (L === 'en') return `${n} modified`;
  if (L === 'nl') return `${n} gewijzigd`;
  if (L === 'da') return `${n} ændret`;
  const g = NOUNS[noun][L][2] === 'f' ? 'a' : 'o';
  return `${n} modificad${g}${n === 1 ? '' : 's'}`;
}

export const summaryWord = (key, l) => SUMMARY[key][lang(l)];
