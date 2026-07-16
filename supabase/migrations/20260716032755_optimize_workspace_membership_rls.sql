create index if not exists team_profiles_removed_by_idx
  on public.team_profiles (removed_by)
  where removed_by is not null;

drop policy if exists "Active members can read active profiles" on public.team_profiles;
drop policy if exists "Admins can read all workspace profiles" on public.team_profiles;

create policy "Members can read workspace profiles"
  on public.team_profiles for select to authenticated
  using (
    (select private.is_vela_admin())
    or ((select private.is_vela_member()) and is_active)
  );
