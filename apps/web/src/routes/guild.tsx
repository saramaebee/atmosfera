import { listAuditEvents } from '@atmosfera/db';
import { Hono } from 'hono';
import { canAdminister } from '../auth/authz';
import { resolveGuild } from '../middleware/requireGuild';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildIcon, GuildSidebar, RoleBadge } from '../views/components';
import { Icon } from '../views/icons';
import { Layout } from '../views/layout';

export const guildRoutes = new Hono<AppEnv>();

guildRoutes.get('/:guildId', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'member');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;
  const isAdmin = canAdminister(role);
  const recent = isAdmin ? listAuditEvents(getWebDb(), { guildId: guild.guildId, limit: 5 }) : [];

  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="overview"
    />
  );

  return c.html(
    <Layout title={guild.name} session={session} activeGuildId={guild.guildId} sidebar={sidebar}>
      <div class="guild-hero">
        <GuildIcon guildId={guild.guildId} iconHash={guild.iconHash} name={guild.name} size="lg" />
        <div class="meta">
          <h1>{guild.name}</h1>
          <div class="sub">
            <RoleBadge role={role} />
            {guild.memberCount !== null ? (
              <span>{guild.memberCount.toLocaleString()} members</span>
            ) : null}
          </div>
        </div>
      </div>

      {isAdmin ? (
        <div class="card">
          <div class="card-header">
            <h2>Recent activity</h2>
            <a href={`/g/${guild.guildId}/audit`} class="row-tight">
              <span>View full log</span>
              <Icon.Arrow size={14} />
            </a>
          </div>
          {recent.length === 0 ? (
            <div class="empty" style="padding:32px;">
              <h3>No events yet</h3>
              <p>Changes via the dashboard or the bot will show up here.</p>
            </div>
          ) : (
            <table class="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr>
                    <td class="mono">
                      {new Date(row.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                    </td>
                    <td class="mono">{row.eventType}</td>
                    <td class="mono">{row.actorId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div class="card">
          <h2>Moderation</h2>
          <p class="muted">
            You don't have Manage Server here — moderation pages (audit log, permissions) aren't
            available.
          </p>
        </div>
      )}
    </Layout>,
  );
});
