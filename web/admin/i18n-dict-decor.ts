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
  ['Cada año entre dos fechas', 'Every year between two dates', 'Todos os anos entre duas datas', 'Elk jaar tussen twee datums', 'Hvert år mellem to datoer', 'Co roku między dwiema datami'],
  ['{used} de {max} caracteres', '{used} of {max} characters', '{used} de {max} caracteres', '{used} van {max} tekens', '{used} af {max} tegn', '{used} z {max} znaków'],
  ['Fechas de cada una', 'Dates of each', 'Datas de cada uma', 'Datums van elk', 'Datoer for hver', 'Daty każdej'],
  [
    'Cada año, los dos días incluidos. Si dos coinciden, gana Año Nuevo, luego Navidad y luego Halloween.',
    'Every year, both days included. If two overlap, New Year wins, then Christmas, then Halloween.',
    'Todos os anos, com os dois dias incluídos. Se duas coincidirem, ganha o Ano Novo, depois o Natal e depois o Halloween.',
    'Elk jaar, beide dagen inbegrepen. Als er twee samenvallen, gaat oud en nieuw voor, dan kerst en dan Halloween.',
    'Hvert år, begge dage medregnet. Hvis to overlapper, vinder nytår, så jul og så halloween.',
    'Co roku, oba dni włącznie. Jeśli dwie się pokrywają, wygrywa Nowy Rok, potem Boże Narodzenie, potem Halloween.',
  ],
  ['Volver a las fechas de siempre', 'Back to the usual dates', 'Voltar às datas habituais', 'Terug naar de gewone datums', 'Tilbage til de sædvanlige datoer', 'Przywróć zwykłe daty'],
  [
    'Puedes tener hasta {n}, cada uno con sus fechas; los que coinciden se ven a la vez. Los scripts no se ejecutan y solo se cargan imágenes https o data:. No reciben toques: la pantalla sigue funcionando debajo.',
    'You can have up to {n}, each with its own dates; those that overlap show together. Scripts do not run and only https or data: images load. They take no taps: the screen keeps working underneath.',
    'Pode ter até {n}, cada um com as suas datas; os que coincidem veem-se ao mesmo tempo. Os scripts não são executados e só se carregam imagens https ou data:. Não recebem toques: o ecrã continua a funcionar por baixo.',
    'Je kunt er tot {n} hebben, elk met eigen datums; die samenvallen zie je tegelijk. Scripts worden niet uitgevoerd en alleen https- of data:-afbeeldingen worden geladen. Ze reageren niet op tikken: het scherm eronder blijft gewoon werken.',
    'Du kan have op til {n}, hver med sine egne datoer; dem, der overlapper, vises samtidig. Scripts køres ikke, og kun https- eller data:-billeder indlæses. De tager ikke imod tryk: skærmen virker fortsat nedenunder.',
    'Możesz mieć do {n}, każdy z własnymi datami; te, które się pokrywają, widać naraz. Skrypty się nie uruchamiają, a wczytywane są tylko obrazy https lub data:. Nie reagują na dotyk: ekran pod spodem działa dalej.',
  ],
  ['{used} de {max} KB entre todos.', '{used} of {max} KB for all of them.', '{used} de {max} KB entre todos.', '{used} van {max} KB voor alles samen.', '{used} af {max} KB i alt.', '{used} z {max} KB łącznie.'],
  ['Nombre, p. ej. Luces de Navidad', 'Name, e.g. Christmas lights', 'Nome, p. ex. Luzes de Natal', 'Naam, bijv. Kerstverlichting', 'Navn, f.eks. Julelys', 'Nazwa, np. Światełka świąteczne'],
  ['Añadir HTML', 'Add HTML', 'Adicionar HTML', 'HTML toevoegen', 'Tilføj HTML', 'Dodaj HTML'],
  ['Añadir otro HTML', 'Add another HTML', 'Adicionar outro HTML', 'Nog een HTML toevoegen', 'Tilføj endnu en HTML', 'Dodaj kolejny HTML'],
];

export const ROWS_DECOR: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_DECOR: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_DECOR: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const PL_DECOR: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
