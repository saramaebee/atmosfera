import { type BotChannelsResponse, getEnv, isInternalApiEnabled } from '@atmosfera/config';

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
