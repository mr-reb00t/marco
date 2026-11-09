#!/usr/bin/env bash
# Starts Chromium in kiosk mode showing Marco.
# Launched by the desktop session autostart (labwc / wayfire / LXDE-pi), set up by install.sh.
#
# Optional variables (put them in ~/.config/marco/kiosk.env):
#   KIOSK_URL        URL to show: the screen's private link, e.g. http://homeserver.lan:3000/d/<key>
#                    (Admin → Screen → Settings → Private link). Default http://localhost:$PORT/: on an all-in-one
#                    install the kiosk then opens the default screen's private link (read from the local data folder;
#                    add ?screen=<slug> for another one). ?lite=1 disables the WebGL effects (slow Pis);
#                    ?lowpower=1 keeps them but makes every carousel switch a short fade.
#   KIOSK_CLIENT     Name of this display in the admin panel (default: hostname)
#   PORT             Local server port (default: read from ../.env, else 3000)
#   KIOSK_EXTRA_ARGS Extra Chromium flags, e.g. "--force-device-scale-factor=0.75" to fit more on a small screen
#                    (the default scale is 1, so the layout does not depend on the desktop's zoom setting)
#   KIOSK_WAIT_SEC   Max seconds to wait for /api/health before opening anyway (default 120)
#   KIOSK_LOG        Log file when not started from a terminal (default /tmp/marco-kiosk.log)
#   MARCO_RUN_DIR    Where the Marco server asks the kiosk to close (default /run/marco, see below)
#
# "Salir del kiosko" (a card on a screen of this device): the server writes a new number to /run/marco/kiosk-exit
# (its systemd RuntimeDirectory, readable by everyone, emptied at every boot). When that number changes while Chromium
# runs, this script closes Chromium and does not open it again: the kiosk comes back at the next login or reboot, or
# from the menu entry "Marco" (kiosk.sh --open). The number is only compared, never run or used for anything else. A desktop that starts
# this script again by itself (LXDE-pi's @ lines) finds it closed for that number and login session
# ($XDG_RUNTIME_DIR, cleared at logout) and exits at once.
# Only this browser may use those cards: it gets the server's kiosk key (data/secrets.json) in the URL fragment (#kp=).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

# shellcheck disable=SC1091
[ -f "$HOME/.config/marco/kiosk.env" ] && . "$HOME/.config/marco/kiosk.env"

if [ -z "${PORT:-}" ] && [ -f "$APP_DIR/.env" ]; then
  PORT="$(grep -E '^PORT=' "$APP_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
fi
PORT="${PORT:-3000}"
KIOSK_URL="${KIOSK_URL:-http://localhost:${PORT}/}"
# Stable identity for the admin's "Connected displays" page: Chromium runs --incognito, so localStorage does not
# survive restarts; append client=<hostname> unless the URL already has one.
# (Another screen profile: its private link, KIOSK_URL="http://localhost:3000/d/<key>"; open mode: ?screen=kitchen)
KIOSK_CLIENT="${KIOSK_CLIENT:-$(hostname 2>/dev/null || echo kiosk)}"
KIOSK_CLIENT="$(printf '%s' "$KIOSK_CLIENT" | tr -c 'A-Za-z0-9_-' '-' | cut -c1-64)"
case "$KIOSK_URL" in
  *client=*) ;;
  *\?*) KIOSK_URL="${KIOSK_URL}&client=${KIOSK_CLIENT}" ;;
  *) KIOSK_URL="${KIOSK_URL}?client=${KIOSK_CLIENT}" ;;
esac
KIOSK_WAIT_SEC="${KIOSK_WAIT_SEC:-120}"
KIOSK_EXTRA_ARGS="${KIOSK_EXTRA_ARGS:-}"
# Health check against the server the URL points to (works for a remote server too).
ORIGIN="$(printf '%s' "$KIOSK_URL" | sed -E 's|^(https?://[^/?#]+).*|\1|')"
HEALTH_URL="${ORIGIN}/api/health"

log() { echo "[kiosk $(date '+%H:%M:%S')] $*"; }

