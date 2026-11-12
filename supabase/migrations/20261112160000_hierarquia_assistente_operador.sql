-- Complemento da hierarquia (decisão do proprietário, 12/11/2026): Assistente não promove,
-- só cria/administra Operador; Operador só executa o operacional e nunca gerencia usuários,
-- mesmo com "Gerenciar usuários" marcado. Mesma regra de supabase/functions/gerir-usuarios/hierarquia.ts.
begin;

do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.editar_usuario_atomico(uuid,uuid,text,text,uuid[],boolean)'::regprocedure);
  v_novo := replace(v_def,
    $a$v_teto := case v_actor_papel when 'admin' then 5 when 'gerente' then 3 else 2 end;$a$,
    $b$v_teto := case v_actor_papel when 'admin' then 5 when 'gerente' then 3 when 'analista' then 2 when 'assistente' then 1 else 0 end;$b$);
  if v_novo = v_def then raise exception 'editar_usuario_atomico: teto da hierarquia não encontrado'; end if;
  execute v_novo;
end $$;

commit;
