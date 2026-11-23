// Birthdays from a contacts file and Google's secret iCal address (#43): Cumpleaños > Importar contactos and the hint
// in Calendarios. Admin text keyed by the Spanish string t() takes. Each row is [es, en, pt, nl, da, pl, de]. ROWS_VCARD
// feeds EN and PT (i18n-dict.ts); NL_VCARD, DA_VCARD and PL_VCARD are spread into NL, DA and PL. The menu names of
// Google, Apple, Microsoft and Android are written as each one shows them in that language.
const ROWS: [string, string, string, string, string, string, string][] = [
  ['Importar contactos', 'Import contacts', 'Importar contactos', 'Contacten importeren', 'Importér kontakter', 'Importuj kontakty', 'Kontakte importieren'],
  ['Importar cumpleaños de tus contactos', 'Import birthdays from your contacts', 'Importar aniversários dos teus contactos', 'Verjaardagen uit je contacten importeren', 'Importér fødselsdage fra dine kontakter', 'Importuj urodziny z kontaktów', 'Geburtstage aus deinen Kontakten importieren'],
  ['Importar cumpleaños de tus contactos (vCard)', 'Import birthdays from your contacts (vCard)', 'Importar aniversários dos teus contactos (vCard)', 'Verjaardagen uit je contacten importeren (vCard)', 'Importér fødselsdage fra dine kontakter (vCard)', 'Importuj urodziny z kontaktów (vCard)', 'Geburtstage aus deinen Kontakten importieren (vCard)'],
  [
    'Añádelos uno a uno, pega una lista con “Importar CSV” o tráelos de tus contactos con “Importar contactos”.',
    'Add them one by one, paste a list with “Import CSV” or bring them from your contacts with “Import contacts”.',
    'Adiciona-os um a um, cola uma lista com “Importar CSV” ou traz-os dos teus contactos com “Importar contactos”.',
    'Voeg ze één voor één toe, plak een lijst met “CSV importeren” of haal ze uit je contacten met “Contacten importeren”.',
    'Tilføj dem én ad gangen, indsæt en liste med “Importér CSV”, eller hent dem fra dine kontakter med “Importér kontakter”.',
    'Dodawaj je pojedynczo, wklej listę przez „Importuj CSV” albo pobierz je z kontaktów przez „Importuj kontakty”.',
    'Füge sie einzeln hinzu, füge eine Liste mit „CSV importieren“ ein oder hol sie mit „Kontakte importieren“ aus deinen Kontakten.',
  ],
  [
    'Elige un archivo de contactos (.vcf). Se lee en este navegador y no se envía a ningún sitio: solo se guardan los cumpleaños que añadas.',
    'Choose a contacts file (.vcf). It is read in this browser and not sent anywhere: only the birthdays you add are saved.',
    'Escolhe um ficheiro de contactos (.vcf). É lido neste navegador e não é enviado para lado nenhum: só se guardam os aniversários que adicionares.',
    'Kies een contactenbestand (.vcf). Het wordt in deze browser gelezen en nergens heen gestuurd: alleen de verjaardagen die je toevoegt worden bewaard.',
    'Vælg en kontaktfil (.vcf). Den læses i denne browser og sendes ingen steder hen: kun de fødselsdage, du tilføjer, bliver gemt.',
    'Wybierz plik kontaktów (.vcf). Jest czytany w tej przeglądarce i nigdzie nie jest wysyłany: zapisują się tylko urodziny, które dodasz.',
    'Wähle eine Kontaktdatei (.vcf). Sie wird in diesem Browser gelesen und nirgendwohin gesendet: Gespeichert werden nur die Geburtstage, die du hinzufügst.',
  ],
  ['Elegir archivo .vcf', 'Choose a .vcf file', 'Escolher ficheiro .vcf', 'Kies een .vcf-bestand', 'Vælg en .vcf-fil', 'Wybierz plik .vcf', '.vcf-Datei auswählen'],
  ['o suéltalo aquí', 'or drop it here', 'ou larga-o aqui', 'of sleep het hierheen', 'eller slip den her', 'albo upuść go tutaj', 'oder hier ablegen'],
  ['Cómo exportar tus contactos', 'How to export your contacts', 'Como exportar os teus contactos', 'Zo exporteer je je contacten', 'Sådan eksporterer du dine kontakter', 'Jak wyeksportować kontakty', 'So exportierst du deine Kontakte'],
  [
    'Google Contactos: en contacts.google.com, «Exportar» y elige «vCard (para Contactos de iOS)».',
    'Google Contacts: on contacts.google.com, click Export and choose vCard (for iOS Contacts).',
    'Google Contactos: em contacts.google.com, «Exportar» e escolhe «vCard (para Contactos do iOS)».',
    'Google Contacten: ga naar contacts.google.com, klik op Exporteren en kies vCard (voor iOS Contacten).',
    'Google Kontakter: gå til contacts.google.com, klik på Eksportér, og vælg vCard (til iOS-kontakter).',
    'Kontakty Google: na contacts.google.com kliknij „Eksportuj” i wybierz „vCard (dla Kontaktów w iOS)”.',
    'Google Kontakte: Auf contacts.google.com „Exportieren“ und dann „vCard (für iOS-Kontakte)“ wählen.',
  ],
  [
    'iCloud: en icloud.com/contacts, selecciona los contactos, abre el menú ⋯ y elige «Exportar vCard».',
    'iCloud: on icloud.com/contacts, select the contacts, open the ⋯ menu and choose Export vCard.',
    'iCloud: em icloud.com/contacts, seleciona os contactos, abre o menu ⋯ e escolhe «Exportar vCard».',
    'iCloud: selecteer op icloud.com/contacts de contacten, open het menu ⋯ en kies Exporteer vCard.',
    'iCloud: vælg kontakterne på icloud.com/contacts, åbn menuen ⋯, og vælg Eksporter vCard.',
    'iCloud: na icloud.com/contacts zaznacz kontakty, otwórz menu ⋯ i wybierz „Eksportuj vCard”.',
    'iCloud: Auf icloud.com/contacts die Kontakte auswählen, das Menü ⋯ öffnen und „vCard exportieren“ wählen.',
  ],
  [
    'Outlook: abre el contacto y usa «Archivo» → «Guardar como» → vCard. Puedes elegir varios archivos .vcf a la vez.',
    'Outlook: open the contact and use File → Save As → vCard. You can choose several .vcf files at once.',
    'Outlook: abre o contacto e usa «Ficheiro» → «Guardar como» → vCard. Podes escolher vários ficheiros .vcf de uma vez.',
    'Outlook: open het contact en gebruik Bestand → Opslaan als → vCard. Je kunt meerdere .vcf-bestanden tegelijk kiezen.',
    'Outlook: åbn kontakten, og brug Filer → Gem som → vCard. Du kan vælge flere .vcf-filer på én gang.',
    'Outlook: otwórz kontakt i użyj „Plik” → „Zapisz jako” → vCard. Możesz wybrać kilka plików .vcf naraz.',
    'Outlook: Öffne den Kontakt und nutze „Datei“ → „Speichern unter“ → vCard. Du kannst mehrere .vcf-Dateien auf einmal auswählen.',
  ],
  [
    'Android: app Contactos → «Gestionar contactos» → «Exportar».',
    'Android: Contacts app → Manage contacts → Export.',
    'Android: app Contactos → «Gerir contactos» → «Exportar».',
    'Android: app Contacten → Contacten beheren → Exporteren.',
    'Android: appen Kontakter → Administrer kontakter → Eksportér.',
    'Android: aplikacja Kontakty → „Zarządzaj kontaktami” → „Eksportuj”.',
    'Android: App Kontakte → „Kontakte verwalten“ → „Exportieren“.',
  ],
  ['El archivo pesa demasiado (máximo {n} MB).', 'The file is too big (at most {n} MB).', 'O ficheiro é demasiado grande (máximo {n} MB).', 'Het bestand is te groot (hoogstens {n} MB).', 'Filen er for stor (højst {n} MB).', 'Plik jest za duży (maksymalnie {n} MB).', 'Die Datei ist zu groß (höchstens {n} MB).'],
  ['No es un archivo de contactos (.vcf).', 'This is not a contacts file (.vcf).', 'Não é um ficheiro de contactos (.vcf).', 'Dit is geen contactenbestand (.vcf).', 'Det er ikke en kontaktfil (.vcf).', 'To nie jest plik kontaktów (.vcf).', 'Das ist keine Kontaktdatei (.vcf).'],
  ['No se pudo leer el archivo.', 'The file could not be read.', 'Não foi possível ler o ficheiro.', 'Het bestand kon niet worden gelezen.', 'Filen kunne ikke læses.', 'Nie udało się odczytać pliku.', 'Die Datei konnte nicht gelesen werden.'],
  ['Solo se han leído los primeros {n} contactos.', 'Only the first {n} contacts were read.', 'Só foram lidos os primeiros {n} contactos.', 'Alleen de eerste {n} contacten zijn gelezen.', 'Kun de første {n} kontakter blev læst.', 'Odczytano tylko pierwsze {n} kontaktów.', 'Nur die ersten {n} Kontakte wurden gelesen.'],
  ['{n} contactos leídos', '{n} contacts read', '{n} contactos lidos', '{n} contacten gelezen', '{n} kontakter læst', 'Odczytano {n} kontaktów', '{n} Kontakte gelesen'],
  ['{n} con cumpleaños', '{n} with a birthday', '{n} com aniversário', '{n} met een verjaardag', '{n} med fødselsdag', 'Z urodzinami: {n}', '{n} mit Geburtstag'],
  ['{n} nuevos', '{n} new', '{n} novos', '{n} nieuw', '{n} nye', 'Nowe: {n}', '{n} neu'],
  ['{n} ya están en la lista', '{n} already in the list', '{n} já estão na lista', '{n} staan al in de lijst', '{n} er allerede på listen', 'Już na liście: {n}', '{n} schon in der Liste'],
  ['{n} repetidos en el archivo', '{n} repeated in the file', '{n} repetidos no ficheiro', '{n} dubbel in het bestand', '{n} gentaget i filen', 'Powtórzone w pliku: {n}', '{n} doppelt in der Datei'],
  ['{n} sin fecha de cumpleaños', '{n} without a birthday', '{n} sem data de aniversário', '{n} zonder verjaardag', '{n} uden fødselsdag', 'Bez daty urodzin: {n}', '{n} ohne Geburtsdatum'],
  ['{n} con una fecha que no se entiende', '{n} with a date that cannot be read', '{n} com uma data que não se percebe', '{n} met een onleesbare datum', '{n} med en dato, der ikke kan læses', 'Z nieczytelną datą: {n}', '{n} mit unlesbarem Datum'],
  ['{n} sin nombre', '{n} without a name', '{n} sem nome', '{n} zonder naam', '{n} uden navn', 'Bez nazwy: {n}', '{n} ohne Namen'],
  ['No hay ningún cumpleaños en este archivo.', 'There are no birthdays in this file.', 'Não há nenhum aniversário neste ficheiro.', 'Er staan geen verjaardagen in dit bestand.', 'Der er ingen fødselsdage i denne fil.', 'W tym pliku nie ma żadnych urodzin.', 'In dieser Datei gibt es keine Geburtstage.'],
  ['Los contactos sin fecha de cumpleaños no se importan.', 'Contacts without a birthday are not imported.', 'Os contactos sem data de aniversário não são importados.', 'Contacten zonder verjaardag worden niet geïmporteerd.', 'Kontakter uden fødselsdag importeres ikke.', 'Kontakty bez daty urodzin nie są importowane.', 'Kontakte ohne Geburtsdatum werden nicht importiert.'],
  ['Seleccionar todos', 'Select all', 'Selecionar todos', 'Alles selecteren', 'Vælg alle', 'Zaznacz wszystkie', 'Alle auswählen'],
  ['Desmarcar todos', 'Clear all', 'Desmarcar todos', 'Alles deselecteren', 'Fravælg alle', 'Odznacz wszystkie', 'Alle abwählen'],
  ['{n} seleccionados', '{n} selected', '{n} selecionados', '{n} geselecteerd', '{n} valgt', 'Zaznaczone: {n}', '{n} ausgewählt'],
  ['Ya en la lista', 'Already listed', 'Já na lista', 'Staat al in de lijst', 'Allerede på listen', 'Już na liście', 'Schon in der Liste'],
  ['sin año', 'no year', 'sem ano', 'geen jaar', 'uden år', 'bez roku', 'ohne Jahr'],
  ['Año descartado: no parece un año de nacimiento', 'Year left out: it does not look like a year of birth', 'Ano ignorado: não parece um ano de nascimento', 'Jaar weggelaten: het lijkt geen geboortejaar', 'Året er udeladt: det ligner ikke et fødselsår', 'Pominięto rok: nie wygląda na rok urodzenia', 'Jahr weggelassen: sieht nicht nach einem Geburtsjahr aus'],
  ['{n} nombres acortados a {max} letras', '{n} names cut to {max} characters', '{n} nomes encurtados para {max} letras', '{n} namen ingekort tot {max} tekens', '{n} navne forkortet til {max} tegn', 'Skrócone nazwy (do {max} znaków): {n}', '{n} Namen auf {max} Zeichen gekürzt'],
  [
    'Caben {n} cumpleaños más (máximo {max}). Desmarca algunos para seguir.',
    '{n} more birthdays fit (at most {max}). Untick some to go on.',
    'Cabem mais {n} aniversários (máximo {max}). Desmarca alguns para continuar.',
    'Er passen nog {n} verjaardagen bij (hoogstens {max}). Vink er een paar uit om door te gaan.',
    'Der er plads til {n} fødselsdage mere (højst {max}). Fravælg nogle for at fortsætte.',
    'Zmieści się jeszcze {n} urodzin (maksymalnie {max}). Odznacz kilka, aby kontynuować.',
    'Es passen noch {n} Geburtstage (höchstens {max}). Wähle einige ab, um fortzufahren.',
  ],
  [
    'La dirección secreta de Google no incluye los cumpleaños de Google Contactos. Para verlos:',
    'Google’s secret address leaves out the birthdays from Google Contacts. To see them:',
    'O endereço secreto do Google não inclui os aniversários do Google Contactos. Para os veres:',
    'Het geheime adres van Google bevat de verjaardagen uit Google Contacten niet. Om ze te zien:',
    'Googles hemmelige adresse indeholder ikke fødselsdagene fra Google Kontakter. Sådan ser du dem:',
    'Tajny adres Google nie zawiera urodzin z Kontaktów Google. Aby je zobaczyć:',
    'Die geheime Adresse von Google enthält die Geburtstage aus Google Kontakte nicht. So siehst du sie:',
  ],
  ['Vincular tu cuenta de Google', 'Link your Google account', 'Ligar a tua conta Google', 'Je Google-account koppelen', 'Tilknyt din Google-konto', 'Połącz konto Google', 'Dein Google-Konto verknüpfen'],
  [
    'Solo caben {n} cumpleaños más (máximo {max}): se han marcado los {n} primeros.',
    'Only {n} more birthdays fit (at most {max}): the first {n} are ticked.',
    'Só cabem mais {n} aniversários (máximo {max}): foram marcados os {n} primeiros.',
    'Er passen nog maar {n} verjaardagen bij (hoogstens {max}): de eerste {n} zijn aangevinkt.',
    'Der er kun plads til {n} fødselsdage mere (højst {max}): de første {n} er valgt.',
    'Zmieści się jeszcze tylko {n} urodzin (maksymalnie {max}): zaznaczono pierwsze {n}.',
    'Es passen nur noch {n} Geburtstage (höchstens {max}): Die ersten {n} sind ausgewählt.',
  ],
  [
    'La lista está llena (máximo {max}): no cabe ningún cumpleaños más.',
    'The list is full (at most {max}): no more birthdays fit.',
    'A lista está cheia (máximo {max}): não cabe mais nenhum aniversário.',
    'De lijst is vol (hoogstens {max}): er passen geen verjaardagen meer bij.',
    'Listen er fuld (højst {max}): der er ikke plads til flere fødselsdage.',
    'Lista jest pełna (maksymalnie {max}): nie zmieszczą się już żadne urodziny.',
    'Die Liste ist voll (höchstens {max}): Es passt kein weiterer Geburtstag hinein.',
  ],
];

