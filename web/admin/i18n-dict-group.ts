// A "Grupo" on its own in the builder (#25), the "Icono" of a Home Assistant card (#26) and an Entidad's second sensor (#28), the Bolsa card's currency and labels. Admin text keyed by the
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
];

// the Bolsa card's currencies (fieldSpecs.ts): an ISO code reads the same in every language
for (const c of ['AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR']) {
  ROWS.push([c, c, c, c, c, c]);
}

export const ROWS_GROUP: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_GROUP: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_GROUP: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const PL_GROUP: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
