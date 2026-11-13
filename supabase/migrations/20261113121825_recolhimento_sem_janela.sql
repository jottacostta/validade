-- O prazo de cinco dias após o vencimento continua sendo a retenção operacional.
begin;

create or replace function public.marcar_registro_recolhido(p_tipo text, p_id text, p_loja_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_val date;
  v_recolhido_em timestamptz;
  v_recolhido_por uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rows integer;
begin
  if (select auth.uid()) is null then
    raise exception 'É necessário estar autenticado' using errcode='42501';
  end if;
  if p_tipo is null or p_tipo not in ('lote','perecivel') or p_id is null or length(btrim(p_id))=0 or p_loja_id is null then
    raise exception 'Identificação do registro inválida' using errcode='22023';
  end if;
  if not coalesce(private.tem_escopo_global(),false)
     and not coalesce(private.membro_da(p_loja_id),false) then
    raise exception 'Sem acesso à loja' using errcode='42501';
  end if;
  if not coalesce(private.tem_permissao('registros_recolher'),false) then
    raise exception 'Seu perfil não tem permissão para recolher registros' using errcode='42501';
  end if;

  if p_tipo='lote' then
    select l.val,l.recolhido_em,l.recolhido_por
      into v_val,v_recolhido_em,v_recolhido_por
      from public.lotes l where l.id=p_id and l.loja_id=p_loja_id and l.deleted_at is null
      for update;
  else
    select r.val,r.recolhido_em,r.recolhido_por
      into v_val,v_recolhido_em,v_recolhido_por
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
  if v_val<v_hoje-5 then
    raise exception 'O prazo de retenção operacional já terminou; o registro permanece no histórico' using errcode='22023';
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
create or replace function public.restaurar_registro_recolhido(p_tipo text, p_id text, p_loja_id uuid)
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
  if p_tipo is null or p_tipo not in ('lote','perecivel') or p_id is null or length(btrim(p_id))=0 or p_loja_id is null then
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
  if v_val<v_hoje-5 then
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
commit;
