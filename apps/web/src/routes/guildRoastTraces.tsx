import { getDiscordUsers } from '@atmosfera/db';
import {
  type RoastTraceListEntry,
  type RoastTraceRow,
  getRoastTrace,
  listRoastTraces,
} from '@atmosfera/user-roast';
import { Hono } from 'hono';
import { resolveGuild } from '../middleware/requireGuild';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildSidebar } from '../views/components';
import { Layout } from '../views/layout';

export const guildRoastTracesRoutes = new Hono<AppEnv>();

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface ExplorationBlob {
  systemInstruction?: string;
  finalText?: string;
  iterations?: number;
  toolCalls?: ToolCall[];
}

interface SynthesisBlob {
  finalText?: string;
  iterations?: number;
  toolCalls?: ToolCall[];
  citedMessageIds?: string[];
}

interface HypothesisBlob {
  angles?: {
    title?: string;
    rationale?: string;
    searchHint?: {
      keyword?: string | null;
      partnerUserId?: string | null;
      channelId?: string | null;
    };
  }[];
}

interface FingerprintBlob {
  source?: string;
  totalMessages?: number;
  avgMessageLength?: number;
  activeChannels?: number;
  totalGuildChannels?: number;
  rank?: { position?: number; total?: number };
  topChannels?: { channelId: string; channelName: string | null; msgCount: number }[];
  hourHistogram?: number[];
  topPartners?: { userId: string; displayName: string | null; replies: number; mentions: number }[];
  lengthBucketHistogram?: number[];
}

interface KnobsBlob {
  hypothesizeMaxIterations?: number;
  synthesizeMaxIterations?: number;
  temperatureSharp?: number;
  temperatureBrutal?: number;
  thinkingBudget?: number;
  minToolCalls?: number;
  deemphasizeChannelDist?: boolean;
  source?: Record<string, 'env' | 'guild'>;
}

function tryParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function fmtTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function userLabel(
  map: Map<string, { username: string; globalName: string | null }>,
  id: string,
): string {
  const row = map.get(id);
  if (!row) return id;
  return row.globalName ?? row.username;
}

// ─── List page ─────────────────────────────────────────────────────────────

