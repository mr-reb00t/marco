// Built-in realistic demo dataset (used with ?demo=1 or when /api is unreachable in dev).
// Everything is generated relative to "today" so screenshots always look populated.
import { presetBands } from '../../server/core/tariffsCore.js';
import type {
  AlertStyle, Announcement, CalEvent, CarouselTransition, ChoreSlot, CountdownItem, CountdownsResponse, DisplayConfig, EventsResponse,
  FamilyChoreView, FamilyDisplayState, FamilyMemberView, MealSlot, NewsResponse, PhotosResponse, PublicCalendarSource, SourceKind,
  WeatherResponse,
} from '../shared/types';
import { DEFAULT_ICON_RULES, resolveEventStyle } from '../shared/emoji';
import { addDays, dateKeyInTz, keyToUTC, normLang, pad2, startOfWeek, zonedParts } from '../shared/i18n';
import { DEMO_FAMILY_EN, DEMO_NEWS, DEMO_NL_DA } from './mock-text';
import { DEFAULT_CONFIG, deepMerge } from './defaults';
import { DEMO_WIDGET, mockCanvas } from './mockCanvas';
import { SHOW_ACTIVE, SHOW_CAROUSEL, SHOW_CAROUSEL_STEPS, SHOWCASES, showCountdowns, showcaseOf, showPhoto } from './showcase';

// The demo runs in Lisbon unless ?tz= names another IANA zone (the website passes the visitor's own zone).
const TZ = (() => {
  const tz = new URLSearchParams(location.search).get('tz');
  if (!tz) return 'Europe/Lisbon';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'Europe/Lisbon';
  }
})();

// Demo text follows ?lang=en|es|pt|nl|da (English by default).
const DEMO_LANG = normLang(new URLSearchParams(location.search).get('lang'));
/** A showcase screen in English (&shot=show.* or the showcase carousel, web/display/showcase/): the family demo in English too. */
const SHOW_EN = DEMO_LANG === 'en' && SHOW_ACTIVE;
/** Column of DEMO_NL_DA for Dutch and Danish, else null. */
const NL_DA: 0 | 1 | null = DEMO_LANG === 'nl' ? 0 : DEMO_LANG === 'da' ? 1 : null;
/** ?empty=1: no events, no countdowns, no to-dos (empty states). */
const EMPTY = new URLSearchParams(location.search).get('empty') === '1';
/** ?sparse=1: a quiet calendar, a few events and most of them weeks away (to see how far the agenda looks ahead). */
const SPARSE = new URLSearchParams(location.search).get('sparse') === '1';
/** ?busy=1: a day with more events than fit, and long titles (to see the sliding titles and the busy-day pages). */
const BUSY_Q = new URLSearchParams(location.search).get('busy');
/** ?busy=2: the same, plus a whole month packed with events (compact busy days). */
const BUSY_MONTH = BUSY_Q === '2';
const BUSY = BUSY_Q === '1' || BUSY_MONTH;
/** ?private=1: privacy mode on (what the server sends then: "Busy" blocks, holidays and birthdays as they are). */
const PRIVATE = new URLSearchParams(location.search).get('private') === '1';
/** Pick the demo string for the current language: L('English', 'Español', 'Português'); Dutch and Danish come from
 * mock-text.ts, keyed by the English. */
const L = (en: string, es: string, pt: string) =>
  DEMO_LANG === 'es' ? es : DEMO_LANG === 'pt' ? pt : NL_DA !== null ? DEMO_NL_DA[en]?.[NL_DA] ?? en : en;
/** The family demo is written in Spanish (every language but Dutch and Danish shows it as is). */
const F = (es: string) => (NL_DA !== null ? DEMO_NL_DA[es]?.[NL_DA] ?? es : SHOW_EN ? DEMO_FAMILY_EN[es] ?? es : es);

export const MOCK_SOURCES: PublicCalendarSource[] = [
  { id: 'c_fam', name: L('Family', 'Familia', 'Família'), color: '#4c8dff', emoji: '', kind: 'generic' },
  { id: 'c_kids', name: L('Lucía & Mateo', 'Lucía y Mateo', 'Lucía e Mateo'), color: '#ff9f1c', emoji: '', kind: 'generic' },
  { id: 'c_bday', name: L('Birthdays', 'Cumpleaños', 'Aniversários'), color: '#f15bb5', emoji: '🎂', kind: 'birthdays' },
  { id: 'c_rent', name: L('Beach house', 'Casa de la playa', 'Casa da praia'), color: '#2ec4b6', emoji: '🏠', kind: 'airbnb' },
  { id: 'c_hol', name: L('Public holidays', 'Festivos', 'Feriados'), color: '#ffd23f', emoji: '🎉', kind: 'holidays' },
  { id: 'c_work', name: L('Work', 'Trabajo', 'Trabalho'), color: '#9b5de5', emoji: '', kind: 'generic' },
];

