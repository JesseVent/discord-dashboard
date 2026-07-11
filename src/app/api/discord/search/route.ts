import { NextRequest, NextResponse } from 'next/server';
import { searchThreads } from '@/lib/discord-api';
import { resolveDiscordCreds } from '@/lib/discord-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/discord/search
 * Body (optional when env vars are set): { channelId, authToken, archived?, limit?, offset?, sortBy?, sortOrder? }
 * Proxies to Discord's GET /channels/:id/threads/search (server-side, no CORS).
 *
 * If the body omits channelId/authToken, falls back to DISCORD_AUTH_TOKEN / DISCORD_CHANNEL_ID env vars.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { channelId, authToken } = resolveDiscordCreds({
      channelId: body.channelId,
      authToken: body.authToken,
    });

    if (!channelId || !authToken) {
      return NextResponse.json(
        {
          error:
            'No Discord credentials. Either pass channelId + authToken in the body, or set DISCORD_AUTH_TOKEN / DISCORD_CHANNEL_ID in .env',
        },
        { status: 400 },
      );
    }

    const result = await searchThreads({
      channelId,
      authToken,
      archived: body.archived ?? true,
      limit: Math.min(Number(body.limit ?? 25), 100),
      offset: Math.max(Number(body.offset ?? 0), 0),
      sortBy: body.sortBy ?? 'last_message_time',
      sortOrder: body.sortOrder ?? 'desc',
    });

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/discord/search]', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
