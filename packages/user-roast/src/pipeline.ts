import { randomUUID } from 'node:crypto';
import { getEnv } from '@atmosfera/config';
import type { Guild, GuildMember } from 'discord.js';
import { getEffectiveRoastKnobs } from './db/config';
import { getRecentRoastsForTarget, recordRoast } from './db/roastHistory';
import { recordRoastTrace } from './db/roastTrace';
import { type Fingerprint, buildFingerprint } from './fingerprint';
import { type Hypothesis, generateHypotheses } from './hypothesize';
import { RoastSession } from './sessionCache';
import { type RoastLength, type RoastResult, type RoastTone, synthesizeRoast } from './synthesize';

const DAY_MS = 24 * 60 * 60 * 1000;

function extractReferencedPartnerIds(
  roastText: string,
  topPartners: Fingerprint['topPartners'],
): string[] {
  const lower = roastText.toLowerCase();
  const ids = new Set<string>();
  for (const p of topPartners) {
    if (!p.displayName) continue;
    if (lower.includes(p.displayName.toLowerCase())) {
      ids.add(p.userId);
    }
  }
  return [...ids];
}

function extractSearchedKeywords(toolCalls: RoastResult['toolCalls']): string[] {
  const keywords = new Set<string>();
  for (const call of toolCalls) {
    if (call.name !== 'searchTargetMessagesContaining') continue;
    const kw = call.args.keyword;
    if (typeof kw === 'string' && kw.trim().length > 0) {
      keywords.add(kw.trim());
    }
  }
  return [...keywords];
}

export interface RoastInput {
  guild: Guild;
  target: GuildMember;
  invoker: GuildMember;
  tone: RoastTone;
  length: RoastLength;
}

export interface RoastOutput {
  invocationId: string;
  fingerprint: Fingerprint;
  hypotheses: Hypothesis;
  roast: RoastResult;
  totalMessagesFetched: number;
}

export async function runRoast(input: RoastInput): Promise<RoastOutput> {
  const { guild, target, invoker, tone, length } = input;
  const env = getEnv();
  const invocationId = randomUUID();
  const startedAt = Date.now();

  const session = new RoastSession({
    invocationId,
    targetUserId: target.id,
    guildId: guild.id,
    fetchBudget: env.ROAST_MAX_MESSAGES_FETCHED,
  });

  const timeoutHandle: { timedOut: boolean } = { timedOut: false };
  const timer = setTimeout(() => {
    timeoutHandle.timedOut = true;
  }, env.ROAST_TIMEOUT_MS);

  try {
    const fingerprint = await buildFingerprint({
      guild,
      targetUserId: target.id,
      invokerUserId: invoker.id,
      session,
    });

    const priorRoasts = (() => {
      try {
        return getRecentRoastsForTarget(
          guild.id,
          target.id,
          Date.now() - env.ROAST_HISTORY_RETENTION_DAYS * DAY_MS,
          5,
        );
      } catch {
        return [];
      }
    })();

    if (timeoutHandle.timedOut) throw new Error('Roast timed out before hypothesis');

    const hypothesisRun = await generateHypotheses({
      guildId: guild.id,
      targetUserId: target.id,
      fingerprint,
      targetDisplay: target.displayName,
      priorRoasts,
    });

    if (timeoutHandle.timedOut) throw new Error('Roast timed out before synthesis');

    const roast = await synthesizeRoast({
      guild,
      session,
      fingerprint,
      hypotheses: hypothesisRun.hypothesis,
      targetDisplay: target.displayName,
      tone,
      length,
      priorRoasts,
    });

    const totalDurationMs = Date.now() - startedAt;

    try {
      recordRoast({
        invocationId,
        guildId: guild.id,
        targetId: target.id,
        invokerId: invoker.id,
        tone,
        createdAt: Date.now(),
        angleTitles: hypothesisRun.hypothesis.angles.map((a) => a.title),
        referencedPartnerIds: extractReferencedPartnerIds(roast.text, fingerprint.topPartners),
        searchedKeywords: extractSearchedKeywords(roast.toolCalls),
      });
    } catch (err) {
      console.warn('[roast] recordRoast failed (non-fatal):', err);
    }

    try {
      const knobs = getEffectiveRoastKnobs(guild.id);
      recordRoastTrace({
        invocationId,
        guildId: guild.id,
        targetId: target.id,
        invokerId: invoker.id,
        createdAt: Date.now(),
        tone,
        length,
        fingerprintJson: JSON.stringify(fingerprint),
        fingerprintSummaryText: hypothesisRun.fingerprintSummaryText,
        hypothesisPromptText: hypothesisRun.explorationPrompt,
        hypothesisExplorationJson: JSON.stringify({
          systemInstruction: hypothesisRun.explorationSystemInstruction,
          finalText: hypothesisRun.exploration.finalText,
          iterations: hypothesisRun.exploration.iterations,
          toolCalls: hypothesisRun.exploration.toolCalls,
        }),
        hypothesisJson: JSON.stringify(hypothesisRun.hypothesis),
        synthesisSystemText: roast.systemInstruction,
        synthesisPromptText: roast.initialPrompt,
        synthesisJson: JSON.stringify({
          finalText: roast.text,
          iterations: roast.iterations,
          toolCalls: roast.toolCalls,
          citedMessageIds: roast.citedMessageIds,
        }),
        knobsJson: JSON.stringify(knobs),
        totalMessagesFetched: session.fetchedCount,
        totalDurationMs,
        finalRoastText: roast.text,
      });
    } catch (err) {
      console.warn('[roast] recordRoastTrace failed (non-fatal):', err);
    }

    return {
      invocationId,
      fingerprint,
      hypotheses: hypothesisRun.hypothesis,
      roast,
      totalMessagesFetched: session.fetchedCount,
    };
  } finally {
    clearTimeout(timer);
    session.destroy();
  }
}
