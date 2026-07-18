import type {
  DiscordMessage,
  DiscordThread,
  Issue,
  PostDataResponse,
  ThreadsSearchResponse,
} from './discord-types';

const DISCORD_API = 'https://discord.com/api/v9';

/**
 * Fetch a page of forum threads from Discord.
 * Server-side only — bypasses CORS.
 */
export async function searchThreads(opts: {
  channelId: string;
  authToken: string;
  archived?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'last_message_time' | 'creation_time';
  sortOrder?: 'asc' | 'desc';
}): Promise<ThreadsSearchResponse> {
  const {
    channelId,
    authToken,
    archived = true,
    limit = 25,
    offset = 0,
    sortBy = 'last_message_time',
    sortOrder = 'desc',
  } = opts;

  const url = new URL(
    `${DISCORD_API}/channels/${channelId}/threads/search`,
  );
  url.searchParams.set('archived', String(archived));
  url.searchParams.set('sort_by', sortBy);
  url.searchParams.set('sort_order', sortOrder);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('tag_setting', 'match_some');

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      authorization: authToken,
      accept: '*/*',
      'content-type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Discord threads/search failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as ThreadsSearchResponse;
}

/**
 * Fetch full first-message content for a batch of thread IDs.
 * Discord limits this to ~10 IDs per call.
 */
