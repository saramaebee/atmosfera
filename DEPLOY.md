# Deploying atmosfera to GCE

Target: a Debian/Ubuntu GCE VM you already SSH into normally (e.g. via `gcloud compute ssh`). The bot runs as a systemd service under your user account, with passwordless `systemctl restart` scoped to that one service so GitHub Actions can deploy on push.

The bot is outbound-only (it opens a Discord gateway WebSocket); no firewall changes needed.

## 1. Stop the old Screeps server

SSH in. Identify and stop its service:

```bash
systemctl --type=service --state=running   # find the screeps unit
sudo systemctl stop <screeps-unit-name>
sudo systemctl disable <screeps-unit-name>
```

If you want to keep its data, snapshot the disk first via the GCP console.

## 2. One-shot install

Still on the VM, as your normal user:

```bash
curl -fsSL https://raw.githubusercontent.com/saramaebee/atmosfera/main/deploy/install.sh | bash
```

What it does:

- Installs `curl`, `git`, `unzip` via apt
- Installs Bun at `~/.bun/bin/bun`
- Clones the repo to `~/atmosfera`
- Runs `bun install --production`
- Writes `/etc/systemd/system/atmosfera.service` (running as your user)
- Writes `/etc/sudoers.d/atmosfera` granting passwordless restart-only sudo
- `systemctl enable` (so it autostarts on boot)

It does NOT start the service yet — you need to drop `.env` first.

## 3. Configure secrets

```bash
cp ~/atmosfera/.env.example ~/atmosfera/.env
nano ~/atmosfera/.env
```

Required:

- `DISCORD_TOKEN` — from https://discord.com/developers/applications
- `DISCORD_CLIENT_ID`

Optional but recommended:

- `DISCORD_DEV_GUILD_ID` — only register commands to one guild (instant; without this they go global, ~1 hour to propagate)
- `GEMINI_API_KEY` — from https://aistudio.google.com/apikey (free, generous tier). Required for `/explain`.
- `NOMINATIM_USER_AGENT` — only if you ever extend geocoding fallback

## 4. Start it

```bash
sudo systemctl start atmosfera
journalctl -u atmosfera -f   # follow logs
```

Look for `ready as Atmosfera#NNNN in N guild(s)` and `ApplicationCommandRegistries: Took NNNms`.

## 5. Set up GitHub Actions auto-deploy

This step makes pushes to `main` automatically deploy.

### On the VM: generate a deploy keypair

```bash
ssh-keygen -t ed25519 -f ~/.ssh/atmosfera_deploy -N "" -C "atmosfera-deploy"
cat ~/.ssh/atmosfera_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/atmosfera_deploy   # print the PRIVATE key — copy the whole thing
```

### On GitHub: add the secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Four secrets:

| Name | Value |
| --- | --- |
| `DEPLOY_HOST` | The VM's external IP (or hostname). `gcloud compute instances list` shows it. |
| `DEPLOY_USER` | Your VM username. `whoami` on the VM. |
| `DEPLOY_PORT` | `22` (optional — only set if your VM uses a non-default SSH port) |
| `DEPLOY_SSH_KEY` | The full private key you just printed (including the `BEGIN` and `END` lines) |

### Test it

Push any commit to `main`. Watch the **Actions** tab. The workflow runs:

1. **test**: `bun install` → `tsc --noEmit` → `biome check` → `bun test`
2. **deploy** (only if test passes): SSH to the VM, `git reset --hard origin/main`, `bun install --production`, `systemctl restart atmosfera`, then a 5-second health check via `systemctl status`

If `deploy` fails, the bot stays on the previous revision (because `git reset` happens before `restart`, and a failed restart leaves the previous service running — though systemd will try to restart with new code on the next attempt).

## Day-2 operations

```bash
sudo systemctl status atmosfera    # is it running?
journalctl -u atmosfera -f          # follow logs
journalctl -u atmosfera --since '10 min ago'   # recent only

sudo systemctl restart atmosfera    # manual restart
sudo systemctl stop atmosfera       # take it down

du -sh ~/atmosfera/.cache/*         # check cache disk usage
# raw cache grows ~50 MB per unique city. Safe to delete .cache/raw/ to reclaim disk.
```

### Rolling back

```bash
cd ~/atmosfera
git log --oneline | head    # find the SHA to revert to
git reset --hard <sha>
~/.bun/bin/bun install --production
sudo systemctl restart atmosfera
```

