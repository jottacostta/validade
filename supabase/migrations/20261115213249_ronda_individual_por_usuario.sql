begin;

alter table public.checklist_rondas
  drop constraint checklist_rondas_loja_id_data_operacional_modelo_codigo_key,
  add constraint checklist_rondas_usuario_data_modelo_key unique(loja_id,criado_por,data_operacional,modelo_codigo);

alter policy checklist_ronda_read on public.checklist_rondas using (
  (select private.meu_papel())='admin' or (
    private.checklist_designado(loja_id) and (
      criado_por=(select auth.uid()) or exists (
        select 1 from public.checklist_acessos a
        where a.loja_id=checklist_rondas.loja_id and a.user_id=(select auth.uid())
          and a.ativo and a.funcao in ('encarregado','subgerente')
      )
    )
  )
);

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
 on conflict(loja_id,criado_por,data_operacional,modelo_codigo) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.checklist_rondas where loja_id=p_loja_id and data_operacional=p_data and modelo_codigo=p_modelo_codigo and criado_por=auth.uid() for update; end if;
 if not exists(select 1 from public.checklist_eventos where ronda_id=v_id and acao='criada') then
  insert into public.checklist_eventos(ronda_id,user_id,ator_nome,acao,detalhe) values(v_id,auth.uid(),v_nome,'criada',jsonb_build_object('modelo_versao',v_modelo.versao));
 end if;
 return v_id;
end $$;

create or replace function public.checklist_salvar_rascunho(p_ronda_id uuid,p_respostas jsonb,p_observacoes text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare r public.checklist_rondas%rowtype; v_nome text; v_expected integer; v_seen integer; v_items jsonb;
begin
 select * into r from public.checklist_rondas where id=p_ronda_id and criado_por=auth.uid() for update;
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
 select * into r from public.checklist_rondas where id=p_ronda_id and criado_por=auth.uid() for update;
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

commit;
