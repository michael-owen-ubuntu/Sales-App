-- Run as postgres on a disposable Supabase database after applying both migrations.
begin;
insert into auth.users (id, email) values
  ('43eb6820-f8b9-4f38-8277-9d853feaf2a1', 'tasks-a@example.test'),
  ('43eb6820-f8b9-4f38-8277-9d853feaf2a2', 'tasks-b@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '43eb6820-f8b9-4f38-8277-9d853feaf2a1', true);
select set_config('request.jwt.claims', '{"sub":"43eb6820-f8b9-4f38-8277-9d853feaf2a1","role":"authenticated"}', true);

with row as (
  insert into public.companies (name, normalized_name) values ('Fixture A', 'fixture a') returning id
) select set_config('test.company_a', id::text, true) from row;
insert into public.companies (name, normalized_name) values ('Fixture A second', 'fixture a second');

insert into public.sales_leads (company_id) values (current_setting('test.company_a')::uuid);
update public.sales_leads set status = 'CONTACTED' where company_id = current_setting('test.company_a')::uuid;

with row as (
  insert into public.company_contacts (company_id, name, role)
  values (current_setting('test.company_a')::uuid, 'Fixture Contact', 'LOGISTICS_PIC')
  returning id
) select set_config('test.contact_a', id::text, true) from row;

insert into public.sales_activities (company_id, contact_id, type, outcome, occurred_at)
values (current_setting('test.company_a')::uuid, current_setting('test.contact_a')::uuid, 'CALL', 'Fixture called', now());

with row as (
  insert into public.follow_up_tasks (company_id, title, notes, due_at)
  values (current_setting('test.company_a')::uuid, 'Fixture task', 'Fixture note', now() + interval '1 day')
  returning id
) select set_config('test.task_a', id::text, true) from row;

do $$
declare
  task_id uuid := current_setting('test.task_a')::uuid;
  company_a uuid := current_setting('test.company_a')::uuid;
begin
  update public.follow_up_tasks set status = 'DONE' where id = task_id;
  if not exists (select from public.follow_up_tasks where id = task_id and completed_at is not null) then
    raise exception 'Completing a task failed to set its timestamp';
  end if;
  update public.follow_up_tasks set status = 'OPEN' where id = task_id;
  update public.follow_up_tasks set due_at = due_at + interval '1 day' where id = task_id;
  if not exists (select from public.follow_up_tasks where id = task_id and completed_at is null and due_at > now() + interval '1 day') then
    raise exception 'Reopening or rescheduling failed';
  end if;
  if (select count(*) from public.sales_status_history where company_id = company_a) <> 3 then
    raise exception 'Lead/task status history was not recorded exactly once per status change';
  end if;
  begin
    insert into public.sales_activities (company_id, contact_id, type, occurred_at)
    select id, current_setting('test.contact_a')::uuid, 'CALL', now()
    from public.companies where id <> company_a;
    raise exception 'Same-owner cross-company activity contact allowed';
  exception when foreign_key_violation then null;
  end;
  begin
    delete from public.sales_status_history where company_id = company_a;
    raise exception 'Status history deletion allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.sales_activities set outcome = 'Unauthorized' where company_id = company_a;
    raise exception 'Logged activity editing allowed';
  exception when insufficient_privilege then null;
  end;
  delete from public.company_contacts where id = current_setting('test.contact_a')::uuid;
  if not exists (select from public.sales_activities where company_id = company_a and contact_id is null and contact_name = 'Fixture Contact') then
    raise exception 'Deleting a contact did not retain the activity and its contact name';
  end if;
  update public.companies set archived_at = now() where id = company_a;
  begin
    update public.follow_up_tasks set status = 'DONE' where id = task_id;
    raise exception using errcode = 'XX000', message = 'Archived company task change allowed';
  exception when raise_exception then null;
  end;
  update public.companies set archived_at = null where id = company_a;
end;
$$;

select set_config('request.jwt.claim.sub', '43eb6820-f8b9-4f38-8277-9d853feaf2a2', true);
select set_config('request.jwt.claims', '{"sub":"43eb6820-f8b9-4f38-8277-9d853feaf2a2","role":"authenticated"}', true);
do $$
begin
  if exists (select from public.follow_up_tasks)
    or exists (select from public.sales_activities)
    or exists (select from public.sales_status_history) then
    raise exception 'User B can read User A sales data';
  end if;
  update public.follow_up_tasks set status = 'CANCELLED' where id = current_setting('test.task_a')::uuid;
  if found then raise exception 'User B can update User A task'; end if;
  delete from public.follow_up_tasks where id = current_setting('test.task_a')::uuid;
  if found then raise exception 'User B can delete User A task'; end if;
  begin
    insert into public.follow_up_tasks (company_id, title, due_at)
    values (current_setting('test.company_a')::uuid, 'Unauthorized', now());
    raise exception using errcode = 'XX000', message = 'User B can add tasks to User A company';
  exception when raise_exception then null;
  end;
  begin
    insert into public.sales_activities (company_id, type, occurred_at)
    values (current_setting('test.company_a')::uuid, 'CALL', now());
    raise exception using errcode = 'XX000', message = 'User B can log activity for User A company';
  exception when raise_exception then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '43eb6820-f8b9-4f38-8277-9d853feaf2a1', true);
select set_config('request.jwt.claims', '{"sub":"43eb6820-f8b9-4f38-8277-9d853feaf2a1","role":"authenticated"}', true);
delete from public.follow_up_tasks where id = current_setting('test.task_a')::uuid;
do $$
begin
  if exists (select from public.follow_up_tasks where id = current_setting('test.task_a')::uuid)
    or (select count(*) from public.sales_status_history) <> 3 then
    raise exception 'Task deletion did not retain status history';
  end if;
end;
$$;

reset role;
set local role anon;
do $$
begin
  if has_table_privilege('public.follow_up_tasks', 'SELECT')
    or has_table_privilege('public.sales_activities', 'SELECT')
    or has_table_privilege('public.sales_status_history', 'SELECT') then
    raise exception 'Anonymous sales data access is enabled';
  end if;
end;
$$;
rollback;
