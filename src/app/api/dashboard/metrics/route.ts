import { NextResponse } from 'next/server';
import { supabaseAdmin, ensureDatabaseReady } from '@/lib/supabase';

export const runtime = 'nodejs';
export const revalidate = 3600; // Cache for 1 hour, updated by cron

export async function GET() {
  try {
    await ensureDatabaseReady();
    // dashboard_global_metrics has one row per channel_id, and the corpus holds
    // a handful of stray channels alongside the real one — .single() over all of
    // them errors out ("cannot coerce"), which silently dropped the whole KPI
    // payload and left the client computing headline numbers from its 1000-row
    // local sample. Pick the configured channel, else the largest.
    const channelId = process.env.DISCORD_CHANNEL_ID;
    const kpiQuery = channelId
      ? supabaseAdmin.from('dashboard_global_metrics').select('*').eq('channel_id', channelId)
      : supabaseAdmin
          .from('dashboard_global_metrics')
          .select('*')
          .order('total_issues', { ascending: false })
          .limit(1);

    const [kpiRes, dailyStatsRes, respondersRes] = await Promise.all([
      kpiQuery.maybeSingle(),
      supabaseAdmin.from('dashboard_daily_stats').select('*').order('date', { ascending: true }),
      supabaseAdmin.from('top_responders_view').select('*').limit(20)
    ]);

    if (kpiRes.error) throw new Error(`Global metrics error: ${kpiRes.error.message}`);
    if (dailyStatsRes.error) throw new Error(`Daily stats error: ${dailyStatsRes.error.message}`);
    if (respondersRes.error) throw new Error(`Top responders error: ${respondersRes.error.message}`);

    // Calculate aggregated KPIs quickly on the edge
    const metrics = kpiRes.data || {};
    const totalIssues = Number(metrics.total_issues) || 0;
    const answeredIssues = Number(metrics.answered_issues) || 0;
    const totalMessages = Number(metrics.total_messages) || 0;
    const resolvedIssues = Number(metrics.resolved_issues) || 0;
    const avgResponseTimeMs = Number(metrics.avg_response_time_ms) || 0;
    const medianResponseTimeMs = Number(metrics.median_response_time_ms) || 0;
    const fastResponseCount = Number(metrics.fast_response_count) || 0;
    const uniqueUsers = Number(metrics.unique_users) || 0;
    const archivedIssues = Number(metrics.archived_issues) || 0;

    const data = {
      kpis: {
        totalIssues,
        answeredIssues,
        totalMessages,
        resolvedIssues,
        avgResponseTimeMs,
        medianResponseTimeMs,
        fastResponseCount,
        uniqueUsers,
        archivedIssues,
      },
      dailyStats: dailyStatsRes.data || [],
      topResponders: respondersRes.data || []
    };

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/dashboard/metrics]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
