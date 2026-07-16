alter table public.email_templates
  add column if not exists sender_email extensions.citext;

update public.email_templates set sender_email = 'tony@velaenergy.ai' where id = 'tony' and sender_email is null;
update public.email_templates set sender_email = 'tarun@velaenergy.ai' where id = 'tarun' and sender_email is null;

-- Research conversations, run history, and automation definitions intentionally stay
-- in chrome.storage.local. Only the final curated lists cross the team boundary.
create table public.research_lists (
  id text primary key,
  name text not null,
  description text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.research_list_members (
  list_id text not null references public.research_lists(id) on delete cascade,
  prospect_identity text not null,
  added_by uuid not null references auth.users(id),
  added_at timestamptz not null default now(),
  primary key (list_id, prospect_identity)
);

create index research_lists_updated_at_idx on public.research_lists (updated_at desc);

alter table public.research_lists enable row level security;
alter table public.research_list_members enable row level security;

create policy "Vela team can read research lists" on public.research_lists
  for select to authenticated using ((select private.is_vela_member()));
create policy "Vela team can create research lists" on public.research_lists
  for insert to authenticated with check ((select private.is_vela_member()) and created_by = (select auth.uid()));
create policy "Vela team can update research lists" on public.research_lists
  for update to authenticated using ((select private.is_vela_member())) with check ((select private.is_vela_member()));
create policy "Vela team can delete research lists" on public.research_lists
  for delete to authenticated using ((select private.is_vela_member()));

create policy "Vela team can read research list members" on public.research_list_members
  for select to authenticated using ((select private.is_vela_member()));
create policy "Vela team can add research list members" on public.research_list_members
  for insert to authenticated with check ((select private.is_vela_member()) and added_by = (select auth.uid()));
create policy "Vela team can delete research list members" on public.research_list_members
  for delete to authenticated using ((select private.is_vela_member()));

revoke all on public.research_lists, public.research_list_members from public, anon;
grant select, insert, update, delete on public.research_lists to authenticated;
grant select, insert, delete on public.research_list_members to authenticated;
;
