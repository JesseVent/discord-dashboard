'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FetchProgress, Issue, ThemeCluster } from '@/lib/discord-types';

interface DashboardState {
  // config
  channelId: string;
  authToken: string;
  setConfig: (cfg: { channelId?: string; authToken?: string }) => void;

  // data
  issues: Issue[];
  totalResults: number;
  themes: ThemeCluster[];
  lastFetchedAt: string | null;
  hasMore: boolean;
  source: 'sample' | 'discord' | 'upload' | null;

  // progress
  progress: FetchProgress;
  setProgress: (p: Partial<FetchProgress>) => void;

  // actions
  setIssues: (issues: Issue[]) => void;
  setThemes: (themes: ThemeCluster[]) => void;
  setTotalResults: (n: number) => void;
  setHasMore: (b: boolean) => void;
  setSource: (s: 'sample' | 'discord' | 'upload' | null) => void;
  markFetched: () => void;
  reset: () => void;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      channelId: '1006358244786196510',
      authToken: '',
      setConfig: (cfg) =>
        set((s) => ({
          channelId: cfg.channelId ?? s.channelId,
          authToken: cfg.authToken ?? s.authToken,
        })),

      issues: [],
      totalResults: 0,
      themes: [],
      lastFetchedAt: null,
      hasMore: false,
      source: null,

      progress: {
        stage: 'idle',
        fetchedCount: 0,
        totalResults: 0,
        message: '',
      },
      setProgress: (p) =>
        set((s) => ({ progress: { ...s.progress, ...p } })),

      setIssues: (issues) => set({ issues }),
      setThemes: (themes) => set({ themes }),
      setTotalResults: (n) => set({ totalResults: n }),
      setHasMore: (b) => set({ hasMore: b }),
      setSource: (s) => set({ source: s }),
      markFetched: () =>
        set({ lastFetchedAt: new Date().toISOString(), progress: { stage: 'done', fetchedCount: 0, totalResults: 0, message: '' } }),
      reset: () =>
        set({
          issues: [],
          themes: [],
          totalResults: 0,
          hasMore: false,
          lastFetchedAt: null,
          source: null,
          progress: { stage: 'idle', fetchedCount: 0, totalResults: 0, message: '' },
        }),
    }),
    {
      name: 'discord-issue-dashboard',
      partialize: (s) => ({
        channelId: s.channelId,
        authToken: s.authToken,
        issues: s.issues,
        themes: s.themes,
        totalResults: s.totalResults,
        hasMore: s.hasMore,
        lastFetchedAt: s.lastFetchedAt,
        source: s.source,
      }),
    },
  ),
);
