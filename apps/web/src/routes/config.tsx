import { recordAuditEvent } from '@atmosfera/db';
import {
  type GuildConfig,
  getGuildConfig,
  setBrutalAllowed,
  setIndexingEnabled,
  setMessageEnabled,
  setSlashEnabled,
} from '@atmosfera/user-roast';
import { Hono } from 'hono';
import { resolveGuild } from '../middleware/requireGuild';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildSidebar } from '../views/components';
import { Layout } from '../views/layout';

export const configRoutes = new Hono<AppEnv>();

type FlagKey = 'indexing_enabled' | 'slash_enabled' | 'message_enabled' | 'brutal_allowed';

const FLAGS: { key: FlagKey; label: string; description: string }[] = [
  {
    key: 'indexing_enabled',
    label: 'Indexing',
    description:
      'When on, the bot records per-message metadata (length, mentions, channel — no content) to power /roast. Off → user-roast features no-op.',
  },
  {
    key: 'slash_enabled',
    label: 'Slash commands',
    description: 'Allow user-roast slash commands to be invoked in this server.',
  },
  {
    key: 'message_enabled',
    label: 'Message-based commands',
    description: 'Allow the message-based roast trigger (mention the bot to roast a user).',
  },
  {
    key: 'brutal_allowed',
    label: 'Brutal allowed',
    description: 'Allow users to opt into the brutal tone for their own roasts.',
  },
];

function applyFlag(guildId: string, key: FlagKey, next: boolean): void {
  switch (key) {
    case 'indexing_enabled':
      setIndexingEnabled(guildId, next);
      return;
    case 'slash_enabled':
      setSlashEnabled(guildId, next);
      return;
    case 'message_enabled':
      setMessageEnabled(guildId, next);
      return;
    case 'brutal_allowed':
      setBrutalAllowed(guildId, next);
      return;
  }
}

configRoutes.get('/:guildId/config', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;
  const cfg = getGuildConfig(guild.guildId);
  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="config"
    />
  );

  return c.html(
    <Layout
      title={`${guild.name} · config`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Config</h1>
          <p class="lead">
            Per-guild feature toggles for <strong>{guild.name}</strong>. Every change writes a{' '}
            <code>roast.config.update</code> event to the audit log.
          </p>
        </div>
      </div>

      {FLAGS.map((f) => (
        <div class="card" id={`flag-${f.key}`}>
          <FlagBlock guildId={guild.guildId} flag={f} cfg={cfg} />
        </div>
      ))}
    </Layout>,
  );
});

function FlagBlock(props: {
  guildId: string;
  flag: (typeof FLAGS)[number];
  cfg: GuildConfig;
}) {
  const on = props.cfg[props.flag.key];
  return (
    <>
      <div class="row" style="justify-content:space-between;">
        <h2 style="margin:0;">{props.flag.label}</h2>
        <form method="post" action={`/g/${props.guildId}/config/${props.flag.key}/toggle`}>
          <button type="submit" class={on ? 'danger' : ''}>
            {on ? 'Turn off' : 'Turn on'}
          </button>
        </form>
      </div>
      <p class="muted" style="margin:6px 0 0;">
        {props.flag.description}
      </p>
      <div style="margin-top:10px;">
        <span
          class={`pill ${on ? 'on' : 'off'}`}
          style="padding:4px 12px;border-radius:999px;font-weight:600;font-size:12px;"
        >
          {on ? 'on' : 'off'}
        </span>
      </div>
    </>
  );
}

configRoutes.post('/:guildId/config/:key/toggle', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const key = c.req.param('key') as FlagKey;
  if (!FLAGS.some((f) => f.key === key)) return c.text('Unknown config key', 400);

  const before = getGuildConfig(guild.guildId);
  const next = !before[key];
  applyFlag(guild.guildId, key, next);
  const after = getGuildConfig(guild.guildId);

  recordAuditEvent(getWebDb(), {
    guildId: guild.guildId,
    actorId: session.session.discordUserId,
    eventType: 'roast.config.update',
    subjectType: 'guild',
    subjectId: guild.guildId,
    metadata: {
      via: 'web',
      previous: before,
      next: after,
      changed: { [key]: { from: before[key], to: after[key] } },
    },
  });

  return c.redirect(`/g/${guild.guildId}/config#flag-${key}`);
});
