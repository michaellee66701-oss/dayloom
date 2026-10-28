-- Dayloom: run once in your own Supabase project's SQL Editor.
-- Data is private to the authenticated account. Browser clients use only a publishable key.
create table if not exists public.dayloom_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.dayloom_documents enable row level security;
revoke all on public.dayloom_documents from anon, authenticated;
grant select on public.dayloom_documents to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='dayloom_documents' and policyname='dayloom_read_own') then
    create policy dayloom_read_own on public.dayloom_documents for select to authenticated using ((select auth.uid())=user_id);
  end if;
end $$;

create or replace function public.dayloom_save(expected_revision bigint, new_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  current_doc public.dayloom_documents%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if expected_revision is null or expected_revision < 0 then raise exception 'Invalid revision'; end if;
  if new_data is null or jsonb_typeof(new_data) <> 'object'
    or coalesce(new_data->>'version','') <> '1'
    or jsonb_typeof(new_data->'tasks') is distinct from 'array'
    or jsonb_typeof(new_data->'milestones') is distinct from 'array'
    or jsonb_typeof(new_data->'settings') is distinct from 'object'
    or jsonb_typeof(new_data->'exerciseDone') is distinct from 'object'
    or octet_length(new_data::text)>2097152 then raise exception 'Invalid or oversized planner data'; end if;
  select * into current_doc from public.dayloom_documents where user_id=caller for update;
  if not found then
    if expected_revision<>0 then return jsonb_build_object('applied',false,'revision',0,'data',null); end if;
    insert into public.dayloom_documents(user_id,revision,data) values(caller,1,new_data)
      on conflict(user_id) do nothing returning * into current_doc;
    if found then return jsonb_build_object('applied',true,'revision',current_doc.revision,'data',current_doc.data); end if;
    select * into current_doc from public.dayloom_documents where user_id=caller for update;
  end if;
  if current_doc.revision<>expected_revision then
    return jsonb_build_object('applied',false,'revision',current_doc.revision,'data',current_doc.data);
  end if;
  update public.dayloom_documents set data=new_data,revision=revision+1,updated_at=now()
    where user_id=caller returning * into current_doc;
  return jsonb_build_object('applied',true,'revision',current_doc.revision,'data',current_doc.data);
end $$;
revoke all on function public.dayloom_save(bigint,jsonb) from public, anon;
grant execute on function public.dayloom_save(bigint,jsonb) to authenticated;
