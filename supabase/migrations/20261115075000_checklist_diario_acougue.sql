begin;

-- Modelo transcrito do Checklist_Operacional_Acougue_v2.docx. O fluxo pedido usa
-- duas etapas de validação (Encarregado e Subgerente de Perecíveis); a linha
-- adicional 'Sub Encarregado' do formulário Word não é tratada como terceira aprovação.
-- Cada ronda congela o modelo em modelo_snapshot para preservar o histórico.

create table public.checklist_modelos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  versao integer not null check (versao > 0),
  titulo text not null,
  estrutura jsonb not null check (jsonb_typeof(estrutura)='object'),
  ativo boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id) on delete set null,
  unique(codigo,versao)
);

insert into public.checklist_modelos(codigo,versao,titulo,estrutura,ativo)
values ('acougue_diario',1,'Checklist Operacional Diário — Açougue',jsonb_build_object(
 'secoes',jsonb_build_array(
  jsonb_build_object('id','secao_01','titulo','Ilhas de exposição e geladeira de peixes','itens',jsonb_build_array(
   jsonb_build_object('id','item_01','titulo','Organização','descricao','Sem mercadorias caídas nas grelhas e respeitando rigorosamente o limite de abastecimento.'),
   jsonb_build_object('id','item_02','titulo','Rupturas','descricao','Verificar ausência de produtos nas ilhas e providenciar reposição imediata.'),
   jsonb_build_object('id','item_03','titulo','Limpeza de grelhas','descricao','Grelhas limpas, higienizadas e totalmente isentas de lixo ou resíduos.'),
   jsonb_build_object('id','item_04','titulo','Precificação','descricao','Etiquetas presentes, corretas e conferidas com a tabela da moída.'),
   jsonb_build_object('id','item_05','titulo','Temperatura','descricao','Monitorar e registrar a temperatura das ilhas e da geladeira de peixes.','temperaturas',jsonb_build_array('ilhas_c','peixes_c')),
   jsonb_build_object('id','item_06','titulo','Geladeira de peixes','descricao','Organização interna, limpeza das superfícies e preços atualizados.'))),
  jsonb_build_object('id','secao_02','titulo','Balcões de atendimento e pesagem','itens',jsonb_build_array(
   jsonb_build_object('id','item_07','titulo','Balanças','descricao','Todas as balanças do setor limpas, higienizadas e niveladas.'),
   jsonb_build_object('id','item_08','titulo','Insumos','descricao','Bobinas térmicas e sacos plásticos totalmente abastecidos nos pontos de atendimento.'),
   jsonb_build_object('id','item_09','titulo','Vidros','descricao','Vidros dos balcões perfeitamente limpos, sem marcas de mãos ou gordura.'))),
  jsonb_build_object('id','secao_03','titulo','Sala de manipulação','itens',jsonb_build_array(
   jsonb_build_object('id','item_10','titulo','EPIs e insumos','descricao','Toucas, máscaras e luvas descartáveis abastecidos e em uso pela equipe.'),
   jsonb_build_object('id','item_11','titulo','Produtos de higiene','descricao','Sabonete líquido, álcool 70% e papel toalha abastecidos.'),
   jsonb_build_object('id','item_12','titulo','Organização geral','descricao','Mesas de corte limpas, bandejas organizadas e lixeiras higienizadas.'),
   jsonb_build_object('id','item_13','titulo','Serra-fita','descricao','Equipamento completamente limpo e sanificado após a operação.'),
   jsonb_build_object('id','item_14','titulo','Normas internas','descricao','Rigorosamente sem garrafas de água ou bebidas no setor de manipulação.'))),
  jsonb_build_object('id','secao_04','titulo','Sala de descongelamento técnico','itens',jsonb_build_array(
   jsonb_build_object('id','item_15','titulo','Cubas','descricao','Cubas higienizadas, limpas e abastecidas adequadamente.'),
   jsonb_build_object('id','item_16','titulo','Armazenamento','descricao','Nenhuma mercadoria aberta ou desprotegida solta na sala.'))),
  jsonb_build_object('id','secao_05','titulo','Controle rígido de validades','itens',jsonb_build_array(
   jsonb_build_object('id','item_17','titulo','Validade das bandejas','descricao','Conferir prazos, rotulagem e integridade visual de todas as bandejas expostas.'),
   jsonb_build_object('id','item_18','titulo','Validade das carnes','descricao','Checar validade dos cortes bovinos aplicando a regra PEPS (Primeiro que Vence, Primeiro que Sai).'),
   jsonb_build_object('id','item_19','titulo','Validade dos suínos','descricao','Vistoria e controle rigoroso das datas de validade dos cortes suínos.'))),
  jsonb_build_object('id','secao_06','titulo','Câmara de congelados','itens',jsonb_build_array(
   jsonb_build_object('id','item_20','titulo','Piso e estrados','descricao','Sem produtos encostados no chão; uso correto de estrados e paletes.'),
   jsonb_build_object('id','item_21','titulo','Organização','descricao','Sem produtos soltos e sem mercadorias dispostas sobre pranchas.'),
   jsonb_build_object('id','item_22','titulo','Limpeza','descricao','Paredes e portas limpas e livres de acúmulo de gelo ou sujeira.'),
   jsonb_build_object('id','item_23','titulo','BRT','descricao','BRT limpo, higienizado e organizado.')))
 )),true);

