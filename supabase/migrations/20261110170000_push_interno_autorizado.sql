-- Limiar compartilhado e Push interno da loja são controles gerenciais.
-- Regras pessoais de antecedência continuam em alertas_regras.
alter table public.ajustes
  add column if not exists push_interno boolean not null default false,
  add column if not exists push_interno_desde timestamptz;

comment on column public.ajustes.dias is 'Antecedência compartilhada dos alertas internos da loja; alterações restritas a gerente/admin.';
comment on column public.ajustes.push_interno is 'Autoriza Push dos alertas internos para assinantes da loja; controle restrito a gerente/admin.';
comment on column public.ajustes.push_interno_desde is 'Marco de ativação para não enviar Push retroativo de notificações antigas.';

create or replace function private.validar_ajustes_alertas_gerenciais()
returns trigger language plpgsql set search_path=''
as $$
declare v_papel text;
begin
  if coalesce(auth.role(),'')='service_role' then return new; end if;
  v_papel:=private.meu_papel();
  if tg_op='INSERT' then
    if (new.dias is distinct from 30 or coalesce(new.push_interno,false))
       and coalesce(v_papel,'') not in ('admin','gerente') then
      raise exception 'Somente gerente ou administrador pode definir alertas internos da loja';
    end if;
    new.push_interno_desde:=case when coalesce(new.push_interno,false) then now() else null end;
  else
    if (new.dias is distinct from old.dias or coalesce(new.push_interno,false) is distinct from coalesce(old.push_interno,false))
       and coalesce(v_papel,'') not in ('admin','gerente') then
      raise exception 'Somente gerente ou administrador pode definir alertas internos da loja';
    end if;
    if coalesce(new.push_interno,false) is distinct from coalesce(old.push_interno,false) then
      new.push_interno_desde:=case when coalesce(new.push_interno,false) then now() else null end;
    else
      new.push_interno_desde:=old.push_interno_desde;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validar_ajustes_alertas_gerenciais() from public,anon,authenticated;
drop trigger if exists ajustes_alertas_gerenciais on public.ajustes;
create trigger ajustes_alertas_gerenciais before insert or update on public.ajustes
  for each row execute function private.validar_ajustes_alertas_gerenciais();

create table public.alertas_push_internos_outbox (
  id uuid primary key default gen_random_uuid(),
  notificacao_id uuid not null unique references public.notificacoes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  loja_id uuid not null references public.lojas(id) on delete cascade,
  titulo text not null,
  mensagem text not null,
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','processing','sent','dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index alertas_push_internos_claim_idx on public.alertas_push_internos_outbox(status,available_at,lease_until);
create index if not exists notificacoes_store_created_idx on public.notificacoes(loja_id,criado);
alter table public.alertas_push_internos_outbox enable row level security;
revoke all on public.alertas_push_internos_outbox from public,anon,authenticated;
grant select,insert,update,delete on public.alertas_push_internos_outbox to service_role;

create or replace function public.preparar_alertas_push_internos()
returns integer language plpgsql security definer set search_path=''
as $$
declare n integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
  update public.alertas_push_internos_outbox o set status='dead',lease_until=null,last_error='Push interno desautorizado ou notificação removida'
    where (o.status='pending' or (o.status='processing' and o.lease_until<now())) and (not exists(
      select 1 from public.ajustes a join public.notificacoes x on x.id=o.notificacao_id
      where a.loja_id=o.loja_id and a.push_interno and a.push_interno_desde is not null
        and x.criado>=a.push_interno_desde and x.removida_em is null
    ));
  update public.alertas_push_internos_outbox set status='dead',lease_until=null,last_error='Limite de tentativas atingido'
    where status='processing' and lease_until<now() and attempts>=8;
  insert into public.alertas_push_internos_outbox(notificacao_id,user_id,loja_id,titulo,mensagem,payload)
    select n.id,n.user_id,n.loja_id,n.titulo,n.mensagem,n.payload
    from public.notificacoes n join public.ajustes a on a.loja_id=n.loja_id
    where a.push_interno and a.push_interno_desde is not null and n.criado>=a.push_interno_desde and n.removida_em is null
    on conflict(notificacao_id) do nothing;
  get diagnostics n=row_count;
  return n;
end;
$$;

create or replace function public.reivindicar_alertas_push_internos(p_limite integer default 100)
returns setof public.alertas_push_internos_outbox language plpgsql security definer set search_path=''
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
  return query with picked as (
    select o.id from public.alertas_push_internos_outbox o
    join public.notificacoes n on n.id=o.notificacao_id
    join public.ajustes a on a.loja_id=o.loja_id
    where ((o.status='pending' and o.available_at<=now()) or (o.status='processing' and o.lease_until<now() and o.attempts<8))
      and a.push_interno and a.push_interno_desde is not null and n.criado>=a.push_interno_desde and n.removida_em is null
    order by o.available_at for update of o skip locked limit least(greatest(p_limite,1),500)
  )
  update public.alertas_push_internos_outbox o set status='processing',attempts=o.attempts+1,lease_until=now()+interval '5 minutes'
    from picked where o.id=picked.id returning o.*;
end;
$$;

create or replace function public.registrar_resultado_alerta_push_interno(p_id uuid,p_ok boolean,p_erro text default null)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
  update public.alertas_push_internos_outbox set
    status=case when p_ok then 'sent' when attempts>=8 then 'dead' else 'pending' end,
    sent_at=case when p_ok then now() else null end,
    lease_until=null,
    last_error=case when p_ok then null else left(coalesce(p_erro,'falha'),300) end,
    available_at=case when p_ok or attempts>=8 then available_at else now()+make_interval(secs=>least(3600,power(2,least(attempts,11))::integer*15)) end
  where id=p_id and status='processing';
end;
$$;
revoke all on function public.preparar_alertas_push_internos() from public,anon,authenticated;
revoke all on function public.reivindicar_alertas_push_internos(integer) from public,anon,authenticated;
revoke all on function public.registrar_resultado_alerta_push_interno(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.preparar_alertas_push_internos() to service_role;
grant execute on function public.reivindicar_alertas_push_internos(integer) to service_role;
grant execute on function public.registrar_resultado_alerta_push_interno(uuid,boolean,text) to service_role;