guildRoastTracesRoutes.get('/:guildId/debug/roasts', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'member');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;
  if (!session.isOwner) return c.text('Forbidden', 403);

  const traces = listRoastTraces({ guildId: guild.guildId, limit: 100 });
  const userIds = new Set<string>();
  for (const t of traces) {
    userIds.add(t.targetId);
    userIds.add(t.invokerId);
  }
  const users = getDiscordUsers(getWebDb(), [...userIds]);

  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="debug-roasts"
    />
  );

  return c.html(
    <Layout
      title={`${guild.name} · roast traces`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Roast traces</h1>
          <p class="lead">
            Per-invocation decision capture: hypothesis JSON, tool-loop transcripts, prompts as
            sent. Stored for 30 days alongside <code>roast_history</code>. Owner-only.
          </p>
        </div>
      </div>

      {traces.length === 0 ? (
        <div class="card">
          <p class="muted" style="margin:0;">
            No roast traces recorded for this guild yet. Run <code>/roast</code> once.
          </p>
        </div>
      ) : (
        <div class="card">
          <table class="data">
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>Target</th>
                <th>Invoker</th>
                <th>Tone / len</th>
                <th>Source</th>
                <th title="hypothesize tool calls / synthesize tool calls">Tools (hyp / syn)</th>
                <th>Angle titles</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <TraceRow guildId={guild.guildId} t={t} users={users} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>,
  );
});

function TraceRow(props: {
  guildId: string;
  t: RoastTraceListEntry;
  users: Map<string, { username: string; globalName: string | null }>;
}) {
  const { guildId, t, users } = props;
  const hypLow = t.hypothesisToolCalls <= 1;
  const synLow = t.synthesisToolCalls <= 1;
  return (
    <tr>
      <td class="mono" style="font-size:11px;white-space:nowrap;">
        {fmtTimestamp(t.createdAt)}
      </td>
      <td>{userLabel(users, t.targetId)}</td>
      <td>{userLabel(users, t.invokerId)}</td>
      <td>
        <span class="badge">{t.tone}</span> <span class="dim">{t.length}</span>
      </td>
      <td class="mono">{t.source ?? '—'}</td>
      <td class="mono">
        <span class={hypLow ? 'dim' : ''}>{t.hypothesisToolCalls}</span>
        <span class="dim"> / </span>
        <span class={synLow ? 'dim' : ''}>{t.synthesisToolCalls}</span>
      </td>
      <td style="font-size:12px;max-width:420px;">
        {t.angleTitles.length === 0 ? (
          <span class="dim">(none)</span>
        ) : (
          t.angleTitles.slice(0, 3).join(' · ')
        )}
      </td>
      <td>
        <a href={`/g/${guildId}/debug/roasts/${t.invocationId}`}>Open</a>
      </td>
    </tr>
  );
}

// ─── Detail page ───────────────────────────────────────────────────────────

guildRoastTracesRoutes.get('/:guildId/debug/roasts/:invocationId', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'member');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;
  if (!session.isOwner) return c.text('Forbidden', 403);

  const trace = getRoastTrace(c.req.param('invocationId'));
  if (!trace || trace.guildId !== guild.guildId) {
    return c.text('Trace not found', 404);
  }

  const users = getDiscordUsers(getWebDb(), [trace.targetId, trace.invokerId]);
  const fingerprint = tryParse<FingerprintBlob>(trace.fingerprintJson) ?? {};
  const hypothesis = tryParse<HypothesisBlob>(trace.hypothesisJson) ?? {};
  const exploration = tryParse<ExplorationBlob>(trace.hypothesisExplorationJson) ?? {};
  const synthesis = tryParse<SynthesisBlob>(trace.synthesisJson) ?? {};
  const knobs = tryParse<KnobsBlob>(trace.knobsJson) ?? {};

  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="debug-roasts"
    />
  );

  return c.html(
    <Layout
      title={`${guild.name} · trace ${trace.invocationId.slice(0, 8)}`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Roast trace</h1>
          <p class="lead">
            <span class="mono">{trace.invocationId}</span> · {fmtTimestamp(trace.createdAt)} ·
            target <strong>{userLabel(users, trace.targetId)}</strong> · invoker{' '}
            <strong>{userLabel(users, trace.invokerId)}</strong> ·{' '}
            <span class="badge">{trace.tone}</span> {trace.length} ·{' '}
            {fmtDuration(trace.totalDurationMs)} · {trace.totalMessagesFetched} msgs fetched
          </p>
          <p>
            <a href={`/g/${guild.guildId}/debug/roasts`}>← back to list</a>
          </p>
        </div>
      </div>

      <FinalRoastCard trace={trace} />
      <KnobsCard knobs={knobs} />
      <FingerprintCard trace={trace} fingerprint={fingerprint} />
      <HypothesisCard hypothesis={hypothesis} exploration={exploration} trace={trace} />
      <SynthesisCard synthesis={synthesis} trace={trace} />
    </Layout>,
  );
});

function FinalRoastCard(props: { trace: RoastTraceRow }) {
  return (
    <div class="card">
      <h2 style="margin-top:0;">Final roast</h2>
      <p style="white-space:pre-wrap;">{props.trace.finalRoastText || '(empty)'}</p>
    </div>
  );
}

