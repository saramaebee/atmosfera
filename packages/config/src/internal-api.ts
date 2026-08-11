/**
 * Shared types for the bot's internal HTTP API.
 *
 * The internal API lives inside the bot process and is consumed by the web app
 * over loopback (127.0.0.1) with a shared bearer token. It exists solely to
 * surface live discord.js state to the dashboard for owner debugging — there's
 * no other authorization layer, so the API must never be exposed publicly.
 */

export interface BotChannelPerms {
  viewChannel: boolean;
  sendMessages: boolean;
  sendMessagesInThreads: boolean;
  readMessageHistory: boolean;
  embedLinks: boolean;
  attachFiles: boolean;
  addReactions: boolean;
  useExternalEmojis: boolean;
  mentionEveryone: boolean;
  manageMessages: boolean;
}

export const BOT_CHANNEL_PERMISSION_KEYS: ReadonlyArray<keyof BotChannelPerms> = [
  'viewChannel',
  'sendMessages',
  'sendMessagesInThreads',
  'readMessageHistory',
  'embedLinks',
  'attachFiles',
  'addReactions',
  'useExternalEmojis',
  'mentionEveryone',
  'manageMessages',
];

export interface BotChannelInfo {
  id: string;
  name: string;
  /** discord.js ChannelType numeric enum value */
  type: number;
  /** Human-readable type label (e.g. "text", "voice", "forum"). */
  typeLabel: string;
  parentId: string | null;
  position: number;
  perms: BotChannelPerms;
  /** Effective permissions bitfield as a decimal string. */
  effectiveBitfield: string;
}

export interface BotCategoryInfo {
  id: string;
  name: string;
  position: number;
}

export interface BotChannelsOk {
  kind: 'ok';
  guildId: string;
  guildName: string;
  /** Bot member's username#discriminator or username. */
  botMemberTag: string;
  categories: BotCategoryInfo[];
  channels: BotChannelInfo[];
}

export interface BotChannelsError {
  kind: 'not_found' | 'not_cached' | 'unauthorized' | 'unavailable';
  message: string;
}

export type BotChannelsResponse = BotChannelsOk | BotChannelsError;

export interface BotRoleInfo {
  id: string;
  name: string;
  /** Decimal RGB color, 0 = default Discord role color. */
  color: number;
  /** Higher position = higher in the role hierarchy. */
  position: number;
  /** True for integration/bot-managed roles, which admins typically should not pick. */
  managed: boolean;
  /** True for the @everyone role; surfaced so the UI can filter it out. */
  everyone: boolean;
}

export interface BotRolesOk {
  kind: 'ok';
  guildId: string;
  guildName: string;
  roles: BotRoleInfo[];
}

export type BotRolesResponse = BotRolesOk | BotChannelsError;

/**
 * Application command type matching Discord's enum:
 *  1 = ChatInput (slash command)
 *  2 = User (right-click on a user → Apps)
 *  3 = Message (right-click on a message → Apps)
 */
export type BotCommandKind = 'chat_input' | 'user_context' | 'message_context' | 'unknown';

export interface BotCommandInfo {
  id: string;
  name: string;
  kind: BotCommandKind;
  /** 'global' commands work in every guild; 'guild' commands are registered to one specific guild. */
  scope: 'global' | 'guild';
  /** Discord's default member-permissions gate, as a decimal string (or null = no override). */
  defaultMemberPermissions: string | null;
  /** True if the command is usable in DMs (slash commands only; null for context-menu). */
  dmPermission: boolean | null;
  /** Snowflake — updates each time the command is re-registered. Useful for spotting stale registrations. */
  version: string;
}

export interface BotCommandsOk {
  kind: 'ok';
  guildId: string;
  guildName: string;
  /** Application commands the bot has registered globally (visible in every guild). */
  global: BotCommandInfo[];
  /** Application commands registered to this specific guild (e.g. via DISCORD_DEV_GUILD_ID). */
  guildScoped: BotCommandInfo[];
}

export type BotCommandsResponse = BotCommandsOk | BotChannelsError;
