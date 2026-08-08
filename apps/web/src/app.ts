import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authRoutes } from './auth/discord';
import { sessionMiddleware } from './auth/session';
import { adminRoutes } from './routes/admin';
import { auditRoutes } from './routes/audit';
import { explainChannelsRoutes } from './routes/explainChannels';
import { explainRolesRoutes } from './routes/explainRoles';
import { guildRoutes } from './routes/guild';
import { guildDebugRoutes } from './routes/guildDebug';
import { guildsRoutes } from './routes/guilds';
import { indexRoutes } from './routes/index_';
import { permsRoutes } from './routes/perms';
import type { AppEnv } from './types';

export const app = new Hono<AppEnv>();

app.use('*', logger());
app.use('*', sessionMiddleware());

app.route('/', indexRoutes);
app.route('/auth', authRoutes);
app.route('/guilds', guildsRoutes);
app.route('/g', guildRoutes);
app.route('/g', auditRoutes);
app.route('/g', permsRoutes);
app.route('/g', explainRolesRoutes);
app.route('/g', explainChannelsRoutes);
app.route('/g', guildDebugRoutes);
app.route('/admin', adminRoutes);

app.notFound((c) => c.text('Not found', 404));
app.onError((err, c) => {
  console.error('web error:', err);
  return c.text('Internal error', 500);
});
