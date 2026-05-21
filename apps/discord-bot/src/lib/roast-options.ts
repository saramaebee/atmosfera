import { type ClimateCube, loadClimateCube } from '@atmosfera/climate';
import { getEnv } from '@atmosfera/config';
import type { City } from '@atmosfera/db';
import {
  DEFAULT_CULTURE,
  DEFAULT_LENGTH,
  DEFAULT_TONE,
  LENGTHS,
  type Length,
  RoastApiKeyMissingError,
  TONES,
  type Tone,
  getContrastRoast,
  getRoast,
} from '@atmosfera/city-roast';
import type {
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandBuilder,
} from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

export interface ParsedRoastOptions {
  tone: Tone;
  culture: boolean;
  length: Length;
  /** True iff the user set any of the three roast options. */
  requested: boolean;
}

/** Attach tone/culture/length options to a slash command builder or subcommand. */
export function addRoastOptions<
  T extends SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder,
>(builder: T): T {
  return builder
    .addStringOption((opt) =>
      opt
        .setName('tone')
        .setDescription('Roast tone (turns roasting on)')
        .setRequired(false)
        .addChoices(...TONES.map((t) => ({ name: t, value: t }))),
    )
    .addBooleanOption((opt) =>
      opt
        .setName('culture')
        .setDescription('Allow culture-meets-climate references (default true)')
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName('length')
        .setDescription('Roast length')
        .setRequired(false)
        .addChoices(...LENGTHS.map((l) => ({ name: l, value: l }))),
    ) as T;
}

export function parseRoastOptions(interaction: ChatInputCommandInteraction): ParsedRoastOptions {
  const tone = interaction.options.getString('tone') as Tone | null;
  const culture = interaction.options.getBoolean('culture');
  const length = interaction.options.getString('length') as Length | null;
  const requested = tone !== null || culture !== null || length !== null;
  return {
    tone: tone ?? DEFAULT_TONE,
    culture: culture ?? DEFAULT_CULTURE,
    length: length ?? DEFAULT_LENGTH,
    requested,
  };
}

export interface RoastResult {
  text?: string;
  /** Human-readable error to show as an ephemeral followUp; the chart still goes out unroasted. */
  error?: string;
}

async function ensureCube(city: City): Promise<ClimateCube> {
  return loadClimateCube({
    latitude: city.latitude,
    longitude: city.longitude,
    timezone: city.timezone,
  });
}

/** Generate a single-city roast if requested. */
export async function maybeGenerateRoast(
  parsed: ParsedRoastOptions,
  city: City,
  cube?: ClimateCube,
): Promise<RoastResult> {
  if (!parsed.requested) return {};
  const apiKey = getEnv().GEMINI_API_KEY;
  if (!apiKey) {
    return { error: 'Roast unavailable — `GEMINI_API_KEY` not configured.' };
  }
  try {
    const c = cube ?? (await ensureCube(city));
    const text = await getRoast(
      { tone: parsed.tone, culture: parsed.culture, length: parsed.length, apiKey },
      city,
      c,
    );
    return { text };
  } catch (e) {
    if (e instanceof RoastApiKeyMissingError) {
      return { error: 'Roast unavailable — `GEMINI_API_KEY` not configured.' };
    }
    return { error: `Roast failed: ${(e as Error).message}` };
  }
}

/** Generate a contrast roast across two cities if requested. */
export async function maybeGenerateContrastRoast(
  parsed: ParsedRoastOptions,
  cityA: City,
  cityB: City,
  cubeA?: ClimateCube,
  cubeB?: ClimateCube,
): Promise<RoastResult> {
  if (!parsed.requested) return {};
  const apiKey = getEnv().GEMINI_API_KEY;
  if (!apiKey) {
    return { error: 'Roast unavailable — `GEMINI_API_KEY` not configured.' };
  }
  try {
    const [a, b] = await Promise.all([cubeA ?? ensureCube(cityA), cubeB ?? ensureCube(cityB)]);
    const text = await getContrastRoast(
      { tone: parsed.tone, culture: parsed.culture, length: parsed.length, apiKey },
      cityA,
      a,
      cityB,
      b,
    );
    return { text };
  } catch (e) {
    if (e instanceof RoastApiKeyMissingError) {
      return { error: 'Roast unavailable — `GEMINI_API_KEY` not configured.' };
    }
    return { error: `Roast failed: ${(e as Error).message}` };
  }
}
