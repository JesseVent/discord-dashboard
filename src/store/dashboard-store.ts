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
  source: 'sample' | 'discord' | 'upload' | 'database' | null;
  repliesFetchedAt: string | null; // timestamp when replies were last fetched
  fetchingReplies: boolean; // true while reply fetch is in progress
  replyProgress: { done: number; total: number } | null;
  sentimentFetchedAt: string | null;
  analyzingSentiment: boolean;
  duplicatesFetchedAt: string | null;
  detectingDuplicates: boolean;
  duplicateClusters: Array<{ name: string; description: string; issueIds: string[] }>;

  // progress
  progress: FetchProgress;
  setProgress: (p: Partial<FetchProgress>) => void;

  // actions
  setIssues: (issues: Issue[]) => void;
  setThemes: (themes: ThemeCluster[], method?: 'llm' | 'fallback') => void;
  setTotalResults: (n: number) => void;
  setHasMore: (b: boolean) => void;
  setSource: (s: 'sample' | 'discord' | 'upload' | 'database' | null) => void;
  markFetched: () => void;
  setRepliesFetchedAt: (ts: string | null) => void;
  setFetchingReplies: (b: boolean) => void;
  setReplyProgress: (p: { done: number; total: number } | null) => void;
  setSentimentFetchedAt: (ts: string | null) => void;
  setAnalyzingSentiment: (b: boolean) => void;
  setDuplicatesFetchedAt: (ts: string | null) => void;
  setDetectingDuplicates: (b: boolean) => void;
  setDuplicateClusters: (c: Array<{ name: string; description: string; issueIds: string[] }>) => void;
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
      sentimentFetchedAt: null,
      analyzingSentiment: false,
      duplicatesFetchedAt: null,
      detectingDuplicates: false,
      duplicateClusters: [],

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
      setSentimentFetchedAt: (ts) => set({ sentimentFetchedAt: ts }),
      setAnalyzingSentiment: (b) => set({ analyzingSentiment: b }),
      setDuplicatesFetchedAt: (ts) => set({ duplicatesFetchedAt: ts }),
      setDetectingDuplicates: (b) => set({ detectingDuplicates: b }),
      setDuplicateClusters: (c) => set({ duplicateClusters: c }),
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
          sentimentFetchedAt: null,
          analyzingSentiment: false,
          duplicatesFetchedAt: null,
          detectingDuplicates: false,
          duplicateClusters: [],
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
        sentimentFetchedAt: s.sentimentFetchedAt,
        duplicatesFetchedAt: s.duplicatesFetchedAt,
        duplicateClusters: s.duplicateClusters,
      }),
    },
  ),
);
