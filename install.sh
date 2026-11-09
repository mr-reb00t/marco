#!/usr/bin/env bash
# Marco installer: https://marcohome.app
#
#   curl -fsSL https://marcohome.app/install | bash
#   curl -fsSL https://marcohome.app/install | bash -s -- --mode kiosk --url http://homeserver.lan:3000/d/<key>
#
# Modes:
#   server  server only (home server, NAS, any Debian/Ubuntu machine); screens connect to it over the network
#   all     server and screen on this device (Raspberry Pi with a desktop, or any Debian/Ubuntu desktop)
#   kiosk   screen only: this device opens the private link of a Marco server that runs elsewhere
#
# Options:
#   --mode server|all|kiosk   What to install (asked when omitted and a terminal is available)
#   --url <link>              Private display link for the kiosk (Admin > Screen > Settings > Private link)
#   --port <n>                Server port (default 3000)
#   --dir <path>              Install folder (default ~/marco, or /opt/marco when run as root)
#   --user <name>             User that runs the server and the desktop session (default: you, or $SUDO_USER)
#   --version <x.y.z>         Version to install (default: latest release)
#   --update                  Update an existing install (same as running the installer again)
#   --force                   Reinstall the same version, or install an older one
#   --uninstall [--purge]     Remove Marco; --purge also deletes the data folder (config, photos, backups)
#   --yes, -y                 Do not ask; use the defaults (uninstall needs it when there is no terminal)
#   --dry-run                 Print every action and change nothing
#   --skip-apt                Do not install system packages
#   --power-button            Let the "Apagar" (Shut down) card on a screen of this device power it off (asked in an
#                             all-in-one install; off by default). Later: sudo marco power on|off
#   --no-power-button         Do not (removes the permission if an earlier install gave it)
#   -h, --help                Show this help
#
# Layout (release installs):
#   <dir>/current        -> releases/<version>   (the running version; swapped atomically on update)
#   <dir>/releases/      the installed versions (the current one and the previous one, for rollback)
#   <dir>/data/          config, secrets, photos, backups (kept on update and on uninstall without --purge)
#   <dir>/.env           settings (port, secrets), see .env.example
#   /etc/marco.conf      what was installed and where (read by the `marco` command)
#   /usr/local/bin/marco command line: marco status | logs | restart | update | url | version | power | uninstall
#   /etc/systemd/system/marco-update.{path,service}   updates started from the admin (release installs)
#   /etc/systemd/system/marco-power.{path,service}    only with --power-button: the "Apagar" card powers off the device
set -euo pipefail

MARCO_REPO="${MARCO_REPO:-mr-reb00t/marco}"
MARCO_REPO_URL="${MARCO_REPO_URL:-https://github.com/${MARCO_REPO}.git}"
# Testing only: a server that answers like GitHub releases (<url>/latest redirects to <url>/tag/v<x.y.z>, packages at
# <url>/download/v<x.y.z>/marco-<x.y.z>.tar.gz). Kept in /etc/marco.conf when set.
MARCO_RELEASES_URL="${MARCO_RELEASES_URL:-}"
RELEASES_URL="${MARCO_RELEASES_URL:-https://github.com/${MARCO_REPO}/releases}"
NODE_MAJOR=22
NODE_MIN=20
SERVICE=marco
UPDATE_UNIT=marco-update
POWER_UNIT=marco-power
CONF=/etc/marco.conf
CLI=/usr/local/bin/marco
LIBDIR=/usr/local/lib/marco
MARKER="# marco-kiosk"

# ---- Options ---------------------------------------------------------------------------------------------
MODE=""
KIOSK_URL=""
PORT=""
DIR=""
RUN_USER=""
WANT_VERSION=""
YES=0
DRY=0
ACTION=install
PURGE=0
SKIP_APT=0
FORCE=0
POWER=""                                      # 1: the "Apagar" card may power off this device; 0: not; "": ask / keep
POWER_FLAG=0                                  # 1: POWER came from --power-button / --no-power-button
SOURCE_DIR=""                                 # --source <checkout>: build and run a local git checkout in place
TARBALL_URL="${MARCO_TARBALL_URL:-}"          # testing: install this tarball (its .sha256 must sit next to it)

# ---- Output ----------------------------------------------------------------------------------------------
if [ -t 1 ]; then
  C_B=$'\033[1m'; C_DIM=$'\033[2m'; C_CY=$'\033[1;36m'; C_GR=$'\033[1;32m'; C_YE=$'\033[1;33m'; C_RE=$'\033[1;31m'; C_0=$'\033[0m'
else
  C_B=""; C_DIM=""; C_CY=""; C_GR=""; C_YE=""; C_RE=""; C_0=""
fi
info() { printf '%s==>%s %s\n' "$C_CY" "$C_0" "$*"; }
ok()   { printf '%s ok%s %s\n' "$C_GR" "$C_0" "$*"; }
warn() { printf '%s  !%s %s\n' "$C_YE" "$C_0" "$*" >&2; }
die()  { printf '%sError:%s %s\n' "$C_RE" "$C_0" "$*" >&2; exit 1; }
plan() { printf '%s[dry-run]%s %s\n' "$C_DIM" "$C_0" "$*"; }

usage() {
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//' && return 0
  echo "Usage: install.sh [--mode all|server|kiosk] [--url <link>] [--port <n>] [--dir <path>] [--version <x.y.z>]"
  echo "                  [--yes] [--dry-run] [--update] [--uninstall [--purge]]"
}

# ---- Running commands (everything that changes the system goes through these) ----------------------------
SUDO=""
q() { local out="" a; for a in "$@"; do out+="$(printf '%q' "$a") "; done; printf '%s' "${out% }"; }

# run <cmd...>: as root (sudo when needed)
run() {
  if [ "$DRY" = 1 ]; then plan "$(q "$@")"; return 0; fi
  if [ -n "$SUDO" ]; then sudo "$@"; else "$@"; fi
}
# as_user <cmd...>: as the service / desktop user
as_user() {
  if [ "$DRY" = 1 ]; then plan "(as $RUN_USER) $(q "$@")"; return 0; fi
  if [ "$(id -un)" = "$RUN_USER" ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1 && { [ -n "$SUDO" ] || [ "$(id -u)" -eq 0 ]; }; then
    sudo -u "$RUN_USER" -H "$@"
  else
    runuser -u "$RUN_USER" -- env HOME="$RUN_HOME" PATH="$PATH" "$@"
  fi
}
# put_file <path> <mode> <owner|root> : writes stdin to <path>
put_file() {
  local dest="$1" mode="$2" owner="$3" tmp
  if [ "$DRY" = 1 ]; then
    plan "write $dest (mode $mode, owner $owner):"
    sed 's/^/            | /'
    return 0
  fi
  tmp="$(mktemp)"
  cat > "$tmp"
  # Folders in a user's home are created as that user (a root-owned ~/.config breaks the desktop session).
  if [ "$owner" != root ]; then as_user mkdir -p "$(dirname "$dest")"; fi
  run install -D -m "$mode" "$tmp" "$dest"
  [ "$owner" = root ] || run chown "$owner:$(id -gn "$owner")" "$dest"
  rm -f "$tmp"
}

# ---- Prompts (work when the script itself arrives on stdin through a pipe) -------------------------------
TTY=""
if [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then TTY=/dev/tty; fi
interactive() { [ "$YES" = 0 ] && [ -n "$TTY" ]; }
ask() { # ask <question> <default> -> REPLY
  local def="$2"
  if ! interactive; then REPLY="$def"; return 0; fi
  printf '%s' "$1" > "$TTY"
  IFS= read -r REPLY < "$TTY" || REPLY=""
  REPLY="${REPLY:-$def}"
}
confirm() { # confirm <question> (default yes)
  ask "$1 [Y/n] " y
  case "$REPLY" in [Nn]*) return 1 ;; *) return 0 ;; esac
}
confirm_no() { # confirm_no <question> (default no: only y or yes goes ahead)
  ask "$1 [y/N] " n
  case "$REPLY" in [Yy]|[Yy][Ee][Ss]) return 0 ;; *) return 1 ;; esac
}

