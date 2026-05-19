import type { City } from '@atmosfera/db';
import { type ResolveResult, formatCandidate, resolveCity } from '@atmosfera/geocode';
import { container } from '@sapphire/framework';
import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import type { CommandKind, CompareChartChoice } from './charts';
import {
  type DisambigSession,
  type QuerySlot,
  createSession,
  nextPendingSlot,
} from './disambig-sessions';

export function cityDisplayName(city: City): string {
  const parts = [city.canonicalName];
  if (city.region) parts.push(city.region);
  parts.push(city.country);
  return parts.join(', ');
}

/**
 * Resolve N city queries for a slash command.
 *  - All resolved → return the Cities in input order. Caller defers + renders.
 *  - Any 'none' → ephemeral error reply listing each failure; return null.
 *  - Any 'ambiguous' (and no 'none') → spin up a disambig session, send an
 *    ephemeral StringSelectMenu for the first ambiguous slot; return null.
 *    The InteractionHandler will pick up from there.
 *
 * resolveCity is fast (<1s typical) so the slash command interaction can be
 * replied to directly without a defer.
 */
export async function resolveCitiesOrPrompt(
  interaction: ChatInputCommandInteraction,
  command: CommandKind,
  queries: string[],
  chart?: CompareChartChoice,
): Promise<City[] | null> {
  const results = await Promise.all(
    queries.map((q) =>
      resolveCity(container.db, q, {
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
      }),
    ),
  );

  // Fail fast on any 'none' — these aren't fixable from a menu.
  const noneIdx: number[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i]!.kind === 'none') noneIdx.push(i);
  }
  if (noneIdx.length > 0) {
    const messages = noneIdx.map(
      (i) => `**"${queries[i]}"** — no matches. Try a qualifier like \`${queries[i]}, France\`.`,
    );
    await interaction.reply({
      content: messages.join('\n\n'),
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const slots: QuerySlot[] = queries.map((q, i) => {
    const r = results[i] as Exclude<ResolveResult, { kind: 'none' }>;
    if (r.kind === 'resolved') return { query: q, city: r.city, candidates: null };
    return { query: q, city: null, candidates: r.candidates };
  });

  if (slots.every((s) => s.city !== null)) {
    return slots.map((s) => s.city!);
  }

  const session: DisambigSession = {
    command,
    slots,
    chart,
    userId: interaction.user.id,
    guildId: interaction.guildId ?? undefined,
    createdAt: Date.now(),
  };
  const sessionId = createSession(session);
  const slotIdx = nextPendingSlot(session)!;

  const payload = buildMenuPayload(sessionId, session, slotIdx);
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  return null;
}

/** Build the ephemeral message + select menu for one ambiguous slot. */
export function buildMenuPayload(
  sessionId: string,
  session: DisambigSession,
  slotIdx: number,
): { content: string; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const slot = session.slots[slotIdx]!;
  const candidates = slot.candidates!;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`atm:disambig:${sessionId}:${slotIdx}`)
    .setPlaceholder('Pick the right city')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      candidates.map((c, i) => ({
        label: formatCandidate(c).slice(0, 100),
        value: String(i),
        description:
          c.population !== null
            ? `Population ${c.population.toLocaleString()}`
            : 'Population unknown',
      })),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  const pendingCount = session.slots.filter((s) => s.city === null).length;
  const progress = pendingCount > 1 ? ` _(${pendingCount} cities still to pick)_` : '';

  return {
    content: `**"${slot.query}"** matches multiple cities — pick one${progress}:`,
    components: [row],
  };
}
