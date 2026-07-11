'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { issuesByTag } from '@/lib/dashboard-utils';
import { X } from 'lucide-react';
import type { Issue } from '@/lib/discord-types';

interface FilterBarProps {
  issues: Issue[];
  selectedTagIds: string[];
  onToggleTag: (tagId: string) => void;
  onClearTags: () => void;
}

export function FilterBar({
  issues,
  selectedTagIds,
  onToggleTag,
  onClearTags,
}: FilterBarProps) {
  const tags = issuesByTag(issues);
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground mr-1">Filter by tag:</span>
      {tags.map((t) => {
        const active = selectedTagIds.includes(t.tagId);
        return (
          <button
            key={t.tagId}
            type="button"
            onClick={() => onToggleTag(t.tagId)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card hover:bg-accent'
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: active ? 'currentColor' : t.color }}
            />
            {t.name}
            <span className={active ? 'opacity-90' : 'text-muted-foreground'}>
              {t.count}
            </span>
          </button>
        );
      })}
      {selectedTagIds.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={onClearTags}
        >
          <X className="h-3 w-3 mr-1" /> Clear
        </Button>
      ) : null}
    </div>
  );
}
