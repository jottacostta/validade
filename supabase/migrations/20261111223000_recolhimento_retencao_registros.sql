-- Recolhimento operacional compartilhado por loja e retenção de cinco dias após vencimento.
-- Os registros não são apagados: saem das telas operacionais, mas permanecem no histórico/relatórios.

alter table public.lotes
  add column if not exists recolhido_em timestamptz,
  add column if not exists recolhido_por uuid references auth.users(id) on delete set null;

alter table public.pere_regs
  add column if not exists recolhido_em timestamptz,
  add column if not exists recolhido_por uuid references auth.users(id) on delete set null;

comment on column public.lotes.recolhido_em is 'Momento em que o lote foi tratado/recolhido e retirado da área de venda.';
comment on column public.lotes.recolhido_por is 'Usuário autenticado que marcou o lote como recolhido.';
comment on column public.pere_regs.recolhido_em is 'Momento em que o registro perecível foi tratado/recolhido e retirado da área de venda.';
comment on column public.pere_regs.recolhido_por is 'Usuário autenticado que marcou o perecível como recolhido.';

-- Não permite alterar os campos de recolhimento por PATCH/upsert genérico do cliente.
-- A RPC abaixo ativa a flag apenas durante sua própria transação.
create or replace function private.bloquear_alteracao_recolhimento()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.recolhido_em is distinct from old.recolhido_em
     or new.recolhido_por is distinct from old.recolhido_por then
    if current_setting('validade.recolhimento_rpc', true)='on' then
      if old.recolhido_em is not null or new.recolhido_em is null
         or new.recolhido_por is distinct from (select auth.uid()) then
        raise exception 'Estado de recolhimento inválido' using errcode='42501';
      end if;
    elsif current_setting('validade.recolhimento_rpc', true)='restore' then
      if old.recolhido_em is null or new.recolhido_em is not null or new.recolhido_por is not null then
        raise exception 'Estado de reativação inválido' using errcode='42501';
      end if;
    else
      raise exception 'Use uma ação autorizada de recolhimento ou reativação' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.bloquear_alteracao_recolhimento() from public,anon,authenticated;

drop trigger if exists lotes_recolhimento_guard on public.lotes;
create trigger lotes_recolhimento_guard before update on public.lotes
  for each row execute function private.bloquear_alteracao_recolhimento();
drop trigger if exists pere_regs_recolhimento_guard on public.pere_regs;
create trigger pere_regs_recolhimento_guard before update on public.pere_regs
  for each row execute function private.bloquear_alteracao_recolhimento();

