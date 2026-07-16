-- Canonical Gmail archive for Vela GTM conversations. This table deliberately
-- contains only messages classified as Vela outreach or messages in a thread
-- rooted in classified Vela outreach; unrelated inbox mail is never uploaded.
create table public.gtm_email_messages (
  id uuid primary key default gen_random_uuid(),
  gmail_account_id text not null references public.gmail_accounts(id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text not null,
  gmail_history_id text not null default '',
  rfc_message_id text not null default '',
  in_reply_to text not null default '',
  direction text not null check (direction in ('outgoing', 'incoming', 'system')),
  message_kind text not null check (message_kind in ('initial', 'follow_up', 'reply', 'bounce')),
  template_id text not null default '',
  classification_source text not null check (classification_source in ('vela_header', 'delivery_ledger', 'template_fingerprint', 'thread_reply', 'bounce_notice')),
  sender_email extensions.citext not null,
  recipient_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text not null default '',
  body_text text not null default '',
  snippet text not null default '',
  bounce_type text not null default '' check (bounce_type in ('', 'hard', 'soft')),
  bounce_reason text not null default '',
  occurred_at timestamptz not null,
  captured_by uuid not null references public.team_profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gmail_account_id, gmail_message_id)
);

create index gtm_email_messages_thread_idx
  on public.gtm_email_messages (gmail_account_id, gmail_thread_id, occurred_at);
create index gtm_email_messages_kind_time_idx
  on public.gtm_email_messages (message_kind, occurred_at desc);
create index gtm_email_messages_template_time_idx
  on public.gtm_email_messages (template_id, occurred_at desc)
  where template_id <> '';
create index gtm_email_messages_sender_time_idx
  on public.gtm_email_messages (sender_email, occurred_at desc);

create table public.gtm_mailbox_sync_state (
  gmail_account_id text primary key references public.gmail_accounts(id) on delete cascade,
  last_history_id text not null default '',
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  sync_status text not null default 'idle' check (sync_status in ('idle', 'syncing', 'complete', 'error')),
  messages_scanned integer not null default 0 check (messages_scanned >= 0),
  gtm_messages_found integer not null default 0 check (gtm_messages_found >= 0),
  replies_found integer not null default 0 check (replies_found >= 0),
  bounces_found integer not null default 0 check (bounces_found >= 0),
  last_error text not null default '',
  updated_by uuid not null references public.team_profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.gtm_email_messages enable row level security;
alter table public.gtm_mailbox_sync_state enable row level security;

create policy "Active members can read GTM email messages"
  on public.gtm_email_messages for select to authenticated
  using ((select private.is_vela_member()));
create policy "Active members can capture GTM email messages"
  on public.gtm_email_messages for insert to authenticated
  with check ((select private.is_vela_member()) and captured_by = (select auth.uid()));
create policy "Active members can refresh GTM email messages"
  on public.gtm_email_messages for update to authenticated
  using ((select private.is_vela_member()))
  with check ((select private.is_vela_member()) and captured_by = (select auth.uid()));

create policy "Active members can read Gmail sync state"
  on public.gtm_mailbox_sync_state for select to authenticated
  using ((select private.is_vela_member()));
create policy "Active members can start Gmail syncs"
  on public.gtm_mailbox_sync_state for insert to authenticated
  with check ((select private.is_vela_member()) and updated_by = (select auth.uid()));
create policy "Active members can update Gmail syncs"
  on public.gtm_mailbox_sync_state for update to authenticated
  using ((select private.is_vela_member()))
  with check ((select private.is_vela_member()) and updated_by = (select auth.uid()));

revoke all on public.gtm_email_messages from public, anon;
revoke all on public.gtm_mailbox_sync_state from public, anon;
grant select, insert, update on public.gtm_email_messages to authenticated;
grant select, insert, update on public.gtm_mailbox_sync_state to authenticated;
;
