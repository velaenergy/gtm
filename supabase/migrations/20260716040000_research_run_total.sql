alter table public.research_runs
  add column if not exists total_found integer not null default 0
  check (total_found >= 0);
