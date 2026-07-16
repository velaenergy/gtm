update public.email_templates
set body = replace(
  replace(
    body,
    $old$We're still exploring the space, so I’m hoping to learn how this process works from your side.
Would you be open to a 20-minute conversation?$old$,
    $new$We're still exploring the space, and I'd really appreciate it if we could meet for 20-30 minutes so I can learn how this process works from your side.$new$
  ),
  'Grab any time here: cal.com/team/velaenergy',
  'If you''re open to it, here''s my calendar: cal.com/team/velaenergy'
), updated_at = now()
where id in ('tony', 'tarun')
  and is_default = true;
