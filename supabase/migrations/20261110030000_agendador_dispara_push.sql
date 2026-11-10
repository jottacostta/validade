-- O agendador diário (06:00 de Brasília = 09:00 UTC) passa a chamar a Edge Function
-- `alertas` (ação "dispatch"), que gera as notificações E envia o push. Antes ele só
-- chamava public.gerar_alertas_validade(), o que criava os avisos sem push.
--
-- Nenhum segredo fica nesta migration. O job lê do Vault, em tempo de execução:
--   alertas_function_url  → endereço da função
--   alertas_anon_key      → chave pública (passa pelo portão verify_jwt)
--   alertas_cron_secret   → mesmo valor do segredo ALERTAS_CRON_SECRET da função
-- Esses três nomes precisam existir no Vault do projeto (criados fora da migration).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'gerar-alertas-validade-diario',
  '0 9 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'alertas_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'alertas_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alertas_anon_key'),
      'x-alertas-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alertas_cron_secret')
    ),
    body := '{"action":"dispatch"}'::jsonb,
    timeout_milliseconds := 30000
  )
  $job$
);
