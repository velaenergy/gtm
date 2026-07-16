-- Research stays local. This private table is the small shared coordination
-- primitive that prevents two teammates from starting the same send together.
create table private.recipient_send_reservations (
  recipient_email extensions.citext primary key,
  claim_id uuid not null,
  claimed_by uuid not null references auth.users(id) on delete cascade,
  sender_email extensions.citext,
  prospect_identity text not null default '',
  state text not null default 'reserved' check (state in ('reserved', 'sent', 'failed')),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz
);

revoke all on table private.recipient_send_reservations from public, anon, authenticated;

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

create or replace function private.complete_recipient_send(
  p_recipient_email text,
  p_claim_id uuid,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(p_recipient_email, '')));
  actor_id uuid := auth.uid();
  updated_count integer := 0;
begin
  if actor_id is null or not private.is_vela_member() then
    raise exception 'An active Vela workspace account is required to finish a recipient reservation' using errcode = '42501';
  end if;
  if p_outcome not in ('sent', 'failed') then
    raise exception 'Recipient reservation outcome must be sent or failed' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vela-recipient-send:' || normalized_email, 0));

  update private.recipient_send_reservations
  set
    state = p_outcome,
    completed_at = now(),
    expires_at = case when p_outcome = 'sent' then now() + interval '10 years' else now() end
  where recipient_email = normalized_email
    and claim_id = p_claim_id
    and claimed_by = actor_id;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function private.claim_recipient_send(text, uuid, text, text, boolean) from public, anon;
revoke all on function private.complete_recipient_send(text, uuid, text) from public, anon;
grant execute on function private.claim_recipient_send(text, uuid, text, text, boolean) to authenticated;
grant execute on function private.complete_recipient_send(text, uuid, text) to authenticated;

create or replace function public.claim_recipient_send(
  p_recipient_email text,
  p_claim_id uuid,
  p_sender_email text default '',
  p_prospect_identity text default '',
  p_force boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.claim_recipient_send($1, $2, $3, $4, $5);
$$;

create or replace function public.complete_recipient_send(
  p_recipient_email text,
  p_claim_id uuid,
  p_outcome text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.complete_recipient_send($1, $2, $3);
$$;

revoke all on function public.claim_recipient_send(text, uuid, text, text, boolean) from public, anon;
revoke all on function public.complete_recipient_send(text, uuid, text) from public, anon;
grant execute on function public.claim_recipient_send(text, uuid, text, text, boolean) to authenticated;
grant execute on function public.complete_recipient_send(text, uuid, text) to authenticated;
;
