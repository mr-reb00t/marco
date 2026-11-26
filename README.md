<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-lockup-dark.svg">
  <img src="docs/logo-lockup-light.svg" width="280" alt="marco. Two arches, one with the sun and one with the moon, next to the word marco">
</picture>

### Your family's day, framed.

*Marco* is Spanish for "frame": a photo frame that also frames your family's day.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](docs/INSTALL.md#docker)
[![Languages](https://img.shields.io/badge/i18n-English%20%C2%B7%20Espa%C3%B1ol%20%C2%B7%20Portugu%C3%AAs%20%C2%B7%20Nederlands%20%C2%B7%20Dansk%20%C2%B7%20Polski%20%C2%B7%20Deutsch-orange)](#languages)

**English** · [Español](README.es.md)

<a href="https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4"><img src="docs/media/hero.webp" width="100%" alt="Marco on a living room screen: the Modern calendar with clock, weather and month view; a Home Assistant alert says the washing machine is done, then a Home Assistant screen, a card dragged into the screen builder and live data cards"></a>

[Website: marcohome.app](https://marcohome.app) · [Marco Cloud](https://app.marcohome.app/signup) · [Demo video (MP4)](https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4)

</div>

Marco is a family wall calendar and dashboard for a TV, a tablet or a Raspberry Pi screen. It shows your calendars,
the time, the weather, photos, routines and Home Assistant devices, and you set it up from your phone. You host it
yourself on a Raspberry Pi, home server or NAS: no account, no subscription, and your data stays at home.

![Marco on a 1920x1080 display in the Modern style: clock, highlights, countdowns, weather and a month calendar with events, birthdays and vacation-rental stays](docs/screenshots/display-1920x1080.webp)

| | |
|---|---|
| ![Today layout: the day hour by hour with a line for now, the next event in large type and the hourly weather](docs/screenshots/display-today.webp) | ![A Custom screen with Home Assistant by room: lights, thermostat, blind, camera, door, music, an energy chart and sensors](docs/screenshots/display-custom-home.webp) |
| ![Family screen: each child's routine with stars, rewards, countdowns, the week's meals, chores and birthdays](docs/screenshots/display-custom-family.webp) | ![Admin home: quick actions, send an alert, screens, weather, upcoming events and calendar health](docs/screenshots/admin-home.webp) |

## Features

**Calendars**
- Google Calendar, Outlook / Microsoft 365, Apple iCloud and any iCal/ICS feed (school, sports club, work, holidays).
- Local events, birthdays with age, countdowns, vacation-rental stays, filters, and automatic emoji for events.
- Google Tasks and Microsoft To Do lists next to your own to-do list.

**Screens**
- Month, week and agenda views in twelve layouts (big calendar, Today, Per person, Board, Planner, Photo frame,
  Bedside...) plus three for kids, in landscape or portrait, in a Modern or Classic style.
- Custom screens: drag cards of any size onto a grid. Several screens can take turns on one TV in a carousel.
- One server, many screens: living room, kitchen and hallway, each with its own layout and calendars.

**Family**
- Routines that earn stars, rewards, and the meals of the week (your own plan or one from Mealie).
- A family page and a personal dashboard on each phone, with only what you allow.

**Around the house**
- Weather from Open-Meteo, MET Norway or Pirate Weather, with optional rain, snow and sun effects.
- Home Assistant cards (lights, heating, blinds, cameras, sensors), alerts and a doorbell camera.
- What plays on Spotify, news feeds, electricity prices, commute times, crypto, sports and stocks.
- Photos from a stock source, your own gallery or Immich albums, cropped around faces.

**Private and light**
- Screens are private by default: a browser shows a screen only after opening its private link or being paired.
- Night mode, privacy mode for guests, automatic backups, and an API for scripts.
- Runs on a Raspberry Pi 4 or 5 (a Pi 3 works in a lighter mode).

All of it, with screenshots: [docs/GUIDE.md](docs/GUIDE.md).

**Marco Cloud (beta):** the same app and admin panel hosted for you at [app.marcohome.app](https://app.marcohome.app/signup),
free for families, on Cloudflare with data kept in the EU. No server to run; Home Assistant and a few other local
features are not there. Moving between Cloud and self-hosted works both ways with an export file.

## Quick start

**One-line installer** (Debian, Ubuntu, Raspberry Pi OS; it asks before changing anything):

```bash
curl -fsSL https://marcohome.app/install | bash
```

It installs the server as a service and, if you want, the kiosk for a screen on the same device. At the end it
shows a QR code that opens the setup wizard on your phone. [Read the script first](docs/INSTALL.md#read-it-before-you-run-it)
if you like; `--dry-run` shows what it would do.

**Docker:**

```bash
git clone https://github.com/mr-reb00t/marco.git
cd marco
docker compose up -d
docker compose logs marco | grep setup   # the one-time setup URL
```

**Raspberry Pi kiosk** (Raspberry Pi OS with desktop):

```bash
# server and screen on the same Pi
curl -fsSL https://marcohome.app/install | bash -s -- --mode all
# or: the Pi only shows a server that runs elsewhere (copy the link from Screen → Settings → Private link)
curl -fsSL https://marcohome.app/install | bash -s -- --mode kiosk --url http://homeserver.lan:3000/d/<key>
sudo reboot
```

Then open `http://<server-ip>:3000/admin/`: the setup wizard asks for a password, your city and your calendars, and
gives you the screen's private link. Just want to look? `npm ci && npm run demo` starts a demo with a fictional family.

Manual install, all installer options, kiosk details, remote access and troubleshooting:
[docs/INSTALL.md](docs/INSTALL.md).

## Updating

- **One-line installer:** *Update now* in the admin when it shows a new version, or `marco update` on the server.
  Each release is checked against its checksum and rolled back if it does not start. Automatic updates can be turned
  on in *Status → Updates*.
- **Docker:** `git pull && docker compose up -d --build`.
- **Git checkout:** `git pull && npm ci && npm run build`, then restart.

More in [docs/INSTALL.md](docs/INSTALL.md#updates).

## Documentation

| | |
|---|---|
| [Guide](docs/GUIDE.md) | Using Marco: layouts, the planner, family, custom screens, private links and pairing, photos, several screens, alerts, backups |
| [Integrations](docs/INTEGRATIONS.md) | Google Calendar and Tasks, Outlook, iCloud, Home Assistant, doorbell camera, webhooks, weather, Spotify, Mealie, Immich, electricity prices |
| [Install](docs/INSTALL.md) | Installer, `marco` command, updates, Docker, manual install, setup wizard, Raspberry Pi kiosk, remote access, troubleshooting |
| [Configuration](docs/CONFIGURATION.md) | Environment variables, the data folder, display URL parameters, security |
| [API](docs/API.md) | HTTP API and webhooks reference |
| [Architecture](docs/ARCHITECTURE.md) | How the server and the display work inside |
| [Security policy](SECURITY.md) · [Changelog](CHANGELOG.md) | Reporting a vulnerability, release notes |

## Languages

Marco speaks English, Spanish, Portuguese, Dutch, Danish, Polish and German. Native speakers are welcome to review
the translations: see [Adding a language](CONTRIBUTING.md#adding-a-language).

## Contributing

Bug reports, ideas, translations and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm ci
npm run dev          # server on :3000 (node --watch) + Vite on :5173 (proxies /api, /auth, /media)
                     # display http://localhost:5173/  ·  admin http://localhost:5173/admin/
npm test             # server tests (node --test)
npm run typecheck    # TypeScript (display + admin)
npm run build        # production build into dist/
```

| Folder | Content |
|---|---|
| `server/` | Express 5 API, plain ESM JavaScript, no build step (`routes/`, `lib/`, `test/`) |
| `web/display/` | The display: vanilla TypeScript + three.js |
| `web/admin/` | The admin panel: Preact + TypeScript |
| `web/shared/` | Shared types, i18n, icon rules, focal-point crop, logo |
| `install.sh` | The one-line installer |
| `deploy/` | `marco` command, git-checkout installer wrapper, systemd unit, kiosk and screen-schedule scripts, Caddy example |
| `scripts/` | `npm run demo`, release packaging and release notes |
| `docs/` | The guides above, screenshots, logo and README media |

## License

[MIT](LICENSE) © 2026 Marco contributors. Third-party components keep their own licenses, notably the
HEIC decoder (LGPL-3.0, loaded as a separate unmodified chunk) and the Inter / Outfit fonts (OFL-1.1); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

**Thanks to** [Open-Meteo](https://open-meteo.com/) and [MET Norway](https://api.met.no/) (free weather data under
CC BY 4.0), [Pirate Weather](https://pirateweather.net/), [Lorem Picsum](https://picsum.photos/) and the Unsplash
photographers, [three.js](https://threejs.org/), [Preact](https://preactjs.com/), [Vite](https://vite.dev/),
[Express](https://expressjs.com/), [node-ical](https://github.com/jens-maus/node-ical),
[rrule](https://github.com/jkbrzt/rrule), [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser),
[heic-to](https://github.com/hoppergee/heic-to), [Inter](https://rsms.me/inter/) and
[Outfit](https://fonts.google.com/specimen/Outfit).
