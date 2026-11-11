-- Perfis de acesso, etapa 2: registros e exclusões passam a obedecer a papel_permissoes no servidor.
-- Permissões: registrar, editar_proprios, registros_editar_outros, solicitar_exclusao, exclusoes_aprovar.
-- O alcance por loja não muda: continua valendo private.tem_escopo_global() ou private.membro_da(loja).
begin;

do $$
declare t text;
begin
  foreach t in array array['produtos','lotes','pere_itens','pere_regs'] loop
    execute format($f$alter policy %I on public.%I
      with check ((private.tem_escopo_global() or private.membro_da(loja_id))
                  and (select private.tem_permissao('registrar')))$f$, t||'_ins', t);
    execute format($f$alter policy %I on public.%I
      using ((private.tem_escopo_global() or private.membro_da(loja_id))
             and ((select private.tem_permissao('registros_editar_outros'))
                  or (created_by = (select auth.uid()) and (select private.tem_permissao('editar_proprios')))))
      with check ((private.tem_escopo_global() or private.membro_da(loja_id))
                  and ((select private.tem_permissao('registros_editar_outros'))
                       or (select private.tem_permissao('editar_proprios'))))$f$, t||'_upd', t);
  end loop;
end $$;

alter policy solicitacao_sel on public.solicitacoes_exclusao
  using (solicitante_id = (select auth.uid())
         or ((select private.tem_permissao('exclusoes_aprovar'))
             and (private.tem_escopo_global() or private.membro_da(loja_id))));

-- As duas funções abaixo são grandes; troca-se só a linha da checagem de papel.
-- Se o trecho esperado não existir, a migration falha inteira (nada é aplicado pela metade).
do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.revisar_solicitacao_exclusao(uuid,boolean,text)'::regprocedure);
  v_novo := replace(v_def,
    $a$if coalesce(v_papel,'') not in ('assistente','analista','gerente','admin') then$a$,
    $b$if not coalesce(private.tem_permissao('exclusoes_aprovar'),false) then$b$);
  if v_novo = v_def then raise exception 'revisar_solicitacao_exclusao: trecho de papel não encontrado'; end if;
  execute v_novo;

  v_def := pg_get_functiondef('public.solicitar_exclusao(uuid,text,text,text)'::regprocedure);
  v_novo := replace(v_def,
    $a$if not private.membro_da(p_loja_id) then raise exception 'Sem acesso à loja'; end if;$a$,
    $b$if not private.membro_da(p_loja_id) then raise exception 'Sem acesso à loja'; end if;
  if not coalesce(private.tem_permissao('solicitar_exclusao'),false) then raise exception 'Perfil sem permissão para solicitar exclusões' using errcode = '42501'; end if;$b$);
  if v_novo = v_def then raise exception 'solicitar_exclusao: trecho de acesso não encontrado'; end if;
  execute v_novo;
end $$;

commit;
