-- Perfis de acesso: o Administrador define o que cada perfil pode fazer.
-- A tabela guarda só o que foi alterado; sem linha, vale o padrão de private.permissao_padrao.
-- O Administrador tem sempre todas as permissões e não é editável.
begin;

create table if not exists public.papel_permissoes (
  papel          text not null check (papel in ('operador','assistente','analista','gerente')),
  permissao      text not null,
  permitido      boolean not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  primary key (papel, permissao)
);
comment on table public.papel_permissoes is
  'Permissões por perfil definidas pelo Administrador; ausência de linha = padrão do sistema.';
create index if not exists papel_permissoes_atualizado_por_fk_idx on public.papel_permissoes (atualizado_por);

alter table public.papel_permissoes enable row level security;
revoke all on public.papel_permissoes from public, anon, authenticated;
grant select on public.papel_permissoes to authenticated;
drop policy if exists papel_permissoes_sel on public.papel_permissoes;
create policy papel_permissoes_sel on public.papel_permissoes for select to authenticated using (true);

-- Padrão de cada permissão (mesma lista do app, src/app.html → PERMISSOES).
create or replace function private.permissao_padrao(p_papel text, p_permissao text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select p_papel = any (d.papeis)
    from (values
      ('registrar',               array['operador','assistente','analista','gerente']),
      ('editar_proprios',         array['operador','assistente','analista','gerente']),
      ('solicitar_exclusao',      array['operador','assistente','analista','gerente']),
      ('nome_solicitar',          array['operador','assistente','analista','gerente']),
      ('relatorios',              array['analista','gerente']),
      ('registros_editar_outros', array['analista','gerente']),
      ('exclusoes_aprovar',       array['assistente','analista','gerente']),
      ('nome_editar',             array['gerente']),
      ('usuarios_gerenciar',      array['analista','gerente']),
      ('alertas_loja_configurar', array['gerente']),
      ('avisos_todas_lojas',      array['analista','gerente']),
      ('lojas_gerenciar',         array[]::text[]),
      ('catalogo_gerenciar',      array[]::text[]),
      ('auditoria_ver',           array[]::text[]),
      ('dados_manutencao',        array[]::text[])
    ) as d(permissao, papeis)
    where d.permissao = p_permissao
  ), false);
$$;
revoke all on function private.permissao_padrao(text,text) from public, anon;
grant execute on function private.permissao_padrao(text,text) to authenticated;

