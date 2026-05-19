import type { City } from '@atmosfera/db';
import { type ResolveResult, formatCandidate, resolveCity } from '@atmosfera/geocode';
import { container } from '@sapphire/framework';
import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';

/**
 * Resolve a city query. On success, return the City — the caller may then
 * defer the interaction publicly and proceed with the (slow) render.
 *
 * On none/ambiguous, send an *ephemeral* reply directly and return null. The
 * caller should just bail. We don't defer first because:
 *   1. resolveCity is usually <1s (alias hit or Open-Meteo); within Discord's
 *      3-second ack budget.
 *   2. Replying ephemerally after a public defer is awkward and requires a
 *      followup-then-delete dance. Replying directly keeps the wrong-input
 *      flow out of the public timeline entirely.
 */
export async function resolveCityOrReply(
  interaction: ChatInputCommandInteraction,
  query: string,
): Promise<City | null> {
  const result = await resolveCity(container.db, query, {
    guildId: interaction.guildId ?? undefined,
    userId: interaction.user.id,
  });

  if (result.kind === 'resolved') return result.city;

  if (result.kind === 'none') {
    await interaction.reply({
      content: `No matches for **"${query}"**. Try a qualifier like \`${query}, France\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  // ambiguous — Phase 4D will replace this text list with a select menu
  const top = result.candidates[0]!;
  const exampleQualifier = top.region ?? top.country;
  const lines = result.candidates
    .map((c, i) => {
      const pop = c.population !== null ? ` (pop ${c.population.toLocaleString()})` : '';
      return `${i + 1}. ${formatCandidate(c)}${pop}`;
    })
    .join('\n');
  await interaction.reply({
    content: `**"${query}"** matches multiple cities — please be more specific:\n${lines}\n\nTry e.g. \`${query}, ${exampleQualifier}\``,
    flags: MessageFlags.Ephemeral,
  });
  return null;
}

export function cityDisplayName(city: City): string {
  const parts = [city.canonicalName];
  if (city.region) parts.push(city.region);
  parts.push(city.country);
  return parts.join(', ');
}

/**
 * Resolve multiple city queries in parallel. On success, return Cities in
 * input order. If any query is ambiguous or has no match, send one combined
 * ephemeral reply listing every problem at once and return null.
 */
export async function resolveCitiesOrReply(
  interaction: ChatInputCommandInteraction,
  queries: string[],
): Promise<City[] | null> {
  const results = await Promise.all(
    queries.map((q) =>
      resolveCity(container.db, q, {
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
      }),
    ),
  );

  const failures: { query: string; result: ResolveResult }[] = [];
  for (let i = 0; i < queries.length; i++) {
    const r = results[i]!;
    if (r.kind !== 'resolved') failures.push({ query: queries[i]!, result: r });
  }

  if (failures.length === 0) {
    return results.map((r) => {
      // r.kind === 'resolved' here — invariant from failures.length === 0
      if (r.kind !== 'resolved') throw new Error('unreachable');
      return r.city;
    });
  }

  const sections = failures.map(({ query, result }) => formatFailure(query, result));
  await interaction.reply({
    content: sections.join('\n\n'),
    flags: MessageFlags.Ephemeral,
  });
  return null;
}

function formatFailure(query: string, result: ResolveResult): string {
  if (result.kind === 'none') {
    return `**"${query}"** — no matches. Try a qualifier like \`${query}, France\`.`;
  }
  if (result.kind === 'ambiguous') {
    const top = result.candidates[0]!;
    const exampleQualifier = top.region ?? top.country;
    const lines = result.candidates
      .map((c, i) => {
        const pop = c.population !== null ? ` (pop ${c.population.toLocaleString()})` : '';
        return `${i + 1}. ${formatCandidate(c)}${pop}`;
      })
      .join('\n');
    return `**"${query}"** — multiple matches, please be specific:\n${lines}\n\nTry e.g. \`${query}, ${exampleQualifier}\``;
  }
  // resolved — shouldn't happen since we filter
  return '';
}
