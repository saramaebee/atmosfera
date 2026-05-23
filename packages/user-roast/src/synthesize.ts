import { getEnv } from '@atmosfera/config';
import { SAFETY_OFF, type SafetyPolicy, runToolLoop } from '@atmosfera/gemini';
import { HarmCategory, HarmProbability } from '@google/genai';
import type { Guild, Snowflake } from 'discord.js';
import { getEffectiveRoastKnobs } from './db/config';
import type { PriorRoast } from './db/roastHistory';
import { type Fingerprint, summarizeFingerprint } from './fingerprint';
import type { Hypothesis } from './hypothesize';
import type { RoastSession } from './sessionCache';
import { buildRoastTools } from './tools';

export type RoastTone = 'sharp' | 'brutal';
export type RoastLength = 'short' | 'medium' | 'long';

const LENGTH_GUIDANCE: Record<RoastLength, string> = {
  short:
    '- Be 2-3 sentences. Tight, punchy, one clear angle.\n- Cite at least ONE quoted snippet (use single quotes around exact phrases from their messages).',
  medium:
    '- Be 4-6 sentences. Comedy roast, not an essay.\n- Cite at least TWO actual quoted snippets (use single quotes around exact phrases from their messages).\n- Hit at least TWO distinct angles from the hypothesis list.',
  long: '- Be a single tight paragraph, roughly 8-12 sentences. Comedy roast, not an essay — pacing still matters.\n- Cite at least TWO actual quoted snippets (use single quotes around exact phrases from their messages).\n- Hit at least TWO distinct angles from the hypothesis list.',
};

/**
 * Per-tone policy applied to the final Gemini response. Gemini's server-side
 * filter is fully off (SAFETY_OFF); we enforce these locally so we can let
 * harassment-flavored roast content through while still catching identity
 * attacks, sexually explicit material, and dangerous instructions.
 */
const SHARP_POLICY: SafetyPolicy = {
  [HarmCategory.HARM_CATEGORY_HARASSMENT]: HarmProbability.HIGH,
  [HarmCategory.HARM_CATEGORY_HATE_SPEECH]: HarmProbability.MEDIUM,
  [HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT]: HarmProbability.MEDIUM,
  [HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT]: HarmProbability.HIGH,
};

const BRUTAL_POLICY: SafetyPolicy = {
  [HarmCategory.HARM_CATEGORY_HARASSMENT]: HarmProbability.HIGH,
  [HarmCategory.HARM_CATEGORY_HATE_SPEECH]: HarmProbability.MEDIUM,
  [HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT]: HarmProbability.MEDIUM,
  [HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT]: HarmProbability.HIGH,
};

function policyFor(tone: RoastTone): SafetyPolicy {
  return tone === 'brutal' ? BRUTAL_POLICY : SHARP_POLICY;
}

const TONE_GUIDANCE: Record<RoastTone, string> = {
  sharp: `Tone: SHARP. Comedic, observational, witty. Punch at behaviors and quirks — never at identity, appearance, mental health, or anything someone can't change. Cut clean. Make them laugh at themselves.`,
  brutal:
    'Tone: BRUTAL. The user opted into this. Comedy-roast style. Lean into the awkward specifics in the evidence. Still: nothing about identity (race, gender, sexuality, mental health, looks). Punch at behaviors, choices, and habits. Aim to make them cackle, not cry.',
};

function priorRoastsBlock(priorRoasts: PriorRoast[], fingerprint: Fingerprint): string {
  if (priorRoasts.length === 0) return '';
  const partnerIdSet = new Set(priorRoasts.flatMap((r) => r.referencedPartnerIds));
  if (partnerIdSet.size === 0) return '';
  const namedrops = fingerprint.topPartners
    .filter((p) => partnerIdSet.has(p.userId))
    .map((p) => p.displayName ?? p.userId);
  if (namedrops.length === 0) return '';
  return `\nPrior roasts of this target name-dropped: ${namedrops.join(', ')}.
If you must reference someone, prefer a partner NOT in this list — unless the evidence
for the listed partner is genuinely stronger this time.`;
}

const OPENER_VARIETY_RULE = `Vary your opening structure. Do NOT default to "Alright, [name]," or "Listen, [name],". Try: a sharp observation, a rhetorical question, a faux-confused premise, a callback to a specific quote, or just diving straight into the evidence. Different opener every time.`;

