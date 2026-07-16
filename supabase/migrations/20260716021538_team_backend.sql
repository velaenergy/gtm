create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_vela_member()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) ~ '@(vela\.energy|velaenergy\.ai)$';
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_vela_member() to authenticated;

create table public.team_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null unique,
  full_name text not null default '',
  avatar_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_profiles_vela_email check (lower(email::text) ~ '@(vela\.energy|velaenergy\.ai)$')
);

create table public.gmail_accounts (
  id text primary key,
  email extensions.citext not null unique,
  display_name text not null default '',
  added_by uuid not null references auth.users(id),
  added_at timestamptz not null default now(),
  last_connected_at timestamptz not null default now(),
  is_active boolean not null default true,
  constraint gmail_accounts_valid_email check (position('@' in email::text) > 1)
);

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique,
  email extensions.citext,
  linkedin_url text not null default '',
  name text not null default '',
  company text not null default '',
  role text not null default '',
  status text not null default 'new',
  source text not null default '',
  payload jsonb not null default '{}'::jsonb,
  imported_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id text not null unique,
  event_type text not null,
  recipient_email extensions.citext,
  sender_account_id text references public.gmail_accounts(id),
  subject text not null default '',
  status text not null default '',
  delivery_mode text not null default '',
  prospect_identity text not null default '',
  actor_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index activity_events_recipient_status_idx
  on public.activity_events (recipient_email, status, occurred_at desc);
create index activity_events_occurred_at_idx
  on public.activity_events (occurred_at desc);
create index prospects_updated_at_idx on public.prospects (updated_at desc);

alter table public.team_profiles enable row level security;
alter table public.gmail_accounts enable row level security;
alter table public.prospects enable row level security;
alter table public.activity_events enable row level security;

create policy "Vela team can read profiles"
  on public.team_profiles for select to authenticated
  using ((select private.is_vela_member()));
create policy "Members can update their profile"
  on public.team_profiles for update to authenticated
  using ((select auth.uid()) = id and (select private.is_vela_member()))
  with check ((select auth.uid()) = id and (select private.is_vela_member()));

create policy "Vela team can read Gmail metadata"
  on public.gmail_accounts for select to authenticated
  using ((select private.is_vela_member()));
create policy "Vela team can add Gmail metadata"
  on public.gmail_accounts for insert to authenticated
  with check ((select private.is_vela_member()) and added_by = (select auth.uid()));
create policy "Vela team can refresh Gmail metadata"
  on public.gmail_accounts for update to authenticated
  using ((select private.is_vela_member()))
  with check ((select private.is_vela_member()));

create policy "Vela team can read prospects"
  on public.prospects for select to authenticated
  using ((select private.is_vela_member()));
create policy "Vela team can import prospects"
  on public.prospects for insert to authenticated
  with check ((select private.is_vela_member()) and imported_by = (select auth.uid()));
create policy "Vela team can update prospects"
  on public.prospects for update to authenticated
  using ((select private.is_vela_member()))
  with check ((select private.is_vela_member()));

create policy "Vela team can read activity"
  on public.activity_events for select to authenticated
  using ((select private.is_vela_member()));
create policy "Vela team can record activity"
  on public.activity_events for insert to authenticated
  with check ((select private.is_vela_member()) and actor_id = (select auth.uid()));
create policy "Vela team can update activity"
  on public.activity_events for update to authenticated
  using ((select private.is_vela_member()))
  with check ((select private.is_vela_member()));

grant select, update on public.team_profiles to authenticated;
grant select, insert, update on public.gmail_accounts to authenticated;
grant select, insert, update on public.prospects to authenticated;
grant select, insert, update on public.activity_events to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.email, '')) !~ '@(vela\.energy|velaenergy\.ai)$' then
    raise exception 'Vela GTM access requires a Vela Energy account';
  end if;

  insert into public.team_profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', '')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute procedure private.handle_new_user();;
