create table if not exists public.notes (
  id uuid primary key,
  issue_id text not null references discord.issues(id) on delete cascade,
  user_id uuid not null,
  user_name text not null,
  content text not null default '',
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notes_issue_user_idx on public.notes (issue_id, user_id);
create index if not exists notes_updated_at_idx on public.notes (updated_at);

alter table public.notes enable row level security;

-- No real auth in this app (lightweight local identity only) — this policy is
-- open by design, not a security boundary. user_id is just a filter column.
create policy "notes_open_demo" on public.notes for all to anon, authenticated
  using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant all on public.notes to anon, authenticated;