/** The demo screen; `show`: that showcase screen (a step of the showcase carousel) instead of &preset= and &shot=. */
export function mockConfig(show?: string): DisplayConfig {
  const q = new URLSearchParams(location.search);
  if (show) {
    q.set('preset', 'canvas');
    q.set('shot', show);
  }
  const cfg = deepMerge(DEFAULT_CONFIG, {
    revision: 1,
    screenId: 's_main',
    slug: 'living-room',
    screen: { name: L('Living room', 'Salón', 'Sala'), language: DEMO_LANG, style: 'modern' },
    // ?wxplace=<name> → this screen shows the weather of another (made-up) place (#11)
    weather: { locationName: L('Lisbon, Portugal', 'Lisboa, Portugal', 'Lisboa, Portugal'), ...(q.get('wxplace') ? { place: { name: q.get('wxplace')!, lat: 37.02, lon: -7.93 } } : {}) },
    // ?photos=0 → no background photo
    ...(q.get('photos') === '0' ? { background: { enabled: false } } : {}),
    // ?h12=1 → 12-hour clock
    datetime: { timezone: TZ, ...(q.get('h12') === '1' ? { format24: false, showAmPm: true } : {}) },
    ...(PRIVATE ? { privacy: { active: true, until: new Date(Date.now() + 3 * 3600_000).toISOString(), lock: true, next: null } } : {}),
    countdowns: { enabled: q.get('countdowns') !== '0', max: Number(q.get('cdmax')) || 4 },
    // ?sched=1 → a scheduled message whose window is open right now
    schedules: q.get('sched') === '1'
      ? [{
          id: 'm_demo', enabled: true, title: L('Take out the bins', 'Sacar la basura', 'Pôr o lixo na rua'),
          body: L('Recycling & organic', 'Orgánico y envases', 'Reciclagem e orgânico'), emoji: '🗑️', style: 'warning',
          days: [], from: '00:00', to: '23:59', startDate: null, endDate: null, sound: false,
        }]
      : [],
    // the demo is a new screen: compact busy days on (?compact=0 shows the grid without them)
    calendar: { sources: MOCK_SOURCES, iconRules: DEFAULT_ICON_RULES, compactBusyDays: true },
    todo: {
      enabled: q.get('todo') === '1',
      items: EMPTY ? [] : [
        { id: 't1', text: L('Buy batteries for the remote', 'Comprar pilas para el mando', 'Comprar pilhas para o comando'), done: false },
        { id: 't2', text: L('Call the plumber', 'Llamar al fontanero', 'Ligar ao canalizador'), done: true },
        { id: 't3', text: L('Fresh sheets for the beach house', 'Sábanas limpias para la casa de la playa', 'Lençóis lavados para a casa da praia'), done: false },
      ],
    },
    // Familia (kids layouts): taps on, the QR of a family page (?touch=0, ?qr=0 turn them off)
    family: {
      // what the server sends while private: no stars, no taps, no QR
      enabled: q.get('family') !== '0', mealsEnabled: q.get('meals') !== '0', showPoints: q.get('stars') !== '0' && !PRIVATE, touch: q.get('touch') !== '0' && !PRIVATE,
      qrUrl: q.get('qr') === '0' || PRIVATE ? null : 'http://192.168.0.50:3000/f/fk_demoDemoDemoDemoDemoDemoDemoDemo',
      // ?famPrivacy=hide (with ?private=1): routines hidden while private
      privacy: q.get('famPrivacy') === 'hide' ? 'hide' : 'initials',
    },
    message: { enabled: q.get('msg') === '1', text: L('Have a great weekend, everyone!', '¡Buen fin de semana, familia!', 'Bom fim de semana, família!'), emoji: '💛' },
  });
  // ?pw=view:place:corner:size,... electricity price widgets (view auto|chart|now|cheap|next, place corner|side|full),
  // &pwzone= (default DK2), &pwunit=sub, &pwvat=, &pwadd= (surcharge), &pwres=quarter, &pwaxis=, &pwshape=, &pwgrid=, &pwbands=es. A 'full' one picks the Widget layout.
  if (q.get('pw')) {
    cfg.widgets = q.get('pw')!.split(',').map((spec, i) => {
      const [view = 'auto', place = 'corner', corner = 'br', size = 'm'] = spec.split(':');
      return {
        id: `w_pw${i}`, type: 'prices' as const, name: q.get('pwname') ?? '', place: place as 'corner' | 'side' | 'full', corner: corner as 'tl' | 'tr' | 'bl' | 'br',
        size: size as 's' | 'm' | 'l', refreshSec: 0, fit: 'contain' as const, bust: false, src: '', via: 'direct' as const, v: `pw${i}`,
        prices: {
          zone: q.get('pwzone') || 'DK2', view: view as 'auto', unit: q.get('pwunit') === 'sub' ? 'sub' as const : 'main' as const, currency: 'auto' as const,
          surcharge: Number(q.get('pwadd')) || 0, vat: Number(q.get('pwvat')) || 0, windowHours: Number(q.get('pwh')) || 3,
          resolution: q.get('pwres') === 'quarter' ? 'quarter' as const : 'hour' as const,
          // &pwaxis=3h|1h: the chart's hour labels; &pwshape=rows: the tall chart (one row per hour)
          axis: (['3h', '1h'].includes(q.get('pwaxis') ?? '') ? q.get('pwaxis') : 'simple') as 'simple' | '3h' | '1h',
          chartShape: q.get('pwshape') === 'rows' ? 'rows' as const : 'columns' as const,
          // &pwgrid=radius: a Danish grid company's tariffs; &pwbands=es: Spain 2.0TD bands with sample prices
          ...(q.get('pwgrid') ? { tariff: 'grid' as const, grid: q.get('pwgrid')! } : {}),
          ...(q.get('pwbands') === 'es' ? { tariff: 'bands' as const, bands: { ...presetBands('es-20td'), list: [{ name: 'Punta', price: 0.12 }, { name: 'Llano', price: 0.05 }, { name: 'Valle', price: 0.01 }] } } : {}),
        },
      };
    });
    if (cfg.widgets.some((w) => w.place === 'full')) cfg.layout.preset = 'widget';
  }
  // ?fx=layout:place:corner:size,... Currency widgets (layout list|big, place corner|side|full), &fxpairs=EUR-HUF,EUR-USD
  // (default three pairs), &fxrange=7d|30d|1y, &fxchart=area|line|none, &fxstyle=background. A 'full' one picks the
  // Widget layout.
  if (q.get('fx')) {
    const pairs = (q.get('fxpairs') || 'EUR-HUF,EUR-USD,USD-MXN').split(',').map((x) => ({ base: x.split('-')[0], quote: x.split('-')[1] }));
    const fx = q.get('fx')!.split(',').map((spec, i) => {
      const [layout = 'list', place = 'corner', corner = 'br', size = 'm'] = spec.split(':');
      return {
        id: `w_fx${i}`, type: 'currency' as const, name: '', place: place as 'corner' | 'side' | 'full', corner: corner as 'tl' | 'tr' | 'bl' | 'br',
        size: size as 's' | 'm' | 'l', refreshSec: 0, fit: 'contain' as const, bust: false, src: '', via: 'direct' as const, v: `fx${i}`,
        currency: {
          pairs, layout: layout === 'big' ? 'big' as const : 'list' as const,
          range: (['7d', '1y'].includes(q.get('fxrange') ?? '') ? q.get('fxrange') : '30d') as '7d' | '30d' | '1y',
          chart: (['line', 'none'].includes(q.get('fxchart') ?? '') ? q.get('fxchart') : 'area') as 'area' | 'line' | 'none',
          chartStyle: q.get('fxstyle') === 'background' ? 'background' as const : 'below' as const,
        },
      };
    });
    cfg.widgets = [...(cfg.widgets ?? []), ...fx];
    if (fx.some((w) => w.place === 'full')) cfg.layout.preset = 'widget';
  }
  // ?preset=canvas: a Personalizado screen (&shot=<fixture>, web/display/mockCanvas.ts), with the message and the to-do
  // list on so their cards have something to show
  if (q.get('preset') === 'canvas') {
    const shot = q.get('shot');
    const m = mockCanvas(shot && shot !== '1' ? shot : null, demoScreens());
    cfg.layout.preset = 'canvas';
    cfg.canvas = m.canvas;
    if (m.orientation) cfg.screen.orientation = m.orientation;
    // &cvbg=photo|ambient|solid: another background for the same layout (screenshots)
    const bg = q.get('cvbg');
    if (bg === 'photo' || bg === 'ambient' || bg === 'solid') cfg.canvas.background = bg;
    // &cvscale=0.7..1.5: every card's "Tamaño del texto" (screenshots, the test of the text size)
    const sc = Number(q.get('cvscale'));
    if (sc >= 0.5 && sc <= 2) for (const it of cfg.canvas.items) it.style = { ...it.style, scale: sc };
    // &perf=low: the screen's "Rendimiento: Ahorro"
    if (q.get('perf') === 'low') cfg.canvas.perf = 'low';
    // &touch=0 (or a private screen): no taps on the navigation cards, no swipe (as the server would send it)
    if (q.get('touch') === '0' || PRIVATE) cfg.canvas = { ...cfg.canvas, touch: false, taps: false, swipe: false };
    if (q.get('todo') !== '0') cfg.todo.enabled = true;
    if (q.get('msg') !== '0') cfg.message.enabled = true;
    // a showcase screen: its own to-do list, note and theme (web/display/showcase/)
    const show = shot ? SHOWCASES[shot] : undefined;
    if (show?.todo) cfg.todo.items = show.todo.map((t) => ({ ...t }));
    if (show?.message) cfg.message = { ...show.message };
    if (show?.theme) cfg.screen.theme = show.theme;
    // the saved widget of its widget items: the demo electricity prices (&demowidget=currency: exchange rates)
    if (m.canvas.items.some((it) => it.kind === 'widget') && q.get('demowidget') === 'currency') {
      cfg.widgets = [{
        id: DEMO_WIDGET, type: 'currency', name: '', place: 'canvas', corner: 'br', size: 'm', refreshSec: 0, fit: 'contain', bust: false, src: '', via: 'direct', v: 'demo',
        currency: { pairs: [{ base: 'EUR', quote: 'HUF' }, { base: 'EUR', quote: 'USD' }], layout: 'list', range: '30d', chart: 'area', chartStyle: 'below' },
      }];
    } else if (m.canvas.items.some((it) => it.kind === 'widget')) {
      cfg.widgets = [{
        id: DEMO_WIDGET, type: 'prices', name: '', place: 'canvas', corner: 'br', size: 'm', refreshSec: 0, fit: 'contain', bust: false, src: '', via: 'direct', v: 'demo',
        prices: { zone: 'DK2', view: 'auto', unit: 'main', currency: 'auto', surcharge: 0, vat: 0, windowHours: 3, resolution: 'hour', axis: 'simple', chartShape: 'columns' },
      }];
    }
  }
  // ?planner=1: the Planner layout with what picking it in the admin sets (automatic weeks, cards)
  if (q.get('planner') === '1') {
    cfg.layout.preset = 'planner';
    cfg.calendar.weeks = 'auto';
    cfg.calendar.eventStyle = 'cards';
  }
  return cfg;
}

