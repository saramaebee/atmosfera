/**
 * Single source of truth for atmosfera's privacy disclosure. Surfaced in-bot
 * via /privacy (apps/discord-bot/src/commands/privacy.ts) and mirrored in
 * PRIVACY.md at the repo root for GitHub viewers.
 *
 * Three top-level shapes:
 *   - PRIVACY_SUMMARY  — short version, shown by bare /privacy
 *   - PRIVACY_DATA     — message-tracking detail, shown by /privacy data
 *   - PRIVACY_AUDIT    — audit-log explainer, shown by /privacy audit-log
 *
 * If you change what's stored, sent, or logged, update the relevant constant
 * and bump PRIVACY_POLICY_VERSION. Keep PRIVACY.md in sync manually.
 */

export const PRIVACY_POLICY_VERSION = '2026-05-21.5';

export const PRIVACY_SUMMARY = {
  thirdParties: [
    'Open-Meteo — receives city coordinates / timezone for climate fetches. No user data.',
    'Nominatim (geocoding fallback) — receives city query strings. No user data.',
    "Google Gemini — receives climate-cube summaries for city snark, and anonymized message-pattern metadata + the target's display name for `/roast`. **Never raw message content.** Gemini inference-only; no data is used to train Google's models.",
  ],
  retained: [
    'Anonymized message metadata (timestamps, length buckets, attachment flags, mention counts). No content. 30-day rolling.',
    'Reply / mention edges between members. 30-day rolling.',
    'Generated roast text + invocation metadata. Indefinite while pinned, 30-day otherwise.',
    'Pinned roasts the target explicitly saved, plus upvotes. Indefinite (user-controlled).',
    'Per-guild config flags, per-user opt-in / opt-out states.',
    'Command permission rules and the audit log (admin actions).',
    'See `/privacy data` for the message-metadata breakdown and `/privacy audit-log` for what we log about admin actions.',
  ],
  neverStored: [
    'Raw message content. Ever — not in the database, not in logs.',
    'Direct messages.',
    "Message edits or deletions (we don't subscribe to those events).",
  ],
  commitments: [
    'Data is used solely to operate, debug, and improve atmosfera. Never sold or shared beyond the listed third-party pipeline.',
    'Never used to train any models. Gemini calls are inference-only.',
    'User controls: `/roast-user-config participation enable:false` to opt out of being roasted; `/pinned-roast delete` to remove individual pins.',
    'Data minimization: only the message stats listed in `/privacy data` are extracted. Full text is read in-memory and immediately discarded.',
  ],
} as const;

export const PRIVACY_DATA = {
  extracted: [
    'Message length, bucketed (character count → small/medium/large).',
    'Mention count, plus mentioned user IDs (no names or display strings).',
    'Attachment flag (boolean) + count.',
    'Reply target user ID, if the message is a reply.',
    'Channel ID + timestamp.',
    'Bot / system-message flag (used to filter, never stored).',
  ],
  readNotStored: [
    'Full message text — used in-memory only to derive the above stats, then discarded.',
    'Embed contents and message components.',
    "Edits or deletions to existing messages (we don't subscribe to those events).",
  ],
  retention: [
    'Per-message metadata, per-channel hourly counts, reply/mention edges: **30 days rolling**.',
    'Roast invocation metadata: 30 days, unless the roast was pinned (then indefinite).',
    'Pinned roasts, opt-in/opt-out states, guild config: indefinite (under user control).',
  ],
} as const;

export const PRIVACY_AUDIT = {
  whyLogged: [
    'Accountability for shared-server admin actions: who toggled what, when.',
    'Helps a server admin debug "wait, who turned that off?" without losing context.',
  ],
  whatLogged: [
    'Actor user ID (who took the action).',
    'Event type (e.g. `permission.grant`, `roast.indexing.toggle`, `roast.config.update`).',
    'Subject (the command or guild config the action affected).',
    'Per-event metadata — for permission rules, the principal (role/user ID) and before/after effect; for config toggles, the before/after values.',
    'Timestamp.',
  ],
  notLogged: [
    "Command content / arguments beyond what's named above.",
    "Regular user activity — that's covered by `/privacy data`, not the audit log.",
  ],
  access: [
    'Server admins (`Manage Server`) via `/permissions audit`.',
    'Retention: **indefinite**. The audit log is an administrative record.',
  ],
} as const;

/**
 * Legacy alias for compatibility — points at the new summary shape. Prefer
 * importing PRIVACY_SUMMARY / PRIVACY_DATA / PRIVACY_AUDIT directly.
 *
 * @deprecated use PRIVACY_SUMMARY instead.
 */
export const PRIVACY_POLICY = {
  stored: PRIVACY_SUMMARY.retained,
  neverStored: PRIVACY_SUMMARY.neverStored,
  thirdParties: PRIVACY_SUMMARY.thirdParties,
  controls: PRIVACY_SUMMARY.commitments,
} as const;
