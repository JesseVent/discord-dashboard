import { supabaseAdmin } from '@/lib/supabase';
import type { DiscordMessage, Issue } from '@/lib/discord-types';

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

      // Response analytics
      is_answered: issue.isAnswered ?? false,
      response_time_ms: issue.responseTimeMs != null ? BigInt(issue.responseTimeMs) : null,
      responder_count: issue.responderCount ?? 0,
      resolution_status: issue.resolutionStatus ?? 'unanswered',
    };
    return row;
  });

  const { error: upsertErr } = await supabaseAdmin.from('issues').upsert(issueRows, { onConflict: 'id' });
  if (upsertErr) throw new Error(`issues upsert failed: ${upsertErr.message}`);

  const issuesWithReplies = issues.filter((i) => i.replies !== undefined);
  let replyCount = 0;

  if (issuesWithReplies.length > 0) {
    const issueIds = issuesWithReplies.map((i) => i.id);
    const { error: delErr } = await supabaseAdmin.from('replies').delete().in('issue_id', issueIds);
    if (delErr) throw new Error(`replies delete failed: ${delErr.message}`);

    const replyRows = issuesWithReplies.flatMap((issue) =>
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

    if (replyRows.length > 0) {
      const { error: insErr } = await supabaseAdmin.from('replies').insert(replyRows);
      if (insErr) throw new Error(`replies insert failed: ${insErr.message}`);
    }
    replyCount = replyRows.length;
  }

  return { issueCount: issueRows.length, replyCount };
}
