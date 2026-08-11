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
