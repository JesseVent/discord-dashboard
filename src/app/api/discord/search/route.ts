import { NextRequest, NextResponse } from 'next/server';
import { searchThreads } from '@/lib/discord-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/discord/search
 * Body: { channelId, authToken, archived?, limit?, offset?, sortBy?, sortOrder? }
 * Proxies to Discord's GET /channels/:id/threads/search (server-side, no CORS).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const channelId = String(body.channelId ?? '').trim();
    const authToken = String(body.authToken ?? '').trim();

    if (!channelId || !authToken) {
      return NextResponse.json(
        { error: 'channelId and authToken are required' },
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
