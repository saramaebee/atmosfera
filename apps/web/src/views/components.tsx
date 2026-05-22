import { type Role, type SwitcherGuild, listSwitchableGuilds } from '../auth/authz';
import type { SessionContext } from '../types';
import { Icon } from './icons';

export function guildIconUrl(guildId: string, iconHash: string | null, size = 64): string | null {
  if (!iconHash) return null;
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.png?size=${size}`;
}

export function userAvatarUrl(userId: string, avatarHash: string | null, size = 32): string | null {
  if (!avatarHash) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=${size}`;
}

export function GuildIcon(props: {
  guildId: string;
  iconHash: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass =
    props.size === 'sm' ? 'guild-icon-sm' : props.size === 'lg' ? 'guild-icon-lg' : '';
  const pxSize = props.size === 'sm' ? 32 : props.size === 'lg' ? 96 : 64;
  const url = guildIconUrl(props.guildId, props.iconHash, pxSize);
  if (url) {
    return (
      <div class={`guild-icon ${sizeClass}`}>
        <img src={url} alt="" />
      </div>
    );
  }
  return <div class={`guild-icon ${sizeClass}`}>{props.name.charAt(0).toUpperCase()}</div>;
}

export function RoleBadge(props: { role: Role }) {
  if (props.role === 'none') return null;
  const label = props.role;
  return <span class={`badge badge-${props.role}`}>{label}</span>;
}

/**
 * Unified guild switcher. Same component for every signed-in user — only the
 * list contents differ by role (mutual guilds for non-owners; every active
 * bot guild for owners).
 */
export function GuildSwitcher(props: {
  session: SessionContext;
  activeGuildId?: string;
}) {
  const guilds = listSwitchableGuilds(props.session);
  if (guilds.length === 0) {
    return <span class="dim">No guilds available</span>;
  }
  return (
    <div class="switcher">
      <select
        onchange="location.href=this.value ? '/g/'+this.value : '/guilds'"
        aria-label="Switch guild"
      >
        <option value="" selected={!props.activeGuildId}>
          Switch guild…
        </option>
        {guilds.map((g) => (
          <option value={g.id} selected={g.id === props.activeGuildId}>
            {g.name}
            {g.role !== 'member' && g.role !== 'none' ? ` · ${g.role}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

export function GuildCard(props: { guild: SwitcherGuild }) {
  return (
    <a class="guild-card" href={`/g/${props.guild.id}`}>
      <GuildIcon guildId={props.guild.id} iconHash={props.guild.iconHash} name={props.guild.name} />
      <div class="meta">
        <div class="name">{props.guild.name}</div>
        <div class="sub">
          <RoleBadge role={props.guild.role} />
        </div>
      </div>
    </a>
  );
}

export function StatTile(props: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div class={`stat-tile${props.accent ? ' accent' : ''}`}>
      <div class="label">{props.label}</div>
      <div class="value">
        {typeof props.value === 'number' ? props.value.toLocaleString() : props.value}
      </div>
    </div>
  );
}

// ─── Per-guild sidebar ─────────────────────────────────────────────────

export interface GuildSidebarProps {
  guildId: string;
  guildName: string;
  iconHash: string | null;
  role: Role;
  active: 'overview' | 'me' | 'audit' | 'config' | 'perms' | 'users';
}

export function GuildSidebar(props: GuildSidebarProps) {
  const canAdmin = props.role === 'owner' || props.role === 'admin';
  const cls = (key: string) => `sidebar-item${key === props.active ? ' active' : ''}`;

  return (
    <nav class="sidebar" aria-label="Guild navigation">
      <div class="sidebar-header">
        <GuildIcon
          guildId={props.guildId}
          iconHash={props.iconHash}
          name={props.guildName}
          size="sm"
        />
        <div class="name">{props.guildName}</div>
      </div>

      <div class="sidebar-section-label">General</div>
      <a class={cls('overview')} href={`/g/${props.guildId}`}>
        <Icon.Home />
        <span>Overview</span>
      </a>
      <a class={cls('me')} href={`/g/${props.guildId}/me`}>
        <Icon.User />
        <span>My settings</span>
      </a>

      {canAdmin ? (
        <>
          <div class="sidebar-section-label">Moderation</div>
          <a class={cls('audit')} href={`/g/${props.guildId}/audit`}>
            <Icon.ScrollText />
            <span>Audit log</span>
          </a>
          <a class={cls('config')} href={`/g/${props.guildId}/config`}>
            <Icon.Settings />
            <span>Config</span>
          </a>
          <a class={cls('perms')} href={`/g/${props.guildId}/perms`}>
            <Icon.Shield />
            <span>Permissions</span>
          </a>
          <a class={cls('users')} href={`/g/${props.guildId}/users`}>
            <Icon.Users />
            <span>Users</span>
          </a>
        </>
      ) : null}
    </nav>
  );
}