# --- Single instance ------------------------------------------------------------
LOCK_DIR="${XDG_RUNTIME_DIR:-/tmp}"
exec 9>"$LOCK_DIR/marco-kiosk.lock"
if ! flock -n 9; then
  log "A kiosk is already running; exiting."
  exit 0
fi

# --- Log -------------------------------------------------------------------------
# Started from a desktop autostart (wayfire, LXDE-pi, XDG) the output would go nowhere or to ~/.xsession-errors:
# write it to the kiosk log (`marco logs` on a kiosk-only device). Run by hand in a terminal it stays there.
KIOSK_LOG="${KIOSK_LOG:-/tmp/marco-kiosk.log}"
if [ ! -t 1 ]; then exec >"$KIOSK_LOG" 2>&1; fi

# --- Closed from the screen ----------------------------------------------------------
# (after the log redirect, so what it says lands in the kiosk log; after the lock, so one kiosk decides)
MARCO_RUN_DIR="${MARCO_RUN_DIR:-/run/marco}"
# The server's last "Salir del kiosko": digits only ('' when there is none).
token() { head -c 32 "$MARCO_RUN_DIR/kiosk-exit" 2>/dev/null | tr -cd '0-9' || true; }
# The marker of a close from the screen: in the session's own runtime folder (gone at logout), else in this user's
# home (never /tmp, where another user could leave one). It holds the number and the login session, so it only
# keeps the kiosk closed for the rest of that session, even when the runtime folder outlives a logout.
if [ -n "${XDG_RUNTIME_DIR:-}" ]; then CLOSED="$XDG_RUNTIME_DIR/marco-kiosk.closed"
else mkdir -p "$HOME/.cache"; CLOSED="$HOME/.cache/marco-kiosk.closed"; fi
SESSION_TAG="$(printf '%s' "${XDG_SESSION_ID:-}" | tr -cd 'A-Za-z0-9_-')"
closed_for() { [ -n "$1" ] && [ "$(head -c 100 "$CLOSED" 2>/dev/null | tr -cd '0-9A-Za-z_ -' || true)" = "$1 $SESSION_TAG" ]; }
# --open (the menu entry "Marco"): opened by hand, so a close asked earlier no longer holds it back
if [ "${1:-}" = --open ]; then rm -f "$CLOSED"; fi
if [ -s "$CLOSED" ] && closed_for "$(token)"; then
  log "Closed from the screen; it opens again at the next login (or from the menu: Marco)."
  exit 0
fi
# A request from before this start (an earlier session) does not count: only a new number does.
BASE="$(token)"
# A new number: close Chromium (when it runs), note it for this session and stop.
closed_now() {
  local t
  t="$(token)"
  [ -n "$t" ] && [ "$t" != "$BASE" ] || return 1
  log "Exit asked from the screen: Chromium closes. It opens again at the next login (or from the menu: Marco)."
  if [ -n "${1:-}" ]; then close_browser "$1"; fi
  (umask 077; printf '%s %s' "$t" "$SESSION_TAG" > "$CLOSED")
  exit 0
}

# --- Browser --------------------------------------------------------------------
BROWSER=""
for b in chromium-browser chromium google-chrome; do
  if command -v "$b" >/dev/null 2>&1; then BROWSER="$b"; break; fi
done
if [ -z "$BROWSER" ]; then
  log "ERROR: Chromium not found. Install it with: sudo apt install chromium (or chromium-browser)"
  exit 1
fi

IS_WAYLAND=0
if [ -n "${WAYLAND_DISPLAY:-}" ]; then IS_WAYLAND=1; fi

# --- Keep the screen on and hide the cursor --------------------------------------
if [ "$IS_WAYLAND" = 1 ]; then
  # On labwc/wayfire screen blanking is done by swayidle (started by the system autostart).
  # Disable it permanently with: sudo raspi-config nonint do_blanking 1
  if pgrep -u "$(id -u)" -x swayidle >/dev/null 2>&1; then
    log "Stopped swayidle so the screen does not blank."
    pkill -u "$(id -u)" -x swayidle || true
  fi
  # Hide the cursor: move it to the bottom-right corner (the page also uses cursor: none).
  if command -v wlrctl >/dev/null 2>&1; then
    wlrctl pointer move 10000 10000 >/dev/null 2>&1 || true
  fi
