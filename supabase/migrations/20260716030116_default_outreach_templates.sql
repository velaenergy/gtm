create table public.follow_up_templates (
  id text primary key,
  name text not null,
  body text not null,
  writer_mode text not null default 'gaps' check (writer_mode in ('gaps', 'full')),
  is_default boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.email_templates (
  id text primary key,
  name text not null,
  subject text not null,
  body text not null,
  sender_name text not null default '',
  writer_mode text not null default 'gaps' check (writer_mode in ('gaps', 'full')),
  follow_up_cadence_days smallint not null default 3 check (follow_up_cadence_days between 1 and 30),
  follow_up_template_ids text[] not null default '{}',
  is_default boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.follow_up_templates enable row level security;
alter table public.email_templates enable row level security;

create policy "Vela team can read follow-up templates" on public.follow_up_templates
  for select to authenticated
  using ((select private.is_vela_member()));
create policy "Vela team can add follow-up templates" on public.follow_up_templates
  for insert to authenticated
  with check ((select private.is_vela_member()));
create policy "Vela team can update follow-up templates" on public.follow_up_templates
  for update to authenticated
  using ((select private.is_vela_member()))
  with check ((select private.is_vela_member()));
create policy "Vela team can remove follow-up templates" on public.follow_up_templates
  for delete to authenticated
  using ((select private.is_vela_member()));

create policy "Vela team can read email templates" on public.email_templates
  for select to authenticated
  using ((select private.is_vela_member()));
create policy "Vela team can add email templates" on public.email_templates
  for insert to authenticated
  with check ((select private.is_vela_member()));
create policy "Vela team can update email templates" on public.email_templates
  for update to authenticated
  using ((select private.is_vela_member()))
  with check ((select private.is_vela_member()));
create policy "Vela team can remove email templates" on public.email_templates
  for delete to authenticated
  using ((select private.is_vela_member()));

revoke all on public.follow_up_templates from public, anon;
revoke all on public.email_templates from public, anon;
grant select, insert, update, delete on public.follow_up_templates to authenticated;
grant select, insert, update, delete on public.email_templates to authenticated;

insert into public.follow_up_templates (id, name, body, writer_mode, is_default) values
  ('tony-follow-up-1', 'Tony follow up #1', $copy$Hi {{firstName}}, I wanted to follow up on my previous message and ask if you'd be willing to have a 20-30 minute conversation with us?

We're just starting out, and any input you'd be able to provide would be extremely helpful. Set a time on cal.com/team/velaenergy for whenever you're available.

Thanks, and best regards,
Tony$copy$, 'gaps', true),
  ('tony-follow-up-2', 'Tony follow up #2', $copy$Hi {{firstName}}, just wanted to push this to the top of your inbox one last time, and express my interest in hearing your opinions about the field. Grab a time at cal.com/velaenergy for whenever you're available.

Best,
Tony$copy$, 'gaps', true),
  ('tony-follow-up-3', 'Tony follow up #3', $copy$Hi again,

This is my third follow up so far, so if it isn't obvious yet: we would really value an opportunity to speak with you about the field. Grab a time at cal.com/velaenergy for whenever you're available, and we'd really appreciate it.

Regardless, this will be my last email to you, and thank you for your time in reading this.

Best,
Tony$copy$, 'gaps', true),
  ('tarun-follow-up-1', 'Tarun follow up #1', $copy$Hi {{firstName}}, I wanted to follow up on my previous message and ask if you'd be willing to have a 20-30 minute conversation with us?

We're just starting out, and any input you'd be able to provide would be extremely helpful. Set a time on cal.com/team/velaenergy for whenever you're available.

Thanks, and best regards,
Tarun$copy$, 'gaps', true),
  ('tarun-follow-up-2', 'Tarun follow up #2', $copy$Hi {{firstName}}, just wanted to push this to the top of your inbox one last time, and express my interest in hearing your opinions about the field. Grab a time at cal.com/velaenergy for whenever you're available.

Best,
Tarun$copy$, 'gaps', true),
  ('tarun-follow-up-3', 'Tarun follow up #3', $copy$Hi again,

This is my third follow up so far, so if it isn't obvious yet: we would really value an opportunity to speak with you about the field. Grab a time at cal.com/velaenergy for whenever you're available, and we'd really appreciate it.

Regardless, this will be my last email to you, and thank you for your time in reading this.

Best,
Tarun$copy$, 'gaps', true)
on conflict (id) do update set name = excluded.name, body = excluded.body, writer_mode = excluded.writer_mode, is_default = excluded.is_default, updated_at = now();

insert into public.email_templates (id, name, subject, body, sender_name, writer_mode, follow_up_cadence_days, follow_up_template_ids, is_default) values
  ('tony', 'Tony', 'Seeking advice + your work at {{company}}', $copy$Hi {{firstName}},

{{aiPersonalizedThing}}

I'm Tony. My co-founder, Tarun Batchu, and I recently raised a $1.3M pre-seed round from a16z (the world's largest venture capital firm) for our startup, Vela Energy, after I left Tesla to build the company full-time.

We're still exploring the space, and I'd really appreciate it if we could meet for 20-30 minutes so I can learn how this process works from your side.

If you're open to it, here's my calendar: cal.com/team/velaenergy

Best,
Tony$copy$, 'Tony', 'gaps', 3, array['tony-follow-up-1','tony-follow-up-2','tony-follow-up-3'], true),
  ('tarun', 'Tarun', 'Seeking advice + your work at {{company}}', $copy$Hi {{firstName}},

{{aiPersonalizedThing}}

I'm Tarun. My co-founder, Tony, and I recently raised a $1.3M pre-seed round from a16z (the world's largest venture capital firm) for our startup, Vela Energy.

We're still exploring the space, and I'd really appreciate it if we could meet for 20-30 minutes so I can learn how this process works from your side.

If you're open to it, here's my calendar: cal.com/team/velaenergy

Best,
Tarun$copy$, 'Tarun', 'gaps', 4, array['tarun-follow-up-1','tarun-follow-up-2','tarun-follow-up-3'], true)
on conflict (id) do update set name = excluded.name, subject = excluded.subject, body = excluded.body, sender_name = excluded.sender_name, writer_mode = excluded.writer_mode, follow_up_cadence_days = excluded.follow_up_cadence_days, follow_up_template_ids = excluded.follow_up_template_ids, is_default = excluded.is_default, updated_at = now();
