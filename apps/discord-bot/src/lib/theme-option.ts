import type { ThemeName } from '@atmosfera/charts';
import type { ChatInputCommandInteraction, SlashCommandStringOption } from 'discord.js';

interface ThemeOptionBuilder {
  addStringOption(fn: (opt: SlashCommandStringOption) => SlashCommandStringOption): unknown;
}

/**
 * Append the shared optional `theme` choice to a graphics command. Dark is
 * the compiled-in default (see resolveTheme), so omitting the option and
 * picking "Dark" are equivalent.
 */
export function addThemeOption<B extends ThemeOptionBuilder>(builder: B): B {
  builder.addStringOption((opt) =>
    opt
      .setName('theme')
      .setDescription('Color theme (default: dark)')
      .setRequired(false)
      .addChoices({ name: 'Dark', value: 'dark' }, { name: 'Light', value: 'light' }),
  );
  return builder;
}

export function getThemeOption(interaction: ChatInputCommandInteraction): ThemeName | undefined {
  return (interaction.options.getString('theme') as ThemeName | null) ?? undefined;
}
