#!/usr/bin/env bash
# Installs Marco from this git checkout, in place (kept for installs made with `git clone`).
# New installs: use the one-line installer instead (prebuilt releases, `marco` command, updates with rollback):
#   curl -fsSL https://marcohome.app/install | bash
#
# Usage (run it again after every `git pull`):
#   ./deploy/install.sh                          # server + kiosk on this machine (all-in-one Pi)
#   ./deploy/install.sh --no-kiosk               # server only (home server / NAS / any Debian box)
#   ./deploy/install.sh --kiosk-only --url http://<server>:3000/d/<key>   # kiosk only: this Pi shows a remote server
#                                       # (the screen's private link: Admin > Screen > Settings > Private link)
#   ./deploy/install.sh --url "http://localhost:3000/d/<key>"           # all-in-one, but show another screen
#   ./deploy/install.sh --user pi                # user that runs the service and the desktop session
#   ./deploy/install.sh --skip-apt               # do not install system packages
#   ./deploy/install.sh --power-button           # the "Apagar" card on a screen of this device may power it off
#   ./deploy/install.sh --dry-run                # print the actions, change nothing
#
# This is a thin wrapper around ../install.sh (the same installer as the one-liner) with --source <this checkout>.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
MODE=all
ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --no-kiosk) MODE=server ;;
    --kiosk-only) MODE=kiosk ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done

exec bash "$APP_DIR/install.sh" --source "$APP_DIR" --mode "$MODE" --yes "${ARGS[@]}"
