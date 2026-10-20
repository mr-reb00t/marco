// Admin navigation metadata and the feature filters for the sidebar, the command palette and the settings
// search. Plain TypeScript with type-only imports, so the server tests can load it. App.tsx attaches the
// section components by id.
import type { AppConfig, FeatureName } from '../shared/types';
import type { IconName } from './components/icons';
import { hasFeature, offersAny, type Caps } from './caps';

/** One feature, or several (shown when at least one is on). */
export type Gate = FeatureName | readonly FeatureName[];

export interface NavMeta {
  id: string;
  label: string;
  icon: IconName;
  group: string;
  /** hidden when the server turns this feature off */
  feature?: Gate;
  enabled?: (c: AppConfig) => boolean;
  /** page edits the selected screen (shows the switcher emphasised) */
  perScreen?: boolean;
  keywords?: string;
}

export const NAV_ITEMS: NavMeta[] = [
  { id: 'home', label: 'Inicio', icon: 'home2', group: '', keywords: 'dashboard resumen panel' },
  { id: 'layout', label: 'Diseño', icon: 'layout', group: 'Pantalla', perScreen: true },
  { id: 'background', label: 'Fondo', icon: 'image', group: 'Pantalla', enabled: (c) => c.background.enabled, perScreen: true },
  { id: 'screen', label: 'Ajustes', icon: 'settings', group: 'Pantalla', perScreen: true },
  { id: 'datetime', label: 'Fecha y hora', icon: 'clock', group: 'Pantalla', enabled: (c) => c.datetime.enabled, perScreen: true },
  { id: 'calendars', label: 'Calendarios', icon: 'calendar', group: 'Contenido', enabled: (c) => c.calendar.enabled },
  { id: 'local', label: 'Eventos locales', icon: 'edit', group: 'Contenido', enabled: (c) => c.localEvents.enabled },
  { id: 'birthdays', label: 'Cumpleaños', icon: 'cake', group: 'Contenido', enabled: (c) => c.birthdays.enabled },
  { id: 'filters', label: 'Filtros y cambios', icon: 'filter', group: 'Contenido' },
  { id: 'icons', label: 'Iconos', icon: 'tag', group: 'Contenido' },
  { id: 'countdowns', label: 'Cuentas atrás', icon: 'hourglass', group: 'Contenido', enabled: (c) => c.countdowns.enabled },
  { id: 'weather', label: 'Tiempo', icon: 'cloud', group: 'Contenido', enabled: (c) => c.weather.enabled },
  { id: 'news', label: 'Noticias', icon: 'news', group: 'Contenido', feature: 'news', enabled: (c) => c.news.enabled },
  { id: 'widgets', label: 'Widgets', icon: 'widget', group: 'Contenido', feature: 'widgets', keywords: 'imagen image imagem iframe web embed incrustar tarjeta card cartão precios prices preços url dashboard' },
  { id: 'todo', label: 'Tareas', icon: 'checklist', group: 'Contenido', enabled: (c) => c.todo.enabled },
  { id: 'family', label: 'Familia', icon: 'users', group: 'Contenido', feature: 'family', enabled: (c) => c.family?.enabled === true, keywords: 'niños kids rutinas routines tareas chores premios rewards puntos estrellas stars família crianças rotinas prémios estrelas' },
  { id: 'meals', label: 'Menús', icon: 'utensils', group: 'Contenido', feature: 'family', enabled: (c) => c.family?.enabled === true && c.family.meals.enabled, keywords: 'comidas meals menú semanal ementa refeições cena desayuno dinner breakfast lunch jantar almoço' },
  { id: 'message', label: 'Mensaje', icon: 'message', group: 'Contenido', enabled: (c) => c.message.enabled, perScreen: true },
  { id: 'alerts', label: 'Avisos', icon: 'megaphone', group: 'Avisos', feature: ['announcements', 'schedules'], keywords: 'announce anuncios mensajes programados' },
  { id: 'photos', label: 'Galería', icon: 'photos', group: 'Integraciones', feature: 'gallery' },
  { id: 'homeassistant', label: 'Home Assistant', icon: 'home', group: 'Integraciones', feature: 'homeassistant', enabled: (c) => c.homeassistant.enabled },
  { id: 'immich', label: 'Immich', icon: 'image', group: 'Integraciones', feature: 'immich', enabled: (c) => c.immich?.enabled === true, keywords: 'immich fotos photos álbumes albums biblioteca library' },
  { id: 'spotify', label: 'Spotify', icon: 'music', group: 'Integraciones', feature: 'spotify', keywords: 'spotify música music música muziek musik sonando ahora now playing a tocar canción song canção nummer sang podcast' },
  { id: 'api', label: 'API y webhooks', icon: 'code', group: 'Integraciones', feature: ['apiTokens', 'webhooks'], keywords: 'tokens webhook' },
  { id: 'screens', label: 'Pantallas', icon: 'monitor', group: 'Sistema', keywords: 'perfiles profiles' },
  { id: 'carousels', label: 'Carruseles', icon: 'repeat', group: 'Sistema', feature: 'carousels', keywords: 'rotación rotation bucle loop playlist escena scene carrusel carousel carrossel' },
  { id: 'displays', label: 'Pantallas conectadas', icon: 'wifi', group: 'Sistema', keywords: 'kiosk dispositivos' },
  { id: 'backups', label: 'Copias de seguridad', icon: 'archive', group: 'Sistema', feature: ['backups', 'importExport'], keywords: 'backup export import' },
  { id: 'activity', label: 'Actividad', icon: 'history', group: 'Sistema', feature: 'activity', keywords: 'log registro' },
  { id: 'security', label: 'Seguridad', icon: 'shield', group: 'Sistema' },
  { id: 'status', label: 'Estado', icon: 'activity', group: 'Sistema', feature: 'status' },
];

