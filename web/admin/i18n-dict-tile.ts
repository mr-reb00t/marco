// The Entidad card (ha.tile) of Personalizado: admin text keyed by the Spanish string t() takes.
// Each row is [es, en, pt, nl, da, de]. ROWS_TILE feeds EN and PT (i18n-dict.ts); NL_TILE and DA_TILE are spread into NL
// and DA.
const ROWS: [string, string, string, string, string, string][] = [
  [
    'Una fila en los tamaños pequeño y ancho, dos en el mediano. En el mini y en la línea no se ven. Toca el icono para encender o apagar.',
    'One row on the small and wide sizes, two on the medium one. The mini and line sizes show none. Tap the icon to turn it on or off.',
    'Uma linha nos tamanhos pequeno e largo, duas no médio. No mini e na linha não aparecem. Toca no ícone para ligar ou desligar.',
    'Eén rij bij klein en breed, twee bij middel. Bij mini en lijn zie je ze niet. Tik op het pictogram om aan of uit te zetten.',
    'Én række i lille og bred størrelse, to i mellem. I mini og linje vises de ikke. Tryk på ikonet for at tænde eller slukke.',
    'Eine Reihe in den Größen Klein und Breit, zwei in Mittel. In Mini und Zeile nicht sichtbar. Tippe auf das Symbol zum Ein- oder Ausschalten.',
  ],
  ['Mostrar nombre', 'Show name', 'Mostrar nome', 'Naam tonen', 'Vis navn', 'Name anzeigen'],
  ['Mostrar estado', 'Show state', 'Mostrar estado', 'Status tonen', 'Vis tilstand', 'Status anzeigen'],
  [
    'La línea que dice cómo está (Encendido, Abierta, 21 °C).',
    'The line that says how it is (On, Open, 21 °C).',
    'A linha que diz como está (Ligado, Aberta, 21 °C).',
    'De regel die zegt hoe het ervoor staat (Aan, Open, 21 °C).',
    'Linjen der fortæller, hvordan den er (Tændt, Åben, 21 °C).',
    'Die Zeile, die den Zustand zeigt (An, Offen, 21 °C).',
  ],
  [
    'Los que se pueden elegir en la pantalla. Automático: apagado y los dos que más se usan de los que tiene.',
    'The ones that can be chosen on the screen. Automatic: off and the two most used ones it has.',
    'Os que se podem escolher no ecrã. Automático: desligado e os dois mais usados dos que tem.',
    'Die je op het scherm kunt kiezen. Automatisch: uit en de twee meest gebruikte die het heeft.',
    'Dem, der kan vælges på skærmen. Automatisk: slukket og de to mest brugte, den har.',
    'Die, die am Bildschirm wählbar sind. Automatisch: Aus und die zwei meistgenutzten, die es hat.',
  ],
  ['En los tamaños mediano y alto.', 'On the medium and tall sizes.', 'Nos tamanhos médio e alto.', 'Bij middel en hoog.', 'I mellem og høj størrelse.', 'In den Größen Mittel und Hoch.'],
  ['Ajustar tamaño', 'Fit the size', 'Ajustar tamanho', 'Formaat aanpassen', 'Tilpas størrelsen', 'Größe anpassen'],
  [
    'No hay sitio para un tamaño mayor. Haz sitio a su alrededor o elige otro tamaño.',
    'There is no room for a larger size. Make room around it or pick another size.',
    'Não há espaço para um tamanho maior. Abre espaço à volta ou escolhe outro tamanho.',
    'Er is geen ruimte voor een groter formaat. Maak ruimte eromheen of kies een ander formaat.',
    'Der er ikke plads til en større størrelse. Gør plads omkring den, eller vælg en anden størrelse.',
    'Für eine größere Größe ist kein Platz. Schaffe Platz drumherum oder wähle eine andere Größe.',
  ],
  [
    'El contenido no cabe entero; selecciónalo y pulsa Ajustar tamaño',
    'The content does not fit; select it and press Fit the size',
    'O conteúdo não cabe inteiro; seleciona-o e carrega em Ajustar tamanho',
    'De inhoud past niet helemaal; selecteer hem en druk op Formaat aanpassen',
    'Indholdet er der ikke plads til; vælg det, og tryk på Tilpas størrelsen',
    'Der Inhalt passt nicht ganz; wähle ihn aus und tippe auf Größe anpassen',
  ],
  ['En pantallas lentas se muestra sin desenfoque', 'On slow screens it is shown without blur', 'Em ecrãs lentos aparece sem desfocagem', 'Op trage schermen zonder vervaging', 'På langsomme skærme vises den uden sløring', 'Auf langsamen Bildschirmen ohne Unschärfe'],
  ['Nada', 'Nothing', 'Nada', 'Niets', 'Intet', 'Nichts'],
  ['Cuadrado', 'Square', 'Quadrado', 'Vierkant', 'Kvadrat', 'Quadratisch'],
  ['Toca el icono para encender o apagar.', 'Tap the icon to turn it on or off.', 'Toca no ícone para ligar ou desligar.', 'Tik op het pictogram om aan of uit te zetten.', 'Tryk på ikonet for at tænde eller slukke.', 'Tippe auf das Symbol zum Ein- oder Ausschalten.'],
  [
    'Desde el tamaño pequeño. Automático: los colores si la luz los tiene. En los tamaños cuadrado, mediano y alto, también el brillo.',
    'From the small size up. Automatic: the colours when the light has them. On the square, medium and tall sizes, the brightness too.',
    'A partir do tamanho pequeno. Automático: as cores se a luz as tiver. Nos tamanhos quadrado, médio e alto, também o brilho.',
    'Vanaf klein. Automatisch: de kleuren als de lamp ze heeft. Bij vierkant, middel en hoog ook de helderheid.',
    'Fra lille størrelse. Automatisk: farverne, hvis lampen har dem. I kvadrat, mellem og høj også lysstyrken.',
    'Ab der Größe Klein. Automatisch: die Farben, wenn das Licht welche hat. In den Größen Quadratisch, Mittel und Hoch auch die Helligkeit.',
  ],
  // flexible sizes: any width and height in grid cells within each card's range
  [
    'Este widget no puede ser más grande ni más pequeño en ese sentido',
    'This widget cannot get any bigger or smaller that way',
    'Este widget não pode ficar maior nem mais pequeno nesse sentido',
    'Deze widget kan in die richting niet groter of kleiner',
    'Denne widget kan ikke blive større eller mindre den vej',
    'Dieses Widget kann in dieser Richtung nicht größer oder kleiner werden',
  ],
  ['Tamaño {w}×{h}', 'Size {w}×{h}', 'Tamanho {w}×{h}', 'Formaat {w}×{h}', 'Størrelse {w}×{h}', 'Größe {w}×{h}'],
  ['máximo', 'largest', 'máximo', 'grootst', 'størst', 'maximal'],
  ['mínimo', 'smallest', 'mínimo', 'kleinst', 'mindst', 'minimal'],
  ['Altura', 'Height', 'Altura', 'Hoogte', 'Højde', 'Höhe'],
  [
    'En cuadros de la cuadrícula. Este widget va de {min} a {max}.',
    'In grid squares. This widget goes from {min} to {max}.',
    'Em quadrados da grelha. Este widget vai de {min} a {max}.',
    'In vakjes van het raster. Deze widget gaat van {min} tot {max}.',
    'I felter i gitteret. Denne widget går fra {min} til {max}.',
    'In Rasterfeldern. Dieses Widget geht von {min} bis {max}.',
  ],
  [
    'El contenido no cabe entero. Pulsa para ajustar el tamaño.',
    'The content does not fit. Tap to fit the size.',
    'O conteúdo não cabe todo. Toca para ajustar o tamanho.',
    'De inhoud past niet helemaal. Tik om het formaat aan te passen.',
    'Indholdet er der ikke plads til. Tryk for at tilpasse størrelsen.',
    'Der Inhalt passt nicht ganz. Tippe, um die Größe anzupassen.',
  ],
];

export const ROWS_TILE: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_TILE: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_TILE: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const DE_TILE: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