create or replace function public.marcar_registro_recolhido(p_tipo text, p_id uuid, p_loja_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_val date;
  v_created_by uuid;
  v_recolhido_em timestamptz;
  v_recolhido_por uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rows integer;
begin
  if (select auth.uid()) is null then
    raise exception 'É necessário estar autenticado' using errcode='42501';
  end if;
  if p_tipo is null or p_tipo not in ('lote','perecivel') or p_id is null or p_loja_id is null then
    raise exception 'Identificação do registro inválida' using errcode='22023';
  end if;
  if not coalesce(private.tem_escopo_global(),false)
     and not coalesce(private.membro_da(p_loja_id),false) then
    raise exception 'Sem acesso à loja' using errcode='42501';
  end if;

  if p_tipo='lote' then
    select l.val,l.created_by,l.recolhido_em,l.recolhido_por
      into v_val,v_created_by,v_recolhido_em,v_recolhido_por
      from public.lotes l where l.id=p_id and l.loja_id=p_loja_id and l.deleted_at is null
      for update;
  else
    select r.val,r.created_by,r.recolhido_em,r.recolhido_por
      into v_val,v_created_by,v_recolhido_em,v_recolhido_por
      from public.pere_regs r where r.id=p_id and r.loja_id=p_loja_id and r.deleted_at is null
      for update;
  end if;
  if not found then
    raise exception 'Registro não encontrado ou sem acesso' using errcode='42501';
  end if;
  if v_recolhido_em is not null then
    return jsonb_build_object('tipo',p_tipo,'id',p_id,'recolhido_em',v_recolhido_em,
      'recolhido_por',v_recolhido_por,'ja_recolhido',true);
  end if;
  if v_val is null or v_val<v_hoje or v_val>v_hoje+5 then
    raise exception 'O recolhimento está disponível somente para produtos que vencem hoje ou nos próximos 5 dias.' using errcode='22023';
  end if;
  if not coalesce(private.tem_permissao('registros_editar_outros'),false)
     and not (v_created_by=(select auth.uid())
       and coalesce(private.tem_permissao('editar_proprios'),false)) then
    raise exception 'Você não tem permissão para tratar este registro' using errcode='42501';
  end if;

  perform set_config('validade.recolhimento_rpc','on',true);
  if p_tipo='lote' then
    update public.lotes set recolhido_em=now(),recolhido_por=(select auth.uid())
      where id=p_id and loja_id=p_loja_id and deleted_at is null and recolhido_em is null;
  else
    update public.pere_regs set recolhido_em=now(),recolhido_por=(select auth.uid())
      where id=p_id and loja_id=p_loja_id and deleted_at is null and recolhido_em is null;
  end if;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'O registro mudou durante a operação; atualize e tente novamente' using errcode='40001'; end if;

  return jsonb_build_object('tipo',p_tipo,'id',p_id,'recolhido_em',now(),
    'recolhido_por',(select auth.uid()),'ja_recolhido',false);
end;
$$;
revoke all on function public.marcar_registro_recolhido(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.marcar_registro_recolhido(text,uuid,uuid) to authenticated;

-- Apenas assistente, analista, gerente e administrador podem reativar o registro recolhido na loja.
create or replace function public.restaurar_registro_recolhido(p_tipo text, p_id uuid, p_loja_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_val date;
  v_recolhido_em timestamptz;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rows integer;
begin
  if (select auth.uid()) is null then
    raise exception 'É necessário estar autenticado' using errcode='42501';
  end if;
  if p_tipo is null or p_tipo not in ('lote','perecivel') or p_id is null or p_loja_id is null then
    raise exception 'Identificação do registro inválida' using errcode='22023';
  end if;
  if not coalesce(private.tem_escopo_global(),false)
     and not coalesce(private.membro_da(p_loja_id),false) then
    raise exception 'Sem acesso à loja' using errcode='42501';
  end if;
  if coalesce(private.meu_papel(),'') not in ('assistente','analista','gerente','admin') then
    raise exception 'Somente assistente e perfis superiores podem reativar registros' using errcode='42501';
  end if;

  if p_tipo='lote' then
    select l.val,l.recolhido_em into v_val,v_recolhido_em
      from public.lotes l where l.id=p_id and l.loja_id=p_loja_id and l.deleted_at is null for update;
  else
    select r.val,r.recolhido_em into v_val,v_recolhido_em
      from public.pere_regs r where r.id=p_id and r.loja_id=p_loja_id and r.deleted_at is null for update;
  end if;
  if not found then raise exception 'Registro não encontrado ou sem acesso' using errcode='42501'; end if;
  if v_recolhido_em is null then
    return jsonb_build_object('tipo',p_tipo,'id',p_id,'reativado',true,'ja_ativo',true);
  end if;
  if v_val is null or v_val<v_hoje-5 then
    raise exception 'O prazo de retenção operacional já terminou; o registro permanece no histórico' using errcode='22023';
  end if;

  perform set_config('validade.recolhimento_rpc','restore',true);
  if p_tipo='lote' then
    update public.lotes set recolhido_em=null,recolhido_por=null
      where id=p_id and loja_id=p_loja_id and deleted_at is null and recolhido_em is not null;
  else
    update public.pere_regs set recolhido_em=null,recolhido_por=null
      where id=p_id and loja_id=p_loja_id and deleted_at is null and recolhido_em is not null;
  end if;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'O registro mudou durante a operação; atualize e tente novamente' using errcode='40001'; end if;
  return jsonb_build_object('tipo',p_tipo,'id',p_id,'reativado',true,'ja_ativo',false);
end;
$$;
revoke all on function public.restaurar_registro_recolhido(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.restaurar_registro_recolhido(text,uuid,uuid) to authenticated;

-- As notificações internas deixam de nascer para itens recolhidos ou vencidos há mais de 5 dias.
create or replace function public.gerar_alertas_validade()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_rows jsonb;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role pode gerar alertas'; end if;
  with fontes as (
    select l.id as registro_id,l.loja_id,l.val,l.ean as codigo,coalesce(c.nome,l.ean) as nome,l.lote as referencia,l.setor,
      'lote'::text as fonte from public.lotes l left join public.catalogo c on c.ean=l.ean
    where l.deleted_at is null and l.recolhido_em is null and l.val is not null
    union all
    select r.id,r.loja_id,r.val,r.cod,coalesce(i.descricao,r.cod),r.sif,r.setor,'perecivel'
    from public.pere_regs r left join public.pere_itens i on i.loja_id=r.loja_id and i.cod=r.cod
    where r.deleted_at is null and r.recolhido_em is null and r.val is not null
  ), candidatos as (
    select f.*,lo.nome as loja_nome,
      case when f.val<v_hoje then 'validade_vencida' else 'validade_proxima' end as tipo,
      case when f.val<v_hoje then 'Produto vencido' else 'Validade próxima' end as titulo,
      case when f.val<v_hoje then 'Registro vencido em '||f.val::text else 'Registro vence em '||f.val::text end as mensagem
    from fontes f join public.lojas lo on lo.id=f.loja_id
    where f.val between v_hoje-5 and v_hoje+coalesce((select a.dias from public.ajustes a where a.loja_id=f.loja_id),30)
  ), ins as (
    insert into public.notificacoes(user_id,loja_id,dedupe_key,tipo,titulo,mensagem,payload)
    select m.user_id,c.loja_id,c.fonte||':'||c.registro_id||':'||c.val::text||':'||c.tipo,
      c.tipo,c.titulo,c.mensagem,
      jsonb_build_object('fonte',c.fonte,'registro_id',c.registro_id,'nome',c.nome,'codigo',c.codigo,
        'lote_ou_sif',c.referencia,'setor',c.setor,'validade',c.val,'loja_id',c.loja_id,'loja',c.loja_nome)
    from candidatos c join (
        select lm.user_id,lm.loja_id from public.loja_membros lm
        union
        select p.id,lo.id from public.perfis p cross join public.lojas lo
        where p.papel in ('analista','gerente','admin')
      ) m on m.loja_id=c.loja_id
    on conflict(user_id,dedupe_key) do nothing
    returning id,user_id,loja_id,tipo,titulo,mensagem,payload,criado
  ) select coalesce(jsonb_agg(to_jsonb(ins)),'[]'::jsonb) into v_rows from ins;
  return v_rows;
end;
$$;
revoke all on function public.gerar_alertas_validade() from public,anon,authenticated;
grant execute on function public.gerar_alertas_validade() to service_role;

-- Push pessoais: não enfileira itens recolhidos nem mantém pendente elegível depois do tratamento.
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
 update public.alertas_push_outbox o set status='dead',lease_until=null,last_error='Registro recolhido, removido ou fora da retenção de cinco dias'
 from public.alertas_regras ar
 where ar.id=o.regra_id and o.status in ('pending','processing')
   and not (
     (o.fonte='lote' and exists(select 1 from public.lotes l where l.id::text=o.registro_id and l.loja_id=o.loja_id
       and l.deleted_at is null and l.recolhido_em is null and l.val=o.validade
       and l.val >= (now() at time zone ar.fuso)::date-5))
     or (o.fonte='perecivel' and exists(select 1 from public.pere_regs r where r.id::text=o.registro_id and r.loja_id=o.loja_id
       and r.deleted_at is null and r.recolhido_em is null and r.val=o.validade
       and r.val >= (now() at time zone ar.fuso)::date-5))
   );
 with fontes as (
  select l.id registro_id,l.loja_id,l.val validade,l.ean codigo,coalesce(c.nome,l.ean) nome,l.lote referencia,l.setor,'lote'::text fonte
    from public.lotes l left join public.catalogo c on c.ean=l.ean
    where l.deleted_at is null and l.recolhido_em is null and l.val is not null
  union all
  select r.id,r.loja_id,r.val,r.cod,coalesce(i.descricao,r.cod),r.sif,r.setor,'perecivel'
    from public.pere_regs r left join public.pere_itens i on i.loja_id=r.loja_id and i.cod=r.cod
    where r.deleted_at is null and r.recolhido_em is null and r.val is not null
 ), destinatarios as (
  select lm.user_id,lm.loja_id from public.loja_membros lm
  union select p.id,lo.id from public.perfis p cross join public.lojas lo where p.papel in ('analista','gerente','admin')
 ), candidatas as (
  select ar.id regra_id,ar.user_id,f.loja_id,f.registro_id,f.fonte,f.validade,(now() at time zone ar.fuso)::date data_local,
   case when f.validade<(now() at time zone ar.fuso)::date then 'Produto vencido' else 'Validade próxima' end titulo,
   case when f.validade<(now() at time zone ar.fuso)::date then 'Registro vencido em '||f.validade::text else 'Registro vence em '||f.validade::text end mensagem,
   jsonb_build_object('fonte',f.fonte,'registro_id',f.registro_id,'nome',f.nome,'codigo',f.codigo,'lote_ou_sif',f.referencia,'setor',f.setor,'validade',f.validade,'loja_id',f.loja_id) payload
  from public.alertas_regras ar join fontes f on (f.validade-ar.dias)=(now() at time zone ar.fuso)::date
  join destinatarios d on d.user_id=ar.user_id and d.loja_id=f.loja_id
  where ar.ativo and (now() at time zone ar.fuso)::time>=ar.hora_local
    and f.validade >= (now() at time zone ar.fuso)::date-5
 )
 insert into public.alertas_push_outbox(regra_id,user_id,loja_id,registro_id,fonte,validade,data_local,titulo,mensagem,payload)
 select regra_id,user_id,loja_id,registro_id,fonte,validade,data_local,titulo,mensagem,payload from candidatas
 on conflict(regra_id,user_id,loja_id,registro_id,validade,data_local) do nothing;
 get diagnostics n = row_count; return n;
end; $$;
revoke all on function public.preparar_alertas_push() from public,anon,authenticated;
grant execute on function public.preparar_alertas_push() to service_role;

-- Segunda barreira: mesmo se houver chamada direta de reivindicação, só entrega item ainda ativo.
create or replace function public.reivindicar_alertas_push(p_limite integer default 100)
returns setof public.alertas_push_outbox language plpgsql security definer set search_path=''
as $$
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
 return query with picked as (
   select o.id from public.alertas_push_outbox o
   where ((o.status='pending' and o.available_at<=now()) or (o.status='processing' and o.lease_until<now() and o.attempts<8))
     and exists(select 1 from public.alertas_regras ar where ar.id=o.regra_id and ar.ativo
       and o.data_local=(now() at time zone ar.fuso)::date
       and ((o.fonte='lote' and exists(select 1 from public.lotes l where l.id::text=o.registro_id and l.loja_id=o.loja_id
               and l.val=o.validade and l.deleted_at is null and l.recolhido_em is null
               and l.val >= (now() at time zone ar.fuso)::date-5))
         or (o.fonte='perecivel' and exists(select 1 from public.pere_regs r where r.id::text=o.registro_id and r.loja_id=o.loja_id
               and r.val=o.validade and r.deleted_at is null and r.recolhido_em is null
               and r.val >= (now() at time zone ar.fuso)::date-5)))
     )
   order by o.available_at for update skip locked limit least(greatest(p_limite,1),500)
 )
 update public.alertas_push_outbox o set status='processing',attempts=o.attempts+1,lease_until=now()+interval '5 minutes'
 from picked where o.id=picked.id returning o.*;
end; $$;
revoke all on function public.reivindicar_alertas_push(integer) from public,anon,authenticated;
grant execute on function public.reivindicar_alertas_push(integer) to service_role;

notify pgrst, 'reload schema';
