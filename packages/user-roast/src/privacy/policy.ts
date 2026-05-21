/**
 * Single source of truth for user-roast's privacy disclosure. Surfaced in-bot
 * via /privacy (apps/discord-bot/src/commands/privacy.ts) and mirrored in
 * PRIVACY.md at the repo root for GitHub viewers.
 *
 * If you add a column to packages/db/src/schema.ts (user-roast section), update
 * PRIVACY_POLICY.stored. Bump PRIVACY_POLICY_VERSION on any change. PRIVACY.md
 * must be kept in sync manually.
 */

export const PRIVACY_POLICY_VERSION = '2026-05-21.4';

export const PRIVACY_POLICY = {
  stored: [
    'Per-hour aggregated message counts per (user, channel) — counts only, not content. 30-day retention.',
    'Per-message metadata (channel, timestamp, length bucket, has-attachment flag, is-reply flag, mention count) — 30-day retention.',
    'Reply and @mention edges (who interacted with whom, when, in which channel) — 30-day retention.',
    'Roast history metadata: angle labels, partner IDs name-dropped, search keywords used — 30-day retention. Used to make repeat roasts feel less repetitive.',
    'Pinned roasts: when the target of a roast explicitly clicks 📌 Pin on a public roast, we store the roast text along with the channel/message IDs that contained it, plus the upvote ledger (which voters approved which pinned roast). Retained until the owner deletes via `/pinned-roast delete`; not subject to the 30-day purge.',
    'Per-guild config: indexing on/off, command toggles, brutal-mode allowed.',
    'Per-user brutal-mode opt-in records.',
    'Per-user roast participation opt-out records (with 30-day re-entry lock timestamps).',
  ],
  neverStored: [
    'Message content. Ever. Not in the database, not in logs.',
    'Roast text or message IDs for roasts that were not explicitly pinned by their target.',
    'Direct messages.',
  ],
  thirdParties: [
    "Google Gemini Flash 2.5 — receives behavioral fingerprints and short live-fetched message samples during a roast, scoped to that single roast. We do not control Gemini's retention; see Google's policy. Server-side safety filter is disabled; safety enforcement happens in-bot.",
  ],
  controls: [
    '`/roast-setup` — admin opt-in for the entire guild. User-roast is inert until run.',
    '`/roast-user-config brutal` — per-user consent for brutal tone (and the target must opt in to be roasted in brutal mode).',
    '`/roast-user-config participation` — per-user opt-out of roasting entirely. Symmetric: opted-out users can\'t roast others either. 30-day lock-in after re-opting in.',
    '`/roast-config` — admin toggles for slash/message/brutal-allowed.',
    '`/privacy` — view this policy.',
  ],
} as const;
