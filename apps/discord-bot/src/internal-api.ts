import { timingSafeEqual } from 'node:crypto';
import {
  type BotCategoryInfo,
  type BotChannelInfo,
  type BotChannelPerms,
  type BotChannelsResponse,
  type BotCommandInfo,
  type BotCommandKind,
  type BotCommandsResponse,
  type BotRoleInfo,
  type BotRolesResponse,
  getEnv,
} from '@atmosfera/config';
import type { SapphireClient } from '@sapphire/framework';
import {
  type ApplicationCommand,
  ApplicationCommandType,
  ChannelType,
  type GuildBasedChannel,
  type GuildMember,
  PermissionFlagsBits,
} from 'discord.js';

const CHANNELS_ROUTE = /^\/internal\/guilds\/(\d{17,20})\/channels$/;
const ROLES_ROUTE = /^\/internal\/guilds\/(\d{17,20})\/roles$/;
const COMMANDS_ROUTE = /^\/internal\/guilds\/(\d{17,20})\/commands$/;

const TYPE_LABELS: Record<number, string> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildStageVoice]: 'stage',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildMedia]: 'media',
  [ChannelType.GuildDirectory]: 'directory',
};

function isThread(type: number): boolean {
  return (
    type === ChannelType.PublicThread ||
    type === ChannelType.PrivateThread ||
    type === ChannelType.AnnouncementThread
  );
}

function computePerms(channel: GuildBasedChannel, me: GuildMember): BotChannelPerms {
  const p = channel.permissionsFor(me);
  const has = (bit: bigint) => Boolean(p?.has(bit));
  return {
    viewChannel: has(PermissionFlagsBits.ViewChannel),
    sendMessages: has(PermissionFlagsBits.SendMessages),
    sendMessagesInThreads: has(PermissionFlagsBits.SendMessagesInThreads),
    readMessageHistory: has(PermissionFlagsBits.ReadMessageHistory),
    embedLinks: has(PermissionFlagsBits.EmbedLinks),
    attachFiles: has(PermissionFlagsBits.AttachFiles),
    addReactions: has(PermissionFlagsBits.AddReactions),
    useExternalEmojis: has(PermissionFlagsBits.UseExternalEmojis),
    mentionEveryone: has(PermissionFlagsBits.MentionEveryone),
    manageMessages: has(PermissionFlagsBits.ManageMessages),
  };
}

function json(
  body: BotChannelsResponse | BotRolesResponse | BotCommandsResponse,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function checkBearer(header: string | null, expected: string): boolean {
  if (!header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  const provided = Buffer.from(m[1]);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}

function buildChannelsResponse(client: SapphireClient, guildId: string): BotChannelsResponse {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return { kind: 'not_found', message: `bot is not in guild ${guildId}` };
  }
  const me = guild.members.me;
  if (!me) {
    return {
      kind: 'not_cached',
      message: 'bot GuildMember not cached yet — retry in a moment',
    };
  }

  const categories: BotCategoryInfo[] = [];
  const channels: BotChannelInfo[] = [];

  for (const ch of guild.channels.cache.values()) {
    if (ch.type === ChannelType.GuildCategory) {
      categories.push({ id: ch.id, name: ch.name, position: ch.position ?? 0 });
      continue;
    }
    if (isThread(ch.type)) continue;
    if (!('permissionsFor' in ch)) continue;

    const perms = computePerms(ch, me);
    const bitfield = ch.permissionsFor(me)?.bitfield ?? 0n;
    channels.push({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      typeLabel: TYPE_LABELS[ch.type] ?? `type_${ch.type}`,
      parentId: 'parentId' in ch ? (ch.parentId ?? null) : null,
      position: 'position' in ch ? (ch.position ?? 0) : 0,
      perms,
      effectiveBitfield: bitfield.toString(),
    });
  }

  categories.sort((a, b) => a.position - b.position);
  channels.sort((a, b) => a.position - b.position);

  return {
    kind: 'ok',
    guildId: guild.id,
    guildName: guild.name,
    botMemberTag: me.user.tag,
    categories,
    channels,
  };
}

function buildRolesResponse(client: SapphireClient, guildId: string): BotRolesResponse {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return { kind: 'not_found', message: `bot is not in guild ${guildId}` };
  }
  const roles: BotRoleInfo[] = [];
  for (const role of guild.roles.cache.values()) {
    roles.push({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      managed: role.managed,
      everyone: role.id === guild.id,
    });
  }
  // Highest position first — that's what users expect in a role picker.
  roles.sort((a, b) => b.position - a.position);
  return { kind: 'ok', guildId: guild.id, guildName: guild.name, roles };
}

