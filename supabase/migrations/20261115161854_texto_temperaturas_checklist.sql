begin;

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
          or (q ? 'texto_temperaturas' and (not (q ? 'temperaturas')
            or jsonb_typeof(q->'texto_temperaturas') is distinct from 'string'
            or length(btrim(q->>'texto_temperaturas'))>250))
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
      'descricao',nullif(btrim(q.dado->>'descricao'),''),'temperaturas',q.dado->'temperaturas',
      'texto_temperaturas',btrim(q.dado->>'texto_temperaturas')
    )) order by q.n) from jsonb_array_elements(s.dado->'itens') with ordinality q(dado,n))
  ) order by s.n)) into v_estrutura
  from jsonb_array_elements(p_secoes) with ordinality s(dado,n);

  insert into public.checklist_modelos(loja_id,codigo,versao,titulo,estrutura,ativo,criado_por)
    values(p_loja_id,v_codigo,v_versao,btrim(p_titulo),v_estrutura,true,auth.uid());
  return v_codigo;
end $$;

commit;
