import { recordAuditEvent } from '@atmosfera/db';
import {
  type GuildConfig,
  type RoastKnobName,
  getEffectiveRoastKnobs,
  getGuildConfig,
  setRoastKnob,
} from '@atmosfera/user-roast';
import { Hono } from 'hono';
import { resolveGuild } from '../middleware/requireGuild';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildSidebar } from '../views/components';
import { Layout } from '../views/layout';

export const roastKnobsRoutes = new Hono<AppEnv>();

type KnobKind = 'int' | 'float' | 'bool';

interface KnobDef {
  name: RoastKnobName;
  kind: KnobKind;
  label: string;
  description: string;
  envName: string;
  min?: number;
  max?: number;
  step?: number;
}

const KNOBS: KnobDef[] = [
  {
    name: 'roast_hypothesize_max_iterations',
    kind: 'int',
    label: 'Hypothesize max iterations',
    description:
      'Tool-loop cap for the exploration phase. Higher = more chances for the model to probe before forming angles.',
    envName: 'ROAST_HYPOTHESIZE_MAX_TOOL_ITERATIONS',
    min: 1,
    max: 12,
  },
  {
    name: 'roast_synthesize_max_iterations',
    kind: 'int',
    label: 'Synthesize max iterations',
    description:
      'Tool-loop cap for the synthesis phase. Higher = more evidence gathered before final text.',
    envName: 'ROAST_MAX_TOOL_ITERATIONS',
    min: 1,
    max: 12,
  },
  {
    name: 'roast_temperature_sharp',
    kind: 'float',
    label: 'Temperature (sharp)',
    description: 'Sampling temperature for the sharp tone. Lower = drier; higher = wilder.',
    envName: 'ROAST_TEMPERATURE_SHARP',
    min: 0,
    max: 2,
    step: 0.05,
  },
  {
    name: 'roast_temperature_brutal',
    kind: 'float',
    label: 'Temperature (brutal)',
    description: 'Sampling temperature for the brutal tone.',
    envName: 'ROAST_TEMPERATURE_BRUTAL',
    min: 0,
    max: 2,
    step: 0.05,
  },
  {
    name: 'roast_thinking_budget',
    kind: 'int',
    label: 'Thinking budget',
    description:
      'Gemini 2.5 thinking budget (tokens). 0 disables. Lifting may give the model more headroom to plan its tool use.',
    envName: 'ROAST_THINKING_BUDGET',
    min: 0,
    max: 4096,
  },
  {
    name: 'roast_min_tool_calls',
    kind: 'int',
    label: 'Min tool calls (synth)',
    description:
      'Soft floor on synthesis tool calls. If the model tries to finish below this, the loop nudges it to dig deeper. 0 = no floor.',
    envName: 'ROAST_MIN_TOOL_CALLS',
    min: 0,
    max: 8,
  },
  {
    name: 'roast_deemphasize_channel_dist',
    kind: 'bool',
    label: 'Deemphasize channel-dist',
    description:
      'Omit the "ignores N channels" line + hour/length histograms from the fingerprint summary. Use to A/B whether the model stops reaching for channel-monoculture jokes.',
    envName: 'ROAST_DEEMPHASIZE_CHANNEL_DIST',
  },
];

function isKnobName(s: string): s is RoastKnobName {
  return KNOBS.some((k) => k.name === s);
}

function currentOverride(cfg: GuildConfig, name: RoastKnobName): number | boolean | null {
  switch (name) {
    case 'roast_hypothesize_max_iterations':
      return cfg.roast_hypothesize_max_iterations;
    case 'roast_synthesize_max_iterations':
      return cfg.roast_synthesize_max_iterations;
    case 'roast_temperature_sharp':
      return cfg.roast_temperature_sharp;
    case 'roast_temperature_brutal':
      return cfg.roast_temperature_brutal;
    case 'roast_thinking_budget':
      return cfg.roast_thinking_budget;
    case 'roast_min_tool_calls':
      return cfg.roast_min_tool_calls;
    case 'roast_deemphasize_channel_dist':
      return cfg.roast_deemphasize_channel_dist;
  }
}

function effectiveValue(
  name: RoastKnobName,
  eff: ReturnType<typeof getEffectiveRoastKnobs>,
): number | boolean {
  switch (name) {
    case 'roast_hypothesize_max_iterations':
      return eff.hypothesizeMaxIterations;
    case 'roast_synthesize_max_iterations':
      return eff.synthesizeMaxIterations;
    case 'roast_temperature_sharp':
      return eff.temperatureSharp;
    case 'roast_temperature_brutal':
      return eff.temperatureBrutal;
    case 'roast_thinking_budget':
      return eff.thinkingBudget;
    case 'roast_min_tool_calls':
      return eff.minToolCalls;
    case 'roast_deemphasize_channel_dist':
      return eff.deemphasizeChannelDist;
  }
}

function sourceFor(
  name: RoastKnobName,
  eff: ReturnType<typeof getEffectiveRoastKnobs>,
): 'env' | 'guild' {
  switch (name) {
    case 'roast_hypothesize_max_iterations':
      return eff.source.hypothesizeMaxIterations;
    case 'roast_synthesize_max_iterations':
      return eff.source.synthesizeMaxIterations;
    case 'roast_temperature_sharp':
      return eff.source.temperatureSharp;
    case 'roast_temperature_brutal':
      return eff.source.temperatureBrutal;
    case 'roast_thinking_budget':
      return eff.source.thinkingBudget;
    case 'roast_min_tool_calls':
      return eff.source.minToolCalls;
    case 'roast_deemphasize_channel_dist':
      return eff.source.deemphasizeChannelDist;
  }
}