/** Singular forms (t() with n = 1): Spanish key → [es, en, pt, nl, da, pl, de]. */
const ONE: [string, string, string, string, string, string, string, string][] = [
  ['{n} contactos leídos', '1 contacto leído', '1 contact read', '1 contacto lido', '1 contact gelezen', '1 kontakt læst', 'Odczytano 1 kontakt', '1 Kontakt gelesen'],
  ['{n} nuevos', '1 nuevo', '1 new', '1 novo', '1 nieuw', '1 ny', 'Nowe: 1', '1 neu'],
  ['{n} ya están en la lista', '1 ya está en la lista', '1 already in the list', '1 já está na lista', '1 staat al in de lijst', '1 er allerede på listen', 'Już na liście: 1', '1 schon in der Liste'],
  ['{n} repetidos en el archivo', '1 repetido en el archivo', '1 repeated in the file', '1 repetido no ficheiro', '1 dubbel in het bestand', '1 gentaget i filen', 'Powtórzone w pliku: 1', '1 doppelt in der Datei'],
  ['{n} seleccionados', '1 seleccionado', '1 selected', '1 selecionado', '1 geselecteerd', '1 valgt', 'Zaznaczone: 1', '1 ausgewählt'],
  ['{n} nombres acortados a {max} letras', '1 nombre acortado a {max} letras', '1 name cut to {max} characters', '1 nome encurtado para {max} letras', '1 naam ingekort tot {max} tekens', '1 navn forkortet til {max} tegn', 'Skrócone nazwy (do {max} znaków): 1', '1 Name auf {max} Zeichen gekürzt'],
  [
    'Caben {n} cumpleaños más (máximo {max}). Desmarca algunos para seguir.',
    'Cabe 1 cumpleaños más (máximo {max}). Desmarca algunos para seguir.',
    '1 more birthday fits (at most {max}). Untick some to go on.',
    'Cabe mais 1 aniversário (máximo {max}). Desmarca alguns para continuar.',
    'Er past nog 1 verjaardag bij (hoogstens {max}). Vink er een paar uit om door te gaan.',
    'Der er plads til 1 fødselsdag mere (højst {max}). Fravælg nogle for at fortsætte.',
    'Zmieszczą się jeszcze jedne urodziny (maksymalnie {max}). Odznacz kilka, aby kontynuować.',
    'Es passt noch 1 Geburtstag (höchstens {max}). Wähle einige ab, um fortzufahren.',
  ],
  [
    'Solo caben {n} cumpleaños más (máximo {max}): se han marcado los {n} primeros.',
    'Solo cabe 1 cumpleaños más (máximo {max}): se ha marcado el primero.',
    'Only 1 more birthday fits (at most {max}): the first one is ticked.',
    'Só cabe mais 1 aniversário (máximo {max}): foi marcado o primeiro.',
    'Er past nog maar 1 verjaardag bij (hoogstens {max}): de eerste is aangevinkt.',
    'Der er kun plads til 1 fødselsdag mere (højst {max}): den første er valgt.',
    'Zmieszczą się jeszcze tylko jedne urodziny (maksymalnie {max}): zaznaczono pierwsze.',
    'Es passt nur noch 1 Geburtstag (höchstens {max}): Der erste ist ausgewählt.',
  ],
];

