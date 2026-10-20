# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private vulnerability reporting
(*Security → Report a vulnerability* on the repository page) and include steps to reproduce and the affected version.
You should get an answer within a week.

## Installer and updates

- `install.sh` downloads release packages from GitHub over HTTPS and checks each one against the `.sha256` file
  published with it before unpacking it; Node.js builds are checked against nodejs.org's `SHASUMS256.txt`. An update
  that does not start within 45 s is rolled back to the previous version.
- If you do not want to pipe a script into `bash`, download `install.sh` and `install.sh.sha256` from the release
  page, run `sha256sum -c install.sh.sha256`, read the script and run it (`--dry-run` shows every action first).
- The installer writes `.env` and the kiosk's `kiosk.env` with mode 600 and never prints a private link in full.
- The service runs as a normal user (yours, or a `marco` system user for a server-only install made as root), unless
  you pass `--user root` yourself.
- Updates started from the admin (release installs): the server only creates `<data>/update/request`. A systemd path
  unit written by the installer (`marco-update.path`) starts `marco-update.service`, which runs
  `marco update --requested` as root. It reads nothing from the request except that it exists, writes its progress
  into the data folder as the service user (so a link planted there cannot make root overwrite another file) and
  always installs the latest release, checksum checked. The files that run as root (the `marco` command, the stored
  installer, the systemd units) come from the verified package or the installer itself, never from the install
  folder, which belongs to the service user.
- The daily update check is a single `GET` to the GitHub API with no identifier; `MARCO_UPDATE_CHECK=0` turns it off.

## Deployment model (what is and is not protected)

Marco was designed for a **home network (LAN)**. Since 0.3 the displays are **private by default**, so it can also be
used on shared networks or behind an HTTPS reverse proxy on the Internet:

- **Display access** (`config.security.displayAccess`, *Admin → Security → Display access*):
  - `private` (default for new installs): the display API (`/api/display/*` incl. the heartbeat, `/api/events`,
    `/api/weather`, `/api/news`, `/api/photos`, `/api/countdowns`, `/api/stream`) and `/media/*` answer only to a
    request carrying the screen's **display key** (private link `/d/<key>`), a **paired-device token**, or a signed-in
    admin. Otherwise `401` (no key) / `403` (unknown, regenerated or revoked key/token) and no data.
  - `open` (installs upgraded from 0.2 keep it so no kiosk goes blank; the admin recommends switching): the display API
    has **no authentication**, as before, and must stay on your LAN. Gallery photos (`/media/*`) are still only sent
    to LAN clients, valid keys or a signed-in admin.
  - Either way the display API never returns calendar URLs, tokens, passwords or Home Assistant credentials, but it
    does return your events, names and photos, which is what the keys protect.
- **Host names**: the server only answers to IP addresses, `localhost`, single-label names, `*.local` / `*.lan` /
  `*.home.arpa` / `*.internal`, the `PUBLIC_URL` host and `ALLOWED_HOSTS` (`421` otherwise; `/api/health` and the
  bearer-token webhooks are exempt). This stops DNS-rebinding attacks, where a website a LAN user visits points its
  own name at your server to read the display API or run the setup wizard from the victim's browser.
- **"From the LAN"** means: a loopback/private client address after `TRUST_PROXY` resolution, *not* relayed by a proxy
  that is missing from `TRUST_PROXY` (forwarding headers from an untrusted hop make the client remote) and not
  relayed without `X-Forwarded-For` (a proxy that sends only `X-Real-IP`, `Forwarded` or `X-Forwarded-Proto` makes the
  client remote too), and for the setup wizard and weak passwords also a direct connection (any forwarding header
  means the token is required) that is not the container's default gateway (in Docker Desktop / rootless setups
  every client looks like that address). Set `TRUST_PROXY` whenever your reverse proxy does not connect from loopback
  (another host, or any proxy in front of the Docker container: `172.16.0.0/12`).
