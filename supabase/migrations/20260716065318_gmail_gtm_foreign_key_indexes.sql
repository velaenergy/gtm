create index gtm_email_messages_captured_by_idx
  on public.gtm_email_messages (captured_by);

create index gtm_mailbox_sync_state_updated_by_idx
  on public.gtm_mailbox_sync_state (updated_by);
;
