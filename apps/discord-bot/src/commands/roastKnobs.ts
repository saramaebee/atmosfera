import { recordAuditEvent } from '@atmosfera/db';
import {
  type RoastKnobName,
  getEffectiveRoastKnobs,
  getGuildConfig,
  setRoastKnob,
} from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';
import { safeDeferReply, safeRespond } from '../lib/safeInteraction';

const SCOPE = { baseline: 'admin', ownerOverride: true } as const;
registerScope('roast-knobs', SCOPE);

/**
 * One Discord choice = one knob. Same column names as the web form so the
 * audit trail and trace JSON read identically across surfaces.
 */
const KNOBS: { key: RoastKnobName; kind: 'int' | 'float' | 'bool'; label: string }[] = [
  { key: 'roast_hypothesize_max_iterations', kind: 'int', label: 'hypothesize max iterations' },
  { key: 'roast_synthesize_max_iterations', kind: 'int', label: 'synthesize max iterations' },
  { key: 'roast_temperature_sharp', kind: 'float', label: 'temperature (sharp)' },
  { key: 'roast_temperature_brutal', kind: 'float', label: 'temperature (brutal)' },
  { key: 'roast_thinking_budget', kind: 'int', label: 'thinking budget' },
  { key: 'roast_min_tool_calls', kind: 'int', label: 'min tool calls (synth)' },
  { key: 'roast_deemphasize_channel_dist', kind: 'bool', label: 'deemphasize channel-dist' },
];

function currentOverride(
  cfg: ReturnType<typeof getGuildConfig>,
  name: RoastKnobName,
): number | boolean | null {
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

export class RoastKnobsCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'roast-knobs',
      description: 'Per-guild overrides for the roast pipeline (iteration caps, temperature, etc).',
      requiredClientPermissions: ['SendMessages'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('roast-knobs')
            .setDescription(
              'Per-guild overrides for the roast pipeline. Empty = show current values.',
            )
            .addStringOption((o) =>
              o
                .setName('knob')
                .setDescription('Which knob to set (omit to just view current values).')
                .setRequired(false)
                .addChoices(...KNOBS.map((k) => ({ name: k.label, value: k.key }))),
            )
            .addStringOption((o) =>
              o
                .setName('value')
                .setDescription(
                  'New value, or "reset" to clear the override. For bools use true/false.',
                )
                .setRequired(false),
            ),
          SCOPE,
        ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Server only.', ephemeral: true });
      return;
    }
    await safeDeferReply(interaction, { ephemeral: true });

    const knobName = interaction.options.getString('knob') as RoastKnobName | null;
    const rawValue = interaction.options.getString('value');

    if (knobName && rawValue !== null) {
      const def = KNOBS.find((k) => k.key === knobName);
      if (!def) {
        await safeRespond(interaction, {
          content: `Unknown knob: \`${knobName}\``,
          ephemeral: true,
        });
        return;
      }
      const parsed = parseValue(def, rawValue);
      if ('error' in parsed) {
        await safeRespond(interaction, { content: parsed.error, ephemeral: true });
        return;
      }

      const before = currentOverride(getGuildConfig(interaction.guildId), knobName);
      setRoastKnob(interaction.guildId, knobName, parsed.value);
      const after = currentOverride(getGuildConfig(interaction.guildId), knobName);

      recordAuditEvent(this.container.db, {
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        eventType: 'roast.config.update',
        subjectType: 'guild',
        subjectId: interaction.guildId,
        metadata: {
          via: 'slash',
          kind: 'knobs',
          knob: knobName,
          previous: before,
          next: after,
        },
      });
    }

    await safeRespond(interaction, {
      content: renderState(interaction.guildId),
      ephemeral: true,
    });
  }
}

function parseValue(
  def: { kind: 'int' | 'float' | 'bool' },
  raw: string,
): { value: number | boolean | null } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'reset' || trimmed.toLowerCase() === 'null') {
    return { value: null };
  }
  if (def.kind === 'bool') {
    if (['true', '1', 'yes', 'on'].includes(trimmed.toLowerCase())) return { value: true };
    if (['false', '0', 'no', 'off'].includes(trimmed.toLowerCase())) return { value: false };
    return { error: `Expected true/false, got \`${trimmed}\`.` };
  }
  const n = def.kind === 'int' ? Number.parseInt(trimmed, 10) : Number.parseFloat(trimmed);
  if (!Number.isFinite(n)) return { error: `Couldn't parse \`${trimmed}\` as a number.` };
  return { value: n };
}

function renderState(guildId: string): string {
  const cfg = getGuildConfig(guildId);
  const eff = getEffectiveRoastKnobs(guildId);
  const fmt = (
    label: string,
    override: number | boolean | null,
    effective: number | boolean,
  ): string => {
    const src = override == null ? '(env)' : '(guild)';
    const overrideStr = override == null ? '—' : String(override);
    return `- **${label}**: ${String(effective)} ${src}  _(override: ${overrideStr})_`;
  };
  const lines = [
    '**Roast knobs** (effective value, source, override):',
    fmt(
      'hypothesize max iterations',
      cfg.roast_hypothesize_max_iterations,
      eff.hypothesizeMaxIterations,
    ),
    fmt(
      'synthesize max iterations',
      cfg.roast_synthesize_max_iterations,
      eff.synthesizeMaxIterations,
    ),
    fmt('temperature (sharp)', cfg.roast_temperature_sharp, eff.temperatureSharp),
    fmt('temperature (brutal)', cfg.roast_temperature_brutal, eff.temperatureBrutal),
    fmt('thinking budget', cfg.roast_thinking_budget, eff.thinkingBudget),
    fmt('min tool calls (synth)', cfg.roast_min_tool_calls, eff.minToolCalls),
    fmt('deemphasize channel-dist', cfg.roast_deemphasize_channel_dist, eff.deemphasizeChannelDist),
  ];
  return lines.join('\n');
}
