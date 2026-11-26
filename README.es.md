<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-lockup-dark.svg">
  <img src="docs/logo-lockup-light.svg" width="280" alt="marco. Dos arcos, uno con el sol y otro con la luna, junto a la palabra marco">
</picture>

### El día de tu familia, enmarcado.

Un *marco* de fotos que también enmarca el día de tu familia.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](docs/INSTALL.md#docker)
[![Languages](https://img.shields.io/badge/i18n-English%20%C2%B7%20Espa%C3%B1ol%20%C2%B7%20Portugu%C3%AAs%20%C2%B7%20Nederlands%20%C2%B7%20Dansk%20%C2%B7%20Polski%20%C2%B7%20Deutsch-orange)](#idiomas)

[English](README.md) · **Español**

<a href="https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4"><img src="docs/media/hero.webp" width="100%" alt="Marco en la pantalla del salón: el calendario Moderno con reloj, tiempo y vista mensual; llega un aviso de Home Assistant que dice que la lavadora ha terminado, luego una pantalla de Home Assistant, una tarjeta arrastrada al editor de pantallas y tarjetas de datos en directo"></a>

[Web: marcohome.app](https://marcohome.app) · [Marco Cloud](https://app.marcohome.app/signup) · [Vídeo de demostración (MP4, en inglés)](https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4)

</div>

Marco es un calendario familiar de pared y panel de información para una tele, una tablet o la pantalla de una
Raspberry Pi. Muestra tus calendarios, la hora, el tiempo, fotos, rutinas y dispositivos de Home Assistant, y se
configura desde el móvil. Lo alojas tú en una Raspberry Pi, un servidor doméstico o un NAS: sin cuenta, sin
suscripción, y tus datos se quedan en casa.

![Marco en una pantalla de 1920x1080 con el estilo Moderno: reloj, destacados, cuentas atrás, tiempo y un calendario mensual con eventos, cumpleaños y estancias de alquiler vacacional](docs/screenshots/display-1920x1080.webp)

| | |
|---|---|
| ![Diseño Hoy: el día hora a hora con una línea para ahora, el siguiente evento en grande y el tiempo por horas](docs/screenshots/display-today.webp) | ![Una pantalla personalizada con Home Assistant por estancias: luces, termostato, persiana, cámara, puerta, música, un gráfico de energía y sensores](docs/screenshots/display-custom-home.webp) |
| ![Pantalla de familia: la rutina de cada niño con estrellas, premios, cuentas atrás, las comidas de la semana, tareas y cumpleaños](docs/screenshots/display-custom-family.webp) | ![Inicio del panel: acciones rápidas, enviar un aviso, pantallas, tiempo, próximos eventos y estado de los calendarios](docs/screenshots/admin-home.webp) |

## Funciones

**Calendarios**
- Google Calendar, Outlook / Microsoft 365, Apple iCloud y cualquier feed iCal/ICS (colegio, club, trabajo, festivos).
- Eventos locales, cumpleaños con la edad, cuentas atrás, estancias de alquiler vacacional, filtros y emoji
  automáticos para los eventos.
- Listas de Google Tasks y Microsoft To Do junto a tu propia lista de tareas.

**Pantallas**
- Vistas de mes, semana y agenda en doce diseños (calendario grande, Hoy, Por persona, Tablero, Planificador, Marco
  de fotos, Mesilla...) más tres para niños, en horizontal o vertical, con estilo Moderno o Clásico.
- Pantallas personalizadas: arrastra tarjetas de cualquier tamaño a una cuadrícula. Varias pantallas pueden turnarse
  en una misma tele en un carrusel.
- Un servidor, muchas pantallas: salón, cocina y pasillo, cada una con su diseño y sus calendarios.

**Familia**
- Rutinas que dan estrellas, premios y las comidas de la semana (tu propio plan o el de Mealie).
- Una página familiar y un panel personal en cada móvil, solo con lo que tú permitas.

**En casa**
- El tiempo de Open-Meteo, MET Norway o Pirate Weather, con efectos opcionales de lluvia, nieve y sol.
- Tarjetas de Home Assistant (luces, calefacción, persianas, cámaras, sensores), avisos y la cámara del timbre.
- Lo que suena en Spotify, noticias, el precio de la luz, tiempos de trayecto, criptomonedas, deportes y bolsa.
- Fotos de un banco de imágenes, de tu propia galería o de álbumes de Immich, recortadas alrededor de las caras.

**Privado y ligero**
- Las pantallas son privadas por defecto: un navegador solo muestra una pantalla después de abrir su enlace privado
  o de vincularse.
- Modo noche, modo privado para cuando hay visitas, copias de seguridad automáticas y una API para scripts.
- Funciona en una Raspberry Pi 4 o 5 (una Pi 3 va bien en un modo más ligero).

Todo, con capturas, en la guía (en inglés): [docs/GUIDE.md](docs/GUIDE.md).

**Marco Cloud (beta):** la misma aplicación y el mismo panel, alojados por nosotros en
[app.marcohome.app](https://app.marcohome.app/signup), gratis para familias, sobre Cloudflare y con los datos en la UE.
Sin servidor que mantener; Home Assistant y algunas otras funciones locales no están. Puedes pasar de Cloud a tu
propio servidor y al revés con un archivo de exportación.

## Empezar

**Instalador de una línea** (Debian, Ubuntu, Raspberry Pi OS; pregunta antes de cambiar nada):

```bash
curl -fsSL https://marcohome.app/install | bash
```

Instala el servidor como servicio y, si quieres, el kiosco para una pantalla en el mismo equipo. Al terminar muestra
un código QR que abre el asistente de configuración en tu móvil. Puedes
[leer el script antes](docs/INSTALL.md#read-it-before-you-run-it); `--dry-run` enseña lo que haría.

**Docker:**

```bash
git clone https://github.com/mr-reb00t/marco.git
cd marco
docker compose up -d
docker compose logs marco | grep setup   # la URL de configuración de un solo uso
```

**Kiosco con Raspberry Pi** (Raspberry Pi OS con escritorio):

```bash
# servidor y pantalla en la misma Pi
curl -fsSL https://marcohome.app/install | bash -s -- --mode all
# o bien: la Pi solo muestra un servidor que está en otra máquina (copia el enlace de Pantalla → Ajustes → Enlace privado)
curl -fsSL https://marcohome.app/install | bash -s -- --mode kiosk --url http://homeserver.lan:3000/d/<clave>
sudo reboot
```

Después abre `http://<ip-del-servidor>:3000/admin/`: el asistente te pide una contraseña, tu ciudad y tus calendarios,
y te da el enlace privado de la pantalla. ¿Solo quieres verlo? `npm ci && npm run demo` arranca una demo con una
familia inventada.

Instalación manual, todas las opciones del instalador, detalles del kiosco, acceso remoto y solución de problemas
(en inglés): [docs/INSTALL.md](docs/INSTALL.md).

## Actualizar

- **Instalador de una línea:** *Actualizar ahora* en el panel cuando avisa de una versión nueva, o `marco update` en
  el servidor. Cada versión se comprueba con su suma de verificación y se vuelve atrás si no arranca. Las
  actualizaciones automáticas se activan en *Estado → Actualizaciones*.
- **Docker:** `git pull && docker compose up -d --build`.
- **Copia de git:** `git pull && npm ci && npm run build` y reinicia.

Más en [docs/INSTALL.md](docs/INSTALL.md#updates).

## Documentación

La documentación detallada está en inglés.

| | |
|---|---|
| [Guía](docs/GUIDE.md) | Usar Marco: diseños, el planificador, familia, pantallas personalizadas, enlaces privados y vinculación, fotos, varias pantallas, avisos, copias de seguridad |
| [Integraciones](docs/INTEGRATIONS.md) | Google Calendar y Tasks, Outlook, iCloud, Home Assistant, cámara del timbre, webhooks, tiempo, Spotify, Mealie, Immich, precio de la luz |
| [Instalación](docs/INSTALL.md) | Instalador, comando `marco`, actualizaciones, Docker, instalación manual, asistente, kiosco con Raspberry Pi, acceso remoto, solución de problemas |
| [Configuración](docs/CONFIGURATION.md) | Variables de entorno, la carpeta de datos, parámetros de URL de la pantalla, seguridad |
| [API](docs/API.md) | Referencia de la API HTTP y los webhooks |
| [Arquitectura](docs/ARCHITECTURE.md) | Cómo funcionan por dentro el servidor y la pantalla |
| [Política de seguridad](SECURITY.md) · [Cambios](CHANGELOG.md) | Informar de una vulnerabilidad, notas de cada versión |

## Idiomas

Marco habla español, inglés, portugués, neerlandés, danés, polaco y alemán. Si eres hablante nativo, tus correcciones
son bienvenidas: mira [Adding a language](CONTRIBUTING.md#adding-a-language).

## Contribuir

Se agradecen informes de errores, ideas, traducciones y pull requests. Lee [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm ci
npm run dev          # servidor en :3000 (node --watch) + Vite en :5173 (redirige /api, /auth, /media)
                     # pantalla http://localhost:5173/  ·  panel http://localhost:5173/admin/
npm test             # tests del servidor (node --test)
npm run typecheck    # TypeScript (pantalla + panel)
npm run build        # compilación de producción en dist/
```

| Carpeta | Contenido |
|---|---|
| `server/` | API con Express 5, JavaScript ESM sin compilar (`routes/`, `lib/`, `test/`) |
| `web/display/` | La pantalla: TypeScript sin framework + three.js |
| `web/admin/` | El panel de administración: Preact + TypeScript |
| `web/shared/` | Tipos compartidos, i18n, reglas de iconos, recorte por punto focal, logo |
| `install.sh` | El instalador de una línea |
| `deploy/` | Comando `marco`, instalador para una copia de git, unidad systemd, scripts del kiosco y del horario de pantalla, ejemplo de Caddy |
| `scripts/` | `npm run demo`, empaquetado y notas de versión |
| `docs/` | Las guías de arriba, capturas, logo y medios del README |

## Licencia

[MIT](LICENSE) © 2026 Marco contributors. Los componentes de terceros mantienen sus propias licencias, en especial el
decodificador HEIC (LGPL-3.0, cargado como un fragmento separado sin modificar) y las fuentes Inter / Outfit (OFL-1.1);
ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

**Gracias a** [Open-Meteo](https://open-meteo.com/) y [MET Norway](https://api.met.no/) (datos del tiempo gratuitos
con licencia CC BY 4.0), [Pirate Weather](https://pirateweather.net/), [Lorem Picsum](https://picsum.photos/) y los
fotógrafos de Unsplash, [three.js](https://threejs.org/), [Preact](https://preactjs.com/), [Vite](https://vite.dev/),
[Express](https://expressjs.com/), [node-ical](https://github.com/jens-maus/node-ical),
[rrule](https://github.com/jkbrzt/rrule), [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser),
[heic-to](https://github.com/hoppergee/heic-to), [Inter](https://rsms.me/inter/) y
[Outfit](https://fonts.google.com/specimen/Outfit).
