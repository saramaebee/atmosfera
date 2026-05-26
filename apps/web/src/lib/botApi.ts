import {
  type BotChannelsResponse,
  type BotCommandsResponse,
  type BotExplainSyncResponse,
  type BotRolesResponse,
  getEnv,
  isInternalApiEnabled,
} from '@atmosfera/config';

const REQUEST_TIMEOUT_MS = 3000;

/**
 * Call the bot's internal API to fetch live channel + permission state for a
 * guild. Returns a discriminated union — callers should switch on `kind`.
 *
 * Never throws on network/timeout failure — those map to `unavailable` so the
 * UI can render a graceful placeholder instead of a 500.
 */
export async function fetchBotChannels(guildId: string): Promise<BotChannelsResponse> {
  if (!isInternalApiEnabled()) {
    return {
      kind: 'unavailable',
      message: 'INTERNAL_API_TOKEN is not configured',
    };
  }

  const env = getEnv();
  const token = env.INTERNAL_API_TOKEN!;
  const url = `http://127.0.0.1:${env.INTERNAL_API_PORT}/internal/guilds/${guildId}/channels`;

  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await res.json()) as BotChannelsResponse;
    return body;
  } catch (err) {
    return {
      kind: 'unavailable',
      message: `bot internal api unreachable: ${(err as Error).message}`,
    };
  }
}

/**
 * Live list of application commands the bot has registered with Discord, both
 * globally and scoped to this guild. Used by the debug view to confirm a
 * command (e.g. /Explain) is actually present after deploy.
 */
export async function fetchBotCommands(guildId: string): Promise<BotCommandsResponse> {
  if (!isInternalApiEnabled()) {
    return {
      kind: 'unavailable',
      message: 'INTERNAL_API_TOKEN is not configured',
    };
  }
  const env = getEnv();
  const token = env.INTERNAL_API_TOKEN!;
  const url = `http://127.0.0.1:${env.INTERNAL_API_PORT}/internal/guilds/${guildId}/commands`;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return (await res.json()) as BotCommandsResponse;
  } catch (err) {
    return {
      kind: 'unavailable',
      message: `bot internal api unreachable: ${(err as Error).message}`,
    };
  }
}

/**
 * Ask the bot to reconcile the per-guild Explain command with the guild's
 * current mode (create it, or delete it when mode is 'off'). Called after the
 * web app changes Explain's mode so visibility updates immediately instead of
 * waiting for the next bot restart. Never throws — unreachable bot maps to
 * `unavailable` so the caller can show a "applies on next restart" note.
 */
export async function syncExplainCommand(guildId: string): Promise<BotExplainSyncResponse> {
  if (!isInternalApiEnabled()) {
    return { kind: 'unavailable', message: 'INTERNAL_API_TOKEN is not configured' };
  }
  const env = getEnv();
  const token = env.INTERNAL_API_TOKEN!;
  const url = `http://127.0.0.1:${env.INTERNAL_API_PORT}/internal/guilds/${guildId}/explain-command/sync`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return (await res.json()) as BotExplainSyncResponse;
  } catch (err) {
    return {
      kind: 'unavailable',
      message: `bot internal api unreachable: ${(err as Error).message}`,
    };
  }
}

/**
 * Live guild role list from the bot. Used by the /explain-roles page to render
 * a role picker. Same unavailable / not_found / unauthorized envelope as the
 * channels endpoint.
 */
export async function fetchBotRoles(guildId: string): Promise<BotRolesResponse> {
  if (!isInternalApiEnabled()) {
    return {
      kind: 'unavailable',
      message: 'INTERNAL_API_TOKEN is not configured',
    };
  }
  const env = getEnv();
  const token = env.INTERNAL_API_TOKEN!;
  const url = `http://127.0.0.1:${env.INTERNAL_API_PORT}/internal/guilds/${guildId}/roles`;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return (await res.json()) as BotRolesResponse;
  } catch (err) {
    return {
      kind: 'unavailable',
      message: `bot internal api unreachable: ${(err as Error).message}`,
    };
  }
}
