begin;

alter table public.checklist_modelos add column loja_id uuid references public.lojas(id) on delete cascade;
create unique index checklist_modelos_codigo_ativo on public.checklist_modelos(codigo) where ativo;
create index checklist_modelos_loja_ativo on public.checklist_modelos(loja_id,titulo) where ativo;

alter table public.checklist_rondas
  add column modelo_codigo text not null default 'acougue_diario',
  add column modelo_titulo text not null default 'Checklist Operacional Diário — Açougue',
  add column ativa boolean not null default true,
  drop constraint checklist_rondas_loja_id_data_operacional_key,
  add unique(loja_id,data_operacional,modelo_codigo);

-- A pausa anterior da filial passa a valer para cada ronda já existente.
update public.checklist_rondas r set ativa=false
from public.checklist_configuracoes c where c.loja_id=r.loja_id and not c.ativo;

create or replace function private.checklist_designado(p_loja_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.checklist_acessos a
    join public.loja_membros m on m.loja_id=a.loja_id and m.user_id=a.user_id
    where a.loja_id=p_loja_id and a.user_id=(select auth.uid()) and a.ativo
  )
$$;

alter policy checklist_modelo_read on public.checklist_modelos using (
  (select private.meu_papel())='admin' or (
    ativo and exists(select 1 from public.checklist_acessos a
      where a.user_id=(select auth.uid()) and a.ativo
        and (checklist_modelos.loja_id is null or a.loja_id=checklist_modelos.loja_id)
        and private.checklist_designado(a.loja_id))
  )
);
alter policy checklist_ronda_read on public.checklist_rondas using (
  (select private.meu_papel())='admin' or private.checklist_designado(loja_id)
);

