// Static index of individual settings for the command palette (Ctrl/Cmd+K).
// label = Spanish source string (translated with t()), keywords = extra words (mostly es/en/pt), anchor = element id.
// feature = hidden when the server turns it off (navFilter.ts); the page's own feature applies too.
// unless = hidden when the server turns this feature on (the setting lives on another page there).
import type { FeatureName } from '../shared/types';

export interface SettingEntry {
  label: string;
  route: string;
  anchor?: string;
  keywords?: string;
  feature?: FeatureName | readonly FeatureName[];
  unless?: FeatureName;
}

export const SETTINGS_INDEX: SettingEntry[] = [
  // Pantalla
  { label: 'Widgets en esta pantalla', route: 'layout', anchor: 'layout-widgets', keywords: 'widget widgets imagen image imagem iframe web esquina corner canto lateral side tarjeta card cartão pantalla completa full screen ecrã inteiro', feature: 'widgets' },
  { label: 'Foto en toda la pantalla', route: 'layout', anchor: 'layout-photo', keywords: 'background photo fondo foto fundo full screen pantalla completa ecrã inteiro whole wallpaper glass cristal vidro transparencia transparency transparência calendar calendario calendário' },
  { label: 'Cristal (estilo moderno)', route: 'layout', anchor: 'layout-glass', keywords: 'glass cristal vidro liquid transparente transparency transparência opacidad opacity blur desenfoque desfoque tint tono tom edge borde contorno iphone ios apple modern moderno' },
  { label: 'Panel del tiempo (estilo clásico)', route: 'layout', anchor: 'layout-weather-panel', keywords: 'weather panel panel del tiempo painel do tempo desenfoque blur desfoque oscuridad darkness escuridão sombra shade classic clásico clássico' },
  { label: 'Estilo clásico / moderno', route: 'layout', anchor: 'layout-style', keywords: 'style estilo look aspecto moderno modern classic clásico clássico apple glass cristal vidro minimal' },
  { label: 'Plantilla de diseño', route: 'layout', anchor: 'layout-presets', keywords: 'layout preset agenda calendario grande reloj grande template' },
  { label: 'Plantillas: hoy, por persona, dos semanas, tablero, marco de fotos, mesilla', route: 'layout', anchor: 'layout-presets', keywords: 'today hoy hoje timeline per person por persona pessoa columns columnas board tablero quadro tasks tareas photo frame marco moldura bedside mesilla dormitorio bedroom quarto two weeks dos semanas duas semanas corner esquina' },
  { label: 'Diseños para niños (rutinas, familia, comidas)', route: 'layout', anchor: 'layout-kids', keywords: 'kids niños crianças routines rutinas rotinas family familia família meals comidas refeições ementa layout preset', feature: 'family' },
  { label: 'Panel lateral (izquierda/derecha, anchura)', route: 'layout', anchor: 'layout-side', keywords: 'side panel width columna lateral largura' },
  { label: 'Fotos de fondo', route: 'background', anchor: 'bg-photos', keywords: 'background wallpaper fondo stock galería intervalo brillo fotos orden aleatorio order random shuffle newest name immich álbumes albums vertical portrait difuminado blur' },
  { label: 'Fondos especiales', route: 'background', anchor: 'bg-rules', keywords: 'special backgrounds fondos especiales navidad christmas fechas dates evento event cumpleaños birthday reglas rules temporada season' },
  { label: 'Efecto ambiental (aurora, partículas)', route: 'background', anchor: 'bg-ambient', keywords: 'ambient aurora particles three webgl animación' },
  { label: 'Efecto del tiempo (lluvia, nieve, sol)', route: 'background', anchor: 'bg-weather', keywords: 'weather effect rain snow sun drops lluvia nieve sol gotas webgl' },
  { label: 'Nombre de la pantalla', route: 'screen', anchor: 'scr-general', keywords: 'name nombre nome' },
  { label: 'Idioma de la pantalla', route: 'screen', anchor: 'scr-general', keywords: 'language idioma lingua taal sprog język español english português nederlands dansk polski' },
  { label: 'Orientación (horizontal / vertical)', route: 'screen', anchor: 'scr-general', keywords: 'orientation portrait landscape vertical rotar' },
  { label: 'Tamaño de letra', route: 'screen', anchor: 'scr-general', keywords: 'font size escala texto grande' },
  { label: 'Tema claro / oscuro', route: 'layout', anchor: 'layout-look', keywords: 'theme dark light tema' },
  { label: 'Color de acento', route: 'layout', anchor: 'layout-look', keywords: 'accent color cor' },
  { label: 'Modo noche (horario y brillo)', route: 'screen', anchor: 'scr-night', keywords: 'night dim noche noturno brillo atenuar' },
  { label: 'CSS personalizado', route: 'screen', anchor: 'scr-css', keywords: 'custom css estilos avanzado', feature: 'customCss' },
  { label: 'Enlace privado', route: 'screen', anchor: 'scr-link', keywords: 'private link url qr kiosk raspberry enlace privado ligação privada key clave' },
  { label: 'Reloj (digital / analógico, segundos, 24 h)', route: 'datetime', anchor: 'dt-clock', keywords: 'clock seconds segundos 12h 24h ampm reloj' },
  { label: 'Zona horaria', route: 'datetime', anchor: 'dt-clock', keywords: 'timezone fuso horario lisboa madrid' },
  { label: 'Formato de fecha', route: 'datetime', anchor: 'dt-format', keywords: 'date format fecha data' },
  // Contenido
  { label: 'Añadir calendario iCal (URL .ics)', route: 'calendars', anchor: 'cal-sources', keywords: 'ics ical url airbnb booking icloud outlook fuente source' },
  { label: 'Cuentas de Google Calendar', route: 'calendars', anchor: 'cal-accounts', keywords: 'google account cuenta oauth vincular cuentas vinculadas', feature: 'googleCalendar' },
  { label: 'Cuentas de Microsoft', route: 'calendars', anchor: 'cal-accounts', keywords: 'microsoft outlook hotmail office 365 account cuenta oauth vincular', feature: 'microsoftCalendar' },
  { label: 'Calendarios visibles en esta pantalla', route: 'calendars', anchor: 'cal-screen-sources', keywords: 'sources filter screen mostrar ocultar fuentes por pantalla' },
  { label: 'Vista del calendario (mes, semana, agenda)', route: 'calendars', anchor: 'cal-view', keywords: 'view month week agenda semanas weeks start lunes marquee desplazar slide rotar rotate textos largos long titles compacto compact días llenos busy days' },
  { label: 'Eventos máximos por día', route: 'calendars', anchor: 'cal-view', keywords: 'max events per day más' },
  { label: 'Eventos locales', route: 'local', anchor: 'local-list', keywords: 'local events eventos familia recurrente repetir crear evento' },
  { label: 'Cumpleaños', route: 'birthdays', anchor: 'bday-list', keywords: 'birthday aniversário cumple edad age' },
  { label: 'Importar cumpleaños (CSV)', route: 'birthdays', anchor: 'bday-list', keywords: 'csv import pegar paste' },
  { label: 'Mostrar la edad en los cumpleaños', route: 'birthdays', anchor: 'bday-settings', keywords: 'age edad idade show' },
  { label: 'Ordenar los títulos de cumpleaños', route: 'birthdays', anchor: 'bday-settings', keywords: 'birthday title titulo título nombre name tidy google' },
  { label: 'Ocultar eventos por palabra clave', route: 'filters', anchor: 'flt-rules', keywords: 'hide filter ocultar no disponible blocked' },
  { label: 'Renombrar eventos', route: 'filters', anchor: 'flt-rules', keywords: 'rename replace cambiar título' },
  { label: 'Forzar emoji o color de una serie', route: 'filters', anchor: 'flt-rules', keywords: 'style emoji color override' },
  { label: 'Vista previa de los próximos 14 días', route: 'filters', anchor: 'flt-preview', keywords: 'preview próximos eventos' },
  { label: 'Iconos automáticos (emoji por palabra clave)', route: 'icons', anchor: 'ico-rules', keywords: 'icon rules emoji keyword' },
  { label: 'Cuentas atrás', route: 'countdowns', anchor: 'cd-list', keywords: 'countdown faltan días navidad viaje contagem' },
  { label: 'Cuentas atrás automáticas (cumpleaños, eventos marcados)', route: 'countdowns', anchor: 'cd-auto', keywords: 'auto include birthdays flagged' },
  { label: 'Ubicación del tiempo', route: 'weather', anchor: 'wx-main', keywords: 'weather location city ciudad lat lon open-meteo' },
  { label: 'Ubicación de esta pantalla', route: 'weather', anchor: 'wx-main', keywords: 'weather location place screen pantalla lugar ciudad otra city other' },
  { label: 'Fuente de los datos del tiempo', route: 'weather', anchor: 'wx-source', keywords: 'weather source provider data open-meteo met norway yr pirate weather model ecmwf icon gfs api key fuente modelo clave licencia' },
  { label: 'Previsión por horas y días', route: 'weather', anchor: 'wx-main', keywords: 'forecast hourly days previsión' },
  { label: 'Sensores de Home Assistant para el tiempo', route: 'weather', anchor: 'wx-ha', keywords: 'indoor temperatura humedad sensor', feature: 'homeassistant' },
  { label: 'Fuentes de noticias (RSS)', route: 'news', anchor: 'news-feeds', keywords: 'rss feed news noticias titulares' },
  { label: 'Lista de tareas', route: 'todo', keywords: 'todo tasks tareas pendientes' },
  { label: 'Mensaje personalizado', route: 'message', keywords: 'message mensaje bienvenida' },
  { label: 'Familia: miembros', route: 'family', anchor: 'fam-members', keywords: 'family familia família members miembros membros niños kids crianças avatar emoji color cor', feature: 'family' },
  { label: 'Rutinas de los niños', route: 'family', anchor: 'fam-routines', keywords: 'routines rutinas rotinas chores tareas tarefas estrellas stars estrelas puntos points pontos mañana tarde noche', feature: 'family' },
  { label: 'Premios y estrellas', route: 'family', anchor: 'fam-rewards', keywords: 'rewards premios prémios stars estrellas estrelas canjear redeem resgatar puntos points pontos historial history', feature: 'family' },
  { label: 'Enlace familiar', route: 'family', anchor: 'fam-access', keywords: 'family link enlace familiar ligação familiar qr móvil phone mobile telemóvel acceso access acesso', feature: 'family' },
  { label: 'Permitir marcar tocando esta pantalla', route: 'family', anchor: 'fam-screen', keywords: 'touch táctil tátil tocar touchscreen tablet marcar check tick', feature: 'family' },
  { label: 'Menú de la semana', route: 'meals', anchor: 'meals-week', keywords: 'meals menús menu ementa comidas refeições semana week desayuno comida merienda cena breakfast lunch snack dinner', feature: 'family' },
  { label: 'Plantilla de menús', route: 'meals', anchor: 'meals-template', keywords: 'template plantilla modelo semana tipo meals menú ementa', feature: 'family' },
  // Avisos
  { label: 'Enviar un aviso ahora', route: 'alerts', anchor: 'al-send', keywords: 'announce alert send aviso notificación anuncio', feature: 'announcements' },
  { label: 'Avisos activos', route: 'alerts', anchor: 'al-active', keywords: 'active alerts quitar', feature: 'announcements' },
  { label: 'Mensajes programados (basura, recordatorios)', route: 'alerts', anchor: 'al-sched', keywords: 'scheduled recurring basura lixo recordatorio', feature: 'schedules' },
  { label: 'Sonido y volumen de los avisos', route: 'alerts', anchor: 'al-screen', keywords: 'sound chime volumen volume' },
  // Integraciones
  { label: 'Galería de fotos', route: 'photos', keywords: 'photos upload subir galería' },
  { label: 'Conexión con Home Assistant', route: 'homeassistant', anchor: 'ha-conn', keywords: 'home assistant token url' },
  { label: 'Conexión con Immich', route: 'immich', anchor: 'immich-conn', keywords: 'immich fotos photos álbumes albums api key clave chave url', feature: 'immich' },
  { label: 'Timbre y cámara', route: 'homeassistant', anchor: 'ha-doorbell', keywords: 'doorbell timbre campainha camera cámara puerta door', feature: 'doorbell' },
  // servers without a live camera (Marco Cloud) have no Home Assistant page: the card is in API & webhooks
  { label: 'Timbre', route: 'api', anchor: 'api-doorbell', keywords: 'doorbell timbre campainha camera cámara puerta door foto snapshot', feature: 'doorbell', unless: 'doorbellLive' },
  { label: 'Tokens de API', route: 'api', anchor: 'api-tokens', keywords: 'token api bearer webhook', feature: 'apiTokens' },
  { label: 'Ejemplo de Home Assistant (rest_command)', route: 'api', anchor: 'api-examples', keywords: 'yaml rest_command automation curl', feature: 'webhooks' },
  // Sistema
  { label: 'Pantallas (crear, duplicar, predeterminada)', route: 'screens', anchor: 'scr-list', keywords: 'screens profiles salón cocina slug' },
  { label: 'Modo privado (invitados)', route: 'screen', anchor: 'scr-privacy', keywords: 'privacy private guests busy ocupado invitados convidados privado lock candado horario schedule', feature: 'privacy' },
  { label: 'Carruseles (varias pantallas en bucle)', route: 'carousels', keywords: 'carousel carrossel rotación rotation bucle loop playlist', feature: 'carousels' },
  { label: 'Pantallas conectadas', route: 'displays', keywords: 'displays connected kiosk raspberry ip resolución' },
  { label: 'Dispositivos vinculados', route: 'displays', anchor: 'disp-paired', keywords: 'paired devices pair code revoke revocar vincular emparelhar' },
  { label: 'Acceso a las pantallas', route: 'security', anchor: 'sec-display', keywords: 'display access private open privado abierto aberto key clave enlace', feature: 'openDisplayAccess' },
  { label: 'Exportar configuración', route: 'backups', anchor: 'bk-export', keywords: 'export backup descargar json', feature: 'importExport' },
  { label: 'Importar configuración', route: 'backups', anchor: 'bk-import', keywords: 'import restore subir json', feature: 'importExport' },
  { label: 'Copias automáticas', route: 'backups', anchor: 'bk-auto', keywords: 'backups automatic restore restaurar versiones', feature: 'backups' },
  { label: 'Descargar fotos (.zip)', route: 'backups', anchor: 'bk-photos', keywords: 'photos gallery zip download export fotos galería descargar transferir', feature: ['importExport', 'gallery'] },
  { label: 'Registro de actividad', route: 'activity', keywords: 'activity log logins registro' },
  { label: 'Cambiar contraseña', route: 'security', anchor: 'sec-password', keywords: 'password contraseña palavra-passe', feature: ['passwordLogin', 'accountSettings'] },
  { label: 'Verificación en dos pasos', route: 'security', anchor: 'sec-2fa', keywords: '2fa two-factor two-step totp authenticator autenticación código code mfa otp tofaktor', feature: ['twoFactor', 'accountSettings'] },
  { label: 'Emails de Google permitidos', route: 'security', anchor: 'sec-google', keywords: 'google login email permitir', feature: 'googleLogin' },
  { label: 'Cerrar sesión en todos los dispositivos', route: 'security', anchor: 'sec-sessions', keywords: 'logout sessions', feature: ['passwordLogin', 'googleLogin'] },
  { label: 'Nombre del hogar', route: 'security', anchor: 'acc-household', keywords: 'household hogar casa nombre name rename renombrar', feature: 'accountMenu' },
  { label: 'Sesiones abiertas', route: 'security', anchor: 'acc-sessions', keywords: 'sessions sesiones sessões logout dispositivos devices', feature: 'accountSettings' },
  { label: 'Idioma de la cuenta', route: 'security', anchor: 'acc-lang', keywords: 'language idioma língua taal sprog email correos', feature: 'accountSettings' },
  { label: 'Entrar con Google', route: 'security', anchor: 'acc-google', keywords: 'google sign in login desconectar disconnect', feature: 'accountSettings' },
  { label: 'Descargar mis datos', route: 'security', anchor: 'acc-data', keywords: 'export data datos dados gdpr rgpd download descargar', feature: 'accountSettings' },
  { label: 'Eliminar cuenta', route: 'security', anchor: 'acc-delete', keywords: 'delete account borrar eliminar cuenta conta remove', feature: 'accountSettings' },
  { label: 'Estado de las fuentes', route: 'status', keywords: 'status health salud errores' },
  { label: 'Actualizaciones', route: 'status', anchor: 'updates', keywords: 'update updates actualizar actualización atualizar atualização version versión versão upgrade nueva new nova automático automatic', feature: 'updates' },
];
