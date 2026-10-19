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

export const PRIVACY_POLICY_VERSION = '2026-10-19.1';

export const PRIVACY_SUMMARY = {
  thirdParties: [
    'Open-Meteo: receives city query strings (geocoding) and city coordinates / timezone for climate fetches. No user data.',
    'RainViewer (radar tiles) and CARTO (basemap tiles): receive the map area around a location. No user data.',
    'Public weather endpoint (saratonin.dev/weather/): Open-Meteo, RainViewer and CARTO receive only a 0.25° grid cell (about 25 km), never your IP.',
    'IP Geolocation by [DB-IP](https://db-ip.com) (DB-IP Lite, CC BY 4.0). Used as a local database file; nothing is sent to DB-IP.',
  ],
  retained: [
    'City lookup results and the aliases created when you pick a disambiguation candidate.',
    'A user-scoped alias stores your Discord user ID with the query and the city you picked, so your next lookup skips the picker. Untick "Save as alias" before picking to skip saving it.',
    'Public weather endpoint: climatology data cached on disk per 0.25° grid cell, and rendered images cached in memory for 10 minutes per grid cell and theme.',
    'Command permission rules and the audit log (admin actions).',
    'Web dashboard sessions (login state for server admins).',
    'No message content and no per-user activity data are stored.',
  ],
  neverStored: [
    'Direct messages.',
    'Message content, embeds, attachments, reactions, components.',
    'Public weather endpoint: your IP address or location. The IP is used in memory to estimate an approximate location from a local DB-IP database, rounded at once to a 0.25° grid cell, and is never logged or written to disk. A salted hash of it (salt random per process, never stored) is held in memory for up to 5 minutes for rate limiting. No cookies, no accounts.',
  ],
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
