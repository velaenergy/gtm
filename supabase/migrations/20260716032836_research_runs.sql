create table public.research_runs (
  id uuid primary key,
  brief text not null,
  status text not null default 'planning'
    check (status in ('planning', 'searching', 'auditing', 'complete', 'error')),
  requested_count integer not null default 300 check (requested_count between 1 and 300),
  found_count integer not null default 0 check (found_count >= 0),
  audited_count integer not null default 0 check (audited_count >= 0),
  strong_count integer not null default 0 check (strong_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  skip_count integer not null default 0 check (skip_count >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  error text not null default ''
);

create index research_runs_updated_at_idx on public.research_runs (updated_at desc);
create index research_runs_created_by_idx on public.research_runs (created_by);

alter table public.research_runs enable row level security;

create policy "Vela team can read research runs"
  on public.research_runs for select to authenticated
  using ((select private.is_vela_member()));

create policy "Vela team can create research runs"
  on public.research_runs for insert to authenticated
  with check ((select private.is_vela_member()) and created_by = (select auth.uid()));

create policy "Vela team can update research runs"
  on public.research_runs for update to authenticated
  using ((select private.is_vela_member()))
  with check ((select private.is_vela_member()));

grant select, insert, update on public.research_runs to authenticated;
