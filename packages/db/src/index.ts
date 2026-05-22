export { createDb, migrateDb, type Db } from './client';
export * from './schema';
export {
  upsertCity,
  findCityById,
  findAlias,
  saveAlias,
  normalizeQuery,
  type CityInput,
  type AliasLookup,
  type AliasHit,
  type SaveAliasInput,
} from './repos';
export {
  recordAuditEvent,
  listAuditEvents,
  parseAuditMetadata,
  type RecordAuditEventInput,
  type ListAuditEventsFilter,
} from './audit';
export {
  upsertRule,
  removeRule,
  listRulesForGuild,
  listRulesForCommand,
  evaluateAccess,
  type Principal,
  type UpsertRuleInput,
  type UpsertRuleResult,
  type RemoveRuleInput,
  type RemoveRuleResult,
  type EvaluateAccessInput,
  type AccessVerdict,
} from './permissions';
export {
  createWebSession,
  getWebSession,
  touchWebSession,
  updateWebSessionTokens,
  updateWebSessionGuilds,
  deleteWebSession,
  purgeStaleWebSessions,
  type CreateWebSessionInput,
  type UpdateWebSessionTokensInput,
} from './web-sessions';
export {
  upsertBotGuild,
  markBotGuildLeft,
  getBotGuild,
  listActiveBotGuilds,
  reconcileBotGuildsLeft,
  botGuildStats,
  type UpsertBotGuildInput,
  type ReconcileBotGuildsInput,
  type BotGuildStats,
} from './bot-guilds';
export {
  upsertDiscordUser,
  getDiscordUsers,
  type UpsertDiscordUserInput,
} from './discord-users';
export { listNotableUserSettings, type NotableUserSetting } from './user-settings';
