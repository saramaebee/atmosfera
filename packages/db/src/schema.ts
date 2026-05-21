import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Canonical resolved cities. Keyed by Open-Meteo's geocoder id when available
 * (so re-geocoding the same query returns the same row).
 */
export const cities = sqliteTable(
  'cities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    canonicalName: text('canonical_name').notNull(),
    region: text('region'),
    country: text('country').notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    timezone: text('timezone').notNull(),
    population: integer('population'),
    openMeteoId: integer('open_meteo_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('cities_open_meteo_id_idx').on(table.openMeteoId),
    uniqueIndex('cities_latlon_idx').on(table.latitude, table.longitude),
  ],
);

/**
 * Aliases for resolved cities, scoped global / guild / user. Empty strings are
 * sentinels for "not applicable" so the unique index actually enforces
 * (NULL ≠ NULL would let duplicates slip through).
 */
export const aliases = sqliteTable(
  'aliases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    query: text('query').notNull(),
    scope: text('scope').notNull().$type<'global' | 'guild' | 'user'>(),
    guildId: text('guild_id').notNull().default(''),
    userId: text('user_id').notNull().default(''),
    cityId: integer('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('aliases_scope_lookup_idx').on(
      table.query,
      table.scope,
      table.guildId,
      table.userId,
    ),
  ],
);

export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;
export type Alias = typeof aliases.$inferSelect;
export type NewAlias = typeof aliases.$inferInsert;
export type AliasScope = 'global' | 'guild' | 'user';

// ─── user-roast (skilishu) tables ──────────────────────────────────────────
// All times are Unix ms epochs (integer). No message content is stored
// anywhere in this section — see PRIVACY.md.

/** Per-guild user-roast feature toggles. Bot is inert until indexing_enabled. */
export const guildConfig = sqliteTable('guild_config', {
  guildId: text('guild_id').primaryKey(),
  indexingEnabled: integer('indexing_enabled').notNull().default(0),
  slashEnabled: integer('slash_enabled').notNull().default(1),
  messageEnabled: integer('message_enabled').notNull().default(1),
  brutalAllowed: integer('brutal_allowed').notNull().default(0),
  indexingEnabledAt: integer('indexing_enabled_at'),
});

/** Aggregated message counts per (user, channel, hour). 30d retention. */
export const activityHourly = sqliteTable(
  'activity_hourly',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    channelId: text('channel_id').notNull(),
    hourBucket: integer('hour_bucket').notNull(),
    msgCount: integer('msg_count').notNull().default(0),
    totalLength: integer('total_length').notNull().default(0),
    mentionCount: integer('mention_count').notNull().default(0),
    attachmentCount: integer('attachment_count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId, t.channelId, t.hourBucket] }),
    index('idx_activity_hourly_guild_user').on(t.guildId, t.userId, t.hourBucket),
    index('idx_activity_hourly_guild_channel').on(t.guildId, t.channelId, t.hourBucket),
  ],
);

/** Per-message metadata (NOT content). 7d retention. */
export const activityRecent = sqliteTable(
  'activity_recent',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    channelId: text('channel_id').notNull(),
    createdAt: integer('created_at').notNull(),
    lengthBucket: integer('length_bucket').notNull(),
    hasAttachment: integer('has_attachment').notNull().default(0),
    isReply: integer('is_reply').notNull().default(0),
    mentionCount: integer('mention_count').notNull().default(0),
  },
  (t) => [
    index('idx_activity_recent_guild_user_time').on(t.guildId, t.userId, t.createdAt),
    index('idx_activity_recent_created').on(t.createdAt),
  ],
);

