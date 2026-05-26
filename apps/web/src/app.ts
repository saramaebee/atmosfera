import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { authRoutes } from './auth/discord';
import { sessionMiddleware } from './auth/session';
import { adminRoutes } from './routes/admin';
import { auditRoutes } from './routes/audit';
import { configRoutes } from './routes/config';
import { explainChannelsRoutes } from './routes/explainChannels';
import { explainRolesRoutes } from './routes/explainRoles';
import { guildRoutes } from './routes/guild';
import { guildDebugRoutes } from './routes/guildDebug';
import { guildRoastTracesRoutes } from './routes/guildRoastTraces';
import { guildsRoutes } from './routes/guilds';
import { indexRoutes } from './routes/index_';
import { meRoutes } from './routes/me';
import { permsRoutes } from './routes/perms';
import { roastKnobsRoutes } from './routes/roastKnobs';
import { usersRoutes } from './routes/users';
import type { AppEnv } from './types';

export const app = new Hono<AppEnv>();

app.use('*', logger());
app.use('*', sessionMiddleware());

app.route('/', indexRoutes);
app.route('/auth', authRoutes);
app.route('/guilds', guildsRoutes);
app.route('/g', guildRoutes);
app.route('/g', meRoutes);
app.route('/g', auditRoutes);
app.route('/g', configRoutes);
app.route('/g', permsRoutes);
app.route('/g', explainRolesRoutes);
app.route('/g', explainChannelsRoutes);
app.route('/g', usersRoutes);
app.route('/g', guildDebugRoutes);
app.route('/g', guildRoastTracesRoutes);
app.route('/g', roastKnobsRoutes);
app.route('/admin', adminRoutes);

app.notFound((c) => c.text('Not found', 404));
app.onError((err, c) => {
  console.error('web error:', err);
  return c.text('Internal error', 500);
});
