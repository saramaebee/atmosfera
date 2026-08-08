# atmosfera — privacy

atmosfera is a climate-charts bot. It does not track members: no message content and no per-user activity data are stored. The privacy-relevant surfaces are the city-lookup flow, the `/explain` command, and the admin tooling (permissions + audit log).

Policy version: **2026-08-08.1**

> Mirror of the `/privacy` slash command. Source of truth: `apps/discord-bot/src/lib/privacy-policy.ts`. If anything below diverges from that file, the source file wins — please open an issue.

## What's stored

- City lookup results, and the aliases created when you pick a disambiguation candidate (scoped global / guild / user).
- Per-guild `/explain` configuration: allowed channels and role → language/tier mappings.
- Command permission rules (`/permissions`) and the audit log of admin actions.
- Web dashboard sessions (login state for server admins).

## What's never stored

- Direct messages.
- Message content, embeds, attachment binaries, reactions, message components.
- Per-user activity data of any kind.

## Third parties

- **Open-Meteo** — receives city coordinates / timezone for climate fetches. No user data.
- **Nominatim** (geocoding fallback) — receives city query strings. No user data.
- **Google Gemini** — for `/explain` only: receives the target message and a short window of surrounding channel messages, fetched live from Discord at invocation time and discarded afterwards. Inference-only; no data is used to train Google's models.

## Your controls

- `/privacy` — view this policy in-Discord.
- `/privacy audit-log` — what the bot logs about admin actions, and why.
- `/permissions` — admins can grant/revoke command access per role or user.

## Audit log

The bot keeps a record of admin actions (who toggled what, when): actor user ID, event type (e.g. `permission.grant`, `explain.mode.set`), the affected subject, before/after metadata, and a timestamp. Regular user activity is not logged. Server admins can view it via `/permissions audit`; retention is indefinite (it's an administrative record).
