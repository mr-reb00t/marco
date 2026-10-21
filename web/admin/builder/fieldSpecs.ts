// Inspector, Contenido tab: the options of each kind, described as data (fields.tsx draws them). Labels are Spanish
// t() keys. The values and their ranges are the ones server/core/canvasCore.js validates.
import type { CanvasKind } from '../../shared/types';

export type Opt = { v: string | number; l: string };
export type Spec =
  | { k: string; type: 'bool'; label: string; hint?: string }
  /** `show`: only while it applies (`widgets`: the saved widgets, for the card that shows one) */
  | { k: string; type: 'seg'; label: string; opts: Opt[]; hint?: string; show?: (p: Record<string, any>, widgets: { id: string; type: string }[]) => boolean }
  | { k: string; type: 'select'; label: string; opts: Opt[]; hint?: string }
  /** "Ir a pantalla": one of the household's screens, or Inicio */
  | { k: 'target'; type: 'screen'; label: string }
  /** an emoji, or one of the built-in icons of the navigation cards (canvasCore NAV_ICONS, 'i:<name>') */
  | { k: 'icon'; type: 'navIcon'; label: string }
  | { k: string; type: 'num'; label: string; min: number; max: number; step?: number; unit?: 'days' | 'sec' | 'n' | 'min' }
  /** any number, typed (the ends of a bar); `show`: only while it applies */
  | { k: string; type: 'number'; label: string; step?: number; hint?: string; show?: (p: Record<string, any>) => boolean }
  /** the rows under an Entidad card (null: chosen for the entity) */
  | { k: 'features'; type: 'features'; label: string; hint?: string }
  | { k: 'sourceIds'; type: 'sources'; label: string }
  | { k: 'memberIds'; type: 'members'; label: string }
  | { k: 'memberId'; type: 'member'; label: string }
  | { k: 'widgetId'; type: 'widget'; label: string }
  | { k: 'zones'; type: 'zones'; label: string }
  /** a weather card's own place (null: the screen's) */
  | { k: 'place'; type: 'place'; label: string }
  /** the places of "Tiempo en varias ciudades" (2 to 8) */
  | { k: 'places'; type: 'places'; label: string }
  /** `show`: only while it applies */
  | { k: string; type: 'text'; label: string; max: number; placeholder?: string; hint?: string; show?: (p: Record<string, any>) => boolean }
  /** one Home Assistant entity of the kind's domains (canvasCore CANVAS_KINDS[kind].ha), or of `domains` */
  | { k: 'entity' | 'showWhen'; type: 'entity'; label: string; domains?: string[]; optional?: boolean; hint?: string }
  /** a room's rows: an entity and an optional name each, up to six */
  | { k: 'rows'; type: 'rows'; label: string }
  /** a chart's series: an entity, a label and a colour each, up to four */
  | { k: 'series'; type: 'series'; label: string }
  /** a scene card's buttons: an entity, a label and an emoji each, up to six */
  | { k: 'buttons'; type: 'buttons'; label: string }
  /** the climate modes a card offers (null: all the entity has) */
  | { k: 'modes'; type: 'modes'; label: string; hint?: string }
  /** two breakpoints for the colour of a sensor (ok, warn, err) */
  | { k: 'thresholds'; type: 'thresholds'; label: string; hint?: string }
  /** the key of a pushed value (POST /api/hooks/values), with the keys the server has */
  | { k: 'key'; type: 'valueKey'; label: string }
  /** the custom HTML card's editor (HtmlEditor.tsx): HTML, CSS, bindings, examples, preview and errors */
  | { type: 'html' }
  /** the data cards: coins with their currency, teams and competitions, stock symbols, the Finnhub key */
  | { k: 'coins'; type: 'coins'; label: string }
  | { k: 'follow'; type: 'follow'; label: string; hint?: string }
  | { k: 'symbols'; type: 'symbols'; label: string }
  | { k: 'pairs'; type: 'pairs'; label: string }
  | { type: 'stocksKey' }
  | { type: 'note'; text: string; go?: { label: string; route: string } }
  /** a small heading over the fields that follow */
  | { type: 'group'; label: string }
  /** a Rotativa's cards: each with its own kind and options (RotatorFields.tsx) */
  | { type: 'rotatorCards' }
  /** a to-do card's lists, title, icon and which tasks (components/TodoViewFields.tsx, core todoCore.js) */
  | { type: 'todoView' }
  /** the Spotify account a Sonando ahora card shows (sections/Spotify.tsx SpotifyAccountSelect) */
  | { k: 'account'; type: 'spotifyAccount'; label: string };

