# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- One card or another in the same place, depending on Home Assistant (#19). Each card inside a *Rotating card* now has
  its own *Show* setting, like any card on the screen: a card whose condition is not met is skipped, the same way an
  empty card is. With a motion sensor, for example, the hall light shows while all is clear and the camera when
  someone moves. When only one card is left the Rotating card stays on it with no dots, when none is left it is hidden,
  and a change of state switches the card at once instead of at the next turn. The Rotating card's settings say how to
  do it, and the *Home (Home Assistant)* group of the palette has *Swap with Home Assistant*: a Rotating card with an
  entity card and a camera, each with a condition ready for you to pick the entity. A condition can also read a value
  sent to Marco (*Depending on a value*), so this works on Marco Cloud too.

### Changed
- *Gauge* goes down to 3×1 on the grid (it stopped at 4×1, #9). At 3×1 the name and the number share one line with the
  thin bar under them, in the colours of its thresholds; when the name does not fit whole, the card shows the number
  and the bar alone, never a name cut to a few letters.

## [0.19.1] - 2026-10-20

### Changed
- The language picker is a menu now: the panel's sidebar and the setup wizard show the current language by its own
  name, and a click (or Enter, Space or the arrow keys) lists all six with the current one checked. It replaces the
  row of six buttons in the sidebar and the six cards on the wizard's first step, which no longer fit well on a phone.

## [0.19.0] - 2026-10-20

### Added
- Polish (#17): every admin and family page text, the screen's words, dates and numbers, weather descriptions, private
  mode titles, backup summaries, the pairing and welcome screens, the setup wizard and the demo, with Polish count
  forms ("1 ekran", "3 ekrany", "5 ekranów"). Long dates read "Poniedziałek, 12 października". The translation is
  ours: reviews and corrections from native speakers are very welcome (see *Adding a language* in CONTRIBUTING.md).
- Icon rules and the emoji search: Polish keywords (about 200 more keywords). Existing installs get them once on the
  next start; rules you changed keep your emoji and your own keywords, and nothing is removed.
- Holidays: a quick-add calendar for Poland, and holiday names from the Polish Google feed shown in every language.
- Vacation rental and birthday titles in Polish are recognised ("Niedostępne", "Rezerwacja", guest lines with "Gość",
  "Urodziny: Ania").
- *Family access* in *Family → Access*: each person of the household can get a dashboard of their own on the phone
  (`/my`), without the admin password. Add a person (optionally one of the family members), tick what they may do
  (send a message to all screens or to chosen ones, turn private mode on or off, switch night, day or auto mode on
  every screen, add to-dos, add events to the local calendar) and send them their private link, or show a code on
  one of the screens for two minutes: they type it on their phone, or scan the QR code next to it. Every phone that
  gets in is listed and can be removed alone; removing the person stops their link, phones and codes at once. Every
  action is checked on the server against what the person may do at that moment, and each one is in the activity log
  with their name. Codes only show on screens opened with their private link or paired, never on one in open display
  access mode. A person has at most 3 messages on the screens at once, and their messages never take down an
  announcement someone else sent. An export with private data keeps the people and their phones (#16).
- *Now playing* with Spotify (#18): a screen can show what someone is listening to on Spotify, the song (or podcast
  episode), the artist and the cover. On a *Custom* screen it is the *Now playing* card, with an optional thin
  progress bar that moves along with the song; on the other layouts it is *Now playing under the clock* in *Layout →
  Appearance*, one line under the date. Both are gone when nothing plays, and each card or screen picks the Spotify
  account it shows. Marco only reads what plays and never controls playback. Each household links its own Spotify app
  in the new *Spotify* page (Client ID and Client Secret from Spotify's developer dashboard, with the exact Redirect URI
  to register and a step-by-step guide); a server on plain http finishes the link with a pasted address. Spotify is
  asked at most every 10 seconds per account and only while a screen shows it, and covers come through the server.
  An account whose access was removed shows *Connect again* (it keeps its place on every screen) and a warning on the
  home page; a rotated Client Secret only asks for the new secret, never for a new sign in.

### Changed
- Search, keyword rules and screen addresses treat "ł" as "l", so "pilka" finds "piłka" and a screen called
  "Łazienka" gets the address "lazienka".
- Home Assistant: a switch or button whose name says door, gate or lock in Polish ("Brama", "Drzwi", "Zamek") asks
  for the owner's tick and two taps, and a valve named "gaz" is a gas valve.

## [0.18.1] - 2026-10-20

### Changed
- *Special backgrounds*: an event rule can look for several words at once, separated by commas (for example
  `14 @, 14u vs`), and matches when the title has any of them. The text can be up to 120 characters (#14).

## [0.18.0] - 2026-10-20

### Added
- Each to-do card has its own settings: which lists (all of them, or some of *Tasks typed in Marco* and the Microsoft
  To Do lists, shown with their account in the editor), a title (the usual one, the list's name when there is one
  list, or your own), an icon, and which tasks (all, only the important ones, or only those due today or overdue).
  A *Personalizado* screen can show up to four to-do cards, for example *Shopping* and *Chores* side by side. Classic
  screens get the same settings on the To-do page (#15).

## [0.17.1] - 2026-10-20

### Fixed
- Microsoft To Do lists showed no tasks: Microsoft refused the way Marco asked for them (HTTP 400). The tasks now load
  (#15). A list that can't be read now logs Microsoft's own error code.

## [0.17.0] - 2026-10-20

### Added
- *Special backgrounds* in *Background*: a screen can show other photos on some days. Each rule says when (an event
  today whose title has a word, for example "Christmas", optionally on some calendars only; a range of days every
  year, such as 1 to 31 December or 20 December to 6 January; a single day; someone's birthday) and which photos
  (some from the gallery, or an Immich album). The first rule that matches wins, and with none the screen keeps its
  normal background. Rules work with every layout, the photo card of *Personalizado* included, and privacy mode with
  *hide photos* still shows stock photos only. The screen changes photos within a minute when another rule takes
  over (#14).
- Microsoft To Do lists on the to-do list: pick one or more lists of a linked Microsoft account on the To-do page and
  their open tasks show on every screen with the to-do list, after the ones typed in Marco, with their due date and
  a star when important. They update every 5 minutes. On a screen where ticking by touch is on, a tap marks a task
  done in To Do as well (a second tap while it is still shown puts it back). Needs the delegated Microsoft Graph
  permission `Tasks.ReadWrite` in your Entra app. Accounts linked before keep their calendars and get a *Reconnect*
  button that signs in to the same account again, keeping its calendars and lists (#15).

## [0.16.10] - 2026-10-19

### Added
- *Colours by state* on Home Assistant cards: an Entidad card, a binary sensor (a door, a window, motion) and a
  switch can show their state in green, yellow or red, one colour when active (open, on, detected) and one when not,
  for example a door red when open and green when closed. *Automatic* keeps Home Assistant's own colours (#13).

## [0.16.9] - 2026-10-19

### Fixed
- *Colours by value* on a Home Assistant sensor now also colours the value in the small look (a row, or a card
  with the name above the value). Before, only the large value took the colour (#13).

## [0.16.8] - 2026-10-19

### Fixed
- The Docker image builds again. 0.16.7 failed with `Could not resolve './scripts/vite-preload.mjs'` on
  `docker compose up -d --build` (#12). Releases now check that the Docker image builds and starts before they go
  out.

## [0.16.7] - 2026-10-18

### Changed
- Screens open faster over a slow connection. A screen's private link now carries its settings (and on Marco Cloud
  its first weather, events, countdowns, photos and news), so it draws without waiting for them, with the same privacy
  rules as before. A paired TV asks for its settings and its first data at the same time instead of one after the
  other. The page also loads the 3D background and the fonts right away.
- While a screen is still on its way, it shows the time and the date instead of a black page.
- *Widgets*: the widget type is now a dropdown (Image, Web page, Electricity price, Currency), so every name reads in
  full in all five languages. Widget cards fold to one line, like the carousels: the name, the type and the screens
  and places that show it. They start folded, each one stays as you left it in this browser, a new widget opens
  unfolded and a widget with an error is always open. With more than 3 widgets a search box filters them by name,
  type or screen.

### Fixed
- The *Currency* widget with its curve behind the numbers: the curve now fills the card from edge to edge and down
  to the bottom, as the *Currency* card of the layout editor draws it. With one pair it shows the large rate with the
  curve behind it and the lowest and highest in the bottom corner (in a place too low for that, one row as before).

## [0.16.6] - 2026-10-18

### Added
- *Currency* (Divisas), a new card in *Data*: the exchange rate of 1 to 6 currency pairs, such as EUR/HUF, EUR/USD,
  USD/MXN or GBP/EUR, from the European Central Bank's reference rates (through Frankfurter, free, no key). Every pair
  is worked out through the euro. Each shows its rate, with as many decimals as its size needs, and how much it moved
  since the working day before, in green or red. As a list or one pair large, with an optional curve over 7 days, 30
  days or a year, under the numbers or behind them, like *Crypto*. On the fine grid a small card is one line: the
  pair, the rate, the change and a small curve. In the editor, pairs are picked from the ECB's currencies, by code,
  name or as written (EURHUF, eur/huf).
- *Currency* is also a widget in *Widgets*, for a corner, the side column or the whole screen of the Modern and
  Classic designs, and for the *Widget* card of a custom screen. It draws the same card.
- The rates are fetched by the server only, a few times a day (every half hour on a working afternoon until the
  ECB's rates of the day are in), in one call for every pair of every screen, and the last ones stay with "Updated
  X ago" when the source fails. Screens never contact it. Marco Cloud too.

### Fixed
- *Stocks*: a symbol the free Finnhub key has no data for (a currency pair like EURHUF or OANDA:EUR_HUF, an unknown
  symbol) no longer looks like it keeps loading or like a wrong key. Its row says "No data", and a card with only such
  symbols says "No data for EURHUF". In the editor, such a symbol is marked, and a currency pair points to the
  *Currency* card.

## [0.16.5] - 2026-10-18

### Changed
- *Gauge* and *Statistic* are at least 4×1 cells, and *Scenes* at least 6×1 (4×4 stays), so the names read next to a
  wide sidebar instead of being cut to a few letters. A card saved smaller grows to its new smallest box where there
  is room, at its place or the nearest free one, never over another card. With no room anywhere it stays as it was.

### Fixed
- *Meals of the week* in a narrow, tall box showed only today late in the week (on a Sunday, one day in a box made
  for seven). Like the wide card, it now fills the box with the earlier days of the week too. In a short box those go
  first, so today always shows.

## [0.16.4] - 2026-10-18

### Changed
- Custom screens always use the fine grid (24×16 cells, 16×24 on a portrait screen). Screens made on the normal grid
  are converted and look the same: every card keeps its place and size, in both orientations, and the sidebar does
  not change. A self-hosted Marco converts its config file once when it starts, after a backup of the file as it was.
- The *Grid* setting is gone from *Page* in the editor, and so are the limits of the normal grid: every custom screen
  takes up to 48 cards and 80 Home Assistant entities. *Density* stays. The status bar of the editor shows how many
  cards the screen has, out of 48.
- The size buttons of a card and the templates are in cells of the 24×16 grid; they look as before.

### Fixed
- *Sensor* keeps its look (the name, the value in large type and today's curve) in boxes three cells high or more,
  like 5×3 or 8×3. Before, those boxes switched to the one-line look and the curve was gone, while 4×4 still had it.
  A line one or two rows high (like the one-row line of the normal grid, 6×2 now) stays a line. A binary sensor is
  still drawn as a line.
- Charts stay on the card at every size, in both chart styles. With *Below* and too little height for a band under the
  numbers, the chart moves behind them instead of being left out: *Sensor*, the large *Crypto* card and the
  electricity prices. In a narrow *Crypto* or *Stocks* list the sparklines move behind their rows instead of going.
- A moving *Blind* can be stopped from cards that only show up and down (the line on the fine grid, an *Entity* line
  of a blind). While it opens, the up button turns into stop; while it closes, the down button does, also right after
  the tap. Only for blinds that can stop. Cards with their own stop button keep it.

## [0.16.3] - 2026-10-17

### Changed
- Smaller cards on the fine grid (#9). Screens saved before keep their layout: only new, smaller boxes are allowed.
  - *Entity*, *Light*, *Switch*, *Climate*, *Blind* and *Sensor* now go down to 2×1 fine cells (they stopped at 4×1,
    3×1 for *Blind*). At 3×1 the card keeps its icon, name and state on one line. At 2×1 the icon is left out and the
    name sits over the state, in the same type size as a wider card, so it still reads from across the room.
  - *Weather now* in a box of 3×3 fine cells or more shows what the bigger card shows (the sky, today's high and
    low, the place, feels like, humidity and wind) in smaller type, instead of only the icon, the temperature and the
    sky. When something does not fit it is left out in this order: the place, the labels, the high and low, the
    details.
- A line card (*Entity*, *Light*, *Switch*, *Climate*, *Sensor*) in a box narrower than its usual line, like 4×2 on
  the fine grid or 2×1 on the normal grid, puts the name over the state and takes its type size from the height, so
  it is as large as on a full line. Before, the type got smaller with the width, and every card of that size took the
  size of the one with the longest name. Lines of the usual width or wider look the same as before.
- *Blind* in a box only the fine grid has, two cells high (3×2, 4×2): drawn as the line, with its name and state in
  readable type and up and down at its end when there is room (from 4×2). Before, the buttons filled the card and the
  name was tiny. Where the buttons do not fit, a tap on the card opens or closes the blind, as before.

### Fixed
- Home Assistant cards of the same type and size share one type size, so they line up. A card with its own *Text
  size* (say 70 %) no longer makes the others smaller, and a *Blind* line with its buttons no longer shrinks the
  lights next to it.
- Tests: the camera card test waits for the first picture instead of a fixed time (it failed on a slow CI runner).

## [0.16.2] - 2026-10-17

### Added
- Weather of more than one place (#11).
  - Each screen can show the weather of its own place: *Weather* > *Location of this screen*, *Home* (as before) or
    *Another place*, found with the same city search. Every layout of that screen uses it (the weather card, the
    forecast, Modern, Classic, the kids layouts and the custom screens), and so do its steps in a carousel.
  - On custom screens every weather card (*Weather now*, *Next hours*, *Next days*) can have a place of its own, or
    stay on *Same as the screen*. A card with a place of its own shows the place's name.
  - New card *Weather in several cities*, in the *Weather* group: 2 to 8 places, each with its sky, the temperature
    now, its name and (optional) today's high and low, as a list or a grid. On the fine grid it also fits in one row,
    showing as many places as there is room for.
  - Every place is fetched once and shared by all the screens and cards that show it, in every language. A screen
    shows its own place and at most 8 others (32 for the whole setup), and places no screen uses any more are dropped
    from the cache. Home Assistant's weather entity and indoor sensors still belong to the home place.
  - The admin preview shows a new place before you save.
- *Birthdays* > *Tidy birthday titles* (on by default, as before): birthdays from your calendars, like "Astrid's
  Birthday" or "Cumpleaños de Ana", show just the name next to the 🎂. Turn it off to keep the calendar's own title.
  The 🎂 stays either way, and ALL CAPS titles are still written in normal case. The age only comes with birthdays you
  add in Marco itself (#10).

### Fixed
- *Filters* preview: a birthday title that Marco tidies no longer looks like something that was removed. Instead of
  "before: ~~Astrid's Birthday~~" it now reads "Birthday recognised · original title: Astrid's Birthday", and a title
  changed by a rename rule says which rule did it (#10).

## [0.16.1] - 2026-10-16

### Added
- Custom screens, for dense dashboards like the ones people bring over from Home Assistant (#9). All three are opt-in
  per screen: a screen saved before keeps its look and its layout exactly.
  - *Grid* in the editor's *Page* settings: *Normal* (12×8 cells, 8×12 in portrait, as before) or *Fine* (24×16 and
    16×24). Switching converts the screen in both orientations: to *Fine* every card keeps its place and size, back to
    *Normal* each card goes to the nearest whole cells (a message says how many had to move, and *Undo* takes it back).
    On the fine grid cards can be smaller: a line card (Entity, Switch, Sensor, Light) can be half a normal row high,
    and small numbers, clocks and gauges a little smaller too. The sizes the editor offers stay the same shapes. The
    status bar shows the grid (*Fine grid · 24×16*) and opens *Page* with a click.
  - *Density*: *Normal* or *Compact*, with tighter gaps between the cards, less padding inside them and slightly
    smaller titles.
  - *Rotating card* (in *Content*): one spot that shows 2 to 6 cards one after another, every 5 to 120 seconds (10 by
    default), with a soft crossfade (none in lite mode or with reduced motion) and optional small dots. No touch
    needed. Each card is any card with its own options, edited inside it, and gets its data like any other (Home
    Assistant, values, crypto, sports and stocks, calendars, widgets); a rotating card cannot hold another one, its
    cards count towards the cards of a screen, and its cards are only shown, never touch controls. The daily and
    the hourly forecast in one spot is its default (#7).
  - On the fine grid nearly every card can now be much smaller, with a compact look made for that box: a line for the
    clock, the date, the next event, countdowns, the weather now, a message, a headline, a value, birthdays, meals,
    the family, crypto, sports and stocks (one coin, game or quote at a time) and the Home Assistant cards (a media
    player with its cover and play/pause, climate with − and +, blinds with up and down, gauges, statistics, scene
    chips); small strips for the hourly and daily forecast and the week's meals; a sparkline for charts; shorter
    lists for the agenda, today, the people view, to-dos, routines and rooms; and smaller month and week grids. A
    screen on the fine grid takes up to 48 cards (24 on the normal one) and 80 Home Assistant entities (40); going
    back to the normal grid asks to remove some first. Nothing changes on the normal grid.

## [0.16.0] - 2026-10-16

### Added
- **Custom screens** (*Layout → Custom*, `layout.preset: canvas`): a drag and drop editor to build your own screen.
  Pick cards from a palette (clocks, the date, every calendar view, weather, news, countdowns, messages, to-do lists,
  photos, your widgets, family and kids cards, Home Assistant, crypto, sports and stocks), drop them on a grid,
  resize them, give each one its own glass, colour, corners and text size, and add a sidebar on any side. Templates
  recreate every Modern and Kids layout (or *Copy my current design*), plus new ones like Bento, Cinematic and
  Calendar only. The editor has undo, a live preview of the real screen, a phone layout and drafts that survive a
  closed tab. Landscape and portrait each get their own arrangement.
- **Home Assistant cards** (self-hosted): entities, lights with brightness and colours, switches, climate with a dial,
  blinds with their position, scenes, media players, sensors with today's curve, binary sensors, gauges, statistics,
  charts, rooms and cameras (snapshots, or live where you allow it). Marco keeps a live connection to Home Assistant
  from your own server and follows only the entities your screens show; the token never leaves the server and
  screens never see entity ids. Touch controls are off until you turn them on per screen, locks, alarms, garage doors
  and gas valves stay read-only, and anything that opens a door needs a tick in the editor and two taps.
- **Custom HTML card** (self-hosted): your own HTML and CSS with `{{placeholders}}` for Home Assistant states, the
  time, the weather and the next event, checked against a list of allowed tags and drawn in a sandbox with no
  scripts and no network.
- **Pushed values**: `POST /api/hooks/values` sends a number or a short text to a *Value* card (from a Home Assistant
  automation, a script or anything that can call a URL). API tokens can now be limited to what they need (announce,
  commands, privacy, doorbell, values).
- Personalizado: *Chart style* on every card that draws a chart (Crypto, Stocks, Sensor and Chart): *Below* keeps the
  chart under the numbers, *Background* fills the card with it edge to edge and down to the bottom edge, behind the
  text (in a list, each coin or quote gets its own behind its row). Every chart now shares one look, the same line and
  a fill that fades from the line's colour, so two charts on one screen match. Saved cards keep their look.
- Personalizado: a *Calendar only* template, one month calendar over the whole screen with no clock or weather.
- *Layout → Appearance*: *Notices under the date* turns off the pills under the date (the next event, birthdays and
  today's check-ins and check-outs) on a screen, and the layout closes the gap (#7).
- Personalizado: cards can now take any width and height in whole cells of the grid, between the smallest and the
  largest that suit each kind (a narrow and tall to-do list, a news line across the whole screen, a switch two cells
  wide and one high). Drag the corner to resize in cell steps (it shows the size and stops at what fits), use Shift
  and the arrows, or the width and height steppers in *Size*, where the usual sizes stay as presets. *Fit the size*
  picks the smallest larger size that should hold the content and has room. Screens you already made look the same.
- Personalizado Home Assistant cards: the icon always sits beside the name (the Mini blind too), the name takes two
  lines only when no state line goes under it, a card in a larger box gets slightly larger text, a light's colours
  look dimmed while it is off, and the thermostat keeps every mode and its dial size at a large text size.
- Personalizado: an *Entity* card can show a row of controls under it, chosen per card or picked for you by the kind
  of entity: brightness and warm to cool light, up, stop and down and the position of a blind, the temperature and
  the modes of a climate, opening and closing a valve, the options of a select, a number, a robot vacuum's start,
  pause and dock, and the version of an update.
- Personalizado: Home Assistant valves, robot vacuums, selects, numbers and updates can be picked in the cards. Gas
  valves are only shown, and the house's water valve needs your tick in the editor first, then two taps.
- Personalizado: a *Gauge* card (a value on a bar with green, yellow and red bands), a *Statistic* card (today's,
  this week's or this month's total, average, lowest or highest of a sensor, from Home Assistant's statistics) and a
  *Section* title to group the cards below it.
- Personalizado: *Show* on every card lets it appear only while a Home Assistant entity or a pushed value is equal to,
  different from, above or below what you write. The server decides, so a hidden card gets no data, and the editor
  marks the cards hidden right now.
- Personalizado: a new *Data* group in the editor. *Crypto* shows up to six coins with their price, how much they went
  up or down and a curve over 24 hours, 7 days or 30 days, as a list or one large coin, in the currency you pick per
  coin (euros by default). Prices come from CoinGecko.
- Personalizado: *Sports* shows live scores with the minute, the next games and the latest results of the teams or
  competitions you follow, with crests: LaLiga, the Premier League, the Champions League and the other main football
  leagues and cups, plus the NBA, WNBA, NFL, NHL and MLB. Results come from ESPN, every minute while a game is on.
- Personalizado: *Stocks* shows shares and funds on a scrolling line or as a list, with the change of the day and an
  optional curve. It needs a free Finnhub key, which you add in the editor and which never reaches the screens.
  Where the server has no key to offer (Marco Cloud until the service has one), the card is locked in the editor
  and says why.
- The server fetches all of these itself, keeps one copy for every screen, and shows the last numbers it had with how
  old they are when a source does not answer. Screens never contact these services.
- Personalizado: *Schedule* on every card shows it only on the days and at the times you choose, with the same time
  slots as privacy mode. Outside them the card is not sent to the screen at all.
- Personalizado: the editor marks every card that is not on the screen right now and says why: hidden by you, outside
  its schedule, its condition, no room in portrait, or not available in this version.
- Personalizado: *Export this screen* saves a screen's layout to a file, and *Import a screen* loads one, on this
  Marco or another. The file has no calendars, people, Home Assistant entities or widgets of yours; after importing,
  the cards that need them ask you to pick them again.
- Personalizado: the editor bar has the screen's orientation (Automatic, Always landscape, Always portrait). It is the
  same setting as in the screen settings. Switching to always portrait keeps the portrait layout so you can edit it.
- Custom screens: the clocks and the date card have their own text colours in the *Style* tab, next to the accent
  colour. *Time colour* paints the digits or the hands and numbers of the dial, *Date colour* the date line (on the
  Date card the day, the month and the weekday, which keeps the accent colour when the card has one). *Automatic*
  keeps the usual look, so saved cards do not change.
- **Navigation cards for touch screens** (Custom screens, new palette group *Navigation*): *Go to screen* is a button
  to any other screen in your home, or *Home* (the screen or carousel the device usually shows), from a one-line or
  icon-only button up to a medium card, with an emoji or a built-in icon, its own text or the screen's name. On a
  device that runs a carousel with that screen, the carousel jumps to it, starts that step's time again and goes on
  from there; any other screen is shown and stays. *Go back by itself after* (5 minutes without a touch by default,
  or never) takes the device back to its usual screen or carousel. The choice is kept on the device only.
- *Pause carousel* button (pauses the rotation on that device until it is tapped again or the idle time passes) and a
  *Carousel progress* card (which screen is on and how long it has left, as dots or a thin bar).
- *Swipe to change screen*: with touch on, swiping left or right on a carousel goes to the next or the previous screen.
- The buttons work only where the screen allows touch, on a display Marco trusts and never while the screen is
  private; without touch they are not drawn and the editor says why. In the editor's preview a tap only lights them.
- The *Animated* background in the editor's page settings now points to where its effect (aurora, particles) is
  chosen: *Background → Ambient effect*.

### Security
- Gallery photos shown on a screen in private mode are no longer kept in the browser cache. Thanks to @scootmandoo.
- Home Assistant: Marco no longer follows redirects when it talks to Home Assistant, so the token is never sent to
  another address. If your Home Assistant URL redirects, enter the final URL. *Test connection* with a new URL now
  needs the token for that URL too.
- Data cards: the server never lines up more than a few dozen calls to one source, so a burst of searches or of new
  cards cannot hold up every screen's numbers. Coins tried in the editor's preview never push a screen's coins out of
  the shared price call, and team crests are fetched one at a time like everything else.

### Fixed
- The next days of the weather fit narrow screens and large text sizes (a phone, for example): the day names no longer spill over the symbols.
- Personalizado: a Gráfica with two or more lines shows the lowest and highest value of each line, each with its
  colour, instead of only those of the first one.
- Personalizado: a Deportes card that follows a whole competition no longer says its name twice in the heading
  (Champions League Champions).
- Personalizado editor: a Sección card no longer offers a second Título field and Mostrar el título, since the
  card is a title already.
- Personalizado: a live camera reaches the screens at 10 pictures a second at most, always the newest one. Some
  cameras send 60 or more a second through Home Assistant, megabytes a second that a Raspberry Pi had to download
  and read only to skip most of them.
- Home Assistant: while Home Assistant cannot be reached at all, the small dot on the screens' cards stays on. It
  used to go away for a few seconds on every new attempt to reconnect, as if everything were fine again.
- Home Assistant: a valve with "gas" in its id or name is treated as a gas valve even when Home Assistant gives it no
  device class, so it is only shown and can never be opened or closed from a screen or with *Test*.
- Personalizado: a card shown only while a Home Assistant entity or a pushed value matches no longer makes the
  screens reload all their Home Assistant cards on every new reading of that entity. They hear about it only when a
  card actually appears or goes away.
- A `TRUST_PROXY` value the server cannot read no longer stops it with an "invalid IP address" stack trace. It now
  says which value it read, which forms work, and when a docker-compose line like `$ { TRUST_PROXY:-}` is written
  wrong (it should be `${TRUST_PROXY:-value}`).
- Carousels on a Raspberry Pi now use the animation chosen for the carousel instead of a short fade. Where the short fade is still used (lite mode, reduced motion), the new screen's photo comes in with the usual crossfade again.
- The tests pass on Node 20 again: the display code no longer reads `navigator` when it loads, and the Home
  Assistant live and camera tests are skipped when Node has no global WebSocket. On Node 20 the server follows Home
  Assistant over REST polling, as before.
- Custom screens: choosing *Photo* as the page background shows a photo at once. A screen that was showing the
  animated background or a colour stayed black until the next photo change (up to two minutes).
- The animated background is never plain black: where WebGL cannot draw it (Chrome without graphics acceleration, lite mode, no WebGL, a lost graphics context) a soft gradient of the chosen effect shows instead, and with WebGL it now fills the whole page of a Custom screen, sidebar included, also in a browser zoomed out below 100 %.

### Changed
- A new Custom screen starts with the animated background. Copying the Left / Right design also gets it behind the
  cards, with the photo still in its wide column. Templates that are a plain colour on purpose (Bedroom, Bedside and
  the kids pages) keep their colour.
- A screen that becomes Custom for the first time gets lighter card glass when its glass was never changed: more
  transparent (a quarter), blur 5, dark tint, automatic appearance and the light edge. Modern and Classic screens
  and any glass you already set stay as they are. *Reset* on a Custom screen goes back to this glass.
- The release workflow runs the tests without the headless Chrome ones (`MARCO_SKIP_BROWSER=1`), which CI already
  runs on every commit, so a release takes a few minutes instead of half an hour.
- Marco Cloud: in the screen builder the Home Assistant cards and the custom HTML card are folded away under
  *Only on the self-hosted version* instead of being shown as cards you cannot use.

## [0.15.0] - 2026-10-13

### Added
- The calendar can start on today (*Calendars → Calendar starts on → Today*): no past days, the first cell is today
  and the weekday headers follow it. It moves on by one day at midnight.

### Changed
- Marco Cloud: everything about your account now lives on the admin's *Account* page, with the same look as the rest
  of the admin: language, password, two-step verification, Sign in with Google, open sessions, your data and deleting
  the account. The old account page sends you there.

## [0.14.1] - 2026-10-13

### Added
- With the photo on the whole screen, a *Calendar blur* slider sits next to the transparency one. Set it to 0 to turn
  the frosted glass off and keep the photo sharp behind the calendar.

## [0.14.0] - 2026-10-13

### Added
- Optional two-step sign-in for the admin with an authenticator app (*Security → Two-step verification*), with ten
  one-time recovery codes. It is off until you turn it on, and turning it on keeps the sessions already open. Locked
  out? Stop Marco and run `npm run disable-2fa`.
- The background photo can now cover the whole screen (*Layout → Appearance → Background photo → Whole screen*), with
  the calendar drawn over it as frosted glass and a slider for how see-through it is. Thanks to @aswormboy for the idea.

## [0.13.1] - 2026-10-13

### Security
- Several security fixes. Please update. After updating you will need to sign in to the admin again.
- If Marco runs behind a reverse proxy, make sure the proxy sends `X-Forwarded-For` (the examples in the README do).
- Thanks to @scootmandoo for reporting issues responsibly.

## [0.13.0] - 2026-10-13

### Added
- Family profile photos with a simple round crop: in *Family → Members*, tap the avatar and choose *Upload photo*.
  Drag to frame the face and zoom with the slider, the mouse wheel or two fingers; the arrow keys and + / - work too.
  The photo is turned upright, HEIC photos open where the browser can read them, and only a small square leaves the
  browser. The server checks it again (JPEG, PNG or WebP only, never SVG or animations) and keeps it without its
  camera data. The photo shows inside the person's colour ring on the routines, family board and rewards, on their
  calendar events, on the phone page and in the admin, with the emoji as the fallback. A screen in privacy mode keeps
  the emoji. Photos are served only to the family page, the admin and the screens that show that person.
- Exports include the profile photos and importing the *Family* section brings them back. A photo that is replaced
  or removed, or the photo of someone removed, is deleted a week later.
- `features.familyPhotos` in `/api/health`, `POST /api/admin/family/photos` and `GET /media/avatars/<id>`
  (docs/API.md, Familia).

## [0.12.0] - 2026-10-13

### Added
- Dutch and Danish for the screen, the admin, the family page and the icon rules: every admin and family page text,
  the screen's words, dates and numbers, weather descriptions and wind directions, private mode titles, backup
  summaries, the pairing and welcome screens, the setup wizard and the demo. Long dates read "Maandag 13 oktober"
  and "Mandag den 13. oktober", short Danish dates "23. okt", and numbers use a decimal comma.
- Icon rules: Dutch and Danish keywords (about 800 keywords in all). Existing installs get the new keywords once on
  the next start; rules you changed keep your emoji and your own keywords, and nothing is removed. A rule can now
  hold up to 100 keywords (was 50).
- Holidays: quick-add calendars for the Netherlands, Belgium and Denmark, and holiday names from the Dutch, Belgian
  and Danish Google feeds shown in every language.
- Vacation rental and birthday titles in Dutch and Danish are recognised ("Verjaardag van Anna", "Annas
  fødselsdag", "Niet beschikbaar", guest lines with "Gast" or "Gæst").
- Admin: the screen language is now a list with each language's own name, and the sidebar switch has five buttons.

### Fixed
- Electricity price widget: the *Shape* field showed "Format" in English, because it shared its text with the date
  format field.
- Holiday names written with a curly apostrophe ("Father’s Day" in some Google feeds) were not translated.
- The demo and the admin preview now pick event icons the same way as the server: short keywords match whole words
  only, so "car" no longer gives "Carmen" a car.
- A screen text missing in a language now falls back to English, then Spanish (it went straight to Spanish).

## [0.11.1] - 2026-10-13

### Added
- Electricity price widget: prices on the chart for the coming hours. Over each bar from the current hour on, its
  price in your unit (0,19 or 3,2 or kr). When they do not all fit, every second or third hour is labelled, and the
  cheapest and the dearest always are, in bold. Past hours stay grey without numbers.
- Electricity price widget: hour labels option for the chart: every 6 hours (as before), every 3 hours or every
  hour. When the labels would touch, fewer are shown.
- Electricity price widget: rows for tall widgets. A new *Shape* setting (24 h chart, Automatic and Next 24 h):
  *Landscape* is the wide card with bars, *Portrait* a tall card with the price now and its level, the lowest,
  average and highest, and one row per hour with its bar and price. In a small room it drops the figures on top
  first; with no room for a few rows it goes back to the wide chart. For *Next 24 h* it picks one column or two.
- Electricity price widget: a loading state. Before the first prices the card shows its title, faint bars or rows
  and *Loading prices…* (still on lite screens). While a grid company's tariffs are fetched for the first time it
  shows the market price with *Loading Cerius tariff…* instead of a total without it. In the admin, *Test*
  says *Loading…* and the grid company list shows a spinner on the company being fetched.
- Widgets: the widget preview outlines the room the widget has: the corner's box or the whole side column, with
  its size in pixels, so a corner and the side column no longer look the same.

## [0.11.0] - 2026-10-13

### Added
- Electricity price widget: hourly grid tariffs for Denmark by grid company (#3). Under *Grid tariff → Grid company*,
  pick your netselskab (35 companies in DK1 and DK2, searchable) and every hour adds its household tariff,
  Energinet's transmission and system tariffs and the electricity tax, from Energinet DataHub. Tariffs are read hour
  by hour, so season changes, tomorrow and the days when the clocks change are right. Past the last published tariff
  the screen says *estimated*; with a part missing it shows the market price and a note instead of a total that is
  too low. Checked against a tester's DK2 card for Radius C on 2026-10-13: 2.78, 2.92, 2.99 and 1.52 kr at 08, 17, 18
  and 23 h with VAT.
- Electricity price widget: time bands for any country, with a Spain 2.0TD preset. Up to 4 bands with a price per kWh
  and their hours, optional other hours on weekends and holidays. *Spain 2.0TD* (and a Ceuta and Melilla version)
  fills in punta, llano and valle and the national holidays, and leaves the prices to you. Not offered on PVPC,
  which already includes the tolls. *Test* now shows the price now part by part.
- Electricity price widget: a *Next 24 h* view. The price now in large type with a *Now: Cheap / Normal / Expensive*
  badge, the lowest, average and highest of the next 24 hours, and one row per hour with a bar, in one or two
  columns. Works full screen, in the side column and in a large corner (with too little room it shows the price now
  card). *Automatic* uses it on a portrait full screen.
- Widgets: the Widgets page shows a preview of the widget you are editing, in its own card under the screen
  preview: only the widget, with your unsaved changes, drawn as on the TV on a plain backdrop of the screen's style
  and theme. Pick the size it has there (corner S, M or L, side column or full screen); it starts where that screen
  has it. Every view of the price widget shows there: one that needs more room than that place has is shown larger,
  with a note. *Test* loads it again. It is only a preview: a note links to *Layout → Widgets on this screen*, where
  you place it. The *Used on* chips open that card too.

### Changed
- Planner: picking it now puts the time and the weather in the strip on top on a landscape screen. *At the side* is
  still one click away.

### Fixed
- Electricity price widget: a screen opened from another device on the network with open display access now shows
  the prices. Their request names no screen, and the server refused it like the bare address, so the card stayed
  empty (and so did the widget preview when the admin is opened by its network address).
- Electricity price widget: in a full side column (a larger text size, for example) the card no longer disappears.
  The room kept for it was a few pixels short of the card at its smallest, so it hid itself.
- Carousel: when the next screen has other photo settings, its photo now comes in with the screen switch. Before,
  the switch played first and the photo crossfaded right after it, so every switch looked like two animations.
- Birthday titles: a name starting with Do, Da or Del (like "CUMPLE DORU") keeps those letters.

## [0.10.0] - 2026-10-12

### Added
- Electricity price widget (#3): a new type in *Widgets*, *Electricity price*, with the day-ahead price of your
  bidding zone. Views: *Automatic* (by placement), *24 h chart* (bars from cheap to expensive, tomorrow added once it
  is published), *Price now* (large, with the trend for the next hour) and *Cheap windows* (the cheapest stretches
  still ahead). Optional fixed extra per kWh and VAT, kroner or øre for Denmark, euros or cents elsewhere. 15-minute
  prices are shown as hourly averages, or as quarter hours if you prefer. The server fetches and keeps the prices,
  so the screens never call the sources. Free sources with no key:
  - Energi Data Service: Denmark (DK1, DK2), SE3, SE4 and NO2.
  - Elering: Estonia, Latvia, Lithuania and Finland.
  - Red Eléctrica: Spain, wholesale market and PVPC. OMIE: Portugal, and Spain as a fallback.
  - Energy-Charts (CC BY): Germany and Luxembourg, Austria, Belgium, the Netherlands, France, Switzerland, Czechia,
    Poland, Hungary, Slovenia and Italy North. aWATTar: Germany and Austria as a fallback.

  The other zones (Norway NO1/3/4/5, Sweden SE1/2, the rest of Italy, Greece, Romania, Bulgaria, Croatia, Slovakia,
  Ireland and more) use ENTSO-E with your own free token, set in the widget's *More options*. On your own server,
  zones Energy-Charts publishes for private use are also shown without a token.

### Fixed
- Widgets in two corners on the same side (top right and bottom right, or top left and bottom left) no longer
  overlap: each corner gets half the height, and widgets stacked in one corner share it instead of being cut.

## [0.9.1] - 2026-10-12

### Added
- Planner on landscape screens can put the time and weather in a strip at the top or bottom (#2). *Layout → Planner →
  Time and weather* offers *At the side* (as before), *Top* or *Bottom*. With the strip the month takes the whole
  width, with up to 4 weeks, and the weather is laid out in one row: now, the next hours and the next days, hiding
  what does not fit. Portrait screens are unchanged.

### Fixed
- *Weeks to show* with the Planner's time and weather at the top or bottom: 5 and 6 are now greyed out, with the
  reason as a tooltip, since the strip leaves room for 4 weeks at most. Picking *Top* or *Bottom* with 5 or 6 weeks
  sets 4. The same applies in *Calendars → Calendar view*.
- Modern style: the circle around today's date was cut at the top by the line above the week in the Planner with the
  strip, the Planner on portrait screens and the *Top / Bottom* layout. It now stays below that line.

## [0.9.0] - 2026-10-12

### Added
- Widgets (#1): images and, on your own server, web pages on your screens (*Content → Widgets*). Each one goes in a
  corner or the side column of any screen (*Layout → Widgets on this screen*), or fills the screen with the new
  *Widget* layout, which works well in carousels. Images reload every 1 s to 24 h and swap only once the new one has
  loaded; a failed reload keeps the last image with a small "not updated" mark. The TV loads the address itself, so
  images from your local network work. Web pages load in an isolated frame. *Test* checks the address first.

### Changed
- *Appearance* (light or dark theme and accent color) moved from *Settings* to *Layout*, right under the display style.
  Picking the *Kids* style switches the screen to the light theme; it can be changed back right there.
- The three style cards in *Layout* share the whole row.

### Fixed
- Month grid: on load, a screen set to fewer weeks showed five rows for half a second before settling on its own
  number. Carousel switches no longer fade the rows of the previous screen out over the new one either.
- Modern style over a photo: the screen now fades in once the background photo is there (1.8 s at most), instead of
  appearing over black and changing a moment later.

### Security
- Pages of the server only load inside a frame as the admin's own preview, so a web page cannot send its frame back
  to the server and run there.

## [0.8.0] - 2026-10-12

### Added
- Family: up to six people, routines for the morning, afternoon and evening that earn stars, rewards to spend them
  on, and the meals of the week (*Content → Family* and *Content → Meals*).
- Three layouts for kids under a new *Kids* style card in *Layout*: *Routines* (a card per person with today's
  routines, progress and stars), *Family* (the day of the whole family: events, routines, meals, to-dos and rewards)
  and *Meals of the week*. They use the Modern style and work in landscape and portrait.
- A family page for phones (`/f/<key>`, also as a QR code on the kids layouts) to tick routines and, when you allow
  it, redeem rewards. On a touch screen kids can tick routines on the TV itself (*Family → Access*).
- Backups and exports include the family history; importing the *Family* section brings it back.

### Changed
- In open mode the bare address (no `?screen=`) only shows the default screen on the server itself, such as an
  all-in-one kiosk on `http://localhost:3000/`. From another device it shows "Open a screen's link" and no data.
  Private links, paired devices and the admin session work as before. The sign-in page no longer links to the display.

### Fixed
- Layout: picking the Planner and then another layout before saving left automatic weeks and cards on, so the other layout could show only two weeks.
- Carousels: screens with different photo settings showed the first photo of each again at every switch. Each
  screen's slideshow now goes on where it was.

## [0.7.1] - 2026-10-12

### Added
- The side preview in the admin shows unsaved changes: theme, layout, colours, font size, widgets and the rest of a
  screen's settings show as you change them. Calendars, photos and new events still show once saved.
- On the *Carousels* page the side preview plays a carousel, and a picker in its bar switches to another carousel or
  to a single screen. There it changes screen every 4 s with the animation and speed chosen now, saved or not.
  *Vista previa* on a carousel card shows that carousel there.
- Carousel cards fold to one line with their screens, times and what is on now (remembered per browser). With more
  than three carousels a search box filters them by name, address or screen.
- In open mode the address field of a screen or a carousel shows the whole address (`http://host:port/?screen=`)
  before the part you edit, so one field says where to point a TV.

### Changed
- The *Probar* button and the preview dialog of a carousel are gone: the side preview does that now.
- Copy buttons only appear where the browser allows copying (HTTPS or localhost). On a plain-http LAN address the
  text is shown in full instead.
- The photo slideshow keeps its own pace across carousel switches, and a new photo that would come within a few
  seconds of a switch moves to the middle of the next screen's turn, so the two never change together.

### Fixed
- Carousel animations: the screen that leaves took the theme, style and font size of the one that comes in during the
  animation (a dark calendar went blank under a light theme, for example). Its copy is now drawn in its own document
  and keeps its look until the end.
- The carousel countdown in the admin no longer reads *0 s*.
- The private mode store no longer fails when no config is loaded yet (tests on Node 20).

## [0.7.0] - 2026-10-11

### Added
- Carousels (*Carruseles*): several screens in a loop on the same TV, each for as long as you choose (10 s to 1 h),
  in the order you set. Every TV on the same carousel switches at the same moment. A
  display opens it like a screen: `/?screen=<address>`, its own private link, or pairing (the pickers list carousels
  after the screens).
- A carousel can rotate only at certain times (the same days and from / to rules as private mode, overnight windows
  too) and show one chosen screen the rest of the time. At night it stays on that screen so the dimming does not
  change, unless *Keep rotating at night* is on. A doorbell ring or a large announcement pauses it.
- The next screen's data is fetched a few seconds before it shows, so switching needs no request; *Connected screens*
  shows which carousel a TV runs and what it shows now. For testing: `?step=<address>`, `?carousel=0`, and
  `?demo=1&carousel=1` for the demo screens in a loop.
- *Animation between screens* for each carousel: fade (a true crossfade), slide, soft zoom, diagonal wipe, ink
  dissolve (WebGL, a fade without it), random (another one at each switch, the same on every TV) or none, at a fast,
  normal or slow speed (0.4, 0.8 or 1.4 s). On a Raspberry Pi, with `?lite=1`, with `?lowpower=1` or with *Reduce
  motion*, every switch is a short fade of the screen, as before (with *Reduce motion* it used to be instant). *Probar*
  plays it in the preview, saved or not. `&tr=<name>` and `&trSpeed=` force one on a display for filming.
- Immich as a fourth background source, next to stock, the gallery and the mix. Set the server URL and an API key
  (scopes `album.read`, `asset.read`, `asset.view`) in the new *Integrations → Immich* page; *Test connection* shows
  the Immich version and any missing scope. Each screen picks one or more albums (merged, duplicates removed), with
  an optional *Favorites only*, and the usual orders (newest = date taken). Only photos are shown. The Marco server
  fetches the images and keeps them in a disk cache, so the API key never reaches a screen and the screens do not need
  to reach Immich. When Immich is down, the photos already in that cache keep playing for up to a day (the album
  lists are kept that long); with nothing to show, the screen uses stock photos. A deleted or unshared album is
  skipped and flagged on the Immich page. Captions show the place and the date taken. Works with Immich 1.1xx, 2.x and 3.x.
- A carousel step can be a screen with the Immich source. The carousel's link or paired device reads the photos of
  the carousel's screens only.
- *Background → Portrait photos*: a portrait photo on a landscape screen (or the other way round) can be shown whole
  over a blurred copy of itself (*Blurred fill*), or cropped as before. *Automatic*, the default, uses the blurred fill
  for Immich photos only, so gallery and stock photos look as they did.
- `features.immich` in `/api/health` (off when missing, and on Marco Cloud). `validateConfig` takes
  `immichAvailable: false` to refuse the Immich source on servers without it.
- Planner for busy families, all opt-in (screens that do not turn it on look exactly as before):
  - *Weeks to show: Auto* (`calendar.weeks: "auto"`): the month view picks 2 to 6 weeks, as many as fit with
    *Max. visible events per day* at a readable size, and works it out again when the screen size or orientation
    changes. `?weeks=auto` on the display does the same.
  - *Event style* (`calendar.eventStyle`, per screen, *Calendars → Calendar view*): *Lines* (the default, one-line
    chips) or *Cards*: the time on top (and the end time when it is on), the title below on up to two lines, stacked in
    each day of the month and week views. Events of several days stay as bars. A day with more cards than fit takes
    turns (*Rotate busy days*) or shows "+N"; titles longer than two lines scroll up with *Slide long titles*. Cards
    take precedence over *Compact busy days*. `?cards=1` on the display.
  - *Planner* layout (`layout.preset: "planner"`): on a portrait screen the clock, the date and the weather with the
    next days on top and the month below, filling the rest; on a landscape screen a side column with the clock and the
    weather. Picking it in *Layout* (or in the setup API) also turns on *Auto* weeks and *Cards*, which can be changed
    afterwards. `?demo=1&planner=1` shows it with the sample data.

- *Days in the agenda* (`calendar.agendaDays`, per screen, *Calendars → Calendar view* when the agenda is used):
  *Automatic* (the default), 7, 14 or 30 days. The agenda view used to look 14 days ahead, so a quiet screen never
  showed events three weeks away. *Automatic* shows Today and Tomorrow, then the next days with events for as long as
  each whole day fits, and works it out again when the screen size or the events change. It never shows less than
  the 14 days did, so a busy agenda looks the same. The compact agenda of the side panel still shows 3 days.
  `?agendaDays=` on the display, and `?demo=1&sparse=1` for a quiet sample calendar.

### Changed
- Security: a display opened with `?screen=<address>` that names no screen or carousel no longer shows the default
  screen. It shows a plain "Screen not found" page (no clock, weather, photos or events, and no list of screens) and
  checks again every minute, starting normally once the screen exists. Every display endpoint answers
  `404 screen_not_found` for it, and its stream or poll is not registered under the default screen. No `?screen=`
  still means the default screen, and private links and paired devices keep their own screen as before. The small
  "Screen «x» not found" notice and `screenFallback` in the display config are gone.
- *Calendars → Calendar view*: *Max. visible events per day* now explains what it does. With *Compact busy days* on it
  is the point where a day switches to short lines (3 or 4 keeps normal days large).
- The weather panel blur and darkness moved from *Background* to *Layout*, in a *Weather panel* card shown next to the
  style when the screen uses the Classic style (they only change the Classic weather panel; Modern uses *Glass*). The
  settings and how the screens look stay the same.

### Fixed
- *Private mode → What each calendar shows* no longer lists the built-in local events or birthdays list when it is
  empty or turned off, like the screen legend. A built-in list with the same name as a calendar (for example an ICS
  calendar called *Cumpleaños*) is shown as "Cumpleaños (Marco list)" there and in the calendar pickers, filters and
  status lists.
- Planner and top / bottom layouts on a portrait screen: a long title in the next-event pill under the clock no longer
  widens the clock column and pushes the weather card off the screen. The pill now ends with an ellipsis (or slides,
  with *Slide long titles*).

## [0.6.1] - 2026-10-11

### Added
- Doorbell on servers without a live camera (`features.doorbellLive` off, Marco Cloud): the ring carries a snapshot
  from Home Assistant (multipart `image` or a raw image body), and the admin shows the doorbell card on *API &
  webhooks* with a Home Assistant example and a test with a sample picture.

### Fixed
- Doorbell: when the picture arrives after the ring has started, screens that are already ringing now show it.

## [0.6.0] - 2026-10-11

### Added
- Private mode per screen, for when you have guests. While it is on, events of each calendar show as "Busy" (time,
  length and calendar colour only), are hidden, or stay as they are (*In private mode*, per calendar; holidays and
  birthdays stay by default). The server filters events and countdowns before they reach the display, so the screen
  never receives the real titles, places or notes. Optional per screen: stock photos instead of the gallery, and a
  small lock in the corner (on by default).
- Private mode can be turned on from Home (1 h, 3 h, until tomorrow, until turned off; one screen or all), on a
  schedule per screen (days and times, may cross midnight), or from Home Assistant with `POST /api/hooks/privacy`
  (`GET` reads the state). The admin shows a banner while it is on, and it turns off by itself when the time is up.
- Doorbell camera. `POST /api/hooks/doorbell` (`{ action: "ring" | "dismiss", seconds?, screens?, camera? }`) puts a
  Home Assistant camera full screen on the chosen screens for 10 to 300 seconds (60 by default), with a door chime.
  Ringing again makes it last longer; `dismiss` (for example when the door opens) takes it away. It shows above night
  mode and private mode, so a dimmed screen wakes up while it lasts and goes back to night mode afterwards.
- *Home Assistant → Doorbell and camera*: the camera entity, time on screen, screens, door chime and a *Test* button.
  The picture goes through Marco (`GET /api/display/doorbell/frame`), only to screens that are ringing at that
  moment, one or two frames a second, shared between screens for half a second. The Home Assistant token never
  reaches a screen and no picture is stored. Rings are logged in *Activity*.
- Compact busy days (`calendar.compactBusyDays`, per screen, *Calendars → Calendar view*): in the month, two weeks and
  week grids, a day that cannot fit its events at normal size lists them as small one-line entries (emoji, time or
  all-day colour, title) below its multi-day bars. Week rows share the height by how many events they have, with
  room for the dates and one event in every row; rows stay equal while every week fits. Only what still does not fit
  takes turns (*Rotate busy days*) or shows "+N". On for new screens, off for existing ones.
- `features.privacy`, `features.doorbell` and `features.doorbellLive` in `/api/health`.
- Display demo: `?demo=1` with `&private=1` (private mode), `&doorbell=1` or `&doorbell=nocam` (a ring with a drawn
  camera picture, or without one) and `&busy=2` (a whole month packed with events). They can be combined. Also
  `?compact=0|1` and `?weeks=1..8` on any screen.

## [0.5.3] - 2026-10-11

### Fixed
- Status: the weather and news cards no longer cut "23 seconds ago" in narrow cards; the text wraps under itself.

## [0.5.2] - 2026-10-11

### Added
- Admin: *Help and feedback* form on servers that offer it (`features.feedback`, Marco Cloud only), with a GitHub link.

### Changed
- The admin sidebar shows the Marco logo and wordmark instead of "Family calendar".
- Installer menu: *Server only* is option 1 and *All in one* option 2 (the default for a device with a desktop is still All in one).
- **Long titles slide in more places**: timed chips in the month, Two weeks and week grids, the pills next to the
  clock ("In 23 min · …", check-outs, birthdays), countdowns, scheduled messages and the news headline. A chip title
  cut after a few lines in a month cell now scrolls up a line at a time, like film credits, and comes back; its box
  keeps its size, and the time stays on top when it has a line to itself. The news headline slides once, within the
  time each item shows.
- An event alone on its day in a month cell can use all the free height of the day instead of stopping at three
  lines; days shared with other events keep about two lines per event.

## [0.5.1] - 2026-10-10

### Added
- **Apple iCloud calendars**: *Calendars → Linked accounts → Link account* now offers Apple iCloud. It opens a short
  guide (iPhone or iPad, Mac, iCloud.com) to get the calendar's public link, then tests the link and adds it as an
  iCal calendar. `webcal://` links are accepted. No server setup needed.
- **Long titles slide**: an all-day or multi-day bar in the month or week grid, or a title in the Agenda, Today,
  Per person and Board views, that does not fit slides slowly to show the rest, waits, and slides back. Titles that
  fit never move, timed chips in month cells keep their "…", and nothing moves when the device asks for reduced
  motion. With `?lite=1` at most six titles move at once.
- **Busy days take turns**: a day in the month or Two weeks grid with more events than fit shows them in turns every
  8 seconds, and the "+N more" label becomes a page count ("1/2"). Bars that cover several days stay where they are;
  when they fill every row of a day, the bottom one leaves that day free so the day's own events still show.
- Both are on by default and can be turned off per screen in *Calendars → Calendar view*; `?marquee=0` and
  `?rotate=0` turn them off for a test, and `?demo=1&busy=1` adds a busy day and long titles to the demo.

### Changed
- New demo video and README animation in the Modern style, with no flicker: layouts, an alert from a phone, weather
  effects, a portrait screen, the admin and the night clock.
- **Sign in with Google is off on self-hosted servers** by default: the admin uses the server's password, and Google
  is for calendars. `MARCO_GOOGLE_LOGIN=1` turns it on; servers that already sign in with Google only (password off,
  allowed emails set) keep it.
- **Google Calendar** leaves out Google Workspace working-location entries ("Home", "Office").
- The linked accounts chooser closes with an X instead of a Cancel button.

### Security
- Every response now sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` and
  `frame-ancestors 'self'`, so no other site can frame the admin. The display and admin pages (also as `/index.html`
  and `/admin/index.html`) are never cached, and admin changes refuse a `Sec-Fetch-Site` other than `same-origin`.
- With Google sign-in off, sessions made with Google before end too, and the Google callback refuses a sign-in.
  The OAuth purpose (sign in or link calendars) is kept in the session instead of being read back from the state
  the browser returns.

### Fixed
- Turning *Rotate busy days* off now brings back the "+N more" label at once; before, a busy day kept its page
  count ("1/2") and kept turning it until the screen reloaded.
- With the Modern style, emoji in text fall back to the bundled emoji font, so an offline device without a color
  emoji font no longer shows empty boxes.
- The activity log names the *Display access* change instead of showing the raw `security` key, and the search
  finds *Download photos (.zip)*.
- The demo in Portuguese (`?demo=1&lang=pt`) is now Portuguese everywhere: to-dos, the message, holidays, places,
  news and the wind direction no longer fall back to English.
- A display that shows the pairing or invalid link screen before it ever loaded its settings no longer keeps asking
  the server for them every 10 seconds.
- Calendar errors in the Home source list and the Home Assistant *Test connection* result are shown in the admin's
  language, like on the Status page, instead of the raw technical text.
- Changing the time zone in *Date & time* now also rebuilds the calendar view from calendars without a time zone
  of their own (floating times), even when a screen asked for its events while the calendars were being reloaded.
- A very long title in the next-event capsule under the clock no longer pushes it past the edge of the side panel.
- Today: when the all-day chips do not fit next to the title, the last ones are left out instead of the first one
  losing the start of its title.
- A large font size (*Screen → Font size*) no longer pushes the clock's last digit onto a second line: the clock
  never wraps and shrinks to the width of its column.
- With the Modern style the screen now fades in once the first photo is ready, so the glass cards never show a
  plain dark background that turns into blur a second later, and the first photo's tone applies at once (the
  glass and the chips no longer fade to a new opacity right after the screen appears).
- Marco Cloud: sign-up goes straight to Inicio, with a welcome card to put Marco on a TV.

### Added
- **Microsoft calendars**: link Outlook.com, Hotmail or Microsoft 365 accounts (read only) and pick their calendars,
  including the ones other people shared with you. Optional on a self-hosted server: it needs your own Microsoft Entra
  app (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, see *Connecting Outlook, Hotmail or Microsoft 365* in the
  README); without it the option is not shown. Calendar sources get a new type `microsoft` (`microsoftAccount`,
  `microsoftCalendarId`), `/api/health` a new `features.microsoftCalendar` and `/api/auth/me` a `microsoftConfigured`.
  Tokens are kept in `data/secrets.json` and go into exports with secrets, like Google accounts.
- **Linked accounts** (*Calendars*): one card for Google and Microsoft accounts. *Link account* asks which provider
  when both are set up, and every linked account is listed one below the other with its calendars.

## [0.5.0] - 2026-10-10

A Modern display style with glass options, six new layouts, a choice of free weather sources, alerts and display commands in poll mode, a capability block in `/api/health` that the admin follows, a pairing
confirm step, place search through the server, and the shared logic moved into `server/core`.

### Added
- **Update notices and updates from the admin**: once a day the server asks GitHub which release is the latest (one
  `GET` to the public API, no identifier, `If-None-Match` so an unchanged answer is not downloaded again) and the
  admin shows a banner, *Marco 0.5.1 is available*, with the release notes. On installs made with the one-line
  installer, **Update now** installs it from the admin: the server writes `data/update/request`, a systemd path unit
  (`marco-update.path`, installed by the installer) runs `marco update --requested` as root, and the admin follows
  the progress, shows the log and the result (updated, or rolled back to the previous version) and reloads itself;
  the screens reload on their own. Docker and git installs get the commands to copy instead. *Status → Updates* has
  the daily check switch, *Check now* and **automatic updates** (off by default) inside a time window, 03:00 to
  05:00 by default; a version that fails is not retried. `MARCO_UPDATE_CHECK=0` turns the check off. New feature
  flag `updates` in `/api/health` (self-hosted only) and `GET /api/admin/update`, `PUT /api/admin/update/settings`,
  `POST /api/admin/update/check`, `POST /api/admin/update/apply`. Marco Cloud shows a one-time *What's new* with the
  CHANGELOG section of a new version instead. Installs updated from 0.4 get the button after one more
  `marco update` on the server.
- **More date formats** (*Date & time > Date format*): US style with the year ("Saturday, October 10, 2026"), numeric month/day/year and day/month/year ("Saturday, 10/10/2026", tagged in the admin so the order is clear) and ISO 8601 ("Saturday, 2026-10-10"). The admin preview now uses the display's own renderer. *Custom* takes your own pattern (`datetime.dateCustom`, up to 60 characters) with `{dddd}` `{ddd}` `{d}` `{dd}` `{mmmm}` `{mmm}` `{m}` `{mm}` `{yyyy}` `{yy}` and any text, with clickable variables and a live preview. Date formats are a compact grid.
- **Weather sources** (*Weather → Data source*, `weather.provider`): besides Open-Meteo, the forecast can now come from
  [MET Norway](https://api.met.no/) (Locationforecast 2.0, worldwide, no key) or [Pirate Weather](https://pirateweather.net/)
  (your own free key, 10,000 calls a month; Marco uses about 3,000). With Open-Meteo you can also pick the forecast
  model (`weather.model`): *Automatic* (as before), ECMWF IFS, DWD ICON, NOAA GFS, Météo-France, UK Met Office, GEM
  or JMA. Each source shows a short description and its licence in the admin, and the screens credit it in small type
  next to the weather (*Open-Meteo*, *Open-Meteo · ECMWF IFS*, *MET Norway*), in Classic and Modern, as the CC BY
  licences ask. `GET /api/weather` has a new `source` field. The Pirate Weather key is pasted in *Weather*, tried once
  (`PUT /api/admin/weather/key`), kept in `data/secrets.json`, included in exports with secrets and never sent back.
  Values a source does not give (chance of rain from MET Norway outside the Nordics, UV from some models) are left
  out instead of showing a dash. MET Norway's sleet now has its own description ("Sleet"). The provider code lives in
  `server/core/weather.js`, so Marco Cloud offers the same sources.
- **Display style** (*Layout → Display style*, `screen.style`): every screen can now be *Modern* or *Classic* (the look so far).
  New installs and new screens start Modern; screens saved before this release keep Classic, so nothing changes
  until you pick it. *Modern* is a more minimal, Apple-like look: glass widget
  cards over the photo with a light edge, a Lock Screen clock with the date on top, the month grid in the iOS
  Calendar idiom (no column lines, today as a filled circle, colour dots for timed events), agenda days as list
  cards, a Weather-widget layout, notification-style alerts and scheduled messages. It works with every layout,
  portrait and landscape, the light and dark themes, night mode, the weather effect and `?lite=1` (solid cards
  instead of blur). Modern uses the system font (SF on Apple devices) and falls back to the bundled Inter
  elsewhere. Preview it with `?style=modern` (or `?style=classic`).
- **Glass options for the Modern style** (*Layout → Glass*, `screen.glass`, shown when a screen uses Modern), in the
  spirit of the iPhone's glass settings: *Appearance* (*Clear*, *Tinted*, or *Automatic*, which follows each photo:
  clearer over dark photos, more tinted over bright ones), *Transparency* (from see-through to solid), *Blur*, *Tint*
  (*Dark*, *Light* with dark text, or *From the photo*, a deep version of the current photo's colour) and *Edge
  highlight*. A live preview over a dark and a bright sample photo shows the result. The defaults are the Modern look
  as it was. Everything is a few CSS variables, so it costs nothing extra on the Pi; with `?lite=1` there is still no
  blur and the cards stay solid. Preview with `?glass=clear|tinted|auto`, `&glassOpacity=0..1`, `&glassBlur=0..40`,
  `&glassTint=dark|light|photo`, `&glassEdge=0|1`.
- **Six new layouts** (*Layout*, `layout.preset`), each in landscape and portrait, Classic and Modern, light and dark,
  night mode and `?lite=1`:
  - *Today* (`today`): the day hour by hour with a line for now and past events dimmed, the next event in large type
    and the weather for the coming hours. Made for the kitchen in the morning.
  - *Per person* (`people`): one column per calendar with today and tomorrow. Choose up to five calendars in
    *Layout → Columns per person* (`layout.people`); holidays and birthdays go in a shared line above.
  - *Photo frame* (`photoFrame`): the photo with a small clock, temperature and next event card in a corner of your
    choice (`layout.corner`: `tl`, `tr`, `bl`, `br`). Made for a portrait frame.
  - *Two weeks* (`twoWeeks`): this week and the next as a roomy grid, today highlighted.
  - *Board* (`board`): a family organisation board with the to-do list, countdowns, the message of the day, upcoming
    birthdays and a short agenda.
  - *Bedside* (`bedside`): a huge, very dim clock with the next event and the temperature; deeper and dimmer during
    the night window. No photo and no animation.
  Preview with `?preset=today|people|photoFrame|twoWeeks|board|bedside`, `&people=<ids>` and `&corner=tl|tr|bl|br`.
  The setup wizard still offers the five original layouts; the new ones are in *Layout*.
- Demo URL parameters `?empty=1` (no events, countdowns or to-dos) and `?photos=0` (no background photo) to check
  the empty states of every layout.
- **Poll channel for displays** (`GET /api/display/poll`): with `MARCO_LIVE=poll` (or any server that answers
  `live: 'poll'`), displays get announcements, identify, night mode, refresh, gallery and calendar changes from a
  short poll instead of the stream. The server picks the delay: 30 s, 5 s while *Connected screens* is open or right
  after a command, 3 min while the page is hidden. A server restart or a lost cursor replays the active
  announcements, never old commands. A display that polled in the last 4 minutes is listed as connected and counts
  in "sent to N screens". Version reloads and moved devices work in this mode too, and the heartbeat drops to every
  10 min. A server without the endpoint still gets the 90 s config check. In poll mode the admin's "sent" messages
  say that screens get the command within about 90 s.
- **Capabilities in `GET /api/health`**: `edition`, `tenancy`, `runtime`, `pairCodeLength` and a `features` block
  (plus optional `limits` and `displayOrigin`). The admin reads it at start: sections, palette actions and search
  results for features a server turns off are hidden, and add buttons stop at the server's limits. A server that
  sends no `features` keeps everything on, so older servers look the same as before.
- **Pairing confirm step**: claiming a code first shows which display is waiting (its address) and pairs only after
  the owner confirms. The code length comes from `/api/health`.
- **Place search through the server** (`GET /api/admin/geocode`): the weather location search and the setup wizard
  no longer call Open-Meteo from the browser. Rate limited and cached for a day.
- **Account mode in the admin** for servers that sign users in with their own account pages (`user.method:
  'account'`): sign-in and sign-out follow the server's links, the header menu shows the household and the account
  links, and the Security page becomes *Account* on multi-tenant servers.
- **Save conflicts**: the admin sends the revision it loaded with every save (`baseRevision`). If the settings were
  saved since then, from another tab, another device or the server itself (the first Google sign-in adds the
  allowed email), the server answers `409 conflict` and writes nothing. The admin then offers to load the saved
  version or to save its own changes on top of it; parts it did not change keep the saved value. Saves without
  `baseRevision` (admin pages loaded before the update) still overwrite, as before.
- `GET /api/admin/countdowns?screen=` for the Countdowns page. `GET /api/countdowns` still accepts an admin
  session in this release.
- The admin translates the error codes a server can answer with (`rate_limited`, `screen_limit`,
  `limit_exceeded`, `feature_unavailable`, `conflict`, `photo_quota`, `readonly`) in Spanish, English and
  Portuguese.
- `web/shared/adminContract.json`, generated by `npm run contract` from the admin API client and the shared types,
  and checked in CI.
- Emoji: a Noto Color Emoji subset with the picker's emoji and the default icon rules is served by Marco itself, so
  the admin and the display show the same glyphs.

### Changed
- **Weather cache**: one forecast per place, shared by every language and screen (it was fetched once per language),
  for at least 10 minutes and, with MET Norway, until the `Expires` time it gives (then asked again with
  `If-Modified-Since`). Coordinates are rounded to 2 decimals (about 1 km) before they are sent. When the source
  fails, the last forecast stays for up to 6 hours, and *Status* shows why (for example a refused key).
- **Ambient backdrop**: the *Aurora* now looks like real northern lights: folding curtains with fine vertical rays
  that shimmer slowly, green and teal at the lower edge fading to violet at the top, gentle brightness pulses and a
  dither so the soft gradients never band. In the light theme it is a very faint pastel tint. *Particles* are now
  soft bokeh dust in three depths (small specks far away, larger blurred discs close by, a few big out-of-focus orbs)
  drifting with parallax and a slight twinkle, tinted by the accent colour; on the light theme they are soft pastel
  discs. Same cost as before: the aurora still renders at ¼ resolution and refreshes at 15 fps, at most 150 particles,
  nothing with `?lite=1`.
- **Weather effect**: it now follows how strong the weather is (drizzle and light snow are sparse, heavy rain and
  snow dense). *Rich*: drops on the glass act as small lenses (the photo seen through them flipped, a darker rim and
  a highlight) with a mist of micro droplets, sliding drops stop and go and leave a trail of beads, rain streaks fall
  at three depths, thunderstorms add a slanted downpour and lightning (a flash and a second flicker, never at night;
  plain rain no longer flashes), snow falls at four depths with soft out-of-focus flakes close by, fog shows slow
  banks of mist near the bottom, and clear days get softer sun shafts with a faint lens flare. *Simple*: rain and snow
  particles have depth (size, speed and softness). The photo and the text are never blurred.
- Every screen link in the admin (preview, *View screen*, screen cards, Home, Connected screens) comes from one
  helper. With private links it opens `/d/<key>` (with `?preview=1` for the preview); in open mode it keeps
  `/?screen=<slug>`.
- The pure server logic (config validation, backups and import, announcements, feed parsing, image headers,
  activity redaction, pairing codes, CSV, schedules) lives in `server/core`, with no Node built-ins or file access,
  so Marco Cloud can run the same code. A test keeps it that way.
- The display's SSE client and the poll channel share one event dispatcher, with the same checks for every event.
- `MARCO_LIVE` is passed through in `docker-compose.yml`.

### Fixed
- Pairing and “link no longer valid” screens: the code no longer runs under the QR code. Everything is sized from
  the width as well as the height (a tall browser window no longer makes the text, the code and the QR wider than
  their columns), the code shrinks to fit its column for 6 or 8 characters, and on 1440p, 4K and large desktop
  windows the card stops growing and stays centred. Preview with `?demo=1&pair=1` (or `pair=invalid`, `&pairLen=8`).
- Modern style, *Big time* layout: the agenda card no longer runs under the news bar. It shows whole rows only and
  drops the ones that do not fit (then the countdowns), instead of a faded, cut off last row. In portrait the weather
  card spans the full width again.
- Broken or non-image files in the gallery are read once instead of up to three times (up to 16 MB) each time the
  photo list is rebuilt.
- The admin preview no longer reads or writes the browser's stored device token, client id or cached data, so it
  cannot replace a real display's identity in the same browser or show another display's cached data.
- A pairing page opened at `/pair` stays there after pairing.
- Weather or background settings saved with a feature the server turns off stay visible with a note, so they can be
  changed back.
- Sign-in redirects reject paths with whitespace or control characters.
- Installer: run as a regular user with no terminal (`curl | bash` from a script, `marco update` from cron), it
  stopped at `sudo -v` even when sudo needs no password, as on Raspberry Pi OS. On a 0.4.0 install made as a regular
  user, `marco update` still asks for the sudo password once (it runs the 0.4.0 installer); with no terminal, use
  `sudo marco update` or run the one-line installer again.
- Installer: Raspberry Pi OS 32-bit on a Pi 4 or 5 (64-bit kernel, 32-bit programs) gets the armv7l Node.js build
  instead of an arm64 one that cannot run.
- Kiosk: the log `/tmp/marco-kiosk.log` (`marco logs` on a screen-only device) is written with Wayfire, LXDE-pi and
  other desktops too, not only labwc. Chromium from a snap (Ubuntu) gets a profile folder it is allowed to write to.
- Installer: the files that run as root (the `marco` command, the stored installer, the systemd unit) are taken from
  the release package right after its checksum is checked, not from the install folder that belongs to the service
  user, and a rollback puts the previous systemd unit back as it was. The `marco` command and the stored installer are
  replaced by rename, so a running `marco update` keeps reading its own copy. Links in place of `releases/`,
  `current` or `.env` are refused, and folders are handed to the service user without following links.
- Installer: a kiosk link with no server address is refused; updating a screen-only install shows the saved link;
  an all-in-one install warns when `kiosk.env` still points at another server. `marco help` no longer prints a
  line of code.


## [0.4.0] - 2026-10-09

A realistic weather effect over the photo, a polling mode for hosts without a live stream, and a language fix for
the pairing screen.

### Added
- **Weather effect** (*Background → Weather effect*, `background.weatherFx`): *Off*, *Simple* (the light rain and
  snow particles from earlier versions, still the default) or *Realistic*: drops on the glass that bend the photo
  only inside each drop, faint rain streaks, layered snow and soft sun rays on clear days. No blur or tint, so the
  calendar stays easy to read, and no flashes at night. *Realistic* needs WebGL and the WebGL photo transition;
  `?lite=1` turns the effect off.
- Demo URL parameters `?wx=clear|rain|snow|drizzle|thunder` and `?wxfx=off|simple|rich` to preview the weather and
  the effect without waiting for the forecast.
- **Poll mode for displays**: when `GET /api/health` returns `live: 'poll'`, the display skips the live stream and
  checks the config revision every 90 seconds. Self-hosted servers return `live: 'sse'` and keep the live stream.

### Fixed
- A screen whose private link was regenerated or whose paired device was revoked now keeps the language it was
  showing on the "This link is no longer valid" and pairing screens, instead of switching to the browser's language.

## [0.3.0] - 2026-10-09

Private display links and pairing, a one-line installer with the `marco` command, release packages, more icon
rules, a new logo and new screenshots, diagram and demo video.

### Added
- **Private display links**: every screen gets an unguessable link `/d/<key>` (random UUIDv4, 122 bits) shown in
  *Screen → Settings → Private link* with copy, QR code, open, **Regenerate link** and the ready-made Raspberry Pi
  command. The key binds the screen (`?screen=` is ignored with it).
- **Device pairing**: a display without a key (or at `/pair`) shows a 6-character code (31-symbol alphabet without
  look-alikes) and a QR code to `/admin/#pair=<code>`; *Connected screens → Pair a screen* claims it for a screen and the
  waiting display receives its own revocable device token (256 bits, stored hashed) through a secret pairing session
  id. Codes live 10 minutes, are single use, only valid while the display waits, and claims are rate-limited.
- *Connected screens*: how each display got in (private link, paired device, admin session, no key), **Paired devices**
  with last seen, edit (rename / move to another screen) and **Revoke**.
- **Display access** setting (*Security*): `private` (default for new installs) or `open` (legacy LAN mode). The
  dashboard, *Connected screens* and *Screen → Settings* recommend switching while open.
- Displays with a regenerated link, a revoked device or no key switch live (SSE `revoked`) to a "This link is no longer
  valid" / pairing screen that shows no family data and wipes the display's cached data.
- Setup wizard: the *Done* step shows the screen's private link and QR code (and the kiosk command with it); a display
  showing the welcome screen switches to a pairing code when setup completes.
- API: `GET /api/admin/display-links`, `POST /api/admin/display-links/:screenId/regenerate`, `GET/PATCH/DELETE
  /api/admin/devices[/:id]`, `POST /api/admin/pair/claim`, `POST /api/pair/start`, `POST /api/pair/status`; display
  credentials in `X-Marco-Key` (or `?k=` for the SSE stream and `/media/*`); `access`/`deviceName` in
  `GET /api/admin/displays`; `security.displayAccess` in the config. Exports with secrets carry the display keys and
  paired devices (hashes), so an import on a new server keeps every link and device working.
- `npm run demo` runs in private mode and prints each screen's private link (plus a paired demo device).
- **One-line installer**: `curl -fsSL https://marcohome.app/install | bash` (`install.sh` at the repository root).
  It asks what the device should do (all in one, server only, or screen only for a server elsewhere), or takes
  `--mode all|server|kiosk --url <private link> --port --dir --user --version --yes`. It checks the system (Debian
  12/13, Raspberry Pi OS Bookworm/Trixie, Ubuntu 22.04+; x86_64, arm64, armv7), the Raspberry Pi model, the desktop
  (labwc, Wayfire, X11, or X started from `~/.xinitrc`) and the read-only overlay, installs Node.js 22 when needed
  (checked against `SHASUMS256.txt`), downloads the prebuilt release and verifies its SHA-256, sets up the systemd
  service and the kiosk, and ends with the admin address and a QR code. `--dry-run` prints every action without
  changing anything; `--update` and `--uninstall [--purge]` are built in (uninstall asks first, with no as the
  default answer, and needs `--yes` when there is no terminal). Until a release is published it builds
  from git. A kiosk-only install downloads the four kiosk scripts it needs, so git is not required.
- **`marco` command**: `marco status`, `logs [-f]`, `restart`, `update` (checksum verified, switched in one step,
  rolled back if the new version does not start, never to an older version without `--force`), `url` (admin address and each screen's private link with QR
  codes), `version`, `uninstall` (keeps your data unless `--purge`).
- **Release packages**: tagging `v*` builds `marco-<version>.tar.gz` (server, built web interface, deploy scripts,
  no `node_modules`) with a `.sha256`, and publishes a GitHub release with the notes from this changelog plus
  `install.sh` and `install.sh.sha256`, so the installer can be checked before it runs. CI runs shellcheck on every
  shell script.
- **More icon rules**: 35 categories with about 400 keywords in English, Spanish and Portuguese (train, pharmacy,
  exams, swimming, haircut, coffee, drinks, parties, work, deliveries, repairs, cleaning, bin day, garden,
  deadlines, music lessons, babysitter and more). The list lives in `web/shared/iconRules.json`, shared by the
  server and the web UI. Existing installs get the new keywords and categories once, added after their own rules;
  nothing is removed or reordered, and rules deleted afterwards stay deleted (marker file `data/.iconrules-v2`).
- Gallery: choose which photos are in the rotation: an always-visible eye toggle on each photo (with a confirmation
  toast), an "N of M in rotation" counter, *All / In rotation / Hidden* filters and a selection mode to show or hide
  many photos at once. Hidden photos stay in the gallery (flag stored in `photos/.meta.json`, kept on replace) and
  are skipped by the display immediately; if everything is hidden the screen falls back to stock photos.
- Background → *Photo order*: `random` (default; shuffled without repeating the previous batch), `newest` or `name`.
  Sequential orders continue where the screen left off (`GET /api/photos?after=`) and wrap around.
- API: `PATCH /api/admin/photos/:file` accepts `{ hidden }`; new `POST /api/admin/photos/visibility` for bulk
  changes; `background.order` in the screen config; the `photos` stream event may carry `{ hidden: [...] }`.
- **Docs and media**: new screenshots of every admin page, the setup wizard, the display layouts and the pairing
  flow (WebP, in `docs/screenshots/`), a "How it works" diagram for light and dark themes, an animated preview and a
  poster frame (`docs/media/`). A 48-second demo video (`marco-demo.mp4`) is linked from the READMEs; it is kept in a fixed `media` release on
  GitHub because it is too big for the repository. The
  READMEs (English and Spanish) are rewritten around the one-line installer, with instructions to check it before
  running it.

### Changed
- The display API (`/api/display/*`, `/api/events`, `/api/weather`, `/api/news`, `/api/photos`, `/api/countdowns`,
  `/api/stream`, heartbeat) and `/media/*` require a display key, a device token or an admin session in private mode
  (`401 key_required` / `403 invalid_key`, no data). **Upgrading keeps your displays working**: a config saved by 0.2
  loads with display access `open`; switch to private in *Security* after opening each display's private link (or
  pairing it). Restoring an older backup or importing an older export keeps the current mode.
- Raspberry Pi docs and the setup wizard use the private link as the kiosk URL; on an all-in-one install
  `deploy/kiosk.sh` turns a keyless `http://localhost` URL into the screen's private link (read from the local data
  folder on every Chromium start; the kiosk log shows it redacted). `deploy/Caddyfile.example` explains what to expose
  in each mode.
- The private-link card and the setup wizard show the one-line kiosk command
  (`curl -fsSL https://marcohome.app/install | bash -s -- --mode kiosk --url <link>`).
- `deploy/install.sh` is now a thin wrapper around `install.sh` for git checkouts (same options as before, plus
  `--dry-run`); `marco update` on such an install runs `git pull` and rebuilds.
- `deploy/marco.service` takes the data folder and the `.env` path from the installer.
- Kiosk: Chromium starts with `--force-device-scale-factor=1` (override it in `KIOSK_EXTRA_ARGS`) and
  `--disable-translate`.
- New logo: two arches, one with the sun and one with the moon, inside an M-shaped frame. It replaces the calendar
  badge in the admin sidebar, login, setup wizard and the display's welcome and pairing screens, and comes as a
  favicon set (`favicon.svg`, 32 px PNG, 180 px `apple-touch-icon.png`, 512 px icon). Lockups for light and dark
  backgrounds are in `docs/`. The display page title is now "Marco".
- The server's Express app is built by `server/app.js` (`createApp()`), so the tests exercise the real middleware stack.
- Text clean-up in the docs, the admin and the display: plainer wording, and no em dashes in English, Spanish or
  Portuguese strings. Empty values in the admin show "–".

### Security
- Display keys, device tokens and pairing session ids are compared in constant time and never logged (server log URLs
  and activity-log data are redacted); every response sends `Referrer-Policy: no-referrer`, keyed responses
  `Cache-Control: private, no-store`, and `/d/*` adds `X-Robots-Tag: noindex`. Threat model and brute-force math in
  `SECURITY.md`.
- Open display streams follow every credential change, not only *Regenerate link* / *Revoke*: each stream keeps a hash
  of the key or device token it opened with and is re-checked after config saves, imports, session revocation and on
  every heartbeat. Importing secrets that replace a screen's key or drop a paired device closes the streams still
  using them (`revoked { code: "invalid_key" }`), and the import preview lists the links and devices it would change.
- Live streams opened with an admin session (previews, "View screen") close on *Log out everywhere*, a password change,
  an imported password, a disabled login method, a plain logout of the same browser and after the session lifetime.
- Moving a paired device to another screen closes its stream (after `reload`), so a client that ignores `reload` no
  longer receives the old screen's announcements.
- Restoring a backup or importing a bundle never changes *Display access*. The import preview says the mode is kept.
- The installer writes `.env` and `kiosk.env` with mode 600, never prints a private link in full, and keeps the
  folders it creates in a user's home owned by that user.

## [0.2.0] - 2026-10-09

First public release.

### Display
- Month calendar (configurable weeks), agenda and week views; five layouts (`bigCalendar`, `leftRight`, `topBottom`,
  `bigTime`, `agenda`), portrait and landscape, small-screen sizing and adaptive legibility over photos.
- Automatic emoji icons from editable keyword rules; birthdays with age ("🎂 Grandma Isabel (72)").
- Vacation-rental feeds (Airbnb "Reserved", Booking, property-management tools): check-in → check-out bars, guests as
  🧑🏻/🧒🏻/👶🏻/🐶 icons, 🚪 checkouts, blocked dates.
- Clock with seconds, weather (Open-Meteo or Home Assistant, indoor sensors, rain effect), RSS news ticker, countdowns,
  to-do list, message of the day, highlights ("Check-in today", "Next: …").
- Background photos (stock or your own gallery) with WebGL transitions, focal-point aware cropping and an ambient
  aurora; `?lite=1` for low-power devices; night mode.
- Invisible live refresh via Server-Sent Events, offline tolerance, instant announcements with chime, scheduled
  messages, identify / reload / night commands, multi-screen profiles (`?screen=slug`), built-in demo (`?demo=1`).

### Admin panel
- First-run setup wizard (language, admin password with strength meter, location, calendars with holiday presets and
  iCal test, look, display URL + QR code); no default password, optional `SETUP_TOKEN`; the display shows a welcome
  screen with a QR code until setup is done.
- Password and Google sign-in (allow-list), sessions management.
- Calendars (iCal/ICS and Google Calendar via OAuth), icon rules, local events with recurrence, birthdays (CSV import),
  filters & overrides with live preview, countdowns, weather, news, Home Assistant, photo gallery (in-browser
  optimisation, HEIC conversion, thumbnails, focal-point editor, duplicate handling).
- Multiple screens, connected displays, announcements and scheduled messages, API tokens and webhooks,
  backups / export / import, activity log, home dashboard, command palette (Ctrl/Cmd+K), English / Spanish / Portuguese.

### Deployment
- Raspberry Pi installer (all-in-one, server-only or kiosk-only with `--url`), systemd service, Chromium kiosk script,
  HDMI schedule script, Caddy example, Docker image and Compose file, `npm run demo`.

### Security
- Host-name allowlist against DNS rebinding (LAN names, IP addresses, `PUBLIC_URL`, `ALLOWED_HOSTS`); the CSRF
  guard also checks the `Origin` against it.
- "From the LAN" ignores clients relayed by a proxy missing from `TRUST_PROXY` and, for setup and weak passwords, the
  container gateway; the Docker image always asks for the setup token (`SETUP_REQUIRE_TOKEN=1`).
- Setup-token failures are counted on every setup endpoint (per IPv4 address / IPv6 /64, bounded table); an
  unreadable `secrets.json` stops the server instead of reopening setup; a previously configured install needs the token.
- The unauthenticated setup iCal test refuses loopback / link-local / metadata destinations and returns generic errors.
- Gallery photos (`/media/*`) are served only to LAN clients or a signed-in admin; an `ADMIN_PASSWORD` that breaks the
  password rules is LAN-only.