# ---- Helpers ---------------------------------------------------------------------------------------------
# A kiosk link ends up in kiosk.env, which the kiosk script reads as shell: only plain URL characters are accepted.
check_link() {
  case "$1" in http://*|https://*) ;; *) die "The link must start with http:// or https://" ;; esac
  case "${1#*://}" in ""|/*|:*|\?*|\#*) die "The link has no server address: $1" ;; esac
  case "$1" in
    *[[:space:]]*|*\"*|*\'*|*\$*|*\`*|*\\*) die "The link contains spaces, quotes, \$, \` or \\. Copy it again from the admin." ;;
  esac
}
have() { command -v "$1" >/dev/null 2>&1; }
fetch() { curl -fsSL --retry 3 --connect-timeout 15 "$@"; }
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
lan_ip() {
  local ip=""
  if have hostname; then ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -vE '^(127\.|172\.(1[7-9]|2[0-9]|3[01])\.)' | head -n1 || true)"; fi
  if [ -z "$ip" ] && have ip; then ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1 || true)"; fi
  printf '%s' "${ip:-localhost}"
}
env_get() { # env_get <file> <KEY>
  [ -f "$1" ] || return 0
  grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d "\"' " || true
}
show_qr() {
  if have qrencode; then qrencode -t ANSIUTF8 -m 2 "$1" 2>/dev/null || true; fi
}

# ---- Detection -------------------------------------------------------------------------------------------
OS_ID=""; OS_CODENAME=""; OS_NAME=""; OS_VERSION=""
ARCH=""; PI_MODEL=""; DESKTOP=""; X_WM=""; OVERLAY=0; SYSTEMD=0

detect() {
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    OS_ID="$(. /etc/os-release && echo "${ID:-}")"
    # shellcheck disable=SC1091
    OS_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
    # shellcheck disable=SC1091
    OS_NAME="$(. /etc/os-release && echo "${PRETTY_NAME:-$ID}")"
    # shellcheck disable=SC1091
    OS_VERSION="$(. /etc/os-release && echo "${VERSION_ID:-}")"
  fi
  ARCH="$(uname -m)"
  # Raspberry Pi OS (32-bit) starts a 64-bit kernel on a Pi 4 or 5: uname says aarch64 but the programs are armhf,
  # so an arm64 Node.js would not run. What the packages are built for decides.
  if [ "$ARCH" = aarch64 ] && have dpkg && [ "$(dpkg --print-architecture 2>/dev/null)" = armhf ]; then ARCH=armv7l; fi
  if [ -r /proc/device-tree/model ]; then PI_MODEL="$(tr -d '\0' < /proc/device-tree/model)"; fi
  if [ -d /run/systemd/system ]; then SYSTEMD=1; fi
  # Raspberry Pi OS read-only overlay ("Overlay File System" in raspi-config). A container's root file system is
  # an overlay too, so that one does not count.
  local rootfs
  rootfs="$(awk '$2 == "/" { t = $1 " " $3 } END { print t }' /proc/mounts 2>/dev/null || true)"
  case "$rootfs" in
    overlayroot\ *) OVERLAY=1 ;;
    *\ overlay) if ! in_container; then OVERLAY=1; fi ;;
  esac
  detect_desktop
}

in_container() {
  [ -f /.dockerenv ] || [ -f /run/.containerenv ] || grep -qaE '(docker|containerd|lxc|kubepods)' /proc/1/cgroup 2>/dev/null
}

detect_desktop() {
  local u="${RUN_USER:-$(id -un)}" s="" h
  h="$(getent passwd "$u" 2>/dev/null | cut -d: -f6 || true)"
  X_WM=""
  if have pgrep; then
    if pgrep -u "$u" -x labwc >/dev/null 2>&1; then DESKTOP="labwc"; return; fi
    if pgrep -u "$u" -x wayfire >/dev/null 2>&1; then DESKTOP="wayfire"; return; fi
    if pgrep -x Xorg >/dev/null 2>&1; then
      for s in lxsession openbox xfwm4 gnome-shell kwin_x11 marco matchbox-window-manager; do
        if pgrep -u "$u" -x "$s" >/dev/null 2>&1; then X_WM="$s"; break; fi
      done
      # X started from ~/.xinitrc (console auto-login + startx, e.g. Raspberry Pi OS Lite), no display manager
      if [ -n "$h" ] && [ -f "$h/.xinitrc" ] && ! pgrep -x lightdm >/dev/null 2>&1 && ! pgrep -x gdm3 >/dev/null 2>&1 \
         && ! pgrep -x sddm >/dev/null 2>&1; then
        DESKTOP="startx"; return
      fi
      DESKTOP="x11"; return
    fi
  fi
  if [ -r /etc/lightdm/lightdm.conf ]; then
    s="$(grep -E '^\s*(autologin-session|user-session)\s*=' /etc/lightdm/lightdm.conf | tail -n1 | cut -d= -f2 | tr -d ' ' || true)"
  fi
  case "$s" in
    *labwc*) DESKTOP="labwc" ;;
    *wayfire*) DESKTOP="wayfire" ;;
    "") if [ -d /usr/share/xsessions ] || [ -d /usr/share/wayland-sessions ]; then DESKTOP="desktop"; else DESKTOP=""; fi ;;
    *) DESKTOP="x11" ;;
  esac
}

desktop_label() {
  case "$DESKTOP" in
    labwc) echo "labwc (Wayland)" ;;
    wayfire) echo "wayfire (Wayland)" ;;
    x11) echo "X11${X_WM:+ ($X_WM)}" ;;
    startx) echo "X11 started from ~/.xinitrc${X_WM:+ ($X_WM)}, no display manager" ;;
    desktop) echo "installed (session type unknown)" ;;
    *) echo "none" ;;
  esac
}

check_os() {
  local supported=0
  case "$OS_ID" in
    debian|raspbian)
      case "$OS_CODENAME" in bookworm|trixie|forky) supported=1 ;; esac ;;
    ubuntu)
      case "$OS_VERSION" in 22.04|24.04|24.10|25.04|25.10|26.04) supported=1 ;; esac ;;
  esac
  if [ "$supported" = 0 ] && [ -n "${MARCO_SKIP_OS_CHECK:-}" ]; then supported=1; fi
  if [ "$supported" = 0 ]; then
    cat >&2 <<EOF
${C_YE}This installer supports Debian 12/13, Raspberry Pi OS (Bookworm or Trixie) and Ubuntu 22.04 or newer.${C_0}
This system is: ${OS_NAME:-unknown}.

You can still run Marco with Docker on any system (it builds the image from the source):

  git clone https://github.com/${MARCO_REPO}.git marco
  cd marco
  docker compose up -d
  docker compose logs marco | grep setup     # the one-time setup link

More: https://github.com/${MARCO_REPO}#docker
EOF
    exit 1
  fi
  case "$ARCH" in
    x86_64|aarch64|armv7l) ;;
    armv6l) die "This board (ARMv6, e.g. Raspberry Pi Zero or Pi 1) cannot run Node.js 20 or newer. Use it as a screen for a server elsewhere with a browser, or use a Raspberry Pi Zero 2 W or newer." ;;
    *) die "Unsupported processor architecture: $ARCH (supported: x86_64, aarch64, armv7l). Docker is an option, see https://github.com/${MARCO_REPO}#docker" ;;
  esac
}

check_overlay() {
  [ "$OVERLAY" = 1 ] || return 0
  local msg="The root file system is a read-only overlay, so every change would be lost on reboot.
   1. Disable it:      sudo raspi-config nonint disable_overlayfs && sudo reboot
   2. Run this installer again.
   3. Enable it again: sudo raspi-config nonint enable_overlayfs && sudo reboot"
  if [ "$DRY" = 1 ]; then warn "$msg"; warn "A real run would stop here. Showing the remaining steps anyway."; return 0; fi
  die "$msg"
}

# ---- Users and folders -----------------------------------------------------------------------------------
resolve_user() {
  if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
    if [ -z "$RUN_USER" ] && [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != root ]; then RUN_USER="$SUDO_USER"; fi
    if [ -z "$RUN_USER" ] && [ "$MODE" != server ]; then
      # The kiosk runs in the desktop session: use the auto-login user (or the first regular user).
      RUN_USER="$(grep -E '^\s*autologin-user\s*=' /etc/lightdm/lightdm.conf 2>/dev/null | tail -n1 | cut -d= -f2 | tr -d ' ' || true)"
      [ -n "$RUN_USER" ] || RUN_USER="$(getent passwd 1000 | cut -d: -f1 || true)"
    fi
    RUN_USER="${RUN_USER:-marco}"
    DIR="${DIR:-/opt/marco}"
  else
    if [ "$DRY" = 1 ]; then SUDO="sudo"
    else
      have sudo || die "sudo is needed to install the service and system packages. Run this as root or install sudo."
      SUDO="sudo"
    fi
    RUN_USER="${RUN_USER:-$(id -un)}"
  fi
  if ! id "$RUN_USER" >/dev/null 2>&1; then
    if [ "$RUN_USER" = marco ] && [ "$MODE" = server ]; then
      NEW_USER=1
      RUN_HOME="${DIR:-/opt/marco}"
    else
      die "User '$RUN_USER' does not exist (use --user <name>)."
    fi
  else
    NEW_USER=0
    RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
  fi
  DIR="${DIR:-$RUN_HOME/marco}"
  case "$DIR" in /*) ;; *) DIR="$(pwd)/$DIR" ;; esac
  DIR="${DIR%/}"
}

create_user() {
  [ "${NEW_USER:-0}" = 1 ] || return 0
  info "Creating the system user '$RUN_USER'..."
  run useradd --system --home-dir "$DIR" --no-create-home --shell /usr/sbin/nologin "$RUN_USER"
}
run_group() { if [ "${NEW_USER:-0}" = 1 ] && [ "$DRY" = 1 ]; then echo "$RUN_USER"; else id -gn "$RUN_USER"; fi; }

# ---- Existing install ------------------------------------------------------------------------------------
EXISTING=""          # release | checkout | kiosk
EXISTING_VERSION=""
LAYOUT=release
CUR_REL=""           # what $DIR/current points to (releases/<id>)
CUR_GIT=0            # 1 when the running release was built from git (<version>-git.<commit>)

load_existing() {
  if [ -r "$CONF" ]; then
    local c_dir c_mode c_user c_layout c_power
    c_dir="$(sed -n 's/^MARCO_DIR=//p' "$CONF" | tail -n1)"; c_dir="$(eval "printf '%s' $c_dir")"
    c_mode="$(sed -n 's/^MARCO_MODE=//p' "$CONF" | tail -n1)"
    c_user="$(sed -n 's/^MARCO_USER=//p' "$CONF" | tail -n1)"; c_user="$(eval "printf '%s' $c_user")"
    c_layout="$(sed -n 's/^MARCO_LAYOUT=//p' "$CONF" | tail -n1)"
    c_power="$(sed -n 's/^MARCO_POWER=//p' "$CONF" | tail -n1)"
    case "$c_power" in 0|1) POWER="${POWER:-$c_power}" ;; esac
    DIR="${DIR:-$c_dir}"
    RUN_USER="${RUN_USER:-$c_user}"
    if [ -z "$MODE" ] && [ -n "$c_mode" ]; then MODE="$c_mode"; fi
    EXISTING="${c_layout:-release}"
    if [ "$c_mode" = kiosk ]; then EXISTING=kiosk; fi
  fi
}

inspect_dir() {
  [ -n "$EXISTING" ] || {
    if [ -L "$DIR/current" ]; then EXISTING=release
    elif [ -f "$DIR/package.json" ] && [ -d "$DIR/.git" ] && grep -q '"name": "marco"' "$DIR/package.json" 2>/dev/null; then EXISTING=checkout
    fi
  }
  case "$EXISTING" in
    release)
      EXISTING_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DIR/current/package.json" 2>/dev/null | head -n1 || true)"
      CUR_REL="$(readlink "$DIR/current" 2>/dev/null || true)"
      case "$CUR_REL" in *-git.*) CUR_GIT=1 ;; esac ;;
    checkout) EXISTING_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DIR/package.json" 2>/dev/null | head -n1 || true)"; LAYOUT=checkout ;;
  esac
  if [ -n "$SOURCE_DIR" ]; then LAYOUT=checkout; fi
}

# ---- System packages -------------------------------------------------------------------------------------
APT_UPDATED=0
apt_install() {
  local pkgs=() p
  for p in "$@"; do
    dpkg -s "$p" >/dev/null 2>&1 && continue
    if apt-cache show "$p" >/dev/null 2>&1; then pkgs+=("$p"); else warn "Package not available here: $p (skipped)"; fi
  done
  [ "${#pkgs[@]}" -gt 0 ] || return 0
  if [ "$APT_UPDATED" = 0 ]; then
    info "Updating the package index..."
    run apt-get update -qq || warn "apt-get update failed; continuing."
    APT_UPDATED=1
  fi
  info "Installing packages: ${pkgs[*]}"
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${pkgs[@]}"
}

install_packages() {
  [ "$SKIP_APT" = 0 ] || return 0
  have apt-get || { warn "apt-get not found: install curl, tar and xz-utils yourself."; return 0; }
  local base=(ca-certificates curl tar xz-utils openssl)
  if [ "$MODE" != kiosk ]; then base+=(qrencode); fi
  if [ "$LAYOUT" = checkout ] || [ "$NEED_GIT" = 1 ]; then base+=(git); fi
  apt_install "${base[@]}"
  if [ "$MODE" != server ]; then
    if ! have chromium-browser && ! have chromium; then
      if apt-cache show chromium >/dev/null 2>&1; then apt_install chromium; else apt_install chromium-browser; fi
    fi
    case "$DESKTOP" in
      labwc|wayfire) apt_install wlr-randr wlrctl fonts-noto-color-emoji ;;
      x11|startx) apt_install unclutter x11-xserver-utils fonts-noto-color-emoji ;;
      *) apt_install unclutter x11-xserver-utils wlr-randr wlrctl fonts-noto-color-emoji ;;
    esac
  fi
}

# curl is needed before anything else (latest version, downloads). `curl | bash` has it already.
ensure_curl() {
  have curl && return 0
  if [ "$DRY" = 1 ]; then plan "apt-get install curl ca-certificates (curl is missing)"; return 0; fi
  have apt-get || die "curl is needed: install it first."
  [ "$SKIP_APT" = 0 ] || die "curl is needed: install it first (sudo apt install curl)."
  apt_install ca-certificates curl
}

# ---- Node.js ---------------------------------------------------------------------------------------------
NODE_BIN=""
ensure_node() {
  if have node && [ "$(node_major)" -ge "$NODE_MIN" ]; then
    NODE_BIN="$(command -v node)"
    ok "Node.js $(node -v) found at $NODE_BIN"
    return 0
  fi
  local narch
  case "$ARCH" in x86_64) narch=x64 ;; aarch64) narch=arm64 ;; armv7l) narch=armv7l ;; *) die "No Node.js build for $ARCH" ;; esac
  info "Installing Node.js $NODE_MAJOR LTS (official build for linux-$narch) to /usr/local/lib/nodejs..."
  if [ "$DRY" = 1 ]; then
    plan "download https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/node-v${NODE_MAJOR}.*-linux-${narch}.tar.xz, verify SHASUMS256.txt"
    plan "extract to /usr/local/lib/nodejs and link node, npm, npx into /usr/local/bin"
    NODE_BIN=/usr/local/bin/node
    return 0
  fi
  local tmp sums file
  tmp="$(mktemp -d)"
  sums="$(fetch "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt")" || die "Could not reach nodejs.org"
  file="$(printf '%s\n' "$sums" | awk '{print $2}' | grep -E "^node-v${NODE_MAJOR}\.[0-9.]+-linux-${narch}\.tar\.xz$" | head -n1)"
  [ -n "$file" ] || die "No Node.js $NODE_MAJOR build found for linux-$narch"
  fetch -o "$tmp/$file" "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/$file" || die "Node.js download failed"
  (cd "$tmp" && printf '%s\n' "$sums" | grep "  $file\$" | sha256sum -c --quiet -) || die "Node.js checksum mismatch"
  run mkdir -p /usr/local/lib/nodejs
  run tar -xJf "$tmp/$file" -C /usr/local/lib/nodejs
  local d="/usr/local/lib/nodejs/${file%.tar.xz}"
  run ln -sfn "$d/bin/node" /usr/local/bin/node
  run ln -sfn "$d/lib/node_modules/npm/bin/npm-cli.js" /usr/local/bin/npm
  run ln -sfn "$d/lib/node_modules/npm/bin/npx-cli.js" /usr/local/bin/npx
  rm -rf "$tmp"
  hash -r
  NODE_BIN=/usr/local/bin/node
  ok "Node.js $("$NODE_BIN" -v) installed"
}

# ---- Getting Marco ---------------------------------------------------------------------------------------
REL_VERSION=""       # version to install (no "v")
REL_SOURCE=""        # tarball | git
NEED_GIT=0

latest_version() {
  local loc
  loc="$(curl -fsSI --connect-timeout 15 "$RELEASES_URL/latest" 2>/dev/null | tr -d '\r' | sed -n 's/^[Ll]ocation: *//p' | tail -n1 || true)"
  case "$loc" in */tag/v*) printf '%s' "${loc##*/tag/v}" ;; *) printf '' ;; esac
}

