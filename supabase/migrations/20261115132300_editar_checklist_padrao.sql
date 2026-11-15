begin;

-- O código lógico permanece igual. A filial pode sobrepor a versão global.
alter table public.checklist_modelos drop constraint checklist_modelos_codigo_versao_key,
  add unique nulls not distinct (loja_id,codigo,versao);
drop index public.checklist_modelos_codigo_ativo;
create unique index checklist_modelos_codigo_ativo
  on public.checklist_modelos(loja_id,codigo) nulls not distinct where ativo;

create or replace function public.checklist_salvar_modelo(p_loja_id uuid,p_codigo text,p_versao int,p_titulo text,p_secoes jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v_codigo text; v_versao int; v_estrutura jsonb;
begin
  if auth.uid() is null or private.meu_papel() is distinct from 'admin' then
    raise exception 'Somente o Administrador pode salvar modelos' using errcode='42501';
  end if;
  if not exists(select 1 from public.lojas where id=p_loja_id)
    or length(btrim(coalesce(p_titulo,''))) not between 1 and 100
    or jsonb_typeof(p_secoes) is distinct from 'array' then
    raise exception 'Informe filial, nome e seções válidos' using errcode='22023';
  end if;
  if jsonb_array_length(p_secoes) not between 1 and 12 then
    raise exception 'Informe de 1 a 12 seções' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_secoes) s
    where jsonb_typeof(s->'titulo') is distinct from 'string'
      or length(btrim(s->>'titulo')) not between 1 and 100
      or jsonb_typeof(s->'itens') is distinct from 'array') then
    raise exception 'Cada seção precisa de um título e uma lista de perguntas' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_secoes) s where jsonb_array_length(s->'itens') not between 1 and 20)
    or exists(select 1 from jsonb_array_elements(p_secoes) s cross join lateral jsonb_array_elements(s->'itens') q
      where case jsonb_typeof(q)
        when 'string' then length(btrim(q#>>'{}')) not between 1 and 250
        when 'object' then jsonb_typeof(q->'titulo') is distinct from 'string'
          or length(btrim(q->>'titulo')) not between 1 and 250
          or (q ? 'descricao' and (jsonb_typeof(q->'descricao') is distinct from 'string' or length(q->>'descricao')>1000))
          or (q ? 'temperaturas' and q->'temperaturas' is distinct from '["ilhas_c","peixes_c"]'::jsonb)
        else true end) then
    raise exception 'Informe de 1 a 20 perguntas por seção, com até 250 caracteres cada' using errcode='22023';
  end if;

  if p_codigo is null then
    v_codigo := gen_random_uuid()::text;
    v_versao := 1;
  else
    perform pg_advisory_xact_lock(hashtextextended('checklist-modelo:'||p_loja_id::text||':'||p_codigo,0));
    select codigo,versao+1 into v_codigo,v_versao from public.checklist_modelos
      where codigo=p_codigo and ativo and (loja_id=p_loja_id or loja_id is null)
      order by loja_id nulls last limit 1;
    if not found then raise exception 'Modelo indisponível nesta filial' using errcode='42501'; end if;
    if p_versao is distinct from v_versao-1 then raise exception 'O modelo mudou. Atualize a lista antes de editar.' using errcode='40001'; end if;
    update public.checklist_modelos set ativo=false where loja_id=p_loja_id and codigo=v_codigo and ativo;
  end if;

  select jsonb_build_object('secoes',jsonb_agg(jsonb_build_object(
    'id','secao_'||s.n,'titulo',btrim(s.dado->>'titulo'),
    'itens',(select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id','item_'||s.n||'_'||q.n,
      'titulo',btrim(case when jsonb_typeof(q.dado)='string' then q.dado#>>'{}' else q.dado->>'titulo' end),
      'descricao',nullif(btrim(q.dado->>'descricao'),''),'temperaturas',q.dado->'temperaturas'
    )) order by q.n) from jsonb_array_elements(s.dado->'itens') with ordinality q(dado,n))
  ) order by s.n)) into v_estrutura
  from jsonb_array_elements(p_secoes) with ordinality s(dado,n);

  insert into public.checklist_modelos(loja_id,codigo,versao,titulo,estrutura,ativo,criado_por)
    values(p_loja_id,v_codigo,v_versao,btrim(p_titulo),v_estrutura,true,auth.uid());
  return v_codigo;
end $$;

create or replace function public.checklist_criar_ronda(p_loja_id uuid,p_data date,p_modelo_codigo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_modelo public.checklist_modelos%rowtype; v_nome text;
begin
 if auth.uid() is null or p_loja_id is null or p_data is null or not private.checklist_designado(p_loja_id)
  or not exists(select 1 from public.checklist_acessos a where a.loja_id=p_loja_id and a.user_id=auth.uid() and a.funcao='executor' and a.ativo)
 then raise exception 'Sem acesso à loja ou executor não designado' using errcode='42501'; end if;
 select * into v_modelo from public.checklist_modelos where codigo=p_modelo_codigo and ativo and (loja_id is null or loja_id=p_loja_id)
 order by loja_id nulls last limit 1;
 if not found then raise exception 'Template ativo não encontrado'; end if;
 select coalesce(nullif(btrim(p.nome),''),u.email,auth.uid()::text) into v_nome from public.perfis p left join auth.users u on u.id=p.id where p.id=auth.uid();
 v_nome:=coalesce(v_nome,auth.uid()::text);
 insert into public.checklist_rondas(loja_id,data_operacional,criado_por,criado_por_nome,atualizado_por,atualizado_por_nome,modelo_snapshot,modelo_codigo,modelo_titulo)
 values(p_loja_id,p_data,auth.uid(),v_nome,auth.uid(),v_nome,v_modelo.estrutura,v_modelo.codigo,v_modelo.titulo)
 on conflict(loja_id,data_operacional,modelo_codigo) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.checklist_rondas where loja_id=p_loja_id and data_operacional=p_data and modelo_codigo=p_modelo_codigo for update; end if;
 if not exists(select 1 from public.checklist_eventos where ronda_id=v_id and acao='criada') then
  insert into public.checklist_eventos(ronda_id,user_id,ator_nome,acao,detalhe) values(v_id,auth.uid(),v_nome,'criada',jsonb_build_object('modelo_versao',v_modelo.versao));
 end if;
 return v_id;
end $$;

commit;
