create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  normalized_name text not null,
  website text not null default '' check (website = '' or website ~* '^https?://[^[:space:]]+$'),
  normalized_domain text not null default '',
  address text not null default '',
  city text not null default '',
  province text not null default '',
  industry text not null default '',
  company_type text not null default '',
  source_type text not null default 'MANUAL',
  source_url text not null default '' check (source_url = '' or source_url ~* '^https?://[^[:space:]]+$'),
  suggested_services text[] not null default '{}',
  verified_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (user_id, id)
);

create index companies_owner_name on public.companies (user_id, normalized_name);
create index companies_owner_domain on public.companies (user_id, normalized_domain) where normalized_domain <> '';

create table public.company_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  role text not null check (role in ('RECEPTIONIST', 'LOGISTICS_PIC', 'PURCHASING_PIC', 'OTHER')),
  phone text not null default '' check (phone = '' or (phone ~ '^\+?[0-9 ().-]+$' and length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 15)),
  email text not null default '' check (email = '' or email ~ '^[^[:space:]@?&#]+@[^[:space:]@?&#]+\.[^[:space:]@?&#]+$'),
  is_primary boolean not null default false,
  verification_status text not null default 'UNVERIFIED' check (verification_status in ('UNVERIFIED', 'VERIFIED')),
  source_url text not null default '' check (source_url = '' or source_url ~* '^https?://[^[:space:]]+$'),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, company_id) references public.companies(user_id, id) on delete cascade
);

create index company_contacts_owner_company on public.company_contacts (user_id, company_id);
create unique index company_contacts_primary_role on public.company_contacts (user_id, company_id, role) where is_primary;

create table public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null,
  status text not null default 'NEW' check (status in ('NEW', 'CONTACTED', 'FOLLOW_UP_REQUIRED', 'QUALIFIED', 'NOT_INTERESTED', 'UNQUALIFIED', 'CLOSED')),
  source_type text not null default 'MANUAL',
  qualification_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, company_id) references public.companies(user_id, id) on delete cascade,
  unique (user_id, company_id)
);

create function public.set_crm_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['companies', 'company_contacts', 'sales_leads'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = (select auth.uid()))', table_name);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', table_name);
    execute format('create policy owner_update on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', table_name);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (user_id = (select auth.uid()))', table_name);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_crm_updated_at()', table_name);
  end loop;
end;
$$;

-- Write the company and its single lead in the same transaction under caller RLS.
create function public.save_crm_company(company_id uuid, details jsonb, lead_status text)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  fields public.companies := jsonb_populate_record(null::public.companies, details);
  saved_id uuid;
begin
  if company_id is null then
    insert into public.companies (name, normalized_name, website, normalized_domain, address, city, province,
      industry, company_type, source_type, source_url, suggested_services, verified_on, notes)
    values (fields.name, fields.normalized_name, fields.website, fields.normalized_domain, fields.address,
      fields.city, fields.province, fields.industry, fields.company_type, fields.source_type, fields.source_url,
      fields.suggested_services, fields.verified_on, fields.notes)
    returning id into saved_id;
  else
    update public.companies c set
      name = fields.name, normalized_name = fields.normalized_name, website = fields.website,
      normalized_domain = fields.normalized_domain, address = fields.address, city = fields.city,
      province = fields.province, industry = fields.industry, company_type = fields.company_type,
      source_type = fields.source_type, source_url = fields.source_url, suggested_services = fields.suggested_services,
      verified_on = fields.verified_on, notes = fields.notes
    where c.id = save_crm_company.company_id and c.archived_at is null
    returning c.id into saved_id;
    if saved_id is null then
      raise exception 'Company is unavailable or archived';
    end if;
  end if;

  insert into public.sales_leads as l (company_id, status, source_type)
  values (saved_id, lead_status, fields.source_type)
  on conflict on constraint sales_leads_user_id_company_id_key do update
    set status = excluded.status, source_type = excluded.source_type;
  return saved_id;
end;
$$;

revoke execute on function public.save_crm_company(uuid, jsonb, text) from public, anon;
grant execute on function public.save_crm_company(uuid, jsonb, text) to authenticated;

-- A company row lock serializes contact mutations with archiving and primary reassignment.
create function public.save_crm_contact(company_id uuid, contact_id uuid, details jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  fields public.company_contacts := jsonb_populate_record(null::public.company_contacts, details);
  saved_id uuid;
begin
  perform c.id from public.companies c where c.id = save_crm_contact.company_id and c.archived_at is null for update;
  if not found then raise exception 'Company is unavailable or archived'; end if;

  if fields.is_primary then
    update public.company_contacts cc set is_primary = false
    where cc.company_id = save_crm_contact.company_id and cc.role = fields.role
      and cc.is_primary and cc.id is distinct from contact_id;
  end if;

  if contact_id is null then
    insert into public.company_contacts (company_id, name, role, phone, email, is_primary, source_url)
    values (save_crm_contact.company_id, fields.name, fields.role, fields.phone, fields.email, fields.is_primary, fields.source_url)
    returning id into saved_id;
  else
    update public.company_contacts cc set name = fields.name, role = fields.role, phone = fields.phone,
      email = fields.email, is_primary = fields.is_primary, source_url = fields.source_url
    where cc.company_id = save_crm_contact.company_id and cc.id = contact_id
    returning cc.id into saved_id;
    if saved_id is null then raise exception 'Contact is unavailable'; end if;
  end if;
  return saved_id;
end;
$$;

revoke execute on function public.save_crm_contact(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_crm_contact(uuid, uuid, jsonb) to authenticated;
