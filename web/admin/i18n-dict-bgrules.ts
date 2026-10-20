// "Fondos especiales" (#14): the special background rules of a screen (Fondo page) and their gallery picker. Admin
// text keyed by the Spanish string t() takes. Each row is [es, en, pt, nl, da]. ROWS_BGRULES feeds EN and PT
// (i18n-dict.ts); NL_BGRULES and DA_BGRULES are spread into NL and DA.
const ROWS: [string, string, string, string, string][] = [
  ['Fondos especiales', 'Special backgrounds', 'Fundos especiais', 'Speciale achtergronden', 'Særlige baggrunde'],
  [
    'Otras fotos en fechas señaladas o cuando hay cierto evento. Gana la primera regla que coincide; si ninguna coincide, se usa el fondo normal.',
    'Other photos on special dates or when there is a certain event. The first rule that matches wins; when none matches, the normal background shows.',
    'Outras fotos em datas especiais ou quando há um certo evento. Ganha a primeira regra que coincide; se nenhuma coincidir, usa-se o fundo normal.',
    'Andere foto’s op bijzondere datums of als er een bepaalde afspraak is. De eerste regel die past wint; past er geen, dan de gewone achtergrond.',
    'Andre billeder på særlige datoer, eller når der er en bestemt begivenhed. Den første regel, der passer, vinder; passer ingen, vises den normale baggrund.',
  ],
  ['Añadir regla', 'Add rule', 'Adicionar regra', 'Regel toevoegen', 'Tilføj regel'],
  [
    'Por ejemplo, fotos de Navidad del 1 al 31 de diciembre, o de la playa los días con un evento «Vacaciones».',
    'For example, Christmas photos from 1 to 31 December, or beach photos on days with a “Holiday” event.',
    'Por exemplo, fotos de Natal de 1 a 31 de dezembro, ou da praia nos dias com um evento «Férias».',
    'Bijvoorbeeld kerstfoto’s van 1 tot 31 december, of strandfoto’s op dagen met een afspraak ‘Vakantie’.',
    'For eksempel julebilleder fra 1. til 31. december, eller strandbilleder på dage med en begivenhed »Ferie«.',
  ],
  ['Evento de hoy con…', 'Event today with…', 'Evento de hoje com…', 'Afspraak vandaag met…', 'Begivenhed i dag med…'],
  ['Entre dos fechas', 'Between two dates', 'Entre duas datas', 'Tussen twee datums', 'Mellem to datoer'],
  ['Un solo día', 'A single day', 'Um só dia', 'Eén dag', 'En enkelt dag'],
  ['Un cumpleaños', 'A birthday', 'Um aniversário', 'Een verjaardag', 'En fødselsdag'],
  ['Palabras del título, separadas por comas, p. ej. Navidad, Reyes', 'Words in the title, separated by commas, e.g. Christmas, Xmas', 'Palavras do título, separadas por vírgulas, p. ex. Natal, Reis', 'Woorden in de titel, gescheiden door komma\'s, bijv. Kerst, Sinterklaas', 'Ord i titlen, adskilt med kommaer, f.eks. Jul, Juleaften'],
  ['Calendarios de esta pantalla', 'Calendars of this screen', 'Calendários deste ecrã', 'Agenda’s van dit scherm', 'Kalendere på denne skærm'],
  ['al', 'to', 'a', 't/m', 'til'],
  ['Cuando alguien de Cumpleaños cumple años hoy.', 'When someone in Birthdays has a birthday today.', 'Quando alguém de Aniversários faz anos hoje.', 'Als iemand uit Verjaardagen vandaag jarig is.', 'Når nogen fra Fødselsdage har fødselsdag i dag.'],
  ['Elegir fotos', 'Choose photos', 'Escolher fotos', 'Foto’s kiezen', 'Vælg billeder'],
  ['Elige un álbum', 'Choose an album', 'Escolhe um álbum', 'Kies een album', 'Vælg et album'],
  ['Elegidas: {count} de {max}', 'Chosen: {count} of {max}', 'Escolhidas: {count} de {max}', 'Gekozen: {count} van {max}', 'Valgt: {count} af {max}'],
  ['No hay fotos en la galería', 'There are no photos in the gallery', 'Não há fotos na galeria', 'Er staan geen foto’s in de galerij', 'Der er ingen billeder i galleriet'],
  ['Sube fotos en Galería', 'Upload photos in Gallery', 'Carrega fotos em Galeria', 'Upload foto’s bij Galerij', 'Upload billeder under Galleri'],
  ['Elige al menos una foto', 'Choose at least one photo', 'Escolhe pelo menos uma foto', 'Kies minstens één foto', 'Vælg mindst ét billede'],
];

export const ROWS_BGRULES: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_BGRULES: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_BGRULES: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
