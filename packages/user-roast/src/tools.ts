import type { ToolHandler } from '@atmosfera/gemini';
import { type FunctionDeclaration, Type } from '@google/genai';
import type { Guild, Snowflake } from 'discord.js';
import { getGuildConfig } from './db/config';
import { getHotChannelsForPair } from './db/interactions';
import { deepenChannel, readableTextChannels } from './discordFetch';
import type { CachedMessage, RoastSession } from './sessionCache';

const MAX_RESULTS_PER_TOOL_CALL = 20;

function formatMessages(
  msgs: CachedMessage[],
): { id: string; channel_id: string; author_id: string; ts: string; content: string }[] {
  return msgs.slice(0, MAX_RESULTS_PER_TOOL_CALL).map((m) => ({
    id: m.id,
    channel_id: m.channelId,
    author_id: m.authorId,
    ts: new Date(m.createdAt).toISOString(),
    content: m.content,
  }));
}

export function buildRoastTools(params: { guild: Guild; session: RoastSession }): ToolHandler[] {
  const { guild, session } = params;
  const config = getGuildConfig(guild.id);

  return [
    searchTargetMessagesContaining(guild, session),
    getReplyChainBetween(guild, session, config.indexing_enabled),
    getMessagesNearTime(guild, session),
    getTargetActivityProfile(session),
  ];
}

function searchTargetMessagesContaining(guild: Guild, session: RoastSession): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'searchTargetMessagesContaining',
    description:
      "Search the target user's messages for a keyword. Will deepen channel history if the cache lacks hits. Returns up to 20 matching messages.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        keyword: { type: Type.STRING, description: 'Case-insensitive substring to search for.' },
        channelId: {
          type: Type.STRING,
          description:
            'Optional. Limit search to a specific channel; otherwise search all known channels.',
        },
      },
      required: ['keyword'],
    },
  };

  return {
    name: declaration.name!,
    declaration,
    handler: async (args) => {
      const keyword = String(args.keyword ?? '').toLowerCase();
      if (!keyword) return { error: 'keyword required' };
      const channelHint = args.channelId ? String(args.channelId) : null;

      const matchesTarget = (m: CachedMessage) =>
        m.authorId === session.targetUserId && m.content.toLowerCase().includes(keyword);

      const channels = channelHint
        ? readableTextChannels(guild).filter((c) => c.id === channelHint)
        : readableTextChannels(guild).filter((c) => session.getBatch(c.id));

      for (const channel of channels.slice(0, 5)) {
        await deepenChannel({
          channel,
          session,
          maxPages: 3,
          matchPredicate: matchesTarget,
          matchTarget: 5,
        });
        if (session.budgetRemaining() === 0) break;
      }

      const hits: CachedMessage[] = [];
      for (const batch of channels.map((c) => session.getBatch(c.id))) {
        if (!batch) continue;
        for (const m of batch.messages) {
          if (matchesTarget(m)) hits.push(m);
        }
      }
      hits.sort((a, b) => b.createdAt - a.createdAt);

      return {
        keyword,
        match_count: hits.length,
        matches: formatMessages(hits),
        budget_remaining: session.budgetRemaining(),
      };
    },
  };
}