create table public.checklist_configuracoes (
  loja_id uuid primary key references public.lojas(id) on delete cascade,
  ativo boolean not null default false,
  atualizado_por uuid not null references auth.users(id),
  atualizado_em timestamptz not null default now()
);
create table public.checklist_config_auditoria (
  id bigint generated always as identity primary key,
  loja_id uuid not null references public.lojas(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  user_nome text not null,
  acao text not null,
  antes jsonb not null default '{}'::jsonb,
  depois jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default clock_timestamp()
);
create table public.checklist_acessos (
  loja_id uuid not null references public.lojas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  funcao text not null check (funcao in ('executor','encarregado','subgerente')),
  ativo boolean not null default true,
  primary key(loja_id,user_id,funcao)
);
create unique index checklist_acesso_unico_revisor on public.checklist_acessos(loja_id,funcao)
  where ativo and funcao in ('encarregado','subgerente');

create table public.checklist_rondas (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  data_operacional date not null,
  estado text not null default 'rascunho' check(estado in ('rascunho','submetida','devolvida','validada')),
  versao_conteudo bigint not null default 0 check(versao_conteudo>=0),
  criado_por uuid not null references auth.users(id),
  criado_por_nome text not null,
  criado_em timestamptz not null default now(),
  submetido_em timestamptz,
  validado_em timestamptz,
  updated_at timestamptz not null default now(),
  atualizado_por uuid references auth.users(id),
  atualizado_por_nome text,
  modelo_snapshot jsonb not null,
  respostas jsonb not null default '{}'::jsonb,
  observacoes text,
  unique(loja_id,data_operacional)
);
create table public.checklist_assinaturas (
  id bigint generated always as identity primary key,
  ronda_id uuid not null references public.checklist_rondas(id) on delete cascade,
  versao_conteudo bigint not null,
  etapa text not null check(etapa in ('encarregado','subgerente')),
  decisao text not null check(decisao in ('validada','devolvida')),
  user_id uuid not null references auth.users(id),
  nome text not null,
  comentario text,
  criado_em timestamptz not null default clock_timestamp(),
  unique(ronda_id,versao_conteudo,etapa),
  check((decisao='devolvida' and length(btrim(coalesce(comentario,'')))>=3) or decisao='validada')
);
create table public.checklist_eventos (
  id bigint generated always as identity primary key,
  ronda_id uuid not null references public.checklist_rondas(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  ator_nome text not null,
  acao text not null,
  detalhe jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default clock_timestamp()
);
create index checklist_rondas_loja_data_idx on public.checklist_rondas(loja_id,data_operacional desc);
create index checklist_assinaturas_ronda_idx on public.checklist_assinaturas(ronda_id,versao_conteudo);
create index checklist_eventos_ronda_idx on public.checklist_eventos(ronda_id,criado_em);

create or replace function private.checklist_designado(p_loja_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.checklist_acessos a
   join public.checklist_configuracoes c on c.loja_id=a.loja_id and c.ativo
   join public.loja_membros m on m.loja_id=a.loja_id and m.user_id=a.user_id
   where a.loja_id=p_loja_id and a.user_id=auth.uid() and a.ativo)
$$;
revoke all on function private.checklist_designado(uuid) from public,anon;
grant execute on function private.checklist_designado(uuid) to authenticated;

alter table public.checklist_modelos enable row level security;
alter table public.checklist_configuracoes enable row level security;
alter table public.checklist_config_auditoria enable row level security;
alter table public.checklist_acessos enable row level security;
alter table public.checklist_rondas enable row level security;
alter table public.checklist_assinaturas enable row level security;
alter table public.checklist_eventos enable row level security;
create policy checklist_modelo_read on public.checklist_modelos for select to authenticated using(ativo and exists(select 1 from public.checklist_acessos a where a.user_id=auth.uid() and a.ativo and private.checklist_designado(a.loja_id)));
create policy checklist_config_read on public.checklist_configuracoes for select to authenticated using(private.meu_papel()='admin');
create policy checklist_config_audit_read on public.checklist_config_auditoria for select to authenticated using(private.meu_papel()='admin');
create policy checklist_acessos_read on public.checklist_acessos for select to authenticated using(private.meu_papel()='admin' or (user_id=auth.uid() and private.checklist_designado(loja_id)));
create policy checklist_ronda_read on public.checklist_rondas for select to authenticated using(private.checklist_designado(loja_id));
create policy checklist_assinatura_read on public.checklist_assinaturas for select to authenticated using(exists(select 1 from public.checklist_rondas r where r.id=ronda_id and private.checklist_designado(r.loja_id)));
create policy checklist_evento_read on public.checklist_eventos for select to authenticated using(exists(select 1 from public.checklist_rondas r where r.id=ronda_id and private.checklist_designado(r.loja_id)));
revoke all on public.checklist_modelos,public.checklist_configuracoes,public.checklist_config_auditoria,public.checklist_acessos,
 public.checklist_rondas,public.checklist_assinaturas,public.checklist_eventos from public,anon,authenticated;
grant select on public.checklist_modelos,public.checklist_configuracoes,public.checklist_config_auditoria,public.checklist_acessos,
 public.checklist_rondas,public.checklist_assinaturas,public.checklist_eventos to authenticated;

create or replace function public.checklist_configurar_loja(
 p_loja_id uuid,p_ativo boolean,p_executores uuid[],p_encarregado uuid,p_subgerente uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_exec uuid; v_antes jsonb; v_depois jsonb; v_admin_nome text;
begin
 if auth.uid() is null or private.meu_papel() is distinct from 'admin' then raise exception 'Somente Admin configura o checklist' using errcode='42501'; end if;
 if p_loja_id is null or p_ativo is null or p_executores is null or cardinality(p_executores)=0
  or p_encarregado is null or p_subgerente is null or p_encarregado=p_subgerente
  or exists(select 1 from unnest(p_executores) x where x is null)
  or cardinality(p_executores)<>(select count(distinct x) from unnest(p_executores) x)
  or p_encarregado=any(p_executores) or p_subgerente=any(p_executores)
  or not exists(select 1 from public.lojas where id=p_loja_id)
  or exists(select 1 from unnest(array_cat(p_executores,array[p_encarregado,p_subgerente])) u where not exists(select 1 from public.loja_membros m where m.loja_id=p_loja_id and m.user_id=u))
 then raise exception 'Configuração inválida: selecione usuários vinculados à filial e funções sem sobreposição' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('checklist-config:'||p_loja_id::text,0));
 select jsonb_build_object('ativo',c.ativo,'acessos',(select coalesce(jsonb_agg(jsonb_build_object('user_id',a.user_id,'funcao',a.funcao,'ativo',a.ativo) order by a.funcao,a.user_id),'[]'::jsonb) from public.checklist_acessos a where a.loja_id=p_loja_id)) into v_antes from public.checklist_configuracoes c where c.loja_id=p_loja_id;
 v_antes:=coalesce(v_antes,'{}'::jsonb);
 insert into public.checklist_configuracoes(loja_id,ativo,atualizado_por) values(p_loja_id,p_ativo,auth.uid())
 on conflict(loja_id) do update set ativo=excluded.ativo,atualizado_por=auth.uid(),atualizado_em=clock_timestamp();
 delete from public.checklist_acessos where loja_id=p_loja_id;
 foreach v_exec in array p_executores loop insert into public.checklist_acessos(loja_id,user_id,funcao,ativo) values(p_loja_id,v_exec,'executor',true); end loop;
 insert into public.checklist_acessos(loja_id,user_id,funcao,ativo) values
 (p_loja_id,p_encarregado,'encarregado',true),(p_loja_id,p_subgerente,'subgerente',true);
 select jsonb_build_object('ativo',p_ativo,'executores',to_jsonb(p_executores),'encarregado',p_encarregado,'subgerente',p_subgerente) into v_depois;
 select coalesce(nullif(btrim(p.nome),''),u.email,auth.uid()::text) into v_admin_nome from public.perfis p left join auth.users u on u.id=p.id where p.id=auth.uid();
 insert into public.checklist_config_auditoria(loja_id,user_id,user_nome,acao,antes,depois) values(p_loja_id,auth.uid(),coalesce(v_admin_nome,auth.uid()::text),'acessos_atualizados',v_antes,v_depois);
end $$;

create or replace function public.checklist_criar_ronda(p_loja_id uuid,p_data date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_modelo public.checklist_modelos%rowtype; v_nome text;
begin
 if auth.uid() is null or p_loja_id is null or p_data is null or not private.checklist_designado(p_loja_id)
  or not exists(select 1 from public.checklist_acessos a where a.loja_id=p_loja_id and a.user_id=auth.uid() and a.funcao='executor' and a.ativo)
 then raise exception 'Sem acesso à loja ou executor não designado' using errcode='42501'; end if;
 select * into v_modelo from public.checklist_modelos where codigo='acougue_diario' and ativo order by versao desc limit 1;
 if not found then raise exception 'Template ativo não encontrado'; end if;
 select coalesce(nullif(btrim(p.nome),''),u.email,auth.uid()::text) into v_nome from public.perfis p left join auth.users u on u.id=p.id where p.id=auth.uid();
 v_nome:=coalesce(v_nome,auth.uid()::text);
 insert into public.checklist_rondas(loja_id,data_operacional,criado_por,criado_por_nome,atualizado_por,atualizado_por_nome,modelo_snapshot)
 values(p_loja_id,p_data,auth.uid(),v_nome,auth.uid(),v_nome,v_modelo.estrutura)
 on conflict(loja_id,data_operacional) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.checklist_rondas where loja_id=p_loja_id and data_operacional=p_data for update; end if;
 if not exists(select 1 from public.checklist_eventos where ronda_id=v_id and acao='criada') then
  insert into public.checklist_eventos(ronda_id,user_id,ator_nome,acao,detalhe) values(v_id,auth.uid(),v_nome,'criada',jsonb_build_object('modelo_versao',v_modelo.versao));
 end if;
 return v_id;
end $$;

create or replace function public.checklist_salvar_rascunho(p_ronda_id uuid,p_respostas jsonb,p_observacoes text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare r public.checklist_rondas%rowtype; v_nome text; v_expected integer; v_seen integer; v_items jsonb;
begin
 select * into r from public.checklist_rondas where id=p_ronda_id for update;
 if not found or not private.checklist_designado(r.loja_id)
  or not exists(select 1 from public.checklist_acessos where loja_id=r.loja_id and user_id=auth.uid() and funcao='executor' and ativo)
 then raise exception 'Ronda inexistente ou sem acesso' using errcode='42501'; end if;
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

revoke all on function public.checklist_configurar_loja(uuid,boolean,uuid[],uuid,uuid) from public,anon;
revoke all on function public.checklist_criar_ronda(uuid,date) from public,anon;
revoke all on function public.checklist_salvar_rascunho(uuid,jsonb,text) from public,anon;
revoke all on function public.checklist_submeter_ronda(uuid) from public,anon;
revoke all on function public.checklist_assinar_ronda(uuid,text,text,text) from public,anon;
grant execute on function public.checklist_configurar_loja(uuid,boolean,uuid[],uuid,uuid) to authenticated;
grant execute on function public.checklist_criar_ronda(uuid,date) to authenticated;
grant execute on function public.checklist_salvar_rascunho(uuid,jsonb,text) to authenticated;
grant execute on function public.checklist_submeter_ronda(uuid) to authenticated;
grant execute on function public.checklist_assinar_ronda(uuid,text,text,text) to authenticated;

commit;
