// Small outbox + pull sync for per-issue notes, between the browser-embedded
// local notes DB (src/lib/notes-db.ts) and the existing server-side PGlite
// instance (already exposed at /api/rest — see src/app/api/rest/[...path]/route.ts).
//
// Not @supabase/lite's SyncEngine (from the supabaselite demo repo): that class
// subscribes to cloud Realtime, which @supabase/lite doesn't support yet ("coming
// soon" per its own feature table) — there's nothing to subscribe to since the
// "cloud" here is the same local PGlite instance, not hosted Supabase. This is a
// deliberately smaller version: flush-on-interval + pull-by-cursor, no push.

import { createClient } from '@supabase/supabase-js';
import { getLocalNotesClient } from './notes-db';
import { getLocalIdentity } from './local-identity';

// supalite accepts any non-empty string as the anon key pre-1.0 (same
// convention the supabaselite demo repo uses against its own local instance).
// createClient requires an absolute URL, so this must be constructed lazily
// (window isn't available at module-eval time during SSR).
let _cloudClient: ReturnType<typeof createClient> | null = null;
function cloudClient() {
  if (!_cloudClient) {
    _cloudClient = createClient(`${window.location.origin}/api/rest`, 'local-anon-key');
  }
  return _cloudClient;
}

interface NoteRow {
  id: string;
  issue_id: string;
  user_id: string;
  user_name: string;
  content: string;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'synced';

async function localClient() {
  return getLocalNotesClient();
}

export async function readLocalNote(issueId: string): Promise<NoteRow | null> {
  const identity = getLocalIdentity();
  const client = await localClient();
  const { data } = await client
    .from('notes')
    .select('*')
    .eq('issue_id', issueId)
    .eq('user_id', identity.id)
    .maybeSingle();
  return (data as NoteRow) ?? null;
}

export async function writeNote(issueId: string, content: string): Promise<void> {
  const identity = getLocalIdentity();
  const client = await localClient();
  const existing = await readLocalNote(issueId);

  const row: NoteRow = {
    id: existing?.id ?? crypto.randomUUID(),
    issue_id: issueId,
    user_id: identity.id,
    user_name: identity.name,
    content,
    version: (existing?.version ?? 0) + 1,
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  await client.from('notes').upsert(row);
}

// Pull the cloud copy (if any) and take it if it's newer — covers the case
// where the same identity opens the dashboard on a different device/browser.
export async function pullNote(issueId: string): Promise<NoteRow | null> {
  const identity = getLocalIdentity();
  const { data } = await cloudClient()
    .from('notes')
    .select('*')
    .eq('issue_id', issueId)
    .eq('user_id', identity.id)
    .maybeSingle();
  const remote = data as NoteRow | null;
  if (!remote) return null;

  const local = await readLocalNote(issueId);
  if (local && local.updated_at >= remote.updated_at) return local;

  const client = await localClient();
  await client.from('notes').upsert(remote);
  return remote;
}

// Push any local notes newer than what's on the server. Called on an interval
// and on the browser 'online' event — not real-time, since @supabase/lite has
// no Realtime yet to subscribe to.
export async function flushOutbox(): Promise<SyncStatus> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';

  const identity = getLocalIdentity();
  const client = await localClient();
  const { data } = await client.from('notes').select('*').eq('user_id', identity.id);
  const rows = (data as NoteRow[]) ?? [];
  if (rows.length === 0) return 'synced';

  for (const row of rows) {
    const { data: remoteData } = await cloudClient()
      .from('notes')
      .select('updated_at')
      .eq('id', row.id)
      .maybeSingle();
    const remote = remoteData as Pick<NoteRow, 'updated_at'> | null;
    if (remote && remote.updated_at >= row.updated_at) continue;
    await cloudClient().from('notes').upsert(row);
  }
  return 'synced';
}
