import { getEnv } from '@atmosfera/config';
import { generateJson, runToolLoop } from '@atmosfera/gemini';
import { type Schema, Type } from '@google/genai';
import { z } from 'zod';
import type { PriorRoast } from './db/roastHistory';
import { type Fingerprint, summarizeFingerprint } from './fingerprint';
import { buildHypothesizeTools } from './hypothesizeTools';

const HypothesisSchema = z.object({
  angles: z
    .array(
      z.object({
        title: z.string().min(3).max(120),
        rationale: z.string().min(3).max(800),
        searchHint: z.object({
          keyword: z.string().nullable().optional(),
          partnerUserId: z.string().nullable().optional(),
          channelId: z.string().nullable().optional(),
        }),
      }),
    )
    .min(2)
    .max(6),
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;

const HYPOTHESIS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    angles: {
      type: Type.ARRAY,
      minItems: '3',
      maxItems: '5',
      items: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: 'Short headline for the angle (max ~10 words).',
          },
          rationale: {
            type: Type.STRING,
            description:
              'Why this is roast-worthy and what evidence to look for. 1-3 sentences, ~600 characters max.',
          },
          searchHint: {
            type: Type.OBJECT,
            description:
              'Hints for the next phase. At least one of keyword, partnerUserId, or channelId should be set.',
            properties: {
              keyword: {
                type: Type.STRING,
                nullable: true,
                description: 'Keyword to grep their messages for.',
              },
              partnerUserId: {
                type: Type.STRING,
                nullable: true,
                description: 'User ID of an interaction partner to dig into.',
              },
              channelId: {
                type: Type.STRING,
                nullable: true,
                description: 'Channel to scope the search to.',
              },
            },
          },
        },
        required: ['title', 'rationale', 'searchHint'],
        propertyOrdering: ['title', 'rationale', 'searchHint'],
      },
    },
  },
  required: ['angles'],
};

const EXPLORATION_SYSTEM_INSTRUCTION = `You are an analyst gathering raw material for a Discord roast. The target user is described by a behavioral fingerprint; you have read-only tools to explore their actual messages from the past 7 days.

Your job in THIS phase is to *explore*, not to write the angles JSON yet. Use the tools 2-4 times to validate or invalidate hunches from the fingerprint. Look for concrete, falsifiable patterns: recurring phrases, signature opinions, lopsided reply behavior, channel-specific personas, time-of-day quirks, "actually wrote a thesis on…" specimens.

When you've gathered enough evidence, output a short freeform summary (no JSON yet) describing 3-5 specific roast-worthy patterns you found, each with the evidence you'd cite (quoted phrases or message IDs from your tool results). Avoid generic observations like "posts a lot" or "uses emojis" — those aren't roastable.

Do NOT propose channel-monoculture angles ("only posts in #general") unless the fingerprint shows the server has many channels they're avoiding. A 1-or-2 channel server makes that angle nonsense.`;

const FORMATTER_SYSTEM_INSTRUCTION = `Convert the analyst's exploration findings into strict angles JSON matching the provided schema. Each angle must be concrete and falsifiable. Each searchHint should point the next phase at the evidence: a keyword to grep, a partner ID to dig into, or a channel ID to focus on. Output ONLY the JSON.`;

function buildAvoidBlock(priorRoasts: PriorRoast[]): string {
  if (priorRoasts.length === 0) return '';
  const angles = [...new Set(priorRoasts.flatMap((r) => r.angleTitles))].filter(Boolean);
  const keywords = [...new Set(priorRoasts.flatMap((r) => r.searchedKeywords))].filter(Boolean);
  const lines: string[] = [];
  lines.push(
    `You've recently roasted this target ${priorRoasts.length} time(s). Avoid repeating these angles and themes:`,
  );
  if (angles.length > 0) lines.push(`- Prior angle titles: ${angles.join(' | ')}`);
  if (keywords.length > 0) lines.push(`- Already-searched keywords: ${keywords.join(', ')}`);
  lines.push('');
  lines.push(
    'Pick fresh angles. If the same evidence keeps surfacing, find a different *frame* for it',
  );
  lines.push(
    '(e.g. instead of "posts at 3am" → "the 3am philosopher arc"). Genuinely new angle > recycled angle.',
  );
  return lines.join('\n');
}

export async function generateHypotheses(params: {
  guildId: string;
  targetUserId: string;
  fingerprint: Fingerprint;
  targetDisplay: string;
  priorRoasts?: PriorRoast[];
}): Promise<Hypothesis> {
  const { guildId, targetUserId, fingerprint, targetDisplay, priorRoasts = [] } = params;
  const env = getEnv();
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const tools = buildHypothesizeTools({ guildId, targetUserId });
  const avoidBlock = buildAvoidBlock(priorRoasts);

  const explorationPrompt = `Target: ${targetDisplay}

Behavioral fingerprint:
${summarizeFingerprint(fingerprint, targetDisplay)}
${avoidBlock ? `\n${avoidBlock}\n` : ''}
Tools available:
- getActivityOverview(): top channels + top reply partners. Call this first if you need orientation.
- getMessagesInChannel(channelId, limit?): recent messages by the target in one channel.
- searchMessages(keyword, channelId?): substring search across their messages.
- getLongestMessages(limit?): their longest messages, ordered by length.
- getMessagesByHourUtc(hoursUtc, limit?): messages posted at specific UTC hours (e.g. late-night).

Use 2-4 tool calls to validate concrete patterns. Then output a short summary of 3-5 roast-worthy angles with the specific evidence you'd cite.`;

  const exploration = await runToolLoop({
    apiKey,
    systemInstruction: EXPLORATION_SYSTEM_INSTRUCTION,
    initialPrompt: explorationPrompt,
    tools,
    maxIterations: env.ROAST_HYPOTHESIZE_MAX_TOOL_ITERATIONS,
    temperature: 0.9,
    thinkingBudget: 0,
  });

  // Stage 2: coerce the exploration findings into strict schema-validated JSON.
  // We don't try to parse JSON out of stage 1's freeform output — splitting the
  // two stages lets us use Gemini's responseSchema enforcement, which is far
  // more reliable than prompt-only JSON discipline inside a tool loop.
  const formatterPrompt = `Analyst's exploration findings for target "${targetDisplay}":

${exploration.finalText.trim() || '(analyst returned no findings — fall back to fingerprint-only angles)'}

Output 3-5 angles JSON now.`;

  return generateJson({
    apiKey,
    systemInstruction: FORMATTER_SYSTEM_INSTRUCTION,
    prompt: formatterPrompt,
    schema: HypothesisSchema,
    responseSchema: HYPOTHESIS_RESPONSE_SCHEMA,
    temperature: 0.7,
  });
}
