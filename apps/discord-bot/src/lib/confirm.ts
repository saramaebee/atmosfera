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

const DEFAULT_TIMEOUT_MS = 60_000;

export type ConfirmOutcome = 'confirmed' | 'cancelled' | 'timeout';

export interface ConfirmParams {
  interaction: ChatInputCommandInteraction;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  customIdSuffix: string;
  timeoutMs?: number;
  onConfirmText?: string;
  onCancelText?: string;
  onTimeoutText?: string;
}

export async function sendConfirm(params: ConfirmParams): Promise<ConfirmOutcome> {
  const {
    interaction,
    title,
    body,
    confirmLabel,
    cancelLabel,
    customIdSuffix,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onConfirmText,
    onCancelText,
    onTimeoutText = 'Confirmation timed out — no changes made.',
  } = params;

  const embed = new EmbedBuilder().setTitle(title).setDescription(body).setColor(0xff5577);
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm:yes:${customIdSuffix}`)
      .setLabel(confirmLabel)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`confirm:no:${customIdSuffix}`)
      .setLabel(cancelLabel)
      .setStyle(ButtonStyle.Secondary),
  );

  const reply = (await interaction.editReply({
    embeds: [embed],
    components: [buttons],
  })) as Message;

  return new Promise<ConfirmOutcome>((resolve) => {
    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: timeoutMs,
      filter: (i: ButtonInteraction) =>
        i.user.id === interaction.user.id && i.customId.endsWith(customIdSuffix),
    });

    let settled: ConfirmOutcome | null = null;

    collector.on('collect', async (btn) => {
      if (btn.customId.startsWith('confirm:yes:')) {
        settled = 'confirmed';
        await btn
          .update({
            embeds: [EmbedBuilder.from(embed.toJSON()).setFooter({ text: onConfirmText ?? 'Confirmed.' })],
            components: [],
          })
          .catch(() => {});
        collector.stop('confirmed');
      } else if (btn.customId.startsWith('confirm:no:')) {
        settled = 'cancelled';
        await btn
          .update({
            embeds: [EmbedBuilder.from(embed.toJSON()).setFooter({ text: onCancelText ?? 'Cancelled.' })],
            components: [],
          })
          .catch(() => {});
        collector.stop('cancelled');
      }
    });

    collector.on('end', async () => {
      if (settled === null) {
        await interaction
          .editReply({
            embeds: [EmbedBuilder.from(embed.toJSON()).setFooter({ text: onTimeoutText })],
            components: [],
          })
          .catch(() => {});
        resolve('timeout');
      } else {
        resolve(settled);
      }
    });
  });
}
