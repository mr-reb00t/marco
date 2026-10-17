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
    const stripped = out.replace(BIRTHDAY_PREFIX_RE, '');
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

const BLOCKED_RE = /not available|unavailable|no disponible|indispon[ií]vel|bloque|blocked|closed|cerrado|fechado|niet beschikbaar|geblokkeerd|gesloten|ikke tilgængelig|ikke ledig|blokeret/i;
const KEYWORD_RE = /\b(airbnb|reserved|reservation|reserva(?:do|da)?|booking(?:\.com)?|booked|vrbo|check[- ]?in|stay|reservering|gereserveerd|boeking|geboekt|reserveret|booket)\b/gi;
const GUEST_LINE_RE = /^\s*(?:guest(?:\s*name)?|hu[eé]sped(?:es)?|h[oó]spede|name|nombre|nome|cliente|gast(?:en)?|naam|gæst(?:er)?|navn)\s*[:=-]\s*(.+?)\s*$/im;

/**
 * Normalise Airbnb / vacation-rental titles: "Reserved" → "Reserva", "Airbnb (Not available)" → "No disponible",
 * keeping the guest name when the feed provides it (in the title or a "Guest: …" description line).
 * Returns { title, blocked }.
 */
const LEADING_EMOJI_RE = /^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Regional_Indicator})*)\s*/u;

const icons = (n, em, max = 4) => (n <= 0 ? '' : n <= max ? em.repeat(n) : `${em}×${n}`);

