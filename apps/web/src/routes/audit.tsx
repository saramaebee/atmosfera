import { listAuditEvents, parseAuditMetadata } from '@atmosfera/db';
import { Hono } from 'hono';
import { resolveGuild } from '../middleware/requireGuild';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildSidebar } from '../views/components';
import { Layout } from '../views/layout';

export const auditRoutes = new Hono<AppEnv>();

const SINCE_OPTIONS: Record<string, number | undefined> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: undefined,
};

const PAGE = 50;

auditRoutes.get('/:guildId/audit', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;
  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="audit"
    />
  );

  const sinceParam = c.req.query('since') ?? '30d';
  const sinceMs = SINCE_OPTIONS[sinceParam] ?? SINCE_OPTIONS['30d'];
  const since = sinceMs ? Date.now() - sinceMs : undefined;
  const pattern = c.req.query('type') ?? '';
  const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;

  const events = listAuditEvents(getWebDb(), {
    guildId: guild.guildId,
    since,
    eventTypePattern: pattern ? `${pattern}%` : undefined,
    limit: PAGE + 1,
    offset,
  });
  const hasMore = events.length > PAGE;
  const rows = hasMore ? events.slice(0, PAGE) : events;

  return c.html(
    <Layout
      title={`${guild.name} · audit`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Audit log</h1>
          <p class="lead">
            Every admin-facing change in <strong>{guild.name}</strong> — permissions, config, user
            opt-ins. Indefinite retention.
          </p>
        </div>
      </div>

      <form class="card" method="get" action={`/g/${guild.guildId}/audit`}>
        <div class="row">
          <label>
            since{' '}
            <select name="since">
              {Object.keys(SINCE_OPTIONS).map((k) => (
                <option value={k} selected={k === sinceParam}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            type prefix{' '}
            <input type="text" name="type" value={pattern} placeholder="e.g. permission." />
          </label>
          <button type="submit">Filter</button>
        </div>
      </form>

      {rows.length === 0 ? (
        <div class="empty">No events match.</div>
      ) : (
        <table class="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Actor</th>
              <th>Subject</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const meta = parseAuditMetadata(row);
              return (
                <tr>
                  <td class="mono">
                    {new Date(row.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                  </td>
                  <td class="mono">{row.eventType}</td>
                  <td class="mono">{row.actorId}</td>
                  <td class="mono">
                    {row.subjectType}:{row.subjectId}
                  </td>
                  <td>
                    {meta ? (
                      <pre>{JSON.stringify(meta, null, 2)}</pre>
                    ) : (
                      <span class="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div class="row" style="margin-top:16px;">
        {offset > 0 ? (
          <a
            class="btn secondary"
            href={`/g/${guild.guildId}/audit?since=${sinceParam}&type=${encodeURIComponent(pattern)}&offset=${Math.max(0, offset - PAGE)}`}
          >
            ← Newer
          </a>
        ) : null}
        {hasMore ? (
          <a
            class="btn secondary"
            href={`/g/${guild.guildId}/audit?since=${sinceParam}&type=${encodeURIComponent(pattern)}&offset=${offset + PAGE}`}
          >
            Older →
          </a>
        ) : null}
      </div>
    </Layout>,
  );
});