create function public.checklist_salvar_modelo(p_loja_id uuid,p_codigo text,p_versao int,p_titulo text,p_secoes jsonb)
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
      where jsonb_typeof(q) is distinct from 'string' or length(btrim(q#>>'{}')) not between 1 and 250) then
    raise exception 'Informe de 1 a 20 perguntas por seção, com até 250 caracteres cada' using errcode='22023';
  end if;

  if p_codigo is null then
    v_codigo := gen_random_uuid()::text;
    v_versao := 1;
  else
    perform pg_advisory_xact_lock(hashtextextended('checklist-modelo:'||p_codigo,0));
    select codigo,versao+1 into v_codigo,v_versao from public.checklist_modelos
      where loja_id=p_loja_id and codigo=p_codigo and ativo;
    if not found then raise exception 'Modelo indisponível nesta filial' using errcode='42501'; end if;
    if p_versao is distinct from v_versao-1 then raise exception 'O modelo mudou. Atualize a lista antes de editar.' using errcode='40001'; end if;
    update public.checklist_modelos set ativo=false where codigo=v_codigo and ativo;
  end if;

  select jsonb_build_object('secoes',jsonb_agg(jsonb_build_object(
    'id','secao_'||s.n,'titulo',btrim(s.dado->>'titulo'),
    'itens',(select jsonb_agg(jsonb_build_object('id','item_'||s.n||'_'||q.n,'titulo',btrim(q.texto)) order by q.n)
      from jsonb_array_elements_text(s.dado->'itens') with ordinality q(texto,n))
  ) order by s.n)) into v_estrutura
  from jsonb_array_elements(p_secoes) with ordinality s(dado,n);

  insert into public.checklist_modelos(loja_id,codigo,versao,titulo,estrutura,ativo,criado_por)
    values(p_loja_id,v_codigo,v_versao,btrim(p_titulo),v_estrutura,true,auth.uid());
  return v_codigo;
end $$;

create function public.checklist_definir_ronda_ativa(p_loja_id uuid,p_ronda_id uuid,p_ativa boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.checklist_rondas%rowtype; v_nome text;
begin
  if auth.uid() is null or private.meu_papel() is distinct from 'admin' then
    raise exception 'Somente o Administrador pode alterar a ativação' using errcode='42501';
  end if;
  select * into r from public.checklist_rondas where id=p_ronda_id and loja_id=p_loja_id for update;
  if not found or p_ativa is null then raise exception 'Ronda indisponível nesta filial' using errcode='22023'; end if;
  if r.ativa=p_ativa then return; end if;
  select nullif(btrim(nome),'') into v_nome from public.perfis where id=auth.uid();
  update public.checklist_rondas set ativa=p_ativa, updated_at=clock_timestamp() where id=r.id;
  insert into public.checklist_eventos(ronda_id,user_id,ator_nome,acao,detalhe)
    values(r.id,auth.uid(),coalesce(v_nome,auth.uid()::text),case when p_ativa then 'reativada' else 'pausada' end,
      jsonb_build_object('ativa',p_ativa));
end $$;

revoke all on function public.checklist_salvar_modelo(uuid,text,int,text,jsonb),public.checklist_definir_ronda_ativa(uuid,uuid,boolean) from public,anon;
grant execute on function public.checklist_salvar_modelo(uuid,text,int,text,jsonb),public.checklist_definir_ronda_ativa(uuid,uuid,boolean) to authenticated;

create or replace function public.checklist_criar_ronda(p_loja_id uuid,p_data date,p_modelo_codigo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_modelo public.checklist_modelos%rowtype; v_nome text;
begin
 if auth.uid() is null or p_loja_id is null or p_data is null or not private.checklist_designado(p_loja_id)
  or not exists(select 1 from public.checklist_acessos a where a.loja_id=p_loja_id and a.user_id=auth.uid() and a.funcao='executor' and a.ativo)
 then raise exception 'Sem acesso à loja ou executor não designado' using errcode='42501'; end if;
 select * into v_modelo from public.checklist_modelos where codigo=p_modelo_codigo and ativo and (loja_id is null or loja_id=p_loja_id);
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

create or replace function public.checklist_criar_ronda(p_loja_id uuid,p_data date)
returns uuid language sql set search_path = '' as $$
  select public.checklist_criar_ronda(p_loja_id,p_data,'acougue_diario')
$$;
revoke all on function public.checklist_criar_ronda(uuid,date,text) from public,anon;
grant execute on function public.checklist_criar_ronda(uuid,date,text) to authenticated;

create or replace function public.checklist_salvar_rascunho(p_ronda_id uuid,p_respostas jsonb,p_observacoes text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare r public.checklist_rondas%rowtype; v_nome text; v_expected integer; v_seen integer; v_items jsonb;
begin
 select * into r from public.checklist_rondas where id=p_ronda_id for update;
 if not found or not private.checklist_designado(r.loja_id)
  or not exists(select 1 from public.checklist_acessos where loja_id=r.loja_id and user_id=auth.uid() and funcao='executor' and ativo)
 then raise exception 'Ronda inexistente ou sem acesso' using errcode='42501'; end if;
 if not r.ativa then raise exception 'Ronda inativa' using errcode='55000'; end if;
 if r.estado not in ('rascunho','devolvida') then raise exception 'Ronda não editável'; end if;
 select coalesce(jsonb_agg(i),'[]'::jsonb) into v_items from jsonb_array_elements(r.modelo_snapshot->'secoes') s cross join lateral jsonb_array_elements(s->'itens') i;
 select count(*) into v_expected from jsonb_array_elements(v_items);
 if jsonb_typeof(p_respostas) is distinct from 'object' then raise exception 'Conteúdo de rascunho inválido' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(p_respostas))>v_expected then raise exception 'Conteúdo de rascunho inválido' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(p_respostas) e where not exists(select 1 from jsonb_array_elements(v_items) i where i->>'id'=e.key)) then raise exception 'ID de item desconhecido' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(p_respostas) e where jsonb_typeof(e.value) is distinct from 'object' or coalesce(e.value->>'resposta','') not in ('','SIM','NÃO')) then raise exception 'Resposta deve ser SIM, NÃO ou ainda não respondida'; end if;
 if exists(select 1 from jsonb_each(p_respostas) e where coalesce(nullif(btrim(e.value->>'ilhas_c'),''),'')<>'' and btrim(e.value->>'ilhas_c') !~ '^-?[0-9]+([.,][0-9]+)?$' or coalesce(nullif(btrim(e.value->>'peixes_c'),''),'')<>'' and btrim(e.value->>'peixes_c') !~ '^-?[0-9]+([.,][0-9]+)?$') then raise exception 'Temperaturas devem ser numéricas em graus Celsius'; end if;
 if length(coalesce(p_observacoes,''))>3000 then raise exception 'Observações excedem o limite permitido'; end if;
 select coalesce(nullif(btrim(p.nome),''),u.email,auth.uid()::text) into v_nome from public.perfis p left join auth.users u on u.id=p.id where p.id=auth.uid();
 v_nome:=coalesce(v_nome,auth.uid()::text);
 update public.checklist_rondas set respostas=p_respostas,observacoes=p_observacoes,versao_conteudo=versao_conteudo+1,
  estado='rascunho',submetido_em=null,validado_em=null,updated_at=clock_timestamp(),atualizado_por=auth.uid(),atualizado_por_nome=v_nome
 where id=r.id returning versao_conteudo into v_seen;
 insert into public.checklist_eventos(ronda_id,user_id,ator_nome,acao,detalhe) values(r.id,auth.uid(),v_nome,'rascunho_salvo',jsonb_build_object('versao_conteudo',v_seen));
 return v_seen;
end $$;

create or replace function public.checklist_submeter_ronda(p_ronda_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.checklist_rondas%rowtype; v_nome text; v_items jsonb; v_expected integer;
begin
 select * into r from public.checklist_rondas where id=p_ronda_id for update;
 if not found or not private.checklist_designado(r.loja_id) or not exists(select 1 from public.checklist_acessos where loja_id=r.loja_id and user_id=auth.uid() and funcao='executor' and ativo) then raise exception 'Ronda inexistente ou sem acesso' using errcode='42501'; end if;
 if not r.ativa then raise exception 'Ronda inativa' using errcode='55000'; end if;
 if r.estado not in ('rascunho','devolvida') or r.versao_conteudo=0 then raise exception 'Ronda não está pronta para submissão'; end if;
 select coalesce(jsonb_agg(i),'[]'::jsonb) into v_items from jsonb_array_elements(r.modelo_snapshot->'secoes') s cross join lateral jsonb_array_elements(s->'itens') i;
 select count(*) into v_expected from jsonb_array_elements(v_items);
 if (select count(*) from jsonb_object_keys(r.respostas))<>v_expected or exists(select 1 from jsonb_each(r.respostas) e where coalesce(e.value->>'resposta','') not in ('SIM','NÃO'))
  or exists(select 1 from jsonb_array_elements(v_items) i where i ? 'temperaturas' and (nullif(btrim(r.respostas->(i->>'id')->>'ilhas_c'),'') is null or nullif(btrim(r.respostas->(i->>'id')->>'peixes_c'),'') is null))
 then raise exception 'Complete todos os itens e as duas temperaturas antes de enviar'; end if;
 if exists(select 1 from jsonb_array_elements(v_items) i where i ? 'temperaturas' and (btrim(r.respostas->(i->>'id')->>'ilhas_c') !~ '^-?[0-9]+([.,][0-9]+)?$' or btrim(r.respostas->(i->>'id')->>'peixes_c') !~ '^-?[0-9]+([.,][0-9]+)?$')) then raise exception 'Informe temperaturas numéricas em graus Celsius'; end if;
 if length(coalesce(r.observacoes,''))>3000 then raise exception 'Observações excedem o limite permitido'; end if;
 select coalesce(nullif(btrim(p.nome),''),u.email,auth.uid()::text) into v_nome from public.perfis p left join auth.users u on u.id=p.id where p.id=auth.uid(); v_nome:=coalesce(v_nome,auth.uid()::text);
 update public.checklist_rondas set estado='submetida',submetido_em=clock_timestamp(),updated_at=clock_timestamp(),atualizado_por=auth.uid(),atualizado_por_nome=v_nome where id=r.id;
 insert into public.checklist_eventos(ronda_id,user_id,ator_nome,acao,detalhe) values(r.id,auth.uid(),v_nome,'submetida',jsonb_build_object('versao_conteudo',r.versao_conteudo));
end $$;

create or replace function public.checklist_assinar_ronda(p_ronda_id uuid,p_etapa text,p_decisao text,p_comentario text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.checklist_rondas%rowtype; a public.checklist_acessos%rowtype; v_nome text; v_etapa text; v_a boolean; v_b boolean;
begin
 select * into r from public.checklist_rondas where id=p_ronda_id for update;
 if not found or not private.checklist_designado(r.loja_id) then raise exception 'Ronda inexistente ou sem acesso' using errcode='42501'; end if;
 if not r.ativa then raise exception 'Ronda inativa' using errcode='55000'; end if;
 if p_etapa not in ('encarregado','subgerente') or p_decisao not in ('validada','devolvida') then raise exception 'Etapa ou decisão inválida'; end if;
 v_etapa:=p_etapa;
 if not exists(select 1 from public.checklist_acessos where loja_id=r.loja_id and user_id=auth.uid() and funcao=v_etapa and ativo) then raise exception 'Signatário não designado para esta etapa' using errcode='42501'; end if;
 if auth.uid()=r.criado_por or exists(select 1 from public.checklist_eventos where ronda_id=r.id and user_id=auth.uid() and acao='rascunho_salvo') or exists(select 1 from public.checklist_acessos where loja_id=r.loja_id and user_id=auth.uid() and funcao='executor' and ativo) then raise exception 'Executor/autor da ronda não pode validá-la' using errcode='42501'; end if;
 if r.estado<>'submetida' then raise exception 'Ronda não está submetida'; end if;
 if exists(select 1 from public.checklist_eventos where ronda_id=r.id and user_id=auth.uid() and acao='rascunho_salvo') then raise exception 'Quem preencheu ou alterou a ronda não pode assiná-la' using errcode='42501'; end if;
 if p_decisao='devolvida' and length(btrim(coalesce(p_comentario,'')))<3 then raise exception 'Comentário/motivo da devolução obrigatório' using errcode='22023'; end if;
 if p_decisao='validada' and p_comentario is not null then raise exception 'Comentário só é permitido na devolução'; end if;
 select coalesce(nullif(btrim(p.nome),''),u.email,auth.uid()::text) into v_nome from public.perfis p left join auth.users u on u.id=p.id where p.id=auth.uid();
 v_nome:=coalesce(v_nome,auth.uid()::text);
 insert into public.checklist_assinaturas(ronda_id,versao_conteudo,etapa,decisao,user_id,nome,comentario)
 values(r.id,r.versao_conteudo,v_etapa,p_decisao,auth.uid(),v_nome,case when p_decisao='devolvida' then btrim(p_comentario) end);
 if p_decisao='devolvida' then
  update public.checklist_rondas set estado='devolvida',validado_em=null,updated_at=clock_timestamp() where id=r.id;
  insert into public.checklist_eventos(ronda_id,user_id,ator_nome,acao,detalhe) values(r.id,auth.uid(),v_nome,'devolvida',jsonb_build_object('etapa',v_etapa,'versao_conteudo',r.versao_conteudo));
  return 'devolvida';
 end if;
 select exists(select 1 from public.checklist_assinaturas where ronda_id=r.id and versao_conteudo=r.versao_conteudo and etapa='encarregado' and decisao='validada'),
        exists(select 1 from public.checklist_assinaturas where ronda_id=r.id and versao_conteudo=r.versao_conteudo and etapa='subgerente' and decisao='validada') into v_a,v_b;
 if v_a and v_b then update public.checklist_rondas set estado='validada',validado_em=clock_timestamp(),updated_at=clock_timestamp() where id=r.id; end if;
 insert into public.checklist_eventos(ronda_id,user_id,ator_nome,acao,detalhe) values(r.id,auth.uid(),v_nome,'assinada',jsonb_build_object('etapa',v_etapa,'versao_conteudo',r.versao_conteudo));
 return case when v_a and v_b then 'validada' else 'aguardando_segunda_assinatura' end;
end $$;

commit;
