'use client';

import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  accent?: string; // tailwind text color class for the icon
  delta?: { value: string; direction: 'up' | 'down' | 'neutral' };
}

/**
 * Agentic Labs "Metric Strip" style KPI card.
 * - No border — surface differentiation only
 * - Mono font for the metric number (tabular-nums)
 * - Eyebrow label (mono, uppercase, muted)
 * - Optional delta indicator with up/down arrow
 */
export function KpiCard({ title, value, subtitle, icon: Icon, accent, delta }: KpiCardProps) {
  return (
    <div className="agl-card flex flex-col gap-2 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="agl-eyebrow">{title}</span>
        <Icon className={cn('h-4 w-4', accent ?? 'text-fg-subtle')} />
      </div>
      <div className="agl-metric text-2xl sm:text-3xl text-fg-strong">
        {value}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {delta ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-mono font-medium tabular-nums',
              delta.direction === 'up' && 'text-success',
              delta.direction === 'down' && 'text-error',
              delta.direction === 'neutral' && 'text-muted-foreground',
            )}
          >
            {delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→'}
            {delta.value}
          </span>
        ) : null}
        {subtitle ? <span className="truncate">{subtitle}</span> : null}
      </div>
    </div>
  );
}
