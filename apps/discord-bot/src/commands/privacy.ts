import {
  PRIVACY_AUDIT,
  PRIVACY_DATA,
  PRIVACY_POLICY_VERSION,
  PRIVACY_SUMMARY,
} from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import { EmbedBuilder } from 'discord.js';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';

const SCOPE = { baseline: 'everyone', protected: true } as const;
registerScope('privacy', SCOPE);

function bulletList(items: readonly string[]): string {
  return items.map((s) => `• ${s}`).join('\n');
}

export class PrivacyCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'privacy',
      description: "View atmosfera's privacy policy.",
      requiredClientPermissions: ['SendMessages', 'EmbedLinks'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('privacy')
            .setDescription("atmosfera's privacy policy — what's stored, sent, and your controls.")
            .addSubcommand((sub) =>
              sub
                .setName('summary')
                .setDescription('Top-level privacy summary (default — same as bare /privacy).'),
            )
            .addSubcommand((sub) =>
              sub
                .setName('data')
                .setDescription("What's tracked per message and what's never stored."),
            )
            .addSubcommand((sub) =>
              sub
                .setName('audit-log')
                .setDescription('What the bot logs about admin actions, and why.'),
            ),
          SCOPE,
        ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand(false);
    let embed: EmbedBuilder;

    switch (sub) {
      case 'data':
        embed = buildDataEmbed();
        break;
      case 'audit-log':
        embed = buildAuditEmbed();
        break;
      default:
        embed = buildSummaryEmbed();
        break;
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

function buildSummaryEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('atmosfera — privacy')
    .setColor(0x88aaff)
    .addFields(
      { name: 'Sent to third parties', value: bulletList(PRIVACY_SUMMARY.thirdParties) },
      { name: 'Retained on my own infrastructure', value: bulletList(PRIVACY_SUMMARY.retained) },
      { name: 'Never stored', value: bulletList(PRIVACY_SUMMARY.neverStored) },
      { name: 'Commitments', value: bulletList(PRIVACY_SUMMARY.commitments) },
    )
    .setFooter({
      text: `Policy version ${PRIVACY_POLICY_VERSION} · /privacy data · /privacy audit-log`,
    });
}

function buildDataEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('atmosfera — message data tracking')
    .setColor(0x88aaff)
    .setDescription(
      'When a server has `/roast-setup` enabled, the bot derives the following stats from each message and stores only the stats — never the content.',
    )
    .addFields(
      { name: 'Extracted and stored', value: bulletList(PRIVACY_DATA.extracted) },
      { name: 'Read in-memory, then discarded', value: bulletList(PRIVACY_DATA.readNotStored) },
      { name: 'Retention', value: bulletList(PRIVACY_DATA.retention) },
    )
    .setFooter({ text: `Policy version ${PRIVACY_POLICY_VERSION}` });
}

function buildAuditEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('atmosfera — admin audit log')
    .setColor(0x88aaff)
    .setDescription(
      'The bot keeps a tamper-evident record of admin actions so server staff can answer "who changed what, when?" later.',
    )
    .addFields(
      { name: 'Why we log it', value: bulletList(PRIVACY_AUDIT.whyLogged) },
      { name: "What's logged", value: bulletList(PRIVACY_AUDIT.whatLogged) },
      { name: "What's not logged", value: bulletList(PRIVACY_AUDIT.notLogged) },
      { name: 'Access + retention', value: bulletList(PRIVACY_AUDIT.access) },
    )
    .setFooter({ text: `Policy version ${PRIVACY_POLICY_VERSION}` });
}
