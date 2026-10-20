# Architecture

This document describes how Marco is built: the processes, the data model and the behaviour the
display and the server guarantee. The HTTP endpoints and event formats are in [API.md](API.md).

## Overview

```
 ┌───────────────────────────── home server / NAS / Raspberry Pi ─────────────────────────────┐
 │  Node.js ≥ 20 · Express 5 · plain ESM JavaScript (server/, no build step)                  │
 │                                                                                             │
 │   sources ──► server/calendars.js ──► events pipeline ──► /api/events (per screen)          │
 │   ICS · Google · local events · birthdays    (rules, icons, rental feeds, countdowns)       │
 │   weather sources · HA        ──► /api/weather      RSS ──► /api/news                       │
 │   data/ (JSON files, atomic writes)          SSE hub ──► /api/stream (live updates)         │
 │   serves dist/ (Vite build): /  = display, /admin/ = admin panel                            │
 └───────────────▲──────────────────────────────────────────────▲──────────────────────────────┘
                 │ HTTP + Server-Sent Events                     │ HTTP (session cookie)
     displays: Chromium kiosk on a Pi, tablet, TV browser…      admin panel from a phone / laptop
     vanilla TypeScript + three.js (web/display)               Preact + TypeScript (web/admin)
```

| Folder | Content |
|---|---|
| `server/` | API and logic: ICS + recurrences (`node-ical`, `rrule`), Google Calendar, weather, RSS, photos, auth, SSE and the poll channel (`pollHub.js`), backups, activity |
| `server/app.js` | `createApp()`: the whole Express stack (host guard, sessions, CSRF, display access, routers, static files); `server/index.js` adds the store, listen and shutdown |
| `server/core/` | Pure logic shared with Marco Cloud, which copies the folder as it is: config schema and validation (`validate.js`, `defaults.js`, `screens.js`, `iconRules.js`), backups and import (`backupsCore.js`), announcements (`announceCore.js`), doorbell rings (`doorbellCore.js`), feed parsing (`newsParse.js`), image headers and photo names (`imageInfo.js`), activity helpers (`activityCore.js`), pairing codes (`pairCore.js`), privacy mode (`privacy.js`), family access rules (`familyAccessCore.js`), special background rules (`bgRules.js`), CSV, schedules and `lib/` (text, time zones, server strings). No Node built-ins, no store, SSE or HTTP modules (checked by `server/test/core-lint.test.js`); the files next to it (`backups.js`, `announce.js`, `photos.js`, `news.js`, `activity.js`, `pairing.js`, `doorbell.js`) add the files, network and SSE |
| `server/displayAccess.js`, `server/pairing.js` | Private display links, paired devices and pairing codes (see *Display access* below) |
| `server/familyAccess.js` | Family access: each person's phone dashboard, its links, codes and device tokens, and the actions it may run (see *Familia* below) |
| `server/routes/` | Express routers: `public.js` (display API), `admin.js`, `screens.js`, `announce.js`, `hooks.js`, `doorbell.js`, `system.js`, `localEvents.js`, `access.js` (links, devices, pairing), `updates.js` |
| `server/updates.js` | Daily check for a newer release, update settings, the request read by `marco-update.path` (see *Updates* below) |
| `server/test/` | `node --test` suites and fixtures |
| `web/index.html`, `web/display/` | The display (vanilla TypeScript + three.js) |
| `web/admin/` | The admin panel (Preact + TypeScript) |
| `web/shared/` | Types shared by server contracts, display and admin; i18n; emoji rules; screen projection; focal-point crop |
| `install.sh` | One-line installer (`curl -fsSL https://marcohome.app/install \| bash`): modes all / server / kiosk, prebuilt release with checksum, `--dry-run`, update with rollback, uninstall. See *Installer and releases* below |
| `deploy/` | `marco` command, systemd unit, kiosk script, HDMI schedule, Caddy example; `deploy/install.sh` installs a git checkout in place (wrapper around `install.sh --source`) |
| `scripts/package-release.sh`, `scripts/release-notes.js` | Release tarball and notes (used by `.github/workflows/release.yml` on `v*` tags) |
| `scripts/demo.js` | `npm run demo`: throw-away data directory with a fictional family |
| `data/` | Runtime data (git-ignored; `DATA_DIR` overrides the location) |

Design constraints: no native modules and few runtime dependencies (it must install on a Raspberry Pi without build
tools), no database (JSON files written atomically: temp file + rename), every outbound fetch has a 15 s timeout and a
failing source never breaks the others.

## Data directory

| Path | Content |
|---|---|
| `config.json` | The whole configuration (schema v2 below). Bumped `revision` on every save. The admin sends the revision it loaded (`baseRevision`) and a stale one gets `409 conflict`, so only real saves may bump it: background work (calendar refresh, pairing, display links, commands) never writes `config.json`. |
| `secrets.json` | Password hash (scrypt; absent on a fresh install → setup wizard, `server/setup.js`), `setupCompletedAt`, session secret/epoch, Google refresh tokens per account, Home Assistant token, Immich API key (`immich.apiKey`), the household's Spotify app and its accounts (`spotify.clientId`, `clientSecret`, `accounts[<sp_ id>]` with their tokens; see *Now playing*), API tokens (SHA-256 hashes), `displayKeys` (one private-link key per screen id), `devices` (paired devices: name, screen, SHA-256 of the token, last seen), `familyAccess` (people with a phone dashboard: permissions, SHA-256 of their link and of each phone's token). Mode 600. Never sent to displays. |
| `photos/` | Gallery images; `photos/.thumbs/` thumbnails (480 px); `photos/.meta.json` size + focal point per file |
| `immich/` | Immich source (`server/immich.js`): `albums/<albumId>[-fav].json` (last good asset list per album, used for up to 24 h while Immich is down) and `cache/` (preview images, 500 MB LRU, `MARCO_IMMICH_CACHE_MB`). Not in backups |
| `cache/` | Source and feed caches |
| `backups/` | Rotating config backups (20 newest) + `config-v1-premigration.json` |
| `activity.jsonl` | Activity log (≈ 5000 newest entries) |
| `announcements.json` | Active announcements + history (50) |
| `displays.json` | Known displays registry (≤ 100, offline > 30 days pruned) |
| `privacy.json` | Privacy mode state per screen: `{ screens: { [screenId]: { on, until, by, at } } }` (server/privacy.js) |
| `family.json` | Familia state (server/family.js): `{ version, rev, completions: { [date]: { [choreId]: { memberId, points, title, emoji, by, at } } }, redemptions, adjustments, base }`. Entries older than 90 days are folded into `base` so balances never change. A broken file is kept as `family.json.corrupt-<ms>` |
| `update/` | `check.json` (last answer from GitHub, ETag), `settings.json`, `request` (while an update is asked for), `status.json` and `update.log` (last update) |

## Configuration schema (v2)

The stored config has **global** sections shared by every screen and a list of **screen profiles**
(`server/core/defaults.js` → `defaultConfig()`, TS `StoredConfig` in `web/shared/types.ts`; limits in `server/core/validate.js`).