/**
 * ?demo=1&carousel=1: a carousel of four demo screens with different layouts (&stepSec= seconds each, default 8, &tr=<name>
 * and &trSpeed=fast|normal|slow to film one animation, &photoMix=1 for other photos on every step),
 * for filming the rotation. Every config carries the same carousel block, as the server sends it.
 */
// ---------------------------------------------------------------------------------------------
// Familia demo (kids layouts): three kids and two parents, routines about half done (what is over is done, a bit of
// what is on now), a week of meals and three rewards. Demo data, written in Spanish (Dutch and Danish through F()). ?members=6 adds a grandmother and
// gives the parents routines too (the compact two-row Rutinas layout).
// ---------------------------------------------------------------------------------------------
const MOCK_MEMBERS: [string, string, string, string, boolean, number, string | null][] = [
  ['m_lucia', 'Lucía', '🦊', '#ff8fab', true, 12, 'c_kids'],
  ['m_mateo', 'Mateo', '🐻', '#7cc6fe', true, 8, null],
  ['m_sofia', 'Sofía', '🐼', '#9be3a0', true, 5, null],
  ['m_mama', 'Mamá', '🌷', '#c3a6ff', false, 0, 'c_work'],
  ['m_papa', 'Papá', '☕', '#ffc46b', false, 0, null],
  ['m_abuela', 'Abuela Carmen', '🌻', '#7fe0d6', false, 0, null],
];
const MOCK_CHORES: [string, ChoreSlot, string, string, number][] = [
  ['m_lucia', 'morning', '🪥', 'Lavarse los dientes', 1],
  ['m_lucia', 'morning', '🛏️', 'Hacer la cama', 2],
  ['m_lucia', 'afternoon', '📚', 'Deberes', 3],
  ['m_lucia', 'evening', '🍽️', 'Poner la mesa', 2],
  ['m_lucia', 'evening', '🪥', 'Lavarse los dientes', 1],
  ['m_mateo', 'morning', '🪥', 'Lavarse los dientes', 1],
  ['m_mateo', 'morning', '👕', 'Vestirse solo', 1],
  ['m_mateo', 'afternoon', '🎒', 'Preparar la mochila', 2],
  ['m_mateo', 'evening', '🧸', 'Recoger los juguetes', 2],
  ['m_mateo', 'any', '🐶', 'Dar de comer a Toby', 2],
  ['m_sofia', 'morning', '🪥', 'Lavarse los dientes', 1],
  ['m_sofia', 'morning', '🥛', 'Llevar el vaso al fregadero', 1],
  ['m_sofia', 'afternoon', '🎹', 'Practicar piano', 2],
  ['m_sofia', 'evening', '🛁', 'Baño', 1],
  ['m_papa', 'evening', '🗑️', 'Sacar la basura', 0],
  ['m_mama', 'afternoon', '🌱', 'Regar las plantas', 0],
  ['m_abuela', 'any', '📞', 'Llamar a los nietos', 0],
];
const MOCK_MEALS: Record<MealSlot, string>[] = [
  { breakfast: 'Tostadas con tomate', lunch: 'Lentejas con verduras', snack: 'Fruta y yogur', dinner: 'Tortilla de patatas' },
  { breakfast: 'Cereales con leche', lunch: 'Pollo asado con patatas', snack: 'Bocadillo de queso', dinner: 'Crema de calabaza' },
  { breakfast: 'Yogur con fruta', lunch: 'Macarrones con tomate', snack: 'Plátano', dinner: 'Pescado al horno con arroz' },
  { breakfast: 'Tostadas con aceite', lunch: 'Garbanzos con espinacas', snack: 'Galletas y leche', dinner: 'Sopa de fideos' },
  { breakfast: 'Tortitas', lunch: 'Arroz a la cubana', snack: 'Manzana', dinner: 'Pizza casera' },
  { breakfast: 'Churros con chocolate', lunch: 'Paella', snack: 'Helado', dinner: 'Huevos rotos con jamón' },
  { breakfast: 'Fruta y tostadas', lunch: 'Cocido madrileño', snack: 'Bizcocho', dinner: 'Ensalada y croquetas' },
];
const MOCK_REWARDS = [
  { title: 'Elegir la peli del viernes', emoji: '🎬', cost: 10 },
  { title: 'Helado', emoji: '🍦', cost: 15 },
  { title: '30 min más de tablet', emoji: '📱', cost: 20 },
];

/** What GET /api/display/family answers for the demo screen. */
export function mockFamily(now = new Date(), cfg: DisplayConfig = DEFAULT_CONFIG): FamilyDisplayState {
  const q = new URLSearchParams(location.search);
  const today = dateKeyInTz(now, TZ);
  const p = zonedParts(now, TZ);
  const hhmm = p.hour * 60 + p.minute;
  const slotNow: Exclude<ChoreSlot, 'any'> = hhmm < 12 * 60 ? 'morning' : hhmm < 18 * 60 ? 'afternoon' : 'evening';
  const order: ChoreSlot[] = ['morning', 'afternoon', 'evening', 'any'];
  const many = q.get('members') === '6' || !!showcaseOf(cfg)?.members6;
  const fam = cfg.family;
  const priv = PRIVATE || !!cfg.privacy?.active;
  const hidden = priv && fam?.privacy === 'hide';
  const showPoints = fam?.showPoints !== false && !priv;
  const members = MOCK_MEMBERS.filter(([id]) => many || id !== 'm_abuela');
  const kidOf = new Map(members.map((m) => [m[0], m[4]]));
  const firstOfSlot = new Set<string>();
  const chores: FamilyChoreView[] = EMPTY ? [] : (showcaseOf(cfg)?.chores ?? MOCK_CHORES)
    .filter(([mid]) => kidOf.has(mid) && (many || mid !== 'm_mama'))
    .map(([memberId, slot, emoji, title, points], i) => {
      // what is over is done (Mateo forgot one), what is on now is half done, the rest is still to do
      const idx = order.indexOf(slot), now = order.indexOf(slotNow);
      const key = `${memberId}|${slot}`;
      const first = !firstOfSlot.has(key);
      firstOfSlot.add(key);
      const done = slot === 'any' ? false : idx < now ? !(memberId === 'm_mateo' && !first) : idx === now ? first && memberId !== 'm_sofia' : false;
      return { id: `h_demo${i}`, memberId, title: F(title), emoji, slot, points: showPoints && kidOf.get(memberId) ? points : 0, done };
    })
    .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
  chores.sort((a, b) => members.findIndex((m) => m[0] === a.memberId) - members.findIndex((m) => m[0] === b.memberId));
  const views: FamilyMemberView[] = members.map(([id, name0, avatar, color, kid, stars, calendarId]) => {
    const name = F(name0);
    const mine = chores.filter((c) => c.memberId === id);
    const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    return {
      id, name: priv ? initials : name, initials, color, avatar, kid, calendarId,
      points: showPoints && kid ? stars + mine.filter((c) => c.done).reduce((s, c) => s + c.points, 0) : null,
      done: mine.filter((c) => c.done).length, total: mine.length,
    };
  });
  const nextReward: FamilyDisplayState['nextReward'] = {};
  for (const m of views) {
    if (m.points === null) continue;
    const pts = m.points;
    const w = MOCK_REWARDS.find((r) => r.cost > pts) ?? MOCK_REWARDS[MOCK_REWARDS.length - 1];
    nextReward[m.id] = { ...w, title: F(w.title), missing: Math.max(0, w.cost - pts) };
  }
  const start = startOfWeek(today, cfg.calendar.weekStart ?? 1);
  const slots: MealSlot[] = q.get('snack') === '1' ? ['breakfast', 'lunch', 'snack', 'dinner'] : ['breakfast', 'lunch', 'dinner'];
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const dow = keyToUTC(date).getUTCDay();
    const all = MOCK_MEALS[(dow + 6) % 7];
    // the weekend breakfast is left open: an empty cell
    const meals = Object.fromEntries(slots.filter((s) => !(dow === 0 && s === 'breakfast')).map((s) => [s, F(all[s])]));
    return { date, dow, meals };
  });
  return {
    today, slotNow, rev: 1, private: priv, hidden, showPoints, touch: !!fam?.touch && !priv,
    qrUrl: priv ? null : fam?.qrUrl ?? null,
    members: hidden ? [] : views,
    chores: hidden ? [] : chores,
    meals: fam?.mealsEnabled === false ? null : { slots, days },
    ...(showPoints && !hidden ? { nextReward } : {}),
    generatedAt: now.toISOString(),
  };
}

