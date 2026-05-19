#!/usr/bin/env bash
# atmosfera install script — run ONCE on a fresh Debian/Ubuntu VM.
# Idempotent: safe to re-run.
#
# Installs Bun under the current user, clones the repo to ~/atmosfera,
# sets up a systemd service running as the current user, and grants the
# current user passwordless `systemctl restart atmosfera` for CI/CD.
#
#   curl -fsSL https://raw.githubusercontent.com/saramaebee/atmosfera/main/deploy/install.sh | bash

set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/saramaebee/atmosfera.git}
INSTALL_DIR=${INSTALL_DIR:-$HOME/atmosfera}
SERVICE_NAME=atmosfera
DEPLOY_USER=${DEPLOY_USER:-$USER}

if [ "$DEPLOY_USER" != "$USER" ]; then
  echo "ERROR: DEPLOY_USER=$DEPLOY_USER but you're running as $USER. Re-run as $DEPLOY_USER." >&2
  exit 1
fi

echo "==> Installing system deps"
sudo apt-get update -qq
# fonts-dejavu-core + fontconfig: resvg falls back to system fonts when
# rasterizing the chart SVGs. Without a real sans-serif on disk, every <text>
# element silently drops and charts render with no labels.
sudo apt-get install -y -qq curl git unzip ca-certificates fonts-dejavu-core fontconfig

echo "==> Installing Bun (per-user at ~/.bun)"
if [ ! -x "$HOME/.bun/bin/bun" ]; then
  curl -fsSL https://bun.sh/install | bash
fi
BUN="$HOME/.bun/bin/bun"
echo "    $($BUN --version)"

echo "==> Cloning/updating repo at $INSTALL_DIR"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
git fetch origin main
git reset --hard origin/main

echo "==> Installing app deps"
"$BUN" install --production

echo "==> Writing systemd unit /etc/systemd/system/${SERVICE_NAME}.service"
sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=atmosfera Discord bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$DEPLOY_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$BUN apps/discord-bot/src/index.ts
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

echo "==> Enabling service (will start at next boot)"
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}

cat <<EOF

==> Install complete!

Next steps:
  1. cp $INSTALL_DIR/.env.example $INSTALL_DIR/.env
  2. edit $INSTALL_DIR/.env with DISCORD_TOKEN, DISCORD_CLIENT_ID, optional GEMINI_API_KEY
  3. sudo systemctl start ${SERVICE_NAME}
  4. journalctl -u ${SERVICE_NAME} -f   # watch the logs

For GitHub Actions auto-deploy, follow the "CI/CD" section of DEPLOY.md.
EOF
