alter table public.discovery_candidates
  add column country_code text check (country_code = 'ID'),
  add column published_contacts jsonb not null default '{}' check (jsonb_typeof(published_contacts) = 'object');

alter function public.stage_discovery_candidate(jsonb) rename to stage_discovery_candidate_base;
revoke execute on function public.stage_discovery_candidate_base(jsonb) from public, anon, authenticated;

create function public.stage_discovery_candidate(details jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  saved_id uuid;
  roster jsonb := coalesce(details->'published_contacts', '{}');
  clean_roster jsonb := '{}';
  role_name text;
  person jsonb;
  phone text;
  email text;
begin
  if owner_id is null then raise exception 'Sign in to stage discoveries'; end if;
  if details->>'country_code' is distinct from 'ID' then
    raise exception 'Discovery requires an Indonesian business address';
  end if;
  if jsonb_typeof(roster) <> 'object' then raise exception 'Invalid published contacts'; end if;
  for role_name, person in select key, value from jsonb_each(roster) loop
    phone := coalesce(btrim(person->>'phone'), '');
    email := coalesce(btrim(person->>'email'), '');
    if role_name not in ('RECEPTIONIST', 'LOGISTICS_PIC')
      or jsonb_typeof(person->'name') is distinct from 'string'
      or length(btrim(person->>'name')) not between 1 and 200
      or length(phone) > 35
      or (phone <> '' and (phone !~ '^\+?[0-9 ().-]+$' or length(regexp_replace(phone, '[^0-9]', '', 'g')) not between 7 and 15))
      or length(email) > 254
      or (email <> '' and email !~ '^[^[:space:]@?&#]+@[^[:space:]@?&#]+\.[^[:space:]@?&#]+$') then
      raise exception 'Invalid published contact for %', role_name;
    end if;
    clean_roster := clean_roster || jsonb_build_object(role_name, jsonb_build_object(
      'name', btrim(person->>'name'), 'phone', phone, 'email', email));
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 322));
  select c.id into saved_id from public.discovery_candidates c
    where c.user_id = owner_id and c.content_fingerprint = details->>'content_fingerprint';
  if found then return saved_id; end if;

  saved_id := public.stage_discovery_candidate_base(details);
  update public.discovery_candidates set country_code = 'ID', published_contacts = clean_roster
    where id = saved_id and user_id = owner_id;
  return saved_id;
end;
$$;
revoke execute on function public.stage_discovery_candidate(jsonb) from public, anon;
grant execute on function public.stage_discovery_candidate(jsonb) to authenticated;

create function public.copy_discovery_contacts() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  role_name text;
  person jsonb;
begin
  for role_name, person in select key, value from jsonb_each(new.published_contacts) loop
    perform public.save_crm_contact(new.company_id, null, person || jsonb_build_object(
      'role', role_name, 'is_primary', true, 'source_url', new.source_url));
  end loop;
  return new;
end;
$$;
revoke execute on function public.copy_discovery_contacts() from public, anon, authenticated;
create trigger copy_accepted_discovery_contacts after update on public.discovery_candidates
  for each row when (old.status is distinct from new.status and new.status = 'ACCEPTED' and new.company_id is not null)
  execute function public.copy_discovery_contacts();
