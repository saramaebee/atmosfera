import {
  type ClassifyResult,
  classifyText,
  loadDefaultModel,
  preprocess,
} from '@atmosfera/lang-classify';
import { Command } from '@sapphire/framework';
import { EmbedBuilder } from 'discord.js';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';

const SCOPE = { baseline: 'everyone' } as const;
registerScope('checklang', SCOPE);

const EMBED_COLOR = 0x6c8eef;
const MAX_INPUT_LEN = 1000;

export class ChecklangCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'checklang',
      // Public reply with an embed → SendMessages + EmbedLinks.
      requiredClientPermissions: ['SendMessages', 'EmbedLinks'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('checklang')
            .setDescription('Classify text as English, Spanish, mixed, other, or unknown.')
            .addStringOption((opt) =>
              opt
                .setName('text')
                .setDescription('The text to classify (up to 1000 chars).')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(MAX_INPUT_LEN),
            ),
          SCOPE,
        ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const text = interaction.options.getString('text', true);
    const model = loadDefaultModel();
    const result = classifyText(text, model);
    const cleaned = preprocess(text);
    const embed = buildEmbed(text, cleaned, result);
    // Public reply — the user explicitly asked for /checklang to broadcast.
    // Disallow mentions so a quoted text input can't ping anyone.
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  }
}

function buildEmbed(input: string, cleaned: string, result: ClassifyResult): EmbedBuilder {
  const labelDisplay = formatLabel(result);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Detected: ${labelDisplay}`)
    .setDescription(truncate(input, 500));

  const topPct = (result.scores[0].confidence * 100).toFixed(1);
  const runnerPct = (result.runnerUp.confidence * 100).toFixed(1);
  const margin = (result.scores[0].confidence - result.runnerUp.confidence) * 100;
  embed.addFields(
    {
      name: 'Confidence',
      value: `**${result.scores[0].label}** ${topPct}%  ·  runner-up **${result.runnerUp.label}** ${runnerPct}%  ·  margin ${margin.toFixed(1)}pt`,
      inline: false,
    },
    {
      name: 'Diagnostics',
      value: `Length after clean: ${result.lengthAfterClean} chars${result.abstainReason ? ` · Abstain: \`${result.abstainReason}\`` : ''}\nCleaned: ${cleaned ? `\`${truncate(cleaned, 200)}\`` : '_(empty after stripping)_'}`,
      inline: false,
    },
  );

  return embed;
}

function formatLabel(result: ClassifyResult): string {
  switch (result.label) {
    case 'en':
      return 'English';
    case 'es':
      return 'Spanish';
    case 'mixed':
      return 'Mixed EN/ES';
    case 'unknown':
      return 'Unknown';
    case 'other':
      return 'Other (non-en/es)';
    default:
      return result.label;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
