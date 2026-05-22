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
