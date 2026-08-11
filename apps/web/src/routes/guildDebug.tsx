import {
  type BotCategoryInfo,
  type BotChannelInfo,
  type BotChannelPerms,
  type BotChannelsResponse,
  type BotCommandInfo,
  type BotCommandsResponse,
  isInternalApiEnabled,
} from '@atmosfera/config';
import { Hono } from 'hono';
import { fetchBotChannels, fetchBotCommands } from '../lib/botApi';
import { resolveGuild } from '../middleware/requireGuild';
import type { AppEnv } from '../types';
import { GuildSidebar } from '../views/components';
import { Layout } from '../views/layout';

export const guildDebugRoutes = new Hono<AppEnv>();

// Short labels for the per-channel permission pills. Order matches
// rendering order; abbreviations are stable so screenshots are easy to share.
const PERM_COLUMNS: Array<{ key: keyof BotChannelPerms; short: string; full: string }> = [
  { key: 'viewChannel', short: 'View', full: 'View Channel' },
  { key: 'sendMessages', short: 'Send', full: 'Send Messages' },
  { key: 'sendMessagesInThreads', short: 'Thrd', full: 'Send in Threads' },
  { key: 'readMessageHistory', short: 'Hist', full: 'Read History' },
  { key: 'embedLinks', short: 'Emb', full: 'Embed Links' },
  { key: 'attachFiles', short: 'Att', full: 'Attach Files' },
  { key: 'addReactions', short: 'React', full: 'Add Reactions' },
  { key: 'useExternalEmojis', short: 'Emoji', full: 'External Emojis' },
  { key: 'mentionEveryone', short: '@all', full: 'Mention Everyone' },
  { key: 'manageMessages', short: 'Mng', full: 'Manage Messages' },
];

guildDebugRoutes.get('/:guildId/debug/channels', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'member');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;
  if (!session.isOwner) return c.text('Forbidden', 403);

  const [data, commandsData] = isInternalApiEnabled()
    ? await Promise.all([fetchBotChannels(guild.guildId), fetchBotCommands(guild.guildId)])
    : [
        {
          kind: 'unavailable',
          message: 'INTERNAL_API_TOKEN is not configured on the web app',
        } satisfies BotChannelsResponse,
        {
          kind: 'unavailable',
          message: 'INTERNAL_API_TOKEN is not configured on the web app',
        } satisfies BotCommandsResponse,
      ];

  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="debug"
    />
  );

  return c.html(
    <Layout
      title={`${guild.name} · debug`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Channel debug</h1>
          <p class="lead">
            Live discord.js view of every channel in <strong>{guild.name}</strong> and the bot's
            effective permissions in each. Owner-only.
          </p>
        </div>
      </div>

      <CommandsSection data={commandsData} />
      <ChannelDebugBody data={data} />
    </Layout>,
  );
});

function ChannelDebugBody(props: { data: BotChannelsResponse }) {
  const { data } = props;
  if (data.kind !== 'ok') {
    return (
      <div class="card">
        <h2>{titleForError(data.kind)}</h2>
        <p class="muted">{data.message}</p>
        {data.kind === 'not_cached' || data.kind === 'unavailable' ? (
          <p class="dim">
            Try refreshing in a few seconds. If the bot was just started its member cache may not be
            hydrated yet.
          </p>
        ) : null}
      </div>
    );
  }

  // Group channels by parent category.
  const byParent = new Map<string | null, BotChannelInfo[]>();
  for (const ch of data.channels) {
    const key = ch.parentId;
    const list = byParent.get(key) ?? [];
    list.push(ch);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);

  const orphans = byParent.get(null) ?? [];
  const cats = data.categories;

  return (
    <>
      <div class="card card-tight">
        <p class="muted" style="margin:0;">
          Bot member: <span class="mono">{data.botMemberTag}</span> · {data.channels.length}{' '}
          channels · {cats.length} categories
        </p>
      </div>

      {orphans.length > 0 ? <CategoryTable category={null} channels={orphans} /> : null}
      {cats.map((cat) => (
        <CategoryTable category={cat} channels={byParent.get(cat.id) ?? []} />
      ))}
    </>
  );
}

