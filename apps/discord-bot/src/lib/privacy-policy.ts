/**
 * Single source of truth for atmosfera's privacy disclosure. Surfaced in-bot
 * via /privacy (apps/discord-bot/src/commands/privacy.ts) and mirrored in
 * PRIVACY.md at the repo root for GitHub viewers.
 *
 * Two top-level shapes:
 *   - PRIVACY_SUMMARY  — short version, shown by bare /privacy
 *   - PRIVACY_AUDIT    — audit-log explainer, shown by /privacy audit-log
 *
 * If you change what's stored, sent, or logged, update the relevant constant
 * and bump PRIVACY_POLICY_VERSION. Keep PRIVACY.md in sync manually.
 */

export const PRIVACY_POLICY_VERSION = '2026-08-11.1';

export const PRIVACY_SUMMARY = {
  thirdParties: [
    'Open-Meteo — receives city coordinates / timezone for climate fetches. No user data.',
    'Nominatim (geocoding fallback) — receives city query strings. No user data.',
  ],
  retained: [
    'City lookup results and the aliases created when you pick a disambiguation candidate.',
    'Command permission rules and the audit log (admin actions).',
    'Web dashboard sessions (login state for server admins).',
    'No message content and no per-user activity data are stored.',
  ],
  neverStored: ['Direct messages.', 'Message content, embeds, attachments, reactions, components.'],
  commitments: [
    'Data is used solely to operate, debug, and improve atmosfera. Never sold or shared beyond the listed third-party pipeline.',
    'Never used to train any models.',
    'See `/privacy audit-log` for what we log about admin actions.',
  ],
} as const;

export const PRIVACY_AUDIT = {
  whyLogged: [
    'Accountability for shared-server admin actions: who toggled what, when.',
    'Helps a server admin debug "wait, who turned that off?" without losing context.',
  ],
  whatLogged: [
    'Actor user ID (who took the action).',
    'Event type (e.g. `permission.grant`, `permission.revoke`).',
    'Subject (the command or guild config the action affected).',
    'Per-event metadata — for permission rules, the principal (role/user ID) and before/after effect; for config changes, the before/after values.',
    'Timestamp.',
  ],
  notLogged: [
    "Command content / arguments beyond what's named above.",
    'Regular user activity — the bot does not track or store member messages.',
  ],
  access: [
    'Server admins (`Manage Server`) via `/permissions audit`.',
    'Retention: **indefinite**. The audit log is an administrative record.',
  ],
} as const;
