import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { DiscordMessage, Issue } from '@/lib/discord-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/db/load?channelId=...&limit=200
 * Hydrates the dashboard from SQLite so the user doesn't re-fetch on every visit.
 * Returns: { issues: Issue[], totalResults: number, hasReplies: boolean }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const channelId = searchParams.get('channelId') ?? '';
    const limit = Math.min(Number(searchParams.get('limit') ?? 200), 500);

    // Build where clause
    const where: Record<string, unknown> = {};
    if (channelId) where.channelId = channelId;

    const rows = await db.issue.findMany({
      where,
      include: {
        replies: {
          orderBy: { timestamp: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const issues: Issue[] = rows.map((row) => {
      const replies: DiscordMessage[] = row.replies.map((r) => ({
        id: r.id,
        type: 0,
        content: r.content,
        channel_id: row.id,
        author: {
          id: r.authorId,
          username: r.authorUsername,
          global_name: r.authorGlobalName,
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
        timestamp: r.timestamp.toISOString(),
        edited_timestamp: null,
        flags: 0,
        components: [],
        position: 0,
      }));

      let appliedTags: string[] = [];
      try {
        appliedTags = JSON.parse(row.appliedTags ?? '[]');
      } catch {
        appliedTags = [];
      }

      return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        archivedAt: row.archivedAt?.toISOString() ?? null,
        archived: row.archived,
        locked: row.locked,
        messageCount: row.messageCount,
        memberCount: row.memberCount,
        totalMessageSent: row.totalMessageSent,
        appliedTags,
        ownerId: row.ownerId,
        ownerUsername: row.ownerUsername,
        ownerGlobalName: row.ownerGlobalName,
        ownerAvatar: row.ownerAvatar,
        firstMessageId: row.firstMessageId,
        firstMessageContent: row.firstMessageContent,
        firstMessageAuthorId: row.firstMessageAuthorId,
        firstMessageAuthorName: row.firstMessageAuthorName,
        firstMessageCreatedAt: row.firstMessageCreatedAt?.toISOString() ?? null,
        hasAttachment: false, // not tracked at issue level in DB
        attachmentFilenames: [],
        replies,
        responseTimeMs: row.responseTimeMs != null ? Number(row.responseTimeMs) : null,
        responderCount: row.responderCount,
        isAnswered: row.isAnswered,
        resolutionStatus: row.resolutionStatus as Issue['resolutionStatus'],
        sentiment: (row.sentiment as Issue['sentiment']) ?? undefined,
        sentimentScore: row.sentimentScore ?? undefined,
        sentimentSummary: row.sentimentSummary ?? undefined,
        duplicateClusterId: row.duplicateClusterId ?? undefined,
      };
    });

    const totalResults = await db.issue.count({ where });

    // Has replies if at least one issue has replies
    const hasReplies = issues.some((i) => (i.replies?.length ?? 0) > 0);

    return NextResponse.json({ issues, totalResults, hasReplies });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/db/load]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
