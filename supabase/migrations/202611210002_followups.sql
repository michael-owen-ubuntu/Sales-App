alter table public.sales_leads add unique (user_id, company_id, id);
alter table public.company_contacts add unique (user_id, company_id, id);

create table public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null,
  lead_id uuid,
  title text not null check (length(btrim(title)) between 1 and 200),
  notes text not null default '' check (length(notes) <= 5000),
  due_at timestamptz not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'DONE', 'CANCELLED')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, company_id) references public.companies(user_id, id) on delete cascade,
  foreign key (user_id, company_id, lead_id) references public.sales_leads(user_id, company_id, id) on delete set null (lead_id),
  check ((status = 'DONE') = (completed_at is not null))
);
create index follow_up_tasks_owner_due on public.follow_up_tasks (user_id, status, due_at);
create index follow_up_tasks_owner_company on public.follow_up_tasks (user_id, company_id);

create table public.sales_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null,
  lead_id uuid,
  contact_id uuid,
  contact_name text not null default '',
  type text not null check (type in ('CALL', 'EMAIL', 'WHATSAPP', 'MEETING', 'VISIT', 'NOTE', 'OTHER')),
  outcome text not null default '' check (length(outcome) <= 500),
  notes text not null default '' check (length(notes) <= 5000),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, company_id) references public.companies(user_id, id) on delete cascade,
  foreign key (user_id, company_id, lead_id) references public.sales_leads(user_id, company_id, id) on delete set null (lead_id),
  foreign key (user_id, company_id, contact_id) references public.company_contacts(user_id, company_id, id) on delete set null (contact_id)
);
create index sales_activities_owner_occurred on public.sales_activities (user_id, occurred_at desc);
create index sales_activities_owner_company on public.sales_activities (user_id, company_id);

create table public.sales_status_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null,
  kind text not null check (kind in ('LEAD', 'TASK')),
  subject text not null,
  old_status text not null,
  new_status text not null,
  occurred_at timestamptz not null default now(),
  foreign key (user_id, company_id) references public.companies(user_id, id) on delete cascade
);
create index sales_status_history_owner_occurred on public.sales_status_history (user_id, occurred_at desc);
create index sales_status_history_owner_company on public.sales_status_history (user_id, company_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['follow_up_tasks', 'sales_activities', 'sales_status_history'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = (select auth.uid()))', table_name);
  end loop;
end;
$$;

grant insert (company_id, lead_id, title, notes, due_at, status), update (title, notes, due_at, status), delete
  on public.follow_up_tasks to authenticated;
grant insert (company_id, lead_id, contact_id, type, outcome, notes, occurred_at)
  on public.sales_activities to authenticated;

create policy owner_insert on public.follow_up_tasks for insert to authenticated with check (user_id = (select auth.uid()));
create policy owner_update on public.follow_up_tasks for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy owner_delete on public.follow_up_tasks for delete to authenticated using (user_id = (select auth.uid()));
create policy owner_insert on public.sales_activities for insert to authenticated with check (user_id = (select auth.uid()));

create function public.require_active_sales_company(owner_id uuid, company_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  perform 1 from public.companies c where c.user_id = owner_id and c.id = company_id and c.archived_at is null for share;
  if not found then raise exception 'Company is unavailable or archived'; end if;
end;
$$;
revoke execute on function public.require_active_sales_company(uuid, uuid) from public, anon;
grant execute on function public.require_active_sales_company(uuid, uuid) to authenticated;

create function public.prepare_follow_up_task() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Cascading company/account deletes must remain possible.
    if pg_trigger_depth() = 1 and current_user = 'authenticated' then
      perform public.require_active_sales_company(old.user_id, old.company_id);
    end if;
    return old;
  end if;
  if pg_trigger_depth() = 1 then
    perform public.require_active_sales_company(new.user_id, new.company_id);
  end if;
  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'DONE' then now() end;
  elsif new.status is distinct from old.status then
    new.completed_at := case when new.status = 'DONE' then now() end;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger prepare_task before insert or update or delete on public.follow_up_tasks
  for each row execute function public.prepare_follow_up_task();

create function public.prepare_sales_activity() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  perform public.require_active_sales_company(new.user_id, new.company_id);
  if new.contact_id is not null then
    select name into new.contact_name from public.company_contacts
    where (user_id, company_id, id) = (new.user_id, new.company_id, new.contact_id);
    if not found then
      raise foreign_key_violation using message = 'Contact does not belong to this company';
    end if;
  end if;
  return new;
end;
$$;
create trigger prepare_activity before insert on public.sales_activities
  for each row execute function public.prepare_sales_activity();

-- History is written by triggers and readable only by each row's owner.
create function public.record_sales_status_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'sales_leads' then
    insert into public.sales_status_history (user_id, company_id, kind, subject, old_status, new_status)
      values (new.user_id, new.company_id, 'LEAD', '', old.status, new.status);
  else
    insert into public.sales_status_history (user_id, company_id, kind, subject, old_status, new_status)
      values (new.user_id, new.company_id, 'TASK', new.title, old.status, new.status);
  end if;
  return new;
end;
$$;
revoke execute on function public.record_sales_status_change() from public, anon, authenticated;
create trigger record_lead_status after update on public.sales_leads
  for each row when (old.status is distinct from new.status) execute function public.record_sales_status_change();
create trigger record_task_status after update on public.follow_up_tasks
  for each row when (old.status is distinct from new.status) execute function public.record_sales_status_change();
