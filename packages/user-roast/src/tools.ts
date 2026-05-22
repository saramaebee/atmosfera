import { getEnv } from '@atmosfera/config';
import type { ToolHandler } from '@atmosfera/gemini';
import { type FunctionDeclaration, Type } from '@google/genai';
import type { Guild, Snowflake } from 'discord.js';
import { getRoastOptoutState } from './db/config';
import { getHotChannelsForPair } from './db/interactions';
import {
  getMessagesByChannelTime,
  getReplyChainMessages,
  searchTargetMessagesText,
} from './db/messages';
import { deepenChannel, readableTextChannels } from './discordFetch';
import type { CachedMessage, RoastSession } from './sessionCache';

const MAX_RESULTS_PER_TOOL_CALL = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PAIRED_TURNS_BEFORE_PROBE = 3;

function retentionWindowMs(): number {
  return getEnv().MESSAGE_CONTENT_RETENTION_DAYS * DAY_MS;
}

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

  return [
    searchTargetMessagesContaining(guild, session),
    getReplyChainBetween(guild, session),
    getMessagesNearTime(guild, session),
    getTargetActivityProfile(session),
  ];
}

function searchTargetMessagesContaining(guild: Guild, session: RoastSession): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'searchTargetMessagesContaining',
    description:
      "Search the target user's messages from the past 7 days for a keyword. Returns up to 20 matching messages from the local store. No live Discord fetch.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        keyword: { type: Type.STRING, description: 'Case-insensitive substring to search for.' },
        channelId: {
          type: Type.STRING,
          description:
            'Optional. Limit search to a specific channel; otherwise search across all channels.',
        },
      },
      required: ['keyword'],
    },
  };

  return {
    name: declaration.name!,
    declaration,
    handler: async (args) => {
      const keyword = String(args.keyword ?? '');
      if (!keyword) return { error: 'keyword required' };
      const channelHint = args.channelId ? String(args.channelId) : null;

      const hits = searchTargetMessagesText({
        guildId: guild.id,
        authorId: session.targetUserId,
        keyword,
        channelId: channelHint,
        sinceMs: Date.now() - retentionWindowMs(),
        limit: MAX_RESULTS_PER_TOOL_CALL,
      });

      return {
        keyword,
        match_count: hits.length,
        matches: formatMessages(hits),
      };
    },
  };
}

function getReplyChainBetween(guild: Guild, session: RoastSession): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'getReplyChainBetween',
    description:
      'Return messages from the past 7 days where the target user replied to or was replied to by another user. Used to dig up back-and-forths.',
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
      const sinceMs = Date.now() - retentionWindowMs();

      // Local-first: ask SQLite directly.
      const localHits = getReplyChainMessages({
        guildId: guild.id,
        userA: session.targetUserId,
        userB: partnerId,
        sinceMs,
        channelId: channelHint,
        limit: MAX_RESULTS_PER_TOOL_CALL,
      });

      // If the chain is rich enough, return without probing Discord.
      if (localHits.length >= MIN_PAIRED_TURNS_BEFORE_PROBE) {
        return {
          partner_user_id: partnerId,
          match_count: localHits.length,
          matches: formatMessages(localHits),
          source: 'local',
          budget_remaining: session.budgetRemaining(),
        };
      }

      // Reply-chain is the only synthesis tool allowed to probe — chains
      // routinely span the partner's side that we may not have cached. Respect
      // partner opt-out: their messages were intentionally not stored, so
      // don't pull them via probe either.
      const partnerOptout = getRoastOptoutState(partnerId, guild.id);
      if (partnerOptout.optedOut) {
        return {
          partner_user_id: partnerId,
          match_count: localHits.length,
          matches: formatMessages(localHits),
          source: 'local',
          partner_unavailable: true,
          budget_remaining: session.budgetRemaining(),
        };
      }

      const candidateChannels: Snowflake[] = channelHint
        ? [channelHint]
        : getHotChannelsForPair(guild.id, session.targetUserId, partnerId, sinceMs, 3).map(
            (c) => c.channel_id,
          );

      if (candidateChannels.length === 0) {
        return {
          partner_user_id: partnerId,
          match_count: localHits.length,
          matches: formatMessages(localHits),
          source: 'local',
          budget_remaining: session.budgetRemaining(),
        };
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

      // Merge probe results (from session) with the local DB hits, dedup'd by id.
      const merged = new Map<string, CachedMessage>();
      for (const m of localHits) merged.set(m.id, m);
      for (const channelId of candidateChannels) {
        const batch = session.getBatch(channelId);
        if (!batch) continue;
        for (const m of batch.messages) if (involvesBoth(m)) merged.set(m.id, m);
      }
      const allHits = [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);

      return {
        partner_user_id: partnerId,
        match_count: allHits.length,
        matches: formatMessages(allHits),
        source: 'local+probe',
        budget_remaining: session.budgetRemaining(),
      };
    },
  };
}

function getMessagesNearTime(guild: Guild, session: RoastSession): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'getMessagesNearTime',
    description:
      'Return the context window around a specific message timestamp in a channel — up to N messages before/after, from the past 7 days. No live Discord fetch.',
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
      const radius = Math.min(Math.max(Number(args.radius ?? 5), 1), 10);
      if (!channelId || !Number.isFinite(ts))
        return { error: 'channelId and valid timestampIso required' };

      // Pull a window wide enough that there's almost always at least `radius`
      // messages on either side — 30 min covers normal conversation density.
      const WINDOW_MS = 30 * 60_000;
      const window = getMessagesByChannelTime({
        guildId: guild.id,
        channelId,
        fromMs: ts - WINDOW_MS,
        toMs: ts + WINDOW_MS,
        limit: 80,
      });

      if (window.length === 0) {
        return { channel_id: channelId, messages: [] };
      }

      // Find the message closest to the requested timestamp, then take `radius`
      // before and `radius` after.
      let closestIdx = 0;
      let closestDelta = Math.abs(window[0]!.createdAt - ts);
      for (let i = 1; i < window.length; i++) {
        const d = Math.abs(window[i]!.createdAt - ts);
        if (d < closestDelta) {
          closestDelta = d;
          closestIdx = i;
        }
      }
      const start = Math.max(0, closestIdx - radius);
      const end = Math.min(window.length, closestIdx + radius + 1);

      return {
        channel_id: channelId,
        messages: formatMessages(window.slice(start, end)),
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
