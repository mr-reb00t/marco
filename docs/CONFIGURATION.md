# Configuration and security

Almost everything is set in the admin panel. This page covers what is not: the environment variables in `.env`, the
data folder, the parameters a display URL takes, and how Marco is secured. For installing see
[INSTALL.md](INSTALL.md).

**Contents:** [Environment variables](#environment-variables-env) · [Data directory](#data-directory) ·
[Display URL parameters](#display-url-parameters) · [Security](#security)

## Environment variables (`.env`)

With the one-line installer, `.env` is in the install folder (`~/marco/.env` or `/opt/marco/.env`); restart with
`marco restart` after changing it. `.env.example` lists the same variables with comments.

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
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | Google OAuth client ([guide](INTEGRATIONS.md#connecting-google-calendar)) |
| `MARCO_GOOGLE_LOGIN` | off | `1` = allow "Sign in with Google" for the admin ([details](INTEGRATIONS.md#3-pick-your-calendars)) |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | none | Microsoft Entra app for Outlook and Microsoft 365 calendars ([guide](INTEGRATIONS.md#connecting-outlook-hotmail-or-microsoft-365)) |
| `GOOGLE_MAPS_API_KEY` | none | Google Maps key (Routes API) for the commute times widget, used when none is saved in the admin ([details](INTEGRATIONS.md#commute-times-and-exchange-rates)) |
| `NODE_EXTRA_CA_CERTS` | none | Extra CA certificates for iCal feeds with a private CA |
| `MARCO_LIVE` | `sse` | `poll` = displays get no `/api/stream` connection and poll `/api/display/poll` instead (every 30 s, every 5 s while *Connected devices* is open). Alerts and display commands (refresh, night mode, identify) still arrive, a little later than over the stream. Useful behind a proxy that buffers server-sent events |
| `TZ` | the zone set in *Date & time* (follows changes live) | Process time zone (used for "floating" iCal times). Setting it here pins it |
| `MARCO_UPDATE_CHECK` | on | `0` = never ask GitHub for a newer release (no update banner) |

With Docker Compose only the variables listed in `docker-compose.yml` reach the container; `.env` next to it fills
them in.

## Data directory

```
data/
├── config.json          # all settings (screens, calendars, rules, events, birthdays)
├── secrets.json         # password hash, session secret, Google & Home Assistant tokens, API token hashes,
│                        #   private-link keys per screen, paired-device token hashes, weather API key (mode 600)
├── photos/              # gallery (+ .thumbs/ and .meta.json with focal points, hidden flags)
├── avatars/             # profile photos of the family members
├── backups/             # automatic and manual configuration backups
├── cache/               # feed caches
├── activity.jsonl       # activity log
├── announcements.json   # active alerts + history
├── displays.json        # known displays
├── family.json          # routines ticked, rewards redeemed and star adjustments (last 90 days)
└── update/              # last update check, update settings and the log of the last update
```

Back up the whole folder (or use *Export*, see [Backups and activity](GUIDE.md#backups-and-activity)) to keep
everything.

## Display URL parameters

| Parameter | Effect |
|---|---|
| `/d/<key>` | A screen's private link (the key decides the screen) |
| `/pair` | Show a pairing code (also in open mode) |
| `?screen=<slug>` | Show that screen profile; open mode or admin session only. Unknown: "Screen not found". Absent: the default screen on the server itself, "Open a screen's link" from another device |
| `?lite=1` | No WebGL effects (slow devices) |
| `?demo=1` | Built-in sample data (no server data needed) |
| `?lang=en\|es\|pt\|nl\|da\|pl\|de` | Override the language |
| `?preset=…` `?view=month\|agenda\|week` `?theme=dark\|light` `?style=classic\|modern` `?side=left\|right` `?clock=analog` | Override layout options (handy for testing) |
| `?preset=today\|people\|photoFrame\|twoWeeks\|board\|bedside` `?people=<calendar ids, comma separated>` `?corner=tl\|tr\|bl\|br` | Preview the newer layouts, the *Per person* columns and the *Photo frame* corner |
| `?glass=clear\|tinted\|auto` `?glassOpacity=0..1` `?glassBlur=0..40` `?glassTint=dark\|light\|photo` `?glassEdge=0\|1` | Override the glass options of the Modern style |
| `?highlights=0\|1` | Hide (or show) the pills under the date: the next event, birthdays and today's check-ins and check-outs (*Layout → Appearance*) |
| `?np=0` | Hide the *Now playing under the clock* line; with `?demo=1`, `?np=1` shows it with a made-up song (`?np=idle`: nothing plays) and `&preset=canvas&shot=nowplaying` shows the *Now playing* cards |
| `?wxfx=off\|simple\|rich` | Override the weather effect; with `?demo=1`, `?wx=rain\|drizzle\|thunder\|snow\|clear` (or a WMO code, e.g. `45` for fog) forces the weather |
| `?ambient=aurora\|particles\|none` | Override the ambient backdrop behind the calendar |
| `?demo=1&pair=1` `?demo=1&pair=invalid` `&pairLen=6\|8` | Preview the pairing screen or the “link no longer valid” screen with a sample code (no server needed) |
| `?empty=1` `?photos=0` | With `?demo=1`: no events, countdowns or to-dos, or no background photo (to check the empty states) |
| `?marquee=0\|1` `?rotate=0\|1` | Turn off (or on) the long titles that slide (calendar chips, the pills next to the clock, countdowns, the news headline; titles on several lines move up a line at a time) and the busy days that take turns showing their events (*Calendars → Calendar view*); with `?demo=1`, `&busy=1` adds a busy day and long titles to try them |
| `?cards=0\|1` `?weeks=auto` `?preset=planner` | Events as cards (or one-line chips), automatic weeks, the *Planner* layout. With `?demo=1`, `&planner=1` shows the planner as picking it in the admin sets it up (try `&busy=2`); `&bar=side\|top\|bottom` puts its clock and weather at the side, top or bottom on a landscape screen |
| `?weekdays=1,2,3,4,5` | The days of the week the month and week grids show, 0 = Sunday (*Calendars → Calendar view → Days shown*); the others take no column |
| `?agendaDays=auto\|7\|14\|30` | How far the agenda view looks ahead (*Calendars → Calendar view → Days in the agenda*). With `?demo=1`, `&sparse=1&preset=agenda` shows a quiet calendar with events weeks away |
| `?compact=0\|1` `?weeks=1..8` | Turn off (or on) compact busy days: a day that cannot fit its events lists them as small one-line entries and the week rows share the height by how many events they have (*Calendars → Calendar view*); `?weeks=` shows that many weeks. With `?demo=1`, `&busy=2` fills the whole month |
| `?style=modern&preset=kidsRoutines\|kidsFamily\|kidsMeals` | The kids layouts. With `?demo=1`: `&members=6`, `&touch=0`, `&qr=0`, `&stars=0`, `&meals=0`, `&snack=1` (four meals a day), `&todo=1`, `&famPrivacy=hide` (with `&private=1`) |
| `/f/<key>` | The family page for phones (the key comes from *Family → Access*) |
| `/my/<link>`, `/my` | A person's own dashboard on the phone (*Family → Access → Family access*) |
| `?client=<name>` | Name of this device in *Connected devices* (the kiosk script sets it) |

## Security

Marco was designed for a home network; since 0.3 the displays are **private by default**. When you host it
yourself there is no account and no cloud in the middle: your configuration, photos and calendar data stay in the
`data/` folder, and the only outbound traffic goes to the calendars, weather and news feeds you connect (plus one
update check a day, see [INSTALL.md](INSTALL.md#how-the-update-button-works)).

- **Displays** (`/`, `/d/<key>` and the display API: `/api/display/*`, `/api/events`, `/api/weather`, `/api/news`,
  `/api/photos`, `/api/countdowns`, `/api/stream`, `/media/*`) need the screen's private-link key, a paired-device
  token or an admin session; otherwise they answer `401`/`403` with no data. Keys are compared in constant time, never
  logged, kept out of referrers (`Referrer-Policy: no-referrer`) and caches (`no-store`). In **open** mode (upgraded
  0.2 installs until you switch) the display API has no login, so **do not expose it to the Internet**. More in
  [Private display links & pairing](GUIDE.md#private-display-links--pairing).
- **Protected**: the admin (`/admin/`, `/api/admin/*`) needs a session (password and/or allowed Google accounts);
  webhooks need a bearer token.
- **Two-step sign-in** (optional, off by default): *Security → Two-step verification* adds a 6-digit code from an
  authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Aegis…) after the password, and after
  Google when Google sign-in is on. Turning it on keeps the sessions already open; you get 10 one-time recovery codes.
  Lost the phone and the codes? Stop Marco and run `npm run disable-2fa` in its folder (Docker:
  `docker compose run --rm marco npm run disable-2fa`), then start it again.
- A fresh install has **no default password**; the [setup wizard](INSTALL.md#first-steps-the-setup-wizard) creates it. Set
  `SETUP_TOKEN` if the server is reachable from outside your LAN before you finish setup.
- Unknown host names are refused (DNS-rebinding protection); add your domain with `PUBLIC_URL` / `ALLOWED_HOSTS`.
- If you want remote access, use an **HTTPS reverse proxy** ([Remote access](INSTALL.md#remote-access-with-https),
  [Caddy example](../deploy/Caddyfile.example)). In private mode the displays can go through it too; in open mode
  expose only the admin, login and setup routes. Use a **strong password**, and set `TRUST_PROXY` whenever the proxy
  does not connect from loopback (another host, or Docker). On networks you do not control, use HTTPS so nobody can
  sniff a display key.
- Calendar, RSS and Home Assistant URLs you enter in the admin are fetched **by the server**, LAN addresses included.
- Keep `.env`, `data/secrets.json`, exports with secrets and `data/backups/` private.
- The installer and `marco update` check the SHA-256 of every release package (and of Node.js) before installing it.
  Builds from git (only before the first release, or on installs that were built from git) have no checksum to check.
- The admin's *Update now* button never gives the server root rights: it only creates a file that a root-owned systemd
  unit watches, and that unit always installs the latest release, checksum checked
  ([How the Update button works](INSTALL.md#how-the-update-button-works)).

How each integration keeps its token on the server is described with the integration in
[INTEGRATIONS.md](INTEGRATIONS.md). See [SECURITY.md](../SECURITY.md) to report a vulnerability, and for the threat
model of private links and pairing.