```jsonc
{
  "version": 2, "revision": 1,
  "defaultScreen": "s_main",                 // served when ?screen is absent (unknown → 404 screen_not_found)
  "screens": [ ScreenProfile ],              // 1..12
  // ---------- global ----------
  "calendar":   { "sources": [CalendarSource], "iconRules": [IconRule] },
  "datetime":   { "timezone": "Europe/Lisbon" },
  "weather":    { "provider": "open-meteo", "model": "best_match", "locationName": "Lisbon, Portugal", "lat": 38.7223, "lon": -9.1393,
                  "units": "metric", "haWeatherEntity": "", "haIndoorTempEntity": "", "haIndoorHumidityEntity": "" },
  "news":       { "feeds": [{ "id", "name", "url", "enabled" }], "maxItems": 30 },
  "todo":       { "items": [{ "id", "text", "done" }], "lists": [TodoList] },
  "localEvents":{ "enabled": true, "name": "Family", "color": "#e76f51", "emoji": "", "privacy": "busy", "items": [LocalEvent] },
  "birthdays":  { "enabled": true, "name": "Birthdays", "color": "#ff6f91", "emoji": "🎂", "showAge": true, "tidyTitles": true, "privacy": "keep", "items": [Birthday] },
  "eventRules": { "items": [EventRule] },
  "countdowns": { "items": [Countdown], "includeBirthdays": true, "birthdayDays": 30, "includeFlagged": true, "horizonDays": 365 },
  "schedules":  { "items": [ScheduledMessage] },
  "carousels":  { "items": [Carousel] },       // 0..6; see "Carousels" below
  "widgets":    [Widget],                      // 0..20 images / web pages, placed per screen (screen.widgets, layout.widgetId); docs/API.md "Widgets"
  "homeassistant": { "enabled": false, "url": "http://homeassistant.local:8123",    // token in secrets.json
                  "doorbell": { "camera": "", "seconds": 60, "screenIds": [], "sound": true } },
                  // doorbell: camera.* entity ('' = no picture), seconds 10..300, screenIds ([] = all; when every chosen
                  // screen is deleted it falls back to the default screen, never to all), door chime.
                  // cameraLanOnly: false (stored only when off) lets Cámara cards answer displays outside the home network.
                  // Camera pictures for the doorbell and the Cámara cards come from server/haCamera.js (one shared cache
                  // and one live stream per camera)
  "immich":     { "enabled": false, "url": "", "insecureTls": false },  // API key in secrets.json; url without /api
  "auth":       { "allowedGoogleEmails": [], "passwordLoginEnabled": true },
  "security":   { "displayAccess": "private" },     // "open" = legacy LAN mode (installs upgraded from 0.2)
  "family":     { "enabled": false, "members": [], "chores": [], "rewards": [], "showPoints": true,
                  "allowRedeemFromPhone": false, "privacy": "initials",
                  "meals": { "enabled": false, "slots": ["breakfast", "lunch", "dinner"], "useTemplate": true, "template": {}, "weeks": {} } }
                  // see "Familia" below
}
```

**ScreenProfile** (one per physical display or group of displays):

```jsonc
{ "id": "s_main", "slug": "living-room", "name": "Living room",
  "screen":     { "language": "en", "fontScale": 1, "theme": "dark", "style": "classic", "accent": "#ff5a4e", "orientation": "auto",
                  "customCss": "", "nightMode": { "enabled": false, "from": "23:00", "to": "07:00", "dim": 0.35 } },
                  // style: classic | modern, independent of the layout. Missing (older configs) = classic.
                  // glass (Modern only): { "appearance": "auto", "opacity": 0.5, "blur": 18, "tint": "dark", "edge": true }
                  //   appearance auto | clear | tinted, opacity 0..1 (see-through to solid), blur 0..40, tint dark | light | photo.
                  //   web/shared/glass.ts turns it (plus the current photo) into --g-* CSS variables on <html>.
  "layout":     { "preset": "bigCalendar", "sidePanel": "left", "sideWidth": 0.36, "people": null, "corner": "br", "plannerBar": "side" },
                  // preset: bigCalendar | leftRight | topBottom | bigTime | agenda | today | people | photoFrame | twoWeeks | board | bedside | planner
                  //   | kidsRoutines | kidsFamily | kidsMeals (Modern style only; with Classic the display shows bigCalendar)
                  // people: calendar ids shown as columns by 'people' (max 5; null = the first five without holidays / birthdays)
                  // corner: where 'photoFrame' puts its clock card (tl | tr | bl | br)
                  // today / people / photoFrame / board / bedside render into #view (web/display/widgets/views.ts, styles in
                  //   styles-views.css + styles-modern.css). today and twoWeeks reuse the big calendar frame (#app also gets
                  //   .preset-bigCalendar), people and board the top / bottom one (.preset-topBottom). twoWeeks is the month
                  //   grid with weeks = 2. Each view drops whole rows that do not fit (never a row cut in half).
                  // planner: the month grid under a short band with the clock, the date and the weather. It uses the
                  //   top / bottom frame on a portrait screen and the big calendar one on a landscape screen (#app gets
                  //   .preset-topBottom or .preset-bigCalendar too); its own rules are in styles-planner.css. Picking it in
                  //   the admin or the setup wizard sets calendar.weeks = "auto" and eventStyle = "cards"
                  //   (PLANNER_CALENDAR in server/core/defaults.js); the display itself never forces them.
                  // plannerBar: side | top | bottom, where a landscape planner puts the clock and the weather. top / bottom use
                  //   the top / bottom frame with a low strip (#app gets .pbar .pbar-top|bottom): the weather is one row and
                  //   the month at most 4 weeks. Portrait screens ignore it. ?bar= overrides it.
  "background": { "enabled": true, "source": "stock", "stockTopic": "nature", "order": "random", "intervalSec": 120, "brightness": 0.85,
                  "showMeta": false, "cover": true, "transition": "webgl", "ambient": "aurora", "panelBlur": 18, "panelShade": 0.5, "weatherFx": "simple",
                  "portraitFit": "auto", "immich": { "albumIds": [], "favoritesOnly": false }, "rules": [] },
                  // source: stock | gallery | mixed | immich · order: random | newest | name · transition: webgl | fade | none · ambient: aurora | particles | none · weatherFx: off | simple | rich
                  // portraitFit: auto | blur | crop, for photos whose orientation differs from the screen (auto = blurred fill for Immich photos only)
                  // immich: albums played with source immich (UUIDs, at most 20, merged without duplicates; [] = stock photos)
                  // rules: special backgrounds, see "Special backgrounds" below
  "calendar":   { "enabled": true, "view": "month", "weeks": 5, "weekStart": 1, "startOn": "week",
                  "showLocation": false, "showEndTime": false, "showDayXofY": true, "showLegend": true, "hidePast": false, "maxEventsPerDay": 4,
                  "marquee": true, "rotateBusyDays": true, "compactBusyDays": true, "eventStyle": "lines",
                  "agendaDays": "auto", "sourceIds": null },               // null = every enabled source (incl. new ones); array = only these
                  // startOn: week (the grid starts on the first day of this week, weekStart) | today (no past days: the first cell is today)
                  // marquee: titles cut short (calendar chips, agenda-like lists, side panel pills, countdowns, news) slide to show the rest
                  // rotateBusyDays: a month-grid day with more events than fit pages through them every 8 s
                  // compactBusyDays: a month / week grid day whose events do not fit at normal size lists them as small
                  //   one-line entries (time + title) below its multi-day bars, and week rows share the height by what
                  //   their events need (equal rows while every week fits). Only what still does not fit falls back to
                  //   rotateBusyDays or "+N". On for new screens; screens stored without the key get false (mergeDefaults).
                  // weeks: 1..8, or "auto": the display picks 2 to 6 rows (fewer where the layout caps them) so each day
                  //   fits maxEventsPerDay chips or cards at a readable size, and picks again when the grid's height
                  //   changes (resize, orientation, news appearing). Events are fetched for 6 weeks then.
                  // eventStyle: "lines" (one-line chips, the default and what every older screen keeps) or "cards": in the
                  //   month and week grids, events of one day stack as cards (time line, then the title clamped to
                  //   2 lines) below the bars of events that span days (a few lanes at most; the others show a one-day
                  //   card on each day). Rows stay equal. A day with more cards than fit pages (rotateBusyDays) or shows
                  //   "+N"; clamped titles scroll up with marquee. compactBusyDays is not used with cards.
                  //   Pure planning helpers: web/display/cards.ts (tested in server/test/display-planner.test.js).
                  // agendaDays: how far the agenda view looks ahead: 7, 14 or 30 days, or "auto" (default, also for older
                  //   screens): Today and Tomorrow, then the next days with events. The display lays every candidate
                  //   day out in a hidden copy of the agenda and keeps the leading day blocks that fit whole, never
                  //   fewer than 14 days would show; it measures again when the agenda's size or the events change.
                  //   Events are fetched up to 61 days ahead while the agenda view is on. The side agenda shows 3 days.
                  //   Pure helpers: web/display/agendaFill.ts (tested in server/test/display-agenda.test.js).
  "datetime":   { "enabled": true, "clock": "digital", "format24": true, "showSeconds": true, "showAmPm": false, "dateFormat": "weekday_d_month" },
  "weather":    { "enabled": true, "forecastDays": 5, "showHourly": true, "showPrecipChance": true },
  "news":       { "enabled": true, "rotateSec": 15 },
  "todo":       { "enabled": false },
  "message":    { "enabled": false, "text": "", "emoji": "💬" },
  "countdowns": { "enabled": true, "max": 4 },
  "alerts":     { "enabled": true, "sound": true, "volume": 0.6 },
  // screen.nowPlaying: "Sonando ahora bajo el reloj", the opaque id of a linked Spotify account (stored only when
  //   chosen); one line under the date of the usual designs, gone when nothing plays (see "Now playing")
  "privacy":    { "hidePhotos": false, "showLock": true, "schedule": [{ "id", "enabled", "days", "from", "to" }] },
                  // privacy mode of this screen (docs/API.md "Privacy mode"); the on / off state is runtime data
  "family":     { "memberIds": null, "touch": false, "showQr": true } }
                  // Familia on this screen: who appears (null = everyone), ticking by touch, the QR card on kids layouts
```

