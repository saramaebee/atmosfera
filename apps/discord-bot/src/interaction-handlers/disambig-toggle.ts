import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { type ButtonInteraction, MessageFlags } from 'discord.js';
import { buildMenuPayload } from '../lib/cities';
import { getSession, updateSession } from '../lib/disambig-sessions';

interface ParsedCustomId {
  sessionId: string;
  slotIdx: number;
}

export class DisambigToggleHandler extends InteractionHandler {
  public constructor(ctx: InteractionHandler.LoaderContext, options: InteractionHandler.Options) {
    super(ctx, { ...options, interactionHandlerType: InteractionHandlerTypes.Button });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!interaction.customId.startsWith('atm:disambig-toggle:')) return this.none();
    const parts = interaction.customId.split(':');
    // atm:disambig-toggle:<sessionId>:<slotIdx>
    if (parts.length !== 4) return this.none();
    const sessionId = parts[2]!;
    const slotIdx = Number.parseInt(parts[3]!, 10);
    if (!Number.isFinite(slotIdx)) return this.none();
    return this.some<ParsedCustomId>({ sessionId, slotIdx });
  }

  public override async run(
    interaction: ButtonInteraction,
    { sessionId, slotIdx }: ParsedCustomId,
  ) {
    const session = getSession(sessionId);
    if (!session) {
      await interaction.update({
        content:
          'This disambiguation menu has expired. Run the command again to re-roll the choices.',
        components: [],
      });
      return;
    }
    if (interaction.user.id !== session.userId) {
      await interaction.reply({
        content: "You can't respond to someone else's disambiguation menu.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    session.saveAlias = !session.saveAlias;
    updateSession(sessionId, session);

    await interaction.update(buildMenuPayload(sessionId, session, slotIdx));
  }
}