export function mockCarouselConfigs(): DisplayConfig[] {
  const q = new URLSearchParams(location.search);
  const sec = Math.min(3600, Math.max(3, Number(q.get('stepSec')) || 8));
  if (SHOW_CAROUSEL) return showcaseCarousel(q, sec);
  const screens: [string, string, string, string][] = [
    // &planner=1: the first step is the Planner (automatic weeks and cards on every step)
    ['s_main', 'living-room', L('Living room', 'Salón', 'Sala'), q.get('planner') === '1' ? 'planner' : 'bigCalendar'],
    // &kids=1: the second step is the Rutinas layout (with &style=modern)
    ['s_today', 'today', L('Today', 'Hoy', 'Hoje'), q.get('kids') === '1' ? 'kidsRoutines' : 'today'],
    ['s_photos', 'photos', L('Photos', 'Fotos', 'Fotos'), 'photoFrame'],
    ['s_agenda', 'agenda', L('Agenda', 'Agenda', 'Agenda'), 'agenda'],
  ];
  const carousel = {
    id: 'v_demo', slug: 'demo-loop', name: L('Living room loop', 'Bucle del salón', 'Ciclo da sala'),
    // a different animation at each switch (&tr=<name> forces one, &fade=0 turns them off)
    enabled: true, transition: (q.get('fade') === '0' ? 'none' : 'random') as CarouselTransition, transitionSpeed: 'normal' as const,
    holdOnAlert: true, nightRotate: false,
    offScreenId: 's_main', schedule: [],
    steps: screens.map(([screenId, slug, name]) => ({ screenId, slug, name, seconds: sec })),
  };
  const base = mockConfig();
  // &photoMix=1: every step has its own photo topic (another slideshow at each switch, see mockPhotos)
  const mix = q.get('photoMix') === '1';
  // &nav=1: the first step is a Personalizado screen with the navigation cards (mockCanvas 'nav', touch on)
  const nav = q.get('nav') === '1';
  return screens.map(([screenId, slug, name, preset], i) => ({
    ...base,
    screenId,
    slug,
    // (a Personalizado screen is a Modern design)
    screen: { ...base.screen, name, ...(nav && i === 0 ? { style: 'modern' as const } : {}) },
    ...(mix ? { background: { ...base.background, stockTopic: `topic${i}`, intervalSec: [60, 30][i % 2] } } : {}),
    layout: { ...base.layout, preset: (nav && i === 0 ? 'canvas' : preset) as DisplayConfig['layout']['preset'] },
    // (&preset=canvas&shot=nav: the same canvas with the URL's options, &cvscale and the like)
    ...(nav && i === 0 ? { canvas: base.canvas && q.get('shot') === 'nav' ? base.canvas : mockCanvas('nav', demoScreens()).canvas } : {}),
    target: { id: carousel.id, kind: 'carousel' as const, slug: carousel.slug, name: carousel.name },
    carousel,
  }));
}

/** The demo household's screens: the carousel's and the kitchen (the names of the "Ir a pantalla" targets). */
function demoScreens(): { id: string; name: string }[] {
  return [
    { id: 's_main', name: L('Living room', 'Salón', 'Sala') }, { id: 's_today', name: L('Today', 'Hoy', 'Hoje') },
    { id: 's_photos', name: L('Photos', 'Fotos', 'Fotos') }, { id: 's_agenda', name: L('Agenda', 'Agenda', 'Agenda') },
    { id: 's_kitchen', name: L('Kitchen', 'Cocina', 'Cozinha') },
  ];
}

/** The demo's screens outside the carousel (&nav=1: "Ir a pantalla" to the kitchen), as a server would send them. */
export function mockNavScreens(): DisplayConfig[] {
  const base = mockConfig();
  const q = new URLSearchParams(location.search);
  const car = q.get('carousel') === '1' ? mockCarouselConfigs()[0] : null;
  const name = L('Kitchen', 'Cocina', 'Cozinha');
  return [{
    ...base,
    screenId: 's_kitchen',
    slug: 'kitchen',
    screen: { ...base.screen, name },
    layout: { ...base.layout, preset: 'today' as DisplayConfig['layout']['preset'] },
    target: car ? car.target : { id: 's_kitchen', kind: 'screen' as const, slug: 'kitchen', name },
    carousel: car ? car.carousel : null,
  }];
}

/**
 * ?demo=1&carousel=1&show=1: the showcase screens in a loop (home, family, data, everyday, cinematic; web/display/showcase/),
 * a slow dissolve between them (&tr= forces another, &fade=0 none). Each step carries its key as its screenId, so the
 * demo's Home Assistant states, to-dos and theme follow the screen shown.
 */
function showcaseCarousel(q: URLSearchParams, sec: number): DisplayConfig[] {
  const carousel = {
    id: 'v_show', slug: 'showcase', name: 'Showcase',
    enabled: true, transition: (q.get('fade') === '0' ? 'none' : 'dissolve') as CarouselTransition, transitionSpeed: 'slow' as const,
    holdOnAlert: true, nightRotate: false,
    offScreenId: SHOW_CAROUSEL_STEPS[0], schedule: [],
    steps: SHOW_CAROUSEL_STEPS.map((key) => ({ screenId: key, slug: key.slice(5), name: key.slice(5), seconds: Number(q.get('stepSec')) ? sec : 12 })),
  };
  return SHOW_CAROUSEL_STEPS.map((key) => {
    const cfg = mockConfig(key);
    return {
      ...cfg,
      screenId: key,
      slug: key.slice(5),
      screen: { ...cfg.screen, name: key.slice(5) },
      target: { id: carousel.id, kind: 'carousel' as const, slug: carousel.slug, name: carousel.name },
      carousel,
    };
  });
}

