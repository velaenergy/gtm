delete from public.approved_senders
where created_by is null
  and lower(email::text) in ('tony@velaenergy.ai', 'tarun@velaenergy.ai');
