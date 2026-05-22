import { getDiscordUsers, listNotableUserSettings } from '@atmosfera/db';
import { Hono } from 'hono';
import { resolveGuild } from '../middleware/requireGuild';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildSidebar, userAvatarUrl } from '../views/components';
import { Layout } from '../views/layout';

export const usersRoutes = new Hono<AppEnv>();

usersRoutes.get('/:guildId/users', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;
  const notes = listNotableUserSettings(getWebDb(), guild.guildId);
  const cache = getDiscordUsers(
    getWebDb(),
    notes.map((n) => n.userId),
  );
  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="users"
    />
  );

  return c.html(
    <Layout
      title={`${guild.name} · users`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Users with notable settings</h1>
          <p class="lead">
            Members of <strong>{guild.name}</strong> who have opted into brutal mode, opted out of
            roasts, or are inside a 30-day opt-back-in lock.
          </p>
        </div>
      </div>

      {notes.length === 0 ? (
        <div class="empty">No notable settings yet.</div>
      ) : (
        <table class="data">
          <thead>
            <tr>
              <th>User</th>
              <th>ID</th>
              <th>Brutal</th>
              <th>Roast opt-out</th>
              <th>Lock expires</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => {
              const cached = cache.get(n.userId);
              const displayName = cached?.globalName ?? cached?.username ?? n.userId;
              const avatar = cached ? userAvatarUrl(n.userId, cached.avatarHash, 24) : null;
              return (
                <tr>
                  <td>
                    <div class="row" style="gap:8px;">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt=""
                          width={24}
                          height={24}
                          style="border-radius:50%;"
                        />
                      ) : null}
                      <span>{displayName}</span>
                    </div>
                  </td>
                  <td class="mono">{n.userId}</td>
                  <td>{n.brutalOptin ? <span class="badge allow">opted in</span> : '—'}</td>
                  <td>{n.optedOut ? <span class="badge deny">opted out</span> : '—'}</td>
                  <td class="mono">
                    {n.lockedUntil && n.lockedUntil > Date.now()
                      ? new Date(n.lockedUntil).toISOString().slice(0, 10)
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Layout>,
  );
});