function CategoryTable(props: { category: BotCategoryInfo | null; channels: BotChannelInfo[] }) {
  const { category, channels } = props;
  return (
    <div class="card">
      <div class="card-header">
        <h2 style="margin:0;">{category ? category.name : 'No category'}</h2>
        <span class="dim mono">{channels.length} channels</span>
      </div>
      {channels.length === 0 ? (
        <p class="muted" style="margin:0;">
          No non-thread channels in this category.
        </p>
      ) : (
        <table class="data">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Type</th>
              {PERM_COLUMNS.map((col) => (
                <th title={col.full} style="text-align:center;">
                  {col.short}
                </th>
              ))}
              <th>Bitfield</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr>
                <td>
                  <div style="display:flex;flex-direction:column;gap:2px;">
                    <span>#{ch.name}</span>
                    <span class="mono dim" style="font-size:11px;">
                      {ch.id}
                    </span>
                  </div>
                </td>
                <td>
                  <span class="badge">{ch.typeLabel}</span>
                </td>
                {PERM_COLUMNS.map((col) => (
                  <td style="text-align:center;">
                    <span
                      class={`badge ${ch.perms[col.key] ? 'badge-allow' : 'badge-deny'}`}
                      title={`${col.full}: ${ch.perms[col.key] ? 'allow' : 'deny'}`}
                    >
                      {ch.perms[col.key] ? '✓' : '✕'}
                    </span>
                  </td>
                ))}
                <td class="mono" title={ch.effectiveBitfield}>
                  {ch.effectiveBitfield}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CommandsSection(props: { data: BotCommandsResponse }) {
  const { data } = props;
  if (data.kind !== 'ok') {
    return (
      <div class="card">
        <div class="card-header">
          <h2 style="margin:0;">Registered application commands</h2>
        </div>
        <p class="muted" style="margin:0;">
          {titleForError(data.kind)}: {data.message}
        </p>
        {data.kind === 'not_cached' ? (
          <p class="dim" style="margin:8px 0 0;">
            <code>client.application</code> isn't ready yet — try again in a moment.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div class="card">
      <div class="card-header">
        <h2 style="margin:0;">Registered application commands</h2>
        <span class="dim mono">
          {data.global.length} global · {data.guildScoped.length} guild-scoped
        </span>
      </div>
      <p class="muted" style="margin:0 0 12px;">
        What Discord currently has on file for this bot. If a command isn't in this list, it has not
        been registered yet — usually that means the bot hasn't been restarted with the latest code,
        or a global registration is still propagating (can take up to ~1 hour).
      </p>

      {data.global.length > 0 ? <CommandsTable label="Global" rows={data.global} /> : null}
      {data.guildScoped.length > 0 ? (
        <CommandsTable label="Guild-scoped" rows={data.guildScoped} />
      ) : null}
    </div>
  );
}

function CommandsTable(props: { label: string; rows: BotCommandInfo[] }) {
  return (
    <>
      <h3 style="margin:8px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;">
        {props.label}
      </h3>
      <table class="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Default member perms</th>
            <th>DMs?</th>
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((cmd) => (
            <tr>
              <td>
                <span class="mono">
                  {cmd.kind === 'chat_input' ? '/' : ''}
                  {cmd.name}
                </span>
              </td>
              <td>
                <span class="badge">{labelKind(cmd.kind)}</span>
              </td>
              <td
                class="mono"
                title="Decimal bitfield; null = no Discord-side gate (open to everyone in the picker)"
              >
                {cmd.defaultMemberPermissions ?? <span class="dim">—</span>}
              </td>
              <td>
                {cmd.dmPermission == null ? (
                  <span class="dim">—</span>
                ) : (
                  <span class={`badge ${cmd.dmPermission ? 'badge-allow' : 'badge-deny'}`}>
                    {cmd.dmPermission ? 'yes' : 'no'}
                  </span>
                )}
              </td>
              <td class="mono dim" style="font-size:11px;">
                {cmd.id}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function labelKind(kind: BotCommandInfo['kind']): string {
  switch (kind) {
    case 'chat_input':
      return 'slash';
    case 'user_context':
      return 'user-menu';
    case 'message_context':
      return 'message-menu';
    case 'unknown':
      return 'unknown';
  }
}

function titleForError(kind: 'not_found' | 'not_cached' | 'unauthorized' | 'unavailable'): string {
  switch (kind) {
    case 'not_found':
      return 'Guild not found in bot';
    case 'not_cached':
      return 'Bot member not cached yet';
    case 'unauthorized':
      return 'Internal API rejected the request';
    case 'unavailable':
      return 'Bot internal API is not available';
  }
}
