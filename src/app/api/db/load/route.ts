import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, ensureDatabaseReady } from '@/lib/supabase';
import type { DiscordMessage, Issue } from '@/lib/discord-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/db/load?channelId=...&limit=200
 * Hydrates the dashboard from Supabase so the user doesn't re-fetch on every visit.
 * Returns: { issues: Issue[], totalResults: number, hasReplies: boolean }
 */
export async function GET(req: NextRequest) {
  try {
    await ensureDatabaseReady();
    const { searchParams } = new URL(req.url);
    const channelId = searchParams.get('channelId') ?? '';
    const limit = Math.min(Number(searchParams.get('limit') ?? 50000), 50000);

    // PostgREST caps a single request at 1000 rows by default. Paginate server-side
    // via .range() so the bulk load returns up to `limit` rows.
    const PAGE = 1000;
    const pageCount = Math.ceil(limit / PAGE);
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, i) => {
        const offset = i * PAGE;
        // We request specific columns to drastically reduce the JSON payload size,
        // avoiding sending full first_message_content if possible.
        let q = supabaseAdmin
          .from('dashboard_issues_light') // Try to use the lightweight view first
          .select('*')
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (channelId) q = q.eq('channel_id', channelId);
        return q;
      }),
    );
    const rows: any[] = [];
    for (const { data: page, error } of pages) {
      if (error) {
        // Fallback if the view hasn't been created yet
        if (error.code === '42P01') { 
          console.warn('dashboard_issues_light view not found, falling back to issues table with explicit columns');
          const fallbackPages = await Promise.all(
            Array.from({ length: pageCount }, (_, i) => {
              const offset = i * PAGE;
              let fallbackQ = supabaseAdmin
                .from('issues')
                .select('id, name, created_at, archived_at, archived, locked, message_count, member_count, total_message_sent, applied_tags, owner_id, owner_username, owner_global_name, owner_avatar, first_message_id, first_message_author_id, first_message_author_name, first_message_created_at, response_time_ms, responder_count, is_answered, resolution_status, sentiment, sentiment_score, sentiment_summary, duplicate_cluster_id')
                .order('created_at', { ascending: false })
                .range(offset, offset + PAGE - 1);
              if (channelId) fallbackQ = fallbackQ.eq('channel_id', channelId);
              return fallbackQ;
            })
          );
          for (const { data: fPage, error: fError } of fallbackPages) {
            if (fError) throw new Error(`issues select failed: ${fError.message}`);
            if (!fPage || fPage.length === 0) break;
            rows.push(...fPage);
          }
          break;
        } else {
          throw new Error(`issues select failed: ${error.message}`);
        }
      }
      if (!page || page.length === 0) break;
      rows.push(...page);
    }

    let countQuery = supabaseAdmin.from('issues').select('id', { count: 'exact', head: true });
    if (channelId) countQuery = countQuery.eq('channel_id', channelId);
    const { count } = await countQuery;

    const issues: Issue[] = (rows ?? []).map((row: any) => {
      const replies: DiscordMessage[] = (row.replies ?? []).map((r: any) => ({
        id: r.id,
        type: 0,
        content: r.content,
        channel_id: row.id,
        author: {
          id: r.author_id,
          username: r.author_username,
          global_name: r.author_global_name,
          avatar: null,
          discriminator: '0',
          public_flags: 0,
        },
        attachments: [],
        embeds: [],
        mentions: [],
        mention_roles: [],
        mention_everyone: false,
        pinned: false,
        tts: false,
        timestamp: r.timestamp,
        edited_timestamp: null,
        flags: 0,
        components: [],
        position: 0,
      }));

      return {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        archivedAt: row.archived_at,
        archived: row.archived,
        locked: row.locked,
        messageCount: row.message_count,
        memberCount: row.member_count,
        totalMessageSent: row.total_message_sent,
        appliedTags: row.applied_tags ?? [],
        ownerId: row.owner_id,
        ownerUsername: row.owner_username,
        ownerGlobalName: row.owner_global_name,
        ownerAvatar: row.owner_avatar,
        firstMessageId: row.first_message_id,
        firstMessageContent: row.first_message_content ?? '',
        firstMessageAuthorId: row.first_message_author_id,
        firstMessageAuthorName: row.first_message_author_name,
        firstMessageCreatedAt: row.first_message_created_at,
        hasAttachment: false, // not tracked at issue level in DB
        attachmentFilenames: [],
        replies,
        responseTimeMs: row.response_time_ms != null ? Number(row.response_time_ms) : null,
        responderCount: row.responder_count,
        isAnswered: row.is_answered,
        resolutionStatus: row.resolution_status as Issue['resolutionStatus'],
        sentiment: (row.sentiment as Issue['sentiment']) ?? undefined,
        sentimentScore: row.sentiment_score ?? undefined,
        sentimentSummary: row.sentiment_summary ?? undefined,
        duplicateClusterId: row.duplicate_cluster_id ?? undefined,
      };
    });

    const hasReplies = issues.some((i) => (i.replies?.length ?? 0) > 0);

    return NextResponse.json(
      { issues, totalResults: count ?? issues.length, hasReplies },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=86400',
        },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/db/load]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