/** Command palette actions that depend on a feature (by PaletteItem id). */
export const ACTION_FEATURES: Record<string, Gate> = {
  'a-announce': 'announcements',
  'a-refresh': 'displayCommands',
  'a-night-on': 'displayCommands',
  'a-night-off': 'displayCommands',
  'a-night-auto': 'displayCommands',
  'a-identify': 'displayCommands',
  'a-export': 'importExport',
  'a-backup': 'backups',
  'a-token': 'apiTokens',
  'a-feedback': 'feedback',
};

/** Whether a gate is open for these capabilities (no gate = always). */
export const allowed = (caps: Caps, gate?: Gate): boolean => offersAny(caps, gate);

/** Nav entries (or anything with a `feature` gate) the server offers. */
export function filterNav<T extends { feature?: Gate }>(items: readonly T[], caps: Caps): T[] {
  return items.filter((n) => allowed(caps, n.feature));
}

/** Palette actions whose feature is on; actions not listed in ACTION_FEATURES always stay. */
export function filterActions<T extends { id: string }>(items: readonly T[], caps: Caps): T[] {
  return items.filter((i) => allowed(caps, ACTION_FEATURES[i.id]));
}

/** Settings search entries: the page must be visible, the entry's own feature (if any) on and its `unless` off. */
export function filterSettings<T extends { route: string; feature?: Gate; unless?: FeatureName }>(entries: readonly T[], caps: Caps, visibleRoutes: Iterable<string>): T[] {
  const routes = new Set(visibleRoutes);
  return entries.filter((e) => routes.has(e.route) && allowed(caps, e.feature) && !(e.unless && hasFeature(caps, e.unless)));
}

/** Route id for a hash: the requested page when visible, else home. */
export function routeFor(id: string, visible: readonly { id: string }[]): string {
  return visible.some((n) => n.id === id) ? id : 'home';
}

/** Multi-tenant servers (Marco Cloud) replace the Security page with the Account page: same id, so links to
 *  #/security keep working. Single-tenant servers keep Security as it is. */
export function accountNav<T extends NavMeta>(items: readonly T[], caps: Caps): T[] {
  if (caps.tenancy !== 'multi') return [...items];
  return items.map((n) => (n.id === 'security' ? { ...n, label: 'Cuenta', icon: 'user' as IconName, keywords: 'account cuenta conta hogar household casa sesiones sessions' } : n));
}
