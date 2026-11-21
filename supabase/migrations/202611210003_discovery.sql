create table public.discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_url text not null check (length(source_url) <= 2048 and source_url ~* '^https?://[^[:space:]@/?#]+([/?#][^[:space:]]*)?$'),
  source_name text not null check (length(btrim(source_name)) between 1 and 200),
  company_name text not null check (length(btrim(company_name)) between 1 and 200),
  website text not null default '' check (website = '' or (length(website) <= 2048 and website ~* '^https?://[^[:space:]@/?#]+([/?#][^[:space:]]*)?$')),
  address text not null default '' check (length(address) <= 500),
  industry text not null default '' check (length(industry) <= 100),
  city text not null default '' check (length(city) <= 100),
  province text not null default '' check (length(province) <= 100),
  company_type text not null default '' check (length(company_type) <= 100),
  suggested_services jsonb not null default '[]' check (jsonb_typeof(suggested_services) = 'array' and jsonb_array_length(suggested_services) <= 6),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) between 1 and 10),
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  is_logistics_provider boolean not null default false,
  status text not null default 'NEW' check (status in ('NEW', 'NEEDS_REVIEW', 'ACCEPTED', 'REJECTED', 'DUPLICATE')),
  discovered_at timestamptz not null default now(),
  last_checked_at timestamptz not null check (isfinite(last_checked_at)),
  content_fingerprint text not null check (content_fingerprint ~ '^[a-z0-9][a-z0-9:_-]{7,127}$'),
  reviewed_at timestamptz,
  company_id uuid,
  unique (user_id, content_fingerprint),
  unique (user_id, id),
  foreign key (user_id, company_id) references public.companies(user_id, id) on delete set null (company_id)
);
create index discovery_candidates_owner_status on public.discovery_candidates (user_id, status, discovered_at desc);