/** ISO string with offset for a wall-clock time in TZ. */
function isoAt(key: string, hh: number, mm: number): string {
  const [y, m, d] = key.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), TZ);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += Date.UTC(y, m - 1, d, hh, mm) - wall;
  }
  const p = zonedParts(new Date(guess), TZ);
  const off = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess) / 60000);
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${key}T${pad2(hh)}:${pad2(mm)}:00${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

let seq = 0;
function ev(
  sourceId: string, title: string, startKey: string,
  opts: { at?: [number, number]; dur?: number; endKey?: string; location?: string; age?: number } = {},
): CalEvent {
  const src = MOCK_SOURCES.find((s) => s.id === sourceId)!;
  const style = resolveEventStyle(DEFAULT_ICON_RULES, { title }, { emoji: src.emoji, color: src.color, kind: src.kind });
  const allDay = !opts.at;
  let start: string;
  let end: string;
  if (allDay) {
    start = startKey;
    end = opts.endKey ?? addDays(startKey, 1);
  } else {
    const [h, m] = opts.at!;
    start = isoAt(startKey, h, m);
    const endMs = new Date(start).getTime() + (opts.dur ?? 60) * 60000;
    end = opts.endKey ? isoAt(opts.endKey, 11, 0) : new Date(endMs).toISOString();
  }
  const multiDay = allDay ? diff(start, end) > 1 : dateKeyInTz(new Date(new Date(end).getTime() - 1), TZ) !== startKey;
  return {
    id: `mock_${++seq}_${startKey}`,
    sourceId, title, start, end, allDay, location: opts.location ?? null,
    color: style.color, emoji: style.emoji, kind: src.kind as SourceKind, multiDay,
    ...(opts.age !== undefined ? { age: opts.age } : {}),
  };
}

function diff(a: string, b: string) {
  return Math.round((keyToUTC(b).getTime() - keyToUTC(a).getTime()) / 86400000);
}

export function mockEvents(now = new Date()): EventsResponse {
  seq = 0;
  const T = dateKeyInTz(now, TZ);
  const W = startOfWeek(T, 1);
  const D = (n: number) => addDays(T, n);
  const out: CalEvent[] = [];
  const year = +T.slice(0, 4);

  // Public holidays in range (this year + next).
  const hol: [string, string, string, string][] = [
    ['10-05', 'Republic Day', 'Día de la República', 'Implantação da República'],
    ['11-01', "All Saints' Day", 'Todos los Santos', 'Dia de Todos os Santos'],
    ['12-01', 'Restoration of Independence', 'Restauración de la Independencia', 'Restauração da Independência'],
    ['12-08', 'Immaculate Conception', 'Inmaculada Concepción', 'Imaculada Conceição'],
    ['12-25', 'Christmas Day', 'Navidad', 'Natal'], ['01-01', "New Year's Day", 'Año Nuevo', 'Ano Novo'],
    ['04-25', 'Freedom Day', 'Día de la Libertad', 'Dia da Liberdade'],
    ['06-10', 'Portugal Day', 'Día de Portugal', 'Dia de Portugal'], ['08-15', 'Assumption Day', 'Asunción', 'Assunção de Nossa Senhora'],
  ];
  for (const y of [year, year + 1]) for (const [md, en, es, pt] of hol) out.push(ev('c_hol', L(en, es, pt), `${y}-${md}`));

  // Birthdays (age shown as "🎂 Grandma Isabel (72)")
  out.push(ev('c_bday', 'Elena', T, { age: 39 }));
  out.push(ev('c_bday', L('Grandpa Luis', 'Abuelo Luis', 'Avô Luis'), D(9), { age: 81 }));
  out.push(ev('c_bday', 'Mateo', D(16), { age: 7 }));
  out.push(ev('c_bday', L('Grandma Isabel', 'Abuela Isabel', 'Avó Isabel'), D(25), { age: 72 }));
  out.push(ev('c_bday', 'Lucía', D(33), { age: 10 }));

  // Vacation-rental stays (all-day, end = checkout date). Guests as icons: 🧑🏻 adults, 🧒🏻 children, 👶🏻 babies, 🐶 pets.
  out.push(ev('c_rent', 'Sophie Martin · 🧑🏻🧑🏻', D(-3), { endKey: D(1) }));
  out.push(ev('c_rent', 'João Pereira · 🧑🏻🧑🏻 🧒🏻🧒🏻 🐶', D(1), { endKey: D(5) }));
  out.push(ev('c_rent', 'Emma & Lukas · 🧑🏻🧑🏻', D(7), { endKey: D(10) }));
  out.push(ev('c_rent', L('The Duboises', 'Familia Dubois', 'Família Dubois') + ' · 🧑🏻🧑🏻 🧒🏻 👶🏻', D(13), { endKey: D(17) }));
  out.push(ev('c_rent', 'Marco Rossi · 🧑🏻', D(19), { endKey: D(23) }));
  out.push(ev('c_rent', 'Hannah K. · 🧑🏻🧑🏻🧑🏻 🐶', D(26), { endKey: D(29) }));

  // Recurring family stuff across the visible grid
  for (let i = -7; i < 42; i++) {
    const k = addDays(W, i);
    const wd = keyToUTC(k).getUTCDay();
    if (wd === 2 || wd === 4) out.push(ev('c_kids', L('Football practice', 'Entreno de fútbol', 'Treino de futebol'), k, { at: [18, 0], dur: 75, location: L('Sports ground', 'Campo municipal', 'Campo municipal') }));
    if (wd === 3) out.push(ev('c_fam', L('Padel with Rui', 'Pádel con Rui', 'Padel com o Rui'), k, { at: [19, 30], dur: 90 }));
    if (wd === 6) out.push(ev('c_fam', L('Farmers market', 'Mercado del sábado', 'Mercado de sábado'), k, { at: [10, 0], dur: 120 }));
    if (wd === 1) out.push(ev('c_work', L('Weekly meeting', 'Reunión semanal', 'Reunião semanal'), k, { at: [9, 30], dur: 60 }));
    if (wd === 5 && i % 14 === 4) out.push(ev('c_kids', L('School trip', 'Excursión del colegio', 'Visita de estudo'), k));
  }

  // One-offs
  out.push(ev('c_fam', L('Dentist – Lucía', 'Dentista – Lucía', 'Dentista – Lucía'), T, { at: [17, 30], dur: 45, location: L('Smile Clinic', 'Clínica Sonrisa', 'Clínica Sorriso') }));
  out.push(ev('c_work', L('Client call', 'Llamada con cliente', 'Call com cliente'), T, { at: [11, 0], dur: 30 }));
  out.push(ev('c_fam', L('Dinner with Ana & Pedro', 'Cena con Ana y Pedro', 'Jantar com Ana e Pedro'), D(1), { at: [21, 0], dur: 150, location: L('Seaside restaurant', 'Restaurante del puerto', 'Restaurante do porto') }));
  out.push(ev('c_fam', L('Vet – Luna', 'Veterinario – Luna', 'Veterinário – Luna'), D(3), { at: [16, 15], dur: 30 }));
  out.push(ev('c_fam', L('Pay electricity bill', 'Pagar factura de la luz', 'Pagar fatura da luz'), D(4)));
  out.push(ev('c_fam', L('Car service', 'Revisión del coche', 'Revisão do carro'), D(6), { at: [8, 45], dur: 60 }));
  out.push(ev('c_fam', L('Cinema night', 'Noche de cine', 'Noite de cinema'), D(8), { at: [21, 30], dur: 150 }));
  out.push(ev('c_work', L('Flight to Madrid', 'Vuelo a Madrid', 'Voo para Madrid'), D(12), { at: [7, 40], dur: 80 }));
  out.push(ev('c_fam', L('Concert in the park', 'Concierto en el parque', 'Concerto no parque'), D(15), { at: [21, 0], dur: 120 }));
  out.push(ev('c_fam', L('Vacation in the Algarve', 'Vacaciones en el Algarve', 'Férias no Algarve'), D(18), { endKey: D(22) }));
  out.push(ev('c_fam', L("Inês & Duarte's wedding", 'Boda de Inês y Duarte', 'Casamento da Inês e do Duarte'), D(20), { at: [16, 0], dur: 480 }));
  out.push(ev('c_fam', L('Weekly grocery shopping', 'Compra semanal del súper', 'Compras da semana'), D(-2), { at: [18, 30], dur: 60 }));
  out.push(ev('c_kids', L('Pediatrician – Mateo', 'Pediatra – Mateo', 'Pediatra – Mateo'), D(-1), { at: [10, 0], dur: 30 }));
  out.push(ev('c_kids', L('Swimming lesson', 'Clase de natación', 'Aula de natação'), D(2), { at: [17, 0], dur: 45 }));
  out.push(ev('c_kids', L('School play', 'Función del colegio', 'Teatro da escola'), D(10), { at: [18, 30], dur: 90 }));

  if (BUSY) {
    out.push(ev('c_fam', L('Grandparents visiting from Porto for the long weekend', 'Los abuelos vienen de Oporto a pasar el puente', 'Os avós vêm do Porto passar o fim de semana prolongado'), D(1), { endKey: D(4) }));
    out.push(ev('c_kids', L('Bring the signed permission slip for the science museum trip', 'Llevar firmada la autorización para la excursión al museo de la ciencia', 'Levar assinada a autorização para a visita ao museu da ciência'), T));
    out.push(ev('c_work', L('Quarterly planning workshop with the whole design and product team', 'Taller de planificación trimestral con todo el equipo de diseño y producto', 'Workshop de planeamento trimestral com toda a equipa de design e produto'), T, { at: [14, 0], dur: 90 }));
    const busy: [string, string, string, number, number, string][] = [
      ['Breakfast with Marta', 'Desayuno con Marta', 'Pequeno-almoço com a Marta', 8, 0, 'c_fam'],
      ['Drop the kids at school', 'Llevar a los niños al colegio', 'Levar os miúdos à escola', 8, 45, 'c_kids'],
      ['Budget review', 'Revisión del presupuesto', 'Revisão do orçamento', 10, 0, 'c_work'],
      ['Haircut', 'Peluquería', 'Cabeleireiro', 12, 30, 'c_fam'],
      ['Lunch with the new team', 'Comida con el equipo nuevo', 'Almoço com a equipa nova', 13, 30, 'c_work'],
      ['Piano lesson', 'Clase de piano', 'Aula de piano', 16, 0, 'c_kids'],
      ['Pick up the parcel', 'Recoger el paquete', 'Levantar a encomenda', 17, 15, 'c_fam'],
      ['Parents association meeting', 'Reunión del AMPA', 'Reunião da associação de pais', 18, 30, 'c_kids'],
      ['Call grandma', 'Llamar a la abuela', 'Ligar à avó', 20, 0, 'c_fam'],
    ];
    for (const [en, es, pt, h, m, src] of busy) out.push(ev(src, L(en, es, pt), D(2), { at: [h, m], dur: 45 }));
    // the next event, in about 25 minutes, with a title too long for the side panel's pill and for its day cell
    const soon = new Date(now.getTime() + 25 * 60000);
    const sp = zonedParts(soon, TZ);
    out.push(ev('c_work', L(
      'Website update review with the agency and the whole content team before launch',
      'Revisión de la actualización de la web con la agencia y todo el equipo de contenidos antes del lanzamiento',
      'Revisão da atualização do site com a agência e toda a equipa de conteúdos antes do lançamento',
    ), dateKeyInTz(soon, TZ), { at: [sp.hour, sp.minute], dur: Math.max(5, Math.min(60, 1439 - sp.hour * 60 - sp.minute)) }));
    // a long timed event alone on its day (the first free day from next week on): it may use the whole free height
    // of the cell
    const busyKey = (k: string) => out.some((e) => (e.allDay ? e.start <= k && k < e.end : dateKeyInTz(new Date(e.start), TZ) === k));
    let free = D(5);
    for (let i = 5; i < 30 && busyKey(D(i)); i++) free = D(i + 1);
    out.push(ev('c_fam', L(
      'Late flight back from the conference in Lyon with a connection in Barcelona, pick up the car at the long-stay car park',
      'Vuelo de vuelta de la conferencia de Lyon con escala en Barcelona, recoger el coche en el aparcamiento de larga estancia',
      'Voo de regresso da conferência em Lyon com escala em Barcelona, levantar o carro no parque de longa duração',
    ), free, { at: [21, 45], dur: 60 }));
  }

  // ?busy=2: a whole month as packed as a big family's (most days 4 to 10 events), for the compact busy days
  if (BUSY_MONTH) {
    const pool: [string, string, string, number, number, string][] = [
      ['Swim club', 'Club de natación', 'Clube de natação', 7, 30, 'c_kids'],
      ['School run', 'Llevar al cole', 'Levar à escola', 8, 15, 'c_kids'],
      ['Team stand-up', 'Daily del equipo', 'Daily da equipa', 9, 0, 'c_work'],
      ['Grocery delivery', 'Entrega del súper', 'Entrega do supermercado', 10, 30, 'c_fam'],
      ['Physio', 'Fisio', 'Fisioterapia', 11, 0, 'c_fam'],
      ['Lunch with Ana', 'Comida con Ana', 'Almoço com a Ana', 12, 30, 'c_fam'],
      ['Design review', 'Revisión de diseño', 'Revisão de design', 13, 30, 'c_work'],
      ['Pick up Lucía', 'Recoger a Lucía', 'Ir buscar a Lucía', 15, 0, 'c_kids'],
      ['Piano lesson', 'Clase de piano', 'Aula de piano', 16, 0, 'c_kids'],
      ['Homework club', 'Refuerzo escolar', 'Explicações', 16, 30, 'c_kids'],
      ['Ballet', 'Ballet', 'Ballet', 17, 0, 'c_kids'],
      ['Scouts', 'Scouts', 'Escuteiros', 17, 45, 'c_kids'],
      ['Gym', 'Gimnasio', 'Ginásio', 18, 30, 'c_fam'],
      ["Dinner at grandma's", 'Cena en casa de la abuela', 'Jantar em casa da avó', 19, 0, 'c_fam'],
      ['Book club', 'Club de lectura', 'Clube de leitura', 19, 30, 'c_fam'],
      ['Call with Dad', 'Llamada con papá', 'Chamada com o pai', 20, 0, 'c_fam'],
      ['Yoga', 'Yoga', 'Ioga', 20, 30, 'c_fam'],
      ['Movie night', 'Noche de pelis', 'Noite de cinema', 21, 0, 'c_fam'],
    ];
    const allDay: [string, string, string, string][] = [
      ['Pyjama day at school', 'Día del pijama en el cole', 'Dia do pijama na escola', 'c_kids'],
      ['Library books due', 'Devolver libros de la biblioteca', 'Devolver livros à biblioteca', 'c_kids'],
      ['Bin day', 'Día de sacar la basura', 'Dia do lixo', 'c_fam'],
    ];
    // events per day over five weeks from this Monday (the recurring ones above add one or two more)
    const counts = [3, 8, 5, 9, 4, 7, 2, 6, 9, 3, 8, 7, 5, 1, 8, 4, 7, 3, 9, 6, 2, 5, 8, 9, 4, 7, 3, 0, 7, 4, 8, 6, 3, 9, 4];
    counts.forEach((n, i) => {
      const k = addDays(W, i);
      const picks = new Set<number>();
      for (let j = 0; picks.size < Math.min(n, pool.length); j++) picks.add((i * 7 + j * 5) % pool.length);
      for (const p of [...picks].sort((a, b) => a - b)) {
        const [en, es, pt, h, m, src] = pool[p];
        out.push(ev(src, L(en, es, pt), k, { at: [h, m], dur: 45 }));
      }
      if (n >= 7 && i % 3 === 0) {
        const [en, es, pt, src] = allDay[i % allDay.length];
        out.push(ev(src, L(en, es, pt), k));
      }
    });
  }

  // Sort: allDay first, then start
  out.sort((a, b) => (a.allDay === b.allDay ? sortKey(a).localeCompare(sortKey(b)) : a.allDay ? -1 : 1));
  // ?empty=1 → an empty week (to check the empty states)
  if (EMPTY) out.length = 0;
  if (SPARSE) {
    out.length = 0;
    out.push(ev('c_fam', L('Dentist', 'Dentista', 'Dentista'), T, { at: [17, 30], dur: 45 }));
    out.push(ev('c_kids', L('Swim club', 'Natación', 'Natação'), D(3), { at: [7, 30], dur: 60 }));
    out.push(ev('c_bday', L('Grandpa Luis', 'Abuelo Luis', 'Avô Luis'), D(21), { age: 81 }));
    out.push(ev('c_fam', L('Parents evening at school', 'Reunión de padres en el colegio', 'Reunião de pais na escola'), D(21), { at: [18, 30], dur: 90 }));
    out.push(ev('c_work', L('Quarterly review', 'Revisión trimestral', 'Revisão trimestral'), D(24), { at: [10, 0], dur: 60 }));
    out.push(ev('c_fam', L('Car service', 'Revisión del coche', 'Revisão do carro'), D(28), { at: [8, 45], dur: 120 }));
    out.push(ev('c_kids', L('School trip', 'Excursión del colegio', 'Visita de estudo'), D(33)));
    out.push(ev('c_fam', L('Flight to Madrid', 'Vuelo a Madrid', 'Voo para Madrid'), D(40), { at: [7, 40], dur: 150 }));
    // and a weekly class from the third week on, so a tall agenda still runs out of room
    for (let n = 15; n <= 55; n += 7) out.push(ev('c_kids', L('Piano lesson', 'Clase de piano', 'Aula de piano'), D(n), { at: [17, 0], dur: 45 }));
  }
  const events = PRIVATE ? out.map(busyOf) : out;
  const tag = `${EMPTY ? '-empty' : ''}${SPARSE ? '-sparse' : ''}${PRIVATE ? '-p' : ''}`;
  return { generatedAt: new Date().toISOString(), hash: `mock-${T}${tag}`, events, errors: [] };
}

/** Same rule as the server (server/core/privacy.js) with the default per kind: holidays and birthdays stay. */
function busyOf(e: CalEvent): CalEvent {
  if (e.kind === 'holidays' || e.kind === 'birthdays') return e;
  const src = MOCK_SOURCES.find((s) => s.id === e.sourceId);
  return {
    id: e.id, sourceId: e.sourceId, title: L('Busy', 'Ocupado', 'Ocupado'), start: e.start, end: e.end, allDay: e.allDay,
    location: '', color: src?.color ?? e.color, emoji: '', kind: e.kind, multiDay: e.multiDay, busy: true,
  };
}

function sortKey(e: CalEvent) {
  return e.allDay ? e.start : new Date(e.start).toISOString();
}

// ?wx=clear|rain|snow|drizzle|thunder (or any WMO code) forces the current weather, e.g. for screenshots
const DEMO_WX: Record<string, [number, string]> = {
  clear: [0, L('Clear sky', 'Despejado', 'Céu limpo')],
  rain: [63, L('Rain', 'Lluvia', 'Chuva')],
  snow: [73, L('Snow', 'Nieve', 'Neve')],
  drizzle: [53, L('Drizzle', 'Llovizna', 'Chuvisco')],
  thunder: [95, L('Thunderstorm', 'Tormenta', 'Trovoada')],
};

export function mockWeather(now = new Date(), wx?: string | null): WeatherResponse {
  const w = baseWeather(now);
  if (wx && DEMO_WX[wx]) {
    [w.current.code, w.current.description] = DEMO_WX[wx];
    if (wx === 'clear') w.current.isDay = true; // sun rays need daylight
  } else if (wx && Number.isFinite(Number(wx))) w.current.code = Number(wx);
  return w;
}

/**
 * The demo's weather at another place (#11): the same day shifted by a few degrees and another sky, picked from the
 * place's coordinates so each place always looks the same.
 */
export function mockPlaceWeather(now: Date, place: { name: string; lat: number; lon: number }, key: string): WeatherResponse {
  const w = baseWeather(now);
  const seed = Math.abs(Math.round(place.lat * 37 + place.lon * 11));
  // colder towards the poles, a little random
  const shift = Math.round(12 - Math.abs(place.lat) * 0.35 + (seed % 7) - 3) - 7;
  const skies = [0, 1, 2, 3, 61, 80, 71, 45];
  const code = skies[seed % skies.length];
  const sky: Record<number, string> = {
    0: L('Clear sky', 'Despejado', 'Céu limpo'), 1: L('Mainly clear', 'Mayormente despejado', 'Céu pouco nublado'),
    2: L('Partly cloudy', 'Parcialmente nublado', 'Parcialmente nublado'), 3: L('Overcast', 'Cubierto', 'Encoberto'),
    61: L('Light rain', 'Lluvia ligera', 'Chuva fraca'), 80: L('Rain showers', 'Chubascos', 'Aguaceiros'),
    71: L('Light snow', 'Nieve ligera', 'Neve fraca'), 45: L('Fog', 'Niebla', 'Nevoeiro'),
  };
  const add = (n: number) => Math.round((n + shift) * 10) / 10;
  w.locationName = place.name;
  w.placeKey = key;
  w.current = { ...w.current, temp: add(w.current.temp), feelsLike: w.current.feelsLike === null ? null : add(w.current.feelsLike), code, description: sky[code], humidity: 40 + (seed % 45) };
  w.today = { ...w.today, min: add(w.today.min), max: add(w.today.max) };
  w.daily = w.daily.map((d, i) => ({ ...d, min: add(d.min), max: add(d.max), code: i === 0 ? code : skies[(seed + i) % skies.length] }));
  w.hourly = w.hourly.map((h) => ({ ...h, temp: add(h.temp) }));
  w.indoor = null;
  return w;
}

function baseWeather(now: Date): WeatherResponse {
  const T = dateKeyInTz(now, TZ);
  const p = zonedParts(now, TZ);
  const hourly = [];
  const codes = [2, 2, 1, 1, 3, 61, 61, 3];
  for (let i = 1; i <= 8; i++) {
    const h = (p.hour + i) % 24;
    const k = p.hour + i >= 24 ? addDays(T, 1) : T;
    hourly.push({
      time: isoAt(k, h, 0), temp: Math.round(21 - Math.abs(15 - (p.hour + i)) * 0.6), code: codes[i - 1],
      precipChance: codes[i - 1] === 61 ? 60 : 5 + i * 2, isDay: h >= 8 && h <= 19,
    });
  }
  const daily = [
    { date: T, code: 2, min: 14, max: 22, precipChance: 10, windKmh: 14 },
    { date: addDays(T, 1), code: 61, min: 13, max: 19, precipChance: 70, windKmh: 22 },
    { date: addDays(T, 2), code: 80, min: 12, max: 18, precipChance: 55, windKmh: 25 },
    { date: addDays(T, 3), code: 1, min: 12, max: 21, precipChance: 5, windKmh: 10 },
    { date: addDays(T, 4), code: 0, min: 13, max: 23, precipChance: 0, windKmh: 8 },
    { date: addDays(T, 5), code: 3, min: 14, max: 20, precipChance: 20, windKmh: 12 },
    { date: addDays(T, 6), code: 95, min: 13, max: 18, precipChance: 80, windKmh: 30 },
  ];
  return {
    updatedAt: now.toISOString(),
    // ?place= another place name (screenshots for a demo elsewhere)
    locationName: new URLSearchParams(location.search).get('place') || L('Lisbon, Portugal', 'Lisboa, Portugal', 'Lisboa, Portugal'),
    current: {
      temp: 19.4, feelsLike: 18.6, humidity: 68, windKmh: 14, windDir: 315, windDirLabel: L('NW', 'NO', 'NO'), code: 2,
      // day between the sunrise (07:39) and the sunset (19:07) of `today` below
      isDay: p.hour * 60 + p.minute >= 7 * 60 + 39 && p.hour * 60 + p.minute < 19 * 60 + 7, description: L('Partly cloudy', 'Parcialmente nublado', 'Parcialmente nublado'), pressure: 1017, uv: 4,
    },
    today: { sunrise: isoAt(T, 7, 39), sunset: isoAt(T, 19, 7), min: 14, max: 22, precipChance: 10 },
    daily, hourly, indoor: { temp: 22.3, humidity: 54 },
    source: {
      provider: 'open-meteo', name: 'Open-Meteo', model: null, modelName: null, url: 'https://open-meteo.com/',
      licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    },
  };
}

export function mockNews(): NewsResponse {
  const items = DEMO_LANG === 'es' ? [
    ['La ciudad amplía la red de metro con cuatro nuevas estaciones', 'Las obras de la línea circular avanzan y se prevé abrir los nuevos tramos el próximo año.'],
    ['Delfines vuelven a avistarse en el estuario', 'Los biólogos registran un aumento de avistamientos este otoño; el turismo náutico celebra una temporada récord.'],
    ['Récord de producción de energía renovable', 'En septiembre, más del 80 % de la electricidad consumida procedió de fuentes eólicas, solares e hidroeléctricas.'],
    ['La fiesta de la vendimia cierra con 200.000 visitantes', 'Música, gastronomía y vino llenaron las calles del centro histórico durante cinco días.'],
    ['La biblioteca municipal abre también los domingos', 'El nuevo horario incluye talleres gratuitos para niños y un club de lectura en inglés.'],
    ['Previsión: llega la primera lluvia del otoño', 'Se esperan chubascos a partir del sábado, con un descenso notable de las temperaturas.'],
  ] : NL_DA !== null ? DEMO_NEWS[DEMO_LANG as 'nl' | 'da'].map(([a, b]) => [a, b]) : DEMO_LANG === 'pt' ? [
    ['Cidade alarga a rede de metro com quatro novas estações', 'As obras da linha circular avançam e os novos troços devem abrir no próximo ano.'],
    ['Golfinhos voltam a ser avistados no estuário', 'Os biólogos registam mais avistamentos este outono e os passeios de barco celebram uma temporada recorde.'],
    ['Renováveis batem recorde na produção de eletricidade', 'Em setembro, mais de 80 % da eletricidade consumida veio de fontes eólica, solar e hídrica.'],
    ['Festa das vindimas fecha com 200 mil visitantes', 'Música, gastronomia e vinho encheram as ruas do centro histórico durante cinco dias.'],
    ['Biblioteca municipal passa a abrir ao domingo', 'O novo horário inclui oficinas gratuitas para crianças e um clube de leitura em inglês.'],
    ['Previsão: chegam as primeiras chuvas do outono', 'Esperam-se aguaceiros a partir de sábado, com uma descida acentuada das temperaturas.'],
  ] : [
    // a showcase screen shows the first headline in a 4x2 card: its summary short enough for one line there
    ['City expands metro network with four new stations', SHOW_ACTIVE ? 'The circular line opens next spring.' : 'Work on the circular line is on schedule and the new sections are expected to open next year.'],
    ['Dolphins spotted again in the estuary', 'Biologists report more sightings this autumn as boat-tour operators celebrate a record season.'],
    ['Renewables hit a new record share of electricity', 'More than 80% of the power consumed in September came from wind, solar and hydro.'],
    ['Harvest festival closes with 200,000 visitors', 'Music, food and wine filled the streets of the old town for five days.'],
    ['Public library now opens on Sundays', 'The new schedule includes free workshops for kids and an English-language book club.'],
    ['Forecast: first autumn rain on the way', 'Showers are expected from Saturday, with a noticeable drop in temperatures.'],
  ];
  // ?busy=1: a headline too long for one line (it slides once while it shows)
  if (BUSY) {
    items.unshift([
      L('Reclaiming the space: how a small studio brings human presence back to the offices of a city that works from home',
        'Recuperar el espacio: cómo un pequeño estudio devuelve la presencia humana a las oficinas de una ciudad que trabaja desde casa',
        'Recuperar o espaço: como um pequeno estúdio devolve a presença humana aos escritórios de uma cidade que trabalha a partir de casa'),
      L('Architects and neighbours talk about what the change means for the old town.',
        'Arquitectos y vecinos hablan de lo que el cambio supone para el casco antiguo.',
        'Arquitetos e vizinhos falam do que a mudança significa para o centro histórico.'),
    ]);
  }
  return {
    updatedAt: new Date().toISOString(),
    items: items.map(([title, summary], i) => ({
      id: `n${i}`, title, summary, source: SHOW_ACTIVE ? L('City Herald', 'Diario de la Ciudad', 'Diário da Cidade') : L('Demo News', 'Noticias de ejemplo', 'Notícias de exemplo'), date: new Date(Date.now() - i * 3600e3).toISOString(),
    })),
  };
}

const PICSUM: [number, string][] = [
  [1015, 'Alexey Topolyanskiy'], [1018, 'Andrew Ridley'], [1036, 'Wolfgang Lutz'], [1043, 'Christian Joudrey'],
  [1044, 'Steve Carter'], [1016, 'Philippe Wuyts'], [1039, 'Andrew Coelho'], [1050, 'Joseph Barrientos'],
  [15, 'Paul Jarvis'], [29, 'Go Wild'], [28, 'Jerry Adney'], [10, 'Paul Jarvis'], [16, 'Paul Jarvis'], [17, 'Paul Jarvis'],
];

/** `topic`: the demo carousel's &photoMix=1 topics ('topic2'...) start the list at another photo. */
export function mockPhotos(topic = ''): PhotosResponse {
  // &photo=half: one photo, white on the left half and black on the right (the per-card ink of Personalizado)
  if (new URLSearchParams(location.search).get('photo') === 'half') return { photos: [{ url: halfPhoto(), author: '', source: 'stock' as const }] };
  const list = PICSUM.map(([id, author]) => ({ url: `https://picsum.photos/id/${id}/1920/1080`, author, source: 'stock' as const }));
  const k = /^topic(\d+)$/.exec(topic) ? (Number(topic.slice(5)) * 3) % list.length : 0;
  const photos = [...list.slice(k), ...list.slice(0, k)];
  // a showcase screen's own photo alone (show.home's evening lane behind it, show.bento's canyon in its photo card), so
  // the still screen always shows it whatever the card's place in the list
  const own = showPhoto();
  return { photos: own ? [{ ...own, source: 'stock' as const }] : photos };
}

let half = '';
function halfPhoto(): string {
  if (half) return half;
  const c = document.createElement('canvas');
  c.width = 1920;
  c.height = 1080;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1920, 1080);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 960, 1080);
  return (half = c.toDataURL('image/png'));
}

