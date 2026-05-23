import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import { resetEnvCacheForTests } from '@atmosfera/config';
import { setUserRoastDb } from './client';
import { getEffectiveRoastKnobs, setRoastKnob } from './config';
import {
  type RoastTraceRow,
  getRoastTrace,
  listRoastTraces,
  pruneRoastTracesOlderThan,
  recordRoastTrace,
} from './roastTrace';

function freshDb(): Database {
  const db = new Database(':memory:');
  // Mirrors the table + indexes from migration 0007. Keep in lockstep with
  // schema.ts — the e2e migrate-then-query test in db.test.ts is the
  // authority on that being correct; here we just need a working table.
  db.exec(`
    CREATE TABLE guild_config (
      guild_id TEXT PRIMARY KEY NOT NULL,
      indexing_enabled INTEGER NOT NULL DEFAULT 0,
      slash_enabled INTEGER NOT NULL DEFAULT 1,
      message_enabled INTEGER NOT NULL DEFAULT 1,
      brutal_allowed INTEGER NOT NULL DEFAULT 0,
      indexing_enabled_at INTEGER,
      roast_hypothesize_max_iterations INTEGER,
      roast_synthesize_max_iterations INTEGER,
      roast_temperature_sharp REAL,
      roast_temperature_brutal REAL,
      roast_thinking_budget INTEGER,
      roast_min_tool_calls INTEGER,
      roast_deemphasize_channel_dist INTEGER
    );
    CREATE TABLE roast_trace (
      invocation_id TEXT PRIMARY KEY NOT NULL,
      guild_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      invoker_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      tone TEXT NOT NULL,
      length TEXT NOT NULL,
      fingerprint_json TEXT NOT NULL,
      fingerprint_summary_text TEXT NOT NULL,
      hypothesis_prompt_text TEXT NOT NULL,
      hypothesis_exploration_json TEXT NOT NULL,
      hypothesis_json TEXT NOT NULL,
      synthesis_system_text TEXT NOT NULL,
      synthesis_prompt_text TEXT NOT NULL,
      synthesis_json TEXT NOT NULL,
      knobs_json TEXT NOT NULL,
      total_messages_fetched INTEGER NOT NULL,
      total_duration_ms INTEGER NOT NULL,
      final_roast_text TEXT NOT NULL
    );
    CREATE INDEX idx_roast_trace_guild_time ON roast_trace (guild_id, created_at);
    CREATE INDEX idx_roast_trace_created ON roast_trace (created_at);
  `);
  return db;
}

function baseRow(overrides: Partial<RoastTraceRow> = {}): RoastTraceRow {
  return {
    invocationId: 'inv-1',
    guildId: 'g1',
    targetId: 't1',
    invokerId: 'i1',
    createdAt: 1_700_000_000_000,
    tone: 'sharp',
    length: 'short',
    fingerprintJson: JSON.stringify({ source: 'index', topChannels: [], topPartners: [] }),
    fingerprintSummaryText: 'Target: foo\n…',
    hypothesisPromptText: 'explore prompt',
    hypothesisExplorationJson: JSON.stringify({
      systemInstruction: 'sys',
      finalText: 'analysis',
      iterations: 2,
      toolCalls: [{ name: 'searchMessages', args: { keyword: 'lol' }, result: { matches: [] } }],
    }),
    hypothesisJson: JSON.stringify({
      angles: [{ title: 'Angle A', rationale: 'because' }],
    }),
    synthesisSystemText: 'synth system',
    synthesisPromptText: 'synth prompt',
    synthesisJson: JSON.stringify({
      finalText: 'roast text',
      iterations: 1,
      toolCalls: [],
      citedMessageIds: [],
    }),
    knobsJson: JSON.stringify({}),
    totalMessagesFetched: 42,
    totalDurationMs: 1234,
    finalRoastText: 'roast text',
    ...overrides,
  };
}

