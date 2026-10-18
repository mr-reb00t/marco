# HTTP API

All endpoints speak JSON. TypeScript types for every request and response live in
[`web/shared/types.ts`](../web/shared/types.ts). See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model.

- **Display endpoints** need the screen's **display key** (private link), a **paired-device token** or an admin
  session, unless display access is set to *open* (legacy LAN mode). See [Display access](#display-access). They
  never return calendar URLs, Google accounts, tokens or Home Assistant credentials.
- **Admin endpoints** need a session cookie (log in with `POST /api/auth/login`). Mutating requests must send
  `Content-Type: application/json` (CSRF guard; photo uploads are the multipart exception and need an
  `X-Requested-With` header). A request with `Origin: null` is refused.
- **Webhooks** need `Authorization: Bearer <token>` (create tokens in *Admin → API & webhooks*).

Without a key or device token, every display endpoint accepts `?screen=<slug|id>` (case-insensitive; a carousel's
slug or id too). Absent or empty → default screen, but in open mode only for this machine (`127.0.0.0/8` or `::1` after
`trust proxy`, not relayed by an untrusted proxy: an all-in-one kiosk on `http://localhost:PORT/`); from another
machine it is the same 404 as an unknown slug (`/api/news`, the heartbeat and `/media/*` are exempt, and a heartbeat
with no `screen` from another machine is not listed). Unknown (or given twice) → `404 { error: "screen_not_found", code:
"screen_not_found" }` on every display endpoint (`/api/display/*` including poll, heartbeat and the doorbell frame,
`/api/events`, `/api/weather`, `/api/news`, `/api/photos`, `/api/countdowns`, `/api/stream` and `/media/*`), never the
default screen's data, and the body names no screen. An unknown screen's stream or poll is not registered as a display
and gets no live events; a heartbeat whose `screen` names nothing answers the same 404. With a key or device token the
screen is the one bound to it and `?screen=` is ignored, unknown or not. The display shows a plain "Screen not found"
page for it (no data, no list of screens) and asks again every minute.

## Display access

`config.security.displayAccess` is `"private"` (default for new installs) or `"open"` (installs upgraded from 0.2 keep
it until you switch in *Security*).

**Credentials:** send one of them with every display request:

| Credential | Format | Where it comes from |
|---|---|---|
| Display key | UUIDv4, e.g. `3f6c0a52-9d1e-4b7a-a2c4-0e5b8f1d2c37` (case-insensitive) | The screen's private link `/d/<key>` (*Screen → Settings → Private link*) |
| Device token | `md_` + 43 base64url characters (256 bits) | Pairing (below); stored by the display in `localStorage` |
| Admin session | `cs_session` cookie | Logged-in admin (preview iframe and *View screen* in open mode, which use `/?screen=`; in private mode they use the private link) |

Header `X-Marco-Key: <key or token>` for `fetch`; `?k=<key or token>` is accepted only by `/api/stream` (EventSource
cannot send headers) and `/media/*` (images). Keys and tokens are compared in constant time and never logged.

| Situation | Response |
|---|---|
| private mode, no credential, no session | `401 { error, code: "key_required" }` |
| unknown / regenerated key, revoked device token (any mode, also with a session) | `403 { error, code: "invalid_key" }` |
| open mode, no credential | as before 0.3 (no authentication; `/media/*` only for LAN clients or a session, else `404`) |

Display responses carry `Cache-Control: private, no-store`; every response carries `Referrer-Policy: no-referrer`.
`GET /d/<key>` serves the display page (`Cache-Control: private, no-store`, `X-Robots-Tag: noindex`); the page reads
the key from its path. `GET /pair` serves the display page in pairing mode.

**Pairing** (no authentication for the display side; rate-limited):

| Method & path | Notes |
|---|---|
| `POST /api/pair/start` | `{}` → `PairStartResponse` `{ sessionId, code, expiresAt, pollMs }`. `sessionId`: 32 random bytes (base64url), known only to this display; `code`: 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, unique among pending codes, valid 10 min. `429` after 10 starts per IPv4 address / IPv6 /64 in 10 min; `503` with 100 pending codes |
| `POST /api/pair/status` | `{ sessionId }` → `{ status: "waiting", code, expiresAt }` · `{ status: "paired", token, screen: { id, slug, name }, device: { id, name } }` (exactly once, then the session is gone) · `404 { status: "expired" }`. Poll every `pollMs` (2 s): a code can only be claimed while its display polled within the last 15 s |
| `POST /api/admin/pair/claim` | Admin session. Two steps. `{ code, screenId, name? }` (code case-insensitive, spaces/dashes ignored) only finds the waiting display and answers `{ confirm: { where, screenId, screenName } }` (`where`: the display's address as this server saw it, `"localhost"` on the server itself, `""` when unknown); nothing is paired yet. The admin shows it and sends the same body with `confirm: true` → `{ device: PairedDevice }`. Marco Cloud answers the same shape, with `where` = city and country. `404 { code: "invalid_code" }` unknown / expired / already used / display not waiting; `400 { code: "unknown_screen" }`; `429 { code: "rate_limited" }` after 10 wrong codes per admin session + address, or 50 wrong codes overall, in 10 minutes (then even a right code waits). Read the error code as `code`, else `error` (Marco Cloud sends `{ error: "invalid_code" }`) |

The admin's QR on the pairing screen opens `/admin/#pair=<code>`, which opens the *Pair a screen* dialog prefilled.
The pairing screen reads `pairCodeLength` from `/api/health` and says where to open the admin: this page's
`<host>/admin`, the first of `lanAddresses` when it was opened on `localhost` (a kiosk on the server itself), or
`adminOrigin` when the server sets it. Once paired, a display opened at `/pair` stays on `/pair`; a dead private link
continues at `/` (at `/pair` when `edition` is not `'self-hosted'`).

**Links and devices** (admin session):

| Method & path | Notes |
|---|---|
| `GET /api/admin/display-links` | `{ mode, links: [{ screenId, slug, name, key, path: "/d/<key>", createdAt }], lanAddresses, publicUrl }` (keys are created for screens that have none; `lanAddresses` = this server's LAN IPv4 addresses, `publicUrl` = `PUBLIC_URL` unless it is localhost; the admin uses them for links, QR codes and kiosk commands when opened on `localhost`) |
| `POST /api/admin/display-links/:screenId/regenerate` | New key → `{ link }`. The old key stops working at once; SSE clients that used it get `revoked { code: "invalid_key" }` and are closed |
| `GET /api/admin/devices` | `{ mode, devices: PairedDevice[] }`, each `{ id, name, prefix, screenId, screenSlug, screenName, createdAt, lastSeenAt, lastIp, userAgent, connected, clientIds }` (never the token or its hash) |
| `PATCH /api/admin/devices/:id` | `{ name?, screenId? }` → `{ device }` (moving to another screen sends `reload` to the device's streams and closes them; they reconnect bound to the new screen) |
| `DELETE /api/admin/devices/:id` | Revoke: the token stops working; connected streams get `revoked` and are closed |

Saving the config with `security.displayAccess` switched from `open` to `private` sends `revoked
{ code: "key_required" }` to every display that was connected without a key (they show the pairing code). A config
saved without `security` (old admin builds, backups or exports from before 0.3) keeps the current mode.

## Display API

| Method & path | Response |
|---|---|
| `GET /api/health` | `HealthResponse`: `{ ok, uptime, version, live, edition, tenancy, runtime, pairCodeLength, features, limits?, displayOrigin?, adminOrigin?, lanAddresses? }` (see below). `live` is `'sse'` unless `MARCO_LIVE=poll` is set. A server that answers `'poll'` gets no `/api/stream` connection: the display polls `GET /api/display/poll` instead (see below). A server that answers `404` there gets a config check every 90 s, which refetches events and countdowns when `revision` changes. A missing field means `'sse'` |
| `GET /api/display/config?screen=&via=` | `DisplayConfig`: flat view of one screen; `calendar.sources` only as `{ id, name, color, emoji, kind }`; enabled `schedules` for this screen; `privacy: { active, until, lock, next }` (see [Privacy mode](#privacy-mode); while active with *hide photos*, `background.source` is `"stock"`); `target: { id, kind: "screen" \| "carousel", slug, name }` (what the display is bound to) and `carousel` (`null`, or `{ id, slug, name, enabled, transition, transitionSpeed, holdOnAlert, nightRotate, offScreenId, schedule[], steps: [{ screenId, slug, name, seconds }] }`). For a carousel (`?screen=<carousel slug>`, or a key or device bound to one) the answer is the screen the carousel shows now, or `?screen=<member id or slug>`; a screen outside the carousel is never served, except one its screens' *Ir a pantalla* cards lead to (see *Navigation* under [Carousels](#carousels)). A key or device bound to a plain screen gets that screen, or `?screen=` when one of its *Ir a pantalla* cards leads there. In open mode a display asks for a member with `?screen=<member>&via=<carousel slug>`. See [Carousels](#carousels). `calendar.weeks` is a number (1 to 8) or `"auto"` (the display picks 2 to 6 rows so each day fits `maxEventsPerDay` events); `calendar.eventStyle` is `"lines"` (default) or `"cards"`; `calendar.agendaDays` is `"auto"` (default) or `7`, `14`, `30` (how far the agenda view looks ahead) |
| `GET /api/events?screen=&from=YYYY-MM-DD&to=YYYY-MM-DD` | `{ generatedAt, hash, events: CalEvent[], errors: [{ sourceId, message }] }`. While the screen is private, events are already filtered (busy blocks, hidden calendars) and `hash` starts with `p` |
| `GET /api/weather?screen=` | `{ updatedAt, locationName, current, today, daily[], hourly[], indoor, source }` (localized descriptions). `source` = `{ provider, name, model, modelName, url, licence, licenceUrl, also? }`: where the data comes from, for the credit line. Values a source does not give are `null` (MET Norway: no chance of rain outside the Nordics; some Open-Meteo models: no UV). Cached per place for at least 10 minutes (15 for Pirate Weather, MET Norway's `Expires` when longer), the last answer is kept for 6 hours when the source fails. Since 0.17 the answer is for the screen's own place (`screens[].weather.place`, the household's when it is `null`), with `placeKey` (rounded coordinates, `"41.15,-8.61"`) and `places`: the other places the screen's Personalizado cards show (a weather card with its own `place`, every place of a `weather.cities` card), by `placeKey`, each a full answer of this shape; a place whose source fails is left out. A screen shows its own place and at most 8 others; the whole config at most 32. One forecast per place is fetched for every screen, card and language that shows it, and the forecasts of places no screen shows any more are dropped. Home Assistant's current conditions and indoor sensors only go with the household's place |
| `GET /api/news` | `{ updatedAt, items: [{ id, title, summary, source, date, image? }] }` (cache 15 min) |
| `GET /api/photos?screen=&count=20&after=` | `{ photos: [{ url, author?, title?, source: "stock"\|"gallery"\|"immich", file?, focusX?, focusY?, id?, takenAt?, place? }] }`. Immich photos (`background.source: "immich"`) have `id` (asset id), `takenAt` (`YYYY-MM-DD`, local date taken) and `place` (`"City, Country"`) and their `url` is `/media/immich/<id>?v=`; `after` may be an Immich `id` too, and with no Immich photo to show (not set up, no albums, unreachable with nothing cached) the answer is stock photos. Gallery photos follow the screen's `background.order` (`random` \| `newest` \| `name`); hidden photos are never returned. `after` = gallery `file` the display showed last: sequential orders continue right after it (wrapping around), `random` avoids starting with it. Without `after`, the server remembers where the previous batch for that screen ended. Falls back to stock when no gallery photo is in rotation |
| `GET /api/countdowns?screen=` | `{ generatedAt, today, hash, items: [{ id, title, emoji, color, date, days, origin, age? }] }`. An admin session is still accepted here in 0.5 for admin pages loaded before the update; the admin itself uses `GET /api/admin/countdowns` |
| `POST /api/display/heartbeat` | Body `DisplayHeartbeat` (≤ 4 kB: clientId, screen, version, resolution, dpr, webgl, night state, photo frame…) → `HeartbeatResponse` |
| `GET /api/stream?screen=&client=&k=` | Server-Sent Events, see below |
| `GET /api/display/poll?screen=&client=&cursor=&rev=&hidden=&preview=` | `PollResponse`: the same events as commands, for displays without a stream. See below |
| `GET /api/display/doorbell/frame?n=` | The doorbell camera picture for this display's screen (`image/jpeg`, `image/png`, `image/webp` or `image/gif`, `Cache-Control: private, no-store`), only while that screen rings. `n` is a counter the display adds so nothing caches it. `404 { code: "no_ring" }` when the screen is not ringing (also for open display access from outside the LAN), `404 { code: "no_camera" }` when the ring has no camera, `503 { code: "homeassistant_off" }`, `502 { code: "camera_unavailable" }` (Home Assistant failed, took more than 6 s, answered something that is not an image or more than 4 MB). See [Doorbell camera](#doorbell-camera) |
| `GET /api/display/ha?screen=` | `HaSnapshot` of a Personalizado screen's Home Assistant cards: `{ rev, conn: "ok" \| "down", full: true, screenId, states }`, `states` keyed by alias `<itemId>:<n>` (an entity id, a Home Assistant URL or an `entity_picture` never reaches a display). Each state is a slim view of one entity (`d`: light, switch, climate, cover, media, sensor, binary, scene, lock, alarm, other or unavailable; `n` its name; `at` when it last changed, ms; `c` the controls the card offers on a screen that allows touch, empty otherwise; `cf: true` when they need two taps). `{}` while the screen is private. `Cache-Control: no-store`. Displays on the poll channel ask every 10 s while a Home Assistant card is on screen |
| `GET /api/display/ha/history/<itemId>` | `{ period, series: [{ label, unit, points: [[ms, value]] }] }` for a chart item (`1h`, `6h`, `24h` from the recorder history, `7d` from hourly statistics) or a sensor item with its curve (24 h). At most 200 points per series. Cached 2 min (15 min for 7 days) and shared by every screen. `404` for an item that is not one of these on this screen, `403 { error: "private" }`, `503 { error: "ha_off" }`, `502 { error: "ha_error" }` |
| `POST /api/display/ha/action` | A tap on a Home Assistant control: `{ item, slot, control, value?, seq, confirm? }` (JSON, 2 KB at most). Answers `{ ok: true, seq }` or `{ ok: false, error, seq }`; see *Controls on a touch screen* under Home Assistant for every check and error |
| `GET /api/display/ha/art/<itemId>` | The cover art of a media item: fetched only from Home Assistant's own `/api/media_player_proxy/<entity>` (an absolute `entity_picture` on another host is never fetched), JPEG, PNG, WebP or GIF up to 1 MB, cached 5 min, `Cache-Control: private, no-store`. Home network only by default, like the camera pictures (`403 { error: "lan_only" }`). `404 { error: "no_art" }`, `403`, `502` as above |
| `GET /api/display/ha/camera/<itemId>?n=` | One picture of a Cámara card, through Home Assistant's own `/api/camera_proxy/<entity>` (built from the card's camera entity, never from an `entity_picture`). One picture per camera is shared by every screen (and the doorbell) for 500 ms, and requests that arrive together share one fetch. JPEG, PNG, WebP or GIF up to 4 MB only, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`. `403 { error: "lan_only" }` for a request that does not come straight from the home network (see *Cameras* under Home Assistant), `404` for an item that is not a camera of this screen, `404 { error: "hidden" }` while its `showWhen` sensor is off, `403 { error: "private" }`, `503 { error: "ha_off" }`, `502 { error: "camera_unavailable" }` |
| `GET /api/display/ha/camera/<itemId>/live` | The live picture of a Cámara card set to *En directo*: `multipart/x-mixed-replace; boundary=marcoframe`, each part with its `Content-Type` and `Content-Length`. The same rules as a picture, plus: never for an admin session (`403 { error: "preview" }`), `404 { error: "not_live" }` for a card that is not live, `503 { error: "busy" }` when the server already streams 4 cameras or has 8 viewers, or when this display already has 2 live pictures open. Ends after 10 minutes (the display opens it again), when the camera stops sending for 15 s, or as soon as the card may not show it any more |
| `GET /api/display/values?screen=` | `ValuesSnapshot` of the values pushed by `POST /api/hooks/values` that this screen shows: `{ rev, full: true, screenId, values: { <key>: { v, u?, l?, at } \| null } }`. Only the keys of its Valor cards and of custom cards bound to a key (hidden items left out); `null` when the server has no value for a key. `v` is a number, a string or `true`/`false`, `u` the unit, `l` the label, `at` when it was stored (ms). `{}` while the screen is private. `Cache-Control: no-store`. Displays on the poll channel ask every 30 s while such a card is on screen and the page is visible |
| `GET /api/display/data?screen=` | `{ items: { <itemId>: DataItemData } }`: the numbers of this screen's data cards (Cripto, Deportes, Bolsa; see [Data cards](#data-cards)), worked out from this server's cache, never fetched by the display. Hidden items and items a condition hides now are left out. `403 { error: 'private' }` while the screen is private. `Cache-Control: no-store`. Displays ask every minute while such a card is on screen and the page is visible |
| `GET /api/display/data/crest/<token>` | A team crest a data answer named by token (PNG, JPEG or WebP, 256 KB at most, `Cache-Control: private, max-age=86400`, `nosniff`), fetched by this server from ESPN's image host and kept a day. `404` for a token the server never handed out; `403` while the screen is private |
| `GET /media/photos/<file>`, `GET /media/thumbs/<file>` | Gallery images (a display: only photos in the rotation of a screen it may read that shows the gallery and is not private with *hide photos*) and thumbnails (admin session only) |
| `GET /media/immich/<assetId>?v=` | Immich preview image, proxied with the server's API key and cached on disk (`Cache-Control: private, max-age=2592000`). `404` for an id that is not in an album some screen plays (a display key or device token: its own screen's albums only), and while that screen is private with *hide photos*; `503` when Immich is not set up; `502` when Immich fails or answers something that is not an image of up to 8 MB. `?s=thumb`: album cover thumbnail, admin session only |

### Capabilities in `/api/health`

The admin and the display read these fields to decide which sections, actions and limits apply.

- `edition`: `'self-hosted'` here. `tenancy`: `'single'`. `runtime`: `'node'`.
- `pairCodeLength`: characters in the pairing code a TV shows (`6`).
- `features`: one boolean per feature: `homeassistant`, `news`, `customCss`, `gallery`, `schedules`,
  `announcements`, `displayCommands`, `openDisplayAccess`, `insecureTls`, `googleCalendar`, `googleLogin`,
  `passwordLogin`, `apiTokens`, `webhooks`, `backups`, `importExport`, `includeSecrets`, `activity`, `setupWizard`,
  `status`, `accountMenu`, `microsoftCalendar`, `updates`, `feedback`, `privacy`, `doorbell`, `doorbellLive`,
  `carousels`, `immich`, `family`, `widgets`, `webWidgets`, `priceWidgets`, `familyPhotos`, `twoFactor`, `accountSettings`,
  `screenBuilder`, `valueHooks` (`/api/hooks/values` and the Valor card), `tokenScopes` (scopes on API tokens),
  `stockQuotes` (the Bolsa card can get quotes; Marco Cloud only when the service has a Finnhub key). A self-hosted server turns all of them on, except
  `googleCalendar` and `googleLogin` (on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set),
  `microsoftCalendar` (Outlook and Microsoft 365 calendars, on when `MICROSOFT_CLIENT_ID` and
  `MICROSOFT_CLIENT_SECRET` are set), `accountMenu`, `accountSettings` and `feedback` (always off). `updates` is the update banner,
  *Status → Updates* and `/api/admin/update*`; Marco Cloud answers `false` and shows the CHANGELOG section of a new
  version once instead. `feedback` is Marco Cloud's *Help and feedback* form (account menu, sidebar and command
  palette), which sends `POST /api/admin/feedback` with `{ kind: 'problem'|'idea'|'other', message, meta }` to the
  people who run the service; a self-hosted admin never shows it. `privacy` is privacy mode (see
  [Privacy mode](#privacy-mode)); a server that does not filter events for it leaves it out and the admin hides the
  controls. `doorbell` is the doorbell overlay, its webhook and the admin card; `doorbellLive` means the frames are a
  live camera picture proxied from Home Assistant. A server with `doorbell` and without `doorbellLive` answers the
  frame URL with the latest snapshot it was given instead; the display works the same way with both. `carousels` is
  the *Carousels* page and `config.carousels` (a server without it would drop the section on save). `immich` is
  the Immich photo source and `/api/admin/immich/*` (Marco Cloud answers `false`). `family` is *Familia*: the
  `Familia` and `Menús` pages, the kids layouts, the family page on the phone and `/api/admin/family*`,
  `/api/family/*` and `/api/display/family*` (see [Familia](#familia)). `widgets` is the *Widgets* page, the
  `widget` layout and `POST /api/admin/test/widget`; `webWidgets` allows the `web` type (a page in a sandboxed
  frame). Marco Cloud answers `widgets: true`, `webWidgets: false` (see [Widgets](#widgets)). `priceWidgets` allows
  the `prices` type, `GET /api/display/prices` and `/api/admin/test/prices`, `/api/admin/prices/token` (see
  [Electricity prices](#electricity-prices)). `familyPhotos` allows profile photos of the family members
  (`POST /api/admin/family/photos` and `GET /media/avatars/<id>`, see [Familia](#familia)); without it the admin
  offers emoji only. `twoFactor` is two-step sign-in with an authenticator app (`/api/admin/2fa*` and
  `POST /api/auth/2fa`, see [Two-step sign-in](#two-step-sign-in)); Marco Cloud answers `false` and has its own on the
  account page. `accountSettings` puts a Marco Cloud account's settings on the admin's Account page (see
  [Account mode](#account-mode)).
- `limits` (optional): plan limits such as `screens`, `sources` or `devices`. Absent means no limit beyond the
  config validator's own caps (12 screens, 50 calendars, 20 news feeds, 1000 local events, 500 birthdays,
  100 countdowns, 6 carousels, 20 widgets). `widgetMinRefreshSec` is the shortest widget refresh the server takes
  (Marco Cloud: 30). The admin disables "add" at the limit and flags a config that goes over it.
- `displayOrigin` (optional): absolute origin that serves `/d/<key>` and `/pair`. Absent means the same origin. The
  admin opens screens (preview, *View screen*) at `<displayOrigin or its own origin>/d/<key>` when it has the private
  links (a server in private mode, or one without open display access), else at `/?screen=<slug>`. The preview adds
  `?preview=1`: that page is never counted as a connected display and does not read or write the browser's stored
  device token, client id or cached data.
- `adminOrigin` (optional): absolute origin of the admin, for displays served from another origin. Absent means the
  same origin.
- `lanAddresses` (optional): this server's LAN addresses (as in `/api/setup/status`). Only sent to a client on the
  server itself (loopback, not relayed by an untrusted proxy, allowed host name), so the pairing screen of a kiosk on
  `http://localhost` can say where other devices reach the admin.

Clients treat a response with no `features` field (servers older than 0.5.0) as having every feature on, except
`accountMenu`, `microsoftCalendar`, `updates`, `feedback`, `privacy`, `doorbell`, `doorbellLive`, `carousels`,
`immich`, `family`, `widgets`, `webWidgets`, `priceWidgets`, `familyPhotos`, `twoFactor` and `accountSettings`. A key missing from `features` counts as off only when `edition` is not `'self-hosted'`, and a missing
`accountMenu`, `microsoftCalendar`, `updates`, `feedback`, `privacy`, `doorbell`, `doorbellLive`, `carousels`,
`immich`, `family`, `widgets`, `webWidgets`, `priceWidgets`, `familyPhotos`, `twoFactor` or `accountSettings` is always off.

### Account mode

A multi-tenant server (`tenancy: 'multi'`) signs people in on its own account pages instead of the admin's login
screen. `GET /api/auth/me` then returns `user.method: 'account'` and an `account` block:
`{ loginUrl, accountUrl, sessionsUrl, deleteUrl, household: { name, role } }`. The admin:

- sends the browser to `loginUrl?next=<path and hash>` when it is signed out or a call answers 401. `next` is
  always a path under `/admin/`;
- after `POST /api/auth/logout`, goes to the `next` path in the response, or to `loginUrl`;
- shows the household and the account links in the header menu, and also sends `POST /api/account/lang {lang}`
  when the language changes;
- replaces the Security page with an Account page (same `#/security` route) that renames the household with
  `PATCH /api/admin/household {name}` (60 characters at most).

With `features.accountSettings` the Account page holds the whole account, and the header menu only links to it:

- language: `POST /api/account/lang {lang}` (also sent when the admin's language changes);
- password: `POST /api/account/password {current, password}`, or `{password}` alone for an account that has none
  yet (allowed from a session signed in within the last 10 minutes; older ones get `401 {code: 'reauth'}`);
- two-step verification: `GET /api/account/two-factor` (`{ enabled, enabledAt, recoveryLeft, hasPassword }`) and
  `POST /api/account/two-factor/setup|enable|disable|recovery-codes`, with the same bodies as `/api/admin/2fa*`;
- Sign in with Google: `GET /api/account/google` (`{ enabled, hasPassword, linked }`) and
  `POST /api/account/google/disconnect`;
- sessions: `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/logout-all`;
- `GET /api/account/export` (a JSON download), and deleting the account with `POST /api/account/delete {password}` or
  a confirmation link by email (`POST /api/account/delete/start`).

A `401` with `code: 'reauth'` from these calls asks for a recent sign-in for that one change: the admin shows the
message and stays signed in.

Links in the `account` block must be paths on the same site or `http(s)` URLs; the admin ignores anything else.

Every call the admin makes is listed in `web/shared/adminContract.json` (method, path, query keys, gating feature,
request type and top-level response keys), generated from `web/admin/api.ts` and `web/shared/types.ts` by
`npm run contract`. A server that turns a feature off answers that feature's routes with
`404 {"error":"feature_unavailable"}`.

Error codes the admin translates (`web/admin/apiErrors.ts`), read from `code` first and then `error`:
`rate_limited`, `screen_limit`, `limit_exceeded`, `feature_unavailable`, `conflict`, `photo_quota`, `readonly`. A
`details[].message` with one of these codes is translated too. Any other error shows the server's own text.

`CalEvent`: `{ id, sourceId, title, start, end, allDay, location, color, emoji, kind, multiDay, age?, busy? }`.
`start`/`end` are ISO strings with offset, or `YYYY-MM-DD` for all-day events (`end` exclusive). `busy: true` marks a
privacy-mode block: `title` is "Busy" in the screen's language, `location` and `emoji` are empty, `color` is the
calendar's.

### Server-Sent Events (`/api/stream`)

| Event | Data | When |
|---|---|---|
| `hello` | `{ revision, screenId, targetKind, slug, clientId, serverVersion, now, activeAnnouncementIds, doorbellId }` | on connect. `doorbellId`: the ring on this screen or `null` (a display showing another one closes it). On a carousel `screenId` / `slug` are the carousel's, `targetKind` is `"carousel"`, and the announcements and ring cover all its screens |
| `config` | `{ revision }` | config saved; the display refetches its config and re-renders without reloading |
| `events` | `{ hash }` | calendar data changed (also refetch countdowns) |
| `photos` | `{}` or `{ hidden: [file, …] }` | gallery changed (`hidden` lists photos just taken out of the rotation; a display showing one of them moves on right away) |
| `reload` | `{}` | "Refresh displays", display command or webhook; also sent (then the stream is closed) when a config save leaves the stream's `?screen=` naming nothing |
| `announce` | `Announcement` | announcement sent; replayed on connect while still active |
| `announce-clear` | `{ id \| null }` | announcement removed early (`null` = all) |
| `identify` | `{ name, slug, clientId, durationSec }` | show the screen name full-screen |
| `night` | `{ mode: "on" \| "off" \| "auto" }` | night mode override |
| `privacy` | `{ active, screenId }` | privacy mode of this screen turned on or off (admin, webhook, schedule, or a period that ended); the display refetches its config, events, countdowns and photos |
| `doorbell` | `{ id, screenId, startedAt, updatedAt, expiresAt, sound, frames, refreshMs }` | someone rang (`screenId`: the ringing screen; a display on a carousel asks for its frames with `?screen=<screenId>`); replayed on connect while it lasts. The same `id` again with a later `expiresAt` extends it. `frames: false` = no camera, `refreshMs` = time between two frame requests (750) |
| `doorbell-end` | `{ id }` | the ring was dismissed |
| `family` | `{ rev }` | Familia changed: a routine ticked (phone, TV or admin), stars, a reward, an import, a new or removed family link. Displays with a kids layout ask for `GET /api/display/family` again |
| `ha` | `HaSnapshot` | Home Assistant states of a Personalizado screen: the full snapshot when the stream opens and when the connection to Home Assistant changes (`full: true`), then only the aliases that changed (`full: false`), at most one event a second per screen, aimed at that screen (`screenId`). Not sent on the poll channel |
| `values` | `ValuesSnapshot` | Pushed values of a Personalizado screen: the snapshot when the stream opens (`full: true`, only for a screen that shows a key), then the keys that changed (`full: false`, `null` for a key that was cleared), at most one event a second, only to the screens that show those keys and never while one is private. Not sent on the poll channel |
| `ping` | `{ t }` | every 25 s |
| `revoked` | `{ code: "invalid_key" \| "key_required" }` | the link was regenerated or replaced by an import, the device revoked or dropped by an import, the screen deleted, display access switched to private for a keyless display, or (`key_required`) the admin session a stream was opened with ended (logout, logout everywhere, password change); the server then closes the stream. Every stream's credential is re-checked after config saves, imports, session revocation and on each heartbeat |

Displays whose screen has alerts disabled do not receive `announce`. A display on a carousel receives the events of
every screen in it (and of the carousel id, for display commands), and `announce` when one of the screens it targets
has alerts on.

### Poll channel (`/api/display/poll`)

Used when `/api/health` says `live: 'poll'`. The credential travels in `X-Marco-Key`, as for the other display
endpoints, and the same `401` / `403` answers apply (the display then shows the pairing or "no longer valid" screen,
so there is no `revoked` command).

| Query | Meaning |
|---|---|
| `client` | the display's client id (as on `/api/stream`) |
| `cursor` | the `cursor` of the previous answer; empty on the first poll |
| `rev` | the config revision the display has |
| `hidden` | `1` while the page is hidden |
| `preview` | `1` for the admin preview: commands still arrive, but the poll is not listed as a display |

Answer `{ revision, screenId, targetKind, now, serverVersion, cursor, reset, commands, activeAnnouncementIds?, next }`
(on a carousel `screenId` is the carousel's id, so a switch between its screens never reloads the page):

- `commands`: in order and already filtered to this display. Each one is `{ type, ...payload }` with the SSE event
  names and payloads: `reload`, `night`, `identify` (filled in for this display), `announce`, `announce-clear`,
  `photos`, `events`, `privacy`, `doorbell`, `doorbell-end` and `family`.
- `reset: true` on the first poll, after a server restart, or for a cursor the server no longer knows. `commands` then
  only holds the announcements still active on this screen, like the replay on `/api/stream`, and old commands are
  never replayed.
- `activeAnnouncementIds`: present on a reset and whenever `commands` holds `announce` or `announce-clear`.
- `doorbellId`: present on a reset, the ring on this screen or `null`. A reset also replays that ring as a `doorbell`
  command.
- `revision`: the display refetches its config, events and countdowns when it differs from its own. `screenId`: a
  different one (the paired device was moved) reloads the page. `serverVersion`: a newer server reloads the page once.
- `next`: milliseconds until the next poll. Self-hosted answers 30 s, 3 min while hidden, and 5 s while someone has
  *Connected screens* open or just sent a command. The display adds ±10 % and keeps it between 3 s and 15 min; on
  errors it waits 5 s, doubling up to 5 min.

The self-hosted server keeps the last 500 events in memory. Commands expire: `identify` after 60 s, `announce` and
`doorbell` at their `expiresAt`, the others after 10 min. Over the poll channel a ring reaches a display on its next
poll (5 s for 3 minutes after any command, else up to 30 s), so a doorbell is only immediate with SSE. A display that polled in the last 4 minutes is listed as connected and
counts in `delivered` (at most 24 client ids per address, as for streams). A new private link, a revoked device or
a switch to private access takes its pollers off the list at once; their next poll gets `401` / `403`.

## Authentication

| Method & path | Notes |
|---|---|
| `GET /api/auth/me` | `{ user: { email, name, picture, method } \| null, needsSetup, googleConfigured, passwordLoginEnabled, mustChangePassword, passwordFromEnv }`. `method` is `'password'` or `'google'` here; Marco Cloud answers `'account'` and adds `account: { loginUrl, accountUrl, sessionsUrl, deleteUrl, household: { name, role } }` and `microsoftConfigured` (Microsoft calendars on for this account; a self-hosted server sends it too, true when `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` are set) |
| `POST /api/auth/login` | `{ password }`; `409 { needsSetup: true }` while the install has no password yet. With two-step sign-in on, a right password answers `{ twoFactor: true }` and no session yet |
| `POST /api/auth/2fa` | `{ code }`: the 6-digit code or a recovery code after `{ twoFactor: true }` (or after Google) → `{ user, recoveryLeft? }`. `401 { code: 'code_invalid', attemptsLeft }`, `401 { code: 'challenge_expired' }` (type the password again), `429` |
| `POST /api/auth/logout`, `POST /api/auth/logout-all` | log out this session / every session |
| `GET /auth/google/login` | "Sign in with Google" (email must be in `auth.allowedGoogleEmails`; if the list is empty, the first Google login made while already logged in with the password adds itself) |
| `GET /auth/google/connect` | Link a Google account for calendars (scope `calendar.readonly`, offline access); requires a session |
| `GET /auth/google/callback` | OAuth redirect URI: `${PUBLIC_URL}/auth/google/callback` |
| `GET /auth/microsoft/connect` | Link a Microsoft account for calendars (`openid email profile offline_access Calendars.Read Calendars.Read.Shared`, PKCE); requires a session and `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` |
| `GET /auth/microsoft/callback` | OAuth redirect URI: `${PUBLIC_URL}/auth/microsoft/callback`. Back to `/admin/?microsoft=<email>` or `/admin/?error=microsoft_<code>` |

### Two-step sign-in

Optional (`features.twoFactor`), off until the admin turns it on in *Security*. It is a property of the admin, not of
a sign-in method: after a right password, and after Google when Google sign-in is on, the server keeps a challenge
(5 minutes, 5 wrong codes) and the browser only holds its random id in the session cookie. No session exists until
`POST /api/auth/2fa` accepts a code, so `/api/auth/me` answers `user: null, twoFactorPending: true` meanwhile and every
admin route answers `401`. Codes are RFC 6238 TOTP (SHA-1, 6 digits, 30 seconds, one step of drift either way); a
code, or an older one, is never accepted twice. Wrong codes count toward the same per-address limit and shared budget
as passwords and are logged as `auth.2fa_failed`. The secret and the hashes of the recovery codes live in
`data/secrets.json` and are never exported, so an import or a restore leaves two-step sign-in as it is. Turning it on
or off ends no session.

| Method & path | Notes |
|---|---|
| `GET /api/admin/2fa` | `{ enabled, enabledAt, recoveryLeft }` |
| `POST /api/admin/2fa/setup` | `{ password? }`: needs a sign-in in the last 10 minutes or the password (`403 password_required`) → `{ secret, uri }` (base32 and `otpauth://`, the admin draws the QR code itself) |
| `POST /api/admin/2fa/enable` | `{ code }`: the first code from the app, within 15 minutes of the setup → `{ ok, recoveryCodes }` (10, shown once; only their hashes are kept). `auth.2fa_enabled` |
| `POST /api/admin/2fa/disable` | `{ password }` (password sessions) or `{ code }` (a code or a recovery code, from a session that signed in within 10 minutes; else `403 reauth_required`). `auth.2fa_disabled` |
| `POST /api/admin/2fa/recovery-codes` | same proof as disabling → `{ ok, recoveryCodes }`; the old codes stop working. `auth.2fa_codes_renewed` |

Locked out (no phone, no recovery codes): stop the server and run `npm run disable-2fa` (`node server/disable-2fa.js
[--data-dir <dir>]`). It removes the two-step settings from `secrets.json` and logs `auth.2fa_disabled`.

## Setup (first run)

A fresh install has **no admin password** (and no default one): until the setup wizard completes, the admin panel
shows the wizard and the display shows a welcome screen. Installs that already have a password hash never enter
setup. When `ADMIN_PASSWORD` is set and no hash exists yet, it becomes the initial password at startup (headless
installs) and setup is skipped; the panel then offers to change it (`passwordFromEnv`).

| Method & path | Notes |
|---|---|
| `GET /api/setup/status` | `SetupStatus`: `{ needsSetup, googleConfigured, version, suggestedLanguage }`; while `needsSetup` also `tokenRequired`, `tokenValid` (when an `x-setup-token` header was sent; `null` otherwise; a wrong token counts towards the lockout below, `429` while locked), `defaults` and, for LAN clients, `lanAddresses` (real LAN interfaces only; empty in a container unless `LAN_ADDRESS` is set) |
| `POST /api/setup/test-ics` | `{ url }` → `TestIcsResponse` (the wizard's "Test" button). Unauthenticated, so it refuses loopback, link-local / cloud-metadata, multicast and unspecified destinations (also after redirects) and returns only generic errors (`address not allowed`, `HTTP <status>`, `could not load the calendar`) |
| `POST /api/setup/complete` | `SetupRequest` → `{ ok, user, screen: { id, slug, name, displayPath }, displayAccess }` and a session cookie (logged in). `displayPath` = the screen's private link `/d/<key>` |

`SetupRequest`: `{ password, passwordConfirm, language: es|en|pt|nl|da, screenName, location?: { name, lat, lon, timezone },
timezone? (when the location is skipped), units?: metric|imperial, format24?, calendars?: [{ name, url, kind: holidays|generic }] (≤ 20), photos?: { source:
stock|gallery|mixed }, layout?: { preset }, accent?: #rrggbb, ambient?: aurora|particles|none, theme?: dark|light }`.
`layout.preset: "planner"` also sets the screen's `calendar.weeks` to `"auto"` and `calendar.eventStyle` to
`"cards"`, as picking that layout in the admin does; other layouts leave them alone.
The password must have at least 10 characters, must not be a common password or a trivial pattern (`1234567890`,
`aaaaaaaaaa`, `qwertyuiop`, `password2024!`…) and must equal `passwordConfirm` (the same rules apply to
`PUT /api/admin/password`).

Rules for the mutating setup endpoints:

- **Single use**: once a password exists they answer `409 { error: "setup already completed" }`.
- **Race-safe**: the first `complete` claims the wizard before hashing; a concurrent one gets `409`.
- **JSON only, same origin**: `Content-Type: application/json` is required (`415` otherwise, even for an empty body)
  and a present `Origin` must match the host and be an allowed host name (`403`). Requests whose `Host` is not an
  allowed name get `421` on every route except `/api/health` and `/api/hooks/*` (DNS-rebinding guard: IP literals,
  `localhost`, single-label names, `*.local`/`*.lan`/`*.home.arpa`/`*.internal`, the `PUBLIC_URL` host, `ALLOWED_HOSTS`).
- **Validation**: `400 { error, details: [{ path, message }] }`; nothing is written until everything is valid.
- **Setup token**: with `SETUP_TOKEN` set, every request needs it (`x-setup-token` header or `{ token }` in the
  body). `SETUP_REQUIRE_TOKEN=1` (set in the Docker image) and an install whose config was saved before (revision > 1,
  i.e. `secrets.json` was lost) require the random per-process token in the same way. Otherwise LAN clients need no
  token (a loopback/private address that was not relayed by a proxy missing from `TRUST_PROXY` and is not the
  container's gateway), and any other client needs the per-process token printed in the server log at startup
  (`[setup] Open http://localhost:PORT/admin/?setup=<token> to finish setup`, plus one line per detected LAN address
  and the `PUBLIC_URL` when it is not localhost; replace `localhost` with the server's address from another device).
  Missing/wrong token → `403 { code: "token_required" | "invalid_token" }`; 10 wrong tokens (on any setup endpoint,
  `/status` included) from one IPv4 address or IPv6 /64 → `429` for 10 minutes. A locked client is still let in with
  a strong token (the generated one, or a `SETUP_TOKEN` of 20+ characters), so a neighbour cannot lock the owner out.
- A `secrets.json` that exists but cannot be read stops the server at startup (it is never replaced by defaults).
- Activity entries: `auth.setup_completed`, `auth.setup_rejected` (throttled).

## Admin API (session required)

**Configuration**

| Method & path | Notes |
|---|---|
| `GET /api/admin/config` | Full `StoredConfig` |
| `PUT /api/admin/config` | Validate + save (revision + 1, backup first, SSE `config`). Body = `StoredConfig` plus an optional `baseRevision`: the revision the admin loaded. When the config was saved since then (another tab or device, or the server itself, for example the first Google sign-in adding the allowed email) the answer is `409 { error: "conflict", revision }` and nothing is written; the admin then offers to load the saved version or to save its changes on top of it (parts it did not change keep the saved value) with the new `baseRevision`. Without `baseRevision` (or `null`) the last write wins, as before 0.5. `400 { error, details: [{ path, message }] }` when invalid |
| `PUT /api/admin/password` | `{ current, next }`: same password rules as the setup wizard (`400 { code: too_short \| too_common \| too_long }`); also logs out other sessions |
| `GET /api/admin/screens/template?name=` | New `ScreenProfile` with defaults and a free slug |
| `GET /api/admin/geocode?q=&lang=` | Place search for the weather location, through this server (Open-Meteo geocoding) so the browser only talks to Marco → `{ results: [{ name, admin1, country, countryCode, lat, lon, timezone }] }` (at most 8; `q` shorter than 2 characters gives `[]`). Also open to the setup wizard while no password exists, with the same token rules as `/api/setup/*` (`x-setup-token`). `429 { error: "rate_limited" }` after 60 searches per address in 10 minutes (600 overall); answers are cached for a day; `502 { error: "geocode_unavailable" }` when Open-Meteo cannot be reached |
| `POST /api/admin/events/preview` | Body `{ from?, days? (1..60), screen?, eventRules?, iconRules?, localEvents?, birthdays? }` (draft values) → every event incl. hidden ones with `applied[]` rules and `ruleHits`. Each event has `originalTitle` (the calendar's title) and, since 0.17, `titleWhy`: why the title on screen differs, `"rule"` (a rename rule), `"birthday"` (a recognised birthday keeps only the name next to the 🎂; `birthdays.tidyTitles: false` turns that off), `"caps"` (an ALL CAPS title in normal case) or `null` |
| `GET /api/admin/countdowns?screen=` | Same answer as `GET /api/countdowns` for the screen with that id or slug (unknown → default screen); used by the Countdowns page |
| `POST /api/admin/birthdays/parse-csv` | `{ text }`: one `name;dd/mm[/yyyy]` per line (`;`, `,` or tab) → parsed rows, duplicates, errors with line numbers |
| `GET /api/admin/dashboard` | Next events, weather now, active schedules, recent activity, warnings |
| `GET /api/admin/status` | Per-source last fetch / errors, weather (`ok`, `updatedAt`, `error`, `errorCode`: `key_missing`, `key_invalid`, `rate_limited`, `http`, `bad_response`, `provider`) and news status, display count, uptime |

**Sources and integrations**

| Method & path | Notes |
|---|---|
| `GET /api/admin/google/accounts` · `DELETE /api/admin/google/accounts/:email` | Linked Google accounts |
| `GET /api/admin/google/calendars?account=` | Calendars of a linked account |
| `GET /api/admin/microsoft/accounts` · `DELETE /api/admin/microsoft/accounts/:email` · `GET /api/admin/microsoft/calendars?account=` | Linked Microsoft accounts and their own and shared calendars (`MicrosoftAccount[]`, `MicrosoftCalendarListItem[]`). `404 feature_unavailable` without `features.microsoftCalendar`; the calendar list answers `409 microsoft_reconnect` when the account must be linked again. `DELETE` answers `{ ok, manageAccess }` (Microsoft has no revoke endpoint: the pages where the access is removed) |
| `POST /api/admin/test/ics` | `{ url, insecureTls? }` → `{ ok, count, sample, error? }` |
| `POST /api/admin/test/rss` | `{ url }` → `{ ok, title, count, error? }` |
| `POST /api/admin/test/widget` | `{ type: 'image' \| 'web', url }` → `{ ok, error?, format?, width?, height?, bytes?, warnings? }` (see [Widgets](#widgets)) |
| `POST /api/admin/test/homeassistant` | `{ url, token? }` → `{ ok, version?, error? }` |
| `GET /api/admin/homeassistant/entities?domain=sensor\|weather\|camera` | `[{ entity_id, name, state, unit }]` |
| `POST /api/admin/doorbell` | Same body and answer as `POST /api/hooks/doorbell` (the *Test* button of *Home Assistant → Doorbell and camera*, with the values on screen). Logged with `via: "admin"` |
| `PUT /api/admin/homeassistant/token` | `{ token }` |
| `POST /api/admin/test/immich` | `{ url?, key?, insecureTls? }` (unsaved values; missing ones come from the saved settings) → `{ ok, version?, missingScopes?, error? }`. `missingScopes` lists what the key lacks of `album.read`, `asset.read`, `asset.view`. `error`: `not_configured`, `key_missing`, `invalid_url`, `invalid_key`, `missing_scope`, `not_found`, `unreachable`, `bad_response`, `http` (`features.immich`) |
| `GET /api/admin/immich/key` | `{ set, hint }`: whether an Immich API key is stored and its last 4 characters. The key itself is never sent back |
| `PUT /api/admin/immich/key` | `{ key }` (letters, digits, `-` and `_`, 10 to 128; `""` removes it). With a server URL saved, the key is tried first: `400 { error: "invalid_key" }` when Immich refuses it (nothing is stored); `{ set, hint, checked }` otherwise. A changed key forgets the album lists and sends a live `photos` event |
| `GET /api/admin/immich/albums` | `ImmichAlbum[]`: `{ id, name, count, cover, shared, start, end }`, by name. `409 { error: "not_configured" }`, `502 { error }` when Immich fails |
| `GET /api/admin/immich/status` | `ImmichStatus`: `{ usable, albums: [{ id, favoritesOnly, count, updatedAt, error, missing }], cache: { files, bytes } }` (albums some screen plays) |
| `POST /api/admin/immich/refresh` | Fetch the albums in use again now, then tell the displays (live `photos` event) → `ImmichStatus` |
| `DELETE /api/admin/immich/cache` | Empty the image cache → `{ ok, freed }` (bytes) |
| `GET /api/admin/weather/key` | `{ set, hint }`: whether an API key for a weather source that needs one (Pirate Weather) is stored, and its last 4 characters. The key itself is never sent back |
| `POST /api/admin/weather/preview` | `{ places: [{ name, lat, lon }], lang }` (at most 8): the weather of places not saved yet, for the admin preview (a screen's place, a weather card's place) → `{ places: { <placeKey>: <the /api/weather answer> } }`. Through the same cache as the screens; a place that fails is left out. `400 { error: "invalid_places" }` for anything else |
| `PUT /api/admin/weather/key` | `{ key }` (letters, digits, `-` and `_`, 8 to 128; `""` removes it). A new key is tried once at the configured place: `400 { error: "key_invalid" }` when the source refuses it (nothing is stored); `{ set, hint, checked }` otherwise (`checked: false` when the source could not be reached). Saving the config with `weather.provider: "pirate-weather"` while no key is stored answers `400` with `weather.apiKey` |

**Photos**

| Method & path | Notes |
|---|---|
| `GET /api/admin/photos` | `[{ file, url, thumbUrl, size, mtime, w, h, focusX, focusY, uploadedAt, hidden }]` |
| `POST /api/admin/photos/check` | `{ names }` → which names already exist |
| `POST /api/admin/photos?onConflict=rename\|replace\|skip` | multipart `photos[]` (≤ 100 MB each), optional `thumbs[]` and `meta` (`[{ focusX, focusY }]`) |
| `PATCH /api/admin/photos/:file` | `{ focusX, focusY }` (0..1) and/or `{ hidden: boolean }` (take the photo out of / back into the rotation) → the photo |
| `POST /api/admin/photos/visibility` | `{ files: string[] (1..2000), hidden: boolean }` → `{ ok, updated, missing, total, inRotation }` (bulk show / hide) |
| `PUT /api/admin/photos/:file/thumb` | multipart `thumb` |
| `DELETE /api/admin/photos/:file` | |

**Displays, announcements, tokens**

| Method & path | Notes |
|---|---|
| `GET /api/admin/displays` | Connected and known displays (screen, IP, browser, resolution, dpr, WebGL, version, outdated, `access`: `key` \| `device` \| `session` \| `open`, `deviceId`, `deviceName`…) |
| `POST /api/admin/displays/command` | `{ action: "reload"\|"identify"\|"night", mode?, clientIds?, screens? }` → `{ ok, delivered }` |
| `DELETE /api/admin/displays/:clientId` | Forget an offline display |
| `POST /api/admin/refresh-displays` | `{ screens? }`, hard reload |
| `POST /api/admin/announce` | `AnnounceRequest` (see webhooks) → `{ ok, announcement, delivered }` |
| `GET /api/admin/announcements` · `DELETE /api/admin/announcements[/:id]` | Active + history; clear one or all |
| `GET /api/admin/tokens` · `POST /api/admin/tokens { name, scopes? }` · `PATCH /api/admin/tokens/:id { scopes }` · `DELETE /api/admin/tokens/:id` | API tokens (the full token is returned once on creation; max 20). `scopes` (default `["*"]`): see [Token scopes](#token-scopes); an empty list or an unknown name is `400` |
| `GET /api/admin/values` · `DELETE /api/admin/values/:key` | The values pushed by `POST /api/hooks/values` (the same list as `GET /api/hooks/values`); clearing one makes its cards show *Sin datos* |

**Privacy mode** (`features.privacy`; see [Privacy mode](#privacy-mode))

| Method & path | Notes |
|---|---|
| `GET /api/admin/privacy` | `PrivacyResponse`: `{ screens: [{ screenId, slug, name, active, until, by, resumesAt, scheduled }] }` |
| `POST /api/admin/privacy` | `PrivacyRequest` (same body as the webhook) → `{ ok, changed, screens }`. The admin's quick actions send `{ mode: "on", hours: 1 }`, `{ mode: "on", hours: 3 }`, `{ mode: "on", untilTime: "06:00" }` (until tomorrow), `{ mode: "on" }` (until turned off) and `{ mode: "off" }`, with `screens: [id]` for one screen |

**Backups and activity**

| Method & path | Notes |
|---|---|
| `GET /api/admin/backups` · `POST /api/admin/backups` | List / create a manual backup |
| `GET /api/admin/backups/:id` · `POST /api/admin/backups/:id/restore` · `DELETE /api/admin/backups/:id` | Download / restore (current config backed up first) / delete |
| `POST /api/admin/export` | `{ includeSecrets, password? }` (with secrets: a sign-in in the last 10 minutes, or the admin `password`; else `403 { code: 'password_required' }`, a wrong one `403 { code: 'password_incorrect' }`) → `marco-YYYY-MM-DD.json` (secrets = password hash, HA token, Immich API key, Google accounts, API tokens, display keys, paired devices (token hashes); never the session secret) |
| `POST /api/admin/import/preview` | `{ bundle, lang? }` (export bundle or a bare config) → per-section summary in `lang` (es/en/pt; default: `Accept-Language`, else English), `displayAccess` (the current mode, which the import keeps) and `secretsImpact: { linksChanged, devicesRemoved, devicesAdded } \| null` (what importing the bundle's secrets would change); nothing saved |
| `POST /api/admin/import/apply` | `{ bundle, sections?, includeSecrets?, password? }` (with secrets: same rule as the export) → `{ ok, config, loggedOut? }`. `security.displayAccess` is never taken from the bundle (restores keep it too). Imported keys / devices close the streams of replaced keys and dropped devices |
| `GET /api/admin/activity?type=&level=&q=&actor=&before=&limit=` | Newest first, paged with `before=<id>` |
| `DELETE /api/admin/activity` | Clear the log |

**Updates** (self-hosted, `features.updates`; see docs/ARCHITECTURE.md *Updates*)

| Method & path | Notes |
|---|---|
| `GET /api/admin/update` | `UpdateInfo`: `{ current, latest: { version, name, notes, url, publishedAt } \| null, available, checkedAt, error, checks: 'on'\|'off'\|'env-off', install: { kind: 'release'\|'checkout'\|'docker'\|'manual', canApply, cli }, settings: { check, auto, from, to }, status, log }`. `status` is the last update: `{ state: 'requested'\|'running'\|'done'\|'current'\|'failed', from, to, target, by: 'admin'\|'auto', at, rolledBack, stalled }`; `log` the last lines of the installer's output |
| `PUT /api/admin/update/settings` | `{ check?, auto?, from?, to? }` (`HH:MM`, time zone of *Date & time*) → `UpdateInfo` |
| `POST /api/admin/update/check` | Ask GitHub now (a second call within 20 s answers the stored result) → `UpdateInfo`; `409 checks_disabled` with `MARCO_UPDATE_CHECK=0` |
| `POST /api/admin/update/apply` | Ask the update service for the latest release → `UpdateInfo` with `status.state: 'requested'`. `409` with `error`: `not_supported` (not a release install with `marco-update.path`), `busy`, `up_to_date` |

## Webhooks (`/api/hooks/*`)

Authentication: `Authorization: Bearer cs_…` only (no cookies, no tokens in URLs). JSON bodies.
Errors: `401` missing/invalid token, `403 { error: "scope", scope }` the token may not use this endpoint (see
[Token scopes](#token-scopes)), `400` invalid data (e.g. unknown screen), `415` body is not JSON, `429` more than 30
requests per minute with the same token.

| Endpoint | Body | Response |
|---|---|---|
| `GET /api/hooks/ping` | none | `{ ok: true, token: "<name>" }` |
| `POST /api/hooks/announce` | `title` (≤ 120) and/or `body` (≤ 500), `emoji`, `style` (`info`/`success`/`warning`/`urgent`), `durationSec` (5–86400, default 30), `sound`, `screens` (slugs or ids; omitted = all) | `{ ok, announcement, delivered }` |
| `POST /api/hooks/reload` | `{ screens? }` | `{ ok, delivered }` |
| `POST /api/hooks/night` | `{ mode: "on"\|"off"\|"auto", screens? }` | `{ ok, delivered }` |
| `GET /api/hooks/privacy` | none | `{ screens: [{ screenId, slug, name, active, until, by, resumesAt, scheduled }] }` |
| `POST /api/hooks/privacy` | `mode` (`on`/`off`/`toggle`), at most one of `hours` (0 to 744), `until` (ISO date and time) or `untilTime` (`HH:MM`, the next time it comes round in the configured time zone); none = until turned off. `screens` (slugs or ids; omitted = all) | `{ ok, changed, screens }` (`changed`: ids of the screens that turned on or off) |
| `POST /api/hooks/doorbell` | `{ action?: "ring"\|"dismiss", seconds?, screens?, camera?, sound? }`, see [Doorbell camera](#doorbell-camera) | `{ ok, action, delivered, screens, expiresAt? }` |
| `POST /api/hooks/values` | `{ values: [{ key, value, unit?, label? }] }` (a single `{ key, value, unit?, label? }` too), see [Pushed values](#pushed-values-valor) | `{ ok, stored, waiting }` |
| `GET /api/hooks/values` | none | `{ values: [{ key, value, unit?, label?, updatedAt, screens }] }` (`screens`: slugs of the screens that show it) |
| `DELETE /api/hooks/values/:key` | none | `{ ok }`, `404` when there is no such value |

`delivered` = number of connected displays that received it. Active announcements survive server restarts.

```bash
TOKEN=cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
curl -H "Authorization: Bearer $TOKEN" http://192.168.1.50:3000/api/hooks/ping
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Oven is on!","emoji":"🔥","style":"urgent","durationSec":600,"sound":true,"screens":["kitchen"]}' \
  http://192.168.1.50:3000/api/hooks/announce
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"on","hours":3,"screens":["living-room"]}' http://192.168.1.50:3000/api/hooks/privacy
curl -H "Authorization: Bearer $TOKEN" http://192.168.1.50:3000/api/hooks/privacy
```

Privacy changes are logged in the activity log as `privacy.changed` (`{ mode, via: "admin"|"hook", screens?, active,
until? }`).

Marco never calls out to other services when something happens on a screen: there are no outgoing webhooks. The
only system it talks to on its own is the Home Assistant it is set up with.

### Token scopes

Each token says what it may do (`scopes`, chosen in *API & webhooks* when it is created and changed later from the
list). `*` (*Todo*, the default) allows every scope but `screen`, which has to be ticked on its own. A token made
before scopes existed has no `scopes` field and keeps working exactly as before (`*`).

| Scope | Endpoints |
|---|---|
| `announce` | `POST /api/hooks/announce` |
| `commands` | `POST /api/hooks/reload`, `POST /api/hooks/night` |
| `privacy` | `GET` and `POST /api/hooks/privacy` |
| `doorbell` | `POST /api/hooks/doorbell` |
| `values` | `POST`, `GET` and `DELETE /api/hooks/values` |
| `screen` | reserved for a later version |

`GET /api/hooks/ping` needs no scope. A refused request is `403 { error: "scope", scope }` and is logged as
`token.rejected` with `reason: "scope"` (at most once a minute per address). Changing the scopes of a token is logged
as `token.scopes`.

### Pushed values (Valor)

`POST /api/hooks/values` feeds the Valor card of Personalizado screens (and custom HTML cards bound to a key): energy
from the solar panels, the washing machine's state, anything another system knows.

- `key`: 1 to 40 characters `a-z 0-9 _ . -`. `value`: a number, a string of at most 120 characters, or `true` /
  `false`. `unit` (16 characters) and `label` (40) are optional; when an update leaves them out the last ones are
  kept. At most 20 values per request and 8 KB per body (`413` beyond that); a key sent twice in one request keeps
  the last one.
- One stored update per key every 2 s. A value that comes sooner is not refused: it waits for the end of those 2 s,
  and a newer one replaces it while it waits (`waiting` in the answer counts them), so the last value always wins.
  Send several keys in one request rather than one request per key: the token's 30 requests a minute are shared by
  every endpoint.
- At most 50 keys at once: a request with a new key beyond that is `409` and stores nothing. `DELETE
  /api/hooks/values/:key` frees one.
- Values are kept in memory and in `data/values.json` (written at most every 5 s), so they survive a restart. They
  are never a config change: no backup, no new revision, no reload of the screens.
- A screen only ever receives the keys it shows (`GET /api/display/values`, the SSE `values` event), and none while it
  is private. The screen writes the value, the unit and the label as plain text: never as HTML, a link or a colour.
- On the card: the value with the item's decimals, its unit (the item's, else the one sent), *hace 5 min* under it, and
  grey once it is older than the item's *En gris pasados* (`staleAfterMin`, 0 = never). *Esperando datos* until the
  screen has asked, *Sin datos* when there is no value for the key.

In Home Assistant, one `rest_command` and one automation send every key together. *API & webhooks → Conectar desde
Home Assistant* writes them for the keys and entities you pick:

```yaml
rest_command:
  marco_values:
    url: "http://192.168.1.50:3000/api/hooks/values"   # the address of your Marco server
    method: POST
    headers:
      Authorization: "Bearer TOKEN"                    # a token with the values scope
    content_type: "application/json"
    payload: >-
      {"values": [
        {"key": "solar.today", "value": {{ states("sensor.solar_energy_today") | float(0) }}, "unit": "kWh"},
        {"key": "washer", "value": {{ states("sensor.washing_machine_status")[:120] | tojson }}},
        {"key": "garage.open", "value": {{ is_state("binary_sensor.garage_door", 'on') | tojson }}}
      ]}

automation marco:
  - alias: "Values for Marco"
    triggers:
      - trigger: state
        entity_id:
          - sensor.solar_energy_today
          - sensor.washing_machine_status
          - binary_sensor.garage_door
      - trigger: time_pattern
        minutes: "/15"
      - trigger: homeassistant
        event: start
    actions:
      - action: rest_command.marco_values
      - delay: "00:00:05"
    mode: queued
    max: 2
    max_exceeded: silent
```

The `delay` with `mode: queued` and `max: 2` sends at most one request every 5 seconds, however often the sensors
change, and a change that comes during the wait is sent right after it with the latest states, so nothing is lost.
The time trigger sends them again every 15 minutes, so a card never stays grey for long after a missed update.
`automation marco:` keeps this block apart from an `automation: !include automations.yaml` line you may already have.
Texts are cut to 120 characters, the longest value the hook takes.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"values":[{"key":"solar.today","value":12.6,"unit":"kWh"},{"key":"washer","value":"Done"}]}' \
  http://192.168.1.50:3000/api/hooks/values
curl -H "Authorization: Bearer $TOKEN" http://192.168.1.50:3000/api/hooks/values
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://192.168.1.50:3000/api/hooks/values/washer
```

## Carousels

`config.carousels.items` (see docs/ARCHITECTURE.md "Carousels"): saved with the rest of the config
(`PUT /api/admin/config`), no endpoint of its own. Ids start with `v_`; the slug never matches a screen's
(`400` at `carousels.items[i].slug`). `transition` is one of `fade`, `slide`, `zoom`, `wipe`, `dissolve`, `random`,
`none` (default `fade`) and `transitionSpeed` one of `fast` (400 ms), `normal` (800 ms), `slow` (1400 ms), default
`normal`; any other value is a `400` at `carousels.items[i].transition` / `.transitionSpeed`. Configs saved before
0.7 have no `transitionSpeed` and read as `normal`. Display URL parameters for testing: `&tr=<transition>` and
`&trSpeed=<speed>` force the animation, `&try=1` switches to the next step every 4 s (the admin preview).
Everything that binds a display takes a carousel id where it takes a screen id:

- `GET /api/admin/display-links`: one link per screen, then one per carousel, each with `kind: "screen" | "carousel"`
  (`screenId` holds the carousel id). `POST /api/admin/display-links/<carousel id>/regenerate` works too.
- `POST /api/admin/pair/claim { screenId: <carousel id> }` and `PATCH /api/admin/devices/:id { screenId }`;
  `PairedDevice.screenKind` says which.
- `GET /api/admin/displays`: a display on a carousel has `screenId` = the carousel's id, `targetKind: "carousel"`, and
  `showingScreenId` / `showingScreenName` from its last heartbeat (`DisplayHeartbeat.screenId` is the screen it shows).
- `POST /api/admin/displays/command { screens: [<carousel id or slug>] }` reaches the displays of that carousel.

Deleting a carousel drops its private link (its displays get `revoked`) and revokes its paired devices.
A carousel left with no screens keeps its link, but the link then reads a blank screen (`screenId` = the carousel
id, no calendar, stock photos, no countdowns), never the default screen. Carousel ids always start with `v_` and
never match a screen id; a saved id that does not follow this gets a new one.

## Widgets

Images (and, on a server with `webWidgets`, web pages) the owner puts on screens. Saved with the config
(`PUT /api/admin/config`), no endpoint of its own except the test.

- `config.widgets[]`: `{ id: 'w_…', type: 'image' | 'web', name, options: { url, refreshSec, fit: 'contain' | 'cover',
  bust } }`, at most 20. `url` must be written out as `http(s)://host` (no user or password, no spaces, quotes,
  angle brackets, backslashes or control characters) and is stored normalised. Image refresh: 1, 10, 30 s, 1, 5,
  15 min, 1, 6, 24 h (default 15 min); web: 0 (never reload, the default) or 30 s to 24 h. `bust` (images, default
  on) adds `_marco=<time>` to the address at every reload, for servers that send long cache times.
- Per screen: `screens[i].widgets[]` = `{ widgetId, place: 'corner' | 'side', corner: 'tl' | 'tr' | 'bl' | 'br',
  size: 's' | 'm' | 'l' }`, at most 6, in stacking order. The `widget` layout shows `layout.widgetId` full screen.
  Placements and `layout.widgetId` of a deleted widget are dropped on save.
- `GET /api/display/config` carries `widgets[]` (`DisplayWidget`: the full-screen one first with `place: 'full'`,
  then the placements). On a self-hosted server `src` is the address itself (`via: 'direct'`): the TV loads it, so
  LAN addresses work. In open display mode anyone on the network can read that address; put tokens only behind a
  private display access. Nothing while the screen is private.
- `POST /api/admin/test/widget { type, url }` fetches the address once (LAN allowed, 10 s, 3 redirects, 20 MB):
  for an image, its format (PNG, JPEG, WebP, GIF; SVG too on a self-hosted server) and size; for a page, whether it
  lets itself be framed. Never a 4xx for a bad address: `{ ok: false, error }` with `invalid_url`, `timeout`,
  `fetch_failed`, `http_not_found`, `http_denied`, `http_error`, `too_many_redirects`, `too_large` or `not_image`.
  Warnings: `refuses_framing`, `http_on_https`, `large_image`, `same_origin`.
- Web pages load in `<iframe sandbox="allow-scripts allow-same-origin">` with no referrer, no permissions and no
  top navigation or popups, never from the display's own origin. Pages of this server only load in a frame as the
  admin preview (`?preview=1`, same origin): any other framed request gets a sandboxed `403`.

### Electricity prices

A widget of type `prices` (needs `features.priceWidgets`) has no address: the display asks this server for the zone's
day-ahead prices and draws the card itself. The zones, sources, parsers, price math and one refresh round are in
`server/core/pricesCore.js` (shared with Marco Cloud); `server/prices.js` keeps one cache entry per zone in memory.

- `options.prices`: `{ zone, view: 'auto' | 'chart' | 'now' | 'cheap' | 'next', unit: 'main' | 'sub', currency: 'auto' |
  'EUR', surcharge, vat, windowHours, resolution: 'hour' | 'quarter', axis: 'simple' | '3h' | '1h', chartShape: 'columns' |
  'rows', tariff: 'none' | 'grid' | 'bands', grid, bands }`. `zone` is one of `PRICE_ZONE_IDS` (43 bidding
  zones, `ES-PVPC` for the Spanish regulated tariff). `surcharge` is per kWh in the main unit (EUR or DKK), -10 to
  100, added before `vat` (0 to 50 %). `windowHours` 1 to 6. `axis` (hour labels under the chart) defaults to
  `simple`, `chartShape` (wide bars or one row per hour) to `columns`, also for widgets saved before 0.11.1.
  `options.url` is stored empty.
- Tariffs (`server/core/tariffsCore.js`, shared with Marco Cloud): `tariff: 'grid'` with `grid` a Danish grid company
  id of the widget's zone (`DK_GRID_COMPANIES`, 35 companies in DK1 and DK2); `tariff: 'bands'` with `bands: { preset:
  '' | 'es-20td' | 'es-20td-cm', list: [{ name, price }] (1 to 4, price -10 to 10 per kWh before VAT), weekday:
  [24 band indexes], weekend: [24] | null, holidays: 'none' | 'ES' }`, never on `ES-PVPC`. A choice that does not
  fit the zone counts as `none`. Per kWh: (market + tariff or band + surcharge) x (1 + vat / 100).
- `GET /api/display/prices?zone=DK2` (display auth): `{ zone, currency, converted, source, credit, fetchedAt, stale,
  error, slots: [[start (s), minutes, EUR/MWh, local/MWh?]] }`. Slots run from the zone's local midnight to the end
  of tomorrow once published, at 15 or 60 minutes. `converted`: kroner computed from euros (the source gave none).
  `stale`: the last good prices kept after failed refreshes (no longer covering now, or over 3 hours old). `400
  { error: 'invalid_zone' }`; `502 { error: code }` when no prices were ever fetched (`no_source`, `no_data`,
  `timeout`, `fetch_failed`, `http_denied`, `http_error`, `bad_response`, `rate_limited`).
- `&grid=radius` (a company of `zone`, else `400 { error: 'invalid_grid' }`) adds `grid: { id, name, credit,
  fetchedAt, error, hours: [[start (s), company, Energinet, tax, estimated 0|1]] }`, DKK/kWh before VAT, from
  Energinet DataHub (DatahubPricelist; one request per tariff code, refreshed every 12 hours, one cache entry per
  company and one for Energinet). An hour with any charge unknown is left out; past the last published record a
  tariff is carried forward for up to 31 days (`estimated`), an ended discount never. `hours` is empty with `error`
  when the tariffs could not be had, or `error: 'pending'` when a first fetch takes more than 5 seconds (the screen
  asks again 20 seconds later).
- Refresh: after the day-ahead auction (12:50 Brussels time; PVPC 20:30 Madrid time) every 20 minutes until
  tomorrow's prices are in, then at the next auction, at least every 6 hours. A screen never waits for a refresh
  while prices are cached. Failures back off from 2 minutes to 1 hour; a source's `429` is respected with its
  `Retry-After` (at most 1 hour).
- `POST /api/admin/test/prices { zone, grid? }`: `{ ok: true, ...prices }` (with `grid` as above when one is given) or
  `{ ok: false, error }`, through the cache (a new round at most once a minute per zone and per grid company).
- `GET /api/admin/prices/token`: `{ set, hint }` (last 4 characters only). `PUT /api/admin/prices/token { token }`:
  20 to 64 letters, digits or dashes (empty removes it), tried once against ENTSO-E; `400 { error: 'token_invalid' }`
  when refused. Stored in `data/secrets.json` (`prices.entsoeToken`), included in exports with secrets.

### Data cards

The Personalizado kinds of the palette category *Datos* show numbers from public sources. The server fetches them, a
display never does: it gets only the numbers of the items on its own screen from `GET /api/display/data`. What to ask,
how to read the answers, how long to keep them and what a screen gets are in `server/core/dataCore.js` (pure, shared
with Marco Cloud); `server/dataFeeds.js` does the network part.

- **Sources.** Only `api.coingecko.com` (crypto, no key), `site.api.espn.com` and `a.espncdn.com` (sports and crests,
  no key) and `finnhub.io` (stocks, a free key), over https, with paths built from validated ids. No address comes
  from a screen's config or a request. Redirects are refused, answers over 1 MB (crests 256 KB) are refused, and every
  call times out after 10 s.
- **Cache.** One entry per upstream key for every screen and the builder: CoinGecko markets per currency every 2
  minutes (one call for every coin wanted in that currency), 30 day charts every 6 hours, a league's scoreboard every
  minute while a game is on or about to start and every 15 minutes otherwise, a team's results every hour and its
  fixtures every 6 hours, a stock quote every 90 s while its market trades and every 15 minutes otherwise. Nothing is
  asked more than once a minute. Calls to one host go one at a time with a gap between them, and a `429` is respected
  for its `Retry-After`. A failed call keeps the last good numbers (`stale: true`, the card says how old they are) and
  backs off from 2 minutes to 30.
- `market` props: `{ coins: [{ id, sym, name, currency }] (1 to 6, CoinGecko ids, currency one of MARKET_CURRENCIES,
  EUR by default), layout: 'list' | 'big', range: '1d' | '7d' | '30d', chart: 'area' | 'line' | 'none', chartStyle:
  'below' | 'background' }`. Answer:
  `{ kind: 'market', range, coins: [{ id, sym, name, cur, price, ch (%), pts: [[ms, price]] }], age, stale, error? }`.
  The 24 h and 7 day curves come from CoinGecko's 7 day sparkline, which is in US dollars: its shape is scaled to the
  price in the card's currency (the price and the change are exact).
- `sports` props: `{ follow: [{ type: 'team' | 'league', league, team?, name }] (1 to 4, league one of
  SPORTS_LEAGUES), show: 'auto' | 'next' | 'last', max: 1 to 8, crests }`. Answer: `{ kind: 'sports', groups: [{ label,
  lg, sport, games: [{ id, t, st: 'pre' | 'in' | 'post', clk, half?, note?, home, away }] }], age, stale, error? }`,
  each side `{ n, ab, sc, w, c, cr }` (`cr` a crest token). ESPN's site API is public but not documented or promised: it
  may change without notice. A team is followed in one competition (its league, or a cup added as another entry).
- `stocks` props: `{ symbols: [{ sym, name }] (1 to 12, Finnhub symbols), layout: 'ticker' | 'list', sparkline, chartStyle:
  'below' | 'background' }` (the chart style of the list; the ticker keeps its small curves).
  Answer: `{ kind: 'stocks', quotes: [{ sym, name, price, ch, pts }], age, stale, error?, needsKey? }`. No reliable
  keyless source exists (Stooq's CSV links now sit behind a browser check), so stocks need a free Finnhub key. Its free
  plan has no price history: the curve is drawn from the quotes this server has read, up to the last 24 hours.
- The data kinds are private: a private screen gets placeholders, `GET /api/display/data` answers `403`.
- Admin (session): `GET /api/admin/data/coins?q=` → `{ coins: [{ id, sym, name, rank }] }`; `GET
  /api/admin/data/sports/leagues` → `{ leagues }`; `GET /api/admin/data/sports/teams?league=&q=` → `{ teams: [{ id,
  name, abbr }] }`; `GET /api/admin/data/stocks/symbols?q=` → `{ symbols: [{ sym, name, type }] }` (`409 { error:
  'no_key' }` without a key); `POST /api/admin/data/preview { items: [{ id, kind, props }] }` → `{ items }` for the
  builder's preview (validated like a save, through the same cache). Searches are cached a day per text.
- `GET /api/admin/data/stocks/key`: `{ set, last4 }`. `PUT /api/admin/data/stocks/key { key }`: 10 to 64 letters,
  digits, `-` or `_` (empty removes it), tried once with one quote; `400 { error: 'key_invalid' }` when Finnhub refuses
  it. Stored in `data/secrets.json` (`data.stocksKey`), sent to Finnhub in a header (never in a URL), never to a display,
  included in exports with secrets.
- `MARCO_DATA_FAKE=1`: made-up answers (`server/core/dataFake.js`), nothing leaves the machine.

## Familia

Members, routines with stars, rewards and the week's meals (`config.family`, see docs/ARCHITECTURE.md "Familia"),
and what was done in `data/family.json`. The rules are in `server/core/familyCore.js` (shared with Marco Cloud);
`server/family.js` keeps the state file and the family link, `server/routes/family.js` the endpoints. Needs
`features.family`. Every answer is `Cache-Control: private, no-store`; POST bodies must be `application/json` (else
`415 { error: "json required" }`) and at most 4 kB. Errors are `{ error: code, code }`: `unknown_chore`,
`unknown_reward`, `unknown_member`, `not_found` (404), `not_today`, `not_enough` (409), `not_kid`, `bad_delta`,
`bad_date` (400).

**Admin** (session required):

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/api/admin/family` | | `FamilyAdminState`: `{ today, rev, points, progress, completions (last 14 days, newest first), redemptions (50), adjustments (50), link: { exists, path, createdAt }, lanAddresses, publicUrl }` |
| POST | `/api/admin/family/toggle` | `{ choreId, date?, done }` | today or up to 7 days back → `{ ok, state }` |
| POST | `/api/admin/family/adjust` | `{ memberId, delta, note? }` | `delta` -500..500, not 0 → `{ ok, state }` |
| POST | `/api/admin/family/redeem` | `{ rewardId, memberId, force? }` | `force: true` lets the balance go below zero → `{ ok, state }` |
| DELETE | `/api/admin/family/redemptions/:id`, `/api/admin/family/adjustments/:id` | | undo → `{ ok, state }` |
| POST | `/api/admin/family/link` | | create or replace the family link (the old one stops working at once) → `{ link }` |
| DELETE | `/api/admin/family/link` | | remove it → `{ ok }` |
| POST | `/api/admin/family/photos` | `{ data: base64 }` (a data: URL prefix is accepted) | a profile photo, cropped in the browser → `{ photo: id }`; needs `features.familyPhotos` |

**Family page** (`/f/<key>` on a phone; header `X-Family-Key: fk_…`):

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/api/family/state` | | `FamilyPhoneState`: `{ today, slotNow, lang, rev, showPoints, allowRedeem, members, chores (today), rewards, meals }`. Never calendars, screens or other settings |
| POST | `/api/family/toggle` | `{ choreId, done }` | today only → `{ ok, state }` |
| POST | `/api/family/redeem` | `{ rewardId, memberId }` | `403 redeem_off` unless `family.allowRedeemFromPhone` → `{ ok, state }` |

No key: `401 key_required`; a wrong one: `403 invalid_key`; Familia off: `404 family_off`. Wrong or missing keys are
limited to 20 per 10 minutes per address and 200 overall (`429 rate_limited`, `Retry-After: 600`); the right key is
checked first and is never locked out by them. With the right key: 120 requests a minute per address and 40 ticks or
redeems a minute.

**Display** (after the display credential checks, like the rest of `/api/display/*`):

| Method | Path | Answer |
|---|---|---|
| GET | `/api/display/family` | `FamilyDisplayState` of the request's screen: `{ today, slotNow, rev, private, hidden, showPoints, touch, qrUrl, members, chores, meals, nextReward, generatedAt }`; `404 family_off` while Familia is off |
| POST | `/api/display/family/toggle` `{ choreId, done }` | `{ ok, state }` |

A tick from the TV is accepted only when the screen has `family.touch` on, is not private, shows the routine's person,
and the request carries the screen's key, a paired device, an admin session, or comes from the local network in open
mode; otherwise `403 touch_off`. 30 ticks a minute per screen. There is no way to redeem from the TV.

`GET /api/display/config` has a `family` block: `{ enabled, mealsEnabled, showPoints, touch, qrUrl, privacy }`.
`qrUrl` is the family page (`PUBLIC_URL`, else the request's host when it is not loopback, else the first LAN
address) only when a family link exists, the screen has `family.showQr`, a kids layout with the Modern style, is not
private, and the request comes from a display we know (key, paired device, admin session, or the local network in
open mode). While private there are no stars and no touch; with `family.privacy: "initials"` names become initials,
with `"hide"` the routines are left out (`hidden: true`).

**Profile photos** (`features.familyPhotos`). A member can have `photo`: the id of a stored picture (24 hex
characters, the start of the SHA-256 of its clean bytes), shown instead of `avatar`, which stays as the fallback. The
admin crops the photo in the browser and uploads one small square. The server (`server/core/familyPhotoCore.js`)
takes JPEG, PNG or WebP only (never SVG, GIF or anything animated), at most 150 KB, square, 64 to 1024 px, and
rewrites it keeping only what draws the picture: EXIF, XMP, ICC profiles, comments, text chunks and anything after
the end of the image are dropped. Errors: `400` `empty`, `svg`, `not_image`, `animated`, `bad_size`,
`not_square`, `corrupt`; `413 too_big`; `409 too_many` (40 stored files, all in use). Files live in
`data/avatars/<id>.<jpg|png|webp>`.

`GET /media/avatars/<id>` answers with the picture (`Cache-Control: private, no-cache`, `ETag` = the id, `304` on a
match) to:

- the family page: header `X-Family-Key`, only the photos of current members;
- an admin session: any stored photo, also one uploaded and not saved yet;
- a display: link key or paired device (`?k=`), or open mode from the local network naming its screen
  (`?screen=<slug>`), only the photos of the members that screen shows, never while it is private.

Anything else gets `404` (`401` / `403` for a missing or wrong display credential, before the id is looked up).
`members[].photo` in `FamilyDisplayState` and `FamilyPhoneState` is that address, or `null` with no photo, while the
screen is private (the emoji stays) or when the file is gone. A photo the config stops using is deleted a week after
it was last used or uploaded, so a config backup restored within that week brings it back. Exports carry the photos
in `familyPhotos` (`{ id: base64 }`); an import that takes the `family` section stores the ones its config names,
after the same checks.

Activity log types: `family.chore`, `family.redeemed`, `family.points`, `family.undone`, `family.link`,
`family.key_rejected`. The family key and `/f/<key>` are redacted from logs. An export carries `familyState` (and
`secrets.family` with secrets); an import that takes the `family` section restores it (the previous file is kept as
`family.json.pre-import-<ms>`, newest 5).

## Privacy mode

Per screen, for when you have guests. The rules live in `server/core/privacy.js` (shared with Marco Cloud).

**What changes while a screen is private.** Each calendar has `privacy`: `"busy"` (default), `"hide"` or `"keep"`
(`calendar.sources[].privacy`; `localEvents.privacy` defaults to `"busy"`, `birthdays.privacy` and calendars of kind
`holidays` or `birthdays` default to `"keep"`).

- `busy`: the event keeps its id, start, end, all-day flag, kind and the calendar's colour; the title becomes "Busy"
  in the screen's language (Busy / Ocupado / Ocupado); location, description, emoji and age are removed. A rental
  checkout marker keeps its 🚪.
- `hide`: the event is left out.
- `keep`: unchanged.
- Countdowns: manual ones stay; those from events or birthdays stay only when their calendar is `keep`.
- Weather, news, announcements, scheduled messages, the to-do list and the message of the day do not change.
- `screens[].privacy.hidePhotos`: the background and the photo frame use stock photos only (gallery file names are
  not sent). `screens[].privacy.showLock` (default on): a small lock in the corner of the display.

All of this happens on the server, in `/api/events`, `/api/countdowns`, `/api/display/config` and `/api/photos`,
whatever the credential (the admin preview is a display too). The admin's own pages (Home, Countdowns, Filters
preview) keep showing real data.

**State.** Per screen `{ on, until, by, at }` in `data/privacy.json` (`until` = ISO time or `null` for "until turned
off"; `by` = `admin` or `hook`). It survives restarts; a period that has ended is ignored and pruned.

**Schedule.** `screens[].privacy.schedule`: up to 10 rules `{ id, enabled, days, from, to }` (`days`: 0 = Sunday,
`[]` = every day; `to < from` crosses midnight and belongs to the day it starts). Back-to-back or overlapping rules
count as one window.

**Who wins.**

1. A manual **on** (admin or webhook) lasts until its `until` (or until turned off), whatever the schedule says.
   When it would end inside a schedule window, it goes on until that window ends.
2. A manual **off** during a schedule window lasts until that window ends (the next schedule boundary), then the
   schedule takes over again. Outside a window it only clears the manual state.
3. Otherwise the screen is private while one of its rules is running (`by: "schedule"`).

**Reaching the displays.** Every change sends the `privacy` event (SSE and poll channel) to that screen's displays.
The server also keeps a timer for the next change (a period that ends, a rule that starts or ends) and sends the event
then. `privacy.next` in the display config tells the display when to ask again on its own, in case it missed the
event.

### Home Assistant

**Personalizado cards.** The server keeps a live copy of only the entities that saved Personalizado screens show
(and the weather entities): one WebSocket connection with `subscribe_entities` for exactly that list, never
`get_states` or every state change of the house. It reconnects with a backoff from 5 to 60 s; after 3 failures, with
a Home Assistant older than 2022.4, or on a Node version without a global `WebSocket`, it asks for those entities over
REST every 15 s. Every call to Home Assistant refuses redirects (a Home Assistant behind a redirect needs its final
URL), and the stored token is only ever sent to the saved URL: *Probar conexión* with another URL needs that URL's
token too (`{ ok: false, error: "new_url_needs_token" }`). The token is tied to the URL it was saved for
(`PUT /api/admin/homeassistant/token` takes `{ token, url? }`): when the saved URL changes, in the admin or through
an imported file, the old token is not used until it is saved again for the new URL (*Probar conexión* answers
`{ ok: false, error: "token_other_url" }`). Admin routes (session): `GET
/api/admin/homeassistant/entities?domain=light,switch` (name, state, unit, domain, device_class, area, icon and the
attributes the builder uses; areas need a token of a Home Assistant administrator, otherwise `area` is `null`),
`GET /api/admin/homeassistant/status` (`{ state: "connected" | "polling" | "error" | "off", reason?, lastEventAt,
count, watched }`), `POST /api/admin/homeassistant/slim` (`{ entities }`, up to 80: slim states for items the builder
has not saved yet), `GET /api/admin/homeassistant/history?entity=&period=` and `POST /api/admin/homeassistant/action`
(`{ entity, kind, control, value?, props? }`: the editor's *Probar* button, with the same allowlist and clamping as a
screen; the screen's touch switch does not apply, the owner is the one pressing).

**Controls on a touch screen.** A Personalizado screen may let people use the Home Assistant cards by touching it
(*Permitir tocar en la pantalla*, off by default; each card can then be left out). `POST /api/display/ha/action`
checks, in this order, and answers the first refusal:

| Check | Error |
|---|---|
| The body is JSON | `415 json_required` |
| `Sec-Fetch-Site` (when sent) is `same-origin` and `Origin` (when sent) is this server | `403 cross_origin` |
| `item`, `slot`, `control` present | `400 bad_request` |
| The item is on the requesting screen (any screen of its carousel), with that slot and a kind with controls, and no condition hides it now | `404 not_found` |
| The display uses its private link key or a paired device: never open access without a credential, never an admin session | `403 untrusted` |
| The screen is not private right now | `403 private` |
| The screen allows touch | `403 touch_off` |
| The item (and a room's row) may be touched, and the control is one the card offers for that entity now | `403 not_allowed` |
| The value is valid; numbers are clamped (brightness 1 to 100, colour temperature within the light's range, setpoints within the climate's range on its step with low below high, 0 to 100 for fans, covers and valves, 0 to 1 for volume, a number entity within its `min` and `max` on its `step`) and modes and options must be ones the entity has | `400 out_of_range` |
| At most 20 actions per 10 s per screen and 5 per second per credential | `429 rate` |
| A card that needs two taps sends the second one (or a press and hold) with `confirm: true` | `409 confirm_needed` |
| Home Assistant answers | `503 ha_down`, `502 ha_error` |

Only these services are ever called: `toggle`, `turn_on`, `turn_off` (light, switch, input_boolean, fan), brightness
and colour temperature (`light.turn_on`), `fan.set_percentage`, `climate.set_temperature`, `set_hvac_mode`,
`set_fan_mode`, `cover.open_cover`, `close_cover`, `stop_cover`, `set_cover_position`, `media_player.media_play_pause`,
`media_next_track`, `media_previous_track`, `volume_set`, `scene.turn_on`, `script.turn_on`, `button.press`,
`valve.open_valve`, `close_valve`, `stop_valve`, `set_valve_position`, `select.select_option` and
`input_select.select_option` (an option the entity has), `number.set_value` and `input_number.set_value`, and
`vacuum.start`, `pause` and `return_to_base`, on the entity the card was given. Locks, alarms, gas valves (device
class `gas`, or the word "gas" in the entity id, its name or the card's name, since many integrations set no
device class), garage doors and gates are only shown, and so are updates. A switch, script, button or cover whose device class, id or name
looks like a door, a gate or a lock (in any of the five languages), and a valve of device class `water` (the house's
water), needs the owner's tick in the editor before it can be used at all, and then always two taps; its log entries
say so. That check is a
speed bump: the safest thing is not to put such entities on a screen anyone can touch. Each action is logged as
`ha.action` (throttled), never with the token.

**Entidad rows.** An Entidad card (`ha.tile`) can have a row under it, chosen per card (`props.features`, at most
three) or, when not chosen, worked out on the server from the entity's attributes: brightness and colour temperature
for a light, up, stop and down and the position for a cover, open and close for a valve, −/+ (on the entity's step)
and the modes for a climate, the options of a select, a slider or −/+ for a number, start, pause and back to the dock
for a vacuum, the versions of an update, a bar for a percentage sensor. Each state the display gets lists them
(`f`); the controls they open are in `c` as for every card.

**Estadística.** `GET /api/display/ha/statistic/:item` answers `{ stat, period, value, unit }`: the change, mean,
minimum or maximum of a sensor today, this week or this month, from Home Assistant's long-term statistics
(`recorder/statistic_during_period`, over the mirror's WebSocket connection). Kept 5 minutes and shared by every
screen; a failure is kept 15 s. The editor's preview uses `GET /api/admin/homeassistant/statistic?entity=&stat=&period=`.

**Mostrar solo si.** Any Personalizado item can have a condition (`item.when`): a Home Assistant entity's state or a
Valor key is equal to, not equal to, above or below a value. The server mirrors the entities those conditions read and
works the conditions out itself: the display config only says which feed decides (`when: { src: "ha" | "value" }`),
never the entity, the key or the value, and the `ha` and `values` snapshots and events of a screen with conditions
carry `hide`, the ids of the items hidden now. A hidden item gets no states and no values, its history, statistic and
camera routes answer `404 hidden` and its controls `404 not_found`. A private screen hides every item with a
condition. A new reading of a condition's entity or key is sent to the screens only when it shows or hides an item,
so a display never learns when something it does not show changes. Valor conditions work on Marco Cloud too.

**Horario.** Any Personalizado item can also have a visibility schedule (`item.schedule`, up to 6 windows with the
shape of privacy schedule rules: `{ id, enabled, days, from, to }`, days 0 = Sunday, `[]` = every day, `to < from`
crosses midnight). Outside its windows the item is left out of `GET /api/display/config` altogether (it keeps its
cells) and gets no states, values or data; a paused window does not count and no enabled window means always. The
canvas block carries `next`, the ISO time a window of one of its items starts or ends next, and the display asks for
its config again a few seconds after it. The schedule itself never reaches a display.

**Sizes.** A Personalizado item on the main grid (24×16 cells on a landscape screen, 16×24 on a portrait one;
`CANVAS_GRID`, `gridDims(orientation)`) has a position `{ zone: "main", x, y, size }` where `size` is a named size
(`xs`, `s`, `m`, `w`, `t`, `l`, `xl`, `band`, `full`, `row`, `sq`; `sizeCells(size, orientation)` gives their cells,
`CANVAS_SIZES` holds them in cells of the old 12×8 grid, half as many each way). It may also carry its own `w` and `h`,
whole cells from 1 to 24: then the box is `w`×`h` and `size` is the named size it is drawn like (the largest of its
kind's sizes that fits in the box). Each kind has a range (`cellRange(kind, orientation)`): from its smallest box
(`CANVAS_KINDS[kind].fine`, else twice the first two numbers of `CANVAS_KINDS[kind].cells`, which are written in old
cells) to twice its largest, widened to hold its named sizes; on a portrait screen at most 16 wide, and a kind that may
take the whole height takes all 24 rows. A box smaller than twice the kind's old smallest (`fullLookMin(kind,
orientation)`) is drawn in a compact look. Saving clamps a box to its kind's range (a warning); a box narrower or lower than the kind's `fine` smallest is allowed
only when it holds one of the kind's named sizes (`boxAllowed`). A box saved smaller than its kind's smallest grows
to it where there is room (in place or at the nearest free spot, a warning) and stays as it was when there is none.
Saving also stores a box that is
exactly a named size as the name alone, and refuses `w` without `h` or a value that is not a whole cell (an error; the
named size is used). The portrait view drawn from the landscape one keeps a box of its own (at most 16 wide) before it
tries the named sizes. The display config carries `w` and `h` as they are; sidebar items keep their `span` (2, 3, 4 or
`fill`). A screen takes up to 48 cards (a Rotativa's cards count) and 80 Home Assistant entities (`CANVAS_LIMITS`; each
kind's own cap comes on top).

**Grid and density.** Every canvas is on the 24×16 grid, and a saved one carries `grid: "fine"`. `grid` is deprecated:
it is accepted on input for older clients and never changes the grid, but a canvas without it, or with `"normal"` (or
any other value), is read as one saved before 0.17 on the old grid of 12×8 cells (8×12 portrait). Such a canvas is
converted when it is read, by the validation (`sanitizeCanvas`, so every save, the config import and the screen file
import), by the display projection (`projectCanvas`) and by `upgradeCanvasGrid(canvas)`: every `x`, `y`, `w` and `h`
of the main grid is doubled, in both orientations (a portrait arranged by hand too), sidebar spans and everything else
stay, so the screen looks exactly the same; it is saved with `grid: "fine"` from then on, and converting again changes
nothing. A self-hosted server also rewrites its config file converted once at start, after a backup of the file as it
was (`config-<time>-r<revision>-save.json`). `canvasLimits(grid)`, `CANVAS_LIMITS_FINE` and `canvasGrid(canvas)` are
kept for older code and answer the one grid. `density: "compact"` (written only when chosen) draws the cards with
tighter gaps, less padding and smaller titles. The display config carries both.

**Rotativa.** The kind `rotator` (category *Contenido*, every edition, at most 4 per screen) is one slot that shows its
cards one after another: `{ cards: [{ id, kind, props }], everySec, dots }`. `cards` holds 2 to 6 cards (at most 6;
the editor keeps at least 2), each a kind of its own validated by that kind (`rotatorKindOk`: never another `rotator`,
`spacer`, `heading` or a navigation card; a kind the server does not allow is refused, so on Marco Cloud no Home
Assistant card); each card has an id like an item's, unique on the screen. `everySec` is 5 to 120 (default 10), `dots`
a boolean (default true). The cards count towards the cards of a screen (48) and towards each kind's own
cap, their entities towards the screen's (80), and the box of a Rotativa is kept within what all its cards allow
(`kindFor(item)`). A Rotativa's cards share its hiding, schedule and condition: every feed walks them like items
(`canvasCards(items)`), so a card inside gets its Home Assistant states under aliases of its own id (`<cardId>:<n>`),
its values, its data, its widget and its calendars, and gets nothing while its Rotativa is hidden. They are never touch
controls (a control on one answers `not_found`); a camera inside shows pictures. In the display config each card is
projected like an item (`{ id, kind, props, v, disabled? }`, entity ids replaced by aliases, `privacy` placeholders
on a private screen).

**Navigation (touch screens).** Three kinds in the palette category *Navegación* (`cat: "nav"`, every edition):
`nav.button` (*Ir a pantalla*: `{ target, label, icon, show, returnMin }`), `nav.pause` (*Pausar carrusel*: `{ label,
icon, show, returnMin }`) and `nav.progress` (`{ style: "dots" | "bar", name, time }`). `target` is a screen id,
`"home"` (the screen or carousel the device is bound to) or `""` (not chosen; a deleted screen's id becomes `""` on
save); `icon` is an emoji or a built-in icon `i:<name>` (`NAV_ICONS`: home, back, prev, next, grid, pause, play, star,
photo, calendar); `show` is `both`, `icon` or `text`; `returnMin` (0 to 120, default 5, 0 = never) is how long the device
waits without a touch before it goes back to its own screen or carousel. The canvas has `swipe` (boolean, default
`false`): with touch on, a sideways swipe goes to the carousel's next or previous screen. In `GET /api/display/config`
the canvas block has `taps` (`touch` on, the screen not private, and a trusted display: a link key, a paired device,
an admin session, or open mode from the local network) and `swipe` (`swipe` while `taps`); a `nav.button` carries
`targetName`. The buttons are drawn only while `taps` is on. Everything a tap does happens on the device: a screen of
its carousel becomes the step on screen with its full time (the carousel goes on from there), any other screen is
fetched with `?screen=<id>` like a carousel step and stays, and the pause stops the rotation; the device keeps only
`{ mode, screenId, returnMin, until }` in its own storage, and nothing is written to the server. A key or device may
read the screens the *Ir a pantalla* cards of its own screens lead to, and the screens those lead to
(`core/carousels.js reachableScreens`), and their photos; nothing else.

**One screen as a file.** The editor's *Exportar esta pantalla* writes `{ format: "marco-screen", version: 1, canvas,
picks, theme?, glass? }` with no calendar ids, family member ids, Home Assistant entity ids, saved widget ids or screen
ids of *Ir a pantalla* (they are emptied and `picks` lists, per item id, what each card lost: `calendars`, `people`,
`entities`, `widget`, `screen`). Valor
keys, coins, teams and symbols stay. Importing it (`canvasCore.readCanvasFile`, in the editor) empties those
references again, gives every item a new id, leaves out the kinds this server does not offer (and, on Marco Cloud,
Home Assistant conditions), and validates the result like a save; nothing is stored until the editor is saved.

**Cameras.** A Cámara card shows a picture of a Home Assistant camera, new every 2 to 60 s (every 10 s at the
fastest in lite mode or on a slow device), and nothing while the page is hidden. After 3 pictures in a row that did
not come it says *Sin señal*. *En directo* streams the camera through Home Assistant's `/api/camera_proxy_stream`: smooth
for cameras that send MJPEG, about 2 pictures a second for most others (RTSP cameras such as Reolink, Tapo or UniFi).
One live camera per screen; never in lite mode, on a slow device or in the editor's preview (they use pictures
instead). The server opens one stream per camera whatever the number of screens showing it, at most 4 cameras and 8
viewers in all, reads every part, drops anything that is not a JPEG, PNG, WebP or GIF, ends the stream on a part over
2 MB, and sends the pictures on with its own boundary, at most 10 a second (the newest one; a camera that sends
60 a second would otherwise cost a screen megabytes a second to download and read). The stream to Home Assistant closes when the last viewer
leaves. `showWhen` (a binary sensor) shows the card only while that sensor is on, for example a motion sensor.
*Cámaras solo en la red de casa* (on by default, `homeassistant.cameraLanOnly: false` turns it off) answers camera
pictures (and the cover art of Multimedia cards) only to displays connected straight to the home network: a request from outside or through a reverse proxy
gets `403 lan_only`, so a display link opened through `PUBLIC_URL` or a tunnel does not show the inside of the house.
The editor's preview gets its pictures from `GET /api/admin/homeassistant/camera?entity=camera.x` (session).

**Webhooks.** Create a token in *API & webhooks*, then in `configuration.yaml`:

```yaml
rest_command:
  marco_privacy:
    url: "http://192.168.1.50:3000/api/hooks/privacy"   # the address of your Marco server
    method: POST
    headers:
      Authorization: "Bearer TOKEN"
    content_type: "application/json"
    payload: '{"mode": "{{ mode }}"{% if hours is defined %}, "hours": {{ hours }}{% endif %}}'

automation:
  - alias: "Marco: private mode while there are guests"
    triggers:
      - trigger: state
        entity_id: input_boolean.guests
    actions:
      - action: rest_command.marco_privacy
        data:
          mode: "{{ 'on' if trigger.to_state.state == 'on' else 'off' }}"
```

`hours: 3` in `data` turns it on for three hours. To show the state in Home Assistant:

```yaml
sensor:
  - platform: rest
    name: "Marco private mode"
    resource: "http://192.168.1.50:3000/api/hooks/privacy"
    headers:
      Authorization: "Bearer TOKEN"
    value_template: "{{ 'on' if value_json.screens | selectattr('active') | list | count > 0 else 'off' }}"
    scan_interval: 60
```

### Doorbell camera

`POST /api/hooks/doorbell` puts the doorbell camera full screen on the screens for a while. Omitted fields take the
values of *Admin → Home Assistant → Doorbell and camera* (`homeassistant.doorbell` in the config).

| Field | Meaning |
|---|---|
| `action` | `"ring"` (default) or `"dismiss"` |
| `seconds` | how long the picture stays, clamped to 10 to 300 (default: the setting, 60) |
| `screens` | slugs or ids. Ring: omitted = the screens of the setting (all by default). Dismiss: omitted = every ringing screen |
| `camera` | a `camera.*` entity for this ring only (default: the setting). Anything else is `400` |
| `sound` | door chime on the screens (default: the setting, on) |

- A ring while the screen is already ringing keeps the same ring and moves its end to the later of the two times
  (it never gets shorter), and the screens chime again.
- `{ ok, action: "ring", delivered, screens: [slug], expiresAt }`; `{ ok, action: "dismiss", delivered, screens }`
  lists the screens that were ringing. Each call is logged in *Activity* (`display.doorbell`).
- The screens fetch `GET /api/display/doorbell/frame` 1 to 2 times a second while the ring lasts. Marco asks Home
  Assistant for `/api/camera_proxy/<camera>` with the stored token and hands the picture to the screen; displays that
  ask within 500 ms share one picture, so Home Assistant gets about two requests a second whatever the number of
  screens. Pictures are kept in memory only for those 500 ms and never written to disk. The token and the camera
  entity never reach a screen. Rings are kept in memory: after a server restart nothing rings.
- The overlay shows above night mode: a dimmed screen is fully lit while it rings and goes back to night mode when the
  ring ends. A screen turned off by an HDMI schedule (`deploy/screen-schedule.sh`) stays off.
- The chime uses the screen's alert volume (*Alerts*). The kiosk (`deploy/kiosk.sh`) starts Chromium with
  `--autoplay-policy=no-user-gesture-required`, so it plays without a tap; other browsers may stay silent until
  someone has touched the page once.
- Without a camera (`camera: ""`) the screens show a bell and "Someone is at the door".

**Servers with snapshots instead of a live camera** (`features.doorbell` on, `features.doorbellLive` off: Marco Cloud,
which cannot reach Home Assistant) take the picture with the ring. `POST /api/hooks/doorbell` then also accepts
`multipart/form-data` with an `image` file and the same fields as form fields (`screens` comma separated), or a raw
`image/jpeg`, `image/png` or `image/webp` body with the fields in the query (`?seconds=60&screens=hall`). The picture is
checked by its first bytes and may be 2 MB at most (`413`, `415` otherwise). Only the latest picture of the household is
kept, only while a screen rings and 10 minutes at most, and `GET /api/display/doorbell/frame` returns it to screens
that ring (`404 { code: "no_camera" }` when there is none, `refreshMs` is a few seconds). A picture sent without
`action` while the screens already ring replaces the one they show and makes the ring last longer, without a second
chime (with `action: "ring"` it rings again). A new ring without a picture never shows the picture of an earlier
one. `camera` is refused there. The admin shows the doorbell card on the *API & webhooks* page, with a test that sends a sample
picture (`POST /api/admin/doorbell` takes the same multipart form).

Home Assistant example (`configuration.yaml`; replace `marco.local`, the token and the entity ids with your own):

```yaml
rest_command:
  marco_doorbell:
    url: "http://marco.local:3000/api/hooks/doorbell"
    method: POST
    headers:
      Authorization: "Bearer cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    content_type: "application/json"
    payload: '{"action":"{{ action | default(''ring'') }}","seconds":{{ seconds | default(60) }}}'

automation:
  - alias: "Doorbell on the Marco screens"
    trigger:
      - platform: state
        entity_id: binary_sensor.front_door_doorbell
        to: "on"
    action:
      - service: rest_command.marco_doorbell
        data:
          action: ring
          seconds: 90
    mode: single

  - alias: "Front door opened: take the camera off the screens"
    trigger:
      - platform: state
        entity_id: binary_sensor.front_door_contact
        to: "on"
    action:
      - service: rest_command.marco_doorbell
        data:
          action: dismiss
```

With curl:

```bash
TOKEN=cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"ring","seconds":60,"screens":["kitchen"],"camera":"camera.front_door"}' \
  http://marco.local:3000/api/hooks/doorbell
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"dismiss"}' http://marco.local:3000/api/hooks/doorbell
```

