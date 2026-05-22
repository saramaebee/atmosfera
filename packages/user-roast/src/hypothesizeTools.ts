import { getEnv } from '@atmosfera/config';
import type { ToolHandler } from '@atmosfera/gemini';
import { type FunctionDeclaration, Type } from '@google/genai';
import { getTopPartnersForUser } from './db/interactions';
import {
  getLongestTargetMessages,
  getTargetChannelCounts,
  getTargetMessagesByHourUtc,
  getTargetMessagesInChannel,
  searchTargetMessagesText,
} from './db/messages';

/**
 * Read-only, local-only tools handed to the hypothesize phase. These let the
 * model explore the target's 7-day corpus before proposing roast angles,
 * instead of being handed a fixed `slice(0, 30)` of chronological messages.
 *
 * No tool here calls Discord. All queries hit `messages_recent` or the
 * `interactions` table. Cross-guild safety is enforced by `guildId` always
 * being the first WHERE clause in the underlying helpers.
 */

const MAX_RESULTS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

function retentionWindowMs(): number {
  return getEnv().MESSAGE_CONTENT_RETENTION_DAYS * DAY_MS;
}

function formatMessages(
  msgs: { id: string; channelId: string; authorId: string; createdAt: number; content: string }[],
) {
  return msgs.slice(0, MAX_RESULTS).map((m) => ({
    id: m.id,
    channel_id: m.channelId,
    ts: new Date(m.createdAt).toISOString(),
    content: m.content,
  }));
}

export function buildHypothesizeTools(params: {
  guildId: string;
  targetUserId: string;
}): ToolHandler[] {
  const { guildId, targetUserId } = params;

  return [
    getActivityOverview(guildId, targetUserId),
    getMessagesInChannel(guildId, targetUserId),
    searchMessages(guildId, targetUserId),
    getLongestMessages(guildId, targetUserId),
    getMessagesByHourUtc(guildId, targetUserId),
  ];
}

function getActivityOverview(guildId: string, targetUserId: string): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'getActivityOverview',
    description:
      "Cheap overview of the target's activity over the past 7 days: top channels with message counts and top reply/mention partners. For hour-of-day patterns, use getMessagesByHourUtc.",
    parameters: { type: Type.OBJECT, properties: {} },
  };

  return {
    name: declaration.name!,
    declaration,
    handler: async () => {
      const sinceMs = Date.now() - retentionWindowMs();
      const channels = getTargetChannelCounts({
        guildId,
        authorId: targetUserId,
        sinceMs,
        limit: 10,
      });
      const partners = getTopPartnersForUser(guildId, targetUserId, sinceMs, 10);
      return {
        target_user_id: targetUserId,
        top_channels: channels,
        top_partners: partners.map((p) => ({
          partner_user_id: p.partner_id,
          replies: p.replies,
          mentions: p.mentions,
          score: p.score,
        })),
      };
    },
  };
}

function getMessagesInChannel(guildId: string, targetUserId: string): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'getMessagesInChannel',
    description:
      "Return the target user's most recent messages in a specific channel (past 7 days). Useful for sampling their voice in one room.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        channelId: { type: Type.STRING, description: 'Discord channel ID.' },
        limit: {
          type: Type.NUMBER,
          description: 'Max messages to return (1-20). Default 10.',
        },
      },
      required: ['channelId'],
    },
  };

  return {
    name: declaration.name!,
    declaration,
    handler: async (args) => {
      const channelId = String(args.channelId ?? '');
      if (!channelId) return { error: 'channelId required' };
      const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), MAX_RESULTS);
      const msgs = getTargetMessagesInChannel({
        guildId,
        authorId: targetUserId,
        channelId,
        sinceMs: Date.now() - retentionWindowMs(),
        limit,
      });
      return {
        channel_id: channelId,
        match_count: msgs.length,
        messages: formatMessages(msgs),
      };
    },
  };
}

function searchMessages(guildId: string, targetUserId: string): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'searchMessages',
    description:
      "Case-insensitive substring search across the target user's messages from the past 7 days. Optionally limit to one channel.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        keyword: { type: Type.STRING, description: 'Substring to search for.' },
        channelId: {
          type: Type.STRING,
          description: 'Optional. Limit to one channel.',
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
        guildId,
        authorId: targetUserId,
        keyword,
        channelId: channelHint,
        sinceMs: Date.now() - retentionWindowMs(),
        limit: MAX_RESULTS,
      });
      return {
        keyword,
        match_count: hits.length,
        matches: formatMessages(hits),
      };
    },
  };
}

function getLongestMessages(guildId: string, targetUserId: string): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'getLongestMessages',
    description:
      "Return the target user's longest messages from the past 7 days, ordered by length descending. Surfaces 'they actually wrote a thesis on...' specimens.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: { type: Type.NUMBER, description: 'How many to return (1-15). Default 5.' },
      },
    },
  };

  return {
    name: declaration.name!,
    declaration,
    handler: async (args) => {
      const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 15);
      const msgs = getLongestTargetMessages({
        guildId,
        authorId: targetUserId,
        sinceMs: Date.now() - retentionWindowMs(),
        limit,
      });
      return {
        match_count: msgs.length,
        messages: formatMessages(msgs).map((m, i) => ({
          ...m,
          length: msgs[i]!.content.length,
        })),
      };
    },
  };
}

function getMessagesByHourUtc(guildId: string, targetUserId: string): ToolHandler {
  const declaration: FunctionDeclaration = {
    name: 'getMessagesByHourUtc',
    description:
      "Return the target's messages posted at specific UTC hours over the past 7 days. Pass e.g. [22,23,0,1,2,3,4] for 'late-night UTC' or [13,14,15,16,17] for 'workday afternoon UTC'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        hoursUtc: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER },
          description: 'Array of UTC hour integers in [0, 23].',
        },
        limit: { type: Type.NUMBER, description: 'Max messages to return (1-20). Default 15.' },
      },
      required: ['hoursUtc'],
    },
  };

  return {
    name: declaration.name!,
    declaration,
    handler: async (args) => {
      const rawHours = Array.isArray(args.hoursUtc) ? args.hoursUtc : [];
      const hoursUtc = rawHours.map((h) => Number(h)).filter((h) => Number.isInteger(h));
      if (hoursUtc.length === 0) return { error: 'hoursUtc must be a non-empty array of integers' };
      const limit = Math.min(Math.max(Number(args.limit ?? 15), 1), MAX_RESULTS);
      const msgs = getTargetMessagesByHourUtc({
        guildId,
        authorId: targetUserId,
        hoursUtc,
        sinceMs: Date.now() - retentionWindowMs(),
        limit,
      });
      return {
        hours_utc: hoursUtc,
        match_count: msgs.length,
        messages: formatMessages(msgs),
      };
    },
  };
}