// ─── Page ──────────────────────────────────────────────────────────────────

roastKnobsRoutes.get('/:guildId/debug/roast-knobs', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'member');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;
  if (!session.isOwner) return c.text('Forbidden', 403);

  const cfg = getGuildConfig(guild.guildId);
  const eff = getEffectiveRoastKnobs(guild.guildId);

  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="debug-roast-knobs"
    />
  );

  return c.html(
    <Layout
      title={`${guild.name} · roast knobs`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Roast knobs</h1>
          <p class="lead">
            Per-guild overrides for the user-roast pipeline. Empty = inherit the{' '}
            <code>ROAST_*</code> env default. Every change writes a <code>roast.config.update</code>{' '}
            audit event with <code>metadata.kind = "knobs"</code>.
          </p>
        </div>
      </div>

      {KNOBS.map((k) => (
        <KnobCard
          guildId={guild.guildId}
          def={k}
          override={currentOverride(cfg, k.name)}
          effective={effectiveValue(k.name, eff)}
          source={sourceFor(k.name, eff)}
        />
      ))}
    </Layout>,
  );
});

function KnobCard(props: {
  guildId: string;
  def: KnobDef;
  override: number | boolean | null;
  effective: number | boolean;
  source: 'env' | 'guild';
}) {
  const { guildId, def, override, effective, source } = props;
  return (
    <div class="card" id={`knob-${def.name}`}>
      <div class="row" style="justify-content:space-between;align-items:flex-start;">
        <div>
          <h2 style="margin:0;">{def.label}</h2>
          <p class="muted" style="margin:6px 0 0;">
            {def.description}
          </p>
          <p class="dim mono" style="font-size:11px;margin:4px 0 0;">
            column: {def.name} · env fallback: {def.envName}
          </p>
        </div>
        <div style="text-align:right;">
          <div class="dim" style="font-size:11px;">
            effective
          </div>
          <div class="mono">{String(effective)}</div>
          <div style="margin-top:4px;">
            <span class={`badge ${source === 'guild' ? 'badge-allow' : ''}`}>{source}</span>
          </div>
        </div>
      </div>

      <form
        method="post"
        action={`/g/${guildId}/debug/roast-knobs/${def.name}`}
        style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;"
      >
        {def.kind === 'bool' ? (
          <select name="value" aria-label={def.label}>
            <option value="" selected={override == null}>
              (inherit env)
            </option>
            <option value="true" selected={override === true}>
              true
            </option>
            <option value="false" selected={override === false}>
              false
            </option>
          </select>
        ) : (
          <input
            type="number"
            name="value"
            value={override == null ? '' : String(override)}
            placeholder="(inherit env)"
            min={def.min}
            max={def.max}
            step={def.kind === 'float' ? (def.step ?? 0.01) : 1}
            style="width:140px;"
          />
        )}
        <button type="submit">Save</button>
        <button
          type="submit"
          name="value"
          value=""
          formaction={`/g/${guildId}/debug/roast-knobs/${def.name}`}
          class="danger"
        >
          Reset to env
        </button>
      </form>
    </div>
  );
}

roastKnobsRoutes.post('/:guildId/debug/roast-knobs/:knob', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'member');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  if (!session.isOwner) return c.text('Forbidden', 403);

  const knobParam = c.req.param('knob');
  if (!isKnobName(knobParam)) return c.text('Unknown knob', 400);
  const def = KNOBS.find((k) => k.name === knobParam);
  if (!def) return c.text('Unknown knob', 400);

  const form = await c.req.formData();
  const raw = String(form.get('value') ?? '').trim();

  let next: number | boolean | null;
  if (raw === '') {
    next = null;
  } else if (def.kind === 'bool') {
    next = raw === 'true' || raw === '1';
  } else if (def.kind === 'int') {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return c.text('Bad integer', 400);
    if (def.min !== undefined && n < def.min) return c.text(`Min is ${def.min}`, 400);
    if (def.max !== undefined && n > def.max) return c.text(`Max is ${def.max}`, 400);
    next = n;
  } else {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return c.text('Bad number', 400);
    if (def.min !== undefined && n < def.min) return c.text(`Min is ${def.min}`, 400);
    if (def.max !== undefined && n > def.max) return c.text(`Max is ${def.max}`, 400);
    next = n;
  }

  const before = currentOverride(getGuildConfig(guild.guildId), def.name);
  setRoastKnob(guild.guildId, def.name, next);
  const after = currentOverride(getGuildConfig(guild.guildId), def.name);

  recordAuditEvent(getWebDb(), {
    guildId: guild.guildId,
    actorId: session.session.discordUserId,
    eventType: 'roast.config.update',
    subjectType: 'guild',
    subjectId: guild.guildId,
    metadata: {
      via: 'web',
      kind: 'knobs',
      knob: def.name,
      previous: before,
      next: after,
    },
  });

  return c.redirect(`/g/${guild.guildId}/debug/roast-knobs#knob-${def.name}`);
});
