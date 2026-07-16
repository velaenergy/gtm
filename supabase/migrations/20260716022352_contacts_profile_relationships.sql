alter table public.prospects
  drop constraint if exists prospects_imported_by_fkey,
  add constraint prospects_imported_by_fkey
    foreign key (imported_by) references public.team_profiles(id);

alter table public.activity_events
  drop constraint if exists activity_events_actor_id_fkey,
  add constraint activity_events_actor_id_fkey
    foreign key (actor_id) references public.team_profiles(id);