Global vs per-screen for the "split" sections:

| Section | Global part | Per-screen part |
|---|---|---|
| screen, layout, background, message, alerts, privacy, widgets (placements) | none | all |
| calendar | sources, iconRules | view settings + `sourceIds` |
| datetime | timezone | clock and date format, enabled |
| weather | provider, model, location, units, HA entities | enabled, forecastDays, showHourly, showPrecipChance |
| news | feeds, maxItems | enabled, rotateSec |
| todo | items, lists | enabled |
| countdowns | items + inclusion settings | enabled, max |
| localEvents, birthdays, eventRules, schedules, carousels, widgets (definitions), homeassistant, immich, auth | all | none |

The display and most admin pages work on a **flat view of one screen** (`AppConfig`): global sections merged with
one profile (`flatView()` in `server/core/screens.js`, `projectScreen()` / `applyScreen()` in `web/shared/screens.ts`,
lossless round-trip).

Item schemas (ids generated by the server when missing; prefixes in brackets):

- **CalendarSource** `[c_]`: `type` `ics|google|microsoft`, `name`, `url` (ics; `webcal://` accepted), `googleCalendarId` +
  `googleAccount` (google), `microsoftCalendarId` + `microsoftAccount` (microsoft: Outlook.com, Hotmail and Microsoft
  365 calendars through Microsoft Graph, with the server's own Entra app on a self-hosted server), `color`, `emoji`, `kind` `generic|airbnb|birthdays|holidays`, `enabled`, `refreshMin`,
  `insecureTls` (accept self-signed certificates for this feed only), `privacy` `busy|hide|keep` (what privacy mode does
  to its events; missing = `busy`, or `keep` for kinds `holidays` and `birthdays`). Ids `local` and `birthdays` are
  reserved for the built-in pseudo-sources.
- **TodoList** `[tl_]` (at most 10): `type` `microsoft`, `microsoftAccount`, `microsoftListId`, `name`, `enabled`. A
  Microsoft To Do list of a linked account (Graph `Tasks.ReadWrite`). `server/microsoftTodo.js` reads the open tasks of
  every list that is on every 5 minutes (2 after a failure; a failing list keeps its last tasks) and keeps them in
  memory; the display config gets them after the typed items in `todo.items` (`{ id: "ms_…", text, done, due?,
  important?, tick? }`, core `screens.js displayConfig todoTasks`) and an SSE / poll `todo` event when they change.
  The id is an HMAC of the account, list and task: no Graph id, account or token reaches a display. `todo.touch` is on
  where the screen shows the to-do list, its touch setting (`family.touch`) is on and it is not private; a tap goes to
  `POST /api/display/todo/toggle`, which marks the task done at Microsoft. An account linked before To Do access
  refreshes with the scopes it granted (core `refreshScopes`) and can be reconnected in place
  (`/auth/microsoft/connect?account=`).
- **IconRule**: `match` (keywords, case/accent-insensitive substring of title + description), `emoji`, `color|null`.
  First match wins.
- **LocalEvent** `[l_]`: `title`, `emoji`, `color|null`, `location`, `notes`, `allDay`, `date`, `endDate` (inclusive),
  `startTime`/`endTime` (`HH:MM`), `repeat { freq none|weekly|monthly|yearly, interval, until|null, weekdays[] }`,
  `exceptions[]`, `countdown`.
- **Birthday** `[b_]`: `name`, `month`, `day` (29/02 allowed), `year|null` (→ age), `emoji`.
- **EventRule** `[f_]`: `enabled`, `action hide|rename|style`, `match`, `matchMode contains|exact|startsWith`,
  `field title|any`, `sourceIds[]` (`[]` = all), `replaceWith`, `emoji`, `color|null`, `countdown`, `note`.
- **Countdown** `[k_]`: `title`, `emoji`, `color|null`, `date`, `yearly`.
- **ScheduledMessage** `[m_]`: `enabled`, `title`, `body`, `emoji`, `style info|success|warning|urgent`,
  `days` (0 = Sunday…6, `[]` = every day), `from`/`to` (`to < from` crosses midnight), `startDate|null`,
  `endDate|null`, `screenIds[]` (`[]` = all), `sound`.

- **Carousel** `[v_]` (only `v_` ids, never a screen's; a screen id never starts with `v_`): `enabled`, `name` (≤ 40), `slug` (never one a screen uses: that is an error, so the URL of a
  TV never changes by itself; two carousels get `-2`), `transition fade|slide|zoom|wipe|dissolve|random|none` (default `fade`), `transitionSpeed
  fast|normal|slow` (400, 800 or 1400 ms; default `normal`, also for carousels saved without it), `holdOnAlert`, `nightRotate`,
  `offScreenId|null` (`null` = the first step's screen), `schedule[]` (the privacy rule shape: `{ id, enabled, days,
  from, to }`, `[]` = always), `steps[]` (≤ 12, `{ screenId, seconds }`, 10..3600 s, a screen may come back). Steps of
  a deleted screen are dropped on save; a carousel left without steps is turned off; a deleted `offScreenId` goes
  back to `null`. New screens and imports never take a carousel's slug (an import gives a kept carousel a free one).

Validation errors are reported with paths such as `calendar.sources[2].url` or `screens[1].screen.accent`.
Older single-screen (v1) configs are migrated automatically on load; the original file is kept in `data/backups/`.

## Events pipeline

`getEvents({ from, to, screen })` (server/calendars.js) builds the events for one screen:

1. **Sources** visible on the screen (`screen.calendar.sourceIds`, `null` = all enabled + `local` + `birthdays`).
   Each remote source is fetched with its own cache (`refreshMin`); on failure the stale cache is served and the
   error is reported (`errors[]`, activity `source.error` / `source.recovered` on transitions).
2. **Expansion** of recurrences inside the window (ICS RRULE/EXDATE/overrides; local events weekly/monthly/yearly with
   `interval`, `until` and exceptions; birthdays yearly, 29/02 → 28/02 on non-leap years). Times are interpreted in
   `datetime.timezone`: the process `TZ` follows it (set at startup and updated when the setting is saved, which also
   re-parses the ICS feeds), unless `TZ` is set in the environment.
3. **Kind normalisation**: `airbnb` sources turn "Reserved" into "Reservation · <guest>" (guest name from the
   description when present), mark "Not available" ranges as blocked, keep a leading emoji from feeds that already
   format titles (`🏠 Guest - 4p+1m`) and render guest counts as icons (`4p+1m` → 🧑🏻🧑🏻🧑🏻🧑🏻 🐶; with
   `Adults/Children/Infants` (or `Adultos/Niños/Bebés`) description lines adults 🧑🏻, children 🧒🏻 and babies 👶🏻 are
   told apart). `holidays` titles from Google feeds are translated (es/pt).
4. **Event rules** (filters): every matching `hide` rule hides; `rename` rules apply in order (chained); the first
   matching `style` rule sets emoji / color / countdown flag.
5. **Decoration**: emoji priority = item emoji > style rule > emoji already in the feed title > icon rule > source
   emoji > kind default (🏠 / 🎂 / 🎉). Color priority = item color > style rule > icon rule > source color.
   ALL-CAPS titles are tidied, birthdays get `age`.
6. Sort (all-day first, then start) and a stable `hash` so displays skip re-rendering unchanged data.

**Privacy mode** is applied after the pipeline, on the display endpoints only (`displayEvents` in
`server/routes/public.js`, `privatizeEvents` in `server/core/privacy.js`): busy blocks keep time, length and the
calendar's colour, hidden calendars are dropped, and the hash changes. Countdowns from busy or hidden calendars are left
out (`computeCountdowns(..., { isPrivate })`). The admin's own lists keep the real events. See docs/API.md
*Privacy mode*.

**Countdowns** (`/api/countdowns`) merge manual countdowns, upcoming birthdays (within `birthdayDays`) and events
flagged by a local event or a style rule (nearest occurrence per title), sorted by date.

## Display behaviour

- Never visibly reloads for routine updates: events every 60 s (and on SSE `events`), weather every 10 min, news every
  15 min, photos per interval; the DOM is patched in place. Day rollover at midnight re-renders the grid.
- Offline tolerant: last data is cached in `localStorage` per screen; a small status dot appears when the server is
  unreachable; SSE reconnects automatically.
- Live mode comes from `GET /api/health`: `live: 'poll'` replaces the SSE stream with `GET /api/display/poll`. The
  answer carries the same events as commands (announcements, identify, night, reload, photos, events), the config
  revision, the screen id and the server version, so version reloads and moved devices work too. The server picks
  the delay (`next`); the heartbeat drops to every 10 min. A server without the poll endpoint (404) gets a config
  revision check every 90 s instead. No field or `'sse'` keeps the stream. `web/display/live.ts` holds one
  `dispatch` that both transports use, so every event is checked the same way.
- Raspberry Pi friendly: WebGL capped at 30 fps and `devicePixelRatio ≤ 1`, paused when hidden; `?lite=1` or
  `ambient: none` + `transition: fade` disables three.js entirely; CSS transforms/opacity only.
- Portrait photos on a landscape screen (or the other way round) with `background.portraitFit` blur (auto: Immich
  photos only) are composed on a canvas in `web/display/widgets/photos.ts`: the whole photo over a blurred, darker copy
  of itself, at the panel's size. The WebGL layer and the CSS layer (a blob URL) show that canvas like any other image,
  and the tone measure reads it, so Ken Burns, transitions and the glass tint work unchanged.
- Photos are cropped around their focal point; displays report the bands covered by the clock and weather cards in the
  heartbeat (`photoFrame`), and the crop keeps the subject in the largest free band (`web/shared/focus.ts`).
- Adaptive legibility: panel blur/shade and text contrast adapt to the photo behind them; small screens get larger
  relative type.
- Privacy mode: the display gets already filtered events and only shows a small lock (`#privacy-lock`) from
  `config.privacy`. The `privacy` live event refetches config, events, countdowns and photos; a timer at
  `privacy.next` / `privacy.until` does the same in case the event was missed. `server/privacy.js` keeps a timer for
  the next change of any screen (period ended, schedule rule started or ended) and publishes the event then.
- Announcements: animated cards (info / success / warning / urgent, ≤ 3 stacked), WebAudio chime (no audio files),
  remaining time corrected with the server clock. Scheduled messages show as a banner while their window is active.
- Doorbell (`web/display/widgets/doorbell.ts`): the `doorbell` event puts the camera full screen (z-index above the
  night layer, so it wakes a dimmed screen while it lasts), with a "Door" label, the time, a live dot, a progress bar
  and a two-tone WebAudio door chime. Frames come from a `FrameSource` that asks `GET /api/display/doorbell/frame`
  with a counter every `refreshMs` (the credential in `X-Marco-Key`, the answer turned into a blob URL), decodes the
  next picture off screen and flips two `<img>` so it never flickers; an error keeps the last picture, `404` stops
  asking. The overlay does not know whether the frame is live (self-hosted) or an uploaded snapshot. It ends at
  `expiresAt`, on `doorbell-end`, or when `hello` / a poll reset names another ring. The server side lives in
  `server/doorbell.js` (rings in memory, Home Assistant proxy with a 500 ms shared frame cache) and
  `server/core/doorbellCore.js` (validation, ring / extend / dismiss, payload).
- Widgets (`web/display/widgets/custom.ts`): images and web pages from `DisplayConfig.widgets` in a corner, in the
  side column (in their corner when the layout has none) or full screen (the `widget` layout). Reconciled by
  `id|place|v`, so config polls and preview edits never reload one. Images load off screen and replace the old one
  once loaded; a failed reload keeps it with a small "not updated" mark. Only http(s) addresses are loaded, in the
  unsaved preview too. Self-hosted TVs load the address themselves (`via: 'direct'`, LAN works); Marco Cloud serves
  saved images from `/api/display/widget/<id>` with the display key (`via: 'proxy'`, shown as blobs) and has no web
  widgets. Web pages get a sandboxed frame (`allow-scripts allow-same-origin`, no top navigation, popups, forms or
  permissions) and are never framed from the display's own origin; the server answers any framed request other than
  the admin preview with a sandboxed `403` (`server/app.js frameGuard`), so a page that sends its frame back to the
  server gets nothing. Night dimming, alerts and the doorbell cover widgets; nothing shows while private.
- Custom HTML cards (Personalizado kind `html`, self-hosted only; `web/display/widgets/canvas/html.ts`): the owner's
  HTML and CSS with `{{placeholders}}` filled from the values the card binds (Home Assistant states by alias, the
  time, the date, the weather, the next event). `server/core/cardTemplate.js` (the same file in the admin's editor,
  the validation and the display) reads the HTML with a small tokenizer and writes it out again from what it read:
  only an allowlist of elements and attributes, every value escaped, placeholders only in text and in `class`,
  `title`, `data-*` and (behind `| num`, `| pct` or `| clamp`) `style`. Anything else is a validation error that
  names it. The display checks the card again, and the filled HTML once more, before it builds the frame:
  `<iframe sandbox="" srcdoc>` with a meta CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:;
  font-src 'none'`, `pointer-events: none`, `tabindex=-1`, no referrer and no permissions. The theme comes in as CSS
  variables (`--accent`, `--ink`, `--ink-2`, `--sep`, `--fill`, `--radius`, `--font`, `--size`); Marco draws the
  card around the transparent frame. The document is rebuilt only when what it shows changes, at most every 2 s
  (30 s in lite or on a slow device; a value that arrives, a new look or a new minute shows at once), and the new
  frame replaces the old one once loaded. At most 3 per screen; Marco Cloud refuses the kind.
- The display page (`/`, `/index.html`, `/pair`, `/d/<key>`) is sent with
  `Content-Security-Policy: script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none';
  form-action 'none'; frame-ancestors 'self'` (`server/app.js displayCsp`). While some screen has a custom HTML card
  it adds `frame-src 'self'` plus the origins of the saved web widgets (worked out once per saved config), so no
  frame of the page can be sent anywhere else. Without one, frames stay open and web widgets behave as before.
- Identity: `clientId` from `?client=`, else `localStorage`, else generated. `deploy/kiosk.sh` appends
  `client=<hostname>` because the kiosk runs incognito. If the server version changes, the display reloads once.
- Access (`web/display/identity.ts`): the credential is the key in the path (`/d/<key>`), else a paired-device token
  from `localStorage` (`marco.deviceToken`). Every fetch sends it as `X-Marco-Key`; the SSE URL and same-origin
  `/media/*` photo URLs carry it as `?k=`. The first config fetch happens before cached data is shown: `401` → pairing
  screen, `403` → "This link is no longer valid" (cached data is wiped; a revoked device token is forgotten). The SSE
  `revoked` event does the same while running. Paired → the token is stored and the page reloads at `/`.
- First load (`web/display/boot.ts`, `server/core/bootstrap.js`): a private link's page (`/d/<key>`) carries what
  the display API answers first for that key, as `<script type="application/json" id="marco-boot">` (a data block,
  never run, so the CSP is unchanged). Self-hosted servers write the config and `/api/health`
  (`server/routes/public.js displayBootstrap`); Marco Cloud also writes the weather, countdowns, first photos, news
  and the events of the windows the screen is likely to ask for (`bootDataPaths`; `eventsWindow` is the same function
  the display uses for its own window). Every answer is the API's own for that key, so the privacy rules are the
  same; an unknown or revoked key, or a server that needs setup, gets the plain page. The display takes each answer
  once, for its exact request path, within a minute of the page load, and asks the server for anything else, so a
  block that does not fit only costs the requests it would have made anyway. Without a block (a paired TV, open
  mode) the config, the setup check and the weather, news, countdowns and photos requests go out together. The page
  preloads the WebGL chunks and the Latin subsets of the fonts (`scripts/vite-preload.mjs`). While the screen is not
  there after 350 ms, the clock and the date from the device's time show on the screen's background
  (`web/display/bootShell.ts`), with only the language, time zone, clock format and theme of the config it has or
  had last time. Nothing else kept from an earlier visit is drawn before the server answered.

## Carousels

A carousel shows several screens one after another on the same TV (`server/core/carousels.js`, shared with the admin
and the display through `web/shared/carousels.ts`). A display points at it like at a screen: `/?screen=<carousel slug>`
(open mode), the carousel's own private link, or a paired device bound to it. The carousel id goes where a screen id
goes (link keys, `device.screenId`, the display registry); the `v_` prefix tells them apart.

- **Sync:** the step comes from the Unix epoch (`carouselSlot`), and the display uses the server time it already
  keeps (`setServerNow`). Every TV on the same carousel shows the same step at the same moment, with no server state,
  also after a reload or over the poll channel.
- **Schedule:** inside a schedule window (or always, without one) the carousel rotates; outside it shows
  `offScreenId`. `carouselPhase` gives the screen and the next instant the answer changes (the end of the step or the
  next schedule boundary, from `nextWindowBoundary` in `core/schedules.js`, the helper privacy schedules use), so the
  display switches exactly at the boundary.
- **Night:** with `nightRotate` off, while night mode is on (by the night settings of `offScreenId`, or the night
  command) the display holds `offScreenId`, so the dimming does not change from step to step. With it on, each screen
  applies its own night settings.
- **Server:** `requestScreen` (`server/displayAccess.js`) serves a carousel's screens only: `?screen=<member>` (open
  mode adds `via=<carousel>`), else the screen the clock says. The config of a member carries `target` and the
  `carousel` block (valid steps with slug and name, the off screen resolved). Streams and pollers of a carousel are
  registered under its id with `memberIds`; `sse.matches` lets an event for any member reach them, and the
  announcement filter passes when one member that the announcement targets has alerts on (the rule of the replay on
  connect). A carousel with no screens left never borrows the default screen: its link or device reads a blank
  screen under the carousel's id (`emptyCarouselScreen`: no calendar, stock photos, no countdowns). Hello and poll resets replay the announcements and the
  doorbell of every member. The `privacy` and `doorbell` payloads carry `screenId`.
- **Display** (`web/display/carousel.ts`): keeps a bundle per screen (config, events, countdowns, photos); a few
  seconds before a switch (at most half the step) it refreshes what is old in the next one (events after a minute, a
  new config revision, a privacy boundary, a live event that marked it). A switch applies the bundle without a
  request, animated (see Switch animations below); the photo list only changes when the next screen's photo settings
  differ. Missing data keeps the current screen until the next step.
  A doorbell ring or a big announcement holds the step while `holdOnAlert` is on; then it jumps to the step the clock
  says.
- **Touch** (`web/display/nav.ts`, the *Navegación* cards of Personalizado screens and the swipe): a jump to a step
  is an offset on this display's own slot clock (`carouselPhase(..., { offset })`), so the step starts its full time
  and the loop goes on from it; `visitScreen` holds a screen that is not a step (its bundle is fetched like a step's;
  `requestScreen` serves it when a button of the carousel's screens leads there, `reachableScreens`), `pause` holds
  the step on screen, and `home` drops all three and follows the shared clock again. A display bound to one screen
  shows another one with the same bundle fetch and `showScreen`. The visit or the pause is kept only in the device's
  localStorage with its end; every touch pushes the end forward (`NavIdle`), and when it passes the device goes back
  to its own screen or carousel. Nothing is written to the server. An announcement holds it for at most a minute after it was sent (at least 15 s on screen), urgent ones too.
  Offline, the cached member bundles keep it looping; the plain caches always hold the screen on display, and an
  offline boot reads the first screen's own copy. A display bound to a plain screen never creates the
  controller and sends the same requests as before.
- **Switch animations** (`web/display/switchPlan.ts` decides, `web/display/screenSwitch.ts` runs): `transition` is
  `fade` (a true crossfade), `slide` (the new screen pushes the old one to the left), `zoom` (the old one shrinks a
  little and fades while the new one settles from 1.04 to 1), `wipe` (a soft diagonal edge sweeps left to right),
  `dissolve`, `random` or `none`; `transitionSpeed` is 400, 800 or 1400 ms.
  - Snapshot: `#app` is cloned into a fixed overlay above it (`.switch-shot`, `aria-hidden`, `inert`, no pointer
    events). Ids become `data-shot-id`; the first switch gives every stylesheet rule that uses an id a twin selector
    `:is([data-shot-id="x"],#never)` with the same specificity, so the copy looks the same. Canvases are copied with
    `drawImage`, scroll positions and the current frame of running animations are kept. With WebGL on,
    `Engine.snapshot()` draws a frame and copies the GL canvas (photo, ambient backdrop) into the overlay, so the old
    screen is opaque; without it the overlay takes the page background.
  - The new screen renders into the real `#app` at once, then both layers animate with the Web Animations API on
    transform and opacity only. For `slide` and `zoom` the GL canvas moves with `#app` and the engine keeps the panel
    rects of the new layout (`holdRects`). The wipe moves a masked shell (a soft diagonal gradient) one way and its
    content the other way, so only transforms animate.
  - `dissolve`: the GL copy goes to `gl/dissolveLayer.ts`, drawn last over the live GL frame and eaten away by fbm
    noise with a slight diagonal bias, while the content crossfades. Without WebGL it is a fade.
  - `random` picks from fade, slide, zoom, wipe and dissolve by the switch number (step starts since the epoch,
    `switchNumber`) and the carousel id: shuffled blocks of five, fixed at the block edge so two switches in a row
    never repeat. Every TV on the carousel picks the same one, with no shared state.
  - `prefers-reduced-motion`, `?lite=1`, `?lowpower=1` and low-power devices always get a light 300 ms fade:
    `#app` fades out, the new screen goes in and `#app` fades back in, with no copy of the page or of the GL frame.
    Low power is an ARM Linux user agent, Linux on ARM in the client hints (recent Chromium says `Linux x86_64` on
    ARM too), a VideoCore, V3D or Mali GPU in the WebGL renderer name, or under 2 GB of memory. A hidden tab or the
    boot fade switches without animation.
  - A switch that arrives while one runs ends it at once (animations cancelled, overlay removed, GL dissolve
    stopped); a timer removes the overlay even if an animation never reports its end. When a switch ends the
    marquee measures the titles again (during a slide they are off screen); it never looks inside the copy.
  - `Engine.snapshot()` reuses one canvas for every switch.
- **Debug:** `?step=<slug>` pins one step, `?carousel=0` stays on the first step; `?demo=1&carousel=1&stepSec=8`
  loops the demo screens (with `random`; `&planner=1` makes the first one the Planner); `&tr=<transition>` and `&trSpeed=fast|normal|slow` force an animation on
  any display. `?try=1` (the admin's *Probar* in the preview) goes to the next step every 4 s and leaves the clock;
  with `random` each of those switches takes the next animation of the sequence.

## Familia

Members (up to 6), routines (up to 80) with stars, rewards (up to 20) and the week's meals. Config in
`config.family` (validated by `sanitizeFamily` in `server/core/familyCore.js`), per screen `screens[].family`. Only
kids earn stars; a routine is `{ id, memberId, title, emoji, days ([] = every day), slot (morning | afternoon |
evening | any), points (0..20), enabled }`, a reward `{ id, title, emoji, cost (1..500) }`. Meals:
`template['0'..'6']` (0 = Sunday) and `weeks['YYYY-Www']` (ISO weeks, the newest 26 kept); a week with its own plan
uses only its own days.

- **Pure rules** (`server/core/familyCore.js`, shared with Marco Cloud): sanitizers, ISO weeks, meals of a day or a
  week, today's routines, points (`base` + ticks + adjustments - redemptions, never stored as a balance), the
  toggle / redeem / adjust / undo reducers, the 90-day prune, and what the TV and the phone get
  (`displayFamily`, `phoneFamily`, already private when the screen is).
- **Node side** (`server/family.js`): `data/family.json`, the family link key (`secrets.family`, `fk_` + 32
  characters, compared in constant time), rate limits, the activity log and the `family` live event.
- **Display** (`web/display/widgets/kids.ts`, `styles-kids.css`, every rule under `.style-modern #app.is-kids`): the
  three kids layouts. A kids preset with the Classic style falls back to `bigCalendar`; the photo and the ambient
  layer are off. The display asks for `/api/display/family` only when Familia is on and a kids layout is shown, on the
  `family` event, after config fetches, privacy changes, day changes and every 5 minutes. Taps are optimistic and kept
  on top of every answer until their own request settles. Each layout drops whole rows when space runs out (done
  routines first, then later groups folded to one line, then "+N more").
- **Phone page** (`web/family/`, `/f/<key>`): its own small Preact bundle (`vite.config.ts` input `family`). The key
  stays in the address (a home-screen shortcut keeps it) and in `localStorage` for `/f`.
- **Admin**: *Family* (`web/admin/sections/Family.tsx`) and *Meals* (`Meals.tsx`); the *Kids* style card in
  *Layout* is the Modern style with a kids preset (`styleChoiceOf`), not a stored style.

### Family access (phone dashboards)

Each person of the household can have a dashboard of their own on the phone (#16). People are not config: they live
in `secrets.json` as `familyAccess: [{ id (fp_), name, memberId, perms, createdAt, lastUsedAt, link: { hash,
createdAt } | null, devices: [{ id (fv_), name, via, hash, createdAt, lastSeenAt, lastIp }] }]`, so adding or changing
one never bumps the config revision. An export with secrets carries them (digests only, no addresses) and an import
with secrets puts them back, so the links and phones keep working on a new server; an export without secrets has none
of them.

- **Pure rules** (`server/core/familyAccessCore.js`, shared with Marco Cloud): permissions (`effectivePerms` drops
  deleted screens and never widens a message list to every screen), the requests of each action, the to-do and local
  event they add, and `memberState` (what the phone sees: the name, the controls, the screens a message may go to).
- **Credentials**: the private link carries `fa_` + 32 characters; opening it on a phone trades it for a device token
  `fd_` + 43 characters that the phone keeps in `localStorage`. A code (6 characters of the pairing alphabet, two
  minutes, single use, one per person at a time) shown on a screen through the `access-code` live event is the other
  way to get one. Only SHA-256 digests are stored; codes live in memory, and the plain code is only in the `access-code`
event to the screen for its two minutes (once used, replaced or withdrawn, a `{ clear: true, id }` event takes it off
the screen and out of the poll ring). Lookups are constant time over every stored
  digest. Every request reads the person again, so a permission taken away, a phone revoked or a person removed
  counts from the next request (the page holds no stream).
- **Actions** (`server/familyAccess.js`) go through the server's own paths: `createAnnouncement` (`via: "family"`, the
  name as title), `applyPrivacy` (every screen, `by: "family"`), `runCommand` night, and `updateConfig` with the reason
  `family` for to-dos and local events (`index.js` leaves those out of `config.saved`; `family.todo` and `family.event`
  say who added them).
- **Phone page** (`web/member/`, `/my/<link>` and `/my`): its own small Preact bundle (`vite.config.ts` input
  `member`) with only the access texts (`web/admin/i18n-dict-access.ts`). The link and the code (from the QR code's
  fragment) are taken out of the address bar at once, and so is `?lang=` (the household language that the link and the
QR code carry, so the code screen is in that language before sign-in). **Display**: `web/display/widgets/accessCode.ts` draws the code
  above the announcements. **Admin**: the *Family access* card on the *Access* tab of *Family*
  (`web/admin/components/FamilyAccess.tsx`).

## Special backgrounds

`background.rules` (#14, at most 30 per screen) swaps a screen's photos for others on some days. A rule is
`{ id, when, photos }`:

- `when`: `{ type: 'event', text, calendars }` (an event today whose title contains `text`, or any of its parts
  separated by commas, up to 120 characters, accents and case ignored; `calendars` = source ids, `[]` = the calendars the screen shows, even with its calendar
  hidden), `{ type: 'range', from, to }` (`MM-DD` to `MM-DD` every year, inclusive; `to < from` wraps the year end),
  `{ type: 'date', on }` (`MM-DD`; 29 February falls on the 28th in other years) or `{ type: 'birthday' }` (someone of
  `birthdays.items` today, with that calendar on).
- `photos`: `{ source: 'gallery', files }` (1 to 50 gallery file names) or `{ source: 'immich', albumId }`. Names that
  cannot be gallery files and calendars that no longer exist are dropped quietly; Marco Cloud refuses Immich rules.

The matching is pure (`server/core/bgRules.js`, shared with Marco Cloud). The first rule that holds wins, checked
in `datetime.timezone`; while the screen is private its events go through privacy mode first (a *busy* calendar has
no titles to match) and birthdays count only when that calendar keeps its names. `server/photoRules.js` finds the
active rule for `/api/photos`, which then serves that rule's photos (its gallery files still in rotation, or its
album, in the screen's `order`; nothing to show = the source as usual) with `rule`, a short hash of the rule. Privacy
with *hide photos* still means stock. The display config never carries the rules (`core/screens.js displayConfig`
drops them) and the display only sees the hash.

The refresher (every minute, after a calendar refresh and after a config save) calls `syncPhotoRules()`: the screens
whose active rule changed get a `photos` live event (SSE and the poll channel), so midnight, an added or removed event
and a rule edit reach the screen within a minute. The display asks for a new batch and, when `rule` changed, shows the
first photo of it at once; the photo card of *Personalizado* does the same, and a carousel counts `rule` in the
photo settings it compares between screens (`photoSigOf`). A gallery file that a rule of a screen names may be
loaded by that screen's displays even when the screen does not show the gallery (never a hidden one); the albums of
rules count as albums in use for the Immich proxy and the admin's Immich status.

## Immich source

`background.source: 'immich'` plays one or more Immich albums. Only the Marco server talks to Immich
(`server/immich.js`, pure parts in `server/core/immichCore.js`):

- **Key**: `secrets.immich.apiKey`, sent only as the `x-api-key` header. It never reaches a display, a URL or a log;
  the admin sees `{ set, hint }`. Scopes needed: `album.read`, `asset.read`, `asset.view`.
- **Versions**: `/api/server/version` (`/api/server-info/version` before 1.118), cached 10 minutes. From 1.135 an
  album's assets come from `POST /api/search/metadata { albumIds, type: 'IMAGE', withExif, size: 1000, page }`
  (pages followed with `nextPage`; one function, `searchAssets()`, holds that request shape); older servers use
  `GET /api/albums/:id?withoutAssets=false`. Images only: videos, trashed, offline, hidden and locked assets are left
  out, archived ones stay. At most 20000 assets per album.
- **Lists**: cached per album for 30 minutes (stale while revalidating, one fetch at a time), failures for 60 s,
  saved in `data/immich/albums/` and served for up to 24 h while Immich cannot be reached (a list on disk is also read
  back by the media route after a restart). An album that answers 400 or 404 (Immich's answer for a deleted album
  or one the key cannot read) is skipped and shown as not found in the admin. A new server URL or a new key forgets
  every list (a fetch still running for the old one is dropped); a new URL also empties the image cache. Changing
  the URL, *enabled*, *insecure TLS* or the key sends a live `photos` event, so displays ask for a new batch. With
  nothing to show, the screen gets stock photos.
- **Rotation**: the same picker as the gallery (`pickFrom` in `server/photos.js`), rotation key `<screen>|immich`;
  `newest` = date and time taken, `name` = original file name (never shown). Captions (`showMeta`) are the place and the date
  taken, formatted by the display in the screen's language.
- **Images**: `GET /media/immich/<assetId>` (after `mediaAuth`) serves Immich's `preview` render from
  `data/immich/cache/`, fetched on a miss (20 s timeout, 8 MB cap, JPEG, WebP, PNG or AVIF only, sniffed when Immich
  says `octet-stream`, at most 3 fetches at once, one per image). Only assets of an album a screen plays are served; a
  display key or device token only opens its own screen's albums (bound to a carousel: the albums of the carousel's
  screens), and nothing of a screen while it is private with *hide photos*. The first 3 photos of each batch are fetched ahead. `?s=thumb` serves small album covers to an admin
  session.
- **Cloud**: Marco Cloud has no Immich (`features.immich` false). `validateConfig(c, { immichAvailable: false })`
  refuses a screen with the Immich source.
- Changing the server URL drops the lists and the image cache.

## Data cards

Cripto, Deportes, Bolsa and Divisas (Personalizado kinds `market`, `sports`, `stocks`, `currency`) show numbers from
CoinGecko, ESPN's public site API, Finnhub and Frankfurter (the ECB's exchange rates). `server/core/dataCore.js` holds everything that does not touch the network (the allowed
hosts, the request paths, the readers of each answer, the refresh policy, the shared cache with its per-host gate and
the projection a screen gets), so Marco Cloud runs the same code with its own `call`. `server/dataFeeds.js` gives it a
fetch that only reaches those hosts, refuses redirects, caps the size and times out. Screens ask
`GET /api/display/data` every minute and draw the cards with textContent and hand-written SVG
(`web/display/widgets/canvas/data.ts`); crests come through `GET /api/display/data/crest/:token`. The demo works its
numbers out from `server/core/dataFake.js` with the same code. The Currency widget (`config.widgets` type `currency`)
draws the Divisas card in a corner, the side column or the whole screen (`web/display/widgets/currency.ts`, the same
adapter) from `GET /api/display/currency`, which reads the same cache entries. Details and limits: docs/API.md, Data
cards and Exchange rates.

## Now playing

What a linked Spotify account plays now (issue #18): the *Sonando ahora* card of Personalizado (kind `nowplaying`) and
the line under the clock of the other layouts (`screen.nowPlaying`). Endpoints and data shapes: docs/API.md, *Now
playing*.

- **Provider abstraction**: `server/core/nowPlayingCore.js` holds everything that does not touch the network: the
  provider's endpoints and scopes, the authorize URL, the Redirect URI rules, the mapping of its answer to
  `{ provider, kind, title, artist, album, artUrl, progress, duration }`, the refresh policy of one account's entry
  (`nextEntry`), what a display gets (`displayItem`), the cover tokens and the accounts a screen shows
  (`nowPlayingAccounts`, in canvasCore). Spotify is the only provider today (`NOW_PLAYING_PROVIDERS`); another one
  adds its own mapping and account prefix there and its HTTP part in each server.
- **The household's own app**: Client ID and Client Secret in `secrets.json` (Marco Cloud: sealed in D1). The admin
  only learns that a secret is stored. Each account has a random id; displays and configs only ever hold that id.
- **Connect**: authorization code with PKCE, the state in the admin's session. Spotify accepts https Redirect URIs and
  `http://127.0.0.1` (never "localhost"): a self-hosted server on plain http in the home network registers
  `http://127.0.0.1:<port>/auth/spotify/callback`, the browser ends on a page that does not load, and the owner pastes
  that address into the admin (`POST /api/admin/spotify/finish`).
- **Reading** (`server/nowPlaying.js`): on a display's demand only (`GET /api/display/nowplaying`), one entry per
  account for every screen; Spotify is asked at most every 10 s while something plays and 20 s while nothing does,
  just after the track ends when that is sooner, never during a `Retry-After`, and less often after failures (30 s up
  to 5 minutes). No display showing an account means no call for it.
- **Display** (`web/display/nowPlayingFeed.ts`): asks while a card or the line is on screen and the page is visible,
  when the server says (`next`), draws again only when the track changes, and moves the thin progress bar by itself
  each second in between. When the server stops answering, the last track goes after the same 2 minutes the
  server keeps it (sooner when it is well past its end). Covers come from `GET /api/display/nowplaying/art/:token` as blobs (the display CSP is
  unchanged and no third-party address reaches a screen); a cover is let go when its track leaves. The card
  (`widgets/canvas/nowPlaying.ts`) uses the Home Assistant media card's look without controls and credits Spotify in
  small type; the line (`widgets/nowPlayingLine.ts`) is a pill like the highlights above it. Both vanish when nothing
  plays; privacy mode hides both.
- **Marco Cloud**: the same core; credentials and refresh tokens sealed per household in D1, the entry of each account
  in the Cache API for about 10 s (shared by the household's screens), no cron.

## Display access

`config.security.displayAccess` (`private` | `open`) decides who may read the display API
(`server/displayAccess.js`):

| Request carries | private | open |
|---|---|---|
| a valid display key (UUIDv4) | the key's screen | the key's screen |
| a valid device token (`md_…`) | the device's screen | the device's screen |
| an unknown / revoked key or token | `403 invalid_key` | `403 invalid_key` |
| an admin session cookie | any screen (`?screen=`) | any screen |
| nothing | `401 key_required` | `?screen=`; the default screen only on this machine |

Without a credential (admin session, open mode) a `?screen=` that names no screen or carousel answers
`404 screen_not_found` on every display endpoint (`displayAccess.js` `unknownScreenRequest`, applied by `displayAuth`
and `mediaAuth`); only an absent or empty `?screen=` means the default screen, and in open mode only for this
machine (loopback after `trust proxy`, not through an untrusted proxy; `bareScreenRequest`): from another machine the
bare address gets the same 404 and the display says "Open a screen's link". `/api/news` and `/media/*` never name a
screen and are exempt. A stream opened with no screen from another machine (an admin session while private) reloads
when the mode switches to open. A stream or poll for an unknown screen
is never registered (no display under the default screen, no live events). When a config save leaves a connected
stream's `?screen=` naming nothing, `reresolveClients` sends it `reload` and closes it; the display reloads and shows
the "Screen not found" page (`web/display/widgets/screenMissing.ts`), which asks for the config again every 60 s and
starts normally once the screen exists. A credential's own screen always wins over `?screen=`.

- A credential always decides the screen; `?screen=` is ignored with it. `/media/*` follows the same rules (in open
  mode keyless media stays LAN-only). A gallery file is served to a display only when a screen its credential may
  read (its screen, its carousel's screens, every screen in open mode) shows the gallery (`gallery` or `mixed`) or has a
  special background rule with that file, and is not private with *hide photos*, and only when the photo is not hidden; anything else answers the same `404` as a
  missing file. Thumbnails (`/media/thumbs/*`) are for an admin session only. Hidden file names go only to displays
  that show the gallery (the `photos` event of the others has no `hidden` list). `/api/health`, `/api/setup/*`, `/api/pair/*` and the webhooks are outside it.
- A key or device bound to a carousel reads the carousel's screens and no other (see [Carousels](#carousels)); when
  the carousel is deleted its key is dropped and its paired devices are revoked.
- Keys: one per screen (and per carousel) in `secrets.displayKeys`, created with the screen, dropped when the screen is deleted,
  replaced by *Regenerate link* (SSE clients that used the old key get `revoked` and are closed).
- Pairing (`server/pairing.js`, memory only): `POST /api/pair/start` → `{ sessionId, code }`; the display polls
  `POST /api/pair/status` with the secret `sessionId`; an admin claims the 6-character code
  (`POST /api/admin/pair/claim`) for a screen in two steps (the first only answers which display is waiting, the
  owner confirms, the second pairs) → a device with a random 256-bit token is created (only its hash is
  stored) and handed to the polling display once. Codes live 10 minutes, are single use and claimable only while the
  display polled in the last 15 s. Devices of a deleted screen are revoked (never moved to another screen). An
  address keeps at most 5 codes waiting (a newer one replaces its oldest), and a full table first drops codes whose
  display stopped polling, then the oldest code of the address holding the most.
- New installs start `private`; a stored config without `security` (saved by 0.2 or older) is migrated to `open` on
  load, and a save without `security` (old admin build, old backup or export) keeps the current mode. Restores and
  imports always keep the current mode (it is owned by the running install, not by a file).
- Live streams: each SSE client stores how it got in (`access.via`, screen, device id, a sha256 of its key or token,
  and for admin sessions the request + a per-login `sid`). `revalidateStreams()` re-checks them after every config
  save, import with secrets, session-epoch rotation (`authEvents`) and on each heartbeat; a plain logout closes the
  streams with that login's `sid`. Closed clients are removed from the registry before `res.end()`
  (`sse.dropClient`), so a broadcast in the same tick never writes to an ended response.
- A keyless display on the pairing screen probes `/api/display/config` every 30 s and reloads once it is allowed again
  (display access switched back to open).

## Admin panel

- Draft model: the full `StoredConfig` is edited locally and saved with `PUT /api/admin/config`; per-screen pages edit
  the screen chosen in the header switcher ("Editing: Living room ▾").
- Navigation groups: Home (dashboard) · Screen (layout, background, settings, date & time, per screen) · Content
  (calendars, local events, birthdays, filters, icons, countdowns, weather, news, to-do, message) · Alerts ·
  Integrations (photos, Home Assistant, API & webhooks) · System (screens, connected displays, backups, activity,
  security, status).
- Command palette (Ctrl/Cmd+K or `/`): pages, individual settings, screens and actions.
- Photo pipeline in the browser (`web/admin/photoTools.ts`): EXIF rotation, resize to ≤ 2560 px JPEG, 480 px
  thumbnail, HEIC decoding through a lazily loaded chunk, automatic focal point (spectral saliency + skin tones,
  `web/admin/saliency.ts`). The server never decodes images, but it rewrites every gallery upload and thumbnail
  without its metadata (location, camera, dates, comments; the EXIF orientation is kept: `cleanImage` in
  `server/photos.js`) and refuses files that do not parse as JPEG, PNG or WebP. Photos stored by older versions are
  cleaned once at startup (`cleanStoredPhotos`, keeping their date and focal point).
- i18n: Spanish strings are the keys; English and Portuguese live in `web/admin/i18n-dict*.ts`, Dutch, Danish and
  Polish in `web/admin/i18n-dict-nl.ts`, `i18n-dict-da.ts` and `i18n-dict-pl.ts` (one object per language keyed by
  the Spanish string; the Familia rows sit in `i18n-dict-family.ts` so the family page stays small). A missing Dutch,
  Danish or Polish value falls back to English. The first visit follows the browser language. Count strings have a
  singular form (`i18n-plural.ts` and each language's singular table); Polish also has a "few" form for 2-4, 22-24…
  (`PL_FEW`, picked with `Intl.PluralRules`), and the display's Polish dictionary does the same with `key_few`
  twins. Polish dates put the month in the genitive after a day ("12 października"). Search and keyword matching
  fold case, accents and `ł` (so "pilka" finds "piłka").

## Security model

See [SECURITY.md](../SECURITY.md). In short: the display API needs a private-link key, a paired-device token or an
admin session (open mode: unauthenticated, LAN) and never returns URLs/tokens; the admin uses a session cookie (`SameSite=Lax`) plus a JSON content-type CSRF guard on mutating routes;
webhooks use hashed bearer tokens with rate limiting; uploaded file names are sanitised. Network trust lives in
`server/lib/net.js`: the Host allowlist (DNS rebinding), `isLanClient` (private address, not relayed by an untrusted
proxy, not the container gateway in strict mode) used by the setup wizard, the weak-`ADMIN_PASSWORD` rule and the
photo routes, and the outbound address filter used by the unauthenticated setup ICS test.

## Installer and releases

`install.sh` at the repository root is the only installer; `deploy/install.sh` calls it with `--source <checkout>`.

- **Release installs** (default): `<dir>/releases/<version>/` holds an extracted release tarball with its
  `node_modules` (`npm ci --omit=dev`), `<dir>/current` is a symlink to the running one, `<dir>/data/` and `<dir>/.env`
  are shared (each release links to them as `data` and `.env`). `<dir>` is `~/marco` for a normal user (the installer
  uses sudo for the system parts) and `/opt/marco` when run as root (service user: `$SUDO_USER`, or a system user
  `marco` for a server-only install).
- **Updates** (`marco update`, or the installer again) download the newest `marco-<version>.tar.gz`, check it against
  its `.sha256`, prepare it next to the running one, swap `current` (rename of a new symlink), restart and wait for
  `/api/health`. If the new version does not answer within 45 s, `current` goes back to the previous release (kept on
  disk) and the service restarts. Older releases are removed. Data is never touched. The `marco` command and the
  stored installer are replaced only after the new version answers, so a rollback keeps the previous copies.
  An update never installs an older version than the running one (`--force` allows it), and an install made from a
  release stops with an error when GitHub does not say which release is the latest, instead of building from git.
- **No release yet**: the installer clones the repository (`--version x.y.z` clones the tag `vx.y.z`), runs `npm ci`,
  `npm run build` and `npm prune --omit=dev`, then continues as above. When the clone is the commit already running,
  it says so and stops (`--force` rebuilds).
- **Checkout installs** (made with `git clone` + `deploy/install.sh`): updated in place with `git pull --ff-only`,
  `npm ci` and `npm run build`; data stays in `<checkout>/data`.
- **Updates from the admin** (release installs): see *Updates* below. The units are written by the installer from its
  own text (never from files in the install folder, which belongs to the service user), on install and on every
  update, also when the version is already up to date; `--uninstall` and a switch to a checkout remove them. The
  files that run as root (`marco`, the stored installer, `marco.service`) are copied out of the release package
  right after its checksum is checked, before the release folder is handed to the service user, and they replace
  the old ones by rename (a running `marco update` keeps reading its own copy).
- `/etc/marco.conf` records mode, layout, folder and user for the `marco` command (`deploy/marco`, installed to
  `/usr/local/bin/marco`); the installer keeps a copy of itself in `/usr/local/lib/marco/install.sh` for
  `marco update` and `marco uninstall`.
- **Release tarball** (`scripts/package-release.sh`, run by `.github/workflows/release.yml` on `v*` tags after tests and
  the build): `server/` (without tests), `dist/`, `deploy/`, `install.sh`, `package.json`, `package-lock.json`,
  `.env.example` and the license files. The release notes are the version's CHANGELOG
  section (`scripts/release-notes.js`). The release also carries `install.sh` and `install.sh.sha256`, so the
  installer can be checked before it runs (`releases/latest/download/install.sh`).
- **Demo video**: `marco-demo.mp4` (about 15 MB) is too big for the repository. It lives in a fixed pre-release
  tagged `media`, created once with
  `gh release create media marco-demo.mp4 --prerelease --title "Media" --notes "Files linked from the README"`
  (a pre-release, so `releases/latest` keeps pointing at the newest version). The READMEs link to
  `releases/download/media/marco-demo.mp4`, which does not change from one release to the next. The release
  workflow also copies the video into each version's release when the `media` release has it. The animated preview and the screenshots live in `docs/media/` and
  `docs/screenshots/` (WebP).
- Testing hooks (not for normal use): `--tarball-url <url>` or `MARCO_TARBALL_URL` installs a given tarball (its
  `.sha256` must sit next to it), `MARCO_REPO_URL` changes the git source.

## Updates

- **Check** (`server/updates.js`): once a day (first 1 to 3 minutes after start, then a 15 minute timer that only uses
  the network when a day has passed, 6 hours after a failure) one `GET` to
  `https://api.github.com/repos/mr-reb00t/marco/releases/latest` with `User-Agent: Marco` and the stored ETag
  (`If-None-Match`). Drafts and pre-releases are ignored, the notes are the release body without its install
  instructions. Off with `MARCO_UPDATE_CHECK=0` or the admin switch (`data/update/settings.json`). Testing only:
  `MARCO_UPDATE_URL` points the check at another URL that answers like that API.
- **Install type** (`detectInstall`): `/etc/marco.conf` with `MARCO_LAYOUT=release` and the running code under
  `<dir>/releases/` is a release install, and the button works when `/etc/systemd/system/marco-update.path` exists
  and `DATA_DIR` is `<dir>/data`; the Docker image sets `MARCO_INSTALL=docker`; a `.git` folder is a checkout. The
  admin shows the button for the first and the commands for the others.
- **Request**: `POST /api/admin/update/apply` (or the automatic update inside its window) writes `data/update/request`
  and `status.json` (`requested`). `marco-update.path` (`PathExists=`) starts `marco-update.service` (oneshot, root),
  which runs `marco update --requested`: it removes the request, writes `running`, runs the installer
  (`--update --yes`) with its output going to `data/update/update.log`, and writes `done`, `current` or `failed`
  (`rolledBack` when the previous version is running again). Everything in `data/update/` is written as the service
  user. A request no service picks up within 2 minutes is reported as `stalled`.
- **After the update** the installer restarts the server. Displays reload when the `serverVersion` of the stream's
  `hello` (or of a poll answer) differs from their build; the admin polls `GET /api/admin/update` every 2.5 s while
  an update runs and reloads itself once the server reports a newer version. The new server records the outcome in
  the activity log (`update.finished` / `update.failed`) the first time it reads it.
- **Automatic updates** (off by default): when on, the timer requests an update inside the `from`/`to` window (time
  zone of *Date & time*, may cross midnight) once a newer version is known. A version that failed is not retried.
- **Marco Cloud** (`runtime: 'workers'`, `features.updates: false`) has no banner; the admin build carries the
  CHANGELOG section of its version (`__APP_NOTES__`, a separate chunk) and shows it once per browser after a newer
  version (`components/Updates.tsx` `WhatsNewHost`).
- **Testing the whole flow**: `MARCO_RELEASES_URL` (installer and `marco`, from `/etc/marco.conf` only) points at a
  server that answers like GitHub releases (`<url>/latest` redirects to `<url>/tag/v<x.y.z>`, packages at
  `<url>/download/v<x.y.z>/marco-<x.y.z>.tar.gz`).
