create or replace function private.preserve_prospect_import_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  previous_evidence jsonb := old.payload -> 'importEvidence';
  incoming_evidence jsonb := new.payload -> 'importEvidence';
begin
  if previous_evidence is null then
    return new;
  end if;

  new.payload := jsonb_set(
    coalesce(new.payload, '{}'::jsonb),
    '{importEvidence}',
    case
      when jsonb_typeof(previous_evidence) = 'object'
        and jsonb_typeof(incoming_evidence) = 'object'
        then previous_evidence || incoming_evidence
      when incoming_evidence is null then previous_evidence
      else incoming_evidence
    end,
    true
  );
  return new;
end;
$$;

revoke all on function private.preserve_prospect_import_evidence() from public, anon, authenticated;

drop trigger if exists preserve_prospect_import_evidence on public.prospects;
create trigger preserve_prospect_import_evidence
before update of payload on public.prospects
for each row execute function private.preserve_prospect_import_evidence();
