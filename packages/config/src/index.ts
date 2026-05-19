import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1).optional(),
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_DEV_GUILD_ID: z.string().min(1).optional(),
  DATABASE_URL: z.string().default('file:./data/atmosfera.db'),
  NOMINATIM_USER_AGENT: z
    .string()
    .default('atmosfera/0.1 (https://github.com/saratonin/atmosfera)'),
  GEMINI_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function cleanEnv(raw: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = v === '' ? undefined : v;
  }
  return out;
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(cleanEnv(process.env));
  if (!parsed.success) {
    console.error('Invalid environment:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export function dbPathFromUrl(url: string): string {
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}
