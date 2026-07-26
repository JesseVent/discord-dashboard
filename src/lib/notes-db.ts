// Browser-embedded local notes store — @supabase/lite's browser SQLite driver
// backed by kvvfs (localStorage), not OPFS. OPFS would need a dedicated Worker
// (sync file I/O requires it) plus manual installOpfsSAHPoolVfs() wiring that
// neither @supabase/lite nor @sqlite.org/sqlite-wasm sets up for us — overkill
// for small per-issue text notes. kvvfs persists across reloads with none of
// that, at the cost of a few-MB localStorage ceiling, which notes won't hit.
//
// @supabase/lite's own createConnection() only does `new oo1.DB(url ?? ':memory:')`
// (no VFS selection), so we bypass it and construct the kvvfs-backed Database
// ourselves, then hand it to the lower-level BrowserSqliteConnection directly.
//
// Also deliberately skips createMigrator()/SqliteMigrator: that path translates
// Postgres DDL to SQLite via libpg-query (a WASM Postgres parser), which tries
// to fetch its .wasm file over HTTP in the browser and 404s — Next.js has no
// reason to serve it as a static asset, and this app was never going to feed it
// Postgres syntax anyway (the schema below is already plain SQLite). Executing
// the DDL directly via connection.exec() sidesteps that dependency entirely.

import type { App as AppType } from '@supabase/lite';
import type { SupabaseClient } from '@supabase/supabase-js';

const NOTES_SCHEMA = `
create table if not exists notes (
  id text primary key,
  issue_id text not null,
  user_id text not null,
  user_name text not null,
  content text not null default '',
  version integer not null default 1,
  updated_at text not null,
  deleted_at text
);
create index if not exists notes_issue_user_idx on notes (issue_id, user_id);
`;

let appPromise: Promise<AppType> | null = null;

async function bootLocalNotesApp(): Promise<AppType> {
  // Dynamic imports: statically importing these pulls the Node-condition
  // build into Next.js's SSR pass for this client component (SSR still runs
  // in Node), which doesn't export BrowserSqliteConnection at all. Deferring
  // to a runtime import means this code path only ever executes in the
  // browser, where the browser condition resolves correctly.
  const { App } = await import('@supabase/lite');
  const { BrowserSqliteConnection } = await import('@supabase/lite/sqlite');
  const sqlite3Init = (await import('@sqlite.org/sqlite-wasm')).default;
  const sqlite3 = await sqlite3Init({ print: () => {}, printErr: () => {} });
  const db = new sqlite3.oo1.DB('local', 'ct', 'kvvfs');

  const connection = new BrowserSqliteConnection({ db });
  for (const statement of NOTES_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await connection.exec(statement);
  }

  const app = new App({ connection });
  await app.init();
  return app;
}

export async function getLocalNotesClient(): Promise<SupabaseClient> {
  if (typeof window === 'undefined') {
    throw new Error('getLocalNotesClient() must only be called in the browser');
  }
  if (!appPromise) appPromise = bootLocalNotesApp();
  const app = await appPromise;
  return app.getClient();
}
