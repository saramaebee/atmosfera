import {
  type ExplainGuildRoleRow,
  type ExplainLanguage,
  type ExplainTier,
  recordAuditEvent,
} from '@atmosfera/db';
import { listGuildRoles, removeGuildRole, setGuildRole } from '@atmosfera/explain';
import { Hono } from 'hono';
import { fetchBotRoles } from '../lib/botApi';
import { resolveGuild } from '../middleware/requireGuild';
import { getWebDb } from '../state';
import type { AppEnv } from '../types';
import { GuildSidebar } from '../views/components';
import { Layout } from '../views/layout';

export const explainRolesRoutes = new Hono<AppEnv>();

const LANGUAGES: { value: ExplainLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'other', label: 'Other (native of a third language)' },
];

const TIERS: { value: ExplainTier; label: string }[] = [
  { value: 'native', label: 'native' },
  { value: 'fluent', label: 'fluent' },
  { value: 'intermediate', label: 'intermediate' },
  { value: 'beginner', label: 'beginner' },
];

function isLanguage(s: string): s is ExplainLanguage {
  return LANGUAGES.some((l) => l.value === s);
}
function isTier(s: string): s is ExplainTier {
  return TIERS.some((t) => t.value === s);
}
function labelLanguage(lang: ExplainLanguage): string {
  return LANGUAGES.find((l) => l.value === lang)?.label ?? lang;
}

interface ResolvedRole {
  name: string;
  color: number;
}

function colorHex(color: number): string | null {
  if (!color) return null;
  return `#${color.toString(16).padStart(6, '0')}`;
}

// ─── Page ──────────────────────────────────────────────────────────────────

