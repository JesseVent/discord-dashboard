'use client';

import { useEffect, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { getLocalIdentity, setLocalName, type LocalIdentity } from '@/lib/local-identity';
import { readLocalNote, writeNote, pullNote, flushOutbox, type SyncStatus } from '@/lib/notes-sync';

const FLUSH_INTERVAL_MS = 10_000;
const SAVE_DEBOUNCE_MS = 500;

export function NotesPanel({ issueId }: { issueId: string }) {
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<SyncStatus>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIdentity(getLocalIdentity());
  }, []);

  useEffect(() => {
    let cancelled = false;
    readLocalNote(issueId).then((note) => {
      if (!cancelled) setContent(note?.content ?? '');
    });
    pullNote(issueId).then((note) => {
      if (!cancelled && note) setContent((prev) => (prev ? prev : note.content));
    });
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  useEffect(() => {
    const flush = () => flushOutbox().then(setStatus);
    flush();
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    window.addEventListener('online', flush);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', flush);
    };
  }, []);

  function onChange(value: string) {
    setContent(value);
    setStatus('syncing');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await writeNote(issueId, value);
      setStatus(await flushOutbox());
    }, SAVE_DEBOUNCE_MS);
  }

  if (!identity) return null;

  if (!identity.name) {
    return (
      <div>
        <div className="agl-eyebrow mb-2">My Notes</div>
        <Input
          placeholder="Your name, to keep notes yours across sessions"
          onKeyDown={(e) => {
            if (e.key === 'Enter') setIdentity(setLocalName(e.currentTarget.value.trim()));
          }}
        />
      </div>
    );
  }

  const statusLabel: Record<SyncStatus, string> = {
    idle: '',
    syncing: 'saving…',
    offline: 'offline — will sync when back online',
    synced: 'saved',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="agl-eyebrow">My Notes</span>
        <span className="text-[11px] text-muted-foreground">{statusLabel[status]}</span>
      </div>
      <Textarea
        placeholder="Private notes about this issue — only visible to you, works offline."
        value={content}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
      />
    </div>
  );
}
