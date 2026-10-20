<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-lockup-dark.svg">
  <img src="docs/logo-lockup-light.svg" width="280" alt="marco. Two arches, one with the sun and one with the moon, next to the word marco">
</picture>

### Your family's day, framed.

*Marco* is Spanish for "frame": a photo frame that also frames your family's day.

**A family wall calendar and dashboard for a Raspberry Pi, or any browser, that you host yourself.**

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](#docker)
[![Languages](https://img.shields.io/badge/i18n-English%20%C2%B7%20Espa%C3%B1ol%20%C2%B7%20Portugu%C3%AAs%20%C2%B7%20Nederlands%20%C2%B7%20Dansk-orange)](#)

**English** · [Español](README.es.md)

<a href="https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4"><img src="docs/media/hero.webp" width="100%" alt="Marco on a living room screen: the Modern calendar with clock, weather and month view; a Home Assistant alert says the washing machine is done, then a Home Assistant screen, a card dragged into the screen builder and live data cards"></a>

[Website: marcohome.app](https://marcohome.app) · [Marco Cloud](https://app.marcohome.app/signup) · [Demo video (MP4)](https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4)

```bash
curl -fsSL https://marcohome.app/install | bash
```

</div>

### Two ways to run it

- **On your own hardware (self-hosted):** a Raspberry Pi, home server or NAS on your network, installed with the
  one-line command above, [Docker](#docker) or [by hand](#manual-install-nodejs). Free and open source, and your data
  stays at home. Everything in this README is about this option.
- **Marco Cloud, if you don't want to run a server:** the same app and the same admin panel, hosted by us at
  [app.marcohome.app](https://app.marcohome.app). It is free for families, runs on Cloudflare and keeps your data in
  the EU. [Create an account](https://app.marcohome.app/signup), add your calendars and open your screen's link on a
  TV, tablet or Raspberry Pi.

More about both on the website: [marcohome.app](https://marcohome.app).

## Why

Marco is inspired by [DAKboard](https://dakboard.com/): a wall display that shows your family calendar,
the time, the weather, photos and news at a glance. It is a **free, open-source, self-hosted alternative** that you run
on your own Raspberry Pi, home server or NAS **inside your local network**. When you host it yourself, there is no
account, no subscription and no cloud in the middle: your configuration, photos and calendar data stay at home. The only outbound traffic goes to the
calendars, weather and news feeds *you* connect.

> Marco is an independent project. It is not affiliated with, endorsed by or connected to DAKboard;
> DAKboard is a trademark of its owner.

**Contents:** [Features](#features) · [How it works](#how-it-works) · [Install](#install) ·
[Try it](#try-it-in-one-minute) · [Custom screens](#custom-screens) · [Home Assistant](#home-assistant) ·
[Raspberry Pi kiosk](#raspberry-pi-kiosk) ·
[Google Calendar](#connecting-google-calendar) · [Other integrations](#other-integrations) · [Photos](#photos) ·
[Screens, alerts & API](#multiple-screens-alerts-and-the-api) · [Configuration](#configuration-reference) ·
[Security](#security) · [Development](#development)

## Features

### The display

![Marco on a 1920x1080 display in the Modern style: clock, highlights, countdowns, weather and a month calendar with events, birthdays and vacation-rental stays](docs/screenshots/display-1920x1080.webp)

| | |
|---|---|
| ![Agenda layout with the next days listed in two columns](docs/screenshots/display-agenda.webp) | ![Big clock layout over a full-screen photo](docs/screenshots/display-bigtime.webp) |
| ![Week view](docs/screenshots/display-week.webp) | ![Light theme with the calendar on the left and the photo on the right](docs/screenshots/display-light.webp) |
| ![Announcement overlay sent from Home Assistant](docs/screenshots/display-announcement.webp) | ![Analog clock, rain effect over the photo and a scheduled message](docs/screenshots/display-rain.webp) |

**Layouts for every room.** *Today*, *Per person*, *Photo frame*, *Two weeks*, *Board* and *Bedside*:

| | |
|---|---|
| ![Today layout: the day hour by hour with a line for now, the next event in large type and the hourly weather](docs/screenshots/display-today.webp) | ![Per person layout: one column per calendar with today and tomorrow](docs/screenshots/display-people.webp) |
| ![Photo frame layout: the photo with a small clock card in a corner](docs/screenshots/display-photoframe.webp) | ![Two weeks layout: the month grid with two roomy rows](docs/screenshots/display-twoweeks.webp) |
| ![Board layout: agenda, message of the day, countdowns, to-dos and birthdays](docs/screenshots/display-board.webp) | ![Bedside layout: a large, dim clock with the next event and the temperature](docs/screenshots/display-bedside.webp) |

**Modern or Classic, per screen.** Modern is the default; Classic keeps the original look:

![The same screen in the Modern style (left) and the Classic style (right)](docs/screenshots/display-modern-vs-classic.webp)

**Or build your own.** *Custom* screens put any cards, at any size, wherever you want them: the calendar, the
family's routines, your Home Assistant lights, heating and blinds, crypto, sports and stocks. Several screens can take
turns on one TV in a carousel. See [Custom screens](#custom-screens).

**Glass options** (Modern style): automatic, clear or tinted glass, with a dark, light or photo-coloured tint,
transparency, blur and a light edge:

![The side panel with five glass settings: automatic (the default), clear, tinted, light tint and photo tint](docs/screenshots/display-glass.webp)

<img src="docs/screenshots/display-portrait-1080x1920.webp" width="280" align="right" alt="Portrait layout at 1080x1920">

- **Calendar:** month (a number of weeks, or *Auto*), agenda and week views; twelve layouts (*big calendar*,
  *two weeks*, *left/right*, *top/bottom*, *agenda*, *today*, *per person*, *board*, *big time*, *photo frame*,
  *bedside*, *planner*) plus three for kids (*routines*, *family*, *meals of the week*), landscape or portrait, each
  calendar with its own colour.
- **Busy days:** a day with more events than fit lists them as small one-line entries, and weeks with more events get
  more height; what still does not fit takes turns.
- **Planner for busy families:** events can show as *cards* (the time on top, the title below on up to two lines,
  stacked in each day) instead of one-line chips, and *Auto* weeks picks 2 to 6 rows so every day fits its events at a
  readable size. The *Planner* layout puts the clock, the date and the weather on top and the month below; see
  [A planner for a busy family](#a-planner-for-a-busy-family).
- **Layouts for every room:** *Today* shows the day hour by hour with a line for now, the next event in large type and
  the weather for the coming hours (the kitchen in the morning). *Per person* gives each calendar its own column with
  today and tomorrow (pick up to five in *Layout*). *Board* is a family organisation board: to-dos, countdowns, the
  message of the day, upcoming birthdays and a short agenda. *Photo frame* leaves the photo alone with a small clock
  card in the corner you choose. *Bedside* is a huge, very dim clock with the next event and the temperature that
  dims further at night. *Two weeks* is the month grid with two roomy rows.
- **Two styles per screen:** *Modern* (the default), a minimal Apple-like look with glass cards over the photo,
  a Lock Screen clock and an iOS-style month grid, or *Classic*. The style is independent of the layout. A third
  card, *Kids*, is the Modern style with the kids layouts: soft colours on a plain background.
- **Family routines, stars and meals:** up to six people with an emoji or a photo and a colour, morning, afternoon and evening
  routines that earn stars, rewards to spend them on, and the meals of the week. Kids tick their routines on the TV
  (touch screens) or on a phone, from a QR code on the screen; see [Family: routines, stars and meals](#family-routines-stars-and-meals).
- **A dashboard on each phone:** each person of the household can send a message to the screens, turn privacy mode
  on or off, switch night or day mode, and add to-dos and events from their own phone, with only what you allow and
  no admin password. They get in with a private link or a code shown on a screen; see
  [Family access](#family-access-a-dashboard-on-each-phone).
- **Glass options** for the Modern style, per screen: automatic (adapts to each photo), clear or tinted; transparency,
  blur, a dark, light or photo-coloured tint and a light edge, with a live preview in *Layout*.
- **Automatic emoji:** 🎂 birthdays, ✈️ flights, 🩺 doctor, 🎒 school, ⚽ sports, 🍽️ dinners, 💼 meetings, 🏖️
  holidays, 🚗 car, 🐾 vet and more, from editable keyword rules (35 categories with about 800 keywords in English,
  Spanish, Portuguese, Dutch and Danish out of the box).
- **Birthdays with age:** "🎂 Grandma Isabel (72)", from a birthdays calendar or entered in the admin. Titles
  from your calendars are tidied to just the name ("Astrid's Birthday" shows as "🎂 Astrid"); turn off *Tidy birthday
  titles* to keep them as they are.
- **Vacation-rental feeds** (Airbnb "Reserved", Booking, or property-management tools that publish titles like
  `🏠 Guest - 4p+1m` and `Adults/Children/Infants` description lines): check-in → check-out bars across the days,
  guests as 🧑🏻🧒🏻👶🏻🐶 icons, 🚪 check-outs, "Check-in today" highlights and blocked dates you can hide.
- **Highlights and countdowns:** "In 18 min · Client call", "Check-out · Tomorrow", "🎃 Halloween party · Tomorrow!",
  "✈️ Trip to Madeira · In 12 days".
- **Weather:** current conditions, hourly and daily forecast from a free source of your choice:
  [Open-Meteo](https://open-meteo.com/) (no API key, with a choice of forecast model: ECMWF, DWD ICON, NOAA GFS,
  Météo-France, UK Met Office and more), [MET Norway](https://api.met.no/) (no API key) or
  [Pirate Weather](https://pirateweather.net/) (your own free key). The screens credit the source in small type.
  Each screen can show the weather of its own place, and a Custom screen can show several places at once.
  Add your own [Home Assistant](https://www.home-assistant.io/) weather entity and indoor sensors; animated rain/snow, or an optional
  realistic effect with drops on the glass, layered snow and sun rays on clear days (the photo is never blurred).
- **News ticker** from any RSS/Atom feed, a to-do list and a message of the day. Each to-do card picks its lists, its
  title, an icon and which tasks (all, the important ones, or those due today), so one screen can show *Shopping* and
  *Chores* side by side; classic screens set the same on the To-do page.
- **Electricity price:** a widget with the day-ahead price of your bidding zone (most of Europe): a chart of today
  and tomorrow, the price now, the cheapest hours ahead or the next 24 hours, with your own grid fees and VAT (in
  Denmark, your grid company's tariff hour by hour; in any country, your own time bands). See
  [Electricity prices](#electricity-prices).
- **Photo background:** stock photos, your own gallery or albums from your [Immich](https://immich.app/) library,
  WebGL transitions, slow zoom, a soft "aurora" ambient effect, and **smart cropping** that keeps the subject (faces,
  pets) in the part of the screen not covered by the clock or the weather. Portrait photos can be shown whole over a
  blurred copy of themselves.
- **Easy to read:** panel blur and shade adapt to the photo; small screens get larger relative type; night mode dims
  the screen on a schedule.
- **Live updates:** changes saved in the admin appear within a second through Server-Sent Events; data refreshes
  in place without reloading the page, and the screen keeps showing the last data if the server goes away.
- **Announcements:** full-screen cards with a chime ("🧺 The washing machine is done"), and **scheduled
  messages** ("🗑️ Take out the bins", Tue and Fri 20:00 to 22:00).
- **Private mode** per screen for when you have guests: events show as "Busy" (or are hidden), by hand, on a
  schedule or from Home Assistant, and the server filters them before they reach the screen.
- **Built for the Pi:** 30 fps cap, pauses when hidden, `?lite=1` turns off WebGL entirely.

<br clear="right">

### The admin panel

| | |
|---|---|
| ![Admin home: quick actions, send an alert, screens, weather, upcoming events and calendar health](docs/screenshots/admin-home.webp) | ![Calendars with a linked Google account and the calendars picked from it](docs/screenshots/admin-calendars-google.webp) |
| ![Filters and overrides: hide, rename and restyle events by keyword](docs/screenshots/admin-filters.webp) | ![Birthdays: upcoming birthdays, calendar settings and the list of people](docs/screenshots/admin-birthdays.webp) |
| ![Photo gallery: upload area, rotation counter, filters and per-photo eye toggles](docs/screenshots/admin-photos.webp) | ![Focal point editor with previews for the photo panel and full screen](docs/screenshots/admin-photos-focus.webp) |
| ![Connected screens with browser, resolution, heartbeat and night mode controls](docs/screenshots/admin-displays.webp) | ![API tokens and a Home Assistant example for the webhook](docs/screenshots/admin-api.webp) |

- **Home dashboard:** connected screens, next events, calendar health, weather, active alerts, recent activity and
  quick actions (refresh, identify, night mode, send an alert).
- **Calendars:** iCal/ICS URLs (including `webcal://` and self-signed HTTPS), **Google Calendar** through OAuth,
  **Outlook / Microsoft 365**, **Apple iCloud** (a guide to get the calendar's public link), public holiday presets, per-calendar colour, emoji, type (general / vacation rental / birthdays / holidays) and refresh rate.
- **Local events** (one-off or repeating weekly / monthly / yearly, with exceptions) and **birthdays** (with CSV import).
- **Filters and overrides:** hide ("Not available"), rename, or force emoji/colour for a series, with a live preview of
  the next 14 days. **Icon rules** with a tester. **Countdowns**.
- **Photo gallery:** drag and drop, in-browser optimisation (EXIF rotation, resize, thumbnails), iPhone **HEIC**
  conversion, automatic focal point with a manual editor, duplicate-name handling.
- **Custom CSS** per screen, for the changes the settings do not cover.
- **Multiple screens** (living room, kitchen, hallway) each with its own layout, background, calendars and widgets,
  and a **Connected displays** page (resolution, browser, version, reload / identify / night mode per device).
- **Private display links and pairing:** every screen has an unguessable link (`/d/<key>`, QR code, one-click
  regenerate) and new devices can be paired with a 6-character code; paired devices can be renamed or revoked.
- **Alerts:** send now or schedule; **API tokens and webhooks** for Home Assistant and scripts.
- **Doorbell camera:** when someone rings, Home Assistant tells Marco and the screens show the camera full screen for
  a while, with a door chime (it also wakes screens in night mode).
- **Backups** (automatic, export/import with preview), **activity log**, **command palette** (Ctrl/Cmd + K),
  phone-friendly layout, English / Spanish / Portuguese / Dutch / Danish.

| | | |
|---|---|---|
| ![Command palette searching for night mode actions and settings](docs/screenshots/admin-home-palette.webp) | ![Local event editor: date, time, repeat, location and countdown](docs/screenshots/admin-local-edit.webp) | ![Upload conflict dialog: replace, keep both or skip](docs/screenshots/admin-photos-conflict.webp) |
| ![Screens: one profile per room with its own layout and private link](docs/screenshots/admin-screens.webp) | ![Alerts page: send an alert now](docs/screenshots/admin-alerts.webp) | ![Activity log with filters](docs/screenshots/admin-activity.webp) |
| ![Backups: export, import and automatic backups with restore](docs/screenshots/admin-backups.webp) | ![Countdowns: manual dates and automatic countdowns](docs/screenshots/admin-countdowns.webp) | ![Icon rules with a live tester for event titles](docs/screenshots/admin-icons.webp) |
| ![Layout page: Modern, Classic, Kids or Custom style, the appearance settings and the live preview of the screen](docs/screenshots/admin-layout.webp) | ![Local events list with upcoming appointments](docs/screenshots/admin-local.webp) | ![Sign-in page of the admin panel](docs/screenshots/admin-login.webp) |

| | |
|---|---|
| ![Layout page: the eleven layouts with thumbnails](docs/screenshots/admin-layouts.webp) | ![Glass settings with a preview over a dark and a bright photo](docs/screenshots/admin-layout-glass.webp) |

<p align="center">
  <img src="docs/screenshots/mobile-home.webp" width="230" alt="Admin on a phone: home">
  <img src="docs/screenshots/mobile-home-menu.webp" width="230" alt="Admin on a phone: menu">
  <img src="docs/screenshots/mobile-calendars.webp" width="230" alt="Admin on a phone: calendars">
</p>

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/how-it-works-dark.webp">
  <img src="docs/media/how-it-works-light.webp" width="100%" alt="How Marco works: Google Calendar, iCal feeds, Open-Meteo weather, RSS news and Home Assistant (webhook in) feed the Marco server at home (Raspberry Pi, NAS or mini PC), which keeps calendars, photos and alerts. It sends live updates to a living room TV and a Raspberry Pi kiosk through private links and to a kitchen tablet through a pairing code. You manage it from a phone or laptop.">
</picture>

- One small **Node.js server** (no database, no native modules) fetches and caches your calendars, weather and news,
  stores your settings and photos in a `data/` folder and serves two web apps.
- **Displays** are just browsers: a Raspberry Pi in kiosk mode, an old tablet, a smart-TV browser. Each one opens its
  screen's **private link** (`/d/<key>`) or is **paired** with a code. They receive changes right away through
  Server-Sent Events.
- The **admin panel** at `/admin/` works from any phone or computer on your network.
- Home Assistant can push alerts and night mode through webhooks, and Marco can read its weather and sensors.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/API.md](docs/API.md).

## Install

There are four ways to run Marco. Pick one:

| Way | Good for |
|---|---|
| [One-line installer](#one-line-installer) | A Raspberry Pi, home server or any Debian / Ubuntu machine. Prebuilt release, systemd service, kiosk and the `marco` command |
| [Docker](#docker) | A NAS or a machine that already runs containers |
| [Manual install](#manual-install-nodejs) | macOS, Windows, other Linux systems, or if you want to see every step |
| [Try it](#try-it-in-one-minute) | A throw-away demo with a fictional family, nothing to set up |

### One-line installer

```bash
curl -fsSL https://marcohome.app/install | bash
```

If `marcohome.app` does not answer yet, use the same script straight from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/mr-reb00t/marco/main/install.sh | bash
```

Run it as your normal user (it asks for `sudo` when it needs it). It works on Debian 12/13, Raspberry Pi OS
(Bookworm or Trixie) and Ubuntu 22.04 or newer, on x86_64, arm64 and armv7. It asks what this device should do:

```
What should this device do?
  1) Server only: other screens and browsers connect to it
  2) All in one: the server and the screen on this device
  3) Screen only (kiosk): show a Marco server that runs on another machine
```

Then it shows what it found (system, Raspberry Pi model, desktop, read-only overlay, existing install) and asks before
changing anything. It:

- installs Node.js 22 when Node is missing or older than 20 (the official build, checked against `SHASUMS256.txt`);
- downloads the latest release (`marco-<version>.tar.gz`) and checks its SHA-256 before unpacking it. Before the first
  release is published it clones the repository and builds it instead;
- creates `.env` (mode 600) with a random `SESSION_SECRET`, installs the `marco` systemd service and starts it;
- for the screen: installs Chromium, adds the kiosk to the desktop autostart, turns off screen blanking and hides the
  cursor;
- installs the [`marco` command](#the-marco-command);
- ends with the admin address and a QR code to scan with your phone, which opens the
  [setup wizard](#first-steps-the-setup-wizard).

Running it again updates the install and keeps the mode you chose. It never touches your data.

#### Read it before you run it

Piping a script from the Internet into `bash` means trusting it. To read it first, download it, check it and run the
file instead. Each GitHub release has `install.sh` and its checksum next to the release package:

```bash
curl -fsSLO https://github.com/mr-reb00t/marco/releases/latest/download/install.sh
curl -fsSLO https://github.com/mr-reb00t/marco/releases/latest/download/install.sh.sha256
sha256sum -c install.sh.sha256      # must print: install.sh: OK
less install.sh                     # read it
bash install.sh --dry-run           # shows every command and file it would write, changes nothing
bash install.sh
```

`--dry-run` works with the one-liner too: `curl -fsSL https://marcohome.app/install | bash -s -- --dry-run`.

#### Options

Pass options after `bash -s --`, for example
`curl -fsSL https://marcohome.app/install | bash -s -- --mode server --port 8080 --yes`.

| Option | Meaning |
|---|---|
| `--mode all\|server\|kiosk` | What to install (asked when omitted and a terminal is available) |
| `--url <link>` | The screen's private link for the kiosk (*Admin → Screen → Settings → Private link*) |
| `--port <n>` | Server port (default `3000`) |
| `--dir <path>` | Install folder (default `~/marco`, or `/opt/marco` when run as root) |
| `--user <name>` | User that runs the server and the desktop session (default: you, or `$SUDO_USER`) |
| `--version <x.y.z>` | Install this version instead of the latest release |
| `--yes`, `-y` | Do not ask, use the defaults |
| `--dry-run` | Print every action and change nothing |
| `--update` | Update an existing install (the same as running the installer again) |
| `--uninstall [--purge]` | Remove Marco; `--purge` also deletes the data folder (config, photos, backups) |
| `--skip-apt` | Do not install system packages |
| `-h`, `--help` | Show the help |

Run as root without `--user`, the server runs as `$SUDO_USER`; failing that, as the desktop auto-login user (modes
with a screen) or as a new `marco` system user (server only).

#### Where things go

```
~/marco/                  (or /opt/marco)
├── current -> releases/0.6.1   the running version, switched in one step on update
├── releases/                   the current version and the previous one (for rollback)
├── data/                       config, secrets, photos, backups (kept on update and uninstall)
└── .env                        port and other settings, see .env.example
/etc/marco.conf                 what was installed and where (read by the marco command)
/usr/local/bin/marco            the marco command
/etc/systemd/system/marco-update.path, marco-update.service   the admin's Update button (see Updates below)
~/.config/marco/kiosk.env       kiosk settings (screen and all-in-one modes)
```

### The `marco` command

| Command | What it does |
|---|---|
| `marco status` | Service state, version and address |
| `marco logs [-f]` | Server log (`-f` follows it); on a kiosk-only device, the kiosk log |
| `marco restart` | Restart the server |
| `marco update [--force]` | Install the latest release: checksum verified, switched in one step and rolled back if the new version does not start. It stops if GitHub cannot be reached and never installs an older version; `--force` reinstalls the same version or allows an older one |
| `marco url` | Admin address and the private link of every screen, with QR codes |
| `marco version` | Installed version and the latest release |
| `marco uninstall [--purge]` | Remove Marco; your data is kept unless you add `--purge`. It asks first (the default answer is no); without a terminal it needs `--yes` |

### Updates

Once a day the server asks GitHub which release is the latest. When there is a newer one, the admin shows a banner,
*Marco 0.5.1 is available*, with the release notes. How you update depends on how Marco was installed:

| Install | How to update |
|---|---|
| One-line installer | **Update now** in the admin (or `marco update` on the server). The new version is downloaded, its checksum checked, switched in one step and rolled back if it does not start. The admin follows the progress and reloads itself, and the screens reload on their own |
| Docker | `git pull && docker compose up -d --build` in the folder with `docker-compose.yml` (the admin shows it) |
| Git checkout | `marco update` when it was set up with `deploy/install.sh`, otherwise `git pull && npm ci && npm run build` and a restart |

**Automatic updates** are off by default. Turn them on in *Status → Updates* (installs made with the one-line
installer) and choose the hours, by default between 03:00 and 05:00 in the time zone of *Date & time*. A version that
fails to start is rolled back and not tried again; the next release is.

How the button works: the server runs as a normal user and cannot update itself. It writes
`data/update/request`; a systemd path unit installed by the installer (`marco-update.path`) sees it and starts
`marco-update.service`, which runs `marco update --requested` as root, the same as `sudo marco update`. Nothing in the
request is read except that it exists, so all the server can ask for is "the latest release". Progress and the
installer's output go to `data/update/` for the admin. Installs updated from 0.4 get the button after running
`marco update` once more on the server (it says the version is up to date and adds the units).

Privacy: the check is one `GET` to `api.github.com` a day, with no identifier or version in it (an unchanged answer is
not even downloaded again). Turn it off in *Status → Updates*, or for good with `MARCO_UPDATE_CHECK=0` in `.env`.

### Docker

```bash
git clone https://github.com/mr-reb00t/marco.git
cd marco
docker compose up -d        # builds the image and starts it on port 3000
docker compose logs marco | grep setup   # the one-time setup URL
```

Then open that setup URL (replace `localhost` with the server's address if you are on another device) and follow
the [setup wizard](#first-steps-the-setup-wizard). There is **no default password**: the wizard creates it. In Docker
the wizard **always** asks for this one-time code (the image sets `SETUP_REQUIRE_TOKEN=1`), because inside a container
every client can look like a LAN client. Data lives in the `marco-data` volume (`/data` in the container).
The image runs as a non-root user and has a health check on `/api/health`. Without Compose:
`docker build -t marco . && docker run -d -p 3000:3000 -v marco-data:/data marco`.
To update: `git pull && docker compose up -d --build`.

> **Exposed or remote installs** (a VPS, a port forward, a reverse proxy): put `SETUP_TOKEN=<long random value>` in
> the `.env` next to `docker-compose.yml` (e.g. `echo "SETUP_TOKEN=$(openssl rand -hex 16)" >> .env`) *before* the
> first start. The wizard then refuses to run without it, so nobody else can claim your fresh install; open
> `http://<server-address>:3000/admin/?setup=<token>`. Headless installs that cannot use a browser can set `ADMIN_PASSWORD`
> instead (the wizard is skipped and the panel offers to change it later).
>
> **Docker behind a reverse proxy** (Caddy, nginx, cloudflared, on the same host or not): the proxy reaches the
> container through the Docker bridge, so set `TRUST_PROXY=172.16.0.0/12` (or the proxy's address) in that `.env`.
> Otherwise the server cannot see the real client address: proxied visitors are treated as remote and the session
> cookie is not marked `Secure`. **Compose only passes the variables listed in `docker-compose.yml`** to the
> container (`SETUP_TOKEN`, `SETUP_REQUIRE_TOKEN`, `ADMIN_PASSWORD`, `PUBLIC_URL`, `ALLOWED_HOSTS`, `TRUST_PROXY`,
> `COOKIE_SECURE`, `SESSION_SECRET`, `LAN_ADDRESS`, the Google keys); add others there yourself.

### Manual install (Node.js)

Requirements: **Node.js 20 or newer** (22 LTS recommended) on Linux, macOS or Windows.

```bash
git clone https://github.com/mr-reb00t/marco.git
cd marco
npm ci
cp .env.example .env        # optional: PORT, PUBLIC_URL, Google keys, SETUP_TOKEN
npm run build
npm start                   # http://localhost:3000/  and  http://localhost:3000/admin/
```

To update: `git pull && npm ci && npm run build`, then restart `npm start`. On a Debian-based machine,
`./deploy/install.sh` turns such a checkout into a systemd service (and a kiosk) in place; it runs the same installer
with this folder as the source, and `marco update` then does a `git pull` and a rebuild. Its options: `--no-kiosk`
(server only), `--kiosk-only --url <link>`, `--url <link>`, `--user <name>`, `--skip-apt`, `--dry-run`.

### First steps: the setup wizard

A fresh install has no admin password and no settings to speak of. The first time you open
`http://<server-ip>:3000/admin/` a **setup wizard** walks you through everything in about two minutes, and the
display (`http://<server-ip>:3000/`) shows a welcome screen with the admin address and a QR code until you are done.

| | |
|---|---|
| ![Setup wizard, step 1: welcome and language](docs/screenshots/setup-1-welcome.webp) | ![Step 2: admin password with a strength meter](docs/screenshots/setup-2-password.webp) |
| ![Step 3: city search, time zone, units and time format](docs/screenshots/setup-3-location.webp) | ![Step 4: holidays by country and iCal sources with a Test button](docs/screenshots/setup-4-calendars.webp) |
| ![Step 5: screen name, layout, accent colour, photos and ambient effect](docs/screenshots/setup-5-look.webp) | ![Step 6: the screen's private link with copy button and QR code, summary and tips](docs/screenshots/setup-6-done.webp) |

1. **Welcome:** pick the language (English, Español, Português, Nederlands, Dansk).
2. **Admin password:** at least 10 characters, nothing obvious (`password123`, `1234567890`, `qwertyuiop`), typed
   twice; a strength meter helps. The display itself never needs a password.
3. **Location:** search your city (Open-Meteo, no API key); the time zone comes with it (or from your browser),
   then choose °C/°F and a 24 h or 12 h clock. No Internet from the browser? Type the coordinates, or skip the
   location and add it later (weather needs it; the time zone is saved either way).
4. **Calendars:** tick your country's public holidays (preselected from the city), paste iCal (`.ics`) addresses
   and press **Test** to check them. Google Calendar: paste the calendar's *secret address in iCal format*, or link
   the account after setup when the server has [a Google OAuth client](#connecting-google-calendar).
5. **Look:** screen name, layout, accent colour, light/dark theme, background photos (stock now, your gallery
   later) and the ambient effect.
6. **Done:** the screen's **private link** to open on the TV or Raspberry Pi (copy button and QR code; when you ran
   the wizard on the server itself as `localhost`, it uses the server's LAN address), a summary and tips (`?lite=1`
   for slow devices, the one-line kiosk command with the private link). You are logged in and land in the panel.
   A display that was showing the welcome screen switches to a [pairing code](#private-display-links--pairing).

<img src="docs/screenshots/setup-mobile.webp" alt="The setup wizard on a phone" width="260" align="right">

The wizard works on a phone too, and everything it sets can be changed later in the panel.

**Who can run it.** The setup endpoints only work while no password exists (afterwards they answer `409`), only
one browser can complete them, and:

- from your **local network** the wizard just works: the client address is loopback or private, the request was not
  relayed by a reverse proxy that is missing from `TRUST_PROXY`, and (in a container) it is not the container's
  gateway address;
- from **anywhere else** it needs the one-time setup URL that the server prints at startup:
  `[setup] Open http://localhost:3000/admin/?setup=<token> to finish setup` (`marco logs | grep setup`,
  `journalctl -u marco | grep setup`, `docker compose logs marco | grep setup`, or the terminal running `npm start`).
  The log lists `localhost` with the real port plus the LAN addresses it can see; from another device use the
  server's address instead of `localhost` (and, in Docker, the published port);
- with **`SETUP_TOKEN`** set, the token is required from everywhere. This is recommended for VPSs, reverse proxies and
  anything reachable from the Internet. `SETUP_REQUIRE_TOKEN=1` (default in the Docker image) does the same with the
  generated token from the log. An install that was configured before but lost `data/secrets.json` also asks for it.

The server only answers to host names it knows (protection against DNS rebinding, where a malicious website points
its own name at your server): IP addresses, `localhost`, single-label names (`raspberrypi`), `*.local`, `*.lan`,
`*.home.arpa`, `*.internal`, the `PUBLIC_URL` host and anything in `ALLOWED_HOSTS`. Others get `421`.

Upgrading an existing install never shows the wizard: if a password is already saved, nothing changes. With
`ADMIN_PASSWORD` set and no saved password, that password is used (headless installs) and the panel suggests
changing it.

![Welcome screen on a fresh install with the admin address and a QR code](docs/screenshots/display-welcome.webp)

<br clear="right">

## Try it in one minute

```bash
git clone https://github.com/mr-reb00t/marco.git
cd marco
npm ci
npm run demo
```

`npm run demo` builds the web UI if needed and starts a server with a **throw-away data directory** filled with a
fictional family: two screens ("Living room" and "Kitchen"), local events, birthdays, countdowns, filters, a
vacation-rental feed and a school calendar (served locally), sample photos from picsum.photos with focal points, an API
token and some activity history. Your real `data/` folder is never touched.

- Display: the demo prints each screen's **private link** (`http://localhost:3000/d/<key>`); <http://localhost:3000/pair>
  shows a pairing code to try *Connected screens → Pair a screen*
- Admin: <http://localhost:3000/admin/>, password **`demo-calendar`**
- Options: `--port 3080`, `--lang es` (or `pt`), `--no-photos`, `--data ./demo-data --keep`

![The kitchen screen of the demo: light theme, agenda, to-do list and live weather](docs/screenshots/display-kitchen-live.webp)

Just want to see the display? Any running instance shows a built-in sample dataset at `/?demo=1`
(add `&lang=es`, `&preset=agenda`, `&theme=light`, `&style=modern`, `&announce=success`, `&sched=1`, `&now=2026-10-09T10:42`,
`&wx=rain|snow|clear` with `&wxfx=rich` to see the weather effect, `&pair=1` for the pairing screen).

**Demo video.** A one-minute tour in the Modern style: the month view, an alert sent from a phone, the Today and
board layouts, the photo frame, Classic and glass styles, live weather effects, a portrait screen, the admin
(layouts, calendars, gallery) and the dim bedside clock at night.

[![Demo video: a Custom screen with Home Assistant cards (thermostat, lights, blind, camera and energy chart), the drag and drop editor, family, data and calendar screens](docs/media/poster.webp)](https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4)

## A planner for a busy family

When a family has several events a day, the month grid with one-line chips fills up and days end up with "+3". For
a screen in portrait (a TV on its side, a tablet), Marco has a planner setup:

1. In *Layout*, pick **Planner**. The clock, the date and the weather (with the next days) go on top and the month
   fills the rest of the screen. Picking it also turns on *Auto* weeks and *Cards*.
2. In *Calendars → Calendar view*, adjust if you like:
   - **Weeks to show: Auto** picks 2 to 6 weeks, as many as fit with *Max. visible events per day* at a readable size
     (with 6 you get about 3 weeks on a portrait 1080×1920 screen). It is worked out again when the screen turns.
   - **Event style: Cards** shows each event as a small card: the time on top (and the end time if you turned it on),
     the title below on up to two lines. Events of several days stay as bars across the week.
   - A day with more cards than fit takes turns (*Rotate busy days*) or shows "+N". Titles longer than two lines
     scroll up when *Slide long titles* is on.
3. On a landscape screen, *Time and weather* in the Planner card of *Layout* chooses where the clock and the weather
   go: in a side column (the default), or in a low strip at the top or the bottom. With the strip the month takes the
   whole width (at most 4 weeks) and the weather is one row: now, the next hours and the next days, hiding what does
   not fit. Portrait screens always have them on top.

Nothing changes for screens that do not use these options: the default is still one-line chips and a fixed number of
weeks. *Cards* and *Auto* also work with the other layouts, in the month and week views. With cards, *Compact busy
days* is not used (cards already stack up in each day).

## Family: routines, stars and meals

*Content → Family* (turn it on at the top of the page) has four tabs:

- **Members:** up to six people, each with a name, an emoji or a photo, a colour and, if you like, their own calendar
  (their avatar then shows on its events). Mark the kids: only kids earn stars. Tap the avatar to pick an emoji or
  *Upload photo*: drag the photo to frame the face, zoom with the slider (or the mouse wheel, or two fingers), and
  save. The crop happens in the browser and only a small square is sent; the server keeps it without its camera data
  (location, date, device).
- **Routines:** what each person does and when (morning, afternoon, evening or any time), on which days and for how
  many stars (0 to 20). *Add example routines* fills in a few to start with. Today's routines can be ticked here too.
- **Rewards:** what the stars buy ("Pick Friday's film 🎬, 10 stars"), whether stars are shown at all and whether
  rewards can be redeemed from a phone. Each kid's balance, +1 / -1 or a custom adjustment with a note, and the
  history with *Undo*. Rewards are never redeemed on the TV.
- **Access:** the family link (`/f/<key>`) with its QR code, to create, copy, replace or remove. For the screen chosen
  in the admin: allow ticking by touching it, show the QR code, who appears on it, and what privacy mode does
  (initials only, or hide the routines).

*Content → Meals* plans breakfast, lunch, snack and dinner (pick which ones) for each week, with a template for the
weeks you do not plan: *Copy last week*, *Save as template* and *Clear this week*.

In *Layout*, the **Kids** style card shows three layouts:

- **Routines:** a card per person with today's routines grouped by time of day (the current one open and
  highlighted), a progress bar and the stars. "All done!" when everything is ticked.
- **Family:** a greeting, today's and tomorrow's events, everyone's routines, today's meals, the to-do list and how
  far each kid is from the next reward.
- **Meals of the week:** seven days of meals with today highlighted, the time and what is next today.

The kids layouts need the Modern style (with Classic the screen shows the big calendar) and turn off the photo
background so the colours stay soft and readable. They work in landscape and portrait.

**On a phone:** the family link opens a small page (no login) with everyone's progress, each person's routines with
big tick buttons, their rewards (redeeming only when you allowed it) and today's meals. Add it to the home screen. The
link only gives access to the family page, never to calendars or settings; replacing it in *Access* stops the old one
at once. The QR code only shows on screens that open their private link, are paired, or are on the local network, so
it never reaches a screen opened through `PUBLIC_URL` in open mode.

**On a touch screen:** with *Allow ticking by touching this screen* on, kids tap a routine on the TV. It is off while
the screen is in privacy mode, and inside the admin's preview.

What was done (routines ticked, rewards redeemed, adjustments) is kept in `data/family.json` for 90 days; older entries
are folded into each kid's balance, so stars never change. *Export* includes it, and importing the *Family* section
brings it back.

Profile photos are stored in `data/avatars` and only reach the family page (with its link), the admin and the
screens that show that person. A screen in privacy mode keeps the emoji. Exports include the photos. A photo you
replace or remove, or the photo of someone you remove, is deleted a week later, so restoring a recent backup brings
it back.

### Family access: a dashboard on each phone

*Family → Access → Family access* gives a person their own dashboard on the phone (`/my`), without the admin
password. *Add person*, give a name (and pick the family member it is, for the avatar and colour) and tick what they
may do:

- send a message to the screens (all of them, or only the ones you choose); it shows as an announcement with their
  name for 1 minute, 10 minutes or an hour
- turn privacy mode on or off, on every screen at once
- switch night, day or auto mode on every screen
- add to-dos to the list typed in Marco
- add events to the local calendar (a day, all day or at a time)

Two ways in: the private link the admin shows once when the person is added (copy it or scan its QR code; *Create a
new link* replaces it), or *Show a code*: pick a screen and it draws a 6 character code for two minutes, with a QR
code. The person types the code at `/my` or scans the QR code. Either way the phone gets a token of its own, listed
under the person, so one phone can be removed alone. *Remove person* stops their link, phones and codes at once.

The phone only ever gets the person's name and the controls you allowed. Each action is checked again on the server,
so a permission you take away counts from the next tap. Nobody with this access gets into the admin or sees
calendars, photos or passwords. Messages, privacy changes, night mode, to-dos and events are in the activity log
with the person's name. Tokens and codes are stored as hashes in `secrets.json`; wrong links, tokens and codes are
rate limited per address and overall.

## Custom screens

*Layout → Custom* lets you build a screen yourself. Pick a template (or *Copy my current design* to start from the one
you have, or *Calendar only* for one big calendar), then drag cards from the palette onto a 24×16 grid (16×24 on a
portrait screen): clocks, the month, the week, the agenda, the weather, photos, countdowns, the family cards, your
Home Assistant devices, crypto, sports and stocks, a value you send from anywhere, or a bit of your own HTML.

Sizes are free: a card can be any width and height in whole cells, from a small tile to the whole screen, within
what each kind of card can show well. Pull the corner handle to resize it; a tag shows its size in cells as you
drag, and cards never overlap. Set its content, size and look (glass, a solid colour or no card) in the panel on the
right. *Preview* shows the real screen before you save, and *Cancel* leaves it as it was.

Cards can also be very small. Nearly every card has a compact look for a tiny box: a light, a switch or a sensor on
one line, the clock or the next event as a strip, the forecast as a row of icons, a sparkline for a chart. A screen
takes up to 48 cards, and *Density → Compact* puts them closer together, for the dense dashboards people bring over
from Home Assistant.

![A dense Custom screen in Compact density: the clock in a warm colour, the date, a rotating weather card, birthdays, countdowns, the weather in five places along the top, and Living room, Kitchen and Outside with lights, thermostat, music, blinds, sensors with their curves, a gauge, energy, a chart, a camera, scenes and the front door lock](docs/screenshots/display-custom-dense.webp)

![A Custom screen with Home Assistant by room: lights, thermostat, blind, camera, door, music, an energy chart and sensors](docs/screenshots/display-custom-home.webp)

| | |
|---|---|
| ![Family screen: each child's routine with stars, rewards, countdowns, the week's meals, chores and birthdays](docs/screenshots/display-custom-family.webp) | ![Data screen: the time, a headline, the weather, Bitcoin and Ethereum in large cards with their 30 day charts behind them, live Premier League and NBA scores, a stocks list and four coins](docs/screenshots/display-custom-data.webp) |
| ![Bento screen: cards of many sizes, an analogue clock, a photo, the heating, a to-do list and music](docs/screenshots/display-custom-bento.webp) | ![Cinematic screen: a large clock over the photo with the weather, what is next and the music playing](docs/screenshots/display-custom-cinematic.webp) |
| ![Light screen in the morning: the clock, the weather, the week, the to-do list, the heating, a blind and two lights](docs/screenshots/display-custom-light.webp) | ![Everyday wall screen: a sidebar with the clock and the week's weather, the month, today and tomorrow, what is next and a note](docs/screenshots/display-custom-everyday.webp) |

The editor:

| | |
|---|---|
| ![Templates: copy the current design, templates to start with (Calendar only among them) and one per usual design](docs/screenshots/admin-builder-templates.webp) | ![The palette: cards grouped by kind, here the family cards and the Data group with crypto, sports and stocks](docs/screenshots/admin-builder-palette.webp) |
| ![Dragging the Countdowns card from the palette: the free cells light up where it will land](docs/screenshots/admin-builder-drag.webp) | ![Resizing a card with its corner handle: its size now and the new one in cells](docs/screenshots/admin-builder-resize.webp) |
| ![Style tab: like the rest, glass, solid or no card, a card colour, corners and accent colour](docs/screenshots/admin-builder-inspector-style.webp) | ![Size tab: named sizes, width and height in cells and the text size](docs/screenshots/admin-builder-inspector-size.webp) |

A few things worth knowing:

- Each card can show only while something is true (a Home Assistant state or a value you send) or only at certain
  hours, and can be hidden without deleting it. The editor marks why a card is hidden right now.
- Each calendar card picks which of the screen's calendars it shows, so one screen can have the school calendar on
  the left and the family's on the right.
- **Rotating card:** one spot that shows 2 to 6 cards in turn, every few seconds, with a soft fade. Any card can go
  in it; the next days and the next hours sharing one box is where it starts.
- **Weather in several places:** each screen can show the weather of its own place (*Weather → Location of this
  screen*), each weather card can have a place of its own, and the *Weather in several cities* card shows 2 to 8
  places at once, as a list, a grid or a single row. Every place is fetched once and shared by all the screens.
- **Touch screens:** the *Navigation* cards are buttons to another screen of the house (*Go to screen*, or *Home*),
  *Pause carousel* and *Carousel progress*. With touch on, a swipe left or right moves the carousel to the next or
  the previous screen. After a few minutes without a touch the screen goes back to what it usually shows.
- The clocks and the date card take their own *Time colour* and *Date colour*, and charts (a sensor's curve, crypto,
  electricity prices) sit *Below* the numbers or in the *Background* behind them.
- Landscape and portrait: the portrait view is worked out from the landscape one until you change it yourself.
- *Export this screen* saves the layout as a file without anything personal (no calendars, people, entities or
  photos); after an import you pick those again.
- **Carousels** put several screens in a loop on the same TV, each for as long as you choose, with an animation
  between them (*System → Carousels*). A home screen, the family's morning and the data screen can take turns on one
  wall; every TV on the same carousel switches at the same moment.
- Custom is a Modern design. Modern, Classic, Kids and their layouts stay exactly as they were.

| | |
|---|---|
| ![Weather in several places: the screen's own weather, a card for the beach house, the next days at the lake cabin and the ski lodge, and the Weather in several cities card as a list and as a grid](docs/screenshots/display-custom-places.webp) | ![A touch screen with navigation cards: buttons to the Today, Photos, Agenda and Kitchen screens, Pause, Home and the carousel's progress bar next to the clock, the weather and the agenda](docs/screenshots/display-custom-nav.webp) |

<img src="docs/screenshots/display-custom-portrait.webp" width="280" align="right" alt="Custom screen in portrait: a kitchen tablet with the clock, the weather, today's meals, the shopping list, today, an oven timer and two lights">

### Data cards

The *Data* group of the palette has three cards. Your Marco server fetches the numbers, caches them and shares them
with every screen; a screen never talks to these services itself.

| Card | Source | Key |
|---|---|---|
| **Crypto:** 1 to 6 coins with price, change and a 24 h, 7 day or 30 day curve, as a list or one large card | [CoinGecko](https://www.coingecko.com/) public API | none |
| **Sports:** live scores, next games and results for up to four teams or competitions, with crests | ESPN's public site API (unofficial and undocumented, so it may change without notice) | none |
| **Stocks:** up to 12 symbols as a scrolling line or a list | [Finnhub](https://finnhub.io/) | your own, free: paste it in the Stocks card's settings in the editor |

Prices are asked for every couple of minutes at most (scores every minute while a game is on), and a failed call
keeps the last numbers and says how old they are.

![The Data group of the palette and the Crypto card's settings: a list or one large card, the period, the curve and the chart style, here behind the price](docs/screenshots/admin-builder-data.webp)

**Values from anywhere.** The *Value* card shows a number or a short text you push to Marco: the solar panels'
production, the washing machine's state, the bin day. Send it with an API token that has the `values` scope:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"values":[{"key":"solar.today","value":12.6,"unit":"kWh"},{"key":"washer","value":"Done"}]}' \
  http://homeserver.lan:3000/api/hooks/values
```

A screen only receives the keys its own cards show. Details, limits and a Home Assistant automation are in
[docs/API.md](docs/API.md#pushed-values-valor).

<br clear="right">

## Home Assistant

Marco connects to your Home Assistant on your own network. In *Admin → Home Assistant* enter its local address
(for example `http://homeassistant.local:8123`) and a long-lived access token (*your profile → Security → Long-lived
access tokens*), then *Test connection*.

| | |
|---|---|
| ![Home Assistant page: local URL, the saved token and the weather and indoor entities](docs/screenshots/admin-homeassistant.webp) | ![A Home Assistant light card picked in the editor, with its entity, what to show and touch options](docs/screenshots/admin-builder-homeassistant.webp) |

- **Only what is on your screens.** The server follows just the entities your Custom screens show, over one
  WebSocket connection, and never downloads the state of the whole house. The screens get a slim copy of those states
  under made-up names, never the entity ids.
- **The token never leaves the server.** It is kept in `data/secrets.json`, sent only to the address it was saved
  for, and never reaches a screen or the browser again.
- **Read-only by default.** Cards for lights, climate, blinds, switches, scenes, media players, sensors, charts,
  gauges and statistics show their state. To control them by touching the screen, turn on *Allow touch on the
  screen* in the editor's *Page* settings; each card can still be left out, and sensitive ones can ask for two taps.
  Locks, alarms, gas valves, garage doors and gates are only ever shown.
- **Cameras** show a fresh picture every few seconds, or a live view, through Home Assistant's own proxy, and by
  default only to screens on your home network.
- Home Assistant can also send **alerts**, a **doorbell** with the camera, and **values** to Marco; see
  [API tokens and webhooks](#api-tokens-and-webhooks).

Marco Cloud cannot reach a Home Assistant inside your home, so these cards are for self-hosted servers. The *Value*
card and webhooks work on both.

## Private display links & pairing

Since 0.3 every screen is **private** by default: a browser only shows the calendar once it has opened the screen's
**private link** or has been **paired** from the admin. Without one it shows a pairing code and nothing else. That
makes Marco safe on shared networks (flat-share Wi-Fi, office) and lets you reach it from the Internet behind HTTPS.

| | |
|---|---|
| ![Screen settings with the private link, QR code, regenerate button and Raspberry Pi command](docs/screenshots/admin-private-link.webp) | ![Pairing a screen: code, screen to show and device name](docs/screenshots/admin-pairing-dialog.webp) |
| ![A new screen without a key shows a pairing code and a QR code](docs/screenshots/display-pairing.webp) | ![Regenerated link or revoked device: the screen says the link is no longer valid and shows a new pairing code](docs/screenshots/display-invalid-link.webp) |

- **Private link:** *Screen → Settings → Private link* shows the selected screen's link, e.g.
  `http://homeserver.lan:3000/d/3f6c0a52-9d1e-4b7a-a2c4-0e5b8f1d2c37`, with **Copy**, a **QR code**, **Open**,
  **Regenerate link** and the ready-to-paste Raspberry Pi command. Bookmark it on a tablet, use it as the kiosk URL, or
  scan the QR with the device. The link is the key: whoever has it sees that screen (and only that one, since
  `?screen=` is ignored), so keep it to your own devices.
- **Pairing:** no long links to type on a TV. Open the plain address (`http://homeserver.lan:3000/` or `/pair`) on the
  new device and it shows a big **6-character code** and a QR code. On your phone open *Connected screens → Pair a
  screen* (or scan the QR: it opens the admin with the code filled in), type the code, pick the screen and a name.
  The admin then shows the address of the screen that is waiting with that code; confirm it is the one in front of
  you. The device starts within two seconds and keeps its own device token in the browser's storage. This suits tablets, TVs
  and browsers you keep using. The Raspberry Pi kiosk runs Chromium in incognito mode (nothing survives a restart),
  so give it the private link instead.
- **Paired devices:** *Connected screens* lists them with the screen they show and when they were last seen; **Edit**
  renames or moves one to another screen, **Revoke** cuts it off.
- **Regenerate / revoke:** *Regenerate link* replaces the key at once; screens using the old link (or a revoked
  device) switch to “This link is no longer valid”, wipe their cached data and offer a new pairing code.
- **Display access mode** (*Security → Display access*): **Private** (default for new installs) or **Open (local
  network)**, the 0.2 behaviour, where `/` and `/?screen=<slug>` work without a key. **Upgrading from 0.2 keeps Open**
  so no kiosk goes blank, and the admin recommends switching: open each display's private link (or pair it) first;
  when you save Private, keyless displays show a pairing code (switching back to Open brings them back by themselves
  within about 30 s). The admin preview and *View screen* keep working with your admin session either way. Restoring
  a backup or importing a file never changes this mode.

| | |
|---|---|
| ![Security: private display access, Google sign-in and password](docs/screenshots/admin-security.webp) | ![Connected screens: how each screen got in and the paired devices](docs/screenshots/admin-displays-paired.webp) |

The key is a random **UUIDv4** (122 random bits): easy to read and type on a Pi (lower-case hex, no ambiguous
letters) and impossible to guess. Brute-force math, what is logged (nothing secret) and the full threat model are in
[SECURITY.md](SECURITY.md#private-display-links-and-pairing-threat-model).

## Raspberry Pi kiosk

Made for Raspberry Pi OS **Bookworm** or **Trixie** (64-bit, with desktop) on a Pi 4 or 5; a Pi 3 works with `?lite=1`.
The kiosk is Chromium in full screen, started by the desktop session. The installer sets it up for labwc and Wayfire
(Raspberry Pi OS with desktop) and for X11 with LXDE.

![Big calendar layout on a 1280x720 Raspberry Pi screen](docs/screenshots/display-1280x720.webp)

<img src="docs/screenshots/mobile-private-link.webp" alt="Admin on a phone: the screen's private link and QR code" width="230" align="right">

### A. Server and screen on the same Pi (all in one)

```bash
curl -fsSL https://marcohome.app/install | bash -s -- --mode all
sudo reboot
```

After the reboot the screen shows the welcome screen with a QR code: scan it with your phone to run the
[setup wizard](#first-steps-the-setup-wizard). When you finish, the screen shows a **pairing code**: pair it from the
phone to start right away, or just reboot. On an all-in-one install the kiosk opens the **default screen's private
link by itself**. It reads the link from the local data folder each time Chromium starts, so a regenerated link is
picked up on the next restart. `--url "http://localhost:3000/?screen=kitchen"` picks another screen the same way.
Pairings alone do not survive a restart there, because the kiosk browser runs in incognito mode.

### B. Server elsewhere, the Pi only shows it (kiosk only)

Run the server on a home server, NAS or Docker host ([Install](#install)), then copy the command from
*Screen → Settings → Private link* (or `marco url` on the server) and run it on the Pi:

```bash
curl -fsSL https://marcohome.app/install | bash -s -- --mode kiosk --url http://homeserver.lan:3000/d/3f6c0a52-9d1e-4b7a-a2c4-0e5b8f1d2c37
sudo reboot
```

The link decides which screen this Pi shows. Pairing is not an option here: the kiosk browser runs in incognito mode
and would forget it at the next restart. This installs only Chromium and the kiosk autostart (no Node.js, no
server), puts the kiosk scripts in `~/.local/bin/`, saves the link in `~/.config/marco/kiosk.env` (mode 600), turns
off screen blanking and hides the cursor. The link is never printed in full: the installer and the kiosk log show
`/d/<private link>`. In **open** display-access mode `--url "http://homeserver.lan:3000/?screen=kitchen"` still works.

<br clear="right">

### Desktop and system notes

- **Desktop auto-login:** the kiosk needs a desktop session that starts on boot. When the Pi uses lightdm, the
  installer turns on desktop auto-login with `raspi-config`.
- **Console login plus `startx`:** if the Pi logs in on the console and starts X from `~/.xinitrc` (no display
  manager), the installer does not edit that file. It prints the one line to put at the end of it:
  `exec ~/.local/bin/marco-kiosk >/tmp/marco-kiosk.log 2>&1` (the exact path is in the installer output).
- **Read-only file system (overlay):** if you protect the SD card with Raspberry Pi OS's overlay file system, every
  change is lost on reboot. The installer detects it and stops with these steps (`--dry-run` shows them without
  stopping):

  ```bash
  sudo raspi-config nonint disable_overlayfs && sudo reboot
  curl -fsSL https://marcohome.app/install | bash -s -- --mode kiosk --url <private link>
  sudo raspi-config nonint enable_overlayfs && sudo reboot
  ```

  With the overlay on, keep the *server* (and its `data/` folder) on another machine (topology B).

### Kiosk tips

- Kiosk settings live in `~/.config/marco/kiosk.env` (`KIOSK_URL`, `KIOSK_CLIENT`, `KIOSK_EXTRA_ARGS`). After
  *Regenerate link*, run the installer again with `--url <new link>` (or put the new link in `KIOSK_URL`). The log is
  `/tmp/marco-kiosk.log` (`marco logs` on a kiosk-only Pi). The script waits for the server, restarts Chromium if it
  exits and adds `client=<hostname>` so the device keeps its name in *Connected displays*.
- **Too big or too small?** Chromium starts at scale 1, whatever the desktop zoom is. Add
  `KIOSK_EXTRA_ARGS="--force-device-scale-factor=0.8"` (or `1.25`) to `kiosk.env`. The display also has a font-scale
  setting per screen.
- **Translate bubble:** the page declares `translate="no"` and the kiosk starts Chromium with translation turned off,
  so Chromium should not offer to translate the calendar.
- **Turn the screen off at night:** run `marco-schedule off` and `marco-schedule on` from cron on a screen-only Pi
  (installed in `~/.local/bin`), or `~/marco/current/deploy/screen-schedule.sh off|on` on an all-in-one install
  (`/opt/marco/current/...` when installed as root). The script header has crontab examples. Or just use the dimming
  night mode from the admin.
- **Slow Pi:** set the ambient effect to *none* and transition to *fade*, or use `?lite=1` in `KIOSK_URL`.

Useful commands: `marco status`, `marco logs -f`, `marco restart`, `marco update`, `marco url`.

## Connecting Google Calendar

You have two options. **OAuth** (recommended) gives near-real-time updates and lets you pick calendars from a list;
the **secret iCal address** needs no setup at all but updates slowly. Both are read-only.

### 1. Create a Google Cloud project and OAuth client

1. Go to <https://console.cloud.google.com/>, sign in and **create a project** (e.g. `marco`).
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. Open **Google Auth Platform** (formerly "OAuth consent screen"):
   - **Branding**: app name (e.g. *Marco*), your support email, developer contact email. Save.
   - **Audience**: user type **External**. Under **Test users** add your own Google address (and the address of
     anyone else whose calendars you want to link).
   - **Data access** (optional): you can add the scopes `openid`, `email`, `profile` and
     `https://www.googleapis.com/auth/calendar.readonly`; Marco requests them anyway.
4. **Clients → Create client → Web application**:
   - **Authorized redirect URI**: `<PUBLIC_URL>/auth/google/callback`, exactly, e.g.
     `http://localhost:3000/auth/google/callback` or `https://calendar.example.com/auth/google/callback`
     (same scheme, host and port, no trailing slash).
   - Create, then copy the **Client ID** and **Client secret**.
5. Put them in `.env` and restart:

   ```ini
   PUBLIC_URL=http://localhost:3000
   GOOGLE_CLIENT_ID=<your-client-id>
   GOOGLE_CLIENT_SECRET=<your-client-secret>
   ```

   `marco restart` (or `docker compose up -d`, or restart `npm start`). With the one-line installer, `.env` is in the
   install folder (`~/marco/.env` or `/opt/marco/.env`).

> **Testing vs. production.** While the app's publishing status is **Testing**, only the test users can sign in and
> Google **expires refresh tokens after 7 days**: the Google calendars stop updating after a week until you press
> *Connect* again. For personal use that is fine if you don't mind reconnecting weekly. To avoid it, **publish** the
> app (*Audience → Publish app*). Google then requires a homepage and privacy-policy URL on an authorized domain, and
> since the app is not verified you will see an "unverified app" screen when you link your account (*Advanced → Go to
> … (unsafe)*). Marco only asks for read-only access.

### 2. The redirect URI problem (and three ways around it)

Google only accepts redirect URIs on **`https://` public domains** or **`http://localhost`**. A LAN address like
`http://192.168.1.50:3000/auth/google/callback` is rejected (`redirect_uri_mismatch` / "invalid redirect"). Pick one:

**Option A: `localhost` just for linking (simplest).** Set `PUBLIC_URL=http://localhost:3000` and register
`http://localhost:3000/auth/google/callback`. Then open the admin *as localhost* only when you link an account,
either on the server itself or from your laptop through an SSH tunnel:

```bash
ssh -L 3000:localhost:3000 user@<server-ip>
# then browse to http://localhost:3000/admin/ on your laptop and press "Link account"
```

The refresh token is stored on the server and renewed automatically, so the rest of the time you use the admin
normally at `http://<server-ip>:3000/admin/` (only linking a Google account needs the localhost URL).

**Option B: your own domain with HTTPS.** Put a reverse proxy with a valid certificate in front, set
`PUBLIC_URL=https://calendar.example.com` and register `https://calendar.example.com/auth/google/callback`.

- **Caddy** (automatic Let's Encrypt): see [`deploy/Caddyfile.example`](deploy/Caddyfile.example). It explains what to
  expose in each display-access mode: in private mode the displays can go through the proxy with their keys; in open
  mode only the admin, login and first-run setup routes (plus `/assets` and `/media`) should be reachable from the
  Internet. Gallery photos under `/media/` are only sent to LAN clients, valid display keys or a signed-in admin.

  ```bash
  sudo apt install caddy
  sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile   # edit the domain
  sudo systemctl reload caddy
  ```

- **Cloudflare Tunnel** (no open ports): `cloudflared tunnel create calendar`, route
  `calendar.example.com` to `http://localhost:3000` in the tunnel config, and protect it with Cloudflare Access if you
  like. Server-Sent Events work through the tunnel. `cloudflared` sends `X-Forwarded-For`, so visitors keep their own
  address; a tunnel that does not (`ssh -R`, a TCP tunnel) makes everyone look like this machine, which open mode
  trusts. Use private display access with such a tunnel.
- The proxy must send **`X-Forwarded-For`** (Caddy, cloudflared and the nginx example do). Without it, every visitor is treated as remote, even on the LAN.
- Set **`TRUST_PROXY`** whenever the proxy does not connect from `127.0.0.1`: a proxy on **another machine**
  (`TRUST_PROXY=<proxy-ip>`) or **any proxy in front of the Docker container** (`TRUST_PROXY=172.16.0.0/12`, the
  Docker bridge). Without it the server sees the proxy's address instead of the visitor's: everyone coming through it
  is treated as remote (the setup token is required, LAN-only things are refused) and the session cookie is not
  marked `Secure`. The log warns about an untrusted proxy when this happens.

**Option C: no OAuth, the secret iCal address.** In Google Calendar on the web → ⚙️ *Settings* → pick the calendar →
*Integrate calendar* → **Secret address in iCal format**. Add that URL as an **iCal** source. No Google Cloud project
needed; however Google refreshes this feed with a delay (minutes to hours) and anyone with the URL can read the
calendar, so treat it like a password.

### 3. Pick your calendars

**Admin → Calendars → Google accounts → Link account**, accept the permissions, then tick the calendars to show.
Each one becomes a source you can rename and give an emoji, colour and **type**: e.g. a calendar that only contains
birthdays → type *Birthdays* (🎂 and ages), a holiday calendar → *Holidays*. You can link several Google accounts.

**Signing in to the admin** uses the server's password. Google is for calendars only: "Sign in with Google" is off
on a home server. If you really want it (for example to turn the password off), set `MARCO_GOOGLE_LOGIN=1` in `.env`,
then add the allowed addresses in **Security → Allowed Google emails**. Servers that already sign in with Google only
(password off, allowed emails set) keep it.

## Connecting Outlook, Hotmail or Microsoft 365

Optional. With your own Microsoft Entra app, *Calendars → Linked accounts → Link account* also offers
**Microsoft**: personal accounts (Outlook.com, Hotmail, Live) and work or school accounts (Microsoft 365). Without it
the option is not shown, and the calendar's ICS address (*Outlook → Settings → Calendar → Shared calendars → Publish a
calendar*) still works. Calendars are read only. The same account also brings its **Microsoft To Do** lists to
*To-do → Microsoft To Do lists*: their open tasks show on the screen with their due date and a star when important,
and on a screen with *Allow ticking by touching this screen* on, a tap marks a task done in To Do too.

1. Go to <https://entra.microsoft.com/> → **App registrations → New registration**:
   - **Supported account types**: *Accounts in any organizational directory and personal Microsoft accounts*.
   - **Redirect URI**: platform **Web**, `<PUBLIC_URL>/auth/microsoft/callback`, e.g.
     `http://localhost:3000/auth/microsoft/callback` (Microsoft, like Google, accepts `http://` only for
     `localhost`; see the redirect URI options above).
2. **API permissions → Add a permission → Microsoft Graph → Delegated**: `Calendars.Read`, `Calendars.Read.Shared`,
   `Tasks.ReadWrite`, `offline_access`, `openid`, `email`, `profile`. No admin consent is needed for personal
   accounts. `Tasks.ReadWrite` is for the To Do lists (reading them and ticking a task from a touch screen; Marco
   changes nothing else). Accounts linked before you added it keep showing their calendars; the To-do page shows
   *Reconnect* next to them, which signs in to the same account again and keeps its calendars and lists.
3. **Certificates & secrets → New client secret**, copy its **Value**, and the **Application (client) ID** from
   *Overview*. Put them in `.env` and restart:

   ```ini
   MICROSOFT_CLIENT_ID=<application-id>
   MICROSOFT_CLIENT_SECRET=<secret-value>
   ```

Marco keeps each account's tokens in `data/secrets.json` (Microsoft hands out a new refresh token every hour and the
newest one is kept). *Unlink* deletes them; Microsoft has no way to revoke them from here, so to remove the access
itself go to <https://account.live.com/consent/Manage> (personal) or <https://myapps.microsoft.com> (work or school).
Client secrets expire (6 to 24 months): create a new one before that and update `.env`.

## Adding an Apple iCloud calendar

iCloud is not linked with an account like Google or Microsoft: Marco reads each calendar's public link.
*Calendars → Linked accounts → Link account → Apple iCloud* opens a short guide to get it:

- **iPhone or iPad:** Calendar app → *Calendars* → ⓘ next to the calendar → turn on *Public Calendar* → *Share Link*
  → *Copy*.
- **Mac:** Calendar app → the share icon next to the calendar (or Control-click → *Share Calendar*) → *Public
  Calendar* → copy the `webcal://` address.
- **iCloud.com:** icloud.com/calendar → the share icon next to the calendar → *Public Calendar* → *Copy*.

Paste the link in the guide: Marco tests it and adds it as an iCal calendar (`webcal://` links work). Nothing to set
up on the server. Anyone who has the link can see the calendar, but it is long and impossible to guess; to withdraw
it, turn off *Public Calendar* in iCloud.

## Other integrations

- **iCal / ICS feeds:** any `http(s)://` or `webcal://` URL: school, sports club, work, public holidays (presets for
  several countries in *Calendars → Quick add*), vacation-rental platforms. *Test* shows how many events were read.
  If the feed uses a **self-signed certificate**, enable *Self-signed certificate* on that source only (or add your CA
  with `NODE_EXTRA_CA_CERTS`). A failing feed never breaks the others; errors show in *Status* and *Activity*.
- **Vacation rentals:** set the type to *Vacation rental*. Airbnb's "Reserved" / "Not available" entries become
  "Reservation · Guest" bars (blocked dates can be hidden with a filter); feeds that already format titles like
  `🏠 Guest - 4p+1m` keep their emoji and turn guest counts into icons; `Adults: 2 / Children: 1 / Infants: 1 / Pets: 1`
  lines in the description (also `Adultos/Niños/Bebés/Mascotas`) give 🧑🏻🧑🏻 🧒🏻 👶🏻 🐶.
- **Weather:** set the location (search by name or coordinates) and units in *Weather*, then pick the source in
  *Weather → Data source* (`weather.provider`). All of them are free:

  | Source | Key | Notes |
  |---|---|---|
  | [Open-Meteo](https://open-meteo.com/) (default) | none | Picks the best model for your area, or the one you choose in *Forecast model* (`weather.model`: `best_match`, `ecmwf_ifs`, `icon_seamless`, `gfs_seamless`, `meteofrance_seamless`, `ukmo_seamless`, `gem_seamless`, `jma_seamless`). Some models have no chance of rain or UV index, or fewer days; those values are left out. Free for non-commercial use; data under CC BY 4.0. |
  | [MET Norway](https://api.met.no/) | none | Locationforecast 2.0 of the Norwegian Meteorological Institute, worldwide. Chance of rain only in the Nordic countries; sunrise and sunset are computed. Marco identifies itself with its User-Agent and waits for the `Expires` time the service gives (about 30 minutes). Data under CC BY 4.0 and NLOD. |
  | [Pirate Weather](https://pirateweather.net/) | your own, free | Create a key at [pirate-weather.apiable.io](https://pirate-weather.apiable.io/) and paste it in *Weather*. The free plan allows 10,000 calls a month; Marco asks at most every 15 minutes (about 3,000). The key is checked once and kept in `data/secrets.json`. |

  Every source is cached per place for at least 10 minutes and shared by all the screens and languages; if the
  source fails, the screens keep the last forecast for up to 6 hours. The screens show the source's name in small
  type next to the weather (*Open-Meteo*, *Open-Meteo · ECMWF IFS*, *MET Norway*), as the CC BY licence asks.
- **Home Assistant:** in Home Assistant open your **profile → Security → Long-lived access tokens → Create token**;
  in *Admin → Home Assistant* enter the URL (e.g. `http://homeassistant.local:8123`) and the token, *Test connection*,
  then choose a `weather.*` entity and/or indoor temperature/humidity `sensor.*` entities in *Weather*. The token stays
  on the server. Home Assistant can also **send alerts** to the screens, see [webhooks](#api-tokens-and-webhooks).
- **News (RSS/Atom):** add any feed in *News*. Some sites block non-browser clients; the server already uses a desktop
  browser User-Agent. Use *Test* to check a feed.

## Electricity prices

In *Widgets → Add widget → Electricity price* pick your zone (grouped by country). The server fetches the day-ahead
market price and keeps it: the screens never call any website, and screens showing the same zone share one copy.

- **View:** *Automatic* (a small or medium corner shows the price now; a large corner or the side column adds the
  chart; full screen shows everything), *24 h chart* (bars from cheap to expensive with the price over the coming
  hours, tomorrow added once it is published, around 13:00 CET), *Price now*, *Cheap windows* (for example "02:00 to 05:00") and
  *Next 24 h* (the price now in large type with its level, the lowest, average and highest, and one row per hour with
  a bar from the current hour, in one or two columns, as many as fit). On a portrait screen in full screen,
  *Automatic* uses *Next 24 h*: a list fits the height better than a wide chart.
- **Shape** (24 h chart, Automatic and Next 24 h): *Landscape* is the wide card with a bar per hour; *Portrait* is a
  tall card with the price now, the lowest, average and highest, and one row per hour with its bar and price. For
  *Next 24 h* it picks one column or two.
- **Hour labels** (the wide chart): every 6 hours, every 3 hours or every hour. When they would touch, fewer are shown.
  Over the bars, the price of each coming hour; with no room for all, every second or third one, always with the
  cheapest and the dearest in bold.
- **Grid tariff:** what is added to the market price by the hour.
  - *Grid company* (Denmark, DK1 and DK2): pick your netselskab (Radius, Cerius, N1, TREFOR, Konstant, Dinel and
    more, 35 companies) and Marco adds every hour its household (C) tariff, Energinet's transmission and system
    tariffs and the electricity tax (elafgift), from Energinet DataHub (dataset DatahubPricelist, no key). They
    change by season and some by day, so they are read hour by hour, tomorrow too. If a company has not yet
    published the next ones, the last known tariff is used for up to 31 days and the screen says *estimated*; if a
    part is missing, the screen shows the market price with a note instead of a total that is too low. Picking a
    company sets VAT to 25 %.
  - *Time bands* (any country): up to 4 bands, each with a price per kWh without VAT and its hours (tap an hour to
    move it to the next band), with other hours on weekends and holidays if you like. *Spain 2.0TD* fills in punta
    (10-14 and 18-22), llano (8-10, 14-18 and 22-24) and valle (0-8, and all day on Saturdays, Sundays and the
    fixed-date national holidays: 1 and 6 January, 1 May, 15 August, 12 October, 1 November, 6, 8 and 25 December);
    there is one for Ceuta and Melilla too. You type the prices, as they appear on your bill. PVPC has no bands: it
    already includes the tolls.
  - The order: (market + tariff or band + fixed extra) x (1 + VAT). The screen says "Incl. grid tariff" or "Incl.
    time bands" at the bottom, and credits Energinet DataHub.
- **Fixed extra per kWh** and **VAT**, to see what you actually pay. The extra (grid fees, taxes, your supplier's
  margin; with a grid company only your supplier's margin) is added before VAT. With 0 and 0 you see the market
  price.
- Many zones publish a price every 15 minutes; the chart shows the average of each hour (or the quarter hours, in
  *More options*). Days when the clocks change have 23 or 25 hours.
- **Test** shows the price now part by part (market, company tariff, Energinet, elafgift or band, extra, VAT and
  total), and whether tomorrow's prices are out.

| Zone | Source | Key |
| --- | --- | --- |
| Denmark (DK1, DK2), SE3, SE4, NO2 | [Energi Data Service](https://www.energidataservice.dk/) (Energinet), in kroner or euros | none |
| Estonia, Latvia, Lithuania, Finland | [Elering](https://dashboard.elering.ee/) | none |
| Spain (wholesale market or PVPC) | [Red Eléctrica](https://www.ree.es/es/datos/apidatos), OMIE if it fails | none |
| Portugal | [OMIE](https://www.omie.es/) | none |
| Germany, Austria, Belgium, Netherlands, France, Switzerland, Czechia, Poland, Hungary, Slovenia, Italy North | [Energy-Charts](https://www.energy-charts.info/) (SMARD data, CC BY 4.0), aWATTar for Germany and Austria | none |
| The rest (Norway NO1/3/4/5, Sweden SE1/2, the rest of Italy, Greece, Romania, Bulgaria, Croatia, Slovakia, Ireland...) | [ENTSO-E](https://transparency.entsoe.eu/) with your own free token; without one, on your own server, Energy-Charts (private use only) | optional |

Get an ENTSO-E token for free at transparency.entsoe.eu (create an account, then ask for "Restful API access" by
email) and paste it in *More options*. It is kept in `data/secrets.json` and never shown again. If a source fails,
Marco tries the next one; if all fail, the screen keeps the last prices and marks them as *not updated*. Prices are
asked again after each day's auction until tomorrow's are in, and never more often than the sources allow.

## Photos

- **Stock** photos come from [picsum.photos](https://picsum.photos/) (free, no key). **Gallery** uses your own photos;
  **Mixed** alternates both. Set interval, brightness, transition and ambient effect in *Background*.
- **Weather effect** (*Background*, `background.weatherFx`): *Off*, *Simple* (light rain/snow particles, the default)
  or *Realistic* (drops on the glass that bend the photo, faint rain streaks, layered snow, soft sun rays on clear
  days). Both draw only over the photo and need WebGL (Realistic also needs the WebGL photo transition);
  `?lite=1` turns them off.
- **Special backgrounds** (*Background*): other photos on some days. A rule says when (*Event today with…* a word of
  the title, accents and capitals ignored, on the screen's calendars or the ones you pick; *Between two dates*, every
  year, also across New Year; *A single day*; *A birthday* from *Birthdays*) and which photos (picked from the
  gallery, or an Immich album). The first rule that matches wins; with none, the normal background. The server checks
  the rules every minute in the server's time zone, so the screen changes at midnight or soon after an event is
  added or removed. Privacy mode with *hide photos* still shows stock photos.
- **Photo order** (*Background*): *Random* (shuffled, without repeating the previous batch), *Newest first* or
  *By name*. The sequential orders continue where the screen left off and start over at the end.
- **Choose which photos are shown**: every photo in the gallery has an eye toggle to take it out of the rotation (or
  put it back) without deleting it. The counter shows how many are in rotation; filter by *In rotation* / *Hidden*
  and use *Select* to show or hide many photos at once. If every gallery photo is hidden, the screen falls back to
  stock photos.
- Upload in **Admin → Gallery** by drag and drop (JPG, PNG, WebP, AVIF, GIF and iPhone **HEIC**, up to 100 MB each).
  Photos are optimised **in your browser** before upload (rotated according to EXIF, resized to max 2560 px, saved as
  JPEG, with a 480 px thumbnail), so neither the server nor the Pi has to process images.
- A **focal point** is detected automatically (saliency + skin tones). Click a photo to adjust it: the editor shows
  exactly what the side panel and full-screen layouts will crop, including the bands covered by the clock and weather.
- Tip: **portrait photos** fit the side panel of the *big calendar* layout best; landscape photos work best in
  *big time* and *left/right*.
- Uploading a file with an existing name asks whether to replace it, keep both or skip it. Photos copied by hand
  into `data/photos/` can be optimised later with *Optimize and frame existing photos*.

## Multiple screens, alerts and the API

### Screens and connected displays

Create several **screens** in *System → Screens* ("Living room", "Kitchen", "Hallway"). Each has its own layout,
theme, background, widgets and set of calendars; calendars, rules and integrations are shared. A device shows a screen
through that screen's [private link](#private-display-links--pairing) or by being paired to it (in open mode also
`http://<server-ip>:3000/?screen=<slug>`; without `?screen` the default one ★, but only on the server itself, such as
`http://localhost:3000/` on an all-in-one kiosk: from another device the bare address only says "Open a screen's link").
The **Editing: Living room ▾** switcher in the admin header selects which screen the per-screen pages edit.

*System → Connected displays* lists every browser showing a screen (IP, browser, resolution, pixel ratio, WebGL,
version, last heartbeat, and how it got in: private link, paired device or no key) with **Reload**, **Identify**
(shows the screen name in big letters for 10 s) and **Night / Day / Auto** buttons, plus **Pair a screen** and the
list of paired devices. Outdated displays are flagged; *Reload* fixes them.

### Alerts and scheduled messages

*Alerts → Send an alert now*: title, text, emoji, style (*info*, *success*, *warning*, *urgent*), duration, sound and
target screens. Active alerts survive a server restart. *Scheduled messages* appear at fixed times on chosen weekdays
(windows can cross midnight).

### API tokens and webhooks

Create a token in *Admin → API & webhooks* (shown once; only a hash is stored). Then, from Home Assistant:

```yaml
# configuration.yaml
rest_command:
  marco_alert:
    url: "http://homeserver.lan:3000/api/hooks/announce"
    method: POST
    headers:
      Authorization: "Bearer cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    content_type: "application/json"
    payload: >-
      {"title": {{ title | tojson }}, "body": {{ (body | default('')) | tojson }},
       "emoji": {{ (emoji | default('🔔')) | tojson }}, "style": "{{ style | default('info') }}",
       "durationSec": {{ duration | default(120) }}, "sound": true}

automation:
  - alias: "Alert: washing machine finished"
    triggers:
      - trigger: state
        entity_id: sensor.washing_machine_status
        to: "finished"
    actions:
      - action: rest_command.marco_alert
        data:
          title: "The washing machine is done 🧺"
          emoji: "🧺"
          style: "success"
          duration: 300
```

Or with `curl`:

```bash
TOKEN=cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
curl -H "Authorization: Bearer $TOKEN" http://homeserver.lan:3000/api/hooks/ping
# urgent alert on the kitchen screen for 10 minutes
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Oven is on!","emoji":"🔥","style":"urgent","durationSec":600,"sound":true,"screens":["kitchen"]}' \
  http://homeserver.lan:3000/api/hooks/announce
# reload every screen / night mode on|off|auto
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' http://homeserver.lan:3000/api/hooks/reload
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"mode":"on"}' http://homeserver.lan:3000/api/hooks/night
```

Limits: 30 requests/minute per token; errors `401` (bad token), `400` (invalid data), `415` (not JSON), `429`
(rate limit). Full reference: [docs/API.md](docs/API.md).

On Marco Cloud the same calls work against `https://app.marcohome.app/api/hooks/...` with a token made in its admin
(*API & webhooks*), so the same scripts, automations and iPhone Shortcuts keep working after a move. There a household
can also send at most 500 alerts and commands a day through its tokens.

### Backups and activity

- Every save keeps the previous configuration in `data/backups/` (the 20 newest; quick successive saves count as one).
  *System → Backups* downloads, restores or deletes them and makes manual backups.
- **Export** downloads everything as one JSON file, optionally with secrets (password hash, Home Assistant token,
  Google accounts, API tokens; keep it safe). **Import** shows what changes per section before applying.
- **Download photos (.zip)** puts every gallery photo in one archive, made in your browser. Photos are not part of
  the JSON export, so upload them again in *Photos* when you move to another installation.
- Moving between Marco Cloud and a self-hosted Marco works both ways with the same file. Marco Cloud never exports
  or imports secrets, and it leaves out what it does not offer (Home Assistant, the admin password, open display
  access); the import preview lists what it left out. After a move, pair the screens again and reconnect Google
  Calendar.
- *System → Activity* records sign-ins (and failed attempts), saves, restores, alerts, API usage, displays connecting
  and calendar errors. Passwords, tokens and calendar URLs are never logged.

## Configuration reference

### Environment variables (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Listen address |
| `PUBLIC_URL` | derived from each request | URL of the admin through your domain, used for the Google OAuth redirect `${PUBLIC_URL}/auth/google/callback`; its host is also accepted by the host-name check |
| `ALLOWED_HOSTS` | none | Extra host names the server answers to, comma-separated (`.example.com` = subdomains too). IPs, `localhost`, single-label names and `*.local`/`*.lan`/`*.home.arpa`/`*.internal` always work; other names get `421` (DNS-rebinding protection) |
| `SESSION_SECRET` | random (stored in `data/secrets.json`) | Secret that signs the session cookie |
| `SETUP_TOKEN` | none | Require this token (at least 16 characters) to run the first-run setup wizard (`/admin/?setup=<token>`). Without it, the wizard works from the LAN and needs the per-start token printed in the log from anywhere else |
| `SETUP_REQUIRE_TOKEN` | none (`1` in Docker) | `1` = the wizard always needs the per-start token from the log, even from the LAN |
| `ADMIN_PASSWORD` | none | Headless installs only: initial admin password instead of the wizard (used only until a password is saved; the panel offers to change it). A value that breaks the wizard's rules (fewer than 10 characters or a common password) only works from the LAN and must be changed |
| `LAN_ADDRESS` | detected | This server's LAN address for the display's welcome QR code (set it in Docker, where it cannot be detected) |
| `DATA_DIR` | `./data` (`/data` in Docker, `<install folder>/data` with the installer) | Where configuration, secrets, photos and backups are stored |
| `COOKIE_SECURE` | per request | `1` = always `Secure` cookie, `0` = never |
| `TRUST_PROXY` | `loopback` | IP(s)/ranges of reverse proxies allowed to set `X-Forwarded-*`. Needed for a proxy on another host and for any proxy in front of Docker (`172.16.0.0/12`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | Google OAuth client ([guide](#connecting-google-calendar)) |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | none | Microsoft Entra app for Outlook and Microsoft 365 calendars ([guide](#connecting-outlook-hotmail-or-microsoft-365)) |
| `NODE_EXTRA_CA_CERTS` | none | Extra CA certificates for iCal feeds with a private CA |
| `MARCO_LIVE` | `sse` | `poll` = displays get no `/api/stream` connection and poll `/api/display/poll` instead (every 30 s, every 5 s while *Connected screens* is open). Alerts and display commands (refresh, night mode, identify) still arrive, a little later than over the stream. Useful behind a proxy that buffers server-sent events |
| `TZ` | the zone set in *Date & time* (follows changes live) | Process time zone (used for "floating" iCal times). Setting it here pins it |
| `MARCO_UPDATE_CHECK` | on | `0` = never ask GitHub for a newer release (no update banner) |

With Docker Compose only the variables listed in `docker-compose.yml` reach the container; `.env` next to it fills
them in.

### Data directory

```
data/
├── config.json          # all settings (screens, calendars, rules, events, birthdays)
├── secrets.json         # password hash, session secret, Google & Home Assistant tokens, API token hashes,
│                        #   private-link keys per screen, paired-device token hashes, weather API key (mode 600)
├── photos/              # gallery (+ .thumbs/ and .meta.json with focal points, hidden flags)
├── backups/             # automatic and manual configuration backups
├── cache/               # feed caches
├── activity.jsonl       # activity log
├── announcements.json   # active alerts + history
├── displays.json        # known displays
├── family.json          # routines ticked, rewards redeemed and star adjustments (last 90 days)
└── update/              # last update check, update settings and the log of the last update
```

Back up the whole folder (or use *Export*) to keep everything.

### Display URL parameters

| Parameter | Effect |
|---|---|
| `/d/<key>` | A screen's private link (the key decides the screen) |
| `/pair` | Show a pairing code (also in open mode) |
| `?screen=<slug>` | Show that screen profile; open mode or admin session only. Unknown: "Screen not found". Absent: the default screen on the server itself, "Open a screen's link" from another device |
| `?lite=1` | No WebGL effects (slow devices) |
| `?demo=1` | Built-in sample data (no server data needed) |
| `?lang=en\|es\|pt` | Override the language |
| `?preset=…` `?view=month\|agenda\|week` `?theme=dark\|light` `?style=classic\|modern` `?side=left\|right` `?clock=analog` | Override layout options (handy for testing) |
| `?preset=today\|people\|photoFrame\|twoWeeks\|board\|bedside` `?people=<calendar ids, comma separated>` `?corner=tl\|tr\|bl\|br` | Preview the newer layouts, the *Per person* columns and the *Photo frame* corner |
| `?glass=clear\|tinted\|auto` `?glassOpacity=0..1` `?glassBlur=0..40` `?glassTint=dark\|light\|photo` `?glassEdge=0\|1` | Override the glass options of the Modern style |
| `?highlights=0\|1` | Hide (or show) the pills under the date: the next event, birthdays and today's check-ins and check-outs (*Layout → Appearance*) |
| `?wxfx=off\|simple\|rich` | Override the weather effect; with `?demo=1`, `?wx=rain\|drizzle\|thunder\|snow\|clear` (or a WMO code, e.g. `45` for fog) forces the weather |
| `?ambient=aurora\|particles\|none` | Override the ambient backdrop behind the calendar |
| `?demo=1&pair=1` `?demo=1&pair=invalid` `&pairLen=6\|8` | Preview the pairing screen or the “link no longer valid” screen with a sample code (no server needed) |
| `?empty=1` `?photos=0` | With `?demo=1`: no events, countdowns or to-dos, or no background photo (to check the empty states) |
| `?marquee=0\|1` `?rotate=0\|1` | Turn off (or on) the long titles that slide (calendar chips, the pills next to the clock, countdowns, the news headline; titles on several lines move up a line at a time) and the busy days that take turns showing their events (*Calendars → Calendar view*); with `?demo=1`, `&busy=1` adds a busy day and long titles to try them |
| `?cards=0\|1` `?weeks=auto` `?preset=planner` | Events as cards (or one-line chips), automatic weeks, the *Planner* layout. With `?demo=1`, `&planner=1` shows the planner as picking it in the admin sets it up (try `&busy=2`); `&bar=side\|top\|bottom` puts its clock and weather at the side, top or bottom on a landscape screen |
| `?agendaDays=auto\|7\|14\|30` | How far the agenda view looks ahead (*Calendars → Calendar view → Days in the agenda*). With `?demo=1`, `&sparse=1&preset=agenda` shows a quiet calendar with events weeks away |
| `?compact=0\|1` `?weeks=1..8` | Turn off (or on) compact busy days: a day that cannot fit its events lists them as small one-line entries and the week rows share the height by how many events they have (*Calendars → Calendar view*); `?weeks=` shows that many weeks. With `?demo=1`, `&busy=2` fills the whole month |
| `?style=modern&preset=kidsRoutines\|kidsFamily\|kidsMeals` | The kids layouts. With `?demo=1`: `&members=6`, `&touch=0`, `&qr=0`, `&stars=0`, `&meals=0`, `&snack=1` (four meals a day), `&todo=1`, `&famPrivacy=hide` (with `&private=1`) |
| `/f/<key>` | The family page for phones (the key comes from *Family → Access*) |
| `/my/<link>`, `/my` | A person's own dashboard on the phone (*Family → Access → Family access*) |
| `?client=<name>` | Name of this device in *Connected displays* (the kiosk script sets it) |

## Security

Marco was designed for a home network; since 0.3 the displays are **private by default**.

- **Displays** (`/`, `/d/<key>` and the display API: `/api/display/*`, `/api/events`, `/api/weather`, `/api/news`,
  `/api/photos`, `/api/countdowns`, `/api/stream`, `/media/*`) need the screen's private-link key, a paired-device
  token or an admin session; otherwise they answer `401`/`403` with no data. Keys are compared in constant time, never
  logged, kept out of referrers (`Referrer-Policy: no-referrer`) and caches (`no-store`). In **open** mode (upgraded
  0.2 installs until you switch) the display API has no login, so **do not expose it to the Internet**.
- **Protected**: the admin (`/admin/`, `/api/admin/*`) needs a session (password and/or allowed Google accounts);
  webhooks need a bearer token.
- **Two-step sign-in** (optional, off by default): *Security → Two-step verification* adds a 6-digit code from an
  authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Aegis…) after the password, and after
  Google when Google sign-in is on. Turning it on keeps the sessions already open; you get 10 one-time recovery codes.
  Lost the phone and the codes? Stop Marco and run `npm run disable-2fa` in its folder (Docker:
  `docker compose run --rm marco npm run disable-2fa`), then start it again.
- A fresh install has **no default password**; the [setup wizard](#first-steps-the-setup-wizard) creates it. Set
  `SETUP_TOKEN` if the server is reachable from outside your LAN before you finish setup.
- Unknown host names are refused (DNS-rebinding protection); add your domain with `PUBLIC_URL` / `ALLOWED_HOSTS`.
- If you want remote access, use an **HTTPS reverse proxy** ([Caddy example](deploy/Caddyfile.example)). In private
  mode the displays can go through it too; in open mode expose only the admin, login and setup routes. Use a **strong
  password**, and set `TRUST_PROXY` whenever the proxy does not connect from loopback (another host, or Docker). On
  networks you do not control, use HTTPS so nobody can sniff a display key.
- Calendar, RSS and Home Assistant URLs you enter in the admin are fetched **by the server**, LAN addresses included.
- Keep `.env`, `data/secrets.json`, exports with secrets and `data/backups/` private.
- The installer and `marco update` check the SHA-256 of every release package (and of Node.js) before installing it.
  Builds from git (only before the first release, or on installs that were built from git) have no checksum to check.
- The admin's *Update now* button never gives the server root rights: it only creates a file that a root-owned systemd
  unit watches, and that unit always installs the latest release, checksum checked ([Updates](#updates)).

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Development

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
| `docs/` | [Architecture](docs/ARCHITECTURE.md), [API](docs/API.md), screenshots, logo and README media |

Contributions are welcome, please read [CONTRIBUTING.md](CONTRIBUTING.md). Release notes: [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Marco contributors. Third-party components keep their own licenses, notably the
HEIC decoder (LGPL-3.0, loaded as a separate unmodified chunk) and the Inter / Outfit fonts (OFL-1.1); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Acknowledgements

- [DAKboard](https://dakboard.com/) for the idea of a wall dashboard (this project is unaffiliated).
- [Open-Meteo](https://open-meteo.com/) and [MET Norway](https://api.met.no/): free weather APIs (data under CC BY 4.0),
  and [Pirate Weather](https://pirateweather.net/).
- [Lorem Picsum](https://picsum.photos/) and the Unsplash photographers for the stock photos.
- [three.js](https://threejs.org/), [Preact](https://preactjs.com/), [Vite](https://vite.dev/),
  [Express](https://expressjs.com/), [node-ical](https://github.com/jens-maus/node-ical), [rrule](https://github.com/jkbrzt/rrule),
  [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser), [heic-to](https://github.com/hoppergee/heic-to),
  [Inter](https://rsms.me/inter/) and [Outfit](https://fonts.google.com/specimen/Outfit).
