import { type ExplainMode, recordAuditEvent } from '@atmosfera/db';
import {
  addExplainChannel,
  getExplainMode,
  listExplainChannels,
  removeExplainChannel,
  setExplainMode,
} from '@atmosfera/explain';
import { Hono } from 'hono';
import { fetchBotChannels, syncExplainCommand } from '../lib/botApi';
import { resolveGuild } from '../middleware/requireGuild';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildSidebar } from '../views/components';
import { Layout } from '../views/layout';

export const explainChannelsRoutes = new Hono<AppEnv>();

// Discord ChannelType numeric values (BotChannelInfo.type) that Explain can run in.
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;

function isMode(s: string): s is ExplainMode {
  return s === 'everywhere' || s === 'allowlist' || s === 'off';
}

function formatMode(mode: ExplainMode): string {
  return mode === 'everywhere'
    ? 'Everywhere'
    : mode === 'allowlist'
      ? 'Only specific channels'
      : 'Disabled';
}

// ─── Page ──────────────────────────────────────────────────────────────────

explainChannelsRoutes.get('/:guildId/explain-channels', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;

  const mode = getExplainMode(guild.guildId);
  const rows = listExplainChannels(guild.guildId);

  const channelsResp = await fetchBotChannels(guild.guildId);
  const liveChannels = channelsResp.kind === 'ok' ? channelsResp.channels : [];
  const nameById = new Map<string, string>(liveChannels.map((ch) => [ch.id, ch.name]));
  const pickable = liveChannels.filter(
    (ch) => ch.type === GUILD_TEXT || ch.type === GUILD_ANNOUNCEMENT,
  );
  const botUnavailable = channelsResp.kind !== 'ok' ? channelsResp.message : null;

  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="explain-channels"
    />
  );

  const modeAction = `/g/${guild.guildId}/explain-channels/mode`;

  return c.html(
    <Layout
      title={`${guild.name} · explain channels`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Explain — availability</h1>
          <p class="lead">
            Control where the right-click → Apps → <code>Explain</code> command can be used.
            Equivalent to <code>/explain-setup channels</code> — both surfaces write the same audit
            events. <strong>Disable everywhere</strong> removes the command from this server
            entirely (it won't even appear in the Apps menu).
          </p>
        </div>
      </div>

      {botUnavailable ? (
        <div class="empty" style="margin-bottom:16px;">
          The bot is currently unreachable ({botUnavailable}). Changes are saved, but the command's
          visibility in the Apps menu will only update on the next bot restart.
        </div>
      ) : null}

      <div class="card">
        <h2>Mode</h2>
        <p style="margin:0 0 12px;">
          Current mode: <span class="badge">{formatMode(mode)}</span>
        </p>
        <div class="row">
          <form method="post" action={modeAction} class="inline">
            <input type="hidden" name="mode" value="everywhere" />
            <button type="submit" disabled={mode === 'everywhere'}>
              Allow everywhere
            </button>
          </form>
          {rows.length > 0 ? (
            <form method="post" action={modeAction} class="inline">
              <input type="hidden" name="mode" value="allowlist" />
              <button type="submit" disabled={mode === 'allowlist'}>
                Use only these channels
              </button>
            </form>
          ) : null}
          <form method="post" action={modeAction} class="inline">
            <input type="hidden" name="mode" value="off" />
            <button type="submit" class="danger" disabled={mode === 'off'}>
              Disable everywhere
            </button>
          </form>
        </div>
      </div>

      <div class="card">
        <h2>Channel allowlist</h2>
        <p class="dim" style="font-size:12px;margin:0 0 12px;">
          Adding a channel switches the mode to “only specific channels”. Removing the last channel
          returns to “everywhere”.
        </p>
        {botUnavailable ? (
          <p class="muted" style="margin:0 0 12px;">
            Live channel list unavailable — falling back to a manual channel-ID input.
          </p>
        ) : null}
        <form method="post" action={`/g/${guild.guildId}/explain-channels/add`} class="row">
          {pickable.length > 0 ? (
            <label>
              channel{' '}
              <select name="channelId" required>
                {pickable.map((ch) => (
                  <option value={ch.id}>#{ch.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              channel id{' '}
              <input
                type="text"
                name="channelId"
                placeholder="snowflake"
                required
                pattern="\d{17,20}"
              />
            </label>
          )}
          <button type="submit">Add</button>
        </form>

        {rows.length === 0 ? (
          <div class="empty" style="margin-top:12px;">
            No channels in the allowlist.
          </div>
        ) : (
          <table class="data" style="margin-top:12px;">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Added by</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr>
                  <td>
                    {nameById.has(row.channelId) ? (
                      `#${nameById.get(row.channelId)}`
                    ) : (
                      <span class="dim">unknown channel</span>
                    )}{' '}
                    <span class="dim mono" style="font-size:11px;">
                      ({row.channelId})
                    </span>
                  </td>
                  <td class="mono">{row.setBy}</td>
                  <td class="mono">{new Date(row.setAt).toISOString().slice(0, 10)}</td>
                  <td>
                    <form
                      method="post"
                      action={`/g/${guild.guildId}/explain-channels/remove`}
                      class="inline"
                    >
                      <input type="hidden" name="channelId" value={row.channelId} />
                      <button type="submit" class="danger">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>,
  );
});

// ─── Mutations ───────────────────────────────────────────────────────────────

explainChannelsRoutes.post('/:guildId/explain-channels/mode', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const form = await c.req.formData();
  const mode = String(form.get('mode') ?? '');
  if (!isMode(mode)) return c.text('Bad mode', 400);

  const { previous } = setExplainMode({
    guildId: guild.guildId,
    mode,
    setBy: session.session.discordUserId,
  });
  recordAuditEvent(getWebDb(), {
    guildId: guild.guildId,
    actorId: session.session.discordUserId,
    eventType: 'explain.mode.set',
    subjectType: 'guild',
    subjectId: guild.guildId,
    metadata: { mode, previous, via: 'web' },
  });
  await syncExplainCommand(guild.guildId);

  return c.redirect(`/g/${guild.guildId}/explain-channels`);
});

explainChannelsRoutes.post('/:guildId/explain-channels/add', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const form = await c.req.formData();
  const channelId = String(form.get('channelId') ?? '').trim();
  if (!/^\d{17,20}$/.test(channelId)) return c.text('Bad channelId', 400);

  const { added } = addExplainChannel({
    guildId: guild.guildId,
    channelId,
    setBy: session.session.discordUserId,
  });

  if (added) {
    let channelName: string | null = null;
    const channelsResp = await fetchBotChannels(guild.guildId);
    if (channelsResp.kind === 'ok') {
      channelName = channelsResp.channels.find((ch) => ch.id === channelId)?.name ?? null;
    }
    recordAuditEvent(getWebDb(), {
      guildId: guild.guildId,
      actorId: session.session.discordUserId,
      eventType: 'explain.channel.add',
      subjectType: 'channel',
      subjectId: channelId,
      metadata: { channelName, mode: 'allowlist', via: 'web' },
    });
  }
  await syncExplainCommand(guild.guildId);

  return c.redirect(`/g/${guild.guildId}/explain-channels`);
});

explainChannelsRoutes.post('/:guildId/explain-channels/remove', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const form = await c.req.formData();
  const channelId = String(form.get('channelId') ?? '').trim();
  if (!/^\d{17,20}$/.test(channelId)) return c.text('Bad channelId', 400);

  const { removed, mode } = removeExplainChannel({
    guildId: guild.guildId,
    channelId,
    setBy: session.session.discordUserId,
  });

  if (removed) {
    let channelName: string | null = null;
    const channelsResp = await fetchBotChannels(guild.guildId);
    if (channelsResp.kind === 'ok') {
      channelName = channelsResp.channels.find((ch) => ch.id === channelId)?.name ?? null;
    }
    recordAuditEvent(getWebDb(), {
      guildId: guild.guildId,
      actorId: session.session.discordUserId,
      eventType: 'explain.channel.remove',
      subjectType: 'channel',
      subjectId: channelId,
      metadata: { channelName, mode, via: 'web' },
    });
    await syncExplainCommand(guild.guildId);
  }

  return c.redirect(`/g/${guild.guildId}/explain-channels`);
});
