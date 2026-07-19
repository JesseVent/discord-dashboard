'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, ExternalLink } from 'lucide-react';
import type { Issue } from '@/lib/discord-types';
import { unansweredIssues, fmtRelative, fmtDuration, tagName, tagColor, tagColorSoft } from '@/lib/dashboard-utils';
import { threadUrl } from '@/lib/discord-api';

interface UnansweredIssuesProps {
  issues: Issue[];
  guildId?: string;
  channelId?: string;
  onSelectIssue?: (issue: Issue) => void;
}

/**
 * Lists issues with zero replies from other users, sorted by age.
 * These are the issues most in need of attention.
 */
export function UnansweredIssues({
  issues,
  guildId = '839993398554656828',
  channelId,
  onSelectIssue,
}: UnansweredIssuesProps) {
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');
  const hasReplies = issues.some((i) => i.replies !== undefined);
  const unanswered = unansweredIssues(issues, 20, sortBy);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-error" />
            Needs Attention
            {unanswered.length > 0 ? (
              <Badge variant="error" className="text-[10px]">
                {unanswered.length} unanswered
              </Badge>
            ) : null}
          </CardTitle>
          {hasReplies && unanswered.length > 0 && (
            <div className="flex rounded-md bg-muted p-0.5 text-xs font-medium shrink-0">
              <button
                type="button"
                onClick={() => setSortBy('newest')}
                className={`rounded-sm px-2 py-0.5 transition-colors ${
                  sortBy === 'newest'
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Newest
              </button>
              <button
                type="button"
                onClick={() => setSortBy('oldest')}
                className={`rounded-sm px-2 py-0.5 transition-colors ${
                  sortBy === 'oldest'
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Oldest
              </button>
            </div>
          )}
        </div>
        <CardDescription>
          {hasReplies
            ? `Issues with zero replies from other users, ${sortBy === 'newest' ? 'newest' : 'oldest'} first`
            : 'Click "Fetch Replies" to identify unanswered issues'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasReplies ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No reply data loaded yet.
          </p>
        ) : unanswered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            All loaded issues have at least one reply.
          </p>
        ) : (
          <ScrollArea className="h-[320px] rounded-md">
            <div className="space-y-1.5 pr-2">
              {unanswered.map((issue) => {
                const link = channelId
                  ? threadUrl({ guildId, channelId, threadId: issue.id })
                  : `https://discord.com/channels/${guildId}`;
                const ageMs = issue.createdAt
                  ? Date.now() - new Date(issue.createdAt).getTime()
                  : 0;
                return (
                  <div
                    key={issue.id}
                    className="group flex items-start gap-3 rounded-md p-2 hover:bg-accent-soft transition-colors cursor-pointer"
                    onClick={() => onSelectIssue?.(issue)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium group-hover:text-accent">
                        {issue.name}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">
                          waiting {fmtDuration(ageMs)}
                        </span>
                        <span>·</span>
                        <span>by {issue.ownerGlobalName ?? issue.ownerUsername}</span>
                      </div>
                      {issue.appliedTags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {issue.appliedTags.slice(0, 2).map((t) => (
                            <span
                              key={t}
                              className="inline-flex items-center rounded-xs px-1.5 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider"
                              style={{
                                backgroundColor: tagColorSoft(t),
                                color: tagColor(t),
                              }}
                            >
                              {tagName(t)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 text-muted-foreground hover:text-accent transition-colors"
                      aria-label="Open in Discord"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
