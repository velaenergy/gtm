-- Every active Vela workspace member may register an @velaenergy.ai mailbox.
-- The sender roster remains the delivery-time authorization gate; keeping that
-- lookup out of the INSERT policy prevents a just-approved sender from being
-- rejected by a second RLS evaluation during the connection upsert.
drop policy if exists "Vela team can add approved Gmail metadata" on public.gmail_accounts;
drop policy if exists "Vela team can add Gmail metadata" on public.gmail_accounts;

create policy "Active members can add Vela Gmail metadata"
  on public.gmail_accounts for insert to authenticated
  with check (
    (select private.is_vela_member())
    and added_by = (select auth.uid())
    and lower(email::text) ~ '@velaenergy\.ai$'
  );

drop policy if exists "Vela team can refresh Gmail metadata" on public.gmail_accounts;
create policy "Active members can refresh Vela Gmail metadata"
  on public.gmail_accounts for update to authenticated
  using ((select private.is_vela_member()))
  with check (
    (select private.is_vela_member())
    and lower(email::text) ~ '@velaenergy\.ai$'
  );

-- Publishable-key requests must authenticate before they can see or mutate
-- sender metadata. RLS still provides row/workspace authorization afterward.
revoke all on public.gmail_accounts from anon;
revoke all on public.approved_senders from anon;

grant select, insert, update on public.gmail_accounts to authenticated;
grant select, insert, update, delete on public.approved_senders to authenticated;