const SYSTEM_INSTRUCTION = (
  tone: RoastTone,
  length: RoastLength,
  targetDisplay: string,
  priorRoasts: PriorRoast[],
  fingerprint: Fingerprint,
) => `You are roasting ${targetDisplay} based on real Discord behavior.

You have tools to dig up evidence. Use them. Aim for 1-3 tool calls total before producing the final roast. Don't tool-call forever.

When you produce the FINAL ROAST, it must:
${LENGTH_GUIDANCE[length]}
- Open with a punch, not a preamble.
- If the evidence clearly identifies a specific person they interact with, name them by display name. Otherwise omit the partner reference entirely. NEVER write template placeholders like "[insert name]" or "[partner]" — if you don't have a real name, just don't mention anyone.
- Channel-choice jokes ("only posts in #general", "ignores every other channel") only land when the server actually has many channels they're avoiding. If the fingerprint shows the server has 1-2 channels total, do NOT use channel monoculture as an angle — it's just describing the room.

${OPENER_VARIETY_RULE}${priorRoastsBlock(priorRoasts, fingerprint)}

${TONE_GUIDANCE[tone]}

Output the final roast as plain text — no markdown headers, no bullet lists, no bracketed placeholders.`;

export interface RoastResult {
  text: string;
  toolCallCount: number;
  iterations: number;
  citedMessageIds: Snowflake[];
  toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[];
  /** Captures used to build the trace row in pipeline.ts. */
  systemInstruction: string;
  initialPrompt: string;
  fingerprintSummaryText: string;
}

export async function synthesizeRoast(params: {
  guild: Guild;
  session: RoastSession;
  fingerprint: Fingerprint;
  hypotheses: Hypothesis;
  targetDisplay: string;
  tone: RoastTone;
  length: RoastLength;
  priorRoasts?: PriorRoast[];
}): Promise<RoastResult> {
  const {
    guild,
    session,
    fingerprint,
    hypotheses,
    targetDisplay,
    tone,
    length,
    priorRoasts = [],
  } = params;
  const env = getEnv();
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const knobs = getEffectiveRoastKnobs(guild.id);
  const tools = buildRoastTools({ guild, session });

  const anglesText = hypotheses.angles
    .map((a, i) => `${i + 1}. ${a.title} — ${a.rationale}`)
    .join('\n');

  const fingerprintSummaryText = summarizeFingerprint(fingerprint, targetDisplay, {
    deemphasizeChannelDist: knobs.deemphasizeChannelDist,
  });

  const initialPrompt = `Target: ${targetDisplay}

Behavioral fingerprint:
${fingerprintSummaryText}

Angles to investigate (pick the juiciest, you don't need to use all):
${anglesText}

You have these tools available to gather evidence:
- searchTargetMessagesContaining(keyword, channelId?): find their messages matching a keyword
- getReplyChainBetween(partnerUserId, channelId?): pull back-and-forths with another user
- getMessagesNearTime(channelId, timestampIso, radius): context around a specific moment
- getTargetActivityProfile(): cached profile (cheap, no fetch)

Tool budget is bounded. Pick 1-3 calls that maximize roast material, then produce the final roast.`;

  const systemInstruction = SYSTEM_INSTRUCTION(
    tone,
    length,
    targetDisplay,
    priorRoasts,
    fingerprint,
  );

  const result = await runToolLoop({
    apiKey,
    systemInstruction,
    initialPrompt,
    tools,
    maxIterations: knobs.synthesizeMaxIterations,
    temperature: tone === 'brutal' ? knobs.temperatureBrutal : knobs.temperatureSharp,
    safetySettings: SAFETY_OFF,
    safetyPolicy: policyFor(tone),
    thinkingBudget: knobs.thinkingBudget,
    minToolCalls: knobs.minToolCalls,
  });

  const citedIds = new Set<Snowflake>();
  for (const call of result.toolCalls) {
    const r = call.result as
      | { matches?: { id: string }[]; messages?: { id: string }[] }
      | undefined;
    if (r?.matches) for (const m of r.matches) citedIds.add(m.id);
    if (r?.messages) for (const m of r.messages) citedIds.add(m.id);
  }

  return {
    text: result.finalText.trim(),
    toolCallCount: result.toolCalls.length,
    iterations: result.iterations,
    citedMessageIds: [...citedIds],
    toolCalls: result.toolCalls,
    systemInstruction,
    initialPrompt,
    fingerprintSummaryText,
  };
}
