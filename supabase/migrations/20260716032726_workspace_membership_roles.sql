alter table public.team_profiles
  add column if not exists role text not null default 'member',
  add column if not exists is_active boolean not null default true,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'team_profiles_role_check'
      and conrelid = 'public.team_profiles'::regclass
  ) then
    alter table public.team_profiles
      add constraint team_profiles_role_check check (role in ('admin', 'member'));
  end if;
end
$$;

update public.team_profiles
set role = 'admin'
where id = (
  select id
  from public.team_profiles
  order by created_at asc, id asc
  limit 1
);

create index if not exists team_profiles_active_role_idx
  on public.team_profiles (is_active, role);

create unique index if not exists team_profiles_one_active_admin_idx
  on public.team_profiles ((1))
  where role = 'admin' and is_active;

create or replace function private.is_vela_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_profiles
    where id = (select auth.uid())
      and is_active
      and lower(email::text) ~ '@velaenergy\.ai$'
  );
$$;

create or replace function private.is_vela_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_profiles
    where id = (select auth.uid())
      and is_active
      and role = 'admin'
      and lower(email::text) ~ '@velaenergy\.ai$'
  );
$$;

revoke all on function private.is_vela_member() from public, anon;
revoke all on function private.is_vela_admin() from public, anon;
grant execute on function private.is_vela_member() to authenticated;
grant execute on function private.is_vela_admin() to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_role text;
begin
  if lower(coalesce(new.email, '')) !~ '@velaenergy\.ai$' then
    raise exception 'Vela GTM access requires a @velaenergy.ai account';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vela-gtm-first-admin', 0));

  select case
    when exists (
      select 1 from public.team_profiles
      where role = 'admin' and is_active
    ) then 'member'
    else 'admin'
  end into assigned_role;

  insert into public.team_profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''),
    assigned_role
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();

  return new;
end;
$$;

drop policy if exists "Vela team can read profiles" on public.team_profiles;
drop policy if exists "Members can update their profile" on public.team_profiles;

create policy "Active members can read active profiles"
  on public.team_profiles for select to authenticated
  using ((select private.is_vela_member()) and is_active);

create policy "Admins can read all workspace profiles"
  on public.team_profiles for select to authenticated
  using ((select private.is_vela_admin()));

create policy "Members can update their own profile"
  on public.team_profiles for update to authenticated
  using ((select private.is_vela_member()) and id = (select auth.uid()))
  with check ((select private.is_vela_member()) and id = (select auth.uid()) and is_active);

revoke update on public.team_profiles from authenticated;
grant update (full_name, avatar_url, updated_at) on public.team_profiles to authenticated;

create or replace function private.set_team_member_active(target_user_id uuid, target_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_role text;
  result jsonb;
begin
  if actor_id is null or not private.is_vela_admin() then
    raise exception 'Only a workspace admin can change member access' using errcode = '42501';
  end if;

  select role into target_role
  from public.team_profiles
  where id = target_user_id;

  if target_role is null then
    raise exception 'Workspace member not found' using errcode = 'P0002';
  end if;
  if target_user_id = actor_id or target_role = 'admin' then
    raise exception 'The workspace admin cannot be removed' using errcode = '42501';
  end if;

  update public.team_profiles
  set
    is_active = target_active,
    removed_at = case when target_active then null else now() end,
    removed_by = case when target_active then null else actor_id end,
    updated_at = now()
  where id = target_user_id
  returning jsonb_build_object(
    'id', id,
    'email', email,
    'full_name', full_name,
    'role', role,
    'is_active', is_active,
    'created_at', created_at,
    'removed_at', removed_at
  ) into result;

  return result;
end;
$$;

revoke all on function private.set_team_member_active(uuid, boolean) from public, anon;
grant execute on function private.set_team_member_active(uuid, boolean) to authenticated;

create or replace function public.set_team_member_active(target_user_id uuid, target_active boolean)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.set_team_member_active($1, $2);
$$;

revoke all on function public.set_team_member_active(uuid, boolean) from public, anon;
grant execute on function public.set_team_member_active(uuid, boolean) to authenticated;
