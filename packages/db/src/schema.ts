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

/**
 * Per-guild user-roast feature toggles. Bot is inert until indexing_enabled.
 *
 * The `roast*` nullable columns are *override knobs* for the synthesis/
 * hypothesize pipeline — null means "use env default" (see ROAST_* in
 * @atmosfera/config). They exist so the prompt-engineering can be tuned per
 * guild from the web app without redeploys. Resolved into a single object by
 * getEffectiveRoastKnobs() in packages/user-roast/src/db/config.ts.
 */
export const guildConfig = sqliteTable('guild_config', {
  guildId: text('guild_id').primaryKey(),
  indexingEnabled: integer('indexing_enabled').notNull().default(0),
  slashEnabled: integer('slash_enabled').notNull().default(1),
  messageEnabled: integer('message_enabled').notNull().default(1),
  brutalAllowed: integer('brutal_allowed').notNull().default(0),
  indexingEnabledAt: integer('indexing_enabled_at'),
  roastHypothesizeMaxIterations: integer('roast_hypothesize_max_iterations'),
  roastSynthesizeMaxIterations: integer('roast_synthesize_max_iterations'),
  roastTemperatureSharp: real('roast_temperature_sharp'),
  roastTemperatureBrutal: real('roast_temperature_brutal'),
  roastThinkingBudget: integer('roast_thinking_budget'),
  roastMinToolCalls: integer('roast_min_tool_calls'),
  roastDeemphasizeChannelDist: integer('roast_deemphasize_channel_dist'),
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

/**
 * Verbatim message text for the roast hot-path. 7-day rolling retention.
 * Maintained in lockstep with Discord state: writes on MessageCreate (for
 * non-opted-out users in indexing-enabled guilds), UPDATE on MessageUpdate,
 * DELETE on MessageDelete / MessageDeleteBulk, and eager wipe-by-user on
 * roast opt-out. If you add a column here, update
 * packages/user-roast/src/privacy/policy.ts and PRIVACY.md.
 */
export const messagesRecent = sqliteTable(
  'messages_recent',
  {
    messageId: text('message_id').primaryKey(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    authorId: text('author_id').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull(),
    editedAt: integer('edited_at'),
    isReply: integer('is_reply').notNull().default(0),
    replyToId: text('reply_to_id'),
  },
  (t) => [
    index('idx_messages_recent_guild_author_time').on(t.guildId, t.authorId, t.createdAt),
    index('idx_messages_recent_created').on(t.createdAt),
    // Supports per-channel slices (channel-scoped search, time windows, and
    // "messages in #X by user Y") used by the local-first roast tools.
    index('idx_messages_recent_guild_channel_author_time').on(
      t.guildId,
      t.channelId,
      t.authorId,
      t.createdAt,
    ),
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

/**
 * Per-invocation roast decision trace. One row per /roast run, written from
 * pipeline.ts as a sidecar to roast_history. Owner-only — surfaced through
 * the web app's /g/:id/debug/roasts page. 30d retention (matches
 * roast_history). Captures everything needed to answer "why did the model
 * pick this angle": fingerprint snapshot, exact prompts sent, full tool-loop
 * transcripts (args + results), final hypothesis, and effective knob values.
 * If you add a column here, update packages/user-roast/src/privacy/policy.ts.
 */
export const roastTrace = sqliteTable(
  'roast_trace',
  {
    invocationId: text('invocation_id').primaryKey(),
    guildId: text('guild_id').notNull(),
    targetId: text('target_id').notNull(),
    invokerId: text('invoker_id').notNull(),
    createdAt: integer('created_at').notNull(),
    tone: text('tone').notNull().$type<'sharp' | 'brutal'>(),
    length: text('length').notNull().$type<'short' | 'medium' | 'long'>(),
    fingerprintJson: text('fingerprint_json').notNull(),
    fingerprintSummaryText: text('fingerprint_summary_text').notNull(),
    hypothesisPromptText: text('hypothesis_prompt_text').notNull(),
    hypothesisExplorationJson: text('hypothesis_exploration_json').notNull(),
    hypothesisJson: text('hypothesis_json').notNull(),
    synthesisSystemText: text('synthesis_system_text').notNull(),
    synthesisPromptText: text('synthesis_prompt_text').notNull(),
    synthesisJson: text('synthesis_json').notNull(),
    knobsJson: text('knobs_json').notNull(),
    totalMessagesFetched: integer('total_messages_fetched').notNull(),
    totalDurationMs: integer('total_duration_ms').notNull(),
    finalRoastText: text('final_roast_text').notNull(),
  },
  (t) => [
    index('idx_roast_trace_guild_time').on(t.guildId, t.createdAt),
    index('idx_roast_trace_guild_target_time').on(t.guildId, t.targetId, t.createdAt),
    index('idx_roast_trace_created').on(t.createdAt),
  ],
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

// ─── web app (apps/web) ────────────────────────────────────────────────────

/**
 * Authenticated browser sessions for the moderation web app. Cookie holds
 * only the session id; OAuth access/refresh tokens are AES-GCM encrypted
 * with SESSION_SECRET before being stored here.
 *
 * `oauthGuildsJson` caches the user's /users/@me/guilds response (id, name,
 * icon, permissions) so the guild switcher doesn't re-hit Discord on every
 * page load. Refreshed on explicit user action.
 */
export const webSessions = sqliteTable(
  'web_sessions',
  {
    id: text('id').primaryKey(),
    discordUserId: text('discord_user_id').notNull(),
    discordUsername: text('discord_username').notNull(),
    discordGlobalName: text('discord_global_name'),
    discordAvatarHash: text('discord_avatar_hash'),
    accessTokenEnc: text('access_token_enc').notNull(),
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    accessTokenExpiresAt: integer('access_token_expires_at').notNull(),
    oauthGuildsJson: text('oauth_guilds_json').notNull(),
    oauthGuildsFetchedAt: integer('oauth_guilds_fetched_at').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [index('idx_web_sessions_user').on(t.discordUserId)],
);

/**
 * Snapshot of the guilds the bot is currently a member of. Maintained by
 * the bot's botGuildsReconcile listener on ready / guildCreate / guildDelete.
 * `leftAt IS NULL` means the bot is still in the guild.
 *
 * The web app uses this to:
 *   - intersect with the user's OAuth /users/@me/guilds for the switcher
 *   - drive the owner-only /admin stats page
 */
export const botGuilds = sqliteTable(
  'bot_guilds',
  {
    guildId: text('guild_id').primaryKey(),
    name: text('name').notNull(),
    iconHash: text('icon_hash'),
    memberCount: integer('member_count'),
    joinedAt: integer('joined_at').notNull(),
    leftAt: integer('left_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_bot_guilds_left_at').on(t.leftAt)],
);

/**
 * Cache of Discord user profiles (username, avatar) so admin pages in the
 * web app can render names instead of bare snowflakes. Populated lazily by
 * the web app via GET /users/:id with the bot token; rows older than ~24h
 * are refreshed on next view.
 */
export const discordUserCache = sqliteTable('discord_user_cache', {
  userId: text('user_id').primaryKey(),
  username: text('username').notNull(),
  globalName: text('global_name'),
  avatarHash: text('avatar_hash'),
  fetchedAt: integer('fetched_at').notNull(),
});

export type WebSession = typeof webSessions.$inferSelect;
export type NewWebSession = typeof webSessions.$inferInsert;
export type BotGuild = typeof botGuilds.$inferSelect;
export type NewBotGuild = typeof botGuilds.$inferInsert;
export type DiscordUserCacheRow = typeof discordUserCache.$inferSelect;
export type NewDiscordUserCacheRow = typeof discordUserCache.$inferInsert;

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
export type RoastTraceRow = typeof roastTrace.$inferSelect;
export type NewRoastTraceRow = typeof roastTrace.$inferInsert;