else
  if command -v xset >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
    xset s off || true
    xset s noblank || true
    xset -dpms || true
  fi
  if command -v unclutter >/dev/null 2>&1 && ! pgrep -u "$(id -u)" -x unclutter >/dev/null 2>&1; then
    unclutter -idle 0.5 -root >/dev/null 2>&1 &
  fi
fi

# --- Wait for the server ---------------------------------------------------------
http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "$1" >/dev/null 2>&1
  else
    wget -q -T 3 -O /dev/null "$1" >/dev/null 2>&1
  fi
}

log "Waiting for the server at $HEALTH_URL (max ${KIOSK_WAIT_SEC}s)..."
waited=0
until http_ok "$HEALTH_URL"; do
  if [ "$waited" -ge "$KIOSK_WAIT_SEC" ]; then
    log "Server not answering; opening anyway (the page retries by itself)."
    break
  fi
  sleep 2
  waited=$((waited + 2))
done

# --- Private display link (all-in-one) ----------------------------------------------
# With private display access a keyless http://localhost URL only shows a pairing code, and this incognito browser
# forgets pairings when it restarts. On an all-in-one install the server's data folder is on this machine (and owned
# by this user): use the screen's private link from it, unless KIOSK_URL already carries a key (/d/<key>).
# The server's data folder on this machine (MARCO_DATA_DIR, else DATA_DIR in the app's .env, else <app>/data).
data_dir() {
  local data="${MARCO_DATA_DIR:-}"
  if [ -z "$data" ] && [ -f "$APP_DIR/.env" ]; then
    data="$(grep -E '^DATA_DIR=' "$APP_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
  fi
  data="${data:-$APP_DIR/data}"
  case "$data" in /*) ;; *) data="$APP_DIR/$data" ;; esac
  printf '%s' "$data"
}
local_link() {
  case "$KIOSK_URL" in
    http://localhost:*|http://localhost/*|http://127.0.0.1:*|http://127.0.0.1/*) ;;
    *) return 1 ;;
  esac
  case "$KIOSK_URL" in *"/d/"*) return 1 ;; esac
  command -v node >/dev/null 2>&1 || return 1
  local data
  data="$(data_dir)"
  [ -r "$data/secrets.json" ] && [ -r "$data/config.json" ] || return 1
  node -e '
    const fs = require("fs"), path = require("path");
    const [dir, url] = process.argv.slice(1);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
    const sec = JSON.parse(fs.readFileSync(path.join(dir, "secrets.json"), "utf8"));
    if ((cfg.security || {}).displayAccess !== "private") process.exit(1);
    const u = new URL(url);
    const want = (u.searchParams.get("screen") || "").toLowerCase();
    const list = Array.isArray(cfg.screens) ? cfg.screens : [];
    const scr = (want && list.find((s) => s.slug === want || String(s.id).toLowerCase() === want))
      || list.find((s) => s.id === cfg.defaultScreen) || list[0];
    const key = scr && sec.displayKeys && sec.displayKeys[scr.id] && sec.displayKeys[scr.id].key;
    if (typeof key !== "string" || !/^[0-9a-f-]{36}$/.test(key)) process.exit(1);
    u.pathname = "/d/" + key;
    u.searchParams.delete("screen");
    process.stdout.write(u.toString());
  ' "$data" "$KIOSK_URL" 2>/dev/null
}
# The kiosk key (data/secrets.json kioskToken, server/power.js): with it, the "Salir del kiosko" and "Apagar" cards
# of this browser work. Only for a local URL, from the same data folder as the private link. In the URL fragment, so
# it is never sent in a request or logged by the server; the page keeps it for this browser session.
kiosk_key() {
  case "$URL" in
    http://localhost:*|http://localhost/*|http://127.0.0.1:*|http://127.0.0.1/*) ;;
    *) return 1 ;;
  esac
  command -v node >/dev/null 2>&1 || return 1
  local data
  data="$(data_dir)"
  [ -r "$data/secrets.json" ] || return 1
  node -e '
    const sec = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (typeof sec.kioskToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(sec.kioskToken)) process.exit(1);
    process.stdout.write(sec.kioskToken);
  ' "$data/secrets.json" 2>/dev/null
}
# The kiosk log never shows the key or the kiosk key.
redact_url() { printf '%s' "$1" | sed -E -e 's|/d/[^/?#]+|/d/<private-link>|' -e 's|#kp=[^&]*|#kp=<kiosk-key>|'; }

# --- Chromium flags ----------------------------------------------------------------
PROFILE_DIR="$HOME/.cache/marco-kiosk"
# Chromium from a snap (Ubuntu: /snap/bin/chromium, or the chromium-browser script that starts it) cannot write to
# hidden folders in the home directory: give it a folder of its own.
BROWSER_PATH="$(command -v "$BROWSER")"
case "$BROWSER_PATH" in
  /snap/*) PROFILE_DIR="$HOME/snap/chromium/common/marco-kiosk" ;;
  *) if [ -x /snap/bin/chromium ] && grep -qs '/snap/bin/' "$BROWSER_PATH"; then PROFILE_DIR="$HOME/snap/chromium/common/marco-kiosk"; fi ;;
esac
mkdir -p "$PROFILE_DIR"

FLAGS=(
  --kiosk
  --noerrdialogs
  --disable-infobars
  --incognito
  --no-first-run
  --check-for-update-interval=31536000
  --disable-features=Translate
  --disable-translate
  --overscroll-history-navigation=0
  --enable-gpu-rasterization
  --ignore-gpu-blocklist
  --disable-session-crashed-bubble
  --disable-pinch
  --password-store=basic
  --autoplay-policy=no-user-gesture-required
  --force-device-scale-factor=1
  --user-data-dir="$PROFILE_DIR"
)
if [ "$IS_WAYLAND" = 1 ]; then
  FLAGS+=(--ozone-platform=wayland)
fi
# shellcheck disable=SC2206
EXTRA=( $KIOSK_EXTRA_ARGS )

# --- Loop: relaunch Chromium if it exits or crashes ---------------------------------
trap 'log "Exiting"; pkill -P $$ || true; exit 0' INT TERM

# Chromium of Raspberry Pi OS is a wrapper script: the browser may not be the process started here, so every process
# of this user that runs with the kiosk's own profile folder goes too.
close_browser() {
  local pid="$1" _
  kill -TERM "$pid" 2>/dev/null || true
  pkill -TERM -u "$(id -u)" -f -- "--user-data-dir=$PROFILE_DIR" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$pid" 2>/dev/null && ! pgrep -u "$(id -u)" -f -- "--user-data-dir=$PROFILE_DIR" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  kill -KILL "$pid" 2>/dev/null || true
  pkill -KILL -u "$(id -u)" -f -- "--user-data-dir=$PROFILE_DIR" 2>/dev/null || true
}

fails=0
while true; do
  # Resolved on every launch, so a regenerated link is picked up when Chromium restarts.
  URL="$(local_link || true)"
  URL="${URL:-$KIOSK_URL}"
  case "$URL" in *'#'*) ;; *) KP="$(kiosk_key || true)"; if [ -n "$KP" ]; then URL="$URL#kp=$KP"; fi ;; esac
  # asked while the server was starting or between two launches: do not open it at all
  closed_now || true
  log "Launching $BROWSER -> $(redact_url "$URL")"
  start_ts=$(date +%s)
  "$BROWSER" "${FLAGS[@]}" "${EXTRA[@]}" "$URL" </dev/null >/dev/null 2>&1 9>&- &
  CPID=$!
  while kill -0 "$CPID" 2>/dev/null; do
    closed_now "$CPID" || true
    sleep 2
  done
  wait "$CPID" 2>/dev/null || true
  run_for=$(( $(date +%s) - start_ts ))
  if [ "$run_for" -lt 30 ]; then
    fails=$((fails + 1))
  else
    fails=0
  fi
  # Back off when it keeps failing (max 60 s)
  delay=$(( fails * 5 ))
  [ "$delay" -gt 60 ] && delay=60
  [ "$delay" -lt 3 ] && delay=3
  log "Chromium exited (ran ${run_for}s). Relaunching in ${delay}s..."
  sleep "$delay"
done