describe('roastTrace', () => {
  beforeEach(() => {
    setUserRoastDb(freshDb());
  });

  it('round-trips a row', () => {
    const row = baseRow();
    recordRoastTrace(row);
    const got = getRoastTrace('inv-1');
    expect(got).toEqual(row);
  });

  it('returns null for unknown invocation', () => {
    expect(getRoastTrace('missing')).toBeNull();
  });

  it('lists traces newest-first, scoped by guild, with parsed counts', () => {
    recordRoastTrace(baseRow({ invocationId: 'a', createdAt: 1000, guildId: 'g1' }));
    recordRoastTrace(baseRow({ invocationId: 'b', createdAt: 3000, guildId: 'g1' }));
    recordRoastTrace(baseRow({ invocationId: 'c', createdAt: 2000, guildId: 'other' }));
    const rows = listRoastTraces({ guildId: 'g1' });
    expect(rows.map((r) => r.invocationId)).toEqual(['b', 'a']);
    // baseRow puts 1 tool call in the exploration JSON, 0 in synthesis.
    expect(rows[0]?.hypothesisToolCalls).toBe(1);
    expect(rows[0]?.synthesisToolCalls).toBe(0);
    expect(rows[0]?.angleTitles).toEqual(['Angle A']);
    expect(rows[0]?.source).toBe('index');
  });

  it('prunes by created_at', () => {
    recordRoastTrace(baseRow({ invocationId: 'old', createdAt: 1000 }));
    recordRoastTrace(baseRow({ invocationId: 'new', createdAt: 9000 }));
    const deleted = pruneRoastTracesOlderThan(5000);
    expect(deleted).toBe(1);
    expect(getRoastTrace('old')).toBeNull();
    expect(getRoastTrace('new')).not.toBeNull();
  });
});

describe('getEffectiveRoastKnobs', () => {
  beforeEach(() => {
    setUserRoastDb(freshDb());
    // Clear any ROAST_* env that prior tests may have leaked in.
    for (const k of [
      'ROAST_MAX_TOOL_ITERATIONS',
      'ROAST_HYPOTHESIZE_MAX_TOOL_ITERATIONS',
      'ROAST_TEMPERATURE_SHARP',
      'ROAST_TEMPERATURE_BRUTAL',
      'ROAST_THINKING_BUDGET',
      'ROAST_MIN_TOOL_CALLS',
      'ROAST_DEEMPHASIZE_CHANNEL_DIST',
    ]) {
      delete process.env[k];
    }
    resetEnvCacheForTests();
  });

  it('falls back to env defaults when no overrides set', () => {
    const eff = getEffectiveRoastKnobs('g1');
    expect(eff.synthesizeMaxIterations).toBe(3);
    expect(eff.hypothesizeMaxIterations).toBe(4);
    expect(eff.temperatureSharp).toBeCloseTo(0.95);
    expect(eff.temperatureBrutal).toBeCloseTo(1.0);
    expect(eff.minToolCalls).toBe(0);
    expect(eff.deemphasizeChannelDist).toBe(false);
    expect(eff.source.synthesizeMaxIterations).toBe('env');
    expect(eff.source.deemphasizeChannelDist).toBe('env');
  });

  it('honors per-guild override and reports source=guild', () => {
    setRoastKnob('g1', 'roast_synthesize_max_iterations', 7);
    setRoastKnob('g1', 'roast_deemphasize_channel_dist', true);
    const eff = getEffectiveRoastKnobs('g1');
    expect(eff.synthesizeMaxIterations).toBe(7);
    expect(eff.deemphasizeChannelDist).toBe(true);
    expect(eff.source.synthesizeMaxIterations).toBe('guild');
    expect(eff.source.deemphasizeChannelDist).toBe('guild');
    // Untouched knobs still fall back to env.
    expect(eff.source.temperatureSharp).toBe('env');
  });

  it('clearing an override (null) restores env fallback', () => {
    setRoastKnob('g1', 'roast_min_tool_calls', 5);
    expect(getEffectiveRoastKnobs('g1').minToolCalls).toBe(5);
    setRoastKnob('g1', 'roast_min_tool_calls', null);
    expect(getEffectiveRoastKnobs('g1').minToolCalls).toBe(0);
    expect(getEffectiveRoastKnobs('g1').source.minToolCalls).toBe('env');
  });
});
