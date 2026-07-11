'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FetchProgress, Issue, ThemeCluster } from '@/lib/discord-types';

interface EnvConfig {
  hasEnvToken: boolean;
  hasEnvChannelId: boolean;
  envChannelId: string | null;
}

interface DashboardState {
  // config
  channelId: string;
  authToken: string;
  setConfig: (cfg: { channelId?: string; authToken?: string }) => void;

  // server-side env config (not persisted; queried at runtime)
  envConfig: EnvConfig | null;
  setEnvConfig: (c: EnvConfig | null) => void;

  // data
  issues: Issue[];
  totalResults: number;
  themes: ThemeCluster[];
  themeMethod: 'llm' | 'fallback' | null;
  lastFetchedAt: string | null;
  hasMore: boolean;
  source: 'sample' | 'discord' | 'upload' | null;
  repliesFetchedAt: string | null; // timestamp when replies were last fetched
  fetchingReplies: boolean; // true while reply fetch is in progress
  replyProgress: { done: number; total: number } | null;

  // progress
  progress: FetchProgress;
  setProgress: (p: Partial<FetchProgress>) => void;

  // actions
  setIssues: (issues: Issue[]) => void;
  setThemes: (themes: ThemeCluster[], method?: 'llm' | 'fallback') => void;
  setTotalResults: (n: number) => void;
  setHasMore: (b: boolean) => void;
  setSource: (s: 'sample' | 'discord' | 'upload' | null) => void;
  markFetched: () => void;
  setRepliesFetchedAt: (ts: string | null) => void;
  setFetchingReplies: (b: boolean) => void;
  setReplyProgress: (p: { done: number; total: number } | null) => void;
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

      envConfig: null,
      setEnvConfig: (c) => set({ envConfig: c }),

      issues: [],
      totalResults: 0,
      themes: [],
      themeMethod: null,
      lastFetchedAt: null,
      hasMore: false,
      source: null,
      repliesFetchedAt: null,
      fetchingReplies: false,
      replyProgress: null,

      progress: {
        stage: 'idle',
        fetchedCount: 0,
        totalResults: 0,
        message: '',
      },
      setProgress: (p) =>
        set((s) => ({ progress: { ...s.progress, ...p } })),

      setIssues: (issues) => set({ issues }),
      setThemes: (themes, method) =>
        set({ themes, themeMethod: method ?? null }),
      setTotalResults: (n) => set({ totalResults: n }),
      setHasMore: (b) => set({ hasMore: b }),
      setSource: (s) => set({ source: s }),
      markFetched: () =>
        set({ lastFetchedAt: new Date().toISOString(), progress: { stage: 'done', fetchedCount: 0, totalResults: 0, message: '' } }),
      setRepliesFetchedAt: (ts) => set({ repliesFetchedAt: ts }),
      setFetchingReplies: (b) => set({ fetchingReplies: b }),
      setReplyProgress: (p) => set({ replyProgress: p }),
      reset: () =>
        set({
          issues: [],
          themes: [],
          themeMethod: null,
          totalResults: 0,
          hasMore: false,
          lastFetchedAt: null,
          source: null,
          repliesFetchedAt: null,
          fetchingReplies: false,
          replyProgress: null,
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
        themeMethod: s.themeMethod,
        totalResults: s.totalResults,
        hasMore: s.hasMore,
        lastFetchedAt: s.lastFetchedAt,
        source: s.source,
        repliesFetchedAt: s.repliesFetchedAt,
      }),
    },
  ),
);
