// Icon/colour rules and calendar-kind normalisation (pure functions; unit-tested).
import { fold } from './lib/text.js';
import { t } from './core/lib/i18n.js';
import { keywordMatches } from './lib/keywords.js';

export const KIND_EMOJI = { airbnb: '🏠', birthdays: '🎂', holidays: '🎉' };

// Keyword matching (whole words for short keywords) lives in lib/keywords.js, shared with the admin preview.
export { keywordMatches };

// Google public holiday feeds append "To hide observances, go to … > Holidays in Portugal" to every observance,
// which would otherwise match the "holiday" (vacation) keyword.
const BOILERPLATE_RE = /to hide observances[\s\S]*$/i;
export const cleanDescription = (d) => String(d ?? '').replace(BOILERPLATE_RE, '');

/** First rule (in order) whose keywords match title + description, or null. */
export function matchRule(rules, title, description = '') {
  const text = fold(`${title ?? ''}\n${cleanDescription(description)}`);
  for (const r of rules || []) {
    if ((r.match || []).some((k) => keywordMatches(text, k))) return r;
  }
  return null;
}

/** Emoji: rule > source.emoji > kind default > ''. Color: rule.color > source.color. */
export function decorate(rules, source, title, description) {
  const rule = matchRule(rules, title, description);
  return {
    emoji: (rule && rule.emoji) || source.emoji || KIND_EMOJI[source.kind] || '',
    color: (rule && rule.color) || source.color,
    rule,
  };
}

const BIRTHDAY_PREFIX_RE = /^\s*(?:feliz\s+)?(?:cumplea[ñn]os|cumple|cumpleanos|birthday|b-?day|anivers[aá]rio|aniversario|aniversari|verjaardag|jarig|fødselsdag)\b\s*(?:(?:del?|do|da|of|van|for)\s+)?[:\-–·]?\s*/iu;
// Polish puts the name after "Urodziny" in the genitive ("Urodziny Ani"), so the word only goes when a separator follows
// it ("Urodziny: Ania", "Urodziny - Ania").
const BIRTHDAY_PREFIX_PL_RE = /^\s*urodziny\s*[:\-–·]\s*/iu;
const BIRTHDAY_SUFFIX_RE = /^(.+?)(?:'s|’s|'|’)?\s+(?:birthday|b-?day|cumple(?:años)?|anivers[aá]rio|verjaardag|(?:is\s+)?jarig|fødselsdag)\s*$/iu;

/** "MARÍA LÓPEZ" → "María López" (all-caps titles are much wider on screen). Short words stay lowercase. */
export function unshout(title) {
  const letters = title.replace(/[^\p{L}]/gu, '');
  if (letters.length < 4 || letters !== letters.toUpperCase() || letters === letters.toLowerCase()) return title;
  return title.toLowerCase().replace(/(^|[\s\-/(·])(\p{L})(\p{L}*)/gu, (m, sep, a, rest, off) =>
    (off > 0 && rest.length < 3 && /^(de|do|da|y|e|o|a|van|der|den|het|ten|ter)$/.test(a + rest)) ? m : sep + a.toUpperCase() + rest);
}

/**
 * Display title clean-up: un-shout ALL-CAPS titles and, when the emoji already says it (🎂 rules or
 * birthday-kind sources), drop the redundant "Cumple de"/"Birthday" words so only the name remains.
 * `birthdayNames: false` (config birthdays.tidyTitles off) keeps the birthday words: only the un-shouting is left.
 * Returns { title, why }: why = 'birthday' (the birthday words went), 'caps' (only un-shouted) or null (unchanged).
 */
export function tidyTitleWhy(title, { rule, source, emoji, birthdayNames = true } = {}) {
  const raw = String(title ?? '').trim();
  let out = unshout(raw);
  const caps = out !== raw;
  const isBirthday = emoji === '🎂' || source?.kind === 'birthdays' || (rule && rule.emoji === '🎂');
  let birthday = false;
  if (isBirthday && birthdayNames) {
    const before = out;
    const stripped = out.replace(BIRTHDAY_PREFIX_RE, '').replace(BIRTHDAY_PREFIX_PL_RE, '');
    if (stripped !== out && /\p{L}/u.test(stripped)) out = stripped;
    else {
      const m = BIRTHDAY_SUFFIX_RE.exec(out);
      if (m && /\p{L}/u.test(m[1])) out = m[1];
    }
    out = out.charAt(0).toUpperCase() + out.slice(1);
    birthday = out !== before;
  }
  return { title: out, why: birthday ? 'birthday' : caps ? 'caps' : null };
}

export function tidyTitle(title, opts = {}) {
  return tidyTitleWhy(title, opts).title;
}

const BLOCKED_RE = /not available|unavailable|no disponible|indispon[ií]vel|bloque|blocked|closed|cerrado|fechado|niet beschikbaar|geblokkeerd|gesloten|ikke tilgængelig|ikke ledig|blokeret|niedostępn|zablokowan/i;
const KEYWORD_RE = /\b(airbnb|reserved|reservation|reserva(?:do|da)?|booking(?:\.com)?|booked|vrbo|check[- ]?in|stay|reservering|gereserveerd|boeking|geboekt|reserveret|booket|rezerwacja|zarezerwowan[eya])\b/gi;
const GUEST_LINE_RE = /^\s*(?:guest(?:\s*name)?|hu[eé]sped(?:es)?|h[oó]spede|name|nombre|nome|cliente|gast(?:en)?|naam|gæst(?:er)?|navn|go[śs][ćc]|go[śs]cie|imi[ęe])\s*[:=-]\s*(.+?)\s*$/im;

/**
 * Normalise Airbnb / vacation-rental titles: "Reserved" → "Reserva", "Airbnb (Not available)" → "No disponible",
 * keeping the guest name when the feed provides it (in the title or a "Guest: …" description line).
 * Returns { title, blocked }.
 */
const LEADING_EMOJI_RE = /^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Regional_Indicator})*)\s*/u;

