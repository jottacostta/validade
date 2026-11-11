-- Perfis de acesso, etapa 3: as áreas administrativas passam a obedecer a papel_permissoes.
-- Permissões: auditoria_ver, catalogo_gerenciar, alertas_loja_configurar, lojas_gerenciar,
-- usuarios_gerenciar, usuarios_excluir (nova), avisos_todas_lojas. (relatorios e dados_manutencao só existem no app.)
-- Decisão do proprietário: o Administrador concede qualquer permissão a qualquer perfil.
begin;

grant execute on function private.permissao_padrao(text,text) to service_role;
grant execute on function private.tem_permissao(text) to service_role;

-- Permissão de um perfil qualquer (para consultas por perfil e para as Edge Functions).
create or replace function public.papel_tem_permissao(p_papel text, p_permissao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_papel is null then false
    when p_papel = 'admin' then true
    else coalesce(
      (select pp.permitido from public.papel_permissoes pp where pp.papel = p_papel and pp.permissao = p_permissao),
      private.permissao_padrao(p_papel, p_permissao))
  end;
$$;
revoke all on function public.papel_tem_permissao(text,text) from public, anon;
grant execute on function public.papel_tem_permissao(text,text) to authenticated, service_role;

-- Nova permissão: excluir usuários (antes era regra fixa: só Gerente e Administrador).
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
      ('usuarios_excluir',        array['gerente']),
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

do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.definir_permissao_papel(text,text,boolean)'::regprocedure);
  v_novo := replace(v_def, $a$'auditoria_ver','dados_manutencao')$a$, $b$'auditoria_ver','dados_manutencao','usuarios_excluir')$b$);
  if v_novo = v_def then raise exception 'definir_permissao_papel: lista de permissões não encontrada'; end if;
  execute v_novo;
end $$;

-- Auditoria
alter policy auditoria_sel on public.auditoria using ((select private.tem_permissao('auditoria_ver')));

-- Lojas e vínculos
alter policy lojas_ins on public.lojas with check ((select private.tem_permissao('lojas_gerenciar')));
alter policy lojas_upd on public.lojas using ((select private.tem_permissao('lojas_gerenciar')))
  with check ((select private.tem_permissao('lojas_gerenciar')));
alter policy lojas_del on public.lojas using ((select private.tem_permissao('lojas_gerenciar')));
alter policy lojas_sel on public.lojas using (private.tem_escopo_global() or private.membro_da(id)
  or (select private.tem_permissao('lojas_gerenciar')) or (select private.tem_permissao('usuarios_gerenciar'))
  or (select private.tem_permissao('avisos_todas_lojas')));
alter policy loja_membros_ins on public.loja_membros with check ((select private.tem_permissao('lojas_gerenciar')));
alter policy loja_membros_upd on public.loja_membros using ((select private.tem_permissao('lojas_gerenciar')))
  with check ((select private.tem_permissao('lojas_gerenciar')));
alter policy loja_membros_del on public.loja_membros using ((select private.tem_permissao('lojas_gerenciar')));
alter policy loja_membros_sel on public.loja_membros using (user_id = (select auth.uid()) or private.tem_escopo_global()
  or (select private.tem_permissao('lojas_gerenciar')) or (select private.tem_permissao('usuarios_gerenciar')));

-- Usuários (a troca de papel continua exclusiva do Administrador pelo gatilho protege_papel)
alter policy perfis_sel on public.perfis using (id = (select auth.uid())
  or (select private.tem_permissao('usuarios_gerenciar')) or (select private.meu_papel()) = 'assistente');
alter policy perfis_upd on public.perfis using ((select private.tem_permissao('usuarios_gerenciar')))
  with check ((select private.tem_permissao('usuarios_gerenciar')));

-- Avisos de todas as lojas: quem recebe a permissão precisa ler as próprias notificações de outras lojas
alter policy notificacoes_sel_own_store on public.notificacoes using (user_id = (select auth.uid())
  and (private.membro_da(loja_id) or private.tem_escopo_global() or (select private.tem_permissao('avisos_todas_lojas'))));
alter policy notificacoes_upd_own_store on public.notificacoes using (user_id = (select auth.uid())
  and (private.membro_da(loja_id) or private.tem_escopo_global() or (select private.tem_permissao('avisos_todas_lojas'))))
  with check (user_id = (select auth.uid())
  and (private.membro_da(loja_id) or private.tem_escopo_global() or (select private.tem_permissao('avisos_todas_lojas'))));

-- Funções grandes: troca-se só a checagem de papel. Se o trecho não existir, a migration falha inteira.
do $$
declare v_def text; v_novo text; f regprocedure;
begin
  v_def := pg_get_functiondef('private.proteger_tombstone_catalogo()'::regprocedure);
  v_novo := replace(v_def, $a$private.meu_papel() is distinct from 'admin'$a$,
                           $b$not coalesce(private.tem_permissao('catalogo_gerenciar'),false)$b$);
  if v_novo = v_def then raise exception 'proteger_tombstone_catalogo: trecho de papel não encontrado'; end if;
  execute v_novo;

  v_def := pg_get_functiondef('private.validar_ajustes_alertas_gerenciais()'::regprocedure);
  v_novo := replace(v_def, $a$coalesce(v_papel,'') not in ('admin','gerente')$a$,
                           $b$not coalesce(private.tem_permissao('alertas_loja_configurar'),false)$b$);
  if v_novo = v_def then raise exception 'validar_ajustes_alertas_gerenciais: trecho de papel não encontrado'; end if;
  execute v_novo;

  foreach f in array array['public.gerar_alertas_validade()'::regprocedure,
                           'public.preparar_alertas_push()'::regprocedure,
                           'public.projetar_google_calendar(uuid)'::regprocedure] loop
    v_def := pg_get_functiondef(f);
    v_novo := regexp_replace(v_def, $a$p\.papel\s+in\s*\(\s*'analista'\s*,\s*'gerente'\s*,\s*'admin'\s*\)$a$,
                             $b$public.papel_tem_permissao(p.papel,'avisos_todas_lojas')$b$, 'g');
    if v_novo = v_def then raise exception '%: lista de perfis globais não encontrada', f; end if;
    execute v_novo;
  end loop;
end $$;

commit;
