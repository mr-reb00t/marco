# Installing and running Marco

Everything about installing Marco on your own hardware, keeping it up to date and running it as a Raspberry Pi
kiosk. For the settings in `.env` see [CONFIGURATION.md](CONFIGURATION.md); for using the app see
[GUIDE.md](GUIDE.md).

**Contents:** [Ways to install](#ways-to-install) · [One-line installer](#one-line-installer) ·
[The `marco` command](#the-marco-command) · [Updates](#updates) · [Docker](#docker) ·
[Manual install](#manual-install-nodejs) · [Setup wizard](#first-steps-the-setup-wizard) ·
[Try it](#try-it-in-one-minute) · [Raspberry Pi kiosk](#raspberry-pi-kiosk) ·
[Remote access](#remote-access-with-https) · [Troubleshooting](#troubleshooting)

## Ways to install

| Way | Good for |
|---|---|
| [One-line installer](#one-line-installer) | A Raspberry Pi, home server or any Debian / Ubuntu machine. Prebuilt release, systemd service, kiosk and the `marco` command |
| [Docker](#docker) | A NAS or a machine that already runs containers |
| [Manual install](#manual-install-nodejs) | macOS, Windows, other Linux systems, or if you want to see every step |
| [Try it](#try-it-in-one-minute) | A throw-away demo with a fictional family, nothing to set up |

If you would rather not run a server at all, [Marco Cloud](https://app.marcohome.app/signup) hosts the same app.

## One-line installer

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

### Read it before you run it

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

### Installer options

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
| `--power-button`, `--no-power-button` | Let the *Shut down* card on a screen of this device power it off, or not (an all-in-one install asks; off by default). Later: `sudo marco power on\|off` |
| `-h`, `--help` | Show the help |

Run as root without `--user`, the server runs as `$SUDO_USER`; failing that, as the desktop auto-login user (modes
with a screen) or as a new `marco` system user (server only).

### Where things go

```
~/marco/                  (or /opt/marco)
├── current -> releases/0.6.1   the running version, switched in one step on update
├── releases/                   the current version and the previous one (for rollback)
├── data/                       config, secrets, photos, backups (kept on update and uninstall)
└── .env                        port and other settings, see .env.example
/etc/marco.conf                 what was installed and where (read by the marco command)
/usr/local/bin/marco            the marco command
/etc/systemd/system/marco-update.path, marco-update.service   the admin's Update button (see Updates below)
/etc/systemd/system/marco-power.path, marco-power.service     only with --power-button: the Shut down card
/run/marco/                     where the Exit kiosk and Shut down cards leave their requests (emptied at every boot)
~/.config/marco/kiosk.env       kiosk settings (screen and all-in-one modes)
```

## The `marco` command

| Command | What it does |
|---|---|
| `marco status` | Service state, version and address |
| `marco logs [-f]` | Server log (`-f` follows it); on a kiosk-only device, the kiosk log |
| `marco restart` | Restart the server |
| `marco update [--force]` | Install the latest release: checksum verified, switched in one step and rolled back if the new version does not start. It stops if GitHub cannot be reached and never installs an older version; `--force` reinstalls the same version or allows an older one |
| `marco url` | Admin address and the private link of every screen, with QR codes |
| `marco version` | Installed version and the latest release |
| `marco power on\|off\|status` | Whether the *Shut down* card on a screen of this device may power it off (see [Exit kiosk and Shut down](#exit-kiosk-and-shut-down)) |
| `marco kiosk [start\|stop]` | Open the kiosk again in the desktop session, after *Exit kiosk* or when it was closed; `stop` closes it. Works from a terminal on the Pi or over SSH while the desktop is logged in |
| `marco uninstall [--purge]` | Remove Marco; your data is kept unless you add `--purge`. It asks first (the default answer is no); without a terminal it needs `--yes` |

## Updates

Once a day the server asks GitHub which release is the latest. When there is a newer one, the admin shows a banner,
*Marco 0.5.1 is available*, with the release notes. How you update depends on how Marco was installed:

| Install | How to update |
|---|---|
| One-line installer | **Update now** in the admin (or `marco update` on the server). The new version is downloaded, its checksum checked, switched in one step and rolled back if it does not start. The admin follows the progress and reloads itself, and the screens reload on their own |
| Docker | `git pull && docker compose up -d --build` in the folder with `docker-compose.yml` (the admin shows it) |
| Git checkout | `marco update` when it was set up with `deploy/install.sh`, otherwise `git pull && npm ci && npm run build` and a restart |

### Automatic updates

Automatic updates are off by default. Turn them on in *Status → Updates* (installs made with the one-line
installer) and choose the hours, by default between 03:00 and 05:00 in the time zone of *Date & time*. A version that
fails to start is rolled back and not tried again; the next release is.

### How the Update button works

The server runs as a normal user and cannot update itself. It writes `data/update/request`; a systemd path unit
installed by the installer (`marco-update.path`) sees it and starts `marco-update.service`, which runs
`marco update --requested` as root, the same as `sudo marco update`. Nothing in the request is read except that it
exists, so all the server can ask for is "the latest release". Progress and the installer's output go to
`data/update/` for the admin. Installs updated from 0.4 get the button after running `marco update` once more on the
server (it says the version is up to date and adds the units).

Privacy: the check is one `GET` to `api.github.com` a day, with no identifier or version in it (an unchanged answer is
not even downloaded again). Turn it off in *Status → Updates*, or for good with `MARCO_UPDATE_CHECK=0` in `.env`.

## Docker

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

## Manual install (Node.js)

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

## First steps: the setup wizard

A fresh install has no admin password and no settings to speak of. The first time you open
`http://<server-ip>:3000/admin/` a **setup wizard** walks you through everything in about two minutes, and the
display (`http://<server-ip>:3000/`) shows a welcome screen with the admin address and a QR code until you are done.

| | |
|---|---|
| ![Setup wizard, step 1: welcome and language](screenshots/setup-1-welcome.webp) | ![Step 2: admin password with a strength meter](screenshots/setup-2-password.webp) |
| ![Step 3: city search, time zone, units and time format](screenshots/setup-3-location.webp) | ![Step 4: holidays by country and iCal sources with a Test button](screenshots/setup-4-calendars.webp) |
| ![Step 5: screen name, layout, accent colour, photos and ambient effect](screenshots/setup-5-look.webp) | ![Step 6: the screen's private link with copy button and QR code, summary and tips](screenshots/setup-6-done.webp) |

1. **Welcome:** pick the language (English, Español, Português, Nederlands, Dansk, Polski, Deutsch).
2. **Admin password:** at least 10 characters, nothing obvious (`password123`, `1234567890`, `qwertyuiop`), typed
   twice; a strength meter helps. The display itself never needs a password.
3. **Location:** search your city (Open-Meteo, no API key); the time zone comes with it (or from your browser),
   then choose °C/°F and a 24 h or 12 h clock. No Internet from the browser? Type the coordinates, or skip the
   location and add it later (weather needs it; the time zone is saved either way).
4. **Calendars:** tick your country's public holidays (preselected from the city), paste iCal (`.ics`) addresses
   and press **Test** to check them. Google Calendar: paste the calendar's *secret address in iCal format*, or link
   the account after setup when the server has
   [a Google OAuth client](INTEGRATIONS.md#connecting-google-calendar).
5. **Look:** screen name, layout, accent colour, light/dark theme, background photos (stock now, your gallery
   later) and the ambient effect.
6. **Done:** the screen's **private link** to open on the TV or Raspberry Pi (copy button and QR code; when you ran
   the wizard on the server itself as `localhost`, it uses the server's LAN address), a summary and tips (`?lite=1`
   for slow devices, the one-line kiosk command with the private link). You are logged in and land in the panel.
   A display that was showing the welcome screen switches to a
   [pairing code](GUIDE.md#private-display-links--pairing).

<img src="screenshots/setup-mobile.webp" alt="The setup wizard on a phone" width="260" align="right">

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

![Welcome screen on a fresh install with the admin address and a QR code](screenshots/display-welcome.webp)

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
  shows a pairing code to try *Connected devices → Pair a screen*
- Admin: <http://localhost:3000/admin/>, password **`demo-calendar`**
- Options: `--port 3080`, `--lang es` (or `pt`), `--no-photos`, `--data ./demo-data --keep`

![The kitchen screen of the demo: light theme, agenda, to-do list and live weather](screenshots/display-kitchen-live.webp)

Just want to see the display? Any running instance shows a built-in sample dataset at `/?demo=1`
(add `&lang=es`, `&preset=agenda`, `&theme=light`, `&style=modern`, `&announce=success`, `&sched=1`, `&now=2026-10-09T10:42`,
`&wx=rain|snow|clear` with `&wxfx=rich` to see the weather effect, `&pair=1` for the pairing screen). All the
parameters are in [CONFIGURATION.md](CONFIGURATION.md#display-url-parameters).

**Demo video.** A one-minute tour in the Modern style: the month view, an alert sent from a phone, the Today and
board layouts, the photo frame, Classic and glass styles, live weather effects, a portrait screen, the admin
(layouts, calendars, gallery) and the dim bedside clock at night.

[![Demo video: a Custom screen with Home Assistant cards (thermostat, lights, blind, camera and energy chart), the drag and drop editor, family, data and calendar screens](media/poster.webp)](https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4)

## Raspberry Pi kiosk

Made for Raspberry Pi OS **Bookworm** or **Trixie** (64-bit, with desktop) on a Pi 4 or 5; a Pi 3 works with `?lite=1`.
The kiosk is Chromium in full screen, started by the desktop session. The installer sets it up for labwc and Wayfire
(Raspberry Pi OS with desktop) and for X11 with LXDE.

![Big calendar layout on a 1280x720 Raspberry Pi screen](screenshots/display-1280x720.webp)

<img src="screenshots/mobile-private-link.webp" alt="Admin on a phone: the screen's private link and QR code" width="230" align="right">

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

Run the server on a home server, NAS or Docker host ([Ways to install](#ways-to-install)), then copy the command from
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
  exits and adds `client=<hostname>` so the device keeps its name in *Connected devices*. After editing `kiosk.env`,
  `marco kiosk stop` and then `marco kiosk` apply it without a reboot.
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

Useful commands: `marco status`, `marco logs -f`, `marco restart`, `marco update`, `marco url`, `marco kiosk`.

### Exit kiosk and Shut down

Two *Navigation* cards of a custom screen let a touch screen leave the kiosk or power off the Pi without opening the
admin. Both need *Allow touch on the screen*, and both ask for a second tap within a few seconds (the card turns
amber and a bar runs out), so a hand brushing the screen does nothing.

- **Exit kiosk** closes Chromium. The kiosk comes back after a reboot, at the next desktop login, from the Pi's
  menu (the *Marco* entry), or with the command `marco kiosk` in a terminal (on the Pi, or over SSH while the desktop
  is logged in). The command is lowercase: `marco kiosk`, not `Marco`.
- **Shut down** powers the Pi off. It is off until you allow it on the Pi:

  ```bash
  sudo marco power on      # or install with --power-button; sudo marco power off to take it back
  marco power status
  ```

  Until then the card says how to turn it on.

They only work on an **all-in-one** Pi, in the kiosk browser the installer sets up, which opens
`http://localhost:<port>/` (the default; keep `KIOSK_URL` on `localhost`). The kiosk script hands that browser a key
the server keeps in its data folder, and the server only answers requests that carry it, come straight from that
machine (not through a reverse proxy) and are for a card that screen shows now. A phone, another screen, a desktop
browser, the Pi showing the server by its network address, or someone using a copy of the display link through a
proxy or port forward get nothing; the card says it only works on the Pi that runs Marco. Each use is in the activity
log. After updating from an older version, restart the Pi once so the kiosk picks this up. They are
not in Marco Cloud, and not available in Docker (the server there cannot reach the host). After *Exit kiosk* the screen
does not blank by itself until the next login, because the kiosk turned that off when it started.

## Remote access with HTTPS

Marco is made for a home network. To reach it from outside, or to link a Google account under your own domain, put
a reverse proxy with a valid certificate in front, set `PUBLIC_URL=https://calendar.example.com` (and, if you use
other names, `ALLOWED_HOSTS`). Security notes are in [CONFIGURATION.md](CONFIGURATION.md#security).

- **Caddy** (automatic Let's Encrypt): see [`deploy/Caddyfile.example`](../deploy/Caddyfile.example). It explains what to
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
- A proxy that buffers Server-Sent Events delays live updates; `MARCO_LIVE=poll` makes the displays poll instead
  (see [CONFIGURATION.md](CONFIGURATION.md#environment-variables-env)).

## Troubleshooting

Most problems have an answer somewhere above; this is the short list.

- **Where is the setup URL?** `marco logs | grep setup`, `journalctl -u marco | grep setup` or
  `docker compose logs marco | grep setup`. See [Who can run it](#first-steps-the-setup-wizard).
- **Lost the phone for two-step sign-in, and the recovery codes?** Stop Marco and run `npm run disable-2fa` in its
  folder (Docker: `docker compose run --rm marco npm run disable-2fa`), then start it again.
- **A host name gets `421`:** add it with `PUBLIC_URL` or `ALLOWED_HOSTS` ([CONFIGURATION.md](CONFIGURATION.md)).
- **Everyone behind the proxy is treated as remote:** set `TRUST_PROXY` and make sure the proxy sends
  `X-Forwarded-For` ([Remote access](#remote-access-with-https)).
- **Google says `redirect_uri_mismatch`:** see
  [the redirect URI problem](INTEGRATIONS.md#2-the-redirect-uri-problem-and-three-ways-around-it).
- **Google calendars stop updating after a week:** the OAuth app is still in *Testing*
  ([Testing vs. production](INTEGRATIONS.md#1-create-a-google-cloud-project-and-oauth-client)).
- **A calendar feed fails:** *Test* it in *Calendars*; errors show in *Status* and *Activity*. For a self-signed
  certificate see [iCal / ICS feeds](INTEGRATIONS.md#ical--ics-feeds).
- **The kiosk shows a pairing code after a restart:** give it the private link instead of pairing it
  ([Kiosk only](#b-server-elsewhere-the-pi-only-shows-it-kiosk-only)).
- **The kiosk is too big, too small or slow:** see [Kiosk tips](#kiosk-tips). The kiosk log is
  `/tmp/marco-kiosk.log`.
- **A display is outdated:** *Reload* it in *Connected devices*.
- **Live updates are late or missing behind a proxy:** try `MARCO_LIVE=poll`.
