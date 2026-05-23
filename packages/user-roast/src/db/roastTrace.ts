import type { Snowflake } from 'discord.js';
import { getDb } from './client';

export type RoastTraceTone = 'sharp' | 'brutal';
export type RoastTraceLength = 'short' | 'medium' | 'long';

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface ToolLoopRecord {
  finalText: string;
  iterations: number;
  toolCalls: ToolCallRecord[];
}

export interface RoastTraceRow {
  invocationId: string;
  guildId: string;
  targetId: string;
  invokerId: string;
  createdAt: number;
  tone: RoastTraceTone;
  length: RoastTraceLength;
  fingerprintJson: string;
  fingerprintSummaryText: string;
  hypothesisPromptText: string;
  hypothesisExplorationJson: string;
  hypothesisJson: string;
  synthesisSystemText: string;
  synthesisPromptText: string;
  synthesisJson: string;
  knobsJson: string;
  totalMessagesFetched: number;
  totalDurationMs: number;
  finalRoastText: string;
}

export function recordRoastTrace(row: RoastTraceRow): void {
  getDb()
    .prepare(
      `INSERT INTO roast_trace
         (invocation_id, guild_id, target_id, invoker_id, created_at, tone, length,
          fingerprint_json, fingerprint_summary_text,
          hypothesis_prompt_text, hypothesis_exploration_json, hypothesis_json,
          synthesis_system_text, synthesis_prompt_text, synthesis_json,
          knobs_json, total_messages_fetched, total_duration_ms, final_roast_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.invocationId,
      row.guildId,
      row.targetId,
      row.invokerId,
      row.createdAt,
      row.tone,
      row.length,
      row.fingerprintJson,
      row.fingerprintSummaryText,
      row.hypothesisPromptText,
      row.hypothesisExplorationJson,
      row.hypothesisJson,
      row.synthesisSystemText,
      row.synthesisPromptText,
      row.synthesisJson,
      row.knobsJson,
      row.totalMessagesFetched,
      row.totalDurationMs,
      row.finalRoastText,
    );
}

interface DbRow {
  invocation_id: string;
  guild_id: string;
  target_id: string;
  invoker_id: string;
  created_at: number;
  tone: RoastTraceTone;
  length: RoastTraceLength;
  fingerprint_json: string;
  fingerprint_summary_text: string;
  hypothesis_prompt_text: string;
  hypothesis_exploration_json: string;
  hypothesis_json: string;
  synthesis_system_text: string;
  synthesis_prompt_text: string;
  synthesis_json: string;
  knobs_json: string;
  total_messages_fetched: number;
  total_duration_ms: number;
  final_roast_text: string;
}

function fromDbRow(r: DbRow): RoastTraceRow {
  return {
    invocationId: r.invocation_id,
    guildId: r.guild_id,
    targetId: r.target_id,
    invokerId: r.invoker_id,
    createdAt: r.created_at,
    tone: r.tone,
    length: r.length,
    fingerprintJson: r.fingerprint_json,
    fingerprintSummaryText: r.fingerprint_summary_text,
    hypothesisPromptText: r.hypothesis_prompt_text,
    hypothesisExplorationJson: r.hypothesis_exploration_json,
    hypothesisJson: r.hypothesis_json,
    synthesisSystemText: r.synthesis_system_text,
    synthesisPromptText: r.synthesis_prompt_text,
    synthesisJson: r.synthesis_json,
    knobsJson: r.knobs_json,
    totalMessagesFetched: r.total_messages_fetched,
    totalDurationMs: r.total_duration_ms,
    finalRoastText: r.final_roast_text,
  };
}

export function getRoastTrace(invocationId: string): RoastTraceRow | null {
  const row = getDb()
    .prepare('SELECT * FROM roast_trace WHERE invocation_id = ?')
    .get(invocationId) as DbRow | undefined;
  return row ? fromDbRow(row) : null;
}

export interface RoastTraceListEntry {
  invocationId: string;
  createdAt: number;
  targetId: Snowflake;
  invokerId: Snowflake;
  tone: RoastTraceTone;
  length: RoastTraceLength;
  totalMessagesFetched: number;
  /** Counts pulled from the JSON blobs for the list view. */
  hypothesisToolCalls: number;
  synthesisToolCalls: number;
  angleTitles: string[];
  source: 'index' | 'live-probe' | null;
  finalRoastTextPreview: string;
}

function safeParse<T = unknown>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function summarizeForList(r: DbRow): RoastTraceListEntry {
  const exploration = safeParse<{ toolCalls?: unknown[] }>(r.hypothesis_exploration_json);
  const synthesis = safeParse<{ toolCalls?: unknown[] }>(r.synthesis_json);
  const hypothesis = safeParse<{ angles?: { title?: string }[] }>(r.hypothesis_json);
  const fingerprint = safeParse<{ source?: 'index' | 'live-probe' }>(r.fingerprint_json);
  return {
    invocationId: r.invocation_id,
    createdAt: r.created_at,
    targetId: r.target_id,
    invokerId: r.invoker_id,
    tone: r.tone,
    length: r.length,
    totalMessagesFetched: r.total_messages_fetched,
    hypothesisToolCalls: Array.isArray(exploration?.toolCalls) ? exploration.toolCalls.length : 0,
    synthesisToolCalls: Array.isArray(synthesis?.toolCalls) ? synthesis.toolCalls.length : 0,
    angleTitles: Array.isArray(hypothesis?.angles)
      ? hypothesis.angles.map((a) => a?.title ?? '').filter(Boolean)
      : [],
    source: fingerprint?.source ?? null,
    finalRoastTextPreview:
      r.final_roast_text.length > 240 ? `${r.final_roast_text.slice(0, 240)}…` : r.final_roast_text,
  };
}

export interface ListRoastTracesParams {
  guildId: string;
  limit?: number;
  sinceMs?: number;
  targetId?: Snowflake;
  invokerId?: Snowflake;
}

export function listRoastTraces(params: ListRoastTracesParams): RoastTraceListEntry[] {
  const { guildId, limit = 50, sinceMs, targetId, invokerId } = params;
  const where: string[] = ['guild_id = ?'];
  const args: (string | number)[] = [guildId];
  if (sinceMs !== undefined) {
    where.push('created_at >= ?');
    args.push(sinceMs);
  }
  if (targetId) {
    where.push('target_id = ?');
    args.push(targetId);
  }
  if (invokerId) {
    where.push('invoker_id = ?');
    args.push(invokerId);
  }
  args.push(limit);
  const rows = getDb()
    .prepare(
      `SELECT * FROM roast_trace WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...args) as DbRow[];
  return rows.map(summarizeForList);
}

export function pruneRoastTracesOlderThan(beforeMs: number): number {
  const r = getDb().prepare('DELETE FROM roast_trace WHERE created_at < ?').run(beforeMs);
  return r.changes;
}
