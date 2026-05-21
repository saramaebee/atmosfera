import {
  InteractionHandler,
  InteractionHandlerTypes,
  type Option,
} from '@sapphire/framework';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ActionRow,
  type ButtonInteraction,
  type MessageActionRowComponent,
  type TopLevelComponent,
} from 'discord.js';
import { upvotePinnedRoast } from '@atmosfera/user-roast';

const PREFIX = 'roast:upvote:';

export class UpvoteRoastHandler extends InteractionHandler {
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

    const count = upvotePinnedRoast(invocationId, interaction.user.id);
    if (count === null) {
      await interaction.reply({
        content: "This roast hasn't been pinned yet — only the target can pin it.",
        ephemeral: true,
      });
      return;
    }

    const updated = rebuildRowWithVoteCount(firstActionRow(interaction.message.components), count);
    if (updated) {
      await interaction.update({ components: [updated] });
    } else {
      await interaction.deferUpdate();
    }
  }
}

function firstActionRow(
  components: readonly TopLevelComponent[],
): ActionRow<MessageActionRowComponent> | undefined {
  return components.find(
    (c): c is ActionRow<MessageActionRowComponent> => c.type === ComponentType.ActionRow,
  );
}

function rebuildRowWithVoteCount(
  row: ActionRow<MessageActionRowComponent> | undefined,
  count: number,
): ActionRowBuilder<ButtonBuilder> | null {
  if (!row) return null;
  const rebuilt = new ActionRowBuilder<ButtonBuilder>();
  for (const comp of row.components) {
    if (comp.type !== 2) continue;
    const btn = new ButtonBuilder()
      .setStyle(comp.style ?? ButtonStyle.Secondary)
      .setDisabled(comp.disabled ?? false);
    if (comp.customId) btn.setCustomId(comp.customId);
    if (comp.emoji) btn.setEmoji(comp.emoji);
    if (comp.customId?.startsWith(PREFIX)) {
      btn.setLabel(String(count));
    } else if (comp.label) {
      btn.setLabel(comp.label);
    }
    rebuilt.addComponents(btn);
  }
  return rebuilt;
}
