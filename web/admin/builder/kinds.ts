// What the builder's palette shows for each kind: its Spanish name (a t() key), a one-line help, an icon, search
// words and whether this server can use it yet. Sizes, options and editions come from server/core/canvasCore.js.
import type { CanvasCategory, CanvasKind } from '../../shared/types';
import { CANVAS_KINDS, isRotatorGroup } from '../../../server/core/canvasCore.js';
import type { IconName } from '../components/icons';

/** Palette groups, in order: the registry's categories plus the owner's saved widgets ("Mis widgets"). */
export type PaletteGroup = CanvasCategory | 'mine';
export const GROUPS: { id: PaletteGroup; name: string; icon: IconName }[] = [
  { id: 'time', name: 'Reloj y fecha', icon: 'clock' },
  { id: 'calendar', name: 'Calendario', icon: 'calendar' },
  { id: 'weather', name: 'Tiempo', icon: 'cloud' },
  { id: 'home', name: 'Casa (Home Assistant)', icon: 'home' },
  { id: 'content', name: 'Contenido', icon: 'news' },
  { id: 'nav', name: 'Navegación', icon: 'monitor' },
  { id: 'family', name: 'Familia y hogar', icon: 'users' },
  { id: 'data', name: 'Datos', icon: 'trend' },
  { id: 'mine', name: 'Mis widgets', icon: 'widget' },
  { id: 'adv', name: 'Avanzado', icon: 'code' },
];

export interface KindMeta {
  name: string;
  help: string;
  icon: IconName;
  /** extra search words (Spanish keys are translated too) */
  words?: string;
  /** search tags in every admin language at once (es, en, pt, nl, da, pl), on top of the group's GROUP_TAGS */
  tags?: string;
  /** not drawn by this version yet: shown locked */
  soon?: boolean;
  /** palette group when it is not the registry's category */
  group?: PaletteGroup;
}

