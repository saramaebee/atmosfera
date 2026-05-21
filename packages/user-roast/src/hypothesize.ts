import { Type, type Schema } from '@google/genai';
import { generateJson } from '@atmosfera/gemini';
import { getEnv } from '@atmosfera/config';
import { z } from 'zod';
import type { PriorRoast } from './db/roastHistory';
import { summarizeFingerprint, type Fingerprint } from './fingerprint';
import type { CachedMessage } from './sessionCache';

const HypothesisSchema = z.object({
  angles: z
    .array(
      z.object({
        title: z.string().min(3).max(120),
        rationale: z.string().min(3).max(400),
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
          title: { type: Type.STRING, description: 'Short headline for the angle (max ~10 words).' },
          rationale: {
            type: Type.STRING,
            description: 'Why this is roast-worthy and what evidence to look for.',
          },
          searchHint: {
            type: Type.OBJECT,
            description: 'Hints for the next phase. At least one of keyword, partnerUserId, or channelId should be set.',
            properties: {
              keyword: { type: Type.STRING, nullable: true, description: 'Keyword to grep their messages for.' },
              partnerUserId: { type: Type.STRING, nullable: true, description: 'User ID of an interaction partner to dig into.' },
              channelId: { type: Type.STRING, nullable: true, description: 'Channel to scope the search to.' },
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

const SYSTEM_INSTRUCTION = `You are an analyst preparing roast material. Read the target's behavioral fingerprint and a small sample of their recent messages.

Your job is to identify 3-5 specific angles worth digging into for a roast. Each angle should be a concrete, falsifiable pattern that — if confirmed by more evidence — would land as a punchline. Avoid generic observations.

Output strict JSON matching the schema. No prose around it.

Good angles (specific, testable):
- "Talks about the same TV show in every channel — search 'severance'"
- "Replies to @alice constantly, never starts conversations with anyone else"
- "Every message starts with 'lol' or 'lmao' — search 'lol'"
- "Posting binges between 2-5am UTC every day this week"

Bad angles (generic, untestable):
- "Posts a lot"
- "Likes to use emojis"
- "Funny person"

Also: do not propose channel-monoculture angles ("only posts in #general", "ignores other channels") unless the fingerprint shows the server has many channels they're actively avoiding. A "1 of 1 channels" server makes that angle nonsense.`;

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
  lines.push('Pick fresh angles. If the same evidence keeps surfacing, find a different *frame* for it');
  lines.push('(e.g. instead of "posts at 3am" → "the 3am philosopher arc"). Genuinely new angle > recycled angle.');
  return lines.join('\n');
}

export async function generateHypotheses(params: {
  fingerprint: Fingerprint;
  targetDisplay: string;
  sampleMessages: CachedMessage[];
  priorRoasts?: PriorRoast[];
}): Promise<Hypothesis> {
  const { fingerprint, targetDisplay, sampleMessages, priorRoasts = [] } = params;
  const apiKey = getEnv().GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const sample = sampleMessages
    .slice(0, 40)
    .map((m) => `[${new Date(m.createdAt).toISOString()}] ${m.content}`)
    .join('\n');

  const avoidBlock = buildAvoidBlock(priorRoasts);

  const prompt = `${summarizeFingerprint(fingerprint, targetDisplay)}

Recent message sample (${Math.min(sampleMessages.length, 40)} messages):
${sample || '(no sample available)'}
${avoidBlock ? `\n${avoidBlock}\n` : ''}
Output the angles JSON now.`;

  return generateJson({
    apiKey,
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt,
    schema: HypothesisSchema,
    responseSchema: HYPOTHESIS_RESPONSE_SCHEMA,
    temperature: 0.9,
  });
}
