create table public.discovery_runs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  started_at timestamptz not null,
  finished_at timestamptz not null check (finished_at >= started_at),
  status text not null check (status in ('SUCCEEDED', 'PARTIAL', 'FAILED')),
  source text not null check (char_length(source) between 1 and 48),
  found_count integer not null check (found_count between 0 and 100),
  uploaded_count integer not null check (uploaded_count between 0 and found_count),
  request_count integer not null check (request_count between 0 and 100),
  failed_sources integer not null check (failed_sources between 0 and 50),
  error_summary text not null default '' check (char_length(error_summary) <= 2000),
  primary key (user_id, id)
);

create index discovery_runs_owner_recent on public.discovery_runs (user_id, started_at desc);
alter table public.discovery_runs enable row level security;
revoke all on public.discovery_runs from public, anon, authenticated;
grant select on public.discovery_runs to authenticated;
grant insert (id, started_at, finished_at, status, source, found_count, uploaded_count, request_count, failed_sources, error_summary)
  on public.discovery_runs to authenticated;
create policy owner_read on public.discovery_runs for select to authenticated using (user_id = (select auth.uid()));
create policy owner_insert on public.discovery_runs for insert to authenticated with check (user_id = (select auth.uid()));
