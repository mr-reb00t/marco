// A "Grupo" on its own in the builder (#25), the "Icono" of a Home Assistant card (#26) and an Entidad's second sensor (#28), the Bolsa card's currency and labels, the calendar's grid lines (#29) and past events (#32). Admin text keyed by the
// Spanish string t() takes. Each row is [es, en, pt, nl, da, pl]. ROWS_GROUP feeds EN and PT (i18n-dict.ts); NL_GROUP, DA_GROUP and PL_GROUP are spread into
// NL, DA and PL.
const ROWS: [string, string, string, string, string, string][] = [
  [
    'De 2 a 4 tarjetas en el hueco de una, en filas o en columnas.',
    '2 to 4 cards in the space of one, in rows or in columns.',
    'De 2 a 4 cartões no espaço de um, em linhas ou em colunas.',
    '2 tot 4 kaarten op de plek van één, in rijen of in kolommen.',
    '2 til 4 kort på pladsen til ét, i rækker eller i kolonner.',
    'Od 2 do 4 kart w miejscu jednej, w wierszach lub w kolumnach.',
  ],
  [
    'Las tarjetas de un grupo solo se ven: no se pueden tocar en la pantalla.',
    'The cards of a group are only shown: they cannot be tapped on the screen.',
    'Os cartões de um grupo só se veem: não se podem tocar no ecrã.',
    'De kaarten van een groep zijn alleen te zien: je kunt ze op het scherm niet aantikken.',
    'Kortene i en gruppe vises kun: de kan ikke trykkes på skærmen.',
    'Karty grupy są tylko do oglądania: nie można ich dotykać na ekranie.',
  ],
  [
    'Auto: según lo que es. Una batería muestra cuánta carga le queda.',
    'Auto: by what it is. A battery shows how much charge it has left.',
    'Auto: conforme o que é. Uma bateria mostra quanta carga lhe resta.',
    'Auto: naar wat het is. Een batterij laat zien hoeveel lading er nog in zit.',
    'Auto: efter hvad det er. Et batteri viser, hvor meget strøm der er tilbage.',
    'Auto: według tego, czym jest. Bateria pokazuje, ile ładunku jej zostało.',
  ],
  ['Segundo sensor', 'Second sensor', 'Segundo sensor', 'Tweede sensor', 'Anden sensor', 'Drugi czujnik'],
  [
    'Su valor sale detrás del primero, por ejemplo 21,4 °C / 48 %.',
    'Its value shows after the first one, for example 21.4 °C / 48 %.',
    'O seu valor aparece a seguir ao primeiro, por exemplo 21,4 °C / 48 %.',
    'De waarde staat na de eerste, bijvoorbeeld 21,4 °C / 48 %.',
    'Værdien vises efter den første, for eksempel 21,4 °C / 48 %.',
    'Jego wartość pojawia się po pierwszej, na przykład 21,4 °C / 48 %.',
  ],
  [
    'Su valor sale detrás del número, por ejemplo 80 % / 320 km.',
    'Its value shows after the number, for example 80 % / 200 mi.',
    'O seu valor aparece a seguir ao número, por exemplo 80 % / 320 km.',
    'De waarde staat na het getal, bijvoorbeeld 80 % / 320 km.',
    'Værdien vises efter tallet, for eksempel 80 % / 320 km.',
    'Jego wartość pojawia się po liczbie, na przykład 80 % / 320 km.',
  ],
  ['En grande, si hay varios valores se van turnando.', 'Large: with several quotes, they take turns.', 'Em grande: com vários valores, vão alternando.', 'Groot: met meerdere koersen wisselen ze elkaar af.', 'Stor: med flere kurser skiftes de.', 'Duża: przy kilku notowaniach zmieniają się po kolei.'],
  ['Símbolo y nombre', 'Symbol and name', 'Símbolo e nome', 'Symbool en naam', 'Symbol og navn', 'Symbol i nazwa'],
  ['Solo el nombre', 'Name only', 'Só o nome', 'Alleen de naam', 'Kun navnet', 'Tylko nazwa'],
  ['Solo el símbolo', 'Symbol only', 'Só o símbolo', 'Alleen het symbool', 'Kun symbolet', 'Tylko symbol'],
  ['El nombre es el que le pones tú a cada valor.', 'The name is the one you give each quote.', 'O nome é o que dás a cada valor.', 'De naam is die je zelf aan elke koers geeft.', 'Navnet er det, du selv giver hver kurs.', 'Nazwa to ta, którą sam nadajesz każdemu notowaniu.'],
  ['Sin símbolo', 'No sign', 'Sem símbolo', 'Zonder teken', 'Uden tegn', 'Bez symbolu'],
  ['Dólar ($)', 'Dollar ($)', 'Dólar ($)', 'Dollar ($)', 'Dollar ($)', 'Dolar ($)'],
  ['Euro (€)', 'Euro (€)', 'Euro (€)', 'Euro (€)', 'Euro (€)', 'Euro (€)'],
  [
    'Los precios llegan en dólares. En otra moneda se pasan con el cambio del Banco Central Europeo de ese día.',
    'Prices come in dollars. In another currency they are converted at that day\'s European Central Bank rate.',
    'Os preços chegam em dólares. Noutra moeda são convertidos com o câmbio do Banco Central Europeu desse dia.',
    'De koersen komen in dollars. In een andere munt worden ze omgerekend met de koers van de Europese Centrale Bank van die dag.',
    'Kurserne kommer i dollar. I en anden valuta omregnes de med Den Europæiske Centralbanks kurs for den dag.',
    'Ceny przychodzą w dolarach. W innej walucie są przeliczane po kursie Europejskiego Banku Centralnego z danego dnia.',
  ],
  [
    'De fondo: la curva detrás del precio, de borde a borde; en una lista, cada valor lleva la suya detrás.',
    'Background: the curve behind the price, edge to edge; in a list, each quote has its own behind it.',
    'De fundo: a curva atrás do preço, de ponta a ponta; numa lista, cada valor tem a sua atrás.',
    'Achtergrond: de lijn achter de koers, van rand tot rand; in een lijst heeft elke koers de zijne erachter.',
    'Baggrund: kurven bag prisen, fra kant til kant; i en liste har hver kurs sin egen bagved.',
    'W tle: krzywa za ceną, od krawędzi do krawędzi; na liście każde notowanie ma swoją za sobą.',
  ],
  ['Líneas de la cuadrícula', 'Grid lines', 'Linhas da grelha', 'Rasterlijnen', 'Gitterlinjer', 'Linie siatki'],
  ['Marcadas', 'Clear', 'Marcadas', 'Duidelijk', 'Tydelige', 'Wyraźne'],
  ['Fuertes', 'Strong', 'Fortes', 'Sterk', 'Kraftige', 'Mocne'],
  ['Color de las líneas', 'Line colour', 'Cor das linhas', 'Kleur van de lijnen', 'Farve på linjerne', 'Kolor linii'],
  ['Su color, en la pestaña Estilo.', 'Their colour is in the Style tab.', 'A cor está no separador Estilo.', 'De kleur staat op het tabblad Stijl.', 'Farven finder du på fanen Stil.', 'Ich kolor jest w karcie Styl.'],
  ['Su color: Auto es el del tema.', 'Colour: Auto follows the theme.', 'Cor: Auto segue o tema.', 'Kleur: Auto volgt het thema.', 'Farve: Auto følger temaet.', 'Kolor: Auto zgodnie z motywem.'],
  // how faded the events that have ended are (#32)
  ['Eventos pasados', 'Past events', 'Eventos passados', 'Voorbije afspraken', 'Tidligere begivenheder', 'Minione wydarzenia'],
  ['Atenuados', 'Dimmed', 'Esbatidos', 'Gedimd', 'Dæmpede', 'Przygaszone'],
  ['Un poco', 'Slightly', 'Um pouco', 'Een beetje', 'Lidt', 'Trochę'],
  ['Normales', 'Normal', 'Normais', 'Normaal', 'Normale', 'Normalne'],
  [
    'Cuánto se apagan los que ya han terminado.',
    'How much the ones that have ended fade.',
    'Quanto se esbatem os que já terminaram.',
    'Hoeveel de afspraken die al voorbij zijn vervagen.',
    'Hvor meget dem, der er slut, tones ned.',
    'Jak bardzo przygasają te, które już się skończyły.',
  ],
  // the Value widget (#34)
  ['Valor {n}', 'Value {n}', 'Valor {n}', 'Waarde {n}', 'Værdi {n}', 'Wartość {n}'],
  ['Añadir otro valor', 'Add another value', 'Adicionar outro valor', 'Nog een waarde toevoegen', 'Tilføj en værdi mere', 'Dodaj kolejną wartość'],
  ['Baterías de los coches', 'Car batteries', 'Baterias dos carros', 'Accu van de auto’s', 'Bilernes batterier', 'Baterie samochodów'],
  ['Añade al menos un valor', 'Add at least one value', 'Adiciona pelo menos um valor', 'Voeg minstens één waarde toe', 'Tilføj mindst én værdi', 'Dodaj co najmniej jedną wartość'],
  ['Escribe la clave de cada valor', 'Type the key of each value', 'Escreve a chave de cada valor', 'Vul de sleutel van elke waarde in', 'Skriv nøglen til hver værdi', 'Wpisz klucz każdej wartości'],
  [
    'Un valor que no se ha actualizado en ese tiempo sale en gris. 0: nunca.',
    'A value not updated for that long is greyed out. 0: never.',
    'Um valor que não é atualizado nesse tempo fica a cinzento. 0: nunca.',
    'Een waarde die zo lang niet is bijgewerkt, wordt grijs. 0: nooit.',
    'En værdi, der ikke er opdateret så længe, bliver grå. 0: aldrig.',
    'Wartość, która tak długo się nie zmieniła, robi się szara. 0: nigdy.',
  ],
  [
    'Números que Home Assistant u otro programa envía a Marco: la batería del coche, la producción solar. Uno en grande, o varios en lista.',
    'Numbers Home Assistant or another program sends to Marco: the car battery, the solar output. One large, or several as a list.',
    'Números que o Home Assistant ou outro programa envia ao Marco: a bateria do carro, a produção solar. Um em grande, ou vários em lista.',
    'Getallen die Home Assistant of een ander programma naar Marco stuurt: de accu van de auto, de zonnepanelen. Eén groot, of meerdere in een lijst.',
    'Tal, som Home Assistant eller et andet program sender til Marco: bilens batteri, solcellerne. Ét stort, eller flere i en liste.',
    'Liczby, które Home Assistant lub inny program wysyła do Marco: bateria samochodu, produkcja z paneli. Jedna duża albo kilka na liście.',
  ],
  // how much the events' background covers what is behind them (#32)
  ['Fondo de los eventos', 'Event background', 'Fundo dos eventos', 'Achtergrond van afspraken', 'Baggrund for begivenheder', 'Tło wydarzeń'],
  ['Suave', 'Soft', 'Suave', 'Zacht', 'Blød', 'Delikatne'],
  ['Más opaco', 'More solid', 'Mais opaco', 'Voller', 'Mere dækkende', 'Mocniejsze'],
  ['Sólido', 'Solid', 'Sólido', 'Vol', 'Fyldt', 'Pełne'],
  [
    'Más opaco o Sólido se leen mejor sobre una foto.',
    'More solid or Solid read better over a photo.',
    'Mais opaco ou Sólido leem-se melhor sobre uma foto.',
    'Voller of Vol leest beter op een foto.',
    'Mere dækkende eller Fyldt er lettere at læse oven på et foto.',
    'Mocniejsze lub Pełne lepiej czytać na zdjęciu.',
  ],
  // where the layouts put the clock, and how large (#36)
  [
    'Automática: donde lo pone el diseño. Con la fecha y los avisos de debajo.',
    'Automatic: where the layout puts it. The date and the notes under it move with it.',
    'Automática: onde o design o coloca. Com a data e os avisos por baixo.',
    'Automatisch: waar de indeling hem zet. De datum en de meldingen eronder gaan mee.',
    'Automatisk: hvor layoutet placerer det. Datoen og beskederne under følger med.',
    'Automatycznie: tam, gdzie umieszcza go układ. Data i powiadomienia pod nim przesuwają się razem z nim.',
  ],
  [
    'Nunca pasa del ancho de su panel: para un reloj más grande, ensancha el panel o quita los segundos.',
    'It never gets wider than its panel: for a larger clock, widen the panel or hide the seconds.',
    'Nunca passa da largura do seu painel: para um relógio maior, alarga o painel ou tira os segundos.',
    'Hij wordt nooit breder dan zijn paneel: voor een grotere klok maak je het paneel breder of verberg je de seconden.',
    'Det bliver aldrig bredere end sit panel: vil du have et større ur, så gør panelet bredere eller skjul sekunderne.',
    'Nigdy nie jest szerszy niż jego panel: aby zegar był większy, poszerz panel lub ukryj sekundy.',
  ],
  // a photo card behind the other cards on Personalizado (#36)
  ['Detrás de las otras tarjetas', 'Behind the other cards', 'Atrás dos outros cartões', 'Achter de andere kaarten', 'Bag de andre kort', 'Za innymi kartami'],
  [
    'Las demás tarjetas se pueden poner encima de la foto. Solo en la zona principal, no en la barra lateral.',
    'The other cards can be placed over the photo. Only in the main area, not in the sidebar.',
    'Os outros cartões podem ser colocados por cima da foto. Só na zona principal, não na barra lateral.',
    'De andere kaarten kunnen op de foto worden gezet. Alleen in het hoofdgedeelte, niet in de zijbalk.',
    'De andre kort kan placeres oven på fotoet. Kun i hovedområdet, ikke i sidebjælken.',
    'Pozostałe karty można umieścić na zdjęciu. Tylko w obszarze głównym, nie na pasku bocznym.',
  ],
  // ... out to the edges of the screen
  ['Hasta el borde de la pantalla', 'Out to the screen edge', 'Até à borda do ecrã', 'Tot aan de rand van het scherm', 'Helt ud til skærmkanten', 'Do krawędzi ekranu'],
  [
    'Esquinas rectas, y la foto llega al borde de la pantalla por los lados donde lo toca, como la foto del diseño Moderno. Solo en la zona principal.',
    'Square corners, and the photo reaches the edge of the screen on the sides where it touches it, like the photo of the Modern design. Only in the main area.',
    'Cantos retos, e a foto chega à borda do ecrã nos lados onde lhe toca, como a foto do design Moderno. Só na zona principal.',
    'Rechte hoeken, en de foto loopt door tot de rand van het scherm aan de kanten waar hij die raakt, zoals de foto van het ontwerp Modern. Alleen in het hoofdgedeelte.',
    'Lige hjørner, og fotoet går helt ud til skærmkanten på de sider, hvor det rører den, som fotoet i designet Moderne. Kun i hovedområdet.',
    'Proste rogi, a zdjęcie sięga krawędzi ekranu po stronach, gdzie jej dotyka, jak zdjęcie w projekcie Nowoczesny. Tylko w obszarze głównym.',
  ],
  [
    'Delante de las otras tarjetas no hay sitio libre para la foto, así que sigue detrás. Haz sitio o hazla más pequeña.',
    'There is no free room for the photo in front of the other cards, so it stays behind them. Make room or make it smaller.',
    'À frente dos outros cartões não há espaço livre para a foto, por isso fica atrás. Abre espaço ou torna-a mais pequena.',
    'Voor de andere kaarten is geen vrije plek voor de foto, dus blijft hij erachter. Maak ruimte of maak hem kleiner.',
    'Der er ikke plads til fotoet foran de andre kort, så det bliver bagved. Gør plads eller gør det mindre.',
    'Przed innymi kartami nie ma wolnego miejsca na zdjęcie, więc zostaje za nimi. Zrób miejsce lub je zmniejsz.',
  ],
];

// the Bolsa card's currencies (fieldSpecs.ts): an ISO code reads the same in every language
for (const c of ['AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR']) {
  ROWS.push([c, c, c, c, c, c]);
}

export const ROWS_GROUP: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_GROUP: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_GROUP: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const PL_GROUP: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
