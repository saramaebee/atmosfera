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

const csvSnowflakes = z
  .string()
  .optional()
  .transform((v): string[] => {
    if (!v) return [];
    return v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{17,20}$/.test(s));
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

  /**
   * Discord user IDs that bypass the user-scope check on commands tagged
   * with `ownerOverride: true`. Comma-separated; non-snowflake values are
   * dropped silently. Owners never bypass `requiredClientPermissions` or
   * `protected` rules.
   */
  DISCORD_OWNER_IDS: csvSnowflakes,

  // user-roast pipeline tuning
  ROAST_MAX_TOOL_ITERATIONS: intFromEnv(3),
  ROAST_HYPOTHESIZE_MAX_TOOL_ITERATIONS: intFromEnv(4),
  ROAST_MAX_MESSAGES_FETCHED: intFromEnv(1500),
  ROAST_TIMEOUT_MS: intFromEnv(30_000),

  // user-roast retention (days)
  ACTIVITY_RECENT_RETENTION_DAYS: intFromEnv(30),
  ACTIVITY_HOURLY_RETENTION_DAYS: intFromEnv(30),
  INTERACTIONS_RETENTION_DAYS: intFromEnv(30),
  ROAST_HISTORY_RETENTION_DAYS: intFromEnv(30),
  // Verbatim message text for the roast hot-path. Hard cap, no opt-in for
  // longer retention. Defaults to 7 days; minimum 1 day.
  MESSAGE_CONTENT_RETENTION_DAYS: intFromEnv(7),

  // Internal bot↔web HTTP API. Optional; if INTERNAL_API_TOKEN is unset the
  // bot does not start the server and the web app hides owner debug pages.
  // Always loopback-bound; the token is the only auth.
  INTERNAL_API_PORT: intFromEnv(4317),
  INTERNAL_API_TOKEN: z.string().min(32, 'INTERNAL_API_TOKEN must be at least 32 chars').optional(),

  // Web app (apps/web). All optional — the web app validates them itself at
  // startup, so the bot can boot without these set.
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_OAUTH_REDIRECT_URI: z.string().url().optional(),
  // 32-byte secret, hex-encoded (64 chars). Used for cookie signing AND
  // AES-GCM encryption of OAuth tokens at rest. Generate with:
  //   openssl rand -hex 32
  SESSION_SECRET: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SESSION_SECRET must be 64 hex chars (32 bytes)')
    .optional(),
  WEB_PORT: intFromEnv(3000),
  WEB_PUBLIC_URL: z.string().url().optional(),
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

/**
 * Drop the cached parse so the next `getEnv()` call re-reads `process.env`.
 * Test-only: production code never mutates the environment mid-process. Use
 * this when a test sets `process.env.X` after some earlier test caused
 * `getEnv()` to cache an environment without `X`.
 */
export function resetEnvCacheForTests(): void {
  cached = undefined;
  ownersSet = null;
}

export function dbPathFromUrl(url: string): string {
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

// Memoized at first read. Changing DISCORD_OWNER_IDS requires a process
// restart to take effect.
let ownersSet: Set<string> | null = null;

function owners(): Set<string> {
  if (ownersSet) return ownersSet;
  ownersSet = new Set(getEnv().DISCORD_OWNER_IDS);
  return ownersSet;
}

export function isBotOwner(userId: string): boolean {
  return owners().has(userId);
}

export function listBotOwnerIds(): readonly string[] {
  return [...owners()];
}

export function isInternalApiEnabled(): boolean {
  return Boolean(getEnv().INTERNAL_API_TOKEN);
}

export * from './internal-api';
