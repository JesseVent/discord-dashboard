import { App } from '@supabase/lite';
import { createPgliteConnection } from '@supabase/lite/pglite';
import { applyPendingMigrations } from '@supabase/lite/cli';
import type { SupabaseClient } from '@supabase/supabase-js';
import path from 'path';

// Global singleton to survive Next.js dev hot-reloads
const globalForSupabase = globalThis as unknown as {
  supabaseApp?: App;
  supabaseClient?: SupabaseClient<any, 'public', any>;
  migrationPromise?: Promise<void>;
  pgliteConnection?: any; // raw PgliteConnection for direct exec()
};

const isNextBuild = process.env.NEXT_PHASE === 'phase-production-build';

if (isNextBuild) {
  // Mock initialization for build phase to prevent WebAssembly/database errors
  globalForSupabase.migrationPromise = Promise.resolve();
  globalForSupabase.supabaseApp = {} as any;
  globalForSupabase.supabaseClient = {} as any;
} else if (!globalForSupabase.supabaseApp || !globalForSupabase.supabaseClient) {
  // Start initialization and migrations in the background
  globalForSupabase.migrationPromise = (async () => {
    try {
      // 1. Resolve PGlite connection first using absolute path
      const connection = await createPgliteConnection({
        url: path.resolve(process.cwd(), './supabase/.temp/data.db'),
      });

      // Wrap the PGlite query method to automatically serialize array parameters
      const pglite = (connection as any).driver;
      if (pglite && typeof pglite.query === 'function') {
        const originalQuery = pglite.query;
        pglite.query = function (sql: string, params?: any[], options?: any) {
          if (params && Array.isArray(params)) {
            params = params.map(val => {
              if (Array.isArray(val)) {
                const toPgArray = (arr: any[]): string => {
                  const elements = arr.map(v => {
                    if (v === null || v === undefined) return 'NULL';
                    if (Array.isArray(v)) return toPgArray(v);
                    if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
                    return String(v);
                  });
                  return `{${elements.join(',')}}`;
                };
                return toPgArray(val);
              }
              return val;
            });
          }
          return originalQuery.call(this, sql, params, options);
        };
      }

      // 2. Instantiate App with resolved connection and exposed schemas
      const app = new App({
        connection,
        db: {
          schemas: ['public', 'discord'],
        },
        auth: {
          enabled: true,
          jwt_secret: process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-secret-change-me',
        },
      });

      // 3. Initialize the app
      await app.init();

      // 4. Apply migrations
      const result = await applyPendingMigrations(app);
      console.log(`[Supabase Lite] Applied migrations: ${result.applied.length}, skipped: ${result.skipped.length}`);

      // 5. Instantiating client configured for the discord schema
      const client = app.getClient({
        db: { schema: 'discord' },
        auth: { persistSession: false }
      });

      globalForSupabase.supabaseApp = app;
      globalForSupabase.supabaseClient = client;
      globalForSupabase.pgliteConnection = connection;
    } catch (err) {
      console.error('[Supabase Lite] Initialization/Migration failed:', err);
    }
  })();
}

// Export supabaseAdmin as a Proxy that delegates to the lazy-loaded client.
// Every route handler must call `await ensureDatabaseReady()` first to guarantee
// the underlying client is initialized.
export const supabaseAdmin = new Proxy({} as any, {
  get(target, prop, receiver) {
    if (prop === 'then') {
      return undefined;
    }
    const client = globalForSupabase.supabaseClient;
    if (!client) {
      throw new Error(
        `Supabase Lite client is not initialized yet. Ensure you await ensureDatabaseReady() before calling database methods. Accessed property: "${String(prop)}"`
      );
    }
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});

// Getter for the in-process app instance
export const supabaseLiteApp = new Proxy({} as any, {
  get(target, prop, receiver) {
    const app = globalForSupabase.supabaseApp;
    if (!app) {
      throw new Error(`Supabase Lite app is not initialized yet. Ensure you await ensureDatabaseReady() first.`);
    }
    const value = (app as any)[prop];
    return typeof value === 'function' ? value.bind(app) : value;
  }
});

/**
 * Ensures that the database has finished initialization and all pending
 * migrations have been applied before executing database queries.
 */
export async function ensureDatabaseReady() {
  if (globalForSupabase.migrationPromise) {
    await globalForSupabase.migrationPromise;
  }
}

/**
 * Execute a raw SQL statement directly against PGlite, bypassing PostgREST.
 * Useful for INSERT ... ON CONFLICT DO UPDATE and other statements that
 * the embedded PostgREST layer doesn't support.
 */
export async function execRawSQL(sql: string, params?: any[]): Promise<any[]> {
  await ensureDatabaseReady();
  const conn = globalForSupabase.pgliteConnection;
  if (!conn) throw new Error('PGlite connection not available');
  // Use the pglite driver directly
  const pglite = conn.driver;
  const result = await pglite.query(sql, params ?? []);
  return result.rows;
}
