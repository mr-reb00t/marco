// A "Grupo" on its own in the builder (#25) and the "Icono" of a Home Assistant card (#26). Admin text keyed by the
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
];

export const ROWS_GROUP: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_GROUP: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_GROUP: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const PL_GROUP: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
