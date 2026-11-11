-- Aprovar uma solicitação de exclusão cujo registro já foi removido (por outro caminho, ex.: exclusão
-- direta do Administrador) dava erro "Registro já removido ou não encontrado" e a solicitação ficava
-- pendente para sempre. Agora a aprovação conclui a solicitação e registra `ja_removido` na auditoria.
begin;

do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.revisar_solicitacao_exclusao(uuid,boolean,text)'::regprocedure);
  v_novo := replace(v_def, $a$if not found then raise exception 'Registro já removido ou não encontrado'; end if;$a$,
                           $b$if not found then v_ja_removido := true; end if;$b$);
  if v_novo = v_def then raise exception 'revisar_solicitacao_exclusao: trecho de registro removido não encontrado'; end if;
  v_def := v_novo;
  v_novo := replace(v_def, $a$v_loja_nome text;$a$, $b$v_loja_nome text; v_ja_removido boolean := false;$b$);
  if v_novo = v_def then raise exception 'revisar_solicitacao_exclusao: declaração não encontrada'; end if;
  v_def := v_novo;
  v_novo := replace(v_def, $a$'resposta',p_resposta));$a$, $b$'resposta',p_resposta,'ja_removido',v_ja_removido));$b$);
  if v_novo = v_def then raise exception 'revisar_solicitacao_exclusao: auditoria não encontrada'; end if;
  execute v_novo;
end $$;

commit;
