import { NextResponse } from 'next/server';
import { supabaseAdmin, ensureDatabaseReady } from '@/lib/supabase';
import { channelLabel } from '@/lib/discord-types';
import {
  sumKpis,
  rowToKpis,
  combineDailyStats,
  combineResponders,
  type ChannelKpiRow,
  type DailyStatRow,
  type ResponderRow,
  type Kpis,
} from '@/lib/channel-aggregate';

export const runtime = 'nodejs';
export const revalidate = 3600; // Cache for 1 hour, updated by cron

export async function GET() {
  try {
    await ensureDatabaseReady();
    const [kpiRes, dailyStatsRes, respondersRes] = await Promise.all([
      // Per-channel rows (one per channel_id). NOTE: not .single() — multiple channels produce
      // multiple rows, and .single() throws on >1 row.
      supabaseAdmin.from('dashboard_global_metrics').select('*'),
      supabaseAdmin.from('dashboard_daily_stats').select('*').order('date', { ascending: true }),
      supabaseAdmin.from('top_responders_view').select('*'),
    ]);

    if (kpiRes.error) throw new Error(`Global metrics error: ${kpiRes.error.message}`);
    if (dailyStatsRes.error) throw new Error(`Daily stats error: ${dailyStatsRes.error.message}`);
    if (respondersRes.error) throw new Error(`Top responders error: ${respondersRes.error.message}`);

    const kpiRows = (kpiRes.data ?? []) as unknown as ChannelKpiRow[];
    const dailyRows = (dailyStatsRes.data ?? []) as unknown as DailyStatRow[];
    const responderRows = (respondersRes.data ?? []) as unknown as ResponderRow[];

    // Combined ("all channels") view
    const kpis = sumKpis(kpiRows);
    const dailyStats = combineDailyStats(dailyRows);
    const topResponders = combineResponders(responderRows, 20);

    // Per-channel maps for the channel filter
    const byChannel: Record<string, Kpis> = {};
    const dailyStatsByChannel: Record<string, DailyStatRow[]> = {};
    const topRespondersByChannel: Record<string, ResponderRow[]> = {};
    const channels: { id: string; label: string; issueCount: number }[] = [];

    for (const r of kpiRows) {
      const id = r.channel_id ?? '';
      if (!id) continue;
      byChannel[id] = rowToKpis(r);
      channels.push({ id, label: channelLabel(id), issueCount: Number(r.total_issues) || 0 });
    }

    for (const r of dailyRows) {
      const id = r.channel_id ?? '';
      if (!id) continue;
      (dailyStatsByChannel[id] ??= []).push({
        date: String(r.date),
        channel_id: id,
        issue_count: Number(r.issue_count) || 0,
        total_messages: Number(r.total_messages) || 0,
        answered_count: Number(r.answered_count) || 0,
      });
    }

    for (const r of responderRows) {
      const id = r.channel_id ?? '';
      if (!id) continue;
      (topRespondersByChannel[id] ??= []).push(r);
    }

    const data = {
      kpis,
      byChannel,
      dailyStats,
      dailyStatsByChannel,
      topResponders,
      topRespondersByChannel,
      channels,
    };

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/dashboard/metrics]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}