const icons = (n, em, max = 4) => (n <= 0 ? '' : n <= max ? em.repeat(n) : `${em}×${n}`);

/** "Adultos: 2 / Niños: 1 / Bebés: 0 / Mascotas: 1" lines in an AL-app event description (any of es/en/pt/nl/da/pl). */
export function guestBreakdown(description) {
  const d = String(description ?? '');
  const num = (re) => { const m = re.exec(d); return m ? Number(m[1]) : null; };
  return {
    adults: num(/^\s*(?:adultos|adults|volwassenen|voksne|doro[śs]li)\s*:\s*(\d+)/im),
    children: num(/^\s*(?:ni[ñn]os|children|crian[çc]as|kinderen|børn|dzieci)\s*:\s*(\d+)/im),
    infants: num(/^\s*(?:beb[eé]s|infants|baby['’]?s|babyer|niemowl[ęe]ta)\s*:\s*(\d+)/im),
    pets: num(/^\s*(?:mascotas|pets|animais|huisdieren|kæledyr|zwierz[ęe]ta)\s*:\s*(\d+)/im),
  };
}

/**
 * Guest counts as icons (format used by some property-management tools): "4p+1m" (p = personas, m = mascotas) → "🧑🧑🧑🧑 🐶". When the description
 * carries the breakdown (Adultos/Niños/Bebés), adults 🧑🏻, children 🧒🏻 and babies 👶🏻 (light skin tone) are told apart.
 * More than 4 of a kind → "🧑×6".
 */
export function petsToEmoji(text, description = '') {
  const b = guestBreakdown(description);
  const people = b.adults != null
    ? [icons(b.adults, '🧑🏻'), icons(b.children ?? 0, '🧒🏻'), icons(b.infants ?? 0, '👶🏻')].filter(Boolean).join(' ')
    : null;
  return String(text)
    .replace(/\b(\d+)\s*p\b/gi, (_, n) => people ?? icons(Number(n), '🧑🏻'))
    .replace(/\s*\+?\s*\b(\d+)\s*m\b/gi, (_, n) => { const k = icons(Number(n), '🐶', 3); return k ? ' ' + k : ''; })
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAirbnbTitle(title, description, lang) {
  let raw = String(title ?? '').trim();
  if (BLOCKED_RE.test(raw)) return { title: t('blocked', lang), blocked: true, emoji: '' };
  // Some property-management tools already format titles as "🏠 Guest Name - 2p" / "🚪 Guest Name":
  // keep their emoji as the event emoji and the rest of the title verbatim.
  const em = LEADING_EMOJI_RE.exec(raw);
  const emoji = em ? em[1] : '';
  if (em) raw = raw.slice(em[0].length).trim();
  if (emoji && raw && !KEYWORD_RE.test(raw)) {
    KEYWORD_RE.lastIndex = 0;
    return { title: petsToEmoji(raw.replace(/\s+-\s+/g, ' · '), description).slice(0, 120), blocked: false, emoji };
  }
  KEYWORD_RE.lastIndex = 0;
  let guest = '';
  const m = GUEST_LINE_RE.exec(String(description ?? ''));
  if (m && /\p{L}/u.test(m[1])) guest = m[1];
  if (!guest) {
    guest = raw
      .replace(KEYWORD_RE, ' ')
      .replace(/\b(HM[A-Z0-9]{6,}|[A-Z0-9]{10,})\b/g, ' ') // confirmation codes
      .replace(/\(\s*\)|\[\s*\]/g, ' ')
      .replace(/^[\s:·|/,\u2013\u2014-]+|[\s:·|/,\u2013\u2014-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  guest = guest.replace(/https?:\/\/\S+/g, '').trim().slice(0, 60);
  const base = t('reservation', lang);
  return { title: guest && /\p{L}/u.test(guest) ? `${base} · ${guest}` : base, blocked: false, emoji };
}

// Google's public holiday ICS feeds ignore the language prefix and always return English titles.
// Translate the common ones (Portugal, Spain, the Netherlands, Belgium, Denmark, Poland and general) for holiday-kind
// sources. Columns: [es, pt, nl, da, pl].
const HOLIDAYS = {
  "new year's day": ['Año Nuevo', 'Ano Novo', 'Nieuwjaarsdag', 'Nytårsdag', 'Nowy Rok'],
  "new year's eve": ['Nochevieja', 'Véspera de Ano Novo', 'Oudejaarsavond', 'Nytårsaften', 'Sylwester'],
  'carnival': ['Carnaval', 'Carnaval', 'Carnaval', 'Fastelavn', 'Karnawał'],
  'carnival / shrove tuesday / pancake day': ['Carnaval', 'Carnaval', 'Carnaval', 'Fastelavn', 'Karnawał'],
  'shrove tuesday': ['Martes de Carnaval', 'Terça-feira de Carnaval', 'Vastenavond', 'Fastelavnstirsdag', 'Ostatki'],
  'good friday': ['Viernes Santo', 'Sexta-feira Santa', 'Goede Vrijdag', 'Langfredag', 'Wielki Piątek'],
  'maundy thursday': ['Jueves Santo', 'Quinta-feira Santa', 'Witte Donderdag', 'Skærtorsdag', 'Wielki Czwartek'],
  'easter sunday': ['Domingo de Pascua', 'Domingo de Páscoa', 'Eerste paasdag', 'Påskedag', 'Wielkanoc'],
  'easter monday': ['Lunes de Pascua', 'Segunda-feira de Páscoa', 'Tweede paasdag', '2. påskedag', 'Poniedziałek Wielkanocny'],
  'liberty day': ['Día de la Libertad', 'Dia da Liberdade', 'Dag van de Vrijheid', 'Frihedsdagen', 'Dzień Wolności'],
  'labor day': ['Día del Trabajo', 'Dia do Trabalhador', 'Dag van de Arbeid', 'Arbejdernes kampdag', 'Święto Pracy'],
  'labour day': ['Día del Trabajo', 'Dia do Trabalhador', 'Dag van de Arbeid', 'Arbejdernes kampdag', 'Święto Pracy'],
  'portugal day': ['Día de Portugal', 'Dia de Portugal', 'Dag van Portugal', 'Portugals nationaldag', 'Dzień Portugalii'],
  'corpus christi': ['Corpus Christi', 'Corpo de Deus', 'Sacramentsdag', 'Kristi legemsfest', 'Boże Ciało'],
  'assumption of mary': ['Asunción de la Virgen', 'Assunção de Nossa Senhora', 'Maria-Tenhemelopneming', 'Marias himmelfart', 'Wniebowzięcie NMP'],
  'assumption day': ['Asunción de la Virgen', 'Assunção de Nossa Senhora', 'Maria-Tenhemelopneming', 'Marias himmelfart', 'Wniebowzięcie NMP'],
  'republic day': ['Día de la República', 'Implantação da República', 'Dag van de Republiek', 'Republikkens dag', 'Dzień Republiki'],
  "all saints' day": ['Todos los Santos', 'Dia de Todos os Santos', 'Allerheiligen', 'Allehelgensdag', 'Wszystkich Świętych'],
  'restoration of independence': ['Restauración de la Independencia', 'Restauração da Independência', 'Herstel van de Onafhankelijkheid', 'Genoprettelse af uafhængigheden', 'Dzień Przywrócenia Niepodległości'],
  'feast of the immaculate conception': ['Inmaculada Concepción', 'Imaculada Conceição', 'Onbevlekte Ontvangenis', 'Marias ubesmittede undfangelse', 'Niepokalane Poczęcie'],
  'immaculate conception': ['Inmaculada Concepción', 'Imaculada Conceição', 'Onbevlekte Ontvangenis', 'Marias ubesmittede undfangelse', 'Niepokalane Poczęcie'],
  'christmas eve': ['Nochebuena', 'Véspera de Natal', 'Kerstavond', 'Juleaften', 'Wigilia'],
  'christmas day': ['Navidad', 'Natal', 'Eerste kerstdag', 'Juledag', 'Boże Narodzenie'],
  "st. anthony's day": ['San Antonio', 'Santo António', 'Sint-Antonius', 'Sankt Antonius’ dag', 'Dzień św. Antoniego'],
  "st. john's day": ['San Juan', 'São João', 'Sint-Jan', 'Sankthansdag', 'Dzień św. Jana'],
  "mother's day": ['Día de la Madre', 'Dia da Mãe', 'Moederdag', 'Mors dag', 'Dzień Matki'],
  "father's day": ['Día del Padre', 'Dia do Pai', 'Vaderdag', 'Fars dag', 'Dzień Ojca'],
  "valentine's day": ['San Valentín', 'Dia dos Namorados', 'Valentijnsdag', 'Valentinsdag', 'Walentynki'],
  'epiphany': ['Reyes', 'Dia de Reis', 'Driekoningen', 'Helligtrekonger', 'Trzech Króli'],
  'daylight saving time starts': ['Cambio a horario de verano', 'Início da hora de verão', 'Zomertijd gaat in', 'Sommertid begynder', 'Zmiana czasu na letni'],
  'daylight saving time ends': ['Cambio a horario de invierno', 'Fim da hora de verão', 'Wintertijd gaat in', 'Sommertid slutter', 'Zmiana czasu na zimowy'],
  'national day of spain': ['Fiesta Nacional de España', 'Dia Nacional de Espanha', 'Nationale feestdag van Spanje', 'Spaniens nationaldag', 'Święto Narodowe Hiszpanii'],
  'constitution day': ['Día de la Constitución', 'Dia da Constituição', 'Dag van de Grondwet', 'Grundlovsdag', 'Święto Konstytucji'],
  // Netherlands (en.dutch) and Belgium (en.be) feeds
  'ascension day': ['Día de la Ascensión', 'Dia da Ascensão', 'Hemelvaartsdag', 'Kristi himmelfartsdag', 'Wniebowstąpienie'],
  'day after ascension day': ['Día después de la Ascensión', 'Dia a seguir à Ascensão', 'Dag na Hemelvaart', 'Dagen efter Kristi himmelfart', 'Dzień po Wniebowstąpieniu'],
  "king's birthday": ['Día del Rey', 'Dia do Rei', 'Koningsdag', 'Kongens fødselsdag', 'Dzień Króla'],
  'liberation day': ['Día de la Liberación', 'Dia da Libertação', 'Bevrijdingsdag', 'Befrielsesdagen', 'Dzień Wyzwolenia'],
  'keti koti': ['Keti Koti', 'Keti Koti', 'Keti Koti', 'Keti Koti', 'Keti Koti'],
  'whit sunday': ['Domingo de Pentecostés', 'Domingo de Pentecostes', 'Eerste pinksterdag', 'Pinsedag', 'Zielone Świątki'],
  'whit monday': ['Lunes de Pentecostés', 'Segunda-feira de Pentecostes', 'Tweede pinksterdag', '2. pinsedag', 'Drugi dzień Zielonych Świątek'],
  "st nicholas' eve/sinterklaas": ['Víspera de San Nicolás', 'Véspera de São Nicolau', 'Sinterklaasavond', 'Sinterklaas', 'Wigilia św. Mikołaja'],
  'st. nicholas day': ['San Nicolás', 'São Nicolau', 'Sinterklaas', 'Sankt Nikolaus’ dag', 'Mikołajki'],
  'second day of christmas': ['San Esteban', 'Segundo dia de Natal', 'Tweede kerstdag', '2. juledag', 'Drugi dzień świąt'],
  'boxing day': ['San Esteban', 'Segundo dia de Natal', 'Tweede kerstdag', '2. juledag', 'Drugi dzień świąt'],
  'belgian national day': ['Fiesta Nacional de Bélgica', 'Dia Nacional da Bélgica', 'Nationale feestdag van België', 'Belgiens nationaldag', 'Święto Narodowe Belgii'],
  'armistice day': ['Día del Armisticio', 'Dia do Armistício', 'Wapenstilstand', 'Våbenstilstandsdagen', 'Dzień Zawieszenia Broni'],
  'halloween': ['Halloween', 'Halloween', 'Halloween', 'Halloween', 'Halloween'],
  // Denmark (en.danish) feed
  '2nd christmas day': ['San Esteban', 'Segundo dia de Natal', 'Tweede kerstdag', '2. juledag', 'Drugi dzień świąt'],
  'great prayer day': ['Gran Día de Oración', 'Grande Dia de Oração', 'Grote Gebedsdag', 'Store bededag', 'Wielki Dzień Modlitwy'],
  'palm sunday': ['Domingo de Ramos', 'Domingo de Ramos', 'Palmzondag', 'Palmesøndag', 'Niedziela Palmowa'],
  'bank holiday': ['Festivo bancario', 'Feriado bancário', 'Bankfeestdag', 'Bankhelligdag', 'Dzień wolny od pracy'],
  'accession of king frederik x': ['Subida al trono de Federico X', 'Subida ao trono de Frederico X', 'Troonsbestijging van koning Frederik X', "Kong Frederik X's tronbestigelse", 'Wstąpienie na tron króla Fryderyka X'],
  // Poland (en.polish) feed
  'independence day': ['Día de la Independencia', 'Dia da Independência', 'Onafhankelijkheidsdag', 'Uafhængighedsdag', 'Święto Niepodległości'],
  'national independence day': ['Día de la Independencia', 'Dia da Independência', 'Onafhankelijkheidsdag', 'Uafhængighedsdag', 'Narodowe Święto Niepodległości'],
  'may 3rd constitution day': ['Día de la Constitución de Polonia', 'Dia da Constituição da Polónia', 'Poolse Grondwetsdag', 'Polens grundlovsdag', 'Święto Konstytucji 3 Maja'],
  'pentecost sunday': ['Domingo de Pentecostés', 'Domingo de Pentecostes', 'Eerste pinksterdag', 'Pinsedag', 'Zielone Świątki'],
  'pentecost': ['Domingo de Pentecostés', 'Domingo de Pentecostes', 'Eerste pinksterdag', 'Pinsedag', 'Zielone Świątki'],
  'polish armed forces day': ['Día de las Fuerzas Armadas de Polonia', 'Dia das Forças Armadas da Polónia', 'Dag van de Poolse strijdkrachten', 'Polens forsvarsdag', 'Święto Wojska Polskiego'],
  'armed forces day': ['Día de las Fuerzas Armadas', 'Dia das Forças Armadas', 'Dag van de strijdkrachten', 'Forsvarets dag', 'Dzień Sił Zbrojnych'],
  "all souls' day": ['Día de Difuntos', 'Dia de Finados', 'Allerzielen', 'Allesjælesdag', 'Zaduszki'],
  'fat thursday': ['Jueves Lardero', 'Quinta-feira Gorda', 'Vette Donderdag', 'Fede torsdag', 'Tłusty czwartek'],
  "women's day": ['Día de la Mujer', 'Dia da Mulher', 'Vrouwendag', 'Kvindernes internationale kampdag', 'Dzień Kobiet'],
  "international women's day": ['Día de la Mujer', 'Dia da Mulher', 'Vrouwendag', 'Kvindernes internationale kampdag', 'Dzień Kobiet'],
  "children's day": ['Día del Niño', 'Dia da Criança', 'Kinderdag', 'Børnenes dag', 'Dzień Dziecka'],
  "grandmother's day": ['Día de la Abuela', 'Dia da Avó', 'Grootmoedersdag', 'Bedstemors dag', 'Dzień Babci'],
  "grandfather's day": ['Día del Abuelo', 'Dia do Avô', 'Grootvadersdag', 'Bedstefars dag', 'Dzień Dziadka'],
  "st. andrew's eve": ['Víspera de San Andrés', 'Véspera de Santo André', 'Sint-Andriesavond', 'Sankt Andreas’ aften', 'Andrzejki'],
};

const HOLIDAY_COL = { es: 0, pt: 1, nl: 2, da: 3, pl: 4 };

export function translateHoliday(title, lang) {
  const col = HOLIDAY_COL[lang];
  if (col === undefined) return title;
  // en.be and en.danish write "Father’s Day" with a curly apostrophe; the keys use a straight one.
  const key = String(title).trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s*\(.*\)\s*$/, '');
  const hit = HOLIDAYS[key];
  return hit ? hit[col] : title;
}
