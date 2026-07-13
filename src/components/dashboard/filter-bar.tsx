'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { issuesByTag, resolutionLabel } from '@/lib/dashboard-utils';
import { Archive, ArrowDownAZ, CheckCircle2, CircleDot, AlertCircle, Filter, Search, Sparkles, X } from 'lucide-react';
import type { Issue } from '@/lib/discord-types';

export type ArchivedFilter = 'all' | 'active' | 'archived';
export type RepliesFilter = 'any' | 'has' | 'none';

export interface DashboardFilters {
  query: string;
  tagIds: ReadonlyArray<string>;
  archivedOnly: ArchivedFilter;
  statuses: ReadonlySet<Issue['resolutionStatus']>;
  sentiments: ReadonlySet<NonNullable<Issue['sentiment']>>;
  hasReplies: RepliesFilter;
  minMessageCount: number | null;
  hasAttachment: boolean | null;
  duplicateClusterOnly: boolean;
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_FILTERS: DashboardFilters = {
  query: '',
  tagIds: [],
  archivedOnly: 'all',
  statuses: new Set(),
  sentiments: new Set(),
  hasReplies: 'any',
  minMessageCount: null,
  hasAttachment: null,
  duplicateClusterOnly: false,
  dateFrom: null,
  dateTo: null,
};

interface FilterBarProps {
  issues: Issue[];
  hasSentimentData: boolean;
  hasDuplicateData: boolean;
  hasRepliesLoaded: boolean;
  totalLoaded: number;
  filteredCount: number;
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  onClear: () => void;
  onToggleTag: (tagId: string) => void;
  onClearTags: () => void;
}

const STATUS_ORDER: ReadonlyArray<Issue['resolutionStatus']> = [
  'unanswered',
  'in-progress',
  'likely-resolved',
  'unknown',
];

const SENTIMENT_ORDER: ReadonlyArray<NonNullable<Issue['sentiment']>> = [
  'frustrated',
  'neutral',
  'positive',
  'resolved',
  'unknown',
];

const STATUS_ICON: Record<Issue['resolutionStatus'], typeof AlertCircle> = {
  unanswered: AlertCircle,
  'in-progress': CircleDot,
  'likely-resolved': CheckCircle2,
  unknown: CircleDot,
};

export function FilterBar({
  issues,
  hasSentimentData,
  hasDuplicateData,
  hasRepliesLoaded,
  totalLoaded,
  filteredCount,
  filters,
  onChange,
  onClear,
  onToggleTag,
  onClearTags,
}: FilterBarProps) {
  const tags = issuesByTag(issues);

  const setField = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const toggleSetMember = <T,>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const hasAnyActive =
    !!filters.query.trim() ||
    filters.tagIds.length > 0 ||
    filters.archivedOnly !== 'all' ||
    filters.statuses.size > 0 ||
    (hasSentimentData && filters.sentiments.size > 0) ||
    (hasRepliesLoaded && filters.hasReplies !== 'any') ||
    filters.minMessageCount != null ||
    filters.hasAttachment != null ||
    (hasDuplicateData && filters.duplicateClusterOnly) ||
    filters.dateFrom != null ||
    filters.dateTo != null;

  return (
    <div className="space-y-3">
      {/* Row 1: search + global summary */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.query}
            onChange={(e) => setField('query', e.target.value)}
            placeholder="Search title, content, reporter…"
            className="pl-7 h-8 text-sm"
          />
        </div>
        <Badge variant="outline" className="text-[10px] tabular-nums">
          <Filter className="h-3 w-3 mr-1" />
          {filteredCount === totalLoaded
            ? `${totalLoaded.toLocaleString()} loaded`
            : `${filteredCount.toLocaleString()} of ${totalLoaded.toLocaleString()} match`}
        </Badge>
        {hasAnyActive ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClear}>
            <X className="h-3 w-3 mr-1" /> Reset all
          </Button>
        ) : null}
      </div>

