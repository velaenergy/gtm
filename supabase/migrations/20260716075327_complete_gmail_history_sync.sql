-- A complete mailbox baseline is every message in Sent plus every message in
-- those sent threads. Unrelated inbox-only conversations remain outside the
-- shared workspace archive.
alter table public.gtm_email_messages
  drop constraint if exists gtm_email_messages_classification_source_check;

alter table public.gtm_email_messages
  add constraint gtm_email_messages_classification_source_check
  check (classification_source in (
    'vela_header',
    'delivery_ledger',
    'template_fingerprint',
    'sent_mailbox',
    'thread_reply',
    'bounce_notice'
  ));

alter table public.gtm_mailbox_sync_state
  add column if not exists sync_scope text not null default 'gtm_only'
    check (sync_scope in ('gtm_only', 'all_sent_threads')),
  add column if not exists sent_messages_found integer not null default 0
    check (sent_messages_found >= 0),
  add column if not exists threads_found integer not null default 0
    check (threads_found >= 0);

create index if not exists gtm_email_messages_recipient_emails_idx
  on public.gtm_email_messages using gin (recipient_emails);

create index if not exists gtm_email_messages_account_direction_time_idx
  on public.gtm_email_messages (gmail_account_id, direction, occurred_at desc);

-- The atomic reservation boundary must consult Gmail history as well as
-- extension-created activity. That keeps a historical send from being repeated
-- even when a client has not refreshed its local activity list yet.
create or replace function private.claim_recipient_send(
  p_recipient_email text,
  p_claim_id uuid,
  p_sender_email text default '',
  p_prospect_identity text default '',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(p_recipient_email, '')));
  actor_id uuid := auth.uid();
  current_claim private.recipient_send_reservations%rowtype;
  historical_send_at timestamptz;
begin
  if actor_id is null or not private.is_vela_member() then
    raise exception 'An active Vela workspace account is required to reserve a recipient' using errcode = '42501';
  end if;
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid recipient email is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vela-recipient-send:' || normalized_email, 0));

  select * into current_claim
  from private.recipient_send_reservations
  where recipient_email = normalized_email;

  if found and current_claim.claim_id <> p_claim_id then
    if current_claim.state = 'reserved' and current_claim.expires_at > now() then
      return jsonb_build_object(
        'claimed', false,
        'recipient', normalized_email,
        'reason', 'active',
        'claimed_at', current_claim.claimed_at,
        'expires_at', current_claim.expires_at
      );
    end if;
    if current_claim.state = 'sent' and not p_force then
      return jsonb_build_object(
        'claimed', false,
        'recipient', normalized_email,
        'reason', 'sent',
        'claimed_at', current_claim.claimed_at,
        'completed_at', current_claim.completed_at
      );
    end if;
  end if;

  if not p_force then
    select max(message.occurred_at) into historical_send_at
    from public.gtm_email_messages as message
    where message.direction = 'outgoing'
      and message.message_kind in ('initial', 'follow_up')
      and normalized_email = any(message.recipient_emails);

    if historical_send_at is not null then
      return jsonb_build_object(
        'claimed', false,
        'recipient', normalized_email,
        'reason', 'sent',
        'completed_at', historical_send_at,
        'source', 'gmail_history'
      );
    end if;
  end if;

  insert into private.recipient_send_reservations (
    recipient_email, claim_id, claimed_by, sender_email, prospect_identity,
    state, claimed_at, expires_at, completed_at
  ) values (
    normalized_email, p_claim_id, actor_id, nullif(lower(trim(coalesce(p_sender_email, ''))), ''),
    coalesce(p_prospect_identity, ''), 'reserved', now(), now() + interval '3 minutes', null
  )
  on conflict (recipient_email) do update set
    claim_id = excluded.claim_id,
    claimed_by = excluded.claimed_by,
    sender_email = excluded.sender_email,
    prospect_identity = excluded.prospect_identity,
    state = 'reserved',
    claimed_at = now(),
    expires_at = now() + interval '3 minutes',
    completed_at = null;

  return jsonb_build_object(
    'claimed', true,
    'recipient', normalized_email,
    'claim_id', p_claim_id,
    'expires_at', now() + interval '3 minutes'
  );
end;
$$;