function kindFromType(type: number): BotCommandKind {
  switch (type) {
    case ApplicationCommandType.ChatInput:
      return 'chat_input';
    case ApplicationCommandType.User:
      return 'user_context';
    case ApplicationCommandType.Message:
      return 'message_context';
    default:
      return 'unknown';
  }
}

function toCommandInfo(cmd: ApplicationCommand, scope: 'global' | 'guild'): BotCommandInfo {
  return {
    id: cmd.id,
    name: cmd.name,
    kind: kindFromType(cmd.type),
    scope,
    defaultMemberPermissions: cmd.defaultMemberPermissions?.bitfield.toString() ?? null,
    dmPermission: cmd.dmPermission ?? null,
    version: cmd.version,
  };
}

async function buildCommandsResponse(
  client: SapphireClient,
  guildId: string,
): Promise<BotCommandsResponse> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return { kind: 'not_found', message: `bot is not in guild ${guildId}` };
  }
  const app = client.application;
  if (!app) {
    return { kind: 'not_cached', message: 'client.application not ready yet — retry shortly' };
  }

  try {
    // Force a fresh fetch from Discord on each call. The internal API is
    // owner-only debugging, so the extra round-trips are fine and cache drift
    // would defeat the whole point of this view.
    const [globalCmds, guildCmds] = await Promise.all([
      app.commands.fetch(),
      guild.commands.fetch(),
    ]);
    const globalList: BotCommandInfo[] = [...globalCmds.values()].map((c) =>
      toCommandInfo(c, 'global'),
    );
    const guildList: BotCommandInfo[] = [...guildCmds.values()].map((c) =>
      toCommandInfo(c, 'guild'),
    );
    globalList.sort((a, b) => a.name.localeCompare(b.name));
    guildList.sort((a, b) => a.name.localeCompare(b.name));
    return {
      kind: 'ok',
      guildId: guild.id,
      guildName: guild.name,
      global: globalList,
      guildScoped: guildList,
    };
  } catch (err) {
    return {
      kind: 'unavailable',
      message: `failed to fetch commands: ${(err as Error).message}`,
    };
  }
}

export interface InternalApiServer {
  port: number;
  close: () => void;
}

export function startInternalApi(client: SapphireClient): InternalApiServer {
  const env = getEnv();
  const token = env.INTERNAL_API_TOKEN;
  if (!token) {
    throw new Error('startInternalApi called without INTERNAL_API_TOKEN set');
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: env.INTERNAL_API_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (!checkBearer(req.headers.get('authorization'), token)) {
        return json({ kind: 'unauthorized', message: 'unauthorized' }, 401);
      }

      if (req.method !== 'GET') {
        return json({ kind: 'unavailable', message: 'method not allowed' }, 405);
      }

      const channelsMatch = CHANNELS_ROUTE.exec(url.pathname);
      if (channelsMatch) {
        const body = buildChannelsResponse(client, channelsMatch[1]);
        const status = body.kind === 'ok' ? 200 : body.kind === 'not_cached' ? 503 : 404;
        return json(body, status);
      }

      const rolesMatch = ROLES_ROUTE.exec(url.pathname);
      if (rolesMatch) {
        const body = buildRolesResponse(client, rolesMatch[1]);
        const status = body.kind === 'ok' ? 200 : 404;
        return json(body, status);
      }

      const commandsMatch = COMMANDS_ROUTE.exec(url.pathname);
      if (commandsMatch) {
        const body = await buildCommandsResponse(client, commandsMatch[1]);
        const status =
          body.kind === 'ok'
            ? 200
            : body.kind === 'not_cached'
              ? 503
              : body.kind === 'unavailable'
                ? 502
                : 404;
        return json(body, status);
      }

      return json({ kind: 'not_found', message: 'not found' }, 404);
    },
  });

  return {
    port: Number(server.port),
    close: () => server.stop(true),
  };
}
