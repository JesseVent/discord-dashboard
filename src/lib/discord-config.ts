/**
 * Server-side Discord config.
 *
 * Reads DISCORD_AUTH_TOKEN and DISCORD_CHANNEL_ID from process.env.
 * The token is NEVER exposed to the client — only a boolean "is configured"
 * signal is shared via /api/discord-config.
 *
 * API routes use these as a fallback when the client doesn't pass a token,
 * so a user can configure the dashboard once via .env and never have to
 * paste their token in the UI.
 */

export function getEnvDiscordToken(): string | null {
  const v = process.env.DISCORD_AUTH_TOKEN ?? '';
  return v.trim() ? v.trim() : null;
}

export function getEnvDiscordChannelId(): string | null {
  const v = process.env.DISCORD_CHANNEL_ID ?? '';
  return v.trim() ? v.trim() : null;
}

/**
 * Resolve the effective { channelId, authToken } for an API request.
 * Client-provided values win; env vars are the fallback.
 *
 * Returns `authToken: null` if neither client nor env provided a token.
 */
export function resolveDiscordCreds(client: {
  channelId?: string;
  authToken?: string;
}): { channelId: string | null; authToken: string | null; usedEnvToken: boolean } {
  const clientToken = (client.authToken ?? '').trim();
  const clientChannel = (client.channelId ?? '').trim();

  const authToken = clientToken || getEnvDiscordToken();
  const channelId = clientChannel || getEnvDiscordChannelId();

  return {
    channelId,
    authToken,
    usedEnvToken: !clientToken && !!authToken,
  };
}
