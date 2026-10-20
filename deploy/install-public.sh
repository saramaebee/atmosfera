#!/usr/bin/env bash
# atmosfera-public install script: run on the same VM as the bot, after the
# main `install.sh`. Sets up the public weather app (apps/public) as its own
# systemd unit, plus a monthly timer that refreshes the DB-IP database.
#
# Idempotent: safe to re-run.

set -euo pipefail

INSTALL_DIR=${INSTALL_DIR:-$HOME/atmosfera}
SERVICE_NAME=atmosfera-public
TIMER_NAME=atmosfera-dbip
DEPLOY_USER=${DEPLOY_USER:-$USER}
PUBLIC_PORT=${PUBLIC_PORT:-3002}

if [ "$DEPLOY_USER" != "$USER" ]; then
  echo "ERROR: DEPLOY_USER=$DEPLOY_USER but you're running as $USER. Re-run as $DEPLOY_USER." >&2
  exit 1
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "ERROR: $INSTALL_DIR is not a git checkout. Run deploy/install.sh first." >&2
  exit 1
fi

BUN="$HOME/.bun/bin/bun"
if [ ! -x "$BUN" ]; then
  echo "ERROR: bun not found at $BUN. Run deploy/install.sh first." >&2
  exit 1
fi

# Must exist before the unit starts: ReadWritePaths= on a missing path fails it.
mkdir -p "$INSTALL_DIR/.cache"

echo "==> Writing systemd unit /etc/systemd/system/${SERVICE_NAME}.service"
sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<UNIT
[Unit]
Description=atmosfera public weather app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$DEPLOY_USER
WorkingDirectory=$INSTALL_DIR
# Use systemd's EnvironmentFile (NOT bun --env-file) so dollar signs in
# secrets don't get re-interpreted as shell variables.
EnvironmentFile=$INSTALL_DIR/.env
# The filesystem is read-only below, so skip Bun's on-disk transpiler cache.
Environment=BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ExecStart=$BUN apps/public/src/index.ts
# SIGHUP re-reads the DB-IP file (deploy/refresh-dbip.sh).
ExecReload=/bin/kill -HUP \$MAINPID
Restart=on-failure
RestartSec=10
# The app writes only one startup line; journald keeps it.
StandardOutput=journal
StandardError=journal
NoNewPrivileges=yes
PrivateTmp=yes
# strict makes everything (including /home) read-only; the climate and tile
# caches under .cache are the only writable path. No ProtectHome: the repo
# lives in the deploy user's home.
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR/.cache

[Install]
WantedBy=multi-user.target
UNIT

echo "==> Writing monthly DB-IP refresh timer ${TIMER_NAME}.timer"
sudo tee /etc/systemd/system/${TIMER_NAME}.service > /dev/null <<UNIT
[Unit]
Description=Refresh the DB-IP City Lite database for atmosfera-public
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$DEPLOY_USER
Environment=INSTALL_DIR=$INSTALL_DIR
EnvironmentFile=-$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/deploy/refresh-dbip.sh
UNIT

# The 3rd, not the 1st: DB-IP publishes the new month's file early in the
# month, not at midnight UTC on the 1st.
sudo tee /etc/systemd/system/${TIMER_NAME}.timer > /dev/null <<UNIT
[Unit]
Description=Monthly DB-IP refresh for atmosfera-public

[Timer]
OnCalendar=*-*-03 04:00:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
UNIT

echo "==> Granting passwordless restart/reload-only sudo to $DEPLOY_USER (for CI/CD)"
sudo tee /etc/sudoers.d/${SERVICE_NAME} > /dev/null <<SUDO
$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart ${SERVICE_NAME}
$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/systemctl reload ${SERVICE_NAME}
$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/systemctl status ${SERVICE_NAME}
$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/systemctl stop ${SERVICE_NAME}
SUDO
sudo chmod 0440 /etc/sudoers.d/${SERVICE_NAME}

echo "==> Downloading the DB-IP database (first run)"
INSTALL_DIR=$INSTALL_DIR "$INSTALL_DIR/deploy/refresh-dbip.sh"

echo "==> Enabling service and timer"
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}
sudo systemctl enable --now ${TIMER_NAME}.timer

cat <<EOF

==> atmosfera-public install complete.

Next steps:
  1. Optional in $INSTALL_DIR/.env :
       PUBLIC_PORT=$PUBLIC_PORT     (defaults to 3002)
       DBIP_MMDB_PATH             (defaults to .cache/dbip/dbip-city-lite.mmdb)
  2. sudo systemctl start ${SERVICE_NAME}
  3. journalctl -u ${SERVICE_NAME} -f   (expect exactly one line)

It listens on 127.0.0.1:${PUBLIC_PORT}. In the saratonin.dev Caddy site block:

  handle_path /weather/* {
    reverse_proxy 127.0.0.1:${PUBLIC_PORT} {
      header_up X-Real-IP {remote_host}
    }
  }
EOF
