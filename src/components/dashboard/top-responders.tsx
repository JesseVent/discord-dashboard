'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { MessageCircleReply, Heart } from 'lucide-react';
import type { Issue } from '@/lib/discord-types';
import { topResponders } from '@/lib/dashboard-utils';

interface TopRespondersProps {
  issues: Issue[];
}

function initials(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 _]/g, '').split(/[\s_]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Top Responders — users who reply to issues (helpers), not issue creators.
 * Only populated when replies have been fetched.
 */
export function TopResponders({ issues }: TopRespondersProps) {
  const hasReplies = issues.some((i) => i.replies !== undefined);
  const responders = topResponders(issues, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircleReply className="h-4 w-4 text-cat-agent" />
          Top Responders
        </CardTitle>
        <CardDescription>
          {hasReplies
            ? 'Users who reply to issues — your community helpers'
            : 'Click "Fetch Replies" in Data Source to populate'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!hasReplies ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No reply data loaded yet.
          </p>
        ) : responders.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No responders found in the loaded threads.
          </p>
        ) : (
          responders.map((r, idx) => {
            const displayName = r.globalName ?? r.username;
            return (
              <div
                key={r.userId}
                className="flex items-center justify-between gap-3 rounded-md p-2 hover:bg-accent-soft transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-5 text-xs font-mono font-medium text-muted-foreground tabular-nums">
                    {idx + 1}
                  </span>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs bg-cat-agent-soft text-cat-agent">
                      {initials(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">@{r.username}</p>
                  </div>
                </div>
                <div className="text-right shrink-0 flex items-center gap-2">
                  <Badge variant="catAgent" className="text-[10px]">
                    <MessageCircleReply className="h-3 w-3" />
                    {r.replyCount}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <Heart className="h-3 w-3" />
                    {r.issuesHelped}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