- The admin panel (`/admin/`, `/api/admin/*`) requires a session (password and/or Google sign-in with an allow-list).
  Passwords are stored as scrypt hashes; the session cookie is `HttpOnly` + `SameSite=Lax` and mutating routes require
  JSON (CSRF guard; `Origin: null` is refused, photo uploads need the admin's `X-Requested-With` header). Sessions are
  kept on the server (only a hash of the random session id is stored): logging out ends the session for every copy
  of the cookie, and a session ends after 14 days, or after 7 days without use. Exports and imports with private
  data need a sign-in in the last 10 minutes or the password. Password checks (sign-in, current password) are
  limited per address and, from outside the LAN, also in total across all addresses. There is no default password: a fresh install runs a first-run setup wizard that creates it
  (≥ 10 characters, common passwords refused). The setup endpoints work only until a password exists, only one
  request can complete them, and they accept requests from LAN clients only, unless the one-time token printed in
  the server log (or `SETUP_TOKEN`, which then is always required) is given. The token is always required with
  `SETUP_REQUIRE_TOKEN=1` (the Docker image's default) and for an install that was configured before but lost its
  `secrets.json`; an unreadable `secrets.json` stops the server instead of silently reopening setup. Wrong tokens are
  counted on every setup endpoint (10 per IPv4 address / IPv6 /64 → 10-minute lockout). An `ADMIN_PASSWORD` that
  breaks the same rules (headless installs) is only accepted from LAN clients and the panel forces a change.
- Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Content-Security-Policy: frame-ancestors 'self'` (only the admin's own preview can frame a page) and
  `Referrer-Policy: no-referrer`; the display and admin pages are sent with `Cache-Control: no-store`. Admin changes
  also refuse a `Sec-Fetch-Site` other than `same-origin`.
- The display page also gets `script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none';
  form-action 'none'` (no inline or outside script). While a screen has a custom HTML card, `frame-src` limits its
  frames to the server itself and the saved web widgets. Custom HTML cards (self-hosted only) never run code: the
  HTML goes through an allowlist (elements, attributes, where `{{placeholders}}` may stand) and is drawn in an
  `<iframe sandbox="">` with its own `default-src 'none'` policy and `pointer-events: none`, so it cannot run a
  script, load anything from the network or navigate.
- Webhooks (`/api/hooks/*`) only accept `Authorization: Bearer <token>`; tokens are stored as SHA-256 hashes and
  rate-limited (30 requests/minute per token).
- Secrets (`data/secrets.json`, `.env`, exports that include secrets, `data/backups/`) must be kept private.
- **Outbound requests (SSRF)**: calendar (iCal), RSS and Home Assistant URLs entered in the admin, and the admin's
  *Test* buttons, are fetched **from the server**, including LAN and loopback addresses (that is how Nextcloud or
  Home Assistant on your network work), redirects included. Anyone with an admin session can therefore make the
  server request internal URLs; treat admin access accordingly. The only unauthenticated fetch, the setup wizard's
  iCal test (`/api/setup/test-ics`), refuses loopback, link-local / cloud-metadata, multicast and unspecified
  destinations on every redirect hop and returns only generic errors.

If you need remote access, put an HTTPS reverse proxy in front (see `deploy/Caddyfile.example`), use a strong
password, set `PUBLIC_URL` to your domain, and set `TRUST_PROXY` whenever the proxy does not connect from loopback
(another host, or Docker). Expose the display routes (`/`, `/d/*`, `/pair`, `/api/display/*`, `/api/stream`…) only in
**private** display-access mode; in open mode expose only the admin, login and setup routes. Open mode trusts this machine
(loopback): a tunnel that connects from the same machine without sending `X-Forwarded-For` (`ssh -R`, a TCP tunnel)
makes every client on the other end look local, so it would get the default screen, the family QR code and taps on
the TV. Never put open mode behind such a tunnel.

## Private display links and pairing: threat model

**What is protected**: the family's calendar, names, birthdays, photos, to-dos and messages shown on the screens.

**Credentials**

| Credential | Entropy | Stored as | Lifetime |
|---|---|---|---|
| Display key (private link `/d/<key>`) | UUIDv4 from the OS CSPRNG (`crypto.randomUUID`): **122 random bits** | plain, in `data/secrets.json` (mode 600), because the admin must be able to show the link again | until *Regenerate link* or the screen is deleted |
| Device token (pairing) | `md_` + 32 random bytes: **256 bits** | SHA-256 hash only | until revoked |
| Pairing session id | 32 random bytes: **256 bits** | SHA-256 hash, memory only | ≤ 10 minutes |
| Pairing code | 6 symbols from a 31-symbol alphabet: 31⁶ ≈ **8.9 × 10⁸** | memory only | ≤ 10 minutes, single use |

Why a UUIDv4 for the key: it is the format people expect in such links, lower-case hex is easy to read and type on a
Raspberry Pi with a keyboard (no ambiguous upper/lower case), it validates with a strict pattern, and 122 random bits
are far beyond guessing (base64url with 128 bits would only be slightly shorter). Comparisons hash both sides
(SHA-256) and use `crypto.timingSafeEqual` over every stored entry, so timing reveals neither which key matched nor
how much of it.

**Brute force**

- *Display keys*: 2¹²² ≈ 5.3 × 10³⁶ values. Even at 10 000 requests/second for a whole year (3.2 × 10¹¹ guesses, far
  more than a Pi can answer) against 20 screens, the chance of hitting any key is about 1.2 × 10⁻²⁴. No rate limit is
  needed (and none would help an attacker with a botnet anyway); device tokens (2²⁵⁶) even less.
- *Pairing codes*: the code only labels a waiting display; **it never yields a token**. The token is handed to whoever
  polls with the 256-bit session id that `/api/pair/start` returned to that display, so reading a code over someone's
  shoulder gives nothing. Claiming a code needs an **admin session** (and passes the CSRF guard). Claims are limited to
  10 wrong codes per admin session + address and 50 wrong codes overall per 10 minutes (after that every claim gets
  `429`, even with a right code, so there is no oracle), codes are single use, live 10 minutes and can only be claimed
  while their display polled within the last 15 s. With at most 100 pending codes, one guess succeeds with probability
  ≤ 100 / 31⁶ ≈ 1.1 × 10⁻⁷, and the global cap (7 200 wrong guesses per day) bounds it to ≈ 0.08 % per day, and a
  "success" would only pair a stranger's waiting display to the guesser's own calendar.
- *Starting pairing sessions* is unauthenticated: 10 per IPv4 address / IPv6 /64 per 10 minutes and at most 100
  pending in total. Flooding it can delay pairing (`503`, the display retries), never grant access; private links keep
  working.

**Attackers and mitigations**

- *Someone else on the same network* (shared Wi-Fi, guest network, flat share, office): private mode answers nothing
  without a key. Use HTTPS on networks you do not control: on plain HTTP anyone who can sniff the traffic can read the
  key (WPA2-Personal users with the same passphrase can decrypt each other's traffic).
- *Internet scanners* (when exposed): same as above; the host-name allowlist (`PUBLIC_URL` / `ALLOWED_HOSTS`) and
  `X-Robots-Tag: noindex` on `/d/*` apply, and nothing on `/`, `/pair` or the API reveals data without a key.
- *A leaked link* (shared screenshot, photo of the kiosk's address bar, browser history on a shared computer): the
  link shows that one screen only. *Regenerate link* revokes it at once: connected displays using it receive
  `revoked` over SSE, wipe their cached data and show "This link is no longer valid".
- *A lost or given-away tablet*: revoke its paired device (each device has its own token; the activity log records
  pairings and revocations).
- *Revocation reaches open connections*: the SSE stream remembers a hash of the credential it was opened with and is
  re-checked whenever keys, devices, sessions or the access mode can change (regenerate, revoke, move a device, config
  save, import with secrets, logout / logout everywhere / password change) and on every 25 s heartbeat. A stream whose
  credential no longer resolves to the same screen is closed (`revoked`, or `reload` for a device moved to another
  screen), so neither a misbehaving client nor a forgotten admin tab keeps receiving announcements.
- *Restore and import* never change the display access mode (private / open): only *Security* does. Importing a
  bundle's secrets can bring back that bundle's private links: the import preview lists the screens whose link would
  change and the paired devices it would drop.
- *Leaking through referrers, caches and logs*: every response sends `Referrer-Policy: no-referrer`; keyed responses
  are `Cache-Control: private, no-store`; keys, device tokens and pairing session ids never enter the activity log or
  the server log (URLs are redacted, the activity log redacts any `/d/…`, `?k=` or `md_…` it would otherwise store).
  `?k=` appears in URLs only for the SSE stream and photos, where browsers cannot send headers: if your reverse proxy
  writes access logs, leave out the query string (Caddy logs nothing by default; for nginx use a `log_format` without
  `$request_uri`/`$args`, or `access_log off` for `/api/stream` and `/media/`).
- *Social engineering of the pairing dialog* ("type this code to fix your screen"): pairing gives the code's display a
  token for the screen the admin picks. The claim has two steps: the admin first shows the address of the display
  that is waiting with that code and asks the owner to confirm it is the screen in front of them; only the second
  request pairs. Only type codes shown on your own screens; the new device appears in *Connected screens → Paired
  devices*, where it can be revoked.
- *Malicious websites in a family member's browser* (CSRF, DNS rebinding): admin actions (claim, regenerate, revoke)
  need the session cookie (`SameSite=Lax`), JSON bodies and a matching `Origin` (never `null`); unknown host names
  get `421`. The
  pairing status endpoint needs the secret session id.

- *Family access* (each person's dashboard on the phone, `/my`): the person's private link and each phone's token
  are bearer secrets stored as SHA-256 digests only; the link is shown to the admin once. A code shown on a screen
  (6 characters, two minutes, single use) is kept as a digest too, except in the command to that screen for its two
  minutes; once it is used, replaced or the person removed, the screen is told to take it down. Wrong codes are
  limited to 10 per address and 50 overall per 10 minutes, wrong links and tokens to 20 and 200; the overall limits
  only count and stop clients from outside the local network, so a flood from the Internet cannot lock out the
  phones at home. The token travels in a header, POST bodies must be JSON and the `Origin` must
  match, so another site cannot act for the phone. Every action is checked against the person's permissions of that
  moment, the token never opens an admin route, and the phone gets nothing but the person's name and their controls.
  Anyone who can read a screen while a code is on it can use the code: show codes only on screens in front of the
  person, and remove a phone you do not know from the person's list.

**Residual risks**: the private link is a bearer secret: whoever has it sees that screen until it is regenerated.
Device tokens live in the display browser's `localStorage`, readable by scripts on the same origin (custom CSS is the
only user-supplied content the display injects, and it is CSS only). Anybody standing in front of the screen sees
what it shows. In open mode none of the above applies to the display API.

