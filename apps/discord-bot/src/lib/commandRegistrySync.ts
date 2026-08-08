import { container } from '@sapphire/framework';
import type {
  ApplicationCommand,
  ApplicationCommandDataResolvable,
  Client,
  Collection,
  Snowflake,
} from 'discord.js';
import { reconcileExplainCommand } from './explainCommandSync';

/**
 * Runtime re-sync of application commands from Sapphire's in-memory registries.
 *
 * Sapphire registers commands exactly once, post-login, and does not export its
 * re-sync internals (`handleRegistryAPICalls` is blocked by the package's
 * exports map). Each command's ApplicationCommandRegistry does, however, retain
 * the REST payloads built at startup in its TS-private `apiCalls` field. We
 * read that field — behind a strict runtime shape assertion so a framework
 * upgrade fails loudly before any API call — and force-push the payloads
 * through the public discord.js bulk-set API, mirroring the partition Sapphire's
 * own `handleBulkOverwrite` performs.
 *
 * The payloads are frozen at process start: /sync re-pushes what the running
 * process registered, it does not rebuild builders or pick up code changes.
 */

/** Minimal REST payload shape we rely on. `type` is absent for chat input. */
type CommandPayload = { name: string; type?: number } & Record<string, unknown>;

interface RegisteredPayload<T> {
  piece: T;
  data: CommandPayload;
}

export interface CollectedPayloads<T> {
  global: RegisteredPayload<T>[];
  byGuild: Map<string, RegisteredPayload<T>[]>;
}

export interface SyncResult {
  /** Commands pushed globally; null when the global bucket was empty (skipped). */
  globalCount: number | null;
  guilds: Array<{ guildId: string; count: number }>;
  cleared: 'global' | { guildId: string } | null;
  /** Set when clear-other-scope was requested but couldn't run. */
  clearSkippedReason: string | null;
  reconciledGuilds: string[];
  errors: Array<{ scope: string; message: string }>;
  durationMs: number;
}

const SHAPE_ERROR =
  'Sapphire ApplicationCommandRegistry.apiCalls shape changed — /sync aborted before any API call (framework upgrade?)';

/**
 * Partition every command's registered payloads into global / per-guild
 * buckets, exactly like Sapphire's handleBulkOverwrite: entries whose
 * registerOptions carry guildIds go to each listed guild, the rest global.
 * Within a bucket, duplicate (name, type) pairs dedupe with last-wins — a
 * cheap safety against `bun --hot` residue re-appending register calls.
 *
 * Pure over any iterable of piece-like objects so it's unit-testable with a
 * fake store. Throws on unexpected `apiCalls` shapes (see SHAPE_ERROR).
 */
export function collectRegisteredCommandPayloads<T extends object>(
  commands: Iterable<T>,
): CollectedPayloads<T> {
  const globalBucket = new Map<string, RegisteredPayload<T>>();
  const guildBuckets = new Map<string, Map<string, RegisteredPayload<T>>>();

  for (const piece of commands) {
    const registry = (piece as { applicationCommandRegistry?: unknown }).applicationCommandRegistry;
    // No registry at all (bare fakes in tests) → nothing registered.
    if (registry === undefined || registry === null) continue;
    if (typeof registry !== 'object') throw new Error(SHAPE_ERROR);

    const apiCalls = (registry as { apiCalls?: unknown }).apiCalls;
    if (!Array.isArray(apiCalls)) throw new Error(SHAPE_ERROR);

    for (const call of apiCalls) {
      const { builtData, registerOptions } = assertApiCallShape(call);
      const key = `${builtData.type ?? 1}:${builtData.name}`;
      const guildIds = registerOptions.guildIds;

      if (Array.isArray(guildIds) && guildIds.length > 0) {
        for (const guildId of guildIds) {
          if (typeof guildId !== 'string') throw new Error(SHAPE_ERROR);
          let bucket = guildBuckets.get(guildId);
          if (!bucket) {
            bucket = new Map();
            guildBuckets.set(guildId, bucket);
          }
          bucket.set(key, { piece, data: builtData });
        }
        continue;
      }
      globalBucket.set(key, { piece, data: builtData });
    }
  }

  return {
    global: [...globalBucket.values()],
    byGuild: new Map(
      [...guildBuckets.entries()].map(([guildId, bucket]) => [guildId, [...bucket.values()]]),
    ),
  };
}

function assertApiCallShape(call: unknown): {
  builtData: CommandPayload;
  registerOptions: { guildIds?: unknown };
} {
  if (typeof call !== 'object' || call === null) throw new Error(SHAPE_ERROR);
  const { builtData, registerOptions } = call as { builtData?: unknown; registerOptions?: unknown };
  if (typeof builtData !== 'object' || builtData === null) throw new Error(SHAPE_ERROR);
  if (typeof (builtData as { name?: unknown }).name !== 'string') throw new Error(SHAPE_ERROR);
  if (typeof registerOptions !== 'object' || registerOptions === null) throw new Error(SHAPE_ERROR);
  return {
    builtData: builtData as CommandPayload,
    registerOptions: registerOptions as { guildIds?: unknown },
  };
}

