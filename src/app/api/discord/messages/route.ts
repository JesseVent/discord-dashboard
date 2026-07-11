import { NextRequest, NextResponse } from 'next/server';
import { resolveDiscordCreds } from '@/lib/discord-config';
import type { DiscordMessage } from '@/lib/discord-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v9';

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

    const messages: DiscordMessage[] = [];
    let before: string | undefined;

    // Paginate: Discord returns up to 100 messages per call, newest first.
    // We fetch until we hit `limit` or run out.
    while (messages.length < limit) {
      const url = new URL(`${DISCORD_API}/channels/${threadId}/messages`);
      url.searchParams.set('limit', String(Math.min(100, limit - messages.length)));
      if (before) url.searchParams.set('before', before);

      const res = await fetch(url, {
        headers: { authorization: authToken, accept: '*/*' },
        cache: 'no-store',
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // 403/404 = thread inaccessible; 429 = rate limited
        if (res.status === 403 || res.status === 404) {
          return NextResponse.json(
            { error: `Cannot read thread ${threadId}: ${res.status}` },
            { status: 200 }, // return 200 with error so client can continue
          );
        }
        return NextResponse.json(
          { error: `Discord messages failed: ${res.status} ${text.slice(0, 200)}` },
          { status: res.status === 429 ? 429 : 502 },
        );
      }

      const batch = (await res.json()) as DiscordMessage[];
      if (!Array.isArray(batch) || batch.length === 0) break;

      messages.push(...batch);
      before = batch[batch.length - 1].id;

      if (batch.length < 100) break; // no more pages
    }

    // Reverse so oldest-first (Discord returns newest-first)
    messages.reverse();

    return NextResponse.json({ messages, threadId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/discord/messages]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
