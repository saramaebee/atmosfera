import type { WebSession } from '@atmosfera/db';

export interface OAuthGuildSummary {
  id: string;
  name: string;
  icon: string | null;
  permissions: string; // raw Discord permission bitfield as a decimal string
}

export interface SessionContext {
  session: WebSession;
  oauthGuilds: OAuthGuildSummary[];
  isOwner: boolean;
}

export type AppEnv = {
  Variables: {
    sessionCtx?: SessionContext;
  };
};
