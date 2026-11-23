// Weather places (#11: a screen's own place, a weather card's place, "Tiempo en varias ciudades") and the birthday
// titles of the Filtros preview and the Cumpleaños page (#10). Admin text keyed by the Spanish string t() takes.
// Each row is [es, en, pt, nl, da, de]. ROWS_WXPLACES feeds EN and PT (i18n-dict.ts); NL_WXPLACES and DA_WXPLACES are
// spread into NL and DA.
const ROWS: [string, string, string, string, string, string][] = [
  // #10: birthday titles
  ['Cumpleaños reconocido', 'Birthday recognised', 'Aniversário reconhecido', 'Verjaardag herkend', 'Fødselsdag genkendt', 'Geburtstag erkannt'],
  ['Sin mayúsculas', 'Capitals softened', 'Sem maiúsculas', 'Hoofdletters verzacht', 'Store bogstaver dæmpet', 'Großschreibung angepasst'],
  ['Renombrado por la regla #{n}', 'Renamed by rule #{n}', 'Renomeado pela regra #{n}', 'Hernoemd door regel #{n}', 'Omdøbt af regel #{n}', 'Umbenannt durch Regel #{n}'],
  ['título original', 'original title', 'título original', 'oorspronkelijke titel', 'oprindelig titel', 'Originaltitel'],
  [
    'Marco deja solo el nombre junto al 🎂. Puedes cambiarlo en Cumpleaños, «Ordenar los títulos de cumpleaños».',
    'Marco keeps just the name next to the 🎂. You can change this in Birthdays, “Tidy birthday titles”.',
    'O Marco deixa só o nome junto ao 🎂. Podes mudar isto em Aniversários, «Arrumar os títulos dos aniversários».',
    'Marco laat alleen de naam naast de 🎂 staan. Je kunt dit wijzigen bij Verjaardagen, ‘Titels van verjaardagen opruimen’.',
    'Marco viser kun navnet ved siden af 🎂. Du kan ændre det under Fødselsdage, »Ryd op i fødselsdagstitler«.',
    'Marco zeigt neben der 🎂 nur den Namen. Du kannst das unter Geburtstage ändern, „Geburtstagstitel aufräumen“.',
  ],
  ['Ordenar los títulos de cumpleaños', 'Tidy birthday titles', 'Arrumar os títulos dos aniversários', 'Titels van verjaardagen opruimen', 'Ryd op i fødselsdagstitler', 'Geburtstagstitel aufräumen'],
  [
    'Los cumpleaños de tus calendarios (por ejemplo «Cumpleaños de Ana» o «Ana\'s Birthday») se muestran solo con el nombre junto al 🎂. Desactívalo para ver el título tal como viene del calendario.',
    'Birthdays from your calendars (for example “Ana’s Birthday” or “Birthday of Ana”) show just the name next to the 🎂. Turn it off to see the title exactly as the calendar has it.',
    'Os aniversários dos teus calendários (por exemplo «Aniversário da Ana» ou «Ana\'s Birthday») aparecem só com o nome junto ao 🎂. Desativa para ver o título tal como vem do calendário.',
    'Verjaardagen uit je agenda’s (bijvoorbeeld ‘Ana’s verjaardag’ of ‘Ana\'s Birthday’) tonen alleen de naam naast de 🎂. Zet dit uit om de titel te zien zoals de agenda hem heeft.',
    'Fødselsdage fra dine kalendere (for eksempel »Anas fødselsdag« eller »Ana\'s Birthday«) vises kun med navnet ved siden af 🎂. Slå det fra for at se titlen, som kalenderen har den.',
    'Geburtstage aus deinen Kalendern (zum Beispiel „Geburtstag von Ana“ oder „Ana\'s Birthday“) erscheinen nur mit dem Namen neben der 🎂. Schalte es aus, um den Titel so zu sehen, wie er im Kalender steht.',
  ],
  // #11: weather places
  ['Ubicación de esta pantalla', 'Location of this screen', 'Localização deste ecrã', 'Locatie van dit scherm', 'Placering for denne skærm', 'Standort dieses Bildschirms'],
  [
    'Todas las vistas de esta pantalla (y sus pasos en un carrusel) muestran el tiempo de este lugar.',
    'Every layout of this screen (and its steps in a carousel) shows the weather of this place.',
    'Todas as vistas deste ecrã (e os seus passos num carrossel) mostram o tempo deste lugar.',
    'Elke indeling van dit scherm (en zijn stappen in een carrousel) toont het weer van deze plek.',
    'Alle visninger på denne skærm (og dens trin i en karrusel) viser vejret for dette sted.',
    'Alle Ansichten dieses Bildschirms (und ihre Schritte in einem Karussell) zeigen das Wetter dieses Orts.',
  ],
  ['La de casa', 'Home', 'A de casa', 'Die van thuis', 'Hjemmets', 'Zuhause'],
  ['Otro lugar', 'Another place', 'Outro lugar', 'Andere plek', 'Et andet sted', 'Anderer Ort'],
  ['Igual que la pantalla', 'Same as the screen', 'Igual ao ecrã', 'Zelfde als het scherm', 'Samme som skærmen', 'Wie der Bildschirm'],
  ['Lugar', 'Place', 'Lugar', 'Plek', 'Sted', 'Ort'],
  ['Lugares', 'Places', 'Lugares', 'Plekken', 'Steder', 'Orte'],
  ['Añadir lugar', 'Add place', 'Adicionar lugar', 'Plek toevoegen', 'Tilføj sted', 'Ort hinzufügen'],
  ['Hacen falta al menos {n} lugares.', 'At least {n} places are needed.', 'São precisos pelo menos {n} lugares.', 'Er zijn minstens {n} plekken nodig.', 'Der skal være mindst {n} steder.', 'Es werden mindestens {n} Orte gebraucht.'],
  ['Hasta {n} lugares.', 'Up to {n} places.', 'Até {n} lugares.', 'Tot {n} plekken.', 'Op til {n} steder.', 'Bis zu {n} Orte.'],
  [
    'De {min} a {max} lugares. Una pantalla muestra como mucho 8 lugares además del suyo.',
    'From {min} to {max} places. A screen shows at most 8 places besides its own.',
    'De {min} a {max} lugares. Um ecrã mostra no máximo 8 lugares além do seu.',
    'Van {min} tot {max} plekken. Een scherm toont hoogstens 8 plekken naast die van zichzelf.',
    'Fra {min} til {max} steder. En skærm viser højst 8 steder ud over sit eget.',
    '{min} bis {max} Orte. Ein Bildschirm zeigt höchstens 8 Orte zusätzlich zu seinem eigenen.',
  ],
  ['Máxima y mínima de hoy', 'Today’s high and low', 'Máxima e mínima de hoje', 'Hoogste en laagste van vandaag', 'Dagens højeste og laveste', 'Höchst- und Tiefstwert von heute'],
  ['Tiempo en varias ciudades', 'Weather in several cities', 'Tempo em várias cidades', 'Weer in meerdere steden', 'Vejret i flere byer', 'Wetter in mehreren Städten'],
  ['El tiempo de ahora en dos a ocho lugares.', 'The weather right now in two to eight places.', 'O tempo de agora em dois a oito lugares.', 'Het weer van nu op twee tot acht plekken.', 'Vejret lige nu på to til otte steder.', 'Das aktuelle Wetter an zwei bis acht Orten.'],
];

export const ROWS_WXPLACES: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_WXPLACES: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_WXPLACES: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const DE_WXPLACES: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
