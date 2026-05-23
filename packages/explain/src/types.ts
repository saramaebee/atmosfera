import type { ExplainLanguage, ExplainTier } from '@atmosfera/db';

export type { ExplainLanguage, ExplainTier };

export interface ContextMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorDisplay: string;
  authorTier: TaggedTier;
  createdAt: number;
  content: string;
  isReply: boolean;
  replyToId: string | null;
  isTarget: boolean;
}

/**
 * Per-message authority tag derived from the author's roles intersected with
 * the guild's explain_guild_roles mapping. `unknown` is used when the author's
 * member couldn't be resolved or has no role mappings configured.
 */
export type TaggedTier =
  | { kind: 'native'; language: ExplainLanguage }
  | { kind: 'fluent'; language: ExplainLanguage }
  | { kind: 'intermediate'; language: ExplainLanguage }
  | { kind: 'beginner'; language: ExplainLanguage }
  | { kind: 'unknown' };

export interface ExplainPoint {
  heading: string;
  body: string;
}

export interface ExplainOutput {
  targetLanguage: 'english' | 'spanish' | 'mixed' | 'other';
  oneLineSummary: string;
  points: ExplainPoint[];
  /** Author IDs from the surrounding context whose phrasing the model leaned on. */
  nativeContextSources: string[];
  /** True when the guild has at least one role mapping; affects prompt wording. */
  hadNativeRolesConfigured: boolean;
  /** Diagnostic counts. */
  contextMessageCount: number;
}
