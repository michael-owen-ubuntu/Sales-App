-- Run in Supabase SQL Editor. Enter the worker's CRM email below.
-- First run with delete_rows = false. After reviewing the results,
-- set delete_rows = true and run again to delete the matching records.
with options as (
  select
    ''::text as account_email,
    null::text as only_source,   -- Optional exact source name from Discover.
    now() as before_timestamp,   -- Set a fixed UTC cutoff to repeat the same selection.
    false as delete_rows
), owner as (
  select u.id
  from auth.users u
  cross join options o
  where lower(u.email) = lower(btrim(o.account_email))
    and btrim(o.account_email) <> ''
), matches as materialized (
  select c.id, c.company_name, c.source_name, c.discovered_at
  from public.discovery_candidates c
  join owner on owner.id = c.user_id
  cross join options o
  where c.status = 'NEW'
    and c.company_id is null
    and c.discovered_at < o.before_timestamp
    and (o.only_source is null or c.source_name = o.only_source)
), deleted as (
  delete from public.discovery_candidates c
  using matches m, options o
  where o.delete_rows
    and c.id = m.id
    and c.user_id = (select id from owner)
    and c.status = 'NEW'
    and c.company_id is null
  returning c.id
)
select
  case
    when not exists (select from owner) then 'Enter an existing CRM account email'
    when o.delete_rows then 'Cleanup completed'
    else 'Preview only'
  end as result,
  (select count(*) from matches) as matched_rows,
  (select count(*) from deleted) as deleted_rows,
  coalesce((select jsonb_agg(sample order by sample.discovered_at desc)
            from (select company_name, source_name, discovered_at
                  from matches order by discovered_at desc limit 20) sample), '[]') as sample
from options o;
