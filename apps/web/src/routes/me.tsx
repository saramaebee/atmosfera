import { recordAuditEvent } from '@atmosfera/db';
import {
  OPTOUT_LOCK_MS,
  clearBrutalOptin,
  getGuildConfig,
  getRoastOptoutState,
  hasBrutalOptin,
  setBrutalOptin,
  setRoastOptedIn,
  setRoastOptedOut,
} from '@atmosfera/user-roast';
import { Hono } from 'hono';
import { resolveGuild } from '../middleware/requireGuild';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildSidebar } from '../views/components';
import { Layout } from '../views/layout';

export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/:guildId/me', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'member');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;
  const userId = session.session.discordUserId;
  const cfg = getGuildConfig(guild.guildId);
  const brutal = hasBrutalOptin(userId, guild.guildId);
  const optout = getRoastOptoutState(userId, guild.guildId);

  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="me"
    />
  );

  return c.html(
    <Layout
      title={`${guild.name} · me`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Your settings</h1>
          <p class="lead">
            How the bot treats you in <strong>{guild.name}</strong>. Only affects you.
          </p>
        </div>
      </div>

      <div class="card">
        <h2>Brutal roasts</h2>
        {cfg.brutal_allowed ? (
          <>
            <p>
              When opted in, the bot is allowed to use a much sharper tone when roasting you. You
              can change this at any time.
            </p>
            <form method="post" action={`/g/${guild.guildId}/me/brutal/toggle`}>
              <button type="submit" class={brutal ? 'danger' : ''}>
                {brutal ? 'Opt out of brutal' : 'Opt in to brutal'}
              </button>
              <span class="muted" style="margin-left:12px;">
                currently: <strong>{brutal ? 'opted in' : 'opted out'}</strong>
              </span>
            </form>
          </>
        ) : (
          <p class="muted">
            Brutal mode isn't allowed in this server. Ask a server admin to enable it in{' '}
            <code>/g/{guild.guildId}/config</code> if you want it.
          </p>
        )}
      </div>

      <div class="card">
        <h2>Roast opt-out</h2>
        <p>
          If you opt out, the bot won't roast you. Opting back in locks you in for 30 days to
          prevent abuse — same rule as the <code>/roast-optout</code>
          slash command.
        </p>
        {optout.optedOut ? (
          <form method="post" action={`/g/${guild.guildId}/me/optout/in`}>
            <button type="submit">Opt back in (locks for 30 days)</button>
            <span class="muted" style="margin-left:12px;">
              currently: opted out
            </span>
          </form>
        ) : (
          <form method="post" action={`/g/${guild.guildId}/me/optout/out`}>
            <button type="submit" class="danger">
              Opt out of being roasted
            </button>
            <span class="muted" style="margin-left:12px;">
              currently: opted in
              {optout.lockedUntil && optout.lockedUntil > Date.now()
                ? ` (locked until ${new Date(optout.lockedUntil).toISOString().slice(0, 10)})`
                : ''}
            </span>
          </form>
        )}
        {optout.lockedUntil && optout.lockedUntil > Date.now() && !optout.optedOut ? (
          <p class="muted" style="margin-top:8px;">
            Opt-out is locked until {new Date(optout.lockedUntil).toISOString().slice(0, 10)}.
          </p>
        ) : null}
      </div>
    </Layout>,
  );
});

meRoutes.post('/:guildId/me/brutal/toggle', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'member');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const cfg = getGuildConfig(guild.guildId);
  if (!cfg.brutal_allowed) return c.text('Brutal is not allowed in this guild', 403);
  const userId = session.session.discordUserId;
  const wasOptedIn = hasBrutalOptin(userId, guild.guildId);
  if (wasOptedIn) {
    clearBrutalOptin(userId, guild.guildId);
  } else {
    setBrutalOptin(userId, guild.guildId);
  }
  recordAuditEvent(getWebDb(), {
    guildId: guild.guildId,
    actorId: userId,
    eventType: wasOptedIn ? 'roast.brutal.optout' : 'roast.brutal.optin',
    subjectType: 'user',
    subjectId: userId,
    metadata: { via: 'web' },
  });
  return c.redirect(`/g/${guild.guildId}/me`);
});

meRoutes.post('/:guildId/me/optout/out', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'member');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const userId = session.session.discordUserId;
  setRoastOptedOut(userId, guild.guildId);
  recordAuditEvent(getWebDb(), {
    guildId: guild.guildId,
    actorId: userId,
    eventType: 'roast.optout.set',
    subjectType: 'user',
    subjectId: userId,
    metadata: { via: 'web' },
  });
  return c.redirect(`/g/${guild.guildId}/me`);
});

meRoutes.post('/:guildId/me/optout/in', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'member');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const userId = session.session.discordUserId;
  const state = getRoastOptoutState(userId, guild.guildId);
  if (state.lockedUntil && state.lockedUntil > Date.now()) {
    return c.text('Opt-out is locked; cannot opt back in yet', 400);
  }
  setRoastOptedIn(userId, guild.guildId, OPTOUT_LOCK_MS);
  recordAuditEvent(getWebDb(), {
    guildId: guild.guildId,
    actorId: userId,
    eventType: 'roast.optout.clear',
    subjectType: 'user',
    subjectId: userId,
    metadata: { via: 'web', locks_until: Date.now() + OPTOUT_LOCK_MS },
  });
  return c.redirect(`/g/${guild.guildId}/me`);
});
