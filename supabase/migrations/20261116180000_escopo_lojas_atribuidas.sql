-- Escopo por loja atribuída (decisão do Jonatas, 16/11/2026):
--   * Só o Administrador enxerga a rede inteira.
--   * Assistente, Analista e Gerente enxergam somente as lojas atribuídas,
--     inclusive avisos de validade e push.
--   * Pedidos de correção de nome e vínculos usuário–loja seguem a mesma regra.
begin;

-- 1. Alcance global passa a ser exclusivo do Administrador.
create or replace function private.tem_escopo_global()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.meu_papel() = 'admin', false);
$$;

-- 2. "Receber avisos de todas as lojas" deixa de existir para perfis que não
--    são Administrador (o Administrador já é global).
create or replace function private.permissao_padrao(p_papel text, p_permissao text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce((
    select p_papel = any (d.papeis)
    from (values
      ('registrar',               array['operador','assistente','analista','gerente']),
      ('editar_proprios',         array['operador','assistente','analista','gerente']),
      ('solicitar_exclusao',      array['operador','assistente','analista','gerente']),
      ('nome_solicitar',          array['operador','assistente','analista','gerente']),
      ('registros_recolher',      array['operador','assistente','analista','gerente']),
      ('relatorios',              array['analista','gerente']),
      ('registros_editar_outros', array['analista','gerente']),
      ('exclusoes_aprovar',       array['assistente','analista','gerente']),
      ('nome_editar',             array['gerente']),
      ('usuarios_gerenciar',      array['analista','gerente']),
      ('usuarios_excluir',        array['gerente']),
      ('alertas_loja_configurar', array['gerente']),
      ('alertas_enviar',          array[]::text[]),
      ('lojas_gerenciar',         array[]::text[]),
      ('catalogo_gerenciar',      array[]::text[]),
      ('auditoria_ver',           array[]::text[]),
      ('dados_manutencao',        array[]::text[])
    ) as d(permissao, papeis)
    where d.permissao = p_permissao
  ), false);
$$;

create or replace function public.papel_tem_permissao(p_papel text, p_permissao text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when p_papel is null then false
    when p_papel = 'admin' then true
    when p_permissao = 'avisos_todas_lojas' then false
    when p_papel = 'promotor' then coalesce(
      (select pp.permitido from public.papel_permissoes pp
        where pp.papel = 'promotor' and pp.permissao = p_permissao),
      (select pp.permitido from public.papel_permissoes pp
        where pp.papel = 'operador' and pp.permissao = p_permissao),
      private.permissao_padrao('operador', p_permissao))
    else coalesce(
      (select pp.permitido from public.papel_permissoes pp
        where pp.papel = p_papel and pp.permissao = p_permissao),
      private.permissao_padrao(p_papel, p_permissao))
  end;
$$;

delete from public.papel_permissoes where permissao = 'avisos_todas_lojas';

-- O Administrador não consegue mais religar a permissão pela tela.
do $$
declare
  v_def text := pg_get_functiondef('public.definir_permissao_papel(text,text,boolean)'::regprocedure);
  v_novo text := replace(v_def, '''alertas_loja_configurar'',''avisos_todas_lojas'',', '''alertas_loja_configurar'',');
begin
  if v_novo = v_def then raise exception 'Lista de permissões de definir_permissao_papel não encontrada'; end if;
  execute v_novo;
end $$;

-- 3. Edição de usuário: o Analista deixa de ter o alcance global legado.
do $$
declare
  v_rpc regprocedure;
  v_def text;
  v_novo text;
begin
  for v_rpc in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'editar_usuario_atomico'
       and pg_get_functiondef(p.oid) like '%(''admin'',''analista'')%'
  loop
    v_def := pg_get_functiondef(v_rpc);
    v_novo := replace(v_def, '(''admin'',''analista'')', '(''admin'')');
    execute v_novo;
  end loop;
end $$;

-- 4. Lojas e vínculos: fora do Administrador, só as lojas atribuídas.
drop policy if exists lojas_sel on public.lojas;
create policy lojas_sel on public.lojas for select to authenticated
  using (private.tem_escopo_global() or private.membro_da(id));

drop policy if exists lojas_upd on public.lojas;
create policy lojas_upd on public.lojas for update to authenticated
  using (private.meu_papel() = 'admin' or (private.tem_permissao('lojas_gerenciar') and private.membro_da(id)))
  with check (private.meu_papel() = 'admin' or (private.tem_permissao('lojas_gerenciar') and private.membro_da(id)));

drop policy if exists lojas_del on public.lojas;
create policy lojas_del on public.lojas for delete to authenticated
  using (private.meu_papel() = 'admin' or (private.tem_permissao('lojas_gerenciar') and private.membro_da(id)));

drop policy if exists lojas_ins on public.lojas;
create policy lojas_ins on public.lojas for insert to authenticated
  with check (private.meu_papel() = 'admin');

drop policy if exists loja_membros_sel on public.loja_membros;
create policy loja_membros_sel on public.loja_membros for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.tem_escopo_global()
    or (private.meu_papel() = 'gerente' and private.tem_permissao('lojas_gerenciar') and private.membro_da(loja_id)
        and (private.usuario_tem_papel(user_id, 'operador') or private.usuario_tem_papel(user_id, 'assistente')))
    or (private.meu_papel() <> 'gerente' and private.membro_da(loja_id)
        and (private.tem_permissao('lojas_gerenciar') or private.tem_permissao('usuarios_gerenciar')))
  );

drop policy if exists loja_membros_ins on public.loja_membros;
create policy loja_membros_ins on public.loja_membros for insert to authenticated
  with check (
    private.meu_papel() = 'admin'
    or (private.meu_papel() = 'gerente' and private.tem_permissao('lojas_gerenciar') and private.membro_da(loja_id)
        and (private.usuario_tem_papel(user_id, 'operador') or private.usuario_tem_papel(user_id, 'assistente')))
    or (private.meu_papel() <> 'gerente' and private.tem_permissao('lojas_gerenciar') and private.membro_da(loja_id)
        and not private.usuario_tem_papel(user_id, 'gerente') and not private.usuario_tem_papel(user_id, 'admin'))
  );

drop policy if exists loja_membros_upd on public.loja_membros;
create policy loja_membros_upd on public.loja_membros for update to authenticated
  using (
    private.meu_papel() = 'admin'
    or (private.meu_papel() = 'gerente' and private.tem_permissao('lojas_gerenciar') and private.membro_da(loja_id)
        and (private.usuario_tem_papel(user_id, 'operador') or private.usuario_tem_papel(user_id, 'assistente')))
    or (private.meu_papel() <> 'gerente' and private.tem_permissao('lojas_gerenciar') and private.membro_da(loja_id)
        and not private.usuario_tem_papel(user_id, 'gerente') and not private.usuario_tem_papel(user_id, 'admin'))
  )
  with check (
    private.meu_papel() = 'admin'
    or (private.meu_papel() = 'gerente' and private.tem_permissao('lojas_gerenciar') and private.membro_da(loja_id)
        and (private.usuario_tem_papel(user_id, 'operador') or private.usuario_tem_papel(user_id, 'assistente')))
    or (private.meu_papel() <> 'gerente' and private.tem_permissao('lojas_gerenciar') and private.membro_da(loja_id)
        and not private.usuario_tem_papel(user_id, 'gerente') and not private.usuario_tem_papel(user_id, 'admin'))
  );

drop policy if exists loja_membros_del on public.loja_membros;
create policy loja_membros_del on public.loja_membros for delete to authenticated
  using (
    private.meu_papel() = 'admin'
    or (private.meu_papel() = 'gerente' and private.tem_permissao('lojas_gerenciar') and private.membro_da(loja_id)
        and (private.usuario_tem_papel(user_id, 'operador') or private.usuario_tem_papel(user_id, 'assistente')))
    or (private.meu_papel() <> 'gerente' and private.tem_permissao('lojas_gerenciar') and private.membro_da(loja_id)
        and not private.usuario_tem_papel(user_id, 'gerente') and not private.usuario_tem_papel(user_id, 'admin'))
  );

-- 5. Correções de nome: cada avaliador vê e decide só os pedidos das suas lojas.
drop policy if exists solicitacoes_nome_sel on public.solicitacoes_nome;
create policy solicitacoes_nome_sel on public.solicitacoes_nome for select to authenticated
  using (
    solicitante_id = (select auth.uid())
    or ((select private.tem_permissao('nome_editar'))
        and (private.tem_escopo_global() or private.membro_da(loja_id)))
  );

do $$
declare
  v_def text := pg_get_functiondef('public.revisar_correcao_nome(uuid,boolean,text)'::regprocedure);
  v_alvo text := 'if r.status <> ''pendente'' then raise exception ''Solicitação já avaliada''; end if;';
  v_novo text;
begin
  v_novo := replace(v_def, v_alvo,
    'if not coalesce(private.tem_escopo_global() or private.membro_da(r.loja_id), false) then' || chr(10) ||
    '    raise exception ''Solicitação de outra loja'' using errcode = ''42501'';' || chr(10) ||
    '  end if;' || chr(10) || '  ' || v_alvo);
  if v_novo = v_def then raise exception 'Trecho de revisar_correcao_nome não encontrado'; end if;
  execute v_novo;
end $$;

notify pgrst, 'reload schema';
commit;
