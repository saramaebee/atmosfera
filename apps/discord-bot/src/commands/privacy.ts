import { PRIVACY_POLICY, PRIVACY_POLICY_VERSION } from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import { EmbedBuilder } from 'discord.js';
import { chatInputRegisterOptions } from '../lib/commandScope';

function bulletList(items: readonly string[]): string {
  return items.map((s) => `• ${s}`).join('\n');
}

export class PrivacyCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'privacy',
      description: "View atmosfera's user-roast privacy policy.",
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName('privacy')
          .setDescription('What atmosfera stores about Discord users, what it never stores, and your controls.'),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
      .setTitle('atmosfera — user-roast privacy')
      .setColor(0x88aaff)
      .addFields(
        { name: "What's stored", value: bulletList(PRIVACY_POLICY.stored) },
        { name: "What's never stored", value: bulletList(PRIVACY_POLICY.neverStored) },
        { name: 'Third parties', value: bulletList(PRIVACY_POLICY.thirdParties) },
        { name: 'Your controls', value: bulletList(PRIVACY_POLICY.controls) },
      )
      .setFooter({ text: `Policy version ${PRIVACY_POLICY_VERSION}` });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