/** Countdown chips for the demo (mirrors GET /api/countdowns). */
export function mockCountdowns(now = new Date()): CountdownsResponse {
  const T = dateKeyInTz(now, TZ);
  const year = +T.slice(0, 4);
  const xmas = `${year}-12-25` >= T ? `${year}-12-25` : `${year + 1}-12-25`;
  const items: CountdownItem[] = [
    { id: 'k_today', title: 'Elena', emoji: '🎂', color: '#f15bb5', date: T, days: 0, origin: 'birthday', age: 39 },
    { id: 'k_trip', title: L('Trip to Madeira', 'Viaje a Madeira', 'Viagem à Madeira'), emoji: '✈️', color: '#4c8dff', date: addDays(T, 12), days: 12, origin: 'manual' },
    { id: 'k_luis', title: L('Grandpa Luis', 'Abuelo Luis', 'Avô Luis'), emoji: '🎂', color: '#f15bb5', date: addDays(T, 9), days: 9, origin: 'birthday', age: 81 },
    { id: 'k_party', title: L('Halloween party', 'Fiesta de Halloween', 'Festa de Halloween'), emoji: '🎃', color: '#ff9f1c', date: addDays(T, 1), days: 1, origin: 'event' },
    { id: 'k_xmas', title: L('Christmas', 'Navidad', 'Natal'), emoji: '🎄', color: '#2ec4b6', date: xmas, days: 0, origin: 'manual' },
  ];
  items.sort((a, b) => a.date.localeCompare(b.date));
  if (EMPTY) items.length = 0;
  if (PRIVATE) return { generatedAt: now.toISOString(), today: T, hash: `mock-cd-${T}-p`, items: items.filter((x) => x.origin !== 'event') };
  return showCountdowns({ generatedAt: now.toISOString(), today: T, hash: `mock-cd-${T}`, items });
}