export interface ForceSyncOptions {
  clearOtherScope: boolean;
  devGuildId: string | undefined;
  invokingGuildId: string | null;
}

/**
 * Force-push the collected payloads to Discord and reconcile the Explain
 * context-menu command in every guild whose command list we overwrote (a guild
 * bulk-set deletes the dynamically-managed Explain command — see
 * listeners/explainCommandSync.ts).
 *
 * Unlike Sapphire's startup overwrite, a scope with zero collected payloads is
 * skipped rather than `set([])`, so a routine dev-guild sync can never wipe
 * global. `clearOtherScope` is the explicit opt-in: in dev-guild mode it
 * clears global; in global mode it clears the *invoking* guild's stale
 * guild-scoped commands (the former dev guild is unknowable once
 * DISCORD_DEV_GUILD_ID is unset — run it inside the stale guild).
 *
 * Each bulk set is one independent API call; failures are recorded per scope
 * and the remaining scopes still run. Re-pushing unchanged names does not
 * count against Discord's daily command-create cap (only new names do).
 */
export async function forceSyncCommands(
  client: Client<true>,
  opts: ForceSyncOptions,
): Promise<SyncResult> {
  const start = Date.now();
  const commandStore = container.stores.get('commands');
  const collected = collectRegisteredCommandPayloads(commandStore.values());
  const appCommands = client.application.commands;

  const result: SyncResult = {
    globalCount: null,
    guilds: [],
    cleared: null,
    clearSkippedReason: null,
    reconciledGuilds: [],
    errors: [],
    durationMs: 0,
  };

  if (collected.global.length > 0) {
    try {
      const set = await appCommands.set(
        collected.global.map((x) => x.data as ApplicationCommandDataResolvable),
      );
      result.globalCount = set.size;
      updateAliases(commandStore.aliases, collected.global, set);
    } catch (err) {
      result.errors.push({ scope: 'global', message: errorMessage(err) });
    }
  }

  for (const [guildId, bucket] of collected.byGuild) {
    try {
      const set = await appCommands.set(
        bucket.map((x) => x.data as ApplicationCommandDataResolvable),
        guildId,
      );
      result.guilds.push({ guildId, count: set.size });
      updateAliases(commandStore.aliases, bucket, set);
    } catch (err) {
      result.errors.push({ scope: guildId, message: errorMessage(err) });
    }
  }

  const reconcileTargets = new Set(collected.byGuild.keys());

  if (opts.clearOtherScope) {
    if (opts.devGuildId) {
      try {
        await appCommands.set([]);
        result.cleared = 'global';
      } catch (err) {
        result.errors.push({ scope: 'global (clear)', message: errorMessage(err) });
      }
    } else if (opts.invokingGuildId) {
      // Empty the invoking guild, then let the reconcile below re-create the
      // Explain command when the guild's mode says it should exist. The brief
      // absence is fine for a rare owner-run cleanup and avoids re-pushing
      // fetched command JSON (whose extra fields Discord may not accept).
      try {
        await appCommands.set([], opts.invokingGuildId);
        result.cleared = { guildId: opts.invokingGuildId };
        reconcileTargets.add(opts.invokingGuildId);
      } catch (err) {
        result.errors.push({
          scope: `${opts.invokingGuildId} (clear)`,
          message: errorMessage(err),
        });
      }
    } else {
      result.clearSkippedReason =
        'global mode has no dev guild id — run this inside the guild you want cleared';
    }
  }

  for (const guildId of reconcileTargets) {
    // Best-effort by design: reconcileExplainCommand logs and swallows its own
    // API errors, returning false instead of throwing.
    if (await reconcileExplainCommand(client, guildId)) {
      result.reconciledGuilds.push(guildId);
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}

/**
 * Mirror Sapphire's post-overwrite alias bookkeeping (id → piece) so id-based
 * routing keeps working for freshly minted command ids. We deliberately skip
 * the registry-internal `handleIdAddition` id-hint bookkeeping — it only
 * affects registry introspection helpers, not interaction routing, and stays
 * stale only until the next restart.
 */
function updateAliases<T extends object>(
  aliases: { set(key: string, piece: T): unknown },
  bucket: RegisteredPayload<T>[],
  set: Collection<Snowflake, ApplicationCommand>,
): void {
  for (const [id, appCommand] of set) {
    const piece = bucket.find((x) => x.data.name === appCommand.name)?.piece;
    if (piece) aliases.set(id, piece);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
