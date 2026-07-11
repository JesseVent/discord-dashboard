'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Sparkles, Tag } from 'lucide-react';
import type { ThemeCluster } from '@/lib/discord-types';
import { cn } from '@/lib/utils';

interface ThemesPanelProps {
  themes: ThemeCluster[];
  totalIssues: number;
  selectedTheme: string | null;
  onSelectTheme: (theme: string | null) => void;
  isAnalyzing?: boolean;
}

export function ThemesPanel({
  themes,
  totalIssues,
  selectedTheme,
  onSelectTheme,
  isAnalyzing,
}: ThemesPanelProps) {
  const maxCount = themes.reduce((m, t) => Math.max(m, t.count), 0) || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Common Themes
        </CardTitle>
        <CardDescription>
          LLM-clustered issue categories. Click a theme to filter the issues table below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isAnalyzing ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                <div className="h-2 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : themes.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No theme analysis yet. Click “Analyze Themes” to run.
          </div>
        ) : (
          themes.map((t) => {
            const pct = totalIssues > 0 ? Math.round((t.count / totalIssues) * 100) : 0;
            const isActive = selectedTheme === t.theme;
            return (
              <button
                key={t.theme}
                type="button"
                onClick={() => onSelectTheme(isActive ? null : t.theme)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/60',
                  isActive ? 'border-primary bg-accent' : 'border-border bg-card',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium text-sm">{t.theme}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {t.count} issues
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {pct}%
                    </Badge>
                  </div>
                </div>
                {t.description ? (
                  <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                    {t.description}
                  </p>
                ) : null}
                <Progress
                  value={(t.count / maxCount) * 100}
                  className="mt-2 h-1.5"
                />
                {t.keywords.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.keywords.slice(0, 4).map((k) => (
                      <span
                        key={k}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
