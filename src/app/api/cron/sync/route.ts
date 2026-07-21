import { NextResponse } from 'next/server';
import { supabaseAdmin, ensureDatabaseReady } from '@/lib/supabase';
import { env } from 'process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Max execution time for Vercel Pro/Hobby

const GUILD_ID = '839993398554656828';

async function fetchDiscordApi(url: string, token: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { authorization: token } });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const text = await res.text();
      const m = text.match(/retry_after[^0-9]*([\d.]+)/);
      const retryAfter = m ? parseFloat(m[1]) : 2;
      await new Promise(r => setTimeout(r, retryAfter * 1000 + 100));
      continue;
    }
    if (res.status === 403 || res.status === 404) return null;
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

export async function GET(req: Request) {
  try {
    await ensureDatabaseReady();
    // 1. Verify Vercel Cron Secret
    const authHeader = req.headers.get('authorization');
    if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authToken = env.DISCORD_AUTH_TOKEN;
    const channelId = env.DISCORD_CHANNEL_ID;
    if (!authToken || !channelId) {
      return NextResponse.json({ error: 'Missing Discord env vars' }, { status: 500 });
    }

    // 2. Sync Recent Active Threads
    const searchUrl = `https://discord.com/api/v9/channels/${channelId}/threads/search?archived=false&sort_by=last_message_time&sort_order=desc&limit=25`;
    const searchData = await fetchDiscordApi(searchUrl, authToken);
    
    let syncedIssues = 0;
    if (searchData && searchData.threads) {
      const fmMap = new Map((searchData.first_messages || []).map((m: any) => [m.channel_id, m]));
      const issues = searchData.threads.map((thread: any) => {
        const fm = fmMap.get(thread.id);
        const owner = thread.owner?.user;
        return {
          id: thread.id,
          name: thread.name,
          channel_id: channelId,
          guild_id: GUILD_ID,
          owner_id: thread.owner_id,
          owner_username: owner?.username ?? 'unknown',
          owner_global_name: owner?.global_name ?? owner?.username ?? null,
          owner_avatar: owner?.avatar ?? null,
          created_at: thread.thread_metadata?.create_timestamp || new Date().toISOString(),
          archived_at: thread.thread_metadata?.archive_timestamp ?? null,
          archived: thread.thread_metadata?.archived ?? false,
          locked: thread.thread_metadata?.locked ?? false,
          message_count: thread.message_count ?? 0,
          member_count: thread.member_count ?? 0,
          total_message_sent: thread.total_message_sent ?? 0,
          applied_tags: thread.applied_tags ?? [],
          first_message_id: fm?.id ?? null,
          first_message_content: fm?.content ?? '',
          first_message_author_id: fm?.author?.id ?? null,
          first_message_author_name: fm?.author?.global_name ?? fm?.author?.username ?? null,
          first_message_created_at: fm?.timestamp ?? null,
        };
      });

      if (issues.length > 0) {
        await supabaseAdmin.from('issues').upsert(issues, { onConflict: 'id' });
        syncedIssues += issues.length;
      }
    }

    // 3. Sync Missing Replies for a few threads (max 10 to fit in timeout)
    const { data: dbIssues } = await supabaseAdmin
      .from('issues')
      .select('id, first_message_id, message_count, replies(id)')
      .gt('message_count', 1)
      .order('fetched_at', { ascending: true })
      .limit(20);

    let syncedReplies = 0;
    if (dbIssues) {
      const missing = dbIssues.filter((i: any) => !i.replies || i.replies.length === 0).slice(0, 10);
      
      // Update fetched_at for ones we skip or already have so they cycle
      const alreadySynced = dbIssues.filter((i: any) => i.replies && i.replies.length > 0).map((i: any) => i.id);
      if (alreadySynced.length > 0) {
        await supabaseAdmin.from('issues').update({ fetched_at: new Date().toISOString() }).in('id', alreadySynced);
      }

      for (const issue of missing) {
        const messages = await fetchDiscordApi(`https://discord.com/api/v9/channels/${issue.id}/messages?limit=100`, authToken);
        if (messages && Array.isArray(messages)) {
          const replies = messages.reverse().filter((m: any) => m.id !== issue.first_message_id);
          const replyRows = replies.map((r: any) => ({
            id: r.id,
            issue_id: issue.id,
            author_id: r.author?.id ?? 'unknown',
            author_username: r.author?.username ?? 'unknown',
            author_global_name: r.author?.global_name ?? null,
            content: r.content ?? '',
            timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
            has_attachment: (r.attachments?.length ?? 0) > 0,
            attachment_count: r.attachments?.length ?? 0,
          }));
          if (replyRows.length > 0) {
            await supabaseAdmin.from('replies').upsert(replyRows, { onConflict: 'id' });
            syncedReplies += replyRows.length;
          }
        }
        await supabaseAdmin.from('issues').update({ fetched_at: new Date().toISOString() }).eq('id', issue.id);
      }
    }

    return NextResponse.json({ ok: true, syncedIssues, syncedReplies });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/cron/sync]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
