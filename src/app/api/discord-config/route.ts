import { NextResponse } from 'next/server';
import { getEnvDiscordChannelId, getEnvDiscordToken } from '@/lib/discord-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/discord-config
 * Returns booleans indicating whether the server has DISCORD_AUTH_TOKEN and/or
 * DISCORD_CHANNEL_ID configured via env. Does NOT expose the token itself.
 */
export async function GET() {
  return NextResponse.json({
    hasEnvToken: !!getEnvDiscordToken(),
    hasEnvChannelId: !!getEnvDiscordChannelId(),
    envChannelId: getEnvDiscordChannelId(),
  });
}
