// Discord API types for forum thread issue tracking

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  discriminator: string;
  public_flags: number;
  primary_guild?: unknown;
  clan?: unknown;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

export interface DiscordMessage {
  id: string;
  type: number;
  content: string;
  channel_id: string;
  author: DiscordUser;
  attachments: DiscordAttachment[];
  embeds: unknown[];
  mentions: unknown[];
  mention_roles: unknown[];
  mention_everyone: boolean;
  pinned: boolean;
  tts: boolean;
  timestamp: string;
  edited_timestamp: string | null;
  flags: number;
  components: unknown[];
  position: number;
}

export interface ThreadMetadata {
  archived: boolean;
  archive_timestamp: string;
  auto_archive_duration: number;
  locked: boolean;
  create_timestamp: string;
}

export interface DiscordThread {
  id: string;
  type: number;
  last_message_id: string;
  flags: number;
  guild_id: string;
  name: string;
  parent_id: string;
  rate_limit_per_user: number;
  owner_id: string;
  thread_metadata: ThreadMetadata;
  message_count: number;
  member_count: number;
  total_message_sent: number;
  applied_tags: string[];
  owner?: {
    user: DiscordUser;
    [k: string]: unknown;
  };
  member_ids_preview?: string[];
}

export interface ThreadsSearchResponse {
  threads: DiscordThread[];
  members: unknown[];
  has_more: boolean;
  first_messages: DiscordMessage[];
  total_results: number;
}

export interface PostDataResponse {
  threads: Record<
    string,
    {
      first_message: DiscordMessage;
      owner?: {
        user: DiscordUser;
        [k: string]: unknown;
      };
    }
  >;
}

// Normalized issue shape used by the dashboard
export interface Issue {
  id: string;
  name: string;
  createdAt: string; // ISO
  archivedAt: string | null;
  archived: boolean;
  locked: boolean;
  messageCount: number;
  memberCount: number;
  totalMessageSent: number;
  appliedTags: string[];
  ownerId: string;
  ownerUsername: string;
  ownerGlobalName: string | null;
  ownerAvatar: string | null;
  // first_message content (may be empty if not yet fetched)
  firstMessageId: string | null;
  firstMessageContent: string;
  firstMessageAuthorId: string | null;
  firstMessageAuthorName: string | null;
  firstMessageCreatedAt: string | null;
  hasAttachment: boolean;
  attachmentFilenames: string[];
  // theme tagging (filled by LLM analyzer)
  theme?: string;
  // replies (populated when user clicks "Fetch Replies" — all messages after the first)
  replies?: DiscordMessage[];
  // response analytics (computed from replies)
  responseTimeMs?: number | null; // time from first message to first reply
  responderCount?: number; // distinct users who replied (excluding the issue creator)
  isAnswered?: boolean; // has at least one reply from a different user
  resolutionStatus?: 'unanswered' | 'in-progress' | 'likely-resolved' | 'unknown';
}

export interface ThemeCluster {
  theme: string;
  count: number;
  description: string;
  keywords: string[];
  sampleIssueIds: string[];
}

export interface FetchProgress {
  stage: 'idle' | 'fetching-threads' | 'fetching-details' | 'analyzing-themes' | 'done' | 'error';
  fetchedCount: number;
  totalResults: number;
  message: string;
}
