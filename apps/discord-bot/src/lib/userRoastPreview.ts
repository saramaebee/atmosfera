import type { RoastOutput } from '@atmosfera/user-roast';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';

const PREVIEW_TIMEOUT_MS = 60_000;

function buildEmbed(roast: RoastOutput, targetDisplay: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Roast preview — ${targetDisplay}`)
    .setDescription(roast.roast.text || '_(empty)_')
    .setFooter({
      text: `${roast.totalMessagesFetched} msgs fetched · ${roast.roast.toolCallCount} tool calls · source=${roast.fingerprint.source}`,
    })
    .setColor(0xff5577);
}

function buildButtons(invocationId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`roast:post:${invocationId}`)
      .setLabel('Post in channel')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`roast:discard:${invocationId}`)
      .setLabel('Discard')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function buildPublicRoastButtons(
  invocationId: string,
  voteCount = 0,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`roast:pin:${invocationId}`)
      .setEmoji('📌')
      .setLabel('Pin')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`roast:upvote:${invocationId}`)
      .setEmoji('👍')
      .setLabel(String(voteCount))
      .setStyle(ButtonStyle.Secondary),
  );
}

export interface PreviewParams {
  invokerId: string;
  invocationId: string;
  targetDisplay: string;
  roast: RoastOutput;
  interaction: ChatInputCommandInteraction;
}

/**
 * Send an ephemeral preview to the invoker with Post/Discard buttons.
 * Posts publicly on confirm, drops on discard or timeout.
 */
export async function sendUserRoastPreview(params: PreviewParams): Promise<void> {
  const { invokerId, invocationId, targetDisplay, roast, interaction } = params;
  const embed = buildEmbed(roast, targetDisplay);
  const buttons = buildButtons(invocationId);

  const previewMessage = (await interaction.editReply({
    embeds: [embed],
    components: [buttons],
  })) as Message;

  const collector = previewMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: PREVIEW_TIMEOUT_MS,
    filter: (i: ButtonInteraction) =>
      i.user.id === invokerId && i.customId.endsWith(invocationId),
  });

  collector.on('collect', async (btn) => {
    if (btn.customId.startsWith('roast:post:')) {
      await btn.deferUpdate();
      const publicEmbed = new EmbedBuilder()
        .setTitle(`Roast — ${targetDisplay}`)
        .setDescription(roast.roast.text)
        .setColor(0xff5577);
      const publicButtons = buildPublicRoastButtons(invocationId);

      if (interaction.channel?.isTextBased() && interaction.channel.isSendable()) {
        await interaction.channel.send({ embeds: [publicEmbed], components: [publicButtons] });
        await interaction.deleteReply().catch(() => {});
      }
      collector.stop('posted');
    } else if (btn.customId.startsWith('roast:discard:')) {
      const discardedEmbed = EmbedBuilder.from(embed.toJSON()).setFooter({ text: 'Discarded.' });
      await btn.update({ embeds: [discardedEmbed], components: [] }).catch(() => {});
      collector.stop('discarded');
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'time') {
      const timedOutEmbed = EmbedBuilder.from(embed.toJSON()).setFooter({ text: 'Preview timed out.' });
      await interaction
        .editReply({ embeds: [timedOutEmbed], components: [] })
        .catch(() => {});
    }
  });
}
