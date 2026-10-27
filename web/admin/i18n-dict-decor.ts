// Seasonal decorations and the HTML overlay of a screen (#24, Pantalla → Ajustes). Admin text keyed by the Spanish
// string t() takes. Each row is [es, en, pt, nl, da, pl]. ROWS_DECOR feeds EN and PT (i18n-dict.ts); NL_DECOR,
// DA_DECOR and PL_DECOR are spread into NL, DA and PL.
const ROWS: [string, string, string, string, string, string][] = [
  ['Decoración de temporada', 'Seasonal decorations', 'Decoração da época', 'Seizoensversiering', 'Sæsonpynt', 'Dekoracje sezonowe'],
  [
    'Luces, nieve o confeti que dibuja Marco, sin código. Se quedan en el borde de arriba y no tapan nada importante.',
    'Lights, snow or confetti drawn by Marco, no code needed. They stay along the top edge and cover nothing important.',
    'Luzes, neve ou confettis desenhados pelo Marco, sem código. Ficam na margem de cima e não tapam nada importante.',
    'Lichtjes, sneeuw of confetti die Marco zelf tekent, zonder code. Ze blijven langs de bovenrand en bedekken niets belangrijks.',
    'Lys, sne eller konfetti, som Marco selv tegner, uden kode. De holder sig langs den øverste kant og dækker intet vigtigt.',
    'Światełka, śnieg lub konfetti rysowane przez Marco, bez kodu. Zostają przy górnej krawędzi i nie zasłaniają niczego ważnego.',
  ],
  ['Decoración', 'Decoration', 'Decoração', 'Versiering', 'Pynt', 'Dekoracja'],
  ['Automática (según la fecha)', 'Automatic (by the date)', 'Automática (conforme a data)', 'Automatisch (op datum)', 'Automatisk (efter datoen)', 'Automatyczna (według daty)'],
  ['Halloween', 'Halloween', 'Halloween', 'Halloween', 'Halloween', 'Halloween'],
  ['Año Nuevo', 'New Year', 'Ano Novo', 'Oud en nieuw', 'Nytår', 'Nowy Rok'],
  [
    'Navidad del 1 de diciembre al 6 de enero, Halloween del 24 al 31 de octubre y Año Nuevo el 31 de diciembre y el 1 de enero.',
    'Christmas from 1 December to 6 January, Halloween from 24 to 31 October and New Year on 31 December and 1 January.',
    'Natal de 1 de dezembro a 6 de janeiro, Halloween de 24 a 31 de outubro e Ano Novo a 31 de dezembro e 1 de janeiro.',
    'Kerst van 1 december tot 6 januari, Halloween van 24 tot 31 oktober en oud en nieuw op 31 december en 1 januari.',
    'Jul fra 1. december til 6. januar, halloween fra 24. til 31. oktober og nytår den 31. december og 1. januar.',
    'Boże Narodzenie od 1 grudnia do 6 stycznia, Halloween od 24 do 31 października, a Nowy Rok 31 grudnia i 1 stycznia.',
  ],
  ['Nieve', 'Snow', 'Neve', 'Sneeuw', 'Sne', 'Śnieg'],
  [
    'Unos pocos copos que caen despacio, con las luces de Navidad.',
    'A few flakes falling slowly, with the Christmas lights.',
    'Alguns flocos a cair devagar, com as luzes de Natal.',
    'Een paar vlokken die langzaam vallen, bij de kerstverlichting.',
    'Nogle få fnug, der falder langsomt, sammen med julelysene.',
    'Kilka płatków spadających powoli, razem ze światełkami świątecznymi.',
  ],
  [
    'En modo ligero, en Ahorro o con menos movimiento, las luces se quedan quietas y no hay nieve ni confeti.',
    'In lite mode, with Saver or with reduced motion, the lights stay still and there is no snow or confetti.',
    'No modo leve, em Poupança ou com menos movimento, as luzes ficam paradas e não há neve nem confettis.',
    'In de eenvoudige modus, bij Zuinig of met minder beweging blijven de lichtjes stil en is er geen sneeuw of confetti.',
    'I lite-tilstand, med Spar eller med mindre bevægelse står lysene stille, og der er hverken sne eller konfetti.',
    'W trybie lekkim, w trybie Oszczędnym lub przy ograniczonym ruchu światełka stoją w miejscu, a śniegu ani konfetti nie ma.',
  ],
  ['HTML sobre la pantalla', 'HTML over the screen', 'HTML sobre o ecrã', 'HTML over het scherm', 'HTML over skærmen', 'HTML nad ekranem'],
  [
    'Tu propio HTML y CSS, dibujado encima de toda la pantalla (por ejemplo, unas luces en diciembre).',
    'Your own HTML and CSS, drawn over the whole screen (for example, some lights in December).',
    'O seu próprio HTML e CSS, desenhado por cima de todo o ecrã (por exemplo, umas luzes em dezembro).',
    'Je eigen HTML en CSS, over het hele scherm getekend (bijvoorbeeld lichtjes in december).',
    'Din egen HTML og CSS, tegnet over hele skærmen (for eksempel nogle lys i december).',
    'Twój własny HTML i CSS, rysowany nad całym ekranem (na przykład światełka w grudniu).',
  ],
  [
    'Los scripts no se ejecutan y solo se cargan imágenes https o data:. No recibe toques: la pantalla sigue funcionando debajo.',
    'Scripts do not run and only https or data: images load. It takes no taps: the screen keeps working underneath.',
    'Os scripts não são executados e só se carregam imagens https ou data:. Não recebe toques: o ecrã continua a funcionar por baixo.',
    'Scripts worden niet uitgevoerd en alleen https- of data:-afbeeldingen worden geladen. Het reageert niet op tikken: het scherm eronder blijft gewoon werken.',
    'Scripts køres ikke, og kun https- eller data:-billeder indlæses. Det tager ikke imod tryk: skærmen virker fortsat nedenunder.',
    'Skrypty się nie uruchamiają, a wczytywane są tylko obrazy https lub data:. Nie reaguje na dotyk: ekran pod spodem działa dalej.',
  ],
  ['Cada año entre dos fechas', 'Every year between two dates', 'Todos os anos entre duas datas', 'Elk jaar tussen twee datums', 'Hvert år mellem to datoer', 'Co roku między dwiema datami'],
  ['{used} de {max} caracteres', '{used} of {max} characters', '{used} de {max} caracteres', '{used} van {max} tekens', '{used} af {max} tegn', '{used} z {max} znaków'],
];

export const ROWS_DECOR: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_DECOR: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_DECOR: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const PL_DECOR: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
