import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'edge';
export const revalidate = 3600; // Cache for 1 hour, updated by cron

export async function GET() {
  try {
    const [kpiRes, dailyStatsRes, respondersRes] = await Promise.all([
      // Use the new global metrics view for fast server-side KPIs
      supabaseAdmin.from('dashboard_global_metrics').select('*').single(),
      supabaseAdmin.from('dashboard_daily_stats').select('*').order('date', { ascending: true }),
      supabaseAdmin.from('top_responders_view').select('*').limit(20)
    ]);

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
