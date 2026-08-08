import { botGuildStats } from '@atmosfera/db';
import { Hono } from 'hono';
import { listSwitchableGuilds } from '../auth/authz';
import { requireSession } from '../auth/session';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildCard, StatTile } from '../views/components';
import { Icon } from '../views/icons';
import { Layout } from '../views/layout';

export const guildsRoutes = new Hono<AppEnv>();

guildsRoutes.get('/', (c) => {
  const ctxOrRes = requireSession(c);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  const guilds = listSwitchableGuilds(ctx);
  const stats = ctx.isOwner ? botGuildStats(getWebDb()) : null;

  return c.html(
    <Layout title="Guilds" session={ctx}>
      <div class="page-header">
        <div class="titles">
          <h1>Your guilds</h1>
          {ctx.isOwner ? (
            <p class="lead">
              You're a bot owner — every guild atmosfera is in is listed below. Use the switcher in
              the header or pick one to jump in.
            </p>
          ) : (
            <p class="lead">
              Guilds where both you and atmosfera are members. Admins (Manage Server) get the
              moderation pages; everyone else can manage their own personal settings.
            </p>
          )}
        </div>
        {ctx.isOwner ? (
          <a class="btn secondary" href="/admin">
            <Icon.Sparkles />
            <span>View /admin stats</span>
            <Icon.Arrow />
          </a>
        ) : null}
      </div>

      {stats ? (
        <div class="stat-grid">
          <StatTile label="Active guilds" value={stats.activeCount} accent />
          <StatTile label="Joined last 7 days" value={stats.joinedLast7d} />
          <StatTile label="Joined last 30 days" value={stats.joinedLast30d} />
          <StatTile label="Departures last 30 days" value={stats.leftLast30d} />
        </div>
      ) : null}

      {guilds.length === 0 ? (
        <div class="empty">
          <div class="empty-icon">
            <Icon.Layers size={20} />
          </div>
          <h3>No mutual guilds yet</h3>
          <p>Invite atmosfera to a server you moderate, then refresh this page.</p>
        </div>
      ) : (
        <div class="guild-grid">
          {guilds.map((g) => (
            <GuildCard guild={g} />
          ))}
        </div>
      )}
    </Layout>,
  );
});