export const KIND_META: Partial<Record<CanvasKind, KindMeta>> = {
  'clock.digital': { name: 'Reloj digital', help: 'La hora en grande, con la fecha si quieres.', icon: 'clock', tags: 'digital números numbers cijfers tal cyfrowy cyfry' },
  'clock.analog': { name: 'Reloj analógico', help: 'Un reloj de agujas, con varias esferas.', icon: 'clock', tags: 'agujas esfera analog hands face ponteiros wijzers visere wskazówki tarcza analogowy' },
  'clock.flip': { name: 'Reloj de paletas', help: 'Las cifras giran como en un reloj antiguo de estación.', icon: 'clock', tags: 'flip paletas retro estación station klapki retro dworzec' },
  'clock.world': { name: 'Relojes del mundo', help: 'La hora de hasta cuatro ciudades.', icon: 'globe', tags: 'mundo ciudades zonas horarias world cities time zones cidades fusos wereld steden tijdzones verden byer tidszoner świat miasta strefy czasowe' },
  date: { name: 'Fecha', help: 'El día de hoy, con la semana y la salida y puesta del sol.', icon: 'calendar', tags: 'fecha día hoy semana date day today week data dia hoje datum dag vandaag dato i dag sol sun data dzień dziś tydzień słońce' },
  'calendar.month': { name: 'Mes', help: 'El calendario del mes, o de las semanas que elijas.', icon: 'calendar', tags: 'mes month mês maand måned miesiąc' },
  'calendar.week': { name: 'Semana', help: 'Siete días en columnas, desde hoy o desde el lunes.', icon: 'calendar', tags: 'semana week uge tydzień' },
  'calendar.agenda': { name: 'Agenda', help: 'Los próximos eventos agrupados por día.', icon: 'list', tags: 'lista próximos list upcoming lijst liste lista nadchodzące' },
  'calendar.today': { name: 'Hoy hora a hora', help: 'El día de hoy con una línea que marca la hora.', icon: 'clock', tags: 'hoy horas today hours hoje vandaag uren i dag timer dziś godziny' },
  'calendar.next': { name: 'Próximo evento', help: 'Lo siguiente que toca, y cuánto falta.', icon: 'bell', tags: 'siguiente próximo next upcoming volgende næste następne najbliższe' },
  'calendar.people': { name: 'Por persona', help: 'Una columna por persona de la familia.', icon: 'users', tags: 'personas familia columnas people family columns pessoas personen mensen personer osoby rodzina kolumny' },
  countdowns: { name: 'Cuentas atrás', help: 'Los días que faltan para lo que esperáis.', icon: 'hourglass', tags: 'cuenta atrás días faltan countdown days contagem decrescente aftellen nedtælling odliczanie dni' },
  'weather.now': { name: 'Tiempo ahora', help: 'La temperatura y el cielo de este momento.', icon: 'sun', tags: 'ahora actual now current agora nu teraz bieżąca' },
  'weather.hourly': { name: 'Próximas horas', help: 'El tiempo de las próximas horas.', icon: 'cloud', tags: 'horas por hora hourly hours uur per uur time for time godziny godzinowa' },
  'weather.forecast': { name: 'Próximos días', help: 'La previsión de los próximos días.', icon: 'cloud', tags: 'días semana previsión forecast days previsão dagen dage dni prognoza' },
  'weather.cities': { name: 'Tiempo en varias ciudades', help: 'El tiempo de ahora en dos a ocho lugares.', icon: 'globe', tags: 'ciudades lugares varias mundo cities places world cidades lugares steden plaatsen byer steder miasta miejsca świat' },
  message: { name: 'Mensaje', help: 'El mensaje de esta pantalla.', icon: 'message', tags: 'mensaje texto nota message text note mensagem bericht tekst besked komunikat tekst notatka' },
  todo: { name: 'Lista de tareas', help: 'Las tareas de la lista de esta pantalla.', icon: 'checklist', tags: 'tareas pendientes lista compra todo tasks list shopping tarefas taken lijst opgaver liste zadania lista zakupy' },
  news: { name: 'Noticias', help: 'Los titulares de tus fuentes de noticias.', icon: 'news', tags: 'noticias titulares rss news headlines notícias nieuws nyheder wiadomości nagłówki' },
  photo: { name: 'Fotos', help: 'Un pase de fotos dentro de una tarjeta.', icon: 'photos', tags: 'fotos imágenes galería photos pictures gallery imagens foto’s billeder zdjęcia obrazy galeria' },
  value: { name: 'Valor', help: 'Un número o un texto que envías desde Home Assistant u otro programa.', icon: 'activity', words: 'webhook api clave sensor', tags: 'valor webhook api número sensor value number waarde værdi home assistant ha hass domótica smart home wartość liczba czujnik' },
  nowplaying: { name: 'Sonando ahora', help: 'Lo que suena en una cuenta de Spotify: la canción, el artista y la portada. Si no suena nada, no se ve.', icon: 'music', words: 'spotify música canción', tags: 'spotify música music canción song canção nummer sang podcast sonando playing a tocar speelt afspilles muzyka piosenka utwór teraz gra odtwarzane' },
  rotator: { name: 'Rotativa', help: 'Varias tarjetas en un mismo hueco, una tras otra cada pocos segundos.', icon: 'repeat', words: 'carrusel rotar alternar', tags: 'rotativa carrusel rotar alternar carousel rotate rotating cycle slideshow carrossel rotativo roterend wisselend karrusel skiftende rotująca karuzela zmiana' },
  spacer: { name: 'Espacio', help: 'Un hueco vacío, por ejemplo para dejar ver la foto.', icon: 'layout', group: 'adv', tags: 'espacio hueco vacío space gap empty espaço ruimte plads odstęp przerwa puste' },
  'family.members': { name: 'Familia', help: 'Las caras de la familia, con sus estrellas y lo que llevan hecho hoy.', icon: 'users', tags: 'familia miembros caras family members faces membros gezinsleden familiemedlemmer rodzina członkowie twarze' },
  'family.routines': { name: 'Rutinas', help: 'Las rutinas de hoy de una persona o de todos. Se pueden marcar tocando la pantalla si lo permites en Familia.', icon: 'checklist', tags: 'rutinas mañana noche routines morning evening rotinas rutiner rutyny rano wieczór' },
  'family.points': { name: 'Estrellas', help: 'Quién lleva más estrellas.', icon: 'star', tags: 'estrellas puntos ranking stars points estrelas pontos sterren punten stjerner point gwiazdki punkty ranking' },
  'family.rewards': { name: 'Premios', help: 'El próximo premio de cada uno y cuánto le falta.', icon: 'target', tags: 'premios recompensas rewards prizes prémios beloningen belønninger nagrody' },
  'family.chores': { name: 'Tareas de hoy', help: 'Todo lo que queda por hacer hoy, con la cara de quién lo hace.', icon: 'check', tags: 'tareas casa chores tasks tarefas klusjes taken pligter opgaver obowiązki zadania' },
  'meals.today': { name: 'Menú de hoy', help: 'El desayuno, la comida y la cena de hoy.', icon: 'utensils', tags: 'menú comida cena desayuno meals food lunch dinner refeições ementa maaltijden eten måltider mad posiłki jedzenie obiad kolacja śniadanie' },
  'meals.week': { name: 'Semana de comidas', help: 'Los menús de la semana, con hoy resaltado.', icon: 'utensils', tags: 'menú semana comidas meals week food ementa maaltijden madplan posiłki tydzień jadłospis' },
  birthdays: { name: 'Cumpleaños próximos', help: 'Los cumpleaños del próximo mes, del calendario Cumpleaños.', icon: 'cake', tags: 'cumpleaños birthdays aniversários verjaardagen fødselsdage urodziny' },
  highlights: { name: 'Lo destacado de hoy', help: 'El próximo evento, lo que pasa ahora, entradas y salidas y los cumpleaños de hoy.', icon: 'sparkles', tags: 'destacado resumen highlights summary destaques hoogtepunten højdepunkter najważniejsze podsumowanie' },
  announcement: { name: 'Aviso en pantalla', help: 'El aviso que esté en pantalla. Si no hay ninguno, la tarjeta no se ve.', icon: 'megaphone', tags: 'aviso anuncio announcement notice melding meddelelse ogłoszenie komunikat' },
  'ha.tile': { name: 'Entidad', help: 'Cualquier cosa de Home Assistant, con su estado y, si quieres, sus controles debajo.', icon: 'home', words: 'válvula aspirador robot selector número actualización', tags: 'entidad dispositivo entity device entidade entiteit apparaat enhed encja urządzenie' },
  'ha.light': { name: 'Luz', help: 'Encender, apagar y regular una luz.', icon: 'zap', tags: 'luz luces lámpara light lights lamp luzes lampen lys lampe światło lampa oświetlenie' },
  'ha.switch': { name: 'Interruptor', help: 'Un enchufe, un interruptor o un ventilador.', icon: 'zap', tags: 'interruptor enchufe ventilador switch plug fan tomada ventoinha schakelaar stekker ventilator kontakt stik przełącznik gniazdko wentylator' },
  'ha.climate': { name: 'Clima', help: 'La calefacción o el aire, con su temperatura.', icon: 'sun', tags: 'clima calefacción aire acondicionado termostato climate heating air conditioning thermostat aquecimento ar condicionado klimaat verwarming airco thermostaat klima varme aircondition termostat klimat ogrzewanie klimatyzacja termostat' },
  'ha.cover': { name: 'Persiana', help: 'Subir, parar y bajar una persiana.', icon: 'layout', tags: 'persiana estor cortina toldo cover blind shutter curtain estore rolluik gordijn rullegardin persienne roleta żaluzja zasłona markiza' },
  'ha.sensor': { name: 'Sensor', help: 'Un valor en grande: temperatura, humedad, consumo.', icon: 'activity', tags: 'sensor temperatura humedad consumo temperature humidity humidade vochtigheid fugtighed czujnik temperatura wilgotność zużycie' },
  'ha.room': { name: 'Habitación', help: 'Varias cosas de una habitación en una tarjeta.', icon: 'home', tags: 'habitación sala room quarto kamer rum værelse pomieszczenie pokój' },
  'ha.chart': { name: 'Gráfica', help: 'Cómo ha cambiado un sensor en las últimas horas.', icon: 'activity', tags: 'gráfica historial chart graph history gráfico histórico grafiek geschiedenis graf historik wykres historia' },
  'ha.camera': { name: 'Cámara', help: 'La imagen de una cámara, renovada cada pocos segundos.', icon: 'eye', tags: 'cámara vídeo timbre camera video doorbell câmara campainha deurbel kamera dørklokke kamera wideo dzwonek' },
  'ha.media': { name: 'Multimedia', help: 'Lo que suena en un altavoz o una tele.', icon: 'play', tags: 'multimedia música altavoz tele media music speaker tv coluna muziek musik højttaler multimedia muzyka głośnik telewizor' },
  'ha.scene': { name: 'Escenas', help: 'Botones para lanzar escenas o scripts.', icon: 'sparkles', tags: 'escenas scripts botones scenes buttons cenas botões scènes knoppen scener knapper sceny skrypty przyciski' },
  'ha.gauge': { name: 'Indicador', help: 'Un valor sobre una barra de mínimo a máximo, con colores según lo alto que esté.', icon: 'target', words: 'gauge barra nivel porcentaje', tags: 'indicador gauge barra nivel porcentaje medidor meter niveau måler wskaźnik pasek poziom procent' },
  'ha.statistic': { name: 'Estadística', help: 'Lo gastado hoy, esta semana o este mes, o la media, el mínimo o el máximo de un sensor.', icon: 'activity', words: 'energía consumo media estadística', tags: 'estadística energía consumo media statistic energy usage average estatística energia statistiek energie statistik energi statystyka energia zużycie średnia' },
  market: { name: 'Cripto', help: 'El precio de hasta seis criptomonedas, con lo que han subido o bajado y su curva de 1, 7 o 30 días.', icon: 'coins', words: 'bitcoin ethereum cripto mercado precio coingecko', tags: 'cripto bitcoin crypto mercado market kripto kryptowaluty rynek' },
  sports: { name: 'Deportes', help: 'Resultados en directo, próximos partidos y últimos resultados de tus equipos o competiciones.', icon: 'trophy', words: 'fútbol liga partido marcador nba equipo resultados', tags: 'fútbol deportes partidos resultados football soccer sports scores futebol desporto voetbal sport fodbold sport piłka mecze wyniki' },
  stocks: { name: 'Bolsa', help: 'Cotizaciones de acciones y fondos, en una línea que se desplaza o en lista.', icon: 'trend', words: 'acciones cotización mercado índice ticker finnhub', tags: 'bolsa acciones stocks shares ações beurs aandelen aktier børs giełda akcje notowania' },
  currency: { name: 'Divisas', help: 'El cambio de hasta seis pares de monedas del Banco Central Europeo, con lo que ha variado desde el día anterior y su curva de 7 días, 30 días o un año.', icon: 'exchange', words: 'divisas cambio moneda euro dólar forinto bce frankfurter', tags: 'divisas cambio moneda currency exchange rate forex câmbio moeda valuta wisselkoers valuta veksling waluty kurs euro dolar złoty' },
  heading: { name: 'Sección', help: 'Un título con emoji para agrupar las tarjetas que tiene debajo.', icon: 'tag', words: 'título encabezado grupo', tags: 'sección título section heading title secção kop sectie sektion overskrift home assistant ha hass domótica smart home sekcja tytuł nagłówek' },
  'nav.button': { name: 'Ir a pantalla', help: 'Un botón que lleva a otra pantalla de casa, o de vuelta a la de siempre del dispositivo. Necesita tocar la pantalla.', icon: 'right', words: 'botón navegar pantalla inicio volver carrusel', tags: 'ir pantalla botón navegar inicio go screen button navigate home ir ecrã botão navegar início ga naar scherm knop navigeren start gå til skærm knap naviger przejdź ekran nawigacja przycisk' },
  'nav.pause': { name: 'Pausar carrusel', help: 'Un botón que para el carrusel en esta pantalla y lo deja seguir con otro toque.', icon: 'play', words: 'pausa parar carrusel', tags: 'pausar pausa parar carrusel pause stop carousel pausar carrossel pauzeren carrousel pause karrusel wstrzymaj pauza karuzela' },
  'nav.progress': { name: 'Progreso del carrusel', help: 'Qué pantalla del carrusel se ve y cuánto le queda, con puntos o una barra fina.', icon: 'more', words: 'puntos barra tiempo carrusel', tags: 'progreso puntos barra carrusel progress dots bar carousel progresso pontos barra carrossel voortgang punten balk carrousel fremskridt prikker bjælke karrusel postęp kropki pasek karuzela' },
  html: { name: 'HTML propio', help: 'Una tarjeta con tu propio HTML y CSS.', icon: 'code', words: 'css plantilla código', tags: 'html css plantilla código template code modelo sjabloon skabelon home assistant ha hass domótica smart home szablon kod' },
};

