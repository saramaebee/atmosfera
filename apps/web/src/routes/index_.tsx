import { Hono } from 'hono';
import { getSession } from '../auth/session';
import type { AppEnv } from '../types';
import { Icon } from '../views/icons';
import { Layout } from '../views/layout';

export const indexRoutes = new Hono<AppEnv>();

indexRoutes.get('/', (c) => {
  const ctx = getSession(c);
  if (ctx) return c.redirect('/guilds');
  return c.html(
    <Layout title="Sign in">
      <div class="login">
        <div class="login-mark">
          <Icon.Sparkles size={28} />
        </div>
        <h1>atmosfera</h1>
        <p class="lead">
          Moderation dashboard for the atmosfera Discord bot. Manage permissions, audit logs, and
          per-guild config for servers where you have Manage Server.
        </p>
        <a class="btn btn-large" href="/auth/discord/start">
          Sign in with Discord
        </a>
      </div>
    </Layout>,
  );
});
