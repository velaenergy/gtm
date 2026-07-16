create index if not exists research_lists_created_by_idx
  on public.research_lists (created_by);

create index if not exists research_list_members_added_by_idx
  on public.research_list_members (added_by);

create index if not exists recipient_send_reservations_claimed_by_idx
  on private.recipient_send_reservations (claimed_by);
;