/**
 * Search tags of each palette group in the six admin languages: every kind of the group gets them, so a new kind is
 * found by them too. The search ignores case and accents.
 */
export const GROUP_TAGS: Record<PaletteGroup, string> = {
  time: 'hora reloj tiempo time clock watch hour horas relógio klok tijd uur ur klokken tid godzina zegar czas',
  calendar: 'calendario eventos agenda citas calendar events appointments schedule calendário eventos agenda afspraken kalender begivenheder aftaler kalendarz wydarzenia terminy',
  weather: 'tiempo clima lluvia temperatura previsión weather forecast rain temperature tempo chuva previsão weer regen voorspelling vejr regn vejrudsigt pogoda deszcz temperatura prognoza',
  home: 'home assistant ha hass domótica casa inteligente smart home dispositivos devices dispositivos slim huis apparaten smart hjem enheder inteligentny dom urządzenia',
  content: 'contenido content conteúdo inhoud indhold treść',
  nav: 'navegación pantallas táctil tocar navigation screens touch navegação ecrãs tátil navigatie schermen aanraken navigation skærme berøring nawigacja ekrany dotyk',
  family: 'familia niños hijos kids children family família crianças gezin kinderen familie børn rodzina dzieci',
  data: 'datos data dados gegevens dane',
  mine: 'mis widgets my widgets os meus widgets mijn widgets mine widgets moje widżety',
  adv: 'avanzado advanced avançado geavanceerd avanceret zaawansowane',
};