function KnobsCard(props: { knobs: KnobsBlob }) {
  const k = props.knobs;
  const rows: { label: string; value: string; src: string }[] = [
    {
      label: 'hypothesize max iterations',
      value: String(k.hypothesizeMaxIterations ?? '—'),
      src: k.source?.hypothesizeMaxIterations ?? '—',
    },
    {
      label: 'synthesize max iterations',
      value: String(k.synthesizeMaxIterations ?? '—'),
      src: k.source?.synthesizeMaxIterations ?? '—',
    },
    {
      label: 'temperature (sharp)',
      value: String(k.temperatureSharp ?? '—'),
      src: k.source?.temperatureSharp ?? '—',
    },
    {
      label: 'temperature (brutal)',
      value: String(k.temperatureBrutal ?? '—'),
      src: k.source?.temperatureBrutal ?? '—',
    },
    {
      label: 'thinking budget',
      value: String(k.thinkingBudget ?? '—'),
      src: k.source?.thinkingBudget ?? '—',
    },
    {
      label: 'min tool calls (synth)',
      value: String(k.minToolCalls ?? '—'),
      src: k.source?.minToolCalls ?? '—',
    },
    {
      label: 'deemphasize channel dist',
      value: String(k.deemphasizeChannelDist ?? '—'),
      src: k.source?.deemphasizeChannelDist ?? '—',
    },
  ];
  return (
    <div class="card">
      <h2 style="margin-top:0;">Knobs in effect</h2>
      <p class="muted" style="margin-top:0;">
        Override source per knob: <code>guild</code> = per-guild override active; <code>env</code> =
        fell back to the <code>ROAST_*</code> env default.
      </p>
      <table class="data">
        <thead>
          <tr>
            <th>Knob</th>
            <th>Value</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td>{r.label}</td>
              <td class="mono">{r.value}</td>
              <td>
                <span class={`badge ${r.src === 'guild' ? 'badge-allow' : ''}`}>{r.src}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FingerprintCard(props: { trace: RoastTraceRow; fingerprint: FingerprintBlob }) {
  const f = props.fingerprint;
  const channels = f.topChannels ?? [];
  const partners = f.topPartners ?? [];
  return (
    <div class="card">
      <h2 style="margin-top:0;">Fingerprint</h2>
      <p class="muted" style="margin-top:0;">
        Stats fed into the prompts. The text block is the literal <code>summarizeFingerprint</code>{' '}
        output the model saw.
      </p>

      <details open>
        <summary>
          <strong>Summary text (verbatim to model)</strong>
        </summary>
        <pre class="mono" style="white-space:pre-wrap;font-size:12px;">
          {props.trace.fingerprintSummaryText}
        </pre>
      </details>

      <details>
        <summary>
          <strong>Stats</strong>
        </summary>
        <div class="row" style="gap:24px;flex-wrap:wrap;margin-top:8px;">
          <div>
            <div class="dim">source</div>
            <div class="mono">{f.source ?? '—'}</div>
          </div>
          <div>
            <div class="dim">messages</div>
            <div class="mono">{f.totalMessages ?? '—'}</div>
          </div>
          <div>
            <div class="dim">avg length</div>
            <div class="mono">{f.avgMessageLength?.toFixed?.(1) ?? '—'}</div>
          </div>
          <div>
            <div class="dim">active channels</div>
            <div class="mono">
              {f.activeChannels ?? '—'} / {f.totalGuildChannels ?? '—'}
            </div>
          </div>
          <div>
            <div class="dim">rank</div>
            <div class="mono">
              {f.rank?.position ?? '—'} / {f.rank?.total ?? '—'}
            </div>
          </div>
        </div>

        <h3>Top channels</h3>
        {channels.length === 0 ? (
          <p class="dim">(none)</p>
        ) : (
          <table class="data">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Msgs</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr>
                  <td>#{c.channelName ?? c.channelId}</td>
                  <td class="mono">{c.msgCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>Top partners</h3>
        {partners.length === 0 ? (
          <p class="dim">(none)</p>
        ) : (
          <table class="data">
            <thead>
              <tr>
                <th>User</th>
                <th>Replies</th>
                <th>Mentions</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr>
                  <td>{p.displayName ?? p.userId}</td>
                  <td class="mono">{p.replies}</td>
                  <td class="mono">{p.mentions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>

      <details>
        <summary>
          <strong>Raw JSON</strong>
        </summary>
        <pre
          class="mono"
          style="white-space:pre-wrap;font-size:11px;max-height:400px;overflow:auto;"
        >
          {JSON.stringify(f, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function HypothesisCard(props: {
  hypothesis: HypothesisBlob;
  exploration: ExplorationBlob;
  trace: RoastTraceRow;
}) {
  const angles = props.hypothesis.angles ?? [];
  const toolCalls = props.exploration.toolCalls ?? [];
  return (
    <div class="card">
      <h2 style="margin-top:0;">Hypothesize phase</h2>
      <p class="muted" style="margin-top:0;">
        Stage 1: exploration tool-loop. Stage 2: format the exploration into strict-schema angles.
      </p>

      <details>
        <summary>
          <strong>System instruction</strong>
        </summary>
        <pre class="mono" style="white-space:pre-wrap;font-size:12px;">
          {props.exploration.systemInstruction ?? '(none)'}
        </pre>
      </details>

      <details>
        <summary>
          <strong>Initial prompt</strong>
        </summary>
        <pre class="mono" style="white-space:pre-wrap;font-size:12px;">
          {props.trace.hypothesisPromptText}
        </pre>
      </details>

      <details open>
        <summary>
          <strong>Tool calls</strong> ({toolCalls.length}, {props.exploration.iterations ?? '—'}{' '}
          iterations)
        </summary>
        {toolCalls.length === 0 ? (
          <p class="dim">
            No tool calls — the model jumped straight to angles from the fingerprint. This is the
            signal you're looking for if angles feel surface-level.
          </p>
        ) : (
          <ToolCallList calls={toolCalls} />
        )}
      </details>

      <details open>
        <summary>
          <strong>Analyst summary (stage-1 output)</strong>
        </summary>
        <pre style="white-space:pre-wrap;font-size:13px;">
          {props.exploration.finalText ?? '(empty)'}
        </pre>
      </details>

      <details open>
        <summary>
          <strong>Final angles ({angles.length})</strong>
        </summary>
        {angles.length === 0 ? (
          <p class="dim">(none)</p>
        ) : (
          <ol>
            {angles.map((a) => (
              <li style="margin-bottom:10px;">
                <strong>{a.title}</strong>
                <div style="font-size:13px;">{a.rationale}</div>
                {a.searchHint &&
                (a.searchHint.keyword || a.searchHint.partnerUserId || a.searchHint.channelId) ? (
                  <div class="dim mono" style="font-size:11px;">
                    hint: {a.searchHint.keyword ? `keyword="${a.searchHint.keyword}" ` : ''}
                    {a.searchHint.partnerUserId ? `partner=${a.searchHint.partnerUserId} ` : ''}
                    {a.searchHint.channelId ? `channel=${a.searchHint.channelId}` : ''}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}

function SynthesisCard(props: { synthesis: SynthesisBlob; trace: RoastTraceRow }) {
  const toolCalls = props.synthesis.toolCalls ?? [];
  const cited = props.synthesis.citedMessageIds ?? [];
  return (
    <div class="card">
      <h2 style="margin-top:0;">Synthesize phase</h2>

      <details>
        <summary>
          <strong>System instruction</strong>
        </summary>
        <pre class="mono" style="white-space:pre-wrap;font-size:12px;">
          {props.trace.synthesisSystemText}
        </pre>
      </details>

      <details>
        <summary>
          <strong>Initial prompt</strong>
        </summary>
        <pre class="mono" style="white-space:pre-wrap;font-size:12px;">
          {props.trace.synthesisPromptText}
        </pre>
      </details>

      <details open>
        <summary>
          <strong>Tool calls</strong> ({toolCalls.length}, {props.synthesis.iterations ?? '—'}{' '}
          iterations)
        </summary>
        {toolCalls.length === 0 ? (
          <p class="dim">
            No synth tool calls — the model wrote the roast straight from hypothesis + fingerprint.
            Often the cause of generic / channel-monoculture roasts. Try bumping{' '}
            <code>roast_min_tool_calls</code>.
          </p>
        ) : (
          <ToolCallList calls={toolCalls} />
        )}
      </details>

      <details>
        <summary>
          <strong>Cited message IDs</strong> ({cited.length})
        </summary>
        {cited.length === 0 ? (
          <p class="dim">(none)</p>
        ) : (
          <ul class="mono" style="font-size:12px;">
            {cited.map((id) => (
              <li>{id}</li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function ToolCallList(props: { calls: ToolCall[] }) {
  return (
    <ol>
      {props.calls.map((call, idx) => {
        const argStr = JSON.stringify(call.args);
        const resultStr = JSON.stringify(call.result, null, 2);
        const truncated = resultStr.length > 2000;
        const displayed = truncated ? `${resultStr.slice(0, 2000)}…` : resultStr;
        return (
          <li style="margin-bottom:14px;">
            <div class="mono" style="font-size:12px;">
              <strong>{call.name}</strong>(<span class="dim">{argStr}</span>)
            </div>
            <details>
              <summary class="dim" style="font-size:11px;">
                result {truncated ? `(truncated, full size ${resultStr.length} chars)` : ''}
              </summary>
              <pre
                class="mono"
                style="white-space:pre-wrap;font-size:11px;max-height:300px;overflow:auto;"
              >
                {displayed}
              </pre>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