/** Polish "few" forms (2-4, 22-24…). */
const FEW: [string, string][] = [
  ['El archivo pesa demasiado (máximo {n} MB).', 'Plik jest za duży (maksymalnie {n} MB).'],
  ['{n} contactos leídos', 'Odczytano {n} kontakty'],
  ['Solo se han leído los primeros {n} contactos.', 'Odczytano tylko pierwsze {n} kontakty.'],
  ['Caben {n} cumpleaños más (máximo {max}). Desmarca algunos para seguir.', 'Zmieszczą się jeszcze {n} urodziny (maksymalnie {max}). Odznacz kilka, aby kontynuować.'],
  ['Solo caben {n} cumpleaños más (máximo {max}): se han marcado los {n} primeros.', 'Zmieszczą się jeszcze tylko {n} urodziny (maksymalnie {max}): zaznaczono pierwsze {n}.'],
];

export const ROWS_VCARD: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_VCARD: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_VCARD: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const DE_VCARD: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[6]]));
export const PL_VCARD: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
export const SINGULAR_VCARD: Record<string, [string, string, string]> = Object.fromEntries(ONE.map(([k, es, en, pt]) => [k, [es, en, pt]]));
export const NL_SINGULAR_VCARD: Record<string, string> = Object.fromEntries(ONE.map((r) => [r[0], r[4]]));
export const DA_SINGULAR_VCARD: Record<string, string> = Object.fromEntries(ONE.map((r) => [r[0], r[5]]));
export const DE_SINGULAR_VCARD: Record<string, string> = Object.fromEntries(ONE.map((r) => [r[0], r[7]]));
export const PL_SINGULAR_VCARD: Record<string, string> = Object.fromEntries(ONE.map((r) => [r[0], r[6]]));
export const PL_FEW_VCARD: Record<string, string> = Object.fromEntries(FEW);
