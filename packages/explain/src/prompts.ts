import type { ContextMessage, TaggedTier } from './types';

export const SYSTEM_INSTRUCTION = `You are atmosfera, a Discord bot helping language learners on a Spanish/English language-exchange server.

When a user asks you to explain a specific message, your job is to break down what is interesting, complex, or potentially confusing about it for a learner. You are NOT correcting the speaker — they may be a native speaker writing naturally. Focus on what a learner of the target language would benefit from understanding.

Output a structured response covering 2-4 specific points. Each point should be one concrete concept (a grammar feature, a vocab choice, register, regional usage, an idiom, a sound/spelling pattern, etc.) — not a generic "this is Spanish."

Use the surrounding context. Other users in the channel may have already explained things or shown how the phrase is used. Lean on their phrasing when it's clearly authoritative. Cite the user IDs of native-speaker explanations you drew from in nativeContextSources.

Be warm and concise. Don't lecture. Don't repeat the target message back. Don't apologize. If the message is too short or too ordinary to have anything interesting to explain (e.g. just "ok" or "lol"), say so plainly in a single point — don't invent depth that isn't there.

Output ONLY valid JSON matching the response schema.`;

export function buildPrompt(params: {
  context: ContextMessage[];
  targetMessageId: string;
  hadNativeRolesConfigured: boolean;
}): string {
  const { context, targetMessageId, hadNativeRolesConfigured } = params;
  const target = context.find((m) => m.id === targetMessageId);
  if (!target) {
    // Should be impossible — fetchSurroundingContext guarantees inclusion.
    throw new Error('Target message missing from context');
  }

  const lines: string[] = [];
  lines.push(
    hadNativeRolesConfigured
      ? "This server has configured native-speaker role mappings. Author lines below are tagged with the author's language proficiency where known — treat [native-en] / [native-es] lines as authoritative on their native language; weight their phrasing higher when synthesizing explanations."
      : 'This server has not configured native-speaker roles. Infer authority from message content: depth, confidence, and natural phrasing. Use your own knowledge as the primary source.',
  );
  lines.push('');
  lines.push('--- Surrounding conversation (chronological) ---');
  for (const m of context) {
    const tag = formatTier(m.authorTier);
    const marker = m.isTarget ? '>>> TARGET MESSAGE <<<' : '';
    const reply = m.isReply && m.replyToId ? ` (reply to ${m.replyToId})` : '';
    lines.push(
      `[${tag}] ${m.authorDisplay} <id:${m.authorId}> @ ${new Date(m.createdAt).toISOString()}${reply} ${marker}`,
    );
    // Indent the content one level so the meta line stays scannable.
    for (const line of m.content.split('\n')) lines.push(`  ${line}`);
  }
  lines.push('--- end conversation ---');
  lines.push('');
  lines.push(
    'Explain the TARGET MESSAGE. Identify the language, give a one-line summary of what is interesting about it, and 2-4 specific concepts worth breaking down for a learner. If you drew on a specific message from the surrounding context, list the author <id:...> values in nativeContextSources.',
  );

  return lines.join('\n');
}

function formatTier(t: TaggedTier): string {
  if (t.kind === 'unknown') return 'unknown';
  return `${t.kind}-${t.language}`;
}
