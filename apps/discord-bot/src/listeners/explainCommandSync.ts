import { Events, Listener, container } from '@sapphire/framework';
import type { Guild } from 'discord.js';
import {
  reconcileAllGuilds,
  reconcileExplainCommand,
  registerExplainRoutingAlias,
} from '../lib/explainCommandSync';

/**
 * Keeps the per-guild Explain command in sync with each guild's mode (see
 * explainCommandSync). Explain is the one command NOT registered through
 * Sapphire, so its presence/absence is reconciled here instead.
 */

// Runs AFTER Sapphire's bulk-overwrite finishes (not bare ClientReady) so the
// dev-guild overwrite — which doesn't include Explain — can't delete what we add.
export class ExplainSyncRegisteredListener extends Listener<
  typeof Events.ApplicationCommandRegistriesRegistered
> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, {
      ...options,
      event: Events.ApplicationCommandRegistriesRegistered,
      once: true,
    });
  }

  public override async run(): Promise<void> {
    // Wire interaction routing first (Explain isn't Sapphire-registered), then
    // make each guild's command presence match its mode.
    registerExplainRoutingAlias();
    await reconcileAllGuilds(container.client);
  }
}

// New guild → default mode 'everywhere' → ensure Explain is present.
export class ExplainSyncGuildCreateListener extends Listener<typeof Events.GuildCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildCreate });
  }

  public override async run(guild: Guild): Promise<void> {
    await reconcileExplainCommand(guild.client, guild.id);
  }
}
