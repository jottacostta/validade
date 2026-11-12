-- Hierarquia de promoção na edição de usuários (decisão do proprietário, 12/11/2026):
-- Administrador atribui/administra qualquer papel; Gerente até Analista; Analista até Assistente;
-- qualquer outro perfil com "Gerenciar usuários" até Assistente. Mesma regra de
-- supabase/functions/gerir-usuarios/hierarquia.ts. Troca só o trecho de papel de
-- public.editar_usuario_atomico; se o trecho não existir, a migration falha inteira.
begin;

do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.editar_usuario_atomico(uuid,uuid,text,text,uuid[],boolean)'::regprocedure);

  v_novo := replace(v_def, $a$  v_admins bigint;
begin$a$, $b$  v_admins bigint;
  v_teto integer;
  v_nivel_alvo integer;
  v_nivel_novo integer;
begin$b$);
  if v_novo = v_def then raise exception 'editar_usuario_atomico: declarações não encontradas'; end if;
  v_def := v_novo;

  v_novo := replace(v_def, $a$  -- Não-admin só administra operadores/assistentes e só pode atribuir esses papéis.
  if v_actor_papel <> 'admin' and v_target_papel in ('analista','gerente','admin') then
    raise exception 'Ator não pode administrar este papel' using errcode = '42501';
  end if;
  if v_actor_papel <> 'admin'
     and p_papel is not null
     and p_papel not in ('operador','assistente') then
    raise exception 'Ator só pode atribuir Operador ou Assistente' using errcode = '42501';
  end if;$a$, $b$  -- Hierarquia: Administrador tudo; Gerente até Analista; demais com a permissão até Assistente.
  v_teto := case v_actor_papel when 'admin' then 5 when 'gerente' then 3 else 2 end;
  v_nivel_alvo := case v_target_papel when 'operador' then 1 when 'assistente' then 2 when 'analista' then 3 when 'gerente' then 4 when 'admin' then 5 end;
  v_nivel_novo := case p_papel when 'operador' then 1 when 'assistente' then 2 when 'analista' then 3 when 'gerente' then 4 when 'admin' then 5 end;
  if v_nivel_alvo > v_teto then
    raise exception 'Ator não pode administrar este papel' using errcode = '42501';
  end if;
  if p_papel is not null and v_nivel_novo > v_teto then
    raise exception 'Ator não pode atribuir este papel' using errcode = '42501';
  end if;$b$);
  if v_novo = v_def then raise exception 'editar_usuario_atomico: trecho de papel não encontrado'; end if;
  execute v_novo;
end $$;

commit;
