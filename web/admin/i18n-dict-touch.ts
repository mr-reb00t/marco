// Touch on the calendar (#51): the "Pantalla táctil" switch of a screen and its search entry. Admin text keyed by the
// Spanish string t() takes. Each row is [es, en, pt, nl, da, pl, de]. ROWS_TOUCH feeds EN and PT (i18n-dict.ts);
// NL_TOUCH, DA_TOUCH, PL_TOUCH and DE_TOUCH are spread into NL, DA, PL and DE.
const ROWS: [string, string, string, string, string, string, string][] = [
  ['Pantalla táctil', 'Touch screen', 'Ecrã tátil', 'Touchscreen', 'Touchskærm', 'Ekran dotykowy', 'Touchscreen'],
  [
    'Toca eventos y días, cambia de mes. Vuelve a hoy tras 2 minutos sin tocar.',
    'Tap events and days, change months. Back to today after 2 minutes without a touch.',
    'Toca em eventos e dias, muda de mês. Volta a hoje após 2 minutos sem toques.',
    'Tik op afspraken en dagen, wissel van maand. Terug naar vandaag na 2 minuten zonder aanraking.',
    'Tryk på begivenheder og dage, skift måned. Tilbage til i dag efter 2 minutter uden berøring.',
    'Dotknij wydarzeń i dni, zmieniaj miesiące. Powrót do dziś po 2 minutach bez dotyku.',
    'Tippe auf Termine und Tage, wechsle den Monat. Zurück zu heute nach 2 Minuten ohne Berührung.',
  ],
];

export const ROWS_TOUCH: [string, string, string][] = ROWS.map(([es, en, pt]) => [es, en, pt]);
export const NL_TOUCH: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[3]]));
export const DA_TOUCH: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[4]]));
export const PL_TOUCH: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[5]]));
export const DE_TOUCH: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r[0], r[6]]));
