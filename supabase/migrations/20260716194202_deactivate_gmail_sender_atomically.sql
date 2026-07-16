create or replace function public.deactivate_gmail_sender(
  p_account_id text,
  p_account_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(p_account_email, '')));
  removed_account public.gmail_accounts%rowtype;
begin
  if auth.uid() is null or not private.is_vela_member() then
    raise exception 'Sign in with an active Vela workspace account before removing a Gmail sender' using errcode = '42501';
  end if;
  if trim(coalesce(p_account_id, '')) = '' or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Choose a valid Gmail account to remove' using errcode = '22023';
  end if;

  update public.gmail_accounts
  set is_active = false
  where id = trim(p_account_id)
    and email = normalized_email
  returning * into removed_account;

  if not found then
    raise exception 'That Gmail sender is no longer registered in the Vela workspace' using errcode = 'P0002';
  end if;

  update public.approved_senders
  set is_active = false, updated_at = now()
  where email = normalized_email;

  return jsonb_build_object(
    'id', removed_account.id,
    'email', lower(removed_account.email::text),
    'isActive', false
  );
end;
$$;

revoke all on function public.deactivate_gmail_sender(text, text) from public, anon;
grant execute on function public.deactivate_gmail_sender(text, text) to authenticated;