/** ?announce=1|info|success|warning|urgent|all → sample announcements (as delivered by SSE `announce`). */
export function mockAnnouncements(which: string): Announcement[] {
  // ?announce=compact → the same samples, sent 2 min ago (already settled into corner toasts)
  const ago = which === 'compact' ? 120_000 : 0;
  const mk = (i: number, style: AlertStyle, emoji: string, title: string, body: string, dur = 600): Announcement => ({
    id: `a_demo${i}`, title, body, emoji, style, durationSec: dur, sound: false, screenIds: [],
    createdAt: new Date(Date.now() - ago - (3 - i) * 1000).toISOString(),
    expiresAt: new Date(Date.now() - ago - (3 - i) * 1000 + dur * 1000).toISOString(), via: 'hook', by: 'token:Home Assistant',
  });
  const all: Record<string, Announcement> = {
    success: mk(1, 'success', '🧺', L('The washing machine is done', 'La lavadora ha terminado', 'A máquina de lavar terminou'), L('Time to hang the laundry', 'Ya se puede tender la ropa', 'Já se pode estender a roupa')),
    info: mk(2, 'info', '📦', L('A parcel has arrived', 'Ha llegado un paquete', 'Chegou uma encomenda'), L("It's in the mailbox by the door", 'Está en el buzón de la entrada', 'Está na caixa do correio')),
    warning: mk(3, 'warning', '🌧️', L('Rain in 20 minutes', 'Va a llover en 20 minutos', 'Vai chover em 20 minutos'), L('Bring the laundry in', 'Recoged la ropa del tendedero', 'Recolham a roupa do estendal')),
    urgent: mk(3, 'urgent', '🚨', L('Garage door is open', 'Puerta del garaje abierta', 'Portão da garagem aberto'), L('It has been open for more than 15 minutes', 'Lleva abierta más de 15 minutos', 'Está aberto há mais de 15 minutos')),
  };
  if (which === 'all' || which === 'compact') return [all.info, all.warning, all.success];
  return [all[which] ?? all.success];
}
