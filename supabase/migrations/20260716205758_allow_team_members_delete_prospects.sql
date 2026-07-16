grant delete on public.prospects to authenticated;

drop policy if exists "Vela team can delete prospects" on public.prospects;
create policy "Vela team can delete prospects"
  on public.prospects for delete to authenticated
  using ((select private.is_vela_member()));