-- Permissão efetiva do usuário da sessão.
create or replace function private.tem_permissao(p_permissao text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_papel text; v_permitido boolean;
begin
  v_papel := private.meu_papel();
  if v_papel is null then return false; end if;
  if v_papel = 'admin' then return true; end if;
  select permitido into v_permitido from public.papel_permissoes
   where papel = v_papel and permissao = p_permissao;
  if found then return v_permitido; end if;
  return private.permissao_padrao(v_papel, p_permissao);
end;
$$;
revoke all on function private.tem_permissao(text) from public, anon;
grant execute on function private.tem_permissao(text) to authenticated;

-- Somente o Administrador altera permissões.
create or replace function public.definir_permissao_papel(p_papel text, p_permissao text, p_permitido boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_usuario text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if private.meu_papel() is distinct from 'admin' then
    raise exception 'Somente o Administrador define permissões' using errcode = '42501';
  end if;
  if p_papel is null or p_papel not in ('operador','assistente','analista','gerente') then
    raise exception 'Perfil inválido';
  end if;
  if p_permissao is null or p_permissao not in (
    'registrar','editar_proprios','solicitar_exclusao','nome_solicitar','relatorios',
    'registros_editar_outros','exclusoes_aprovar','nome_editar','usuarios_gerenciar',
    'alertas_loja_configurar','avisos_todas_lojas','lojas_gerenciar','catalogo_gerenciar',
    'auditoria_ver','dados_manutencao') then
    raise exception 'Permissão inválida';
  end if;
  if p_permitido is null then raise exception 'Valor inválido'; end if;

  insert into public.papel_permissoes(papel,permissao,permitido,atualizado_em,atualizado_por)
  values (p_papel,p_permissao,p_permitido,now(),auth.uid())
  on conflict (papel,permissao) do update
    set permitido = excluded.permitido, atualizado_em = now(), atualizado_por = auth.uid();

  select coalesce(p.nome,u.email,auth.uid()::text) into v_usuario
    from auth.users u left join public.perfis p on p.id = u.id where u.id = auth.uid();
  insert into public.auditoria(user_id,usuario,papel,acao,detalhe)
  values (auth.uid(),v_usuario,'admin','permissao_alterada',
    jsonb_build_object('papel',p_papel,'permissao',p_permissao,'permitido',p_permitido));
end;
$$;
revoke all on function public.definir_permissao_papel(text,text,boolean) from public, anon;
grant execute on function public.definir_permissao_papel(text,text,boolean) to authenticated;

-- ───── Nome de produto passa a obedecer às permissões ─────
drop policy if exists solicitacoes_nome_sel on public.solicitacoes_nome;
create policy solicitacoes_nome_sel on public.solicitacoes_nome for select to authenticated
  using (solicitante_id = (select auth.uid()) or (select private.tem_permissao('nome_editar')));

create or replace function private.proteger_nome_catalogo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.nome is distinct from old.nome
     and coalesce(trim(old.nome),'') <> ''
     and auth.uid() is not null
     and not coalesce(private.tem_permissao('nome_editar'), false) then
    new.nome := old.nome;
  end if;
  return new;
end;
$fn$;
revoke all on function private.proteger_nome_catalogo() from public, anon, authenticated;

create or replace function public.solicitar_correcao_nome(p_ean text, p_nome text, p_loja_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_nome text; v_atual text; v_usuario text; v_papel text; v_loja_nome text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  v_papel := private.meu_papel();
  if not coalesce(private.tem_permissao('nome_solicitar'), false) then
    raise exception 'Perfil sem permissão para sugerir correção' using errcode = '42501';
  end if;
  if p_loja_id is not null and not coalesce(private.tem_escopo_global(),false) and not private.membro_da(p_loja_id) then
    raise exception 'Sem acesso à loja' using errcode = '42501';
  end if;
  if coalesce(p_ean,'') !~ '^[0-9]{6,14}$' then raise exception 'Código do produto inválido'; end if;
  v_nome := trim(regexp_replace(coalesce(p_nome,''), '\s+', ' ', 'g'));
  if length(v_nome) < 2 or length(v_nome) > 120 then
    raise exception 'Informe um nome entre 2 e 120 caracteres';
  end if;
  select nome into v_atual from public.catalogo where ean = p_ean;
  v_atual := coalesce(v_atual,'');
  if v_atual = v_nome then raise exception 'O nome sugerido é igual ao atual'; end if;

  select coalesce(p.nome,u.email,auth.uid()::text) into v_usuario
    from auth.users u left join public.perfis p on p.id = u.id where u.id = auth.uid();
  select l.nome into v_loja_nome from public.lojas l where l.id = p_loja_id;

  insert into public.solicitacoes_nome(ean,loja_id,solicitante_id,solicitante_nome,nome_atual,nome_sugerido)
  values (p_ean,p_loja_id,auth.uid(),v_usuario,v_atual,v_nome)
  on conflict (ean, solicitante_id) where status = 'pendente'
  do update set nome_sugerido = excluded.nome_sugerido, nome_atual = excluded.nome_atual,
                loja_id = excluded.loja_id, criado_em = now()
  returning id into v_id;

  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao,detalhe)
  values (auth.uid(),v_usuario,v_papel,p_loja_id,v_loja_nome,'correcao_nome_solicitada',
    jsonb_build_object('solicitacao_id',v_id,'ean',p_ean,'nome_atual',v_atual,'nome_sugerido',v_nome));
  return v_id;
end;
$$;
revoke all on function public.solicitar_correcao_nome(text,text,uuid) from public, anon;
grant execute on function public.solicitar_correcao_nome(text,text,uuid) to authenticated;

create or replace function public.revisar_correcao_nome(p_id uuid, p_aprovar boolean, p_resposta text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.solicitacoes_nome%rowtype; v_papel text; v_usuario text; v_loja_nome text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  v_papel := private.meu_papel();
  if not coalesce(private.tem_permissao('nome_editar'), false) then
    raise exception 'Perfil sem permissão para avaliar correções de nome' using errcode = '42501';
  end if;
  select * into r from public.solicitacoes_nome where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if r.status <> 'pendente' then raise exception 'Solicitação já avaliada'; end if;
  if not p_aprovar and (p_resposta is null or length(trim(p_resposta)) < 3) then
    raise exception 'Informe o motivo da rejeição';
  end if;
  if p_aprovar then
    insert into public.catalogo(ean,nome) values (r.ean,r.nome_sugerido)
    on conflict (ean) do update set nome = excluded.nome;
  end if;
  update public.solicitacoes_nome
     set status = case when p_aprovar then 'aprovada' else 'rejeitada' end,
         revisor_id = auth.uid(), resposta = nullif(trim(p_resposta),''), revisado_em = now()
   where id = p_id;
  select coalesce(p.nome,u.email,auth.uid()::text) into v_usuario
    from auth.users u left join public.perfis p on p.id = u.id where u.id = auth.uid();
  select l.nome into v_loja_nome from public.lojas l where l.id = r.loja_id;
  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao,detalhe)
  values (auth.uid(),v_usuario,v_papel,r.loja_id,v_loja_nome,
    case when p_aprovar then 'correcao_nome_aprovada' else 'correcao_nome_rejeitada' end,
    jsonb_build_object('solicitacao_id',r.id,'ean',r.ean,'nome_atual',r.nome_atual,
      'nome_sugerido',r.nome_sugerido,'solicitante_id',r.solicitante_id,'resposta',p_resposta));
end;
$$;
revoke all on function public.revisar_correcao_nome(uuid,boolean,text) from public, anon;
grant execute on function public.revisar_correcao_nome(uuid,boolean,text) to authenticated;

commit;
