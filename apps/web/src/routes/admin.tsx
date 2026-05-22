import { botGuildStats, listActiveBotGuilds, listAuditEvents } from '@atmosfera/db';
import { Hono } from 'hono';
import { requireSession } from '../auth/session';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildIcon, StatTile } from '../views/components';
import { Layout } from '../views/layout';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/', (c) => {
  const ctxOrRes = requireSession(c);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  if (!ctx.isOwner) return c.text('Forbidden', 403);

  const db = getWebDb();
  const stats = botGuildStats(db);
  const active = listActiveBotGuilds(db);
  const topByMembers = [...active]
    .filter((g) => g.memberCount !== null)
    .sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0))
    .slice(0, 10);

  const recent = listAuditEvents(db, { limit: 100 });

  return c.html(
    <Layout title="Admin" session={ctx}>
      <div class="page-header">
        <div class="titles">
          <h1>Admin</h1>
          <p class="lead">
            Cross-guild stats across every server atmosfera is in. Visible to bot owners only.
          </p>
        </div>
      </div>

      <div class="stat-grid">
        <StatTile label="Active guilds" value={stats.activeCount} accent />
        <StatTile label="Joined last 7d" value={stats.joinedLast7d} />
        <StatTile label="Joined last 30d" value={stats.joinedLast30d} />
        <StatTile label="Departures last 30d" value={stats.leftLast30d} />
        <StatTile label="Indexing enabled" value={stats.indexingEnabledCount} />
        <StatTile label="Brutal allowed" value={stats.brutalAllowedCount} />
      </div>

      <div class="card">
        <h2>Top 10 by member count</h2>
        <table class="data">
          <thead>
            <tr>
              <th />
              <th>Guild</th>
              <th>Members</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {topByMembers.map((g) => (
              <tr>
                <td>
                  <GuildIcon guildId={g.guildId} iconHash={g.iconHash} name={g.name} size="sm" />
                </td>
                <td>
                  <a href={`/g/${g.guildId}`}>{g.name}</a>
                </td>
                <td>{(g.memberCount ?? 0).toLocaleString()}</td>
                <td class="mono">{new Date(g.joinedAt).toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Recent audit events (all guilds)</h2>
        {recent.length === 0 ? (
          <div class="empty">No events yet.</div>
        ) : (
          <table class="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Guild</th>
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
                  <td class="mono">{row.guildId ?? '—'}</td>
                  <td class="mono">{row.eventType}</td>
                  <td class="mono">{row.actorId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>,
  );
});