      {/* Row 2: status, sentiment, archive, replies */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterChipGroup label="Status">
          {STATUS_ORDER.map((s) => {
            const Icon = STATUS_ICON[s];
            const active = filters.statuses.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => setField('statuses', toggleSetMember(filters.statuses, s))}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card hover:bg-accent'
                }`}
              >
                <Icon className="h-3 w-3" />
                {resolutionLabel(s)}
              </button>
            );
          })}
        </FilterChipGroup>

        {hasSentimentData ? (
          <FilterChipGroup label="Sentiment">
            {SENTIMENT_ORDER.map((s) => {
              const active = filters.sentiments.has(s);
              const colorClass =
                s === 'frustrated'
                  ? active
                    ? ''
                    : 'border-error/40 text-error'
                  : s === 'positive' || s === 'resolved'
                  ? active
                    ? ''
                    : 'border-success/40 text-success'
                  : '';
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setField('sentiments', toggleSetMember(filters.sentiments, s))}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : `border-border bg-card hover:bg-accent ${colorClass}`
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  {s}
                </button>
              );
            })}
          </FilterChipGroup>
        ) : null}
      </div>

      {/* Row 3: state filters (archive, replies, dup-cluster, attachments, min msgs, dates) */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <FieldGroup label="Archive">
          <Select
            value={filters.archivedOnly}
            onValueChange={(v) => setField('archivedOnly', v as ArchivedFilter)}
          >
            <SelectTrigger className="h-7 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" /> Active
                </span>
              </SelectItem>
              <SelectItem value="archived">
                <span className="inline-flex items-center gap-1.5">
                  <Archive className="h-3 w-3" /> Archived
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </FieldGroup>

        {hasRepliesLoaded ? (
          <FieldGroup label="Replies">
            <Select
              value={filters.hasReplies}
              onValueChange={(v) => setField('hasReplies', v as RepliesFilter)}
            >
              <SelectTrigger className="h-7 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="has">Has replies</SelectItem>
                <SelectItem value="none">No replies</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
        ) : null}

        <FieldGroup label="Duplicates">
          <label className="inline-flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={filters.duplicateClusterOnly}
              disabled={!hasDuplicateData}
              onChange={(e) => setField('duplicateClusterOnly', e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            cluster only
          </label>
        </FieldGroup>

        <FieldGroup label="Has attachment">
          <Select
            value={filters.hasAttachment == null ? 'any' : filters.hasAttachment ? 'yes' : 'no'}
            onValueChange={(v) =>
              setField('hasAttachment', v === 'any' ? null : v === 'yes')
            }
          >
            <SelectTrigger className="h-7 w-[100px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </FieldGroup>

        <FieldGroup label="Min msgs">
          <Input
            type="number"
            min={0}
            value={filters.minMessageCount ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setField('minMessageCount', v === '' ? null : Math.max(0, Number(v) || 0));
            }}
            placeholder="0"
            className="h-7 w-[72px] text-xs tabular-nums"
          />
        </FieldGroup>

        <FieldGroup label="Sort">
          <Select value="newest" disabled>
            <SelectTrigger className="h-7 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">
                <span className="inline-flex items-center gap-1.5">
                  <ArrowDownAZ className="h-3 w-3" /> Newest
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </FieldGroup>

        <FieldGroup label="From">
          <Input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={(e) => setField('dateFrom', e.target.value || null)}
            className="h-7 w-[130px] text-xs"
          />
        </FieldGroup>
        <FieldGroup label="To">
          <Input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={(e) => setField('dateTo', e.target.value || null)}
            className="h-7 w-[130px] text-xs"
          />
        </FieldGroup>
        {(filters.dateFrom || filters.dateTo) ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => {
              setField('dateFrom', null);
              setField('dateTo', null);
            }}
          >
            <X className="h-3 w-3 mr-1" /> clear dates
          </Button>
        ) : null}
      </div>

      {/* Row 4: tag chips */}
      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t">
          <span className="text-xs font-medium text-muted-foreground mr-1">Tag:</span>
          {tags.map((t) => {
            const active = filters.tagIds.includes(t.tagId);
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
          {filters.tagIds.length > 0 ? (
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
      ) : null}
    </div>
  );
}

function FilterChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs text-muted-foreground shrink-0">{label}</Label>
      {children}
    </div>
  );
}
