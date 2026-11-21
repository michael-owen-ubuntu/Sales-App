create table public.spreadsheet_import_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.spreadsheet_import_receipts enable row level security;
revoke all on public.spreadsheet_import_receipts from public, anon, authenticated;

-- Save the company and every new contact in the row in one transaction.
-- An owner-scoped receipt makes retries of the same reviewed row idempotent.
create function public.import_company_row(
  request_id uuid, details jsonb, lead_status text, contacts jsonb,
  existing_company uuid default null, allow_possible_duplicate boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  saved_id uuid;
  receipt jsonb;
  person jsonb;
  role_name text;
  normalized_name text;
  new_contacts integer := 0;
  skipped_contacts integer := 0;
  is_preferred boolean;
begin
  if owner_id is null then raise exception 'Sign in to import companies'; end if;
  if request_id is null then raise exception 'Missing import row identifier'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 322));
  select r.result into receipt from public.spreadsheet_import_receipts r
    where r.user_id = owner_id and r.request_id = import_company_row.request_id;
  if found then return receipt; end if;

  if jsonb_typeof(contacts) is distinct from 'array' then raise exception 'Expected an array of contacts'; end if;
  if jsonb_array_length(contacts) > 3 then raise exception 'Up to three contacts are supported per row'; end if;
  if existing_company is null then
    if allow_possible_duplicate is not true and exists (
      select 1 from public.companies c where c.user_id = owner_id and (
        (coalesce(details->>'normalized_name', '') <> '' and c.normalized_name = details->>'normalized_name') or
        (coalesce(details->>'normalized_domain', '') <> '' and c.normalized_domain = details->>'normalized_domain') or
        (coalesce(btrim(details->>'address'), '') <> '' and coalesce(btrim(details->>'city'), '') <> ''
          and lower(btrim(c.address)) = lower(btrim(details->>'address')) and lower(btrim(c.city)) = lower(btrim(details->>'city')))
      )
    ) then raise exception 'Possible duplicate. Refresh the preview and review the matching company.'; end if;
    saved_id := public.save_crm_company(null, details || '{"source_type":"IMPORT"}', lead_status);
  else
    if jsonb_array_length(contacts) = 0 then raise exception 'There are no contacts to add for this row'; end if;
    select c.id into saved_id from public.companies c
      where c.user_id = owner_id and c.id = existing_company and c.archived_at is null for update;
    if not found then raise exception 'Company is unavailable or archived'; end if;
  end if;

  for person in select value from jsonb_array_elements(contacts) loop
    role_name := person->>'role';
    normalized_name := regexp_replace(lower(btrim(person->>'name')), '[^[:alnum:]]+', '', 'g');
    if exists (
      select 1 from public.company_contacts c
      where c.user_id = owner_id and c.company_id = saved_id and c.role = role_name and (
        (normalized_name <> '' and normalized_name = regexp_replace(lower(btrim(c.name)), '[^[:alnum:]]+', '', 'g')) or
        (coalesce(person->>'email', '') <> '' and lower(c.email) = lower(person->>'email')) or
        (coalesce(person->>'phone', '') <> '' and regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace(person->>'phone', '[^0-9]', '', 'g'))
      )
    ) then
      skipped_contacts := skipped_contacts + 1;
      continue;
    end if;

    is_preferred := coalesce(person->'is_primary' = 'true'::jsonb, false) and not exists (
      select 1 from public.company_contacts c
      where c.user_id = owner_id and c.company_id = saved_id and c.role = role_name and c.is_primary
    );
    perform public.save_crm_contact(saved_id, null, person || jsonb_build_object('is_primary', is_preferred));
    new_contacts := new_contacts + 1;
  end loop;

  receipt := jsonb_build_object('companyId', saved_id, 'createdCompany', existing_company is null,
    'newContacts', new_contacts, 'skippedContacts', skipped_contacts);
  insert into public.spreadsheet_import_receipts (user_id, request_id, result)
    values (owner_id, import_company_row.request_id, receipt);
  return receipt;
end;
$$;
revoke execute on function public.import_company_row(uuid, jsonb, text, jsonb, uuid, boolean) from public, anon;
grant execute on function public.import_company_row(uuid, jsonb, text, jsonb, uuid, boolean) to authenticated;
