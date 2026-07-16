alter table public.research_runs
  alter column requested_count set default 300;

alter table public.research_runs
  drop constraint if exists research_runs_requested_count_check;

alter table public.research_runs
  add constraint research_runs_requested_count_check
  check (requested_count between 1 and 300);
