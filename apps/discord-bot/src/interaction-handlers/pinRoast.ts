import { getRoastHistoryById, pickZinger, pinRoast, shortId } from '@atmosfera/user-roast';
import { InteractionHandler, InteractionHandlerTypes, type Option } from '@sapphire/framework';
import {
  type ActionRow,
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ComponentType,
  type MessageActionRowComponent,
  type TopLevelComponent,
} from 'discord.js';

const PREFIX = 'roast:pin:';

export class PinRoastHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, { ...options, interactionHandlerType: InteractionHandlerTypes.Button });
  }

  public override parse(interaction: ButtonInteraction): Option<{ invocationId: string }> {
    if (!interaction.customId.startsWith(PREFIX)) return this.none();
    return this.some({ invocationId: interaction.customId.slice(PREFIX.length) });
  }

  public async run(
    interaction: ButtonInteraction,
    { invocationId }: { invocationId: string },
  ): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Server only.', ephemeral: true });
      return;
    }

    const history = getRoastHistoryById(invocationId);
    if (!history) {
      await interaction.reply({
        content: 'This roast has expired and can no longer be pinned.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.user.id !== history.targetId) {
      await interaction.reply({
        content: pickZinger(interaction.user.id, history.targetId),
        allowedMentions: { users: [interaction.user.id] },
      });
      return;
    }

    const description = interaction.message.embeds[0]?.description ?? '';
    if (!description.trim()) {
      await interaction.reply({
        content: "Can't read the roast text from this message.",
        ephemeral: true,
      });
      return;
    }

    const ok = pinRoast({
      invocationId,
      guildId: history.guildId,
      targetId: history.targetId,
      invokerId: history.invokerId,
      tone: history.tone,
      roastText: description,
      channelId: interaction.channelId,
      messageId: interaction.message.id,
      pinnedAt: Date.now(),
      roastCreatedAt: history.createdAt,
    });

    if (!ok) {
      await interaction.reply({
        content: `Already pinned. Find it with \`/pinned-roast get id:${shortId(invocationId)}\`.`,
        ephemeral: true,
      });
      return;
    }

    const disabledRow = disablePinButton(firstActionRow(interaction.message.components));
    if (disabledRow) {
      await interaction.update({ components: [disabledRow] });
    } else {
      await interaction.deferUpdate();
    }
    await interaction.followUp({
      content: `📌 Pinned. Recall it with \`/pinned-roast get id:${shortId(invocationId)}\`.`,
      ephemeral: true,
    });
  }
}

function firstActionRow(
  components: readonly TopLevelComponent[],
): ActionRow<MessageActionRowComponent> | undefined {
  return components.find(
    (c): c is ActionRow<MessageActionRowComponent> => c.type === ComponentType.ActionRow,
  );
}

function disablePinButton(
  row: ActionRow<MessageActionRowComponent> | undefined,
): ActionRowBuilder<ButtonBuilder> | null {
  if (!row) return null;
  const rebuilt = new ActionRowBuilder<ButtonBuilder>();
  for (const comp of row.components) {
    if (comp.type !== 2) continue;
    const btn = new ButtonBuilder()
      .setStyle(comp.style ?? ButtonStyle.Secondary)
      .setDisabled(false);
    if (comp.label) btn.setLabel(comp.label);
    if (comp.emoji) btn.setEmoji(comp.emoji);
    if (comp.customId?.startsWith(PREFIX)) {
      btn.setCustomId(comp.customId).setLabel('Pinned').setEmoji('📌').setDisabled(true);
    } else if (comp.customId) {
      btn.setCustomId(comp.customId);
    }
    rebuilt.addComponents(btn);
  }
  return rebuilt;
}