/** A weather card's place: the screen's ("Igual que la pantalla") or one of its own (#11). */
const PLACE: Spec = { k: 'place', type: 'place', label: 'Lugar' };
const HIDE_PAST: Spec = { k: 'hidePast', type: 'bool', label: 'Ocultar lo que ya ha pasado' };
const SOURCES: Spec = { k: 'sourceIds', type: 'sources', label: 'Calendarios' };
const DATE_POS_FIELD: Spec = { k: 'datePos', type: 'seg', label: 'Posición de la fecha', opts: [{ v: 'above', l: 'Arriba' }, { v: 'below', l: 'Abajo' }] };
const HA_NAME: Spec = { k: 'name', type: 'text', label: 'Nombre', max: 40, hint: 'Vacío: el nombre que tiene en Home Assistant.' };
const SHOW_NAME: Spec = { k: 'showName', type: 'bool', label: 'Mostrar nombre' };
/** The card's own words for the state (#20), beside its colours: empty for the words Home Assistant uses. */
const isBinary = (p: Record<string, any>) => typeof p.entity === 'string' && p.entity.startsWith('binary_sensor.');
const TEXT_ON = (hint: string, show?: (p: Record<string, any>) => boolean): Spec => ({ k: 'textOn', type: 'text', label: 'Texto si está activo', max: 24, hint, ...(show ? { show } : {}) });
const TEXT_OFF = (hint: string, show?: (p: Record<string, any>) => boolean): Spec => ({ k: 'textOff', type: 'text', label: 'Texto si no', max: 24, hint, ...(show ? { show } : {}) });
const SHOW_STATE: Spec = { k: 'showState', type: 'bool', label: 'Mostrar estado', hint: 'La línea que dice cómo está (Encendido, Abierta, 21 °C).' };
/** "Estilo de la gráfica" (canvasCore CHART_STYLES): the chart under the numbers or filling the card behind them. */
const CHART_STYLE = (hint: string, show?: (p: Record<string, any>, widgets: { id: string; type: string }[]) => boolean): Spec => ({
  k: 'chartStyle', type: 'seg', label: 'Estilo de la gráfica', opts: [{ v: 'below', l: 'Debajo' }, { v: 'background', l: 'De fondo' }], hint, show,
});
/** The Divisas card's fields, and the Currency widget's (sections/Widgets.tsx). */
export const CURRENCY_FIELDS: Spec[] = [
  { k: 'pairs', type: 'pairs', label: 'Pares' },
  { k: 'layout', type: 'seg', label: 'Cómo', opts: [{ v: 'list', l: 'En lista' }, { v: 'big', l: 'Uno en grande' }], hint: 'En grande, si hay varios pares se van turnando cada 10 segundos.' },
  { k: 'range', type: 'seg', label: 'Periodo', opts: [{ v: '7d', l: '7 días' }, { v: '30d', l: '30 días' }, { v: '1y', l: '1 año' }] },
  { k: 'chart', type: 'seg', label: 'Curva', opts: [{ v: 'area', l: 'Área' }, { v: 'line', l: 'Línea' }, { v: 'none', l: 'Sin curva' }] },
  CHART_STYLE('Debajo: la curva bajo el cambio. De fondo: la curva llena la tarjeta de borde a borde, detrás del cambio; en una lista, cada par lleva la suya detrás.', (p) => p.chart !== 'none'),
  { type: 'note', text: 'Cambios de referencia del Banco Central Europeo, de Frankfurter. Se publican una vez al día laborable, hacia las 16:00; este servidor los pide unas pocas veces al día y los comparte con todas las pantallas.' },
];

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** What a navigation button shows. */
const NAV_SHOW_FIELD: Spec = { k: 'show', type: 'seg', label: 'Mostrar', opts: [{ v: 'both', l: 'Icono y texto' }, { v: 'icon', l: 'Solo icono' }, { v: 'text', l: 'Solo texto' }] };
/** "Volver solo tras X min sin tocar" (canvasCore NAV_RETURN_DEFAULT; 0 = it stays). */
const NAV_RETURN: Spec = {
  k: 'returnMin', type: 'select', label: 'Volver solo tras',
  opts: [{ v: 0, l: 'No volver solo' }, ...[1, 2, 5, 10, 15, 30, 60].map((n) => ({ v: n, l: n === 1 ? '1 min sin tocar' : `${n} min sin tocar` }))],
  hint: 'Pasado ese tiempo sin que nadie toque la pantalla, vuelve a su pantalla o a su carrusel de siempre.',
};

