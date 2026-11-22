-- Run against a disposable Supabase database as postgres after applying CRM migrations.
begin;

insert into auth.users (id, email) values
  ('b105d634-ef00-4c82-a321-ae053feb84a1', 'rls-a@example.test'),
  ('b105d634-ef00-4c82-a321-ae053feb84a2', 'rls-b@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b105d634-ef00-4c82-a321-ae053feb84a1', true);
select set_config('request.jwt.claims', '{"sub":"b105d634-ef00-4c82-a321-ae053feb84a1","role":"authenticated"}', true);

select set_config('test.crm_company', public.save_crm_company(null,
  '{"name":"Example A","normalized_name":"example a","website":"","normalized_domain":"","address":"","city":"","province":"","industry":"","company_type":"","source_type":"MANUAL","source_url":"","suggested_services":[],"notes":""}',
  'CONTACTED')::text, true);

select public.save_crm_contact(current_setting('test.crm_company')::uuid, null,
  '{"name":"Example First","role":"LOGISTICS_PIC","phone":"","email":"","is_primary":true,"source_url":""}');
select public.save_crm_contact(current_setting('test.crm_company')::uuid, null,
  '{"name":"Example Preferred","role":"LOGISTICS_PIC","phone":"","email":"","is_primary":true,"source_url":""}');

do $$
begin
  if (select count(*) from public.companies) <> 1
    or (select count(*) from public.company_contacts) <> 2
    or (select count(*) from public.sales_leads where status = 'CONTACTED') <> 1
    or (select name from public.company_contacts where is_primary) is distinct from 'Example Preferred' then
    raise exception 'Owner data or contact reassignment failed';
  end if;
  begin
    perform public.save_crm_company(current_setting('test.crm_company')::uuid,
      '{"name":"Invalid update","normalized_name":"invalid update","website":"","normalized_domain":"","address":"","city":"","province":"","industry":"","company_type":"","source_type":"MANUAL","source_url":"","suggested_services":[],"notes":""}',
      'INVALID');
    raise exception 'Invalid lead status accepted';
  exception when check_violation then null;
  end;
  if not exists (select from public.companies where name = 'Example A') then
    raise exception 'Invalid lead update changed the company';
  end if;
  perform public.save_crm_company(current_setting('test.crm_company')::uuid,
    '{"name":"Example A Updated","normalized_name":"example a updated","website":"","normalized_domain":"","address":"","city":"","province":"","industry":"","company_type":"","source_type":"MANUAL","source_url":"","suggested_services":[],"notes":""}',
    'QUALIFIED');
  if (select count(*) from public.sales_leads) <> 1
    or not exists (select from public.sales_leads where status = 'QUALIFIED') then
    raise exception 'Company edit did not update its existing lead';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', 'b105d634-ef00-4c82-a321-ae053feb84a2', true);
select set_config('request.jwt.claims', '{"sub":"b105d634-ef00-4c82-a321-ae053feb84a2","role":"authenticated"}', true);
insert into public.companies (name, normalized_name) values ('Example B', 'example b');

do $$
declare
  company_a uuid := current_setting('test.crm_company')::uuid;
begin
  if exists (select from public.companies where id = company_a)
    or exists (select from public.company_contacts where company_id = company_a)
    or exists (select from public.sales_leads where company_id = company_a) then
    raise exception 'User B can read User A data';
  end if;
  update public.companies set name = 'Unauthorized' where id = company_a;
  if found then raise exception 'Cross-owner company update allowed'; end if;
  delete from public.company_contacts where company_id = company_a;
  if found then raise exception 'Cross-owner contact deletion allowed'; end if;
  update public.sales_leads set status = 'CLOSED' where company_id = company_a;
  if found then raise exception 'Cross-owner lead update allowed'; end if;
  begin
    insert into public.company_contacts (company_id, name, role) values (company_a, 'Unauthorized', 'OTHER');
    raise exception 'Cross-owner contact reference allowed';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.sales_leads (company_id) values (company_a);
    raise exception 'Cross-owner lead reference allowed';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.companies set user_id = 'b105d634-ef00-4c82-a321-ae053feb84a1';
    raise exception 'Cross-owner transfer allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', 'b105d634-ef00-4c82-a321-ae053feb84a1', true);
select set_config('request.jwt.claims', '{"sub":"b105d634-ef00-4c82-a321-ae053feb84a1","role":"authenticated"}', true);
do $$
begin
  if exists (select from public.companies where name = 'Example B') then
    raise exception 'User A can read User B data';
  end if;
  begin
    insert into public.companies (user_id, name, normalized_name)
    values ('b105d634-ef00-4c82-a321-ae053feb84a2', 'Unauthorized', 'unauthorized');
    raise exception 'User A can insert records owned by User B';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role anon;
do $$
begin
  if has_table_privilege('public.companies', 'SELECT')
    or has_table_privilege('public.company_contacts', 'SELECT')
    or has_table_privilege('public.sales_leads', 'SELECT')
    or has_function_privilege('public.save_crm_company(uuid,jsonb,text)', 'EXECUTE')
    or has_function_privilege('public.save_crm_contact(uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'Anonymous CRM access is enabled';
  end if;
end;
$$;
rollback;
