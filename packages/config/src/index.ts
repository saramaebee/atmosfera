import { z } from 'zod';

const intFromEnv = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : def;
    });

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1).optional(),
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_DEV_GUILD_ID: z.string().min(1).optional(),
  DATABASE_URL: z.string().default('file:./data/atmosfera.db'),
  NOMINATIM_USER_AGENT: z
    .string()
    .default('atmosfera/0.1 (https://github.com/saratonin/atmosfera)'),
  GEMINI_API_KEY: z.string().min(1).optional(),

  // user-roast pipeline tuning
  ROAST_MAX_TOOL_ITERATIONS: intFromEnv(3),
  ROAST_MAX_MESSAGES_FETCHED: intFromEnv(1500),
  ROAST_TIMEOUT_MS: intFromEnv(30_000),

  // user-roast retention (days)
  ACTIVITY_RECENT_RETENTION_DAYS: intFromEnv(30),
  ACTIVITY_HOURLY_RETENTION_DAYS: intFromEnv(30),
  INTERACTIONS_RETENTION_DAYS: intFromEnv(30),
  ROAST_HISTORY_RETENTION_DAYS: intFromEnv(30),
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
