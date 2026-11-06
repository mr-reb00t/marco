// A Personalizado photo card and the sidebar's photo with photos of their own (#41): the Fondo's photo options in the
// editor. Admin text keyed by the Spanish string t() takes. Each row is [es, en, pt, nl, da, pl]. ROWS_PHOTOSOURCE
// feeds EN and PT (i18n-dict.ts); NL_PHOTOSOURCE, DA_PHOTOSOURCE and PL_PHOTOSOURCE are spread into NL, DA and PL.
const ROWS: [string, string, string, string, string, string][] = [
  ['Como el Fondo de la pantalla', 'Same as the screen’s Background', 'Como o Fundo do ecrã', 'Zoals de achtergrond van het scherm', 'Som skærmens baggrund', 'Jak tło ekranu'],
  ['Propias', 'Its own', 'Próprias', 'Eigen foto’s', 'Egne', 'Własne'],
  [
    'Empieza con las opciones del Fondo de la pantalla.',
    'It starts with the options of the screen’s Background.',
    'Começa com as opções do Fundo do ecrã.',
    'Begint met de instellingen van de achtergrond van het scherm.',
    'Starter med indstillingerne fra skærmens baggrund.',
    'Zaczyna od ustawień tła ekranu.',
  ],
  ['Se ve en la pantalla al guardar.', 'It shows on the screen once saved.', 'Vê-se no ecrã ao guardar.', 'Zichtbaar op het scherm na opslaan.', 'Vises på skærmen, når du gemmer.', 'Widać to na ekranie po zapisaniu.'],
  [
    'Lluvia o nieve sobre esta foto según el tiempo actual. No se muestra con Ahorro ni con ?lite=1.',
    'Rain or snow over this photo, after the current weather. Not shown with Saver or with ?lite=1.',
    'Chuva ou neve sobre esta foto, conforme o tempo atual. Não aparece com Poupança nem com ?lite=1.',
    'Regen of sneeuw over deze foto, naar het weer van nu. Niet met Zuinig of met ?lite=1.',
    'Regn eller sne over dette billede efter det aktuelle vejr. Vises ikke med Spar eller med ?lite=1.',
    'Deszcz lub śnieg na tym zdjęciu, zależnie od obecnej pogody. Nie pokazuje się w trybie Oszczędny ani z ?lite=1.',
  ],
  [
    'Lluvia, nieve, niebla y sol sobre esta foto, sin gotas en el cristal.',
    'Rain, snow, fog and sun over this photo, without drops on the glass.',
    'Chuva, neve, nevoeiro e sol sobre esta foto, sem gotas no vidro.',
    'Regen, sneeuw, mist en zon over deze foto, zonder druppels op het glas.',
    'Regn, sne, tåge og sol over dette billede, uden dråber på glasset.',
    'Deszcz, śnieg, mgła i słońce na tym zdjęciu, bez kropel na szybie.',
  ],
  [
    'La barra lateral o una tarjeta Foto de esta pantalla tiene sus propias fotos. Se cambian en el editor.',
    'The sidebar or a Photo card of this screen has its own photos. You change them in the editor.',
    'A barra lateral ou um cartão Foto deste ecrã tem as suas próprias fotos. Mudam-se no editor.',
    'De zijbalk of een Foto-kaart van dit scherm heeft eigen foto’s. Die pas je aan in de editor.',
    'Sidebjælken eller et Foto-kort på denne skærm har sine egne billeder. De ændres i editoren.',
    'Pasek boczny lub karta Zdjęcie na tym ekranie ma własne zdjęcia. Zmienia się je w edytorze.',
  ],
];

export const ROWS_PHOTOSOURCE: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_PHOTOSOURCE: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_PHOTOSOURCE: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const PL_PHOTOSOURCE: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
