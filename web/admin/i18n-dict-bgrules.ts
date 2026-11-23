// "Fondos especiales" (#14): the special background rules of a screen (Fondo page) and their gallery picker. Admin
// text keyed by the Spanish string t() takes. Each row is [es, en, pt, nl, da, de]. ROWS_BGRULES feeds EN and PT
// (i18n-dict.ts); NL_BGRULES and DA_BGRULES are spread into NL and DA.
const ROWS: [string, string, string, string, string, string][] = [
  ['Fondos especiales', 'Special backgrounds', 'Fundos especiais', 'Speciale achtergronden', 'Særlige baggrunde', 'Besondere Hintergründe'],
  [
    'Otras fotos en fechas señaladas o cuando hay cierto evento. Gana la primera regla que coincide; si ninguna coincide, se usa el fondo normal.',
    'Other photos on special dates or when there is a certain event. The first rule that matches wins; when none matches, the normal background shows.',
    'Outras fotos em datas especiais ou quando há um certo evento. Ganha a primeira regra que coincide; se nenhuma coincidir, usa-se o fundo normal.',
    'Andere foto’s op bijzondere datums of als er een bepaalde afspraak is. De eerste regel die past wint; past er geen, dan de gewone achtergrond.',
    'Andre billeder på særlige datoer, eller når der er en bestemt begivenhed. Den første regel, der passer, vinder; passer ingen, vises den normale baggrund.',
    'Andere Fotos an bestimmten Tagen oder wenn ein bestimmter Termin ansteht. Die erste passende Regel gewinnt; passt keine, gilt der normale Hintergrund.',
  ],
  ['Añadir regla', 'Add rule', 'Adicionar regra', 'Regel toevoegen', 'Tilføj regel', 'Regel hinzufügen'],
  [
    'Por ejemplo, fotos de Navidad del 1 al 31 de diciembre, o de la playa los días con un evento «Vacaciones».',
    'For example, Christmas photos from 1 to 31 December, or beach photos on days with a “Holiday” event.',
    'Por exemplo, fotos de Natal de 1 a 31 de dezembro, ou da praia nos dias com um evento «Férias».',
    'Bijvoorbeeld kerstfoto’s van 1 tot 31 december, of strandfoto’s op dagen met een afspraak ‘Vakantie’.',
    'For eksempel julebilleder fra 1. til 31. december, eller strandbilleder på dage med en begivenhed »Ferie«.',
    'Zum Beispiel Weihnachtsfotos vom 1. bis 31. Dezember oder Strandfotos an Tagen mit einem Termin „Urlaub“.',
  ],
  ['Evento de hoy con…', 'Event today with…', 'Evento de hoje com…', 'Afspraak vandaag met…', 'Begivenhed i dag med…', 'Termin heute mit…'],
  ['Entre dos fechas', 'Between two dates', 'Entre duas datas', 'Tussen twee datums', 'Mellem to datoer', 'Zwischen zwei Daten'],
  ['Un solo día', 'A single day', 'Um só dia', 'Eén dag', 'En enkelt dag', 'Ein einzelner Tag'],
  ['Un cumpleaños', 'A birthday', 'Um aniversário', 'Een verjaardag', 'En fødselsdag', 'Ein Geburtstag'],
  ['Palabras del título, separadas por comas, p. ej. Navidad, Reyes', 'Words in the title, separated by commas, e.g. Christmas, Xmas', 'Palavras do título, separadas por vírgulas, p. ex. Natal, Reis', 'Woorden in de titel, gescheiden door komma\'s, bijv. Kerst, Sinterklaas', 'Ord i titlen, adskilt med kommaer, f.eks. Jul, Juleaften', 'Wörter im Titel, durch Kommas getrennt, z. B. Weihnachten, Heiligabend'],
  ['Calendarios de esta pantalla', 'Calendars of this screen', 'Calendários deste ecrã', 'Agenda’s van dit scherm', 'Kalendere på denne skærm', 'Kalender dieses Bildschirms'],
  ['al', 'to', 'a', 't/m', 'til', 'bis'],
  ['Cuando alguien de Cumpleaños cumple años hoy.', 'When someone in Birthdays has a birthday today.', 'Quando alguém de Aniversários faz anos hoje.', 'Als iemand uit Verjaardagen vandaag jarig is.', 'Når nogen fra Fødselsdage har fødselsdag i dag.', 'Wenn heute jemand aus Geburtstage Geburtstag hat.'],
  ['Elegir fotos', 'Choose photos', 'Escolher fotos', 'Foto’s kiezen', 'Vælg billeder', 'Fotos auswählen'],
  ['Elige un álbum', 'Choose an album', 'Escolhe um álbum', 'Kies een album', 'Vælg et album', 'Wähle ein Album'],
  ['Como siempre ({interval})', 'As usual ({interval})', 'Como sempre ({interval})', 'Zoals altijd ({interval})', 'Som altid ({interval})', 'Wie immer ({interval})'],
  ['Como siempre', 'As usual', 'Como sempre', 'Zoals altijd', 'Som altid', 'Wie immer'],
  ['Elegidas: {count} de {max}', 'Chosen: {count} of {max}', 'Escolhidas: {count} de {max}', 'Gekozen: {count} van {max}', 'Valgt: {count} af {max}', 'Ausgewählt: {count} von {max}'],
  ['No hay fotos en la galería', 'There are no photos in the gallery', 'Não há fotos na galeria', 'Er staan geen foto’s in de galerij', 'Der er ingen billeder i galleriet', 'Keine Fotos in der Galerie'],
  ['Sube fotos en Galería', 'Upload photos in Gallery', 'Carrega fotos em Galeria', 'Upload foto’s bij Galerij', 'Upload billeder under Galleri', 'Lade Fotos unter Galerie hoch'],
  ['Elige al menos una foto', 'Choose at least one photo', 'Escolhe pelo menos uma foto', 'Kies minstens één foto', 'Vælg mindst ét billede', 'Wähle mindestens ein Foto'],
  // the background's own choice of gallery photos (#47)
  ['Fotos de la galería', 'Gallery photos', 'Fotos da galeria', 'Foto’s uit de galerij', 'Billeder fra galleriet', 'Fotos aus der Galerie'],
  ['Todas en rotación', 'All in rotation', 'Todas em rotação', 'Alle in rotatie', 'Alle i rotation', 'Alle im Wechsel'],
  ['Solo las elegidas', 'Only the chosen ones', 'Só as escolhidas', 'Alleen de gekozen', 'Kun de valgte', 'Nur die ausgewählten'],
  ['Una sola foto: el fondo no cambia.', 'A single photo: the background stays the same.', 'Uma só foto: o fundo não muda.', 'Eén foto: de achtergrond blijft hetzelfde.', 'Ét billede: baggrunden forbliver den samme.', 'Ein einzelnes Foto: Der Hintergrund bleibt gleich.'],
  ['Solo pasan estas fotos.', 'Only these photos are shown.', 'Só passam estas fotos.', 'Alleen deze foto’s worden getoond.', 'Kun disse billeder vises.', 'Nur diese Fotos werden gezeigt.'],
];

export const ROWS_BGRULES: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_BGRULES: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_BGRULES: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const DE_BGRULES: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
