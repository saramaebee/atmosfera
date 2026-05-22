#!/usr/bin/env bash
# atmosfera-web install script — run on the same VM as the bot, after the
# main `install.sh`. Sets up the moderation web app as a second systemd unit
# sharing the same SQLite database via WAL.
#
# Idempotent: safe to re-run.

set -euo pipefail

INSTALL_DIR=${INSTALL_DIR:-$HOME/atmosfera}
SERVICE_NAME=atmosfera-web
DEPLOY_USER=${DEPLOY_USER:-$USER}
WEB_PORT=${WEB_PORT:-3000}

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

echo "==> Writing systemd unit /etc/systemd/system/${SERVICE_NAME}.service"
sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=atmosfera moderation web app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$DEPLOY_USER
WorkingDirectory=$INSTALL_DIR
# Use systemd's EnvironmentFile (NOT bun --env-file) so dollar signs in
# secrets don't get re-interpreted as shell variables.
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$BUN apps/web/src/index.ts
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "==> Granting passwordless restart-only sudo to $DEPLOY_USER (for CI/CD)"
sudo tee /etc/sudoers.d/${SERVICE_NAME} > /dev/null <<EOF
$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart ${SERVICE_NAME}
$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/systemctl status ${SERVICE_NAME}
$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/systemctl stop ${SERVICE_NAME}
EOF
sudo chmod 0440 /etc/sudoers.d/${SERVICE_NAME}

echo "==> Enabling service"
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}

cat <<EOF

==> atmosfera-web install complete.

Next steps:
  1. Make sure these are set in $INSTALL_DIR/.env :
       DISCORD_CLIENT_SECRET
       DISCORD_OAUTH_REDIRECT_URI  (e.g. https://yourdomain/auth/discord/callback)
       SESSION_SECRET              (openssl rand -hex 32)
       WEB_PUBLIC_URL              (the URL users will hit)
       WEB_PORT=$WEB_PORT          (optional; defaults to 3000)
     And register the redirect URI in the Discord developer portal.

  2. sudo systemctl start ${SERVICE_NAME}
  3. journalctl -u ${SERVICE_NAME} -f

The web app listens on localhost:${WEB_PORT}. Put it behind Caddy / nginx
for HTTPS on a real domain.
EOF
