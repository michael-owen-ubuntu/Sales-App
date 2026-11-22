-- Run as postgres on a disposable Supabase database after applying all migrations.
begin;
insert into auth.users (id, email) values
  ('40ba3b39-32d3-45e9-872c-80a2f86282a1', 'import-a@example.test'),
  ('40ba3b39-32d3-45e9-872c-80a2f86282a2', 'import-b@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub','40ba3b39-32d3-45e9-872c-80a2f86282a1',true);
select set_config('request.jwt.claims','{"sub":"40ba3b39-32d3-45e9-872c-80a2f86282a1","role":"authenticated"}',true);
select set_config('test.import_details','{"name":"Fixture Imported Company","normalized_name":"fixture imported company","website":"https://fixture.example","normalized_domain":"fixture.example","address":"","city":"Bekasi","province":"","industry":"","company_type":"","source_url":"","suggested_services":[],"notes":"Original note","verified_on":null}',true);

do $$
declare
  details jsonb := current_setting('test.import_details')::jsonb;
  first_contact jsonb := '{"name":"Fixture Contact","role":"LOGISTICS_PIC","phone":"08123456789","email":"fixture@example.test","is_primary":true,"source_url":""}';
  result jsonb;
  company uuid;
begin
  begin
    perform public.import_company_row(gen_random_uuid(), details, 'NEW',
      jsonb_build_array(first_contact, first_contact || '{"name":"Invalid Contact","phone":"08111111111","email":"invalid"}'));
    raise exception 'Invalid contact passed validation';
  exception when check_violation then null;
  end;
  if exists (select from public.companies) or exists (select from public.company_contacts) then raise exception 'A failed row left records behind'; end if;

  result := public.import_company_row('d1ad8366-e510-4dc7-b627-7d8821544bef', details, 'QUALIFIED', jsonb_build_array(first_contact));
  company := (result->>'companyId')::uuid;
  if company is null or (result->>'newContacts')::integer <> 1
    or public.import_company_row('d1ad8366-e510-4dc7-b627-7d8821544bef', details, 'QUALIFIED', jsonb_build_array(first_contact)) is distinct from result then
    raise exception 'Successful import results were lost or retried';
  end if;
  perform set_config('test.company_import_a', company::text, true);

  begin
    perform public.import_company_row(gen_random_uuid(), details, 'NEW', '[]');
    raise exception using errcode = 'XX000', message = 'Duplicate import bypassed confirmation';
  exception when raise_exception then null;
  end;

  result := public.import_company_row(gen_random_uuid(), details || '{"notes":"Unwanted overwrite"}', 'CLOSED',
    jsonb_build_array(first_contact || '{"email":"changed@example.test"}',
      first_contact || '{"name":"Second Person","phone":"08111111111","email":"second@example.test"}'), company);
  if (result->>'newContacts')::integer <> 1 or (result->>'skippedContacts')::integer <> 1
    or not exists (select from public.companies where id = company and notes = 'Original note' and source_type = 'IMPORT')
    or not exists (select from public.sales_leads where company_id = company and status = 'QUALIFIED')
    or not exists (select from public.company_contacts where company_id = company and is_primary and email = 'fixture@example.test')
    or (select count(*) from public.company_contacts where company_id = company) <> 2 then
    raise exception 'Attaching contacts overwrote data or preferred contacts';
  end if;

  begin
    delete from public.spreadsheet_import_receipts;
    raise exception 'Import receipts could be deleted by a client';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub','40ba3b39-32d3-45e9-872c-80a2f86282a2',true);
select set_config('request.jwt.claims','{"sub":"40ba3b39-32d3-45e9-872c-80a2f86282a2","role":"authenticated"}',true);
do $$
declare
  details jsonb := current_setting('test.import_details')::jsonb;
  company_a uuid := current_setting('test.company_import_a')::uuid;
  result jsonb;
begin
  begin
    perform public.import_company_row(gen_random_uuid(), details, 'NEW',
      '[{"name":"Unauthorized","role":"OTHER","phone":"","email":"","is_primary":false,"source_url":""}]', company_a);
    raise exception using errcode = 'XX000', message = 'A different user could add contacts to the company';
  exception when raise_exception then null;
  end;
  result := public.import_company_row('d1ad8366-e510-4dc7-b627-7d8821544bef', details, 'NEW', '[]');
  if (result->>'companyId')::uuid is not distinct from company_a then raise exception 'Import receipt was shared between accounts'; end if;
end;
$$;

reset role;
set local role anon;
do $$
begin
  if has_function_privilege('public.import_company_row(uuid,jsonb,text,jsonb,uuid,boolean)', 'EXECUTE')
    or has_table_privilege('public.spreadsheet_import_receipts', 'SELECT') then
    raise exception 'Anonymous spreadsheet access is enabled';
  end if;
end;
$$;
rollback;
