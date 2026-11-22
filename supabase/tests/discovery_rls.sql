-- Run as postgres on a disposable Supabase database after applying the migrations.
begin;
insert into auth.users (id, email) values
  ('7af991e5-cf1b-452a-9b41-584e68eb38a1', 'discovery-a@example.test'),
  ('7af991e5-cf1b-452a-9b41-584e68eb38a2', 'discovery-b@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '7af991e5-cf1b-452a-9b41-584e68eb38a1', true);
select set_config('request.jwt.claims', '{"sub":"7af991e5-cf1b-452a-9b41-584e68eb38a1","role":"authenticated"}', true);
select set_config('test.discovery_draft', '{
  "content_fingerprint":"fixture:manufacturer",
  "country_code":"ID",
  "source_url":"https://fixtures.example/manufacturer",
  "source_name":"Fixture directory",
  "company_name":"PT Fixture Manufacturer",
  "website":"https://www.fixture.example/products",
  "reason":"Fixture lists imported components.",
  "confidence":"HIGH",
  "is_logistics_provider":false,
  "last_checked_at":"2026-11-20T08:00:00Z",
  "evidence":[{"url":"https://fixtures.example/manufacturer","excerpt":"Fixture components are imported.","captured_at":"2026-11-20T08:00:00Z"}],
  "suggested_services":[{"service":"Customs clearance","reason":"Imported components provide a service signal.","evidence_url":"https://fixtures.example/manufacturer"}]
}', true);

select set_config('test.discovery_a', public.stage_discovery_candidate(current_setting('test.discovery_draft')::jsonb)::text, true);

do $$
declare
  draft jsonb := current_setting('test.discovery_draft')::jsonb;
  original_id uuid := current_setting('test.discovery_a')::uuid;
  accepted_id uuid;
  flagged_id uuid;
  duplicate_id uuid;
  rejected_id uuid;
begin
  if public.stage_discovery_candidate(draft || '{"status":"ACCEPTED","company_name":"Conflicting retry"}') is distinct from original_id
    or (select count(*) from public.discovery_candidates) <> 1
    or not exists (select from public.discovery_candidates where id = original_id and status = 'NEW' and company_name = 'PT Fixture Manufacturer')
    or exists (select from public.companies)
    or exists (select from public.company_contacts) then
    raise exception 'Discovery staging changed CRM data or duplicated a retry';
  end if;
  begin
    perform public.stage_discovery_candidate(draft || '{"content_fingerprint":"fixture:invalid","evidence":[{"url":"https://example.test","excerpt":{"text":"invalid"},"captured_at":"2026-11-20T08:00:00Z"}]}');
    raise exception using errcode = 'XX000', message = 'Invalid evidence was accepted';
  exception when raise_exception then null;
  end;
  begin
    perform public.review_discovery_candidate(original_id, 'ACCEPTED', repeat('a', 1001));
    raise exception 'Overlong review was accepted';
  exception when check_violation then null;
  end;
  if exists (select from public.companies) then raise exception 'Failed acceptance created a company'; end if;

  perform public.review_discovery_candidate(original_id, 'NEEDS_REVIEW', 'Check the trade source');
  accepted_id := public.review_discovery_candidate(original_id, 'ACCEPTED', 'Confirmed');
  if accepted_id is null
    or public.review_discovery_candidate(original_id, 'ACCEPTED') is distinct from accepted_id
    or public.stage_discovery_candidate(draft) is distinct from original_id
    or not exists (select from public.companies where id = accepted_id and normalized_domain = 'fixture.example'
      and source_type = 'DISCOVERY' and suggested_services = array['Customs clearance'])
    or not exists (select from public.sales_leads where company_id = accepted_id and status = 'NEW')
    or exists (select from public.company_contacts)
    or not exists (select from public.discovery_candidates where id = original_id and status = 'ACCEPTED' and company_id = accepted_id)
    or (select count(*) from public.discovery_reviews where candidate_id = original_id) <> 2 then
    raise exception 'Acceptance lost evidence, fabricated contacts, or produced duplicate records or decisions';
  end if;

  duplicate_id := public.stage_discovery_candidate(draft || '{"content_fingerprint":"fixture:other-source"}');
  begin
    perform public.review_discovery_candidate(duplicate_id, 'ACCEPTED');
    raise exception using errcode = 'XX000', message = 'Possible duplicate was accepted without confirmation';
  exception when raise_exception then null;
  end;
  perform public.review_discovery_candidate(duplicate_id, 'DUPLICATE', 'Existing CRM record');

  flagged_id := public.stage_discovery_candidate(draft || '{"content_fingerprint":"fixture:provider","is_logistics_provider":true}');
  begin
    perform public.review_discovery_candidate(flagged_id, 'ACCEPTED', '', true);
    raise exception using errcode = 'XX000', message = 'Flagged provider was accepted';
  exception when raise_exception then null;
  end;
  perform public.review_discovery_candidate(flagged_id, 'REJECTED', 'Outside prospect criteria');

  rejected_id := public.stage_discovery_candidate(draft || '{"content_fingerprint":"fixture:rejected"}');
  perform public.review_discovery_candidate(rejected_id, 'REJECTED');
  begin
    perform public.review_discovery_candidate(rejected_id, 'NEEDS_REVIEW');
    raise exception using errcode = 'XX000', message = 'A terminal review was changed';
  exception when raise_exception then null;
  end;

  if (select count(*) from public.companies) <> 1 then raise exception 'Non-accept actions wrote to CRM'; end if;
  begin
    update public.discovery_candidates set status = 'NEW' where id = original_id;
    raise exception 'Candidate status was directly writable';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.discovery_reviews where candidate_id = original_id;
    raise exception 'Review was directly writable';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '7af991e5-cf1b-452a-9b41-584e68eb38a2', true);
select set_config('request.jwt.claims', '{"sub":"7af991e5-cf1b-452a-9b41-584e68eb38a2","role":"authenticated"}', true);
do $$
declare
  a_id uuid := current_setting('test.discovery_a')::uuid;
  b_id uuid;
begin
  if exists (select from public.discovery_candidates) or exists (select from public.discovery_reviews) then
    raise exception 'User B can read User A discovery data';
  end if;
  begin
    perform public.review_discovery_candidate(a_id, 'REJECTED');
    raise exception using errcode = 'XX000', message = 'User B can review User A candidate';
  exception when raise_exception then null;
  end;
  b_id := public.stage_discovery_candidate(current_setting('test.discovery_draft')::jsonb);
  if b_id is null or b_id = a_id or not exists (select from public.discovery_candidates where id = b_id) then
    raise exception 'Fingerprints are not scoped to each owner';
  end if;
end;
$$;

reset role;
set local role anon;
do $$
begin
  if has_table_privilege('public.discovery_candidates', 'SELECT')
    or has_table_privilege('public.discovery_reviews', 'SELECT')
    or has_function_privilege('public.stage_discovery_candidate(jsonb)', 'EXECUTE')
    or has_function_privilege('public.review_discovery_candidate(uuid,text,text,boolean)', 'EXECUTE') then
    raise exception 'Anonymous discovery access is enabled';
  end if;
end;
$$;
rollback;
