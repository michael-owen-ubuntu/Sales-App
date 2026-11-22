create function public.stage_enriched_discovery_candidate(details jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  candidate_id uuid;
begin
  candidate_id := public.stage_discovery_candidate(details);
  if exists (
    select 1 from public.discovery_candidates c
    where c.id = candidate_id and c.user_id = owner_id and c.status = 'NEW'
      and c.source_url = details->>'source_url'
      and jsonb_array_length(c.evidence) + jsonb_array_length(details->'evidence') <= 10
      and ((c.website = '' and coalesce(details->>'website', '') <> '')
        or (c.suggested_services = '[]' and jsonb_array_length(details->'suggested_services') > 0))
  ) then
    -- The original ingestion validator checks linked evidence and service names.
    perform public.stage_discovery_candidate_base(details);
    update public.discovery_candidates c set
      website = coalesce(nullif(c.website, ''), details->>'website', ''),
      suggested_services = case when c.suggested_services = '[]' then details->'suggested_services' else c.suggested_services end,
      evidence = c.evidence || (
        select jsonb_agg(jsonb_build_object('url', item->>'url', 'excerpt', item->>'excerpt', 'captured_at', item->>'captured_at') order by position)
        from jsonb_array_elements(details->'evidence') with ordinality as rows(item, position)
      ),
      confidence = case when c.confidence = 'LOW' and details->>'confidence' = 'MEDIUM' then 'MEDIUM' else c.confidence end,
      last_checked_at = greatest(c.last_checked_at, (details->>'last_checked_at')::timestamptz)
    where c.id = candidate_id and c.user_id = owner_id and c.status = 'NEW';
  end if;
  return candidate_id;
end;
$$;
revoke execute on function public.stage_enriched_discovery_candidate(jsonb) from public, anon;
grant execute on function public.stage_enriched_discovery_candidate(jsonb) to authenticated;
