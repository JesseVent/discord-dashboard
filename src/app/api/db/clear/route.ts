import { NextResponse } from 'next/server';
import { supabaseAdmin, ensureDatabaseReady } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/db/clear?channelId=...
 * Wipes all persisted issues + replies for a channel (or all if channelId omitted).
 */
export async function DELETE(req: Request) {
  try {
    await ensureDatabaseReady();
    const { searchParams } = new URL(req.url);
    const channelId = searchParams.get('channelId') ?? '';

    let issueQuery = supabaseAdmin.from('issues').select('id');
    if (channelId) issueQuery = issueQuery.eq('channel_id', channelId);
    const { data: toDelete, error: selErr } = await issueQuery;
    if (selErr) throw new Error(`issues select failed: ${selErr.message}`);
    const ids = (toDelete ?? []).map((r) => r.id);

    if (ids.length > 0) {
      // Replies cascade-delete with issues (FK ON DELETE CASCADE)
      const { error: delErr } = await supabaseAdmin.from('issues').delete().in('id', ids);
      if (delErr) throw new Error(`issues delete failed: ${delErr.message}`);
    }

    // Clean up orphaned duplicate clusters + all theme clusters
    const { data: usedClusters } = await supabaseAdmin
      .from('issues')
      .select('duplicate_cluster_id')
      .not('duplicate_cluster_id', 'is', null);
    const usedIds = new Set((usedClusters ?? []).map((r: any) => r.duplicate_cluster_id));
    const { data: allClusters } = await supabaseAdmin.from('duplicate_clusters').select('id');
    const orphanIds = (allClusters ?? []).map((c) => c.id).filter((id) => !usedIds.has(id));
    if (orphanIds.length > 0) {
      await supabaseAdmin.from('duplicate_clusters').delete().in('id', orphanIds);
    }
    await supabaseAdmin.from('theme_clusters').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/db/clear]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