explainRolesRoutes.get('/:guildId/explain-roles', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild, role } = r;

  const mappings = listGuildRoles(guild.guildId);
  const rolesResp = await fetchBotRoles(guild.guildId);
  const liveRoles = rolesResp.kind === 'ok' ? rolesResp.roles : [];
  const roleById = new Map<string, ResolvedRole>(
    liveRoles.map((rr) => [rr.id, { name: rr.name, color: rr.color }]),
  );
  // Pickable roles = everything except @everyone and bot-managed integration roles.
  const pickableRoles = liveRoles.filter((rr) => !rr.everyone && !rr.managed);
  const liveUnavailableMessage = rolesResp.kind !== 'ok' ? rolesResp.message : null;

  const sidebar = (
    <GuildSidebar
      guildId={guild.guildId}
      guildName={guild.name}
      iconHash={guild.iconHash}
      role={role}
      active="explain-roles"
    />
  );

  return c.html(
    <Layout
      title={`${guild.name} · explain roles`}
      session={session}
      activeGuildId={guild.guildId}
      sidebar={sidebar}
    >
      <div class="page-header">
        <div class="titles">
          <h1>Explain — role mappings</h1>
          <p class="lead">
            Tell <code>/Explain</code> which server roles identify native, fluent, or learning
            speakers of each language. The bot uses this to weight explanations from native speakers
            in surrounding messages. Equivalent to the <code>/explain-setup</code> slash command —
            both surfaces write the same audit events.
          </p>
        </div>
      </div>

      <div class="card">
        <h2>Add mapping</h2>
        {liveUnavailableMessage ? (
          <p class="muted" style="margin:0 0 12px;">
            Live role list unavailable ({liveUnavailableMessage}). Falling back to a manual role-ID
            input.
          </p>
        ) : null}
        <form method="post" action={`/g/${guild.guildId}/explain-roles/upsert`} class="row">
          {pickableRoles.length > 0 ? (
            <label>
              role{' '}
              <select name="roleId" required>
                {pickableRoles.map((rr) => (
                  <option value={rr.id}>
                    {rr.name}
                    {rr.color ? ` (${colorHex(rr.color)})` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              role id{' '}
              <input
                type="text"
                name="roleId"
                placeholder="snowflake"
                required
                pattern="\d{17,20}"
              />
            </label>
          )}
          <label>
            language{' '}
            <select name="language" required>
              {LANGUAGES.map((l) => (
                <option value={l.value}>{l.label}</option>
              ))}
            </select>
          </label>
          <label>
            tier{' '}
            <select name="tier" required>
              {TIERS.map((t) => (
                <option value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <button type="submit">Save</button>
        </form>
        <p class="dim" style="font-size:12px;margin:8px 0 0;">
          Submitting an existing role overwrites its current mapping.
        </p>
      </div>

      {mappings.length === 0 ? (
        <div class="empty">
          No mappings configured. <code>/Explain</code> will fall back to AI-inferred authority
          based on the surrounding conversation.
        </div>
      ) : (
        <div class="card">
          <h2>Current mappings</h2>
          <table class="data">
            <thead>
              <tr>
                <th>Role</th>
                <th>Language</th>
                <th>Tier</th>
                <th>Set by</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mappings.map((m: ExplainGuildRoleRow) => {
                const live = roleById.get(m.roleId);
                const swatch = live ? colorHex(live.color) : null;
                return (
                  <tr>
                    <td>
                      {swatch ? (
                        <span
                          aria-hidden="true"
                          style={`display:inline-block;width:10px;height:10px;border-radius:50%;background:${swatch};margin-right:6px;vertical-align:middle;`}
                        />
                      ) : null}
                      {live ? live.name : <span class="dim">unknown role</span>}{' '}
                      <span class="dim mono" style="font-size:11px;">
                        ({m.roleId})
                      </span>
                    </td>
                    <td>{labelLanguage(m.language)}</td>
                    <td>
                      <span class="badge">{m.tier}</span>
                    </td>
                    <td class="mono">{m.setBy}</td>
                    <td class="mono">{new Date(m.setAt).toISOString().slice(0, 10)}</td>
                    <td>
                      <form
                        method="post"
                        action={`/g/${guild.guildId}/explain-roles/remove`}
                        class="inline"
                      >
                        <input type="hidden" name="roleId" value={m.roleId} />
                        <button type="submit" class="danger">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Layout>,
  );
});

explainRolesRoutes.post('/:guildId/explain-roles/upsert', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const form = await c.req.formData();
  const roleId = String(form.get('roleId') ?? '').trim();
  const language = String(form.get('language') ?? '');
  const tier = String(form.get('tier') ?? '');

  if (!/^\d{17,20}$/.test(roleId)) return c.text('Bad roleId', 400);
  if (!isLanguage(language)) return c.text('Bad language', 400);
  if (!isTier(tier)) return c.text('Bad tier', 400);

  // Best-effort role-name lookup so the audit event is searchable later.
  let roleName: string | null = null;
  const rolesResp = await fetchBotRoles(guild.guildId);
  if (rolesResp.kind === 'ok') {
    roleName = rolesResp.roles.find((rr) => rr.id === roleId)?.name ?? null;
  }

  const { previous, current } = setGuildRole({
    guildId: guild.guildId,
    roleId,
    language,
    tier,
    setBy: session.session.discordUserId,
  });

  recordAuditEvent(getWebDb(), {
    guildId: guild.guildId,
    actorId: session.session.discordUserId,
    eventType: 'explain.role.add',
    subjectType: 'role',
    subjectId: roleId,
    metadata: {
      roleName,
      language: current.language,
      tier: current.tier,
      previousLanguage: previous?.language ?? null,
      previousTier: previous?.tier ?? null,
      via: 'web',
    },
  });

  return c.redirect(`/g/${guild.guildId}/explain-roles`);
});

explainRolesRoutes.post('/:guildId/explain-roles/remove', async (c) => {
  const r = resolveGuild(c, c.req.param('guildId'), 'admin');
  if (r instanceof Response) return r;
  const { session, guild } = r;
  const form = await c.req.formData();
  const roleId = String(form.get('roleId') ?? '').trim();
  if (!/^\d{17,20}$/.test(roleId)) return c.text('Bad roleId', 400);

  const removed = removeGuildRole(guild.guildId, roleId);
  if (!removed) {
    return c.redirect(`/g/${guild.guildId}/explain-roles`);
  }

  let roleName: string | null = null;
  const rolesResp = await fetchBotRoles(guild.guildId);
  if (rolesResp.kind === 'ok') {
    roleName = rolesResp.roles.find((rr) => rr.id === roleId)?.name ?? null;
  }

  recordAuditEvent(getWebDb(), {
    guildId: guild.guildId,
    actorId: session.session.discordUserId,
    eventType: 'explain.role.remove',
    subjectType: 'role',
    subjectId: roleId,
    metadata: {
      roleName,
      previousLanguage: removed.language,
      previousTier: removed.tier,
      via: 'web',
    },
  });

  return c.redirect(`/g/${guild.guildId}/explain-roles`);
});
