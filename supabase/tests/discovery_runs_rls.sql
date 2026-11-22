-- Run as postgres after applying the worker migration. The test rolls back.
begin;
insert into auth.users (id, email) values
  ('b6569a0d-cb7b-4267-95ea-5d503d7f4e01', 'worker-a@example.test'),
  ('b6569a0d-cb7b-4267-95ea-5d503d7f4e02', 'worker-b@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b6569a0d-cb7b-4267-95ea-5d503d7f4e01', true);
select set_config('request.jwt.claims', '{"sub":"b6569a0d-cb7b-4267-95ea-5d503d7f4e01","role":"authenticated"}', true);
insert into public.discovery_runs (id, started_at, finished_at, status, source, found_count, uploaded_count, request_count, failed_sources)
values ('1c678090-0e5b-49ea-885c-b40d940cfffe', now(), now(), 'SUCCEEDED', 'fixture-a', 3, 3, 4, 0);
insert into public.discovery_runs (id, started_at, finished_at, status, source, found_count, uploaded_count, request_count, failed_sources)
values ('1c678090-0e5b-49ea-885c-b40d940cfffe', now(), now(), 'PARTIAL', 'fixture-a', 3, 1, 4, 1)
on conflict (user_id, id) do nothing;
do $$
begin
  if (select count(*) from public.discovery_runs) <> 1
    or not exists (select from public.discovery_runs where found_count = 3 and uploaded_count = 3) then
    raise exception 'A run retry modified the prior record';
  end if;
  begin
    update public.discovery_runs set status = 'PARTIAL';
    raise exception 'Run update was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', 'b6569a0d-cb7b-4267-95ea-5d503d7f4e02', true);
select set_config('request.jwt.claims', '{"sub":"b6569a0d-cb7b-4267-95ea-5d503d7f4e02","role":"authenticated"}', true);
do $$
begin
  if exists (select from public.discovery_runs) then raise exception 'Worker B can read worker A runs'; end if;
  begin
    insert into public.discovery_runs (user_id, id, started_at, finished_at, status, source,
      found_count, uploaded_count, request_count, failed_sources)
    values ('b6569a0d-cb7b-4267-95ea-5d503d7f4e01', gen_random_uuid(), now(), now(), 'SUCCEEDED', 'fixture',
      0, 0, 0, 0);
    raise exception 'Worker B can insert runs as worker A';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role anon;
do $$
begin
  if has_table_privilege('public.discovery_runs', 'SELECT')
    or has_any_column_privilege('public.discovery_runs', 'INSERT') then
    raise exception 'Anonymous worker log access is enabled';
  end if;
end;
$$;
rollback;