/** Palette group of a kind. */
export const groupOf = (k: CanvasKind): PaletteGroup => KIND_META[k]?.group ?? (CANVAS_KINDS[k]?.cat as PaletteGroup);

/** Kinds the palette lists (every kind but the reserved one and `widget`, which is listed per saved widget). */
export const PALETTE_KINDS: CanvasKind[] = (Object.keys(CANVAS_KINDS) as CanvasKind[]).filter((k) => !CANVAS_KINDS[k].reserved && k !== 'widget' && KIND_META[k]);

/** What the palette says of the kinds this edition does not have (a t() key). */
export const AWAY_NOTE = 'Solo en la versión instalada en casa';

/**
 * Whether a kind is not part of this edition at all (Marco Cloud: the Home Assistant cards and HTML propio): the
 * palette shows no tile for it, only its name muted with AWAY_NOTE, and a group with nothing else stays folded.
 */
export const outOfEdition = (k: CanvasKind, env: { cloud: boolean }): boolean => env.cloud && CANVAS_KINDS[k]?.edition === 'local';

/** Why a kind cannot be added here (null: it can). Spanish t() keys. */
export function lockOf(k: CanvasKind, env: { cloud: boolean; allowed: readonly string[]; stocks?: boolean; spotify?: boolean }): string | null {
  const d = CANVAS_KINDS[k];
  if (!d) return 'No disponible en este servidor';
  if (env.cloud && d.edition === 'local') return 'Solo en Marco instalado en casa';
  if (!env.allowed.includes(k)) return 'No disponible en este servidor';
  // Bolsa needs a Finnhub key: a server that has none to offer (Marco Cloud without one) says so (feature stockQuotes)
  if (k === 'stocks' && env.stocks === false) return 'Bolsa necesita una clave de Finnhub que este servidor no tiene todavía.';
  // Sonando ahora reads Spotify accounts linked on this server (feature spotify)
  if (k === 'nowplaying' && env.spotify === false) return 'No disponible en este servidor';
  if (KIND_META[k]?.soon) return 'Llega en una próxima versión';
  return null;
}

