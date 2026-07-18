import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'edge';
export const revalidate = 3600; // Cache for 1 hour, updated by cron

export async function GET() {
  try {
    const [kpiRes, dailyStatsRes, respondersRes] = await Promise.all([
      // A quick count aggregate query for total KPIs
      supabaseAdmin.from('issues').select('id, is_answered, resolution_status, message_count, response_time_ms'),
      supabaseAdmin.from('dashboard_daily_stats').select('*').order('date', { ascending: true }),
      supabaseAdmin.from('top_responders_view').select('*').limit(20)
    ]);

    if (kpiRes.error) throw kpiRes.error;

    // Calculate aggregated KPIs quickly on the edge
    const issues = kpiRes.data || [];
    const totalIssues = issues.length;
    const answeredIssues = issues.filter(i => i.is_answered).length;
    const totalMessages = issues.reduce((acc, i) => acc + (i.message_count || 0), 0);
    const resolvedIssues = issues.filter(i => i.resolution_status === 'likely-resolved').length;
    
    // Average response time
    const issuesWithResponseTime = issues.filter(i => typeof i.response_time_ms === 'number');
    const avgResponseTimeMs = issuesWithResponseTime.length > 0
      ? issuesWithResponseTime.reduce((acc, i) => acc + (i.response_time_ms as number), 0) / issuesWithResponseTime.length
      : 0;

    const data = {
      kpis: {
        totalIssues,
        answeredIssues,
        totalMessages,
        resolvedIssues,
        avgResponseTimeMs
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
