import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/db/clear?channelId=...
 * Wipes all persisted issues + replies for a channel (or all if channelId omitted).
 */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const channelId = searchParams.get('channelId') ?? '';

    const where: Record<string, unknown> = {};
    if (channelId) where.channelId = channelId;

    // Replies cascade-delete with issues
    const deleted = await db.issue.deleteMany({ where });
    // Also clean up orphaned duplicate clusters
    await db.duplicateCluster.deleteMany({
      where: { issues: { none: {} } },
    });
    await db.themeCluster.deleteMany({});

    return NextResponse.json({ ok: true, deleted: deleted.count });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/db/clear]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
