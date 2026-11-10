-- Gera os alertas de validade (notificações internas) todos os dias às 06:00 de
-- Brasília (09:00 UTC), direto no banco, sem depender de agendador externo.
-- O envio de push continua sendo feito pela Edge Function `alertas` (ação
-- "dispatch"), que exige ALERTAS_CRON_SECRET e as chaves VAPID configuradas.
create extension if not exists pg_cron;

select cron.schedule(
  'gerar-alertas-validade-diario',
  '0 9 * * *',
  $$select public.gerar_alertas_validade()$$
);