/** Display name of a kind (a t() key). */
export const kindName = (k: CanvasKind | string): string => KIND_META[k as CanvasKind]?.name ?? k;

/**
 * A "Grupo" on its own (#25): a Rotativa whose only card is a group, so it never turns. The palette adds it and the
 * inspector shows only the group's options; the server and the display take it as any Rotativa.
 */
export const isLoneGroup = (it: { kind: string; props: Record<string, unknown> }): boolean =>
  it.kind === 'rotator' && Array.isArray(it.props.cards) && it.props.cards.length === 1 && isRotatorGroup(it.props.cards[0]);
/** What a "Grupo" is, under its name in the palette and the inspector (#25). */
export const GROUP_HELP = 'De 2 a 4 tarjetas en el hueco de una, en filas o en columnas.';
/** Display name of an item's kind (a t() key): a lone group is "Grupo". */
export const itemKindName = (it: { kind: string; props: Record<string, unknown> }): string => (isLoneGroup(it) ? 'Grupo' : kindName(it.kind));
/** Icon of an item's kind: a lone group has the group's. */
export const itemIcon = (it: { kind: string; props: Record<string, unknown> }): IconName => (isLoneGroup(it) ? 'layout' : KIND_META[it.kind as CanvasKind]?.icon ?? 'widget');

