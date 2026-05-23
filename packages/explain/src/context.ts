import type { ExplainGuildRoleRow } from '@atmosfera/db';
import { getMessagesByChannelTime } from '@atmosfera/user-roast';
import type { GuildMember, GuildTextBasedChannel, Message } from 'discord.js';
import { listGuildRoles } from './db/roles';
import type { ContextMessage, ExplainLanguage, ExplainTier, TaggedTier } from './types';

const WINDOW_MS = 30 * 60 * 1000;
const MAX_BEFORE = 30;
const MAX_AFTER = 15;

/**
 * Surrounding-context fetch around a target message. Prefers the indexed
 * messages_recent table (populated by the messageActivity listener); falls
 * back to a live Discord fetch when the indexed slice is thin or empty
 * (target older than 7d, channel not indexed, etc.).
 *
 * Returns messages in chronological order with the target message guaranteed
 * to be included and flagged.
 */
export async function fetchSurroundingContext(params: {
  channel: GuildTextBasedChannel;
  targetMessage: Message;
}): Promise<RawContext> {
  const { channel, targetMessage } = params;
  const guildId = channel.guild.id;
  const channelId = channel.id;
  const targetTime = targetMessage.createdTimestamp;
  const fromMs = targetTime - WINDOW_MS;
  const toMs = targetTime + WINDOW_MS;

  const indexed = safeIndexedFetch({ guildId, channelId, fromMs, toMs });

  // If the indexed slice has < a handful of messages OR doesn't contain the
  // target, fall back to a live fetch. The live fetch returns ~50 messages
  // around the anchor in a single API call, which is plenty for both sides.
  let usedFallback = false;
  let messages: Array<{
    id: string;
    channelId: string;
    authorId: string;
    createdAt: number;
    content: string;
    isReply: boolean;
    replyToId: string | null;
  }> = indexed;

  const hasTarget = indexed.some((m) => m.id === targetMessage.id);
  if (indexed.length < 5 || !hasTarget) {
    const live = await liveFetchAround(channel, targetMessage.id);
    usedFallback = true;
    messages = mergeById(indexed, live);
  }

  // Sort chronologically and clamp around the target.
  messages.sort((a, b) => a.createdAt - b.createdAt);
  const targetIdx = messages.findIndex((m) => m.id === targetMessage.id);
  if (targetIdx === -1) {
    // Live fetch couldn't find the target (deleted? channel mismatch?) — return
    // just the target itself.
    messages = [
      {
        id: targetMessage.id,
        channelId: targetMessage.channelId,
        authorId: targetMessage.author.id,
        createdAt: targetMessage.createdTimestamp,
        content: targetMessage.content,
        isReply: targetMessage.reference?.messageId != null,
        replyToId: targetMessage.reference?.messageId ?? null,
      },
    ];
  } else {
    const before = messages.slice(Math.max(0, targetIdx - MAX_BEFORE), targetIdx);
    const after = messages.slice(targetIdx + 1, targetIdx + 1 + MAX_AFTER);
    messages = [...before, messages[targetIdx]!, ...after];
  }

  return { messages, targetMessageId: targetMessage.id, usedFallback };
}

interface RawContext {
  messages: Array<{
    id: string;
    channelId: string;
    authorId: string;
    createdAt: number;
    content: string;
    isReply: boolean;
    replyToId: string | null;
  }>;
  targetMessageId: string;
  usedFallback: boolean;
}

function safeIndexedFetch(params: {
  guildId: string;
  channelId: string;
  fromMs: number;
  toMs: number;
}): RawContext['messages'] {
  try {
    const rows = getMessagesByChannelTime({
      guildId: params.guildId,
      channelId: params.channelId,
      fromMs: params.fromMs,
      toMs: params.toMs,
      limit: MAX_BEFORE + MAX_AFTER + 5,
    });
    return rows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      authorId: r.authorId,
      createdAt: r.createdAt,
      content: r.content,
      isReply: r.isReply,
      replyToId: r.replyToId,
    }));
  } catch {
    // user-roast DB not initialized in this process (e.g. tests). Empty slice
    // forces the live-fetch path.
    return [];
  }
}

