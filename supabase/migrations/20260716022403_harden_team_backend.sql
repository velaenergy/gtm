revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create index activity_events_actor_id_idx on public.activity_events (actor_id);
create index activity_events_sender_account_id_idx on public.activity_events (sender_account_id);
create index gmail_accounts_added_by_idx on public.gmail_accounts (added_by);
create index prospects_imported_by_idx on public.prospects (imported_by);;
