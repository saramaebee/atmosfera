# atmosfera — privacy

This bot has two flows: **climate charts** (per-city, no Discord-user data persisted) and **user roasts** (per-Discord-user, the privacy-sensitive flow). The climate flow only caches public weather data and resolved city aliases. Everything below is about the user-roast flow.

User-roast policy version: **2026-05-21.4**

> Mirror of the `/privacy` slash command. Source of truth: `packages/user-roast/src/privacy/policy.ts`. If anything below diverges from that file, the source file wins — please open an issue.

## What's stored

- Per-hour aggregated message counts per (user, channel) — counts only, not content. 30-day retention.
- Per-message metadata (channel, timestamp, length bucket, has-attachment flag, is-reply flag, mention count) — 30-day retention.
- Reply and @mention edges (who interacted with whom, when, in which channel) — 30-day retention.
- Roast history metadata: angle labels, partner IDs name-dropped, search keywords used — 30-day retention. Used to make repeat roasts feel less repetitive.
- Pinned roasts: when the target of a roast explicitly clicks 📌 Pin on a public roast, we store the roast text along with the channel/message IDs that contained it, plus the upvote ledger (which voters approved which pinned roast). Retained until the owner deletes via `/pinned-roast delete`; not subject to the 30-day purge.
- Per-guild config: indexing on/off, command toggles, brutal-mode allowed.
- Per-user brutal-mode opt-in records.
- Per-user roast participation opt-out records (with 30-day re-entry lock timestamps).

## What's never stored

- Message content. Ever. Not in the database, not in logs.
- Roast text or message IDs for roasts that were not explicitly pinned by their target.
- Direct messages.

## Third parties

- **Google Gemini Flash 2.5** — receives behavioral fingerprints and short live-fetched message samples during a roast, scoped to that single roast. We do not control Gemini's retention; see Google's policy. Server-side safety filter is disabled; safety enforcement happens in-bot.

## Your controls

- `/roast-setup` — admin opt-in for the entire guild. User-roast is inert until run.
- `/roast-user-config brutal` — per-user consent for brutal tone (and the target must opt in to be roasted in brutal mode).
- `/roast-user-config participation` — per-user opt-out of roasting entirely. Symmetric: opted-out users can't roast others either. 30-day lock-in after re-opting in.
- `/roast-config` — admin toggles for slash/message/brutal-allowed.
- `/privacy` — view this policy in-Discord.

## How indexing actually works

When a guild admin runs `/roast-setup enable:true`, the bot's message listener begins recording metadata for every non-bot message in that guild. The listener computes message length, mention count, and reply/attachment flags, then writes only those numbers — never the message text — into SQLite. The `MESSAGE_CONTENT` intent is required because Discord won't deliver these fields otherwise; we read the message, extract stats, and drop the content.

During a roast, the bot fetches a small live sample of recent messages into in-memory cache, lets the LLM tool-loop pull more on demand, and discards the entire cache when the roast completes. No content reaches the database from this path either.

## Retention summary

| Data | Retention | Configurable via |
|---|---|---|
| Hourly activity counts | 30 days | `ACTIVITY_HOURLY_RETENTION_DAYS` |
| Per-message metadata | 30 days | `ACTIVITY_RECENT_RETENTION_DAYS` |
| Interaction edges | 30 days | `INTERACTIONS_RETENTION_DAYS` |
| Roast history metadata | 30 days | `ROAST_HISTORY_RETENTION_DAYS` |
| Pinned roasts + upvotes | Until owner deletes | — |
| Guild config / opt-ins | Until you change them | — |

A daily purge task enforces these cutoffs.
