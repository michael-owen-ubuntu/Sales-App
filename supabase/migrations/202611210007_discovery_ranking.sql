create function public.discovery_priority(
  services jsonb, confidence text, website text, city text, contacts jsonb, provider boolean
) returns integer language sql immutable strict set search_path = ''
as $$
  select case when provider then 0 else
    least(45, 15 * (select count(distinct item->>'service')::integer from jsonb_array_elements(services) as item))
    + case confidence when 'HIGH' then 15 when 'MEDIUM' then 10 else 5 end
    + 10 * (btrim(website) <> '')::integer
    + 10 * (btrim(city) <> '')::integer
    + 10 * (coalesce(contacts #>> '{LOGISTICS_PIC,name}', '') <> '')::integer
    + 10 * (coalesce(contacts #>> '{LOGISTICS_PIC,phone}', '') <> ''
      or coalesce(contacts #>> '{LOGISTICS_PIC,email}', '') <> '')::integer
  end
$$;
alter table public.discovery_candidates add column priority_score integer generated always as (
  public.discovery_priority(suggested_services, confidence, website, city, published_contacts, is_logistics_provider)
) stored;