choose_source() {
  if [ -n "$SOURCE_DIR" ]; then REL_SOURCE=checkout; return 0; fi
  if [ -n "$TARBALL_URL" ]; then REL_SOURCE=tarball; REL_VERSION="${WANT_VERSION:-custom}"; return 0; fi
  if [ -n "$WANT_VERSION" ]; then
    WANT_VERSION="${WANT_VERSION#v}"
    if curl -fsIL --connect-timeout 15 -o /dev/null "$RELEASES_URL/download/v${WANT_VERSION}/marco-${WANT_VERSION}.tar.gz" 2>/dev/null; then
      REL_SOURCE=tarball; REL_VERSION="$WANT_VERSION"
    else
      REL_SOURCE=git; REL_VERSION="$WANT_VERSION"
    fi
  else
    REL_VERSION="$(latest_version)"
    if [ -n "$REL_VERSION" ]; then REL_SOURCE=tarball
    elif [ "$EXISTING" = release ] && [ "$CUR_GIT" = 0 ]; then
      # An install from a release only ever moves to another release. No answer here usually means GitHub could
      # not be reached (or limited the request), not that releases are gone: building main would be a guess.
      die "Could not reach GitHub to find the latest release ($RELEASES_URL/latest). Nothing was changed. Check the network and try again later, or pick a version with --version <x.y.z>."
    else REL_SOURCE=git; fi
  fi
  # A kiosk only needs a few scripts: from git they are downloaded one by one (no git needed).
  if [ "$REL_SOURCE" = git ] && { [ "$MODE" != kiosk ] || [ "$MARCO_REPO_URL" != "https://github.com/${MARCO_REPO}.git" ]; }; then
    NEED_GIT=1
  fi
}

source_label() {
  case "$REL_SOURCE" in
    tarball) if [ -n "$TARBALL_URL" ]; then echo "tarball $TARBALL_URL"; else echo "release v$REL_VERSION (prebuilt)"; fi ;;
    git)
      if [ "$MODE" = kiosk ]; then echo "kiosk scripts from git (${WANT_VERSION:+v$WANT_VERSION}${WANT_VERSION:-main}; no release published yet)"
      elif [ -n "$WANT_VERSION" ]; then echo "git tag v$WANT_VERSION, built here"
      else echo "latest source from git (no release published yet), built here"; fi ;;
    checkout) echo "local checkout $SOURCE_DIR, built in place" ;;
  esac
}

# True when <version> is older than the installed one and --force was not given.
older_than_installed() {
  [ "$FORCE" = 0 ] && [ -n "$EXISTING_VERSION" ] && [ -n "$1" ] && [ "$1" != custom ] && [ "$1" != "$EXISTING_VERSION" ] || return 1
  [ "$(printf '%s\n%s\n' "$1" "$EXISTING_VERSION" | sort -V | head -n1)" = "$1" ]
}
refuse_older() {
  die "Marco $EXISTING_VERSION is installed and the version found is older ($1). Nothing was changed. To install it anyway, add --force."
}

# The files that end up running as root (the marco command, the stored installer, the systemd units) are copied out of
# the release while it is still private to the installer: once the release folder belongs to the service user, a
# compromised server could change them before root installs them.
TRUSTED=""
keep_trusted() {
  local f
  TRUSTED="$(mktemp -d)"
  for f in deploy/marco deploy/marco.service install.sh; do
    if [ -f "$1/$f" ]; then cp "$1/$f" "$TRUSTED/$(basename "$f")"; fi
  done
}
# trusted <release dir> <file>: the trusted copy of deploy/<file> or install.sh when there is one, else the release's own
trusted() {
  if [ -n "$TRUSTED" ] && [ -f "$TRUSTED/$(basename "$2")" ]; then printf '%s' "$TRUSTED/$(basename "$2")"
  else printf '%s' "$1/$2"; fi
}