The next push to `main` will pull you forward again, so this is a temporary lever — for a real rollback push a revert commit.

### One-off: scrub disk pages after the roast-feature removal

The first deploy that includes migration `0011_drop_roast_tables` drops all
roast tables (including 7 days of stored message text) in-process at boot.
`DROP TABLE` frees the pages but doesn't zero them, and the WAL may still hold
pre-drop page images — run a one-time VACUUM + checkpoint afterwards to
actually scrub and reclaim the space:

```bash
sudo systemctl stop atmosfera atmosfera-web   # exclusive access, takes seconds
cd ~/atmosfera && ~/.bun/bin/bun -e "const {Database}=require('bun:sqlite');const d=new Database('data/atmosfera.db');d.exec('VACUUM');d.exec('PRAGMA wal_checkpoint(TRUNCATE)');d.close()"
sudo systemctl start atmosfera atmosfera-web
```

## Resource sizing notes

| Component | RAM | Disk |
| --- | --- | --- |
| Bun runtime + bot process | ~150–250 MB steady | n/a |
| Resvg rasterization spikes | +100 MB transient | n/a |
| SQLite database | <1 MB for typical use | <10 MB |
| Raw weather cache | n/a | ~50 MB per unique city, one-time |
| Cube cache | n/a | ~1 MB per city |
| Chart PNG cache | n/a | ~50 KB per chart-pair-version |

`e2-micro` (1 GB RAM) is enough; `e2-small` (2 GB) is comfortable. Network egress is tiny (PNGs to Discord, JSON to Open-Meteo).

## Troubleshooting

**`bun: command not found` in the Actions deploy step.** The workflow uses `$HOME/.bun/bin/bun` explicitly, which should work. If you installed Bun elsewhere, update the path in `.github/workflows/deploy.yml`.

**`sudo: a password is required`.** The `install.sh` writes `/etc/sudoers.d/atmosfera`. If it's missing or malformed, `sudo systemctl restart atmosfera` will prompt for a password and the Actions deploy will hang. Verify with `sudo cat /etc/sudoers.d/atmosfera`.

**Bot starts, no slash commands appear in your dev guild.** Sapphire registers commands against the guild ID. Check `DISCORD_DEV_GUILD_ID` is set in `~/atmosfera/.env` AND that the bot was invited to that guild with the `applications.commands` scope.

**`Permission denied (publickey)` from the Actions deploy.** The pub key isn't in `~/.ssh/authorized_keys` on the VM, OR the priv key in the GH secret has trailing whitespace / missing trailing newline. Re-copy the full key including the `-----BEGIN`/`-----END` lines.

## Optional: moderation web app (apps/web)

The web app at `apps/web` exposes a moderation dashboard with Discord OAuth login,
multi-guild switching, the audit log, RBAC editor, per-guild config toggles, and an
owner-only `/admin` page. It runs as a separate `atmosfera-web` systemd unit on the
same VM and shares the SQLite file with the bot via WAL mode.

### One-shot install on the VM

After the main `install.sh` is done:

```bash
bash ~/atmosfera/deploy/install-web.sh
```

This writes `/etc/systemd/system/atmosfera-web.service` and grants the deploy user
passwordless `systemctl restart atmosfera-web`.

### Required env additions

Add these to `~/atmosfera/.env`:

```
DISCORD_CLIENT_SECRET=...
DISCORD_OAUTH_REDIRECT_URI=https://yourdomain/auth/discord/callback
SESSION_SECRET=$(openssl rand -hex 32)
WEB_PUBLIC_URL=https://yourdomain
WEB_PORT=3000
```

Register the redirect URI in the Discord developer portal under the application's
OAuth2 → Redirects list. Scopes used: `identify guilds`.

Bot owners (anyone in `DISCORD_OWNER_IDS`) get god-mode access in the web app —
they can switch into any guild the bot is in and see the cross-guild stats at
`/admin`. The same comma-separated list controls slash-command owner overrides.

### Start it

```bash
sudo systemctl start atmosfera-web
journalctl -u atmosfera-web -f
```

For HTTPS on a real domain, put Caddy or nginx in front of `localhost:3000`. The
auto-deploy workflow restarts `atmosfera-web` alongside the bot on every push to
`main`, but only if the unit is already installed — so you can hold off on this
piece without affecting bot deploys.