function getReplyChainBetween(
  guild: Guild,
  session: RoastSession,
  indexingEnabled: boolean,
): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'getReplyChainBetween',
    description:
      'Return messages where the target user replied to or was replied to by another user. Used to dig up back-and-forths.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        partnerUserId: { type: Type.STRING, description: "The other user's ID." },
        channelId: { type: Type.STRING, description: 'Optional channel hint.' },
      },
      required: ['partnerUserId'],
    },
  };

  return {
    name: declaration.name!,
    declaration,
    handler: async (args) => {
      const partnerId = String(args.partnerUserId ?? '');
      if (!partnerId) return { error: 'partnerUserId required' };
      const channelHint = args.channelId ? String(args.channelId) : null;

      let candidateChannels: Snowflake[];
      if (channelHint) {
        candidateChannels = [channelHint];
      } else if (indexingEnabled) {
        const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
        candidateChannels = getHotChannelsForPair(
          guild.id,
          session.targetUserId,
          partnerId,
          sinceMs,
          3,
        ).map((c) => c.channel_id);
      } else {
        candidateChannels = session.allChannels();
      }

      const readable = readableTextChannels(guild);
      const channels = readable.filter((c) => candidateChannels.includes(c.id));

      const involvesBoth = (m: CachedMessage) => {
        const isFromTarget = m.authorId === session.targetUserId;
        const isFromPartner = m.authorId === partnerId;
        if (!isFromTarget && !isFromPartner) return false;
        const otherId = isFromTarget ? partnerId : session.targetUserId;
        const batch = session.getBatch(m.channelId);
        if (!batch) return false;
        const referenced = m.replyToId ? batch.messages.find((x) => x.id === m.replyToId) : null;
        return referenced?.authorId === otherId;
      };

      for (const channel of channels.slice(0, 3)) {
        await deepenChannel({
          channel,
          session,
          maxPages: 3,
          matchPredicate: involvesBoth,
          matchTarget: 6,
        });
        if (session.budgetRemaining() === 0) break;
      }

      const hits: CachedMessage[] = [];
      for (const channelId of candidateChannels) {
        const batch = session.getBatch(channelId);
        if (!batch) continue;
        for (const m of batch.messages) if (involvesBoth(m)) hits.push(m);
      }
      hits.sort((a, b) => b.createdAt - a.createdAt);

      return {
        partner_user_id: partnerId,
        match_count: hits.length,
        matches: formatMessages(hits),
        budget_remaining: session.budgetRemaining(),
      };
    },
  };
}

function getMessagesNearTime(guild: Guild, session: RoastSession): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'getMessagesNearTime',
    description:
      'Return the context window around a specific message timestamp in a channel — up to N messages before/after.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        channelId: { type: Type.STRING },
        timestampIso: { type: Type.STRING, description: 'ISO timestamp.' },
        radius: {
          type: Type.NUMBER,
          description: 'How many messages to include before+after. Max 10.',
        },
      },
      required: ['channelId', 'timestampIso'],
    },
  };

  return {
    name: declaration.name!,
    declaration,
    handler: async (args) => {
      const channelId = String(args.channelId ?? '');
      const ts = Date.parse(String(args.timestampIso ?? ''));
      const radius = Math.min(Number(args.radius ?? 5), 10);
      if (!channelId || !Number.isFinite(ts))
        return { error: 'channelId and valid timestampIso required' };

      const channel = readableTextChannels(guild).find((c) => c.id === channelId);
      if (!channel) return { error: 'channel not readable' };

      await deepenChannel({
        channel,
        session,
        maxPages: 2,
        matchPredicate: (m) => Math.abs(m.createdAt - ts) < 30 * 60_000,
        matchTarget: radius * 2,
      });

      const batch = session.getBatch(channelId);
      if (!batch) return { messages: [] };

      const sorted = [...batch.messages].sort((a, b) => a.createdAt - b.createdAt);
      const closestIdx = sorted.reduce((best, m, i) => {
        const dBest =
          best === -1 ? Number.POSITIVE_INFINITY : Math.abs(sorted[best]!.createdAt - ts);
        const dCurr = Math.abs(m.createdAt - ts);
        return dCurr < dBest ? i : best;
      }, -1);
      if (closestIdx === -1) return { messages: [] };

      const start = Math.max(0, closestIdx - radius);
      const end = Math.min(sorted.length, closestIdx + radius + 1);
      return {
        channel_id: channelId,
        messages: formatMessages(sorted.slice(start, end)),
        budget_remaining: session.budgetRemaining(),
      };
    },
  };
}

function getTargetActivityProfile(session: RoastSession): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'getTargetActivityProfile',
    description:
      'Return cached metadata about the target — channel distribution, posting hours, top partners. No API call, no fetch cost.',
    parameters: { type: Type.OBJECT, properties: {} },
  };

  return {
    name: declaration.name!,
    declaration,
    handler: async () => {
      const msgs = session.allTargetMessages();
      const channelCounts = new Map<string, number>();
      const hourHisto: number[] = new Array<number>(24).fill(0);
      for (const m of msgs) {
        channelCounts.set(m.channelId, (channelCounts.get(m.channelId) ?? 0) + 1);
        const h = new Date(m.createdAt).getUTCHours();
        hourHisto[h] = (hourHisto[h] ?? 0) + 1;
      }
      return {
        target_user_id: session.targetUserId,
        cached_target_messages: msgs.length,
        channels: [...channelCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([channelId, count]) => ({ channel_id: channelId, count })),
        hour_histogram_utc: hourHisto,
      };
    },
  };
}
