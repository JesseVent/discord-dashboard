import { NextRequest, NextResponse } from 'next/server';
import { resolveDiscordCreds } from '@/lib/discord-config';
import { fetchThreadMessagesRaw } from '@/lib/discord-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/discord/messages?threadId=...&limit=100
 *
 * Fetches all messages in a thread (paginated internally, returns up to `limit` messages).
 * Falls back to DISCORD_AUTH_TOKEN / DISCORD_CHANNEL_ID env vars if client doesn't pass creds.
 *
 * Returns: { messages: DiscordMessage[], threadId: string }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = (searchParams.get('threadId') ?? '').trim();
    const limit = Math.min(Number(searchParams.get('limit') ?? 100), 200);
    const clientAuth = searchParams.get('authToken') ?? '';
    const clientChannel = searchParams.get('channelId') ?? '';

    const { authToken } = resolveDiscordCreds({
      authToken: clientAuth,
      channelId: clientChannel,
    });

    if (!threadId) {
      return NextResponse.json({ error: 'threadId is required' }, { status: 400 });
    }
    if (!authToken) {
      return NextResponse.json(
        { error: 'No Discord auth token. Set DISCORD_AUTH_TOKEN in .env or pass authToken.' },
        { status: 400 },
      );
    }

    const messages = await fetchThreadMessagesRaw({ threadId, authToken, limit });
    return NextResponse.json({ messages, threadId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('429') ? 429 : 502;
    console.error('[/api/discord/messages]', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
