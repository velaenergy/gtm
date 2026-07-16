alter table public.email_templates
  add column if not exists calendar_url text not null default 'https://cal.com/team/velaenergy';

update public.email_templates
set calendar_url = 'https://cal.com/team/velaenergy'
where calendar_url = '';
