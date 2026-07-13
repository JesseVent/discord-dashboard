import { NextRequest, NextResponse } from 'next/server';
import { resolveDiscordCreds } from '@/lib/discord-config';
import {
  searchThreads,
  fetchPostData,
  fetchThreadMessagesRaw,
  normalizeIssue,
  computeResponseAnalytics,
} from '@/lib/discord-api';
import { upsertIssuesAndReplies } from '@/lib/persist-issues';
import { supabaseAdmin } from '@/lib/supabase';
import type { DiscordMessage, DiscordThread, Issue } from '@/lib/discord-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PAGE_SIZE = 25;
const MAX_PAGES = 100; // safety net — normal runs stop within a handful of pages
const MAX_REPLY_REFRESH = 300; // safety net on the reply-refetch phase

function extractRetryAfter(msg: string): number | null {
  const m = msg.match(/retry_after[^0-9]*([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const retryAfter = extractRetryAfter(msg);
      if (retryAfter == null) throw err;
      await new Promise((r) => setTimeout(r, Math.ceil(retryAfter * 1000) + 250));
    }
  }
  throw new Error('still rate-limited after retries');
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/db/sync-incremental
 *
 * Cheap "catch up" sync, meant to be called on a schedule (cron). Discord's
 * threads/search sorts by last_message_time desc, so we page from the top
 * and stop as soon as a full page matches what's already in Supabase — every
 * thread past that point is guaranteed older/unchanged. Only changed/new
 * threads get their replies re-fetched.
 *
 * Body (all optional — falls back to DISCORD_AUTH_TOKEN / DISCORD_CHANNEL_ID): { channelId, authToken, guildId }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { channelId, authToken } = resolveDiscordCreds({
      channelId: body.channelId,
      authToken: body.authToken,
    });
    const guildId = body.guildId ?? null;

    if (!channelId || !authToken) {
      return NextResponse.json(
        { error: 'No Discord credentials (set DISCORD_AUTH_TOKEN / DISCORD_CHANNEL_ID in .env)' },
        { status: 400 },
      );
    }

    const changedThreads: DiscordThread[] = [];
    const changedFirstMessages = new Map<string, DiscordMessage>();
    let pagesScanned = 0;
    let threadsScanned = 0;
    let stoppedEarly = false;
    let offset = 0;

    while (pagesScanned < MAX_PAGES) {
      const page = await withBackoff(() =>
        searchThreads({ channelId, authToken, offset, limit: PAGE_SIZE }),
      );
      pagesScanned += 1;
      const threads = page.threads ?? [];
      if (threads.length === 0) break;
      threadsScanned += threads.length;

      const pageFirstMessages = new Map<string, DiscordMessage>();
      for (const fm of page.first_messages ?? []) {
        if (fm?.channel_id) pageFirstMessages.set(fm.channel_id, fm);
      }

      const ids = threads.map((t) => t.id);
      const { data: existingRows, error } = await supabaseAdmin
        .from('issues')
        .select('id, message_count, archived, locked')
        .in('id', ids);
      if (error) throw new Error(`issues lookup failed: ${error.message}`);
      const existingById = new Map((existingRows ?? []).map((r: any) => [r.id, r]));

      let pageHasChanges = false;
      for (const t of threads) {
        const existing = existingById.get(t.id);
        const isNew = !existing;
        const changed =
          isNew ||
          existing.message_count !== (t.message_count ?? 0) ||
          existing.archived !== (t.thread_metadata?.archived ?? false) ||
          existing.locked !== (t.thread_metadata?.locked ?? false);
        if (changed) {
          pageHasChanges = true;
          changedThreads.push(t);
          const fm = pageFirstMessages.get(t.id);
          if (fm) changedFirstMessages.set(t.id, fm);
        }
      }

      if (!pageHasChanges) break; // caught up — everything older is unchanged too
      if (!page.has_more) break;
      offset += PAGE_SIZE;
      await sleep(200);
    }
    if (pagesScanned >= MAX_PAGES) stoppedEarly = true;

    if (changedThreads.length === 0) {
      return NextResponse.json({ ok: true, pagesScanned, threadsScanned, newOrChanged: 0, repliesRefreshed: 0, stoppedEarly });
    }

    // Backfill first_message content for changed/new threads missing it
    const missingIds = changedThreads.filter((t) => !changedFirstMessages.has(t.id)).map((t) => t.id);
    for (let i = 0; i < missingIds.length; i += 10) {
      const batch = missingIds.slice(i, i + 10);
      const data = await withBackoff(() => fetchPostData({ channelId, authToken, threadIds: batch }));
      for (const [tid, info] of Object.entries(data.threads ?? {})) {
        if (info?.first_message) changedFirstMessages.set(tid, info.first_message);
      }
      await sleep(200);
    }

    const changedIssues: Issue[] = changedThreads.map((t) =>
      normalizeIssue(t, changedFirstMessages.get(t.id)),
    );
    await upsertIssuesAndReplies({ issues: changedIssues, channelId, guildId });

    // Refresh replies for changed/new threads that actually have any
    const toRefresh = changedIssues.filter((i) => (i.messageCount ?? 0) > 1).slice(0, MAX_REPLY_REFRESH);
    let repliesRefreshed = 0;
    for (const issue of toRefresh) {
      const messages = await withBackoff(() =>
        fetchThreadMessagesRaw({ threadId: issue.id, authToken, limit: 100 }),
      );
      const replies = messages.filter((m) => m.id !== issue.firstMessageId);
      const withAnalytics = computeResponseAnalytics({ ...issue, replies });
      await upsertIssuesAndReplies({ issues: [withAnalytics], channelId, guildId });
      repliesRefreshed += 1;
      await sleep(200);
    }

    return NextResponse.json({
      ok: true,
      pagesScanned,
      threadsScanned,
      newOrChanged: changedIssues.length,
      repliesRefreshed,
      stoppedEarly,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/db/sync-incremental]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
