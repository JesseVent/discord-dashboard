'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Issue } from '@/lib/discord-types';
import { topContributors } from '@/lib/dashboard-utils';

interface TopContributorsProps {
  issues: Issue[];
}

function initials(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 _]/g, '').split(/[\s_]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function TopContributors({ issues }: TopContributorsProps) {
  const contributors = topContributors(issues, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Contributors</CardTitle>
        <CardDescription>Users who created the most issues</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {contributors.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No contributor data available.
          </p>
        ) : (
          contributors.map((c, idx) => {
            const displayName = c.globalName ?? c.username;
            const avatarUrl = c.ownerId
              ? null // we don't have the avatar hash in the contributor object
              : null;
            return (
              <div
                key={c.ownerId}
                className="flex items-center justify-between gap-3 rounded-md p-2 hover:bg-accent/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-5 text-xs font-medium text-muted-foreground tabular-nums">
                    {idx + 1}
                  </span>
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={avatarUrl ?? undefined} alt={displayName} />
                    <AvatarFallback className="text-xs">
                      {initials(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">@{c.username}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums">{c.count}</p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    {c.totalMessages} msgs
                  </p>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