# Downloads and prepares a release into $DIR/releases/<id>; sets NEW_REL to its id.
NEW_REL=""
stage_release() {
  local tmp url sha base id
  run mkdir -p "$DIR/releases"
  if [ "$REL_SOURCE" = tarball ]; then
    if [ -n "$TARBALL_URL" ]; then url="$TARBALL_URL"
    else url="$RELEASES_URL/download/v${REL_VERSION}/marco-${REL_VERSION}.tar.gz"
    fi
    sha="$url.sha256"
    info "Downloading $url"
    if [ "$DRY" = 1 ]; then
      plan "download $url and $sha, verify the SHA-256 checksum"
      plan "extract to $DIR/releases/${REL_VERSION}"
      NEW_REL="$REL_VERSION"
      return 0
    fi
    tmp="$(mktemp -d)"
    base="$(basename "${url%%\?*}")"
    fetch -o "$tmp/$base" "$url" || die "Download failed: $url"
    fetch -o "$tmp/$base.sha256" "$sha" || die "Checksum file not found: $sha"
    (cd "$tmp" && awk -v f="$base" '{print $1"  "f}' "$base.sha256" | head -n1 | sha256sum -c --quiet -) \
      || die "Checksum mismatch for $base: the download is damaged or was tampered with."
    ok "Checksum verified"
    mkdir -p "$tmp/x"
    tar -xzf "$tmp/$base" -C "$tmp/x" --strip-components=1 || die "Could not extract $base"
    if [ ! -f "$tmp/x/package.json" ] || [ ! -f "$tmp/x/server/index.js" ] || [ ! -f "$tmp/x/dist/index.html" ]; then
      die "$base is not a Marco release"
    fi
    id="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$tmp/x/package.json" | head -n1)"
    [ -n "$id" ] || die "No version in $base"
    if older_than_installed "$id"; then rm -rf "$tmp"; refuse_older "$id"; fi
    REL_VERSION="$id"
    keep_trusted "$tmp/x"
  else
    if [ "$DRY" = 1 ]; then
      plan "git clone --depth 1 ${WANT_VERSION:+--branch v$WANT_VERSION }$MARCO_REPO_URL"
      plan "(as $RUN_USER) npm ci, npm run build, npm prune --omit=dev"
      NEW_REL="${WANT_VERSION:-git}"
      return 0
    fi
    have git || die "git is needed to build from source (no release published yet). Install it: sudo apt install git"
    tmp="$(mktemp -d)"
    info "No prebuilt release${WANT_VERSION:+ for v$WANT_VERSION}: building from source ($MARCO_REPO_URL)..."
    if [ -n "$WANT_VERSION" ]; then
      git clone -q --depth 1 --branch "v$WANT_VERSION" "$MARCO_REPO_URL" "$tmp/x" || die "Version v$WANT_VERSION not found in $MARCO_REPO_URL"
    else
      git clone -q --depth 1 "$MARCO_REPO_URL" "$tmp/x" || die "Could not clone $MARCO_REPO_URL"
    fi
    id="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$tmp/x/package.json" | head -n1)-git.$(git -C "$tmp/x" rev-parse --short HEAD)"
    REL_VERSION="${id%%-git.*}"
    if older_than_installed "$REL_VERSION"; then rm -rf "$tmp"; refuse_older "$REL_VERSION"; fi
    # Same commit as the running build: nothing to do (--force rebuilds it).
    if [ "$FORCE" = 0 ] && [ "$CUR_GIT" = 1 ]; then
      case "${CUR_REL#releases/}" in
        "$id"|"$id"-[0-9]*)
          rm -rf "$tmp"
          ok "Marco $REL_VERSION is installed and up to date (commit ${id##*-git.})."
          exit 0 ;;
      esac
    fi
    rm -rf "$tmp/x/.git"
    keep_trusted "$tmp/x"
  fi
  if [ -e "$DIR/releases/$id" ]; then
    if [ "$(readlink "$DIR/current" 2>/dev/null)" = "releases/$id" ]; then
      id="$id-$(date +%Y%m%d%H%M%S)"
    else
      run rm -rf "$DIR/releases/$id"
    fi
  fi
  run mv "$tmp/x" "$DIR/releases/$id"
  rm -rf "$tmp"
  run chown -R "$RUN_USER:$(run_group)" "$DIR/releases/$id"
  run chmod 755 "$DIR/releases/$id"
  NEW_REL="$id"
  link_shared "$DIR/releases/$id"
  info "Installing dependencies in releases/$id..."
  if [ "$REL_SOURCE" = git ]; then
    (cd "$DIR/releases/$id" && as_user npm ci --no-audit --no-fund --no-update-notifier --loglevel=error) || die "npm ci failed"
    info "Building the web interface..."
    (cd "$DIR/releases/$id" && as_user npm run build --silent --no-update-notifier) || die "npm run build failed"
    (cd "$DIR/releases/$id" && as_user npm prune --omit=dev --no-audit --no-fund --no-update-notifier --loglevel=error) || warn "npm prune failed (harmless)"
  else
    (cd "$DIR/releases/$id" && as_user npm ci --omit=dev --no-audit --no-fund --no-update-notifier --loglevel=error) || die "npm ci failed"
  fi
  ok "Marco $REL_VERSION ready in $DIR/releases/$id"
}

# Each release sees the shared data folder and .env through symlinks, so relative paths keep working.
link_shared() {
  run ln -sfn ../../data "$1/data"
  run ln -sfn ../../.env "$1/.env"
}

# Points $DIR/current at releases/<id> (atomic rename of a new symlink).
PREV_REL=""
swap_current() {
  PREV_REL="$(readlink "$DIR/current" 2>/dev/null || true)"
  run ln -sfn "releases/$1" "$DIR/.current.new"
  run mv -T "$DIR/.current.new" "$DIR/current"
  run chown -h "$RUN_USER:$(run_group)" "$DIR/current"
}