export async function fetchPostData(opts: {
  channelId: string;
  authToken: string;
  threadIds: string[];
}): Promise<PostDataResponse> {
  const { channelId, authToken, threadIds } = opts;
  if (threadIds.length === 0) return { threads: {} };
  if (threadIds.length > 10) {
    throw new Error('fetchPostData supports at most 10 thread IDs per call');
  }

  const res = await fetch(
    `${DISCORD_API}/channels/${channelId}/post-data`,
    {
      method: 'POST',
      headers: {
        authorization: authToken,
        accept: '*/*',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ thread_ids: threadIds }),
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Discord post-data failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as PostDataResponse;
}

/**
 * Fetch ALL threads by paginating through search results.
 * Calls onProgress after each page so the UI can show progress.
 * Stops at maxThreads (default 200) for safety.
 */
export async function fetchAllThreads(opts: {
  channelId: string;
  authToken: string;
  maxThreads?: number;
  onProgress?: (fetched: number, total: number) => void;
}): Promise<{
  search: ThreadsSearchResponse;
  allThreads: DiscordThread[];
  allFirstMessages: Record<string, DiscordMessage>;
}> {
  const { channelId, authToken, maxThreads = 200, onProgress } = opts;
  const pageSize = 25;
  const allThreads: DiscordThread[] = [];
  const allFirstMessages: Record<string, DiscordMessage> = {};
  let total = 0;
  let offset = 0;

  while (true) {
    const page = await searchThreads({
      channelId,
      authToken,
      offset,
      limit: pageSize,
    });
    total = page.total_results ?? total;
    for (const t of page.threads) allThreads.push(t);
    for (const fm of page.first_messages ?? []) {
      allFirstMessages[fm.channel_id] = fm;
    }
    onProgress?.(allThreads.length, total);
    if (!page.has_more) break;
    if (allThreads.length >= maxThreads) break;
    offset += pageSize;
  }

  return {
    search: {
      threads: allThreads,
      first_messages: Object.values(allFirstMessages),
      members: [],
      has_more: false,
      total_results: total,
    },
    allThreads,
    allFirstMessages,
  };
}

/**
 * Fetch first-message details for any thread IDs that are missing content.
 * Batches calls to fetchPostData (10 IDs per call).
 */
export async function fetchMissingDetails(opts: {
  channelId: string;
  authToken: string;
  threadIds: string[];
  onProgress?: (fetched: number, total: number) => void;
}): Promise<Record<string, DiscordMessage>> {
  const { channelId, authToken, threadIds, onProgress } = opts;
  const result: Record<string, DiscordMessage> = {};
  const BATCH = 10;

  for (let i = 0; i < threadIds.length; i += BATCH) {
    const batch = threadIds.slice(i, i + BATCH);
    const postData = await fetchPostData({ channelId, authToken, threadIds: batch });
    for (const [tid, info] of Object.entries(postData.threads ?? {})) {
      if (info?.first_message) result[tid] = info.first_message;
    }
    onProgress?.(Math.min(i + BATCH, threadIds.length), threadIds.length);
  }

  return result;
}

/**
 * Normalize a DiscordThread + its first_message into the dashboard's Issue shape.
 */
export function normalizeIssue(
  thread: DiscordThread,
  firstMessage?: DiscordMessage,
): Issue {
  const owner = thread.owner?.user;
  const attachments = firstMessage?.attachments ?? [];
  return {
    id: thread.id,
    name: thread.name,
    createdAt: thread.thread_metadata?.create_timestamp ?? '',
    archivedAt: thread.thread_metadata?.archive_timestamp ?? null,
    archived: thread.thread_metadata?.archived ?? false,
    locked: thread.thread_metadata?.locked ?? false,
    messageCount: thread.message_count ?? 0,
    memberCount: thread.member_count ?? 0,
    totalMessageSent: thread.total_message_sent ?? 0,
    appliedTags: thread.applied_tags ?? [],
    ownerId: thread.owner_id,
    ownerUsername: owner?.username ?? 'unknown',
    ownerGlobalName: owner?.global_name ?? owner?.username ?? null,
    ownerAvatar: owner?.avatar ?? null,
    firstMessageId: firstMessage?.id ?? null,
    firstMessageContent: firstMessage?.content ?? '',
    firstMessageAuthorId: firstMessage?.author?.id ?? null,
    firstMessageAuthorName:
      firstMessage?.author?.global_name ?? firstMessage?.author?.username ?? null,
    firstMessageCreatedAt: firstMessage?.timestamp ?? null,
    hasAttachment: attachments.length > 0,
    attachmentFilenames: attachments.map((a) => a.filename),
  };
}

/**
 * Build a Discord CDN avatar URL.
 */
export function avatarUrl(user: {
  id: string;
  avatar: string | null;
}): string | null {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
}

/**
 * Build the public link to a Discord forum thread.
 */
export function threadUrl(opts: {
  guildId: string;
  channelId: string;
  threadId: string;
}): string {
  return `https://discord.com/channels/${opts.guildId}/${opts.channelId}/${opts.threadId}`;
}

/**
 * Fetch all messages in a thread (paginated internally), oldest-first.
 * Server-side only — same call the /api/discord/messages route proxies.
 */
export async function fetchThreadMessagesRaw(opts: {
  threadId: string;
  authToken: string;
  limit?: number;
}): Promise<DiscordMessage[]> {
  const { threadId, authToken, limit = 100 } = opts;
  const messages: DiscordMessage[] = [];
  let before: string | undefined;

  while (messages.length < limit) {
    const url = new URL(`${DISCORD_API}/channels/${threadId}/messages`);
    url.searchParams.set('limit', String(Math.min(100, limit - messages.length)));
    if (before) url.searchParams.set('before', before);

    const res = await fetch(url, {
      headers: { authorization: authToken, accept: '*/*' },
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 403 || res.status === 404) return []; // thread inaccessible
      throw new Error(`Discord messages failed: ${res.status} ${text.slice(0, 200)}`);
    }

    const batch = (await res.json()) as DiscordMessage[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    messages.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }

  messages.reverse(); // Discord returns newest-first
  return messages;
}

export function computeResponseAnalytics(issue: Issue): Issue {
  const replies = issue.replies ?? [];
  const otherReplies = replies.filter((r) => r.author?.id !== issue.ownerId);
  const isAnswered = otherReplies.length > 0;

  let responseTimeMs: number | null = null;
  let responderCount = 0;
  let resolutionStatus: Issue['resolutionStatus'] = 'unanswered';

  if (isAnswered) {
    const threadTime = issue.firstMessageCreatedAt
      ? new Date(issue.firstMessageCreatedAt).getTime()
      : (issue.createdAt ? new Date(issue.createdAt).getTime() : null);

    const sortedReplies = [...otherReplies].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    if (threadTime && sortedReplies.length > 0) {
      responseTimeMs = new Date(sortedReplies[0].timestamp).getTime() - threadTime;
      // Handle edge cases where reply is somehow backdated or clocked earlier
      if (responseTimeMs < 0) responseTimeMs = 0;
    }

    const responders = new Set(otherReplies.map((r) => r.author?.id).filter(Boolean));
    responderCount = responders.size;

    const hasResolutionKeyword = replies.some((r) => {
      const text = (r.content ?? '').toLowerCase();
      return (
        text.includes('thank') ||
        text.includes('solved') ||
        text.includes('resolved') ||
        text.includes('fixed it') ||
        text.includes('worked') ||
        text.includes('works now') ||
        text.includes('perfect')
      );
    });

    resolutionStatus = hasResolutionKeyword ? 'likely-resolved' : 'in-progress';
  }

  return {
    ...issue,
    replies,
    responseTimeMs,
    responderCount,
    isAnswered,
    resolutionStatus,
  };
}
