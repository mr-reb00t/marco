#!/usr/bin/env node
// Demo mode: starts Marco with a throw-away data directory pre-filled with a fictional family
// (local events, birthdays, countdowns, filters, two screens, sample photos, an API token, activity…).
// Nothing touches your real data/ folder.
//
//   npm run demo                       # admin: http://localhost:3000/admin/ (password: demo-calendar); the display links are printed
//   npm run demo -- --port 3080        # another port
//   npm run demo -- --lang es          # Spanish (also: pt, nl, da, pl)
//   npm run demo -- --no-photos        # skip downloading sample photos from picsum.photos
//   npm run demo -- --data ./demo-data --keep   # keep the generated data directory afterwards
//
// The demo also serves two small iCal feeds (a vacation rental and a school calendar) from this process so the
// calendar shows ICS sources without any account.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultConfig, defaultScreenProfile } from '../server/core/defaults.js';
import { validateConfig } from '../server/core/validate.js';
import { hashPassword } from '../server/auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
if (flag('help') || flag('h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const PORT = Number(opt('port', process.env.PORT || 3000));
const LANG = ['es', 'pt', 'nl', 'da', 'pl'].includes(opt('lang', 'en')) ? opt('lang', 'en') : 'en';
const PASSWORD = 'demo-calendar';
const keep = flag('keep');
const dataDir = path.resolve(opt('data', fs.mkdtempSync(path.join(os.tmpdir(), 'marco-demo-'))));
// Dutch, Danish and Polish demo text, keyed by the English string: [nl, da, pl].
const NL_DA_PL = {
  'Swimming lesson – Lucía': ['Zwemles – Lucía', 'Svømning – Lucía', 'Basen – Lucía'],
  'Municipal pool': ['Gemeentelijk zwembad', 'Svømmehallen', 'Basen miejski'],
  'Football practice – Mateo': ['Voetbaltraining – Mateo', 'Fodboldtræning – Mateo', 'Trening piłki nożnej – Mateo'],
  'School trip to the science museum': ['Schoolreisje naar het wetenschapsmuseum', 'Skoleudflugt til videnskabsmuseet', 'Wycieczka szkolna do muzeum nauki'],
  'School play': ['Schoolvoorstelling', 'Skolekomedie', 'Przedstawienie szkolne'],
  'Miss Nora’s Birthday': ['Verjaardag van juf Nora', 'Lærer Noras fødselsdag', 'Urodziny pani Nory'],
  'Beach house': ['Strandhuis', 'Sommerhuset', 'Domek nad morzem'],
  'School & activities': ['School en activiteiten', 'Skole og aktiviteter', 'Szkoła i zajęcia'],
  'Public holidays': ['Feestdagen', 'Helligdage', 'Święta'],
  'Family': ['Gezin', 'Familie', 'Rodzina'],
  'Birthdays': ['Verjaardagen', 'Fødselsdage', 'Urodziny'],
  'Weekly meeting': ['Weekoverleg', 'Ugemøde', 'Cotygodniowe spotkanie'],
  'Padel with Rui': ['Padel met Rui', 'Padel med Rui', 'Padel z Ruim'],
  'Farmers market': ['Weekmarkt', 'Torvedag', 'Targ'],
  'Pay the rent': ['Huur betalen', 'Betal husleje', 'Zapłacić czynsz'],
  'Dentist – Lucía': ['Tandarts – Lucía', 'Tandlæge – Lucía', 'Dentysta – Lucía'],
  'Smile Clinic': ['Tandartspraktijk De Glimlach', 'Smilets Tandklinik', 'Gabinet Uśmiech'],
  'Dinner with Ana & Pedro': ['Uit eten met Ana en Pedro', 'Middag med Ana og Pedro', 'Kolacja z Aną i Pedrem'],
  'Seaside restaurant': ['Restaurant aan de haven', 'Restauranten ved havnen', 'Restauracja nad morzem'],
  'Vet – Luna': ['Dierenarts – Luna', 'Dyrlæge – Luna', 'Weterynarz – Luna'],
  'Car service': ['Auto naar de garage', 'Bilen til service', 'Przegląd samochodu'],
  'Cinema night': ['Bioscoopavond', 'Biografaften', 'Wieczór w kinie'],
  'Flight to Madeira': ['Vlucht naar Madeira', 'Fly til Madeira', 'Lot na Maderę'],
  'Vacation in the Algarve': ['Vakantie in de Algarve', 'Ferie i Algarve', 'Wakacje w Algarve'],
  "Inês & Duarte's wedding": ['Bruiloft van Inês en Duarte', 'Inês og Duartes bryllup', 'Ślub Inês i Duarte'],
  'Pediatrician – Mateo': ['Kinderarts – Mateo', 'Børnelæge – Mateo', 'Pediatra – Mateo'],
  'Grandpa Luis': ['Opa Luis', 'Morfar Luis', 'Dziadek Luis'],
  'Grandma Isabel': ['Oma Isabel', 'Mormor Isabel', 'Babcia Isabel'],
  'Aunt Rosa': ['Tante Rosa', 'Moster Rosa', 'Ciocia Rosa'],
  // the server's own "Not available" title (server/core/lib/i18n.js), so the filter still hides the blocked dates
  'Not available': ['Niet beschikbaar', 'Ikke ledig', 'Niedostępne'],
  'Blocked dates': ['Geblokkeerde data', 'Blokerede datoer', 'Zablokowane terminy'],
  'Football practice': ['Voetbaltraining', 'Fodboldtræning', 'Trening piłki nożnej'],
  'Football': ['Voetbal', 'Fodbold', 'Piłka nożna'],
  'Shorter titles': ['Kortere titels', 'Kortere titler', 'Krótsze tytuły'],
  'Swimming': ['Zwemles', 'Svømning', 'Basen'],
  'Christmas': ['Kerst', 'Jul', 'Boże Narodzenie'],
  'Halloween party': ['Halloweenfeest', 'Halloweenfest', 'Impreza halloweenowa'],
  'Take out the bins': ['Vuilnis buitenzetten', 'Skrald ud', 'Wynieść śmieci'],
  'Recycling & organic': ['Plastic en gft', 'Genbrug og madaffald', 'Plastik i bio'],
  'School run!': ['Naar school!', 'Afsted i skole!', 'Do szkoły!'],
  'Backpacks, snacks, water bottles': ['Schooltassen, tussendoortjes, drinkflessen', 'Skoletasker, madpakker, vandflasker', 'Plecaki, przekąski, bidony'],
  'Buy batteries for the remote': ['Batterijen kopen voor de afstandsbediening', 'Køb batterier til fjernbetjeningen', 'Kupić baterie do pilota'],
  'Call the plumber': ['Loodgieter bellen', 'Ring til blikkenslageren', 'Zadzwonić do hydraulika'],
  'Living room': ['Woonkamer', 'Stue', 'Salon'],
  'Kitchen': ['Keuken', 'Køkken', 'Kuchnia'],
  'Hall tablet': ['Tablet in de hal', 'Tablet i entréen', 'Tablet w przedpokoju'],
  'The washing machine is done': ['De wasmachine is klaar', 'Vaskemaskinen er færdig', 'Pralka skończyła'],
  'Time to hang the laundry': ['De was kan opgehangen worden', 'Tøjet kan hænges op', 'Czas rozwiesić pranie'],
  'A parcel has arrived': ['Er is een pakketje bezorgd', 'Der er kommet en pakke', 'Przyszła paczka'],
  "It's in the mailbox": ['Het ligt in de brievenbus', 'Den ligger i postkassen', 'Jest w skrzynce'],
  'Dinner is ready!': ['Het eten is klaar!', 'Maden er klar!', 'Obiad gotowy!'],
};
const MORE_COL = { nl: 0, da: 1, pl: 2 }[LANG];
const L = (en, es, pt = en) =>
  LANG === 'es' ? es : LANG === 'pt' ? pt : MORE_COL !== undefined ? NL_DA_PL[en]?.[MORE_COL] ?? en : en;

// ------------------------------------------------------------------ dates
const TZ = 'Europe/Lisbon';
const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (key, n) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const D = (n) => addDays(todayKey, n);
const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay();
const md = (key) => ({ month: Number(key.slice(5, 7)), day: Number(key.slice(8, 10)) });
const ics = (key) => key.replace(/-/g, '');
const year = Number(todayKey.slice(0, 4));

// ------------------------------------------------------------------ demo iCal feeds (served by this process)
function rentalFeed() {
  // Some property-management tools publish titles like "🏠 Guest - 2p+1m" plus "Adultos/Niños/Bebés" lines.
  const stays = [
    [-3, 1, 'Sophie Martin - 2p', 'Adults: 2'],
    [1, 5, 'João Pereira - 4p+1m', 'Adultos: 2\\nNiños: 2\\nBebés: 0\\nMascotas: 1'],
    [7, 10, 'Emma & Lukas - 2p', 'Adults: 2'],
    [13, 17, 'The Dubois family - 4p', 'Adults: 2\\nChildren: 1\\nInfants: 1'],
    [19, 23, 'Marco Rossi - 1p', 'Adults: 1'],
    [26, 29, 'Hannah K. - 3p+1m', 'Adults: 3\\nPets: 1'],
  ];
  const ev = stays.map(([a, b, title, desc], i) => [
    'BEGIN:VEVENT', `UID:demo-stay-${i}@marco.invalid`, `DTSTART;VALUE=DATE:${ics(D(a))}`,
    `DTEND;VALUE=DATE:${ics(D(b))}`, `SUMMARY:🏠 ${title}`, `DESCRIPTION:${desc}`, 'END:VEVENT',
  ].join('\r\n'));
  // An Airbnb-style blocked range ("Not available"), hidden by a filter rule in the demo config.
  ev.push(['BEGIN:VEVENT', 'UID:demo-block@marco.invalid', `DTSTART;VALUE=DATE:${ics(D(30))}`,
    `DTEND;VALUE=DATE:${ics(D(32))}`, 'SUMMARY:Airbnb (Not available)', 'END:VEVENT'].join('\r\n'));
  return wrap(ev);
}
function schoolFeed() {
  const start = D(-10);
  const ev = [
    ['BEGIN:VEVENT', 'UID:demo-swim@marco.invalid', `DTSTART;TZID=${TZ}:${ics(start)}T170000`,
      `DTEND;TZID=${TZ}:${ics(start)}T174500`, 'RRULE:FREQ=WEEKLY;BYDAY=WE', `SUMMARY:${L('Swimming lesson – Lucía', 'Natación – Lucía', 'Natação – Lucía')}`,
      `LOCATION:${L('Municipal pool', 'Piscina municipal', 'Piscina municipal')}`, 'END:VEVENT'],
    ['BEGIN:VEVENT', 'UID:demo-football@marco.invalid', `DTSTART;TZID=${TZ}:${ics(start)}T180000`,
      `DTEND;TZID=${TZ}:${ics(start)}T191500`, 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH', `SUMMARY:${L('Football practice – Mateo', 'Fútbol – Mateo', 'Futebol – Mateo')}`, 'END:VEVENT'],
    ['BEGIN:VEVENT', 'UID:demo-trip@marco.invalid', `DTSTART;VALUE=DATE:${ics(D(11))}`, `DTEND;VALUE=DATE:${ics(D(12))}`,
      `SUMMARY:${L('School trip to the science museum', 'Excursión al museo de la ciencia', 'Visita de estudo ao museu da ciência')}`, 'END:VEVENT'],
    // a birthday as calendars write it: Marco shows only the name next to the 🎂 (Cumpleaños, "Ordenar los títulos")
    ['BEGIN:VEVENT', 'UID:demo-nora@marco.invalid', `DTSTART;VALUE=DATE:${ics(D(3))}`, `DTEND;VALUE=DATE:${ics(D(4))}`,
      `SUMMARY:${L('Miss Nora’s Birthday', 'Cumpleaños de la profe Nora', 'Aniversário da professora Nora')}`, 'END:VEVENT'],
    ['BEGIN:VEVENT', 'UID:demo-play@marco.invalid', `DTSTART;TZID=${TZ}:${ics(D(17))}T183000`, `DTEND;TZID=${TZ}:${ics(D(17))}T200000`,
      `SUMMARY:${L('School play', 'Función del colegio', 'Teatro da escola')}`, 'END:VEVENT'],
  ].map((l) => l.join('\r\n'));
  return wrap(ev);
}
const wrap = (events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Marco//Demo//EN', ...events, 'END:VCALENDAR', ''].join('\r\n');

const feeds = http.createServer((req, res) => {
  const body = req.url.startsWith('/rental.ics') ? rentalFeed() : req.url.startsWith('/school.ics') ? schoolFeed() : null;
  if (!body) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' }).end(body);
});
await new Promise((r) => feeds.listen(0, '127.0.0.1', r));
const FEEDS = `http://127.0.0.1:${feeds.address().port}`;

// ------------------------------------------------------------------ config
const id = (p) => `${p}_${crypto.randomBytes(4).toString('hex')}`;
const cfg = defaultConfig();
cfg.calendar.sources = [
  ...cfg.calendar.sources,
  { id: 'c_rental', type: 'ics', name: L('Beach house', 'Casa de la playa', 'Casa da praia'), url: `${FEEDS}/rental.ics`,
    color: '#2ec4b6', emoji: '🏠', kind: 'airbnb', enabled: true, refreshMin: 5, insecureTls: false },
  { id: 'c_school', type: 'ics', name: L('School & activities', 'Colegio y actividades', 'Escola e atividades'), url: `${FEEDS}/school.ics`,
    color: '#ff9f1c', emoji: '', kind: 'generic', enabled: true, refreshMin: 15, insecureTls: false },
];
cfg.calendar.sources[0].name = L('Public holidays', 'Festivos', 'Feriados');
cfg.localEvents.name = L('Family', 'Familia', 'Família');
cfg.localEvents.color = '#4c8dff';
cfg.birthdays.name = L('Birthdays', 'Cumpleaños', 'Aniversários');

const le = (o) => ({ id: id('l'), emoji: '', color: null, location: '', notes: '', allDay: true, endDate: o.date, startTime: '', endTime: '',
  repeat: { freq: 'none', interval: 1, until: null, weekdays: [] }, exceptions: [], countdown: false, ...o });
const timed = (date, from, to, o = {}) => le({ date, endDate: date, allDay: false, startTime: from, endTime: to, ...o });
const firstWd = (wd) => { let k = D(-14); while (weekday(k) !== wd) k = addDays(k, 1); return k; };
cfg.localEvents.items = [
  timed(firstWd(1), '09:30', '10:30', { title: L('Weekly meeting', 'Reunión semanal', 'Reunião semanal'), repeat: { freq: 'weekly', interval: 1, until: null, weekdays: [1] } }),
  timed(firstWd(3), '19:30', '21:00', { title: L('Padel with Rui', 'Pádel con Rui', 'Padel com o Rui'), repeat: { freq: 'weekly', interval: 1, until: null, weekdays: [3] } }),
  timed(firstWd(6), '10:00', '12:00', { title: L('Farmers market', 'Mercado del sábado', 'Mercado de sábado'), emoji: '🧺', repeat: { freq: 'weekly', interval: 1, until: null, weekdays: [6] } }),
  le({ date: firstWd(5), title: L('Pay the rent', 'Pagar el alquiler', 'Pagar a renda'), emoji: '💶', repeat: { freq: 'monthly', interval: 1, until: null, weekdays: [] } }),
  timed(D(0), '17:30', '18:15', { title: L('Dentist – Lucía', 'Dentista – Lucía', 'Dentista – Lucía'), location: L('Smile Clinic', 'Clínica Sonrisa', 'Clínica Sorriso') }),
  timed(D(1), '21:00', '23:30', { title: L('Dinner with Ana & Pedro', 'Cena con Ana y Pedro', 'Jantar com Ana e Pedro'), location: L('Seaside restaurant', 'Restaurante del puerto', 'Restaurante do porto') }),
  timed(D(3), '16:15', '16:45', { title: L('Vet – Luna', 'Veterinario – Luna', 'Veterinário – Luna') }),
  timed(D(6), '08:45', '09:45', { title: L('Car service', 'Revisión del coche', 'Revisão do carro') }),
  timed(D(8), '21:30', '23:59', { title: L('Cinema night', 'Noche de cine', 'Noite de cinema') }),
  timed(D(12), '07:40', '09:00', { title: L('Flight to Madeira', 'Vuelo a Madeira', 'Voo para a Madeira'), countdown: true }),
  le({ date: D(18), endDate: D(22), title: L('Vacation in the Algarve', 'Vacaciones en el Algarve', 'Férias no Algarve') }),
  timed(D(20), '16:00', '23:59', { title: L("Inês & Duarte's wedding", 'Boda de Inês y Duarte', 'Casamento da Inês e do Duarte') }),
  timed(D(-1), '10:00', '10:30', { title: L('Pediatrician – Mateo', 'Pediatra – Mateo', 'Pediatra – Mateo') }),
];
const bd = (name, key, y, emoji = '') => ({ id: id('b'), name, ...md(key), year: y, emoji });
cfg.birthdays.items = [
  bd('Elena', D(0), year - 39),
  bd(L('Grandpa Luis', 'Abuelo Luis', 'Avô Luis'), D(9), year - 81),
  bd('Mateo', D(16), year - 7),
  bd(L('Grandma Isabel', 'Abuela Isabel', 'Avó Isabel'), D(25), year - 72),
  bd('Lucía', D(40), year - 10),
  bd('Pablo', D(120), year - 41),
  bd(L('Aunt Rosa', 'Tía Rosa', 'Tia Rosa'), D(200), null),
  bd('Luna 🐶', D(75), year - 4, '🐾'),
];
const rule = (o) => ({ id: id('f'), enabled: true, matchMode: 'contains', field: 'title', sourceIds: [], replaceWith: '', emoji: '', color: null, countdown: false, note: '', ...o });
cfg.eventRules.items = [
  rule({ action: 'hide', match: L('Not available', 'No disponible', 'Indisponível'), sourceIds: ['c_rental'], note: L('Blocked dates', 'Fechas bloqueadas', 'Datas bloqueadas') }),
  rule({ action: 'rename', match: L('Football practice', 'Fútbol', 'Futebol'), replaceWith: L('Football', 'Fútbol', 'Futebol'), note: L('Shorter titles', 'Títulos más cortos', 'Títulos mais curtos') }),
  rule({ action: 'style', match: L('Football', 'Fútbol', 'Futebol'), emoji: '⚽', color: null }),
  rule({ action: 'style', match: L('Swimming', 'Natación', 'Natação'), emoji: '🏊', color: null }),
  rule({ action: 'style', match: L('School play', 'Función del colegio', 'Teatro da escola'), emoji: '🎭', color: '#f15bb5', countdown: true }),
  rule({ action: 'style', match: 'Padel', emoji: '🎾', color: null }),
];
const xmas = `${todayKey <= `${year}-12-25` ? year : year + 1}-12-25`;
cfg.countdowns.items = [
  { id: id('k'), title: L('Christmas', 'Navidad', 'Natal'), emoji: '🎄', color: '#2ec4b6', date: xmas, yearly: true },
  { id: id('k'), title: L('Halloween party', 'Fiesta de Halloween', 'Festa de Halloween'), emoji: '🎃', color: '#ff9f1c', date: D(22), yearly: false },
];
cfg.schedules.items = [
  { id: id('m'), enabled: true, title: L('Take out the bins', 'Sacar la basura', 'Pôr o lixo na rua'), body: L('Recycling & organic', 'Orgánico y envases', 'Reciclagem e orgânico'),
    emoji: '🗑️', style: 'warning', days: [2, 5], from: '20:00', to: '22:00', startDate: null, endDate: null, screenIds: [], sound: true },
  { id: id('m'), enabled: true, title: L('School run!', '¡Al colegio!', 'Para a escola!'), body: L('Backpacks, snacks, water bottles', 'Mochilas, merienda y agua', 'Mochilas, lanche e água'),
    emoji: '🎒', style: 'info', days: [1, 2, 3, 4, 5], from: '08:00', to: '08:30', startDate: null, endDate: null, screenIds: ['s_kitchen'], sound: false },
];
cfg.todo.items = [
  { id: 't1', text: L('Buy batteries for the remote', 'Comprar pilas para el mando', 'Comprar pilhas para o comando'), done: false },
  { id: 't2', text: L('Call the plumber', 'Llamar al fontanero', 'Ligar ao canalizador'), done: true },
];

const living = cfg.screens[0];
living.name = L('Living room', 'Salón', 'Sala');
living.screen.language = LANG;
living.background.source = flag('no-photos') ? 'stock' : 'mixed';
const kitchen = defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: L('Kitchen', 'Cocina', 'Cozinha') });
kitchen.screen.language = LANG;
kitchen.screen.theme = 'light';
kitchen.screen.accent = '#2a9d8f';
kitchen.layout = { preset: 'leftRight', sidePanel: 'right', sideWidth: 0.4 };
kitchen.calendar.view = 'agenda';
kitchen.background.source = flag('no-photos') ? 'stock' : 'gallery';
kitchen.background.ambient = 'none';
kitchen.todo.enabled = true;
// A calm news feed for the demo (the default world-news feed can be grim on a family screen).
cfg.news.feeds = [{ id: 'n1', name: 'NASA – Image of the Day', url: 'https://www.nasa.gov/feeds/iotd-feed/', enabled: true }];
cfg.screens.push(kitchen);

const { ok, errors, value } = validateConfig(cfg);
if (!ok) {
  console.error('[demo] invalid demo config:', errors);
  process.exit(1);
}

// ------------------------------------------------------------------ write the data dir
fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'photos', '.thumbs'), { recursive: true });
const write = (f, v) => fs.writeFileSync(path.join(dataDir, f), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
value.revision = 14;
write('config.json', value);

const ago = (min) => new Date(Date.now() - min * 60_000);
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
for (const [min, rev, reason] of [[60 * 26, 11, 'save'], [60 * 5, 12, 'manual'], [42, 13, 'save']]) {
  write(`backups/config-${stamp(ago(min))}-r${rev}-${reason}.json`, { ...value, revision: rev });
}

const demoToken = `cs_${crypto.randomBytes(24).toString('base64url')}`;
// Private display links (one per screen) + one paired device: the demo runs in private display-access mode.
const displayKeys = Object.fromEntries(value.screens.map((s) => [s.id, { key: crypto.randomUUID(), createdAt: ago(60 * 24 * 12).toISOString() }]));
const deviceToken = `md_${crypto.randomBytes(32).toString('base64url')}`;
write('secrets.json', {
  displayKeys,
  devices: [{
    id: 'dv_demo0000001', name: L('Hall tablet', 'Tablet del recibidor', 'Tablet da entrada'), screenId: 's_kitchen',
    hash: crypto.createHash('sha256').update(deviceToken).digest('hex'), prefix: deviceToken.slice(0, 7),
    createdAt: ago(60 * 24 * 3).toISOString(), lastSeenAt: ago(4).toISOString(), lastIp: '192.168.1.63',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  }],
  passwordHash: await hashPassword(PASSWORD),
  passwordIsDefault: false,
  sessionSecret: crypto.randomBytes(32).toString('hex'),
  sessionEpoch: crypto.randomBytes(16).toString('hex'),
  google: { accounts: {} },
  homeassistant: {},
  apiTokens: [{
    id: 'tk_demo00000001', name: 'Home Assistant', hash: crypto.createHash('sha256').update(demoToken).digest('hex'),
    prefix: demoToken.slice(0, 8), createdAt: ago(60 * 24 * 12).toISOString(), lastUsedAt: ago(35).toISOString(),
    lastUsedIp: '192.168.1.20', useCount: 128,
  }],
});

let seq = 0;
const act = (min, type, actor, data, level = 'info', ip = '192.168.1.42') => {
  const t = ago(min).getTime();
  return JSON.stringify({ id: `${t.toString(36)}${(seq++).toString(36).padStart(3, '0')}aa`, ts: new Date(t).toISOString(), type, level, actor, ip, ...(data ? { data } : {}) });
};
write('activity.jsonl', [
  act(60 * 24 * 3, 'display.paired', 'password', { id: 'dv_demo0000001', name: L('Hall tablet', 'Tablet del recibidor', 'Tablet da entrada'), screen: 'kitchen' }, 'warn'),
  act(60 * 30, 'auth.login', 'password', { method: 'password' }),
  act(60 * 29, 'config.saved', 'password', { revision: 10, sections: ['calendar', 'birthdays'] }),
  act(60 * 26, 'token.created', 'password', { id: 'tk_demo00000001', name: 'Home Assistant', prefix: demoToken.slice(0, 8) }),
  act(60 * 26, 'config.saved', 'password', { revision: 11, sections: ['screens:kitchen.layout', 'screens:kitchen.background'] }),
  act(60 * 20, 'display.connected', 'system', { clientId: 'kitchen-pi', screen: 'kitchen' }, 'info', '192.168.1.51'),
  act(60 * 9, 'source.error', 'system', { sourceId: 'c_school', name: L('School & activities', 'Colegio y actividades'), error: 'HTTP 503' }, 'warn', null),
  act(60 * 8, 'source.recovered', 'system', { sourceId: 'c_school', name: L('School & activities', 'Colegio y actividades') }, 'info', null),
  act(60 * 5, 'backup.created', 'password', { id: `config-${stamp(ago(60 * 5))}-r12-manual.json` }),
  act(60 * 2, 'auth.login_failed', 'anonymous', { method: 'password', reason: 'bad_password' }, 'warn', '192.168.1.77'),
  act(95, 'announce.sent', 'token:Home Assistant', { title: L('The washing machine is done', 'La lavadora ha terminado'), screens: [], via: 'hook' }, 'info', '192.168.1.20'),
  act(42, 'config.saved', 'password', { revision: 13, sections: ['eventRules', 'countdowns'] }),
  act(35, 'token.used', 'token:Home Assistant', { id: 'tk_demo00000001', endpoint: 'announce' }, 'info', '192.168.1.20'),
  act(3, 'auth.login', 'password', { method: 'password' }),
].join('\n') + '\n');

const ann = (min, emoji, title, body, style, by = 'token:Home Assistant', via = 'hook') => ({
  id: id('a'), title, body, emoji, style, durationSec: 300, sound: true, screenIds: [], createdAt: ago(min).toISOString(),
  expiresAt: ago(min - 5).toISOString(), via, by, clearedAt: null,
});
write('announcements.json', { active: [], history: [
  ann(95, '🧺', L('The washing machine is done', 'La lavadora ha terminado', 'A máquina de lavar terminou'), L('Time to hang the laundry', 'Ya se puede tender la ropa', 'Já se pode estender a roupa'), 'success'),
  ann(60 * 6, '📦', L('A parcel has arrived', 'Ha llegado un paquete', 'Chegou uma encomenda'), L("It's in the mailbox", 'Está en el buzón', 'Está na caixa do correio'), 'info'),
  ann(60 * 27, '🍕', L('Dinner is ready!', '¡A cenar!', 'O jantar está pronto!'), '', 'info', 'password', 'admin'),
] });

// ------------------------------------------------------------------ sample photos (picsum.photos, free to use)
const PHOTOS = [
  // [picsum id, width, height, focusX, focusY, file]
  [1015, 2400, 1600, 0.5, 0.55, 'river-valley.jpg'],
  [1025, 1600, 2000, 0.5, 0.42, 'pug-in-a-blanket.jpg'],
  [1043, 2400, 1600, 0.55, 0.5, 'autumn-forest.jpg'],
  [1011, 2400, 1600, 0.47, 0.52, 'canoe.jpg'],
  [1039, 2400, 1600, 0.5, 0.45, 'waterfall.jpg'],
  [1062, 1600, 2000, 0.48, 0.45, 'dog-portrait.jpg'],
  [1016, 2400, 1600, 0.5, 0.5, 'canyon.jpg'],
  [1050, 2400, 1600, 0.5, 0.6, 'mountain-lake.jpg'],
  [1036, 2400, 1600, 0.5, 0.5, 'winter-trees.jpg'],
  [1080, 1600, 2000, 0.5, 0.5, 'strawberries.jpg'],
];
async function download(url, dest) {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}
if (!flag('no-photos')) {
  process.stdout.write('[demo] downloading sample photos from picsum.photos ');
  const meta = {};
  for (const [pid, w, h, fx, fy, file] of PHOTOS) {
    try {
      const dest = path.join(dataDir, 'photos', file);
      await download(`https://picsum.photos/id/${pid}/${w}/${h}.jpg`, dest);
      const tw = 480, th = Math.round((480 * h) / w);
      await download(`https://picsum.photos/id/${pid}/${tw}/${th}.jpg`, path.join(dataDir, 'photos', '.thumbs', file));
      meta[file] = { w, h, focusX: fx, focusY: fy, bytes: fs.statSync(dest).size, uploadedAt: ago(60 * 24 * (PHOTOS.length - Object.keys(meta).length)).toISOString() };
      process.stdout.write('.');
    } catch (err) {
      process.stdout.write('x');
    }
  }
  write('photos/.meta.json', JSON.stringify(meta));
  process.stdout.write(` ${Object.keys(meta).length} photos\n`);
}

// ------------------------------------------------------------------ build (if needed) + start the server
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.log('[demo] dist/ not found, running `npm run build` first');
  const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (b.status !== 0) process.exit(b.status || 1);
}
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, NODE_ENV: 'production', DATA_DIR: dataDir, PORT: String(PORT), ADMIN_PASSWORD: PASSWORD, PUBLIC_URL: `http://localhost:${PORT}` },
});
console.log(`
  Marco demo
  ──────────
${value.screens.map((s) => `  Display:   http://localhost:${PORT}/d/${displayKeys[s.id].key}   (${s.name}: private link)`).join('\n')}
  Pairing:   http://localhost:${PORT}/pair        (shows a code to type in the admin → Connected screens → Pair a screen)
  Admin:     http://localhost:${PORT}/admin/      password: ${PASSWORD}
  API token: ${demoToken}
  Data dir:  ${dataDir}${keep ? '' : '  (deleted on exit; use --keep to keep it)'}
  Press Ctrl+C to stop.
`);

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  feeds.close();
  setTimeout(() => {
    if (!keep && !opt('data')) fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(code);
  }, 500);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
child.on('exit', (c) => stop(c ?? 0));
