import { supabaseAdmin, ensureDatabaseReady, execRawSQL } from '@/lib/supabase';
import type { DiscordMessage, Issue } from '@/lib/discord-types';

/** Max rows per upsert batch to avoid PGlite parameter limits */
const BATCH_SIZE = 50;

/**
 * SERVER-ONLY: upsert issues (+ optionally their replies) into Supabase.
 * Shared by the client-driven full sync (/api/db/sync) and the scheduled
 * incremental sync (/api/db/sync-incremental) so both persist identically.
 *
 * - Upserts each issue (by Discord thread ID); columns omitted from the row
 *   (e.g. sentiment when not yet analyzed) are left untouched on conflict.
 * - Replaces all replies for any issue where `issue.replies` is defined.
 */
export async function upsertIssuesAndReplies(opts: {
  issues: Issue[];
  channelId: string;
  guildId?: string | null;
}): Promise<{ issueCount: number; replyCount: number }> {
  await ensureDatabaseReady();
  const { issues, channelId, guildId = null } = opts;
  if (issues.length === 0) return { issueCount: 0, replyCount: 0 };

  const issueRows = issues.map((issue) => {
    const row: Record<string, unknown> = {
      id: issue.id,
      name: issue.name,
      channel_id: channelId || issue.id,
      guild_id: guildId,
      owner_id: issue.ownerId,
      owner_username: issue.ownerUsername,
      owner_global_name: issue.ownerGlobalName,
      owner_avatar: issue.ownerAvatar,
      created_at: issue.createdAt || new Date().toISOString(),
      archived_at: issue.archivedAt ?? null,
      archived: issue.archived ?? false,
      locked: issue.locked ?? false,
      message_count: issue.messageCount ?? 0,
      member_count: issue.memberCount ?? 0,
      total_message_sent: issue.totalMessageSent ?? 0,
      applied_tags: issue.appliedTags ?? [],
      first_message_id: issue.firstMessageId,
      first_message_content: issue.firstMessageContent ?? '',
      first_message_author_id: issue.firstMessageAuthorId,
      first_message_author_name: issue.firstMessageAuthorName,
      first_message_created_at: issue.firstMessageCreatedAt,

      // Response analytics — use plain number (not BigInt) for PGlite compatibility
      is_answered: issue.isAnswered ?? false,
      response_time_ms: issue.responseTimeMs != null ? Number(issue.responseTimeMs) : null,
      responder_count: issue.responderCount ?? 0,
      resolution_status: issue.resolutionStatus ?? 'unanswered',
    };
    return row;
  });

  // Batch upserts to avoid hitting PGlite parameter limits
  for (let i = 0; i < issueRows.length; i += BATCH_SIZE) {
    const batch = issueRows.slice(i, i + BATCH_SIZE);
    const { error: upsertErr } = await supabaseAdmin.from('issues').upsert(batch, { onConflict: 'id' });
    if (upsertErr) throw new Error(`issues upsert failed: ${upsertErr.message}`);
  }

  const issuesWithReplies = issues.filter((i) => i.replies !== undefined);
  let replyCount = 0;

  if (issuesWithReplies.length > 0) {
    for (let i = 0; i < issuesWithReplies.length; i += BATCH_SIZE) {
      const batchIssues = issuesWithReplies.slice(i, i + BATCH_SIZE);

      const replyRows = batchIssues.flatMap((issue) =>
        (issue.replies ?? []).map((reply) => {
          const r = reply as DiscordMessage;
          return {
            id: r.id,
            issue_id: issue.id,
            author_id: r.author?.id ?? 'unknown',
            author_username: r.author?.username ?? 'unknown',
            author_global_name: r.author?.global_name ?? null,
            content: r.content ?? '',
            timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
            has_attachment: (r.attachments?.length ?? 0) > 0,
            attachment_count: r.attachments?.length ?? 0,
          };
        }),
      );

      // Use raw SQL INSERT ... ON CONFLICT DO UPDATE so stale rows are refreshed,
      // bypassing @supabase/lite's embedded PostgREST which doesn't support ON CONFLICT.
      for (let j = 0; j < replyRows.length; j += BATCH_SIZE) {
        const sub = replyRows.slice(j, j + BATCH_SIZE);
        if (sub.length === 0) continue;

        // Build parameterized INSERT ... ON CONFLICT (id) DO UPDATE
        const cols = ['id', 'issue_id', 'author_id', 'author_username', 'author_global_name',
          'content', 'timestamp', 'has_attachment', 'attachment_count'];
        const colsSql = cols.map((c) => `"${c}"`).join(', ');
        const updateSql = cols.filter((c) => c !== 'id')
          .map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');

        const valuePlaceholders: string[] = [];
        const params: unknown[] = [];
        let idx = 1;
        for (const row of sub) {
          const slots = cols.map(() => `$${idx++}`).join(', ');
          valuePlaceholders.push(`(${slots})`);
          params.push(
            row.id, row.issue_id, row.author_id, row.author_username, row.author_global_name,
            row.content, row.timestamp, row.has_attachment, row.attachment_count,
          );
        }

        const sql = `INSERT INTO "discord"."replies" (${colsSql})
VALUES ${valuePlaceholders.join(', ')}
ON CONFLICT (id) DO UPDATE SET ${updateSql}`;

        await execRawSQL(sql, params);
      }
      replyCount += replyRows.length;
    }
  }

  return { issueCount: issueRows.length, replyCount };
}