export const FIELDS: Partial<Record<CanvasKind, Spec[]>> = {
  nowplaying: [
    { k: 'account', type: 'spotifyAccount', label: 'Cuenta de Spotify' },
    { k: 'art', type: 'bool', label: 'Portada' },
    { k: 'progress', type: 'bool', label: 'Barra de progreso', hint: 'Una línea fina que avanza con la canción.' },
    { type: 'note', text: 'Si no suena nada (o está en pausa), la tarjeta no se ve en la pantalla.', go: { label: 'Cuentas de Spotify', route: 'spotify' } },
  ],
  'nav.button': [
    { k: 'target', type: 'screen', label: 'Pantalla' },
    NAV_SHOW_FIELD,
    { k: 'icon', type: 'navIcon', label: 'Icono' },
    { k: 'label', type: 'text', label: 'Texto', max: 40, hint: 'Vacío: el nombre de la pantalla.' },
    NAV_RETURN,
    { type: 'note', text: 'Si la pantalla de destino está en el carrusel de este dispositivo, salta a ella y el carrusel sigue desde ahí. Si no, la muestra y se queda en ella.' },
  ],
  'nav.pause': [
    NAV_SHOW_FIELD,
    { k: 'icon', type: 'navIcon', label: 'Icono' },
    { k: 'label', type: 'text', label: 'Texto', max: 40, hint: 'Vacío: Pausar o Seguir.' },
    NAV_RETURN,
    { type: 'note', text: 'Solo se ve en los dispositivos que muestran un carrusel.' },
  ],
  'nav.progress': [
    { k: 'style', type: 'seg', label: 'Estilo', opts: [{ v: 'dots', l: 'Puntos' }, { v: 'bar', l: 'Barra' }] },
    { k: 'name', type: 'bool', label: 'Nombre de la pantalla' },
    { k: 'time', type: 'bool', label: 'Tiempo que queda' },
    { type: 'note', text: 'Solo se ve en los dispositivos que muestran un carrusel. No hace falta tocar la pantalla.' },
  ],
  'clock.digital': [
    { k: 'seconds', type: 'bool', label: 'Segundos' },
    { k: 'showDate', type: 'bool', label: 'Mostrar la fecha' },
    { k: 'dateFormat', type: 'seg', label: 'Fecha', opts: [{ v: 'long', l: 'Larga' }, { v: 'short', l: 'Corta' }] },
    DATE_POS_FIELD,
    { k: 'weight', type: 'seg', label: 'Grosor', opts: [{ v: 'light', l: 'Delgada' }, { v: 'regular', l: 'Normal' }, { v: 'bold', l: 'Gruesa' }] },
  ],
  'clock.analog': [
    { k: 'face', type: 'select', label: 'Esfera', opts: [{ v: 'classic', l: 'Clásica' }, { v: 'minimal', l: 'Mínima' }, { v: 'dots', l: 'Puntos' }, { v: 'numbers', l: 'Números' }] },
    { k: 'seconds', type: 'bool', label: 'Aguja de los segundos', hint: 'En la Raspberry Pi (modo ligero) no se muestra.' },
    { k: 'showDate', type: 'bool', label: 'Mostrar la fecha' },
    DATE_POS_FIELD,
  ],
  'clock.flip': [{ k: 'showDate', type: 'bool', label: 'Mostrar la fecha' }, DATE_POS_FIELD],
  'clock.world': [
    { k: 'zones', type: 'zones', label: 'Ciudades' },
    { k: 'analog', type: 'bool', label: 'Relojes de agujas' },
  ],
  date: [
    { k: 'style', type: 'seg', label: 'Estilo', opts: [{ v: 'page', l: 'Hoja de calendario' }, { v: 'line', l: 'Una línea' }] },
    { k: 'weekday', type: 'seg', label: 'Día de la semana', hint: 'En la hoja de calendario.', opts: [{ v: 'above', l: 'Arriba' }, { v: 'below', l: 'Abajo' }] },
    { k: 'isoWeek', type: 'bool', label: 'Número de semana' },
    { k: 'sun', type: 'bool', label: 'Salida y puesta del sol' },
  ],
  'calendar.month': [
    SOURCES,
    { k: 'weeks', type: 'select', label: 'Semanas', opts: [{ v: 'auto', l: 'Automático' }, ...range(1, 6).map((n) => ({ v: n, l: String(n) }))] },
    { k: 'eventStyle', type: 'seg', label: 'Eventos', opts: [{ v: 'lines', l: 'Líneas' }, { v: 'cards', l: 'Tarjetas' }] },
    { k: 'maxEventsPerDay', type: 'num', label: 'Eventos por día como mucho', min: 1, max: 12, unit: 'n' },
    { k: 'showLegend', type: 'bool', label: 'Leyenda de calendarios' },
    HIDE_PAST,
  ],
  'calendar.week': [SOURCES, { k: 'start', type: 'seg', label: 'Empieza', opts: [{ v: 'today', l: 'Hoy' }, { v: 'monday', l: 'El lunes' }] }, HIDE_PAST],
  'calendar.agenda': [
    SOURCES,
    { k: 'days', type: 'num', label: 'Días', min: 1, max: 14, unit: 'days' },
    { k: 'maxPerDay', type: 'num', label: 'Eventos por día como mucho', min: 1, max: 10, unit: 'n' },
    { k: 'compact', type: 'bool', label: 'Compacta' },
    HIDE_PAST,
  ],
  'calendar.today': [SOURCES],
  'calendar.next': [
    SOURCES,
    { k: 'count', type: 'num', label: 'Cuántos eventos', min: 1, max: 6, unit: 'n' },
    { k: 'relative', type: 'bool', label: 'Cuánto falta', hint: 'Por ejemplo «en 25 min».' },
  ],
  'calendar.people': [
    { k: 'memberIds', type: 'members', label: 'Personas' },
    { k: 'days', type: 'num', label: 'Días', min: 1, max: 3, unit: 'days' },
    HIDE_PAST,
    { type: 'note', text: 'Cada persona sale con el calendario que tiene asignado en Familia.', go: { label: 'Ir a Familia', route: 'family' } },
  ],
  countdowns: [
    { k: 'max', type: 'num', label: 'Cuántas como mucho', min: 1, max: 6, unit: 'n' },
    { k: 'style', type: 'seg', label: 'Estilo', opts: [{ v: 'list', l: 'Lista' }, { v: 'cards', l: 'Tarjetas' }] },
    { type: 'note', text: 'Las cuentas atrás se crean en su propia sección.', go: { label: 'Ir a Cuentas atrás', route: 'countdowns' } },
  ],
  'weather.now': [
    PLACE,
    { k: 'feelsLike', type: 'bool', label: 'Sensación térmica' },
    { k: 'meta', type: 'bool', label: 'Viento y humedad' },
  ],
  'weather.hourly': [PLACE, { k: 'hours', type: 'seg', label: 'Horas', opts: [{ v: 6, l: '6' }, { v: 12, l: '12' }, { v: 24, l: '24' }] }],
  'weather.forecast': [
    PLACE,
    { k: 'days', type: 'num', label: 'Días', min: 3, max: 7, unit: 'days' },
    { k: 'layout', type: 'seg', label: 'Orden', opts: [{ v: 'row', l: 'En fila' }, { v: 'column', l: 'En columna' }] },
  ],
  'weather.cities': [
    { k: 'places', type: 'places', label: 'Lugares' },
    { k: 'layout', type: 'seg', label: 'Forma', opts: [{ v: 'list', l: 'Lista' }, { v: 'grid', l: 'Cuadrícula' }] },
    { k: 'highLow', type: 'bool', label: 'Máxima y mínima de hoy' },
  ],
  message: [
    { k: 'align', type: 'seg', label: 'Alineación', opts: [{ v: 'left', l: 'Izquierda' }, { v: 'center', l: 'Centro' }] },
    { type: 'note', text: 'El texto se escribe en la sección Mensaje.', go: { label: 'Ir a Mensaje', route: 'message' } },
  ],
  todo: [
    { type: 'todoView' },
    { k: 'maxRows', type: 'num', label: 'Filas como mucho', min: 1, max: 12, unit: 'n' },
    { k: 'showDone', type: 'bool', label: 'Mostrar las hechas' },
    { type: 'note', text: 'Las tareas se escriben en la sección Tareas.', go: { label: 'Ir a Tareas', route: 'todo' } },
  ],
  news: [{ k: 'rotateSec', type: 'num', label: 'Cambiar de titular cada', min: 5, max: 60, unit: 'sec' }],
  photo: [
    { k: 'intervalSec', type: 'num', label: 'Cambiar de foto cada', min: 10, max: 600, step: 10, unit: 'sec' },
    { k: 'fit', type: 'seg', label: 'Encaje', opts: [{ v: 'cover', l: 'Llenar la tarjeta' }, { v: 'contain', l: 'Foto entera' }] },
    { k: 'caption', type: 'bool', label: 'Pie de foto' },
  ],
  widget: [
    { k: 'widgetId', type: 'widget', label: 'Widget' },
    CHART_STYLE('De fondo: las barras de las horas llenan la tarjeta de borde a borde, detrás del precio de ahora.', (p, widgets) => widgets.find((w) => w.id === p.widgetId)?.type === 'prices'),
    CHART_STYLE('De fondo: la curva llena la tarjeta de borde a borde, detrás del cambio; en una lista, cada par lleva la suya detrás.', (p, widgets) => widgets.find((w) => w.id === p.widgetId)?.type === 'currency'),
  ],
  spacer: [{ type: 'note', text: 'Un hueco que no se ve. Sirve para dejar libre una parte de la pantalla.' }],
  rotator: [
    { type: 'rotatorCards' },
    { k: 'everySec', type: 'num', label: 'Cambiar cada', min: 5, max: 120, step: 5, unit: 'sec' },
    { k: 'dots', type: 'bool', label: 'Mostrar puntos', hint: 'Unos puntos pequeños abajo dicen qué tarjeta se ve.' },
  ],
  'family.members': [{ k: 'memberIds', type: 'members', label: 'Personas' }, { k: 'showPoints', type: 'bool', label: 'Estrellas' }],
  'family.routines': [{ k: 'memberId', type: 'member', label: 'De quién' }, { k: 'showDone', type: 'bool', label: 'Mostrar las hechas' }],
  'family.points': [{ k: 'memberIds', type: 'members', label: 'Personas' }],
  'family.rewards': [{ k: 'max', type: 'num', label: 'Cuántos como mucho', min: 1, max: 6, unit: 'n' }],
  'family.chores': [{ k: 'memberIds', type: 'members', label: 'Personas' }, { k: 'showDone', type: 'bool', label: 'Mostrar las hechas' }],
  'meals.week': [{ k: 'days', type: 'num', label: 'Días', min: 3, max: 7, unit: 'days' }],
  birthdays: [{ k: 'max', type: 'num', label: 'Cuántos como mucho', min: 1, max: 8, unit: 'n' }],
  announcement: [{ type: 'note', text: 'Los avisos se mandan desde Avisos.', go: { label: 'Ir a Avisos', route: 'alerts' } }],
  'ha.tile': [
    { k: 'entity', type: 'entity', label: 'Entidad' },
    HA_NAME,
    SHOW_NAME,
    SHOW_STATE,
    { k: 'features', type: 'features', label: 'Debajo', hint: 'Una fila en los tamaños pequeño y ancho, dos en el mediano. En el mini y en la línea no se ven. Toca el icono para encender o apagar.' },
    { k: 'gaugeMin', type: 'number', label: 'La barra empieza en', show: (p) => Array.isArray(p.features) && p.features.includes('gauge') },
    { k: 'gaugeMax', type: 'number', label: 'La barra termina en', show: (p) => Array.isArray(p.features) && p.features.includes('gauge') },
    { k: 'colorOn', type: 'seg', label: 'Color si está activo', opts: [{ v: 'auto', l: 'Automático' }, { v: 'green', l: 'Verde' }, { v: 'yellow', l: 'Amarillo' }, { v: 'red', l: 'Rojo' }], hint: 'Abierto, encendido o detectado. Automático: el color de Home Assistant.' },
    { k: 'colorOff', type: 'seg', label: 'Color si no', opts: [{ v: 'auto', l: 'Automático' }, { v: 'green', l: 'Verde' }, { v: 'yellow', l: 'Amarillo' }, { v: 'red', l: 'Rojo' }], hint: 'Cerrado, apagado o sin nada detectado.' },
    TEXT_ON('Por ejemplo Enchufado o Abierta. Vacío: lo que dice Home Assistant.'),
    TEXT_OFF('Por ejemplo Desenchufado o Cerrada. Vacío: lo que dice Home Assistant.'),
  ],
  'ha.gauge': [
    { k: 'entity', type: 'entity', label: 'Sensor' },
    HA_NAME,
    SHOW_NAME,
    { k: 'min', type: 'number', label: 'Mínimo' },
    { k: 'max', type: 'number', label: 'Máximo' },
    { k: 'decimals', type: 'num', label: 'Decimales', min: 0, max: 3, unit: 'n' },
    { k: 'thresholds', type: 'thresholds', label: 'Colores según el valor', hint: 'Verde por debajo del primero, amarillo entre los dos y rojo por encima del segundo.' },
    { k: 'invert', type: 'bool', label: 'Al revés', hint: 'Rojo por debajo y verde por encima, por ejemplo para la batería.' },
  ],
  'ha.statistic': [
    { k: 'entity', type: 'entity', label: 'Sensor', hint: 'Un sensor con estadísticas en Home Assistant, como los de energía o de temperatura.' },
    HA_NAME,
    SHOW_NAME,
    { k: 'stat', type: 'seg', label: 'Qué', opts: [{ v: 'change', l: 'Total' }, { v: 'mean', l: 'Media' }, { v: 'min', l: 'Mínimo' }, { v: 'max', l: 'Máximo' }] },
    { k: 'period', type: 'seg', label: 'Cuándo', opts: [{ v: 'today', l: 'Hoy' }, { v: 'week', l: 'Esta semana' }, { v: 'month', l: 'Este mes' }] },
    { k: 'decimals', type: 'num', label: 'Decimales', min: 0, max: 3, unit: 'n' },
  ],
  heading: [
    { k: 'title', type: 'text', label: 'Título', max: 40, placeholder: 'Salón' },
    { k: 'icon', type: 'text', label: 'Emoji', max: 8, placeholder: '🛋️' },
    { k: 'align', type: 'seg', label: 'Alineación', opts: [{ v: 'left', l: 'Izquierda' }, { v: 'center', l: 'Centro' }] },
    { k: 'line', type: 'bool', label: 'Línea debajo' },
  ],
  value: [
    { k: 'key', type: 'valueKey', label: 'Clave' },
    { k: 'label', type: 'text', label: 'Nombre', max: 40, hint: 'Vacío: el que llega con el valor, o la clave.' },
    { k: 'unit', type: 'text', label: 'Unidad', max: 12, placeholder: 'kWh', hint: 'Vacía: la que llega con el valor.' },
    { k: 'decimals', type: 'num', label: 'Decimales', min: 0, max: 3, unit: 'n' },
    { k: 'icon', type: 'text', label: 'Emoji', max: 8, placeholder: '☀️' },
    { k: 'staleAfterMin', type: 'num', label: 'En gris pasados', min: 0, max: 1440, step: 5, unit: 'min' },
    { type: 'note', text: 'Se envía con POST /api/hooks/values. En API y webhooks tienes el ejemplo para Home Assistant.', go: { label: 'Abrir API y webhooks', route: 'api' } },
  ],
  'ha.sensor': [
    { k: 'entity', type: 'entity', label: 'Sensor' },
    HA_NAME,
    SHOW_NAME,
    { k: 'decimals', type: 'num', label: 'Decimales', min: 0, max: 3, unit: 'n' },
    { k: 'sparkline', type: 'bool', label: 'Curva de hoy', hint: 'Cómo ha cambiado en las últimas 24 horas, con el mínimo y el máximo.' },
    CHART_STYLE('De fondo: la curva llena la parte de abajo de la tarjeta, detrás del valor. Debajo: en una franja propia bajo el valor.', (p) => !!p.sparkline),
    { k: 'thresholds', type: 'thresholds', label: 'Colores según el valor', hint: 'Verde por debajo del primero, amarillo entre los dos y rojo por encima del segundo.' },
    { k: 'invert', type: 'bool', label: 'Al revés', hint: 'Rojo por debajo y verde por encima, por ejemplo para la batería.' },
    { k: 'colorOn', type: 'seg', label: 'Color si está activo', opts: [{ v: 'auto', l: 'Automático' }, { v: 'green', l: 'Verde' }, { v: 'yellow', l: 'Amarillo' }, { v: 'red', l: 'Rojo' }], hint: 'Abierto o detectado. Automático: el color de Home Assistant.', show: isBinary },
    { k: 'colorOff', type: 'seg', label: 'Color si no', opts: [{ v: 'auto', l: 'Automático' }, { v: 'green', l: 'Verde' }, { v: 'yellow', l: 'Amarillo' }, { v: 'red', l: 'Rojo' }], hint: 'Cerrado o sin nada detectado.', show: isBinary },
    TEXT_ON('Por ejemplo Enchufado o Abierta. Vacío: lo que dice Home Assistant.', isBinary),
    TEXT_OFF('Por ejemplo Desenchufado o Cerrada. Vacío: lo que dice Home Assistant.', isBinary),
  ],
  'ha.room': [
    { k: 'title', type: 'text', label: 'Nombre de la habitación', max: 40, placeholder: 'Salón' },
    { k: 'rows', type: 'rows', label: 'Filas' },
  ],
  'ha.chart': [
    { k: 'series', type: 'series', label: 'Sensores' },
    { k: 'period', type: 'seg', label: 'Periodo', opts: [{ v: '1h', l: '1 h' }, { v: '6h', l: '6 h' }, { v: '24h', l: '24 h' }, { v: '7d', l: '7 días' }] },
    { k: 'type', type: 'seg', label: 'Tipo', opts: [{ v: 'line', l: 'Líneas' }, { v: 'area', l: 'Área' }, { v: 'bar', l: 'Barras' }] },
    CHART_STYLE('De fondo: la gráfica llena la tarjeta de borde a borde bajo la leyenda, sin ejes.'),
  ],
  'ha.media': [
    { k: 'entity', type: 'entity', label: 'Reproductor' },
    HA_NAME,
    SHOW_NAME,
    SHOW_STATE,
  ],
  'ha.light': [
    { k: 'entity', type: 'entity', label: 'Luz' },
    HA_NAME,
    SHOW_NAME,
    SHOW_STATE,
    { type: 'group', label: 'Qué mostrar' },
    {
      k: 'row', type: 'seg', label: 'Debajo', opts: [{ v: 'auto', l: 'Automático' }, { v: 'color', l: 'Color' }, { v: 'brightness', l: 'Brillo' }, { v: 'none', l: 'Nada' }],
      hint: 'Desde el tamaño pequeño. Automático: los colores si la luz los tiene. En los tamaños cuadrado, mediano y alto, también el brillo.',
    },
    { type: 'note', text: 'Toca el icono para encender o apagar.' },
  ],
  'ha.switch': [
    { k: 'entity', type: 'entity', label: 'Interruptor' },
    HA_NAME,
    SHOW_NAME,
    SHOW_STATE,
    { k: 'colorOn', type: 'seg', label: 'Color si está activo', opts: [{ v: 'auto', l: 'Automático' }, { v: 'green', l: 'Verde' }, { v: 'yellow', l: 'Amarillo' }, { v: 'red', l: 'Rojo' }], hint: 'Encendido. Automático: el color de Home Assistant.' },
    { k: 'colorOff', type: 'seg', label: 'Color si no', opts: [{ v: 'auto', l: 'Automático' }, { v: 'green', l: 'Verde' }, { v: 'yellow', l: 'Amarillo' }, { v: 'red', l: 'Rojo' }], hint: 'Apagado.' },
    TEXT_ON('Por ejemplo En marcha. Vacío: Encendido.'),
    TEXT_OFF('Por ejemplo Parado. Vacío: Apagado.'),
    { type: 'note', text: 'Toca el icono para encender o apagar.' },
  ],
  'ha.climate': [
    { k: 'entity', type: 'entity', label: 'Climatización' },
    HA_NAME,
    { type: 'group', label: 'Qué mostrar' },
    SHOW_NAME,
    SHOW_STATE,
    { k: 'modes', type: 'modes', label: 'Modos', hint: 'Los que se pueden elegir en la pantalla. Automático: apagado y los dos que más se usan de los que tiene.' },
    { k: 'fan', type: 'bool', label: 'Ventilador', hint: 'Los modos del ventilador, en el tamaño alto.' },
    { k: 'humidity', type: 'bool', label: 'Humedad', hint: 'En los tamaños mediano y alto.' },
  ],
  'ha.cover': [
    { k: 'entity', type: 'entity', label: 'Persiana o toldo' },
    HA_NAME,
    SHOW_NAME,
    SHOW_STATE,
    { type: 'note', text: 'Las puertas de garaje y las cancelas solo se muestran: no se pueden abrir desde una pantalla.' },
  ],
  'ha.scene': [{ k: 'buttons', type: 'buttons', label: 'Botones' }],
  'ha.camera': [
    { k: 'entity', type: 'entity', label: 'Cámara' },
    {
      k: 'mode', type: 'seg', label: 'Imagen', opts: [{ v: 'snapshot', l: 'Cada pocos segundos' }, { v: 'live', l: 'En directo' }],
      hint: 'En directo se ve fluido en las cámaras que envían MJPEG. La mayoría de las demás (Reolink, Tapo, UniFi y otras que llegan a Home Assistant por RTSP) se ven a unas dos imágenes por segundo. Solo una cámara en directo por pantalla, y nunca en el modo ligero ni en esta vista previa.',
    },
    { k: 'everySec', type: 'num', label: 'Nueva imagen cada', min: 2, max: 60, unit: 'sec' },
    { k: 'fit', type: 'seg', label: 'Encaje', opts: [{ v: 'cover', l: 'Llenar la tarjeta' }, { v: 'contain', l: 'Imagen entera' }] },
    { k: 'label', type: 'bool', label: 'Nombre de la cámara' },
    {
      k: 'showWhen', type: 'entity', label: 'Mostrar solo cuando', domains: ['binary_sensor'], optional: true,
      hint: 'Por ejemplo un sensor de movimiento o el timbre: la tarjeta se ve solo mientras está activo.',
    },
  ],
  html: [{ type: 'html' }],
  market: [
    { k: 'coins', type: 'coins', label: 'Monedas' },
    { k: 'layout', type: 'seg', label: 'Cómo', opts: [{ v: 'list', l: 'En lista' }, { v: 'big', l: 'Una en grande' }], hint: 'En grande, si hay varias monedas se van turnando cada 10 segundos.' },
    { k: 'range', type: 'seg', label: 'Periodo', opts: [{ v: '1d', l: '24 h' }, { v: '7d', l: '7 días' }, { v: '30d', l: '30 días' }] },
    { k: 'chart', type: 'seg', label: 'Curva', opts: [{ v: 'area', l: 'Área' }, { v: 'line', l: 'Línea' }, { v: 'none', l: 'Sin curva' }] },
    CHART_STYLE('Debajo: la curva bajo el precio. De fondo: la curva llena la tarjeta de borde a borde, detrás del precio; en una lista, cada moneda lleva la suya detrás.', (p) => p.chart !== 'none'),
    { type: 'note', text: 'Precios de CoinGecko. Este servidor los pide cada dos minutos y los comparte con todas las pantallas.' },
  ],
  sports: [
    { k: 'follow', type: 'follow', label: 'Equipos y competiciones' },
    { k: 'show', type: 'seg', label: 'Qué partidos', opts: [{ v: 'auto', l: 'Automático' }, { v: 'next', l: 'Próximos' }, { v: 'last', l: 'Últimos' }], hint: 'Automático: el partido en directo o, si no hay, el último resultado y el siguiente partido de cada equipo.' },
    { k: 'max', type: 'num', label: 'Partidos como mucho', min: 1, max: 8, unit: 'n' },
    { k: 'crests', type: 'bool', label: 'Escudos' },
    { type: 'note', text: 'Resultados de ESPN, cada minuto mientras se juega. Un equipo se sigue en una competición: para verlo también en la Champions, añádelo otra vez con esa competición.' },
  ],
  stocks: [
    { k: 'symbols', type: 'symbols', label: 'Acciones y fondos' },
    { k: 'layout', type: 'seg', label: 'Cómo', opts: [{ v: 'ticker', l: 'Línea que se mueve' }, { v: 'list', l: 'En lista' }] },
    { k: 'sparkline', type: 'bool', label: 'Curva', hint: 'Se dibuja con las cotizaciones que este servidor va leyendo, así que tarda unas horas en llenarse.' },
    CHART_STYLE('De fondo: la curva de cada valor detrás de su fila, de borde a borde.', (p) => p.layout === 'list' && !!p.sparkline),
    { type: 'stocksKey' },
  ],
  currency: CURRENCY_FIELDS,
};
