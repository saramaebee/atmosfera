/**
 * Roast sample generator — quality gate before shipping to Discord.
 *
 * Generates every (tone × length × culture-on) variant for two reference cities,
 * then a contrast roast per tone for the pair. Writes a Markdown file to
 * out/roast-samples.md for visual review.
 *
 * Requires:
 *   - GEMINI_API_KEY in .env
 *   - cubes already built for the two cities (run /muggy "Buenos Aires" and
 *     /muggy "Reykjavik" via the bot/CLI first, or this script will trigger
 *     cube builds, which is slow but works).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  LENGTHS,
  RoastApiKeyMissingError,
  TONES,
  getContrastRoast,
  getRoast,
} from '@atmosfera/city-roast';
import { loadClimateCube } from '@atmosfera/climate';
import { dbPathFromUrl, getEnv } from '@atmosfera/config';
import { createDb, migrateDb } from '@atmosfera/db';
import { resolveCity } from '@atmosfera/geocode';

const CITIES = ['Buenos Aires', 'Reykjavik'];

async function resolveOrDie(db: ReturnType<typeof createDb>, query: string) {
  const r = await resolveCity(db, query);
  if (r.kind !== 'resolved') {
    throw new Error(`couldn't resolve "${query}" (got ${r.kind})`);
  }
  return r.city;
}

async function main(): Promise<void> {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set — add it to .env to run this script.');
    process.exit(1);
  }

  const dbPath = dbPathFromUrl(env.DATABASE_URL);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = createDb(dbPath);
  migrateDb(db);

  const cities = await Promise.all(CITIES.map((q) => resolveOrDie(db, q)));
  const cubes = await Promise.all(
    cities.map((c) =>
      loadClimateCube({ latitude: c.latitude, longitude: c.longitude, timezone: c.timezone }),
    ),
  );

  const sections: string[] = [];
  sections.push('# atmosfera — roast samples\n');
  sections.push(
    `Generated ${new Date().toISOString()}. Two cities × ${TONES.length} tones × ${LENGTHS.length} lengths × {culture on, culture off} = ${cities.length * TONES.length * LENGTHS.length * 2} single-city roasts, plus ${TONES.length} contrast roasts.\n`,
  );

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i]!;
    const cube = cubes[i]!;
    sections.push(
      `---\n## ${city.canonicalName}${city.region ? `, ${city.region}` : ''}, ${city.country}\n`,
    );

    for (const tone of TONES) {
      sections.push(`### Tone: \`${tone}\`\n`);
      for (const length of LENGTHS) {
        for (const culture of [true, false]) {
          try {
            const text = await getRoast(
              { tone, length, culture, apiKey: env.GEMINI_API_KEY },
              city,
              cube,
            );
            const cultureLabel = culture ? 'culture-on' : 'culture-off';
            sections.push(`- **${length} · ${cultureLabel}**: ${text}\n`);
          } catch (e) {
            if (e instanceof RoastApiKeyMissingError) throw e;
            sections.push(`- **${length}**: _error: ${(e as Error).message}_\n`);
          }
        }
      }
    }
  }

  // Contrast roasts: one per tone at default length (1-sentence)
  sections.push(`---\n## Contrast: ${cities[0]!.canonicalName} vs ${cities[1]!.canonicalName}\n`);
  for (const tone of TONES) {
    try {
      const text = await getContrastRoast(
        { tone, length: '1-sentence', culture: true, apiKey: env.GEMINI_API_KEY },
        cities[0]!,
        cubes[0]!,
        cities[1]!,
        cubes[1]!,
      );
      sections.push(`- **${tone}**: ${text}\n`);
    } catch (e) {
      sections.push(`- **${tone}**: _error: ${(e as Error).message}_\n`);
    }
  }

  const out = 'out/roast-samples.md';
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, sections.join('\n'));
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error('smoke failed:', err);
  process.exit(1);
});
