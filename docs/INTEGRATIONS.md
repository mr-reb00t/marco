# Integrations

How to connect Marco to calendars and other services. Each one is optional. Unless it says otherwise, the server
does the fetching and keeps any token or key in `data/secrets.json`: screens never talk to these services and never
see the keys.

**Contents:**
Calendars: [iCal / ICS feeds](#ical--ics-feeds) · [Vacation rentals](#vacation-rentals) ·
[Google Calendar](#connecting-google-calendar) · [Google Tasks](#4-google-tasks-optional) ·
[Outlook / Microsoft 365](#connecting-outlook-hotmail-or-microsoft-365) · [Apple iCloud](#adding-an-apple-icloud-calendar)
<br>
Home: [Home Assistant](#home-assistant) · [Doorbell camera](#doorbell-camera) ·
[API tokens and webhooks](#api-tokens-and-webhooks)
<br>
Screens: [Weather](#weather) · [News](#news-rssatom) · [Spotify](#showing-what-plays-on-spotify) ·
[Mealie](#meal-plan-from-mealie) · [Immich](#immich-photo-albums) · [Electricity prices](#electricity-prices) ·
[Commute times and exchange rates](#commute-times-and-exchange-rates)

Crypto, sports, stocks and pushed values are cards of a Custom screen: see
[Data cards](GUIDE.md#data-cards).

## Calendars

### iCal / ICS feeds

Any `http(s)://` or `webcal://` URL: school, sports club, work, public holidays (presets for several countries in
*Calendars → Quick add*), vacation-rental platforms. *Test* shows how many events were read. If the feed uses a
**self-signed certificate**, enable *Self-signed certificate* on that source only (or add your CA with
`NODE_EXTRA_CA_CERTS`). A failing feed never breaks the others; errors show in *Status* and *Activity*.

### Vacation rentals

Set the type to *Vacation rental*. Airbnb's "Reserved" / "Not available" entries become "Reservation · Guest" bars
(blocked dates can be hidden with a filter); feeds that already format titles like `🏠 Guest - 4p+1m` keep their
emoji and turn guest counts into icons; `Adults: 2 / Children: 1 / Infants: 1 / Pets: 1` lines in the description
(also `Adultos/Niños/Bebés/Mascotas`) give 🧑🏻🧑🏻 🧒🏻 👶🏻 🐶.

## Connecting Google Calendar

You have two options. **OAuth** (recommended) gives near-real-time updates and lets you pick calendars from a list;
the **secret iCal address** needs no setup at all but updates slowly. Both are read-only.

### 1. Create a Google Cloud project and OAuth client

1. Go to <https://console.cloud.google.com/>, sign in and **create a project** (e.g. `marco`).
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**. For Google Tasks on the to-do list,
   enable **Google Tasks API** too.
3. Open **Google Auth Platform** (formerly "OAuth consent screen"):
   - **Branding**: app name (e.g. *Marco*), your support email, developer contact email. Save.
   - **Audience**: user type **External**. Under **Test users** add your own Google address (and the address of
     anyone else whose calendars you want to link).
   - **Data access** (optional): you can add the scopes `openid`, `email`, `profile` and
     `https://www.googleapis.com/auth/calendar.readonly` (and `https://www.googleapis.com/auth/tasks` for Google
     Tasks); Marco requests them anyway.
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
`PUBLIC_URL=https://calendar.example.com` and register `https://calendar.example.com/auth/google/callback`. How to
set up Caddy or a Cloudflare Tunnel, and the `X-Forwarded-For` and `TRUST_PROXY` rules a proxy needs, are in
[Remote access with HTTPS](INSTALL.md#remote-access-with-https).

**Option C: no OAuth, the secret iCal address.** In Google Calendar on the web → ⚙️ *Settings* → pick the calendar →
*Integrate calendar* → **Secret address in iCal format**. Add that URL as an **iCal** source. No Google Cloud project
needed; however Google refreshes this feed with a delay (minutes to hours) and anyone with the URL can read the
calendar, so treat it like a password. This address leaves out the birthdays from Google Contacts: link the account
(Option A or B) or import your contacts in *Birthdays → Import contacts* (a .vcf file exported from
contacts.google.com; it is read in your browser and never uploaded).

### 3. Pick your calendars

**Admin → Calendars → Google accounts → Link account**, accept the permissions, then tick the calendars to show.
Each one becomes a source you can rename and give an emoji, colour and **type**: e.g. a calendar that only contains
birthdays → type *Birthdays* (🎂 and ages), a holiday calendar → *Holidays*. You can link several Google accounts.
The birthdays of your Google Contacts come with the primary calendar and show with the birthday emoji. When the same
person and day is also in Marco's own *Birthdays* list, that screen shows only Marco's entry (it has the age).

**Signing in to the admin** uses the server's password. Google is for calendars only: "Sign in with Google" is off
on a home server. If you really want it (for example to turn the password off), set `MARCO_GOOGLE_LOGIN=1` in `.env`,
then add the allowed addresses in **Security → Allowed Google emails**. Servers that already sign in with Google only
(password off, allowed emails set) keep it.

### 4. Google Tasks (optional)

**Admin → To-do → Google Tasks lists → Link Google account** asks for access to your task lists (an account already
linked for its calendars asks once more), then tick the lists to show. Their open tasks show on the screen with the
typed ones, with their due date, and are read every 5 minutes. With **Allow ticking by touching this screen** on, a
task tapped on a touch screen is marked done in Google Tasks too. It needs the **Google Tasks API** enabled in the same
Google Cloud project (step 1); the admin tells you when it is off. Not in Marco Cloud.

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
     `localhost`; see [the redirect URI options](#2-the-redirect-uri-problem-and-three-ways-around-it)).
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

## Home Assistant

Marco connects to your Home Assistant on your own network. In Home Assistant open your **profile → Security →
Long-lived access tokens → Create token**; in *Admin → Home Assistant* enter its local address (for example
`http://homeassistant.local:8123`) and the token, then *Test connection*. In *Weather* you can then choose a
`weather.*` entity and/or indoor temperature/humidity `sensor.*` entities.

| | |
|---|---|
| ![Home Assistant page: local URL, the saved token and the weather and indoor entities](screenshots/admin-homeassistant.webp) | ![A Home Assistant light card picked in the editor, with its entity, what to show and touch options](screenshots/admin-builder-homeassistant.webp) |

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
  [API tokens and webhooks](#api-tokens-and-webhooks) and [Doorbell camera](#doorbell-camera).

Marco Cloud cannot reach a Home Assistant inside your home, so these cards are for self-hosted servers. The *Value*
card and webhooks work on both.

### Doorbell camera

When someone rings, Home Assistant tells Marco and the screens show the camera full screen for a few seconds, with a
door chime. It also wakes screens in night mode while it lasts. Set it up in *Admin → Home Assistant → Doorbell and
camera*: the camera (`camera.*`; without one the screens only show the notice), the time on screen (10 to 300
seconds; ringing again makes it longer), which screens, the door chime, and a test button. Your Home Assistant
automation then calls `POST /api/hooks/doorbell` with an API token; the fields and examples are in
[API.md](API.md#doorbell-camera).

## API tokens and webhooks

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
(rate limit). Pushing values for the *Value* card is in [Data cards](GUIDE.md#data-cards). Full reference:
[API.md](API.md).

On Marco Cloud the same calls work against `https://app.marcohome.app/api/hooks/...` with a token made in its admin
(*API & webhooks*), so the same scripts, automations and iPhone Shortcuts keep working after a move. There a household
can also send at most 500 alerts and commands a day through its tokens.

## Weather

Set the location (search by name or coordinates) and units in *Weather*, then pick the source in
*Weather → Data source* (`weather.provider`). All of them are free:

| Source | Key | Notes |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/) (default) | none | Picks the best model for your area, or the one you choose in *Forecast model* (`weather.model`: `best_match`, `ecmwf_ifs`, `icon_seamless`, `gfs_seamless`, `meteofrance_seamless`, `ukmo_seamless`, `gem_seamless`, `jma_seamless`). Some models have no chance of rain or UV index, or fewer days; those values are left out. Free for non-commercial use; data under CC BY 4.0. |
| [MET Norway](https://api.met.no/) | none | Locationforecast 2.0 of the Norwegian Meteorological Institute, worldwide. Chance of rain only in the Nordic countries; sunrise and sunset are computed. Marco identifies itself with its User-Agent and waits for the `Expires` time the service gives (about 30 minutes). Data under CC BY 4.0 and NLOD. |
| [Pirate Weather](https://pirateweather.net/) | your own, free | Create a key at [pirate-weather.apiable.io](https://pirate-weather.apiable.io/) and paste it in *Weather*. The free plan allows 10,000 calls a month; Marco asks at most every 15 minutes (about 3,000). The key is checked once and kept in `data/secrets.json`. |

Every source is cached per place for at least 10 minutes and shared by all the screens and languages; if the
source fails, the screens keep the last forecast for up to 6 hours. The screens show the source's name in small
type next to the weather (*Open-Meteo*, *Open-Meteo · ECMWF IFS*, *MET Norway*), as the CC BY licence asks. Indoor
sensors and a `weather.*` entity can come from [Home Assistant](#home-assistant).

## News (RSS/Atom)

Add any feed in *News*. Some sites block non-browser clients; the server already uses a desktop browser User-Agent.
Use *Test* to check a feed.

## Showing what plays on Spotify

A screen can show what someone is listening to on Spotify: the song (or the podcast episode), the artist and the
cover. Marco only reads what plays; it never controls playback. Pausing or stopping hides it. There are two ways to
show it:

- the **Now playing** card of a *Custom* screen (*Content* group of the builder), with or without the cover and a
  thin progress bar that moves along with the song;
- **Now playing under the clock** in *Layout → Appearance* for the other layouts: one line under the date, which
  slides when it is long and is gone when nothing plays.

Each card and each screen picks the account it shows, so the kitchen can show one person and the living room another.
Spotify asks every household to use its own (free) Spotify app, so each home has its own API limits:

1. Open <https://developer.spotify.com/dashboard> and **Create app** (any name and description).
2. Under **Redirect URIs** add exactly the address *Admin → Spotify* shows, with its copy button. Spotify accepts
   `https://` addresses, and `http://` only for `127.0.0.1` or `[::1]` ("localhost" is refused).
   - With an https address of your own (set `PUBLIC_URL`, for example behind Caddy), it is
     `<PUBLIC_URL>/auth/spotify/callback` and Spotify comes back to the admin by itself.
   - On plain `http://` in the home network the page shows `http://127.0.0.1:<port>/auth/spotify/callback`. After
     you allow access, your browser opens that address and the page does not load: copy its address and paste it in
     the field under *Connected accounts*. Marco finishes the link from there.
3. Tick **Web API**, save, and copy the **Client ID** and **Client Secret** (*Settings*) into *Admin → Spotify*.
4. While the app is in *Development mode*, add everyone who will connect an account under **User Management**.
5. **Connect a Spotify account**, once per person. Marco asks only for `user-read-currently-playing` and
   `user-read-playback-state`.

The Client Secret and the tokens stay in `data/secrets.json`; the admin only says a secret is saved, and screens only
know an account by an opaque id. Marco asks Spotify at most every 10 seconds per account, and only while a screen
showing it is on (sooner when a song is about to end), waits for Spotify's `Retry-After` when it asks for a pause and
backs off after errors. Covers come through the server, so screens never load anything from Spotify. *Disconnect*
deletes an account's tokens; to remove Marco's access on Spotify's side too, go to
<https://www.spotify.com/account/apps/>.

## Meal plan from Mealie

If you plan meals in [Mealie](https://mealie.io) (2.0 or newer, self-hosted), *Content → Meals → Mealie* puts that
plan on the screens. Type Mealie's address (for example `http://mealie.local:9925`), paste an API token (in Mealie:
your profile → *API Tokens*) and press *Test connection*: it shows Mealie's version and how many meals it found for the
next two weeks.

- Per day and meal, what Mealie has replaces Marco's own plan; the meals Mealie has nothing for keep Marco's week or
  template. Only the meals turned on in *Meals of the day* show.
- Mealie's breakfast, lunch, snack and dinner are Marco's meals. Sides, drinks and desserts are added after that
  day's dinner ("Spaghetti · Green salad"). Several entries for one meal are joined with " · ".
- **Show the dinner's photo** (on by default): when the dinner's recipe has a picture, the *Today's meals* card and
  the Family kids layout show it in the dinner's tile. A screen in privacy mode with *hide photos* does not.

Marco reads the plan at most every 15 minutes (this week and next) and keeps the last good plan when Mealie is
down. The token stays on the server: it never reaches a screen, is never shown again in the admin, and is only sent
to the address it was saved with. Photos go through this server too, and only for the recipes in the plan. Mealie
also offers the plan as an iCal feed, which you can add in *Calendars* if you would rather see meals as events.
Marco's own meal planning is in [GUIDE.md](GUIDE.md#family-routines-stars-and-meals).

## Immich photo albums

Albums from your [Immich](https://immich.app/) library can be the background photos. In *Admin → Immich*, *Enable
Immich*, enter the *Immich server URL* (a local address, e.g. `http://immich.local:2283`; tick *Self-signed
certificate* if it uses one) and an *API key* created in Immich (*Account settings > API keys*) with `album.read`,
`asset.read` and `asset.view`. Then choose which albums each screen shows in *Background > Background photos*, or use
an album in a special background rule ([Photos](GUIDE.md#photos)). The photos go through this server: the key never
reaches the screens.

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

## Commute times and exchange rates

- **Commute times:** a widget with live travel times from Google for up to 8 saved routes, asked with your own
  Google Maps API key (Routes API) entered in *Admin → Widgets* (or `GOOGLE_MAPS_API_KEY` in `.env`). A screen never
  sees the key or the addresses. Details: [API.md](API.md#commute-times).
- **Exchange rates:** a currency widget, or a card of the *Data* group, with 1 to 6 currency pairs and a 7 day, 30 day
  or 1 year chart. Details: [API.md](API.md#exchange-rates).
