import {
  deletePinnedRoast,
  getPinnedRoast,
  listPinnedRoastsForUser,
  searchPinnedRoastsForUser,
  shortId,
  type PinnedRoast,
} from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import { EmbedBuilder } from 'discord.js';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';

const PREVIEW_CHARS = 120;

const SCOPE = { baseline: 'everyone', protected: true } as const;
registerScope('pinned-roast', SCOPE);

export class PinnedRoastCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'pinned-roast',
      requiredClientPermissions: ['SendMessages', 'EmbedLinks'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('pinned-roast')
            .setDescription('Look up roasts you have pinned.')
            .setDMPermission(false),
          SCOPE,
        )
          .addSubcommand((sub) =>
            sub.setName('list').setDescription('Show your pinned roasts, ranked by upvotes.'),
          )
          .addSubcommand((sub) =>
            sub
              .setName('get')
              .setDescription('Post one of your pinned roasts back to the channel.')
              .addStringOption((o) =>
                o.setName('id').setDescription('Short or full pin ID.').setRequired(false),
              )
              .addStringOption((o) =>
                o
                  .setName('keyword')
                  .setDescription('Substring to find the roast by text instead of by ID.')
                  .setRequired(false),
              ),
          )
          .addSubcommand((sub) =>
            sub
              .setName('search')
              .setDescription('Search the text of your pinned roasts.')
              .addStringOption((o) =>
                o
                  .setName('keyword')
                  .setDescription('Substring to match (case-insensitive).')
                  .setRequired(true),
              ),
          )
          .addSubcommand((sub) =>
            sub
              .setName('delete')
              .setDescription('Delete one of your pinned roasts.')
              .addStringOption((o) =>
                o.setName('id').setDescription('Short or full pin ID.').setRequired(true),
              ),
          ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: 'Server only.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand(true);
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    switch (sub) {
      case 'list': {
        const rows = listPinnedRoastsForUser(guildId, userId);
        if (rows.length === 0) {
          await interaction.reply({
            content:
              "You haven't pinned any roasts yet. Click 📌 on a roast you received to pin it.",
            ephemeral: true,
          });
          return;
        }
        await interaction.reply({
          embeds: [renderList('Your pinned roasts', rows)],
          ephemeral: true,
        });
        return;
      }

      case 'get': {
        const id = interaction.options.getString('id');
        const keyword = interaction.options.getString('keyword');
        if (!id && !keyword) {
          await interaction.reply({
            content: 'Provide either `id` or `keyword`.',
            ephemeral: true,
          });
          return;
        }

        if (id) {
          const row = getPinnedRoast(guildId, userId, id);
          if (!row) {
            await interaction.reply({ content: notFoundMessage(id), ephemeral: true });
            return;
          }
          await interaction.reply({ embeds: [renderOne(row)] });
          return;
        }

        const matches = searchPinnedRoastsForUser(guildId, userId, keyword!);
        if (matches.length === 1) {
          await interaction.reply({ embeds: [renderOne(matches[0]!)] });
          return;
        }
        await replyWithMatches(interaction, keyword!, matches, true);
        return;
      }

      case 'search': {
        const keyword = interaction.options.getString('keyword', true);
        const matches = searchPinnedRoastsForUser(guildId, userId, keyword);
        await replyWithMatches(interaction, keyword, matches, false);
        return;
      }

      case 'delete': {
        const id = interaction.options.getString('id', true);
        const ok = deletePinnedRoast(guildId, userId, id);
        await interaction.reply({
          content: ok ? `🗑️ Deleted pin \`${id}\`.` : notFoundMessage(id),
          ephemeral: true,
        });
        return;
      }
    }
  }
}

function notFoundMessage(idOrPrefix: string): string {
  if (idOrPrefix.trim().length < 8) {
    return 'Pin ID must be at least 8 characters. Try `/pinned-roast list` to see your IDs.';
  }
  return `No pinned roast of yours matches \`${idOrPrefix}\` (or the prefix is ambiguous). Try \`/pinned-roast list\`.`;
}

function preview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > PREVIEW_CHARS ? `${collapsed.slice(0, PREVIEW_CHARS)}…` : collapsed;
}

async function replyWithMatches(
  interaction: Command.ChatInputCommandInteraction,
  keyword: string,
  matches: PinnedRoast[],
  fromGet: boolean,
): Promise<void> {
  if (matches.length === 0) {
    await interaction.reply({
      content: `No pinned roasts of yours match \`${keyword}\`.`,
      ephemeral: true,
    });
    return;
  }
  const title = fromGet
    ? `${matches.length} matches for "${keyword}" — be more specific or pass id:`
    : `Matches for "${keyword}"`;
  await interaction.reply({ embeds: [renderList(title, matches)], ephemeral: true });
}

function renderList(title: string, rows: PinnedRoast[]): EmbedBuilder {
  const lines = rows.map((r) => {
    const ts = Math.floor(r.pinnedAt / 1000);
    return `• \`${shortId(r.invocationId)}\` · 👍 ${r.voteCount} · <t:${ts}:R> — ${preview(r.roastText)}`;
  });
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setColor(0xff5577)
    .setFooter({ text: 'Use /pinned-roast get id:<short-id> to see the full text.' });
}

function renderOne(row: PinnedRoast): EmbedBuilder {
  const ts = Math.floor(row.pinnedAt / 1000);
  return new EmbedBuilder()
    .setTitle(`Pinned roast · ${shortId(row.invocationId)}`)
    .setDescription(row.roastText)
    .addFields(
      { name: 'Pinned', value: `<t:${ts}:F>`, inline: true },
      { name: 'Upvotes', value: String(row.voteCount), inline: true },
      { name: 'Tone', value: row.tone, inline: true },
    )
    .setFooter({ text: `Full ID: ${row.invocationId}` })
    .setColor(0xff5577);
}
