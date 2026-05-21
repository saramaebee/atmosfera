import type { Snowflake } from 'discord.js';

/**
 * Per-roast in-memory cache. Lives only for the duration of one roast invocation
 * and is dropped (along with all fetched content) on completion or timeout.
 *
 * Nothing in this module touches disk or the persistent DB.
 */

export interface CachedMessage {
  id: Snowflake;
  channelId: Snowflake;
  authorId: Snowflake;
  createdAt: number;
  content: string;
  isReply: boolean;
  replyToId: Snowflake | null;
}

export interface ChannelBatch {
  channelId: Snowflake;
  messages: CachedMessage[];
  oldestId: Snowflake | null;
  exhausted: boolean;
}

export class RoastSession {
  public readonly invocationId: string;
  public readonly targetUserId: Snowflake;
  public readonly guildId: Snowflake;
  public fetchedCount = 0;
  public readonly fetchBudget: number;

  private readonly batches = new Map<Snowflake, ChannelBatch>();

  constructor(params: {
    invocationId: string;
    targetUserId: Snowflake;
    guildId: Snowflake;
    fetchBudget: number;
  }) {
    this.invocationId = params.invocationId;
    this.targetUserId = params.targetUserId;
    this.guildId = params.guildId;
    this.fetchBudget = params.fetchBudget;
  }

  budgetRemaining(): number {
    return Math.max(0, this.fetchBudget - this.fetchedCount);
  }

  getBatch(channelId: Snowflake): ChannelBatch | undefined {
    return this.batches.get(channelId);
  }

  appendBatch(channelId: Snowflake, msgs: CachedMessage[], exhausted: boolean): void {
    const existing = this.batches.get(channelId);
    if (existing) {
      const seen = new Set(existing.messages.map((m) => m.id));
      for (const m of msgs) if (!seen.has(m.id)) existing.messages.push(m);
      existing.messages.sort((a, b) => b.createdAt - a.createdAt);
      const last = existing.messages.at(-1);
      existing.oldestId = last ? last.id : existing.oldestId;
      existing.exhausted = existing.exhausted || exhausted;
    } else {
      const sorted = [...msgs].sort((a, b) => b.createdAt - a.createdAt);
      this.batches.set(channelId, {
        channelId,
        messages: sorted,
        oldestId: sorted.at(-1)?.id ?? null,
        exhausted,
      });
    }
    this.fetchedCount += msgs.length;
  }

  allTargetMessages(): CachedMessage[] {
    const out: CachedMessage[] = [];
    for (const batch of this.batches.values()) {
      for (const m of batch.messages) {
        if (m.authorId === this.targetUserId) out.push(m);
      }
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }

  allChannels(): Snowflake[] {
    return [...this.batches.keys()];
  }

  /** Permanently clear all cached content from memory. */
  destroy(): void {
    this.batches.clear();
    this.fetchedCount = 0;
  }
}
