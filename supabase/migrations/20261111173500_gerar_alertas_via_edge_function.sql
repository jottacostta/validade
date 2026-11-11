-- pg_cron executa SQL sem claims JWT. A geração protegida por service_role
-- é delegada à Edge Function, que usa a chave de serviço somente no servidor.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ declare j record; begin
  for j in
    select jobid from cron.job where jobname = 'gerar-alertas-validade-diario'
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'gerar-alertas-validade-diario',
  '0 9 * * *',
  $job$ select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'alertas_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'alertas_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alertas_anon_key'),
      'x-alertas-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alertas_cron_secret')
    ),
    body := '{"action":"generate-alerts"}'::jsonb,
    timeout_milliseconds := 30000
  ) $job$
);
