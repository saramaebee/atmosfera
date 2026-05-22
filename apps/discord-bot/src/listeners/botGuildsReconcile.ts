import { markBotGuildLeft, reconcileBotGuildsLeft, upsertBotGuild } from '@atmosfera/db';
import { Listener, container } from '@sapphire/framework';
import { type Client, Events, type Guild } from 'discord.js';

/**
 * Maintains the `bot_guilds` table — the web app's source of truth for which
 * guilds the bot is currently a member of. See packages/db/src/bot-guilds.ts.
 */

function snapshot(guild: Guild): {
  guildId: string;
  name: string;
  iconHash: string | null;
  memberCount: number | null;
} {
  return {
    guildId: guild.id,
    name: guild.name,
    iconHash: guild.icon ?? null,
    memberCount: guild.memberCount ?? null,
  };
}

export class BotGuildsReadyListener extends Listener<typeof Events.ClientReady> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ClientReady, once: true });
  }

  public override run(client: Client<true>): void {
    const present = new Set<string>();
    for (const guild of client.guilds.cache.values()) {
      upsertBotGuild(container.db, snapshot(guild));
      present.add(guild.id);
    }
    const marked = reconcileBotGuildsLeft(container.db, { presentGuildIds: present });
    if (marked > 0) {
      console.log(`bot_guilds: marked ${marked} guild(s) as left during reconcile`);
    }
  }
}

export class BotGuildsCreateListener extends Listener<typeof Events.GuildCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildCreate });
  }

  public override run(guild: Guild): void {
    upsertBotGuild(container.db, snapshot(guild));
  }
}

export class BotGuildsDeleteListener extends Listener<typeof Events.GuildDelete> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildDelete });
  }

  public override run(guild: Guild): void {
    markBotGuildLeft(container.db, guild.id);
  }
}
