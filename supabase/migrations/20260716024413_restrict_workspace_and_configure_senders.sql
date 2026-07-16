create or replace function private.is_vela_member()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) ~ '@velaenergy\.ai$';
$$;

alter table public.team_profiles drop constraint if exists team_profiles_vela_email;
alter table public.team_profiles add constraint team_profiles_vela_email
  check (lower(email::text) ~ '@velaenergy\.ai$');

create table public.approved_senders (
  email extensions.citext primary key,
  display_name text not null default '',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approved_senders_vela_email check (lower(email::text) ~ '@velaenergy\.ai$')
);

alter table public.approved_senders enable row level security;

create policy "Vela team can read approved senders"
  on public.approved_senders for select to authenticated
  using ((select private.is_vela_member()));
create policy "Vela team can add approved senders"
  on public.approved_senders for insert to authenticated
  with check ((select private.is_vela_member()) and created_by = (select auth.uid()));
create policy "Vela team can update approved senders"
  on public.approved_senders for update to authenticated
  using ((select private.is_vela_member()))
  with check ((select private.is_vela_member()));
create policy "Vela team can remove approved senders"
  on public.approved_senders for delete to authenticated
  using ((select private.is_vela_member()));

grant select, insert, update, delete on public.approved_senders to authenticated;

drop policy if exists "Vela team can add Gmail metadata" on public.gmail_accounts;
create policy "Vela team can add approved Gmail metadata"
  on public.gmail_accounts for insert to authenticated
  with check (
    (select private.is_vela_member())
    and added_by = (select auth.uid())
    and exists (
      select 1 from public.approved_senders
      where approved_senders.email = gmail_accounts.email
        and approved_senders.is_active
    )
  );

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.email, '')) !~ '@velaenergy\.ai$' then
    raise exception 'Vela GTM access requires a @velaenergy.ai account';
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
