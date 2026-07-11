import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { Issue, DiscordMessage } from '@/lib/discord-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/db/sync
 * Persists fetched issues + replies to SQLite so they survive across sessions.
 * Body: { issues: Issue[], channelId: string, guildId?: string }
 *
 * - Upserts each issue (by Discord thread ID)
 * - Replaces all replies for each issue (delete + insert) to stay in sync
 * - Returns the count of issues + replies persisted
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const issues = (body.issues ?? []) as Issue[];
    const channelId = String(body.channelId ?? '');
    const guildId = body.guildId ?? null;

    if (!Array.isArray(issues) || issues.length === 0) {
      return NextResponse.json({ error: 'issues must be a non-empty array' }, { status: 400 });
    }

    let issueCount = 0;
    let replyCount = 0;

    // Use a transaction to keep this atomic per issue
    for (const issue of issues) {
      const appliedTags = JSON.stringify(issue.appliedTags ?? []);

      // Upsert the issue
      await db.issue.upsert({
        where: { id: issue.id },
        create: {
          id: issue.id,
          name: issue.name,
          channelId: channelId || issue.id, // fallback
          guildId,
          ownerId: issue.ownerId,
          ownerUsername: issue.ownerUsername,
          ownerGlobalName: issue.ownerGlobalName,
          ownerAvatar: issue.ownerAvatar,
          createdAt: issue.createdAt ? new Date(issue.createdAt) : new Date(),
          archivedAt: issue.archivedAt ? new Date(issue.archivedAt) : null,
          archived: issue.archived ?? false,
          locked: issue.locked ?? false,
          messageCount: issue.messageCount ?? 0,
          memberCount: issue.memberCount ?? 0,
          totalMessageSent: issue.totalMessageSent ?? 0,
          appliedTags,
          firstMessageId: issue.firstMessageId,
          firstMessageContent: issue.firstMessageContent ?? '',
          firstMessageAuthorId: issue.firstMessageAuthorId,
          firstMessageAuthorName: issue.firstMessageAuthorName,
          firstMessageCreatedAt: issue.firstMessageCreatedAt ? new Date(issue.firstMessageCreatedAt) : null,
          responseTimeMs: issue.responseTimeMs != null ? BigInt(issue.responseTimeMs) : null,
          responderCount: issue.responderCount ?? 0,
          isAnswered: issue.isAnswered ?? false,
          resolutionStatus: issue.resolutionStatus ?? 'unknown',
          sentiment: issue.sentiment ?? null,
          sentimentScore: issue.sentimentScore ?? null,
          sentimentSummary: issue.sentimentSummary ?? null,
        },
        update: {
          name: issue.name,
          ownerId: issue.ownerId,
          ownerUsername: issue.ownerUsername,
          ownerGlobalName: issue.ownerGlobalName,
          ownerAvatar: issue.ownerAvatar,
          archivedAt: issue.archivedAt ? new Date(issue.archivedAt) : null,
          archived: issue.archived ?? false,
          locked: issue.locked ?? false,
          messageCount: issue.messageCount ?? 0,
          memberCount: issue.memberCount ?? 0,
          totalMessageSent: issue.totalMessageSent ?? 0,
          appliedTags,
          firstMessageId: issue.firstMessageId,
          firstMessageContent: issue.firstMessageContent ?? '',
          firstMessageAuthorId: issue.firstMessageAuthorId,
          firstMessageAuthorName: issue.firstMessageAuthorName,
          firstMessageCreatedAt: issue.firstMessageCreatedAt ? new Date(issue.firstMessageCreatedAt) : null,
          responseTimeMs: issue.responseTimeMs != null ? BigInt(issue.responseTimeMs) : null,
          responderCount: issue.responderCount ?? 0,
          isAnswered: issue.isAnswered ?? false,
          resolutionStatus: issue.resolutionStatus ?? 'unknown',
          // Preserve sentiment + duplicateClusterId unless re-passed
          sentiment: issue.sentiment ?? undefined,
          sentimentScore: issue.sentimentScore ?? undefined,
          sentimentSummary: issue.sentimentSummary ?? undefined,
          duplicateClusterId: issue.duplicateClusterId ?? undefined,
        },
      });
      issueCount += 1;

      // Replace replies (only if the issue has replies in the payload)
      if (issue.replies !== undefined) {
        await db.reply.deleteMany({ where: { issueId: issue.id } });
        for (const reply of issue.replies) {
          const r = reply as DiscordMessage;
          await db.reply.create({
            data: {
              id: r.id,
              issueId: issue.id,
              authorId: r.author?.id ?? 'unknown',
              authorUsername: r.author?.username ?? 'unknown',
              authorGlobalName: r.author?.global_name ?? null,
              content: r.content ?? '',
              timestamp: r.timestamp ? new Date(r.timestamp) : new Date(),
              hasAttachment: (r.attachments?.length ?? 0) > 0,
              attachmentCount: r.attachments?.length ?? 0,
            },
          });
          replyCount += 1;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      issueCount,
      replyCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/db/sync]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