/** "Adultos: 2 / Niños: 1 / Bebés: 0 / Mascotas: 1" lines in an AL-app event description (any of es/en/pt/nl/da). */
export function guestBreakdown(description) {
  const d = String(description ?? '');
  const num = (re) => { const m = re.exec(d); return m ? Number(m[1]) : null; };
  return {
    adults: num(/^\s*(?:adultos|adults|volwassenen|voksne)\s*:\s*(\d+)/im),
    children: num(/^\s*(?:ni[ñn]os|children|crian[çc]as|kinderen|børn)\s*:\s*(\d+)/im),
    infants: num(/^\s*(?:beb[eé]s|infants|baby['’]?s|babyer)\s*:\s*(\d+)/im),
    pets: num(/^\s*(?:mascotas|pets|animais|huisdieren|kæledyr)\s*:\s*(\d+)/im),
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
// Translate the common ones (Portugal, Spain, the Netherlands, Belgium, Denmark and general) for holiday-kind sources.
// Columns: [es, pt, nl, da].
const HOLIDAYS = {
  "new year's day": ['Año Nuevo', 'Ano Novo', 'Nieuwjaarsdag', 'Nytårsdag'],
  "new year's eve": ['Nochevieja', 'Véspera de Ano Novo', 'Oudejaarsavond', 'Nytårsaften'],
  'carnival': ['Carnaval', 'Carnaval', 'Carnaval', 'Fastelavn'],
  'carnival / shrove tuesday / pancake day': ['Carnaval', 'Carnaval', 'Carnaval', 'Fastelavn'],
  'shrove tuesday': ['Martes de Carnaval', 'Terça-feira de Carnaval', 'Vastenavond', 'Fastelavnstirsdag'],
  'good friday': ['Viernes Santo', 'Sexta-feira Santa', 'Goede Vrijdag', 'Langfredag'],
  'maundy thursday': ['Jueves Santo', 'Quinta-feira Santa', 'Witte Donderdag', 'Skærtorsdag'],
  'easter sunday': ['Domingo de Pascua', 'Domingo de Páscoa', 'Eerste paasdag', 'Påskedag'],
  'easter monday': ['Lunes de Pascua', 'Segunda-feira de Páscoa', 'Tweede paasdag', '2. påskedag'],
  'liberty day': ['Día de la Libertad', 'Dia da Liberdade', 'Dag van de Vrijheid', 'Frihedsdagen'],
  'labor day': ['Día del Trabajo', 'Dia do Trabalhador', 'Dag van de Arbeid', 'Arbejdernes kampdag'],
  'labour day': ['Día del Trabajo', 'Dia do Trabalhador', 'Dag van de Arbeid', 'Arbejdernes kampdag'],
  'portugal day': ['Día de Portugal', 'Dia de Portugal', 'Dag van Portugal', 'Portugals nationaldag'],
  'corpus christi': ['Corpus Christi', 'Corpo de Deus', 'Sacramentsdag', 'Kristi legemsfest'],
  'assumption of mary': ['Asunción de la Virgen', 'Assunção de Nossa Senhora', 'Maria-Tenhemelopneming', 'Marias himmelfart'],
  'assumption day': ['Asunción de la Virgen', 'Assunção de Nossa Senhora', 'Maria-Tenhemelopneming', 'Marias himmelfart'],
  'republic day': ['Día de la República', 'Implantação da República', 'Dag van de Republiek', 'Republikkens dag'],
  "all saints' day": ['Todos los Santos', 'Dia de Todos os Santos', 'Allerheiligen', 'Allehelgensdag'],
  'restoration of independence': ['Restauración de la Independencia', 'Restauração da Independência', 'Herstel van de Onafhankelijkheid', 'Genoprettelse af uafhængigheden'],
  'feast of the immaculate conception': ['Inmaculada Concepción', 'Imaculada Conceição', 'Onbevlekte Ontvangenis', 'Marias ubesmittede undfangelse'],
  'immaculate conception': ['Inmaculada Concepción', 'Imaculada Conceição', 'Onbevlekte Ontvangenis', 'Marias ubesmittede undfangelse'],
  'christmas eve': ['Nochebuena', 'Véspera de Natal', 'Kerstavond', 'Juleaften'],
  'christmas day': ['Navidad', 'Natal', 'Eerste kerstdag', 'Juledag'],
  "st. anthony's day": ['San Antonio', 'Santo António', 'Sint-Antonius', 'Sankt Antonius’ dag'],
  "st. john's day": ['San Juan', 'São João', 'Sint-Jan', 'Sankthansdag'],
  "mother's day": ['Día de la Madre', 'Dia da Mãe', 'Moederdag', 'Mors dag'],
  "father's day": ['Día del Padre', 'Dia do Pai', 'Vaderdag', 'Fars dag'],
  "valentine's day": ['San Valentín', 'Dia dos Namorados', 'Valentijnsdag', 'Valentinsdag'],
  'epiphany': ['Reyes', 'Dia de Reis', 'Driekoningen', 'Helligtrekonger'],
  'daylight saving time starts': ['Cambio a horario de verano', 'Início da hora de verão', 'Zomertijd gaat in', 'Sommertid begynder'],
  'daylight saving time ends': ['Cambio a horario de invierno', 'Fim da hora de verão', 'Wintertijd gaat in', 'Sommertid slutter'],
  'national day of spain': ['Fiesta Nacional de España', 'Dia Nacional de Espanha', 'Nationale feestdag van Spanje', 'Spaniens nationaldag'],
  'constitution day': ['Día de la Constitución', 'Dia da Constituição', 'Dag van de Grondwet', 'Grundlovsdag'],
  // Netherlands (en.dutch) and Belgium (en.be) feeds
  'ascension day': ['Día de la Ascensión', 'Dia da Ascensão', 'Hemelvaartsdag', 'Kristi himmelfartsdag'],
  'day after ascension day': ['Día después de la Ascensión', 'Dia a seguir à Ascensão', 'Dag na Hemelvaart', 'Dagen efter Kristi himmelfart'],
  "king's birthday": ['Día del Rey', 'Dia do Rei', 'Koningsdag', 'Kongens fødselsdag'],
  'liberation day': ['Día de la Liberación', 'Dia da Libertação', 'Bevrijdingsdag', 'Befrielsesdagen'],
  'keti koti': ['Keti Koti', 'Keti Koti', 'Keti Koti', 'Keti Koti'],
  'whit sunday': ['Domingo de Pentecostés', 'Domingo de Pentecostes', 'Eerste pinksterdag', 'Pinsedag'],
  'whit monday': ['Lunes de Pentecostés', 'Segunda-feira de Pentecostes', 'Tweede pinksterdag', '2. pinsedag'],
  "st nicholas' eve/sinterklaas": ['Víspera de San Nicolás', 'Véspera de São Nicolau', 'Sinterklaasavond', 'Sinterklaas'],
  'st. nicholas day': ['San Nicolás', 'São Nicolau', 'Sinterklaas', 'Sankt Nikolaus’ dag'],
  'second day of christmas': ['San Esteban', 'Segundo dia de Natal', 'Tweede kerstdag', '2. juledag'],
  'boxing day': ['San Esteban', 'Segundo dia de Natal', 'Tweede kerstdag', '2. juledag'],
  'belgian national day': ['Fiesta Nacional de Bélgica', 'Dia Nacional da Bélgica', 'Nationale feestdag van België', 'Belgiens nationaldag'],
  'armistice day': ['Día del Armisticio', 'Dia do Armistício', 'Wapenstilstand', 'Våbenstilstandsdagen'],
  'halloween': ['Halloween', 'Halloween', 'Halloween', 'Halloween'],
  // Denmark (en.danish) feed
  '2nd christmas day': ['San Esteban', 'Segundo dia de Natal', 'Tweede kerstdag', '2. juledag'],
  'great prayer day': ['Gran Día de Oración', 'Grande Dia de Oração', 'Grote Gebedsdag', 'Store bededag'],
  'palm sunday': ['Domingo de Ramos', 'Domingo de Ramos', 'Palmzondag', 'Palmesøndag'],
  'bank holiday': ['Festivo bancario', 'Feriado bancário', 'Bankfeestdag', 'Bankhelligdag'],
  'accession of king frederik x': ['Subida al trono de Federico X', 'Subida ao trono de Frederico X', 'Troonsbestijging van koning Frederik X', "Kong Frederik X's tronbestigelse"],
};

const HOLIDAY_COL = { es: 0, pt: 1, nl: 2, da: 3 };

export function translateHoliday(title, lang) {
  const col = HOLIDAY_COL[lang];
  if (col === undefined) return title;
  // en.be and en.danish write "Father’s Day" with a curly apostrophe; the keys use a straight one.
  const key = String(title).trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s*\(.*\)\s*$/, '');
  const hit = HOLIDAYS[key];
  return hit ? hit[col] : title;
}
