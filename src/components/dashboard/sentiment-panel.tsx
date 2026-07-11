'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Frown, Meh, Smile, CheckCircle2, Brain, ExternalLink } from 'lucide-react';
import type { Issue } from '@/lib/discord-types';
import { tagName, tagColor, tagColorSoft, fmtRelative } from '@/lib/dashboard-utils';
import { threadUrl } from '@/lib/discord-api';

interface SentimentPanelProps {
  issues: Issue[];
  channelId?: string;
  guildId?: string;
  onSelectIssue?: (issue: Issue) => void;
}

const SENTIMENT_META = {
  frustrated: { icon: Frown, color: 'var(--agl-error)', label: 'Frustrated', badge: 'error' as const },
  neutral: { icon: Meh, color: 'var(--agl-muted-fg)', label: 'Neutral', badge: 'secondary' as const },
  positive: { icon: Smile, color: 'var(--agl-cat-chain)', label: 'Positive', badge: 'success' as const },
  resolved: { icon: CheckCircle2, color: 'var(--agl-success)', label: 'Resolved', badge: 'success' as const },
  unknown: { icon: Meh, color: 'var(--agl-muted-fg)', label: 'Unknown', badge: 'secondary' as const },
};

/**
 * Lists issues grouped by sentiment. Helps spot frustrated users who need attention.
 */
export function SentimentPanel({ issues, channelId, guildId = '839993398554656828', onSelectIssue }: SentimentPanelProps) {
  const hasSentiment = issues.some((i) => i.sentiment && i.sentiment !== 'unknown');

  // Group by sentiment
  const groups: Record<string, Issue[]> = { frustrated: [], neutral: [], positive: [], resolved: [], unknown: [] };
  for (const issue of issues) {
    const s = issue.sentiment ?? 'unknown';
    (groups[s] ?? groups.unknown).push(issue);
  }

  // Order: frustrated first (most actionable), then resolved, positive, neutral, unknown
  const order = ['frustrated', 'resolved', 'positive', 'neutral', 'unknown'] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-pending" />
          Sentiment Analysis
        </CardTitle>
        <CardDescription>
          {hasSentiment
            ? 'LLM-scored sentiment per issue — frustrated users need attention'
            : 'Click "Analyze Sentiment" in Data Source to score issues'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasSentiment ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No sentiment data yet.
          </p>
        ) : (
          <ScrollArea className="h-[400px] rounded-md">
            <div className="space-y-4 pr-2">
              {order.map((sentimentKey) => {
                const groupIssues = groups[sentimentKey] ?? [];
                if (groupIssues.length === 0) return null;
                const meta = SENTIMENT_META[sentimentKey];
                const Icon = meta.icon;
                return (
                  <div key={sentimentKey}>
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="h-4 w-4" style={{ color: meta.color }} />
                      <span className="agl-eyebrow">{meta.label}</span>
                      <Badge variant={meta.badge} className="text-[10px]">
                        {groupIssues.length}
                      </Badge>
                    </div>
                    <div className="space-y-1.5 ml-1">
                      {groupIssues.slice(0, 8).map((issue) => (
                        <button
                          key={issue.id}
                          onClick={() => onSelectIssue?.(issue)}
                          className="group flex items-start gap-2 w-full rounded-md p-2 hover:bg-accent-soft transition-colors text-left"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium group-hover:text-accent">
                              {issue.name}
                            </p>
                            {issue.sentimentSummary ? (
                              <p className="truncate text-[11px] text-muted-foreground mt-0.5">
                                {issue.sentimentSummary}
                              </p>
                            ) : null}
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {fmtRelative(issue.createdAt)}
                              </span>
                              {issue.appliedTags.slice(0, 1).map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex items-center rounded-xs px-1 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider"
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
                      ))}
                      {groupIssues.length > 8 ? (
                        <p className="text-[10px] text-muted-foreground pl-2">
                          +{groupIssues.length - 8} more
                        </p>
                      ) : null}
                    </div>
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