/** Reply/mention edges between users. 30d retention. */
export const interactions = sqliteTable(
  'interactions',
  {
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    authorId: text('author_id').notNull(),
    targetId: text('target_id').notNull(),
    kind: text('kind').notNull().$type<'reply' | 'mention'>(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_interactions_guild_author_time').on(t.guildId, t.authorId, t.createdAt),
    index('idx_interactions_guild_target_time').on(t.guildId, t.targetId, t.createdAt),
    index('idx_interactions_created').on(t.createdAt),
  ],
);

/** Users who opted into brutal-tone roasts. */
export const brutalOptin = sqliteTable(
  'brutal_optin',
  {
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    optedInAt: integer('opted_in_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.guildId] })],
);

/** Users who opted out of being roasted. 30d lock-in on re-opt-in. */
export const roastOptout = sqliteTable(
  'roast_optout',
  {
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    optedOut: integer('opted_out').notNull(),
    lockedUntil: integer('locked_until'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.guildId] })],
);

/**
 * Roast invocation metadata (no roast text — that's in pinned_roasts if pinned).
 * If you add a column here, update packages/user-roast/src/privacy/policy.ts so
 * the in-bot /privacy disclosure stays honest. 30d retention.
 */
export const roastHistory = sqliteTable(
  'roast_history',
  {
    invocationId: text('invocation_id').primaryKey(),
    guildId: text('guild_id').notNull(),
    targetId: text('target_id').notNull(),
    invokerId: text('invoker_id').notNull(),
    tone: text('tone').notNull().$type<'sharp' | 'brutal'>(),
    createdAt: integer('created_at').notNull(),
    angleTitlesJson: text('angle_titles_json').notNull(),
    referencedPartnerIdsJson: text('referenced_partner_ids_json').notNull(),
    searchedKeywordsJson: text('searched_keywords_json').notNull(),
  },
  (t) => [
    index('idx_roast_history_guild_target_time').on(t.guildId, t.targetId, t.createdAt),
    index('idx_roast_history_created').on(t.createdAt),
  ],
);

/**
 * User-pinned roasts. Full text + message refs persisted only here, only when
 * the target explicitly pins. Not subject to retention purge. If you add a
 * column here, update packages/user-roast/src/privacy/policy.ts.
 */
export const pinnedRoasts = sqliteTable(
  'pinned_roasts',
  {
    invocationId: text('invocation_id').primaryKey(),
    guildId: text('guild_id').notNull(),
    targetId: text('target_id').notNull(),
    invokerId: text('invoker_id').notNull(),
    tone: text('tone').notNull().$type<'sharp' | 'brutal'>(),
    roastText: text('roast_text').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    pinnedAt: integer('pinned_at').notNull(),
    roastCreatedAt: integer('roast_created_at').notNull(),
  },
  (t) => [index('idx_pinned_roasts_guild_target_pinned').on(t.guildId, t.targetId, t.pinnedAt)],
);

/** Upvotes on pinned roasts. */
export const pinnedRoastVotes = sqliteTable(
  'pinned_roast_votes',
  {
    invocationId: text('invocation_id').notNull(),
    voterId: text('voter_id').notNull(),
    votedAt: integer('voted_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.invocationId, t.voterId] }),
    index('idx_pinned_roast_votes_invocation').on(t.invocationId),
  ],
);

// ─── permissions + audit ───────────────────────────────────────────────────

/**
 * Per-guild RBAC override rules for slash commands. Each row is an explicit
 * allow/deny tied to a role or user principal; rules in this table layer on
 * top of the command's compiled-in baseline scope. Resolution order is
 * documented in apps/discord-bot/src/preconditions/AtmosferaScope.ts.
 */
export const commandPermissionRules = sqliteTable(
  'command_permission_rules',
  {
    guildId: text('guild_id').notNull(),
    commandName: text('command_name').notNull(),
    principalType: text('principal_type').notNull().$type<'role' | 'user'>(),
    principalId: text('principal_id').notNull(),
    effect: text('effect').notNull().$type<'allow' | 'deny'>(),
    grantedBy: text('granted_by').notNull(),
    grantedAt: integer('granted_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.commandName, t.principalType, t.principalId] }),
    index('idx_cmd_perm_rules_guild_cmd').on(t.guildId, t.commandName),
  ],
);

/**
 * Generic event log for admin-facing mutations. Callers anywhere in the bot
 * use recordAuditEvent(). eventType follows a `domain.subject.action` convention.
 * Indefinite retention by design.
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id'),
    actorId: text('actor_id').notNull(),
    eventType: text('event_type').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_audit_log_guild_time').on(t.guildId, t.createdAt),
    index('idx_audit_log_event_time').on(t.eventType, t.createdAt),
  ],
);

export type CommandPermissionRule = typeof commandPermissionRules.$inferSelect;
export type NewCommandPermissionRule = typeof commandPermissionRules.$inferInsert;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
export type PrincipalType = 'role' | 'user';
export type PermissionEffect = 'allow' | 'deny';

export type GuildConfig = typeof guildConfig.$inferSelect;
export type NewGuildConfig = typeof guildConfig.$inferInsert;
export type ActivityHourly = typeof activityHourly.$inferSelect;
export type NewActivityHourly = typeof activityHourly.$inferInsert;
export type ActivityRecent = typeof activityRecent.$inferSelect;
export type NewActivityRecent = typeof activityRecent.$inferInsert;
export type Interaction = typeof interactions.$inferSelect;
export type NewInteraction = typeof interactions.$inferInsert;
export type BrutalOptin = typeof brutalOptin.$inferSelect;
export type RoastOptout = typeof roastOptout.$inferSelect;
export type RoastHistoryRow = typeof roastHistory.$inferSelect;
export type NewRoastHistoryRow = typeof roastHistory.$inferInsert;
export type PinnedRoast = typeof pinnedRoasts.$inferSelect;
export type NewPinnedRoast = typeof pinnedRoasts.$inferInsert;
export type PinnedRoastVote = typeof pinnedRoastVotes.$inferSelect;
export type RoastTone = 'sharp' | 'brutal';
