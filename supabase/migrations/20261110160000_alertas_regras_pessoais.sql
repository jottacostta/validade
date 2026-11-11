-- Regras pessoais controlam exclusivamente o calendário do Push; notificações internas seguem gerar_alertas_validade().
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.alertas_regras (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dias smallint not null check (dias between 1 and 365),
  hora_local time not null,
  fuso text not null default 'America/Sao_Paulo',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,dias,hora_local,fuso)
);
create or replace function private.validar_fuso_alertas_regra()
returns trigger language plpgsql set search_path=''
as $$ begin
 if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name=new.fuso) then raise exception 'Fuso IANA inválido'; end if;
 new.updated_at=now(); return new;
end; $$;
revoke all on function private.validar_fuso_alertas_regra() from public,anon,authenticated;
create trigger alertas_regras_validar_fuso before insert or update on public.alertas_regras for each row execute function private.validar_fuso_alertas_regra();
alter table public.alertas_regras enable row level security;
create policy alertas_regras_own_select on public.alertas_regras for select to authenticated using (user_id=(select auth.uid()));
create policy alertas_regras_own_insert on public.alertas_regras for insert to authenticated with check (user_id=(select auth.uid()));
create policy alertas_regras_own_update on public.alertas_regras for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy alertas_regras_own_delete on public.alertas_regras for delete to authenticated using (user_id=(select auth.uid()));
revoke all on public.alertas_regras from public,anon,authenticated;
grant select,insert,update,delete on public.alertas_regras to authenticated;
create table public.alertas_push_outbox (
 id uuid primary key default gen_random_uuid(), regra_id uuid not null references public.alertas_regras(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, loja_id uuid not null references public.lojas(id) on delete cascade,
 registro_id text not null, fonte text not null check(fonte in ('lote','perecivel')), validade date not null, data_local date not null,
 titulo text not null, mensagem text not null, payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','sent','dead')),
 attempts integer not null default 0, available_at timestamptz not null default now(), lease_until timestamptz,
 last_error text, created_at timestamptz not null default now(), sent_at timestamptz,
 unique(regra_id,user_id,loja_id,registro_id,validade,data_local)
);
create index alertas_push_outbox_claim_idx on public.alertas_push_outbox(status,available_at,lease_until);
alter table public.alertas_push_outbox enable row level security;
revoke all on public.alertas_push_outbox from public,anon,authenticated;
grant select,insert,update,delete on public.alertas_push_outbox to service_role;
create or replace function public.preparar_alertas_push()
returns integer language plpgsql security definer set search_path=''
as $$
declare n integer;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
 update public.alertas_push_outbox o set status='dead',lease_until=null,last_error='Regra desativada ou data local expirada'
 from public.alertas_regras ar where ar.id=o.regra_id
  and (o.status='pending' or (o.status='processing' and o.lease_until<now()))
  and (not ar.ativo or o.data_local<>(now() at time zone ar.fuso)::date);
 update public.alertas_push_outbox set status='dead',lease_until=null,last_error='Limite de tentativas excedido'
  where status='processing' and lease_until<now() and attempts>=8;
 with fontes as (
  select l.id registro_id,l.loja_id,l.val validade,l.ean codigo,coalesce(c.nome,l.ean) nome,l.lote referencia,l.setor,'lote'::text fonte from public.lotes l left join public.catalogo c on c.ean=l.ean where l.deleted_at is null and l.val is not null
  union all
  select r.id,r.loja_id,r.val,r.cod,coalesce(i.descricao,r.cod),r.sif,r.setor,'perecivel' from public.pere_regs r left join public.pere_itens i on i.loja_id=r.loja_id and i.cod=r.cod where r.deleted_at is null and r.val is not null
 ), destinatarios as (
  select lm.user_id,lm.loja_id from public.loja_membros lm
  union select p.id,lo.id from public.perfis p cross join public.lojas lo where p.papel in ('analista','gerente','admin')
 ), candidatas as (
  select ar.id regra_id, ar.user_id, f.loja_id,f.registro_id,f.fonte,f.validade, (now() at time zone ar.fuso)::date data_local,
   case when f.validade < (now() at time zone ar.fuso)::date then 'Produto vencido' else 'Validade próxima' end titulo,
   case when f.validade < (now() at time zone ar.fuso)::date then 'Registro vencido em '||f.validade::text else 'Registro vence em '||f.validade::text end mensagem,
   jsonb_build_object('fonte',f.fonte,'registro_id',f.registro_id,'nome',f.nome,'codigo',f.codigo,'lote_ou_sif',f.referencia,'setor',f.setor,'validade',f.validade,'loja_id',f.loja_id) payload
  from public.alertas_regras ar join fontes f on (f.validade - ar.dias) = (now() at time zone ar.fuso)::date
  join destinatarios d on d.user_id=ar.user_id and d.loja_id=f.loja_id
  where ar.ativo and (now() at time zone ar.fuso)::time >= ar.hora_local
 )
 insert into public.alertas_push_outbox(regra_id,user_id,loja_id,registro_id,fonte,validade,data_local,titulo,mensagem,payload)
 select regra_id,user_id,loja_id,registro_id,fonte,validade,data_local,titulo,mensagem,payload from candidatas
 on conflict(regra_id,user_id,loja_id,registro_id,validade,data_local) do nothing;
 get diagnostics n = row_count; return n;
end; $$;
create or replace function public.reivindicar_alertas_push(p_limite integer default 100)
returns setof public.alertas_push_outbox language plpgsql security definer set search_path=''
as $$ begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
 return query with picked as (select o.id from public.alertas_push_outbox o where ((o.status='pending' and o.available_at<=now()) or (o.status='processing' and o.lease_until<now() and o.attempts<8)) and exists(select 1 from public.alertas_regras ar where ar.id=o.regra_id and ar.ativo and o.data_local=(now() at time zone ar.fuso)::date) order by o.available_at for update skip locked limit least(greatest(p_limite,1),500))
 update public.alertas_push_outbox o set status='processing',attempts=o.attempts+1,lease_until=now()+interval '5 minutes' from picked where o.id=picked.id returning o.*;
end; $$;
create or replace function public.registrar_resultado_alerta_push(p_id uuid,p_ok boolean,p_erro text default null)
returns void language plpgsql security definer set search_path=''
as $$ begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
 update public.alertas_push_outbox set status=case when p_ok then 'sent' when attempts>=8 then 'dead' else 'pending' end,sent_at=case when p_ok then now() else null end,
  lease_until=null,last_error=case when p_ok then null else left(coalesce(p_erro,'falha'),300) end,
  available_at=case when p_ok or attempts>=8 then available_at else now()+make_interval(secs=>least(3600,power(2,least(attempts,11))::integer*15)) end
 where id=p_id and status='processing';
end; $$;
revoke all on function public.preparar_alertas_push() from public,anon,authenticated;
revoke all on function public.reivindicar_alertas_push(integer) from public,anon,authenticated;
revoke all on function public.registrar_resultado_alerta_push(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.preparar_alertas_push() to service_role;
grant execute on function public.reivindicar_alertas_push(integer) to service_role;
grant execute on function public.registrar_resultado_alerta_push(uuid,boolean,text) to service_role;
-- Remover todos os jobs homônimos antigos antes de instalar geração interna e dispatcher separados.
do $$ declare j record; begin for j in select jobid from cron.job where jobname='gerar-alertas-validade-diario' loop perform cron.unschedule(j.jobid); end loop; end $$;
select cron.schedule('gerar-alertas-validade-diario','0 9 * * *',$$select public.gerar_alertas_validade()$$);
do $$ declare j record; begin for j in select jobid from cron.job where jobname='despachar-alertas-push-minutely' loop perform cron.unschedule(j.jobid); end loop; end $$;
select cron.schedule('despachar-alertas-push-minutely','* * * * *',$job$ select net.http_post(
 url := (select decrypted_secret from vault.decrypted_secrets where name='alertas_function_url'),
 headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='alertas_anon_key'),'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='alertas_anon_key'),'x-alertas-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='alertas_cron_secret')),
 body := '{"action":"dispatch"}'::jsonb,timeout_milliseconds:=30000) $job$);
