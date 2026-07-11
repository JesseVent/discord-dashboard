'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Flame, ExternalLink, AlertTriangle, Clock } from 'lucide-react';
import type { Issue } from '@/lib/discord-types';
import { tagName, tagColor, tagColorSoft, fmtRelative, fmtDuration } from '@/lib/dashboard-utils';
import { threadUrl } from '@/lib/discord-api';

interface EscalationWatchlistProps {
  issues: Issue[];
  channelId?: string;
  guildId?: string;
  onSelectIssue?: (issue: Issue) => void;
}

/**
 * Escalation watchlist — issues that need attention because:
 *   1. High message count (>5) AND unanswered (no reply from other users)
 *   2. OR High message count AND old (>7 days)
 *   3. OR Old (>14 days) AND unanswered
 *
 * These are the issues that are either stuck, or generating noise without resolution.
 */
export function EscalationWatchlist({
  issues,
  channelId,
  guildId = '839993398554656828',
  onSelectIssue,
}: EscalationWatchlistProps) {
  const escalated = issues
    .filter((i) => {
      const ageMs = i.createdAt ? Date.now() - new Date(i.createdAt).getTime() : 0;
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      const highMessages = i.messageCount >= 5;
      const veryOld = ageDays >= 14;
      const old = ageDays >= 7;
      const unanswered = i.replies !== undefined && !i.isAnswered;

      // Escalation criteria
      if (highMessages && unanswered) return true;
      if (highMessages && old) return true;
      if (veryOld && unanswered) return true;
      return false;
    })
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 15);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-error" />
          Escalation Watchlist
          {escalated.length > 0 ? (
            <Badge variant="error" className="text-[10px]">
              {escalated.length} escalated
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          High-activity or old issues that may need staff attention
        </CardDescription>
      </CardHeader>
      <CardContent>
        {escalated.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No escalated issues. Load replies + run analysis to populate.
          </p>
        ) : (
          <ScrollArea className="h-[320px] rounded-md">
            <div className="space-y-1.5 pr-2">
              {escalated.map((issue) => {
                const ageMs = issue.createdAt ? Date.now() - new Date(issue.createdAt).getTime() : 0;
                const link = threadUrl({
                  guildId,
                  channelId: channelId ?? '',
                  threadId: issue.id,
                });
                const reasons: string[] = [];
                const ageDays = ageMs / (24 * 60 * 60 * 1000);
                if (issue.messageCount >= 5 && issue.replies !== undefined && !issue.isAnswered) {
                  reasons.push('high activity, no reply');
                }
                if (issue.messageCount >= 5 && ageDays >= 7) {
                  reasons.push('high activity, aging');
                }
                if (ageDays >= 14 && issue.replies !== undefined && !issue.isAnswered) {
                  reasons.push('old, unanswered');
                }
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
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                        <span className="inline-flex items-center gap-0.5 font-mono">
                          <AlertTriangle className="h-3 w-3 text-error" />
                          {reasons.join(' · ')}
                        </span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-0.5 font-mono">
                          <Clock className="h-3 w-3" />
                          {fmtDuration(ageMs)} old
                        </span>
                        <span>·</span>
                        <span className="font-mono">{issue.messageCount} msgs</span>
                      </div>
                      {issue.appliedTags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {issue.appliedTags.slice(0, 2).map((t) => (
                            <span
                              key={t}
                              className="inline-flex items-center rounded-xs px-1.5 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider"
                              style={{ backgroundColor: tagColorSoft(t), color: tagColor(t) }}
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
