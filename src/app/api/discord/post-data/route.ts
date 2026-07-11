import { NextRequest, NextResponse } from 'next/server';
import { fetchPostData } from '@/lib/discord-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/discord/post-data
 * Body: { channelId, authToken, threadIds: string[] (max 10) }
 * Proxies to Discord's POST /channels/:id/post-data (server-side, no CORS).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const channelId = String(body.channelId ?? '').trim();
    const authToken = String(body.authToken ?? '').trim();
    const threadIds: unknown = body.threadIds;

    if (!channelId || !authToken) {
      return NextResponse.json(
        { error: 'channelId and authToken are required' },
        { status: 400 },
      );
    }
    if (!Array.isArray(threadIds) || threadIds.length === 0) {
      return NextResponse.json(
        { error: 'threadIds must be a non-empty array' },
        { status: 400 },
      );
    }
    if (threadIds.length > 10) {
      return NextResponse.json(
        { error: 'threadIds must contain at most 10 IDs per call' },
        { status: 400 },
      );
    }

    const result = await fetchPostData({
      channelId,
      authToken,
      threadIds: threadIds.map(String),
    });

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/discord/post-data]', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