async function liveFetchAround(
  channel: GuildTextBasedChannel,
  anchorId: string,
): Promise<RawContext['messages']> {
  const fetched = await channel.messages.fetch({ around: anchorId, limit: 50 });
  return [...fetched.values()].map((m) => ({
    id: m.id,
    channelId: m.channelId,
    authorId: m.author.id,
    createdAt: m.createdTimestamp,
    content: m.content,
    isReply: m.reference?.messageId != null,
    replyToId: m.reference?.messageId ?? null,
  }));
}

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const x of a) map.set(x.id, x);
  for (const x of b) map.set(x.id, x);
  return [...map.values()];
}

/**
 * Annotate each context message with its author's authority tier derived from
 * the guild's explain_guild_roles configuration. Returns an empty role map
 * when nothing is configured — callers should adjust the prompt accordingly.
 */
export async function tagContextWithRoles(params: {
  channel: GuildTextBasedChannel;
  context: RawContext;
  targetMessage: Message;
}): Promise<{ messages: ContextMessage[]; hadRolesConfigured: boolean }> {
  const { channel, context, targetMessage } = params;
  const guild = channel.guild;
  const rolesByRoleId = new Map<string, { language: ExplainLanguage; tier: ExplainTier }>();
  const allRoles = listGuildRoles(guild.id);
  for (const r of allRoles) {
    rolesByRoleId.set(r.roleId, { language: r.language, tier: r.tier });
  }

  const authorIds = new Set<string>();
  for (const m of context.messages) authorIds.add(m.authorId);

  const memberByUser = new Map<string, GuildMember>();
  for (const id of authorIds) {
    const m = guild.members.cache.get(id);
    if (m) memberByUser.set(id, m);
  }
  // Fetch any uncached members in a single bulk call (skipped if all cached).
  const missing = [...authorIds].filter((id) => !memberByUser.has(id));
  if (missing.length > 0) {
    try {
      const fetched = await guild.members.fetch({ user: missing });
      for (const m of fetched.values()) memberByUser.set(m.id, m);
    } catch {
      // Bulk fetch can fail for various reasons (huge guild, missing intents).
      // Fall back to per-user fetches; tolerate per-id failures.
      for (const id of missing) {
        try {
          const m = await guild.members.fetch(id);
          memberByUser.set(id, m);
        } catch {
          /* leave unresolved */
        }
      }
    }
  }

  const messages: ContextMessage[] = context.messages.map((m) => {
    const member = memberByUser.get(m.authorId);
    const displayName = member?.displayName ?? `<user:${m.authorId}>`;
    const tier: TaggedTier = resolveTier(member, rolesByRoleId);
    return {
      id: m.id,
      channelId: m.channelId,
      authorId: m.authorId,
      authorDisplay: displayName,
      authorTier: tier,
      createdAt: m.createdAt,
      content: m.content,
      isReply: m.isReply,
      replyToId: m.replyToId,
      isTarget: m.id === targetMessage.id,
    };
  });

  return { messages, hadRolesConfigured: allRoles.length > 0 };
}

function resolveTier(
  member: GuildMember | undefined,
  roleMap: Map<string, { language: ExplainLanguage; tier: ExplainTier }>,
): TaggedTier {
  if (!member || roleMap.size === 0) return { kind: 'unknown' };
  const roleIds = member.roles.cache.keys();
  // Take the highest-authority mapping that applies (native > fluent > etc.).
  const TIER_RANK: Record<ExplainTier, number> = {
    native: 4,
    fluent: 3,
    intermediate: 2,
    beginner: 1,
  };
  let best: { language: ExplainLanguage; tier: ExplainTier } | null = null;
  for (const rid of roleIds) {
    const m = roleMap.get(rid);
    if (!m) continue;
    if (!best || TIER_RANK[m.tier] > TIER_RANK[best.tier]) best = m;
  }
  if (!best) return { kind: 'unknown' };
  return { kind: best.tier, language: best.language };
}
