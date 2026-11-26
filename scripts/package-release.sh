#!/usr/bin/env bash
# Builds the release tarball that install.sh downloads: marco-<version>.tar.gz and marco-<version>.tar.gz.sha256
# (run `npm ci && npm run build` first). Output folder: release/ (or the first argument).
# Also copies install.sh with install.sh.sha256, so people can check the installer before they run it.
#
# Contents: the server, the built web interface (dist/), package.json + package-lock.json (the installer runs
# `npm ci --omit=dev`), deploy/ scripts, install.sh and the docs needed to run it.
# No node_modules and no web sources.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/release}"
VERSION="$(node -p "require('$ROOT/package.json').version")"
NAME="marco-$VERSION"

if [ ! -f "$ROOT/dist/index.html" ] || [ ! -f "$ROOT/dist/admin/index.html" ]; then
  echo "dist/ is missing: run npm run build first" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$NAME"
cd "$ROOT"
cp -R server dist deploy "$STAGE/$NAME/"
cp package.json package-lock.json install.sh .env.example LICENSE README.md CHANGELOG.md THIRD_PARTY_NOTICES.md "$STAGE/$NAME/"
# the guides the README links to (text only: the screenshots stay on GitHub)
mkdir -p "$STAGE/$NAME/docs" && cp docs/*.md "$STAGE/$NAME/docs/"
rm -rf "$STAGE/$NAME/server/test"
chmod 755 "$STAGE/$NAME/install.sh" "$STAGE/$NAME/deploy/"*.sh "$STAGE/$NAME/deploy/marco"

mkdir -p "$OUT"
# Reproducible-ish archive: fixed owner and sorted names.
tar --sort=name --owner=0 --group=0 --numeric-owner -C "$STAGE" -czf "$OUT/$NAME.tar.gz" "$NAME"
(cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
cp install.sh "$OUT/install.sh"
(cd "$OUT" && sha256sum install.sh > install.sh.sha256)
echo "$OUT/$NAME.tar.gz"
cat "$OUT/$NAME.tar.gz.sha256" "$OUT/install.sh.sha256"
