import { getEnv } from '@atmosfera/config';
import { generateJson } from '@atmosfera/gemini';
import { type Schema, Type } from '@google/genai';
import { z } from 'zod';
import type { PriorRoast } from './db/roastHistory';
import { type Fingerprint, summarizeFingerprint } from './fingerprint';
import type { CachedMessage } from './sessionCache';

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
              'Hints for the next phase. **Prefer setting `keyword`** — content angles produce funnier roasts than pure pattern angles, and at least half of the angles you return must set `keyword`. Set `partnerUserId` or `channelId` only when the angle is genuinely about who they talk to or where they hang out, not just to scope the search.',
            properties: {
              keyword: {
                type: Type.STRING,
                nullable: true,
                description:
                  "Specific term to grep the target's messages for. Pick a word distinctive to them — not a generic word like 'the' or 'i'. This is the field that turns an angle into something verifiable.",
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

const SYSTEM_INSTRUCTION = `You are an analyst preparing roast material. Read the target's behavioral fingerprint and a small sample of their recent messages.

Your job is to identify 3-5 specific angles worth digging into for a roast. Each angle should be a concrete, falsifiable pattern that — if confirmed by more evidence — would land as a punchline. Avoid generic observations.

Output strict JSON matching the schema. No prose around it.

**Balance pattern angles with content angles.** "Patterns" = channel choice, posting hours, reply targets, partner identity. "Content" = things they actually say — recurring words, weird hot takes, specific subjects, distinctive phrasings. AT LEAST HALF of the angles you propose MUST be content-driven and MUST set \`searchHint.keyword\` to a specific term you'd grep their messages for. A list of angles that's all "they post at 3am to alice in #general" is a worse list than one that mixes patterns with "they keep typing 'literally' as filler".

Good angles (specific, testable, mixing pattern + content):
- "Keeps using the word 'literally' as filler — search 'literally'"
- "Posts essay-length hot takes about a specific TV show — search 'severance'"
- "Replies to @alice constantly with monosyllabic 'yeah's — search keyword 'yeah' scoped to that partner"
- "Every message opens with 'lol' or 'lmao' — search 'lol'"
- "Posting binges between 2-5am UTC every day this week" (one pattern angle is fine, not the whole list)

Bad angles (generic, untestable, or pattern-only):
- "Posts a lot"
- "Likes to use emojis"
- "Funny person"
- "Only posts in one channel" — by itself this is just describing the room.

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
  lines.push(
    'Pick fresh angles. If the same evidence keeps surfacing, find a different *frame* for it',
  );
  lines.push(
    '(e.g. instead of "posts at 3am" → "the 3am philosopher arc"). Genuinely new angle > recycled angle.',
  );
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