create table public.discovery_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null,
  old_status text not null check (old_status in ('NEW', 'NEEDS_REVIEW')),
  new_status text not null check (new_status in ('NEEDS_REVIEW', 'ACCEPTED', 'REJECTED', 'DUPLICATE')),
  notes text not null check (length(notes) <= 1000),
  reviewed_at timestamptz not null default now(),
  foreign key (user_id, candidate_id) references public.discovery_candidates(user_id, id) on delete cascade
);
create index discovery_reviews_owner_candidate on public.discovery_reviews (user_id, candidate_id, reviewed_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['discovery_candidates', 'discovery_reviews'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = (select auth.uid()))', table_name);
  end loop;
end;
$$;

-- The owner-scoped fingerprint stays stable across retries for the same source item.
create function public.stage_discovery_candidate(details jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  fields public.discovery_candidates := jsonb_populate_record(null::public.discovery_candidates, details);
  item jsonb;
  saved_id uuid;
begin
  if owner_id is null then raise exception 'Sign in to stage discoveries'; end if;
  if jsonb_typeof(details->'is_logistics_provider') is distinct from 'boolean' then
    raise exception 'Specify whether the candidate is a logistics provider';
  end if;
  if jsonb_typeof(fields.evidence) is distinct from 'array' then raise exception 'Evidence must be an array'; end if;
  for item in select value from jsonb_array_elements(fields.evidence) loop
    if jsonb_typeof(item->'url') is distinct from 'string'
      or jsonb_typeof(item->'excerpt') is distinct from 'string'
      or jsonb_typeof(item->'captured_at') is distinct from 'string'
      or coalesce(item->>'url', '') !~* '^https?://[^[:space:]@/?#]+([/?#][^[:space:]]*)?$'
      or length(item->>'url') > 2048
      or length(btrim(coalesce(item->>'excerpt', ''))) not between 1 and 500
      or coalesce(item->>'captured_at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'Each evidence item requires a URL, excerpt and capture time';
    end if;
    perform (item->>'captured_at')::timestamptz;
  end loop;
  if jsonb_typeof(fields.suggested_services) is distinct from 'array' then raise exception 'Suggested services must be an array'; end if;
  for item in select value from jsonb_array_elements(fields.suggested_services) loop
    if jsonb_typeof(item->'service') is distinct from 'string'
      or jsonb_typeof(item->'reason') is distinct from 'string'
      or jsonb_typeof(item->'evidence_url') is distinct from 'string'
      or coalesce(item->>'service', '') not in ('Air freight', 'Sea freight', 'Customs clearance', 'Domestic trucking', 'Warehousing', 'Integrated logistics')
      or length(btrim(coalesce(item->>'reason', ''))) not between 1 and 500
      or not exists (select 1 from jsonb_array_elements(fields.evidence) as e(value) where e.value->>'url' = item->>'evidence_url') then
      raise exception 'Each suggested service requires a reason linked to evidence';
    end if;
  end loop;

  insert into public.discovery_candidates (user_id, source_url, source_name, company_name, website, address,
    industry, city, province, company_type, suggested_services, reason, evidence, confidence, is_logistics_provider,
    last_checked_at, content_fingerprint)
  values (owner_id, fields.source_url, fields.source_name, fields.company_name, coalesce(fields.website, ''),
    coalesce(fields.address, ''), coalesce(fields.industry, ''), coalesce(fields.city, ''), coalesce(fields.province, ''),
    coalesce(fields.company_type, ''),
    (select coalesce(jsonb_agg(jsonb_build_object('service', s.value->>'service', 'reason', s.value->>'reason',
      'evidence_url', s.value->>'evidence_url') order by s.position), '[]')
      from jsonb_array_elements(fields.suggested_services) with ordinality as s(value, position)),
    fields.reason,
    (select jsonb_agg(jsonb_build_object('url', e.value->>'url', 'excerpt', e.value->>'excerpt',
      'captured_at', e.value->>'captured_at') order by e.position)
      from jsonb_array_elements(fields.evidence) with ordinality as e(value, position)),
    fields.confidence,
    fields.is_logistics_provider, fields.last_checked_at, fields.content_fingerprint)
  on conflict (user_id, content_fingerprint) do nothing returning id into saved_id;
  if saved_id is null then
    select c.id into saved_id from public.discovery_candidates c
      where c.user_id = owner_id and c.content_fingerprint = fields.content_fingerprint;
  end if;
  return saved_id;
end;
$$;
revoke execute on function public.stage_discovery_candidate(jsonb) from public, anon;
grant execute on function public.stage_discovery_candidate(jsonb) to authenticated;

create function public.review_discovery_candidate(candidate_id uuid, decision text, review_notes text default '',
  allow_possible_duplicate boolean default false) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  candidate public.discovery_candidates;
  saved_company uuid;
  candidate_name text;
  candidate_domain text;
begin
  if owner_id is null then raise exception 'Sign in to review discoveries'; end if;
  if decision is null or decision not in ('NEEDS_REVIEW', 'ACCEPTED', 'REJECTED', 'DUPLICATE') then
    raise exception 'Invalid review decision';
  end if;
  -- Serialize acceptance within each owner's inbox, including candidates from different sources.
  if decision = 'ACCEPTED' then perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 322)); end if;
  select * into candidate from public.discovery_candidates c where c.id = candidate_id and c.user_id = owner_id for update;
  if not found then raise exception 'Candidate is unavailable'; end if;
  if candidate.status = decision then return candidate.company_id; end if;
  if candidate.status not in ('NEW', 'NEEDS_REVIEW') then raise exception 'This candidate has already been reviewed'; end if;

  if decision = 'ACCEPTED' then
    if candidate.is_logistics_provider then raise exception 'This logistics provider is outside the prospect criteria'; end if;
    candidate_name := regexp_replace(regexp_replace(btrim(regexp_replace(lower(candidate.company_name), '[^[:alnum:]]+', ' ', 'g')),
      '^(pt|cv|ud|perseroan terbatas) +', ''), ' +tbk$', '');
    candidate_domain := regexp_replace(coalesce(substring(lower(candidate.website) from '^https?://([^/:?#]+)'), ''), '^www\.|\.$', '', 'g');
    if allow_possible_duplicate is not true and exists (
      select from public.companies c where c.user_id = owner_id and (
        (candidate_name <> '' and c.normalized_name = candidate_name) or
        (candidate_domain <> '' and c.normalized_domain = candidate_domain) or
        (btrim(candidate.address) <> '' and btrim(candidate.city) <> '' and
          lower(btrim(c.address)) = lower(btrim(candidate.address)) and lower(btrim(c.city)) = lower(btrim(candidate.city)))
      )
    ) then raise exception 'Possible duplicate. Review matching companies and confirm a separate record.'; end if;

    saved_company := public.save_crm_company(null, jsonb_build_object(
      'name', btrim(candidate.company_name), 'normalized_name', candidate_name,
      'website', candidate.website, 'normalized_domain', candidate_domain, 'address', candidate.address,
      'city', candidate.city, 'province', candidate.province, 'industry', candidate.industry,
      'company_type', candidate.company_type, 'source_type', 'DISCOVERY', 'source_url', candidate.source_url,
      'suggested_services', (select coalesce(jsonb_agg(distinct s.value->>'service'), '[]') from jsonb_array_elements(candidate.suggested_services) s(value)),
      'verified_on', (candidate.last_checked_at at time zone 'UTC')::date, 'notes', ''
    ), 'NEW');
  end if;

  update public.discovery_candidates c set status = decision, reviewed_at = now(), company_id = saved_company
    where c.id = candidate.id and c.user_id = owner_id;
  insert into public.discovery_reviews (user_id, candidate_id, old_status, new_status, notes)
    values (owner_id, candidate.id, candidate.status, decision, btrim(coalesce(review_notes, '')));
  return saved_company;
end;
$$;
revoke execute on function public.review_discovery_candidate(uuid, text, text, boolean) from public, anon;
grant execute on function public.review_discovery_candidate(uuid, text, text, boolean) to authenticated;
