#!/usr/bin/env bash
# Download this month's DB-IP "IP to City Lite" database for apps/public,
# swap it in atomically, and tell atmosfera-public to reload it (SIGHUP).
# Run monthly by the atmosfera-dbip.timer that install-public.sh installs.
#
# DB-IP Lite is CC BY 4.0: the site must show "IP Geolocation by DB-IP"
# linking to https://db-ip.com.

set -euo pipefail

INSTALL_DIR=${INSTALL_DIR:-$HOME/atmosfera}
cd "$INSTALL_DIR"
DEST=${DBIP_MMDB_PATH:-.cache/dbip/dbip-city-lite.mmdb}
URL="https://download.db-ip.com/free/dbip-city-lite-$(date -u +%Y-%m).mmdb.gz"

mkdir -p "$(dirname "$DEST")"
# Same directory as DEST so the final mv is an atomic rename.
TMP=$(mktemp "$DEST.XXXXXX")
trap 'rm -f "$TMP"' EXIT

curl -fsSL --max-time 900 "$URL" | gunzip > "$TMP"

SIZE=$(wc -c < "$TMP")
if [ "$SIZE" -lt 10000000 ]; then
  echo "ERROR: $URL decompressed to only $SIZE bytes; keeping the current file." >&2
  exit 1
fi
# Every mmdb ends with a metadata section introduced by this marker.
if ! tail -c 131072 "$TMP" | grep -q 'MaxMind.com'; then
  echo "ERROR: $URL is not an mmdb file; keeping the current file." >&2
  exit 1
fi

chmod 0644 "$TMP"
mv -f "$TMP" "$DEST"
echo "==> Installed $DEST ($SIZE bytes)"

if systemctl is-active --quiet atmosfera-public; then
  sudo /bin/systemctl reload atmosfera-public
fi