prune_releases() {
  [ "$DRY" = 0 ] || return 0
  local keep_cur keep_prev d
  keep_cur="$(readlink "$DIR/current" 2>/dev/null || true)"
  keep_prev="$PREV_REL"
  for d in "$DIR"/releases/*; do
    [ -d "$d" ] || continue
    case "releases/$(basename "$d")" in "$keep_cur"|"$keep_prev") continue ;; esac
    run rm -rf "$d"
  done
}

# ---- Server setup ----------------------------------------------------------------------------------------
gen_secret() {
  if have openssl; then openssl rand -hex 32; else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

ENV_FILE=""
setup_env() {
  local example="$1" cur
  ENV_FILE="$DIR/.env"
  if [ -L "$ENV_FILE" ]; then die "$ENV_FILE is a symbolic link. Replace it with the file itself and run the installer again."; fi
  if [ ! -f "$ENV_FILE" ]; then
    info "Creating $ENV_FILE"
    if [ "$DRY" = 1 ]; then
      plan "write $ENV_FILE from .env.example with a random SESSION_SECRET and PORT=${PORT:-3000} (mode 600)"
    else
      { if [ -f "$example" ]; then cat "$example"; else echo "PORT=3000"; echo "SESSION_SECRET=change-me"; fi; } \
        | sed -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(gen_secret)|" -e "s|^PORT=.*|PORT=${PORT:-3000}|" \
        | put_file "$ENV_FILE" 600 "$RUN_USER"
    fi
  else
    if grep -qE '^SESSION_SECRET=(change-me)?$' "$ENV_FILE" 2>/dev/null; then
      run sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(gen_secret)|" "$ENV_FILE"
      ok "Random SESSION_SECRET generated"
    fi
    cur="$(env_get "$ENV_FILE" PORT)"
    if [ -n "$PORT" ] && [ "$PORT" != "${cur:-3000}" ]; then
      if grep -q '^PORT=' "$ENV_FILE"; then run sed -i "s|^PORT=.*|PORT=$PORT|" "$ENV_FILE"
      else run sh -c "echo PORT=$PORT >> $(q "$ENV_FILE")"; fi
      ok "Port set to $PORT"
    fi
  fi
  if [ "$DRY" = 0 ]; then PORT="$(env_get "$ENV_FILE" PORT)"; fi
  PORT="${PORT:-3000}"
}

install_service() {
  local app="$1" tpl="$2"
  info "Installing the systemd service ($SERVICE)..."
  if [ "$DRY" = 1 ]; then
    plan "write /etc/systemd/system/$SERVICE.service (User=$RUN_USER, WorkingDirectory=$app, DATA_DIR=$DIR/data)"
  else
    sed -e "s|@USER@|$RUN_USER|g" -e "s|@GROUP@|$(run_group)|g" -e "s|@APP_DIR@|$app|g" \
        -e "s|@DATA_DIR@|$DIR/data|g" -e "s|@ENV_FILE@|$DIR/.env|g" -e "s|@NODE@|$NODE_BIN|g" "$tpl" \
      | put_file "/etc/systemd/system/$SERVICE.service" 644 root
  fi
  if [ "$SYSTEMD" = 1 ]; then
    run systemctl daemon-reload
    run systemctl enable "$SERVICE" --quiet
  else
    warn "systemd is not running here (container?): the service file is written but not started."
  fi
}

# Updates started from the admin (release installs). The server runs as an unprivileged user and cannot update itself:
# it writes <data>/update/request, marco-update.path sees it and starts marco-update.service, which runs
# `marco update --requested` as root (the same as `sudo marco update`). Nothing in the request is read except that it
# exists, so all the server can ask for is "the latest release". The units are written from here, never from files in
# the install folder (which belongs to the service user).
install_update_units() {
  if [ "$DRY" = 1 ]; then
    plan "write /etc/systemd/system/$UPDATE_UNIT.path (watches $DIR/data/update/request) and $UPDATE_UNIT.service (runs marco update --requested as root)"
    [ "$SYSTEMD" = 0 ] || plan "systemctl enable --now $UPDATE_UNIT.path"
    return 0
  fi
  cat <<EOF | put_file "/etc/systemd/system/$UPDATE_UNIT.path" 644 root
# Written by the Marco installer: updates started from the admin (Status > Updates).
# The Marco server writes $DIR/data/update/request and this unit starts $UPDATE_UNIT.service.
[Unit]
Description=Marco: watch for an update requested from the admin

[Path]
PathExists=$DIR/data/update/request
Unit=$UPDATE_UNIT.service

[Install]
WantedBy=multi-user.target
EOF
  cat <<EOF | put_file "/etc/systemd/system/$UPDATE_UNIT.service" 644 root
# Written by the Marco installer: runs an update requested from the admin, as "sudo marco update" would (download the
# latest release, check its SHA-256, switch to it, roll back if it does not start). Progress: $DIR/data/update/.
[Unit]
Description=Marco: update requested from the admin
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=HOME=/root
ExecStart=$CLI update --requested
TimeoutStartSec=30min
SyslogIdentifier=marco-update
EOF
  if [ "$SYSTEMD" = 1 ]; then
    run systemctl daemon-reload
    run systemctl enable --now "$UPDATE_UNIT.path" --quiet || warn "Could not start $UPDATE_UNIT.path: updates from the admin are off."
  fi
  ok "Updates from the admin: on ($UPDATE_UNIT.path)"
}

remove_update_units() {
  [ -f "/etc/systemd/system/$UPDATE_UNIT.path" ] || [ -f "/etc/systemd/system/$UPDATE_UNIT.service" ] || return 0
  if [ "$SYSTEMD" = 1 ]; then run systemctl disable --now "$UPDATE_UNIT.path" --quiet || true; fi
  run rm -f "/etc/systemd/system/$UPDATE_UNIT.path" "/etc/systemd/system/$UPDATE_UNIT.service"
  if [ "$SYSTEMD" = 1 ]; then run systemctl daemon-reload; fi
}

restart_service() {
  [ "$SYSTEMD" = 1 ] || return 0
  run systemctl restart "$SERVICE"
}

wait_healthy() {
  if [ "$SYSTEMD" = 0 ] || [ "$DRY" = 1 ]; then return 0; fi
  local _
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

install_cli() {
  local src="$1" cli inst
  cli="$(trusted "$src" deploy/marco)"; inst="$(trusted "$src" install.sh)"
  info "Installing the 'marco' command and $CONF"
  [ -f "$cli" ] || [ "$DRY" = 1 ] || { warn "deploy/marco missing in this version: command not installed"; return 0; }
  # Written next to the old file and renamed over it: a running `marco update` keeps reading the copy it started with.
  run install -D -m 755 "$cli" "$CLI.new"
  run mv -f "$CLI.new" "$CLI"
  if [ -f "$inst" ] || [ "$DRY" = 1 ]; then
    run install -D -m 755 "$inst" "$LIBDIR/install.sh.new"
    run mv -f "$LIBDIR/install.sh.new" "$LIBDIR/install.sh"
  fi
  {
    echo "# Written by the Marco installer. Read by /usr/local/bin/marco."
    echo "MARCO_MODE=$MODE"
    echo "MARCO_LAYOUT=$LAYOUT"
    echo "MARCO_DIR=$(printf '%q' "$DIR")"
    echo "MARCO_USER=$(printf '%q' "$RUN_USER")"
    echo "MARCO_NODE=$(printf '%q' "${NODE_BIN:-}")"
    echo "MARCO_REPO=$MARCO_REPO"
    if [ -n "$MARCO_RELEASES_URL" ]; then echo "MARCO_RELEASES_URL=$(printf '%q' "$MARCO_RELEASES_URL")"; fi
    if [ "$MODE" != kiosk ]; then echo "MARCO_POWER=${POWER:-0}"; fi
  } | put_file "$CONF" 644 root
}

# The "Apagar" (Shut down) card of a screen on this device. The server runs with NoNewPrivileges, so it cannot use sudo
# or polkit: it creates /run/marco/poweroff (its RuntimeDirectory, deploy/marco.service; emptied at every boot), and
# marco-power.path starts marco-power.service, which deletes that file and powers off. Nothing in the file is read, so
# all the server can ask for is "power off now". Only written when the owner says so (--power-button, the question of
# an all-in-one install, `sudo marco power on`), and from here, never from files in the install folder.
choose_power() {
  [ -z "$POWER" ] || return 0
  POWER=0
  if [ "$MODE" = all ] && interactive; then
    echo "A screen of this device can have an \"Apagar\" (Shut down) card that powers it off after a second tap." > "$TTY"
    if confirm_no "Allow that card to power off this device?"; then POWER=1; fi
  fi
}

install_power_units() {
  if [ "$DRY" = 1 ]; then
    plan "write /etc/systemd/system/$POWER_UNIT.path (watches /run/marco/poweroff) and $POWER_UNIT.service (runs systemctl poweroff as root)"
    [ "$SYSTEMD" = 0 ] || plan "systemctl enable --now $POWER_UNIT.path"
    return 0
  fi
  cat <<EOF | put_file "/etc/systemd/system/$POWER_UNIT.path" 644 root
# Written by the Marco installer (--power-button, sudo marco power on): the "Apagar" card on a screen of this device.
# The Marco server creates /run/marco/poweroff and this unit starts $POWER_UNIT.service. Turn it off: sudo marco power off
[Unit]
Description=Marco: watch for a power-off asked from a screen

[Path]
PathExists=/run/marco/poweroff
Unit=$POWER_UNIT.service

[Install]
WantedBy=multi-user.target
EOF
  cat <<EOF | put_file "/etc/systemd/system/$POWER_UNIT.service" 644 root
# Written by the Marco installer: powers this device off when the "Apagar" card of a screen asked for it. The request
# file is deleted first and never read.
[Unit]
Description=Marco: power off asked from a screen

[Service]
Type=oneshot
ExecStartPre=/bin/rm -f /run/marco/poweroff
ExecStart=/usr/bin/systemctl --no-block poweroff
SyslogIdentifier=$POWER_UNIT
EOF
  if [ "$SYSTEMD" = 1 ]; then
    run systemctl daemon-reload
    run systemctl enable --now "$POWER_UNIT.path" --quiet || warn "Could not start $POWER_UNIT.path: the Apagar card cannot power off this device."
  fi
  ok "Apagar card: on ($POWER_UNIT.path). Turn it off: sudo marco power off"
}

remove_power_units() {
  [ -f "/etc/systemd/system/$POWER_UNIT.path" ] || [ -f "/etc/systemd/system/$POWER_UNIT.service" ] || return 0
  if [ "$SYSTEMD" = 1 ]; then run systemctl disable --now "$POWER_UNIT.path" --quiet || true; fi
  run rm -f "/etc/systemd/system/$POWER_UNIT.path" "/etc/systemd/system/$POWER_UNIT.service"
  if [ "$SYSTEMD" = 1 ]; then run systemctl daemon-reload; fi
  ok "Apagar card: off"
}

apply_power_units() {
  if [ "$POWER" = 1 ]; then install_power_units; else remove_power_units; fi
}

# MARCO_POWER in /etc/marco.conf, the other lines kept (sudo marco power on|off, an up-to-date install with a flag).
set_conf_power() {
  [ -r "$CONF" ] || return 0
  { grep -v '^MARCO_POWER=' "$CONF" || true; echo "MARCO_POWER=${POWER:-0}"; } | put_file "$CONF" 644 root
}

# sudo marco power on|off: the units and the setting only. Both write to /etc, so not under the read-only overlay.
do_power() {
  [ -r "$CONF" ] || die "Marco is not installed here ($CONF not found)."
  [ "$MODE" != kiosk ] || die "This device only shows a screen: the Apagar card powers off the computer that runs the Marco server. Run this there."
  check_overlay
  apply_power_units
  set_conf_power
  if [ "$POWER" = 1 ] && [ "$SYSTEMD" = 0 ]; then warn "systemd is not running here: the Apagar card cannot power off this device."; fi
  return 0
}

# ---- Kiosk -----------------------------------------------------------------------------------------------
add_line_once() { # file line
  local file="$1" line="$2"
  if [ -f "$file" ] && grep -qF "$MARKER" "$file"; then ok "Autostart already in $file"; return 0; fi
  if [ "$DRY" = 1 ]; then plan "append to $file: $line"; return 0; fi
  as_user mkdir -p "$(dirname "$file")"
  printf '%s\n%s\n' "$MARKER" "$line" | as_user tee -a "$file" >/dev/null
  ok "Autostart added to $file"
}

setup_kiosk() {
  local kiosk_cmd="$1"
  info "Setting up the kiosk (Chromium full screen at login)..."
  local kenv="$RUN_HOME/.config/marco/kiosk.env"
  if [ -n "$KIOSK_URL" ]; then
    if [ "$DRY" = 1 ]; then plan "set KIOSK_URL in $kenv"
    else
      # The file is rewritten (other settings kept), not edited with sed: links contain & and other characters
      # that mean something to sed. check_link() has already refused anything that is special inside "...".
      { if [ -f "$kenv" ]; then as_user cat "$kenv" | grep -v '^KIOSK_URL=' || true; fi
        printf 'KIOSK_URL="%s"\n' "$KIOSK_URL"; } | put_file "$kenv" 600 "$RUN_USER"
      ok "Private link saved in $kenv"
    fi
  fi
  # All in one, no --url, but kiosk.env still holds a link to another server (from an earlier screen-only install)
  if [ "$MODE" = all ] && [ -z "$KIOSK_URL" ] && [ -r "$kenv" ]; then
    local saved
    saved="$(sed -n 's/^KIOSK_URL=//p' "$kenv" | tail -n1 | tr -d "\"'")"
    case "$saved" in
      ""|http://localhost[:/]*|http://localhost|http://127.0.0.1[:/]*|http://127.0.0.1) ;;
      *) warn "$kenv still makes this screen show $(printf '%s' "$saved" | sed -E 's|/d/[^/?#]+|/d/<private link>|')."
         warn "To show the Marco server on this device instead, run the installer again with --url http://localhost:$PORT/" ;;
    esac
  fi
  # labwc (Raspberry Pi OS since late 2024)
  if [ "$DESKTOP" = labwc ] || have labwc; then
    add_line_once "$RUN_HOME/.config/labwc/autostart" "$kiosk_cmd >/tmp/marco-kiosk.log 2>&1 &"
  fi
  # X started from ~/.xinitrc: that file belongs to whoever set it up, so it is not edited here.
  if [ "$DESKTOP" = startx ]; then
    if grep -qE 'marco-kiosk|deploy/kiosk\.sh' "$RUN_HOME/.xinitrc" 2>/dev/null; then
      ok "$RUN_HOME/.xinitrc already starts the Marco kiosk"
    else
      warn "This device starts X from ~/.xinitrc. To open Marco there, make its last line:"
      warn "  exec $kiosk_cmd >/tmp/marco-kiosk.log 2>&1"
    fi
  fi
  # LXDE-pi (X11): the user file replaces the system one, so start from a copy of it.
  local lx="$RUN_HOME/.config/lxsession/LXDE-pi/autostart"
  if [ ! -f "$lx" ] && [ -f /etc/xdg/lxsession/LXDE-pi/autostart ]; then
    if [ "$DRY" = 1 ]; then plan "copy /etc/xdg/lxsession/LXDE-pi/autostart to $lx"
    else as_user mkdir -p "$(dirname "$lx")"; as_user cp /etc/xdg/lxsession/LXDE-pi/autostart "$lx"; fi
  fi
  if [ -f "$lx" ] || [ -f /etc/xdg/lxsession/LXDE-pi/autostart ]; then add_line_once "$lx" "@$kiosk_cmd"; fi
  # wayfire (Raspberry Pi OS Bookworm 2023-2024), only when its config exists
  local wf="$RUN_HOME/.config/wayfire.ini"
  if [ -f "$wf" ] && ! grep -q 'marco_kiosk' "$wf"; then
    if [ "$DRY" = 1 ]; then plan "add 'marco_kiosk = $kiosk_cmd' to [autostart] in $wf"
    elif grep -q '^\[autostart\]' "$wf"; then as_user sed -i "/^\[autostart\]/a marco_kiosk = $kiosk_cmd" "$wf"
    else printf '\n[autostart]\nmarco_kiosk = %s\n' "$kiosk_cmd" | as_user tee -a "$wf" >/dev/null
    fi
    ok "Autostart added to $wf"
  fi
  # Other desktops (GNOME, KDE, XFCE...): XDG autostart
  if [ -z "$PI_MODEL" ] || [ "$DESKTOP" = desktop ]; then
    printf '[Desktop Entry]\nType=Application\nName=Marco kiosk\nExec=%s\nX-GNOME-Autostart-enabled=true\n' "$kiosk_cmd" \
      | put_file "$RUN_HOME/.config/autostart/marco-kiosk.desktop" 644 "$RUN_USER"
  fi
  # A menu entry ("Marco"), to open the kiosk again after the "Salir del kiosko" card closed it, without a keyboard
  printf '[Desktop Entry]\nType=Application\nName=Marco\nComment=Show Marco full screen\nExec=%s\nIcon=video-display\nCategories=Utility;\nTerminal=false\n' "$kiosk_cmd --open" \
    | put_file "$RUN_HOME/.local/share/applications/marco-kiosk.desktop" 644 "$RUN_USER"
  if have raspi-config; then
    info "Turning off screen blanking (raspi-config)..."
    run raspi-config nonint do_blanking 1 || warn "Could not turn off screen blanking"
    if [ -e /etc/lightdm/lightdm.conf ]; then
      run raspi-config nonint do_boot_behaviour B4 || warn "Could not enable desktop auto-login"
    fi
  else
    warn "Enable automatic login to the desktop and turn off screen blanking in your desktop settings."
  fi
}

remove_kiosk() {
  local f
  for f in "$RUN_HOME/.config/labwc/autostart" "$RUN_HOME/.config/lxsession/LXDE-pi/autostart"; do
    if [ ! -f "$f" ] || ! grep -qF "$MARKER" "$f"; then continue; fi
    if [ "$DRY" = 1 ]; then plan "remove the kiosk lines from $f"; continue; fi
    as_user sed -i "/^$MARKER\$/{N;d;}" "$f"
    ok "Kiosk autostart removed from $f"
  done
  f="$RUN_HOME/.config/wayfire.ini"
  if [ -f "$f" ] && grep -q '^marco_kiosk' "$f"; then
    if [ "$DRY" = 1 ]; then plan "remove marco_kiosk from $f"; else as_user sed -i '/^marco_kiosk/d' "$f"; fi
  fi
  for f in "$RUN_HOME/.config/autostart/marco-kiosk.desktop" "$RUN_HOME/.local/share/applications/marco-kiosk.desktop" "$RUN_HOME/.local/bin/marco-kiosk" "$RUN_HOME/.local/bin/marco-schedule"; do
    if [ -e "$f" ]; then run rm -f "$f"; fi
  done
  # The kiosk settings hold the private link: kept unless --purge
  if [ "$PURGE" = 1 ] && [ -d "$RUN_HOME/.config/marco" ]; then run rm -rf "$RUN_HOME/.config/marco"; fi
  return 0
}

# ---- Summary ---------------------------------------------------------------------------------------------
summary() {
  local ip url
  ip="$(lan_ip)"
  echo
  if [ "$DRY" = 1 ]; then ok "Dry run finished: nothing was changed."; echo; return 0; fi
  ok "${C_B}Marco is installed.${C_0}"
  echo
  if [ "$MODE" != kiosk ]; then
    url="http://${ip}:${PORT}/admin/"
    echo "  Admin:    ${C_B}${url}${C_0}"
    echo "  Display:  http://${ip}:${PORT}/"
    show_qr "$url"
    if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/api/setup/status" 2>/dev/null | grep -q '"needsSetup":true'; then
      echo "  Next: open the admin address on a phone or computer on this network (or scan the code) and follow the"
      echo "  setup wizard. It creates the admin password and asks for your location and calendars."
      echo "  From another network the wizard asks for the one-time code in the log: marco logs | grep setup"
    fi
    echo
  fi
  if [ "$MODE" = kiosk ]; then
    local link="$KIOSK_URL"
    if [ -z "$link" ]; then link="$(sed -n 's/^KIOSK_URL=//p' "$RUN_HOME/.config/marco/kiosk.env" 2>/dev/null | tail -n1 | tr -d "\"'")"; fi
    echo "  This screen will show: $(printf '%s' "${link:-the link in ~/.config/marco/kiosk.env}" | sed -E 's|/d/[^/?#]+|/d/<private link>|')"
  fi
  if [ "$MODE" != server ]; then
    echo "  The kiosk starts with the desktop session: reboot to start it (sudo reboot)."
    echo "  Kiosk log: /tmp/marco-kiosk.log, settings: ~/.config/marco/kiosk.env"
  fi
  echo
  echo "  Commands: marco status | marco logs -f | marco restart | marco update | marco url | marco uninstall"
  if [ "$SYSTEMD" = 0 ] && [ "$MODE" != kiosk ]; then
    echo
    echo "  systemd is not running here. Start the server by hand:"
    echo "    cd $DIR/current && sudo -u $RUN_USER env \$(grep -v '^#' $DIR/.env | xargs) DATA_DIR=$DIR/data $NODE_BIN server/index.js"
  fi
}

# ---- Steps -----------------------------------------------------------------------------------------------
do_install_release() {
  local cur_ok=0
  if [ "$MODE" = kiosk ]; then
    do_install_kiosk_only
    return
  fi
  create_user
  # The install folder belongs to the service user, and root works in it: links where folders are expected are refused.
  if [ -L "$DIR/releases" ]; then die "$DIR/releases is a symbolic link: move it away and run the installer again."; fi
  if [ -e "$DIR/current" ] && [ ! -L "$DIR/current" ]; then die "$DIR/current is not a symbolic link: move it away and run the installer again."; fi
  if [ "$DRY" = 1 ]; then plan "mkdir -p $DIR/data $DIR/releases (owner $RUN_USER)"
  else
    run mkdir -p "$DIR/data" "$DIR/releases"
    run chown -h "$RUN_USER:$(run_group)" "$DIR" "$DIR/data" "$DIR/releases"
  fi
  stage_release
  setup_env "$DIR/releases/$NEW_REL/.env.example"
  swap_current "$NEW_REL"
  # The unit that runs now, put back as it is if the new version has to be rolled back.
  local old_unit=""
  if [ "$DRY" = 0 ] && [ -f "/etc/systemd/system/$SERVICE.service" ]; then
    old_unit="$(mktemp)"; cp "/etc/systemd/system/$SERVICE.service" "$old_unit"
  fi
  install_service "$DIR/current" "$(trusted "$DIR/current" deploy/marco.service)"
  # The marco command and the stored installer are replaced only once the new version runs: after a rollback the
  # next `marco update` must not go through files from the release that failed.
  if [ "$SYSTEMD" = 1 ]; then
    info "Starting Marco..."
    restart_service
    if [ "$DRY" = 1 ]; then cur_ok=1
    elif wait_healthy; then cur_ok=1; ok "The server is up (http://127.0.0.1:$PORT/api/health)"; fi
    if [ "$cur_ok" = 0 ] && [ "$DRY" = 0 ]; then
      if [ -n "$PREV_REL" ] && [ "$PREV_REL" != "releases/$NEW_REL" ]; then
        warn "The new version did not start. Rolling back to ${PREV_REL#releases/}..."
        run ln -sfn "$PREV_REL" "$DIR/.current.new"
        run mv -T "$DIR/.current.new" "$DIR/current"
        if [ -n "$old_unit" ]; then
          put_file "/etc/systemd/system/$SERVICE.service" 644 root < "$old_unit"
          run systemctl daemon-reload
        fi
        restart_service
        if wait_healthy; then ok "Rolled back: the previous version is running."; else warn "The previous version does not answer either."; fi
        run rm -rf "$DIR/releases/$NEW_REL"
        die "Update failed. Logs: journalctl -u $SERVICE -n 80 --no-pager"
      fi
      warn "The server is not answering yet. Check: journalctl -u $SERVICE -n 50 --no-pager"
    fi
  fi
  if [ -n "$old_unit" ]; then rm -f "$old_unit"; fi
  install_cli "$DIR/current"
  install_update_units
  apply_power_units
  prune_releases
  if [ -n "$TRUSTED" ]; then rm -rf "$TRUSTED"; TRUSTED=""; fi
  if [ "$MODE" = all ]; then
    run chmod +x "$DIR/current/deploy/kiosk.sh" "$DIR/current/deploy/screen-schedule.sh"
    setup_kiosk "$DIR/current/deploy/kiosk.sh"
  fi
}

do_install_kiosk_only() {
  stage_kiosk_scripts
  install_cli "$KIOSK_SRC"
  setup_kiosk "$RUN_HOME/.local/bin/marco-kiosk"
  if [ -n "$KIOSK_TMP" ]; then rm -rf "$KIOSK_TMP"; fi
}

# Kiosk-only: copy the kiosk scripts out of a release (or the git source); no server is installed.
KIOSK_SRC=""; KIOSK_TMP=""
stage_kiosk_scripts() {
  if [ "$DRY" = 1 ]; then
    plan "get deploy/kiosk.sh and deploy/screen-schedule.sh from $(source_label)"
    plan "(as $RUN_USER) install them as $RUN_HOME/.local/bin/marco-kiosk and marco-schedule"
    KIOSK_SRC="download"
    return 0
  fi
  KIOSK_TMP="$(mktemp -d)"
  if [ "$REL_SOURCE" = checkout ]; then KIOSK_SRC="$SOURCE_DIR"
  elif [ "$REL_SOURCE" = tarball ]; then
    local url="${TARBALL_URL:-$RELEASES_URL/download/v${REL_VERSION}/marco-${REL_VERSION}.tar.gz}" base
    base="$(basename "${url%%\?*}")"
    fetch -o "$KIOSK_TMP/$base" "$url" || die "Download failed: $url"
    fetch -o "$KIOSK_TMP/$base.sha256" "$url.sha256" || die "Checksum file not found: $url.sha256"
    (cd "$KIOSK_TMP" && awk -v f="$base" '{print $1"  "f}' "$base.sha256" | head -n1 | sha256sum -c --quiet -) || die "Checksum mismatch for $base"
    mkdir -p "$KIOSK_TMP/x"
    tar -xzf "$KIOSK_TMP/$base" -C "$KIOSK_TMP/x" --strip-components=1
    KIOSK_SRC="$KIOSK_TMP/x"
  elif [ "$NEED_GIT" = 1 ]; then
    have git || die "git is needed: sudo apt install git"
    git clone -q --depth 1 ${WANT_VERSION:+--branch "v$WANT_VERSION"} "$MARCO_REPO_URL" "$KIOSK_TMP/x" || die "Could not clone $MARCO_REPO_URL"
    KIOSK_SRC="$KIOSK_TMP/x"
  else
    local ref="main" f
    if [ -n "$WANT_VERSION" ]; then ref="v$WANT_VERSION"; fi
    mkdir -p "$KIOSK_TMP/x/deploy"
    for f in deploy/kiosk.sh deploy/screen-schedule.sh deploy/marco install.sh; do
      fetch -o "$KIOSK_TMP/x/$f" "https://raw.githubusercontent.com/${MARCO_REPO}/${ref}/$f" \
        || { [ "$f" = deploy/marco ] || die "Download failed: $f"; }
    done
    KIOSK_SRC="$KIOSK_TMP/x"
  fi
  # Copied as root (KIOSK_TMP is private to whoever runs the installer, which may not be the desktop user),
  # then given to the desktop user. The folder itself is created as that user so ~/.local stays theirs.
  as_user mkdir -p "$RUN_HOME/.local/bin"
  run install -o "$RUN_USER" -g "$(run_group)" -m 755 "$KIOSK_SRC/deploy/kiosk.sh" "$RUN_HOME/.local/bin/marco-kiosk"
  run install -o "$RUN_USER" -g "$(run_group)" -m 755 "$KIOSK_SRC/deploy/screen-schedule.sh" "$RUN_HOME/.local/bin/marco-schedule"
  ok "Kiosk scripts installed in $RUN_HOME/.local/bin"
}

# A git checkout used in place (deploy/install.sh, and installs made with it before the one-line installer).
do_install_checkout() {
  local app="${SOURCE_DIR:-$DIR}"
  DIR="$app"
  if [ "$MODE" = kiosk ]; then do_install_kiosk_only; return; fi
  if [ -z "$SOURCE_DIR" ] && [ -d "$app/.git" ]; then
    info "Updating the checkout in $app (git pull)..."
    as_user git -C "$app" pull --ff-only || die "git pull failed in $app (local changes?)"
  fi
  if [ "$DRY" = 0 ] && [ "$(stat -c %U "$app")" != "$RUN_USER" ]; then
    info "Giving $RUN_USER ownership of $app..."
    run chown -R "$RUN_USER:$(run_group)" "$app"
  fi
  info "Installing dependencies and building (npm ci, npm run build)..."
  (cd "$app" && as_user npm ci --no-audit --no-fund --no-update-notifier --loglevel=error) || die "npm ci failed"
  (cd "$app" && as_user npm run build --silent --no-update-notifier) || die "npm run build failed"
  as_user mkdir -p "$app/data"
  setup_env "$app/.env.example"
  install_service "$app" "$app/deploy/marco.service"
  install_cli "$app"
  # A checkout is updated with git pull, by its owner: no updates from the admin.
  remove_update_units
  apply_power_units
  if [ "$SYSTEMD" = 1 ]; then
    restart_service
    if wait_healthy; then ok "The server is up"; else warn "The server is not answering yet. Check: journalctl -u $SERVICE -n 50 --no-pager"; fi
  fi
  if [ "$MODE" = all ]; then
    run chmod +x "$app/deploy/kiosk.sh" "$app/deploy/screen-schedule.sh"
    setup_kiosk "$app/deploy/kiosk.sh"
  fi
}

# Data left by an earlier uninstall without --purge (the folder holds Marco's data or settings, nothing else of it).
LEFTOVER=0
leftover_data() {
  [ -n "$DIR" ] && [ -d "$DIR" ] || return 1
  [ -f "$DIR/data/config.json" ] || [ -f "$DIR/data/secrets.json" ] || grep -qs '^SESSION_SECRET=' "$DIR/.env"
}

do_uninstall() {
  info "Uninstalling Marco ($MODE, $DIR)"
  if [ "$LEFTOVER" = 1 ]; then info "Only data and settings are left in $DIR (from an earlier uninstall): deleting them."; fi
  if [ -f "/etc/systemd/system/$SERVICE.service" ]; then
    if [ "$SYSTEMD" = 1 ]; then
      run systemctl disable --now "$SERVICE" --quiet || true
    fi
    run rm -f "/etc/systemd/system/$SERVICE.service"
    if [ "$SYSTEMD" = 1 ]; then run systemctl daemon-reload; fi
    ok "Service removed"
  fi
  remove_update_units
  remove_power_units
  remove_kiosk
  if [ "$LAYOUT" = release ] && [ "$MODE" != kiosk ]; then
    if [ -L "$DIR/current" ]; then run rm -f "$DIR/current"; fi
    if [ -d "$DIR/releases" ]; then run rm -rf "$DIR/releases"; fi
    if [ "$PURGE" = 1 ]; then
      run rm -rf "$DIR/data" "$DIR/.env" "$DIR/.npm"
      run rmdir "$DIR" 2>/dev/null || true
      ok "Program and data removed"
    else
      ok "Program removed. Your data is kept in $DIR/data (and settings in $DIR/.env)."
      echo "     To delete them later: curl -fsSL https://marcohome.app/install | bash -s -- --uninstall --purge --dir $(q "$DIR")"
    fi
  elif [ "$LAYOUT" = checkout ]; then
    if [ "$PURGE" = 1 ]; then
      run rm -rf "$DIR/data" "$DIR/.env"
      ok "Data and settings removed ($DIR/data, $DIR/.env)."
    fi
    ok "The code in $DIR is left as it is (a git checkout: delete the folder yourself if you do not need it)."
  fi
  run rm -f "$CLI" "$CONF"
  run rm -rf "$LIBDIR"
  # The system user the installer created (no login shell, home = install folder)
  if [ "$PURGE" = 1 ] && [ "$RUN_USER" = marco ] && [ "$(getent passwd marco | cut -d: -f6,7)" = "$DIR:/usr/sbin/nologin" ]; then
    run userdel marco || true
  fi
  ok "Marco has been uninstalled."
}

# ---- Main ------------------------------------------------------------------------------------------------
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --mode) MODE="${2:-}"; shift ;;
      --mode=*) MODE="${1#*=}" ;;
      --url) KIOSK_URL="${2:-}"; shift ;;
      --url=*) KIOSK_URL="${1#*=}" ;;
      --port) PORT="${2:-}"; shift ;;
      --port=*) PORT="${1#*=}" ;;
      --dir) DIR="${2:-}"; shift ;;
      --dir=*) DIR="${1#*=}" ;;
      --user) RUN_USER="${2:-}"; shift ;;
      --user=*) RUN_USER="${1#*=}" ;;
      --version) WANT_VERSION="${2:-}"; shift ;;
      --version=*) WANT_VERSION="${1#*=}" ;;
      --yes|-y) YES=1 ;;
      --dry-run) DRY=1 ;;
      --update) ACTION=update ;;
      --uninstall) ACTION=uninstall ;;
      --purge) PURGE=1 ;;
      --skip-apt) SKIP_APT=1 ;;
      --power-button) POWER=1; POWER_FLAG=1 ;;
      --no-power-button) POWER=0; POWER_FLAG=1 ;;
      --power-units)
        ACTION=power
        case "${2:-}" in on) POWER=1 ;; off) POWER=0 ;; *) die "--power-units must be on or off" ;; esac
        POWER_FLAG=1; shift ;;
      --force) FORCE=1 ;;
      --source) SOURCE_DIR="${2:-}"; shift ;;
      --source=*) SOURCE_DIR="${1#*=}" ;;
      --tarball-url) TARBALL_URL="${2:-}"; shift ;;
      --tarball-url=*) TARBALL_URL="${1#*=}" ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1 (see --help)" ;;
    esac
    shift
  done
  case "$MODE" in ""|all|server|kiosk) ;; *) die "--mode must be all, server or kiosk" ;; esac
  if [ -n "$KIOSK_URL" ]; then check_link "$KIOSK_URL"; fi
  case "$PORT" in ""|[0-9]|[0-9][0-9]|[0-9][0-9][0-9]|[0-9][0-9][0-9][0-9]|[0-9][0-9][0-9][0-9][0-9]) ;; *) die "--port must be a number" ;; esac
  if [ -n "$SOURCE_DIR" ]; then
    SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)" || die "--source: folder not found"
    [ -f "$SOURCE_DIR/package.json" ] || die "--source: $SOURCE_DIR is not a Marco checkout"
    DIR="$SOURCE_DIR"
  fi
}

choose_mode() {
  [ -z "$MODE" ] || return 0
  local def=server
  if [ -n "$DESKTOP" ]; then def=all; fi
  if ! interactive; then MODE="$def"; return 0; fi
  {
    echo
    echo "What should this device do?"
    echo "  1) Server only: other screens and browsers connect to it"
    echo "  2) All in one: the server and the screen on this device"
    echo "  3) Screen only (kiosk): show a Marco server that runs on another machine"
  } > "$TTY"
  local n=1; [ "$def" = all ] && n=2
  while :; do
    ask "Choose 1, 2 or 3 [$n]: " "$n"
    case "$REPLY" in 1) MODE=server; break ;; 2) MODE=all; break ;; 3) MODE=kiosk; break ;; esac
  done
}

main() {
  parse_args "$@"
  printf '\n%sMarco installer%s\n\n' "$C_B" "$C_0"
  load_existing
  detect
  if [ "$ACTION" = uninstall ]; then
    MODE="${MODE:-server}"
    resolve_user
    # After a plain uninstall only <dir>/data and <dir>/.env are left: --purge still has to be able to delete them.
    if [ -z "$EXISTING" ] && [ ! -L "$DIR/current" ] && [ ! -f "/etc/systemd/system/$SERVICE.service" ]; then
      if [ "$PURGE" = 1 ] && leftover_data; then LEFTOVER=1
      else die "No Marco install found${DIR:+ in $DIR}."; fi
    fi
    inspect_dir
    local what="Remove Marco from this device (your data is kept)?"
    if [ "$PURGE" = 1 ]; then what="Remove Marco and ALL its data in $DIR (config, photos, backups)? This cannot be undone."; fi
    if [ "$YES" = 0 ] && [ "$DRY" = 0 ]; then
      if [ -z "$TTY" ]; then
        die "No terminal to confirm in. To go ahead anyway, add --yes$([ "$PURGE" = 1 ] && echo " (this deletes the data folder)")."
      fi
      confirm_no "$what" || { echo "Nothing was changed."; exit 0; }
    fi
    do_uninstall
    return 0
  fi
  if [ "$ACTION" = power ]; then
    MODE="${MODE:-server}"
    resolve_user
    do_power
    return 0
  fi
  check_os
  if [ -n "$EXISTING" ] && [ -z "$MODE" ]; then MODE=server; fi
  choose_mode
  resolve_user
  detect_desktop
  inspect_dir
  if [ "$MODE" != kiosk ]; then choose_power; fi
  if [ "$MODE" = kiosk ] && [ -z "$KIOSK_URL" ]; then
    if [ -r "$RUN_HOME/.config/marco/kiosk.env" ] && grep -q '^KIOSK_URL=' "$RUN_HOME/.config/marco/kiosk.env"; then
      SAVED_LINK=1
    elif interactive; then
      echo "Paste the screen's private link (Admin > Screen > Settings > Private link), e.g. http://homeserver.lan:3000/d/..." > "$TTY"
      ask "Link: " ""
      KIOSK_URL="$REPLY"
      check_link "$KIOSK_URL"
    else
      die "--mode kiosk needs --url <private display link> (Admin > Screen > Settings > Private link)."
    fi
  fi
  ensure_curl
  choose_source

  echo "  System:   ${OS_NAME:-unknown} ($ARCH)"
  if [ -n "$PI_MODEL" ]; then echo "  Device:   $PI_MODEL"; fi
  echo "  Desktop:  $(desktop_label)"
  echo "  Overlay:  $([ "$OVERLAY" = 1 ] && echo "read-only overlay is ON" || echo off)"
  echo "  Mode:     $MODE"
  echo "  Folder:   $DIR$([ "$MODE" = kiosk ] && echo " (not used: the kiosk scripts go to ~/.local/bin)")"
  echo "  User:     $RUN_USER$([ "${NEW_USER:-0}" = 1 ] && echo " (will be created)")"
  if [ -n "$EXISTING" ]; then echo "  Found:    an existing install ($EXISTING${EXISTING_VERSION:+, version $EXISTING_VERSION})"; fi
  echo "  Source:   $(source_label)"
  if [ "${SAVED_LINK:-0}" = 1 ]; then echo "  Link:     the one saved in $RUN_HOME/.config/marco/kiosk.env"; fi
  if [ -n "$KIOSK_URL" ]; then echo "  Link:     $(printf '%s' "$KIOSK_URL" | sed -E 's|/d/[^/?#]+|/d/<private link>|')"; fi
  if [ "$MODE" != kiosk ]; then echo "  Apagar:   $([ "$POWER" = 1 ] && echo "the Shut down card may power off this device" || echo "off (turn on later: sudo marco power on)")"; fi
  if [ "$DRY" = 1 ]; then echo "  Dry run:  nothing will be changed"; fi
  echo

  check_overlay
  if [ "$MODE" != server ] && [ -z "$DESKTOP" ]; then
    warn "No desktop session found. The kiosk needs Raspberry Pi OS with desktop (or another desktop) and auto-login."
  fi
  if [ "$EXISTING" = release ] && [ "$REL_SOURCE" = tarball ] && [ -z "$TARBALL_URL" ] \
     && [ "$EXISTING_VERSION" = "$REL_VERSION" ] && [ "$CUR_GIT" = 0 ] && [ "$FORCE" = 0 ]; then
    ok "Marco $EXISTING_VERSION is installed and up to date."
    # Installs updated by an installer older than the admin's update button get its units here.
    if [ "$MODE" != kiosk ] && [ ! -f "/etc/systemd/system/$UPDATE_UNIT.path" ] && { [ "$(id -u)" -eq 0 ] || sudo -n true 2>/dev/null; }; then
      install_update_units
    fi
    # --power-button / --no-power-button on an install that is up to date: only that changes
    if [ "$MODE" != kiosk ] && [ "$POWER_FLAG" = 1 ] && { [ "$DRY" = 1 ] || [ "$(id -u)" -eq 0 ] || sudo -n true 2>/dev/null; }; then
      apply_power_units
      set_conf_power
    fi
    [ "$DRY" = 1 ] || exit 0
  fi
  if [ "$EXISTING" = release ] && [ "$REL_SOURCE" = tarball ] && [ -z "$TARBALL_URL" ] && older_than_installed "$REL_VERSION"; then
    refuse_older "$REL_VERSION"
  fi
  if [ -n "$EXISTING" ] && [ "$ACTION" != update ] && interactive; then
    confirm "Marco is already installed in $DIR. Update it?" || exit 0
  elif interactive; then
    confirm "Continue?" || exit 0
  fi

  # `sudo -v` asks for a password whenever any sudoers rule for the user needs one (verifypw=all), even when a
  # NOPASSWD rule covers every command, as on Raspberry Pi OS: try without a password first.
  if [ "$DRY" = 0 ] && [ -n "$SUDO" ]; then
    sudo -n true 2>/dev/null || sudo -v || die "sudo failed (with no terminal, sudo must work without a password)"
  fi
  install_packages
  if [ "$MODE" != kiosk ]; then ensure_node; fi
  if [ "$LAYOUT" = checkout ] || [ "$REL_SOURCE" = checkout ]; then
    LAYOUT=checkout
    do_install_checkout
  else
    do_install_release
  fi
  summary
}

main "$@"