/** Names of the sizes (t() keys). */
export const SIZE_LABEL: Record<string, string> = {
  xs: 'Mini', s: 'Pequeño', m: 'Mediano', w: 'Ancho', t: 'Alto', l: 'Grande', xl: 'Muy grande', band: 'Banda', full: 'Pantalla completa', row: 'Línea', sq: 'Cuadrado',
};
/** Names of the sidebar spans. */
export const SPAN_LABEL: Record<string, string> = { 2: 'Pequeño', 3: 'Mediano', 4: 'Grande', fill: 'Lo que quede' };

const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');

/**
 * Whether a palette entry matches a search: every word of `q` is in its name, help, extra words, tags, kind id or its
 * group's name and tags, in Spanish or translated (`tr`), ignoring case and accents.
 */
export function matchesSearch(q: string, entry: { kind: string; name: string; help: string; group: PaletteGroup }, tr: (s: string) => string = (x) => x): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const m = KIND_META[entry.kind as CanvasKind];
  const g = GROUPS.find((x) => x.id === entry.group);
  const parts = [entry.name, entry.help, m?.words ?? '', g?.name ?? ''];
  const hay = fold([...parts, ...parts.map(tr), m?.tags ?? '', GROUP_TAGS[entry.group] ?? '', entry.kind].join(' '));
  // a short word ("ha") must be a whole word, or it would match half the list
  const whole = ` ${hay.replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ')} `;
  return words.every((w) => (w.length <= 2 ? whole.includes(` ${w} `) : hay.includes(w)));
}
