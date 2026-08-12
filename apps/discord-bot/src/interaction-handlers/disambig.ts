import { saveAlias, upsertCity } from '@atmosfera/db';
import { candidateToCityInput } from '@atmosfera/geocode';
import { InteractionHandler, InteractionHandlerTypes, container } from '@sapphire/framework';
import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';
import { buildRenderedMessage } from '../lib/charts';
import { buildMenuPayload, cityDisplayName } from '../lib/cities';
import {
  deleteSession,
  getSession,
  nextPendingSlot,
  updateSession,
} from '../lib/disambig-sessions';

interface ParsedCustomId {
  sessionId: string;
  slotIdx: number;
}

export class DisambigHandler extends InteractionHandler {
  public constructor(ctx: InteractionHandler.LoaderContext, options: InteractionHandler.Options) {
    super(ctx, { ...options, interactionHandlerType: InteractionHandlerTypes.SelectMenu });
  }

  public override parse(interaction: StringSelectMenuInteraction) {
    if (!interaction.customId.startsWith('atm:disambig:')) return this.none();
    const parts = interaction.customId.split(':');
    // atm:disambig:<sessionId>:<slotIdx>
    if (parts.length !== 4) return this.none();
    const sessionId = parts[2]!;
    const slotIdx = Number.parseInt(parts[3]!, 10);
    if (!Number.isFinite(slotIdx)) return this.none();
    return this.some<ParsedCustomId>({ sessionId, slotIdx });
  }

  public override async run(
    interaction: StringSelectMenuInteraction,
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

    const slot = session.slots[slotIdx];
    if (!slot || !slot.candidates) {
      await interaction.update({ content: 'This slot has already been resolved.', components: [] });
      return;
    }

    const pickedIdx = Number.parseInt(interaction.values[0] ?? '', 10);
    const candidate = slot.candidates[pickedIdx];
    if (!candidate) {
      await interaction.update({ content: 'Invalid selection.', components: [] });
      return;
    }

    // Upsert the city either way; only persist the alias if the user opted in.
    const city = upsertCity(container.db, candidateToCityInput(candidate));
    if (session.saveAlias) {
      saveAlias(container.db, {
        query: slot.query,
        scope: 'user',
        userId: session.userId,
        cityId: city.id,
      });
    }

    // Advance session state
    session.slots[slotIdx] = { query: slot.query, city, candidates: null };
    updateSession(sessionId, session);

    const next = nextPendingSlot(session);
    if (next !== null) {
      const payload = buildMenuPayload(sessionId, session, next);
      await interaction.update(payload);
      return;
    }

    // All slots resolved → render publicly.
    deleteSession(sessionId);

    const cities = session.slots.map((s) => s.city!);
    const lastPickMsg = session.saveAlias
      ? `Saved **${cityDisplayName(city)}** as your alias for **"${slot.query}"**. Generating chart…`
      : `Picked **${cityDisplayName(city)}** for **"${slot.query}"**. Generating chart…`;
    await interaction.update({
      content: lastPickMsg,
      components: [],
    });

    const rendered = await buildRenderedMessage({
      command: session.command,
      cities,
      chart: session.chart,
      radarMode: session.radarMode,
    });

    await interaction.followUp({ content: rendered.content, files: rendered.files });
  }
}
