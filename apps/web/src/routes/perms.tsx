import {
  type CommandPermissionRule,
  listRulesForGuild,
  removeRule,
  upsertRule,
} from '@atmosfera/db';
import { Hono } from 'hono';
import { resolveGuild } from '../middleware/requireGuild';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildSidebar } from '../views/components';
import { Layout } from '../views/layout';

export const permsRoutes = new Hono<AppEnv>();

function groupByCommand(rules: CommandPermissionRule[]): Map<string, CommandPermissionRule[]> {
  const out = new Map<string, CommandPermissionRule[]>();
  for (const r of rules) {
    const list = out.get(r.commandName) ?? [];
    list.push(r);
    out.set(r.commandName, list);
  }
  return out;
}

permsRoutes.get('/:guildId/perms', (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;
  const rules = listRulesForGuild(getWebDb(), guild.guildId);
  const grouped = groupByCommand(rules);
  const commands = [...grouped.keys()].sort();
  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="perms"
    />
  );

  return c.html(
    <Layout
      title={`${guild.name} · perms`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Permissions</h1>
          <p class="lead">
            Per-guild RBAC overrides for slash commands in <strong>{guild.name}</strong>. Layered on
            top of each command's baseline scope.
          </p>
        </div>
      </div>

      <div class="card">
        <h2>Add rule</h2>
        <form method="post" action={`/g/${guild.guildId}/perms/upsert`} class="row">
          <label>
            command{' '}
            <input
              type="text"
              name="commandName"
              placeholder="e.g. roast"
              required
              pattern="[a-z0-9_-]+"
            />
          </label>
          <label>
            principal{' '}
            <select name="principalType">
              <option value="role">role</option>
              <option value="user">user</option>
            </select>
          </label>
          <label>
            id{' '}
            <input
              type="text"
              name="principalId"
              placeholder="snowflake"
              required
              pattern="\d{17,20}"
            />
          </label>
          <label>
            effect{' '}
            <select name="effect">
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
          </label>
          <button type="submit">Add</button>
        </form>
      </div>

      {commands.length === 0 ? (
        <div class="empty">No rules yet. The baseline scope on each command is in effect.</div>
      ) : (
        commands.map((cmd) => (
          <div class="card">
            <h2>/{cmd}</h2>
            <table class="data">
              <thead>
                <tr>
                  <th>Principal</th>
                  <th>ID</th>
                  <th>Effect</th>
                  <th>Granted by</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(grouped.get(cmd) ?? []).map((rule) => (
                  <tr>
                    <td>{rule.principalType}</td>
                    <td class="mono">{rule.principalId}</td>
                    <td>
                      <span class={`badge ${rule.effect}`}>{rule.effect}</span>
                    </td>
                    <td class="mono">{rule.grantedBy}</td>
                    <td class="mono">{new Date(rule.grantedAt).toISOString().slice(0, 10)}</td>
                    <td>
                      <form
                        method="post"
                        action={`/g/${guild.guildId}/perms/remove`}
                        class="inline"
                      >
                        <input type="hidden" name="commandName" value={rule.commandName} />
                        <input type="hidden" name="principalType" value={rule.principalType} />
                        <input type="hidden" name="principalId" value={rule.principalId} />
                        <button type="submit" class="danger">
                          Revoke
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </Layout>,
  );
});

permsRoutes.post('/:guildId/perms/upsert', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const form = await c.req.formData();
  const commandName = String(form.get('commandName') ?? '').trim();
  const principalType = String(form.get('principalType') ?? '');
  const principalId = String(form.get('principalId') ?? '').trim();
  const effect = String(form.get('effect') ?? '');

  if (!/^[a-z0-9_-]+$/.test(commandName)) return c.text('Bad commandName', 400);
  if (principalType !== 'role' && principalType !== 'user') return c.text('Bad principalType', 400);
  if (!/^\d{17,20}$/.test(principalId)) return c.text('Bad principalId', 400);
  if (effect !== 'allow' && effect !== 'deny') return c.text('Bad effect', 400);

  upsertRule(getWebDb(), {
    guildId: guild.guildId,
    commandName,
    principal: { type: principalType, id: principalId },
    effect,
    actorId: session.session.discordUserId,
    reason: 'web',
  });

  return c.redirect(`/g/${guild.guildId}/perms`);
});

permsRoutes.post('/:guildId/perms/remove', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const form = await c.req.formData();
  const commandName = String(form.get('commandName') ?? '').trim();
  const principalType = String(form.get('principalType') ?? '');
  const principalId = String(form.get('principalId') ?? '').trim();

  if (!commandName || (principalType !== 'role' && principalType !== 'user') || !principalId) {
    return c.text('Bad request', 400);
  }

  removeRule(getWebDb(), {
    guildId: guild.guildId,
    commandName,
    principal: { type: principalType, id: principalId },
    actorId: session.session.discordUserId,
  });

  return c.redirect(`/g/${guild.guildId}/perms`);
});
