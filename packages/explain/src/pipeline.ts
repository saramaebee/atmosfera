import { getEnv } from '@atmosfera/config';
import { generateJson } from '@atmosfera/gemini';
import type { GuildTextBasedChannel, Message } from 'discord.js';
import { fetchSurroundingContext, tagContextWithRoles } from './context';
import { SYSTEM_INSTRUCTION, buildPrompt } from './prompts';
import { ExplainResponseGeminiSchema, ExplainResponseSchema } from './schema';
import type { ExplainOutput } from './types';

export interface ExplainInput {
  channel: GuildTextBasedChannel;
  targetMessage: Message;
}

export async function runExplain(input: ExplainInput): Promise<ExplainOutput> {
  const env = getEnv();
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const raw = await fetchSurroundingContext({
    channel: input.channel,
    targetMessage: input.targetMessage,
  });
  const { messages, hadRolesConfigured } = await tagContextWithRoles({
    channel: input.channel,
    context: raw,
    targetMessage: input.targetMessage,
  });

  const prompt = buildPrompt({
    context: messages,
    targetMessageId: input.targetMessage.id,
    hadNativeRolesConfigured: hadRolesConfigured,
  });

  const response = await generateJson({
    apiKey,
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt,
    schema: ExplainResponseSchema,
    responseSchema: ExplainResponseGeminiSchema,
    temperature: 0.5,
  });

  // The model is told to output `<id:123>` author refs, but it sometimes wraps
  // or omits the angle brackets. Normalize to bare IDs and keep only those
  // present in the context.
  const knownIds = new Set(messages.map((m) => m.authorId));
  const rawSources = response.nativeContextSources ?? [];
  const nativeContextSources = Array.from(
    new Set(
      rawSources
        .map((s) => extractId(s))
        .filter((id): id is string => id != null && knownIds.has(id)),
    ),
  );

  return {
    targetLanguage: response.targetLanguage,
    oneLineSummary: response.oneLineSummary,
    points: response.points,
    nativeContextSources,
    hadNativeRolesConfigured: hadRolesConfigured,
    contextMessageCount: messages.length,
  };
}

function extractId(raw: string): string | null {
  const m = raw.match(/(\d{15,20})/);
  return m?.[1] ?? null;
}
