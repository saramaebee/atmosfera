import {
  type BotCategoryInfo,
  type BotChannelInfo,
  type BotChannelPerms,
  type BotChannelsResponse,
  isInternalApiEnabled,
} from '@atmosfera/config';
import { Hono } from 'hono';
import { fetchBotChannels } from '../lib/botApi';
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

  const data = isInternalApiEnabled()
    ? await fetchBotChannels(guild.guildId)
    : ({
        kind: 'unavailable',
        message: 'INTERNAL_API_TOKEN is not configured on the web app',
      } satisfies BotChannelsResponse);

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
