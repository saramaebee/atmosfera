import { getEnv } from '@atmosfera/config';
import { recordAuditEvent } from '@atmosfera/db';
import { Command } from '@sapphire/framework';
import { type SyncResult, forceSyncCommands } from '../lib/commandRegistrySync';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';
import { safeDeferReply, safeRespond } from '../lib/safeInteraction';

const SCOPE = { baseline: 'admin', ownerOnly: true } as const;
registerScope('sync', SCOPE);

/**
 * Owner-only: force-push the application commands Sapphire registered at
 * startup back to Discord (global and/or dev guild), bypassing the
 * "only when not identical" diff. The payloads are frozen at process start —
 * /sync re-pushes them, it does not rebuild from code; new command code still
 * needs a restart/deploy first.
 */
export class SyncCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'sync',
      requiredClientPermissions: ['SendMessages'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('sync')
            .setDescription('Bot owner: force re-push slash-command registrations to Discord.')
            .addBooleanOption((opt) =>
              opt
                .setName('clear-other-scope')
                .setDescription(
                  'Also clear the other scope: global in dev-guild mode, this guild in global mode.',
                )
                .setRequired(false),
            ),
          SCOPE,
        ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    // Several sequential bulk API calls — always defer.
    await safeDeferReply(interaction, { ephemeral: true });

    const { client } = this.container;
    if (!client.isReady()) {
      await safeRespond(interaction, {
        content: 'Client is not ready yet — try again in a moment.',
        ephemeral: true,
      });
      return;
    }

    const devGuildId = getEnv().DISCORD_DEV_GUILD_ID;
    const clearOtherScope = interaction.options.getBoolean('clear-other-scope') ?? false;

    let result: SyncResult;
    try {
      result = await forceSyncCommands(client, {
        clearOtherScope,
        devGuildId,
        invokingGuildId: interaction.guildId ?? null,
      });
    } catch (err) {
      // The collect-phase shape assertion throws before any API call.
      const message = err instanceof Error ? err.message : String(err);
      await safeRespond(interaction, { content: `❌ Sync aborted: ${message}`, ephemeral: true });
      return;
    }

    recordAuditEvent(this.container.db, {
      guildId: interaction.guildId ?? null,
      actorId: interaction.user.id,
      eventType: 'command.registry.sync',
      subjectType: 'application',
      subjectId: client.application.id,
      metadata: {
        mode: devGuildId ? 'dev-guild' : 'global',
        globalCount: result.globalCount,
        guildCounts: Object.fromEntries(result.guilds.map((g) => [g.guildId, g.count])),
        clearedOtherScope: result.cleared,
        errorCount: result.errors.length,
        durationMs: result.durationMs,
      },
    });

    await safeRespond(interaction, { content: formatResult(result, devGuildId), ephemeral: true });

    this.container.logger.info(
      `[sync] actor=${interaction.user.id} global=${result.globalCount ?? 'skipped'} ` +
        `guilds=${result.guilds.length} cleared=${JSON.stringify(result.cleared)} ` +
        `errors=${result.errors.length} took=${result.durationMs}ms`,
    );
  }
}

function formatResult(result: SyncResult, devGuildId: string | undefined): string {
  const lines = [
    `**Re-synced application commands** (${devGuildId ? 'dev-guild' : 'global'} mode).`,
  ];

  lines.push(
    result.globalCount === null
      ? 'Global: skipped (no global payloads)'
      : `Global: ${result.globalCount} commands`,
  );
  for (const { guildId, count } of result.guilds) {
    lines.push(`Guild ${guildId}: ${count} commands`);
  }
  if (result.cleared) {
    lines.push(
      result.cleared === 'global'
        ? 'Cleared other scope: global'
        : `Cleared other scope: guild ${result.cleared.guildId}`,
    );
  }
  if (result.clearSkippedReason) {
    lines.push(`Clear skipped: ${result.clearSkippedReason}`);
  }
  lines.push(
    result.errors.length === 0
      ? 'Errors: none'
      : result.errors.map((e) => `⚠️ ${e.scope}: ${e.message}`).join('\n'),
  );
  lines.push(`Took ${result.durationMs}ms`);
  return lines.join('\n');
}
