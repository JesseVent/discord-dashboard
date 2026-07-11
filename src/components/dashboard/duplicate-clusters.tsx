'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, ExternalLink, Layers } from 'lucide-react';
import type { Issue } from '@/lib/discord-types';
import { tagName, tagColor, tagColorSoft, fmtRelative } from '@/lib/dashboard-utils';
import { threadUrl } from '@/lib/discord-api';

export interface DuplicateClusterData {
  name: string;
  description: string;
  issueIds: string[];
}

interface DuplicateClustersProps {
  issues: Issue[];
  clusters: DuplicateClusterData[];
  channelId?: string;
  guildId?: string;
  onSelectIssue?: (issue: Issue) => void;
}

/**
 * Shows clusters of semantically similar (duplicate) issues — spot recurring bugs.
 */
export function DuplicateClusters({
  issues,
  clusters,
  channelId,
  guildId = '839993398554656828',
  onSelectIssue,
}: DuplicateClustersProps) {
  const hasClusters = clusters.length > 0;
  const issueMap = new Map(issues.map((i) => [i.id, i]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-cat-tool" />
          Duplicate Clusters
          {hasClusters ? (
            <Badge variant="catTool" className="text-[10px]">
              {clusters.length} {clusters.length === 1 ? 'cluster' : 'clusters'}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {hasClusters
            ? 'Recurring issues — same root cause, multiple reports. Fix these first.'
            : 'Click "Detect Duplicates" in Data Source to find recurring issues'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasClusters ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No duplicate analysis yet.
          </p>
        ) : (
          <ScrollArea className="h-[400px] rounded-md">
            <div className="space-y-3 pr-2">
              {clusters.map((cluster, idx) => (
                <div key={idx} className="rounded-md bg-surface-2 p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Copy className="h-3.5 w-3.5 text-cat-tool shrink-0" />
                        <p className="text-sm font-medium truncate">{cluster.name}</p>
                      </div>
                      {cluster.description ? (
                        <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                          {cluster.description}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant="catTool" className="text-[10px] shrink-0">
                      {cluster.issueIds.length} dupes
                    </Badge>
                  </div>
                  <div className="space-y-1 mt-2">
                    {cluster.issueIds.slice(0, 5).map((issueId) => {
                      const issue = issueMap.get(issueId);
                      if (!issue) return null;
                      return (
                        <button
                          key={issueId}
                          onClick={() => onSelectIssue?.(issue)}
                          className="group flex items-center gap-2 w-full rounded p-1.5 hover:bg-accent-soft transition-colors text-left"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium group-hover:text-accent">
                              {issue.name}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[9px] text-muted-foreground font-mono">
                                {fmtRelative(issue.createdAt)}
                              </span>
                              {issue.appliedTags.slice(0, 1).map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex items-center rounded-xs px-1 py-0.5 text-[8px] font-mono font-medium uppercase tracking-wider"
                                  style={{ backgroundColor: tagColorSoft(t), color: tagColor(t) }}
                                >
                                  {tagName(t)}
                                </span>
                              ))}
                            </div>
                          </div>
                          <a
                            href={threadUrl({ guildId, channelId: channelId ?? '', threadId: issue.id })}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 text-muted-foreground hover:text-accent"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </button>
                      );
                    })}
                    {cluster.issueIds.length > 5 ? (
                      <p className="text-[10px] text-muted-foreground pl-2">
                        +{cluster.issueIds.length - 5} more
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
