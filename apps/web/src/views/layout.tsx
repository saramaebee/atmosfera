import type { Child } from 'hono/jsx';
import type { SessionContext } from '../types';
import { GuildSwitcher, userAvatarUrl } from './components';
import { Icon } from './icons';
import { STYLES } from './styles';

export interface LayoutProps {
  title: string;
  session?: SessionContext;
  /** Optional id of the active guild (drives the switcher's selected state). */
  activeGuildId?: string;
  /** Optional sidebar — renders in a two-column layout when present. */
  sidebar?: Child;
  children: Child;
}

export function Layout(props: LayoutProps) {
  const u = props.session?.session;
  const avatar = u ? userAvatarUrl(u.discordUserId, u.discordAvatarHash, 48) : null;
  const initial = (u?.discordGlobalName ?? u?.discordUsername ?? '?').charAt(0).toUpperCase();

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · atmosfera</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
        <script
          src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js"
          integrity="sha384-ujb1lZYygJmzgSwoxRggbCHcjc0rB2XoQrxeTUQyRjrOnlCoYta87iKBWq3EsdM2"
          crossorigin="anonymous"
        />
      </head>
      <body>
        {props.session && u ? (
          <header class="topbar">
            <div class="topbar-inner">
              <a href="/guilds" class="brand">
                <span class="brand-mark">
                  <Icon.Sparkles size={16} />
                </span>
                <span>atmosfera</span>
              </a>
              <GuildSwitcher session={props.session} activeGuildId={props.activeGuildId} />
              <div class="topbar-spacer" />
              <span class="user-chip">
                {avatar ? (
                  <img src={avatar} alt="" />
                ) : (
                  <span class="avatar-fallback">{initial}</span>
                )}
                <span>{u.discordGlobalName ?? u.discordUsername}</span>
                {props.session.isOwner ? <span class="badge badge-owner">owner</span> : null}
              </span>
              <form method="post" action="/auth/logout" class="inline">
                <button type="submit" class="ghost" title="Sign out" aria-label="Sign out">
                  <Icon.LogOut />
                </button>
              </form>
            </div>
          </header>
        ) : null}
        <main>
          {props.sidebar ? (
            <div class="layout-with-sidebar">
              {props.sidebar}
              <div>{props.children}</div>
            </div>
          ) : (
            props.children
          )}
        </main>
      </body>
    </html>
  );
}
