// Default icon rules, shared by the server (server/core/defaults.js), the admin and the display
// (web/shared/emoji.ts): keywords in English, Spanish, Portuguese, Dutch, Danish and Polish, matched against event
// titles and descriptions. More specific categories come first. A plain module (not JSON) so it imports the same way on
// Node, Vite and Workers.
export default [
  {
    id: 'r_birthday', emoji: '🎂',
    match: [
      'cumple', 'cumpleaños', 'birthday', 'bday', 'b-day', 'aniversário', 'aniversario', 'faz anos', 'verjaardag',
      'is jarig', 'jarige', 'fødselsdag', 'fødselar', 'fylder år', 'urodzin', 'imienin', 'osiemnastka',
    ],
  },
  {
    id: 'r_checkout', emoji: '🧳',
    match: [
      'check-out', 'checkout', 'check out', 'departure', 'salida huésped', 'saída', 'uitchecken', 'vertrek gast',
      'udtjekning', 'tjek ud', 'afrejse', 'wymeldowanie', 'wyjazd gości',
    ],
  },
  {
    id: 'r_airbnb', emoji: '🏠',
    match: [
      'airbnb', 'booking', 'vrbo', 'reserva', 'reservation', 'reserved', 'check-in', 'checkin', 'guest', 'guests',
      'hóspede', 'huésped', 'vakantieverhuur', 'verhuurd', 'indtjekning', 'tjek ind', 'gæst', 'rezerwacja',
      'zameldowanie', 'wynajem',
    ],
  },
  {
    id: 'r_flight', emoji: '✈️',
    match: [
      'vuelo', 'flight', 'fly to', 'voo', 'aeropuerto', 'airport', 'aeroporto', 'boarding', 'embarque', 'vlucht naar',
      'vlucht van', 'heenvlucht', 'terugvlucht', 'vliegveld', 'luchthaven', 'vliegen naar', 'schiphol', 'zaventem',
      'fly', 'flyet', 'flyrejse', 'flyver til', 'lufthavn', 'lot do', 'lotnisk', 'samolot', 'odlot', 'przylot', 'wylot',
    ],
  },
  {
    id: 'r_train', emoji: '🚆',
    match: [
      'train', 'tren', 'comboio', 'railway', 'estación de tren', 'trein', 'intercity', 'tog', 'togrejse', 'banegård',
      'dsb', 'pociąg', 'dworzec', 'pkp',
    ],
  },
  {
    id: 'r_doctor', emoji: '🩺',
    match: [
      'médico', 'medico', 'doctor', 'dr.', 'gp', 'dentista', 'dentist', 'orthodontist', 'ortodoncista',
      'pediatrician', 'pediatra', 'consulta', 'appointment', 'checkup', 'check-up', 'hospital', 'clinic', 'clínica',
      'physio', 'fisio', 'therapy', 'terapia', 'vaccine', 'vacuna', 'vacina', 'optician', 'óptica', 'dokter',
      'huisarts', 'tandarts', 'kinderarts', 'oogarts', 'consultatiebureau', 'ziekenhuis', 'fysio', 'therapie',
      'psycholoog', 'logopedie', 'logopedist', 'vaccinatie', 'griepprik', 'opticien', 'læge', 'til lægen',
      'hos lægen', 'egen læge', 'lægevagt', 'tandlæge', 'børnelæge', 'øjenlæge', 'speciallæge', 'sygehus',
      'skadestue', 'vaccin', 'optiker', 'tandregulering', 'jordemoder', 'psykolog', 'sundhedsplejerske', 'lekarz',
      'dentyst', 'stomatolog', 'ortodont', 'przychodni', 'szpital', 'klinik', 'fizjoterap', 'szczepieni', 'okulist',
      'laryngolog', 'dermatolog', 'ginekolog', 'psycholog', 'logoped', 'badanie', 'badania', 'rehabilitacj',
    ],
  },
  {
    id: 'r_pharmacy', emoji: '💊',
    match: [
      'pharmacy', 'farmacia', 'farmácia', 'prescription', 'receta', 'medication', 'medicine', 'medicación',
      'medicação', 'apotheek', 'medicijnen', 'medicatie', 'apotek', 'medicin', 'apteka', 'apteki', 'recepta', 'recepty',
      'leki', 'lekarstw',
    ],
  },
  {
    id: 'r_school', emoji: '🎒',
    match: [
      'colegio', 'escuela', 'school', 'escola', 'kindergarten', 'nursery', 'daycare', 'guardería', 'creche',
      'parents evening', 'tutoría', 'reunião de pais', 'field trip', 'excursión', 'kinderopvang', 'kinderdagverblijf',
      'kdv', 'bso', 'peuterspeelzaal', 'ouderavond', 'oudergesprek', 'rapportgesprek', 'excursie', 'skole',
      'børnehave', 'vuggestue', 'dagpleje', 'sfo', 'forældremøde', 'forældresamtale', 'szkoła', 'w szkole', 'do szkoły', 'przedszkol',
      'żłobek', 'żłobka', 'wywiadówka', 'zebranie z rodzicami', 'wycieczka szkolna', 'świetlica',
    ],
  },
  {
    id: 'r_exam', emoji: '📝',
    match: [
      'exam', 'examen', 'exame', 'quiz', 'homework', 'deberes', 'trabalho de casa', 'assignment', 'toets',
      'proefwerk', 'tentamen', 'overhoring', 'huiswerk', 'spreekbeurt', 'werkstuk', 'eksamen', 'lektie',
      'terminsprøve', 'egzamin', 'sprawdzian', 'kartkówka', 'klasówka', 'matura', 'zadanie domowe',
    ],
  },
  {
    id: 'r_swim', emoji: '🏊',
    match: [
      'swim', 'swimming', 'natación', 'natação', 'piscina', 'pool', 'zwemmen', 'zwemles', 'zwembad', 'zwemdiploma',
      'svømning', 'svømme', 'badeland', 'basen', 'pływani', 'pływalni',
    ],
  },
  {
    id: 'r_sport', emoji: '🏃',
    match: [
      'fútbol', 'futbol', 'futebol', 'football', 'soccer', 'basketball', 'baloncesto', 'basquetebol', 'gym',
      'workout', 'training', 'entreno', 'entrenamiento', 'treino', 'ginásio', 'gimnasio', 'padel', 'pádel', 'tenis',
      'ténis', 'tennis', 'deporte', 'desporto', 'sport', 'sports', 'match', 'partido', 'jogo', 'running', 'run',
      'yoga', 'pilates', 'dance', 'baile', 'dança', 'karate', 'judo', 'cycling', 'ciclismo', 'hiking', 'senderismo',
      'voetbal', 'hockey', 'korfbal', 'handbal', 'wedstrijd', 'turnen', 'hardlopen', 'dansles', 'fodbold', 'håndbold',
      'træning', 'fitness', 'idræt', 'gymnastik', 'badminton', 'løb', 'løbetur', 'kamp', 'turnering', 'stævne',
      'dans', 'cykling', 'spinning', 'ridning', 'ridetime', 'vandretur', 'piłka nożna', 'piłki nożnej', 'trening',
      'mecz', 'meczu', 'koszykówk', 'siatkówk', 'siłowni', 'bieganie', 'rower', 'joga', 'taniec', 'tańce', 'gimnastyk',
      'w-f',
    ],
  },
  {
    id: 'r_haircut', emoji: '💇',
    match: [
      'haircut', 'hairdresser', 'barber', 'salon', 'peluquería', 'peluqueria', 'cabeleireiro', 'barbería',
      'barbearia', 'kapper', 'kapsalon', 'barbier', 'haar knippen', 'frisør', 'hårklip', 'fryzjer', 'strzyżenie',
    ],
  },
  {
    id: 'r_coffee', emoji: '☕',
    match: [
      'coffee', 'café', 'brunch', 'breakfast', 'desayuno', 'pequeno-almoço', 'merienda', 'lanche', 'koffie',
      'ontbijt', 'high tea', 'kaffe', 'morgenmad', 'kawa', 'kawę', 'kawiarni', 'śniadanie',
    ],
  },
  {
    id: 'r_dinner', emoji: '🍽️',
    match: [
      'cena', 'cenar', 'dinner', 'jantar', 'restaurante', 'restaurant', 'almuerzo', 'almoço', 'lunch', 'comida',
      'bbq', 'barbecue', 'barbacoa', 'churrasco', 'diner', 'etentje', 'uit eten', 'eten', 'avondeten', 'aftensmad',
      'frokost', 'fællesspisning', 'middagsselskab', 'spise ude', 'grill', 'kolacj', 'obiad', 'restauracj',
    ],
  },
  {
    id: 'r_drinks', emoji: '🍻',
    match: [
      'drinks', 'beers', 'pub', 'bar', 'cañas', 'copas', 'happy hour', 'borrel', 'biertje', 'drankje', 'kroeg', 'øl',
      'fredagsbar', 'vinsmagning', 'ølsmagning', 'piwo', 'na piwo', 'drinki',
    ],
  },
  {
    id: 'r_party', emoji: '🥳',
    match: [
      'party', 'fiesta', 'festa', 'celebration', 'celebración', 'celebração', 'sleepover', 'playdate', 'christening',
      'bautizo', 'batizado', 'communion', 'comunión', 'comunhão', 'feestje', 'kinderfeest', 'logeren', 'logeerpartij',
      'speelafspraak', 'doop', 'communie', 'jubileum', 'reünie', 'fest', 'festen', 'sommerfest', 'julefest',
      'klassefest', 'havefest', 'studenterfest', 'nytårsfest', 'fejring', 'jubilæum', 'barnedåb', 'dåb',
      'konfirmation', 'legeaftale', 'fastelavn', 'imprez', 'przyjęcie', 'chrzest', 'chrzciny', 'komunia', 'nocowanie',
    ],
  },
  {
    id: 'r_meeting', emoji: '💼',
    match: [
      'reunión', 'reunion', 'meeting', 'call', 'reunião', 'zoom', 'teams', 'google meet', 'interview', 'entrevista',
      'conference', 'conferencia', 'conferência', 'presentation', 'presentación', 'apresentação', 'vergadering',
      'overleg', 'gesprek', 'sollicitatie', 'presentatie', 'congres', 'møde', 'mødet', 'teammøde', 'personalemøde',
      'bestyrelsesmøde', 'generalforsamling', 'jobsamtale', 'medarbejdersamtale', 'opkald', 'præsentation',
      'konference', 'morgenmøde', 'statusmøde', 'spotkanie', 'zebranie', 'rozmowa kwalifikacyjna', 'telekonferencj',
      'prezentacj', 'konferencj', 'narada',
    ],
  },
  {
    id: 'r_work', emoji: '💻',
    match: [
      'work', 'trabajo', 'trabalho', 'office', 'oficina', 'escritório', 'shift', 'turno', 'on call', 'guardia',
      'werk', 'werkdag', 'kantoor', 'dagdienst', 'avonddienst', 'nachtdienst', 'arbejdsdag', 'på arbejde', 'job',
      'kontor', 'vagt', 'dagvagt', 'aftenvagt', 'nattevagt', 'hjemmearbejde', 'w pracy', 'do pracy', 'pracy', 'biuro', 'biurze',
      'dyżur',
    ],
  },
  {
    id: 'r_holiday', emoji: '🎉',
    match: [
      'festivo', 'feriado', 'public holiday', 'bank holiday', 'national holiday', 'feestdag', 'helligdag', 'święto',
      'dzień wolny',
    ],
  },
  {
    id: 'r_vacation', emoji: '🏖️',
    match: [
      'vacaciones', 'holiday', 'holidays', 'férias', 'vacation', 'trip', 'viaje', 'viagem', 'getaway', 'escapada',
      'beach', 'playa', 'praia', 'camping', 'acampada', 'campismo', 'vakantie', 'op reis', 'reis naar', 'reisje',
      'weekendje weg', 'stedentrip', 'dagje uit', 'stranddag', 'naar het strand', 'kamperen', 'ferie', 'rejse',
      'sommerhus', 'weekendtur', 'stranden', 'strandtur', 'wakacje', 'urlop', 'wyjazd', 'wycieczk', 'plaża', 'plaży',
      'nad morze', 'kemping', 'biwak',
    ],
  },
  {
    id: 'r_wedding', emoji: '💍',
    match: [
      'boda', 'wedding', 'casamento', 'engagement', 'pedida', 'noivado', 'bruiloft', 'trouwerij', 'trouwdag',
      'huwelijk', 'verloving', 'bryllup', 'forlovelse', 'polterabend', 'ślub', 'ślubu', 'wesel', 'zaręczyny',
    ],
  },
  {
    id: 'r_shopping', emoji: '🛒',
    match: [
      'compra', 'compras', 'shopping', 'groceries', 'grocery', 'mercado', 'supermercado', 'supermarket', 'market',
      'boodschappen', 'winkelen', 'supermarkt', 'weekmarkt', 'indkøb', 'handle ind', 'supermarked', 'loppemarked',
      'julemarked', 'zakupy', 'zakupów', 'sklep', 'targ',
    ],
  },
  {
    id: 'r_delivery', emoji: '📦',
    match: [
      'delivery', 'package', 'parcel', 'entrega', 'paquete', 'encomenda', 'pick up parcel', 'recogida', 'bezorging',
      'pakket', 'pakken', 'pakkeshop', 'pakkeboks', 'hent pakke', 'hente pakke', 'hjemlevering', 'leveres', 'paczk',
      'paczkomat', 'kurier', 'dostawa',
    ],
  },
  {
    id: 'r_car', emoji: '🚗',
    match: [
      'coche', 'car', 'taller', 'garage', 'mechanic', 'mecánico', 'mecânico', 'itv', 'mot', 'inspeção', 'inspección',
      'inspection', 'oficina auto', 'carro', 'car wash', 'lavado', 'tyres', 'neumáticos', 'pneus', 'auto naar',
      'auto wassen', 'apk', 'automonteur', 'wasstraat', 'winterbanden', 'zomerbanden', 'bandenwissel', 'bil',
      'bilsyn', 'synshal', 'værksted', 'mekaniker', 'dækskift', 'vinterdæk', 'sommerdæk', 'bilvask', 'samoch',
      'mechanik', 'warsztat', 'przegląd auta', 'wymiana opon', 'opony', 'myjnia',
    ],
  },
  {
    id: 'r_repair', emoji: '🔧',
    match: [
      'plumber', 'fontanero', 'canalizador', 'electrician', 'electricista', 'eletricista', 'repair', 'reparación',
      'reparação', 'technician', 'técnico', 'maintenance', 'mantenimiento', 'manutenção', 'installer', 'instalación',
      'loodgieter', 'elektricien', 'monteur', 'reparatie', 'repareren', 'onderhoud', 'installateur', 'klusjesman',
      'cv-ketel', 'vvs', 'elektriker', 'reparation', 'håndværker', 'tekniker', 'montør', 'vedligehold', 'hydraulik',
      'elektryk', 'napraw', 'serwis', 'instalator', 'fachowiec',
    ],
  },
  {
    id: 'r_cleaning', emoji: '🧹',
    match: [
      'cleaning', 'cleaner', 'limpieza', 'limpeza', 'housekeeping', 'laundry', 'colada', 'lavandería', 'lavandaria',
      'schoonmaak', 'schoonmaken', 'poetshulp', 'strijken', 'glazenwasser', 'rengøring', 'vasketøj', 'tøjvask',
      'støvsug', 'sprząt', 'pranie', 'odkurzani', 'mycie okien',
    ],
  },
  {
    id: 'r_trash', emoji: '🗑️',
    match: [
      'trash', 'garbage', 'rubbish', 'bins', 'bin day', 'recycling', 'basura', 'reciclaje', 'lixo', 'reciclagem',
      'afval', 'vuilnis', 'kliko', 'gft', 'pmd', 'oud papier', 'glasbak', 'skrald', 'affald', 'genbrug', 'śmieci',
      'odpady', 'wywóz', 'segregacj', 'makulatur',
    ],
  },
  {
    id: 'r_garden', emoji: '🌱',
    match: [
      'garden', 'gardening', 'jardín', 'jardim', 'jardinería', 'jardinagem', 'plants', 'plantas', 'lawn', 'tuin',
      'tuinieren', 'tuinman', 'gras maaien', 'grasmaaien', 'planten', 'tuincentrum', 'havearbejde', 'havedag',
      'kolonihave', 'græsslåning', 'slå græs', 'hækklipning', 'planter', 'ogród', 'ogrodu', 'ogrodzie', 'działk',
      'koszenie', 'trawnik', 'kwiaty', 'podlać',
    ],
  },
  {
    id: 'r_bill', emoji: '💶',
    match: [
      'pago', 'factura', 'fatura', 'bill', 'invoice', 'payment', 'pay', 'rent', 'alquiler', 'renda', 'mortgage',
      'hipoteca', 'recibo', 'pagamento', 'taxes', 'impuestos', 'impostos', 'insurance', 'seguro', 'betaling',
      'betalen', 'rekening', 'factuur', 'huur', 'hypotheek', 'belasting', 'verzekering', 'incasso', 'regning',
      'betal', 'husleje', 'faktura', 'forsikring', 'årsopgørelse', 'rachun', 'płatność', 'zapłacić', 'czynsz', 'kredyt',
      'raty', 'podatek', 'ubezpieczeni', 'opłata', 'przelew',
    ],
  },
  {
    id: 'r_deadline', emoji: '⏰',
    match: [
      'deadline', 'due', 'plazo', 'prazo', 'vencimiento', 'vencimento', 'expires', 'caduca', 'renewal', 'renovación',
      'renovação', 'verloopt', 'vervalt', 'vervaldatum', 'verlengen', 'inleveren', 'uiterste datum', 'frist',
      'udløber', 'forny', 'termin płatności', 'ostateczny termin', 'wygasa', 'ostatni dzień', 'odnowienie',
    ],
  },
  {
    id: 'r_vet', emoji: '🐾',
    match: [
      'veterinario', 'veterinário', 'vet', 'veterinary', 'grooming', 'peluquería canina', 'dog', 'perro', 'cão',
      'puppy', 'cachorro', 'dierenarts', 'hond', 'kat', 'poes', 'trimmen', 'dyrlæge', 'dyreklinik', 'hund', 'hunden',
      'hvalp', 'weteryn', 'z psem', 'psa', 'kota', 'kotem',
    ],
  },
  {
    id: 'r_music', emoji: '🎹',
    match: [
      'piano', 'guitar', 'guitarra', 'violin', 'violín', 'violino', 'music lesson', 'clase de música',
      'aula de música', 'choir', 'coro', 'band practice', 'ensayo', 'ensaio', 'gitaar', 'viool', 'muziekles',
      'zangles', 'drumles', 'koor', 'orkest', 'bandrepetitie', 'koorrepetitie', 'klaver', 'musikundervisning',
      'musiktime', 'kor', 'korprøve', 'bandøvning', 'trommer', 'sangtime', 'pianin', 'fortepian', 'gitar', 'skrzypce',
      'lekcja muzyki', 'chór', 'chóru',
    ],
  },
  {
    id: 'r_cinema', emoji: '🎬',
    match: [
      'cine', 'cinema', 'movie', 'movies', 'film', 'filme', 'película', 'theatre', 'theater', 'teatro', 'show',
      'espectáculo', 'espetáculo', 'bioscoop', 'toneel', 'voorstelling', 'musical', 'schouwburg', 'biograf', 'bio',
      'teater', 'teatret', 'forestilling', 'kino', 'kinie', 'teatr', 'spektakl', 'przedstawienie', 'seans',
    ],
  },
  {
    id: 'r_concert', emoji: '🎵',
    match: [
      'concierto', 'concert', 'concerto', 'festival', 'gig', 'live music', 'optreden', 'koncert', 'festiwal',
    ],
  },
  {
    id: 'r_babysitter', emoji: '🧸',
    match: [
      'babysitter', 'babysitting', 'nanny', 'niñera', 'canguro', 'ama', 'baby-sitter', 'oppas', 'barnepige',
      'babysitning', 'niania', 'opiekunka', 'opieka nad dziećmi',
    ],
  },
];
