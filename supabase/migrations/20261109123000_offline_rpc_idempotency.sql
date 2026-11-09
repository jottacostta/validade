-- Permite que a fila offline repita uma RPC após timeout/resposta perdida sem criar
-- duplicatas. Um ID existente só é considerado sucesso se payload, loja e autor
-- coincidirem exatamente; colisões ou alterações continuam sendo rejeitadas.

create or replace function public.registrar_lote(
  p_id text,p_loja_id uuid,p_ean text,p_nome text,p_lote text,p_qtd numeric,p_val date,p_setor text
) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
  v_nome text;
  v_criado bigint;
  v_lote_norm text;
  v_exist public.lotes%rowtype;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if p_id is null or btrim(p_id)='' or p_loja_id is null or p_ean is null or p_ean !~ '^[0-9]{6,14}$' or
     p_nome is null or btrim(p_nome)='' or p_lote is null or btrim(p_lote)='' or p_val is null or p_qtd is null or p_qtd <= 0 then
    raise exception 'Informe identificador, loja, EAN válido, nome, lote, quantidade maior que zero e validade';
  end if;
  if p_setor is null or p_setor not in ('Açougue','Laticínios','Padaria','Salgados','FLV','Mercearia') then
    raise exception 'Setor inválido';
  end if;
  if not (private.tem_escopo_global() or private.membro_da(p_loja_id)) then raise exception 'Usuário não tem acesso ativo à loja'; end if;

  -- Serializa retries do mesmo ID antes de consultar/inserir a linha.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registrar_lote_id|'||btrim(p_id),0));
  select l.* into v_exist from public.lotes l where l.id=btrim(p_id) for update;
  if found then
    if v_exist.loja_id=p_loja_id and v_exist.ean=btrim(p_ean) and v_exist.lote=btrim(p_lote) and
       v_exist.qtd=p_qtd and v_exist.val=p_val and v_exist.setor=p_setor and
       v_exist.created_by=auth.uid() and v_exist.deleted_at is null then
      return jsonb_build_object('id',v_exist.id,'loja_id',v_exist.loja_id,'ean',v_exist.ean,'setor',v_exist.setor,
        'created_by',v_exist.created_by,'created_by_nome',v_exist.created_by_nome,'criado',v_exist.criado);
    end if;
    raise exception 'Identificador de lote já utilizado por outro registro';
  end if;

  v_lote_norm := lower(btrim(coalesce(p_lote,'')));
  -- Serializa registros semanticamente iguais antes da checagem de duplicidade.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_loja_id::text||'|'||btrim(p_ean)||'|'||v_lote_norm||'|'||p_val::text,0));
  if exists(select 1 from public.lotes l where l.loja_id=p_loja_id and l.ean=btrim(p_ean)
      and lower(btrim(coalesce(l.lote,'')))=v_lote_norm and l.val=p_val and l.deleted_at is null) then
    raise exception 'Já existe lote desta loja com o mesmo EAN, lote e validade';
  end if;
  insert into public.produtos(loja_id,ean) values(p_loja_id,btrim(p_ean)) on conflict (loja_id,ean) do nothing;
  insert into public.catalogo(ean,nome) values(btrim(p_ean),btrim(p_nome))
    on conflict(ean) do update set nome=excluded.nome;
  insert into public.lotes(id,loja_id,ean,lote,qtd,val,setor,criado)
    values(btrim(p_id),p_loja_id,btrim(p_ean),btrim(p_lote),p_qtd,p_val,p_setor,(extract(epoch from clock_timestamp())*1000)::bigint)
    returning created_by_nome,criado into v_nome,v_criado;
  return jsonb_build_object('id',btrim(p_id),'loja_id',p_loja_id,'ean',btrim(p_ean),'setor',p_setor,
    'created_by',auth.uid(),'created_by_nome',v_nome,'criado',v_criado);
end;
$$;
revoke all on function public.registrar_lote(text,uuid,text,text,text,numeric,date,text) from public,anon;
grant execute on function public.registrar_lote(text,uuid,text,text,text,numeric,date,text) to authenticated;

create or replace function public.registrar_perecivel(
  p_id text,p_loja_id uuid,p_cod text,p_descricao text,p_sif text,p_peso numeric,p_val date,p_setor text
) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
  v_nome text;
  v_desc text;
  v_sif text;
  v_criado bigint;
  v_exist public.pere_regs%rowtype;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if p_id is null or btrim(p_id)='' or p_loja_id is null or p_cod is null or btrim(p_cod)='' or
     p_descricao is null or btrim(p_descricao)='' or p_val is null or p_peso is null or p_peso <= 0 then
    raise exception 'Informe identificador, loja, código, descrição, peso maior que zero e validade';
  end if;
  if p_setor is null or p_setor not in ('Açougue','Laticínios','Padaria','Salgados','FLV','Mercearia') then
    raise exception 'Setor inválido';
  end if;
  if not (private.tem_escopo_global() or private.membro_da(p_loja_id)) then raise exception 'Usuário não tem acesso ativo à loja'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registrar_perecivel_id|'||btrim(p_id),0));
  select r.* into v_exist from public.pere_regs r where r.id=btrim(p_id) for update;
  if found then
    if v_exist.loja_id=p_loja_id and v_exist.cod=btrim(p_cod) and v_exist.sif=btrim(coalesce(p_sif,'')) and
       v_exist.peso=p_peso and v_exist.val=p_val and v_exist.setor=p_setor and
       v_exist.created_by=auth.uid() and v_exist.deleted_at is null then
      select i.descricao,i.sif into v_desc,v_sif from public.pere_itens i where i.loja_id=p_loja_id and i.cod=btrim(p_cod);
      return jsonb_build_object('id',v_exist.id,'loja_id',v_exist.loja_id,'cod',v_exist.cod,'setor',v_exist.setor,
        'created_by',v_exist.created_by,'created_by_nome',v_exist.created_by_nome,
        'descricao',coalesce(v_desc,btrim(p_descricao)),'sif',coalesce(v_sif,v_exist.sif),'criado',v_exist.criado);
    end if;
    raise exception 'Identificador perecível já utilizado por outro registro';
  end if;

  insert into public.pere_itens(loja_id,cod,descricao,sif)
    values(p_loja_id,btrim(p_cod),btrim(p_descricao),btrim(coalesce(p_sif,'')))
    on conflict(loja_id,cod) do nothing;
  select i.descricao,i.sif into v_desc,v_sif from public.pere_itens i where i.loja_id=p_loja_id and i.cod=btrim(p_cod);
  insert into public.pere_regs(id,loja_id,cod,sif,peso,val,setor,criado)
    values(btrim(p_id),p_loja_id,btrim(p_cod),btrim(coalesce(p_sif,'')),p_peso,p_val,p_setor,(extract(epoch from clock_timestamp())*1000)::bigint)
    returning created_by_nome,criado into v_nome,v_criado;
  return jsonb_build_object('id',btrim(p_id),'loja_id',p_loja_id,'cod',btrim(p_cod),'setor',p_setor,
    'created_by',auth.uid(),'created_by_nome',v_nome,'descricao',v_desc,'sif',v_sif,'criado',v_criado);
end;
$$;
revoke all on function public.registrar_perecivel(text,uuid,text,text,text,numeric,date,text) from public,anon;
grant execute on function public.registrar_perecivel(text,uuid,text,text,text,numeric,date,text) to authenticated;
