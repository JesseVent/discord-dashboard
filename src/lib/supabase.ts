import { createClient } from '@supabase/supabase-js';

/**
 * SERVER-ONLY: admin client scoped to the `discord` schema, authenticated with
 * the service role key. Never import this from a client component — the
 * service role key bypasses RLS.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: process.env.SUPABASE_SCHEMA || 'discord' },
    auth: { persistSession: false },
  },
);

// No-op — kept so callers added during the PGlite experiment don't need
// touching. Hosted Supabase has no async boot step to wait on.
export async function ensureDatabaseReady() {}
