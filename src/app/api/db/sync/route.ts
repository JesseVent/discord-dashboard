import { NextRequest, NextResponse } from 'next/server';
import { upsertIssuesAndReplies } from '@/lib/persist-issues';
import type { Issue } from '@/lib/discord-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/db/sync
 * Persists fetched issues + replies to Supabase (discord.issues / discord.replies)
 * so they survive across sessions.
 * Body: { issues: Issue[], channelId: string, guildId?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const issues = (body.issues ?? []) as Issue[];
    const channelId = String(body.channelId ?? '');
    const guildId = body.guildId ?? null;

    if (!Array.isArray(issues) || issues.length === 0) {
      return NextResponse.json({ error: 'issues must be a non-empty array' }, { status: 400 });
    }

    const { issueCount, replyCount } = await upsertIssuesAndReplies({ issues, channelId, guildId });
    return NextResponse.json({ ok: true, issueCount, replyCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/db/sync]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
